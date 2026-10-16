import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173';
if(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(base))throw new Error('Run this smoke test against a local preview only.');
const auth=await fetch(base+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});
const cookie=auth.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie,'Local sign-in cookie');
const headers={cookie,origin:base};
async function request(path,options={}){const r=await fetch(base+path,{...options,headers:{...headers,...options.headers}});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():await r.arrayBuffer()}}
const get=()=>request('/api/atlas');
const patch=body=>request('/api/countries/NZL',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const start=(await get()).data;const baseline=start.visits.find(v=>v.countryId==='NZL');const ids=[];
try{
 assert.equal((await fetch(base+'/api/atlas')).status,401,'Anonymous data access blocked');
 assert.equal((await request('/api/countries/NZL',{method:'PATCH',headers:{origin:'https://example.org','Content-Type':'application/json'},body:'{"visited":true}'})).status,403,'Cross-origin writes blocked');
 assert.equal((await patch({visited:'yes'})).status,400,'Invalid visit rejected');
 assert.equal((await patch({visited:true,note:'A local smoke test',visitDate:'2025-06-12'})).status,200);
 let data=(await get()).data;assert.equal(data.visits.find(v=>v.countryId==='NZL').visited,1,'Visit persisted');
 assert.equal(data.visits.find(v=>v.countryId==='NZL').note,'A local smoke test','Note persisted');
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCmcAAAAASUVORK5CYII=','base64');
 for(let i=0;i<2;i++){const f=new FormData();f.set('countryId','NZL');f.set('photo',new Blob([bytes],{type:'image/png'}),'test.png');const result=await request('/api/photos',{method:'POST',body:f});assert.equal(result.status,201,'Photo uploaded');ids.push(result.data.id)}
 data=(await get()).data;assert.equal(data.photos.filter(p=>ids.includes(p.id)).length,2,'Both photos persisted');
 assert.equal(data.visits.find(v=>v.countryId==='NZL').coverId,baseline?.coverId||ids[0],'First photo used as cover');
 assert.equal((await patch({coverId:ids[1]})).status,200,'Cover changed');
 assert.equal((await request(`/api/photos/${ids[1]}`)).status,200,'Photo served');
 assert.equal((await fetch(base+`/api/photos/${ids[1]}`)).status,401,'Anonymous photo access blocked');
 assert.equal((await request(`/api/photos/${ids[1]}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{"caption":"A caption"}'})).status,200);
 data=(await get()).data;assert.equal(data.photos.find(p=>p.id===ids[1]).caption,'A caption','Caption persisted');
 assert.equal((await request(`/api/photos/${ids[1]}`,{method:'DELETE'})).status,200);
 data=(await get()).data;assert.ok(data.visits.find(v=>v.countryId==='NZL').coverId,'Deleting cover selects another photo');
 assert.equal((await request(`/api/photos/${ids[1]}`)).status,404,'Deleted photo no longer served');
 assert.equal((await patch({visited:false})).status,200,'Visited status can be cleared without removing photos');
 data=(await get()).data;assert.equal(data.visits.find(v=>v.countryId==='NZL').visited,0);
 assert.ok(data.photos.some(p=>p.id===ids[0]),'Photos kept when visit is unmarked');
 const invalid=new FormData();invalid.set('countryId','NZL');invalid.set('photo',new Blob(['not an image'],{type:'image/png'}),'fake.png');assert.equal((await request('/api/photos',{method:'POST',body:invalid})).status,400,'Non-image content blocked');
 console.log('PASS: local sign-in, persistence, visits, notes, dates, two photo uploads, cover changes, captions, photo retrieval, deletion fallback, input validation and anonymous/cross-origin protections.');
}finally{for(const id of ids)await request(`/api/photos/${id}`,{method:'DELETE'});await patch({visited:!!baseline?.visited,note:baseline?.note||'',visitDate:baseline?.visitDate||null,coverId:baseline?.coverId||null})}
