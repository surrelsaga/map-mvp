// Part of `npm test`. The delivery rules of src/gps.ts, against a fake geolocation: order of fixes, and a probe that always settles.
/// <reference types="node" />
import assert from 'node:assert';
import { mock } from 'node:test';
import { startGps, probe } from '../src/gps.ts';
import { PROBE_TIMEOUT_MS } from '../src/config.ts';
import type { Fix } from '../src/types.ts';

const pos = (lat: number, timestamp: number) => ({ coords: { latitude: lat, longitude: 103, accuracy: 10 }, timestamp }) as GeolocationPosition;
let watch: (p: GeolocationPosition) => void = () => {};
let ask: (ok: (p: GeolocationPosition) => void, fail: () => void) => void = () => {};
Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: {
  watchPosition: (ok: (p: GeolocationPosition) => void) => { watch = ok; },
  getCurrentPosition: (ok: (p: GeolocationPosition) => void, fail: () => void) => ask(ok, fail),
} } });

const got: number[] = [];
const onFix = (f: Fix) => { got.push(f.lat); };
startGps(onFix, () => {});

// fixes arrive in the order they were measured
watch(pos(1, 1000)); watch(pos(2, 2000));
assert.deepEqual(got, [1, 2], 'watch fixes are delivered');
ask = (ok) => ok(pos(1.5, 1500));                                   // a one-off answer that was measured BEFORE the latest update
assert.equal(await probe(onFix), true, 'the probe still counts as an answer (the GPS works) ...');
assert.deepEqual(got, [1, 2], '... but the older position is not replayed');
ask = (ok) => ok(pos(3, 3000));
assert.equal(await probe(onFix), true);
assert.deepEqual(got, [1, 2, 3], 'a newer one is delivered');

// the probe answers even if handling the fix blows up
ask = (ok) => { try { ok(pos(4, 4000)); } catch { /* the browser reports an error thrown in a callback; it does not stop the promise */ } };
assert.equal(await probe(() => { throw new Error('boom'); }), true, 'a problem inside onFix does not leave the caller waiting');

// an error, or no geolocation at all, is "no position"
ask = (_ok, fail) => fail();
assert.equal(await probe(onFix), false, 'an error answers false');

// a browser that never calls back: a timer ends the wait
mock.timers.enable({ apis: ['setTimeout'] });
ask = () => {};
let settled: boolean | undefined;
const pending = probe(onFix).then((v) => { settled = v; });
mock.timers.tick(PROBE_TIMEOUT_MS + 1000);
await Promise.resolve();
assert.equal(settled, undefined, 'still waiting a little before the deadline');
mock.timers.tick(1500);
await pending;
assert.equal(settled, false, 'it gives up after the timeout plus a margin');
mock.timers.reset();

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
assert.equal(await probe(onFix), false, 'no geolocation: false');

console.log('ok');
