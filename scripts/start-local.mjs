import {spawn} from 'node:child_process';
import {access,mkdir,open,readdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const minimum=process.versions.node.split('.').map(Number);if(minimum[0]<22||minimum[0]===22&&minimum[1]<18){console.error('Worldwide needs Node.js 22.18 or newer. Install Node.js from https://nodejs.org, then open this launcher again.');process.exit(1)}
const root=resolve(import.meta.dirname,'..'),data=resolve(process.env.ELSEWHERE_DATA_DIR||join(root,'data'));
const port=Number(process.env.PORT||3000),url=`http://127.0.0.1:${port}`;
async function exists(path){try{await access(path);return true}catch{return false}}
async function ready(){try{const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});return ['worldwide-local','elsewhere-local'].includes((await response.json()).app)}catch{return false}}
function browser(){const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open',args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];const child=spawn(command,args,{detached:true,windowsHide:true,stdio:'ignore'});child.on('error',()=>console.log(`Open ${url} in your browser.`));child.unref()}
async function newer(path,time){try{const entry=await stat(path);if(entry.isFile())return entry.mtimeMs>time;if(entry.isDirectory()){for(const item of await readdir(path))if(await newer(join(path,item),time))return true}return false}catch{return true}}
async function buildIfNeeded(){
 if(!await exists(join(root,'node_modules','vite')))throw new Error(`First-time setup: open a terminal in ${root} and run npm ci. Then open this launcher again.`);
 const marker=join(root,'dist/offline-assets.json');let rebuild=!await exists(marker);
 if(!rebuild){const time=(await stat(marker)).mtimeMs;for(const name of ['app','server','public','scripts','package.json','package-lock.json','index.html','vite.config.ts'])if(await newer(join(root,name),time)){rebuild=true;break}}
 if(rebuild){console.log('Preparing Worldwide…');await new Promise((resolve,reject)=>{const child=spawn(process.platform==='win32'?'npm.cmd':'npm',['run','build'],{cwd:root,stdio:'inherit',shell:process.platform==='win32'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('The website could not be prepared. Run npm run build to see the problem.')))})}
}
try{
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be between 1 and 65535.');
 await buildIfNeeded();
 if(await ready()){browser();console.log(`Worldwide is open at ${url}`);process.exit(0)}
 await mkdir(data,{recursive:true});const logPath=join(data,'worldwide-server.log'),log=await open(logPath,'a',0o600);
 const env={...process.env,ELSEWHERE_DATA_DIR:data};
 if(await exists(join(data,'tls/server.crt'))&&await exists(join(data,'tls/server.key'))){env.ELSEWHERE_TLS_CERT=join(data,'tls/server.crt');env.ELSEWHERE_TLS_KEY=join(data,'tls/server.key')}
 const server=spawn(process.execPath,[join(root,'server/index.ts')],{cwd:root,env,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});let spawnError;server.once('error',error=>spawnError=error);server.once('exit',()=>{spawnError=new Error(`Worldwide could not start. See ${logPath}`)});server.unref();await log.close();
 for(let attempt=0;attempt<40;attempt++){if(spawnError)throw spawnError;if(await ready()){browser();console.log(`Worldwide is running at ${url}. You can close this window.`);process.exit(0)}await new Promise(resolve=>setTimeout(resolve,250))}
 throw new Error(`Worldwide could not start. See ${logPath}`);
}catch(error){console.error(error.message);process.exitCode=1}
