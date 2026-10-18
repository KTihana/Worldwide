import type {ReactNode} from 'react';
import {Globe2} from 'lucide-react';

/** A local map, shared by account setup and phone connection screens. */
export function AccountFrame({children,className='',cardClassName='',compact=false}:{children:ReactNode;className?:string;cardClassName?:string;compact?:boolean}){
 return <main className={`account-screen account-welcome ${className}`}>
  <div className={`account-shell ${compact?'account-shell-compact':''}`}>
   <aside className="account-map-panel" aria-label="Worldwide, your private travel album">
    <div className="account-brand"><Globe2 size={26} strokeWidth={1.7}/><span>Worldwide</span></div>
    <div className="account-map-art" aria-hidden="true"><img src="/basemaps/world-natural-earth.webp" alt="" draggable={false}/></div>
   </aside>
   <div className={`account-card ${cardClassName}`}>{children}</div>
  </div>
 </main>;
}
