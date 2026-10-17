export function terrainUrl(scope:string,style:string){
 const key=scope.startsWith('country:')?`country-${scope.slice(8)}`:scope==='World'?`world-${style}`:`region-${scope.replaceAll(' ','-')}`;
 return `/terrain/${key}.webp`;
}
export function TerrainPattern({id,url}:{id:string;url:string}){
 return <pattern id={id} patternUnits="userSpaceOnUse" x={0} y={0} width={1200} height={590} viewBox="0 0 1200 590"><rect width={1200} height={590} fill="#b7cfa4"/><image href={url} width={1200} height={590} preserveAspectRatio="none"/></pattern>
}
