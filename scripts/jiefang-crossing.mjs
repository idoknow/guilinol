import assert from 'node:assert/strict'
import {preview} from 'vite'
import {chromium} from 'playwright'

const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page = await browser.newPage({viewport:{width:960,height:600}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk`)
  await page.waitForFunction(()=>window.viewer?.walk?.active)
  const crossing=await page.evaluate(async()=>{
    const {walk,manifest}=window.viewer
    const bridge=manifest.landmarks.find(item=>item.id==='jiefang_bridge')
    const [bx,,bz]=bridge.position
    const angle=-bridge.rotation*Math.PI/180, c=Math.cos(angle),s=Math.sin(angle)
    const x=-116,z=-39
    walk.leave()
    if(!await walk.enter(bx+x*c-z*s,bz+x*s+z*c,0,'underpass'))throw Error('North approach spawn failed')
    walk.drive(-s,c)
    const heights=[]
    for(let tick=0;tick<100;tick++){
      walk.tick(.1)
      const probe=walk.probe()
      if(probe.resets || probe.inHouse || probe.inPeak)throw Error('Walk interrupted')
      if(Math.abs(-(probe.x-bx)*s+(probe.z-bz)*c)<20)heights.push(probe.foot)
    }
    const end=walk.probe()
    return {south:-(end.x-bx)*s+(end.z-bz)*c,maxUnderDeck:Math.max(...heights),samples:heights.length}
  })
  assert.ok(crossing.south>38 && crossing.samples>20 && crossing.maxUnderDeck<150,JSON.stringify(crossing))
  console.log(crossing)
} finally {
  await browser?.close()
  await server.close()
}
