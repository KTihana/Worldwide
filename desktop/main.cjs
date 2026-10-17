const {app,BrowserWindow,Menu,dialog,shell,utilityProcess}=require('electron');
const {join,resolve}=require('node:path');
const {existsSync,readFileSync,writeFileSync,mkdirSync}=require('node:fs');
app.setName('Worldwide');
app.setPath('userData',join(app.getPath('appData'),'Worldwide'));
let window,server,closing=false,externalServer=false;
const port=Number(process.env.PORT||3000),origin=`http://127.0.0.1:${port}`;
const runtime=app.isPackaged?join(process.resourcesPath,'runtime'):resolve(__dirname,'../desktop-runtime');
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
 server.on('exit',code=>{server=null;if(!closing&&window){dialog.showErrorBox('Worldwide stopped',`Your album server stopped (${code}). Reopen Worldwide to reconnect.`);app.quit()}});
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
 window=new BrowserWindow({width:1440,height:920,minWidth:820,minHeight:540,title:'Worldwide',icon:join(runtime,'dist/icon-512.png'),backgroundColor:'#dbe9ec',autoHideMenuBar:process.platform!=='darwin',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault()});
 window.loadURL(origin);
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform==='darwin'?[{label:'Worldwide',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{type:'separator'},{role:'quit'}]}]:[]),
  {label:'File',submenu:[{label:'Choose album folder…',click:chooseAlbum},{label:'Show album folder',enabled:!externalServer,click:()=>shell.openPath(albumDirectory())},{label:'Open in browser',click:()=>shell.openExternal(origin)},{type:'separator'},{role:'quit'}]},
  {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
  {label:'View',submenu:[{role:'reload'},{role:'togglefullscreen'}]},
 ]));
}
if(!app.requestSingleInstanceLock()){app.quit()}else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus()}});
 app.whenReady().then(async()=>{await startServer();createWindow()}).catch(error=>{dialog.showErrorBox('Could not open Worldwide',error.message);app.quit()});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{closing=true;server?.kill()});
}
