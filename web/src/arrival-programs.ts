import * as THREE from 'three'
import {fadeMaterial} from './landmarks'
import {nightLit} from './look/night'
import {streetShading} from './walk/creator-ink'
import {shopProgramVariants} from './mifen/warm-programs'

export function arrivalPrograms(){
  const batch=shopProgramVariants(), geometry=new THREE.BufferGeometry(), map=new THREE.Texture()
  const flat={flatShading:true}, double={side:THREE.DoubleSide}, facade={...flat,...double,map}
  const glow={map,emissiveMap:map}, glass={...flat,...double,transparent:true}
  function add(options:THREE.MeshStandardMaterialParameters,name='',fade=false,instance=false){
    const material=new THREE.MeshStandardMaterial(options)
    material.name=name; nightLit(material)
    if(fade)fadeMaterial(material,{value:1})
    batch.add(instance?new THREE.InstancedMesh(geometry,material,1):new THREE.Mesh(geometry,material))
  }
  add(glass); add({...glow,...flat}); add({...facade,emissiveMap:map}); add({...facade,emissiveMap:map},'building_lit')
  add({vertexColors:true,...double}); add(facade,'building_signs'); add(facade,'building_lit'); add({map}); add({...double,map},'building_surfaces')
  add(flat,'',true); add({map},'',true); add({},'',true); add(facade,'',true); add(glass,'',true)
  add({...facade,emissiveMap:map},'',true); add({...facade,emissiveMap:map},'building_lit',true)
  add(glow,'building_lit',true); add({},'building_lit',true); add(facade,'building_lit',true)
  add(facade,'building_surfaces',true); add({map},'building_surfaces',true); add({map},'building_surfaces',true,true)
  add(facade,'building_curtain_glass',true)
  add({...double,map},'building_lit');add({...double,map},'building_lit',true)
  add({...double,map},'building_surfaces',true)
  const rockGeometry=new THREE.BufferGeometry().setAttribute('color',new THREE.Float32BufferAttribute([],4))
  const rock=new THREE.MeshStandardMaterial({...flat,vertexColors:true}); fadeMaterial(rock,{value:1})
  batch.add(new THREE.Mesh(rockGeometry,rock))
  const parked=new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial(),1)
  parked.setColorAt(0,new THREE.Color(0xffffff));batch.add(parked)
  const skirt=new THREE.MeshStandardMaterial(double);streetShading(skirt);batch.add(new THREE.SkinnedMesh(geometry,skirt))
  return batch
}
