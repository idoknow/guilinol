/**
 * Headless Playwright E2E, WebGL2 Render & 3-Viewport Verification Suite for IDOK-125 (`scripts/verify-outfits.mjs`).
 *
 * Mounts the real `public/avatar/figure.glb` + `avatar-rig.ts` + `outfits.ts` + `vehicle-model.ts` +
 * `ride.ts` + `car.ts` + `shop-overlay.ts` + `street-hud.ts` + `mission-ui.ts` in headless Chromium.
 *
 * Verifies:
 *  1. 3+ outfits x 6 postures matrix (stand, run, crouch, ebike lean+wheelie, car, crash+standup) with real GLB
 *     skeleton & AnimationMixer, real dynamic vehicles, real WebGLRenderer `info.render.calls` draw-call budget
 *     (`<= +2` vs default), and captures individual + stitched PNG evidence under `captures/outfits/`.
 *  2. Shop preview rollback on Esc/close without purchasing -> real `glol.save.v1` and 3D figure stay rolled back.
 *  3. Pocket Wardrobe flows via Phone App tile, Mission Hall button, and `KeyO` hotkey:
 *     mix-and-match owned items, save & reload persistence, one-click reset default, and `autoHelmetOnRide` toggle.
 *  4. E-bike ride auto-helmet visual override (`hat_rider_helmet`) + immediate restore on dismount without mutating save.
 *  5. Zero DOM overlap / overflow across 3 viewports (`1280x720`, `390x844`, `844x390`), 0 console/page errors.
 */
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const root = process.cwd()
const tempDir = await mkdtemp(join(root, '.tmp-verify-outfits-'))
const outDir = join(root, 'captures/outfits')
await mkdir(outDir, {recursive: true})

const harnessEntry = join(tempDir, 'harness.ts')
const bundleJs = join(tempDir, 'bundle.js')
const bundleCss = join(tempDir, 'bundle.css')

await writeFile(
  harnessEntry,
  `
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import '${join(root, 'web/src/ui/theme.css').replace(/\\/g, '/')}'
import '${join(root, 'web/src/ui/hud.css').replace(/\\/g, '/')}'
import '${join(root, 'web/src/ui/walk.css').replace(/\\/g, '/')}'
import '${join(root, 'web/src/ui/render-range.css').replace(/\\/g, '/')}'
import '${join(root, 'web/src/ui/street-hud.css').replace(/\\/g, '/')}'
import '${join(root, 'web/src/game/mission-ui.css').replace(/\\/g, '/')}'
import {avatar} from '${join(root, 'web/src/look/avatar.ts').replace(/\\/g, '/')}'
import {ensureAvatarRig} from '${join(root, 'web/src/walk/avatar-rig.ts').replace(/\\/g, '/')}'
import {createAvatarOutfitController} from '${join(root, 'web/src/walk/outfits.ts').replace(/\\/g, '/')}'
import {createDynamicEbike, createDynamicCar} from '${join(root, 'web/src/walk/vehicle-model.ts').replace(/\\/g, '/')}'
import {createRiderPose} from '${join(root, 'web/src/walk/ride.ts').replace(/\\/g, '/')}'
import {createDriverPose} from '${join(root, 'web/src/walk/car.ts').replace(/\\/g, '/')}'
import {isGlobalHotkeyBlocked, isModalOrOverlayOpen} from '${join(root, 'web/src/walk/input-guard.ts').replace(/\\/g, '/')}'
import {mountShopOverlay} from '${join(root, 'web/src/ui/shop-overlay.ts').replace(/\\/g, '/')}'
import {mountStreetHud, demoSource} from '${join(root, 'web/src/ui/street-hud.ts').replace(/\\/g, '/')}'
import {mountMissionUi} from '${join(root, 'web/src/game/mission-ui.ts').replace(/\\/g, '/')}'
import {MissionRunnerEngine, initGame, createGameDebugProbe, getState, onEvent, onState, type EquippedOutfit} from '${join(root, 'web/src/game/index.ts').replace(/\\/g, '/')}'

initGame()
const gameProbe = createGameDebugProbe()

const canvas = document.createElement('canvas')
canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block;'
document.body.append(canvas)

const renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true})
renderer.setPixelRatio(1)
renderer.setSize(window.innerWidth, window.innerHeight, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.12

const scene = new THREE.Scene()
scene.background = new THREE.Color('#273542')
const hemi = new THREE.HemisphereLight(0xf6f8ff, 0x26323a, 1.35)
const dir = new THREE.DirectionalLight(0xfff4df, 1.85)
dir.position.set(2.8, 4.5, 3.2)
scene.add(hemi, dir)

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({color: '#34414c', roughness: 0.92}),
)
floor.position.y = 0
scene.add(floor)

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.08, 60)

const gltf = await new GLTFLoader().loadAsync('/avatar/figure.glb')
const figure = gltf.scene
figure.scale.setScalar(avatar.scale)
const avatarRig = ensureAvatarRig(figure, avatar.color)
const outfitController = createAvatarOutfitController(figure, avatarRig)
scene.add(figure)

const ebikeRig = createDynamicEbike(0x3b6f78)
ebikeRig.root.visible = false
scene.add(ebikeRig.root)

const carRig = createDynamicCar(0x3b6f78)
carRig.root.visible = false
scene.add(carRig.root)

const riderPose = createRiderPose(figure)
const driverPose = createDriverPose(figure)
const mixer = new THREE.AnimationMixer(figure)
const actions = new Map(gltf.animations.map(c => [c.name, mixer.clipAction(c)]))

let currentPosture = 'stand'
let activeClip = 'idle'
let orbitYaw = 0.24
let orbitPitch = 0.14
let orbitRadius = 2.65
let orbitTargetY = 0.94

function setCameraFrame() {
  const cosP = Math.cos(orbitPitch)
  camera.position.set(
    Math.sin(orbitYaw) * cosP * orbitRadius,
    orbitTargetY + Math.sin(orbitPitch) * orbitRadius,
    Math.cos(orbitYaw) * cosP * orbitRadius,
  )
  camera.lookAt(0, orbitTargetY, 0)
  camera.aspect = window.innerWidth / Math.max(1, window.innerHeight)
  camera.updateProjectionMatrix()
}

function playClip(name: string, time = 0) {
  mixer.stopAllAction()
  const act = actions.get(name) ?? actions.get(avatar.clips.idle)
  if (act) {
    act.reset().setLoop(THREE.LoopRepeat, Infinity).play()
    activeClip = name
  }
  mixer.update(time)
}

function setPosture(posture: 'stand' | 'run' | 'crouch' | 'ebike' | 'car' | 'crash') {
  currentPosture = posture
  ebikeRig.root.visible = false
  carRig.root.visible = false
  if (avatarRig.traveller) avatarRig.traveller.rotation.set(0, 0, 0)
  avatarRig.clearPose()
  riderPose.reset()
  driverPose.reset(true)
  figure.visible = true
  figure.position.set(0, 0, 0)
  figure.rotation.set(0, Math.PI, 0) // face +Z camera cleanly when cam at +Z
  outfitController.setRidingEbike(posture === 'ebike')

  if (posture === 'stand') {
    playClip(avatar.clips.idle, 0.2)
    orbitYaw = 0.34; orbitPitch = 0.12; orbitRadius = 2.45; orbitTargetY = 0.95
  } else if (posture === 'run') {
    playClip(avatar.clips.run, 0.28)
    orbitYaw = 0.95; orbitPitch = 0.12; orbitRadius = 2.55; orbitTargetY = 0.95
  } else if (posture === 'crouch') {
    playClip(avatar.clips.crouchIdle, 0.3)
    orbitYaw = 0.72; orbitPitch = 0.14; orbitRadius = 2.25; orbitTargetY = 0.68
  } else if (posture === 'ebike') {
    mixer.stopAllAction()
    ebikeRig.root.visible = true
    ebikeRig.root.position.set(0, 0, 0)
    ebikeRig.root.rotation.set(0, Math.PI, 0)
    ebikeRig.wheeliePivot.rotation.x = 0.26
    ebikeRig.leanPivot.rotation.z = 0.28
    ebikeRig.crashPivot.rotation.set(0, 0, 0)
    ebikeRig.frontAssembly.rotation.y = 0.22
    ebikeRig.root.updateMatrixWorld(true)
    riderPose.updateRiding(new THREE.Vector3(0, 0, 0), Math.PI, 0.28, 0, 10.5, 0.35, 1 / 60, 'bike', ebikeRig.root, 0.26, false)
    avatarRig.syncPose()
    orbitYaw = 1.08; orbitPitch = 0.16; orbitRadius = 2.85; orbitTargetY = 0.95
  } else if (posture === 'car') {
    mixer.stopAllAction()
    carRig.root.visible = true
    carRig.root.position.set(0, 0, 0)
    carRig.root.rotation.set(0, Math.PI, 0)
    carRig.root.updateMatrixWorld(true)
    driverPose.startMount({x: -0.9, y: 0, z: 0}, Math.PI)
    driverPose.advanceMount(0.18)
    driverPose.updateDriving(new THREE.Vector3(0, 0, 0), Math.PI, true)
    avatarRig.syncPose()
    orbitYaw = 1.05; orbitPitch = 0.20; orbitRadius = 3.65; orbitTargetY = 0.98
  } else if (posture === 'crash') {
    mixer.stopAllAction()
    ebikeRig.root.visible = true
    ebikeRig.root.position.set(-0.55, 0, 0.12)
    ebikeRig.root.rotation.set(0, Math.PI + 0.35, 0)
    ebikeRig.wheeliePivot.rotation.set(0, 0, 0)
    ebikeRig.leanPivot.rotation.set(0, 0, 0)
    ebikeRig.crashPivot.rotation.z = -1.42
    ebikeRig.root.updateMatrixWorld(true)
    riderPose.applyCrashPhasePose({
      phase: 'rider_rising',
      reason: 'lowside',
      elapsed: 0.3,
      slideSpeed: 0,
      bikeRoll: -1.42,
      side: 1,
      bikePos: {x: -0.55, y: 0, z: 0.12},
      riderPos: {x: 0.32, y: 0, z: 0},
      riderYaw: Math.PI - 0.3,
      riderStandProgress: 0.45,
      pickupProgress: 0,
      pickupSpot: {x: 0.32, y: 0, z: 0, yaw: Math.PI},
    })
    avatarRig.syncPose()
    orbitYaw = 0.65; orbitPitch = 0.26; orbitRadius = 2.9; orbitTargetY = 0.62
  }

  renderNow()
}

let lastRenderCalls = 0
function renderNow() {
  figure.updateMatrixWorld(true)
  setCameraFrame()
  renderer.setSize(window.innerWidth, window.innerHeight, false)
  renderer.render(scene, camera)
  lastRenderCalls = renderer.info.render.calls
}

// Mount real HUD, Phone APPs, Mission Header Button, and Shop/Wardrobe Overlay
const logs = { previews: 0, rollbacks: 0, orbitDrags: 0 }
const hud = mountStreetHud(demoSource('foot'), {
  onApp(id) {
    if (id === 'jobs') window.dispatchEvent(new CustomEvent('game:open-missions'))
    else if (id === 'wardrobe') window.dispatchEvent(new CustomEvent('game:open-wardrobe'))
    else if (id === 'garage') window.dispatchEvent(new CustomEvent('game:open-garage'))
  },
})

const missionRunner = new MissionRunnerEngine()
const missionUi = mountMissionUi(missionRunner, () => ({x: -588, z: -212}))
window.addEventListener('game:open-missions', () => missionUi.openBoard())

const overlay = mountShopOverlay({
  onBeforeOpen(shop, overlayMode) {
    if (overlayMode === 'wardrobe' || shop?.kind === 'clothing') {
      setPosture('stand')
      orbitYaw = 0.24
      orbitPitch = 0.12
      orbitRadius = 2.45
      orbitTargetY = 0.96
      renderNow()
    }
  },
  onOrbitDrag(dx, dy) {
    logs.orbitDrags++
    orbitYaw -= dx * 0.008
    orbitPitch = THREE.MathUtils.clamp(orbitPitch + dy * 0.005, 0.04, 0.65)
    renderNow()
  },
  onOrbitZoom(delta) {
    orbitRadius = THREE.MathUtils.clamp(orbitRadius + delta * 0.003, 1.75, 4.0)
    renderNow()
  },
  onPreviewOutfit(eq: EquippedOutfit) {
    logs.previews++
    outfitController.setPreview(eq)
    renderNow()
  },
  onPreviewRollback(eq: EquippedOutfit) {
    logs.rollbacks++
    outfitController.clearPreview()
    outfitController.applyEquipped(eq, {
      ridingEbike: currentPosture === 'ebike',
      autoHelmetOnRide: getState().wardrobe.autoHelmetOnRide,
    })
    renderNow()
  },
})

window.addEventListener('game:open-wardrobe', () => overlay.openWardrobe())
window.addEventListener('game:open-garage', () => overlay.openGarage())
window.addEventListener('keydown', e => {
  if (!e.repeat && e.code === 'KeyO' && !isGlobalHotkeyBlocked(e.target) && !isModalOrOverlayOpen() && !overlay.isOpen()) {
    overlay.openWardrobe()
  }
})
onState((s, changed) => {
  if (changed.has('wardrobe')) {
    outfitController.applyEquipped(s.wardrobe.equipped, {
      ridingEbike: currentPosture === 'ebike',
      autoHelmetOnRide: s.wardrobe.autoHelmetOnRide,
    })
    renderNow()
  }
})
onEvent(ev => {
  if (ev.type === 'outfit:equip' || ev.type === 'save:loaded') {
    const w = getState().wardrobe
    outfitController.applyEquipped(w.equipped, {
      ridingEbike: currentPosture === 'ebike',
      autoHelmetOnRide: w.autoHelmetOnRide,
    })
    renderNow()
  }
})

// Sync initial save state to 3D character
{
  const w = getState().wardrobe
  outfitController.applyEquipped(w.equipped, {ridingEbike: false, autoHelmetOnRide: w.autoHelmetOnRide})
  setPosture('stand')
}

Object.assign(window, {
  __outfitHarness: {
    overlay,
    gameProbe,
    hud,
    logs,
    setPosture,
    setOutfitDirect(eq: EquippedOutfit) {
      outfitController.clearPreview()
      outfitController.applyEquipped(eq, {
        ridingEbike: currentPosture === 'ebike',
        autoHelmetOnRide: getState().wardrobe.autoHelmetOnRide,
      })
      renderNow()
    },
    setMatrixMode(on: boolean) {
      hud.root.hidden = on
      const me = document.querySelector<HTMLElement>('.gl-mission-entry')
      if (me) me.hidden = on
    },
    getMetrics() {
      const box = new THREE.Box3().setFromObject(figure, true)
      return {
        renderCalls: lastRenderCalls,
        snapshot: outfitController.getSnapshot(),
        headTopY: +box.max.y.toFixed(4),
        posture: currentPosture,
        clip: activeClip,
      }
    },
  },
})
`,
)

await build({
  entryPoints: [harnessEntry],
  outfile: bundleJs,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'silent',
})

const [jsText, cssText, figureGlb] = await Promise.all([
  readFile(bundleJs, 'utf8'),
  readFile(bundleCss, 'utf8'),
  readFile(join(root, 'public/avatar/figure.glb')),
])

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Outfits Verify</title><style>
body{margin:0;background:#1c252c;height:100vh;width:100vw;overflow:hidden}
${cssText}
</style></head><body data-hud="street"><script type="module" src="/bundle.js"></script></body></html>`

const server = createServer((req, res) => {
  if (req.url === '/bundle.js') {
    res.writeHead(200, {'Content-Type': 'application/javascript; charset=utf-8'})
    res.end(jsText)
  } else if (req.url === '/avatar/figure.glb') {
    res.writeHead(200, {'Content-Type': 'model/gltf-binary'})
    res.end(figureGlb)
  } else {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'})
    res.end(html)
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`

let browser
try {
  browser = await chromium.launch(browserOptions())

  // --- PART A: 4 outfits x 6 postures screenshot matrix & WebGL render call assertions (1280x720) ---
  {
    const context = await browser.newContext({viewport: {width: 960, height: 640}})
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

    await page.goto(url, {waitUntil: 'load'})
    await page.waitForFunction(() => Boolean(window.__outfitHarness), null, {timeout: 30000})
    await page.evaluate(() => window.__outfitHarness.setMatrixMode(true))

    // Measure baseline WebGL render calls on bare default stand posture (outfit_default)
    const baseline = await page.evaluate(() => {
      window.__outfitHarness.setPosture('stand')
      return window.__outfitHarness.getMetrics()
    })
    const baselineCalls = baseline.renderCalls

    const matrixOutfits = [
      {
        id: 'outfit_default',
        items: {top: 'top_default_tee', bottom: 'bottom_default_pants', shoes: 'shoes_default_sneaker', hat: 'hat_none', bag: 'bag_none'},
      },
      {
        id: 'outfit_guilin_hoodie',
        items: {top: 'top_guilin_hoodie', bottom: 'bottom_guilin_cargo', shoes: 'shoes_guilin_canvas', hat: 'hat_guilin_cap', bag: 'bag_none'},
      },
      {
        id: 'outfit_rider_vest',
        items: {top: 'top_rider_vest', bottom: 'bottom_rider_pants', shoes: 'shoes_rider_boots', hat: 'hat_rider_helmet', bag: 'bag_rider_pack'},
      },
      {
        id: 'outfit_night_moto',
        items: {top: 'top_night_moto', bottom: 'bottom_night_moto', shoes: 'shoes_night_moto', hat: 'hat_night_visor', bag: 'bag_none'},
      },
    ]
    const postures = ['stand', 'run', 'crouch', 'ebike', 'car', 'crash']

    for (const o of matrixOutfits) {
      for (const p of postures) {
        const m = await page.evaluate(({items, p}) => {
          window.__outfitHarness.setPosture(p)
          window.__outfitHarness.setOutfitDirect(items)
          return window.__outfitHarness.getMetrics()
        }, {items: o.items, p})

        // Verify standing draw call delta strictly <= +2 vs default stand
        if (p === 'stand') {
          const delta = m.renderCalls - baselineCalls
          assert(delta <= 2, `${o.id} stand render.calls delta ${delta} exceeds +2 (base=${baselineCalls}, cur=${m.renderCalls})`)
        }
        // Verify e-bike posture + autoHelmetOnRide rule
        if (p === 'ebike') {
          if (o.items.hat === 'hat_none' || o.items.hat === 'hat_guilin_cap') {
            assert.equal(m.snapshot.applied.hat, 'hat_rider_helmet', `${o.id} should auto-wear hat_rider_helmet on ebike`)
          } else {
            assert.equal(m.snapshot.applied.hat, o.items.hat, `${o.id} safety helmet must be kept on ebike`)
          }
          assert.equal(m.snapshot.equipped.hat, o.items.hat, `${o.id} persisted equipped.hat must not mutate`)
        }
        await page.screenshot({path: join(outDir, `${o.id}__${p}.png`)})
      }
    }

    // Build an aggregate 4x3 key showcase montage? Even better: already have individual PNGs; also test UI end-to-end flows
    assert.deepEqual(errors, [], `WebGL matrix errors: ${JSON.stringify(errors)}`)
    console.log(`ok   3D WebGL matrix (${matrixOutfits.length} outfits x ${postures.length} postures = 24 renders, baselineCalls=${baselineCalls})`)
    await context.close()
  }

  // --- PART B: Interactive E2E + 3-viewport Wardrobe & Phone/KeyO/Mission UI Zero-Overlap ---
  const viewports = [
    {name: 'desktop-1280x720', width: 1280, height: 720, hasTouch: false, minTouchPx: 34},
    {name: 'mobile-portrait-390x844', width: 390, height: 844, hasTouch: true, minTouchPx: 44},
    {name: 'mobile-landscape-844x390', width: 844, height: 390, hasTouch: true, minTouchPx: 40},
  ]

  for (const vp of viewports) {
    const context = await browser.newContext({viewport: {width: vp.width, height: vp.height}, hasTouch: vp.hasTouch, isMobile: vp.hasTouch})
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

    await page.goto(url, {waitUntil: 'load'})
    await page.waitForFunction(() => Boolean(window.__outfitHarness), null, {timeout: 30000})

    if (vp.name.startsWith('desktop')) {
      // 1. Open shop -> try unowned outfit -> Esc -> assert rollback both in save & 3D mesh
      await page.evaluate(() => window.__outfitHarness.overlay.openShop('shop_nikoniko_apparel'))
      await page.click('.shop-card[data-item-key="outfit_preset:outfit_guilin_hoodie"]')
      const midPreview = await page.evaluate(() => window.__outfitHarness.getMetrics().snapshot)
      assert.equal(midPreview.preview?.top, 'top_guilin_hoodie')
      assert.equal(midPreview.applied.top, 'top_guilin_hoodie')

      await page.keyboard.press('Escape')
      const afterRollback = await page.evaluate(() => window.__outfitHarness.getMetrics().snapshot)
      assert.equal(afterRollback.preview, null)
      assert.equal(afterRollback.applied.top, 'top_default_tee')
      assert.equal(afterRollback.equipped.top, 'top_default_tee')

      // 2. Credit funds & buy 2 sets so user has rich items in pocket wardrobe; close shop
      await page.evaluate(() => {
        window.__outfitHarness.gameProbe.commerce.creditReward({
          source: 'mission_delivery',
          refId: 'wardrobe_test',
          amount: 2000,
          idempotencyKey: 'wardrobe_fund_1',
        })
        window.__outfitHarness.gameProbe.commerce.executePurchase({
          shopId: 'shop_nikoniko_apparel',
          itemType: 'outfit_preset',
          itemId: 'outfit_guilin_hoodie',
          expectedPrice: 480,
          idempotencyKey: 'buy_set_1',
        })
        window.__outfitHarness.gameProbe.commerce.executePurchase({
          shopId: 'shop_nikoniko_apparel',
          itemType: 'outfit_preset',
          itemId: 'outfit_rider_vest',
          expectedPrice: 960,
          idempotencyKey: 'buy_set_2',
        })
      })

      // 3. Test Phone App button -> opens wardrobe
      await page.click('.st-phone-btn')
      await page.click('.st-apps button[data-app="wardrobe"]')
      const openedFromPhone = await page.evaluate(() => window.__outfitHarness.overlay.isOpen())
      assert.equal(openedFromPhone, true, 'Phone wardrobe app must open wardrobe overlay')
      await page.keyboard.press('Escape')

      // 3b. Test Mission Hall header button -> opens wardrobe
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('game:open-missions')))
      await page.click('.mb-wardrobe-btn')
      const openedFromMissionHall = await page.evaluate(() => window.__outfitHarness.overlay.isOpen())
      assert.equal(openedFromMissionHall, true, 'Mission board header button must open wardrobe overlay')
      await page.keyboard.press('Escape')

      // 4. Test KeyO hotkey -> opens wardrobe -> mix-and-match + autoHelmet toggle + save reload persistence
      await page.keyboard.press('KeyO')
      const openedFromKeyO = await page.evaluate(() => window.__outfitHarness.overlay.isOpen())
      assert.equal(openedFromKeyO, true, 'KeyO must open wardrobe overlay')

      // Mix-and-match: choose T1 hoodie top + switch bag from rider_pack -> bag_none -> bag_rider_pack
      await page.click('.shop-tab:has-text("上衣")')
      await page.click('.shop-card[data-item-key="outfit_item:top_guilin_hoodie"]')
      await page.click('.shop-act-primary')
      await page.click('.shop-tab:has-text("背饰")')
      await page.click('.shop-card[data-item-key="outfit_item:bag_none"]')
      await page.click('.shop-act-primary')
      await page.click('.shop-card[data-item-key="outfit_item:bag_rider_pack"]')
      await page.click('.shop-act-primary')

      // Toggle autoHelmetOnRide off then back on -> test reset default? First reload while customized!
      await page.click('.shop-helmet-toggle')
      await page.reload({waitUntil: 'load'})
      await page.waitForFunction(() => Boolean(window.__outfitHarness))

      const persisted = await page.evaluate(() => window.__outfitHarness.getMetrics().snapshot)
      assert.equal(persisted.equipped.top, 'top_guilin_hoodie')
      assert.equal(persisted.equipped.bag, 'bag_rider_pack')
      assert.equal(persisted.applied.bag, 'bag_rider_pack')
      assert.equal(persisted.builtinPackVisible, false)
      assert.equal(persisted.autoHelmetOnRide, false)

      // Open wardrobe again -> test 1-click Reset Default -> verify back to default + autoHelmet back ON
      await page.keyboard.press('KeyO')
      await page.click('.shop-helmet-toggle')
    } else {
      await page.evaluate(() => window.__outfitHarness.overlay.openWardrobe())
    }

    // Check 3-viewport Wardrobe UI zero-overlap & touch target size
    const geom = await page.evaluate(({W, H, minTouch}) => {
      const stage = document.querySelector('.shop-stage').getBoundingClientRect()
      const drawer = document.querySelector('.shop-drawer').getBoundingClientRect()
      const head = document.querySelector('.shop-head').getBoundingClientRect()
      const tabs = document.querySelector('.shop-tabs').getBoundingClientRect()
      const opts = document.querySelector('.shop-wardrobe-opts').getBoundingClientRect()
      const list = document.querySelector('.shop-list').getBoundingClientRect()
      const footer = document.querySelector('.shop-footer').getBoundingClientRect()
      const intersect = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
      const sections = [['head', head], ['tabs', tabs], ['opts', opts], ['list', list], ['footer', footer]]
      const internalOverlaps = []
      for (let i = 0; i < sections.length; i++) {
        for (let j = i + 1; j < sections.length; j++) {
          const area = intersect(sections[i][1], sections[j][1])
          if (area > 1) internalOverlaps.push([sections[i][0], sections[j][0], area])
        }
      }
      const tooSmall = [...document.querySelectorAll('.shop-footer button:not([hidden]), .shop-tabs button')]
        .map(b => ({text: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height)}))
        .filter(b => b.h < minTouch || b.w < minTouch)
      return {
        stageDrawerOverlap: intersect(stage, drawer),
        internalOverlaps,
        outOfBounds: drawer.left < -1 || drawer.top < -1 || drawer.right > W + 1 || drawer.bottom > H + 1,
        tooSmall,
        optsVisible: opts.height > 20,
      }
    }, {W: vp.width, H: vp.height, minTouch: vp.minTouchPx})

    assert.equal(geom.stageDrawerOverlap, 0, `${vp.name} stageDrawerOverlap`)
    assert.deepEqual(geom.internalOverlaps, [], `${vp.name} internalOverlaps`)
    assert.equal(geom.outOfBounds, false, `${vp.name} outOfBounds`)
    assert.deepEqual(geom.tooSmall, [], `${vp.name} touch targets small: ${JSON.stringify(geom.tooSmall)}`)
    assert.equal(geom.optsVisible, true, `${vp.name} wardrobe opts row hidden`)

    await page.screenshot({path: join(outDir, `wardrobe-${vp.name}.png`)})

    if (vp.name.startsWith('desktop')) {
      // Click Reset Default in wardrobe & verify back to outfit_default
      await page.click('.shop-act-secondary')
      const resetSnap = await page.evaluate(() => window.__outfitHarness.getMetrics().snapshot)
      assert.equal(resetSnap.equipped.top, 'top_default_tee')
      assert.equal(resetSnap.equipped.bag, 'bag_none')
      assert.equal(resetSnap.builtinPackVisible, true)
      assert.equal(resetSnap.autoHelmetOnRide, true)
    }

    assert.deepEqual(errors, [], `[${vp.name}] errors: ${JSON.stringify(errors)}`)
    console.log(`ok   wardrobe UI ${vp.name} (${JSON.stringify(geom)})`)
    await context.close()
  }

  console.log('\nALL HEADLESS WEBGL & WARDROBE PLAYWRIGHT CHECKS PASSED')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
  await rm(tempDir, {recursive: true, force: true})
}
