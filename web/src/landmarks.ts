import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'
import {nightLit} from './look/night'

export interface Landmark {
  id:string; name?:string; file:string; position:[number,number,number]; rotation:number; collision:'mesh'|'box'|'none'; lods:string[]
  sphere:[number,number,number,number]; bytes:number
}
export type LoadedLandmarks = Map<Landmark,THREE.Group>

function batchShopBays(root:THREE.Group){
  root.updateMatrixWorld(true)
  for(const name of ['lod0','lod1']){
    const layer=root.getObjectByName(name)
    if(!layer)continue
    const batches=new Map<string,THREE.Mesh[]>()
    for(const bay of layer.children.filter(node=>node.name.startsWith(name+'_bay'))){
      bay.traverse(node=>{
        if(!(node instanceof THREE.Mesh)||Array.isArray(node.material))return
        const key=node.geometry.uuid+node.material.uuid
        const group=batches.get(key)??[];group.push(node);batches.set(key,group)
      })
    }
    const inverse=layer.matrixWorld.clone().invert()
    for(const meshes of batches.values()){
      if(meshes.length<2)continue
      const batch=new THREE.InstancedMesh(meshes[0].geometry,meshes[0].material,meshes.length)
      meshes.forEach((mesh,index)=>{batch.setMatrixAt(index,new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld));mesh.removeFromParent()})
      layer.add(batch)
    }
  }
}

export function landmarkStream(scene:THREE.Scene,renderer:THREE.WebGLRenderer,entries:Landmark[],loaded:LoadedLandmarks){
  const basis=new KTX2Loader().setTranscoderPath('./basis/').setWorkerLimit(2).detectSupport(renderer)
  const loader=new GLTFLoader().setKTX2Loader(basis).setMeshoptDecoder(MeshoptDecoder)
  const pending=new Set<Landmark>(), retry=new Map<Landmark,number>()
  function dispose(root:THREE.Group){
    const assets=new Set<THREE.BufferGeometry|THREE.Material|THREE.Texture>()
    root.traverse(node=>{if(node instanceof THREE.Mesh){if(node instanceof THREE.InstancedMesh)node.dispose();assets.add(node.geometry)
      for(const material of [node.material].flat()) {assets.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)assets.add(value)}
    }})
    scene.remove(root);for(const asset of assets)asset.dispose()
  }
  return (eye:THREE.Vector3, priority?:Landmark)=>{
    for(const entry of priority?[priority]:entries){
      const distance=Math.hypot(eye.x-entry.position[0],eye.y-entry.position[1],eye.z-entry.position[2])-entry.sphere[3]
      const root=loaded.get(entry)
      if(root){
        if(distance>900){loaded.delete(entry);dispose(root);continue}
        const level=distance>650?'lod2':distance>350?'lod1':'lod0'
        if(entry.lods.length){for(const name of entry.lods){const node=root.getObjectByName(name);if(node)node.visible=name===level}}
        else root.visible=distance<=650
      }else if(distance<=900&&!pending.has(entry)&&(priority||pending.size<2)&&performance.now()>=(retry.get(entry)??0)){
        pending.add(entry)
        loader.loadAsync('./'+entry.file).then(({scene:group})=>{
          if(entry.id==='wangcheng_market')batchShopBays(group)
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
