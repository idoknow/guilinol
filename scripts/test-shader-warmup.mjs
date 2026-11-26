import assert from 'node:assert/strict'
import {test} from 'node:test'
import {landingWarmBudget,warmShaders} from '../web/src/shader-warmup.ts'

test('landing warm-up renews on progress but never beyond the landing cap',t=>{
  let now=89_000
  t.mock.timers.enable({apis:['setTimeout']})
  t.mock.method(performance,'now',()=>now)
  globalThis.window=globalThis
  const advance=ms=>{now+=ms;t.mock.timers.tick(ms)}
  try{
    const budget=landingWarmBudget(0)
    for(let step=0;step<15;step++){advance(2000);budget.progress();assert.equal(budget.signal.aborted,false)}
    advance(1000);assert.equal(budget.signal.aborted,true)
    const stalled=landingWarmBudget(now)
    advance(3000);assert.equal(stalled.signal.aborted,true)
    assert.equal(landingWarmBudget(0).signal.aborted,true)
  }finally{delete globalThis.window}
})

test('concurrent warmups share a budget, skip retired programs and wait for link readiness',async()=>{
  const frames=[],calls=[]
  let now=0,ready=false
  const frame=()=>{assert.equal(frames.length,1);frames.shift()()}
  const program=(name,isReady=()=>true)=>({isReady,getUniforms(){calls.push(name);now+=8},getAttributes(){}})
  const first=program('first'),late=program('late',()=>ready),retired=program('retired')
  const scene={},renderer={info:{programs:[first,late,retired]},compile:()=>{}}
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
