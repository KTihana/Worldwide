import fs from 'node:fs';
import {geoEqualEarth,geoNaturalEarth1,geoMercator,geoEquirectangular,geoPath} from 'd3-geo';
import {geoRobinson,geoWinkel3,geoMollweide,geoCylindricalEqualArea,geoSinusoidal,geoEckert4,geoInterruptedHomolosine} from 'd3-geo-projection';
const features=JSON.parse(fs.readFileSync(new URL('./countries-source.geojson',import.meta.url))).features;
const feature=features.find(f=>f.properties.ADM0_A3==='ATA');
// Pole-closing segments are a flat-map construction, not Antarctica's coastline.
const coordinates=[];
for(const ring of feature.geometry.coordinates.flat()){let line=[];for(const point of ring){if(point[1]<=-89.999){if(line.length>1)coordinates.push(line);line=[]}else line.push(point)}if(line.length>1)coordinates.push(line)}
const coast={type:'MultiLineString',coordinates};
const definitions=[['equal-earth',geoEqualEarth],['natural-earth',geoNaturalEarth1],['robinson',geoRobinson],['winkel-tripel',geoWinkel3],['mercator',geoMercator],['equirectangular',geoEquirectangular],['mollweide',geoMollweide],['gall-peters',()=>geoCylindricalEqualArea().parallel(45)],['sinusoidal',geoSinusoidal],['eckert-iv',geoEckert4],['goode',geoInterruptedHomolosine]];
for(const [id,create] of definitions){const file=new URL(`../app/data/projections/${id}.json`,import.meta.url),data=JSON.parse(fs.readFileSync(file));const projection=create().fitExtent([[24,14],[1176,565]],{type:'FeatureCollection',features});data.ATA.outline=geoPath(projection).digits(3)(coast);fs.writeFileSync(file,JSON.stringify(data))}
