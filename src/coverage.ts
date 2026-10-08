// How much of the neighbourhood circle has been walked. Pure logic: the circle is a set of fog cells, and "explored" is how many of them are cleared.
import { CELL } from './config.ts';
import { cellOf, key, dist, M_PER_DEG, type Cells } from './fog.ts';
import type { LatLng } from './types.ts';

// Every cell whose centre is within `radius` metres of `centre`.
// ponytail: ~100k distance calls for a 2 km circle, once at start-up (tens of ms). Compute lazily or in a worker if a phone struggles.
export function circleCells(centre: LatLng, radius: number): Cells {
  const dLat = radius / M_PER_DEG, dLng = dLat / Math.cos(centre.lat * Math.PI / 180);
  const [i0, j0] = cellOf(centre.lat - dLat, centre.lng - dLng), [i1, j1] = cellOf(centre.lat + dLat, centre.lng + dLng);
  const cells: Cells = new Set();
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++)
    if (dist(centre, { lat: (i + 0.5) * CELL, lng: (j + 0.5) * CELL }) <= radius) cells.add(key(i, j));
  return cells;
}

// "0.04%" for tiny amounts, "3.2%" once it is visible: a first outing clears well under 1% of a 2 km circle.
export function formatPercent(fraction: number): string {
  const p = fraction * 100;
  return (p < 1 ? p.toFixed(2) : p.toFixed(1)) + '%';
}
