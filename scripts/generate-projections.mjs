import {renderTerrain} from './terrain-raster.mjs';
import {countryBoundary} from './country-boundary.mjs';
import fs from 'node:fs';
import {geoEqualEarth,geoNaturalEarth1,geoMercator,geoEquirectangular,geoPath} from 'd3-geo';
import {geoRobinson,geoWinkel3,geoMollweide,geoCylindricalEqualArea,geoSinusoidal,geoEckert4,geoInterruptedHomolosine} from 'd3-geo-projection';
const features=JSON.parse(fs.readFileSync(new URL('./countries-source.geojson',import.meta.url))).features;
const collection={type:'FeatureCollection',features};
const definitions=[['equal-earth','Equal Earth',geoEqualEarth],['natural-earth','Natural Earth',geoNaturalEarth1],['robinson','Robinson',geoRobinson],['winkel-tripel','Winkel Tripel',geoWinkel3],['mercator','Mercator',geoMercator],['equirectangular','Equirectangular',geoEquirectangular],['mollweide','Mollweide',geoMollweide],['gall-peters','Gall–Peters',()=>geoCylindricalEqualArea().parallel(45)],['sinusoidal','Sinusoidal',geoSinusoidal],['eckert-iv','Eckert IV',geoEckert4],['goode','Goode Homolosine',geoInterruptedHomolosine]];
const dir=new URL('../app/data/projections/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
function compactPreview(path){return path.replace(/M([^M]+)/g,(_,ring)=>{const points=Array.from(ring.matchAll(/(-?\d+),(-?\d+)/g),m=>[+m[1],+m[2]]),out=[];for(const p of points){const b=out.at(-1);if(b&&b[0]===p[0]&&b[1]===p[1])continue;while(out.length>=2){const a=out.at(-2),b=out.at(-1);if((b[0]-a[0])*(p[1]-b[1])!==(b[1]-a[1])*(p[0]-b[0])||(b[0]-a[0])*(p[0]-b[0])+(b[1]-a[1])*(p[1]-b[1])<0)break;out.pop()}out.push(p)}return out.length>=3?'M'+out.map(p=>p.join(',')).join('L')+'Z':''})}
const catalog=[];
for(const [id,name,create] of definitions){
 const projection=create().fitExtent([[24,14],[1176,565]],collection);
 await renderTerrain(projection,`world-${id}`,1800);
 const path=geoPath(projection).digits(3),shapes={};
 for(const feature of features){const bounds=path.bounds(feature).flat();const d=path(feature);if(d&&bounds.every(Number.isFinite))shapes[feature.properties.ADM0_A3]={path:d,outline:path(countryBoundary(feature)),bounds:bounds.map(n=>+n.toFixed(3))};}
 fs.writeFileSync(new URL(`${id}.json`,dir),JSON.stringify(shapes));
 projection.fitExtent([[4,4],[176,86]],collection);
 catalog.push({id,name,preview:compactPreview(geoPath(projection).digits(0)(collection))});
}
fs.writeFileSync(new URL('../app/data/map-styles.json',import.meta.url),JSON.stringify(catalog));
console.log(`Generated ${catalog.length} local map projections.`);
