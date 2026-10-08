// One-off: node tools/fetch-places.mjs
// Downloads named places around the map's start point from OpenStreetMap (Overpass API) into public/places.json.
// The app never talks to Overpass: it ships this file, so no one's location is sent anywhere.
// Data (c) OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).
import { writeFile } from 'node:fs/promises';
if (!process.features.typescript) { console.error('This script imports TypeScript (src/config.ts): it needs Node 24 or newer.'); process.exit(1); }
const { SUTD, AREA_RADIUS } = await import('../src/config.ts');   // same centre and radius the app measures "% explored" against

const CENTER = { lat: SUTD[0], lng: SUTD[1] };
const RADIUS = AREA_RADIUS;
const MIN_ELEMENTS = 50;                                      // fewer than this means Overpass answered badly (the real area has ~350)
const KINDS = ['amenity', 'shop', 'leisure', 'tourism', 'historic'];
// Named things that aren't worth "discovering": parking, benches, toilets, shelters and similar street furniture.
const SKIP = new Set(['parking', 'parking_space', 'parking_entrance', 'bicycle_parking', 'motorcycle_parking', 'bench', 'waste_basket', 'waste_disposal',
  'toilets', 'shelter', 'bicycle_rental', 'vending_machine', 'recycling', 'post_box', 'telephone', 'drinking_water', 'fountain', 'taxi',
  'loading_dock', 'grit_bin', 'bbq', 'picnic_table', 'swimming_pool', 'pitch', 'track', 'fitness_station', 'dog_park', 'slipway',
  'park_connector']);                                 // park connectors are long paths split into many segments, not a place
// Overpass rejects anonymous clients (406): identify the tool.
const HEADERS = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': 'fog-walk-map/0.1 (https://github.com/surrelsaga/map-mvp; one-off places fetch)' };
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const PAUSE_MS = 10_000;                                      // be gentle: wait before trying the next server

const around = `(around:${RADIUS},${CENTER.lat},${CENTER.lng})`;
const query = `[out:json][timeout:60];(${KINDS.map((k) => `nwr["name"]["${k}"]${around};`).join('')});out center tags;`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let data;
for (const [i, url] of ENDPOINTS.entries()) {
  try {
    const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: HEADERS });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = await res.json();
    // Overpass can answer 200 with a "remark" (timeout, out of memory) and an empty or partial list: not usable.
    if (json.remark || !Array.isArray(json.elements) || json.elements.length < MIN_ELEMENTS)
      throw new Error(`unusable answer (${json.remark ?? `${json.elements?.length ?? 0} elements`})`);
    data = json;
    console.log('fetched from', url, '-', data.elements.length, 'elements');
    break;
  } catch (e) { console.warn('failed:', url, String(e)); if (i < ENDPOINTS.length - 1) await sleep(PAUSE_MS); }
}
if (!data) { console.error('No Overpass endpoint gave a usable answer. public/places.json was left as it was. Try again in a few minutes.'); process.exit(1); }

const R = Math.PI / 180;
const metres = (a, b) => 2 * 6371000 * Math.asin(Math.sqrt(Math.sin((b.lat - a.lat) * R / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin((b.lng - a.lng) * R / 2) ** 2));
// Visit in a fixed order (nodes before building outlines, then lowest id), so when two entries merge the same one always wins, whatever order Overpass answers in.
const TYPE_ORDER = { node: 0, way: 1, relation: 2 };
data.elements.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.id - b.id);
const seen = new Set();
const places = [];
for (const el of data.elements) {
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  const kind = KINDS.find((k) => el.tags[k] && el.tags[k] !== 'yes' && !SKIP.has(el.tags[k]));   // e.g. a car park that is also an attraction counts as an attraction
  const name = el.tags.name?.trim();
  if (!name || !kind || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  if (metres(CENTER, { lat, lng }) > RADIUS) continue;                         // a big place's centre can fall just outside the circle
  const bucket = `${name}|${lat.toFixed(3)}|${lng.toFixed(3)}`;                // same name within ~100 m is one place (a node and its building outline, or several bus stops)
  // ponytail: a rounded grid, not a true radius: two same-name shops in one bucket merge, and one place can straddle a boundary. Cluster properly if that shows up.
  if (seen.has(bucket)) continue;
  seen.add(bucket);
  places.push({ id: `${el.type}/${el.id}`, name, type: el.tags[kind], lat: +lat.toFixed(6), lng: +lng.toFixed(6) });   // id = the OpenStreetMap object, stable across re-fetches (quests refer to it)
}
places.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));   // plain comparison: the same order on every machine, so re-fetches diff cleanly

const file = { source: 'OpenStreetMap contributors (ODbL)', fetched: new Date().toISOString().slice(0, 10), center: CENTER, radius: RADIUS, places };
await writeFile(new URL('../public/places.json', import.meta.url), JSON.stringify(file) + '\n');
const byType = {};
for (const p of places) byType[p.type] = (byType[p.type] ?? 0) + 1;
console.log(`wrote public/places.json: ${places.length} places`);
console.log(Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t, n]) => `${t} ${n}`).join(', '));
