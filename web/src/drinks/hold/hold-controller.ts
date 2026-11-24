import * as THREE from 'three'
import type { Walker } from '../../play/host.ts'
import { getDrinkById, type DrinkCatalogItem, type DrinkCustomization } from '../menu/menu.ts'
import { DEFAULT_MASTER_DRINKS_SKIN, type DrinksMasterSkin } from '../menu/skin.ts'
import { createDrinkCupModel, type DrinkCupVisual } from './cup-model.ts'
import { createDrinkStrawAudio, type DrinkStrawAudioController } from './straw-audio.ts'

export type DrinkHoldState = 'idle' | 'holding' | 'drinking' | 'finishing'

export const DRINK_HOLD_STORAGE_KEY = 'glol.drinks.hold.v1'

/**
 * 核对最新 `origin/main` 键位占用后的默认饮品键：
 * - `KeyY` 已被 `web/src/input/keymap.ts:21` `useItem` 占用
 * - `KeyH` 已被 `web/src/ui/walk.ts:355` `horn` 占用
 * - `KeyI` 在全仓无占用，作为桌面端「长按喝」快捷键；移动端直接长按悬浮按钮
 */
export const DRINK_SIP_HOTKEY = 'KeyI'
export const DRINK_SIP_KEY_LABEL = 'I'
export const ORIGIN_MAIN_KEY_AUDIT = Object.freeze({
  KeyY: 'occupied:useItem(web/src/input/keymap.ts)',
  KeyH: 'occupied:horn(web/src/ui/walk.ts)',
  chosen: DRINK_SIP_HOTKEY,
})

export const DRINK_SIP_DURATION_SEC = 1.2
export const DRINK_FINISH_FADE_SEC = 0.25

export const HOLD_AIM_REST = { forward: 0.25, up: 0.02, side: 0.13 } as const
export const HOLD_AIM_SIP = { forward: 0.2, up: 0.26, side: 0.02 } as const

export interface DrinkHoldStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface PersistedHoldDrinkRecord {
  version: 1 | 2
  drinkId: string
  customization: DrinkCustomization
  orderId: string | null
  energy?: number
  sipsTotal: number
  sipsLeft?: number
  updatedAt: number
}

export interface DrinkHoldSessionOptions {
  storage?: DrinkHoldStorageLike | null
  persistKey?: string
  resolveDrink?: (drinkId: string) => DrinkCatalogItem | undefined
  now?: () => number
}

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
  readonly drinking: boolean
  readonly drink: DrinkCatalogItem | null
  readonly customization: DrinkCustomization | null
  readonly orderId: string | null
  readonly energy: number
  readonly energyPct: number
  readonly remainingMl: number
  readonly sipsTotal: number
  readonly sipsLeft: number
  readonly fillRatio: number
  readonly sipProgress: number
  readonly canSip: boolean
  readonly syncState: HeldDrinkSyncPayload
}

export interface DrinkHoldStartResult {
  ok: boolean
  code: 'OK' | 'NO_DRINK' | 'PAUSED' | 'ALREADY_DRINKING'
  energy: number
}

export interface DrinkSipResult {
  ok: boolean
  code: 'OK' | 'NO_DRINK' | 'SIP_IN_PROGRESS' | 'PAUSED'
  sipsLeft: number
  fillRatio: number
  finishedWhenDone: boolean
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function resolveDefaultStorage(opt: DrinkHoldStorageLike | null | undefined): DrinkHoldStorageLike | null {
  if (opt === null) return null
  if (opt !== undefined) return opt
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage
    }
  } catch {
    // ignore storage restriction
  }
  return null
}

/** 按饮品杯容量返回从满杯长按喝空所需的连续时长（秒） */
export function resolveCupEmptyDurationSec(drink: Pick<DrinkCatalogItem, 'volumeMl'>): number {
  const ml = Number.isFinite(drink.volumeMl) ? drink.volumeMl : 500
  if (ml <= 320) return 3.6
  if (ml >= 650) return 5.4
  return 4.5
}

/**
 * 连续能量条手持饮品状态机：
 * - 支持 `startDrinking()` / `stopDrinking()`：按住连续扣能量并降液面，松手即刻冻结余量
 * - 兼容短按 `sip()` 脉冲与既有 `sipsLeft`/`fillRatio`/`syncState` 接口
 * - 支持 `glol.drinks.hold.v1` 本地连续余量刷新恢复
 */
export class DrinkHoldSession {
  private state: DrinkHoldState = 'idle'
  private drink: DrinkCatalogItem | null = null
  private customization: DrinkCustomization | null = null
  private orderId: string | null = null
  private sipsTotal = 0
  private energy = 0
  private armBlend = 0
  private pulseStopEnergy: number | null = null
  private finishElapsed = 0
  private lastPersistedEnergy = 1
  private paused = false
  private pauseReasons = new Set<string>()
  private listeners = new Set<(snap: DrinkHoldSnapshot) => void>()
  private readonly storage: DrinkHoldStorageLike | null
  private readonly persistKey: string
  private readonly resolveDrink: (drinkId: string) => DrinkCatalogItem | undefined
  private readonly now: () => number

  constructor(opts: DrinkHoldSessionOptions = {}) {
    this.storage = resolveDefaultStorage(opts.storage)
    this.persistKey = opts.persistKey ?? DRINK_HOLD_STORAGE_KEY
    this.resolveDrink = opts.resolveDrink ?? getDrinkById
    this.now = opts.now ?? (() => Date.now())
    this.restore()
  }

  private persistNow(): void {
    if (!this.storage) return
    try {
      if (this.state === 'idle' || this.state === 'finishing' || !this.drink || this.energy <= 0.002) {
        this.storage.removeItem(this.persistKey)
        this.lastPersistedEnergy = 0
        return
      }
      const roundedEnergy = Math.round(this.energy * 1000) / 1000
      const sipsLeft = Math.max(1, Math.ceil(this.energy * Math.max(1, this.sipsTotal)))
      const record: PersistedHoldDrinkRecord = {
        version: 2,
        drinkId: this.drink.id,
        customization: this.customization ?? {
          ice: this.drink.iceOptions[0] ?? '正常冰',
          sugar: this.drink.sugarOptions[0] ?? '全糖',
        },
        orderId: this.orderId,
        energy: roundedEnergy,
        sipsTotal: this.sipsTotal,
        sipsLeft,
        updatedAt: this.now(),
      }
      this.storage.setItem(this.persistKey, JSON.stringify(record))
      this.lastPersistedEnergy = this.energy
    } catch {
      // ignore storage quota errors
    }
  }

  /** 从本地存档恢复未喝完的手捧饮品余量（兼容 v1 按口数与 v2 连续能量百分比）。 */
  restore(): boolean {
    if (!this.storage) return false
    try {
      const raw = this.storage.getItem(this.persistKey)
      if (!raw) return false
      const parsed = JSON.parse(raw) as Partial<PersistedHoldDrinkRecord>
      if (!parsed || (parsed.version !== 1 && parsed.version !== 2) || typeof parsed.drinkId !== 'string') {
        this.storage.removeItem(this.persistKey)
        return false
      }
      const drink = this.resolveDrink(parsed.drinkId)
      const sipsTotal =
        Number.isSafeInteger(parsed.sipsTotal) && (parsed.sipsTotal ?? 0) > 0
          ? parsed.sipsTotal!
          : drink?.sipsCount ?? 5
      let restoredEnergy = 0
      if (typeof parsed.energy === 'number' && Number.isFinite(parsed.energy)) {
        restoredEnergy = clamp01(parsed.energy)
      } else if (Number.isSafeInteger(parsed.sipsLeft) && sipsTotal > 0) {
        restoredEnergy = clamp01(parsed.sipsLeft! / sipsTotal)
      }
      if (!drink || restoredEnergy <= 0.002) {
        this.storage.removeItem(this.persistKey)
        return false
      }
      this.state = 'holding'
      this.drink = drink
      this.customization = {
        ice:
          parsed.customization?.ice && drink.iceOptions.includes(parsed.customization.ice)
            ? parsed.customization.ice
            : drink.iceOptions[0] ?? '正常冰',
        sugar:
          parsed.customization?.sugar && drink.sugarOptions.includes(parsed.customization.sugar)
            ? parsed.customization.sugar
            : drink.sugarOptions[0] ?? '全糖',
      }
      this.orderId = typeof parsed.orderId === 'string' ? parsed.orderId : null
      this.sipsTotal = sipsTotal
      this.energy = restoredEnergy
      this.armBlend = 0
      this.pulseStopEnergy = null
      this.finishElapsed = 0
      this.lastPersistedEnergy = restoredEnergy
      this.emit()
      return true
    } catch {
      try {
        this.storage.removeItem(this.persistKey)
      } catch {
        // ignore
      }
      return false
    }
  }

  getSnapshot(): DrinkHoldSnapshot {
    const active = this.state !== 'idle'
    const sipping = this.state === 'drinking' && !this.paused
    const energy = active ? clamp01(this.energy) : 0
    const sipsLeft = active ? Math.max(0, Math.ceil(energy * Math.max(1, this.sipsTotal))) : 0
    const volumeMl = this.drink?.volumeMl ?? 0
    return {
      state: this.state,
      active,
      paused: this.paused,
      drinking: sipping,
      drink: this.drink,
      customization: this.customization,
      orderId: this.orderId,
      energy,
      energyPct: active ? Math.round(energy * 100) : 0,
      remainingMl: active ? Math.max(0, Math.round(volumeMl * energy)) : 0,
      sipsTotal: this.sipsTotal,
      sipsLeft,
      fillRatio: energy,
      sipProgress: clamp01(this.armBlend),
      canSip: this.state === 'holding' && !this.paused && energy > 0.002,
      syncState: {
        holding: active,
        drinkId: this.drink?.id ?? null,
        sipping,
        sipsLeft,
        fillRatio: +energy.toFixed(3),
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
    this.energy = 1
    this.armBlend = 0
    this.pulseStopEnergy = null
    this.finishElapsed = 0
    this.persistNow()
    this.emit()
    return this.getSnapshot()
  }

  setPaused(paused: boolean, reason = 'manual'): void {
    const next = Boolean(paused)
    if (next) this.pauseReasons.add(reason)
    else this.pauseReasons.delete(reason)
    const computedPaused = this.pauseReasons.size > 0
    if (computedPaused === this.paused) return
    this.paused = computedPaused
    if (this.paused && this.state === 'drinking') {
      this.state = 'holding'
      this.pulseStopEnergy = null
      this.persistNow()
    }
    this.emit()
  }

  /** 长按开始持续喝：进入连续吸饮态，每帧随 step(dt) 持续扣减能量与液位 */
  startDrinking(): DrinkHoldStartResult {
    if (this.state === 'idle' || this.state === 'finishing' || !this.drink || this.energy <= 0.002) {
      return { ok: false, code: 'NO_DRINK', energy: 0 }
    }
    if (this.paused) {
      return { ok: false, code: 'PAUSED', energy: this.energy }
    }
    if (this.state === 'drinking') {
      return { ok: false, code: 'ALREADY_DRINKING', energy: this.energy }
    }
    this.pulseStopEnergy = null
    this.state = 'drinking'
    this.emit()
    return { ok: true, code: 'OK', energy: this.energy }
  }

  /** 松手立即停止：冻结当前能量与液位，落盘保存，手臂平滑收回休息位 */
  stopDrinking(): boolean {
    if (this.state !== 'drinking') return false
    this.pulseStopEnergy = null
    if (this.energy <= 0.002) {
      this.energy = 0
      this.state = 'finishing'
      this.finishElapsed = 0
    } else {
      this.state = 'holding'
    }
    this.persistNow()
    this.emit()
    return true
  }

  /** 兼容旧单次点按语义（内部转为定量脉冲；按住请用 startDrinking / stopDrinking） */
  sip(): DrinkSipResult {
    if (this.state === 'idle' || this.state === 'finishing' || !this.drink || this.energy <= 0.002) {
      return { ok: false, code: 'NO_DRINK', sipsLeft: 0, fillRatio: 0, finishedWhenDone: false }
    }
    if (this.paused) {
      return {
        ok: false,
        code: 'PAUSED',
        sipsLeft: Math.ceil(this.energy * Math.max(1, this.sipsTotal)),
        fillRatio: this.energy,
        finishedWhenDone: false,
      }
    }
    if (this.state === 'drinking') {
      return {
        ok: false,
        code: 'SIP_IN_PROGRESS',
        sipsLeft: Math.ceil(this.energy * Math.max(1, this.sipsTotal)),
        fillRatio: this.energy,
        finishedWhenDone: false,
      }
    }

    const stepFrac = 1 / Math.max(1, this.sipsTotal)
    const targetEnergy = Math.max(0, this.energy - stepFrac)
    this.pulseStopEnergy = targetEnergy <= 0.002 ? 0 : targetEnergy
    this.state = 'drinking'
    this.emit()

    const projectedSipsLeft = Math.max(0, Math.ceil(targetEnergy * Math.max(1, this.sipsTotal) - 1e-4))
    return {
      ok: true,
      code: 'OK',
      sipsLeft: projectedSipsLeft,
      fillRatio: targetEnergy,
      finishedWhenDone: targetEnergy <= 0.002,
    }
  }

  discard(): boolean {
    if (this.state === 'idle') return false
    this.clearState()
    this.persistNow()
    this.emit()
    return true
  }

  private clearState(): void {
    this.state = 'idle'
    this.drink = null
    this.customization = null
    this.orderId = null
    this.sipsTotal = 0
    this.energy = 0
    this.armBlend = 0
    this.pulseStopEnergy = null
    this.finishElapsed = 0
    this.persistNow()
  }

  /**
   * 推进连续喝水与手臂姿势动画；返回本帧是否刚刚喝空并自动收起空杯。
   */
  step(dtSec: number): boolean {
    if (this.state === 'idle') return false
    const dt = Math.min(0.25, Math.max(0, Number.isFinite(dtSec) ? dtSec : 0))

    if (this.state === 'drinking' && !this.paused && this.drink) {
      this.armBlend = clamp01(this.armBlend + dt * 5.5)
      const drainRate = 1 / resolveCupEmptyDurationSec(this.drink)
      const nextEnergy = Math.max(0, this.energy - drainRate * dt)

      if (this.pulseStopEnergy !== null && nextEnergy <= this.pulseStopEnergy) {
        this.energy = this.pulseStopEnergy
        this.pulseStopEnergy = null
        if (this.energy <= 0.002) {
          this.energy = 0
          this.state = 'finishing'
          this.finishElapsed = 0
        } else {
          this.state = 'holding'
        }
        this.persistNow()
        this.emit()
        return false
      }

      this.energy = nextEnergy
      if (this.energy <= 0.002) {
        this.energy = 0
        this.state = 'finishing'
        this.finishElapsed = 0
        this.persistNow()
        this.emit()
        return false
      }

      if (Math.abs(this.energy - this.lastPersistedEnergy) >= 0.06) {
        this.persistNow()
      }
      this.emit()
      return false
    }

    if (this.armBlend > 0) {
      const nextBlend = Math.max(0, this.armBlend - dt * 6.5)
      if (nextBlend !== this.armBlend) {
        this.armBlend = nextBlend
        this.emit()
      }
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

export interface HoldHostState {
  aboard: boolean
  photo: boolean
  home: boolean
  shopOpen: boolean
  drinksUiOpen: boolean
}

export function readHoldHostState(
  body: { dataset?: Record<string, string | undefined>; hasAttribute?: (name: string) => boolean } | null | undefined,
): HoldHostState {
  if (!body) {
    return { aboard: false, photo: false, home: false, shopOpen: false, drinksUiOpen: false }
  }
  const has = (attr: string, dsKey: string) =>
    Boolean(body.hasAttribute?.(attr) || (body.dataset && body.dataset[dsKey] !== undefined))
  return {
    aboard: has('data-aboard', 'aboard'),
    photo: body.dataset?.photo === 'on',
    home: has('data-home', 'home'),
    shopOpen: body.dataset?.shopOpen === '1',
    drinksUiOpen: body.dataset?.drinksUiOpen === '1',
  }
}

export function evaluateHoldHostAction(
  session: DrinkHoldSession,
  hostState: HoldHostState,
  opts?: { pauseOnAboard?: boolean; pauseInPhoto?: boolean },
): 'stowed' | 'paused' | 'active' {
  const pauseOnAboard = opts?.pauseOnAboard ?? true
  const pauseInPhoto = opts?.pauseInPhoto ?? true
  const stowedForRide = pauseOnAboard && hostState.aboard
  const shouldPause =
    stowedForRide ||
    hostState.home ||
    hostState.shopOpen ||
    hostState.drinksUiOpen ||
    (pauseInPhoto && hostState.photo)
  session.setPaused(shouldPause, 'host')
  if (stowedForRide) return 'stowed'
  return shouldPause ? 'paused' : 'active'
}

export function attachHoldHostGuards(
  session: DrinkHoldSession,
  opts?: { pauseOnAboard?: boolean; pauseInPhoto?: boolean },
): { sync: () => 'stowed' | 'paused' | 'active'; dispose: () => void } {
  const body = typeof document !== 'undefined' ? document.body : null
  const sync = () => evaluateHoldHostAction(session, readHoldHostState(body), opts)
  sync()

  let observer: MutationObserver | null = null
  if (body && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => {
      sync()
    })
    observer.observe(body, {
      attributes: true,
      attributeFilter: ['data-aboard', 'data-photo', 'data-home', 'data-shop-open', 'data-drinks-ui-open'],
    })
  }
  return {
    sync,
    dispose() {
      observer?.disconnect()
      observer = null
      session.setPaused(false, 'host')
    },
  }
}

export interface DrinkHoldHudOptions {
  container?: HTMLElement
  session: DrinkHoldSession
  hotkey?: string
  keyLabel?: string
  pauseOnAboard?: boolean
  pauseInPhoto?: boolean
  strawAudio?: DrinkStrawAudioController | null
  onSip?: () => void
  onSipStart?: () => void
  onSipStop?: () => void
  onDiscard?: () => void
}

export interface DrinkHoldHudController {
  readonly root: HTMLElement
  readonly hotkey: string
  readonly audio: DrinkStrawAudioController | null
  syncHostState(): void
  dispose(): void
}

/**
 * 连续能量条手捧饮品 HUD：
 * - 长按「按住喝 / KeyI」连续消耗能量与杯内液面并播放吸管吸吮声；松手即刻暂停
 * - 极简 Linear / Apple Notes 胶囊布局：无标语、无渐变、无 emoji，单朱砂主按钮
 */
export function mountDrinkHoldHud(opts: DrinkHoldHudOptions): DrinkHoldHudController {
  const host = opts.container ?? document.body
  const hotkey = opts.hotkey ?? DRINK_SIP_HOTKEY
  const keyLabel = opts.keyLabel ?? (hotkey === DRINK_SIP_HOTKEY ? DRINK_SIP_KEY_LABEL : hotkey.replace(/^Key/, ''))
  const ownsAudio = opts.strawAudio === undefined
  const strawAudio = opts.strawAudio === null ? null : opts.strawAudio ?? createDrinkStrawAudio()

  const root = document.createElement('div')
  root.className = 'drinks-hold-hud'
  root.hidden = true
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', '手持饮品')
  root.dataset.hotkey = hotkey
  root.innerHTML = `
    <div class="drinks-hold-meta">
      <div class="drinks-hold-row">
        <span class="drinks-hold-name" data-drinks-hold-name></span>
        <span class="drinks-hold-sips" data-drinks-hold-sips>100%</span>
      </div>
      <div class="drinks-hold-meter" role="progressbar" aria-label="饮品余量" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100" data-drinks-hold-meter>
        <i class="drinks-hold-meter-fill" data-drinks-hold-fill></i>
      </div>
    </div>
    <button type="button" class="drinks-hold-btn drinks-hold-btn--primary" data-drinks-action="sip" aria-keyshortcuts="${hotkey}">按住喝<kbd class="drinks-hold-key" aria-hidden="true">${keyLabel}</kbd></button>
    <button type="button" class="drinks-hold-btn" data-drinks-action="discard" aria-label="收起饮品">收起</button>
  `
  host.append(root)

  const nameEl = root.querySelector<HTMLElement>('[data-drinks-hold-name]')!
  const pctEl = root.querySelector<HTMLElement>('[data-drinks-hold-sips]')!
  const meterEl = root.querySelector<HTMLElement>('[data-drinks-hold-meter]')!
  const fillEl = root.querySelector<HTMLElement>('[data-drinks-hold-fill]')!
  const sipBtn = root.querySelector<HTMLButtonElement>('[data-drinks-action="sip"]')!
  const discardBtn = root.querySelector<HTMLButtonElement>('[data-drinks-action="discard"]')!

  let holdPointerActive = false
  let holdKeyActive = false
  let lastOrderTag = ''
  let pokedForCup = false
  let prevState: DrinkHoldState = 'idle'
  let wasDrinkingAudio = false

  const startHoldDrink = () => {
    const snapBefore = opts.session.getSnapshot()
    if (!snapBefore.active || snapBefore.paused) return
    strawAudio?.unlock()
    if (!pokedForCup && snapBefore.energy >= 0.99) {
      pokedForCup = true
      strawAudio?.triggerStrawPoke()
    }
    const res = opts.session.startDrinking()
    if (res.ok) {
      opts.onSipStart?.()
    }
  }

  const stopHoldDrink = () => {
    holdPointerActive = false
    holdKeyActive = false
    if (opts.session.stopDrinking()) {
      opts.onSipStop?.()
    }
  }

  const triggerDiscard = () => {
    stopHoldDrink()
    if (opts.onDiscard) opts.onDiscard()
    else opts.session.discard()
  }

  for (const btn of [sipBtn, discardBtn]) {
    btn.addEventListener('pointerdown', e => e.preventDefault())
  }

  sipBtn.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    holdPointerActive = true
    try {
      sipBtn.setPointerCapture?.(e.pointerId)
    } catch {
      // ignore synthetic pointer events
    }
    startHoldDrink()
  })

  const onPointerRelease = () => {
    if (!holdPointerActive) return
    stopHoldDrink()
  }
  sipBtn.addEventListener('pointerup', onPointerRelease)
  sipBtn.addEventListener('pointercancel', onPointerRelease)
  sipBtn.addEventListener('lostpointercapture', onPointerRelease)
  discardBtn.addEventListener('click', triggerDiscard)

  const guards = attachHoldHostGuards(opts.session, {
    pauseOnAboard: opts.pauseOnAboard,
    pauseInPhoto: opts.pauseInPhoto,
  })

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target as HTMLElement | null
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    if (event.code !== hotkey) return
    const snap = opts.session.getSnapshot()
    if (!snap.active || snap.paused) return
    const hostState = readHoldHostState(document.body)
    if (hostState.aboard || hostState.photo || hostState.home || hostState.shopOpen || hostState.drinksUiOpen) return
    holdKeyActive = true
    startHoldDrink()
  }

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code !== hotkey || !holdKeyActive) return
    stopHoldDrink()
  }

  const onWindowBlur = () => {
    if (holdPointerActive || holdKeyActive || opts.session.getSnapshot().drinking) {
      stopHoldDrink()
    }
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onWindowBlur)

  const off = opts.session.onChange(snap => {
    const orderTag = `${snap.drink?.id ?? ''}:${snap.orderId ?? ''}`
    if (orderTag !== lastOrderTag) {
      lastOrderTag = orderTag
      pokedForCup = snap.energy < 0.99
    }

    if (snap.drinking) {
      strawAudio?.setDrinking(true, snap.energy)
      wasDrinkingAudio = true
    } else {
      if (wasDrinkingAudio) {
        strawAudio?.setDrinking(false, snap.energy)
        wasDrinkingAudio = false
      }
      if (prevState !== 'finishing' && snap.state === 'finishing') {
        strawAudio?.triggerComplete()
      }
    }
    prevState = snap.state

    const show = snap.active && !snap.paused
    root.hidden = !show
    if (show) document.body.dataset.drinksHold = '1'
    else delete document.body.dataset.drinksHold

    if (!show || !snap.drink) return
    nameEl.textContent = snap.drink.name
    pctEl.textContent = `${snap.energyPct}%`
    meterEl.setAttribute('aria-valuenow', String(snap.energyPct))
    if (fillEl.style) {
      fillEl.style.transform = `scaleX(${snap.energy.toFixed(4)})`
    }
    root.classList.toggle('is-drinking', snap.drinking)
    sipBtn.disabled = snap.state === 'finishing'
    sipBtn.setAttribute('aria-pressed', String(snap.drinking))
    const btnText = snap.state === 'finishing' ? '喝完' : snap.drinking ? '饮用中' : '按住喝'
    sipBtn.innerHTML = `${btnText}<kbd class="drinks-hold-key" aria-hidden="true">${keyLabel}</kbd>`
    sipBtn.setAttribute('aria-label', `${snap.drink.name}，余 ${snap.energyPct}%，按住${keyLabel}或按钮持续喝`)
  })

  return {
    root,
    hotkey,
    audio: strawAudio,
    syncHostState: () => {
      guards.sync()
    },
    dispose() {
      stopHoldDrink()
      off()
      guards.dispose()
      if (ownsAudio) strawAudio?.dispose()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
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
 * 3D 右手捧杯与连续啜饮同步动画：
 * - 液面与浮冰随 `DrinkHoldSession` 连续能量条同步下降
 * - 复用 `walker.handAnchor()` + `walker.setCameraHold(true, { aim })` 平滑抬手与松手复位
 */
export function createDrinkHoldVisual(
  session: DrinkHoldSession,
  masterSkin: DrinksMasterSkin = DEFAULT_MASTER_DRINKS_SKIN,
): DrinkHoldVisualAdapter {
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
      if (typeof document !== 'undefined' && document.body) {
        evaluateHoldHostAction(session, readHoldHostState(document.body))
      }
      const finishedNow = session.step(dtSec)
      const snap = session.getSnapshot()

      if (!snap.active || snap.paused || !snap.drink) {
        releaseHoldPose()
        return finishedNow
      }

      const anchor = currentWalker?.handAnchor?.()
      if (!anchor) return finishedNow

      const hasCameraMounted = anchor.children.some(child => /^camera-/.test(child.name))
      if (hasCameraMounted) {
        releaseHoldPose()
        return finishedNow
      }

      if (!cup) {
        cup = createDrinkCupModel(masterSkin)
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
