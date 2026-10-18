# Worldwide

Your private travel photo map, running on your computer and opened in a browser.

1. Open **Start Worldwide** (`.cmd` on Windows, `.command` on Mac, `.sh` on Linux). It opens the website and keeps the server running in the background.
2. On the computer, open **Your album → Connect phone**. Scan the QR code with your phone on the same Wi-Fi.
3. When the computer has a newer website, choose **Refresh to update** on the phone. Photos and your account stay saved.

First setup only: install [Node.js](https://nodejs.org/) 22.18 or newer, then run `npm ci` in this folder. The launcher builds the website when needed. Local address: http://127.0.0.1:3000.

Keep the computer running for syncing. Your album is in `data/`; keep that folder when replacing website files. Server logs are in `data/worldwide-server.log`. If an update changes server code, restart the running server once; front-end changes only need a browser refresh. The launchers do not download new website code or install a system startup service.

Map data: [Natural Earth](https://www.naturalearthdata.com/).
