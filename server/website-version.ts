import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import packageInfo from '../package.json' with {type:'json'};
export function entryAssets(html:string){
 const assets:string[]=[];
 for(const tag of html.match(/<(?:script|link)\b[^>]*>/gi)||[]){
  const attribute=(name:string)=>new RegExp(`\\b${name}=["']([^"']+)["']`,'i').exec(tag)?.[1];
  const asset=/^<script\b/i.test(tag)&&attribute('type')==='module'?attribute('src'):/^<link\b/i.test(tag)&&attribute('rel')==='stylesheet'?attribute('href'):null;
  if(asset)assets.push(new URL(asset,'http://worldwide.local').pathname);
 }
 return [...new Set(assets)].sort();
}
export async function websiteVersion(distRoot:string){
 try{
  const [html,manifest]=await Promise.all([readFile(join(distRoot,'index.html'),'utf8'),readFile(join(distRoot,'offline-assets.json'),'utf8')]);
  const build=JSON.parse(manifest).version;
  if(typeof build!=='string'||!/^[a-f0-9]{16}$/.test(build))throw new Error('Build is incomplete');
  const marker=/<meta name="worldwide-build" content="([^"]*)">/.exec(html)?.[1];
  if(marker&&marker!==build)throw new Error('Build is incomplete');
  return Response.json({version:packageInfo.version,build,entryAssets:entryAssets(html)},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'The website is updating. Try again in a moment.'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
