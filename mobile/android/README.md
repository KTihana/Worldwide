# Worldwide for Android

Install `../../releases/Worldwide-Android.apk` on Android 8.0 or newer. It opens your own local travel album; no account or computer is needed to add photos, mark visits, adjust covers, or write notes.

## Optional computer sync

On your computer, open **Your album → Connect phone**. On Android, open **Your album → Connect computer → Scan computer QR**. Use the same Wi-Fi. The same QR works in the Android app or the phone browser.

Both apps keep their own albums. Connecting combines your photos and visits, then syncs changes both ways. Offline phone edits wait safely for the next connection. If the same field was changed on both devices while apart, the waiting phone edit is applied when syncing; edits to different fields are retained. Disconnecting keeps the phone album. An album already linked to another account is kept separate to prevent sharing it accidentally.

Install updates over the existing app to keep photos. **Your album → App updates** checks for Android updates without needing a computer. The map stays horizontal; connecting and sign-in use an upright screen.

## Home-screen map widget

Install the updated APK over the existing app, then long-press an empty part of your Android home screen and choose **Widgets → Worldwide → Worldwide map**. Drag it onto the wallpaper and resize it as you like. The widget has a transparent background.

Tap a country to reveal a photo and its fitted silhouette. Widely scattered territories focus on their main island group. Tap the photo to change memories; the back chevron returns to the world. The forward chevron browses countries with cached photos, falling back to the country catalogue when the album is empty. The globe opens Worldwide. Each widget keeps its own selection. Small country targets have the larger forward control as an alternative.

The wallpaper remains visible through the map and around the photo. Typography uses Android’s system sans, a 22–26sp title and 12sp supporting text. Controls have 48dp targets. The country reveal uses a single 180ms fade, with a static fallback when system animation is disabled; there is no idle animation or timer. Android 12+ gets exact launcher sizes and wallpaper-aware text, with portrait/landscape layouts on older versions. This is an Android implementation of the hierarchy and restraint in Apple’s [Widgets](https://developer.apple.com/design/human-interface-guidelines/widgets), [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), and [fluid interface guidance](https://developer.apple.com/videos/play/wwdc2018/803/), informed by the public [Frontend Design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md). It does not emulate live wallpaper blur or continuous map gestures.

The native widget works offline and refreshes after the app saves changes. The chosen cover and saved photo crop are respected. If a cover has not downloaded, another cached photo is used. Disconnecting computer sync keeps your local photos and widget.

Verify with `node tests/android-widget.mjs` after `npm run build` and `npm run android:sync`. Tests use only `app.worldwide.widgettest` on an emulator and synthetic coastal illustrations, never personal photos. They cover real taps, cover ordering, photo cycling, privacy, independent widgets, motion/static layouts, resizing and large text. Nine density-correct previews and their fixture manifest are written to `/tmp/worldwide-widget-*.png` and `/tmp/worldwide-widget-previews.json`.

## Build

Install Node.js, Java 21, and the Android SDK with platform API 36 and build tools 36.0.0. Android Studio can install the SDK. Set `JAVA_HOME` and `ANDROID_HOME` if they are not in a standard location.

From the `elsewhere` application directory:

```sh
npm ci
npm run build
npm run android:build
```

The first build downloads Gradle and Android build dependencies from their official repositories. The output is `releases/Worldwide-Android.apk`. Build tooling does not use or include your album. Bundled assets come only from `dist/`.

The build creates a private signing key at `data/build-keys/worldwide-android.p12` and its password file beside it. These files are ignored by Git and never included in the installer. **Back up this directory privately**: future APK updates need the same key. This is a personally signed sideload build, not a Play Store release or a publisher-verified distribution.

## Native smoke test

Start an Android emulator, then run from the application directory:

```sh
npm run build
npm run android:sync
node tests/android-native.mjs
```

The test uses temporary PC albums and the separate `app.worldwide.nativetest` package on an emulator. It checks standalone editing, legacy photo migration, restart persistence, the actual PC QR, offline changes, two-way sync, duplicate prevention, disconnect retention, and separation of accounts with identical emails. It never touches `data/` or the installed Worldwide album.

## Implementation

The Android wrapper serves bundled files at an internal HTTPS origin and blocks external page navigation. Only that trusted app can access the native bridge. Album edits go to the phone’s private SQLite database and durable sync queue first. Optional background sync contacts the configured computer; the bridge supplies its origin, stores its session cookie privately, and never exposes the cookie to JavaScript. HTTP connections are limited to local IPv4 addresses; separately configured remote servers must use HTTPS. Redirects and invalid certificates are rejected.

Photos, metadata, and pending edits are stored in Android’s private application directory. Cloud backup is disabled. Generation guards cancel stale writes when signing out or changing computers. The app uses the platform WebView and standard Android APIs. The QR camera uses bundled JourneyApps ZXing Embedded 4.3.0 with ZXing Core 3.5.3 (Apache 2.0). Camera frames are decoded on the phone and are never uploaded or saved. Camera permission is requested only when you open the scanner. Pairing sends only the one-use token to the scanned computer; previous credentials are never sent there. The new session and computer address are committed only after a valid successful response.

References: [ZXing Android Embedded](https://github.com/journeyapps/zxing-android-embedded), [Android local web content](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content), [Android Gradle compatibility](https://developer.android.com/build/releases/about-agp).

## In-app updates

Open **Your album → App updates → Check for updates**, then choose **Install update**. Worldwide downloads only the Android installer from the official `KTihana/Worldwide` GitHub release. The first time, Android may ask you to allow updates from Worldwide: enable it, return to Worldwide, and tap **Install update** again. Confirm **Update** in Android's installer. Canceling leaves the current app intact.

Updates replace the installed app without uninstalling it. The account, computer connection, and downloaded photos remain in the same private app directory. The installer must have the same application ID and signing key, a higher Android version code, and the advertised version; otherwise Worldwide refuses it. Downloads have size limits, accept only trusted HTTPS release redirects, and check GitHub's SHA-256 digest when available. The update provider can share only temporary installers, never album files. No album data or account credentials are sent to GitHub.

Older builds that predate the updater need one manual APK update to gain this button. Install it over the existing app; do not uninstall. Keep using the original private signing key for every release, increase `versionCode`, and match `versionName` to the GitHub release tag. Publish a stable release with an asset named `Worldwide-Android.apk`.

Run `node tests/android-updates.mjs` with a dedicated emulator to verify trusted-release validation, signing-key rejection, version/downgrade rejection, size/checksum failure, private FileProvider scope, and actual in-place APK replacement retaining account preferences and offline photo bytes. This uses the separate `app.worldwide.updatetest` package with temporary signing fixtures, never uninstalls an app, and does not touch the real Worldwide account. Production builds must omit the test-only `worldwideUpdateTest` Gradle property.
