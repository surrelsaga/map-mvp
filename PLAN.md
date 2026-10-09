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
  hud.ts            the goal chip, the stats card it opens, the sound switch, the first-open hint   ✅ phase 4/5/5b
  today.ts          PURE + store: today's finds and the daily goal   ✅ phase 5b
  flags.ts          a remembered yes/no (hint dismissed)   ✅ phase 5b
  icons.ts          pin icons shared by the map and the stats card   ✅ phase 5b
  sound.ts          the found-chime (WebAudio, unlocked on first tap)      ✅ phase 5
  quests.ts         PURE + store: the two test quests (reach, find), next-quest pick, progress, the quest's goal   ✅ phase 6
  questLayer.ts     the quest marker (Leaflet divIcon in the `quest` pane)   ✅ phase 6
  questText.ts      PURE: the quest line: what Gemma is told, the checks on its answer, the plain line   ✅ phase 7
  gemma.ts          Gemma 3 1B on the phone's GPU (Transformers.js, WebGPU), opt-in   ✅ phase 7
                    (no api.ts: quests plug into discovery.ts and its goal slot, so no outside interface is needed)
  main.ts           wiring: sources -> onFix -> [me, fog, storage, places, hud]
public/places.json  `{source, fetched, center, radius, places:[{id,name,type,lat,lng}]}` (committed)   ✅ phase 4
tools/fetch-places.mjs   run once on the laptop: Overpass query -> public/places.json
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

**7. Gemma writes the quests** ✅ built, awaiting your check. Branch `feat/add-gemma-written-quest-hints`. Decisions, spike results and limits: [`GEMMA.md`](GEMMA.md).
