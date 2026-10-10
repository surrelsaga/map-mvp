// The badges: "Explorer", earned in levels by the number of places this device has discovered (BADGE_LEVELS: 5, 10, 12), and two for famous places
// you have been to: "Local legend" (a famous place to eat or drink) and "Landmark" (any other famous place), each earned once with the place's name and day.
// Pure logic plus a small store, like today.ts, so Node can test it. The count itself is already kept (the found list): only the dates
// the levels were earned, and the highest level the player has looked at (so the button can show a dot), are stored here.
import { BADGE_KEY, BADGE_LEVELS } from './config.ts';

export type FameKind = 'legend' | 'landmark';
export const FAME_KINDS: FameKind[] = ['legend', 'landmark'];
export type Memory = { name: string; day: string };
// earned: level → the day it was earned ("2026-10-10"); seen: the highest level looked at; fame: the place and day of each famous badge; fameSeen: which of those were looked at
export interface Badges { earned: Record<string, string>; seen: number; fame: Partial<Record<FameKind, Memory>>; fameSeen: FameKind[] }
export const empty = (): Badges => ({ earned: {}, seen: 0, fame: {}, fameSeen: [] });

// Levels reached with `count` places found, and the next one (null when all are earned).
export const reached = (count: number) => BADGE_LEVELS.filter((l) => count >= l);
export const next = (count: number) => BADGE_LEVELS.find((l) => count < l) ?? null;

// Gives the levels reached that are not earned yet. `fresh` = the new ones (the highest is the one to announce); the same object when nothing is new.
export function award(b: Badges, count: number, day: string): { badges: Badges; fresh: number[] } {
  const fresh = reached(count).filter((l) => !(String(l) in b.earned));
  if (!fresh.length) return { badges: b, fresh };
  return { badges: { ...b, earned: { ...b.earned, ...Object.fromEntries(fresh.map((l) => [String(l), day])) } }, fresh };
}

// A famous badge, earned once: the first such place you have been to. `fresh` says whether this call earned it.
export function awardFame(b: Badges, kind: FameKind, name: string, day: string): { badges: Badges; fresh: boolean } {
  return b.fame[kind] ? { badges: b, fresh: false } : { badges: { ...b, fame: { ...b.fame, [kind]: { name, day } } }, fresh: true };
}

// A badge earned that the player has not looked at yet: the dot on the button.
export const hasNew = (b: Badges) => Object.keys(b.earned).some((l) => Number(l) > b.seen) || FAME_KINDS.some((k) => b.fame[k] && !b.fameSeen.includes(k));
// Looked at it all: the dot goes.
export const seenAll = (b: Badges): Badges => ({ ...b, seen: highest(b), fameSeen: FAME_KINDS.filter((k) => b.fame[k]) });
export const highest = (b: Badges) => Math.max(0, ...Object.keys(b.earned).map(Number));

// Anything read back is untrusted: only known levels with a plausible date are kept; the rest reads as nothing.
export function parse(raw: unknown): Badges {
  const r = raw as { earned?: unknown; seen?: unknown } | null;
  if (!r || typeof r !== 'object') return empty();
  const earned: Record<string, string> = {};
  if (r.earned && typeof r.earned === 'object')
    for (const l of BADGE_LEVELS) { const d = (r.earned as Record<string, unknown>)[String(l)]; if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) earned[String(l)] = d; }
  const fame: Badges['fame'] = {}, src = (r as { fame?: Record<string, unknown> }).fame;
  for (const k of FAME_KINDS) {
    const m = src?.[k] as { name?: unknown; day?: unknown } | undefined;
    if (m && typeof m.name === 'string' && m.name && m.name.length <= 80 && typeof m.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.day)) fame[k] = { name: m.name, day: m.day };
  }
  const seenFame = (r as { fameSeen?: unknown }).fameSeen;
  const fameSeen = Array.isArray(seenFame) ? FAME_KINDS.filter((k) => seenFame.includes(k) && fame[k]) : [];
  return { earned, seen: typeof r.seen === 'number' && Number.isFinite(r.seen) && r.seen >= 0 ? r.seen : 0, fame, fameSeen };
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
