import * as THREE from 'three'
import type { Walker } from '../../play/host.ts'
import type { DrinkCatalogItem, DrinkCustomization } from '../menu/menu.ts'
import { createDrinkCupModel, type DrinkCupVisual } from './cup-model.ts'

export type DrinkHoldState = 'idle' | 'holding' | 'drinking' | 'finishing'

export interface HeldDrinkSyncPayload {
  holding: boolean
  drinkId: string | null
  sipping: boolean
  sipsLeft: number
  fillRatio: number
}

export interface DrinkHoldSnapshot {
  readonly state: DrinkHoldState
  readonly active: boolean
  readonly paused: boolean
  readonly drink: DrinkCatalogItem | null
  readonly customization: DrinkCustomization | null
  readonly orderId: string | null
  readonly sipsTotal: number
  readonly sipsLeft: number
  readonly fillRatio: number
  readonly sipProgress: number
  readonly canSip: boolean
  readonly syncState: HeldDrinkSyncPayload
}

export interface DrinkSipResult {
  ok: boolean
  code: 'OK' | 'NO_DRINK' | 'SIP_IN_PROGRESS' | 'PAUSED'
  sipsLeft: number
  fillRatio: number
  finishedWhenDone: boolean
}

export const DRINK_SIP_DURATION_SEC = 1.2
export const DRINK_FINISH_FADE_SEC = 0.35

export const HOLD_AIM_REST = { forward: 0.25, up: 0.02, side: 0.13 } as const
export const HOLD_AIM_SIP = { forward: 0.21, up: 0.25, side: 0.02 } as const

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 纯状态机：驱动「手捧饮品 → 按一下喝一口 → 液位递减 → 喝完收回」全流程，
 * 无任何 Three.js / DOM 依赖，可直接跑在 `node --test`。
 */
export class DrinkHoldSession {
  private state: DrinkHoldState = 'idle'
  private drink: DrinkCatalogItem | null = null
  private customization: DrinkCustomization | null = null
  private orderId: string | null = null
  private sipsTotal = 0
  private sipsLeft = 0
  private fillRatio = 0
  private sipFromFill = 0
  private sipToFill = 0
  private sipElapsed = 0
  private finishElapsed = 0
  private paused = false
  private listeners = new Set<(snap: DrinkHoldSnapshot) => void>()

  getSnapshot(): DrinkHoldSnapshot {
    const active = this.state !== 'idle'
    const sipCurve =
      this.state === 'drinking' ? Math.sin(clamp01(this.sipElapsed / DRINK_SIP_DURATION_SEC) * Math.PI) : 0
    return {
      state: this.state,
      active,
      paused: this.paused,
      drink: this.drink,
      customization: this.customization,
      orderId: this.orderId,
      sipsTotal: this.sipsTotal,
      sipsLeft: this.sipsLeft,
      fillRatio: this.fillRatio,
      sipProgress: sipCurve,
      canSip: this.state === 'holding' && !this.paused && this.sipsLeft > 0,
      syncState: {
        holding: active,
        drinkId: this.drink?.id ?? null,
        sipping: this.state === 'drinking',
        sipsLeft: this.sipsLeft,
        fillRatio: +this.fillRatio.toFixed(3),
      },
    }
  }

  onChange(fn: (snap: DrinkHoldSnapshot) => void): () => void {
    this.listeners.add(fn)
    fn(this.getSnapshot())
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit(): void {
    const snap = this.getSnapshot()
    for (const fn of [...this.listeners]) fn(snap)
  }

  pickup(drink: DrinkCatalogItem, customization?: DrinkCustomization, orderId?: string): DrinkHoldSnapshot {
    this.state = 'holding'
    this.drink = drink
    this.customization = customization ?? {
      ice: drink.iceOptions[0] ?? '正常冰',
      sugar: drink.sugarOptions[0] ?? '全糖',
    }
    this.orderId = orderId ?? null
    this.sipsTotal = Math.max(1, drink.sipsCount)
    this.sipsLeft = this.sipsTotal
    this.fillRatio = 1
    this.sipFromFill = 1
    this.sipToFill = 1
    this.sipElapsed = 0
    this.finishElapsed = 0
    this.emit()
    return this.getSnapshot()
  }

  setPaused(paused: boolean): void {
    const next = Boolean(paused)
    if (next === this.paused) return
    this.paused = next
    this.emit()
  }

  sip(): DrinkSipResult {
    if (this.state === 'idle' || this.state === 'finishing' || !this.drink) {
      return { ok: false, code: 'NO_DRINK', sipsLeft: 0, fillRatio: 0, finishedWhenDone: false }
    }
    if (this.paused) {
      return {
        ok: false,
        code: 'PAUSED',
        sipsLeft: this.sipsLeft,
        fillRatio: this.fillRatio,
        finishedWhenDone: false,
      }
    }
    if (this.state === 'drinking') {
      return {
        ok: false,
        code: 'SIP_IN_PROGRESS',
        sipsLeft: this.sipsLeft,
        fillRatio: this.fillRatio,
        finishedWhenDone: false,
      }
    }

    this.sipFromFill = this.fillRatio
    this.sipsLeft = Math.max(0, this.sipsLeft - 1)
    this.sipToFill = this.sipsTotal > 0 ? this.sipsLeft / this.sipsTotal : 0
    this.sipElapsed = 0
    this.state = 'drinking'
    this.emit()

    return {
      ok: true,
      code: 'OK',
      sipsLeft: this.sipsLeft,
      fillRatio: this.sipToFill,
      finishedWhenDone: this.sipsLeft === 0,
    }
  }

  discard(): boolean {
    if (this.state === 'idle') return false
    this.clearState()
    this.emit()
    return true
  }

  private clearState(): void {
    this.state = 'idle'
    this.drink = null
    this.customization = null
    this.orderId = null
    this.sipsTotal = 0
    this.sipsLeft = 0
    this.fillRatio = 0
    this.sipFromFill = 0
    this.sipToFill = 0
    this.sipElapsed = 0
    this.finishElapsed = 0
  }

  /**
   * 推进模拟帧，返回本帧是否刚刚喝完并自动收起空杯。
   */
  step(dtSec: number): boolean {
    if (this.state === 'idle') return false
    const dt = Math.min(0.25, Math.max(0, Number.isFinite(dtSec) ? dtSec : 0))
    if (this.state === 'drinking') {
      this.sipElapsed += dt
      const u = clamp01(this.sipElapsed / DRINK_SIP_DURATION_SEC)
      this.fillRatio = lerp(this.sipFromFill, this.sipToFill, u)
      if (this.sipElapsed >= DRINK_SIP_DURATION_SEC) {
        this.fillRatio = this.sipToFill
        if (this.sipsLeft <= 0) {
          this.state = 'finishing'
          this.finishElapsed = 0
        } else {
          this.state = 'holding'
        }
        this.emit()
      }
      return false
    }

    if (this.state === 'finishing') {
      this.finishElapsed += dt
      if (this.finishElapsed >= DRINK_FINISH_FADE_SEC) {
        this.clearState()
        this.emit()
        return true
      }
    }
    return false
  }
}

export interface DrinkHoldHudOptions {
  container?: HTMLElement
  session: DrinkHoldSession
  onSip?: () => void
  onDiscard?: () => void
}

export interface DrinkHoldHudController {
  readonly root: HTMLElement
  dispose(): void
}

/**
 * 手捧饮品时的悬浮操作条：只有玩家手里真正拿着杯子（且未骑行/拍照/进店）时才出现「喝一口」按钮。
 */
export function mountDrinkHoldHud(opts: DrinkHoldHudOptions): DrinkHoldHudController {
  const host = opts.container ?? document.body
  const root = document.createElement('div')
  root.className = 'drinks-hold-hud'
  root.hidden = true
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', '手持饮品')
  root.innerHTML = `
    <span class="drinks-hold-name" data-drinks-hold-name></span>
    <span class="drinks-hold-sips" data-drinks-hold-sips></span>
    <button type="button" class="drinks-hold-btn drinks-hold-btn--primary" data-drinks-action="sip">喝一口</button>
    <button type="button" class="drinks-hold-btn" data-drinks-action="discard" aria-label="收起饮品">收起</button>
  `
  host.append(root)

  const nameEl = root.querySelector<HTMLElement>('[data-drinks-hold-name]')!
  const sipsEl = root.querySelector<HTMLElement>('[data-drinks-hold-sips]')!
  const sipBtn = root.querySelector<HTMLButtonElement>('[data-drinks-action="sip"]')!
  const discardBtn = root.querySelector<HTMLButtonElement>('[data-drinks-action="discard"]')!

  const triggerSip = () => {
    if (opts.onSip) opts.onSip()
    else opts.session.sip()
  }
  const triggerDiscard = () => {
    if (opts.onDiscard) opts.onDiscard()
    else opts.session.discard()
  }

  // 不抢 canvas 键盘焦点
  for (const btn of [sipBtn, discardBtn]) {
    btn.addEventListener('pointerdown', e => e.preventDefault())
  }
  sipBtn.addEventListener('click', triggerSip)
  discardBtn.addEventListener('click', triggerDiscard)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target as HTMLElement | null
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    const snap = opts.session.getSnapshot()
    if (!snap.active || snap.paused) return
    if (document.body.dataset.photo === 'on' || document.body.dataset.shopOpen === '1') return
    if (document.body.hasAttribute('data-aboard')) return
    if (event.code === 'KeyH' || event.code === 'KeyY') {
      triggerSip()
    }
  }
  window.addEventListener('keydown', onKeyDown)

  const off = opts.session.onChange(snap => {
    const show = snap.active && !snap.paused
    root.hidden = !show
    if (show) document.body.dataset.drinksHold = '1'
    else delete document.body.dataset.drinksHold

    if (!show || !snap.drink) return
    nameEl.textContent = snap.drink.name
    sipsEl.textContent = `${snap.sipsLeft}/${snap.sipsTotal}口`
    sipBtn.disabled = !snap.canSip
    sipBtn.textContent = snap.state === 'drinking' ? '喝着' : '喝一口'
    sipBtn.setAttribute('aria-label', `${snap.drink.name}，剩${snap.sipsLeft}口，喝一口`)
  })

  return {
    root,
    dispose() {
      off()
      window.removeEventListener('keydown', onKeyDown)
      delete document.body.dataset.drinksHold
      root.remove()
    },
  }
}

export interface DrinkHoldVisualAdapter {
  bindWalker(walker: Walker | null | undefined, figure?: THREE.Object3D | null): void
  step(dtSec: number): boolean
  dispose(): void
}

const FINGER_NAMES = [
  'index_01_r', 'index_02_r', 'index_03_r',
  'middle_01_r', 'middle_02_r', 'middle_03_r',
  'ring_01_r', 'ring_02_r', 'ring_03_r',
  'pinky_01_r', 'pinky_02_r', 'pinky_03_r',
  'thumb_01_r', 'thumb_02_r', 'thumb_03_r',
] as const

/**
 * 3D 右手捧杯与喝饮品动画桥接层：
 * - 杯子直接挂载在 `walker.handAnchor()`（复用主线 `attach_hand_r` 与 10 指骨架）
 * - 复用 `walker.setCameraHold(true, { aim })` 抬起右臂并随喝水进度抬升倾斜杯身
 */
export function createDrinkHoldVisual(session: DrinkHoldSession): DrinkHoldVisualAdapter {
  let cup: DrinkCupVisual | null = null
  let currentWalker: Walker | null = null
  let currentFigure: THREE.Object3D | null = null
  let lastDrinkId: string | null = null
  let holdingPoseEngaged = false
  const fingerRest = new Map<THREE.Object3D, THREE.Quaternion>()
  const qFinger = new THREE.Quaternion()
  const qThumb = new THREE.Quaternion()

  qFinger.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.72)
  qThumb.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.45)

  function restoreFingers(): void {
    for (const [bone, q] of fingerRest) bone.quaternion.copy(q)
    fingerRest.clear()
  }

  function applyFingerGrip(): void {
    restoreFingers()
    if (!currentFigure) return
    for (const name of FINGER_NAMES) {
      const bone = currentFigure.getObjectByName(name)
      if (!bone) continue
      fingerRest.set(bone, bone.quaternion.clone())
      bone.quaternion.multiply(name.startsWith('thumb_') ? qThumb : qFinger)
    }
  }

  function releaseHoldPose(): void {
    restoreFingers()
    if (holdingPoseEngaged) {
      currentWalker?.setCameraHold?.(false)
      holdingPoseEngaged = false
    }
    if (cup) {
      cup.group.removeFromParent()
    }
  }

  return {
    bindWalker(walker, figure) {
      if (currentWalker !== (walker ?? null)) {
        releaseHoldPose()
        currentWalker = walker ?? null
      }
      currentFigure = figure ?? null
    },

    step(dtSec) {
      const finishedNow = session.step(dtSec)
      const snap = session.getSnapshot()

      if (!snap.active || snap.paused || !snap.drink) {
        releaseHoldPose()
        return finishedNow
      }

      const anchor = currentWalker?.handAnchor?.()
      if (!anchor) return finishedNow

      // 若玩家已切换到相机档位（handAnchor 里有 camera- 道具），先隐藏杯子不争抢右臂
      const hasCameraMounted = anchor.children.some(child => /^camera-/.test(child.name))
      if (hasCameraMounted) {
        releaseHoldPose()
        return finishedNow
      }

      if (!cup) {
        cup = createDrinkCupModel()
      }
      if (lastDrinkId !== snap.drink.id) {
        cup.setDrink(snap.drink)
        lastDrinkId = snap.drink.id
      }
      if (cup.group.parent !== anchor) {
        anchor.add(cup.group)
      }

      cup.setFillRatio(snap.fillRatio)
      cup.setSipTilt(snap.sipProgress)

      const s = snap.sipProgress
      currentWalker?.setCameraHold?.(true, {
        aim: {
          forward: lerp(HOLD_AIM_REST.forward, HOLD_AIM_SIP.forward, s),
          up: lerp(HOLD_AIM_REST.up, HOLD_AIM_SIP.up, s),
          side: lerp(HOLD_AIM_REST.side, HOLD_AIM_SIP.side, s),
        },
      })
      holdingPoseEngaged = true
      applyFingerGrip()
      return finishedNow
    },

    dispose() {
      releaseHoldPose()
      cup?.dispose()
      cup = null
      currentWalker = null
      currentFigure = null
      lastDrinkId = null
    },
  }
}
