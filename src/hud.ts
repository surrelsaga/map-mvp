// The progress chip ("3 found") and the stats panel it opens, plus the sound switch inside it. DOM only.
const $ = (id: string) => document.getElementById(id)!;

export interface Stats { found: number; total: number; percent: string; last: string | null }

export function showStats({ found, total, percent, last }: Stats) {
  $('chipText').textContent = `${found} found`;
  $('chip').setAttribute('aria-label', `Progress: ${found} found`);   // the same name open or closed; contains the visible text
  $('statsPlaces').textContent = total ? `${found} of ${total} places found` : `${found} places found`;
  $('statsArea').textContent = `${percent} of the area`;
  $('statsLast').textContent = last ? `Last: ${last}` : '';
}

// Wires the chip (open/close the panel) and the sound switch. `onSound` is told the new state.
export function init(soundOn: boolean, onSound: (on: boolean) => void) {
  const chip = $('chip'), panel = $('stats'), sw = $('soundSwitch');
  const isOpen = () => !panel.hidden;
  const toggle = (open: boolean) => { panel.hidden = !open; chip.setAttribute('aria-expanded', String(open)); };
  const showSound = (on: boolean) => { sw.setAttribute('aria-checked', String(on)); sw.querySelector('.state')!.textContent = on ? '✓ on' : 'off'; };   // the name stays "Sound"; the state is read from aria-checked
  showSound(soundOn);
  chip.onclick = () => toggle(!isOpen());
  sw.onclick = () => { const on = sw.getAttribute('aria-checked') !== 'true'; showSound(on); onSound(on); };
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    const inside = panel.contains(document.activeElement);
    toggle(false);
    if (inside) chip.focus();                                           // focus was in the panel that just disappeared: put it somewhere sensible
  });
  document.addEventListener('pointerdown', (e) => {                    // a tap on the map closes it (the browser moves focus to whatever was tapped)
    if (isOpen() && !panel.contains(e.target as Node) && !chip.contains(e.target as Node)) toggle(false);
  });
}
