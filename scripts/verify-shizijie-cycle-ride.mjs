import assert from 'node:assert/strict'
import {readFileSync,mkdirSync} from 'node:fs'
import {gzipSync,gunzipSync} from 'node:zlib'
import {preview} from 'vite'
import {execFileSync} from 'node:child_process'
import {SHIZIJIE_CURB_BARRIER_POLYLINES, SHIZIJIE_ORIGIN} from '../web/src/shizijie-zone.ts'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {withFixtureBays} from './ride-fixture-bays.mjs'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const url=`http://127.0.0.1:${server.httpServer.address().port}`
const browser=await chromium.launch(browserOptions())
const vehicles=JSON.parse(gunzipSync(readFileSync('dist/world/vehicles.bin')))
const {route,target,curbs}=JSON.parse(execFileSync('uv',['run','--locked','python','scripts/check-shizijie-cycle-bake.py','dist/world','--ride-route']))
curbs.push(...SHIZIJIE_CURB_BARRIER_POLYLINES.map(line=>line.map(([east,south])=>[east+SHIZIJIE_ORIGIN[0],south+SHIZIJIE_ORIGIN[1]])))
const out=process.env.QA_OUT??'captures/shizijie-cycle'
mkdirSync(out,{recursive:true})
try{
  for(const reverse of [false,true]){
    const points=reverse?route.toReversed():route
    const [start,next]=points
    const bay=[start[0],151.5,start[1],Math.atan2(start[0]-next[0],start[1]-next[1]),0]
    const page=await browser.newPage({viewport:{width:800,height:450}})
    await page.route('**/world/vehicles.bin',route=>route.fulfill({body:gzipSync(JSON.stringify({...withFixtureBays(vehicles,[bay]),bikes:[bay]}))}))
    await page.goto(`${url}/?verify&solo=1&mode=walk&flow=0&radius=192`)
    await page.waitForFunction(()=>window.viewer?.walk?.active && window.viewer.game?.missions?.status,null,{timeout:120000})
    await page.evaluate(async()=>{const {walkTo,game}=window.viewer;game.save.reset(200);await walkTo(-511,-70,0,'collect-noodles');if(!game.missions.start('noodle-01').ok)throw Error('order refused')})
    await page.waitForFunction(()=>window.viewer.game.getState().mission?.stepIndex===1)
    await page.evaluate(async bay=>{if(!await window.viewer.walkTo(bay[0],bay[2],bay[3],'cycle-gap-fixture'))throw Error('no landing')},bay)
    await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.dataset.interactAction==='mount_vehicle',null,{timeout:30000})
    await page.keyboard.press('f');await page.waitForFunction(()=>window.viewer.walk.vehicle==='bike' && window.viewer.walk.ebike.state?.crashPhase==='none',null,{timeout:90000})
    const result=await page.evaluate(async ({target,points,curbs})=>{
      const {walk,game,photoSupport}=window.viewer, advance=walk.tick,dt=1/60
      const samples=[];let crashes=0,spills=0,previousSoup=game.missions.status().soup
      const pressed=new Set()
      function steer(code,down){if(down===pressed.has(code))return;window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code}));if(down)pressed.add(code);else pressed.delete(code)}
      const stop=game.onEvent(event=>{if(event.type==='crash')crashes++})
      walk.tick=()=>{};walk.ebike.setPark(false,true);walk.ebike.setKickstand(false,true)
      let leg=1,done=false,minClearance=Infinity
      try{
        for(let index=0;index<900;index++){
          const here=walk.position,[ax,az]=points[leg-1],[bx,bz]=points[leg],length=Math.hypot(bx-ax,bz-az)
          const distance=((here.x-ax)*(bx-ax)+(here.z-az)*(bz-az))/length
          const ahead=Math.min(length,distance+.85),bearing=Math.atan2(here.x-ax-ahead*(bx-ax)/length,here.z-az-ahead*(bz-az)/length)
          const error=Math.atan2(Math.sin(bearing-walk.heading),Math.cos(bearing-walk.heading))
          steer('KeyA',error>.025);steer('KeyD',error<-.025)
          steer('KeyW',walk.speed<2.4)
          advance(dt);game.missions.advanceTimerForTest(dt)
          const {x,z}=walk.position
          const soup=game.missions.status().soup;if(soup<previousSoup)spills++;previousSoup=soup
          const surface=await photoSupport(x,z)
          if(surface.kind!=='road')throw Error(`non-road ${surface.kind} at ${x},${z}`)
          for(const ring of curbs)for(let edge=1;edge<ring.length;edge++){
            const [sx,sz]=ring[edge-1],[ex,ez]=ring[edge],dx=ex-sx,dz=ez-sz
            const fraction=Math.max(0,Math.min(1,((x-sx)*dx+(z-sz)*dz)/(dx*dx+dz*dz||1)))
            minClearance=Math.min(minClearance,Math.hypot(x-sx-fraction*dx,z-sz-fraction*dz))
          }
          if(minClearance<.5)throw Error(`curb clearance ${minClearance} at ${x},${z}`)
          samples.push({x,z,y:surface.y,kind:surface.kind})
          if(Math.hypot(x-bx,z-bz)<.4){if(++leg===points.length){done=true;break}}
          if(walk.vehicle!=='bike'||walk.ebike.state.crashPhase!=='none')break
        }
        const maxJump=Math.max(...samples.slice(1).map((s,i)=>Math.abs(s.y-samples[i].y)))
        const closest=Math.min(...samples.map(s=>Math.hypot(s.x-target[0],s.z-target[1])))
        return {start:samples[0],end:samples.at(-1),count:samples.length,done,minClearance,closest,maxJump,crashes,spills,soup:previousSoup,vehicle:walk.vehicle}
      }finally{for(const code of pressed)steer(code,false);window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}));walk.tick=advance;stop()}
    },{target,points,curbs})
    console.log(reverse?'return':'outbound',JSON.stringify(result));assert(result.done)
    assert(result.closest<.6 && result.maxJump<=.05 && result.soup===1 && !result.spills && !result.crashes && result.vehicle==='bike')
    await page.screenshot({timeout:180000,path:`${out}/ride-${reverse?'return':'outbound'}.png`});await page.close()
  }
}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve))}
