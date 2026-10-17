'use client';
import {useState,useEffect,useLayoutEffect,useRef,useCallback,useMemo, type ReactNode} from 'react';
import {Globe2,Images,Plus,Search,X,Check,ChevronLeft,ChevronRight,Minus,Maximize,Camera,LoaderCircle,Star,Trash2,CalendarDays,BookOpen,Download,ChevronDown,SlidersHorizontal,Map as MapIcon,UserRound,CloudCheck,CloudOff} from 'lucide-react';
import countries from './data/countries.json';
import mapStyles from './data/map-styles.json';
import naturalEarthShapes from './data/projections/natural-earth.json';
const projectionLoaders=import.meta.glob(['./data/projections/*.json','!./data/projections/natural-earth.json'],{import:'default'}) as Record<string,()=>Promise<Record<string,Shape>>>;
import {RegionPicker} from './region-picker';
import {PhotoGallery} from './photo-gallery';
import {prepareImage} from './prepare-image';
import {canTransferImages,transferredImages,imageSourceFile,type ImageSource} from './image-transfer';
import {fitShape} from './map-camera';
import {transitionMap} from './map-transitions';
import {VISITED_TINT,VISITED_OPACITY} from './map-palette';
import {PhotoPattern,PhotoEditor,type FramedPhoto} from './photo-tools';
import type {PhotoFrame} from './photo-layout';
import {exportMap} from './export-map';
import {TerrainPattern,terrainUrl} from './terrain';
import {syncOffline} from './offline';
import {isNativeApp,saveNativeFile} from './native';

type Country=(typeof countries)[number];
type Photo=FramedPhoto&{countryId:string;caption:string;createdAt:string};
type Visit={countryId:string;visited:number;coverId:string|null;note:string;visitDate:string|null;updatedAt:string};
type Data={visits:Visit[];photos:Photo[];mapStyle?:string};
type View='map'|'albums';
type Filter='all'|'visited'|'unvisited';
const continentNames=['Europe','Asia','Africa','North America','South America','Oceania','Antarctica'] as const;
type Region=(typeof continentNames)[number];
type Continent='World'|Region;
type Shape={path:string;outline?:string;focusBounds?:number[];bounds:number[]};
const details:Record<string,Shape>={};
const detailedRequests=new Map<string,Promise<void>>();
function prepareCountry(id:string){
 let request=detailedRequests.get(id);
 if(!request){request=fetch(`/geography/${id}.json`).then(async response=>{if(!response.ok)throw new Error('Couldn’t load this country. Please try again.');details[id]=await response.json() as Shape}).catch(error=>{detailedRequests.delete(id);throw error});detailedRequests.set(id,request)}
 return request;
}
const regions={} as Record<Region,{bounds:number[];shapes:Record<string,Shape>}>;
async function prepareRegion(name:Continent){if(name==='World'||name.startsWith('country:')||regions[name])return;const response=await fetch(`/geography/regions/${name.replaceAll(' ','-')}.json`);if(!response.ok)throw new Error('Couldn’t load this continent.');regions[name]=await response.json()}
const byId=Object.fromEntries(countries.map(c=>[c.id,c]));
const photoUrl=(id:string)=>`/api/photos/${id}`;
const flag=(code:string)=>/^[A-Z]{2}$/.test(code)?String.fromCodePoint(...code.split('').map(c=>127397+c.charCodeAt(0))):'🌍';
let pendingMutations=0,mutationVersion=0,lastAtlasOffline=false;
async function api<T=Data>(path:string,options:RequestInit={}):Promise<T>{
 const mutation=!!options.method&&!['GET','HEAD'].includes(options.method);
 if(mutation&&lastAtlasOffline)throw new Error('Reconnect to your computer to make changes.');
 if(mutation){pendingMutations++;mutationVersion++}
 try{
  const response=await fetch(path,{...options,cache:'no-store',headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...options.headers}});
  if(path==='/api/atlas')lastAtlasOffline=response.headers.get('X-Elsewhere-Offline')==='1';
  const data=await response.json() as T & {error?:string};
  if(response.status===401)window.dispatchEvent(new Event('album-session-expired'));
  if(!response.ok)throw new Error(data.error||'Something went wrong. Please try again.');return data;
 }finally{if(mutation){pendingMutations--;mutationVersion++}}
}
export function Modal({children,onClose,label,className=''}:{children:ReactNode;onClose:()=>void;label:string;className?:string}){
 const box=useRef<HTMLDivElement>(null);const closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{const previous=document.activeElement as HTMLElement;const old=document.body.style.overflow;document.body.style.overflow='hidden';
 const t=setTimeout(()=>box.current?.querySelector<HTMLElement>('[autofocus], input, button, a, textarea')?.focus(),30);
 const key=(e:KeyboardEvent)=>{const dialogs=document.querySelectorAll('[role="dialog"][aria-modal="true"]');if(dialogs[dialogs.length-1]!==box.current)return;if(e.key==='Escape'){e.stopPropagation();closeRef.current()}
 if(e.key==='Tab'){const els=Array.from(box.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,textarea,select,[tabindex="0"]')||[]).filter(el=>el.getClientRects().length>0);const first=els[0],last=els[els.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};
 document.addEventListener('keydown',key);return()=>{clearTimeout(t);document.body.style.overflow=old;document.removeEventListener('keydown',key);previous?.focus()};},[]);
 return <div className={`modal-backdrop ${className}`} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div ref={box} role="dialog" aria-modal="true" aria-label={label} className="modal-box">{children}</div></div>
}
function CountryShape({country,cover,photo,className=''}:{country:Country;cover?:string|null;photo?:Photo;className?:string}){
 const shape=details[country.id]||(naturalEarthShapes as Record<string,Shape>)[country.id];const [x1,y1,x2,y2]=shape.bounds;const w=Math.max(x2-x1,2),h=Math.max(y2-y1,2);const id=`shape-${country.id}-${className.replace(/[^a-z]/g,'')}`;
 return <svg className={`country-shape ${className}`} viewBox={`${x1-w*.06} ${y1-h*.06} ${w*1.12} ${h*1.12}`} aria-hidden="true"><defs>{cover&&<PhotoPattern id={id} photo={photo||{id:cover}} bounds={shape.bounds}/>}</defs><path d={shape.path} fill={cover?`url(#${id})`:'currentColor'}/></svg>
}
export default function Atlas({onAccount}:{onAccount:()=>void}){
 const [syncError,setSyncError]=useState(false);const refreshSequence=useRef(0);
 const [data,setData]=useState<Data>({visits:[],photos:[]});const [loading,setLoading]=useState(true);const [loadError,setLoadError]=useState('');
 const [continent,setContinent]=useState<Continent>('World');
 const [stylesOpen,setStylesOpen]=useState(false),[mapStyle,setMapStyle]=useState('natural-earth'),[styleLoading,setStyleLoading]=useState(false),[styleError,setStyleError]=useState('');
 const [worldShapes,setWorldShapes]=useState<Record<string,Shape>>(naturalEarthShapes);
 const styleRequest=useRef(0);
 async function chooseMapStyle(id:string){const request=++styleRequest.current;setStyleError('');setStyleLoading(true);try{const shapes=id==='natural-earth'?naturalEarthShapes:await projectionLoaders[`./data/projections/${id}.json`]();if(request!==styleRequest.current)return;await api('/api/preferences',{method:'PATCH',body:JSON.stringify({mapStyle:id})});if(request!==styleRequest.current)return;await transitionMap(()=>{if(request!==styleRequest.current)return;overviewCamera.current=null;setWorldShapes(shapes);setMapStyle(id);setData(current=>({...current,mapStyle:id}));setContinent('World');setSelected(null);setView('map');setFinder(false);setHover(null);setStylesOpen(false);try{localStorage.setItem('elsewhere-map-style',id)}catch{}},terrainUrl('World',id).replace('/terrain/','/basemaps/'))}catch{if(request===styleRequest.current)setStyleError('Couldn’t load this map. Please try again.')}finally{if(request===styleRequest.current)setStyleLoading(false)}}
 useEffect(()=>{const id=data.mapStyle;if(!id||id===mapStyle||!mapStyles.some(style=>style.id===id))return;const request=++styleRequest.current;let cancelled=false;const load=id==='natural-earth'?Promise.resolve(naturalEarthShapes):projectionLoaders[`./data/projections/${id}.json`]();void load.then(shapes=>{if(cancelled||request!==styleRequest.current)return;setWorldShapes(shapes);setMapStyle(id)}).catch(()=>setStyleError('Couldn’t load the saved map style.'));return()=>{cancelled=true}},[data.mapStyle]);
 const projectedCountries=useMemo(()=>countries.map(c=>({...c,...worldShapes[c.id]})),[worldShapes]);
 const [cropId,setCropId]=useState<string|null>(null);
 const [exportOpen,setExportOpen]=useState(false),[exportScope,setExportScope]=useState('World'),[exporting,setExporting]=useState(false),[exportProgress,setExportProgress]=useState(''),[exportError,setExportError]=useState('');
 const pendingVisits=useRef(new Set<string>());const [savingVisits,setSavingVisits]=useState(new Set<string>());
 const [view,setView]=useState<View>('map');const [filter,setFilter]=useState<Filter>('all');const [finder,setFinder]=useState(false);const [query,setQuery]=useState('');
 const [selected,setSelected]=useState<string|null>(null);const [lightbox,setLightbox]=useState<Photo|null>(null);const [deleteId,setDeleteId]=useState<string|null>(null);
 const uploadLock=useRef(false);
 const [busy,setBusy]=useState(false);const [uploading,setUploading]=useState('');const [notice,setNotice]=useState('');const [note,setNote]=useState('');const [date,setDate]=useState('');
 const [smoothCamera,setSmoothCamera]=useState(false);
 const cameraCommand=useRef(0);
 const overviewCamera=useRef<{k:number;x:number;y:number}|null>(null);
 const selectedRef=useRef(selected);selectedRef.current=selected;
 const touchPoints=useRef(new Map<number,{x:number;y:number}>());
 const pinch=useRef<{distance:number;k:number;x:number;y:number;anchorX:number;anchorY:number}|null>(null);
 const [zoom,setZoom]=useState({k:1,x:0,y:0});const cameraRef=useRef(zoom);cameraRef.current=zoom;const [hover,setHover]=useState<{id:string;x:number;y:number}|null>(null);
 const gestureFrame=useRef(0),pendingCamera=useRef<typeof zoom|null>(null);
 const queueCamera=(camera:typeof zoom)=>{pendingCamera.current=camera;if(!gestureFrame.current)gestureFrame.current=requestAnimationFrame(()=>{gestureFrame.current=0;if(pendingCamera.current)setZoom(pendingCamera.current);pendingCamera.current=null})};
 useEffect(()=>()=>cancelAnimationFrame(gestureFrame.current),[]);
 const svg=useRef<SVGSVGElement>(null);const fileInput=useRef<HTMLInputElement>(null);const dragged=useRef(false);const drag=useRef<{x:number;y:number;ox:number;oy:number;id:number}|null>(null);
 const visits=useMemo(()=>Object.fromEntries(data.visits.map(v=>[v.countryId,v])),[data.visits]);
 const visited=data.visits.filter(v=>v.visited);const visitedIds=new Set(visited.map(v=>v.countryId));const withPhotos=new Set(data.photos.map(p=>p.countryId));
 const regionCountries=useMemo(()=>continent==='World'?countries:Object.keys(regions[continent].shapes).map(id=>byId[id]),[continent]);
 const mapShapes=useMemo(()=>selected?[{...byId[selected],...details[selected]}]:continent==='World'?projectedCountries:regionCountries.map(c=>({...c,...regions[continent].shapes[c.id]})),[selected,continent,regionCountries,projectedCountries]);
 const focused=useRef(false);focused.current=!!selected||continent!=='World';
 const selectedCountry=selected?byId[selected]:null;const selectedVisit=selected?visits[selected]:null;const selectedPhotos=data.photos.filter(p=>p.countryId===selected);
 const refresh=useCallback(async(silent=false)=>{
  const request=++refreshSequence.current,version=mutationVersion;
  try{const d=await api('/api/atlas');if(request!==refreshSequence.current||version!==mutationVersion||pendingMutations)return;setData(current=>JSON.stringify(current)===JSON.stringify(d)?current:d);setLoadError('');setSyncError(lastAtlasOffline);if(!lastAtlasOffline)syncOffline(d)}catch(e){setSyncError(true);if(!silent)setLoadError((e as Error).message)}finally{setLoading(false)}
 },[]);
 useEffect(()=>{void refresh();const update=()=>{if(!document.hidden&&!pendingMutations)void refresh(true)};const timer=setInterval(update,5000);window.addEventListener('focus',update);window.addEventListener('online',update);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update);window.removeEventListener('online',update);document.removeEventListener('visibilitychange',update)}},[refresh]);
 useEffect(()=>{if(notice){const t=setTimeout(()=>setNotice(''),4200);return()=>clearTimeout(t)}},[notice]);
 const previousNote=useRef({id:selected,value:selectedVisit?.note||''});
 useEffect(()=>{const next=selectedVisit?.note||'',previous=previousNote.current;setNote(draft=>previous.id!==selected||draft===previous.value?next:draft);previousNote.current={id:selected,value:next};setDate(selectedVisit?.visitDate||'')},[selected,selectedVisit?.note,selectedVisit?.visitDate]);
 const notify=(s:string)=>setNotice(s);
 const searchInput=useRef<HTMLInputElement>(null);const suppressSearchFocus=useRef(false);
 const openCountry=useCallback((id:string)=>{if(uploadLock.current)return;void transitionMap(()=>{if(!selectedRef.current)overviewCamera.current=cameraRef.current;if(document.activeElement===searchInput.current)suppressSearchFocus.current=true;setFinder(false);setQuery('');setView('map');setSelected(id);setHover(null)},terrainUrl(`country:${id}`,'natural-earth'),prepareCountry(id)).catch(error=>setNotice(error.message))},[]);
 const stage=useRef<HTMLDivElement>(null);
 const [mapBox,setMapBox]=useState({x:0,y:-42.5,width:1200,height:675});
 const boxRef=useRef(mapBox);boxRef.current=mapBox;
 const minZoom=selected||continent!=='World'?.15:Math.min(1,mapBox.width/1200,mapBox.height/590);
 const clampZoom=useCallback((k:number,x:number,y:number)=>{
  if(focused.current)return {k,x,y};
  const box=boxRef.current;
  const axis=(value:number,start:number,length:number,size:number)=>size*k<=length?start+(length-size*k)/2:Math.min(start+16,Math.max(start+length-size*k-16,value));
  return {k,x:axis(x,box.x,box.width,1200),y:axis(y,box.y,box.height,590)};
 },[]);
 useEffect(()=>{const element=stage.current;if(!element)return;const observer=new ResizeObserver(([entry])=>{
  const {width,height}=entry.contentRect;if(!width||!height)return;
  const h=height/width>.9?680:Math.max(640,1200*height/width),w=h*width/height;
  const box={x:600-w/2,y:295-h/2,width:w,height:h};boxRef.current=box;setMapBox(box);setZoom(z=>{const k=Math.max(focused.current?.15:Math.min(1,w/1200,h/590),z.k);return clampZoom(k,600+(z.x-600)*k/z.k,295+(z.y-295)*k/z.k)});
 });observer.observe(element);return()=>observer.disconnect()},[clampZoom]);
 const freezeCamera=useCallback(()=>{
  const element=svg.current?.querySelector<SVGGElement>('.map-geography');
  const matrix=element?new DOMMatrix(getComputedStyle(element).transform):null;
  const current=matrix?{k:matrix.a,x:matrix.e,y:matrix.f}:null;
  setSmoothCamera(false);if(current)setZoom(current);return current;
 },[]);
 const changeZoom=(factor:number)=>{cameraCommand.current++;setSmoothCamera(true);setZoom(z=>{const k=Math.min(14,Math.max(minZoom,z.k*factor));return clampZoom(k,600+(z.x-600)*(k/z.k),295+(z.y-295)*(k/z.k))})};
 const fitCurrentView=useCallback((animate=true)=>{
  cameraCommand.current++;
  setSmoothCamera(animate);
  if(!selected&&overviewCamera.current){setZoom(overviewCamera.current);overviewCamera.current=null;return}
  if(!selected&&continent==='World'){
   const box=boxRef.current,k=Math.min(1,box.width/1200,box.height/590);setZoom({k,x:600*(1-k),y:295*(1-k)});return;
  }
  const rect=stage.current?.getBoundingClientRect();if(!rect)return;
  const bounds=selected?(details[selected].focusBounds||details[selected].bounds):regions[continent as Region].bounds;
  setZoom(fitShape(bounds,boxRef.current,{width:rect.width,height:rect.height},!!selected));
 },[selected,continent,mapStyle]);
 useLayoutEffect(()=>{fitCurrentView(false)},[fitCurrentView,mapBox]);
 const chooseContinent=(value:Continent)=>{if(busy)return;void transitionMap(()=>{overviewCamera.current=null;setContinent(value);setSelected(null);setFinder(false);setQuery('');setHover(null);setView('map')},terrainUrl(value,mapStyle).replace('/terrain/','/basemaps/'),prepareRegion(value)).catch(error=>notify(error.message))};

 useEffect(()=>{
  const element=svg.current;if(!element)return;
  let frame=0,delta=0,clientX=0,clientY=0;
  const wheel=(e:WheelEvent)=>{e.preventDefault();delta+=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?element.clientHeight:1);clientX=e.clientX;clientY=e.clientY;
   if(frame)return;
   const command=cameraCommand.current;frame=requestAnimationFrame(()=>{frame=0;if(command!==cameraCommand.current){delta=0;return}const camera=freezeCamera();const matrix=element.getScreenCTM();if(!matrix){delta=0;return}const p=element.createSVGPoint();p.x=clientX;p.y=clientY;const point=p.matrixTransform(matrix.inverse()),amount=delta;delta=0;
    setZoom(previous=>{const z=camera||previous,box=boxRef.current,minimum=focused.current?.15:Math.min(1,box.width/1200,box.height/590),k=Math.min(14,Math.max(minimum,z.k*Math.exp(-amount*.0016)));return clampZoom(k,point.x+(z.x-point.x)*k/z.k,point.y+(z.y-point.y)*k/z.k)});
   });
  };
  element.addEventListener('wheel',wheel,{passive:false});return()=>{element.removeEventListener('wheel',wheel);cancelAnimationFrame(frame)};
 },[clampZoom,freezeCamera]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setFinder(false)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
 async function changeCountry(id:string,patch:Record<string,unknown>,success?:string){
  setBusy(true);try{await api(`/api/countries/${id}`,{method:'PATCH',body:JSON.stringify(patch)});await refresh();if(success)notify(success)}catch(e){notify((e as Error).message)}finally{setBusy(false)}
 }
 async function toggleVisited(id:string){
  if(loading||loadError||syncError||busy||pendingVisits.current.has(id))return;
  const before=visits[id],next=!before?.visited,now=new Date().toISOString();
  pendingVisits.current.add(id);setSavingVisits(new Set(pendingVisits.current));
  setData(current=>({...current,visits:current.visits.some(v=>v.countryId===id)?current.visits.map(v=>v.countryId===id?{...v,visited:Number(next),updatedAt:now}:v):[...current.visits,{countryId:id,visited:Number(next),coverId:null,note:'',visitDate:null,updatedAt:now}]}));
  try{await api(`/api/countries/${id}`,{method:'PATCH',body:JSON.stringify({visited:next})})}
  catch(error){setData(current=>({...current,visits:before?current.visits.map(v=>v.countryId===id?{...v,visited:before.visited,updatedAt:before.updatedAt}:v):current.visits.filter(v=>v.countryId!==id)}));notify((error as Error).message)}
  finally{pendingVisits.current.delete(id);setSavingVisits(new Set(pendingVisits.current))}
 }
 const activateCountry=openCountry;
 async function uploadFiles(files:FileList|ImageSource[],countryId=selected){
  if(!countryId||!files.length||syncError||loading||loadError||busy||uploadLock.current||savingVisits.has(countryId))return;
  const id=countryId;let count=0,error='';const all=Array.from(files as ImageSource[]);if(all.length>30){notify('Please add up to 30 photos at a time.');return}
  uploadLock.current=true;setBusy(true);
  try{for(let i=0;i<all.length;i++){setUploading(`Saving photo ${i+1} of ${all.length}…`);try{const file=await imageSourceFile(all[i]);const blob=await prepareImage(file);const body=new FormData();body.set('countryId',id);body.set('photo',blob,'memory.webp');const dimensions=await createImageBitmap(blob);body.set('width',String(dimensions.width));body.set('height',String(dimensions.height));dimensions.close();await api('/api/photos',{method:'POST',body});count++}catch(e){error=(e as Error).message;break}}await refresh()}
  finally{setUploading('');setBusy(false);uploadLock.current=false;if(fileInput.current)fileInput.current.value=''}
  if(error)notify(count?`${count} added. ${error}`:error);else if(count)notify(`${count} ${count===1?'photo':'photos'} added.`);
 }
 const transferHandlers=useRef({paste:(_e:ClipboardEvent)=>{},drop:(_e:DragEvent)=>{},over:(_e:DragEvent)=>{}});
 const transferBlocked=()=>!!document.querySelector('.modal-backdrop:not(.country-modal)');
 const editableTarget=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('input,textarea,[contenteditable="true"]');
 transferHandlers.current={
  paste:e=>{if(e.defaultPrevented||transferBlocked()||!e.clipboardData)return;if(editableTarget(e.target))return;const sources=transferredImages(e.clipboardData);if(!sources.length)return;e.preventDefault();if(!selected){notify('Choose a country first, then paste your image.');return}void uploadFiles(sources)},
  over:e=>{if(editableTarget(e.target))return;if(e.dataTransfer&&canTransferImages(e.dataTransfer)){e.preventDefault();e.dataTransfer.dropEffect=busy||syncError?'none':'copy'}},
  drop:e=>{if(!e.dataTransfer||!canTransferImages(e.dataTransfer))return;if(editableTarget(e.target)){if(e.dataTransfer.files.length)e.preventDefault();return}e.preventDefault();document.querySelector('.photo-drop-area')?.classList.remove('drag-over');if(transferBlocked())return;const sources=transferredImages(e.dataTransfer);if(!sources.length){notify('Drop an image or use Copy image, then paste.');return}const country=(e.target as Element).closest('[data-country]')?.getAttribute('data-country')||selected;if(!country){notify('Drop your image onto a country, or open its album first.');return}if(busy||syncError||uploadLock.current){notify(syncError?'Reconnect to your computer to add photos.':'Please wait for the current photos to save.');return}if(country!==selected)openCountry(country);void uploadFiles(sources,country)}
 };
 useEffect(()=>{const paste=(e:ClipboardEvent)=>transferHandlers.current.paste(e),drop=(e:DragEvent)=>transferHandlers.current.drop(e),over=(e:DragEvent)=>transferHandlers.current.over(e);document.addEventListener('paste',paste);window.addEventListener('drop',drop);window.addEventListener('dragover',over);return()=>{document.removeEventListener('paste',paste);window.removeEventListener('drop',drop);window.removeEventListener('dragover',over)}},[]);
 async function removePhoto(){if(!deleteId)return;setBusy(true);try{await api(photoUrl(deleteId),{method:'DELETE'});setDeleteId(null);setLightbox(null);await refresh();notify('Photo removed.')}catch(e){notify((e as Error).message)}finally{setBusy(false)}}
 const searchResults=regionCountries.filter(c=>!query||`${c.name} ${c.code}`.toLowerCase().includes(query.toLowerCase()));
 const matching=regionCountries.filter(c=>filter==='all'||(filter==='visited'?visitedIds.has(c.id):!visitedIds.has(c.id)));
 const galleryCountries=matching.filter(c=>visitedIds.has(c.id)||withPhotos.has(c.id));
 const albumForLightbox=lightbox?data.photos.filter(p=>p.countryId===lightbox.countryId):[];
 const lightboxIndex=lightbox?albumForLightbox.findIndex(p=>p.id===lightbox.id):-1;
 const swipeStart=useRef<{x:number;y:number}|null>(null);
 const nextPhoto=(direction:number)=>{if(albumForLightbox.length>1)setLightbox(albumForLightbox[(lightboxIndex+direction+albumForLightbox.length)%albumForLightbox.length])};
 useEffect(()=>{if(!lightbox||cropId||deleteId)return;const key=(event:KeyboardEvent)=>{if((event.target as HTMLElement)?.matches('input,textarea'))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();nextPhoto(event.key==='ArrowLeft'?-1:1)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[lightbox?.id,cropId,deleteId,data.photos]);
 const cropPhoto=cropId?data.photos.find(p=>p.id===cropId):null;
 const exportShapes=useMemo(()=>exportScope.startsWith('country:')?[{...byId[exportScope.slice(8)],...details[exportScope.slice(8)]}]:exportScope==='World'?projectedCountries:Object.entries(regions[exportScope as Region].shapes).map(([id,shape])=>({...byId[id],...shape})),[exportScope,projectedCountries]);
 const mapTerrain=terrainUrl(selected?`country:${selected}`:continent,mapStyle),exportTerrain=terrainUrl(exportScope,mapStyle);
 const exportBounds=[Math.min(...exportShapes.map(c=>c.bounds[0])),Math.min(...exportShapes.map(c=>c.bounds[1])),Math.max(...exportShapes.map(c=>c.bounds[2])),Math.max(...exportShapes.map(c=>c.bounds[3]))];
 async function savePhotoPosition(photo:Photo,frame:PhotoFrame){await api(photoUrl(photo.id),{method:'PATCH',body:JSON.stringify(frame)});setData(current=>({...current,photos:current.photos.map(p=>p.id===photo.id?{...p,...frame}:p)}));setLightbox(current=>current?.id===photo.id?{...current,...frame}:current);setCropId(null);notify('Photo position saved.')}
 async function downloadMap(){setExporting(true);setExportError('');setExportProgress('Preparing your map…');try{const blob=await exportMap(exportShapes,visits,data.photos,setExportProgress,exportTerrain),name=`worldwide-${exportScope.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.png`;if(!await saveNativeFile(blob,name)){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}setExportProgress('Image saved.')}catch(error){setExportError((error as Error).message);setExportProgress('')}finally{setExporting(false)}}
 const closeCountry=()=>{if(!busy)void transitionMap(()=>setSelected(null),terrainUrl(continent,mapStyle).replace('/terrain/','/basemaps/'))};
 const countryPaths=useMemo(()=>mapShapes.map(c=>{const v=visits[c.id],hasCover=!!(v?.visited&&v.coverId),dim=!selected&&(filter==='visited'?!v?.visited:filter==='unvisited'?!!v?.visited:false);return <g className={`country-region ${dim?'region-dimmed':''}`} key={c.id}><path d={c.path} data-country={c.id} style={{fill:hasCover?`url(#cover-${c.id})`:selected?(c.id==='ATA'?'#f5f7f6':'url(#map-terrain)'):'transparent'}} className={`country ${v?.visited?'visited':''} ${hasCover?'has-photo':''} ${dim?'dimmed':''} ${selected===c.id?'is-selected':''}`} vectorEffect="non-scaling-stroke" role="button" tabIndex={-1} aria-label={`${c.name}${v?.visited?', visited':''}`} onClick={()=>{if(!dragged.current){if(selected===c.id&&v?.coverId)setCropId(v.coverId);else activateCountry(c.id)}}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activateCountry(c.id)}}} onMouseEnter={e=>{if(!drag.current)setHover(current=>current?.id===c.id?current:{id:c.id,x:e.clientX,y:e.clientY})}}/>{v?.visited&&!hasCover&&<path className={`visited-wash active ${dim?'dimmed':''}`} d={c.path} fill={VISITED_TINT} aria-hidden="true"/>}{dim&&<path d={c.path} fill="#e7eff1" opacity={.84} pointerEvents="none"/>}<path className={`country-border ${c.id==='ATA'?'antarctica-border':''} ${v?.visited?'visited':''} ${selected===c.id?'selected':''}`} d={c.outline??c.path} vectorEffect="non-scaling-stroke" aria-hidden="true"/></g>}),[mapShapes,visits,filter,selected,openCountry]);
 return <main className="map-app" aria-label="Worldwide travel map">
  <div ref={stage} className="map-canvas">
   <svg ref={svg} className="world-map" viewBox={`${mapBox.x} ${mapBox.y} ${mapBox.width} ${mapBox.height}`} role="group" aria-label="World map. Click a country to mark it visited or add photos."
    onPointerDown={e=>{if(e.button!==0)return;if(selected&&visits[selected]?.coverId&&(e.target as Element).closest('[data-country]')){dragged.current=false;return;}const camera=freezeCamera()||zoom;touchPoints.current.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touchPoints.current.size===2){const [a,b]=Array.from(touchPoints.current.values()),rect=e.currentTarget.getBoundingClientRect();pinch.current={distance:Math.hypot(a.x-b.x,a.y-b.y),k:camera.k,x:camera.x,y:camera.y,anchorX:mapBox.x+((a.x+b.x)/2-rect.left)/rect.width*mapBox.width,anchorY:mapBox.y+((a.y+b.y)/2-rect.top)/rect.height*mapBox.height};dragged.current=true;e.currentTarget.setPointerCapture(e.pointerId);return}drag.current={x:e.clientX,y:e.clientY,ox:camera.x,oy:camera.y,id:e.pointerId};dragged.current=false;setFinder(false)}}
    onPointerMove={e=>{if(touchPoints.current.has(e.pointerId))touchPoints.current.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pinch.current&&touchPoints.current.size===2){const [a,b]=Array.from(touchPoints.current.values()),p=pinch.current,rect=e.currentTarget.getBoundingClientRect(),k=Math.min(14,Math.max(minZoom,p.k*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,p.distance))),mx=mapBox.x+((a.x+b.x)/2-rect.left)/rect.width*mapBox.width,my=mapBox.y+((a.y+b.y)/2-rect.top)/rect.height*mapBox.height;queueCamera(clampZoom(k,mx-(p.anchorX-p.x)*k/p.k,my-(p.anchorY-p.y)*k/p.k));setHover(null);return}if(!drag.current)return;const dx=e.clientX-drag.current.x,dy=e.clientY-drag.current.y;if(Math.abs(dx)+Math.abs(dy)>5){dragged.current=true;e.currentTarget.setPointerCapture(e.pointerId);setHover(null);const rect=e.currentTarget.getBoundingClientRect(),{ox,oy}=drag.current;queueCamera(clampZoom(cameraRef.current.k,ox+dx/rect.width*mapBox.width,oy+dy/rect.height*mapBox.height))}}}
    onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);touchPoints.current.delete(e.pointerId);pinch.current=null;drag.current=null}}
    onPointerCancel={()=>{touchPoints.current.clear();pinch.current=null;drag.current=null}} onMouseLeave={()=>setHover(null)}>
    <defs><TerrainPattern id="map-terrain" url={mapTerrain}/>{data.visits.filter(v=>v.coverId).map(v=>{const c=byId[v.countryId];if(!c)return null;const shape=selected===c.id?details[c.id]:continent==='World'?worldShapes[c.id]:regions[continent].shapes[c.id];if(!shape)return null;const [x1,y1,x2,y2]=shape.bounds;return <PhotoPattern key={v.countryId} id={`cover-${v.countryId}`} photo={data.photos.find(p=>p.id===v.coverId)||{id:v.coverId!}} bounds={shape.bounds}/>})}</defs>
    <g className={`map-geography ${selected?'country-closeup':'overview'} ${zoom.k>3?'detailed-borders':''} ${smoothCamera?'smooth':''}`} style={{transform:`translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.k})`}}>{!selected&&<image className="base-map-image" href={mapTerrain.replace('/terrain/','/basemaps/')} x={0} y={0} width={1200} height={590} preserveAspectRatio="none" pointerEvents="none"/>}{countryPaths}{!selected&&mapShapes.map(c=>{const unit=mapBox.width/Math.max(1,stage.current?.clientWidth||1200)/zoom.k;if(Math.max(c.bounds[2]-c.bounds[0],c.bounds[3]-c.bounds[1])/unit>=7)return null;return <circle key={`hit-${c.id}`} className="country-hit-target" cx={(c.bounds[0]+c.bounds[2])/2} cy={(c.bounds[1]+c.bounds[3])/2} r={10*unit} role="button" tabIndex={-1} aria-label={`Select ${c.name}`} onClick={()=>{if(!dragged.current)activateCountry(c.id)}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();activateCountry(c.id)}}} onMouseEnter={e=>{if(!drag.current)setHover(current=>current?.id===c.id?current:{id:c.id,x:e.clientX,y:e.clientY})}}/>})}</g>
   </svg>
  </div>
  <div className="search-dock" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setFinder(false)}}>
   <div className="search-field"><Search size={19}/><input ref={searchInput} aria-label="Search countries" placeholder="Search countries" value={query} onFocus={()=>{if(suppressSearchFocus.current){suppressSearchFocus.current=false;return}setFinder(true)}} onChange={e=>{setQuery(e.target.value);setFinder(true)}} onKeyDown={e=>{if(e.key==='Enter'&&searchResults.length)activateCountry(searchResults[0].id)}}/>{query?<button className="icon-button" aria-label="Clear search" onClick={()=>setQuery('')}><X size={17}/></button>:<Globe2 size={18} className="search-globe"/>}</div>
   {finder&&<div className="search-results" aria-label="Country search results">{searchResults.length?searchResults.map(c=><div className="country-search-row" key={c.id}><button className="search-country" onMouseDown={e=>e.preventDefault()} onClick={()=>activateCountry(c.id)}><span className="country-flag">{flag(c.code)}</span><span>{c.name}</span></button><label className="search-visit-check"><input type="checkbox" aria-label={`Visited ${c.name}`} checked={visitedIds.has(c.id)} disabled={busy||loading||!!loadError||syncError} aria-busy={savingVisits.has(c.id)} onChange={()=>toggleVisited(c.id)}/></label></div>):<p>No countries found</p>}</div>}
  </div>
  <div className="region-dock">{selected&&<button className="back-region" onClick={closeCountry} disabled={busy} aria-label={`Back to ${continent}`}><ChevronLeft size={17}/></button>}<RegionPicker value={continent} regions={continentNames} onRegion={value=>chooseContinent(value as Continent)} onCountry={openCountry}/></div>
  <div className="top-controls"><div className="map-filters" aria-label="Filter countries">{([['all','All'],['visited','Visited'],['unvisited','Not visited']] as [Filter,string][]).map(([key,label])=><button key={key} aria-pressed={filter===key} className={filter===key?'active':''} onClick={()=>{setFilter(key);setFinder(false)}}>{label}</button>)}</div><button className="floating-button albums-button" title="Photo albums" aria-label="Photo albums" disabled={busy} onClick={()=>void transitionMap(()=>{setSelected(null);setView('albums');setFinder(false)},terrainUrl(continent,mapStyle))}><Images size={19}/></button><button className="floating-button account-button" aria-label="Your account" title="Your account" onClick={onAccount}><UserRound size={18}/></button></div>
  {loadError&&<div className="map-status error" role="alert"><span>{loadError}</span><button onClick={()=>{setLoading(true);refresh()}}>Retry</button></div>}
  <div className="map-meta"><div className="map-meta-actions"><button className="map-style-button" aria-label="Choose map style" title="Map styles" disabled={busy} onClick={()=>void transitionMap(()=>{setStylesOpen(true);setFinder(false)})}><MapIcon size={17}/><span>Map style</span></button><button className="save-map-button" disabled={busy||loading||!!loadError||savingVisits.size>0} onClick={()=>void transitionMap(()=>{setExportScope('World');setExportError('');setExportOpen(true)})}><Download size={16}/>Save map</button></div><span className="map-wordmark">Worldwide</span><span className={`sync-indicator ${syncError?'disconnected':''}`} role="status" title={syncError?'Viewing the album saved on this device. Reconnect to sync changes':'Changes save to your private album'}>{syncError?<CloudOff size={13}/>:busy||savingVisits.size||loading?<LoaderCircle size={13} className="spinning"/>:<CloudCheck size={13}/>} {syncError?'Offline':busy||savingVisits.size?'Saving…':loading?'Syncing…':'Saved'}</span><span className="visited-count" aria-live="polite">{loading?<LoaderCircle size={13} className="spinning"/>:<span className="visited-dot"/>}{visited.length} visited</span><a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a></div>

  <div className="map-zoom" aria-label="Map controls"><button title="Zoom in" aria-label="Zoom in" disabled={zoom.k>=14} onClick={()=>changeZoom(1.5)}><Plus size={20}/></button><button title="Zoom out" aria-label="Zoom out" disabled={zoom.k<=minZoom} onClick={()=>changeZoom(1/1.5)}><Minus size={20}/></button><span/><button title={selected?'Fit country':continent==='World'?'Show whole world':'Fit continent'} aria-label={selected?'Fit country':continent==='World'?'Show whole world':'Fit continent'} onClick={()=>fitCurrentView()}><Maximize size={18}/></button></div>
  {hover&&!selected&&!finder&&view==='map'&&<div className="map-tooltip" style={{left:Math.min(hover.x+14,typeof window!=='undefined'?window.innerWidth-180:hover.x),top:Math.min(hover.y+16,typeof window!=='undefined'?window.innerHeight-58:hover.y)}}>{flag(byId[hover.id].code)} {byId[hover.id].name}{visitedIds.has(hover.id)&&<Check size={13}/>}</div>}
  {view==='albums'&&<Modal label="Photo albums" onClose={()=>{void transitionMap(()=>setView('map'))}} className="albums-modal"><div className="modal-heading"><h2>Albums</h2><button className="icon-button" aria-label="Close albums" onClick={()=>{void transitionMap(()=>setView('map'))}}><X size={21}/></button></div>{galleryCountries.length?<div className="album-grid">{galleryCountries.map(c=><button className="album-card" key={c.id} onClick={()=>openCountry(c.id)}><div className="album-cover"><CountryShape country={c} cover={visits[c.id]?.coverId} photo={data.photos.find(p=>p.id===visits[c.id]?.coverId)} className="album-silhouette"/></div><div className="album-text"><strong>{c.name}</strong><span>{data.photos.filter(p=>p.countryId===c.id).length} photos</span></div></button>)}</div>:<div className="album-empty"><Images size={32} strokeWidth={1.3}/><p>No albums yet</p><button className="button primary" onClick={()=>{setView('map');setFinder(true)}}>Choose a country</button></div>}</Modal>}
  {selectedCountry&&<Modal label={`${selectedCountry.name} travel album`} onClose={closeCountry} className="country-modal"><div className="country-panel"><header className="country-header"><div><span className="country-region">{selectedCountry.continent}</span><h2 title={selectedCountry.name}><span>{flag(selectedCountry.code)}</span>{selectedCountry.name}</h2></div><button className="icon-button country-save-button" disabled={busy||savingVisits.size>0} aria-label="Save country map" onClick={()=>{void transitionMap(()=>{setExportScope(`country:${selectedCountry.id}`);setExportError('');setExportOpen(true)})}}><Download size={19}/></button><button className="icon-button" disabled={busy} aria-label="Close country album" onClick={closeCountry}><X size={21}/></button></header>
   <label className={`visit-toggle ${selectedVisit?.visited?'is-visited':''}`}><span><input type="checkbox" aria-label="Visited" checked={!!selectedVisit?.visited} disabled={busy||loading||!!loadError||syncError} aria-busy={savingVisits.has(selectedCountry.id)} onChange={()=>toggleVisited(selectedCountry.id)}/><span>Visited</span></span>{savingVisits.has(selectedCountry.id)&&<LoaderCircle size={16} className="spinning"/>}</label>
   <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="sr-only" aria-label="Upload photos" onChange={e=>e.target.files&&uploadFiles(e.target.files)}/>
   <div className="photos-heading"><h3>Photos <span>{selectedPhotos.length}</span></h3><button className="button primary upload-button" disabled={busy||loading||!!loadError||syncError||savingVisits.has(selectedCountry.id)} onClick={()=>fileInput.current?.click()}>{uploading?<LoaderCircle size={16} className="spinning"/>:<Plus size={17}/>} {uploading?'Uploading…':'Add photos'}</button></div>
   {selectedVisit?.coverId&&<button className="adjust-cover-button" disabled={busy||syncError} onClick={()=>void transitionMap(()=>setCropId(selectedVisit.coverId))}><SlidersHorizontal size={14}/>Adjust photo</button>}
   <p className="photo-import-hint">Drop images here or paste with Ctrl / ⌘ + V</p>
   <div className={`photo-drop-area ${selectedPhotos.length?'has-photos':''}`} onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add('drag-over')}} onDragLeave={e=>e.currentTarget.classList.remove('drag-over')} >
    {selectedPhotos.length?<PhotoGallery photos={selectedPhotos} coverId={selectedVisit?.coverId} disabled={busy||syncError} onOpen={p=>void transitionMap(()=>setLightbox(p))} onReorder={async ids=>{await api('/api/photos/order',{method:'PATCH',body:JSON.stringify({countryId:selectedCountry.id,ids})});await refresh()}}/>:<button className="empty-photos" disabled={busy||loading||!!loadError||syncError||savingVisits.has(selectedCountry.id)} onClick={()=>fileInput.current?.click()}><Camera size={25} strokeWidth={1.3}/><span>{uploading||'Drop images here, paste, or add photos'}</span></button>}
   </div>
   <details className="country-details"><summary>Details</summary><div className="visit-date"><label htmlFor="visit-date"><CalendarDays size={15}/> Visit date</label><input type="date" id="visit-date" value={date} disabled={busy||syncError} onChange={e=>{setDate(e.target.value);changeCountry(selectedCountry.id,{visitDate:e.target.value||null})}}/></div><div className="travel-note"><label htmlFor="travel-note">Notes</label><textarea disabled={syncError} id="travel-note" maxLength={4000} placeholder="Add a note…" value={note} onChange={e=>setNote(e.target.value)} rows={3}/>{note!==(selectedVisit?.note||'')&&<button className="button" disabled={busy||syncError} onClick={()=>changeCountry(selectedCountry.id,{note},'Note saved.')}><Check size={14}/>Save</button>}</div></details>
  </div></Modal>}
  {lightbox&&<Modal label="Photo viewer" className="lightbox-modal" onClose={()=>{void transitionMap(()=>setLightbox(null))}}><div className="lightbox-top"><div><span className="eyebrow small">{byId[lightbox.countryId].name}</span><span>{lightboxIndex+1} / {albumForLightbox.length}</span></div><button className="icon-button" aria-label="Close photo" onClick={()=>{void transitionMap(()=>setLightbox(null))}}><X size={22}/></button></div><div className="lightbox-image" onTouchStart={event=>{const touch=event.touches[0];swipeStart.current={x:touch.clientX,y:touch.clientY}}} onTouchEnd={event=>{const start=swipeStart.current,touch=event.changedTouches[0];swipeStart.current=null;if(!start||!touch)return;const dx=touch.clientX-start.x,dy=touch.clientY-start.y;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.5)nextPhoto(dx>0?-1:1)}}><img src={photoUrl(lightbox.id)} alt={lightbox.caption||`Memory from ${byId[lightbox.countryId].name}`}/>{albumForLightbox.length>1&&<><button className="lightbox-prev" aria-label="Previous photo" onClick={()=>setLightbox(albumForLightbox[(lightboxIndex-1+albumForLightbox.length)%albumForLightbox.length])}><ChevronLeft size={24}/></button><button className="lightbox-next" aria-label="Next photo" onClick={()=>setLightbox(albumForLightbox[(lightboxIndex+1)%albumForLightbox.length])}><ChevronRight size={24}/></button></>}</div><div className="lightbox-info"><CaptionEditor disabled={syncError} key={lightbox.id} photo={lightbox} onSave={async caption=>{await api(photoUrl(lightbox.id),{method:'PATCH',body:JSON.stringify({caption})});setLightbox({...lightbox,caption});await refresh();notify('Caption saved.')}}/><div className="lightbox-actions"><button className="button primary" disabled={busy||syncError||visits[lightbox.countryId]?.coverId===lightbox.id} onClick={()=>changeCountry(lightbox.countryId,{coverId:lightbox.id},'Cover updated.')}><Star size={15}/>{visits[lightbox.countryId]?.coverId===lightbox.id?'Map photo':'Use on map'}</button>{visits[lightbox.countryId]?.coverId===lightbox.id&&<button className="button" disabled={busy||syncError} onClick={()=>void transitionMap(()=>setCropId(lightbox.id))}><SlidersHorizontal size={14}/>Adjust</button>}<a className="icon-button" href={photoUrl(lightbox.id)} download={`worldwide-${byId[lightbox.countryId].name}.webp`} aria-label="Download photo" title="Download photo" onClick={async event=>{if(!isNativeApp())return;event.preventDefault();try{const response=await fetch(photoUrl(lightbox.id));if(!response.ok)throw new Error('Couldn’t save this photo.');await saveNativeFile(await response.blob(),`worldwide-${byId[lightbox.countryId].name}.webp`)}catch(error){notify((error as Error).message)}}}><Download size={18}/></a><button className="icon-button danger" disabled={busy||syncError} aria-label="Delete photo" title="Delete photo" onClick={()=>setDeleteId(lightbox.id)}><Trash2 size={18}/></button></div></div></Modal>}
  {cropPhoto&&<Modal label="Adjust cover photo" className="photo-editor-modal" onClose={()=>{void transitionMap(()=>setCropId(null))}}><PhotoEditor key={cropPhoto.id} photo={cropPhoto} shape={details[cropPhoto.countryId]} name={byId[cropPhoto.countryId].name} onCancel={()=>{void transitionMap(()=>setCropId(null))}} onSave={frame=>savePhotoPosition(cropPhoto,frame)}/></Modal>}
  {stylesOpen&&<Modal label="Map styles" className="map-styles-modal" onClose={()=>{styleRequest.current++;setStyleLoading(false);void transitionMap(()=>setStylesOpen(false))}}><div className="modal-heading"><h2>Map styles</h2><button className="icon-button" aria-label="Close map styles" onClick={()=>{styleRequest.current++;setStyleLoading(false);void transitionMap(()=>setStylesOpen(false))}}><X size={21}/></button></div><div className="map-style-grid">{mapStyles.map(style=><button key={style.id} className={`map-style-card ${mapStyle===style.id?'active':''}`} aria-pressed={mapStyle===style.id} disabled={styleLoading||syncError} onClick={()=>void chooseMapStyle(style.id)}><svg viewBox="0 0 180 90" aria-hidden="true"><path d={style.preview}/></svg><span>{style.name}{mapStyle===style.id&&<Check size={15}/>}</span></button>)}</div>{styleLoading&&<p className="style-status" role="status">Loading map…</p>}{styleError&&<p className="editor-error" role="alert">{styleError}</p>}</Modal>}
  {exportOpen&&<Modal label="Save photo map" className="export-map-modal" onClose={()=>{if(!exporting)void transitionMap(()=>setExportOpen(false))}}><div className="modal-heading"><h2>Save map</h2><button className="icon-button" disabled={exporting} aria-label="Close save map" onClick={()=>void transitionMap(()=>setExportOpen(false))}><X size={21}/></button></div><label className="export-scope">Map<select aria-label="Map to save" disabled={exporting} value={exportScope} onChange={e=>{const value=e.target.value;void prepareRegion(value as Continent).then(()=>{setExportScope(value);setExportProgress('');setExportError('')}).catch(error=>setExportError(error.message))}}><option value="World">Whole world · {mapStyles.find(s=>s.id===mapStyle)?.name}</option>{continentNames.map(name=><option value={name} key={name}>{name}</option>)}{selectedCountry&&<option value={`country:${selectedCountry.id}`}>{selectedCountry.name}</option>}</select></label><div className="export-preview"><svg viewBox={`${exportBounds[0]-20} ${exportBounds[1]-20} ${exportBounds[2]-exportBounds[0]+40} ${exportBounds[3]-exportBounds[1]+40}`} role="img" aria-label="Photo map export preview"><defs><TerrainPattern id="export-terrain" url={exportTerrain}/>{exportShapes.map(c=>{const v=visits[c.id],photo=data.photos.find(p=>p.id===v?.coverId);return v?.visited&&photo?<PhotoPattern key={c.id} id={`export-${c.id}`} photo={photo} bounds={c.bounds}/>:null})}</defs>{exportShapes.map(c=>{const v=visits[c.id];return <g key={c.id}><path d={c.path} fill={v?.visited&&v?.coverId?`url(#export-${c.id})`:c.id==='ATA'?'#f5f7f6':'url(#export-terrain)'} stroke="none"/><path d={c.path} fill={VISITED_TINT} opacity={v?.visited&&!v.coverId?VISITED_OPACITY:0}/><path d={c.outline??c.path} fill="none" stroke={c.id==='ATA'?'#a8b5b8':v?.visited?'#567062':'#87938a'} strokeWidth={v?.visited?.65:.5}/></g>})}</svg></div><p className="export-format">PNG · 4000 × 2400 · Includes saved photo positions</p>{exportError&&<p className="editor-error" role="alert">{exportError}</p>}<div className="export-actions"><span role="status">{exportProgress}</span><button className="button primary" disabled={exporting} onClick={downloadMap}>{exporting?<LoaderCircle size={15} className="spinning"/>:<Download size={15}/>} {exporting?'Saving…':'Download PNG'}</button></div></Modal>}
  {deleteId&&<Modal label="Delete photo" onClose={()=>!busy&&setDeleteId(null)} className="confirm-modal"><Trash2 size={28} strokeWidth={1.3}/><h2>Delete photo?</h2><p>This removes the photo from this album.</p><div><button className="button" disabled={busy} onClick={()=>setDeleteId(null)}>Cancel</button><button className="button danger-button" disabled={busy} onClick={removePhoto}>{busy?'Removing…':'Delete photo'}</button></div></Modal>}
  {notice&&<div className="toast" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={()=>setNotice('')}><X size={15}/></button></div>}
 </main>
}
function CaptionEditor({photo,onSave,disabled=false}:{disabled?:boolean;photo:Photo;onSave:(caption:string)=>Promise<void>}){const [caption,setCaption]=useState(photo.caption);const [saving,setSaving]=useState(false);const [error,setError]=useState('');return <div className="caption-editor"><input disabled={disabled} aria-label="Photo caption" maxLength={500} placeholder="Add a caption…" value={caption} onChange={e=>setCaption(e.target.value)}/>{caption!==photo.caption&&<button className="text-button" disabled={saving||disabled} onClick={async()=>{setSaving(true);setError('');try{await onSave(caption)}catch(e){setError((e as Error).message)}finally{setSaving(false)}}}>{saving?'Saving…':'Save caption'}</button>}{error&&<small role="alert">{error}</small>}</div>}
