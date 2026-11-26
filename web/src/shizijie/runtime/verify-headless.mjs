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
  indoorToWorld,
  stairLanding,
  stairLocalToIndoor,
  yawFacing,
} from '../index.ts'
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
  let walkerState = {
    position: { x: SZJ_FRAME.originWorld.x, y: SZJ_FRAME.surfaceY, z: SZJ_FRAME.originWorld.z },
    velocity: { x: 0, z: 0 },
    yaw: 0,
  }

  const hostCtx = {
    renderer,
    worldCamera,
    bodyFlag: 'szjActive',
    getWalker: () => (worldSuspended ? null : walkerState),
    openVeil: () => ({
      async done() {},
    }),
    suspendWorld() {
      worldSuspended = true
    },
    async resumeWorldAt(pt) {
      worldSuspended = false
      walkerState = {
        position: { x: pt.x, y: SZJ_FRAME.surfaceY, z: pt.z },
        velocity: { x: 0, z: 0 },
        yaw: pt.yaw,
      }
      return true
    },
  }

  const indoor = createSzjIndoorScene({
    now: () => nowMs,
    veilFadeInMs: 0,
    reenterCooldownMs: 1500,
  })

  const mouthReports = []
  let globalBlackFrames = 0
  let globalMaxEyeDy = 0
  let globalMaxLandingErr = 0

  const renderHostTick = () => {
    const indoorRendered = indoor.renderFrame()
    if (!indoorRendered && worldSuspended) {
      // Gap frame where world is suspended AND indoor did not render => black frame!
      globalBlackFrames += 1
      return true
    }
    if (indoorRendered && renderer.info.render.calls === 0) {
      globalBlackFrames += 1
      return true
    }
    return false
  }

  try {
    await indoor.mount(hostCtx)

    for (const stairId of SZJ_STAIR_IDS) {
      const st = getStairwell(stairId)
      nowMs += 2500

      // 1. Place walker on street 1.2m outside mouth and walk inward across shouldEnterStair threshold
      const startWorld = indoorToWorld(stairLocalToIndoor(st, { x: 0, z: -st.length * 0.5 - 1.2 }))
      walkerState = {
        position: { x: startWorld.x, y: st.groundY, z: startWorld.z },
        velocity: { x: st.inward.x * 1.6, z: st.inward.z * 1.6 },
        yaw: yawFacing(st.inward),
      }

      let mouthBlackFrames = 0
      let surfaceWalkFrames = 0
      while (indoor.state === 'idle' && surfaceWalkFrames < 180) {
        walkerState = {
          ...walkerState,
          position: {
            x: walkerState.position.x + walkerState.velocity.x * dt,
            y: st.groundY,
            z: walkerState.position.z + walkerState.velocity.z * dt,
          },
        }
        nowMs += dt * 1000
        indoor.step(dt)
        if (renderHostTick()) mouthBlackFrames += 1
        surfaceWalkFrames += 1
      }

      // Flush microtasks so async enter() completes swap -> 'descending'
      await new Promise(r => setTimeout(r, 5))
      if (renderHostTick()) mouthBlackFrames += 1

      const enteredDescending = indoor.state === 'descending'
      const entryVisibleSigns = indoor.getVisibleHangingSigns()

      // 2. Step 60fps through locked-input scripted descent until 'inside'
      const descentEyeSamples = [indoor.getPlayerSnapshot().eyeY]
      let descentMaxDy = 0
      let descentMonotonic = true
      let descentFrames = 0

      // Attempt pressing KeyW / KeyA during descent to verify input is locked
      env.mockWindow.dispatchKey('keydown', 'KeyA')
      while (indoor.state === 'descending' && descentFrames < 600) {
        const prevEye = indoor.getPlayerSnapshot().eyeY
        nowMs += dt * 1000
        indoor.step(dt)
        if (renderHostTick()) mouthBlackFrames += 1
        const curEye = indoor.getPlayerSnapshot().eyeY
        const dy = Math.abs(curEye - prevEye)
        if (dy > descentMaxDy) descentMaxDy = dy
        if (curEye > prevEye + 1e-6) descentMonotonic = false
        descentEyeSamples.push(curEye)
        descentFrames += 1
      }
      env.mockWindow.dispatchKey('keyup', 'KeyA')

      const reachedIndoors = indoor.state === 'inside'
      const footSnap = indoor.getPlayerSnapshot()
      const footDistFromContract = Math.hypot(footSnap.x - st.footIndoor.x, footSnap.z - st.footIndoor.z)
      const footSignMetrics = indoor.getSignMetrics()

      // 3. Walk 30 frames forward into B1 concourse, measure indoor metrics, then turn around & climb back up
      env.mockWindow.dispatchKey('keydown', 'KeyW')
      for (let i = 0; i < 30; i++) {
        nowMs += dt * 1000
        indoor.step(dt)
        if (renderHostTick()) mouthBlackFrames += 1
      }
      env.mockWindow.dispatchKey('keyup', 'KeyW')

      const indoorMetrics = indoor.getMetrics()

      // Walk backward (KeyS = outward along -inward up the stairwell) all the way to shouldExitStair
      const ascentEyeSamples = [indoor.getPlayerSnapshot().eyeY]
      let ascentMaxDy = 0
      let ascentMonotonic = true
      let ascentFrames = 0

      env.mockWindow.dispatchKey('keydown', 'KeyS')
      while (indoor.state === 'inside' && ascentFrames < 900) {
        const prevEye = indoor.getPlayerSnapshot().eyeY
        nowMs += dt * 1000
        indoor.step(dt)
        if (renderHostTick()) mouthBlackFrames += 1
        const curEye = indoor.getPlayerSnapshot().eyeY
        const dy = Math.abs(curEye - prevEye)
        if (dy > ascentMaxDy) ascentMaxDy = dy
        if (curEye < prevEye - 1e-6) ascentMonotonic = false
        ascentEyeSamples.push(curEye)
        ascentFrames += 1
      }
      env.mockWindow.dispatchKey('keyup', 'KeyS')

      // Flush async exit() swap -> 'idle'
      await new Promise(r => setTimeout(r, 5))
      if (renderHostTick()) mouthBlackFrames += 1

      const exitedToIdle = indoor.state === 'idle' && !worldSuspended
      const expectedLanding = stairLanding(st)
      const landingErrorM = Math.hypot(
        walkerState.position.x - expectedLanding.x,
        walkerState.position.z - expectedLanding.z,
      )
      const mouthMaxDy = Math.max(descentMaxDy, ascentMaxDy)
      if (mouthMaxDy > globalMaxEyeDy) globalMaxEyeDy = mouthMaxDy
      if (landingErrorM > globalMaxLandingErr) globalMaxLandingErr = landingErrorM

      mouthReports.push({
        stairId,
        label: st.label,
        enteredDescending,
        reachedIndoors,
        exitedToIdle,
        descentFrames,
        descentMaxEyeDyM: Math.round(descentMaxDy * 100000) / 100000,
        descentMonotonic,
        footDistFromContractM: Math.round(footDistFromContract * 10000) / 10000,
        ascentFrames,
        ascentMaxEyeDyM: Math.round(ascentMaxDy * 100000) / 100000,
        ascentMonotonic,
        blackFrames: mouthBlackFrames,
        expectedLanding: {
          x: Math.round(expectedLanding.x * 1000) / 1000,
          z: Math.round(expectedLanding.z * 1000) / 1000,
          yaw: Math.round(expectedLanding.yaw * 10000) / 10000,
        },
        actualLanding: {
          x: Math.round(walkerState.position.x * 1000) / 1000,
          z: Math.round(walkerState.position.z * 1000) / 1000,
          yaw: Math.round(walkerState.yaw * 10000) / 10000,
        },
        landingErrorM: Math.round(landingErrorM * 10000) / 10000,
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
      if (!m.enteredDescending) failures.push(`${m.stairId}: did not enter descending`)
      if (!m.reachedIndoors) failures.push(`${m.stairId}: did not reach indoors`)
      if (!m.exitedToIdle) failures.push(`${m.stairId}: did not exit to surface idle`)
      if (!m.descentMonotonic) failures.push(`${m.stairId}: descent eyeY non-monotonic`)
      if (!m.ascentMonotonic) failures.push(`${m.stairId}: ascent eyeY non-monotonic`)
      if (m.descentMaxEyeDyM > SZJ_BUDGET.eyeDyPerFrameMax) {
        failures.push(`${m.stairId}: descentMaxEyeDy ${m.descentMaxEyeDyM} > ${SZJ_BUDGET.eyeDyPerFrameMax}`)
      }
      if (m.ascentMaxEyeDyM > SZJ_BUDGET.eyeDyPerFrameMax) {
        failures.push(`${m.stairId}: ascentMaxEyeDy ${m.ascentMaxEyeDyM} > ${SZJ_BUDGET.eyeDyPerFrameMax}`)
      }
      if (m.blackFrames > SZJ_BUDGET.blackFramesMax) {
        failures.push(`${m.stairId}: blackFrames ${m.blackFrames} > ${SZJ_BUDGET.blackFramesMax}`)
      }
      if (m.landingErrorM >= SZJ_BUDGET.landingErrorMax) {
        failures.push(`${m.stairId}: landingErrorM ${m.landingErrorM} >= ${SZJ_BUDGET.landingErrorMax}`)
      }
      if (m.metrics.lastSwapMs > SZJ_BUDGET.swapMsMax) {
        failures.push(`${m.stairId}: swapMs ${m.metrics.lastSwapMs} > ${SZJ_BUDGET.swapMsMax}`)
      }
      if (m.metrics.drawCalls > SZJ_BUDGET.indoorDrawCallsMax) {
        failures.push(`${m.stairId}: drawCalls ${m.metrics.drawCalls} > ${SZJ_BUDGET.indoorDrawCallsMax}`)
      }
      if (m.metrics.triangles > SZJ_BUDGET.indoorTrianglesMax) {
        failures.push(`${m.stairId}: triangles ${m.metrics.triangles} > ${SZJ_BUDGET.indoorTrianglesMax}`)
      }
      if (m.footVisibleSignCount < 1) {
        failures.push(`${m.stairId}: footVisibleSignCount ${m.footVisibleSignCount} < 1`)
      }
    }
    if (!worldCameraPreserved) failures.push('worldCamera mutated')
    if (!zeroLeaksAfterDispose) failures.push('dispose leaked DOM or window listeners')

    const report = {
      ok: failures.length === 0,
      failures,
      summary: {
        mouthsVerified: mouthReports.map(m => m.stairId),
        maxPerFrameEyeDyM: Math.round(globalMaxEyeDy * 100000) / 100000,
        eyeDyBudgetMaxM: SZJ_BUDGET.eyeDyPerFrameMax,
        totalBlackFrames: globalBlackFrames,
        maxLandingErrorM: Math.round(globalMaxLandingErr * 10000) / 10000,
        landingErrorBudgetMaxM: SZJ_BUDGET.landingErrorMax,
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
  runHeadlessFourMouthVerification()
    .then(report => {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exit(1)
    })
    .catch(err => {
      console.error(err?.stack || String(err))
      process.exit(1)
    })
}
