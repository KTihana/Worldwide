import {flushSync} from 'react-dom';

const images=new Map<string,Promise<void>>();
export function prepareMapImage(url:string){
 let ready=images.get(url);
 if(!ready){ready=new Promise<void>(resolve=>{const image=new Image();image.src=url;image.decode().catch(()=>{}).finally(resolve)});images.set(url,ready)}
 return ready;
}
let navigation=0;
// Only geometry navigation waits for preparation; controls respond immediately.
// Avoid full-screen SVG snapshots, which stall embedded WebViews on large maps.
export async function transitionMap(update:()=>void,image?:string,prepare?:Promise<unknown>){
 const request=++navigation;
 if(image||prepare)await Promise.all([image?prepareMapImage(image):undefined,prepare]);
 if(request===navigation)flushSync(update);
}
