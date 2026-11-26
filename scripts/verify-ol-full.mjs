// 完全体合流实拍验收脚本（专属领地：scripts/verify-ol-full.mjs + captures/ol-full-accept/）
// 职责：
//   OL 侧 5 项：
//     01 定江新线隧道 (scripts/acceptance/railway/07-dingjiang-cameras.json / manifest.tunnels)
//     02 十字街新秩序 (SHIZIJIE plaza + traffic=1 lane compliance)
//     03 钓鱼碑 (stele-lijiang_jiefang-zone glowing leaderboard stele)
//     04 新烟盒 (一点虹/丹桂等 #388/#389 翻盖烟盒开盒态)
//     05 /404 错误页 (IDOK-420 404 自包含页面)
//   本组侧 5+ 项：
//     06 上岗对话 (real KeyF briefing + officer closeup + dual portraits ready)
//     07 交警和玩家同屏正面 (r10 creator-face/hair/body-outline, 66-bone figure_m, <=20k tris, open deck)
//     08 ¥70 罚单 (ebike_overload + no_helmet stacked fine terminal + printed slip)
//     09a / 09b 左右手递单 (active extended handover gesture window for BOTH left & right hands, anti-k59)
//     10 十字街地下 B1 (underground walkTrace into B1 atrium while footY <= floorY+1.5, zero panel, anti-k59)
//   隔壁组接入 2 项：
//     11 小香港地下商业城进入实拍 (xxg=1 + E1 真实步入独立 indoorScene)
//     12 十字街地下街新路线 A 进入实拍 (szj=1 + se 28级步梯真实下楼进入 B1)
//
// 生命周期与隔离约束：
//   - 优先连 http://127.0.0.1:9222，连不上自启 Chromium；browser.close() 严格放 finally 零残留
//   - 严禁启停或修改 4190 / 5176 服务本身

import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const ROOT = process.cwd()
const BASE_ORIGIN = process.env.OL_ORIGIN || 'http://127.0.0.1:5176'
const WALK_URL = `${BASE_ORIGIN}/?mode=walk`
const VERIFY_WALK_URL = `${BASE_ORIGIN}/?verify&mode=walk`
const CDP_ENDPOINT = process.env.CDP_URL || 'http://127.0.0.1:9222'
const OUT_DIR = resolve(ROOT, 'captures/ol-full-accept')
const REPORT_PATH = resolve(OUT_DIR, 'report.json')

const DINGJIANG_DEFAULT_VIEW = {
  name: '桂西桂北联络线隧道上方匝道',
  eye: [-770, 168, -8850],
  target: [-798.76, 157.3, -8876.41],
}

const SHIZIJIE_STELE_FALLBACK = {
  id: 'stele-lijiang_jiefang-zone',
  x: -183,
  y: 149.1,
  z: -166,
  yaw: 0.7854,
}

const XXG_FALLBACK = (() => {
  const anchor = {x: -845, z: 232}
  const axisE = {x: 0.938, z: 0.346}
  const axisS = {x: -0.346, z: 0.938}
  const axisYaw = Math.atan2(-axisE.x, -axisE.z)
  const along = -22, across = 26.5
  const world = {x: anchor.x + along * axisE.x + across * axisS.x, z: anchor.z + along * axisE.z + across * axisS.z}
  const c = Math.cos(axisYaw), s = Math.sin(axisYaw)
  const rot = (lx, lz) => ({x: lx * c + lz * s, z: -lx * s + lz * c})
  const inward = rot(0, -1)
  const off = rot(0, 5.8)
  return {
    id: 'E1',
    landing: {x: world.x + off.x, z: world.z + off.z},
    approachYaw: Math.atan2(-inward.x, -inward.z),
  }
})()

const SZJ_FALLBACK = (() => {
  const origin = {x: -879.7502021582604, z: -169.62604470000713}
  const local = {x: 22.5, z: 46.5}
  const yaw = (-158 * Math.PI) / 180
  const c = Math.cos(yaw), s = Math.sin(yaw)
  const rot = (lx, lz) => ({x: lx * c + lz * s, z: -lx * s + lz * c})
  const inward = rot(0, 1)
  const off = rot(0, -(4.5 + 1.5))
  return {
    id: 'se',
    landing: {x: origin.x + local.x + off.x, z: origin.z + local.z + off.z},
    approachYaw: Math.atan2(-inward.x, -inward.z),
    inward,
  }
})()

async function sampleCanvasIsBlack(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return true
    try {
      const probe = document.createElement('canvas')
      probe.width = 16
      probe.height = 9
      const ctx = probe.getContext('2d')
      if (!ctx) return false
      ctx.drawImage(canvas, 0, 0, 16, 9)
      const data = ctx.getImageData(0, 0, 16, 9).data
      let sum = 0
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2]
      return sum / (16 * 9 * 3) < 3
    } catch {
      return false
    }
  })
}

const BRIDGE_FALLBACK = {
  origin: [-167.99998711615615, 145.6, 39.99461580029688],
  rotationY: (-18.45 * Math.PI) / 180,
  crossSection: {minX: -140.5, maxX: 140.5, minZ: -21.5, maxZ: 21.5},
}

async function loadSpecs() {
  const tmpDir = await mkdtemp(join(tmpdir(), 'ol-full-spec-'))
  try {
    let bridge = BRIDGE_FALLBACK
    let xxgPortal = XXG_FALLBACK
    let szjStair = SZJ_FALLBACK
    let esbuildBuild = null
    try {
      const esbMod = await import('esbuild')
      esbuildBuild = esbMod.build
    } catch {}

    if (esbuildBuild) {
      try {
        const bridgeFile = join(tmpDir, 'bridge.mjs')
        await esbuildBuild({
          stdin: {
            contents: `export {JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y, JIEFANG_CROSS_SECTION} from './web/src/traffic-duty/jiefang-railings.ts'`,
            resolveDir: ROOT,
            loader: 'ts',
          },
          outfile: bridgeFile,
          bundle: true,
          format: 'esm',
          platform: 'neutral',
          logLevel: 'silent',
        })
        const mod = await import(pathToFileURL(bridgeFile).href)
        bridge = {
          origin: [...mod.JIEFANG_BRIDGE_ORIGIN],
          rotationY: mod.JIEFANG_BRIDGE_ROTATION_Y,
          crossSection: mod.JIEFANG_CROSS_SECTION,
        }
      } catch {}

      const xxgPath = resolve(ROOT, 'web/src/xiaoxianggang/contract.ts')
      if (existsSync(xxgPath)) {
        try {
          const xxgOut = join(tmpDir, 'xxg.mjs')
          await esbuildBuild({
            stdin: {
              contents: `export {XXG_PORTALS, XXG_PORTAL_TRIGGER, rotateLocal, yawFacing} from './web/src/xiaoxianggang/contract.ts'`,
              resolveDir: ROOT,
              loader: 'ts',
            },
            outfile: xxgOut,
            bundle: true,
            format: 'esm',
            platform: 'neutral',
            logLevel: 'silent',
          })
          const xm = await import(pathToFileURL(xxgOut).href)
          const p = xm.XXG_PORTALS.find(it => it.id === 'E1') ?? xm.XXG_PORTALS[0]
          if (p) {
            const off = xm.rotateLocal({x: 0, z: xm.XXG_PORTAL_TRIGGER.landingZ}, p.yaw)
            xxgPortal = {
              id: p.id,
              landing: {x: p.world.x + off.x, z: p.world.z + off.z},
              approachYaw: xm.yawFacing(p.inward),
            }
          }
        } catch {}
      }

      const szjPath = resolve(ROOT, 'web/src/shizijie/contract.ts')
      if (existsSync(szjPath)) {
        try {
          const szjOut = join(tmpDir, 'szj.mjs')
          await esbuildBuild({
            stdin: {
              contents: `export {SZJ_STAIRWELLS, SZJ_TRIGGER, rotateLocal, yawFacing} from './web/src/shizijie/contract.ts'`,
              resolveDir: ROOT,
              loader: 'ts',
            },
            outfile: szjOut,
            bundle: true,
            format: 'esm',
            platform: 'neutral',
            logLevel: 'silent',
          })
          const sm = await import(pathToFileURL(szjOut).href)
          const st = sm.SZJ_STAIRWELLS.find(it => it.id === 'se') ?? sm.SZJ_STAIRWELLS[0]
          if (st) {
            const off = sm.rotateLocal({x: 0, z: -(st.length / 2 + sm.SZJ_TRIGGER.landingOut)}, st.yaw)
            szjStair = {
              id: st.id,
              landing: {x: st.world.x + off.x, z: st.world.z + off.z},
              approachYaw: sm.yawFacing(st.inward),
              inward: st.inward,
            }
          }
        } catch {}
      }
    }
    let dingjiangCams = [DINGJIANG_DEFAULT_VIEW]
    const camPath = resolve(ROOT, 'scripts/acceptance/railway/07-dingjiang-cameras.json')
    if (existsSync(camPath)) {
      const parsed = JSON.parse(await readFile(camPath, 'utf8'))
      if (Array.isArray(parsed) && parsed.length > 0) dingjiangCams = parsed
    }
    let shizijieUnderground = null
    const szMetaPath = resolve(ROOT, 'public/landmarks/shizijie.json')
    if (existsSync(szMetaPath)) {
      const meta = JSON.parse(await readFile(szMetaPath, 'utf8'))
      shizijieUnderground = meta?.underground ?? null
    }
    return {
      bridge,
      dingjiangCams,
      shizijieUnderground,
      xxgPortal,
      szjStair,
    }
  } finally {
    await rm(tmpDir, {recursive: true, force: true}).catch(() => {})
  }
}

async function verifyServerOnline() {
  const res = await fetch(WALK_URL)
  assert.equal(res.status, 200, `expected ${WALK_URL} HTTP 200, got ${res.status}`)
  const html = await res.text()
  const chunks = [...new Set([...html.matchAll(/(?:assets\/|\.\/|\/src\/)([a-zA-Z0-9_.-]+\.(?:js|ts))/g)].map(m => m[1]))]
  assert.ok(chunks.length > 0, `no entry chunks in ${WALK_URL}`)
  return {status: res.status, initialChunks: chunks}
}

async function acquireBrowser() {
  try {
    const browser = await chromium.connectOverCDP(CDP_ENDPOINT, {timeout: 1500})
    return {browser, ownsBrowser: false, mode: `cdp(${CDP_ENDPOINT})`}
  } catch {
    const browser = await chromium.launch(browserOptions())
    return {browser, ownsBrowser: true, mode: 'launch(chromium)'}
  }
}

async function dismissBlockingUi(page) {
  await page.evaluate(() => {
    document.querySelector('.coach.in .coach-skip')?.click?.()
    document.querySelector('.spot-card.show .card-close')?.click?.()
  })
  await page.waitForTimeout(160)
}

async function installFullHelpers(page, bridgeSpec) {
  await page.evaluate(s => {
    const [OX, OY, OZ] = s.origin
    const C = Math.cos(s.rotationY)
    const S = Math.sin(s.rotationY)
    const cs = s.crossSection

    window.__olToLocal = (wx, wz) => {
      const dx = wx - OX
      const dz = wz - OZ
      return [dx * C - dz * S, dx * S + dz * C]
    }
    window.__olToWorld = (lx, lz) => [OX + lx * C + lz * S, OZ - lx * S + lz * C]
    window.__olOnDeck = a => {
      if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.z)) return false
      const [lx, lz] = window.__olToLocal(a.x, a.z)
      return lx >= cs.minX && lx <= cs.maxX && lz >= cs.minZ && lz <= cs.maxZ && a.y >= OY - 2 && a.y <= OY + 12
    }
    window.__olPlaceFacingTarget = (target, alongDistM, fallbackY, lateralOffsetM = 0, sideSign = 1) => {
      if (!target) return null
      const [lx, lz] = window.__olToLocal(target.x, target.z)
      const dirX = lx > 0 ? -1 : 1
      const latSign = (lz >= 0 ? 1 : -1) * (sideSign >= 0 ? 1 : -1)
      const pxLx = Math.max(-138.5, Math.min(138.5, lx + dirX * alongDistM))
      const rawLz = lz + latSign * lateralOffsetM
      const pxLz = lz >= 0 ? Math.min(15.85, Math.max(12.45, rawLz)) : Math.max(-15.85, Math.min(-12.45, rawLz))
      const [px, pz] = window.__olToWorld(pxLx, pxLz)
      const py = Number.isFinite(fallbackY) ? fallbackY : target.y
      window.viewer.walk.clampPosition({x: px, y: py, z: pz})
      for (let k = 0; k < 6; k++) window.viewer.walk.tick(1 / 60)
      const landed = window.viewer.walk.position
      window.viewer.walk.face(Math.atan2(-(target.x - landed.x), -(target.z - landed.z)), 0.06)
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      return +Math.hypot(target.x - landed.x, target.z - landed.z).toFixed(3)
    }
    window.__olPlaceAheadOfTarget = (target, alongFwdM, lateralM, sideSign = 1) => {
      if (!target) return null
      const yaw = Number.isFinite(target.yaw) ? target.yaw : 0
      const fx = Math.sin(yaw), fz = Math.cos(yaw)
      const leftX = Math.cos(yaw), leftZ = -Math.sin(yaw)
      const wx = target.x + fx * alongFwdM + leftX * lateralM * sideSign
      const wz = target.z + fz * alongFwdM + leftZ * lateralM * sideSign
      const [rawLx, rawLz] = window.__olToLocal(wx, wz)
      const pxLx = Math.max(-138.5, Math.min(138.5, rawLx))
      const pxLz = rawLz >= 0 ? Math.min(15.85, Math.max(12.25, rawLz)) : Math.max(-15.85, Math.min(-12.25, rawLz))
      const [px, pz] = window.__olToWorld(pxLx, pxLz)
      window.viewer.walk.clampPosition({x: px, y: target.y, z: pz})
      for (let k = 0; k < 6; k++) window.viewer.walk.tick(1 / 60)
      const landed = window.viewer.walk.position
      window.viewer.walk.face(Math.atan2(-(target.x - landed.x), -(target.z - landed.z)), 0.06)
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      return +Math.hypot(target.x - landed.x, target.z - landed.z).toFixed(3)
    }

    const cam = window.viewer.camera
    if (cam && !cam.__olFullPatched) {
      const origUpdate = cam.updateMatrixWorld.bind(cam)
      cam.updateMatrixWorld = force => {
        const officerHold = window.__olOfficerHold
        if (officerHold) {
          try {
            const off = window.viewer?.dutyOfficers?.officers?.jiefang?.officerRoot
            if (off) off.position.set(officerHold.x, officerHold.y, officerHold.z)
          } catch {}
        }
        const hold = window.__olCamHold
        if (hold) {
          try {
            const pose = typeof hold === 'function' ? hold() : hold
            if (pose?.eye && pose?.at) {
              cam.position.set(pose.eye[0], pose.eye[1], pose.eye[2])
              cam.up.set(0, 1, 0)
              cam.lookAt(pose.at[0], pose.at[1], pose.at[2])
            }
          } catch {}
        }
        return origUpdate(force)
      }
      cam.__olFullPatched = true
    }

    window.__olFlushFrames = async (count = 4) => {
      await new Promise(resolve => {
        let left = Math.max(1, count)
        const step = () => {
          left -= 1
          if (left <= 0) resolve(true)
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })
    }
  }, bridgeSpec)
}

async function captureShot(page, name) {
  const fullPath = resolve(OUT_DIR, name)
  await page.screenshot({path: fullPath, fullPage: false, animations: 'disabled', timeout: 60000})
  const info = await stat(fullPath)
  assert.ok(info.size > 4096, `screenshot ${name} too small (${info.size} bytes)`)
  return {file: name, rel: `captures/ol-full-accept/${name}`, bytes: info.size}
}

function buildFlyViewToken(eye, target, fov = 56) {
  const [x, y, z] = eye
  const [tx, ty, tz] = target
  const yaw = (Math.atan2(x - tx, z - tz) * 180) / Math.PI
  const pitch = (Math.atan2(ty - y, Math.hypot(tx - x, tz - z)) * 180) / Math.PI
  const metresLon = 111320 * Math.cos((25.28 * Math.PI) / 180)
  return Buffer.from(
    JSON.stringify({
      mode: 'fly',
      x,
      y,
      z,
      lon: 110.3 + x / metresLon,
      lat: 25.28 - z / 110574,
      yaw,
      pitch,
      fov,
      alt: y,
      heading: 0,
      target: null,
      landmark_id: null,
      build: '0'.repeat(40),
    }),
  ).toString('base64url')
}

async function waitStreamSettled(page, eye, timeout = 25000) {
  await page.waitForFunction(
    ([cx, cy, cz]) => {
      const v = window.viewer
      if (!v?.stats || !v?.stream || !v?.manifest) return false
      if (v.stats.loaded < 4 || v.stats.pending > 0) return false
      if (Math.hypot(v.camera.position.x - cx, v.camera.position.y - cy, v.camera.position.z - cz) > 4.0) return false
      const settleR = Math.min(v.stream.radius ?? 256, 220)
      return (v.manifest.chunks ?? []).every(
        t => Math.hypot(t.x + 128 - cx, t.z + 128 - cz) > settleR || v.stream.loaded.has?.(t),
      )
    },
    eye,
    {timeout},
  )
}

async function run() {
  await mkdir(OUT_DIR, {recursive: true})
  const serverInfo = await verifyServerOnline()
  const specs = await loadSpecs()
  console.log(`[PREFLIGHT] ${WALK_URL} HTTP=${serverInfo.status} chunks=${serverInfo.initialChunks.length}`)

  const {browser, ownsBrowser, mode} = await acquireBrowser()
  console.log(`[BROWSER] mode=${mode} ownsBrowser=${ownsBrowser}`)

  const ERRS = []
  const steps = []
  const shots = {}
  const attachErrorListeners = pg => {
    pg.on('pageerror', err => ERRS.push(`[pageerror] ${err.message}`))
    pg.on('console', msg => {
      if (msg.type() === 'error') ERRS.push(`[console.error] ${msg.text()}`)
    })
    pg.on('response', res => {
      const url = res.url()
      if (res.status() >= 400 && !url.includes('/favicon.ico') && !url.includes('/ol-full-nonexistent-404')) {
        ERRS.push(`[http_${res.status()}] ${url}`)
      }
    })
  }

  const addStep = (id, name, status, detail, shot = null) => {
    steps.push({id, name, status, detail, shot})
    console.log(`[${status}] ${id} ${name}${shot ? ` (${shot.rel})` : ''}`)
  }

  let context = null
  try {
    context = await browser.newContext({viewport: {width: 1280, height: 800}})

    // -----------------------------------------------------------------------
    // 1. OL-01: 定江新线隧道 (fly mode view on Dingjiang tunnel portal / ramp)
    // -----------------------------------------------------------------------
    {
      const pg = await context.newPage()
      attachErrorListeners(pg)
      try {
        const cam =
          specs.dingjiangCams.find(c => /隧道/.test(c.name || '')) ??
          specs.dingjiangCams[0] ??
          DINGJIANG_DEFAULT_VIEW
        const token = buildFlyViewToken(cam.eye, cam.target, 58)
        await pg.goto(`${BASE_ORIGIN}/?verify&radius=512&time=12&flow=0&view=${token}`, {
          waitUntil: 'domcontentloaded',
          timeout: 90000,
        })
        await pg.waitForFunction(() => Boolean(window.viewer?.camera && window.viewer?.stream && window.viewer?.manifest), null, {
          timeout: 120000,
        })
        await waitStreamSettled(pg, cam.eye, 25000).catch(() => {})
        await pg.evaluate(c => {
          const cam = window.viewer.camera
          cam.position.set(c.eye[0], c.eye[1], c.eye[2])
          cam.lookAt(c.target[0], c.target[1], c.target[2])
          cam.updateMatrixWorld(true)
          window.viewer.stream.tick?.(cam.position)
        }, cam)
        await pg.waitForTimeout(500)
        // If nearby building wall blocks forward view (<12m), step back & slightly higher along view axis
        await pg.evaluate(c => {
          const w = window.viewer.walk
          if (!w?.raycastObstacle) return
          const dx = c.target[0] - c.eye[0]
          const dy = c.target[1] - c.eye[1]
          const dz = c.target[2] - c.eye[2]
          const len = Math.hypot(dx, dy, dz) || 1
          const hit = w.raycastObstacle(c.eye[0], c.eye[1], c.eye[2], dx / len, dy / len, dz / len, 14)
          if (hit && hit.distance < 12) {
            const cam = window.viewer.camera
            cam.position.set(c.eye[0] - (dx / len) * 14, c.eye[1] + 6, c.eye[2] - (dz / len) * 14)
            cam.lookAt(c.target[0], c.target[1], c.target[2])
            cam.updateMatrixWorld(true)
          }
        }, cam)
        const probe = await pg.evaluate(() => {
          const tunnels = window.viewer?.manifest?.tunnels ?? []
          const dingjiangTunnels = tunnels.filter(t => Math.min(...(t.portals ?? []).map(p => p[2])) < -7000)
          return {
            totalTunnels: tunnels.length,
            dingjiangTunnelCount: dingjiangTunnels.length,
            chunksLoaded: window.viewer?.stats?.loaded ?? 0,
            camPos: window.viewer?.camera?.position?.toArray?.().map(v => +v.toFixed(2)) ?? null,
          }
        })
        shots.olDingjiangTunnel = await captureShot(pg, '01-ol-dingjiang-tunnel.png')
        addStep(
          'OL1_DINGJIANG_TUNNEL',
          'OL 侧定江新线隧道与站场实拍',
          probe.dingjiangTunnelCount > 0 && probe.chunksLoaded > 0 ? 'PASS' : 'FAIL',
          {cameraName: cam.name, ...probe},
          shots.olDingjiangTunnel,
        )
      } catch (err) {
        addStep('OL1_DINGJIANG_TUNNEL', 'OL 侧定江新线隧道与站场实拍', 'FAIL', {error: err.message})
      } finally {
        await pg.close().catch(() => {})
      }
    }

    // -----------------------------------------------------------------------
    // 2. OL-02: 十字街新秩序 (traffic=1, clean plaza center & outer lanes)
    // -----------------------------------------------------------------------
    {
      const pg = await context.newPage()
      attachErrorListeners(pg)
      try {
        const ugOrigin = specs.shizijieUnderground?.originWorld ?? [-879.750202, 151.3, -169.626045]
        const ox = ugOrigin[0]
        const oz = ugOrigin[2]
        // Full 4-leg intersection + central island + B1 entrances cleanly framed above rooftops/legend
        const eye = [ox + 36, 151.3 + 48, oz - 40]
        const target = [ox, 151.3 + 0.5, oz]
        const token = buildFlyViewToken(eye, target, 56)
        await pg.goto(`${BASE_ORIGIN}/?verify&traffic=1&flow=0&time=10.5&radius=420&view=${token}`, {
          waitUntil: 'domcontentloaded',
          timeout: 90000,
        })
        await pg.waitForFunction(() => Boolean(window.viewer?.camera && window.viewer?.stream), null, {timeout: 120000})
        await waitStreamSettled(pg, eye, 25000).catch(() => {})
        await dismissBlockingUi(pg)
        await pg.evaluate(() => {
          const guide = document.querySelector('.guide.open .guide-toggle, [data-guide-toggle]')
          if (guide instanceof HTMLElement) guide.click()
        })
        await pg
          .waitForFunction(
            () => {
              try {
                for (let k = 0; k < 6; k++) window.viewer?.stepStreetTraffic?.()
              } catch {}
              return (window.viewer?.trafficCount ?? 0) >= 12
            },
            null,
            {timeout: 25000},
          )
          .catch(() => {})
        await pg.waitForTimeout(400)
        const probe = await pg.evaluate(() => ({
          chunksLoaded: window.viewer?.stats?.loaded ?? 0,
          trafficCount: window.viewer?.trafficCount ?? 0,
        }))
        shots.olShizijieOrder = await captureShot(pg, '02-ol-shizijie-order.png')
        addStep(
          'OL2_SHIZIJIE_ORDER',
          'OL 侧十字街新秩序实拍',
          probe.chunksLoaded > 0 && probe.trafficCount > 0 ? 'PASS' : 'FAIL',
          probe,
          shots.olShizijieOrder,
        )
      } catch (err) {
        addStep('OL2_SHIZIJIE_ORDER', 'OL 侧十字街新秩序实拍', 'FAIL', {error: err.message})
      } finally {
        await pg.close().catch(() => {})
      }
    }

    // -----------------------------------------------------------------------
    // 3. OL-03: 钓鱼碑 (stele-lijiang_jiefang-zone & global close-up)
    // -----------------------------------------------------------------------
    {
      const pg = await context.newPage()
      attachErrorListeners(pg)
      try {
        const st = SHIZIJIE_STELE_FALLBACK
        const nx = Math.sin(st.yaw)
        const nz = Math.cos(st.yaw)
        const rx = Math.cos(st.yaw)
        const rz = -Math.sin(st.yaw)
        const eye = [st.x + nx * 3.8 - rx * 1.4, st.y + 1.65, st.z + nz * 3.8 - rz * 1.4]
        const target = [st.x, st.y + 1.45, st.z]
        const token = buildFlyViewToken(eye, target, 48)
        await pg.goto(`${BASE_ORIGIN}/?verify&flow=0&time=11.5&radius=280&view=${token}`, {
          waitUntil: 'domcontentloaded',
          timeout: 90000,
        })
        await pg.waitForFunction(() => Boolean(window.viewer?.camera && window.viewer?.stream), null, {timeout: 120000})
        await waitStreamSettled(pg, eye, 25000).catch(() => {})
        const steleProbe = await pg.evaluate(() => {
          const cam = window.viewer.camera
          let sc = cam
          while (sc.parent) sc = sc.parent
          const found = []
          sc.traverse(o => {
            if (o.name?.startsWith('stele-')) {
              const p = o.position
              found.push({name: o.name, pos: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], yaw: +o.rotation.y.toFixed(4)})
            }
          })
          return {steleCount: found.length, steles: found.slice(0, 6)}
        })
        if (steleProbe.steleCount > 0) {
          await pg.evaluate(s => {
            const cam = window.viewer.camera
            const targetStele = s.steles.find(x => x.name.includes('jiefang')) ?? s.steles[0]
            if (!targetStele) return
            const [sx, sy, sz] = targetStele.pos
            let bestEye = [sx + Math.sin(targetStele.yaw) * 3.0, sy + 1.55, sz + Math.cos(targetStele.yaw) * 3.0]
            const w = window.viewer.walk
            for (const angOff of [0, 0.28, -0.28, 0.52, -0.52]) {
              const a = targetStele.yaw + angOff
              const ex = sx + Math.sin(a) * 3.0
              const ez = sz + Math.cos(a) * 3.0
              if (!w?.raycastObstacle) {
                bestEye = [ex, sy + 1.55, ez]
                break
              }
              const hit = w.raycastObstacle(ex, sy + 1.55, ez, (sx - ex) / 3.0, 0, (sz - ez) / 3.0, 2.5)
              if (!hit || hit.distance >= 2.2) {
                bestEye = [ex, sy + 1.55, ez]
                break
              }
            }
            cam.position.set(bestEye[0], bestEye[1], bestEye[2])
            cam.lookAt(sx, sy + 1.45, sz)
            cam.updateMatrixWorld(true)
          }, steleProbe)
          await pg.waitForTimeout(450)
        }
        shots.olFishingStele = await captureShot(pg, '03-ol-fishing-stele.png')
        addStep(
          'OL3_FISHING_STELE',
          'OL 侧钓鱼碑近景实拍',
          steleProbe.steleCount > 0 ? 'PASS' : 'FAIL',
          steleProbe,
          shots.olFishingStele,
        )
      } catch (err) {
        addStep('OL3_FISHING_STELE', 'OL 侧钓鱼碑近景实拍', 'FAIL', {error: err.message})
      } finally {
        await pg.close().catch(() => {})
      }
    }

    // -----------------------------------------------------------------------
    // 4. OL-05: /404 错误页 (check missing route + /errors/404.html self-contained page)
    // -----------------------------------------------------------------------
    {
      const pg = await context.newPage()
      pg.on('pageerror', err => ERRS.push(`[pageerror@404] ${err.message}`))
      try {
        const resMissing = await pg.goto(`${BASE_ORIGIN}/ol-full-nonexistent-404`, {waitUntil: 'domcontentloaded', timeout: 20000})
        const missingInfo = await pg.evaluate(() => ({
          title: document.title,
          has404Code: document.querySelector('.code')?.textContent?.trim() === '404',
          heading: document.querySelector('h1')?.textContent?.trim() ?? null,
          bodyLen: document.body?.textContent?.trim()?.length ?? 0,
        }))
        let usedUrl = `${BASE_ORIGIN}/ol-full-nonexistent-404`
        let routeStatus = resMissing?.status() ?? null
        let pageInfo = missingInfo
        let htmlFallbackStatus = null
        if (!missingInfo.has404Code) {
          const resStatic = await pg.goto(`${BASE_ORIGIN}/errors/404.html`, {waitUntil: 'domcontentloaded', timeout: 20000}).catch(() => null)
          htmlFallbackStatus = resStatic?.status() ?? null
          if (htmlFallbackStatus === 200) {
            usedUrl = `${BASE_ORIGIN}/errors/404.html`
            pageInfo = await pg.evaluate(() => ({
              title: document.title,
              has404Code: document.querySelector('.code')?.textContent?.trim() === '404',
              heading: document.querySelector('h1')?.textContent?.trim() ?? null,
              homeHref: document.querySelector('a.btn')?.getAttribute('href') ?? null,
              bodyLen: document.body?.textContent?.trim()?.length ?? 0,
            }))
          }
        }
        shots.ol404Page = await captureShot(pg, '05-ol-404-page.png')
        addStep(
          'OL5_404_PAGE',
          'OL 侧 /404 自包含错误页实拍',
          pageInfo.has404Code ? 'PASS' : 'FAIL',
          {usedUrl, missingRouteStatus: routeStatus, errors404HtmlStatus: htmlFallbackStatus, ...pageInfo},
          shots.ol404Page,
        )
      } catch (err) {
        addStep('OL5_404_PAGE', 'OL 侧 /404 自包含错误页实拍', 'FAIL', {error: err.message})
      } finally {
        await pg.close().catch(() => {})
      }
    }

    // -----------------------------------------------------------------------
    // 5. OL-04 + TEAM-06..10 on shared ?verify&mode=walk session (faster & coherent)
    // -----------------------------------------------------------------------
    const page = await context.newPage()
    attachErrorListeners(page)
    try {
      await page.goto(`${VERIFY_WALK_URL}&flow=0`, {waitUntil: 'domcontentloaded', timeout: 90000})
      await page.waitForFunction(
        () =>
          Boolean(
            window.viewer?.walk?.active &&
              window.viewer?.trafficDuty &&
              window.viewer?.dutyTraffic &&
              window.viewer?.dutyOfficers?.officers?.jiefang,
          ),
        null,
        {timeout: 180000},
      )
      await dismissBlockingUi(page)
      await installFullHelpers(page, specs.bridge)

      // ---------------------------------------------------------------------
      // OL-04: 新烟盒 (一点虹 / #388/#389 flip-top pack open state)
      // ---------------------------------------------------------------------
      try {
        const smokeSlot = page.locator('.hotbar [data-slot=smoke]')
        await smokeSlot.waitFor({timeout: 10000})
        await page.waitForFunction(
          () => {
            const slot = document.querySelector('.hotbar [data-slot=smoke]')
            if (!slot || document.body.hasAttribute('data-home')) return false
            const r = slot.getBoundingClientRect()
            return slot.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
          },
          null,
          {timeout: 15000},
        )
        await smokeSlot.click()
        const shop = page.locator('.shop-overlay.show')
        await shop.waitFor({timeout: 8000})
        const newBrands = ['一点虹', '丹桂', '红玫', '二伍甲', '老八块', '乐涂']
        let boughtBrand = null
        for (const label of newBrands) {
          const card = shop.locator('.shop-card').filter({hasText: label}).first()
          if ((await card.count()) > 0) {
            await card.click()
            await shop.locator('.shop-act-primary').click()
            boughtBrand = label
            break
          }
        }
        await shop.locator('.shop-act-close').click()
        await shop.waitFor({state: 'hidden', timeout: 5000})
        await smokeSlot.click()
        await page.waitForFunction(() => window.viewer?.walk?.probe?.()?.smoke?.phase === 'sealed', null, {timeout: 15000})
        await page.keyboard.press('KeyF')
        await page.waitForFunction(
          () => {
            const sm = window.viewer?.walk?.probe?.()?.smoke
            return sm?.phase === 'open' && (sm?.progress ?? 0) >= 0.2
          },
          null,
          {timeout: 15000},
        )
        const smokeMeta = await page.evaluate(() => {
          const cam = window.viewer.camera
          const pack = cam?.parent?.getObjectByName?.('smoke-pack')
          return {
            smoke: window.viewer.walk.probe().smoke,
            packMountedIn: pack?.parent?.name ?? null,
          }
        })
        await page.evaluate(() => window.__olFlushFrames(4))
        shots.olNewSmokePack = await captureShot(page, '04-ol-new-smoke-pack.png')
        addStep(
          'OL4_NEW_SMOKE_PACK',
          'OL 侧新烟盒开盒态实拍',
          Boolean(boughtBrand && smokeMeta.smoke?.phase === 'open') ? 'PASS' : 'FAIL',
          {boughtBrand, ...smokeMeta},
          shots.olNewSmokePack,
        )
        // Stow cigarette before moving on to traffic duty
        await page.keyboard.press('1')
        await page.waitForTimeout(250)
      } catch (err) {
        addStep('OL4_NEW_SMOKE_PACK', 'OL 侧新烟盒开盒态实拍', 'FAIL', {error: err.message})
        await page.evaluate(() => document.querySelector('.shop-overlay .shop-act-close')?.click?.()).catch(() => {})
        await page.keyboard.press('1').catch(() => {})
      }

      // ---------------------------------------------------------------------
      // TEAM: Go to Jiefang Bridge & capture TEAM-07 officer+player front + probes FIRST,
      // then TEAM-06 briefing dialogue, TEAM-08 ¥70 fine, TEAM-09a/b left/right handover, TEAM-10 B1!
      // ---------------------------------------------------------------------
      await dismissBlockingUi(page)
      await page.locator('.td-entry').click({timeout: 15000})
      const goBridge = page.locator('dialog.td-panel[open] [data-td-action="go-bridge"]')
      await goBridge.waitFor({state: 'visible', timeout: 15000})
      await page.waitForTimeout(250)
      await goBridge.click({timeout: 20000})
      await page.waitForFunction(
        () => {
          const s = window.viewer?.trafficDuty?.getSnapshot?.()
          return Boolean(s && s.officerDistanceM !== null && s.officerDistanceM <= 6) && !document.querySelector('dialog.td-panel[open]')
        },
        null,
        {timeout: 25000},
      )
      await page.waitForFunction(
        () => Boolean(window.viewer?.dutyOfficers?.officers?.jiefang?.officerRoot?.getObjectByName('rigged-traffic-officer')),
        null,
        {timeout: 25000},
      )
      await page.evaluate(() => window.__olFlushFrames(4))

      // TEAM-07: 交警和玩家同屏正面 + creator 节点 / figure_m 骨架 / <=20k 三角面探针
      {
        const layout = await page.evaluate(() => {
          const officer = window.viewer.dutyOfficers.officers.jiefang
          const root = officer.officerRoot
          const orig = {ox: root.position.x, oy: root.position.y, oz: root.position.z}
          const rigged = root.getObjectByName('rigged-traffic-officer')
          const playerFig = window.viewer.walk.figure

          const hasNode = (tree, name) => Boolean(tree?.getObjectByName?.(name))
          const getBones = tree => {
            let bones = []
            tree?.traverse?.(n => {
              if (n.isSkinnedMesh && bones.length === 0) bones = (n.skeleton?.bones ?? []).map(b => b.name)
            })
            return bones
          }
          const countTris = tree => {
            let tris = 0
            tree?.traverse?.(n => {
              if (!n.isMesh || !n.visible) return
              const g = n.geometry
              const idx = g?.getIndex?.()
              if (idx) tris += Math.floor(idx.count / 3)
              else tris += Math.floor((g?.getAttribute?.('position')?.count ?? 0) / 3)
            })
            return tris
          }
          const ob = getBones(rigged)
          const pb = getBones(playerFig)
          const probe = {
            hasRigged: Boolean(rigged),
            hasCreatorFace: hasNode(rigged, 'creator-face'),
            hasCreatorHair: hasNode(rigged, 'creator-hair'),
            hasCreatorBodyOutline: hasNode(rigged, 'creator-body-outline'),
            boneCount: ob.length,
            sameSkeleton: ob.length > 0 && ob.length === pb.length && ob.every((b, idx) => b === pb[idx]),
            triangleCount: countTris(rigged),
          }

          // Center well east of bridgehead sign (-96.2) & clear of bridgehead guardrail, between lampposts (-105 and -84)
          const baseLx = -89.0
          const offLz = 17.95
          const plyLz = 18.88
          const [ox, oz] = window.__olToWorld(baseLx, offLz)
          const [px, pz] = window.__olToWorld(baseLx, plyLz)
          const w = window.viewer.walk
          w.clampPosition({x: px, y: orig.oy + 0.65, z: pz})
          for (let i = 0; i < 65; i++) w.tick(1 / 60)
          const footY = Number.isFinite(w.figure?.position?.y) ? w.figure.position.y : w.position.y - 0.88

          window.__olOfficerHold = {x: ox, y: footY, z: oz}
          root.position.set(ox, footY, oz)
          const [lookWx, lookWz] = window.__olToWorld(baseLx - 6.0, 17.8)
          officer.setDutyState('talking')
          officer.setExpression('serious')
          officer.setLookTarget({x: lookWx, y: footY, z: lookWz})
          for (let i = 0; i < 40; i++) window.viewer.dutyOfficers.update(0.1)
          root.position.set(ox, footY, oz)
          root.updateMatrixWorld(true)

          const yaw = root.rotation.y
          w.clampPosition({x: px, y: footY, z: pz})
          w.face(yaw, 0.06)
          w.drive(-Math.sin(yaw), -Math.cos(yaw), false)
          for (let i = 0; i < 18; i++) w.tick(1 / 60)
          w.hold(true)
          w.hold(false)
          w.clampPosition({x: px, y: footY, z: pz})
          for (let i = 0; i < 20; i++) w.tick(1 / 60)
          w.face(yaw, 0.06)

          const [camWx, camWz] = window.__olToWorld(baseLx - 2.9, 18.35)
          window.__olCamHold = {
            eye: [camWx, footY + 0.98, camWz],
            at: [(ox + px) * 0.5, footY + 0.68, (oz + pz) * 0.5],
          }
          return {orig, probe, footY}
        })
        await page.evaluate(() => window.__olFlushFrames(4))
        shots.teamOfficerFront = await captureShot(page, '07-team-officer-player-front.png')
        const p = layout.probe
        const officerOk =
          p.hasRigged &&
          p.hasCreatorFace &&
          p.hasCreatorHair &&
          p.hasCreatorBodyOutline &&
          p.sameSkeleton &&
          p.triangleCount > 0 &&
          p.triangleCount <= 20000
        addStep('TEAM7_OFFICER_FRONT', '本组交警与玩家同屏正面与 creator/骨架/<=20k 验收', officerOk ? 'PASS' : 'FAIL', p, shots.teamOfficerFront)

        // Restore officer cleanly to Jiefang bridgehead
        await page.evaluate(orig => {
          window.__olCamHold = null
          window.__olOfficerHold = null
          const officer = window.viewer.dutyOfficers.officers.jiefang
          officer.officerRoot.position.set(orig.ox, orig.oy, orig.oz)
          officer.setLookTarget(null)
          officer.setDutyState('available')
          for (let i = 0; i < 30; i++) window.viewer.dutyOfficers.update(0.1)
        }, layout.orig)
      }

      // TEAM-06: 上岗对话 (KeyF real dialogue + dual 3D portraits ready, inside sidewalk clear of balustrade)
      {
        await page.evaluate(() => {
          const [px, pz] = window.__olToWorld(-99.15, 18.65)
          const w = window.viewer.walk
          const o = window.viewer.dutyOfficers.officers.jiefang.position
          w.clampPosition({x: px, y: 151.85, z: pz})
          const dx = o.x - px
          const dz = o.z - pz
          w.drive(dx, dz, false)
          for (let i = 0; i < 16; i++) w.tick(1 / 60)
          w.hold(true)
          w.hold(false)
          w.clampPosition({x: px, y: 151.85, z: pz})
          for (let i = 0; i < 12; i++) w.tick(1 / 60)
          w.face(Math.atan2(-dx, -dz), 0.08)
        })
        await page.waitForTimeout(220)
        await page.keyboard.press('KeyF')
        await page.waitForSelector('.td-story-dialog:not([hidden])', {timeout: 10000})
        await page
          .waitForFunction(
            () => {
              const oImg = document.querySelector('[data-td-story-portrait-img="officer"]')
              const pImg = document.querySelector('[data-td-story-portrait-img="player"]')
              return oImg?.dataset?.portraitLoaded === '1' && pImg?.dataset?.portraitLoaded === '1' && oImg.complete && pImg.complete
            },
            null,
            {timeout: 15000},
          )
          .catch(() => {})
        await page.evaluate(() => window.__olFlushFrames(6))
        const storyProbe = await page.evaluate(() => {
          const snap = window.viewer.trafficDuty.getStorySnapshot?.()
          const oImg = document.querySelector('[data-td-story-portrait-img="officer"]')
          const pImg = document.querySelector('[data-td-story-portrait-img="player"]')
          return {
            shot: snap?.currentShot ?? null,
            officerReady: oImg?.dataset?.portraitLoaded === '1',
            playerReady: pImg?.dataset?.portraitLoaded === '1',
          }
        })
        shots.teamBriefingDialogue = await captureShot(page, '06-team-briefing-dialogue.png')
        addStep(
          'TEAM6_BRIEFING_DIALOGUE',
          '本组上岗对话实拍与双侧头像就绪',
          storyProbe.officerReady && storyProbe.playerReady ? 'PASS' : 'FAIL',
          storyProbe,
          shots.teamBriefingDialogue,
        )

        // Complete briefing cleanly -> active phase
        for (let i = 0; i < 16; i++) {
          const done = await page.evaluate(() => {
            const snap = window.viewer.trafficDuty.getSnapshot()
            const dlg = document.querySelector('.td-story-dialog')
            const dlgOpen = Boolean(dlg && !dlg.hasAttribute('hidden') && getComputedStyle(dlg).display !== 'none')
            if (snap.phase === 'active' && !dlgOpen) return true
            const choice = dlg?.querySelector('[data-td-story-choice="repeat_accept"], [data-td-story-choice="ready_now"], [data-td-story-choice]')
            if (choice instanceof HTMLElement) choice.click()
            else dlg?.querySelector('[data-td-story-action="next"]')?.click?.()
            return false
          })
          if (done) break
          await page.waitForTimeout(200)
        }
        await page.waitForFunction(() => window.viewer.trafficDuty.getSnapshot().phase === 'active', null, {timeout: 12000})
      }

      // ---------------------------------------------------------------------
      // TEAM-08 & TEAM-09a/09b: ¥70 罚单 + 左手/右手递单双侧峰值实拍 (防 k59)
      // ---------------------------------------------------------------------
      const citedTargetIds = []
      const citeAndHandoverSide = async (desiredSide, shotFine70Name, shotHandoverName) => {
        let picked = null
        for (let retry = 0; retry < 150 && !picked; retry++) {
          picked = await page.evaluate(
            ({requireCombo, seenIds}) => {
              const actors = window.viewer.dutyTraffic?.getActors?.() ?? []
              const lampXs = [-126, -105, -84, -63, -42, -21, 0, 21, 42, 63, 84, 105, 126]
              const isClearBridgeSpan = a => {
                const [lx, lz] = window.__olToLocal(a.x, a.z)
                // Stay on unobstructed main deck span away from -96 bridgehead post/flags/guardrails & lamppost poles
                return Math.abs(lx) <= 82 && Math.abs(lz) >= 12.0 && Math.abs(lz) <= 15.6 && lampXs.every(lp => Math.abs(lx - lp) >= 4.5)
              }
              const isCombo = a => Array.isArray(a.violations) && a.violations.includes('ebike_overload') && a.violations.includes('no_helmet')
              const list = actors.filter(
                a =>
                  !seenIds.includes(a.id) &&
                  a.kind === 'scooter' &&
                  !a.leaving &&
                  !a.pendingRecycle &&
                  !a.cited &&
                  a.scale >= 0.5 &&
                  a.violation &&
                  a.violation !== 'none' &&
                  window.__olOnDeck(a) &&
                  isClearBridgeSpan(a),
              )
              const match = requireCombo ? list.find(isCombo) : list[0]
              if (!match) {
                const p = window.viewer.walk?.position
                for (let k = 0; k < 40; k++) window.viewer.dutyTraffic?.step?.(0.1, p)
                return null
              }
              window.__olTarget = match
              window.__olPlaceFacingTarget(match, 2.7, match.y, 0.72)
              return {id: match.id, violation: match.violation, violations: match.violations ?? [match.violation]}
            },
            {requireCombo: Boolean(shotFine70Name), seenIds: citedTargetIds},
          )
          if (!picked && retry % 3 === 0) await page.waitForTimeout(25)
        }
        assert.ok(picked, `failed to spawn violator for ${shotHandoverName}`)
        citedTargetIds.push(picked.id)

        // Short KeyE pull-over
        for (let attempt = 0; attempt < 3; attempt++) {
          await page.evaluate(() => window.__olPlaceFacingTarget(window.__olTarget, 2.7, window.__olTarget?.y, 0.72))
          await page.keyboard.down('KeyE')
          await page.waitForTimeout(100)
          await page.keyboard.up('KeyE')
          const halted = await page
            .waitForFunction(
              () => {
                const t = window.__olTarget
                if (t && ['pulling_over', 'pulled_over', 'halted'].includes(t.dutyState)) {
                  for (let k = 0; k < 4; k++) window.viewer.dutyTraffic.step(0.1, window.viewer.walk.position)
                  window.viewer.trafficDuty.step?.(0.1)
                }
                return Boolean(t && t.speed <= 0.25 && (t.haltedByDuty || t.dutyState === 'pulled_over' || t.dutyState === 'halted'))
              },
              null,
              {timeout: 4500},
            )
            .then(() => true)
            .catch(() => false)
          if (halted) break
        }

        const prevCited = await page.evaluate(() => window.viewer.trafficDuty.getSnapshot().citedCount)
        await page.evaluate(() => window.__olPlaceFacingTarget(window.__olTarget, 2.1, window.__olTarget?.y, 0.72))
        await page.waitForFunction(() => window.viewer.trafficDuty.getInteractCandidate?.()?.action === 'whistle_cite', null, {timeout: 6000})
        await page.keyboard.press('KeyF')
        await page.waitForSelector('.td-fine-terminal', {timeout: 6000})
        await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
        await page.keyboard.press('Enter')
        await page.waitForFunction(
          () => {
            const ft = window.viewer?.getActiveFineTerminalSession?.()?.getSnapshot?.()
            const btn = document.querySelector('.td-ft-btn-primary')
            return ft?.phase === 'deliver' || Boolean(btn?.textContent?.includes('撕下'))
          },
          null,
          {timeout: 30000},
        )
        if (await page.evaluate(() => window.viewer?.getActiveFineTerminalSession?.()?.getSnapshot?.()?.phase !== 'deliver')) {
          await page.keyboard.press('KeyF')
        }
        await page.waitForFunction(
          () => {
            const ft = window.viewer?.getActiveFineTerminalSession?.()?.getSnapshot?.()
            return ft?.phase === 'deliver' && ft.paperTornOff === true
          },
          null,
          {timeout: 12000},
        )

        let fine70Info = null
        if (shotFine70Name) {
          fine70Info = await page.evaluate(() => {
            const ft = window.viewer?.getActiveFineTerminalSession?.()?.getSnapshot?.()
            const domText = document.querySelector('.td-fine-terminal')?.textContent ?? ''
            const t = window.__olTarget
            const p = window.viewer.walk.position
            const footY = window.viewer.walk.figure?.position?.y ?? p.y - 0.88
            const cam = window.viewer.camera
            const w = window.viewer.walk
            const projNdc = (ex, ey, ez, ax, ay, az, pt) => {
              const fx = ax - ex, fy = ay - ey, fz = az - ez
              const fl = Math.hypot(fx, fy, fz) || 1
              const z0 = -fx / fl, z1 = -fy / fl, z2 = -fz / fl
              let rx = z2, ry = 0, rz = -z0
              const rl = Math.hypot(rx, ry, rz) || 1
              rx /= rl; rz /= rl
              const ux = z1 * rz - z2 * ry, uy = z2 * rx - z0 * rz, uz = z0 * ry - z1 * rx
              const dx = pt[0] - ex, dy = pt[1] - ey, dz = pt[2] - ez
              const cz = dx * z0 + dy * z1 + dz * z2
              const cx = dx * rx + dy * ry + dz * rz
              const cy = dx * ux + dy * uy + dz * uz
              const depth = -cz
              if (depth <= 0.2) return {x: 9, y: 9, depth}
              const tanHalfFov = Math.tan(((cam.fov || 52) * Math.PI) / 360)
              const asp = cam.aspect || 1.6
              return {x: cx / (depth * tanHalfFov * asp), y: cy / (depth * tanHalfFov), depth}
            }
            // Search strictly on same wide nonmotor+sidewalk deck (|elz| in [12.35..19.6], NEVER crossing z=±12.0 white barrier!)
            const midX = (p.x + t.x) * 0.5
            const midZ = (p.z + t.z) * 0.5
            const [tlx, tlz] = window.__olToLocal(t.x, t.z)
            const sideSignDeck = tlz >= 0 ? 1 : -1
            let bestPose = {
              eye: window.__olToWorld(tlx + (tlx > 0 ? -4.2 : 4.2), sideSignDeck * 17.8),
              at: [midX, Math.max(footY, t.y) + 1.0, midZ],
              score: -1e9,
            }
            bestPose.eye = [bestPose.eye[0], Math.max(footY, t.y) + 1.48, bestPose.eye[1]]
            for (let aDeg = 0; aDeg < 360; aDeg += 10) {
              const a = (aDeg * Math.PI) / 180
              const ex = midX + Math.cos(a) * 4.5
              const ez = midZ + Math.sin(a) * 4.5
              const [elx, elz] = window.__olToLocal(ex, ez)
              // Stay strictly on the SAME side of bridge & inside [12.35..19.6] nonmotor/sidewalk width (parapet is ±21.5, barrier is ±12.0)
              if (Math.abs(elx) > 88 || elz * sideSignDeck < 12.35 || Math.abs(elz) > 19.6) continue
              const dx0 = midX - ex, dz0 = midZ - ez
              const len0 = Math.hypot(dx0, dz0) || 1
              const camRightX = -dz0 / len0, camRightZ = dx0 / len0
              for (const shift of [-1.2, -0.85, -0.45, 0, 0.45]) {
                const ax = p.x * 0.55 + t.x * 0.45 + camRightX * shift
                const az = p.z * 0.55 + t.z * 0.45 + camRightZ * shift
                const ey = Math.max(footY, t.y) + 1.46
                const ay = Math.max(footY, t.y) + 1.02
                const dRay = Math.hypot(ax - ex, az - ez) || 1
                const hitHi = w?.raycastObstacle?.(ex, ey, ez, (ax - ex) / dRay, 0, (az - ez) / dRay, dRay)
                const hitLo = w?.raycastObstacle?.(ex, ey - 0.55, ez, (ax - ex) / dRay, 0, (az - ez) / dRay, dRay)
                if ((hitHi && hitHi.distance < dRay - 0.3) || (hitLo && hitLo.distance < dRay - 0.3)) continue
                const np = projNdc(ex, ey, ez, ax, ay, az, [p.x, footY + 1.15, p.z])
                const nt = projNdc(ex, ey, ez, ax, ay, az, [t.x, t.y + 0.9, t.z])
                const npHead = projNdc(ex, ey, ez, ax, ay, az, [p.x, footY + 1.65, p.z])
                if (npHead.y > 0.78) continue
                // Left terminal covers NDC x <= -0.20; want player np.x in [0.02..0.26] & scooter nt.x in [0.32..0.76]
                let score = 0
                if (np.x >= 0.02 && np.x <= 0.26) score += 30
                else score -= Math.abs(np.x - 0.14) * 40
                if (nt.x >= 0.32 && nt.x <= 0.76) score += 30
                else score -= Math.abs(nt.x - 0.52) * 40
                if (nt.x - np.x >= 0.20) score += 20
                else score -= 60
                score -= Math.abs(np.y) * 6 + Math.abs(nt.y) * 6
                if (score > bestPose.score) {
                  bestPose = {eye: [ex, ey, ez], at: [ax, ay, az], score, np: +np.x.toFixed(2), nt: +nt.x.toFixed(2), elz: +elz.toFixed(2)}
                }
              }
            }
            window.__olCamHold = {eye: bestPose.eye, at: bestPose.at}
            return {
              fineYuan: ft?.fineYuan ?? null,
              violations: ft?.violations ?? null,
              domHas70: /¥\s*70|70/.test(domText),
              camScore: +bestPose.score.toFixed(1),
              np: bestPose.np ?? null,
              nt: bestPose.nt ?? null,
              elz: bestPose.elz ?? null,
            }
          })
          await page.evaluate(() => window.__olFlushFrames(4))
          shots.teamFine70 = await captureShot(page, shotFine70Name)
          await page.evaluate(() => {
            window.__olCamHold = null
          })
          addStep(
            'TEAM8_FINE_70',
            '本组数罪并罚 ¥70 罚单实拍',
            fine70Info.fineYuan === 70 && fine70Info.domHas70 ? 'PASS' : 'FAIL',
            fine70Info,
            shots.teamFine70,
          )
        }

        // Place player strictly AHEAD-AND-BESIDE scooter so handSide matches desiredSide ('left' or 'right') cleanly without rear passenger
        const nearProbe = await page.evaluate(sideWant => {
          const t = window.__olTarget
          for (const candidateSign of [1, -1]) {
            window.__olPlaceAheadOfTarget(t, 1.15, 0.28, candidateSign)
            const p = window.viewer.walk.position
            const lBone = window.viewer.dutyTraffic.getActorHandBone?.(t, 'left')
            const rBone = window.viewer.dutyTraffic.getActorHandBone?.(t, 'right')
            lBone?.updateWorldMatrix?.(true, false)
            rBone?.updateWorldMatrix?.(true, false)
            const le = lBone?.matrixWorld?.elements
            const re = rBone?.matrixWorld?.elements
            const dL = le ? Math.hypot(p.x - le[12], p.z - le[14]) : Infinity
            const dR = re ? Math.hypot(p.x - re[12], p.z - re[14]) : Infinity
            const nearest = dL <= dR ? 'left' : 'right'
            if (nearest === sideWant) {
              return {expectedSide: nearest, candidateSign, dL: +dL.toFixed(3), dR: +dR.toFixed(3)}
            }
          }
          return {expectedSide: null, candidateSign: 1}
        }, desiredSide)

        await page.waitForFunction(() => Boolean(document.querySelector('.td-ft-btn-deliver:not(:disabled)')), null, {timeout: 8000})
        await page.keyboard.press('KeyF')
        await page.waitForFunction(
          prev => !document.querySelector('.td-fine-terminal') && window.viewer.trafficDuty.getSnapshot().citedCount >= prev + 1,
          prevCited,
          {timeout: 12000},
        )

        // Step ONLY 2*0.05=0.10s before capture so live animate()+captureShot hits peak ~0.50s reachWeight=1.0 inside the 1.15s receipt window!
        const handoverMeta = await page.evaluate(
          ({wantSide, sign}) => {
            const p = window.viewer.walk.position
            const footY = window.viewer.walk.figure?.position?.y ?? p.y - 0.88
            for (let k = 0; k < 2; k++) {
              window.viewer.dutyTraffic.step?.(0.05, p)
              window.viewer.trafficDuty.step?.(0.05)
            }
            const t = window.__olTarget
            const lBone = t ? window.viewer.dutyTraffic.getActorHandBone?.(t, 'left') : null
            const rBone = t ? window.viewer.dutyTraffic.getActorHandBone?.(t, 'right') : null
            const targetBone = wantSide === 'left' ? lBone : rBone
            targetBone?.updateWorldMatrix?.(true, false)
            const slipObj = targetBone?.getObjectByName?.('duty-receipt-sheet') ?? targetBone?.getObjectByName?.('duty-receipt-slip')
            slipObj?.updateWorldMatrix?.(true, false)
            const se = slipObj?.matrixWorld?.elements
            const be = targetBone?.matrixWorld?.elements
            const hx = se ? se[12] : be ? be[12] : t.x
            const hy = se ? se[13] : be ? be[13] : t.y + 1.15
            const hz = se ? se[14] : be ? be[14] : t.z
            const pChest = [p.x, footY + 1.12, p.z]
            const hPos = [hx, hy, hz]
            const tChest = [t.x, t.y + 1.05, t.z]
            const scYaw = Number.isFinite(t.yaw) ? t.yaw : 0
            // Match receipt-model.ts:563-586 exact front-face normal zAxis = (lat * 0.9 + back * 0.24, +0.26)
            const slipSign = wantSide === 'left' ? -1 : 1
            const latX = -Math.cos(scYaw) * slipSign, latZ = Math.sin(scYaw) * slipSign
            const backX = -Math.sin(scYaw), backZ = -Math.cos(scYaw)
            const normX0 = latX * 0.9 + backX * 0.24, normZ0 = latZ * 0.9 + backZ * 0.24
            const normLen = Math.hypot(normX0, normZ0) || 1
            const slipNormX = normX0 / normLen, slipNormZ = normZ0 / normLen
            const mid = [pChest[0] * 0.30 + hx * 0.70, hy + 0.04, pChest[2] * 0.30 + hz * 0.70]

            const segDist = (pt, a, b) => {
              const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2]
              const apx = pt[0] - a[0], apy = pt[1] - a[1], apz = pt[2] - a[2]
              const len2 = abx * abx + aby * aby + abz * abz || 1
              const u = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / len2))
              return Math.hypot(pt[0] - (a[0] + abx * u), pt[1] - (a[1] + aby * u), pt[2] - (a[2] + abz * u))
            }
            const cam = window.viewer.camera
            const w = window.viewer.walk
            const projNdc = (ex, ey, ez, pt) => {
              const fx = mid[0] - ex, fy = mid[1] - ey, fz = mid[2] - ez
              const fl = Math.hypot(fx, fy, fz) || 1
              const z0 = -fx / fl, z1 = -fy / fl, z2 = -fz / fl
              let rx = z2, ry = 0, rz = -z0
              const rl = Math.hypot(rx, ry, rz) || 1
              rx /= rl; rz /= rl
              const ux = z1 * rz - z2 * ry, uy = z2 * rx - z0 * rz, uz = z0 * ry - z1 * rx
              const dx = pt[0] - ex, dy = pt[1] - ey, dz = pt[2] - ez
              const cz = dx * z0 + dy * z1 + dz * z2
              const cx = dx * rx + dy * ry + dz * rz
              const cy = dx * ux + dy * uy + dz * uz
              const depth = -cz
              if (depth <= 0.2) return {x: 9, y: 9}
              const th = Math.tan(((cam.fov || 52) * Math.PI) / 360)
              return {x: cx / (depth * th * (cam.aspect || 1.6)), y: cy / (depth * th)}
            }

            const [, tlz] = window.__olToLocal(t.x, t.z)
            const deckSideSign = tlz >= 0 ? 1 : -1
            const toPlayX = p.x - t.x, toPlayZ = p.z - t.z
            const toPlayLen = Math.hypot(toPlayX, toPlayZ) || 1
            let best = {
              eye: [hx + slipNormX * 1.55, hy + 0.34, hz + slipNormZ * 1.55],
              score: -1e9,
            }
            for (const radius of [1.60, 1.85]) {
              for (let aDeg = 0; aDeg < 360; aDeg += 10) {
                const a = (aDeg * Math.PI) / 180
                const ex = mid[0] + Math.cos(a) * radius
                const ey = hy + 0.24
                const ez = mid[2] + Math.sin(a) * radius
                const [elx, elz] = window.__olToLocal(ex, ez)
                // Keep strictly on SAME wide nonmotor+sidewalk deck ([12.25..19.6], NEVER crossing z=±12.0 white barrier!)
                if (Math.abs(elx) > 90 || elz * deckSideSign < 12.25 || Math.abs(elz) > 19.6) continue
                const eye = [ex, ey, ez]
                if (Math.hypot(ex - pChest[0], ez - pChest[2]) < 1.0) continue
                if (Math.hypot(ex - tChest[0], ez - tChest[2]) < 1.0) continue
                // Broadside to rider<->player line (NEVER behind player's back & NEVER behind rider's back!)
                const camToMidLen = Math.hypot(ex - mid[0], ez - mid[2]) || 1
                const axisDot = ((ex - mid[0]) * toPlayX + (ez - mid[2]) * toPlayZ) / (camToMidLen * toPlayLen)
                if (Math.abs(axisDot) > 0.62) continue
                // Look directly into the printed +Z front face of duty-receipt-sheet!
                const camToSlipLen = Math.hypot(ex - hx, ez - hz) || 1
                const slipFaceDot = ((ex - hx) * slipNormX + (ez - hz) * slipNormZ) / camToSlipLen
                if (slipFaceDot < 0.30) continue
                const dPlayerBlock = segDist(pChest, eye, hPos)
                const dRiderBlock = segDist(tChest, eye, hPos)
                if (dPlayerBlock < 0.42 || dRiderBlock < 0.32) continue
                const dLen = camToMidLen || 1
                const hitHi = w?.raycastObstacle?.(ex, ey, ez, (mid[0] - ex) / dLen, 0, (mid[2] - ez) / dLen, dLen)
                const hitLo = w?.raycastObstacle?.(ex, ey - 0.30, ez, (mid[0] - ex) / dLen, 0, (mid[2] - ez) / dLen, dLen)
                if ((hitHi && hitHi.distance < dLen - 0.35) || (hitLo && hitLo.distance < dLen - 0.35)) continue
                const np = projNdc(ex, ey, ez, pChest)
                const nh = projNdc(ex, ey, ez, hPos)
                const nt = projNdc(ex, ey, ez, tChest)
                const npHead = projNdc(ex, ey, ez, [p.x, footY + 1.65, p.z])
                if (Math.max(Math.abs(np.x), Math.abs(nh.x), Math.abs(nt.x)) > 0.86 || npHead.y > 0.72) continue
                const sepP = Math.abs(np.x - nh.x)
                const sepT = Math.abs(nt.x - nh.x)
                if (sepP < 0.12 || sepT < 0.06) continue
                const score =
                  slipFaceDot * 40 +
                  Math.min(sepP + sepT, 1.0) * 28 +
                  (1 - Math.abs(axisDot)) * 22 +
                  Math.min(dPlayerBlock, dRiderBlock) * 12
                if (score > best.score) best = {eye, score, slipFaceDot: +slipFaceDot.toFixed(2), axisDot: +axisDot.toFixed(2), elz: +elz.toFixed(2)}
              }
            }
            window.__olCamHold = {
              eye: best.eye,
              at: mid,
            }
            const slipLeft = Boolean(lBone?.getObjectByName?.('duty-receipt-slip'))
            const slipRight = Boolean(rBone?.getObjectByName?.('duty-receipt-slip'))
            return {
              targetCited: Boolean(t?.cited),
              targetHoldingReceipt: Boolean(t?.holdingReceipt),
              animElapsed: t?.ticketReceiveAnimElapsed ?? null,
              slipFound: Boolean(slipObj),
              slipLeft,
              slipRight,
              actualHandSide: slipLeft ? 'left' : slipRight ? 'right' : t?.heldTicketHandSide ?? t?.handSide ?? null,
              sign,
              camScore: +best.score.toFixed(1),
              slipFaceDot: best.slipFaceDot ?? null,
              axisDot: best.axisDot ?? null,
              elz: best.elz ?? null,
            }
          },
          {wantSide: desiredSide, sign: nearProbe.candidateSign},
        )
        await page.evaluate(() => window.__olFlushFrames(1))
        const shot = await captureShot(page, shotHandoverName)
        const postSnapAnim = await page.evaluate(() => ({
          active: Boolean(window.__olTarget?.ticketReceiveAnimActive),
          elapsed: window.__olTarget?.ticketReceiveAnimElapsed ?? null,
          holding: Boolean(window.__olTarget?.holdingReceipt),
        }))
        handoverMeta.postSnapAnim = postSnapAnim
        await page.evaluate(() => {
          window.__olCamHold = null
          // Let cited actor depart cleanly before picking next scooter
          const p = window.viewer.walk.position
          for (let k = 0; k < 70; k++) window.viewer.dutyTraffic.step?.(0.1, p)
        })
        return {nearProbe, handoverMeta, shot}
      }

      const handLeft = await citeAndHandoverSide('left', '08-team-fine-70-yuan.png', '09a-team-handover-left.png')
      shots.teamHandoverLeft = handLeft.shot
      addStep(
        'TEAM9A_HANDOVER_LEFT',
        '本组左手递单峰值姿态实拍',
        Boolean(handLeft.handoverMeta.targetHoldingReceipt && handLeft.handoverMeta.actualHandSide === 'left') ? 'PASS' : 'FAIL',
        handLeft,
        shots.teamHandoverLeft,
      )

      const handRight = await citeAndHandoverSide('right', null, '09b-team-handover-right.png')
      shots.teamHandoverRight = handRight.shot
      addStep(
        'TEAM9B_HANDOVER_RIGHT',
        '本组右手递单峰值姿态实拍',
        Boolean(handRight.handoverMeta.targetHoldingReceipt && handRight.handoverMeta.actualHandSide === 'right') ? 'PASS' : 'FAIL',
        handRight,
        shots.teamHandoverRight,
      )

      // ---------------------------------------------------------------------
      // TEAM-10: 十字街地下 B1 通道实拍 (capture INSIDE B1 concourse, NOT after return — anti-k59!)
      // ---------------------------------------------------------------------
      {
        const ug = specs.shizijieUnderground
        const origin = ug?.originWorld ?? [-879.750202, 151.3, -169.626045]
        const nw = (ug?.entrances ?? []).find(e => e.corner === 'nw') ?? ug?.entrances?.[0]
        const mouth = nw?.worldMouth ? {x: nw.worldMouth[0], z: nw.worldMouth[2]} : {x: origin[0] - 18.8, z: origin[2] - 43.2}
        const deep = nw?.worldDeep ? {x: nw.worldDeep[0], z: nw.worldDeep[2]} : {x: origin[0] - 15.2, z: origin[2] - 40.5}
        const lenOut = Math.hypot(mouth.x - deep.x, mouth.z - deep.z) || 1
        const approach = {x: mouth.x + ((mouth.x - deep.x) / lenOut) * 3.5, z: mouth.z + ((mouth.z - deep.z) / lenOut) * 3.5}

        await page.evaluate(async ap => {
          await window.viewer.trafficDuty.abandonDuty()
          window.viewer.trafficDuty.closePanel?.()
          await window.viewer.walkTo(ap.x, ap.z, 0, 'ol-full-shizijie-b1')
        }, approach)
        await page.waitForTimeout(600)

        const b1Trace = await page.evaluate(
          pts => {
            const w = window.viewer.walk
            let idx = 0
            try {
              for (let f = 0; f < 2600 && idx < pts.length; f++) {
                const cur = w.position
                const dx = pts[idx].x - cur.x
                const dz = pts[idx].z - cur.z
                const d = Math.hypot(dx, dz)
                if (d < 1.2) {
                  idx++
                  continue
                }
                w.drive(dx / d, dz / d)
                w.tick(1 / 60)
                if (w.probe().resets > 0) break
              }
            } finally {
              w.drive(0, 0)
            }
            const look = {x: pts[pts.length - 1].x + 2.5, z: pts[pts.length - 1].z + 5.6}
            w.face(Math.atan2(-(look.x - w.position.x), -(look.z - w.position.z)), 0.0)
            return {arrived: idx, total: pts.length, endFootY: +w.probe().foot.toFixed(2)}
          },
          [
            mouth,
            deep,
            {x: origin[0] - 12.7, z: origin[2] - 38.854},
            {x: origin[0] - 4.83, z: origin[2] - 20.024},
            {x: origin[0] + 2.38, z: origin[2] - 2.794},
          ],
        )
        // Wait briefly so delayed Shizijie spot-card triggers before we close it cleanly & wait for hide transition
        for (let r = 0; r < 6; r++) {
          await page.waitForTimeout(250)
          await dismissBlockingUi(page)
          const clean = await page.evaluate(() => {
            const guide = document.querySelector('.guide.open .guide-toggle, [data-guide-toggle]')
            if (guide instanceof HTMLElement) guide.click()
            return !document.querySelector('dialog.td-panel[open], .td-panel[open], .ld-veil, .spot-card.show')
          })
          if (clean && r >= 2) break
        }
        await page.evaluate(() => window.__olFlushFrames(4))
        const b1UiClean = await page.evaluate(
          () => !document.querySelector('dialog.td-panel[open], .td-panel[open], .ld-veil, .spot-card.show'),
        )
        shots.teamShizijieB1 = await captureShot(page, '10-team-shizijie-b1.png')
        const floorY = ug?.worldFloorY ?? 147.1
        addStep(
          'TEAM10_SHIZIJIE_B1',
          '本组十字街地下 B1 商铺与走廊实拍',
          b1UiClean && b1Trace.endFootY <= floorY + 1.5 ? 'PASS' : 'FAIL',
          {...b1Trace, floorY, b1UiClean},
          shots.teamShizijieB1,
        )
      }
    } finally {
      await page.close().catch(() => {})
    }

    // -----------------------------------------------------------------------
    // 6. XXG-11: 小香港地下商业城真实步入实拍 (xxg=1 + E1 doorway enter)
    // -----------------------------------------------------------------------
    {
      const pg = await context.newPage()
      attachErrorListeners(pg)
      try {
        await pg.goto(`${VERIFY_WALK_URL}&flow=0&time=14.5&xxg=1`, {
          waitUntil: 'domcontentloaded',
          timeout: 90000,
        })
        await pg.waitForFunction(
          () => Boolean(window.viewer?.walk?.active && (window.viewer?.stats?.frame ?? 0) > 25),
          null,
          {timeout: 120000},
        )
        const hasXxgApi = await pg.evaluate(() => Boolean(window.viewer?.xxg))
        if (!hasXxgApi) {
          shots.xxgEntry = await captureShot(pg, '11-xxg-entry.png')
          addStep('XXG_ENTRY', '小香港地下商业城进入实拍', 'FAIL', {reason: 'window.viewer.xxg not mounted on 5176'}, shots.xxgEntry)
        } else {
          await dismissBlockingUi(pg)
          const portal = specs.xxgPortal
          await pg.evaluate(async pt => {
            await window.viewer.walkTo(pt.landing.x, pt.landing.z, pt.approachYaw, 'ol-full-xxg-entry')
          }, portal)
          await pg.waitForTimeout(800)
          await dismissBlockingUi(pg)

          await pg.keyboard.down('KeyW')
          const enterDeadline = Date.now() + 5500
          let entered = false
          while (Date.now() < enterDeadline) {
            entered = await pg.evaluate(
              () => document.body.dataset.xxgActive === '1' || Boolean(window.viewer?.xxg?.getState?.()?.isIndoor),
            )
            if (entered) break
            await pg.waitForTimeout(80)
          }
          await pg.keyboard.up('KeyW')
          if (!entered) {
            await pg.keyboard.press('KeyE')
            await pg.waitForTimeout(450)
            entered = await pg.evaluate(
              () => document.body.dataset.xxgActive === '1' || Boolean(window.viewer?.xxg?.getState?.()?.isIndoor),
            )
          }
          await pg
            .waitForFunction(() => window.viewer?.xxg?.getState?.()?.state === 'inside', null, {timeout: 10000})
            .catch(() => {})
          // Step slightly forward past portal vestibule so lit shop corridor & signage fill view
          await pg.keyboard.down('KeyW')
          await pg.waitForTimeout(550)
          await pg.keyboard.up('KeyW')
          await pg.waitForTimeout(350)
          await dismissBlockingUi(pg)
          await pg.evaluate(() => {
            const guide = document.querySelector('.guide.open .guide-toggle, [data-guide-toggle]')
            if (guide instanceof HTMLElement) guide.click()
          })
          const xxgBlack = await sampleCanvasIsBlack(pg)
          const xxgState = await pg.evaluate(() => window.viewer?.xxg?.getState?.() ?? null)
          shots.xxgEntry = await captureShot(pg, '11-xxg-entry.png')
          const m = xxgState?.metrics ?? {}
          const ok =
            Boolean(entered && xxgState?.state === 'inside' && !xxgBlack) &&
            (m.drawCalls ?? 0) > 0 &&
            (m.drawCalls ?? 0) <= 40 &&
            (m.lastBlackFrames ?? 0) === 0
          addStep(
            'XXG_ENTRY',
            '小香港地下商业城进入实拍',
            ok ? 'PASS' : 'FAIL',
            {portalId: portal.id, entered, xxgBlack, state: xxgState?.state ?? null, metrics: m, player: xxgState?.player ?? null},
            shots.xxgEntry,
          )
        }
      } catch (err) {
        addStep('XXG_ENTRY', '小香港地下商业城进入实拍', 'FAIL', {error: err.message})
      } finally {
        await pg.close().catch(() => {})
      }
    }

    // -----------------------------------------------------------------------
    // 7. SZJ-12: 十字街地下街新路线 A 进入实拍 (szj=1 + se 28-step descent into B1)
    // -----------------------------------------------------------------------
    {
      const pg = await context.newPage()
      attachErrorListeners(pg)
      try {
        await pg.goto(`${VERIFY_WALK_URL}&flow=0&time=14.5&szj=1`, {
          waitUntil: 'domcontentloaded',
          timeout: 90000,
        })
        await pg.waitForFunction(
          () => Boolean(window.viewer?.walk?.active && (window.viewer?.stats?.frame ?? 0) > 25),
          null,
          {timeout: 120000},
        )
        const hasSzjApi = await pg.evaluate(() => Boolean(window.viewer?.szj))
        if (!hasSzjApi) {
          shots.szjEntry = await captureShot(pg, '12-szj-entry.png')
          addStep('SZJ_ENTRY', '十字街地下街新路线 A 进入实拍', 'FAIL', {reason: 'window.viewer.szj not mounted on 5176'}, shots.szjEntry)
        } else {
          await dismissBlockingUi(pg)
          const st = specs.szjStair
          await pg.evaluate(async s => {
            await window.viewer.walkTo(s.landing.x, s.landing.z, s.approachYaw, 'ol-full-szj-entry')
          }, st)
          await pg.waitForTimeout(800)
          await dismissBlockingUi(pg)

          await pg.keyboard.down('KeyW')
          const enterDeadline = Date.now() + 9000
          let entered = false
          while (Date.now() < enterDeadline) {
            entered = await pg.evaluate(
              () => document.body.dataset.szjActive === '1' || Boolean(window.viewer?.szj?.getState?.()?.isIndoor),
            )
            if (entered) break
            await pg.waitForTimeout(80)
          }
          await pg.keyboard.up('KeyW')
          await pg
            .waitForFunction(() => window.viewer?.szj?.getState?.()?.state === 'inside', null, {timeout: 12000})
            .catch(() => {})
          // Walk briefly past entrance stair foot into brightly lit B1 concourse under hanging sign
          await pg.keyboard.down('KeyW')
          await pg.waitForTimeout(800)
          await pg.keyboard.up('KeyW')
          await pg.waitForTimeout(350)
          await dismissBlockingUi(pg)
          await pg.evaluate(() => {
            const guide = document.querySelector('.guide.open .guide-toggle, [data-guide-toggle]')
            if (guide instanceof HTMLElement) guide.click()
          })
          const szjBlack = await sampleCanvasIsBlack(pg)
          const szjState = await pg.evaluate(() => window.viewer?.szj?.getState?.() ?? null)
          shots.szjEntry = await captureShot(pg, '12-szj-entry.png')
          const m = szjState?.metrics ?? {}
          const ok =
            Boolean(entered && szjState?.state === 'inside' && !szjBlack) &&
            (m.drawCalls ?? 0) > 0 &&
            (m.drawCalls ?? 0) <= 60 &&
            (m.lastBlackFrames ?? 0) === 0
          addStep(
            'SZJ_ENTRY',
            '十字街地下街新路线 A 进入实拍',
            ok ? 'PASS' : 'FAIL',
            {stairId: st.id, entered, szjBlack, state: szjState?.state ?? null, metrics: m, player: szjState?.player ?? null},
            shots.szjEntry,
          )
        }
      } catch (err) {
        addStep('SZJ_ENTRY', '十字街地下街新路线 A 进入实拍', 'FAIL', {error: err.message})
      } finally {
        await pg.close().catch(() => {})
      }
    }
  } catch (err) {
    ERRS.push(`[fatal] ${err?.stack || err?.message || String(err)}`)
  } finally {
    await context?.close().catch(() => {})
    if (ownsBrowser && browser) {
      await browser.close().catch(() => {})
    }
  }

  const passed = steps.filter(s => s.status === 'PASS').length
  const failed = steps.filter(s => s.status !== 'PASS').length
  const report = {
    script: 'scripts/verify-ol-full.mjs',
    baseOrigin: BASE_ORIGIN,
    browserMode: mode,
    timestamp: new Date().toISOString(),
    shotCount: Object.keys(shots).length,
    passed,
    failed,
    ERRS,
    shots,
    steps,
  }
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log(`ERRS=${JSON.stringify(ERRS)}`)
  console.log(`SUMMARY passed=${passed} failed=${failed} shots=${report.shotCount} report=${REPORT_PATH}`)
  if (failed > 0 || ERRS.length > 0) process.exitCode = 1
}

await run()
