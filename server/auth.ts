import {randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {db} from './storage.ts';
import {ApiError} from './errors.ts';
const lifetime=30*24*60*60;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const cookieName='elsewhere_session';
type Account={id:string;email:string;password_hash:string;recovery_hash:string};
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
 return db.prepare('SELECT a.id,a.email FROM sessions s JOIN accounts a ON a.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(digest(token),Date.now()).first<{id:string;email:string}>();
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
function signIn(request:Request,id:string,extra:Record<string,unknown>={}){
 const token=randomBytes(32).toString('hex');
 db.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()).run();
 db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(digest(token),id,Date.now()+lifetime*1000).run();
 const account=db.prepare('SELECT email FROM accounts WHERE id=?').bind(id).first<{email:string}>()!;
 return Response.json({account:{email:account.email},...extra},{headers:{'Set-Cookie':sessionCookie(request,token),'Cache-Control':'no-store'}});
}
export async function authRoute(request:Request,action:string,localConnection:boolean,clientAddress:string){
 sameOrigin(request);
 const exists=!!db.prepare('SELECT id FROM accounts LIMIT 1').first();
 if(action==='session'&&request.method==='GET')return Response.json({account:currentAccount(request),needsSetup:!exists,canSetup:localConnection,serverUrl:process.env.ELSEWHERE_PUBLIC_ORIGIN||null},{headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')throw new ApiError('Not found.',404);
 if(action==='logout'){
  db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(digest(cookie(request))).run();
  return Response.json({ok:true},{headers:{'Set-Cookie':sessionCookie(request,'',0),'Cache-Control':'no-store'}});
 }
 if(!['setup','login','recover'].includes(action))throw new ApiError('Not found.',404);
 rateLimit('ip:'+clientAddress,30);
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new ApiError('Invalid request.');
 const body=await request.json() as Record<string,unknown>,address=email(body.email),secret=password(body.password);
 rateLimit('email:'+digest(address),10);
 if(action==='setup'){
  if(!localConnection)throw new ApiError('Create your account on the computer running Worldwide.',403);
  if(exists)throw new ApiError('An account already exists. Please sign in.',409);
  const encoded=await hashPassword(secret),recoveryCode=randomBytes(24).toString('hex');
  // The existing album already belongs to "local". Attaching this account
  // preserves every photo key, cover, note, and visited country in place.
  if(db.prepare('SELECT id FROM accounts LIMIT 1').first())throw new ApiError('An account already exists. Please sign in.',409);
  db.prepare('INSERT INTO accounts(id,email,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?)').bind('local',address,encoded,digest(recoveryCode),new Date().toISOString()).run();
  return signIn(request,'local',{recoveryCode});
 }
 const account=db.prepare('SELECT * FROM accounts WHERE email=?').bind(address).first<Account>();
 if(action==='recover'){
  if(typeof body.recoveryCode!=='string'||!account||!timingSafeEqual(Buffer.from(digest(body.recoveryCode.trim())),Buffer.from(account.recovery_hash)))throw new ApiError('The email or recovery code is incorrect.',401);
  const encoded=await hashPassword(secret),recoveryCode=randomBytes(24).toString('hex');
  if(db.prepare('SELECT recovery_hash FROM accounts WHERE id=?').bind(account.id).first<{recovery_hash:string}>()?.recovery_hash!==account.recovery_hash)throw new ApiError('This recovery code has already been used.',401);
  db.batch([db.prepare('UPDATE accounts SET password_hash=?,recovery_hash=? WHERE id=?').bind(encoded,digest(recoveryCode),account.id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(account.id)]);
  return signIn(request,account.id,{recoveryCode});
 }
 const valid=await verifyPassword(secret,account?.password_hash||'00000000000000000000000000000000:'+ '0'.repeat(128));
 if(!account||!valid)throw new ApiError('The email or password is incorrect.',401);
 return signIn(request,account.id);
}
