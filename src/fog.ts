// Fog logic only: no DOM, no Leaflet, so Node can test it. The fog is a Set of numeric cell keys on a fixed lat/lng grid.
import { CELL, REVEAL_RADIUS, MAX_JUMP, MAX_SPEED } from './config.ts';
import type { LatLng } from './types.ts';
// ponytail: fixed-degree grid, so cells get narrower east-west away from the equator (~7 m at 50 degrees). Switch to H3 if that ever matters.

const EARTH_R = 6371000;                              // metres
const RAD = Math.PI / 180;
const M_PER_DEG = EARTH_R * RAD;                      // same Earth model as dist(), so the two can't disagree
const K = 2 * Math.ceil(180 / CELL) + 2;              // more than 2 * max |j| for any CELL, so i * K + j is unique for every cell on Earth

export type Cells = Set<number>;
export type Timed = LatLng & { t?: number };          // a position, optionally with a timestamp in ms

export const cellOf = (lat: number, lng: number): [number, number] => [Math.floor(lat / CELL), Math.floor(lng / CELL)];
export const key = (i: number, j: number) => i * K + j;
export const isRevealed = (cells: Cells, lat: number, lng: number) => cells.has(key(...cellOf(lat, lng)));

export function dist(a: LatLng, b: LatLng) {                          // haversine, metres
  const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

// Adds every cell whose centre is within REVEAL_RADIUS of (lat, lng). Returns how many were new.
function revealAround(cells: Cells, lat: number, lng: number) {
  const dLat = REVEAL_RADIUS / M_PER_DEG, dLng = dLat / Math.cos(lat * RAD);
  const [i0, j0] = cellOf(lat - dLat, lng - dLng), [i1, j1] = cellOf(lat + dLat, lng + dLng);
  let added = 0;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const k = key(i, j);
    if (!cells.has(k) && dist({ lat, lng }, { lat: (i + 0.5) * CELL, lng: (j + 0.5) * CELL }) <= REVEAL_RADIUS) { cells.add(k); added++; }
  }
  return added;
}

// Clears the end point, plus the stretch walked since `from`, so sparse GPS fixes still leave a continuous trail.
// Fixes may carry a timestamp `t` (ms); if the gap between two was covered faster than walking, only the end point clears.
// Returns how many cells were new.
export function revealPath(cells: Cells, from: Timed | null, to: Timed) {
  const d = from ? dist(from, to) : Infinity;
  const secs = from && from.t != null && to.t != null ? (to.t - from.t) / 1000 : 0;
  const walked = d < MAX_JUMP && (secs <= 0 || d / secs <= MAX_SPEED);
  const n = walked ? Math.ceil(d / (REVEAL_RADIUS / 2)) : 0;
  let added = revealAround(cells, to.lat, to.lng);
  if (from) for (let s = 1; s < n; s++) added += revealAround(cells, from.lat + (to.lat - from.lat) * s / n, from.lng + (to.lng - from.lng) * s / n);
  return added;
}
