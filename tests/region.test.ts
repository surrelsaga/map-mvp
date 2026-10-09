// Part of `npm test`. src/region.ts: rounding, the stay / use / seed / fetch decision, the kept list, and reading untrusted regions back.
/// <reference types="node" />
import assert from 'node:assert';
import { roundCentre, pickRegion, keep, parseRegion, regionStoreKey, readRegions, writeRegions, type Region } from '../src/region.ts';
import { REGION_ROUND, REANCHOR_M, REGION_KEEP, REGION_MAX_CHARS, AREA_RADIUS, SUTD } from '../src/config.ts';
import { M_PER_DEG } from '../src/fog.ts';

const north = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat + m / M_PER_DEG, lng: p.lng });
const region = (lat: number, lng: number, places = 0): Region => ({ center: { lat, lng }, fetched: '2026-10-09', places: Array.from({ length: places }, (_, i) => ({ id: `node/${i}`, name: `P${i}`, type: 'cafe', lat, lng })) });

// ---- rounding: onto the grid, no float noise, never further than half a step from the fix
assert.deepEqual(roundCentre({ lat: 1.3413, lng: 103.9638 }), { lat: 1.34, lng: 103.965 });
assert.deepEqual(roundCentre({ lat: 35.6762, lng: 139.6503 }), { lat: 35.675, lng: 139.65 });
assert.deepEqual(roundCentre({ lat: -33.8688, lng: 151.2093 }), { lat: -33.87, lng: 151.21 });
assert.deepEqual(roundCentre({ lat: 90, lng: 180 }), { lat: 90, lng: 180 });
for (const [lat, lng] of [[0.0024, 0.0026], [51.5074, -0.1278], [-77.846, 166.668], [1.3549999, 103.9]]) {
  const c = roundCentre({ lat, lng });
  assert(Math.abs(c.lat - lat) <= REGION_ROUND / 2 + 1e-9 && Math.abs(c.lng - lng) <= REGION_ROUND / 2 + 1e-9, `${lat},${lng} -> ${c.lat},${c.lng}`);
  assert.deepEqual(roundCentre(c), c, 'rounding twice changes nothing (the server rounds again)');
}

// ---- pickRegion
const seedPoint = { lat: SUTD[0], lng: SUTD[1] };
const tokyo = region(35.675, 139.65, 5);
assert.deepEqual(pickRegion(north(tokyo.center, REANCHOR_M - 10), tokyo, []), { kind: 'stay' }, 'just inside the ring: nothing changes');
assert.equal(pickRegion(north(tokyo.center, REANCHOR_M + 10), tokyo, [tokyo]).kind, 'fetch', 'just outside: a new region (and the current one does not count as a kept one to reuse)');
assert.deepEqual(pickRegion({ lat: 35.675, lng: 139.65 }, null, [tokyo]), { kind: 'use', region: tokyo }, 'no current region: a kept one that covers you');
const osaka = region(34.69, 135.5, 3);
assert.deepEqual(pickRegion(osaka.center, tokyo, [tokyo, osaka]), { kind: 'use', region: osaka }, 'walk back into an older kept region: reuse it, no network');
const closer = region(35.675 + 0.001, 139.65, 2);
assert.equal((pickRegion(tokyo.center, null, [closer, tokyo]) as { region: Region }).region, closer, 'two kept regions cover you: the most recently used wins');
assert.deepEqual(pickRegion(seedPoint, null, []), { kind: 'seed' }, 'near SUTD with nothing kept: the shipped file');
assert.deepEqual(pickRegion(north(seedPoint, REANCHOR_M - 10), null, []), { kind: 'seed' });
assert.equal(pickRegion(north(seedPoint, REANCHOR_M + 10), null, []).kind, 'fetch', 'a little further out is a normal region');
assert.deepEqual(pickRegion(seedPoint, region(seedPoint.lat, seedPoint.lng), []), { kind: 'stay' }, 'SUTD already current: stay');
const fetch = pickRegion({ lat: -33.8688, lng: 151.2093 }, null, []);
assert.deepEqual(fetch, { kind: 'fetch', center: { lat: -33.87, lng: 151.21 } }, 'the centre to ask for is already rounded');
// leaving never flips back and forth: after re-centring on a fix, a step back toward the old centre still stays in the new region
const b = pickRegion(north(tokyo.center, REANCHOR_M + 10), tokyo, [tokyo]) as { center: { lat: number; lng: number } };
const newRegion = region(b.center.lat, b.center.lng, 1);
assert.equal(pickRegion(north(tokyo.center, REANCHOR_M - 10), newRegion, [newRegion, tokyo]).kind, 'stay', 'no flip-flop at the edge');
assert(REANCHOR_M < AREA_RADIUS, 'places always lie ahead of you when the ring is crossed');
assert(AREA_RADIUS - REANCHOR_M >= 400, 'and enough of them: more than the rounding can shift the centre by (~390 m)');

// ---- keep: newest first, no duplicates, REGION_KEEP at most
const a = region(1, 1), b2 = region(2, 2), c = region(3, 3), d = region(4, 4);
assert.deepEqual(keep([], a), [a]);
assert.deepEqual(keep([a], b2), [b2, a]);
assert.deepEqual(keep([b2, a], a), [a, b2], 'using an older one again moves it to the front');
assert.equal(keep([c, b2, a], d).length, REGION_KEEP, `only ${REGION_KEEP} are kept`);
assert.deepEqual(keep([c, b2, a], d).map((r) => r.center.lat), [4, 3, 2], 'the oldest goes');
const refreshed = region(1, 1, 4);
assert.equal(keep([a], refreshed)[0], refreshed, 'a newer copy of the same centre replaces the old');

// ---- parseRegion: the file, the server and storage are all untrusted
const good = { center: { lat: 1.3, lng: 103.9 }, fetched: '2026-10-08', places: [{ name: 'Cafe', type: 'cafe', lat: 1.3, lng: 103.9 }] };
assert.deepEqual(parseRegion(good), { center: { lat: 1.3, lng: 103.9 }, fetched: '2026-10-08', places: good.places });
assert.equal(parseRegion({ ...good, fetched: undefined })?.fetched, '', 'a missing date is fine');
assert.deepEqual(parseRegion({ ...good, places: [] })?.places, [], 'a region with no places is a real answer (countryside)');
assert.equal(parseRegion({ ...good, places: [{ name: '', type: 'x', lat: 1, lng: 1 }, good.places[0]] })?.places.length, 1, 'bad places are dropped, the rest stay');
for (const bad of [null, undefined, 5, 'x', [], {}, { places: [] }, { ...good, center: null }, { ...good, center: { lat: 'a', lng: 1 } }, { ...good, center: { lat: 91, lng: 0 } },
  { ...good, center: { lat: 0, lng: NaN } }, { ...good, center: { lat: 0, lng: -181 } }, { ...good, places: 'x' }, { ...good, places: undefined }]) assert.equal(parseRegion(bad), null, `rejects ${JSON.stringify(bad)}`);

// ---- the store (a small in-memory localStorage)
const mem = new Map<string, string>();
const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
(globalThis as unknown as { localStorage: unknown }).localStorage = store;
const key = regionStoreKey(false);
assert.notEqual(key, regionStoreKey(true), 'debug walks are stored apart');
assert.deepEqual(readRegions(key), [], 'nothing stored');
writeRegions(key, [tokyo, osaka]);
assert.deepEqual(readRegions(key), [tokyo, osaka].map((r) => ({ ...r, places: r.places })), 'what was written comes back, in order');
for (const junk of ['not json', '{}', '{"regions":5}', '{"regions":[null,5,{"center":1}]}', 'null']) { mem.set(key, junk); assert.deepEqual(readRegions(key), [], `junk gives nothing: ${junk}`); }
mem.set(key, JSON.stringify({ regions: [good, { center: 'x' }, good, good, good, good] }));
assert.equal(readRegions(key).length, REGION_KEEP, 'bad ones are skipped, and no more than REGION_KEEP come back');
// the budget: a dense city is ~0.9 MB, so the oldest of three goes; one that is too big alone is not written and does not wipe what is stored
const big = (lat: number) => region(lat, lat, 13000);
mem.clear(); writeRegions(key, [big(1), big(2), big(3)]);
assert.deepEqual(readRegions(key).map((r) => r.center.lat), [1, 2], 'newest first, and the oldest dropped to fit');
assert((mem.get(key) ?? '').length <= REGION_MAX_CHARS, 'under the budget');
writeRegions(key, [region(9, 9, 60000), big(1)]);
assert.deepEqual(readRegions(key).map((r) => r.center.lat), [1, 2], 'a region too big even alone: nothing written, the old ones stay');
(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } };
assert.deepEqual(readRegions(key), [], 'blocked storage: nothing, no crash');
const warn = console.warn; console.warn = () => {};
writeRegions(key, [tokyo]);
console.warn = warn;

console.log('ok');
