// Project real polygon edges as open lines. Polygon clipping otherwise closes
// cropped countries along the view rectangle, creating artificial borders.
export function countryBoundary(feature){
 const geometry=feature.geometry;
 const rings=geometry.type==='MultiPolygon'?geometry.coordinates.flat():geometry.coordinates;
 const coordinates=[];for(const ring of rings){let line=[];for(const point of ring){if(point[1]<=-89.999){if(line.length>1)coordinates.push(line);line=[]}else line.push(point)}if(line.length>1)coordinates.push(line)}
 return {type:'MultiLineString',coordinates};
}
