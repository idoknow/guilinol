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
  onPendingChange?:()=>void
  getMetrics?: () => RenderRangeMetrics
  isInnerBusy?: () => boolean
}

const fallbackMetrics = deriveRangeMetrics(RENDER_RADIUS_DEFAULT)

function landmarkDistance(eye:THREE.Vector3, entry:Landmark){
  return Math.hypot(eye.x-entry.position[0],eye.y-entry.position[1],eye.z-entry.position[2])-entry.sphere[3]
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

// Fade the last available LOD before its stream cutoff. Dithering keeps opaque
// depth and draw ordering intact through the transition.
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

export function landmarkStream(
  scene:THREE.Scene,
  renderer:THREE.WebGLRenderer,
  entries:Landmark[],
  loaded:LoadedLandmarks,
  options?:LandmarkStreamOptions,
){
  const loaderReady=sharedKtx2Loader(renderer).then(basis=>new GLTFLoader().setKTX2Loader(basis).setMeshoptDecoder(MeshoptDecoder))
  const pending=new Set<Landmark>(), priorityPending=new Set<Landmark>(), retry=new Map<Landmark,number>()
  const fades=new WeakMap<THREE.Group,THREE.IUniform<number>>()
  function dispose(root:THREE.Group){
    const assets=new Set<THREE.BufferGeometry|THREE.Material|THREE.Texture>()
    for(const asset of root.userData.replacedAssets??[])assets.add(asset)
    root.traverse(node=>{if(node instanceof THREE.Mesh){if(node instanceof THREE.InstancedMesh)node.dispose();assets.add(node.geometry)
      for(const material of [node.material].flat()) {if(material===streetSurfaceMat)continue;assets.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)assets.add(value)}
    }})
    scene.remove(root);for(const asset of assets)asset.dispose()
  }
  function loadEntry(entry:Landmark, isPriority:boolean){
    if(loaded.has(entry)||pending.has(entry))return
    pending.add(entry)
    options?.onPendingChange?.()
    if(isPriority)priorityPending.add(entry)
    if(retry.has(entry))record('retry',{category:'landmark'})
    loaderReady.then(loader=>loader.loadAsync('./'+entry.file)).then(({scene:group,parser})=>{
      group.position.fromArray(entry.position);group.rotation.y=THREE.MathUtils.degToRad(entry.rotation)
      const surfaces:Record<string,string>=(seamConfig.surfaces as Record<string,Record<string,string>>)[entry.id]??{}
      const exceptions=seamConfig.exceptions.filter((item:{kind?:string})=>!item.kind||item.kind==='material')
      type AtlasRule={material:string,role:string,box:number[]}
      const atlas=(seamConfig.atlas as Record<string,AtlasRule|AtlasRule[]>)[entry.id]
      const regions=atlas?[atlas].flat():[]
      group.userData.replacedAssets=new Set()
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
              group.userData.replacedAssets.add(source)
              node.geometry=remainder
            }
            node.add(atlasStreetMesh(node,selected,rule.role))
            remainder.setIndex(rest)
          }
        }
        if(kind&&!exceptions.some(item=>item.id===entry.id&&item.material===original.name)){
          const retired=group.userData.replacedAssets
          retired.add(original);retired.add(node.geometry)
          for(const value of Object.values(original))if(value instanceof THREE.Texture)retired.add(value)
          node.geometry=node.geometry.clone();bindStreetSurface(node.geometry,kind);node.material=streetSurfaceMat
        }else for(const material of [original].flat())nightLit(material)
      })
      const coverage={value:1}
      fades.set(group,coverage)
      for(const asset of parser.associations.keys()){
        if(asset instanceof THREE.Material)fadeMaterial(asset,coverage)
      }
      batchRepeatedMeshes(group)
      scene.add(group);freezeStatic(group);loaded.set(entry,group);retry.delete(entry)
    }).catch(error=>{record('failure',{category:'landmark'});console.warn(entry.id,error);retry.set(entry,performance.now()+30000)}).finally(()=>{
      pending.delete(entry);priorityPending.delete(entry)
      options?.onPendingChange?.()
    })
  }
  function entryCutoffs(entry:Landmark,metrics:RenderRangeMetrics,guardDist:number){
    const load=Math.max(guardDist,metrics.landmarkLoadRadius)
    const fadeCutoff=Math.max(guardDist,entry.lods.includes('lod2')?metrics.landmarkLoadRadius:metrics.landmarkLod1)
    const unload=Math.max(guardDist+80,load+160)
    return {load,fadeCutoff,unload}
  }
  function updateVisibility(entry:Landmark,root:THREE.Group,distance:number,fadeCutoff:number,metrics:RenderRangeMetrics,guardDist:number){
    const visible=distance<fadeCutoff
    root.visible=visible
    if(!visible)return
    const coverage=fades.get(root)
    if(coverage)coverage.value=1-THREE.MathUtils.smoothstep(distance,fadeCutoff-60,fadeCutoff)
    if(entry.lods.length){
      const level=distance>metrics.landmarkLod1?'lod2':distance>metrics.landmarkLod0?'lod1':'lod0'
      const lods=getLodNodes(root)
      for(const name of entry.lods){
        const node=lods[name as keyof typeof lods]??root.getObjectByName(name)
        if(node)node.visible=name===level
      }
    }
  }
  const tick = (eye:THREE.Vector3, priority?:Landmark)=>{
    const metrics=options?.getMetrics?.()??fallbackMetrics
    const guardDist=metrics.spawnRingEdge+48
    if(priority){
      const distance=landmarkDistance(eye,priority)
      const root=loaded.get(priority)
      if(root){
        const {fadeCutoff}=entryCutoffs(priority,metrics,guardDist)
        updateVisibility(priority,root,distance,fadeCutoff,metrics,guardDist)
      }else if(!pending.has(priority)&&performance.now()>=(retry.get(priority)??0)){
        loadEntry(priority,true)
      }
      return
    }

    const now=performance.now()
    const candidates:{entry:Landmark; distance:number; nearCollision:boolean}[]=[]
    for(const entry of entries){
      const distance=landmarkDistance(eye,entry)
      const root=loaded.get(entry)
      const nearCollision=entry.collision!=='none'&&distance<=guardDist
      const {load,fadeCutoff,unload}=entryCutoffs(entry,metrics,guardDist)
      if(root){
        if(distance>unload){loaded.delete(entry);dispose(root);continue}
        updateVisibility(entry,root,distance,fadeCutoff,metrics,guardDist)
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
    for(const candidate of candidates){
      if(innerBusy&&!candidate.nearCollision)break
      const maxPending=candidate.nearCollision?4:candidate.distance<=metrics.landmarkLod0?Math.max(metrics.landmarkConcurrency,3):metrics.landmarkConcurrency
      if(pending.size>=maxPending)break
      loadEntry(candidate.entry,candidate.nearCollision)
    }
  }
  return Object.assign(tick,{
    busyPriorityCount:()=>priorityPending.size,
    pendingCount:()=>pending.size,
    pendingFiles:()=>Array.from(pending,entry=>entry.file),
  })
}
