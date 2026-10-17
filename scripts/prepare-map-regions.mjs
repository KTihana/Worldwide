import {readFile,mkdir,writeFile} from 'node:fs/promises';
const {regions}=JSON.parse(await readFile(new URL('../app/data/focus.json',import.meta.url),'utf8'));
const dir=new URL('../public/geography/regions/',import.meta.url);await mkdir(dir,{recursive:true});
for(const [name,region] of Object.entries(regions))await writeFile(new URL(name.replaceAll(' ','-')+'.json',dir),JSON.stringify(region));
console.log('Continent geometry prepared for on-demand loading.');
