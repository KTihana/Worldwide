import assert from 'node:assert/strict';
import {createRemoteImageImporter,publicAddress,imageUrl,pinnedRequestOptions} from '../server/remote-image.ts';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCmcAAAAASUVORK5CYII=','base64');
const publicDns=async()=>[{address:'93.184.215.14',family:4}];
function response({status=200,headers={'content-type':'image/png'},chunks=[png]}={}){return {status,headers,closed:false,body:(async function*(){for(const chunk of chunks)yield chunk})(),close(){this.closed=true}}}
const fails=(work,status)=>assert.rejects(work,error=>error.status===status);
for(const ip of ['0.1.2.3','10.5.6.7','100.64.0.1','100.127.255.255','127.0.0.2','169.254.169.254','172.16.0.1','172.31.255.255','192.0.0.9','192.0.2.1','192.168.1.1','192.88.99.1','192.31.196.1','192.52.193.1','192.175.48.1','198.18.0.1','198.19.255.255','198.51.100.1','203.0.113.1','224.0.0.1','239.1.1.1','240.0.0.1','255.255.255.255','::','::1','::ffff:127.0.0.1','::ffff:7f00:1','::ffff:5db8:d70e','64:ff9b::7f00:1','64:ff9b:1::1','100::1','2001::1','2001:10::1','2001:db8::1','2002:7f00:1::1','2620:4f:8000::1','3ffe::1','3fff:fff::1','fc00::1','fdff::1','fe80::1','fe80::1%eth0','fec0::1','ff02::1'])assert.equal(publicAddress(ip),false,ip);
for(const ip of ['93.184.215.14','8.8.8.8','172.15.0.1','172.32.0.1','100.128.0.1','2606:4700:4700::1111','2001:4860:4860::8888'])assert.equal(publicAddress(ip),true,ip);
for(const url of ['file:///etc/passwd','ftp://public.example/x','data:image/png;base64,a','http://localhost/a','http://localhost./a','http://router.local/a','http://printer/a','http://127.1/x','http://0x7f000001/x','http://2130706433/x','http://0177.0.0.1/x','http://[::ffff:127.0.0.1]/x','http://user:password@public.example/a','https://public.example/a\n'])assert.throws(()=>imageUrl(url),{status:400},url);
assert.equal(imageUrl('https://public.example/a#fragment').href,'https://public.example/a');
let calls=0;
await fails(()=>createRemoteImageImporter({resolve:async()=>[{address:'93.184.215.14',family:4},{address:'127.0.0.1',family:4}],open:async()=>{calls++;return response()}})('https://public.example/p.png'),400);
assert.equal(calls,0,'One private answer rejects the entire DNS result before connecting');
await fails(()=>createRemoteImageImporter({resolve:async()=>[],open:async()=>response()})('https://public.example/p.png'),400);
let resolutions=0;
const pinned=createRemoteImageImporter({resolve:async()=>{resolutions++;return [{address:resolutions===1?'93.184.215.14':'127.0.0.1',family:4}]},open:async(url,address,signal)=>{
 const options=pinnedRequestOptions(url,address,signal);
 assert.equal(options.hostname,'93.184.215.14','Connection uses vetted literal IP, never a second hostname lookup');
 assert.equal(options.headers.Host,'public.example');assert.equal(options.servername,'public.example');assert.equal(options.agent,false);
 assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.Authorization,undefined);assert.equal(options.auth,undefined);
 return response();
}});
assert.deepEqual((await pinned('https://public.example/image.png')).bytes,png);assert.equal(resolutions,1);
let hop=0;const responses=[];
await fails(()=>createRemoteImageImporter({resolve:async()=>[{address:++hop===1?'93.184.215.14':'10.0.0.1',family:4}],open:async()=>{const item=response({status:302,headers:{location:'/next'}});responses.push(item);return item}})('https://public.example/start'),400);
assert.equal(hop,2,'Same-host redirects resolve and validate again');assert.equal(responses.length,1);assert.ok(responses[0].closed,'Redirect body is closed');
for(const location of ['http://169.254.169.254/latest','file:///etc/passwd','https://user:password@public.example/x','http://[::ffff:a00:1]/']){
 let opened=0;await fails(()=>createRemoteImageImporter({resolve:publicDns,open:async()=>{opened++;return response({status:302,headers:{location}})}})('https://public.example/start'),400);assert.equal(opened,1);
}
let redirects=0;
await fails(()=>createRemoteImageImporter({resolve:publicDns,open:async()=>{redirects++;return response({status:302,headers:{location:'/again'}})}})('https://public.example/start'),502);
assert.equal(redirects,4,'No more than three redirects followed');
let count=0;assert.equal((await createRemoteImageImporter({resolve:publicDns,open:async()=>++count<=3?response({status:302,headers:{location:'/next'}}):response()})('https://public.example/start')).type,'image/png');
for(const headers of [{'content-type':'text/html'},{'content-type':'image/svg+xml'},{'content-type':'application/octet-stream'},{'content-type':'image/png','content-encoding':'gzip'}])await fails(()=>createRemoteImageImporter({resolve:publicDns,open:async()=>response({headers})})('https://public.example/x'),headers['content-encoding']?502:415);
await fails(()=>createRemoteImageImporter({resolve:publicDns,open:async()=>response({chunks:[Buffer.from('<html>Not an image</html>')]})})('https://public.example/x'),415);
for(const status of [401,403,404,500])await fails(()=>createRemoteImageImporter({resolve:publicDns,open:async()=>response({status})})('https://public.example/x'),502);
for(const headers of [{'content-type':'image/png','content-length':'1000'},{'content-type':'image/png'}]){
 const item=response({headers,chunks:[png,png]});await fails(()=>createRemoteImageImporter({resolve:publicDns,open:async()=>item,maxBytes:100})('https://public.example/x'),413);assert.ok(item.closed);
}
const hangs=()=>new Promise(()=>{});
await fails(()=>createRemoteImageImporter({resolve:hangs,timeoutMs:5})('https://public.example/x'),504);
let timedResponse=response();timedResponse.body={[Symbol.asyncIterator]:()=>({next:hangs})};
await fails(()=>createRemoteImageImporter({resolve:publicDns,open:async()=>timedResponse,timeoutMs:5})('https://public.example/x'),504);assert.ok(timedResponse.closed);
let release;const slow=createRemoteImageImporter({resolve:publicDns,open:()=>new Promise(resolve=>release=resolve),concurrency:1});
const first=slow('https://public.example/x');await new Promise(resolve=>setImmediate(resolve));
await fails(()=>slow('https://public.example/x'),429);release(response());await first;
const again=slow('https://public.example/x');await new Promise(resolve=>setImmediate(resolve));release(response());await again;
console.log('PASS: image-import URL/IP filtering, all-answer DNS validation, socket pinning, redirect revalidation, MIME/signature checks, byte limits, timeout, cleanup, and concurrency.');
