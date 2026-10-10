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
export const REGION_MAX_CHARS = 1_000_000;   // stored regions never take more than this of localStorage's ~5 MB (some browsers count 2 bytes per character), so the fog (fogwalk:v1) always has room; one dense city centre (~0.85 MB) still fits
export const REGION_KEY = 'fogwalk:regions:v2';   // the kept regions; debug mode adds ':debug'. v2: places carry `fame` (v1 regions have none, and are never re-fetched, so they are let go)
export const PLACES_TIMEOUT_MS = 150_000;   // a places-service request that takes longer is a failure (the service may try three Overpass servers in turn, 45 s each)
export const PLACES_RETRY_MS = [1500, 4000];   // pauses before retrying places.json after a network or server error (a missing file, 4xx, is final)

// Look and feel
export const STALE_GPS_MS = 30000;        // no GPS fix for this long: ask the device for one position; if that fails too, the dot goes hollow and a message says so
export const PROBE_TIMEOUT_MS = 8000;     // how long that one-off position request may take
export const MAX_FOG_PIXELS = 4_000_000;  // the fog canvas never exceeds this many pixels (phones refuse big canvases); sharpness is lowered to fit
export const CHIME_HZ = [659, 880];       // the "found" chime: E5, then A5

// Today's goal and the first-open hint
export const DAILY_GOAL = 3;              // new places to find per day: the goal the chip's ring fills toward (quests will take over this slot)
export const TODAY_KEY = 'fogwalk:today'; // per-device count of today's finds; debug mode adds ':debug'
export const FOUND_KEY = 'fogwalk:found:v1';   // every place this device has found (their keys), wherever the fog came from; debug mode adds ':debug'
export const FOUND_MAX = 5_000;           // bounds what that list, or a damaged value, can cost (a place key is ~16 characters: about 100 KB at most)
export const HINT_KEY = 'fogwalk:hinted'; // set once the first-open bubble has been dismissed
export const OPENED_KEY = 'fogwalk:opened'; // set once the Today panel has been opened

// Quests (two simple ones, no AI: reach a marked spot, then find new places; they alternate)
export const QUEST_MIN_M = 150;           // a reach quest picks an unfound place at least this far away...
export const QUEST_MAX_M = 400;           // ...and at most this far (the nearest unfound place if none is in between)
export const QUEST_FIND = 2;              // new places a find quest asks for
export const QUEST_NEXT_MS = 5000;        // how long a finished quest stays on the chip before the next one starts
export const QUEST_KEY = 'fogwalk:quest'; // per-device quest state; debug mode adds ':debug'
export const QUEST_REVEAL_MS = 5 * 60_000; // a reach quest's spot starts hidden (only the hint); after this long looking, it is marked on the map
export const QUEST_PAST_M = 60;           // ...or sooner: you got this much closer, then drifted this far back out (walked past it, or lost)
export const QUEST_FAR_RATIO = 1.5;       // "heading away" alert: you are this many times the starting distance away...
export const QUEST_FAR_MIN_M = 100;       // ...and at least this much further than at the start (a 150 m quest doesn't nag at 230 m)
export const CROWD_PX = 22;               // found-place pins closer than this on screen are a crowd: only the newest of them shows (zoom in for the rest)

// Gemma writes the quest line (opt-in: the model downloads once from Hugging Face, then runs on the phone's GPU; nothing about you is sent)
export const GEMMA_MODEL = 'onnx-community/gemma-3-1b-it-ONNX-GQA';   // Gemma 3 1B, ~800 MB. The 270M model (~300 MB) was tried: it mostly copies the prompt's examples
export const GEMMA_MB = 800;              // the download size the switch shows before it is turned on
export const GEMMA_KEY = 'fogwalk:gemma'; // set once the user has turned Gemma on (it then loads from the browser's cache on every visit)
export const GEMMA_TRIES = 5;             // answers Gemma may give for one quest line before the plain line stays (about 1 s each)
export const HERE_M = 100;                // a place found this close to you is "where you are" in the quest line
export const LINE_MAX = 120;              // characters: a quest line longer than this is cut at a sentence end, or not used

// The wisp (Phase 10): help that is earned by trying, not given
export const QUEST_HELP_MS = 2 * 60_000;   // a reach quest's wisp appears after this long of looking...
export const QUEST_COLD_M = 40;            // ...or once you are this far past the closest you have been (you are going the wrong way)
export const QUEST_CLOSE_M = 60;           // within this, the wisp circles the spot's area and the last clue unlocks
export const TRAIL_NEED = 3;               // places a trail quest asks for (all of one kind: three cafes, three shops...)
export const TRAIL_R = 1000;               // a trail is offered only when that many of one kind are still hidden within this many metres of you
export const LEGEND_MAX_M = 1500;          // a legend quest (a famous place) may be this far: further than any ordinary reach quest
export const BADGE_LEVELS = [5, 10, 12];   // places discovered, per level of the one badge ("Explorer")
export const BADGE_KEY = 'fogwalk:badge:v1';   // the levels earned (and their dates); debug mode adds ':debug'
