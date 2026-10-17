import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {geoNaturalEarth1} from 'd3-geo';
const root=new URL('../',import.meta.url),read=name=>JSON.parse(fs.readFileSync(new URL(`app/data/${name}.json`,root)));
const world=read('world'),styles=read('map-styles'),focus=read('focus');
for(const name of [...styles.map(s=>`world-${s.id}`),...Object.keys(focus.regions).map(s=>`region-${s.replaceAll(' ','-')}`),...world.countries.map(c=>`country-${c.id}`)])assert.ok(fs.statSync(new URL(`public/terrain/${name}.webp`,root)).size>32,`${name}: local terrain asset exists`);
const features=JSON.parse(fs.readFileSync(new URL('scripts/countries-source.geojson',root)));
const projection=geoNaturalEarth1().fitExtent([[24,14],[1176,565]],features);
const {data,info}=await sharp(fileURLToPath(new URL('public/terrain/world-natural-earth.webp',root))).raw().toBuffer({resolveWithObject:true});
const colours=new Set();for(let i=0;i<data.length;i+=info.channels)colours.add(`${data[i]},${data[i+1]},${data[i+2]}`);assert.ok(colours.size<=4,'Terrain uses a simple flat palette without relief texture');
function sample(point){const [x,y]=projection(point),offset=(Math.floor(y/590*info.height)*info.width+Math.floor(x/1200*info.width))*info.channels;return Array.from(data.subarray(offset,offset+3))}
const amazon=sample([-64,-5]),sahara=sample([20,24]),ice=sample([-42,75]);
assert.ok(amazon[1]>amazon[0]+8,'Amazon vegetation stays green');
assert.ok(sahara[0]>sahara[2]+15,'Sahara stays sandy rather than green');
assert.ok(ice.every(c=>c>200),'Greenland ice stays light');
console.log('PASS: all projections, continents and countries have local terrain; geographic green/desert/ice colour samples align.');
