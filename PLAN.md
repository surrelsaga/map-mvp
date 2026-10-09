# Fog Walk map MVP: phased build plan

## Context
`map-MVP/` is empty apart from CLAUDE.md. Before building the full product, the goal is to see whether the map has potential: a live GPS dot walking through fog that clears behind it, with real places around SUTD appearing as they're uncovered. It's built in small phases, and each one works and has been checked on a real phone before the next starts.

Decisions so far: web app built with Vite + TypeScript (moved from a no-build setup in Phase 2.5). Leaflet (npm) with OSM tiles. Fog as grid cells drawn on a canvas. `localStorage` for saved progress. The dot follows live GPS. Place data was first fetched once ahead of time for a **2 km radius around SUTD** (≈1.3413, 103.9638) and shipped as a static file, so no location ever left the phone. **Phase 7 changes this:** places come in 2 km regions centred on the user, which move to them when they walk out (see Phase 7). They're fetched through a small Render web service and kept on the phone, so anyone can try the app in their own area. The SUTD file stays as the offline seed and the test data. Hosting: Render is the main deploy (static site for the app, plus that one web service, paid from $50 of credit). The Pages workflow on `main` still exists.

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
  hud.ts            the goal chip, the stats card it opens, the sound switch, the first-open hint   ✅ phase 4/5/5b
  today.ts          PURE + store: today's finds and the daily goal   ✅ phase 5b
  flags.ts          a remembered yes/no (hint dismissed)   ✅ phase 5b
  icons.ts          pin icons shared by the map and the stats card   ✅ phase 5b
  sound.ts          the found-chime (WebAudio, unlocked on first tap)      ✅ phase 5
  quests.ts         PURE + store: the two test quests (reach, find), next-quest pick, progress, the quest's goal   ✅ phase 6
  questLayer.ts     the quest marker (Leaflet divIcon in the `quest` pane)   ✅ phase 6
  overpass.ts       PURE: the Overpass query for a centre, and its answer turned into `Place[]` (moved out of tools/fetch-places.mjs; the tool and the server import it)   phase 7
  region.ts         PURE + store: round a fix to a region centre, stay / reuse / fetch (the 1.5 km rule), the 3 kept regions   phase 7
                    (no api.ts: quests plug into discovery.ts and its goal slot, so no outside interface is needed)
  main.ts           wiring: sources -> onFix -> [me, fog, storage, places, hud]
public/places.json  `{source, fetched, center, radius, places:[{id,name,type,lat,lng}]}` (committed)   ✅ phase 4
tools/fetch-places.mjs   run once on the laptop: Overpass query -> public/places.json (the SUTD region, shipped as the seed)
server/places.ts    phase 7: the one backend piece, a Render web service. GET /places?lat&lng -> Overpass, cached per region. No database, no user data
tests/fog.test.ts, storage.test.ts, places.test.ts, design.test.ts, gps.test.ts, today.test.ts  plain `node:assert` checks for the pure logic (fog, storage, places, coverage), the shipped places.json and the palette's contrast (Node 24 runs the TypeScript directly)
tests/browser.mjs   dev-only headless-Chrome regression suite (`npm run test:browser`, puppeteer-core); not part of `npm test` or CI
```

Rules:
- Position sources (`gps`, `debugWalk`) share one shape: they call `onFix({lat, lng, accuracy})`. Nothing downstream knows which one is live.
- `fog.ts` never touches the DOM or Leaflet. Anything that draws goes in a `*Layer.ts` or `ui.ts`/`hud.ts`.
- A module reads shared state through a small exported function (e.g. `me.where()`), not by reaching into another module's variables.
- Behaviour constants (start point, zoom, tile URL, GPS options, thresholds, radii) live in `config.ts`, not inline. Pure styling stays in `style.css` or the layer that draws it.
- `window.fogMap` (set in `main.ts`) is the one handle outside code (the browser tests) uses. Quests are inside the app, so they don't go through it.

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

**5. UI design pass** ✅ built, awaiting your check (on the phone, outdoors)
Idea: *lights come on where you walk.* Unexplored streets sit under deep blue pre-dawn fog; where you've walked the map is full colour, and the cleared edge glows warm gold. Found places use the same gold, so gold always means "discovered". The glowing edge is the one bold element; everything else stays small.
- Colours: fog `#22304A` (~90%), first light `#F2B33D` (cleared-edge glow, pins, the find moment, nothing else), fog panel `#1A2538` (stats, messages, popups), daylight `#EEF3F8` (text), dusk `#93A3BA` (secondary text), you `#2F7DF6` (the familiar maps-blue dot).
- Type: Atkinson Hyperlegible Next, regular + bold, self-hosted in `public/` (~50 KB; no Google Fonts call). Text at least 16 px, tabular digits, sentence case only (no all-caps labels, no middle-dot separators).
- Glance view: one small chip top-left, "3 found". Tapping it opens the stats panel: "3 of 283 places found", "0.04% of the area", "Last: SUTD Canteen", plus a sound on/off toggle. Recentre is a drawn crosshair button, bottom-right, only after you pan away.
- Find moment (the only animation): the new pin lights up with one gold pulse and a message rises from the bottom: "Found SUTD Canteen" / "Restaurant" (several: "Found 3 places: SUTD Canteen, Gomgom and 1 more"). A short two-note chime made in the browser (no audio file), on by default, works after the first tap, follows the iPhone silent switch; vibration stays for Android. Reduced motion: plain fade.
- Pins: gold disc with a small hand-drawn SVG icon for four groups (food & drink, shops, parks & play, everything else). Popup: name in bold, type in plain words ("Fast food").
- GPS states: one line under the chip ("Weak GPS (±90 m). Fog clears within 50 m."). After 30 s without a fix the app asks the device for one position first (some phones send no updates while you stand still); only if that fails too does the dot dim (a grey dot with a dark outline, visible on the pale map and the dark fog) and the message read "No GPS signal. Showing where you last were." While lost it asks again only every 30 s (battery).
- Fog rendering: gold rim along the cleared edge, smoother (less scalloped) edge, sharp on 2x/3x screens (`devicePixelRatio`).
- No soft grey drop shadows (dark panels on a bright map don't need them); chips and buttons fully round, message and popup squarer. Tap targets at least 44 px.
- Checked against generic looks: dark + one accent is a common default, kept because it is functional (contrast with pale tiles in sun, the "lights on" idea, gold only for discoveries); fog is slate blue, not near-black, and gold is never used on buttons. The "big number + small label" stat was dropped: "0.04%" is discouraging at a glance, so the chip shows places found.
- Touches: `src/style.css`, `index.html`, `src/fogLayer.ts`, `src/placesLayer.ts`, `src/hud.ts`, `src/me.ts`, `src/ui.ts`, a small `src/sound.ts`, font files in `public/`.
- As built (small differences from the plan): fog is `rgba(31,44,69,0.95)` (deeper than first planned, because at 0.9 street names were still easy to read in unexplored areas); the cleared-edge glow is a gold-tinted sprite drawn onto the fog before the cells are cleared, so the rim sits just outside the cleared area; the fog canvas is scaled by screen density but capped at 4 million pixels (a 2x phone gets ~1.8x, a 3x phone is capped lower); the toast is `Found <name>` with the type underneath, and several finds read `Found 3 places: A, B and 1 more`; sound preference is stored in localStorage under `fogwalk:sound`; the weak-GPS and no-GPS messages sit in the same column as the chip and panel.
- Palette lives only in `src/style.css` (CSS custom properties); `src/theme.ts` lets the canvas and Leaflet code read it from there, and `tests/design.test.ts` guards the contrast of text, gold marks, the dimmed dot and the focus ring, and fails if a palette colour is repeated in a `.ts` file. Gold is only used for discoveries.
- Fog drawing cost: the canvas travels with the map pane, so panning redraws only when the view nears the padded canvas's edge (or the zoom changes, e.g. a pinch); the gold glow is drawn only for boundary cells; a redraw with 6,400 cleared cells takes ~7 ms on a laptop (was ~21 ms before these changes).
- Accessibility: the chip's name is "Progress: N found" open or closed; the sound switch's name is "Sound" with its state in `aria-checked`; focus rings are two-tone (dark line + light band) so they show on both the pale map and the dark panels; reduced motion also switches off Leaflet's zoom, fade and follow-pan animations.
- Known limits: the stats panel closes on a tap on the map and on Escape; after a tap on the map keyboard focus is wherever the browser puts it (the map itself, which is focusable). Tab order starts at the map, then the chip.
- Not verified here: the chime on a real iPhone (including whether it follows the silent switch: Web Audio on iOS may or may not be muted by it; treat the chime as a bonus, the toast is the real feedback) and everything outdoors in sunlight. Tab order starts at the map itself (Leaflet makes it focusable for arrow-key panning), then the chip. The font draws zero with a slash on purpose (a legibility feature), so "0 found" reads `Ø found`-style.
- Check: screenshots at phone size (and 320 px wide), the full browser suite, and a look on the phone outdoors.

**5b. Stats block redesign** ✅ built, awaiting your check
The main goal is still a working map that tracks your discoveries. This makes the stats look more professional, use less text, and invite a tap for the details. The daily goal ring is there to make the chip worth tapping; it isn't a feature in itself.
- **Chip (top-left, 48 px):** it explains itself, and a tap adds detail rather than meaning: "Find 3 places today", then "2 of 3 places today", then "Today's goal done". A gold ring shows progress and fills with a check when done; a chevron turns when the card is open; a visible edge in the `--dusk` colour (3:1 against the fog) says it's a button; a press tints it (an inset shadow) without scaling or moving it.
- **First open only:** a hint card says "Walk to clear the fog. Places appear as you uncover them." A tap anywhere or the first find dismisses it for good (`fogwalk:hinted`).
- **Card:**
  - Today's goal, with a large ring.
  - "N of 283 places found".
  - Four rows (Food & drink, Shops, Outdoors, Other), each with the same gold disc and icon as its pins on the map, a bar and "found of total". The count column has a fixed width, so every bar is the same length.
  - Area as "0.10% of the neighbourhood" with a bar.
  - "Last: <place>" with its type underneath: tapping it closes the card, pans the map there and opens the place's name.
  - A real sound switch (track and thumb, name "Sound", state "On"/"Off" as text too).
- **Bars:** the share found, with a small minimum stub once anything is found (so one find of 128 is still visible); the exact number is always written beside the bar.
- **Today's goal:**
  - `DAILY_GOAL = 3` new places, counted by the phone's local date and stored on the device (`fogwalk:today`, a separate key in debug mode).
  - Only finds that were announced count, so places restored from an earlier visit are not counted again, even when they arrive in the same batch as a new find.
  - It remembers *which* places were found today (by OpenStreetMap id), not how many, so the same place can never count twice, even if two tabs find it.
  - The count rolls over at local midnight even if the app stays open.
  - The find that completes the goal says "Today's goal done" in the message.
- **Quests later:** the ring is one goal slot, and `discovery.ts` takes the goal from one function (`currentGoal()`). When quests arrive (Phase 6) they take over the slot, so there are never two competing goals.
- **Modules:**
  - `src/today.ts` (pure logic plus a small store)
  - `src/flags.ts` (a remembered yes/no)
  - `src/icons.ts` (icons shared by the pins and the card)
  - `countsByGroup` and an acronym fix ("ATM") in `src/places.ts`
  - richer stats from `src/discovery.ts`
  - `focusPlace` in `src/placesLayer.ts`
  - rendering in `src/hud.ts`
  
  Only the existing palette and font are used. `tests/design.test.ts` now also checks that gold is used only by discovery elements (the ring, bars, diamond, pin discs and the find pulse).
- **Deviations from the plan:**
  - The number does not tick up on a find; the ring sweeps instead.
  - The card closes instantly (only opening is animated).
  - The press feedback is a tint, not a scale, per the ui-ux-pro-max rule.
  - The chip's accessible name is its visible text plus ", progress details".
  - `focusPlace` waits for the pan to finish before opening the popup: opening it mid-pan made Leaflet fight the pan and stop the map halfway.
- **Details the review caught:**
  - Tapping "Last" while walking turns off follow-mode (otherwise the next GPS fix pulls the map back), and keyboard focus goes to the chip.
  - The ring is a circle of length 1 (`pathLength`) with its arc hidden at zero, so an empty ring leaves no gold speck, and no number is duplicated between CSS and TypeScript.
  - The goal rolls over at midnight even if the app stays open (re-checked when the app returns to the foreground and once a minute; that check only touches the chip and ring, not the whole map).
  - Two tabs on one device each count: before adding, a tab combines what it knows with what is stored (a union of place ids), so neither wipes the other's finds, a stale tab from yesterday cannot drag today's count down, and one place found in both counts once.
  - On a short screen (a phone on its side) the card scrolls instead of being cut off, and leaves room for the GPS message under it.
  - The ring's arc is a `<path>` (not a `<circle>`), because `pathLength` on circles is not reliable in every browser; it fades in and out as well as sweeping.
  - "Last" only turns off follow-mode when the map really moves to the place, and waits for the pan to finish before opening the name.
  - A very long chip label shortens with an ellipsis, and the count column has room for "128 of 128".
  - The press tint is a background tint, so it never replaces the keyboard focus ring.
  - Each kind of place is classified once and remembered (the stats are refreshed on every cleared fix).
- **Known limits:** I could not reproduce the review's worry that tapping "Last" during another pan stops the map short (Leaflet overrides the early popup's pan), so that ordering is kept for safety but is not separately tested; nothing here was run in Safari or Firefox (only Chrome);  the first-open hint and the chip's starting text in `index.html` say "3 places"; JavaScript replaces them straight away, but if `DAILY_GOAL` changes, update the markup too. Changing the phone's time zone can reset today's count.
- **Tests:** `tests/today.test.ts` and per-group counts in `tests/places.test.ts` (Node), plus a Phase 5b section in `tests/browser.mjs`. Each behaviour was checked by breaking it on purpose.
- Commit message: `feat: daily goal ring and visual stats card`

**6. Simple quests (no AI)** ✅ built, awaiting your check. Branch `feat/add-simple-no-ai-related-side-quests`.
The point is to test whether a quest system sits on the map cleanly, before the open model writes quests (that design lives in `../walking-maxxing`). Two quests, made by code, no AI.

What the map already gives quests, so no new map API is needed:
- Every place in `places.json` has a stable OpenStreetMap id (`placeKey`).
- `discovery.ts` has one goal slot, `currentGoal()`, which the chip and both rings render.
- `discovery.check()` knows every new find and already adds a detail line to the toast when the goal completes. The same path carries "Quest done", so a quest never needs a second toast.
- The finding to record: the earlier idea of an `api.ts` with `where / isRevealed / reached / marker` isn't needed. Quests plug into `discovery.ts` and the goal slot, and "reached" is the same rule as "found".

The quests (they alternate: reach, find, reach, find…):
- **Reach**:
  - Target: a place not yet found, 150–400 m from you. If none is in that band, the nearest unfound place.
  - A quest marker shows the spot through the fog. The name stays hidden until you get there.
  - Done when that place is found, i.e. its cell clears as you arrive (~40 m). There's no separate arrival radius.
  - Chip: "Reach the marked spot, 240 m" (rounded to 10 m). Ring progress is 1 − distance now / distance at start.
- **Find**:
  - "Find 2 new places".
  - Counts announced finds since the quest started, remembered by place id (like `today.ts`), so a reload or a second tab can't count a place twice.
  - Chip: "1 of 2 new places".
- **On completion**:
  - The find toast's detail line says "Quest done", and the ring fills with its check.
  - The next quest starts `QUEST_NEXT_MS` (5 s) later.
- **Gold still means "discovered" only**:
  - The quest marker is a panel-coloured disc with a daylight flag icon.
  - Reaching it brings up the place's normal gold pin and pulse.
  - No new colour, so `tests/design.test.ts` passes unchanged.
- **The daily goal hands the chip to the quest** (one goal at a time). It stays as one line in the stats card: "Today: 2 of 3 places".

Changes:
- `src/quests.ts` (new, pure + small store, like `today.ts`):
  - A `Quest` type: `reach` holds the target id, lat/lng and start distance; `find` holds the number needed and the counted ids. Both have `seq` and `done`.
  - `makeQuest(seq, places, isFound, me)`: the next quest, or `null` if nothing is left.
  - `progress(quest, finds)`: the updated quest.
  - `goalOf(quest, me)`: a `Goal`.
  - `readQuest` / `writeQuest`: validate everything read back and never throw. Key `fogwalk:quest`, plus `:debug`.
- `src/questLayer.ts` (new, like `placesLayer.ts`):
  - `show(quest)` / `clear()`: one marker in the `quest` pane.
  - It uses `L.divIcon`, because bundled Leaflet can't find its default marker image, so a plain `L.marker` shows a broken image.
  - Tapping it says "Quest spot, about 240 m".
- `src/discovery.ts`:
  - Holds the active quest. `currentGoal()` returns the quest's goal, or the daily goal when there's no quest.
  - In `check()`, `fresh` finds go through `progress` before the done comparison, so "Quest done" rides on the existing toast.
  - Starts or restores the quest once places are loaded and there's a position. If a saved target id is gone from `places.json`, it makes a new quest.
  - New `onMove(fix)` refreshes the reach distance.
- `src/main.ts`:
  - `discovery.onMove(fix)` in the precise-fix branch of `onFix`.
  - The debug "reset fog" button also clears the debug quest key.
  - `quest` goes on `window.fogMap` for the browser tests.
- `src/today.ts`, `src/hud.ts`:
  - `Goal` gains `title` ("Today" / "Quest") and `detail` (the card text, today built inside `hud.showGoal` from found/target, which can't describe a reach quest).
  - The card adds the "Today: N of 3 places" line.
- `src/map.ts`: `createPane('quest')` at z 470, above the fog (450) and below places (480) and you (500).
- `src/config.ts`: `QUEST_MIN_M = 150`, `QUEST_MAX_M = 400`, `QUEST_FIND = 2`, `QUEST_NEXT_MS = 5000`, `QUEST_KEY = 'fogwalk:quest'`.
- `src/icons.ts`, `src/style.css`: a flag icon, plus `.quest-pin` built from existing tokens only.
- Tests:
  - `tests/quests.test.ts` in `npm test`. It checks the target band and its fallback, `null` when nothing is left, that the find count ignores repeats, and that a damaged stored value gives `null`.
  - A "Phase 6: quests" section in `tests/browser.mjs`:
    - With `?debug`, a reach quest appears with its marker. Clicking the map at the target walks there; the toast says "Found <name>" / "Quest done", and a find quest follows.
    - A reload keeps the quest and its progress, and reset clears it.

Not doing:
- XP or levels, a quest choice board, AI text.
- Restricting `?debug` to localhost: quests are local only, so faking one only fools yourself. Revisit if anything competitive is added.
- Two tabs: the last quest write wins.

Separate deployment for the branch:
- `deploy.yml` only runs on pushes to `main`, so pushing the branch never touches the live Pages site. GitHub Pages serves one site per repo, so the branch goes to a **Render static site** (set up once in the Render dashboard):
  - repo `surrelsaga/map-mvp`, branch `feat/add-simple-no-ai-related-side-quests`
  - build `npm ci && npm test && npm run build`, publish dir `dist`, env `NODE_VERSION=24`
  - auto-deploy on push
- Static sites are free on Render (the $50 credit stays untouched). They're HTTPS (GPS needs it), and Render is a challenge partner category.
- `base: './'` in `vite.config.ts` already makes the build work at any URL.
- The Render URL is a different origin from github.io, so test walks don't mix with real progress.

Order (the usual loop above):
1. `quests.ts` + `tests/quests.test.ts`.
2. Wiring: discovery, main, pane, marker, hud and the goal.
3. The browser test section.
4. Tests, typecheck, build, browser suite, phone-size screenshots of the chip, marker and toast.
5. `code-review` + `ponytail-review`.
6. Your check at `localhost:3000/?debug`.
7. Commit and push the branch, set up Render, walk it on the phone near SUTD.

Check:
- `npm test`, `npm run typecheck`, `npm run build` and `npm run test:browser` all pass.
- By hand with `?debug`:
  - The marker appears in the fog.
  - Walking there gives "Found X" / "Quest done", and the ring checks.
  - The next quest starts 5 s later.
  - A reload keeps the quest, and reset clears it.
- On the phone at the Render URL, a real walk to the marked spot completes the quest.

As built (small differences from the plan above):
- **`?quests=off`** (a URL switch in `main.ts`) gives the plain map with only today's goal. The earlier browser-test phases run with it (the `open()` helper adds it unless a test passes `quests: true`), so they still test the daily goal exactly as before; only the Phase 6 section turns quests on.
- **A reach target is never a place you are standing next to**: places closer than `REVEAL_RADIUS + 20` m are skipped, because the next step would clear them and the quest would finish at once. When that leaves no reach target (every unfound place is right here), a find quest starts instead of no quest.
- **The first quest needs a first accurate fix** (the position is where the distance is measured from). The first quest starts then, and each later one starts `QUEST_NEXT_MS` after the last finished, or at once on a reload if a finished one was saved. With nothing left to find, the chip goes back to today's goal.
- **A quest whose place was cleared while the page was closed finishes quietly** (no find message), then the next one starts. A saved reach quest whose place is gone from `places.json`, or damaged data, is replaced by the next quest in line.
- **`window.fogMap.quest()`** (copy of the active quest) is for the browser tests, like `snapshot` and `load`.
- **UI** (checked with ui-ux-pro-max): the chip, ring and card are the existing ones, fed by a quest `Goal` (`title`, `label`, `detail` were added to `Goal`; the card line moved from `hud.showGoal` into the goal). The quest spot is a light disc with a dark flag in its own `quest` pane (above the fog, below discovered places): light, not gold, because gold means "discovered", and flag-shaped so it doesn't rely on colour. While a quest holds the chip, the card keeps a quiet "Today: N of 3 places" line. No new colour, so `tests/design.test.ts` is unchanged.
- **Tests:** `tests/quests.test.ts` (Node) and a Phase 6 section in `tests/browser.mjs`: reach then find then nothing left, the distance following you, a reload mid-quest, a quiet completion, damaged saved data, the real data walked in debug mode, reset, and `?quests=off`.
- **Known limits:** there is no skip or reroll: a reach quest aimed at a place you can't walk to (behind a fence or a river) stays until you get there, and is kept across reloads. (Adding a skip is the first thing to build if a real walk hits this.) The quest and the daily goal are separate counts that both see every find. Two tabs: the last quest write wins. A reach quest's ring shows distance walked, so it moves backwards if you walk away from the spot and never below empty. `?debug` is still open on the Pages URL; quests are local only, so faking one only fools yourself.
- **Not verified here:** a real walk to a marked spot on a phone, and the Render deployment below (it needs the dashboard).

Render setup for the branch (one time, in the Render dashboard, **New → Static Site**):
- Repository `surrelsaga/map-mvp`, branch `feat/add-simple-no-ai-related-side-quests`
- Build command `npm ci && npm test && npm run build`
- Publish directory `dist`
- Environment variable `NODE_VERSION` = `24`
- Auto-deploy on push: on

Commit message: `feat: two simple quests (reach a spot, find new places)`

**7. Regions: a 2 km circle that follows you** ✅ built and deployed on Render, committed (branch `feat/load-2km-region-around-current-location`)

Goal: anyone can open the app wherever they are and get places, quests and "% explored" for the 2 km around them. Today all of that only exists for one fixed circle around SUTD. Only one region is ever loaded at a time, never a whole city.

### The idea
A **region** is a 2 km circle of places around a centre. The centre comes from your GPS, and it moves to you each time you walk far enough from it. It doesn't slide with every step.

```
        . - ~ ~ ~ - .            ● centre (your first fix, rounded)
     .'   .-~~~~-.   '.          inner ring: 1.5 km ("still home")
    /   .'        '.   \         outer ring: 2 km (places loaded)
   |   |     ●      |   |
    \   '.        .'  ↗ \        walk past the inner ring  →  new centre where you
     '.   '-~~~~-'   '.            stand, new 2 km circle, toast "New area"
        ' - ~ ~ ~ - '
```

- **First open:** the first accurate fix (the same `MAX_ACCURACY` gate that clears fog) becomes the centre. Places within 2 km are loaded.
- **Walking around:** anywhere within 1.5 km of the centre (`REANCHOR_M`), nothing changes. The place list, "% explored" and the quest stay put.
- **Walking out:** past 1.5 km, the centre moves to where you are and a new 2 km circle loads. Moving at 1.5 km rather than 2 km means at least 500 m of loaded places is always ahead of you. You never reach the edge of an empty map. Once moved, you're at the new centre, so walking back and forth along a line can't make it flip.
- **Coming back:** the last 3 regions are kept on the phone. Any kept region whose centre is within 1.5 km of you is reused: no network, works offline.
- **SUTD:** the shipped `public/places.json` is the SUTD region (centre SUTD, 2 km). It is always read from the file and never stored (see "As built"). Near SUTD the app never asks the server, so `?debug`, the browser tests and offline use behave exactly as today.

Why this shape:
- **One region at a time:** download and storage stay bounded (~27 KB for SUTD, ~190 KB for central Tokyo, ~840 KB for central London, measured), and it works in any city.
- **Re-centre on leaving, not on every step:** a circle that slid with you would refetch constantly, and "% explored" would never hold still.
- **The fog is untouched.** It's a set of cells you walked on a global grid (`fog.ts`), already saved in `localStorage`. Progress storage depends on how much you walk, not on what's loaded, so no backend or database is needed for progress.
- **Ready for AI quests (Phase 8):** each region is a bounded, cached `Place[]`. The quest generator picks candidates from it (`makeQuest`'s 150–400 m band) and the model only writes the quest. Completion stays GPS-based, as now.

### What changes, what doesn't
Not touched: the fog and its saving, today's count (it counts place ids), quest logic (it works on whatever list it gets), and place validation (`parsePlaces`).

| Piece | Today | Phase 7 |
|---|---|---|
| Where places come from | `public/places.json` (SUTD only) | a kept region, or `GET /places` on our Render service the first time a region is entered |
| "% explored" circle | `circleCells(SUTD, AREA_RADIUS)` (`discovery.ts:145`) | the same call, centred on the current region |
| Found places | indexes into the one list | recomputed from the fog for the new list (quietly, no toasts), as on every page load today |
| Found pins on the map | added once | cleared and redrawn for the new list (`placesLayer.clear()`, new) |
| Active quest on a region change | n/a | a find quest carries on; a reach quest whose place isn't in the new list is replaced by the next quest (same rule as `restoreQuest`) |
| Where the map opens | `setView(SUTD)` (`map.ts:8`) | the most recent stored region's centre, falling back to SUTD (`main.ts`); `me.ts` is not changed, because Leaflet already jumps instead of animating when the target is further than the screen |

### Where the places come from: a small Render service
`server/places.ts`, run as `node server/places.ts` (Node 24 runs TypeScript directly, as `tools/fetch-places.mjs` already relies on). Plain `node:http` with no dependencies, no database, no accounts and no user data.

- `GET /places?lat=..&lng=..` returns `{source, fetched, center, radius, places}`, **the same shape as `public/places.json`**. The app parses it with the existing `parsePlaces`, and the seed file is just one more region.
- The server re-rounds `lat`/`lng` to the region grid itself, so it never trusts the client and has a bounded number of cache keys. Out-of-range or non-numeric input gets a 400.
- It asks Overpass with the existing query (same `KINDS`, `SKIP`, User-Agent, two endpoints, 60 s timeout).
- **Cache:** in memory, per region, kept 7 days, at most 100 regions (oldest dropped; see "As built"). Two requests for the same region at once share one Overpass call.
- **Never caches a bad answer:** a failed request, a `remark` (Overpass timeout or out of memory), or a non-array `elements` gives a 502 and nothing is stored. An empty list from a good answer (countryside) is a valid region and is cached.
- Headers: `Access-Control-Allow-Origin: *` (public OSM data, no cookies) and `Cache-Control: public, max-age=86400`. `GET /` answers `ok` for Render's health check. Coordinates are never logged.
- `ponytail:` in-memory cache is lost on every deploy or restart (the next request refetches in a few seconds); Render Key Value if that ever matters. No per-IP rate limit; add one if the endpoint gets abused.

The query and the filter/merge (`KINDS`, `SKIP`, the 100 m same-name merge, the radius check) move out of `tools/fetch-places.mjs` into `src/overpass.ts`, so there is one copy. The server and the tool both import it, and the tool still regenerates the SUTD file. The tool's `MIN_ELEMENTS = 50` sanity check stays in the tool only, since a real region can be nearly empty.

### On the phone
- **Rounding:** the centre is the fix rounded to `REGION_ROUND` = 0.005° (about 550 m, so the centre is at most ~390 m from you). The app rounds **before** sending, so the precise fix never leaves the phone.
- **Kept regions:** one `localStorage` key, `fogwalk:regions:v1`, holding up to 3 `{center, fetched, places}` (most recent first, oldest dropped; the first is the current region; `:debug` added in debug mode, like the other keys). Damaged data reads as "nothing kept". A failed write is logged and the app carries on with the region in memory.
- **On open:** the current region and its places load at once from storage, with no GPS wait and no network. The first fix then applies the 1.5 km rule.
- **While a new region loads:** the old one stays on screen. Only one `/places` request is in flight at a time, retried twice (reusing `loadFile`'s retry shape).
- **If it can't load** (offline on a first visit, server down): the fog still clears, and the stats card says "No places loaded for this area yet". The next try is on a fix at least 60 s later (`REGION_RETRY_MS`). No error dialogs.
- **The message:** a toast "New area · N places within 2 km" when the region changes, using the existing `toast()`. The very first region gets no toast; the stats card shows the count.
- **Server address:** `VITE_PLACES_API`, a build-time env var. It's set to the Render web service URL on the Render static site and to `http://localhost:3001` in a committed `.env.development` (`npm run server` starts it). If it's unset, only the SUTD region and kept regions work.

### Privacy (README and the "why open" write-up must say exactly this)
- Never leaves the phone: the walked path, the fog, finds, quests, and the precise GPS position.
- Sent once per new region to our Render service: a point rounded to about 550 m. Render's platform request logs may record it. The service passes it to Overpass, so Overpass sees our server, not the user's phone or IP.
- The OSM tile server already sees which area is on screen, so this is the same order of disclosure.
- Everything is open and swappable: OpenStreetMap data, Overpass (self-hostable), and our proxy is ~one file.

### Steps
1. **Golden output first:** before moving any code, run today's `fetch-places.mjs` logic on a small hand-written Overpass answer (`tests/fixtures/overpass.json`: a skipped kind, a same-name pair to merge, a way with a `center`, one outside the radius, one without a name). Save the result as the expected output.
2. `src/overpass.ts` (PURE: build the query for a centre; turn an answer into `Place[]` or throw on a bad answer). `tools/fetch-places.mjs` imports it. `tests/overpass.test.ts` checks it against the golden output.
3. `src/region.ts` (PURE + store): `roundCentre(fix)`; `pickRegion(fix, current, kept)` → stay / reuse a kept one / fetch a new one; `keep(kept, region)` (keep 3, most recent first); read and write the store. `tests/region.test.ts`: rounding; the 1.5 km rule just inside and just outside; reuse picks the nearest kept region; the SUTD seed counts as kept; damaged data.
4. `server/places.ts` and `tests/server.test.ts` (starts the server against a fake Overpass on a local port, via an `OVERPASS_URL` env var): the right shape back; the server rounds; two requests make one Overpass call; two at once share one call; 400 on bad input; 502 on a failure and on a `remark`, and the next request tries again; CORS header present. Add both tests to `npm test`, plus an `npm run server` script.
5. `discovery.ts`: `start()` loads the current region from storage (or the seed). `onMove(fix)` (already called with every accurate fix) runs `pickRegion` and calls a new `setRegion(region)`. `setRegion` holds what the `places.json` `.then` handler does today (set `placeList`, quiet `check`, `restoreQuest`/`ensureQuest`), plus resetting `found`, redrawing pins, rebuilding the circle and the toast. `config.ts`: `REGION_ROUND`, `REANCHOR_M`, `REGION_RETRY_MS`, `PLACES_API`.
6. `map.ts`/`me.ts`: open on the current region's centre; first fix jumps without animation. `placesLayer.ts`: `clear()`. `main.ts`: only the changed `discovery.start(...)` call.
7. Browser tests, a Phase 7 section in `tests/browser.mjs` (geolocation override plus request interception on `/places`, answering from the fixture):
   - A fresh profile with a fix in Tokyo makes one request whose `lat`/`lng` are already rounded (the privacy check), loads the places, and centres the map there.
   - A reload with `/places` blocked shows the same places and makes no request.
   - A fix 1.6 km away shows the "New area" toast and makes one request; the earlier fog cells are still there.
   - A fix back near the first centre makes no request.
   - A 502 shows "No places loaded for this area yet", keeps nothing, and the next fix within 60 s makes no request.
   - A fix near SUTD never calls `/places`.
   - All earlier sections pass unchanged.
8. Review loop as for every phase. Then deploy both on Render and do a real check: a phone, plus Chrome DevTools → Sensors with a location outside Singapore.

Render setup (one time, in the dashboard):
- **Web service** (New → Web Service): repo `surrelsaga/map-mvp`, this branch, runtime Node, build `npm ci`, start `node server/places.ts`, `NODE_VERSION` = `24`, plan **Starter** (the free tier sleeps after 15 min and would stall a first region load for up to a minute), health check path `/`.
- **Static site:** the Phase 6 one, switched to this branch, with `VITE_PLACES_API` = the web service's URL.

Known limits (stated, not solved):
- Found pins outside the current region aren't drawn (they come back with that region). "% explored" is per region; regions overlap, so the numbers don't add up across them.
- Kept regions are never refreshed on the phone. `ponytail:` refetch one older than 30 days when online, if stale data shows up.
- A first-ever open with no network has the fog but no places (unless you're near SUTD).
- A dense city centre is large: central London was 8,536 places, ~840 KB per region, so 3 kept regions can take ~2.5 MB of the ~5 MB `localStorage`, next to the fog. A failed write is logged and the region stays in memory only. Lower `REGION_KEEP` or move to IndexedDB if that bites.

Not in this phase: AI quests (Phase 8), drawing the region circle on the map, a place search or "go to another city", a bigger or adjustable radius, prefetching neighbouring regions, self-hosted Overpass, and a persistent server cache.

### As built (differences from the plan above, and what was checked)
- **The shipped SUTD file is never stored.** Only regions that came from the service are kept (`fogwalk:regions:v1`, no second "current" key: the first one is current). `pickRegion` has a fourth answer, `seed`: near SUTD with nothing stored covering you, read `places.json` again. This keeps the earlier browser tests exactly as they were (a test that serves its own `places.json` is not shadowed by a stored copy). When nothing is stored the app reads the seed at start-up, as before, and the first fix then keeps it or swaps it.
- **A region you have left is dropped at once** when it is further than 2 km from you and nothing stored covers you (`clearRegion`), e.g. the SUTD file at start-up when the first fix is in Tokyo. Between 1.5 and 2 km the old region stays on screen until the new one arrives.
- **A place is never announced twice** in one visit: a `seen` set (keys) makes walking back into a region quiet, and stops a find quest counting an old find again.
- **"New area" message** only when you had been inside the previous region's circle (`inside`), so the first region after start-up in a new city gets none.
- **Failures and retries:** a dropped connection to the service is retried (`loadFile`, +1.5 s, +4 s), but a 5xx is not: the service has already tried three Overpass servers, and asking again at once would triple the load on them. After a failure the card says "No places loaded for this area yet" and that same target (a centre, or the seed) is not asked again for `REGION_RETRY_MS` (60 s). **Only loads are gated:** walking back into a stored region, or into SUTD's file, never waits for a failure window or a running load.
- **A load that finishes late is dropped** if it no longer covers you (further than `REANCHOR_M`): e.g. the SUTD file arriving after the first fix in Tokyo. The service has cached it, so asking again is cheap.
- **Empty answers are not stored on the phone** (a throttled Overpass can answer 200 with nothing, and stored regions are never asked again), and the service passes them on but does not cache them. **Stored regions are budgeted** (`REGION_MAX_CHARS`, 2 MB of the ~5 MB `localStorage`): the oldest go first, and a region too big alone is not written, so the fog always has room.
- **Server (`server/places.ts`):** the cache keeps only the gzipped body, which is always sent gzipped (every browser takes it; curl needs `--compressed`), at most 100 regions, a week each. Identical requests share one Overpass call; an expired copy is still served when Overpass is down; three Overpass servers are tried in turn (`overpass-api.de`, `overpass.openstreetmap.fr`, `overpass.kumi.systems`), 45 s each against a 40 s query timeout. It is still an open proxy with CORS `*`, no per-IP limit and no cap on parallel Overpass calls (a `ponytail:` note in the file; a limiter was built and then cut in the over-engineering review). No `OPTIONS` handling: a plain cross-origin GET is never preflighted. **The OSM France mirror was added because the official server and kumi.systems were both down while this was built** (timeouts and 500s), which is the main operational risk of this design: a region nobody has asked for yet needs a working Overpass. A region already cached by the service, or stored on a phone, does not.
- **Measured against live OpenStreetMap data, through the real server:** Singapore (SUTD) 267 places, 4 s; central Tokyo 1,801 places, 189 KB, 8 s; central London 8,536 places, 836 KB, 7 s; a repeat request 1 ms. A real Chrome run (Vite app + this server, Tokyo fix) showed the cross-origin request working, 1,801 places, the region stored (168 KB) and the map centred there.
- **Tests:** `tests/overpass.test.ts` (the filter/merge matches the old tool's output on a fixture; a bad Overpass answer is an error), `tests/region.test.ts`, `tests/server.test.ts` (fake Overpass), and a Phase 7 section in `tests/browser.mjs` (rounded request only, offline reload from the stored region, walking out and back, failure, no request near SUTD). Each was checked by breaking the behaviour on purpose where it mattered (e.g. an unrounded centre fails the browser suite). All earlier browser sections pass unchanged. Two things in the old tests needed care: the two-tab test now reads the merged fog from the tab that wrote last (Chrome shows another tab's `localStorage` writes a moment late, so reading from the first tab raced, and it showed up as soon as a real service was running on :3001); and the Phase 4 "flaky network" test assumes the page loads within the 5.5 s of retry pauses, so it can fail once on a loaded machine (it passed on rerun).
- **Not verified here:** a real walk on a phone, the Render deployment (needs the dashboard), and a long soak. The official Overpass server could not be tried at all.
- **Known limit added:** the service's cache is in memory, so a restart empties it.

Commit message: `feat: load a 2 km region around the current location`

**8. AI quests on the phone** (planned, not built). Decisions below were made after research; nothing is implemented.

Goal: the quest text for a reach quest is written by an open model (Gemma 3 1B) that runs **on the phone** in the browser, so the "why open" story is: open weights, free to run, works offline once downloaded, and no prompt or position leaves the phone. Completion does not change: a reach quest still finishes when the fog clears its place (`quests.progress`).

Decision and why:
- **On-device (WebGPU), not on Render.** Render has no GPUs; Ollama on CPU needs a paid instance with 2 GB or more (Standard, ~$25/month or above) and is slow, and it would send place names and a rough position to our server. The only thing on Render is the places service (Phase 7).
- **Library:** WebLLM first (it ships a prebuilt Gemma 3 1B, listed at ~563 MB download and ~711 MB VRAM, q4f16). Backup: MediaPipe LLM Inference (`.task` file, ~529 MB). Transformers.js is the third choice (no mobile Gemma 3 results found).
- **Limits found in research (not yet tested on our phones):**
  - iPhone Safari kills a tab at roughly 1.5 GB with no error to catch. WebLLM issue #753: a 3B model crashed on iOS 26 and a tiny one worked. 1B should fit; anything bigger will not. Gemma 4 E2B is ~3.2 GB: out.
  - WebGPU: iOS/iPadOS 26 or newer; Chrome on Android 12+ with Qualcomm/ARM GPUs (Chrome 121+); not Firefox on Android. No WebGPU means the fallback below.
  - Speed: one third-party project measured Gemma 3 1B at ~34 tokens/s on an iPhone 17 Pro in Safari (its own engine, not WebLLM), so a short quest is about 1 to 4 s. Unverified for our setup.
  - The first download (~0.5 GB) should be on Wi-Fi, then cached; loading into the GPU takes several seconds each session.
- **Never load the model on page open.** Start it after a tap (a "Make quests smarter" switch or similar), so a model that crashes the tab cannot crash-loop the app. Keep the loaded/not-loaded choice in `localStorage`.

How it plugs in (nothing else changes):
1. `makeQuest` (`src/quests.ts`) already picks reach candidates (unfound places 150 to 400 m away). Hand 5 to 10 of them to the model as `{id, name, type, distance, direction}`.
2. Ask for JSON `{id, text}`: which one to send the walker to, and one or two lines of quest text.
3. **Validate before using it:** `id` must be one of the candidates (never trust coordinates from the model), `text` is plain text with a length cap (set with `textContent`, like place names). Anything else counts as a failure.
4. `Reach` gets an optional `text`; `goalOf` shows it on the chip/card. Parsing (`parseQuest`) accepts and caps it.
5. **Fallback is the Phase 6 quests**: no WebGPU, model not loaded yet, load failed, bad output, or timeout all give today's reach/find quest. The game never waits for the model.
6. Generate ahead of time (when a region loads, or when a quest ends), not on demand while the walker stands waiting.

Steps:
1. **10-minute check first:** open `chat.webllm.ai` on your phone and a teammate's Android, pick Gemma 3 1B, and time the download, the load and a short reply. If it crashes or crawls, the demo fallback is Ollama on a laptop behind a tunnel (not deployed, only for your own walk), and the write-up says so honestly.
2. Spike: load the model in the app behind a button, print one reply. Measure on the phone.
3. Pure pieces first, with Node tests: prompt builder, output validation, the `text` field in `quests.ts`.
4. Wire into `discovery.ts` (`ensureQuest`) with the fallback; browser test with a fake model that returns good, bad and slow output.
5. Review loop as for every phase, then a real walk, then write up.

Open questions: the exact prompt and JSON mode (WebLLM can constrain output, to be checked); whether to tell the user a quest was written by the model; how to show "downloading 40%"; what the screen shows while the model loads.

Not in this phase: a model on the server, photo or vision checks, fine-tuning, more than one quest type written by the model.

## Deployment (Render)
Two Render services from this repo, **branch `feat/load-2km-region-around-current-location`**; `NODE_VERSION=24` on both.

| | Static Site (the app) | Web Service (the places service) |
|---|---|---|
| URL | `https://map-mvp-frontend-v2.onrender.com` | `https://map-mvp-api.onrender.com` |
| Build | `npm ci && npm test && npm run build` | `npm ci` |
| Run | publish directory `dist` | `node server/places.ts` (health check `/`) |
| Env | `VITE_PLACES_API=https://map-mvp-api.onrender.com` (baked in at build: changing it needs a redeploy) | none (Render sets `PORT`) |
| Plan | free | Free sleeps after 15 min and wakes in about a minute with an empty cache; use **Starter** (~$7/month) for demos |

- Checked live: `GET /` gives `"ok"`; `GET /places?lat=1.3413&lng=103.9638` gives 267 places in about 11 s the first time (Overpass), instant when cached.
- **Warm the regions you will show** after every deploy or restart (the cache is in memory): `curl --compressed "https://map-mvp-api.onrender.com/places?lat=<lat>&lng=<lng>"`. The official Overpass server was down while this was built; the service falls back to OSM France's mirror and kumi.systems.
- The `onrender.com` address is fixed when a service is created; renaming the service does not change it.
- **Credits:** the $50 is redeemed under Billing → Credit Balance, in the workspace that owns the services. It is applied at the end of each monthly billing period, not when you start an instance, and a card may still be needed for anything it does not cover. Suspend or delete the web service after the challenge.
- The GitHub Pages workflow on `main` still exists, but it has no places service, so it only works around SUTD.
- Challenge: DEV "Hacktoberfest Open-Source AI Challenge: Week 1" (Touch Grass), tag `#hf26challenge`, **submissions due 2026-10-11 11:59 PM PDT** (2026-10-12 about 3 PM in Singapore). Targets: overall, Best Use of Gemma, Best Use of Render. Writing quality is weighted most; the post must say why open mattered; walking outside with it earns bonus points. More in `../walking-maxxing/CLAUDE.md`.

## Known limits (stated, not solved)
- Mobile browsers pause GPS when the screen locks, so the screen has to stay on while walking. Background tracking is out of scope.
- The standard OSM tile servers are fine for light MVP use. Switch tile provider if usage grows.
- Fog redraw scans every cell in the padded view: ~15k lookups at the default zoom, ~200k at the zoom-15 limit. If it stutters on an old phone, iterate the cleared cells instead of the grid.
- Interpolation between fixes is skipped when the gap was covered faster than 3 m/s, or is over 200 m, so riding a bus doesn't clear a corridor between two fixes. The fixes themselves still clear around them.
- `localStorage` holds about 400k cells (~12 bytes each). Move to IndexedDB if that's ever reached.
- Two tabs open at once: saves are merged, so nothing is lost, but each tab only shows its own cells until it reloads.
- Privacy wording: walked history never leaves the phone, but the map tiles come from OSM, so that server sees roughly which area is on screen. (After Phase 7 our Render service also gets a region centre rounded to about 550 m, once per new region, and passes it on to Overpass. The precise position never leaves the phone. See Phase 7, Privacy.) The "why open" write-up should say exactly that. Leaflet is bundled into the app, so the app itself starts offline (the tiles still need a network).
- Deploys: every push to `main` runs the Pages workflow (needs repo Settings → Pages → Source: GitHub Actions). Built files have content hashes in their names, so a phone never mixes old and new code. If the page says "Something went wrong loading the app", reload.
- `index.html` can't be opened by double-click (browsers block ES modules on `file://`, and the source is TypeScript). Run `npm run dev`.
- `node_modules/` and `dist/` are git-ignored. Commit `package-lock.json`. Pages deploys from the build, not from the repo root.

## Verification (end to end)
1. `npm run dev` (the app) and `npm run server` (the places service on :3001; only needed away from SUTD) → open `localhost:3000/?debug`, walk around SUTD by tapping, and watch the fog clear and places appear. Reload and the progress stays.
2. `npm test` → `ok`, `npm run typecheck` and `npm run build` pass.
3. Open the Pages URL on the phone, walk around SUTD for 10 minutes, and confirm the fog clears along the real route and nearby places are discovered.
