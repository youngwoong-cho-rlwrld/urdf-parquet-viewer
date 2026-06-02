# URDF Parquet Viewer

Minimal React Three Fiber viewer for URDF robots driven by Parquet frame data.

## Run

```bash
npm install
npm run dev
```

The app starts with the default assets in `public/assets/default`.

## Scripts

```bash
npm run build
npm run verify:fk
npm run generate:groups
```

`verify:fk` compares the viewer FK path against `fk_html_handoff` reference coordinates when that sibling directory is present.
