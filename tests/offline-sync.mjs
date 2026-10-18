import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {webcrypto} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {resolve} from 'node:path';
const code=await build({entryPoints:[resolve(import.meta.dirname,'../app/offline.ts')],bundle:true,write:false,platform:'browser',format:'iife',globalName:'offline'});
const origin='https://worldwide.test',stores=new Map(),counts={match:0,keys:0,persist:0,manifest:0,photos:0,shell:0};
const key=input=>new URL(typeof input==='string'?input:input.url,origin).href;
const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const values=stores.get(name);return {async match(input){counts.match++;return values.get(key(input))?.clone()},async put(input,response){values.set(key(input),response.clone())},async delete(input){return values.delete(key(input))},async keys(){counts.keys++;return [...values.keys()].map(url=>({url}))}}},async delete(name){return stores.delete(name)}};
const assets=['/',...Array.from({length:548},(_,i)=>`/geography/asset-${i}.json`)];
let delayedPhoto=null,releasePhoto=null;
async function fetchMock(url){
 if(url==='/offline-assets.json'){counts.manifest++;return Response.json({version:'test-version',assets})}
 if(url.startsWith('/api/photos/')){counts.photos++;if(url===delayedPhoto)await new Promise(resolve=>releasePhoto=resolve);return new Response('photo bytes',{headers:{'Content-Type':'image/webp'}})}
 counts.shell++;return new Response('asset');
}
const window=new EventTarget();window.isSecureContext=true;window.caches=caches;
const context={window,caches,crypto:webcrypto,navigator:{serviceWorker:{register:async()=>{},ready:Promise.resolve()},storage:{persist:async()=>{counts.persist++;return true}}},fetch:fetchMock,Response,URL,Event,EventTarget,Map,WeakMap,Set,Promise,JSON,console,setTimeout,clearTimeout};
runInNewContext(code.outputFiles[0].text,context);const offline=context.offline;
const pause=()=>new Promise(resolve=>setTimeout(resolve,1));
async function settled(expected){for(let i=0;i<3000;i++){await pause();if(offline.offlineState().ready&&!offline.offlineState().busy&&offline.offlineState().total===expected)return}throw Error('Offline save did not finish: '+JSON.stringify(offline.offlineState()))}
const album={visits:[{countryId:'HRV',visited:1,note:'first'}],photos:[{id:'one',countryId:'HRV'},{id:'two',countryId:'HRV'}]};
await offline.rememberOfflineAccount('owner@example.test');offline.syncOffline(album);await settled(2);
assert.equal(counts.manifest,1);assert.equal(counts.shell,549);assert.equal(counts.photos,2);assert.equal(counts.persist,1);
const before={...counts};
for(let i=0;i<20;i++){offline.syncOffline({...album,visits:[{...album.visits[0],note:`edit ${i}`} ]});await settled(2)}
assert.equal(counts.manifest,before.manifest,'Metadata edits do not fetch the offline manifest again');
assert.equal(counts.shell,before.shell,'Metadata edits do not refresh any map assets');
assert.equal(counts.photos,before.photos,'Metadata edits do not redownload photos');
assert.equal(counts.match,before.match,'Metadata edits do not scan every cached photo again');
assert.equal(counts.keys,before.keys,'Metadata edits do not enumerate either cache again');assert.equal(counts.persist,1);
const cache=await caches.open('elsewhere-album-v1');await cache.put('/api/photos/three',new Response('Already opened in gallery'));
offline.syncOffline({...album,photos:[...album.photos,{id:'three',countryId:'HRV'}]});await settled(3);assert.equal(counts.photos,2,'Photos already saved by the service worker are reused');
offline.syncOffline({...album,photos:[album.photos[0]]});await settled(1);assert.equal(await cache.match('/api/photos/two'),undefined);assert.equal(await cache.match('/api/photos/three'),undefined);
offline.retryOffline();await settled(1);assert.equal(counts.manifest,2,'Explicit retry rechecks the app version');assert.equal(counts.shell,549,'Unchanged ready bundle is kept on retry');
// Logout while a download is in flight cannot re-create private files in the new cache.
delayedPhoto='/api/photos/old-private';offline.syncOffline({...album,photos:[{id:'old-private',countryId:'HRV'}]});for(let i=0;i<100&&!releasePhoto;i++)await pause();assert.ok(releasePhoto);
await offline.clearOfflineAlbum();await offline.rememberOfflineAccount('next@example.test');offline.syncOffline({visits:[],photos:[]});releasePhoto();await settled(0);
const next=await caches.open('elsewhere-album-v1');assert.equal(await next.match('/api/photos/old-private'),undefined);assert.equal((await(await next.match('/__offline_account__')).json()).account.email,'next@example.test');
console.log('PASS: 20 metadata edits add 0 manifest requests, 0 asset/photo downloads, and 0 cache scans; new/deleted photos, retry, and in-flight logout are correct.');
