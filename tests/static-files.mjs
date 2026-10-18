import assert from 'node:assert/strict';
import {mkdtemp,writeFile,utimes,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync,brotliCompressSync,gunzipSync,brotliDecompressSync} from 'node:zlib';
import {staticFile} from '../server/static-files.ts';
const root=await mkdtemp(join(tmpdir(),'worldwide-static-'));
const source=Buffer.from('export const hello="world";'.repeat(100));
const request=(headers={},method='GET',path='/assets/app.js')=>new Request(`http://localhost${path}`,{headers,method});
try{
 await mkdir(join(root,'assets'));
 const path=join(root,'assets/app.js');await writeFile(path,source);await writeFile(path+'.gz',gzipSync(source));await writeFile(path+'.br',brotliCompressSync(source));
 for(const [header,encoding,decompress] of [['br, gzip','br',brotliDecompressSync],['gzip;q=1, br;q=0.5','gzip',gunzipSync],['gzip;q=0, br;q=0',null,value=>value],['',null,value=>value]]){
  const response=await staticFile(request({'accept-encoding':header}),root);assert.equal(response.status,200);assert.equal(response.headers.get('content-encoding'),encoding);assert.deepEqual(decompress(Buffer.from(await response.arrayBuffer())),source);assert.match(response.headers.get('cache-control'),/immutable/);
 }
 const first=await staticFile(request({'accept-encoding':'br'}),root);
 const cached=await staticFile(request({'accept-encoding':'br','if-none-match':first.headers.get('etag')}),root);assert.equal(cached.status,304);assert.equal(await cached.text(),'');
 const head=await staticFile(request({'accept-encoding':'br'},'HEAD'),root);assert.equal(await head.text(),'');assert.equal(head.headers.get('content-length'),first.headers.get('content-length'));
 await utimes(path+'.br',new Date(0),new Date(0));assert.equal((await staticFile(request({'accept-encoding':'br, gzip'}),root)).headers.get('content-encoding'),'gzip');
 await writeFile(join(root,'index.html'),'<html>test</html>');assert.equal((await staticFile(request({},'GET','/'),root)).headers.get('cache-control'),'no-cache');
 assert.equal((await staticFile(request({},'GET','/missing'),root)).status,404);
 await assert.rejects(()=>staticFile(request({},'GET','/..%2foutside'),root),/Not found/);
 console.log('PASS: compressed assets, encoding preferences, stale sidecars, ETags, HEAD, cache policy, and traversal protection.');
}finally{await rm(root,{recursive:true,force:true})}
