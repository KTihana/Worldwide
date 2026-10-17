import {renderTerrain} from './terrain-raster.mjs';
import {countryBoundary} from './country-boundary.mjs';
import fs from 'node:fs';
import {geoEqualEarth,geoAzimuthalEqualArea,geoPath,geoCentroid,geoArea} from 'd3-geo';
const features=JSON.parse(fs.readFileSync(new URL('./countries-source.geojson',import.meta.url))).features;
const detailedFeatures=JSON.parse(fs.readFileSync(new URL('./countries-detail-source.geojson',import.meta.url))).features;
const overviewById=new Map(features.map(f=>[f.properties.ADM0_A3,f]));
const detailDirectory=new URL('../public/geography/',import.meta.url);fs.mkdirSync(detailDirectory,{recursive:true});
const metadata=JSON.parse(fs.readFileSync(new URL('../app/data/countries.json',import.meta.url)));
const metadataById=Object.fromEntries(metadata.map(c=>[c.id,c]));
const definitions={
 Europe:{center:15,lon:[-26,52],lat:[33,82]},
 Asia:{center:100,lon:[25,180],lat:[-12,82]},
 Africa:{center:25,lon:[-27,80],lat:[-56,38]},
 'North America':{center:-110,lon:[-171,-50],lat:[5,84]},
 'South America':{center:-60,lon:[-92,-28],lat:[-61,14]},
 Oceania:{center:170,lon:[110,235],lat:[-54,26]},
 Antarctica:{polar:true},
};
const shared={RUS:['Europe','Asia'],TUR:['Europe','Asia'],KAZ:['Europe','Asia'],GEO:['Europe','Asia'],AZE:['Europe','Asia'],EGY:['Africa','Asia'],IDN:['Asia','Oceania']};
const rounded=b=>b.flat().map(n=>+n.toFixed(3));
const regions={};
for(const [name,definition] of Object.entries(definitions)){
 if(definition.polar){const feature=features.find(f=>f.properties.ADM0_A3==='ATA');const projection=geoAzimuthalEqualArea().rotate([0,90]).fitExtent([[70,30],[1130,560]],feature);const path=geoPath(projection).digits(3);const bounds=rounded(path.bounds(feature));await renderTerrain(projection,`region-${name.replaceAll(' ','-')}`);regions[name]={bounds,shapes:{ATA:{path:path(feature),outline:path(countryBoundary(feature)),bounds}}};continue;}
 const projection=geoEqualEarth().rotate([-definition.center,0]).scale(1).translate([0,0]);
 const points=[];
 for(let lon=definition.lon[0];lon<=definition.lon[1];lon+=1)for(const lat of definition.lat)points.push(projection([lon,lat]));
 for(let lat=definition.lat[0];lat<=definition.lat[1];lat+=1)for(const lon of definition.lon)points.push(projection([lon,lat]));
 const x1=Math.min(...points.map(p=>p[0])),x2=Math.max(...points.map(p=>p[0])),y1=Math.min(...points.map(p=>p[1])),y2=Math.max(...points.map(p=>p[1]));
 const scale=Math.min(1080/(x2-x1),540/(y2-y1));
 const tx=600-(x1+x2)/2*scale,ty=295-(y1+y2)/2*scale;
 const clip=[[x1*scale+tx,y1*scale+ty],[x2*scale+tx,y2*scale+ty]];
 projection.scale(scale).translate([tx,ty]).clipExtent(clip);
 await renderTerrain(projection,`region-${name.replaceAll(' ','-')}`);
 const path=geoPath(projection).digits(3),shapes={};
 for(const f of features){const id=f.properties.ADM0_A3;if(!(shared[id]||[metadataById[id].continent]).includes(name))continue;const d=path(f);if(d){const bounds=path.bounds(f);if(bounds.flat().every(Number.isFinite))shapes[id]={path:d,outline:path(countryBoundary(f)),bounds:rounded(bounds)};}}
 const bounds=[Math.min(...Object.values(shapes).map(s=>s.bounds[0])),Math.min(...Object.values(shapes).map(s=>s.bounds[1])),Math.max(...Object.values(shapes).map(s=>s.bounds[2])),Math.max(...Object.values(shapes).map(s=>s.bounds[3]))];
 regions[name]={bounds:bounds.map(n=>+n.toFixed(3)),shapes};
}
const details={};
for(const source of detailedFeatures){
 const id=source.properties.ADM0_A3;let feature=source,preview=overviewById.get(id);
 // Metropolitan France is shown in its country close-up; all regions remain on the world map.
 if(id==='FRA'&&source.geometry.type==='MultiPolygon'){
  const coordinates=source.geometry.coordinates.filter(p=>{const [lon,lat]=geoCentroid({type:'Polygon',coordinates:p});return lon>=-12&&lon<=16&&lat>=35&&lat<=56});
  feature={...source,geometry:{type:'MultiPolygon',coordinates}};
  preview={...preview,geometry:{type:'MultiPolygon',coordinates:preview.geometry.coordinates.filter(p=>{const [lon,lat]=geoCentroid({type:'Polygon',coordinates:p});return lon>=-12&&lon<=16&&lat>=35&&lat<=56})}};
 }
 const projection=(id==='ATA'?geoAzimuthalEqualArea().rotate([0,90]):geoEqualEarth().rotate([-source.properties.LABEL_X,0])).fitExtent([[70,30],[1130,560]],feature);
 await renderTerrain(projection,`country-${id}`,900);
 const path=geoPath(projection).digits(3),bounds=rounded(path.bounds(feature));
 // Frame the polygons containing 99% of the land area. Tiny remote islands
 // remain in the paths and full bounds, but no longer shrink the main country.
 let focusBounds=bounds;
 if(feature.geometry.type==='MultiPolygon'){
  const polygons=feature.geometry.coordinates.map(coordinates=>({type:'Polygon',coordinates})).map(polygon=>({polygon,area:geoArea(polygon)})).sort((a,b)=>b.area-a.area);
  const total=polygons.reduce((sum,item)=>sum+item.area,0),main=[];let covered=0;
  for(const item of polygons){main.push(item.polygon);covered+=item.area;if(covered>=total*.99)break;}
  const candidate=rounded(path.bounds({type:'GeometryCollection',geometries:main}));
  if(candidate[2]-candidate[0]<(bounds[2]-bounds[0])*.9||candidate[3]-candidate[1]<(bounds[3]-bounds[1])*.9)focusBounds=candidate;
 }
 const detailed={path:path(feature),outline:path(countryBoundary(feature)),bounds,focusBounds};
 fs.writeFileSync(new URL(`${id}.json`,detailDirectory),JSON.stringify(detailed));
 details[id]={path:path(preview),outline:path(countryBoundary(preview)),bounds,focusBounds};
}
fs.writeFileSync(new URL('../app/data/focus.json',import.meta.url),JSON.stringify({regions,details}));
console.log(`Generated ${Object.keys(regions).length} continent views and ${Object.keys(details).length} country close-ups.`);
