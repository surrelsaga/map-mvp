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
import { SUTD, AREA_RADIUS, PLACES_RETRY_MS, QUEST_NEXT_MS } from './config.ts';
import type { Fix } from './types.ts';

let placeList: places.Place[] = [];
const found = new Set<number>();
let last: places.Place | null = null;               // the most recent find this session (not remembered across reloads)
let area: fog.Cells | null = null;                   // the 2 km circle as cells; built just after first paint (it takes tens of ms)
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
  if (!quest) ensureQuest();
  else if (quest.kind === 'reach' && !quest.done && quests.goalOf(quest, pos).label !== shownLabel) showGoal();   // the label is rounded to 10 m, so the chip changes only when it says something new
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
  setInterval(newDay, 60_000);
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
