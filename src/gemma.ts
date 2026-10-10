// Gemma 3 on the phone, two ways. With WebGPU: the 1B model on the GPU, through Transformers.js. Without it (iPhones before iOS 26, many Android
// GPUs, the browsers inside chat apps): the 270M model on the processor, through llama.cpp compiled to WebAssembly (wllama). The CPU way can't use
// Transformers.js: its CPU backend lacks an operator the 4- and 8-bit Gemma ONNX builds need, and the 16-bit one stalls while it loads (both tried).
// Nothing loads until it is switched on: then the library and the model come from public CDNs once (jsDelivr, Hugging Face) and from the browser's
// cache after that. Prompts and answers never leave the device.
import { GEMMA_MODEL, GEMMA_MB, GEMMA_SMALL_REPO, GEMMA_SMALL_FILE, GEMMA_SMALL_MB } from './config.ts';
import wllamaWasm from '@wllama/wllama/esm/wasm/wllama.wasm?url';   // only the address: the 8 MB file is fetched when the CPU way loads

export type Chat = { role: string; content: string }[];
type Writer = { write(chat: Chat): Promise<string | null>; dispose(): Promise<void> };
type Gpu = { requestAdapter(): Promise<{ features: Set<string> } | null> };
const gpu = () => (navigator as Navigator & { gpu?: Gpu }).gpu;
const SAMPLING = { temperature: 0.7, top_k: 64, top_p: 0.95 };

let gen: Promise<Writer> | null = null;
let ready: Writer | null = null;
let loads = 0;                                                         // counts loads and unloads, so a load that finishes after an unload knows it is stale
let queue: Promise<unknown> = Promise.resolve();                       // one answer at a time: the model can't run two at once
let onGpu = false;

// Which way it will run here, before anything loads. (A GPU the browser then refuses also ends on the processor.)
export const plan = () => (gpu() ? { gpu: true, mb: GEMMA_MB } : { gpu: false, mb: GEMMA_SMALL_MB });
export const supported = () => typeof WebAssembly === 'object';      // the processor way needs only WebAssembly, which every current browser has
export const usingGpu = () => onGpu;                                  // how the loaded model runs
export const isReady = () => !!ready;                                  // the model is loaded and can write

async function onTheGpu(adapter: { features: Set<string> }, onProgress: (percent: number) => void): Promise<Writer> {
  const { pipeline } = await import('@huggingface/transformers');     // a separate chunk: the map never downloads it unless Gemma is on
  type Pipe = ((chat: Chat, opts: object) => Promise<{ generated_text: { content: string }[] }[]>) & { dispose(): Promise<void> };
  const g = await pipeline('text-generation', GEMMA_MODEL, {
    device: 'webgpu',
    dtype: adapter.features.has('shader-f16') ? 'q4f16' : 'q4',       // half-precision maths where the GPU has it (smaller, faster), else full
    progress_callback: (e: { status: string; progress?: number }) => { if (e.status === 'progress_total') onProgress(Math.floor(e.progress ?? 0)); },
  }) as unknown as Pipe;
  return {
    write: async (chat) => (await g(chat, { max_new_tokens: 40, do_sample: true, ...SAMPLING }))[0].generated_text.at(-1)?.content ?? null,
    dispose: () => g.dispose(),
  };
}

async function onTheProcessor(onProgress: (percent: number) => void): Promise<Writer> {
  const { Wllama } = await import('@wllama/wllama');                  // a separate chunk too
  const w = new Wllama({ default: wllamaWasm }, { allowOffline: true, suppressNativeLog: true });   // allowOffline: a cached model loads without a network
  await w.loadModelFromHF({ repo: GEMMA_SMALL_REPO, file: GEMMA_SMALL_FILE }, {
    n_ctx: 1024, n_gpu_layers: 0,                                       // a short chat; no GPU (that is why we are here)
    progressCallback: ({ loaded, total }) => onProgress(total ? Math.floor((loaded / total) * 100) : 0),
  });
  return {
    write: async (chat) => (await w.createChatCompletion({ messages: chat as never, max_tokens: 40, ...SAMPLING })).choices[0]?.message?.content ?? null,
    dispose: () => w.exit(),
  };
}

// Loads the model (from the cache when it was downloaded before). `onProgress` gets 0-100 while files download.
export function load(onProgress: (percent: number) => void): Promise<void> {
  if (!gen) {
    const id = ++loads;
    const p = (async () => {
      const adapter = (await gpu()?.requestAdapter().catch(() => null) ?? null) as { features: Set<string> } | null;   // null: no WebGPU, or a GPU the browser won't use
      const g = adapter ? await onTheGpu(adapter, onProgress) : await onTheProcessor(onProgress);
      if (id !== loads) { await g.dispose(); throw new Error('switched off while loading'); }
      onGpu = !!adapter;
      return (ready = g);
    })();
    gen = p;
    p.catch(() => { if (id === loads) gen = null; });                     // a failed load can be tried again
  }
  return gen.then(() => {});
}

export function unload() {
  const g = gen; gen = ready = null; loads++;
  g?.then((m) => m.dispose(), () => {});
}

// Gemma's next turn in the chat, or null when it isn't loaded.
export function write(chat: Chat): Promise<string | null> {
  const model = ready;
  if (!model) return Promise.resolve(null);
  const run = queue.then(() => model.write(chat));
  queue = run.catch(() => {});
  return run;
}
