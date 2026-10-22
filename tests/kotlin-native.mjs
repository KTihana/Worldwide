import assert from 'node:assert/strict';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,mkdir,cp,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root=resolve(import.meta.dirname,'..'),android=join(root,'mobile/android');
const sdk=process.env.ANDROID_HOME||join(homedir(),'Library/Android/sdk'),java=process.env.JAVA_HOME||'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const adb=join(sdk,'platform-tools/adb'),env={...process.env,JAVA_HOME:java,ANDROID_HOME:sdk};
function run(file,args,cwd=root){const result=spawnSync(file,args,{cwd,env,encoding:'utf8',maxBuffer:12*1024*1024});assert.equal(result.status,0,(result.stderr||'')+(result.stdout||''));return result.stdout}
const detected=run(adb,['devices']).split('\n').find(s=>/^emulator-\d+\s+device$/.test(s.trim()))?.split('\t')[0];const emulator=process.env.ANDROID_SERIAL||detected;assert(/^emulator-\d+$/.test(emulator||''));assert(emulator,'Start a dedicated Android emulator. Never targets physical phones.');
const device=args=>{let result;for(let attempt=0;attempt<3;attempt++){result=spawnSync(adb,['-s',emulator,...args],{cwd:root,env,encoding:'utf8',maxBuffer:12*1024*1024,timeout:120000});if(result.status===0)return result.stdout;if(!args.includes('install')||/INSTALL_FAILED/.test(result.stdout+result.stderr))break;}assert.equal(result.status,0,(result.stderr||'')+(result.stdout||''));};const pkg='app.worldwide.nativetest',temp=await mkdtemp(join(tmpdir(),'worldwide-kotlin-'));let children=[];
const base='http://127.0.0.1:3312',other='http://127.0.0.1:3313';
async function server(origin,folder){const child=spawn(process.execPath,['server/index.ts'],{cwd:root,env:{...process.env,PORT:new URL(origin).port,ELSEWHERE_DATA_DIR:folder,ELSEWHERE_TLS_CERT:'',ELSEWHERE_TLS_KEY:''},stdio:'ignore'});children.push(child);for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)return}catch{};await new Promise(r=>setTimeout(r,100))}throw Error('Test server unavailable')}
async function setup(origin,username){const reply=await fetch(origin+'/api/auth/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'native@example.test',username,password:'Kotlin migration test password',passwordConfirmation:'Kotlin migration test password'})});assert.equal(reply.status,200);return reply.headers.get('set-cookie').split(';')[0]}
async function patch(path,value,cookie){const r=await fetch(base+path,{method:'PATCH',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(value)});assert.equal(r.status,200)}
const remote='/data/local/tmp/worldwide-kotlin-fixture';
try{
 await server(base,join(temp,'pc'));await server(other,join(temp,'other'));
 const cookie=await setup(base,'kotlin_test'),otherCookie=await setup(other,'kotlin_other');
 const png=await sharp({create:{width:80,height:60,channels:3,background:'#b5cfa4'}}).png().toBuffer();
 const photo=new FormData();photo.set('countryId','HRV');photo.set('photoId','a73882ee-0188-4b88-95fe-d6ab6a3f3211');photo.set('photo',new Blob([png],{type:'image/png'}),'legacy.png');assert.equal((await fetch(base+'/api/photos',{method:'POST',headers:{Origin:base,Cookie:cookie},body:photo})).status,201);
 await patch('/api/photos/a73882ee-0188-4b88-95fe-d6ab6a3f3211',{cropX:.4,cropY:-.2,cropZoom:1.5},cookie);await patch('/api/countries/HRV',{visited:true,note:'Preserved from the WebView app'},cookie);await patch('/api/countries/JPN',{visited:true,note:'Created on computer'},cookie);
 const account=(await(await fetch(base+'/api/auth/session',{headers:{Cookie:cookie}})).json()).account;
 const atlas=await(await fetch(base+'/api/atlas',{headers:{Cookie:cookie}})).json();
 const pairing=await(await fetch(other+'/api/auth/pair-start',{method:'POST',headers:{Origin:other,Cookie:otherCookie,'Content-Type':'application/json'},body:JSON.stringify({serverUrl:other,client:'web'})})).json();const otherQr=pairing.pairingUrl;
 assert(otherQr,'Pairing link returned');
 // Build the last published Java/WebView application under the disposable ID.
 const legacyApk=join(tmpdir(),'worldwide-legacy-854f3d8-nativetest.apk');
 if(!existsSync(legacyApk)){
  console.log('Building the previous WebView APK for the in-place upgrade check…');
  const legacy=join(temp,'legacy');await mkdir(legacy);await writeFile(join(temp,'legacy.tar'),execFileSync('git',['archive','854f3d8','mobile/android'],{cwd:root,maxBuffer:30*1024*1024}));run('tar',['-xf',join(temp,'legacy.tar'),'-C',legacy]);const oldAndroid=join(legacy,'mobile/android');await mkdir(join(oldAndroid,'app/src/main/assets'),{recursive:true});await cp(join(root,'dist'),join(oldAndroid,'app/src/main/assets/www'),{recursive:true,filter:p=>!p.endsWith('.gz')&&!p.endsWith('.br')});await cp(join(root,'app/data/world.json'),join(oldAndroid,'app/src/main/assets/widget-world.json'));
  run(join(oldAndroid,'gradlew'),['--no-daemon','-PworldwideNativeTest=true','assembleDebug'],oldAndroid);await cp(join(oldAndroid,'app/build/outputs/apk/debug/app-debug.apk'),legacyApk);
 }
 console.log('Building the native Kotlin APK and instrumentation…');
 run(join(android,'gradlew'),['--no-daemon','-PworldwideKotlinTest=true','assembleDebug','assembleDebugAndroidTest'],android);
 console.log('Installing the old APK and seeding a disposable album…');
 spawnSync(adb,['-s',emulator,'uninstall',pkg],{stdio:'ignore'});device(['install','-r',legacyApk]);
 const fixture=join(temp,'fixture');await mkdir(fixture);const db=new DatabaseSync(join(fixture,'local.sqlite'));db.exec('CREATE TABLE album (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, revision INTEGER NOT NULL); CREATE TABLE mutations (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, method TEXT NOT NULL, body TEXT NOT NULL)');db.prepare('INSERT INTO album VALUES (1,?,0)').run(JSON.stringify(atlas));db.close();await writeFile(join(fixture,'atlas.json'),JSON.stringify(atlas));const key=createHash('sha256').update('/api/photos/a73882ee-0188-4b88-95fe-d6ab6a3f3211').digest('hex');await writeFile(join(fixture,key+'.photo'),png);await writeFile(join(fixture,key+'.mime'),'image/png');await writeFile(join(fixture,'retention-photo.png'),png);
 const values={server:base,cookie,'album-owner':'native@example.test','album-owner-id':account.albumId,account:JSON.stringify({account,needsSetup:false,canSetup:false,canReset:false})};const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');await writeFile(join(fixture,'worldwide.xml'),'<?xml version="1.0" encoding="utf-8"?><map>'+Object.entries(values).map(([k,v])=>`<string name="${k}">${escape(v)}</string>`).join('')+'</map>');device(['push',fixture,remote]);device(['shell',`chmod -R a+rX ${remote}`]);device(['shell',`run-as ${pkg} sh -c 'mkdir -p files/album shared_prefs; cp ${remote}/local.sqlite ${remote}/atlas.json ${remote}/${key}.photo ${remote}/${key}.mime files/album/; cp ${remote}/retention-photo.png files/; cp ${remote}/worldwide.xml shared_prefs/worldwide.xml'`]);
 device(['reverse','tcp:3312','tcp:3312']);device(['reverse','tcp:3313','tcp:3313']);
 device(['shell','am','start','-W','-n',pkg+'/app.worldwide.MainActivity']);await new Promise(r=>setTimeout(r,1500));device(['shell','am','force-stop',pkg]);
 console.log('Replacing the old APK in place, keeping its files and session…');
 // Actual APK replacement, without uninstalling or clearing the seeded legacy album.
 device(['install','-r',join(android,'app/build/outputs/apk/debug/app-debug.apk')]);device(['install','-r',join(android,'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')]);
 console.log('Running native UI, storage, sync and frame checks…');
 const reconnect=await(await fetch(base+'/api/auth/pair-start',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({serverUrl:base,client:'web'})})).json();const qrPng=(await sharp(Buffer.from(reconnect.qr)).resize(640,640).png().toBuffer()).toString('base64');
 const output=await new Promise((resolve,reject)=>{const child=spawn(adb,['-s',emulator,'shell','am','instrument','-w','-r','-e','albumId',account.albumId,'-e','cookie',cookie,'-e','otherQr',otherQr,'-e','qrPng',qrPng,pkg+'.test/app.worldwide.KotlinSmokeTests'],{env});let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);child.once('exit',code=>code===0?resolve(out):reject(Error(out)));});console.log(output.trim());assert.match(output,/INSTRUMENTATION_CODE: -1/);assert.match(output,/PASS: native Kotlin UI/);
 const synced=await(await fetch(base+'/api/atlas',{headers:{Cookie:cookie}})).json();assert.equal(synced.photos.length,2,'No duplicate legacy/imported photos after Kotlin sync');assert(synced.photos.some(p=>p.countryId==='ITA'&&p.cropZoom===1.7&&p.caption==='Kotlin memory'));assert.equal(synced.visits.find(v=>v.countryId==='HRV').note,'Edited by native Kotlin');assert.equal(synced.visits.find(v=>v.countryId==='ITA').note,'Saved without an account');
 await writeFile('/tmp/worldwide-kotlin-world.png',execFileSync(adb,['-s',emulator,'exec-out','run-as',pkg,'cat','cache/kotlin-world.png'],{env,maxBuffer:12*1024*1024}));await writeFile('/tmp/worldwide-kotlin-frames.json',device(['exec-out','run-as',pkg,'cat','cache/kotlin-frames.json']));console.log('Native map frames:',await readFile('/tmp/worldwide-kotlin-frames.json','utf8'));
 console.log('PASS: Java/WebView-to-Kotlin in-place update preserves albums, original photos, sessions and stable identity; standalone editing, crop, restart and optional sync verified.');
}finally{for(const child of children)if(child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped};for(const port of [3312,3313])spawnSync(adb,['-s',emulator,'reverse','--remove','tcp:'+port],{stdio:'ignore'});spawnSync(adb,['-s',emulator,'shell','rm','-rf',remote],{stdio:'ignore'});for(const name of [pkg+'.test',pkg])spawnSync(adb,['-s',emulator,'uninstall',name],{stdio:'ignore'});await rm(temp,{recursive:true,force:true})}
