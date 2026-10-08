// Part of `npm test`. Pure logic for places and coverage, plus a check on the shipped public/places.json.
/// <reference types="node" />
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { parsePlaces, discover, foundMessage, typeLabel, groupOf, type Place } from '../src/places.ts';
import { circleCells, formatPercent } from '../src/coverage.ts';
import { revealPath, dist, M_PER_DEG } from '../src/fog.ts';
import { CELL, SUTD, AREA_RADIUS } from '../src/config.ts';

const here = { lat: SUTD[0], lng: SUTD[1] };

// ---- parsePlaces: keep well-formed entries only
const good = { name: 'Cafe', type: 'cafe', lat: 1.34, lng: 103.96 };
assert.deepEqual(parsePlaces({ places: [good] }), [good]);
for (const bad of [null, undefined, 5, 'x', [], {}, { places: 'x' }, { places: {} }]) assert.deepEqual(parsePlaces(bad), [], `rejects ${JSON.stringify(bad)}`);
const messy = { places: [good, null, 7, {}, { ...good, name: '' }, { ...good, name: '   ' }, { ...good, name: 5 }, { ...good, type: 5 }, { ...good, lat: '1.3' },
  { ...good, lng: NaN }, { ...good, lat: 91 }, { ...good, lng: -181 }, { ...good, lat: Infinity }, { ...good, name: '  Spaced  ' }, { ...good, name: 'x'.repeat(200) }] };
const parsed = parsePlaces(messy);
assert.equal(parsed.length, 3, 'good, trimmed and truncated entries survive; the rest are dropped');
assert.equal(parsed[1].name, 'Spaced', 'names are trimmed');
assert.equal(parsed[2].name.length, 80, 'and capped at 80 characters');
assert.equal(parsePlaces({ places: [{ ...good, name: '<img src=x onerror=alert(1)>' }] })[0].name, '<img src=x onerror=alert(1)>', 'names stay plain text (rendering uses textContent)');
// invisible characters that could reorder the text around a name are removed; a name is never cut through a character
assert.equal(parsePlaces({ places: [{ ...good, name: '\u202Eevil\u200B\u0007 name\u2067' }] })[0].name, 'evil name', 'direction overrides and control characters are stripped');
const emoji = parsePlaces({ places: [{ ...good, name: '😀'.repeat(100) }] })[0].name;
assert.equal([...emoji].length, 80, 'the cap counts characters, not UTF-16 units');
assert.equal(emoji, '😀'.repeat(80), 'and does not split a surrogate pair');
assert.equal(parsePlaces({ places: [{ ...good, name: '\u202E\u200B' }] }).length, 0, 'a name that is nothing but invisible characters is dropped');
// the wider set of characters that can hide in or reorder a name, built from code points so this file holds no raw invisible characters
const cp = String.fromCodePoint;
const clean = (name: string) => parsePlaces({ places: [{ ...good, name }] })[0]?.name;
assert.equal(clean('A\nB'), 'A B', 'a line break becomes a space instead of gluing words together');
assert.equal(clean(`A${cp(0x2028)}B${cp(0x2029)}C`), 'A B C', 'line and paragraph separators too');
assert.equal(clean(`${cp(0x61c)}x`), 'x', 'Arabic letter mark');
assert.equal(clean(`so${cp(0xad)}ft`), 'soft', 'soft hyphen');
assert.equal(clean(`${cp(0xe0041)}${cp(0xe0042)}hi`), 'hi', 'tag characters');
assert.equal(clean(`a${cp(0x2066)}b${cp(0x2069)}c${cp(0xfeff)}`), 'abc', 'isolates and byte-order mark');
assert.equal(clean('  many \t  spaces  '), 'many spaces', 'runs of whitespace collapse');
assert.equal(clean(`${cp(0x202e)}${cp(0x200b)}`), undefined, 'only invisible characters: dropped');
assert.equal(clean('Café 咖啡'), 'Café 咖啡', 'ordinary accented and CJK names are untouched');

// ids (the OpenStreetMap object) are kept when they are strings
assert.equal(parsePlaces({ places: [{ ...good, id: 'node/123' }] })[0].id, 'node/123');
assert.equal('id' in parsePlaces({ places: [{ ...good, id: 5 }] })[0], false, 'a non-string id is ignored');
assert.equal(parsePlaces({ places: [{ ...good, id: 'x'.repeat(100) }] })[0].id!.length, 40, 'and ids are capped');

// ---- discover: finds each place once, by index
const list: Place[] = [0, 1, 2].map((n) => ({ name: `P${n}`, type: 'cafe', lat: 1 + n, lng: 1 }));
const found = new Set<number>();
let open = new Set<number>([1]);
assert.deepEqual(discover(list, found, (lat) => open.has(lat - 1)).map((p) => p.name), ['P1'], 'only the revealed one');
assert.deepEqual(discover(list, found, (lat) => open.has(lat - 1)), [], 'not reported twice');
open = new Set([0, 1, 2]);
assert.deepEqual(discover(list, found, (lat) => open.has(lat - 1)).map((p) => p.name), ['P0', 'P2'], 'the others later, once their spot clears');
assert.equal(found.size, 3);

// ---- the toast text
const names = (n: number) => list.concat(list).slice(0, n).map((p, i) => ({ ...p, name: 'ABCDEF'[i] }));
assert.equal(foundMessage([]), '');
assert.equal(foundMessage(names(1)), 'Found A');
assert.equal(foundMessage(names(2)), 'Found 2 places: A and B');
assert.equal(foundMessage(names(3)), 'Found 3 places: A, B and 1 more');
assert.equal(foundMessage(names(6)), 'Found 6 places: A, B and 4 more');
const named = (...ns: string[]) => ns.map((name) => ({ name, type: 'x', lat: 0, lng: 0 }));    // chains repeat names: count them instead of listing them twice
assert.equal(foundMessage(named('7-Eleven')), 'Found 7-Eleven');
assert.equal(foundMessage(named('7-Eleven', '7-Eleven')), 'Found 2 places: 7-Eleven ×2');
assert.equal(foundMessage(named('7-Eleven', 'Cafe', '7-Eleven')), 'Found 3 places: 7-Eleven ×2 and Cafe');
assert.equal(foundMessage(named('7-Eleven', 'Cafe', '7-Eleven', 'Bank', 'Gym')), 'Found 5 places: 7-Eleven ×2, Cafe and 2 more');

// ---- plain words for OpenStreetMap values, and the four pin groups
assert.equal(typeLabel('fast_food'), 'Fast food');
assert.equal(typeLabel('place_of_worship'), 'Place of worship');
assert.equal(typeLabel('cafe'), 'Cafe');
assert.equal(typeLabel(''), '');
assert.deepEqual(['restaurant', 'convenience', 'park', 'police', 'nonsense', ''].map(groupOf), ['food', 'shop', 'outdoors', 'other', 'other', 'other']);

// ---- coverage: the circle has the right number of cells, and a walked patch is a tiny part of it
const cellArea = (CELL * M_PER_DEG) ** 2 * Math.cos(SUTD[0] * Math.PI / 180);          // square metres per cell
const area = circleCells(here, AREA_RADIUS);
const expected = Math.PI * AREA_RADIUS ** 2 / cellArea;
assert(Math.abs(area.size - expected) / expected < 0.02, `2 km circle has about ${expected.toFixed(0)} cells, got ${area.size}`);
const small = circleCells(here, 40);
assert(Math.abs(small.size - Math.PI * 40 ** 2 / cellArea) < 6, `40 m circle: ${small.size} cells`);
const walked = new Set<number>(); revealPath(walked, null, here);
let inside = 0; for (const k of walked) if (area.has(k)) inside++;
assert.equal(inside, walked.size, 'a cleared circle at the centre is entirely inside the area');
const faraway = new Set<number>(); revealPath(faraway, null, { lat: 1.5, lng: 104.2 });
inside = 0; for (const k of faraway) if (area.has(k)) inside++;
assert.equal(inside, 0, 'cells outside the circle do not count');

// ---- percent text
assert.equal(formatPercent(0), '0.00%');
assert.equal(formatPercent(0.0004), '0.04%');
assert.equal(formatPercent(0.0099), '0.99%');
assert.equal(formatPercent(0.01), '1.0%');
assert.equal(formatPercent(0.032), '3.2%');
assert.equal(formatPercent(1), '100.0%');

// ---- the shipped data file: parses, is big enough to be fun, stays inside the circle, and has no street-furniture noise
const file = JSON.parse(readFileSync(new URL('../public/places.json', import.meta.url), 'utf8'));
const real = parsePlaces(file);
assert.equal(real.length, file.places.length, 'every entry in the file is valid');
assert(real.length > 100, `enough places to discover (${real.length})`);
assert(real.every((p) => dist(here, p) <= AREA_RADIUS + 1), 'all inside the 2 km circle');
assert(real.every((p) => !['parking', 'bench', 'toilets', 'park_connector'].includes(p.type)), 'no parking, benches, toilets or path segments');
assert.equal(new Set(real.map((p) => `${p.name}|${p.lat.toFixed(3)}|${p.lng.toFixed(3)}`)).size, real.length, 'no near-duplicates');
assert(real.every((p) => /^(node|way|relation)\/\d+$/.test(p.id ?? '')), 'every place has its OpenStreetMap object id');
assert.equal(new Set(real.map((p) => p.id)).size, real.length, 'ids are unique');
const groups = { food: 0, shop: 0, outdoors: 0, other: 0 };
for (const p of real) groups[groupOf(p.type)]++;
assert(groups.food > 20 && groups.shop > 20 && groups.outdoors > 5, `every pin kind is used: ${JSON.stringify(groups)}`);
assert(groups.other < real.length * 0.4, `"everything else" is the minority: ${JSON.stringify(groups)}`);
assert(real.every((p) => typeLabel(p.type).length > 0), 'every place has a readable type');
assert.equal(file.center.lat, SUTD[0]); assert.equal(file.center.lng, SUTD[1]); assert.equal(file.radius, AREA_RADIUS);   // the fetch script and config agree

console.log('ok');
