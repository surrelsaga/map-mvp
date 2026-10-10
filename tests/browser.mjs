// Browser regression suite (headless Chrome, phone-sized). Not part of `npm test`/CI: it needs Chrome and a running app.
//   npm run dev                      (terminal 1)
//   npm run test:browser             (terminal 2)         or:  node tests/browser.mjs http://localhost:4173/map-mvp/
// Env: CHROME=/path/to/chrome   SHOTS=/some/dir (also saves screenshots)
import puppeteer from 'puppeteer-core';
import assert from 'node:assert';
import { cellOf, key as cellKey } from '../src/fog.ts';

const BASE = process.argv[2] || 'http://localhost:3000/';
const ORIGIN = new URL(BASE).origin;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (query = '', setup, { permit = true, ctx: shared, days = 0, quests = false, hint = false } = {}) => {
  if (!quests) query += (query ? '&' : '?') + 'quests=off';      // the earlier phases test the plain map and today's goal; only the quest section turns quests on
  const ctx = shared ?? await browser.createBrowserContext();   // fresh context = fresh localStorage; pass one in to act as the same device (shared storage)
  if (permit && !shared) await ctx.overridePermissions(ORIGIN, ['geolocation']);
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
  if (quests && !hint) await page.evaluateOnNewDocument(() => { localStorage.setItem('fogwalk:hinted', '1'); localStorage.setItem('fogwalk:opened', '1'); });   // a device that has seen the first-open bubble and the panel: the bubble would hold a new quest's card back (a test about it asks with `hint`), and the first find's message would point at the button
  if (days) await page.evaluateOnNewDocument((shift) => {        // the phone's clock, `days` ahead: for "a new day" without waiting for one
    const Real = Date, ms = shift * 86400000;
    window.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + ms); } static now() { return Real.now() + ms; } };
  }, days);
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
  const mk = async () => { const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.setViewport({ width: 390, height: 780, isMobile: true, hasTouch: true }); await captureFix(p); await p.goto(BASE + '?quests=off', { waitUntil: 'networkidle2' }); return p; };
  const a = await mk(), b = await mk();                            // both start with nothing saved
  await a.evaluate(() => window.__fix({ coords: { latitude: 1.36, longitude: 103.98, accuracy: 20 } }));
  await a.evaluate(() => dispatchEvent(new Event('pagehide')));
  await b.evaluate(() => window.__fix({ coords: { latitude: 1.37, longitude: 103.99, accuracy: 20 } }));
  await b.evaluate(() => dispatchEvent(new Event('pagehide')));
  const merged = JSON.parse(await ls(b, REAL)).keys;                // read from the tab that wrote last: another tab's localStorage view lags by a moment in Chrome, so tab a can still show its own 44
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
const goalLabel = (name) => { const m = /^Today: (\d+) of (\d+) places\./.exec(name); return !m ? 'Today’s goal done' : +m[1] === 0 ? `Find ${m[2]} places today` : `${m[1]} of ${m[2]} places today`; };   // the button says "Today"; the numbers are in its spoken name
const stats = (p) => p.evaluate(() => ({ chip: document.getElementById('chip').getAttribute('aria-label'), places: document.getElementById('statsPlaces').textContent, area: document.getElementById('statsArea').textContent, last: document.getElementById('statsLast').textContent })).then((s) => ({ ...s, chip: goalLabel(s.chip) }));
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
  assert.equal(st.chip, '1 of 3 places today'); assert.equal(st.places, '1 of 3 places found'); assert.match(st.area, /^\d\.\d\d% of the neighbourhood$/, 'area: ' + st.area);
  assert.equal(st.last, 'Last: Right Here');
  const pct0 = parseFloat(st.area);
  await p.mouse.click(195, 330);                                              // walk ~70 m north
  assert(await waitFor(async () => (await toastText(p)) === 'Found Up The Road'), 'a toast names the place when it is reached (toast: ' + (await toastText(p)) + ')');
  assert.deepEqual((await pins(p)).sort(), ['Right Here', 'Up The Road'], 'its pin appears; the far one stays hidden');
  st = await stats(p);
  assert.equal(st.chip, '2 of 3 places today'); assert.equal(st.places, '2 of 3 places found'); assert.equal(st.last, 'Last: Up The Road');
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
  assert.equal(st.chip, 'Find 3 places today'); assert.equal(st.places, '0 places found', 'while loading there is no total yet');
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
  await p.evaluate(() => { document.getElementById('lastFind').hidden = false; document.getElementById('statsLast').textContent = 'Last: ' + 'A very long place name '.repeat(4); document.getElementById('status').textContent = 'Weak GPS (±90 m). Fog clears within 50 m, try outdoors.'; });
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
  // what the button and the panel say: one word on the button (the gear says "settings"), two headings in the panel, and a close button
  assert.equal(await p.evaluate(() => document.getElementById('chipText').textContent), 'Today', 'the button says Today');
  assert.equal(await p.evaluate(() => document.querySelector('#chip .gear').getAttribute('aria-hidden')), 'true', 'and the gear is decoration (the spoken name already says "settings")');
  await p.click('#chip');
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#stats h2')].map((h) => h.textContent)), ['Today', 'Settings'], 'the panel has two headed sections');
  assert.equal(await p.evaluate(() => document.getElementById('stats').getAttribute('aria-labelledby')), 'statsTitle');
  const x = await named('#closeStats');
  assert.deepEqual(x, { role: 'button', name: 'Close', checked: undefined }, 'the close button is named');
  const xs = await p.evaluate(() => document.getElementById('closeStats').getBoundingClientRect().toJSON());
  assert(xs.width >= 44 && xs.height >= 44, `and is at least 44 px (${xs.width}x${xs.height})`);
  const room = await p.evaluate(() => { const b = document.getElementById('closeStats').getBoundingClientRect(), c = document.getElementById('stats').getBoundingClientRect(); return { right: c.right - b.right, top: b.top - c.top }; });
  assert(room.right >= 8 && room.top >= 8, `and the panel leaves room for its focus ring, which would otherwise be cut off (${JSON.stringify(room)})`);
  await p.click('#closeStats');
  assert.deepEqual(await open_(), { hidden: true, expanded: 'false' }, 'it closes the panel');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'chip', 'and focus goes back to the button');
  assert.deepEqual(await named('#chip'), { role: 'button', name: 'Today: 0 of 3 places. Progress and settings', checked: undefined }, 'the button is named by today\'s count, plus what a tap gives');
  await p.click('#chip');
  assert.equal((await named('#chip')).name, 'Today: 0 of 3 places. Progress and settings', 'and keeps it while the panel is open');
  await p.click('#chip');
  await p.click('#chip');
  assert.deepEqual(await named('#soundSwitch'), { role: 'switch', name: 'Sound', checked: true }, 'the switch is named "Sound" and its state comes from aria-checked');
  await p.focus('#soundSwitch'); await p.mouse.click(300, 600);
  assert.notEqual(await p.evaluate(() => document.activeElement.tagName), 'BODY', 'closing the panel with a tap on the map does not drop keyboard focus to the top of the page');
  await p.click('#chip');
  const sizes = await p.evaluate(() => ['chip', 'soundSwitch'].map((id) => document.getElementById(id).getBoundingClientRect().height));
  assert(sizes.every((h) => h >= 48), `chip and sound switch are at least 48 px tall (${sizes})`);
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
  assert.equal(await sw(), 'true|On');
  await p.click('#soundSwitch');
  assert.equal(await sw(), 'false|Off', 'the switch turns sound off');
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


console.log('Phase 5b: stats block');
const ringOffset = (p) => p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#chip .ring-arc')).strokeDashoffset));
const RING = 1;                                                                     // the arc is a circle of length 1 (pathLength): an empty ring is offset by all of it
const chipState = (p) => p.evaluate(() => ({ text: document.getElementById('chipText').textContent, name: document.getElementById('chip').getAttribute('aria-label'), done: document.querySelector('#chip .ring').classList.contains('done') })).then((c) => ({ ...c, button: c.text, text: goalLabel(c.name) }));   // text = the goal's wording (from the spoken name); button = the word on the button
const ringAt = async (p, progress) => waitFor(async () => Math.abs((await ringOffset(p)) - RING * (1 - progress)) < 0.01, 3000);
{ // the chip says what it is; the ring fills toward today's goal; the find that completes it says so
  const places = [0, 300, 600, 900].map((n, i) => ({ name: `Spot ${i}`, type: 'cafe', lat: S0.lat + dN(n), lng: S0.lng }));
  const p = await open('', async (p) => { await captureFix(p); await fakePlaces({ places })(p); }); await sleep(800);
  const fixAt = (n) => p.evaluate((c) => window.__fix({ coords: c }), { latitude: S0.lat + dN(n), longitude: S0.lng, accuracy: 20 });
  const detail = () => p.evaluate(() => document.getElementById('toastDetail').textContent);
  assert.deepEqual(await chipState(p), { button: 'Today', text: 'Find 3 places today', name: 'Today: 0 of 3 places. Progress and settings', done: false }, 'the button says Today, and its spoken name has the numbers');
  assert.deepEqual(await p.evaluate(() => { const a = document.querySelector('#chip .ring-arc'), cs = getComputedStyle(a); return [a.tagName.toLowerCase(), a.getAttribute('pathLength'), cs.strokeDasharray, cs.transitionProperty]; }), ['path', '1', '1px', 'stroke-dashoffset, opacity'], 'the arc is a <path> of length 1 (not a <circle>, whose pathLength Safari may ignore) and eases both its sweep and its fade');
  assert(await ringAt(p, 0), 'the ring starts empty');
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('#chip .ring-arc')).opacity), '0', 'and draws nothing at all (a round cap would leave a gold speck)');
  await fixAt(0); await sleep(400);
  assert.deepEqual(await chipState(p), { button: 'Today', text: '1 of 3 places today', name: 'Today: 1 of 3 places. Progress and settings', done: false });
  assert(await ringAt(p, 1 / 3), 'a third of the way round'); assert.equal(await detail(), 'Tap Today to see your progress', 'the very first find points at the button');
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('#chip .ring-arc')).opacity), '1', 'and the arc shows');
  await fixAt(300); await sleep(400);
  assert.equal((await chipState(p)).text, '2 of 3 places today'); assert(await ringAt(p, 2 / 3), 'two thirds'); assert.equal(await detail(), 'Cafe', 'and only the first find has the pointer');
  await fixAt(600); await sleep(400);
  assert.deepEqual(await chipState(p), { button: 'Today', text: 'Today’s goal done', name: 'Today’s goal done. Progress and settings', done: true }, 'the third find completes the goal');
  assert(await ringAt(p, 1), 'the ring is full'); assert.equal(await detail(), 'Today’s goal done', 'and the find message says so');
  await fixAt(900); await sleep(400);
  assert.equal((await chipState(p)).text, 'Today’s goal done', 'more finds stay done'); assert.equal(await detail(), 'Cafe', 'and the goal message is not repeated'); assert(await ringAt(p, 1));
  await p.close(); t('chip states, ring and goal completion ok');
}
{ // the first-open hint: gone after a tap or after the first find, and never again
  const p = await open('?debug', fakePlaces({ places: [] })); await sleep(500);
  const hint = () => p.evaluate(() => ({ hidden: document.getElementById('hint').hidden, flag: localStorage.getItem('fogwalk:hinted') }));
  assert.deepEqual(await hint(), { hidden: false, flag: null }, 'a first visit shows the hint');
  assert.equal(await p.evaluate(() => document.getElementById('hint').textContent), 'Walk to clear the fog. Your progress and settings are here.', 'the bubble says what to do, and where the button leads');
  await p.mouse.click(300, 600); await sleep(200);
  assert.deepEqual(await hint(), { hidden: true, flag: '1' }, 'a tap dismisses it for good');
  await p.reload({ waitUntil: 'networkidle2' });
  assert.equal((await hint()).hidden, true, 'and it does not come back after a reload');
  await p.close();
  const q = await open('', async (p) => { await captureFix(p); await fakePlaces({ places: [{ name: 'Here', type: 'cafe', ...S0 }] })(p); }); await sleep(500);
  assert.equal(await q.evaluate(() => document.getElementById('hint').hidden), false, 'a second new device shows it too');
  await q.evaluate(() => window.__fix({ coords: { latitude: 1.3413, longitude: 103.9638, accuracy: 20 } })); await sleep(300);
  assert.deepEqual(await q.evaluate(() => [document.getElementById('hint').hidden, localStorage.getItem('fogwalk:hinted')]), [true, '1'], 'the first find dismisses it without any tap');
  await q.close(); t('first-open hint ok');
}
{ // the panel before any find says what to do; the first find points at the button, once, and not at someone who has already opened it
  const at = (n) => ({ latitude: S0.lat + dN(n), longitude: S0.lng, accuracy: 20 });
  const places = [0, 300].map((n, i) => ({ name: `Spot ${i}`, type: 'cafe', lat: S0.lat + dN(n), lng: S0.lng }));
  const setup = async (p) => { await captureFix(p); await fakePlaces({ places })(p); };
  const detail = (p) => p.evaluate(() => document.getElementById('toastDetail').textContent);
  const flags = (p) => p.evaluate(() => ({ opened: localStorage.getItem('fogwalk:opened') }));
  // someone who never opens the panel
  const dev = await browser.createBrowserContext(); await dev.overridePermissions(ORIGIN, ['geolocation']);
  const a = await open('', setup, { ctx: dev }); await sleep(500);
  assert.deepEqual(await flags(a), { opened: null });
  await a.click('#chip'); await sleep(200);
  assert.equal(await a.evaluate(() => [document.getElementById('emptyHint').hidden, document.getElementById('progress').hidden]).then((x) => x.join()), 'false,true', 'before any find: a line saying what to do, and no rows of zeros');
  assert.match(await a.evaluate(() => document.getElementById('emptyHint').textContent), /Walk to clear the fog/);
  assert.match(await a.evaluate(() => document.getElementById('statsArea').textContent), /^0\.00% of the neighbourhood$/, 'the explored share shows from the start');
  assert(await a.evaluate(() => document.getElementById('statsArea').getBoundingClientRect().height > 0 && document.getElementById('areaBar').parentElement.getBoundingClientRect().height > 0), 'with its bar');
  assert.equal((await flags(a)).opened, '1', 'opening the panel is remembered');
  await a.click('#closeStats'); await a.close();
  // someone who has opened it: the first find does not point at it
  const b = await open('', setup, { ctx: dev }); await sleep(500);
  await b.evaluate((c) => window.__fix({ coords: c }), at(0)); await sleep(300);
  assert.equal(await detail(b), 'Cafe', 'a find after the panel was opened has no pointer');
  assert.equal(await b.evaluate(() => [document.getElementById('emptyHint').hidden, document.getElementById('progress').hidden].join()), 'true,false', 'with a find, the rows replace the empty-state line');
  await b.close(); await dev.close();
  // someone who has not: the pointer comes once, on the first find, and is remembered
  const dev2 = await browser.createBrowserContext(); await dev2.overridePermissions(ORIGIN, ['geolocation']);
  const c = await open('', setup, { ctx: dev2 }); await sleep(500);
  await c.evaluate((x) => window.__fix({ coords: x }), at(0)); await sleep(300);
  assert.equal(await detail(c), 'Tap Today to see your progress', 'the first find ever points at the button');
  await c.evaluate((x) => window.__fix({ coords: x }), at(300)); await sleep(300);
  assert.equal(await detail(c), 'Cafe', 'the second find does not');
  await c.close();
  const d = await open('', setup, { ctx: dev2 }); await sleep(500);
  await d.evaluate((x) => window.__fix({ coords: x }), at(0)); await sleep(300);
  assert.deepEqual(await d.evaluate(() => window.__toasts), [], 'a find from an earlier visit is quiet, so the pointer is not wasted or repeated');
  await d.close(); await dev2.close();
  t('empty state and first-find pointer ok');
}
{ // today's count: places restored from an earlier visit don't count again; a new day starts from zero
  const device = await browser.createBrowserContext(); await device.overridePermissions(ORIGIN, ['geolocation']);
  const fixture = fakePlaces({ places: [{ name: 'Right Here', type: 'cafe', lat: S0.lat + dN(10), lng: S0.lng }] });
  const a = await open('?debug', fixture, { ctx: device }); await sleep(600);
  assert.equal((await chipState(a)).text, '1 of 3 places today', 'the place under the start circle counts once');
  await sleep(2400);                                                                   // the fog (and today's count) are saved
  await a.reload({ waitUntil: 'networkidle2' }); await sleep(800);
  assert.equal((await chipState(a)).text, '1 of 3 places today', 'after a reload the same place is restored quietly and is not counted a second time');
  assert.deepEqual(await toasts(a), [], 'and not announced');
  await a.close();
  const tomorrow = await open('?debug', fixture, { ctx: device, days: 1 }); await sleep(800);
  assert.equal((await chipState(tomorrow)).text, 'Find 3 places today', 'a new day starts from zero (a restored place is not a new find)');
  assert.equal((await stats(tomorrow)).places, '1 of 1 places found', 'while the all-time count is kept');
  await tomorrow.close(); await device.close(); t('restored places not counted, new day resets ok');
}
{ // a late places file with one old find and one new one in the same batch: only the new one counts toward today
  const device = await browser.createBrowserContext(); await device.overridePermissions(ORIGIN, ['geolocation']);
  const places = [{ name: 'Old Find', type: 'cafe', lat: S0.lat + dN(10), lng: S0.lng }, { name: 'New Find', type: 'cafe', lat: S0.lat + dN(62), lng: S0.lng }];
  const first = await open('?debug=10', fakePlaces({ places: [places[0]] }), { ctx: device }); await sleep(600);
  assert.equal((await chipState(first)).text, '1 of 3 places today', 'the first visit finds the old one');
  await sleep(2400); await first.close();                                                     // saved: the fog and today's count
  const second = await open('?debug=10', fakePlaces({ places }, 200, 9000), { ctx: device }); await sleep(600);
  await second.mouse.click(195, 330);                                                         // walk north, before the places file arrives
  assert(await waitFor(async () => (await toasts(second)).length > 0, 20000), 'the new find is announced once the file arrives');
  assert.deepEqual(await toasts(second), ['Found New Find'], 'only the new place is announced');
  assert.equal((await chipState(second)).text, '2 of 3 places today', 'and only the new place is added to today (the old one is not counted again)');
  await second.close(); await device.close(); t('old and new in one batch: only the new counts');
}
{ // the panel: the four kinds of place two by two, each with its own icon and its count; the area bar with its number
  const at = (n, e) => ({ lat: S0.lat + dN(n), lng: S0.lng + dE(e) });
  const places = [
    { name: 'Noodles', type: 'fast_food', ...at(26, 0) }, { name: 'Soup', type: 'restaurant', ...at(-26, 0) }, { name: 'Corner Shop', type: 'convenience', ...at(0, 26) },
    { name: 'Tiny Park', type: 'park', ...at(0, -26) }, { name: 'Police Post', type: 'police', ...at(18, 18) }, { name: 'Far Cafe', type: 'cafe', ...at(0, 900) },
    ...Array.from({ length: 98 }, (_, i) => ({ name: `Stall ${i}`, type: 'food_court', ...at(i / 8, i / 8) })),     // ninety-eight more to find, so the food count is three digits wide
  ];
  const scale = (t) => parseFloat(t.match(/scaleX\(([\d.]+)\)/)?.[1] ?? 'NaN');
  const readRows = (p) => p.evaluate(() => [...document.querySelectorAll('#groups li')].map((li) => ({ group: li.dataset.group, name: li.querySelector('.g-name').textContent, count: li.querySelector('.g-count').textContent, icon: !!li.querySelector('.place-disc svg path'), box: li.getBoundingClientRect().toJSON() })));
  const p = await open('?debug', fakePlaces({ places })); await sleep(800);
  await p.click('#chip'); await sleep(900);
  const rows = await readRows(p);
  assert.deepEqual(rows.map((r) => [r.group, r.name, r.count]), [['food', 'Food & drink', '100 of 101'], ['shop', 'Shops', '1 of 1'], ['outdoors', 'Outdoors', '1 of 1'], ['other', 'Other', '1 of 1']], 'one cell per kind: found of total');
  assert(rows.every((r) => r.icon), 'each cell has its pin icon');
  assert(Math.abs(rows[0].box.top - rows[1].box.top) < 1 && Math.abs(rows[2].box.top - rows[3].box.top) < 1 && rows[2].box.top > rows[0].box.bottom - 1, 'two rows of two');
  assert(rows[1].box.left > rows[0].box.right - 1 && Math.abs(rows[0].box.left - rows[2].box.left) < 1, 'in two columns');
  assert.equal(await p.evaluate(() => document.querySelectorAll('#groups .bar').length), 0, 'and no bar per kind: the area bar is the only one');
  assert.equal((await stats(p)).places, '103 of 104 places found');
  const roomy = await p.evaluate(() => ({ heading: getComputedStyle(document.getElementById('statsPlaces')).marginTop, area: getComputedStyle(document.getElementById('statsArea')).marginBottom, overflow: [...document.querySelectorAll('.g-count')].some((c) => c.scrollWidth > c.clientWidth + 1) }));
  assert.deepEqual(roomy, { heading: '16px', area: '8px', overflow: false }, 'the panel keeps its spacing (a more specific rule once removed it) and a three-digit count fits');
  assert.match((await stats(p)).area, /^\d\.\d\d% of the neighbourhood$/);
  assert(scale(await p.evaluate(() => document.getElementById('areaBar').style.transform)) >= 0.05, 'the area bar is never invisible once something is explored');
  await shot(p, 'card');
  await p.close();
  const none = await open('?debug', fakePlaces({ places: [{ name: 'Far Cafe', type: 'cafe', ...at(0, 900) }, { name: 'Far Park', type: 'park', ...at(900, 0) }] })); await sleep(800);
  await none.click('#chip'); await sleep(900);
  const empty = await readRows(none);
  assert.deepEqual(empty.map((r) => r.count), ['0 of 1', '0 of 0', '0 of 1', '0 of 0'], 'nothing found: zeros');
  assert.equal(await none.evaluate(() => document.getElementById('progress').hidden), true, 'but they are not shown: the panel says what to do instead');
  await none.close(); t('panel kinds, area bar ok');
}
{ // "Last": tap it and the map goes to that place and opens its name
  const places = [{ name: 'Right Here', type: 'fast_food', lat: S0.lat + dN(10), lng: S0.lng }];
  const p = await open('?debug', fakePlaces({ places })); await sleep(800);
  await p.evaluate((s) => fogMap.map.setView([s.lat + 0.01, s.lng + 0.01], 17, { animate: false }), S0); await sleep(500);   // pan far away
  await p.click('#chip'); await sleep(300);
  assert.deepEqual(await p.evaluate(() => [document.getElementById('statsLast').textContent, document.getElementById('lastType').textContent, document.getElementById('lastFind').hidden]), ['Last: Right Here', 'Fast food', false]);
  const target = await p.evaluate(() => document.getElementById('lastFind').getBoundingClientRect().height);
  assert(target >= 48, `the row is a big enough target (${target} px)`);
  await p.click('#lastFind'); await sleep(900);
  assert.equal(await p.evaluate(() => document.getElementById('stats').hidden), true, 'the card closes so the map is visible');
  const away = await p.evaluate((s) => fogMap.map.distance(fogMap.map.getCenter(), { lat: s.lat + 10 / 111195, lng: s.lng }), S0);
  assert(away < 80, `the map moved to the place (${away.toFixed(0)} m away)`);
  assert.equal(await p.evaluate(() => document.querySelector('.leaflet-popup-content strong')?.textContent), 'Right Here', 'and its name is open');
  await p.close();
  const before = await open('?debug', fakePlaces({ places: [] })); await sleep(500);
  assert.equal(await before.evaluate(() => document.getElementById('lastFind').hidden), true, 'with nothing found yet there is no "Last" row');
  await before.close(); t('last find opens its place ok');
}
{ // it looks pressable and says so: a visible edge, a tint on press without moving, a gear, targets 48 px or more
  const places = [{ name: 'Right Here', type: 'cafe', lat: S0.lat + dN(10), lng: S0.lng }];
  const p = await open('?debug', fakePlaces({ places })); await sleep(800);
  const edge = await p.evaluate(() => { const cs = getComputedStyle(document.getElementById('chip')); return { width: cs.borderTopWidth, color: cs.borderTopColor, radius: cs.borderTopLeftRadius }; });
  assert(parseFloat(edge.width) >= 1 && edge.color === 'rgb(147, 163, 186)' && edge.radius === '24px', `the chip has a visible edge in the --dusk colour, which is 3:1 against the fog (${JSON.stringify(edge)})`);   // Chrome may snap 1.5px to 1px
  const box = await p.evaluate(() => { const r = document.getElementById('chip').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; });
  await p.mouse.move(box.x, box.y); await p.mouse.down(); await sleep(250);
  const pressed = await p.evaluate(() => { const cs = getComputedStyle(document.getElementById('chip')), r = document.getElementById('chip').getBoundingClientRect(); return { tint: cs.backgroundImage, transform: cs.transform, w: r.width, h: r.height }; });
  assert.match(pressed.tint, /rgba\(238, 243, 248, 0\.12\)/, 'pressing tints the chip');
  assert.equal(pressed.transform, 'none', 'and does not scale or move it');
  assert(Math.abs(pressed.w - box.w) < 0.5 && Math.abs(pressed.h - box.h) < 0.5, 'so nothing around it shifts');
  await p.mouse.up(); await sleep(400);
  await p.keyboard.press('Escape'); await p.focus('#chip');                                      // close it again, then test a keyboard press (after a key, focus counts as keyboard focus): the ring must survive the tint
  assert.equal(await p.evaluate(() => document.activeElement.id), 'chip');
  await p.keyboard.down('Space'); await sleep(200);
  const keyed = await p.evaluate(() => { const cs = getComputedStyle(document.getElementById('chip')); return { band: cs.boxShadow, tint: cs.backgroundImage }; });
  assert(/rgb\(238, 243, 248\)/.test(keyed.band) && /rgba\(238, 243, 248, 0\.12\)/.test(keyed.tint), `while a key is held the chip is tinted and still has its focus band (${JSON.stringify(keyed)})`);
  await p.keyboard.up('Space'); await sleep(400);
  assert.notEqual(await p.evaluate(() => getComputedStyle(document.getElementById('chip')).backgroundImage), 'none', 'the button is tinted while the panel is open');
  assert.equal(await p.evaluate(() => [document.getElementById('chip').getAttribute('aria-expanded'), document.getElementById('stats').hidden].join()), 'true,false');
  const sizes = await p.evaluate(() => ['chip', 'lastFind', 'soundSwitch'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().height)));
  assert(sizes.every((h) => h >= 48), `every control is at least 48 px tall (${sizes})`);
  await p.keyboard.press('Escape'); await sleep(300);
  await p.close(); t('pressable look, press tint, targets ok');
}
{ // reduced motion: the ring does not sweep and the card does not slide
  const places = [{ name: 'Right Here', type: 'cafe', lat: S0.lat + dN(10), lng: S0.lng }];
  const motion = async (reduce) => {
    const p = await open('?debug', async (p) => { if (reduce) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); await fakePlaces({ places })(p); }); await sleep(600);
    await p.click('#chip'); await sleep(50);
    const r = await p.evaluate(() => ({ ring: getComputedStyle(document.querySelector('#chip .ring-arc')).transitionDuration, bar: getComputedStyle(document.getElementById('areaBar')).transitionDuration, card: getComputedStyle(document.getElementById('stats')).animationName }));
    await p.close(); return r;
  };
  assert.deepEqual(await motion(true), { ring: '0s', bar: '0s', card: 'none' }, 'reduced motion: no sweep, no growing bars, no sliding card');
  const normal = await motion(false);
  assert(normal.ring !== '0s' && normal.bar !== '0s' && normal.card === 'card-in', `normally they animate (${JSON.stringify(normal)})`);
  t('reduced motion ok');
}
{ // a short screen (a phone on its side): the card scrolls, and its last controls can still be reached
  const places = [{ name: 'Right Here', type: 'cafe', lat: S0.lat + dN(10), lng: S0.lng }];
  const p = await open('?debug', fakePlaces({ places })); await sleep(600);
  await p.setViewport({ width: 640, height: 360, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await sleep(300);
  await p.click('#chip'); await sleep(400);
  const card = await p.evaluate(() => { const c = document.getElementById('stats'), r = c.getBoundingClientRect(); return { bottom: r.bottom, scrolls: c.scrollHeight > c.clientHeight, overflowY: getComputedStyle(c).overflowY }; });
  assert(card.bottom <= 360, `the card ends inside a 360 px tall screen (${Math.round(card.bottom)})`);
  assert(card.scrolls && card.overflowY === 'auto', 'and scrolls, because its content is taller');
  await p.evaluate(() => { document.getElementById('status').textContent = 'No GPS signal. Showing where you last were.'; }); await sleep(100);
  const msg = await p.evaluate(() => { const r = document.getElementById('status').getBoundingClientRect(), c = document.getElementById('stats').getBoundingClientRect(); return { bottom: r.bottom, below: r.top >= c.bottom - 1 }; });
  assert(msg.bottom <= 360 && msg.below, `a GPS message under the open card is still on the screen (${Math.round(msg.bottom)} of 360)`);
  const reach = await p.evaluate(() => { const sw = document.getElementById('soundSwitch'); sw.scrollIntoView(); const a = sw.getBoundingClientRect(), b = document.getElementById('stats').getBoundingClientRect(); return a.top >= b.top - 1 && a.bottom <= b.bottom + 1; });
  assert(reach, 'the sound switch can be scrolled into view');
  await p.close(); t('short screen ok');
}
{ // "Last" while walking: the map stays on the place (it does not snap back to you), and keyboard focus goes to the chip
  const places = [{ name: 'Far Back', type: 'cafe', lat: S0.lat + dN(62), lng: S0.lng }];
  const p = await open('?debug=10', fakePlaces({ places })); await sleep(600);
  await p.mouse.click(195, 330);                                                              // walk north and find it
  assert(await waitFor(async () => (await toasts(p)).includes('Found Far Back'), 12000), 'found');
  const walkTo = (n) => p.evaluate((lat, lng) => fogMap.map.fire('click', { latlng: { lat, lng } }), S0.lat + dN(n), S0.lng);
  await walkTo(330);                                                                          // keep walking north, well away from it
  assert(await waitFor(async () => (await p.evaluate((a, b) => fogMap.map.distance(fogMap.where(), { lat: a, lng: b }), S0.lat + dN(62), S0.lng)) > 200, 20000), 'the dot is more than 200 m past the place');
  await p.click('#chip'); await sleep(300); await p.click('#lastFind'); await sleep(1200);
  await walkTo(345); await sleep(2500);                                                       // the dot moves again: a following map would jump back to it now
  const gap = await p.evaluate((a, b) => fogMap.map.distance(fogMap.map.getCenter(), { lat: a, lng: b }), S0.lat + dN(62), S0.lng);
  assert(gap < 100, `the map stays on the place (${gap.toFixed(0)} m from it) while the dot keeps moving`);
  assert.equal(await p.evaluate(() => document.getElementById('recentre').style.display), 'block', 'and the recentre button is there to go back');
  await p.close();
  const kb = await open('?debug', fakePlaces({ places: [{ name: 'Here', type: 'cafe', lat: S0.lat + dN(10), lng: S0.lng }] })); await sleep(600);
  await kb.click('#chip'); await kb.focus('#lastFind'); await kb.keyboard.press('Enter'); await sleep(900);
  assert.equal(await kb.evaluate(() => document.activeElement.id), 'chip', 'activating "Last" from the keyboard leaves focus on the chip, not the top of the page');
  await kb.close(); t('last find keeps the map there, keeps focus ok');
}
{ // the app left open past midnight starts the new day
  const places = [{ name: 'Right Here', type: 'cafe', lat: S0.lat + dN(10), lng: S0.lng }];
  const p = await open('?debug', async (p) => {
    await p.evaluateOnNewDocument(() => { const Real = Date; window.__days = 0; window.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + window.__days * 86400000); } static now() { return Real.now() + window.__days * 86400000; } }; });
    await fakePlaces({ places })(p);
  }); await sleep(800);
  assert.equal((await chipState(p)).text, '1 of 3 places today');
  await p.evaluate(() => { window.__days = 1; document.dispatchEvent(new Event('visibilitychange')); }); await sleep(300);        // the phone is picked up the next morning
  assert.equal((await chipState(p)).text, 'Find 3 places today', 'coming back to the app after midnight starts a new day without any new find');
  await p.close(); t('midnight rollover ok');
}
{ // two tabs on one device each count a find: neither wipes the other's
  const device = await browser.createBrowserContext(); await device.overridePermissions(ORIGIN, ['geolocation']);
  const places = [{ name: 'Spot A', type: 'cafe', lat: S0.lat, lng: S0.lng }, { name: 'Spot B', type: 'cafe', lat: S0.lat + dN(600), lng: S0.lng }];
  const setup = async (p) => { await captureFix(p); await fakePlaces({ places })(p); };
  const b = await open('', setup, { ctx: device }), a = await open('', setup, { ctx: device }); await sleep(500);          // b opened first, so it holds an older picture of today
  const at = (page, n) => page.evaluate((c) => window.__fix({ coords: c }), { latitude: S0.lat + dN(n), longitude: S0.lng, accuracy: 20 });
  await at(a, 0); await sleep(500);
  assert.equal((await chipState(a)).text, '1 of 3 places today', 'tab A found one');
  await at(b, 600); await sleep(500);
  assert.equal((await chipState(b)).text, '2 of 3 places today', 'tab B adds its find to A\'s instead of replacing it');
  await a.close(); await b.close(); await device.close(); t('two tabs both count ok');
}
{ // "Last" tapped while the map is already panning, or when the map is already on the place
  const places = [{ name: 'Right Here', type: 'cafe', lat: S0.lat + dN(10), lng: S0.lng }];
  const p = await open('?debug', fakePlaces({ places })); await sleep(800);
  const far = (lat) => p.evaluate((s, la) => fogMap.map.setView([la, s.lng], 17, { animate: false }), S0, lat);
  await far(S0.lat + 0.002); await p.click('#chip'); await sleep(300);                           // ~220 m away: a pan this short really animates (a far one just jumps)
  await p.evaluate((s) => fogMap.map.panTo([s.lat + 0.0035, s.lng], { animate: true }), S0);       // a pan is under way (as when a GPS fix follows you)
  await sleep(40);
  assert.equal(await p.evaluate(() => !!document.querySelector('.leaflet-map-pane.leaflet-pan-anim')), true, 'precondition: the map is still panning when Last is tapped');
  await p.click('#lastFind'); await sleep(1500);
  const gap = await p.evaluate((s) => fogMap.map.distance(fogMap.map.getCenter(), { lat: s.lat + 10 / 111195, lng: s.lng }), S0);
  assert(gap < 80, `tapped mid-pan, the map still ends on the place (${gap.toFixed(0)} m away)`);
  assert.equal(await p.evaluate(() => document.querySelector('.leaflet-popup-content strong')?.textContent), 'Right Here', 'and its name is open');
  // already centred: nothing moves, so following is not switched off and no recentre button appears
  await p.evaluate((s) => { document.querySelector('.leaflet-popup-close-button')?.click(); fogMap.map.closePopup(); fogMap.map.setView([s.lat + 10 / 111195, s.lng], 17, { animate: false }); document.getElementById('recentre').style.display = 'none'; }, S0);
  await p.click('#chip'); await sleep(300); await p.click('#lastFind'); await sleep(600);
  assert.equal(await p.evaluate(() => document.getElementById('recentre').style.display), 'none', 'when the map is already on the place, tapping Last does not turn off following');
  assert.equal(await p.evaluate(() => document.querySelector('.leaflet-popup-content strong')?.textContent), 'Right Here', 'but still shows its name');
  await p.close(); t('Last mid-pan and when already there ok');
}
{ // two tabs: one place found in both counts once; a tab left open since yesterday cannot wipe today's count
  const device = await browser.createBrowserContext(); await device.overridePermissions(ORIGIN, ['geolocation']);
  const places = [{ name: 'Spot A', type: 'cafe', id: 'node/1', lat: S0.lat, lng: S0.lng }, { name: 'Spot B', type: 'cafe', id: 'node/2', lat: S0.lat + dN(600), lng: S0.lng }, { name: 'Spot C', type: 'cafe', id: 'node/3', lat: S0.lat + dN(1200), lng: S0.lng }];
  const clock = async (p) => { await captureFix(p); await p.evaluateOnNewDocument(() => { const Real = Date; window.__days = 0; window.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + window.__days * 86400000); } static now() { return Real.now() + window.__days * 86400000; } }; }); await fakePlaces({ places })(p); };
  const at = (page, n) => page.evaluate((c) => window.__fix({ coords: c }), { latitude: S0.lat + dN(n), longitude: S0.lng, accuracy: 20 });
  const b = await open('', clock, { ctx: device }), a = await open('', clock, { ctx: device }); await sleep(500);
  await at(a, 0); await sleep(500); await at(b, 0); await sleep(500);                          // the same place, found in both tabs
  assert.equal((await chipState(a)).text, '1 of 3 places today'); assert.equal((await chipState(b)).text, '1 of 3 places today', 'one place found in two tabs counts once');
  await a.evaluate(() => { window.__days = 1; }); await b.evaluate(() => { window.__days = 0; });  // tomorrow in tab A only: A starts a new day and finds two places
  await a.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(300);
  await at(a, 600); await sleep(500); await at(a, 1200); await sleep(500);                       // two places it has not found before
  assert.equal((await chipState(a)).text, '2 of 3 places today', 'tab A has its new day under way');
  await b.evaluate(() => { window.__days = 1; }); await b.bringToFront(); await sleep(400);          // B is brought back to the front on the new day, still holding yesterday in memory
  assert.equal((await chipState(b)).text, '2 of 3 places today', 'a tab left open since yesterday picks up today\'s count; it does not reset it to zero');
  await a.close(); await b.close(); await device.close(); t('same place in two tabs, stale tab after midnight ok');
}
{ // an app left open and never brought back to the foreground still rolls over, within a minute
  const places = [{ name: 'Right Here', type: 'cafe', lat: S0.lat + dN(10), lng: S0.lng }];
  const p = await open('?debug', async (p) => {
    await p.evaluateOnNewDocument(() => { const Real = Date; window.__days = 0; window.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + window.__days * 86400000); } static now() { return Real.now() + window.__days * 86400000; } }; });
    await fakePlaces({ places })(p);
  }); await sleep(800);
  assert.equal((await chipState(p)).text, '1 of 3 places today');
  await p.evaluate(() => { window.__days = 1; });                                              // midnight passes while the app sits there
  assert(await waitFor(async () => (await chipState(p)).text === 'Find 3 places today', 70000), 'within a minute the chip starts the new day by itself');
  await p.close(); t('midnight rollover by timer ok');
}
{ // a narrow phone: the button stays small and on one line, leaving room for the AI icon on the right; the panel stays on screen
  const p = await open('?debug', fakePlaces({ places: [] }));
  await p.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await sleep(300);
  const r = await p.evaluate(() => document.getElementById('chip').getBoundingClientRect().toJSON());
  assert(r.height >= 44 && r.height <= 56 && r.width <= 160, `the button is a small one-line target (${Math.round(r.width)} x ${Math.round(r.height)} px)`);
  assert(r.right <= 320 - 56 - 16 - 8, `and leaves 56 px at the top right for another icon (right edge ${Math.round(r.right)})`);
  await p.click('#chip'); await sleep(400);
  const card = await p.evaluate(() => document.getElementById('stats').getBoundingClientRect().toJSON());
  assert(card.left >= 0 && card.right <= 320 && card.bottom <= 640, `the open card fits a small screen (${Math.round(card.right)} x ${Math.round(card.bottom)})`);
  await shot(p, 'card-narrow');
  await p.close(); t('narrow phone ok');
}

console.log('Phase 7: regions');
{ // the places service is faked: every /places request is recorded, and answered from `answer(url)` (a region, or a status number for a failure, or 'abort')
  const TOKYO = { lat: 35.675, lng: 139.65 };                    // the region centre that a fix at 35.6762, 139.6503 rounds to
  const region = (c, names, extra = 0) => ({ source: 'OpenStreetMap contributors (ODbL)', fetched: '2026-10-09', center: c, radius: 2000,
    places: names.map((name, i) => ({ id: `node/${i + 1 + extra}`, name, type: 'cafe', lat: c.lat + dN(20 + i * 300), lng: c.lng })) });
  const service = (answer, calls) => async (p) => {
    await p.setRequestInterception(true);
    p.on('request', (r) => {
      if (!r.url().includes('/places?')) return r.continue();
      calls.push(r.url());
      const a = answer(new URL(r.url()));
      if (a === 'abort') return r.abort().catch(() => {});
      if (typeof a === 'number') return r.respond({ status: a, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"x"}' }).catch(() => {});
      r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(a) }).catch(() => {});
    });
  };
  const fixAt = (p, lat, lng) => p.setGeolocation({ latitude: lat, longitude: lng, accuracy: 25 });
  const total = (p) => stats(p).then((s) => s.places);
  const REGIONS = 'fogwalk:regions:v1';
  const q = (u) => ({ lat: Number(u.searchParams.get('lat')), lng: Number(u.searchParams.get('lng')) });

  // first open in Tokyo: one request, with a rounded centre; places from the service; the map goes there; no "New area" for the first region
  const device = await browser.createBrowserContext(); await device.overridePermissions(ORIGIN, ['geolocation']);
  const aCalls = [];
  let p = await open('', async (p) => { await service(() => region(TOKYO, ['Shibuya Cafe', 'Far Cafe']), aCalls)(p); await fixAt(p, 35.6762, 139.6503); }, { ctx: device });
  assert(await waitFor(async () => (await total(p)) === '0 of 2 places found'), 'the places of the new region: ' + await total(p));
  assert.equal(aCalls.length, 1, 'one request');
  assert.deepEqual(q(new URL(aCalls[0])), TOKYO, 'and it carries the rounded centre');
  assert(!aCalls.join().includes('35.6762') && !aCalls.join().includes('139.6503'), 'never the precise position');
  assert(Math.abs((await centre(p)).lat - 35.676) < 0.01, 'the map is in Tokyo');
  assert(!(await toasts(p)).includes('New area'), 'no message for the first region');
  assert.equal(JSON.parse(await ls(p, REGIONS)).regions.length, 1, 'and the region is kept on the phone');
  assert((await count(p)) > 0, 'the fog clears there');
  const cleared = await count(p);
  await p.close(); t('first open: one rounded request, places, map, kept ok');

  // reload with the service blocked: the kept region is enough (no network), and the map opens there
  const bCalls = [];
  p = await open('', async (p) => { await service(() => 'abort', bCalls)(p); await fixAt(p, 35.6762, 139.6503); }, { ctx: device });
  assert(await waitFor(async () => (await total(p)) === '0 of 2 places found'), 'the same places with no network: ' + await total(p));
  assert.equal(bCalls.length, 0, 'no request');
  assert.equal((await count(p)), cleared, 'and the fog came back');

  // walk 1.6 km out: a new region around you, the old fog stays, a message says so
  const NEW = { lat: 35.69, lng: 139.65 };                        // 1.6 km north of the first centre, already on the grid
  const moved = [];
  await p.close();
  p = await open('', async (p) => { await service(() => region(NEW, ['Uptown Bar'], 10), moved)(p); await fixAt(p, 35.6762, 139.6503); }, { ctx: device });
  assert(await waitFor(async () => (await total(p)) === '0 of 2 places found'));
  await fixAt(p, 35.6894, 139.6501);
  assert(await waitFor(async () => (await total(p)) === '0 of 1 places found'), 'the places of the new region: ' + await total(p));
  assert.equal(moved.length, 1, 'one request');
  assert.deepEqual(q(new URL(moved[0])), NEW, 'for the rounded spot you are at');
  assert((await toasts(p)).includes('New area'), 'with a message: ' + (await toasts(p)).join('|'));
  assert((await count(p)) >= cleared, 'the earlier fog is still there');
  assert.deepEqual(JSON.parse(await ls(p, REGIONS)).regions.map((r) => r.center), [NEW, TOKYO], 'both regions are kept, newest first');

  // and back: the first region again, from the phone, no request
  moved.length = 0;
  await fixAt(p, 35.6762, 139.6503);
  assert(await waitFor(async () => (await total(p)) === '0 of 2 places found'), 'back in the first region: ' + await total(p));
  assert.equal(moved.length, 0, 'no request: it was kept');
  await p.close(); t('reload offline, walk out, new region, walk back ok');

  // a failure while walking out does not stop you coming back into a region that is stored
  const flaky = [];
  p = await open('', async (p) => { await service(() => 502, flaky)(p); await fixAt(p, 35.6762, 139.6503); }, { ctx: device });
  assert(await waitFor(async () => /places found$/.test(await total(p))), 'the stored region opens: ' + await total(p));
  await fixAt(p, 35.7100, 139.6500);                              // 3.9 km out: no stored region covers it, so the service is asked (and fails)
  assert(await waitFor(async () => flaky.length === 1), 'asked once');
  await fixAt(p, 35.6762, 139.6503);
  assert(await waitFor(async () => /^0 of \d places found$/.test(await total(p)), 3000), 'back in a stored region at once, not after the retry wait: ' + await total(p));
  assert.equal(flaky.length, 1, 'with no new request');
  await p.close(); t('a failed load never blocks a stored region ok');

  // the service fails: the fog still clears, the card says why, nothing is kept, and it is not asked again at once
  const fail = [];
  const lost = await browser.createBrowserContext(); await lost.overridePermissions(ORIGIN, ['geolocation']);
  p = await open('', async (p) => { await service(() => 502, fail)(p); await fixAt(p, 35.6762, 139.6503); }, { ctx: lost });
  assert(await waitFor(async () => (await total(p)) === 'No places loaded for this area yet'), 'says why: ' + await total(p));
  assert((await count(p)) > 0, 'the fog clears all the same');
  assert.equal(await ls(p, REGIONS), null, 'a failure is not kept');
  assert.equal(fail.length, 1, 'asked once: the service already tried three Overpass servers, so a 5xx is not asked again at once');
  await fixAt(p, 35.6764, 139.6503); await sleep(1500);
  assert.equal(fail.length, 1, 'and not asked again on the next step either');
  await p.close(); t('failed load: says so, keeps nothing, waits before asking again ok');

  // near SUTD the shipped file is used and the service is never asked
  const home = [];
  p = await open('', async (p) => { await service(() => 500, home)(p); await fixAt(p, 1.35, 103.97); });
  assert(await waitFor(async () => /^0 of \d{3} places found$/.test(await total(p))), 'the SUTD places: ' + await total(p));
  assert.equal(home.length, 0, 'no request near SUTD');
  assert.equal(await ls(p, REGIONS), null, 'and the shipped file is not stored');
  await p.close(); t('near SUTD: no request ok');
}

console.log('Phase 7.1: the same behaviour wherever you are');
{ // helpers: a faked places service, and fixes at a given spot
  const C = { lat: 35.675, lng: 139.65 };
  const region = (c, names) => ({ source: 'OpenStreetMap contributors (ODbL)', fetched: '2026-10-09', center: c, radius: 2000,
    places: names.map((name, i) => ({ id: `node/${i + 1}`, name, type: 'cafe', lat: c.lat + dN(20 + i * 300), lng: c.lng })) });
  const service = (answer, calls) => async (p) => {                  // answer(callNumber, centreAskedFor) = a region, a status number, or 'hang' (never answered)
    await p.setRequestInterception(true);
    p.on('request', (r) => {
      if (!r.url().includes('/places?')) return r.continue();
      calls.push(r.url());
      const u = new URL(r.url());
      const a = answer(calls.length, { lat: Number(u.searchParams.get('lat')), lng: Number(u.searchParams.get('lng')) });
      if (a === 'hang') return;
      const headers = { 'access-control-allow-origin': '*' };
      if (typeof a === 'number') return r.respond({ status: a, contentType: 'application/json', headers, body: '{"error":"x"}' }).catch(() => {});
      r.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(a) }).catch(() => {});
    });
  };
  const fixAt = (p, lat, lng) => p.setGeolocation({ latitude: lat, longitude: lng, accuracy: 10 });
  const total = (p) => stats(p).then((s) => s.places);
  const tune = (t) => (p) => p.evaluateOnNewDocument((t) => { window.__tuning = t; }, t);
  const phone = async () => { const c = await browser.createBrowserContext(); await c.overridePermissions(ORIGIN, ['geolocation']); return c; };

  // the reported bug: places load for the first time over fog cleared in an earlier visit (the service was down then)
  const device = await phone();
  const down = [];
  let p = await open('', async (p) => { await service(() => 502, down)(p); await fixAt(p, C.lat + 0.00001, C.lng); }, { ctx: device });
  assert(await waitFor(async () => (await total(p)) === 'No places loaded for this area yet'), 'visit 1: no places: ' + await total(p));
  assert((await count(p)) > 20, 'but the fog clears');
  await p.evaluate(() => dispatchEvent(new Event('pagehide')));        // the fog is saved
  await p.close();
  const up = [];
  p = await open('', async (p) => { await service(() => region(C, ['Under Old Fog', 'Far Cafe']), up)(p); await fixAt(p, C.lat + 0.00001, C.lng); }, { ctx: device });
  assert(await waitFor(async () => (await total(p)) === '1 of 2 places found'), 'visit 2: the place under the old fog is found: ' + await total(p));
  assert.deepEqual(await pins(p), ['Under Old Fog']);
  assert((await toasts(p)).includes('Found Under Old Fog'), 'it is announced: ' + (await toasts(p)).join('|'));
  let st = await stats(p);
  assert.equal(st.chip, '1 of 3 places today', "and it counts toward today's goal"); assert.equal(st.last, 'Last: Under Old Fog');
  assert.deepEqual(JSON.parse(await ls(p, 'fogwalk:found:v1')).ids, ['node/1'], 'and the device remembers it');
  await sleep(300); await p.close();
  // visit 3: a reload does not announce or count it again
  p = await open('', async (p) => { await service((n, c) => region(c, c.lat === C.lat ? ['Under Old Fog', 'Far Cafe'] : ['Elsewhere']), [])(p); await fixAt(p, C.lat + 0.00001, C.lng); }, { ctx: device });
  assert(await waitFor(async () => (await total(p)) === '1 of 2 places found'));
  await sleep(500);
  assert.deepEqual(await toasts(p), [], 'visit 3: not announced again');
  assert.equal((await stats(p)).chip, '1 of 3 places today', 'nor counted twice');
  assert.deepEqual(await pins(p), ['Under Old Fog'], 'its pin is there');
  // walk out to another region and back to this one: still not announced again
  await fixAt(p, 35.6894, 139.6501);
  assert(await waitFor(async () => (await total(p)) === '0 of 1 places found'), 'the next region: ' + await total(p));
  await fixAt(p, C.lat + 0.00001, C.lng);
  assert(await waitFor(async () => (await total(p)) === '1 of 2 places found'), 'back in the first region');
  assert.deepEqual((await toasts(p)).filter((x) => x.startsWith('Found')), [], 'returning to a region does not announce its finds again');
  await p.close(); await device.close(); t('places loaded over old fog are found, once ok');

  // places that load over fog from an earlier visit also count toward today's goal, in the chip and in the panel
  const tdev = await phone();
  p = await open('', async (p) => { await service(() => 502, [])(p); await fixAt(p, C.lat + 0.00001, C.lng); }, { ctx: tdev });
  assert(await waitFor(async () => (await total(p)) === 'No places loaded for this area yet'));
  await p.evaluate(() => dispatchEvent(new Event('pagehide'))); await p.close();
  p = await open('', async (p) => { await service(() => region(C, ['Under Old Fog', 'Far Cafe', 'Third Cafe']), [])(p); await fixAt(p, C.lat + 0.00001, C.lng); }, { ctx: tdev });
  assert(await waitFor(async () => (await total(p)) === '1 of 3 places found'));
  assert.equal((await stats(p)).chip, '1 of 3 places today', "today's goal counts the find");
  await p.close(); await tdev.close(); t('today counts finds under old fog ok');

  // a request that never answers is a failure after the time limit, and is asked again after the wait
  const hung = [];
  const hdev = await phone();
  p = await open('', async (p) => { await tune({ timeoutMs: 700, retryMs: 1200 })(p); await service((n) => (n === 1 ? 'hang' : region(C, ['Shibuya Cafe', 'Far Cafe'])), hung)(p); await fixAt(p, 35.6762, 139.6503); }, { ctx: hdev });
  assert(await waitFor(async () => (await total(p)) === 'No places loaded for this area yet', 6000), 'a hung request becomes a failure: ' + await total(p));
  assert.equal(hung.length, 1);
  await sleep(1300); await fixAt(p, 35.6763, 139.6503);
  assert(await waitFor(async () => (await total(p)) === '0 of 2 places found', 6000), 'and the next step asks again: ' + await total(p));
  assert.equal(hung.length, 2);
  await p.close(); await hdev.close(); t('hung request: failure, then asked again ok');

  // an empty answer may be a throttled server: asked again, twice, then believed
  const empties = [];
  const edev = await phone();
  p = await open('', async (p) => { await tune({ retryMs: 800 })(p); await service((n) => (n === 1 ? region(C, []) : region(C, ['Shibuya Cafe'])), empties)(p); await fixAt(p, 35.6762, 139.6503); }, { ctx: edev });
  assert(await waitFor(async () => empties.length === 1));
  await sleep(300);
  assert.equal(await total(p), '0 places found', 'an empty region');
  assert.equal(await ls(p, 'fogwalk:regions:v1'), null, 'is not kept on the phone');
  await sleep(900); await fixAt(p, 35.6763, 139.6503);
  assert(await waitFor(async () => (await total(p)) === '0 of 1 places found'), 'asked again, and the places arrive: ' + await total(p));
  assert.equal(empties.length, 2);
  await p.close();
  const always = [];
  const edev2 = await phone();                                           // a device with nothing stored
  p = await open('', async (p) => { await tune({ retryMs: 500 })(p); await service(() => region(C, []), always)(p); await fixAt(p, 35.6762, 139.6503); }, { ctx: edev2 });
  for (let i = 1; i <= 8; i++) { await sleep(700); await fixAt(p, 35.6762 + i * 0.00001, 139.6503); }
  assert.equal(always.length, 3, 'a really empty area is asked three times, not for ever (' + always.length + ')');
  await p.close(); await edev.close(); await edev2.close(); t('empty answer: asked again twice, then accepted ok');

  // you walk out of a region, the next one fails, and you carry on: the region you left must not stay
  const far = [];
  const fdev = await phone();
  p = await open('', async (p) => { await service((n) => (n === 1 ? region(C, ['Shibuya Cafe', 'Far Cafe']) : 502), far)(p); await fixAt(p, C.lat + 0.00005, C.lng); }, { ctx: fdev });
  assert(await waitFor(async () => (await pins(p)).length === 1), 'a found pin in the first region');
  await fixAt(p, 35.6876, 139.6576);                                   // 1.6 km out: a new region is asked for, and fails
  assert(await waitFor(async () => far.length === 2), 'asked for the next region');
  await sleep(500);
  await fixAt(p, 35.6924, 139.6624);                                   // 2.2 km out, same new region: the failure wait is still running
  assert(await waitFor(async () => (await total(p)) === 'No places loaded for this area yet' && (await pins(p)).length === 0, 4000), 'the region left behind is gone: ' + await total(p) + ' ' + JSON.stringify(await pins(p)));
  assert.equal(far.length, 2, 'and the failed region is not asked for again at once');
  await p.close(); await fdev.close(); t('a failed next region does not keep the old one on screen ok');

  // a device that already had fog from before the found list existed: what was under that fog was shown as found, so it stays quiet, once
  const ldev = await phone();
  const spot = { lat: C.lat + dN(20), lng: C.lng };                     // 'Under Old Fog' is here
  const lcalls = [];
  p = await open('', async (p) => {
    await p.evaluateOnNewDocument((keys, fogKey) => localStorage.setItem(fogKey, JSON.stringify({ keys })), [cellKey(...cellOf(spot.lat, spot.lng))], REAL);
    await service(() => region(C, ['Under Old Fog', 'Far Cafe']), lcalls)(p); await fixAt(p, C.lat + 0.00001, C.lng);
  }, { ctx: ldev });
  assert(await waitFor(async () => (await total(p)) === '1 of 2 places found'), 'legacy device: ' + await total(p));
  await sleep(500);
  assert.deepEqual(await toasts(p), [], 'no burst of old finds');
  assert.equal((await stats(p)).chip, 'Find 3 places today', "and today's goal does not jump");
  assert.deepEqual(JSON.parse(await ls(p, 'fogwalk:found:v1')).ids, ['node/1'], 'but it is remembered as found');
  await p.close(); await ldev.close(); t('a device with older fog stays quiet once ok');

  // the debug reset forgets finds too, so re-walking the same route announces them again
  const dbg = await open('?debug', fakePlaces({ places: [{ name: 'Right Here', type: 'cafe', lat: S0.lat + dN(10), lng: S0.lng }] })); await sleep(800);
  assert.deepEqual(await toasts(dbg), ['Found Right Here']);
  await dbg.click('#debugReset'); await sleep(2500);
  assert.deepEqual(await toasts(dbg), ['Found Right Here'], 'after reset it is a find again');
  await dbg.close(); t('debug reset forgets finds ok');
}

console.log('Phase 9: quests');
const questState = (p) => p.evaluate(() => fogMap.quest());
const pinCount = (p) => p.evaluate(() => document.querySelectorAll('.quest-pin').length);
const QUEST = { quests: true };
// the quest lives top right: a flag button (its label says how far along you are) and the card under it (the line, and the detail)
const flag = (p) => p.evaluate(() => { const b = document.getElementById('questBtn'); return b.hidden ? null : b.getAttribute('aria-label').replace(/^Quest: |\. Details$/g, ''); });
const card = (p) => p.evaluate(() => document.getElementById('questCard').hidden ? null
  : { line: document.getElementById('questLine').textContent, detail: document.getElementById('questDetail').textContent, gemma: !document.getElementById('questBy').hidden });
const flagRingAt = (p, progress) => waitFor(async () => Math.abs((await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#questBtn .ring-arc')).strokeDashoffset))) - RING * (1 - progress)) < 0.01, 3000);
let q;
{ // fake places, real-mode fixes: a reach quest, then a find quest, then nothing left (the flag goes away)
  const places = [0, 250, 700, 1000].map((n, i) => ({ name: `Spot ${i}`, type: 'cafe', lat: S0.lat + dN(n), lng: S0.lng }));
  places.shift(); places.unshift({ name: 'Home', type: 'cafe', lat: S0.lat + dN(90), lng: S0.lng });   // 90 m: close, but outside the reveal circle and the 150 m band
  const p = await open('', async (p) => { await captureFix(p); await fakePlaces({ places })(p); }, QUEST); await sleep(800);
  const fixAt = (n) => p.evaluate((c) => window.__fix({ coords: c }), { latitude: S0.lat + dN(n), longitude: S0.lng, accuracy: 20 });
  const detail = () => p.evaluate(() => document.getElementById('toastDetail').textContent);
  const chip = () => p.evaluate(() => document.getElementById('chip').getAttribute('aria-label')).then(goalLabel);
  assert.equal(await questState(p), null, 'no position yet: no quest');
  assert.equal(await flag(p), null, 'and no quest flag');
  assert.equal(await chip(), 'Find 3 places today', 'the chip shows today\'s goal');
  await fixAt(0); await sleep(500);
  q = await questState(p);
  assert.deepEqual([q.kind, q.seq, q.done, q.key.startsWith('Spot 1|')], ['reach', 0, false, true], 'the first fix starts a reach quest, aimed at the one place in the 150-400 m band');
  assert.equal(await flag(p), 'Find the hidden spot, 250 m', 'the flag says what to do');
  assert.equal(await p.evaluate(() => document.getElementById('questDist').textContent), '250 m', 'and the pill itself shows the distance, so the card need not be opened');
  assert.deepEqual(await card(p), { line: 'A cafe is hiding in the fog nearby. Can you find it?', detail: '', gemma: false }, 'a new quest opens its card: one plain line, no direction (Gemma is off)');
  assert.equal(await chip(), 'Find 3 places today', 'the chip keeps today\'s goal');
  const top = await p.evaluate(() => ({ flag: document.getElementById('questBtn').getBoundingClientRect().toJSON(), chip: document.getElementById('chip').getBoundingClientRect().toJSON(), card: document.getElementById('questCard').getBoundingClientRect().toJSON() }));
  assert(top.flag.right >= 390 - 16 - 1 && top.flag.top <= 20, `the flag sits in the top-right corner (${JSON.stringify(top.flag)})`);
  assert(top.chip.right <= top.flag.left, 'beside the chip, not over it');
  assert(top.card.right >= 390 - 16 - 1 && top.card.top >= top.flag.bottom, 'its card hangs under it, on the right');
  assert.equal(await pinCount(p), 0, 'the spot is not marked on the map: the hint has to do the work');
  await shot(p, 'quest-reach');
  assert.deepEqual(await pins(p), [], 'and the place itself is hidden under the fog');
  await p.mouse.click(195, 600); await sleep(300);
  assert.equal(await card(p), null, 'a tap on the map closes the card');
  // the wrong way: well past 1.5 times the start distance
  await fixAt(-150); await sleep(400);
  assert.deepEqual([(await toasts(p)).at(-1), await detail()], ['Colder', 'Follow the light'], 'heading away says colder, and points at the light (no compass word)');
  await fixAt(-160); await sleep(400);
  assert.equal((await toasts(p)).filter((x) => x === 'Colder').length, 1, 'once, not on every step');
  await fixAt(100); await sleep(400);   // 'Home' (90 m) clears on the way
  assert.equal(await flag(p), 'Find the hidden spot, 150 m', 'the distance follows you, rounded to 10 m');
  assert.equal(await detail(), 'Cafe', 'finding another place does not finish the quest');
  assert(await flagRingAt(p, 0.4), 'the flag\'s ring is 100/250 full (distance walked so far)');
  assert.equal(await chip(), '1 of 3 places today', 'while the chip counts today\'s finds');
  assert.equal(await pinCount(p), 0, 'still not marked');
  // got 100 m closer, then drifted 70 m back out: lost, so the spot is marked
  await fixAt(30); await sleep(400);
  assert.deepEqual([(await toasts(p)).at(-1), await detail()], ['The quest spot is on the map', 'Follow the flag'], 'drifting back out after getting close marks the spot, and says so');
  assert.equal(await pinCount(p), 1, 'its spot is marked on the map now');
  assert.equal(await flag(p), 'Reach the marked spot, 220 m');
  const spot = await p.evaluate(() => { const e = document.querySelector('.quest-pin'), d = e.querySelector('.quest-disc'), cs = getComputedStyle(d), pane = e.closest('.leaflet-pane');
    return { pane: pane.className, z: Number(getComputedStyle(pane).zIndex), fog: Number(getComputedStyle(document.querySelector('.leaflet-fog-pane')).zIndex), bg: cs.backgroundColor, title: e.title, flag: !!d.querySelector('svg path') }; });
  assert.match(spot.pane, /leaflet-quest-pane/, 'in its own pane');
  assert(spot.z > spot.fog, 'above the fog, so the fog does not hide it');
  assert.equal(spot.bg, 'rgb(238, 243, 248)', 'daylight, not gold: gold is for discoveries'); assert.equal(spot.title, 'Quest spot'); assert(spot.flag, 'a flag, so it reads without colour');
  await p.evaluate(() => document.querySelector('.quest-pin').click()); await sleep(300);
  assert.equal(await p.evaluate(() => document.querySelector('.leaflet-popup-content')?.textContent), 'Reach the marked spot, 220 m', 'tapping it says how far away it is');
  await fixAt(110); await sleep(400);   // closer than ever: the quest is saved again
  assert.equal(await p.evaluate(() => document.querySelector('.leaflet-popup-content')?.textContent), 'Reach the marked spot, 220 m', 'a step closer keeps the marker and its open popup');
  await p.mouse.click(195, 600); await sleep(300);                       // (the unlocked clue had opened it) a tap on the map closes it
  assert.equal(await card(p), null, 'closed');
  await p.click('#questBtn'); await sleep(300);
  await shot(p, 'quest-card');
  assert.equal((await card(p)).line, 'Stuck? Follow the light.', 'the pill opens the card again: the clue you are on');
  await p.click('#chip'); await sleep(300);
  assert.deepEqual([await card(p), await p.evaluate(() => document.getElementById('stats').hidden)], [null, false], 'one card at a time: the stats card replaces it');
  assert.equal(await p.evaluate(() => document.getElementById('statsTitle').textContent), 'Today', 'and is about today');
  await p.click('#chip'); await sleep(200);
  await fixAt(250); await sleep(500);
  assert.equal(await flag(p), 'Quest done'); assert.equal(await detail(), 'Quest done', 'the find message says so');
  assert.equal(await p.evaluate(() => document.getElementById('questDist').textContent), 'Done', 'the pill says Done');
  assert.deepEqual(await card(p), { line: 'Found it: Spot 1', detail: 'A cafe is hiding in the fog nearby. Can you find it?', gemma: false }, 'and the card opens by itself with the payoff: what the hint was pointing at');
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('questGemma')).display), 'none', 'without the Gemma offer: the card is celebrating');
  await shot(p, 'quest-done');
  assert(await flagRingAt(p, 1), 'the ring is full'); assert.equal(await pinCount(p), 0, 'the spot marker is gone: the place\'s own gold pin took over');
  assert((await pins(p)).includes('Spot 1'), 'the place is on the map now');
  q = await questState(p); assert.deepEqual([q.kind, q.done], ['reach', true]);
  assert(await waitFor(async () => (await flag(p)) === 'Find 2 new places', 8000), 'a few seconds later the next quest starts: find 2 new places');
  q = await questState(p); assert.deepEqual([q.kind, q.seq, q.need, q.ids], ['find', 1, 2, []]);
  assert.deepEqual(await card(p), { line: 'Somewhere near, new places are waiting. Uncover 2 new places.', detail: '', gemma: false }, 'its card opens, starting from where you are');
  assert.equal(await pinCount(p), 0, 'a find quest has no marker');
  await fixAt(700); await sleep(400);
  assert.equal(await flag(p), '1 of 2 new places'); assert(await flagRingAt(p, 0.5), 'half way round');
  await shot(p, 'quest-find');
  // a reload mid-quest keeps it, with its progress (the same device: shared storage)
  const ctx = p.browserContext(); await p.close();
  const again = await open('', async (p) => { await captureFix(p); await fakePlaces({ places })(p); }, { ...QUEST, ctx }); await sleep(800);
  q = await questState(again); assert.deepEqual([q.kind, q.seq, q.ids.length, q.done], ['find', 1, 1, false], 'the quest and its progress come back');
  assert.equal(await flag(again), '1 of 2 new places', 'and so does the flag');
  assert.equal(await again.evaluate(() => document.getElementById('chip').getAttribute('aria-label')).then(goalLabel), 'Today’s goal done', 'today\'s count came back too');
  const fixAgain = (n) => again.evaluate((c) => window.__fix({ coords: c }), { latitude: S0.lat + dN(n), longitude: S0.lng, accuracy: 20 });
  await fixAgain(1000); await sleep(500);
  assert.equal(await again.evaluate(() => document.getElementById('toastDetail').textContent), 'Quest done');
  assert(await waitFor(async () => (await again.evaluate(() => fogMap.quest())) === null, 8000), 'nothing left to find: no new quest');
  assert.deepEqual([await flag(again), await card(again)], [null, null], 'and the flag and its card go away');
  await again.close(); t('reach, find, reload, nothing left ok');
}
{ // the saved quest comes back open after a reload; and if its place was cleared while the page was closed, that still finishes it
  const lat = S0.lat + dN(250), lng = S0.lng;
  const places = [{ name: 'Spot A', type: 'cafe', lat, lng }, { name: 'Spot B', type: 'cafe', lat: S0.lat + dN(700), lng }];
  const reach = { kind: 'reach', seq: 0, done: false, key: `Spot A|${lat}|${lng}`, lat, lng, start: 250, text: 'Gemma said: go north into the fog.' };   // saved before hints: no t / best / revealed
  const seeded = (fogKeys, r = reach) => async (p) => {
    await captureFix(p); await fakePlaces({ places })(p);
    await p.evaluateOnNewDocument((r, keys, fogKey) => { localStorage.setItem('fogwalk:quest', JSON.stringify(r)); if (keys) localStorage.setItem(fogKey, JSON.stringify({ keys })); }, r, fogKeys, REAL);
  };
  const open1 = await open('', seeded(null), QUEST); await sleep(800);
  q = await questState(open1);
  assert.deepEqual([q.kind, q.done, q.key], ['reach', false, reach.key], 'a saved open reach quest is back after a reload');
  assert.equal(await pinCount(open1), 1, 'with its marker (saved before hints, so already marked)'); assert.equal(await flag(open1), 'Reach the marked spot, 250 m');
  assert.deepEqual(await card(open1), { line: reach.text, detail: '', gemma: true }, 'and the line Gemma wrote for it (a Phase 9 save: its first clue), credited');
  await open1.close();
  const fresh = await open('', seeded(null, { ...reach, t: Date.now(), best: 250, revealed: false }), QUEST); await sleep(800);
  assert.deepEqual([await pinCount(fresh), await flag(fresh)], [0, 'Find the hidden spot, 250 m'], 'a quest still being looked for comes back hidden');
  await fresh.close();
  const stale = await open('', seeded(null, { ...reach, t: Date.now() - 6 * 60_000, best: 250, revealed: false }), QUEST); await sleep(800);
  assert.deepEqual([await pinCount(stale), await flag(stale)], [1, 'Reach the marked spot, 250 m'], 'one looked for over 5 minutes comes back marked');
  assert.deepEqual(await toasts(stale), ['The quest spot is on the map'], 'and says so');
  assert.equal((await stale.evaluate(() => JSON.parse(localStorage.getItem('fogwalk:quest')))).revealed, true, 'which is saved');
  await stale.close();
  const open2 = await open('', seeded([cellKey(...cellOf(lat, lng))]), QUEST); await sleep(800);   // the fog saved on this device already covers Spot A
  assert.equal((await questState(open2)).done, true, 'its place is already cleared: the quest is done, quietly');
  assert.equal(await flag(open2), 'Quest done');
  assert.deepEqual(await toasts(open2), [], 'no find message for a place that was found before this visit');
  await open2.evaluate((c) => window.__fix({ coords: c }), { latitude: S0.lat, longitude: S0.lng, accuracy: 20 });   // the next quest needs to know where you are
  assert(await waitFor(async () => (await questState(open2))?.kind === 'find', 8000), 'and the next quest follows');
  await open2.close(); t('saved quest restored, quiet completion ok');
}
{ // every place is right here: no reach quest is possible, so a find quest starts instead of none
  const places = [{ name: 'Next Door', type: 'cafe', lat: S0.lat + dN(55), lng: S0.lng }];
  const p = await open('', async (p) => { await captureFix(p); await fakePlaces({ places })(p); }, QUEST); await sleep(800);
  await p.evaluate((c) => window.__fix({ coords: c }), { latitude: S0.lat, longitude: S0.lng, accuracy: 20 }); await sleep(500);
  q = await questState(p);
  assert.deepEqual([q.kind, q.seq, q.need], ['find', 1, 1], 'a find quest for the one place, not nothing');
  assert.equal(await flag(p), 'Find 1 new place');
  await p.close(); t('no reach target: find quest instead ok');
}
{ // damaged or foreign saved quest data is ignored, and a quest whose place is gone from the file is replaced
  const places = [{ name: 'Spot A', type: 'cafe', lat: S0.lat + dN(250), lng: S0.lng }];
  const cases = [['{{{', 'reach', 0], ['{"kind":"reach"}', 'reach', 0], ['"x"', 'reach', 0],
    [JSON.stringify({ kind: 'reach', seq: 4, done: false, key: 'gone|1|2', lat: 1, lng: 2, start: 300 }), 'find', 5]];   // valid, but its place is not in the file: replaced by the next quest in line
  for (const [bad, kind, seq] of cases) {
    const p = await open('?debug', async (p) => { await fakePlaces({ places })(p); await p.evaluateOnNewDocument((v) => localStorage.setItem('fogwalk:quest:debug', v), bad); }, QUEST); await sleep(1000);
    const q = await questState(p);
    assert(q && q.kind === kind && q.seq === seq && !q.done, `saved value ${bad.slice(0, 30)} gives a fresh ${kind} quest ` + JSON.stringify(q));
    await p.close();
  }
  t('damaged saved quest ignored ok');
}
{ // the real data in a debug walk: walk to the marked spot and finish the quest, then reset starts over from the first quest
  const p = await open('?debug=30', undefined, QUEST); await sleep(1500);
  q = await questState(p);
  assert.deepEqual([q.kind, q.seq, q.done], ['reach', 0, false], 'a reach quest from the real places');
  assert(q.start >= 60 && q.start <= 2000, 'with a sensible distance: ' + Math.round(q.start));
  assert.match(await flag(p), /^Find the hidden spot, /, 'its spot starts hidden');
  assert.match((await card(p)).line, /^An? [a-z ]+ is hiding in the fog nearby\. Can you find it\?$/, 'the plain line names the kind of place, not the place, and no direction');
  await p.evaluate((lat, lng) => fogMap.map.fire('click', { latlng: { lat, lng } }), q.lat, q.lng);
  assert(await waitFor(async () => (await questState(p))?.done === true, 60000), 'walking to the spot finishes the quest');
  assert.equal(await flag(p), 'Quest done');
  assert((await toasts(p)).length > 0, 'with a find message');
  assert(await waitFor(async () => (await questState(p))?.kind === 'find', 8000), 'and a find quest follows');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('fogwalk:quest:debug')));
  assert.equal(saved.seq, 1, 'it is saved (under the debug key, apart from a real walk)');
  assert.equal(await p.evaluate(() => localStorage.getItem('fogwalk:quest')), null, 'a simulated walk never touches the real quest');
  await p.click('#debugReset'); await sleep(2000);
  q = await questState(p); assert.deepEqual([q.kind, q.seq], ['reach', 0], 'reset starts the quests over');
  await p.close(); t('real data: walk, finish, next, reset ok');
}
{ // ?quests=off is the plain map: no quest, no flag, no Gemma switch, today's goal on the chip
  const p = await open('?debug', undefined); await sleep(1500);
  assert.equal(await questState(p), null); assert.equal(await pinCount(p), 0); assert.equal(await flag(p), null);
  assert.equal(await p.evaluate(() => document.getElementById('gemmaSwitch').hidden), true);
  assert.equal(await p.evaluate(() => document.getElementById('chip').getAttribute('aria-label')).then(goalLabel), 'Find 3 places today');
  assert.equal(await p.evaluate(() => localStorage.getItem('fogwalk:quest:debug')), null, 'and nothing is saved for quests');
  await p.close(); t('quests off ok');
}
{ // a crowd of pins: of places found close together, only the newest pin shows; zooming in spreads them out and brings the rest back
  const places = [0, 1, 2].map((i) => ({ name: `Stall ${i}`, type: 'cafe', lat: S0.lat + dN(10 * i), lng: S0.lng }));   // 10 m apart: one spot at street zoom
  const p = await open('?debug', fakePlaces({ places })); await sleep(1500);
  const shown = () => p.evaluate(() => [...document.querySelectorAll('.place-pin')].filter((e) => e.style.display !== 'none').map((e) => e.title));
  assert.equal((await pins(p)).length, 3, 'all three are found');
  assert.deepEqual(await shown(), ['Stall 2'], 'one pin shows for the crowd: the newest find');
  await shot(p, 'pins-crowded');
  await p.evaluate(() => fogMap.map.setZoom(19)); await sleep(1200);
  assert.deepEqual((await shown()).sort(), ['Stall 0', 'Stall 1', 'Stall 2'], 'zoomed in, they all show');
  await p.evaluate(() => fogMap.map.setZoom(17)); await sleep(1200);
  assert.equal((await shown()).length, 1, 'zoomed back out, one again');
  await p.close(); t('crowded pins ok');
}
{ // the Gemma switch, without the real model: off by default with its size; where there's no WebGPU it says so and can't be turned on
  const p = await open('?debug', undefined, QUEST); await sleep(1500);
  await p.click('#chip'); await sleep(300);
  const sw = () => p.evaluate(() => { const s = document.getElementById('gemmaSwitch'); return { shown: !s.hidden, on: s.getAttribute('aria-checked'), off: s.disabled, note: document.getElementById('gemmaNote').textContent }; });
  const gpu = await p.evaluate(() => !!navigator.gpu);
  assert.deepEqual(await sw(), gpu ? { shown: true, on: 'false', off: false, note: '800 MB download, runs on this phone' }
    : { shown: true, on: 'false', off: true, note: 'Needs WebGPU, which this browser lacks' }, 'the switch says what turning it on costs');
  await shot(p, 'gemma-switch');
  await p.close();
  const none = await open('?debug', (p) => p.evaluateOnNewDocument(() => { Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }); }), QUEST); await sleep(1500);
  assert.deepEqual(await none.evaluate(() => [document.getElementById('gemmaSwitch').disabled, document.getElementById('gemmaNote').textContent]), [true, 'Needs WebGPU, which this browser lacks'], 'no WebGPU: it says so, and stays off');
  await none.close(); t('Gemma switch ok');
}
if (process.env.GEMMA) { // the real Gemma (GEMMA=1; an ~800 MB download on a fresh profile): switch it on and the quest line becomes Gemma's, checked and credited
  const p = await open('?debug', undefined, QUEST); await sleep(1500);
  const rejected = []; p.on('console', (m) => { if (m.text().startsWith('Gemma clue rejected')) rejected.push(m.text()); });
  await p.click('#chip'); await sleep(300);
  await p.click('#gemmaSwitch');
  assert(await waitFor(async () => (await p.evaluate(() => document.getElementById('gemmaNote').textContent)) === 'Runs on this phone, offline', 600000), 'Gemma loads');
  assert(await waitFor(async () => ((await questState(p))?.clues?.length ?? 0) >= 3, 120000), 'and writes the open quest its three clues (rejected: ' + rejected.join(' | ') + ')');
  if (rejected.length) console.log('    rejected first: ' + rejected.join(' | '));
  q = await questState(p);
  await p.click('#chip'); await p.click('#questBtn'); await sleep(300);
  const c = await card(p);
  assert.deepEqual([c.line, c.gemma], [q.clues[0], true], 'the card shows the first clue, credited to Gemma');
  console.log('    Gemma wrote: ' + q.clues.join(' | '));
  await shot(p, 'quest-gemma');
  const ctx = p.browserContext(); await p.close();
  const again = await open('?debug', undefined, { ...QUEST, ctx }); await sleep(1500);
  assert.deepEqual((await questState(again)).clues, q.clues, 'after a reload the quest keeps its clues');
  assert(await waitFor(async () => (await again.evaluate(() => document.getElementById('gemmaNote').textContent)) === 'Runs on this phone, offline', 300000), 'and Gemma comes back on by itself');
  await again.close(); t('real Gemma ok');
}


{ // quests and regions: the quest follows you across a region change, as long as its place is still on the list
  const TOKYO = { lat: 35.675, lng: 139.65 }, NEW = { lat: 35.69, lng: 139.65 };
  const place = (id, name, c, n) => ({ id, name, type: 'cafe', lat: c.lat + dN(n), lng: c.lng });
  const region = (c, places) => ({ source: 'OpenStreetMap contributors (ODbL)', fetched: '2026-10-09', center: c, radius: 2000, places });
  const MID = place('node/2', 'Mid Cafe', TOKYO, 320);                               // 320 m north of the first centre: the reach target
  const first = region(TOKYO, [place('node/1', 'Near Cafe', TOKYO, 20), MID]);
  const service = (answer, calls) => async (p) => {
    await p.setRequestInterception(true);
    p.on('request', (r) => {
      if (!r.url().includes('/places?')) return r.continue();
      calls.push(r.url());
      const a = answer(new URL(r.url()));
      if (a === 'abort') return r.abort().catch(() => {});
      r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(a) }).catch(() => {});
    });
  };
  const fixAt = (p, lat, lng) => p.setGeolocation({ latitude: lat, longitude: lng, accuracy: 25 });
  const start = async (answer) => {
    const calls = [], device = await browser.createBrowserContext(); await device.overridePermissions(ORIGIN, ['geolocation']);
    const p = await open('', async (p) => { await service(answer, calls)(p); await fixAt(p, 35.6762, 139.6503); }, { ...QUEST, ctx: device });
    assert(await waitFor(async () => (await questState(p))?.kind === 'reach', 8000), 'a reach quest starts in the first region: ' + JSON.stringify(await questState(p)));
    assert.equal((await questState(p)).key, 'node/2', 'aimed at the place 320 m away');
    return p;
  };
  // 1. the new region does not have its place: the reach quest is replaced by the next one in line
  let p = await start((u) => (Math.abs(Number(u.searchParams.get('lat')) - NEW.lat) < 0.001 ? region(NEW, [place('node/11', 'Uptown Bar', NEW, 20), place('node/12', 'Uptown Cafe', NEW, 320)]) : first));
  await fixAt(p, 35.6894, 139.6501);
  assert(await waitFor(async () => (await questState(p))?.seq === 1, 8000), 'walking out: the old reach quest is replaced');
  assert.equal((await questState(p)).kind, 'find', 'by the next quest in line');
  assert.notEqual(await flag(p), null, 'and the pill is still there');
  await p.close();
  // 2. the new region still lists it: the quest carries on, unchanged
  p = await start((u) => (Math.abs(Number(u.searchParams.get('lat')) - NEW.lat) < 0.001 ? region(NEW, [place('node/11', 'Uptown Bar', NEW, 20), MID]) : first));
  const before = await questState(p);
  await fixAt(p, 35.6894, 139.6501);
  assert(await waitFor(async () => (await toasts(p)).includes('New area'), 8000), 'walked into the new region');
  const after = await questState(p);
  assert.deepEqual([after.seq, after.key], [before.seq, before.key], 'the same quest carries on');
  await p.close();
  // 3. the new region fails to load: while you wait, a quest whose place is still within reach stays
  p = await start((u) => (Math.abs(Number(u.searchParams.get('lat')) - TOKYO.lat) < 0.001 ? first : 'abort'));
  await fixAt(p, 35.6939, 139.6503);                                                  // 2.1 km from the centre: the region is dropped, the place is 1.8 km from you
  assert(await waitFor(async () => (await stats(p)).places === '0 places found', 8000), 'the old region is gone');
  assert.equal((await questState(p))?.key, 'node/2', 'but the quest stays while the next region is awaited');
  await p.close(); t('quest across region changes ok');
}
{ // the first-open bubble holds a new quest's card back; the pill is there, and a tap opens the card
  const places = [{ name: 'Spot 1', type: 'cafe', lat: S0.lat + dN(250), lng: S0.lng }];
  const p = await open('', async (p) => { await captureFix(p); await fakePlaces({ places })(p); }, { ...QUEST, hint: true }); await sleep(800);
  await p.evaluate((c) => window.__fix({ coords: c }), { latitude: S0.lat, longitude: S0.lng, accuracy: 20 }); await sleep(500);
  assert.equal(await p.evaluate(() => document.getElementById('hint').hidden), false, 'the bubble is up');
  assert.notEqual(await flag(p), null, 'the pill shows');
  assert.equal(await card(p), null, 'but its card is not opened over the bubble');
  await p.click('#questBtn'); await sleep(300);
  assert.notEqual(await card(p), null, 'a tap on the pill opens it');
  await p.close(); t('first-open bubble holds the card back ok');
}
{ // the card offers Gemma while it is off (and the browser can run it); it is not offered where there is no WebGPU
  const open1 = (setup) => open('', async (p) => { await captureFix(p); await fakePlaces({ places: [{ name: 'Spot 1', type: 'cafe', lat: S0.lat + dN(250), lng: S0.lng }] })(p); if (setup) await setup(p); }, QUEST);
  const fix = (p) => p.evaluate((c) => window.__fix({ coords: c }), { latitude: S0.lat, longitude: S0.lng, accuracy: 20 });
  const gpu = await (async () => { const p = await open(''); const g = await p.evaluate(() => !!navigator.gpu); await p.close(); return g; })();
  const a = await open1(); await sleep(800); await fix(a); await sleep(500);
  const offer = () => a.evaluate(() => { const b = document.getElementById('questGemma'); return b.hidden ? null : b.textContent.trim(); });
  assert.equal(await offer(), gpu ? 'Let Gemma write your riddles 800 MB, once · runs on this phone · Wi-Fi recommended' : null, 'the card offers Gemma, with its size, only where it can run');
  await a.close();
  const none = await open1((p) => p.evaluateOnNewDocument(() => { Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }); })); await sleep(800); await fix(none); await sleep(500);
  assert.equal(await none.evaluate(() => document.getElementById('questGemma').hidden), true, 'no WebGPU: no offer');
  await none.close(); t('Gemma offer in the card ok');
}
{ // the wisp: help you earn by trying. Not there at the start; out after a while of looking; it points at the spot; close to it, it circles the area
  const lat = S0.lat, lng = S0.lng + dE(250);                           // the spot is 250 m due east of S0
  const places = [{ name: 'Spot E', type: 'cafe', lat, lng }];
  const reach = (extra) => ({ kind: 'reach', seq: 0, done: false, key: `Spot E|${lat}|${lng}`, lat, lng, start: 250, t: Date.now(), best: 250, help: false, revealed: false, ...extra });
  const seeded = (r) => async (p) => { await captureFix(p); await fakePlaces({ places })(p); await p.evaluateOnNewDocument((r) => localStorage.setItem('fogwalk:quest', JSON.stringify(r)), r); };
  const fix = (p, m) => p.evaluate((c) => window.__fix({ coords: c }), { latitude: S0.lat, longitude: S0.lng + dE(m), accuracy: 20 });
  const wisp = (p) => p.evaluate(() => { const e = document.querySelector('.wisp'); return e && { close: e.classList.contains('is-close'), turn: e.querySelector('.wisp-turn').style.transform, ring: !!document.querySelector('.wisp-area') }; });
  const line = async (p) => (await card(p))?.line;
  // just started: the riddle only, no wisp
  let p = await open('', seeded(reach()), QUEST); await sleep(800);
  await fix(p, 0); await sleep(500);
  assert.equal(await wisp(p), null, 'no wisp at the start: it has to be earned');
  assert.equal(await line(p), 'A cafe is hiding in the fog nearby. Can you find it?', 'just the riddle (the plain line, Gemma is off)');
  // walk the wrong way (west): colder, and the wisp comes out, with its message, a new clue and the right bearing (due east = 90 degrees)
  await fix(p, -60); await sleep(500);
  assert(await toasts(p).then((x) => x.includes('A wisp appeared')), 'a message says the light is out: ' + (await toasts(p)).join('|'));
  assert.deepEqual(await wisp(p), { close: false, turn: 'rotate(90deg)', ring: false }, 'it points east, where the spot lies');
  assert.equal(await line(p), 'Stuck? Follow the light.', 'the second clue');
  assert(await p.evaluate(() => document.querySelector('.wisp').getBoundingClientRect().left > 195), 'and it sits on the east side of the screen');
  // close: within 60 m, it leaves your side and circles the area; the last clue
  await fix(p, 200); await sleep(500);
  assert.deepEqual(await wisp(p), { close: true, turn: 'rotate(0deg)', ring: true }, 'close: it circles the area with a ring');
  assert.equal(await line(p), 'It’s right around you. Look up.', 'the last clue');
  // reaching it: the wisp goes away
  await fix(p, 250); await sleep(600);
  assert.equal(await wisp(p), null, 'found: no wisp');
  await p.close();
  // a quest looked for over 2 minutes has the wisp as soon as there is a position, and a reload keeps it
  p = await open('', seeded(reach({ t: Date.now() - 3 * 60_000 })), QUEST); await sleep(800);
  await fix(p, 0); await sleep(500);
  assert.equal((await wisp(p))?.turn, 'rotate(90deg)', 'after 2 minutes of looking: the wisp is out');
  assert.equal((await p.evaluate(() => JSON.parse(localStorage.getItem('fogwalk:quest')))).help, true, 'and it is saved');
  await shot(p, 'wisp');
  await p.close(); t('wisp: earned, points at the spot, circles when close ok');
}
{ // the Explorer badge: levels by places discovered (5, 10, 12). A dot on the medal when a level is new; the card shows what is earned and what is next
  const places = [0, 100, 200, 300, 400, 500].map((n, i) => ({ name: `Stop ${i}`, type: 'cafe', lat: S0.lat + dN(n), lng: S0.lng }));
  const p = await open('', async (p) => { await captureFix(p); await fakePlaces({ places })(p); }, QUEST); await sleep(800);
  const fixAt = (n) => p.evaluate((c) => window.__fix({ coords: c }), { latitude: S0.lat + dN(n), longitude: S0.lng, accuracy: 20 });
  const medal = () => p.evaluate(() => { const m = document.getElementById('medal'); return m.hidden ? null : { label: m.getAttribute('aria-label'), dot: m.hasAttribute('data-new') }; });
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#badgeLevels li')].map((li) => [li.className, li.querySelector('.badge-disc').textContent, li.querySelector('.badge-note').textContent]));
  await fixAt(0); await sleep(400);
  assert.deepEqual(await medal(), { label: 'Badges: Explorer, 0 of 3', dot: false }, 'the medal is there from the first find, with no dot');
  for (const n of [100, 200, 300]) { await fixAt(n); await sleep(300); }
  assert(!(await toasts(p)).includes('Badge earned'), 'four finds: no badge yet');
  await fixAt(400); await sleep(400);                                     // the fifth place
  assert.deepEqual((await toasts(p)).slice(-1), ['Found Stop 4'], 'the find message comes first');
  assert(await waitFor(async () => (await toasts(p)).includes('Badge earned'), 5000), 'then the badge message');
  assert.equal(await p.evaluate(() => document.getElementById('toastDetail').textContent), 'Explorer · 5 places');
  assert.deepEqual(await medal(), { label: 'Badges: Explorer, 1 of 3, new', dot: true }, 'and a dot on the medal');
  await p.click('#medal'); await sleep(300);
  assert.equal(await p.evaluate(() => !document.getElementById('badgeCard').hidden), true, 'the card opens');
  const r = await rows();
  assert.deepEqual([r[0][0], r[0][1], r[1], r[2]].flat().slice(0, 2), ['got', '5']);
  assert.match(r[0][2], /^Earned /, 'the earned level has its date');
  assert.deepEqual([r[1][1], r[1][2], r[2][2]], ['10', '5 of 10', 'Locked'], 'the next level shows how far it is; the one after is locked');
  assert.equal((await medal()).dot, false, 'looking at it clears the dot');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('fogwalk:badge:v1')));
  assert.deepEqual([Object.keys(saved.earned), saved.seen], [['5'], 5], 'it is saved');
  await p.click('#chip'); await sleep(300);
  assert.equal(await p.evaluate(() => [document.getElementById('badgeCard').hidden, document.getElementById('stats').hidden]).then((x) => x.join()), 'true,false', 'one card at a time');
  await p.click('#chip'); await sleep(200);
  await shot(p, 'badge-card'); await p.click('#medal'); await sleep(300); await shot(p, 'badge-card');
  await p.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await sleep(300);
  const box = await p.evaluate(() => ({ medal: document.getElementById('medal').getBoundingClientRect().toJSON(), credit: document.querySelector('.leaflet-control-attribution').getBoundingClientRect().toJSON(), card: document.getElementById('badgeCard').getBoundingClientRect().toJSON() }));
  assert(box.medal.bottom <= box.credit.top, 'the medal sits above the map credit at 320 px: ' + JSON.stringify(box));
  assert(box.card.left >= 0 && box.card.right <= 320 && box.card.bottom <= box.medal.top, 'its card is on screen, above the medal');
  // reload: earned stays, not announced again, no dot
  const ctx = p.browserContext(); await p.close();
  const again = await open('', async (p) => { await captureFix(p); await fakePlaces({ places })(p); }, { ...QUEST, ctx }); await sleep(1000);
  assert.deepEqual(await again.evaluate(() => [document.getElementById('medal').getAttribute('aria-label'), document.getElementById('medal').hasAttribute('data-new')]), ['Badges: Explorer, 1 of 3', false], 'after a reload: still earned, nothing new');
  assert(!(await toasts(again)).includes('Badge earned'), 'and not announced again');
  await again.close(); t('Explorer badge: levels, dot, card, reload ok');
}
{ // ?quests=off is the plain map: no medal
  const p = await open('?debug', undefined); await sleep(1000);
  assert.equal(await p.evaluate(() => document.getElementById('medal').hidden), true);
  await p.close(); t('no medal with quests off ok');
}
{ // a narrow phone: the Today button and the quest pill share the top row without touching, with a long distance
  const places = [{ name: 'Far Spot', type: 'cafe', lat: S0.lat + dN(390), lng: S0.lng }];
  const p = await open('', async (p) => { await captureFix(p); await fakePlaces({ places })(p); }, QUEST); await sleep(800);
  await p.setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.evaluate((c) => window.__fix({ coords: c }), { latitude: S0.lat, longitude: S0.lng, accuracy: 20 }); await sleep(500);
  const box = await p.evaluate(() => ({ chip: document.getElementById('chip').getBoundingClientRect().toJSON(), pill: document.getElementById('questBtn').getBoundingClientRect().toJSON(), card: document.getElementById('questCard').getBoundingClientRect().toJSON() }));
  assert(box.chip.right <= box.pill.left, );
  assert(box.pill.right <= 320 && box.pill.height >= 44 && box.card.right <= 320 && box.card.left >= 0, 'inside the screen with a finger-sized pill');
  await shot(p, 'quest-320');
  await p.close(); t('narrow phone with the quest pill ok');
}

assert.deepEqual(errors.filter((e) => !/Failed to load|ERR_FAILED/.test(e)), [], 'no page errors: ' + errors.join('; '));
console.log('browser suite ok (' + BASE + ')');
await browser.close();
process.exit(0);                                                 // leftover handles from the browser connection would keep Node alive
