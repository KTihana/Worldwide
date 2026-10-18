/** The Android bridge is exposed only to the app's bundled, trusted origin. */
type Bridge={connection():string;request(id:string,request:string):void;configure(id:string,url:string):void;read(key:string):string;store(key:string,value:string):void;clearAlbum():void;syncAlbum(id:string,album:string):void;saveFile(id:string,name:string,mime:string,base64:string):void;scanQr(id:string):void;pairQr(id:string,payload:string):void;takePairLink():string;checkUpdate?(id:string):void;installUpdate?(id:string):void;setOrientation?(mode:string):void;standalone?():boolean};
type NativeReply={status?:number;headers?:Record<string,string>;body?:string;error?:string;value?:unknown};
declare global {interface Window{WorldwideNative?:Bridge;worldwideNativeReply?:(id:string,response:NativeReply)=>void;worldwideNativeProgress?:(saved:number,total:number)=>void}}
const callbacks=new Map<string,{resolve:(reply:NativeReply)=>void;reject:(error:Error)=>void}>();
// Java operations can outlive a page reload; replies must belong to this page.
const pageId=crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;
let installed=false,sequence=0;
export function isNativeApp(){return !!window.WorldwideNative}
export function supportsStandalone(){try{return window.WorldwideNative?.standalone?.()===true}catch{return false}}
export function setNativeOrientation(mode:'portrait'|'landscape'){const set=window.WorldwideNative?.setOrientation;if(!set)return false;try{set.call(window.WorldwideNative,mode);return true}catch{return false}}
export function nativeConnection(){return window.WorldwideNative?.connection()||''}
export function nativeUpdateAvailable(){return typeof window.WorldwideNative?.checkUpdate==='function'&&typeof window.WorldwideNative?.installUpdate==='function'}
export type NativeUpdateInfo={version:string;available:boolean;installedVersion:string};
export async function checkNativeUpdate(){const result=await invoke((bridge,id)=>{if(!bridge.checkUpdate)throw new Error('Install the current Android app once to enable in-app updates.');bridge.checkUpdate(id)});return result.value as NativeUpdateInfo}
export async function installNativeUpdate(){const result=await invoke((bridge,id)=>{if(!bridge.installUpdate)throw new Error('Install the current Android app once to enable in-app updates.');bridge.installUpdate(id)});return result.value as {status:'installer-opened'|'permission-required'}}
function invoke(send:(bridge:Bridge,id:string)=>void){return new Promise<NativeReply>((resolve,reject)=>{const bridge=window.WorldwideNative;if(!bridge){reject(new Error('This action needs the Android app.'));return}const id=`${pageId}:${++sequence}`;callbacks.set(id,{resolve,reject});try{send(bridge,id)}catch(error){callbacks.delete(id);reject(error)}})}
function base64(bytes:Uint8Array){let result='';for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result)}
export function installNativeTransport(){
 if(installed||!isNativeApp())return;installed=true;
 window.worldwideNativeReply=(id,reply)=>{const pending=callbacks.get(id);if(!pending)return;callbacks.delete(id);if(reply.error)pending.reject(new TypeError(reply.error));else pending.resolve(reply)};
 const original=window.fetch.bind(window);
 window.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return original(input,init);
  const request=new Request(url,input instanceof Request?input:init);if(input instanceof Request&&init)throw new Error('Native API requests must use URL and options.');
  if(request.signal.aborted)throw new DOMException('Aborted','AbortError');
  const body=['GET','HEAD'].includes(request.method)?'':base64(new Uint8Array(await request.arrayBuffer()));
  const operation=invoke((bridge,id)=>bridge.request(id,JSON.stringify({path:url.pathname+url.search,method:request.method,headers:Object.fromEntries(request.headers),body})));
  const reply=await new Promise<NativeReply>((resolve,reject)=>{const abort=()=>reject(new DOMException('Aborted','AbortError'));request.signal.addEventListener('abort',abort,{once:true});operation.then(resolve,reject).finally(()=>request.signal.removeEventListener('abort',abort))});
  const bytes=Uint8Array.from(atob(reply.body||''),char=>char.charCodeAt(0));
  return new Response(bytes,{status:reply.status||200,headers:reply.headers});
 };
}
export async function configureNativeConnection(url:string){await invoke((bridge,id)=>bridge.configure(id,url))}
/** Empty means the scanner was cancelled; camera frames stay on the phone. */
export async function scanNativeQr(){const result=await invoke((bridge,id)=>bridge.scanQr(id));return typeof result.value==='string'?result.value:''}
/** The native transaction keeps the current session and album until the new QR succeeds. */
export async function pairNativeQr(payload:string){await invoke((bridge,id)=>bridge.pairQr(id,payload))}
export function takeNativePairLink(){return window.WorldwideNative?.takePairLink()||''}
export function readNativeValue<T>(key:string):T|null{const value=window.WorldwideNative?.read(key);if(!value)return null;try{return JSON.parse(value) as T}catch{return null}}
export function storeNativeValue(key:string,value:unknown){window.WorldwideNative?.store(key,JSON.stringify(value))}
export function clearNativeAlbum(){window.WorldwideNative?.clearAlbum()}
export async function syncNativeAlbum(data:unknown){await invoke((bridge,id)=>bridge.syncAlbum(id,JSON.stringify(data)))}
export async function saveNativeFile(blob:Blob,name:string){if(!isNativeApp())return false;await invoke((bridge,id)=>{void blob.arrayBuffer().then(buffer=>bridge.saveFile(id,name,blob.type,base64(new Uint8Array(buffer)))).catch(error=>window.worldwideNativeReply?.(id,{error:error.message}))});return true}
