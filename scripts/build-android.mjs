import {existsSync} from 'node:fs';
import {cp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),android=join(root,'mobile/android');
if(!existsSync(join(root,'dist/index.html')))throw new Error('Run npm run build first.');
await mkdir(join(android,'app/src/main/assets'),{recursive:true});
// Assets are rebuilt as a complete tree so old application bundles do not inflate the APK.
const {rm}=await import('node:fs/promises');await rm(join(android,'app/src/main/assets/www'),{recursive:true,force:true});
await cp(join(root,'dist'),join(android,'app/src/main/assets/www'),{recursive:true});
if(process.argv.includes('--sync-only')){console.log('Worldwide web bundle copied into the Android app.');process.exit(0)}
const sdk=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,join(homedir(),'Library/Android/sdk'),join(homedir(),'AppData/Local/Android/Sdk'),join(homedir(),'Android/Sdk')].find(path=>path&&existsSync(path));
if(!sdk)throw new Error('Install the Android SDK (API 36) through Android Studio, then set ANDROID_HOME.');
const java=[process.env.JAVA_HOME,'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home','/Applications/Android Studio.app/Contents/jbr/Contents/Home',join(process.env.ProgramFiles||'C:\\Program Files','Android/Android Studio/jbr')].find(path=>path&&existsSync(join(path,'bin',process.platform==='win32'?'java.exe':'java')));
if(!java)throw new Error('Set JAVA_HOME to a Java 21 installation (Android Studio includes a JDK).');
const env={...process.env,JAVA_HOME:java,ANDROID_HOME:sdk,PATH:join(java,'bin')+ (process.platform==='win32'?';':':')+process.env.PATH};
const keyDir=join(root,'data/build-keys');await mkdir(keyDir,{recursive:true,mode:0o700});
const key=join(keyDir,'worldwide-android.p12'),secret=join(keyDir,'android-password');
if(!existsSync(key)){
 const password=randomBytes(32).toString('hex');await writeFile(secret,password,{mode:0o600});env.WORLDWIDE_ANDROID_KEY_PASSWORD=password;
 const result=spawnSync(join(java,'bin',process.platform==='win32'?'keytool.exe':'keytool'),['-genkeypair','-keystore',key,'-storetype','PKCS12','-storepass:env','WORLDWIDE_ANDROID_KEY_PASSWORD','-alias','worldwide','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Worldwide Personal App'],{env,stdio:'pipe'});
 if(result.status!==0)throw new Error('Could not generate the private Android signing key.');
}else env.WORLDWIDE_ANDROID_KEY_PASSWORD=(await readFile(secret,'utf8')).trim();
env.WORLDWIDE_ANDROID_KEYSTORE=key;
const wrapper=join(android,process.platform==='win32'?'gradlew.bat':'gradlew');
const result=spawnSync(process.platform==='win32'?`"${wrapper}"`:wrapper,['--no-daemon','assembleRelease'],{cwd:android,env,stdio:'inherit',shell:process.platform==='win32'});
if(result.status!==0)process.exit(result.status||1);
await mkdir(join(root,'releases'),{recursive:true});
const output=join(root,'releases/Worldwide-Android.apk');await cp(join(android,'app/build/outputs/apk/release/app-release.apk'),output);
console.log(`Android installer: ${output}\nKeep data/build-keys safe: the same signing key is required for future app updates.`);
