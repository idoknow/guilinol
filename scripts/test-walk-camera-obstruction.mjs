import assert from 'node:assert/strict'
import {test} from 'node:test'
import {PerspectiveCamera, Vector3} from 'three'
import {createCameraRig} from '../web/src/walk/camera.ts'

for (const fps of [30, 60, 120]) test(`wall edge at ${fps} fps`, t => {
  globalThis.document = {body:{hasAttribute:()=>false}}
  t.after(()=>delete globalThis.document)
  let wall=false
  const rig=createCameraRig({hasDeck:()=>false,surface:()=>null,world:{
    castRay:()=>null,castShape:()=>wall?{time_of_impact:1.02}:null,
  }})
  const camera=new PerspectiveCamera(),foot=new Vector3(0,156,0),dt=1/fps
  const frame=()=>rig.update(camera,foot,.7,.28,11,dt)
  frame(); assert.equal(rig.distance,11)
  for(let index=0;index<fps;index++){
    wall=index%2===0;frame();assert.equal(rig.distance,1,'a brief gap must not pump the arm')
  }
  wall=false
  for(let index=0;index<fps*4;index++){
    const previous=rig.distance;frame();assert.ok(rig.distance>=previous && rig.distance-previous<=6*dt+1e-8)
  }
  assert.ok(rig.distance>10.99)
  wall=true;frame();assert.equal(rig.distance,1,'never delay an inward collision correction')
  wall=false;rig.reset(11);frame();assert.equal(rig.distance,11)
})
