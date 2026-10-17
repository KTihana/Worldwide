import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Globe2} from 'lucide-react';

// The exact Globe2 used in the app is the source for every platform icon.
const color='#416d56';
const svg=renderToStaticMarkup(createElement(Globe2,{color,strokeWidth:2}));
const write=(path,data)=>fs.writeFileSync(new URL(path,import.meta.url),data);
write('../public/favicon.svg',svg);
for(const size of [192,512])await sharp(Buffer.from(svg)).resize(size,size).png().toFile(fileURLToPath(new URL(`../public/icon-${size}.png`,import.meta.url)));
// Explicit ICO avoids Electron Builder reusing a previously generated icon.
const sizes=[16,24,32,48,64,128,256],images=[];
for(const size of sizes)images.push(await sharp(Buffer.from(svg)).resize(size,size).png().toBuffer());
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
for(let i=0;i<sizes.length;i++){const at=6+16*i,size=sizes[i];header[at]=size===256?0:size;header[at+1]=header[at];header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(images[i].length,at+8);header.writeUInt32LE(offset,at+12);offset+=images[i].length;}
write('../public/worldwide.ico',Buffer.concat([header,...images]));
const paths=Array.from(svg.matchAll(/<path d="([^"]+)"/g),match=>match[1]);
const androidPaths=[...paths,'M22,12A10,10 0,1 1,2,12A10,10 0,1 1,22,12'].map(path=>` <path android:fillColor="@android:color/transparent" android:strokeColor="${color}" android:strokeWidth="2" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="${path}"/>`).join('\n');
write('../mobile/android/app/src/main/res/drawable/worldwide_icon.xml',`<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="24" android:viewportHeight="24">\n${androidPaths}\n</vector>\n`);
console.log('Generated all platform icons from the app’s Globe2 logo.');
