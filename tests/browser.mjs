// Browser regression suite (headless Chrome, phone-sized). Not part of `npm test`/CI: it needs Chrome and a running app.
//   npm run dev                      (terminal 1)
//   npm run test:browser             (terminal 2)         or:  node tests/browser.mjs http://localhost:4173/map-mvp/
// Env: CHROME=/path/to/chrome   SHOTS=/some/dir (also saves screenshots)
import puppeteer from 'puppeteer-core';
import assert from 'node:assert';

const BASE = process.argv[2] || 'http://localhost:3000/';
const ORIGIN = new URL(BASE).origin;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (query = '', setup, { permit = true } = {}) => {
  const ctx = await browser.createBrowserContext();             // fresh context = fresh localStorage
  if (permit) await ctx.overridePermissions(ORIGIN, ['geolocation']);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 390, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (setup) await setup(page);
  await page.goto(BASE + query, { waitUntil: 'networkidle2' });
  return page;
};
const shot = (p, name) => process.env.SHOTS && p.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
const captureFix = (p) => p.evaluateOnNewDocument(() => { navigator.geolocation.watchPosition = (ok) => { window.__fix = ok; }; });   // we decide when fixes land
const status = (p) => p.evaluate(() => document.getElementById('status').textContent);
const btn = (p) => p.evaluate(() => document.getElementById('recentre').style.display);
const centre = (p) => p.evaluate(() => fogMap.map.getCenter());
const where = (p) => p.evaluate(() => fogMap.where());
const count = (p) => p.evaluate(() => fogMap.snapshot().length);
const REAL = 'fogwalk:v1:0.0001', DEBUG = REAL + ':debug';          // storage keys: format version + CELL size, and ':debug' for simulated walks
const ls = (p, k) => p.evaluate((k) => localStorage.getItem(k), k);
const dragMap = async (p) => { await p.mouse.move(200, 400); await p.mouse.down(); await p.mouse.move(200, 250, { steps: 5 }); await p.mouse.up(); };
const alphaAt = (p, lat, lng) => p.evaluate(([lat, lng]) => {   // fog opacity at a geographic point: ~0 cleared, ~230 fogged
  const pt = fogMap.map.latLngToContainerPoint([lat, lng]);
  const c = document.querySelector('.leaflet-fog-pane canvas'), r = c.getBoundingClientRect();   // canvas is padded: screen point -> canvas pixel
  return c.getContext('2d').getImageData(Math.round(pt.x - r.left), Math.round(pt.y - r.top), 1, 1).data[3];
}, [lat, lng]);
const dN = (m) => m / 111195, dE = (m) => m / 111195 / Math.cos(1.3413 * Math.PI / 180);
const CLEAR = 40, FOGGED = 200;
const t = (name) => console.log('  ' + name);

console.log('Phase 1: map, dot, GPS');
{ // real-GPS path
  const p = await open('', (p) => p.setGeolocation({ latitude: 1.35, longitude: 103.97, accuracy: 25 }));
  await sleep(1500);
  assert(Math.abs((await where(p)).lat - 1.35) < 1e-6, 'dot at the GPS fix');
  assert.equal(await status(p), '', 'status clears after the first fix');
  await p.setGeolocation({ latitude: 1.351, longitude: 103.97, accuracy: 25 }); await sleep(2000);
  assert(Math.abs((await where(p)).lat - 1.351) < 1e-6, 'dot follows new fixes');
  assert(Math.abs((await centre(p)).lat - 1.351) < 1e-4, 'map follows the dot');
  await dragMap(p);
  assert.equal(await btn(p), 'block', 'recentre button after drag');
  await p.setGeolocation({ latitude: 1.352, longitude: 103.97, accuracy: 25 }); await sleep(2000);
  assert(Math.abs((await centre(p)).lat - 1.352) > 1e-4, 'map does not follow after a drag');
  await p.click('#recentre'); await sleep(800);
  assert(Math.abs((await centre(p)).lat - 1.352) < 1e-4, 'recentre jumps back to the dot');
  assert.equal(await btn(p), 'none');
  assert.equal(await status(p), '');
  await sleep(22000);
  assert.equal(await status(p), '', 'no message after a GPS timeout once located');
  await p.close(); t('GPS follow / drag / recentre ok');
}
{ // permission denied
  const p = await open('', null, { permit: false });
  await sleep(1500);
  assert.match(await status(p), /Location is blocked/);
  await p.close(); t('permission-denied message ok');
}
{ // first fix after the user already moved and zoomed the map
  const p = await open('', captureFix);
  await dragMap(p);
  await p.evaluate(() => fogMap.map.setZoom(15, { animate: false }));
  await sleep(1500);
  const c0 = await centre(p);
  await p.evaluate(() => window.__fix({ coords: { latitude: 1.36, longitude: 103.98, accuracy: 20 } }));
  await sleep(1500);
  const c1 = await centre(p);
  assert(Math.abs(c1.lat - c0.lat) < 1e-6 && Math.abs(c1.lng - c0.lng) < 1e-6, 'first fix must not recentre a moved map');
  assert.equal(await p.evaluate(() => fogMap.map.getZoom()), 15, 'first fix keeps the user zoom');
  assert.equal(await btn(p), 'block');
  assert.equal((await where(p)).lat, 1.36, 'dot placed at the fix');
  assert.equal(await p.evaluate(() => document.getElementById('debug')), null, 'no debug badge in normal mode');
  assert(await p.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight), 'page cannot scroll');
  const [a, b] = await p.evaluate(() => ['.leaflet-control-attribution', '#recentre'].map((q) => document.querySelector(q).getBoundingClientRect().toJSON()));
  assert(b.width > 0 && (a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom), 'attribution and recentre button do not overlap');
  await p.click('#recentre'); await sleep(800);
  assert(Math.abs((await centre(p)).lat - 1.36) < 1e-4, 'recentre jumps to the dot');
  await p.close(); t('first-fix / zoom / layout ok');
}
{ // debug walk
  const p = await open('?debug=10');
  const s = await where(p);
  assert(Math.abs(s.lat - 1.3413) < 1e-6 && Math.abs(s.lng - 103.9638) < 1e-6, 'debug starts at SUTD');
  assert.match(await p.evaluate(() => document.getElementById('debug').textContent), /DEBUG/);
  assert(await p.evaluate(() => !!document.getElementById('debugReset')), 'debug badge has a reset button');
  const tgt = await p.evaluate(() => fogMap.map.containerPointToLatLng([195, 200]));   // before the map pans to follow the dot
  await p.mouse.click(195, 200); await sleep(2200);
  const moved = await p.evaluate((a, b) => fogMap.map.distance(a, b), s, await where(p));
  assert(moved > 5 && moved < 60, `walked gradually (${moved.toFixed(0)} m in ~2 s at 14 m/s)`);
  const away = async () => p.evaluate((a, b) => fogMap.map.distance(a, b), await where(p), tgt);
  for (let i = 0; i < 40 && (await away()) >= 1; i++) await sleep(500);        // ~226 m at 14 m/s takes ~16 s
  assert((await away()) < 1, 'arrives at the tap point');
  const hop = await p.evaluate(() => { const c = fogMap.map.latLngToContainerPoint(fogMap.where()); return fogMap.map.containerPointToLatLng([c.x + 2, c.y]); });
  await p.evaluate((h) => fogMap.map.fire('click', { latlng: h }), hop); await sleep(1200);
  const after = await where(p);
  assert(Math.abs(after.lat - hop.lat) < 1e-9 && Math.abs(after.lng - hop.lng) < 1e-9, 'short hop lands exactly on target');
  await p.evaluate(() => fogMap.map.fire('click', { latlng: { lat: fogMap.where().lat, lng: fogMap.where().lng } }));
  await sleep(1200);
  assert(Number.isFinite((await where(p)).lat), 'tapping the dot itself does not produce NaN');
  await p.close(); t('debug walk ok');
}
{ // negative multiplier still walks toward the target
  const p = await open('?debug=-10');
  const n0 = await where(p);
  const tn = await p.evaluate(() => fogMap.map.containerPointToLatLng([195, 200]));
  await p.mouse.click(195, 200); await sleep(1500);
  const d = (a) => p.evaluate((a, b) => fogMap.map.distance(a, b), a, tn);
  assert((await d(await where(p))) < (await d(n0)), '?debug=-10 walks toward the target');
  await p.close(); t('negative multiplier ok');
}
{ // failure modes
  let p = await open('', async (p) => { await p.setRequestInterception(true); p.on('request', (r) => (r.resourceType() === 'script' && r.url().startsWith(ORIGIN) && !r.url().includes('@vite') ? r.abort() : r.continue())); });
  await sleep(500);
  assert.match(await status(p), /Something went wrong loading the app/, 'blocked app script shows a message, not a blank page');
  await p.close();
  p = await open('?debug', async (p) => { await p.setRequestInterception(true); p.on('request', (r) => (r.url().includes('tile.openstreetmap.org') ? r.abort() : r.continue())); });
  await sleep(1000);
  assert.equal(await status(p), '', 'broken map tiles do not show the load-failure message');
  assert(await p.evaluate(() => { const w = fogMap.where(); w.lat = 0; return fogMap.where().lat !== 0; }), 'where() returns a copy');
  await p.close(); t('failure modes ok');
}

console.log('Phase 2: fog');
{
  const p = await open('?debug=10'); await sleep(500);
  const start = await where(p);
  assert(await alphaAt(p, start.lat, start.lng) < CLEAR, 'cleared under the dot');
  assert(await alphaAt(p, start.lat, start.lng + dE(25)) < CLEAR, '25 m east is cleared');
  assert(await alphaAt(p, start.lat, start.lng + dE(90)) > FOGGED, '90 m east is fog');
  assert(await alphaAt(p, start.lat + dN(90), start.lng) > FOGGED, '90 m north is fog');
  await shot(p, 'fog-start');
  await p.evaluate(() => { const c = fogMap.map.latLngToContainerPoint(fogMap.where()); fogMap.map.fire('click', { latlng: fogMap.map.containerPointToLatLng([c.x + 150, c.y]) }); });
  await sleep(16000);
  const end = await where(p), walked = end.lng - start.lng;
  assert(walked > dE(150), `walked far enough (${(walked / dE(1)).toFixed(0)} m)`);
  for (let m = 0; m <= walked / dE(1); m += 6) assert(await alphaAt(p, start.lat, start.lng + dE(m)) < CLEAR, `trail clear at ${m} m`);
  assert(await alphaAt(p, start.lat + dN(70), start.lng + walked / 2) > FOGGED, 'beside the trail is fog');
  assert(await p.evaluate(([a, b]) => fogMap.isRevealed(a, b), [start.lat, start.lng + walked / 2]), 'isRevealed true on the trail');
  assert(!(await p.evaluate(([a, b]) => fogMap.isRevealed(a, b), [start.lat + dN(70), start.lng])), 'isRevealed false in fog');
  await shot(p, 'fog-walked');
  await dragMap(p); await sleep(2000);
  assert(await alphaAt(p, end.lat, end.lng) < CLEAR && await alphaAt(p, start.lat, start.lng + walked / 2) < CLEAR, 'aligned after pan');
  assert(await alphaAt(p, start.lat + dN(70), start.lng + walked / 2) > FOGGED, 'fog beside trail after pan');
  for (const z of [16, 17, 15]) {
    await p.evaluate((z) => fogMap.map.setZoom(z), z); await sleep(1200);
    assert(await alphaAt(p, end.lat, end.lng) < CLEAR, `aligned at zoom ${z} (dot)`);
    assert(await alphaAt(p, start.lat + dN(70), start.lng + walked / 2) > FOGGED, `aligned at zoom ${z} (fog)`);
  }
  assert.equal(await p.evaluate(() => fogMap.map.getMinZoom()), 15, 'cannot zoom out past the fog limit');
  await shot(p, 'fog-zoom15');
  await p.close(); t('fog reveal / trail / pan / zoom ok');
}
{ // accuracy gate, the "too rough" hint, and a jump
  const p = await open('', captureFix);
  const fix = (lat, lng, accuracy) => p.evaluate((c) => window.__fix({ coords: c }), { latitude: lat, longitude: lng, accuracy });
  await fix(1.36, 103.98, 3000); await sleep(500);
  assert.equal((await where(p)).accuracy, 3000, 'dot shows the rough fix');
  assert(!(await p.evaluate(() => fogMap.isRevealed(1.36, 103.98))), 'rough fix clears nothing');
  assert.match(await status(p), /GPS ±3000 m\. Fog clears within 50 m/, 'rough first fix explains why nothing clears');
  assert(await alphaAt(p, 1.36, 103.98) > FOGGED, 'canvas still fogged at a rough fix');
  await fix(1.36, 103.98, 30); await sleep(500);
  assert(await p.evaluate(() => fogMap.isRevealed(1.36, 103.98)), 'good fix clears');
  assert(await alphaAt(p, 1.36, 103.98) < CLEAR, 'canvas cleared at a good fix');
  assert.equal(await status(p), '', 'hint clears once the fix is precise');
  await fix(1.36, 103.98, 53); await sleep(300);
  assert.equal(await status(p), '', 'a brief dip just past the limit does not flash the hint');
  await sleep(5200); await fix(1.36, 103.98, 50.4); await sleep(300);
  assert.match(await status(p), /GPS ±60 m/, 'hint comes back after ~5 s of rough fixes, rounded up (never shows ±50 for a rejected fix)');
  await fix(1.36, 103.98, 30); await sleep(300);
  await fix(1.369, 103.98, 20); await sleep(500);
  assert(!(await p.evaluate(() => fogMap.isRevealed(1.3645, 103.98))), 'no trail across a 1 km jump');
  await p.close(); t('accuracy gate / hint / jump ok');
}
{ // zoom animation keeps its transform; canvas covers the screen
  const p = await open('?debug'); await sleep(500);
  await p.evaluate(() => fogMap.map.setZoom(17, { animate: false })); await sleep(300);
  await p.evaluate(() => { fogMap.map.setZoom(16); fogMap.map.fire('move'); }); await sleep(80);
  const mid = await p.evaluate(() => { const c = document.querySelector('.leaflet-fog-pane canvas'), r = c.getBoundingClientRect(); return { tf: c.style.transform, l: r.left, t: r.top, r: r.right, b: r.bottom }; });
  assert(/scale\(/.test(mid.tf), 'zoom transform survives a stray redraw: ' + mid.tf);
  assert(mid.l <= 0 && mid.t <= 0 && mid.r >= 390 && mid.b >= 780, 'fog covers the screen mid zoom-out: ' + JSON.stringify(mid));
  await sleep(800);
  const set = await p.evaluate(() => { const r = document.querySelector('.leaflet-fog-pane canvas').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
  assert(set[0] <= 0 && set[1] <= 0 && set[2] >= 390 && set[3] >= 780, 'covers the screen after zoom settles');
  await p.close(); t('zoom animation ok');
}
{ // load / snapshot
  let p = await open('?debug'); await sleep(500);
  const before = await where(p);
  assert(await alphaAt(p, before.lat + dN(300), before.lng) > FOGGED);
  const snap = await p.evaluate(() => fogMap.snapshot());
  assert(snap.length > 20 && snap.every(Number.isFinite), 'snapshot returns numeric keys');
  await p.close();
  p = await open('?debug');
  await p.evaluate((s) => fogMap.load(s), snap); await sleep(300);
  assert(await alphaAt(p, before.lat, before.lng) < CLEAR, 'loaded cells are cleared on screen');
  const n = await count(p);
  await p.evaluate(() => { fogMap.load(null); fogMap.load('junk'); fogMap.load({}); fogMap.load([NaN, 'a', 1.5, null, undefined, Infinity]); });
  assert.equal(await count(p), n, 'load() ignores corrupted input and does not throw');
  await p.close(); t('load / snapshot ok');
}

console.log('Phase 3: saved progress');
{ // debug walk survives a reload, and debug data stays out of the real key
  const p = await open('?debug=10'); await sleep(500);
  const start = await where(p);
  await p.mouse.click(195, 330);                                   // ~70 m north: new cells while walking
  const saved = async () => { const r = await ls(p, DEBUG); return r ? JSON.parse(r).keys.length : -1; };
  await sleep(2000);
  for (let i = 0; i < 40 && (await saved()) !== (await count(p)); i++) await sleep(250);   // walk ends, then the 2 s debounce writes
  const walkedTo = await where(p), n = await count(p);
  assert(n > 60, `cells cleared while walking (${n})`);
  const raw = JSON.parse(await ls(p, DEBUG));
  assert.equal(raw.keys.length, n, 'saved set equals the live set');
  assert.equal(await ls(p, REAL), null, 'debug walk does not touch the real progress key');
  await p.reload({ waitUntil: 'networkidle2' }); await sleep(800);
  assert(await count(p) >= n, 'cells restored after reload');
  const here = await where(p);
  assert(Math.abs(here.lat - start.lat) < 1e-6, 'debug dot restarts at SUTD');
  assert(await p.evaluate(([a, b]) => fogMap.isRevealed(a, b), [walkedTo.lat, walkedTo.lng]), 'the walked-to spot is still revealed');
  assert(await alphaAt(p, walkedTo.lat, walkedTo.lng) < CLEAR, 'and drawn cleared on screen, right after reload');
  await p.close(); t('reload keeps debug progress, separate key ok');
}
{ // reset button: wipes progress, and a pending save can't bring it back
  const p = await open('?debug=10'); await sleep(500);
  const n0 = await count(p);                                       // just the start circle
  await p.mouse.click(195, 330);
  const saved = async () => { const r = await ls(p, DEBUG); return r ? JSON.parse(r).keys.length : 0; };
  const ready = async () => (await count(p)) >= n0 + 10 && (await count(p)) - (await saved()) >= 5;
  for (let i = 0; i < 40 && !(await ready()); i++) await sleep(100);
  assert(await ready(), 'precondition: well over the start circle is cleared, and some of it is not saved yet');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.click('#debugReset')]);
  await sleep(3500);                                               // longer than the save delay
  const after = await ls(p, DEBUG);
  assert(after === null || JSON.parse(after).keys.length === n0, `nothing from before the reset came back (saved: ${after && JSON.parse(after).keys.length}, start circle: ${n0})`);
  assert.equal(await count(p), n0, 'fog is back to the start circle only');
  await p.close(); t('reset ok');
}
{ // real GPS: progress survives closing the page, hiding the tab, and a failing write
  const p = await open('', captureFix);
  await p.evaluate(() => window.__fix({ coords: { latitude: 1.36, longitude: 103.98, accuracy: 20 } }));
  await sleep(300);
  assert.equal(await ls(p, REAL), null, 'precondition: debounce has not written yet');
  await p.evaluate(() => dispatchEvent(new Event('pagehide')));    // on its own: a reload also fires visibilitychange, which would hide a missing pagehide listener
  assert(await ls(p, REAL) !== null, 'pagehide alone flushes the pending save');
  await p.reload({ waitUntil: 'networkidle2' });
  assert(await p.evaluate(() => fogMap.isRevealed(1.36, 103.98)), 'restored before any new fix arrives');
  await p.evaluate(() => fogMap.map.setView([1.36, 103.98], 17, { animate: false })); await sleep(500);
  assert(await alphaAt(p, 1.36, 103.98) < CLEAR, 'and drawn cleared');
  assert.equal(await ls(p, DEBUG), null, 'real mode does not use the debug key');
  // hiding the tab (switching apps on a phone) flushes too
  await p.evaluate(() => window.__fix({ coords: { latitude: 1.37, longitude: 103.99, accuracy: 20 } }));
  await sleep(300);
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const saved = JSON.parse(await ls(p, REAL));
  assert(saved.keys.length === (await count(p)) && saved.keys.length > 60, 'visibilitychange(hidden) flushes immediately');
  await p.close(); t('real-mode save, pagehide and hidden-tab flush ok');
}
{ // a failing write (quota full) is retried later, not forgotten
  const p = await open('', async (p) => { await captureFix(p); await p.evaluateOnNewDocument(() => {
    const set = Storage.prototype.setItem; window.__quotaFull = true;
    Storage.prototype.setItem = function (k, v) { if (window.__quotaFull) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, k, v); };
  }); });
  await p.evaluate(() => window.__fix({ coords: { latitude: 1.36, longitude: 103.98, accuracy: 20 } }));
  await sleep(2600);                                               // the debounced write fires and fails
  assert.equal(await ls(p, REAL), null, 'nothing saved while the quota is full');
  assert(await count(p) > 20, 'the app keeps working (fog still cleared in memory)');
  await p.evaluate(() => { window.__quotaFull = false; dispatchEvent(new Event('pagehide')); });
  assert((await ls(p, REAL)) !== null, 'once storage works again, the next flush saves it');
  await p.close(); t('failed write retried ok');
}
{ // two tabs on one device: one can't wipe the other's progress
  const ctx = await browser.createBrowserContext(); await ctx.overridePermissions(ORIGIN, ['geolocation']);
  const mk = async () => { const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.setViewport({ width: 390, height: 780, isMobile: true, hasTouch: true }); await captureFix(p); await p.goto(BASE, { waitUntil: 'networkidle2' }); return p; };
  const a = await mk(), b = await mk();                            // both start with nothing saved
  await a.evaluate(() => window.__fix({ coords: { latitude: 1.36, longitude: 103.98, accuracy: 20 } }));
  await a.evaluate(() => dispatchEvent(new Event('pagehide')));
  await b.evaluate(() => window.__fix({ coords: { latitude: 1.37, longitude: 103.99, accuracy: 20 } }));
  await b.evaluate(() => dispatchEvent(new Event('pagehide')));
  const merged = JSON.parse(await ls(a, REAL)).keys;
  const [na, nb] = [await count(a), await count(b)];
  assert(merged.length >= na + nb - 2, `the later tab's save kept the other tab's cells (${merged.length} stored, ${na} + ${nb} in memory)`);
  await ctx.close(); t('two tabs merge ok');
}
{ // bad saved data never breaks start-up
  for (const [name, value] of [['corrupt JSON', '{{{'], ['wrong shape', '[1,2,3]'], ['junk keys', '{"keys":[null,"a",1.5]}'], ['empty object', '{}']]) {
    const p = await open('?debug', (p) => p.evaluateOnNewDocument((k, v) => localStorage.setItem(k, v), DEBUG, value));
    await sleep(500);
    const n = await count(p);
    assert(n > 0 && n < 60, `${name}: ignored, app started and only the start circle is cleared (${n})`);
    await p.close();
  }
  t('corrupt saved data ignored');
}
{ // progress saved with another CELL size or format version is not read, and not overwritten
  const other = ['fogwalk:v1:0.001:debug', 'fogwalk:v2:0.0001:debug'], payload = '{"keys":[1,2,3]}';
  const p = await open('?debug', (p) => p.evaluateOnNewDocument((ks, v) => ks.forEach((k) => localStorage.setItem(k, v)), other, payload));
  await sleep(2600);
  const n = await count(p);
  assert(n > 0 && n < 60, `other-format data is not loaded (${n})`);
  for (const k of other) assert.equal(await ls(p, k), payload, `${k} is left untouched`);
  assert(await ls(p, DEBUG) !== null, 'new progress goes to the current key');
  await p.close(); t('other CELL / version data left alone');
}
{ // storage unavailable: the app still works (it just can't remember)
  const p = await open('?debug=10', (p) => p.evaluateOnNewDocument(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } }); }));
  await sleep(500);
  const s0 = await where(p);
  assert(await alphaAt(p, s0.lat, s0.lng) < CLEAR, 'fog still clears without storage');
  await p.mouse.click(195, 330); await sleep(3500);
  assert((await count(p)) > 60, 'walking still clears fog without storage');
  await p.close(); t('blocked storage ok');
}

assert.deepEqual(errors.filter((e) => !/Failed to load|ERR_FAILED/.test(e)), [], 'no page errors: ' + errors.join('; '));
console.log('browser suite ok (' + BASE + ')');
await browser.close();
process.exit(0);                                                 // leftover handles from the browser connection would keep Node alive
