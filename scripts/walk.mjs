import {browserOptions, recordFrames} from './qa-browser.mjs'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const route=[[-582,-206],[-548,-202],[-534,-188],[-534,-114],[-520,-100],[-486,-92],[-456,-82],[-452,-78],[-442,-78],[-398,-32],[-390,-30],[-372,-12],[-372,6],[-376,16],[-376,52],[-340,90],[-340,110],[-586,540],[-610,564],[-640,586],[-680,588],[-700,580],[-716,580],[-728,592],[-860,864],[-868,888],[-872,920],[-876,924],[-876,960],[-882,988],[-906,1012],[-926,1020],[-968,1022],[-984,1040],[-982,1076],[-962,1096]]
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch(browserOptions())
const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[]
page.on('pageerror',error=>errors.push(error.message))
const output='captures/walk';await mkdir(output,{recursive:true})
const mainOnly=process.env.WALK_MAIN_ONLY==='1'
const fixedStep=mainOnly||process.env.WALK_FIXED_STEP==='1'
const treeOnly=process.argv.includes('--tree-only')
async function shot(name){await page.screenshot({path:`${output}/${name}.png`})}
try{
  const renderStats={}
  await page.addInitScript(()=>{
    window.renderStats={}
    window.checkedProbe=label=>{
      const probe=window.viewer.walk.probe(),clearance=probe.renderClearance
      if(!Number.isFinite(clearance)||clearance<-.15)throw Error(`${label}: visible ground ${JSON.stringify(probe)}`)
      const stats=window.renderStats[label]??={frames:0,minClearance:Infinity,maxSink:0}
      stats.frames++;stats.minClearance=Math.min(stats.minClearance,clearance);stats.maxSink=Math.max(stats.maxSink,-clearance)
      return probe
    }
  })
  const collect=async()=>Object.assign(renderStats,await page.evaluate(()=>window.renderStats))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?mode=walk&verify`)
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:45000})
  await recordFrames(page)
  await shot('palace')
  await page.evaluate(()=>{window.walkFrames=[]})
  async function drive(points,kind='route'){
    return page.evaluate(async({points,kind,fixedStep})=>{
      const {walk,stats,stream}=window.viewer
      let min=Infinity,frames=0,wetFrames=0,last=null
      for(const [x,z] of points){const start=window.checkedProbe(kind);const limit=5+Math.hypot(x-start.x,z-start.z)/3
        do{
          if(fixedStep&&frames%60!==0&&!stream.pending.size){walk.tick(.1);stream.tick(walk.position)}else await new Promise(requestAnimationFrame)
          last=window.checkedProbe(kind);frames++;min=Math.min(min,last.clearance)
          window.walkFrames.push([last.steps,last.x,last.z,last.clearance,last.inHouse,last.inPeak,last.resets,stats.ms,last.renderClearance])
          if(last.clearance<-.3||last.inHouse||last.inPeak||last.resets)throw Error(`unsafe ${JSON.stringify(last)}`)
          if(last.wet){wetFrames++;if(last.deck==null||Math.abs(last.foot-last.deck)>.3)throw Error(`off deck ${JSON.stringify(last)}`)}
          const dx=x-last.x,dz=z-last.z,distance=Math.hypot(dx,dz)
          if(distance<.75)break
          if(last.elapsed-start.elapsed>limit)throw Error(`stuck heading to ${x},${z}: ${JSON.stringify(last)}`)
          walk.drive(dx/distance,dz/distance,true)
        }while(true)
        walk.drive(0,0)
      }return {kind,min,frames,wetFrames,last}
    },{points,kind,fixedStep})
  }
  if(!treeOnly){
  const start=await page.evaluate(()=>window.checkedProbe('spawn:gate')),time=Date.now()
  const binjiangIndex=route.findIndex(([x,z])=>x===-586&&z===540)
  const first=await drive(route.slice(0,binjiangIndex));const binjiang=await drive(route.slice(binjiangIndex,binjiangIndex+1),'binjiang');await shot('street')
  const second=await drive(route.slice(binjiangIndex+1));await shot('elephant')
  const trace=await page.evaluate(()=>window.walkFrames);await writeFile(`${output}/frames.json`,JSON.stringify(trace))
  console.log('route',JSON.stringify({seconds:(Date.now()-time)/1000,simSeconds:second.last.elapsed-start.elapsed,min:Math.min(first.min,binjiang.min,second.min),resets:second.last.resets,frames:trace.length,msPerFrame:trace.reduce((sum,row)=>sum+row[7],0)/trace.length,msPerStep:(second.last.physicsMs-start.physicsMs)/(second.last.steps-start.steps)}))
  assert(Math.hypot(second.last.x+962,second.last.z-1096)<1)
  assert(Math.hypot(second.last.x+958.008,second.last.z-1102.738)<30,'outside Elephant Hill foot')
  }
  if(mainOnly&&!treeOnly){console.log('main route render clearance',await page.evaluate(()=>window.renderStats));assert.deepEqual(errors,[])}else{
  async function fixture(x,z){
    await page.evaluate(async ([x,z])=>{
      if(!await window.viewer.walkTo(x,z,0,'fixture')) throw Error(`No walkable fixture at ${x},${z}`)
      window.checkedProbe(`spawn:${x},${z}`)
    },[x,z])
  }
  async function press(x,z,seconds,label){return page.evaluate(async({x,z,seconds,label})=>{const walk=window.viewer.walk,start=window.checkedProbe(label),hits=new Set();let shore=false,last=start
    walk.drive(x,z);while(last.elapsed-start.elapsed<seconds){await new Promise(requestAnimationFrame);last=window.checkedProbe(label);for(const hit of last.hits)hits.add(hit);shore||=last.blockedWater;if(last.inHouse||last.inPeak||last.resets||last.clearance<-.3)throw Error(JSON.stringify(last))
      if(label==='tree'&&Math.hypot(last.x-window.trunkFixture.x,last.z-window.trunkFixture.z)<window.trunkFixture.radius)throw Error(`trunk penetration: ${JSON.stringify(last)}`)}
    walk.drive(0,0);return {last,hits:[...hits],shore,distance:Math.hypot(last.x-start.x,last.z-start.z)}},{x,z,seconds,label})}
  if(!treeOnly){
    // Same ordinary facade as walk-quick; the old wall is now the open Jingjiang gate.
    await fixture(-730.68,-277.1)
    const building=await press(-.166,.986,2,'building')
    assert(building.hits.includes('building')&&building.distance<12,JSON.stringify(building))
  }
  await page.waitForFunction(()=>{const {manifest,stream}=window.viewer;return stream.forest.loaded.has(manifest.chunks.find(tile=>tile.x===Math.floor(-577/256)*256&&tile.z===Math.floor(-209/256)*256))})
  const tree=await page.evaluate(()=>{const candidate=[...window.viewer.stream.forest.loaded.values()].flat().filter(item=>item.kind!==5).sort((a,b)=>Math.hypot(a.x+577,a.z+209)-Math.hypot(b.x+577,b.z+209))[0];return window.trunkFixture={x:candidate.x,z:candidate.z,radius:.42*candidate.scale+.29-.04}})
  await fixture(tree.x-2,tree.z);const trunk=await press(1,0,1.25,'tree');assert(trunk.hits.includes('tree'),JSON.stringify(trunk))
  if(treeOnly){console.log('tree-only',JSON.stringify({tree,distance:trunk.distance,hits:trunk.hits}));assert.deepEqual(errors,[])}else{
  await fixture(-840,-275);const curb=await press(1,0,1,'curb');assert(curb.distance>3&&curb.hits.includes('sidewalk'),JSON.stringify(curb))
  await fixture(-1021.82,435.97);const rail=await press(.967,-.254,2,'rail');assert(rail.hits.includes('rail')&&!rail.last.wet&&rail.distance<4.5,JSON.stringify(rail));await shot('bank')
  await fixture(-962,1096);const cliff=await press(.8,.6,9,'cliff');assert(cliff.hits.includes('peak')&&cliff.distance<72,JSON.stringify(cliff))
  await fixture(-309,-1);const bridge=await drive([[-174,44]],'bridge');await shot('bridge');const far=await drive([[-30,92]],'bridge');assert(bridge.wetFrames+far.wetFrames>0)
  console.log({cliff,bridge:bridge.wetFrames+far.wetFrames})
  await collect()
  for(const name of ['palace','lijiang','elephant']){
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?spawn=${name}&verify`);await page.waitForFunction(()=>window.viewer?.walk?.active)
    const spawn=await page.evaluate(name=>window.checkedProbe(`spawn:${name}`),name)
    if(name==='elephant'){
      await shot('elephant-spawn');console.log('elephant spawn',spawn,await page.evaluate(()=>window.viewer.walk.spawns))
      const shore=await press((-740-spawn.x)/26,(868-spawn.z)/26,6,'shore');assert(shore.shore&&!shore.last.wet,JSON.stringify(shore))
    }
    await collect()
  }
  console.log('render ground',JSON.stringify(renderStats),'maxSink',Math.max(...Object.values(renderStats).map(stats=>stats.maxSink)));assert.deepEqual(errors,[])
  }
  }
}finally{await browser.close();await server.close()}
