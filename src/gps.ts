// Position source #1: the device's GPS. Same shape as debugWalk: start(...) then call onFix({lat, lng, accuracy}).
import { GPS_OPTIONS } from './config.ts';
import type { Fix } from './types.ts';

// onProblem(message, persistent): persistent problems (blocked, unsupported) always matter; transient ones only before the first fix.
export function startGps(onFix: (fix: Fix) => void, onProblem: (message: string, persistent: boolean) => void) {
  if (!navigator.geolocation) return onProblem('This browser can’t share your location.', true);
  navigator.geolocation.watchPosition(
    (p) => onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
    (e) => e.code === e.PERMISSION_DENIED
      ? onProblem(isSecureContext ? 'Location is blocked. Allow it in your browser settings and reload.' : 'Location needs a secure page (https or localhost).', true)
      : onProblem('Can’t get your location yet…', false),
    GPS_OPTIONS);
}
