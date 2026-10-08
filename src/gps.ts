// Position source #1: the device's GPS. Same shape as debugWalk: start(...) then call onFix({lat, lng, accuracy}).
import { GPS_OPTIONS, PROBE_TIMEOUT_MS } from './config.ts';
import type { Fix } from './types.ts';

const toFix = (p: GeolocationPosition): Fix => ({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });

// Positions are delivered in the order they were measured: one that arrives late but is older than the latest is dropped
// (a one-off request can finish after a newer update, and must not drag the dot back).
let latest = 0;
function deliver(p: GeolocationPosition, onFix: (fix: Fix) => void) {
  const t = p.timestamp ?? Date.now();
  if (t < latest) return;
  latest = t;
  onFix(toFix(p));
}

// onProblem(message, persistent): persistent problems (blocked, unsupported) always matter; transient ones only before the first fix.
export function startGps(onFix: (fix: Fix) => void, onProblem: (message: string, persistent: boolean) => void) {
  if (!navigator.geolocation) return onProblem('This browser can’t share your location.', true);
  navigator.geolocation.watchPosition(
    (p) => deliver(p, onFix),
    (e) => e.code === e.PERMISSION_DENIED
      ? onProblem(isSecureContext ? 'Location is blocked. Allow it in your browser settings and reload.' : 'Location needs a secure page (https or localhost).', true)
      : onProblem('Can’t get your location yet…', false),
    GPS_OPTIONS);
}

// Asks for one position right now. Some phones send no updates while you stand still, which looks the same as losing the signal:
// a position that comes back here is delivered like any other fix and proves the GPS is fine.
// Always settles: some browsers never call back (a pending permission prompt, a backgrounded tab), so a timer ends the wait.
export function probe(onFix: (fix: Fix) => void): Promise<boolean> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(false);
    const giveUp = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS + 2000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(giveUp); resolve(true); deliver(p, onFix); },   // answer first: a problem inside onFix must not leave the caller waiting
      () => { clearTimeout(giveUp); resolve(false); },
      { ...GPS_OPTIONS, maximumAge: 0, timeout: PROBE_TIMEOUT_MS });
  });
}
