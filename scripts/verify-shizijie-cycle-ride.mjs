import assert from 'node:assert/strict'
import {readFileSync,mkdirSync} from 'node:fs'
import {gzipSync,gunzipSync} from 'node:zlib'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {withFixtureBays} from './ride-fixture-bays.mjs'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const url=`http://127.0.0.1:${server.httpServer.address().port}`
const browser=await chromium.launch(browserOptions())
const vehicles=JSON.parse(gunzipSync(readFileSync('dist/world/vehicles.bin')))
const out=process.env.QA_OUT??'captures/shizijie-cycle'
mkdirSync(out,{recursive:true})
try{
  for(const reverse of [false,true]){
    const angle=240*Math.PI/180, target=[-832.326,-142.627]
    const along=reverse?8.6:-9, dx=Math.sin(angle), dz=-Math.cos(angle)
    const bay=[target[0]+dx*along,151.5,target[1]+dz*along,Math.atan2(-dx,-dz)+(reverse?Math.PI:0),0]
    const page=await browser.newPage({viewport:{width:800,height:450}})
    await page.route('**/world/vehicles.bin',route=>route.fulfill({body:gzipSync(JSON.stringify({...withFixtureBays(vehicles,[bay]),bikes:[bay]}))}))
    await page.goto(`${url}/?verify&solo=1&mode=walk&flow=0&radius=192`)
    await page.waitForFunction(()=>window.viewer?.walk?.active && window.viewer.game?.missions?.status,null,{timeout:120000})
    await page.evaluate(async()=>{const {walkTo,game}=window.viewer;game.save.reset(200);await walkTo(-511,-70,0,'collect-noodles');if(!game.missions.start('noodle-01').ok)throw Error('order refused')})
    await page.waitForFunction(()=>window.viewer.game.getState().mission?.stepIndex===1)
    await page.evaluate(async bay=>{if(!await window.viewer.walkTo(bay[0],bay[2],bay[3],'cycle-gap-fixture'))throw Error('no landing')},bay)
    await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.dataset.interactAction==='mount_vehicle',null,{timeout:30000})
    await page.keyboard.press('f');await page.waitForFunction(()=>window.viewer.walk.vehicle==='bike')
    const result=await page.evaluate(async ({target,dx,dz,reverse})=>{
      const {walk,game,photoSupport}=window.viewer, advance=walk.tick,dt=1/60
      const samples=[];let crashes=0,spills=0,previousSoup=game.missions.status().soup
      const pressed=new Set()
      function steer(code,down){if(down===pressed.has(code))return;window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code}));if(down)pressed.add(code);else pressed.delete(code)}
      const stop=game.onEvent(event=>{if(event.type==='crash')crashes++})
      walk.tick=()=>{};walk.ebike.setPark(false,true);walk.ebike.setKickstand(false,true)
      window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}))
      try{
        for(let index=0;index<900;index++){
          const here=walk.position,at=(here.x-target[0])*dx+(here.z-target[1])*dz
          const aim=at+(reverse?-2:2),bearing=Math.atan2(here.x-target[0]-aim*dx,here.z-target[1]-aim*dz)
          const error=Math.atan2(Math.sin(bearing-walk.heading),Math.cos(bearing-walk.heading))
          steer('KeyA',error>.025);steer('KeyD',error<-.025)
          advance(dt);game.missions.advanceTimerForTest(dt)
          const {x,z}=walk.position,progress=(x-target[0])*dx+(z-target[1])*dz
          const soup=game.missions.status().soup;if(soup<previousSoup)spills++;previousSoup=soup
          const surface=await photoSupport(x,z);samples.push({x,z,y:surface.y,kind:surface.kind,progress})
          if(reverse?progress< -3:progress>8.1)break
          if(walk.vehicle!=='bike'||walk.ebike.state.crashPhase!=='none')break
        }
        const maxJump=Math.max(...samples.slice(1).map((s,i)=>Math.abs(s.y-samples[i].y)))
        const closest=Math.min(...samples.map(s=>Math.hypot(s.x-target[0],s.z-target[1])))
        return {start:samples[0],end:samples.at(-1),count:samples.length,closest,maxJump,crashes,spills,soup:previousSoup,vehicle:walk.vehicle,heading:walk.heading}
      }finally{for(const code of pressed)steer(code,false);window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}));walk.tick=advance;stop()}
    },{target,dx,dz,reverse})
    console.log(reverse?'return':'outbound',JSON.stringify(result));assert(reverse?result.end.progress< -3:result.end.progress>8.1)
    assert(result.closest<.6 && result.maxJump<=.05 && result.soup===1 && !result.spills && !result.crashes && result.vehicle==='bike')
    await page.screenshot({path:`${out}/ride-${reverse?'return':'outbound'}.png`});await page.close()
  }
}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve))}
