import { env } from 'cloudflare:workers';
import countries from '../data/countries.json';
export const countryIds=new Set(countries.map(c=>c.id));
export function context(request:Request){
 const userId=request.headers.get('oai-authenticated-user-id');
 if(!userId) throw new ApiError('Please sign in to save your travel memories.',401);
 if(!env.DB||!env.BUCKET) throw new ApiError('Your album storage is not ready. Please try again shortly.',503);
 if(!['GET','HEAD'].includes(request.method)){
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin) throw new ApiError('This request is not allowed.',403);
 }
 return {userId,db:env.DB,bucket:env.BUCKET};
}
export class ApiError extends Error{constructor(message:string,public status=400){super(message)}}
export function errorResponse(error:unknown){
 if(error instanceof ApiError)return Response.json({error:error.message},{status:error.status});
 console.error('Album request failed',error);
 return Response.json({error:'We couldn’t save that change. Please try again.'},{status:500});
}
export const privateHeaders={'Cache-Control':'private, no-store'};
