import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'

import {
  SZJ_BUDGET,
  SZJ_FRAME,
  SZJ_STAIRWELLS,
  SZJ_STAIR_IDS,
  getStairwell,
  indoorToStairLocal,
  indoorToWorld,
  stairLocalToIndoor,
  worldToIndoor,
  yawFacing,
} from '../index.ts'
import { SZJ_LANDING, szjGroundStairwells } from '../frame.ts'
import { createSzjIndoorScene } from './index.ts'

function createMockDom() {
  const windowListeners = new Map()
  const makeEl = tag => ({
    tagName: String(tag).toUpperCase(),
    width: 0,
    height: 0,
    className: '',
    type: '',
    rel: '',
    href: '',
    hidden: false,
    textContent: '',
    dataset: {},
    attributes: new Map(),
    children: [],
    parentNode: null,
    listeners: new Map(),
    getContext() {
      return new Proxy(
        {},
        {
          get(_, prop) {
            if (prop === 'measureText') return () => ({ width: 24 })
            if (prop === 'createLinearGradient') return () => ({ addColorStop() {} })
            return () => {}
          },
          set() {
            return true
          },
        },
      )
    },
    setAttribute(k, v) {
      this.attributes.set(k, String(v))
    },
    getAttribute(k) {
      return this.attributes.get(k) ?? null
    },
    hasAttribute(k) {
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        if (camel in this.dataset) return true
      }
      return this.attributes.has(k)
    },
    append(...nodes) {
      for (const n of nodes) {
        if (n.parentNode) n.parentNode.removeChild(n)
        n.parentNode = this
        this.children.push(n)
      }
    },
    removeChild(child) {
      const idx = this.children.indexOf(child)
      if (idx >= 0) {
        this.children.splice(idx, 1)
        child.parentNode = null
      }
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this)
    },
    contains(node) {
      if (node === this) return true
      return this.children.some(c => c.contains?.(node))
    },
    querySelector(sel) {
      if (sel === 'link[data-szj-style="1"]') {
        return this.children.find(c => c.tagName === 'LINK' && c.dataset.szjStyle === '1') ?? null
      }
      return null
    },
    addEventListener(type, fn) {
      const arr = this.listeners.get(type) ?? []
      arr.push(fn)
      this.listeners.set(type, arr)
    },
    removeEventListener(type, fn) {
      const arr = this.listeners.get(type)
      if (!arr) return
      const i = arr.indexOf(fn)
      if (i >= 0) arr.splice(i, 1)
    },
  })

  const head = makeEl('HEAD')
  const body = makeEl('BODY')
  body.append(makeEl('CANVAS'))

  const mockDocument = {
    head,
    body,
    pointerLockElement: null,
    createElement: tag => makeEl(tag),
  }

  const mockWindow = {
    addEventListener(type, fn) {
      const arr = windowListeners.get(type) ?? []
      arr.push(fn)
      windowListeners.set(type, arr)
    },
    removeEventListener(type, fn) {
      const arr = windowListeners.get(type)
      if (!arr) return
      const i = arr.indexOf(fn)
      if (i >= 0) arr.splice(i, 1)
    },
    dispatchKey(type, code) {
      const arr = [...(windowListeners.get(type) ?? [])]
      const ev = {
        code,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: body,
        preventDefault() {},
      }
      for (const fn of arr) fn(ev)
    },
    totalListenerCount() {
      let n = 0
      for (const arr of windowListeners.values()) n += arr.length
      return n
    },
  }

  return { mockDocument, mockWindow, body, head }
}

function createCountingRenderer() {
  const info = {
    render: { calls: 0, triangles: 0, frame: 0 },
    memory: { geometries: 0, textures: 0 },
    reset() {
      this.render.calls = 0
      this.render.triangles = 0
    },
  }
  return {
    info,
    render(scene, camera) {
      scene.updateMatrixWorld(true)
      camera.updateMatrixWorld(true)
      let calls = 0
      let tris = 0
      scene.traverseVisible(obj => {
        if (obj instanceof THREE.InstancedMesh) {
          if (obj.count > 0) {
            calls += 1
            const idx = obj.geometry.getIndex()
            const pos = obj.geometry.getAttribute('position')
            const baseTris = idx ? idx.count / 3 : pos ? pos.count / 3 : 0
            tris += baseTris * obj.count
          }
        } else if (obj instanceof THREE.Mesh) {
          calls += 1
          const idx = obj.geometry.getIndex()
          const pos = obj.geometry.getAttribute('position')
          tris += idx ? idx.count / 3 : pos ? pos.count / 3 : 0
        }
      })
      info.render.calls = calls
      info.render.triangles = Math.round(tris)
      info.render.frame += 1
    },
  }
}

/** walk/config: level first-person tilt, walking pace, and walk/camera lens offset of the street walker. */
const WALKER_LEVEL_PITCH = 0.3
const STREET_WALK_SPEED = 1.65
const EYE_HEIGHT = 1.62
const EYE_FORWARD_M = 0.08
/** One visible frame of camera motion allowed at a swap; strict pose match below it. */
const SWAP_FRAME_JUMP_MAX_M = 0.05
const SWAP_POSE_ERR_MAX_M = 0.01
const SWAP_ANGLE_ERR_MAX_DEG = 0.1
const SWAP_FOV_ERR_MAX_DEG = 0.1

const round = (v, k = 10000) => Math.round(v * k) / k

/** tunnels.ts stairwellLocal + stairwellFloor: the street walker's ramp collider height under (x, z). */
function rampFootAt(g, x, z) {
  const dx = x - g.x
  const dz = z - g.z
  const lz = dx * Math.sin(g.yaw) + dz * Math.cos(g.yaw)
  const y = g.grade - g.riser / 2 - (g.riser / g.tread) * (g.zTop - lz)
  return Math.min(g.grade, Math.max(g.grade - g.depth, y))
}

/** walk/camera placeFirstPersonCamera for a walker foot pose: world lens position, view direction, fov. */
function streetCameraPose(walker, fov) {
  const p = walker.pitch - WALKER_LEVEL_PITCH
  const look = new THREE.Vector3(
    -Math.sin(walker.yaw) * Math.cos(p),
    -Math.sin(p),
    -Math.cos(walker.yaw) * Math.cos(p),
  )
  const pos = new THREE.Vector3(walker.position.x, walker.position.y + EYE_HEIGHT, walker.position.z).addScaledVector(
    look,
    EYE_FORWARD_M,
  )
  return { pos, look, fov }
}

/** The B1 camera as the street would see it (indoor y 0 is that well's B1 floor in world y). */
function indoorCameraPose(camera, st) {
  camera.updateMatrixWorld(true)
  const w = indoorToWorld({ x: camera.position.x, z: camera.position.z })
  const look = new THREE.Vector3()
  camera.getWorldDirection(look)
  return {
    pos: new THREE.Vector3(w.x, camera.position.y + st.groundY - SZJ_FRAME.depth, w.z),
    look,
    fov: camera.fov,
  }
}

/** Indoor lens for a player snapshot, mirroring controller syncIndoorCamera. */
function snapshotCameraPose(snap, st, fov) {
  const cp = Math.cos(snap.pitch)
  const look = new THREE.Vector3(-Math.sin(snap.yaw) * cp, Math.sin(snap.pitch), -Math.cos(snap.yaw) * cp)
  const w = indoorToWorld({ x: snap.x, z: snap.z })
  const pos = new THREE.Vector3(w.x, snap.eyeY + st.groundY - SZJ_FRAME.depth, w.z).addScaledVector(look, EYE_FORWARD_M)
  return { pos, look, fov }
}

function poseError(a, b) {
  const dot = Math.min(1, Math.max(-1, a.look.dot(b.look)))
  return {
    posM: round(a.pos.distanceTo(b.pos)),
    angleDeg: round((Math.acos(dot) * 180) / Math.PI),
    fovDeg: round(Math.abs(a.fov - b.fov)),
  }
}

export async function runHeadlessFourMouthVerification(opts = {}) {
  const outDir = opts.outDir ?? '/tmp/szj-headless-verify'
  const dt = 1 / 60
  const env = createMockDom()

  const prevDoc = globalThis.document
  const prevWin = globalThis.window
  globalThis.document = env.mockDocument
  globalThis.window = env.mockWindow

  let nowMs = 1000
  const renderer = createCountingRenderer()
  const worldCamera = new THREE.PerspectiveCamera(55, 16 / 9, 1, 2000)
  worldCamera.position.set(SZJ_FRAME.originWorld.x, SZJ_FRAME.surfaceY + 6, SZJ_FRAME.originWorld.z)
  worldCamera.rotation.set(-0.2, 0.4, 0)
  const savedWorldCamPos = worldCamera.position.clone()
  const savedWorldCamRot = worldCamera.rotation.clone()

  let worldSuspended = false
  let viewBlend = null
  let walkerState = {
    position: { x: SZJ_FRAME.originWorld.x, y: SZJ_FRAME.surfaceY, z: SZJ_FRAME.originWorld.z },
    velocity: { x: 0, z: 0 },
    yaw: 0,
    pitch: WALKER_LEVEL_PITCH,
  }

  const hostCtx = {
    renderer,
    worldCamera,
    bodyFlag: 'szjActive',
    getWalker: () => (worldSuspended ? null : walkerState),
    suspendWorld() {
      worldSuspended = true
    },
    async resumeWorldAt(pt) {
      worldSuspended = false
      walkerState = {
        position: { x: pt.x, y: pt.footY ?? SZJ_FRAME.surfaceY, z: pt.z },
        velocity: { x: 0, z: 0 },
        yaw: pt.yaw,
        pitch: pt.pitch ?? WALKER_LEVEL_PITCH,
      }
      return true
    },
    setWorldViewBlend(b) {
      viewBlend = b
    },
  }

  const indoor = createSzjIndoorScene({ now: () => nowMs })
  const ramps = new Map(szjGroundStairwells().map(g => [g.id.replace(/^szj-/, ''), g]))

  const mouthReports = []
  let globalBlackFrames = 0
  let globalMaxEyeDy = 0
  let globalMaxLandingErr = 0

  /** Host frame: B1 draws while suspended, else the street draws; a suspended frame with no B1 is black. */
  const renderHostTick = () => {
    const indoorRendered = indoor.renderFrame()
    if ((!indoorRendered && worldSuspended) || (indoorRendered && renderer.info.render.calls === 0)) {
      globalBlackFrames += 1
      return true
    }
    return false
  }

  try {
    await indoor.mount(hostCtx)

    for (const stairId of SZJ_STAIR_IDS) {
      const st = getStairwell(stairId)
      const ramp = ramps.get(stairId)
      const hl = st.length / 2
      nowMs += 2500
      let mouthBlackFrames = 0
      let mouthMaxDy = 0
      const tick = () => {
        nowMs += dt * 1000
        indoor.step(dt)
        if (renderHostTick()) mouthBlackFrames += 1
      }
      const visibleEye = () =>
        worldSuspended ? indoorCameraPose(indoor.camera, st).pos.y : streetCameraPose(walkerState, worldCamera.fov).pos.y

      // 1. Street walker steps off the apron and walks down the open ramp until B1 takes over on the landing.
      const start = indoorToWorld(stairLocalToIndoor(st, { x: 0, z: -hl - 1.2 }))
      walkerState = {
        position: { x: start.x, y: rampFootAt(ramp, start.x, start.z), z: start.z },
        velocity: { x: st.inward.x * STREET_WALK_SPEED, z: st.inward.z * STREET_WALK_SPEED },
        yaw: yawFacing(st.inward),
        pitch: WALKER_LEVEL_PITCH,
      }
      let streetBlendBeforeWell = viewBlend
      let descentFrames = 0
      let descentMonotonic = true
      let blendMonotonic = true
      let lastBlend = 0
      let prevStreetCam = streetCameraPose(walkerState, worldCamera.fov)
      let swapWalker = walkerState
      indoor.step(dt)
      streetBlendBeforeWell = viewBlend
      while (indoor.state === 'idle' && descentFrames < 900) {
        const prevEye = visibleEye()
        prevStreetCam = streetCameraPose(walkerState, worldCamera.fov)
        const x = walkerState.position.x + walkerState.velocity.x * dt
        const z = walkerState.position.z + walkerState.velocity.z * dt
        walkerState = { ...walkerState, position: { x, y: rampFootAt(ramp, x, z), z } }
        swapWalker = walkerState
        tick()
        const eye = visibleEye()
        mouthMaxDy = Math.max(mouthMaxDy, Math.abs(eye - prevEye))
        if (eye > prevEye + 1e-6) descentMonotonic = false
        if (indoor.state === 'idle') {
          if (viewBlend !== null && viewBlend < lastBlend - 1e-9) blendMonotonic = false
          lastBlend = viewBlend ?? lastBlend
        }
        descentFrames += 1
      }
      const enteredFromRamp = indoor.state === 'inside'
      const swapInLz = indoorToStairLocal(st, worldToIndoor(swapWalker.position)).z
      const swapInSamePose = poseError(
        streetCameraPose(swapWalker, worldCamera.fov),
        indoorCameraPose(indoor.camera, st),
      )
      const swapInFrameJumpM = round(prevStreetCam.pos.distanceTo(indoorCameraPose(indoor.camera, st).pos))
      const viewBlendAtSwap = lastBlend
      const entryVisibleSigns = indoor.getVisibleHangingSigns()

      // 2. Keep walking: the roller shutter must clear without braking the player.
      const walkStep = 1.6 * dt
      let minWalkRatio = Infinity
      env.mockWindow.dispatchKey('keydown', 'KeyW')
      for (let i = 0; i < 90; i++) {
        const before = indoor.getPlayerSnapshot()
        tick()
        const after = indoor.getPlayerSnapshot()
        const adv = (after.x - before.x) * st.inward.x + (after.z - before.z) * st.inward.z
        if (i > 0) minWalkRatio = Math.min(minWalkRatio, adv / walkStep)
      }
      env.mockWindow.dispatchKey('keyup', 'KeyW')
      const passedLz = indoorToStairLocal(st, indoor.getPlayerSnapshot()).z
      const passedShutter = passedLz > hl + SZJ_LANDING.door + 0.5
      const reachedIndoors = indoor.state === 'inside'
      const footSignMetrics = indoor.getSignMetrics()
      const indoorMetrics = indoor.getMetrics()

      // 3. Back out through the shutter (KeyS) until the street walker takes over on the landing.
      let ascentFrames = 0
      let ascentMonotonic = true
      let prevIndoorCam = indoorCameraPose(indoor.camera, st)
      env.mockWindow.dispatchKey('keydown', 'KeyS')
      while (indoor.state === 'inside' && ascentFrames < 900) {
        prevIndoorCam = indoorCameraPose(indoor.camera, st)
        const prevEye = visibleEye()
        tick()
        const eye = visibleEye()
        mouthMaxDy = Math.max(mouthMaxDy, Math.abs(eye - prevEye))
        if (eye < prevEye - 1e-6) ascentMonotonic = false
        ascentFrames += 1
      }
      env.mockWindow.dispatchKey('keyup', 'KeyS')
      const exitedToIdle = indoor.state === 'idle' && !worldSuspended
      const exitSnap = indoor.getPlayerSnapshot()
      const streetAfterExit = streetCameraPose(walkerState, worldCamera.fov)
      const swapOutSamePose = poseError(snapshotCameraPose(exitSnap, st, worldCamera.fov), streetAfterExit)
      const swapOutFrameJumpM = round(prevIndoorCam.pos.distanceTo(streetAfterExit.pos))
      const swapOutLz = indoorToStairLocal(st, worldToIndoor(walkerState.position)).z
      const landingErrorM = indoor.getMetrics().lastLandingError

      // 4. Climb the street ramp and step off the mouth: no re-entry, camera back to the street rig.
      let climbFrames = 0
      let reentered = false
      while (climbFrames < 900) {
        const x = walkerState.position.x - st.inward.x * STREET_WALK_SPEED * dt
        const z = walkerState.position.z - st.inward.z * STREET_WALK_SPEED * dt
        walkerState = { ...walkerState, position: { x, y: rampFootAt(ramp, x, z), z } }
        tick()
        if (indoor.state !== 'idle') reentered = true
        climbFrames += 1
        if (indoorToStairLocal(st, worldToIndoor(walkerState.position)).z < -hl - 1) break
      }
      const blendClearedOnStreet = viewBlend === null

      globalMaxEyeDy = Math.max(globalMaxEyeDy, mouthMaxDy)
      globalMaxLandingErr = Math.max(globalMaxLandingErr, landingErrorM)

      mouthReports.push({
        stairId,
        label: st.label,
        enteredFromRamp,
        reachedIndoors,
        passedShutter,
        exitedToIdle,
        reentered,
        descentFrames,
        descentMonotonic,
        ascentFrames,
        ascentMonotonic,
        maxEyeDyM: round(mouthMaxDy, 100000),
        streetBlendBeforeWell,
        viewBlendAtSwap,
        blendMonotonic,
        blendClearedOnStreet,
        swapIn: { stairLocalZ: round(swapInLz, 1000), ...swapInSamePose, frameJumpM: swapInFrameJumpM },
        swapOut: { stairLocalZ: round(swapOutLz, 1000), ...swapOutSamePose, frameJumpM: swapOutFrameJumpM },
        minWalkProgressRatio: round(minWalkRatio, 1000),
        blackFrames: mouthBlackFrames,
        landingErrorM,
        entryVisibleSignCount: entryVisibleSigns.length,
        footVisibleSignCount: footSignMetrics.visibleSignCount,
        footVisibleSignIds: footSignMetrics.visibleSignIds,
        metrics: indoorMetrics,
      })
    }

    const finalMetrics = indoor.getMetrics()
    const finalSignMetrics = indoor.getSignMetrics()
    const finalAtmosMetrics = indoor.getAtmosMetrics()
    const worldCameraPreserved =
      worldCamera.position.distanceTo(savedWorldCamPos) < 1e-9 &&
      Math.abs(worldCamera.rotation.x - savedWorldCamRot.x) < 1e-9 &&
      Math.abs(worldCamera.rotation.y - savedWorldCamRot.y) < 1e-9

    indoor.dispose()
    const zeroLeaksAfterDispose =
      indoor.state === 'disposed' &&
      viewBlend === null &&
      env.body.children.length === 1 &&
      env.head.children.length === 0 &&
      env.mockWindow.totalListenerCount() === 0

    const failures = []
    if (finalSignMetrics.inWorldSignCount !== finalSignMetrics.wayfindingSignCount) {
      failures.push(
        `inWorldSignCount(${finalSignMetrics.inWorldSignCount}) !== wayfindingSignCount(${finalSignMetrics.wayfindingSignCount})`,
      )
    }
    if (finalSignMetrics.wallWayfindingPlaqueCount !== 0) {
      failures.push(`wallWayfindingPlaqueCount(${finalSignMetrics.wallWayfindingPlaqueCount}) !== 0`)
    }
    for (const m of mouthReports) {
      const id = m.stairId
      if (m.streetBlendBeforeWell !== null) failures.push(`${id}: street walker view blend ${m.streetBlendBeforeWell} before the well`)
      if (!m.enteredFromRamp) failures.push(`${id}: walking down the ramp did not swap into B1`)
      if (!m.reachedIndoors) failures.push(`${id}: left B1 while walking in`)
      if (!m.passedShutter) failures.push(`${id}: did not walk through the roller shutter`)
      if (m.minWalkProgressRatio < 0.8) failures.push(`${id}: shutter braked the player (${m.minWalkProgressRatio} of pace)`)
      if (!m.exitedToIdle) failures.push(`${id}: backing out did not swap to the street walker`)
      if (m.reentered) failures.push(`${id}: re-entered B1 while climbing out`)
      if (!m.descentMonotonic) failures.push(`${id}: eye rose while walking down`)
      if (!m.ascentMonotonic) failures.push(`${id}: eye dropped while backing out`)
      if (!m.blendMonotonic) failures.push(`${id}: first-person blend went backwards on the way down`)
      if (m.viewBlendAtSwap < 1) failures.push(`${id}: view blend ${m.viewBlendAtSwap} < 1 at swap`)
      if (!m.blendClearedOnStreet) failures.push(`${id}: view blend not released on the street`)
      if (m.maxEyeDyM > SZJ_BUDGET.eyeDyPerFrameMax) failures.push(`${id}: maxEyeDy ${m.maxEyeDyM} > ${SZJ_BUDGET.eyeDyPerFrameMax}`)
      for (const [k, s] of [['swapIn', m.swapIn], ['swapOut', m.swapOut]]) {
        if (s.posM > SWAP_POSE_ERR_MAX_M) failures.push(`${id}: ${k} lens moved ${s.posM}m > ${SWAP_POSE_ERR_MAX_M}`)
        if (s.angleDeg > SWAP_ANGLE_ERR_MAX_DEG) failures.push(`${id}: ${k} view turned ${s.angleDeg}° > ${SWAP_ANGLE_ERR_MAX_DEG}`)
        if (s.fovDeg > SWAP_FOV_ERR_MAX_DEG) failures.push(`${id}: ${k} fov changed ${s.fovDeg}° > ${SWAP_FOV_ERR_MAX_DEG}`)
        if (s.frameJumpM > SWAP_FRAME_JUMP_MAX_M) failures.push(`${id}: ${k} frame jump ${s.frameJumpM}m > ${SWAP_FRAME_JUMP_MAX_M}`)
      }
      if (m.blackFrames > SZJ_BUDGET.blackFramesMax) failures.push(`${id}: blackFrames ${m.blackFrames} > ${SZJ_BUDGET.blackFramesMax}`)
      if (m.landingErrorM >= SZJ_BUDGET.landingErrorMax) failures.push(`${id}: landingErrorM ${m.landingErrorM} >= ${SZJ_BUDGET.landingErrorMax}`)
      if (m.metrics.lastSwapMs > SZJ_BUDGET.swapMsMax) failures.push(`${id}: swapMs ${m.metrics.lastSwapMs} > ${SZJ_BUDGET.swapMsMax}`)
      if (m.metrics.drawCalls > SZJ_BUDGET.indoorDrawCallsMax) failures.push(`${id}: drawCalls ${m.metrics.drawCalls} > ${SZJ_BUDGET.indoorDrawCallsMax}`)
      if (m.metrics.triangles > SZJ_BUDGET.indoorTrianglesMax) failures.push(`${id}: triangles ${m.metrics.triangles} > ${SZJ_BUDGET.indoorTrianglesMax}`)
      if (m.footVisibleSignCount < 1) failures.push(`${id}: footVisibleSignCount ${m.footVisibleSignCount} < 1`)
    }
    if (!worldCameraPreserved) failures.push('worldCamera mutated')
    if (!zeroLeaksAfterDispose) failures.push('dispose leaked DOM, window listeners or the view blend')

    const report = {
      ok: failures.length === 0,
      failures,
      summary: {
        mouthsVerified: mouthReports.map(m => m.stairId),
        maxPerFrameEyeDyM: round(globalMaxEyeDy, 100000),
        eyeDyBudgetMaxM: SZJ_BUDGET.eyeDyPerFrameMax,
        totalBlackFrames: globalBlackFrames,
        maxLandingErrorM: round(globalMaxLandingErr),
        landingErrorBudgetMaxM: SZJ_BUDGET.landingErrorMax,
        maxSwapFrameJumpM: Math.max(...mouthReports.flatMap(m => [m.swapIn.frameJumpM, m.swapOut.frameJumpM])),
        indoorDrawCalls: finalMetrics.drawCalls,
        drawCallsBudgetMax: SZJ_BUDGET.indoorDrawCallsMax,
        indoorTriangles: finalMetrics.triangles,
        trianglesBudgetMax: SZJ_BUDGET.indoorTrianglesMax,
        indoorTextureBytes: finalMetrics.textureBytes,
        npcCount: finalMetrics.npcCount,
        wayfindingSignCount: finalSignMetrics.wayfindingSignCount,
        inWorldSignCount: finalSignMetrics.inWorldSignCount,
        rodCount: finalSignMetrics.rodCount,
        wallWayfindingPlaqueCount: finalSignMetrics.wallWayfindingPlaqueCount,
        safetyExitPlaqueCount: finalSignMetrics.safetyExitPlaqueCount,
        atmosDrawCalls: finalAtmosMetrics?.drawCalls ?? 0,
        atmosTriangles: finalAtmosMetrics?.triangles ?? 0,
        worldCameraPreserved,
        zeroLeaksAfterDispose,
      },
      mouths: mouthReports,
    }

    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    }
    return report
  } finally {
    indoor.dispose()
    globalThis.document = prevDoc
    globalThis.window = prevWin
  }
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isCli) {
  runHeadlessFourMouthVerification({ outDir: process.argv[2] })
    .then(report => {
      console.log(JSON.stringify({ ok: report.ok, failures: report.failures, summary: report.summary }, null, 2))
      if (!report.ok) process.exit(1)
    })
    .catch(err => {
      console.error(err?.stack || String(err))
      process.exit(1)
    })
}
