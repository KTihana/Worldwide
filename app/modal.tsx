import {useEffect,useRef,type ReactNode} from 'react';

export function Modal({children,onClose,label,className='',modal=true}:{children:ReactNode;onClose:()=>void;label:string;className?:string;modal?:boolean}){
 const box=useRef<HTMLDivElement>(null);const closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{const previous=document.activeElement as HTMLElement;const old=document.body.style.overflow;document.body.style.overflow='hidden';
 const t=setTimeout(()=>box.current?.querySelector<HTMLElement>('[autofocus],input:not([disabled]),button:not([disabled]),a[href],textarea:not([disabled])')?.focus(),30);
 const key=(e:KeyboardEvent)=>{const dialogs=document.querySelectorAll('[role="dialog"]');if(dialogs[dialogs.length-1]!==box.current)return;if(e.key==='Escape'){e.stopPropagation();closeRef.current()}
 if(modal&&e.key==='Tab'){const els=Array.from(box.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]')||[]).filter(el=>el.getClientRects().length>0);const first=els[0],last=els[els.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};
 document.addEventListener('keydown',key);return()=>{clearTimeout(t);document.body.style.overflow=old;document.removeEventListener('keydown',key);previous?.focus()};},[modal]);
 return <div className={`modal-backdrop ${className}`} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div ref={box} role="dialog" aria-modal={modal} aria-label={label} className="modal-box">{children}</div></div>
}
