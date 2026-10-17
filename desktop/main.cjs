const {app,BrowserWindow,Menu,dialog,shell,utilityProcess,ipcMain,clipboard}=require('electron');
const {join,resolve,dirname,relative,isAbsolute}=require('node:path');
const {spawn}=require('node:child_process');
const {createUpdater}=require('./updates.cjs');
const {existsSync,readFileSync,writeFileSync,mkdirSync}=require('node:fs');
app.setName('Worldwide');
app.setPath('userData',join(app.getPath('appData'),'Worldwide'));
let window,server,closing=false,externalServer=false;
const port=Number(process.env.PORT||3000),origin=`http://127.0.0.1:${port}`;
const runtime=app.isPackaged?join(process.resourcesPath,'runtime'):resolve(__dirname,'../desktop-runtime');
const updater=createUpdater({version:app.getVersion(),directory:join(app.getPath('userData'),'updates')});
let updating=false,stoppingServer=false;
const settingsPath=()=>join(app.getPath('userData'),'desktop-settings.json');
function settings(){try{return JSON.parse(readFileSync(settingsPath(),'utf8'))}catch{return {}}}
function albumDirectory(){return process.env.ELSEWHERE_DATA_DIR||settings().albumDirectory||join(app.getPath('userData'),'album')}
async function healthy(){try{const response=await fetch(`${origin}/api/health`,{signal:AbortSignal.timeout(700)});const data=await response.json();return ['elsewhere-local','worldwide-local'].includes(data.app)}catch{return false}}
async function startServer(){
 if(await healthy()){externalServer=true;return}
 const dataDirectory=albumDirectory();mkdirSync(dataDirectory,{recursive:true});
 const env={...process.env,PORT:String(port),ELSEWHERE_DATA_DIR:dataDirectory,ELSEWHERE_BIND:'0.0.0.0'};
 // Reuse a trusted phone certificate when the album already has one.
 if(existsSync(join(dataDirectory,'tls/server.crt'))&&existsSync(join(dataDirectory,'tls/server.key'))){env.ELSEWHERE_TLS_CERT=join(dataDirectory,'tls/server.crt');env.ELSEWHERE_TLS_KEY=join(dataDirectory,'tls/server.key');env.ELSEWHERE_TLS_PORT=String(port+1)}
 server=utilityProcess.fork(join(runtime,'server/index.js'),[],{env,stdio:'pipe',serviceName:'Worldwide album'});
 let serverError='';server.stderr?.on('data',data=>{serverError+=data.toString();process.stderr.write(data)});server.stdout?.on('data',data=>process.stdout.write(data));
 server.on('exit',code=>{const resume=stoppingServer&&!closing;server=null;stoppingServer=false;if(resume){void startServer().catch(error=>dialog.showErrorBox('Could not reopen your album',error.message))}else if(!closing&&window){dialog.showErrorBox('Worldwide stopped',`Your album server stopped (${code}). Reopen Worldwide to reconnect.`);app.quit()}});
 for(let attempt=0;attempt<80;attempt++){if(await healthy())return;await new Promise(r=>setTimeout(r,150));if(!server)break}
 throw new Error(serverError||'Could not start the album server. Check that port 3000 is available.');
}
async function chooseAlbum(){
 if(externalServer){await dialog.showMessageBox(window,{type:'info',message:'Close the separately running album server first.',detail:'Worldwide is connected to the album already running on this computer. Close that server and reopen Worldwide before choosing another album.'});return}
 const selection=await dialog.showOpenDialog(window,{title:'Choose an existing Worldwide album folder',properties:['openDirectory']});
 if(selection.canceled)return;const folder=selection.filePaths[0];
 if(!existsSync(join(folder,'atlas.sqlite'))){await dialog.showMessageBox(window,{type:'info',message:'Choose the folder containing atlas.sqlite.',detail:'For your original local app, this is the elsewhere/data folder. Its uploads folder should be beside the database.'});return}
 writeFileSync(settingsPath(),JSON.stringify({albumDirectory:folder}),{mode:0o600});app.relaunch();app.quit();
}
function createWindow(){
 window=new BrowserWindow({width:1440,height:920,minWidth:820,minHeight:540,title:'Worldwide',icon:join(runtime,'dist/icon-512.png'),backgroundColor:'#dbe9ec',autoHideMenuBar:process.platform!=='darwin',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 const updateUrls=new Set(['https://github.com/KTihana/Worldwide/releases/latest/download/Worldwide-Windows-Setup.exe','https://github.com/KTihana/Worldwide/releases/latest/download/Worldwide-Android.apk']);
 window.webContents.setWindowOpenHandler(({url})=>{if(updateUrls.has(url))void shell.openExternal(url);return {action:'deny'}});
 window.webContents.on('will-navigate',(event,url)=>{if(!trustedPage(url))event.preventDefault()});
 window.webContents.on('context-menu',async()=>{const items=await clipboard.read().catch(()=>[]);if(!window||window.isDestroyed())return;Menu.buildFromTemplate([{role:'paste',label:'Paste',enabled:items.some(item=>item.types.some(type=>type.startsWith('image/')||type.startsWith('text/')))}]).popup({window})});
 window.loadURL(origin);
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform==='darwin'?[{label:'Worldwide',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{type:'separator'},{role:'quit'}]}]:[]),
  {label:'File',submenu:[{label:'Choose album folder…',click:chooseAlbum},{label:'Show album folder',enabled:!externalServer,click:()=>shell.openPath(albumDirectory())},{label:'Open in browser',click:()=>shell.openExternal(origin)},{type:'separator'},{role:'quit'}]},
  {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
  {label:'View',submenu:[{role:'reload'},{role:'togglefullscreen'}]},
  {label:'Help',submenu:[{label:'Check for updates…',click:()=>void showUpdateDialog()}]},
 ]));
}
function trustedPage(url){try{const parsed=new URL(url);return parsed.origin===origin&&['/','/index.html'].includes(parsed.pathname)}catch{return false}}
function requireTrustedSender(event){if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!trustedPage(event.senderFrame.url))throw new Error('This update request is not allowed.')}
function updateProgress(value){if(window&&!window.isDestroyed())window.webContents.send('worldwide:update-progress',value)}
function supportedUpdater(){if(stoppingServer)throw new Error('Your last upload is finishing. Try the update again shortly.');if(process.platform!=='win32'||!app.isPackaged)throw new Error('In-app installation is available in the installed Windows app.');if(externalServer)throw new Error('Close the separately running Worldwide server and reopen this app before updating.');const relativeAlbum=relative(dirname(process.execPath),resolve(albumDirectory()));if(relativeAlbum===''||!relativeAlbum.startsWith('..')&&!isAbsolute(relativeAlbum))throw new Error('Move your album outside the application folder before updating, then choose its new folder in File → Choose album folder.')}
async function stopAlbumServer(){const child=server;if(!child)return;stoppingServer=true;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Your last upload is still finishing. Try the update again shortly.')),60000);child.once('exit',()=>{clearTimeout(timer);resolve()});child.postMessage({type:'worldwide:shutdown'})})}
async function installUpdate(){
 supportedUpdater();if(updating)throw new Error('An update is already in progress.');updating=true;
 try{
  const downloaded=await updater.download(updateProgress);
  updateProgress({progress:100,status:'Finishing saves before installing'});
  closing=true;await stopAlbumServer();
  updateProgress({progress:100,status:'Installing update — Worldwide will reopen'});
  // NSIS upgrades in place. --updated preserves user data; /S and --force-run
  // install and reopen without making the user find the downloaded file.
  await new Promise((resolve,reject)=>{const installer=spawn(downloaded.path,['--updated','/S','--force-run'],{detached:true,stdio:'ignore'});installer.once('error',reject);installer.once('spawn',()=>{installer.unref();resolve()})});
  setTimeout(()=>app.quit(),100);return {status:'installer-opened'};
 }catch(error){closing=false;if(!server&&!externalServer)await startServer().catch(()=>{});throw error}finally{updating=false}
}
async function updateReply(action){try{return {value:await action()}}catch(error){return {error:error.message}}}
ipcMain.handle('worldwide:check-update',async event=>{requireTrustedSender(event);return updateReply(()=>updater.check())});
ipcMain.handle('worldwide:install-update',async event=>{requireTrustedSender(event);return updateReply(installUpdate)});
async function showUpdateDialog(){try{const result=await updater.check();if(!result.available){await dialog.showMessageBox(window,{message:'Worldwide is up to date.',detail:`Version ${result.installedVersion}`});return}const choice=await dialog.showMessageBox(window,{message:`Worldwide ${result.version} is available.`,detail:'Worldwide will download the update and reopen. Your photos and account stay saved.',buttons:['Update now','Later'],defaultId:0,cancelId:1});if(choice.response===0)await installUpdate()}catch(error){dialog.showErrorBox('Could not update Worldwide',error.message)}}
if(!app.requestSingleInstanceLock()){app.quit()}else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus()}});
 app.whenReady().then(async()=>{await startServer();createWindow()}).catch(error=>{dialog.showErrorBox('Could not open Worldwide',error.message);app.quit()});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{closing=true;server?.kill()});
}
