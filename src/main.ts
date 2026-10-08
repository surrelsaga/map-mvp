// The only file that knows every module. To add a feature: write a module, then wire it into onFix or the startup below.
import { map } from './map.ts';
import * as me from './me.ts';
import { say, showDebugBadge } from './ui.ts';
import { startGps } from './gps.ts';
import { startDebugWalk } from './debugWalk.ts';
import * as fogLayer from './fogLayer.ts';
import { MAX_ACCURACY } from './config.ts';
import type { Fix } from './types.ts';

// Every position, real GPS or debug walk, comes through here.
function onFix(fix: Fix) {
  say('');
  me.update(fix);                                    // the dot shows every fix, even a rough one
  if (fix.accuracy <= MAX_ACCURACY) fogLayer.reveal(fix);   // but only a trustworthy fix clears fog
  // next: places.check(fix), ...
}

const debug = new URLSearchParams(location.search).get('debug');   // ?debug or ?debug=10 (speed multiplier)
if (debug === null) {
  say('Finding you…');
  startGps(onFix, (msg, persistent) => { if (persistent || !me.where()) say(msg); });   // after a first fix, a missed update isn't worth a message
} else {
  showDebugBadge();
  startDebugWalk(map, me.where, onFix, Number(debug));
}

interface FogMapApi {
  map: typeof map;
  where: typeof me.where;
  isRevealed: typeof fogLayer.isRevealed;
  snapshot: typeof fogLayer.snapshot;
  load: typeof fogLayer.load;
}
declare global { interface Window { fogMap: FogMapApi } }
window.fogMap = { map, where: me.where, isRevealed: fogLayer.isRevealed, snapshot: fogLayer.snapshot, load: fogLayer.load };   // handle for tests now (not a security boundary: all of this runs on the user's own device); the quest interface later
