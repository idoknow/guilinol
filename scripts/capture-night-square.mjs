import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const out=process.argv[2]??'captures/night-square'
await mkdir(out,{recursive:true})
const token=process.env.FEEDBACK_VIEW
assert.ok(token,'Set FEEDBACK_VIEW to the view parameter from the report')
const view=JSON.parse(Buffer.from(token,'base64url').toString())
const site=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage({viewport:{width:800,height:450}}),errors=[]
  page.on('pageerror',error=>console.error(error.message))
  page.on('console',msg=>{if(/Shader Error|GL_INVALID/.test(msg.text()))errors.push(msg.text())})
  await page.goto(`http://127.0.0.1:${site.httpServer.address().port}/?verify&debug&gfx=low&dpr=1&flow=0&time=21&view=${Buffer.from(JSON.stringify(view)).toString('base64url')}`,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.viewer?.stats.loaded>0,null,{timeout:180000})
  await page.evaluate(view=>window.viewer.setView(view),view)
  await page.waitForFunction(()=>window.viewer.stats.frame>8&&!window.viewer.stats.pending&&window.viewer.stream.loaded.size>0,null,{timeout:180000})
  await page.evaluate(()=>window.viewer.freeze())
  for(const angle of ['ground','aerial','aerial-shift']){
    const png=await page.evaluate(({angle,view})=>{
      const {camera,redrawGfx}=window.viewer
      if(angle!=='ground'){
        camera.position.set(view.x+(angle==='aerial-shift'?.12:0),395,view.z+90)
        camera.rotation.set(-65*Math.PI/180,0,0,'YXZ')
      }
      camera.updateMatrixWorld();redrawGfx()
      const scene=document.querySelector('canvas'),copy=document.createElement('canvas');copy.width=scene.width;copy.height=scene.height
      copy.getContext('2d').drawImage(scene,0,0)
      return copy.toDataURL().split(',')[1]
    },{angle,view})
    await writeFile(join(out,angle+'.png'),Buffer.from(png,'base64'))
  }
  assert.deepEqual(errors,[])
}finally{await browser?.close();await site.close()}
