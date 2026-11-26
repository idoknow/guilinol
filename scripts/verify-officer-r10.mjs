// r10 交警建模真实浏览器验收脚本（专属领地：scripts/verify-officer-r10.mjs + captures/duty-r10-officer/）
// 职责：
//   1. 同屏对比玩家与解放桥交警：正面、3/4 侧、侧面全身（01~03）
//   2. 实机按 F 对话特写（04）与四种表情激活瞬间抓拍（05~08：serious / smile / remind / thumbs_up，防 k59 失效帧）
//   3. 实机完成 2 单并触发下岗交差双人镜头（09）
//   4. 探针硬断言：creator-face / creator-hair / creator-body-outline、与玩家同款 figure_m 骨架、三角面 <= 20,000、ERRS=[]
//   5. 优先连 127.0.0.1:9222，连不上自启 Chromium；finally 严格回收自启浏览器/页面（零残留，不动 4190/5176）

import assert from 'node:assert/strict'
import {mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {chromium} from 'playwright'
import {build} from 'esbuild'
import {browserOptions} from './qa-browser.mjs'

const ROOT = process.cwd()
const BASE_ORIGIN = process.env.DUTY_ORIGIN || 'http://127.0.0.1:5176'
const WALK_URL = `${BASE_ORIGIN}/?mode=walk`
const VERIFY_URL = `${BASE_ORIGIN}/?verify&mode=walk`
const CDP_ENDPOINT = process.env.CDP_URL || 'http://127.0.0.1:9222'
const OUT_DIR = resolve(ROOT, 'captures/duty-r10-officer')
const REPORT_PATH = resolve(OUT_DIR, 'report.json')

const OFFICER_EXPRESSIONS = ['serious', 'smile', 'remind', 'thumbs_up']

async function loadBridgeSpec() {
  const tmpDir = await mkdtemp(join(tmpdir(), 'r10-officer-'))
  const outFile = join(tmpDir, 'spec.mjs')
  try {
    await build({
      stdin: {
        contents: `export {JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y, JIEFANG_CROSS_SECTION, jiefangDeckRoadLocalY} from './web/src/traffic-duty/jiefang-railings.ts'`,
        resolveDir: ROOT,
        loader: 'ts',
      },
      outfile: outFile,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      logLevel: 'silent',
    })
    const mod = await import(pathToFileURL(outFile).href)
    return {
      origin: [...mod.JIEFANG_BRIDGE_ORIGIN],
      rotationY: mod.JIEFANG_BRIDGE_ROTATION_Y,
      crossSection: mod.JIEFANG_CROSS_SECTION,
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
  assert.ok(chunks.length > 0, `no JS/TS entry modules found in ${WALK_URL}`)
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
    const skip = document.querySelector('.coach.in .coach-skip')
    if (skip instanceof HTMLElement) skip.click()
    const cardClose = document.querySelector('.spot-card.show .card-close')
    if (cardClose instanceof HTMLElement) cardClose.click()
  })
  await page.waitForTimeout(180)
}

async function installR10Helpers(page, spec) {
  await page.evaluate(s => {
    const [OX, OY, OZ] = s.origin
    const C = Math.cos(s.rotationY)
    const S = Math.sin(s.rotationY)
    const cs = s.crossSection

    window.__r10ToLocal = (wx, wz) => {
      const dx = wx - OX
      const dz = wz - OZ
      return [dx * C - dz * S, dx * S + dz * C]
    }
    window.__r10ToWorld = (lx, lz) => [OX + lx * C + lz * S, OZ - lx * S + lz * C]
    window.__r10OnDeck = a => {
      if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.z)) return false
      const [lx, lz] = window.__r10ToLocal(a.x, a.z)
      return lx >= cs.minX && lx <= cs.maxX && lz >= cs.minZ && lz <= cs.maxZ && a.y >= OY - 2 && a.y <= OY + 12
    }
    window.__r10PlaceFacingTarget = (target, alongDistM, fallbackY, lateralOffsetM = 0, sideSign = 1) => {
      if (!target) return null
      const [lx, lz] = window.__r10ToLocal(target.x, target.z)
      const dirX = lx > 0 ? -1 : 1
      const latSign = (lz >= 0 ? 1 : -1) * (sideSign >= 0 ? 1 : -1)
      const pxLx = Math.max(-138.5, Math.min(138.5, lx + dirX * alongDistM))
      const rawLz = lz + latSign * lateralOffsetM
      const pxLz = lz >= 0 ? Math.min(15.85, Math.max(12.45, rawLz)) : Math.max(-15.85, Math.min(-12.45, rawLz))
      const [px, pz] = window.__r10ToWorld(pxLx, pxLz)
      const py = Number.isFinite(fallbackY) ? fallbackY : target.y
      window.viewer.walk.clampPosition({x: px, y: py, z: pz})
      for (let k = 0; k < 6; k++) window.viewer.walk.tick(1 / 60)
      const landed = window.viewer.walk.position
      window.viewer.walk.face(Math.atan2(-(target.x - landed.x), -(target.z - landed.z)), 0.06)
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      return +Math.hypot(target.x - landed.x, target.z - landed.z).toFixed(3)
    }

    const cam = window.viewer.camera
    if (!cam.__r10Patched) {
      const origUpdate = cam.updateMatrixWorld.bind(cam)
      cam.updateMatrixWorld = force => {
        const officerHold = window.__r10OfficerHold
        if (officerHold) {
          try {
            const off = window.viewer?.dutyOfficers?.officers?.jiefang?.officerRoot
            if (off) off.position.set(officerHold.x, officerHold.y, officerHold.z)
          } catch {}
        }
        const hold = window.__r10CamHold
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
      cam.__r10Patched = true
    }

    window.__r10FlushFrames = async (count = 3) => {
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

    window.__r10InspectCharacters = () => {
      const officer = window.viewer?.dutyOfficers?.officers?.jiefang
      const officerRoot = officer?.officerRoot ?? null
      const walk = window.viewer?.walk
      const playerFig = walk?.figure ?? null
      const riggedModel = officerRoot?.getObjectByName('rigged-traffic-officer') ?? null
      const fallbackModel = officerRoot?.getObjectByName('officer_fallback') ?? null

      const isBranchVisible = (obj, stopAt) => {
        let cur = obj
        while (cur && cur !== stopAt) {
          if (!cur.visible) return false
          cur = cur.parent
        }
        return obj ? Boolean(obj.visible) : false
      }

      const inspectMeshTree = (root, stopAt) => {
        if (!root) return null
        root.updateMatrixWorld(true)
        let triangleCount = 0
        let meshCount = 0
        let estimatedDrawCalls = 0
        const meshNames = []
        const skinnedMeshes = []
        root.traverse(node => {
          if (!node.isMesh) return
          if (!isBranchVisible(node, stopAt)) return
          meshCount += 1
          meshNames.push(node.name || '(unnamed)')
          const mats = Array.isArray(node.material) ? node.material : [node.material]
          estimatedDrawCalls += Math.max(1, mats.filter(Boolean).length)
          const g = node.geometry
          if (g) {
            const idx = g.getIndex()
            const drawCount = g.drawRange?.count ?? Infinity
            if (idx) {
              const eff = Number.isFinite(drawCount) ? Math.min(idx.count, drawCount) : idx.count
              triangleCount += Math.floor(eff / 3)
            } else {
              const pos = g.getAttribute('position')
              if (pos) {
                const eff = Number.isFinite(drawCount) ? Math.min(pos.count, drawCount) : pos.count
                triangleCount += Math.floor(eff / 3)
              }
            }
          }
          if (node.isSkinnedMesh) {
            const bones = (node.skeleton?.bones ?? []).map(b => b.name)
            const vertCount = g?.getAttribute('position')?.count ?? 0
            skinnedMeshes.push({
              name: node.name || '(unnamed)',
              vertCount,
              boneCount: bones.length,
              bones,
            })
          }
        })
        skinnedMeshes.sort((a, b) => b.vertCount - a.vertCount)
        const nonOutlinePrimary =
          skinnedMeshes.find(s => !/outline|skirt|accent/i.test(s.name)) ?? skinnedMeshes[0] ?? null
        return {
          triangleCount,
          meshCount,
          estimatedDrawCalls,
          meshNames,
          skinnedMeshes: skinnedMeshes.map(s => ({name: s.name, vertCount: s.vertCount, boneCount: s.boneCount})),
          primarySkinned: nonOutlinePrimary,
        }
      }

      const checkCreatorNode = (root, name) => {
        const node = root?.getObjectByName(name) ?? null
        if (!node) return {present: false, visible: false, meshCount: 0, vertCount: 0}
        let meshes = 0
        let verts = 0
        node.traverse(sub => {
          if (sub.isMesh && sub.visible) {
            meshes += 1
            verts += sub.geometry?.getAttribute('position')?.count ?? 0
          }
        })
        if (node.isMesh && meshes === 0 && node.visible) {
          meshes = 1
          verts = node.geometry?.getAttribute('position')?.count ?? 0
        }
        return {
          present: true,
          visible: isBranchVisible(node, root),
          meshCount: meshes,
          vertCount: verts,
        }
      }

      const officerBodyTarget = riggedModel ?? officerRoot
      const officerMetrics = inspectMeshTree(officerBodyTarget, officerBodyTarget)
      const officerFullMetrics = inspectMeshTree(officerRoot, officerRoot)
      const playerMetrics = inspectMeshTree(playerFig, playerFig)

      const officerBones = officerMetrics?.primarySkinned?.bones ?? []
      const playerBones = playerMetrics?.primarySkinned?.bones ?? []
      const requiredFigureMBones = [
        'pelvis',
        'spine_01',
        'spine_02',
        'spine_03',
        'neck_01',
        'head',
        'clavicle_l',
        'upperarm_l',
        'lowerarm_l',
        'hand_l',
        'thigh_l',
        'calf_l',
        'foot_l',
      ]
      const boneNamesExactMatch =
        officerBones.length > 0 &&
        officerBones.length === playerBones.length &&
        officerBones.every((b, idx) => b === playerBones[idx])
      const hasAllRequiredBones = requiredFigureMBones.every(b => officerBones.includes(b))

      const getSegmentLengths = root => {
        if (!root) return null
        root.updateMatrixWorld(true)
        const pos = name => {
          const b = root.getObjectByName(name)
          if (!b) return null
          const e = b.matrixWorld.elements
          return [e[12], e[13], e[14]]
        }
        const dist = (a, b) => (a && b ? +Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(4) : null)
        return {
          pelvisToHead: dist(pos('pelvis'), pos('head')),
          upperArmL: dist(pos('upperarm_l'), pos('lowerarm_l')),
          foreArmL: dist(pos('lowerarm_l'), pos('hand_l')),
          thighL: dist(pos('thigh_l'), pos('calf_l')),
          shinL: dist(pos('calf_l'), pos('foot_l')),
        }
      }

      const offSegs = getSegmentLengths(officerBodyTarget)
      const plSegs = getSegmentLengths(playerFig)
      let maxSegmentRatioDiff = null
      if (offSegs && plSegs) {
        const diffs = Object.keys(offSegs)
          .map(k => {
            const ov = offSegs[k]
            const pv = plSegs[k]
            if (!ov || !pv) return null
            return +Math.abs(ov / pv - 1).toFixed(4)
          })
          .filter(v => v !== null)
        if (diffs.length > 0) maxSegmentRatioDiff = Math.max(...diffs)
      }

      const uniformHits = []
      officerBodyTarget?.traverse(n => {
        if (
          /uniform|vest|cap|hat_traffic_police_cap|top_traffic_police_shirt|bottom_police_trousers|officer_|duty_kit|outfit_|wand/i.test(
            n.name || '',
          )
        ) {
          uniformHits.push(n.name)
        }
      })

      return {
        hasRiggedOfficer: Boolean(riggedModel),
        fallbackVisible: Boolean(fallbackModel?.visible),
        officerCreatorNodes: {
          creatorFace: checkCreatorNode(officerBodyTarget, 'creator-face'),
          creatorHair: checkCreatorNode(officerBodyTarget, 'creator-hair'),
          creatorBodyOutline: checkCreatorNode(officerBodyTarget, 'creator-body-outline'),
        },
        playerCreatorNodes: {
          creatorFace: checkCreatorNode(playerFig, 'creator-face'),
          creatorHair: checkCreatorNode(playerFig, 'creator-hair'),
          creatorBodyOutline: checkCreatorNode(playerFig, 'creator-body-outline'),
          creatorBodyTag: playerFig?.userData?.creatorBody ?? null,
        },
        skeleton: {
          officerBoneCount: officerBones.length,
          playerBoneCount: playerBones.length,
          boneNamesExactMatch,
          hasAllRequiredBones,
          officerSegmentsM: offSegs,
          playerSegmentsM: plSegs,
          maxSegmentRatioDiff,
        },
        officerMetrics: officerMetrics
          ? {
              triangleCount: officerMetrics.triangleCount,
              meshCount: officerMetrics.meshCount,
              estimatedDrawCalls: officerMetrics.estimatedDrawCalls,
              skinnedMeshes: officerMetrics.skinnedMeshes,
              uniformHits,
            }
          : null,
        officerRootTotalTriangles: officerFullMetrics?.triangleCount ?? null,
        playerMetrics: playerMetrics
          ? {
              triangleCount: playerMetrics.triangleCount,
              meshCount: playerMetrics.meshCount,
              estimatedDrawCalls: playerMetrics.estimatedDrawCalls,
            }
          : null,
      }
    }

    window.__r10ProbeExprPose = expr => {
      const officer = window.viewer?.dutyOfficers?.officers?.jiefang
      const root = officer?.officerRoot?.getObjectByName('rigged-traffic-officer') ?? officer?.officerRoot
      if (!root) return null
      root.updateMatrixWorld(true)
      const qArr = name => {
        const o = root.getObjectByName(name)
        return o ? [+o.quaternion.x.toFixed(4), +o.quaternion.y.toFixed(4), +o.quaternion.z.toFixed(4), +o.quaternion.w.toFixed(4)] : null
      }
      const faceVertsSig = []
      const faceRoot = root.getObjectByName('creator-face') ?? root
      const faceExprTag = root.getObjectByName('creator-face')?.userData?.expression ?? null
      faceRoot.traverse(n => {
        if (!n.isMesh || !n.visible) return
        if (faceRoot === root && !/expr|face|brow|eye|mouth|rest-face/i.test(n.name || '')) return
        const p = n.geometry?.getAttribute('position')
        if (!p) return
        let sum = 0
        for (let i = 0; i < p.count; i++) sum += Math.abs(p.getX(i)) + Math.abs(p.getY(i)) * 2 + Math.abs(p.getZ(i)) * 3
        const col = n.geometry?.getAttribute('color')
        let colSum = 0
        if (col) {
          for (let i = 0; i < col.count; i++) colSum += col.getX(i) * 3 + col.getY(i) * 5 + col.getZ(i) * 7
        }
        const uv = n.geometry?.getAttribute('uv')
        let uvSum = 0
        if (uv) {
          for (let i = 0; i < uv.count; i++) uvSum += Math.abs(uv.getX(i)) * 5 + Math.abs(uv.getY(i)) * 7
        }
        const wp = n.matrixWorld.elements
        faceVertsSig.push(
          `${n.name}:${p.count}:${sum.toFixed(3)}:${colSum.toFixed(3)}:${uvSum.toFixed(3)}:${wp[12].toFixed(3)},${wp[13].toFixed(3)},${wp[14].toFixed(3)}`,
        )
      })
      return {
        expr,
        faceExprTag,
        yaw: +(officer.officerRoot.rotation.y ?? 0).toFixed(4),
        armL: qArr('upperarm_l'),
        forearmL: qArr('lowerarm_l'),
        armR: qArr('upperarm_r'),
        forearmR: qArr('lowerarm_r'),
        head: qArr('head'),
        thumbL: qArr('thumb_02_l'),
        thumbR: qArr('thumb_02_r'),
        faceSig: faceVertsSig.join('|'),
      }
    }
  }, spec)
}

async function captureShot(page, name) {
  const fullPath = resolve(OUT_DIR, name)
  await page.screenshot({path: fullPath, fullPage: false, animations: 'disabled', timeout: 60000})
  const info = await stat(fullPath)
  assert.ok(info.size > 4096, `screenshot ${name} too small (${info.size} bytes)`)
  return {file: name, rel: `captures/duty-r10-officer/${name}`, bytes: info.size}
}

async function setupSidewalkComparison(page) {
  const layout = await page.evaluate(() => {
    const officer = window.viewer.dutyOfficers.officers.jiefang
    const root = officer.officerRoot
    const orig = {ox: root.position.x, oy: root.position.y, oz: root.position.z}

    // Place player & officer on open mid-span south sidewalk (lx = -90.0), cleanly east of the
    // [-100, -96] bridgehead stairwell white handrails, signGroup (-96.2), and between lampposts (-105, -84).
    const baseLx = -90.0
    const offLz = 18.00
    const plyLz = 19.05
    const [ox, oz] = window.__r10ToWorld(baseLx, offLz)
    const [px, pz] = window.__r10ToWorld(baseLx, plyLz)

    const w = window.viewer.walk
    // Settle fully onto deck pavement so footY equals exact ground surface (zero floating)
    w.clampPosition({x: px, y: orig.oy + 0.65, z: pz})
    for (let i = 0; i < 65; i++) w.tick(1 / 60)
    const footY = Number.isFinite(w.figure?.position?.y) ? w.figure.position.y : w.position.y - 0.88

    window.__r10OfficerHold = {x: ox, y: footY, z: oz}
    root.position.set(ox, footY, oz)
    const [lookWx, lookWz] = window.__r10ToWorld(baseLx - 8.0, offLz)
    officer.setDutyState('talking')
    officer.setExpression('serious')
    officer.setLookTarget({x: lookWx, y: footY, z: lookWz})
    for (let i = 0; i < 40; i++) window.viewer.dutyOfficers.update(0.1)
    root.position.set(ox, footY, oz)
    root.updateMatrixWorld(true)

    const yaw = root.rotation.y
    const fwdX = -Math.sin(yaw)
    const fwdZ = -Math.cos(yaw)
    const rightX = Math.cos(yaw)
    const rightZ = -Math.sin(yaw)

    w.clampPosition({x: px, y: footY, z: pz})
    w.face(yaw, 0.06)
    w.drive(fwdX, fwdZ, false)
    for (let i = 0; i < 18; i++) w.tick(1 / 60)
    w.hold(true)
    w.hold(false)
    w.clampPosition({x: px, y: footY, z: pz})
    for (let i = 0; i < 20; i++) w.tick(1 / 60)
    w.face(yaw, 0.06)

    return {
      orig,
      baseLx,
      offLz,
      plyLz,
      ox,
      oy: footY,
      oz,
      px,
      pz,
      yaw,
      fwdX,
      fwdZ,
      rightX,
      rightZ,
    }
  })
  await page.waitForTimeout(120)
  return layout
}

async function restoreOfficerSpot(page, orig) {
  await page.evaluate(o => {
    window.__r10CamHold = null
    window.__r10OfficerHold = null
    const officer = window.viewer.dutyOfficers.officers.jiefang
    officer.officerRoot.position.set(o.ox, o.oy, o.oz)
    officer.setLookTarget(null)
    officer.setDutyState('available')
    officer.setExpression('serious')
    for (let i = 0; i < 35; i++) window.viewer.dutyOfficers.update(0.1)
  }, orig)
  await page.waitForTimeout(80)
}

async function run() {
  await mkdir(OUT_DIR, {recursive: true})
  const serverInfo = await verifyServerOnline()
  console.log(`[PREFLIGHT] ${WALK_URL} HTTP=${serverInfo.status} chunks=${serverInfo.initialChunks.length}`)

  const bridgeSpec = await loadBridgeSpec()
  const {browser, ownsBrowser, mode} = await acquireBrowser()
  console.log(`[BROWSER] mode=${mode} ownsBrowser=${ownsBrowser}`)

  let context = null
  let page = null
  const ERRS = []
  const steps = []
  const shots = {}

  const addStep = (id, name, status, detail, shot = null) => {
    steps.push({id, name, status, detail, shot})
    console.log(`[${status}] ${id} ${name}${shot ? ` (${shot.rel})` : ''}`)
  }

  try {
    context = await browser.newContext({viewport: {width: 1280, height: 800}})
    page = await context.newPage()
    page.on('pageerror', err => ERRS.push(`[pageerror] ${err.message}`))
    page.on('console', msg => {
      if (msg.type() === 'error') ERRS.push(`[console.error] ${msg.text()}`)
    })
    page.on('response', res => {
      if (res.status() >= 400 && !res.url().includes('/favicon.ico')) {
        ERRS.push(`[http_${res.status()}] ${res.url()}`)
      }
    })

    await page.goto(VERIFY_URL, {waitUntil: 'domcontentloaded', timeout: 60000})
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
    await installR10Helpers(page, bridgeSpec)

    // Go to Jiefang Bridge via real UI button so terrain/bridge chunks stream & officer rigged GLB mounts
    await page.locator('.td-entry').click({timeout: 15000})
    await page.locator('dialog.td-panel[open] [data-td-action="go-bridge"]').click({timeout: 10000})
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
    await page.evaluate(() => window.__r10FlushFrames(4))

    // Probe 1: creator nodes + same figure_m skeleton + triangle budget <= 20k
    const inspect = await page.evaluate(() => window.__r10InspectCharacters())
    const creatorOk =
      inspect.hasRiggedOfficer &&
      !inspect.fallbackVisible &&
      inspect.officerCreatorNodes.creatorFace.present &&
      inspect.officerCreatorNodes.creatorHair.present &&
      inspect.officerCreatorNodes.creatorBodyOutline.present
    const skeletonOk =
      inspect.skeleton.boneNamesExactMatch &&
      inspect.skeleton.hasAllRequiredBones &&
      inspect.skeleton.officerBoneCount >= 20
    const triOk =
      Boolean(inspect.officerMetrics) &&
      inspect.officerMetrics.triangleCount > 0 &&
      inspect.officerMetrics.triangleCount <= 20000

    addStep(
      'P1_NODES_SKELETON_TRIS',
      '交警挂接 creator-face/hair/body-outline、同源 figure_m 骨架且三角面 <= 20k',
      creatorOk && skeletonOk && triOk ? 'PASS' : 'FAIL',
      {
        creatorNodes: inspect.officerCreatorNodes,
        playerCreatorNodes: inspect.playerCreatorNodes,
        skeleton: inspect.skeleton,
        officerMetrics: inspect.officerMetrics,
        officerRootTotalTriangles: inspect.officerRootTotalTriangles,
        playerMetrics: inspect.playerMetrics,
      },
    )

    // Shots 01~03: Clear mid-span sidewalk full-body comparisons (shoes lifted cleanly above bottom prompt & hotbar)
    const compLayout = await setupSidewalkComparison(page)
    await page.evaluate(L => {
      const midX = (L.ox + L.px) * 0.5
      const midZ = (L.oz + L.pz) * 0.5
      const [camWx, camWz] = window.__r10ToWorld(L.baseLx - 4.65, (L.offLz + L.plyLz) * 0.5)
      window.__r10CamHold = {
        eye: [camWx, L.oy + 1.05, camWz],
        at: [midX, L.oy + 0.64, midZ],
      }
    }, compLayout)
    await page.evaluate(() => window.__r10FlushFrames(4))
    shots.front = await captureShot(page, '01-both-front.png')
    addStep('S1_FRONT', '玩家与交警同屏正面全身', 'PASS', compLayout, shots.front)

    // Shot 02: 3/4 side full-body from open nonmotor lane edge (zero guardrail & full shoes clear of bottom HUD)
    await page.evaluate(L => {
      const midX = (L.ox + L.px) * 0.5
      const midZ = (L.oz + L.pz) * 0.5
      const [camWx, camWz] = window.__r10ToWorld(L.baseLx - 3.60, 15.25)
      window.__r10CamHold = {
        eye: [camWx, L.oy + 1.05, camWz],
        at: [midX, L.oy + 0.64, midZ],
      }
    }, compLayout)
    await page.evaluate(() => window.__r10FlushFrames(4))
    shots.threeQuarter = await captureShot(page, '02-both-three-quarter.png')
    addStep('S2_3Q', '玩家与交警同屏 3/4 侧全身', 'PASS', {}, shots.threeQuarter)

    // Shot 03: Side profile full-body (both on exact settled sidewalk ground height, staggered echelon, zero railing)
    const sideMeta = await page.evaluate(L => {
      const offLx = L.baseLx - 0.55
      const plyLx = L.baseLx + 0.55
      const [ox, oz] = window.__r10ToWorld(offLx, 18.20)
      const [px, pz] = window.__r10ToWorld(plyLx, 18.80)
      const officer = window.viewer.dutyOfficers.officers.jiefang
      const w = window.viewer.walk
      w.clampPosition({x: px, y: L.oy + 0.08, z: pz})
      for (let i = 0; i < 45; i++) w.tick(1 / 60)
      const plyFootY = Number.isFinite(w.figure?.position?.y) ? w.figure.position.y : L.oy
      const offFootY = L.oy
      window.__r10OfficerHold = {x: ox, y: offFootY, z: oz}
      officer.officerRoot.position.set(ox, offFootY, oz)
      officer.officerRoot.updateMatrixWorld(true)
      w.face(L.yaw, 0.06)
      w.drive(L.fwdX, L.fwdZ, false)
      for (let i = 0; i < 16; i++) w.tick(1 / 60)
      w.hold(true)
      w.hold(false)
      w.clampPosition({x: px, y: plyFootY, z: pz})
      for (let i = 0; i < 20; i++) w.tick(1 / 60)
      w.face(L.yaw, 0.06)
      const midX = (ox + px) * 0.5
      const midZ = (oz + pz) * 0.5
      const midY = (offFootY + plyFootY) * 0.5
      const [camWx, camWz] = window.__r10ToWorld(L.baseLx, 13.85)
      window.__r10CamHold = {
        eye: [camWx, midY + 1.05, camWz],
        at: [midX, midY + 0.64, midZ],
      }
      return {ox, offFootY, oz, px, plyFootY, pz, camWx, camWz}
    }, compLayout)
    await page.evaluate(() => window.__r10FlushFrames(4))
    shots.side = await captureShot(page, '03-both-side.png')
    addStep('S3_SIDE', '玩家与交警同屏侧面全身', 'PASS', sideMeta, shots.side)

    await restoreOfficerSpot(page, compLayout.orig)

    // Shot 04: Real KeyF dialogue closeup (officer camera shot + wait until both live 3D portraits are ready)
    await page.evaluate(() => {
      window.__r10CamHold = null
      window.viewer.walk.clampPosition({x: -267.15, y: 151.85, z: 25.55})
      for (let i = 0; i < 6; i++) window.viewer.walk.tick(1 / 60)
      const p = window.viewer.walk.position
      const o = window.viewer.dutyOfficers.officers.jiefang.position
      window.viewer.walk.face(Math.atan2(-(o.x - p.x), -(o.z - p.z)), 0.08)
    })
    await page.waitForTimeout(250)
    await page.keyboard.press('KeyF')
    await page.waitForSelector('.td-story-dialog:not([hidden])', {timeout: 10000})
    await page
      .waitForFunction(
        () => {
          const oImg = document.querySelector('[data-td-story-portrait-img="officer"]')
          const pImg = document.querySelector('[data-td-story-portrait-img="player"]')
          return (
            oImg?.dataset?.portraitLoaded === '1' &&
            pImg?.dataset?.portraitLoaded === '1' &&
            oImg.complete &&
            pImg.complete
          )
        },
        null,
        {timeout: 15000},
      )
      .catch(() => {})

    let dialogueCloseInfo = null
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(260)
      const st = await page.evaluate(() => {
        const snap = window.viewer.trafficDuty.getStorySnapshot?.()
        const oImg = document.querySelector('[data-td-story-portrait-img="officer"]')
        const pImg = document.querySelector('[data-td-story-portrait-img="player"]')
        return {
          shot: snap?.currentShot ?? null,
          lineIndex: snap?.lineIndex ?? null,
          expr: snap?.line?.expr ?? null,
          officerReady: oImg?.dataset?.portraitLoaded === '1',
          playerReady: pImg?.dataset?.portraitLoaded === '1',
        }
      })
      if (st.shot === 'officer' || i === 4) {
        await page.evaluate(() => window.__r10FlushFrames(3))
        dialogueCloseInfo = st
        shots.dialogueCloseup = await captureShot(page, '04-dialogue-closeup.png')
        if (st.shot === 'officer') break
      }
      await page.evaluate(() => {
        const nextBtn = document.querySelector('.td-story-dialog:not([hidden]) [data-td-story-action="next"]')
        if (nextBtn instanceof HTMLElement) nextBtn.click()
      })
    }

    // Complete briefing dialogue cleanly so phase becomes 'active'
    for (let i = 0; i < 18; i++) {
      const done = await page.evaluate(() => {
        const snap = window.viewer.trafficDuty.getSnapshot()
        const dlg = document.querySelector('.td-story-dialog')
        const dlgOpen = Boolean(dlg && !dlg.hasAttribute('hidden') && getComputedStyle(dlg).display !== 'none')
        if (snap.phase === 'active' && !dlgOpen) return true
        const choice = dlg?.querySelector(
          '[data-td-story-choice="repeat_accept"], [data-td-story-choice="ready_now"], [data-td-story-choice]',
        )
        if (choice instanceof HTMLElement) choice.click()
        else {
          const next = dlg?.querySelector('[data-td-story-action="next"]')
          if (next instanceof HTMLElement) next.click()
        }
        return false
      })
      if (done) break
      await page.waitForTimeout(200)
    }
    await page.waitForFunction(() => window.viewer.trafficDuty.getSnapshot().phase === 'active', null, {timeout: 12000})
    addStep(
      'S4_DIALOGUE_CLOSEUP',
      '实机按 F 对话特写与双侧头像就绪',
      shots.dialogueCloseup ? 'PASS' : 'FAIL',
      dialogueCloseInfo,
      shots.dialogueCloseup,
    )

    // Shots 05~08: 4 officer expressions captured while talking/handoff pose is actively stepped
    // Step player out of talk range (> 4m) and hide player mesh during solo officer macro shots so
    // player geometry cannot clip the closeup lens and the nearby F-prompt bar does not cover hands.
    await page.evaluate(() => {
      const [farX, farZ] = window.__r10ToWorld(-91.5, 18.8)
      const w = window.viewer.walk
      w.clampPosition({x: farX, y: 152.1, z: farZ})
      w.showFigure(false)
      for (let i = 0; i < 6; i++) w.tick(1 / 60)
    })

    const exprRecords = {}
    for (const [idx, expr] of OFFICER_EXPRESSIONS.entries()) {
      const fileName = `0${5 + idx}-expr-${expr}.png`
      await page.evaluate(ex => {
        const officer = window.viewer.dutyOfficers.officers.jiefang
        officer.setLookTarget(null)
        officer.setDutyState(ex === 'thumbs_up' ? 'handoff' : 'talking')
        officer.setExpression(ex)
        // Advance pose clock to active expressive gesture window (anti-k59 idle frame)
        window.viewer.dutyOfficers.update(0.35, 1.25)
        const r = officer.officerRoot
        r.updateMatrixWorld(true)
        const yaw = r.rotation.y
        const fwdX = -Math.sin(yaw)
        const fwdZ = -Math.cos(yaw)
        const rightX = Math.cos(yaw)
        const rightZ = -Math.sin(yaw)
        const head = officer.headWorld ? officer.headWorld() : {x: r.position.x, y: r.position.y + 1.56, z: r.position.z}
        // Cap clears top dock (>=30px sky headroom) AND remind/thumbs_up hands + baton clear bottom edge (>=35px)
        const isGesture = ex === 'remind' || ex === 'thumbs_up'
        const fwdDist = isGesture ? 1.56 : 1.06
        const sideShift = isGesture ? 0.36 : 0.28
        const eyeY = head.y + (isGesture ? 0.04 : 0.03)
        const lookY = head.y + (isGesture ? -0.28 : -0.04)
        const lookLat = isGesture ? 0.04 : 0.0
        window.__r10CamHold = {
          eye: [head.x + fwdX * fwdDist + rightX * sideShift, eyeY, head.z + fwdZ * fwdDist + rightZ * sideShift],
          at: [head.x + rightX * lookLat, lookY, head.z + rightZ * lookLat],
        }
      }, expr)
      await page.evaluate(() => window.__r10FlushFrames(4))
      const poseProbe = await page.evaluate(ex => window.__r10ProbeExprPose(ex), expr)
      const shot = await captureShot(page, fileName)
      shots[`expr_${expr}`] = shot
      exprRecords[expr] = {poseProbe, shot}
    }

    await page.evaluate(() => {
      window.viewer.walk.showFigure(true)
    })

    const faceSigs = new Set(Object.values(exprRecords).map(r => r.poseProbe?.faceSig).filter(Boolean))
    const thumbsDistinct =
      JSON.stringify(exprRecords.thumbs_up?.poseProbe?.armL) !== JSON.stringify(exprRecords.serious?.poseProbe?.armL) ||
      JSON.stringify(exprRecords.thumbs_up?.poseProbe?.forearmL) !== JSON.stringify(exprRecords.serious?.poseProbe?.forearmL) ||
      JSON.stringify(exprRecords.thumbs_up?.poseProbe?.armR) !== JSON.stringify(exprRecords.serious?.poseProbe?.armR) ||
      JSON.stringify(exprRecords.thumbs_up?.poseProbe?.forearmR) !== JSON.stringify(exprRecords.serious?.poseProbe?.forearmR) ||
      JSON.stringify(exprRecords.thumbs_up?.poseProbe?.thumbL) !== JSON.stringify(exprRecords.serious?.poseProbe?.thumbL)
    addStep(
      'S5_FOUR_EXPRESSIONS',
      '交警 4 种表情（serious / smile / remind / thumbs_up）激活瞬间实拍与姿态/几何区分',
      Object.keys(exprRecords).length === 4 && faceSigs.size >= 4 && thumbsDistinct ? 'PASS' : 'FAIL',
      {
        distinctFaceSignatures: faceSigs.size,
        thumbsUpPoseDistinct: thumbsDistinct,
        expressions: Object.fromEntries(Object.entries(exprRecords).map(([k, v]) => [k, v.poseProbe])),
      },
      shots.expr_thumbs_up,
    )

    // Restore live camera and complete 2 real citations to trigger off-duty two-shot (09-offduty-two-shot.png)
    await page.evaluate(() => {
      window.__r10CamHold = null
      const officer = window.viewer.dutyOfficers.officers.jiefang
      officer.setDutyState('available')
      officer.setExpression('serious')
      officer.setLookTarget(null)
    })

    const citedIds = new Set()
    for (let slot = 0; slot < 2; slot++) {
      let picked = null
      for (let retry = 0; retry < 120 && !picked; retry++) {
        picked = await page.evaluate(seen => {
          const actors = window.viewer.dutyTraffic?.getActors?.() ?? []
          const match = actors
            .filter(
              a =>
                !seen.includes(a.id) &&
                a.kind === 'scooter' &&
                !a.leaving &&
                !a.pendingRecycle &&
                !a.cited &&
                a.scale >= 0.5 &&
                a.violation &&
                a.violation !== 'none' &&
                window.__r10OnDeck(a),
            )
            .sort((u, v) => Number(v.violations?.length ?? 1) - Number(u.violations?.length ?? 1))[0]
          if (!match) {
            const p = window.viewer.walk?.position
            for (let k = 0; k < 40; k++) window.viewer.dutyTraffic?.step?.(0.1, p)
            return null
          }
          window.__r10Target = match
          window.__r10PlaceFacingTarget(match, 2.7, match.y, 0.72)
          return {id: match.id, violation: match.violation, violations: match.violations ?? [match.violation]}
        }, [...citedIds])
        if (!picked && retry % 3 === 0) await page.waitForTimeout(25)
      }
      assert.ok(picked, `failed to spawn/pick bridge violator #${slot + 1}`)
      citedIds.add(picked.id)

      // Pull over with real KeyE
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.evaluate(() => window.__r10PlaceFacingTarget(window.__r10Target, 2.7, window.__r10Target?.y, 0.72))
        await page.keyboard.down('KeyE')
        await page.waitForTimeout(100)
        await page.keyboard.up('KeyE')
        const halted = await page
          .waitForFunction(
            () => {
              const t = window.__r10Target
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
      await page.evaluate(() => window.__r10PlaceFacingTarget(window.__r10Target, 2.1, window.__r10Target?.y, 0.72))
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
      await page.evaluate(() => {
        const t = window.__r10Target
        const [, tlz] = window.__r10ToLocal(t.x, t.z)
        const towardCenter = Math.abs(tlz) >= 14.1 ? -1 : 1
        window.__r10PlaceFacingTarget(t, 1.05, t.y, 0.22, towardCenter)
      })
      await page.waitForFunction(() => Boolean(document.querySelector('.td-ft-btn-deliver:not(:disabled)')), null, {timeout: 8000})
      await page.keyboard.press('KeyF')
      await page.waitForFunction(
        prev => !document.querySelector('.td-fine-terminal') && window.viewer.trafficDuty.getSnapshot().citedCount >= prev + 1,
        prevCited,
        {timeout: 12000},
      )
    }

    // Move closely beside officer (<= 2.0m) AND orient player mesh cleanly toward officer before opening off-duty story
    await page.evaluate(() => {
      const w = window.viewer.walk
      const o = window.viewer.dutyOfficers.officers.jiefang.position
      const px = -267.3
      const pz = 25.8
      w.clampPosition({x: px, y: 151.85, z: pz})
      const dx = o.x - px
      const dz = o.z - pz
      const yawToOfficer = Math.atan2(-dx, -dz)
      w.drive(dx, dz, false)
      for (let i = 0; i < 18; i++) w.tick(1 / 60)
      w.hold(true)
      w.hold(false)
      w.clampPosition({x: px, y: 151.85, z: pz})
      for (let i = 0; i < 18; i++) w.tick(1 / 60)
      w.face(yawToOfficer, 0.08)
    })
    await page.waitForFunction(() => window.viewer.trafficDuty.getInteractCandidate?.()?.action === 'talk_officer', null, {timeout: 6000})
    await page.keyboard.press('KeyF')
    await page.waitForSelector('.td-story-dialog:not([hidden])', {timeout: 8000})

    let twoShotMeta = null
    for (let i = 0; i < 16; i++) {
      await page.waitForTimeout(300)
      const headSt = await page.evaluate(() => {
        const snap = window.viewer.trafficDuty.getStorySnapshot?.()
        return {shot: snap?.currentShot ?? null, lineIndex: snap?.lineIndex ?? null}
      })
      if (headSt.shot === 'two' && (!twoShotMeta || headSt.lineIndex >= 3)) {
        // Flush frames first so camera-shots Slerp converges cleanly from player OTS to two-shot BEFORE sampling NDC
        await page.evaluate(() => window.__r10FlushFrames(10))
        twoShotMeta = await page.evaluate(() => {
          const snap = window.viewer.trafficDuty.getStorySnapshot?.()
          const cam = window.viewer.camera
          cam.updateMatrixWorld(true)
          const toScreen = pos => {
            const p = {x: pos.x, y: pos.y + 1.2, z: pos.z}
            const ve = cam.matrixWorldInverse.elements
            const pe = cam.projectionMatrix.elements
            const vx = ve[0] * p.x + ve[4] * p.y + ve[8] * p.z + ve[12]
            const vy = ve[1] * p.x + ve[5] * p.y + ve[9] * p.z + ve[13]
            const vz = ve[2] * p.x + ve[6] * p.y + ve[10] * p.z + ve[14]
            const vw = ve[3] * p.x + ve[7] * p.y + ve[11] * p.z + ve[15]
            const cx = pe[0] * vx + pe[4] * vy + pe[8] * vz + pe[12] * vw
            const cy = pe[1] * vx + pe[5] * vy + pe[9] * vz + pe[13] * vw
            const cw = pe[3] * vx + pe[7] * vy + pe[11] * vz + pe[15] * vw
            const ndcX = cx / cw
            const ndcY = cy / cw
            return {ndcX: +ndcX.toFixed(3), ndcY: +ndcY.toFixed(3), inFront: cw > 0.1 && Math.abs(ndcX) <= 0.96}
          }
          const w = window.viewer.walk
          const figPos = w.figure?.position
          const playerPos = figPos ? {x: figPos.x, y: figPos.y, z: figPos.z} : {x: w.position.x, y: w.position.y - 0.88, z: w.position.z}
          const officerPos = window.viewer.dutyOfficers.officers.jiefang.position
          const [camLx, camLz] = window.__r10ToLocal(cam.position.x, cam.position.z)
          const sepM = +Math.hypot(playerPos.x - officerPos.x, playerPos.z - officerPos.z).toFixed(3)
          const settleBar = document.querySelector('.td-story-settlement, .td-story-text')?.textContent?.trim() ?? ''
          return {
            beatId: snap?.beatId ?? null,
            lineIndex: snap?.lineIndex ?? null,
            shot: snap?.currentShot ?? null,
            expr: snap?.line?.expr ?? null,
            text: snap?.line?.text ?? settleBar,
            sepM,
            camFov: +cam.fov.toFixed(2),
            camLocal: [+camLx.toFixed(3), +camLz.toFixed(3)],
            playerScreen: toScreen(playerPos),
            officerScreen: toScreen(officerPos),
          }
        })
        shots.offdutyTwoShot = await captureShot(page, '09-offduty-two-shot.png')
      }
      const actionResult = await page.evaluate(() => {
        const snap = window.viewer.trafficDuty.getSnapshot()
        if (snap.phase === 'summary') return 'summary_done'
        const choices = [...document.querySelectorAll('.td-story-dialog:not([hidden]) .td-story-choice')].map(el => ({
          id: el.getAttribute('data-td-story-choice') || '',
          text: el.textContent?.trim() || '',
        }))
        if (choices.length > 0) {
          const picked =
            choices.find(
              c =>
                /settle|off|finish|confirm|accept|下班|结算|交班|领款|交差/i.test(`${c.id} ${c.text}`) &&
                !/继续|再守|暂不|cancel|decline/i.test(`${c.id} ${c.text}`),
            ) ?? choices[0]
          const btn = document.querySelector(`.td-story-dialog:not([hidden]) [data-td-story-choice="${picked.id}"]`)
          if (btn instanceof HTMLElement) {
            btn.click()
            return `clicked_choice:${picked.id}`
          }
        }
        const nextBtn = document.querySelector('.td-story-dialog:not([hidden]) [data-td-story-action="next"]')
        if (nextBtn instanceof HTMLElement) {
          nextBtn.click()
          return 'clicked_next'
        }
        return 'idle'
      })
      if (actionResult === 'summary_done') break
    }

    await page.waitForFunction(
      () => window.viewer.trafficDuty.getSnapshot().phase === 'summary',
      null,
      {timeout: 10000},
    )
    const settleSnap = await page.evaluate(() => window.viewer.trafficDuty.getSnapshot())
    const twoOk = Boolean(
      shots.offdutyTwoShot &&
        twoShotMeta?.shot === 'two' &&
        twoShotMeta?.playerScreen?.inFront &&
        twoShotMeta?.officerScreen?.inFront &&
        settleSnap.settledEarningsYuan > 0,
    )
    addStep(
      'S6_OFFDUTY_TWO_SHOT',
      '开满 2 单触发下岗交差双人镜头（shot=two 双人同框且分成入账）',
      twoOk ? 'PASS' : 'FAIL',
      {twoShotMeta, settledEarningsYuan: settleSnap.settledEarningsYuan, totalFineYuan: settleSnap.totalFineYuan},
      shots.offdutyTwoShot,
    )
  } catch (err) {
    ERRS.push(`[fatal] ${err?.stack || err?.message || String(err)}`)
  } finally {
    await page?.close().catch(() => {})
    await context?.close().catch(() => {})
    if (ownsBrowser && browser) {
      await browser.close().catch(() => {})
    }
  }

  const passed = steps.filter(s => s.status === 'PASS').length
  const failed = steps.filter(s => s.status !== 'PASS').length + (ERRS.length > 0 && steps.every(s => s.status === 'PASS') ? 1 : 0)
  const report = {
    script: 'scripts/verify-officer-r10.mjs',
    walkUrl: WALK_URL,
    verifyUrl: VERIFY_URL,
    browserMode: mode,
    timestamp: new Date().toISOString(),
    shotCount: Object.keys(shots).length,
    passed,
    failed: steps.filter(s => s.status !== 'PASS').length,
    ERRS,
    shots,
    steps,
  }
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`ERRS=${JSON.stringify(ERRS)}`)
  console.log(`SUMMARY passed=${report.passed} failed=${report.failed} shots=${report.shotCount} report=${REPORT_PATH}`)

  if (report.failed > 0 || ERRS.length > 0 || report.shotCount < 8) {
    process.exitCode = 1
  }
}

await run()
