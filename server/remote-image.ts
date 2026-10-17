import {lookup} from 'node:dns/promises';
import type {LookupAddress} from 'node:dns';
import {isIP} from 'node:net';
import {request as httpRequest,type RequestOptions} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {ApiError} from './errors.ts';

const maxImageBytes=35*1024*1024;
const redirects=new Set([301,302,303,307,308]);
const imageTypes=new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
const unavailable=()=>new ApiError('This site won’t share the image. Download it first, then add it here.',502);
const invalidUrl=()=>new ApiError('Use a public http or https image link.',400);
const timeout=()=>new ApiError('The image took too long to load. Try downloading it first.',504);
const tooLarge=()=>new ApiError('This image is too large. Choose one under 35 MB.',413);
const notImage=()=>new ApiError('This link isn’t a supported image. Copy the image itself or download it first.',415);

// Conservatively exclude IANA special-use ranges, including globally routed
// transition/anycast ranges that are not ordinary public image hosts.
// https://www.iana.org/assignments/iana-ipv4-special-registry/
// https://www.iana.org/assignments/iana-ipv6-special-registry/
export function publicAddress(address:string){
 if(isIP(address)===4){
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===0&&(c===0||c===2)||b===168||b===88&&c===99||b===31&&c===196||b===52&&c===193||b===175&&c===48))||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));
 }
 if(isIP(address)!==6||address.includes('%'))return false;
 // Only native global unicast; this also rejects mapped IPv4, NAT64, ULA,
 // unspecified, loopback, link-local, site-local, and multicast forms.
 const parts=address.toLowerCase().split(':'),first=parseInt(parts[0],16),second=parseInt(parts[1]||'0',16),third=parseInt(parts[2]||'0',16);
 return first>=0x2000&&first<=0x3fff&&!(first===0x2001&&(second<0x200||second===0xdb8))&&!(first===0x2620&&second===0x4f&&third===0x8000)&&first!==0x2002&&first!==0x3ffe&&!(first===0x3fff&&second<0x1000);
}
export function imageUrl(value:unknown){
 if(typeof value!=='string'||value.length>8192||/[\u0000-\u0020\u007f]/.test(value))throw invalidUrl();
 let url:URL;try{url=new URL(value)}catch{throw invalidUrl()}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!url.hostname)throw invalidUrl();
 const host=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
 if(host==='localhost'||/\.(localhost|local|internal|home|lan|test|invalid)$/.test(host)||!host.includes('.')&&!isIP(host))throw invalidUrl();
 if(isIP(host)&&!publicAddress(host))throw invalidUrl();
 url.hash='';return url;
}
export type RemoteResponse={status:number;headers:Record<string,string|string[]|undefined>;body:AsyncIterable<Uint8Array>;close:()=>void};
type RemoteDependencies={resolve?:(host:string)=>Promise<LookupAddress[]>;open?:(url:URL,address:LookupAddress,signal:AbortSignal)=>Promise<RemoteResponse>;maxBytes?:number;timeoutMs?:number;concurrency?:number};

// Passing a literal vetted IP as hostname means the HTTP client cannot resolve
// it again. Preserve the original Host and TLS identity, without sharing agents,
// proxies, credentials, cookies, or headers from the inbound application request.
export function pinnedRequestOptions(url:URL,address:LookupAddress,signal:AbortSignal):RequestOptions&{servername?:string;checkServerIdentity:typeof checkServerIdentity}{
 const hostname=url.hostname.replace(/^\[|\]$/g,'');
 return {protocol:url.protocol,hostname:address.address,family:address.family,port:url.port||undefined,path:url.pathname+url.search,method:'GET',agent:false,signal,maxHeaderSize:16384,headers:{Host:url.host,Accept:'image/jpeg,image/png,image/webp,image/gif,image/avif','Accept-Encoding':'identity','User-Agent':'Worldwide/1.0'},servername:isIP(hostname)?undefined:hostname,checkServerIdentity:(_host,certificate)=>checkServerIdentity(hostname,certificate)};
}
function openPinned(url:URL,address:LookupAddress,signal:AbortSignal):Promise<RemoteResponse>{
 return new Promise((resolve,reject)=>{
  const req=(url.protocol==='https:'?httpsRequest:httpRequest)(pinnedRequestOptions(url,address,signal),response=>{
   resolve({status:response.statusCode||0,headers:response.headers,body:response,close:()=>response.destroy()});
  });
  req.on('error',reject);req.end();
 });
}
function abortable<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(timeout())};
  operation.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
 });
}
function header(response:RemoteResponse,name:string){const value=response.headers[name];return typeof value==='string'?value:''}
function imageSignature(bytes:Buffer,type:string){
 if(type==='image/jpeg')return bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 if(type==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(type==='image/gif')return ['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6));
 if(type==='image/webp')return bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(type==='image/avif')return bytes.toString('ascii',4,8)==='ftyp'&&/avif|avis/.test(bytes.toString('ascii',8,64));
 return false;
}
export function createRemoteImageImporter(dependencies:RemoteDependencies={}){
 const resolve=dependencies.resolve||((host:string)=>lookup(host,{all:true,verbatim:true}));
 const open=dependencies.open||openPinned,limit=dependencies.maxBytes??maxImageBytes;
 let active=0;
 return async(value:unknown)=>{
  let url=imageUrl(value);
  if(active>=(dependencies.concurrency??2))throw new ApiError('Two images are already loading. Try again in a moment.',429);
  active++;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),dependencies.timeoutMs??15000);
  let response:RemoteResponse|undefined;
  try{
   for(let hop=0;;hop++){
    const host=url.hostname.replace(/^\[|\]$/g,''),family=isIP(host);
    const addresses=family?[{address:host,family}]:await abortable(resolve(host),controller.signal);
    if(!addresses.length||addresses.some(address=>!publicAddress(address.address)||address.family!==isIP(address.address)))throw invalidUrl();
    // Prefer IPv4 for broad desktop connectivity; every DNS result was checked.
    const address=addresses.find(address=>address.family===4)||addresses[0];
    response=await abortable<RemoteResponse>(open(url,address,controller.signal).then(value=>{if(controller.signal.aborted){value.close();throw timeout()}return value}),controller.signal);
    if(redirects.has(response.status)){
     const location=header(response,'location');response.close();response=undefined;
     if(hop>=3||!location)throw unavailable();
     let next:URL;try{next=new URL(location,url)}catch{throw invalidUrl()}
     url=imageUrl(next.href);continue;
    }
    if(response.status!==200)throw unavailable();
    const type=header(response,'content-type').split(';')[0].trim().toLowerCase().replace(/^image\/jpg$/,'image/jpeg');
    if(!imageTypes.has(type))throw notImage();
    const encoding=header(response,'content-encoding').toLowerCase();if(encoding&&encoding!=='identity')throw unavailable();
    const length=header(response,'content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>limit))throw tooLarge();
    const chunks:Buffer[]=[];let size=0;
    const iterator=response.body[Symbol.asyncIterator]();
    while(true){
     const chunk=await abortable(iterator.next(),controller.signal);if(chunk.done)break;
     size+=chunk.value.byteLength;if(size>limit)throw tooLarge();chunks.push(Buffer.from(chunk.value));
    }
    const bytes=Buffer.concat(chunks);if(!imageSignature(bytes,type))throw notImage();
    return {bytes,type};
   }
  }catch(error){if(controller.signal.aborted)throw timeout();if(error instanceof ApiError)throw error;throw unavailable()}
  finally{response?.close();controller.abort();clearTimeout(timer);active--}
 };
}
