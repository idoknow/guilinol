import assert from 'node:assert/strict'
import test from 'node:test'
import {Vector3} from 'three'
import {clearTerrain} from '../web/src/roadbed-clearance.ts'

test('a clear road keeps its original triangle',()=>{
  const face=[new Vector3(0,3,0),new Vector3(8,3,0),new Vector3(0,3,8)]
  assert.equal(clearTerrain(face,()=>1,4,.03)[0],face)
})

test('an interior terrain ridge cannot cut through a flat road',()=>{
  const face=[new Vector3(0,1,0),new Vector3(8,1,0),new Vector3(0,1,8)]
  const terrain=(east,south)=>2-Math.abs(east+south-4)/2
  const pieces=clearTerrain(face,terrain,4,.03)
  let area=0
  for(const poly of pieces)for(let i=2;i<poly.length;i++){
    const [first,second,third]=[poly[0],poly[i-1],poly[i]]
    const center=first.clone().add(second).add(third).divideScalar(3)
    assert.ok(center.y>=terrain(center.x,center.z)+.03-1e-8)
    area+=Math.abs((second.x-first.x)*(third.z-first.z)-(third.x-first.x)*(second.z-first.z))/2
  }
  assert.ok(Math.abs(area-32)<1e-8)
})
