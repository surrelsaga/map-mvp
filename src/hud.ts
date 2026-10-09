// The "Today" button, the panel it opens (today's goal, what is found, and the settings), and the first-open bubble. DOM only.
// Everything shown is set with textContent; the only markup built here is static (the pin icons).
import { GROUP_LABELS, discHtml } from './icons.ts';
import { typeLabel, type Group, type Place } from './places.ts';
import type { Goal } from './today.ts';

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
  for (const ring of document.querySelectorAll('#top .ring')) setRing(ring, goal);
  $('goalText').textContent = goal.detail;
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
}

let hintOpen = false, onHintSeen = () => {};
let opened = false, onOpened = () => {};
// What the first find ever adds to its message: a pointer to the button, for someone who has not opened it yet. Empty otherwise.
export const nudge = (firstEver: boolean) => (firstEver && !opened ? 'Tap Today to see your progress' : '');
// The first-open bubble goes away for good once the user taps anywhere or finds a place.
export function dismissHint() {
  if (!hintOpen) return;
  hintOpen = false;
  $('hint').hidden = true;
  onHintSeen();
}

export function init({ soundOn, onSound, onFocus, hintSeen, onHintSeen: seen, openedSeen, onOpened: markOpened }: Controls) {
  const chip = $('chip'), panel = $('stats'), sw = $('soundSwitch');
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

  const isOpen = () => !panel.hidden;
  const toggle = (open: boolean) => {
    panel.hidden = !open; chip.setAttribute('aria-expanded', String(open));
    if (open && !opened) { opened = true; onOpened(); }
  };
  const showSound = (on: boolean) => { sw.setAttribute('aria-checked', String(on)); sw.querySelector('.state')!.textContent = on ? 'On' : 'Off'; };   // the name stays "Sound"; the state is read from aria-checked
  showSound(soundOn);
  chip.onclick = () => toggle(!isOpen());
  $('closeStats').onclick = () => { toggle(false); chip.focus({ preventScroll: true }); };
  sw.onclick = () => { const on = sw.getAttribute('aria-checked') !== 'true'; showSound(on); onSound(on); };
  $('lastFind').onclick = () => { toggle(false); chip.focus({ preventScroll: true }); if (lastPlace) onFocus(lastPlace); };   // the row is about to disappear: keep focus on the chip
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    const inside = panel.contains(document.activeElement);
    toggle(false);
    if (inside) chip.focus();                                           // focus was in the panel that just disappeared: put it somewhere sensible
  });
  document.addEventListener('pointerdown', (e) => {                    // any tap dismisses the hint; a tap on the map also closes the card (the browser moves focus to whatever was tapped)
    dismissHint();
    if (isOpen() && !panel.contains(e.target as Node) && !chip.contains(e.target as Node)) toggle(false);
  });
}
