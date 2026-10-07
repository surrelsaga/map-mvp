# Fog Walk map MVP: phased build plan

## Context
`map-MVP/` is empty apart from CLAUDE.md. Before building the full product, the goal is to see whether the map has potential: a live GPS dot walking through fog that clears behind it, with real places around SUTD appearing as they're uncovered. It's built in small phases, and each one works and has been checked on a real phone before the next starts.

Decisions so far: web app, no build step. Leaflet with OSM tiles. Fog as grid cells drawn on a canvas. `localStorage` for saved progress. The dot follows live GPS. Place data is fetched once ahead of time for a **2 km radius around SUTD** (≈1.3413, 103.9638) and shipped as a static file, so no location ever leaves the phone. Hosting is GitHub Pages, with $50 of Render credit kept as a fallback if a server is ever needed.

## Architecture
Native ES modules, no build step. Each module has one job. `src/main.js` is the only file that knows all the others; adding a feature means writing a module and adding one line of wiring there.

```
index.html          page shell: markup, Leaflet from CDN, loads src/main.js
style.css           all styling
src/
  config.js         tunable constants (start point, zoom, fog radius, cell size, accuracy cutoff...)
  map.js            Leaflet map + OSM tiles; exports `map`
  ui.js             DOM bits: status message, recentre button, debug badge
  me.js             player dot, accuracy ring, last fix, camera-follow    ✅ phase 1
  gps.js            position source #1: device GPS                        ✅ phase 1
  debugWalk.js      position source #2: tap-to-walk                       ✅ phase 1
  fog.js            PURE logic: grid cells, distance, reveal, isRevealed (no DOM, no Leaflet, Node-testable)   phase 2
  fogLayer.js       canvas overlay that draws the fog from fog.js state   phase 2
  storage.js        save/load revealed cells (localStorage)               phase 3
  places.js         load places.json, hide/show by fog, "Found" toasts    phase 4
  hud.js            % explored + places-found display                     phase 4/5
  api.js            window.fogMap quest interface                         phase 6
  main.js           wiring: sources -> onFix -> [me, fog, storage, places, hud]
data/places.json    slim list `{name, type, lat, lng}` (committed)         phase 4
tools/fetch-places.mjs   run once on the laptop: Overpass query -> data/places.json
tests/fog.test.mjs  plain `node:assert` checks for src/fog.js
```

Rules:
- Position sources (`gps`, `debugWalk`) share one shape: they call `onFix({lat, lng, accuracy})`. Nothing downstream knows which one is live.
- `fog.js` never touches the DOM or Leaflet. Anything that draws goes in a `*Layer.js` or `ui.js`/`hud.js`.
- A module reads shared state through a small exported function (e.g. `me.where()`), not by reaching into another module's variables.
- Behaviour constants (start point, zoom, tile URL, GPS options, thresholds, radii) live in `config.js`, not inline. Pure styling stays in `style.css` or the layer that draws it.
- `window.fogMap` (set in `main.js`) is the one handle outside code (tests, later the quests) uses.

## How each phase runs
The MVP is a chain of separate pieces. Each piece goes through this loop before the next one starts:
1. **Build**: only that phase's piece.
2. **Test**: `node tests/fog.test.mjs` if the phase touches `src/fog.js`, then run it in the browser (`npx serve`, `?debug` walk) and take a screenshot.
3. **Review**: run the `code-review` skill (correctness) and the `ponytail-review` skill (over-engineering) on the changes, then fix what they find and test again.
4. **Your check**: you try it on the laptop or phone and say go.
5. **Commit + push to Pages**, then start the next phase.

Installed skills used: `code-review`, `frontend-design` (Phase 5), `ponytail`.

## Phases

**0. Setup** (the repo is done: `github.com/surrelsaga/map-mvp`, branch `main`)
- Only step left: turn on GitHub Pages (Settings → Pages → deploy from `main`, root). The phone URL will be `https://surrelsaga.github.io/map-mvp/`. This can wait until the end of Phase 1, when there's something to deploy.

**1. Live map + dot** ✅ done (live on Pages)
- Full-screen Leaflet map with OSM tiles and attribution. The map opens at SUTD, zoom 17.
- `watchPosition` (high accuracy) drives a dot with an accuracy ring. The map follows the dot until you drag it; a recentre button turns following back on.
- `?debug` mode: tap anywhere and the dot *walks* there at walking speed (×10 option). It goes through the same update function as real GPS, so it tests exactly the live path.
- Check: the debug walk works on the laptop (`npx serve`, localhost); on the phone, the Pages URL shows your real dot moving.

**2. Fog**
- `src/fog.js` (+ `src/fogLayer.js`): a grid of 0.0001° cells (about 11 m) and a 40 m reveal radius (adjustable). Reveal along the line between GPS readings so the trail has no gaps; skip that for jumps over 200 m. Ignore readings with accuracy worse than 50 m (adjustable).
- Accuracy gate goes in `main.js` routing, not in `fog.js`: the dot shows every fix (a big ring is honest), but only fixes ≤ `MAX_ACCURACY` reach the fog. Fixes the dot shows but fog ignores: coarse Wi-Fi/IP first fixes, tunnel drift.
- `me.js` dot and ring move into their own `player` pane above the fog. Today they sit in Leaflet's default overlay pane (z 400), which the fog pane (z 450) would cover.
- The canvas sits in its own Leaflet pane above the tiles and below the markers and dot. It redraws when the map moves or zooms and clears the revealed cells with soft edges.
- Check: `node tests/fog.test.mjs` passes, the debug walk leaves a cleared trail, and a real walk clears fog.

**3. Saved progress**
- Revealed cells are saved to `localStorage` as JSON when new cells are added. A reload keeps progress. Debug mode gets a reset button.
- Debug walks save under a separate key (e.g. `fog:debug`), so tapping around on the laptop or phone never mixes fake trails into your real walked progress.
- Check: walk, reload, the fog stays cleared.

**4. Discover places**
- `tools/fetch-places.mjs`: one Overpass query for named `amenity|shop|leisure|tourism|historic` places within 2 km of SUTD, trimmed to `{name, type, lat, lng}`.
- Places stay hidden while their cell is under fog. When a cell first clears, a small toast shows "Found: <name>" with a short vibration. Tap a place pin to see its name.
- The HUD shows % of the 2 km area explored and the number of places found.
- Check: a debug walk past a known place (e.g. a hawker centre near SUTD) makes it pop up.

**5. UI design pass**
- Use the `frontend-design` skill. First a short token plan (4–6 colours, typeface, layout as an ASCII wireframe) for your review, then the build.
- Brief: outdoor use in Singapore sunlight, glanced at rather than stared at. Phone-first, with the map as the hero and the HUD as small as possible. The one bold element is the fog and its cleared edge.
- Starting wireframe:
  ```
  ┌──────────────────────┐
  │ 12% explored  7 found│  ← one slim HUD pill
  │░░░░░░░░░░░░░░░░░░░░░░│
  │░░░░░░░    ●   ░░░░░░░│  ← cleared trail, dot
  │░░░░░░░  ☕     ░░░░░░│  ← discovered place
  │░░░░░░░░░░░░░░░░░░░░░░│
  │ [Found: Changi Village…]  ⊕ │ ← toast, recentre
  └──────────────────────┘
  ```
- Stale-GPS cue: dim the dot when no fix has arrived for ~30 s (tunnels, covered walkways), so a frozen dot isn't mistaken for live.
- Check: screenshots on the laptop plus a look on the phone outdoors.

**6. Quest interface (later, once quests are decided)**
- `src/api.js` grows the `window.fogMap` handle (already `{ map, where }`) into `{ where(), isRevealed(lat,lng), reached(lat,lng,m), marker(lat,lng,label) }`. It's a thin wrapper over phase 1–4 modules, so it doesn't steer the earlier phases.
- Before quests trust `reached()`, limit `?debug` to localhost (today any visitor can add `?debug` to the Pages URL and tap to any spot).

## Known limits (stated, not solved)
- Mobile browsers pause GPS when the screen locks, so the screen has to stay on while walking. Background tracking is out of scope.
- The standard OSM tile servers are fine for light MVP use. Switch tile provider if usage grows.
- `localStorage` holds about 400k cells. Move to IndexedDB if that's ever reached.
- Privacy wording: walked history never leaves the phone, but map tiles come from OSM and Leaflet from unpkg, so those servers see roughly which area is on screen. The "why open" write-up should say exactly that. Self-hosting Leaflet would also let the app start offline.
- Deploys: GitHub Pages caches files ~10 min, so right after a push a phone can mix old and new modules. If the page says "Something went wrong loading the app", hard-refresh (or open a private tab).
- `index.html` can't be opened by double-click (browsers block ES modules on `file://`). Use `npx serve` or the Pages URL.
- Commit new files with `git add` (e.g. `src/`, `style.css`); `git commit -a` skips untracked files and the live page would 404 on them.

## Verification (end to end)
1. `npx serve` (only serves the static files; there's no backend) → open `localhost:3000/?debug`, walk around SUTD by tapping, and watch the fog clear and places appear. Reload and the progress stays.
2. `node tests/fog.test.mjs` → `ok`.
3. Open the Pages URL on the phone, walk around SUTD for 10 minutes, and confirm the fog clears along the real route and nearby places are discovered.
