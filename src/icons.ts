// Simple line icons, one per kind of place, shared by the map pins and the stats card. Static markup only: names never go into HTML.
import type { Group } from './places.ts';

export const ICONS: Record<Group, string> = {
  food: '<path d="M6 3v5a3 3 0 0 0 6 0V3M9 11v10M17 21V3c-2 1.5-3 4-3 7s1 4 3 4"/>',
  shop: '<path d="M5 8h14l-1 12H6L5 8zM9 8a3 3 0 0 1 6 0"/>',
  outdoors: '<path d="M12 21v-6M12 3l6 8h-3l4 6H5l4-6H6l6-8z"/>',
  other: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3.1 9.5l6.1-.9z"/>',
};
export const GROUP_LABELS: Record<Group, string> = { food: 'Food & drink', shop: 'Shops', outdoors: 'Outdoors', other: 'Other' };

// The gold disc with its icon inside: the same on the map and in the card.
export const discHtml = (g: Group, px = 14) =>
  `<span class="place-disc"><svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[g]}</svg></span>`;
