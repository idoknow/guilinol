import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { browserOptions } from './qa-browser.mjs'

const views = [
  ['overview', [-24600,520,6300], [-25550,175,7100]],
  ['t2-landside', [-25150,215,7650], [-25600,182,7430]],
  ['t2-airside', [-25950,200,7100], [-25620,182,7430]],
  ['t1-front', [-25250,190,6950], [-25500,180,6860]],
  ['tower', [-25290,184,6600], [-25380,200,6543]],
  ['hangar-cargo', [-25950,215,5750], [-25620,178,5850]],
  ['departure-walk', [-25467,184,7410], [-25520,190,7420]],
  ['stand-walk', [-25894,177,7644], [-25874,180,7640]],
  ['threshold-walk', [-26366,177,8248], [-26354,177,8170]],
]
const prefix = process.argv[2] ?? 'captures/airport/before'
await mkdir(dirname(prefix), {recursive:true})
const server = process.env.BASE ? null : await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser = await chromium.launch(browserOptions())
  const page = await browser.newPage({viewport:{width:1280,height:800}})
  const base = process.env.BASE ?? `http://127.0.0.1:${server.httpServer.address().port}`
  await page.goto(new URL('/?verify&flow=0&time=11', base).href, {waitUntil:'commit'})
  await page.waitForFunction(() => window.viewer?.camera, null, {timeout:180000})
  const metrics = {}
  for (const [name, eye, target] of views) {
    await page.evaluate(([eye,target]) => {
      const { camera, manifest } = window.viewer
      if (!manifest.region || manifest.dev_bbox) throw Error('Airport shots require the expanded world')
      camera.position.set(...eye)
      camera.lookAt(...target)
      camera.updateMatrixWorld()
    }, [eye,target])
    await page.waitForTimeout(4000)
    await page.waitForFunction(() => {
      const { stream, manifest, camera } = window.viewer
      const nearby = manifest.chunks.filter(tile => Math.hypot(tile.x + 128 - camera.position.x,
        tile.z + 128 - camera.position.z) <= stream.radius)
      return nearby.length && nearby.every(tile => stream.loaded.has(tile)) &&
        !stream.pending.size && !stream.forest.pending.size
    }, null, {timeout:120000})
    metrics[name] = await page.evaluate(async () => {
      const samples = []
      for (let frame = 0; frame < 12; frame++) {
        await new Promise(requestAnimationFrame)
        samples.push(window.viewer.stats.calls)
      }
      return {peakCalls:Math.max(...samples), samples}
    })
    await page.screenshot({path:`${prefix}-${name}.jpg`, quality:85})
    console.log(name, metrics[name].peakCalls)
  }
  await writeFile(`${prefix}-metrics.json`, JSON.stringify(metrics, null, 2) + '\n')
} finally {
  await browser?.close()
  await server?.close()
}
