# Worldwide for Android

The personal Android installer is `../../releases/Worldwide-Android.apk`. It supports Android 8.0 and newer, opens upright for sign-in, switches the map to landscape, and bundles the complete map. It connects directly to the Windows app on your computer. No cloud account, certificate installation, or external service is involved.

## Install and connect

1. Copy `Worldwide-Android.apk` to your Android phone and open it. Android may ask you to allow installation from the app you used to open the file.
2. Keep Worldwide running on your computer. Open **Your album → Connect Android** to show a QR code.
3. Connect your phone to the same Wi-Fi, open Worldwide, and tap **Scan computer QR**. Allow camera access when asked and scan the computer screen. You are signed in automatically; no address or password typing. The code expires after three minutes and works once. The phone’s system camera can also open a `worldwide://pair` link in the installed app.
4. In **Your album**, wait for **Saved on this device** to show the map and every photo are ready. You can then reopen the installed app and view them without Wi-Fi or the computer.

**Enter address instead** remains available if the camera cannot be used. It connects to the computer address shown in the desktop account panel, then lets you sign in with the same account password.

Forgot your password? On the computer, choose **Forgot password?** and set a new password. Your photos stay in place. Then show a new QR code to reconnect your phone. A failed or expired QR never clears the phone’s existing account or saved photos.

Changes and uploads need a connection to the computer. The offline album is read only. The app automatically checks for changes while open. It does not promise background sync after Android closes it. **Change computer** is available on the connection, sign-in, and account screens. Connecting a different computer clears the phone's previous album copy. Signing out removes cached private photos and the local session. Uninstalling or clearing Android app data also removes the phone copy; the computer's album is preserved.

The normal Android file picker handles photo uploads. Saving a map or photo opens Android's save dialog. No broad photo-library or storage permission is required.

## Home-screen map widget

Install the updated APK over the existing app, then long-press an empty part of your Android home screen and choose **Widgets → Worldwide → Worldwide map**. Drag it onto the wallpaper and resize it as you like. The widget has a transparent background.

Tap a country to reveal a photo and its fitted silhouette. Widely scattered territories focus on their main island group. Tap the photo to change memories; the back chevron returns to the world. The forward chevron browses countries with cached photos, falling back to the country catalogue when the album is empty. The globe opens Worldwide. Each widget keeps its own selection. Small country targets have the larger forward control as an alternative.

The wallpaper remains visible through the map and around the photo. Typography uses Android’s system sans, a 22–26sp title and 12sp supporting text. Controls have 48dp targets. The country reveal uses a single 180ms fade, with a static fallback when system animation is disabled; there is no idle animation or timer. Android 12+ gets exact launcher sizes and wallpaper-aware text, with portrait/landscape layouts on older versions. This is an Android implementation of the hierarchy and restraint in Apple’s [Widgets](https://developer.apple.com/design/human-interface-guidelines/widgets), [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), and [fluid interface guidance](https://developer.apple.com/videos/play/wwdc2018/803/), informed by the public [Frontend Design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md). It does not emulate live wallpaper blur or continuous map gestures.

Open Worldwide and let **Saved on this device** finish once. The native widget then works offline and refreshes after the app saves changes. The chosen cover and saved photo crop are respected. If a cover has not downloaded, another cached photo is used. Signing out or changing computers clears private photos and selections from the widget.

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

The test creates a separate temporary server and album, installs the debug app and instrumentation package, and checks real account login, cookie persistence, PATCH visits and photo crops, multipart photo uploads, local photo persistence, disconnected album access, sign-out cleanup, server address restrictions, actual PC QR decoding, camera result/cancellation handling, deep-link validation, single-use pairing, preservation of the previous account on failure, and paired offline identity. It does not use `data/` or the real account. The emulator's Worldwide test app is reset by the test. Use a dedicated emulator, never a personal device with a real Worldwide album.

## Implementation

The Android wrapper serves bundled files at an internal HTTPS origin and blocks external page navigation. Only that trusted app can access the native bridge. API calls go directly to the configured computer; the bridge supplies the computer's origin, stores its session cookie privately, and never exposes the cookie to JavaScript. HTTP connections are limited to local IPv4 addresses; separately configured remote servers must use HTTPS. Redirects and invalid certificates are rejected.

Photos and the album snapshot are stored in Android's private application directory. Cloud backup is disabled. Generation guards cancel stale writes when signing out or changing computers. The app uses the platform WebView and standard Android APIs. The QR camera uses bundled JourneyApps ZXing Embedded 4.3.0 with ZXing Core 3.5.3 (Apache 2.0). Camera frames are decoded on the phone and are never uploaded or saved. Camera permission is requested only when you open the scanner. Pairing sends only the one-use token to the scanned computer; previous credentials are never sent there. The new session and computer address are committed only after a valid successful response.

References: [ZXing Android Embedded](https://github.com/journeyapps/zxing-android-embedded), [Android local web content](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content), [Android Gradle compatibility](https://developer.android.com/build/releases/about-agp).

## In-app updates

Open **Your album → App updates → Check for updates**, then choose **Install update**. Worldwide downloads only the Android installer from the official `KTihana/Worldwide` GitHub release. The first time, Android may ask you to allow updates from Worldwide: enable it, return to Worldwide, and tap **Install update** again. Confirm **Update** in Android's installer. Canceling leaves the current app intact.

Updates replace the installed app without uninstalling it. The account, computer connection, and downloaded photos remain in the same private app directory. The installer must have the same application ID and signing key, a higher Android version code, and the advertised version; otherwise Worldwide refuses it. Downloads have size limits, accept only trusted HTTPS release redirects, and check GitHub's SHA-256 digest when available. The update provider can share only temporary installers, never album files. No album data or account credentials are sent to GitHub.

Older builds that predate the updater need one manual APK update to gain this button. Install it over the existing app; do not uninstall. Keep using the original private signing key for every release, increase `versionCode`, and match `versionName` to the GitHub release tag. Publish a stable release with an asset named `Worldwide-Android.apk`.

Run `node tests/android-updates.mjs` with a dedicated emulator to verify trusted-release validation, signing-key rejection, version/downgrade rejection, size/checksum failure, private FileProvider scope, and actual in-place APK replacement retaining account preferences and offline photo bytes. This uses the separate `app.worldwide.updatetest` package with temporary signing fixtures, never uninstalls an app, and does not touch the real Worldwide account. Production builds must omit the test-only `worldwideUpdateTest` Gradle property.
