import * as THREE from 'three'
import {look} from './look/config'
import {nightPeaks} from './look/night'
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
  nightPeaks(material)
  const [foot,green,dark,light,rock,rockDark,ochre] = [look.peakFoot,look.peakGreen,look.peakGreenDark,look.peakGreenLight,
    look.peakRock,look.peakRockDark,look.peakRockOchre].map(value=>new THREE.Color(value))
  const smooth = (a:number,b:number,x:number)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)}
  const hash = (x:number,z:number)=>{const v=Math.sin(x*12.9898+z*78.233)*43758.5453; return v-Math.floor(v)}
  // Value noise on a few-metre lattice so canopy reads as clumps of tree crowns, not per-facet speckle.
  const noise = (x:number,z:number,cell:number)=>{
    const gx=x/cell, gz=z/cell, ix=Math.floor(gx), iz=Math.floor(gz), fx=gx-ix, fz=gz-iz
    const u=fx*fx*(3-2*fx), v=fz*fz*(3-2*fz)
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iz),hash(ix+1,iz),u),THREE.MathUtils.lerp(hash(ix,iz+1),hash(ix+1,iz+1),u),v)
  }
  const stone = new THREE.Color()
  function paint(target:THREE.Color, rockiness:number, height:number, x:number, y:number, z:number) {
    const clump = noise(x+y*.3,z-y*.3,7)*.65+noise(x,z,2.5)*.35
    target.copy(dark).lerp(green,smooth(.2,.75,clump)).lerp(light,smooth(.62,.95,clump)*(.35+.4*height))
    target.lerp(foot,(1-smooth(.03,.18,height))*.7)
    // Bare limestone only in vertical bands where the wall is steepest (R3/R7): vegetation drapes down
    // between bands and over ledges. Bands follow the angle so they read as cliff faces, not stripes.
    const angle = Math.atan2(z,x)
    const band = noise(angle*9,y*.04,1)*.7+noise(angle*30,y*.12,1)*.3
    const ledge = noise(angle*22,y*.35,1)
    const bare = smooth(.55,.9,rockiness)*smooth(look.peakBareFrom,look.peakBareFrom+.18,band)*(.55+.45*smooth(.3,.6,ledge))
    const runnel = Math.pow(Math.sin(angle*53+Math.sin(angle*7)*1.5)*.5+.5,3)
    stone.copy(rock).lerp(ochre,smooth(.7,.9,noise(angle*14,y*.05,1))*.45)
      .lerp(rockDark,runnel*(.3+.45*smooth(.15,.85,1-height)))
    target.lerp(stone,THREE.MathUtils.clamp(bare*look.peakRockShare,0,1))
    target.multiplyScalar(1+(hash(x,z)-.5)*2*look.peakJitter)
  }
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
      for(let index=0;index<vertices;index++) {
        paint(color,weights[index*2]/255,weights[index*2+1]/255,positions[index*3],positions[index*3+1],positions[index*3+2])
        color.toArray(colors,index*3)
      }
      geometry.setAttribute('color',new THREE.BufferAttribute(colors,3))
      const mesh = new THREE.Mesh(geometry,material)
      lod.addLevel(mesh,level*800,.05)
    })
    group.add(lod)
  }))
  return group
}
