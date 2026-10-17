import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),catalog=JSON.parse(await readFile(new URL('app/data/map-styles.json',root),'utf8')),{regions}=JSON.parse(await readFile(new URL('app/data/focus.json',root),'utf8'));
const items=[...await Promise.all(catalog.map(async style=>({name:`world-${style.id}`,shapes:JSON.parse(await readFile(new URL(`app/data/projections/${style.id}.json`,root),'utf8'))}))),...Object.entries(regions).map(([name,region])=>({name:`region-${name.replaceAll(' ','-')}`,shapes:region.shapes}))];
await mkdir(new URL('public/basemaps/',root),{recursive:true});
for(const {name,shapes} of items){
 const terrain=(await sharp(await readFile(new URL(`public/terrain/${name}.webp`,root))).png().toBuffer()).toString('base64');
 const output=new URL(`public/basemaps/${name}.webp`,root),marker=new URL(`public/basemaps/${name}.sha256`,root),signature=createHash('sha256').update('basemap-v2').update(terrain).update(JSON.stringify(shapes)).digest('hex');
 try{if(await readFile(marker,'utf8')===signature){await access(output);continue}}catch{}
 const paths=Object.entries(shapes).map(([id,s])=>`<path d="${s.path}" fill="${id==='ATA'?'#f5f7f6':'url(#terrain)'}"/><path d="${s.outline||s.path}" fill="none" stroke="${id==='ATA'?'#a8b5b8':'#87938a'}" stroke-width=".6" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="3600" height="1770" viewBox="0 0 1200 590"><defs><pattern id="terrain" patternUnits="userSpaceOnUse" width="1200" height="590"><image xlink:href="data:image/png;base64,${terrain}" width="1200" height="590" preserveAspectRatio="none"/></pattern></defs>${paths}</svg>`;
 await sharp(Buffer.from(svg)).webp({lossless:true}).toFile(fileURLToPath(output));await writeFile(marker,signature);
}
console.log(`Prepared ${items.length} cached map backgrounds.`);
