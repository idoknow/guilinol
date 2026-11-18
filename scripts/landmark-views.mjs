import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir} from 'node:fs/promises'

const views = {
  jiefang_bridge: [[[-68,12,197],[0,3,0]],[[-138,8,16],[-75,6,17]]],
  huaqiao: [[[-24,7,81],[-27,4,0]],[[4,4.5,35],[0,4,0]]],
  xiaoyao_tower: [[[1,4,38],[0,11,0]],[[-20,6,33],[0,11,0]]],
  fubo: [[[110,-39,8],[12,-33,0]],[[54,-59,2],[34,-61,0]]],
  diecai: [[[-13,-47,-54],[0,-48,-49]],[[12,5,24],[-4,2,10]]],
  mulong: [[[40,12,44],[0,20,0]],[[140,1,-109],[112,1,-127]]],
}
const out = 'captures/rework'
await mkdir(out,{recursive:true})
const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:960,height:600}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=256&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  for(const [id,pair] of Object.entries(views))for(const [index,[eye,target]] of pair.entries()){
    await page.evaluate(([id,eye,target])=>{
      const {manifest,camera}=window.viewer,entry=manifest.landmarks.find(item=>item.id===id)
      const angle=entry.rotation*Math.PI/180
      const world=([x,y,z])=>[entry.position[0]+x*Math.cos(angle)+z*Math.sin(angle),entry.position[1]+y,entry.position[2]-x*Math.sin(angle)+z*Math.cos(angle)]
      camera.position.set(...world(eye));camera.lookAt(...world(target))
    },[id,eye,target])
    await page.waitForFunction(id=>{const {stream,stats}=window.viewer;return !stats.pending&&[...stream.landmarks].some(([item,root])=>item.id===id&&root.getObjectByName('lod0')?.visible)},id,{timeout:45000})
    const render=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await render()
    await page.screenshot({path:`${out}/${id}-${index}.png`})
    const toggle=visible=>page.evaluate(([id,visible])=>{[...window.viewer.stream.landmarks].find(([item])=>item.id===id)[1].visible=visible},[id,visible])
    await toggle(false);await render();await page.screenshot({path:`${out}/${id}-${index}-without.png`});await toggle(true)
  }
} finally {await browser?.close();await server.close()}
