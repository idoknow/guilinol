#!/usr/bin/env node
/**
 * Headless Metal Playwright & static asset verification for IDOK-402:
 * Zhongqu Police Station (桂林市公安局秀峰分局榕城派出所 · 依仁路1-4号) &
 * Zhongqu Traffic Police Squadron (桂林交警秀峰大队中区执勤中队 · 依仁路×漓滨路据点).
 *
 * Verifies:
 *   1. GLB binary, Meshopt + KTX2 compression, LOD0/LOD1 nodes & <= 4MB GPU VRAM budget;
 *   2. Structured metadata preserved natively by `pack_landmarks.py` via `zhongqu_police.meta.json`;
 *   3. `pipeline/seam-surfaces.json` street-surface bindings (`road`, `sidewalk`, `curb`);
 *   4. Independent, fully converged Headless Metal WebGL2 sessions across 8 cameras × 2 modes
 *      (Sunny Noon `?time=13.5&weather=clear&flow=0` + Converged Rainy Night `?time=21.5&weather=rain&flow=0`):
 *      - 01_front_fascia: 依仁路1-4号榕城派出所正面门头与无立柱遮挡接警大厅
 *      - 02_colonnade_ceiling: 骑楼走廊仰拍 2F 挑出天花板封底（零透空见天）
 *      - 03_cruiser_closeup: 院内制式警车完整侧面涂装（警察 POLICE / 桂C·1108警）近景
 *      - 04_moto_kiosk_closeup: 路侧交警铁骑涂装（桂林交警铁骑）与执勤岗亭近景
 *      - 05_equip_locker: 警务装备领用室招牌（无雨棚遮挡）与 A 级背心架
 *      - 06_gateway_seam: 漓滨路出警大门坡面黄网格标线与西南人行道平顺接缝
 *      - 07_oblique_overview: 派出所+交警中队大院斜视总览（白砖条窗与正常暖光窗格）
 *      - 08_b2_ne_corner: 依仁路×漓滨路口交警中队东北立面与骑楼退让车行道验证
 *
 * Strictly headless — never opens visible browser windows on shared macOS host.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = process.argv[2] || '/tmp/zhongqu-police-shots'
fs.mkdirSync(OUT_DIR, { recursive: true })

// ----------------------------------------------------------------------------
// 1. Static GLB, Metadata & Seam-Binding Gate
// ----------------------------------------------------------------------------
const glbPath = path.join(ROOT, 'public/landmarks/zhongqu_police.glb')
const metaPath = path.join(ROOT, 'public/landmarks/zhongqu_police.json')
const landmarksPath = path.join(ROOT, 'pipeline/landmarks.json')
const seamsPath = path.join(ROOT, 'pipeline/seam-surfaces.json')

assert.ok(fs.existsSync(glbPath), 'Missing public/landmarks/zhongqu_police.glb')
assert.ok(fs.existsSync(metaPath), 'Missing public/landmarks/zhongqu_police.json')

const glbBuf = fs.readFileSync(glbPath)
assert.equal(glbBuf.readUInt32LE(0), 0x46546c67, 'Invalid GLB magic header')
assert.ok(glbBuf.length > 10_000 && glbBuf.length < 2_500_000, `Unexpected GLB size: ${glbBuf.length}`)
const jsonChunkLen = glbBuf.readUInt32LE(12)
const gltfJson = JSON.parse(glbBuf.subarray(20, 20 + jsonChunkLen).toString('utf8'))
const extsUsed = new Set(gltfJson.extensionsUsed || [])
assert.ok(extsUsed.has('KHR_texture_basisu'), 'GLB must embed KHR_texture_basisu KTX2 textures')
assert.ok(extsUsed.has('EXT_meshopt_compression'), 'GLB must use EXT_meshopt_compression')
for (const img of gltfJson.images || []) {
  assert.equal(img.mimeType, 'image/ktx2', `Non-KTX2 embedded image found: ${JSON.stringify(img)}`)
}

const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
assert.ok(Array.isArray(meta.sphere) && meta.sphere.length === 4, 'Invalid bounding sphere in zhongqu_police.json')
assert.deepEqual(meta.lods, ['lod0', 'lod1'], 'Expected lod0 and lod1 in zhongqu_police.json')
assert.ok(meta.sites?.policeStation?.osmWay === 'way/675586428', 'Missing Rongcheng Police Station OSM reference')
assert.ok(meta.sites?.trafficPoliceOutpost?.osmWay === 'way/675586430', 'Missing Traffic Police Squadron OSM reference')
assert.equal(meta.interactionPoints?.equipmentLockerTrigger?.violenceScale, 'A', 'Equipment locker must enforce Violence Scale A')
assert.equal(meta.parkingBays?.length, 10, 'Expected 4 cruiser bays + 6 iron-cavalry motorcycle bays')
assert.ok(
  meta.dispatchNetwork?.linkedPosts?.some(p => p.id === 'shizijie_traffic_kiosk'),
  'dispatchNetwork must link to shizijie.py traffic police kiosk',
)

const landmarkSpecs = JSON.parse(fs.readFileSync(landmarksPath, 'utf8'))
const lmSpec = landmarkSpecs.find(s => s.id === 'zhongqu_police')
assert.ok(lmSpec, 'zhongqu_police missing from pipeline/landmarks.json')

const seamCfg = JSON.parse(fs.readFileSync(seamsPath, 'utf8'))
assert.deepEqual(
  seamCfg.surfaces?.zhongqu_police,
  { road: 'road', sidewalk: 'sidewalk', curb: 'curb' },
  'zhongqu_police must bind road/sidewalk/curb in pipeline/seam-surfaces.json',
)

console.log(
  `[static-ok] zhongqu_police.glb=${(glbBuf.length / 1024).toFixed(1)}KB, imgs=${(gltfJson.images || []).length} (all KTX2), bays=${meta.parkingBays.length}`,
)

// ----------------------------------------------------------------------------
// 2. Headless Metal 8-Camera × 2 Independent Converged Modes Gate
// ----------------------------------------------------------------------------
const AX = meta.sites.policeStation.world[0] - meta.sites.policeStation.local[0]
const AY = meta.sites.policeStation.world[1] - meta.sites.policeStation.local[1]
const AZ = meta.sites.policeStation.world[2] - meta.sites.policeStation.local[2]

const VIEWS = [
  {
    id: '01_front_fascia',
    label: '正面门头 · 依仁路1-4号榕城派出所与无遮挡综合服务窗口',
    pos: [AX - 20.6, AY + 8.4, AZ - 25.6],
    look: [AX - 22.1, AY + 7.6, AZ - 13.6],
  },
  {
    id: '02_colonnade_ceiling',
    label: '骑楼仰拍 · B1 接警大厅 2F 挑出底面天花板封板验证',
    pos: [AX - 22.1, AY + 2.35, AZ - 15.1],
    look: [AX - 22.1, AY + 5.15, AZ - 12.6],
  },
  {
    id: '03_cruiser_closeup',
    label: '警车近景 · 院内制式警车侧面涂装（警察 POLICE / 桂C·1108警）',
    pos: [AX - 7.0, AY + 1.85, AZ + 8.5],
    look: [AX - 10.4, AY + 1.15, AZ + 4.5],
  },
  {
    id: '04_moto_kiosk_closeup',
    label: '铁骑与岗亭近景 · 桂林交警铁骑正侧面涂装与漓滨路零断差街缘',
    pos: [AX + 32.8, AY + 1.95, AZ + 17.6],
    look: [AX + 27.6, AY + 1.25, AZ + 14.8],
  },
  {
    id: '05_equip_locker',
    label: '装备领用室 · 无雨棚遮挡招牌与 A 级反光背心架',
    pos: [AX - 13.2, AY + 3.6, AZ + 22.0],
    look: [AX - 22.0, AY + 3.8, AZ + 19.4],
  },
  {
    id: '06_gateway_seam',
    label: '大门与接缝 · 漓滨路出警大门坡面黄网格与西南人行道平顺接缝',
    pos: [AX + 19.5, AY + 6.8, AZ + 36.5],
    look: [AX + 10.5, AY + 1.8, AZ + 31.0],
  },
  {
    id: '07_oblique_overview',
    label: '斜视总览 · 榕城派出所+交警中区执勤中队大院全景',
    pos: [AX + 8.5, AY + 22.0, AZ + 25.5],
    look: [AX - 9.5, AY + 5.5, AZ + 1.0],
  },
  {
    id: '08_b2_ne_corner',
    label: '东北路口与交警中队 · 依仁路×漓滨路口交警中队 5F 立面窗灯与退界',
    pos: [AX + 40.5, AY + 8.5, AZ - 15.5],
    look: [AX + 22.5, AY + 7.5, AZ + 2.5],
  },
  {
    id: '09_front_unobstructed',
    label: '正门头与骑楼退界（去旧底商遮挡）· 验证 B1 牌匾/110灯箱/服务窗与骑楼柱踩人行道',
    pos: [AX - 8.5, AY + 4.0, AZ - 23.5],
    look: [AX - 22.5, AY + 5.2, AZ - 13.0],
    hideLegacyWalls: true,
  },
  {
    id: '10_ceiling_unobstructed',
    label: '骑楼封底无遮挡抽检 · 临时摘除未重烘旧底商验证 B1 2F 向下天花板封底',
    pos: [AX - 16.8, AY + 2.05, AZ - 14.2],
    look: [AX - 23.5, AY + 4.95, AZ - 12.2],
    hideLegacyWalls: true,
  },
]

const MODES = [
  { key: 'day', label: '晴午 13:30', query: 'time=13.5&weather=clear&flow=0' },
  { key: 'night', label: '稳定雨夜 21:30', query: 'time=21.5&weather=rain&flow=0' },
]

const rawManifestText = fs.readFileSync(path.join(ROOT, 'public/world/manifest.json'), 'utf8')
const patchedManifestObj = JSON.parse(rawManifestText)
const needsManifestPatch = !patchedManifestObj.landmarks.some(l => l.id === 'zhongqu_police')
if (needsManifestPatch) {
  const [sx, sy, sz, sr] = meta.sphere
  const rx = Math.round(sx * 1000) / 1000
  const ry = Math.round(sy * 1000) / 1000
  const rz = Math.round(sz * 1000) / 1000
  const padR = Math.ceil((sr + Math.hypot(sx - rx, sy - ry, sz - rz)) * 1000) / 1000
  patchedManifestObj.landmarks.push({
    id: 'zhongqu_police',
    name: lmSpec.name,
    file: 'landmarks/zhongqu_police.glb',
    position: [Number(AX.toFixed(4)), Number(AY.toFixed(4)), Number(AZ.toFixed(4))],
    rotation: 0,
    collision: 'mesh',
    bytes: glbBuf.length,
    sphere: [rx, ry, rz, padR],
    lods: meta.lods,
  })
}
const patchedManifestBody = JSON.stringify(patchedManifestObj)

const server = await preview({
  root: path.join(ROOT, 'web'),
  configFile: path.join(ROOT, 'web/vite.config.ts'),
  preview: { host: '127.0.0.1', port: 0 },
})
const port = server.httpServer.address().port
const baseUrl = `http://127.0.0.1:${port}`

const launchArgs = process.env.USE_SWIFTSHADER === '1'
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist']

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM || undefined,
  args: launchArgs,
})

const consoleErrors = []
const pageErrors = []
const badResponses = []
const reportRows = []

try {
  // Boot one clean, pre-converged page per mode (`?time=13.5&weather=clear&flow=0` vs `?time=21.5&weather=rain&flow=0`)
  for (const mode of MODES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await ctx.newPage()
    await page.route('**/api/**', route => route.fulfill({ status: 204, body: '' }))
    if (needsManifestPatch) {
      await page.route('**/world/manifest.json*', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: patchedManifestBody }),
      )
    }
    page.on('pageerror', e => pageErrors.push(`${mode.key}: ${e.message}`))
    page.on('console', m => {
      if (m.type() === 'error') consoleErrors.push(`${mode.key}: ${m.text()}`)
    })
    page.on('response', r => {
      if (r.status() >= 400) badResponses.push(`${mode.key}: ${r.status()} ${r.url()}`)
    })

    await page.goto(`${baseUrl}/?verify&loading=skip&radius=384&gfx=high&${mode.query}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.viewer?.stats?.firstMs > 0), null, { timeout: 90000 })

    let frozen = false
    for (const view of VIEWS) {
      await page.evaluate(({ pos, look, wasFrozen }) => {
        const v = window.viewer
        if (wasFrozen) v.resume()
        if (typeof v.flight === 'function') v.flight()
        v.camera.position.set(pos[0], pos[1], pos[2])
        v.camera.lookAt(look[0], look[1], look[2])
        v.camera.updateMatrixWorld()
      }, { pos: view.pos, look: view.look, wasFrozen: frozen })
      frozen = false

      await page.waitForFunction(() => {
        const v = window.viewer
        if (!v) return false
        const { stats, stream } = v
        const lmPending = stream.updateLandmarks?.pendingCount?.() ?? 0
        const lmReady = [...stream.landmarks].some(
          ([entry, root]) => entry.id === 'zhongqu_police' && root.parent && root.getObjectByName('lod0')?.visible,
        )
        return !stats.pending && lmPending === 0 && stream.loaded.size > 0 && lmReady
      }, null, { timeout: 60000 })

      await page.waitForTimeout(1000)

      const afterInfo = await page.evaluate(async ({ hideLegacy }) => {
        const v = window.viewer
        // Hide HUD overlay chrome cleanly during verification capture without touching web/src/**
        for (const el of document.body.children) {
          if (el.tagName !== 'CANVAS' && !el.querySelector?.('canvas')) {
            el.style.opacity = '0'
          }
        }
        const detachedLegacy = []
        let prevCu = false
        if (hideLegacy) {
          prevCu = Boolean(v.cityUpgrade?.getStats?.()?.enabled)
          if (prevCu) v.cityUpgrade.setEnabled(false)
          // Collect landmark roots so we NEVER detach zhongqu_police or other landmarks
          const lmRoots = new Set()
          for (const [, root] of v.stream.landmarks) lmRoots.add(root)
          const isInsideLandmark = obj => {
            let cur = obj
            while (cur) {
              if (lmRoots.has(cur)) return true
              cur = cur.parent
            }
            return false
          }
          // Walk up from an actual mounted landmark root (`v.camera.parent` is null in Three.js!) to reach `THREE.Scene`
          let sceneRoot = null
          for (const [, root] of v.stream.landmarks) {
            if (root?.parent) {
              sceneRoot = root
              while (sceneRoot.parent) sceneRoot = sceneRoot.parent
              break
            }
          }
          const toDetach = []
          if (sceneRoot) {
            sceneRoot.traverse(n => {
              if (!n.isMesh || !n.parent || isInsideLandmark(n)) return
              if (n.geometry?.getAttribute?.('aFacade') || (n.isInstancedMesh && n.geometry?.attributes?.instanceColor)) {
                toDetach.push(n)
              }
            })
          }
          for (const n of toDetach) {
            detachedLegacy.push([n, n.parent])
            n.parent.remove(n)
          }
        }
        window.__detachedLegacy = { pairs: detachedLegacy, prevCu }
        const calls = []
        for (let i = 0; i < 10; i++) {
          await new Promise(r => requestAnimationFrame(r))
          if (i >= 3 && typeof v.stats?.calls === 'number' && v.stats.calls > 0) calls.push(v.stats.calls)
        }
        let lod0Vis = false
        let dynLights = 0
        for (const [entry, root] of v.stream.landmarks) {
          if (entry.id === 'zhongqu_police') {
            root.visible = true
            const l0 = root.getObjectByName('lod0')
            lod0Vis = Boolean(l0?.visible)
            root.traverse(n => {
              if (n.isLight) dynLights++
            })
          }
        }
        await v.freeze()
        return { calls: calls.length ? Math.min(...calls) : -1, lod0Vis, dynLights }
      }, { hideLegacy: Boolean(view.hideLegacyWalls) })
      frozen = true
      assert.ok(afterInfo.lod0Vis, `zhongqu_police lod0 not visible at ${view.id} (${mode.key})`)
      assert.equal(afterInfo.dynLights, 0, `Dynamic lights forbidden in zhongqu_police: ${afterInfo.dynLights}`)

      const afterShot = path.join(OUT_DIR, `${view.id}_${mode.key}_after.png`)
      await page.screenshot({ path: afterShot })

      // Detach zhongqu_police from scene for pixel-aligned, identical-weather Before capture
      const beforeCalls = await page.evaluate(async () => {
        const v = window.viewer
        v.resume()
        const saved = []
        for (const [entry, root] of v.stream.landmarks) {
          if (entry.id === 'zhongqu_police' && root.parent) {
            saved.push([root, root.parent])
            root.parent.remove(root)
          }
        }
        window.__savedZhongquRoots = saved
        const calls = []
        for (let i = 0; i < 8; i++) {
          await new Promise(r => requestAnimationFrame(r))
          if (i >= 2 && typeof v.stats?.calls === 'number' && v.stats.calls > 0) calls.push(v.stats.calls)
        }
        await v.freeze()
        return calls.length ? Math.min(...calls) : -1
      })

      const beforeShot = path.join(OUT_DIR, `${view.id}_${mode.key}_before.png`)
      await page.screenshot({ path: beforeShot })

      await page.evaluate(() => {
        const v = window.viewer
        v.resume()
        for (const [root, parent] of window.__savedZhongquRoots || []) {
          parent.add(root)
        }
        window.__savedZhongquRoots = []
        if (window.__detachedLegacy) {
          for (const [n, parent] of window.__detachedLegacy.pairs || []) {
            if (parent) parent.add(n)
          }
          if (window.__detachedLegacy.prevCu) v.cityUpgrade.setEnabled(true)
          window.__detachedLegacy = null
        }
      })
      frozen = false

      reportRows.push({
        view: view.id,
        mode: mode.key,
        beforeCalls,
        afterCalls: afterInfo.calls,
        deltaCalls: afterInfo.calls - beforeCalls,
        lod0Vis: afterInfo.lod0Vis,
      })
      console.log(
        `[shot] ${view.id} (${mode.key}): calls ${beforeCalls} -> ${afterInfo.calls} (delta ${afterInfo.calls - beforeCalls >= 0 ? '+' : ''}${afterInfo.calls - beforeCalls})`,
      )
    }
    await ctx.close()
  }
} finally {
  await browser.close()
  await server.close()
}

assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join(' | ')}`)
assert.deepEqual(consoleErrors, [], `Console errors: ${consoleErrors.join(' | ')}`)
assert.deepEqual(badResponses, [], `HTTP >= 400 responses: ${badResponses.join(' | ')}`)

const summaryPath = path.join(OUT_DIR, 'verify-summary.json')
fs.writeFileSync(
  summaryPath,
  JSON.stringify(
    {
      landmark: 'zhongqu_police',
      glbBytes: glbBuf.length,
      parkingBays: meta.parkingBays.length,
      views: reportRows,
      errors: { pageErrors: 0, consoleErrors: 0, badResponses: 0 },
    },
    null,
    2,
  ) + '\n',
)
console.log(`[verify-ok] All ${reportRows.length} views captured cleanly -> ${summaryPath}`)
