import {networkInterfaces} from 'node:os';
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,chmod,access} from 'node:fs/promises';
import {resolve} from 'node:path';
const data=resolve(process.env.ELSEWHERE_DATA_DIR||resolve(import.meta.dirname,'../data'));
const folder=resolve(data,'tls');
const addresses=[...new Set(Object.values(networkInterfaces()).flat().filter(value=>value&&value.family==='IPv4'&&!value.internal).map(value=>value.address))].sort();
if(!addresses.length)throw new Error('Connect this computer to Wi-Fi before preparing the phone certificate.');
await mkdir(folder,{recursive:true,mode:0o700});
process.umask(0o077);
const files={caKey:resolve(folder,'ca.key'),caCert:resolve(folder,'ca.crt'),caPhone:resolve(folder,'Worldwide-phone.cer'),key:resolve(folder,'server.key'),cert:resolve(folder,'server.crt'),csr:resolve(folder,'server.csr'),extensions:resolve(folder,'server.ext'),addresses:resolve(folder,'addresses.txt')};
function openssl(...args){const result=spawnSync('openssl',args,{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr||'OpenSSL failed.')}
async function exists(path){try{await access(path);return true}catch{return false}}
if(!await exists(files.caKey)||!await exists(files.caCert)){
 openssl('req','-x509','-newkey','rsa:3072','-nodes','-keyout',files.caKey,'-out',files.caCert,'-days','3650','-subj','/CN=Worldwide Local CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign');
 await chmod(files.caKey,0o600);
}
openssl('x509','-in',files.caCert,'-outform','DER','-out',files.caPhone);
const addressList=addresses.join('\n');
const valid=await exists(files.cert)&&spawnSync('openssl',['x509','-checkend',String(30*24*60*60),'-noout','-in',files.cert],{stdio:'ignore'}).status===0;
if(!valid||!await exists(files.key)||(await readFile(files.addresses,'utf8').catch(()=>''))!==addressList){
 const names=['DNS:localhost','IP:127.0.0.1',...addresses.map(address=>`IP:${address}`)];
 await writeFile(files.extensions,`basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${names.join(',')}\n`,{mode:0o600});
 openssl('req','-new','-newkey','rsa:3072','-nodes','-keyout',files.key,'-out',files.csr,'-subj','/CN=Worldwide');
 openssl('x509','-req','-in',files.csr,'-CA',files.caCert,'-CAkey',files.caKey,'-CAcreateserial','-out',files.cert,'-days','365','-extfile',files.extensions);
 await chmod(files.key,0o600);
 await writeFile(files.addresses,addressList,{mode:0o600});
}
console.log(`Phone HTTPS certificate ready for ${addresses.join(', ')}.\nTransfer only ${files.caPhone} to your phone, then enable certificate trust on the phone.`);
