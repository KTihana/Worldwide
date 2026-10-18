// Exercise real forms and capture mobile layouts using a disposable album.
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),temp=mkdtempSync(join(tmpdir(),'worldwide-account-')),base='http://127.0.0.1:3392';
let server,win;app.setPath('userData',join(temp,'browser'));
const pause=ms=>new Promise(r=>setTimeout(r,ms)),js=code=>win.webContents.executeJavaScript(code,true);
async function until(fn,label){for(let i=0;i<300;i++){if(await fn())return;await pause(100)}throw Error('Timed out: '+label)}
async function click(label){assert.ok(await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true})()`),label)}
async function fill(selector,value){await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
async function capture(name){
 await js(`Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode().catch(()=>{})),...document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))])`);
 await win.webContents.capturePage();await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);await pause(120);
 writeFileSync('/tmp/worldwide-mobile-'+name+'.png',(await win.webContents.capturePage()).toPNG());
}
async function session(){return js(`fetch('/api/auth/session').then(r=>r.json())`)}
async function orientation(expected){await until(()=>js(`window.__orientationCalls.filter(value=>value!=='unlock').at(-1)===${JSON.stringify(expected)}`),'orientation '+expected)}
async function mapReady(){await until(()=>js(`document.querySelectorAll('[data-country]').length>200&&document.querySelector('.sync-indicator')?.textContent.trim()==='Saved'`),'saved map')}
async function signOut(){await click('Your account');await click('Sign out');await until(()=>js(`!!document.querySelector('input[placeholder="Email or username"]')`),'sign in');await orientation('portrait-primary')}
async function login(identifier){await fill('input[placeholder="Email or username"]',identifier);await fill('input[aria-label="Password"]','A temporary account test password');await click('Sign in');await mapReady();await orientation('landscape')}
app.whenReady().then(async()=>{try{
 server=spawn(process.env.WORLDWIDE_NODE||'/opt/homebrew/bin/node',['server/index.ts'],{cwd:root,env:{...process.env,PORT:'3392',ELSEWHERE_DATA_DIR:temp,ELSEWHERE_TLS_CERT:'',ELSEWHERE_TLS_KEY:''},stdio:'ignore'});
 await until(async()=>{try{return(await fetch(base+'/api/health')).ok}catch{return false}},'server');
 win=new BrowserWindow({show:false,width:390,height:844,webPreferences:{partition:'account-review',sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 // Chromium desktop cannot rotate a physical phone. Record the real UI's requests
 // with a phone environment; Android instrumentation verifies the native rotation.
 await win.loadURL('about:blank');
 win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Page.enable');
 await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.__orientationCalls=[];
  Object.defineProperty(screen,'width',{value:390});Object.defineProperty(screen,'height',{value:844});
  const media=window.matchMedia.bind(window);window.matchMedia=query=>{const result=media(query);if(query==='(pointer: coarse)')Object.defineProperty(result,'matches',{value:true});return result};
  Object.defineProperty(screen.orientation,'lock',{value:async mode=>{window.__orientationCalls.push(mode)}});
  Object.defineProperty(screen.orientation,'unlock',{value:()=>window.__orientationCalls.push('unlock')});
 `});
 await win.loadURL(base);await until(()=>js(`!!document.querySelector('input[aria-label="Username"]')`),'setup');
 await orientation('portrait-primary');assert.equal(await js(`!!document.fullscreenElement`),false,'Signup never forces fullscreen');
 for(const [name,w,h] of [['signup',390,844],['signup-small',360,740],['signup-landscape',844,390]]){
  win.setContentSize(w,h);await pause(300);
  const layout=await js(`(()=>{const screen=document.querySelector('.account-screen'),inputs=[...document.querySelectorAll('.account-card input')],button=document.querySelector('.account-submit'),brand=document.querySelector('.account-brand');return {overflow:screen.scrollWidth>screen.clientWidth,top:brand.getBoundingClientRect().top,buttonBottom:button.getBoundingClientRect().bottom,inputs:inputs.map(e=>({height:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize)}))}})()`);
  assert.equal(layout.overflow,false,name+' has no horizontal overflow');assert.ok(layout.top>=0,name+' top is reachable');
  assert.ok(layout.inputs.every(e=>e.height>=44&&e.font>=16),name+' has readable touch-sized fields');
  if(name==='signup')assert.ok(layout.buttonBottom<=844,'Create button visible on a standard phone');
  await capture(name);
 }
 win.setContentSize(390,844);await pause(200);
 await fill('input[aria-label="Username"]','Trail_Atlas');await fill('input[type="email"]','traveler@example.test');await fill('input[aria-label="Password"]','A temporary account test password');await fill('input[aria-label="Repeat password"]','A different account test password');
 await click('Create my account');await until(()=>js(`!!document.querySelector('#account-confirm-error')`),'matching-password validation');assert.equal((await session()).needsSetup,true);
 assert.equal(await js(`document.activeElement.getAttribute('aria-label')`),'Repeat password');
 await fill('input[aria-label="Repeat password"]','A temporary account test password');await click('Create my account');await mapReady();assert.equal((await session()).account.username,'trail_atlas');
 await orientation('landscape');assert.equal(await js(`!!document.fullscreenElement`),false,'Login never forces fullscreen');
 assert.equal(await js(`fetch('/api/countries/HRV',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({visited:true})}).then(r=>r.status)`),200);
 await click('Your account');await fill('#account-settings-username','Atlas_Traveler');await js(`document.querySelector('#account-settings-username').form.requestSubmit()`);await until(()=>js(`!!document.querySelector('.account-username-saved')`),'username saved');assert.equal((await session()).account.username,'atlas_traveler');
 await click('Sign out');await until(()=>js(`!!document.querySelector('input[placeholder="Email or username"]')`),'sign in');
 await orientation('portrait-primary');
 assert.equal(await js(`document.querySelector('input[placeholder="Email or username"]').type`),'text');await capture('signin');
 await login('ATLAS_TRAVELER');await signOut();await login('TRAVELER@EXAMPLE.TEST');
 assert.equal(await js(`document.querySelector('.visited-count').textContent.includes('1 visited')`),true,'Album survives profile change and both login methods');
 win.setContentSize(844,390);await pause(400);await capture('map');
 await js(`window.dispatchEvent(new Event('album-session-expired'))`);await until(()=>js(`!!document.querySelector('input[placeholder="Email or username"]')`),'expired sign in');await orientation('portrait-primary');
 console.log('PASS: mobile signup layout, matching passwords, email/username login, album preservation, portrait entry/logout/expiry and landscape authenticated map. Mobile screenshots saved to /tmp/worldwide-mobile-*.png.');
 }catch(error){console.error(error);process.exitCode=1}finally{win?.destroy();if(server){const done=new Promise(r=>server.once('exit',r));server.kill();await done}rmSync(temp,{recursive:true,force:true});app.exit(process.exitCode||0)}});
