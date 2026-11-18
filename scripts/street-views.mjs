import {readFile,mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:960,height:540}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk`)
  await page.waitForFunction(()=>window.viewer?.walk?.active)
  const settle=()=>page.waitForFunction(()=>{const {stats,stream,walk,manifest}=window.viewer,eye=walk.position
    return !stats.pending&&manifest.chunks.every(tile=>Math.hypot(tile.x+128-eye.x,tile.z+128-eye.z)>stream.radius||stream.loaded.has(tile))})
  await settle()
  console.log('default walk calls',await page.evaluate(async()=>{const calls=[];for(let frame=0;frame<30;frame++){await new Promise(requestAnimationFrame);calls.push(window.viewer.stats.calls)}return calls.sort((a,b)=>a-b)[15]}))
  if(!process.argv.includes('--baseline')){
    const report=JSON.parse(await readFile('public/world/street-report.json','utf8'))
    const views=[['crossroads',-891,-165,-1.2],['placeholder',-884,-166,-1]]
    for(const [name,file] of [['解放东路','jiefang'],['正阳步行街','zhengyang'],['榕湖北路','ronghu']]){
      const road=report.filter(road=>road.name===name).sort((a,b)=>b.length-a.length)[0];views.push([file,road.x,road.z,road.yaw])
    }
    await mkdir('captures/streets',{recursive:true})
    for(const [name,...coords] of views){
      const ok=await page.evaluate(async coords=>{const {walk}=window.viewer;walk.leave();return await walk.enter(...coords,'screenshot')},coords)
      if(!ok)throw Error(`No walkable spawn: ${name}`);await settle();await page.screenshot({path:`captures/streets/${name}.png`})
    }
  }
}finally{await browser?.close();await server.close()}
