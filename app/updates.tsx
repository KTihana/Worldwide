import {useCallback,useEffect,useState} from 'react';
import {Check,RefreshCw} from 'lucide-react';
import {websiteChanged,type WebsiteInfo} from './website-update';
// Capture the page's original entry assets before lazy country/map styles load.
const loadedAssets=Array.from(document.querySelectorAll<HTMLScriptElement|HTMLLinkElement>('script[type="module"][src],link[rel="stylesheet"][href]')).map(element=>new URL(element instanceof HTMLScriptElement?element.src:element.href,location.href).pathname).sort();
const loadedBuild=document.querySelector<HTMLMetaElement>('meta[name="worldwide-build"]')?.content||'';
export function AppUpdates(){
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
