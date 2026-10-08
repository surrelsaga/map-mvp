// "Where am I": the player's dot, accuracy ring, last fix, and camera-follow state.
import L from 'leaflet';
import { SUTD, STALE_GPS_MS } from './config.ts';
import { map, calm } from './map.ts';
import { color } from './theme.ts';
import { showRecentre, onRecentre } from './ui.ts';
import type { Fix } from './types.ts';

// The dot is the familiar maps blue (so you find yourself at a glance). With no GPS it is dimmed: a grey dot with a dark outline,
// which shows on the pale map and on the dark fog alike.
const LIVE = { dot: { color: '#fff', fillColor: color('--you'), fillOpacity: 1 }, ring: { color: color('--you'), opacity: 1, fillOpacity: 0.1 } };
const STALE = { dot: { color: color('--panel'), fillColor: color('--dusk'), fillOpacity: 1 }, ring: { color: color('--dusk'), opacity: 0, fillOpacity: 0 } };
const ring = L.circle(SUTD, { pane: 'player', radius: 0, weight: 1, ...LIVE.ring, interactive: false });
const dot = L.circleMarker(SUTD, { pane: 'player', radius: 8, weight: 3, ...LIVE.dot, interactive: false });
let me: Fix | null = null;          // last fix; null until the first one
let following = true;
let lastFixAt = 0;
let stale = false;
let onStaleChange: (stale: boolean) => void = () => {};

function setStale(value: boolean) {
  if (value === stale) return;
  stale = value;
  dot.setStyle(stale ? STALE.dot : LIVE.dot);
  ring.setStyle(stale ? STALE.ring : LIVE.ring);
  onStaleChange(stale);
}

// Real GPS only (a simulated walk has no signal to lose). When fixes stop arriving, `probe` asks the device for one position: if one
// comes back (you were just standing still, or the tab was asleep) all is well; only if that fails too is the signal called lost.
// While the signal is lost it asks again only every STALE_GPS_MS (a high-accuracy request every few seconds would drain the battery in a tunnel).
export function watchStale(onChange: (stale: boolean) => void, probe: () => Promise<boolean>) {
  onStaleChange = onChange;
  let probing = false, lastProbe = -Infinity;
  setInterval(async () => {
    const now = performance.now();
    if (!me || probing || now - lastFixAt <= STALE_GPS_MS || (stale && now - lastProbe < STALE_GPS_MS)) return;
    probing = true; lastProbe = now;
    try {
      const answered = await probe();
      if (!answered && performance.now() - lastFixAt > STALE_GPS_MS) setStale(true);   // a real fix may have arrived while we waited
    } finally { probing = false; }
  }, 5000);
}

export const where = (): Fix | null => me && { ...me };           // a copy, so callers can't edit the player's state

export function update({ lat, lng, accuracy }: Fix) {
  const first = !me;
  me = { lat, lng, accuracy };
  lastFixAt = performance.now();
  setStale(false);
  ring.setLatLng(me).setRadius(accuracy);
  dot.setLatLng(me);
  if (first) { ring.addTo(map); dot.addTo(map); }
  if (following) map.panTo(me, { animate: !calm });  // keeps the user's zoom; a map they dragged away stays put
}

// Following stops when you move the map yourself, or when something else takes it somewhere (the stats card's "Last" row).
export function stopFollowing() { following = false; showRecentre(true); }
map.on('dragstart', stopFollowing);
onRecentre(() => { following = true; showRecentre(false); if (me) map.panTo(me, { animate: !calm }); });
