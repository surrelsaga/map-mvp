// Tunable constants. Anything a feature might want to tweak lives here (styling lives in style.css / the layer that draws it).
export const SUTD = [1.3413, 103.9638];   // map start / debug-walk start
export const START_ZOOM = 17;
export const MAX_ZOOM = 19;
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const GPS_OPTIONS = { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 };
export const WALK_SPEED = 1.4;            // m/s, debug walking pace
export const DEBUG_TICK_MS = 500;
export const DEBUG_ACCURACY = 10;         // metres, pretend GPS accuracy while debug walking
