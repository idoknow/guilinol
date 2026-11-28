/**
 * IDOK-541 解放桥剧情执勤：车头正前方拦车几何 + 逃逸事件总线 + 逃逸气泡文案（`web/src/traffic-duty/jiefang-escape.ts`）。
 *
 * 纯逻辑模块：导入期零副作用，不依赖 DOM / three / input-mode，可在 Node 单测中直接打包运行。
 *
 * - 剧情模式信号：`controller` 只能通过 `main.ts` 既有的 `DutyTrafficBridge` 子集与 `duty-traffic` 通信，
 *   因此用模块级轻量信号 `requestJiefangStoryMode()` / `acknowledgeJiefangStoryMode()` 握手：
 *   controller 请求 → duty-traffic 在真实桥面 deckOnly 车流上落地剧情覆盖后回执 → 双方都为真才启用正面拦车几何。
 *   单测里的 mock bridge 永远不会回执，因此旧用例零回归。
 * - 逃逸总线：`subscribeDutyEscape()` / `tryEmitDutyEscape()`，统一做“单车 6s 冷却 + 全局 0.3s 节流”。
 * - 几何：`classifyInterceptAspect()` 以车头朝向（逆行自动取反向）判定玩家处于车头正前方 / 侧面 / 车尾。
 * - 文案：`formatEscapeVow()` 把违章列表合成为“下次一定……”的嘴硬承诺。
 */

import type {Actor, Position} from '../traffic/sim.ts'
import {VIOLATION_LABELS, isActiveViolation, resolveActorViolations, type ActiveViolation} from './types.ts'

// ─── 关键参数 ────────────────────────────────────────────────────────────────

/** 车头正前方扇区半角（度）：玩家位于车头朝向 ±50° 内且在车头前方，视为正面拦车。 */
export const JIEFANG_FRONT_SECTOR_HALF_ANGLE_DEG = 50
/** 正面拦车最小前向距离（米）：贴着车身侧面不算“站在车头前”。 */
export const JIEFANG_FRONT_MIN_AHEAD_M = 0.4
/** 正面拦车横向宽容（米）：玩家几乎正对车道中线时，即使夹角略大也算正面。 */
export const JIEFANG_FRONT_LATERAL_TOLERANCE_M = 1.0
/** 车尾扇区起始角（度）：与车头朝向夹角 ≥120° 视为从车尾追拦。 */
export const JIEFANG_REAR_SECTOR_MIN_ANGLE_DEG = 120
/** 从侧面拦车时违规车加速跑路的概率。 */
export const JIEFANG_SIDE_FLEE_PROB = 0.8
/** 从车尾拦车时违规车加速跑路的概率。 */
export const JIEFANG_REAR_FLEE_PROB = 0.85
/** 正面吹哨（Q）违规车停车靠边的概率（未停则明显减速）。 */
export const JIEFANG_FRONT_WHISTLE_STOP_PROB = 0.85
/** 逃逸加速持续时间（秒，sim 时间）。 */
export const JIEFANG_ESCAPE_FLEE_SEC = 6.5
/** 逃逸横向避让一次的偏移量（米），与 sim 原有 0.45 保持一致。 */
export const JIEFANG_ESCAPE_DODGE_STEP_M = 0.45
/** 解放桥非机动车道横向 dodge 上限（米），与 sim 内 `gradeSeparated==='jiefang'` 的 0.6 保持一致。 */
export const JIEFANG_ESCAPE_DODGE_LIMIT_M = 0.6
/** 同一辆车两次逃逸气泡最小间隔（秒）。 */
export const ESCAPE_ACTOR_COOLDOWN_SEC = 6
/** 全局逃逸气泡节流（秒）。 */
export const ESCAPE_GLOBAL_THROTTLE_SEC = 0.3
/** 同屏逃逸气泡上限：桌面 3 / 手机 2。 */
export const ESCAPE_BUBBLE_MAX_DESKTOP = 3
export const ESCAPE_BUBBLE_MAX_MOBILE = 2
/** 逃逸气泡停留时长（秒）。 */
export const ESCAPE_BUBBLE_DURATION_SEC = 2.4
/** 被动逃逸（sim 4–15m 发现带）在节流时最多补发的窗口（秒）。 */
export const ESCAPE_PASSIVE_RETRY_WINDOW_SEC = 1.5

// ─── 剧情模式握手 ────────────────────────────────────────────────────────────

const storyMode = {requested: false, acknowledged: false, version: 0}

/** controller：进入 / 退出解放桥剧情执勤时调用（幂等）。 */
export function requestJiefangStoryMode(on: boolean): void {
  const next = Boolean(on)
  if (storyMode.requested === next) return
  storyMode.requested = next
  if (!next) storyMode.acknowledged = false
  storyMode.version++
}

export function isJiefangStoryModeRequested(): boolean {
  return storyMode.requested
}

/** duty-traffic：真正把剧情覆盖落到桥面车流（或撤销）后回执。 */
export function acknowledgeJiefangStoryMode(on: boolean): void {
  storyMode.acknowledged = Boolean(on) && storyMode.requested
}

/** 请求与回执同时成立才视为剧情模式生效（正面拦车几何、逃逸气泡均以此为闸）。 */
export function isJiefangStoryModeActive(): boolean {
  return storyMode.requested && storyMode.acknowledged
}

/** 每次请求状态翻转自增，duty-traffic 轮询比较即可得知需要重新落地/撤销覆盖。 */
export function getJiefangStoryModeVersion(): number {
  return storyMode.version
}

/** 单测专用：重置握手与节流状态。 */
export function resetJiefangEscapeStateForTests(): void {
  storyMode.requested = false
  storyMode.acknowledged = false
  storyMode.version++
  escapeListeners.clear()
  lastGlobalEmitAt = -Infinity
  actorLastEmitAt = new WeakMap()
  escapeMarks = new WeakMap()
  escapeClock = defaultClock
}

// ─── 时钟（可在单测里替换） ───────────────────────────────────────────────────

function defaultClock(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() / 1000
  }
  return Date.now() / 1000
}

let escapeClock: () => number = defaultClock

export function setEscapeClock(clock: (() => number) | null): void {
  escapeClock = clock ?? defaultClock
}

export function getEscapeClockSec(): number {
  return escapeClock()
}

// ─── 几何：车头正前方 / 侧面 / 车尾 ─────────────────────────────────────────

export type InterceptAspect = 'front' | 'side' | 'rear'

export interface InterceptGeometry {
  readonly aspect: InterceptAspect
  /** 玩家相对车头朝向的前向距离（米，正为车头前方）。 */
  readonly aheadM: number
  /** 玩家相对车头朝向的横向距离（米，绝对值）。 */
  readonly lateralM: number
  /** 与车头朝向夹角（度）。 */
  readonly angleDeg: number
  readonly distM: number
}

type HeadingSource = Pick<Actor, 'x' | 'z' | 'yaw'> & {
  track?: {dx: number; dz: number} | null
  wrongWay?: boolean
}

/** 车头朝向单位向量：优先用车道方向（逆行取反），否则用 yaw（sim 约定 dir=(sin yaw, cos yaw)）。 */
export function resolveActorHeading(actor: HeadingSource): {x: number; z: number} {
  const t = actor.track
  if (t && Number.isFinite(t.dx) && Number.isFinite(t.dz) && Math.hypot(t.dx, t.dz) > 1e-6) {
    const len = Math.hypot(t.dx, t.dz)
    const s = actor.wrongWay ? -1 : 1
    return {x: (s * t.dx) / len, z: (s * t.dz) / len}
  }
  const yaw = Number.isFinite(actor.yaw) ? actor.yaw : 0
  return {x: Math.sin(yaw), z: Math.cos(yaw)}
}

export function isActorStoppedOrTicketing(actor: Actor): boolean {
  return (
    actor.speed <= 0.35 ||
    Boolean(actor.haltedByDuty) ||
    actor.dutyState === 'halted' ||
    actor.dutyState === 'pulled_over' ||
    actor.dutyState === 'pulling_over' ||
    Boolean(actor.cited) ||
    Boolean(actor.ticketReceived)
  )
}

export function measureInterceptGeometry(
  actor: HeadingSource,
  playerPos: Pick<Position, 'x' | 'z'>,
): InterceptGeometry {
  if (
    !Number.isFinite(actor.x) ||
    !Number.isFinite(actor.z) ||
    !Number.isFinite(playerPos.x) ||
    !Number.isFinite(playerPos.z)
  ) {
    return {aspect: 'side', aheadM: 0, lateralM: 0, angleDeg: 90, distM: 0}
  }
  const dir = resolveActorHeading(actor)
  const vx = playerPos.x - actor.x
  const vz = playerPos.z - actor.z
  const distM = Math.hypot(vx, vz)
  const aheadM = vx * dir.x + vz * dir.z
  const lateralM = Math.abs(vx * dir.z - vz * dir.x)
  if (distM < 0.35) {
    return {aspect: 'front', aheadM, lateralM, angleDeg: 0, distM}
  }
  const cosA = Math.max(-1, Math.min(1, aheadM / distM))
  const angleDeg = (Math.acos(cosA) * 180) / Math.PI
  let aspect: InterceptAspect
  if (
    aheadM >= JIEFANG_FRONT_MIN_AHEAD_M &&
    (angleDeg <= JIEFANG_FRONT_SECTOR_HALF_ANGLE_DEG || lateralM < JIEFANG_FRONT_LATERAL_TOLERANCE_M)
  ) {
    aspect = 'front'
  } else if (angleDeg >= JIEFANG_REAR_SECTOR_MIN_ANGLE_DEG) {
    aspect = 'rear'
  } else {
    aspect = 'side'
  }
  return {aspect, aheadM, lateralM, angleDeg, distM}
}

export function classifyInterceptAspect(actor: HeadingSource, playerPos: Pick<Position, 'x' | 'z'>): InterceptAspect {
  return measureInterceptGeometry(actor, playerPos).aspect
}

/** 侧面 0.80 / 车尾 0.85 / 正面 0。 */
export function escapeFleeProbability(aspect: InterceptAspect): number {
  if (aspect === 'rear') return JIEFANG_REAR_FLEE_PROB
  if (aspect === 'side') return JIEFANG_SIDE_FLEE_PROB
  return 0
}

// ─── 逃逸动作（只改 actor 字段，不触碰 sim 内部） ─────────────────────────────

/**
 * 让违规车加速跑路：进入 `fleeing`、设置 `fleeUntil`，并在**车道坐标系**内朝远离执勤者一侧横移
 * （车道法线 n=(-dz,dx) 与逆行无关，因此天然修正了按车头坐标系计算时逆行车反向贴近执勤者的问题）。
 * 横移限幅 ±0.6m；最终位置仍由 `constrainJiefangActorPosition` 夹回非机动车道 / 人行道安全带。
 */
export function applyEscapeImpulse(
  actor: Actor,
  opts: {simTime: number; officer?: Pick<Position, 'x' | 'z'> | null; fleeSec?: number},
): void {
  const simTime = Number.isFinite(opts.simTime) ? opts.simTime : 0
  actor.dutyState = 'fleeing'
  actor.haltedByDuty = false
  actor.stoppedUntil = undefined
  actor.holdUntil = undefined
  actor.whistleSlowUntil = undefined
  actor.brakingForOfficer = false
  actor.lookAtOfficer = false
  actor.blinker = 'none'
  actor.pullOverTargetDodge = undefined
  actor.pullOverTargetLocalZ = undefined
  actor.pullOverNotified = false
  actor.fleeUntil = simTime + Math.max(1, opts.fleeSec ?? JIEFANG_ESCAPE_FLEE_SEC)
  if (opts.officer && actor.track) {
    actor.dodge = computeEscapeDodge(actor, opts.officer)
  }
}

/**
 * 车道坐标系下远离执勤者的 dodge 目标值（解放桥限幅 ±0.6m，其余道路 ±0.85m，与 sim 一致）。
 * 车道法线 n=(-dz,dx) 只取决于车道方向，因此顺行 / 逆行都朝远离执勤者一侧横移。
 */
export function computeEscapeDodge(
  actor: Pick<Actor, 'x' | 'z' | 'dodge'> & {track: {dx: number; dz: number; gradeSeparated?: string}},
  officer: Pick<Position, 'x' | 'z'>,
  prevDodge: number = actor.dodge,
  limitM: number = actor.track.gradeSeparated === 'jiefang' ? JIEFANG_ESCAPE_DODGE_LIMIT_M : 0.85,
): number {
  const nx = -actor.track.dz
  const nz = actor.track.dx
  const side = (officer.x - actor.x) * nx + (officer.z - actor.z) * nz
  const base = Number.isFinite(prevDodge) ? prevDodge : 0
  const safeSide = Number.isFinite(side) && side !== 0 ? Math.sign(side) : 1
  const next = base - safeSide * JIEFANG_ESCAPE_DODGE_STEP_M
  const limit = Number.isFinite(limitM) ? Math.max(0, limitM) : JIEFANG_ESCAPE_DODGE_LIMIT_M
  return Math.max(-limit, Math.min(limit, next))
}

// ─── 逃逸事件总线 + 节流 ──────────────────────────────────────────────────────

export type DutyEscapeCause = 'spotted' | 'whistle' | 'flag' | 'intercept'

export interface DutyEscapeEvent {
  readonly actor: Actor
  readonly actorId: string
  readonly violations: readonly ActiveViolation[]
  readonly cause: DutyEscapeCause
  readonly aspect: InterceptAspect
  readonly x: number
  readonly y: number
  readonly z: number
  /** 逃逸时钟（秒，`getEscapeClockSec()`）。 */
  readonly time: number
  readonly shout: string
  readonly vow: string
}

export type DutyEscapeListener = (event: DutyEscapeEvent) => void

export type EscapeThrottleVerdict = 'ok' | 'actor_cooldown' | 'global_throttle'

const escapeListeners = new Set<DutyEscapeListener>()
let lastGlobalEmitAt = -Infinity
let actorLastEmitAt = new WeakMap<Actor, number>()
let escapeMarks = new WeakMap<Actor, {cause: DutyEscapeCause; aspect: InterceptAspect; at: number}>()
let escapeIdSeq = 0

export function subscribeDutyEscape(listener: DutyEscapeListener): () => void {
  escapeListeners.add(listener)
  return () => {
    escapeListeners.delete(listener)
  }
}

export function hasDutyEscapeListeners(): boolean {
  return escapeListeners.size > 0
}

export function checkEscapeThrottle(actor: Actor, now = escapeClock()): EscapeThrottleVerdict {
  const last = actorLastEmitAt.get(actor)
  if (last !== undefined && now - last < ESCAPE_ACTOR_COOLDOWN_SEC) return 'actor_cooldown'
  if (now - lastGlobalEmitAt < ESCAPE_GLOBAL_THROTTLE_SEC) return 'global_throttle'
  return 'ok'
}

/** 记录“这次跑路是谁触发的”，供 duty-traffic 状态监听在补发时沿用正确的 cause / aspect。 */
export function markEscapeCause(actor: Actor, cause: DutyEscapeCause, aspect: InterceptAspect): void {
  escapeMarks.set(actor, {cause, aspect, at: escapeClock()})
}

export function peekEscapeMark(
  actor: Actor,
  maxAgeSec = ESCAPE_PASSIVE_RETRY_WINDOW_SEC,
): {cause: DutyEscapeCause; aspect: InterceptAspect} | null {
  const mark = escapeMarks.get(actor)
  if (!mark) return null
  if (escapeClock() - mark.at > maxAgeSec) return null
  return {cause: mark.cause, aspect: mark.aspect}
}

function actorKey(actor: Actor): string {
  if (actor.id) return actor.id
  escapeIdSeq++
  return `escape-${escapeIdSeq}`
}

/**
 * 通过节流后向所有订阅者派发逃逸事件；被节流返回 `{event: null, verdict}`。
 * 物理上的“跑路”不受节流影响，节流只约束气泡/事件频率。
 */
export function tryEmitDutyEscape(input: {
  actor: Actor
  cause: DutyEscapeCause
  aspect: InterceptAspect
  violations?: readonly ActiveViolation[]
}): {event: DutyEscapeEvent | null; verdict: EscapeThrottleVerdict} {
  const now = escapeClock()
  const verdict = checkEscapeThrottle(input.actor, now)
  if (verdict !== 'ok') return {event: null, verdict}
  const violations =
    input.violations && input.violations.length > 0
      ? input.violations.filter(isActiveViolation)
      : resolveActorViolations(input.actor)
  const actor = input.actor
  const event: DutyEscapeEvent = {
    actor,
    actorId: actorKey(actor),
    violations,
    cause: input.cause,
    aspect: input.aspect,
    x: actor.x,
    y: actor.y,
    z: actor.z,
    time: now,
    shout: ESCAPE_SHOUT,
    vow: formatEscapeVow(violations),
  }
  actorLastEmitAt.set(actor, now)
  lastGlobalEmitAt = now
  for (const listener of [...escapeListeners]) {
    try {
      listener(event)
    } catch {
      // 订阅方异常不影响其他订阅者与车流
    }
  }
  return {event, verdict}
}

// ─── 逃逸气泡文案 ────────────────────────────────────────────────────────────

export const ESCAPE_SHOUT = '走咯！'
const VOW_PREFIX = '下次一定'

export const ESCAPE_VOW_BY_VIOLATION: Readonly<Record<ActiveViolation, string>> = Object.freeze({
  no_helmet: '下次一定戴头盔',
  wrong_way: '下次一定不逆行',
  sidewalk_riding: '下次一定不走人行道',
  bike_double: '下次一定不双载',
  ebike_overload: '下次一定不超载',
  illegal_mod: '下次一定不乱改',
  red_light_run: '下次一定不闯灯',
})

function vowTail(v: ActiveViolation): string {
  const full = ESCAPE_VOW_BY_VIOLATION[v]
  return full.startsWith(VOW_PREFIX) ? full.slice(VOW_PREFIX.length) : full
}

/**
 * - 1 项：`下次一定带头盔！`
 * - 2 项：`下次一定带头盔，也不走人行道！`
 * - ≥3 项：`下次一定带头盔、不走人行道……都改！`
 */
export function formatEscapeVow(violations: readonly (ActiveViolation | string | null | undefined)[] | null | undefined): string {
  const list: ActiveViolation[] = []
  for (const v of violations ?? []) {
    if (isActiveViolation(v) && !list.includes(v)) list.push(v)
  }
  if (list.length === 0) return `${VOW_PREFIX}好好骑！`
  if (list.length === 1) return `${ESCAPE_VOW_BY_VIOLATION[list[0]]}！`
  if (list.length === 2) return `${ESCAPE_VOW_BY_VIOLATION[list[0]]}，也${vowTail(list[1])}！`
  return `${ESCAPE_VOW_BY_VIOLATION[list[0]]}、${vowTail(list[1])}……都改！`
}

/** 无障碍朗读用的完整句（`aria-label`）。 */
export function formatEscapeAriaLabel(violations: readonly ActiveViolation[]): string {
  const labels = violations.filter(isActiveViolation).map(v => VIOLATION_LABELS[v])
  const what = labels.length > 0 ? `（${labels.join('、')}）` : ''
  return `违规车加速逃离${what}：${ESCAPE_SHOUT}${formatEscapeVow(violations)}`
}

/** 同屏逃逸气泡上限。 */
export function resolveEscapeBubbleCap(mobile: boolean): number {
  return mobile ? ESCAPE_BUBBLE_MAX_MOBILE : ESCAPE_BUBBLE_MAX_DESKTOP
}
