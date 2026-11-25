import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const server=await createServer({configFile:false,root:'web',server:{host:'127.0.0.1',port:0},optimizeDeps:{entries:['src/walk/physics.ts']}})
let browser
try{
  await server.listen()
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage()
  await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}))
  await page.route('**/world/heights',route=>route.fulfill({body:Buffer.alloc(33*33*2)}))
  await page.goto(server.resolvedUrls.local[0]+'fixture')
  const counts=await page.evaluate(async()=>{
    const {createPhysics}=await import('/src/walk/physics.ts')
    const tile={x:256,z:0,file:'test'},road=new Float32Array([8,1,8,8,1,16,16,1,8])
    const detail={group:{position:tile},water:new Int16Array(4225).fill(-32768),terrain:new Int16Array(4225),railCutVertices:new Set(),
      groundMesh:{geometry:{parameters:{widthSegments:64},getAttribute:()=>({getY:()=>0})}},deck:[],rings:[],
      streets:{road,sidewalk:road,banks:[],railBarriers:[],roadBarriers:[]}}
    const loaded=new Map([[tile,detail]])
    const sim=await createPhysics({chunks:[tile],extent:[0,0,512,512],overview:{step:16,heights:{file:'heights'}}},
      {grid:{near:()=>[tile]},loaded,forest:{loaded:new Map()},radius:384,landmarks:[]},{colliders:[],modelPeaks:[]})
    try{
      const count=()=>[...sim.kinds.values()].filter(kind=>kind==='sidewalk'||kind==='road').length
      const timeline=[]
      for(let frame=0;frame<7;frame++){sim.sync(128,128,true);timeline.push(count())}
      sim.clear();sim.sync(128,128,true);sim.sync(128,128,true);loaded.clear();sim.sync(128,128,true)
      const cancelled=[...sim.kinds.values()]
      sim.clear();loaded.set(tile,detail);sim.sync(128,128)
      if(sim.kinds.size)throw Error('Loaded distant detail should not install temporary overview ground')
      sim.sync(128,128,true);sim.sync(258,128,true)
      return {timeline,cancelled,urgent:count(),roadSource:[...sim.sources.values()]}
    }finally{sim.world.free()}
  })
  assert.deepEqual(counts.timeline,[0,0,1,1,2,2,2]);assert.deepEqual(counts.cancelled,['overview'])
  assert.equal(counts.urgent,2);assert.deepEqual(counts.roadSource,['test']);console.log(counts)
}finally{await browser?.close();await server.close()}
