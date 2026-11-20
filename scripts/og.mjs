import {browserOptions, recordFrames} from './qa-browser.mjs'
/** Capture public/og.jpg (1200×630) from ?cam=elephant&time=17.5 after a production build. */
import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir, copyFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.OG_OUT ?? join(root, 'public/og.jpg')
const distOut = join(root, 'dist/og.jpg')

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
let browser
try {
  browser = await chromium.launch(browserOptions())
  const page = await browser.newPage({viewport: {width: 1200, height: 630}})
  const port = server.httpServer.address().port
  await page.goto(`http://127.0.0.1:${port}/?verify&${process.env.OG_QUERY ?? 'cam=elephant&time=17.5'}`)
  await page.waitForFunction(() => window.viewer?.stats.firstMs > 0, null, {timeout: 60000})
  await page.waitForFunction(() => {
    const {stats, stream, camera, manifest} = window.viewer
    return !stats.pending && manifest.chunks.every(tile =>
      Math.hypot(tile.x + 128 - camera.position.x, tile.z + 128 - camera.position.z) > stream.radius
      || stream.loaded.has(tile))
  }, null, {timeout: 120000})
  await recordFrames(page)
  await page.waitForTimeout(400)
  // Hide HUD chrome for a clean share card.
  await page.evaluate(() => {
    for (const sel of ['#boot', 'output', 'footer', '.hint', '.toast', '.sky-ui', '.btn-mode', '.hud-me', '.home', '.about-mask', '.walk-ui', '.dock', '.road-name', '.summit-pill', '.spot-card', '.veil'])
      document.querySelectorAll(sel).forEach(el => { el.style.display = 'none' })
  })
  await mkdir(dirname(out), {recursive: true})
  await page.screenshot({path: out, type: 'jpeg', quality: 82})
  try { await copyFile(out, distOut) } catch {}
  console.log('og.jpg', out)
} finally {
  await browser?.close()
  await server.close()
}
