// The page's DOM bits: status message, recentre button, debug badge. No map or GPS knowledge.
import { TOAST_MS } from './config.ts';

const $ = (id: string) => document.getElementById(id)!;

export const say = (msg: string) => { if ($('status').textContent !== msg) $('status').textContent = msg; };   // unchanged text isn't rewritten, so screen readers don't repeat it
export const showRecentre = (on: boolean) => { $('recentre').style.display = on ? 'block' : 'none'; };
export const onRecentre = (fn: () => void) => { $('recentre').onclick = fn; };
export function showDebugBadge(onReset: () => void) {   // so a simulated position is never mistaken for GPS
  document.body.insertAdjacentHTML('beforeend', '<div id="debug">DEBUG: tap to walk <button id="debugReset">reset fog</button></div>');
  $('debugReset').onclick = onReset;
}

// A short message that fades after TOAST_MS ("Found SUTD Canteen" with its type underneath). Separate from `say`, which is for lasting state like GPS problems.
let toastTimer: ReturnType<typeof setTimeout> | 0 = 0;
export function toast(title: string, detail = '') {
  $('toastTitle').textContent = title;
  $('toastDetail').textContent = detail;
  $('toast').classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').classList.remove('show');
    toastTimer = setTimeout(() => { $('toastTitle').textContent = ''; $('toastDetail').textContent = ''; }, 400);   // after the fade: empty again, so a stale message isn't left for screen readers and the next one is a change
  }, TOAST_MS);
}
