let worker:Worker|null=null,sequence=0;
const pending=new Map<number,{resolve:(blob:Blob)=>void;reject:(error:Error)=>void}>();
export async function prepareImage(file:File):Promise<Blob>{
 if(!file.type.startsWith('image/'))throw new Error('Choose an image file.');
 if(file.size>35*1024*1024)throw new Error('Choose a photo under 35 MB.');
 if(typeof OffscreenCanvas!=='undefined'&&typeof Worker!=='undefined'){
  if(!worker){worker=new Worker(new URL('./photo-worker.ts',import.meta.url),{type:'module'});worker.onmessage=({data})=>{const item=pending.get(data.id);if(!item)return;pending.delete(data.id);if(data.error)item.reject(new Error(data.error));else item.resolve(data.blob)};worker.onerror=()=>{for(const item of pending.values())item.reject(new Error('Could not prepare photo. Please retry.'));pending.clear();worker?.terminate();worker=null}}
  return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker!.postMessage({id,file})});
 }
 const bitmap=await createImageBitmap(file),scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const ctx=canvas.getContext('2d');if(!ctx){bitmap.close();throw new Error('Could not prepare photo.')}ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not prepare photo.')),'image/webp',.88));
}
