// Update files are staged beside the album, never inside the installation or uploads.
const {mkdir,open,rename,rm,stat}=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const {join}=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const RELEASE_API='https://api.github.com/repos/KTihana/Worldwide/releases/latest';
const ASSET='Worldwide-Windows-Setup.exe',MAX_BYTES=512*1024*1024;
function versionParts(value){const match=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);if(!match)throw new Error('This release has an unsupported version.');const parts=match.slice(1).map(Number);if(parts.some(value=>!Number.isSafeInteger(value)))throw new Error('Invalid update version.');return parts}
function newer(candidate,current){const a=versionParts(candidate),b=versionParts(current);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i]}return false}
function validateRelease(data,current){
 if(!data||data.draft||data.prerelease||typeof data.tag_name!=='string')throw new Error('A stable update is not available yet.');
 const version=versionParts(data.tag_name).join('.');
 if(!newer(version,current))return {version,installedVersion:current,available:false};
 const asset=data.assets?.find(item=>item.name===ASSET);
 const expected=`https://github.com/KTihana/Worldwide/releases/download/${data.tag_name}/${ASSET}`;
 if(!asset||asset.browser_download_url!==expected||!Number.isSafeInteger(asset.size)||asset.size<2||asset.size>MAX_BYTES||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw new Error('This update is still being prepared. Please try again later.');
 return {version,installedVersion:current,available:true,url:expected,size:asset.size,sha256:asset.digest.slice(7)};
}
function trustedDownload(url,initial){const parsed=new URL(url);return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.port&&(url===initial||['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(parsed.hostname))}
async function releaseInfo(fetchImpl,current){
 const response=await fetchImpl(RELEASE_API,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Worldwide-desktop'}});
 if(!response.ok)throw new Error(response.status===403||response.status===429?'Update checks are temporarily limited. Try again later.':'Couldn’t check for updates. Check your internet connection.');
 return validateRelease(await response.json(),current);
}
async function assetResponse(fetchImpl,url){
 const initial=url;
 for(let redirects=0;redirects<5;redirects++){
  if(!trustedDownload(url,initial))throw new Error('The update download redirected to an unexpected address.');
  const response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(10*60*1000),headers:{Accept:'application/octet-stream','User-Agent':'Worldwide-desktop'}});
  if([301,302,303,307,308].includes(response.status)){const destination=response.headers.get('location');await response.body?.cancel();if(!destination)throw new Error('The update download is unavailable.');url=new URL(destination,url).href;continue}
  if(!response.ok||!response.body)throw new Error('Couldn’t download the update. Please try again.');
  return response;
 }
 throw new Error('The update download redirected too many times.');
}
async function validCached(file,release){try{if((await stat(file)).size!==release.size)return false;const digest=createHash('sha256');let signature=Buffer.alloc(0);for await(const bytes of createReadStream(file)){if(signature.length<2)signature=Buffer.concat([signature,bytes.subarray(0,2-signature.length)]);digest.update(bytes)}return signature.toString()==='MZ'&&digest.digest('hex')===release.sha256}catch{return false}}
async function downloadRelease(release,directory,fetchImpl,progress=()=>{}){
 await mkdir(directory,{recursive:true,mode:0o700});
 const destination=join(directory,`Worldwide-${release.version}-${release.sha256.slice(0,16)}.exe`);
 if(await validCached(destination,release)){progress({progress:100,status:'Ready to install'});return destination}
 const temporary=destination+'.'+randomUUID()+'.part';let file;
 try{
  const response=await assetResponse(fetchImpl,release.url);file=await open(temporary,'wx',0o600);
  const digest=createHash('sha256');let count=0,signature=Buffer.alloc(0),lastProgress=-1;
  for await(const chunk of response.body){const bytes=Buffer.from(chunk);count+=bytes.length;if(count>release.size||count>MAX_BYTES)throw new Error('The update download has an unexpected size.');if(signature.length<2)signature=Buffer.concat([signature,bytes.subarray(0,2-signature.length)]);digest.update(bytes);await file.writeFile(bytes);const percent=Math.floor(count/release.size*100);if(percent!==lastProgress){lastProgress=percent;progress({progress:percent,status:'Downloading update'})}}
  await file.sync();await file.close();file=null;
  progress({progress:100,status:'Checking download'});
  if(count!==release.size||signature.toString()!=='MZ'||digest.digest('hex')!==release.sha256)throw new Error('The update could not be verified. Please try again.');
  // A corrupt previous download is the only existing file this can replace.
  await rm(destination,{force:true});await rename(temporary,destination);return destination;
 }catch(error){await file?.close().catch(()=>{});await rm(temporary,{force:true}).catch(()=>{});throw error}
}
function createUpdater({version,directory,fetchImpl=fetch}){
 let busy=false;
 return {
  async check(){const release=await releaseInfo(fetchImpl,version);return {version:release.version,installedVersion:version,available:release.available}},
  async download(progress){if(busy)throw new Error('An update is already downloading.');busy=true;try{progress?.({progress:null,status:'Checking for updates'});const release=await releaseInfo(fetchImpl,version);if(!release.available)throw new Error('Worldwide is already up to date.');return {path:await downloadRelease(release,directory,fetchImpl,progress),version:release.version}}finally{busy=false}},
 };
}
module.exports={createUpdater,validateRelease,newer,trustedDownload,downloadRelease,RELEASE_API};
