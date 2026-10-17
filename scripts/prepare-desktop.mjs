import {writeFile,mkdir,cp,rm} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'..'),output=join(root,'desktop-runtime');
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
// Bundle runtime dependencies too: the utility process runs outside app.asar.
await build({entryPoints:[join(root,'server/index.ts')],outfile:join(output,'server/index.js'),bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import {createRequire as worldwideCreateRequire} from 'node:module'; const require=worldwideCreateRequire(import.meta.url);"}});
for(const name of ['dist','drizzle'])await cp(join(root,name),join(output,name),{recursive:true});
await mkdir(join(output,'app/data'),{recursive:true});for(const name of ['countries.json','map-styles.json'])await cp(join(root,'app/data',name),join(output,'app/data',name));
await writeFile(join(output,'package.json'),JSON.stringify({type:'module'}));
console.log(`Prepared desktop runtime in ${relative(root,output)}`);
