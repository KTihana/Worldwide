import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fitShape} from '../app/map-camera.ts';
const world=JSON.parse(fs.readFileSync(new URL('../app/data/world.json',import.meta.url)));
const focus=JSON.parse(fs.readFileSync(new URL('../app/data/focus.json',import.meta.url)));
assert.equal(Object.keys(focus.regions).length,7,'Every continent is available');
for(const c of world.countries){const detail=focus.details[c.id];assert.ok(detail?.path,`${c.name}: close-up exists`);assert.ok(detail.bounds.every(Number.isFinite),`${c.name}: finite bounds`);assert.ok(detail.bounds[2]>detail.bounds[0]&&detail.bounds[3]>detail.bounds[1],`${c.name}: visible outline`)}
assert.ok(focus.regions.Europe.shapes.HRV,'Croatia is shown in Europe');
assert.ok(!focus.regions.Europe.shapes.BRA,'Brazil is hidden in Europe');
assert.ok(focus.regions.Asia.shapes.RUS&&focus.regions.Europe.shapes.RUS,'Russia can be viewed from both continents');
assert.ok(focus.regions.Oceania.shapes.FJI,'Fiji is present across the date line');
assert.deepEqual(Object.keys(focus.regions.Antarctica.shapes),['ATA']);
assert.ok(focus.details.FJI.bounds[2]-focus.details.FJI.bounds[0]<700,'Fiji wraps into a single close-up');
function assertFits(bounds,box,screen,country=false){
 const z=fitShape(bounds,box,screen,country),left=(bounds[0]*z.k+z.x-box.x)/box.width*screen.width,right=(bounds[2]*z.k+z.x-box.x)/box.width*screen.width,top=(bounds[1]*z.k+z.y-box.y)/box.height*screen.height,bottom=(bounds[3]*z.k+z.y-box.y)/box.height*screen.height;
 assert.ok(left>=24&&right<=screen.width-24,'Outline stays inside the screen');
 assert.ok(top>=(screen.width<=600?134:100),'Outline clears the controls');
 if(country&&screen.width>600)assert.ok(right<screen.width-(screen.width<=800?380:412),'Outline clears the desktop album');
 if(country&&screen.width<=600)assert.ok(bottom<screen.height*.48-16,'Outline clears the mobile album');
 else assert.ok(bottom<screen.height-42,'Outline clears the map footer');
}
for(const c of world.countries){
 assertFits(focus.details[c.id].bounds,{x:0,y:-42.5,width:1200,height:675},{width:1280,height:720},true);
 assertFits(focus.details[c.id].bounds,{x:443,y:-45,width:314,height:680},{width:390,height:844},true);
 assertFits(focus.details[c.id].bounds,{x:269.45,y:-45,width:661.1,height:680},{width:700,height:720},true);
}
for(const r of Object.values(focus.regions)){assertFits(r.bounds,{x:0,y:-42.5,width:1200,height:675},{width:1280,height:720});assertFits(r.bounds,{x:443,y:-45,width:314,height:680},{width:390,height:844})}
console.log('PASS: seven continent filters, all country outlines, date-line wrapping, and close-up framing on desktop and mobile.');
