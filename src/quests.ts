// The two test quests, no AI: "reach" (walk to a marked spot) and "find" (uncover new places). Pure logic plus a small store, so Node can test it.
// Both finish the same way, by finding places, so quests need nothing from the map beyond what discovery already knows.
import { dist } from './fog.ts';
import { placeKey, type Place } from './places.ts';
import { QUEST_MIN_M, QUEST_MAX_M, QUEST_FIND, QUEST_KEY, REVEAL_RADIUS } from './config.ts';
import type { Goal } from './today.ts';
import type { LatLng } from './types.ts';

interface Base { seq: number; done: boolean }                     // seq 0, 1, 2…: even is a reach quest, odd is a find quest
export interface Reach extends Base { kind: 'reach'; key: string; lat: number; lng: number; start: number }   // key = the target place's id; start = metres to it when the quest began
export interface Find extends Base { kind: 'find'; need: number; ids: string[] }                             // ids = the places found so far for this quest
export type Quest = Reach | Find;

const MAX_NEED = 50;                                              // bounds what a damaged stored value can cost

// The next quest, or null when there is nothing left to find. `found` holds indexes into `places`; `me` is where you are now.
export function makeQuest(seq: number, places: Place[], found: Set<number>, me: LatLng, rng: () => number = Math.random): Quest | null {
  const open = places.filter((_, i) => !found.has(i));
  if (!open.length) return null;
  if (seq % 2) return { kind: 'find', seq, done: false, need: Math.min(QUEST_FIND, open.length), ids: [] };
  const far = open.map((p) => ({ p, d: dist(me, p) })).filter(({ d }) => d >= REVEAL_RADIUS + 20);   // a place you're standing next to is found by the next step, so it is no quest
  if (!far.length) return null;
  const band = far.filter(({ d }) => d >= QUEST_MIN_M && d <= QUEST_MAX_M);
  const pick = band.length ? band[Math.floor(rng() * band.length)] : far.reduce((a, b) => (b.d < a.d ? b : a));   // ponytail: nearest unfound place when none sits in the band
  return { kind: 'reach', seq, done: false, key: placeKey(pick.p), lat: pick.p.lat, lng: pick.p.lng, start: pick.d };
}

// Applies new finds. `fresh` = every place just found (a reach target found while the page was closed still counts);
// `announced` = the finds that were new to this visit (only those count toward "find N new places"). Returns the same object when nothing changed.
export function progress(q: Quest, fresh: Place[], announced: Place[]): Quest {
  if (q.done) return q;
  if (q.kind === 'reach') return fresh.some((p) => placeKey(p) === q.key) ? { ...q, done: true } : q;
  const ids = [...new Set([...q.ids, ...announced.map(placeKey)])].slice(0, q.need);
  return ids.length === q.ids.length ? q : { ...q, ids, done: ids.length >= q.need };
}

const label = (m: number) => { const r = Math.round(m / 10) * 10; return r >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, r)} m`; };   // rounded to 10 m (round first, then pick the unit: 997 m is "1.0 km", not "1000 m"), so the chip doesn't change on every step
const places = (n: number) => `${n} new place${n === 1 ? '' : 's'}`;

// How far you are from a reach quest's spot, metres (its start distance until we know where you are).
export const distanceTo = (q: Reach, me: LatLng | null) => (me ? dist(me, q) : q.start);

// The quest as the chip's goal: same shape as the daily goal, so the chip and rings draw it unchanged.
export function goalOf(q: Quest, me: LatLng | null): Goal {
  if (q.kind === 'find') {
    const n = q.ids.length, left = q.need - n;
    return {
      title: 'Quest', found: n, target: q.need, done: q.done, progress: Math.min(1, n / q.need),
      label: q.done ? 'Quest done' : n === 0 ? `Find ${places(q.need)}` : `${n} of ${places(q.need)}`,
      detail: q.done ? 'Quest done. The next one starts soon.' : `Uncover ${q.need} place${q.need === 1 ? '' : 's'} you haven’t found yet, ${left} to go`,
    };
  }
  const d = distanceTo(q, me);
  return {
    title: 'Quest', found: q.done ? 1 : 0, target: 1, done: q.done, progress: q.done ? 1 : Math.max(0, Math.min(1, 1 - d / q.start)),
    label: q.done ? 'Quest done' : `Reach the marked spot, ${label(d)}`,
    detail: q.done ? 'Quest done. The next one starts soon.' : `Walk to the marked spot on the map, about ${label(d)} away`,
  };
}

// Anything read back is untrusted: a damaged or old value gives null, and a new quest is made.
export function parseQuest(raw: unknown): Quest | null {
  const q = raw as (Partial<Omit<Reach, 'kind'> & Omit<Find, 'kind'>> & { kind?: string }) | null;
  if (!q || typeof q !== 'object' || !Number.isSafeInteger(q.seq) || (q.seq as number) < 0 || typeof q.done !== 'boolean') return null;
  const base = { seq: q.seq as number, done: q.done };
  if (q.kind === 'find')
    return Number.isInteger(q.need) && q.need! >= 1 && q.need! <= MAX_NEED && Array.isArray(q.ids) && q.ids.length <= MAX_NEED && q.ids.every((x) => typeof x === 'string')
      ? { ...base, kind: 'find', need: q.need!, ids: q.ids } : null;
  if (q.kind === 'reach')
    return typeof q.key === 'string' && q.key.length <= 80 && Number.isFinite(q.lat) && Number.isFinite(q.lng) && Number.isFinite(q.start) && q.start! > 0
      ? { ...base, kind: 'reach', key: q.key, lat: q.lat!, lng: q.lng!, start: q.start! } : null;
  return null;
}

// localStorage can throw (blocked, private mode, full): the quest then simply doesn't survive a reload.
export const questStoreKey = (debug: boolean) => QUEST_KEY + (debug ? ':debug' : '');
export function readQuest(key: string): Quest | null {
  try { return parseQuest(JSON.parse(localStorage.getItem(key) ?? 'null')); } catch { return null; }
}
export function writeQuest(key: string, q: Quest) {
  try { localStorage.setItem(key, JSON.stringify(q)); } catch { /* not remembered */ }
}
export function clearQuest(key: string) {
  try { localStorage.removeItem(key); } catch { /* nothing to clear */ }
}
