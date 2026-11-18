import * as THREE from 'three'
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export function treeGeometry(species:number) {
  const radius=[3.8,5.4,2.4,2.1,2.2,1.3][species],height=[6,7,4,8,7,1.4][species]
  const crown=species===4?new THREE.ConeGeometry(radius,height,5):new THREE.OctahedronGeometry(radius)
  if(crown.index) {const flat=crown.toNonIndexed();crown.dispose();return assemble(flat)}
  return assemble(crown)
  function assemble(far:THREE.BufferGeometry){
    far.translate(0,height,0)
    const trunk=new THREE.CylinderGeometry(.32,.42,height,6).translate(0,height/2,0).toNonIndexed()
    const near=mergeGeometries([trunk,far]);trunk.dispose()
    return {near,far,material:new THREE.MeshStandardMaterial({color:0x527449,flatShading:true})}
  }
}
