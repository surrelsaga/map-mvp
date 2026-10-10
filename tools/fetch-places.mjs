// One-off: node tools/fetch-places.mjs
// Downloads named places around the map's start point from OpenStreetMap (Overpass API) into public/places.json.
// That file is the SUTD region, shipped with the app as the seed (other regions come from server/places.ts, which uses the same src/overpass.ts).
// Data (c) OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).
import { writeFile } from 'node:fs/promises';
if (!process.features.typescript) { console.error('This script imports TypeScript (src/config.ts): it needs Node 24 or newer.'); process.exit(1); }
const { SUTD, AREA_RADIUS } = await import('../src/config.ts');   // same centre and radius the app measures "% explored" against
const { fetchPlaces } = await import('../src/overpass.ts');

const CENTER = { lat: SUTD[0], lng: SUTD[1] };
const RADIUS = AREA_RADIUS;
const MIN_ELEMENTS = 50;                                      // fewer than this means Overpass answered badly (the real area has ~350)
const PAUSE_MS = 10_000;                                      // be gentle: wait before trying the next server

let places;
try { places = await fetchPlaces(CENTER, RADIUS, { pauseMs: PAUSE_MS, minElements: MIN_ELEMENTS, log: console.log }); }
catch { console.error('No Overpass endpoint gave a usable answer. public/places.json was left as it was. Try again in a few minutes.'); process.exit(1); }

const file = { source: 'OpenStreetMap contributors (ODbL)', fetched: new Date().toISOString().slice(0, 10), center: CENTER, radius: RADIUS, places };
await writeFile(new URL('../public/places.json', import.meta.url), JSON.stringify(file) + '\n');
const byType = {};
for (const p of places) byType[p.type] = (byType[p.type] ?? 0) + 1;
console.log(`wrote public/places.json: ${places.length} places`);
console.log(Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t, n]) => `${t} ${n}`).join(', '));
