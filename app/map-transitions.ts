import {flushSync} from 'react-dom';

const images=new Map<string,Promise<void>>();
export function prepareMapImage(url:string){
 let ready=images.get(url);
 if(!ready){ready=new Promise<void>(resolve=>{const image=new Image();image.src=url;image.decode().catch(()=>{}).finally(resolve)});images.set(url,ready)}
 return ready;
}
let navigation=0;
let transition:ViewTransition|undefined;
let animations:Animation[]=[];
// Decode terrain before swapping projections. Older embedded browsers use a
// short fade through the water background instead of exposing a geometry jump.
export async function transitionMap(update:()=>void,image?:string,prepare?:Promise<unknown>){
 const request=++navigation;
 transition?.skipTransition();
 for(const animation of animations)animation.cancel();
 animations=[];
 if(image||prepare)await Promise.all([image?prepareMapImage(image):undefined,prepare]);
 if(request!==navigation)return;
 if(matchMedia('(prefers-reduced-motion: reduce)').matches){flushSync(update);return}
 if(document.startViewTransition){
  transition=document.startViewTransition(()=>{if(request===navigation)flushSync(update)});
  await transition.finished.catch(()=>{});return;
 }
 const selector=image?.startsWith('/terrain/')?'.map-canvas, .modal-backdrop':'.modal-backdrop';
 const fade=async(from:number,to:number,duration:number)=>{
  const current=Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(el=>typeof el.animate==='function').map(el=>el.animate([{opacity:from},{opacity:to}],{duration,easing:'ease',fill:'both'}));
  animations=current;
  await Promise.all(current.map(animation=>animation.finished.catch(()=>{})));
  return current;
 };
 const outgoing=await fade(1,0,100);
 if(request!==navigation)return;
 flushSync(update);
 for(const animation of outgoing)animation.cancel();
 const incoming=await fade(0,1,180);
 if(request!==navigation)return;
 for(const animation of incoming)animation.cancel();
 animations=[];
}
