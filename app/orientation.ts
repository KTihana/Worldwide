import {useLayoutEffect,useRef} from 'react';
import {setNativeOrientation} from './native';

export type PhoneOrientation='portrait'|'landscape';
type Environment={
 isPhone:()=>boolean;
 native:(mode:PhoneOrientation)=>boolean;
 canLock:()=>boolean;
 lock:(mode:PhoneOrientation)=>Promise<void>;
 unlock:()=>void;
 fullscreen:()=>unknown|null;
 requestFullscreen:()=>Promise<void>|null;
 exitFullscreen:()=>Promise<void>|void;
};

/** One owner arbitrates account gates and the authenticated map, including late browser replies. */
export function createOrientationController(environment:Environment){
 const claims=new Map<symbol,{mode:PhoneOrientation;priority:number}>();
 let mode:PhoneOrientation|null=null,generation=0,ownedFullscreen:unknown|null=null,wideRequest:Promise<boolean>|null=null;
 function exitOwnedFullscreen(){
  const owned=ownedFullscreen;ownedFullscreen=null;
  if(owned&&environment.fullscreen()===owned)try{void Promise.resolve(environment.exitFullscreen()).catch(()=>{})}catch{}
 }
 async function apply(){
  const current=generation,target=mode;
  if(!environment.isPhone())return false;
  if(environment.native(target||'portrait'))return true;
  try{environment.unlock()}catch{}
  if(!target||!environment.canLock())return false;
  try{await environment.lock(target)}catch{return false}
  if(current!==generation){void apply();return false}
  return true;
 }
 function reconcile(){
  let next:PhoneOrientation|null=null,priority=-Infinity;
  for(const claim of claims.values())if(claim.priority>=priority){next=claim.mode;priority=claim.priority}
  if(next===mode)return;
  mode=next;generation++;
  if(mode!=='landscape')exitOwnedFullscreen();
  void apply();
 }
 function claim(initial:PhoneOrientation,priority=0){
  const key=Symbol();claims.set(key,{mode:initial,priority});reconcile();
  return {set(next:PhoneOrientation){const value=claims.get(key);if(value){value.mode=next;reconcile()}},release(){claims.delete(key);reconcile()}};
 }
 function requestWideMap(){
  if(mode!=='landscape'||!environment.isPhone())return Promise.resolve(false);
  if(wideRequest)return wideRequest;
  const current=generation;
  wideRequest=(async()=>{
   if(environment.native('landscape'))return true;
   // Fullscreen is requested only from the visible button's user gesture, and only if rotation can work.
   if(!environment.canLock())return false;
   if(!environment.fullscreen()){
    let request:Promise<void>|null;
    try{request=environment.requestFullscreen();if(!request)return false;await request}catch{return false}
    ownedFullscreen=environment.fullscreen();
    if(current!==generation||mode!=='landscape'){exitOwnedFullscreen();return false}
   }
   const success=await apply();
   if(current!==generation||mode!=='landscape'){exitOwnedFullscreen();return false}
   if(!success)exitOwnedFullscreen();
   return success;
  })().finally(()=>{wideRequest=null});
  return wideRequest;
 }
 return {claim,requestWideMap,getMode:()=>mode};
}

/** Physical screen size avoids treating a narrow desktop window or a tablet as a phone. */
export function isPhoneScreen(){
 return typeof window!=='undefined'&&window.matchMedia('(pointer: coarse)').matches&&Math.min(window.screen.width,window.screen.height)>0&&Math.min(window.screen.width,window.screen.height)<600;
}
const screenOrientation=()=>window.screen.orientation as ScreenOrientation&{lock?:(mode:string)=>Promise<void>};
export const phoneOrientation=createOrientationController({
 isPhone:isPhoneScreen,
 native:setNativeOrientation,
 canLock:()=>typeof screenOrientation()?.lock==='function',
 lock:mode=>screenOrientation().lock!(mode==='portrait'?'portrait-primary':'landscape'),
 unlock:()=>screenOrientation()?.unlock?.(),
 fullscreen:()=>document.fullscreenElement,
 requestFullscreen:()=>document.documentElement.requestFullscreen?.()||null,
 exitFullscreen:()=>document.exitFullscreen?.(),
});

/** Update a lease in place so an authenticated map never flickers through portrait on rerender. */
export function usePhoneOrientation(mode:PhoneOrientation|null,priority=10){
 const lease=useRef<ReturnType<typeof phoneOrientation.claim>|null>(null);
 useLayoutEffect(()=>{
  if(mode){if(lease.current)lease.current.set(mode);else lease.current=phoneOrientation.claim(mode,priority)}
  else{lease.current?.release();lease.current=null}
 },[mode,priority]);
 useLayoutEffect(()=>()=>{lease.current?.release();lease.current=null},[]);
}
