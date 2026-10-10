// Asking OpenStreetMap (the Overpass API) for the named places around a centre. No DOM, so Node can run it.
// The app never calls Overpass itself: server/places.ts and tools/fetch-places.mjs do, and both use this one copy.
// Data (c) OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).
import { dist } from './fog.ts';
import type { Place } from './places.ts';
import type { LatLng } from './types.ts';

const KINDS = ['amenity', 'shop', 'leisure', 'tourism', 'historic'];
// Named things that aren't worth "discovering": parking, benches, toilets, shelters and similar street furniture.
const SKIP = new Set(['parking', 'parking_space', 'parking_entrance', 'bicycle_parking', 'motorcycle_parking', 'bench', 'waste_basket', 'waste_disposal',
  'toilets', 'shelter', 'bicycle_rental', 'vending_machine', 'recycling', 'post_box', 'telephone', 'drinking_water', 'fountain', 'taxi',
  'loading_dock', 'grit_bin', 'bbq', 'picnic_table', 'swimming_pool', 'pitch', 'track', 'fitness_station', 'dog_park', 'slipway',
  'park_connector']);                                 // park connectors are long paths split into many segments, not a place
// Public servers go down (all but one did while this was being built), so there are three. The first that gives a usable answer wins.
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
// Overpass rejects anonymous clients (406): identify ourselves.
const HEADERS = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': 'fog-walk-map/0.1 (https://github.com/surrelsaga/map-mvp; places for a walking game)' };

export const overpassQuery = (c: LatLng, radius: number) =>
  `[out:json][timeout:40];(${KINDS.map((k) => `nwr["name"]["${k}"](around:${radius},${c.lat},${c.lng});`).join('')});out center tags;`;

interface Element { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

// Overpass elements -> places: named, one of the five kinds, not street furniture, inside the circle, same name within ~100 m merged.
export function placesFromElements(elements: Element[], centre: LatLng, radius: number): Place[] {
  // Visit in a fixed order (nodes before building outlines, then lowest id), so when two entries merge the same one always wins, whatever order Overpass answers in.
  const order: Record<string, number> = { node: 0, way: 1, relation: 2 };
  const sorted = [...elements].sort((a, b) => order[a.type] - order[b.type] || a.id - b.id);
  const seen = new Set<string>();
  const places: Place[] = [];
  for (const el of sorted) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    const kind = KINDS.find((k) => tags[k] && tags[k] !== 'yes' && !SKIP.has(tags[k]));   // e.g. a car park that is also an attraction counts as an attraction
    const name = tags.name?.trim();
    if (!name || !kind || lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (dist(centre, { lat, lng }) > radius) continue;                           // a big place's centre can fall just outside the circle
    const bucket = `${name}|${lat.toFixed(3)}|${lng.toFixed(3)}`;                // same name within ~100 m is one place (a node and its building outline, or several bus stops)
    // ponytail: a rounded grid, not a true radius: two same-name shops in one bucket merge, and one place can straddle a boundary. Cluster properly if that shows up.
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    places.push({ id: `${el.type}/${el.id}`, name, type: tags[kind], lat: +lat.toFixed(6), lng: +lng.toFixed(6) });   // id = the OpenStreetMap object, stable across re-fetches (quests refer to it)
  }
  return places.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id! < b.id! ? -1 : 1));   // plain comparison: the same order on every machine, so re-fetches diff cleanly
}

interface FetchOptions {
  endpoints?: string[]; pauseMs?: number;           // pauseMs: wait before trying the next server
  minElements?: number;                             // fewer elements than this means Overpass answered badly (a sanity check for the one-off tool; a real region can be nearly empty)
  log?: (message: string) => void;
}

// One region's places. Throws when no server gives a usable answer: a failed request, or a 200 with a "remark" (timeout, out of memory) and an empty or partial list.
export async function fetchPlaces(centre: LatLng, radius: number, { endpoints = ENDPOINTS, pauseMs = 0, minElements = 0, log = () => {} }: FetchOptions = {}): Promise<Place[]> {
  const body = 'data=' + encodeURIComponent(overpassQuery(centre, radius));
  let failure: unknown = new Error('no Overpass endpoint');
  for (const [i, url] of endpoints.entries()) {
    try {
      const res = await fetch(url, { method: 'POST', body, headers: HEADERS, signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json() as { remark?: string; elements?: Element[] };
      if (json.remark || !Array.isArray(json.elements) || json.elements.length < minElements)
        throw new Error(`unusable answer (${json.remark ?? `${json.elements?.length ?? 0} elements`})`);
      log(`fetched from ${url} - ${json.elements.length} elements`);
      return placesFromElements(json.elements, centre, radius);
    } catch (e) {
      failure = e;
      log(`failed: ${url} ${String(e)}`);
      if (i < endpoints.length - 1 && pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    }
  }
  throw failure;
}
