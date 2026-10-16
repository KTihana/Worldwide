import {context,errorResponse,ApiError,countryIds} from '../../shared';
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{
 const {id}=await params;const {userId,db}=context(request);
 if(!countryIds.has(id))throw new ApiError('Country not found.',404);
 const body=await request.json() as Record<string,unknown>;
 if(body.visited!==undefined&&typeof body.visited!=='boolean')throw new ApiError('Invalid visit status.');
 if(body.note!==undefined&&(typeof body.note!=='string'||body.note.length>4000))throw new ApiError('Keep your travel note under 4,000 characters.');
 if(body.visitDate!==undefined&&body.visitDate!==null&&(typeof body.visitDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.visitDate)||Number.isNaN(Date.parse(body.visitDate))))throw new ApiError('Please choose a valid date.');
 if(body.coverId!==undefined&&body.coverId!==null){
  const p=await db.prepare('SELECT id FROM photos WHERE id=? AND user_id=? AND country_id=?').bind(body.coverId,userId,id).first();
  if(!p)throw new ApiError('Choose a photo from this country.');
 }
 const now=new Date().toISOString();
 await db.prepare('INSERT OR IGNORE INTO visits(user_id,country_id,visited,updated_at) VALUES(?,?,0,?)').bind(userId,id,now).run();
 const columns:Record<string,string>={visited:'visited',note:'note',visitDate:'visit_date',coverId:'cover_id'};
 const fields=Object.keys(columns).filter(k=>Object.hasOwn(body,k));
 if(fields.length){await db.prepare(`UPDATE visits SET ${fields.map(k=>columns[k]+'=?').join(',')},updated_at=? WHERE user_id=? AND country_id=?`).bind(...fields.map(k=>k==='visited'?Number(body[k]):body[k]),now,userId,id).run();}
 return Response.json({ok:true});
}catch(e){return errorResponse(e)}}
