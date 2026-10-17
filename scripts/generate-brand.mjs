import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

// Original Worldwide globe branding, restored at the user's request.
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="19" fill="#294e40"/><g fill="none" stroke="#e5eddd" stroke-width="2"><circle cx="32" cy="32" r="20"/><ellipse cx="32" cy="32" rx="9" ry="20"/><path d="M13 26h38M13 38h38"/></g></svg>';
fs.writeFileSync(new URL('../public/favicon.svg',import.meta.url),svg);
for(const size of [192,512])await sharp(Buffer.from(svg)).resize(size,size).png().toFile(fileURLToPath(new URL(`../public/icon-${size}.png`,import.meta.url)));
const android='<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><path android:fillColor="#e8efea" android:pathData="M0,0h108v108h-108z"/><path android:strokeColor="#3d6552" android:strokeWidth="3" android:fillColor="@android:color/transparent" android:pathData="M54,25a29,29 0,1 0,0 58a29,29 0,1 0,0 -58M25,54h58M54,25c-18,16 -18,42 0,58M54,25c18,16 18,42 0,58"/></vector>\n';
fs.writeFileSync(new URL('../mobile/android/app/src/main/res/drawable/worldwide_icon.xml',import.meta.url),android);
console.log('Restored original Worldwide globe icons.');
