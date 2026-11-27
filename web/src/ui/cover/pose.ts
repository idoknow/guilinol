// 封面主角的程序化姿态层：模型自带的 idle 几乎静止（手臂直垂、手指平伸），这里叠一层
// 放松站姿 + 呼吸 + 换重心，再隔几秒轮换一个小动作（插兜 / 伸懒腰 / 手搭凉棚看城 / 挠头）。
// 两种写法：
// - 偏移（FK）：按「人物根空间」写转角（度；+X = 人物右手方向，+Y = 上，-Z = 正前方），载入时换算成每根骨骼的本地轴，
//   父骨骼转了子骨骼的轴跟着走。正 X = 往下垂的骨骼向前摆、往上长的骨骼向后仰；左臂 +Z / 右臂 -Z = 往身上收。
// - 够手（IK）：给手腕目标点、手肘撑的方向、手指与掌心朝向，大臂小臂两段解析求解——手要落到具体位置（兜里、额前、后脑）用这个。
import * as T from 'three'

type V3 = readonly [number, number, number]
/** 骨骼 → 绕根空间 X / Y / Z 的转角（度）；curl_l / curl_r = 四指弯曲度，thumb_l / thumb_r = 拇指内收 */
export type Pose = Readonly<Record<string, V3>>

interface Reach {
  /** 手腕目标（米）。space 'root' = 人物根空间（脚底原点）；'head' = 相对头骨、跟着头转 */
  at: V3
  space?: 'root' | 'head'
  /** 手肘往哪边撑 */
  pole: V3
  /** 手指 / 掌心朝向（根空间方向）；不给 = 手腕按偏移走 */
  fingers?: V3
  palm?: V3
}

interface Act {
  name: string
  pose: Pose
  reach?: {l?: Reach; r?: Reach}
  /** 进入 / 保持 / 退出（秒） */
  inT: number
  hold: number
  outT: number
  /** 动作期间压掉视线跟随的比例（0..1） */
  gazeOff: number
  /** 保持阶段的小幅周期动作：转角偏移 / 手腕目标偏移（米，右手；左手 x 镜像） */
  wiggle?: (t: number, out: Map<string, number[]>) => void
  wob?: (t: number) => V3
  /** 只在点人时做（不进空闲随机池） */
  onTap?: boolean
}

const SIDES = ['l', 'r'] as const
type Side = (typeof SIDES)[number]
const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const
/** 四指各节的弯曲分配（指根少、中节多），小指比食指弯得多一点更自然 */
const CURL_JOINT = [0.55, 1, 0.75]
const CURL_FINGER = {index: 0.75, middle: 0.95, ring: 1.05, pinky: 1.2}
const BODY = [
  'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head',
  ...SIDES.flatMap((s) => [`clavicle_${s}`, `upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`, `thigh_${s}`, `calf_${s}`, `foot_${s}`]),
  ...SIDES.flatMap((s) => [1, 2, 3].map((j) => `thumb_0${j}_${s}`)),
]

/** 放松站姿：大臂略后、肘微弯、手指自然半握；重心在右脚，左膝松、左胯落 */
export const STANCE: Pose = {
  upperarm_l: [-2, 0, 1.5],
  upperarm_r: [-2, 0, -1.5],
  lowerarm_l: [11, 0, 0],
  lowerarm_r: [11, 0, 0],
  hand_l: [5, 0, -3],
  hand_r: [5, 0, 3],
  curl_l: [17, 0, 0],
  curl_r: [17, 0, 0],
  thumb_l: [8, 0, 0],
  thumb_r: [8, 0, 0],
  pelvis: [0, 4, 2],
  spine_01: [0, -2, -1.2],
  spine_03: [0, -2, -1],
  thigh_l: [5, 0, -2],
  thigh_r: [0, 0, -2],
  calf_l: [-9, 0, 0],
  foot_l: [4, 0, 0],
}

const mirror = (v: V3): V3 => [-v[0], v[1], v[2]]
const both = (r: Reach): {l: Reach; r: Reach} => ({
  r,
  l: {...r, at: mirror(r.at), pole: mirror(r.pole), fingers: r.fingers && mirror(r.fingers), palm: r.palm && mirror(r.palm)},
})

export const ACTS: Act[] = [
  {
    // 双手插裤兜，肩膀放松，人往后靠一点
    name: 'pockets',
    pose: {spine_02: [2, 0, 0], spine_03: [1.5, 0, 0], head: [-3, 0, 0], curl_l: [10, 0, 0], curl_r: [10, 0, 0]},
    reach: both({at: [0.146, 0.958, -0.004], pole: [0.8, 0, 1], fingers: [-0.12, -0.95, -0.22], palm: [-0.45, 0, 0.9]}),
    inT: 0.75,
    hold: 6,
    outT: 0.75,
    gazeOff: 0,
  },
  {
    // 伸懒腰：两手举过头，身子后仰，头抬起
    name: 'stretch',
    pose: {
      clavicle_l: [0, 0, -12],
      clavicle_r: [0, 0, 12],
      curl_l: [-14, 0, 0],
      curl_r: [-14, 0, 0],
      spine_01: [2, 0, 0],
      spine_02: [4, 0, 0],
      spine_03: [5, 0, 0],
      head: [9, 0, 0],
    },
    reach: both({at: [0.11, 1.93, 0.03], pole: [1, 0, 0.2], fingers: [-0.2, 1, 0], palm: [0, 0.2, -1]}),
    inT: 0.9,
    hold: 1.2,
    outT: 1.0,
    gazeOff: 0.85,
    wob: (t) => [0, Math.sin(t * 9) * 0.006, 0],
  },
  {
    // 手搭凉棚往城里望
    name: 'shade',
    pose: {spine_03: [0, 8, 0], neck_01: [-2, 10, 0], head: [-3, 12, 0], curl_r: [-8, 0, 0], thumb_r: [-6, 0, 0]},
    reach: {r: {at: [0.125, 0.175, -0.1], space: 'head', pole: [1, 0.05, -0.25], fingers: [-0.7, 0.05, -0.7], palm: [0, -1, 0]}},
    inT: 0.8,
    hold: 2.8,
    outT: 0.8,
    gazeOff: 1,
    wiggle: (t, o) => add(o, 'head', 0, Math.sin(t * 0.9) * 9, 0),
  },
  {
    // 挠后脑勺，头微低、往另一边歪
    name: 'scratch',
    pose: {neck_01: [-4, 0, 3], head: [-6, -6, 4], curl_r: [28, 0, 0]},
    reach: {r: {at: [0.06, 0.11, 0.07], space: 'head', pole: [1, 0.15, -0.7], fingers: [-0.4, 0.6, 0.7], palm: [-0.6, -0.3, 0.6]}},
    inT: 0.6,
    hold: 1.6,
    outT: 0.6,
    gazeOff: 0.6,
    wob: (t) => [Math.sin(t * 14) * 0.012, Math.cos(t * 14) * 0.008, 0],
  },
  {
    // 点人时：右手举到头侧，掌心朝前左右摆；头微歪，继续看着你
    name: 'wave',
    pose: {clavicle_r: [0, 0, 6], spine_03: [0, -3, 1.5], head: [0, 0, -4], curl_r: [-16, 0, 0], thumb_r: [-10, 0, 0]},
    reach: {r: {at: [0.36, 1.64, -0.13], pole: [0.75, -1, 0.35], fingers: [0.15, 1, -0.1], palm: [0.15, 0, -1]}},
    inT: 0.35,
    hold: 1.7,
    outT: 0.55,
    gazeOff: 0,
    wob: (t) => [Math.sin(t * 10) * 0.055, Math.abs(Math.sin(t * 10)) * -0.012, 0],
    onTap: true,
  },
]

function add(o: Map<string, number[]>, k: string, x: number, y: number, z: number) {
  const v = o.get(k)
  if (v) {
    v[0] += x
    v[1] += y
    v[2] += z
  } else o.set(k, [x, y, z])
}

interface Joint {
  bone: T.Bone
  rest: T.Quaternion
  /** 根空间 X / Y / Z 在本骨骼静止姿态下的本地方向 */
  ax: [T.Vector3, T.Vector3, T.Vector3]
}
interface Arm {
  up: T.Bone
  lo: T.Bone
  hand: T.Bone
  /** 手腕静止时的根空间朝向与（手指, 掌心, 侧向）基的转置 */
  restQ: T.Quaternion
  basisT: T.Matrix4
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const DEG = Math.PI / 180
const total = (a: Act) => a.inT + a.hold + a.outT
function weightAt(a: Act, t: number) {
  if (t < a.inT) return smooth(t / a.inT)
  if (t < a.inT + a.hold) return 1
  return 1 - smooth(Math.min(1, (t - a.inT - a.hold) / a.outT))
}
/** 从 t 起开始淡出：还在淡入就跳到淡出段里同样权重的位置（smooth 对称），不突然到满 */
function fadeOutAt(a: Act, t: number) {
  const out = a.inT + a.hold
  return t < a.inT ? out + a.outT * (1 - t / a.inT) : Math.max(t, out)
}

export class PoseLayer {
  private joints = new Map<string, Joint>()
  /** 每根指骨：骨骼 + 本地弯曲轴 + 分配权重 */
  private fingers: {side: Side; bone: T.Bone; rest: T.Quaternion; axis: T.Vector3; w: number}[] = []
  private arms: Partial<Record<Side, Arm>> = {}
  private head?: {bone: T.Bone; restInv: T.Quaternion}
  private acc = new Map<string, number[]>()
  private wig = new Map<string, number[]>()
  private q = new T.Quaternion()
  private qa = new T.Quaternion()
  private qb = new T.Quaternion()
  private qc = new T.Quaternion()
  private qh = new T.Quaternion()
  private v = Array.from({length: 9}, () => new T.Vector3())
  private m = new T.Matrix4()
  private rootInv = new T.Matrix4()
  private rootQi = new T.Quaternion()
  private time = 0
  /** 正在做的小动作（-1 = 无）与它的计时；被新动作顶掉的那个在 prev 里淡出，两者叠着过渡 */
  private act = -1
  private actT = 0
  private prev = -1
  private prevT = 0
  private nextIn = 3.5
  private last = -1
  /** 调试：定住一个动作（null = 正常轮换） */
  private debug: Act | null = null

  constructor(model: T.Object3D, private root: T.Object3D, private reduced: boolean) {
    root.updateMatrixWorld(true)
    this.rootInv.copy(root.matrixWorld).invert()
    root.getWorldQuaternion(this.rootQi).invert()
    const AX = [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)]
    const bone = (n: string) => model.getObjectByName(n) as T.Bone | undefined
    for (const name of BODY) {
      const b = bone(name)
      if (!b) continue
      const qi = this.rq(b, new T.Quaternion()).invert()
      this.joints.set(name, {bone: b, rest: b.quaternion.clone(), ax: AX.map((a) => a.clone().applyQuaternion(qi)) as Joint['ax']})
    }
    const h = bone('head')
    if (h) this.head = {bone: h, restInv: this.rq(h, new T.Quaternion()).invert()}
    for (const side of SIDES) {
      const ia = bone(`index_01_${side}`), pa = bone(`pinky_01_${side}`), ma = bone(`middle_01_${side}`)
      const up = bone(`upperarm_${side}`), lo = bone(`lowerarm_${side}`), hand = bone(`hand_${side}`)
      if (!ia || !pa || !ma || !up || !lo || !hand) continue
      // 指根连线（食指 → 小指）：四指弯曲轴；右手取反让两只手的正值都是往掌心收
      const knuckles = this.pos(pa, new T.Vector3()).sub(this.pos(ia, new T.Vector3())).normalize()
      const k = knuckles.clone().multiplyScalar(side === 'r' ? -1 : 1)
      for (const f of FINGERS)
        for (let j = 1; j <= 3; j++) {
          const b = bone(`${f}_0${j}_${side}`)
          if (!b) continue
          const axis = k.clone().applyQuaternion(this.rq(b, new T.Quaternion()).invert()).normalize()
          this.fingers.push({side, bone: b, rest: b.quaternion.clone(), axis, w: CURL_JOINT[j - 1] * CURL_FINGER[f]})
        }
      // 手的静止基：手指方向 f0，掌心朝向 n0（手垂在身侧时掌心朝大腿）
      const f0 = this.pos(ma, new T.Vector3()).sub(this.pos(hand, new T.Vector3())).normalize()
      const n0 = new T.Vector3().crossVectors(f0, knuckles.negate()).multiplyScalar(side === 'r' ? -1 : 1).normalize()
      const b0 = new T.Vector3().crossVectors(f0, n0)
      this.arms[side] = {up, lo, hand, restQ: this.rq(hand, new T.Quaternion()), basisT: new T.Matrix4().makeBasis(f0, n0, b0).transpose()}
    }
  }

  /** 动画混合器更新之前：把碰过的骨骼放回静止姿态（idle 没动的骨骼不会自己复位） */
  reset() {
    for (const j of this.joints.values()) j.bone.quaternion.copy(j.rest)
    for (const f of this.fingers) f.bone.quaternion.copy(f.rest)
  }

  /** 调试：'' = 只有站姿，ACTS 里的名字 = 站姿 + 该动作满权重，null = 正常 */
  setDebug(name: string | null) {
    this.debug = name === null ? null : (ACTS.find((a) => a.name === name) ?? {name: '', pose: {}, inT: 1, hold: 1, outT: 1, gazeOff: 0})
  }

  /** 马上做某个小动作（点人时的反应 / 调试）；正在做的那个转去淡出，和新的叠着过渡 */
  play(name: string) {
    const i = ACTS.findIndex((a) => a.name === name)
    if (i < 0 || this.reduced) return false
    if (this.act >= 0) {
      this.prev = this.act
      this.prevT = fadeOutAt(ACTS[this.act], this.actT)
    }
    this.act = this.last = i
    this.actT = 0
    this.nextIn = Math.max(this.nextIn, 6)
    return true
  }

  /** 正在做的小动作（无 = ''） */
  get acting() {
    return this.act >= 0 ? ACTS[this.act].name : ''
  }

  /** 要转身（回头看城 / 进游戏）：当前小动作收掉，晚点再来 */
  interrupt() {
    if (this.act >= 0) this.actT = fadeOutAt(ACTS[this.act], this.actT)
    this.nextIn = Math.max(this.nextIn, 6)
  }

  /** 视线跟随该压掉的比例 */
  get gazeOff() {
    if (this.debug) return this.debug.gazeOff
    let g = 0
    if (this.act >= 0) g = ACTS[this.act].gazeOff * weightAt(ACTS[this.act], this.actT)
    if (this.prev >= 0) g = Math.max(g, ACTS[this.prev].gazeOff * weightAt(ACTS[this.prev], this.prevT))
    return g
  }

  /** 混合器更新之后调用：叠站姿、呼吸、换重心、小动作的转角部分 */
  update(dt: number, busy: boolean) {
    this.time += dt
    const o = this.acc
    for (const v of o.values()) v.fill(0)
    const put = (pose: Pose, w: number) => {
      for (const k in pose) add(o, k, pose[k][0] * w, pose[k][1] * w, pose[k][2] * w)
    }
    put(STANCE, 1)
    if (this.debug) put(this.debug.pose, 1)
    else if (!this.reduced) {
      const t = this.time
      // 呼吸 ~4.2 s 一次：胸口起伏、肩随着动
      const br = Math.sin((t * Math.PI * 2) / 4.2)
      add(o, 'spine_02', 0.8 * br, 0, 0)
      add(o, 'spine_03', 1.1 * br, 0, 0)
      add(o, 'clavicle_l', 0, 0, -0.9 * br)
      add(o, 'clavicle_r', 0, 0, 0.9 * br)
      // 重心慢慢左右挪（~9 s），上身反向找平
      const sw = Math.sin((t * Math.PI * 2) / 9.3) * 0.6 + Math.sin((t * Math.PI * 2) / 3.7) * 0.15
      add(o, 'pelvis', 0, sw * 2, sw * 1.6)
      add(o, 'spine_01', 0, 0, -sw * 0.9)
      add(o, 'spine_03', 0, -sw, -sw * 0.6)
      add(o, 'thigh_l', 0, 0, -sw * 1.6)
      add(o, 'thigh_r', 0, 0, -sw * 1.6)
      // 手指偶尔动一下
      const fid = Math.max(0, Math.sin(t * 0.73) * Math.sin(t * 1.9)) * 9
      add(o, 'curl_l', fid, 0, 0)
      add(o, 'curl_r', -fid * 0.6, 0, 0)

      // 小动作：空闲时隔几秒随机来一个（点人用的挥手不进随机池）；要转身时收掉
      if (this.prev >= 0 && (this.prevT += dt) >= total(ACTS[this.prev])) this.prev = -1
      if (this.act < 0) {
        if (!busy) this.nextIn -= dt
        if (this.nextIn <= 0) {
          const pool = ACTS.map((_, i) => i).filter((i) => !ACTS[i].onTap && i !== this.last)
          this.act = this.last = pool[Math.floor(Math.random() * pool.length)]
          this.actT = 0
        }
      } else {
        this.actT += dt
        if (busy) this.interrupt()
        if (this.actT >= total(ACTS[this.act])) {
          this.act = -1
          this.nextIn = 5 + Math.random() * 5
        }
      }
      for (const [i, at] of [[this.prev, this.prevT], [this.act, this.actT]]) {
        if (i < 0) continue
        const a = ACTS[i], w = weightAt(a, at)
        put(a.pose, w)
        if (a.wiggle) {
          const g = this.wig
          for (const v of g.values()) v.fill(0)
          a.wiggle(at, g)
          for (const [k, v] of g) add(o, k, v[0] * w, v[1] * w, v[2] * w)
        }
      }
    }
    this.apply()
  }

  /** 视线转完头之后调用：够手（手腕落到兜里 / 额前 / 后脑 / 举起来挥） */
  reach() {
    const jobs: [Act, number, number][] = this.debug
      ? [[this.debug, 1, 0]]
      : ([[this.prev, this.prevT], [this.act, this.actT]] as const).filter(([i]) => i >= 0).map(([i, t]) => [ACTS[i], weightAt(ACTS[i], t), t])
    if (!jobs.some(([a]) => a.reach)) return
    this.root.updateWorldMatrix(true, false)
    this.rootInv.copy(this.root.matrixWorld).invert()
    this.root.getWorldQuaternion(this.rootQi).invert()
    for (const [a, w, t] of jobs) {
      if (!a.reach || w <= 0.001) continue
      const wob = a.wob && !this.debug ? a.wob(t) : null
      for (const side of SIDES) {
        const r = a.reach[side]
        if (r) this.solve(side, r, w, wob && (side === 'r' ? wob : mirror(wob)))
      }
    }
  }

  private apply() {
    const {q, qa} = this
    for (const [name, v] of this.acc) {
      const j = this.joints.get(name)
      if (!j || (!v[0] && !v[1] && !v[2])) continue
      q.identity()
      for (let i = 0; i < 3; i++) if (v[i]) q.multiply(qa.setFromAxisAngle(j.ax[i], v[i] * DEG))
      j.bone.quaternion.multiply(q)
    }
    for (const side of SIDES) {
      const c = this.acc.get(`curl_${side}`)?.[0] ?? 0
      if (c) for (const f of this.fingers) if (f.side === side) f.bone.quaternion.multiply(qa.setFromAxisAngle(f.axis, c * f.w * DEG))
      const th = this.acc.get(`thumb_${side}`)?.[0] ?? 0
      const tj = this.joints.get(`thumb_02_${side}`)
      if (th && tj) tj.bone.quaternion.multiply(qa.setFromAxisAngle(tj.ax[1], (side === 'l' ? th : -th) * DEG))
    }
  }

  // ---------- 根空间工具 ----------
  private pos(b: T.Object3D, out: T.Vector3) {
    b.updateWorldMatrix(true, false)
    return out.setFromMatrixPosition(b.matrixWorld).applyMatrix4(this.rootInv)
  }
  private rq(b: T.Object3D, out: T.Quaternion) {
    return b.getWorldQuaternion(out).premultiply(this.rootQi)
  }
  /** 按根空间旋转 r 转一根骨骼（随父链）：L' = P⁻¹ · r · P · L */
  private turn(b: T.Object3D, r: T.Quaternion) {
    const p = this.rq(b.parent!, this.qb)
    b.quaternion.premultiply(p).premultiply(r).premultiply(p.invert())
    b.updateWorldMatrix(false, true)
  }

  /** 两段 IK：大臂、小臂各转一次最短弧，肘落在 pole 那侧；再把手腕朝向往目标 slerp */
  private solve(side: Side, r: Reach, w: number, wob: V3 | null) {
    const arm = this.arms[side]
    if (!arm) return
    const [S, E, H, G, n, p, t, E2, F] = this.v
    this.pos(arm.up, S)
    this.pos(arm.lo, E)
    this.pos(arm.hand, H)
    // 目标：头空间的跟着头转（Δ = 头当前朝向 · 静止朝向⁻¹）
    let dq: T.Quaternion | null = null
    G.set(r.at[0], r.at[1], r.at[2])
    if (wob) G.add(t.set(wob[0], wob[1], wob[2]))
    if (r.space === 'head' && this.head) {
      dq = this.rq(this.head.bone, this.qh).multiply(this.head.restInv)
      G.applyQuaternion(dq).add(this.pos(this.head.bone, t))
    }
    G.sub(H).multiplyScalar(w).add(H)
    const a = S.distanceTo(E), b = E.distanceTo(H)
    n.subVectors(G, S)
    const d = T.MathUtils.clamp(n.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3)
    n.normalize()
    // 肘的弯曲面：从当前（站姿）的平面渐变到 pole，起手不跳
    p.subVectors(E, S)
    p.addScaledVector(n, -p.dot(n))
    t.set(r.pole[0], r.pole[1], r.pole[2])
    if (dq) t.applyQuaternion(dq)
    t.addScaledVector(n, -t.dot(n)).normalize()
    if (p.lengthSq() < 1e-8) p.copy(t)
    else p.normalize().lerp(t, w).normalize()
    const ca = T.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1)
    E2.copy(S).addScaledVector(n, a * ca).addScaledVector(p, a * Math.sqrt(1 - ca * ca))
    this.turn(arm.up, this.qa.setFromUnitVectors(E.sub(S).normalize(), t.subVectors(E2, S).normalize()))
    this.pos(arm.lo, E)
    this.pos(arm.hand, H)
    G.copy(S).addScaledVector(n, d)
    this.turn(arm.lo, this.qa.setFromUnitVectors(H.sub(E).normalize(), t.subVectors(G, E).normalize()))
    if (!r.fingers || !r.palm) return
    // 手腕：目标基（手指, 掌心, 侧向）· 静止基ᵀ · 静止朝向
    F.set(r.fingers[0], r.fingers[1], r.fingers[2]).normalize()
    const N = t.set(r.palm[0], r.palm[1], r.palm[2])
    if (dq) {
      F.applyQuaternion(dq)
      N.applyQuaternion(dq)
    }
    N.addScaledVector(F, -N.dot(F)).normalize()
    const B = n.crossVectors(F, N)
    this.qa.setFromRotationMatrix(this.m.makeBasis(F, N, B).multiply(arm.basisT)).multiply(arm.restQ)
    const cur = this.rq(arm.hand, this.qc)
    const goal = this.q.copy(cur).slerp(this.qa, w)
    this.turn(arm.hand, goal.multiply(cur.invert()))
  }
}
