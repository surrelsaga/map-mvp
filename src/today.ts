// Today's goal: how many new places have been found today. The pure helpers need no browser; the small store keeps the count on this device.
// The chip's ring shows exactly one goal: a quest's when one is active (quests.ts builds a Goal too), else this one.
import { DAILY_GOAL, TODAY_KEY, FOUND_KEY, FOUND_MAX } from './config.ts';

export interface Today { date: string; ids: string[] }              // which places were found today (by key), so the same place can never count twice
export interface Goal { title: string; found: number; target: number; done: boolean; progress: number; label: string; detail: string }   // label = the chip's text, detail = the line in the card

// The phone's local date, "2026-10-09": the goal resets when it changes.
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const valid = (v: unknown): v is Today => typeof (v as Today)?.date === 'string' && Array.isArray((v as Today).ids) && (v as Today).ids.every((x) => typeof x === 'string');
const MAX_IDS = 5000;                                                    // a day can't hold more finds than there are places; this just bounds what a damaged value can cost

// Today's finds: every saved state that belongs to today (this tab's memory, what is stored, what another tab wrote), plus `add`.
// Anything saved on another day or damaged is ignored, so yesterday's count never leaks in and a stale tab can't drag today's down.
export function countToday(now: Date, add: string[], ...saved: unknown[]): Today {
  const date = dayKey(now);
  const ids = new Set<string>();
  for (const s of saved) if (valid(s) && s.date === date) for (const id of s.ids) ids.add(id);
  for (const id of add) ids.add(id);
  return { date, ids: [...ids].slice(0, MAX_IDS) };
}

export function goalOf(found: number, target: number = DAILY_GOAL): Goal {
  const done = found >= target;
  return {
    title: 'Today', found, target, done,
    progress: Math.min(1, found / target),
    label: done ? 'Today’s goal done' : found === 0 ? `Find ${target} places today` : `${found} of ${target} places today`,
    detail: done ? 'All done. More finds are a bonus.' : `${found} of ${target} new places, ${target - found} to go`,
  };
}

// localStorage can throw (blocked, private mode, full): the goal then simply doesn't survive a reload.
export function readToday(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
export function writeToday(key: string, value: Today) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not remembered */ }
}
export const todayStoreKey = (debug: boolean) => TODAY_KEY + (debug ? ':debug' : '');

// Every place this device has ever found (their keys). A find is new exactly when it is not in here, wherever the fog under it came from:
// fog cleared while no places were loaded (service down, asleep or slow) is still unclaimed until the places arrive.
// Untrusted when read: anything that is not a list of short strings gives nothing; the newest FOUND_MAX stay.
export function parseFound(raw: unknown): string[] {
  const ids = (raw as { ids?: unknown } | null)?.ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && x.length <= 120).slice(-FOUND_MAX) : [];
}
export function hasFound(key: string): boolean {
  try { return localStorage.getItem(key) !== null; } catch { return true; }   // storage that throws cannot be told apart from a first run: treat it as not a first run
}
export function readFound(key: string): string[] {
  try { return parseFound(JSON.parse(localStorage.getItem(key) ?? 'null')); } catch { return []; }
}
export function writeFound(key: string, ids: Iterable<string>) {
  try { localStorage.setItem(key, JSON.stringify({ ids: [...new Set(ids)].slice(-FOUND_MAX) })); } catch { /* not remembered */ }
}
export const foundStoreKey = (debug: boolean) => FOUND_KEY + (debug ? ':debug' : '');
