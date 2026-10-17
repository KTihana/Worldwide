import {db,bucket} from '../../server/storage.ts';
import countries from '../data/countries.json' with {type:'json'};
export const countryIds=new Set(countries.map(c=>c.id));
import {requireAccount} from '../../server/auth.ts';
export {ApiError,errorResponse} from '../../server/errors.ts';
export function context(request:Request){return {userId:requireAccount(request),db,bucket}}
export const privateHeaders={'Cache-Control':'private, no-store'};
