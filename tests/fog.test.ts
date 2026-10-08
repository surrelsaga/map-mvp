// npm test   (Node 24 runs this TypeScript file directly)
/// <reference types="node" />
import assert from 'node:assert';
import type { LatLng } from '../src/types.ts';
import { revealPath, isRevealed, dist, cellOf, key } from '../src/fog.ts';
import { CELL, REVEAL_RADIUS } from '../src/config.ts';

const a: LatLng = { lat: 1.3413, lng: 103.9638 };                 // SUTD
const M = 6371000 * Math.PI / 180;                        // metres per degree of latitude
const east = (p: LatLng, m: number): LatLng => ({ lat: p.lat, lng: p.lng + m / M / Math.cos(p.lat * Math.PI / 180) });
const north = (p: LatLng, m: number): LatLng => ({ lat: p.lat + m / M, lng: p.lng });

const ll = (p: LatLng) => [p.lat, p.lng] as const;          // spread-able (lat, lng) pair

// distance
assert(Math.abs(dist(a, north(a, 1000)) - 1000) < 1, 'haversine: 1 km north is 1 km');
assert(Math.abs(dist(a, east(a, 1000)) - 1000) < 1, 'haversine: 1 km east is 1 km');

// one fix clears a disc, not a square, of about the right size
let s = new Set<number>();
const added = revealPath(s, null, a);
assert.equal(added, s.size, 'returns the number of new cells');
const expected = Math.PI * (REVEAL_RADIUS / 11.132) ** 2;  // disc area in cells (~11.1 m per cell)
assert(Math.abs(s.size - expected) / expected < 0.2, `disc has about ${expected.toFixed(0)} cells, got ${s.size}`);
assert(isRevealed(s, a.lat, a.lng));
assert(isRevealed(s, ...ll(north(a, 25))), '25 m away is clear');
assert(!isRevealed(s, ...ll(north(a, 60))), '60 m away is still fog');
const corner = { lat: a.lat + 36 / M, lng: a.lng + 36 / M };   // ~51 m diagonal: square would include it, disc must not
assert(!isRevealed(s, corner.lat, corner.lng), 'corners of the bounding square stay fogged');

// revealing the same spot again adds nothing
assert.equal(revealPath(s, a, a), 0, 'idempotent');

// a 140 m walk leaves a continuous trail
s = new Set<number>();
const b = east(a, 140);
revealPath(s, null, a);
assert(!isRevealed(s, ...ll(east(a, 70))), 'midpoint is fog before walking');
revealPath(s, a, b);
for (let m = 0; m <= 140; m += 5) assert(isRevealed(s, ...ll(east(a, m))), `trail clear at ${m} m`);
assert(!isRevealed(s, ...ll(north(east(a, 70), 60))), 'beside the trail is fog');

// a 1 km jump (glitch, teleport) clears only the end, no line across
s = new Set<number>();
revealPath(s, null, a);
const far = north(a, 1000);
revealPath(s, a, far);
assert(isRevealed(s, far.lat, far.lng), 'end point clear');
assert(!isRevealed(s, ...ll(north(a, 500))), 'nothing painted across the jump');

// keys are unique across the grid, including negative coordinates
const seen = new Set<number>();
for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) seen.add(key(i, j));
assert.equal(seen.size, 49, 'cell keys do not collide');
assert.deepEqual(cellOf(-0.00005, -0.00005), [-1, -1], 'negative coordinates floor correctly');
assert.equal(typeof CELL, 'number');

// keys never collide, even at the edges of the world (the first version only checked a 7x7 patch)
const [iMax, jMax] = cellOf(90, 180), [iMin, jMin] = cellOf(-90, -180);
assert.notEqual(key(iMax, jMin), key(iMax + 1, jMax), 'east/west edge keys differ');
assert.notEqual(key(iMin, jMax), key(iMin + 1, jMin), 'wrapped neighbours differ');
const edge = new Set<number>();
for (const i of [iMin, 0, iMax]) for (const j of [jMin, jMin + 1, -1, 0, 1, jMax - 1, jMax]) edge.add(key(i, j));
assert.equal(edge.size, 21, 'no collisions across extreme cells');

// timestamps: a gap covered faster than walking clears only the end point; a slow one fills in
const slow = new Set<number>(), fast = new Set<number>();
const p0 = { ...a, t: 0 }, p1 = { ...east(a, 150), t: 120000 }, p2 = { ...east(a, 150), t: 10000 };   // 150 m in 120 s vs 10 s
revealPath(slow, p0, p1); revealPath(fast, p0, p2);
assert(isRevealed(slow, ...ll(east(a, 75))), 'walking pace gap is filled in');
assert(!isRevealed(fast, ...ll(east(a, 75))), 'bus-speed gap is not filled in');
assert(isRevealed(fast, ...ll(east(a, 150))), 'but the end point still clears');
const noT = new Set<number>(); revealPath(noT, a, east(a, 150));
assert(isRevealed(noT, ...ll(east(a, 75))), 'fixes without timestamps still interpolate');

console.log('ok');
