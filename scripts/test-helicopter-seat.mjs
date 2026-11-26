import assert from 'node:assert/strict'
import test from 'node:test'
import {Group, Quaternion, Vector3} from 'three'
import {passengerOrientation} from '../web/src/helicopter/seat-frame.ts'

test('seated Walker faces the nose even on a banked, pitched airframe',()=>{
  const craft=new Group(),seat=new Group();craft.add(seat)
  for(const heading of [0,.8,Math.PI,-2.5]){
    craft.rotation.set(.17,heading,-.43,'YXZ')
    const nose=craft.getWorldDirection(new Vector3())
    const face=new Vector3(0,0,-1).applyQuaternion(passengerOrientation(seat,new Quaternion()))
    assert.ok(face.angleTo(nose)<Math.PI/18)
  }
})
