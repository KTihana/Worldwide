import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {readFile,stat} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {networkInterfaces} from 'node:os';
import {authRoute} from './auth.ts';
import {savePreferences} from './preferences.ts';
import {db,dataDirectory,projectRoot} from './storage.ts';
import {ApiError,errorResponse} from '../app/api/shared.ts';
import * as atlas from '../app/api/atlas/route.ts';
import * as countries from '../app/api/countries/[id]/route.ts';
import * as photos from '../app/api/photos/route.ts';
import * as photo from '../app/api/photos/[id]/route.ts';
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be between 1 and 65535.');
const tlsCert=process.env.ELSEWHERE_TLS_CERT,tlsKey=process.env.ELSEWHERE_TLS_KEY;
if(Boolean(tlsCert)!==Boolean(tlsKey))throw new Error('Set both ELSEWHERE_TLS_CERT and ELSEWHERE_TLS_KEY.');
const tlsPort=Number(process.env.ELSEWHERE_TLS_PORT||3001);
if(tlsCert&&(!Number.isInteger(tlsPort)||tlsPort<1||tlsPort>65535||tlsPort===port))throw new Error('ELSEWHERE_TLS_PORT must be a different valid port.');
const publicOrigin=process.env.ELSEWHERE_PUBLIC_ORIGIN?new URL(process.env.ELSEWHERE_PUBLIC_ORIGIN).origin:null;
if(publicOrigin&&!publicOrigin.startsWith('https://'))throw new Error('ELSEWHERE_PUBLIC_ORIGIN must use HTTPS.');
const lanAddresses=Object.values(networkInterfaces()).flat().filter(a=>a&&a.family==='IPv4'&&!a.internal).map(a=>a!.address);
const allowedHosts=new Set([port,...(tlsCert?[tlsPort]:[])].flatMap(value=>[`127.0.0.1:${value}`,`localhost:${value}`,...lanAddresses.map(address=>`${address}:${value}`)]).concat(publicOrigin?[new URL(publicOrigin).host]:[]));
const staticRoot=resolve(projectRoot,'dist');
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
const handleRequest=async(req:IncomingMessage,res:ServerResponse)=>{
 try{
  if(!allowedHosts.has(req.headers.host||''))throw new ApiError('This address is not allowed.',403);
  const protocol=(req.socket as typeof req.socket&{encrypted?:boolean}).encrypted?'https':'http';
  const url=new URL(req.url||'/',publicOrigin&&req.headers.host===new URL(publicOrigin).host?publicOrigin:`${protocol}://${req.headers.host}`);
  const clientAddress=req.socket.remoteAddress||'unknown',localConnection=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(clientAddress)&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const method=req.method||'GET',headers=new Headers();
  for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>10*1024*1024)throw new ApiError('Upload too large.',413);chunks.push(Buffer.from(chunk))}
  const request=new Request(url,{method,headers,...(!['GET','HEAD'].includes(method)?{body:Buffer.concat(chunks)}:{})});
  let response:Response;
  if(url.pathname==='/api/health'&&method==='GET')response=Response.json({app:'worldwide-local',storage:'local'});
  else if(url.pathname.startsWith('/api/auth/'))response=await authRoute(request,url.pathname.slice('/api/auth/'.length),localConnection,clientAddress);
  else if(url.pathname==='/api/connection'&&method==='GET'){const {requireAccount}=await import('./auth.ts');requireAccount(request);response=Response.json({urls:publicOrigin?[publicOrigin]:lanAddresses.map(address=>tlsCert?`https://${address}:${tlsPort}`:`http://${address}:${port}`),localUrls:lanAddresses.map(address=>`http://${address}:${port}`)},{headers:{'Cache-Control':'no-store'}})}
  else if(url.pathname==='/api/preferences'&&method==='PATCH')response=await savePreferences(request);
  else if(url.pathname==='/api/atlas'&&method==='GET')response=await atlas.GET(request);
  else if(/^\/api\/countries\/[^/]+$/.test(url.pathname)&&method==='PATCH')response=await countries.PATCH(request,{params:Promise.resolve({id:decodeURIComponent(url.pathname.split('/')[3])})});
  else if(url.pathname==='/api/photos'&&method==='POST')response=await photos.POST(request);
  else if(/^\/api\/photos\/[^/]+$/.test(url.pathname)&&['GET','PATCH','DELETE'].includes(method)){
   const params={params:Promise.resolve({id:decodeURIComponent(url.pathname.split('/')[3])})};
   response=method==='GET'?await photo.GET(request,params):method==='PATCH'?await photo.PATCH(request,params):await photo.DELETE(request,params);
  }else if(url.pathname.startsWith('/api/'))response=Response.json({error:'Not found.'},{status:404});
  else if(['GET','HEAD'].includes(method)){
   const pathname=decodeURIComponent(url.pathname),path=resolve(staticRoot,'.'+(pathname==='/'?'/index.html':pathname));
   if(!path.startsWith(staticRoot+sep))throw new ApiError('Not found.',404);
   try{if(!(await stat(path)).isFile())throw new ApiError('Not found.',404);response=new Response(Uint8Array.from(await readFile(path)),{headers:{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'}})}
   catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')response=new Response('Not found. Run npm run build if this is a new checkout.',{status:404});else throw error}
  }else response=new Response('Method not allowed.',{status:405});
  res.statusCode=response.status;
  response.headers.forEach((value,key)=>res.setHeader(key,value));
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.end(method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
 }catch(error){const response=errorResponse(error);res.statusCode=response.status;res.setHeader('Content-Type','application/json');res.end(await response.text())}
};
const server=createServer(handleRequest);
const secureServer=tlsCert&&tlsKey?createHttpsServer({cert:await readFile(tlsCert),key:await readFile(tlsKey)},handleRequest):null;
server.on('error',async(error:NodeJS.ErrnoException)=>{if(error.code==='EADDRINUSE'&&process.argv.includes('--open')){try{const response=await fetch(`http://127.0.0.1:${port}/api/health`);const health=await response.json() as {app?:string};if(['worldwide-local','elsewhere-local'].includes(health.app||'')){if(process.platform==='darwin')spawn('open',[`http://127.0.0.1:${port}`],{stdio:'ignore'}).unref();console.log(`Worldwide is already running at http://127.0.0.1:${port}`);db.close();process.exit(0)}}catch{}}console.error('Could not start Worldwide:',error.message);db.close();process.exit(1)});
secureServer?.on('error',error=>{console.error('Could not start phone HTTPS:',error.message);shutdown()});
server.listen(port,process.env.ELSEWHERE_BIND||'0.0.0.0',()=>{const url=`http://127.0.0.1:${port}`;console.log(`Worldwide is running at ${url}\nLocal data: ${dataDirectory}\nPhone on the same Wi-Fi: ${lanAddresses.map(address=>tlsCert?`https://${address}:${tlsPort}`:`http://${address}:${port}`).join(', ')}`);if(process.argv.includes('--open')&&process.platform==='darwin')spawn('open',[url],{stdio:'ignore'}).unref()});
secureServer?.listen(tlsPort,process.env.ELSEWHERE_BIND||'0.0.0.0');
function shutdown(){secureServer?.close();server.close(()=>{db.close();process.exit(0)});server.closeIdleConnections()}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
