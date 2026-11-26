import assert from 'node:assert/strict'
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const CAPTURE_DIR = resolve(ROOT, 'captures/renmin-hospital')

// Hospital anchor world coords: (-988.47, 151.60, 827.09)
const WALK_SPOT = {x: -1062.0, z: 828.0}

const CAMERAS = [
  {
    key: 'front-gate',
    label: '正门主立面（文明路行道树东侧无遮挡望门诊楼/两块楼顶牌/西北竖柱/中庭/1F雨棚/地库）',
    pos: [-1066.5, 160.2, 822.0],
    look: [-1018.0, 167.4, 824.5],
    fov: 56,
  },
  {
    key: 'emergency-lane',
    label: '急诊入口与遮雨棚（开放车道东望急诊厅/←急诊/双面急诊雨棚/蓝底导视牌/120救护车/弧顶）',
    pos: [-1060.5, 154.6, 850.0],
    look: [-1026.0, 157.8, 868.5],
    fov: 52,
  },
  {
    key: 'overview',
    label: '院区斜视总览（门诊/急诊/医技/中央11F住院主楼/东翼/圆顶/花园）',
    pos: [-1122.0, 214.0, 922.0],
    look: [-976.0, 160.0, 836.0],
    fov: 48,
  },
  {
    key: 'wenming-seam',
    label: '文明路路面交接低空斜视图（核验人行道/车道共享材质零色差、无裸地缝、碑墙与地库招牌）',
    pos: [-1061.5, 153.8, 857.5],
    look: [-1049.5, 152.0, 825.0],
    fov: 54,
  },
  {
    key: 'east-gate',
    label: '滨江路东门牌楼与青砖住院东翼（桂林市人民医院·东门通道/蓝顶岗亭/伸缩门/铁艺围墙/青砖白带）',
    pos: [-891.0, 156.4, 879.0],
    look: [-916.0, 157.8, 875.5],
    fov: 50,
  },
]

async function waitForWalkReady(page) {
  await page.waitForFunction(
    () => Boolean(window.viewer?.walk?.active && window.viewer?.stream && window.viewer?.stats?.loaded >= 6),
    null,
    {timeout: 180000},
  )
}

async function waitForHospitalLoaded(page) {
  await page.waitForFunction(
    () => {
      const entries = [...(window.viewer?.stream?.landmarks?.entries() ?? [])]
      const found = entries.find(([e]) => e.id === 'renmin_hospital')
      if (!found) return false
      const root = found[1]
      return Boolean(root?.visible && root.children.length > 0)
    },
    null,
    {timeout: 180000},
  )
  await page.waitForTimeout(550)
}

async function captureTimeSlice(browser, baseUrl, timeVal, tag) {
  console.log(`[verify-renmin-hospital] start ${tag} (time=${timeVal})`)
  const ctx = await browser.newContext({viewport: {width: 1280, height: 720}})
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', err => {
    console.error(`[pageerror ${tag}]`, err.message)
    errors.push(`pageerror(${tag}): ${err.message}`)
  })
  const badAssetResponses = []
  page.on('response', res => {
    if (res.status() >= 400) {
      const url = res.url()
      const isApi = new URL(url).pathname.startsWith('/api/')
      if (!isApi) {
        console.error(`[http ${res.status()} ${tag}] ${url}`)
        badAssetResponses.push(`http ${res.status()}(${tag}): ${url}`)
      }
    }
  })
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const txt = msg.text()
      if (txt.includes('Failed to load resource: the server responded with a status of 404')) return
      console.error(`[console.error ${tag}]`, txt)
      errors.push(`console.error(${tag}): ${txt}`)
    }
  })
  await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
  await page.route('**/api/t', r => r.fulfill({status: 204}))
  await page.goto(`${baseUrl}/?verify&mode=walk&flow=0&time=${timeVal}`, {waitUntil: 'domcontentloaded'})
  await waitForWalkReady(page)
  await page.evaluate(async pos => {
    await window.viewer.walkTo(pos.x, pos.z, -1.6, 'renmin-hospital-check')
  }, WALK_SPOT)
  await waitForHospitalLoaded(page)
  // Wait for nearby terrain/building/forest chunks to finish streaming cleanly
  await page.waitForFunction(
    () => (window.viewer?.stats?.pending ?? 1) === 0 && (window.viewer?.stream?.forest?.pending?.size ?? 1) === 0,
    null,
    {timeout: 60000},
  ).catch(() => {})
  await page.waitForTimeout(350)

  // Inspect loaded landmark: 0 dynamic lights, expected atlas + lit materials, shared street surfaces bound
  const inspection = await page.evaluate(() => {
    const entries = [...window.viewer.stream.landmarks.entries()]
    const found = entries.find(([e]) => e.id === 'renmin_hospital')
    if (!found) return {found: false}
    const [entry, root] = found
    let lights = 0
    let meshCount = 0
    let streetBoundMeshes = 0
    const matNames = new Set()
    root.traverse(obj => {
      if (obj.isLight) lights++
      if (obj.isMesh) {
        meshCount++
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        for (const m of mats) {
          if (!m) continue
          if (m.name) matNames.add(m.name)
          // Shared streetSurfaceMat binds aSurface attribute on geometry
          if (obj.geometry?.getAttribute?.('aSurface')) streetBoundMeshes++
        }
      }
    })
    return {
      found: true,
      position: entry.position,
      sphere: entry.sphere,
      lights,
      meshCount,
      streetBoundMeshes,
      materials: [...matNames].sort(),
      drawCalls: window.viewer.stats?.calls ?? -1,
    }
  })

  assert.equal(inspection.found, true, `${tag}: renmin_hospital landmark must load`)
  assert.equal(inspection.lights, 0, `${tag}: renmin_hospital must add ZERO Three.js dynamic lights`)
  assert.ok(
    inspection.materials.includes('renmin_hospital_atlas'),
    `${tag}: missing renmin_hospital_atlas material (got ${JSON.stringify(inspection.materials)})`,
  )
  assert.ok(
    inspection.materials.includes('renmin_hospital_lit'),
    `${tag}: missing renmin_hospital_lit material (got ${JSON.stringify(inspection.materials)})`,
  )
  assert.ok(
    inspection.streetBoundMeshes > 0,
    `${tag}: expected seam-surfaces.json streetSurfaceMat binding on hospital paving`,
  )

  const shots = []
  await page.evaluate(() => {
    window.viewer.walk.leave()
    // Disable MARK_LAYER (layer 2) so 3D floating city POI seals (塔/巷/街) stay hidden in clean architectural shots
    window.viewer.camera?.layers?.disable?.(2)
  })
  // Hide all DOM HUD chrome cleanly so screenshots show 100% unobstructed 3D architecture
  await page.addStyleTag({content: 'body > :not(canvas){visibility:hidden!important}'})

  for (const camSpec of CAMERAS) {
    await page.evaluate(async spec => {
      const cam = window.viewer.camera
      cam.position.set(...spec.pos)
      cam.lookAt(...spec.look)
      cam.fov = spec.fov
      cam.updateProjectionMatrix()
      cam.updateMatrixWorld()
      // Wait several RAF frames for LOD0 & streaming stability
      for (let i = 0; i < 6; i++) {
        await new Promise(r => requestAnimationFrame(r))
      }
    }, camSpec)
    await page.waitForTimeout(250)
    const file = `${camSpec.key}-${tag}.png`
    const outPath = resolve(CAPTURE_DIR, file)
    await page.screenshot({path: outPath})
    shots.push({key: camSpec.key, tag, file: outPath})
    console.log(`[verify-renmin-hospital] captured ${file}`)
  }

  assert.equal(badAssetResponses.length, 0, `${tag} asset HTTP errors: ${badAssetResponses.join('; ')}`)
  assert.equal(errors.length, 0, `${tag} runtime errors: ${errors.join('; ')}`)
  await ctx.close()
  return {inspection, shots}
}

async function run() {
  mkdirSync(CAPTURE_DIR, {recursive: true})

  // Validate registry & seam-surfaces config integrity
  const landmarks = JSON.parse(readFileSync(resolve(ROOT, 'pipeline/landmarks.json'), 'utf8'))
  const entry = landmarks.find(x => x.id === 'renmin_hospital')
  assert.ok(entry, 'renmin_hospital missing in pipeline/landmarks.json')
  assert.ok(entry.gameplayAnchors?.ambulanceNorthEntry, 'missing ambulanceNorthEntry gameplay anchor')
  assert.ok(entry.gameplayAnchors?.ambulanceSouthEntry, 'missing ambulanceSouthEntry gameplay anchor')
  assert.ok(entry.gameplayAnchors?.comedyRecoverySpawn, 'missing comedyRecoverySpawn gameplay anchor')

  const seams = JSON.parse(readFileSync(resolve(ROOT, 'pipeline/seam-surfaces.json'), 'utf8'))
  assert.deepEqual(
    seams.surfaces?.renmin_hospital,
    {road: 'road', sidewalk: 'sidewalk', curb: 'curb'},
    'renmin_hospital must bind shared road/sidewalk/curb surfaces in pipeline/seam-surfaces.json',
  )

  const server = await preview({
    root: resolve(ROOT, 'web'),
    configFile: resolve(ROOT, 'web/vite.config.ts'),
    preview: {host: '127.0.0.1', port: 0, strictPort: false},
  })
  const addr = server.httpServer?.address()
  const baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 4173}`
  const browser = await chromium.launch(browserOptions(process.env.QA_NATIVE_GPU !== '0'))

  try {
    const day = await captureTimeSlice(browser, baseUrl, '13.5', 'day')
    const night = await captureTimeSlice(browser, baseUrl, '21.5', 'night')

    const summary = {
      ok: true,
      landmark: 'renmin_hospital',
      gpu: process.env.QA_NATIVE_GPU !== '0' && process.platform === 'darwin' ? 'metal' : 'swiftshader',
      day: day.inspection,
      night: night.inspection,
      gameplayAnchors: entry.gameplayAnchors,
      captures: [...day.shots, ...night.shots].map(s => s.file),
    }
    writeFileSync(resolve(CAPTURE_DIR, 'report.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await browser.close()
    await new Promise(resolveClose => server.httpServer.close(resolveClose))
  }
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
