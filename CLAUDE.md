# Map MVP (fog-of-war map for Fog Walk)

Part of Fog Walk, a Hacktoberfest "Touch Grass" entry (see `../walking-maxxing/CLAUDE.md`). Side-quest planning happens over there. This folder is only the map.

## Idea
A map of your neighbourhood covered in fog. The fog clears wherever you physically walk, and cleared areas stay unlocked. The map is the "game board"; the side quests (separate piece) pull you onto unexplored parts of it.

The screen should be the shortest part of the experience. The map is glanced at, not stared at.

## MVP scope
- Show a map centred on the user's live GPS position.
- Cover everything with fog.
- Reveal a circle around the user as they move (radius is a tunable constant, roughly 30-50 m).
- Persist revealed areas on the device, so reopening the app keeps the progress.
- Fog, progress, finds and quests live only on the device; location history never leaves it (part of the "why open" story). The one server is a small places service on Render (Phase 7) that is told a point rounded to ~550 m, once per new region, and returns nearby places from OpenStreetMap. No accounts, no database.

## Not in MVP
Accounts, sync, sharing, background tracking polish, fog animations. (Other cities now work: the 2 km region follows you, Phase 7.)

## Interface the quests need from the map
Side quests are tied to real places, so the map must be able to answer:
- Where is the user now? (lat/lng)
- Is point P revealed? (so quests can target unexplored areas)
- Did the user reach point P? (GPS-based completion check)
- Show a marker at P (quest location).

How quests actually hook in (Phase 6, `PLAN.md`): through `discovery.ts` and its goal slot, with "reached" being the same rule as "found". No separate quest API.

## Already known
- Place data comes from OpenStreetMap, so use an OSM-based map stack (open tiles, no closed map API as the core).
- Location data is sensitive, so store it locally only.

## Stack (decided)
Web app, Leaflet + OSM tiles, fog as grid cells on a canvas overlay, localStorage, a click-to-walk `?debug` mode. Vite + TypeScript. Deployed on Render: a static site for the app plus one web service for places (`server/places.ts`); the GitHub Pages workflow on `main` still exists but has no places service. Run it with `npm install && npm run dev` (add `npm run server` away from SUTD). Architecture, build phases and the Render setup are in `PLAN.md`.

## Where things stand
Phases 0 to 7 are built (fog, saved progress, places, UI, two no-AI quests, 2 km regions around you). **Next: Phase 8, AI quests with Gemma 3 1B running on the phone via WebGPU** (planned in `PLAN.md`, not built). Challenge deadline is 2026-10-11 11:59 PM PDT; see `PLAN.md` "Deployment" and `../walking-maxxing/CLAUDE.md`.

## Open decisions (plan here)
- Web app vs native/PWA. GPS and "walking with the phone" favour a PWA.
- Map library (e.g. Leaflet or MapLibre) and tile source.
- Fog representation: canvas overlay vs grid cells (e.g. geohash/H3 tiles marked as visited). Grid cells make "is P revealed?" and storage simple.
- Storage: IndexedDB/localStorage.
- How to test without walking: a simulated GPS path / click-to-move debug mode.
