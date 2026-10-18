import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ts from 'typescript';
const temp=await mkdtemp(join(tmpdir(),'worldwide-web-pairing-'));
process.env.ELSEWHERE_DATA_DIR=temp;
const {authRoute}=await import('../server/auth.ts');
const {db}=await import('../server/storage.ts');
const source=await readFile(new URL('../app/web-pairing.ts',import.meta.url),'utf8');
const javascript=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {consumeWebPairingLink,completeWebPairing}=await import('data:text/javascript;base64,'+Buffer.from(javascript).toString('base64'));
const pc='http://127.0.0.1:3000',lan='http://192.168.1.25:3000';let pcCookie='';
async function call(action,body,{origin=pc,cookie=pcCookie,local=true,site='same-origin',requestOrigin=origin}={}){
 const request=new Request(origin+'/api/auth/'+action,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:requestOrigin,Cookie:cookie,'Sec-Fetch-Site':site},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{return await authRoute(request,action,local,'browser-pairing-test',[pc,lan]);}
 catch(error){return Response.json({error:error.message},{status:error.status||500});}
}
try{
 const setup=await call('setup',{email:'browser@example.test',password:'A private browser test password'});assert.equal(setup.status,200);pcCookie=setup.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('pair-start',{serverUrl:lan,client:'web'},{cookie:''})).status,401);
 assert.equal((await call('pair-start',{serverUrl:lan,client:'web'},{local:false,origin:lan})).status,403);
 assert.equal((await call('pair-start',{serverUrl:'http://untrusted.example',client:'web'})).status,400);
 assert.equal((await call('pair-start',{serverUrl:lan,client:'unknown'})).status,400);
 const native=await(await call('pair-start',{serverUrl:lan})).json();assert.equal(new URL(native.pairingUrl).protocol,'worldwide:','Existing native pairing remains compatible');
 const response=await call('pair-start',{serverUrl:lan,client:'web'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const pairing=await response.json(),url=new URL(pairing.pairingUrl);assert.equal(url.origin,lan);assert.equal(url.pathname,'/');assert.equal(url.search,'');assert.match(url.hash,/^#worldwide-pair=[a-f0-9]{64}$/);assert.match(pairing.qr,/<svg/);
 assert.ok(pairing.expiresAt>Date.now()+170000&&pairing.expiresAt<=Date.now()+180000);
 const replacements=[];
 const link=consumeWebPairingLink(url,{state:null,replaceState:(_state,_unused,path)=>replacements.push(path)});
 assert.deepEqual(replacements,['/'],'The browser replaces the secret URL before making any request');assert.equal(url.searchParams.has('token'),false);
 assert.equal(consumeWebPairingLink({hash:'#some-country',pathname:'/',search:''},{state:null,replaceState(){throw new Error('Unrelated fragment modified')}}),null);
 for(const hash of ['#worldwide-pair=bad','#worldwide-pair='+link.token+'&redirect=https://untrusted.example']){
  let scrubbed=false;const invalid=consumeWebPairingLink({hash,pathname:'/',search:''},{state:null,replaceState(){scrubbed=true}});assert.ok(scrubbed);assert.equal(invalid.token,'');assert.ok(invalid.error);
 }
 assert.equal((await call('pair-complete',{token:link.token},{cookie:'',origin:lan,local:false,requestOrigin:'https://untrusted.example'})).status,403);
 assert.equal((await call('pair-complete',{token:link.token},{cookie:'',origin:lan,local:false,site:'cross-site'})).status,403);
 let phoneCookie='',attempts=0;
 await completeWebPairing(link.token,async(path,options)=>{
  attempts++;assert.equal(replacements.length,1);assert.equal(path,'/api/auth/pair-complete');assert.ok(!path.includes(link.token));assert.equal(options.credentials,'same-origin');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');
  const result=await call('pair-complete',JSON.parse(options.body),{cookie:'',origin:lan,local:false});assert.equal(result.status,200);const cookie=result.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);assert.ok(!cookie.includes('Secure'),'LAN HTTP cookie works without certificate setup');phoneCookie=cookie.split(';')[0];return result;
 });
 assert.equal(attempts,1);assert.ok(phoneCookie);assert.notEqual(phoneCookie,pcCookie);
 assert.equal((await(await call('session',undefined,{origin:lan,local:false,cookie:phoneCookie})).json()).account.email,'browser@example.test','Phone browser is signed into the same album');
 assert.equal((await call('pair-complete',{token:link.token},{cookie:'',origin:lan,local:false})).status,401,'One-use QR cannot be replayed');
 const statusRequest=new Request(pc+'/api/auth/pair-status?id='+pairing.pairingId,{headers:{cookie:pcCookie,origin:pc}});
 assert.equal((await(await authRoute(statusRequest,'pair-status',true,'browser-pairing-test',[pc,lan])).json()).status,'paired');
 const expiring=await(await call('pair-start',{serverUrl:lan,client:'web'})).json(),expiredToken=new URL(expiring.pairingUrl).hash.slice('#worldwide-pair='.length),now=Date.now;
 try{Date.now=()=>expiring.expiresAt+1;assert.equal((await call('pair-complete',{token:expiredToken},{cookie:'',origin:lan,local:false})).status,401,'Expired QR never authenticates');}finally{Date.now=now;}
 await assert.rejects(completeWebPairing(link.token,async()=>Response.json({error:'This QR code is invalid or expired.'},{status:401})),/expired/);
 await assert.rejects(completeWebPairing(link.token,async()=>{throw new TypeError('Network failed')}),/same Wi-Fi/);
 const secure=await(await call('pair-start',{serverUrl:lan,client:'web'})).json();assert.ok(secure.pairingUrl.startsWith('http://'),'Browser workflow requires no native installer');
 console.log('PASS: browser QR fragment privacy, authenticated PC-only generation, same-origin cookie handshake, native compatibility, one-use replay protection, expiry, and connection errors.');
}finally{db.close();await rm(temp,{recursive:true,force:true});}
