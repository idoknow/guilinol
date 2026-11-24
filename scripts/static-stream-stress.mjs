import {mkdir,writeFile} from 'node:fs/promises'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const output=process.argv[2]??'captures/static-stream'
await mkdir(output,{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage({viewport:{width:640,height:360}})
  const logs=[],seen=new Set();let activeRound=0
  const captures=[]
  await page.exposeFunction('recordStaticViolation',(issue,image)=>{
    const key=[issue.layer,issue.owner,issue.mesh,issue.reason].join('|');if(seen.has(key))return
    seen.add(key);const path=`${output}/round-${activeRound}-hit-${seen.size}`
    const write=Promise.all([writeFile(path+'.json',JSON.stringify(issue,null,2)),writeFile(path+'.png',Buffer.from(image.split(',')[1],'base64'))]);captures.push(write);return write
  })
  for(let round=0;round<20;round++){
    activeRound=round+1
    if(round%5===0){
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&time=12&traffic=1&radius=320`,{waitUntil:'commit',timeout:120000})
      await page.waitForFunction(()=>window.viewer?.staticAudit,null,{timeout:120000})
      await page.evaluate(()=>{
        const audit=viewer.staticAudit,check=audit.check;let count=0
        audit.check=()=>{const result=check();if(count<result.issues.length){const png=document.querySelector('body > canvas').toDataURL();for(const issue of result.issues.slice(count))void window.recordStaticViolation(issue,png);count=result.issues.length}return result}
      })
    }
    const bearing=round%4*Math.PI/2,distance=900+round%5*130
    await page.evaluate(async({bearing,distance,round})=>{
      const viewer=window.viewer;viewer.flight();viewer.setRenderRange(round%2?800:256)
      const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
      for(const fraction of [1,.5,.12,0]){
        viewer.camera.position.set(-617+Math.cos(bearing)*distance*fraction,158+fraction*110,-117+Math.sin(bearing)*distance*fraction)
        viewer.camera.lookAt(-399,223,13);await frames()
      }
      viewer.setRenderRange(round%2?480:640)
      if(!await viewer.walkTo(-615,-116,-2.11,'flight'))throw Error('landing failed')
      viewer.walk.face(-2.11,-.25)
    },{bearing,distance,round})
    await page.waitForFunction(()=>{const s=viewer.stream;return !s.pending.size&&[...s.loaded.keys()].some(t=>t.file==='103_39.glc')&&[...s.landmarks.keys()].some(e=>e.id==='wangcheng_mall')&&!document.querySelector('.ld-corner:not([hidden])')},null,{timeout:120000})
    const result=await page.evaluate(()=>({...viewer.staticAudit.check(),loaded:viewer.stats.loaded,range:viewer.renderRange.radius}))
    logs.push({round:round+1,bearing,distance,...result});console.log('round',round+1,'loaded',result.loaded,'issues',result.issues.length)
    await writeFile(`${output}/rounds.json`,JSON.stringify(logs,null,2))
  }
  await Promise.all(captures);if(seen.size)process.exitCode=1
}finally{await browser?.close();await server.close()}
