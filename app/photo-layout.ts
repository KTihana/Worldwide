export type PhotoFrame={cropX:number;cropY:number;cropZoom:number};
export const defaultFrame:PhotoFrame={cropX:0,cropY:0,cropZoom:1};
export function photoPlacement(bounds:number[],aspect:number,frame:Partial<PhotoFrame>={}){
 const [x,y,x2,y2]=bounds,w=Math.max(x2-x,0.01),h=Math.max(y2-y,0.01);
 const zoom=Math.max(1,Math.min(5,frame.cropZoom??1)),ratio=Number.isFinite(aspect)&&aspect>0?aspect:1;
 const width=Math.max(w,h*ratio)*zoom,height=width/ratio;
 const ox=Math.max(-1,Math.min(1,frame.cropX??0)),oy=Math.max(-1,Math.min(1,frame.cropY??0));
 return {x:x+(w-width)/2+ox*(width-w)/2,y:y+(h-height)/2+oy*(height-h)/2,width,height,overflowX:(width-w)/2,overflowY:(height-h)/2};
}
