import assert from 'node:assert/strict'
import {mkdir, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions,seedBenchmark} from './qa-browser.mjs'
import {glHookScript} from './gl-perf.mjs'

const [mainDist, prDist] = process.argv.slice(2)
assert(mainDist && prDist, 'Usage: node scripts/perf-drive.mjs MAIN_DIST PR_DIST')
const views = ['overview', 'lijiang', 'palace', 'south', 'walk-palace']
const servers = [], raw = [], summary = []
const quantile = (values, fraction) => [...values].sort((left, right) => left - right)[Math.ceil(values.length * fraction) - 1]
const rounds=Number(process.env.PERF_ROUNDS??5)
assert(Number.isInteger(rounds)&&rounds>0)
const output = 'captures/drive-perf'
await mkdir(output, {recursive:true})
const browser = await chromium.launch(browserOptions())
try {
  for (const path of [mainDist, prDist]) servers.push(await preview({root:'web', configFile:'web/vite.config.ts', build:{outDir:resolve(path)}, preview:{host:'127.0.0.1',port:0}}))
  async function sample(view, side, count, round) {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
    try {
      await seedBenchmark(context)
      await context.addInitScript(glHookScript)
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      const url = `http://127.0.0.1:${servers[side].httpServer.address().port}`
      await page.goto(`${url}/?verify&flow=0&time=10&${process.env.PERF_TRAFFIC==='1'?'traffic=1&':''}${view==='walk-palace'?'mode=walk':`cam=${view}`}`)
      await page.waitForFunction(walking => {
        const viewer = window.viewer
        if (!viewer?.stats.firstMs || viewer.stats.pending || viewer.stream.forest.pending.size || (walking && !viewer.walk?.active)) return false
        const pos = walking ? viewer.walk.position : viewer.camera.position
        return viewer.manifest.chunks.every(tile => {
          const distance = Math.hypot(tile.x+128-pos.x,tile.z+128-pos.z)
          return (distance>viewer.stream.radius || viewer.stream.loaded.has(tile)) && (distance>1682 || viewer.stream.forest.loaded.has(tile))
        })
      }, view==='walk-palace', {timeout:120000})
      await page.evaluate(async () => {for(let frame=0;frame<12;frame++) await new Promise(requestAnimationFrame)})
      await cdp.send('HeapProfiler.collectGarbage')
      const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize
      const frames = await page.evaluate(async count => {
        const frames = []
        let last = await new Promise(requestAnimationFrame)
        for(let index=0;index<count;index++) {
          window.__glPerf.resetFrame()
          const now = await new Promise(requestAnimationFrame)
          const {geometries,textures} = window.viewer.stats
          frames.push({ms:now-last, ...window.__glPerf.readFrame(), geometries, textures})
          last = now
        }
        return frames
      }, count)
      const sha = (await (await fetch(`${url}/version.json`)).json()).sha
      const traffic=await page.evaluate(()=>({cameraY:window.viewer.camera.position.y,assets:performance.getEntriesByType('resource').filter(entry=>/\/roads\/|\/assets\/traffic-/.test(entry.name)).map(entry=>new URL(entry.name).pathname)}))
      const row = {view,side:side?'PR':'main',round,sha,heap,frames,traffic}
      raw.push(row)
      await writeFile(`${output}/raw.json`,JSON.stringify(raw))
      return row
    } finally { await context.close() }
  }
  if(!process.env.PERF_ROUNDS)for(const view of views) {
    const main = await sample(view,0,16,0), pr = await sample(view,1,16,0)
    for(const metric of ['calls','mirrorCalls','triangles','mirrorTriangles','geometries','textures','heap']) {
      const measure = row => metric==='heap'?row.heap:Math.max(...row.frames.map(frame=>frame[metric]))
      const base=measure(main), result=measure(pr)
      const cap=view==='overview' && metric==='calls'?base:base*1.05
      summary.push({view,metric,main:base,PR:result,pass:result<=cap})
    }
  }
  await writeFile(`${output}/summary.json`,JSON.stringify(summary,null,2))
  console.table(summary)
  if(!process.env.PERF_ROUNDS)assert(summary.every(row=>row.pass),'Deterministic gate failed; see raw and summary JSON')
  for(const view of views) {
    const p95s=[[],[]]
    for(let round=1;round<=rounds;round++) for(const side of [0,1]) {
      const row=await sample(view,side,60,round)
      p95s[side].push(quantile(row.frames.map(frame=>frame.ms),.95))
    }
    if(process.env.PERF_ROUNDS){
      for(const metric of ['calls','mirrorCalls','triangles','mirrorTriangles','geometries','textures','heap']){
        const values=['main','PR'].map(side=>raw.filter(row=>row.view===view&&row.side===side&&row.round>0)
          .map(row=>metric==='heap'?row.heap:Math.max(...row.frames.map(frame=>frame[metric]))))
        const [main,PR]=values.map(runs=>quantile(runs,.5))
        summary.push({view,metric,main,PR,runs:values,pass:PR<=main*(view==='overview'&&metric==='calls'?1:1.05)})
      }
    }
    const [base,result]=p95s.map(values=>quantile(values,.5))
    const noise=Math.max(...p95s[0])-Math.min(...p95s[0])
    summary.push({view,metric:'p95 ms',main:base,PR:result,noise,p95s,pass:process.env.PERF_ROUNDS?result<=1.05*base:result-base<=Math.max(.05*base,noise)})
    await writeFile(`${output}/summary.json`,JSON.stringify(summary,null,2))
  }
  console.table(summary.slice(-views.length))
  assert(summary.every(row=>row.pass),'Frame-time gate failed')
} finally { await browser.close(); for(const server of servers) await server.close() }
