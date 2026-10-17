import {context,errorResponse,ApiError,countryIds} from '../shared.ts';
export async function POST(request:Request){try{
 const {userId,db,bucket}=context(request);
 if(Number(request.headers.get('content-length'))>10*1024*1024)throw new ApiError('Please choose a photo smaller than 8 MB.');
 const form=await request.formData();const countryId=String(form.get('countryId')||'');const file=form.get('photo');
 if(!countryIds.has(countryId))throw new ApiError('Please choose a country.');
 if(!(file instanceof File)||!file.size||file.size>8*1024*1024)throw new ApiError('Please choose a photo smaller than 8 MB.');
 if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(file.type))throw new ApiError('Use a JPG, PNG, WebP, GIF or AVIF photo.');
 const bytes=await file.arrayBuffer();const b=new Uint8Array(bytes);
 const valid=(file.type==='image/jpeg'&&b[0]===255&&b[1]===216)||(file.type==='image/png'&&b[0]===137&&b[1]===80)||(file.type==='image/webp'&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')||(file.type==='image/gif'&&String.fromCharCode(...b.slice(0,3))==='GIF')||(file.type==='image/avif'&&String.fromCharCode(...b.slice(4,8))==='ftyp'&&/avif|avis/.test(String.fromCharCode(...b.slice(8,32))));
 if(!valid)throw new ApiError('This file could not be read as a photo.');
 const id=crypto.randomUUID(),key=`photos/${userId}/${id}`,now=new Date().toISOString();
 const caption=String(form.get('caption')||'').slice(0,500);
 const width=Number(form.get('width')||0),height=Number(form.get('height')||0);
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<0||height<0||width>16384||height>16384||!!width!==!!height)throw new ApiError('Invalid photo dimensions.');
 await bucket.put(key,bytes,{httpMetadata:{contentType:file.type}});
 try{await db.batch([
 db.prepare('INSERT INTO photos(id,user_id,country_id,object_key,caption,content_type,created_at,width,height) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,userId,countryId,key,caption,file.type,now,width,height),
 db.prepare('INSERT INTO visits(user_id,country_id,visited,cover_id,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(user_id,country_id) DO UPDATE SET visited=1,cover_id=COALESCE(visits.cover_id,excluded.cover_id),updated_at=excluded.updated_at').bind(userId,countryId,id,now)
 ]);}catch(e){await bucket.delete(key);throw e}
 return Response.json({id,countryId,caption,createdAt:now,width,height,cropX:0,cropY:0,cropZoom:1},{status:201});
}catch(e){return errorResponse(e)}}
