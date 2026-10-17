# Worldwide for Android

The personal Android installer is `../../releases/Worldwide-Android.apk`. It supports Android 8.0 and newer, opens in landscape, and bundles the complete map. It connects directly to the Windows app on your computer. No cloud account, certificate installation, or external service is involved.

## Install and connect

1. Copy `Worldwide-Android.apk` to your Android phone and open it. Android may ask you to allow installation from the app you used to open the file.
2. Keep Worldwide running on your computer. Open **Your album** there and copy the phone address beginning with `http://`.
3. Connect the phone to the same Wi-Fi, open Worldwide, and enter that computer address. Sign in with the same private account you created on the computer.
4. In **Your album**, wait for **Saved on this device** to show the map and every photo are ready. You can then reopen the installed app and view them without Wi-Fi or the computer.

Changes and uploads need a connection to the computer. The offline album is read only. The app automatically checks for changes while open. It does not promise background sync after Android closes it. **Change computer** is available on the connection, sign-in, and account screens. Connecting a different computer clears the phone's previous album copy. Signing out removes cached private photos and the local session. Uninstalling or clearing Android app data also removes the phone copy; the computer's album is preserved.

The normal Android file picker handles photo uploads. Saving a map or photo opens Android's save dialog. No broad photo-library or storage permission is required.

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

The test creates a separate temporary server and album, installs the debug app and instrumentation package, and checks real account login, cookie persistence, PATCH visits and photo crops, multipart photo uploads, local photo persistence, disconnected album access, sign-out cleanup, and server address restrictions. It does not use `data/` or the real account. The emulator's Worldwide test app is reset by the test. Use a dedicated emulator, never a personal device with a real Worldwide album.

## Implementation

The Android wrapper serves bundled files at an internal HTTPS origin and blocks external page navigation. Only that trusted app can access the native bridge. API calls go directly to the configured computer; the bridge supplies the computer's origin, stores its session cookie privately, and never exposes the cookie to JavaScript. HTTP connections are limited to local IPv4 addresses; separately configured remote servers must use HTTPS. Redirects and invalid certificates are rejected.

Photos and the album snapshot are stored in Android's private application directory. Cloud backup is disabled. Generation guards cancel stale writes when signing out or changing computers. The app uses the platform WebView and standard Android APIs, with no third-party native runtime.

References: [Android local web content](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content), [Android Gradle compatibility](https://developer.android.com/build/releases/about-agp).
