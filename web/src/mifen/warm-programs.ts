import * as THREE from 'three'
import {nightLit} from '../look/night'
import {bindAtmo, bindSurfaceMaster, bindVcEmissive} from './shader-binders'

export function shopProgramVariants() {
  const geometry = new THREE.BufferGeometry(), map = new THREE.Texture()
  const standard = (options:THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(options)
  const materials = [
    bindAtmo(standard({map, emissiveMap:map})),
    bindAtmo(standard({map, normalMap:map, roughnessMap:map, emissiveMap:map})),
    bindAtmo(standard({map, alphaTest:.4, side:THREE.DoubleSide})),
    bindAtmo(standard({map, transparent:true, side:THREE.DoubleSide})),
    bindVcEmissive(standard({vertexColors:true, transparent:true, side:THREE.DoubleSide})),
    bindSurfaceMaster(standard({map, vertexColors:true, side:THREE.DoubleSide}), [], [0,0]),
  ]
  for (const cutout of [false,true]) {
    const sign = standard({map, emissiveMap:map, alphaTest:cutout?.5:0, side:cutout?THREE.DoubleSide:THREE.FrontSide})
    sign.name='arrival_signs'; nightLit(sign); materials.push(sign)
  }
  const batch = new THREE.Group()
  const colored = {vertexColors:true}, double = {side:THREE.DoubleSide}
  const pbr = {...colored,map,normalMap:map}
  materials.push(
    bindVcEmissive(standard({...pbr, roughnessMap:map, emissiveMap:map})),
    bindVcEmissive(standard({...pbr, emissiveMap:map})),
    bindSurfaceMaster(standard({...colored,map}), [], [0,0]),
    bindSurfaceMaster(standard({...pbr,roughnessMap:map}), [], [0,0]),
    bindVcEmissive(standard({...colored,...double})), standard({transparent:true}),
  )
  const sign = standard(colored); sign.name='vc_emissive_signs'; nightLit(sign); materials.push(sign)
  batch.add(new THREE.SkinnedMesh(geometry,bindVcEmissive(standard({...colored,...double,map,emissiveMap:map}))))
  const steamGeometry = new THREE.BufferGeometry().setAttribute('color',new THREE.Float32BufferAttribute([],4))
  batch.add(new THREE.Points(steamGeometry,bindAtmo(new THREE.PointsMaterial({...colored,map,transparent:true}))))
  for (const material of materials) batch.add(new THREE.Mesh(geometry,material))
  return batch
}
