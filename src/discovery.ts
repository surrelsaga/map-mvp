// The neighbourhood game state: which places exist, which are found, and how much of the area is explored.
// Owns the stats readout and the "Found" toast; main.ts only tells it when to start and when new cells were cleared.
import * as fogLayer from './fogLayer.ts';
import * as places from './places.ts';
import * as placesLayer from './placesLayer.ts';
import * as coverage from './coverage.ts';
import * as hud from './hud.ts';
import * as fog from './fog.ts';
import { toast } from './ui.ts';
import { SUTD, AREA_RADIUS, PLACES_RETRY_MS } from './config.ts';

let placeList: places.Place[] = [];
const found = new Set<number>();
let area: fog.Cells | null = null;                   // the 2 km circle as cells; built just after first paint (it takes tens of ms)

function refresh() {
  if (!area) return;
  hud.showStats(coverage.formatPercent(fogLayer.countIn(area) / area.size), found.size, placeList.length);   // ponytail: counts all cleared cells (~1x/s); keep a running count if that shows in a profile
}

// Finds places under newly cleared fog. `announce` picks which finds get a toast (all of them by default).
function check(announce: (p: places.Place) => boolean = () => true) {
  const fresh = places.discover(placeList, found, fogLayer.isRevealed);
  fresh.forEach(placesLayer.addPlace);
  const news = fresh.filter(announce);
  if (news.length) {
    toast(places.foundMessage(news));
    if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(60);   // browsers ignore (and warn about) vibration before the first tap; iPhones have none
  }
  refresh();
}

// Call when walking has just cleared new cells.
export const onCleared = check;

// A network or server error is retried a couple of times (phones walk through bad signal); a missing file (4xx) is final.
async function loadFile(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      if (r.status < 500) throw Object.assign(new Error(String(r.status)), { final: true });
      throw new Error(String(r.status));
    } catch (e) {
      if ((e as { final?: boolean }).final || attempt >= PLACES_RETRY_MS.length) throw e;
      await new Promise((resolve) => setTimeout(resolve, PLACES_RETRY_MS[attempt]));
    }
  }
}

// Loads the places file. No file just means nothing to discover.
// Places already inside fog restored from an earlier session show up quietly; anything cleared since this page opened is announced,
// even if the file arrives late.
export function start(url: string) {
  const before = new Set(fogLayer.snapshot());
  setTimeout(() => { area = coverage.circleCells({ lat: SUTD[0], lng: SUTD[1] }, AREA_RADIUS); refresh(); }, 0);
  loadFile(url).then(
    (raw) => {
      placeList = places.parsePlaces(raw);
      check((p) => !fog.isRevealed(before, p.lat, p.lng));
    },
    (e) => console.warn('No places to discover:', e),   // only the loading is caught here, so a bug in the handler above stays visible
  );
}
