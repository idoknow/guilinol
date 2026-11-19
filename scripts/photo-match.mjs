import { browserOptions } from './qa-browser.mjs'
import { parseArgs } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

const refs = resolve('docs/refs/rock'),
  out = resolve('captures/photo-match')
const locations = JSON.parse(await readFile(join(refs, 'photo-locations.json')))
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: 'boolean' },
    height: { type: 'string', default: '1.5' },
    'yaw-offset': { type: 'string', default: '0' },
  },
})
// Loaded SwiftShader hosts (sg at load 30+) render ~0.5 fps; allow a longer settle there.
const settleMs = Number(process.env.PHOTO_MATCH_TIMEOUT_MS ?? 90000)
const height = Number(values.height),
  offset = Number(values['yaw-offset'])
if (!Number.isFinite(height) || !Number.isFinite(offset))
  throw Error('height and yaw-offset must be finite numbers')
const keys = Object.keys(locations)
const selected = new Set(values.all ? keys : [])
for (const arg of positionals) {
  const input = arg.replace(/^\.\//, '')
  const key =
    input.startsWith('docs/refs/rock') || input.startsWith('/') ? relative(refs, resolve(input)) : input
  const dir = key.replace(/\/$/, '')
  const id = /^IMG_(\d+)(?:\.jpg)?$/i.exec(key)?.[1]
  if (id) {
    const candidates = keys.filter((k) => /(?:^|_)IMG_(\d+)\.jpg$/i.exec(basename(k))?.[1] === id)
    if (candidates.length !== 1)
      throw Error(
        candidates.length
          ? 'Ambiguous photo ' + key + ': ' + candidates.join(', ')
          : 'No geotagged photos for ' + key,
      )
    selected.add(candidates[0])
    continue
  }
  const matches = keys.filter(
    (k) => k === key || k.startsWith(dir + '/') || !dir || dir === '.' || basename(k, '.jpg') === key,
  )
  if (!matches.length) throw Error('No geotagged photos for ' + input)
  matches.forEach((k) => selected.add(k))
}
if (!selected.size) throw Error('Specify photo keys, directory or --all')
const number = (key) => Number(/IMG_(\d+)/.exec(key)[1])
const ordered = [...selected].sort((a, b) => number(a) - number(b))
const server = await preview({
  root: 'web',
  configFile: 'web/vite.config.ts',
  preview: { host: '127.0.0.1', port: 0 },
})
let browser, currentKey
try {
  browser = await chromium.launch(browserOptions(true))
  const page = await browser.newPage()
  const compose = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/?verify&time=12')
  await page.waitForFunction(() => window.viewer?.tour)
  await page.evaluate(() => window.viewer.tour.photo.open())
  await page.addStyleTag({ content: 'body > :not(canvas) {display:none!important}' })
  const cards = [],
    calls = []
  const settle = () =>
    page.waitForFunction(
      () => {
        const { stats, stream, camera, manifest } = window.viewer
        const p = camera.position
        return (
          stats.frame > 2 &&
          !stream.pending.size &&
          !stream.forest.pending.size &&
          manifest.chunks.every((t) => {
            const d = Math.hypot(t.x + 128 - p.x, t.z + 128 - p.z)
            return (d > stream.radius || stream.loaded.has(t)) && (d >= 1682 || stream.forest.loaded.has(t))
          }) &&
          (manifest.landmarks ?? []).every(
            (l) =>
              Math.hypot(p.x - l.position[0], p.y - l.position[1], p.z - l.position[2]) - l.sphere[3] > 900 ||
              stream.landmarks.has(l),
          )
        )
      },
      null,
      { timeout: settleMs },
    )
  for (const key of ordered) {
    currentKey = key
    const data = 'data:image/jpeg;base64,' + (await readFile(join(refs, key))).toString('base64')
    const viewport = await compose.evaluate(async (src) => {
      const img = new Image()
      img.src = src
      await img.decode()
      window.reference = img
      const scale = Math.min(1, 960 / Math.max(img.width, img.height))
      return { width: Math.round(img.width * scale), height: Math.round(img.height * scale) }
    }, data)
    await page.setViewportSize(viewport)
    const location = locations[key]
    // WMM2025, Guilin (25.2825 N, 110.2942 E), 2026-11-19, 154 m ASL.
    // IMG_1425 and IMG_1426 are the two magnetic headings in this collection.
    const bridgeRadius = location.support === 'deck' ? location.hAccuracy : 0
    const heading = location.heading + (location.headingRef === 'M' ? -3.0763 : 0)
    await page.evaluate(({ x, z }) => window.viewer.camera.position.set(x, 220, z), location)
    await settle()
    const { support, eyeY } = await page.evaluate(
      async ({ location, heading, height, offset, bridgeRadius }) => {
        const { x, z, focal35 } = location
        const { camera, photoSupport } = window.viewer
        const support = await photoSupport(x, z, bridgeRadius)
        const eyeY = support.y + height
        camera.position.set(x, eyeY, z)
        camera.rotation.set(0, (-(heading + offset) * Math.PI) / 180, 0, 'YXZ')
        camera.aspect = innerWidth / innerHeight
        camera.fov = (2 * Math.atan(18 / (focal35 * camera.aspect)) * 180) / Math.PI
        camera.updateProjectionMatrix()
        return { support, eyeY }
      },
      { location, heading, height, offset, bridgeRadius },
    )
    await settle()
    // The loaders publish data between frames. Let the render loop apply LOD and tree batches.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    calls.push(await page.evaluate(() => window.viewer.stats.calls))
    const shot = await page.screenshot({ type: 'png' })
    const images = await compose.evaluate(
      async ({ src, width, height }) => {
        const game = new Image()
        game.src = src
        await game.decode()
        const canvas = document.createElement('canvas')
        canvas.width = width * 2
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(window.reference, 0, 0, width, height)
        ctx.drawImage(game, width, 0, width, height)
        const jpeg = () => canvas.toDataURL('image/jpeg', 0.91).split(',')[1]
        const pair = jpeg()
        canvas.width = width
        ctx.drawImage(window.reference, 0, 0, width, height)
        ctx.globalAlpha = 0.5
        ctx.drawImage(game, 0, 0, width, height)
        return [pair, jpeg()]
      },
      { src: 'data:image/png;base64,' + shot.toString('base64'), ...viewport },
    )
    const overlay = key.replace(/\.jpg$/i, '.overlay.jpg')
    await mkdir(dirname(join(out, key)), { recursive: true })
    for (const [i, path] of [key, overlay].entries())
      await writeFile(join(out, path), Buffer.from(images[i], 'base64'))
    const estimate = support.sampleDistance
      ? `（距机位 ${support.sampleDistance.toFixed(1)} m 处桥面估高）`
      : ''
    cards.push(`<figure>
      <figcaption>${key} · ${support.kind} ${support.y.toFixed(2)} m${estimate} · 机位 ${eyeY.toFixed(2)} m · 真北 ${heading.toFixed(1)}° · ${location.focal35} mm · GPS ±${location.hAccuracy} m · <a href="${overlay}">50% 叠加</a></figcaption>
      <a href="${key}"><img loading="lazy" src="${key}" alt="${key} 实拍和游戏对比" width="${viewport.width * 2}" height="${viewport.height}"></a>
    </figure>`)
  }
  currentKey = 'index.html'
  await writeFile(
    join(out, 'index.html'),
    `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>桂林同机位对比</title><style>
body{font:16px system-ui;margin:2rem;background:#f7f5ef;color:#24312f}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:20px}
figure{margin:0}img{width:100%;height:auto}figcaption{margin-bottom:.4rem;overflow-wrap:anywhere}
</style><h1>桂林同机位对比</h1>
<p>左为实拍，右为游戏 · ${cards.length} 个机位 · 支撑面 + ${height} m · 真北顺时针修正 ${offset}° · 俯仰 0°</p>
<main>${cards.join('\n')}</main></html>`,
  )
  await compose.goto(pathToFileURL(join(out, 'index.html')).href)
  await compose.evaluate(async () => {
    const visible = [...document.images].filter((img) => img.getBoundingClientRect().top < innerHeight)
    await Promise.all(
      visible.map((img) => {
        img.loading = 'eager'
        return img.decode()
      }),
    )
    await document.fonts.ready
  })
  await compose.screenshot({ path: join(out, 'index.png') })
  console.log(
    JSON.stringify({
      photos: calls.length,
      firstMs: await page.evaluate(() => window.viewer.stats.firstMs),
      meanCalls: calls.reduce((a, b) => a + b, 0) / calls.length,
    }),
  )
} catch (cause) {
  throw Error(`${currentKey ?? 'viewer'}: ${cause.message}`, { cause })
} finally {
  await browser?.close()
  await server.close()
}
