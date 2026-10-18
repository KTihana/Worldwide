import {readdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
const root=resolve(import.meta.dirname,'../dist');
async function files(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(entry=>entry.isDirectory()?files(resolve(dir,entry.name)):Promise.resolve([resolve(dir,entry.name)])))).flat()}
const paths=(await files(root)).map(path=>'/'+relative(root,path).replaceAll('\\','/')).filter(path=>!path.endsWith('.sha256')&&!/\.(gz|br)$/.test(path)&&path!=='/sw.js'&&path!=='/offline-assets.json').sort();
const assets=['/',...paths.filter(path=>path!=='/index.html')];
const hash=createHash('sha256');
// Strip our generated marker so repeat builds remain byte-for-byte stable.
const indexPath=resolve(root,'index.html');
const html=(await readFile(indexPath,'utf8')).replace(/<meta name="worldwide-build" content="[^"]*">/g,'');
for(const path of paths)hash.update(path).update(path==='/index.html'?html:await readFile(resolve(root,'.'+path)));
const version=hash.digest('hex').slice(0,16);
if(!html.includes('</head>'))throw new Error('Built index.html is missing its head');
await writeFile(indexPath,html.replace('</head>',`<meta name="worldwide-build" content="${version}"></head>`));
await writeFile(resolve(root,'offline-assets.json'),JSON.stringify({version,assets}));
console.log(`Offline package: ${assets.length} files (${version})`);
