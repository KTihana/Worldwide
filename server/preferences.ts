import {requireAccount} from './auth.ts';
import {db} from './storage.ts';
import {ApiError} from './errors.ts';
import styles from '../app/data/map-styles.json' with {type:'json'};
export async function savePreferences(request:Request){
 const id=requireAccount(request),body=await request.json() as {mapStyle?:unknown};
 if(typeof body.mapStyle!=='string'||!styles.some(style=>style.id===body.mapStyle))throw new ApiError('Choose a valid map style.');
 db.prepare('UPDATE accounts SET map_style=? WHERE id=?').bind(body.mapStyle,id).run();
 return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
}
