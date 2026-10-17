import {context,errorResponse,ApiError} from '../app/api/shared.ts';
export async function reorderPhotos(request:Request){try{
 const {userId,db}=context(request),body=await request.json() as {countryId?:unknown;ids?:unknown};
 if(typeof body.countryId!=='string'||!Array.isArray(body.ids)||!body.ids.every(id=>typeof id==='string')||new Set(body.ids).size!==body.ids.length)throw new ApiError('Invalid photo order.');
 const current=db.prepare('SELECT id FROM photos WHERE user_id=? AND country_id=?').bind(userId,body.countryId).all().results;
 const ids=body.ids as string[];
 if(current.length!==ids.length||current.some(row=>!ids.includes(String(row.id))))throw new ApiError('Photos changed on another device. Refresh and try again.',409);
 db.batch(ids.map((id,index)=>db.prepare('UPDATE photos SET sort_order=? WHERE id=? AND user_id=? AND country_id=?').bind(index+1,id,userId,body.countryId)));
 return Response.json({ok:true});
 }catch(error){return errorResponse(error)}
}
