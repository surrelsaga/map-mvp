// Places to discover (from OpenStreetMap, shipped as public/places.json). Pure logic: no DOM, no Leaflet, so Node can test it.
import type { LatLng } from './types.ts';

export interface Place extends LatLng { name: string; type: string; id?: string }   // id = the OpenStreetMap object ("node/123"): stable, so quests can refer to a place

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
      out.push({ name, type: p.type, lat, lng, ...(typeof p.id === 'string' && { id: p.id.slice(0, 40) }) });
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

// What the toast says: "Found: A", "Found: A and B", "Found: A, B and 3 more". Chains repeat names, so equal names are counted: "7-Eleven ×2".
export function foundMessage(found: Place[]): string {
  const groups = new Map<string, number>();
  for (const p of found) groups.set(p.name, (groups.get(p.name) ?? 0) + 1);
  const shown = [...groups].slice(0, 2);
  if (!shown.length) return '';
  const label = ([name, n]: [string, number]) => (n > 1 ? `${name} ×${n}` : name);
  const more = found.length - shown.reduce((sum, [, n]) => sum + n, 0);
  const text = shown.map(label);
  return 'Found: ' + (more ? `${text.join(', ')} and ${more} more` : text.join(' and '));
}
