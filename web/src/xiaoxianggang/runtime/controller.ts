import * as THREE from 'three'
import {
  XXG_PLAYER,
  XXG_PORTALS,
  XXG_PORTAL_IDS,
  XXG_TIMING,
  getPortal,
  portalLanding,
  validateXxgLayout,
  worldToPortalLocal,
  type XxgHostContext,
  type XxgIndoorMetrics,
  type XxgPortal,
  type XxgPortalId,
  type XxgState,
} from '../contract.ts'
import { XXG_FRAME, XXG_STAIRWELL, indoorToWorld, stairwellViewBlend, worldToIndoor } from '../frame.ts'
import { buildIndoorCollisionWorld, clampIndoorPitch, resolveIndoorMovement, type Aabb2D } from './collision.ts'
import { XIAOXIANGGANG_B1_LAYOUT } from '../layout/index.ts'
import { createIndoorGreyboxScene, type IndoorGreyboxSceneHandle } from './indoor-scene.ts'
import { XXG_CROWD_MAX, createXxgCrowd, type XxgCrowd } from './crowd.ts'
import { createXxgRuntimeStateMachine } from './state-machine.ts'
import {
  XXG_WELL_DOOR,
  distanceToNearestLanding,
  doorLeafRects,
  doorOpenFraction,
  locateInWell,
  type XxgIndoorWell,
} from './stairwell.ts'
import {
  normalizeAngleRad,
  type CreateXxgIndoorSceneOptions,
  type XxgExtendedIndoorScene,
  type XxgPlayerSnapshot,
} from './types.ts'

const LOOK_SENSITIVITY_RAD_PER_PX = 0.0026
const KEY_TURN_RAD_PER_SEC = 1.85
const INDOOR_CAMERA_NEAR = 0.08
const INDOOR_CAMERA_FAR = 140
/** walk/config cfg.pitch: the walker pitch that means "looking level" in first person. */
const WALKER_LEVEL_PITCH = 0.3
/** walk/camera placeFirstPersonCamera puts the lens this far in front of the eye point. */
const EYE_FORWARD_M = 0.08
/** Indoor yaw = world yaw + this (the plaza axis E sits this far clockwise from world +x). */
const FRAME_YAW = Math.atan2(XXG_FRAME.axisE.z, XXG_FRAME.axisE.x)
const B1_WORLD_Y = XXG_FRAME.surfaceY - XXG_STAIRWELL.depth
/** Near a landing the indoor view and run speed match the street walker; they settle to indoor values by this distance. */
const LANDING_MATCH_NEAR_M = 2.4
const LANDING_MATCH_FAR_M = 7
/** The well footprint as seen from the street: a little past the top nosing so the blend releases cleanly. */
const SURFACE_WELL_MARGIN_M = 0.6

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, ms))
}

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

function isValidPortalId(id: unknown): id is XxgPortalId {
  return typeof id === 'string' && (XXG_PORTAL_IDS as readonly string[]).includes(id)
}

/** Street walker inside one of the four wells (portal-local lx, lz), or null. */
function locateSurfaceWell(pos: { x: number; z: number }): { portal: XxgPortal; lx: number; lz: number } | null {
  const w = XXG_STAIRWELL
  for (const portal of XXG_PORTALS) {
    const l = worldToPortalLocal(portal, pos)
    if (Math.abs(l.x) <= w.halfWidth + 0.05 && l.z >= w.zBack - 0.05 && l.z <= w.zTop + SURFACE_WELL_MARGIN_M) {
      return { portal, lx: l.x, lz: l.z }
    }
  }
  return null
}

/**
 * Implements contract.ts XxgIndoorScene:
 * - Standalone THREE.Scene + first-person PerspectiveCamera (never mutating worldCamera or walk/view-mode)
 * - Walk-in stairwells: the street walker goes down the real flight; on the landing the scene swaps in the same
 *   frame with the same position, eye height, yaw, pitch and FOV, and walking back up swaps out the same way.
 * - [E]-free; enter()/exit() keep the veiled teleport for programmatic entry (map, tests).
 * - Zero residue across repeated enter/exit cycles, zero leaks on dispose()
 */
export function createXxgIndoorScene(opts: CreateXxgIndoorSceneOptions = {}): XxgExtendedIndoorScene {
  const layout = opts.layout ?? XIAOXIANGGANG_B1_LAYOUT
  const layoutErrors = validateXxgLayout(layout)
  if (layoutErrors.length > 0) {
    throw new Error(`Invalid XxgLayout passed to createXxgIndoorScene: ${layoutErrors.join('; ')}`)
  }

  const nowFn = opts.now ?? (() => performance.now())
  const veilFadeInMs = Math.max(0, opts.veilFadeInMs ?? XXG_TIMING.veilFadeInMs)

  const collisionWorld = buildIndoorCollisionWorld(layout, XXG_PLAYER.radius, XXG_PLAYER.eyeHeight)
  const wells = collisionWorld.wells
  const machine = createXxgRuntimeStateMachine()

  const scene = new THREE.Scene()
  scene.name = 'xxg-indoor-root'
  scene.background = new THREE.Color('#d6dde3')

  const camera = new THREE.PerspectiveCamera(XXG_PLAYER.fovDeg, 16 / 9, INDOOR_CAMERA_NEAR, INDOOR_CAMERA_FAR)
  camera.rotation.order = 'YXZ'

  let hostCtx: XxgHostContext | null = null
  let greyboxHandle: IndoorGreyboxSceneHandle | null = null
  let crowd: XxgCrowd | null = null
  const crowdMaxAgents = Math.max(0, Math.floor(opts.crowdMaxAgents ?? XXG_CROWD_MAX))
  let pendingExitPortalId: XxgPortalId | null = null

  // Indoor first-person kinematic state
  let playerX = layout.exits[0]?.foot.x ?? 0
  let playerZ = layout.exits[0]?.foot.z ?? 0
  let playerFootY = 0
  const standingEyeY = Math.min(XXG_PLAYER.eyeHeight, layout.ceilingHeight - 0.45)
  /** Street foot height minus the B1 floor at the swap; eased out so the eye never steps. */
  let eyeOffset = 0
  let playerEyeY = standingEyeY
  let playerYaw = layout.exits[0]?.yaw ?? 0
  let playerPitch = 0
  let ceilingClearanceM = layout.ceilingHeight - standingEyeY
  let activeShopId: string | null = null
  let collisionContacts = 0

  // B1 glass doors: linear travel progress per well; leaves are obstacles where they stand.
  const doorProgress = wells.map(() => 0)
  let doorObstacles: Aabb2D[] = []

  /** Last value handed to host.setWorldViewBlend (undefined = never sent). */
  let viewBlendSent: number | null | undefined

  // Contract metrics (XxgIndoorMetrics)
  let lastDrawCalls = 0
  let lastSwapMs = 0
  let lastBlackFrames = 0
  let swapStartedAt: number | null = null

  // Input & DOM
  const pressedKeys = new Set<string>()
  let draggingLook = false
  let lastPointerX = 0
  let lastPointerY = 0
  let styleLinkEl: HTMLLinkElement | null = null
  let listening = false

  function setBodyFlags(active: boolean): void {
    if (typeof document === 'undefined' || !document.body?.dataset) return
    const flag = hostCtx?.bodyFlag ?? 'xxgActive'
    if (active) {
      document.body.dataset[flag] = '1'
      document.body.dataset.xxgIndoor = '1'
    } else {
      delete document.body.dataset[flag]
      delete document.body.dataset.xxgIndoor
    }
  }

  function sendViewBlend(blend: number | null): void {
    if (blend === viewBlendSent) return
    viewBlendSent = blend
    hostCtx?.setWorldViewBlend?.(blend)
  }

  function rebuildDoorObstacles(): void {
    const out: Aabb2D[] = []
    for (const w of wells) out.push(...doorLeafRects(w, doorOpenFraction(doorProgress[w.index])))
    doorObstacles = out
  }

  function resetDoors(): void {
    for (const w of wells) {
      doorProgress[w.index] = 0
      greyboxHandle?.wellDoors?.setOpen(w.index, 0)
    }
    rebuildDoorObstacles()
  }

  /** Doors slide open while the player is near; the leaves keep blocking until they are out of the way. */
  function stepDoors(dt: number): void {
    const d = XXG_WELL_DOOR
    let changed = false
    for (const w of wells) {
      const near = Math.hypot(playerX - w.door.x, playerZ - w.door.z) <= d.triggerM
      const prev = doorProgress[w.index]
      const next = near ? Math.min(1, prev + dt / d.travelS) : Math.max(0, prev - dt / d.travelS)
      if (next === prev) continue
      doorProgress[w.index] = next
      greyboxHandle?.wellDoors?.setOpen(w.index, doorOpenFraction(next))
      changed = true
    }
    if (changed) rebuildDoorObstacles()
  }

  /** 1 on a landing (match the street walker), 0 in the mall proper. */
  function landingMatch(): number {
    return 1 - smoothstep(LANDING_MATCH_NEAR_M, LANDING_MATCH_FAR_M, distanceToNearestLanding(playerX, playerZ, wells))
  }

  function syncIndoorCamera(): void {
    const worldCam = hostCtx?.worldCamera
    const worldAspect = worldCam?.aspect
    let projectionDirty = false
    if (worldAspect && Number.isFinite(worldAspect) && Math.abs(camera.aspect - worldAspect) > 1e-4) {
      camera.aspect = worldAspect
      projectionDirty = true
    }
    const streetFov = worldCam && Number.isFinite(worldCam.fov) ? worldCam.fov : XXG_PLAYER.fovDeg
    const fov = XXG_PLAYER.fovDeg + (streetFov - XXG_PLAYER.fovDeg) * landingMatch()
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
    if ((st !== 'inside' && st !== 'exiting') || !greyboxHandle) return false
    syncIndoorCamera()
    if (hostCtx?.renderer) {
      hostCtx.renderer.info.reset()
      hostCtx.renderer.render(scene, camera)
      lastDrawCalls = hostCtx.renderer.info.render.calls
    } else {
      lastDrawCalls = greyboxHandle.meshCount + (crowd?.getMetrics().drawCalls ?? 0)
    }
    if (swapStartedAt !== null) {
      lastSwapMs = Math.max(0, Math.round((nowFn() - swapStartedAt) * 100) / 100)
      swapStartedAt = null
    }
    return true
  }

  function onKeyDown(e: KeyboardEvent): void {
    const st = machine.getState()
    if (st === 'disposed' || st === 'unmounted') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (isEditableTarget(e.target) || isOverlayBlockingHud()) return
    // Tracked on the street too, so a key held down the stairs keeps walking after the swap.
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
    playerPitch = clampIndoorPitch(collisionWorld, playerPitch - dy * LOOK_SENSITIVITY_RAD_PER_PX)
    e.stopPropagation?.()
  }

  function onPointerUp(): void {
    draggingLook = false
  }

  function mountDomAndListeners(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined' || !document.body) return
    if (!document.head.querySelector('link[data-xxg-style="1"]')) {
      try {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = new URL('./xxg-ui.css', import.meta.url).href
        link.dataset.xxgStyle = '1'
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
    listening = true
  }

  function unmountDomAndListeners(): void {
    if (listening && typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
    }
    listening = false
    styleLinkEl?.remove()
    styleLinkEl = null
    pressedKeys.clear()
    draggingLook = false
  }

  async function mount(ctx: XxgHostContext): Promise<void> {
    if (machine.getState() === 'disposed') return
    if (machine.getState() !== 'unmounted') return
    hostCtx = ctx
    greyboxHandle = createIndoorGreyboxScene(layout)
    scene.background = greyboxHandle.scene.background
    scene.fog = greyboxHandle.scene.fog
    scene.add(greyboxHandle.scene)
    resetDoors()
    if (crowdMaxAgents > 0) {
      crowd = createXxgCrowd({
        layout,
        maxAgents: crowdMaxAgents,
        seed: opts.crowdSeed,
        columns: greyboxHandle.columnCenters,
        blocked: wells.map(w => w.footprint),
      })
      scene.add(crowd.group)
    }
    mountDomAndListeners()
    machine.transitionTo('idle')
    await prewarmGpu(ctx.renderer)
  }

  /** 挂载时（入口懒加载、还在地面上）就编译着色器、上传纹理，换场那一帧只剩渲染。 */
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
      // 预热失败不影响进入：首帧照常编译。
    }
  }

  function settleEye(dt: number): void {
    eyeOffset = Math.abs(eyeOffset) < 1e-4 ? 0 : eyeOffset * Math.exp(-dt * 12)
    playerEyeY = standingEyeY + eyeOffset
    ceilingClearanceM = Math.round((layout.ceilingHeight - playerEyeY) * 1000) / 1000
  }

  /** Street walker reached the landing of a well: swap in this frame with the walker's own pose. */
  function enterFromStairs(
    portalId: XxgPortalId,
    walker: { position: { x: number; y: number; z: number }; yaw?: number; pitch?: number },
  ): boolean {
    if (!hostCtx || !greyboxHandle) return false
    if (!machine.transitionTo('entering')) return false
    swapStartedAt = nowFn()

    resetDoors()
    const indoor = worldToIndoor(walker.position)
    const settled = resolveIndoorMovement(collisionWorld, layout, indoor.x, indoor.z, 0, 0, doorObstacles)
    playerX = settled.x
    playerZ = settled.z
    playerFootY = settled.y
    activeShopId = settled.activeShopId
    eyeOffset = Math.max(-0.4, Math.min(0.4, walker.position.y - B1_WORLD_Y))
    settleEye(0)
    playerYaw = normalizeAngleRad((walker.yaw ?? 0) + FRAME_YAW)
    playerPitch = clampIndoorPitch(collisionWorld, WALKER_LEVEL_PITCH - (walker.pitch ?? WALKER_LEVEL_PITCH))
    draggingLook = false
    const foot = layout.exits.find(e => e.portalId === portalId)
    crowd?.reset(foot ? { x: foot.foot.x, z: foot.foot.z, yaw: foot.yaw } : { x: playerX, z: playerZ, yaw: playerYaw })

    machine.setActivePortalId(portalId)
    pendingExitPortalId = portalId
    setBodyFlags(true)
    hostCtx.suspendWorld()
    syncIndoorCamera()
    if (!machine.transitionTo('inside')) {
      setBodyFlags(false)
      machine.setActivePortalId(null)
      swapStartedAt = null
      return false
    }
    lastBlackFrames = 0
    return true
  }

  /** Player walked back onto a landing: hand the exact pose to the street walker, first person, same frame. */
  function exitToStairs(well: XxgIndoorWell): void {
    const host = hostCtx
    if (!host) return
    if (!machine.transitionTo('exiting')) return
    const swapStart = nowFn()
    const portal = getPortal(well.portalId)
    const world = indoorToWorld({ x: playerX, z: playerZ })
    draggingLook = false
    setBodyFlags(false)
    sendViewBlend(1)
    void host
      .resumeWorldAt({
        x: world.x,
        z: world.z,
        footY: portal.groundY - XXG_STAIRWELL.depth,
        yaw: normalizeAngleRad(playerYaw - FRAME_YAW),
        pitch: WALKER_LEVEL_PITCH - playerPitch,
      })
      .catch(() => false)
    machine.setActivePortalId(null)
    pendingExitPortalId = null
    playerFootY = 0
    activeShopId = null
    machine.transitionTo('idle')
    lastSwapMs = Math.max(0, Math.round((nowFn() - swapStart) * 100) / 100)
    lastBlackFrames = 0
  }

  async function enter(portalId: XxgPortalId): Promise<boolean> {
    if (!isValidPortalId(portalId) || !hostCtx || !greyboxHandle) return false
    if (!machine.transitionTo('entering')) return false

    const exitSpec = layout.exits.find(e => e.portalId === portalId)
    if (!exitSpec) {
      machine.transitionTo('idle')
      return false
    }

    const veilHandle = hostCtx.openVeil('小香港商业城')
    try {
      await sleepMs(veilFadeInMs)
      if (machine.getState() !== 'entering') {
        void veilHandle.done()
        return false
      }

      swapStartedAt = nowFn()
      machine.setActivePortalId(portalId)
      pendingExitPortalId = portalId
      setBodyFlags(true)
      hostCtx.suspendWorld()

      resetDoors()
      const settled = resolveIndoorMovement(collisionWorld, layout, exitSpec.foot.x, exitSpec.foot.z, 0, 0, doorObstacles)
      playerX = settled.x
      playerZ = settled.z
      playerFootY = settled.y
      activeShopId = settled.activeShopId
      eyeOffset = 0
      settleEye(0)
      playerYaw = exitSpec.yaw
      playerPitch = 0
      pressedKeys.clear()
      draggingLook = false
      crowd?.reset({ x: exitSpec.foot.x, z: exitSpec.foot.z, yaw: exitSpec.yaw })

      syncIndoorCamera()
      if (!machine.transitionTo('inside')) {
        setBodyFlags(false)
        swapStartedAt = null
        void veilHandle.done()
        return false
      }

      renderFrame()
      lastBlackFrames = 0

      await veilHandle.done()
      return true
    } catch {
      if (machine.getState() === 'entering') {
        setBodyFlags(false)
        machine.setActivePortalId(null)
        machine.transitionTo('idle')
      }
      swapStartedAt = null
      await veilHandle.done().catch(() => {})
      return false
    }
  }

  async function exit(): Promise<boolean> {
    if (!hostCtx) return false
    if (!machine.transitionTo('exiting')) return false

    const targetPortalId: XxgPortalId = pendingExitPortalId ?? machine.getActivePortalId() ?? 'E1'
    const portalDef = getPortal(targetPortalId)
    draggingLook = false

    const veilHandle = hostCtx.openVeil(portalDef.label)
    try {
      await sleepMs(veilFadeInMs)
      if (machine.getState() !== 'exiting') {
        void veilHandle.done()
        return false
      }

      const swapStart = nowFn()
      const landing = portalLanding(portalDef)
      setBodyFlags(false)
      pressedKeys.clear()
      sendViewBlend(null)
      await hostCtx.resumeWorldAt(landing)

      if (machine.getState() !== 'exiting') {
        void veilHandle.done()
        return false
      }

      machine.setActivePortalId(null)
      pendingExitPortalId = null
      playerFootY = 0
      activeShopId = null
      lastSwapMs = Math.max(0, Math.round((nowFn() - swapStart) * 100) / 100)
      lastBlackFrames = 0

      machine.transitionTo('idle')
      await veilHandle.done()
      return true
    } catch {
      if (machine.getState() === 'exiting') {
        setBodyFlags(false)
        machine.transitionTo('idle')
      }
      await veilHandle.done().catch(() => {})
      return false
    }
  }

  function stepSurface(): void {
    const walker = hostCtx?.getWalker() ?? null
    const hit = walker ? locateSurfaceWell(walker.position) : null
    if (!walker || !hit) {
      sendViewBlend(null)
      return
    }
    const w = XXG_STAIRWELL
    const depth = hit.portal.groundY - walker.position.y
    sendViewBlend(stairwellViewBlend(depth))
    if (hit.lz <= w.enterZ && Math.abs(hit.lx) <= w.halfWidth && depth >= w.depth - 0.6) {
      enterFromStairs(hit.portal.id, walker)
    }
  }

  function step(dtSeconds: number): void {
    const st = machine.getState()
    if (st === 'disposed' || st === 'unmounted' || !hostCtx) return
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(dtSeconds) ? dtSeconds : 0))

    if (st === 'idle') {
      stepSurface()
      return
    }
    if (st !== 'inside') return

    let turnInput = 0
    if (pressedKeys.has('KeyQ')) turnInput += 1
    if (turnInput !== 0 && dt > 0) {
      playerYaw = normalizeAngleRad(playerYaw + turnInput * KEY_TURN_RAD_PER_SEC * dt)
    }
    let pitchInput = 0
    if (pressedKeys.has('PageUp')) pitchInput += 1
    if (pressedKeys.has('PageDown')) pitchInput -= 1
    if (pitchInput !== 0 && dt > 0) {
      playerPitch = clampIndoorPitch(collisionWorld, playerPitch + pitchInput * 1.45 * dt)
    }

    let forwardInput = 0
    let rightInput = 0
    if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) forwardInput += 1
    if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) forwardInput -= 1
    if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) rightInput += 1
    if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) rightInput -= 1

    if ((forwardInput !== 0 || rightInput !== 0) && dt > 0) {
      let wishX = rightInput * Math.cos(playerYaw) - forwardInput * Math.sin(playerYaw)
      let wishZ = -forwardInput * Math.cos(playerYaw) - rightInput * Math.sin(playerYaw)
      const len = Math.hypot(wishX, wishZ)
      if (len > 1e-6) {
        wishX /= len
        wishZ /= len
      }
      const running = pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight')
      // Running keeps the street pace on the landing so the swap does not brake the walker.
      const speed = running
        ? XXG_PLAYER.runSpeed + (XXG_PLAYER.streetRunSpeed - XXG_PLAYER.runSpeed) * landingMatch()
        : XXG_PLAYER.walkSpeed

      const moveRes = resolveIndoorMovement(
        collisionWorld,
        layout,
        playerX,
        playerZ,
        wishX * speed * dt,
        wishZ * speed * dt,
        doorObstacles,
      )
      playerX = moveRes.x
      playerZ = moveRes.z
      playerFootY = moveRes.y
      activeShopId = moveRes.activeShopId
      if (moveRes.hitWall) collisionContacts++
    }

    stepDoors(dt)
    settleEye(dt)
    crowd?.step(dt, { x: playerX, z: playerZ, yaw: playerYaw })
    syncIndoorCamera()

    const w = XXG_STAIRWELL
    const pose = locateInWell(playerX, playerZ, wells)
    if (pose && pose.lz >= w.exitZ && Math.abs(pose.lx) <= w.halfWidth) exitToStairs(pose.well)
  }

  function getMetrics(): XxgIndoorMetrics {
    return {
      drawCalls: lastDrawCalls,
      triangles: (greyboxHandle?.triangleCount ?? 0) + (crowd?.getMetrics().triangles ?? 0),
      textureBytes: greyboxHandle?.textureBytes ?? 0,
      lastSwapMs,
      lastBlackFrames,
    }
  }

  function getPlayerSnapshot(): XxgPlayerSnapshot {
    return {
      x: Math.round(playerX * 1000) / 1000,
      y: Math.round(playerFootY * 1000) / 1000,
      z: Math.round(playerZ * 1000) / 1000,
      eyeY: playerEyeY,
      yaw: Math.round(playerYaw * 10000) / 10000,
      pitch: Math.round(playerPitch * 10000) / 10000,
      fovDeg: Math.round(camera.fov * 1000) / 1000,
      ceilingClearanceM,
      activePortalId: machine.getActivePortalId(),
      activeShopId,
      collisionContacts,
      doorsOpen: doorProgress.map(p => Math.round(doorOpenFraction(p) * 1000) / 1000),
    }
  }

  function dispose(): void {
    if (machine.getState() === 'disposed') return
    sendViewBlend(null)
    machine.dispose()
    playerFootY = 0
    setBodyFlags(false)
    unmountDomAndListeners()
    if (crowd) {
      crowd.dispose()
      crowd = null
    }
    if (greyboxHandle) {
      scene.remove(greyboxHandle.scene)
      greyboxHandle.dispose()
      greyboxHandle = null
    }
    scene.clear()
    hostCtx = null
    pendingExitPortalId = null
    activeShopId = null
    lastDrawCalls = 0
    swapStartedAt = null
  }

  return {
    get state(): XxgState {
      return machine.getState()
    },
    scene,
    camera,
    mount,
    enter,
    exit,
    step,
    getMetrics,
    dispose,
    renderFrame,
    getPlayerSnapshot,
    getLayout: () => layout,
    getCrowdMetrics: () => crowd?.getMetrics() ?? null,
  }
}
