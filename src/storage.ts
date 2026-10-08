// Saved progress: the cleared cells live in localStorage, on this device only.
// The storage key carries the format version and the CELL size (see storeKey), so changing either leaves old data untouched
// under its own key instead of overwriting it. The stored value is { keys: number[] }.
// encode/decode are pure (Node-testable); the rest touches the browser.
import { CELL, SAVE_DELAY_MS, STORE_KEY } from './config.ts';

// ponytail: plain JSON of numeric keys, ~12 bytes per cell, so the ~5 MB localStorage limit holds about 400k cells (~50 km² of walking).
// Each save re-serialises the whole set. Move to IndexedDB (or per-tile chunks) if that ever fills or janks.

export const storeKey = (debug: boolean) => `${STORE_KEY}:${CELL}${debug ? ':debug' : ''}`;

export const encode = (keys: number[]) => JSON.stringify({ keys });

// Anything missing, corrupted or not shaped like our data gives [].
export function decode(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data?.keys) ? data.keys.filter(Number.isSafeInteger) : [];
  } catch { return []; }
}

// localStorage can throw (blocked cookies, private mode, full), so none of this may break the app.
export function readFog(key: string): number[] {
  try { return decode(localStorage.getItem(key)); } catch { return []; }
}
export function writeFog(key: string, keys: number[]): boolean {
  try { localStorage.setItem(key, encode(keys)); return true; } catch (e) { console.warn('Could not save fog progress', e); return false; }
}
export function clearFog(key: string) {
  try { localStorage.removeItem(key); } catch { /* nothing to clear */ }
}

// Debounced saver. schedule() after cells clear: the write happens SAVE_DELAY_MS later, or at once when the page is hidden or closed
// (phones often kill a backgrounded page without warning). Each write is merged with what is already stored, so a second tab
// holding older cells can't wipe this one's. A failed write keeps the data marked unsaved, so the next schedule/hide/close retries.
// stop() disables the saver for good (used before a reset, so a late save can't bring the fog back).
export function createSaver(key: string, snapshot: () => number[]) {
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let dirty = false, stopped = false;
  const write = () => {
    timer = 0;
    if (!dirty || stopped) return;
    if (writeFog(key, [...new Set([...readFog(key), ...snapshot()])])) dirty = false;
  };
  const flush = () => { if (timer) clearTimeout(timer); write(); };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  return {
    schedule() { if (stopped) return; dirty = true; if (!timer) timer = setTimeout(write, SAVE_DELAY_MS); },
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = 0; },
  };
}
