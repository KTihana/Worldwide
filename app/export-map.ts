import {VISITED_TINT,VISITED_OPACITY} from './map-palette';
import {photoPlacement} from './photo-layout';
import type {FramedPhoto} from './photo-tools';
export type ExportShape={id:string;name:string;path:string;outline?:string;bounds:number[]};
export async function exportMap(shapes:ExportShape[],visits:Record<string,{visited:number;coverId:string|null}>,photos:FramedPhoto[],onProgress:(value:string)=>void,terrainUrl:string){
 const canvas=document.createElement('canvas');canvas.width=4000;canvas.height=2400;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Your browser could not create this image.');
 ctx.fillStyle='#e7eff1';ctx.fillRect(0,0,canvas.width,canvas.height);
 const x1=Math.min(...shapes.map(c=>c.bounds[0])),y1=Math.min(...shapes.map(c=>c.bounds[1])),x2=Math.max(...shapes.map(c=>c.bounds[2])),y2=Math.max(...shapes.map(c=>c.bounds[3]));
 const scale=Math.min((canvas.width-240)/Math.max(1,x2-x1),(canvas.height-240)/Math.max(1,y2-y1));
 ctx.translate(canvas.width/2-(x1+x2)/2*scale,canvas.height/2-(y1+y2)/2*scale);ctx.scale(scale,scale);
 const terrainResponse=await fetch(terrainUrl);if(!terrainResponse.ok)throw new Error('The terrain colours could not be loaded.');
 const terrain=await createImageBitmap(await terrainResponse.blob());try{const land=new Path2D();for(const shape of shapes)land.addPath(new Path2D(shape.path));ctx.save();ctx.clip(land);ctx.drawImage(terrain,0,0,1200,590);ctx.restore()}finally{terrain.close()}
 const photoById=Object.fromEntries(photos.map(p=>[p.id,p]));let done=0,total=shapes.filter(c=>visits[c.id]?.visited&&visits[c.id]?.coverId).length;
 for(const shape of shapes){const visit=visits[shape.id],path=new Path2D(shape.path);
  if(shape.id==='ATA'){ctx.fillStyle='#f5f7f6';ctx.fill(path)}
  if(visit?.visited&&visit.coverId){onProgress(`Preparing photo ${++done} of ${total}…`);const photo=photoById[visit.coverId];if(!photo)throw new Error(`The cover photo for ${shape.name} could not be found.`);const response=await fetch(`/api/photos/${photo.id}`);if(!response.ok)throw new Error(`The photo for ${shape.name} could not be loaded.`);const image=await createImageBitmap(await response.blob());try{const p=photoPlacement(shape.bounds,image.width/image.height,photo);ctx.save();ctx.clip(path);ctx.drawImage(image,p.x,p.y,p.width,p.height);ctx.restore()}finally{image.close()}}
  if(visit?.visited&&!visit.coverId){ctx.save();ctx.fillStyle=VISITED_TINT;ctx.globalAlpha=VISITED_OPACITY;ctx.fill(path);ctx.restore()}
  ctx.strokeStyle=shape.id==='ATA'?'#a8b5b8':visit?.visited?'#567062':'#87938a';ctx.lineWidth=visit?.visited?.65:.5;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke(new Path2D(shape.outline??shape.path));
 }
 onProgress('Saving image…');
 return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('The image could not be created.')),'image/png'));
}
