import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Elsewhere — Your world, remembered',description:'Your own little corner of the world. Keep track of the countries you’ve visited and fill a world map with your travel photos.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
