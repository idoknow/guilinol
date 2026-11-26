import * as THREE from 'three'
import {
  XXG_PLAYER,
  XXG_PORTALS,
  XXG_PORTAL_IDS,
  XXG_TIMING,
  getPortal,
  portalLanding,
  validateXxgLayout,
  type XxgExit,
  type XxgHostContext,
  type XxgIndoorMetrics,
  type XxgPortalId,
  type XxgState,
} from '../contract.ts'
import {
  buildIndoorCollisionWorld,
  clampIndoorPitch,
  findTriggeredExit,
  resolveIndoorMovement,
} from './collision.ts'
import { createIndoorGreyboxScene, type IndoorGreyboxSceneHandle } from './indoor-scene.ts'
import { createXxgRuntimeStateMachine } from './state-machine.ts'
import {
  STAGE1_GREYBOX_LAYOUT,
  normalizeAngleRad,
  type CreateXxgIndoorSceneOptions,
  type XxgExtendedIndoorScene,
  type XxgPlayerSnapshot,
} from './types.ts'

const LOOK_SENSITIVITY_RAD_PER_PX = 0.0026
const KEY_TURN_RAD_PER_SEC = 1.85
const INDOOR_CAMERA_NEAR = 0.08
const INDOOR_CAMERA_FAR = 140

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

function isValidPortalId(id: unknown): id is XxgPortalId {
  return typeof id === 'string' && (XXG_PORTAL_IDS as readonly string[]).includes(id)
}

/**
 * Implements contract.ts XxgIndoorScene strictly:
 * - Standalone THREE.Scene + standalone first-person PerspectiveCamera (never mutating worldCamera or walk/view-mode)
 * - Full state machine ('unmounted' | 'idle' | 'entering' | 'inside' | 'exiting' | 'disposed')
 * - Zero residue across repeated enter/exit cycles, zero leaks on dispose()
 */
export function createXxgIndoorScene(opts: CreateXxgIndoorSceneOptions = {}): XxgExtendedIndoorScene {
  const layout = opts.layout ?? STAGE1_GREYBOX_LAYOUT
  const layoutErrors = validateXxgLayout(layout)
  if (layoutErrors.length > 0) {
    throw new Error(`Invalid XxgLayout passed to createXxgIndoorScene: ${layoutErrors.join('; ')}`)
  }

  const nowFn = opts.now ?? (() => performance.now())
  const veilFadeInMs = Math.max(0, opts.veilFadeInMs ?? XXG_TIMING.veilFadeInMs)
  const reenterCooldownMs = Math.max(0, opts.reenterCooldownMs ?? XXG_TIMING.reenterCooldownMs)

  const collisionWorld = buildIndoorCollisionWorld(layout, XXG_PLAYER.radius, XXG_PLAYER.eyeHeight)
  const machine = createXxgRuntimeStateMachine(XXG_PORTALS, reenterCooldownMs)

  const scene = new THREE.Scene()
  scene.name = 'xxg-indoor-root'
  scene.background = new THREE.Color('#c8d2d8')

  const camera = new THREE.PerspectiveCamera(XXG_PLAYER.fovDeg, 16 / 9, INDOOR_CAMERA_NEAR, INDOOR_CAMERA_FAR)
  camera.rotation.order = 'YXZ'

  let hostCtx: XxgHostContext | null = null
  let greyboxHandle: IndoorGreyboxSceneHandle | null = null
  let pendingExitPortalId: XxgPortalId | null = null

  // Indoor first-person kinematic state
  let playerX = layout.exits[0]?.foot.x ?? 0
  let playerZ = layout.exits[0]?.foot.z ?? 0
  let playerEyeY: number = XXG_PLAYER.eyeHeight
  let playerYaw = layout.exits[0]?.yaw ?? 0
  let playerPitch = 0
  let ceilingClearanceM = layout.ceilingHeight - XXG_PLAYER.eyeHeight
  let activeShopId: string | null = null
  let collisionContacts = 0
  let indoorEnteredAtMs = 0

  // Contract metrics (XxgIndoorMetrics)
  let lastDrawCalls = 0
  let lastSwapMs = 0
  let lastBlackFrames = 0

  // Input & single-container DOM (0 extra body children across enter/exit cycles)
  const pressedKeys = new Set<string>()
  let draggingLook = false
  let lastPointerX = 0
  let lastPointerY = 0
  let styleLinkEl: HTMLLinkElement | null = null
  let rootEl: HTMLDivElement | null = null
  let promptBtn: HTMLButtonElement | null = null

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

  function nearestExit(x: number, z: number): { exit: XxgExit; dist: number } | null {
    let best: XxgExit | null = null
    let bestDist = Infinity
    for (const ex of layout.exits) {
      const d = Math.hypot(x - ex.foot.x, z - ex.foot.z)
      if (d < bestDist) {
        bestDist = d
        best = ex
      }
    }
    return best ? { exit: best, dist: bestDist } : null
  }

  function syncPromptDom(): void {
    if (!promptBtn) return
    const st = machine.getState()
    if (st === 'disposed' || st === 'unmounted' || st === 'entering' || st === 'exiting' || isOverlayBlockingHud()) {
      promptBtn.hidden = true
      return
    }
    if (st === 'idle') {
      const nearId = machine.getNearbyPortalId()
      if (!nearId) {
        promptBtn.hidden = true
        return
      }
      const p = getPortal(nearId)
      promptBtn.dataset.xxgAction = 'enter'
      promptBtn.dataset.portalId = p.id
      promptBtn.textContent = '[E] 进入'
      promptBtn.setAttribute('aria-label', `进入${p.label}`)
      promptBtn.hidden = false
      return
    }
    if (st === 'inside') {
      const near = nearestExit(playerX, playerZ)
      if (near && near.dist <= 4.0) {
        promptBtn.dataset.xxgAction = 'exit'
        promptBtn.dataset.portalId = near.exit.portalId
        promptBtn.textContent = '[E] 离开'
        promptBtn.setAttribute('aria-label', `离开至${getPortal(near.exit.portalId).label}`)
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
    if ((st !== 'inside' && st !== 'exiting') || !greyboxHandle) return false
    syncIndoorCamera()
    if (hostCtx?.renderer) {
      hostCtx.renderer.info.reset()
      hostCtx.renderer.render(scene, camera)
      lastDrawCalls = hostCtx.renderer.info.render.calls
    } else {
      lastDrawCalls = greyboxHandle.meshCount
    }
    return true
  }

  function onKeyDown(e: KeyboardEvent): void {
    const st = machine.getState()
    if (st === 'disposed' || st === 'unmounted') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (isEditableTarget(e.target) || isOverlayBlockingHud()) return

    pressedKeys.add(e.code)

    if (!e.repeat && e.code === 'KeyE') {
      if (st === 'idle' && machine.getNearbyPortalId()) {
        e.preventDefault()
        void enter(machine.getNearbyPortalId()!)
      } else if (st === 'inside') {
        const near = nearestExit(playerX, playerZ)
        if (near && near.dist <= 4.0) {
          e.preventDefault()
          pendingExitPortalId = near.exit.portalId
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

    rootEl = document.createElement('div')
    rootEl.className = 'xxg-root'
    rootEl.dataset.xxgRoot = '1'

    promptBtn = document.createElement('button')
    promptBtn.type = 'button'
    promptBtn.className = 'xxg-prompt'
    promptBtn.hidden = true
    promptBtn.addEventListener('click', () => {
      const action = promptBtn?.dataset.xxgAction
      const pid = promptBtn?.dataset.portalId
      if (action === 'enter' && isValidPortalId(pid)) {
        void enter(pid)
      } else if (action === 'exit') {
        if (isValidPortalId(pid)) pendingExitPortalId = pid
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

  async function mount(ctx: XxgHostContext): Promise<void> {
    if (machine.getState() === 'disposed') return
    if (machine.getState() !== 'unmounted') return
    hostCtx = ctx
    greyboxHandle = createIndoorGreyboxScene(layout)
    scene.background = greyboxHandle.scene.background
    scene.fog = greyboxHandle.scene.fog
    scene.add(greyboxHandle.scene)
    mountDomAndListeners()
    machine.transitionTo('idle')
  }

  async function enter(portalId: XxgPortalId): Promise<boolean> {
    if (!isValidPortalId(portalId) || !hostCtx || !greyboxHandle) return false
    if (!machine.transitionTo('entering')) return false

    const exitSpec = layout.exits.find(e => e.portalId === portalId)
    if (!exitSpec) {
      machine.transitionTo('idle')
      return false
    }

    syncPromptDom()
    const veilHandle = hostCtx.openVeil('小香港商业城')
    try {
      await sleepMs(veilFadeInMs)
      if (machine.getState() !== 'entering') {
        void veilHandle.done()
        return false
      }

      const swapStart = nowFn()
      machine.setActivePortalId(portalId)
      pendingExitPortalId = portalId
      setBodyFlags(true)
      hostCtx.suspendWorld()

      const settled = resolveIndoorMovement(collisionWorld, layout, exitSpec.foot.x, exitSpec.foot.z, 0, 0)
      playerX = settled.x
      playerZ = settled.z
      playerEyeY = settled.eyeY
      ceilingClearanceM = settled.ceilingClearanceM
      activeShopId = settled.activeShopId
      playerYaw = exitSpec.yaw
      playerPitch = 0
      pressedKeys.clear()

      syncIndoorCamera()
      if (!machine.transitionTo('inside')) {
        setBodyFlags(false)
        void veilHandle.done()
        return false
      }
      indoorEnteredAtMs = nowFn()

      renderFrame()
      lastSwapMs = Math.max(0, Math.round((nowFn() - swapStart) * 100) / 100)
      lastBlackFrames = 0
      syncPromptDom()

      await veilHandle.done()
      return true
    } catch {
      if (machine.getState() === 'entering') {
        setBodyFlags(false)
        machine.setActivePortalId(null)
        machine.transitionTo('idle')
      }
      await veilHandle.done().catch(() => {})
      return false
    }
  }

  async function exit(): Promise<boolean> {
    if (!hostCtx) return false
    if (!machine.transitionTo('exiting')) return false

    const targetPortalId: XxgPortalId = pendingExitPortalId ?? machine.getActivePortalId() ?? 'E1'
    const portalDef = getPortal(targetPortalId)
    syncPromptDom()

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
      await hostCtx.resumeWorldAt(landing)

      if (machine.getState() !== 'exiting') {
        void veilHandle.done()
        return false
      }

      machine.markPortalExitCooldown(targetPortalId, nowFn(), reenterCooldownMs)
      machine.setActivePortalId(null)
      pendingExitPortalId = null
      activeShopId = null
      lastSwapMs = Math.max(0, Math.round((nowFn() - swapStart) * 100) / 100)
      lastBlackFrames = 0

      machine.transitionTo('idle')
      syncPromptDom()
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

  function step(dtSeconds: number): void {
    const st = machine.getState()
    if (st === 'disposed' || st === 'unmounted' || !hostCtx) return
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(dtSeconds) ? dtSeconds : 0))
    const nowMs = nowFn()

    if (st === 'idle') {
      const walker = hostCtx.getWalker()
      if (walker) {
        const res = machine.detectSurfaceEntry(walker.position, walker.velocity, nowMs)
        syncPromptDom()
        if (res.triggeredPortal) {
          void enter(res.triggeredPortal.id)
        }
      } else {
        syncPromptDom()
      }
      return
    }

    if (st === 'inside') {
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

      let vx = 0
      let vz = 0
      if ((forwardInput !== 0 || rightInput !== 0) && dt > 0) {
        let wishX = rightInput * Math.cos(playerYaw) - forwardInput * Math.sin(playerYaw)
        let wishZ = -forwardInput * Math.cos(playerYaw) - rightInput * Math.sin(playerYaw)
        const len = Math.hypot(wishX, wishZ)
        if (len > 1e-6) {
          wishX /= len
          wishZ /= len
        }
        const speed =
          pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight')
            ? XXG_PLAYER.runSpeed
            : XXG_PLAYER.walkSpeed
        vx = wishX * speed
        vz = wishZ * speed

        const moveRes = resolveIndoorMovement(collisionWorld, layout, playerX, playerZ, vx * dt, vz * dt)
        playerX = moveRes.x
        playerZ = moveRes.z
        playerEyeY = moveRes.eyeY
        ceilingClearanceM = moveRes.ceilingClearanceM
        activeShopId = moveRes.activeShopId
        if (moveRes.hitWall) collisionContacts++
      } else {
        syncIndoorCamera()
      }

      syncIndoorCamera()
      syncPromptDom()

      if (nowMs - indoorEnteredAtMs >= 200 && (vx !== 0 || vz !== 0)) {
        const triggeredExit = findTriggeredExit(layout, playerX, playerZ, vx, vz, XXG_PLAYER.exitTriggerRadius)
        if (triggeredExit) {
          pendingExitPortalId = triggeredExit.portalId
          void exit()
        }
      }
    }
  }

  function getMetrics(): XxgIndoorMetrics {
    return {
      drawCalls: lastDrawCalls,
      triangles: greyboxHandle?.triangleCount ?? 0,
      textureBytes: greyboxHandle?.textureBytes ?? 0,
      lastSwapMs,
      lastBlackFrames,
    }
  }

  function getPlayerSnapshot(): XxgPlayerSnapshot {
    return {
      x: Math.round(playerX * 1000) / 1000,
      y: 0,
      z: Math.round(playerZ * 1000) / 1000,
      eyeY: playerEyeY,
      yaw: Math.round(playerYaw * 10000) / 10000,
      pitch: Math.round(playerPitch * 10000) / 10000,
      ceilingClearanceM,
      activePortalId: machine.getActivePortalId(),
      activeShopId,
      collisionContacts,
    }
  }

  function dispose(): void {
    if (machine.getState() === 'disposed') return
    machine.dispose()
    setBodyFlags(false)
    unmountDomAndListeners()
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
  }
}
