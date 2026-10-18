import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {writeFileSync} from 'node:fs';
const root=resolve(import.meta.dirname,'..'),android=join(root,'mobile/android');
const sdk=process.env.ANDROID_HOME||join(homedir(),'Library/Android/sdk');
const env={...process.env,ANDROID_HOME:sdk,JAVA_HOME:process.env.JAVA_HOME||'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'};
const adb=join(sdk,'platform-tools/adb');
function run(bin,args,cwd=root){const result=spawnSync(bin,args,{cwd,env,encoding:'utf8',maxBuffer:10*1024*1024});assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout;}
const device=run(adb,['devices']).split('\n').find(line=>/^emulator-\d+\s+device$/.test(line.trim()))?.split('\t')[0];assert.ok(device,'Start a dedicated Android emulator. Physical phones are never targeted.');
run(join(android,'gradlew'),['--no-daemon','-PworldwideWidgetTest=true','assembleDebug','assembleDebugAndroidTest'],android);
for(const file of ['app/build/outputs/apk/debug/app-debug.apk','app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'])run(adb,['-s',device,'install','-r',join(android,file)]);
run(adb,['-s',device,'shell','appwidget','grantbind','--package','app.worldwide.widgettest','--user','0']);
const result=run(adb,['-s',device,'shell','am','instrument','-w','-e','widgetOnly','true','app.worldwide.widgettest.test/app.worldwide.NativeSmokeTests']);console.log(result);assert.match(result,/Transparent widget, country selection, offline photos, resize and privacy passed/);
const preview=spawnSync(adb,['-s',device,'exec-out','run-as','app.worldwide.widgettest','cat','cache/widget-preview.png']);assert.equal(preview.status,0);writeFileSync('/tmp/worldwide-widget-preview.png',preview.stdout);
