const SHELL='elsewhere-shell-v1',ALBUM='elsewhere-album-v1';
async function network(request){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3500);try{return await fetch(request,{signal:controller.signal})}finally{clearTimeout(timer)}}
self.addEventListener('install',event=>{event.waitUntil(self.skipWaiting())});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim())});
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;
 const url=new URL(request.url);if(url.origin!==self.location.origin)return;
 const path=url.pathname;
 if(path.startsWith('/api/auth/')||path==='/api/connection'||path.startsWith('/api/preferences'))return;
 if(path==='/api/atlas'||/^\/api\/photos\/[^/]+$/.test(path)){
  event.respondWith((async()=>{
   const cache=await caches.open(ALBUM);
   try{const response=await network(request);if(response.ok)await cache.put(request,response.clone()).catch(()=>{});return response}
   catch{const saved=await cache.match(request);if(!saved)return new Response(JSON.stringify({error:'This photo is not saved on this phone yet.'}),{status:503,headers:{'Content-Type':'application/json'}});const headers=new Headers(saved.headers);headers.set('X-Elsewhere-Offline','1');return new Response(saved.body,{status:saved.status,statusText:saved.statusText,headers})}
  })());return;
 }
 if(path.startsWith('/api/'))return;
 event.respondWith((async()=>{
  const cache=await caches.open(SHELL);
  const key=request.mode==='navigate'?'/':request;
  if(request.mode!=='navigate'){const saved=await cache.match(key);if(saved)return saved}
  try{const response=request.mode==='navigate'?await network(request):await fetch(request);if(response.ok)await cache.put(key,response.clone()).catch(()=>{});return response}
  catch{return await cache.match(key)||new Response('Offline copy unavailable.',{status:503})}
 })());
});
