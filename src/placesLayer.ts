// Discovered places on the map: a tappable gold pin per place, shown only once its spot has been cleared.
import L from 'leaflet';
import { map } from './map.ts';
import { groupOf, typeLabel, type Group, type Place } from './places.ts';

// Simple line icons, one per kind of place. Static markup only: names never go into HTML.
const ICONS: Record<Group, string> = {
  food: '<path d="M6 3v5a3 3 0 0 0 6 0V3M9 11v10M17 21V3c-2 1.5-3 4-3 7s1 4 3 4"/>',
  shop: '<path d="M5 8h14l-1 12H6L5 8zM9 8a3 3 0 0 1 6 0"/>',
  outdoors: '<path d="M12 21v-6M12 3l6 8h-3l4 6H5l4-6H6l6-8z"/>',
  other: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3.1 9.5l6.1-.9z"/>',
};
// The icon box is 28 px (a finger-sized tap target); the gold disc inside it is drawn by CSS.
const icons = Object.fromEntries((Object.keys(ICONS) as Group[]).map((g) => [g, L.divIcon({
  className: `place-pin ${g}`,
  iconSize: [28, 28],
  html: `<span class="place-disc"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[g]}</svg></span>`,
})])) as Record<Group, L.DivIcon>;

// `fresh`: found just now, so it gets the one gold pulse (places restored from an earlier session just appear).
export function addPlace(p: Place, fresh = false) {
  const name = document.createElement('strong');
  name.textContent = p.name;
  const type = document.createElement('span');
  type.textContent = typeLabel(p.type);
  const content = document.createElement('div');
  content.append(name, type);
  const marker = L.marker([p.lat, p.lng], { icon: icons[groupOf(p.type)], pane: 'places', title: p.name })
    .bindPopup(content, { closeButton: false, offset: [0, -6] })
    .addTo(map);
  if (fresh) {
    const el = marker.getElement()!;
    el.classList.add('is-new');
    el.addEventListener('animationend', () => el.classList.remove('is-new'), { once: true });
  }
}
