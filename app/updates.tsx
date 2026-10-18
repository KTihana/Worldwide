import {useCallback,useEffect,useState} from 'react';
import {Check,RefreshCw} from 'lucide-react';
import {websiteChanged,type WebsiteInfo} from './website-update';
import {checkNativeUpdate,installNativeUpdate,supportsStandalone,type NativeUpdateInfo} from './native';
// Capture the page's original entry assets before lazy country/map styles load.
const loadedAssets=Array.from(document.querySelectorAll<HTMLScriptElement|HTMLLinkElement>('script[type="module"][src],link[rel="stylesheet"][href]')).map(element=>new URL(element instanceof HTMLScriptElement?element.src:element.href,location.href).pathname).sort();
const loadedBuild=document.querySelector<HTMLMetaElement>('meta[name="worldwide-build"]')?.content||'';
export function AppUpdates(){
 return supportsStandalone()?<NativeUpdates/>:<WebsiteUpdates/>;
}
function NativeUpdates(){
 const [info,setInfo]=useState<NativeUpdateInfo|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[progress,setProgress]=useState<number|null>(null);
 useEffect(()=>{const update=(event:Event)=>{const detail=(event as CustomEvent<{progress?:number}>).detail;if(typeof detail?.progress==='number')setProgress(detail.progress>=0&&detail.progress<=100?detail.progress:null)};window.addEventListener('worldwide-update-progress',update);return()=>window.removeEventListener('worldwide-update-progress',update)},[]);
 async function check(){setBusy(true);setMessage('');try{setInfo(await checkNativeUpdate())}catch{setMessage('Go online to check for app updates.')}finally{setBusy(false)}}
 async function install(){
  if(!window.dispatchEvent(new Event('worldwide-before-refresh',{cancelable:true}))){setMessage('Finish your current upload or edit first.');return}
  setBusy(true);setProgress(null);setMessage('Preparing update…');
  try{const result=await installNativeUpdate();setMessage(result.status==='permission-required'?'Allow app updates, then tap Install update again.':'Finish installing the update. Your photos stay on this phone.')}
  catch(error){setMessage((error as Error).message||'Couldn’t prepare the update. Please try again.')}
  finally{setBusy(false);setProgress(null)}
 }
 return <div className="app-updates"><h3><RefreshCw size={17}/> App updates</h3>{info&&<p>Version {info.installedVersion} · {info.available?`${info.version} is available.`:'Up to date'}</p>}<button className="button" disabled={busy} onClick={()=>void(info?.available?install():check())}>{busy?<RefreshCw size={16} className="spinning"/>:<Check size={16}/>} {busy?progress===null?info?.available?'Preparing…':'Checking…':`Downloading ${progress}%`:info?.available?'Install update':'Check for updates'}</button><p aria-live="polite">{message}</p><small>Your photos stay on this phone. No computer needed.</small></div>;
}
function WebsiteUpdates(){
 const [info,setInfo]=useState<WebsiteInfo|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[available,setAvailable]=useState(false);
 const check=useCallback(async()=>{
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/version',{cache:'no-store',signal:AbortSignal.timeout(5000)});
   if(!response.ok)throw new Error('Connection unavailable');
   const value=await response.json() as WebsiteInfo;
   if(!Array.isArray(value.entryAssets)||!value.entryAssets.length)throw new Error('The website is updating');
   setInfo(value);setAvailable(websiteChanged(loadedBuild,loadedAssets,value));
  }catch{setMessage('Connect to your computer to check for updates.')}finally{setBusy(false)}
 },[]);
 useEffect(()=>{void check();const online=()=>void check();window.addEventListener('online',online);return()=>window.removeEventListener('online',online)},[check]);
 async function refresh(){
  const event=new Event('worldwide-before-refresh',{cancelable:true});
  if(!window.dispatchEvent(event)){setMessage('Finish your current upload or edit, then refresh.');return}
  // Refresh is always a deliberate action. Offline data and cookies stay in place.
  setBusy(true);setMessage('Refreshing…');
  try{const response=await fetch('/api/version',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('Offline');if(!window.dispatchEvent(new Event('worldwide-before-refresh',{cancelable:true}))){setMessage('Finish your current upload or edit, then refresh.');setBusy(false);return}window.location.reload()}catch{setMessage('Reconnect to your computer, then refresh.');setBusy(false)}
 }
 return <div className="app-updates"><h3><RefreshCw size={17}/> Website updates</h3>
  {info&&<p>Version {info.version} · {available?'A newer website is ready.':'Up to date'}</p>}
  <button className="button" disabled={busy} onClick={()=>void(available?refresh():check())}>{busy?<RefreshCw size={16} className="spinning"/>:available?<RefreshCw size={16}/>:<Check size={16}/>} {busy?'Checking…':available?'Refresh to update':'Check for updates'}</button>
  <p aria-live="polite">{message}</p><small>Your photos and account stay saved.</small>
 </div>
}
