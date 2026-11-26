import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const hasWorld=existsSync('public/world/manifest.json')
const fixturePlugin={
  name:'walk-test-fixture',
  configureServer(server){
    server.middlewares.use('/__walk_fixture',async(req,res,next)=>{
      if(req.url!=='/'&&!req.url?.startsWith('/?')){next();return}
      const html=await server.transformIndexHtml('/__walk_fixture','<!doctype html><script type="module">import * as THREE from "three";window.__THREE=THREE;</script>')
      res.setHeader('Content-Type','text/html')
      res.end(html)
    })
  },
}
const server=await createServer({root:'web',configFile:'web/vite.config.ts',plugins:[fixturePlugin],server:{host:'127.0.0.1',port:0},optimizeDeps:{entries:['src/walk/physics.ts','src/world.ts','src/landmarks.ts']}})
let browser
try{
  await server.listen()
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage()
  await page.route('**/world/test-heights',route=>route.fulfill({body:Buffer.alloc(33*33*2)}))
  await page.goto(server.resolvedUrls.local[0]+'__walk_fixture')
  await page.waitForFunction(()=>Boolean(window.__THREE))
  const counts=await page.evaluate(async()=>{
    const {createPhysics}=await import('/src/walk/physics.ts')
    const tile={x:256,z:0,file:'test'},road=new Float32Array([8,1,8,8,1,16,16,1,8])
    const detail={group:{position:tile},water:new Int16Array(4225).fill(-32768),terrain:new Int16Array(4225),railCutVertices:new Set(),
      groundMesh:{geometry:{parameters:{widthSegments:64},getAttribute:()=>({getY:()=>0})}},deck:[],rings:[],
      streets:{road,sidewalk:road,banks:[],railBarriers:[],roadBarriers:[]}}
    const loaded=new Map([[tile,detail]])
    const sim=await createPhysics({chunks:[tile],extent:[0,0,512,512],overview:{step:16,heights:{file:'test-heights'}}},
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

  const synth=await page.evaluate(async()=>{
    const THREE=window.__THREE
    const [{createPhysics},{walkConfig:cfg}]=await Promise.all([
      import('/src/walk/physics.ts'),
      import('/src/walk/config.ts'),
    ])
    const tile={x:-512,z:0,file:'synth'}
    const groundY=146.47
    const terrain=new Int16Array(4225).fill(Math.round(groundY*10))
    const water=new Int16Array(4225).fill(-32768)
    const detail={group:{position:tile},water,terrain,railCutVertices:new Set(),
      groundMesh:{geometry:{parameters:{widthSegments:64},getAttribute:()=>({getY:()=>groundY})}},deck:[],rings:[],
      streets:{road:new Float32Array(0),sidewalk:new Float32Array(0),banks:[],railBarriers:[],roadBarriers:[]}}
    const loaded=new Map([[tile,detail]])
    const bridgeEntry={id:'jiefang_bridge',file:'landmarks/jiefang_bridge.glb',position:[0,0,0],rotation:0,collision:'mesh',lods:['lod0'],sphere:[-268.6,151.86,24.4,30],bytes:0}
    const bridgeRoot=new THREE.Group()
    const collisionGroup=new THREE.Group();collisionGroup.name='collision'
    const slabGeo=new THREE.BufferGeometry()
    const y=151.86, x0=-276, x1=-260, z0=16, z1=32
    slabGeo.setAttribute('position',new THREE.Float32BufferAttribute([x0,y,z0, x0,y,z1, x1,y,z1, x0,y,z0, x1,y,z1, x1,y,z0],3))
    const slabMesh=new THREE.Mesh(slabGeo,new THREE.MeshBasicMaterial())
    collisionGroup.add(slabMesh);bridgeRoot.add(collisionGroup);bridgeRoot.updateMatrixWorld(true)
    const landmarks=new Map([[bridgeEntry,bridgeRoot]])
    const sim=await createPhysics(
      {bbox:[25.25,110.278,25.302,110.312],chunks:[tile],extent:[-512,0,256,256],overview:{step:16,heights:{file:'test-heights'}}},
      {grid:{near:()=>[tile]},loaded,forest:{loaded:new Map()},radius:384,landmarks},
      {colliders:[],modelPeaks:[]},
    )
    let noPref=null, withPref=null, missPref=null, edgePref=null, wetNoPref=null, wetWithPref=null
    try{
      sim.sync(-268.6,24.4,true)
      noPref=sim.findWalkableSpawn(-268.6,24.4)
      withPref=sim.findWalkableSpawn(-268.6,24.4,false,false,151.86)
      missPref=sim.findWalkableSpawn(-268.6,24.4,false,false,165)
      // Near-edge call outside [x0, x1] should step onto the bridge deck at preferY instead of dropping below.
      edgePref=sim.findWalkableSpawn(-258.5,24.4,false,false,151.86)
    }finally{sim.world.free()}
    // Wet riverbed tile under the same landmark span should still succeed when preferY lands on the bridge.
    const wetTerrain=new Int16Array(4225).fill(1435)
    const wetWater=new Int16Array(4225).fill(1450)
    const wetDetail={group:{position:tile},water:wetWater,terrain:wetTerrain,railCutVertices:new Set(),
      groundMesh:{geometry:{parameters:{widthSegments:64},getAttribute:()=>({getY:()=>143.5})}},deck:[],rings:[],
      streets:{road:new Float32Array(0),sidewalk:new Float32Array(0),banks:[],railBarriers:[],roadBarriers:[]}}
    const wetSim=await createPhysics(
      {bbox:[25.25,110.278,25.302,110.312],chunks:[tile],extent:[-512,0,256,256],overview:{step:16,heights:{file:'test-heights'}}},
      {grid:{near:()=>[tile]},loaded:new Map([[tile,wetDetail]]),forest:{loaded:new Map()},radius:384,landmarks},
      {colliders:[],modelPeaks:[]},
    )
    try{
      wetSim.sync(-268.6,24.4,true)
      wetNoPref=wetSim.findWalkableSpawn(-268.6,24.4)
      wetWithPref=wetSim.findWalkableSpawn(-268.6,24.4,false,false,151.86)
    }finally{wetSim.world.free()}
    return {height:cfg.height,noPref,withPref,missPref,wetNoPref,wetWithPref,edgePref}
  })
  assert.ok(synth.noPref&&Math.abs(synth.noPref.y-147.405)<1e-3,`expected 147.405 riverside ground fallback without preferY: ${JSON.stringify(synth.noPref)}`)
  assert.ok(synth.withPref&&Math.abs((synth.withPref.y-synth.height/2)-151.86)<=.5,`expected bridge foot near 151.86: ${JSON.stringify(synth.withPref)}`)
  assert.ok(synth.missPref&&Math.abs(synth.missPref.y-synth.noPref.y)<1e-6,`preferY miss should fall back identically: ${JSON.stringify(synth.missPref)}`)
  assert.equal(synth.wetNoPref,null,'wet riverbed without deck/preferY should reject')
  assert.ok(synth.wetWithPref&&Math.abs((synth.wetWithPref.y-synth.height/2)-151.86)<=.5,`wet span with preferY should still land on bridge: ${JSON.stringify(synth.wetWithPref)}`)
  assert.ok(synth.edgePref&&Math.abs((synth.edgePref.y-synth.height/2)-151.86)<=.5&&synth.edgePref.rule.startsWith('search-'),`edge call with preferY should step onto bridge: ${JSON.stringify(synth.edgePref)}`)
  console.log('synthetic findWalkableSpawn OK',JSON.stringify(synth))

  if(hasWorld){
    const real=await page.evaluate(async()=>{
      const THREE=window.__THREE
      const [{detail},{createPhysics},{landmarkStream},{walkConfig:cfg}]=await Promise.all([
        import('/src/world.ts'),
        import('/src/walk/physics.ts'),
        import('/src/landmarks.ts'),
        import('/src/walk/config.ts'),
      ])
      const manifest=await (await fetch('/world/manifest.json')).json()
      const bridgeEntry=manifest.landmarks.find(entry=>entry.id==='jiefang_bridge')
      const tile=manifest.chunks.find(chunk=>-268.6>=chunk.x&&-268.6<chunk.x+256&&24.4>=chunk.z&&24.4<chunk.z+256)
      const data=await detail(tile,new AbortController().signal,undefined,manifest.tunnels)
      const loaded=new Map([[tile,data]])
      const lmMap=new Map()
      const canvas=document.createElement('canvas')
      const renderer=new THREE.WebGLRenderer({canvas})
      const lm=landmarkStream(new THREE.Scene(),renderer,[bridgeEntry],lmMap)
      const eye=new THREE.Vector3(-268.6,152,24.4)
      for(let i=0;i<200&&!lmMap.has(bridgeEntry);i++){
        lm(eye,bridgeEntry)
        lm(eye)
        await new Promise(resolve=>setTimeout(resolve,25))
      }
      if(!lmMap.has(bridgeEntry))throw Error('jiefang_bridge failed to load')
      const sim=await createPhysics(manifest,{grid:{near:()=>[tile]},loaded,forest:{loaded:new Map()},radius:384,landmarks:lmMap},{colliders:[],modelPeaks:[]})
      try{
        sim.sync(-268.6,24.4,true)
        const noPref=sim.findWalkableSpawn(-268.6,24.4)
        const withPref=sim.findWalkableSpawn(-268.6,24.4,false,false,151.86)
        return {height:cfg.height,noPref,withPref}
      }finally{sim.world.free();renderer.dispose();data.dispose()}
    })
    assert.ok(real.noPref&&Math.abs(real.noPref.y-147.375)<=.1,`real (-268.6,24.4) without preferY should return ~147.375 riverside ground: ${JSON.stringify(real.noPref)}`)
    assert.ok(real.withPref&&Math.abs((real.withPref.y-real.height/2)-151.86)<=.5,`real (-268.6,24.4) with preferY=151.86 should land on bridge ±0.5m: ${JSON.stringify(real.withPref)}`)
    console.log('real jiefang_bridge findWalkableSpawn OK',JSON.stringify(real))
  }
}finally{await browser?.close();await server.close()}
