import fs from 'node:fs';
import assert from 'node:assert/strict';
import {geoPath} from 'd3-geo';
import {topology} from 'topojson-server';
import {feature} from 'topojson-client';
import {presimplify,simplify} from 'topojson-simplify';

const source=JSON.parse(fs.readFileSync(new URL('../app/data/focus.json',import.meta.url))).details;
const countries=JSON.parse(fs.readFileSync(new URL('../app/data/countries.json',import.meta.url)));
const output={};
const signedArea=ring=>ring.reduce((area,p,index)=>{
 const next=ring[(index+1)%ring.length];
 return area+p[0]*next[1]-next[0]*p[1];
},0)/2;
const parseRings=path=>Array.from(path.matchAll(/M([^M]+)/g),match=>{
 const ring=Array.from(match[1].matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g),point=>[+point[1],+point[2]]);
 if(ring.length&&ring[0].some((value,index)=>value!==ring.at(-1)[index]))ring.push([...ring[0]]);
 return ring;
}).filter(ring=>ring.length>=4);
const validBounds=bounds=>Array.isArray(bounds)&&bounds.length===4&&bounds.every(Number.isFinite)&&bounds[2]>bounds[0]&&bounds[3]>bounds[1];

for(const {id} of countries){
 const shape=source[id];
 assert(shape,`Missing country geometry: ${id}`);
 assert(validBounds(shape.bounds)&&validBounds(shape.focusBounds),`Invalid bounds: ${id}`);
 assert(!/[^MLZ\d.,\-]/.test(shape.path),`Unexpected path command: ${id}`);
 const rings=parseRings(shape.path);
 assert(rings.length,`Empty country geometry: ${id}`);
 const bounds=shape.focusBounds;
 const unit=Math.max(bounds[2]-bounds[0],bounds[3]-bounds[1])/180;
 const visible=rings.filter(ring=>Math.abs(signedArea(ring))>=.5*unit*unit);
 const retained=visible.length?visible:rings;
 // Keep the original crop coordinates; simplify only what a 180px thumbnail can show.
 const weighted=presimplify(topology({country:{type:'MultiPolygon',coordinates:retained.map(ring=>[ring])}}));
 const simplified=simplify(weighted,2*unit*unit);
 const geometry=feature(simplified,simplified.objects.country);
 // SVG's nonzero fill preserves holes through their original ring winding.
 geometry.geometry.coordinates.forEach((polygon,index)=>{
  const ring=polygon[0],original=retained[index];
  if(ring.length<4||Math.sign(signedArea(ring))!==Math.sign(signedArea(original)))polygon[0]=original;
 });
 const integerPath=geoPath(null).digits(0),precisePath=geoPath(null).digits(2);
 let path=geometry.geometry.coordinates.map(polygon=>{
  const part={type:'Polygon',coordinates:polygon};
  const compact=integerPath(part),rounded=parseRings(compact)[0];
  return rounded&&Math.sign(signedArea(rounded))===Math.sign(signedArea(polygon[0]))?compact:precisePath(part);
 }).join('');
 if(!path||!parseRings(path).some(ring=>Math.abs(signedArea(ring))>0))path=shape.path;
 output[id]={path,bounds:shape.bounds};
 if(shape.focusBounds.some((value,index)=>value!==shape.bounds[index]))output[id].focusBounds=shape.focusBounds;
 assert(parseRings(path).length,`Empty thumbnail: ${id}`);
}
assert.equal(Object.keys(output).length,countries.length);
const json=JSON.stringify(output);
assert(Buffer.byteLength(json)<300_000,`Country thumbnails exceed 300 KB (${Buffer.byteLength(json)} bytes)`);
fs.writeFileSync(new URL('../app/data/country-thumbnails.json',import.meta.url),json);
console.log(`Generated ${countries.length} country thumbnails (${Buffer.byteLength(json).toLocaleString('en-US')} bytes).`);
