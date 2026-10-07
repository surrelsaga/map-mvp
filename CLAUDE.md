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
- Works without any server of ours. Location history never leaves the device (this is part of the "why open" story).

## Not in MVP
Accounts, sync, sharing, multiple cities, background tracking polish, fog animations.

## Interface the quests need from the map
Side quests are tied to real places, so the map must be able to answer:
- Where is the user now? (lat/lng)
- Is point P revealed? (so quests can target unexplored areas)
- Did the user reach point P? (GPS-based completion check)
- Show a marker at P (quest location).

## Already known
- Place data comes from OpenStreetMap, so use an OSM-based map stack (open tiles, no closed map API as the core).
- Location data is sensitive, so store it locally only.

## Open decisions (plan here)
- Web app vs native/PWA. GPS and "walking with the phone" favour a PWA.
- Map library (e.g. Leaflet or MapLibre) and tile source.
- Fog representation: canvas overlay vs grid cells (e.g. geohash/H3 tiles marked as visited). Grid cells make "is P revealed?" and storage simple.
- Storage: IndexedDB/localStorage.
- How to test without walking: a simulated GPS path / click-to-move debug mode.
