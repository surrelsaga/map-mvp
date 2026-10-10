// The quest spot on the map: one marker for the active reach quest, shown through the fog. DOM/Leaflet only.
import L from 'leaflet';
import { map } from './map.ts';
import { questHtml } from './icons.ts';
import { bearing } from './questText.ts';
import type { LatLng } from './types.ts';

// divIcon, not the default marker: bundled Leaflet can't find its marker image. The box is 32 px, a finger-sized tap target.
const icon = L.divIcon({ className: 'quest-pin', iconSize: [32, 32], html: questHtml() });
let marker: L.Marker | null = null;

// `text` is asked when the popup opens, so it can say how far away the spot is right now. Showing the same spot again keeps the marker (and an open popup).
export function show(at: LatLng, text: () => string) {
  if (marker?.getLatLng().equals([at.lat, at.lng])) return;
  clear();
  marker = L.marker([at.lat, at.lng], { icon, pane: 'quest', title: 'Quest spot' })
    .bindPopup(() => { const el = document.createElement('strong'); el.textContent = text(); return el; }, { closeButton: false, offset: [0, -6] })
    .addTo(map);
}

export function clear() { marker?.remove(); marker = null; }

// The wisp: a small floating light that leads you once you have tried (the quest gives it, see quests.track). It sits just outside your cleared patch, on the
// side the spot lies, with its tail back at you. Close to the spot it leaves your side and circles over the spot's area: an off-centre ring, not the exact point.
// A light, not an arrow, and pale, not gold (gold means discovered).
const OFFSET_M = 62, AREA_M = 40, SHIFT_M = 15;   // 62 m: just outside the patch your steps clear, where a pale light shows against the fog
const offsetPx = (lat: number) => Math.max(40, Math.min(110, OFFSET_M / ((40075017 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** map.getZoom()))));   // that distance in pixels at this zoom, kept in a sensible range
let turned = 0;                                                          // the wisp's rotation so far (degrees, not wrapped): it turns the short way, never the long way round
const wispIcon = L.divIcon({                                             // colours are in style.css (.wisp ...): one source of truth for the palette
  className: 'wisp', iconSize: [48, 48], iconAnchor: [24, 18],
  html: '<div class="wisp-turn"><div class="wisp-drift"><svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">'
    + '<defs><radialGradient id="wispGlow"><stop class="w-core" offset="0"/><stop class="w-glow" offset="0.45"/><stop class="w-glow" offset="1" stop-opacity="0"/></radialGradient>'
    + '<linearGradient id="wispTail" x1="0" y1="0" x2="0" y2="1"><stop class="w-glow" offset="0" stop-opacity="0.85"/><stop class="w-glow" offset="1" stop-opacity="0"/></linearGradient></defs>'
    + '<path d="M20 20 Q24 46 28 20Z" fill="url(#wispTail)"/><circle cx="24" cy="18" r="11" fill="url(#wispGlow)"/><circle class="w-orb" cx="24" cy="18" r="5"/></svg></div></div>',
});
type Wisp = { me: LatLng; target: LatLng; close: boolean; seq: number };
let wisp: L.Marker | null = null, area: L.Circle | null = null, shown: Wisp | null = null;

// null takes it away. Called with every fix, so it follows you; also redone when the zoom changes (its offset is in screen pixels).
export function setWisp(w: Wisp | null) {
  shown = w;
  if (!w) { wisp?.remove(); wisp = null; area?.remove(); area = null; return; }
  const b = bearing(w.me, w.target);
  let at: L.LatLng;
  if (w.close) {                                                          // over the area, off-centre: where is a small search, not a pin
    const a = ((w.seq * 137) % 360) * Math.PI / 180, lat = w.target.lat + (SHIFT_M * Math.cos(a)) / 111195;
    at = L.latLng(lat, w.target.lng + (SHIFT_M * Math.sin(a)) / (111195 * Math.cos((lat * Math.PI) / 180)));
  } else {
    const r = (b * Math.PI) / 180, p = map.latLngToLayerPoint([w.me.lat, w.me.lng]).add([Math.sin(r) * offsetPx(w.me.lat), -Math.cos(r) * offsetPx(w.me.lat)]);
    at = map.layerPointToLatLng(p);
  }
  if (!wisp) wisp = L.marker(at, { icon: wispIcon, pane: 'wisp', interactive: false, keyboard: false }).addTo(map);
  else wisp.setLatLng(at);
  const el = wisp.getElement();
  if (el) {
    const want = w.close ? 0 : b, delta = ((((want - (turned % 360)) % 360) + 540) % 360) - 180;   // the shortest way round, -180..180
    turned += delta;
    el.classList.toggle('is-close', w.close);
    (el.querySelector('.wisp-turn') as HTMLElement).style.transform = `rotate(${Math.round(turned)}deg)`;
  }
  if (w.close) {
    if (!area) area = L.circle(at, { radius: AREA_M, pane: 'wisp', interactive: false, className: 'wisp-area', weight: 2, dashArray: '4 8', fill: false }).addTo(map);
    else area.setLatLng(at);
  } else if (area) { area.remove(); area = null; }
}
map.on('zoomend', () => { if (shown) setWisp(shown); });
