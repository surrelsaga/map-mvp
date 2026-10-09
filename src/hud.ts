// The progress chip and the stats card it opens (sound and Gemma switches), the quest flag and its card, and the first-open hint. DOM only.
// Everything shown is set with textContent; the only markup built here is static (the pin icons).
import { GROUP_LABELS, discHtml } from './icons.ts';
import { typeLabel, type Group, type Place } from './places.ts';
import type { Goal } from './today.ts';

const $ = (id: string) => document.getElementById(id)!;
const GROUPS: Group[] = ['food', 'shop', 'outdoors', 'other'];

export interface Stats {
  goal: Goal;                                                           // today's goal, on the chip
  found: number; total: number;
  groups: Record<Group, { found: number; total: number }>;
  percent: string; fraction: number;                                    // how much of the neighbourhood is explored: "0.10%" and 0.001
  last: Place | null;
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

// The chip and the goal ring: all that a new day changes.
export function showGoal(goal: Goal) {
  $('chipText').textContent = goal.label;
  $('chip').setAttribute('aria-label', `${goal.label}, progress details`);   // contains the visible text, and stays the same open or closed
  for (const ring of document.querySelectorAll('#chip .ring, #stats .ring')) setRing(ring, goal);
  $('goalTitle').textContent = goal.title;
  $('goalText').textContent = goal.detail;
}

// The quest's flag (top right, with the quest's ring) and its card: the line (Gemma's, or the plain one) and how far along you are.
// null hides both. `reveal` shows the card, for a quest that has just started (unless you are reading the stats card).
export function showQuest(q: { goal: Goal; line: string; byGemma: boolean } | null, reveal = false) {
  $('questBtn').hidden = !q;
  if (!q) { if (!$('questCard').hidden) openCard(null); return; }
  $('questBtn').setAttribute('aria-label', `Quest: ${q.goal.label}, details`);
  setRing($('questBtn').querySelector('.ring')!, q.goal);
  $('questLine').textContent = q.line;
  $('questDetail').textContent = q.goal.detail;
  $('questBy').hidden = !q.byGemma;
  if (reveal && open !== 'stats') openCard('quest');
}

// The Gemma switch in the stats card. `note` says what it's doing ("800 MB download", "Downloading 40%"); not `usable`: this browser can't run it.
export function showGemma(on: boolean, note: string, usable = true) {
  const sw = $('gemmaSwitch') as HTMLButtonElement;
  sw.hidden = false; sw.disabled = !usable;
  sw.setAttribute('aria-checked', String(on));
  sw.querySelector('.state')!.textContent = on ? 'On' : 'Off';
  $('gemmaNote').textContent = note;
}

// At most one card is open: the stats card under the chip, or the quest card under the flag.
type Card = 'stats' | 'quest' | null;
let open: Card = null;
function openCard(which: Card) {
  open = which;
  $('stats').hidden = which !== 'stats'; $('chip').setAttribute('aria-expanded', String(which === 'stats'));
  $('questCard').hidden = which !== 'quest'; $('questBtn').setAttribute('aria-expanded', String(which === 'quest'));
}

export function showStats({ goal, found, total, groups, percent, fraction, last }: Stats) {
  showGoal(goal);
  $('statsPlaces').textContent = total ? `${found} of ${total} places found` : `${found} places found`;
  for (const g of GROUPS) {
    const li = document.querySelector(`#groups li[data-group="${g}"]`)!;
    li.querySelector('.g-count')!.textContent = `${groups[g].found} of ${groups[g].total}`;
    setBar(li.querySelector('.bar > span') as HTMLElement, groups[g].total ? groups[g].found / groups[g].total : 0, groups[g].found > 0);
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
  onGemma: (on: boolean) => void;                                       // the Gemma switch was flipped
}

let hintOpen = false, onHintSeen = () => {};
// The first-open hint goes away for good once the user taps anywhere or finds a place.
export function dismissHint() {
  if (!hintOpen) return;
  hintOpen = false;
  $('hint').hidden = true;
  onHintSeen();
}

export function init({ soundOn, onSound, onFocus, hintSeen, onHintSeen: seen, onGemma }: Controls) {
  const chip = $('chip'), flag = $('questBtn'), sw = $('soundSwitch');
  // the four kinds of place, each with the same gold disc and icon as its pins on the map
  $('groups').replaceChildren(...GROUPS.map((g) => {
    const li = document.createElement('li');
    li.dataset.group = g;
    li.innerHTML = `${discHtml(g, 13)}<span class="g-body"><span class="g-name"></span><span class="bar" aria-hidden="true"><span></span></span></span><span class="g-count"></span>`;
    li.querySelector('.g-name')!.textContent = GROUP_LABELS[g];
    return li;
  }));
  hintOpen = !hintSeen; onHintSeen = seen;
  $('hint').hidden = hintSeen;

  const showSound = (on: boolean) => { sw.setAttribute('aria-checked', String(on)); sw.querySelector('.state')!.textContent = on ? 'On' : 'Off'; };   // the name stays "Sound"; the state is read from aria-checked
  showSound(soundOn);
  chip.onclick = () => openCard(open === 'stats' ? null : 'stats');
  flag.onclick = () => openCard(open === 'quest' ? null : 'quest');
  sw.onclick = () => { const on = sw.getAttribute('aria-checked') !== 'true'; showSound(on); onSound(on); };
  $('gemmaSwitch').onclick = () => onGemma($('gemmaSwitch').getAttribute('aria-checked') !== 'true');
  $('lastFind').onclick = () => { openCard(null); chip.focus({ preventScroll: true }); if (lastPlace) onFocus(lastPlace); };   // the row is about to disappear: keep focus on the chip
  const cardOf = { stats: [$('stats'), chip], quest: [$('questCard'), flag] } as const;
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
