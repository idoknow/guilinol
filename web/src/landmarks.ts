import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'
import {flags} from './debug'
import {nightLit} from './look/night'
import {sharedKtx2Loader} from './look/tiles'

export {landmarkCulling} from './landmark-culling'

export interface Landmark {
  id:string; name?:string; file:string; position:[number,number,number]; rotation:number; collision:'mesh'|'box'|'none'; lods:string[]
  sphere:[number,number,number,number]; bytes:number
}
export type LoadedLandmarks = Map<Landmark,THREE.Group>

/** 每个地标在什么距离上还看得见（和下面换 LOD 的阈值一致）。 */
function visibleWithin(entry:Landmark){ return entry.lods.includes('lod2')?900:650 }

export interface LandmarkStreamer {
  (eye:THREE.Vector3, priority?:Landmark, direction?:THREE.Vector3):void
  /** 同时在下载的地标数。手机上行窄，开太多反而互相拖。 */
  budget:number
  /** 街块还在补的时候返回 true：大 GLB 先让路给世界。 */
  urgent?:()=>boolean
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

/**
 * 地标（独立 GLB）的流式加载。旧实现按清单顺序、一次只下两个，
 * 结果站在正阳门前要先等完 11 MB 的王城市场，眼前那道 10 KB 的城门一直是空的。
 *
 * 现在的排队规则：
 * - 只下「这个距离上还看得见」的（大部分地标 650 m 外已经淡出，下它纯属浪费流量）；
 * - 按球体表面距离排序（不是中心距离），背后的稍微让一让；
 * - 同时开 4 条，让手机网络吃满，而不是一条大文件堵住所有人；
 * - 街块还在补的时候只允许很近的模型先下，别让 GLB 抢走世界数据的带宽。
 */
export function landmarkStream(scene:THREE.Scene,renderer:THREE.WebGLRenderer,entries:Landmark[],loaded:LoadedLandmarks):LandmarkStreamer {
  const loaderReady=sharedKtx2Loader(renderer).then(basis=>new GLTFLoader().setKTX2Loader(basis).setMeshoptDecoder(MeshoptDecoder))
  const pending=new Set<Landmark>(), retry=new Map<Landmark,number>()
  const fades=new WeakMap<THREE.Group,THREE.IUniform<number>>()

  function dispose(root:THREE.Group){
    const assets=new Set<THREE.BufferGeometry|THREE.Material|THREE.Texture>()
    root.traverse(node=>{if(node instanceof THREE.Mesh){if(node instanceof THREE.InstancedMesh)node.dispose();assets.add(node.geometry)
      for(const material of [node.material].flat()) {assets.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)assets.add(value)}
    }})
    scene.remove(root);for(const asset of assets)asset.dispose()
  }

  function load(entry:Landmark){
    // 404 的模型不会再自己出现，退避一小时：否则传送/遮罩期间的对齐循环会每秒重试一次。
    if(pending.has(entry)||(retry.get(entry)??0)>performance.now())return
    pending.add(entry)
    loaderReady.then(loader=>loader.loadAsync('./'+entry.file)).then(({scene:group,parser})=>{
      group.position.fromArray(entry.position);group.rotation.y=THREE.MathUtils.degToRad(entry.rotation)
      group.traverse(node=>{
        if(/^collision/i.test(node.name))node.visible=false
        if(node instanceof THREE.Mesh) for(const material of [node.material].flat()) nightLit(material)
      })
      const coverage={value:1}
      fades.set(group,coverage)
      for(const asset of parser.associations.keys()){
        if(asset instanceof THREE.Material)fadeMaterial(asset,coverage)
      }
      batchRepeatedMeshes(group)
      scene.add(group);group.updateMatrixWorld(true);loaded.set(entry,group)
    }).catch(error=>{
      console.warn(entry.id,error)
      const missing=/\b404\b/.test(String(error))
      retry.set(entry,performance.now()+(missing?3600e3:30000))
    }).finally(()=>pending.delete(entry))
  }

  const streamer=((eye:THREE.Vector3,priority?:Landmark,direction?:THREE.Vector3)=>{
    const now=performance.now()
    // 已经加载的：换 LOD、按距离淡出、走远释放
    for(const [entry,root] of loaded){
      const distance=Math.hypot(eye.x-entry.position[0],eye.y-entry.position[1],eye.z-entry.position[2])-entry.sphere[3]
      if(distance>900){loaded.delete(entry);dispose(root);continue}
      const cutoff=visibleWithin(entry)
      const coverage=fades.get(root)
      if(coverage)coverage.value=1-THREE.MathUtils.smoothstep(distance,cutoff-60,cutoff)
      const level=distance>650?'lod2':distance>350?'lod1':'lod0'
      if(entry.lods.length){for(const name of entry.lods){const node=root.getObjectByName(name);if(node)node.visible=name===level}}
      else root.visible=distance<=650
    }
    if(priority){load(priority);return}
    // 退化行为（只给 scripts/load-audit.mjs 做对照）：按清单顺序、一次两个、900 m 内都下。
    // 站在正阳门前时要先等完 11 MB 的王城市场，眼前那道 10 KB 的城门一直空着。
    if(flags.legacyStream){
      for(const entry of entries){
        if(loaded.has(entry))continue
        const distance=Math.hypot(eye.x-entry.position[0],eye.y-entry.position[1],eye.z-entry.position[2])-entry.sphere[3]
        if(distance>900||pending.has(entry)||pending.size>=2||(retry.get(entry)??0)>=now)continue
        load(entry)
      }
      return
    }
    const crowded=streamer.urgent?.()===true
    const candidates:{entry:Landmark;score:number}[]=[]
    for(const entry of entries){
      if(loaded.has(entry)||pending.has(entry))continue
      if((retry.get(entry)??0)>=now)continue
      const dx=entry.position[0]-eye.x, dy=entry.position[1]-eye.y, dz=entry.position[2]-eye.z
      const surface=Math.hypot(dx,dy,dz)-entry.sphere[3]
      if(surface>visibleWithin(entry))continue
      // 街块在补的时候只留近处的：远模型晚两秒没人看得出，世界缺块很扎眼
      if(crowded&&surface>120)continue
      const len=Math.hypot(dx,dz)||1
      const ahead=direction?(dx*direction.x+dz*direction.z)/len:1
      // 背后的先让一让：转身就能看见的东西不值得排在正前方之前
      candidates.push({entry,score:surface+(ahead<-.2?220:0)})
    }
    if(!candidates.length)return
    candidates.sort((a,b)=>a.score-b.score)
    for(const {entry} of candidates){
      if(pending.size>=streamer.budget)break
      load(entry)
    }
  }) as LandmarkStreamer
  streamer.budget=4
  return streamer
}
