// The "Today" button, the panel it opens (today's goal, what is found, and the settings), the quest pill and its card, and the first-open bubble. DOM only.
// Everything shown is set with textContent; the only markup built here is static (the pin icons).
import { GROUP_LABELS, ICONS, discHtml } from './icons.ts';
import { typeLabel, type Group, type Place } from './places.ts';
import type { Goal } from './today.ts';
import { BADGE_LEVELS } from './config.ts';

const $ = (id: string) => document.getElementById(id)!;
const GROUPS: Group[] = ['food', 'shop', 'outdoors', 'other'];

export interface Stats {
  goal: Goal;                                                           // today's goal: the button's ring and the panel's first line
  found: number; total: number;
  groups: Record<Group, { found: number; total: number }>;
  percent: string; fraction: number;                                    // how much of the neighbourhood is explored: "0.10%" and 0.001
  last: Place | null;
  note: string;                                                         // why there are no places ("No places loaded for this area yet"); empty when all is well
}

// A bar that is never invisible once there is something to show (a stub), with the exact number always written beside it.
const stub = (part: number, any: boolean) => (any ? Math.max(0.05, Math.min(1, part)) : 0);
const setBar = (el: HTMLElement, part: number, any: boolean) => { el.style.transform = `scaleX(${stub(part, any)})`; };

// The arc is a circle of length 1 (pathLength in the markup), so progress 0..1 is simply the dash offset 1..0.
function setRing(svg: Element, goal: Goal) {
  const arc = svg.querySelector('.ring-arc') as SVGElement;
  arc.style.strokeDashoffset = String(1 - goal.progress);
  arc.style.opacity = goal.progress > 0 ? '1' : '0';                  // a round-capped arc of length 0 would still leave a speck
  svg.classList.toggle('done', goal.done);
}

let lastPlace: Place | null = null;

// The button and the goal ring: all that a new day changes. The button always says "Today"; its spoken name carries the numbers.
export function showGoal(goal: Goal) {
  $('chip').setAttribute('aria-label', `${goal.done ? 'Today’s goal done' : `Today: ${goal.found} of ${goal.target} places`}. Progress and settings`);
  for (const ring of document.querySelectorAll('#chip .ring, #stats .ring')) setRing(ring, goal);
  $('goalText').textContent = goal.detail;
}

// The quest pill (top right, with the quest's own ring) and its card: the line (Gemma's, or the plain one), then the detail.
// `short` is what the pill says (a distance, "1/2", "Done"). null hides both. `reveal` opens the card, for a quest that has just started: not over another card,
// and not while the first-open bubble is up (the pill shows; the card opens on a tap).
export interface QuestView { goal: Goal; short: string; line: string; detail: string; byGemma: boolean; legend: boolean }
export function showQuest(q: QuestView | null, reveal = false) {
  $('questBtn').hidden = !q;
  if (!q) { if (open === 'quest') openCard(null); return; }
  $('questBtn').setAttribute('aria-label', `Quest: ${q.goal.label}. Details`);
  setRing($('questBtn').querySelector('.ring')!, q.goal);
  $('questDist').textContent = q.short;
  $('questBtn').toggleAttribute('data-legend', q.legend);                // a small star: a famous place
  $('questLine').textContent = q.line;
  $('questDetail').textContent = q.detail;
  $('questBy').hidden = !q.byGemma;
  basicLine = !q.byGemma && !q.goal.done; syncBasic();                  // plain line: say so, when there is something better to turn on
  $('questCard').dataset.done = String(q.goal.done);                    // a celebrating card has no Gemma offer (CSS)
  if (reveal && (open === null || open === 'quest') && !hintOpen) openCard('quest');   // never over another card someone is reading
}

// The Gemma switch in the panel, and the one-tap offer in the quest card. `note` says what it's doing ("800 MB download", "Downloading 40%"); not `usable`: this browser can't run it.
export function showGemma(on: boolean, note: string, usable = true) {
  const sw = $('gemmaSwitch') as HTMLButtonElement;
  sw.hidden = false; sw.disabled = !usable;
  sw.setAttribute('aria-checked', String(on));
  sw.querySelector('.state')!.textContent = on ? 'On' : 'Off';
  $('gemmaNote').textContent = note;
  $('questGemma').hidden = on || !usable;                              // the card offers it only while it is off and possible
  const pct = /(\d+)%/.exec(note);
  $('questGemmaStatus').hidden = !(on && /^(Downloading|Loading)/.test(note));   // while it loads, the card says so (it is the thing the player pressed)
  $('questGemmaStatus').textContent = pct ? `Gemma is getting ready · ${pct[1]}%` : 'Gemma is getting ready…';
  syncBasic();
}

let basicLine = false;                                                  // the quest card is showing a plain line (not Gemma's, not a finished quest)
const syncBasic = () => { $('questBasic').hidden = !basicLine || $('questGemma').hidden; };   // "Basic hint" only where Gemma could be turned on

// The badge button (bottom left) and its card: Explorer with a disc per level (gold and dated once earned, "7 of 10" while it is next), then Local legend and
// Landmark: one each, earned at a famous place (its name and the day).
// `hasNew`: a level earned that has not been looked at yet (a dot on the button).
export interface BadgeView { count: number; earned: Record<string, string>; fame: Partial<Record<'legend' | 'landmark', { name: string; day: string }>>; hasNew: boolean }
const niceDay = (d: string) => { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
export function showBadges({ count, earned, fame, hasNew }: BadgeView) {
  const have = BADGE_LEVELS.filter((l) => String(l) in earned).length + Object.keys(fame).length, all = BADGE_LEVELS.length + 2;
  $('medal').hidden = false;                                            // only called when badges are on (not with ?quests=off)
  $('medal').toggleAttribute('data-new', hasNew);
  $('medal').setAttribute('aria-label', `Badges: ${have} of ${all}${hasNew ? ', new' : ''}`);
  const row = (disc: Node | string, name: string, note: string, got: boolean) => {
    const li = document.createElement('li'), d = document.createElement('span'), body = document.createElement('span');
    const n = document.createElement('span'), m = document.createElement('span');
    li.className = got ? 'got' : '';
    d.className = 'badge-disc'; typeof disc === 'string' ? (d.textContent = disc) : d.append(disc);
    n.className = 'badge-name'; n.textContent = name;
    m.className = 'badge-note'; m.textContent = note;
    body.className = 'badge-body'; body.append(n, m);
    li.append(d, body);
    return li;
  };
  const icon = (g: Group) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '22'); s.setAttribute('height', '22');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2.2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[g]; return s; };   // static markup from icons.ts: never a name
  let nextShown = false;
  const levels = BADGE_LEVELS.map((l) => {
    const got = earned[String(l)];
    const note = got ? `Earned ${niceDay(got)}` : !nextShown ? `${Math.min(count, l)} of ${l}` : 'Locked';
    if (!got) nextShown = true;
    return row(String(l), `Explorer ${l}`, note, !!got);
  });
  const legend = fame.legend, landmark = fame.landmark;
  $('badgeLevels').replaceChildren(...levels,
    row(icon('food'), 'Local legend', legend ? `${legend.name} · ${niceDay(legend.day)}` : 'Be at a famous place to eat', !!legend),
    row(icon('outdoors'), 'Landmark', landmark ? `${landmark.name} · ${niceDay(landmark.day)}` : 'Be at a famous landmark', !!landmark));
}

// At most one card is open: the panel under the button, the quest card under the pill, or the badges.
type Card = 'stats' | 'quest' | 'badges' | null;
let open: Card = null;
function openCard(which: Card) {
  open = which;
  $('stats').hidden = which !== 'stats'; $('chip').setAttribute('aria-expanded', String(which === 'stats'));
  $('questCard').hidden = which !== 'quest'; $('questBtn').setAttribute('aria-expanded', String(which === 'quest'));
  $('badgeCard').hidden = which !== 'badges'; $('medal').setAttribute('aria-expanded', String(which === 'badges'));
  if (which === 'badges') onBadges();
  if (which === 'stats' && !opened) { opened = true; onOpened(); }
}

export function showStats({ goal, found, total, groups, percent, fraction, last, note }: Stats) {
  showGoal(goal);
  $('statsPlaces').textContent = note || (total ? `${found} of ${total} places found` : `${found} places found`);
  $('emptyHint').hidden = found > 0 || !!note;                          // nothing found yet: say what to do, instead of rows of zeros
  $('progress').hidden = found === 0;
  for (const g of GROUPS) {
    const li = document.querySelector(`#groups li[data-group="${g}"]`)!;
    li.querySelector('.g-count')!.textContent = `${groups[g].found} of ${groups[g].total}`;
  }
  $('statsArea').textContent = `${percent} of the neighbourhood`;
  setBar($('areaBar'), fraction, fraction > 0);
  lastPlace = last;
  $('lastFind').hidden = !last;
  $('statsLast').textContent = last ? `Last: ${last.name}` : '';
  $('lastType').textContent = last ? typeLabel(last.type) : '';
}

export interface Controls {
  soundOn: boolean; onSound: (on: boolean) => void;
  onFocus: (place: Place) => void;                                      // "Last: ..." was tapped: show that place on the map
  hintSeen: boolean; onHintSeen: () => void;
  openedSeen: boolean; onOpened: () => void;                            // the panel has been opened at least once
  onGemma: (on: boolean) => void;                                       // the Gemma switch (or the card's offer) was used
  onBadges: () => void;                                                 // the badge card was opened: what is earned has been looked at
}

let hintOpen = false, onHintSeen = () => {};
let opened = false, onOpened = () => {}, onBadges = () => {};
// What the first find ever adds to its message: a pointer to the button, for someone who has not opened it yet. Empty otherwise.
export const nudge = (firstEver: boolean) => (firstEver && !opened ? 'Tap Today to see your progress' : '');
// The first-open bubble goes away for good once the user taps anywhere or finds a place.
export function dismissHint() {
  if (!hintOpen) return;
  hintOpen = false;
  $('hint').hidden = true;
  onHintSeen();
}

export function init({ soundOn, onSound, onFocus, hintSeen, onHintSeen: seen, openedSeen, onOpened: markOpened, onGemma, onBadges: badgesLooked }: Controls) {
  const chip = $('chip'), flag = $('questBtn'), sw = $('soundSwitch'), medal = $('medal');
  onBadges = badgesLooked;
  // the four kinds of place, each with the same gold disc and icon as its pins on the map
  $('groups').replaceChildren(...GROUPS.map((g) => {
    const li = document.createElement('li');
    li.dataset.group = g;
    li.innerHTML = `${discHtml(g, 13)}<span class="g-body"><span class="g-name"></span><span class="g-count"></span></span>`;
    li.querySelector('.g-name')!.textContent = GROUP_LABELS[g];
    return li;
  }));
  hintOpen = !hintSeen; onHintSeen = seen;
  $('hint').hidden = hintSeen;
  opened = openedSeen; onOpened = markOpened;

  const showSound = (on: boolean) => { sw.setAttribute('aria-checked', String(on)); sw.querySelector('.state')!.textContent = on ? 'On' : 'Off'; };   // the name stays "Sound"; the state is read from aria-checked
  showSound(soundOn);
  chip.onclick = () => openCard(open === 'stats' ? null : 'stats');
  flag.onclick = () => openCard(open === 'quest' ? null : 'quest');
  medal.onclick = () => openCard(open === 'badges' ? null : 'badges');
  $('closeStats').onclick = () => { openCard(null); chip.focus({ preventScroll: true }); };
  sw.onclick = () => { const on = sw.getAttribute('aria-checked') !== 'true'; showSound(on); onSound(on); };
  $('gemmaSwitch').onclick = () => onGemma($('gemmaSwitch').getAttribute('aria-checked') !== 'true');
  $('questGemma').onclick = () => onGemma(true);
  $('lastFind').onclick = () => { openCard(null); chip.focus({ preventScroll: true }); if (lastPlace) onFocus(lastPlace); };   // the row is about to disappear: keep focus on the chip
  const cardOf = { stats: [$('stats'), chip], quest: [$('questCard'), flag], badges: [$('badgeCard'), medal] } as const;
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    const [card, button] = cardOf[open];
    const inside = card.contains(document.activeElement);
    openCard(null);
    if (inside) button.focus();                                         // focus was in the card that just disappeared: put it somewhere sensible
  });
  document.addEventListener('pointerdown', (e) => {                    // any tap dismisses the hint; a tap on the map also closes the card (the browser moves focus to whatever was tapped)
    dismissHint();
    if (open && !cardOf[open].some((el) => el.contains(e.target as Node))) openCard(null);
  });
}
