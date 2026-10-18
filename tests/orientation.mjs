import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const result=await build({entryPoints:[fileURLToPath(new URL('../app/orientation.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createOrientationController,isPhoneScreen,phoneOrientation}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const tick=async()=>{for(let count=0;count<8;count++)await Promise.resolve()};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
function mock({phone=true,native=false,supported=true,lock,fullscreen}={}){
 const root={},external={};let element=null,applied=null,fullscreenRequests=0,exits=0,unlocks=0;
 const locks=[],nativeCalls=[];
 const controller=createOrientationController({
  isPhone:()=>phone,
  native:mode=>{nativeCalls.push(mode);if(native)applied=mode;return native},
  canLock:()=>supported,
  lock:mode=>{locks.push(mode);return Promise.resolve(lock?.(mode)).then(()=>{applied=mode})},
  unlock:()=>{unlocks++;applied=null},
  fullscreen:()=>element,
  requestFullscreen:()=>{fullscreenRequests++;return Promise.resolve(fullscreen?.()).then(()=>{element=root})},
  exitFullscreen:()=>{exits++;element=null;return Promise.resolve()},
 });
 return {controller,locks,nativeCalls,external,setExternal(){element=external},get applied(){return applied},get fullscreen(){return element},get requests(){return fullscreenRequests},get exits(){return exits},get unlocks(){return unlocks}};
}
{
 const state=mock(),account=state.controller.claim('portrait',10);await tick();
 assert.equal(state.applied,'portrait');account.set('landscape');await tick();
 assert.equal(state.applied,'landscape','A verified session requests the wide map');
 assert.equal(state.requests,0,'Neither loading nor login forces fullscreen');
 const count=state.locks.length;account.set('landscape');await tick();assert.equal(state.locks.length,count,'Stable account renders do not relock or flicker');
 const gate=state.controller.claim('portrait',20);await tick();assert.equal(state.applied,'portrait','Connection screens override an authenticated child');
 gate.release();await tick();assert.equal(state.applied,'landscape');
 account.set('portrait');await tick();assert.equal(state.applied,'portrait','Sign-out and session expiry restore the upright form');
 account.release();await tick();assert.equal(state.applied,null,'Unmount releases the browser lock');
}
for(const native of [false,true]){
 const state=mock({phone:false,native});const lease=state.controller.claim('landscape');
 assert.equal(await state.controller.requestWideMap(),false);lease.release();await tick();
 assert.equal(state.locks.length+state.nativeCalls.length+state.requests,0,'Desktop and tablet screens are never forced to rotate');
}
{
 const state=mock({native:true}),account=state.controller.claim('portrait');account.set('landscape');account.set('portrait');account.release();await tick();
 assert.deepEqual(state.nativeCalls,['portrait','landscape','portrait','portrait']);
 assert.equal(state.locks.length+state.requests,0,'A supported native bridge owns phone rotation without browser fullscreen');
}
{
 const state=mock({supported:false}),account=state.controller.claim('landscape');
 assert.equal(await state.controller.requestWideMap(),false);assert.equal(state.requests,0,'Unsupported browsers get the physical-rotation hint without useless fullscreen');account.release();
}
{
 const state=mock({lock:()=>Promise.reject(new Error('Not supported'))}),account=state.controller.claim('landscape');await tick();
 assert.equal(await state.controller.requestWideMap(),false);await tick();
 assert.equal(state.fullscreen,null,'Denied locks leave the map usable and release our fullscreen');
 assert.equal(state.exits,1);account.release();
}
{
 const state=mock(),account=state.controller.claim('landscape');await tick();
 assert.equal(await state.controller.requestWideMap(),true);assert.equal(state.requests,1);assert.notEqual(state.fullscreen,null);
 account.set('portrait');await tick();assert.equal(state.fullscreen,null,'Sign-out exits only fullscreen started by the wide-map button');account.release();
 const external=mock(),other=external.controller.claim('landscape');external.setExternal();
 assert.equal(await external.controller.requestWideMap(),true);other.set('portrait');await tick();
 assert.equal(external.fullscreen,external.external,'An existing fullscreen session belongs to its original caller');other.release();
}
{
 const late=deferred(),state=mock({fullscreen:()=>late.promise}),account=state.controller.claim('landscape');await tick();
 const wide=state.controller.requestWideMap();account.set('portrait');late.resolve();
 assert.equal(await wide,false);await tick();assert.equal(state.fullscreen,null,'A fullscreen result arriving after logout is immediately released');assert.equal(state.controller.getMode(),'portrait');
 assert.equal(state.locks.filter(mode=>mode==='landscape').length,1,'The stale fullscreen result never starts another landscape lock');account.release();
}
{
 const late=deferred();let delay=true;
 const state=mock({lock:mode=>mode==='landscape'&&delay?late.promise:Promise.resolve()}),account=state.controller.claim('landscape');
 account.set('portrait');await tick();assert.equal(state.applied,'portrait');delay=false;late.resolve();await tick();
 assert.equal(state.applied,'portrait','A late landscape lock cannot rotate an already-visible login form');assert.equal(state.locks.at(-1),'portrait');account.release();
}
{
 const late=deferred();let landscapeCalls=0;
 const state=mock({lock:mode=>mode==='landscape'&&++landscapeCalls===2?late.promise:Promise.resolve()}),account=state.controller.claim('landscape');await tick();
 const wide=state.controller.requestWideMap();await tick();account.set('portrait');await tick();late.resolve();
 assert.equal(await wide,false);await tick();assert.equal(state.applied,'portrait');assert.equal(state.fullscreen,null,'A delayed gesture lock is harmless after session expiry');account.release();
}
{
 const late=deferred(),state=mock({lock:mode=>mode==='landscape'?late.promise:Promise.resolve()}),account=state.controller.claim('landscape');
 account.set('portrait');await tick();late.reject(new Error('Superseded'));await tick();
 assert.deepEqual(state.locks,['landscape','portrait'],'A rejected stale request never starts a retry loop');assert.equal(state.applied,'portrait');account.release();
}
{
 const previous=globalThis.window,coarse={value:true},calls=[];
 const bridge={setOrientation(mode){assert.equal(this,bridge);calls.push(mode)}};
 globalThis.window={screen:{width:390,height:844},matchMedia:()=>({matches:coarse.value}),WorldwideNative:bridge};
 assert.equal(isPhoneScreen(),true);window.screen={width:844,height:390};assert.equal(isPhoneScreen(),true,'Phone detection survives physical rotation');
 window.screen={width:600,height:960};assert.equal(isPhoneScreen(),false,'A small tablet is not forced into phone orientation');
 window.screen={width:390,height:844};coarse.value=false;assert.equal(isPhoneScreen(),false,'A narrow mouse-driven desktop is not a phone');coarse.value=true;
 const lease=phoneOrientation.claim('portrait');lease.set('landscape');lease.release();await tick();
 assert.deepEqual(calls,['portrait','landscape','portrait'],'The optional native bridge receives the controller’s actual modes');
 globalThis.window=previous;
}
console.log('PASS: phone-only portrait account/connection and landscape map ownership, native fallback, optional user-gesture fullscreen, unsupported browsers, cleanup, and delayed logout races.');
