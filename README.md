# Worldwide — your private travel album

A fullscreen travel map and photo album with one private account. Your computer stores the visits and photos; sign in from your computer and phone to use the same album. No GPT, ChatGPT login, or cloud storage is used.

## Start and create your account

Double-click **Start Worldwide.command** in the parent folder, or run:

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3000** on the computer running the server. Create your account with your email and a password of at least 12 characters. Save the recovery code in your password manager; there is no email reset service. Your existing album is attached to the account in place, without moving or deleting photos.

Only the first private account can be created, and setup is allowed from the server computer's loopback address. Each device has its own session. Sessions expire after 30 days. Signing out affects that device; password recovery revokes all old sessions and issues a replacement recovery code.

## Install on Windows and Android

Build outputs are in `releases/desktop/` and `releases/`:

- `Worldwide-Setup-0.1.0-x64.exe`: Windows installer (64-bit Windows).
- `Worldwide-Portable-0.1.0-x64.exe`: Windows portable app.
- `Worldwide-Android.apk`: Android app; see `mobile/android/README.md` for installation instructions.

These are local development builds, not Microsoft Store or Google Play releases. Windows builds are not publisher-signed. Android uses a local signing key; retain that key to install future updates over this version.

1. Install and open Worldwide on Windows. Create your private account and save its recovery code.
2. Install the Android APK on your phone.
3. Connect both devices to the same Wi-Fi. On Windows, open **Your account → Connect Android**.
4. Enter the displayed computer address in the Android app and sign in with the same account.
5. Wait for **Your account → Saved on this device** to say the map and photos are ready offline.

Android opens in landscape and bundles the map. After sync, it stores photos in the app's private local storage, so the album opens without Wi-Fi or the computer. Sign-out removes that device's offline album. Editing and new sync require the computer to be awake with Worldwide running. If its network address changes, use **Your account → Change computer** on Android.

The native phone connection uses HTTP on your private local network; it requires no certificate installation. Keep it on trusted Wi-Fi. Remote access is separate and is not enabled. HTTPS connections can be configured separately with a trusted certificate; certificate validation is never bypassed.

Windows may ask to allow local network access. Use the private home network profile. Guest Wi-Fi networks may isolate devices. The desktop app continues syncing when its window is minimized; quitting it stops its server. See [desktop setup](desktop/README.md) and [Android setup](mobile/android/README.md).

**Sync works both ways:** photos uploaded and changes saved on Android appear on the computer, and computer changes appear on Android. Changes refresh on other visible devices about every five seconds and when returning to the app. Unsaved note drafts are preserved. Concurrent edits to the same field use the last saved change. Offline editing is disabled; changes are not silently queued.

## Existing album and browser access

The source project keeps its existing `data/` folder. Installed desktop apps use their own app-data folder unless you choose **File → Choose album folder**. To move the current album to Windows, stop its server and copy the entire `data/` folder, then select the copied folder in Worldwide. Do not copy just the photos or just the database.

The web interface remains at **http://127.0.0.1:3000** on the host computer and shares the same account and album. The Mac source launcher remains available as **Start Worldwide.command**. The old launcher name still works.

Browser home-screen installation also remains supported. Offline browser use requires a trusted HTTPS address. `node scripts/prepare-phone-https.mjs` prepares a local certificate; native Android does not need this. Existing `ELSEWHERE_*` environment variable names are kept for compatibility.

For a separately configured HTTPS reverse proxy, set `ELSEWHERE_PUBLIC_ORIGIN=https://your-private-address`. Initialize the account locally first. `ELSEWHERE_BIND=127.0.0.1` limits the server to this computer when appropriate.

## Your data

- Visits, notes, accounts, and sessions: `data/atlas.sqlite`
- Photos: `data/uploads/`
- Back up the entire `data/` folder while the server is stopped.
- Photos are resized to at most 2,400 pixels and stored as WebP; keep originals separately.
- Passwords use salted scrypt hashes. Session tokens are stored hashed and sent in HttpOnly, SameSite cookies; HTTPS deployments use Secure cookies.
- The older hosted album is separate and is not uploaded, downloaded, or deleted automatically.

Choose another data directory or port with:

```sh
ELSEWHERE_DATA_DIR=/absolute/path/to/album PORT=3001 npm start
```

## Map and photos

Choose a continent, click a country, and use its Visited checkbox or add photos. Country search also has a checkbox beside each result. Search, visited filters, albums, captions, dates, and notes are supported.

**Save map** downloads a 4000 × 2400 PNG of the world, a continent, or a country. **Adjust photo** lets you drag and zoom a cover inside its outline; saved framing is shared across devices.

## Development and checks

Run `npm start` for the API, then `npm run dev` for the Vite UI. The development proxy uses port 3000.

```sh
npm run check
npm test
npm run build
```

Integration tests use a temporary database. They cover account protection, legacy album preservation, two independent device sessions, shared photos/edits, restart persistence, recovery, and landscape framing.

## Geography

Natural Earth's public-domain 1:10m dataset provides the country paths, replacing the earlier 1:50m outlines. Full geometry is bundled as individual files in `public/geography/` and loaded before opening a country; photo clipping, framing, and country exports use that detailed outline. Overview maps use shared-arc simplification to stay responsive, preserving small countries and islands. Country IDs stay compatible with existing albums.

Source: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/ — the full GeoJSON was obtained from https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson and filtered to the existing country catalog. These are cartographic boundaries, not cadastral or street-level surveys.

Run `node scripts/prepare-country-outlines.mjs`, `node scripts/generate-map.mjs`, `GENERATE_TERRAIN=1 node scripts/generate-focus.mjs`, and `GENERATE_TERRAIN=1 node scripts/generate-projections.mjs` to regenerate geometry and matching terrain. Boundaries follow that source, including separately mapped disputed areas. France's close-up shows metropolitan France; its full geography remains on the world map.

Natural Earth is the default world map. Choose **Map style** for 11 world projections with visual previews. The choice is saved with your account and used for world PNG exports. Continent and country close-ups keep their dedicated views. All projection outlines are bundled locally; no map service or API key is needed. Regenerate them with `node scripts/generate-projections.mjs`.

Terrain colours use Natural Earth II with shaded relief (public domain), resampled locally into four flat colours with fine relief texture removed. Vegetation, deserts, mountains, and ice follow the source geography; this is an illustrative physical basemap, not a current vegetation or elevation survey. Source: https://www.naturalearthdata.com/downloads/50m-raster-data/50m-natural-earth-2/ and https://naturalearth.s3.amazonaws.com/50m_raster/NE2_50M_SR.zip . The reduced source is `scripts/terrain-source.png`. Regenerate the bundled local terrain with `GENERATE_TERRAIN=1 node scripts/generate-projections.mjs` and `GENERATE_TERRAIN=1 node scripts/generate-focus.mjs`. No online map requests are made by the app.
