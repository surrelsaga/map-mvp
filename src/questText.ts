// A quest's clues: what Gemma is told, how its answers are checked, and the plain lines used when Gemma is off or fails a check.
// Code picks the quest and decides when it is done; Gemma only words it, as the fog speaking: short, playful, and about what the place IS like.
// Direction is never in the words (many people can't use "north-east"): the wisp on the map shows it. Pure, so Node can test it.
import { LINE_MAX } from './config.ts';
import type { LatLng } from './types.ts';

// A reach quest has three clues. `stage` 1 = the riddle, 2 = a sharper one once the wisp is out, 3 = you are close. `near` is the nearest place you have
// already found within reach of the target (stage 2 points from it). `hidden` is the target's name: Gemma hints at it, and an answer that gives it away is thrown out.
// A find quest has one line, with the kinds of place still hidden nearby so Gemma has something real to point at.
export type Stage = 1 | 2 | 3;
// `legend`: the target is a famous place (stage 2 and 3 say so). `words`: a trail's kind of place, in plain words ("shops"): all the finds must be of that kind.
export type Facts = { kind: 'reach'; what: string; hidden: string; stage: Stage; near: string | null; legend?: boolean } | { kind: 'find'; need: number; kinds: string[]; words?: string };   // a trail has no Gemma line: its plain line says exactly what counts

// The bearing from `a` to `b` in degrees clockwise from north (0..360). Flat-earth maths is plenty over a few hundred metres.
export function bearing(a: LatLng, b: LatLng) {
  const x = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180), y = b.lat - a.lat;
  return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}

const an = (w: string) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
const newPlaces = (n: number) => (n === 1 ? 'one new place' : `${n} new places`);

const ask = (f: Facts) => {
  if (f.kind === 'find') return `Uncover ${newPlaces(f.need)}.${f.kinds.length ? ` Still hidden nearby: ${f.kinds.join(', ')}.` : ''}`;
  const place = f.hidden ? `${f.hidden} (${f.what})` : `${an(f.what)}`;
  if (f.stage === 1) return `Hidden place: ${place}. Give the first riddle.`;
  if (f.stage === 2) return `Hidden place: ${place}.${f.legend ? ' It is famous around here.' : ''}${f.near ? ` It is not far from ${f.near}.` : ''} The player is stuck. Give a sharper clue.`;
  return `Hidden place: ${place}. The player is very close now. Say it is right around them, with one last small detail.`;
};

// Small models follow examples far better than rules, so the chat opens with two worked examples, each as a real turn.
// They are chosen by stage; none gives a name away or a direction.
const SHOTS: Record<'find' | Stage, [Facts, string][]> = {
  1: [[{ kind: 'reach', what: 'restaurant', hidden: 'Swee Choon Dim Sum', stage: 1, near: null }, 'Somewhere ahead, little baskets of dumplings are steaming all day.'],
    [{ kind: 'reach', what: 'library', hidden: 'Tampines Regional Library', stage: 1, near: null }, 'Hush. A building full of quiet stories is hiding nearby.']],
  2: [[{ kind: 'reach', what: 'restaurant', hidden: 'Swee Choon Dim Sum', stage: 2, near: 'Bedok Library' }, 'Past the library, follow the smell of steamed buns.'],
    [{ kind: 'reach', what: 'park', hidden: 'Bishan Park', stage: 2, near: null }, 'Look for green shade, ducks and long winding paths.']],
  3: [[{ kind: 'reach', what: 'restaurant', hidden: 'Swee Choon Dim Sum', stage: 3, near: null }, 'Almost there. Listen for clinking chopsticks.'],
    [{ kind: 'reach', what: 'park', hidden: 'Bishan Park', stage: 3, near: null }, 'Right around you now. Look for tall green shade.']],
  find: [[{ kind: 'find', need: 2, kinds: ['bakery', 'clinic'] }, 'Wander on and let the fog hand you a bakery or a clinic.'],
    [{ kind: 'find', need: 3, kinds: ['park', 'cafe'] }, 'Keep walking: a park and a cafe are waiting to be found.']],
};
const RULES = 'You are the fog in a walking game. Speak to the player (you) in one short, playful sentence of at most 12 words. '
  + 'Say what the hidden place is like, never its name. Do not give a direction, a distance or a number. Do not invent other places, people or stories.';
const examples = (f: Facts) => SHOTS[f.kind === 'find' ? 'find' : f.stage];
const EXAMPLES = Object.values(SHOTS).flat().map(([, a]) => a);

export function prompt(f: Facts) {
  const [a, b] = examples(f);
  return [
    { role: 'user', content: `${RULES}\n\n${ask(a[0])}` },
    { role: 'assistant', content: a[1] },
    { role: 'user', content: ask(b[0]) },
    { role: 'assistant', content: b[1] },
    { role: 'user', content: ask(f) },
  ];
}

// The plain line for a stage, when there is no Gemma text. Short, human, and the kind of place is all it fills in.
export function template(f: Facts) {
  if (f.kind === 'find') return f.words ? `A little trail: find ${f.need} ${f.words} near you.` : `Somewhere near, new places are waiting. Uncover ${newPlaces(f.need)}.`;
  return f.stage === 1 ? `${an(f.what).replace(/^a/, 'A')} is hiding in the fog nearby. Can you find it?` : f.stage === 2 ? 'Stuck? Follow the light.' : 'It’s right around you. Look up.';
}

// The words of a hidden place's name that would give it away: the distinctive ones ("Bedok Reservoir Park" → bedok, reservoir), not those
// its kind or where you are already say ("park", "changi" when you are at Changi City Point).
export const giveaways = (f: Facts & { kind: 'reach' }) => {
  const said = `${f.what} ${f.near ?? ''}`.toLowerCase();
  return f.hidden.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !said.includes(w));
};

// Gemma's answer, tidied into one line, or null when it can't be trusted: too short or long, a number we didn't give it, a compass direction (the wisp
// does that), the hidden place's name, a copy of an example, or written as the player ("I'm ready…"). A find line must be about finding.
export function clean(raw: string, f: Facts): string | null {
  let s = (raw.split('\n').map((l) => l.trim()).find(Boolean) ?? '')
    .replace(/\p{Extended_Pictographic}|[*_#`"“”]/gu, '').replace(/^(quest|clue|riddle|sentence)\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
  if (s.length > LINE_MAX) {                                             // keep whole sentences that fit, else give up
    const cut = s.slice(0, LINE_MAX), end = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
    s = end >= 20 ? cut.slice(0, end + 1) : '';
  }
  if (s.length < 12 || s.split(' ').length > 20 || EXAMPLES.includes(s)) return null;   // a copied example is no answer
  const given = f.kind === 'find' ? String(f.need) : '';
  if ((s.match(/\d+/g) ?? []).some((n) => n !== given && !(f.kind === 'reach' && f.near?.includes(n)))) return null;
  const low = s.toLowerCase();
  if (/\b(i|i'm|i’m|i'll|me|my|we|our|players?)\b|next:|hidden place/.test(low)) return null;
  if (/\b(north|south|east|west)\w*/.test(low)) return null;
  if (f.kind === 'reach' && giveaways(f).some((w) => low.includes(w))) return null;
  if (f.kind === 'find' && !/(uncover|discover|find|explore|reveal|track|search|seek|look for|new|hidden|hiding|waiting)/.test(low)) return null;
  return s;
}

// The first clue of a legend quest is fixed, so it is clear without Gemma (and Gemma writes the sharper ones after it).
export const LEGEND_LINE = 'A local legend is hiding nearby. Can you find it?';
