import sharp from 'sharp';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
// A small, flat palette preserves broad land-cover regions without relief texture.
export const terrainPalette={green:[201,219,193],grass:[222,229,205],sand:[238,228,206],ice:[250,250,247]};
export async function writeSimpleTerrain(input,output){
 const {data,info}=await input.blur(4).removeAlpha().raw().toBuffer({resolveWithObject:true});
 for(let i=0;i<data.length;i+=info.channels){
  const r=data[i],g=data[i+1],b=data[i+2];
  const colour=(b>r+5&&b>g)||(r>235&&g>235&&b>235)?terrainPalette.ice:r>g+5&&r>b+15?terrainPalette.sand:g>r+14?terrainPalette.green:terrainPalette.grass;
  data[i]=colour[0];data[i+1]=colour[1];data[i+2]=colour[2];
 }
 await sharp(data,{raw:{width:info.width,height:info.height,channels:info.channels}}).webp({lossless:true}).toFile(output);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const dir=new URL('../public/terrain/',import.meta.url);let count=0;
 for(const name of await fs.readdir(dir)){if(!name.endsWith('.webp'))continue;const path=fileURLToPath(new URL(name,dir)),temporary=path+'.tmp.webp';await writeSimpleTerrain(sharp(path),temporary);await fs.rename(temporary,path);count++}
 console.log(`Simplified ${count} terrain views to four flat colours.`);
}
