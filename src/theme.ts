// Colours live in the CSS custom properties in style.css; canvas and Leaflet code read them from there, so a palette change is made in one place
// (and tests/design.test.ts, which checks those same properties, guards what is actually drawn).
// If the stylesheet is missing, a neutral grey is used so nothing breaks, and the console says so (once per colour).
const FALLBACK = '#808080';
const warned = new Set<string>();

export function color(name: string): string {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  if (!warned.has(name)) { warned.add(name); console.warn(`${name} is missing from the stylesheet: using grey`); }
  return FALLBACK;
}

// "#336699" -> "51, 102, 153", ready for rgba(...).
export const rgb = (name: string): string => [1, 3, 5].map((i) => parseInt(color(name).slice(i, i + 2), 16)).join(', ');
