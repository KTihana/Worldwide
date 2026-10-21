import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,cp,readFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),android=join(root,'mobile/android');
const sdk=process.env.ANDROID_HOME||join(homedir(),'Library/Android/sdk'),java=process.env.JAVA_HOME||'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const adb=join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb'),tools=join(sdk,'build-tools/36.0.0');
const env={...process.env,JAVA_HOME:java,ANDROID_HOME:sdk};
function run(command,args,{cwd=root,input}={}){const batch=process.platform==='win32'&&command.endsWith('.bat');const result=spawnSync(batch?`"${command}"`:command,args,{cwd,env,input,encoding:input?undefined:'utf8',maxBuffer:20*1024*1024,shell:batch});assert.equal(result.status,0,String(result.stderr||'')+String(result.stdout||''));return String(result.stdout)}
const detected=run(adb,['devices']).split('\n').find(line=>/^emulator-\d+\s+device$/.test(line.trim()))?.split('\t')[0];const emulator=process.env.ANDROID_SERIAL||detected;assert(/^emulator-\d+$/.test(emulator||''));assert.ok(emulator,'Start a dedicated emulator. Physical phones are never targeted.');
const device=(args,options)=>run(adb,['-s',emulator,...args],options),temp=await mkdtemp(join(tmpdir(),'worldwide-update-test-'));
const app='app.worldwide.updatetest',code=Math.floor(Date.now()/1000),version=`99.0.${code+1}`;
const wrapper=join(android,process.platform==='win32'?'gradlew.bat':'gradlew');
try{
 for(let i=0;i<2;i++){
  run(wrapper,['--no-daemon','-PworldwideUpdateTest=true',`-PworldwideTestCode=${code+i}`,`-PworldwideTestVersion=99.0.${code+i}`,'assembleDebug',...(i===1?['assembleDebugAndroidTest']:[])],{cwd:android});
  await cp(join(android,'app/build/outputs/apk/debug/app-debug.apk'),join(temp,i?'candidate.apk':'old.apk'));
 }
 const key=join(temp,'wrong-key.p12'),wrong=join(temp,'wrong-key.apk');
 run(join(java,'bin',process.platform==='win32'?'keytool.exe':'keytool'),['-genkeypair','-keystore',key,'-storetype','PKCS12','-storepass','temporary-test-only','-alias','test','-keyalg','RSA','-keysize','2048','-validity','1','-dname','CN=Disposable update test']);
 run(join(tools,process.platform==='win32'?'apksigner.bat':'apksigner'),['sign','--ks',key,'--ks-pass','pass:temporary-test-only','--out',wrong,join(temp,'candidate.apk')]);
 device(['install','-r',join(temp,'old.apk')]);device(['install','-r',join(android,'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')]);
 device(['shell','run-as',app,'mkdir','-p','cache/updates']);
 for(const name of ['candidate.apk','old.apk','wrong-key.apk'])device(['shell','-T','run-as',app,'sh','-c',`'cat > cache/updates/${name}'`],{input:await readFile(join(temp,name))});
 const instrument=phase=>{const output=device(['shell','am','instrument','-w','-e','updateOnly','true','-e','phase',phase,'-e','version',version,`${app}.test/app.worldwide.NativeSmokeTests`]);assert.match(output,/Android updater validation and data retention passed/,output);console.log(output.trim())};
 instrument('before');
 // Android's normal in-place update preserves private app files and preferences.
 device(['install','-r',join(temp,'candidate.apk')]);instrument('after');
 console.log('Signed APK replacement retained the private session and offline photo. No app was uninstalled.');
}finally{await rm(temp,{recursive:true,force:true})}
