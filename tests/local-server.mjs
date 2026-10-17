import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
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
const patch=(id,body)=>request(`/api/countries/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
try{
 await start();
 assert.equal((await fetch(base+'/')).status,200,'App served locally');
 assert.equal((await(await fetch(base+'/api/health')).json()).app,'worldwide-local');
 assert.equal((await fetch(base+'/api/atlas')).status,401,'Private album requires login');
 const legacy=new DatabaseSync(resolve(temp,'atlas.sqlite'));legacy.prepare('INSERT INTO visits(user_id,country_id,visited,note,updated_at) VALUES(?,?,?,?,?)').run('local','HRV',1,'Existing album',new Date().toISOString());legacy.close();
 const credentials={email:'owner@example.test',password:'a long private test password'};
 const setup=await request('/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});assert.equal(setup.status,200);assert.ok(setup.cookie);assert.ok(setup.data.recoveryCode);sessionCookie=setup.cookie;
 const connection=await request('/api/connection');assert.equal(connection.status,200);assert.ok(Array.isArray(connection.data.localUrls));assert.ok(connection.data.localUrls.every(url=>url.startsWith('http://')),'Native Android pairing provides LAN HTTP addresses');
 assert.equal((await request('/api/atlas')).data.visits.find(v=>v.countryId==='HRV').note,'Existing album','Account setup preserves legacy visits');
 assert.equal((await request('/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)})).status,409,'Only the private owner can be created');
 const login=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',cookie:''},body:JSON.stringify(credentials)});assert.equal(login.status,200);const phoneCookie=login.cookie;assert.notEqual(phoneCookie,sessionCookie,'Each device gets its own session');
 assert.equal((await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...credentials,password:'incorrect password'})})).status,401);

 const terrain=await fetch(base+'/terrain/world-natural-earth.webp');assert.equal(terrain.status,200,'Terrain is served locally');assert.equal(terrain.headers.get('content-type'),'image/webp');assert.ok((await terrain.arrayBuffer()).byteLength>10000,'Local terrain has image data');
 assert.equal((await fetch(base+'/signin-with-chatgpt')).status,404,'ChatGPT sign-in is removed');
 assert.equal((await request('/api/atlas',{headers:{origin:'https://example.org'}})).status,403,'Cross-origin reads blocked');
 assert.equal((await request('/api/countries/NZL',{method:'PATCH',headers:{origin:'https://example.org','Content-Type':'application/json'},body:'{"visited":true}'})).status,403,'Cross-origin writes blocked');
 assert.equal((await patch('BAD',{visited:true})).status,404);
 assert.equal((await patch('NZL',{visited:'yes'})).status,400);
 assert.equal((await patch('NZL',{visited:true,note:'Saved on this computer',visitDate:'2026-10-17'})).status,200);
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCmcAAAAASUVORK5CYII=','base64');
 const ids=[];
 for(let i=0;i<2;i++){const form=new FormData();form.set('countryId','NZL');form.set('photo',new Blob([bytes],{type:'image/png'}),'test.png');const result=await request('/api/photos',{method:'POST',body:form});assert.equal(result.status,201);ids.push(result.data.id)}
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
 assert.equal(data.photos.length,2,'Albums survive server restart');assert.equal(data.photos.find(p=>p.id===ids[1]).caption,'Local photo');
 const framed=data.photos.find(p=>p.id===ids[1]);assert.deepEqual([framed.cropX,framed.cropY,framed.cropZoom],[.4,-.6,2.3],'Photo position survives server restart');
 const downloaded=await request(`/api/photos/${ids[1]}`);assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(downloaded.data),bytes,'Photo bytes survive server restart');
 assert.equal((await request(`/api/photos/${ids[1]}`,{method:'DELETE'})).status,200);
 assert.equal((await request('/api/atlas')).data.visits.find(v=>v.countryId==='NZL').coverId,ids[0],'Removing a cover chooses another local photo');
 assert.equal((await request(`/api/photos/${ids[1]}`)).status,404);
 const invalid=new FormData();invalid.set('countryId','NZL');invalid.set('photo',new Blob(['invalid'],{type:'image/png'}),'fake.png');assert.equal((await request('/api/photos',{method:'POST',body:invalid})).status,400);
 const html=await(await fetch(base+'/')).text();assert.ok(!/chatgpt|signin-with/i.test(html));
 assert.match(html,/manifest.webmanifest/);
 const manifest=await(await fetch(base+'/manifest.webmanifest')).json();assert.equal(manifest.orientation,'landscape');
 assert.ok((await readFile(resolve(temp,'atlas.sqlite'))).length>0,'Database is a local file');
 await request('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal((await request('/api/atlas')).status,401,'Signing out revokes this device');
 assert.equal((await request('/api/atlas',{headers:{cookie:phoneCookie}})).status,200,'Signing out leaves the other device signed in');
 const recovery=await request('/api/auth/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...credentials,password:'new private test password',recoveryCode:setup.data.recoveryCode})});assert.equal(recovery.status,200);
 assert.equal((await request('/api/atlas',{headers:{cookie:phoneCookie}})).status,401,'Password recovery revokes old sessions');
 assert.equal((await request('/api/auth/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...credentials,recoveryCode:setup.data.recoveryCode})})).status,401,'Recovery codes cannot be reused');
 console.log('PASS: private account, legacy album preservation, independent devices, shared edits and photos, protected files, session restart persistence, logout/recovery, landscape manifest, and origin protection.');
}finally{await stop();await rm(temp,{recursive:true,force:true})}
