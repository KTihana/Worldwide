import {randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {db} from './storage.ts';
import {ApiError} from './errors.ts';
import QRCode from 'qrcode';
const lifetime=30*24*60*60;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const cookieName='elsewhere_session';
type Account={id:string;email:string;username:string|null;password_hash:string;recovery_hash:string};
const pairingLifetime=3*60*1000;
const pairings=new Map<string,{accountId:string;expiresAt:number;used:boolean}>();
function forgetPairings(accountId:string){for(const [key,value] of pairings)if(value.accountId===accountId||value.expiresAt<=Date.now())pairings.delete(key)}
function cookie(request:Request){return request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1)||''}
function sessionCookie(request:Request,value:string,age=lifetime){return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`}
export function sameOrigin(request:Request){
 const origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin)throw new ApiError('This request is not allowed.',403);
 if(request.headers.get('sec-fetch-site')==='cross-site')throw new ApiError('This request is not allowed.',403);
 if(!['GET','HEAD'].includes(request.method)&&!origin)throw new ApiError('This request is not allowed.',403);
}
export function currentAccount(request:Request){
 const token=cookie(request);if(!/^[a-f0-9]{64}$/.test(token))return null;
 return db.prepare('SELECT a.id,a.email,a.username FROM sessions s JOIN accounts a ON a.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(digest(token),Date.now()).first<{id:string;email:string;username:string|null}>();
}
export function requireAccount(request:Request){sameOrigin(request);const account=currentAccount(request);if(!account)throw new ApiError('Please sign in to your album.',401);return account.id}
function rateLimit(key:string,limit:number){
 const now=Date.now();db.prepare('DELETE FROM auth_attempts WHERE reset_at<?').bind(now).run();
 db.prepare('INSERT INTO auth_attempts(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').bind(key,now+15*60*1000).run();
 const row=db.prepare('SELECT count FROM auth_attempts WHERE key=?').bind(key).first<{count:number}>();
 if(row&&row.count>limit)throw new ApiError('Too many attempts. Please try again in 15 minutes.',429);
}
let hashing=0;
async function derive(password:string,salt:string){
 if(hashing>=2)throw new ApiError('Please try again in a moment.',429);
 hashing++;
 try{return await new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024},(err,key)=>err?reject(err):resolve(key)))}finally{hashing--}
}
async function hashPassword(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+(await derive(password,salt)).toString('hex')}
async function verifyPassword(password:string,encoded:string){const [salt,expected]=encoded.split(':');const actual=await derive(password,salt);const target=Buffer.from(expected,'hex');return target.length===actual.length&&timingSafeEqual(actual,target)}
function password(value:unknown){if(typeof value!=='string'||value.length<12||value.length>256)throw new ApiError('Use a password between 12 and 256 characters.');return value}
function email(value:unknown){if(typeof value!=='string'||value.length>254||!/^\S+@\S+\.\S+$/.test(value))throw new ApiError('Enter a valid email address.');return value.trim().toLowerCase()}
function username(value:unknown){
 if(typeof value!=='string')throw new ApiError('Use a username with 3–24 letters, numbers, or underscores.');
 const name=value.trim().toLowerCase();
 if(!/^[a-z0-9_]{3,24}$/.test(name))throw new ApiError('Use a username with 3–24 letters, numbers, or underscores.');
 return name;
}
function signIn(request:Request,id:string,extra:Record<string,unknown>={}){
 const token=randomBytes(32).toString('hex');
 db.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()).run();
 db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(digest(token),id,Date.now()+lifetime*1000).run();
 const account=db.prepare('SELECT email,username FROM accounts WHERE id=?').bind(id).first<{email:string;username:string|null}>()!;
 return Response.json({account,...extra},{headers:{'Set-Cookie':sessionCookie(request,token),'Cache-Control':'no-store'}});
}
export async function authRoute(request:Request,action:string,localConnection:boolean,clientAddress:string,pairingOrigins:string[]=[]){
 sameOrigin(request);
 const exists=!!db.prepare('SELECT id FROM accounts LIMIT 1').first();
 if(action==='session'&&request.method==='GET')return Response.json({account:currentAccount(request),needsSetup:!exists,canSetup:localConnection,canReset:localConnection,serverUrl:process.env.ELSEWHERE_PUBLIC_ORIGIN||null},{headers:{'Cache-Control':'no-store'}});
 if(action==='pair-status'&&request.method==='GET'){
  const accountId=requireAccount(request);
  if(!localConnection)throw new ApiError('Show the QR code on your computer.',403);
  const id=new URL(request.url).searchParams.get('id')||'',pairing=pairings.get(id);
  const status=!pairing||pairing.accountId!==accountId||pairing.expiresAt<=Date.now()?'expired':pairing.used?'paired':'waiting';
  return Response.json({status},{headers:{'Cache-Control':'no-store'}});
 }
 if(request.method!=='POST')throw new ApiError('Not found.',404);
 if(action==='logout'){
  const account=currentAccount(request);if(account)forgetPairings(account.id);
  db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(digest(cookie(request))).run();
  return Response.json({ok:true},{headers:{'Set-Cookie':sessionCookie(request,'',0),'Cache-Control':'no-store'}});
 }
 if(!['setup','login','recover','reset-local','pair-start','pair-complete','username'].includes(action))throw new ApiError('Not found.',404);
 rateLimit('ip:'+clientAddress,30);
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new ApiError('Invalid request.');
 const body=await request.json() as Record<string,unknown>;
 if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiError('Invalid request.');
 if(action==='username'){
  const accountId=requireAccount(request),name=username(body.username);
  if(db.prepare('SELECT id FROM accounts WHERE username=? COLLATE NOCASE AND id<>?').bind(name,accountId).first())throw new ApiError('This username is already taken.',409);
  db.prepare('UPDATE accounts SET username=? WHERE id=?').bind(name,accountId).run();
  const account=db.prepare('SELECT email,username FROM accounts WHERE id=?').bind(accountId).first<{email:string;username:string|null}>()!;
  return Response.json({account},{headers:{'Cache-Control':'no-store'}});
 }
 if(action==='pair-start'){
  const accountId=requireAccount(request);
  if(!localConnection)throw new ApiError('Show the QR code on your computer.',403);
  if(typeof body.serverUrl!=='string'||!pairingOrigins.includes(body.serverUrl))throw new ApiError('Choose this computer’s Wi-Fi address.');
  if(body.client!==undefined&&body.client!=='native'&&body.client!=='web')throw new ApiError('Choose a supported pairing method.');
  const token=randomBytes(32).toString('hex'),expiresAt=Date.now()+pairingLifetime;
  const link=new URL(body.client==='web'?body.serverUrl:'worldwide://pair');
  if(body.client==='web')link.hash='worldwide-pair='+token;
  else{link.searchParams.set('server',body.serverUrl);link.searchParams.set('token',token);}
  const pairingUrl=link.href;
  const qr=await QRCode.toString(pairingUrl,{type:'svg',errorCorrectionLevel:'M',margin:4,width:240,color:{dark:'#273e34',light:'#ffffff'}});
  // Password resets and sign-out can happen while the QR renderer is working.
  if(currentAccount(request)?.id!==accountId)throw new ApiError('Please sign in again.',401);
  const pairingId=digest(token);
  forgetPairings(accountId);pairings.set(pairingId,{accountId,expiresAt,used:false});
  return Response.json({qr,pairingUrl,pairingId,expiresAt},{headers:{'Cache-Control':'no-store'}});
 }
 if(action==='pair-complete'){
  if(typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new ApiError('This QR code is invalid or expired. Show a new code on your computer.',401);
  const key=digest(body.token),pairing=pairings.get(key);
  if(!pairing||pairing.used||pairing.expiresAt<=Date.now()){if(pairing&&pairing.expiresAt<=Date.now())pairings.delete(key);throw new ApiError('This QR code is invalid or expired. Show a new code on your computer.',401)}
  pairing.used=true;
  return signIn(request,pairing.accountId);
 }
 if(action==='reset-local'){
  if(!localConnection)throw new ApiError('Reset your password in Worldwide on your computer.',403);
  rateLimit('local-reset:'+clientAddress,5);
  const account=db.prepare('SELECT id FROM accounts LIMIT 1').first<{id:string}>();
  if(!account)throw new ApiError('Create your account first.',409);
  const encoded=await hashPassword(password(body.password));
  db.batch([db.prepare('UPDATE accounts SET password_hash=?,recovery_hash=? WHERE id=?').bind(encoded,digest(randomBytes(32).toString('hex')),account.id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(account.id)]);
  forgetPairings(account.id);
  return signIn(request,account.id);
 }
 if(action==='login'){
  const supplied=body.identifier===undefined?body.email:body.identifier;
  const identifier=typeof supplied==='string'&&supplied.length<=254?supplied.trim().toLowerCase():'';
  const validIdentifier=/^[a-z0-9_]{3,24}$/.test(identifier)||/^\S+@\S+\.\S+$/.test(identifier);
  const validSecret=typeof body.password==='string'&&body.password.length>=12&&body.password.length<=256;
  const account=validIdentifier?db.prepare('SELECT * FROM accounts WHERE email=? COLLATE NOCASE OR username=? COLLATE NOCASE').bind(identifier,identifier).first<Account>():null;
  // Both account identifiers share the existing per-account attempt budget.
  rateLimit('email:'+digest(account?.email.toLowerCase()||identifier),10);
  const valid=await verifyPassword(validSecret?body.password as string:'',account?.password_hash||'00000000000000000000000000000000:'+ '0'.repeat(128));
  if(!account||!validSecret||!valid)throw new ApiError('The email, username, or password is incorrect.',401);
  return signIn(request,account.id);
 }
 if(action==='setup'){
  if(!localConnection)throw new ApiError('Create your account on the computer running Worldwide.',403);
  if(exists)throw new ApiError('An account already exists. Please sign in.',409);
 }
 const address=email(body.email),secret=password(body.password);
 rateLimit('email:'+digest(address),10);
 if(action==='setup'){
  const name=username(body.username);
  if(body.passwordConfirmation!==secret)throw new ApiError('The passwords do not match.');
  const encoded=await hashPassword(secret),recoveryCode=randomBytes(24).toString('hex');
  // The existing album already belongs to "local". Attaching this account
  // preserves every photo key, cover, note, and visited country in place.
  if(db.prepare('SELECT id FROM accounts LIMIT 1').first())throw new ApiError('An account already exists. Please sign in.',409);
  db.prepare('INSERT INTO accounts(id,email,username,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').bind('local',address,name,encoded,digest(recoveryCode),new Date().toISOString()).run();
  return signIn(request,'local');
 }
 const account=db.prepare('SELECT * FROM accounts WHERE email=? COLLATE NOCASE').bind(address).first<Account>();
 if(action==='recover'){
  if(typeof body.recoveryCode!=='string'||!account||!timingSafeEqual(Buffer.from(digest(body.recoveryCode.trim())),Buffer.from(account.recovery_hash)))throw new ApiError('The email or recovery code is incorrect.',401);
  const encoded=await hashPassword(secret),recoveryCode=randomBytes(24).toString('hex');
  if(db.prepare('SELECT recovery_hash FROM accounts WHERE id=?').bind(account.id).first<{recovery_hash:string}>()?.recovery_hash!==account.recovery_hash)throw new ApiError('This recovery code has already been used.',401);
  db.batch([db.prepare('UPDATE accounts SET password_hash=?,recovery_hash=? WHERE id=?').bind(encoded,digest(recoveryCode),account.id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(account.id)]);
  forgetPairings(account.id);
  return signIn(request,account.id,{recoveryCode});
 }
 throw new ApiError('Not found.',404);
}
