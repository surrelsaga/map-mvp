// Discovered places on the map: a tappable pin per place, shown only once its spot has been cleared.
import L from 'leaflet';
import { map } from './map.ts';
import type { Place } from './places.ts';

// Plain DOM, no image files (the bundled Leaflet can't find its default marker icon). The name is set as text, never as HTML.
const icon = L.divIcon({ className: 'place-pin', iconSize: [28, 28] });   // 28 px box = finger-sized tap target; the dot is drawn by CSS

export function addPlace(p: Place) {
  const name = document.createElement('div');
  name.textContent = p.name;
  L.marker([p.lat, p.lng], { icon, pane: 'places', title: p.name })
    .bindPopup(name, { closeButton: false, offset: [0, -6] })
    .addTo(map);
}
