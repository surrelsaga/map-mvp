// The quest spot on the map: one marker for the active reach quest, shown through the fog. DOM/Leaflet only.
import L from 'leaflet';
import { map } from './map.ts';
import { questHtml } from './icons.ts';
import type { LatLng } from './types.ts';

// divIcon, not the default marker: bundled Leaflet can't find its marker image. The box is 32 px, a finger-sized tap target.
const icon = L.divIcon({ className: 'quest-pin', iconSize: [32, 32], html: questHtml() });
let marker: L.Marker | null = null;

// `text` is asked when the popup opens, so it can say how far away the spot is right now.
export function show(at: LatLng, text: () => string) {
  clear();
  marker = L.marker([at.lat, at.lng], { icon, pane: 'quest', title: 'Quest spot' })
    .bindPopup(() => { const el = document.createElement('strong'); el.textContent = text(); return el; }, { closeButton: false, offset: [0, -6] })
    .addTo(map);
}

export function clear() { marker?.remove(); marker = null; }
