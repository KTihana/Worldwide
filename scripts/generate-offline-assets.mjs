import {readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
const root=resolve(import.meta.dirname,'../dist');
async function files(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(entry=>entry.isDirectory()?files(resolve(dir,entry.name)):Promise.resolve([resolve(dir,entry.name)])))).flat()}
const paths=(await files(root)).map(path=>'/'+relative(root,path).replaceAll('\\','/')).filter(path=>path!=='/sw.js'&&path!=='/offline-assets.json').sort();
const assets=['/',...paths.filter(path=>path!=='/index.html')];
const version=createHash('sha256').update(assets.join('\n')).digest('hex').slice(0,16);
await writeFile(resolve(root,'offline-assets.json'),JSON.stringify({version,assets}));
console.log(`Offline package: ${assets.length} files (${version})`);
