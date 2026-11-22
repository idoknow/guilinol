/**
 * Kinematics + Headless Chromium E2E Verification Suite for Hy2 Lively Avatar Motion
 * (`avatar-rig.ts`, `avatar-motion.ts`, `ebike-fx.ts`, `boat.ts`, `car.ts`, `walk/index.ts`).
 */
import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {preview} from 'vite'

const root = process.cwd()
const shotDir = '/tmp/hy2-avatar-motion'
await mkdir(shotDir, {recursive: true})
const tmp = await mkdtemp(path.join(root, '.tmp-test-motion-'))

let passed = 0
function check(name, cond, detail = '') {
  if (!cond) throw new Error(`FAIL ${name}${detail ? `: ${detail}` : ''}`)
  passed++
  console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`)
}

async function runNodeKinematicsSuite() {
  await build({
    entryPoints: [
      path.join(root, 'web/src/walk/avatar-rig.ts'),
      path.join(root, 'web/src/walk/avatar-motion.ts'),
      path.join(root, 'web/src/walk/car.ts'),
      path.join(root, 'web/src/walk/ebike-fx.ts'),
    ],
    outdir: tmp,
    outbase: path.join(root, 'web/src'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: ['three', '@dimforge/rapier3d-compat'],
    splitting: true,
    logLevel: 'silent',
  })

  const rigMod = await import(pathToFileURL(path.join(tmp, 'walk/avatar-rig.js')).href)
  const motionMod = await import(pathToFileURL(path.join(tmp, 'walk/avatar-motion.js')).href)
  const carMod = await import(pathToFileURL(path.join(tmp, 'walk/car.js')).href)

  const glbBytes = await readFile(path.join(root, 'public/avatar/figure.glb'))
  const glbAb = glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength)
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(glbAb, '', resolve, reject))

  const figure = gltf.scene
  const rig = rigMod.ensureAvatarRig(figure, null)
  const mixer = new THREE.AnimationMixer(figure)
  const idleClip = gltf.animations.find(a => a.name === 'idle')
  const walkClip = gltf.animations.find(a => a.name === 'walk')
  assert(idleClip && walkClip, 'figure.glb missing idle/walk clips')

  const ctrl = motionMod.createAvatarMotionController()

  // 1) Idle breathing + contrapposto weight shift + attachment alignment.
  const idleAct = mixer.clipAction(idleClip)
  idleAct.play()
  let minTorsoPitch = Infinity, maxTorsoPitch = -Infinity
  let minHipX = Infinity, maxHipX = -Infinity
  for (let i = 0; i < 160; i++) {
    rig.clearAdditive()
    mixer.update(0.08)
    const addPose = ctrl.step({
      dt: 0.08, actualSpeed: 0, inputMag: 0, walkSpeed: 4, runSpeed: 9,
      grounded: true, wasGrounded: true, crouching: false, jumpStage: 'none',
      facing: 0, camYaw: 0, camPitch: 0.3, neutralPitch: 0.3, turnDiff: 0,
      clipKey: 'idle', stride: rig.measureGaitStrides(),
    })
    rig.applyAdditive(addPose)
    figure.updateMatrixWorld(true)
    const torsoQ = rig.attachments.torso.getWorldQuaternion(new THREE.Quaternion())
    const torsoFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(torsoQ)
    minTorsoPitch = Math.min(minTorsoPitch, torsoFwd.y)
    maxTorsoPitch = Math.max(maxTorsoPitch, torsoFwd.y)
    const pelvisPos = figure.getObjectByName('pelvis').getWorldPosition(new THREE.Vector3())
    minHipX = Math.min(minHipX, pelvisPos.x)
    maxHipX = Math.max(maxHipX, pelvisPos.x)
  }
  check('idle breathing pitches chest naturally', maxTorsoPitch - minTorsoPitch > 0.025, `span=${(maxTorsoPitch - minTorsoPitch).toFixed(4)}`)
  check('idle weight shift glides hips laterally', maxHipX - minHipX > 0.015, `span=${(maxHipX - minHipX).toFixed(4)}m`)

  // 2) Additive non-destructiveness & idempotency.
  rig.clearAdditive()
  const baseSpineQ = figure.getObjectByName('spine_02').quaternion.clone()
  const addA = ctrl.step({
    dt: 0, actualSpeed: 0, inputMag: 0, walkSpeed: 4, runSpeed: 9,
    grounded: true, wasGrounded: true, crouching: false, jumpStage: 'none',
    facing: 0, camYaw: 0.65, camPitch: 0.1, neutralPitch: 0.3, turnDiff: 0,
    clipKey: 'idle',
  })
  rig.applyAdditive(addA)
  rig.applyAdditive(addA)
  rig.clearAdditive()
  const restoredSpineQ = figure.getObjectByName('spine_02').quaternion.clone()
  const maxCompErr = Math.max(
    Math.abs(baseSpineQ.x - restoredSpineQ.x),
    Math.abs(baseSpineQ.y - restoredSpineQ.y),
    Math.abs(baseSpineQ.z - restoredSpineQ.z),
    Math.abs(baseSpineQ.w - restoredSpineQ.w),
  )
  check('clearAdditive restores exact mixer bone transform', maxCompErr < 1e-6, `err=${maxCompErr.toFixed(8)}`)

  // 3) Camera-relative head gaze + front-orbit safety.
  ctrl.reset()
  const measureHeadYawAt = (camYaw) => {
    for (let i = 0; i < 45; i++) {
      rig.clearAdditive()
      mixer.update(0.05)
      rig.applyAdditive(ctrl.step({
        dt: 0.05, actualSpeed: 0, inputMag: 0, walkSpeed: 4, runSpeed: 9,
        grounded: true, wasGrounded: true, crouching: false, jumpStage: 'none',
        facing: 0, camYaw, camPitch: 0.3, neutralPitch: 0.3, turnDiff: 0, clipKey: 'idle',
      }))
    }
    figure.updateMatrixWorld(true)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.attachments.head.getWorldQuaternion(new THREE.Quaternion()))
    return Math.atan2(-fwd.x, -fwd.z)
  }
  const headLeft = measureHeadYawAt(0.75)
  const headRight = measureHeadYawAt(-0.75)
  const headFront = measureHeadYawAt(Math.PI)
  check('camera gaze turns head left & right symmetrically', headLeft > 0.25 && headRight < -0.25, `L=${headLeft.toFixed(3)} R=${headRight.toFixed(3)}`)
  check('front-orbit inspection fades neck twist safely back forward', Math.abs(headFront) < 0.22, `front=${headFront.toFixed(3)}`)

  // 4) Walk gait live stride detection & sharp-stop recoil + exertion.
  idleAct.stop()
  const walkAct = mixer.clipAction(walkClip)
  walkAct.play()
  let minAdv = Infinity, maxAdv = -Infinity
  for (let i = 0; i < 40; i++) {
    rig.clearAdditive()
    mixer.update(0.05)
    const s = rig.measureGaitStrides()
    minAdv = Math.min(minAdv, s.legAdvance)
    maxAdv = Math.max(maxAdv, s.legAdvance)
  }
  check('measureGaitStrides extracts symmetric walk stride polarity', minAdv < -0.45 && maxAdv > 0.45, `range=[${minAdv.toFixed(2)},${maxAdv.toFixed(2)}]`)

  ctrl.reset()
  for (let i = 0; i < 30; i++) {
    ctrl.step({
      dt: 0.05, actualSpeed: 8.8, inputMag: 1, walkSpeed: 4, runSpeed: 9,
      grounded: true, wasGrounded: true, crouching: false, jumpStage: 'none',
      facing: 0, camYaw: 0, camPitch: 0.3, neutralPitch: 0.3, turnDiff: 0, clipKey: 'sprint',
    })
  }
  const stopPose = ctrl.step({
    dt: 0.08, actualSpeed: 0.2, inputMag: 0, walkSpeed: 4, runSpeed: 9,
    grounded: true, wasGrounded: true, crouching: false, jumpStage: 'none',
    facing: 0, camYaw: 0, camPitch: 0.3, neutralPitch: 0.3, turnDiff: 0, clipKey: 'idle',
  })
  check('sharp stop triggers forward torso recoil instead of zero freeze', Math.abs(stopPose.joints.Torso[0]) > 0.025, `torsoPitch=${stopPose.joints.Torso[0].toFixed(4)}`)

  // 5) E-bike pose invariants: ThighR constant at speed + wider elbows + steering asymmetry.
  const ebIdle = motionMod.computeTwoWheelRiderTargets({kind: 'bike', speed: 0, maxSpeed: 14, steerInput: 0, lean: 0, wheelie: 0, tucking: false, idleFoot: 1, time: 0.5})
  const ebFastA = motionMod.computeTwoWheelRiderTargets({kind: 'bike', speed: 8.5, maxSpeed: 14, steerInput: 0, lean: 0, wheelie: 0, tucking: false, idleFoot: 0, time: 0.5})
  const ebFastB = motionMod.computeTwoWheelRiderTargets({kind: 'bike', speed: 12.5, maxSpeed: 14, steerInput: 0, lean: 0, wheelie: 0, tucking: false, idleFoot: 0, time: 2.0})
  const ebTurn = motionMod.computeTwoWheelRiderTargets({kind: 'bike', speed: 7, maxSpeed: 14, steerInput: 0.85, lean: 0.3, wheelie: 0, tucking: false, idleFoot: 0, time: 1.0})
  check('ebike ThighR stays invariant at moving speeds (ride.mjs compat)', ebFastA.ThighR[0] === ebFastB.ThighR[0] && ebIdle.ThighR[0] === ebFastA.ThighR[0])
  check('ebike relaxed elbows & steering forearm asymmetry', Math.abs(ebFastA.ArmL[2] - ebFastA.ArmR[2]) >= 0.16 && Math.abs(ebTurn.ForearmL[0] - ebTurn.ForearmR[0]) >= 0.14)

  // 6) Boat bounds safety: head height <= baseline static boat head bound + active arm clearance.
  const joints = rig.joints
  const setBoatAndMeasureHead = (targets) => {
    for (const n of rigMod.AVATAR_JOINT_NAMES) {
      if (joints[n] && targets[n]) joints[n].rotation.set(...targets[n])
    }
    figure.updateMatrixWorld(true)
    return new THREE.Box3().setFromObject(figure, true).max.y
  }
  const baseTourMaxY = setBoatAndMeasureHead({
    Hips: [0, 0, 0], Torso: [0, 0, 0], Head: [0, 0, 0],
    ArmL: [0.9, 0, 0], ArmR: [0.9, 0, 0], ForearmL: [0.35, 0, 0], ForearmR: [0.35, 0, 0],
    ThighL: [1.25, 0, 0], ThighR: [1.25, 0, 0], ShinL: [-1.4, 0, 0], ShinR: [-1.4, 0, 0],
  })
  let maxBoatHeadY = -Infinity
  for (const kind of ['tour', 'motorboat', 'rowboat']) {
    for (let t = 0; t < 5; t++) {
      const bt = motionMod.computeBoatSeatedTargets({
        kind, forward: kind === 'rowboat' ? 1 : 0.8, right: (t % 3) - 1,
        strokePhase: t * 1.3, waveTime: t * 1.1, roll: 0.018 * Math.sin(t),
      })
      maxBoatHeadY = Math.max(maxBoatHeadY, setBoatAndMeasureHead(bt))
    }
  }
  check('boat relaxed poses stay under ceiling bound (headY <= legacy)', maxBoatHeadY <= baseTourMaxY + 1e-6, `new=${maxBoatHeadY.toFixed(4)}m base=${baseTourMaxY.toFixed(4)}m`)

  // 7) Car asymmetrical door-duck mount sanity.
  const carTest = carMod.computeCarEntryTargets ? carMod.computeCarEntryTargets(1) : motionMod.computeCarEntryTargets(1)
  check('car entry has torso cabin twist & staggered arm/leg reach', Math.abs(carTest.Hips[1]) > 0.1 && Math.abs(carTest.ArmL[0] - carTest.ArmR[0]) > 0.15)
  rig.clearPose()

  // 8) Creator variant (`figure_m.glb` with CreatorProportions + attachmentAt) additive & clear compatibility.
  const maleBytes = await readFile(path.join(root, 'public/avatar/figure_m.glb'))
  const maleAb = maleBytes.buffer.slice(maleBytes.byteOffset, maleBytes.byteOffset + maleBytes.byteLength)
  const origFetch = globalThis.fetch
  const origProgressEvent = globalThis.ProgressEvent
  let maleGltf
  globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, init) { Object.assign(this, {type}, init) } }
  globalThis.fetch = async (input, init) => {
    const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
    if (urlStr.startsWith('http://local.avatar/')) {
      const rel = urlStr.slice('http://local.avatar/'.length)
      const data = await readFile(path.join(root, 'public/avatar', rel))
      return new Response(data)
    }
    return origFetch(input, init)
  }
  try {
    maleGltf = await new Promise((resolve, reject) => new GLTFLoader().parse(maleAb, 'http://local.avatar/', resolve, reject))
  } finally {
    globalThis.fetch = origFetch
    if (origProgressEvent === undefined) delete globalThis.ProgressEvent
    else globalThis.ProgressEvent = origProgressEvent
  }
  const maleFig = maleGltf.scene
  const maleRig = rigMod.ensureAvatarRig(maleFig, null)
  const maleHeadAttach = maleRig.attachmentAt?.('head')
  const maleMixer = new THREE.AnimationMixer(maleFig)
  const maleIdle = maleGltf.animations.find(a => a.name === 'idle') ?? idleClip
  maleMixer.clipAction(maleIdle).play()
  maleMixer.update(0.05)
  const maleBaseQ = maleFig.getObjectByName('head').quaternion.clone()
  maleRig.applyAdditive(ctrl.step({
    dt: 0.05, actualSpeed: 0, inputMag: 0, walkSpeed: 1.65, runSpeed: 9,
    grounded: true, wasGrounded: true, crouching: false, jumpStage: 'none',
    facing: 0, camYaw: 0.6, camPitch: 0.25, neutralPitch: 0.3, turnDiff: 0,
    clipKey: 'idle', stride: maleRig.measureGaitStrides(),
  }))
  maleRig.clearAdditive()
  const maleRestoredQ = maleFig.getObjectByName('head').quaternion.clone()
  const maleErr = Math.max(
    Math.abs(maleBaseQ.x - maleRestoredQ.x),
    Math.abs(maleBaseQ.y - maleRestoredQ.y),
    Math.abs(maleBaseQ.z - maleRestoredQ.z),
    Math.abs(maleBaseQ.w - maleRestoredQ.w),
  )
  check('figure_m CreatorProportions rig & attachmentAt additive/clear compat', Boolean(maleHeadAttach) && maleErr < 1e-6, `err=${maleErr.toFixed(8)}`)
}

async function runBrowserSuite() {
  const execPath = process.env.CHROMIUM || '/Users/macbook/Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
  const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
  let browser
  try {
    browser = await chromium.launch({
      executablePath: execPath,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    })
    const page = await browser.newPage({viewport: {width: 960, height: 600}})
    const errors = []
    page.on('pageerror', err => errors.push(err.message))
    await page.route('**/favicon.ico', route => route.fulfill({status: 204}))
    await page.route('**/api/t', route => route.fulfill({status: 204}))
    await page.route('**/api/me', route => route.fulfill({status: 200, contentType: 'application/json', body: '{"user":null}'}))

    await page.goto(`${baseUrl}/?verify&mode=walk&flow=0&solo=1`)
    await page.waitForFunction(() => window.viewer?.walk?.active, null, {timeout: 90000})
    await page.waitForFunction(() => [...window.viewer.stream.landmarks.keys()].some(e => e.id === 'jingjiang'), null, {timeout: 90000})

    // Zoom in camera cleanly to zoomMin (~2.5m) using canvas wheel input.
    await page.mouse.move(480, 300)
    for (let w = 0; w < 6; w++) await page.mouse.wheel(0, -180)

    // Front inspection shot + idle breathing/weight-shift verification across 6 seconds.
    const idleResult = await page.evaluate(() => {
      const {walk} = window.viewer
      let minPitch = Infinity, maxPitch = -Infinity, minHipX = Infinity, maxHipX = -Infinity
      let maxSink = -Infinity
      for (let i = 0; i < 120; i++) {
        walk.tick(0.05)
        const m = walk.avatarMetrics()
        const p = walk.probe()
        minPitch = Math.min(minPitch, m.torsoPitch)
        maxPitch = Math.max(maxPitch, m.torsoPitch)
        minHipX = Math.min(minHipX, m.hipsLocalPos[0])
        maxHipX = Math.max(maxHipX, m.hipsLocalPos[0])
        if (p.grounded) maxSink = Math.max(maxSink, p.footSink)
      }
      return {
        pitchSpan: maxPitch - minPitch,
        hipXSpan: maxHipX - minHipX,
        maxSink,
        armSpread: walk.avatarMetrics().armSpread,
      }
    })
    check('browser idle breath + hip shift + zero foot sink', idleResult.pitchSpan > 0.012 && idleResult.hipXSpan > 0.015 && idleResult.maxSink <= 0.03, JSON.stringify(idleResult))

    // Screenshot 1: Front 3/4 view at standing idle (using native close orbit via face).
    await page.evaluate(() => {
      const {walk} = window.viewer
      walk.face(0.45, 0.14)
      for (let i = 0; i < 20; i++) walk.tick(0.04)
    })
    await page.screenshot({path: path.join(shotDir, '01_idle_front.png')})

    // Camera-relative head look verification in real walk loop.
    const gazeResult = await page.evaluate(() => {
      const {walk} = window.viewer
      walk.face(Math.PI + 0.72, 0.22)
      for (let i = 0; i < 35; i++) walk.tick(0.04)
      const leftLook = walk.avatarMetrics()
      walk.face(Math.PI - 0.72, 0.22)
      for (let i = 0; i < 35; i++) walk.tick(0.04)
      const rightLook = walk.avatarMetrics()
      return {leftYaw: leftLook.headYaw, rightYaw: rightLook.headYaw, travellerTilt: leftLook.travellerTilt}
    })
    check('browser camera yaw drives smooth head & neck gaze', gazeResult.leftYaw > 0.20 && gazeResult.rightYaw < -0.20 && gazeResult.travellerTilt < 1e-4, JSON.stringify(gazeResult))

    // Screenshot 2: Over-the-shoulder side gaze look while standing on plaza.
    await page.evaluate(() => {
      const {walk} = window.viewer
      walk.face(Math.PI + 0.75, 0.15)
      for (let i = 0; i < 25; i++) walk.tick(0.04)
    })
    await page.screenshot({path: path.join(shotDir, '02_head_gaze.png')})

    // Walk/run/stop inertia & walk sink check.
    const walkResult = await page.evaluate(() => {
      const {walk} = window.viewer
      walk.face(Math.PI, 0.24)
      walk.drive(0, -1, false)
      let maxSink = -Infinity, maxTilt = 0
      for (let i = 0; i < 30; i++) {
        walk.tick(1 / 30)
        const p = walk.probe()
        const m = walk.avatarMetrics()
        if (p.grounded) maxSink = Math.max(maxSink, p.footSink)
        maxTilt = Math.max(maxTilt, m.travellerTilt)
      }
      walk.face(Math.PI + 1.35, 0.14)
      walk.tick(1 / 30)
      const movingSnap = {clip: walk.probe().animClip, speed: walk.probe().planarSpeed}
      walk.drive(0, 0, false)
      return {movingSnap, maxSink, maxTilt}
    })
    await page.screenshot({path: path.join(shotDir, '03_walk_profile.png')})
    check('browser walk avoids rigid traveller board tilt & keeps footSink safe', walkResult.maxTilt < 1e-4 && walkResult.maxSink <= 0.03, JSON.stringify({maxSink: walkResult.maxSink, maxTilt: walkResult.maxTilt, clip: walkResult.movingSnap.clip}))

    // Wardrobe close-up live breathing check ('O' overlay).
    const wardrobeResult = await page.evaluate(() => {
      const {walk} = window.viewer
      walk.shop.openWardrobe()
      let minP = Infinity, maxP = -Infinity
      for (let i = 0; i < 60; i++) {
        walk.tick(0.05)
        const m = walk.avatarMetrics()
        minP = Math.min(minP, m.torsoPitch)
        maxP = Math.max(maxP, m.torsoPitch)
      }
      return {open: walk.shop.isOpen(), breathSpan: maxP - minP}
    })
    await page.screenshot({path: path.join(shotDir, '04_wardrobe_alive.png')})
    await page.evaluate(() => window.viewer.walk.shop.close('user'))
    check('wardrobe 360° preview stays softly breathing instead of frozen', wardrobeResult.open && wardrobeResult.breathSpan > 0.010, JSON.stringify(wardrobeResult))

    assert.deepEqual(errors, [], `unexpected browser errors: ${errors.join('; ')}`)
  } finally {
    await browser?.close()
    await new Promise(resolve => server.httpServer.close(() => resolve()))
  }
}

try {
  await runNodeKinematicsSuite()
  await runBrowserSuite()
  console.log(`\nALL ${passed} AVATAR MOTION CHECKS PASSED (shots -> ${shotDir})`)
} finally {
  await rm(tmp, {recursive: true, force: true})
}
