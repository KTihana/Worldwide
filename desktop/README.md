# Worldwide desktop

The installed desktop app includes its own server and database runtime. Users do not need Node.js or a terminal. Keep Worldwide open on the computer while connecting or syncing the Android app over the same Wi-Fi.

## Windows

Run `Worldwide-Windows-Setup.exe` to install. The builds are currently unsigned; Windows may ask for confirmation because there is no publisher certificate. No cloud service is used.

Create your account on the computer. Open **Your album → Connect Android**, then tap **Scan computer QR** in Worldwide on your phone. Scanning signs the phone into the same album; both devices must use the same Wi-Fi. The computer may show a Windows Firewall prompt; allow access on your private/home network so your phone can reach it. The computer and phone need a connection to sync; the downloaded phone album is viewable offline.

New installed albums live in `%APPDATA%\Worldwide\album` on Windows, or `~/Library/Application Support/Worldwide/album` on macOS. Uninstalling does not delete this folder. The application does not bundle anyone's album or passwords.

To use an existing album, close its running server and use **File → Choose album folder…**, selecting the folder containing `atlas.sqlite` and `uploads`. You can copy the entire original `elsewhere/data` folder to the PC first, while the original server is stopped. The app uses the selected folder directly. Back up that folder periodically.

If the developer's local server is already running on port 3000, Worldwide opens that same album and leaves the existing server running when the desktop window closes.

Forgot your password? Choose **Forgot password?** on this computer and set a new one. No recovery code is needed. This works only on the computer hosting the album and signs out other devices; scan a fresh QR code to reconnect them.

## Build

- `npm run desktop:windows`: build the website, prepare the bundled server, and produce Windows x64 installer and portable downloads in `releases/desktop/`.
- `npm run desktop:mac`: produce a macOS ZIP and DMG for the current architecture (macOS build host required).
- `npm run desktop:dev`: run a local desktop development build.
- `npx electron desktop/smoke.cjs`: test the prepared server in Electron's actual utility process with a disposable album.

The build copies only `dist`, the API/server code, public country/style metadata, and database migrations into the runtime. `data/` is excluded. Electron's Node runtime supplies SQLite; no separate database installation is required.

Production distribution can add publisher signing credentials to Electron Builder. Signing credentials are not included in the project.

## Updates

Open **Your album → App updates → Check for updates → Install update**. Worldwide downloads the official Windows installer, checks its SHA-256 digest, finishes current saves, then installs and reopens. The album, photos, account, and selected album folder stay in place. Do not uninstall to update. A portable copy is upgraded by installing the regular desktop app, which uses the same saved album.

Older versions need one manual installation of the new version to gain this update button. New releases must include `Worldwide-Windows-Setup.exe` in the public `KTihana/Worldwide` GitHub release, with a stable `vX.Y.Z` tag and GitHub's asset digest. The app rejects older versions, unexpected download addresses, incomplete downloads, and checksum mismatches. Updates use `%APPDATA%\Worldwide\updates`; album data is never staged in the installation folder.

Run `node tests/desktop-updates.mjs` to verify release checks and preservation of SQLite, settings, and exact photo bytes through successful and failed update downloads. Installer execution still needs validation on Windows; downloading and data preservation are tested independently of an actual Windows installation.
