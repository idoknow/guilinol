import * as THREE from 'three'
import type { Walker } from '../../play/host.ts'
import type { AvatarRig } from '../../walk/avatar-rig.ts'
import { isGlobalHotkeyBlocked, isModalOrOverlayOpen } from '../../walk/input-guard.ts'
import {
  createDrinksAudio,
  createDrinksBgmController,
  type DrinksAudioController,
  type DrinksBgmController,
} from '../audio/index.ts'
import type { DrinksSim } from '../sim/types.ts'
import { worldToShopLocal, type DrinksSiteCandidate } from '../site.ts'
import { resolveDrinksStaffAnchors, type DrinksStaffAnchors, type ShopWorkZonesInput } from './anchors.ts'
import { mountDrinksStaffHud, type DrinksStaffHudController } from './staff-hud.ts'
import { createDrinksStaffVisualStage, type DrinksStaffVisualStage } from './station-rigs.ts'
import { createStaffUniformController, type StaffUniformController, type StaffUniformPalette } from './uniform.ts'
import { DrinksStaffSession, type DrinksStaffStateSnapshot } from './workflow.ts'

if (typeof document !== 'undefined' && typeof window !== 'undefined' && 'CSS' in globalThis) {
  void import('./staff-hud.css')
}

export interface DrinksStaffWalkerLike extends Walker {
  readonly vehicle?: string
  readonly figure?: THREE.Object3D
}

export interface CreateDrinksStaffControllerOptions {
  scene: THREE.Scene
  sim?: Pick<DrinksSim, 'getSnapshot' | 'getMenu' | 'getLayout'>
  site?: Pick<DrinksSiteCandidate, 'worldX' | 'worldZ' | 'worldYaw'>
  worldOrigin?: readonly [number, number, number]
  worldYaw?: number
  shopAnchors?: ShopWorkZonesInput | null
  anchors?: DrinksStaffAnchors
  audio?: DrinksAudioController
  bgm?: DrinksBgmController
  container?: HTMLElement | null
  uniformPalette?: Partial<StaffUniformPalette>
  hotkeyCode?: string
  hotkeyLabel?: string
}

export interface DrinksStaffController {
  readonly group: THREE.Group
  readonly session: DrinksStaffSession
  readonly uniform: StaffUniformController
  readonly stage: DrinksStaffVisualStage
  readonly audio: DrinksAudioController
  readonly bgm: DrinksBgmController
  readonly hud: DrinksStaffHudController | null
  bindWalker(walker: DrinksStaffWalkerLike | null | undefined, figure?: THREE.Object3D | null): void
  setPlayerWorldPos(wx: number, wz: number, wyaw?: number): void
  setPlayerLocalPos(lx: number, lz: number, lyaw?: number): void
  handleKeyDown(code: string, target?: EventTarget | null): boolean
  applyForJob(opts?: { force?: boolean }): boolean
  resignJob(): boolean
  performAction(opts?: { forceRecruit?: boolean }): boolean
  setHoldingAction(holding: boolean): void
  step(dtSec: number): void
  getSnapshot(): DrinksStaffStateSnapshot
  dispose(): void
}

/**
 * 蜜雪冰城员工玩法总控：
 * 组装「门口招聘立牌 -> 应聘穿自建员工服 -> 进店接单/加料/封口/叫号全套动作 + BGM/音效 -> 下班脱装」，
 * 可脱离宿主 `drinks/index.ts` 独立挂接于 `scene` 或由整合层一元调用。
 */
export function createDrinksStaffController(opts: CreateDrinksStaffControllerOptions): DrinksStaffController {
  const origin: readonly [number, number, number] = opts.site
    ? [opts.site.worldX, 0, opts.site.worldZ]
    : (opts.worldOrigin ?? [0, 0, 0])
  const worldYaw = opts.site ? opts.site.worldYaw : (opts.worldYaw ?? 0)

  const anchors =
    opts.anchors ??
    resolveDrinksStaffAnchors({
      shopAnchors: opts.shopAnchors,
      layout: opts.sim?.getLayout(),
    })

  const session = new DrinksStaffSession({
    anchors,
    sim: opts.sim,
  })
  const uniform = createStaffUniformController(opts.uniformPalette)
  const stage = createDrinksStaffVisualStage(anchors)

  const ownsAudio = !opts.audio
  const audio = opts.audio ?? createDrinksAudio()
  const ownsBgm = !opts.bgm
  const bgm = opts.bgm ?? createDrinksBgmController()

  const group = new THREE.Group()
  group.name = 'drinks-staff-root'
  group.position.set(origin[0], origin[1], origin[2])
  group.rotation.y = worldYaw
  group.add(stage.group)
  opts.scene.add(group)

  let boundFigure: THREE.Object3D | null = null
  let holdingAction = false
  let disposed = false
  const hotkeyCode = opts.hotkeyCode ?? 'KeyE'

  function syncUniformWithDuty(): void {
    const snap = session.getSnapshot()
    if (snap.uniformEquipped && boundFigure) {
      const rig = boundFigure.userData?.avatarRig as AvatarRig | undefined
      uniform.equip(boundFigure, rig)
    } else if (!snap.uniformEquipped && uniform.isEquipped()) {
      uniform.unequip()
    }
  }

  function flushAudioAndBgm(): void {
    const sounds = session.drainSounds()
    for (const s of sounds) audio.play(s)
    const snap = session.getSnapshot()
    if (snap.onDuty && !bgm.isPlaying()) {
      bgm.start()
    } else if (!snap.onDuty && bgm.isPlaying()) {
      bgm.stop()
    }
  }

  let hud: DrinksStaffHudController | null = null
  const hasDom = typeof document !== 'undefined' && opts.container !== null
  if (hasDom) {
    hud = mountDrinksStaffHud({
      session,
      container: opts.container ?? document.body,
      hotkeyLabel: opts.hotkeyLabel ?? 'E',
      bgmMuted: () => bgm.isMuted(),
      onPrimaryAction: () => {
        audio.unlock()
        if (session.performPrimaryAction()) {
          syncUniformWithDuty()
          flushAudioAndBgm()
          hud?.sync()
        }
      },
      onHoldStep: holding => {
        holdingAction = holding
        if (holding) audio.unlock()
      },
      onToggleBgm: () => {
        bgm.setMuted(!bgm.isMuted())
        return bgm.isMuted()
      },
      onResign: () => {
        if (session.resignJob()) {
          syncUniformWithDuty()
          flushAudioAndBgm()
          hud?.sync()
        }
      },
    })
  }

  function bindWalker(_walker: DrinksStaffWalkerLike | null | undefined, figure?: THREE.Object3D | null): void {
    boundFigure = figure ?? _walker?.figure ?? null
    syncUniformWithDuty()
  }

  function setPlayerLocalPos(lx: number, lz: number, lyaw = 0): void {
    session.updatePlayerLocalPos(lx, lz, lyaw)
    const distShop = Math.hypot(lx, lz)
    bgm.setDistance(distShop)
  }

  function setPlayerWorldPos(wx: number, wz: number, wyaw = 0): void {
    const local = worldToShopLocal(
      { worldX: origin[0], worldZ: origin[2], worldYaw },
      wx,
      wz,
    )
    setPlayerLocalPos(local.x, local.z, wyaw - worldYaw)
  }

  function applyForJob(applyOpts?: { force?: boolean }): boolean {
    if (disposed) return false
    audio.unlock()
    const ok = session.applyForJob(applyOpts)
    if (ok) {
      syncUniformWithDuty()
      flushAudioAndBgm()
      hud?.sync()
    }
    return ok
  }

  function resignJob(): boolean {
    if (disposed) return false
    const ok = session.resignJob()
    if (ok) {
      holdingAction = false
      syncUniformWithDuty()
      flushAudioAndBgm()
      hud?.sync()
    }
    return ok
  }

  function performAction(actOpts?: { forceRecruit?: boolean }): boolean {
    if (disposed) return false
    audio.unlock()
    const ok = session.performPrimaryAction(actOpts)
    if (ok) {
      syncUniformWithDuty()
      flushAudioAndBgm()
      hud?.sync()
    }
    return ok
  }

  function handleKeyDown(code: string, target?: EventTarget | null): boolean {
    if (disposed || code !== hotkeyCode) return false
    if (typeof document !== 'undefined') {
      if (isGlobalHotkeyBlocked(target ?? null) || isModalOrOverlayOpen()) return false
    }
    const snap = session.getSnapshot()
    if (!snap.onDuty && !snap.nearRecruit) return false
    return performAction()
  }

  function step(dtSec: number): void {
    if (disposed) return
    const dt = Math.max(0, Math.min(0.25, Number.isFinite(dtSec) ? dtSec : 0))
    if (holdingAction) {
      session.holdWork(dt)
    }
    session.step(dt)
    flushAudioAndBgm()
    bgm.step(dt)
    const snap = session.getSnapshot()
    stage.sync(snap, dt)
  }

  stage.sync(session.getSnapshot(), 0)

  return {
    group,
    session,
    uniform,
    stage,
    audio,
    bgm,
    hud,
    bindWalker,
    setPlayerWorldPos,
    setPlayerLocalPos,
    handleKeyDown,
    applyForJob,
    resignJob,
    performAction,
    setHoldingAction(holding: boolean) {
      holdingAction = Boolean(holding)
    },
    step,
    getSnapshot: () => session.getSnapshot(),
    dispose() {
      if (disposed) return
      disposed = true
      holdingAction = false
      hud?.dispose()
      uniform.dispose()
      stage.dispose()
      if (ownsBgm) bgm.dispose()
      if (ownsAudio) audio.dispose()
      group.removeFromParent()
    },
  }
}
