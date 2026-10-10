// Regions: the 2 km circle of places around where you are. One region is current; the last few are kept on the phone.
// A region's centre is your fix rounded to a coarse grid (REGION_ROUND), so the same few spots come up again and again (the kept regions get reused)
// and the server is only ever told that rounded point. Walk further than REANCHOR_M from the centre and a new region is loaded around you.
// Pure logic plus a small store, so Node can test it.
import { dist } from './fog.ts';
import { parsePlaces, type Place } from './places.ts';
import { REGION_ROUND, REANCHOR_M, REGION_KEEP, REGION_KEY, REGION_MAX_CHARS, SUTD } from './config.ts';
import type { LatLng } from './types.ts';

export interface Region { center: LatLng; fetched: string; places: Place[] }

// The fix on the REGION_ROUND grid. Rounded here, in the app, before anything is sent anywhere. (+x.toFixed(6) tidies float noise: 0.005 * 271 is not exactly 1.355.)
export const roundCentre = ({ lat, lng }: LatLng): LatLng => ({ lat: +(Math.round(lat / REGION_ROUND) * REGION_ROUND).toFixed(6), lng: +(Math.round(lng / REGION_ROUND) * REGION_ROUND).toFixed(6) });

const SEED: LatLng = { lat: SUTD[0], lng: SUTD[1] };

// What to do with a new fix. `current` is the region on screen (may be null), `kept` the stored ones (most recent first).
// The shipped SUTD file is not stored: it is always read from the file, so it is its own answer ('seed') when you are near SUTD.
export type Pick = { kind: 'stay' } | { kind: 'use'; region: Region } | { kind: 'seed' } | { kind: 'fetch'; center: LatLng };
export function pickRegion(fix: LatLng, current: Region | null, kept: Region[]): Pick {
  if (current && dist(fix, current.center) <= REANCHOR_M) return { kind: 'stay' };
  const near = kept.find((r) => dist(fix, r.center) <= REANCHOR_M);
  if (near) return { kind: 'use', region: near };
  if (dist(fix, SEED) <= REANCHOR_M) return { kind: 'seed' };
  return { kind: 'fetch', center: roundCentre(fix) };
}

// The shipped public/places.json: always the SUTD region, so its own `center` is not needed (a file without one still works).
export const parseSeed = (raw: unknown): Region | null => parseRegion(raw && typeof raw === 'object' ? { ...raw, center: SEED } : null);

const same = (a: LatLng, b: LatLng) => a.lat === b.lat && a.lng === b.lng;
// `region` goes first; an older entry for the same centre is replaced; only REGION_KEEP stay.
export const keep = (kept: Region[], region: Region): Region[] => [region, ...kept.filter((r) => !same(r.center, region.center))].slice(0, REGION_KEEP);

// A region from the shipped file, the server, or storage. All three are untrusted: null if the centre is not a real point.
export function parseRegion(raw: unknown): Region | null {
  const r = raw as { center?: Partial<LatLng>; fetched?: unknown; places?: unknown } | null;
  const { lat, lng } = r?.center ?? {};
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (!Array.isArray(r?.places)) return null;
  return { center: { lat, lng }, fetched: typeof r?.fetched === 'string' ? r.fetched.slice(0, 10) : '', places: parsePlaces(r) };
}

export const regionStoreKey = (debug: boolean) => REGION_KEY + (debug ? ':debug' : '');

// localStorage can throw (blocked, private mode, full): then regions are simply not remembered.
export function readRegions(key: string): Region[] {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? 'null')?.regions;
    return Array.isArray(list) ? list.map(parseRegion).filter((r): r is Region => r !== null).slice(0, REGION_KEEP) : [];
  } catch { return []; }
}
// Oldest regions go first until what is stored fits REGION_MAX_CHARS. If even the newest is too big alone, nothing is written (it stays in memory for this visit; what was stored stays).
export function writeRegions(key: string, regions: Region[]) {
  let n = regions.length, text = JSON.stringify({ regions });
  while (text.length > REGION_MAX_CHARS && n > 0) text = JSON.stringify({ regions: regions.slice(0, --n) });
  if (!n) return;
  try { localStorage.setItem(key, text); } catch (e) { console.warn('Could not save regions', e); }
}
