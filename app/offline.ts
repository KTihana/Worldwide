import {clearNativeAlbum,isNativeApp,readNativeValue,storeNativeValue,syncNativeAlbum} from './native';
type Album={visits:{countryId:string;visited:number}[];photos:{id:string;countryId:string}[];mapStyle?:string};
type State={supported:boolean;busy:boolean;ready:boolean;saved:number;total:number;phase:'map'|'photos';error:string};
const SHELL='elsewhere-shell-v1',ALBUM='elsewhere-album-v1';
const SESSION='/__offline_account__',READY='/__offline_ready__';
let state:State={supported:false,busy:false,ready:false,saved:0,total:0,phase:'map',error:''};
let current:Album|null=null,running:Promise<void>|null=null,lastSignature='',registration:Promise<boolean>|null=null,albumGeneration=0;
let shellPreparation:Promise<void>|null=null,photoIndex:Promise<Set<string>>|null=null,persistenceRequested=false;
let accountCacheWork:Promise<void>=Promise.resolve(),accountRevision=0;
function accountCacheTask(task:()=>Promise<void>){const operation=accountCacheWork.then(task);accountCacheWork=operation.catch(()=>{});return operation}
const signatures=new WeakMap<object,string>();
/** Album objects are immutable; polling and offline sync can share one encoding. */
export function albumSignature(data:Album){let value=signatures.get(data);if(value===undefined){value=JSON.stringify(data);signatures.set(data,value)}return value}
const notify=()=>window.dispatchEvent(new Event('elsewhere-offline-progress'));
function update(patch:Partial<State>){if(Object.entries(patch).every(([key,value])=>state[key as keyof State]===value))return;state={...state,...patch};notify()}
export function offlineState(){return state}
export function listenOffline(listener:()=>void){window.addEventListener('elsewhere-offline-progress',listener);return()=>window.removeEventListener('elsewhere-offline-progress',listener)}
export function offlineAvailable(){return isNativeApp()||window.isSecureContext&&'serviceWorker' in navigator&&'caches' in window}
export async function registerOffline(){
 if(isNativeApp()){if(!registration){const saved=readNativeValue<Partial<State>>('offline-state');update({...saved,supported:true,busy:false});registration=Promise.resolve(true)}return registration}
 if(!offlineAvailable()){update({supported:false});return false}
 if(!registration)registration=navigator.serviceWorker.register('/sw.js').then(async()=>{await navigator.serviceWorker.ready;update({supported:true});return true}).catch(()=>{registration=null;update({supported:false,error:'Offline access needs a trusted HTTPS phone address.'});return false});
 return registration;
}
export async function rememberOfflineAccount(email:string,username?:string|null){
 const generation=albumGeneration,revision=++accountRevision;
 if(isNativeApp()){storeNativeValue('account',{account:{email,...(username?{username}:{})},needsSetup:false,canSetup:false});return}
 if(!await registerOffline()||generation!==albumGeneration||revision!==accountRevision)return;
 await accountCacheTask(async()=>{
  if(generation!==albumGeneration||revision!==accountRevision)return;
  const cache=await caches.open(ALBUM);
  if(generation!==albumGeneration||revision!==accountRevision)return;
  await cache.put(SESSION,new Response(JSON.stringify({account:{email,...(username?{username}:{})},needsSetup:false,canSetup:false}),{headers:{'Content-Type':'application/json'}}));
 });
}
export async function readOfflineAccount(){
 if(isNativeApp())return readNativeValue<{account:{email:string;username?:string|null};needsSetup:false;canSetup:false}>('account');
 if(!offlineAvailable())return null;
 const response=await(await caches.open(ALBUM)).match(SESSION);
 return response?await response.json() as {account:{email:string;username?:string|null};needsSetup:false;canSetup:false}:null;
}
export async function clearOfflineAlbum(){
 albumGeneration++;
 current=null;lastSignature='';photoIndex=null;update({busy:false,ready:false,saved:0,total:0,error:''});
 if(isNativeApp()){clearNativeAlbum();return}
 // Finish any in-flight identity write before logout deletes it. New identity
 // writes queue after this deletion, without waiting for service-worker setup.
 if('caches' in window)await accountCacheTask(async()=>{await caches.delete(ALBUM)});
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
function prepareShell(shell:Cache){
 if(!shellPreparation)shellPreparation=(async()=>{
  const manifestResponse=await fetch('/offline-assets.json',{cache:'no-store'});
  if(!manifestResponse.ok)throw new Error('Couldn’t prepare the offline app.');
  const manifest=await manifestResponse.json() as {version:string;assets:string[]};
  const marker=await shell.match(READY);
  if((await marker?.text())===manifest.version)return;
  await workers(manifest.assets,3,asset=>download(shell,asset,!asset.startsWith('/assets/')));
  await shell.put(READY,new Response(manifest.version));
  const keep=new Set([...manifest.assets,READY]);
  for(const request of await shell.keys())if(!keep.has(new URL(request.url).pathname))await shell.delete(request);
 })().catch(error=>{shellPreparation=null;throw error});
 return shellPreparation;
}
function savedPhotos(album:Cache){
 if(!photoIndex)photoIndex=album.keys().then(keys=>new Set(keys.map(request=>new URL(request.url).pathname).filter(path=>/^\/api\/photos\/[^/]+$/.test(path))));
 return photoIndex;
}
async function perform(data:Album){
 const generation=albumGeneration;
 if(!await registerOffline()||generation!==albumGeneration)return;
 update({busy:true,total:data.photos.length,error:''});
 try{
  if(isNativeApp()){
   update({phase:'photos'});window.worldwideNativeProgress=(saved,total)=>{if(generation===albumGeneration)update({saved,total})};
   await syncNativeAlbum(data);if(generation!==albumGeneration)return;update({busy:false,ready:true,saved:data.photos.length,total:data.photos.length,error:''});storeNativeValue('offline-state',state);return;
  }
  const [shell,album]=await Promise.all([caches.open(SHELL),caches.open(ALBUM)]);
  if(generation!==albumGeneration)return;
  await album.put('/api/atlas',new Response(albumSignature(data),{headers:{'Content-Type':'application/json'}}));
  update({phase:'map'});await prepareShell(shell);
  if(generation!==albumGeneration)return;
  const photoUrls=new Set(data.photos.map(photo=>`/api/photos/${photo.id}`)),saved=await savedPhotos(album);
  if(generation!==albumGeneration)return;
  let count=Array.from(photoUrls).filter(url=>saved.has(url)).length;
  update({phase:'photos',saved:count,ready:count===photoUrls.size});
  const missing=Array.from(photoUrls).filter(url=>!saved.has(url));
  await workers(missing,2,async url=>{if(generation!==albumGeneration)return;await download(album,url);if(generation!==albumGeneration)return;saved.add(url);update({saved:++count})});
  if(generation!==albumGeneration)return;
  for(const url of saved)if(!photoUrls.has(url)){await album.delete(url);saved.delete(url)}
  if(!persistenceRequested){persistenceRequested=true;await navigator.storage?.persist?.().catch(()=>false)}
  if(generation!==albumGeneration)return;update({busy:false,ready:true,saved:data.photos.length,total:data.photos.length,error:''});
 }catch(error){if(generation===albumGeneration)update({busy:false,ready:false,error:(error as Error).name==='QuotaExceededError'?'This device is out of space for the offline album.':(error as Error).message})}
}
export function syncOffline(data:Album,force=false){
 current=data;
 if(!offlineAvailable())return;
 const signature=albumSignature(data);
 if(!force&&signature===lastSignature)return;
 if(running)return;
 const generation=albumGeneration;
 running=perform(data).then(()=>{if(generation===albumGeneration&&!state.error)lastSignature=signature}).finally(()=>{running=null;if(current&&(generation!==albumGeneration||albumSignature(current)!==signature))syncOffline(current)});
}
export function retryOffline(){shellPreparation=null;photoIndex=null;if(current)syncOffline(current,true)}
