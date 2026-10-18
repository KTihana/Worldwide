import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sdk=process.env.ANDROID_HOME||join(homedir(),'Library/Android/sdk');
const java=process.env.JAVA_HOME||'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const adb=join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');
const env={...process.env,JAVA_HOME:java,ANDROID_HOME:sdk};
function run(command,args,cwd=root){const batch=process.platform==='win32'&&command.endsWith('.bat');const result=spawnSync(batch?`"${command}"`:command,args,{cwd,env,encoding:'utf8',maxBuffer:10*1024*1024,shell:batch});assert.equal(result.status,0,(result.stderr||'')+(result.stdout||''));return result.stdout}
const devices=run(adb,['devices']);const emulator=devices.split('\n').find(line=>/^emulator-\d+\s+device$/.test(line.trim()))?.split('\t')[0];
assert.ok(emulator,'Start a dedicated Android emulator. This test never targets a physical phone.');
const packageName='app.worldwide.nativetest',android=join(root,'mobile/android');run(join(android,process.platform==='win32'?'gradlew.bat':'gradlew'),['--no-daemon','-PworldwideNativeTest=true','assembleDebug','assembleDebugAndroidTest'],android);
const temp=await mkdtemp(join(tmpdir(),'worldwide-native-test-'));const port=3302,base=`http://127.0.0.1:${port}`,otherPort=3303,otherBase=`http://127.0.0.1:${otherPort}`,children=[];
async function server(serverPort,data){
 const child=spawn(process.execPath,['server/index.ts'],{cwd:root,env:{...process.env,PORT:String(serverPort),ELSEWHERE_DATA_DIR:data,ELSEWHERE_TLS_CERT:'',ELSEWHERE_TLS_KEY:''},stdio:['ignore','pipe','pipe']});children.push(child);
 await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(output||'Server startup timed out')),10000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Worldwide is running at')){clearTimeout(timer);resolve()}});child.stderr.on('data',chunk=>output+=chunk);child.once('exit',()=>{clearTimeout(timer);reject(new Error(output))})});
}
async function setupAccount(origin,email,username){
 const result=await fetch(origin+'/api/auth/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,username,password:'Worldwide native test 2026',passwordConfirmation:'Worldwide native test 2026'})});assert.equal(result.status,200);return result.headers.get('set-cookie').split(';')[0];
}
async function qr(origin,cookie){
 const result=await fetch(origin+'/api/auth/pair-start',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({serverUrl:origin,client:'web'})});assert.equal(result.status,200);
 return (await sharp(Buffer.from((await result.json()).qr)).resize(640,640).png().toBuffer()).toString('base64');
}
try{
 await server(port,join(temp,'pc'));await server(otherPort,join(temp,'other'));
 const pcCookie=await setupAccount(base,'native@example.test','native_test'),otherCookie=await setupAccount(otherBase,'native@example.test','other_test');
 const pcEdit=await fetch(base+'/api/countries/ITA',{method:'PATCH',headers:{Origin:base,Cookie:pcCookie,'Content-Type':'application/json'},body:JSON.stringify({visited:true,note:'Created on PC before phone sync'})});assert.equal(pcEdit.status,200);
 const photo=new FormData();photo.set('countryId','ITA');photo.set('photo',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCmcAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'pc.png');assert.equal((await fetch(base+'/api/photos',{method:'POST',headers:{Origin:base,Cookie:pcCookie},body:photo})).status,201);
 // Only the disposable package is reset; installed Worldwide albums stay untouched.
 spawnSync(adb,['-s',emulator,'uninstall',packageName],{stdio:'ignore'});
 for(const apk of ['app/build/outputs/apk/debug/app-debug.apk','app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'])run(adb,['-s',emulator,'install','-r',join(android,apk)]);
 run(adb,['-s',emulator,'reverse',`tcp:${port}`,`tcp:${port}`]);
 run(adb,['-s',emulator,'reverse',`tcp:${otherPort}`,`tcp:${otherPort}`]);
 const connection=await(await fetch(base+'/api/connection',{headers:{Cookie:pcCookie}})).json();
 assert.ok(connection.localUrls.length,'Native pairing test needs a local network address.');
 // Decode the actual SVG displayed by the PC, not a separately generated lookalike.
 const qrPng=await qr(base,pcCookie),otherQrPng=await qr(otherBase,otherCookie);
 // Keep the Node event loop available to the test server during instrumentation.
 const output=await new Promise((resolve,reject)=>{const test=spawn(adb,['-s',emulator,'shell','am','instrument','-w','-r','-e','standalone','true','-e','server',base,'-e','qrPng',qrPng,'-e','otherQrPng',otherQrPng,packageName+'.test/app.worldwide.NativeSmokeTests'],{env});let text='';test.stdout.on('data',chunk=>text+=chunk);test.stderr.on('data',chunk=>text+=chunk);test.on('exit',code=>code===0?resolve(text):reject(new Error(text)));});
 console.log(output.trim());assert.match(output,/INSTRUMENTATION_CODE: -1/);assert.match(output,/Standalone native album and optional sync passed/);
 const desktop=await(await fetch(base+'/api/atlas',{headers:{Cookie:pcCookie}})).json();
 assert.ok(desktop.photos.some(photo=>photo.countryId==='HRV'&&photo.cropX===0.4&&photo.cropZoom===1.5),'Independent PC session sees native phone upload and crop');
 assert.equal(desktop.visits.find(visit=>visit.countryId==='HRV')?.visited,0,'PC sees phone offline visit change');assert.equal(desktop.photos.length,3,'Stable IDs avoid duplicate synced photos');
 assert.equal(desktop.visits.find(visit=>visit.countryId==='HRV')?.note,'Edited on PC while phone was offline','Disjoint PC and phone edits are retained');
 console.log('PASS: standalone phone editing/restart, PC/phone merge, offline queue, two-way sync, no duplicates, disconnect retention, and account isolation.');
}finally{
 for(const child of children)if(child.exitCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await stopped}
 for(const value of [port,otherPort])spawnSync(adb,['-s',emulator,'reverse','--remove',`tcp:${value}`],{stdio:'ignore'});
 for(const name of [packageName+'.test',packageName])spawnSync(adb,['-s',emulator,'uninstall',name],{stdio:'ignore'});
 await rm(temp,{recursive:true,force:true});
}
