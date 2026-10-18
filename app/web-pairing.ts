export type WebPairingLink={token:string;error:string};
export class WebPairingError extends Error {
 constructor(message:string,readonly retryable=true){super(message);this.name='WebPairingError';}
}

/** Fragments never reach the HTTP server. Remove this one before any async work. */
export function consumeWebPairingLink(location:Pick<Location,'hash'|'pathname'|'search'>,history:Pick<History,'state'|'replaceState'>):WebPairingLink|null{
 if(!location.hash.startsWith('#worldwide-pair'))return null;
 const match=/^#worldwide-pair=([a-f0-9]{64})$/.exec(location.hash);
 history.replaceState(history.state,'',location.pathname+location.search);
 return match?{token:match[1],error:''}:{token:'',error:'This connection link is incomplete. Scan a new QR code on your computer.'};
}

export async function completeWebPairing(token:string,request:typeof fetch=fetch){
 if(!/^[a-f0-9]{64}$/.test(token))throw new WebPairingError('Scan a new QR code on your computer.',false);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await request('/api/auth/pair-complete',{method:'POST',credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),signal:controller.signal});
  const result=await response.json();
  if(!response.ok)throw new WebPairingError(typeof result.error==='string'?result.error:'Couldn’t connect. Scan a new QR code on your computer.',response.status!==401);
  if(typeof result.account?.email!=='string')throw new WebPairingError('The computer returned an incomplete response. Please try again.');
 }catch(error){
  if(error instanceof TypeError||(error as Error).name==='AbortError')throw new WebPairingError('Couldn’t reach your computer. Keep Worldwide running and use the same Wi-Fi.');
  if(error instanceof SyntaxError)throw new WebPairingError('The computer returned an incomplete response. Please try again.');
  throw error;
 }finally{clearTimeout(timer);}
}
