import * as THREE from 'three'
import {
  SZJ_BUDGET,
  SZJ_FRAME,
  SZJ_PLAYER,
  SZJ_STAIRWELLS,
  getStairwell,
  indoorToStairLocal,
  indoorToWorld,
  stairLocalToIndoor,
  validateSzjLayout,
  worldToIndoor,
  yawFacing,
  type SzjHostContext,
  type SzjIndoorMetrics,
  type SzjShop,
  type SzjStairId,
  type SzjStairwell,
  type SzjXZ,
} from '../contract.ts'
import { SZJ_LANDING } from '../frame.ts'
import { SZJ_STAIR_DOOR, szjDoorCentre } from '../look/stairwell-geometry.ts'
import { SHIZIJIE_B1_LAYOUT } from '../layout/index.ts'
import { buildSzjWayfinding, type SzjHangingSign } from '../wayfinding/index.ts'
import { createStairEyeSmoother, projectWorldToStair, type StairPlacement } from '../../locomotion/stairs/index.ts'
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
/** walk/config pitch: the street walker's level first-person tilt (walk/camera placeFirstPersonCamera). */
const WALKER_LEVEL_PITCH = 0.3
/** walk/camera placeFirstPersonCamera: the lens sits this far ahead of the eye along the view. */
const EYE_FORWARD_M = 0.08
/** Indoor FOV and run pace match the street on a landing and fade to indoor values by FAR (m). */
const LANDING_MATCH_NEAR_M = 2.4
const LANDING_MATCH_FAR_M = 7
/** Street walker depth below grade (m) where the camera starts easing into first person / is fully there. */
const VIEW_BLEND_START_M = 0.6
const VIEW_BLEND_FULL_M = 3.4
/** The shutter keeps the eye this far off its plane (m) until it has rolled up past head height. */
const SHUTTER_STANDOFF_M = 0.2
/** Eased roll-up progress at which the shutter clears passOpen. */
const SHUTTER_PASS_PROGRESS = 0.7

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
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
 * 十字街地下街 B1 室内运行时控制器（contract.ts SzjIndoorScene）：
 * 1) 街上行人自己走下真楼梯井，到底部平台越过 SZJ_LANDING.enter 线的同一帧换进 B1：位置、朝向、俯仰、
 *    眼高、FOV 全部沿用，不黑屏、不过场；底部卷帘门随人靠近卷起；
 * 2) 室内独立 THREE.Scene + 折线通道/斜向梯井碰撞 + 非交互人气 NPC，不依赖城市 terrain / world.ts；
 * 3) 往回走过卷帘门、退到 SZJ_LANDING.exit 线即同帧把原姿态交还街上行人，接着走真楼梯上去。
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

  const collisionWorld = buildSzjCollisionWorld(layout, SZJ_PLAYER.radius, SZJ_PLAYER.eyeHeight)
  const wayfinding = buildSzjWayfinding(layout)
  const machine = createSzjRuntimeStateMachine(SZJ_STAIRWELLS)

  const flatEyeSmoother = createStairEyeSmoother({
    eyeOffset: SZJ_PLAYER.eyeHeight,
    maxDeltaYPerFrame: SZJ_BUDGET.eyeDyPerFrameMax,
  })

  const interactivePlacements = new Map<SzjStairId, StairPlacement>()
  const doorCentres = new Map<SzjStairId, SzjXZ>()
  /** Swap stations on each bottom landing (indoor x/z): FOV / pace matching is measured from here. */
  const landingStations: SzjXZ[] = []
  for (const st of SZJ_STAIRWELLS) {
    interactivePlacements.set(st.id, makeInteractivePlacement(st))
    doorCentres.set(st.id, szjDoorCentre(st))
    landingStations.push(stairLocalToIndoor(st, { x: 0, z: st.length / 2 + SZJ_LANDING.enter }))
  }
  /** Shutter roll-up progress per well, 0 closed .. 1 open (linear; eased when shown). */
  const doorProgress = new Map<SzjStairId, number>(SZJ_STAIRWELLS.map(st => [st.id, 0]))

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
  let trackedInteractiveStairId: SzjStairId | null = null
  /** Last value handed to host.setWorldViewBlend (undefined = never sent). */
  let viewBlendSent: number | null | undefined

  let lastDrawCalls = 0
  let lastSwapMs = 0
  let lastBlackFrames = 0
  let lastMaxEyeDy = 0
  let currentTraverseMaxEyeDy = 0
  /** Distance between the pose handed back and where the street walker actually resumed (m). */
  let lastLandingError = 0

  const pressedKeys = new Set<string>()
  let draggingLook = false
  let lastPointerX = 0
  let lastPointerY = 0
  let styleLinkEl: HTMLLinkElement | null = null

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

  function sendViewBlend(blend: number | null): void {
    if (blend === viewBlendSent) return
    viewBlendSent = blend
    hostCtx?.setWorldViewBlend?.(blend)
  }

  /** 1 on a bottom landing (match the street walker), 0 in the concourse proper. */
  function landingMatch(): number {
    let best = Infinity
    for (const p of landingStations) best = Math.min(best, Math.hypot(playerX - p.x, playerZ - p.z))
    return 1 - smoothstep(LANDING_MATCH_NEAR_M, LANDING_MATCH_FAR_M, best)
  }

  function doorOpen(id: SzjStairId): number {
    const p = doorProgress.get(id) ?? 0
    return p * p * (3 - 2 * p)
  }

  function resetDoors(): void {
    for (const st of SZJ_STAIRWELLS) {
      doorProgress.set(st.id, 0)
      contentHandle?.setStairDoorOpen(st.id, 0)
    }
  }

  /**
   * Shutters roll up while the player is near. A player hurrying at one rolls it faster, so it always clears
   * head height before they reach SHUTTER_STANDOFF_M from it and nobody is stopped right after the swap.
   */
  function stepDoors(dt: number, vx: number, vz: number): void {
    const d = SZJ_STAIR_DOOR
    for (const st of SZJ_STAIRWELLS) {
      const c = doorCentres.get(st.id)!
      const toX = c.x - playerX
      const toZ = c.z - playerZ
      const dist = Math.hypot(toX, toZ)
      const prev = doorProgress.get(st.id) ?? 0
      let next: number
      if (dist <= d.triggerM) {
        const approach = dist > 1e-6 ? (vx * toX + vz * toZ) / dist : 0
        const gap = Math.max(0.05, dist - SHUTTER_STANDOFF_M)
        const rate = Math.max(1 / d.travelS, approach > 0 ? (SHUTTER_PASS_PROGRESS * approach) / gap : 0)
        next = Math.min(1, prev + dt * rate)
      } else {
        next = Math.max(0, prev - dt / d.travelS)
      }
      if (next === prev) continue
      doorProgress.set(st.id, next)
      contentHandle?.setStairDoorOpen(st.id, doorOpen(st.id))
    }
  }

  /** A shutter that has not rolled past head height keeps the eye SHUTTER_STANDOFF_M off its plane. */
  function blockShutters(prevX: number, prevZ: number, x: number, z: number): { x: number; z: number; hit: boolean } {
    for (const st of SZJ_STAIRWELLS) {
      if (doorOpen(st.id) >= SZJ_STAIR_DOOR.passOpen) continue
      const l = indoorToStairLocal(st, { x, z })
      if (Math.abs(l.x) > st.width / 2) continue
      const doorLz = st.length / 2 + SZJ_LANDING.door
      const prevLz = indoorToStairLocal(st, { x: prevX, z: prevZ }).z
      let lz = l.z
      if (prevLz <= doorLz && lz > doorLz - SHUTTER_STANDOFF_M) lz = Math.max(Math.min(prevLz, lz), doorLz - SHUTTER_STANDOFF_M)
      else if (prevLz > doorLz && lz < doorLz + SHUTTER_STANDOFF_M) lz = Math.min(Math.max(prevLz, lz), doorLz + SHUTTER_STANDOFF_M)
      if (lz === l.z) continue
      const p = stairLocalToIndoor(st, { x: l.x, z: lz })
      return { x: p.x, z: p.z, hit: true }
    }
    return { x, z, hit: false }
  }

  function syncIndoorCamera(): void {
    const worldCam = hostCtx?.worldCamera
    const worldAspect = worldCam?.aspect
    let projectionDirty = false
    if (worldAspect && Number.isFinite(worldAspect) && Math.abs(camera.aspect - worldAspect) > 1e-4) {
      camera.aspect = worldAspect
      projectionDirty = true
    }
    const streetFov = worldCam && Number.isFinite(worldCam.fov) ? worldCam.fov : SZJ_PLAYER.fovDeg
    const fov = SZJ_PLAYER.fovDeg + (streetFov - SZJ_PLAYER.fovDeg) * landingMatch()
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov
      projectionDirty = true
    }
    if (projectionDirty) camera.updateProjectionMatrix()
    // Same lens placement as walk/camera placeFirstPersonCamera: a few cm in front of the eye along the view.
    const cp = Math.cos(playerPitch)
    camera.rotation.order = 'YXZ'
    camera.rotation.set(playerPitch, playerYaw, 0, 'YXZ')
    camera.position.set(
      playerX - Math.sin(playerYaw) * cp * EYE_FORWARD_M,
      playerEyeY + Math.sin(playerPitch) * EYE_FORWARD_M,
      playerZ - Math.cos(playerYaw) * cp * EYE_FORWARD_M,
    )
    camera.updateMatrixWorld(true)
  }

  function renderFrame(): boolean {
    const st = machine.getState()
    if ((st !== 'inside' && st !== 'exiting') || !contentHandle) return false
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
    pressedKeys.add(e.code)
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
    styleLinkEl?.remove()
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
    resetDoors()
    syncIndoorCamera()
    mountDomAndListeners()
    machine.transitionTo('idle')
    await prewarmGpu(ctx.renderer)
  }

  /** Compile shaders and upload textures at mount (still on the street), so the swap frame only renders. */
  async function prewarmGpu(renderer: THREE.WebGLRenderer): Promise<void> {
    try {
      const textures = new Set<THREE.Texture>()
      scene.traverse(obj => {
        const mat = (obj as THREE.Mesh).material
        for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
          for (const v of Object.values(m)) if ((v as THREE.Texture | null)?.isTexture) textures.add(v as THREE.Texture)
        }
      })
      if (typeof renderer.initTexture === 'function') for (const t of textures) renderer.initTexture(t)
      if (typeof renderer.compileAsync === 'function') await renderer.compileAsync(scene, camera)
      else if (typeof renderer.compile === 'function') renderer.compile(scene, camera)
    } catch {
      // Headless mock renderers may omit these; the first indoor frame compiles instead.
    }
  }

  /** Swap into B1 this frame with an exact pose (indoor x/z, indoor foot y, host yaw, indoor pitch). */
  function swapIn(st: SzjStairwell, x: number, z: number, footY: number, yaw: number, pitch: number): boolean {
    if (!hostCtx || !contentHandle) return false
    if (!machine.transitionTo('entering')) return false
    const swapStart = nowFn()
    const settled = resolveSzjIndoorMovement(collisionWorld, layout, x, z, SZJ_FRAME.indoorFloorY, 0, 0)
    playerX = settled.x
    playerZ = settled.z
    playerFootY = settled.footY
    activeShopId = settled.activeShopId
    activeStairId = settled.activeStair?.id ?? null
    trackedInteractiveStairId = null
    // The street feet may sit a few cm off the B1 floor; start the eye there and let the smoother level it.
    const eye = flatEyeSmoother.reset(footY, 0)
    playerEyeY = eye.eyeY
    playerYaw = normalizeAngleRad(yaw)
    playerPitch = clampSzjPitch(collisionWorld, pitch)
    currentTraverseMaxEyeDy = 0
    draggingLook = false
    resetDoors()
    machine.setActiveStairId(st.id)
    setBodyFlags(true)
    hostCtx.suspendWorld()
    syncIndoorCamera()
    if (!machine.transitionTo('inside')) {
      setBodyFlags(false)
      machine.setActiveStairId(null)
      machine.transitionTo('idle')
      return false
    }
    lastSwapMs = Math.max(0, Math.round((nowFn() - swapStart) * 100) / 100)
    lastBlackFrames = 0
    return true
  }

  /** Street walker reached the bottom landing of a well: take over with the walker's own pose. */
  function enterFromStairs(
    st: SzjStairwell,
    walker: { position: { x: number; y: number; z: number }; yaw?: number; pitch?: number },
  ): boolean {
    const indoor = worldToIndoor(walker.position)
    return swapIn(
      st,
      indoor.x,
      indoor.z,
      walker.position.y - (st.groundY - SZJ_FRAME.depth),
      walker.yaw ?? yawFacing(st.inward),
      WALKER_LEVEL_PITCH - (walker.pitch ?? WALKER_LEVEL_PITCH),
    )
  }

  /** Player walked back past the shutter to the exit line: hand the exact pose to the street walker, same frame. */
  function exitToStairs(st: SzjStairwell): boolean {
    const host = hostCtx
    if (!host) return false
    if (!machine.transitionTo('exiting')) return false
    const swapStart = nowFn()
    const world = indoorToWorld({ x: playerX, z: playerZ })
    draggingLook = false
    setBodyFlags(false)
    sendViewBlend(1)
    void host
      .resumeWorldAt({
        x: world.x,
        z: world.z,
        footY: playerFootY + st.groundY - SZJ_FRAME.depth,
        yaw: playerYaw,
        pitch: WALKER_LEVEL_PITCH - playerPitch,
      })
      .catch(() => false)
    const resumed = host.getWalker()
    lastLandingError = resumed
      ? Math.round(Math.hypot(resumed.position.x - world.x, resumed.position.z - world.z) * 10000) / 10000
      : 0
    machine.setActiveStairId(null)
    activeStairId = null
    activeShopId = null
    trackedInteractiveStairId = null
    machine.transitionTo('idle')
    lastSwapMs = Math.max(0, Math.round((nowFn() - swapStart) * 100) / 100)
    lastBlackFrames = 0
    return true
  }

  /** Probe/test entry: stand on that well's bottom landing just past the swap line, facing the concourse. */
  async function enter(stairId: SzjStairId): Promise<boolean> {
    if (!isValidStairId(stairId) || machine.getState() !== 'idle') return false
    const st = getStairwell(stairId)
    const at = stairLocalToIndoor(st, { x: 0, z: st.length / 2 + SZJ_LANDING.enter + 0.05 })
    return swapIn(st, at.x, at.z, SZJ_FRAME.indoorFloorY, yawFacing(st.inward), 0)
  }

  /** Probe/test exit: back on the street walker at the nearest well's exit line, facing up the stairs. */
  async function exit(): Promise<boolean> {
    if (machine.getState() !== 'inside') return false
    let best = SZJ_STAIRWELLS[0]!
    let bestD = Infinity
    for (const st of SZJ_STAIRWELLS) {
      const d = Math.hypot(playerX - st.footIndoor.x, playerZ - st.footIndoor.z)
      if (d < bestD) {
        bestD = d
        best = st
      }
    }
    const at = stairLocalToIndoor(best, { x: 0, z: best.length / 2 + SZJ_LANDING.exit - 0.05 })
    playerX = at.x
    playerZ = at.z
    playerFootY = SZJ_FRAME.indoorFloorY
    playerYaw = yawFacing({ x: -best.inward.x, z: -best.inward.z })
    playerPitch = 0
    return exitToStairs(best)
  }

  /** On the street: ease the walker into first person down a well, swap in on its bottom landing. */
  function stepSurface(): void {
    const walker = hostCtx?.getWalker() ?? null
    if (!walker) {
      sendViewBlend(null)
      return
    }
    const indoor = worldToIndoor(walker.position)
    for (const st of SZJ_STAIRWELLS) {
      const l = indoorToStairLocal(st, indoor)
      const hl = st.length / 2
      if (Math.abs(l.x) > st.width / 2 + 0.3 || l.z < -hl - 0.5 || l.z > hl + SZJ_LANDING.door + 0.3) continue
      const depth = st.groundY - walker.position.y
      sendViewBlend(smoothstep(VIEW_BLEND_START_M, VIEW_BLEND_FULL_M, depth))
      if (l.z >= hl + SZJ_LANDING.enter && Math.abs(l.x) <= st.width / 2 && depth >= SZJ_FRAME.depth - 0.6) {
        enterFromStairs(st, walker)
      }
      return
    }
    sendViewBlend(null)
  }

  function step(dtSeconds: number): void {
    const st = machine.getState()
    if (st === 'disposed' || st === 'unmounted' || !hostCtx) return
    const rawDt = Number.isFinite(dtSeconds) ? Math.max(0, Math.min(0.1, dtSeconds)) : 0

    if (st === 'idle') {
      stepSurface()
      return
    }
    if (st !== 'inside') return

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
    // Running keeps the street pace on a landing so the swap never brakes the walker.
    const baseSpeed = isRunning
      ? SZJ_PLAYER.runSpeed + (SZJ_PLAYER.streetRunSpeed - SZJ_PLAYER.runSpeed) * landingMatch()
      : SZJ_PLAYER.walkSpeed

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
      const preMoveStair = activeStairId ? getStairwell(activeStairId) : null
      const preLz = preMoveStair ? indoorToStairLocal(preMoveStair, { x: playerX, z: playerZ }).z : null
      const stairScale = getStairSpeedScale(preMoveStair, preLz, dirX, dirZ)
      const effSpeed = dirLen > 1e-6 ? baseSpeed * stairScale : 0
      const cmdVx = dirX * effSpeed
      const cmdVz = dirZ * effSpeed

      stepDoors(subDt, cmdVx, cmdVz)
      const moved = resolveSzjIndoorMovement(
        collisionWorld,
        layout,
        playerX,
        playerZ,
        playerFootY,
        cmdVx * subDt,
        cmdVz * subDt,
      )
      const held = blockShutters(playerX, playerZ, moved.x, moved.z)

      if (moved.hitWall || held.hit) collisionContacts += 1
      playerX = held.x
      playerZ = held.z
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
        playerEyeY = flatEyeSmoother.step(proj.sample, subDt).eyeY
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
        playerEyeY = flatEyeSmoother.step(flatSample, subDt).eyeY
      }
      recordEyeDelta(prevEye, playerEyeY)

      if (moved.activeStair && dirLen > 1e-6) {
        const sw = moved.activeStair
        const l = indoorToStairLocal(sw, { x: playerX, z: playerZ })
        const outward = cmdVx * sw.inward.x + cmdVz * sw.inward.z < 0
        if (outward && Math.abs(l.x) <= sw.width / 2 && l.z <= sw.length / 2 + SZJ_LANDING.exit) {
          exitToStairs(sw)
          return
        }
      }
    }

    syncIndoorCamera()
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
    sendViewBlend(null)
    setBodyFlags(false)
    unmountDomAndListeners()
    if (contentHandle) {
      scene.remove(contentHandle.scene)
      contentHandle.dispose()
      contentHandle = null
    }
    scene.clear()
    hostCtx = null
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
