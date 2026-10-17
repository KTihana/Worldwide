const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),temp=mkdtempSync(join(tmpdir(),'worldwide-interactions-')),base='http://127.0.0.1:3379';
let server,window;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<100;i++){if(await fn())return;await pause(100)}throw new Error('Timed out: '+label)}
const js=code=>window.webContents.executeJavaScript(code,true);
async function click(label){assert.ok(await js(`(()=>{const el=Array.from(document.querySelectorAll('button')).find(el=>el.getAttribute('aria-label')===${JSON.stringify(label)}||el.textContent.trim()===${JSON.stringify(label)});if(!el)return false;el.click();return true})()`),label)}
app.whenReady().then(async()=>{try{
 server=spawn(process.env.WORLDWIDE_NODE||'/opt/homebrew/bin/node',['server/index.ts'],{cwd:root,env:{...process.env,PORT:'3379',ELSEWHERE_DATA_DIR:temp,ELSEWHERE_TLS_CERT:'',ELSEWHERE_TLS_KEY:''},stdio:['ignore','ignore','pipe']});let errors='';server.stderr.on('data',d=>errors+=d);
 await until(async()=>{try{return(await fetch(base+'/api/health')).ok}catch{return false}},'server '+errors);
 const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json',origin:base},body:JSON.stringify({email:'ui@example.test',password:'interaction test password'})});assert.equal(setup.status,200);const cookie=setup.headers.get('set-cookie').split(';')[0];
 const ids=[];for(let i=0;i<2;i++){const form=new FormData();form.set('countryId','HRV');form.set('photo',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCmcAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'test.png');const response=await fetch(base+'/api/photos',{method:'POST',headers:{cookie,origin:base},body:form});assert.equal(response.status,201);ids.push((await response.json()).id)}
 window=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{partition:`worldwide-interactions-${Date.now()}`,contextIsolation:true,sandbox:true,backgroundThrottling:false}});const [name,...value]=cookie.split('=');await window.webContents.session.cookies.set({url:base,name,value:value.join('=')});
 const failures=[];window.webContents.on('console-message',(_e,...args)=>{if(typeof args[0]==='object'&&args[0].level==='error')failures.push(args[0].message)});
 await window.loadURL(base);await until(()=>js(`document.querySelectorAll('[data-country]').length>200`),'world');
 assert.equal(await js(`!!document.querySelector('.map-hint')`),false);
 assert.equal(await js(`!!document.querySelector('.base-map-image')`),true);
 await click('Choose continent or country');await until(()=>js(`!!document.querySelector('#region-menu')`),'picker');await click('Europe');await until(()=>js(`document.querySelectorAll('[data-country]').length<100&&!!document.querySelector('[data-country="HRV"]')`),'continent');
 await click('Choose continent or country');await click('Croatia');await until(()=>js(`!!document.querySelector('.country-modal')`),'country');
 const order=await js(`Array.from(document.querySelectorAll('[data-photo-id]')).map(el=>el.dataset.photoId)`);assert.equal(order.length,2);
 const rects=await js(`Array.from(document.querySelectorAll('[data-photo-id]')).map(el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})`);
 window.webContents.sendInputEvent({type:'mouseMove',...rects[0]});window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...rects[0]});window.webContents.sendInputEvent({type:'mouseMove',...rects[1]});await pause(60);window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...rects[1]});
 await until(()=>js(`document.querySelector('[data-photo-id]')?.dataset.photoId===${JSON.stringify(order[1])}`),'gallery reorder');
 assert.equal(await js(`!!document.querySelector('.lightbox-modal')`),false,'Reordering does not open or duplicate photos');
 await js(`document.querySelector('[data-country="HRV"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);await until(()=>js(`!!document.querySelector('.photo-editor-modal')`),'crop editor');
 assert.equal(await js(`document.querySelector('.photo-editor-preview image').getAttribute('clip-path')`),'url(#editor-clip)');
 await js(`(()=>{const input=document.querySelector('input[aria-label="Photo zoom"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 const before=await js(`document.querySelector('.photo-editor-preview image').getAttribute('y')`);
 const position=await js(`(()=>{const r=document.querySelector('.photo-editor-preview svg').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
 window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...position});window.webContents.sendInputEvent({type:'mouseMove',x:position.x+40,y:position.y+40});window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:position.x+40,y:position.y+40});
 await until(()=>js(`document.querySelector('.photo-editor-preview image').getAttribute('y')!==${JSON.stringify(before)}`),'photo moves within clip');
 await click('Save position');await until(()=>js(`!document.querySelector('.photo-editor-modal')`),'save crop');await click('Back to Europe');await click('Choose continent or country');await click('World');await until(()=>js(`document.querySelectorAll('[data-country]').length>200`),'return world');
 const timing=await js(`new Promise(resolve=>{const spans=[];let previous=performance.now();function frame(now){spans.push(now-previous);previous=now;document.querySelector('.world-map').dispatchEvent(new WheelEvent('wheel',{deltaY:-6,clientX:700,clientY:450,bubbles:true,cancelable:true}));if(spans.length<45)requestAnimationFrame(frame);else resolve({average:spans.slice(5).reduce((a,b)=>a+b,0)/(spans.length-5),max:Math.max(...spans.slice(5))})}requestAnimationFrame(frame)})`);
 await click('Show whole world');await pause(400);
 await window.webContents.capturePage().then(image=>require('node:fs').writeFileSync('/tmp/worldwide-map-check.png',image.toPNG()));
 await click('Your account');assert.equal(await js(`!!document.querySelector('.app-updates a[href$="Worldwide-Windows-Setup.exe"]')`),true);
 assert.deepEqual(failures,[]);console.log('PASS: desktop continent/country picker, Antarctica, gallery pointer reorder, crop entry, updates. Wheel frame times:',timing);
 }catch(error){console.error(error);process.exitCode=1}finally{window?.destroy();server?.kill();await pause(300);rmSync(temp,{recursive:true,force:true});app.exit(process.exitCode||0)}});
