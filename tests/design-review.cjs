// Visual and responsive checks use an isolated album; no user data is touched.
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),temp=mkdtempSync(join(tmpdir(),'worldwide-design-')),base='http://127.0.0.1:3391';
let server,win;app.setPath('userData',join(temp,'browser'));
const pause=ms=>new Promise(r=>setTimeout(r,ms)),js=code=>win.webContents.executeJavaScript(code,true);
async function until(fn,label){for(let i=0;i<300;i++){if(await fn())return;await pause(100)}throw Error('Timed out: '+label)}
async function click(label){assert.ok(await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true})()`),label)}
async function capture(name){
 await js(`Promise.all([document.fonts.ready,...[...document.images].map(img=>img.decode().catch(()=>{})),...document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))])`);
 // A hidden Chromium surface can still hold the preceding frame. Prime it,
 // then wait for the next painted frame before writing a review screenshot.
 await win.webContents.capturePage();
 await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 await pause(120);
 writeFileSync('/tmp/worldwide-design-'+name+'.png',(await win.webContents.capturePage()).toPNG());
}
async function closeModal(label){await click(label);await pause(100)}
async function chromeFits(){await js(`Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);const problem=await js(`(()=>{const names=['.atlas-brand','.search-dock','.top-controls','.atlas-navigation','.map-meta-actions','.map-zoom','.country-modal .modal-box','.toast','#region-menu'];const rects=names.map(name=>{const e=document.querySelector(name);if(!e)return null;const r=e.getBoundingClientRect();return {name,x:r.x,y:r.y,w:r.width,h:r.height,visible:!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'}}).filter(r=>r?.visible);const outside=rects.filter(r=>r.x<-.5||r.y<-.5||r.x+r.w>innerWidth+.5||r.y+r.h>innerHeight+.5);const overlap=[];for(let a=0;a<rects.length;a++)for(let b=a+1;b<rects.length;b++){const x=rects[a],y=rects[b];if(Math.min(x.x+x.w,y.x+y.w)-Math.max(x.x,y.x)>2&&Math.min(x.y+x.h,y.y+y.h)-Math.max(x.y,y.y)>2)overlap.push([x.name,y.name])}return {outside,overlap}})()`);assert.deepEqual(problem,{outside:[],overlap:[]},'Controls and country panel fit without overlapping at '+await js(`innerWidth+'x'+innerHeight`))}
app.whenReady().then(async()=>{try{
 server=spawn(process.env.WORLDWIDE_NODE||'/opt/homebrew/bin/node',['server/index.ts'],{cwd:root,env:{...process.env,PORT:'3391',ELSEWHERE_DATA_DIR:temp,ELSEWHERE_TLS_CERT:'',ELSEWHERE_TLS_KEY:''},stdio:'ignore'});
 await until(async()=>{try{return(await fetch(base+'/api/health')).ok}catch{return false}},'server');
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{partition:'design-review',sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 const errors=[];win.webContents.on('console-message',(_e,...args)=>{if(typeof args[0]==='object'&&args[0].level==='error')errors.push(args[0].message)});
 await win.loadURL(base);await until(()=>js(`!!document.querySelector('input[type=email]')`),'account');await capture('welcome');
 const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'traveler@example.test',username:'traveler',password:'A temporary design test password',passwordConfirmation:'A temporary design test password'})});assert.equal(setup.status,200);const cookie=setup.headers.get('set-cookie').split(';')[0],[name,...value]=cookie.split('=');await win.webContents.session.cookies.set({url:base,name,value:value.join('=')});
 for(const countryId of ['HRV','ITA','FRA','ESP','DEU','JPN','CAN','NZL'])await fetch(base+'/api/countries/'+countryId,{method:'PATCH',headers:{origin:base,cookie,'Content-Type':'application/json'},body:JSON.stringify({visited:true})});
 const fixturePhoto=process.env.WORLDWIDE_REVIEW_PHOTO&&existsSync(process.env.WORLDWIDE_REVIEW_PHOTO)?readFileSync(process.env.WORLDWIDE_REVIEW_PHOTO):await require('sharp')({create:{width:640,height:480,channels:3,background:'#b5cfa4'}}).jpeg().toBuffer();
 for(let i=0;i<3;i++){const form=new FormData();form.set('countryId','HRV');form.set('photo',new Blob([fixturePhoto],{type:'image/jpeg'}),'design-review.jpg');assert.equal((await fetch(base+'/api/photos',{method:'POST',headers:{origin:base,cookie},body:form})).status,201)}
 await win.loadURL(base);await until(()=>js(`document.querySelectorAll('[data-country]').length>200`),'world');await until(()=>js(`document.querySelector('.sync-indicator')?.textContent.trim()==='Saved'&&document.querySelector('.visited-count')?.textContent.includes('8 visited')`),'album ready');await chromeFits();await capture('desktop');
 await click('Choose continent or country');await click('Europe');await until(()=>js(`document.querySelectorAll('[data-country]').length<100`),'Europe');await capture('europe');
 await click('Choose continent or country');await click('Croatia');await until(()=>js(`!!document.querySelector('.country-modal')`),'country');await capture('country');
 assert.equal(await js(`document.querySelector('.country-modal [role=dialog]').getAttribute('aria-modal')`),'false','Country inspector allows keyboard access to the map');
 await click('Choose continent or country');
 await js(`document.querySelector('#region-menu input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
 assert.equal(await js(`!document.querySelector('#region-menu')&&!!document.querySelector('.country-modal')`),true,'Escape closes the place picker without closing the country');
 {
  await js(`document.querySelector('.photo-thumb').click()`);await capture('photo');await closeModal('Close photo');
  await click('Adjust photo');await capture('crop');await closeModal('Cancel photo adjustment');
 }
 await click('Save country map');await capture('export');await closeModal('Close save map');
 await closeModal('Close country album');await click('Photo albums');await until(()=>js(`!!document.querySelector('.country-shape')`),'album silhouettes');await capture('albums');await closeModal('Close albums');
 await click('Choose map style');await capture('styles');await closeModal('Close map styles');
 await click('Your account');await until(()=>js(`!!document.querySelector('.pairing-code img')`),'pairing code');await capture('account');await closeModal('Close account');
 await click('Worldwide home');await until(()=>js(`document.querySelectorAll('[data-country]').length>200`),'home');
 for(const [name,w,h] of [['landscape',844,390],['portrait',390,844],['small',360,740],['compact',320,568],['short-landscape',667,375],['small-landscape',568,320],['tablet',1024,768]]){win.setContentSize(w,h);await pause(400);await chromeFits();await capture(name);
 await js(`(()=>{const original=window.worldwideOriginalMatchMedia||window.matchMedia.bind(window);window.worldwideOriginalMatchMedia=original;window.matchMedia=query=>{const result=original(query);if(query==='(pointer: coarse)')Object.defineProperty(result,'matches',{value:Math.min(innerWidth,innerHeight)<600});return result};Object.defineProperty(window.screen,'width',{configurable:true,value:innerWidth});Object.defineProperty(window.screen,'height',{configurable:true,value:innerHeight})})()`);
 await click('Choose continent or country');await chromeFits();await capture(name+'-places');await click('Croatia');await until(()=>js(`!!document.querySelector('.country-modal')`),'phone country');await chromeFits();await capture(name+'-country');
 await js(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(fixturePhoto.toString('base64'))}),c=>c.charCodeAt(0)),transfer=new DataTransfer();transfer.items.add(new File([bytes],'memory.jpg',{type:'image/jpeg'}));const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);await until(()=>js(`!!document.querySelector('.album-notice')`),'inline album notification');await chromeFits();await capture(name+'-notice');
 assert.equal(await js(`!!document.querySelector('.toast')`),false,'Album notification never floats over controls');
 await click('Dismiss message');
 await js(`document.querySelector('.add-more-photos').scrollIntoView({block:'nearest'})`);
 assert.equal(await js(`(()=>{const e=document.querySelector('.add-more-photos'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`),true,'Add more photos is reachable and unobstructed');
 if(await js(`!!document.querySelector('.atlas-navigation').getClientRects().length`)){await click('Choose continent or country');await chromeFits();await capture(name+'-country-places');await click('Choose continent or country');}await closeModal('Close country album');if(name==='portrait'){await click('Your account');await capture('phone-account');await closeModal('Close account');}}
 assert.deepEqual(errors,[],'No browser errors');console.log('PASS: controls, country panels, place menus and notifications avoid overlaps across desktop, tablet and compact phone layouts; add-photo controls remain reachable.');
 }catch(error){console.error(error);process.exitCode=1}finally{win?.destroy();if(server){const done=new Promise(r=>server.once('exit',r));server.kill();await done}rmSync(temp,{recursive:true,force:true});app.exit(process.exitCode||0)}});
