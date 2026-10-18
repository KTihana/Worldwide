import {useEffect,useRef,useState,useSyncExternalStore,lazy,Suspense,Component,type ReactNode} from 'react';
import {LoaderCircle,LogOut,Smartphone,Copy,Check,X,RotateCw,ArrowRight,Download,Eye,EyeOff,LockKeyhole} from 'lucide-react';
import {AppUpdates} from './updates';
import {Modal} from './modal';
import {AccountFrame} from './account-frame';
const Atlas=lazy(()=>import('./atlas'));
class MapLoadBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<AccountFrame compact><div className="account-form-copy"><h1>Let’s reopen your map</h1><p>Keep your computer running, then refresh.</p></div><button className="button primary account-submit" onClick={()=>location.reload()}>Refresh<RotateCw size={17}/></button></AccountFrame>:this.props.children}
}
import {isNativeApp,nativeConnection} from './native';
import {clearOfflineAlbum,listenOffline,offlineAvailable,offlineState,readOfflineAccount,registerOffline,rememberOfflineAccount,retryOffline} from './offline';
type Session={account:{email:string}|null;needsSetup:boolean;canSetup:boolean;canReset:boolean};
async function auth(path:string,body?:unknown){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),['session','logout'].includes(path)?3500:15000);
 try{const response=await fetch(`/api/auth/${path}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal}:{cache:'no-store',signal:controller.signal});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Please try again.');return data}finally{if(timer)clearTimeout(timer)}
}
export default function AccountApp(){
 const mounted=useRef(true),sessionRequest=useRef(0);
 const [session,setSession]=useState<Session|null>(null),[error,setError]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [showPassword,setShowPassword]=useState(false);
 const [pending,setPending]=useState(false),[recovering,setRecovering]=useState(false),[menu,setMenu]=useState(false),[offlineSession,setOfflineSession]=useState(false);
 const offline=useSyncExternalStore(listenOffline,offlineState,offlineState);
 const changeComputer=isNativeApp()?<button className="text-button" onClick={()=>window.dispatchEvent(new Event('worldwide-change-computer'))}>Change computer</button>:null;
 const load=async()=>{
  const request=++sessionRequest.current;
  const stale=()=>!mounted.current||request!==sessionRequest.current;
  try{
   if(localStorage.getItem('elsewhere-pending-logout')==='1'){
    try{await auth('logout',{});localStorage.removeItem('elsewhere-pending-logout')}
    catch(error){if(stale())return;if(error instanceof TypeError||(error as Error).name==='AbortError'){setSession({account:null,needsSetup:false,canSetup:false,canReset:false});return}throw error}
   }
   if(stale())return;
   const value=await auth('session') as Session;if(stale())return;setSession(value);setOfflineSession(false);
   if(value.account)await rememberOfflineAccount(value.account.email);else await clearOfflineAlbum();
  }catch(error){
   if(stale())return;
   if(error instanceof TypeError||(error as Error).name==='AbortError'){const saved=await readOfflineAccount();if(stale())return;if(saved){setSession({...saved,canReset:false});setOfflineSession(true);return}}
   setError((error as Error).message);
  }
 };
 useEffect(()=>{mounted.current=true;void load();const expired=()=>{sessionRequest.current++;void clearOfflineAlbum();setSession(current=>current?{...current,account:null}:current);setMenu(false);setError('Please sign in again.')};window.addEventListener('album-session-expired',expired);return()=>{mounted.current=false;sessionRequest.current++;window.removeEventListener('album-session-expired',expired)}},[]);
 useEffect(()=>{if(!offlineSession)return;const retry=()=>{if(!document.hidden)void load()};window.addEventListener('online',retry);window.addEventListener('focus',retry);return()=>{window.removeEventListener('online',retry);window.removeEventListener('focus',retry)}},[offlineSession]);
 async function submit(e:React.FormEvent){
  e.preventDefault();if(recovering&&!session?.canReset)return;
  sessionRequest.current++;
  setPending(true);setError('');
  try{
   if(localStorage.getItem('elsewhere-pending-logout')==='1'){await auth('logout',{});localStorage.removeItem('elsewhere-pending-logout')}
   const result=await auth(recovering?'reset-local':session?.needsSetup?'setup':'login',recovering?{password}:{email,password});
   if(!mounted.current)return;
   setOfflineSession(false);setPassword('');setRecovering(false);
   setSession({account:result.account,needsSetup:false,canSetup:session?.canSetup||false,canReset:session?.canReset||false});
   await rememberOfflineAccount(result.account.email);
  }catch(e){setError((e as Error).message)}finally{setPending(false)}
 }
 async function signOut(){sessionRequest.current++;setPending(true);setError('');try{if(offlineSession)localStorage.setItem('elsewhere-pending-logout','1');else try{await auth('logout',{});localStorage.removeItem('elsewhere-pending-logout')}catch(error){if(!mounted.current)return;if(error instanceof TypeError||(error as Error).name==='AbortError')localStorage.setItem('elsewhere-pending-logout','1');else throw error}if(!mounted.current)return;await clearOfflineAlbum();setOfflineSession(false);setMenu(false);setSession(current=>current?{...current,account:null}:current)}catch(e){setError((e as Error).message)}finally{setPending(false)}}
 useEffect(()=>{if(session?.account)void registerOffline()},[session?.account?.email]);

 if(!session)return <AccountFrame compact><div className="account-loading">{error?<><h1>Let’s get connected</h1><p role="alert">{error}</p><button className="button primary" onClick={()=>{setError('');void load()}}>Try again<ArrowRight size={17}/></button>{changeComputer}</>:<><LoaderCircle size={26} className="spinning" aria-label="Opening your album"/><h1>Opening your world</h1><p>Your private album is on its way.</p></>}</div></AccountFrame>;
 if(!session.account)return <AccountFrame>
  <div className="account-form-copy"><h1>{session.needsSetup?'Create your account':recovering?'A fresh start.':'Welcome back.'}</h1>
  <p>{session.needsSetup?'Your travels, together in one beautiful place.':recovering?'Choose a new password. Your photos stay saved.':'Your world is right where you left it.'}</p></div>
  {recovering&&!session.canReset?<div className="account-recovery-note">
   <span className="account-note-icon"><LockKeyhole size={22}/></span><p>Open Worldwide on your computer to reset your password.</p>
   <button className="text-button" onClick={()=>{setRecovering(false);setError('')}}>Back to sign in</button>
  </div>:session.needsSetup&&!session.canSetup?<div className="account-recovery-note"><span className="account-note-icon"><Smartphone size={22}/></span><p className="account-message">Open Worldwide on your computer to create the account first. Then scan its Connect phone QR code.</p></div>:<>
   <form onSubmit={submit} aria-busy={pending}>
    {!recovering&&<label>Email<input type="email" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="username" placeholder="you@example.com" required maxLength={254} value={email} disabled={pending} onChange={e=>setEmail(e.target.value)}/></label>}
    <label>{recovering?'New password':'Password'}<span className="account-password-field"><input type={showPassword?'text':'password'} autoComplete={session.needsSetup||recovering?'new-password':'current-password'} required minLength={12} maxLength={256} placeholder={session.needsSetup||recovering?'At least 12 characters':'Your password'} value={password} disabled={pending} onChange={e=>setPassword(e.target.value)}/><button type="button" className="icon-button" aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} disabled={pending} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>
    {error&&<p className="editor-error" role="alert">{error}</p>}
    <button className="button primary account-submit" disabled={pending}>{pending?<><span>{session.needsSetup?'Creating your account…':recovering?'Saving password…':'Signing in…'}</span><LoaderCircle size={18} className="spinning"/></>:<>{session.needsSetup?'Create my account':recovering?'Reset password':'Sign in'}<ArrowRight size={18}/></>}</button>
    {!session.needsSetup&&<button type="button" className="text-button account-forgot" disabled={pending} onClick={()=>{setRecovering(!recovering);setPassword('');setShowPassword(false);setError('')}}>{recovering?'Back to sign in':'Forgot password?'}</button>}
   </form>
  </>}{changeComputer}<div className="account-form-footer"><LockKeyhole size={13}/><span>{session.needsSetup?'One account. Just for you.':'Private. Saved on your computer.'}</span></div>
 </AccountFrame>;
 return <><MapLoadBoundary><Suspense fallback={<AccountFrame compact><div className="account-loading"><LoaderCircle size={26} className="spinning" aria-label="Opening your map"/><h1>Opening your world</h1></div></AccountFrame>}><Atlas onAccount={()=>{setMenu(true);setError('')}}/></Suspense></MapLoadBoundary>
 <div className="landscape-tip"><RotateCw size={15}/><span>Turn sideways for the wide map</span></div>
 {menu&&<Modal label="Your account" className="account-modal" onClose={()=>setMenu(false)}>
  <div className="account-sheet-heading"><div className="account-identity"><div className="account-avatar" aria-hidden="true">{session.account.email.slice(0,1).toUpperCase()}</div><div><h2>Your album</h2><p className="account-email">{session.account.email}</p></div></div><button className="icon-button" aria-label="Close account" onClick={()=>setMenu(false)}><X size={21}/></button></div>
  <div className="account-settings-grid">
   {isNativeApp()?<section className="phone-connect"><h3><Smartphone size={18}/> Your computer</h3><p className="phone-address">{nativeConnection()}</p><p>Photos and changes sync both ways while connected.</p><button className="button" onClick={()=>window.dispatchEvent(new Event('worldwide-change-computer'))}>Change computer</button></section>:!offlineSession&&(session.canReset?<ConnectPhone/>:<section className="phone-connect"><h3><Smartphone size={18}/> Your local album</h3><p>Photos and changes save to your computer.</p><details className="phone-shortcut"><summary>Keep it on your home screen</summary><p>In your browser’s menu, choose Add to Home Screen. Turn your phone sideways for the full map.</p></details></section>)}
   <div className="account-device-settings"><section className="offline-account"><h3><Download size={17}/> {offlineAvailable()?'Saved on this device':'Stored on your computer'}</h3><p role="status">{offlineSession?'Viewing your saved album offline.':!offlineAvailable()?'Keep your computer running and use the same Wi-Fi to open your album here.':offline.busy?offline.phase==='map'?'Saving the map for offline use…':`Saving ${offline.saved} of ${offline.total} photos…`:offline.ready?`${offline.saved} ${offline.saved===1?'photo':'photos'} and the map are ready offline.`:offline.error||'Preparing your offline copy…'}</p>{offline.busy&&<progress aria-label="Saving offline album" max={offline.total||1} value={offline.phase==='photos'?offline.saved:undefined}/>} {offline.error&&offlineAvailable()&&<button className="button" onClick={retryOffline}>Try again</button>}</section><AppUpdates/></div>
  </div>
  {error&&<p className="editor-error" role="alert">{error}</p>}
  <div className="account-sheet-footer"><span><LockKeyhole size={12}/>Your album stays yours.</span><button className="button sign-out" disabled={pending} onClick={signOut}>{pending?<LoaderCircle size={15} className="spinning"/>:<LogOut size={15}/>} {pending?'Signing out…':'Sign out'}</button></div>
 </Modal>}
 </>;
}

type PairingCode={qr:string;pairingUrl:string;pairingId:string;expiresAt:string|number};
function ConnectPhone(){
 const [urls,setUrls]=useState<string[]>([]),[address,setAddress]=useState(''),[pair,setPair]=useState<PairingCode|null>(null);
 const [busy,setBusy]=useState(true),[error,setError]=useState(''),[copied,setCopied]=useState(false),[now,setNow]=useState(Date.now());
 const [pairStatus,setPairStatus]=useState<'waiting'|'paired'|'expired'>('waiting');
 const request=useRef(0);
 async function generate(serverUrl:string){
  const current=++request.current;setBusy(true);setError('');setPair(null);setPairStatus('waiting');
  try{
   const result=await auth('pair-start',{serverUrl,client:'web'}) as PairingCode;
   if(current!==request.current)return;
   if(!result.qr||!result.pairingId||!Number.isFinite(new Date(result.expiresAt).getTime()))throw new Error('Couldn’t create a connection code. Try again.');
   setPair(result);setNow(Date.now());
  }catch(error){if(current===request.current)setError((error as Error).message)}
  finally{if(current===request.current)setBusy(false)}
 }
 async function load(){
  const current=++request.current;setBusy(true);setError('');setPair(null);setPairStatus('waiting');
  try{
   const response=await fetch('/api/connection',{cache:'no-store'}),data=await response.json();
   if(!response.ok)throw new Error(data.error||'Couldn’t find your computer address.');
   if(current!==request.current)return;
   const available=(data.localUrls||data.urls||[]) as string[];setUrls(available);
   if(!available.length){setError('Connect your computer to Wi-Fi, then try again.');setBusy(false);return}
   setAddress(available[0]);await generate(available[0]);
  }catch(error){if(current===request.current){setError((error as Error).message);setBusy(false)}}
 }
 useEffect(()=>{void load();return()=>{request.current++}},[]);
 const paired=pairStatus==='paired';
 const expired=!paired&&(pairStatus==='expired'||!!pair&&new Date(pair.expiresAt).getTime()<=now);
 useEffect(()=>{if(!pair||pairStatus!=='waiting'||expired)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[pair,pairStatus,expired]);
 useEffect(()=>{
  if(!pair||pairStatus!=='waiting'||expired)return;
  let active=true,timer:ReturnType<typeof setTimeout>;const current=request.current;
  const poll=async()=>{
   try{
    const result=await auth(`pair-status?id=${encodeURIComponent(pair.pairingId)}`);
    if(!active||current!==request.current)return;
    if(result.status==='paired'||result.status==='expired'){setPairStatus(result.status);return}
   }catch{/* Keep a valid QR available while a status check cannot reach the server. */}
   if(active&&current===request.current)timer=setTimeout(()=>void poll(),2000);
  };
  timer=setTimeout(()=>void poll(),2000);
  return()=>{active=false;clearTimeout(timer)};
 },[pair,pairStatus,expired]);
 return <section className="phone-connect pairing-connect" aria-label="Connect phone">
  <div className="pairing-heading"><span className="pairing-device-icon"><Smartphone size={21}/></span><div><h3>Connect phone</h3><p>{paired?'Your phone is ready to sync.':'Your album, on both screens.'}</p></div></div>
  <div className="pairing-instruction"><span>1</span><p>Use the same Wi-Fi.</p><span>2</span><p>Scan with your phone’s camera.</p></div>
  <div className={`pairing-code ${paired?'paired':expired?'expired':''}`}>
   {busy?<LoaderCircle size={28} className="spinning" aria-label="Creating connection code"/>:paired?<div className="pairing-success"><Check size={42} strokeWidth={1.7}/><span>Phone connected</span></div>:pair&&!expired?<img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pair.qr)}`} alt="QR code to open Worldwide on your phone" width={200} height={200}/>:<span>{expired?'Code expired':'No connection code'}</span>}
  </div>
  {error?<p className="editor-error" role="alert">{error}</p>:<p className="pairing-status" role="status">{busy?'Preparing your code…':paired?'Photos sync while your computer is running.':expired?'Create a new code to connect.':'One use · valid for 3 minutes'}</p>}
  <button className="button pairing-refresh" disabled={busy} onClick={()=>address?void generate(address):void load()}><RotateCw size={16}/>{paired?'Connect another phone':expired?'Create new code':error?'Try again':'Refresh QR code'}</button>
  <details className="pairing-manual"><summary>Enter address manually</summary>
   {urls.length>1&&<label>Network address<select aria-label="Computer network address" value={address} disabled={busy} onChange={event=>{setAddress(event.target.value);setCopied(false);void generate(event.target.value)}}>{urls.map(url=><option key={url}>{url}</option>)}</select></label>}
   {address?<div className="phone-address"><span>{address}</span><button className="icon-button" aria-label="Copy computer address" onClick={async()=>{try{await navigator.clipboard.writeText(address);setCopied(true)}catch{setError('Select and copy the address above.')}}}>{copied?<Check size={17}/>:<Copy size={17}/>}</button></div>:<p>Connect this computer to Wi-Fi first.</p>}
   <p>Open this address in your phone’s browser and sign in.</p>
  </details>
 </section>;
}
