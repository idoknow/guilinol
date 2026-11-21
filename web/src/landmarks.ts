import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'
import {nightLit} from './look/night'
import {sharedKtx2Loader} from './look/tiles'
import {bindStreetSurface,streetSurfaceMat} from './streets'
import seamConfig from '../../pipeline/seam-surfaces.json'
import {atlasTriangles} from '../../lib/atlas-ground.mjs'

export {landmarkCulling} from './landmark-culling'

export interface Landmark {
  id:string; name?:string; file:string; position:[number,number,number]; rotation:number; collision:'mesh'|'box'|'none'; lods:string[]
  sphere:[number,number,number,number]; bytes:number
}
export type LoadedLandmarks = Map<Landmark,THREE.Group>

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

export function landmarkStream(scene:THREE.Scene,renderer:THREE.WebGLRenderer,entries:Landmark[],loaded:LoadedLandmarks){
  const loaderReady=sharedKtx2Loader(renderer).then(basis=>new GLTFLoader().setKTX2Loader(basis).setMeshoptDecoder(MeshoptDecoder))
  const pending=new Set<Landmark>(), retry=new Map<Landmark,number>()
  const fades=new WeakMap<THREE.Group,THREE.IUniform<number>>()
  function dispose(root:THREE.Group){
    const assets=new Set<THREE.BufferGeometry|THREE.Material|THREE.Texture>()
    for(const asset of root.userData.replacedAssets??[])assets.add(asset)
    root.traverse(node=>{if(node instanceof THREE.Mesh){if(node instanceof THREE.InstancedMesh)node.dispose();assets.add(node.geometry)
      for(const material of [node.material].flat()) {if(material===streetSurfaceMat)continue;assets.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)assets.add(value)}
    }})
    scene.remove(root);for(const asset of assets)asset.dispose()
  }
  return (eye:THREE.Vector3, priority?:Landmark)=>{
    const candidates:{entry:Landmark,range:number}[]=[]
    for(const entry of priority?[priority]:entries){
      const distance=Math.hypot(eye.x-entry.position[0],eye.y-entry.position[1],eye.z-entry.position[2])-entry.sphere[3]
      const root=loaded.get(entry)
      if(root){
        if(distance>900){loaded.delete(entry);dispose(root);continue}
        const cutoff=entry.lods.includes('lod2')?900:650
        const coverage=fades.get(root)
        if(coverage)coverage.value=1-THREE.MathUtils.smoothstep(distance,cutoff-60,cutoff)
        const level=distance>650?'lod2':distance>350?'lod1':'lod0'
        if(entry.lods.length){for(const name of entry.lods){const node=root.getObjectByName(name);if(node)node.visible=name===level}}
        else root.visible=distance<=650
      }else if(distance<=900&&!pending.has(entry)&&(priority||pending.size<2)&&performance.now()>=(retry.get(entry)??0)){
        candidates.push({entry,range:Math.hypot(eye.x-entry.position[0],eye.z-entry.position[2])})
      }
    }
    candidates.sort((first,second)=>first.range-second.range)
    for(const {entry} of candidates.slice(0,priority?1:Math.max(0,2-pending.size))){
      pending.add(entry)
      loaderReady.then(loader=>loader.loadAsync('./'+entry.file)).then(({scene:group,parser})=>{
        group.position.fromArray(entry.position);group.rotation.y=THREE.MathUtils.degToRad(entry.rotation)
        const surfaces:Record<string,string>=(seamConfig.surfaces as Record<string,Record<string,string>>)[entry.id]??{}
        const exceptions=seamConfig.exceptions.filter((item:{kind?:string})=>!item.kind||item.kind==='material')
        const atlas=(seamConfig.atlas as Record<string,{material:string,role:string,box:number[]}>)[entry.id]
        group.userData.replacedAssets=new Set()
        group.traverse(node=>{
          if(/^collision/i.test(node.name))node.visible=false
          if(!(node instanceof THREE.Mesh))return
          const original=node.material,kind=surfaces[original.name]
          if(atlas&&original.name===atlas.material&&!exceptions.some(item=>item.id===entry.id&&item.material===atlas.material)){
            const {selected,rest}=atlasTriangles(node.geometry,atlas.box,original.map?.repeat.toArray(),original.map?.offset.toArray())
            if(selected.length){
              const geometry=node.geometry.clone();group.userData.replacedAssets.add(node.geometry)
              geometry.setIndex(rest.concat(selected));geometry.clearGroups()
              geometry.addGroup(0,rest.length,0);geometry.addGroup(rest.length,selected.length,1)
              bindStreetSurface(geometry,atlas.role);node.geometry=geometry;node.material=[original,streetSurfaceMat]
              nightLit(original);return
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
        scene.add(group);group.updateMatrixWorld(true);loaded.set(entry,group)
      }).catch(error=>{console.warn(entry.id,error);retry.set(entry,performance.now()+30000)}).finally(()=>pending.delete(entry))
    }
  }
}
