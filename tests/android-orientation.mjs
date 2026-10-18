import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {delimiter,join,relative,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';

const root=resolve(import.meta.dirname,'..'),source=join(root,'mobile/android');
const packageName='app.worldwide.orientationtest',testPackage=packageName+'.test';
const sdk=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,join(homedir(),'Library/Android/sdk'),join(homedir(),'Android/Sdk'),join(homedir(),'AppData/Local/Android/Sdk')].find(value=>value&&existsSync(value));
const java=[process.env.JAVA_HOME,'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home','/Applications/Android Studio.app/Contents/jbr/Contents/Home'].find(value=>value&&existsSync(join(value,'bin',process.platform==='win32'?'java.exe':'java')));
assert(sdk&&java,'Set ANDROID_HOME and JAVA_HOME to an installed Android SDK and JDK 21.');
assert(existsSync(join(root,'dist/index.html')),'Run npm run build before the orientation test.');
const env={...process.env,ANDROID_HOME:sdk,JAVA_HOME:java,PATH:join(java,'bin')+delimiter+(process.env.PATH||'')};
delete env.WORLDWIDE_ANDROID_KEYSTORE;delete env.WORLDWIDE_ANDROID_KEY_PASSWORD;
const adb=join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');
async function run(command,args,{cwd=root,live=false,allowFailure=false}={}){
 return await new Promise((resolveResult,reject)=>{
  const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe'],shell:process.platform==='win32'&&command.endsWith('.bat')});
  let output='';
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk;if(live)process.stdout.write(chunk)});
  child.on('error',reject);
  child.on('close',code=>code===0||allowFailure?resolveResult(output):reject(new Error(`${command} exited ${code}\n${output}`)));
 });
}
const available=(await run(adb,['devices'])).split('\n').map(value=>value.trim()).filter(value=>/^emulator-\d+\s+device$/.test(value)).map(value=>value.split(/\s+/)[0]);
const device=process.env.ANDROID_SERIAL||available[0];
assert(device&&/^emulator-\d+$/.test(device)&&available.includes(device),'Start a dedicated emulator or select it with ANDROID_SERIAL. Physical phones are never targeted.');
assert.equal((await run(adb,['-s',device,'shell','getprop','ro.kernel.qemu'])).trim(),'1','Only an Android emulator may run this test.');
const temp=await mkdtemp(join(tmpdir(),'worldwide-orientation-')),android=join(temp,'android');
let installed=false;
try{
 // Isolate Gradle outputs/configuration from concurrent native work and releases.
 await cp(source,android,{recursive:true,filter:path=>{
  const parts=relative(source,path).split(sep);
  return !parts.some(part=>['build','.gradle','.idea'].includes(part))&&!relative(source,path).startsWith(['app','src','main','assets','www'].join(sep));
 }});
 await cp(join(root,'dist'),join(android,'app/src/main/assets/www'),{recursive:true,filter:path=>!path.endsWith('.gz')&&!path.endsWith('.br')});
 const manifest=await readFile(join(android,'app/src/main/AndroidManifest.xml'),'utf8');
 assert.match(manifest,/<activity\b[^>]*android:name="\.MainActivity"[^>]*android:screenOrientation="portrait"/,'MainActivity must start in portrait before this test is built.');
 const gradle=join(android,'app/build.gradle');
 await writeFile(gradle,(await readFile(gradle,'utf8'))+`\n// Disposable orientation test: never use the production package or runner.\nandroid { defaultConfig { applicationId '${packageName}'; testApplicationId '${testPackage}'; testInstrumentationRunner 'app.worldwide.OrientationSmokeTests' } }\n`);
 await run(join(android,process.platform==='win32'?'gradlew.bat':'gradlew'),['--no-daemon','assembleDebug','assembleDebugAndroidTest'],{cwd:android,live:true});
 for(const apk of ['app/build/outputs/apk/debug/app-debug.apk','app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk']){
  await run(adb,['-s',device,'install','-r',join(android,apk)]);installed=true;
 }
 const result=await run(adb,['-s',device,'shell','am','instrument','-w','-r',`${testPackage}/app.worldwide.OrientationSmokeTests`],{live:true});
 assert.match(result,/INSTRUMENTATION_CODE: -1/,'Orientation instrumentation did not finish successfully.');
 assert.match(result,/portrait sign-out passed/,'Orientation checks did not run.');
 console.log(`PASS: Android portrait entry/login and landscape map (${device}); production package/data untouched.`);
}finally{
 if(installed)for(const name of [testPackage,packageName])await run(adb,['-s',device,'uninstall',name],{allowFailure:true}).catch(()=>{});
 await rm(temp,{recursive:true,force:true});
}
