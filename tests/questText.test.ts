// Part of `npm test`. The quest clues: the bearing, the plain lines, what Gemma is told, and which of its answers are thrown away.
/// <reference types="node" />
import assert from 'node:assert';
import { bearing, template, prompt, clean, giveaways, type Facts } from '../src/questText.ts';
import { parseQuest } from '../src/quests.ts';

const me = { lat: 1.3413, lng: 103.9638 }, d = 0.001;
assert.deepEqual([[d, 0], [d, d], [0, d], [-d, d], [-d, 0], [-d, -d], [0, -d], [d, -d]].map(([a, b]) => Math.round(bearing(me, { lat: me.lat + a, lng: me.lng + b }))),
  [0, 45, 90, 135, 180, 225, 270, 315], 'the bearing, clockwise from north');

const at = (stage: 1 | 2 | 3, near: string | null = null) => ({ kind: 'reach' as const, what: 'ice cream', hidden: 'Swensens', stage, near });
const find: Facts = { kind: 'find', need: 2, kinds: ['park', 'cafe'] };

// the plain lines: short, human, and no compass word
assert.equal(template(at(1)), 'An ice cream is hiding in the fog nearby. Can you find it?');
assert.equal(template({ ...at(1), what: 'cafe' }), 'A cafe is hiding in the fog nearby. Can you find it?');
assert.equal(template(at(2)), 'Stuck? Follow the light.');
assert.equal(template(at(3)), 'It’s right around you. Look up.');
assert.equal(template(find), 'Somewhere near, new places are waiting. Uncover 2 new places.');
assert.equal(template({ ...find, need: 1 }), 'Somewhere near, new places are waiting. Uncover one new place.');
for (const f of [at(1), at(2), at(3), find]) assert.doesNotMatch(template(f), /north|south|east|west/i);

// what Gemma is told: two worked examples as real turns, then the question, per stage
for (const [f, last] of [
  [at(1), 'Hidden place: Swensens (ice cream). Give the first riddle.'],
  [at(2, 'SUTD Canteen'), 'Hidden place: Swensens (ice cream). It is not far from SUTD Canteen. The player is stuck. Give a sharper clue.'],
  [at(2), 'Hidden place: Swensens (ice cream). The player is stuck. Give a sharper clue.'],
  [at(3), 'Hidden place: Swensens (ice cream). The player is very close now. Say it is right around them, with one last small detail.'],
  [find, 'Uncover 2 new places. Still hidden nearby: park, cafe.'],
] as const) {
  const chat = prompt(f);
  assert.deepEqual(chat.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.equal(chat.at(-1)!.content, last);
}
assert.match(prompt(at(1))[0].content, /never its name\. Do not give a direction/);
assert.equal(prompt({ ...at(1), hidden: '' }).at(-1)!.content, 'Hidden place: an ice cream. Give the first riddle.', 'no name known: just the kind');
assert.deepEqual(giveaways({ ...at(1), what: 'park', hidden: "East Coast Park @ Changi's", near: 'Changi City Point' }), ['east', 'coast'], 'the distinctive words of the name, not its kind or where you were');

// answers kept, tidied: a riddle needs no direction at all
assert.equal(clean('Somewhere close, sundaes are being scooped all day.', at(1)), 'Somewhere close, sundaes are being scooped all day.');
assert.equal(clean('\n**Riddle: "Follow the sweet, cold whiff of vanilla!" 🍦**\nmore', at(1)), 'Follow the sweet, cold whiff of vanilla!', 'first line only, no markdown, quotes, label or emoji');
assert.equal(clean('Uncover 2 new places hiding past the park.', find), 'Uncover 2 new places hiding past the park.', 'the number it was given is fine');
const long = 'Past the canteen, something cold and sweet waits in the thick morning fog. ' + 'Then keep on walking for a long, long while until something finally appears.';
assert.equal(clean(long, at(1)), 'Past the canteen, something cold and sweet waits in the thick morning fog.', 'too long: cut at a sentence end');
assert.equal(clean('Near SUTD Canteen 2, look for sweet cold treats.', at(2, 'SUTD Canteen 2')), 'Near SUTD Canteen 2, look for sweet cold treats.', 'a number in the name of the place it was given is fine');
// answers thrown away
for (const [raw, why] of [
  ['Walk about 300 m for something sweet.', 'a number it made up'],
  ['Head north-east to something cold.', 'a compass direction (the wisp does that)'],
  ['Go westward to a cold treat place.', 'in any form'],
  ['Walk on to Swensens for a cold sweet treat.', 'names the hidden place'],
  ['Head on to the swensens ice cream bar.', 'in any case'],
  ["I'm ready to explore the fog for sundaes!", 'written as the player'],
  ['Hidden place: an ice cream. Give a clue.', 'an echo of the prompt'],
  ['Somewhere ahead, little baskets of dumplings are steaming all day.', 'a copied example'],
  ['Cold stuff.', 'too short'],
  ['x'.repeat(200), 'too long, no sentence end'],
  [Array(25).fill('sweet').join(' '), 'too many words'],
] as const) assert.equal(clean(raw, at(1)), null, why);
assert.equal(clean('Enjoy a nice sit down and a drink.', find), null, 'a find line must be about finding');

// the clues are saved with the quest; a damaged value is dropped, the quest kept; Phase 9's single `text` is the first clue
const q = { kind: 'find', seq: 1, done: false, need: 2, ids: [] };
assert.deepEqual(parseQuest({ ...q, clues: ['One.', '', 'Three.'] })?.clues, ['One.', '', 'Three.']);
assert.equal(parseQuest({ ...q, clues: [42] })?.clues, undefined);
assert.equal(parseQuest({ ...q, clues: ['x'.repeat(201)] })?.clues, undefined);
assert.equal(parseQuest({ ...q, clues: ['a', 'b', 'c', 'd'] })?.clues, undefined, 'at most three');
assert.deepEqual(parseQuest({ ...q, text: 'Find them.' })?.clues, ['Find them.'], 'a Phase 9 save');
console.log('ok');
