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
export const ROUGH_HINT_DELAY = 5000;     // ms without a precise fix before the "GPS ±N m" hint shows
export const MAX_ACCURACY = 50;           // metres: fixes worse than this show the dot but don't clear fog
export const MAX_SPEED = 3;               // m/s: a gap between fixes covered faster than this (bus, lift, GPS lost) isn't walked, so nothing is cleared across it
export const MAX_JUMP = 200;              // metres: a bigger gap between fixes (glitch, debug teleport) isn't walked, only the end point clears

// Saved progress
export const SAVE_DELAY_MS = 2000;        // newly cleared cells are written to storage at most this often (also flushed when the page is hidden)
export const STORE_KEY = 'fogwalk:v1';    // bump the version when the stored format or the grid (fog.key) changes; storage.ts adds CELL, and ':debug' in debug mode

// Places
export const AREA_RADIUS = 2000;          // metres: the radius of every region (what server/places.ts asks Overpass for, and what "% explored" is measured against); tools/fetch-places.mjs uses it for SUTD
export const TOAST_MS = 4000;             // how long a "Found: ..." message stays up
export const REGION_ROUND = 0.005;        // degrees (~550 m): a region's centre is the fix rounded to this grid. It is also all the server is ever told about where you are
export const REANCHOR_M = 1500;           // walk further than this from the region's centre and a new region is loaded around you (the loaded circle is AREA_RADIUS, so 500 m of places always lie ahead)
export const REGION_KEEP = 3;             // regions kept on the phone, most recent first
export const REGION_RETRY_MS = 60_000;    // after a failed load, wait this long before asking again
export const REGION_MAX_CHARS = 2_000_000;   // stored regions never take more than this of localStorage's ~5 MB, so the fog (fogwalk:v1) always has room (a dense city centre is ~0.8 MB)
export const REGION_KEY = 'fogwalk:regions:v1';   // the kept regions; debug mode adds ':debug'
export const PLACES_RETRY_MS = [1500, 4000];   // pauses before retrying places.json after a network or server error (a missing file, 4xx, is final)

// Look and feel
export const STALE_GPS_MS = 30000;        // no GPS fix for this long: ask the device for one position; if that fails too, the dot goes hollow and a message says so
export const PROBE_TIMEOUT_MS = 8000;     // how long that one-off position request may take
export const MAX_FOG_PIXELS = 4_000_000;  // the fog canvas never exceeds this many pixels (phones refuse big canvases); sharpness is lowered to fit
export const CHIME_HZ = [659, 880];       // the "found" chime: E5, then A5

// Today's goal and the first-open hint
export const DAILY_GOAL = 3;              // new places to find per day: the goal the chip's ring fills toward (quests will take over this slot)
export const TODAY_KEY = 'fogwalk:today'; // per-device count of today's finds; debug mode adds ':debug'
export const HINT_KEY = 'fogwalk:hinted'; // set once the first-open hint has been dismissed

// Quests (two simple ones, no AI: reach a marked spot, then find new places; they alternate)
export const QUEST_MIN_M = 150;           // a reach quest picks an unfound place at least this far away...
export const QUEST_MAX_M = 400;           // ...and at most this far (the nearest unfound place if none is in between)
export const QUEST_FIND = 2;              // new places a find quest asks for
export const QUEST_NEXT_MS = 5000;        // how long a finished quest stays on the chip before the next one starts
export const QUEST_KEY = 'fogwalk:quest'; // per-device quest state; debug mode adds ':debug'
