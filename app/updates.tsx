import {useEffect,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {checkNativeUpdate,installNativeUpdate,isNativeApp,nativeUpdateAvailable} from './native';
import {version} from '../package.json';
type UpdateInfo={version:string;available:boolean;installedVersion:string};
type UpdateProgress={progress:number|null;status:string};
declare global{interface Window{WorldwideDesktop?:{checkUpdate():Promise<UpdateInfo>;installUpdate():Promise<{status:string}>;onUpdateProgress(callback:(value:UpdateProgress)=>void):()=>void}}}
const base='https://github.com/KTihana/Worldwide/releases/latest/download/';
export function AppUpdates(){
 const android=isNativeApp(),desktop=window.WorldwideDesktop;
 const supported=android?nativeUpdateAvailable():!!desktop;
 const [info,setInfo]=useState<UpdateInfo|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[progress,setProgress]=useState<number|null>(null);
 useEffect(()=>{
  const change=(value:UpdateProgress)=>{setMessage(value.status);setProgress(value.progress)};
  const listener=(event:Event)=>change((event as CustomEvent<UpdateProgress>).detail);
  window.addEventListener('worldwide-update-progress',listener);const unsubscribe=desktop?.onUpdateProgress(change);
  return()=>{window.removeEventListener('worldwide-update-progress',listener);unsubscribe?.()};
 },[desktop]);
 async function check(){setBusy(true);setError('');setMessage('Checking for updates…');setProgress(null);try{const result=android?await checkNativeUpdate():await desktop!.checkUpdate();setInfo(result);setMessage(result.available?`Version ${result.version} is ready.`:'You’re up to date.')}catch(error){setError((error as Error).message);setMessage('')}finally{setBusy(false)}}
 async function install(){setBusy(true);setError('');setMessage('Preparing update…');setProgress(null);try{const result=android?await installNativeUpdate():await desktop!.installUpdate();setMessage(result.status==='permission-required'?'Allow updates from Worldwide, then return and tap Install update.':android?'Confirm Update in the Android installer.':'Installing update. Worldwide will reopen.')}catch(error){setError((error as Error).message);setMessage('')}finally{setBusy(false);setProgress(null)}}
 return <div className="app-updates"><h3><Download size={17}/> App updates</h3><p>Version {info?.installedVersion||version}</p>
  {supported?<><button className="button" disabled={busy} onClick={()=>void(info?.available?install():check())}>{busy?<RefreshCw size={16} className="spinning"/>:<Download size={16}/>} {busy?'Please wait…':info?.available?'Install update':'Check for updates'}</button>{progress!==null&&<progress aria-label="Update download" max={100} value={progress}/>}<p aria-live="polite">{message}</p>{error&&<p role="alert" className="error">{error}</p>}<small>Your photos and account stay saved.</small></>:<><a className="button" href={base+(android?'Worldwide-Android.apk':'Worldwide-Windows-Setup.exe')} target={android?undefined:'_blank'} rel="noreferrer">Download latest {android?'Android':'Windows'} app</a><small>Install this update once to enable updates inside Worldwide. Your album stays saved.</small></>}
 </div>
}
