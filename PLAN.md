# Fog Walk map MVP: phased build plan

## Context
`map-MVP/` is empty apart from CLAUDE.md. Before building the full product, the goal is to see whether the map has potential: a live GPS dot walking through fog that clears behind it, with real places around SUTD appearing as they're uncovered. It's built in small phases, and each one works and has been checked on a real phone before the next starts.

Decisions so far: web app built with Vite + TypeScript (moved from a no-build setup in Phase 2.5). Leaflet (npm) with OSM tiles. Fog as grid cells drawn on a canvas. `localStorage` for saved progress. The dot follows live GPS. Place data is fetched once ahead of time for a **2 km radius around SUTD** (≈1.3413, 103.9638) and shipped as a static file, so no location ever leaves the phone. Hosting is GitHub Pages, with $50 of Render credit kept as a fallback if a server is ever needed.

## Architecture
TypeScript ES modules bundled by Vite. Each module has one job. `src/main.ts` is the only file that knows all the others; adding a feature means writing a module and adding one line of wiring there.

```
index.html          page shell: markup, links src/style.css, loads src/main.ts
package.json        scripts: dev, build, preview, typecheck, test
tsconfig.json  vite.config.ts  .github/workflows/deploy.yml (test, build, publish to Pages)
src/
  style.css         all styling (linked from index.html, so it loads before any script)
  types.ts          shared shapes: LatLng, Fix
  config.ts         tunable constants (start point, zoom, fog radius, cell size, accuracy cutoff...)
  map.ts            Leaflet map + OSM tiles; exports `map`
  ui.ts             DOM bits: status message, recentre button, debug badge
  me.ts             player dot, accuracy ring, last fix, camera-follow    ✅ phase 1
  gps.ts            position source #1: device GPS                        ✅ phase 1
  debugWalk.ts      position source #2: tap-to-walk                       ✅ phase 1
  fog.ts            PURE logic: grid cells, distance, reveal, isRevealed (no DOM, no Leaflet, Node-testable)   phase 2
  fogLayer.ts       canvas overlay that draws the fog from fog.ts state   phase 2
  storage.ts        save/load revealed cells (localStorage), debounced saver   ✅ phase 3
  places.ts         PURE: parse places.json, find newly cleared places, "Found" text   ✅ phase 4
  discovery.ts      places + found state + % explored; toast, vibrate, HUD refresh   ✅ phase 4
  placesLayer.ts    pins + popups for found places (Leaflet)             ✅ phase 4
  coverage.ts       PURE: the 2 km circle as cells, % explored             ✅ phase 4
  hud.ts            % explored + places-found display (DOM)               ✅ phase 4
  api.ts            window.fogMap quest interface                         phase 6
  main.ts           wiring: sources -> onFix -> [me, fog, storage, places, hud]
public/places.json  `{source, fetched, center, radius, places:[{id,name,type,lat,lng}]}` (committed)   ✅ phase 4
tools/fetch-places.mjs   run once on the laptop: Overpass query -> public/places.json
tests/fog.test.ts, storage.test.ts, places.test.ts  plain `node:assert` checks for the pure logic (fog, storage, places, coverage) and for the shipped places.json (Node 24 runs the TypeScript directly)
tests/browser.mjs   dev-only headless-Chrome regression suite (`npm run test:browser`, puppeteer-core); not part of `npm test` or CI
```

Rules:
- Position sources (`gps`, `debugWalk`) share one shape: they call `onFix({lat, lng, accuracy})`. Nothing downstream knows which one is live.
- `fog.ts` never touches the DOM or Leaflet. Anything that draws goes in a `*Layer.ts` or `ui.ts`/`hud.ts`.
- A module reads shared state through a small exported function (e.g. `me.where()`), not by reaching into another module's variables.
- Behaviour constants (start point, zoom, tile URL, GPS options, thresholds, radii) live in `config.ts`, not inline. Pure styling stays in `style.css` or the layer that draws it.
- `window.fogMap` (set in `main.ts`) is the one handle outside code (tests, later the quests) uses.

## How each phase runs
The MVP is a chain of separate pieces. Each piece goes through this loop before the next one starts:
1. **Build**: only that phase's piece.
2. **Test**: `npm test`, `npm run typecheck`, then `npm run test:browser` against `npm run dev` (it starts with a warm-up page load: right after a source edit the Vite dev server reloads the first page that connects, and a reload keeps saved progress, which would change what counts as a new find mid-test) (it covers every earlier phase too, so it is the regression check). Take a screenshot for visual changes. A phase that changes the build is also checked against `npm run build` + `npm run preview`.
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
- Check: the debug walk works on the laptop (`npm run dev`, localhost:3000); on the phone, the Pages URL shows your real dot moving.

**2. Fog** ✅ built, awaiting your check
- `src/fog.ts` (+ `src/fogLayer.ts`): a grid of 0.0001° cells (about 11 m) and a 40 m reveal radius (adjustable). Reveal along the line between GPS readings so the trail has no gaps; skip that for jumps over 200 m. Ignore readings with accuracy worse than 50 m (adjustable).
- Accuracy gate goes in `main.ts` routing, not in `fog.ts`: the dot shows every fix (a big ring is honest), but only fixes ≤ `MAX_ACCURACY` reach the fog. Fixes the dot shows but fog ignores: coarse Wi-Fi/IP first fixes, tunnel drift.
- `me.ts` dot and ring move into their own `player` pane above the fog. Today they sit in Leaflet's default overlay pane (z 400), which the fog pane (z 450) would cover.
- The canvas sits in its own Leaflet pane above the tiles and below the markers and dot. It redraws when the map moves or zooms and clears the revealed cells with soft edges.
- Check: `npm test` passes, the debug walk leaves a cleared trail, and a real walk clears fog.

**2.5 Vite + TypeScript** ✅ built, awaiting your check. A pure move (no feature changes): tooling, types, README, Actions deploy.

**3. Saved progress** ✅ built, awaiting your check
- `src/storage.ts`: pure `encode`/`decode` (Node-tested, validates everything read back), `localStorage` wrappers that never throw, and a debounced saver. The stored value is `{ keys: number[] }`.
- The storage key carries the format version and the grid size: `fogwalk:v1:<CELL>` (plus `:debug` for simulated walks). Changing `CELL` or bumping `STORE_KEY` therefore never overwrites old progress: it stays in storage under its own key, ready for a migration. A golden test pins `key()` for SUTD, so changing the grid without bumping `STORE_KEY` fails `npm test`.
- `main.ts` restores with `fogLayer.load(storage.readFog(key))` before the first fix, and calls `saver.schedule()` whenever `reveal` clears new cells. No change hook was needed in `fogLayer`: `reveal` already returns the count.
- Writes happen at most every 2 s (`SAVE_DELAY_MS`), and immediately when the page is hidden or closed (`pagehide` / `visibilitychange`), because phones kill backgrounded pages without warning.
- Each write is merged with what is already stored, so a second tab holding older cells can't wipe newer ones. A failed write (quota, blocked) leaves the data marked unsaved and is retried on the next cleared cell or hide/close.
- The debug badge has a **reset fog** button: it stops the saver for good, clears the debug key and reloads.
- Not done: no on-screen notice when saving fails (console warning only; the Phase 5 HUD is the place for one); `navigator.storage.persist()` isn't requested, so Safari may evict data after ~7 idle days if the page isn't installed to the home screen.
- Check: walk, reload, the fog stays cleared (also covered by `npm run test:browser`).

**4. Discover places** ✅ built, awaiting your check
- `tools/fetch-places.mjs` (run once on the laptop: `node tools/fetch-places.mjs`) queries the OpenStreetMap Overpass API for named `amenity|shop|leisure|tourism|historic` places within 2 km of SUTD and writes `public/places.json` (283 places, each with its OpenStreetMap id like `node/123`, which quests will use to refer to a place). It drops street furniture (parking, benches, toilets...) and path segments (park connectors), merges same-name places within ~100 m, and keeps only places inside the circle. It takes SUTD and the radius from `src/config.ts`, identifies itself with a `User-Agent` (Overpass rejects anonymous clients), pauses between servers, and refuses to overwrite the file when Overpass answers with an error, a `remark` or too few results. The app never calls Overpass: the file ships with the app, so nobody's location is sent anywhere.
- `src/places.ts` (pure, Node-tested): `parsePlaces` (keeps only well-formed entries; names have control and direction-override characters stripped, are trimmed and capped at 80 characters), `discover` (places whose spot is now cleared, each found once), `foundMessage` ("Found: A", "Found: A and B", "Found: A, B and 3 more", and repeated chain names as "7-Eleven ×2").
- `src/discovery.ts`: owns the place list, the found set and the stats. `start(url)` loads the file (a network or server error is retried twice, after 1.5 s and 4 s; a missing file, 4xx, is not) and builds the 2 km circle just after first paint; `onCleared()` runs when walking clears new cells. A find gets a toast, a short vibration and a HUD refresh. Vibration only works on Android after the user has tapped the page once; iPhones have no vibration API at all, so on iPhone a find is the toast only (Phase 5 should add a second cue, e.g. a sound or a persistent "new" marker). Anything cleared since the page opened is announced, even if the file arrives late; only places inside fog restored from an earlier session appear quietly. `reveal()` was not changed to return the new cells (the earlier idea): checking ~300 places per cleared fix is trivial and needs no new API.
- `src/placesLayer.ts`: a pin per found place in its own `places` pane (above the fog, below the player dot); tapping shows the name in a popup. Names are untrusted OSM text, so they only reach the page via `textContent`, never HTML. Pins are plain DOM `divIcon`s (no image files).
- `src/coverage.ts` (pure, Node-tested): the 2 km circle as a set of fog cells (~100k, built once at start) and "% explored" = cleared cells inside it, shown as `0.04%` while tiny and `3.2%` once visible.
- `src/hud.ts`: "0.08% explored, 1 of 282 places found", top-left. The toast ("Found: ...") is in `ui.ts`, bottom-centre, 4 s, and its text is emptied after the fade so screen readers aren't left a stale message. HUD and the GPS status message sit in one column (`#top`), so a wrapping HUD can't cover the message.
- Placeholder look: orange pins, white HUD pill, dark toast. Phase 5 designs it properly.
- Known limits: a big place (a park, a campus) is one point at its centre, so it counts as found only when that spot is cleared, even if the centre is a pond or fence; names are merged by a rounded ~100 m grid (two same-name shops close together become one); found places are tracked by list index within a session (stable ids are in the data for anything that must persist, e.g. quests).
- Names: control characters become a space; direction marks, zero-width, soft-hyphen and tag characters are removed (written as `\u` escapes in `places.ts`, never as raw invisible characters).
- Check: a debug walk to the SUTD Canteen (91 m from the start) shows "Found: SUTD Canteen" and its pin. Covered by `npm run test:browser` against the real data.

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
- Fog look (all deliberately plain in Phase 2): fog opacity is 0.9, so the map is faintly visible underneath, including street names. Decide whether unexplored streets should be hidden fully. The cleared edge is scalloped (cell-sized bumps). Add more feather or a blur. The canvas is CSS-pixel resolution, so on 2x/3x phone screens use `devicePixelRatio` for a crisp edge (the canvas is already padded to 4x area, so check redraw cost).
- Stale-GPS cue: dim the dot when no fix has arrived for ~30 s (tunnels, covered walkways), so a frozen dot isn't mistaken for live.
- Check: screenshots on the laptop plus a look on the phone outdoors.

**6. Quest interface (later, once quests are decided)**
- `src/api.ts` grows the `window.fogMap` handle (already `{ map, where }`) into `{ where(), isRevealed(lat,lng), reached(lat,lng,m), marker(lat,lng,label) }`. It's a thin wrapper over phase 1–4 modules, so it doesn't steer the earlier phases. Give `window.fogMap` its public type here (it is already typed as `FogMapApi` in `main.ts`).
- Quest markers: bundled Leaflet can't find its default marker icon, so a plain `L.marker` shows a broken image. Use `L.divIcon` (no image files) or set `L.Icon.Default.mergeOptions` with the icons imported from `leaflet/dist/images/`.
- Before quests trust `reached()`, limit `?debug` to localhost (today any visitor can add `?debug` to the Pages URL and tap to any spot).

## Known limits (stated, not solved)
- Mobile browsers pause GPS when the screen locks, so the screen has to stay on while walking. Background tracking is out of scope.
- The standard OSM tile servers are fine for light MVP use. Switch tile provider if usage grows.
- Fog redraw scans every cell in the padded view: ~15k lookups at the default zoom, ~200k at the zoom-15 limit. If it stutters on an old phone, iterate the cleared cells instead of the grid.
- Interpolation between fixes is skipped when the gap was covered faster than 3 m/s, or is over 200 m, so riding a bus doesn't clear a corridor between two fixes. The fixes themselves still clear around them.
- `localStorage` holds about 400k cells (~12 bytes each). Move to IndexedDB if that's ever reached.
- Two tabs open at once: saves are merged, so nothing is lost, but each tab only shows its own cells until it reloads.
- Privacy wording: walked history never leaves the phone, but the map tiles come from OSM, so that server sees roughly which area is on screen. The "why open" write-up should say exactly that. Leaflet is bundled into the app, so the app itself starts offline (the tiles still need a network).
- Deploys: every push to `main` runs the Pages workflow (needs repo Settings → Pages → Source: GitHub Actions). Built files have content hashes in their names, so a phone never mixes old and new code. If the page says "Something went wrong loading the app", reload.
- `index.html` can't be opened by double-click (browsers block ES modules on `file://`, and the source is TypeScript). Run `npm run dev`.
- `node_modules/` and `dist/` are git-ignored. Commit `package-lock.json`. Pages deploys from the build, not from the repo root.

## Verification (end to end)
1. `npm run dev` (only a dev server for the static app; there's no backend) → open `localhost:3000/?debug`, walk around SUTD by tapping, and watch the fog clear and places appear. Reload and the progress stays.
2. `npm test` → `ok`, `npm run typecheck` and `npm run build` pass.
3. Open the Pages URL on the phone, walk around SUTD for 10 minutes, and confirm the fog clears along the real route and nearby places are discovered.
