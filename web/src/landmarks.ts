import {record} from './telemetry'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'
import {nightLit} from './look/night'
import {sharedKtx2Loader} from './look/tiles'
import {bindStreetSurface,streetSurfaceMat} from './streets'
import seamConfig from '../../pipeline/seam-surfaces.json'
import {atlasTriangles} from '../../lib/atlas-ground.mjs'
import {deriveRangeMetrics, RENDER_RADIUS_DEFAULT, type RenderRangeMetrics} from './render-range'
import {getLodNodes, landmarkCulling} from './landmark-culling'
import {freezeStatic} from './static-freeze'

export {landmarkCulling}

export interface Landmark {
  id:string; name?:string; file:string; position:[number,number,number]; rotation:number; collision:'mesh'|'box'|'none'; lods:string[]
  sphere:[number,number,number,number]; bytes:number
  solid?:[number,number,[number,number][]][]
}
export type LoadedLandmarks = Map<Landmark,THREE.Group>

export interface LandmarkStreamOptions {
  camera?: THREE.Camera
  onMount?: (root: THREE.Group) => void
  onPendingChange?:()=>void
  getMetrics?: () => RenderRangeMetrics
  isInnerBusy?: () => boolean
}

interface MaterialBinding {
  mesh: THREE.Mesh
  opaque: THREE.Material | THREE.Material[]
  fade?: THREE.Material | THREE.Material[]
}

interface LandmarkState {
  coverage: THREE.IUniform<number>
  fading: boolean
  fadeReady: boolean
  fadeCompiling: boolean
  bindings: MaterialBinding[]
  fadeMaterials: Set<THREE.Material>
}

interface FetchedEntry {
  entry: Landmark
  buffer: ArrayBuffer
  isPriority: boolean
}

interface DecodedEntry {
  entry: Landmark
  group: THREE.Group
  isPriority: boolean
}

interface ReadyEntry {
  entry: Landmark
  group: THREE.Group
  state: LandmarkState
  isPriority: boolean
}

const fallbackMetrics = deriveRangeMetrics(RENDER_RADIUS_DEFAULT)

function landmarkDistance(eye:THREE.Vector3, entry:Landmark){
  return Math.hypot(eye.x-entry.position[0],eye.y-entry.position[1],eye.z-entry.position[2])-entry.sphere[3]
}

// Fast 128-bit content fingerprint for KTX2 ArrayBuffers so landmarks embedding
// identical shared atlases (e.g. Group-B B_surfaces / B_signs / B_curtain_glass)
// reuse one transcoded CompressedTexture Source across the GPU.
function hashBuffer(buffer:ArrayBuffer):string{
  const bytes=new Uint8Array(buffer)
  const len=bytes.length
  let h1=0x811c9dc5, h2=0x9e3779b1, h3=0x85ebca6b, h4=0xc2b2ae35
  for(let i=0;i<len;i++){
    const b=bytes[i]
    h1=Math.imul(h1^b,0x01000193)
    h2=Math.imul(h2^(b+((i&255)<<1)),0x27d4eb2d)
    if((i&3)===0)h3=Math.imul(h3^b,0x165667b1)
    else h4=Math.imul(h4^b,0x85ebca77)
  }
  return `${len}:${h1>>>0}:${h2>>>0}:${h3>>>0}:${h4>>>0}`
}

type Ktx2CacheEntry={promise:Promise<THREE.CompressedTexture>; refs:number}

function createCachedKtx2Loader(basis:Awaited<ReturnType<typeof sharedKtx2Loader>>){
  const cache=new Map<string,Ktx2CacheEntry>()
  const proxy=Object.create(basis) as typeof basis
  proxy.parse=function(buffer:ArrayBuffer, onLoad?:(texture:THREE.CompressedTexture)=>void, onError?:(error:unknown)=>void){
    const key=hashBuffer(buffer)
    let slot=cache.get(key)
    if(!slot){
      const promise=new Promise<THREE.CompressedTexture>((resolve,reject)=>{
        basis.parse(buffer,resolve,reject)
      })
      slot={promise,refs:0}
      cache.set(key,slot)
    }
    slot.refs++
    const current=slot
    return current.promise.then(template=>{
      const clone=template.clone()
      const onDispose=()=>{
        clone.removeEventListener('dispose',onDispose)
        current.refs--
        if(current.refs<=0){
          if(cache.get(key)===current)cache.delete(key)
          template.dispose()
        }
      }
      clone.addEventListener('dispose',onDispose)
      onLoad?.(clone)
      return clone
    }).catch(error=>{
      current.refs--
      if(current.refs<=0&&cache.get(key)===current)cache.delete(key)
      onError?.(error)
      throw error
    })
  }
  return proxy
}

function atlasStreetMesh(source:THREE.Mesh, indices:number[], role:string){
  const geometry=new THREE.BufferGeometry()
  const positions=source.geometry.getAttribute('position'), normals=source.geometry.getAttribute('normal')
  const vertices=[...new Set(indices)]
  const remap=new Map(vertices.map((vertex,index)=>[vertex,index]))
  const xyz=new THREE.Float32BufferAttribute(new Float32Array(vertices.length*3),3)
  const directions=new THREE.Float32BufferAttribute(new Float32Array(vertices.length*3),3)
  vertices.forEach((vertex,index)=>{
    xyz.setXYZ(index,positions.getX(vertex),positions.getY(vertex),positions.getZ(vertex))
    if(normals)directions.setXYZ(index,normals.getX(vertex),normals.getY(vertex),normals.getZ(vertex))
  })
  geometry.setAttribute('position',xyz)
  if(normals)geometry.setAttribute('normal',directions)
  geometry.setIndex(indices.map(vertex=>remap.get(vertex)!))
  bindStreetSurface(geometry,role)
  if(source instanceof THREE.InstancedMesh){
    const mesh=new THREE.InstancedMesh(geometry,streetSurfaceMat,source.count)
    mesh.instanceMatrix.copy(source.instanceMatrix)
    return mesh
  }
  return new THREE.Mesh(geometry,streetSurfaceMat)
}

function batchRepeatedMeshes(root:THREE.Group){
  root.updateMatrixWorld(true)
  for(const name of ['lod0','lod1','lod2']){
    const layer=root.getObjectByName(name)
    if(!layer)continue
    const batches=new Map<string,THREE.Mesh[]>()
    layer.traverseVisible(node=>{
      if(!(node instanceof THREE.Mesh)||node===layer||node.children.length||node instanceof THREE.InstancedMesh)return
      if(node.matrixWorld.determinant()<=0||Array.isArray(node.material)||node.material.transparent)return
      const key=node.geometry.uuid+node.material.uuid
      const group=batches.get(key)??[];group.push(node);batches.set(key,group)
    })
    const inverse=layer.matrixWorld.clone().invert()
    for(const meshes of batches.values()){
      if(meshes.length<2)continue
      const batch=new THREE.InstancedMesh(meshes[0].geometry,meshes[0].material,meshes.length)
      meshes.forEach((mesh,index)=>{batch.setMatrixAt(index,new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld));mesh.removeFromParent()})
      layer.add(batch)
    }
  }
}

// Fade the last available LOD before its stream cutoff. Only transition states
// (coverage < 1) bind this discard variant; steady-state coverage === 1 renders
// with the clean opaque material so hardware Early-Z remains enabled.
function fadeMaterial(material:THREE.Material,coverage:THREE.IUniform<number>){
  const previous=material.onBeforeCompile, key=material.customProgramCacheKey()
  material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer)
    shader.uniforms.uLandmarkCoverage=coverage
    shader.fragmentShader='uniform float uLandmarkCoverage;\n'+shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      `#include <alphatest_fragment>
if(uLandmarkCoverage < 1. && uLandmarkCoverage <= fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056,.00583715))))) discard;`)
  }
  material.customProgramCacheKey=()=>key+'-stream-fade'
}

function createFadeVariant(source:THREE.Material, coverage:THREE.IUniform<number>){
  const variant=source.clone()
  variant.onBeforeCompile=source.onBeforeCompile
  variant.customProgramCacheKey=source.customProgramCacheKey
  fadeMaterial(variant,coverage)
  return variant
}

function ensureFadeMaterials(state:LandmarkState){
  if(state.fadeMaterials.size)return
  const clones=new Map<THREE.Material,THREE.Material>()
  const mapOne=(mat:THREE.Material)=>{
    if(mat===streetSurfaceMat)return mat
    let copy=clones.get(mat)
    if(!copy){
      copy=createFadeVariant(mat,state.coverage)
      clones.set(mat,copy)
      state.fadeMaterials.add(copy)
    }
    return copy
  }
  for(const binding of state.bindings){
    binding.fade=Array.isArray(binding.opaque)?binding.opaque.map(mapOne):mapOne(binding.opaque)
  }
}

function collectTextures(group:THREE.Group){
  const textures=new Set<THREE.Texture>()
  group.traverse(node=>{
    if(!(node instanceof THREE.Mesh)||!node.visible)return
    for(const material of [node.material].flat()){
      if(!material||material===streetSurfaceMat)continue
      for(const value of Object.values(material)){
        if(value instanceof THREE.Texture)textures.add(value)
      }
    }
  })
  return textures
}

export function landmarkStream(
  scene:THREE.Scene,
  renderer:THREE.WebGLRenderer,
  entries:Landmark[],
  loaded:LoadedLandmarks,
  options?:LandmarkStreamOptions,
){
  const loaderReady=sharedKtx2Loader(renderer).then(basis=>new GLTFLoader().setKTX2Loader(createCachedKtx2Loader(basis)).setMeshoptDecoder(MeshoptDecoder))
  const pending=new Set<Landmark>(), priorityPending=new Set<Landmark>(), retry=new Map<Landmark,number>()
  const states=new WeakMap<THREE.Group,LandmarkState>()
  const fetchedQueue:FetchedEntry[]=[]
  const decodedQueue:DecodedEntry[]=[]
  const attachQueue:ReadyEntry[]=[]
  const lastEye=new THREE.Vector3(Infinity,0,0)
  let parsing=false
  let compiling=false
  let fadeCompileInFlight=false
  let pumpScheduled=false
  let lastDrainAt=-Infinity

  function schedulePump(){
    if(pumpScheduled)return
    if(!attachQueue.length&&!decodedQueue.length&&!fetchedQueue.length)return
    pumpScheduled=true
    requestAnimationFrame(()=>{
      pumpScheduled=false
      if(!Number.isFinite(lastEye.x))return
      const metrics=options?.getMetrics?.()??fallbackMetrics
      drainOnePerFrame(lastEye,metrics,metrics.spawnRingEdge+48)
      if(attachQueue.length||decodedQueue.length||fetchedQueue.length)schedulePump()
    })
  }

  function disposeGroup(root:THREE.Group, state?:LandmarkState){
    const assets=new Set<THREE.BufferGeometry|THREE.Material|THREE.Texture>()
    const resolvedState=state??states.get(root)
    if(resolvedState){
      for(const binding of resolvedState.bindings){
        for(const mat of [binding.opaque].flat()){
          if(mat===streetSurfaceMat)continue
          assets.add(mat)
          for(const value of Object.values(mat))if(value instanceof THREE.Texture)assets.add(value)
        }
      }
      for(const mat of resolvedState.fadeMaterials)assets.add(mat)
    }
    root.traverse(node=>{if(node instanceof THREE.Mesh){if(node instanceof THREE.InstancedMesh)node.dispose();assets.add(node.geometry)
      for(const material of [node.material].flat()) {if(material===streetSurfaceMat)continue;assets.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)assets.add(value)}
    }})
    if(root.parent)scene.remove(root)
    for(const asset of assets)asset.dispose()
  }

  function finishPending(entry:Landmark){
    pending.delete(entry)
    priorityPending.delete(entry)
    options?.onPendingChange?.()
  }

  function loadEntry(entry:Landmark, isPriority:boolean){
    if(loaded.has(entry)||pending.has(entry))return
    pending.add(entry)
    options?.onPendingChange?.()
    if(isPriority)priorityPending.add(entry)
    if(retry.has(entry))record('retry',{category:'landmark'})
    fetch('./'+entry.file).then(response=>{
      if(!response.ok)throw Error(`HTTP ${response.status}`)
      return response.arrayBuffer()
    }).then(buffer=>{
      fetchedQueue.push({entry,buffer,isPriority})
      schedulePump()
    }).catch(error=>{
      record('failure',{category:'landmark'})
      console.warn(entry.id,error)
      retry.set(entry,performance.now()+30000)
      finishPending(entry)
    })
  }

  function startParse(item:FetchedEntry, eye:THREE.Vector3, metrics:RenderRangeMetrics, guardDist:number){
    const {entry,buffer,isPriority}=item
    const distance=landmarkDistance(eye,entry)
    const nearCollision=entry.collision!=='none'&&distance<=guardDist
    const {unload}=entryCutoffs(entry,metrics,guardDist)
    if(!isPriority&&!nearCollision&&distance>unload){
      finishPending(entry)
      return
    }
    parsing=true
    void loaderReady.then(loader=>new Promise<THREE.Group>((resolve,reject)=>{
      loader.parse(buffer,'./',gltf=>resolve(gltf.scene),reject)
    })).then(group=>{
      parsing=false
      decodedQueue.push({entry,group,isPriority})
      schedulePump()
    }).catch(error=>{
      parsing=false
      record('failure',{category:'landmark'})
      console.warn(entry.id,error)
      retry.set(entry,performance.now()+30000)
      finishPending(entry)
      schedulePump()
    })
  }

  function entryCutoffs(entry:Landmark,metrics:RenderRangeMetrics,guardDist:number){
    const load=Math.max(guardDist,metrics.landmarkLoadRadius)
    const fadeCutoff=Math.max(guardDist,entry.lods.includes('lod2')?metrics.landmarkLoadRadius:metrics.landmarkLod1)
    const unload=Math.max(guardDist+80,metrics.landmarkUnloadRadius)
    return {load,fadeCutoff,unload}
  }

  function precompileFade(state:LandmarkState){
    if(state.fadeReady||state.fadeCompiling)return
    ensureFadeMaterials(state)
    const camera=options?.camera
    if(!camera||typeof renderer.compileAsync!=='function'||!state.fadeMaterials.size){
      state.fadeReady=true
      return
    }
    if(fadeCompileInFlight)return
    state.fadeCompiling=true
    fadeCompileInFlight=true
    const proxy=new THREE.Group()
    const seen=new Set<THREE.Material>()
    for(const binding of state.bindings){
      const mats=[binding.fade!].flat()
      for(const mat of mats){
        if(mat===streetSurfaceMat||seen.has(mat))continue
        seen.add(mat)
        const dummy=binding.mesh instanceof THREE.InstancedMesh
          ? new THREE.InstancedMesh(binding.mesh.geometry,mat,1)
          : new THREE.Mesh(binding.mesh.geometry,mat)
        proxy.add(dummy)
      }
    }
    void renderer.compileAsync(proxy,camera,scene).finally(()=>{
      for(const child of proxy.children)if(child instanceof THREE.InstancedMesh)child.dispose()
      state.fadeCompiling=false
      state.fadeReady=true
      fadeCompileInFlight=false
    })
  }

  function applyCoverage(state:LandmarkState, distance:number, fadeCutoff:number){
    const nextCoverage=1-THREE.MathUtils.smoothstep(distance,fadeCutoff-60,fadeCutoff)
    const approachingFade=distance>fadeCutoff-100
    if(approachingFade&&!state.fadeReady)precompileFade(state)
    const wantFading=nextCoverage<1&&state.fadeReady
    if(state.fading!==wantFading){
      state.fading=wantFading
      if(wantFading)ensureFadeMaterials(state)
      for(const binding of state.bindings){
        binding.mesh.material=wantFading?binding.fade!:binding.opaque
      }
    }
    if(wantFading)state.coverage.value=nextCoverage
  }

  function updateVisibility(entry:Landmark,root:THREE.Group,distance:number,fadeCutoff:number,metrics:RenderRangeMetrics){
    const visible=distance<fadeCutoff
    root.visible=visible
    if(!visible)return
    const state=states.get(root)
    if(state)applyCoverage(state,distance,fadeCutoff)
    if(entry.lods.length){
      const level=distance>metrics.landmarkLod1?'lod2':distance>metrics.landmarkLod0?'lod1':'lod0'
      const lods=getLodNodes(root)
      for(const name of entry.lods){
        const node=lods[name as keyof typeof lods]??root.getObjectByName(name)
        if(node)node.visible=name===level
      }
    }
  }

  function prepareDecoded(item:DecodedEntry, eye:THREE.Vector3, metrics:RenderRangeMetrics, guardDist:number){
    const {entry,group,isPriority}=item
    const distance=landmarkDistance(eye,entry)
    const nearCollision=entry.collision!=='none'&&distance<=guardDist
    const {fadeCutoff,unload}=entryCutoffs(entry,metrics,guardDist)
    if(!isPriority&&!nearCollision&&distance>unload){
      disposeGroup(group)
      finishPending(entry)
      return
    }
    group.position.fromArray(entry.position);group.rotation.y=THREE.MathUtils.degToRad(entry.rotation)
    const surfaces:Record<string,string>=(seamConfig.surfaces as Record<string,Record<string,string>>)[entry.id]??{}
    const exceptions=seamConfig.exceptions.filter((item:{kind?:string})=>!item.kind||item.kind==='material')
    type AtlasRule={material:string,role:string,box:number[]}
    const atlas=(seamConfig.atlas as Record<string,AtlasRule|AtlasRule[]>)[entry.id]
    const regions=atlas?[atlas].flat():[]
    const retired=new Set<THREE.BufferGeometry|THREE.Material|THREE.Texture>()
    const litApplied=new Set<THREE.Material>()
    group.traverse(node=>{
      if(/^collision/i.test(node.name))node.visible=false
      if(!(node instanceof THREE.Mesh))return
      const original=node.material,kind=surfaces[original.name]
      if(original===streetSurfaceMat)return
      const rules=regions.filter(rule=>rule.material===original.name)
      if(rules.length&&!exceptions.some(item=>item.id===entry.id&&item.material===original.name)){
        const source=node.geometry
        let remainder=source
        for(const rule of rules){
          const {selected,rest}=atlasTriangles(remainder,rule.box,original.map?.repeat.toArray(),original.map?.offset.toArray())
          if(!selected.length)continue
          if(remainder===source){
            remainder=source.clone()
            retired.add(source)
            node.geometry=remainder
          }
          node.add(atlasStreetMesh(node,selected,rule.role))
          remainder.setIndex(rest)
        }
      }
      if(kind&&!exceptions.some(item=>item.id===entry.id&&item.material===original.name)){
        retired.add(original);retired.add(node.geometry)
        for(const value of Object.values(original))if(value instanceof THREE.Texture)retired.add(value)
        node.geometry=node.geometry.clone();bindStreetSurface(node.geometry,kind);node.material=streetSurfaceMat
      }else for(const material of [original].flat()){
        if(!litApplied.has(material)){litApplied.add(material);nightLit(material)}
      }
    })
    // Release replaced paving/sidewalk textures & materials immediately instead of holding them until unload.
    const live=new Set<THREE.BufferGeometry|THREE.Material|THREE.Texture>()
    group.traverse(node=>{
      if(!(node instanceof THREE.Mesh))return
      live.add(node.geometry)
      for(const mat of [node.material].flat()){
        live.add(mat)
        for(const value of Object.values(mat))if(value instanceof THREE.Texture)live.add(value)
      }
    })
    for(const asset of retired)if(!live.has(asset))asset.dispose()

    batchRepeatedMeshes(group)
    freezeStatic(group)

    const bindings:MaterialBinding[]=[]
    group.traverse(node=>{
      if(!(node instanceof THREE.Mesh)||!node.visible)return
      const mat=node.material
      if(mat===streetSurfaceMat)return
      if(Array.isArray(mat)&&mat.every(m=>m===streetSurfaceMat))return
      bindings.push({mesh:node,opaque:mat})
    })
    const state:LandmarkState={coverage:{value:1},fading:false,fadeReady:false,fadeCompiling:false,bindings,fadeMaterials:new Set()}
    states.set(group,state)

    // Pre-upload unique textures for this single landmark so turning the camera never stalls on texStorage2D.
    for(const texture of collectTextures(group))renderer.initTexture(texture)

    // If this landmark enters inside the fade zone, build the fade variant before compileAsync so it compiles off-frame too.
    if(distance<fadeCutoff&&distance>fadeCutoff-60){
      ensureFadeMaterials(state)
      state.fadeReady=true
      applyCoverage(state,distance,fadeCutoff)
    }

    const camera=options?.camera
    if(camera&&typeof renderer.compileAsync==='function'){
      compiling=true
      void renderer.compileAsync(group,camera,scene).then(()=>{
        compiling=false
        attachQueue.push({entry,group,state,isPriority})
        schedulePump()
      }).catch(()=>{
        compiling=false
        attachQueue.push({entry,group,state,isPriority})
        schedulePump()
      })
    }else{
      attachQueue.push({entry,group,state,isPriority})
      schedulePump()
    }
  }

  function popBest<T extends {entry:Landmark; isPriority:boolean}>(queue:T[], eye:THREE.Vector3):T|undefined{
    if(!queue.length)return undefined
    let bestIdx=0
    let bestDist=landmarkDistance(eye,queue[0].entry)
    for(let i=1;i<queue.length;i++){
      const cur=queue[i], prev=queue[bestIdx]
      const d=landmarkDistance(eye,cur.entry)
      if((cur.isPriority&&!prev.isPriority)||(cur.isPriority===prev.isPriority&&d<bestDist)){
        bestIdx=i;bestDist=d
      }
    }
    return queue.splice(bestIdx,1)[0]
  }

  function drainOnePerFrame(eye:THREE.Vector3, metrics:RenderRangeMetrics, guardDist:number){
    const frameStart=performance.now()
    if(frameStart-lastDrainAt<8)return
    // Mount at most 1 compiled landmark per frame.
    let didWork=false
    while(attachQueue.length){
      const ready=popBest(attachQueue,eye)!
      const distance=landmarkDistance(eye,ready.entry)
      const nearCollision=ready.entry.collision!=='none'&&distance<=guardDist
      const {fadeCutoff,unload}=entryCutoffs(ready.entry,metrics,guardDist)
      if(!ready.isPriority&&!nearCollision&&distance>unload){
        disposeGroup(ready.group,ready.state)
        finishPending(ready.entry)
        continue
      }
      scene.add(ready.group)
      loaded.set(ready.entry,ready.group)
      retry.delete(ready.entry)
      updateVisibility(ready.entry,ready.group,distance,fadeCutoff,metrics)
      options?.onMount?.(ready.group)
      finishPending(ready.entry)
      didWork=true
      break
    }
    // Prepare & kick off async shader compile for at most 1 decoded landmark per frame.
    if(!didWork&&!compiling&&decodedQueue.length){
      const next=popBest(decodedQueue,eye)!
      prepareDecoded(next,eye,metrics,guardDist)
      didWork=true
    }
    // Gate GLB/Meshopt parse to at most 1 per frame, and give large GLBs (>1MB) their own clean frame.
    if(!parsing&&fetchedQueue.length&&(!didWork||performance.now()-frameStart<4)){
      const peek=popBest(fetchedQueue,eye)!
      if(didWork&&peek.buffer.byteLength>1_000_000){
        fetchedQueue.push(peek)
      }else{
        startParse(peek,eye,metrics,guardDist)
        didWork=true
      }
    }
    if(didWork)lastDrainAt=frameStart
  }

  const tick = (eye:THREE.Vector3, priority?:Landmark)=>{
    lastEye.copy(eye)
    const metrics=options?.getMetrics?.()??fallbackMetrics
    const guardDist=metrics.spawnRingEdge+48
    if(priority){
      const distance=landmarkDistance(eye,priority)
      const root=loaded.get(priority)
      if(root){
        const {fadeCutoff}=entryCutoffs(priority,metrics,guardDist)
        updateVisibility(priority,root,distance,fadeCutoff,metrics)
      }else if(!pending.has(priority)&&performance.now()>=(retry.get(priority)??0)){
        loadEntry(priority,true)
      }
      schedulePump()
      return
    }

    drainOnePerFrame(eye,metrics,guardDist)

    const now=performance.now()
    const candidates:{entry:Landmark; distance:number; nearCollision:boolean}[]=[]
    for(const entry of entries){
      const distance=landmarkDistance(eye,entry)
      const root=loaded.get(entry)
      const nearCollision=entry.collision!=='none'&&distance<=guardDist
      const {load,fadeCutoff,unload}=entryCutoffs(entry,metrics,guardDist)
      if(root){
        if(distance>unload){loaded.delete(entry);disposeGroup(root);continue}
        updateVisibility(entry,root,distance,fadeCutoff,metrics)
      }else if((distance<=load||nearCollision)&&!pending.has(entry)&&now>=(retry.get(entry)??0)){
        candidates.push({entry,distance,nearCollision})
      }
    }
    if(!candidates.length)return
    candidates.sort((a,b)=>{
      if(a.nearCollision!==b.nearCollision)return a.nearCollision?-1:1
      return a.distance-b.distance
    })
    const innerBusy=options?.isInnerBusy?.()??false
    const inFlight=pending.size-fetchedQueue.length-decodedQueue.length-attachQueue.length-(parsing?1:0)-(compiling?1:0)
    for(const candidate of candidates){
      if(innerBusy&&!candidate.nearCollision)break
      const maxPending=candidate.nearCollision?4:candidate.distance<=metrics.landmarkLod0?Math.max(metrics.landmarkConcurrency,3):metrics.landmarkConcurrency
      if(inFlight>=maxPending||pending.size>=maxPending+4)break
      loadEntry(candidate.entry,candidate.nearCollision)
    }
  }
  return Object.assign(tick,{
    busyPriorityCount:()=>priorityPending.size,
    pendingCount:()=>pending.size,
    pendingFiles:()=>Array.from(pending,entry=>entry.file),
  })
}
