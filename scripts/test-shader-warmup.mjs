import assert from 'node:assert/strict'
import {test} from 'node:test'
import {warmShaders} from '../web/src/shader-warmup.ts'

test('concurrent warmups share a budget, skip retired programs and wait for link readiness',async()=>{
  const frames=[],calls=[]
  let now=0,ready=false
  const frame=()=>{assert.equal(frames.length,1);frames.shift()()}
  const program=(name,isReady=()=>true)=>({isReady,getUniforms(){calls.push(name);now+=8},getAttributes(){}})
  const first=program('first'),late=program('late',()=>ready),retired=program('retired')
  const scene={},renderer={info:{programs:[first,late,retired]},compileAsync:async()=>{}}
  const clock=Object.getOwnPropertyDescriptor(globalThis,'performance')
  Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>now}})
  globalThis.requestAnimationFrame=callback=>frames.push(callback)
  try{
    const work=Promise.all([warmShaders(renderer,{}, {},scene),warmShaders(renderer,scene,{},scene)])
    await Promise.resolve();renderer.info.programs.pop()
    frame();assert.deepEqual(calls,['first']);frame();assert.deepEqual(calls,['first'])
    ready=true;frame();await work;assert.deepEqual(calls,['first','late'])
    await warmShaders(renderer,scene,{},scene);assert.equal(frames.length,0)
  }finally{Object.defineProperty(globalThis,'performance',clock);delete globalThis.requestAnimationFrame}
})
