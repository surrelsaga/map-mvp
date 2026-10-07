// The only file that knows every module. To add a feature: write a module, then wire it into onFix or the startup below.
import { map } from './map.js';
import * as me from './me.js';
import { say, showDebugBadge } from './ui.js';
import { startGps } from './gps.js';
import { startDebugWalk } from './debugWalk.js';

// Every position, real GPS or debug walk, comes through here.
function onFix(fix) {
  say('');
  me.update(fix);
  // next: fog.reveal(fix), places.check(fix), ...
}

const debug = new URLSearchParams(location.search).get('debug');   // ?debug or ?debug=10 (speed multiplier)
if (debug === null) {
  say('Finding you…');
  startGps(onFix, (msg, persistent) => { if (persistent || !me.where()) say(msg); });   // after a first fix, a missed update isn't worth a message
} else {
  showDebugBadge();
  startDebugWalk(map, me.where, onFix, Number(debug));
}

window.fogMap = { map, where: me.where };   // handle for tests now (not a security boundary: all of this runs on the user's own device); the quest interface later
