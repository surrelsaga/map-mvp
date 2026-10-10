// A quest's one line of text: what Gemma is told, how its answer is checked, and the plain line used when Gemma is off or its answer fails a check.
// Code picks the quest and decides when it is done; Gemma only words it. Pure, so Node can test it.
import { LINE_MAX } from './config.ts';
import type { LatLng } from './types.ts';

// here = the place you are at (just found, close by), if any. A reach quest gives the target's kind, direction and name (`hidden`): Gemma
// hints at it, and an answer that gives the name away is thrown out. A find quest gives the kinds of place still hidden nearby,
// so Gemma has something real to point at instead of inventing a shrine.
export type Facts = { here: string | null } & ({ kind: 'reach'; what: string; dir: string; hidden: string } | { kind: 'find'; need: number; kinds: string[] });

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
// The compass direction from `a` to `b`, one of eight. Flat-earth maths is plenty over a few hundred metres.
export function compass(a: LatLng, b: LatLng) {
  const x = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180), y = b.lat - a.lat;
  return DIRS[Math.round(((Math.atan2(x, y) * 180) / Math.PI + 360) / 45) % 8];
}

const an = (w: string) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
const newPlaces = (n: number) => (n === 1 ? 'one new place' : `${n} new places`);

const situation = (f: Facts) => {
  const next = f.kind === 'find' ? `uncover ${newPlaces(f.need)}${f.kinds.length ? `. Still hidden nearby: ${f.kinds.join(', ')}` : ''}`
    : f.hidden ? `walk ${f.dir} to a hidden place: ${f.hidden} (${f.what}). Hint at it without saying its name` : `walk ${f.dir} to ${an(f.what)} hidden in the fog`;
  return `${f.here ? `The player just reached ${f.here}.` : 'The player is out for a walk.'} Next: ${next}.`;
};

// Small models follow examples far better than rules, so the chat opens with two worked examples, each as a real turn
// (in one message the model just continues the pattern: "The player is out for a walk. Next: …").
const EXAMPLES = ['Head west and sniff out the spot where little baskets of dumplings steam all day.', 'Leave the park and wander new streets until the fog gives up a bakery or a clinic.'];
export function prompt(f: Facts) {
  return [
    { role: 'user', content: 'Fog hides the map in a walking game until the player walks there. Write the next quest as one sentence of under 20 words, '
      + 'telling the player (you) what to do outdoors. Keep the direction. Give a hidden place a playful hint about what it is, never its name. Do not invent other places, people or stories.'
      + '\n\nThe player just reached Bedok Library. Next: walk west to a hidden place: Swee Choon Dim Sum (restaurant). Hint at it without saying its name.' },
    { role: 'assistant', content: EXAMPLES[0] },
    { role: 'user', content: 'The player just reached Tampines Park. Next: uncover 2 new places. Still hidden nearby: bakery, clinic.' },
    { role: 'assistant', content: EXAMPLES[1] },
    { role: 'user', content: situation(f) },
  ];
}

// The line when there is no Gemma text.
export function template(f: Facts) {
  const from = f.here ? `From ${f.here}, ` : '';
  const line = f.kind === 'reach' ? `head ${f.dir} to ${an(f.what)} spot hidden in the fog.` : `wander somewhere new and uncover ${newPlaces(f.need)}.`;
  return from + (from ? line : line.charAt(0).toUpperCase() + line.slice(1));
}

// The words of a hidden place's name that would give it away: the distinctive ones ("Bedok Reservoir Park" → bedok, reservoir), not those
// its kind, the direction or where you are already say ("park", "east", "changi" when you are at Changi City Point).
export const giveaways = (f: Facts & { kind: 'reach' }) => {
  const said = `${f.what} ${f.here ?? ''} north south east west`.toLowerCase();
  return f.hidden.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !said.includes(w));
};

// Gemma's answer, tidied into one line, or null when it can't be trusted: too short or long, a number we didn't give it
// (the real distance is shown next to it), the hidden place's name, a copy of an example, written as the player ("I'm ready…"), or off the task
// (a reach line must keep its direction, a find line must be about finding).
export function clean(raw: string, f: Facts): string | null {
  let s = (raw.split('\n').map((l) => l.trim()).find(Boolean) ?? '')
    .replace(/\p{Extended_Pictographic}|[*_#`"“”]/gu, '').replace(/^(quest|sentence)\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
  if (s.length > LINE_MAX) {                                             // keep whole sentences that fit, else give up
    const cut = s.slice(0, LINE_MAX), end = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
    s = end >= 20 ? cut.slice(0, end + 1) : '';
  }
  if (s.length < 12 || EXAMPLES.includes(s)) return null;                 // a copied example is no answer
  const given = f.kind === 'find' ? String(f.need) : '';
  if ((s.match(/\d+/g) ?? []).some((n) => n !== given && !f.here?.includes(n))) return null;
  const low = s.toLowerCase();
  if (/\b(i|i'm|i’m|i'll|me|my|we|our|players?)\b|next:/.test(low)) return null;
  if (f.kind === 'reach' && (!new RegExp(`(^|[^-\\w])${f.dir.replace('-', '[- ]?')}(wards?)?($|[^-\\w])`).test(low) || giveaways(f).some((w) => low.includes(w)))) return null;
  if (f.kind === 'find' && !/(uncover|discover|find|explore|reveal|track|search|seek|look for|new|hidden|hiding)/.test(low)) return null;
  return s;
}
