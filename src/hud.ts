// The progress chip, the stats card it opens, the sound switch, and the first-open hint. DOM only.
// Everything shown is set with textContent; the only markup built here is static (the pin icons).
import { GROUP_LABELS, discHtml } from './icons.ts';
import { typeLabel, type Group, type Place } from './places.ts';
import type { Goal } from './today.ts';

const $ = (id: string) => document.getElementById(id)!;
const GROUPS: Group[] = ['food', 'shop', 'outdoors', 'other'];

export interface Stats {
  goal: Goal;
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
  for (const ring of document.querySelectorAll('#top .ring')) setRing(ring, goal);
  $('goalText').textContent = goal.done ? 'All done. More finds are a bonus.' : `${goal.found} of ${goal.target} new places, ${goal.target - goal.found} to go`;
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
}

let hintOpen = false, onHintSeen = () => {};
// The first-open hint goes away for good once the user taps anywhere or finds a place.
export function dismissHint() {
  if (!hintOpen) return;
  hintOpen = false;
  $('hint').hidden = true;
  onHintSeen();
}

export function init({ soundOn, onSound, onFocus, hintSeen, onHintSeen: seen }: Controls) {
  const chip = $('chip'), panel = $('stats'), sw = $('soundSwitch');
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

  const isOpen = () => !panel.hidden;
  const toggle = (open: boolean) => { panel.hidden = !open; chip.setAttribute('aria-expanded', String(open)); };
  const showSound = (on: boolean) => { sw.setAttribute('aria-checked', String(on)); sw.querySelector('.state')!.textContent = on ? 'On' : 'Off'; };   // the name stays "Sound"; the state is read from aria-checked
  showSound(soundOn);
  chip.onclick = () => toggle(!isOpen());
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
