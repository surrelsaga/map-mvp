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
import { toast } from './ui.ts';
import { SUTD, AREA_RADIUS, PLACES_RETRY_MS, QUEST_NEXT_MS, HERE_M, GEMMA_TRIES } from './config.ts';
import type { Fix } from './types.ts';

let placeList: places.Place[] = [];
const found = new Set<number>();
let last: places.Place | null = null;               // the most recent find this session (not remembered across reloads)
let area: fog.Cells | null = null;                   // the 2 km circle as cells; built just after first paint (it takes tens of ms)
let todayKey = '', todayState: today.Today = { date: '', ids: [] };
let quest: quests.Quest | null = null;              // the active quest (a finished one stays here for QUEST_NEXT_MS, so its card can say "Quest done")
let questKey = '', lastSeq = -1;                    // where it is saved ('' = quests are off), and the number of the latest quest (the next one is lastSeq + 1)
let pos: Fix | null = null;                          // where you are, from the latest accurate fix (a reach quest measures from here)
let shownLabel = '', shownSeq = -1;                  // what the quest flag says now, and which quest it shows (a new one opens its card)
let writing = -1;                                    // the quest Gemma is writing a line for (-1: none)
let warned = false;                                  // the "heading away" alert has been given (again once you come back within the start distance)

// The places found today, on the phone's local date: what this tab remembers plus whatever is stored (another tab may have counted too).
// Counting which places, not how many, means the same place never counts twice, however many tabs find it. Asking also rolls over at midnight.
const countToday = (add: string[] = []) => {
  const next = today.countToday(new Date(), add, todayState, today.readToday(todayKey));
  if (next.date !== todayState.date || next.ids.length !== todayState.ids.length) today.writeToday(todayKey, next);
  return (todayState = next);
};
const dailyGoal = () => today.goalOf(countToday().ids.length);
const showGoal = () => hud.showGoal(dailyGoal());                    // the chip is always today's goal; the quest has its own flag

// What Gemma (or the plain line) is told about a quest. Where you are counts only if you just found a place right here.
function factsFor(q: quests.Quest): questText.Facts {
  const here = last && pos && fog.dist(pos, last) <= HERE_M ? last.name : null;
  if (q.kind === 'find') {
    const open = placeList.filter((_, i) => !found.has(i)).map((p) => ({ p, d: pos ? fog.dist(pos, p) : 0 })).sort((a, b) => a.d - b.d);
    return { here, kind: 'find', need: q.need, kinds: [...new Set(open.slice(0, 12).map(({ p }) => places.typeLabel(p.type).toLowerCase()))].slice(0, 3) };   // the kinds of place nearest you, so Gemma has something real to name
  }
  const target = placeList.find((p) => places.placeKey(p) === q.key);
  return { here, kind: 'reach', what: places.typeLabel(target?.type ?? 'place').toLowerCase(), dir: questText.compass(pos ?? q, q), hidden: target?.name ?? '' };
}

function showQuest() {
  if (!quest) { shownSeq = -1; hud.showQuest(null); return; }
  const goal = quests.goalOf(quest, pos);
  shownLabel = goal.label;
  hud.showQuest({ goal, line: quest.text ?? questText.template(factsFor(quest)), byGemma: !!quest.text }, quest.seq !== shownSeq);
  shownSeq = quest.seq;
}

// Asks Gemma for the quest's line, if it is loaded and the quest has none yet. Until it answers (or if GEMMA_TRIES answers all fail the checks) the plain line shows.
function writeLine(q: quests.Quest) {
  if (q.text || q.done || writing === q.seq) return;
  writing = q.seq;
  const f = factsFor(q);
  (async () => {
    for (let i = 0; i < GEMMA_TRIES && quest?.seq === q.seq; i++) {
      const raw = await gemma.write(questText.prompt(f));
      if (raw === null) return;                                         // not loaded (yet): onWriterReady asks again
      const text = questText.clean(raw, f);
      if (text) { if (quest?.seq === q.seq && !quest.text) setQuest({ ...quest, text }); return; }
      console.debug('Gemma line rejected:', raw);                       // to tune the checks (questText.clean) against real answers
    }
  })().catch((e) => console.warn('Gemma could not write the quest:', e)).finally(() => { if (writing === q.seq) writing = -1; });
}

// The active quest changed: save it, mark its spot on the map (a reach quest that isn't done, once revealed), show its flag, and get Gemma writing its line.
function setQuest(q: quests.Quest | null) {
  quest = q;
  if (q) { lastSeq = q.seq; quests.writeQuest(questKey, q); writeLine(q); }
  if (q?.kind === 'reach' && !q.done && q.revealed) questLayer.show(q, () => (quest ? quests.goalOf(quest, pos).label : ''));
  else questLayer.clear();
  showQuest();
}

// Call once Gemma has loaded: the quest already on screen gets its line.
export const onWriterReady = () => { if (quest) writeLine(quest); };

// Starts the next quest once there is a position and a list of places to pick from. Does nothing while a quest (even a finished one) is on screen.
function ensureQuest() {
  if (!questKey || quest || !pos || !placeList.length) return;
  const q = quests.makeQuest(lastSeq + 1, placeList, found, pos) ?? quests.makeQuest(lastSeq + 2, placeList, found, pos);   // no reach target to be had (all places are right here): a find quest instead of none
  if (q) { warned = false; setQuest(q); }
}

// Brings the saved quest back. A finished one, a reach quest whose place is gone from the file, or damaged data just means a fresh quest.
function restoreQuest() {
  if (!questKey) return;
  const saved = quests.readQuest(questKey);
  if (!saved) return;
  lastSeq = saved.seq;
  if (!saved.done && (saved.kind === 'find' || placeList.some((p) => places.placeKey(p) === saved.key))) { setQuest(saved); trackQuest(); }
}

const buzz = (ms: number) => { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(ms); };   // browsers ignore (and warn about) vibration before the first tap; iPhones have none

// A reach quest follows you: its spot is marked once you need help (with a message), you're told when you head the wrong way, and the flag's distance updates.
function trackQuest() {
  if (quest?.kind !== 'reach' || quest.done) return;
  const next = quests.track(quest, pos, Date.now());
  if (next !== quest) {
    if (next.revealed && !quest.revealed) toast('The quest spot is on the map', 'Follow the flag');
    setQuest(next);
  }
  if (pos) {
    const d = fog.dist(pos, next);
    if (!warned && quests.tooFar(next, d)) { warned = true; toast('You’re heading away from the quest', `It’s about ${quests.label(d)} ${questText.compass(pos, next)}`); buzz(200); }
    else if (d <= next.start) warned = false;
  }
  if (quest && quests.goalOf(quest, pos).label !== shownLabel) showQuest();   // the label is rounded to 10 m, so the flag changes only when it says something new
}

function refresh() {
  const fraction = area ? fogLayer.countIn(area) / area.size : 0;       // ponytail: counts all cleared cells (~1x/s); keep a running count if that shows in a profile
  hud.showStats({
    goal: dailyGoal(), found: found.size, total: placeList.length, groups: places.countsByGroup(placeList, found),
    percent: coverage.formatPercent(fraction), fraction, last,
  });
}

// Finds places under newly cleared fog. `announce` picks which finds get a toast (all of them by default).
function check(announce: (p: places.Place) => boolean = () => true) {
  const fresh = places.discover(placeList, found, fogLayer.isRevealed);
  const news = fresh.filter(announce);                                  // decided once: the toast and the pulse always agree
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
    buzz(60);
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
  if (!quest) ensureQuest();
  else trackQuest();
}

// For the browser tests: the quest on the chip right now (a copy).
export const activeQuest = () => quest && { ...quest };

// A network or server error is retried a couple of times (phones walk through bad signal); a missing file (4xx) is final.
async function loadFile(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      if (r.status < 500) throw Object.assign(new Error(String(r.status)), { final: true });
      throw new Error(String(r.status));
    } catch (e) {
      if ((e as { final?: boolean }).final || attempt >= PLACES_RETRY_MS.length) throw e;
      await new Promise((resolve) => setTimeout(resolve, PLACES_RETRY_MS[attempt]));
    }
  }
}

// Loads the places file. No file just means nothing to discover.
// Places already inside fog restored from an earlier session show up quietly; anything cleared since this page opened is announced,
// even if the file arrives late.
export function start(url: string, todayStoreKey: string, questStoreKey: string | null) {   // null: quests are off
  todayKey = todayStoreKey;
  questKey = questStoreKey ?? '';
  todayState = today.countToday(new Date(), [], today.readToday(todayKey));   // today's finds from earlier in the day, if the app was closed and reopened
  refresh();
  // An app left open overnight must start the new day: look again when it comes back to the foreground, and once a minute.
  const newDay = showGoal;                                             // only the goal: no need to recount the whole map for this
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') newDay(); });
  setInterval(() => { newDay(); trackQuest(); }, 60_000);              // the quest too: its spot is marked after a while, even if you stand still
  const before = new Set(fogLayer.snapshot());
  setTimeout(() => { area = coverage.circleCells({ lat: SUTD[0], lng: SUTD[1] }, AREA_RADIUS); refresh(); }, 0);
  loadFile(url).then(
    (raw) => {
      placeList = places.parsePlaces(raw);
      restoreQuest();                                                   // before the check, so a quest's own place found in restored fog still counts
      check((p) => !fog.isRevealed(before, p.lat, p.lng));
      ensureQuest();
    },
    (e) => console.warn('No places to discover:', e),   // only the loading is caught here, so a bug in the handler above stays visible
  );
}
