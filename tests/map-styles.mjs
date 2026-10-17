import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=name=>JSON.parse(fs.readFileSync(new URL(`../app/data/${name}.json`,import.meta.url)));
const catalog=read('map-styles'),world=read('world');
assert.equal(catalog.length,11);
const signatures=new Set();
for(const style of catalog){
 assert.ok(style.preview?.startsWith('M'));
 const shapes=read(`projections/${style.id}`);
 assert.equal(Object.keys(shapes).length,world.countries.length,`${style.name}: all countries retained`);
 for(const country of world.countries){const shape=shapes[country.id];assert.ok(shape.outline&&!/[Zz]/.test(shape.outline),`${style.name}: only real geographic borders`);assert.ok(shape.path&&!/NaN|Infinity/.test(shape.path),`${style.name}: ${country.name} valid outline`);assert.ok(shape.bounds.every(Number.isFinite));assert.ok(shape.bounds[2]>shape.bounds[0]&&shape.bounds[3]>shape.bounds[1]);assert.ok(shape.bounds[0]>=20&&shape.bounds[2]<=1180&&shape.bounds[1]>=10&&shape.bounds[3]<=570,`${style.name}: fits canvas`)}
 signatures.add(shapes.HRV.path);
}
assert.equal(signatures.size,catalog.length,'Each choice produces a different projection');
console.log('PASS: 11 distinct projections preserve every country and fit the map/export canvas.');
