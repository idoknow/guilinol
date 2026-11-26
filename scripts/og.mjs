import {browserOptions, recordFrames} from './qa-browser.mjs'
/** Capture public/og.jpg (1200×630) from ?cam=elephant&time=17.5 after a production build. */
import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir, copyFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const distOut = join(root, 'dist/og.jpg')
const out = process.env.OG_OUT ?? (process.argv.includes('--update-public') ? join(root, 'public/og.jpg') : distOut)

// 分享图只是装饰：构建机偶尔很慢（页面 load 事件 30 s 内等不到），不能因此让整个网页镜像构建失败。
// 等 DOMContentLoaded 而不是 load，最多试 3 次；都失败就沿用仓库里已有的 og.jpg 并只打警告。
async function capture() {
  const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
  let browser
  try {
    browser = await chromium.launch(browserOptions())
    const page = await browser.newPage({viewport: {width: 1200, height: 630}})
    const port = server.httpServer.address().port
    await page.goto(`http://127.0.0.1:${port}/?verify&${process.env.OG_QUERY ?? 'cam=elephant&time=17.5'}`, {waitUntil: 'domcontentloaded', timeout: 90000})
    await page.waitForFunction(() => window.viewer?.stats.firstMs > 0, null, {timeout: 120000})
    await page.waitForFunction(() => {
      const {stats, stream, camera, manifest} = window.viewer
      return !stats.pending && manifest.chunks.every(tile =>
        Math.hypot(tile.x + 128 - camera.position.x, tile.z + 128 - camera.position.z) > stream.radius
        || stream.loaded.has(tile))
    }, null, {timeout: 180000})
    await recordFrames(page)
    await page.waitForTimeout(400)
    // Hide HUD chrome for a clean share card.
    await page.evaluate(() => {
      for (const sel of ['#boot', 'output', 'footer', '.hint', '.keys-card', '.btn-guide', '.coach', '.toast', '.sky-ui', '.btn-mode', '.hud-me', '.home', '.about-mask', '.walk-ui', '.dock', '.road-name', '.summit-pill', '.spot-card', '.veil', '.render-entry', '.render-pop', '.ride-hud', '.vehicle-action'])
        document.querySelectorAll(sel).forEach(el => { el.style.display = 'none' })
    })
    await mkdir(dirname(out), {recursive: true})
    await page.screenshot({path: out, type: 'jpeg', quality: 82})
  } finally {
    await browser?.close()
    await server.close()
  }
}

let done = false
for (let attempt = 1; attempt <= 3 && !done; attempt++) {
  try { await capture(); done = true } catch (error) { console.warn(`og.jpg capture attempt ${attempt} failed: ${error?.message?.split('\n')[0]}`) }
}
const fallback = join(root, 'public/og.jpg')
if (!done || out !== distOut) { try { await copyFile(done ? out : fallback, distOut) } catch {} }
console.log(done ? `og.jpg ${out}` : `og.jpg capture failed — kept existing ${fallback}`)
