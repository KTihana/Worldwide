import {requireAccount} from './auth.ts';
import {ApiError,errorResponse} from './errors.ts';
import {createRemoteImageImporter} from './remote-image.ts';
const download=createRemoteImageImporter();
export async function importPhoto(request:Request){
 try{
 requireAccount(request);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new ApiError('Send an image link.',400);
 let body:unknown;try{body=await request.json()}catch{throw new ApiError('Send a valid image link.',400)}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiError('Send an image link.',400);
 const image=await download((body as {url?:unknown}).url);
 return new Response(Uint8Array.from(image.bytes),{headers:{'Content-Type':image.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){const response=errorResponse(error);response.headers.set('Cache-Control','no-store');return response}
}
