// Part of `npm test`. server/places.ts against a fake Overpass: the shape that comes back, rounding, the cache, shared upstream calls,
// and that a failed or half-answered Overpass is an error that is never remembered.
/// <reference types="node" />
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startServer } from '../server/places.ts';
import { parseRegion } from '../src/region.ts';
import { AREA_RADIUS } from '../src/config.ts';

const answer = JSON.parse(readFileSync(new URL('./fixtures/overpass.json', import.meta.url), 'utf8'));
const expected = JSON.parse(readFileSync(new URL('./fixtures/overpass.expected.json', import.meta.url), 'utf8'));

// Fake Overpass: counts calls, and `hold` lets a test keep answers back.
let calls = 0;
let reply: (res: ServerResponse) => void = (res) => { res.writeHead(200); res.end(JSON.stringify(answer)); };
let hold: Promise<void> | null = null;
const fake = createServer(async (req, res) => {
  req.resume(); calls++;
  if (hold) await hold;
  reply(res);
});
await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
const overpass = [`http://127.0.0.1:${(fake.address() as AddressInfo).port}/`];
const server = await startServer({ port: 0, overpass });
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const get = (path: string) => fetch(base + path);
const warn = console.warn; console.warn = () => {};          // the server reports failed upstream calls; the expected ones stay out of the test output

// ---- health, routing, input
assert.equal((await get('/')).status, 200, 'health check');
assert.equal((await get('/nope')).status, 404);
assert.equal((await fetch(base + '/places?lat=1&lng=1', { method: 'POST' })).status, 405);
for (const q of ['', '?lat=1', '?lng=1', '?lat=abc&lng=1', '?lat=1&lng=', '?lat=91&lng=0', '?lat=0&lng=181', '?lat=NaN&lng=1', '?lat=Infinity&lng=1']) {
  assert.equal((await get('/places' + q)).status, 400, `rejects ${q}`);
}
assert.equal(calls, 0, 'bad input never reaches Overpass');

// ---- a good answer: same shape as public/places.json, with CORS, and the centre rounded by the server
const r = await get('/places?lat=1.3413&lng=103.9638');
assert.equal(r.status, 200);
assert.equal(r.headers.get('access-control-allow-origin'), '*', 'a page on another origin may read it');
assert.match(r.headers.get('cache-control') ?? '', /max-age=86400/);
const body = await r.json();
assert.deepEqual(body.center, { lat: 1.34, lng: 103.965 }, 'rounded again on the server, whatever the client sent');
assert.equal(body.radius, AREA_RADIUS);
assert.match(body.source, /OpenStreetMap/);
assert(Array.isArray(body.places) && body.places.length > 0);
const parsed = parseRegion(body);
assert(parsed && parsed.places.length === body.places.length, 'the app can read it with its own parser');
assert.equal(calls, 1);
assert.equal(r.headers.get('content-encoding'), 'gzip', 'gzipped (a dense city is ~1 MB of JSON)');

// ---- cache: the same region (even from a slightly different point) is not fetched twice
await get('/places?lat=1.3413&lng=103.9638');
await get('/places?lat=1.3399&lng=103.9651');
assert.equal(calls, 1, 'one Overpass call per region');
await get('/places?lat=1.4&lng=103.9638');
assert.equal(calls, 2, 'another region, another call');

// ---- two requests at once for one region share one call
calls = 0;
let release!: () => void; hold = new Promise<void>((go) => { release = go; });
const a = get('/places?lat=10&lng=10'), b = get('/places?lat=10.001&lng=10.001');
await new Promise((go) => setTimeout(go, 100));
release(); hold = null;
const [ra, rb] = await Promise.all([a, b]);
assert.deepEqual(await ra.json(), await rb.json());
assert.equal(calls, 1, 'shared');

// ---- a bad Overpass answer is a 502 and is never cached; the next request tries again
for (const bad of [
  (res: ServerResponse) => { res.writeHead(200); res.end(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' })); },
  (res: ServerResponse) => { res.writeHead(200); res.end('{"hello":1}'); },
  (res: ServerResponse) => { res.writeHead(429); res.end('slow down'); },
  (res: ServerResponse) => res.destroy(),
]) {
  calls = 0; reply = bad;
  const failed = await get('/places?lat=1.35&lng=103.97');
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get('cache-control'), 'no-store', 'an error is not cacheable either');
  assert.equal(failed.headers.get('access-control-allow-origin'), '*', 'and the page can read that it failed');
  assert(!JSON.stringify(await failed.json()).includes('103.97'), 'the error does not echo the position');
}
reply = (res) => { res.writeHead(200); res.end(JSON.stringify(answer)); };
calls = 0;
const again = await get('/places?lat=1.35&lng=103.97');
assert.equal(again.status, 200, 'the next request after a failure asks Overpass again');
assert.equal(calls, 1, 'nothing bad was remembered');
assert.deepEqual((await again.json()).places, expected, 'and the places are the ones from the fixture');
await get('/places?lat=1.35&lng=103.97');
assert.equal(calls, 1, 'now it is cached');

// ---- a good empty answer (countryside) is passed on, but not cached: it may have been a throttled Overpass
reply = (res) => { res.writeHead(200); res.end(JSON.stringify({ elements: [] })); };
calls = 0;
const empty = await get('/places?lat=-25&lng=135');
assert.equal(empty.status, 200);
assert.deepEqual((await empty.json()).places, []);
await get('/places?lat=-25&lng=135');
assert.equal(calls, 2, 'asked again next time');

// ---- an old copy beats none when Overpass is down; a region never seen still fails
{
  const stale = await startServer({ port: 0, overpass, freshMs: 1 });
  const sbase = `http://127.0.0.1:${(stale.address() as AddressInfo).port}`;
  reply = (res) => { res.writeHead(200); res.end(JSON.stringify(answer)); };
  const first = await (await fetch(sbase + '/places?lat=1.35&lng=103.97')).json();
  await new Promise((go) => setTimeout(go, 20));
  reply = (res) => { res.writeHead(500); res.end('down'); };
  const old = await fetch(sbase + '/places?lat=1.35&lng=103.97');
  assert.equal(old.status, 200, 'expired but Overpass is down: the old answer is served');
  assert.deepEqual((await old.json()).places, first.places);
  assert.equal((await fetch(sbase + '/places?lat=40&lng=40')).status, 502, 'a region never held still fails');
  stale.close();
}

console.warn = warn;
server.close(); fake.close();
console.log('ok');
