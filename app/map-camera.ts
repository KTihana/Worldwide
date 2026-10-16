export type MapBox={x:number;y:number;width:number;height:number};
export type Camera={k:number;x:number;y:number};
export function fitShape(bounds:number[],box:MapBox,screen:{width:number;height:number},country=false):Camera{
 const mobile=screen.width<=600;
 const left=24,right=country&&!mobile?screen.width-(screen.width<=800?380:412):screen.width-24;
 const top=mobile?134:screen.width<=1000?136:100,bottom=country&&mobile?screen.height*.48-16:screen.height-42;
 const width=Math.max(48,right-left)/screen.width*box.width;
 const height=Math.max(48,bottom-top)/screen.height*box.height;
 const [x1,y1,x2,y2]=bounds;
 const k=Math.min(14,Math.max(.15,Math.min(width/Math.max(1,x2-x1),height/Math.max(1,y2-y1))*.9));
 const cx=box.x+(left+right)/2/screen.width*box.width;
 const cy=box.y+(top+bottom)/2/screen.height*box.height;
 return {k,x:cx-(x1+x2)/2*k,y:cy-(y1+y2)/2*k};
}
