# Phase 9: Gemma writes the quests (on the phone)

Built first on `feat/add-gemma-written-quest-hints` (then still called Phase 7), then moved onto the 2 km region map on `feat/merge-map-with-gemma-quests` (see "On the region map" below). Fixed by the brief: **Gemma runs on the phone, not on a server of ours** (the only server is the places service of Phase 7, which never sees a quest or a prompt). Everything else below was decided here, and each decision says why.

## What it does

- The quest has **its own pill in the top-right corner**: the quest's progress ring around a flag, and what is left to do ("250 m", "1/2", "Done"). The Today button on the left is untouched.
- When a quest starts, which is the moment you **arrive at a place** (a quest finishes, and the next one starts 5 s later), its card opens under the flag. The card has one line of quest text and the exact detail ("Walk to the marked spot on the map, about 250 m away"). Tapping the pill shows the card again; tapping the map closes it. Only one card is open at a time: the Today panel or the quest card.
- **Gemma writes that line**, using where you are ("The player just reached SUTD Canteen") and what the quest is (direction and kind of the hidden place, or the kinds of places still hidden nearby). The card says "Written by Gemma on this phone". When Gemma is off, not loaded yet, or its answer fails the checks, a plain line is used instead ("From SUTD Canteen, head north-east to a cafe spot hidden in the fog.").
- The line is saved with the quest, so a reload keeps it.

## Update: hints, hidden spot, alerts, crowded pins

| What | How | Tunable (`src/config.ts`) |
|---|---|---|
| **Gemma writes a hint** for a reach quest | Gemma now gets the hidden place's **name** and kind ("Toast Box (cafe)") and hints at it without naming it, e.g. "Head south towards the golden arches, where burgers sizzle and smiles abound." An answer is thrown out if it contains a distinctive word of the name (`giveaways`: "Bedok Reservoir Park" bans *bedok* and *reservoir*, not *park*). The model gets **5 tries** (`GEMMA_TRIES`), then the plain line is used. Directions written as "westward" now count. The name stays on the phone, because Gemma runs there. | `LINE_MAX` 120 |
| **The spot starts hidden** | A new reach quest has no map marker. The flag says "Find the hidden spot, 250 m" and the card says "Follow the hint, about 250 m away". | |
| **Can't find it**: the spot gets marked | After 5 minutes of looking, or sooner once you have got at least 60 m closer and then drifted 60 m back out (walked past it, or lost the trail). A message says "The quest spot is on the map", and the flag then says "Reach the marked spot". Checked on every GPS fix and once a minute, so standing still also counts. Quests saved before this update come back already marked. | `QUEST_REVEAL_MS` 5 min, `QUEST_PAST_M` 60 m |
| **Heading away**: an alert | Once you are 1.5 times the starting distance away (and at least 100 m further), you get one message with the way back ("It's about 400 m north") and a vibration. It re-arms once you are back within the starting distance. | `QUEST_FAR_RATIO` 1.5, `QUEST_FAR_MIN_M` 100 m |
| **One POI at a time** | Already the case: one quest, one target, at most one marker. | |
| **Crowded pins** | Found-place pins closer than 22 px on screen form a crowd, and only the newest find in it shows. Zooming in brings the rest back. Recomputed after zooming and after finds. | `CROWD_PX` 22 |

Spike for hints (Gemma 3 1B, 5 places × 3 tries): every answer kept the name out. Most rejected answers had only written "Westward" (now allowed) or dropped the direction. Kinds sometimes blur: Sheng Siong (a supermarket) came out as "a bustling market". The hint comes from the model's general knowledge of the name, so an obscure name can get a vague or slightly wrong hint. That's the reason the spot gets marked after 5 minutes.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Runtime | **Transformers.js 4.3.0** (`@huggingface/transformers`) on **WebGPU** | Google's MediaPipe web runtime was the first pick, but its Gemma 3 web models on Hugging Face are **gated**. The browser would need a Hugging Face login token, and a static site has nowhere to keep one. The only open MediaPipe build (Gemma 4 E2B) is 2 GB. The ONNX Gemma 3 builds are open (no login) and run in Transformers.js. WebLLM stopped at Gemma 2. 4.3.0 rather than 4.3.1, because 4.3.1 was 3 days old. |
| Model | **Gemma 3 1B instruct**, `onnx-community/gemma-3-1b-it-ONNX-GQA`, 4-bit (`q4f16` where the GPU has half precision, else `q4`), about 800 MB | Measured, not guessed (see "Spike results"). The 270M model (about 300 MB) mostly copied the prompt's examples or wrote as the player ("I'm ready to explore!"). 1B gave usable lines. Swapping models is one line in `config.ts` (`GEMMA_MODEL`). |
| Where it runs | On the device's GPU, in the page's main thread | Serverless, and the location never leaves the phone, which is the project's "why open" story. Model files come from Hugging Face's CDN and the ONNX runtime from jsDelivr (the Transformers.js default; the build also copies a 27 MB fallback `.wasm` into `dist`, which nothing fetches). Those requests carry no location or quest data, and the browser caches them after the first time. A Web Worker was skipped: one ~1 s generation per quest doesn't stall the map (`ponytail:` upgrade path if loading ever stutters on a phone). |
| Download | **Opt-in** switch in the stats card ("Gemma writes quests: 800 MB download, runs on this phone"), with progress ("Downloading 42%"). Remembered once on (`fogwalk:gemma`), and loads from the cache on later visits. | 800 MB must never start by surprise over mobile data. |
| No WebGPU | The switch says "Needs WebGPU, which this browser lacks" and is disabled; quests use the plain line | Covers Firefox on Android and older phones. Nothing else changes for them. |
| What Gemma decides | **Only the wording.** Code still picks the quest (reach/find, as in Phase 6), the target and the completion rule. | A 1B model can't be trusted with places or game rules. The GPS check is the truth. |
| What Gemma is told | Where you are (a place you found within `HERE_M` = 100 m), the target's **kind, compass direction and name** (to hint at; the answer must not reveal it, see the update above), or the **kinds of places still hidden nearby** (for a find quest) | Real facts to work with. Without them the model invented "a crumbling shrine" and "the canteen's back room". |
| Prompt shape | Two worked examples as **real chat turns** (user facts, then model answer), then the question | In one message, both models continued the pattern ("The player is out for a walk. Next: …"). As turns, 1B answered with just the quest line. |
| Checks on the answer (`questText.clean`) | First line only; markdown, quotes, emoji and "Quest:" labels stripped. Cut to whole sentences within 90 characters. Rejected if it: contains a number we didn't give (the real distance is shown beside it), names the hidden place, is written as the player (I/me/we), echoes the prompt ("the player", "Next:"), copies an example, drops the reach direction, or (for a find quest) isn't about finding | Each rule comes from a real bad answer in the spike. A rejected answer leaves the plain line in place. |
| Untrusted text | Gemma's line and OSM names only reach the page through `textContent` | Same rule as Phase 4. |

## Spike results (this laptop: Intel GPU, Chrome, WebGPU with half precision)

| | Gemma 3 270M | Gemma 3 1B |
|---|---|---|
| Download | ~300 MB | ~800 MB |
| Load (first time, download included) | ~12 s | ~22–37 s |
| One line | ~0.7 s | ~1.2 s |
| Usable lines | very few: copies the examples, first person, made-up stories | reach 16/16; find lines grounded in the given kinds |

Examples from 1B: "Head north-east to a cafe concealed by the fog.", "Continue south towards a fast food establishment veiled in fog.", "Explore the canteen and seek out a bubble tea or a park nearby."

## Known limits / not done

- **Not yet run on a phone.** Phone GPUs are slower than this laptop, and an 800 MB model may be too big for older iPhones (Safari closes tabs that use too much memory). If it is, set `GEMMA_MODEL` back to the 270M model and accept more plain lines, or wait for a better small Gemma.
- The plain line shows first, and Gemma's replaces it a second or two later.
- Switching Gemma off frees the memory but leaves the 800 MB in the browser's cache (no "delete download" button yet).
- Find lines sometimes say "explore the canteen", meaning go inside; that is allowed but not ideal.
- Pre-existing flake: the Phase 2 "fog beside trail after pan" check and the Phase 4 "several at once" check fail in about 2 of 3 runs on this Windows machine, **on the original code too** (checked). Retrying gets past them.

## On the region map (what changed when it moved onto Phase 7/8)

- **Pill, not a bare flag.** It shows the distance (a reach quest), the count (a find quest) or "Done", so the quest can be read without opening the card. The ring fills as you get closer.
- **A card for each moment.** A new quest opens its card once (when Gemma is loaded, once its line is ready, so the text does not change under the reader). Arriving opens it again with **"Found it: <place>"** and the hint underneath, so the riddle resolves on screen. A first-open bubble holds the card back; the pill is there, and a tap opens it.
- **The card offers Gemma** while it is off and the browser can run it ("Let Gemma write the hints", with the download size). The switch in the Today panel's Settings is where it is turned off.
- **Quests follow regions.** A quest survives a region change when its place is on the new list; otherwise a reach quest is replaced by the next one. While the next region loads, a quest whose place is still within 2 km stays. A saved quest comes back on reload (R used to delete it).
- **Phase numbering:** this is Phase 9. `?quests=off` stays, so the browser tests of the earlier phases run on the plain map.

## Files

- `src/gemma.ts` (new): loads, unloads and runs the model. Transformers.js is a separate chunk, downloaded only when the switch is on.
- `src/questText.ts` (new, pure): the facts, the prompt, the plain line and the checks. Tested in `tests/questText.test.ts` (part of `npm test`).
- `src/discovery.ts`: builds the facts, asks Gemma when a quest starts, saves the line on the quest, drives the flag.
- `src/hud.ts`, `index.html`, `src/style.css`: the quest pill, its card (with the Gemma offer), the switch, one-card-at-a-time.
- `src/main.ts`: the switch (load, progress, errors, remembered on).
- `src/quests.ts`: `text` on a quest, validated on read. `src/config.ts`: `GEMMA_*`, `HERE_M`, `LINE_MAX`. `src/flags.ts`: a flag can be turned off.
- `tests/browser.mjs`: the Phase 9 section (quests, regions, the card, the pill at 390 and 320 px, the switch and no WebGPU); the earlier sections run with `?quests=off`. `GEMMA=1 npm run test:browser` also runs the real model end to end.

## Check it

```
npm install && npm run dev
# open http://localhost:3000/?debug, tap the chip, turn on "Gemma writes quests", wait for the download,
# then tap the map to walk to the flag's spot: the next quest's card opens with Gemma's line.
npm test && npm run typecheck && npm run test:browser          # GEMMA=1 for the real model too
```
