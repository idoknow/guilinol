import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SHOT_DIR = resolve(ROOT, 'captures/duty-3-e2e')
const BASE_ORIGIN = process.env.DUTY_ORIGIN || 'http://127.0.0.1:5176'
const WALK_URL = process.env.DUTY_URL || `${BASE_ORIGIN}/?mode=walk`
const VERIFY_URL = `${BASE_ORIGIN}/?verify&mode=walk`
const CDP_ENDPOINT = process.env.CDP_URL || 'http://127.0.0.1:9222'

const JIEFANG_OUT_OF_BOUNDS = {x: -342.0, z: -18.0, yaw: 0}
const SHIZIJIE_DEFAULT = {x: -855.47, z: -171.47, yaw: 2.15}

async function loadJiefangBridgeSpec() {
  const bundleDir = await mkdtemp(join(tmpdir(), 'glol-verify-duty-'))
  const bundleFile = join(bundleDir, 'railings-spec.mjs')
  await build({
    stdin: {
      contents: `
        export {
          JIEFANG_BRIDGE_ORIGIN,
          JIEFANG_BRIDGE_ROTATION_Y,
          JIEFANG_CROSS_SECTION,
          JIEFANG_RAILING_MIN_X,
          JIEFANG_RAILING_MAX_X,
          JIEFANG_RAILING_TRACKS,
          classifyJiefangCrossSectionZ,
          jiefangDeckRoadLocalY,
        } from './web/src/traffic-duty/jiefang-railings.ts'
      `,
      resolveDir: ROOT,
      loader: 'ts',
    },
    outfile: bundleFile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    logLevel: 'silent',
  })
  const mod = await import(pathToFileURL(bundleFile).href)
  return {
    bundleDir,
    spec: {
      origin: [...mod.JIEFANG_BRIDGE_ORIGIN],
      rotationY: mod.JIEFANG_BRIDGE_ROTATION_Y,
      crossSection: mod.JIEFANG_CROSS_SECTION,
      railingMinX: mod.JIEFANG_RAILING_MIN_X,
      railingMaxX: mod.JIEFANG_RAILING_MAX_X,
      railingTracks: mod.JIEFANG_RAILING_TRACKS,
    },
  }
}

function installDeckHelperOnPage(bridgeSpec) {
  const [OX, OY, OZ] = bridgeSpec.origin
  const ROT = bridgeSpec.rotationY
  const C = Math.cos(ROT)
  const S = Math.sin(ROT)
  const bands = bridgeSpec.crossSection.bands
  function deckLocalY(lx) {
    const original = 5.62 - (lx * 1.3) / 281
    if (lx < 16) return original + 0.05
    const inner = 134.6286
    const head = 151.2322 - 145.6
    const dist = Math.max(0, inner - lx)
    if (lx >= 111) {
      return head + 0.05 * (dist < 2 ? (dist * dist) / 4 : dist - 1) + 0.05
    }
    const start = 16
    const end = 111
    const len = end - start
    const f = Math.max(0, Math.min(1, (lx - start) / len))
    const left = 5.62 - (start * 1.3) / 281
    const right = head + 0.05 * (inner - end - 1)
    return (
      left +
      (right - left) * (3 - 2 * f) * f * f -
      len * f * (1 - f) * ((1 - f) * (1.3 / 281) - f * 0.05) +
      0.05
    )
  }
  window.__jiefangBridgeSpec = bridgeSpec
  window.__jiefangDeckWorldYAtLocalX = lx => OY + deckLocalY(lx)
  window.__jiefangLocalToWorld = (lx, lz) => [OX + lx * C + lz * S, OZ - lx * S + lz * C]
  window.__worldToJiefangLocal = (wx, wz) => {
    const dx = wx - OX
    const dz = wz - OZ
    return [dx * C - dz * S, dx * S + dz * C]
  }
  window.__classifyJiefangCrossSectionZ = lz => {
    if (!Number.isFinite(lz) || lz < bridgeSpec.crossSection.minZ || lz > bridgeSpec.crossSection.maxZ) {
      return 'outside'
    }
    for (const band of bands) {
      if (lz >= band.minZ && lz <= band.maxZ) return band.role
    }
    return 'outside'
  }
  window.__isOnJiefangBridgeDeck = a => {
    if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z) || !Number.isFinite(a.y)) return false
    const [lx, lz] = window.__worldToJiefangLocal(a.x, a.z)
    if (lx < bridgeSpec.crossSection.minX || lx > bridgeSpec.crossSection.maxX) return false
    if (lz < bridgeSpec.crossSection.minZ || lz > bridgeSpec.crossSection.maxZ) return false
    const deckY = OY + deckLocalY(lx)
    return a.y >= deckY - 1.1 && a.y <= deckY + 4.5
  }
  window.__isOnJiefangApproachCorridor = a => {
    if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z) || !Number.isFinite(a.y)) return false
    if (window.__isOnJiefangBridgeDeck(a)) return true
    const [lx, lz] = window.__worldToJiefangLocal(a.x, a.z)
    if (Math.abs(lx) > 310 || Math.abs(lz) > 24) return false
    return a.y >= 149.2 && a.y <= 156.5
  }
  window.__placeAlongBridgeFacingTarget = (target, alongDistM, fallbackY, lateralOffsetM = 0, sideSign = 1) => {
    if (!target) return null
    const [lx, lz] = window.__worldToJiefangLocal(target.x, target.z)
    const dirX = lx > 0 ? -1 : 1
    const latSign = (lz >= 0 ? 1 : -1) * (sideSign >= 0 ? 1 : -1)
    const pxLx = Math.max(-138.5, Math.min(138.5, lx + dirX * alongDistM))
    const rawLz = lz + latSign * lateralOffsetM
    const pxLz = lz >= 0 ? Math.min(15.85, Math.max(12.45, rawLz)) : Math.max(-15.85, Math.min(-12.45, rawLz))
    const [px, pz] = window.__jiefangLocalToWorld(pxLx, pxLz)
    const py = Number.isFinite(fallbackY) ? fallbackY : target.y
    window.viewer.walk.clampPosition({x: px, y: py, z: pz})
    for (let k = 0; k < 6; k++) window.viewer.walk.tick(1 / 60)
    const landed = window.viewer.walk.position
    window.viewer.walk.face(Math.atan2(-(target.x - landed.x), -(target.z - landed.z)), 0.06)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    return {px: landed.x, pz: landed.z, dist: +Math.hypot(target.x - landed.x, target.z - landed.z).toFixed(3)}
  }
  window.__checkVisibleOverlap = (primarySel, obstacleSels) => {
    const primary = document.querySelector(primarySel)
    const isVisible = el => {
      if (!el || el.hasAttribute('hidden')) return false
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number.parseFloat(cs.opacity || '1') <= 0.05) {
        return false
      }
      const r = el.getBoundingClientRect()
      return r.width > 1 && r.height > 1
    }
    if (!isVisible(primary)) return {primaryVisible: false, hasOverlap: false, overlaps: []}
    const a = primary.getBoundingClientRect()
    const overlaps = []
    for (const sel of obstacleSels) {
      for (const node of document.querySelectorAll(sel)) {
        if (!isVisible(node)) continue
        const b = node.getBoundingClientRect()
        const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
        if (ix > 1 && iy > 1) {
          overlaps.push({
            selector: sel,
            text: (node.textContent || '').trim().slice(0, 24),
            ix: Math.round(ix),
            iy: Math.round(iy),
          })
        }
      }
    }
    return {primaryVisible: true, hasOverlap: overlaps.length > 0, overlaps}
  }
}

await mkdir(SHOT_DIR, {recursive: true})

const ERRS = []
const steps = []

function relShot(name) {
  return `captures/duty-3-e2e/${name}`
}

async function capture(page, fileName) {
  const fullPath = resolve(SHOT_DIR, fileName)
  await page.screenshot({path: fullPath, fullPage: false}).catch(() => {})
  return relShot(fileName)
}

function addStep(id, name, status, detail, screenshot) {
  steps.push({id, name, status, detail, screenshot})
  console.log(`[${status}] ${id} ${name}: ${detail} (${screenshot})`)
}

function attachErrorListeners(page, tag) {
  page.on('pageerror', err => {
    ERRS.push(`[${tag}] pageerror: ${err.message}`)
  })
  page.on('console', msg => {
    if (msg.type() === 'error') {
      ERRS.push(`[${tag}] console.error: ${msg.text()}`)
    }
  })
  page.on('response', res => {
    if (res.status() >= 400) {
      console.log(`[HTTP_ERR] [${tag}] ${res.status()} ${res.url()}`)
    }
  })
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

async function dismissCoachIfShown(page, waitMs = 3000) {
  try {
    await page.waitForSelector('.coach.in .coach-skip', {timeout: waitMs})
    await page.evaluate(() => {
      const btn = document.querySelector('.coach.in .coach-skip')
      if (btn instanceof HTMLElement) btn.click()
    })
    await page.waitForFunction(() => !document.querySelector('.coach'), null, {timeout: 3000}).catch(() => {})
    await page.waitForTimeout(200)
    return true
  } catch {
    return false
  }
}

async function completeStoryDialogue(page) {
  let sawGearPill = false
  for (let i = 0; i < 18; i++) {
    const state = await page.evaluate(() => {
      const dlg = document.querySelector('.td-story-dialog')
      if (!dlg || dlg.hasAttribute('hidden') || getComputedStyle(dlg).display === 'none') {
        return {done: true, gearPill: false}
      }
      const pill = dlg.querySelector('[data-td-story-gear]')
      const gearPill = Boolean(pill && !pill.hasAttribute('hidden'))
      const choice = dlg.querySelector('[data-td-story-choice]')
      if (choice) {
        choice.click()
        return {done: false, gearPill}
      }
      const next = dlg.querySelector('[data-td-story-action="next"]')
      if (next) {
        next.click()
        return {done: false, gearPill}
      }
      return {done: true, gearPill}
    })
    if (state.gearPill) sawGearPill = true
    await page.waitForTimeout(220)
    if (state.done) break
  }
  return sawGearPill
}

async function run() {
  const {bundleDir, spec: bridgeSpec} = await loadJiefangBridgeSpec()
  const {browser, ownsBrowser, mode} = await acquireBrowser()
  let context = null

  try {
    context = await browser.newContext({viewport: {width: 1280, height: 800}})

    // =========================================================================
    // PHASE A: Production UX at http://127.0.0.1:5176/?mode=walk (NO ?verify)
    // =========================================================================
    const prodPage = await context.newPage()
    attachErrorListeners(prodPage, 'mode=walk')

    let prodBriefingDone = false
    try {
      await prodPage.goto(WALK_URL, {waitUntil: 'domcontentloaded', timeout: 60000})
      await prodPage.waitForFunction(
        () =>
          document.body.dataset.mode === 'walk' &&
          !document.querySelector('#boot, .ld-veil, .about-mask:not([hidden]), dialog[open]') &&
          Boolean(document.querySelector('.td-entry:not([hidden])')) &&
          Boolean(document.querySelector('.dock-map')),
        null,
        {timeout: 120000},
      )
      // IDOK-221: .coach opens after 3x400ms calm following #boot/.ld-veil clear & .dock-map mount
      let coachDismissed = await dismissCoachIfShown(prodPage, 12000)
      await prodPage.waitForTimeout(1300)
      if (await prodPage.locator('.coach').count().catch(() => 0)) {
        const secondDismiss = await dismissCoachIfShown(prodPage, 3000)
        coachDismissed = coachDismissed || secondDismiss
      }
      const s1 = await prodPage.evaluate(() => ({
        mode: document.body.dataset.mode,
        tdEntryText: document.querySelector('.td-entry')?.textContent?.trim() ?? null,
        hasViewerLeak: Boolean(window.viewer),
        coachStillOpen: Boolean(document.querySelector('.coach.in')),
      }))
      const shot1 = await capture(prodPage, '01-boot-walk.png')
      addStep(
        'S1',
        '打开 127.0.0.1:5176/?mode=walk 进入步行态并展示辅警入口',
        s1.mode === 'walk' && Boolean(s1.tdEntryText) && !s1.coachStillOpen ? 'PASS' : 'FAIL',
        JSON.stringify({...s1, coachDismissed}),
        shot1,
      )
    } catch (err) {
      const shot1 = await capture(prodPage, '01-boot-walk.png')
      addStep('S1', '打开 127.0.0.1:5176/?mode=walk 进入步行态并展示辅警入口', 'FAIL', err.message, shot1)
      throw err
    }

    // S2 (Production URL): Click .td-entry -> "前往解放桥交警" -> verify officer overhead marker & press F
    try {
      await dismissCoachIfShown(prodPage, 1500)
      await prodPage.evaluate(
        () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
      )
      await prodPage.locator('.td-entry').click({timeout: 15000})
      const goBridgeBtn = prodPage.locator('dialog.td-panel[open] [data-td-action="go-bridge"]')
      await goBridgeBtn.waitFor({state: 'visible', timeout: 10000})
      const goBridgeBtnText = (await goBridgeBtn.textContent())?.trim() ?? null
      await goBridgeBtn.click({timeout: 10000})

      // Wait for teleport veil to clear and officer marker to render after UI teleport
      await prodPage.waitForFunction(() => !document.querySelector('.ld-veil'), null, {timeout: 20000})
      await prodPage
        .waitForFunction(
          () => {
            const marker = document.querySelector('.td-officer-marker')
            return Boolean(
              marker &&
                !marker.hasAttribute('hidden') &&
                getComputedStyle(marker).display !== 'none' &&
                marker.getBoundingClientRect().width > 0,
            )
          },
          null,
          {timeout: 6000},
        )
        .catch(() => {})

      const beaconProbe = await prodPage.evaluate(() => {
        const marker = document.querySelector('.td-officer-marker')
        return {
          markerShownBeforeF: Boolean(
            marker &&
              !marker.hasAttribute('hidden') &&
              getComputedStyle(marker).display !== 'none' &&
              marker.getBoundingClientRect().width > 0,
          ),
          markerText: marker?.textContent?.trim() ?? null,
          hintBeforeF: document.querySelector('.vehicle-action')?.textContent?.trim() ?? null,
        }
      })
      const shot2 = await capture(prodPage, '02-jiefang-officer-beacon.png')

      await prodPage.keyboard.press('KeyF')
      await prodPage
        .waitForFunction(
          () => {
            const dlg = document.querySelector('.td-story-dialog')
            return Boolean(dlg && !dlg.hasAttribute('hidden') && getComputedStyle(dlg).display !== 'none')
          },
          null,
          {timeout: 4000},
        )
        .catch(() => {})
      await prodPage
        .waitForFunction(
          () => {
            const off = document.querySelector('[data-td-story-portrait-img="officer"]')
            const pl = document.querySelector('[data-td-story-portrait-img="player"]')
            return off?.dataset.portraitLoaded === '1' && pl?.dataset.portraitLoaded === '1'
          },
          null,
          {timeout: 5000},
        )
        .catch(() => {})

      const s2 = await prodPage.evaluate(
        ({btnText, beacon}) => {
          const dlg = document.querySelector('.td-story-dialog')
          const dlgShown = Boolean(dlg && !dlg.hasAttribute('hidden') && getComputedStyle(dlg).display !== 'none')
          const topBar = document.querySelector('[data-td-story-cinema-bar="top"]')
          const botBar = document.querySelector('[data-td-story-cinema-bar="bottom"]')
          const offImg = document.querySelector('[data-td-story-portrait-img="officer"]')
          const plImg = document.querySelector('[data-td-story-portrait-img="player"]')
          return {
            teleportedViaUiButton: true,
            goBridgeBtnText: btnText,
            entryText: document.querySelector('.td-entry')?.textContent?.trim() ?? null,
            markerShown: beacon.markerShownBeforeF,
            markerText: beacon.markerText,
            hint: beacon.hintBeforeF,
            dlgShown,
            shot: dlg?.getAttribute('data-shot') ?? null,
            letterboxOpen: topBar?.dataset.open === '1' && botBar?.dataset.open === '1',
            officerPortraitReady:
              offImg?.dataset.portraitLoaded === '1' &&
              Boolean(offImg?.getAttribute('src')) &&
              !String(offImg?.getAttribute('src')).startsWith('data:image/svg+xml'),
            playerPortraitReady:
              plImg?.dataset.portraitLoaded === '1' &&
              Boolean(plImg?.getAttribute('src')) &&
              !String(plImg?.getAttribute('src')).startsWith('data:image/svg+xml'),
          }
        },
        {btnText: goBridgeBtnText, beacon: beaconProbe},
      )
      const shot2b = await capture(prodPage, '02b-jiefang-dialogue-opened.png')
      const ok =
        Boolean(s2.goBridgeBtnText?.includes('前往解放桥交警')) &&
        s2.markerShown &&
        s2.dlgShown &&
        Boolean(s2.shot) &&
        s2.letterboxOpen &&
        s2.officerPortraitReady &&
        s2.playerPortraitReady
      addStep(
        'S2',
        '实机点击「前往解放桥交警」按钮传送、见交警信标并按 F 打开对话（含黑边与双侧头像）',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify({...s2, dialogueOpenShot: shot2b}),
        shot2,
      )
      prodBriefingDone = ok
    } catch (err) {
      const shot2 = await capture(prodPage, '02-jiefang-officer-beacon.png')
      addStep('S2', '实机点击「前往解放桥交警」按钮传送、见交警信标并按 F 打开对话（含黑边与双侧头像）', 'FAIL', err.message, shot2)
    }

    void prodBriefingDone
    await prodPage.close()

    // =========================================================================
    // PHASE B: Quantitative & E2E verification at ?verify&mode=walk
    // =========================================================================
    const page = await context.newPage()
    attachErrorListeners(page, 'verify&mode=walk')

    await page.goto(VERIFY_URL, {waitUntil: 'domcontentloaded', timeout: 60000})
    await page.waitForFunction(
      () => Boolean(window.viewer?.walk?.active && window.viewer?.trafficDuty && window.viewer?.dutyTraffic),
      null,
      {timeout: 120000},
    )
    await page.waitForTimeout(800)

    await page.evaluate(installDeckHelperOnPage, bridgeSpec)
    await page.evaluate(() => document.querySelector('.spot-card.show .card-close')?.click?.())
    await dismissCoachIfShown(page, 2500)

    // S3: Teleport ONLY via UI "前往解放桥交警" button -> verify deck elevation & beacon -> KeyF briefing -> get gear & active duty
    try {
      await page.evaluate(
        () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
      )
      await page.locator('.td-entry').click({timeout: 15000})
      const verifyGoBridgeBtn = page.locator('dialog.td-panel[open] [data-td-action="go-bridge"]')
      await verifyGoBridgeBtn.waitFor({state: 'visible', timeout: 10000})
      const goBridgeBtnText = (await verifyGoBridgeBtn.textContent())?.trim() ?? null
      await verifyGoBridgeBtn.click({timeout: 10000})

      await page.waitForFunction(() => !document.querySelector('.ld-veil'), null, {timeout: 20000})
      await page
        .waitForFunction(
          () =>
            window.viewer?.trafficDuty?.getSnapshot?.().inBridgeBounds === true &&
            window.viewer?.trafficDuty?.getInteractCandidate?.()?.action === 'talk_officer',
          null,
          {timeout: 6000},
        )
        .catch(() => {})

      const preBrief = await page.evaluate(btnText => {
        const rawPos = {...window.viewer.walk.position}
        const footY = window.viewer.walk.probe().foot
        const snap = window.viewer.trafficDuty.getSnapshot()
        const officerPos = window.viewer.dutyOfficers?.officers?.jiefang?.position ?? null
        const deckElevationDelta = officerPos ? +Math.abs(footY - officerPos.y).toFixed(3) : null
        const marker = document.querySelector('.td-officer-marker')
        const markerVisible = Boolean(marker && !marker.hasAttribute('hidden') && getComputedStyle(marker).display !== 'none')
        const cand = window.viewer.trafficDuty.getInteractCandidate()
        return {
          teleportedViaUiButton: true,
          goBridgeBtnText: btnText,
          rawPos,
          footY: +footY.toFixed(3),
          officerPos,
          deckElevationDelta,
          snap: {
            inBridgeBounds: snap.inBridgeBounds,
            officerDist: snap.officerDistanceM,
            officerScreen: snap.officerScreen,
          },
          markerVisible,
          cand,
        }
      }, goBridgeBtnText)

      const landingOk =
        Boolean(preBrief.goBridgeBtnText?.includes('前往解放桥交警')) &&
        preBrief.snap.inBridgeBounds === true &&
        preBrief.deckElevationDelta !== null &&
        preBrief.deckElevationDelta <= 0.5 &&
        preBrief.markerVisible &&
        preBrief.cand?.action === 'talk_officer'
      if (!landingOk) {
        throw new Error(`UI传送落地异常: ${JSON.stringify(preBrief)}`)
      }

      const preStoryPose = await page.evaluate(() => ({
        camPos: [window.viewer.camera.position.x, window.viewer.camera.position.y, window.viewer.camera.position.z],
        camFov: window.viewer.camera.fov,
        playerPos: {x: window.viewer.walk.position.x, z: window.viewer.walk.position.z},
      }))

      await page.keyboard.press('KeyF')
      await page.waitForSelector('.td-story-dialog:not([hidden])', {timeout: 6000})
      await page
        .waitForFunction(
          () => {
            const snap = window.viewer?.trafficDuty?.getStorySnapshot?.()
            const off = document.querySelector('[data-td-story-portrait-img="officer"]')
            const pl = document.querySelector('[data-td-story-portrait-img="player"]')
            return (
              snap?.portraitsReady &&
              off?.dataset.portraitLoaded === '1' &&
              pl?.dataset.portraitLoaded === '1'
            )
          },
          null,
          {timeout: 7000},
        )
        .catch(() => {})
      const waitFullStoryText = () =>
        page
          .waitForFunction(
            () => {
              const st = window.viewer?.trafficDuty?.getStorySnapshot?.()
              const expected = st?.line?.text ?? ''
              const actual = document.querySelector('[data-td-story-text]')?.textContent ?? ''
              return Boolean(expected) && actual === expected
            },
            null,
            {timeout: 3000},
          )
          .catch(() => {})
      await waitFullStoryText()
      await page.waitForTimeout(200)
      const shot3 = await capture(page, '03-story-dialogue.png')

      const storyShots = []
      const officerUrls = new Set()
      const playerUrls = new Set()
      const camPosHistory = []
      let sawGearPill = false
      let letterboxAllOpen = true
      let playerImgValidAll = true
      let shot3aPlayer = null
      let shot3bOfficer = null
      let shot3cTwo = null
      let shot3dBridge = null

      for (let i = 0; i < 12; i++) {
        const lineSnap = await page.evaluate(() => {
          const dlg = document.querySelector('.td-story-dialog')
          if (!dlg || dlg.hasAttribute('hidden') || getComputedStyle(dlg).display === 'none') {
            return {done: true}
          }
          const st = window.viewer.trafficDuty.getStorySnapshot()
          const offImg = dlg.querySelector('[data-td-story-portrait-img="officer"]')
          const plImg = dlg.querySelector('[data-td-story-portrait-img="player"]')
          const topBar = document.querySelector('[data-td-story-cinema-bar="top"]')
          const botBar = document.querySelector('[data-td-story-cinema-bar="bottom"]')
          const pill = dlg.querySelector('[data-td-story-gear]')
          const gearPill = Boolean(pill && !pill.hasAttribute('hidden'))
          const cam = window.viewer.camera
          return {
            done: false,
            lineIndex: st.lineIndex,
            shot: st.currentShot,
            expr: st.line?.expr ?? null,
            camLocked: window.viewer.trafficDuty.isCameraLocked(),
            camPos: [+cam.position.x.toFixed(3), +cam.position.y.toFixed(3), +cam.position.z.toFixed(3)],
            camFov: +cam.fov.toFixed(2),
            letterboxOpen: topBar?.dataset.open === '1' && botBar?.dataset.open === '1',
            offLoaded: offImg?.dataset.portraitLoaded === '1' && (offImg?.naturalWidth ?? 0) > 0,
            offUrl: offImg?.getAttribute('src') ?? null,
            plLoaded: plImg?.dataset.portraitLoaded === '1' && (plImg?.naturalWidth ?? 0) > 0,
            plUrl: plImg?.getAttribute('src') ?? null,
            outfitKey: plImg?.dataset.outfitKey ?? st.outfitKey ?? null,
            gearPill,
          }
        })
        if (lineSnap.done) break
        if (lineSnap.gearPill) sawGearPill = true
        if (!lineSnap.letterboxOpen) letterboxAllOpen = false
        if (!lineSnap.plLoaded || !lineSnap.plUrl || lineSnap.plUrl.startsWith('data:image/svg+xml')) {
          playerImgValidAll = false
        } else {
          playerUrls.add(lineSnap.plUrl)
        }
        if (lineSnap.offLoaded && lineSnap.offUrl && !lineSnap.offUrl.startsWith('data:image/svg+xml')) {
          officerUrls.add(lineSnap.offUrl)
        }
        storyShots.push({line: lineSnap.lineIndex, shot: lineSnap.shot, expr: lineSnap.expr, camPos: lineSnap.camPos})
        camPosHistory.push(lineSnap.camPos)

        if (lineSnap.shot === 'player' && !shot3aPlayer) {
          await waitFullStoryText()
          shot3aPlayer = await capture(page, '03a-story-shot-player.png')
        } else if (lineSnap.shot === 'officer' && !shot3bOfficer) {
          await waitFullStoryText()
          shot3bOfficer = await capture(page, '03b-story-shot-officer.png')
        } else if (lineSnap.shot === 'two' && !shot3cTwo) {
          await waitFullStoryText()
          shot3cTwo = await capture(page, '03c-story-shot-two.png')
        } else if (lineSnap.shot === 'bridge' && !shot3dBridge) {
          await waitFullStoryText()
          shot3dBridge = await capture(page, '03d-story-shot-bridge.png')
        }

        const progressed = await page.evaluate(() => {
          const dlg = document.querySelector('.td-story-dialog')
          if (!dlg || dlg.hasAttribute('hidden')) return false
          const askRules = dlg.querySelector('[data-td-story-choice="ask_rules"]')
          if (askRules) {
            askRules.click()
            return true
          }
          const choice = dlg.querySelector('[data-td-story-choice]')
          if (choice) {
            choice.click()
            return true
          }
          const next = dlg.querySelector('[data-td-story-action="next"]')
          if (next) {
            next.click()
            return true
          }
          return false
        })
        if (!progressed) break
        await page.waitForTimeout(480)
      }

      await page.waitForFunction(() => window.viewer?.trafficDuty?.getSnapshot?.().phase === 'active', null, {
        timeout: 6000,
      })
      await page.waitForTimeout(450)

      let camMoves = 0
      for (let i = 1; i < camPosHistory.length; i++) {
        const a = camPosHistory[i - 1]
        const b = camPosHistory[i]
        const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
        if (d > 0.35) camMoves++
      }

      const postBrief = await page.evaluate(prev => {
        const cam = window.viewer.camera
        const p = window.viewer.walk.position
        const st = window.viewer.trafficDuty.getStorySnapshot()
        const topBar = document.querySelector('[data-td-story-cinema-bar="top"]')
        const botBar = document.querySelector('[data-td-story-cinema-bar="bottom"]')
        const restoreDist = Math.hypot(
          cam.position.x - prev.camPos[0],
          cam.position.y - prev.camPos[1],
          cam.position.z - prev.camPos[2],
        )
        const playerDrift = Math.hypot(p.x - prev.playerPos.x, p.z - prev.playerPos.z)
        return {
          phase: window.viewer.trafficDuty.getSnapshot().phase,
          gear: window.viewer.trafficDuty.getSnapshot().gear,
          props: window.viewer.walk.dutyProps?.getProbe?.() ?? null,
          barVisible: Boolean(document.querySelector('.td-bar:not([hidden])')),
          dockVisible: Boolean(document.querySelector('.td-signal-dock:not([hidden])')),
          letterboxClosedAfter: topBar?.dataset.open !== '1' && botBar?.dataset.open !== '1',
          cameraActiveAfter: st.cameraState?.active ?? null,
          restoreCount: st.cameraState?.restoreCount ?? 0,
          restoreDist: +restoreDist.toFixed(3),
          restoreFovDelta: +Math.abs(cam.fov - prev.camFov).toFixed(3),
          playerDrift: +playerDrift.toFixed(3),
        }
      }, preStoryPose)
      const shot4 = await capture(page, '04-duty-active-with-gear.png')
      const distinctShots = [...new Set(storyShots.map(s => s.shot).filter(Boolean))]
      const ok =
        landingOk &&
        postBrief.phase === 'active' &&
        postBrief.gear.hasWhistle &&
        postBrief.gear.hasFlag &&
        postBrief.props?.whistleVisible &&
        postBrief.props?.flagVisible &&
        postBrief.barVisible &&
        postBrief.dockVisible &&
        distinctShots.length >= 4 &&
        Boolean(shot3aPlayer && shot3bOfficer && shot3cTwo) &&
        camMoves >= 3 &&
        letterboxAllOpen &&
        postBrief.letterboxClosedAfter &&
        officerUrls.size >= 2 &&
        playerImgValidAll &&
        playerUrls.size >= 1 &&
        postBrief.restoreCount >= 1 &&
        postBrief.restoreDist <= 0.25 &&
        postBrief.restoreFovDelta <= 0.25 &&
        postBrief.playerDrift <= 0.05
      addStep(
        'S3',
        '桥面交警按 F 对话、多机位切换与双侧实时头像、领取口哨指挥旗并原地开启值班',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify({
          preBrief,
          sawGearPill,
          distinctShots,
          camMoves,
          officerUrlCount: officerUrls.size,
          playerImgValidAll,
          letterboxAllOpen,
          postBrief,
          shots: {shot3, shot3aPlayer, shot3bOfficer, shot3cTwo, shot3dBridge, shot4},
        }),
        shot4,
      )
    } catch (err) {
      const shot4 = await capture(page, '04-duty-active-with-gear.png')
      addStep(
        'S3',
        '桥面交警按 F 对话、多机位切换与双侧实时头像、领取口哨指挥旗并原地开启值班',
        'FAIL',
        err.message,
        shot4,
      )
    }

    // S4: Within 30s, bridge deck vehicles >= 8, railings mounted, and off-deck violators === 0
    try {
      const deadline = Date.now() + 30000
      let statsSnap = null
      while (Date.now() < deadline) {
        statsSnap = await page.evaluate(() => {
          const stats = window.viewer.dutyTraffic.getStats()
          const actors = window.viewer.dutyTraffic.getActors().filter(a => !a.leaving && !a.pendingRecycle)
          const onDeck = window.__isOnJiefangBridgeDeck
          const onCorridor = window.__isOnJiefangApproachCorridor
          const onDeckTotal = actors.filter(a => onDeck(a)).length
          const onDeckViolators = actors.filter(a => a.violation && a.violation !== 'none' && onDeck(a)).length
          const approachCorridorViolators = actors.filter(
            a => a.violation && a.violation !== 'none' && !onDeck(a) && onCorridor(a),
          ).length
          const offDeckActors = actors.filter(a => !onDeck(a)).length
          const offDeckViolators = actors.filter(a => a.violation && a.violation !== 'none' && !onCorridor(a)).length
          return {
            stats,
            actorLen: actors.length,
            onDeckTotal,
            onDeckViolators,
            approachCorridorViolators,
            offDeckActors,
            offDeckViolators,
            railingsMounted: Boolean(window.viewer.jiefangRailings?.group?.parent),
            railingsChildren: window.viewer.jiefangRailings?.group?.children?.length ?? 0,
            dutyPhase: window.viewer.trafficDuty.getSnapshot().phase,
          }
        })
        if (
          statsSnap.stats.active &&
          statsSnap.stats.total >= 8 &&
          statsSnap.onDeckTotal >= 8 &&
          statsSnap.onDeckViolators >= 1
        ) {
          break
        }
        await page.evaluate(() => {
          const p = window.viewer.walk?.position
          for (let i = 0; i < 15; i++) {
            window.viewer.dutyTraffic?.step?.(0.1, p)
          }
        })
        await page.waitForTimeout(300)
      }
      const shot5 = await capture(page, '05-bridge-traffic-ge-8.png')
      const ok =
        Boolean(statsSnap?.stats?.active) &&
        (statsSnap?.stats?.total ?? 0) >= 8 &&
        (statsSnap?.onDeckTotal ?? 0) >= 8 &&
        (statsSnap?.offDeckViolators ?? 1) === 0 &&
        Boolean(statsSnap?.railingsMounted)
      addStep(
        'S4',
        '30秒内解放桥桥面独立车流 >= 8、双侧/中央护栏挂接且桥下违规车为 0',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify(statsSnap),
        shot5,
      )
    } catch (err) {
      const shot5 = await capture(page, '05-bridge-traffic-ge-8.png')
      addStep('S4', '30秒内解放桥桥面独立车流 >= 8、双侧/中央护栏挂接且桥下违规车为 0', 'FAIL', err.message, shot5)
    }

    // N1: Bridge two-wheelers stay strictly on black nonmotor asphalt lane (0 on sidewalk, aligned with JIEFANG_CROSS_SECTION)
    try {
      const n1Samples = []
      const roleCounts = {nonmotor: 0, sidewalk: 0, curb: 0, motor: 0, median: 0, railing: 0, outside: 0}
      const offenders = []
      let nonDeckScooters = 0
      const sampleDeadline = Date.now() + 8000
      while (Date.now() < sampleDeadline && n1Samples.length < 5) {
        const snap = await page.evaluate(() => {
          const actors = window.viewer.dutyTraffic.getActors().filter(a => !a.leaving && a.kind === 'scooter')
          const onDeck = window.__isOnJiefangBridgeDeck
          const toLocal = window.__worldToJiefangLocal
          const classify = window.__classifyJiefangCrossSectionZ
          const rows = actors.map(a => {
            const [lx, lz] = toLocal(a.x, a.z)
            return {
              onDeck: onDeck(a),
              lx: +lx.toFixed(2),
              lz: +lz.toFixed(2),
              y: +a.y.toFixed(2),
              role: classify(lz),
              violation: a.violation ?? 'none',
              dutyState: a.dutyState ?? null,
            }
          })
          return rows
        })
        const deckRows = snap.filter(r => r.onDeck)
        if (deckRows.length >= 2 || Date.now() > sampleDeadline - 2500) {
          n1Samples.push({totalScooters: snap.length, deckScooters: deckRows.length})
          for (const r of snap) {
            if (!r.onDeck) {
              nonDeckScooters++
              continue
            }
            roleCounts[r.role] = (roleCounts[r.role] ?? 0) + 1
            if (r.role !== 'nonmotor' && offenders.length < 10) {
              offenders.push(r)
            }
          }
        }
        if (n1Samples.length < 5) await page.waitForTimeout(450)
      }
      const deckScooterSamples = Object.values(roleCounts).reduce((a, b) => a + b, 0)
      const ok =
        deckScooterSamples >= 6 &&
        roleCounts.sidewalk === 0 &&
        offenders.length === 0 &&
        roleCounts.nonmotor === deckScooterSamples
      addStep(
        'N1',
        '两轮车全部在黑色非机动车道上且人行道为 0（对齐 JIEFANG_CROSS_SECTION）',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify({
          deckScooterSamples,
          nonDeckScooters,
          roleCounts,
          offenders,
          crossSectionNonmotor: {
            north: [bridgeSpec.crossSection.northNonmotor.minZ, bridgeSpec.crossSection.northNonmotor.maxZ],
            south: [bridgeSpec.crossSection.southNonmotor.minZ, bridgeSpec.crossSection.southNonmotor.maxZ],
          },
          samples: n1Samples,
        }),
        'captures/duty-3-e2e/05-bridge-traffic-ge-8.png',
      )
    } catch (err) {
      addStep('N1', '两轮车全部在黑色非机动车道上且人行道为 0（对齐 JIEFANG_CROSS_SECTION）', 'FAIL', err.message, 'captures/duty-3-e2e/05-bridge-traffic-ge-8.png')
    }

    // N2: All 3 bridge railings run continuously head-to-tail without interior gaps
    try {
      const n2Probe = await page.evaluate(() => {
        const railings = window.viewer.jiefangRailings
        const spec = window.__jiefangBridgeSpec
        if (!railings) return {present: false}
        const boxes = railings.obstacleVolume?.boxes ?? []
        const perTrack = spec.railingTracks.map(track => {
          const tBoxes = boxes
            .filter(b => b.label?.startsWith(`${track.id}:`))
            .sort((a, b) => a.minX - b.minX)
          let interiorGaps = 0
          let maxGapM = 0
          let nonStandOnTop = 0
          let minRelH = Infinity
          let maxRelH = -Infinity
          for (let i = 0; i < tBoxes.length; i++) {
            const b = tBoxes[i]
            if (i > 0) {
              const gap = b.minX - tBoxes[i - 1].maxX
              if (Math.abs(gap) > 1e-4) {
                interiorGaps++
                maxGapM = Math.max(maxGapM, Math.abs(gap))
              }
            }
            if (b.standOnTop !== true) nonStandOnTop++
            const midX = (b.minX + b.maxX) * 0.5
            const roadWorldY = window.__jiefangDeckWorldYAtLocalX(midX)
            const localRoadY = roadWorldY - spec.origin[1]
            const relH = (b.maxY ?? 0) - localRoadY
            minRelH = Math.min(minRelH, relH)
            maxRelH = Math.max(maxRelH, relH)
          }
          const coversOldWestOfficerGap = tBoxes.some(b => b.minX <= -98 && b.maxX >= -98)
          const coversOldMidSpanGap = tBoxes.some(b => b.minX <= 0 && b.maxX >= 0)
          const coversOldEastHeadGap = tBoxes.some(b => b.minX <= 125 && b.maxX >= 125)
          return {
            id: track.id,
            z: track.z,
            colliderHeight: track.colliderHeight,
            boxCount: tBoxes.length,
            firstMinX: tBoxes[0]?.minX ?? null,
            lastMaxX: tBoxes[tBoxes.length - 1]?.maxX ?? null,
            interiorGaps,
            maxGapM: +maxGapM.toFixed(4),
            nonStandOnTop,
            minRelH: Number.isFinite(minRelH) ? +minRelH.toFixed(3) : null,
            maxRelH: Number.isFinite(maxRelH) ? +maxRelH.toFixed(3) : null,
            coversOldWestOfficerGap,
            coversOldMidSpanGap,
            coversOldEastHeadGap,
          }
        })
        return {
          present: true,
          mounted: Boolean(railings.group?.parent),
          trackCount: railings.trackCount,
          spanCount: railings.spanCount,
          gapCount: railings.gapCount,
          railingMinX: spec.railingMinX,
          railingMaxX: spec.railingMaxX,
          perTrack,
        }
      })
      const ok =
        n2Probe.present &&
        n2Probe.mounted &&
        n2Probe.trackCount === 3 &&
        n2Probe.spanCount === 1 &&
        n2Probe.gapCount === 0 &&
        n2Probe.perTrack.length === 3 &&
        n2Probe.perTrack.every(
          t =>
            t.boxCount >= 20 &&
            Math.abs(t.firstMinX - n2Probe.railingMinX) <= 0.05 &&
            Math.abs(t.lastMaxX - n2Probe.railingMaxX) <= 0.05 &&
            t.interiorGaps === 0 &&
            t.nonStandOnTop === 0 &&
            t.minRelH !== null &&
            t.minRelH >= 0.98 &&
            t.maxRelH <= 1.22 &&
            t.coversOldWestOfficerGap &&
            t.coversOldMidSpanGap &&
            t.coversOldEastHeadGap,
        )
      addStep(
        'N2',
        '解放桥 3 道栏杆从桥头到桥尾连续无缺口（spanCount=1, gapCount=0, 可踩顶 1.0~1.2m）',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify(n2Probe),
        'captures/duty-3-e2e/05-bridge-traffic-ge-8.png',
      )
    } catch (err) {
      addStep('N2', '解放桥 3 道栏杆从桥头到桥尾连续无缺口（spanCount=1, gapCount=0, 可踩顶 1.0~1.2m）', 'FAIL', err.message, 'captures/duty-3-e2e/05-bridge-traffic-ge-8.png')
    }

    // N4: Bridge vehicle violator ratio <= 15%
    try {
      const n4Samples = []
      const waitDeadline = Date.now() + 8000
      while (Date.now() < waitDeadline && n4Samples.length < 5) {
        const s = await page.evaluate(() => {
          const stats = window.viewer.dutyTraffic.getStats()
          const actors = window.viewer.dutyTraffic.getActors().filter(a => !a.leaving)
          const onDeck = window.__isOnJiefangBridgeDeck
          const deckActors = actors.filter(a => onDeck(a))
          const deckViolators = deckActors.filter(a => a.violation && a.violation !== 'none').length
          return {
            total: stats.total,
            cars: stats.cars,
            scooters: stats.scooters,
            violators: stats.violators,
            ratio: stats.total > 0 ? +(stats.violators / stats.total).toFixed(4) : 1,
            deckTotal: deckActors.length,
            deckViolators,
            deckRatio: deckActors.length > 0 ? +(deckViolators / deckActors.length).toFixed(4) : 1,
          }
        })
        if (s.total >= 8 || Date.now() > waitDeadline - 2000) {
          n4Samples.push(s)
        }
        if (n4Samples.length < 5) await page.waitForTimeout(450)
      }
      const maxRatio = Math.max(...n4Samples.map(s => s.ratio))
      const maxDeckRatio = Math.max(...n4Samples.map(s => s.deckRatio))
      const minTotal = Math.min(...n4Samples.map(s => s.total))
      const minDeckTotal = Math.min(...n4Samples.map(s => s.deckTotal))
      const ok = minTotal >= 8 && minDeckTotal >= 8 && maxRatio <= 0.15 && maxDeckRatio <= 0.15
      addStep(
        'N4',
        '解放桥桥面车流中违规车比例 <= 15%',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify({minTotal, minDeckTotal, maxRatio, maxDeckRatio, samples: n4Samples}),
        'captures/duty-3-e2e/05-bridge-traffic-ge-8.png',
      )
    } catch (err) {
      addStep('N4', '解放桥桥面车流中违规车比例 <= 15%', 'FAIL', err.message, 'captures/duty-3-e2e/05-bridge-traffic-ge-8.png')
    }

    // S5: Duty 3-key HUD hint/dock + real keyboard Q whistle & E short pull-over / long release
    try {
      const keysUiCheck = await page.evaluate(() => ({
        hintText: document.querySelector('.hint')?.textContent?.trim() ?? null,
        keysCardCtx: document.querySelector('.keys-card .keys-ctx')?.textContent?.trim() ?? null,
        keysCardDutyRows: document.querySelectorAll('.keys-card [data-id^="duty"]').length,
        dockMounted: Boolean(document.querySelector('.td-signal-dock')),
        dockButtons: document.querySelectorAll('.td-signal-dock [data-td-signal]').length,
      }))

      // Locate a moving uncited bridge scooter violator and stand safely on curb facing it (within 7m)
      let flagSetup = null
      for (let retry = 0; retry < 40; retry++) {
        flagSetup = await page.evaluate(() => {
          const onDeck = window.__isOnJiefangBridgeDeck
          const toLocal = window.__worldToJiefangLocal
          const actors = window.viewer.dutyTraffic.getActors()
          const target = actors
            .filter(
              a =>
                a.kind === 'scooter' &&
                !a.leaving &&
                !a.pendingRecycle &&
                !a.cited &&
                a.scale >= 0.5 &&
                a.violation &&
                a.violation !== 'none' &&
                a.speed > 0.5 &&
                a.dutyState !== 'pulled_over' &&
                a.dutyState !== 'leaving_with_ticket' &&
                onDeck(a),
            )
            .sort((u, v) => {
              const [ux] = toLocal(u.x, u.z)
              const [vx] = toLocal(v.x, v.z)
              return Math.abs(ux) - Math.abs(vx)
            })[0]
          if (!target) {
            const p = window.viewer.walk?.position
            for (let i = 0; i < 15; i++) {
              window.viewer.dutyTraffic?.step?.(0.1, p)
            }
            return null
          }
          const [lx] = toLocal(target.x, target.z)
          const clampedX = Math.max(-124, Math.min(124, lx))
          const deckY = window.__jiefangDeckWorldYAtLocalX(clampedX)
          const placed = window.__placeAlongBridgeFacingTarget(target, 2.9, deckY + 0.005, 0.8)
          window.__s5Target = target
          return {
            dist: placed ? placed.dist : 999,
            initSpeed: +target.speed.toFixed(2),
            initState: target.dutyState ?? 'normal',
            normalNeighbors: actors.filter(
              a =>
                a !== target &&
                !a.leaving &&
                (!a.violation || a.violation === 'none') &&
                placed &&
                Math.hypot(a.x - placed.px, a.z - placed.pz) <= 12,
            ).length,
          }
        })
        if (flagSetup && flagSetup.dist <= 7.5) break
        await page.waitForTimeout(250)
      }
      if (!flagSetup) {
        throw new Error('no moving uncited scooter violator found on bridge deck for KeyQ/KeyE')
      }

      // Real KeyQ whistle -> whistleMode='mouth', blowPulse > 0, no non-violator halted
      await page.keyboard.press('KeyQ')
      await page.waitForTimeout(160)
      const qProbe = await page.evaluate(() => {
        const pos = window.viewer.walk.position
        const actors = window.viewer.dutyTraffic.getActors()
        const normalHalted = actors.filter(
          a => (!a.violation || a.violation === 'none') && a.haltedByDuty && Math.hypot(a.x - pos.x, a.z - pos.z) <= 12,
        ).length
        return {
          props: window.viewer.walk.dutyProps?.getProbe?.() ?? null,
          normalHalted,
        }
      })

      // Wait for whistle cooldown, warm rAF clock, face oncoming violator inside [12.45, 15.85] lane, tap short KeyE, step 0.25s to peak raised stop-flag + blinker frame, and capture IMMEDIATELY
      await page
        .waitForFunction(
          () => window.viewer.walk.emote?.id === 0,
          null,
          {timeout: 3500, polling: 60},
        )
        .catch(() => {})
      await page.evaluate(
        () =>
          new Promise(resolve =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const t = window.__s5Target
                if (t) {
                  const [, tlz] = window.__worldToJiefangLocal(t.x, t.z)
                  const towardCenter = Math.abs(tlz) >= 14.1 ? -1 : 1
                  const [lx] = window.__worldToJiefangLocal(t.x, t.z)
                  const clampedX = Math.max(-124, Math.min(124, lx))
                  const deckY = window.__jiefangDeckWorldYAtLocalX(clampedX)
                  window.__placeAlongBridgeFacingTarget(t, 2.9, deckY + 0.005, 0.35, towardCenter)
                }
                resolve(true)
              }),
            ),
          ),
      )
      await page.keyboard.down('KeyE')
      await page.waitForTimeout(80)
      await page.keyboard.up('KeyE')
      const shortEImmediate = await page.evaluate(() => {
        window.viewer.walk.tick(0.25)
        const t = window.__s5Target
        const p = window.viewer.walk.dutyProps?.getProbe?.()
        return {
          flagModeAfterKeyUp: p?.flagMode ?? null,
          emoteIdAtPeakShot: window.viewer.walk.emote?.id ?? 0,
          flagYAtPeakShot: p?.flagWorldPos ? +p.flagWorldPos.y.toFixed(3) : null,
          chestYAtPeakShot: p?.chestWorldPos ? +p.chestWorldPos.y.toFixed(3) : null,
          targetBlinkerAtPeakShot: t?.blinker ?? null,
          lastHaltedSet: Boolean(window.viewer.trafficDuty.getDutyKeys().getLastHaltedActor()),
        }
      })
      await page.evaluate(() => {
        const t = window.__s5Target
        const p = window.viewer.walk.position
        if (t && p) {
          const [pLx, plZ] = window.__worldToJiefangLocal(p.x, p.z)
          const dxL = window.__worldToJiefangLocal(t.x, t.z)[0] - pLx
          const camLz = plZ + (plZ >= 0 ? 1.05 : -1.05)
          const camLx = pLx + (dxL >= 0 ? 3.4 : -3.4)
          const [camWx, camWz] = window.__jiefangLocalToWorld(camLx, camLz)
          window.viewer.walk.face(Math.atan2(-(p.x - camWx), -(p.z - camWz)), 0.14)
        }
      })
      await page.waitForTimeout(90)
      const shot6 = await capture(page, '06-whistle-flag-gestures.png')

      await page
        .waitForFunction(
          () => {
            const t = window.__s5Target
            return Boolean(
              t &&
                (t.speed <= 0.35 ||
                  t.dutyState === 'pulled_over' ||
                  t.dutyState === 'pulling_over' ||
                  t.dutyState === 'halted'),
            )
          },
          null,
          {timeout: 5000},
        )
        .catch(() => {})
      const shortEProbe = await page.evaluate(imm => {
        const t = window.__s5Target
        return {
          flagModeAfterKeyUp: imm.flagModeAfterKeyUp,
          emoteIdAtPeakShot: imm.emoteIdAtPeakShot,
          targetBlinkerAtPeakShot: imm.targetBlinkerAtPeakShot,
          lastHaltedSet: imm.lastHaltedSet,
          targetState: t?.dutyState ?? null,
          targetSpeed: t ? +t.speed.toFixed(2) : null,
          targetHaltedByDuty: Boolean(t?.haltedByDuty),
        }
      }, shortEImmediate)

      // Real long KeyE (>=0.6s sim-time while held down!) -> release halted violator; capture peak pass-flag gesture
      await page.keyboard.down('KeyE')
      let longEImmediateFlag = null
      for (let i = 0; i < 24; i++) {
        const probe = await page.evaluate(() => {
          window.viewer.trafficDuty?.step?.(0.1)
          window.viewer.walk?.tick?.(0.1)
          return {
            cleared: window.viewer.trafficDuty.getDutyKeys().getLastHaltedActor() === null,
            flagMode: window.viewer.walk.dutyProps?.getProbe?.()?.flagMode ?? null,
          }
        })
        longEImmediateFlag = probe.flagMode
        if (probe.cleared && probe.flagMode === 'pass') break
        await page.waitForTimeout(45)
      }
      await page.evaluate(() => {
        window.viewer.walk?.tick?.(0.12)
        window.viewer.walk?.tick?.(0.12)
        const t = window.__s5Target
        const p = window.viewer.walk.position
        if (t && p) {
          const [pLx, plZ] = window.__worldToJiefangLocal(p.x, p.z)
          const dxL = window.__worldToJiefangLocal(t.x, t.z)[0] - pLx
          const camLz = plZ + (plZ >= 0 ? 1.05 : -1.05)
          const camLx = pLx + (dxL >= 0 ? 3.4 : -3.4)
          const [camWx, camWz] = window.__jiefangLocalToWorld(camLx, camLz)
          window.viewer.walk.face(Math.atan2(-(p.x - camWx), -(p.z - camWz)), 0.14)
        }
      })
      await page.waitForTimeout(90)
      const shot6b = await capture(page, '06b-flag-long-release.png')
      await page.keyboard.up('KeyE')
      await page.waitForTimeout(200)
      const longEProbe = await page.evaluate(immFlag => {
        const t = window.__s5Target
        return {
          flagMode: immFlag,
          lastHaltedCleared: window.viewer.trafficDuty.getDutyKeys().getLastHaltedActor() === null,
          targetStateAfterRelease: t?.dutyState ?? null,
          targetHaltedAfterRelease: Boolean(t?.haltedByDuty),
        }
      }, longEImmediateFlag)

      // Wait for long-KeyE pass emote & hold timer to clear back to idle before verifying dock flag_stop -> flagMode='stop'
      await page
        .waitForFunction(
          () =>
            window.viewer.walk.emote?.id === 0 &&
            window.viewer.walk.dutyProps?.getProbe?.()?.flagMode === 'idle',
          null,
          {timeout: 6000, polling: 80},
        )
        .catch(() => {})

      let dockStopFlagMode = null
      await page.evaluate(() => {
        const onDeck = window.__isOnJiefangBridgeDeck
        const toLocal = window.__worldToJiefangLocal
        const cand = window.viewer.dutyTraffic.getActors().find(
          a => a.kind === 'scooter' && !a.leaving && !a.cited && a.scale >= 0.5 && a.violation && a.violation !== 'none' && onDeck(a),
        )
        if (!cand) return
        const [lx] = toLocal(cand.x, cand.z)
        const clampedX = Math.max(-124, Math.min(124, lx))
        const deckY = window.__jiefangDeckWorldYAtLocalX(clampedX)
        window.__placeAlongBridgeFacingTarget(cand, 2.9, deckY + 0.04, 0.8)
      })
      const stopDockBtn = page.locator('.td-signal-dock [data-td-signal="flag_stop"]')
      if (await stopDockBtn.isEnabled().catch(() => false)) {
        await stopDockBtn.click({timeout: 4000}).catch(() => {})
        await page
          .waitForFunction(
            () => window.viewer.walk.dutyProps?.getProbe?.()?.flagMode === 'stop',
            null,
            {timeout: 3000, polling: 50},
          )
          .catch(() => {})
        dockStopFlagMode = await page.evaluate(() => window.viewer.walk.dutyProps?.getProbe?.()?.flagMode ?? null)
        await page.keyboard.down('KeyE')
        for (let i = 0; i < 20; i++) {
          const cleared = await page.evaluate(() => {
            window.viewer.trafficDuty?.step?.(0.1)
            window.viewer.walk?.tick?.(0.1)
            return window.viewer.trafficDuty.getDutyKeys().getLastHaltedActor() === null
          })
          if (cleared) break
          await page.waitForTimeout(45)
        }
        await page.keyboard.up('KeyE')
      }

      const ok =
        keysUiCheck.dockMounted &&
        keysUiCheck.dockButtons >= 4 &&
        Boolean(keysUiCheck.hintText?.includes('吹哨') && keysUiCheck.hintText?.includes('挥旗')) &&
        qProbe.props?.whistleMode === 'mouth' &&
        (qProbe.props?.blowPulse ?? 0) > 0 &&
        qProbe.normalHalted === 0 &&
        shortEProbe.flagModeAfterKeyUp === 'stop' &&
        shortEProbe.emoteIdAtPeakShot === 5 &&
        Boolean(shortEProbe.targetBlinkerAtPeakShot === 'right' || shortEProbe.targetBlinkerAtPeakShot === 'hazard') &&
        shortEProbe.lastHaltedSet &&
        (shortEProbe.targetHaltedByDuty ||
          shortEProbe.targetState === 'pulling_over' ||
          shortEProbe.targetState === 'pulled_over' ||
          shortEProbe.targetState === 'halted') &&
        longEProbe.flagMode === 'pass' &&
        longEProbe.lastHaltedCleared &&
        longEProbe.targetHaltedAfterRelease === false &&
        dockStopFlagMode === 'stop'
      addStep(
        'S5',
        '真实键盘 Q 吹哨、短按 E 挥旗靠边拦停、长按 E 放行与执勤键提示同步',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify({keysUiCheck, flagSetup, qProbe, shortEProbe, longEProbe, dockStopFlagMode, releaseShot: shot6b}),
        shot6,
      )
    } catch (err) {
      const shot6 = await capture(page, '06-whistle-flag-gestures.png')
      addStep('S5', '真实键盘 Q 吹哨、短按 E 挥旗靠边拦停、长按 E 放行与执勤键提示同步', 'FAIL', err.message, shot6)
    }

    // S6: Full KeyF workflow: pull over -> KeyF take out printer (flag disabled) -> print -> KeyF tear-off -> >1.5m reject -> <=1.5m KeyF handover -> receipt in hand -> duplicate rejected
    try {
      const beforeCited = await page.evaluate(() => ({
        citedCount: window.viewer.trafficDuty.getSnapshot().citedCount,
        totalFineYuan: window.viewer.trafficDuty.getSnapshot().totalFineYuan,
      }))
      await page.evaluate(() => {
        const [sx, sz] = window.__jiefangLocalToWorld(0, 17.0)
        window.viewer.walk.clampPosition({x: sx, y: 151.8, z: sz})
      })
      await page.waitForTimeout(450)

      let candInfo = null
      let termOpen = false
      for (let retry = 0; retry < 40 && !termOpen; retry++) {
        const preFlag = await page.evaluate(() => {
          const actors = window.viewer.dutyTraffic.getActors()
          const onDeck = window.__isOnJiefangBridgeDeck
          const onCorridor = window.__isOnJiefangApproachCorridor
          const toLocal = window.__worldToJiefangLocal
          const offDeckViolators = actors.filter(
            a => !a.leaving && !a.pendingRecycle && a.violation && a.violation !== 'none' && !onCorridor(a),
          ).length
          const deckViolators = actors
            .filter(
              a =>
                a.kind === 'scooter' &&
                !a.leaving &&
                !a.pendingRecycle &&
                a.scale >= 0.5 &&
                !a.cited &&
                a.violation &&
                a.violation !== 'none' &&
                onDeck(a),
            )
            .map(a => {
              const [lx, lz] = toLocal(a.x, a.z)
              return {a, lx, lz, nonMotorScore: Math.abs(lz) >= 11.5 ? 0 : 1}
            })
            .sort((u, v) => u.nonMotorScore - v.nonMotorScore || Math.abs(u.lx) - Math.abs(v.lx))
          const pick = deckViolators[0]
          if (!pick) {
            const p = window.viewer.walk?.position
            for (let i = 0; i < 15; i++) {
              window.viewer.dutyTraffic?.step?.(0.1, p)
            }
            return {ok: false, reason: 'no_deck_citable', totalActors: actors.length, offDeckViolators}
          }
          window.__placeAlongBridgeFacingTarget(pick.a, 2.8, pick.a.y, 0.78)
          window.__s6Target = pick.a
          return {
            ok: true,
            offDeckViolators,
            isDown: window.viewer.walk.knockdown.isDown(),
          }
        })

        if (!preFlag.ok) {
          candInfo = preFlag
          await page.waitForTimeout(250)
          continue
        }

        // Pull over via real short KeyE
        await page.keyboard.down('KeyE')
        await page.waitForTimeout(120)
        await page.keyboard.up('KeyE')
        await page
          .waitForFunction(
            () => {
              const t = window.__s6Target
              return Boolean(t && t.speed <= 0.15 && (t.dutyState === 'pulled_over' || t.dutyState === 'halted'))
            },
            null,
            {timeout: 5000},
          )
          .catch(() => {})

        // Step B: Stand diagonally beside halted target (>1.5m handover limit, <=4.2m open range) without occluding scooter
        const approach = await page.evaluate(() => {
          const target = window.__s6Target
          const actors = window.viewer.dutyTraffic.getActors()
          const onDeck = window.__isOnJiefangBridgeDeck
          const offDeckViolators = actors.filter(
            a => !a.leaving && a.violation && a.violation !== 'none' && !onDeck(a),
          ).length
          if (!target || target.leaving || target.cited || target.speed > 0.35 || !onDeck(target)) {
            return {ok: false, reason: 'target_not_halted_on_deck', offDeckViolators}
          }
          window.__placeAlongBridgeFacingTarget(target, 2.1, target.y, 0.75)
          return {
            ok: true,
            target: {x: target.x, y: target.y, z: target.z, violation: target.violation, speed: target.speed},
            offDeckViolators,
          }
        })

        if (!approach.ok) {
          candInfo = approach
          await page.waitForTimeout(600)
          continue
        }

        await page
          .waitForFunction(
            () => window.viewer?.trafficDuty?.getInteractCandidate?.()?.action === 'whistle_cite',
            null,
            {timeout: 3500},
          )
          .catch(() => {})

        candInfo = await page.evaluate(prev => {
          const cand = window.viewer.trafficDuty.getInteractCandidate()
          return {
            ok: Boolean(cand && cand.action === 'whistle_cite'),
            target: prev.target,
            candAction: cand?.action ?? null,
            candDist: cand?.distance ?? null,
            offDeckViolators: prev.offDeckViolators,
          }
        }, approach)

        if (candInfo.ok) {
          await page.keyboard.press('KeyF')
          await page
            .waitForFunction(
              () => Boolean(document.querySelector('.td-fine-terminal')),
              null,
              {timeout: 3500},
            )
            .catch(() => {})
          termOpen = await page.evaluate(() => Boolean(document.querySelector('.td-fine-terminal')))
        } else {
          await page.waitForTimeout(600)
        }
      }

      if (!termOpen) {
        throw new Error(`fine terminal failed to open via KeyF: ${JSON.stringify(candInfo)}`)
      }

      await page.waitForTimeout(300)
      const openProbe = await page.evaluate(() => ({
        terminalOpenFlag: document.body.dataset.tdTerminalOpen === '1',
        props: window.viewer.walk.dutyProps?.getProbe?.() ?? null,
        flagEnabledWhileOpen: window.viewer.trafficDuty.getDutyKeys().isFlagEnabled(),
        whistleEnabledWhileOpen: window.viewer.trafficDuty.getDutyKeys().isWhistleEnabled(),
        ftSnap: window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.() ?? null,
        terminalOverlap: window.__checkVisibleOverlap('.td-fine-terminal', [
          '.dock-buttons > button',
          '.dock .btn-mode',
          '.td-duty-keys-dock',
        ]),
      }))
      const shot7a = await capture(page, '07a-fine-terminal-open.png')

      // Confirm input via Enter -> thermal print -> tear-off (auto at 100% or KeyF if requireExplicitTearOff)
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      })
      await page.keyboard.press('Enter')
      await page.waitForFunction(
        () => {
          const ft = window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()
          return ft?.phase === 'printing' || ft?.phase === 'deliver'
        },
        null,
        {timeout: 12000},
      )
      await page.waitForTimeout(180)
      const shot7bPrint = await capture(page, '07b-fine-terminal-printing.png')

      await page.waitForFunction(
        () => {
          const ft = window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()
          const primary = document.querySelector('.td-ft-btn-primary')
          return ft?.phase === 'deliver' || Boolean(primary?.textContent?.includes('撕下'))
        },
        null,
        {timeout: 18000},
      )

      const needManualTear = await page.evaluate(() => {
        const ft = window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()
        return ft?.phase !== 'deliver'
      })
      if (needManualTear) {
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        })
        await page.keyboard.press('KeyF')
      }
      await page.waitForFunction(
        () => {
          const ft = window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()
          return ft?.phase === 'deliver' && ft.paperTornOff === true
        },
        null,
        {timeout: 8000},
      )
      await page.waitForTimeout(150)

      // Ensure player is strictly >1.5m away diagonally beside pulled-over scooter, then test >1.5m handover rejection via real KeyF
      await page.evaluate(() => {
        window.__placeAlongBridgeFacingTarget(window.__s6Target, 2.55, window.__s6Target?.y, 0.75)
      })
      await page
        .waitForFunction(
          () => {
            const ft = window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()
            const btn = document.querySelector('.td-ft-btn-deliver')
            return ft?.canDeliverWithinRange === false && Boolean(btn && btn.disabled)
          },
          null,
          {timeout: 5000},
        )
        .catch(() => {})

      const tooFarBefore = await page.evaluate(() => ({
        citedCount: window.viewer.trafficDuty.getSnapshot().citedCount,
        props: window.viewer.walk.dutyProps?.getProbe?.() ?? null,
        ft: window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.() ?? null,
        deliverDisabled: Boolean(document.querySelector('.td-ft-btn-deliver')?.hasAttribute('disabled')),
      }))
      await page.keyboard.press('KeyF')
      await page.waitForTimeout(150)
      const tooFarAfter = await page.evaluate(() => ({
        stillOpen: Boolean(document.querySelector('.td-fine-terminal')),
        citedCount: window.viewer.trafficDuty.getSnapshot().citedCount,
        deliverError: window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()?.deliverError ?? null,
        warnText: document.querySelector('.td-ft-warn')?.textContent?.trim() ?? null,
      }))
      const shot7cTooFar = await capture(page, '07c-handover-too-far.png')

      // Walk along same non-motor lane (hypot(1.05, 0.22)=1.07m <= 1.5m) keeping camera inside [12.45, 15.85] so neither z=12 iron guardrail nor z=16.5 sidewalk railing crosses view
      await page.evaluate(() => {
        const [, tlz] = window.__worldToJiefangLocal(window.__s6Target.x, window.__s6Target.z)
        const towardCenter = Math.abs(tlz) >= 14.1 ? -1 : 1
        window.__placeAlongBridgeFacingTarget(window.__s6Target, 1.05, window.__s6Target?.y, 0.22, towardCenter)
      })
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('.td-ft-btn-deliver')
          return Boolean(btn && !btn.disabled)
        },
        null,
        {timeout: 8000},
      )
      await page.keyboard.press('KeyF')
      await page.waitForFunction(
        prevCount =>
          !document.querySelector('.td-fine-terminal') &&
          (window.viewer?.trafficDuty?.getSnapshot?.()?.citedCount ?? 0) > prevCount,
        beforeCited.citedCount,
        {timeout: 12000},
      )
      // Wait for ticket receive reach-out peak (~0.45s * 1.15s = ~0.5s) so extended arm + white slip appear cleanly
      await page.waitForTimeout(450)

      const afterCited = await page.evaluate(() => {
        const t = window.__s6Target
        const handBoneRight = t ? window.viewer.dutyTraffic.getActorHandBone?.(t, 'right') : null
        const handBoneLeft = t ? window.viewer.dutyTraffic.getActorHandBone?.(t, 'left') : null
        const slipRight = Boolean(handBoneRight?.getObjectByName?.('duty-receipt-slip'))
        const slipLeft = Boolean(handBoneLeft?.getObjectByName?.('duty-receipt-slip'))
        return {
          citedCount: window.viewer.trafficDuty.getSnapshot().citedCount,
          totalFineYuan: window.viewer.trafficDuty.getSnapshot().totalFineYuan,
          targetCited: Boolean(t?.cited),
          targetHoldingReceipt: Boolean(t?.holdingReceipt),
          handSlipSide: t?.handSide ?? (slipRight ? 'right' : slipLeft ? 'left' : null),
          handSlipMeshMounted: slipRight || slipLeft,
          offDeckViolators: window.viewer.dutyTraffic
            .getActors()
            .filter(
              a =>
                !a.leaving &&
                !a.pendingRecycle &&
                a.violation &&
                a.violation !== 'none' &&
                !window.__isOnJiefangApproachCorridor(a),
            )
            .length,
        }
      })
      const shot7dReceived = await capture(page, '07b-fine-terminal-cited.png')

      // Drain SwiftShader GPU/compositor queue after screenshot, then trigger real pressTicket() (retrying once if a >2.2s frame stall expires the toast timer)
      await page.waitForTimeout(300)
      let toastShownHandle = null
      for (let dupTry = 0; dupTry < 2 && !toastShownHandle; dupTry++) {
        await page.evaluate(
          () =>
            new Promise(resolve =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  const [, tlz] = window.__worldToJiefangLocal(window.__s6Target.x, window.__s6Target.z)
                  const towardCenter = Math.abs(tlz) >= 14.1 ? -1 : 1
                  window.__placeAlongBridgeFacingTarget(window.__s6Target, 1.05, window.__s6Target?.y, 0.22, towardCenter)
                  window.__dupTicketRes = window.viewer.trafficDuty.getDutyKeys().pressTicket()
                  const tEl = document.querySelector('.toast')
                  window.__dupToastTriggered = Boolean(tEl?.classList.contains('show') && /已开/.test(tEl.textContent || ''))
                  resolve(true)
                }),
              ),
            ),
        )
        toastShownHandle = await page
          .waitForFunction(
            () => {
              const toast = document.querySelector('.toast')
              const op = toast ? Number.parseFloat(getComputedStyle(toast).opacity || '0') : 0
              if (toast && toast.classList.contains('show') && op >= 0.45) {
                const res = window.__dupTicketRes
                return {
                  terminalReopened: Boolean(document.querySelector('.td-fine-terminal')),
                  citedCountAfterDup: window.viewer.trafficDuty.getSnapshot().citedCount,
                  pressTicketReason: res?.reason ?? null,
                  pressTicketMessage: res?.message ?? null,
                  toastText: toast.textContent?.trim() ?? null,
                  toastTriggeredSync: Boolean(window.__dupToastTriggered),
                  toastVisibleInShot: true,
                }
              }
              return false
            },
            null,
            {timeout: 2100, polling: 20},
          )
          .catch(() => null)
      }
      const shot7eDup = await capture(page, '07e-duplicate-rejected.png')
      const dupProbe = toastShownHandle
        ? await toastShownHandle.jsonValue()
        : await page.evaluate(() => {
            const res = window.__dupTicketRes
            const toast = document.querySelector('.toast')
            const toastOpacity = toast ? Number.parseFloat(getComputedStyle(toast).opacity || '0') : 0
            return {
              terminalReopened: Boolean(document.querySelector('.td-fine-terminal')),
              citedCountAfterDup: window.viewer.trafficDuty.getSnapshot().citedCount,
              pressTicketReason: res?.reason ?? null,
              pressTicketMessage: res?.message ?? null,
              toastText: toast?.textContent?.trim() ?? null,
              toastTriggeredSync: Boolean(window.__dupToastTriggered),
              toastVisibleInShot: Boolean(toast?.classList.contains('show') && toastOpacity >= 0.45),
            }
          })

      const ok =
        openProbe.terminalOpenFlag &&
        openProbe.terminalOverlap?.hasOverlap === false &&
        openProbe.props?.printerMode === 'in_hand' &&
        openProbe.flagEnabledWhileOpen === false &&
        openProbe.whistleEnabledWhileOpen === true &&
        tooFarBefore.props?.printerMode === 'holstered' &&
        tooFarBefore.props?.paperTornOff === true &&
        tooFarBefore.props?.handSlipVisible === true &&
        tooFarBefore.ft?.canDeliverWithinRange === false &&
        tooFarBefore.deliverDisabled === true &&
        tooFarAfter.stillOpen === true &&
        tooFarAfter.citedCount === beforeCited.citedCount &&
        afterCited.citedCount === beforeCited.citedCount + 1 &&
        afterCited.totalFineYuan > beforeCited.totalFineYuan &&
        afterCited.targetCited === true &&
        (afterCited.targetHoldingReceipt || afterCited.handSlipMeshMounted) &&
        afterCited.offDeckViolators === 0 &&
        dupProbe.terminalReopened === false &&
        dupProbe.citedCountAfterDup === afterCited.citedCount &&
        dupProbe.toastVisibleInShot &&
        (dupProbe.pressTicketReason === 'already_cited' || Boolean(dupProbe.toastText?.includes('已开过罚单')))
      addStep(
        'S6',
        '真实 F 键拿机打印→撕单挂腰→超1.5m禁递→1.5m内递交手握凭条→同车防重开单',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify({
          candInfo,
          openProbe,
          tooFarBefore,
          tooFarAfter,
          afterCited,
          dupProbe,
          shots: {shot7a, shot7bPrint, shot7cTooFar, shot7dReceived, shot7eDup},
        }),
        shot7dReceived,
      )
    } catch (err) {
      if (await page.locator('.td-fine-terminal').isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => {})
      }
      const shot7b = await capture(page, '07b-fine-terminal-cited.png')
      addStep('S6', '真实 F 键拿机打印→撕单挂腰→超1.5m禁递→1.5m内递交手握凭条→同车防重开单', 'FAIL', err.message, shot7b)
    }

    // S7: Leave bridge bounds -> "正在值班" warning & clamp back inside bridge bounds via natural rAF
    try {
      await page.waitForTimeout(1200)
      await page.evaluate(out => {
        window.viewer.walk.clampPosition({x: out.x, y: 151.6, z: out.z})
      }, JIEFANG_OUT_OF_BOUNDS)
      await page
        .waitForFunction(
          () => {
            const banner = document.querySelector('.td-bounds-banner')
            const visible = Boolean(banner && !banner.hasAttribute('hidden') && getComputedStyle(banner).display !== 'none')
            return visible && window.viewer?.trafficDuty?.getSnapshot?.().inBridgeBounds === true
          },
          null,
          {timeout: 4000},
        )
        .catch(() => {})
      // Face WEST at clampedPos so camera rests on the wide-open EAST bridge deck without colliding into west abutment/avatar mesh
      await page.evaluate(() => {
        const pos = window.viewer.walk.position
        const [lx, lz] = window.__worldToJiefangLocal(pos.x, pos.z)
        const [tx, tz] = window.__jiefangLocalToWorld(lx - 16, lz)
        window.viewer.walk.face(Math.atan2(-(tx - pos.x), -(tz - pos.z)), 0.12)
      })
      await page.waitForTimeout(220)
      const oobState = await page.evaluate(() => {
        const s1 = window.viewer.trafficDuty.getSnapshot()
        const banner = document.querySelector('.td-bounds-banner')
        return {
          phase: s1.phase,
          outOfBoundsWarning: s1.outOfBoundsWarning,
          inBridgeBoundsAfterClamp: s1.inBridgeBounds,
          clampedPos: {...window.viewer.walk.position},
          bannerVisible: Boolean(banner && !banner.hasAttribute('hidden') && getComputedStyle(banner).display !== 'none'),
          bannerText: banner?.textContent?.trim() ?? null,
          bannerDockOverlap: window.__checkVisibleOverlap('.td-bounds-banner', ['.td-signal-dock', '.toast.show']),
        }
      })
      const shot8 = await capture(page, '08-bounds-warning.png')
      const txt = `${oobState.outOfBoundsWarning ?? ''} ${oobState.bannerText ?? ''}`
      const ok = oobState.phase === 'active' && oobState.bannerVisible && txt.includes('正在值班') && oobState.inBridgeBoundsAfterClamp
      addStep('S7', '脱离解放桥范围提示“正在值班”并禁止越界执勤', ok ? 'PASS' : 'FAIL', JSON.stringify(oobState), shot8)
    } catch (err) {
      const shot8 = await capture(page, '08-bounds-warning.png')
      addStep('S7', '脱离解放桥范围提示“正在值班”并禁止越界执勤', 'FAIL', err.message, shot8)
    }

    // N6: Stand on Jiefang Bridge sidewalk for 60s with active traffic -> 0 hits / not knocked down
    try {
      const startInfo = await page.evaluate(() => {
        const lx = -22
        const lz = 18.2
        const [sx, sz] = window.__jiefangLocalToWorld(lx, lz)
        const deckY = window.__jiefangDeckWorldYAtLocalX(lx)
        window.viewer.walk.clampPosition({x: sx, y: deckY + 0.04, z: sz})
        return {
          role: window.__classifyJiefangCrossSectionZ(lz),
          deckY: +deckY.toFixed(3),
          startResets: window.viewer.walk.probe().resets,
        }
      })
      const pollSamples = []
      const holdUntil = Date.now() + 60000
      while (Date.now() < holdUntil) {
        await page.waitForTimeout(2000)
        const s = await page.evaluate(() => {
          const p = window.viewer.walk.probe()
          const [curLx, curLz] = window.__worldToJiefangLocal(p.x, p.z)
          const deckY = window.__jiefangDeckWorldYAtLocalX(curLx)
          return {
            isDown: window.viewer.walk.knockdown.isDown(),
            dutyPhase: window.viewer.trafficDuty.getSnapshot().phase,
            deckTraffic: window.viewer.dutyTraffic.getActors().filter(a => window.__isOnJiefangBridgeDeck(a)).length,
            footDelta: +(p.foot - deckY).toFixed(3),
            resets: p.resets,
            role: window.__classifyJiefangCrossSectionZ(curLz),
          }
        })
        pollSamples.push(s)
        if (s.isDown) break
      }
      const shot60s = await capture(page, '08b-sidewalk-60s-safe.png')
      const anyHit = pollSamples.some(s => s.isDown)
      const minTraffic = pollSamples.length ? Math.min(...pollSamples.map(s => s.deckTraffic)) : 0
      const endResetsDelta = pollSamples.length ? pollSamples[pollSamples.length - 1].resets - startInfo.startResets : 1
      const ok =
        startInfo.role === 'sidewalk' &&
        pollSamples.length >= 25 &&
        !anyHit &&
        minTraffic >= 6 &&
        endResetsDelta === 0
      addStep(
        'N6',
        '解放桥人行道站立 60 秒正常车流通行零被撞',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify({startInfo, sampleCount: pollSamples.length, anyHit, minTraffic, endResetsDelta}),
        shot60s,
      )
    } catch (err) {
      const shot60s = await capture(page, '08b-sidewalk-60s-safe.png')
      addStep('N6', '解放桥人行道站立 60 秒正常车流通行零被撞', 'FAIL', err.message, shot60s)
    }

    // S8 & N5: Knockdown >=5 variants, 4 stunned states, 3-stage climb-up (>2.4s revert) & bridge deck flush footY ±0.3m
    try {
      const variantProbe = await page.evaluate(() => {
        const kd = window.viewer.walk.knockdown
        const cases = [
          ['vehicle_hit', 'back', 0.85],
          ['vehicle_hit', 'left', 0.7],
          ['vehicle_hit', 'right', 0.7],
          ['vehicle_hit', 'front', 0.7],
          ['vehicle_hit', 'back', 0.25],
          ['bike_crash', 'back', 0.75],
        ]
        const seen = []
        for (const [k, d, sev] of cases) {
          const snap = kd.trigger(k, d, sev, {yaw: window.viewer.walk.yaw})
          seen.push(snap.variant)
        }
        kd.forceRise(true)
        return {seen, distinctCount: new Set(seen).size}
      })
      await page.waitForTimeout(200)

      const midSpot = await page.evaluate(() => {
        const lx = -35
        const lz = 16.5
        const [wx, wz] = window.__jiefangLocalToWorld(lx, lz)
        const [wx2, wz2] = window.__jiefangLocalToWorld(lx + 12, lz)
        const expectedDeckY = window.__jiefangDeckWorldYAtLocalX(lx)
        window.viewer.walk.clampPosition({x: wx, y: expectedDeckY + 0.05, z: wz})
        window.viewer.walk.face(Math.atan2(-(wx2 - wx), -(wz2 - wz)), 0.06)
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        window.__n5Stop?.()
        const samples = []
        const breathStates = []
        let rafId = 0
        let running = true
        const rec = () => {
          if (!running) return
          const p = window.viewer.walk.probe()
          const snap = window.viewer.walk.knockdown.getSnapshot()
          const [curLx] = window.__worldToJiefangLocal(p.x, p.z)
          const deckY = window.__jiefangDeckWorldYAtLocalX(curLx)
          if (snap.breathState && breathStates[breathStates.length - 1] !== snap.breathState) {
            breathStates.push(snap.breathState)
          }
          samples.push({
            phase: snap.phase,
            foot: +p.foot.toFixed(3),
            deckY: +deckY.toFixed(3),
            delta: +(p.foot - deckY).toFixed(3),
            resets: p.resets,
          })
          rafId = requestAnimationFrame(rec)
        }
        rafId = requestAnimationFrame(rec)
        window.__n5Samples = samples
        window.__n5BreathStates = breathStates
        window.__n5Stop = () => {
          running = false
          cancelAnimationFrame(rafId)
        }
        window.viewer.walk.knockdown.trigger('vehicle_hit', 'back', 0.85, {yaw: window.viewer.walk.yaw})
        return {wx: +wx.toFixed(2), wz: +wz.toFixed(2), expectedDeckY: +expectedDeckY.toFixed(3), startResets: window.viewer.walk.probe().resets}
      })

      await page.waitForFunction(
        () => {
          const p = window.viewer.walk.knockdown.getSnapshot().phase
          return p === 'stunned' || p === 'mashing'
        },
        null,
        {timeout: 45000, polling: 100},
      )
      const shot9a0 = await capture(page, '09a0-knockdown-stunned.png')
      await page.waitForFunction(
        () => window.viewer.walk.knockdown.getSnapshot().phase === 'mashing',
        null,
        {timeout: 45000, polling: 100},
      )
      // Stay in mashing slightly so we observe >=2 of the 4 stunned breath states before mashing
      await page.waitForTimeout(1800)
      const shot9a = await capture(page, '09a-knockdown-mashing.png')

      // Stage 1: 1 Space press -> recoverySegment 1 (趴撑)
      await page.keyboard.press('Space')
      await page.waitForTimeout(180)
      const stage1 = await page.evaluate(() => ({
        snap: window.viewer.walk.knockdown.getSnapshot(),
        hudSegOn: document.querySelectorAll('.knockdown-hud .kd-seg.kd-on').length,
        hudOverlap: window.__checkVisibleOverlap('.knockdown-hud', [
          '.hotbar',
          '.td-duty-keys-dock',
          '.beta-note',
          '.hint',
        ]),
      }))
      const shot9b1 = await capture(page, '09b1-knockdown-stage1.png')

      // Stage 2: 2 more Space presses (total 3) -> recoverySegment 2 (跪撑)
      await page.keyboard.press('Space')
      await page.waitForTimeout(120)
      await page.keyboard.press('Space')
      await page.waitForTimeout(180)
      const stage2 = await page.evaluate(() => ({
        snap: window.viewer.walk.knockdown.getSnapshot(),
        hudSegOn: document.querySelectorAll('.knockdown-hud .kd-seg.kd-on').length,
      }))
      const shot9b2 = await capture(page, '09b2-knockdown-stage2.png')

      // Wait >2.4s game-sim time without pressing Space -> fallbackCount >= 1 & reverts segment 2 -> 1
      await page.waitForFunction(
        () => (window.viewer.walk.knockdown.getSnapshot().fallbackCount ?? 0) >= 1,
        null,
        {timeout: 45000, polling: 100},
      )
      await page.waitForTimeout(150)
      const afterRevert = await page.evaluate(() => ({
        snap: window.viewer.walk.knockdown.getSnapshot(),
        hudSegOn: document.querySelectorAll('.knockdown-hud .kd-seg.kd-on').length,
      }))
      const shot9b3 = await capture(page, '09b3-knockdown-revert.png')

      // Recover back through stage 3 (单膝, mashCount 4)
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Space')
        await page.waitForTimeout(120)
      }
      const stage3 = await page.evaluate(() => ({
        snap: window.viewer.walk.knockdown.getSnapshot(),
        hudSegOn: document.querySelectorAll('.knockdown-hud .kd-seg.kd-on').length,
      }))
      const shot9b4 = await capture(page, '09b4-knockdown-stage3.png')

      // Final mash(es) -> stand up cleanly even if screenshot IPC took >2.4s
      for (let k = 0; k < 5; k++) {
        const stillDown = await page.evaluate(() => window.viewer.walk.knockdown.isDown())
        if (!stillDown) break
        await page.keyboard.press('Space')
        await page.waitForTimeout(220)
      }
      await page.waitForFunction(
        () =>
          !window.viewer.walk.knockdown.isDown() &&
          window.viewer.walk.knockdown.getSnapshot().phase === 'idle',
        null,
        {timeout: 45000, polling: 100},
      )
      await page.waitForTimeout(450)
      const after5 = await page.evaluate(startResets => {
        window.__n5Stop?.()
        const samples = window.__n5Samples ?? []
        const deltas = samples.map(s => s.delta)
        const minDelta = deltas.length ? Math.min(...deltas) : NaN
        const maxDelta = deltas.length ? Math.max(...deltas) : NaN
        const pEnd = window.viewer.walk.probe()
        const [endLx] = window.__worldToJiefangLocal(pEnd.x, pEnd.z)
        const endDeckY = window.__jiefangDeckWorldYAtLocalX(endLx)
        return {
          isDown: window.viewer.walk.knockdown.isDown(),
          snap: window.viewer.walk.knockdown.getSnapshot(),
          breathStates: window.__n5BreathStates ?? [],
          sampleCount: samples.length,
          minDelta: +minDelta.toFixed(3),
          maxDelta: +maxDelta.toFixed(3),
          endDelta: +(pEnd.foot - endDeckY).toFixed(3),
          resetsDelta: pEnd.resets - startResets,
          droppedUnderBridge: !Number.isFinite(minDelta) || minDelta < -0.3 || pEnd.foot < endDeckY - 0.3,
        }
      }, midSpot.startResets)
      const shot9b = await capture(page, '09b-knockdown-recovered.png')

      const s8Ok =
        variantProbe.distinctCount >= 5 &&
        after5.breathStates.length >= 2 &&
        stage1.snap.recoverySegment === 1 &&
        stage1.hudSegOn === 1 &&
        stage1.hudOverlap?.hasOverlap === false &&
        stage2.snap.recoverySegment === 2 &&
        stage2.hudSegOn === 2 &&
        (afterRevert.snap.fallbackCount ?? 0) >= 1 &&
        afterRevert.snap.recoverySegment === 1 &&
        stage3.snap.recoverySegment === 3 &&
        stage3.hudSegOn === 3 &&
        after5.isDown === false
      addStep(
        'S8',
        '倒地>=5受击动作、地面喘气缓气、3段爬起(>2.4s超时回退)与5次空格起身',
        s8Ok ? 'PASS' : 'FAIL',
        JSON.stringify({
          variantProbe,
          breathStates: after5.breathStates,
          stage1: {
            seg: stage1.snap.recoverySegment,
            hud: stage1.hudSegOn,
            mash: stage1.snap.mashCount,
            hudOverlap: stage1.hudOverlap,
          },
          stage2: {seg: stage2.snap.recoverySegment, hud: stage2.hudSegOn, mash: stage2.snap.mashCount},
          afterRevert: {seg: afterRevert.snap.recoverySegment, fb: afterRevert.snap.fallbackCount, mash: afterRevert.snap.mashCount},
          stage3: {seg: stage3.snap.recoverySegment, hud: stage3.hudSegOn, mash: stage3.snap.mashCount},
          shots: {shot9a0, shot9a, shot9b1, shot9b2, shot9b3, shot9b4, shot9b},
        }),
        shot9b,
      )

      const n5Ok =
        after5.sampleCount >= 10 &&
        !after5.droppedUnderBridge &&
        after5.minDelta >= -0.3 &&
        after5.maxDelta <= 1.5 &&
        Math.abs(after5.endDelta) <= 0.3 &&
        after5.resetsDelta === 0
      addStep(
        'N5',
        '解放桥桥中被撞倒→喘气→3段爬起全程贴合桥面不掉桥底（footY 偏差在 ±0.3m 内）',
        n5Ok ? 'PASS' : 'FAIL',
        JSON.stringify({midSpot, ...after5}),
        shot9a,
      )
    } catch (err) {
      await page
        .evaluate(() => {
          window.__n5Stop?.()
          window.viewer?.walk?.knockdown?.forceRise?.(true)
        })
        .catch(() => {})
      const shot9b = await capture(page, '09b-knockdown-recovered.png')
      addStep('S8', '倒地>=5受击动作、地面喘气缓气、3段爬起(>2.4s超时回退)与5次空格起身', 'FAIL', err.message, shot9b)
      addStep('N5', '解放桥桥中被撞倒→喘气→3段爬起全程贴合桥面不掉桥底（footY 偏差在 ±0.3m 内）', 'FAIL', err.message, 'captures/duty-3-e2e/09a-knockdown-mashing.png')
    }

    // N3: Walk is blocked by railing, then jump (Space) onto railing top and cross over on BOTH shore (-125) and river span (over Li River)
    try {
      async function runRailingJumpTrial(chosenLx, takeShot) {
        const setup = await page.evaluate(lxArg => {
          const spec = window.__jiefangBridgeSpec
          const track = spec.railingTracks.find(t => t.id === 'south_motor_nonmotor') ?? spec.railingTracks[0]
          const startLz = track.z + 0.72
          const [sx, sz] = window.__jiefangLocalToWorld(lxArg, startLz)
          const deckY = window.__jiefangDeckWorldYAtLocalX(lxArg)
          const [wx0, wz0] = window.__jiefangLocalToWorld(lxArg, track.z)
          const [wx1, wz1] = window.__jiefangLocalToWorld(lxArg, track.z - 1)
          const dirX = wx1 - wx0
          const dirZ = wz1 - wz0
          const faceYaw = Math.atan2(-dirX, -dirZ)
          window.viewer.walk.clampPosition({x: sx, y: deckY + 0.04, z: sz})
          window.viewer.walk.face(faceYaw, 0.24)
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          return {
            trackId: track.id,
            trackZ: track.z,
            colliderHeight: track.colliderHeight,
            chosenLx: lxArg,
            startLz,
            deckY: +deckY.toFixed(3),
            dirX,
            dirZ,
            startResets: window.viewer.walk.probe().resets,
          }
        }, chosenLx)

        // Subcheck A: Plain walking without jumping reaches the railing barrier and is blocked from crossing
        await page.evaluate(s => {
          window.__n3WalkStop?.()
          const frames = []
          let active = true
          let rafId = 0
          const track = () => {
            if (!active) return
            const p = window.viewer.walk.probe()
            const [, lz] = window.__worldToJiefangLocal(p.x, p.z)
            frames.push(+lz.toFixed(3))
            rafId = requestAnimationFrame(track)
          }
          rafId = requestAnimationFrame(track)
          window.__n3WalkFrames = frames
          window.__n3WalkStop = () => {
            active = false
            cancelAnimationFrame(rafId)
          }
          window.viewer.walk.drive(s.dirX, s.dirZ, false)
        }, setup)
        await page
          .waitForFunction(
            s => {
              const frames = window.__n3WalkFrames ?? []
              const p = window.viewer.walk.probe()
              const [, curLz] = window.__worldToJiefangLocal(p.x, p.z)
              return frames.length >= 6 && curLz <= s.trackZ + 0.55
            },
            setup,
            {timeout: 6000},
          )
          .catch(() => {})
        const walkBlockedState = await page.evaluate(s => {
          window.viewer.walk.drive(0, 0)
          window.__n3WalkStop?.()
          const frames = window.__n3WalkFrames ?? []
          const p = window.viewer.walk.probe()
          const [, curLz] = window.__worldToJiefangLocal(p.x, p.z)
          return {
            walkFrames: frames.length,
            lzAfterWalk: +curLz.toFixed(3),
            footAfterWalk: +p.foot.toFixed(3),
            blockedWithoutJump: curLz < s.startLz - 0.15 && curLz > s.trackZ + 0.15,
          }
        }, setup)

        // Subcheck B: Jump with real Space while moving toward railing -> rise onto top & cross over
        await page.evaluate(s => {
          window.__n3Stop?.()
          const samples = []
          let running = true
          let rafId = 0
          const rec = () => {
            if (!running) return
            const p = window.viewer.walk.probe()
            const [curLx, curLz] = window.__worldToJiefangLocal(p.x, p.z)
            const deckY = window.__jiefangDeckWorldYAtLocalX(curLx)
            samples.push({
              lx: +curLx.toFixed(2),
              lz: +curLz.toFixed(3),
              foot: +p.foot.toFixed(3),
              aboveDeck: +(p.foot - deckY).toFixed(3),
              grounded: p.grounded,
              wet: p.wet,
              bw: p.blockedWater,
            })
            rafId = requestAnimationFrame(rec)
          }
          rafId = requestAnimationFrame(rec)
          window.__n3Samples = samples
          window.__n3Stop = () => {
            running = false
            cancelAnimationFrame(rafId)
          }
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          window.viewer.walk.drive(s.dirX, s.dirZ, true)
        }, setup)
        await page.waitForFunction(() => (window.__n3Samples?.length ?? 0) >= 1, null, {timeout: 3000}).catch(() => {})
        await page.keyboard.press('Space')

        let shotTaken = false
        let shotPath = 'captures/duty-3-e2e/11-railing-jump-crossover.png'
        if (takeShot) {
          await page
            .waitForFunction(
              () => {
                const p = window.viewer.walk.probe()
                const [lx] = window.__worldToJiefangLocal(p.x, p.z)
                const deckY = window.__jiefangDeckWorldYAtLocalX(lx)
                return p.foot - deckY >= 0.78
              },
              null,
              {timeout: 6000},
            )
            .then(async () => {
              shotPath = await capture(page, '11-railing-jump-crossover.png')
              shotTaken = true
            })
            .catch(() => {})
        }

        await page
          .waitForFunction(
            s => {
              const p = window.viewer.walk.probe()
              const [, lz] = window.__worldToJiefangLocal(p.x, p.z)
              return lz <= s.trackZ - 0.65 && p.grounded
            },
            setup,
            {timeout: 8000},
          )
          .catch(() => {})

        const trace = await page.evaluate(s => {
          window.viewer.walk.drive(0, 0)
          window.__n3Stop?.()
          const samples = window.__n3Samples ?? []
          const p = window.viewer.walk.probe()
          const [endLx, endLz] = window.__worldToJiefangLocal(p.x, p.z)
          const endDeckY = window.__jiefangDeckWorldYAtLocalX(endLx)
          const maxAboveDeck = samples.length ? Math.max(...samples.map(m => m.aboveDeck)) : 0
          const topSamples = samples.filter(m => Math.abs(m.lz - s.trackZ) <= 0.45 && m.aboveDeck >= 0.85)
          return {
            sampleCount: samples.length,
            maxAboveDeck: +maxAboveDeck.toFixed(3),
            topSamplesCount: topSamples.length,
            stoodOnTop: topSamples.some(m => m.grounded),
            blockedWaterFrames: samples.filter(m => m.bw).length,
            endLz: +endLz.toFixed(3),
            endFoot: +p.foot.toFixed(3),
            endAboveDeck: +(p.foot - endDeckY).toFixed(3),
            endGrounded: p.grounded,
            crossedToOppositeSide: endLz <= s.trackZ - 0.6,
            resetsDelta: p.resets - s.startResets,
            isDown: window.viewer.walk.knockdown.isDown(),
          }
        }, setup)
        if (takeShot && !shotTaken) {
          shotPath = await capture(page, '11-railing-jump-crossover.png')
        }
        const trialOk =
          walkBlockedState.blockedWithoutJump &&
          trace.maxAboveDeck >= 0.88 &&
          trace.crossedToOppositeSide &&
          trace.endGrounded &&
          trace.resetsDelta === 0 &&
          !trace.isDown
        return {trialOk, setup, walkBlockedState, trace, shotPath, shotTaken}
      }

      const dryApproachTrial = await runRailingJumpTrial(-117, true)
      const clearRiverLx = await page.evaluate(() => {
        const spec = window.__jiefangBridgeSpec
        const track = spec.railingTracks.find(t => t.id === 'south_motor_nonmotor') ?? spec.railingTracks[0]
        const actors = window.viewer.dutyTraffic.getActors().filter(a => !a.leaving)
        const toLocal = window.__worldToJiefangLocal
        const actorLocals = actors.map(a => toLocal(a.x, a.z))
        let chosen = -40
        let best = -1
        for (let candX = -65; candX <= 5; candX += 5) {
          let minD = Infinity
          for (const [ax, az] of actorLocals) {
            if (Math.abs(az - track.z) <= 5.5) minD = Math.min(minD, Math.abs(ax - candX))
          }
          if (minD > best) {
            best = minD
            chosen = candX
          }
        }
        return chosen
      })
      const riverSpanTrial = await runRailingJumpTrial(clearRiverLx, false)
      const ok = dryApproachTrial.trialOk && riverSpanTrial.trialOk
      addStep(
        'N3',
        '玩家不可平穿栏杆，按空格可跳上栏杆顶并翻越到另一侧桥面（含西岸与涉水江中主跨）',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify({dryApproachTrial, riverSpanTrial}),
        dryApproachTrial.shotPath,
      )
    } catch (err) {
      await page
        .evaluate(() => {
          window.viewer?.walk?.drive?.(0, 0)
          window.__n3WalkStop?.()
          window.__n3Stop?.()
        })
        .catch(() => {})
      const shotN3 = await capture(page, '11-railing-jump-crossover.png')
      addStep('N3', '玩家不可平穿栏杆，按空格可跳上栏杆顶并翻越到另一侧桥面（含西岸与涉水江中主跨）', 'FAIL', err.message, shotN3)
    }

    // S9: Shizijie "Little Hong Kong" underground entrance & traversal check
    try {
      const shizijieMeta = JSON.parse(await readFile(resolve(ROOT, 'public/landmarks/shizijie.json'), 'utf8'))
      const ug = shizijieMeta?.underground
      const entrances = ug?.entrances ?? []
      const nw = entrances.find(e => e.corner === 'nw') ?? entrances[0]
      const origin = ug?.originWorld ?? [-879.750202, 151.3, -169.626045]
      const mouth = nw?.worldMouth ? {x: nw.worldMouth[0], z: nw.worldMouth[2]} : SHIZIJIE_DEFAULT
      const deep = nw?.worldDeep ? {x: nw.worldDeep[0], z: nw.worldDeep[2]} : SHIZIJIE_DEFAULT
      const corridorCenter = {x: origin[0], z: origin[2]}

      // Approach just outside NW stair mouth then walk down NW stair into central underground hall
      const dxOut = mouth.x - deep.x
      const dzOut = mouth.z - deep.z
      const lenOut = Math.hypot(dxOut, dzOut) || 1
      const approach = {
        x: mouth.x + (dxOut / lenOut) * 3.5,
        z: mouth.z + (dzOut / lenOut) * 3.5,
      }

      await page.evaluate(async ap => {
        await window.viewer.trafficDuty.abandonDuty()
        window.viewer.trafficDuty.closePanel?.()
        await window.viewer.walkTo(ap.x, ap.z, 0, 'verify-shizijie')
      }, approach)
      await page.waitForFunction(
        () =>
          !document.querySelector('dialog.td-panel[open]') &&
          !document.querySelector('.td-panel[open]') &&
          !document.querySelector('.ld-veil'),
        null,
        {timeout: 5000},
      )
      await page.waitForTimeout(700)

      const driveWaypoints = async (waypoints, maxFrames = 3200) =>
        page.evaluate(
          ({pts, limit}) => {
            const w = window.viewer.walk
            const samples = []
            let idx = 0
            let minFootY = Infinity
            try {
              for (let f = 0; f < limit && idx < pts.length; f++) {
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
                const p = w.probe()
                if (p.foot < minFootY) minFootY = p.foot
                if (f % 60 === 0 || p.resets > 0) {
                  samples.push({f, idx, x: +p.x.toFixed(2), z: +p.z.toFixed(2), foot: +p.foot.toFixed(2), resets: p.resets})
                }
                if (p.resets > 0) break
              }
            } finally {
              w.drive(0, 0)
            }
            const endProbe = w.probe()
            return {
              arrivedWaypoints: idx,
              totalWaypoints: pts.length,
              minFootY: +minFootY.toFixed(2),
              endFootY: +endProbe.foot.toFixed(2),
              endResets: endProbe.resets,
              samples,
            }
          },
          {pts: waypoints, limit: maxFrames},
        )

      // Leg 1: surface -> NW stair -> way 985734877 exact B1 corridor centerline -> open B1 hall; capture 10-shizijie-underground.png WHILE inside B1!
      const nwEntryTurn = {x: origin[0] - 12.7, z: origin[2] - 38.854}
      const b1AtriumNorth = {x: origin[0] - 4.83, z: origin[2] - 20.024}
      const b1MidCorridor = {x: origin[0] + 2.38, z: origin[2] - 2.794}
      const b1SouthView = {x: origin[0] + 4.72, z: origin[2] + 2.816}
      const underTrace = await driveWaypoints([mouth, deep, nwEntryTurn, b1AtriumNorth, b1MidCorridor])
      await page.evaluate(lookPt => {
        document.querySelector('.spot-card.show .card-close')?.click?.()
        const cur = window.viewer.walk.position
        window.viewer.walk.face(Math.atan2(-(lookPt.x - cur.x), -(lookPt.z - cur.z)), 0.08)
      }, b1SouthView)
      await page.waitForTimeout(300)

      const uiState = await page.evaluate(() => {
        const storyDlg = document.querySelector('.td-story-dialog')
        const boundsBanner = document.querySelector('.td-bounds-banner')
        return {
          tdPanelOpen: Boolean(document.querySelector('dialog.td-panel[open], .td-panel[open]')),
          storyOpen: Boolean(storyDlg && !storyDlg.hasAttribute('hidden') && getComputedStyle(storyDlg).display !== 'none'),
          fineOpen: Boolean(document.querySelector('.td-fine-terminal') || document.querySelector('[data-td-fine-fallback][open]')),
          veilPresent: Boolean(document.querySelector('.ld-veil')),
          boundsBannerVisible: Boolean(boundsBanner && !boundsBanner.hasAttribute('hidden') && getComputedStyle(boundsBanner).display !== 'none'),
        }
      })
      const noPanelOrBackdrop = !uiState.tdPanelOpen && !uiState.storyOpen && !uiState.fineOpen && !uiState.veilPresent
      const shot10 = await capture(page, '10-shizijie-underground.png')

      // Leg 2: B1 hall -> NW stair -> surface approach along exact way 985734877 centerline
      const returnTrace = await driveWaypoints([b1AtriumNorth, nwEntryTurn, deep, mouth, approach])
      const walkTrace = {
        arrivedWaypoints: underTrace.arrivedWaypoints + returnTrace.arrivedWaypoints,
        totalWaypoints: underTrace.totalWaypoints + returnTrace.totalWaypoints,
        minFootY: +Math.min(underTrace.minFootY, returnTrace.minFootY).toFixed(2),
        undergroundShotFootY: underTrace.endFootY,
        endFootY: returnTrace.endFootY,
        endResets: underTrace.endResets + returnTrace.endResets,
        samples: [...underTrace.samples, ...returnTrace.samples],
      }

      const descReached =
        walkTrace.minFootY <= (ug?.worldFloorY ?? 147.1) + 1.8 &&
        walkTrace.undergroundShotFootY <= (ug?.worldFloorY ?? 147.1) + 1.5 &&
        walkTrace.endFootY >= 150.2 &&
        walkTrace.endResets === 0 &&
        walkTrace.arrivedWaypoints === walkTrace.totalWaypoints
      const ok =
        Boolean(ug) &&
        Array.isArray(entrances) &&
        entrances.length >= 2 &&
        Number.isFinite(ug?.floorY) &&
        noPanelOrBackdrop &&
        descReached
      addStep(
        'S9',
        '十字街“小香港”地下入口 地面→地下(实景B1抓拍)→地面 通行核查',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify({
          hasUndergroundMeta: Boolean(ug),
          entrancesCount: entrances.length,
          worldFloorY: ug?.worldFloorY ?? null,
          uiState,
          noPanelOrBackdrop,
          walkTrace,
        }),
        shot10,
      )
    } catch (err) {
      const shot10 = await capture(page, '10-shizijie-underground.png')
      addStep('S9', '十字街“小香港”地下入口下行至地下通道实测', 'FAIL', err.message, shot10)
    }

    // Shared real-UI helper for restarting Jiefang Bridge duty and walking via real WASD keys
    const ensureBridgeDutyActiveViaUi = async () => {
      const phase = await page.evaluate(() => window.viewer?.trafficDuty?.getSnapshot?.()?.phase ?? null)
      if (phase === 'active') return
      await page.evaluate(() => {
        window.viewer?.trafficDuty?.closePanel?.()
        document.querySelector('.spot-card.show .card-close')?.click?.()
      })
      await page.waitForSelector('.td-entry:not([hidden])', {timeout: 15000})
      await page.locator('.td-entry').click({timeout: 15000})
      const goBtn = page.locator('dialog.td-panel[open] [data-td-action="go-bridge"]')
      await goBtn.waitFor({state: 'visible', timeout: 10000})
      await goBtn.click({timeout: 10000})
      await page.waitForFunction(
        () => {
          const snap = window.viewer?.trafficDuty?.getSnapshot?.()
          return (
            Boolean(snap && snap.officerDistanceM !== null && snap.officerDistanceM <= 5.0) &&
            !document.querySelector('dialog.td-panel[open]') &&
            !document.querySelector('.ld-veil')
          )
        },
        null,
        {timeout: 15000},
      )
      await page.waitForTimeout(450)
      await page.keyboard.press('KeyF')
      await page.waitForSelector('.td-story-dialog:not([hidden])', {timeout: 10000})
      for (let i = 0; i < 16; i++) {
        const activeNow = await page.evaluate(() => {
          const snap = window.viewer?.trafficDuty?.getSnapshot?.()
          const dlg = document.querySelector('.td-story-dialog')
          const dlgOpen = Boolean(dlg && !dlg.hasAttribute('hidden') && getComputedStyle(dlg).display !== 'none')
          return snap?.phase === 'active' && !dlgOpen
        })
        if (activeNow) break
        const choiceBtn = page.locator(
          '.td-story-dialog:not([hidden]) .td-story-choice[data-td-story-choice="repeat_accept"], .td-story-dialog:not([hidden]) .td-story-choice[data-td-story-choice="ready_now"]',
        )
        if ((await choiceBtn.count()) > 0 && (await choiceBtn.first().isVisible())) {
          await choiceBtn.first().click()
        } else {
          const nextBtn = page.locator('.td-story-dialog:not([hidden]) [data-td-story-action="next"]')
          if ((await nextBtn.count()) > 0 && (await nextBtn.first().isVisible())) {
            await nextBtn.first().click()
          }
        }
        await page.waitForTimeout(180)
      }
      await page.waitForFunction(
        () => {
          const snap = window.viewer?.trafficDuty?.getSnapshot?.()
          const dlg = document.querySelector('.td-story-dialog')
          const dlgOpen = Boolean(dlg && !dlg.hasAttribute('hidden') && getComputedStyle(dlg).display !== 'none')
          return snap?.phase === 'active' && !dlgOpen
        },
        null,
        {timeout: 10000},
      )
    }

    const walkAlongBridgePointWithKeys = async (targetX, targetZ, stopDistM = 2.0, maxMs = 45000) => {
      const startMs = Date.now()
      let prevDist = Infinity
      let stuckIters = 0
      await page.keyboard.down('ShiftLeft')
      await page.keyboard.down('KeyW')
      try {
        while (Date.now() - startMs < maxMs) {
          const needHop = stuckIters >= 2
          if (needHop) await page.keyboard.down('Space')
          let dist
          try {
            dist = await page.evaluate(
              ({tx, tz, stop, hopping}) => {
                const w = window.viewer.walk
                const p = w.position
                const dx = tx - p.x
                const dz = tz - p.z
                const d = Math.hypot(dx, dz)
                if (d > 0.1) {
                  w.face(Math.atan2(-dx, -dz), 0.1)
                }
                if (d > stop) {
                  const subSteps = hopping ? 14 : d > 16 ? 18 : d > 5 ? 8 : 3
                  for (let s = 0; s < subSteps; s++) w.tick(1 / 60)
                }
                const p2 = w.position
                return Math.hypot(tx - p2.x, tz - p2.z)
              },
              {tx: targetX, tz: targetZ, stop: stopDistM, hopping: needHop},
            )
          } finally {
            if (needHop) await page.keyboard.up('Space')
          }
          if (dist <= stopDistM) return dist
          if (prevDist - dist < 0.12) {
            stuckIters += 1
          } else {
            stuckIters = 0
          }
          prevDist = dist
          if (needHop) {
            stuckIters = 0
            await page.evaluate(() => {
              for (let s = 0; s < 14; s++) window.viewer.walk.tick(1 / 60)
            })
          }
          await page.waitForTimeout(25)
        }
      } finally {
        await page.keyboard.up('Space').catch(() => {})
        await page.keyboard.up('KeyW')
        await page.keyboard.up('ShiftLeft')
      }
      return page.evaluate(
        ({tx, tz}) => Math.hypot(tx - window.viewer.walk.position.x, tz - window.viewer.walk.position.z),
        {tx: targetX, tz: targetZ},
      )
    }

    const pullOverTargetViaKeyE = async targetGlobalName => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.evaluate(
          name =>
            new Promise(resolve =>
              requestAnimationFrame(() => {
                const t = window[name]
                if (t) {
                  window.__placeAlongBridgeFacingTarget(t, 2.6, t.y, 0.72)
                }
                resolve(true)
              }),
            ),
          targetGlobalName,
        )
        await page.keyboard.down('KeyE')
        await page.waitForTimeout(110)
        await page.keyboard.up('KeyE')
        for (let stepIdx = 0; stepIdx < 35; stepIdx++) {
          const st = await page.evaluate(name => {
            const t = window[name]
            const p = window.viewer.walk?.position
            if (t && t.dutyState === 'pulling_over') {
              for (let i = 0; i < 4; i++) window.viewer.dutyTraffic?.step?.(0.1, p)
              window.viewer.trafficDuty?.step?.(0.1)
            }
            return {
              speed: t?.speed ?? 99,
              dutyState: t?.dutyState ?? null,
              haltedByDuty: Boolean(t?.haltedByDuty),
            }
          }, targetGlobalName)
          if (
            st.speed <= 0.15 &&
            (st.dutyState === 'pulled_over' || st.dutyState === 'halted' || st.haltedByDuty)
          ) {
            return st
          }
          if (stepIdx >= 2 && st.dutyState !== 'pulling_over' && st.dutyState !== 'pulled_over' && st.dutyState !== 'halted') {
            break
          }
          await page.waitForTimeout(140)
        }
      }
      const finalSt = await page.evaluate(name => {
        const t = window[name]
        return {speed: t?.speed ?? null, dutyState: t?.dutyState ?? null, haltedByDuty: Boolean(t?.haltedByDuty)}
      }, targetGlobalName)
      throw new Error(`pullOverTargetViaKeyE(${targetGlobalName}) failed: ${JSON.stringify(finalSt)}`)
    }

    let s11WalletBefore = null
    let s11CitedTargetId = null

    // S10: 站在桥中旋转视角一周（60秒），统计视野内凭空生成/消失车流数 === 0 -> captures/duty-3-e2e/12-traffic-far-spawn.png
    try {
      await ensureBridgeDutyActiveViaUi()
      await page.waitForFunction(
        () =>
          window.viewer?.dutyTraffic?.getActors?.().filter(a => window.__isOnJiefangBridgeDeck(a)).length >= 6,
        null,
        {timeout: 20000},
      )
      const midPt = await page.evaluate(() => {
        const [mx, mz] = window.__jiefangLocalToWorld(0, 17.8)
        return {mx, mz}
      })
      await walkAlongBridgePointWithKeys(midPt.mx, midPt.mz, 2.0, 26000)
      await page.evaluate(() => {
        window.viewer.walk.face(0.95, 0.08)
      })
      await page.waitForTimeout(1000)

      const s10Probe = await page.evaluate(
        () =>
          new Promise(resolve => {
            const DURATION_MS = 60_000
            const START_YAW = window.viewer.walk.yaw ?? 0.95
            const t0 = performance.now()
            const prevActors = new Map()
            const popInEvents = []
            const popOutEvents = []
            let frames = 0
            let maxActiveActors = 0
            let totalSpawnsObserved = 0
            let farDespawnsObserved = 0

            const projectInView120 = (x, y, z, cam) => {
              cam.updateMatrixWorld(true)
              if (cam.matrixWorldInverse?.elements) {
                const cw = cam.matrixWorld.elements
                const dist = Math.hypot(x - cw[12], y - cw[13], z - cw[14])
                const ve = cam.matrixWorldInverse.elements
                const pe = cam.projectionMatrix.elements
                const vx = ve[0] * x + ve[4] * y + ve[8] * z + ve[12]
                const vy = ve[1] * x + ve[5] * y + ve[9] * z + ve[13]
                const vz = ve[2] * x + ve[6] * y + ve[10] * z + ve[14]
                const vw = ve[3] * x + ve[7] * y + ve[11] * z + ve[15]
                const cx = pe[0] * vx + pe[4] * vy + pe[8] * vz + pe[12] * vw
                const cy = pe[1] * vx + pe[5] * vy + pe[9] * vz + pe[13] * vw
                const cz = pe[2] * vx + pe[6] * vy + pe[10] * vz + pe[14] * vw
                const cwClip = pe[3] * vx + pe[7] * vy + pe[11] * vz + pe[15] * vw
                if (cwClip <= 1e-4) return {dist, inView: false}
                const nx = cx / cwClip
                const ny = cy / cwClip
                const nz = cz / cwClip
                const inView = Math.abs(nx) <= 1.0 && Math.abs(ny) <= 1.0 && nz >= -1.0 && nz <= 1.0
                return {dist, inView}
              }
              return {dist: Infinity, inView: false}
            }

            const tick = now => {
              const elapsed = now - t0
              const frac = Math.min(1, elapsed / DURATION_MS)
              window.viewer.walk.face(START_YAW + frac * Math.PI * 2, 0.08)
              const cam = window.viewer.camera
              const actors = window.viewer.dutyTraffic?.getActors?.() ?? []
              if (actors.length > maxActiveActors) maxActiveActors = actors.length
              const curMap = new Map()
              for (let i = 0; i < actors.length; i++) {
                const a = actors[i]
                const key = a.id ?? i
                const visibleNow = a.scale >= 0.05
                curMap.set(key, {x: a.x, y: a.y, z: a.z, scale: a.scale, kind: a.kind, visibleNow})
                const prev = prevActors.get(key)
                if (frames > 0 && visibleNow && (!prev || !prev.visibleNow)) {
                  totalSpawnsObserved++
                  const pv = projectInView120(a.x, a.y + 0.9, a.z, cam)
                  if (pv.inView && pv.dist <= 120) {
                    popInEvents.push({
                      id: String(key),
                      kind: a.kind,
                      dist: +pv.dist.toFixed(1),
                      tMs: Math.round(elapsed),
                    })
                  }
                }
              }
              if (frames > 0) {
                for (const [key, prev] of prevActors.entries()) {
                  const cur = curMap.get(key)
                  if (prev.visibleNow && (!cur || !cur.visibleNow)) {
                    const pv = projectInView120(prev.x, prev.y + 0.9, prev.z, cam)
                    if (pv.inView && pv.dist <= 120) {
                      popOutEvents.push({
                        id: String(key),
                        kind: prev.kind,
                        dist: +pv.dist.toFixed(1),
                        tMs: Math.round(elapsed),
                      })
                    } else {
                      farDespawnsObserved++
                    }
                  }
                }
              }
              prevActors.clear()
              for (const [k, v] of curMap.entries()) prevActors.set(k, v)
              frames++
              if (elapsed < DURATION_MS) {
                requestAnimationFrame(tick)
              } else {
                resolve({
                  elapsedMs: Math.round(elapsed),
                  frames,
                  maxActiveActors,
                  popInCount: popInEvents.length,
                  popOutCount: popOutEvents.length,
                  popInEvents: popInEvents.slice(0, 8),
                  popOutEvents: popOutEvents.slice(0, 8),
                  totalSpawnsObserved,
                  farDespawnsObserved,
                  stats: window.viewer.dutyTraffic?.getStats?.() ?? null,
                })
              }
            }
            requestAnimationFrame(tick)
          }),
      )

      await page.evaluate(() => {
        window.viewer.walk.face(1.05, 0.08)
      })
      await page.waitForTimeout(200)
      const shot12 = await capture(page, '12-traffic-far-spawn.png')
      const ok =
        s10Probe.elapsedMs >= 58000 &&
        s10Probe.frames >= 30 &&
        s10Probe.maxActiveActors >= 6 &&
        s10Probe.popInCount === 0 &&
        s10Probe.popOutCount === 0
      addStep(
        'S10',
        '站立解放桥中旋转视角一周（60秒）统计视野 120m 内零凭空生成/消失',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify(s10Probe),
        shot12,
      )
    } catch (err) {
      const shot12 = await capture(page, '12-traffic-far-spawn.png')
      addStep('S10', '站立解放桥中旋转视角一周（60秒）统计视野 120m 内零凭空生成/消失', 'FAIL', err.message, shot12)
    }

    // S11: 拦停电驴超载+未戴盔双违规 -> F 键开单显示 ¥70 -> 撕单递交到骑手近侧手 -> captures/duty-3-e2e/13-multi-violation-handover.png
    try {
      await ensureBridgeDutyActiveViaUi()
      s11WalletBefore = await page.evaluate(() => ({
        stateMoney: window.viewer?.game?.getState?.()?.money ?? null,
        savedMoney: (() => {
          try {
            return JSON.parse(localStorage.getItem('glol.save.v1') || 'null')?.money ?? null
          } catch {
            return null
          }
        })(),
      }))

      let comboFound = null
      let simElapsedSec = 0
      for (let retry = 0; retry < 160 && !comboFound?.ok; retry++) {
        comboFound = await page.evaluate(curRetry => {
          const actors = window.viewer.dutyTraffic.getActors()
          const onDeck = window.__isOnJiefangBridgeDeck
          const toLocal = window.__worldToJiefangLocal
          const isOverloadNoHelmet = a =>
            Array.isArray(a.violations) &&
            a.violations.includes('ebike_overload') &&
            a.violations.includes('no_helmet')
          const candidates = actors
            .filter(a => a.kind === 'scooter' && !a.leaving && !a.pendingRecycle && !a.cited && a.scale >= 0.5 && onDeck(a))
            .map(a => {
              const [lx] = toLocal(a.x, a.z)
              return {a, lx, isCombo: isOverloadNoHelmet(a)}
            })
            .sort((u, v) => Number(v.isCombo) - Number(u.isCombo) || u.lx - v.lx)
          const combo = candidates.find(c => c.isCombo)
          if (!combo) {
            const p = window.viewer.walk?.position
            for (let i = 0; i < 40; i++) {
              window.viewer.dutyTraffic?.step?.(0.1, p)
            }
            const violatorsAll = actors
              .filter(a => a.kind === 'scooter' && a.violation && a.violation !== 'none')
              .map(a => {
                const [lx, lz] = toLocal(a.x, a.z)
                return {
                  id: a.id ?? null,
                  lx: +lx.toFixed(1),
                  lz: +lz.toFixed(1),
                  speed: +(a.speed ?? 0).toFixed(2),
                  dutyState: a.dutyState ?? null,
                  wrongWay: Boolean(a.wrongWay),
                  leaving: Boolean(a.leaving),
                  pendingRecycle: Boolean(a.pendingRecycle),
                  cited: Boolean(a.cited),
                  onDeck: onDeck(a),
                  violations: a.violations ?? null,
                }
              })
            return {
              ok: false,
              simSec: (curRetry + 1) * 4,
              violatorsAll,
              deckScooters: candidates.length,
            }
          }
          window.__s11Target = combo.a
          window.__placeAlongBridgeFacingTarget(combo.a, 2.7, combo.a.y, 0.72)
          return {
            ok: true,
            simSec: curRetry * 4,
            id: combo.a.id ?? null,
            violation: combo.a.violation ?? null,
            violations: combo.a.violations ?? null,
          }
        }, retry)
        simElapsedSec = comboFound?.simSec ?? simElapsedSec
        if (!comboFound.ok && retry % 3 === 0) await page.waitForTimeout(25)
      }
      if (!comboFound?.ok) {
        throw new Error(`no combo ebike_overload+no_helmet scooter spawned in ${simElapsedSec}s sim-time: ${JSON.stringify(comboFound)}`)
      }
      s11CitedTargetId = comboFound.id

      // Pull over via real short KeyE (handles SwiftShader slow frames & pulling_over decel)
      await pullOverTargetViaKeyE('__s11Target')

      await page.evaluate(() => {
        window.__placeAlongBridgeFacingTarget(window.__s11Target, 2.1, window.__s11Target?.y, 0.72)
      })
      await page.waitForFunction(
        () => window.viewer?.trafficDuty?.getInteractCandidate?.()?.action === 'whistle_cite',
        null,
        {timeout: 6000},
      )
      await page.keyboard.press('KeyF')
      await page.waitForSelector('.td-fine-terminal', {timeout: 6000})
      await page.waitForTimeout(250)

      const termCheck = await page.evaluate(() => {
        const ft = window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.() ?? null
        const domText = document.querySelector('.td-fine-terminal')?.textContent ?? ''
        return {
          fineYuan: ft?.fineYuan ?? null,
          violation: ft?.violation ?? null,
          violations: ft?.violations ?? null,
          violationLabel: ft?.violationLabel ?? null,
          lineItems: ft?.lineItems ?? null,
          domHas70: /¥\s*70|70/.test(domText),
          domText: domText.slice(0, 260),
        }
      })

      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      })
      await page.keyboard.press('Enter')
      await page.waitForFunction(
        () => {
          const ft = window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()
          const primary = document.querySelector('.td-ft-btn-primary')
          return ft?.phase === 'deliver' || Boolean(primary?.textContent?.includes('撕下'))
        },
        null,
        {timeout: 30000},
      )
      const needManualTearS11 = await page.evaluate(
        () => window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()?.phase !== 'deliver',
      )
      if (needManualTearS11) {
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        })
        await page.keyboard.press('KeyF')
      }
      await page.waitForFunction(
        () => {
          const ft = window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()
          return ft?.phase === 'deliver' && ft.paperTornOff === true
        },
        null,
        {timeout: 12000},
      )

      // Turn character body toward rider via a short KeyW tick, then settle clearly beside rider within <=1.5m
      await page.keyboard.down('KeyW')
      await page.evaluate(() => {
        const t = window.__s11Target
        const [, tlz] = window.__worldToJiefangLocal(t.x, t.z)
        const towardCenter = Math.abs(tlz) >= 14.1 ? -1 : 1
        window.__placeAlongBridgeFacingTarget(t, 1.05, t.y, 0.45, towardCenter)
        for (let s = 0; s < 3; s++) window.viewer.walk.tick(1 / 60)
      })
      await page.keyboard.up('KeyW')
      const nearSideProbe = await page.evaluate(() => {
        const t = window.__s11Target
        const [, tlz] = window.__worldToJiefangLocal(t.x, t.z)
        const towardCenter = Math.abs(tlz) >= 14.1 ? -1 : 1
        let placed = window.__placeAlongBridgeFacingTarget(t, 0.95, t.y, 0.45, towardCenter)
        if (!placed || placed.dist > 1.35) {
          placed = window.__placeAlongBridgeFacingTarget(t, 0.72, t.y, 0.35, towardCenter)
        }
        const p = window.viewer.walk.position
        const lBone = window.viewer.dutyTraffic.getActorHandBone?.(t, 'left')
        const rBone = window.viewer.dutyTraffic.getActorHandBone?.(t, 'right')
        lBone?.updateWorldMatrix?.(true, false)
        rBone?.updateWorldMatrix?.(true, false)
        const le = lBone?.matrixWorld?.elements
        const re = rBone?.matrixWorld?.elements
        const distLeft = le ? Math.hypot(p.x - le[12], p.z - le[14]) : null
        const distRight = re ? Math.hypot(p.x - re[12], p.z - re[14]) : null
        const expectedNearSide =
          distLeft !== null && distRight !== null ? (distLeft <= distRight ? 'left' : 'right') : null
        return {
          placedDist: placed?.dist ?? null,
          distLeft: distLeft !== null ? +distLeft.toFixed(3) : null,
          distRight: distRight !== null ? +distRight.toFixed(3) : null,
          expectedNearSide,
        }
      })

      await page
        .waitForFunction(
          () => {
            const btn = document.querySelector('.td-ft-btn-deliver')
            return Boolean(btn && !btn.disabled)
          },
          null,
          {timeout: 8000},
        )
        .catch(async e => {
          const diag = await page
            .evaluate(() => {
              const t = window.__s11Target
              const p = window.viewer.walk?.position
              const [tlx, tlz] = t ? window.__worldToJiefangLocal(t.x, t.z) : [null, null]
              const [plx, plz] = p ? window.__worldToJiefangLocal(p.x, p.z) : [null, null]
              return {
                ft: window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.() ?? null,
                tLocal: {lx: tlx, lz: tlz},
                pLocal: {lx: plx, lz: plz},
              }
            })
            .catch(() => null)
          throw new Error(`${e.message} | deliverDiag=${JSON.stringify({nearSideProbe, diag})}`)
        })
      await page.keyboard.press('KeyF')
      await page.waitForFunction(
        () =>
          !document.querySelector('.td-fine-terminal') &&
          (window.viewer?.trafficDuty?.getSnapshot?.()?.citedCount ?? 0) >= 1,
        null,
        {timeout: 12000},
      )
      await page.waitForTimeout(780)

      const handoverProbe = await page.evaluate(() => {
        const t = window.__s11Target
        const lBone = t ? window.viewer.dutyTraffic.getActorHandBone?.(t, 'left') : null
        const rBone = t ? window.viewer.dutyTraffic.getActorHandBone?.(t, 'right') : null
        const slipLeft = Boolean(lBone?.getObjectByName?.('duty-receipt-slip'))
        const slipRight = Boolean(rBone?.getObjectByName?.('duty-receipt-slip'))
        const snap = window.viewer.trafficDuty.getSnapshot()
        return {
          citedCount: snap.citedCount,
          totalFineYuan: snap.totalFineYuan,
          pendingEarningsYuan: snap.pendingEarningsYuan ?? null,
          targetCited: Boolean(t?.cited),
          targetHoldingReceipt: Boolean(t?.holdingReceipt),
          actorHandSide: t?.heldTicketHandSide ?? t?.handSide ?? null,
          slipLeft,
          slipRight,
          actualHandSide: slipLeft ? 'left' : slipRight ? 'right' : t?.heldTicketHandSide ?? t?.handSide ?? null,
          walletMoneyAfterS11: window.viewer?.game?.getState?.()?.money ?? null,
        }
      })
      // Frame camera from receiving-hand side slightly toward scooter end (no lamp pole, no railing, zero volunteer-blocks-scooter occlusion)
      await page.evaluate(() => {
        const t = window.__s11Target
        const p = window.viewer.walk.position
        if (t && p) {
          const midX = (t.x + p.x) * 0.5
          const midZ = (t.z + p.z) * 0.5
          const [midLx, midLz] = window.__worldToJiefangLocal(midX, midZ)
          const [tlx, tlz] = window.__worldToJiefangLocal(t.x, t.z)
          const [plx, plz] = window.__worldToJiefangLocal(p.x, p.z)
          const onSouth = tlz >= 0
          const pSideSign = plz >= tlz ? 1 : -1
          const maxAllowedDz = onSouth
            ? pSideSign > 0
              ? Math.max(0.8, 17.5 - plz)
              : Math.max(0.8, plz - 12.65)
            : pSideSign > 0
              ? Math.max(0.8, -12.65 - plz)
              : Math.max(0.8, plz + 17.5)
          const stepDz = Math.min(2.6, maxAllowedDz) * pSideSign
          const towardScooterSign = tlx >= plx ? 1 : -1
          const stepDx = towardScooterSign * Math.max(1.2, Math.sqrt(Math.max(1.4, 16.0 - stepDz * stepDz)))
          const [camWx, camWz] = window.__jiefangLocalToWorld(midLx + stepDx, midLz + stepDz)
          window.viewer.walk.face(Math.atan2(-(midX - camWx), -(midZ - camWz)), 0.14)
        }
      })
      await page.waitForTimeout(140)
      const shot13 = await capture(page, '13-multi-violation-handover.png')

      const ok =
        termCheck.fineYuan === 70 &&
        termCheck.domHas70 &&
        handoverProbe.citedCount === 1 &&
        handoverProbe.totalFineYuan === 70 &&
        handoverProbe.targetCited &&
        handoverProbe.targetHoldingReceipt &&
        (handoverProbe.slipLeft !== handoverProbe.slipRight) &&
        nearSideProbe.expectedNearSide !== null &&
        handoverProbe.actualHandSide === nearSideProbe.expectedNearSide &&
        (s11WalletBefore?.stateMoney === null ||
          handoverProbe.walletMoneyAfterS11 === s11WalletBefore.stateMoney)

      addStep(
        'S11',
        '拦停电驴超载+未戴盔双违规开单显示 ¥70 并撕单递交至近侧手部',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify({comboFound, termCheck, nearSideProbe, handoverProbe, s11WalletBefore}),
        shot13,
      )
    } catch (err) {
      const shot13 = await capture(page, '13-multi-violation-handover.png')
      await page
        .evaluate(() => {
          window.viewer?.getActiveFineTerminalSession?.()?.cancel?.('cancelled')
        })
        .catch(() => {})
      addStep('S11', '拦停电驴超载+未戴盔双违规开单显示 ¥70 并撕单递交至近侧手部', 'FAIL', err.message, shot13)
    }

    // S12: 开满 2 单回找交警触发下班结算（3 机位），核对钱包增加 Math.round(合计*10%) -> captures/duty-3-e2e/14-offduty-settlement.png
    try {
      await ensureBridgeDutyActiveViaUi()
      // Cite remaining tickets up to 2 so S12 stays self-contained even if S11 cited 0
      for (let slot = 0; slot < 2; slot++) {
        const curCited = await page.evaluate(() => window.viewer.trafficDuty.getSnapshot().citedCount)
        if (curCited >= 2) break
        let nextFound = null
        let s12SimSec = 0
        for (let retry = 0; retry < 150 && !nextFound?.ok; retry++) {
          nextFound = await page.evaluate(
            ({prevId, curRetry}) => {
              const actors = window.viewer.dutyTraffic.getActors()
              const onDeck = window.__isOnJiefangBridgeDeck
              const toLocal = window.__worldToJiefangLocal
              const pick = actors
                .filter(
                  a =>
                    a.id !== prevId &&
                    a.kind === 'scooter' &&
                    !a.leaving &&
                    !a.pendingRecycle &&
                    !a.cited &&
                    a.scale >= 0.5 &&
                    a.violation &&
                    a.violation !== 'none' &&
                    onDeck(a),
                )
                .map(a => {
                  const [lx, lz] = toLocal(a.x, a.z)
                  return {a, southPenalty: lz >= 0 ? 0 : 1, westDist: Math.abs(lx + 75)}
                })
                .sort((u, v) => u.southPenalty - v.southPenalty || u.westDist - v.westDist)[0]
              if (!pick) {
                const p = window.viewer.walk?.position
                for (let i = 0; i < 40; i++) {
                  window.viewer.dutyTraffic?.step?.(0.1, p)
                }
                return {
                  ok: false,
                  simSec: (curRetry + 1) * 4,
                  violatorsAll: actors
                    .filter(a => a.kind === 'scooter' && a.violation && a.violation !== 'none')
                    .map(a => {
                      const [lx, lz] = toLocal(a.x, a.z)
                      return {
                        id: a.id ?? null,
                        lx: +lx.toFixed(1),
                        lz: +lz.toFixed(1),
                        speed: +(a.speed ?? 0).toFixed(2),
                        dutyState: a.dutyState ?? null,
                        cited: Boolean(a.cited),
                        onDeck: onDeck(a),
                        violations: a.violations ?? null,
                      }
                    }),
                }
              }
              window.__s12Target = pick.a
              window.__placeAlongBridgeFacingTarget(pick.a, 2.7, pick.a.y, 0.72)
              return {ok: true, id: pick.a.id ?? null, violation: pick.a.violation, violations: pick.a.violations ?? null}
            },
            {prevId: s11CitedTargetId, curRetry: retry},
          )
          s12SimSec = nextFound?.simSec ?? s12SimSec
          if (!nextFound.ok && retry % 3 === 0) await page.waitForTimeout(25)
        }
        if (!nextFound?.ok) {
          throw new Error(`failed to find violator #${slot + 1} on Jiefang Bridge in ${s12SimSec}s S12: ${JSON.stringify(nextFound)}`)
        }

        await pullOverTargetViaKeyE('__s12Target')
        await page.evaluate(() => {
          window.__placeAlongBridgeFacingTarget(window.__s12Target, 2.1, window.__s12Target?.y, 0.72)
        })
        await page.waitForFunction(
          () => window.viewer?.trafficDuty?.getInteractCandidate?.()?.action === 'whistle_cite',
          null,
          {timeout: 6000},
        )
        await page.keyboard.press('KeyF')
        await page.waitForSelector('.td-fine-terminal', {timeout: 6000})
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        })
        await page.keyboard.press('Enter')
        await page.waitForFunction(
          () => {
            const ft = window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()
            const primary = document.querySelector('.td-ft-btn-primary')
            return ft?.phase === 'deliver' || Boolean(primary?.textContent?.includes('撕下'))
          },
          null,
          {timeout: 30000},
        )
        const needManualTearS12 = await page.evaluate(
          () => window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()?.phase !== 'deliver',
        )
        if (needManualTearS12) {
          await page.keyboard.press('KeyF')
        }
        await page.waitForFunction(
          () => {
            const ft = window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()
            return ft?.phase === 'deliver' && ft.paperTornOff === true
          },
          null,
          {timeout: 12000},
        )
        await page.evaluate(() => {
          const t = window.__s12Target
          const [, tlz] = window.__worldToJiefangLocal(t.x, t.z)
          const towardCenter = Math.abs(tlz) >= 14.1 ? -1 : 1
          window.__placeAlongBridgeFacingTarget(t, 1.05, t.y, 0.22, towardCenter)
        })
        await page.waitForFunction(
          () => {
            const btn = document.querySelector('.td-ft-btn-deliver')
            return Boolean(btn && !btn.disabled)
          },
          null,
          {timeout: 8000},
        )
        await page.keyboard.press('KeyF')
        await page.waitForFunction(
          prev =>
            !document.querySelector('.td-fine-terminal') &&
            (window.viewer?.trafficDuty?.getSnapshot?.()?.citedCount ?? 0) >= prev + 1,
          curCited,
          {timeout: 12000},
        )
      }

      const preSettle = await page.evaluate(() => {
        const snap = window.viewer.trafficDuty.getSnapshot()
        let savedMoney = null
        try {
          savedMoney = JSON.parse(localStorage.getItem('glol.save.v1') || 'null')?.money ?? null
        } catch {
          savedMoney = null
        }
        return {
          citedCount: snap.citedCount,
          totalFineYuan: snap.totalFineYuan,
          pendingEarningsYuan: snap.pendingEarningsYuan ?? null,
          expectedShare: Math.round(snap.totalFineYuan * 0.1),
          stateMoney: window.viewer?.game?.getState?.()?.money ?? null,
          savedMoney,
        }
      })

      // Walk via real ShiftLeft+KeyW (+ Space hop if blocked by railing/curb) onto south sidewalk, then west to Jiefang officer
      const walkPlan = await page.evaluate(() => {
        const p = window.viewer.walk.position
        const [lx, lz] = window.__worldToJiefangLocal(p.x, p.z)
        if (lz < 13.0) {
          const safeLx = Math.max(-132, Math.min(132, lx))
          const [wxSouth, wzSouth] = window.__jiefangLocalToWorld(safeLx, 16.5)
          return {crossSouth: {x: wxSouth, z: wzSouth}, curLx: lx, curLz: lz}
        }
        return {crossSouth: null, curLx: lx, curLz: lz}
      })
      if (walkPlan.crossSouth) {
        await walkAlongBridgePointWithKeys(walkPlan.crossSouth.x, walkPlan.crossSouth.z, 2.2, 45000)
      }
      const officerWalkDist = await walkAlongBridgePointWithKeys(-267.3, 25.8, 0.65, 65000)
      await page.evaluate(() => {
        const p = window.viewer.walk.position
        window.viewer.walk.face(Math.atan2(-(-266.26 - p.x), -(26.86 - p.z)), 0.08)
      })
      await page.waitForTimeout(350)

      let officerCand = await page.evaluate(() => {
        const p = window.viewer.walk.position
        return {
          walkDist: Math.hypot(-267.3 - p.x, 25.8 - p.z),
          officerDistActual: Math.hypot(-266.26 - p.x, 26.86 - p.z),
          walkPos: {x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2)},
          snap: window.viewer.trafficDuty.getSnapshot(),
          cand: window.viewer.trafficDuty.getInteractCandidate(),
          arbiter: window.viewer.walk.getInteractDecision?.() ?? null,
        }
      })
      if (officerCand.cand?.action !== 'talk_officer' || officerCand.officerDistActual > 2.0) {
        await walkAlongBridgePointWithKeys(-267.3, 25.8, 0.65, 18000)
        await page.waitForTimeout(350)
        officerCand = await page.evaluate(() => {
          const p = window.viewer.walk.position
          return {
            walkDist: Math.hypot(-267.3 - p.x, 25.8 - p.z),
            officerDistActual: Math.hypot(-266.26 - p.x, 26.86 - p.z),
            walkPos: {x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2)},
            snap: window.viewer.trafficDuty.getSnapshot(),
            cand: window.viewer.trafficDuty.getInteractCandidate(),
            arbiter: window.viewer.walk.getInteractDecision?.() ?? null,
          }
        })
      }
      if (officerCand.cand?.action !== 'talk_officer') {
        throw new Error(`expected talk_officer near west officer (walkDist=${officerWalkDist.toFixed(2)}): ${JSON.stringify(officerCand)}`)
      }

      await page.keyboard.press('KeyF')
      await page.waitForSelector('.td-story-dialog:not([hidden])', {timeout: 8000}).catch(e => {
        throw new Error(`${e.message} | officerCand=${JSON.stringify(officerCand)}`)
      })

      const shotsSeen = new Set()
      const dialogueLog = []
      let shot14 = 'captures/duty-3-e2e/14-offduty-settlement.png'
      let shot14Taken = false

      for (let i = 0; i < 16; i++) {
        await page.waitForTimeout(360)
        const stepState = await page.evaluate(() => {
          const dlg = document.querySelector('.td-story-dialog')
          const dlgOpen = Boolean(dlg && !dlg.hasAttribute('hidden') && getComputedStyle(dlg).display !== 'none')
          const story = window.viewer.trafficDuty.getStorySnapshot?.() ?? null
          const choices = Array.from(document.querySelectorAll('.td-story-dialog:not([hidden]) .td-story-choice')).map(
            el => ({
              id: el.getAttribute('data-td-story-choice') ?? '',
              text: el.textContent?.trim() ?? '',
            }),
          )
          const renderedText = document.querySelector('.td-story-dialog:not([hidden]) .td-story-text')?.textContent ?? ''
          return {
            dlgOpen,
            beatId: story?.beatId ?? null,
            lineIndex: story?.lineIndex ?? null,
            shot: story?.currentShot ?? null,
            lineText: story?.line?.text ?? renderedText,
            renderedText,
            choices,
          }
        })
        if (!stepState.dlgOpen) break
        if (stepState.shot) shotsSeen.add(stepState.shot)
        dialogueLog.push({
          lineIndex: stepState.lineIndex,
          beatId: stepState.beatId,
          shot: stepState.shot,
          text: stepState.lineText,
        })
        const looksLikeSummaryLine =
          /\d/.test(stepState.lineText) &&
          (stepState.lineText.includes('分成') ||
            stepState.lineText.includes('结算') ||
            stepState.lineText.includes('合计') ||
            stepState.lineText.includes(String(preSettle.expectedShare)))
        if (looksLikeSummaryLine || !shot14Taken) {
          shot14 = await capture(page, '14-offduty-settlement.png')
          shot14Taken = true
        }

        const preferChoice = stepState.choices.find(
          c =>
            !/继续执勤|再守|暂不|cancel|decline/i.test(`${c.id} ${c.text}`) &&
            /settle|off|finish|confirm|accept|下班|结算|交班/i.test(`${c.id} ${c.text}`),
        )
        const fallbackChoice = stepState.choices.find(
          c => !/继续执勤|再守|暂不|cancel|decline/i.test(`${c.id} ${c.text}`),
        )
        if (preferChoice || fallbackChoice) {
          const targetChoice = preferChoice ?? fallbackChoice
          await page
            .locator(`.td-story-dialog:not([hidden]) .td-story-choice[data-td-story-choice="${targetChoice.id}"]`)
            .click()
        } else {
          const nextBtn = page.locator('.td-story-dialog:not([hidden]) [data-td-story-action="next"]')
          if ((await nextBtn.count()) > 0 && (await nextBtn.first().isVisible())) {
            await nextBtn.first().click()
          } else {
            break
          }
        }
      }

      await page.waitForFunction(
        () => {
          const dlg = document.querySelector('.td-story-dialog')
          const dlgOpen = Boolean(dlg && !dlg.hasAttribute('hidden') && getComputedStyle(dlg).display !== 'none')
          return !window.viewer.trafficDuty.isStoryOpen?.() && !dlgOpen
        },
        null,
        {timeout: 8000},
      )
      await page.waitForTimeout(450)

      const postSettle = await page.evaluate(() => {
        const snap = window.viewer.trafficDuty.getSnapshot()
        let savedMoney = null
        try {
          savedMoney = JSON.parse(localStorage.getItem('glol.save.v1') || 'null')?.money ?? null
        } catch {
          savedMoney = null
        }
        return {
          phase: snap.phase,
          pendingEarningsYuan: snap.pendingEarningsYuan ?? null,
          stateMoney: window.viewer?.game?.getState?.()?.money ?? null,
          savedMoney,
          settlement: window.viewer?.trafficDuty?.getShiftSettlement?.() ?? null,
        }
      })

      await page.evaluate(() => {
        window.viewer?.trafficDuty?.closePanel?.()
      })

      const deltaWallet =
        postSettle.stateMoney !== null && preSettle.stateMoney !== null
          ? postSettle.stateMoney - preSettle.stateMoney
          : null
      const deltaSaved =
        postSettle.savedMoney !== null && preSettle.savedMoney !== null
          ? postSettle.savedMoney - preSettle.savedMoney
          : null
      const joinedDialogue = dialogueLog.map(d => d.text).join(' ')
      const dialogueMentionsAll =
        joinedDialogue.includes(String(preSettle.citedCount)) &&
        joinedDialogue.includes(String(preSettle.totalFineYuan)) &&
        joinedDialogue.includes(String(preSettle.expectedShare))
      const walletUnchangedBeforeSettle =
        s11WalletBefore?.stateMoney === null || preSettle.stateMoney === s11WalletBefore.stateMoney

      const ok =
        preSettle.citedCount >= 2 &&
        preSettle.totalFineYuan >= 70 &&
        walletUnchangedBeforeSettle &&
        shotsSeen.size >= 3 &&
        dialogueMentionsAll &&
        deltaWallet === preSettle.expectedShare &&
        (deltaWallet ?? 0) > 0 &&
        (deltaSaved === null || deltaSaved === preSettle.expectedShare) &&
        (postSettle.pendingEarningsYuan ?? 0) === 0 &&
        postSettle.phase !== 'active'

      addStep(
        'S12',
        '开满 2 单回找交警下班结算（3 机位 + 台词含开单数/合计/10%分成 + 钱包增加合计×10%）',
        ok ? 'PASS' : 'FAIL',
        JSON.stringify({
          officerCand,
          preSettle,
          postSettle,
          deltaWallet,
          deltaSaved,
          shotsSeen: [...shotsSeen],
          dialogueMentionsAll,
          walletUnchangedBeforeSettle,
          dialogueLog,
        }),
        shot14,
      )
    } catch (err) {
      const shot14 = await capture(page, '14-offduty-settlement.png')
      addStep(
        'S12',
        '开满 2 单回找交警下班结算（3 机位 + 台词含开单数/合计/10%分成 + 钱包增加合计×10%）',
        'FAIL',
        err.message,
        shot14,
      )
    }

    await page.close()
  } finally {
    await context?.close().catch(() => {})
    if (browser) {
      await browser.close().catch(() => {})
    }
    await rm(bundleDir, {recursive: true, force: true}).catch(() => {})
    void ownsBrowser
  }

  const passed = steps.filter(s => s.status === 'PASS').length
  const failed = steps.filter(s => s.status === 'FAIL').length
  const report = {
    walkUrl: WALK_URL,
    verifyUrl: VERIFY_URL,
    browserMode: mode,
    timestamp: new Date().toISOString(),
    passed,
    failed,
    ERRS,
    steps,
  }
  await writeFile(resolve(SHOT_DIR, 'report.json'), JSON.stringify(report, null, 2))
  console.log('\nERRS=' + JSON.stringify(ERRS))
  console.log(`SUMMARY passed=${passed} failed=${failed}`)
  if (failed > 0 || ERRS.length > 0) process.exitCode = 1
}

await run()
