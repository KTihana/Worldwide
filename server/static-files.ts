import {readFile,stat} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {ApiError} from './errors.ts';
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon'};
function encodings(header:string){
 return header.split(',').map(value=>{const [name,...parameters]=value.trim().toLowerCase().split(';');const q=parameters.find(value=>value.trim().startsWith('q='));return {name,quality:q?Number(q.trim().slice(2)):1}}).filter(value=>['br','gzip'].includes(value.name)&&value.quality>0&&value.quality<=1).sort((a,b)=>b.quality-a.quality||(a.name==='br'?-1:1));
}
export async function staticFile(request:Request,root:string){
 const pathname=decodeURIComponent(new URL(request.url).pathname),path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!path.startsWith(root+sep))throw new ApiError('Not found.',404);
 try{
  const original=await stat(path);if(!original.isFile())throw new ApiError('Not found.',404);
  let file=path,encoding='',info=original;
  for(const option of encodings(request.headers.get('accept-encoding')||'')){
   const candidate=path+(option.name==='br'?'.br':'.gz');
   try{const compressed=await stat(candidate);if(compressed.isFile()&&compressed.mtimeMs>=original.mtimeMs){file=candidate;encoding=option.name;info=compressed;break}}catch{}
  }
  const etag=`W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}-${encoding||'identity'}"`;
  const headers=new Headers({'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache','Vary':'Accept-Encoding','ETag':etag});
  if(encoding)headers.set('Content-Encoding',encoding);
  if(request.headers.get('if-none-match')?.split(',').map(value=>value.trim()).includes(etag))return new Response(null,{status:304,headers});
  headers.set('Content-Length',String(info.size));
  return new Response(request.method==='HEAD'?null:Uint8Array.from(await readFile(file)),{headers});
 }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return new Response('Not found. Run npm run build if this is a new checkout.',{status:404});throw error}
}
