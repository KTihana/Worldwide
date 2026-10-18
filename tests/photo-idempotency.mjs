import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const temp=await mkdtemp(join(tmpdir(),'worldwide-photo-idempotency-'));
process.env.ELSEWHERE_DATA_DIR=temp;
const base='http://127.0.0.1:3000';
const {authRoute}=await import('../server/auth.ts');
const {db}=await import('../server/storage.ts');
const {POST}=await import('../app/api/photos/route.ts');
const {PATCH}=await import('../app/api/photos/[id]/route.ts');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCmcAAAAASUVORK5CYII=','base64');
const changed=Buffer.from(png);changed[changed.length-1]^=1;
const gif=Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00\x00\x00\x3b','binary');
let ownerCookie='';

function multipart({id,countryId='HRV',bytes=png,type='image/png',caption='First memory',width='1',height='1',cookie=ownerCookie,duplicateId=false}){
 const body=new FormData();body.set('countryId',countryId);body.set('photo',new Blob([bytes],{type}),'photo');body.set('caption',caption);body.set('width',width);body.set('height',height);
 if(id!==undefined){body.set('photoId',id);if(duplicateId)body.append('photoId',id)}
 return POST(new Request(base+'/api/photos',{method:'POST',headers:{origin:base,cookie},body}));
}
async function result(response){return {status:response.status,data:await response.json()}}
function record(id){return db.prepare('SELECT * FROM photos WHERE id=?').bind(id).first()}

try{
 const setup=new Request(base+'/api/auth/setup',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'photos@example.test',username:'photo_owner',password:'private album password',passwordConfirmation:'private album password'})});
 const account=await authRoute(setup,'setup',true,'idempotency-test');assert.equal(account.status,200);
 ownerCookie=account.headers.get('set-cookie').split(';')[0];

 const id=randomUUID();
 const first=await result(await multipart({id}));assert.equal(first.status,201);assert.equal(first.data.id,id);
 const saved=record(id);assert.equal(saved.user_id,'local');assert.equal(saved.country_id,'HRV');
 db.prepare('UPDATE photos SET caption=?,crop_x=?,crop_y=?,crop_zoom=?,sort_order=? WHERE id=?').bind('Edited memory',.35,-.25,2.2,17,id).run();
 db.prepare('UPDATE visits SET updated_at=?,note=? WHERE user_id=? AND country_id=?').bind('2026-01-01T00:00:00.000Z','Kept note','local','HRV').run();
 const beforeVisit=db.prepare('SELECT * FROM visits WHERE user_id=? AND country_id=?').bind('local','HRV').first();
 const retry=await result(await multipart({id,caption:'Stale caption',width:'400',height:'300'}));
 assert.equal(retry.status,200);assert.deepEqual(retry.data,{...first.data,caption:'Edited memory',cropX:.35,cropY:-.25,cropZoom:2.2,width:1,height:1});
 assert.deepEqual(db.prepare('SELECT * FROM visits WHERE user_id=? AND country_id=?').bind('local','HRV').first(),beforeVisit,'Retry leaves visit and cover untouched');
 assert.equal(record(id).sort_order,17,'Retry leaves order untouched');
 assert.equal(record(id).object_key,saved.object_key,'Retry keeps the original file');
 assert.equal(db.prepare('SELECT COUNT(*) AS count FROM photos WHERE id=?').bind(id).first().count,1);
 assert.equal((await multipart({id,bytes:changed})).status,409,'Changed bytes conflict');
 assert.equal((await multipart({id,countryId:'NZL'})).status,409,'Changed country conflicts');
 assert.equal((await multipart({id,bytes:gif,type:'image/gif'})).status,409,'Changed content type conflicts');
 assert.equal((await multipart({id,width:'-1'})).status,400,'Invalid dimensions are checked before retry');
 assert.equal((await multipart({id,bytes:Buffer.from('bad')})).status,400,'Invalid image is checked before retry');
 for(const malformed of ['',id.toUpperCase(),'../private','00000000-0000-0000-0000-000000000000'])assert.equal((await multipart({id:malformed})).status,400,'Malformed photo IDs are rejected');
 assert.equal((await multipart({id,duplicateId:true})).status,400,'Duplicate ID fields are rejected');

 const otherToken=randomBytes(32).toString('hex'),otherCookie='elsewhere_session='+otherToken;
 db.prepare('INSERT INTO accounts(id,email,username,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').bind('other','other@example.test','other_owner','unused','unused',new Date().toISOString()).run();
 db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(otherToken).digest('hex'),'other',Date.now()+60_000).run();
 const other=await result(await multipart({id,cookie:otherCookie}));assert.equal(other.status,409);assert.deepEqual(Object.keys(other.data),['error'],'Collision does not reveal another owner’s photo');
 assert.equal(record(id).user_id,'local');

 const simultaneousId=randomUUID();
 const simultaneous=await Promise.all(Array.from({length:6},()=>multipart({id:simultaneousId})));
 assert.deepEqual(simultaneous.map(r=>r.status).sort(),[200,200,200,200,200,201],'Simultaneous exact retries create one photo');
 assert.equal(db.prepare('SELECT COUNT(*) AS count FROM photos WHERE id=?').bind(simultaneousId).first().count,1);
 const conflictingId=randomUUID();
 const conflict=await Promise.all([multipart({id:conflictingId,bytes:png}),multipart({id:conflictingId,bytes:changed})]);
 assert.deepEqual(conflict.map(r=>r.status).sort(),[201,409],'Concurrent conflicting bytes never both win');
 const winner=conflict.findIndex(r=>r.status===201),winningBytes=winner===0?png:changed;
 const winningPhoto=record(conflictingId);const {bucket}=await import('../server/storage.ts');
 assert.deepEqual(Buffer.from((await bucket.get(winningPhoto.object_key)).body),winningBytes,'Conflict cannot overwrite the winning bytes');
 assert.deepEqual(Buffer.from((await bucket.get(saved.object_key)).body),png,'Original photo bytes remain intact');
 const withoutId=await result(await multipart({}));assert.equal(withoutId.status,201);assert.match(withoutId.data.id,/^[0-9a-f-]{36}$/,'Existing uploads still get generated IDs');

 console.log('PASS: native photo IDs retry exactly, preserve metadata and bytes, reject conflicts across owners, and serialize simultaneous uploads.');
}finally{db.close();await rm(temp,{recursive:true,force:true})}
