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
import * as questText from './questText.ts';
import * as gemma from './gemma.ts';
import * as badges from './badges.ts';
import { toast } from './ui.ts';
import * as regions from './region.ts';
import { AREA_RADIUS, PLACES_RETRY_MS, PLACES_TIMEOUT_MS, QUEST_NEXT_MS, REANCHOR_M, REGION_RETRY_MS, GEMMA_TRIES, TOAST_MS } from './config.ts';
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
let pos: Fix | null = null;                          // where you are, from the latest accurate fix
// Quests (Phase 9). A quest outlives a region change: its target is a point, and the places list is only needed to write about it.
let quest: quests.Quest | null = null;              // the active quest (a finished one stays here for QUEST_NEXT_MS, so its card can say "Found it")
let questKey = '', lastSeq = -1;                    // where it is saved ('' = quests are off), and the number of the latest quest (the next one is lastSeq + 1)
let shownLabel = '', shownSeq = -1, shownDone = -1, shownStage = 0;    // what the quest pill says now, which quest has had its card opened, and which one's "Found it" has
let writing = -1;                                   // the quest Gemma is writing a line for (-1: none)
let warned = false;                                 // the "heading away" alert has been given (again once you come back within the start distance)
let badgeKey = '', badgeState = badges.empty();      // the Explorer badge: which levels are earned (stored), by the count of places this device has found
const badgeView = (): hud.BadgeView => ({ count: everFound.size, earned: badgeState.earned, fame: badgeState.fame, hasNew: badges.hasNew(badgeState) });
let badgeShown = '';                                // what the badge card shows now: it is only redrawn when that changes (not with every step)
function showBadges() {
  const v = badgeView(), key = `${v.count}|${Object.keys(v.earned).join()}|${JSON.stringify(v.fame)}|${v.hasNew}`;
  if (key === badgeShown) return;
  badgeShown = key; hud.showBadges(v);
}

// The places found today, on the phone's local date: what this tab remembers plus whatever is stored (another tab may have counted too).
// Counting which places, not how many, means the same place never counts twice, however many tabs find it. Asking also rolls over at midnight.
const countToday = (add: string[] = []) => {
  const next = today.countToday(new Date(), add, todayState, today.readToday(todayKey));
  if (next.date !== todayState.date || next.ids.length !== todayState.ids.length) today.writeToday(todayKey, next);
  return (todayState = next);
};
const dailyGoal = () => today.goalOf(countToday().ids.length);
function showGoal() { hud.showGoal(dailyGoal()); }

const buzz = (ms: number) => { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(ms); };   // browsers ignore (and warn about) vibration before the first tap; iPhones have none

// What Gemma (or the plain line) is told about a quest, for a clue stage. `near` is the nearest place you have already found within 200 m of the target.
function factsFor(q: quests.Quest, stage: questText.Stage = 1): questText.Facts {
  if (q.kind === 'find') {
    const open = placeList.filter((p, i) => !found.has(i) && (!q.group || places.groupOf(p.type) === q.group)).map((p) => ({ p, d: pos ? fog.dist(pos, p) : 0 })).sort((a, b) => a.d - b.d);
    return { kind: 'find', need: q.need, ...(q.group && { words: quests.GROUP_WORDS[q.group] }), kinds: [...new Set(open.slice(0, 12).map(({ p }) => places.typeLabel(p.type).toLowerCase()))].slice(0, 3) };   // the kinds of place nearest you, so Gemma has something real to name
  }
  const target = placeList.find((p) => places.placeKey(p) === q.key);
  const near = placeList.filter((_, i) => found.has(i)).map((p) => ({ p, d: fog.dist(p, q) })).filter(({ d }) => d <= 200).sort((a, b) => a.d - b.d)[0]?.p.name ?? null;
  return { kind: 'reach', what: places.typeLabel(target?.type ?? 'place').toLowerCase(), hidden: target?.name ?? '', stage, near, legend: q.legend };
}

// Which clue you are on: a reach quest moves 1 → 2 (the wisp is out) → 3 (close); a find quest has one.
const stageOf = (q: quests.Quest): questText.Stage => (q.kind === 'reach' && !q.done ? quests.stage(q, pos) : 1);
// The line for a stage: Gemma's, or the plain one when it had none (or could not).
const clueOf = (q: quests.Quest, stage: questText.Stage) => q.clues?.[stage - 1] || questText.template(factsFor(q, stage));

// The quest pill (top right) and its card: one line, the clue you are on. A finished reach quest says what the clues were about, so the walker sees the riddle resolve.
function showQuest(reveal = false) {
  if (!quest) { shownSeq = -1; shownStage = 0; hud.showQuest(null); return; }   // (shownDone stays: a quest is never numbered twice)
  const goal = quests.goalOf(quest, pos);
  shownLabel = goal.label;
  const stage = stageOf(quest);
  const name = quest.kind === 'reach' && quest.done ? placeList.find((p) => places.placeKey(p) === (quest as quests.Reach).key)?.name : undefined;   // what the clues were about
  const short = quest.done ? 'Done' : quest.kind === 'reach' ? quests.label(quests.distanceTo(quest, pos)) : `${quest.ids.length}/${quest.need}`;
  // A new quest opens its card once: right away, or (when Gemma is about to write the clue) when it is ready, so the line doesn't change under the reader's eyes.
  const arrived = quest.done && shownDone !== quest.seq;                // a finished quest shows its payoff once
  const unlocked = shownStage !== stage && shownSeq === quest.seq;      // a new clue of the quest you are on
  const written = quest.clues?.[stage - 1] !== undefined;
  const open = reveal || arrived || unlocked || (quest.seq !== shownSeq && (written || !gemma.isReady()));
  hud.showQuest({ goal, short, line: name ? `Found it: ${name}` : clueOf(quest, stage), detail: name ? clueOf(quest, 1) : '', byGemma: !!quest.clues?.[stage - 1] && !name && !(quest.kind === 'reach' && quest.legend && stage === 1), legend: quest.kind === 'reach' && quest.legend, plain: !quest.clues?.[stage - 1] }, open);
  if (open) shownSeq = quest.seq;
  if (arrived) shownDone = quest.seq;
  shownStage = stage;
}

// Writes the quest's clues with Gemma, one after another, if it is loaded: all of them at the start, so an unlock never waits for the model. Each is saved as it
// arrives. Until one answers (or if GEMMA_TRIES answers all fail the checks: '' is saved) the plain line shows.
function writeClues(q: quests.Quest) {
  const want = q.kind === 'reach' ? 3 : q.group ? 0 : 1;               // (a trail's plain line says exactly which kind counts: a model's line could say "any place")
  if (q.done || writing === q.seq || !pos || !gemma.isReady() || (q.clues?.length ?? 0) >= want) return;   // (no model: the plain lines need no writing)
  writing = q.seq;
  (async () => {
    for (let stage = ((q.clues?.length ?? 0) + 1) as questText.Stage; stage <= want; stage++) {
      let text = '';
      for (let i = 0; i < GEMMA_TRIES && quest?.seq === q.seq; i++) {
        const f = factsFor(quest!, stage);
        const raw = await gemma.write(questText.prompt(f));
        if (raw === null) { if (quest?.seq === q.seq) showQuest(); return; }   // not loaded (yet, or unloaded meanwhile): onWriterReady asks again, and the plain line may open the card now
        text = questText.clean(raw, f) ?? '';
        if (text) break;
        console.debug('Gemma clue rejected:', raw);                      // to tune the checks (questText.clean) against real answers
      }
      if (quest?.seq !== q.seq || quest.done) return;                    // a quest finished while Gemma wrote keeps its object: the next-quest timer compares it
      setQuest({ ...quest, clues: [...(quest.clues ?? []), text] });
    }
  })().catch((e) => { console.warn('Gemma could not write the quest:', e); if (quest?.seq === q.seq) showQuest(true); }).finally(() => { if (writing === q.seq) writing = -1; });
}

// The active quest changed: save it, mark its spot on the map (a reach quest that isn't done, once revealed), show its pill and wisp, and get Gemma writing its clues.
// Only a quest is written down: a dropped or finished one is simply replaced by the next, and `lastSeq` keeps the numbering going.
function setQuest(q: quests.Quest | null) {
  quest = q;
  if (q) { lastSeq = q.seq; quests.writeQuest(questKey, q); writeClues(q); }
  if (q?.kind === 'reach' && !q.done && q.revealed) questLayer.show(q, () => (quest ? quests.goalOf(quest, pos).label : ''));
  else questLayer.clear();
  showQuest();
  showWisp();
}

// The wisp follows you while a reach quest has help (see quests.track); close to the spot it circles the area. No position, no quest, or done: none.
function showWisp() {
  const q = quest;
  questLayer.setWisp(pos && q?.kind === 'reach' && !q.done && q.help ? { me: pos, target: q, close: quests.stage(q, pos) === 3, seq: q.seq } : null);
}

// Call once Gemma has loaded: the quest already on screen gets its clues.
export const onWriterReady = () => { if (quest) writeClues(quest); };

// Starts the next quest once there is a position and a list of places to pick from. Does nothing while a quest (even a finished one) is on screen.
function ensureQuest() {
  if (!questKey || quest || !pos || !placeList.length) return;
  const day = today.dayKey(new Date()), legendOk = lastSeq >= 2 && quests.readLegendDay(questKey) !== day;   // one legend quest a day, never the very first quest: it stays special
  const q = quests.makeQuest(lastSeq + 1, placeList, found, pos, Math.random, Date.now(), legendOk) ?? quests.makeQuest(lastSeq + 2, placeList, found, pos);   // no reach target to be had (all places are right here): a find quest instead of none
  if (q?.kind === 'reach' && q.legend) q.clues = [questText.LEGEND_LINE];   // its first clue is fixed, so it is clear without Gemma
  if (q) { warned = false; setQuest(q); }
}

// A reach quest is only meaningful while its place exists. At start-up the saved quest comes back (a finished one, a reach quest whose place isn't in the list, or damaged data just means a fresh quest);
// after a region change, a reach quest whose place is not in the new list is dropped and the next quest is made from the new list.
const targetKnown = (q: quests.Quest) => q.kind === 'find' || placeList.some((p) => places.placeKey(p) === (q as quests.Reach).key);
function settleQuest() {
  if (!questKey) return;
  if (!quest) {
    const saved = quests.readQuest(questKey);
    if (!saved) return;
    lastSeq = saved.seq;
    if (!saved.done && targetKnown(saved)) { setQuest(saved); trackQuest(); }
  } else if (!quest.done && !targetKnown(quest)) setQuest(null);
}

// A reach quest follows you: the wisp comes out once you have tried (with a message), the last clue unlocks when you are close, you're told when you
// head the wrong way, and the pill's distance updates.
function trackQuest() {
  if (quest?.kind !== 'reach' || quest.done) return;
  const next = quests.track(quest, pos, Date.now());
  const wasClose = stageOf(quest) === 3;
  if (next !== quest) {
    if (next.help && !quest.help) { toast('A wisp appeared', 'Follow its light'); buzz(120); }
    if (next.revealed && !quest.revealed) toast('The quest spot is on the map', 'Follow the flag');
    setQuest(next);
    if (!wasClose && stageOf(next) === 3) buzz(150);                     // you are close now
  }
  if (pos) {
    const d = fog.dist(pos, next);
    if (!warned && quests.tooFar(next, d)) { warned = true; toast('Colder', 'Follow the light'); buzz(200); }
    else if (d <= next.start) warned = false;
  }
  if (quest && stageOf(quest) !== shownStage) { if (!wasClose && stageOf(quest) === 3) buzz(150); showQuest(); }   // a new clue: shown (and opened) at once
  else if (quest && quests.goalOf(quest, pos).label !== shownLabel) showQuest();   // the label is rounded to 10 m, so the pill changes only when it says something new
}

function refresh() {
  const fraction = area ? fogLayer.countIn(area) / area.size : 0;       // ponytail: counts all cleared cells (~1x/s); keep a running count if that shows in a profile
  hud.showStats({
    goal: dailyGoal(), found: found.size, total: placeList.length, groups: places.countsByGroup(placeList, found),
    percent: coverage.formatPercent(fraction), fraction, last,
    note: !placeList.length && failed ? 'No places loaded for this area yet' : '',
  });
}

// Finds places under cleared fog. A find is new (message, chime, today's count) when this device has not found that place before,
// whenever and wherever the fog under it was cleared: fog cleared while no places were loaded still counts once they arrive.
function check() {
  const fresh = places.discover(placeList, found, fogLayer.isRevealed);
  if (fresh.length) for (const id of today.readFound(foundKey)) everFound.add(id);   // what another tab found since
  const firstEver = everFound.size === 0;                               // nothing found on this device yet
  let changed = false;
  if (legacyFog) for (const p of fresh) if (fog.isRevealed(legacyFog, p.lat, p.lng) && !everFound.has(places.placeKey(p))) { everFound.add(places.placeKey(p)); changed = true; }
  const news = fresh.filter((p) => !everFound.has(places.placeKey(p)));            // decided once: the toast and the pulse always agree
  if (news.length || changed) { news.forEach((p) => everFound.add(places.placeKey(p))); today.writeFound(foundKey, everFound); }
  const loud = new Set(news);
  fresh.forEach((p) => placesLayer.addPlace(p, loud.has(p)));          // announced finds also get the gold pulse
  let questDone = false;
  if (quest) {                                                          // every find goes to the quest: a quiet one can still complete a reach quest
    const next = quests.progress(quest, fresh, news);
    if (next !== quest) {
      questDone = next.done; setQuest(next);
      if (questDone && next.kind === 'reach' && next.legend) quests.writeLegendDay(questKey, today.dayKey(new Date()));   // the day's legend is spent when it is found, not when it is offered
    }
  }
  if (news.length) {
    last = news[news.length - 1];
    const dailyWas = dailyGoal().done;
    countToday(news.map(places.placeKey));
    const detail = questDone ? 'Quest done' : !dailyWas && dailyGoal().done ? 'Today’s goal done' : hud.nudge(firstEver) || (news.length === 1 ? places.typeLabel(news[0].type) : '');   // the first find ever also points at the button
    toast(places.foundMessage(news), detail);
    hud.dismissHint();                                                  // a first find shows the hint was no longer needed
    sound.chime();                                                      // silent until the first tap, and when muted
    buzz(60);
  }
  if (badgeKey) {                                                       // after the find's own message: the badges' follow it, one at a time
    const day = today.dayKey(new Date());
    const got = badges.award(badgeState, everFound.size, day);
    let wait = news.length ? TOAST_MS + 200 : 0;                        // the find's message has had its time
    const announce = (detail: string) => { setTimeout(() => { toast('Badge earned', detail); sound.chime(); buzz(150); }, wait); wait += TOAST_MS + 200; };
    if (got.fresh.length) { badgeState = got.badges; announce(`Explorer · ${Math.max(...got.fresh)} places`); }
    for (const p of fresh) {                                            // having been at a famous place: the first of each kind is a badge
      const kind = places.legendOf(p);
      const r = kind && badges.awardFame(badgeState, kind, p.name, day);
      if (r?.fresh) { badgeState = r.badges; announce(`${badges.FAME_LABEL[kind!]} · ${p.name}`); }
    }
    if (badgeState !== got.badges || got.fresh.length) badges.write(badgeKey, badgeState);
  }
  if (badgeKey) showBadges();
  const finished = quest;
  if (questDone) setTimeout(() => { if (quest?.seq === finished?.seq) { setQuest(null); ensureQuest(); refresh(); } }, QUEST_NEXT_MS);   // the pill says "Done" for a moment, then the next quest starts
  refresh();
}

// Call when walking has just cleared new cells.
export const onCleared = check;

// Call with every accurate fix, before the fog is cleared.
export function onMove(fix: Fix) {
  const first = !pos;
  pos = fix;
  decide(fix);                                                          // a new region first, so what is shown is never from places you have left behind
  if (!quest) ensureQuest();
  else {
    trackQuest();
    showWisp();                                                         // it follows you: a step moves it
    if (first) { writeClues(quest); showQuest(); }                       // a quest restored before the first fix had no direction to speak of: word it now
  }
}

// The badge card was opened: what is earned has been looked at, so the dot goes.
export function badgesSeen() {
  badgeState = badges.seenAll(badgeState);
  badges.write(badgeKey, badgeState);
  showBadges();
}

// For the browser tests: the quest on screen right now (a copy).
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
  if (quest?.kind === 'reach' && !quest.done && pos && fog.dist(pos, quest) > AREA_RADIUS) setQuest(null);   // its place is out of reach now; a nearer one stays through the wait for the next region
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
  if (leaving) toast('New area', r.places.length ? `${r.places.length} places within 2 km` : 'No places within 2 km');   // before the check, so a find's message wins
  settleQuest();                                                        // before the check, so a quest's own place found in restored fog still counts
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
export function start(seed: string, api: string, regionStoreKey: string, todayStoreKey: string, foundStoreKey: string, questStoreKey: string | null, badgeStoreKey: string | null) {   // questStoreKey null: quests are off. Returns the centre of the region it opened with, if any
  seedUrl = seed; placesApi = api; regionKey = regionStoreKey; foundKey = foundStoreKey;
  todayKey = todayStoreKey;
  questKey = questStoreKey ?? '';
  badgeKey = badgeStoreKey ?? ''; badgeState = badgeKey ? badges.read(badgeKey) : badges.empty();
  if (badgeKey) showBadges();
  todayState = today.countToday(new Date(), [], today.readToday(todayKey));   // today's finds from earlier in the day, if the app was closed and reopened
  refresh();
  // An app left open overnight must start the new day: look again when it comes back to the foreground, and once a minute.
  const newDay = showGoal;                                             // only the goal: no need to recount the whole map for this
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') newDay(); });
  setInterval(() => { newDay(); trackQuest(); }, 60_000);              // the quest too: its spot is marked after a while, even if you stand still
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
