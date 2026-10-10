// Part of `npm test`. src/overpass.ts: the filter/merge must give exactly what tools/fetch-places.mjs gave before it moved (tests/fixtures/overpass.expected.json
// was made by running that old code on tests/fixtures/overpass.json), and a bad Overpass answer must be an error, never "no places".
/// <reference types="node" />
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { placesFromElements, overpassQuery, fetchPlaces } from '../src/overpass.ts';
import { SUTD, AREA_RADIUS } from '../src/config.ts';

const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const answer = read('overpass.json'), expected = read('overpass.expected.json');
const centre = { lat: SUTD[0], lng: SUTD[1] };

// ---- same output as the old tool
assert.deepEqual(placesFromElements(answer.elements, centre, AREA_RADIUS), expected, 'same places, same order as the old tool');
assert.deepEqual(placesFromElements([...answer.elements].reverse(), centre, AREA_RADIUS), expected, 'whatever order Overpass answers in');
const ids = expected.map((p: { id: string }) => p.id);
assert(!ids.includes('node/2'), 'a car park is street furniture');
assert(!ids.includes('node/6'), 'no name, no place');
assert(!ids.includes('node/7'), 'outside the circle');
assert(!ids.includes('node/9'), 'historic=yes says nothing about what it is');
assert(!ids.includes('node/11'), 'no coordinates');
assert(ids.includes('node/8'), 'a car park that is also an attraction is an attraction');
assert(ids.includes('node/3') && !ids.includes('way/4'), 'a shop and its building outline merge, and the node wins');
assert(ids.includes('node/13') && ids.includes('node/14'), 'two places with one name far apart stay two');
assert.equal(expected.find((p: { id: string }) => p.id === 'node/12').name, 'Padded', 'names are trimmed');
const byId = (id: string) => expected.find((p: { id: string }) => p.id === id);
assert.equal(byId('node/15').fame, 'michelin', 'a Michelin award is fame');
assert.equal(byId('node/16').fame, 'wiki', 'a place with its own Wikidata entry is fame');
assert.equal(byId('node/17').fame, undefined, "a chain's brand:wikidata is not the place's own entry");
assert.equal(byId('node/18').fame, 'wiki', 'the building outline carries the Wikipedia entry, and the merged place keeps it');
assert.equal(byId('node/1').fame, undefined, 'most places have none');
assert.deepEqual(placesFromElements([], centre, AREA_RADIUS), [], 'no elements, no places');
assert.deepEqual(placesFromElements([{ type: 'node', id: 1, lat: 1, lon: 1 }], centre, AREA_RADIUS), [], 'an element with no tags is ignored, not a crash');

// ---- the query asks for the right thing
const q = overpassQuery({ lat: 35.68, lng: 139.77 }, 2000);
assert(q.includes('(around:2000,35.68,139.77)') && q.includes('["name"]["amenity"]') && q.includes('["name"]["historic"]') && q.endsWith('out center tags;'), q);

// ---- fetchPlaces against a fake Overpass: what it accepts and what it refuses
let reply: (res: import('node:http').ServerResponse) => void = () => {};
let asked = 0;
const fake = createServer((req, res) => { req.resume(); asked++; reply(res); });
await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/`;
const json = (res: import('node:http').ServerResponse, body: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const fails = async (why: string) => { asked = 0; await assert.rejects(fetchPlaces(centre, AREA_RADIUS, { endpoints: [url] }), Error, why); assert.equal(asked, 1, why); };

reply = (res) => json(res, answer);
assert.deepEqual(await fetchPlaces(centre, AREA_RADIUS, { endpoints: [url] }), expected, 'a good answer comes back as places');
reply = (res) => json(res, { elements: [] });
assert.deepEqual(await fetchPlaces(centre, AREA_RADIUS, { endpoints: [url] }), [], 'a good empty answer (countryside) is not an error');
reply = (res) => json(res, { elements: [], remark: 'runtime error: Query timed out' });
await fails('a remark means Overpass gave up: an error, not "no places"');
reply = (res) => json(res, { nothing: 1 });
await fails('no elements array');
reply = (res) => json(res, {}, 429);
await fails('rate limited');
reply = (res) => res.destroy();
await fails('connection dropped');
reply = (res) => json(res, answer);
await assert.rejects(fetchPlaces(centre, AREA_RADIUS, { endpoints: [url], minElements: 50 }), /unusable answer/, 'the tool\'s sanity floor');
// the second server is tried when the first fails
reply = (res) => json(res, answer);
const dead = 'http://127.0.0.1:1/';
assert.deepEqual(await fetchPlaces(centre, AREA_RADIUS, { endpoints: [dead, url] }), expected, 'falls back to the next endpoint');
fake.close();

console.log('ok');
