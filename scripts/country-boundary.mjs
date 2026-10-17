// Project real polygon edges as open lines. Polygon clipping otherwise closes
// cropped countries along the view rectangle, creating artificial borders.
export function countryBoundary(feature){
 const geometry=feature.geometry;
 return {type:'MultiLineString',coordinates:geometry.type==='MultiPolygon'?geometry.coordinates.flat():geometry.coordinates};
}
