// Today's goal: how many new places have been found today. The pure helpers need no browser; the small store keeps the count on this device.
// The chip's ring shows exactly one goal. For now it is this one; quests will later take over the same slot with a goal of their own.
import { DAILY_GOAL, TODAY_KEY } from './config.ts';

export interface Today { date: string; ids: string[] }              // which places were found today (by key), so the same place can never count twice
export interface Goal { found: number; target: number; done: boolean; progress: number; label: string }

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
    found, target, done,
    progress: Math.min(1, found / target),
    label: done ? 'Today’s goal done' : found === 0 ? `Find ${target} places today` : `${found} of ${target} places today`,
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
