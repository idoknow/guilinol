import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const route=[[-582,-206],[-548,-202],[-534,-188],[-534,-114],[-520,-100],[-486,-92],[-456,-82],[-452,-78],[-442,-78],[-398,-32],[-390,-30],[-372,-12],[-372,6],[-376,16],[-376,52],[-340,90],[-340,110],[-586,540],[-610,564],[-640,586],[-680,588],[-700,580],[-716,580],[-728,592],[-860,864],[-868,888],[-872,920],[-876,924],[-876,960],[-882,988],[-906,1012],[-926,1020],[-968,1022],[-984,1040],[-982,1076],[-962,1096]]
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[]
page.on('pageerror',error=>errors.push(error.message))
const output='captures/walk';await mkdir(output,{recursive:true})
async function shot(name){await page.screenshot({path:`${output}/${name}.png`})}
try{
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?mode=walk&verify`)
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:45000})
  await shot('palace')
  await page.evaluate(()=>{window.walkFrames=[]})
  async function drive(points,kind='route'){
    return page.evaluate(async({points,kind})=>{
      const {walk,stats}=window.viewer
      let min=Infinity,frames=0,wetFrames=0,last=null
      for(const [x,z] of points){const start=walk.probe();const limit=5+Math.hypot(x-start.x,z-start.z)/3
        do{
          await new Promise(requestAnimationFrame);last=walk.probe();frames++;min=Math.min(min,last.clearance)
          window.walkFrames.push([last.steps,last.x,last.z,last.clearance,last.inHouse,last.inPeak,last.resets,stats.ms])
          if(last.clearance<-.3||last.inHouse||last.inPeak||last.resets)throw Error(`unsafe ${JSON.stringify(last)}`)
          if(last.wet){wetFrames++;if(last.deck==null||Math.abs(last.foot-last.deck)>.3)throw Error(`off deck ${JSON.stringify(last)}`)}
          const dx=x-last.x,dz=z-last.z,distance=Math.hypot(dx,dz)
          if(distance<.75)break
          if(last.elapsed-start.elapsed>limit)throw Error(`stuck heading to ${x},${z}: ${JSON.stringify(last)}`)
          walk.drive(dx/distance,dz/distance,true)
        }while(true)
        walk.drive(0,0)
      }return {kind,min,frames,wetFrames,last}
    },{points,kind})
  }
  const start=await page.evaluate(()=>window.viewer.walk.probe()),time=Date.now()
  const first=await drive(route.slice(0,18));await shot('street')
  const second=await drive(route.slice(18));await shot('elephant')
  const trace=await page.evaluate(()=>window.walkFrames);await writeFile(`${output}/frames.json`,JSON.stringify(trace))
  console.log('route',JSON.stringify({seconds:(Date.now()-time)/1000,simSeconds:second.last.elapsed-start.elapsed,min:Math.min(first.min,second.min),resets:second.last.resets,frames:trace.length,msPerFrame:trace.reduce((sum,row)=>sum+row[7],0)/trace.length,msPerStep:(second.last.physicsMs-start.physicsMs)/(second.last.steps-start.steps)}))
  assert(Math.hypot(second.last.x+962,second.last.z-1096)<1)
  assert(Math.hypot(second.last.x+958.008,second.last.z-1102.738)<30,'outside Elephant Hill foot')
  async function fixture(x,z){assert(await page.evaluate(async([x,z])=>{const walk=window.viewer.walk;walk.leave();return walk.enter(x,z,0,'fixture')},[x,z]))}
  async function press(x,z,seconds){return page.evaluate(async({x,z,seconds})=>{const walk=window.viewer.walk,start=walk.probe(),hits=new Set();let shore=false,last=start
    walk.drive(x,z);while(last.elapsed-start.elapsed<seconds){await new Promise(requestAnimationFrame);last=walk.probe();for(const hit of last.hits)hits.add(hit);shore||=last.blockedWater;if(last.inHouse||last.inPeak||last.resets||last.clearance<-.3)throw Error(JSON.stringify(last))}
    walk.drive(0,0);return {last,hits:[...hits],shore,distance:Math.hypot(last.x-start.x,last.z-start.z)}},{x,z,seconds})}
  await fixture(-588,-212);const building=await press(0,-1,7);assert(building.hits.includes('building')&&building.distance<55,JSON.stringify(building))
  await fixture(-962,1096);const cliff=await press(.8,.6,9);assert(cliff.hits.includes('peak')&&cliff.distance<72,JSON.stringify(cliff))
  await fixture(-309,-1);const bridge=await drive([[-174,44]],'bridge');await shot('bridge');const far=await drive([[-30,92]],'bridge');assert(bridge.wetFrames+far.wetFrames>0)
  console.log({building,cliff,bridge:bridge.wetFrames+far.wetFrames})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?spawn=elephant&verify`);await page.waitForFunction(()=>window.viewer?.walk?.active)
  console.log('elephant spawn',await page.evaluate(()=>window.viewer.walk.spawns));const spawn=await page.evaluate(()=>window.viewer.walk.probe());const shore=await press((-740-spawn.x)/26,(868-spawn.z)/26,6);assert(shore.shore&&!shore.last.wet,JSON.stringify(shore));assert.deepEqual(errors,[])
}finally{await browser.close();await server.close()}
