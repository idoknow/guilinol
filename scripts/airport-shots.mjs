import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium } from 'playwright'
import { browserOptions } from './qa-browser.mjs'

const views = [
  ['overview', [-24600,520,6300], [-25550,175,7100]],
  ['t2-landside', [-25150,215,7650], [-25600,182,7430]],
  ['t2-airside', [-25950,200,7100], [-25620,182,7430]],
  ['t1-front', [-25250,190,6950], [-25500,180,6860]],
  ['tower', [-25290,184,6600], [-25380,200,6543]],
  ['hangar-cargo', [-25950,215,5750], [-25620,178,5850]],
]
const prefix = process.argv[2] ?? 'captures/airport/before'
await mkdir(dirname(prefix), {recursive:true})
const browser = await chromium.launch(browserOptions())
try {
  const page = await browser.newPage({viewport:{width:1280,height:800}})
  const base = process.env.BASE ?? 'http://localhost:5714'
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
  }
  await writeFile(`${prefix}-metrics.json`, JSON.stringify(metrics, null, 2) + '\n')
} finally {
  await browser.close()
}
