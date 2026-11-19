import assert from 'node:assert/strict'
import {preview} from 'vite'
import {chromium} from 'playwright'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  for(const mode of ['walk','ride']){
    const page=await browser.newPage({viewport:{width:640,height:400}})
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk`)
    await page.waitForFunction(()=>window.viewer?.walk?.active)
    await page.evaluate(async()=>{
      const {walk,manifest,camera,stream}=window.viewer
      const bridge=manifest.landmarks.find(item=>item.id==='jiefang_bridge')
      const [bx,by,bz]=bridge.position
      const angle=-bridge.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle)
      window.toWorld=([x,z])=>[bx+x*c-z*s,bz+x*s+z*c]
      walk.leave()
      camera.position.set(bx,by+8,bz)
      const deadline=performance.now()+20000
      while(!stream.landmarks.has(bridge)){
        if(performance.now()>deadline)throw Error('Bridge collision mesh did not load')
        await new Promise(resolve=>requestAnimationFrame(resolve))
      }
      if(!await walk.enter(...window.toWorld([-118,-30]),0,'lower bike stand'))throw Error('Lower approach spawn failed')
    })
    if(mode==='ride'){
      await page.evaluate(()=>{
        const walk=window.viewer.walk,[x,z]=window.toWorld([-118,-31])
        for(let i=0;i<80;i++){
          const p=walk.position,dx=x-p.x,dz=z-p.z
          if(Math.hypot(dx,dz)<1.8)break
          walk.drive(dx,dz,false);walk.tick(.05)
        }
        walk.drive(0,0)
      })
      await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent.includes('骑行'))
      await page.keyboard.press('e')
      assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'bike')
    }
    const result=await page.evaluate(mode=>{
      const walk=window.viewer.walk, keys=new Set()
      const metrics={}
      function press(code,on){
        if(keys.has(code)===on)return
        window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}))
        if(on)keys.add(code);else keys.delete(code)
      }
      function reach(x,z,part){
        const [gx,gz]=window.toWorld([x,z])
        for(let tick=0;tick<3200;tick++){
          const pos=walk.position,dx=gx-pos.x,dz=gz-pos.z
          if(Math.hypot(dx,dz)<(mode==='ride'?.95:.45))return
          if(mode==='ride'){
            const delta=Math.atan2(-dx,-dz)-walk.heading
            const error=Math.atan2(Math.sin(delta),Math.cos(delta))
            press('KeyA',error>.035);press('KeyD',error<-.035)
            press('KeyW',Math.abs(error)<.4 && walk.speed<3.6)
            press('KeyS',Math.abs(error)>.7 && walk.speed>.1)
          }else walk.drive(dx,dz,false)
          walk.tick(1/30)
          const p=walk.probe()
          if(p.resets||p.inHouse||p.inPeak||p.blockedWater||p.renderClearance<-.16)throw Error(JSON.stringify({part,x,z,p}))
          const range=metrics[part]??=[Infinity,-Infinity]
          range[0]=Math.min(range[0],p.foot);range[1]=Math.max(range[1],p.foot)
        }
        throw Error(JSON.stringify({part,x,z,end:walk.probe(),obstacle:walk.obstacle}))
      }
      // Lower road/walk north → south, then south ramp up, over the river and back.
      const lane=mode==='ride'?-121:-116
      reach(lane,-27,'approach')
      reach(lane,29,'underpass')
      reach(-116,41,'south landing')
      function arc(side,down){
        for(let i=0;i<=36;i++){
          const angle=(down?i:36-i)/36*Math.PI*1.5
          reach(-140-24*Math.sin(angle),side*(41-24*Math.cos(angle)),down?'north ramp':'south ramp')
        }
      }
      arc(1,false)
      const upperLane=mode==='ride'?14:18
      reach(-130,upperLane,'upper entry')
      reach(130,upperLane,'upper deck')
      reach(130,-upperLane,'upper turnaround')
      reach(-140,-17,'upper deck')
      arc(-1,true)
      reach(-116,-32,'north landing')
      if(mode==='walk'){
        reach(-116,-26.2,'stair landing')
        reach(-106,-26.2,'stair landing')
        reach(-106,-33.3,'return flight')
        reach(-98,-33.3,'turning landing')
        reach(-98,-20,'upper flight')
        reach(-98,-17,'stair exit')
      }
      for(const code of [...keys])press(code,false)
      return metrics
    },mode)
    assert.ok(result.underpass[1]<147.4 && result['upper deck'][0]>150,JSON.stringify(result))
    console.log(mode,JSON.stringify(result))
    await page.close()
  }
} finally {
  await browser?.close()
  await server.close()
}
