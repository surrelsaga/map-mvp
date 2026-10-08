// Part of `npm test`. Guards the palette: text must stay readable (WCAG contrast) if someone changes a colour in style.css.
/// <reference types="node" />
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const color = (name: string) => {
  const hex = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  assert(hex, `--${name} is defined in style.css`);
  return hex;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const atLeast = (fg: string, bg: string, min: number, what: string) => {
  const ratio = contrast(color(fg), color(bg));
  assert(ratio >= min, `${what}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
};

atLeast('daylight', 'panel', 7, 'main text on the panels (AAA)');
atLeast('dusk', 'panel', 4.5, 'secondary text on the panels (AA)');
atLeast('panel', 'first-light', 4.5, 'the dark icon on a gold pin (AA)');
atLeast('first-light', 'panel', 3, 'gold marks against the panels, such as the chip dot (non-text, AA)');
atLeast('first-light', 'fog', 3, 'gold pins and the glow against the fog (non-text, AA)');
atLeast('you', 'fog', 3, 'your dot against the fog (non-text, AA)');
atLeast('dusk', 'fog', 3, 'the dimmed (no GPS) dot against the fog (non-text, AA)');
const contrastWith = (name: string, hex: string) => contrast(color(name), hex);
const paleTile = '#f2efe9';                                                  // the colour of most OpenStreetMap tiles
assert(contrastWith('panel', paleTile) >= 3, 'the dimmed dot\'s dark outline against a pale map tile (non-text, AA)');
assert(contrastWith('panel', paleTile) >= 3 && contrast(color('daylight'), color('panel')) >= 3, 'the focus ring has a dark line (shows on pale tiles) and a light band (shows on dark panels)');

// gold means "discovered": it is only ever used for the chip dot, the pins, and the find ring
const goldUses = [...css.matchAll(/var\(--first-light\)|242, 179, 61/g)].length;
assert(goldUses <= 5, `gold is used sparingly (${goldUses} uses); it is the colour of discoveries only`);

// one source of truth: the stylesheet defines the palette, and the TypeScript reads it (src/theme.ts) instead of repeating the hex values
import { readdirSync } from 'node:fs';
const palette = [...css.matchAll(/--[a-z-]+:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
assert(palette.length >= 6, 'the palette is defined in style.css');
for (const file of readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.ts'))) {
  const code = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').toLowerCase();
  for (const hex of palette) assert(!code.includes(hex), `src/${file} repeats the palette colour ${hex}: read it from the stylesheet with theme.ts`);
}

console.log('ok');
