import assert from 'node:assert/strict'
import {mkdir, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions,seedBenchmark} from './qa-browser.mjs'
import {glHookScript} from './gl-perf.mjs'

const [mainDist, prDist] = process.argv.slice(2)
assert(mainDist && prDist, 'Usage: node scripts/vehicle-draw-list.mjs MAIN_DIST PR_DIST')
const servers = []
const output = 'captures/drive-perf'
await mkdir(output, {recursive:true})
const browser = await chromium.launch(browserOptions())
try {
  for (const path of [mainDist, prDist]) servers.push(await preview({root:'web', configFile:'web/vite.config.ts', build:{outDir:resolve(path)}, preview:{host:'127.0.0.1',port:0}}))
  async function sample(side) {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
    try {
      await seedBenchmark(context)
      await context.addInitScript(glHookScript)
      const page = await context.newPage()
      const url = `http://127.0.0.1:${servers[side].httpServer.address().port}`
      await page.goto(url+'/?verify&flow=0&time=10&traffic=1&mode=walk')
      await page.waitForFunction(() => {
        const viewer = window.viewer
        if (!viewer?.stats.firstMs || viewer.stats.pending || viewer.stream.forest.pending.size || !viewer.walk?.active) return false
        const pos = viewer.walk.position
        return viewer.manifest.chunks.every(tile => {
          const distance = Math.hypot(tile.x+128-pos.x,tile.z+128-pos.z)
          return (distance>viewer.stream.radius || viewer.stream.loaded.has(tile)) && (distance>1682 || viewer.stream.forest.loaded.has(tile))
        })
      }, undefined, {timeout:120000})
      await page.evaluate(async () => {for(let frame=0;frame<12;frame++) await new Promise(requestAnimationFrame)})
      return await page.evaluate(async()=>{
        const {stream,camera}=window.viewer,records=[]
        let counts={}
        const hooked=new WeakSet()
        const hook=()=>stream.scene.traverse(obj=>{
          if(!obj.isMesh||hooked.has(obj))return
          hooked.add(obj)
          const original=obj.onBeforeRender
          const names=[]
          for(let p=obj;p;p=p.parent)if(p.name)names.unshift(p.name)
          const attrs=Object.keys(obj.geometry.attributes).sort().join(',')
          const label=(names.join('/')||obj.type)+' '+attrs
          obj.onBeforeRender=function(renderer,scene,cam,...rest){
            const key=(cam===camera?'main ':'mirror ')+label
            counts[key]=(counts[key]??0)+1
            return original.call(this,renderer,scene,cam,...rest)
          }
        })
        for(let i=0;i<60;i++){
          hook()
          counts={}
          window.__glPerf.resetFrame()
          await new Promise(requestAnimationFrame)
          records.push({meshes:counts,gl:window.__glPerf.readFrame()})
        }
        return records
      })
    } finally { await context.close() }
  }
  for(let round=1;round<=3;round++)for(const side of [0,1]){
    const records=await sample(side)
    await writeFile(output+'/mobile-draws-'+round+'-'+side+'.json',JSON.stringify(records))
  }
} finally { await browser.close(); for(const server of servers) await server.close() }
