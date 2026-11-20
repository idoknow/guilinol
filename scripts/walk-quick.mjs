import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'

const start=performance.now()
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:480,height:270}}),errors=[]
  let releaseBridge
  const coldBridge=new Promise(resolve=>{releaseBridge=resolve})
  await page.route('**/jiefang_bridge.glb',async route=>{await coldBridge;await route.continue()})
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/favicon.ico',route=>route.fulfill({status:204}))
  page.on('console',message=>{if(message.type()==='error')errors.push(message.location().url+': '+message.text())})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk`)
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:45000})
  async function fixture(start,direction,seconds,target){
    const result=await page.evaluate(async({start,direction,seconds,target})=>{
      const {walk,stream}=window.viewer;walk.leave()
      if(!await walk.enter(...start,0,'quick'))throw Error('Spawn failed: '+target)
      if(target==='deck'){
        const deadline=performance.now()+45000
        while(![...stream.landmarks.keys()].some(entry=>entry.id==='jiefang_bridge')){
          if(performance.now()>deadline)throw Error('Bridge approach collider not loaded')
          await new Promise(requestAnimationFrame)
        }
      }
      if(target==='tree'){
        const tree=[...stream.forest.loaded.values()].flat().filter(tree=>tree.kind!==5).sort((one,two)=>Math.hypot(one.x-start[0],one.z-start[1])-Math.hypot(two.x-start[0],two.z-start[1]))[0]
        walk.leave();if(!await walk.enter(tree.x-2,tree.z,0,'tree'))throw Error('No tree approach')
      }
      const spawn=walk.probe();if(target==='shore')direction=[-740-spawn.x,868-spawn.z]
      walk.drive(...direction);let hit=false
      for(let step=0;step<seconds*10;step++){
        walk.tick(.1);const probe=walk.probe()
        if(probe.resets||probe.inHouse||probe.inPeak||probe.renderClearance<-.15)throw Error(JSON.stringify(probe))
        if(target==='gunanmen'){
          if(Math.abs(probe.foot-spawn.foot)>.6)throw Error('Walker left the gate passage')
          hit = probe.z-spawn.z>21.5
        }else if(target==='gunanmen-stairs'){
          // Cross the landing, turn north through the rail opening and finish
          // on the main deck, clear of both the stair ramp and its landing.
          const along=(probe.x-spawn.x)*.893+(probe.z-spawn.z)*.451
          if(along>=18.25)walk.drive(.451,-.893)
          hit=Math.hypot(probe.x+1404.62,probe.z-116.54)<.65 && Math.abs(probe.foot-160.20)<.25
        }else hit ||= target==='gate'?spawn.z-probe.z>39:target==='shore'?probe.blockedWater&&!probe.wet:target==='deck'?probe.wet&&probe.deck!==undefined&&probe.foot>=probe.deck-.35&&!probe.blockedWater:probe.hits.includes(target)
        if(hit)break
      }
      walk.drive(0,0);return {hit,last:walk.probe()}
    },{start,direction,seconds,target});assert(result.hit,`${target}: ${JSON.stringify(result)}`);console.log(target,'OK')
  }
  await page.waitForFunction(()=>[...window.viewer.stream.landmarks.keys()].some(entry=>entry.id==='jingjiang'))
  await fixture([-588,-212],[.145,-.989],7,'gate')
  await fixture([-730.68,-277.1],[-.166,.986],2,'building')
  await fixture([-577,-209],[1,0],2,'tree')
  await page.waitForFunction(()=>[...window.viewer.stream.landmarks.keys()].some(entry=>entry.id==='shizijie'))
  await fixture([-873,-197.63],[1,0],1,'landmark')
  await fixture([-1021.82,435.97],[.967,-.254],2,'rail')
  await fixture([-962,1096],[.8,.6],9,'peak')
  releaseBridge()
  await fixture([-309,-1],[.95,.32],18,'deck')
  await fixture([-740,868],[0,0],6,'shore')
  // Start 4.8 m outside the northern opening, finish beyond the lake-side portal.
  await fixture([-1392.99,103.71],[-.451,.893],7,'gunanmen')
  await fixture([-1422.40,110.92],[.893,.451],9,'gunanmen-stairs')
  assert.deepEqual(errors,[]);console.log('seconds',(performance.now()-start)/1000);assert(performance.now()-start<180000)
}finally{await browser?.close();await server.close()}
