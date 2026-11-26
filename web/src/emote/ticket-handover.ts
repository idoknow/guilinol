// r8-3 递交罚单身体动作：扯单 → 转身半步伸手 → 塞进对方手里 → 收回。
//
// 这是一个「程序化叠加层」，不是烘焙好的 AnimationClip：目标点（违规人员的手）每次都不一样，
// 所以每帧在世界空间里现算——脊柱扭转/前倾、骨盆前送下沉（弓步）、两骨骼腿 IK（后脚钉地、前脚迈半步）、
// 两骨骼手臂 IK（握点精确送到目标）、头看向目标。
//
// 用法与 playback.ts 的表情层一致：
//   每帧开头 handover.reset()（把上一帧叠加的骨骼还原），
//   locomotion / 表情层跑完之后 handover.tick(dt)。
// 所有骨骼按名字找（pelvis / spine_0x / upperarm_x …），和 figure.glb、figure_m、figure_f 三套骨架通用；
// 方向全部从骨骼本身推（左右肩连线 = 角色左，左 × 上 = 角色前），不依赖 figure 根节点朝向约定。
import * as T from 'three'

export type TicketHandoverSide = 'left' | 'right'
export type TicketHandoverPhase = 'idle' | 'tear' | 'reach' | 'hold' | 'retract'
export interface Vec3Like {
  x: number
  y: number
  z: number
}
type PointSource = Vec3Like | (() => Vec3Like | null | undefined)

export interface TicketHandoverOptions {
  /** 对方手（罚单要塞进去的位置），世界坐标；传函数可以每帧跟踪移动中的手骨。 */
  targetWorldPos: PointSource
  /** 用哪只手递；默认 'auto'＝就近原则（哪边肩膀离目标近用哪只手）。 */
  side?: TicketHandoverSide | 'auto'
  /** 腰挂打印机出纸口的世界坐标；不传就按右胯前方估算。 */
  printerWorldPos?: PointSource
  /** 塞到手里后停顿多久（秒），默认 0.5。 */
  holdSec?: number
  /** 凭条从打印机上被扯下的那一刻（Carbon：把凭条从打印机挂到递单手上）。 */
  onTear?: (side: TicketHandoverSide) => void
  /** 凭条塞进对方手里的那一刻（Carbon：把凭条改挂到对方手骨上）。 */
  onDeliver?: (side: TicketHandoverSide) => void
  /** 动作结束；completed=false 表示被 stop() 打断或目标丢失。 */
  onDone?: (completed: boolean) => void
}

export type TicketHandoverReason = 'ok' | 'too_far' | 'behind' | 'too_high' | 'too_low' | 'no_rig' | 'busy'
export interface TicketHandoverCheck {
  ok: boolean
  reason: TicketHandoverReason
  side: TicketHandoverSide
  /** 目标离骨盆的水平距离（m）。 */
  distance: number
  /** 选中那侧肩膀到目标的直线距离（m）。 */
  shoulderDistance: number
  /** 这次动作最远能够到的肩–目标距离（m）。 */
  maxReach: number
}

export interface TicketHandover {
  /** 开始递单；够不到/在身后/没有骨骼时返回 false，什么都不做（Carbon 提示「再靠近点」）。 */
  play(options: TicketHandoverOptions): boolean
  /** 只判断够不够得到、会用哪只手，不播放。 */
  check(targetWorldPos: Vec3Like, side?: TicketHandoverSide | 'auto'): TicketHandoverCheck
  /** 立即打断；骨骼在下一次 reset() 时还原。 */
  stop(): void
  /** 每帧开头调用：把上一帧叠加到骨骼上的改动还原。 */
  reset(): void
  /** locomotion / 表情层之后调用：在当前姿势上叠加递单动作。 */
  tick(dt: number): void
  /** 递单手的握点（掌心）世界坐标，挂凭条用。 */
  gripWorldPosition(side?: TicketHandoverSide, out?: T.Vector3): T.Vector3 | null
  /** 手骨节点（hand_l / hand_r），也可以直接把凭条 attach 上去。 */
  handBone(side?: TicketHandoverSide): T.Object3D | null
  readonly active: boolean
  readonly phase: TicketHandoverPhase
  readonly side: TicketHandoverSide
  readonly elapsed: number
  /** 0..1 全程进度。 */
  readonly progress: number
  readonly duration: number
}

/** 四段时长（秒）。hold 可被 options.holdSec 覆盖。 */
export const TICKET_HANDOVER_TIMING = Object.freeze({tear: 0.55, reach: 0.62, hold: 0.5, retract: 0.5})
/** 出纸口相对打印机中心的偏移（与 duty-props 打印机模型一致：顶部、略朝前）。 */
const SLOT_ABOVE_PRINTER = {up: 0.08, forward: 0.01} as const

export const TICKET_HANDOVER_LIMITS = Object.freeze({
  /** 弓步骨盆最多前送（m）。 */
  maxStep: 0.5,
  /** 上身最多前倾（rad）。 */
  maxLean: 0.6,
  /** 脊柱最多扭转（rad）。 */
  maxTwist: 0.9,
  /** 手骨原点（腕）到掌心握点的距离（m）。 */
  grip: 0.08,
  /** 目标在身后超过这个角度不递（rad，约 130°）。 */
  behind: 2.27,
  /** 目标离脚底的高度范围（m）。 */
  minHeight: 0.35,
  maxHeight: 2.0,
})

const UP = new T.Vector3(0, 1, 0)
const BONES = [
  'pelvis',
  'spine_01',
  'spine_02',
  'spine_03',
  'head',
  'upperarm_l',
  'lowerarm_l',
  'hand_l',
  'upperarm_r',
  'lowerarm_r',
  'hand_r',
  'thigh_l',
  'calf_l',
  'foot_l',
  'thigh_r',
  'calf_r',
  'foot_r',
] as const
type BoneName = (typeof BONES)[number]
type Rig = Record<BoneName, T.Object3D>

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const clamp01 = (v: number) => clamp(v, 0, 1)
const smooth = (v: number) => {
  const x = clamp01(v)
  return x * x * (3 - 2 * x)
}
const easeOut = (v: number) => 1 - (1 - clamp01(v)) ** 3
const sfx = (s: TicketHandoverSide) => (s === 'left' ? 'l' : 'r')

function resolvePoint(src: PointSource | undefined, out: T.Vector3): boolean {
  if (!src) return false
  const p = typeof src === 'function' ? src() : src
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false
  out.set(p.x, p.y, p.z)
  return true
}

// 临时向量池（单线程逐帧调用，避免每帧分配）
const _a = new T.Vector3()
const _b = new T.Vector3()
const _c = new T.Vector3()
const _d = new T.Vector3()
const _e = new T.Vector3()
const _q = new T.Quaternion()
const _q2 = new T.Quaternion()
const _pq = new T.Quaternion()
const _m3 = new T.Matrix3()

function wp(o: T.Object3D, out: T.Vector3) {
  return out.setFromMatrixPosition(o.matrixWorld)
}

/** 在世界空间里把骨骼再转 qW（保持父骨不动）：L' = P⁻¹·qW·P·L。 */
function rotateWorld(bone: T.Object3D, qW: T.Quaternion) {
  if (bone.parent) bone.parent.getWorldQuaternion(_pq)
  else _pq.identity()
  _q2.copy(_pq).invert().multiply(qW).multiply(_pq)
  bone.quaternion.premultiply(_q2)
  bone.updateMatrixWorld(true)
}

/** 把骨骼的世界朝向设成 qW（脚掌放平用）。 */
function setWorldQuat(bone: T.Object3D, qW: T.Quaternion) {
  if (bone.parent) bone.parent.getWorldQuaternion(_pq)
  else _pq.identity()
  bone.quaternion.copy(_pq.invert().multiply(qW))
  bone.updateMatrixWorld(true)
}

/** 世界空间位移 → 骨骼父空间位移。 */
function translateWorld(bone: T.Object3D, offW: T.Vector3) {
  const local = _e.copy(offW)
  if (bone.parent) local.applyMatrix3(_m3.setFromMatrix4(bone.parent.matrixWorld).invert())
  bone.position.add(local)
  bone.updateMatrixWorld(true)
}

/**
 * 两骨骼 IK：让 c 的原点（腕/踝）落到 goal。pole 决定肘/膝朝向；poleW=0 时沿用当前弯曲平面，
 * 这样权重从 0 渐入不会让肘部突然翻面。
 */
function solveTwoBone(a: T.Object3D, b: T.Object3D, c: T.Object3D, goal: T.Vector3, pole: T.Vector3, poleW: number) {
  const A = wp(a, new T.Vector3())
  const B = wp(b, new T.Vector3())
  const C = wp(c, new T.Vector3())
  const la = B.distanceTo(A)
  const lb = C.distanceTo(B)
  const r = new T.Vector3().subVectors(goal, A)
  const dist = clamp(r.length(), Math.abs(la - lb) + 0.01, la + lb - 0.003)
  if (r.lengthSq() < 1e-10) return
  r.normalize()
  const cur = new T.Vector3().subVectors(B, A)
  cur.addScaledVector(r, -cur.dot(r))
  const des = pole.clone().addScaledVector(r, -pole.dot(r))
  if (cur.lengthSq() > 1e-8) cur.normalize()
  if (des.lengthSq() > 1e-8) des.normalize()
  const bend = cur.lengthSq() > 0.5 ? cur.clone().lerp(des.lengthSq() > 0.5 ? des : cur, clamp01(poleW)) : des
  if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0).addScaledVector(r, r.y)
  bend.normalize()
  const along = (la * la - lb * lb + dist * dist) / (2 * dist)
  const h = Math.sqrt(Math.max(0, la * la - along * along))
  const B1 = A.clone().addScaledVector(r, along).addScaledVector(bend, h)
  _q.setFromUnitVectors(_a.subVectors(B, A).normalize(), _b.subVectors(B1, A).normalize())
  rotateWorld(a, _q)
  wp(b, B)
  wp(c, C)
  const C1 = A.clone().addScaledVector(r, dist)
  _q.setFromUnitVectors(_a.subVectors(C, B).normalize(), _b.subVectors(C1, B).normalize())
  rotateWorld(b, _q)
}

export function createTicketHandover(root: T.Object3D): TicketHandover {
  let rig: Rig | null = null
  const saved = new Map<T.Object3D, {q: T.Quaternion; p: T.Vector3}>()
  let applied = false

  let active = false
  let phase: TicketHandoverPhase = 'idle'
  let side: TicketHandoverSide = 'right'
  let elapsed = 0
  let opts: TicketHandoverOptions | null = null
  let holdSec: number = TICKET_HANDOVER_TIMING.hold
  let firedTear = false
  let firedDeliver = false
  const target = new T.Vector3()
  // 动作开始时锁定的身体方向：走位/镜头转动不该让扭腰来回跳
  const lockForward = new T.Vector3(0, 0, 1)

  function resolveRig(): Rig | null {
    const out: Partial<Rig> = {}
    for (const n of BONES) {
      const o = root.getObjectByName(n)
      if (!o) return null
      out[n] = o
    }
    return out as Rig
  }
  function ensureRig() {
    // 换装会整套替换骨骼：每次开播重新按名字找
    if (!rig || !rig.pelvis.parent || !isDescendant(rig.pelvis)) rig = resolveRig()
    return rig
  }
  function isDescendant(o: T.Object3D) {
    for (let p: T.Object3D | null = o; p; p = p.parent) if (p === root) return true
    return false
  }

  const duration = () => TICKET_HANDOVER_TIMING.tear + TICKET_HANDOVER_TIMING.reach + holdSec + TICKET_HANDOVER_TIMING.retract

  function reset() {
    if (!applied) return
    for (const [bone, s] of saved) {
      bone.quaternion.copy(s.q)
      bone.position.copy(s.p)
    }
    applied = false
    root.updateMatrixWorld(true)
  }

  function frame(r: Rig) {
    const sl = wp(r.upperarm_l, new T.Vector3())
    const sr = wp(r.upperarm_r, new T.Vector3())
    const left = sl.clone().sub(sr)
    left.y = 0
    if (left.lengthSq() < 1e-8) left.set(1, 0, 0)
    left.normalize()
    const forward = new T.Vector3().crossVectors(left, UP).normalize()
    return {sl, sr, left, forward}
  }

  function grip(r: Rig, s: TicketHandoverSide, out: T.Vector3) {
    const k = sfx(s)
    const hand = r[`hand_${k}` as BoneName]
    const elbow = r[`lowerarm_${k}` as BoneName]
    wp(hand, out)
    const dir = _c.copy(out).sub(wp(elbow, _d))
    if (dir.lengthSq() > 1e-8) out.addScaledVector(dir.normalize(), TICKET_HANDOVER_LIMITS.grip)
    return out
  }

  function armLength(r: Rig, s: TicketHandoverSide) {
    const k = sfx(s)
    const A = wp(r[`upperarm_${k}` as BoneName], new T.Vector3())
    const B = wp(r[`lowerarm_${k}` as BoneName], new T.Vector3())
    const C = wp(r[`hand_${k}` as BoneName], new T.Vector3())
    return A.distanceTo(B) + B.distanceTo(C) + TICKET_HANDOVER_LIMITS.grip
  }
  function legLength(r: Rig, k: 'l' | 'r') {
    const A = wp(r[`thigh_${k}` as BoneName], new T.Vector3())
    const B = wp(r[`calf_${k}` as BoneName], new T.Vector3())
    const C = wp(r[`foot_${k}` as BoneName], new T.Vector3())
    return A.distanceTo(B) + B.distanceTo(C)
  }
  function spineLever(r: Rig) {
    return Math.max(0.3, wp(r.upperarm_r, _a).y - wp(r.pelvis, _b).y)
  }

  function evaluate(r: Rig, tgt: T.Vector3, want: TicketHandoverSide | 'auto' = 'auto'): TicketHandoverCheck {
    const f = frame(r)
    const dl = tgt.distanceTo(f.sl)
    const dr = tgt.distanceTo(f.sr)
    const s: TicketHandoverSide = want !== 'auto' ? want : dl < dr - 0.02 ? 'left' : 'right'
    const pelvis = wp(r.pelvis, new T.Vector3())
    const horiz = new T.Vector3(tgt.x - pelvis.x, 0, tgt.z - pelvis.z)
    const distance = horiz.length()
    const shoulderDistance = s === 'left' ? dl : dr
    const footY = Math.min(wp(r.foot_l, _a).y, wp(r.foot_r, _b).y) - 0.08
    const L = TICKET_HANDOVER_LIMITS
    const maxReach = armLength(r, s) * 0.97 + L.maxStep + spineLever(r) * Math.sin(L.maxLean) * 0.9
    const base = {side: s, distance, shoulderDistance, maxReach}
    if (distance > 0.05) {
      const yaw = Math.atan2(f.forward.clone().cross(horiz.normalize()).y, f.forward.dot(horiz))
      if (Math.abs(yaw) > L.behind) return {ok: false, reason: 'behind', ...base}
    }
    const h = tgt.y - footY
    if (h > L.maxHeight) return {ok: false, reason: 'too_high', ...base}
    if (h < L.minHeight) return {ok: false, reason: 'too_low', ...base}
    if (shoulderDistance > maxReach) return {ok: false, reason: 'too_far', ...base}
    return {ok: true, reason: 'ok', ...base}
  }

  function check(targetWorldPos: Vec3Like, want: TicketHandoverSide | 'auto' = 'auto'): TicketHandoverCheck {
    const r = ensureRig()
    const t = new T.Vector3(targetWorldPos.x, targetWorldPos.y, targetWorldPos.z)
    if (!r) return {ok: false, reason: 'no_rig', side: want === 'left' ? 'left' : 'right', distance: Infinity, shoulderDistance: Infinity, maxReach: 0}
    const wasApplied = applied
    if (wasApplied) reset()
    root.updateMatrixWorld(true)
    return evaluate(r, t, want)
  }

  function finish(completed: boolean) {
    const cb = opts?.onDone
    active = false
    phase = 'idle'
    opts = null
    cb?.(completed)
  }

  function play(options: TicketHandoverOptions): boolean {
    const r = ensureRig()
    if (!r) return false
    if (!resolvePoint(options.targetWorldPos, target)) return false
    if (active) finish(false)
    reset()
    root.updateMatrixWorld(true)
    const res = evaluate(r, target, options.side ?? 'auto')
    if (!res.ok) return false
    side = res.side
    opts = options
    holdSec = Number.isFinite(options.holdSec) && (options.holdSec as number) > 0 ? (options.holdSec as number) : TICKET_HANDOVER_TIMING.hold
    elapsed = 0
    firedTear = false
    firedDeliver = false
    active = true
    phase = 'tear'
    lockForward.copy(frame(r).forward)
    saved.clear()
    for (const n of BONES) saved.set(r[n], {q: r[n].quaternion.clone(), p: r[n].position.clone()})
    return true
  }

  function stop() {
    if (active) finish(false)
  }

  function tick(dt: number) {
    // 调用方忘了每帧 reset 也不至于叠加漂移
    if (applied) reset()
    if (!active || !opts) return
    const r = rig
    if (!r || !isDescendant(r.pelvis)) {
      finish(false)
      return
    }
    elapsed += Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0
    const Tm = TICKET_HANDOVER_TIMING
    const t1 = Tm.tear
    const t2 = t1 + Tm.reach
    const t3 = t2 + holdSec
    const t4 = t3 + Tm.retract
    if (elapsed >= t4) {
      finish(true)
      return
    }
    let u: number
    if (elapsed < t1) {
      phase = 'tear'
      u = elapsed / Tm.tear
    } else if (elapsed < t2) {
      phase = 'reach'
      u = (elapsed - t1) / Tm.reach
    } else if (elapsed < t3) {
      phase = 'hold'
      u = (elapsed - t2) / holdSec
    } else {
      phase = 'retract'
      u = (elapsed - t3) / Tm.retract
    }
    // 目标在递出去之前一直跟踪；塞进去之后锁住，免得收手时被对方的手拽走
    if (phase === 'tear' || phase === 'reach' || (phase === 'hold' && !firedDeliver)) {
      if (!resolvePoint(opts.targetWorldPos, _d)) {
        if (!firedDeliver) {
          finish(false)
          return
        }
      } else target.copy(_d)
    }

    root.updateMatrixWorld(true)
    for (const n of BONES) {
      const s = saved.get(r[n])
      if (s) {
        s.q.copy(r[n].quaternion)
        s.p.copy(r[n].position)
      } else saved.set(r[n], {q: r[n].quaternion.clone(), p: r[n].position.clone()})
    }
    applied = true

    const L = TICKET_HANDOVER_LIMITS
    const k = sfx(side)
    const ok = side === 'left' ? 'r' : 'l'
    const f = frame(r)
    const forward = lockForward
    const left = new T.Vector3().crossVectors(UP, forward).normalize()
    const outward = side === 'left' ? left.clone() : left.clone().negate()
    const restGrip = grip(r, side, new T.Vector3())
    const otherSide: TicketHandoverSide = side === 'left' ? 'right' : 'left'
    const restOther = grip(r, otherSide, new T.Vector3())
    const pelvis0 = wp(r.pelvis, new T.Vector3())
    const footFront0 = wp(r[`foot_${k}` as BoneName], new T.Vector3())
    const footRear0 = wp(r[`foot_${ok}` as BoneName], new T.Vector3())

    // —— 身体投入度 s：扯单时只微微侧身，伸手时迈半步 + 前倾 + 扭腰，收手时退回 ——
    let s: number
    if (phase === 'tear') s = 0.18 * smooth(u)
    else if (phase === 'reach') s = 0.18 + 0.82 * smooth(u)
    else if (phase === 'hold') s = 1
    else s = 1 - smooth(u)

    const horiz = new T.Vector3(target.x - pelvis0.x, 0, target.z - pelvis0.z)
    const dirH = horiz.lengthSq() > 1e-6 ? horiz.clone().normalize() : forward.clone()
    const yaw = Math.atan2(_a.crossVectors(forward, dirH).y, forward.dot(dirH))
    const shoulder0 = side === 'left' ? f.sl : f.sr
    const need = Math.max(0, target.distanceTo(shoulder0) - armLength(r, side) * 0.9)
    const shift = Math.min(L.maxStep, need * 0.8)
    const lever = spineLever(r)
    const lean = Math.min(L.maxLean, Math.asin(clamp01((need - shift) / lever)) + 0.1)
    const twist = clamp(yaw * 0.85, -L.maxTwist, L.maxTwist)

    if (s > 1e-4) {
      const footQFront = r[`foot_${k}` as BoneName].getWorldQuaternion(new T.Quaternion())
      const footQRear = r[`foot_${ok}` as BoneName].getWorldQuaternion(new T.Quaternion())
      // 1) 弓步：骨盆朝目标送出去并下沉，保证后腿够得着钉住的后脚
      const legLen = legLength(r, ok) * 0.985
      const sh = shift * s
      const drop = legLen - Math.sqrt(Math.max(0, legLen * legLen - sh * sh)) + 0.025 * s
      translateWorld(r.pelvis, _c.copy(dirH).multiplyScalar(sh).addScaledVector(UP, -drop))
      // 2) 腿 IK：后脚钉在原地；前脚迈出去，迈步途中抬脚
      const stepLen = Math.min(0.6, shift * 1.9) * s
      const lifting = phase === 'reach' || phase === 'retract'
      const lift = lifting ? 0.07 * Math.sin(Math.PI * clamp01(phase === 'reach' ? u : 1 - u)) : 0
      const kneePole = _d.copy(dirH).multiplyScalar(0.6).add(_e.copy(forward).multiplyScalar(0.4)).normalize()
      solveTwoBone(r[`thigh_${ok}` as BoneName], r[`calf_${ok}` as BoneName], r[`foot_${ok}` as BoneName], footRear0, kneePole.clone(), s)
      const frontGoal = footFront0.clone().addScaledVector(dirH, stepLen).addScaledVector(UP, lift)
      solveTwoBone(r[`thigh_${k}` as BoneName], r[`calf_${k}` as BoneName], r[`foot_${k}` as BoneName], frontGoal, kneePole.clone(), s)
      // 脚掌保持原来的世界朝向（放平），不跟着小腿一起点地
      setWorldQuat(r[`foot_${ok}` as BoneName], footQRear)
      setWorldQuat(r[`foot_${k}` as BoneName], footQFront)
      // 3) 脊柱：扭向目标 + 前倾（三节分摊）
      const shares = [0.4, 0.33, 0.27] as const
      const spines = [r.spine_01, r.spine_02, r.spine_03]
      for (let i = 0; i < 3; i++) {
        const qTwist = new T.Quaternion().setFromAxisAngle(UP, twist * s * shares[i])
        const ang = lean * s * shares[i]
        const tilted = _a.copy(UP).multiplyScalar(Math.cos(ang)).addScaledVector(dirH, Math.sin(ang)).normalize()
        const qLean = new T.Quaternion().setFromUnitVectors(UP, tilted)
        rotateWorld(spines[i], qLean.multiply(qTwist))
      }
      // 4) 头：看向目标（一半）
      const headPos = wp(r.head, new T.Vector3())
      const faceDir = forward.clone().applyAxisAngle(UP, twist * s)
      const look = _b.subVectors(target, headPos).normalize()
      _q.setFromUnitVectors(faceDir, look)
      rotateWorld(r.head, _q.slerp(new T.Quaternion(), 1 - 0.55 * s))
    }

    // —— 打印机位置：右胯前侧（骨盆跟着弓步走，所以在身体动作之后取）——
    // printerWorldPos 是出纸口（duty-props 的 getDutyPrinterSlotWorldPosition）；不传就按右胯前侧估算
    const printer = new T.Vector3()
    const slot = new T.Vector3()
    if (resolvePoint(opts.printerWorldPos, slot)) {
      printer.copy(slot).addScaledVector(UP, -SLOT_ABOVE_PRINTER.up).addScaledVector(forward, -SLOT_ABOVE_PRINTER.forward)
    } else {
      wp(r.pelvis, printer).addScaledVector(left, -0.2).addScaledVector(forward, 0.07).addScaledVector(UP, 0.02)
      slot.copy(printer).addScaledVector(UP, SLOT_ABOVE_PRINTER.up).addScaledVector(forward, SLOT_ABOVE_PRINTER.forward)
    }
    const yank = printer.clone().addScaledVector(UP, 0.24).addScaledVector(forward, 0.2).addScaledVector(outward, 0.06)

    // —— 递单手的轨迹 ——
    const goal = new T.Vector3()
    // 回调放到整帧姿势落定之后再发：回调里读 gripWorldPosition() 拿到的是这一帧真实的手位置
    let fireTear = false
    let fireDeliver = false
    let w = 1
    let flick = 0
    if (phase === 'tear') {
      w = smooth(u / 0.25)
      if (u < 0.45) goal.lerpVectors(restGrip, slot, smooth(u / 0.45))
      else if (u < 0.72) {
        const y = (u - 0.45) / 0.27
        goal.lerpVectors(slot, yank, easeOut(y))
        flick = Math.sin(y * Math.PI * 3) * (1 - y) * 0.65
      } else goal.copy(yank)
      if (!firedTear && u >= 0.55) {
        firedTear = true
        fireTear = true
      }
    } else if (phase === 'reach') {
      const e = smooth(u)
      const mid = _a.lerpVectors(yank, target, 0.5).addScaledVector(UP, 0.12)
      // 二次贝塞尔：先抬一下再送出去
      goal
        .copy(yank)
        .multiplyScalar((1 - e) * (1 - e))
        .addScaledVector(mid, 2 * (1 - e) * e)
        .addScaledVector(target, e * e)
    } else if (phase === 'hold') {
      // 「塞」：往对方手心里推 4cm 再回来
      const push = _b.subVectors(target, wp(r[`upperarm_${k}` as BoneName], _c)).normalize()
      goal.copy(target).addScaledVector(push, 0.04 * Math.sin(Math.PI * u))
      if (!firedDeliver && u >= 0.45) {
        firedDeliver = true
        fireDeliver = true
      }
    } else {
      const e = smooth(u)
      goal.lerpVectors(target, restGrip, e)
      w = 1 - smooth((u - 0.35) / 0.65)
    }
    // 若 tick 的 dt 很大直接跨过了扯单/塞单时刻，也要补发回调，Carbon 的凭条状态机才不会卡住
    if (!firedTear && phase !== 'tear') {
      firedTear = true
      fireTear = true
    }
    if (!firedDeliver && phase === 'retract') {
      firedDeliver = true
      fireDeliver = true
    }

    const pole = _d.set(0, -0.8, 0).addScaledVector(outward, 0.45).addScaledVector(forward, -0.15).normalize().clone()
    if (w > 1e-4) reachArm(r, side, _e.lerpVectors(restGrip, goal, w).clone(), pole, w)
    if (Math.abs(flick) > 1e-4) {
      const hand = r[`hand_${k}` as BoneName]
      const axisW = _a.subVectors(wp(hand, _b), wp(r[`lowerarm_${k}` as BoneName], _c)).normalize()
      rotateWorld(hand, _q.setFromAxisAngle(axisW, flick))
    }

    // —— 另一只手扶住打印机：扯单时扶，伸出去以后松开 ——
    let ws = 0
    if (phase === 'tear') ws = smooth(u / 0.35)
    else if (phase === 'reach') ws = 1 - smooth(u / 0.5)
    if (ws > 1e-4) {
      const outO = outward.clone().negate()
      const brace = printer.clone().addScaledVector(forward, 0.07).addScaledVector(UP, -0.01).addScaledVector(outward, 0.05)
      const poleO = _d.set(0, -0.8, 0).addScaledVector(outO, 0.5).addScaledVector(forward, -0.1).normalize().clone()
      reachArm(r, otherSide, _e.lerpVectors(restOther, brace, ws).clone(), poleO, ws)
    }
    const cb = opts
    if (fireTear) cb.onTear?.(side)
    if (fireDeliver) cb.onDeliver?.(side)
  }

  /** 握点精确落到 goal：腕目标迭代修正 3 次（掌心不在前臂延长线上时也能对准）。 */
  function reachArm(r: Rig, s: TicketHandoverSide, goal: T.Vector3, pole: T.Vector3, poleW: number) {
    const k = sfx(s)
    const a = r[`upperarm_${k}` as BoneName]
    const b = r[`lowerarm_${k}` as BoneName]
    const c = r[`hand_${k}` as BoneName]
    const A = wp(a, new T.Vector3())
    const wristGoal = goal.clone().addScaledVector(_a.subVectors(goal, A).normalize(), -TICKET_HANDOVER_LIMITS.grip)
    const g = new T.Vector3()
    for (let i = 0; i < 3; i++) {
      solveTwoBone(a, b, c, wristGoal, pole, poleW)
      grip(r, s, g)
      const err = _b.subVectors(goal, g)
      if (err.lengthSq() < 1e-6) break
      wristGoal.add(err)
    }
  }

  return {
    play,
    check,
    stop,
    reset,
    tick,
    gripWorldPosition(s = side, out = new T.Vector3()) {
      const r = ensureRig()
      if (!r) return null
      return grip(r, s, out)
    },
    handBone(s = side) {
      const r = ensureRig()
      return r ? r[`hand_${sfx(s)}` as BoneName] : null
    },
    get active() {
      return active
    },
    get phase() {
      return phase
    },
    get side() {
      return side
    },
    get elapsed() {
      return elapsed
    },
    get progress() {
      return active ? clamp01(elapsed / duration()) : 0
    },
    get duration() {
      return duration()
    },
  }
}

// —— 默认实例：walk/index.ts 绑定玩家 figure 后，Carbon 直接调 playTicketHandover({...}) ——
let defaultHandover: TicketHandover | null = null
export function bindTicketHandover(handover: TicketHandover | null) {
  defaultHandover = handover
}
export function getTicketHandover() {
  return defaultHandover
}
/** 玩家递单动作入口（需先 bindTicketHandover）；没绑定、够不到、在身后都返回 false。 */
export function playTicketHandover(options: TicketHandoverOptions): boolean {
  return defaultHandover?.play(options) ?? false
}
/** 只判断能不能递（Carbon 用来决定提示「再靠近点」）。 */
export function checkTicketHandover(targetWorldPos: Vec3Like, side: TicketHandoverSide | 'auto' = 'auto'): TicketHandoverCheck | null {
  return defaultHandover?.check(targetWorldPos, side) ?? null
}
