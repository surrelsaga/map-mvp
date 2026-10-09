# Fog Walk map

A map of your neighbourhood covered in fog. The fog clears wherever you walk, and progress stays on your device.

## Run it

```
npm install
npm run dev        # http://localhost:3000
```

Open `http://localhost:3000/?debug` and tap the map to walk without leaving your desk (`?debug=10` walks 10× faster). Debug walks are saved separately from real ones; the **reset fog** button in the red badge clears them.

The **Today** button (top left) opens one panel: today's goal, what you have found, and the settings (sound). A **quest pill** (top right) holds the quest: a hint about a real place hidden in the fog, and how far away it is. Walk to find it; if you are lost it is marked on the map after a while. The hint is written by **Gemma 3 1B running on your phone** (switch it on in the Today panel, or from the quest card: an 800 MB download, best on Wi-Fi; it needs WebGPU). Without it you get a plain line instead.

Progress is saved in the browser's `localStorage`, on your device only. So are the stored regions and the sound on/off choice.
`index.html` can't be opened by double-click: browsers block ES modules on `file://`, so use the dev server.

Real GPS needs HTTPS (or localhost). To test it on a phone, use the deployed page.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm test` | logic tests for fog, storage, places, regions, Overpass parsing and the places service, plus the palette's contrast (plain Node, no framework) |
| `npm run server` | the places service (see below) |
| `npm run test:browser` | headless-Chrome regression suite; start `npm run dev` first (needs Chrome; set `CHROME=` if it isn't in the usual macOS place) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | type-check, then build to `dist/` |
| `npm run preview` | serve the built `dist/` |

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml` (test, build, publish to GitHub Pages).
One-time setup, **before the first push of this setup**: repo **Settings → Pages → Source: GitHub Actions**. Until then Pages would publish the raw repo files, and the page would be blank because browsers can't run `.ts`.

The `feat/add-simple-no-ai-related-side-quests` branch is deployed separately from `main` as a Render static site (build `npm ci && npm test && npm run build`, publish `dist`, `NODE_VERSION=24`); see `PLAN.md` phase 6. Its progress lives on its own address, apart from the Pages site.

## Places and regions

The app shows the places inside a **2 km region around where you are**. The region's centre is your first accurate GPS fix, rounded to about 550 m. Walk more than 1.5 km from the centre and a new region is loaded around you (you get a "New area" message). The last 3 regions stay on your phone, so coming back needs no network.

Places come from OpenStreetMap through a small service in `server/places.ts` (no database, no accounts, no user data). Near SUTD the app uses the file shipped in `public/places.json` and never asks the service.

```
npm run server                       # the places service on http://localhost:3001 (npm run dev points at it via .env.development)
node tools/fetch-places.mjs          # regenerates public/places.json (the SUTD region)
```

On Render the service is a Web Service (build `npm ci`, start `node server/places.ts`, `NODE_VERSION=24`, health check `/`), and the static site gets the environment variable `VITE_PLACES_API` set to its URL. Without it, only SUTD and already-stored regions work.

**What leaves your phone:** your walked path, fog and finds never do. For each new region, the service receives one point rounded to about 550 m (never your precise position) and asks OpenStreetMap's Overpass API for the places within 2 km. The service itself does not log it, but the point is part of the request address, so the hosting platform's request logs (Render's) may record it together with your IP address. The map tiles come from OpenStreetMap too, which sees roughly which area is on screen. If you switch Gemma on, the model files are downloaded once from Hugging Face and the runtime from jsDelivr; those requests carry no location or quest data, and the model then runs on your phone.

Place data © OpenStreetMap contributors, ODbL.

See `PLAN.md` for the architecture and build phases.
