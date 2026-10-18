import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {writeFileSync} from 'node:fs';

const root=resolve(import.meta.dirname,'..'),android=join(root,'mobile/android');
const sdk=process.env.ANDROID_HOME||join(homedir(),'Library/Android/sdk');
const env={...process.env,ANDROID_HOME:sdk,JAVA_HOME:process.env.JAVA_HOME||'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'};
const adb=join(sdk,'platform-tools/adb');
const testPackage='app.worldwide.widgettest';
function run(bin,args,cwd=root){
  const result=spawnSync(bin,args,{cwd,env,encoding:'utf8',maxBuffer:10*1024*1024});
  assert.equal(result.status,0,result.stdout+result.stderr);
  return result.stdout;
}
const available=run(adb,['devices']).split('\n').map(line=>line.trim()).filter(line=>/^emulator-\d+\s+device$/.test(line)).map(line=>line.split(/\s+/)[0]);
const device=process.env.WORLDWIDE_TEST_EMULATOR||available[0];
assert.ok(device&&available.includes(device),'Start a dedicated Android emulator. Physical phones are never targeted.');
run(join(android,'gradlew'),['--no-daemon','-PworldwideWidgetTest=true','assembleDebug','assembleDebugAndroidTest'],android);
for(const file of ['app/build/outputs/apk/debug/app-debug.apk','app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'])
  run(adb,['-s',device,'install','-r',join(android,file)]);
run(adb,['-s',device,'shell','appwidget','grantbind','--package',testPackage,'--user','0']);
const result=run(adb,['-s',device,'shell','am','instrument','-w','-e','widgetOnly','true',`${testPackage}.test/app.worldwide.NativeSmokeTests`]);
console.log(result);
assert.match(result,/Transparent atlas widget: taps, photo cycling, responsive layouts, wallpaper previews and privacy passed\./);
// am instrument prints only the stream when this custom runner succeeds.
assert.doesNotMatch(result,/INSTRUMENTATION_FAILED|FAILURES!!!|AssertionError/);

function readCache(name){
  assert.match(name,/^[a-z-]+\.(png|json)$/);
  const output=spawnSync(adb,['-s',device,'exec-out','run-as',testPackage,'cat',`cache/${name}`],{maxBuffer:20*1024*1024});
  assert.equal(output.status,0,output.stderr.toString());
  return output.stdout;
}
const manifest=JSON.parse(readCache('widget-previews.json'));
assert.match(manifest.fixture,/Synthetic/);
assert.deepEqual(manifest.previews.map(preview=>preview.name),['world','country','compact','wide','light','busy','text-large','empty','long-country']);
for(const preview of manifest.previews){
  const png=readCache(`widget-${preview.name}.png`);
  assert.equal(png.subarray(1,4).toString(),'PNG','Screenshot has a valid PNG header');
  assert.equal(png.readUInt32BE(16),Math.round(preview.widthDp*preview.density),'Screenshot width uses the device density');
  assert.equal(png.readUInt32BE(20),Math.round(preview.heightDp*preview.density),'Screenshot height uses the device density');
  writeFileSync(`/tmp/worldwide-widget-${preview.name}.png`,png);
}
writeFileSync('/tmp/worldwide-widget-previews.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`Saved ${manifest.previews.length} density-correct widget previews to /tmp/worldwide-widget-*.png (synthetic demo scenery).`);
