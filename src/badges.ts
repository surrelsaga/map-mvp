// The one badge: "Explorer", earned in levels by the number of places this device has discovered (BADGE_LEVELS: 5, 10, 12).
// Pure logic plus a small store, like today.ts, so Node can test it. The count itself is already kept (the found list): only the dates
// the levels were earned, and the highest level the player has looked at (so the button can show a dot), are stored here.
import { BADGE_KEY, BADGE_LEVELS } from './config.ts';

export interface Badges { earned: Record<string, string>; seen: number }   // earned: level → the day it was earned ("2026-10-10"); seen: the highest level looked at
export const empty = (): Badges => ({ earned: {}, seen: 0 });

// Levels reached with `count` places found, and the next one (null when all are earned).
export const reached = (count: number) => BADGE_LEVELS.filter((l) => count >= l);
export const next = (count: number) => BADGE_LEVELS.find((l) => count < l) ?? null;

// Gives the levels reached that are not earned yet. `fresh` = the new ones (the highest is the one to announce); the same object when nothing is new.
export function award(b: Badges, count: number, day: string): { badges: Badges; fresh: number[] } {
  const fresh = reached(count).filter((l) => !(String(l) in b.earned));
  if (!fresh.length) return { badges: b, fresh };
  return { badges: { ...b, earned: { ...b.earned, ...Object.fromEntries(fresh.map((l) => [String(l), day])) } }, fresh };
}

// A level earned that the player has not looked at yet: the dot on the button.
export const hasNew = (b: Badges) => Object.keys(b.earned).some((l) => Number(l) > b.seen);
export const highest = (b: Badges) => Math.max(0, ...Object.keys(b.earned).map(Number));

// Anything read back is untrusted: only known levels with a plausible date are kept; the rest reads as nothing.
export function parse(raw: unknown): Badges {
  const r = raw as { earned?: unknown; seen?: unknown } | null;
  if (!r || typeof r !== 'object') return empty();
  const earned: Record<string, string> = {};
  if (r.earned && typeof r.earned === 'object')
    for (const l of BADGE_LEVELS) { const d = (r.earned as Record<string, unknown>)[String(l)]; if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) earned[String(l)] = d; }
  return { earned, seen: typeof r.seen === 'number' && Number.isFinite(r.seen) && r.seen >= 0 ? r.seen : 0 };
}

// localStorage can throw (blocked, private mode, full): the badges then simply start again next visit.
export const storeKey = (debug: boolean) => BADGE_KEY + (debug ? ':debug' : '');
export function read(key: string): Badges {
  try { return parse(JSON.parse(localStorage.getItem(key) ?? 'null')); } catch { return empty(); }
}
export function write(key: string, b: Badges) {
  try { localStorage.setItem(key, JSON.stringify(b)); } catch { /* not remembered */ }
}
export function clear(key: string) {
  try { localStorage.removeItem(key); } catch { /* nothing to clear */ }
}
