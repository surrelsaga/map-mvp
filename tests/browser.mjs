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
  await page.evaluateOnNewDocument(() => {                       // remember every toast shown, so a test can't miss one that already faded
    const seen = (window.__toasts = []);                         // watches the whole document from the very start: module scripts run before DOMContentLoaded
    const Audio = window.AudioContext || window.webkitAudioContext;       // count the notes the page plays (the chime is two)
    if (Audio) { const make = Audio.prototype.createOscillator; Audio.prototype.createOscillator = function () { window.__osc = (window.__osc ?? 0) + 1; return make.call(this); }; }
    let prev = '';
    new MutationObserver(() => {
      const t = document.getElementById('toastTitle')?.textContent ?? '';
      if (t !== prev) { prev = t; if (t) seen.push(t); }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
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
  const c = document.querySelector('.leaflet-fog-pane canvas'), r = c.getBoundingClientRect(), k = c.width / r.width;   // canvas is padded and may be denser than 1x: screen point -> canvas pixel
  return c.getContext('2d').getImageData(Math.round((pt.x - r.left) * k), Math.round((pt.y - r.top) * k), 1, 1).data[3];
}, [lat, lng]);
const pixelAt = (p, lat, lng) => p.evaluate(([lat, lng]) => {            // [r, g, b, a] of the fog canvas at a point
  const pt = fogMap.map.latLngToContainerPoint([lat, lng]);
  const c = document.querySelector('.leaflet-fog-pane canvas'), r = c.getBoundingClientRect(), k = c.width / r.width;
  return [...c.getContext('2d').getImageData(Math.round((pt.x - r.left) * k), Math.round((pt.y - r.top) * k), 1, 1).data];
}, [lat, lng]);
const dN = (m) => m / 111195, dE = (m) => m / 111195 / Math.cos(1.3413 * Math.PI / 180);
const CLEAR = 40, FOGGED = 200;
const t = (name) => console.log('  ' + name);

// Warm-up: right after a source edit the Vite dev server reloads the first page that connects. Take that hit here, once,
// so no test is the one that gets reloaded mid-run (a reload keeps saved progress, which changes what counts as a new find).
{
  const p = await open('?debug');
  await sleep(2500);
  await p.close();
}

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

console.log('Phase 4: places');
// Serve our own places.json so the checks don't depend on the real data.
const fakePlaces = (body, status = 200, delay = 0) => async (p) => {
  await p.setRequestInterception(true);
  p.on('request', async (r) => {
    if (!r.url().endsWith('places.json')) return r.continue();
    if (delay) await sleep(delay);
    r.respond({ status, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) }).catch(() => {});
  });
};
const S0 = { lat: 1.3413, lng: 103.9638 };
const pins = (p) => p.evaluate(() => [...document.querySelectorAll('.place-pin')].map((e) => e.title));
const stats = (p) => p.evaluate(() => ({ chip: document.getElementById('chipText').textContent, places: document.getElementById('statsPlaces').textContent, area: document.getElementById('statsArea').textContent, last: document.getElementById('statsLast').textContent }));
const toasts = (p) => p.evaluate(() => window.__toasts ?? []);
const toastText = (p) => p.evaluate(() => document.getElementById('toast').classList.contains('show') ? document.getElementById('toastTitle').textContent : null);
const waitFor = async (fn, ms = 12000) => { for (let i = 0; i < ms / 100; i++) { if (await fn()) return true; await sleep(100); } return false; };
{ // discover by walking: starts hidden, appears when its spot clears, with a toast
  const places = [
    { name: 'Right Here', type: 'cafe', ...S0, lat: S0.lat + dN(10) },        // under the start circle: found quietly at start-up
    { name: 'Up The Road', type: 'cafe', lat: S0.lat + dN(62), lng: S0.lng },  // ~62 m north: found when the walk gets there
    { name: 'Far Away', type: 'cafe', lat: S0.lat, lng: S0.lng + dE(900) },    // never reached
  ];
  const p = await open('?debug=10', fakePlaces({ places })); await sleep(800);
  assert.deepEqual(await pins(p), ['Right Here'], 'only the place under the start circle is shown');
  assert.deepEqual(await toasts(p), ['Found Right Here'], 'a place under you when the app opens is a find, so it is announced');
  let st = await stats(p);
  assert.equal(st.chip, '1 found'); assert.equal(st.places, '1 of 3 places found'); assert.match(st.area, /^\d\.\d\d% of the area$/, 'area: ' + st.area);
  assert.equal(st.last, 'Last: Right Here');
  const pct0 = parseFloat(st.area);
  await p.mouse.click(195, 330);                                              // walk ~70 m north
  assert(await waitFor(async () => (await toastText(p)) === 'Found Up The Road'), 'a toast names the place when it is reached (toast: ' + (await toastText(p)) + ')');
  assert.deepEqual((await pins(p)).sort(), ['Right Here', 'Up The Road'], 'its pin appears; the far one stays hidden');
  st = await stats(p);
  assert.equal(st.chip, '2 found'); assert.equal(st.places, '2 of 3 places found'); assert.equal(st.last, 'Last: Up The Road');
  assert.equal(await p.evaluate(() => document.getElementById('toastDetail').textContent), 'Cafe', 'the toast says what kind of place it is');
  assert(parseFloat(st.area) > pct0, 'explored % went up');
  await sleep(4600);                                                          // TOAST_MS
  assert.equal(await toastText(p), null, 'the toast fades away');
  assert.equal(await p.evaluate(() => document.getElementById('toast').textContent), '', 'and its text is cleared, so screen readers are not left a stale message');
  // tap the pin: its name shows
  await sleep(500);
  const box = await p.evaluate(() => { const r = document.querySelector('.place-pin[title="Up The Road"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.click(box.x, box.y); await sleep(400);
  assert.equal(await p.evaluate(() => document.querySelector('.leaflet-popup-content strong')?.textContent), 'Up The Road', 'tapping a pin shows its name');
  assert.equal(await p.evaluate(() => document.querySelector('.leaflet-popup-content span')?.textContent), 'Cafe', 'and what kind of place it is');
  await shot(p, 'places');
  // a reload brings the found places back quietly
  await sleep(1500);
  await p.reload({ waitUntil: 'networkidle2' }); await sleep(800);
  assert.deepEqual((await pins(p)).sort(), ['Right Here', 'Up The Road'], 'found places survive a reload');
  assert.deepEqual(await toasts(p), [], 'and finds from an earlier session are not announced again');
  await p.close(); t('hidden until cleared, toast, popup, reload ok');
}
{ // the places file arrives late: what was cleared in the meantime is still announced; only earlier sessions' fog is quiet
  const places = [{ name: 'Up The Road', type: 'cafe', lat: S0.lat + dN(62), lng: S0.lng }];
  const p = await open('?debug=10', fakePlaces({ places }, 200, 8000));      // the walk (~5 s) is over before the file arrives
  let st;
  await sleep(300);
  st = await stats(p);
  assert.equal(st.chip, '0 found'); assert.equal(st.places, '0 places found', 'while loading there is no total yet');
  await p.mouse.click(195, 330);
  assert.equal(await waitFor(async () => (await pins(p)).length > 0, 14000), true, 'the pin appears once the file arrives');
  assert.deepEqual(await toasts(p), ['Found Up The Road'], 'and it is announced, not found "quietly"');
  assert.equal((await stats(p)).places, '1 of 1 places found');
  await p.close(); t('late places file still announces new finds');
}
{ // several found at once, and untrusted names
  const evil = '<img src=x onerror="window.__xss=1">';
  const places = [
    { name: evil, type: 'cafe', lat: S0.lat + dN(62), lng: S0.lng },
    { name: 'Second', type: 'cafe', lat: S0.lat + dN(45), lng: S0.lng + dE(30) },     // pins are 28 px wide (~33 m): keep them apart so a tap hits one
    { name: 'Third', type: 'cafe', lat: S0.lat + dN(45), lng: S0.lng - dE(30) },
    { name: 7, type: 'cafe', lat: S0.lat, lng: S0.lng },                       // malformed entries are skipped
    { name: 'No coords', type: 'cafe' },
  ];
  const p = await open('?debug=10', fakePlaces({ places })); await sleep(800);
  assert.equal((await stats(p)).places, '0 of 3 places found', 'malformed entries are not counted');
  await p.mouse.click(195, 330);
  assert(await waitFor(async () => (await toastText(p)) !== null), 'toast appears');
  assert.match(await toastText(p), /^Found 3 places: .+, .+ and 1 more$/, 'several at once are summarised: ' + (await toastText(p)));
  await sleep(300);
  const box = await p.evaluate((n) => { const e = [...document.querySelectorAll('.place-pin')].find((x) => x.title === n); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, evil);
  await p.mouse.click(box.x, box.y); await sleep(400);
  assert.equal(await p.evaluate(() => document.querySelector('.leaflet-popup-content strong')?.textContent), evil, 'the name is shown as text');
  assert.equal(await p.evaluate(() => document.querySelectorAll('img[src="x"], .leaflet-popup-content img').length), 0, 'no <img> was created from the name');
  assert.equal(await p.evaluate(() => window.__xss), undefined, 'and nothing ran');
  await p.close(); t('multi-find message, untrusted names stay text ok');
}
{ // flaky network: a failing places.json is retried and the places still arrive
  let asked = 0;
  const flaky = async (p) => {
    await p.setRequestInterception(true);
    p.on('request', (r) => {
      if (!r.url().endsWith('places.json')) return r.continue();
      asked++;
      if (asked <= 2) return void r.respond({ status: 503, body: 'busy' }).catch(() => {});
      r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ places: [{ name: 'Right Here', type: 'cafe', lat: S0.lat + dN(10), lng: S0.lng }] }) }).catch(() => {});
    });
  };
  const p = await open('?debug', flaky);
  assert.deepEqual(await pins(p), [], 'nothing yet while the server is failing');
  assert(await waitFor(async () => (await pins(p)).length === 1, 14000), `places arrive after two failed attempts (requests: ${asked})`);
  assert.equal(asked, 3, 'two retries, then success');
  await p.close(); t('server errors are retried');
}
{ // a missing file (404) is final: no pointless retries
  let asked = 0;
  const p = await open('?debug', async (p) => { await p.setRequestInterception(true); p.on('request', (r) => { if (!r.url().endsWith('places.json')) return r.continue(); asked++; r.respond({ status: 404, body: 'no' }).catch(() => {}); }); });
  await sleep(7000);                                                          // longer than all the retry pauses together
  assert.equal(asked, 1, '404 is not retried');
  assert.equal((await stats(p)).places, '0 places found');
  await p.close(); t('404 not retried ok');
}
{ // narrow phone: chip, stats panel and GPS message stack without covering each other
  const p = await open('?debug', fakePlaces({ places: [] }));
  await p.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.click('#chip');
  await p.evaluate(() => { document.getElementById('statsLast').textContent = 'Last: ' + 'A very long place name '.repeat(4); document.getElementById('status').textContent = 'Weak GPS (±90 m). Fog clears within 50 m, try outdoors.'; });
  const r = await p.evaluate(() => ['chip', 'stats', 'status'].map((id) => document.getElementById(id).getBoundingClientRect().toJSON()));
  assert(r[0].bottom <= r[1].top && r[1].bottom <= r[2].top, `chip, panel and message stack in order (${r.map((x) => `${Math.round(x.top)}-${Math.round(x.bottom)}`)})`);
  assert(r.every((x) => x.left >= 0 && x.right <= 320), 'all three stay inside the screen');
  assert(r[0].height >= 44, `the chip is a finger-sized target (${r[0].height} px)`);
  await p.evaluate(() => { document.getElementById('toastTitle').textContent = 'Found ' + 'x'.repeat(80); document.getElementById('toast').classList.add('show'); });
  const tb = await p.evaluate(() => document.getElementById('toast').getBoundingClientRect().toJSON());
  assert(tb.left >= 0 && tb.right <= 320, `a long unbroken name stays inside the screen (${tb.left}..${tb.right})`);
  await shot(p, 'layout-narrow');
  await p.close(); t('narrow layout ok');
}
{ // no places file, or a broken one: the app still works
  for (const [name, setup] of [['404', fakePlaces('nope', 404)], ['not JSON', fakePlaces('{{{')], ['wrong shape', fakePlaces('[1,2,3]')], ['empty list', fakePlaces({ places: [] })]]) {
    const p = await open('?debug', setup); await sleep(800);
    assert.equal((await stats(p)).places, '0 places found', `${name}: stats still work`);
    assert.deepEqual(await pins(p), [], `${name}: no pins`);
    assert((await count(p)) > 20, `${name}: fog still clears`);
    await p.close();
  }
  t('missing / broken places file ok');
}
{ // the real data end to end: walk to the nearest place that is not already in the start circle
  const p = await open('?debug=10'); await sleep(800);
  const total = Number((await stats(p)).places.match(/of (\d+) places/)?.[1]);
  assert(total > 100, `real places loaded (${total})`);
  const target = await p.evaluate(async (S0) => {
    const f = await (await fetch('places.json')).json();
    const d = (q) => Math.hypot((q.lat - S0.lat) * 111195, (q.lng - S0.lng) * 111195 * Math.cos(S0.lat * Math.PI / 180));
    return f.places.filter((q) => d(q) > 70 && d(q) < 160).sort((a, b) => d(a) - d(b))[0];
  }, S0);
  assert(target, 'a real place 70-160 m from SUTD');
  await p.evaluate((q) => fogMap.map.fire('click', { latlng: { lat: q.lat, lng: q.lng } }), target);
  assert(await waitFor(async () => ((await toastText(p)) ?? '').includes(target.name), 20000), `walking to "${target.name}" announces it (toast: ${await toastText(p)})`);
  assert((await pins(p)).includes(target.name), 'and its pin is on the map');
  await shot(p, 'places-real');
  await p.close(); t(`real data: walked to "${target.name}" (${target.type}) and found it`);
}

console.log('Phase 5: look and feel');
{ // the chip opens the stats panel; Escape or a tap on the map closes it
  const p = await open('?debug', fakePlaces({ places: [] })); await sleep(800);
  const open_ = () => p.evaluate(() => ({ hidden: document.getElementById('stats').hidden, expanded: document.getElementById('chip').getAttribute('aria-expanded') }));
  assert.deepEqual(await open_(), { hidden: true, expanded: 'false' }, 'closed at first: only the chip shows');
  await p.click('#chip');
  assert.deepEqual(await open_(), { hidden: false, expanded: 'true' }, 'the chip opens the panel');
  await p.keyboard.press('Escape');
  assert.deepEqual(await open_(), { hidden: true, expanded: 'false' }, 'Escape closes it');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'chip', 'and focus goes back to the chip');
  await p.click('#chip'); await p.mouse.click(300, 600);
  assert.equal((await open_()).hidden, true, 'a tap on the map closes it too');
  await p.click('#chip'); await p.click('#chip');
  assert.equal((await open_()).hidden, true, 'the chip toggles');
  // font, touch targets, keyboard focus
  await p.evaluate(() => document.fonts.ready);
  assert(await p.evaluate(() => document.fonts.check('700 16px "Atkinson Hyperlegible Next"') && document.fonts.check('400 16px "Atkinson Hyperlegible Next"')), 'the self-hosted font is loaded');
  assert.match(await p.evaluate(() => getComputedStyle(document.getElementById('chip')).fontFamily), /Atkinson Hyperlegible Next/);
  const named = async (sel) => { const h = await p.$(sel); const n = await p.accessibility.snapshot({ root: h }); return n && { role: n.role, name: n.name, checked: n.checked }; };
  assert.deepEqual(await named('#chip'), { role: 'button', name: 'Progress: 0 found', checked: undefined }, 'the chip has a stable name that says what its number counts');
  await p.click('#chip');
  assert.equal((await named('#chip')).name, 'Progress: 0 found', 'and keeps it while the panel is open');
  await p.click('#chip');
  await p.click('#chip');
  assert.deepEqual(await named('#soundSwitch'), { role: 'switch', name: 'Sound', checked: true }, 'the switch is named "Sound" and its state comes from aria-checked');
  await p.focus('#soundSwitch'); await p.mouse.click(300, 600);
  assert.notEqual(await p.evaluate(() => document.activeElement.tagName), 'BODY', 'closing the panel with a tap on the map does not drop keyboard focus to the top of the page');
  await p.click('#chip');
  const sizes = await p.evaluate(() => ['chip', 'soundSwitch'].map((id) => document.getElementById(id).getBoundingClientRect().height));
  assert(sizes.every((h) => h >= 44), `chip and sound switch are at least 44 px tall (${sizes})`);
  await p.click('#chip');
  await dragMap(p);
  const rb = await p.evaluate(() => document.getElementById('recentre').getBoundingClientRect().toJSON());
  assert(rb.width >= 44 && rb.height >= 44, `the recentre button is at least 44 px (${rb.width}x${rb.height})`);
  await p.evaluate(() => document.activeElement.blur());
  for (let i = 0; i < 4 && (await p.evaluate(() => document.activeElement.id)) !== 'chip'; i++) await p.keyboard.press('Tab');   // the map itself is focusable (arrow keys pan it), so it comes first
  const focus = await p.evaluate(() => { const e = document.activeElement, cs = getComputedStyle(e); return { id: e.id, width: cs.outlineWidth, style: cs.outlineStyle }; });
  assert.equal(focus.id, 'chip', 'Tab reaches the chip');
  assert(focus.width === '3px' && focus.style === 'solid', `with a visible focus ring (${JSON.stringify(focus)})`);
  const ring = await p.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { line: cs.outlineColor, band: cs.boxShadow }; });
  await shot(p, 'focus-ring');
  assert.equal(ring.line, 'rgb(26, 37, 56)', 'a dark line (visible on the pale map)');
  assert.match(ring.band, /rgb\(238, 243, 248\)/, 'around a light band (visible on the dark panels)');
  const bg = await p.evaluate(() => getComputedStyle(document.querySelector('.leaflet-control-attribution')).backgroundColor);
  assert.equal(bg, 'rgba(26, 37, 56, 0.85)', 'the attribution bar uses the dark style (it must win over Leaflet\'s own stylesheet)');
  await p.close(); t('chip, panel, font, tap targets, focus ring ok');
}
{ // pins: a gold disc with the right icon for each kind of place; only fresh finds pulse
  const at = (n, e) => ({ lat: S0.lat + dN(n), lng: S0.lng + dE(e) });
  const places = [
    { name: 'Noodle House', type: 'fast_food', ...at(26, 0) }, { name: 'Corner Shop', type: 'convenience', ...at(0, 26) },
    { name: 'Tiny Park', type: 'park', ...at(-26, 0) }, { name: 'Police Post', type: 'police', ...at(0, -26) },
  ];
  const p = await open('?debug', fakePlaces({ places }, 200, 3000));        // the file arrives after the page is up, so we can catch the pulse
  assert(await waitFor(async () => p.evaluate(() => !!document.querySelector('.place-pin.is-new')), 8000), 'a new find pulses');
  const kinds = await p.evaluate(() => [...document.querySelectorAll('.place-pin')].map((e) => ({ title: e.title, kind: [...e.classList].find((c) => ['food', 'shop', 'outdoors', 'other'].includes(c)), svg: !!e.querySelector('.place-disc svg path'), box: e.getBoundingClientRect().width })));
  assert.deepEqual(kinds.map((k) => [k.title, k.kind]).sort(), [['Corner Shop', 'shop'], ['Noodle House', 'food'], ['Police Post', 'other'], ['Tiny Park', 'outdoors']], 'each kind of place gets its own pin');
  assert(kinds.every((k) => k.svg), 'every pin has an icon');
  assert(kinds.every((k) => k.box >= 28), `and a finger-sized box (${kinds.map((k) => k.box)})`);
  const gold = await p.evaluate(() => getComputedStyle(document.querySelector('.place-pin .place-disc')).backgroundColor);
  assert.equal(gold, 'rgb(242, 179, 61)', 'the pin disc is the discovery gold');
  await sleep(1600);
  assert.equal(await p.evaluate(() => document.querySelectorAll('.place-pin.is-new').length), 0, 'the pulse ends');
  await p.reload({ waitUntil: 'networkidle2' }); await sleep(3600);
  assert.equal(await p.evaluate(() => document.querySelectorAll('.place-pin').length), 4, 'all four are back after a reload');
  assert.equal(await p.evaluate(() => document.querySelectorAll('.place-pin.is-new').length), 0, 'and restored pins do not pulse');
  await p.close(); t('pin kinds, gold, pulse only for fresh finds ok');
}
{ // reduced motion: no pulse, and the message fades instead of sliding
  const places = [{ name: 'Right Here', type: 'cafe', lat: S0.lat + dN(10), lng: S0.lng }];
  const reduce = (p) => p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const calm = await open('?debug', async (p) => { await reduce(p); await fakePlaces({ places })(p); });
  await sleep(500);
  assert.equal(await calm.evaluate(() => getComputedStyle(document.querySelector('.place-pin .place-disc')).animationName), 'none', 'reduced motion: no pulse');
  assert.deepEqual(await calm.evaluate(() => [fogMap.map.options.zoomAnimation, fogMap.map.options.fadeAnimation, fogMap.map.options.markerZoomAnimation]), [false, false, false], 'reduced motion: the map does not animate zooms or fades either');
  // resting position of the hidden message: below its place and ready to rise, unless motion is reduced
  const hiddenToast = (p) => p.evaluate(() => getComputedStyle(document.getElementById('toast')).transform);
  const normalMap = await open('?debug', fakePlaces({ places: [] }));
  assert.deepEqual(await normalMap.evaluate(() => [fogMap.map.options.zoomAnimation, fogMap.map.options.fadeAnimation]), [true, true], 'normally it does');
  await normalMap.close();
  const calmEmpty = await open('?debug', async (p) => { await reduce(p); await fakePlaces({ places: [] })(p); }), normalEmpty = await open('?debug', fakePlaces({ places: [] }));
  assert.equal(await hiddenToast(calmEmpty), 'none', 'reduced motion: the message does not slide');
  assert.notEqual(await hiddenToast(normalEmpty), 'none', 'normally the hidden message waits below its place, ready to rise');
  for (const x of [calm, calmEmpty, normalEmpty]) await x.close();
  t('reduced motion ok');
}
{ // sound: silent before the first tap, a two-note chime after it, and the switch mutes it and remembers
  const at = (n) => ({ lat: S0.lat + dN(n), lng: S0.lng });
  const places = [0, 600, 1200, 1800].map((n, i) => ({ name: `Spot ${i}`, type: 'cafe', ...at(n) }));
  const p = await open('', async (p) => { await captureFix(p); await fakePlaces({ places })(p); });
  const fixAt = (n) => p.evaluate((c) => window.__fix({ coords: c }), { latitude: S0.lat + dN(n), longitude: S0.lng, accuracy: 20 });
  const notes = () => p.evaluate(() => window.__osc ?? 0);
  await fixAt(0); await sleep(600);
  assert.deepEqual(await toasts(p), ['Found Spot 0'], 'the first find is announced');
  assert.equal(await notes(), 0, 'but there is no sound before the user has touched the page');
  await p.mouse.click(200, 400); await sleep(300);                           // the first tap unlocks audio
  await fixAt(600); await sleep(600);
  assert.equal(await notes(), 2, 'after a tap, a find plays a two-note chime');
  await p.click('#chip');
  const sw = () => p.evaluate(() => [document.getElementById('soundSwitch').getAttribute('aria-checked'), document.querySelector('#soundSwitch .state').textContent].join('|'));
  assert.equal(await sw(), 'true|✓ on');
  await p.click('#soundSwitch');
  assert.equal(await sw(), 'false|off', 'the switch turns sound off');
  await fixAt(1200); await sleep(600);
  assert.deepEqual((await toasts(p)).slice(-1), ['Found Spot 2'], 'finds are still announced on screen');
  assert.equal(await notes(), 2, 'but silently while muted');
  await p.reload({ waitUntil: 'networkidle2' });
  await p.click('#chip');
  assert.equal(await p.evaluate(() => document.getElementById('soundSwitch').getAttribute('aria-checked')), 'false', 'the choice survives a reload');
  await p.click('#soundSwitch'); await p.click('#soundSwitch'); await p.click('#soundSwitch');   // back on: three presses from off ends on
  assert.equal(await p.evaluate(() => document.getElementById('soundSwitch').getAttribute('aria-checked')), 'true');
  await p.close(); t('chime after first tap, mute, remembered');
}
{ // fog: crisp on dense screens within a pixel budget, and a gold rim on the cleared edge
  const p = await open('?debug', fakePlaces({ places: [] })); await sleep(800);
  const dense = await p.evaluate(() => { const c = document.querySelector('.leaflet-fog-pane canvas'); return { scale: c.width / parseFloat(c.style.width), pixels: c.width * c.height }; });
  assert(dense.scale >= 1.5, `a 2x screen gets a crisp fog (${dense.scale.toFixed(2)}x)`);
  assert(dense.pixels <= 4_100_000, `within the pixel budget (${dense.pixels})`);
  const s0 = await where(p);
  const rim = await pixelAt(p, s0.lat, s0.lng + dE(55)), deep = await pixelAt(p, s0.lat, s0.lng + dE(100));
  assert(rim[0] - rim[2] >= 25, `just outside the cleared edge the fog glows gold (rgb ${rim.slice(0, 3)})`);
  assert(deep[2] - deep[0] >= 20 && deep[3] >= 235, `further out it is plain pre-dawn blue and nearly opaque (rgba ${deep})`);
  const css = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fog').trim());
  const want = [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16));
  assert(deep.slice(0, 3).every((v, i) => Math.abs(v - want[i]) <= 2), `the fog is the stylesheet's --fog (${css}), not a copy (${deep.slice(0, 3)})`);
  assert(await alphaAt(p, s0.lat, s0.lng + dE(20)) < 10, 'and the middle is fully clear');
  await shot(p, 'fog-rim');
  await p.setViewport({ width: 390, height: 780, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await p.evaluate(() => fogMap.map.invalidateSize()); await sleep(600);
  const three = await p.evaluate(() => { const c = document.querySelector('.leaflet-fog-pane canvas'); return { scale: c.width / parseFloat(c.style.width), pixels: c.width * c.height }; });
  assert(three.scale < 3 && three.pixels <= 4_100_000, `a 3x screen is capped to the budget instead of using ${3 * 3 * 1.2}M pixels (${three.scale.toFixed(2)}x, ${(three.pixels / 1e6).toFixed(1)}M px)`);
  await p.setViewport({ width: 2560, height: 1440, deviceScaleFactor: 1 });
  await p.evaluate(() => fogMap.map.invalidateSize()); await sleep(800);
  const big = await p.evaluate(() => { const c = document.querySelector('.leaflet-fog-pane canvas'); return { scale: c.width / parseFloat(c.style.width), pixels: c.width * c.height }; });
  assert(big.scale < 1 && big.pixels <= 4_100_000, `a large desktop window still stays within the budget by drawing the fog softer (${big.scale.toFixed(2)}x, ${(big.pixels / 1e6).toFixed(1)}M px)`);
  await p.close(); t('fog density, budget and gold rim ok');
}
{ // a pinch (move events at fractional zooms, no zoom animation) keeps the fog glued to the streets
  const p = await open('?debug', fakePlaces({ places: [] })); await sleep(800);
  const s0 = await where(p);
  // small fractional zooms: too small for the canvas edge to drift into view, so only a redraw triggered by the zoom change keeps the fog right
  await p.evaluate(() => fogMap.map._move(fogMap.map.getCenter(), 17.3)); await sleep(300);          // what a pinch does every frame
  assert(await alphaAt(p, s0.lat, s0.lng + dE(40)) < 40, 'zoomed in a little mid-pinch, 40 m from you is still cleared (the old drawing would have it fogged)');
  assert(await alphaAt(p, s0.lat, s0.lng + dE(120)) > 200, 'and 120 m out is still fog');
  await p.evaluate(() => fogMap.map._move(fogMap.map.getCenter(), 16.8)); await sleep(300);
  assert(await alphaAt(p, s0.lat, s0.lng + dE(52)) >= 60, 'zoomed out a little, the cleared patch has shrunk on screen with the map (the old drawing would still show 52 m as clear)');
  assert(await alphaAt(p, s0.lat, s0.lng + dE(20)) < 10, 'while 20 m from you is clear');
  // the end of a gesture redraws once, not twice
  await p.evaluate(() => {
    window.__clears = 0; const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...a) { if (this.canvas.parentElement?.classList.contains('leaflet-fog-pane')) window.__clears++; return clear.apply(this, a); };
    fogMap.map._move(fogMap.map.getCenter(), 17.4); fogMap.map.fire('moveend');                      // a redraw is queued by the move, then the gesture ends
  });
  await sleep(200);
  assert.equal(await p.evaluate(() => window.__clears), 1, 'the end of a gesture draws the fog once (a queued redraw is dropped, not repeated)');
  await p.close(); t('pinch zoom, single redraw ok');
}
{ // the stylesheet is missing: the app still starts, says so in the console, and draws something sensible
  const warnings = [];
  const p = await open('?debug', async (p) => { p.on('console', (m) => warnings.push(m.text())); await p.setRequestInterception(true); p.on('request', (r) => (r.resourceType() === 'stylesheet' ? r.abort() : r.continue())); });
  await sleep(1000);
  assert(warnings.some((w) => /--fog is missing from the stylesheet/.test(w)), 'the console names the missing colour: ' + warnings.filter((w) => /missing/.test(w)));
  assert((await p.evaluate(() => [...document.querySelectorAll('.leaflet-player-pane path')].every((e) => /^#[0-9a-f]{3,6}$/i.test(e.getAttribute('stroke') ?? '') && /^#[0-9a-f]{3,6}$/i.test(e.getAttribute('fill') ?? '')))), 'the dot and ring still have real colours (grey fallbacks), not empty ones');
  assert((await where(p)) !== null && (await count(p)) > 20, 'and the app works');
  await p.close(); t('missing stylesheet ok');
}
{ // panning does not redraw the fog on every frame: only when the view nears the edge of the padded canvas
  const p = await open('?debug', fakePlaces({ places: [] })); await sleep(800);
  await p.evaluate(() => { window.__redraws = 0; new MutationObserver(() => window.__redraws++).observe(document.querySelector('.leaflet-fog-pane canvas'), { attributes: true, attributeFilter: ['style'] }); });
  const redraws = () => p.evaluate(() => window.__redraws);
  await p.mouse.move(250, 500); await p.mouse.down();
  for (let x = 250; x >= 170; x -= 10) await p.mouse.move(x, 500);                  // a drag of 80 px: well inside the padding
  assert.equal(await redraws(), 0, 'a short drag does not redraw the fog (it moves with the map)');
  for (let x = 170; x >= 40; x -= 10) await p.mouse.move(x, 500);                   // and on to 210 px: beyond 60% of the padding
  assert((await redraws()) >= 1, 'a long drag redraws it before the canvas edge could show');
  await p.mouse.up(); await sleep(1500);
  const edges = await p.evaluate(() => { const r = document.querySelector('.leaflet-fog-pane canvas').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
  assert(edges[0] <= 0 && edges[1] <= 0 && edges[2] >= 390 && edges[3] >= 780, `the fog still covers the whole screen after the drag (${edges.map(Math.round)})`);
  await p.close(); t('pan redraws only near the canvas edge');
}
{ // no updates for a while: if a fresh position can still be had you were just standing still; only if not is the signal lost
  const dotOf = (p) => p.evaluate(() => [...document.querySelectorAll('.leaflet-player-pane path')].map((e) => [e.getAttribute('fill-opacity'), e.getAttribute('stroke'), e.getAttribute('fill')]));
  // `probe`: 'fail' answers with an error at once, 'ok' answers with a position, 'slowfail' fails only after 6 s
  const setup = (probe) => async (p) => { await captureFix(p); await p.evaluateOnNewDocument((mode) => {
    window.__probes = 0;
    navigator.geolocation.getCurrentPosition = (ok, fail) => {
      window.__probes++;
      if (mode === 'ok') ok({ coords: { latitude: 1.37, longitude: 103.99, accuracy: 15 }, timestamp: Date.now() });
      else if (mode === 'slowfail') setTimeout(() => fail({ code: 2 }), 6000);
      else fail({ code: 2 });
    };
  }, probe); };
  const lost = await open('', setup('fail')), still = await open('', setup('ok')), racer = await open('', setup('slowfail'));
  const here = { coords: { latitude: 1.36, longitude: 103.98, accuracy: 20 } };
  for (const p of [lost, still, racer]) await p.evaluate((c) => window.__fix(c), here);
  assert.deepEqual((await dotOf(lost)).map((d) => d[0]), ['0.1', '1'], 'live: a blue dot with its accuracy ring');
  // the race, set up first so it is exact: the moment the third phone's position request starts, a real fix arrives; the request then fails 6 s later
  assert(await waitFor(() => racer.evaluate(() => window.__probes >= 1), 55000), 'the third phone is asked for a position');
  await racer.evaluate((c) => window.__fix(c), here);
  const fixedAt = Date.now();
  assert(await waitFor(async () => (await status(lost)) !== '', 55000), 'with no updates and no position on request, the signal is called lost');
  assert.equal(await status(lost), 'No GPS signal. Showing where you last were.');
  await shot(lost, 'stale-dot');
  const dim = await dotOf(lost);
  assert.deepEqual(dim.map((d) => d[0]), ['0', '1'], 'the accuracy ring is hidden and the dot is still there');                       // ring is drawn first, then the dot
  assert.deepEqual(dim[1].slice(1), ['#1a2538', '#93a3ba'], 'a grey dot with a dark outline: it shows on the pale map and on the dark fog');
  // while lost it does not keep hammering the GPS
  const probesWhenLost = await lost.evaluate(() => window.__probes);
  await sleep(12000);
  assert.equal(await lost.evaluate(() => window.__probes), probesWhenLost, 'it does not ask again every few seconds while the signal is lost (battery)');
  await lost.evaluate((c) => window.__fix(c), here); await sleep(300);
  assert.equal(await status(lost), '', 'a new fix clears the message');
  assert.deepEqual((await dotOf(lost)).map((d) => d[0]), ['0.1', '1'], 'and the dot is live again');
  // standing still: asked, answered, fine
  assert(await waitFor(() => still.evaluate(() => window.__probes >= 1), 12000), 'the phone that sent no updates was asked for a position (its own check runs on its own 5 s cycle)');
  await sleep(500);
  assert.equal(await status(still), '', 'it answered, so there is no "No GPS" message');
  assert.equal((await where(still)).lat, 1.37, 'and that position was used like any other fix');
  assert.deepEqual((await dotOf(still)).map((d) => d[0]), ['0.1', '1'], 'the dot stays live');
  // the race: the request failed (6 s after it started) with a fresh fix already in hand
  await sleep(Math.max(0, 7500 - (Date.now() - fixedAt)));
  assert.equal(await status(racer), '', 'a request that fails after a real fix arrived does not call the signal lost');
  assert.deepEqual((await dotOf(racer)).map((d) => d[0]), ['0.1', '1'], 'and the dot stays live');
  for (const p of [lost, still, racer]) await p.close();
  t('stale GPS: lost, standing still, race, back-off ok');
}

assert.deepEqual(errors.filter((e) => !/Failed to load|ERR_FAILED/.test(e)), [], 'no page errors: ' + errors.join('; '));
console.log('browser suite ok (' + BASE + ')');
await browser.close();
process.exit(0);                                                 // leftover handles from the browser connection would keep Node alive
