// "Where am I": the player's dot, accuracy ring, last fix, and camera-follow state.
import { SUTD } from './config.js';
import { map } from './map.js';
import { showRecentre, onRecentre } from './ui.js';

const ring = L.circle(SUTD, { radius: 0, weight: 1, color: '#2a7de1', fillOpacity: 0.1, interactive: false });
const dot = L.circleMarker(SUTD, { radius: 8, weight: 3, color: '#fff', fillColor: '#2a7de1', fillOpacity: 1, interactive: false });
let me = null;          // last fix {lat, lng, accuracy}; null until the first one
let following = true;

export const where = () => me && { ...me };           // a copy, so callers can't edit the player's state

export function update({ lat, lng, accuracy }) {
  const first = !me;
  me = { lat, lng, accuracy };
  ring.setLatLng(me).setRadius(accuracy);
  dot.setLatLng(me);
  if (first) { ring.addTo(map); dot.addTo(map); }
  if (following) map.panTo(me);                       // keeps the user's zoom; a map they dragged away stays put
}

map.on('dragstart', () => { following = false; showRecentre(true); });
onRecentre(() => { following = true; showRecentre(false); if (me) map.panTo(me); });
