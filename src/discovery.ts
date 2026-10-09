// The neighbourhood game state: which places exist, which are found, and how much of the area is explored.
// Owns the stats readout and the "Found" toast; main.ts only tells it when to start and when new cells were cleared.
import * as fogLayer from './fogLayer.ts';
import * as places from './places.ts';
import * as placesLayer from './placesLayer.ts';
import * as coverage from './coverage.ts';
import * as hud from './hud.ts';
import * as fog from './fog.ts';
import * as sound from './sound.ts';
import * as today from './today.ts';
import * as quests from './quests.ts';
import * as questLayer from './questLayer.ts';
import { toast } from './ui.ts';
import * as regions from './region.ts';
import { AREA_RADIUS, PLACES_RETRY_MS, PLACES_TIMEOUT_MS, QUEST_NEXT_MS, REANCHOR_M, REGION_RETRY_MS } from './config.ts';
import type { Fix } from './types.ts';

let placeList: places.Place[] = [];                  // the places of the current region
const found = new Set<number>();                     // indexes into placeList; recomputed from the fog whenever the region changes
const everFound = new Set<string>();                 // keys of every place this device has found (stored): a find is new exactly when it is not in here
let foundKey = '';
let legacyFog: Set<number> | null = null;              // a device with fog saved before the found list existed: the places under that fog count as found already (it showed them), once
let last: places.Place | null = null;               // the most recent find in this region (not remembered across reloads)
let area: fog.Cells | null = null;                   // the 2 km circle as cells; built just after the region is set (it takes tens of ms)
// Regions (see region.ts). One is current; a failed or running load never blocks the fog or the places already on screen.
let current: regions.Region | null = null;
let kept: regions.Region[] = [];                     // the regions stored on the phone, most recent first (the shipped SUTD file is not one of them: it is always read from the file)
let seedUrl = '', placesApi = '', regionKey = '';
let loading = false;                                 // a load is running (one at a time)
let failed = false, failedKey = '', failedAt = -Infinity;   // the last server load failed (the stats card says so) / which load failed last (the seed, or a centre) and when
let emptyTries = 0, emptyAt = -Infinity, fromService = false;   // the current region came from the service with no places: it is asked for again, a couple of times (it may have been a throttled server)
let inside = false;                                  // you have been within the current region's circle, so leaving it is worth a "New area" message
// Test hook, like window.fogMap: the browser tests shorten the two waits below (150 s for the service, 60 s before asking again).
const tuning = (): { timeoutMs?: number; retryMs?: number } => (import.meta.env.DEV ? (window as { __tuning?: { timeoutMs?: number; retryMs?: number } }).__tuning : undefined) ?? {};   // dev server only: a production build ignores it
const retryMs = () => tuning().retryMs ?? REGION_RETRY_MS;
let todayKey = '', todayState: today.Today = { date: '', ids: [] };
let quest: quests.Quest | null = null;              // the active quest (a finished one stays here for QUEST_NEXT_MS, so the chip can say "Quest done")
let questKey = '', lastSeq = -1;                    // where it is saved ('' = quests are off), and the number of the latest quest (the next one is lastSeq + 1)
let pos: Fix | null = null;                          // where you are, from the latest accurate fix (a reach quest measures from here)
let shownLabel = '';

// The places found today, on the phone's local date: what this tab remembers plus whatever is stored (another tab may have counted too).
// Counting which places, not how many, means the same place never counts twice, however many tabs find it. Asking also rolls over at midnight.
const countToday = (add: string[] = []) => {
  const next = today.countToday(new Date(), add, todayState, today.readToday(todayKey));
  if (next.date !== todayState.date || next.ids.length !== todayState.ids.length) today.writeToday(todayKey, next);
  return (todayState = next);
};
const dailyGoal = () => today.goalOf(countToday().ids.length);
// The one goal the chip's ring shows: the quest's, or the daily one when there is no quest. `daily` is always today's count (the card keeps a line for it).
function goals() {
  const daily = dailyGoal();
  return { daily, goal: quest ? quests.goalOf(quest, pos) : daily };
}
function showGoal() {
  const { goal, daily } = goals();
  shownLabel = goal.label;
  hud.showGoal(goal, daily);
}

// The active quest changed: save it, and show its spot (a reach quest that isn't done) on the map.
function setQuest(q: quests.Quest | null) {
  quest = q;
  if (q) { lastSeq = q.seq; quests.writeQuest(questKey, q); }
  if (q?.kind === 'reach' && !q.done) questLayer.show(q, () => (quest ? quests.goalOf(quest, pos).label : ''));
  else questLayer.clear();
}

// Starts the next quest once there is a position and a list of places to pick from. Does nothing while a quest (even a finished one) is on the chip.
function ensureQuest() {
  if (!questKey || quest || !pos || !placeList.length) return;
  const q = quests.makeQuest(lastSeq + 1, placeList, found, pos) ?? quests.makeQuest(lastSeq + 2, placeList, found, pos);   // no reach target to be had (all places are right here): a find quest instead of none
  if (q) { setQuest(q); showGoal(); }
}

// Brings the saved quest back. A finished one, a reach quest whose place is gone from the file, or damaged data just means a fresh quest.
function restoreQuest() {
  if (!questKey) return;
  const saved = quests.readQuest(questKey);
  if (!saved) return;
  lastSeq = saved.seq;
  if (!saved.done && (saved.kind === 'find' || placeList.some((p) => places.placeKey(p) === saved.key))) setQuest(saved);
}

function refresh() {
  const fraction = area ? fogLayer.countIn(area) / area.size : 0;       // ponytail: counts all cleared cells (~1x/s); keep a running count if that shows in a profile
  hud.showStats({
    ...goals(), found: found.size, total: placeList.length, groups: places.countsByGroup(placeList, found),
    percent: coverage.formatPercent(fraction), fraction, last,
    note: !placeList.length && failed ? 'No places loaded for this area yet' : '',
  });
}

// Finds places under cleared fog. A find is new (message, chime, today's count, quest progress) when this device has not found that place before,
// whenever and wherever the fog under it was cleared: fog cleared while no places were loaded still counts once they arrive.
function check() {
  const fresh = places.discover(placeList, found, fogLayer.isRevealed);
  if (fresh.length) for (const id of today.readFound(foundKey)) everFound.add(id);   // what another tab found since
  let changed = false;
  if (legacyFog) for (const p of fresh) if (fog.isRevealed(legacyFog, p.lat, p.lng) && !everFound.has(places.placeKey(p))) { everFound.add(places.placeKey(p)); changed = true; }
  const news = fresh.filter((p) => !everFound.has(places.placeKey(p)));            // decided once: the toast and the pulse always agree
  if (news.length || changed) { news.forEach((p) => everFound.add(places.placeKey(p))); today.writeFound(foundKey, everFound); }
  const loud = new Set(news);
  fresh.forEach((p) => placesLayer.addPlace(p, loud.has(p)));          // announced finds also get the gold pulse
  let questDone = false;
  if (quest) {                                                          // every find goes to the quest: a quiet one can still complete a reach quest
    const next = quests.progress(quest, fresh, news);
    if (next !== quest) { questDone = next.done; setQuest(next); }
  }
  if (news.length) {
    last = news[news.length - 1];
    const dailyWas = dailyGoal().done;
    countToday(news.map(places.placeKey));
    const detail = questDone ? 'Quest done' : !dailyWas && dailyGoal().done ? 'Today’s goal done' : news.length === 1 ? places.typeLabel(news[0].type) : '';
    toast(places.foundMessage(news), detail);
    hud.dismissHint();                                                  // a first find shows the hint was no longer needed
    sound.chime();                                                      // silent until the first tap, and when muted
    if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(60);   // browsers ignore (and warn about) vibration before the first tap; iPhones have none
  }
  const finished = quest;
  if (questDone) setTimeout(() => { if (quest === finished) { setQuest(null); ensureQuest(); refresh(); } }, QUEST_NEXT_MS);   // only if that quest is still the one on the chip   // the chip says "Quest done" for a moment, then the next one starts
  refresh();
}

// Call when walking has just cleared new cells.
export const onCleared = check;

// Call with every accurate fix, before the fog is cleared: a reach quest measures from here, and the first fix starts the first quest.
export function onMove(fix: Fix) {
  pos = fix;
  decide(fix);                                                          // a new region first, so a quest is never picked from places you have left behind
  if (!quest) ensureQuest();
  else if (quest.kind === 'reach' && !quest.done && quests.goalOf(quest, pos).label !== shownLabel) showGoal();   // the label is rounded to 10 m, so the chip changes only when it says something new
}

// For the browser tests: the quest on the chip right now (a copy).
export const activeQuest = () => quest && { ...quest };

// A network or server error is retried a couple of times (phones walk through bad signal); a missing file (4xx) is final.
// `service`: a request to the places service. It gets a time limit, and a 5xx or a timeout is not retried: the service has already tried three Overpass servers,
// and asking again at once would only triple the load on them (a dropped connection is still retried).
async function loadFile(url: string, service = false): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const stop = new AbortController();                                    // not AbortSignal.timeout: iPhones before iOS 16 lack it
    const timer = service ? setTimeout(() => stop.abort(), tuning().timeoutMs ?? PLACES_TIMEOUT_MS) : 0;   // covers the whole answer, not just the first byte
    try {
      const r = await fetch(url, service ? { signal: stop.signal } : undefined);
      if (r.ok) return await r.json();
      if (r.status < 500) throw Object.assign(new Error(String(r.status)), { final: true });
      throw Object.assign(new Error(String(r.status)), { final: service });
    } catch (e) {
      if ((e as { final?: boolean }).final || (e as Error).name === 'AbortError' || attempt >= PLACES_RETRY_MS.length) throw e;   // a timeout is final
      await new Promise((resolve) => setTimeout(resolve, PLACES_RETRY_MS[attempt]));
    } finally { clearTimeout(timer); }
  }
}

// You walked out of the region on screen and nothing stored covers you: its places are no use here, so they go until the new ones arrive.
function clearRegion() {
  current = null; placeList = []; found.clear(); last = null; area = null;
  placesLayer.clear();
  if (quest?.kind === 'reach' && !quest.done) setQuest(null);
  refresh();
}

// Makes `r` the region on screen. Which of its places are found is worked out again from the fog; the ones this device has not found before are announced.
// `store`: keep it on the phone (everything but the shipped file).
function setRegion(r: regions.Region, store: boolean) {
  const again = !!current && current.center.lat === r.center.lat && current.center.lng === r.center.lng;   // the same region asked for again (it was empty)
  const leaving = inside && !again; inside = false;
  if (!again) emptyTries = 0;
  if (!r.places.length) emptyAt = performance.now();                    // asked again a minute after this
  current = r; fromService = store; failed = false;
  if (store && r.places.length) { kept = regions.keep(kept, r); regions.writeRegions(regionKey, kept); }   // an empty answer is not kept: it may have been a throttled server, and kept regions are never asked again
  placeList = r.places; found.clear(); last = null; area = null;
  placesLayer.clear();
  setTimeout(() => { if (current === r) { area = coverage.circleCells(r.center, AREA_RADIUS); refresh(); } }, 0);
  if (!quest) restoreQuest();                                           // before the check, so a quest's own place found in restored fog still counts
  else if (quest.kind === 'reach' && !quest.done && !placeList.some((p) => places.placeKey(p) === (quest as quests.Reach).key)) setQuest(null);   // its spot is in the region you left: the next quest takes over
  if (leaving) toast('New area', r.places.length ? `${r.places.length} places within 2 km` : 'No places within 2 km');   // before the check, so a find's message wins
  check();
  ensureQuest();
}

// One load at a time. A failure is remembered, so a missing file or a dead server is not asked again on every step.
function load(key: string, get: () => Promise<regions.Region>) {
  const server = key !== 'seed';                                        // the shipped file is read and never stored; everything else comes from the service and is kept
  loading = true;
  get().then(
    // A load can finish after you have walked on: a region that no longer covers you is dropped (the server has cached it, so asking again is cheap).
    (r) => { if (!pos || fog.dist(pos, r.center) <= REANCHOR_M) setRegion(r, server); },
    (e) => { console.warn('No places for this area:', e); failedKey = key; failedAt = performance.now(); failed = server; },   // only the loading is caught here, so a bug in setRegion stays visible
  ).finally(() => { loading = false; refresh(); if (pos) decide(pos); });
}
const loadSeed = async () => {
  const r = regions.parseSeed(await loadFile(seedUrl));
  if (!r) throw new Error('places file is not usable');
  return r;
};
const loadFromServer = async (center: regions.Region['center']) => {
  const r = regions.parseRegion(await loadFile(`${placesApi}/places?lat=${center.lat}&lng=${center.lng}`, true));
  if (!r) throw new Error('not a region');
  return r;
};

// With every accurate fix: keep the region, switch to a stored one, or load a new one around you (see region.ts for the rule).
function decide(fix: Fix) {
  if (current && fog.dist(fix, current.center) <= AREA_RADIUS) inside = true;
  const pick = regions.pickRegion(fix, current, kept);
  if (pick.kind === 'stay') return askAgainIfEmpty();
  if (pick.kind === 'use') return setRegion(pick.region, true);        // from the phone: never waits for a load or a failure
  if (current && fog.dist(fix, current.center) > AREA_RADIUS) clearRegion();   // you have left it: its places go now, not after the wait below
  const key = pick.kind === 'seed' ? 'seed' : `${pick.center.lat},${pick.center.lng}`;
  if (loading || (key === failedKey && performance.now() - failedAt < retryMs())) return;   // one load at a time, and a failed one is not asked again at once
  if (pick.kind === 'seed') return load(key, loadSeed);
  if (!placesApi) { failed = true; refresh(); return; }                // no server set up: only the stored regions and SUTD work
  load(key, () => loadFromServer(pick.center));
}

// A region from the service with no places may be a throttled Overpass, not an empty countryside: ask again, twice, a minute apart.
function askAgainIfEmpty() {
  if (!current || current.places.length || !fromService || !placesApi || loading || emptyTries >= 2 || performance.now() - emptyAt < retryMs()) return;
  emptyTries++; emptyAt = performance.now();
  const c = current.center;
  load(`${c.lat},${c.lng}`, () => loadFromServer(c));
}

// Brings back the last region at once (no GPS wait, no network), or reads the shipped SUTD file when nothing is stored. No file just means nothing to discover.
// Places this device found before show up quietly; anything else under cleared fog is a new find, even if the region arrives late.
export function start(seed: string, api: string, regionStoreKey: string, todayStoreKey: string, foundStoreKey: string, questStoreKey: string | null) {   // questStoreKey null: quests are off. Returns the centre of the region it opened with, if any
  seedUrl = seed; placesApi = api; regionKey = regionStoreKey; foundKey = foundStoreKey;
  todayKey = todayStoreKey;
  questKey = questStoreKey ?? '';
  todayState = today.countToday(new Date(), [], today.readToday(todayKey));   // today's finds from earlier in the day, if the app was closed and reopened
  refresh();
  // An app left open overnight must start the new day: look again when it comes back to the foreground, and once a minute.
  const newDay = showGoal;                                             // only the goal: no need to recount the whole map for this
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') newDay(); });
  setInterval(newDay, 60_000);
  for (const id of today.readFound(foundKey)) everFound.add(id);
  if (!today.hasFound(foundKey)) {                                     // first run of this version on this device (an empty list is written, so this happens once)
    const saved = fogLayer.snapshot();
    if (saved.length) legacyFog = new Set(saved);
    today.writeFound(foundKey, everFound);
  }
  kept = regions.readRegions(regionKey);
  if (kept.length) setRegion(kept[0], false);
  else load('seed', loadSeed);                           // the first fix then keeps SUTD, or swaps it for a region around you
  return kept[0]?.center ?? null;                                      // where the map should open
}
