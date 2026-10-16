import {context,errorResponse,privateHeaders} from '../shared';
export async function GET(request:Request){try{
 const {userId,db}=context(request);
 const [v,p]=await db.batch([db.prepare('SELECT country_id as countryId,visited,cover_id as coverId,note,visit_date as visitDate,updated_at as updatedAt FROM visits WHERE user_id=?').bind(userId),db.prepare('SELECT id,country_id as countryId,caption,created_at as createdAt FROM photos WHERE user_id=? ORDER BY created_at DESC').bind(userId)]);
 return Response.json({visits:v.results,photos:p.results},{headers:privateHeaders});
}catch(e){return errorResponse(e)}}
