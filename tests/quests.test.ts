// Part of `npm test`. The two test quests: picking a target, counting finds, the chip wording, and the per-device store.
/// <reference types="node" />
import assert from 'node:assert';
import { makeQuest, progress, goalOf, parseQuest, distanceTo, track, tooFar, questStoreKey, readQuest, writeQuest, clearQuest, type Quest, type Reach, type Find } from '../src/quests.ts';
import { dist } from '../src/fog.ts';
import { QUEST_MIN_M, QUEST_MAX_M, QUEST_FIND, QUEST_REVEAL_MS } from '../src/config.ts';
import type { Place } from '../src/places.ts';

const me = { lat: 1.3413, lng: 103.9638 };
const at = (id: string, metresNorth: number): Place => ({ id, name: id, type: 'cafe', lat: me.lat + metresNorth / 111195, lng: me.lng });   // a place due north of `me`
const none = new Set<number>();

// reach: a place in the 150-400 m band, picked by the rng; never one already found
const places = [at('near', 80), at('band1', 200), at('band2', 300), at('far', 900)];
const q0 = makeQuest(0, places, none, me, () => 0) as Reach;
assert.equal(q0.kind, 'reach');
assert.equal(q0.key, 'band1', 'rng 0 picks the first place in the band');
assert.equal((makeQuest(0, places, none, me, () => 0.99) as Reach).key, 'band2', 'rng near 1 picks the last one');
for (let i = 0; i < 50; i++) { const d = (makeQuest(0, places, none, me) as Reach).start; assert(d >= QUEST_MIN_M && d <= QUEST_MAX_M, 'never outside the band while the band has places'); }
assert(Math.abs(q0.start - dist(me, q0)) < 1e-6, 'start is the distance when the quest began');
assert.equal((makeQuest(0, places, new Set([1, 2]), me, () => 0) as Reach).key, 'near', 'found places are never targets: with the band gone, the nearest one left');
assert.equal((makeQuest(0, [at('far', 900), at('farther', 1500)], none, me) as Reach).key, 'far', 'nothing in the band: the nearest unfound place');
assert.equal(makeQuest(0, places, new Set([0, 1, 2, 3]), me), null, 'everything found: no quest');
assert.equal(makeQuest(0, [at('underfoot', 30), at('close', 55)], none, me), null, 'a place within the reveal circle (and a little beyond) is never a reach target: the next step finds it');
assert.equal((makeQuest(0, [at('underfoot', 30), at('close', 55), at('ok', 80)], none, me) as Reach).key, 'ok', 'the others are skipped');
assert.equal(makeQuest(1, places, new Set([0, 1, 2, 3]), me), null, 'for a find quest too');
assert.equal(makeQuest(0, [], none, me), null, 'no places at all');

// find: asks for QUEST_FIND new places, or fewer when fewer are left
const f0 = makeQuest(1, places, none, me) as Find;
assert.deepEqual([f0.kind, f0.need, f0.ids], ['find', QUEST_FIND, []]);
assert.equal((makeQuest(3, places, new Set([0, 1, 2]), me) as Find).need, 1, 'one place left: one is enough');

// progress: reach finishes when its own target is found, whoever else is
const [near, band1] = places;
assert.equal(progress(q0, [near], [near]), q0, 'another place found: the same object back');
const reached = progress(q0, [near, band1], [near, band1]);
assert.equal(reached.done, true);
assert.equal(progress(q0, [band1], []).done, true, 'a target cleared while the page was closed (found quietly) still counts');
assert.equal(progress(reached, [near], [near]), reached, 'a finished quest stays as it was');

// progress: find counts announced finds, once each
const one = progress(f0, [near], [near]) as Find;
assert.deepEqual([one.ids, one.done], [['near'], false]);
assert.equal(progress(one, [near], [near]), one, 'the same place again changes nothing');
assert.equal(progress(f0, [near], []), f0, 'a quiet find (restored fog) does not count');
const two = progress(one, [band1], [band1]) as Find;
assert.deepEqual([two.ids, two.done], [['near', 'band1'], true]);
assert.equal((progress(f0, places, places) as Find).ids.length, QUEST_FIND, 'a big batch stops at what is needed');

// the chip: an instruction first, then progress, then done
assert.equal(goalOf(f0, me).label, 'Find 2 new places');
assert.equal(goalOf(one, me).label, '1 of 2 new places');
assert.equal(goalOf(two, me).label, 'Quest done');
assert.deepEqual([goalOf(one, me).progress, goalOf(two, me).progress, goalOf(two, me).done], [0.5, 1, true]);
assert(/^Find the hidden spot, \d+ m$/.test(goalOf(q0, me).label), 'metres, rounded to 10');
assert.equal(goalOf(q0, me).label, 'Find the hidden spot, 200 m');
assert.equal(goalOf({ ...q0, start: 1500, lat: me.lat + 1500 / 111195 }, me).label, 'Find the hidden spot, 1.5 km');
assert.equal(goalOf({ ...q0, lat: me.lat + 3 / 111195 }, me).label, 'Find the hidden spot, 10 m', 'never "0 m" while the quest is open');
assert.equal(goalOf({ ...q0, start: 1000, lat: me.lat + 997 / 111195 }, me).label, 'Find the hidden spot, 1.0 km', '997 m rounds up to a kilometre, not to "1000 m"');
assert.equal(goalOf({ ...q0, start: 1000, lat: me.lat + 984 / 111195 }, me).label, 'Find the hidden spot, 980 m');
const lone = { ...f0, need: 1 };
assert.equal(goalOf(lone, me).label, 'Find 1 new place', 'singular for one');
assert.equal(goalOf(lone, me).detail, 'Uncover 1 place you haven’t found yet, 1 to go');
assert.equal(goalOf(q0, me).progress, 0, 'at the start the ring is empty');
const walkedHalf = { lat: me.lat + 100 / 111195, lng: me.lng };
assert(Math.abs(goalOf(q0, walkedHalf).progress - 0.5) < 0.01, 'halfway there, half full');
assert.equal(goalOf(q0, { lat: me.lat - 500 / 111195, lng: me.lng }).progress, 0, 'walking away never goes below empty');
assert.equal(goalOf(reached, me).label, 'Quest done');
assert.equal(distanceTo(q0, null), q0.start, 'before the first fix, the start distance');
assert.equal(goalOf({ ...q0, revealed: true }, me).label, 'Reach the marked spot, 200 m', 'once its spot is marked, the flag says so');
assert.equal(goalOf(q0, me).detail, 'Follow the hint, about 200 m away');

// a reach quest's spot starts hidden, and is marked once you need help
const north = (m: number) => ({ lat: me.lat + m / 111195, lng: me.lng });
assert.deepEqual([q0.revealed, q0.best, q0.t > 0], [false, q0.start, true], 'hidden at the start');
assert.equal(track(q0, me, q0.t), q0, 'nothing changed: the same object');
assert.equal(track(q0, me, q0.t + QUEST_REVEAL_MS).revealed, true, 'marked after a while of looking');
assert.equal(track(q0, north(-300), q0.t).revealed, false, 'walking away from the start is not walking past it');
const closer = track(q0, north(100), q0.t);
assert.deepEqual([Math.round(closer.best), closer.revealed], [100, false], 'getting closer is remembered');
assert.equal(track(closer, north(50), q0.t).revealed, false, 'drifting back a little is fine');
assert.equal(track(closer, north(30), q0.t).revealed, true, 'drifting 60 m or more back out marks it (walked past, or lost the trail)');
assert.equal(track({ ...closer, done: true }, north(40), q0.t).revealed, false, 'a done quest is left alone');
assert.deepEqual([tooFar({ ...q0, start: 200 }, 300), tooFar({ ...q0, start: 200 }, 301), tooFar({ ...q0, start: 400 }, 600), tooFar({ ...q0, start: 400 }, 601)], [false, true, false, true], 'heading away: 1.5 times the start, and at least 100 m more');

// damaged saved values are ignored
const good: Quest[] = [q0, f0, two];
for (const q of good) assert.deepEqual(parseQuest(JSON.parse(JSON.stringify(q))), q, 'a good value round trips');
const { t: _t, best: _b, revealed: _r, ...older } = q0;
assert.deepEqual(parseQuest(older), { ...older, t: 0, best: q0.start, revealed: true }, 'a quest saved before hints keeps its spot marked');
for (const bad of [undefined, null, 'x', 5, [], {}, { kind: 'reach' }, { ...q0, seq: -1 }, { ...q0, seq: 1.5 }, { ...q0, done: 'no' }, { ...q0, lat: 'x' }, { ...q0, start: 0 }, { ...q0, key: 5 },
  { ...f0, need: 0 }, { ...f0, need: 999 }, { ...f0, ids: 'a' }, { ...f0, ids: [1] }, { ...f0, kind: 'sing' }])
  assert.equal(parseQuest(bad), null, `damaged value ${JSON.stringify(bad)} is ignored`);

// the store: round trip, damaged JSON, and storage that throws
const data = new Map<string, string>();
let broken = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k: string) => { if (broken) throw new Error('blocked'); return data.get(k) ?? null; },
  setItem: (k: string, v: string) => { if (broken) throw new Error('full'); data.set(k, v); },
  removeItem: (k: string) => { if (broken) throw new Error('blocked'); data.delete(k); },
} });
assert.equal(questStoreKey(false), 'fogwalk:quest');
assert.equal(questStoreKey(true), 'fogwalk:quest:debug', 'simulated walks never touch the real quest');
assert.equal(readQuest('k'), null, 'nothing saved yet');
writeQuest('k', q0);
assert.deepEqual(readQuest('k'), q0, 'saved and read back');
clearQuest('k');
assert.equal(readQuest('k'), null, 'cleared');
data.set('k', '{{{');
assert.equal(readQuest('k'), null, 'damaged JSON reads as nothing');
broken = true;
assert.equal(readQuest('k'), null, 'blocked storage reads as nothing');
assert.doesNotThrow(() => { writeQuest('k', q0); clearQuest('k'); }, 'and writing to it does not throw');

console.log('ok');
