import {readFile,writeFile,readdir,mkdir,cp,rm} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'..'),output=join(root,'desktop-runtime');
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
async function compile(folder){for(const entry of await readdir(join(root,folder),{withFileTypes:true})){const source=join(folder,entry.name);if(entry.isDirectory())await compile(source);else if(entry.name.endsWith('.ts')){const code=await readFile(join(root,source),'utf8');const result=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/(from\s+['"]|import\(['"])([^'"]+)\.ts(['"])/g,'$1$2.js$3');const destination=join(output,source.replace(/\.ts$/,'.js'));await mkdir(resolve(destination,'..'),{recursive:true});await writeFile(destination,result)}}}
await compile('server');await compile('app/api');
for(const name of ['dist','drizzle'])await cp(join(root,name),join(output,name),{recursive:true});
await mkdir(join(output,'app/data'),{recursive:true});for(const name of ['countries.json','map-styles.json'])await cp(join(root,'app/data',name),join(output,'app/data',name));
await writeFile(join(output,'package.json'),JSON.stringify({type:'module'}));
console.log(`Prepared desktop runtime in ${relative(root,output)}`);
