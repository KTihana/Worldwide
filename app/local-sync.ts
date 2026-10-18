import {nativeConnection,supportsStandalone} from './native';

export type LocalSyncStatus={paired:boolean;connected:boolean;pending:number;lastSynced:string|null;error:string;account:{email:string;username?:string|null}|null};
let status:LocalSyncStatus|null=null,revision=0,inFlight:Promise<LocalSyncStatus|null>|null=null;
const listeners=new Set<()=>void>();
export const localSyncState=()=>status;
export function listenLocalSync(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
function publish(value:LocalSyncStatus){if(JSON.stringify(value)===JSON.stringify(status))return;status=value;for(const listener of listeners)listener()}
export function resetLocalSync(){revision++;inFlight=null;publish({paired:false,connected:false,pending:0,lastSynced:null,error:'',account:null})}
export function updateLocalSyncAccount(account:NonNullable<LocalSyncStatus['account']>){if(!supportsStandalone()||!status?.paired)return;revision++;inFlight=null;publish({...status,account})}
/** Atlas calls this alongside its existing refresh; it never delays local saves. */
export function refreshLocalSync(){
 if(!supportsStandalone())return Promise.resolve(null);
 if(inFlight)return inFlight;
 const current=revision;
 const operation=(async()=>{
  try{
   const response=await fetch('/api/local-status',{cache:'no-store',signal:AbortSignal.timeout(6000)});
   if(!response.ok)throw new Error('Sync status unavailable');
   const value=await response.json() as LocalSyncStatus;
   if(current===revision)publish(value);
  }catch{if(current===revision)publish({...(status||{paired:!!nativeConnection(),pending:0,lastSynced:null,account:null}),connected:false,error:'Sync is waiting. Your photos are saved on this phone.'})}
  return status;
 })();
 inFlight=operation;
 void operation.finally(()=>{if(inFlight===operation)inFlight=null});
 return operation;
}
export async function syncLocalNow(){
 if(!supportsStandalone())return;
 const current=revision;
 const response=await fetch('/api/local-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(8000)});
 const value=await response.json();
 if(!response.ok)throw new Error(value.error||'Sync is waiting. Your photos stay on this phone.');
 if(current===revision&&typeof value.paired==='boolean')publish(value as LocalSyncStatus);
}
