import {readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gzip,brotliCompress,constants} from 'node:zlib';
import {promisify} from 'node:util';
const root=resolve(import.meta.dirname,'../dist'),gz=promisify(gzip),br=promisify(brotliCompress);
async function files(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(entry=>entry.isDirectory()?files(resolve(dir,entry.name)):[resolve(dir,entry.name)]))).flat()}
const paths=(await files(root)).filter(path=>/\.(js|css|json|svg|html|webmanifest)$/.test(path));let index=0,total=0,compressed=0;
await Promise.all(Array.from({length:2},async()=>{while(index<paths.length){const path=paths[index++],source=await readFile(path);if(source.length<1024)continue;const [gzipBytes,brBytes]=await Promise.all([gz(source,{level:6}),br(source,{params:{[constants.BROTLI_PARAM_QUALITY]:4}})]);if(gzipBytes.length<source.length*.9)await writeFile(path+'.gz',gzipBytes);if(brBytes.length<source.length*.9)await writeFile(path+'.br',brBytes);total+=source.length;compressed+=gzipBytes.length}}));
console.log(`Compressed website text: ${(total/1024/1024).toFixed(1)} → ${(compressed/1024/1024).toFixed(1)} MB over Wi-Fi.`);
