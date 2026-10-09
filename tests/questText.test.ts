// Part of `npm test`. The quest line: compass words, the plain line, what Gemma is told, and which of its answers are thrown away.
/// <reference types="node" />
import assert from 'node:assert';
import { compass, template, prompt, clean, giveaways, type Facts } from '../src/questText.ts';
import { parseQuest } from '../src/quests.ts';

const me = { lat: 1.3413, lng: 103.9638 }, d = 0.001;
assert.deepEqual([[d, 0], [d, d], [0, d], [-d, d], [-d, 0], [-d, -d], [0, -d], [d, -d]].map(([a, b]) => compass(me, { lat: me.lat + a, lng: me.lng + b })),
  ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']);

const reach: Facts = { here: 'SUTD Canteen', kind: 'reach', what: 'ice cream', dir: 'north-east', hidden: 'Swensens' };
const find: Facts = { here: null, kind: 'find', need: 2, kinds: ['park', 'cafe'] };
assert.equal(template(reach), 'From SUTD Canteen, head north-east to an ice cream spot hidden in the fog.');
assert.equal(template(find), 'Wander somewhere new and uncover 2 new places.');
assert.equal(template({ ...find, need: 1 }), 'Wander somewhere new and uncover one new place.');

const chat = prompt(reach), ask = chat.at(-1)!;
assert.deepEqual(chat.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user'], 'two worked examples as real turns, then the question');
assert.equal(ask.content, 'The player just reached SUTD Canteen. Next: walk north-east to a hidden place: Swensens (ice cream). Hint at it without saying its name.');
assert.equal(prompt({ ...reach, hidden: '' }).at(-1)!.content, 'The player just reached SUTD Canteen. Next: walk north-east to an ice cream hidden in the fog.', 'no name known: just the kind');
assert.deepEqual(giveaways({ here: 'Changi City Point', kind: 'reach', what: 'park', dir: 'east', hidden: "East Coast Park @ Changi's" }), ['coast'], 'the distinctive words of the name, not its kind, the direction or where you are');
assert.equal(prompt(find).at(-1)!.content, 'The player is out for a walk. Next: uncover 2 new places. Still hidden nearby: park, cafe.');

// answers kept, tidied
assert.equal(clean('Head north-east to an ice cream spot hidden in the fog.', reach), 'Head north-east to an ice cream spot hidden in the fog.');
assert.equal(clean('North-eastward, find where sundaes are scooped all day.', reach), 'North-eastward, find where sundaes are scooped all day.', 'a hint, with the direction as -ward');
assert.equal(clean('Northeastward, find where sundaes are scooped.', reach), 'Northeastward, find where sundaes are scooped.', 'or written as one word');
assert.equal(clean('\n**Quest: "Leave the canteen and head north-east into the fog!" 🍦**\nmore', reach), 'Leave the canteen and head north-east into the fog!', 'first line only, no markdown, quotes, label or emoji');
assert.equal(clean('Find 2 new places hiding past the park.', find), 'Find 2 new places hiding past the park.', 'the number it was given is fine');
const long = 'Head north-east past the canteen into the thick morning fog. ' + 'Then keep on walking for a long, long while until something finally appears.';
assert.equal(clean(long, reach), 'Head north-east past the canteen into the thick morning fog.', 'too long: cut at a sentence end');
// answers thrown away
for (const [raw, why] of [
  ['Head north-east for 300 m.', 'a number it made up'],
  ['Walk north-east to Swensens.', 'names the hidden place'],
  ['Head north-east to the swensens ice cream bar.', 'in any case'],
  ['Head east to the cafe.', 'the wrong direction'],
  ['Head south-east to the cafe.', 'nor a direction that only shares a word with it'],
  ["I'm ready to explore the north-east!", 'written as the player'],
  ['The player is out for a walk. Next: walk north-east.', 'an echo of the prompt'],
  ['Leave the library behind and follow the fog west to a hidden cafe.', 'a copied example'],
  ['North-east.', 'too short'],
  ['x'.repeat(200), 'too long, no sentence end'],
] as const) assert.equal(clean(raw, reach), null, why);
assert.equal(clean('Enjoy a nice sit down and a drink.', find), null, 'a find line must be about finding');

// the line is saved with the quest; a damaged one is dropped, the quest kept
const q = { kind: 'find', seq: 1, done: false, need: 2, ids: [] };
assert.equal(parseQuest({ ...q, text: 'Find them.' })?.text, 'Find them.');
assert.equal(parseQuest({ ...q, text: 42 })?.text, undefined);
assert.equal(parseQuest({ ...q, text: 'x'.repeat(201) })?.text, undefined);
console.log('ok');
