import {browserOptions} from './qa-browser.mjs'
import assert from 'node:assert/strict'
import {existsSync,createReadStream,statSync} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import {join,extname} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {telemetryPreview} from './telemetry-preview.mjs'

const MIME = {
  '.json': 'application/json',
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

const plugins = [telemetryPreview, worldOverlayPlugin()].filter(Boolean)
const site = await preview({root: 'web', configFile: 'web/vite.config.ts', plugins, preview: {host: '127.0.0.1', port: 0}})
const base = 'http://127.0.0.1:' + site.httpServer.address().port
const shotsDir = process.env.GLOL_SHOTS_DIR || ''
if (shotsDir) await mkdir(shotsDir, {recursive: true})

let browser
try {
  browser = await chromium.launch(browserOptions())
  const page = await browser.newPage({viewport: {width: 1440, height: 900}})
  page.setDefaultTimeout(30000)
  const pageErrors = []
  page.on('pageerror', err => pageErrors.push(err.message))

  await page.addInitScript(() => {
    localStorage.setItem('glol.prefs', JSON.stringify({view: 'third'}))
  })
  await page.goto(base + '/?verify&mode=walk&flow=0', {waitUntil: 'domcontentloaded'})
  await page.waitForFunction(() => window.viewer?.walk?.active, null, {timeout: 120000})

  // Helper injected into page to inspect 66-bone avatar arm & finger geometry directly
  async function samplePose(label) {
    const res = await page.evaluate(() => {
      const scene = window.viewer.camera.parent
      let fig = null
      scene.traverse(o => {
        if (!fig && o.getObjectByName?.('upperarm_l') && o.getObjectByName?.('smoke-lips')) fig = o
      })
      if (!fig) return {missing: true}
      fig.updateMatrixWorld(true)
      const skinned = fig.getObjectByProperty('isSkinnedMesh', true)
      const bone = name => fig.getObjectByName(name)
      const wp = name => {
        const b = bone(name)
        return b ? b.getWorldPosition(window.viewer.camera.position.clone()) : null
      }
      const armMetrics = side => {
        const sh = wp('upperarm_' + side), el = wp('lowerarm_' + side), wr = wp('hand_' + side)
        const u = el.clone().sub(sh).normalize()
        const l = wr.clone().sub(el).normalize()
        const downDeg = Math.acos(Math.max(-1, Math.min(1, -u.y))) * 180 / Math.PI
        const elbowDeg = Math.acos(Math.max(-1, Math.min(1, u.dot(l)))) * 180 / Math.PI
        const fingers = {}
        for (const d of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
          for (const k of ['01', '02', '03']) {
            const name = `${d}_${k}_${side}`
            const b = bone(name)
            if (b) fingers[name] = b.quaternion.toArray()
          }
        }
        return {downDeg: +downDeg.toFixed(2), elbowDeg: +elbowDeg.toFixed(2), wristY: +wr.y.toFixed(4), fingers}
      }
      // Compute bind-pose local quaternion of index_01_l / index_01_r from boneInverses
      const bindIdx = {}
      if (skinned?.skeleton) {
        const bones = skinned.skeleton.bones, invs = skinned.skeleton.boneInverses
        const worldQ = new Map()
        for (let i = 0; i < bones.length; i++) {
          const m = invs[i].clone().invert()
          const q = bone('pelvis').quaternion.clone().setFromRotationMatrix(m.extractRotation(m))
          worldQ.set(bones[i].name, q)
        }
        for (const side of ['l', 'r']) {
          const b = bone('index_01_' + side)
          const pq = worldQ.get(b.parent.name), cq = worldQ.get(b.name)
          const local = pq.clone().invert().multiply(cq)
          bindIdx[side] = local.toArray()
        }
      }
      const head = fig.getObjectByName('creator-hair') || fig.getObjectByName('creator-face')
      return {
        visible: fig.visible,
        geomVerts: skinned?.geometry?.index?.count ?? skinned?.geometry?.getAttribute('position')?.count ?? 0,
        headVisible: head ? head.layers.test(window.viewer.camera.layers) : true,
        smoke: window.viewer.walk.probe().smoke,
        animClip: window.viewer.walk.probe().animClip,
        vehicle: window.viewer.walk.vehicle,
        L: armMetrics('l'),
        R: armMetrics('r'),
        bindIdx,
      }
    })
    assert(!res.missing, `[${label}] avatar figure not found`)
    return res
  }

  function quatAngle(a, b) {
    const la = Math.hypot(a[0], a[1], a[2], a[3]) || 1
    const lb = Math.hypot(b[0], b[1], b[2], b[3]) || 1
    const dot = Math.abs((a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (la * lb))
    return 2 * Math.acos(Math.min(1, dot))
  }

  function maxFingerDrift(sample, baseline, side) {
    let maxErr = 0
    for (const [k, q] of Object.entries(baseline[side].fingers)) {
      maxErr = Math.max(maxErr, quatAngle(q, sample[side].fingers[k]))
    }
    return maxErr
  }

  function assertNaturalIdleArms(sample, baseline, label, sides = ['L', 'R']) {
    for (const side of sides) {
      assert(sample[side].downDeg < 28, `[${label}] ${side} arm raised/T-Pose (${sample[side].downDeg} deg)`)
      const drift = maxFingerDrift(sample, baseline, side)
      assert(drift < 0.04, `[${label}] ${side} fingers drifted from natural idle (${drift.toFixed(4)} rad)`)
      const sideKey = side.toLowerCase()
      const distFromBind = quatAngle(sample[side].fingers['index_01_' + sideKey], sample.bindIdx[sideKey])
      assert(distFromBind > 0.25, `[${label}] ${side} index finger stuck in bind pose (${distFromBind.toFixed(4)} rad)`)
    }
  }

  async function waitFrames(n = 8) {
    await page.evaluate(n => new Promise(res => {
      let i = 0
      const step = () => (++i >= n ? res() : requestAnimationFrame(step))
      requestAnimationFrame(step)
    }), n)
  }

  async function shot(name) {
    if (!shotsDir) return
    await waitFrames(3)
    await page.screenshot({path: join(shotsDir, name + '.jpg'), quality: 82, timeout: 60000})
  }

  async function faceFront3P(yawOffset = Math.PI - 0.55) {
    await page.evaluate(off => {
      window.viewer.walk.face(window.viewer.walk.yaw + off, 0.14)
    }, yawOffset)
    await waitFrames(4)
  }

  // Wait for baseline idle pose & hotbar readiness (veil dismissed), verify initial spawn is not T-Pose
  await page.locator('.hotbar [data-slot=smoke]').waitFor({timeout: 60000})
  await page.waitForFunction(() => {
    const slot = document.querySelector('.hotbar [data-slot=smoke]')
    if (!slot || document.body.hasAttribute('data-home')) return false
    const r = slot.getBoundingClientRect()
    return r.width > 0 && slot.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  }, null, {timeout: 90000})
  await waitFrames(10)
  const baseline = await samplePose('baseline-idle')
  console.log('baseline-idle:', {L: baseline.L.downDeg, R: baseline.R.downDeg, verts: baseline.geomVerts})
  assertNaturalIdleArms(baseline, baseline, 'baseline-idle')

  // Buy a pack via smoke shop (exact user flow)
  const shop = page.locator('.shop-overlay.show')
  await page.keyboard.press('3')
  await shop.waitFor()
  await shop.locator('.shop-act-primary').click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('glol.save.v1')).packs.length === 1)
  await shop.locator('.shop-act-close').click()
  await shop.waitFor({state: 'hidden'})
  await waitFrames(6)

  // Rotate camera slightly to front-3/4 so both arms & fingers are clearly visible in screenshots
  await faceFront3P(Math.PI - 0.5)
  await page.mouse.move(720, 480)
  await page.mouse.wheel(0, -450)
  await waitFrames(6)

  async function waitSmokeReady(phase) {
    await page.waitForFunction(p => {
      const s = window.viewer.walk.probe().smoke
      const hint = document.querySelector('.smoke-hint')
      return s.phase === p && hint && !hint.hidden
    }, phase, {polling: 'raf'})
  }

  async function advanceToSmokingIdle() {
    await page.keyboard.press('3')
    await waitSmokeReady('sealed')
    await page.keyboard.press('f') // tear
    await waitSmokeReady('open')
    await page.keyboard.press('f') // take
    await waitSmokeReady('ready')
    await page.keyboard.press('f') // light
    await waitSmokeReady('smoking')
    await waitFrames(10)
  }

  // 1. Full smoking lifecycle: draw -> sealed -> tear -> open -> take -> ready -> light -> smoking idle -> puff -> walk -> discard
  await page.keyboard.press('3')
  await waitSmokeReady('sealed')
  await page.keyboard.press('f') // tear
  await waitSmokeReady('open')
  await page.keyboard.press('f') // take
  await waitSmokeReady('ready')
  await page.keyboard.press('f') // light
  await page.waitForFunction(() => {
    const s = window.viewer.walk.probe().smoke
    return s.phase === 'light' && s.progress >= 0.45
  }, null, {polling: 'raf'})
  await shot('01-light')

  await page.waitForFunction(() => {
    const s = window.viewer.walk.probe().smoke
    const hint = document.querySelector('.smoke-hint')
    return s.phase === 'smoking' && s.progress >= 0.25 && s.puff === 0 && hint && !hint.hidden
  }, null, {polling: 'raf'})
  await waitFrames(10)
  const smokingIdle = await samplePose('smoking-idle')
  console.log('smoking-idle:', {L: smokingIdle.L.downDeg, R: smokingIdle.R.downDeg, phase: smokingIdle.smoke.phase})
  assertNaturalIdleArms(smokingIdle, baseline, 'smoking-idle')
  await shot('02-smoking-idle')

  // Puff: verify smooth lift + peak contact + clean return to idle
  await page.keyboard.press('f')
  await page.waitForFunction(() => window.viewer.walk.probe().smoke.puff >= 0.96, null, {polling: 'raf'})
  await page.evaluate(() => window.viewer.freeze())
  const puffPeak = await samplePose('puff-peak')
  const puffGrip = await page.evaluate(() => {
    const c = window.viewer.camera, fig = c.parent.getObjectByName('smoke-kit').parent
    const lips = fig.getObjectByName('smoke-lips'), cig = lips.getObjectByName('smoke-cigarette')
    const world = n => fig.getObjectByName(n).getWorldPosition(c.position.clone())
    const filter = cig.getWorldPosition(c.position.clone())
    return {
      index: world('index_04_leaf_r').distanceTo(filter),
      middle: world('middle_04_leaf_r').distanceTo(filter),
      wrist: world('hand_r').distanceTo(world('smoke-lips')),
    }
  })
  console.log('puff-peak:', {L: puffPeak.L.downDeg, R: puffPeak.R.downDeg, grip: puffGrip})
  assertNaturalIdleArms(puffPeak, baseline, 'puff-peak-left', ['L'])
  assert(puffGrip.index < 0.016 && puffGrip.middle < 0.016 && puffGrip.wrist > 0.12, `puff filter contact failed: ${JSON.stringify(puffGrip)}`)
  await shot('03-puff')
  await page.evaluate(() => window.viewer.resume())

  await page.waitForFunction(() => window.viewer.walk.probe().smoke.puff === 0, null, {polling: 'raf'})
  await waitFrames(10)
  const postPuff = await samplePose('post-puff')
  console.log('post-puff:', {L: postPuff.L.downDeg, R: postPuff.R.downDeg})
  assertNaturalIdleArms(postPuff, baseline, 'post-puff')

  // Walk + sprint + crouch + jump while smoking
  await page.keyboard.down('KeyW')
  await waitFrames(18)
  const walkSmoking = await samplePose('walk-smoking')
  console.log('walk-smoking:', {L: walkSmoking.L.downDeg, R: walkSmoking.R.downDeg, clip: walkSmoking.animClip})
  assert(walkSmoking.L.downDeg < 45 && walkSmoking.R.downDeg < 45, `walk-smoking arms abnormal: L=${walkSmoking.L.downDeg} R=${walkSmoking.R.downDeg}`)
  await shot('04-walk-smoking')
  await page.keyboard.down('ShiftLeft')
  await waitFrames(14)
  await page.keyboard.up('ShiftLeft')
  await page.keyboard.up('KeyW')
  await page.keyboard.press('KeyX') // crouch on
  await waitFrames(12)
  await page.keyboard.press('KeyX') // crouch off
  await page.keyboard.press('Space') // jump
  await page.waitForFunction(() => !window.viewer.walk.probe().grounded, null, {timeout: 5000}).catch(() => {})
  await page.waitForFunction(() => {
    const p = window.viewer.walk.probe()
    return p.grounded && p.animClip === 'idle'
  }, null, {timeout: 10000})
  await waitFrames(15)
  const postMoveSmoking = await samplePose('post-move-smoking')
  console.log('post-move-smoking:', {L: postMoveSmoking.L.downDeg, R: postMoveSmoking.R.downDeg, clip: postMoveSmoking.animClip})
  assertNaturalIdleArms(postMoveSmoking, baseline, 'post-move-smoking')

  // 2. First-person <-> Third-person mid-smoking + opening Wardrobe from 1P smoking!
  await page.keyboard.press('KeyT') // enter 1P while smoking
  await waitFrames(10)
  const fpSmoking = await samplePose('fp-smoking')
  assert(fpSmoking.visible, 'avatar must stay visible (forearms subset) during 1P smoking')
  assert(fpSmoking.geomVerts < baseline.geomVerts, '1P smoking should use forearm subset geometry')

  // Open Wardrobe while smoking in 1P: avatar MUST be visible, whole mesh, and in clean idle pose (not T-Pose, not headless)
  await page.evaluate(() => window.viewer.walk.shop.openWardrobe())
  await page.locator('.shop-overlay.show').waitFor()
  await waitFrames(6)
  const wardrobeFrom1P = await samplePose('wardrobe-from-1p-smoking')
  console.log('wardrobe-from-1p:', {visible: wardrobeFrom1P.visible, verts: wardrobeFrom1P.geomVerts, head: wardrobeFrom1P.headVisible, L: wardrobeFrom1P.L.downDeg, R: wardrobeFrom1P.R.downDeg})
  assert(wardrobeFrom1P.visible, 'avatar must be visible in wardrobe opened from 1P smoking')
  assert.equal(wardrobeFrom1P.geomVerts, baseline.geomVerts, 'wardrobe must restore full body mesh (not 1P forearm mask)')
  assert(wardrobeFrom1P.headVisible, 'head/hair must be visible in wardrobe opened from 1P smoking')
  assertNaturalIdleArms(wardrobeFrom1P, baseline, 'wardrobe-from-1p-smoking')
  await page.evaluate(() => window.viewer.walk.shop.close())
  await page.locator('.shop-overlay.show').waitFor({state: 'hidden'})
  await waitFrames(6)

  // Switch back to 3P while still smoking
  await page.keyboard.press('KeyT')
  await waitFrames(10)
  const backTo3P = await samplePose('back-to-3p-smoking')
  assert.equal(backTo3P.geomVerts, baseline.geomVerts, '3P return must restore full body geometry')
  assert(backTo3P.headVisible, '3P return must restore head/hair visibility')
  assertNaturalIdleArms(backTo3P, baseline, 'back-to-3p-smoking')

  // 3. glol:avatar-change mid-smoking (m -> f -> m)
  await page.evaluate(() => {
    localStorage.setItem('glol.avatar.v1', JSON.stringify({body: 'f', v: 1, createdAt: 123, skin: 3, face: 1, brows: 0, eyes: 0, hair: 'f_bun', hairColor: 1, look: 'hoodie'}))
    window.dispatchEvent(new CustomEvent('glol:avatar-change'))
  })
  await waitFrames(20)
  const afterAvatarF = await samplePose('avatar-change-f-smoking')
  console.log('avatar-change-f:', {L: afterAvatarF.L.downDeg, R: afterAvatarF.R.downDeg})
  assertNaturalIdleArms(afterAvatarF, baseline, 'avatar-change-f-smoking')

  await page.evaluate(() => {
    localStorage.setItem('glol.avatar.v1', JSON.stringify({body: 'm', v: 1, createdAt: 123, skin: 2, face: 0, brows: 0, eyes: 0, hair: 'm_buzz', hairColor: 0, look: 'default'}))
    window.dispatchEvent(new CustomEvent('glol:avatar-change'))
  })
  await waitFrames(20)
  const afterAvatarM = await samplePose('avatar-change-m-smoking')
  assertNaturalIdleArms(afterAvatarM, baseline, 'avatar-change-m-smoking')

  // Discard cigarette -> verify clean hand restoration
  await page.keyboard.press('3')
  await page.waitForFunction(() => window.viewer.walk.probe().smoke.phase === 'idle')
  await waitFrames(10)
  const afterDiscard = await samplePose('after-discard')
  console.log('after-discard:', {L: afterDiscard.L.downDeg, R: afterDiscard.R.downDeg})
  assertNaturalIdleArms(afterDiscard, baseline, 'after-discard')
  await shot('05-discard-hand')

  // 4. Camera (2) <-> Smoke (3) overlap & mid-blend spam (reproduced R finger corruption before fix)
  await page.keyboard.press('2')
  await waitFrames(18)
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('3')
    await waitFrames(2)
    await page.keyboard.press('2')
    await waitFrames(2)
  }
  await advanceToSmokingIdle()
  const afterCamSmoke = await samplePose('after-camera-overlap-smoking')
  console.log('after-camera-overlap-smoking:', {L: afterCamSmoke.L.downDeg, R: afterCamSmoke.R.downDeg})
  assertNaturalIdleArms(afterCamSmoke, baseline, 'after-camera-overlap-smoking')
  await page.keyboard.press('3') // discard
  await page.waitForFunction(() => window.viewer.walk.probe().smoke.phase === 'idle')

  // 5. Emote -> Smoke transition
  await page.evaluate(() => window.viewer.walk.emote.play(1))
  await waitFrames(15)
  await advanceToSmokingIdle()
  const afterEmoteSmoke = await samplePose('after-emote-smoking')
  assertNaturalIdleArms(afterEmoteSmoke, baseline, 'after-emote-smoking')
  await page.keyboard.press('3')
  await page.waitForFunction(() => window.viewer.walk.probe().smoke.phase === 'idle')

  async function nearestVehicle(kind) {
    return page.evaluate(k => {
      const p = window.viewer.walk.probe()
      const list = window.viewer.walk.parked(k)
      return [...list].sort((a, b) => Math.hypot(a[0] - p.x, a[2] - p.z) - Math.hypot(b[0] - p.x, b[2] - p.z))[0] ?? null
    }, kind)
  }

  async function waitVehiclePrompt(label) {
    await page.waitForFunction(lbl => {
      const el = document.querySelector('.vehicle-action')
      return el && !el.hidden && (el.textContent || '').includes(lbl)
    }, label, {timeout: 15000})
  }

  // 6. Bike mount -> dismount (monitor EVERY frame for 1-frame T-Pose flash!) -> smoke idle
  await page.waitForFunction(() => window.viewer.walk.parked('bike').length > 0, null, {timeout: 30000})
  const bikeSpot = await nearestVehicle('bike')
  assert(bikeSpot, 'no parked bike found')
  assert(await page.evaluate(([x, , z]) => window.viewer.walkTo(x, z, 0, 'test-bike'), bikeSpot))
  await waitVehiclePrompt('骑电动车')
  await page.keyboard.press('f') // mount bike
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike', null, {timeout: 15000})
  await waitFrames(15)

  // Start per-frame T-Pose flash watcher across dismount
  await page.evaluate(() => {
    window.__dismountPeakDown = 0
    window.__watchingDismount = true
    const scene = window.viewer.camera.parent
    let fig = null
    scene.traverse(o => { if (!fig && o.getObjectByName?.('upperarm_l') && o.getObjectByName?.('smoke-lips')) fig = o })
    const tick = () => {
      if (!window.__watchingDismount) return
      if (window.viewer.walk.vehicle === 'foot' && fig) {
        fig.updateMatrixWorld(true)
        const sh = fig.getObjectByName('upperarm_l').getWorldPosition(window.viewer.camera.position.clone())
        const el = fig.getObjectByName('lowerarm_l').getWorldPosition(window.viewer.camera.position.clone())
        const u = el.sub(sh).normalize()
        const deg = Math.acos(Math.max(-1, Math.min(1, -u.y))) * 180 / Math.PI
        window.__dismountPeakDown = Math.max(window.__dismountPeakDown, deg)
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.keyboard.press('f') // dismount bike
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot', null, {timeout: 15000})
  await waitFrames(30)
  const dismountPeak = await page.evaluate(() => { window.__watchingDismount = false; return window.__dismountPeakDown })
  const afterBikeDismount = await samplePose('after-bike-dismount')
  console.log('after-bike-dismount:', {dismountPeak: +dismountPeak.toFixed(2), L: afterBikeDismount.L.downDeg, R: afterBikeDismount.R.downDeg})
  assert(dismountPeak < 70, `bike dismount flashed T-Pose (${dismountPeak.toFixed(2)} deg)`)
  assertNaturalIdleArms(afterBikeDismount, baseline, 'after-bike-dismount')

  // Smoke right after bike dismount (reproduced splayed 10 fingers before fix!)
  await advanceToSmokingIdle()
  const smokeAfterBike = await samplePose('smoking-after-bike-dismount')
  console.log('smoking-after-bike:', {L: smokeAfterBike.L.downDeg, R: smokeAfterBike.R.downDeg})
  assertNaturalIdleArms(smokeAfterBike, baseline, 'smoking-after-bike-dismount')
  await shot('06-after-bike-smoking')
  await page.keyboard.press('3')
  await page.waitForFunction(() => window.viewer.walk.probe().smoke.phase === 'idle')

  // 7. Car mount -> dismount -> smoke idle
  const carSpot = await nearestVehicle('car')
  if (carSpot) {
    assert(await page.evaluate(([x, , z]) => window.viewer.walkTo(x, z, 0, 'test-car'), carSpot))
    await waitVehiclePrompt('开车')
    await page.keyboard.press('f') // mount car
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'car', null, {timeout: 15000})
    await waitFrames(25)
    await page.keyboard.press('f') // dismount car
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot', null, {timeout: 15000})
    await waitFrames(30)
    const afterCarDismount = await samplePose('after-car-dismount')
    console.log('after-car-dismount:', {L: afterCarDismount.L.downDeg, R: afterCarDismount.R.downDeg})
    assertNaturalIdleArms(afterCarDismount, baseline, 'after-car-dismount')

    await advanceToSmokingIdle()
    const smokeAfterCar = await samplePose('smoking-after-car-dismount')
    console.log('smoking-after-car:', {L: smokeAfterCar.L.downDeg, R: smokeAfterCar.R.downDeg})
    assertNaturalIdleArms(smokeAfterCar, baseline, 'smoking-after-car-dismount')
    await page.keyboard.press('3')
    await page.waitForFunction(() => window.viewer.walk.probe().smoke.phase === 'idle')
  }

  // 8. Bike crash -> standUp -> pickup -> smoke idle
  assert(await page.evaluate(([x, , z]) => window.viewer.walkTo(x, z, 0, 'test-crash'), bikeSpot))
  await waitVehiclePrompt('骑电动车')
  await page.keyboard.press('f')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike', null, {timeout: 15000})
  await waitFrames(12)
  await page.evaluate(() => window.viewer.walk.ebike.triggerCrash('lowside', 1))
  await waitFrames(25)
  await page.evaluate(() => window.viewer.walk.ebike.recover())
  await page.waitForFunction(() => window.viewer.walk.probe().twoWheelFlow === 'foot', null, {timeout: 15000})
  await waitFrames(15)
  const afterStandUp = await samplePose('after-standup')
  console.log('after-standup:', {L: afterStandUp.L.downDeg, R: afterStandUp.R.downDeg})
  assertNaturalIdleArms(afterStandUp, baseline, 'after-standup')
  await page.evaluate(() => window.viewer.walk.ebike.pickupNearest())
  await page.waitForFunction(() => window.viewer.walk.probe().twoWheelFlow === 'foot', null, {timeout: 15000})
  await waitFrames(15)
  const afterPickup = await samplePose('after-pickup')
  console.log('after-pickup:', {L: afterPickup.L.downDeg, R: afterPickup.R.downDeg})
  assertNaturalIdleArms(afterPickup, baseline, 'after-pickup')

  assert.equal(pageErrors.length, 0, `unexpected page errors: ${pageErrors.join('; ')}`)
  console.log('verify-smoke-pose PASS (all pose & transition invariants verified)')
  await page.close()
} finally {
  await browser?.close()
  await new Promise(resolve => site.httpServer.close(resolve))
}
