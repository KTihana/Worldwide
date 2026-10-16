# Elsewhere

A private travel atlas with an interactive vector world map, visited countries, photo-filled country outlines, and individual country albums.

## Features

- 241 countries and territories, searchable by name and continent
- Mark a country as visited without uploading photos
- Multiple photos in each country album; select any photo as its map cover
- Full photo viewer with captions, download, and removal
- Optional visit date and travel notes
- Zoomable, pannable SVG map; visited and unvisited filters
- Responsive layouts, keyboard-accessible country finder and modal dialogs
- Account-scoped records in Cloudflare D1 and private photos in R2

Sign-in and the private site audience are managed by Sites. All API operations authorize the authenticated account. Photos are resized to a maximum of 2,400 pixels and saved as WebP on upload; originals are not retained.

## Local development

Requires Node.js 22.13 or newer. Install with the Sites dependency helper (or `npm run install:ci` outside Sites). Build once with `npm run build` to create the local Wrangler configuration, then apply each migration in `drizzle/` once, in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_dear_starjammers.sql
npm run dev
```

Visit `/signin-with-chatgpt?return_to=/` on the local preview to use its development-only test account. Local and production data are separate.

## Verification

```sh
npx tsc --noEmit
node tests/api-smoke.mjs
npm run build
```

The API smoke test runs only on a loopback preview, creates and removes its own photo fixtures, and restores the previous visit data for its test country.

## Geography

Country paths are generated from Natural Earth's public-domain 1:50m Admin 0 dataset using an Equal Earth projection. Run `node scripts/generate-map.mjs` to regenerate them. Country and territory boundaries follow the source dataset and include separately mapped disputed areas.

Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson
