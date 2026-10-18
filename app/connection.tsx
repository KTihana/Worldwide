import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowRight,LoaderCircle,Monitor,QrCode,Wifi} from 'lucide-react';
import {configureNativeConnection,isNativeApp,nativeConnection,pairNativeQr,scanNativeQr,takeNativePairLink,supportsStandalone} from './native';
import './connection.css';
import {AccountFrame} from './account-frame';
import {usePhoneOrientation} from './orientation';
import {completeWebPairing,consumeWebPairingLink,type WebPairingLink} from './web-pairing';
// Capture once, outside React's render/effect retries; never persist a pairing token.
const initialWebLink=!isNativeApp()?consumeWebPairingLink(location,history):null;
export default function ConnectionGate({children}:{children:ReactNode}){
 return isNativeApp()?<NativeConnectionGate>{children}</NativeConnectionGate>:<WebConnectionGate>{children}</WebConnectionGate>;
}
function WebConnectionGate({children}:{children:ReactNode}){
 const [link,setLink]=useState<WebPairingLink|null>(initialWebLink),[busy,setBusy]=useState(!!initialWebLink?.token),[error,setError]=useState(initialWebLink?.error||''),[retryable,setRetryable]=useState(true);
 usePhoneOrientation(link?'portrait':null,20);
 const attempts=useRef(new Map<string,Promise<void>>()),generation=useRef(0);
 async function connect(value:WebPairingLink){
  if(!value.token){setBusy(false);setError(value.error);return;}
  const current=++generation.current;setBusy(true);setError('');
  let operation=attempts.current.get(value.token);
  if(!operation){operation=completeWebPairing(value.token);attempts.current.set(value.token,operation);}
  try{await operation;if(current!==generation.current)return;try{localStorage.removeItem('elsewhere-pending-logout');}catch{}setLink(null);}
  catch(error){if(current===generation.current){setError((error as Error).message);setRetryable((error as {retryable?:boolean}).retryable!==false);}}
  finally{if(current===generation.current)setBusy(false);}
 }
 useEffect(()=>{if(link)void connect(link);},[link]);
 useEffect(()=>{const incoming=()=>{const next=consumeWebPairingLink(location,history);if(next)setLink(next);};window.addEventListener('hashchange',incoming);return()=>window.removeEventListener('hashchange',incoming);},[]);
 if(!link)return children;
 return <AccountFrame compact cardClassName="web-connection-card"><div className="connection-emblem"><Monitor size={25}/></div><div className="account-form-copy"><h1>{busy?'Opening your album…':'Let’s reconnect.'}</h1>{busy?<p className="connection-progress" role="status"><LoaderCircle size={17} className="spinning"/> Connecting to your computer.</p>:<p>Scan a fresh code to open your private album.</p>}</div>{!busy&&<><p className="editor-error" role="alert">{error}</p><div className="account-recovery-note"><p>On your computer, open <strong>Your album → Connect phone</strong> to show a new QR code.</p></div>{link.token&&retryable&&<button className="button primary account-submit" onClick={()=>{attempts.current.delete(link.token);void connect(link);}}>Try again<ArrowRight size={17}/></button>}<button className="text-button" onClick={()=>{generation.current++;setLink(null);}}>Continue to sign in</button></>}</AccountFrame>;
}
function NativeConnectionGate({children}:{children:ReactNode}){
 const standalone=supportsStandalone();
 const [initialLink]=useState(()=>isNativeApp()?takeNativePairLink():''),[editing,setEditing]=useState(()=>isNativeApp()&&(!!initialLink||!standalone&&!nativeConnection()));
 const [address,setAddress]=useState(nativeConnection),[manual,setManual]=useState(false),[manualReady,setManualReady]=useState(false),[identifier,setIdentifier]=useState(''),[password,setPassword]=useState('');
 const [busy,setBusy]=useState(false),[phase,setPhase]=useState(''),[error,setError]=useState('');
 usePhoneOrientation(editing?'portrait':null,20);
 const working=useRef(false),operation=useRef(0);
 function complete(current:number){localStorage.removeItem('elsewhere-pending-logout');if(current===operation.current)location.reload();else window.dispatchEvent(new Event('worldwide-local-connection-changed'))}
 async function scan(payload?:string){
  if(working.current)return;
  const current=++operation.current;working.current=true;setEditing(true);setBusy(true);setError('');setPhase(payload?'Connecting…':'Opening camera…');
  try{const value=payload||await scanNativeQr();if(value&&current===operation.current){setPhase('Connecting…');await pairNativeQr(value);complete(current)}}
  catch(error){if(current===operation.current)setError((error as Error).message)}
  finally{if(current===operation.current){working.current=false;setBusy(false);setPhase('')}}
 }
 async function connectManually(event:React.FormEvent){
  event.preventDefault();if(working.current)return;
  const current=++operation.current;working.current=true;setBusy(true);setError('');setPhase('Connecting…');
  try{
   if(standalone&&manualReady){
    const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:identifier.trim(),password}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Couldn’t connect. Please try again.');
    setPassword('');complete(current);
   }else{
    await configureNativeConnection(address);
    if(standalone){if(current===operation.current)setManualReady(true)}else complete(current);
   }
  }catch(error){if(current===operation.current)setError((error as Error).message)}
  finally{if(current===operation.current){working.current=false;setBusy(false);setPhase('')}}
 }
 function back(){operation.current++;working.current=false;setBusy(false);setPhase('');setPassword('');setEditing(false)}
 useEffect(()=>{
  const edit=()=>{setAddress(nativeConnection());setManual(false);setManualReady(false);setPassword('');setError('');setEditing(true)};
  const link=()=>{if(working.current)return;const value=takeNativePairLink();if(value)void scan(value)};
  window.addEventListener('worldwide-change-computer',edit);window.addEventListener('worldwide-connect-computer',edit);window.addEventListener('worldwide-pair-link',link);
  if(initialLink)void scan(initialLink);else link();
  return()=>{window.removeEventListener('worldwide-change-computer',edit);window.removeEventListener('worldwide-connect-computer',edit);window.removeEventListener('worldwide-pair-link',link)};
 },[initialLink]);
 if(!isNativeApp()||!editing)return children;
 return <AccountFrame className="connection-screen" cardClassName="connection-card"><div className="connection-intro"><div className="connection-emblem"><Monitor size={27}/></div><h1>{standalone?'Connect a computer':'Your world. Both screens.'}</h1>{manual&&manualReady?<p>Sign in to the account on your computer.</p>:<><p>On your computer, open <strong>Your album → Connect phone</strong>.</p><p>{standalone?'Scan its QR code to sync your albums.':'Scan its QR code to sign in and sync.'}</p></>}</div>
  <div className="connection-actions">{manual?<form onSubmit={connectManually}>
   {standalone&&manualReady?<><label>Email or username<input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={identifier} onChange={event=>setIdentifier(event.target.value)} placeholder="Email or username" required maxLength={254} disabled={busy}/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} placeholder="Your computer password" required maxLength={256} disabled={busy}/></label></>:<label>Computer address<input type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="url" value={address} onChange={event=>setAddress(event.target.value)} placeholder="http://192.168.1.20:3000" required disabled={busy}/></label>}
   <button className="button primary account-submit" disabled={busy}>{busy?<><LoaderCircle size={18} className="spinning"/>{phase}</>:<>{standalone&&!manualReady?'Continue':'Connect'}<ArrowRight size={18}/></>}</button>
   <button className="text-button" type="button" disabled={busy} onClick={()=>{setManual(false);setManualReady(false);setPassword('');setError('')}}>Scan a QR code instead</button>
  </form>:<><button className="button primary connection-scan" disabled={busy} onClick={()=>void scan()}>{busy?<><LoaderCircle size={22} className="spinning"/>{phase}</>:<><QrCode size={24}/>Scan computer QR</>}</button><p className="connection-help"><Wifi size={15}/><span>{standalone?'Use the same Wi-Fi to connect. Your photos stay on this phone.':'Use the same Wi-Fi. Your computer stays in charge of your album.'}</span></p><button className="text-button" disabled={busy} onClick={()=>{setManual(true);setManualReady(false);setError('')}}>Enter address instead</button></>}
   {error&&<p className="editor-error" role="alert">{error}</p>}
   {(standalone||nativeConnection())&&<button className="text-button" disabled={busy&&!standalone} onClick={back}>{standalone?'Keep using this phone':'Back to my album'}</button>}
  </div><div className="account-form-footer"><Wifi size={13}/><span>{standalone?'Photos stay saved on this phone.':'Your synced photos stay available offline.'}</span></div>
 </AccountFrame>;
}
