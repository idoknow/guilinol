import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:480,height:270}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&radius=256`)
  await page.waitForFunction(()=>window.viewer?.walk?.active)
  const report=await page.evaluate(async()=>{
    const {walk,stream,manifest,camera}=window.viewer
    function point(id,x,z){
      const e=manifest.landmarks.find(e=>e.id===id), a=e.rotation*Math.PI/180
      return [e.position[0]+x*Math.cos(a)+z*Math.sin(a),e.position[2]-x*Math.sin(a)+z*Math.cos(a)]
    }
    const gallery=(x,z)=>point('zhuangyuan_gallery',x,z), tower=(x,z)=>point('xiaoyao_tower',x,z)
    const start=gallery(-22,0)
    walk.leave()
    camera.position.set(start[0],160,start[1])
    // Fixed-step driving runs synchronously, so finish loading both colliders first.
    const required=['zhuangyuan_gallery','xiaoyao_tower']
    const deadline=performance.now()+45000
    while(!required.every(id=>[...stream.landmarks.keys()].some(e=>e.id===id))){
      if(performance.now()>deadline)throw Error('gallery or tower failed to stream')
      await new Promise(requestAnimationFrame)
    }
    if(!await walk.enter(...start,0,'gallery'))throw Error('gallery spawn failed')
    const initial=walk.probe(), levels=[]
    for(const [x,z] of [gallery(-10,0),gallery(20,0),gallery(28,-.5),tower(-28,-21),tower(-19,-21),tower(-19,-5.25),tower(-15,-5.25),tower(-15,-19),tower(0,-20),tower(0,-10),tower(0,-16),tower(14,-16),tower(14,-7.7),tower(18.7,-7.7),tower(18.7,16.2)]){
      let reached=false
      for(let attempt=0;attempt<350;attempt++){
        const pos=walk.probe(),dx=x-pos.x,dz=z-pos.z,dist=Math.hypot(dx,dz)
        if(dist<.55){levels.push(pos.foot-initial.foot);reached=true;break}
        walk.drive(dx/dist,dz/dist,false);walk.tick(.05)
      }
      if(!reached)throw Error(JSON.stringify({target:[x,z],stopped:walk.probe(),levels}))
    }
    walk.drive(0,0)
    return {levels,resets:walk.probe().resets-initial.resets}
  })
  console.log(report)
  assert.equal(report.resets,0)
  assert.ok(Math.abs(report.levels[4]-2.8)<.35)
  assert.ok(Math.abs(report.levels[5]-8.4)<.35)
  assert.ok(Math.abs(Math.max(...report.levels)-9.84)<.35)
  assert.ok(Math.abs(report.levels.at(-1))<.4)
} finally {await browser?.close();await server.close()}
