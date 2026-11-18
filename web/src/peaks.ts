import * as THREE from 'three'
import {shareAtmosphere} from './look/atmosphere'
import {look} from './look/config'
import {nightPeaks} from './look/night'
import {fetchAsset} from './world'

interface Section {offset:number; vertices:number; indices:number; indexOffset:number}
export interface Peaks {
  file:string; entries:{name:string; center:[number,number,number]; baseHeight?:number; lods:Section[]; model?:string}[]
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
  const detailMeshes:{mesh:THREE.Object3D; anchor:THREE.Vector3}[] = []
  const deferred:(()=>Promise<void>)[] = []
  for(const entry of asset.entries) {
    if(entry.model) {
      const holder = new THREE.Group()
      holder.name = entry.name
      holder.position.set(entry.center[0],entry.baseHeight??entry.center[1],entry.center[2])
      group.add(holder)
      const url = entry.model.includes('/')?`./${entry.model}`:`./world/${entry.model}`
      deferred.push(async()=>{
        const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js')
        const {scene} = await new GLTFLoader().loadAsync(url)
        const patched = new Set<THREE.Material>()
        scene.traverse(node=>{
          if(!(node instanceof THREE.Mesh)) {node.name=entry.name; return}
          if(node.userData?.noPeakCollider || node.parent?.userData?.noPeakCollider) detailMeshes.push({mesh:node, anchor:holder.position})
          const hasGlow = node.geometry.hasAttribute('_glow')
          for(const mat of Array.isArray(node.material)?node.material:[node.material]) {
            if(patched.has(mat)) continue
            patched.add(mat)
            if(hasGlow) {
              mat.onBeforeCompile = (shader:THREE.WebGLProgramParametersWithUniforms)=>{
                shareAtmosphere(shader)
                shader.vertexShader = shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec4 _glow; varying vec3 vPeakGlow;')
                  .replace('#include <begin_vertex>','#include <begin_vertex>\nvPeakGlow = _glow.rgb;')
                shader.fragmentShader = shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uNight; varying vec3 vPeakGlow;')
                  .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance += vPeakGlow * uNight;')
              }
              mat.customProgramCacheKey = ()=>'guilinol-peak-glow'
            } else nightPeaks(mat as THREE.MeshStandardMaterial)
          }
        })
        holder.add(scene)
      })
      continue
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
      lod.addLevel(new THREE.Mesh(geometry,material),level*800,.05)
    })
    group.add(lod)
  }
  let resolveReady!:()=>void
  group.userData.pending = 0
  group.userData.ready = deferred.length ? new Promise<void>(r=>{resolveReady=r}) : Promise.resolve()
  group.userData.loadDeferred = ()=>{
    if(!deferred.length) return
    group.userData.pending = deferred.length
    const tasks = deferred.splice(0)
    void Promise.all(tasks.map(fn=>fn().finally(()=>{group.userData.pending--}))).finally(()=>resolveReady?.())
  }
  group.userData.tick = (camPos:THREE.Vector3)=>{
    for(const d of detailMeshes) d.mesh.visible = camPos.distanceToSquared(d.anchor) <= 680*680
  }
  return group
}
