// Gemma 3 on the phone's GPU (WebGPU), through Transformers.js. Nothing loads until it is switched on: then the library and the model
// come from public CDNs once (jsDelivr, Hugging Face) and from the browser's cache after that. Prompts and answers never leave the device.
import { GEMMA_MODEL } from './config.ts';

export type Chat = { role: string; content: string }[];
type Model = ((chat: Chat, opts: object) => Promise<unknown>) & { dispose(): Promise<void> };
type Gpu = { requestAdapter(): Promise<{ features: Set<string> } | null> };
const gpu = () => (navigator as Navigator & { gpu?: Gpu }).gpu;

let gen: Promise<Model> | null = null;
let ready: Model | null = null;
let loads = 0;                                                         // counts loads and unloads, so a load that finishes after an unload knows it is stale
let queue: Promise<unknown> = Promise.resolve();                       // one answer at a time: the model can't run two at once

export const supported = () => !!gpu();

// Loads the model (from the cache when it was downloaded before). `onProgress` gets 0-100 while files download.
export function load(onProgress: (percent: number) => void): Promise<void> {
  if (!gen) {
    const id = ++loads;
    const p = (async () => {
      const adapter = await gpu()?.requestAdapter();
      if (!adapter) throw new Error('no WebGPU adapter');
      const { pipeline } = await import('@huggingface/transformers');   // a separate chunk: the map never downloads it unless Gemma is on
      const g = await pipeline('text-generation', GEMMA_MODEL, {
        device: 'webgpu',
        dtype: adapter.features.has('shader-f16') ? 'q4f16' : 'q4',     // half-precision maths where the GPU has it (smaller, faster), else full
        progress_callback: (e) => { if (e.status === 'progress_total') onProgress(Math.floor(e.progress)); },
      }) as unknown as Model;
      if (id !== loads) { await g.dispose(); throw new Error('switched off while loading'); }
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
  const run = queue.then(async () => {
    const out = await model(chat, { max_new_tokens: 40, do_sample: true, temperature: 0.7, top_k: 64, top_p: 0.95 }) as { generated_text: { content: string }[] }[];
    return out[0].generated_text.at(-1)?.content ?? null;
  });
  queue = run.catch(() => {});
  return run;
}
