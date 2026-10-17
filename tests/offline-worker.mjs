import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
const origin='http://localhost:3000',handlers={};
const stores=new Map();
const caches={
 async open(name){if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);return {async match(input){return store.get(new URL(typeof input==='string'?input:input.url,origin).href)?.clone()},async put(input,response){store.set(new URL(typeof input==='string'?input:input.url,origin).href,response.clone())}}},
 async delete(name){return stores.delete(name)},
};
let online=true,branding='old-logo';
async function fetchNetwork(request){
 if(!online)throw new TypeError('Network unavailable');
 const path=new URL(typeof request==='string'?request:request.url,origin).pathname;
 if(path==='/favicon.svg')return new Response(branding,{headers:{'Content-Type':'image/svg+xml'}});
 if(path==='/api/atlas')return Response.json({visits:[{countryId:'HRV',visited:1}],photos:[{id:'photo-1'}]});
 if(path==='/api/photos/photo-1')return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/webp'}});
 if(path==='/api/photos/private')return new Response('Sign in',{status:401});
 return new Response('<html>Elsewhere</html>',{headers:{'Content-Type':'text/html'}});
}
const self={location:{origin},addEventListener(type,handler){handlers[type]=handler},skipWaiting:async()=>{},clients:{claim:async()=>{}}};
runInNewContext(await readFile(resolve(import.meta.dirname,'../public/sw.js'),'utf8'),{self,caches,fetch:fetchNetwork,URL,Response,Request,Headers,AbortController,setTimeout,clearTimeout});
async function visit(path,mode='cors'){
 const request=new Request(origin+path);
 Object.defineProperty(request,'mode',{value:mode});
 let answer;handlers.fetch({request,respondWith(value){answer=value}});
 return answer?await answer:null;
}
const atlas=await visit('/api/atlas');assert.equal(atlas.status,200);
const photo=await visit('/api/photos/photo-1');assert.deepEqual(new Uint8Array(await photo.arrayBuffer()),new Uint8Array([1,2,3]));
assert.equal((await visit('/api/photos/private')).status,401);
assert.equal((await visit('/')).status,200);
assert.equal(await(await visit('/favicon.svg')).text(),'old-logo');
branding='current-logo';
assert.equal(await(await visit('/favicon.svg')).text(),'current-logo','Online icon changes replace old cached artwork');
online=false;
assert.equal(await(await visit('/favicon.svg')).text(),'current-logo','Current icon stays available offline');
assert.equal(await(await visit('/favicon.svg?v=0.1.1')).text(),'current-logo','Versioned icons can use the offline shell copy');
const offlineAtlas=await visit('/api/atlas');assert.equal(offlineAtlas.headers.get('X-Elsewhere-Offline'),'1');assert.equal((await offlineAtlas.json()).photos[0].id,'photo-1');
const offlinePhoto=await visit('/api/photos/photo-1');assert.equal(offlinePhoto.headers.get('X-Elsewhere-Offline'),'1');assert.deepEqual(new Uint8Array(await offlinePhoto.arrayBuffer()),new Uint8Array([1,2,3]));
assert.equal((await visit('/api/photos/private')).status,503,'Unauthorized photos are never saved');
assert.match(await(await visit('/')).text(),/Elsewhere/,'App shell opens offline');
assert.equal(await visit('/api/auth/session'),null,'Session checks are never served from cached private data');
console.log('PASS: offline app shell, album data, and photos; unauthorized responses are not cached.');
