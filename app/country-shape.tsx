import thumbnails from './data/country-thumbnails.json';
import {PhotoPattern,type FramedPhoto} from './photo-tools';

type Shape={path:string;bounds:number[];focusBounds?:number[]};
// Album cards load compact silhouettes only when opened. Keep their photo
// coordinate system identical to the full country editor, including its crop.
export default function CountryShape({country,cover,photo,className=''}:{country:{id:string};cover?:string|null;photo?:FramedPhoto;className?:string}){
 const shape=(thumbnails as Record<string,Shape>)[country.id];
 const [x1,y1,x2,y2]=shape.focusBounds??shape.bounds,w=Math.max(x2-x1,2),h=Math.max(y2-y1,2);
 const id=`shape-${country.id}-${className.replace(/[^a-z]/g,'')}`;
 return <svg className={`country-shape ${className}`} viewBox={`${x1-w*.06} ${y1-h*.06} ${w*1.12} ${h*1.12}`} aria-hidden="true"><defs>{cover&&<PhotoPattern id={id} photo={photo||{id:cover}} bounds={shape.bounds}/>}</defs><path d={shape.path} fill={cover?`url(#${id})`:'currentColor'}/></svg>;
}
