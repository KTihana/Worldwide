import {context,errorResponse,privateHeaders} from '../shared.ts';
export async function GET(request:Request){try{
 const {userId,db}=context(request);
 const [v,p]=await db.batch([db.prepare('SELECT country_id as countryId,visited,cover_id as coverId,note,visit_date as visitDate,updated_at as updatedAt FROM visits WHERE user_id=?').bind(userId),db.prepare('SELECT id,country_id as countryId,caption,created_at as createdAt,width,height,crop_x as cropX,crop_y as cropY,crop_zoom as cropZoom FROM photos WHERE user_id=? ORDER BY sort_order ASC,created_at DESC,id ASC').bind(userId)]);
 const preference=db.prepare('SELECT map_style FROM accounts WHERE id=?').bind(userId).first<{map_style:string}>();
 return Response.json({visits:v.results,photos:p.results,mapStyle:preference?.map_style||'natural-earth'},{headers:privateHeaders});
}catch(e){return errorResponse(e)}}
