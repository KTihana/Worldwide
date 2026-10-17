import assert from 'node:assert/strict';
import {photoPlacement} from '../app/photo-layout.ts';
for(const bounds of [[0,0,100,100],[30,40,280,80],[10,20,20,520]])for(const aspect of [.1,.5,1,2,10])for(const zoom of [1,1.1,2,5])for(const cropX of [-1,0,1])for(const cropY of [-1,0,1]){
 const p=photoPlacement(bounds,aspect,{cropX,cropY,cropZoom:zoom});
 assert.ok(p.x<=bounds[0]+1e-7&&p.y<=bounds[1]+1e-7,'Image covers the top-left of the country');
 assert.ok(p.x+p.width>=bounds[2]-1e-7&&p.y+p.height>=bounds[3]-1e-7,'Image covers the bottom-right of the country');
 assert.ok(Math.abs(p.width/p.height-aspect)<1e-7,'Photo aspect ratio is preserved');
}
const left=photoPlacement([0,0,100,100],2,{cropX:-1}),right=photoPlacement([0,0,100,100],2,{cropX:1});assert.ok(right.x>left.x,'Dragging right moves the photo right');
console.log('PASS: country photo framing preserves proportions and never exposes empty edges while dragging or zooming.');
