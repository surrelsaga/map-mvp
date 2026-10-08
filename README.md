# Walk-maxxing

A map of your neighbourhood covered in fog. The fog clears wherever you walk, and progress stays on your device.

## Run it

```
npm install
npm run dev        # http://localhost:3000
```

Open `http://localhost:3000/?debug` and tap the map to walk without leaving your desk (`?debug=10` walks 10× faster). Debug walks are saved separately from real ones; the **reset fog** button in the red badge clears them.

Progress is saved in the browser's `localStorage`, on your device only. So is the sound on/off choice.
`index.html` can't be opened by double-click: browsers block ES modules on `file://`, so use the dev server.

Real GPS needs HTTPS (or localhost). To test it on a phone, use the deployed page.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm test` | logic tests for fog, storage, places and coverage, plus the palette's contrast (plain Node, no framework) |
| `npm run test:browser` | headless-Chrome regression suite; start `npm run dev` first (needs Chrome; set `CHROME=` if it isn't in the usual macOS place) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | type-check, then build to `dist/` |
| `npm run preview` | serve the built `dist/` |

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml` (test, build, publish to GitHub Pages).
One-time setup, **before the first push of this setup**: repo **Settings → Pages → Source: GitHub Actions**. Until then Pages would publish the raw repo files, and the page would be blank because browsers can't run `.ts`.

## Places

Places to discover come from OpenStreetMap, fetched once into `public/places.json` (so the app itself never contacts OpenStreetMap's data servers; only the map tiles come from there):

```
node tools/fetch-places.mjs
```

Place data © OpenStreetMap contributors, ODbL.

See `PLAN.md` for the architecture and build phases.
