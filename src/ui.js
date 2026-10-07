// The page's DOM bits: status message, recentre button, debug badge. No map or GPS knowledge.
const $ = (id) => document.getElementById(id);

export const say = (msg) => { $('status').textContent = msg; };
export const showRecentre = (on) => { $('recentre').style.display = on ? 'block' : 'none'; };
export const onRecentre = (fn) => { $('recentre').onclick = fn; };
export const showDebugBadge = () =>
  document.body.insertAdjacentHTML('beforeend', '<div id="debug">DEBUG: tap to walk</div>');   // so a simulated position is never mistaken for GPS
