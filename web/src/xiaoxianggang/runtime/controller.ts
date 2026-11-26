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
  resolveIndoorMovement,
} from './collision.ts'
import {
  XXG_STAIR_MAX_DELTA_Y,
  createXxgStairEyeSmoother,
  descentPath,
  sampleAllExitStairsFootY,
  shouldClimbOut,
  type XxgStairDescent,
} from './exit-stairs.ts'
import { XIAOXIANGGANG_B1_LAYOUT } from '../layout/index.ts'
import { createIndoorGreyboxScene, type IndoorGreyboxSceneHandle } from './indoor-scene.ts'
import { XXG_CROWD_MAX, createXxgCrowd, type XxgCrowd } from './crowd.ts'
import { createXxgRuntimeStateMachine } from './state-machine.ts'
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
  const layout = opts.layout ?? XIAOXIANGGANG_B1_LAYOUT
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
  let playerEyeY: number = XXG_PLAYER.eyeHeight
  let playerYaw = layout.exits[0]?.yaw ?? 0
  let playerPitch = 0
  let ceilingClearanceM = layout.ceilingHeight - XXG_PLAYER.eyeHeight
  let activeShopId: string | null = null
  let collisionContacts = 0
  /** 进场后在 inside 状态内部执行的脚本下楼控制器；非空期间锁输入与视角。 */
  let activeDescent: XxgStairDescent | null = null
  const eyeSmoother = createXxgStairEyeSmoother({
    eyeOffset: XXG_PLAYER.eyeHeight,
    maxDeltaYPerFrame: XXG_STAIR_MAX_DELTA_Y,
  })

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

  /** 返回当前允许 [E] 离开的出口（站在楼梯上或 foot 4m 内）。 */
  function findInteractiveExit(x: number, z: number): XxgExit | null {
    const onStair = sampleAllExitStairsFootY(collisionWorld.exitStairs, x, z)
    if (onStair) {
      return layout.exits.find(e => e.portalId === onStair.stair.portalId) ?? null
    }
    const near = nearestExit(x, z)
    return near && near.dist <= 4.0 ? near.exit : null
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
      if (activeDescent !== null) {
        promptBtn.hidden = true
        return
      }
      const targetExit = findInteractiveExit(playerX, playerZ)
      if (targetExit) {
        promptBtn.dataset.xxgAction = 'exit'
        promptBtn.dataset.portalId = targetExit.portalId
        promptBtn.textContent = '[E] 离开'
        promptBtn.setAttribute('aria-label', `离开至${getPortal(targetExit.portalId).label}`)
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
      lastDrawCalls = greyboxHandle.meshCount + (crowd?.getMetrics().drawCalls ?? 0)
    }
    return true
  }

  function onKeyDown(e: KeyboardEvent): void {
    const st = machine.getState()
    if (st === 'disposed' || st === 'unmounted') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (isEditableTarget(e.target) || isOverlayBlockingHud()) return

    // 脚本下楼期间锁所有移动与交互输入
    if (st === 'inside' && activeDescent !== null) return

    pressedKeys.add(e.code)

    if (!e.repeat && e.code === 'KeyE') {
      if (st === 'idle' && machine.getNearbyPortalId()) {
        e.preventDefault()
        void enter(machine.getNearbyPortalId()!)
      } else if (st === 'inside') {
        const targetExit = findInteractiveExit(playerX, playerZ)
        if (targetExit) {
          e.preventDefault()
          pendingExitPortalId = targetExit.portalId
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
    if (machine.getState() !== 'inside' || activeDescent !== null) return
    if (e.button !== 0) return
    if (promptBtn && e.target instanceof Node && promptBtn.contains(e.target)) return
    draggingLook = true
    lastPointerX = e.clientX
    lastPointerY = e.clientY
    e.stopPropagation?.()
  }

  function onPointerMove(e: PointerEvent): void {
    if (machine.getState() !== 'inside' || activeDescent !== null) return
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
        if (activeDescent !== null) return
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
    if (crowdMaxAgents > 0) {
      crowd = createXxgCrowd({
        layout,
        maxAgents: crowdMaxAgents,
        seed: opts.crowdSeed,
        columns: greyboxHandle.columnCenters,
      })
      scene.add(crowd.group)
    }
    mountDomAndListeners()
    machine.transitionTo('idle')
    await prewarmGpu(ctx.renderer)
  }

  /** 挂载时（入口懒加载、还在地面上）就编译着色器、上传纹理，转场里只剩一帧渲染。 */
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

      const exitStair = collisionWorld.exitStairs.find(s => s.portalId === portalId)
      if (!exitStair) {
        setBodyFlags(false)
        machine.setActivePortalId(null)
        machine.transitionTo('idle')
        void veilHandle.done()
        return false
      }

      // 首帧相机直接放在楼梯顶部下楼脚本起点（离玻璃门 0.45m、俯角 -18°）
      activeDescent = descentPath(exitStair, exitSpec)
      const startFrame = activeDescent.start
      playerX = startFrame.x
      playerZ = startFrame.z
      playerFootY = startFrame.footY
      playerEyeY = eyeSmoother.reset(playerFootY)
      ceilingClearanceM = Math.round((layout.ceilingHeight - playerEyeY) * 1000) / 1000
      activeShopId = null
      playerYaw = startFrame.yaw
      playerPitch = startFrame.pitch
      pressedKeys.clear()
      draggingLook = false
      // 人群预置避让以楼梯底落脚点为中心，避免行人挡在下楼口
      crowd?.reset({ x: exitSpec.foot.x, z: exitSpec.foot.z, yaw: exitSpec.yaw })

      syncIndoorCamera()
      if (!machine.transitionTo('inside')) {
        activeDescent = null
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
    activeDescent = null
    draggingLook = false
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
      activeDescent = null
      playerFootY = 0
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
      // 脚本自动下楼阶段：忽略全部玩家输入，视线高度平滑且每帧 Δy ≤ 0.08m
      if (activeDescent !== null) {
        const frame = activeDescent.step(dt)
        playerX = frame.x
        playerZ = frame.z
        playerFootY = frame.footY
        playerEyeY = eyeSmoother.step(playerFootY, dt)
        playerYaw = frame.yaw
        playerPitch = frame.pitch
        ceilingClearanceM = Math.round((layout.ceilingHeight - playerEyeY) * 1000) / 1000
        activeShopId = null

        if (frame.done) {
          const settled = resolveIndoorMovement(collisionWorld, layout, playerX, playerZ, 0, 0)
          playerX = settled.x
          playerZ = settled.z
          playerFootY = settled.y
          activeShopId = settled.activeShopId
          activeDescent = null
          pressedKeys.clear()
          draggingLook = false
        }

        crowd?.step(dt, { x: playerX, z: playerZ, yaw: playerYaw })
        syncIndoorCamera()
        syncPromptDom()
        return
      }

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
        playerFootY = moveRes.y
        activeShopId = moveRes.activeShopId
        if (moveRes.hitWall) collisionContacts++
      }

      // 无论走上台阶还是回到平地，视线高度始终平滑过渡（每帧 Δy ≤ 0.08m）
      playerEyeY = eyeSmoother.step(playerFootY, dt)
      ceilingClearanceM = Math.round((layout.ceilingHeight - playerEyeY) * 1000) / 1000

      crowd?.step(dt, { x: playerX, z: playerZ, yaw: playerYaw })
      syncIndoorCamera()
      syncPromptDom()

      // 玩家自己走上任一出口楼梯上段并继续朝上行方向移动时触发离开
      if (vx !== 0 || vz !== 0) {
        const stairHit = sampleAllExitStairsFootY(collisionWorld.exitStairs, playerX, playerZ)
        if (stairHit && shouldClimbOut(stairHit.stair, playerX, playerZ, stairHit.footY, vx, vz)) {
          pendingExitPortalId = stairHit.stair.portalId
          void exit()
        }
      }
    }
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
      ceilingClearanceM,
      activePortalId: machine.getActivePortalId(),
      activeShopId,
      collisionContacts,
      descending: activeDescent !== null,
    }
  }

  function dispose(): void {
    if (machine.getState() === 'disposed') return
    machine.dispose()
    activeDescent = null
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
