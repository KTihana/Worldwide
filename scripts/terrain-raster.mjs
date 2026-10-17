import {writeSimpleTerrain} from './simplify-terrain.mjs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import fs from 'node:fs/promises';
const enabled=process.env.GENERATE_TERRAIN==='1';
let source;
async function pixels(){if(!source)source=sharp(fileURLToPath(new URL('./terrain-source.png',import.meta.url))).blur(1.1).modulate({saturation:1.2}).removeAlpha().raw().toBuffer({resolveWithObject:true});return source}
// Resample geographic colours using the same inverse projection as the vector
// outlines. Output always covers map coordinates 0,0–1200,590.
export async function renderTerrain(projection,name,width=1200){
 if(!enabled)return;
 const {data,info}=await pixels(),height=Math.round(width*590/1200),output=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const point=projection.invert([(x+.5)*1200/width,(y+.5)*590/height]);const target=(y*width+x)*3;
  if(!point||!point.every(Number.isFinite)||Math.abs(point[1])>90){output.set([183,207,164],target);continue}
  const lon=((point[0]+180)%360+360)%360,ix=Math.max(0,Math.min(info.width-1,Math.floor(lon/360*info.width))),iy=Math.max(0,Math.min(info.height-1,Math.floor((90-point[1])/180*info.height))),offset=(iy*info.width+ix)*info.channels;
  output[target]=data[offset];output[target+1]=data[offset+1];output[target+2]=data[offset+2];
 }
 const dir=new URL('../public/terrain/',import.meta.url);await fs.mkdir(dir,{recursive:true});
 await writeSimpleTerrain(sharp(output,{raw:{width,height,channels:3}}),fileURLToPath(new URL(`${name}.webp`,dir)));
}
