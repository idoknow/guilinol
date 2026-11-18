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
  const [foot,green,crown,rock,rockDark] = [look.peakFoot,look.peakGreen,look.peakCrown,look.peakRock,look.peakRockDark].map(value=>new THREE.Color(value))
  const smooth = (a:number,b:number,x:number)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)}
  // 青绿山水: 赭石 at the foot, 石绿 body, 石青 crown; steep faces show limestone, streaked darker by
  // a vertical hash so the ribs read as wet runnels. Per-vertex jitter keeps facets from looking plastic.
  function paint(target:THREE.Color, rockiness:number, height:number, x:number, z:number) {
    target.copy(green).lerp(crown,smooth(.45,.95,height)).lerp(foot,1-smooth(.02,.16,height))
    const streak = Math.sin(Math.atan2(z,x)*47+Math.sin(x*.05)*2)*.5+.5
    const stone = rock.clone().lerp(rockDark,streak*smooth(.1,.7,1-height)*.55)
    target.lerp(stone,THREE.MathUtils.clamp(rockiness*look.peakRockShare,0,1))
    const jitter = (Math.sin(x*12.9898+z*78.233)*43758.5453)%1
    target.multiplyScalar(1+(jitter-.5)*2*look.peakJitter)
  }
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
      for(let index=0;index<vertices;index++) {
        const at = index*8
        paint(color,data.array[at+6],data.array[at+7],data.array[at]-entry.center[0],data.array[at+2]-entry.center[2])
        color.toArray(colors,index*3)
      }
      geometry.setAttribute('color',new THREE.BufferAttribute(colors,3))
      const mesh = new THREE.Mesh(geometry,material)
      mesh.position.copy(lod.position).negate(); lod.addLevel(mesh,level*800,.05)
    })
    group.add(lod)
  }))
  return group
}
