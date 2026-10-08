// Position source #2: tap the map and the dot walks there at walking pace. Test without leaving the desk.
import type L from 'leaflet';
import { SUTD, WALK_SPEED, DEBUG_TICK_MS, DEBUG_ACCURACY } from './config.ts';
import type { Fix } from './types.ts';

export function startDebugWalk(map: L.Map, where: () => Fix | null, onFix: (fix: Fix) => void, multiplier: number) {
  const speed = WALK_SPEED * (Math.abs(multiplier) || 1);
  let target: L.LatLng | null = null, last = performance.now();
  onFix({ lat: SUTD[0], lng: SUTD[1], accuracy: DEBUG_ACCURACY });
  map.on('click', (e) => { target = e.latlng; });
  setInterval(() => {
    const now = performance.now(), dt = (now - last) / 1000; last = now;   // real elapsed time, so throttled tabs don't slow the walk
    const me = where();
    if (!target || !me) return;
    const d = map.distance(me, target), step = speed * dt;
    const f = d ? Math.min(1, step / d) : 1;
    onFix({ lat: me.lat + (target.lat - me.lat) * f, lng: me.lng + (target.lng - me.lng) * f, accuracy: DEBUG_ACCURACY });
    if (f === 1) target = null;
  }, DEBUG_TICK_MS);
}
