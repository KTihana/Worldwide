import {useEffect,useRef,useState} from 'react';
import {LoaderCircle,RotateCcw,X} from 'lucide-react';
import {defaultFrame,photoPlacement,type PhotoFrame} from './photo-layout';
export type FramedPhoto={id:string;width?:number;height?:number;cropX?:number;cropY?:number;cropZoom?:number};
const aspects=new Map<string,number>();
export function usePhotoAspect(photo:FramedPhoto){
 const metadata=photo.width&&photo.height?photo.width/photo.height:0;
 const [aspect,setAspect]=useState(()=>metadata||aspects.get(photo.id)||1);
 useEffect(()=>{if(metadata){setAspect(metadata);return}const cached=aspects.get(photo.id);if(cached){setAspect(cached);return}let active=true;const image=new Image();image.onload=()=>{const ratio=image.naturalWidth/image.naturalHeight;aspects.set(photo.id,ratio);if(active)setAspect(ratio)};image.src=`/api/photos/${photo.id}`;return()=>{active=false}},[photo.id,metadata]);
 return metadata||aspect;
}
export function PhotoPattern({id,photo,bounds}:{id:string;photo:FramedPhoto;bounds:number[]}){
 const aspect=usePhotoAspect(photo),[x,y,x2,y2]=bounds,w=Math.max(x2-x,.01),h=Math.max(y2-y,.01),p=photoPlacement([0,0,w,h],aspect,photo);
 return <pattern id={id} patternUnits="userSpaceOnUse" x={x} y={y} width={w} height={h} viewBox={`0 0 ${w} ${h}`}><image href={`/api/photos/${photo.id}`} x={p.x} y={p.y} width={p.width} height={p.height} preserveAspectRatio="none"/></pattern>
}
export function PhotoEditor({photo,shape,name,onCancel,onSave}:{photo:FramedPhoto;shape:{path:string;bounds:number[]};name:string;onCancel:()=>void;onSave:(frame:PhotoFrame)=>Promise<void>}){
 const [frame,setFrame]=useState<PhotoFrame>({cropX:photo.cropX??0,cropY:photo.cropY??0,cropZoom:photo.cropZoom??1});
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const aspect=usePhotoAspect(photo),drag=useRef<{x:number;y:number;frame:PhotoFrame}|null>(null),svg=useRef<SVGSVGElement>(null);
 const [x,y,x2,y2]=shape.bounds,w=x2-x,h=y2-y;
 function point(clientX:number,clientY:number){const element=svg.current,matrix=element?.getScreenCTM();if(!element||!matrix)return null;const p=element.createSVGPoint();p.x=clientX;p.y=clientY;return p.matrixTransform(matrix.inverse())}
 return <><div className="modal-heading"><h2>Adjust photo</h2><button className="icon-button" disabled={saving} aria-label="Cancel photo adjustment" onClick={onCancel}><X size={21}/></button></div><div className="photo-editor-preview"><svg ref={svg} viewBox={`${x-w*.06} ${y-h*.06} ${w*1.12} ${h*1.12}`} role="img" aria-label={`${name} photo position. Drag or use arrow keys to move the photo.`} tabIndex={0}
 onPointerDown={e=>{if(saving)return;const p=point(e.clientX,e.clientY);if(!p)return;drag.current={x:p.x,y:p.y,frame};e.currentTarget.setPointerCapture(e.pointerId)}}
 onPointerMove={e=>{const start=drag.current;if(!start)return;const p=point(e.clientX,e.clientY);if(!p)return;const placement=photoPlacement(shape.bounds,aspect,start.frame);setFrame({...start.frame,cropX:placement.overflowX>.01?Math.max(-1,Math.min(1,start.frame.cropX+(p.x-start.x)/placement.overflowX)):0,cropY:placement.overflowY>.01?Math.max(-1,Math.min(1,start.frame.cropY+(p.y-start.y)/placement.overflowY)):0})}}
 onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}} onPointerCancel={()=>{drag.current=null}}
 onKeyDown={e=>{if(saving||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();setFrame(f=>({...f,cropX:Math.max(-1,Math.min(1,f.cropX+(e.key==='ArrowRight'?.05:e.key==='ArrowLeft'?-.05:0))),cropY:Math.max(-1,Math.min(1,f.cropY+(e.key==='ArrowDown'?.05:e.key==='ArrowUp'?-.05:0)))}))}}>
 <defs><PhotoPattern id="editor-photo" photo={{...photo,...frame}} bounds={shape.bounds}/></defs><path d={shape.path} fill="url(#editor-photo)" stroke="#52735a" strokeWidth={1} vectorEffect="non-scaling-stroke"/></svg></div>
 <p className="editor-hint">Drag to move the photo inside {name}.</p><label className="photo-zoom"><span>Zoom</span><input aria-label="Photo zoom" type="range" min="1" max="5" step="0.01" disabled={saving} value={frame.cropZoom} onChange={e=>setFrame(f=>({...f,cropZoom:Number(e.target.value)}))}/><span>{frame.cropZoom.toFixed(1)}×</span></label>
 {error&&<p className="editor-error" role="alert">{error}</p>}<div className="editor-actions"><button className="text-button reset-photo" disabled={saving} onClick={()=>setFrame(defaultFrame)}><RotateCcw size={14}/> Reset</button><button className="button" disabled={saving} onClick={onCancel}>Cancel</button><button className="button primary" disabled={saving} onClick={async()=>{setSaving(true);setError('');try{await onSave(frame)}catch(e){setError((e as Error).message);setSaving(false)}}}>{saving?<LoaderCircle size={15} className="spinning"/>:null} Save position</button></div></>
}
