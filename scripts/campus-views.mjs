// Campus acceptance shots (IDOK-83): top-down + low obliques in landmark-local coordinates.
// usage: node scripts/campus-views.mjs <id> <json views>  (needs `npm run build` first)
// views: [{"name":"top","eye":[x,y,z],"target":[x,y,z],"w":900,"h":900,"fov":40}, ...]
import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir} from 'node:fs/promises'

const [id, raw] = process.argv.slice(2)
const views = JSON.parse(raw)
const out = 'captures/campus'
await mkdir(out, {recursive: true})
const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
let browser
try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']})
  for (const view of views) {
    const page = await browser.newPage({viewport: {width: view.w ?? 960, height: view.h ?? 600}})
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=384&time=11`)
    await page.waitForFunction(() => window.viewer?.stats.firstMs > 0)
    await page.evaluate(([id, view]) => {
      const {manifest, camera} = window.viewer, entry = manifest.landmarks.find(item => item.id === id)
      const angle = (entry.rotation ?? 0) * Math.PI / 180
      const world = ([x, y, z]) => [entry.position[0] + x * Math.cos(angle) + z * Math.sin(angle), entry.position[1] + y, entry.position[2] - x * Math.sin(angle) + z * Math.cos(angle)]
      if (view.fov) { camera.fov = view.fov; camera.updateProjectionMatrix() }
      if (view.far) { camera.far = view.far; camera.updateProjectionMatrix() }
      camera.position.set(...world(view.eye)); if (view.up) camera.up.set(...view.up); camera.lookAt(...world(view.target))
      window.__campusView = {pos: world(view.eye), tgt: world(view.target), up: view.up}
    }, [id, view])
    await page.waitForFunction(id => {const {stream, stats} = window.viewer; return !stats.pending && [...stream.landmarks].some(([item, root]) => item.id === id && root.getObjectByName('lod0')?.visible)}, id, {timeout: 90000})
    const render = () => page.evaluate(() => new Promise(resolve => {
      const {camera} = window.viewer, v = window.__campusView
      camera.position.set(...v.pos); if (v.up) camera.up.set(...v.up); camera.lookAt(...v.tgt)
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }))
    for (let i = 0; i < 6; i++) await render()
    await page.screenshot({path: `${out}/${id}-${view.name}.png`})
    await page.close()
  }
} finally { await browser?.close(); await server.close() }
