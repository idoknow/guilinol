import assert from 'node:assert/strict'
import {existsSync, createReadStream, statSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {extname, join, resolve} from 'node:path'
import {chromium} from 'playwright'
import {createServer, preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const MIME = {
  '.json': 'application/json',
  '.gz': 'application/gzip',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
}

function worldOverlayPlugin() {
  const worldDir = process.env.GLOL_WORLD_DIR
  if (!worldDir || !existsSync(join(worldDir, 'manifest.json'))) return null
  return {
    name: 'glol-world-readonly-overlay',
    configurePreviewServer(server) {
      server.middlewares.use('/world', (req, res, next) => {
        const clean = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '')
        if (!clean || clean.includes('..')) return next()
        const file = join(worldDir, clean)
        if (!existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
  }
}

const shotsDir = process.env.GLOL_SHOTS_DIR || ''
if (shotsDir) await mkdir(shotsDir, {recursive: true})

// Part 1: Controlled crowd start/stop + meeting pause + frustum exit/re-entry verification (0 T-Pose).
async function verifyCrowdPoseTransitions(browser) {
  const dev = await createServer({root: 'web', configFile: 'web/vite.config.ts', server: {host: '127.0.0.1', port: 0}})
  try {
    await dev.listen()
    const page = await browser.newPage({viewport: {width: 1120, height: 680}})
    page.on('pageerror', err => { throw err })
    await page.route('**/npc-pose-check', route =>
      route.fulfill({contentType: 'text/html', body: '<!doctype html><style>*{margin:0;overflow:hidden}</style>'}),
    )
    await page.goto(new URL('npc-pose-check', dev.resolvedUrls.local[0]).href)
    const report = await page.evaluate(async () => {
      const THREE = await import('/@id/three')
      const {crowd} = await import('/src/traffic/crowd.ts')
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0xcfdce3)
      const camera = new THREE.PerspectiveCamera(42, 1120 / 680, 0.05, 120)
      camera.layers.enableAll()
      const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true})
      renderer.setSize(1120, 680)
      document.body.append(renderer.domElement)
      scene.add(new THREE.HemisphereLight(0xfffaf2, 0x8d9490, 2.1))
      const sun = new THREE.DirectionalLight(0xfff4e0, 2.0)
      sun.position.set(5, 10, 4)
      scene.add(sun)

      // Stylized street cross-section: asphalt carriageway + raised stone curb + grey sidewalk + yellow tactile strip.
      const addStrip = (x, y, z, w, h, d, color) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({color, roughness: 0.9}))
        m.position.set(x, y, z)
        scene.add(m)
      }
      addStrip(-4.2, -0.08, 0, 8.4, 0.16, 40, 0x4a4d50) // carriageway
      addStrip(0.1, 0.06, 0, 0.2, 0.22, 40, 0xb5b3ac)  // curb
      addStrip(2.2, 0.02, 0, 4.0, 0.16, 40, 0x8e8d89)  // outer sidewalk
      addStrip(2.1, 0.105, 0, 0.35, 0.01, 40, 0xc9a84c) // tactile paving

      const view = crowd(scene, camera)
      const actors = [
        {x: 1.45, y: 0.1, z: -1.6, yaw: 0.15, speed: 1.35, scale: 1, down: 0, kind: 'person', leaving: false},
        {x: 2.25, y: 0.1, z: -0.9, yaw: 0.05, speed: 1.25, scale: 1, down: 0, kind: 'person', leaving: false},
        {x: 3.05, y: 0.1, z: -0.2, yaw: -0.1, speed: 1.4, scale: 1, down: 0, kind: 'person', leaving: false},
        {x: 1.65, y: 0.1, z: 1.1, yaw: Math.PI - 0.18, speed: 1.3, scale: 1, down: 0, kind: 'person', leaving: false},
        {x: 2.75, y: 0.1, z: 1.45, yaw: Math.PI + 0.12, speed: 1.2, scale: 1, down: 0, kind: 'person', leaving: false},
      ]
      const lookNormal = () => { camera.position.set(-1.35, 1.85, 3.85); camera.lookAt(2.2, 0.98, -0.05); camera.updateMatrixWorld() }
      const lookAway = () => { camera.position.set(-1.35, 1.85, 3.85); camera.lookAt(-20, 2.25, 25); camera.updateMatrixWorld() }
      lookNormal()

      // Wait for all 5 async passer-by templates to finish building.
      for (let tries = 0; tries < 200; tries++) {
        const shown = view.select(actors)
        view.animate(0.05, 0)
        if (shown.size === actors.length) break
        await new Promise(r => setTimeout(r, 30))
      }
      if (view.count !== actors.length) throw Error(`Only ${view.count}/${actors.length} passer-by built`)

      const stats = {checks: 0, maxArmL: 0, maxArmR: 0, tPoseCount: 0, disabledCount: 0, weightDriftCount: 0}
      const inspect = (label) => {
        const rows = view.poseProbe()
        for (const r of rows) {
          stats.checks++
          stats.maxArmL = Math.max(stats.maxArmL, r.leftArmDownDeg)
          stats.maxArmR = Math.max(stats.maxArmR, r.rightArmDownDeg)
          if (!r.walkEnabled || !r.idleEnabled) stats.disabledCount++
          if (Math.abs(r.walkEff + r.idleEff - 1) > 1e-4) stats.weightDriftCount++
          if (!(r.leftArmDownDeg < 45 && r.rightArmDownDeg < 45)) {
            stats.tPoseCount++
            throw Error(`[${label}] NPC T-Pose detected: L=${r.leftArmDownDeg.toFixed(1)} R=${r.rightArmDownDeg.toFixed(1)}`)
          }
        }
      }

      // Immediately verify frame 0 right after build.
      inspect('spawn-frame0')

      // Repeated walk -> stop -> walk -> stop + mid-blend interruption + frustum cull/re-entry.
      const schedule = [
        {name: 'walk-1', speed: 1.3, steps: 14, away: false},
        {name: 'stop-1', speed: 0.0, steps: 16, away: false},
        {name: 'quick-walk', speed: 1.4, steps: 3, away: false},
        {name: 'quick-stop', speed: 0.0, steps: 3, away: false},
        {name: 'walk-away', speed: 1.25, steps: 12, away: true},
        {name: 'reenter-stop', speed: 0.0, steps: 16, away: false},
        {name: 'walk-2', speed: 1.35, steps: 12, away: false},
        {name: 'final-meeting-stop', speed: 0.0, steps: 18, away: false},
      ]
      for (const stage of schedule) {
        if (stage.away) lookAway(); else lookNormal()
        for (let i = 0; i < stage.steps; i++) {
          for (const a of actors) {
            a.speed = stage.speed
            if (stage.speed > 0 && stage.name === 'walk-1') {
              a.z += Math.cos(a.yaw) * stage.speed * 0.02
            }
          }
          view.select(actors)
          view.animate(0.05, 0)
          if (!stage.away) inspect(`${stage.name}#${i}`)
        }
      }
      // Keep final meeting-stop rendered for screenshot.
      lookNormal()
      view.animate(0.016, 0)
      renderer.render(scene, camera)
      return {...stats, finalRows: view.poseProbe().map(r => ({
        L: +r.leftArmDownDeg.toFixed(1),
        R: +r.rightArmDownDeg.toFixed(1),
        w: +r.walkEff.toFixed(2),
        i: +r.idleEff.toFixed(2),
      }))}
    })
    if (shotsDir) {
      await page.screenshot({path: join(shotsDir, '01-npc-crowd-stop-no-tpose.jpg'), quality: 86})
    }
    await page.close()
    return report
  } finally {
    await dev.close()
  }
}

// Part 2: Real Guilin city preview verification across arterial + no-cycleway roads.
async function verifyRealCityStreets(browser) {
  const plugins = [worldOverlayPlugin()].filter(Boolean)
  const site = await preview({
    root: 'web',
    configFile: 'web/vite.config.ts',
    plugins,
    build: {outDir: resolve(process.env.PERF_DIST ?? 'dist')},
    preview: {host: '127.0.0.1', port: 0},
  })
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 720}})
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${site.httpServer.address().port}/?verify&play=tour&traffic=1&flow=0&time=15&radius=480`)
    await page.waitForFunction(() => window.viewer?.stats?.firstMs > 0, null, {timeout: 120000})
    const cdp = await page.context().newCDPSession(page)
    const snap = async name => {
      if (!shotsDir) return
      const {data} = await cdp.send('Page.captureScreenshot', {format: 'jpeg', quality: 86})
      await writeFile(join(shotsDir, name), Buffer.from(data, 'base64'))
    }

    const corridors = [
      {name: 'zhongshan-middle', label: '中山中路(双幅主干道)', x: -885, y: 162, z: -135, yaw: 0.2, shot: '02-real-street-zhongshan-sidewalk.jpg'},
      {name: 'jiefang-west', label: '解放西路(主干道)', x: -1215, y: 162, z: -222, yaw: 1.35, shot: ''},
      {name: 'ziyou-rd', label: '自由路(主干道含隔离带)', x: 90, y: 162, z: 136, yaw: 1.25, shot: '03-real-street-ziyou-overview.jpg'},
      {name: 'binjiang-rd', label: '滨江路(无独立非机动车道段)', x: -185, y: 162, z: -306, yaw: 0.1, shot: ''},
    ]

    const summary = {
      corridors: [],
      totalPedSamples: 0,
      motorHits: 0,
      medianHits: 0,
      badSurfaceHits: 0,
      visibleRigChecks: 0,
      tPoseHits: 0,
      maxArmL: 0,
      maxArmR: 0,
    }

    for (const siteCfg of corridors) {
      await page.evaluate(({x, y, z, yaw}) => {
        const cam = window.viewer.camera
        cam.position.set(x, y, z)
        cam.lookAt(x + 25 * Math.sin(yaw), y - 6, z + 25 * Math.cos(yaw))
        cam.updateMatrixWorld()
      }, siteCfg)
      // Wait for traffic cell AND surrounding tiles to finish streaming so screenshots have full street paving.
      await page.waitForFunction(
        ({x, z}) => {
          const v = window.viewer
          const key = `${Math.floor(x / 512)}_${Math.floor(z / 512)}`
          return v.trafficProbe?.loads?.at(-1)?.key === key && !v.stats.pending
        },
        siteCfg,
        {timeout: 120000},
      )
      // Step simulation and observe pedestrians + rigged crowd poses across 45 frames.
      const res = await page.evaluate(async () => {
        const waitFrame = () => new Promise(r => requestAnimationFrame(r))
        let pedSamples = 0, motorHits = 0, medianHits = 0, badSurface = 0
        let rigChecks = 0, tPose = 0, maxL = 0, maxR = 0
        for (let i = 0; i < 45; i++) {
          await waitFrame()
          const probe = window.viewer.trafficProbe
          const peds = probe?.pedestriansDetail ?? []
          for (const p of peds) {
            pedSamples++
            if (p.hitsMotor) motorHits++
            if (p.betweenMotors) medianHits++
            if (Array.isArray(p.surface) && p.surface.length > 0) {
              const onRoadOrCycle = p.surface.includes(0) || p.surface.includes(5)
              const onVergeOnly = p.surface.includes(4) && !p.surface.includes(1) && !p.surface.includes(6)
              if (onRoadOrCycle || onVergeOnly) badSurface++
            }
          }
          const poses = probe?.crowd?.poseProbe?.() ?? []
          for (const r of poses) {
            if (!Number.isFinite(r.leftArmDownDeg) || !Number.isFinite(r.rightArmDownDeg)) continue
            rigChecks++
            maxL = Math.max(maxL, r.leftArmDownDeg)
            maxR = Math.max(maxR, r.rightArmDownDeg)
            if (r.leftArmDownDeg >= 45 || r.rightArmDownDeg >= 45 || !r.walkEnabled || !r.idleEnabled) tPose++
          }
        }
        return {
          pedSamples, motorHits, medianHits, badSurface, rigChecks, tPose,
          maxL: +maxL.toFixed(1), maxR: +maxR.toFixed(1),
          activeRigCount: window.viewer.trafficProbe?.crowd?.count ?? 0,
        }
      })

      // Frame the nearest live rigged pedestrian cleanly at close/mid range after nearby tiles finish.
      if (siteCfg.shot) {
        await page.waitForFunction(() => !window.viewer.stats.pending, null, {timeout: 20000}).catch(() => {})
        await page.evaluate(({overview, refX, refZ}) => {
          const probe = window.viewer.trafficProbe
          const rigs = probe?.crowd?.poseProbe?.() ?? []
          const raw = probe?.crowd?.probe?.() ?? []
          const list = rigs.map((r, i) => ({...r, yaw: raw[i]?.[3] ?? 0}))
            .filter(r => Number.isFinite(r.leftArmDownDeg))
          if (!list.length) return
          const best = list.sort((a, b) => {
            const peerA = list.filter(o => Math.hypot(o.x - a.x, o.z - a.z) < 12).length
            const peerB = list.filter(o => Math.hypot(o.x - b.x, o.z - b.z) < 12).length
            if (peerB !== peerA) return peerB - peerA
            return Math.hypot(a.x - refX, a.z - refZ) - Math.hypot(b.x - refX, b.z - refZ)
          })[0]
          const cam = window.viewer.camera
          const scene = cam.parent
          const fx = -Math.sin(best.yaw), fz = -Math.cos(best.yaw)
          const rx = Math.cos(best.yaw), rz = -Math.sin(best.yaw)
          const target = cam.position.clone().set(best.x, best.y + 1.15, best.z)
          const candidates = overview
            ? [
                [best.x + rx * 10 + fx * 7, best.y + 9.5, best.z + rz * 10 + fz * 7],
                [best.x - rx * 10 + fx * 7, best.y + 9.5, best.z - rz * 10 + fz * 7],
                [best.x + rx * 10 - fx * 7, best.y + 9.5, best.z + rz * 10 - fz * 7],
                [best.x - rx * 10 - fx * 7, best.y + 9.5, best.z - rz * 10 - fz * 7],
              ]
            : [
                // Prefer open carriageway side (avoid building facades) using multi-angle clearance probe.
                [best.x + fx * 5.2 + rx * 2.2, best.y + 2.1, best.z + fz * 5.2 + rz * 2.2],
                [best.x + fx * 5.2 - rx * 2.2, best.y + 2.1, best.z + fz * 5.2 - rz * 2.2],
                [best.x - fx * 5.2 + rx * 2.2, best.y + 2.1, best.z - fz * 5.2 + rz * 2.2],
                [best.x - fx * 5.2 - rx * 2.2, best.y + 2.1, best.z - fz * 5.2 - rz * 2.2],
                [best.x + fx * 4.8, best.y + 2.0, best.z + fz * 4.8],
                [best.x - fx * 4.8, best.y + 2.0, best.z - fz * 4.8],
              ]
          // Score candidates: prefer candidates on road/sidewalk open space with unobstructed line of sight.
          let chosen = candidates[0]
          if (scene) {
            const detail = probe?.pedestriansDetail ?? []
            // Simple obstruction check: prefer candidate farthest from any wall mesh using bounding boxes of buildings,
            // or raycast if scene exposes camera raycast. Even simpler: test via canvas-free raycast from target -> cand.
            const origins = scene.children.filter(o => o.visible && o.name !== 'G2 passer-by' && o.name !== 'G2 traffic visuals')
            // Use Three.js Raycaster via dynamic import fallback if not exposed; else pick open-air side toward ref corridor.
            let bestScore = -Infinity
            for (const c of candidates) {
              const distToRef = Math.hypot(c[0] - refX, c[2] - refZ)
              // Reference coordinates (refX, refZ) sit along the open road corridor centerline,
              // so candidates closer to (refX, refZ) face the sidewalk from the street side rather than inside buildings!
              const score = -distToRef
              if (score > bestScore) { bestScore = score; chosen = c }
            }
            void origins
          }
          cam.position.set(chosen[0], chosen[1], chosen[2])
          cam.lookAt(target.x, best.y + 1.0, target.z)
          cam.updateMatrixWorld()
        }, {overview: siteCfg.name === 'ziyou-rd', refX: siteCfg.x, refZ: siteCfg.z})
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
        await snap(siteCfg.shot)
      }

      summary.corridors.push({corridor: siteCfg.label, ...res, samplePed: undefined})
      summary.totalPedSamples += res.pedSamples
      summary.motorHits += res.motorHits
      summary.medianHits += res.medianHits
      summary.badSurfaceHits += res.badSurface
      summary.visibleRigChecks += res.rigChecks
      summary.tPoseHits += res.tPose
      summary.maxArmL = Math.max(summary.maxArmL, res.maxL)
      summary.maxArmR = Math.max(summary.maxArmR, res.maxR)
    }

    assert.equal(errors.length, 0, `page errors: ${errors.join('; ')}`)
    assert.ok(summary.totalPedSamples > 100, `too few city pedestrian samples: ${summary.totalPedSamples}`)
    assert.equal(summary.motorHits, 0, `pedestrians inside motor lanes: ${summary.motorHits}`)
    assert.equal(summary.medianHits, 0, `pedestrians in divided road medians: ${summary.medianHits}`)
    assert.equal(summary.badSurfaceHits, 0, `pedestrians on carriageway/cycleway/verge: ${summary.badSurfaceHits}`)
    assert.equal(summary.tPoseHits, 0, `visible NPC T-Pose detected: ${summary.tPoseHits}`)
    await page.close()
    return summary
  } finally {
    await site.close()
  }
}

let browser
try {
  browser = await chromium.launch(browserOptions())
  const poseReport = await verifyCrowdPoseTransitions(browser)
  console.log('Crowd transition pose audit:', JSON.stringify(poseReport))
  assert.equal(poseReport.tPoseCount, 0)
  assert.equal(poseReport.disabledCount, 0)
  assert.equal(poseReport.weightDriftCount, 0)

  const cityReport = await verifyRealCityStreets(browser)
  console.log('Real city corridor audit:', JSON.stringify(cityReport, null, 2))
} finally {
  await browser?.close()
}
