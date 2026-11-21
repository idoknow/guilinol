import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {preview} from 'vite'
import {chromium} from 'playwright'

const ways=JSON.parse(readFileSync(new URL("../pipeline/landmarks/jiefang_osm.json",import.meta.url)))

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
      if(!await walk.enter(...window.toWorld([-117.5,-25.0]),0,'lower bike stand'))throw Error('Lower approach spawn failed')
    })
    if(mode==='ride'){
      await page.evaluate(()=>{
        const walk=window.viewer.walk,[x,z]=window.toWorld([-117.5,-26.0])
        for(let i=0;i<80;i++){
          const p=walk.position,dx=x-p.x,dz=z-p.z
          if(Math.hypot(dx,dz)<1.8)break
          walk.drive(dx,dz,false);walk.tick(.05)
        }
        walk.drive(0,0)
      })
      await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent.includes('骑电动车'))
      await page.keyboard.press('f')
      assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'bike')
    }
    const result=await page.evaluate(([mode,ways])=>{
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
      // Follow OSM directions on all four links, including the westbound merge.
      const riding=mode==='ride'
      const bank=[...ways[1531308427].slice(0,-1),...ways[1531308428]]
      function binjiang(z,part) {
        for(let i=1;i<bank.length;i++){
          const [x0,z0]=bank[i-1],[x1,z1]=bank[i]
          if(z>z0||z<z1)continue
          reach(x0+(z-z0)/(z1-z0)*(x1-x0)+(riding?0:5.2),z,part)
          return
        }
        throw Error('Station outside Binjiang Road')
      }
      function crossBankSeam(side) {
        const part=side>0?'south road seam':'north road seam'
        const end=side>0?bank[0]:bank.at(-1)
        const next=side>0?bank[1]:bank.at(-2)
        const slope=(end[0]-next[0])/(end[1]-next[1])
        for(const distance of [100,120,135,139])binjiang(side*distance,part)
        reach(end[0]+side*5*slope+(riding?0:5.2),end[1]+side*5,part)
        for(const distance of [139,135,120,100,94])binjiang(side*distance,part)
      }
      function link(id) {
        const line=ways[id]
        const lengths=line.slice(1).map(([x,z],i)=>Math.hypot(x-line[i][0],z-line[i][1]))
        const total=lengths.reduce((a,b)=>a+b,0),down=id===258909975||id===258909978
        let station=0
        for(let i=0;i<line.length;i++){
          const [x,z]=line[i]
          const normal=(a,b)=>{
            const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)
            return [-dz/len,dx/len]
          }
          const a=normal(line[Math.max(0,i-1)],line[Math.max(1,i)])
          const b=normal(line[Math.min(line.length-2,i)],line[Math.min(line.length-1,i+1)])
          const opposite=ways[id%2===1?id+1:id-1]
          let gap=Infinity
          for(let j=1;j<opposite.length;j++){
            const [u,v]=opposite[j-1],dx=opposite[j][0]-u,dz=opposite[j][1]-v
            const t=Math.max(0,Math.min(1,((x-u)*dx+(z-v)*dz)/(dx*dx+dz*dz)))
            gap=Math.min(gap,Math.hypot(x-u-t*dx,z-v-t*dz))
          }
          const offset=riding?1:8-Math.min(4,gap/2-.08)+1.2
          const m=1+a[0]*b[0]+a[1]*b[1]
          reach(x+(a[0]+b[0])*offset/m,z+(a[1]+b[1])*offset/m,String(id))
          const t=Math.max(0,Math.min(1,(station-(down?19:8))/(total-27)))
          const expected=146.56+5.30*(down?1-t:t)+(riding?0:.12)
          if(Math.abs(walk.probe().foot-expected)>.33)throw Error(JSON.stringify({id,station,expected,actual:walk.probe().foot,x,z}))
          station+=lengths[i]??0
        }
      }
      for(const z of [-27,0,29,42,85,94])binjiang(z,z<=29?'underpass':'south bank')
      crossBankSeam(1)
      link(258909977)
      const lane=riding?6:17.5
      reach(-143,lane,'upper entry')
      reach(130,lane,'upper deck')
      reach(130,-lane,'upper turnaround')
      reach(-143,-lane,'upper deck')
      reach(-184,-lane,'west approach')
      link(258909975)
      binjiang(-94,'north landing')
      crossBankSeam(-1)
      link(258909976)
      // Follow the widening sidewalk through the transition to the native street.
      for(const [x,z] of [[-239,-17],[-253,-15],[-265,-12.7],[-272,-12.7],[-272,11.8],[-265,11.8],[-253,14],[-239,17]])
        reach(x,riding?Math.sign(z)*6:z,'west road seam')
      link(258909978)
      for(const z of [94,77,45,25,0,-27])binjiang(z,'return bank')
      if(!riding){
        reach(-106.5,-27.1,'stair landing')
        for(const [x,z] of ways[1382486206].slice().reverse())reach(x,z,'north stairs')
        reach(-97.5,15,'cross deck on foot')
        for(const [x,z] of ways[1382486208])reach(x,z,'south stairs')
        reach(-117,27.3,'south stair exit')
      }
      for(const code of [...keys])press(code,false)
      return metrics
    },[mode,ways])
    assert.ok(result.underpass[1]<147.4 && result['upper deck'][0]>150,JSON.stringify(result))
    console.log(mode,'zero resets; all four profiles within 0.33 m',JSON.stringify(result))
    await page.close()
  }
} finally {
  await browser?.close()
  await server.close()
}
