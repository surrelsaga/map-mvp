// The page's DOM bits: status message, recentre button, debug badge. No map or GPS knowledge.
const $ = (id: string) => document.getElementById(id)!;

export const say = (msg: string) => { if ($('status').textContent !== msg) $('status').textContent = msg; };   // unchanged text isn't rewritten, so screen readers don't repeat it
export const showRecentre = (on: boolean) => { $('recentre').style.display = on ? 'block' : 'none'; };
export const onRecentre = (fn: () => void) => { $('recentre').onclick = fn; };
export const showDebugBadge = () =>
  document.body.insertAdjacentHTML('beforeend', '<div id="debug">DEBUG: tap to walk</div>');   // so a simulated position is never mistaken for GPS
