import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {validView,viewToken} from '../lib/feedback-contract'
import {describeHit} from '../web/src/play/pick-diagnostic'
import {staticVerifier} from '../web/src/verify-static'
import type {Host} from '../web/src/play/host'

test('optional evidence stays out of pose links and malformed vectors are rejected',()=>{
  const pose={mode:'walk',x:0,y:160,z:0,lat:25.28,lon:110.3,alt:160,yaw:0,pitch:0,heading:0,fov:55,build:'a'.repeat(40),target:null,landmark_id:null} as const
  const hit={layer:'peak',name:'山',owner:'自带名称',distance:2,box:[[0,0,0],[1,1,1]],triangle:[[0,0,0],[0,1,0],[1,1,1]]}
  const view={...pose,diagnostic:{static:hit,dynamic:null}}
  assert.ok(validView(pose)&&validView(view));assert.equal(viewToken(view),viewToken(pose))
  hit.box[0][0]=NaN;assert.equal(validView(view),false)
})

test('instance evidence uses the struck transform, not the batch origin',()=>{
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),1)
  mesh.position.set(5,0,0);mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(10,2,1));mesh.updateMatrixWorld()
  const ray=new THREE.Raycaster(new THREE.Vector3(15,2,4),new THREE.Vector3(0,0,-1))
  const diagnostic=describeHit(ray.intersectObject(mesh)[0],'vehicle','car')!
  assert.equal(diagnostic.owner,'car:0');assert.deepEqual(diagnostic.box,[[14.5,1.5,.5],[15.5,2.5,1.5]])
  assert.ok(diagnostic.triangle.every(point=>point[2]===1.5))
})

test('valid individual peak bounds do not excuse a triangle indexing two owners',()=>{
  const scene=new THREE.Scene(),geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,200,0,1,199,0,0,199,1,600,200,0,601,199,0,600,199,1],3));geometry.setIndex([0,1,3])
  const mesh=new THREE.Mesh(geometry);mesh.userData.peakRanges=()=>({ends:[3,6],peaks:[{name:'west',center:[0,200,0]},{name:'east',center:[600,200,0]}]});scene.add(mesh)
  const audit=staticVerifier({scene,stream:{loaded:new Map(),landmarks:new Map()}} as unknown as Host)
  assert.deepEqual(audit.check().issues.map(item=>[item.layer,item.owner]),[['indices','west']])
  assert.equal(mesh.visible,true)
})
