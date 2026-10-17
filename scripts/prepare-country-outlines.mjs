import fs from 'node:fs';
import {geoArea} from 'd3-geo';
import {topology} from 'topojson-server';
import {feature} from 'topojson-client';
import {presimplify,simplify,quantile} from 'topojson-simplify';
const source=JSON.parse(fs.readFileSync(new URL('./countries-detail-source.geojson',import.meta.url)));
const count=c=>typeof c[0]==='number'?1:c.reduce((n,v)=>n+count(v),0);
const weighted=presimplify(topology({countries:source}));
const threshold=quantile(weighted,.2);
// Retain tiny countries and islands. Shared arcs are simplified only once,
// so neighbouring countries keep the same border without seams.
const protect=arcs=>{for(const value of arcs)if(Array.isArray(value))protect(value);else for(const point of weighted.arcs[value<0?~value:value])point[2]=Infinity};
for(let i=0;i<source.features.length;i++)if(count(source.features[i].geometry.coordinates)<500)protect(weighted.objects.countries.geometries[i].arcs);
for(const arc of weighted.arcs){
 if(arc.length<=12){for(const point of arc)point[2]=Infinity;continue}
 const important=arc.slice(1,-1).sort((a,b)=>b[2]-a[2]).slice(0,2);for(const point of important)point[2]=Infinity;
}
let overview=feature(simplify(weighted,threshold),weighted.objects.countries);
// A highly concave island can invert when reduced to a triangle. Restore
// its original shared arcs rather than drawing the rest of the globe as land.
const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
for(let i=0;i<overview.features.length;i++){
 const original=polygons(source.features[i].geometry),reduced=polygons(overview.features[i].geometry),object=weighted.objects.countries.geometries[i],arcs=object.type==='Polygon'?[object.arcs]:object.arcs;
 for(let p=0;p<reduced.length;p++)for(let r=0;r<reduced[p].length;r++){
  const area=ring=>geoArea({type:'Polygon',coordinates:[ring]}),a=area(original[p][r]),b=area(reduced[p][r]);
  if((a>2*Math.PI)!==(b>2*Math.PI)||b===0)protect(arcs[p][r]);
 }
}
overview=feature(simplify(weighted,threshold),weighted.objects.countries);
fs.writeFileSync(new URL('./countries-source.geojson',import.meta.url),JSON.stringify(overview));
console.log(`Prepared ${overview.features.length} countries: ${source.features.reduce((n,f)=>n+count(f.geometry.coordinates),0)} detail vertices; ${overview.features.reduce((n,f)=>n+count(f.geometry.coordinates),0)} overview vertices.`);
