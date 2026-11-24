import * as THREE from 'three'
import type {HitDiagnostic} from '../../../lib/feedback-contract'

export function describeHit(hit:THREE.Intersection|undefined,layer:string,owner:string):HitDiagnostic|null {
  if(!hit?.face || !(hit.object instanceof THREE.Mesh))return null
  const mesh=hit.object, matrix=mesh.matrixWorld.clone(), local=new THREE.Matrix4(), bounds=new THREE.Box3()
  if(mesh instanceof THREE.BatchedMesh && hit.batchId!==undefined){
    mesh.getMatrixAt(hit.batchId,local);matrix.multiply(local)
    mesh.getBoundingBoxAt(mesh.getGeometryIdAt(hit.batchId),bounds);owner+=':'+hit.batchId
  }else{
    if(mesh instanceof THREE.InstancedMesh && hit.instanceId!==undefined){mesh.getMatrixAt(hit.instanceId,local);matrix.multiply(local);owner+=':'+hit.instanceId}
    if(mesh instanceof THREE.SkinnedMesh){mesh.computeBoundingBox();bounds.copy(mesh.boundingBox!)}
    else {if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();bounds.copy(mesh.geometry.boundingBox!)}
  }
  bounds.applyMatrix4(matrix)
  const rounded=(point:THREE.Vector3)=>point.toArray().map(value=>Math.round(value*1000)/1000)
  const triangle=[hit.face.a,hit.face.b,hit.face.c].map(index=>rounded(mesh.getVertexPosition(index,new THREE.Vector3()).applyMatrix4(matrix)))
  const box=[rounded(bounds.min),rounded(bounds.max)]
  if(![...box,...triangle].flat().every(value=>Number.isFinite(value)&&Math.abs(value)<=1e8))return null
  return {layer,name:(mesh.name||mesh.type).slice(0,120),owner:owner.slice(0,120),distance:hit.distance,triangle,box}
}

export function dynamicPick(scene:THREE.Scene,ray:THREE.Raycaster){
  const meshes:THREE.Mesh[]=[],owners=new Map<THREE.Object3D,string>()
  scene.traverseVisible(node=>{
    if(!(node instanceof THREE.Mesh))return
    let owner=node instanceof THREE.SkinnedMesh?'character':''
    for(let parent:THREE.Object3D|null=node;parent;parent=parent.parent){
      if(parent.name==='G2 traffic visuals'){owner='traffic';break}
      if(parent.userData.vehicleType||parent.name==='dynamic-car'){owner='vehicle';break}
    }
    if(owner){meshes.push(node);owners.set(node,owner)}
  })
  const hit=ray.intersectObjects(meshes,false)[0]
  return hit?describeHit(hit,'dynamic',owners.get(hit.object)+':'+hit.object.id):null
}
