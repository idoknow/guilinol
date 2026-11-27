import assert from 'node:assert/strict'
import test from 'node:test'
import {medianRails} from '../web/src/median-rails.ts'

function geometry(decor) {
  const legs=[],posts=[]
  medianRails(decor,()=>false,(start,end,banner)=>legs.push([start,end,banner]),point=>posts.push([point.x,point.z]))
  return {legs,posts}
}

test('bend shares one endpoint; posts follow chainage, not panel centres',()=>{
  const {legs,posts}=geometry([[1,10,0,0,20,0,0,200,0],[2,20,15,157,30,200,0,200,300]])
  assert.equal(legs[0][1],legs[1][0]);assert.equal(legs[1][2],true)
  assert.deepEqual(posts.sort(),[[0,0],[1,0],[2,0],[2,1],[2,2],[2,3]].sort())
})

test('legacy spans weld quantization noise, never span a crosswalk',()=>{
  const {legs,posts}=geometry([[1,15,0,0,30],[1,46,0,0,30],[1,115,0,0,30],[6,80,0,0,40]])
  assert.equal(legs.length,3);assert.equal(legs[0][1],legs[1][0]);assert.notEqual(legs[1][1],legs[2][0]);assert.ok(posts.every(([x])=>x<=6.1||x>=10))
})

test('precise crossing edges do not get legacy endpoint tolerance',()=>{
  const {legs}=geometry([[1,10,0,0,20,0,0,200,0],[1,30,0,0,20,208,0,400,0]])
  assert.notEqual(legs[0][1],legs[1][0]);assert.equal(legs[1][0].x,2.08)
})
