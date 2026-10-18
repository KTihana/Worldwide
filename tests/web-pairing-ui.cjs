const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {resolve,join}=require('node:path');
const {tmpdir}=require('node:os');
const {createServer}=require('node:net');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..'),temp=mkdtempSync(join(tmpdir(),'worldwide-browser-pairing-'));
app.setPath('userData',join(temp,'browser-profile'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,outcome=0;const windows=[];
async function until(condition,label,win){for(let i=0;i<150;i++){if(await condition())return;await pause(100);}throw new Error('Timed out: '+label+(win?' '+await win.webContents.executeJavaScript('document.body.innerText'):''));}
function browser(partition){const win=new BrowserWindow({show:false,width:844,height:390,webPreferences:{partition,contextIsolation:true,sandbox:true,backgroundThrottling:false}});windows.push(win);return win;}
app.whenReady().then(async()=>{try{
 const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));const pc=`http://127.0.0.1:${port}`;
 server=spawn(process.env.WORLDWIDE_NODE||'node',['server/index.ts'],{cwd:root,env:{...process.env,PORT:String(port),ELSEWHERE_DATA_DIR:temp,ELSEWHERE_TLS_CERT:'',ELSEWHERE_TLS_KEY:'',ELSEWHERE_PUBLIC_ORIGIN:''},stdio:'ignore'});
 await until(async()=>{try{return(await fetch(pc+'/api/health')).ok}catch{return false}},'temporary local server');
 const setup=await fetch(pc+'/api/auth/setup',{method:'POST',headers:{origin:pc,'Content-Type':'application/json'},body:JSON.stringify({email:'browser-ui@example.test',password:'Private browser fixture password'})});assert.equal(setup.status,200);const pcCookie=setup.headers.get('set-cookie').split(';')[0];
 const connection=await(await fetch(pc+'/api/connection',{headers:{cookie:pcCookie}})).json(),phone=connection.localUrls[0]||pc;
 assert.ok(phone.startsWith('http://'),'Phone opens ordinary HTTP, with no certificate steps');
 const visited=await fetch(pc+'/api/countries/HRV',{method:'PATCH',headers:{origin:pc,cookie:pcCookie,'Content-Type':'application/json'},body:JSON.stringify({visited:true,note:'Browser pairing fixture'})});assert.equal(visited.status,200);
 const qrResponse=await fetch(pc+'/api/auth/pair-start',{method:'POST',headers:{origin:pc,cookie:pcCookie,'Content-Type':'application/json'},body:JSON.stringify({serverUrl:phone,client:'web'})});assert.equal(qrResponse.status,200);const pairing=await qrResponse.json();
 const qrUrl=new URL(pairing.pairingUrl),token=qrUrl.hash.slice('#worldwide-pair='.length);assert.equal(qrUrl.origin,phone);assert.equal(qrUrl.search,'');assert.equal(token.length,64);
 const win=browser('phone-browser-pairing'),requests=[],external=[];
 win.webContents.setWindowOpenHandler(({url})=>{external.push(url);return {action:'deny'};});
 win.webContents.on('will-navigate',(_event,url)=>{if(!url.startsWith(phone+'/'))external.push(url);});
 win.webContents.session.webRequest.onBeforeSendHeaders({urls:[phone+'/*']},(details,callback)=>{requests.push({url:details.url,method:details.method,headers:details.requestHeaders});callback({requestHeaders:details.requestHeaders});});
 assert.equal((await win.webContents.session.cookies.get({url:phone})).length,0,'Fresh phone browser starts without an account');
 await win.loadURL(pairing.pairingUrl);
 const js=source=>win.webContents.executeJavaScript(source);
 await until(()=>js(`document.querySelectorAll('[data-country]').length>200`),'paired album map',win);
 assert.equal(await js('location.hash'),'','Pairing fragment is removed from the browser address');assert.equal(win.webContents.getURL(),phone+'/');
 assert.equal(await js('typeof window.WorldwideNative'),'undefined','Browser pairing does not require the Android app');
 assert.equal(await js('Boolean(document.querySelector("input[type=password]"))'),false,'No password entry is needed on the phone');
 const cookies=await win.webContents.session.cookies.get({url:phone}),session=cookies.find(cookie=>cookie.name==='elsewhere_session');assert.ok(session?.httpOnly,'Session is in an HttpOnly browser cookie');assert.equal(session.secure,false,'Cookie works on local HTTP');
 const account=await js(`fetch('/api/auth/session').then(r=>r.json())`);assert.equal(account.account.email,'browser-ui@example.test');
 await win.webContents.capturePage().then(image=>require('node:fs').writeFileSync('/tmp/worldwide-phone-check.png',image.toPNG()));
 const atlas=await js(`fetch('/api/atlas').then(r=>r.json())`);assert.equal(atlas.visits.find(visit=>visit.countryId==='HRV').note,'Browser pairing fixture','Browser opened the computer’s existing album');
 const claims=requests.filter(request=>new URL(request.url).pathname==='/api/auth/pair-complete');assert.equal(claims.length,1,'The one-use token is claimed exactly once');assert.equal(claims[0].method,'POST');
 const claimIndex=requests.indexOf(claims[0]),sessionIndex=requests.findIndex(request=>new URL(request.url).pathname==='/api/auth/session');assert.ok(sessionIndex>claimIndex,'Account starts only after pairing');
 assert.ok(!requests.some(request=>new URL(request.url).pathname==='/api/auth/login'),'Phone never runs a password login');
 for(const request of requests){assert.ok(!new URL(request.url).search.includes(token),'Token is never a query parameter');assert.ok(!String(request.headers.Referer||request.headers.referer||'').includes(token),'Token is absent from referrers');}
 assert.deepEqual(external,[],'No installer, custom protocol, or external app opened');
 // A fresh browser replaying the same QR gets clear recovery guidance, not another session.
 const replay=browser('phone-browser-replay');await replay.loadURL(pairing.pairingUrl);
 await until(()=>replay.webContents.executeJavaScript(`!!document.querySelector('[role=alert]')`),'used QR feedback',replay);
 assert.equal(await replay.webContents.executeJavaScript('location.hash'),'');
 assert.match(await replay.webContents.executeJavaScript('document.body.innerText'),/invalid or expired/i);
 assert.equal((await replay.webContents.session.cookies.get({url:phone})).some(cookie=>cookie.name==='elsewhere_session'),false);
 assert.match(await replay.webContents.executeJavaScript('document.body.innerText'),/Connect phone/);
 console.log('PASS: ordinary HTTP QR opened the browser, scrubbed its fragment, claimed exactly once, signed in with an HttpOnly cookie, and displayed the existing atlas without a password or installed app; replay was rejected.');
 }catch(error){console.error(error);outcome=1;}finally{
  for(const win of windows)if(!win.isDestroyed())win.destroy();
  if(server&&server.exitCode===null){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped;}
  rmSync(temp,{recursive:true,force:true});app.exit(outcome);
 }
});
