/**
 * 一支烟的生命周期（纯状态机）。
 *
 * 三个阶段：取烟（draw）→ 打火机点火（light）→ 点着（smoking）。
 * 点着之后每帧按 BURN_TOTAL 匀速烧（1 秒 1 秒），每「吸」一口立刻扣 PUFF_COST 秒，
 * 所以：
 *   · 一直不吸 → 大约 180 秒烧完（冒小烟）；
 *   · 吸一口 → 少 15 秒，烟身立刻短一截，烟头冒大烟；
 *   · 吸到 0 → 烧完，烟头掉地上（由上层负责扔烟蒂）。
 *
 * 这里不碰 three.js，只产出「怎么画」的 SmokeView，动画层照它摆姿势 / 放道具。
 */

import {BRANDS, BURN_TOTAL, PUFF_COST, PUFF_GAP, type BrandId} from './data.ts'

/** 网络上报的品牌序号 ↔ BrandId */
export const BRAND_ORDER: BrandId[] = BRANDS.map(brand => brand.id)
export function brandIndex(brand: BrandId): number {
  const at = BRAND_ORDER.indexOf(brand)
  return at < 0 ? 0 : at
}

/** 阶段。'puff' 不是一个独立阶段，是 smoking 期间的一次吸动作，用 puff 权重表示。 */
export type SmokePhase = 'idle' | 'draw' | 'ready' | 'light' | 'smoking'

export interface SmokeView {
  phase: SmokePhase
  /** 手臂抬起程度 0..1（0 = 手放下去） */
  hold: number
  /** 左手举着烟盒的权重 0..1：只从「取烟」到「点着」这一小段是 1，之后烟盒收回兜里 */
  carry: number
  /** 点烟动作权重 0..1（右手举打火机） */
  light: number
  /** 这一次「吸」的 0..1 进度（不在吸 = 0） */
  puff: number
  /** 火星可见度 0..1 */
  ember: number
  /** 剩余可燃秒数 0..180 */
  burn: number
  /** 烟身剩余比例 0..1（1 = 全长，0 = 只剩过滤嘴） */
  length: number
  /** 打火机火焰强度 0..1 */
  flame: number
  /** 已经吸了几口 */
  puffs: number
  /** 手上的品牌（给道具换皮用） */
  brand: BrandId
  /** 是不是已经开始冒烟了 */
  lit: boolean
  /** 手里有没有烟（取出来了但还没点着也要显示） */
  cig: number
}

/** 取烟：抬左手 + 右手伸到烟盒上 */
const DRAW_TIME = 0.55
/** 点烟：打火机凑上去、擦火、点着 */
const LIGHT_TIME = 0.9
/** 点着发生在 light 阶段的这个位置（火焰最强的时候） */
const IGNITE_AT = 0.62
/** 一次「吸」的时长 */
const PUFF_TIME = 2.2

export const SMOKE_TIMING = {DRAW_TIME, LIGHT_TIME, IGNITE_AT, PUFF_TIME} as const

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function smooth(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

/** 打火机火焰包络：擦火前不亮，擦着之后猛一下，最后收掉 */
export function flameEnvelope(u: number): number {
  if (u < 0.3) return 0
  if (u < 0.38) return smooth((u - 0.3) / 0.08)
  if (u < 0.84) return 1
  return 1 - smooth((u - 0.84) / 0.16)
}

export class SmokeSession {
  phase: SmokePhase = 'idle'
  brand: BrandId = 'plain'
  /** 正在抽的是哪一包（上层用来回写香烟数） */
  packId: string | null = null
  burn = 0
  puffs = 0
  /** 这一次刚烧完（上层据此扔烟蒂、提示） */
  finished = false
  /** 这一次刚点着（上层据此播打火机音效 / 提示） */
  ignited = false

  private elapsed = 0
  private puffElapsed = -1
  /** 已经点着过（不能每帧都触发「刚点着」）：之前每帧重置 ignited，导致点烟那 0.2 秒里连扣十几根 */
  private ignitedOnce = false
  /** 距离上一口过了多少秒（两口之间至少要 PUFF_GAP） */
  private sincePuff = PUFF_GAP

  get active() {
    return this.phase !== 'idle'
  }

  get lit() {
    return this.phase === 'smoking'
  }

  /** 正在做「吸一口」的动作（这段时间内再按不算） */
  get puffing() {
    return this.puffElapsed >= 0
  }

  /** 烟身剩余比例 0..1（UI 上那条进度条） */
  get length() {
    return clamp01(this.burn / BURN_TOTAL)
  }

  /** 开始一次新的「取烟 → 点烟」。会重置整支烟。 */
  start(brand: BrandId, packId: string) {
    this.phase = 'draw'
    this.brand = brand
    this.packId = packId
    this.elapsed = 0
    this.puffElapsed = -1
    this.ignitedOnce = false
    this.sincePuff = PUFF_GAP
    this.burn = BURN_TOTAL
    this.puffs = 0
    this.finished = false
    this.ignited = false
  }

  /** 立刻结束（掐灭 / 离开步行模式），不产生烟蒂 */
  stop() {
    this.phase = 'idle'
    this.packId = null
    this.burn = 0
    this.puffs = 0
    this.elapsed = 0
    this.puffElapsed = -1
    this.ignitedOnce = false
    this.sincePuff = PUFF_GAP
    this.finished = false
    this.ignited = false
  }

  /**
   * 吸一口。只有已经点着、并且没有正在吸的时候才生效。
   * 返回 false 表示这一下没吸（上层可以给个提示）。
   */
  /** 点火（取出烟之后需要再来一下） */
  light(): boolean {
    if (this.phase !== 'ready') return false
    this.phase = 'light'
    this.elapsed = 0
    return true
  }

  /** 手里拿着没点着的烟 */
  get ready() {
    return this.phase === 'ready'
  }

  /** 还要等几秒才能吸下一口（0 = 现在就能吸） */
  get puffReadyIn() {
    return Math.max(0, Math.ceil(PUFF_GAP - this.sincePuff))
  }

  puff(): boolean {
    if (this.phase !== 'smoking' || this.puffElapsed >= 0) return false
    if (this.sincePuff < PUFF_GAP) return false
    this.puffElapsed = 0
    this.sincePuff = 0
    this.puffs++
    this.burn = Math.max(0, this.burn - PUFF_COST)
    return true
  }

  /** 推进 dt 秒。返回本帧结束的这支烟「是否刚刚烧完」。 */
  advance(dt: number): boolean {
    this.finished = false
    this.ignited = false
    if (this.phase === 'idle') return false
    const step = Math.min(0.25, Math.max(0, dt))
    this.elapsed += step
    if (this.phase === 'draw') {
      if (this.elapsed >= DRAW_TIME) {
        // 取出来先叼/夹在手上，等玩家再按一次才点火
        this.phase = 'ready'
        this.elapsed = 0
      }
      return false
    }
    if (this.phase === 'ready') return false
    if (this.phase === 'light') {
      const u = this.elapsed / LIGHT_TIME
      if (!this.ignitedOnce && u >= IGNITE_AT) {
        this.ignitedOnce = true
        this.ignited = true
      }
      if (this.elapsed >= LIGHT_TIME) {
        this.phase = 'smoking'
        this.elapsed = 0
      }
      return false
    }
    // smoking
    this.sincePuff = Math.min(999, this.sincePuff + step)
    this.burn = Math.max(0, this.burn - step)
    if (this.puffElapsed >= 0) {
      this.puffElapsed += step
      if (this.puffElapsed >= PUFF_TIME) this.puffElapsed = -1
    }
    if (this.burn <= 0) {
      this.phase = 'idle'
      this.packId = null
      this.puffElapsed = -1
      this.finished = true
      return true
    }
    return false
  }

  view(): SmokeView {
    const phase = this.phase
    const u = phase === 'light' ? this.elapsed / LIGHT_TIME : 0
    const puff = this.puffElapsed >= 0 ? Math.sin(clamp01(this.puffElapsed / PUFF_TIME) * Math.PI) : 0
    return {
      phase,
      hold: phase === 'idle' ? 0 : 1,
      // 烟盒：取烟阶段满举；点着之后（IGNITE_AT 之后）慢慢收回兜里
      carry: phase === 'draw' ? 1 : phase === 'light' ? 1 - smooth((u - IGNITE_AT) / 0.34) : 0,
      light: phase === 'light' ? smooth(u / 0.3) * (1 - smooth((u - 0.9) / 0.1)) : 0,
      puff,
      ember: phase === 'smoking' ? 1 : phase === 'light' ? smooth((u - IGNITE_AT) / 0.18) : 0,
      burn: this.burn,
      length: clamp01(this.burn / BURN_TOTAL),
      flame: phase === 'light' ? flameEnvelope(u) * (1 - 0.35 * Math.abs(Math.sin(u * 47))) : 0,
      puffs: this.puffs,
      brand: this.brand,
      lit: phase === 'smoking',
      cig: phase === 'idle' ? 0 : 1,
    }
  }
}

/**
 * 别人的烟：只从网络上收 (sc, sb, sp, sbr) 四个数，整流成同一套 SmokeView。
 *   sc  = 0 没抽 / 1 正在点烟 / 2 已经点着
 *   sb  = 剩余可燃时间 × 10（整数）
 *   sp  = 吸了几口的累计计数（换值就说明刚吸了一口）
 *   sbr = 品牌序号（决定烟盒画成哪一款）
 *
 * 剩余时间直接用远端上报值——对方 10 Hz 上报，一次跳 0.1 秒，
 * 相对 180 秒的总长度看不出来，所以不必在本地自己往下烧（那会和网络时钟慢慢错开）。
 */
export class RemoteSmoke {
  private state = 0
  private puffSeq = 0
  private lastPuffSeq = 0
  private puffElapsed = -1
  private brand: BrandId = 'plain'
  private burn = 0

  get active() {
    return this.state !== 0
  }

  setBrand(brand: BrandId) {
    this.brand = brand
  }

  update(sc: number, sb: number, sp: number, sbr: number, dt: number) {
    const nextState = Number.isFinite(sc) ? Math.max(0, Math.min(2, Math.round(sc))) : 0
    if (nextState === 0 && this.state !== 0) this.puffElapsed = -1
    this.state = nextState
    if (Number.isFinite(sb)) this.burn = Math.max(0, Math.min(BURN_TOTAL * 10, Math.round(sb))) / 10
    if (Number.isFinite(sbr)) {
      const index = Math.max(0, Math.min(BRAND_ORDER.length - 1, Math.round(sbr)))
      this.brand = BRAND_ORDER[index]
    }
    const seq = Number.isFinite(sp) ? Math.max(0, Math.round(sp)) : 0
    if (seq !== this.lastPuffSeq) {
      // 计数变小只可能是对方重开了一根，不放烟
      if (seq > this.lastPuffSeq) this.puffElapsed = 0
      this.lastPuffSeq = seq
      this.puffSeq = seq
    }
    if (this.puffElapsed >= 0) {
      this.puffElapsed += Math.min(0.25, Math.max(0, dt))
      if (this.puffElapsed >= PUFF_TIME) this.puffElapsed = -1
    }
  }

  view(): SmokeView {
    const phase: SmokePhase = this.state === 0 ? 'idle' : this.state === 1 ? 'light' : 'smoking'
    const puff = this.puffElapsed >= 0 ? Math.sin(clamp01(this.puffElapsed / PUFF_TIME) * Math.PI) : 0
    return {
      phase,
      hold: phase === 'idle' ? 0 : 1,
      carry: phase === 'light' ? 1 : 0,
      light: phase === 'light' ? 1 : 0,
      puff,
      ember: phase === 'smoking' ? 1 : 0,
      burn: this.burn,
      length: clamp01(this.burn / BURN_TOTAL),
      flame: phase === 'light' ? 0.9 : 0,
      puffs: this.puffSeq,
      brand: this.brand,
      lit: phase === 'smoking',
      cig: phase === 'idle' ? 0 : 1,
    }
  }
}

/** 空视图：不在抽时的默认值，避免到处写 null 判断 */
export const IDLE_VIEW: SmokeView = {
  phase: 'idle',
  hold: 0,
  carry: 0,
  light: 0,
  puff: 0,
  ember: 0,
  burn: 0,
  length: 0,
  flame: 0,
  puffs: 0,
  brand: 'plain',
  lit: false,
  cig: 0,
}
