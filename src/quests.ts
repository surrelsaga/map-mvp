// The two quests: "reach" (find a hidden spot from a hint; it is marked on the map only if you need help) and "find" (uncover new places). Pure logic plus a small store, so Node can test it.
// Both finish the same way, by finding places, so quests need nothing from the map beyond what discovery already knows.
import { dist } from './fog.ts';
import { placeKey, groupOf, legendOf, type Group, type Place } from './places.ts';
import { QUEST_MIN_M, QUEST_MAX_M, QUEST_FIND, QUEST_KEY, REVEAL_RADIUS, QUEST_REVEAL_MS, QUEST_PAST_M, QUEST_FAR_RATIO, QUEST_FAR_MIN_M, QUEST_HELP_MS, QUEST_COLD_M, QUEST_CLOSE_M, TRAIL_NEED, TRAIL_R, LEGEND_MAX_M } from './config.ts';
import type { Goal } from './today.ts';
import type { LatLng } from './types.ts';

// seq 0, 1, 2…: seq % 3 = 0 is a reach quest, 1 a find quest, 2 a trail (a find quest of one kind). clues = what Gemma wrote, one per stage ('' = it could not: the plain line is used); none yet = the plain lines.
interface Base { seq: number; done: boolean; clues?: string[] }
// key = the target place's id; start = metres to it when the quest began; t = when it began (ms); best = the closest you have been (m);
// help = the wisp is out (you tried: it points the way, and the second clue is unlocked); revealed = its spot is marked on the map (the last resort)
// legend = a famous place, further away than a reach quest goes, and never marked on the map for you (it is found by walking)
export interface Reach extends Base { kind: 'reach'; key: string; lat: number; lng: number; start: number; t: number; best: number; help: boolean; revealed: boolean; legend: boolean }
// ids = the places found so far for this quest; group = a trail: only places of that kind count (none: any new place does)
export type TrailGroup = Exclude<Group, 'other'>;
export interface Find extends Base { kind: 'find'; need: number; ids: string[]; group?: TrailGroup }
export type Quest = Reach | Find;

const MAX_NEED = 50;                                              // bounds what a damaged stored value can cost
const MAX_TEXT = 200, MAX_CLUES = 3;

// The next quest, or null when there is nothing left to find. `found` holds indexes into `places`; `me` is where you are now.
// The kind with the most places still hidden within TRAIL_R of you, if it has TRAIL_NEED of them; null otherwise. Food wins a tie.
function trailGroup(open: Place[], me: LatLng): TrailGroup | null {
  const n: Record<TrailGroup, number> = { food: 0, shop: 0, outdoors: 0 };
  for (const p of open) { const g = groupOf(p.type); if (g !== 'other' && dist(me, p) <= TRAIL_R) n[g]++; }
  const best = (Object.keys(n) as TrailGroup[]).reduce((a, b) => (n[b] > n[a] ? b : a));
  return n[best] >= TRAIL_NEED ? best : null;
}

// `legendOk`: a legend quest may be offered now (the caller allows one a day). `legend` below picks the nearest famous place within LEGEND_MAX_M.
export function makeQuest(seq: number, places: Place[], found: Set<number>, me: LatLng, rng: () => number = Math.random, now = Date.now(), legendOk = false): Quest | null {
  const open = places.filter((_, i) => !found.has(i));
  if (!open.length) return null;
  if (seq % 3 === 2) {                                                      // a trail, or (nothing of one kind to string together) a plain find quest
    const group = trailGroup(open, me);
    if (group) return { kind: 'find', seq, done: false, need: TRAIL_NEED, ids: [], group };
  }
  if (seq % 3) return { kind: 'find', seq, done: false, need: Math.min(QUEST_FIND, open.length), ids: [] };
  const far = open.map((p) => ({ p, d: dist(me, p) })).filter(({ d }) => d >= REVEAL_RADIUS + 20);   // a place you're standing next to is found by the next step, so it is no quest
  if (!far.length) return null;
  const famous = legendOk ? far.filter(({ p, d }) => legendOf(p) && d <= LEGEND_MAX_M).sort((a, b) => a.d - b.d)[0] : undefined;
  if (famous) return { kind: 'reach', seq, done: false, key: placeKey(famous.p), lat: famous.p.lat, lng: famous.p.lng, start: famous.d, t: now, best: famous.d, help: false, revealed: false, legend: true };
  const band = far.filter(({ d }) => d >= QUEST_MIN_M && d <= QUEST_MAX_M);
  const pick = band.length ? band[Math.floor(rng() * band.length)] : far.reduce((a, b) => (b.d < a.d ? b : a));   // ponytail: nearest unfound place when none sits in the band
  return { kind: 'reach', seq, done: false, key: placeKey(pick.p), lat: pick.p.lat, lng: pick.p.lng, start: pick.d, t: now, best: pick.d, help: false, revealed: false, legend: false };
}

// Applies new finds. `fresh` = every place just found (a reach target found while the page was closed still counts);
// `announced` = the finds that were new to this visit (only those count toward "find N new places"). Returns the same object when nothing changed.
export function progress(q: Quest, fresh: Place[], announced: Place[]): Quest {
  if (q.done) return q;
  if (q.kind === 'reach') return fresh.some((p) => placeKey(p) === q.key) ? { ...q, done: true } : q;
  const counted = q.group ? announced.filter((p) => groupOf(p.type) === q.group) : announced;   // a trail counts only its own kind
  const ids = [...new Set([...q.ids, ...counted.map(placeKey)])].slice(0, q.need);
  return ids.length === q.ids.length ? q : { ...q, ids, done: ids.length >= q.need };
}

export const label = (m: number) => { const r = Math.round(m / 10) * 10; return r >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, r)} m`; };   // rounded to 10 m (round first, then pick the unit: 997 m is "1.0 km", not "1000 m"), so the chip doesn't change on every step
const places = (n: number) => `${n} new place${n === 1 ? '' : 's'}`;
export const GROUP_WORDS: Record<TrailGroup, string> = { food: 'food places', shop: 'shops', outdoors: 'outdoor places' };   // "find 3 shops"

// How far you are from a reach quest's spot, metres (its start distance until we know where you are).
export const distanceTo = (q: Reach, me: LatLng | null) => (me ? dist(me, q) : q.start);

// Updates the closest-so-far distance, and gives help once you have tried: the wisp comes out after QUEST_HELP_MS of looking, or once you are QUEST_COLD_M
// past your closest (wrong way), or within QUEST_CLOSE_M. The spot is marked on the map as the last resort: after QUEST_REVEAL_MS, or when you had clearly
// got closer (QUEST_PAST_M or more) and then drifted QUEST_PAST_M back out (walked past it, or lost the trail). Same object when nothing changed.
export function track(q: Reach, me: LatLng | null, now: number): Reach {
  if (q.done) return q;
  const d = distanceTo(q, me), best = Math.min(q.best, d);
  const help = q.help || (q.t > 0 && now - q.t >= QUEST_HELP_MS) ||   // (t 0: saved before quests had a start time, so there is no time to count)
     d - best >= QUEST_COLD_M || d <= QUEST_CLOSE_M;
  const revealed = q.revealed || (!q.legend && now - q.t >= QUEST_REVEAL_MS) || (best <= q.start - QUEST_PAST_M && d - best >= QUEST_PAST_M);
  return best === q.best && help === q.help && revealed === q.revealed ? q : { ...q, best, help, revealed };
}

// Which clue a reach quest is on: 1 the riddle, 2 once the wisp is out, 3 within QUEST_CLOSE_M of the spot. Once you have been that close it stays 3 until
// you are well away again (GPS jitter at the line must not flip the clue on every fix).
export const stage = (q: Reach, me: LatLng | null): 1 | 2 | 3 => {
  const d = distanceTo(q, me);
  return d <= QUEST_CLOSE_M || (q.best <= QUEST_CLOSE_M && d <= QUEST_CLOSE_M * 1.7) ? 3 : q.help ? 2 : 1;
};

// Heading the wrong way: well over the distance you started from (half as far again, and at least QUEST_FAR_MIN_M more).
export const tooFar = (q: Reach, d: number) => d > Math.max(q.start * QUEST_FAR_RATIO, q.start + QUEST_FAR_MIN_M);

// The quest as the chip's goal: same shape as the daily goal, so the chip and rings draw it unchanged.
export function goalOf(q: Quest, me: LatLng | null): Goal {
  if (q.kind === 'find') {
    const n = q.ids.length, left = q.need - n;
    return {
      title: 'Quest', found: n, target: q.need, done: q.done, progress: Math.min(1, n / q.need),
      label: q.done ? 'Quest done' : q.group ? (n === 0 ? `Find ${q.need} ${GROUP_WORDS[q.group]}` : `${n} of ${q.need} ${GROUP_WORDS[q.group]}`) : n === 0 ? `Find ${places(q.need)}` : `${n} of ${places(q.need)}`,
      detail: q.done ? 'Quest done. The next one starts soon.' : q.group ? `Find ${q.need} ${GROUP_WORDS[q.group]} you haven’t found yet, ${left} to go` : `Uncover ${q.need} place${q.need === 1 ? '' : 's'} you haven’t found yet, ${left} to go`,
    };
  }
  const d = distanceTo(q, me);
  return {
    title: 'Quest', found: q.done ? 1 : 0, target: 1, done: q.done, progress: q.done ? 1 : Math.max(0, Math.min(1, 1 - d / q.start)),
    label: q.done ? 'Quest done' : q.revealed ? `Reach the marked spot, ${label(d)}` : `Find the hidden spot, ${label(d)}`,
    detail: q.done ? 'Quest done. The next one starts soon.' : q.revealed ? `Walk to the marked spot on the map, about ${label(d)} away` : `Follow the hint, about ${label(d)} away`,
  };
}

// Anything read back is untrusted: a damaged or old value gives null, and a new quest is made.
export function parseQuest(raw: unknown): Quest | null {
  const q = raw as (Partial<Omit<Reach, 'kind'> & Omit<Find, 'kind'>> & { kind?: string }) | null;
  if (!q || typeof q !== 'object' || !Number.isSafeInteger(q.seq) || (q.seq as number) < 0 || typeof q.done !== 'boolean') return null;
  const given = Array.isArray(q.clues) ? q.clues : [];                  // (a Phase 9 save had one `text`, worded with a direction: it is dropped, and new clues are written)
  const clues = given.length <= MAX_CLUES && given.every((c) => typeof c === 'string' && c.length <= MAX_TEXT) ? given : [];
  const base = { seq: q.seq as number, done: q.done, ...(clues.length ? { clues } : {}) };
  if (q.kind === 'find')
    return Number.isInteger(q.need) && q.need! >= 1 && q.need! <= MAX_NEED && Array.isArray(q.ids) && q.ids.length <= MAX_NEED && q.ids.every((x) => typeof x === 'string')
      ? { ...base, kind: 'find', need: q.need!, ids: q.ids, ...((q.group === 'food' || q.group === 'shop' || q.group === 'outdoors') && { group: q.group }) } : null;
  if (q.kind === 'reach')
    return typeof q.key === 'string' && q.key.length <= 80 && Number.isFinite(q.lat) && Number.isFinite(q.lng) && Number.isFinite(q.start) && q.start! > 0
      ? {
        ...base, kind: 'reach', key: q.key, lat: q.lat!, lng: q.lng!, start: q.start!,
        t: Number.isFinite(q.t) ? q.t! : 0, best: Number.isFinite(q.best) && q.best! >= 0 ? q.best! : q.start!,
        help: typeof q.help === 'boolean' ? q.help : false,                      // saved before the wisp existed: it starts at the first clue and earns help like any other
        revealed: typeof q.revealed === 'boolean' ? q.revealed : true,           // saved before quests had hints: its spot was already marked
        legend: q.legend === true,
      } : null;
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
// The day the last legend quest was offered (one a day). Stored next to the quest, under `<quest key>:legend`.
export function readLegendDay(questKey: string): string {
  try { return localStorage.getItem(questKey + ':legend') ?? ''; } catch { return ''; }
}
export function writeLegendDay(questKey: string, day: string) {
  try { localStorage.setItem(questKey + ':legend', day); } catch { /* not remembered */ }
}
export function clearQuest(key: string) {
  try { localStorage.removeItem(key); } catch { /* nothing to clear */ }
}
