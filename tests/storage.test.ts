// Part of `npm test`. The storage logic that runs without a browser: encode/decode and the saver (with a stubbed localStorage).
/// <reference types="node" />
import assert from 'node:assert';
import { encode, decode, createSaver, storeKey } from '../src/storage.ts';
import { key, cellOf } from '../src/fog.ts';

const keys = [cellOf(1.3413, 103.9638), cellOf(1.3414, 103.9639), cellOf(-33.86, 151.2)].map(([i, j]) => key(i, j));

// ---- encode / decode
assert.deepEqual(decode(encode(keys)), keys, 'what is saved comes back');
assert.deepEqual(decode(encode([])), [], 'empty set round-trips');
assert.deepEqual(decode(null), [], 'null (first run)');
assert.deepEqual(decode(''), [], 'empty string');
for (const bad of ['{', 'not json', '[]', '"x"', 'null', '123', '{}', '{"keys":"x"}', '{"keys":{}}'])
  assert.deepEqual(decode(bad), [], `rejects ${bad}`);
assert.deepEqual(decode(JSON.stringify({ keys: [...keys, null, 'a', 1.5, NaN, Infinity, 2 ** 60, {}, [1]] })), keys, 'only safe integers survive');
const big = Array.from({ length: 100_000 }, (_, n) => key(13413 + (n % 400), 1039638 + Math.floor(n / 400)));
assert(encode(big).length < 2_000_000, '100k cells is about 1.2 MB, well under the ~5 MB localStorage limit');
assert.equal(decode(encode(big)).length, 100_000);

// ---- the key names data by format version and CELL, and keeps debug apart
assert.equal(storeKey(false), 'fogwalk:v1:0.0001');
assert.equal(storeKey(true), 'fogwalk:v1:0.0001:debug');

// ---- the saver, against a fake browser
const store = new Map<string, string>();
let setCalls = 0, failWrites = false;
const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
define('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { if (failWrites) throw new Error('QuotaExceededError'); setCalls++; store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});
let onPageHide: () => void = () => {}, onVisibility: () => void = () => {};
const doc = { visibilityState: 'visible', addEventListener: (_: string, fn: () => void) => { onVisibility = fn; } };
define('document', doc);
define('addEventListener', (_: string, fn: () => void) => { onPageHide = fn; });
const realWarn = console.warn; console.warn = () => {};          // the failed-write case logs a warning on purpose
const saved = (k: string) => decode(store.get(k) ?? null);
const reset = () => { store.clear(); setCalls = 0; failWrites = false; doc.visibilityState = 'visible'; };

reset();                                                        // closing the page writes pending cells at once
let live = [1, 2, 3];
let s = createSaver('k', () => live);
s.schedule(); assert.deepEqual(saved('k'), [], 'nothing written yet (debounced)');
onPageHide(); assert.deepEqual(saved('k'), [1, 2, 3], 'pagehide flushes');
onPageHide(); assert.equal(setCalls, 1, 'nothing new to save, so no second write');

reset();                                                        // hiding the tab flushes; showing it does not
live = [1]; s = createSaver('k', () => live);
s.schedule(); onVisibility(); assert.deepEqual(saved('k'), [], 'visible does not flush');
doc.visibilityState = 'hidden'; onVisibility(); assert.deepEqual(saved('k'), [1], 'hidden flushes');

reset();                                                        // a second tab holding older cells can't wipe newer ones
store.set('k', encode([10, 11, 12]));
live = [12, 13]; s = createSaver('k', () => live);
s.schedule(); onPageHide();
assert.deepEqual(saved('k').sort(), [10, 11, 12, 13], 'merged with what is already stored');

reset();                                                        // a failed write is retried, not forgotten
live = [5]; s = createSaver('k', () => live);
failWrites = true; s.schedule(); onPageHide();
assert.deepEqual(saved('k'), [], 'quota error: nothing stored');
failWrites = false; onPageHide();
assert.deepEqual(saved('k'), [5], 'next flush retries and succeeds');

reset();                                                        // stop() is permanent
live = [7]; s = createSaver('k', () => live);
s.schedule(); s.stop(); onPageHide(); assert.deepEqual(saved('k'), [], 'a pending save is dropped');
s.schedule(); onPageHide(); onVisibility(); assert.deepEqual(saved('k'), [], 'and later ones too');

console.warn = realWarn;
console.log('ok');
