import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {dirname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const dataDirectory=resolve(process.env.ELSEWHERE_DATA_DIR||resolve(projectRoot,'data'));
mkdirSync(dataDirectory,{recursive:true,mode:0o700});
const database=new DatabaseSync(resolve(dataDirectory,'atlas.sqlite'));
database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
database.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY);');
for(const name of readdirSync(resolve(projectRoot,'drizzle')).filter(f=>f.endsWith('.sql')).sort()){
 if(database.prepare('SELECT name FROM local_migrations WHERE name=?').get(name))continue;
 database.exec('BEGIN IMMEDIATE');
 try{database.exec(readFileSync(resolve(projectRoot,'drizzle',name),'utf8'));database.prepare('INSERT INTO local_migrations(name) VALUES(?)').run(name);database.exec('COMMIT')}
 catch(error){database.exec('ROLLBACK');throw error}
}
class Statement{
 sql:string;values:SQLInputValue[]=[];
 constructor(sql:string){this.sql=sql}
 bind(...values:unknown[]){this.values=values.map(value=>{if(value===null||typeof value==='string'||typeof value==='number'||typeof value==='bigint'||value instanceof Uint8Array)return value;throw new Error('Unsupported database value')});return this}
 first<T=Record<string,unknown>>(){return (database.prepare(this.sql).get(...this.values)||null) as T|null}
 all(){return {results:database.prepare(this.sql).all(...this.values)}}
 run(){const result=database.prepare(this.sql).run(...this.values);return {meta:{changes:Number(result.changes)}}}
}
export const db={
 prepare(sql:string){return new Statement(sql)},
 batch(statements:Statement[]){database.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>/^\s*SELECT\b/i.test(s.sql)?s.all():s.run());database.exec('COMMIT');return result as Array<{results:Record<string,unknown>[]}>}catch(error){database.exec('ROLLBACK');throw error}},
 close(){database.close()},
};
const uploadDirectory=resolve(dataDirectory,'uploads');
function photoPath(key:string){if(!key.split('/').every(part=>/^[a-zA-Z0-9_-]+$/.test(part)))throw new Error('Invalid photo path');const path=resolve(uploadDirectory,key);if(!path.startsWith(uploadDirectory+sep))throw new Error('Invalid photo path');return path}
export const bucket={
 async put(key:string,bytes:ArrayBuffer,_options?:unknown){const path=photoPath(key);await mkdir(dirname(path),{recursive:true,mode:0o700});const temp=path+'.'+crypto.randomUUID()+'.tmp';try{await writeFile(temp,new Uint8Array(bytes),{mode:0o600});await rename(temp,path)}catch(error){await rm(temp,{force:true});throw error}},
 async get(key:string){try{return {body:Uint8Array.from(await readFile(photoPath(key)))}}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}},
 async delete(key:string){await rm(photoPath(key),{force:true})},
};
