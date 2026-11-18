import * as THREE from 'three'
import {look} from './look/config'
import {fetchAsset} from './world'

interface Section {offset:number; vertices:number; indices:number; indexOffset:number}
export interface Peaks {
  file:string; entries:{name:string; center:[number,number,number]; lods:Section[]; model?:string}[]
}

export async function loadPeaks(asset:Peaks) {
  const packed = await fetchAsset(asset.file)
  const buffer = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  const view = new DataView(buffer)
  if(view.getUint32(0)!==0x504b3032) throw Error('Invalid PK02 header')
  const shared = new Map<number,THREE.BufferAttribute>()
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
    entry.lods.forEach(({offset,vertices,indices,indexOffset},level)=>{
      const geometry = new THREE.BufferGeometry()
      const positions = new Float32Array(vertices*3)
      for(let index=0;index<positions.length;index++) positions[index]=view.getInt16(offset+index*2,true)/100
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3))
      geometry.setAttribute('normal',new THREE.BufferAttribute(new Int8Array(buffer,offset+vertices*6,vertices*3),3,true))
      const weights = new Uint8Array(buffer,offset+vertices*9,vertices*2)
      const attrs = new THREE.InterleavedBuffer(weights,2)
      geometry.setAttribute('aRock',new THREE.InterleavedBufferAttribute(attrs,1,0,true))
      geometry.setAttribute('aHeight',new THREE.InterleavedBufferAttribute(attrs,1,1,true))
      if(!shared.has(indexOffset)) shared.set(indexOffset,new THREE.BufferAttribute(new Uint16Array(buffer.slice(indexOffset,indexOffset+indices*2)),1))
      geometry.setIndex(shared.get(indexOffset)!)
      const colors = new Float32Array(vertices*3), color = new THREE.Color()
      for(let index=0;index<vertices;index++) color.lerpColors(vegetation,rock,weights[index*2]/255).toArray(colors,index*3)
      geometry.setAttribute('color',new THREE.BufferAttribute(colors,3))
      const mesh = new THREE.Mesh(geometry,material)
      lod.addLevel(mesh,level*800,.05)
    })
    group.add(lod)
  }))
  return group
}
