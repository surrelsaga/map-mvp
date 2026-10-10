// Part of `npm test`. Today's goal: the date rule, counting WHICH places (so none counts twice), the wording, and the per-device store.
/// <reference types="node" />
import assert from 'node:assert';
import { dayKey, countToday, goalOf, readToday, writeToday, readFound, writeFound, foundStoreKey, todayStoreKey } from '../src/today.ts';
import { DAILY_GOAL, FOUND_MAX } from '../src/config.ts';

// the local date, zero-padded
assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
assert.equal(dayKey(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
assert.notEqual(dayKey(new Date(2026, 9, 9, 23, 59)), dayKey(new Date(2026, 9, 10, 0, 1)), 'the day changes at local midnight');

const noon = new Date(2026, 9, 9, 12), nextNoon = new Date(2026, 9, 10, 12);
const day = (ids: string[], date = '2026-10-09') => ({ date, ids });

// counting places, not events
assert.deepEqual(countToday(noon, ['a']), day(['a']), 'nothing saved: just the new find');
assert.deepEqual(countToday(noon, ['b'], day(['a'])), day(['a', 'b']), 'same day: adds to what was found');
assert.deepEqual(countToday(noon, [], day(['a', 'b'])), day(['a', 'b']), 'asking without new finds changes nothing');
assert.deepEqual(countToday(noon, ['a'], day(['a'])), day(['a']), 'the same place found again counts once');
assert.deepEqual(countToday(noon, ['a', 'a', 'b']), day(['a', 'b']), 'and once within one batch');

// two tabs: the union of what each knows, so neither wipes the other and one place found in both counts once
assert.deepEqual(countToday(noon, ['x'], day(['a']), day(['b'])).ids.sort(), ['a', 'b', 'x'], 'finds from this tab, from storage and from another tab all count');
assert.deepEqual(countToday(noon, ['a'], day(['a']), day(['a'])), day(['a']), 'the same place found in two tabs counts once');
assert.equal(countToday(noon, [], day(['a', 'b']), day(['b', 'c'])).ids.length, 3, 'overlapping tabs are not double counted');

// a new day starts from nothing; a tab left open since yesterday cannot drag today's count down
assert.deepEqual(countToday(nextNoon, ['z'], day(['a', 'b', 'c'])), day(['z'], '2026-10-10'), 'yesterday is not carried over');
assert.deepEqual(countToday(nextNoon, [], day(['a'], '2026-10-09'), day(['p', 'q'], '2026-10-10')), day(['p', 'q'], '2026-10-10'), 'a stale tab (yesterday) next to today\'s stored count keeps today\'s');

// damaged saved values are ignored
for (const bad of [undefined, null, 'x', 5, [], {}, { date: 5, ids: [] }, { date: '2026-10-09' }, { date: '2026-10-09', ids: 'a' }, { date: '2026-10-09', ids: [1, 2] }, { date: '2026-10-09', ids: [null] }])
  assert.deepEqual(countToday(noon, ['k'], bad), day(['k']), `damaged saved value ${JSON.stringify(bad)} is ignored`);
assert.equal(countToday(noon, Array.from({ length: 9000 }, (_, i) => `p${i}`)).ids.length, 5000, 'a runaway list is bounded');

// the goal and its wording: an instruction first, then progress, then done
assert.equal(DAILY_GOAL, 3, 'the wording below assumes three places a day');
assert.deepEqual(goalOf(0), { title: 'Today', found: 0, target: 3, done: false, progress: 0, label: 'Find 3 places today', detail: '0 of 3 new places, 3 to go' });
assert.equal(goalOf(1).label, '1 of 3 places today');
assert.equal(goalOf(2).label, '2 of 3 places today');
assert(Math.abs(goalOf(2).progress - 2 / 3) < 1e-9);
assert.deepEqual(goalOf(3), { title: 'Today', found: 3, target: 3, done: true, progress: 1, label: 'Today’s goal done', detail: 'All done. More finds are a bonus.' });
assert.deepEqual([goalOf(7).done, goalOf(7).progress], [true, 1], 'extra finds stay done and the ring stays full');
assert.equal(goalOf(1, 5).label, '1 of 5 places today', 'the target is a parameter (a quest can take over the slot)');

// the store: round trip, damaged JSON, and storage that throws
const data = new Map<string, string>();
let broken = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k: string) => { if (broken) throw new Error('blocked'); return data.get(k) ?? null; },
  setItem: (k: string, v: string) => { if (broken) throw new Error('full'); data.set(k, v); },
} });
assert.equal(todayStoreKey(false), 'fogwalk:today');
assert.equal(todayStoreKey(true), 'fogwalk:today:debug', 'simulated walks never count toward the real goal');
assert.equal(readToday('k'), null, 'nothing saved yet');
writeToday('k', day(['a', 'b']));
assert.deepEqual(readToday('k'), day(['a', 'b']), 'saved and read back');
data.set('k', '{{{');
assert.equal(readToday('k'), null, 'damaged JSON reads as nothing');
broken = true;
assert.equal(readToday('k'), null, 'blocked storage reads as nothing');
assert.doesNotThrow(() => writeToday('k', day(['x'])), 'and writing to it does not throw');

// ---- the found-on-this-device list
data.clear(); broken = false;
assert.equal(foundStoreKey(false), 'fogwalk:found:v1'); assert.equal(foundStoreKey(true), 'fogwalk:found:v1:debug', 'simulated walks keep their own list');
assert.deepEqual(readFound('f'), [], 'nothing found yet');
writeFound('f', ['node/1', 'node/2', 'node/1']);
assert.deepEqual(readFound('f'), ['node/1', 'node/2'], 'saved without duplicates, read back in order');
for (const junk of ['{{{', 'null', '{}', '{"ids":5}', '{"ids":{"a":1}}']) { data.set('f', junk); assert.deepEqual(readFound('f'), [], 'junk gives nothing: ' + junk); }
data.set('f', JSON.stringify({ ids: ['ok', 5, null, 'x'.repeat(121), 'also ok'] }));
assert.deepEqual(readFound('f'), ['ok', 'also ok'], 'only short strings survive');
writeFound('f', Array.from({ length: FOUND_MAX + 5 }, (_, i) => 'id' + i));
assert.equal(readFound('f').length, FOUND_MAX, 'capped');
assert.equal(readFound('f').at(-1), 'id' + (FOUND_MAX + 4), 'and it is the newest that stay');
broken = true;
assert.deepEqual(readFound('f'), [], 'blocked storage: nothing'); assert.doesNotThrow(() => writeFound('f', ['a']), 'and writing does not throw');

console.log('ok');
