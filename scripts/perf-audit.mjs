import {mkdir, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'
import {glHookScript} from './gl-perf.mjs'

async function sample(page,count){
  return page.evaluate(async count=>{
  const frames=[]
  let previous=await new Promise(requestAnimationFrame)
  for(let i=0;i<count+6;i++){
    window.__glPerf.resetFrame()
    const now=await new Promise(requestAnimationFrame)
    if(i>=6) frames.push({ms:now-previous,...window.__glPerf.readFrame()})
    previous=now
  }
  const memory=window.__glPerf.memory()
  return frames.map(frame=>({...frame,...memory}))
  },count)
}

function summarize(samples){
  const pct=(key,q)=>samples.map(s=>s[key]).sort((a,b)=>a-b)[Math.floor(samples.length*q)]
  const mean=key=>Math.round(samples.reduce((sum,s)=>sum+s[key],0)/samples.length)
  return {calls:mean('totalCalls'),tris:mean('totalTriangles'),buffer:pct('bufferMB',.5),texture:pct('textureMB',.5),p50:pct('ms',.5),p95:pct('ms',.95)}
}

const out = process.argv[2] ?? 'captures/perf-audit'
const frames = 120
await mkdir(out, {recursive:true})
const server = await preview({build:{outDir:process.env.AUDIT_DIST ?? '../dist'},root:'web', configFile:'web/vite.config.ts', preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser = await chromium.launch(browserOptions(true))
  for (const mobile of [false,true]) {
    const rows = []
    const profile = mobile ? 'mobile' : 'desktop'
    for (const id of ['flight','shizijie','zhengyang','palace','gunanmen','jiefang_bridge']) {
      const context = await browser.newContext({viewport:mobile ? {width:390,height:844} : {width:960,height:540},isMobile:mobile,hasTouch:mobile})
      try {
        await context.addInitScript(glHookScript)
        const page = await context.newPage()
        if (mobile) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:4})
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&flow=0&time=10`)
        await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
        const samples = []
        for (const view of id==='flight' ? ['lijiang','elephant','overview','south','foot','palace'] : [id]) {
          await page.evaluate(([view,id])=>{
            const {camera,manifest,setPreset}=window.viewer
            const entry=manifest.landmarks.find(e=>e.id===view)
            if(view==='shizijie'){
              camera.position.set(-891,157,-165)
              camera.lookAt(-866,155,-173)
            } else if(view==='zhengyang'){
              camera.position.set(-718,158,375)
              camera.lookAt(-706,156,343)
            } else if(view==='palace' && id==='palace'){
              const [x,y,z]=manifest.landmarks.find(e=>e.id==='jingjiang').position
              camera.position.set(x+4,y+6,z+62)
              camera.lookAt(x,y+8,z)
            } else if (entry && view!=='palace') {
              const [x,y,z]=entry.position
              camera.position.set(x+50,y+28,z+80)
              camera.lookAt(x,y+5,z)
            } else setPreset(view)
          },[view,id])
          await page.waitForFunction(()=>{
            const {stream,manifest,camera}=window.viewer
            const p=camera.position
            return !stream.pending.size && !stream.forest.pending.size && manifest.chunks.every(t=>{
              const d=Math.hypot(t.x+128-p.x,t.z+128-p.z)
              return (d>stream.radius || stream.loaded.has(t)) && (d>=1682 || stream.forest.loaded.has(t))
            }) && manifest.landmarks.every(e=>Math.hypot(p.x-e.position[0],p.y-e.position[1],p.z-e.position[2])-e.sphere[3]>900 || stream.landmarks.has(e))
          },null,{timeout:120000})
          samples.push(...await sample(page,frames))
          if(id!=='flight'||view==='overview') await page.screenshot({path:`${out}/${profile}-${id}.png`})
        }
        let moving
        if(id==='flight'){
          await page.evaluate(()=>{
            const camera=window.viewer.camera
            camera.position.set(-610,245,-90);camera.lookAt(-530,155,-680)
          })
          await page.keyboard.down('KeyW')
          const forward=await sample(page,60)
          await page.keyboard.up('KeyW')
          moving=summarize(forward)
          samples.push(...forward)
        }
        rows.push({id,first:await page.evaluate(()=>window.viewer.stats.firstMs),...summarize(samples),moving})
        console.log(profile,rows.at(-1))
        await writeFile(`${out}/${profile}.json`,JSON.stringify(rows,null,2))
      } finally {await context.close()}
    }
  }
} finally {await browser?.close();await server.close()}
