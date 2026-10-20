export function terrainUrl(scope:string,style:string){
 const key=scope.startsWith('country:')?`country-${scope.slice(8)}`:scope==='World'?`world-${style}`:`region-${scope.replaceAll(' ','-')}`;
 return `/terrain/${key}.webp`;
}
export function TerrainPattern({id,url,muted=false}:{id:string;url:string;muted?:boolean}){
 return <pattern id={id} patternUnits="userSpaceOnUse" x={0} y={0} width={1200} height={590} viewBox="0 0 1200 590"><rect width={1200} height={590} fill="#b7cfa4"/><image style={muted?{filter:'saturate(.74) brightness(1.025)'}:undefined} href={url} width={1200} height={590} preserveAspectRatio="none"/></pattern>
}
