import * as THREE from 'three'
import {look} from './look/config'
import {fetchAsset} from './world'

interface Section {offset:number; vertices:number; indices:number}
export interface Peaks {
  file:string; entries:{name:string; center:[number,number,number]; lods:Section[]; model?:string}[]
}

export async function loadPeaks(asset:Peaks) {
  const packed = await fetchAsset(asset.file)
  const buffer = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  if(new DataView(buffer).getUint32(0)!==0x504b3031) throw Error('Invalid PK01 header')
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({flatShading:true,vertexColors:true,roughness:look.roughness,metalness:look.metalness})
  const vegetation = new THREE.Color(look.peakVegetation), rock = new THREE.Color(look.peakRock)
  await Promise.all(asset.entries.map(async entry=>{
    if(entry.model) {
      const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js')
      const {scene} = await new GLTFLoader().loadAsync(`./world/${entry.model}`)
      scene.name=entry.name; group.add(scene); return
    }
    const lod = new THREE.LOD()
    lod.name=entry.name; lod.position.set(...entry.center)
    entry.lods.forEach(({offset,vertices,indices},level)=>{
      const geometry = new THREE.BufferGeometry()
      const data = new THREE.InterleavedBuffer(new Float32Array(buffer,offset,vertices*8),8)
      geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(data,3,0))
      geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(data,3,3))
      geometry.setAttribute('aRock',new THREE.InterleavedBufferAttribute(data,1,6))
      geometry.setAttribute('aHeight',new THREE.InterleavedBufferAttribute(data,1,7))
      geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(buffer,offset+vertices*32,indices),1))
      const colors = new Float32Array(vertices*3), color = new THREE.Color()
      for(let index=0;index<vertices;index++) color.lerpColors(vegetation,rock,data.array[index*8+6]).toArray(colors,index*3)
      geometry.setAttribute('color',new THREE.BufferAttribute(colors,3))
      const mesh = new THREE.Mesh(geometry,material)
      mesh.position.copy(lod.position).negate(); lod.addLevel(mesh,level*800,.05)
    })
    group.add(lod)
  }))
  return group
}
