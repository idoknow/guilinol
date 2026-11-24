import * as THREE from 'three'
import {nightLit} from '../look/night'
import {bindAtmo, bindSurfaceMaster, bindVcEmissive} from './shader-binders'

export async function warmShopPrograms(warm:(root:THREE.Object3D)=>Promise<void>) {
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
  for (const material of materials) {
    await new Promise<void>(resolve => {
      if ('requestIdleCallback' in window) requestIdleCallback(()=>resolve(), {timeout:100})
      else requestAnimationFrame(()=>resolve())
    })
    await warm(new THREE.Mesh(geometry,material))
  }
}
