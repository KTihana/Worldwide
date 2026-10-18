import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes,scryptSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const temp=await mkdtemp(join(tmpdir(),'worldwide-identity-'));
process.env.ELSEWHERE_DATA_DIR=temp;
const legacy=new DatabaseSync(join(temp,'atlas.sqlite'));
legacy.exec('PRAGMA foreign_keys=ON;CREATE TABLE local_migrations(name TEXT PRIMARY KEY)');
for(const name of (await readdir(new URL('../drizzle/',import.meta.url))).filter(name=>name.endsWith('.sql')&&name<'0005').sort()){
 legacy.exec(await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 legacy.prepare('INSERT INTO local_migrations(name) VALUES(?)').run(name);
}
const secret='A private migration test password',salt='0123456789abcdef0123456789abcdef';
const encoded=salt+':'+scryptSync(secret,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024}).toString('hex');
const token='a'.repeat(64),digest=value=>createHash('sha256').update(value).digest('hex');
legacy.prepare('INSERT INTO accounts(id,email,password_hash,recovery_hash,created_at,map_style) VALUES(?,?,?,?,?,?)').run('local','existing@example.test',encoded,digest('fixture-recovery'),'2026-10-18','robinson');
legacy.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),'local',Date.now()+60000);
legacy.prepare('INSERT INTO visits(user_id,country_id,visited,note,updated_at) VALUES(?,?,?,?,?)').run('local','HRV',1,'Keep this memory','2026-10-18');
legacy.prepare('INSERT INTO photos(id,user_id,country_id,object_key,content_type,created_at) VALUES(?,?,?,?,?,?)').run('saved-photo','local','HRV','local/saved-photo','image/webp','2026-10-18');
legacy.close();
const {db}=await import('../server/storage.ts');
const {authRoute}=await import('../server/auth.ts');
const base='http://127.0.0.1:3000';let cookie='elsewhere_session='+token;
async function call(action,body,options={}){
 const request=new Request(base+'/api/auth/'+action,{method:body===undefined?'GET':'POST',headers:{origin:options.origin||base,cookie:options.cookie??cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{return await authRoute(request,action,options.local??true,'identity-test',[base])}
 catch(error){return Response.json({error:error.message},{status:error.status||500})}
}
try{
 assert.equal(db.prepare('SELECT username FROM accounts').first().username,null,'Migration leaves existing accounts usable');
 const albumId=db.prepare('SELECT album_id FROM accounts WHERE id=?').bind('local').first().album_id;
 assert.match(albumId,/^[a-f0-9]{32}$/,'Migration assigns an opaque album identity');
 const reopened=new DatabaseSync(join(temp,'atlas.sqlite'));assert.equal(reopened.prepare('SELECT album_id FROM accounts WHERE id=?').get('local').album_id,albumId,'Album identity persists on disk');reopened.close();
 const session=await(await call('session')).json();assert.equal(session.account.email,'existing@example.test');assert.equal(session.account.username,null,'Existing session survives migration');assert.equal(session.account.albumId,albumId);
 assert.equal(db.prepare('SELECT password_hash FROM accounts').first().password_hash,encoded);
 assert.equal((await call('username',{username:'traveler'},{cookie:''})).status,401);
 assert.equal((await call('username',{username:'traveler'},{origin:'https://other.example'})).status,403);
 assert.equal((await call('username',{username:'name@example.test'})).status,400,'Username cannot be confused with an email');
 const profile=await call('username',{username:'  Trail_Atlas  '});assert.equal(profile.status,200);assert.deepEqual((await profile.json()).account,{email:'existing@example.test',username:'trail_atlas',albumId},'Username edit keeps album identity');
 assert.equal(profile.headers.get('set-cookie'),null,'Choosing a username preserves current device sessions');
 for(const credentials of [{identifier:'TRAIL_ATLAS',password:secret},{identifier:' EXISTING@EXAMPLE.TEST ',password:secret},{email:'existing@example.test',password:secret}]){
  const response=await call('login',credentials,{cookie:''});assert.equal(response.status,200);assert.deepEqual((await response.json()).account,{email:'existing@example.test',username:'trail_atlas',albumId});
 }
 const pairStart=await call('pair-start',{serverUrl:base});assert.equal(pairStart.status,200);
 const pairing=await pairStart.json(),pairToken=new URL(pairing.pairingUrl).searchParams.get('token');
 const paired=await call('pair-complete',{token:pairToken},{cookie:''});assert.equal(paired.status,200);assert.equal((await paired.json()).account.albumId,albumId,'Pairing returns the same album identity');
 const wrong=await call('login',{identifier:'trail_atlas',password:'Wrong private password'},{cookie:''});
 const unknown=await call('login',{identifier:'missing_user',password:secret},{cookie:''});
 assert.equal(wrong.status,401);assert.equal(unknown.status,401);assert.deepEqual(await wrong.json(),await unknown.json(),'Failed login does not reveal whether an identifier exists');
 assert.equal((await(await call('session')).json()).account.albumId,albumId,'Existing session keeps the same identity');
 assert.equal(db.prepare('SELECT note FROM visits').first().note,'Keep this memory');
 assert.equal(db.prepare('SELECT object_key FROM photos').first().object_key,'local/saved-photo');
 assert.equal(db.prepare('SELECT map_style FROM accounts').first().map_style,'robinson');
 // A second fixture row exercises the case-insensitive uniqueness constraint.
 db.prepare('INSERT INTO accounts(id,email,password_hash,recovery_hash,created_at,username,album_id) VALUES(?,?,?,?,?,?,?)').bind('other','other@example.test',encoded,digest('fixture'),'2026-10-18','taken_name',randomBytes(16).toString('hex')).run();
 assert.equal((await call('username',{username:'TAKEN_NAME'})).status,409);
 const separate=new DatabaseSync(join(temp,'separate.sqlite'));
 for(const name of (await readdir(new URL('../drizzle/',import.meta.url))).filter(name=>name.endsWith('.sql')&&name<'0006').sort())separate.exec(await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 separate.prepare('INSERT INTO accounts(id,email,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?)').run('local','existing@example.test',encoded,digest('other-fixture'),'2026-10-18');
 separate.exec(await readFile(new URL('../drizzle/0006_album_identity.sql',import.meta.url),'utf8'));
 const otherAlbumId=separate.prepare('SELECT album_id FROM accounts WHERE id=?').get('local').album_id;separate.close();
 assert.match(otherAlbumId,/^[a-f0-9]{32}$/);assert.notEqual(otherAlbumId,albumId,'Independent computers with the same email have distinct albums');
 db.prepare('DELETE FROM sessions').run();db.prepare('DELETE FROM accounts').run();db.prepare('DELETE FROM auth_attempts').run();cookie='';
 const setup={email:'new@example.test',username:'New_Traveler',password:secret,passwordConfirmation:secret};
 for(const username of [undefined,'ab','name@example.test','x'.repeat(25)]){
  assert.equal((await call('setup',{...setup,username})).status,400);
  assert.equal(db.prepare('SELECT id FROM accounts').first(),null,'Invalid setup creates no account');
 }
 for(const passwordConfirmation of [undefined,'A different private password'])assert.equal((await call('setup',{...setup,passwordConfirmation})).status,400,'Both passwords must be supplied and match');
 assert.equal((await call('setup',setup,{local:false})).status,403,'New signup remains limited to the hosting computer');
 const created=await call('setup',setup);assert.equal(created.status,200);assert.equal(created.headers.get('cache-control'),'no-store');assert.match(created.headers.get('set-cookie'),/HttpOnly/);
 const createdAccount=(await created.json()).account;assert.match(createdAccount.albumId,/^[a-f0-9]{32}$/);assert.notEqual(createdAccount.albumId,albumId);assert.deepEqual(createdAccount,{email:setup.email,username:'new_traveler',albumId:createdAccount.albumId});
 assert.equal(db.prepare('SELECT note FROM visits').first().note,'Keep this memory','Setup preserves attached album records');
 assert.equal(db.prepare('SELECT object_key FROM photos').first().object_key,'local/saved-photo');
 console.log('PASS: required username and matching passwords, email/username login, generic failures, authenticated username changes, uniqueness, and existing account/session/album migration.');
}finally{db.close();await rm(temp,{recursive:true,force:true})}
