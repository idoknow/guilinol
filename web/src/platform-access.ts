import * as THREE from 'three'

export type RefinedTerrainFace = [number[], [number,number,number][]]

// The grid prefix remains available for ordinary height lookups. Replace only
// the indexed triangles intersecting an island platform access ramp.
export function refinePlatformTerrain(geometry:THREE.PlaneGeometry, faces:RefinedTerrainFace[]){
  const key=(ids:number[])=>ids.slice().sort((a,b)=>a-b).join(',')
  const replacements=new Map(faces.map(([ids,triangles])=>[key(ids),triangles]))
  const position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv')
  const originalNormals=geometry.getAttribute('normal').array
  const vertices=Array.from(position.array),coords=Array.from(uv.array),indices:number[]=[]
  const source=geometry.getIndex()!
  for(let i=0;i<source.count;i+=3){
    const ids=[source.getX(i),source.getX(i+1),source.getX(i+2)]
    const replacement=replacements.get(key(ids))
    if(!replacement){indices.push(...ids);continue}
    for(const [x,y,z] of replacement){
      indices.push(vertices.length/3)
      vertices.push(x,y,z);coords.push(x/256,1-z/256)
    }
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3))
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(coords,2))
  geometry.deleteAttribute('normal')
  geometry.setIndex(indices);geometry.computeVertexNormals()
  geometry.getAttribute('normal').array.set(originalNormals)
  geometry.computeBoundingSphere()
}

