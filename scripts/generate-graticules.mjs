import {readFileSync,writeFileSync} from 'node:fs';
import {geoEqualEarth,geoNaturalEarth1,geoMercator,geoEquirectangular,geoPath,geoGraticule} from 'd3-geo';
import {geoRobinson,geoWinkel3,geoMollweide,geoCylindricalEqualArea,geoSinusoidal,geoEckert4,geoInterruptedHomolosine} from 'd3-geo-projection';
const collection=JSON.parse(readFileSync(new URL('./countries-source.geojson',import.meta.url),'utf8'));
const definitions=[['equal-earth',geoEqualEarth],['natural-earth',geoNaturalEarth1],['robinson',geoRobinson],['winkel-tripel',geoWinkel3],['mercator',geoMercator],['equirectangular',geoEquirectangular],['mollweide',geoMollweide],['gall-peters',()=>geoCylindricalEqualArea().parallel(45)],['sinusoidal',geoSinusoidal],['eckert-iv',geoEckert4],['goode',geoInterruptedHomolosine]];
const paths={};
for(const [id,create] of definitions){const path=geoPath(create().fitExtent([[24,14],[1176,565]],collection)).digits(1);paths[id]=path(geoGraticule().step([30,30])())}
writeFileSync(new URL('../app/data/graticules.json',import.meta.url),JSON.stringify(paths));
