const {app,BrowserWindow,ipcMain}=require('electron');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),temp=mkdtempSync(join(tmpdir(),'worldwide-desktop-update-ui-')),base='http://127.0.0.1:3381';
let server,window,checks=0,installs=0,mode='available',finishInstall;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<100;i++){if(await fn())return;await pause(100)}throw new Error('Timed out: '+label)}
const js=code=>window.webContents.executeJavaScript(code,true);
async function click(){await js(`document.querySelector('.app-updates button').click()`)}
async function openAccount(){await js(`document.querySelector('[aria-label="Your account"]').click()`);await until(()=>js(`!!document.querySelector('.app-updates')`),'account updates panel')}
app.whenReady().then(async()=>{try{
 server=spawn(process.env.WORLDWIDE_NODE||'/opt/homebrew/bin/node',['server/index.ts'],{cwd:root,env:{...process.env,PORT:'3381',ELSEWHERE_DATA_DIR:temp,ELSEWHERE_TLS_CERT:'',ELSEWHERE_TLS_KEY:''},stdio:'ignore'});
 await until(async()=>{try{return(await fetch(base+'/api/health')).ok}catch{return false}},'temporary server');
 const response=await fetch(base+'/api/auth/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'updates@example.test',username:'updates_test',password:'desktop updater test password',passwordConfirmation:'desktop updater test password'})});assert.equal(response.status,200);
 const [name,...value]=response.headers.get('set-cookie').split(';')[0].split('=');
 ipcMain.handle('worldwide:check-update',()=>{checks++;return mode==='error'?{error:'Update checks are temporarily limited. Try again later.'}:{value:{version:mode==='available'?'0.1.8':'0.1.6',installedVersion:'0.1.6',available:mode==='available'}}});
 ipcMain.handle('worldwide:install-update',()=>{installs++;window.webContents.send('worldwide:update-progress',{progress:50,status:'Downloading update'});return new Promise(resolve=>{finishInstall=()=>resolve({value:{status:'installer-opened'}})})});
 window=new BrowserWindow({show:false,width:1200,height:850,webPreferences:{preload:join(root,'desktop/preload.cjs'),partition:`worldwide-update-${Date.now()}`,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 await window.webContents.session.cookies.set({url:base,name,value:value.join('=')});
 let websiteChecks=0;window.webContents.session.webRequest.onBeforeRequest((details,callback)=>{if(new URL(details.url).pathname==='/api/version')websiteChecks++;callback({})});
 await window.loadURL(base);await until(()=>js(`document.querySelectorAll('[data-country]').length>200`),'map');await openAccount();
 await until(()=>js(`document.querySelector('.app-updates').textContent.includes('0.1.8 is available')`),'desktop release detected');
 assert.equal(checks,1);assert.equal(websiteChecks,0,'Desktop checks the native updater, not its own website');assert.ok(await js(`document.querySelector('.app-updates').textContent.includes('Version 0.1.6')`),'Installed desktop version is visible');
 await js(`window.addEventListener('worldwide-before-refresh',event=>event.preventDefault(),{once:true})`);await click();
 await until(()=>js(`document.querySelector('.app-updates').textContent.includes('Finish your current upload or edit')`),'unsaved-work guard');assert.equal(installs,0);
 await click();await until(()=>js(`document.querySelector('.app-updates button').textContent.includes('Downloading 50%')`),'native download progress');assert.equal(installs,1);assert.equal(await js(`document.querySelector('.app-updates button').disabled`),true);
 finishInstall();await until(()=>js(`document.querySelector('.app-updates').textContent.includes('Worldwide will reopen')`),'installer result');
 mode='error';await window.loadURL(base);await until(()=>js(`document.querySelectorAll('[data-country]').length>200`),'reopened map');await openAccount();
 await until(()=>js(`document.querySelector('.app-updates').textContent.includes('temporarily limited')`),'error is shown instead of false up-to-date');
 mode='current';await click();await until(()=>js(`document.querySelector('.app-updates').textContent.includes('Up to date')`),'manual retry succeeds');assert.equal(websiteChecks,0);
 console.log('PASS: real desktop preload/IPC, release detection, installed version, progress, unsaved-work guard, error/retry, and no website-update checks.');
 }catch(error){console.error(error);process.exitCode=1}finally{finishInstall?.();window?.destroy();server?.kill();await pause(300);rmSync(temp,{recursive:true,force:true});app.exit(process.exitCode||0)}});
