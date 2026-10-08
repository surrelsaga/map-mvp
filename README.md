# Fog Walk map

A map of your neighbourhood covered in fog. The fog clears wherever you walk, and progress stays on your device.

## Run it

```
npm install
npm run dev        # http://localhost:3000
```

Open `http://localhost:3000/?debug` and tap the map to walk without leaving your desk (`?debug=10` walks 10× faster).
`index.html` can't be opened by double-click: browsers block ES modules on `file://`, so use the dev server.

Real GPS needs HTTPS (or localhost). To test it on a phone, use the deployed page.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm test` | fog logic tests (plain Node, no framework) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | type-check, then build to `dist/` |
| `npm run preview` | serve the built `dist/` |

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml` (test, build, publish to GitHub Pages).
One-time setup, **before the first push of this setup**: repo **Settings → Pages → Source: GitHub Actions**. Until then Pages would publish the raw repo files, and the page would be blank because browsers can't run `.ts`.

See `PLAN.md` for the architecture and build phases.
