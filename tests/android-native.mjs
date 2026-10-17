import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sdk=process.env.ANDROID_HOME||join(homedir(),'Library/Android/sdk');
const java=process.env.JAVA_HOME||'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const adb=join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');
const env={...process.env,JAVA_HOME:java,ANDROID_HOME:sdk};
function run(command,args,cwd=root){const batch=process.platform==='win32'&&command.endsWith('.bat');const result=spawnSync(batch?`"${command}"`:command,args,{cwd,env,encoding:'utf8',maxBuffer:10*1024*1024,shell:batch});assert.equal(result.status,0,(result.stderr||'')+(result.stdout||''));return result.stdout}
const devices=run(adb,['devices']);const emulator=devices.split('\n').find(line=>/^emulator-\d+\s+device$/.test(line.trim()))?.split('\t')[0];
assert.ok(emulator,'Start a dedicated Android emulator. This test never targets a physical phone.');
const android=join(root,'mobile/android');run(join(android,process.platform==='win32'?'gradlew.bat':'gradlew'),['--no-daemon','assembleDebug','assembleDebugAndroidTest'],android);
const temp=await mkdtemp(join(tmpdir(),'worldwide-native-test-'));const port=3302,base=`http://127.0.0.1:${port}`;let child;
try{
 child=spawn(process.execPath,['server/index.ts'],{cwd:root,env:{...process.env,PORT:String(port),ELSEWHERE_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(output||'Server startup timed out')),10000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Worldwide is running at')){clearTimeout(timer);resolve()}});child.stderr.on('data',chunk=>output+=chunk);child.once('exit',()=>{clearTimeout(timer);reject(new Error(output))})});
 const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'native@example.test',password:'Worldwide native test 2026'})});assert.equal(setup.status,200);
 const pcCookie=setup.headers.get('set-cookie').split(';')[0];
 const pcEdit=await fetch(base+'/api/countries/ITA',{method:'PATCH',headers:{Origin:base,Cookie:pcCookie,'Content-Type':'application/json'},body:JSON.stringify({visited:true,note:'Created on PC before phone sync'})});assert.equal(pcEdit.status,200);
 // The dedicated emulator may contain a personally signed release from visual QA.
 // Reset only this test app so Android can install the separate debug signature.
 spawnSync(adb,['-s',emulator,'uninstall','app.worldwide'],{stdio:'ignore'});
 for(const apk of ['app/build/outputs/apk/debug/app-debug.apk','app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'])run(adb,['-s',emulator,'install','-r',join(android,apk)]);
 run(adb,['-s',emulator,'reverse',`tcp:${port}`,`tcp:${port}`]);
 // Keep the Node event loop available to the test server during instrumentation.
 const output=await new Promise((resolve,reject)=>{const test=spawn(adb,['-s',emulator,'shell','am','instrument','-w','-e','server',base,'app.worldwide.test/app.worldwide.NativeSmokeTests'],{env});let text='';test.stdout.on('data',chunk=>text+=chunk);test.stderr.on('data',chunk=>text+=chunk);test.on('exit',code=>code===0?resolve(text):reject(new Error(text)));});
 assert.match(output,/address restrictions passed/);console.log(output.trim());
 const desktop=await(await fetch(base+'/api/atlas',{headers:{Cookie:pcCookie}})).json();
 assert.ok(desktop.photos.some(photo=>photo.countryId==='HRV'&&photo.cropX===0.4&&photo.cropZoom===1.5),'Independent PC session sees native phone upload and crop');
 assert.equal(desktop.visits.find(visit=>visit.countryId==='HRV')?.visited,1,'Independent PC session sees phone visit');
 console.log('Bidirectional sync passed: PC edit reached Android, Android photo/crop/visit reached independent PC session.');
}finally{
 if(child&&child.exitCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await stopped}
 spawnSync(adb,['-s',emulator,'reverse','--remove',`tcp:${port}`],{stdio:'ignore'});
 await rm(temp,{recursive:true,force:true});
}
