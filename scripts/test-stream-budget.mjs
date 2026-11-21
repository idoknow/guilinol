import assert from 'node:assert/strict'
import {test} from 'node:test'
import {frameSlots} from '../web/src/tile-grid.ts'

test('multiple cheap jobs share a frame and an oversized job still advances', async t=>{
  const frames=[]
  let now=0
  t.mock.method(performance,'now',()=>now)
  const previous=globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame=callback=>frames.push(callback)
  t.after(()=>{
    if(previous)globalThis.requestAnimationFrame=previous
    else delete globalThis.requestAnimationFrame
  })

  const slot=frameSlots(5), finished=[]
  const jobs=[2,3,8,1].map(async (cost,index)=>{
    await slot()
    now+=cost
    finished.push(index)
  })
  for(const expected of [[0,1],[0,1,2],[0,1,2,3]]){
    assert.equal(frames.length,1)
    frames.shift()(now)
    await new Promise(resolve=>setImmediate(resolve))
    assert.deepEqual(finished,expected)
  }
  await Promise.all(jobs)
  assert.equal(frames.length,0)
})
