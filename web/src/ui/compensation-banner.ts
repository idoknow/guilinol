import * as THREE from 'three'
import './compensation-banner.css'
import {masterVolume, rideSoundMuted} from '../walk/ride-sound-pref'

/**
 * IDOK-545 共享电车「理赔回执」：转弯打滑摔车后，商家赔偿到账的那一下。
 *
 * 一张不透明的墨青纸回执（山水印体系，theme.css 令牌）：左朱砂白文印「赔」，中间原文 + 钱包余额，右金色到账大字。
 * 节奏（相对 show() 调用，delayMs 默认 280）：
 *   delay        卡片下滑淡入 180ms · 滑稽「womp」
 *   delay+180    「赔」印砸落 + 卡片极轻一震 · 盖章「嘭」
 *   delay+340    金额 +¥0 → +¥{amount} 滚数 420ms，定格轻弹 + 一道金光 · 收银「叮铃」+ 三声硬币
 *   durationMs   220ms 淡出（默认 4200）
 * prefers-reduced-motion：不砸印、不震、不滚数，直接给最终金额，只做淡入淡出。
 * 不拦点击 / 触摸起身（pointer-events:none），不开 backdrop-filter（IDOK-297）。
 */

export interface CompensationBannerOptions {
  /** 赔偿金额（元），默认 200 */
  amount?: number
  /** 入账后的钱包余额；不传则不显示余额行 */
  balanceAfter?: number
  /** 主文案，默认 {@link COMPENSATION_DEFAULT_COPY} */
  copy?: string
  /** 卡片入场前的等待，默认 280；测试可传 0（同步入场） */
  delayMs?: number
  /** 从 show() 起到开始淡出的总时长，默认 4200 */
  durationMs?: number
  /** 测试用：不出声 */
  silentAudio?: boolean
}

export interface CompensationBannerHandle {
  show(opts?: CompensationBannerOptions): void
  hide(): void
  isVisible(): boolean
  getElement(): HTMLElement | null
  dispose(): void
}

export const COMPENSATION_DEFAULT_COPY = '商家对于你的不幸感到糟糕的赔偿'

type CompState = 'idle' | 'entering' | 'shown' | 'exiting'

const DEFAULT_AMOUNT = 200
const DEFAULT_DELAY_MS = 280
const DEFAULT_DURATION_MS = 4200
const ENTER_MS = 180
/** 印章落下、滚数开始：相对卡片入场的偏移 */
const STAMP_AT_MS = 180
const ROLL_AT_MS = 340
const ROLL_MS = 420
/** 滚数定格后至少再停这么久，durationMs 给得太短也看得清 */
const MIN_HOLD_AFTER_ROLL_MS = 900
const EXIT_MS = 220
const FX_CLASSES = ['is-stamp', 'is-pop', 'is-settled'] as const

const yuan = (n: number) => Math.round(n).toLocaleString('zh-CN')
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const msOr = (v: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : fallback)

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

interface BannerParts {
  copy: HTMLElement
  balance: HTMLElement
  amount: HTMLElement
  roll: HTMLElement
  sr: HTMLElement
}

function createBanner(): CompensationBannerHandle {
  let el: HTMLElement | null = null
  let parts: BannerParts | null = null
  let state: CompState = 'idle'
  let timers: number[] = []
  let raf = 0

  function ensure(): {root: HTMLElement; p: BannerParts} {
    if (el && parts) {
      if (!el.isConnected) document.body.append(el)
      return {root: el, p: parts}
    }
    const root = document.createElement('div')
    root.className = 'comp-banner'
    root.setAttribute('role', 'status')
    root.setAttribute('aria-live', 'assertive')
    root.setAttribute('aria-atomic', 'true')
    root.dataset.compState = 'idle'
    root.dataset.compAmount = String(DEFAULT_AMOUNT)
    root.hidden = true
    root.innerHTML =
      '<span class="comp-seal" aria-hidden="true">赔</span>' +
      '<div class="comp-text"><p class="comp-copy"></p><span class="comp-sr"></span><p class="comp-balance" hidden></p></div>' +
      '<span class="comp-amount" aria-hidden="true"><span class="comp-amount-roll"></span></span>'
    document.body.append(root)
    el = root
    parts = {
      copy: root.querySelector<HTMLElement>('.comp-copy')!,
      balance: root.querySelector<HTMLElement>('.comp-balance')!,
      amount: root.querySelector<HTMLElement>('.comp-amount')!,
      roll: root.querySelector<HTMLElement>('.comp-amount-roll')!,
      sr: root.querySelector<HTMLElement>('.comp-sr')!,
    }
    return {root, p: parts}
  }

  function setState(next: CompState): void {
    state = next
    if (el) el.dataset.compState = next
    if (typeof document !== 'undefined' && document.body) {
      if (next === 'entering' || next === 'shown') document.body.dataset.compBanner = '1'
      else delete document.body.dataset.compBanner
    }
  }

  /** 收掉上一轮的 timer / rAF / 音效，连发时不叠、不泄漏 */
  function clearRun(): void {
    for (const t of timers) clearTimeout(t)
    timers = []
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  /** 相对本轮 show() 的绝对偏移排程；0ms 同步执行（测试传 delayMs:0 时立刻入场） */
  function at(ms: number, fn: () => void): void {
    if (ms <= 0) fn()
    else timers.push(window.setTimeout(fn, ms))
  }

  function settle(root: HTMLElement): void {
    root.hidden = true
    root.classList.remove(...FX_CLASSES)
    setState('idle')
  }

  function beginExit(): void {
    if (!el || state === 'idle' || state === 'exiting') return
    clearRun()
    const root = el
    setState('exiting')
    timers.push(window.setTimeout(() => settle(root), EXIT_MS))
  }

  function show(opts: CompensationBannerOptions = {}): void {
    const amount = Math.max(0, Math.round(msOr(opts.amount, DEFAULT_AMOUNT)))
    const delay = msOr(opts.delayMs, DEFAULT_DELAY_MS)
    const duration = msOr(opts.durationMs, DEFAULT_DURATION_MS)
    const copy = opts.copy?.trim() || COMPENSATION_DEFAULT_COPY
    const balance = typeof opts.balanceAfter === 'number' && Number.isFinite(opts.balanceAfter) ? opts.balanceAfter : null
    const reduced = prefersReducedMotion()
    const finalText = `+¥${yuan(amount)}`

    clearRun()
    stopCompensationSound()
    const {root, p} = ensure()
    settle(root)
    root.dataset.compAmount = String(amount)
    p.amount.dataset.final = finalText
    p.roll.textContent = reduced ? finalText : '+¥0'

    if (!opts.silentAudio) playCompensationSound(delay, reduced)

    let rolled = false
    const finishRoll = () => {
      if (rolled) return
      rolled = true
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      p.roll.textContent = finalText
      root.classList.add('is-pop')
    }
    const startRoll = () => {
      const t0 = performance.now()
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ROLL_MS)
        if (k >= 1) return finishRoll()
        const text = `+¥${yuan(amount * easeOutCubic(k))}`
        if (p.roll.textContent !== text) p.roll.textContent = text
        raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }

    at(delay, () => {
      root.hidden = false
      // 读屏：节点出现之后再写入要播报的文字
      p.copy.textContent = copy
      p.sr.textContent = finalText
      p.balance.hidden = balance === null
      p.balance.textContent = balance === null ? '' : `钱包 ¥${yuan(balance)}`
      void root.offsetWidth // 连发时让入场 keyframes 从头播
      setState('entering')
      if (reduced) root.classList.add('is-settled')
    })
    if (reduced) {
      at(delay + ENTER_MS, () => setState('shown'))
    } else {
      at(delay + STAMP_AT_MS, () => {
        setState('shown')
        root.classList.add('is-stamp')
      })
      at(delay + ROLL_AT_MS, startRoll)
      // 后台标签页 rAF 停摆时兜底定格
      at(delay + ROLL_AT_MS + ROLL_MS + 80, finishRoll)
    }
    const exitAt = Math.max(duration, delay + ROLL_AT_MS + ROLL_MS + MIN_HOLD_AFTER_ROLL_MS)
    at(exitAt, beginExit)
  }

  const handle: CompensationBannerHandle = {
    show,
    hide() {
      stopCompensationSound()
      if (state === 'idle') {
        clearRun()
        return
      }
      beginExit()
    },
    isVisible: () => state !== 'idle',
    getElement: () => el,
    dispose() {
      clearRun()
      stopCompensationSound()
      el?.remove()
      el = null
      parts = null
      state = 'idle'
      if (typeof document !== 'undefined' && document.body) delete document.body.dataset.compBanner
      if (singleton === handle) singleton = null
    },
  }
  return handle
}

let singleton: CompensationBannerHandle | null = null

export function getCompensationBanner(): CompensationBannerHandle {
  return (singleton ??= createBanner())
}

export function showCompensationBanner(opts?: CompensationBannerOptions): void {
  getCompensationBanner().show(opts)
}

export function hideCompensationBanner(): void {
  singleton?.hide()
}

// ---- 喜剧理赔音效：纯 WebAudio，零外部文件 ------------------------------------------------------------
// womp（三角波 880→330Hz 下滑）→ 盖章「嘭」（噪声脉冲 + 140Hz 低频）→ 收银「叮铃」（E6+A6）+ 滚数期三声硬币。
// 所有声部峰值之和按 ≤1 设计，总线再乘 0.2（-14 dBFS）× 主音量；从 womp 起总长 ≤ 1.2s。

const PEAK_GAIN = 0.2 // -14 dBFS
const SFX_STAMP_S = STAMP_AT_MS / 1000
const SFX_DING_S = ROLL_AT_MS / 1000
const SFX_TAIL_S = 1.25

let audioCtx: AudioContext | null = null
let noiseBuf: AudioBuffer | null = null
let liveBus: GainNode | null = null
let liveVoices: AudioScheduledSourceNode[] = []
let cueToken = 0

function soundBlocked(): boolean {
  try {
    if (new URLSearchParams(location.search).has('verify')) return true
  } catch {
    /* no location */
  }
  return rideSoundMuted() || masterVolume() <= 0
}

function getAudioCtx(): AudioContext | null {
  if (audioCtx && audioCtx.state !== 'closed') return audioCtx
  if (typeof window === 'undefined') return null
  const w = window as unknown as {AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext}
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  if (!Ctor) return null
  try {
    audioCtx = new Ctor()
  } catch {
    audioCtx = null
  }
  return audioCtx
}

function stopCompensationSound(): void {
  cueToken++
  for (const v of liveVoices) {
    try {
      v.stop()
    } catch {
      /* not started / already stopped */
    }
  }
  liveVoices = []
  try {
    liveBus?.disconnect()
  } catch {
    /* already gone */
  }
  liveBus = null
}

function playCompensationSound(delayMs: number, reduced: boolean): void {
  try {
    if (soundBlocked()) return
    const ctx = getAudioCtx()
    if (!ctx) return
    const token = ++cueToken
    const startedAt = performance.now()
    const run = () => {
      if (token !== cueToken) return
      const late = (performance.now() - startedAt) / 1000
      try {
        scheduleCue(ctx, delayMs / 1000 - late, reduced)
      } catch {
        /* never let audio break the banner */
      }
    }
    if (ctx.state === 'running') return run()
    // autoplay 限制：只在很快解锁时补播，迟到的音会踩不上画面
    ctx
      .resume()
      .then(() => {
        if (ctx.state === 'running' && performance.now() - startedAt < delayMs + 120) run()
      })
      .catch(() => {})
  } catch {
    /* fail-safe */
  }
}

function scheduleCue(ctx: AudioContext, offsetS: number, reduced: boolean): void {
  const t = ctx.currentTime + Math.max(0, offsetS)
  const bus = ctx.createGain()
  bus.gain.value = PEAK_GAIN * masterVolume()
  bus.connect(ctx.destination)
  liveBus = bus
  if (reduced) {
    ding(ctx, bus, t)
  } else {
    womp(ctx, bus, t)
    stamp(ctx, bus, t + SFX_STAMP_S)
    ding(ctx, bus, t + SFX_DING_S)
    const coinAt = t + SFX_DING_S
    coin(ctx, bus, coinAt + 0.11, 2960)
    coin(ctx, bus, coinAt + 0.22, 3320)
    coin(ctx, bus, coinAt + 0.33, 3520)
  }
  const token = cueToken
  window.setTimeout(() => {
    if (token !== cueToken || liveBus !== bus) return
    try {
      bus.disconnect()
    } catch {
      /* already gone */
    }
    liveBus = null
    liveVoices = []
  }, (Math.max(0, offsetS) + SFX_TAIL_S + 0.1) * 1000)
}

function track(src: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
  liveVoices.push(src)
  src.onended = () => {
    src.disconnect()
    for (const n of nodes) n.disconnect()
    const i = liveVoices.indexOf(src)
    if (i >= 0) liveVoices.splice(i, 1)
  }
}

/** 一个振荡器声部：指数起落的音量包络，可选滑音 */
function tone(
  ctx: AudioContext, bus: AudioNode, t: number,
  type: OscillatorType, f0: number, f1: number, glideS: number,
  peak: number, attackS: number, decayS: number,
): OscillatorNode {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(f0, t)
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glideS)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attackS)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attackS + decayS)
  o.connect(g).connect(bus)
  o.start(t)
  o.stop(t + attackS + decayS + 0.02)
  track(o, g)
  return o
}

/** 滑稽下滑：三角波 880→330Hz，带一点颤音 */
function womp(ctx: AudioContext, bus: AudioNode, t: number): void {
  const o = tone(ctx, bus, t, 'triangle', 880, 330, 0.26, 0.5, 0.012, 0.28)
  const lfo = ctx.createOscillator()
  const depth = ctx.createGain()
  lfo.frequency.value = 9
  depth.gain.value = 16
  lfo.connect(depth).connect(o.frequency)
  lfo.start(t)
  lfo.stop(t + 0.31)
  track(lfo, depth)
}

/** 盖章「嘭」：带通噪声短脉冲 + 140Hz 下坠的低频重音 */
function stamp(ctx: AudioContext, bus: AudioNode, t: number): void {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    const len = Math.ceil(ctx.sampleRate * 0.08)
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  }
  const n = ctx.createBufferSource()
  const bp = ctx.createBiquadFilter()
  const g = ctx.createGain()
  n.buffer = noiseBuf
  bp.type = 'bandpass'
  bp.frequency.value = 1700
  bp.Q.value = 0.9
  g.gain.setValueAtTime(0.42, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
  n.connect(bp).connect(g).connect(bus)
  n.start(t)
  n.stop(t + 0.08)
  track(n, bp, g)
  tone(ctx, bus, t, 'sine', 140, 64, 0.14, 0.5, 0.004, 0.17)
}

/** 收银「叮铃」：E6 → A6 两声，E6 带一点钟铃泛音 */
function ding(ctx: AudioContext, bus: AudioNode, t: number): void {
  tone(ctx, bus, t, 'sine', 1318.51, 1318.51, 0, 0.36, 0.004, 0.62)
  tone(ctx, bus, t, 'sine', 3639, 3639, 0, 0.06, 0.003, 0.16)
  tone(ctx, bus, t + 0.07, 'sine', 1760, 1760, 0, 0.32, 0.004, 0.56)
}

/** 滚数期的硬币轻响 */
function coin(ctx: AudioContext, bus: AudioNode, t: number, hz: number): void {
  tone(ctx, bus, t, 'triangle', hz, hz * 0.94, 0.04, 0.14, 0.002, 0.05)
}

// ---- 损坏共享电车头顶的「故障」小牌 ------------------------------------------------------------------
// 一张共享 CanvasTexture + 一份共享 SpriteMaterial：零动态光、零每帧分配。墨青底、朱砂外框、宣纸发丝内框、
// 白字「故障」，底边一枚朱砂小尖指向车身。精灵底边对齐锚点，默认浮在挂载点上方 0.9m。

/** 小牌底边离挂载点的默认高度（m） */
export const DAMAGED_BIKE_SIGN_LIFT = 0.9
const SIGN_PX_W = 256
const SIGN_PX_H = 144
const SIGN_BODY_H = 118
const SIGN_WORLD_W = 0.64

let signMaterial: THREE.SpriteMaterial | null = null

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

function paintDamagedSign(g: CanvasRenderingContext2D): void {
  const W = SIGN_PX_W
  const H = SIGN_BODY_H
  g.clearRect(0, 0, SIGN_PX_W, SIGN_PX_H)
  // 朱砂小尖：指向下方的车
  g.fillStyle = '#d0694c'
  g.beginPath()
  g.moveTo(W / 2 - 15, H - 4)
  g.lineTo(W / 2 + 15, H - 4)
  g.lineTo(W / 2, SIGN_PX_H - 4)
  g.closePath()
  g.fill()
  // 牌身：墨青纸 + 朱砂外框
  roundRectPath(g, 5, 5, W - 10, H - 10, 12)
  g.fillStyle = '#16211e'
  g.fill()
  g.lineWidth = 6
  g.strokeStyle = '#d0694c'
  g.stroke()
  // 宣纸发丝内框（印框）
  roundRectPath(g, 17, 17, W - 34, H - 34, 4)
  g.lineWidth = 1.5
  g.strokeStyle = 'rgba(244,239,226,.5)'
  g.stroke()
  // 「故障」
  g.fillStyle = '#f4efe2'
  g.font = '700 52px "Noto Serif SC","Source Han Serif SC","Songti SC","STSong",serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('故', W / 2 - 31, H / 2 + 2)
  g.fillText('障', W / 2 + 31, H / 2 + 2)
}

function damagedSignMaterial(): THREE.SpriteMaterial {
  if (signMaterial) return signMaterial
  const canvas = document.createElement('canvas')
  canvas.width = SIGN_PX_W
  canvas.height = SIGN_PX_H
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  const g = canvas.getContext('2d')
  if (g) {
    paintDamagedSign(g)
    // 衬线字晚到时补画一次（仅一次，非每帧）
    if (document.fonts?.status !== 'loaded') {
      document.fonts?.ready
        .then(() => {
          paintDamagedSign(g)
          tex.needsUpdate = true
        })
        .catch(() => {})
    }
  }
  signMaterial = new THREE.SpriteMaterial({map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false})
  return signMaterial
}

/**
 * 损坏共享电车头顶的「故障」小牌。挂到车的根节点上即可：精灵底边（朱砂小尖）浮在挂载点上方 `lift` 米。
 * 材质与贴图全局共享——移除精灵时只需 `remove()`，不要 dispose 它的 material / map。
 */
export function createDamagedBikeSignSprite(lift: number = DAMAGED_BIKE_SIGN_LIFT): THREE.Sprite {
  const sprite = new THREE.Sprite(damagedSignMaterial())
  sprite.name = 'shared-ebike-damaged-sign'
  sprite.center.set(0.5, 0)
  sprite.scale.set(SIGN_WORLD_W, (SIGN_WORLD_W * SIGN_PX_H) / SIGN_PX_W, 1)
  sprite.position.set(0, lift, 0)
  sprite.renderOrder = 2
  // 纯展示：不参与拾取（Sprite.raycast 需要 raycaster.camera，交互射线不该被它挡）
  sprite.raycast = () => {}
  sprite.userData.sharedMaterial = true
  return sprite
}
