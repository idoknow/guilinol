import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'
import {nightLit} from './look/night'
import {sharedKtx2Loader} from './look/tiles'

export interface Landmark {
  id:string; file:string; position:[number,number,number]; rotation:number; collision:'mesh'|'box'|'none'; lods:string[]
  sphere:[number,number,number,number]; bytes:number
}
export type LoadedLandmarks = Map<Landmark,THREE.Group>

export function landmarkStream(scene:THREE.Scene,renderer:THREE.WebGLRenderer,entries:Landmark[],loaded:LoadedLandmarks){
  const loaderReady=sharedKtx2Loader(renderer).then(basis=>new GLTFLoader().setKTX2Loader(basis).setMeshoptDecoder(MeshoptDecoder))
  const pending=new Set<Landmark>(), retry=new Map<Landmark,number>()
  function dispose(root:THREE.Group){
    const assets=new Set<THREE.BufferGeometry|THREE.Material|THREE.Texture>()
    root.traverse(node=>{if(node instanceof THREE.Mesh){assets.add(node.geometry)
      for(const material of [node.material].flat()) {assets.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)assets.add(value)}
    }})
    scene.remove(root);for(const asset of assets)asset.dispose()
  }
  return (eye:THREE.Vector3)=>{
    for(const entry of entries){
      const distance=Math.hypot(eye.x-entry.position[0],eye.y-entry.position[1],eye.z-entry.position[2])-entry.sphere[3]
      const root=loaded.get(entry)
      if(root){
        if(distance>900){loaded.delete(entry);dispose(root);continue}
        const level=distance>650?'lod2':distance>350?'lod1':'lod0'
        if(entry.lods.length){for(const name of entry.lods){const node=root.getObjectByName(name);if(node)node.visible=name===level}}
        else root.visible=distance<=650
      }else if(distance<=900&&!pending.has(entry)&&pending.size<2&&performance.now()>=(retry.get(entry)??0)){
        pending.add(entry)
        loaderReady.then(loader=>loader.loadAsync('./'+entry.file)).then(({scene:group})=>{
          group.position.fromArray(entry.position);group.rotation.y=THREE.MathUtils.degToRad(entry.rotation)
          group.traverse(node=>{
            if(/^collision/i.test(node.name))node.visible=false
            if(node instanceof THREE.Mesh) for(const material of [node.material].flat()) nightLit(material)
          })
          scene.add(group);group.updateMatrixWorld(true);loaded.set(entry,group)
        }).catch(error=>{console.warn(entry.id,error);retry.set(entry,performance.now()+30000)}).finally(()=>pending.delete(entry))
      }
    }
  }
}
