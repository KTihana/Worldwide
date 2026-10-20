import {useEffect,useRef,useState} from 'react';
import {ChevronDown,Globe2,Search} from 'lucide-react';
import countries from './data/countries.json';
import {isPhoneScreen} from './orientation';
export function RegionPicker({value,regions,onRegion,onCountry}:{value:string;regions:readonly string[];onRegion:(name:string)=>void;onCountry:(id:string)=>void}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[browseOnly,setBrowseOnly]=useState(isPhoneScreen);const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[open]);
 const matches=(name:string)=>name.toLowerCase().includes(query.toLowerCase());
 return <div ref={root} onKeyDown={e=>{if(e.key==='Escape'&&open){e.stopPropagation();setOpen(false);root.current?.querySelector('button')?.focus()}}}><button className="region-selector" aria-label="Choose continent or country" aria-expanded={open} aria-controls="region-menu" onClick={()=>{setBrowseOnly(isPhoneScreen());setOpen(v=>!v);setQuery('')}}><Globe2 size={16}/><span>{value}</span><ChevronDown size={14}/></button>{open&&<div id="region-menu" className="region-menu">{!browseOnly&&<label className="region-search"><Search size={16}/><input autoFocus aria-label="Find continent or country" placeholder="Find a place" value={query} onChange={e=>setQuery(e.target.value)}/></label>}<div className="region-options">{['World',...regions].filter(matches).map(name=><button key={name} aria-current={name===value?'true':undefined} onClick={()=>{setOpen(false);onRegion(name)}}>{name}</button>)}<span className="region-section">Countries</span>{countries.filter(c=>matches(c.name)).map(c=><button key={c.id} onClick={()=>{setOpen(false);onCountry(c.id)}}>{c.name}</button>)}</div></div>}</div>
}
