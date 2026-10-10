// The one backend piece: GET /places?lat=..&lng=.. -> the named places within 2 km of that point, from OpenStreetMap (Overpass), cached per region.
// No database, no accounts, no user data. It is told a point already rounded to ~550 m by the app, rounds it again itself, and never logs coordinates.
// Run: node server/places.ts   (PORT, OVERPASS_URL optional). On Render it is a Web Service: build `npm ci`, start `node server/places.ts`.
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { fetchPlaces } from '../src/overpass.ts';
import { roundCentre } from '../src/region.ts';
import { AREA_RADIUS } from '../src/config.ts';
import type { Place } from '../src/places.ts';

const FRESH_MS = 7 * 24 * 3600_000;                 // a cached region is good for a week (shops open and close slowly)
const RETRY_MS = 10 * 60_000;                      // when Overpass fails or answers with nothing and we hold an old copy, serve that copy and look again after this long
const MAX_REGIONS = 100;                            // a dense city centre is ~1 MB of JSON (London: 8,500 places), ~100 KB gzipped; the oldest is dropped past this
const CORS = { 'access-control-allow-origin': '*' };   // public OpenStreetMap data, no cookies or credentials: any page may ask

// ponytail: in memory, so every deploy or restart starts empty (the next request per region takes a few seconds). Render Key Value if that ever matters.
// ponytail: no per-IP rate limit and no cap on parallel Overpass calls (identical requests share one). Add both if the endpoint gets hammered.
// gz = the gzipped body (a dense city centre is ~1 MB of JSON, ~100 KB gzipped). volatile = the phone must not keep it: it may be empty or old.
interface Entry { at: number; gz: Buffer; volatile: boolean }

export function startServer({ port = 0, overpass, freshMs = FRESH_MS }: { port?: number; overpass?: string[]; freshMs?: number } = {}): Promise<Server> {
  const cache = new Map<string, Entry>();            // insertion order = oldest first
  const inflight = new Map<string, Promise<Entry>>();   // two requests for one region share one Overpass call

  async function region(lat: number, lng: number): Promise<Entry> {
    const key = `${lat},${lng}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < freshMs) return hit;
    let job = inflight.get(key);
    if (!job) {
      job = (async () => {
        // An old copy beats nothing: when Overpass fails, or answers 200 with nothing (what a throttled server does), serve it and look again in RETRY_MS.
        const oldCopy = () => {
          const e = { at: Date.now() - freshMs + RETRY_MS, gz: hit!.gz, volatile: true };
          cache.set(key, e);
          return e;
        };
        try {
          const places: Place[] = await fetchPlaces({ lat, lng }, AREA_RADIUS, { endpoints: overpass, pauseMs: 500 });   // throws on a bad answer, so a bad answer is never cached
          if (!places.length && hit) return oldCopy();
          const body = Buffer.from(JSON.stringify({ source: 'OpenStreetMap contributors (ODbL)', fetched: new Date().toISOString().slice(0, 10), center: { lat, lng }, radius: AREA_RADIUS, places }));
          const entry = { at: Date.now(), gz: gzipSync(body), volatile: !places.length };
          if (places.length) {                         // an empty answer is passed on but not cached
            cache.delete(key);
            cache.set(key, entry);
            if (cache.size > MAX_REGIONS) cache.delete(cache.keys().next().value!);
          }
          return entry;
        } catch (e) {
          if (hit) return oldCopy();
          throw e;
        } finally { inflight.delete(key); }
      })();
      inflight.set(key, job);
    }
    return job;
  }

  const server = createServer(async (req, res) => {
    const send = (status: number, body: string | Buffer, extra: Record<string, string> = {}) => { res.writeHead(status, { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store', ...extra }); res.end(body); };
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (req.method !== 'GET') return void send(405, '{"error":"method"}');
      if (url.pathname === '/') return void send(200, '"ok"');                      // Render's health check
      if (url.pathname !== '/places') return void send(404, '{"error":"not found"}');
      const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
      if (!url.searchParams.get('lat') || !url.searchParams.get('lng') || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
        return void send(400, '{"error":"lat and lng, in degrees"}');
      const c = roundCentre({ lat, lng });
      const entry = await region(c.lat, c.lng);
      // every browser takes gzip (curl needs --compressed); an empty or old answer must not be kept by the phone's own cache
      send(200, entry.gz, { 'cache-control': entry.volatile ? 'no-store' : 'public, max-age=86400', 'content-encoding': 'gzip' });
    } catch (e) {
      console.warn('upstream failed:', String(e));                                    // the message only: no coordinates are ever logged
      send(502, '{"error":"places unavailable, try again"}');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer({ port: Number(process.env.PORT ?? 3001), overpass: process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : undefined });
  console.log('places server listening on', (server.address() as { port: number }).port);
}
