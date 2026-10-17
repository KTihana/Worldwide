export class ApiError extends Error{status:number;constructor(message:string,status=400){super(message);this.status=status}}
export function errorResponse(error:unknown){
 if(error instanceof ApiError)return Response.json({error:error.message},{status:error.status});
 if(error instanceof SyntaxError)return Response.json({error:'Invalid request.'},{status:400});
 console.error('Album request failed',error);
 return Response.json({error:'We couldn’t save that change. Please try again.'},{status:500});
}
