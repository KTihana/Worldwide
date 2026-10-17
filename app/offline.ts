import {clearNativeAlbum,isNativeApp,readNativeValue,storeNativeValue,syncNativeAlbum} from './native';
type Album={visits:{countryId:string;visited:number}[];photos:{id:string;countryId:string}[];mapStyle?:string};
type State={supported:boolean;busy:boolean;ready:boolean;saved:number;total:number;phase:'map'|'photos';error:string};
const SHELL='elsewhere-shell-v1',ALBUM='elsewhere-album-v1';
const SESSION='/__offline_account__',READY='/__offline_ready__';
let state:State={supported:false,busy:false,ready:false,saved:0,total:0,phase:'map',error:''};
let current:Album|null=null,running:Promise<void>|null=null,lastSignature='',registration:Promise<boolean>|null=null,albumGeneration=0;
const notify=()=>window.dispatchEvent(new Event('elsewhere-offline-progress'));
function update(patch:Partial<State>){state={...state,...patch};notify()}
export function offlineState(){return state}
export function listenOffline(listener:()=>void){window.addEventListener('elsewhere-offline-progress',listener);return()=>window.removeEventListener('elsewhere-offline-progress',listener)}
export function offlineAvailable(){return isNativeApp()||window.isSecureContext&&'serviceWorker' in navigator&&'caches' in window}
export async function registerOffline(){
 if(isNativeApp()){const saved=readNativeValue<Partial<State>>('offline-state');update({...saved,supported:true,busy:false});return true}
 if(!offlineAvailable()){update({supported:false});return false}
 if(!registration)registration=navigator.serviceWorker.register('/sw.js').then(async()=>{await navigator.serviceWorker.ready;update({supported:true});return true}).catch(()=>{update({supported:false,error:'Offline access needs a trusted HTTPS phone address.'});return false});
 return registration;
}
export async function rememberOfflineAccount(email:string){
 if(isNativeApp()){storeNativeValue('account',{account:{email},needsSetup:false,canSetup:false});return}
 if(!await registerOffline())return;
 const cache=await caches.open(ALBUM);
 await cache.put(SESSION,new Response(JSON.stringify({account:{email},needsSetup:false,canSetup:false}),{headers:{'Content-Type':'application/json'}}));
}
export async function readOfflineAccount(){
 if(isNativeApp())return readNativeValue<{account:{email:string};needsSetup:false;canSetup:false}>('account');
 if(!offlineAvailable())return null;
 const response=await(await caches.open(ALBUM)).match(SESSION);
 return response?await response.json() as {account:{email:string};needsSetup:false;canSetup:false}:null;
}
export async function clearOfflineAlbum(){
 albumGeneration++;
 current=null;lastSignature='';update({busy:false,ready:false,saved:0,total:0,error:''});
 if(isNativeApp()){clearNativeAlbum();return}
 if('caches' in window)await caches.delete(ALBUM);
}
async function download(cache:Cache,url:string,refresh=false){
 if(!refresh&&await cache.match(url))return;
 const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw new Error(`Couldn’t save ${url} for offline use.`);
 await cache.put(url,response);
}
async function workers<T>(items:T[],count:number,task:(item:T)=>Promise<void>){
 let index=0;await Promise.all(Array.from({length:Math.min(count,items.length)},async()=>{while(index<items.length){const item=items[index++];await task(item)}}));
}
async function perform(data:Album){
 const generation=albumGeneration;
 if(!await registerOffline())return;
 if(generation!==albumGeneration)return;
 update({busy:true,ready:false,total:data.photos.length,phase:'map',error:''});
 try{
  if(isNativeApp()){
   update({phase:'photos'});window.worldwideNativeProgress=(saved,total)=>{if(generation===albumGeneration)update({saved,total})};
   await syncNativeAlbum(data);if(generation!==albumGeneration)return;update({busy:false,ready:true,saved:data.photos.length,total:data.photos.length,error:''});storeNativeValue('offline-state',state);return;
  }
  const [shell,album]=await Promise.all([caches.open(SHELL),caches.open(ALBUM)]);
  await album.put('/api/atlas',new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));
  const manifestResponse=await fetch('/offline-assets.json',{cache:'no-store'});
  if(!manifestResponse.ok)throw new Error('Couldn’t prepare the offline app.');
  const manifest=await manifestResponse.json() as {version:string;assets:string[]};
  const marker=await shell.match(READY);
  if((await marker?.text())!==manifest.version){
   await workers(manifest.assets,5,asset=>download(shell,asset,!asset.startsWith('/assets/')));
   await shell.put(READY,new Response(manifest.version));
   const keep=new Set([...manifest.assets,READY]);
   for(const request of await shell.keys())if(!keep.has(new URL(request.url).pathname))await shell.delete(request);
  }
  const photoUrls=data.photos.map(photo=>`/api/photos/${photo.id}`);
  if(generation!==albumGeneration)return;update({phase:'photos'});
  let saved=0;for(const url of photoUrls)if(await album.match(url))saved++;
  update({saved});
  await workers(photoUrls,2,async url=>{if(generation!==albumGeneration||await album.match(url))return;await download(album,url);if(generation!==albumGeneration)return;saved++;update({saved})});
  if(generation!==albumGeneration)return;
  const keep=new Set(['/api/atlas',SESSION,...photoUrls]);
  for(const request of await album.keys())if(!keep.has(new URL(request.url).pathname))await album.delete(request);
  await navigator.storage?.persist?.().catch(()=>false);
  if(generation!==albumGeneration)return;update({busy:false,ready:true,saved:data.photos.length,total:data.photos.length,error:''});
 }catch(error){if(generation===albumGeneration)update({busy:false,ready:false,error:(error as Error).name==='QuotaExceededError'?'This device is out of space for the offline album.':(error as Error).message})}
}
export function syncOffline(data:Album,force=false){
 current=data;
 if(!offlineAvailable())return;
 const signature=JSON.stringify(data);
 if(!force&&signature===lastSignature)return;
 if(running)return;
 const generation=albumGeneration;
 running=perform(data).then(()=>{if(generation===albumGeneration&&!state.error)lastSignature=signature}).finally(()=>{running=null;if(current&&(generation!==albumGeneration||JSON.stringify(current)!==signature))syncOffline(current)});
}
export function retryOffline(){if(current)syncOffline(current,true)}
