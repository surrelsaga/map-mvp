// Tunable constants. Anything a feature might want to tweak lives here (styling lives in style.css / the layer that draws it).
export const SUTD: [number, number] = [1.3413, 103.9638];   // map start / debug-walk start
export const START_ZOOM = 17;
export const MAX_ZOOM = 19;
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const GPS_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 };
export const WALK_SPEED = 1.4;            // m/s, debug walking pace
export const DEBUG_TICK_MS = 500;
export const DEBUG_ACCURACY = 10;         // metres, pretend GPS accuracy while debug walking

// Fog
export const MIN_ZOOM = 15;               // zooming out further would make the fog redraw scan too many cells
export const CELL = 0.0001;               // degrees, ~11 m: one fog cell
export const REVEAL_RADIUS = 40;          // metres cleared around each accepted fix
export const MAX_ACCURACY = 50;           // metres: fixes worse than this show the dot but don't clear fog
export const MAX_SPEED = 3;               // m/s: a gap between fixes covered faster than this (bus, lift, GPS lost) isn't walked, so nothing is cleared across it
export const MAX_JUMP = 200;              // metres: a bigger gap between fixes (glitch, debug teleport) isn't walked, only the end point clears
