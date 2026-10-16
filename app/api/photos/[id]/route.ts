import {context,errorResponse,ApiError} from '../../shared';
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){try{
 const {id}=await params;const {userId,db,bucket}=context(request);
 const photo=await db.prepare('SELECT object_key,content_type FROM photos WHERE id=? AND user_id=?').bind(id,userId).first<{object_key:string;content_type:string}>();
 if(!photo)throw new ApiError('Photo not found.',404);
 const object=await bucket.get(photo.object_key);if(!object)throw new ApiError('Photo not found.',404);
 return new Response(object.body,{headers:{'Content-Type':photo.content_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}catch(e){return errorResponse(e)}}
export async function PATCH(request:Request,{params}:Params){try{
 const {id}=await params;const {userId,db}=context(request);const {caption}=await request.json() as {caption:unknown};
 if(typeof caption!=='string'||caption.length>500)throw new ApiError('Keep captions under 500 characters.');
 const result=await db.prepare('UPDATE photos SET caption=? WHERE id=? AND user_id=?').bind(caption,id,userId).run();
 if(!result.meta.changes)throw new ApiError('Photo not found.',404);
 return Response.json({ok:true});
}catch(e){return errorResponse(e)}}
export async function DELETE(request:Request,{params}:Params){try{
 const {id}=await params;const {userId,db,bucket}=context(request);
 const photo=await db.prepare('SELECT country_id,object_key FROM photos WHERE id=? AND user_id=?').bind(id,userId).first<{country_id:string;object_key:string}>();
 if(!photo)throw new ApiError('Photo not found.',404);
 await db.batch([
 db.prepare('DELETE FROM photos WHERE id=? AND user_id=?').bind(id,userId),
 db.prepare('UPDATE visits SET cover_id=(SELECT id FROM photos WHERE country_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1),updated_at=? WHERE user_id=? AND country_id=? AND cover_id=?').bind(photo.country_id,userId,new Date().toISOString(),userId,photo.country_id,id)
 ]);
 await bucket.delete(photo.object_key);return Response.json({ok:true});
}catch(e){return errorResponse(e)}}
