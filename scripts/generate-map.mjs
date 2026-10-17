import {countryBoundary} from './country-boundary.mjs';
import fs from 'node:fs';
import {geoEqualEarth, geoPath, geoGraticule10} from 'd3-geo';
const raw=JSON.parse(fs.readFileSync(new URL('./countries-source.geojson',import.meta.url)));
const features=raw.features;
const projection=geoEqualEarth().fitExtent([[24,14],[1176,565]], {type:'FeatureCollection',features});
const path=geoPath(projection).digits(3);
const countries=features.map(f=>{
 const p=f.properties, bounds=path.bounds(f);
 const code=/^[A-Z]{2}$/.test(p.ISO_A2_EH)?p.ISO_A2_EH:'';
 const aliases={'United States of America':'United States','United Republic of Tanzania':'Tanzania','Republic of Serbia':'Serbia','Czechia':'Czech Republic','Democratic Republic of the Congo':'DR Congo'};
 return {id:p.ADM0_A3,name:aliases[p.ADMIN]||p.ADMIN,code,continent:p.CONTINENT==='Seven seas (open ocean)'?(p.REGION_UN==='Americas'?'South America':p.REGION_UN):p.CONTINENT,path:path(f),outline:path(countryBoundary(f)),bounds:bounds.flat().map(n=>+n.toFixed(3)),center:projection([p.LABEL_X,p.LABEL_Y]).map(n=>+n.toFixed(3))};
}).sort((a,b)=>a.name.localeCompare(b.name));
fs.writeFileSync(new URL('../app/data/world.json',import.meta.url),JSON.stringify({countries,graticule:path(geoGraticule10())}));
fs.writeFileSync(new URL('../app/data/countries.json',import.meta.url),JSON.stringify(countries.map(({path,outline,bounds,center,...c})=>c)));
console.log(`Generated ${countries.length} country and territory outlines.`);
