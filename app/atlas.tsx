'use client';
import {useState,useEffect,useRef,useCallback,useMemo, type ReactNode} from 'react';
import {Globe2,Images,Plus,Search,X,Check,ChevronLeft,ChevronRight,Minus,Maximize,Camera,LoaderCircle,Star,Trash2,CalendarDays,BookOpen,Download} from 'lucide-react';
import world from './data/world.json';

type Country=(typeof world.countries)[number];
type Photo={id:string;countryId:string;caption:string;createdAt:string};
type Visit={countryId:string;visited:number;coverId:string|null;note:string;visitDate:string|null;updatedAt:string};
type Data={visits:Visit[];photos:Photo[]};
type View='map'|'albums';
type Filter='all'|'visited'|'unvisited';
const countries=world.countries;
const byId=Object.fromEntries(countries.map(c=>[c.id,c]));
const photoUrl=(id:string)=>`/api/photos/${id}`;
const flag=(code:string)=>/^[A-Z]{2}$/.test(code)?String.fromCodePoint(...code.split('').map(c=>127397+c.charCodeAt(0))):'🌍';
async function api<T=Data>(path:string,options:RequestInit={}):Promise<T>{
 const response=await fetch(path,{...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...options.headers}});
 const data=await response.json() as T & {error?:string};if(!response.ok)throw new Error(data.error||'Something went wrong. Please try again.');return data;
}
function Modal({children,onClose,label,className=''}:{children:ReactNode;onClose:()=>void;label:string;className?:string}){
 const box=useRef<HTMLDivElement>(null);const closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{const previous=document.activeElement as HTMLElement;const old=document.body.style.overflow;document.body.style.overflow='hidden';
 const t=setTimeout(()=>box.current?.querySelector<HTMLElement>('[autofocus], input, button, a, textarea')?.focus(),30);
 const key=(e:KeyboardEvent)=>{const dialogs=document.querySelectorAll('[role="dialog"][aria-modal="true"]');if(dialogs[dialogs.length-1]!==box.current)return;if(e.key==='Escape'){e.stopPropagation();closeRef.current()}
 if(e.key==='Tab'){const els=Array.from(box.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,textarea,select,[tabindex="0"]')||[]).filter(el=>el.getClientRects().length>0);const first=els[0],last=els[els.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};
 document.addEventListener('keydown',key);return()=>{clearTimeout(t);document.body.style.overflow=old;document.removeEventListener('keydown',key);previous?.focus()};},[]);
 return <div className={`modal-backdrop ${className}`} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div ref={box} role="dialog" aria-modal="true" aria-label={label} className="modal-box">{children}</div></div>
}
function CountryShape({country,cover,className=''}:{country:Country;cover?:string|null;className?:string}){
 const [x1,y1,x2,y2]=country.bounds;const w=Math.max(x2-x1,2),h=Math.max(y2-y1,2);const id=`shape-${country.id}-${className.replace(/[^a-z]/g,'')}`;
 return <svg className={`country-shape ${className}`} viewBox={`${x1-w*.06} ${y1-h*.06} ${w*1.12} ${h*1.12}`} aria-hidden="true"><defs><pattern id={id} patternUnits="userSpaceOnUse" x={x1} y={y1} width={w} height={h}>{cover&&<image href={photoUrl(cover)} x={0} y={0} width={w} height={h} preserveAspectRatio="xMidYMid slice"/>}</pattern></defs><path d={country.path} fill={cover?`url(#${id})`:'currentColor'}/></svg>
}
export default function Atlas({signedIn}:{signedIn:boolean}){
 const [data,setData]=useState<Data>({visits:[],photos:[]});const [loading,setLoading]=useState(signedIn);const [loadError,setLoadError]=useState('');
 const [view,setView]=useState<View>('map');const [filter,setFilter]=useState<Filter>('all');const [finder,setFinder]=useState(false);const [query,setQuery]=useState('');
 const [selected,setSelected]=useState<string|null>(null);const [lightbox,setLightbox]=useState<Photo|null>(null);const [deleteId,setDeleteId]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);const [uploading,setUploading]=useState('');const [notice,setNotice]=useState('');const [note,setNote]=useState('');const [date,setDate]=useState('');
 const [zoom,setZoom]=useState({k:1,x:0,y:0});const [hover,setHover]=useState<{id:string;x:number;y:number}|null>(null);
 const svg=useRef<SVGSVGElement>(null);const fileInput=useRef<HTMLInputElement>(null);const dragged=useRef(false);const drag=useRef<{x:number;y:number;ox:number;oy:number;id:number}|null>(null);
 const visits=useMemo(()=>Object.fromEntries(data.visits.map(v=>[v.countryId,v])),[data.visits]);
 const visited=data.visits.filter(v=>v.visited);const visitedIds=new Set(visited.map(v=>v.countryId));const withPhotos=new Set(data.photos.map(p=>p.countryId));
 const selectedCountry=selected?byId[selected]:null;const selectedVisit=selected?visits[selected]:null;const selectedPhotos=data.photos.filter(p=>p.countryId===selected);
 const refresh=useCallback(async()=>{try{const d=await api('/api/atlas');setData(d);setLoadError('')}catch(e){setLoadError((e as Error).message)}finally{setLoading(false)}},[]);
 useEffect(()=>{if(signedIn)refresh()},[refresh,signedIn]);
 useEffect(()=>{if(notice){const t=setTimeout(()=>setNotice(''),4200);return()=>clearTimeout(t)}},[notice]);
 useEffect(()=>{setNote(selectedVisit?.note||'');setDate(selectedVisit?.visitDate||'')},[selected,selectedVisit?.note,selectedVisit?.visitDate]);
 const notify=(s:string)=>setNotice(s);
 const searchInput=useRef<HTMLInputElement>(null);const suppressSearchFocus=useRef(false);
 const openCountry=(id:string)=>{if(document.activeElement===searchInput.current)suppressSearchFocus.current=true;setFinder(false);setQuery('');setView('map');setSelected(id);setHover(null)};
 const stage=useRef<HTMLDivElement>(null);
 const [mapBox,setMapBox]=useState({x:0,y:-42.5,width:1200,height:675});
 const boxRef=useRef(mapBox);boxRef.current=mapBox;
 const minZoom=Math.min(1,mapBox.width/1200,mapBox.height/590);
 const clampZoom=useCallback((k:number,x:number,y:number)=>{
  const box=boxRef.current;
  const axis=(value:number,start:number,length:number,size:number)=>size*k<=length?start+(length-size*k)/2:Math.min(start+16,Math.max(start+length-size*k-16,value));
  return {k,x:axis(x,box.x,box.width,1200),y:axis(y,box.y,box.height,590)};
 },[]);
 useEffect(()=>{const element=stage.current;if(!element)return;const observer=new ResizeObserver(([entry])=>{
  const {width,height}=entry.contentRect;if(!width||!height)return;
  const h=height/width>.9?680:Math.max(640,1200*height/width),w=h*width/height;
  const box={x:600-w/2,y:295-h/2,width:w,height:h};boxRef.current=box;setMapBox(box);setZoom(z=>{const k=Math.max(Math.min(1,w/1200,h/590),z.k);return clampZoom(k,600+(z.x-600)*k/z.k,295+(z.y-295)*k/z.k)});
 });observer.observe(element);return()=>observer.disconnect()},[clampZoom]);
 const changeZoom=(factor:number)=>setZoom(z=>{const k=Math.min(14,Math.max(minZoom,z.k*factor));return clampZoom(k,600+(z.x-600)*(k/z.k),295+(z.y-295)*(k/z.k))});
 const fitWorld=()=>{const k=Math.min(1,boxRef.current.width/1200,boxRef.current.height/590);setZoom(clampZoom(k,600*(1-k),295*(1-k)))};
 useEffect(()=>{const element=svg.current;if(!element)return;const wheel=(e:WheelEvent)=>{e.preventDefault();const matrix=element.getScreenCTM();if(!matrix)return;const p=element.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const point=p.matrixTransform(matrix.inverse());setZoom(z=>{const box=boxRef.current,minimum=Math.min(1,box.width/1200,box.height/590);const k=Math.min(14,Math.max(minimum,z.k*Math.exp(-e.deltaY*.0016)));return clampZoom(k,point.x+(z.x-point.x)*k/z.k,point.y+(z.y-point.y)*k/z.k)})};element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel)},[clampZoom]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setFinder(false)};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
 async function changeCountry(id:string,patch:Record<string,unknown>,success?:string){
  if(!signedIn){window.location.href='/signin-with-chatgpt?return_to=/';return}
  setBusy(true);try{await api(`/api/countries/${id}`,{method:'PATCH',body:JSON.stringify(patch)});await refresh();if(success)notify(success)}catch(e){notify((e as Error).message)}finally{setBusy(false)}
 }
 async function prepareImage(file:File):Promise<Blob>{
  if(!file.type.startsWith('image/'))throw new Error('Choose a JPG, PNG, WebP, GIF or AVIF photo.');
  if(file.size>35*1024*1024)throw new Error(`${file.name} is too large. Choose a photo under 35 MB.`);
  let bitmap:ImageBitmap;try{bitmap=await createImageBitmap(file)}catch{throw new Error(`We couldn’t read ${file.name}. Try a JPG, PNG or WebP photo.`)}
  const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const context=canvas.getContext('2d');if(!context){bitmap.close();throw new Error('Your browser couldn’t prepare this photo.')}
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Couldn’t prepare this photo.')),'image/webp',.88));
 }
 async function uploadFiles(files:FileList|File[]){
  if(!selected||!files.length)return;if(!signedIn){window.location.href='/signin-with-chatgpt?return_to=/';return}
  const id=selected;let count=0;const all=Array.from(files);if(all.length>30){notify('Please upload up to 30 photos at a time.');return}
  setBusy(true);for(let i=0;i<all.length;i++){setUploading(`Saving photo ${i+1} of ${all.length}…`);try{const blob=await prepareImage(all[i]);const body=new FormData();body.set('countryId',id);body.set('photo',blob,'memory.webp');await api('/api/photos',{method:'POST',body});count++}catch(e){notify((e as Error).message);break}}
  await refresh();setUploading('');setBusy(false);if(count)notify(`${count} ${count===1?'photo':'photos'} added.`);if(fileInput.current)fileInput.current.value='';
 }
 async function removePhoto(){if(!deleteId)return;setBusy(true);try{await api(photoUrl(deleteId),{method:'DELETE'});setDeleteId(null);setLightbox(null);await refresh();notify('Photo removed.')}catch(e){notify((e as Error).message)}finally{setBusy(false)}}
 const searchResults=countries.filter(c=>!query||`${c.name} ${c.code}`.toLowerCase().includes(query.toLowerCase()));
 const matching=countries.filter(c=>filter==='all'||(filter==='visited'?visitedIds.has(c.id):!visitedIds.has(c.id)));
 const galleryCountries=matching.filter(c=>visitedIds.has(c.id)||withPhotos.has(c.id));
 const albumForLightbox=lightbox?data.photos.filter(p=>p.countryId===lightbox.countryId):[];
 const lightboxIndex=lightbox?albumForLightbox.findIndex(p=>p.id===lightbox.id):-1;
 const closeCountry=()=>{if(!busy)setSelected(null)};
 return <main className="map-app" aria-label="Your travel map">
  <div ref={stage} className="map-canvas">
   <svg ref={svg} className="world-map" viewBox={`${mapBox.x} ${mapBox.y} ${mapBox.width} ${mapBox.height}`} role="group" aria-label="World map. Click a country to mark it visited or add photos."
    onPointerDown={e=>{if(e.button!==0)return;drag.current={x:e.clientX,y:e.clientY,ox:zoom.x,oy:zoom.y,id:e.pointerId};dragged.current=false;setFinder(false)}}
    onPointerMove={e=>{if(!drag.current)return;const dx=e.clientX-drag.current.x,dy=e.clientY-drag.current.y;if(Math.abs(dx)+Math.abs(dy)>5){dragged.current=true;e.currentTarget.setPointerCapture(e.pointerId);setHover(null);const rect=e.currentTarget.getBoundingClientRect(),{ox,oy}=drag.current;setZoom(z=>clampZoom(z.k,ox+dx/rect.width*mapBox.width,oy+dy/rect.height*mapBox.height))}}}
    onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);drag.current=null}}
    onPointerCancel={()=>{drag.current=null}} onMouseLeave={()=>setHover(null)}>
    <defs>{data.visits.filter(v=>v.coverId).map(v=>{const c=byId[v.countryId];if(!c)return null;const [x1,y1,x2,y2]=c.bounds;return <pattern key={v.countryId} id={`cover-${v.countryId}`} patternUnits="userSpaceOnUse" x={x1} y={y1} width={Math.max(x2-x1,1)} height={Math.max(y2-y1,1)}><image href={photoUrl(v.coverId!)} width={Math.max(x2-x1,1)} height={Math.max(y2-y1,1)} preserveAspectRatio="xMidYMid slice"/></pattern>})}</defs>
    <g transform={`translate(${zoom.x} ${zoom.y}) scale(${zoom.k})`}>{countries.map(c=>{const v=visits[c.id],hasCover=!!(v?.visited&&v.coverId),dim=filter==='visited'?!v?.visited:filter==='unvisited'?!!v?.visited:false;return <path key={c.id} d={c.path} data-country={c.id} style={{fill:hasCover?`url(#cover-${c.id})`:undefined}} className={`country ${v?.visited?'visited':''} ${hasCover?'has-photo':''} ${dim?'dimmed':''} ${selected===c.id?'is-selected':''}`} vectorEffect="non-scaling-stroke" role="button" tabIndex={-1} aria-label={`${c.name}${v?.visited?', visited':''}`} onClick={()=>{if(!dragged.current)openCountry(c.id)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCountry(c.id)}}} onMouseMove={e=>{if(!drag.current)setHover({id:c.id,x:e.clientX,y:e.clientY})}}/>})}</g>
   </svg>
  </div>
  <div className="search-dock" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setFinder(false)}}>
   <div className="search-field"><Search size={19}/><input ref={searchInput} aria-label="Search countries" placeholder="Search countries" value={query} onFocus={()=>{if(suppressSearchFocus.current){suppressSearchFocus.current=false;return}setFinder(true)}} onChange={e=>{setQuery(e.target.value);setFinder(true)}} onKeyDown={e=>{if(e.key==='Enter'&&searchResults.length)openCountry(searchResults[0].id)}}/>{query?<button className="icon-button" aria-label="Clear search" onClick={()=>setQuery('')}><X size={17}/></button>:<Globe2 size={18} className="search-globe"/>}</div>
   {finder&&<div className="search-results" aria-label="Country search results">{searchResults.length?searchResults.map(c=><button key={c.id} onMouseDown={e=>e.preventDefault()} onClick={()=>openCountry(c.id)}><span className="country-flag">{flag(c.code)}</span><span>{c.name}</span>{visitedIds.has(c.id)&&<Check size={16}/>}</button>):<p>No countries found</p>}</div>}
  </div>
  <div className="top-controls"><div className="map-filters" aria-label="Filter countries">{([['all','All'],['visited','Visited'],['unvisited','Not visited']] as [Filter,string][]).map(([key,label])=><button key={key} aria-pressed={filter===key} className={filter===key?'active':''} onClick={()=>{setFilter(key);setFinder(false)}}>{label}</button>)}</div><button className="floating-button albums-button" title="Photo albums" aria-label="Photo albums" disabled={busy} onClick={()=>{setSelected(null);setView('albums');setFinder(false)}}><Images size={19}/></button></div>
  {loadError&&<div className="map-status error" role="alert"><span>{loadError}</span><button onClick={()=>{setLoading(true);refresh()}}>Retry</button></div>}
  {!signedIn&&<a className="signin-link" href="/signin-with-chatgpt?return_to=/" target="_top">Sign in to save</a>}
  <div className="map-meta"><span className="visited-count">{loading?<LoaderCircle size={13} className="spinning"/>:<span className="visited-dot"/>}{visited.length} visited</span><a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a></div>
  {!selected&&<div className="map-hint">Click a country</div>}
  <div className="map-zoom" aria-label="Map controls"><button title="Zoom in" aria-label="Zoom in" disabled={zoom.k>=14} onClick={()=>changeZoom(1.5)}><Plus size={20}/></button><button title="Zoom out" aria-label="Zoom out" disabled={zoom.k<=minZoom} onClick={()=>changeZoom(1/1.5)}><Minus size={20}/></button><span/><button title="Show whole world" aria-label="Show whole world" onClick={fitWorld}><Maximize size={18}/></button></div>
  {hover&&!selected&&!finder&&view==='map'&&<div className="map-tooltip" style={{left:Math.min(hover.x+14,typeof window!=='undefined'?window.innerWidth-180:hover.x),top:Math.min(hover.y+16,typeof window!=='undefined'?window.innerHeight-58:hover.y)}}>{flag(byId[hover.id].code)} {byId[hover.id].name}{visitedIds.has(hover.id)&&<Check size={13}/>}</div>}
  {view==='albums'&&<Modal label="Photo albums" onClose={()=>setView('map')} className="albums-modal"><div className="modal-heading"><h2>Albums</h2><button className="icon-button" aria-label="Close albums" onClick={()=>setView('map')}><X size={21}/></button></div>{galleryCountries.length?<div className="album-grid">{galleryCountries.map(c=><button className="album-card" key={c.id} onClick={()=>openCountry(c.id)}><div className="album-cover"><CountryShape country={c} cover={visits[c.id]?.coverId} className="album-silhouette"/></div><div className="album-text"><strong>{c.name}</strong><span>{data.photos.filter(p=>p.countryId===c.id).length} photos</span></div></button>)}</div>:<div className="album-empty"><Images size={32} strokeWidth={1.3}/><p>No albums yet</p><button className="button primary" onClick={()=>{setView('map');setFinder(true)}}>Choose a country</button></div>}</Modal>}
  {selectedCountry&&<Modal label={`${selectedCountry.name} travel album`} onClose={closeCountry} className="country-modal"><div className="country-panel"><header className="country-header"><div><span className="country-region">{selectedCountry.continent}</span><h2><span>{flag(selectedCountry.code)}</span>{selectedCountry.name}</h2></div><button className="icon-button" disabled={busy} aria-label="Close country album" onClick={closeCountry}><X size={21}/></button></header>
   <button aria-pressed={!!selectedVisit?.visited} className={`visit-toggle ${selectedVisit?.visited?'is-visited':''}`} disabled={busy||loading||!!loadError} onClick={()=>changeCountry(selectedCountry.id,{visited:!selectedVisit?.visited},selectedVisit?.visited?'Marked not visited.':'Marked visited.')}><span>{selectedVisit?.visited?<Check size={18}/>:<Plus size={18}/>}Visited</span>{busy&&!uploading?<LoaderCircle size={18} className="spinning"/>:<span className="toggle-track"><span/></span>}</button>
   <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="sr-only" aria-label="Upload photos" onChange={e=>e.target.files&&uploadFiles(e.target.files)}/>
   <div className="photos-heading"><h3>Photos <span>{selectedPhotos.length}</span></h3><button className="button primary upload-button" disabled={busy||loading||!!loadError} onClick={()=>fileInput.current?.click()}>{uploading?<LoaderCircle size={16} className="spinning"/>:<Plus size={17}/>} {uploading?'Uploading…':'Add photos'}</button></div>
   <div className={`photo-drop-area ${selectedPhotos.length?'has-photos':''}`} onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add('drag-over')}} onDragLeave={e=>e.currentTarget.classList.remove('drag-over')} onDrop={e=>{e.preventDefault();e.currentTarget.classList.remove('drag-over');if(!busy)uploadFiles(e.dataTransfer.files)}}>
    {selectedPhotos.length?<div className="photo-grid">{selectedPhotos.map(p=><button key={p.id} className="photo-thumb" aria-label={p.caption||`Open photo from ${selectedCountry.name}`} onClick={()=>setLightbox(p)}><img src={photoUrl(p.id)} alt={p.caption||`Photo from ${selectedCountry.name}`} loading="lazy"/>{selectedVisit?.coverId===p.id&&<span className="cover-badge"><Star size={11} fill="currentColor"/> Cover</span>}</button>)}</div>:<button className="empty-photos" disabled={busy||loading||!!loadError} onClick={()=>fileInput.current?.click()}><Camera size={25} strokeWidth={1.3}/><span>{uploading||'Add photos, or just mark visited'}</span></button>}
   </div>
   <details className="country-details"><summary>Details</summary><div className="visit-date"><label htmlFor="visit-date"><CalendarDays size={15}/> Visit date</label><input type="date" id="visit-date" value={date} disabled={busy} onChange={e=>{setDate(e.target.value);changeCountry(selectedCountry.id,{visitDate:e.target.value||null})}}/></div><div className="travel-note"><label htmlFor="travel-note">Notes</label><textarea id="travel-note" maxLength={4000} placeholder="Add a note…" value={note} onChange={e=>setNote(e.target.value)} rows={3}/>{note!==(selectedVisit?.note||'')&&<button className="button" disabled={busy} onClick={()=>changeCountry(selectedCountry.id,{note},'Note saved.')}><Check size={14}/>Save</button>}</div></details>
  </div></Modal>}
  {lightbox&&<Modal label="Photo viewer" className="lightbox-modal" onClose={()=>setLightbox(null)}><div className="lightbox-top"><div><span className="eyebrow small">{byId[lightbox.countryId].name}</span><span>{lightboxIndex+1} / {albumForLightbox.length}</span></div><button className="icon-button" aria-label="Close photo" onClick={()=>setLightbox(null)}><X size={22}/></button></div><div className="lightbox-image"><img src={photoUrl(lightbox.id)} alt={lightbox.caption||`Memory from ${byId[lightbox.countryId].name}`}/>{albumForLightbox.length>1&&<><button className="lightbox-prev" aria-label="Previous photo" onClick={()=>setLightbox(albumForLightbox[(lightboxIndex-1+albumForLightbox.length)%albumForLightbox.length])}><ChevronLeft size={24}/></button><button className="lightbox-next" aria-label="Next photo" onClick={()=>setLightbox(albumForLightbox[(lightboxIndex+1)%albumForLightbox.length])}><ChevronRight size={24}/></button></>}</div><div className="lightbox-info"><CaptionEditor key={lightbox.id} photo={lightbox} onSave={async caption=>{await api(photoUrl(lightbox.id),{method:'PATCH',body:JSON.stringify({caption})});setLightbox({...lightbox,caption});await refresh();notify('Caption saved.')}}/><div className="lightbox-actions"><button className="button primary" disabled={busy||visits[lightbox.countryId]?.coverId===lightbox.id} onClick={()=>changeCountry(lightbox.countryId,{coverId:lightbox.id},'Cover updated.')}><Star size={15}/>{visits[lightbox.countryId]?.coverId===lightbox.id?'Map photo':'Use on map'}</button><a className="icon-button" href={photoUrl(lightbox.id)} download={`elsewhere-${byId[lightbox.countryId].name}.webp`} aria-label="Download photo" title="Download photo"><Download size={18}/></a><button className="icon-button danger" aria-label="Delete photo" title="Delete photo" onClick={()=>setDeleteId(lightbox.id)}><Trash2 size={18}/></button></div></div></Modal>}
  {deleteId&&<Modal label="Delete photo" onClose={()=>!busy&&setDeleteId(null)} className="confirm-modal"><Trash2 size={28} strokeWidth={1.3}/><h2>Delete photo?</h2><p>This removes the photo from this album.</p><div><button className="button" disabled={busy} onClick={()=>setDeleteId(null)}>Cancel</button><button className="button danger-button" disabled={busy} onClick={removePhoto}>{busy?'Removing…':'Delete photo'}</button></div></Modal>}
  {notice&&<div className="toast" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={()=>setNotice('')}><X size={15}/></button></div>}
 </main>
}
function CaptionEditor({photo,onSave}:{photo:Photo;onSave:(caption:string)=>Promise<void>}){const [caption,setCaption]=useState(photo.caption);const [saving,setSaving]=useState(false);const [error,setError]=useState('');return <div className="caption-editor"><input aria-label="Photo caption" maxLength={500} placeholder="Add a caption…" value={caption} onChange={e=>setCaption(e.target.value)}/>{caption!==photo.caption&&<button className="text-button" disabled={saving} onClick={async()=>{setSaving(true);setError('');try{await onSave(caption)}catch(e){setError((e as Error).message)}finally{setSaving(false)}}}>{saving?'Saving…':'Save caption'}</button>}{error&&<small role="alert">{error}</small>}</div>}
