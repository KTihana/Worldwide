# Worldwide desktop

The installed desktop app includes its own server and database runtime. Users do not need Node.js or a terminal. Keep Worldwide open on the computer while connecting or syncing the Android app over the same Wi-Fi.

## Windows

Run `Worldwide-Setup-0.1.0-x64.exe` to install, or `Worldwide-Portable-0.1.0-x64.exe` to run without an installer. The builds are currently unsigned; Windows may ask for confirmation because there is no publisher certificate. No cloud service is used.

Create the private account on the computer, then open **Your album** to find the computer's local address. Enter that address in the Android app and sign in with the same email and password. The computer may show a Windows Firewall prompt; allow access on your private/home network so your phone can reach it. The computer and phone need a connection to sync; the downloaded phone album is viewable offline.

New installed albums live in `%APPDATA%\Worldwide\album` on Windows, or `~/Library/Application Support/Worldwide/album` on macOS. Uninstalling does not delete this folder. The application does not bundle anyone's album or passwords.

To use an existing album, close its running server and use **File → Choose album folder…**, selecting the folder containing `atlas.sqlite` and `uploads`. You can copy the entire original `elsewhere/data` folder to the PC first, while the original server is stopped. The app uses the selected folder directly. Back up that folder periodically.

If the developer's local server is already running on port 3000, Worldwide opens that same album and leaves the existing server running when the desktop window closes.

## Build

- `npm run desktop:windows`: build the website, prepare the bundled server, and produce Windows x64 installer and portable downloads in `releases/desktop/`.
- `npm run desktop:mac`: produce a macOS ZIP and DMG for the current architecture (macOS build host required).
- `npm run desktop:dev`: run a local desktop development build.
- `npx electron desktop/smoke.cjs`: test the prepared server in Electron's actual utility process with a disposable album.

The build copies only `dist`, the API/server code, public country/style metadata, and database migrations into the runtime. `data/` is excluded. Electron's Node runtime supplies SQLite; no separate database installation is required.

Production distribution can add publisher signing credentials to Electron Builder. Signing credentials are not included in the project.
