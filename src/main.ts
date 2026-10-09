// The only file that knows every module. To add a feature: write a module, then wire it into onFix or the startup below.
import { map } from './map.ts';
import * as me from './me.ts';
import { say, showDebugBadge } from './ui.ts';
import { startGps, probe } from './gps.ts';
import { startDebugWalk } from './debugWalk.ts';
import * as fogLayer from './fogLayer.ts';
import * as storage from './storage.ts';
import * as discovery from './discovery.ts';
import * as hud from './hud.ts';
import * as sound from './sound.ts';
import * as placesLayer from './placesLayer.ts';
import * as today from './today.ts';
import * as quests from './quests.ts';
import * as regions from './region.ts';
import { getFlag, setFlag } from './flags.ts';
import { MAX_ACCURACY, ROUGH_HINT_DELAY, HINT_KEY, START_ZOOM } from './config.ts';
import type { Fix } from './types.ts';

const debug = new URLSearchParams(location.search).get('debug');   // ?debug or ?debug=10 (speed multiplier)
const storeKey = storage.storeKey(debug !== null);
fogLayer.load(storage.readFog(storeKey));            // bring back earlier progress before the first fix
const saver = storage.createSaver(storeKey, fogLayer.snapshot);

hud.init({
  soundOn: sound.isOn(), onSound: sound.setOn,
  onFocus: (place) => { if (placesLayer.focusPlace(place)) me.stopFollowing(); },   // "Last: ..." in the stats card: show that place on the map, and stay there (not snap back to you on the next fix)
  hintSeen: getFlag(HINT_KEY), onHintSeen: () => setFlag(HINT_KEY),
});
const questsOn = new URLSearchParams(location.search).get('quests') !== 'off';   // ?quests=off: the plain map with only today's goal (the old behaviour)
const regionKey = regions.regionStoreKey(debug !== null);
const placesApi = ((import.meta.env.VITE_PLACES_API as string | undefined) ?? '').replace(/\/+$/, '');   // the Render service; unset = only SUTD and the stored regions
const home = discovery.start(import.meta.env.BASE_URL + 'places.json', placesApi, regionKey, today.todayStoreKey(debug !== null), today.foundStoreKey(debug !== null), questsOn ? quests.questStoreKey(debug !== null) : null);   // starts loading right away; places already in restored fog appear quietly
if (home) map.setView([home.lat, home.lng], START_ZOOM, { animate: false });   // open where you last were, not at SUTD

let lastPrecise = 0;                                 // when the last fix good enough to clear fog arrived (0 = never)

// Every position, real GPS or debug walk, comes through here.
function onFix(fix: Fix) {
  me.update(fix);                                    // the dot shows every fix, even a rough one
  const now = performance.now();
  if (fix.accuracy <= MAX_ACCURACY) {                // but only a trustworthy fix clears fog
    lastPrecise = now;
    say('');
    discovery.onMove(fix);                            // quests measure from here, so this comes before the fog changes
    if (fogLayer.reveal(fix)) {                       // new cells cleared:
      saver.schedule();                               // save soon
      discovery.onCleared();                          // any place under them is found; the stats update
    }
  } else if (!lastPrecise || now - lastPrecise > ROUGH_HINT_DELAY) {   // ignore brief dips near the limit, so the hint doesn't flicker
    say(`GPS ±${Math.ceil(fix.accuracy / 10) * 10} m. Fog clears within ${MAX_ACCURACY} m, try outdoors.`);
  }
}

if (debug === null) {
  say('Finding you…');
  me.watchStale((stale) => say(stale ? 'No GPS signal. Showing where you last were.' : ''), () => probe(onFix));
  startGps(onFix, (msg, persistent) => { if (persistent || !lastPrecise) say(msg); });   // once fog is clearing, a missed update isn't worth a message
} else {
  showDebugBadge(() => { saver.stop(); storage.clearFog(storeKey); quests.clearQuest(quests.questStoreKey(true)); storage.clearFog(today.foundStoreKey(true)); location.reload(); });   // stop first (for good): a walk tick during the reload could otherwise save the old fog again
  startDebugWalk(map, me.where, onFix, Number(debug));
}

interface FogMapApi {
  map: typeof map;
  where: typeof me.where;
  isRevealed: typeof fogLayer.isRevealed;
  snapshot: typeof fogLayer.snapshot;
  load: typeof fogLayer.load;
  quest: typeof discovery.activeQuest;
}
declare global { interface Window { fogMap: FogMapApi } }
window.fogMap = { map, where: me.where, isRevealed: fogLayer.isRevealed, snapshot: fogLayer.snapshot, load: fogLayer.load, quest: discovery.activeQuest };   // handle for tests now (not a security boundary: all of this runs on the user's own device); the quest interface later
