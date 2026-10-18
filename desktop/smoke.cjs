// Exercise the same utility process used by the installed desktop app.
const {app,utilityProcess}=require('electron');
const {mkdtempSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join,resolve}=require('node:path');
const temporary=mkdtempSync(join(tmpdir(),'worldwide-desktop-test-'));let child;
app.whenReady().then(async()=>{try{
 const reservation=require('node:net').createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const origin=`http://127.0.0.1:${port}`;
 child=utilityProcess.fork(resolve(__dirname,'../desktop-runtime/server/index.js'),[],{env:{...process.env,PORT:String(port),ELSEWHERE_DATA_DIR:temporary,ELSEWHERE_BIND:'127.0.0.1'},stdio:'pipe'});
 let output='';child.stderr.on('data',x=>output+=x);child.stdout.on('data',x=>output+=x);
 let ready=false;for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,150));try{ready=(await fetch(origin+'/api/health')).ok;if(ready)break}catch{}}
 if(!ready)throw new Error('Utility server did not start: '+output);
 const setup=await fetch(origin+'/api/auth/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'desktop@example.test',username:'desktop_test',password:'desktop smoke private password',passwordConfirmation:'desktop smoke private password'})});
 if(setup.status!==200)throw new Error('Account setup failed '+await setup.text());
 const cookie=setup.headers.get('set-cookie').split(';')[0];
 const response=await fetch(origin+'/api/atlas',{headers:{Cookie:cookie}});if(response.status!==200)throw new Error('Album unavailable');
 const qr=await fetch(origin+'/api/auth/pair-start',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({serverUrl:origin})});if(qr.status!==200)throw new Error('Bundled QR generation failed '+await qr.text());const pairing=await qr.json();if(!pairing.qr.includes('<svg'))throw new Error('Missing QR image');
 if((await fetch(origin+'/')).status!==200)throw new Error('Bundled frontend unavailable');
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Graceful utility shutdown timed out')),10000);child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Graceful utility shutdown exited '+code))});child.postMessage({type:'worldwide:shutdown'})});child=null;
 console.log('PASS: bundled Electron utility process, SQLite, private account, authenticated album, QR generation, frontend assets, and graceful update shutdown.');
 }catch(error){console.error(error);process.exitCode=1}finally{if(child){await new Promise(resolve=>{child.once('exit',resolve);child.kill()})}rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0)}});
