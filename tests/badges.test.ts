// Part of `npm test`. The one badge: levels by places found, what is new, and what a damaged store reads as.
/// <reference types="node" />
import assert from 'node:assert';
import { empty, reached, next, award, awardFame, seenAll, hasNew, highest, parse, storeKey, read, write, clear } from '../src/badges.ts';

assert.deepEqual([reached(0), reached(4), reached(5), reached(11), reached(12), reached(99)], [[], [], [5], [5, 10], [5, 10, 12], [5, 10, 12]]);
assert.deepEqual([next(0), next(5), next(11), next(12)], [5, 10, 12, null], 'the next level, none when all are earned');

let r = award(empty(), 4, '2026-10-10');
assert.deepEqual(r.fresh, [], 'under the first level: nothing');
r = award(r.badges, 5, '2026-10-10');
assert.deepEqual([r.fresh, r.badges.earned], [[5], { '5': '2026-10-10' }]);
const again = award(r.badges, 7, '2026-10-11');
assert.deepEqual([again.fresh, again.badges === r.badges], [[], true], 'a level is earned once, on its first day');
r = award(r.badges, 12, '2026-10-12');
assert.deepEqual([r.fresh, r.badges.earned], [[10, 12], { '5': '2026-10-10', '10': '2026-10-12', '12': '2026-10-12' }], 'two at once (a device with many finds): both, the highest is announced');
assert.equal(highest(r.badges), 12);
assert.equal(award(empty(), 40, '2026-10-10').fresh.length, 3, 'old finds earn every level the first time');

// the famous badges: earned once, with the place and the day; the first one stays
let f = awardFame(empty(), 'legend', 'Tian Tian', '2026-10-10');
assert.deepEqual([f.fresh, f.badges.fame], [true, { legend: { name: 'Tian Tian', day: '2026-10-10' } }]);
const again2 = awardFame(f.badges, 'legend', 'Other Place', '2026-10-11');
assert.deepEqual([again2.fresh, again2.badges === f.badges], [false, true], 'the first place stays');
assert.equal(hasNew(f.badges), true, 'a famous badge is new until looked at');
assert.equal(hasNew(seenAll(f.badges)), false, 'looking clears the dot');
assert.deepEqual(parse(JSON.parse(JSON.stringify(f.badges))), f.badges, 'it survives a round trip');
const longName = '𝒜'.repeat(80);   // 80 characters, 160 UTF-16 units: as long as a name can be
assert.equal(parse({ fame: { legend: { name: longName, day: '2026-10-10' } } }).fame.legend?.name, longName, 'a name of 80 characters is kept, however many units they take');
assert.deepEqual(parse({ fame: { legend: { name: '', day: '2026-10-10' }, landmark: { name: 'X', day: 'soon' }, other: { name: 'Y', day: '2026-10-10' } }, fameSeen: ['legend', 'landmark'] }), empty(), 'a name and a real day, and only known kinds');

// the dot: a level earned that was not looked at
const b = (earned: Record<string, string>, seen: number) => ({ ...empty(), earned, seen });
assert.deepEqual([hasNew(empty()), hasNew(b({ '5': 'x' }, 0)), hasNew(b({ '5': 'x' }, 5)), hasNew(b({ '5': 'x', '10': 'y' }, 5))], [false, true, false, true]);

// anything read back is untrusted
assert.deepEqual(parse(null), empty());
assert.deepEqual(parse('x'), empty());
assert.deepEqual(parse({ earned: { '5': '2026-10-10', '7': '2026-10-10', '10': 'yesterday' }, seen: 5 }), { ...empty(), earned: { '5': '2026-10-10' }, seen: 5 }, 'only known levels with a real date');
assert.deepEqual(parse({ earned: 'no', seen: -3 }), empty());
assert.equal(storeKey(false), 'fogwalk:badge:v1');
assert.equal(storeKey(true), 'fogwalk:badge:v1:debug');

// the store: saved, read back, cleared; blocked storage and damaged JSON read as nothing
const data = new Map<string, string>();
let blocked = false;
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => { if (blocked) throw new Error('blocked'); return data.get(k) ?? null; },
  setItem: (k: string, v: string) => { if (blocked) throw new Error('blocked'); data.set(k, v); },
  removeItem: (k: string) => { if (blocked) throw new Error('blocked'); data.delete(k); },
};
assert.deepEqual(read('k'), empty());
write('k', r.badges);
assert.deepEqual(read('k'), r.badges, 'saved and read back');
clear('k');
assert.deepEqual(read('k'), empty());
data.set('k', '{{{');
assert.deepEqual(read('k'), empty(), 'damaged JSON');
blocked = true;
assert.deepEqual(read('k'), empty(), 'blocked storage');
assert.doesNotThrow(() => { write('k', r.badges); clear('k'); });
console.log('ok');
