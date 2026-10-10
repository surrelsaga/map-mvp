// Places to discover (from OpenStreetMap, shipped as public/places.json). Pure logic: no DOM, no Leaflet, so Node can test it.
import type { LatLng } from './types.ts';

// id = the OpenStreetMap object ("node/123"): stable, so quests can refer to a place.
// fame = why it is well known: a Michelin award, or its own Wikipedia/Wikidata entry (never a chain's brand entry). Absent for most places.
export type Fame = 'michelin' | 'wiki';
export interface Place extends LatLng { name: string; type: string; id?: string; fame?: Fame }

const MAX_NAME = 80;
// Control characters become a space ("A\nB" stays two words). Invisible formatting characters are dropped: direction marks and overrides
// (U+202E and friends) can reorder the text around a name, and zero-width, soft-hyphen and tag characters can hide in it.
// Written as \u escapes on purpose: raw invisible characters in source vanish silently when an editor or formatter strips them.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028-\u2029]+/g;
const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/gu;

// The file is ours, but treat it as untrusted: keep only well-formed entries. Names are plain text and must only ever reach the page as text.
export function parsePlaces(raw: unknown): Place[] {
  const list = (raw as { places?: unknown } | null)?.places;
  if (!Array.isArray(list)) return [];
  const out: Place[] = [];
  for (const p of list) {
    const name = typeof p?.name === 'string' ? Array.from(p.name.replace(CONTROL, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()).slice(0, MAX_NAME).join('') : '';   // Array.from: never cut a character in half
    const { lat, lng } = p ?? {};
    if (name && typeof p.type === 'string' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
      out.push({ name, type: p.type, lat, lng, ...(typeof p.id === 'string' && { id: p.id.slice(0, 40) }), ...((p.fame === 'michelin' || p.fame === 'wiki') && { fame: p.fame as Fame }) });
  }
  return out;
}

// Marks every place whose spot is now cleared as found (by index into `places`) and returns the newly found ones.
export function discover(places: Place[], found: Set<number>, isRevealed: (lat: number, lng: number) => boolean): Place[] {
  const fresh: Place[] = [];
  places.forEach((p, i) => {
    if (!found.has(i) && isRevealed(p.lat, p.lng)) { found.add(i); fresh.push(p); }
  });
  return fresh;
}

// What the toast says: "Found A", "Found 2 places: A and B", "Found 5 places: A, B and 3 more". Chains repeat names, so equal names are counted: "7-Eleven ×2".
export function foundMessage(found: Place[]): string {
  if (!found.length) return '';
  if (found.length === 1) return `Found ${found[0].name}`;
  const groups = new Map<string, number>();
  for (const p of found) groups.set(p.name, (groups.get(p.name) ?? 0) + 1);
  const shown = [...groups].slice(0, 2);
  const label = ([name, n]: [string, number]) => (n > 1 ? `${name} ×${n}` : name);
  const more = found.length - shown.reduce((sum, [, n]) => sum + n, 0);
  const text = shown.map(label);
  return `Found ${found.length} places: ` + (more ? `${text.join(', ')} and ${more} more` : text.join(' and '));
}

// OpenStreetMap values in plain words: "fast_food" -> "Fast food".
const ACRONYMS = new Map([['atm', 'ATM']]);                              // a Map: a plain object would answer to names like "constructor"
export function typeLabel(type: string): string {
  const words = type.replace(/_/g, ' ').trim();
  return ACRONYMS.get(words) ?? words.charAt(0).toUpperCase() + words.slice(1);
}

// A place's identity across visits and tabs: its OpenStreetMap id when it has one.
export const placeKey = (p: Place) => p.id ?? `${p.name}|${p.lat}|${p.lng}`;

// Four kinds of pin. The data only keeps the value (not whether it was a shop or an amenity), so these are lists of values; anything unknown is "other".
export type Group = 'food' | 'shop' | 'outdoors' | 'other';
const GROUPS: Record<Exclude<Group, 'other'>, Set<string>> = {
  food: new Set(['restaurant', 'cafe', 'fast_food', 'food_court', 'bar', 'pub', 'bakery', 'ice_cream', 'coffee', 'beverages', 'confectionery', 'biergarten', 'deli', 'pastry', 'tea', 'juice_bar', 'seafood', 'butcher', 'greengrocer']),
  shop: new Set(['convenience', 'supermarket', 'clothes', 'shoes', 'variety_store', 'mall', 'department_store', 'electronics', 'computer', 'mobile_phone', 'books', 'florist', 'cosmetics', 'furniture', 'hairdresser', 'pet', 'watches', 'general', 'kiosk', 'beauty', 'gift', 'jewelry', 'optician', 'stationery', 'toys', 'sports', 'bicycle', 'chemist', 'massage', 'laundry', 'dry_cleaning', 'copyshop', 'tailor', 'bag', 'hardware', 'art', 'craft', 'pharmacy', 'bank', 'atm', 'car_repair', 'storage_rental', 'second_hand']),
  outdoors: new Set(['park', 'playground', 'garden', 'golf_course', 'sports_centre', 'fitness_centre', 'nature_reserve', 'recreation_ground', 'pitch', 'swimming_pool', 'water_park', 'dog_park', 'fitness_station', 'marina', 'stadium', 'miniature_golf', 'amusement_arcade', 'attraction', 'viewpoint', 'picnic_site', 'zoo', 'theme_park']),
};
const groupCache = new Map<string, Group>();                              // refreshed on every cleared fix, so each type is looked up once
export function groupOf(type: string): Group {
  let g = groupCache.get(type);
  if (!g) {
    g = 'other';
    for (const [group, values] of Object.entries(GROUPS)) if (values.has(type)) g = group as Group;
    groupCache.set(type, g);
  }
  return g;
}

// How many places of each kind exist, and how many of those are found (`found` holds indexes into `places`).
export function countsByGroup(places: Place[], found: Set<number>): Record<Group, { found: number; total: number }> {
  const out: Record<Group, { found: number; total: number }> = { food: { found: 0, total: 0 }, shop: { found: 0, total: 0 }, outdoors: { found: 0, total: 0 }, other: { found: 0, total: 0 } };
  places.forEach((p, i) => { const c = out[groupOf(p.type)]; c.total++; if (found.has(i)) c.found++; });
  return out;
}
