import assert from 'node:assert/strict';
import fs from 'node:fs';
import {geoArea} from 'd3-geo';
const read=path=>JSON.parse(fs.readFileSync(new URL('../'+path,import.meta.url)));
const source=read('scripts/countries-detail-source.geojson'),overview=read('scripts/countries-source.geojson'),catalog=read('app/data/countries.json'),focus=read('app/data/focus.json');
const points=c=>typeof c[0]==='number'?1:c.reduce((n,v)=>n+points(v),0);
assert.deepEqual(source.features.map(f=>f.properties.ADM0_A3).sort(),catalog.map(c=>c.id).sort(),'Country IDs are preserved so saved albums still match');
for(const feature of source.features){
 const id=feature.properties.ADM0_A3,detail=read(`public/geography/${id}.json`),small=overview.features.find(f=>f.properties.ADM0_A3===id);
 assert.ok(detail.path&&detail.outline&&!/[Zz]/.test(detail.outline),`${id}: detailed border only follows real edges`);
 assert.ok(detail.bounds.every(Number.isFinite));
 assert.ok(detail.focusBounds.every(Number.isFinite));
 assert.deepEqual(detail.focusBounds,focus.details[id].focusBounds);
 assert.ok(detail.focusBounds[0]>=detail.bounds[0]&&detail.focusBounds[1]>=detail.bounds[1]&&detail.focusBounds[2]<=detail.bounds[2]&&detail.focusBounds[3]<=detail.bounds[3],`${id}: main land stays within the complete country`);
 assert.deepEqual(detail.bounds,focus.details[id].bounds,`${id}: camera and photo clipping use the detailed geometry bounds`);
 assert.ok(geoArea(small)>0&&geoArea(small)<2*Math.PI,`${id}: overview polygon winding and area remain valid`);
 if(points(feature.geometry.coordinates)<500)assert.ok(points(small.geometry.coordinates)>=points(feature.geometry.coordinates),`${id}: small countries retain their full outline`);
}
for(const [id,baseline] of [['HRV',374],['GRC',923],['NZL',775],['NOR',1985]]){
 const f=source.features.find(f=>f.properties.ADM0_A3===id);
 assert.ok(points(f.geometry.coordinates)>baseline*4,`${id}: substantial detail gain over old 50m geometry`);
 const shape=read(`public/geography/${id}.json`);
 assert.ok(shape.path.length>focus.details[id].path.length*2,`${id}: close-up uses detailed geometry, not the overview`);
}
assert.ok(fs.statSync(new URL('../public/geography/HRV.json',import.meta.url)).size<100000,'A country detail loads as a small independent file');
console.log('PASS: detailed outlines preserve country IDs, small-country shapes, valid polygons, matching photo bounds, and significantly richer coastlines.');

const nz=read('public/geography/NZL.json');
assert.ok(nz.focusBounds[3]-nz.focusBounds[1]<(nz.bounds[3]-nz.bounds[1])*.65,'New Zealand focuses on the North, South, and Stewart islands without remote islands shrinking them');
console.log('PASS: main-country framing improves New Zealand while keeping all island geometry.');
