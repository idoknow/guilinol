import * as THREE from 'three'
import {
  SZJ_BUDGET,
  SZJ_FRAME,
  SZJ_PLAYER,
  SZJ_STAIRWELLS,
  SZJ_TIMING,
  SZJ_TRIGGER,
  getStairwell,
  indoorToStairLocal,
  shouldExitStair,
  stairEntryPose,
  stairLanding,
  validateSzjLayout,
  yawFacing,
  type SzjHostContext,
  type SzjIndoorMetrics,
  type SzjShop,
  type SzjStairId,
  type SzjStairwell,
} from '../contract.ts'
import { SHIZIJIE_B1_LAYOUT } from '../layout/index.ts'
import { buildSzjWayfinding, type SzjHangingSign } from '../wayfinding/index.ts'
import {
  createStairEyeSmoother,
  createStairLocomotionAdapter,
  projectWorldToStair,
  type StairPlacement,
} from '../../locomotion/stairs/index.ts'
import {
  buildSzjCollisionWorld,
  clampSzjPitch,
  detectActiveSzjShop,
  getStairSpeedScale,
  isValidStairId,
  resolveSzjIndoorMovement,
} from './collision.ts'
import { buildContractDerivedSzjLayout } from './fallback-layout.ts'
import { createSzjIndoorSceneContent, type SzjIndoorSceneHandle } from './indoor-scene.ts'
import { createSzjRuntimeStateMachine } from './state-machine.ts'
import {
  normalizeAngleRad,
  type CreateSzjIndoorSceneOptions,
  type SzjExtendedIndoorScene,
  type SzjPlayerSnapshot,
  type SzjSignRuntimeMetrics,
} from './types.ts'

const LOOK_SENSITIVITY_RAD_PER_PX = 0.0026
const KEY_TURN_RAD_PER_SEC = 1.85
const INDOOR_CAMERA_NEAR = 0.08
const INDOOR_CAMERA_FAR = 160

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { tagName?: string; isContentEditable?: boolean }
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el.isContentEditable)
}

function isOverlayBlockingHud(): boolean {
  if (typeof document === 'undefined' || !document.body) return false
  return (
    document.body.hasAttribute('data-home') ||
    document.body.dataset?.photo === 'on' ||
    document.body.hasAttribute('data-photo')
  )
}

function makeDescentPlacement(st: SzjStairwell): StairPlacement {
  return {
    origin: { x: st.topIndoor.x, y: SZJ_FRAME.depth, z: st.topIndoor.z },
    yawRad: yawFacing(st.inward),
    profile: {
      riser: st.profile.riser,
      tread: st.profile.tread,
      count: st.profile.count,
      width: st.width,
      baseY: SZJ_FRAME.depth,
      direction: 'down',
      landing: {
        entry: st.profile.landingTop * 0.5,
        exit: st.profile.landingFoot,
      },
    },
  }
}

function makeInteractivePlacement(st: SzjStairwell): StairPlacement {
  return {
    origin: { x: st.mouthIndoor.x, y: SZJ_FRAME.depth, z: st.mouthIndoor.z },
    yawRad: yawFacing(st.inward),
    profile: {
      riser: st.profile.riser,
      tread: st.profile.tread,
      count: st.profile.count,
      width: st.width,
      baseY: SZJ_FRAME.depth,
      direction: 'down',
      landing: {
        entry: st.profile.landingTop,
        exit: st.profile.landingFoot,
      },
    },
  }
}

/**
 * 十字街地下街 B1 室内运行时控制器（严格实现 contract.ts v1 SzjIndoorScene）：
 * 1) 4 座楼梯触发口进入时锁定输入、强制切独立第一人称相机，经 locomotion/stairs 平滑下楼（Δy <= 0.08m/帧）；
 * 2) 室内独立 THREE.Scene + 折线通道/斜向梯井/28 铺碰撞 + 48 名非交互人气 NPC，不依赖城市 terrain / world.ts；
 * 3) 玩家沿任一楼梯上行至顶部平台平滑触发 shouldExitStair（或近口按 E），还原地面精确落点与原视角。
 */
export function createSzjIndoorScene(opts: CreateSzjIndoorSceneOptions = {}): SzjExtendedIndoorScene {
  const defaultCandidate = opts.layout ?? SHIZIJIE_B1_LAYOUT
  const candidateErrors = validateSzjLayout(defaultCandidate)
  const layout =
    opts.layout !== undefined
      ? (() => {
          if (candidateErrors.length > 0) {
            throw new Error(`Invalid SzjLayout passed to createSzjIndoorScene: ${candidateErrors.join('; ')}`)
          }
          return defaultCandidate
        })()
      : candidateErrors.length === 0
        ? defaultCandidate
        : buildContractDerivedSzjLayout()

  const nowFn = opts.now ?? (() => performance.now())
  const veilFadeInMs = Math.max(0, opts.veilFadeInMs ?? SZJ_TIMING.veilFadeInMs)
  const reenterCooldownMs = Math.max(0, opts.reenterCooldownMs ?? SZJ_TIMING.reenterCooldownMs)
  const descentSpeed = Math.max(0.2, opts.descentSpeed ?? SZJ_TIMING.descentSpeed)
  const entryPitchRad = (SZJ_PLAYER.entryPitchDeg * Math.PI) / 180

  const collisionWorld = buildSzjCollisionWorld(layout, SZJ_PLAYER.radius, SZJ_PLAYER.eyeHeight)
  const wayfinding = buildSzjWayfinding(layout)
  const machine = createSzjRuntimeStateMachine(SZJ_STAIRWELLS, reenterCooldownMs)

  const stairAdapter = createStairLocomotionAdapter({
    eyeOffset: SZJ_PLAYER.eyeHeight,
    maxDeltaYPerFrame: SZJ_BUDGET.eyeDyPerFrameMax,
  })
  const flatEyeSmoother = createStairEyeSmoother({
    eyeOffset: SZJ_PLAYER.eyeHeight,
    maxDeltaYPerFrame: SZJ_BUDGET.eyeDyPerFrameMax,
  })

  const interactivePlacements = new Map<SzjStairId, StairPlacement>()
  for (const st of SZJ_STAIRWELLS) {
    interactivePlacements.set(st.id, makeInteractivePlacement(st))
  }

  const scene = new THREE.Scene()
  scene.name = 'szj-indoor-root'
  scene.background = new THREE.Color('#232932')

  const camera = new THREE.PerspectiveCamera(SZJ_PLAYER.fovDeg, 16 / 9, INDOOR_CAMERA_NEAR, INDOOR_CAMERA_FAR)
  camera.rotation.order = 'YXZ'
  const viewProjMat = new THREE.Matrix4()
  const viewFrustum = new THREE.Frustum()
  const signProbePt = new THREE.Vector3()

  let hostCtx: SzjHostContext | null = null
  let contentHandle: SzjIndoorSceneHandle | null = null
  let pendingExitStairId: SzjStairId | null = null

  const firstStair = SZJ_STAIRWELLS[0]!
  let playerX = firstStair.footIndoor.x
  let playerZ = firstStair.footIndoor.z
  let playerFootY: number = SZJ_FRAME.indoorFloorY
  let playerEyeY: number = SZJ_FRAME.indoorFloorY + SZJ_PLAYER.eyeHeight
  let playerYaw = yawFacing(firstStair.inward)
  let playerPitch = 0
  let ceilingClearanceM = layout.ceilingHeight - SZJ_PLAYER.eyeHeight
  let activeStairId: SzjStairId | null = null
  let activeShopId: string | null = null
  let collisionContacts = 0
  let descentElapsedMs = 0
  let trackedInteractiveStairId: SzjStairId | null = null

  let lastDrawCalls = 0
  let lastSwapMs = 0
  let lastBlackFrames = 0
  let lastMaxEyeDy = 0
  let currentTraverseMaxEyeDy = 0
  let lastLandingError = 0

  const pressedKeys = new Set<string>()
  let draggingLook = false
  let lastPointerX = 0
  let lastPointerY = 0
  let styleLinkEl: HTMLLinkElement | null = null
  let rootEl: HTMLDivElement | null = null
  let promptBtn: HTMLButtonElement | null = null

  function setBodyFlags(active: boolean): void {
    if (typeof document === 'undefined' || !document.body?.dataset) return
    const flag = hostCtx?.bodyFlag ?? 'szjActive'
    if (active) {
      document.body.dataset[flag] = '1'
      document.body.dataset.szjIndoor = '1'
    } else {
      delete document.body.dataset[flag]
      delete document.body.dataset.szjIndoor
    }
  }

  function recordEyeDelta(prevEyeY: number, nextEyeY: number): void {
    const dy = Math.abs(nextEyeY - prevEyeY)
    if (dy > currentTraverseMaxEyeDy) {
      currentTraverseMaxEyeDy = Math.round(dy * 100000) / 100000
    }
    if (currentTraverseMaxEyeDy > lastMaxEyeDy) {
      lastMaxEyeDy = currentTraverseMaxEyeDy
    }
  }

  function nearestIndoorStair(px: number, pz: number): { stair: SzjStairwell; distToMouth: number } | null {
    let best: SzjStairwell | null = null
    let bestDist = Infinity
    for (const st of SZJ_STAIRWELLS) {
      const d = Math.hypot(px - st.topIndoor.x, pz - st.topIndoor.z)
      if (d < bestDist) {
        bestDist = d
        best = st
      }
    }
    return best ? { stair: best, distToMouth: bestDist } : null
  }

  function syncPromptDom(): void {
    if (!promptBtn) return
    const st = machine.getState()
    if (
      st === 'disposed' ||
      st === 'unmounted' ||
      st === 'entering' ||
      st === 'descending' ||
      st === 'exiting' ||
      isOverlayBlockingHud()
    ) {
      promptBtn.hidden = true
      return
    }
    if (st === 'idle') {
      const nearId = machine.getNearbyStairId()
      if (!nearId) {
        promptBtn.hidden = true
        return
      }
      const sw = getStairwell(nearId)
      promptBtn.dataset.szjAction = 'enter'
      promptBtn.dataset.stairId = sw.id
      promptBtn.textContent = '[E] 进入'
      promptBtn.setAttribute('aria-label', `进入${sw.label}`)
      promptBtn.hidden = false
      return
    }
    if (st === 'inside') {
      const near = nearestIndoorStair(playerX, playerZ)
      if (near && near.distToMouth <= near.stair.width) {
        promptBtn.dataset.szjAction = 'exit'
        promptBtn.dataset.stairId = near.stair.id
        promptBtn.textContent = '[E] 离开'
        promptBtn.setAttribute('aria-label', `离开至${near.stair.label}`)
        promptBtn.hidden = false
        return
      }
    }
    promptBtn.hidden = true
  }

  function syncIndoorCamera(): void {
    const worldAspect = hostCtx?.worldCamera?.aspect
    if (worldAspect && Number.isFinite(worldAspect) && Math.abs(camera.aspect - worldAspect) > 1e-4) {
      camera.aspect = worldAspect
      camera.updateProjectionMatrix()
    }
    camera.rotation.order = 'YXZ'
    camera.position.set(playerX, playerEyeY, playerZ)
    camera.rotation.set(playerPitch, playerYaw, 0, 'YXZ')
    camera.updateMatrixWorld(true)
  }

  function renderFrame(): boolean {
    const st = machine.getState()
    if ((st !== 'descending' && st !== 'inside' && st !== 'exiting') || !contentHandle) return false
    syncIndoorCamera()
    if (hostCtx?.renderer) {
      hostCtx.renderer.info.reset()
      hostCtx.renderer.render(scene, camera)
      lastDrawCalls = hostCtx.renderer.info.render.calls
    } else {
      lastDrawCalls = contentHandle.meshCount
    }
    return true
  }

  function onKeyDown(e: KeyboardEvent): void {
    const st = machine.getState()
    if (st === 'disposed' || st === 'unmounted') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (isEditableTarget(e.target) || isOverlayBlockingHud()) return

    if (e.code !== 'KeyE') {
      pressedKeys.add(e.code)
    }

    // Lock movement & interaction triggers while entering / descending / exiting
    if (st === 'entering' || st === 'descending' || st === 'exiting') {
      e.preventDefault?.()
      return
    }

    if (!e.repeat && e.code === 'KeyE') {
      if (st === 'idle' && machine.getNearbyStairId()) {
        e.preventDefault()
        void enter(machine.getNearbyStairId()!)
      } else if (st === 'inside') {
        const near = nearestIndoorStair(playerX, playerZ)
        if (near && near.distToMouth <= near.stair.width) {
          e.preventDefault()
          pendingExitStairId = near.stair.id
          void exit()
        }
      }
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    pressedKeys.delete(e.code)
  }

  function onWindowBlur(): void {
    pressedKeys.clear()
    draggingLook = false
  }

  function onPointerDown(e: PointerEvent): void {
    if (machine.getState() !== 'inside') return
    if (e.button !== 0) return
    if (promptBtn && e.target instanceof Node && promptBtn.contains(e.target)) return
    draggingLook = true
    lastPointerX = e.clientX
    lastPointerY = e.clientY
    e.stopPropagation?.()
  }

  function onPointerMove(e: PointerEvent): void {
    if (machine.getState() !== 'inside') return
    const pointerLocked = typeof document !== 'undefined' && Boolean(document.pointerLockElement)
    if (!draggingLook && !pointerLocked) return
    const dx = pointerLocked ? e.movementX : e.clientX - lastPointerX
    const dy = pointerLocked ? e.movementY : e.clientY - lastPointerY
    lastPointerX = e.clientX
    lastPointerY = e.clientY
    playerYaw = normalizeAngleRad(playerYaw - dx * LOOK_SENSITIVITY_RAD_PER_PX)
    playerPitch = clampSzjPitch(collisionWorld, playerPitch - dy * LOOK_SENSITIVITY_RAD_PER_PX)
    e.stopPropagation?.()
  }

  function onPointerUp(): void {
    draggingLook = false
  }

  function mountDomAndListeners(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined' || !document.body) return
    if (!document.head.querySelector('link[data-szj-style="1"]')) {
      try {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = new URL('./szj-ui.css', import.meta.url).href
        link.dataset.szjStyle = '1'
        document.head.append(link)
        styleLinkEl = link
      } catch {
        styleLinkEl = null
      }
    }

    rootEl = document.createElement('div')
    rootEl.className = 'szj-root'
    rootEl.dataset.szjRoot = '1'

    promptBtn = document.createElement('button')
    promptBtn.type = 'button'
    promptBtn.className = 'szj-prompt'
    promptBtn.hidden = true
    promptBtn.addEventListener('click', () => {
      const action = promptBtn?.dataset.szjAction
      const sid = promptBtn?.dataset.stairId
      if (action === 'enter' && isValidStairId(sid)) {
        void enter(sid)
      } else if (action === 'exit') {
        if (isValidStairId(sid)) pendingExitStairId = sid
        void exit()
      }
    })

    rootEl.append(promptBtn)
    document.body.append(rootEl)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
  }

  function unmountDomAndListeners(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
    }
    promptBtn?.remove()
    rootEl?.remove()
    styleLinkEl?.remove()
    promptBtn = null
    rootEl = null
    styleLinkEl = null
    pressedKeys.clear()
    draggingLook = false
  }

  async function mount(ctx: SzjHostContext): Promise<void> {
    if (machine.getState() === 'disposed') return
    if (machine.getState() !== 'unmounted') return
    hostCtx = ctx
    contentHandle = createSzjIndoorSceneContent(layout, {
      maxNpcs: opts.maxNpcs,
      seed: opts.seed,
      wayfinding,
      atmosPreset: opts.atmosPreset,
      atmosSpec: opts.atmosSpec,
    })
    scene.background = contentHandle.scene.background
    scene.fog = contentHandle.scene.fog
    scene.add(contentHandle.scene)
    syncIndoorCamera()
    try {
      const compilable = ctx.renderer as unknown as {
        compile?: (targetScene: THREE.Object3D, targetCam: THREE.Camera) => void
      }
      compilable.compile?.(scene, camera)
    } catch {
      // Headless mock renderers may omit WebGLRenderer.compile
    }
    mountDomAndListeners()
    machine.transitionTo('idle')
  }

  async function enter(stairId: SzjStairId): Promise<boolean> {
    if (!isValidStairId(stairId) || !hostCtx || !contentHandle) return false
    if (!machine.transitionTo('entering')) return false

    const stairDef = getStairwell(stairId)
    pressedKeys.clear()
    draggingLook = false
    setBodyFlags(true)
    syncPromptDom()

    const veilHandle = hostCtx.openVeil(stairDef.label)
    try {
      await sleepMs(veilFadeInMs)
      if (machine.getState() !== 'entering') {
        setBodyFlags(false)
        void veilHandle.done()
        return false
      }

      const swapStart = nowFn()
      machine.setActiveStairId(stairId)
      pendingExitStairId = stairId
      hostCtx.suspendWorld()

      const entryPose = stairEntryPose(stairDef)
      const placement = makeDescentPlacement(stairDef)
      const initialFrame = stairAdapter.startScripted({
        placement,
        profile: placement.profile,
        speed: descentSpeed,
        eyeOffset: SZJ_PLAYER.eyeHeight,
        maxDeltaYPerFrame: SZJ_BUDGET.eyeDyPerFrameMax,
      })

      playerX = initialFrame.position.x
      playerFootY = initialFrame.position.y
      playerZ = initialFrame.position.z
      playerEyeY = initialFrame.eyeY
      playerYaw = entryPose.yaw
      playerPitch = entryPitchRad
      activeStairId = stairId
      activeShopId = null
      descentElapsedMs = 0
      trackedInteractiveStairId = null
      currentTraverseMaxEyeDy = 0
      lastMaxEyeDy = 0

      syncIndoorCamera()
      if (!machine.transitionTo('descending')) {
        setBodyFlags(false)
        void veilHandle.done()
        return false
      }

      renderFrame()
      lastSwapMs = Math.max(0, Math.round((nowFn() - swapStart) * 100) / 100)
      lastBlackFrames = 0
      syncPromptDom()

      await veilHandle.done()
      return true
    } catch {
      if (machine.getState() === 'entering') {
        setBodyFlags(false)
        machine.setActiveStairId(null)
        machine.transitionTo('idle')
      }
      await veilHandle.done().catch(() => {})
      return false
    }
  }

  async function exit(): Promise<boolean> {
    if (!hostCtx) return false
    if (!machine.transitionTo('exiting')) return false

    const targetStairId: SzjStairId = pendingExitStairId ?? activeStairId ?? machine.getActiveStairId() ?? 'nw'
    const stairDef = getStairwell(targetStairId)
    pressedKeys.clear()
    draggingLook = false
    syncPromptDom()

    const veilHandle = hostCtx.openVeil(stairDef.label)
    try {
      await sleepMs(veilFadeInMs)
      if (machine.getState() !== 'exiting') {
        void veilHandle.done()
        return false
      }

      const landing = stairLanding(stairDef)
      setBodyFlags(false)
      stairAdapter.reset()
      trackedInteractiveStairId = null

      const resumed = await hostCtx.resumeWorldAt(landing)
      if (!resumed) {
        setBodyFlags(true)
        machine.transitionTo('inside')
        await veilHandle.done().catch(() => {})
        return false
      }

      if (machine.getState() !== 'exiting') {
        void veilHandle.done()
        return false
      }

      const walkerAfter = hostCtx.getWalker()
      lastLandingError = walkerAfter
        ? Math.round(Math.hypot(walkerAfter.position.x - landing.x, walkerAfter.position.z - landing.z) * 10000) / 10000
        : 0

      machine.markStairExitCooldown(targetStairId, nowFn(), reenterCooldownMs)
      machine.setActiveStairId(null)
      pendingExitStairId = null
      activeStairId = null
      activeShopId = null
      // Preserve lastSwapMs from enter() per contract.ts §4 (enter swapBudgetMs <= 300ms)
      lastBlackFrames = 0

      machine.transitionTo('idle')
      syncPromptDom()
      await veilHandle.done()
      return true
    } catch {
      if (machine.getState() === 'exiting') {
        setBodyFlags(true)
        machine.transitionTo('inside')
      }
      await veilHandle.done().catch(() => {})
      return false
    }
  }

  function step(dtSeconds: number): void {
    const st = machine.getState()
    if (st === 'disposed' || st === 'unmounted' || !hostCtx) return
    const rawDt = Number.isFinite(dtSeconds) ? Math.max(0, Math.min(0.1, dtSeconds)) : 0
    const nowMs = nowFn()

    if (st === 'idle') {
      const walker = hostCtx.getWalker()
      if (walker) {
        const res = machine.detectSurfaceEntry(walker.position, walker.velocity, nowMs)
        syncPromptDom()
        if (res.triggeredStair) {
          void enter(res.triggeredStair.id)
        }
      } else {
        syncPromptDom()
      }
      return
    }

    if (st === 'descending') {
      contentHandle?.crowd.step(rawDt)
      contentHandle?.atmos.step(rawDt)
      descentElapsedMs += rawDt * 1000
      const activeId = machine.getActiveStairId() ?? 'nw'
      const stairDef = getStairwell(activeId)

      const maxSubDt = 1 / 60
      const subSteps = Math.max(1, Math.ceil(rawDt / maxSubDt))
      const subDt = rawDt / subSteps

      for (let i = 0; i < subSteps; i++) {
        const prevEye = playerEyeY
        const stepped = stairAdapter.stepScripted(subDt)
        if (!stepped) {
          playerX = stairDef.footIndoor.x
          playerZ = stairDef.footIndoor.z
          playerFootY = SZJ_FRAME.indoorFloorY
          playerEyeY = SZJ_FRAME.indoorFloorY + SZJ_PLAYER.eyeHeight
          playerPitch = 0
          flatEyeSmoother.reset(SZJ_FRAME.indoorFloorY, 0)
          machine.transitionTo('inside')
          break
        }

        const f = stepped.frame
        playerX = f.position.x
        playerFootY = f.position.y
        playerZ = f.position.z
        playerEyeY = f.eyeY
        playerYaw = f.yawRad
        // Ease camera pitch smoothly from entryPitchDeg (-18°) down the steps to 0° horizontal at B1 concourse
        const levelOut = f.progress <= 0.7 ? 0 : (f.progress - 0.7) / 0.3
        const smoothLevel = levelOut * levelOut * (3 - 2 * levelOut)
        playerPitch = entryPitchRad * (1 - smoothLevel) + f.pitchBiasRad * (1 - smoothLevel)
        recordEyeDelta(prevEye, playerEyeY)

        if (f.done || descentElapsedMs >= SZJ_TIMING.descentMaxMs) {
          const endPrevEye = playerEyeY
          const targetEye = SZJ_FRAME.indoorFloorY + SZJ_PLAYER.eyeHeight
          if (Math.abs(targetEye - endPrevEye) <= SZJ_BUDGET.eyeDyPerFrameMax + 1e-6) {
            playerX = stairDef.footIndoor.x
            playerZ = stairDef.footIndoor.z
            playerFootY = SZJ_FRAME.indoorFloorY
            playerEyeY = targetEye
            playerPitch = 0
            recordEyeDelta(endPrevEye, playerEyeY)
            flatEyeSmoother.reset(SZJ_FRAME.indoorFloorY, 0)
            activeStairId = null
            machine.transitionTo('inside')
            syncPromptDom()
            break
          }
        }
      }

      syncIndoorCamera()
      return
    }

    if (st === 'inside') {
      contentHandle?.crowd.step(rawDt)
      contentHandle?.atmos.step(rawDt)

      if (pressedKeys.has('ArrowLeft')) {
        playerYaw = normalizeAngleRad(playerYaw + KEY_TURN_RAD_PER_SEC * rawDt)
      }
      if (pressedKeys.has('ArrowRight')) {
        playerYaw = normalizeAngleRad(playerYaw - KEY_TURN_RAD_PER_SEC * rawDt)
      }

      let forwardAxis = 0
      let strafeAxis = 0
      if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) forwardAxis += 1
      if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) forwardAxis -= 1
      if (pressedKeys.has('KeyD')) strafeAxis += 1
      if (pressedKeys.has('KeyA')) strafeAxis -= 1

      const isRunning = pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight')
      const baseSpeed = isRunning ? SZJ_PLAYER.runSpeed : SZJ_PLAYER.walkSpeed

      const fx = -Math.sin(playerYaw)
      const fz = -Math.cos(playerYaw)
      const rx = Math.cos(playerYaw)
      const rz = -Math.sin(playerYaw)

      let dirX = fx * forwardAxis + rx * strafeAxis
      let dirZ = fz * forwardAxis + rz * strafeAxis
      const dirLen = Math.hypot(dirX, dirZ)
      if (dirLen > 1e-6) {
        dirX /= dirLen
        dirZ /= dirLen
      }

      const maxSubDt = 1 / 60
      const subSteps = Math.max(1, Math.ceil(rawDt / maxSubDt))
      const subDt = rawDt / subSteps

      for (let i = 0; i < subSteps; i++) {
        if (machine.getState() !== 'inside') break

        const preMoveStair = activeStairId ? getStairwell(activeStairId) : null
        const preLz = preMoveStair ? indoorToStairLocal(preMoveStair, { x: playerX, z: playerZ }).z : null
        const stairScale = getStairSpeedScale(preMoveStair, preLz, dirX, dirZ)
        const effSpeed = dirLen > 1e-6 ? baseSpeed * stairScale : 0

        const cmdVx = dirX * effSpeed
        const cmdVz = dirZ * effSpeed

        const moved = resolveSzjIndoorMovement(
          collisionWorld,
          layout,
          playerX,
          playerZ,
          playerFootY,
          cmdVx * subDt,
          cmdVz * subDt,
        )

        if (moved.hitWall) collisionContacts += 1
        playerX = moved.x
        playerZ = moved.z
        playerFootY = moved.footY
        ceilingClearanceM = moved.ceilingClearanceM
        activeShopId = moved.activeShopId

        const prevEye = playerEyeY
        if (moved.activeStair) {
          const sw = moved.activeStair
          const placement = interactivePlacements.get(sw.id)!
          const proj = projectWorldToStair(placement, { x: playerX, y: playerFootY, z: playerZ })
          if (trackedInteractiveStairId !== sw.id) {
            flatEyeSmoother.reset(playerEyeY - SZJ_PLAYER.eyeHeight, 0)
            trackedInteractiveStairId = sw.id
          }
          const eyeState = flatEyeSmoother.step(proj.sample, subDt)
          playerEyeY = eyeState.eyeY
          activeStairId = sw.id
        } else {
          trackedInteractiveStairId = null
          activeStairId = null
          const flatSample = {
            s: 0,
            t: 0,
            height: SZJ_FRAME.indoorFloorY,
            slope: 0,
            curvature: 0,
            discreteHeight: SZJ_FRAME.indoorFloorY,
            stepIndex: 0,
            stepPhase: 0,
            inclineRad: 0,
            zone: 'exit-landing' as const,
          }
          const eyeState = flatEyeSmoother.step(flatSample, subDt)
          playerEyeY = eyeState.eyeY
        }
        recordEyeDelta(prevEye, playerEyeY)

        if (moved.activeStair && dirLen > 1e-6) {
          const smoothedFootY = playerEyeY - SZJ_PLAYER.eyeHeight
          if (
            shouldExitStair(
              moved.activeStair,
              { x: playerX, y: Math.min(playerFootY, smoothedFootY), z: playerZ },
              { x: cmdVx, z: cmdVz },
            )
          ) {
            pendingExitStairId = moved.activeStair.id
            void exit()
            break
          }
        }
      }

      syncPromptDom()
      syncIndoorCamera()
    }
  }

  function getMetrics(): SzjIndoorMetrics {
    return {
      drawCalls: lastDrawCalls || (contentHandle ? contentHandle.meshCount : 0),
      triangles: contentHandle ? contentHandle.triangleCount : 0,
      textureBytes: contentHandle ? contentHandle.textureBytes : 0,
      npcCount: contentHandle ? contentHandle.npcCount : 0,
      lastSwapMs,
      lastBlackFrames,
      lastMaxEyeDy,
      lastLandingError,
    }
  }

  function getPlayerSnapshot(): SzjPlayerSnapshot {
    return {
      x: Math.round(playerX * 1000) / 1000,
      footY: Math.round(playerFootY * 1000) / 1000,
      eyeY: Math.round(playerEyeY * 1000) / 1000,
      z: Math.round(playerZ * 1000) / 1000,
      yaw: Math.round(playerYaw * 10000) / 10000,
      pitch: Math.round(playerPitch * 10000) / 10000,
      ceilingClearanceM,
      activeStairId,
      activeShopId,
      collisionContacts,
    }
  }

  function getVisibleHangingSigns(maxDistM = 35): readonly SzjHangingSign[] {
    syncIndoorCamera()
    camera.updateProjectionMatrix()
    viewProjMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    viewFrustum.setFromProjectionMatrix(viewProjMat)
    const maxDistSq = maxDistM * maxDistM
    const visible: SzjHangingSign[] = []
    for (const sg of wayfinding.signs) {
      const dx = sg.x - camera.position.x
      const dz = sg.z - camera.position.z
      const distSq = dx * dx + dz * dz
      if (distSq > maxDistSq) continue
      const cy = SZJ_FRAME.indoorFloorY + sg.bottomY + sg.height * 0.5
      signProbePt.set(sg.x, cy, sg.z)
      if (!viewFrustum.containsPoint(signProbePt)) continue
      const toCamX = -dx
      const toCamZ = -dz
      const horizDist = Math.hypot(toCamX, toCamZ)
      if (horizDist > 1e-4) {
        const readableFace = sg.faces.some(f => {
          const nx = Math.sin(f.yaw)
          const nz = Math.cos(f.yaw)
          return (nx * toCamX + nz * toCamZ) / horizDist > 0.12
        })
        if (!readableFace) continue
      }
      visible.push(sg)
    }
    return visible
  }

  function getSignMetrics(): SzjSignRuntimeMetrics {
    const visible = getVisibleHangingSigns()
    const batch = contentHandle?.wayfindingBatch
    return {
      wayfindingSignCount: wayfinding.signs.length,
      inWorldSignCount: batch ? batch.boxMesh.count : 0,
      faceCount: batch ? wayfinding.signs.reduce((sum, s) => sum + s.faces.length, 0) : 0,
      rodCount: batch ? batch.rodMesh.count : 0,
      drawCalls: batch ? batch.drawCalls : 0,
      triangles: batch ? batch.triangles : 0,
      wallWayfindingPlaqueCount: contentHandle ? contentHandle.wallWayfindingPlaqueCount : 0,
      safetyExitPlaqueCount: contentHandle ? contentHandle.safetyExitPlaqueCount : 0,
      visibleSignIds: visible.map(s => s.id),
      visibleSignCount: visible.length,
    }
  }

  function getActiveShop(): SzjShop | null {
    return activeStairId ? null : detectActiveSzjShop(layout, playerX, playerZ)
  }

  function dispose(): void {
    if (machine.getState() === 'disposed') return
    setBodyFlags(false)
    unmountDomAndListeners()
    stairAdapter.reset()
    if (contentHandle) {
      scene.remove(contentHandle.scene)
      contentHandle.dispose()
      contentHandle = null
    }
    scene.clear()
    hostCtx = null
    pendingExitStairId = null
    activeStairId = null
    activeShopId = null
    lastDrawCalls = 0
    machine.dispose()
  }

  return {
    get state() {
      return machine.getState()
    },
    scene,
    camera,
    mount,
    enter,
    exit,
    step,
    renderFrame,
    getMetrics,
    getPlayerSnapshot,
    getCrowdMetrics: () => (contentHandle ? contentHandle.crowd.getMetrics() : null),
    getAtmosMetrics: () => (contentHandle ? contentHandle.atmos.getMetrics() : null),
    getWayfinding: () => wayfinding,
    getHangingSigns: () => wayfinding.signs,
    getVisibleHangingSigns,
    getSignMetrics,
    getLayout: () => layout,
    getActiveShop,
    dispose,
  }
}
