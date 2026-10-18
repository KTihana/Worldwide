import {context,errorResponse,ApiError,countryIds} from '../shared.ts';

type SavedPhoto={id:string;user_id:string;country_id:string;object_key:string;caption:string;content_type:string;created_at:string;width:number;height:number;crop_x:number;crop_y:number;crop_zoom:number};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uploads=new Map<string,Promise<void>>();

// Serialize a photo ID within this server process. Each write also gets a
// unique object key, so competing processes cannot replace one another's file.
async function withPhotoLock<T>(id:string,work:()=>Promise<T>):Promise<T>{
 const previous=uploads.get(id);let release!:()=>void;
 const current=new Promise<void>(resolve=>{release=resolve});uploads.set(id,current);
 if(previous)await previous;
 try{return await work()}finally{release();if(uploads.get(id)===current)uploads.delete(id)}
}

function metadata(photo:SavedPhoto){return {id:photo.id,countryId:photo.country_id,caption:photo.caption,createdAt:photo.created_at,width:photo.width,height:photo.height,cropX:photo.crop_x,cropY:photo.crop_y,cropZoom:photo.crop_zoom}}
function sameBytes(a:Uint8Array,b:Uint8Array){if(a.byteLength!==b.byteLength)return false;for(let i=0;i<a.byteLength;i++)if(a[i]!==b[i])return false;return true}

export async function POST(request:Request){try{
 const {userId,db,bucket}=context(request);
 if(Number(request.headers.get('content-length'))>10*1024*1024)throw new ApiError('Please choose a photo smaller than 8 MB.');
 const form=await request.formData();const countryId=String(form.get('countryId')||'');const file=form.get('photo');
 if(!countryIds.has(countryId))throw new ApiError('Please choose a country.');
 if(!(file instanceof File)||!file.size||file.size>8*1024*1024)throw new ApiError('Please choose a photo smaller than 8 MB.');
 if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(file.type))throw new ApiError('Use a JPG, PNG, WebP, GIF or AVIF photo.');
 const contentType=file.type;
 const bytes=await file.arrayBuffer();const b=new Uint8Array(bytes);
 const valid=(file.type==='image/jpeg'&&b[0]===255&&b[1]===216)||(file.type==='image/png'&&b[0]===137&&b[1]===80)||(file.type==='image/webp'&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')||(file.type==='image/gif'&&String.fromCharCode(...b.slice(0,3))==='GIF')||(file.type==='image/avif'&&String.fromCharCode(...b.slice(4,8))==='ftyp'&&/avif|avis/.test(String.fromCharCode(...b.slice(8,32))));
 if(!valid)throw new ApiError('This file could not be read as a photo.');
 const captionField=form.get('caption');if(captionField!==null&&typeof captionField!=='string')throw new ApiError('Invalid photo caption.');
 const caption=(captionField||'').slice(0,500);
 const width=Number(form.get('width')||0),height=Number(form.get('height')||0);
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<0||height<0||width>16384||height>16384||!!width!==!!height)throw new ApiError('Invalid photo dimensions.');
 const suppliedIds=form.getAll('photoId');
 if(suppliedIds.length>1||suppliedIds.length===1&&(typeof suppliedIds[0]!=='string'||!uuid.test(suppliedIds[0])))throw new ApiError('Invalid photo ID.');
 const id=suppliedIds.length?suppliedIds[0] as string:crypto.randomUUID();
 return await withPhotoLock(id,async()=>{
  const find=()=>db.prepare('SELECT id,user_id,country_id,object_key,caption,content_type,created_at,width,height,crop_x,crop_y,crop_zoom FROM photos WHERE id=?').bind(id).first<SavedPhoto>();
  async function retry(existing:SavedPhoto):Promise<Response>{
   if(existing.user_id!==userId||existing.country_id!==countryId||existing.content_type!==contentType)throw new ApiError('This photo ID is already in use.',409);
   const stored=await bucket.get(existing.object_key);
   if(!stored||!sameBytes(stored.body,b))throw new ApiError('This photo ID is already in use.',409);
   return Response.json(metadata(existing),{status:200});
  }
  const existing=find();if(existing)return retry(existing);
  // This key belongs only to this attempt. A losing concurrent insert may
  // safely delete it without touching the winning photo's bytes.
  const key=`photos/${userId}/${id}-${crypto.randomUUID()}`,now=new Date().toISOString();
  await bucket.put(key,bytes,{httpMetadata:{contentType}});
  try{await db.batch([
   db.prepare('INSERT INTO photos(id,user_id,country_id,object_key,caption,content_type,created_at,width,height) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,userId,countryId,key,caption,contentType,now,width,height),
   db.prepare('INSERT INTO visits(user_id,country_id,visited,cover_id,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(user_id,country_id) DO UPDATE SET visited=1,cover_id=COALESCE(visits.cover_id,excluded.cover_id),updated_at=excluded.updated_at').bind(userId,countryId,id,now)
  ]);}catch(error){await bucket.delete(key);const collision=find();if(collision)return retry(collision);throw error}
  return Response.json({id,countryId,caption,createdAt:now,width,height,cropX:0,cropY:0,cropZoom:1},{status:201});
 });
}catch(e){return errorResponse(e)}}
