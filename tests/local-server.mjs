import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir,networkInterfaces} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {request as httpRequest} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(resolve(tmpdir(),'elsewhere-local-test-'));
const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
const base=`http://127.0.0.1:${port}`;let child;let sessionCookie='';
async function start(){
 child=spawn(process.execPath,['server/index.ts'],{cwd:root,env:{...process.env,PORT:String(port),ELSEWHERE_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Local server startup timed out: '+output)),10000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Worldwide is running at')){clearTimeout(timer);resolve()}});child.stderr.on('data',chunk=>output+=chunk);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Local server exited (${code}): ${output}`))})});
}
async function stop(){if(child&&child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done}}
async function request(path,options={}){const response=await fetch(base+path,{...options,headers:{origin:base,cookie:sessionCookie,...options.headers}});return {status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0],data:response.headers.get('content-type')?.includes('json')?await response.json():await response.arrayBuffer()}}
const post=(path,body,headers={})=>request(path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const patch=(id,body)=>request(`/api/countries/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
try{
 await start();
 assert.equal((await fetch(base+'/')).status,200,'App served locally');
 assert.equal((await(await fetch(base+'/api/health')).json()).app,'worldwide-local');
 assert.equal((await fetch(base+'/api/atlas')).status,401,'Private album requires login');
 const legacy=new DatabaseSync(resolve(temp,'atlas.sqlite'));legacy.prepare('INSERT INTO visits(user_id,country_id,visited,note,updated_at) VALUES(?,?,?,?,?)').run('local','HRV',1,'Existing album',new Date().toISOString());legacy.close();
 const credentials={email:'owner@example.test',password:'a long private test password'};
 const setup=await request('/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});assert.equal(setup.status,200);assert.ok(setup.cookie);assert.equal(Object.hasOwn(setup.data,'recoveryCode'),false,'New accounts need no recovery code');sessionCookie=setup.cookie;
 const connection=await request('/api/connection');assert.equal(connection.status,200);assert.ok(Array.isArray(connection.data.localUrls));assert.ok(connection.data.localUrls.every(url=>url.startsWith('http://')),'Native Android pairing provides LAN HTTP addresses');
 assert.equal((await request('/api/atlas')).data.visits.find(v=>v.countryId==='HRV').note,'Existing album','Account setup preserves legacy visits');
 for(const [body,headers,status] of [[{url:'http://127.0.0.1/private'}, {},400],[{url:'http://[::ffff:127.0.0.1]/private'},{},400],[{url:'https://example.com/image.png'},{cookie:''},401],[{url:'https://example.com/image.png'},{origin:'https://untrusted.example'},403]]){
  const imported=await post('/api/photos/import',body,headers);assert.equal(imported.status,status,'Image import requires account, same origin, and public URL');
 }
 const importError=await fetch(base+'/api/photos/import',{method:'POST',headers:{origin:base,cookie:sessionCookie,'Content-Type':'application/json'},body:'{"url":"file:///etc/passwd"}'});assert.equal(importError.headers.get('cache-control'),'no-store','Image import errors are not cached');

 assert.equal((await request('/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)})).status,409,'Only the private owner can be created');
 const login=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',cookie:''},body:JSON.stringify(credentials)});assert.equal(login.status,200);const phoneCookie=login.cookie;assert.notEqual(phoneCookie,sessionCookie,'Each device gets its own session');
 assert.equal((await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...credentials,password:'incorrect password'})})).status,401);

 const terrain=await fetch(base+'/terrain/world-natural-earth.webp');assert.equal(terrain.status,200,'Terrain is served locally');assert.equal(terrain.headers.get('content-type'),'image/webp');assert.ok((await terrain.arrayBuffer()).byteLength>10000,'Local terrain has image data');
 assert.equal((await fetch(base+'/signin-with-external-provider')).status,404,'External sign-in routes are unavailable');
 assert.equal((await request('/api/atlas',{headers:{origin:'https://example.org'}})).status,403,'Cross-origin reads blocked');
 assert.equal((await request('/api/countries/NZL',{method:'PATCH',headers:{origin:'https://example.org','Content-Type':'application/json'},body:'{"visited":true}'})).status,403,'Cross-origin writes blocked');
 assert.equal((await patch('BAD',{visited:true})).status,404);
 assert.equal((await patch('NZL',{visited:'yes'})).status,400);
 assert.equal((await patch('NZL',{visited:true,note:'Saved on this computer',visitDate:'2026-10-17'})).status,200);
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCmcAAAAASUVORK5CYII=','base64');
 const ids=[];
 for(let i=0;i<2;i++){const form=new FormData();form.set('countryId','NZL');form.set('photo',new Blob([bytes],{type:'image/png'}),'test.png');const result=await request('/api/photos',{method:'POST',body:form});assert.equal(result.status,201);ids.push(result.data.id)}
 const reorder=order=>request('/api/photos/order',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({countryId:'NZL',ids:order})});
 assert.equal((await reorder([ids[1],ids[0]])).status,200);
 assert.deepEqual((await request('/api/atlas',{headers:{cookie:phoneCookie}})).data.photos.map(p=>p.id),[ids[1],ids[0]],'Reordered gallery syncs to another device');
 assert.equal((await reorder([ids[0],ids[0]])).status,400,'Duplicate photos are rejected');
 assert.equal((await reorder([ids[0]])).status,409,'Stale incomplete order cannot hide photos');
 assert.equal((await patch('NZL',{coverId:ids[1]})).status,200);
 assert.equal((await request(`/api/photos/${ids[1]}`,{headers:{cookie:''}})).status,401,'Photo bytes require authentication');
 assert.equal((await request('/api/countries/NZL',{method:'PATCH',headers:{cookie:'','Content-Type':'application/json'},body:'{"visited":false}'})).status,401,'Anonymous mutations are blocked');
 assert.equal((await request('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{"mapStyle":"robinson"}'})).status,200);
 assert.equal((await request('/api/atlas',{headers:{cookie:phoneCookie}})).data.mapStyle,'robinson','Map style follows the account');
 const phoneData=(await request('/api/atlas',{headers:{cookie:phoneCookie}})).data;assert.equal(phoneData.photos.length,2,'Another signed-in device sees uploaded photos');
 assert.equal((await request('/api/countries/NZL',{method:'PATCH',headers:{cookie:phoneCookie,'Content-Type':'application/json'},body:'{"note":"Changed from phone"}'})).status,200);
 assert.equal((await request('/api/atlas')).data.visits.find(v=>v.countryId==='NZL').note,'Changed from phone','Phone changes reach the computer');
 await patch('NZL',{note:'Saved on this computer'});

 assert.equal((await request(`/api/photos/${ids[1]}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({cropX:.4,cropY:-.6,cropZoom:2.3})})).status,200);
 for(const frame of [{cropX:2},{cropY:-3},{cropZoom:0},{cropZoom:6},{cropZoom:'2'}])assert.equal((await request(`/api/photos/${ids[1]}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(frame)})).status,400,'Invalid photo framing rejected');
 assert.equal((await request(`/api/photos/${ids[1]}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{"caption":"Local photo"}'})).status,200);
 await stop();await start();
 const data=(await request('/api/atlas')).data,visit=data.visits.find(v=>v.countryId==='NZL');
 assert.equal(visit.visited,1,'Visited status survives server restart');assert.equal(visit.note,'Saved on this computer');assert.equal(visit.visitDate,'2026-10-17');assert.equal(visit.coverId,ids[1]);
 assert.equal(data.photos.length,2,'Albums survive server restart');assert.deepEqual(data.photos.map(p=>p.id),[ids[1],ids[0]],'Photo order survives restart');assert.equal(data.photos.find(p=>p.id===ids[1]).caption,'Local photo');
 const framed=data.photos.find(p=>p.id===ids[1]);assert.deepEqual([framed.cropX,framed.cropY,framed.cropZoom],[.4,-.6,2.3],'Photo position survives server restart');
 const downloaded=await request(`/api/photos/${ids[1]}`);assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(downloaded.data),bytes,'Photo bytes survive server restart');
 assert.equal((await request(`/api/photos/${ids[1]}`,{method:'DELETE'})).status,200);
 assert.equal((await request('/api/atlas')).data.visits.find(v=>v.countryId==='NZL').coverId,ids[0],'Removing a cover chooses another local photo');
 assert.equal((await request(`/api/photos/${ids[1]}`)).status,404);
 const invalid=new FormData();invalid.set('countryId','NZL');invalid.set('photo',new Blob(['invalid'],{type:'image/png'}),'fake.png');assert.equal((await request('/api/photos',{method:'POST',body:invalid})).status,400);
 const html=await(await fetch(base+'/')).text();assert.ok(!/signin-with/i.test(html));
 assert.match(html,/manifest.webmanifest/);
 const manifest=await(await fetch(base+'/manifest.webmanifest')).json();assert.equal(manifest.orientation,'landscape');
 assert.ok((await readFile(resolve(temp,'atlas.sqlite'))).length>0,'Database is a local file');
 assert.equal((await request('/api/auth/session')).data.canReset,true,'The hosting computer can reset its account');
 assert.equal((await post('/api/auth/pair-start',{serverUrl:base},{cookie:''})).status,401,'QR creation requires a signed-in account');
 assert.equal((await post('/api/auth/pair-start',{serverUrl:base},{origin:'https://example.org'})).status,403,'Cross-origin QR creation is blocked');
 assert.equal((await post('/api/auth/pair-start',{serverUrl:'http://192.0.2.1:3000'})).status,400,'QR codes cannot point at an unavailable computer address');
 const pair=await post('/api/auth/pair-start',{serverUrl:base});assert.equal(pair.status,200);assert.match(pair.data.qr,/<svg[\s>]/);
 const pairingUrl=new URL(pair.data.pairingUrl);assert.equal(pairingUrl.protocol,'worldwide:');assert.equal(pairingUrl.hostname,'pair');assert.equal(pairingUrl.searchParams.get('server'),base);
 const token=pairingUrl.searchParams.get('token');assert.match(token,/^[a-f0-9]{64}$/);
 assert.match(pair.data.pairingId,/^[a-f0-9]{64}$/);assert.equal((await request(`/api/auth/pair-status?id=${pair.data.pairingId}`)).data.status,'waiting','The PC shows a pending QR code');
 assert.equal((await request(`/api/auth/pair-status?id=${pair.data.pairingId}`,{headers:{cookie:''}})).status,401,'Pairing status requires the signed-in PC');
 const expiration=typeof pair.data.expiresAt==='number'?pair.data.expiresAt:Date.parse(pair.data.expiresAt);assert.ok(expiration>Date.now()+170000&&expiration<=Date.now()+185000,'QR codes expire in three minutes');
 assert.equal((await post('/api/auth/pair-complete',{token:'0'.repeat(64)},{cookie:''})).status,401,'Unknown QR tokens are rejected');
 assert.equal((await post('/api/auth/pair-complete',{token},{cookie:'',origin:'https://example.org'})).status,403,'Cross-origin pairing is blocked without consuming the token');
 const paired=await post('/api/auth/pair-complete',{token},{cookie:''});assert.equal(paired.status,200);const qrCookie=paired.cookie;assert.ok(qrCookie);assert.notEqual(qrCookie,sessionCookie);assert.notEqual(qrCookie,phoneCookie);assert.equal(paired.data.account.email,credentials.email);
 assert.equal((await request('/api/atlas',{headers:{cookie:qrCookie}})).data.photos.length,1,'QR sign-in opens the same album on another device');
 assert.equal((await request(`/api/auth/pair-status?id=${pair.data.pairingId}`)).data.status,'paired','The PC confirms that the phone connected');
 assert.equal((await post('/api/auth/pair-complete',{token},{cookie:''})).status,401,'A QR code can be claimed only once');
 const pending=await post('/api/auth/pair-start',{serverUrl:base});assert.equal(pending.status,200);const logoutToken=new URL(pending.data.pairingUrl).searchParams.get('token');
 const lan=Object.values(networkInterfaces()).flat().find(address=>address&&address.family==='IPv4'&&!address.internal);
 if(lan){
  const lanBase=`http://${lan.address}:${port}`;
  const phoneRequest=async(path,body)=>fetch(lanBase+path,{method:body?'POST':'GET',headers:{origin:lanBase,cookie:sessionCookie,'Content-Type':'application/json','X-Forwarded-For':'127.0.0.1','X-Forwarded-Host':`localhost:${port}`},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await(await phoneRequest('/api/auth/session')).json()).canReset,false,'A LAN client is not the trusted computer');
  assert.equal((await phoneRequest('/api/auth/reset-local',{password:'untrusted phone password'})).status,403,'A phone cannot reset the PC password, even with spoofed forwarding headers');
  assert.equal((await phoneRequest('/api/auth/pair-start',{serverUrl:base})).status,403,'A phone cannot create new pairing codes');
  // Use node:http here: fetch normalizes Host to the URL, hiding this boundary.
  const hostRequest=(target,path,host,body)=>new Promise((resolve,reject)=>{const req=httpRequest(target+path,{method:body?'POST':'GET',headers:{host,origin:`http://${host}`,'Content-Type':'application/json'}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks).toString())})}catch(error){reject(error)}})});req.on('error',reject);req.end(body?JSON.stringify(body):undefined)});
  assert.equal((await hostRequest(lanBase,'/api/auth/reset-local',`127.0.0.1:${port}`,{password:'untrusted phone password'})).status,403,'A loopback Host header cannot turn a LAN socket into the trusted computer');
  assert.equal((await hostRequest(base,'/api/auth/session',`${lan.address}:${port}`)).data.canReset,false,'A loopback socket addressed through a LAN host is not trusted');
 }else console.log('SKIP: LAN-only trusted-computer checks (no LAN interface available).');
 await request('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal((await request('/api/atlas')).status,401,'Signing out revokes this device');
 assert.equal((await request('/api/atlas',{headers:{cookie:phoneCookie}})).status,200,'Signing out leaves the other device signed in');
 assert.equal((await post('/api/auth/pair-complete',{token:logoutToken},{cookie:''})).status,401,'Signing out invalidates unclaimed QR codes');
 const resetPending=await post('/api/auth/pair-start',{serverUrl:base},{cookie:phoneCookie});assert.equal(resetPending.status,200);const pendingToken=new URL(resetPending.data.pairingUrl).searchParams.get('token');
 const replacementPassword='new private test password';
 assert.equal((await post('/api/auth/reset-local',{password:'short'},{cookie:''})).status,400,'Local reset validates the new password');
 assert.equal((await post('/api/auth/reset-local',{password:replacementPassword},{cookie:'',origin:'https://example.org'})).status,403,'Cross-origin requests cannot reset the password');
 const reset=await post('/api/auth/reset-local',{password:replacementPassword},{cookie:''});assert.equal(reset.status,200);assert.ok(reset.cookie,'Trusted computer signs in after reset');assert.equal(reset.data.account.email,credentials.email,'Reset does not need the email');
 for(const cookie of [phoneCookie,qrCookie,sessionCookie])assert.equal((await request('/api/atlas',{headers:{cookie}})).status,401,'Reset revokes every previous device session');
 assert.equal((await post('/api/auth/pair-complete',{token:pendingToken},{cookie:''})).status,401,'Reset invalidates unclaimed QR codes');
 sessionCookie=reset.cookie;
 const resetAlbum=(await request('/api/atlas')).data;assert.equal(resetAlbum.photos.length,1,'Reset preserves photos');assert.equal(resetAlbum.visits.find(v=>v.countryId==='HRV').note,'Existing album','Reset preserves the existing album');assert.deepEqual(Buffer.from((await request(`/api/photos/${ids[0]}`)).data),bytes,'Reset preserves uploaded photo bytes');
 assert.equal((await post('/api/auth/login',credentials,{cookie:''})).status,401,'Previous password stops working');
 assert.equal((await post('/api/auth/login',{email:credentials.email,password:replacementPassword},{cookie:''})).status,200,'New password works');
 console.log('PASS: private account, preserved album, shared edits/photos, QR pairing and single-use tokens, trusted-PC reset and session revocation, landscape manifest, and origin protection.');
}finally{await stop();await rm(temp,{recursive:true,force:true})}
