// Discovered places on the map: a tappable gold pin per place, shown only once its spot has been cleared.
import L from 'leaflet';
import { map, calm } from './map.ts';
import { groupOf, typeLabel, type Group, type Place } from './places.ts';
import { ICONS, discHtml } from './icons.ts';

// The icon box is 28 px (a finger-sized tap target); the gold disc inside it is drawn by CSS.
const icons = Object.fromEntries((Object.keys(ICONS) as Group[]).map((g) => [g, L.divIcon({ className: `place-pin ${g}`, iconSize: [28, 28], html: discHtml(g) })])) as Record<Group, L.DivIcon>;
const markers = new Map<Place, L.Marker>();

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
  markers.set(p, marker);
  if (fresh) {
    const el = marker.getElement()!;
    el.classList.add('is-new');
    el.addEventListener('animationend', () => el.classList.remove('is-new'), { once: true });
  }
}

// Brings a found place into view and opens its name, as if it had been tapped. Returns whether the map moved to do it.
// The name opens only once the map has arrived: a popup opened mid-pan would pan the map again to fit itself and stop it short.
let pending: (() => void) | null = null;
export function focusPlace(p: Place): boolean {
  const m = markers.get(p);
  if (!m) return false;
  if (pending) map.off('moveend', pending);                              // an earlier tap's wait is over: this one replaces it
  pending = null;
  const target = m.getLatLng();
  if (map.getCenter().distanceTo(target) < 1) { m.openPopup(); return false; }   // already there
  map.panTo(target, { animate: !calm });
  // After panTo, not before: starting a pan stops any pan already running, and that stop fires "moveend" too, which must not count as arriving.
  if (map.getCenter().distanceTo(target) < 1) { m.openPopup(); return true; }    // the map jumped (no animation): already there
  pending = () => { pending = null; m.openPopup(); };
  map.once('moveend', pending);
  return true;
}
