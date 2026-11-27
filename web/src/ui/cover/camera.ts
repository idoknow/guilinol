// 机位：逻辑画框 = 菜单以外的区域（setViewOffset 让画布延伸到菜单下），长焦压缩峰林；
// 主角按 FRAME 比例落位；鼠标视差（相机微移、始终盯住主角 → 远景相对主角滑动）；开场推镜；进游戏俯冲。
import * as T from 'three'
import {DEG, FRAME, SITE, VIEW, dirAz} from './config'

const damp = (a: number, b: number, k: number, dt: number) => b + (a - b) * Math.exp(-k * dt)
const easeOut = (t: number) => 1 - (1 - t) ** 3
const HERO_H = 1.72
const UP = new T.Vector3(0, 1, 0)

export class Rig {
  readonly camera = new T.PerspectiveCamera(20, 1, FRAME.near, FRAME.far)
  /** 主角站位（脚底，世界坐标） */
  readonly hero = new T.Vector3()
  private safe = {left: 0, right: 0, bottom: 0}
  /** dev：画布像素裁切放大 [x, y, w, h] */
  crop: number[] | null = null
  private cur = {left: 0, right: 0, bottom: 0}
  private w = 1
  private h = 1
  private ptr = new T.Vector2()
  private par = new T.Vector2()
  private intro: number
  private diveT = -1
  private time = 0
  private base = new T.Vector3()
  private aim = new T.Vector3()
  private tmp = new T.Vector3()
  private side = new T.Vector3()
  private shoulder = new T.Vector3()
  /** 画框里主角中心横向位置（NDC，-1..1，相对整张画布），给 UI 和拾取用 */
  heroNdc = new T.Vector2()
  /** 每像素对应的弧度（远处窗格/光点抗锯齿用） */
  focalPx = 1000

  constructor(private reduced: boolean) {
    this.intro = reduced ? 1 : 0
  }

  /** 楼顶高度到手后落位（相机站原点楼顶，主角在 heroAz 方向 FRAME.dist 处） */
  place(roofY: number) {
    const at = dirAz(SITE.heroAz)
    this.hero.set(at.x * FRAME.dist, roofY, at.z * FRAME.dist)
    this.base.set(0, roofY + FRAME.eye, 0)
  }

  /** 被菜单挡住的边距（CSS px），画框取剩下那块 */
  setSafe(area: {left: number; right: number; bottom: number}, instant = false) {
    this.safe.left = Math.max(0, area.left)
    this.safe.right = Math.max(0, area.right)
    this.safe.bottom = Math.max(0, area.bottom)
    if (instant) Object.assign(this.cur, this.safe)
  }
  setSize(w: number, h: number) {
    this.w = Math.max(1, w)
    this.h = Math.max(1, h)
  }
  pointer(nx: number, ny: number) {
    this.ptr.set(nx, ny)
  }
  pointerLeave() {
    this.ptr.set(0, 0)
  }
  /** 进游戏：越过主角肩头俯冲出去（~1.2 s 后停在江面上空，由调用方暂停/释放） */
  dive() {
    if (this.diveT < 0) this.diveT = 0
  }
  /** 取消俯冲（从游戏退回主界面） */
  undive() {
    this.diveT = -1
  }
  get diving() {
    return this.diveT >= 0
  }

  update(dt: number) {
    this.time += dt
    if (!this.reduced) this.intro = Math.min(1, this.intro + dt / 3.2)
    if (this.diveT >= 0) this.diveT += dt
    this.cur.left = damp(this.cur.left, this.safe.left, 6, dt)
    this.cur.right = damp(this.cur.right, this.safe.right, 6, dt)
    this.cur.bottom = damp(this.cur.bottom, this.safe.bottom, 6, dt)
    const k = this.reduced ? 0 : 1
    this.par.x = damp(this.par.x, this.ptr.x * k, 2.2, dt)
    this.par.y = damp(this.par.y, this.ptr.y * k, 2.2, dt)

    // ---------- 画框 ----------
    const W = this.w, H = this.h
    let left = Math.min(this.cur.left, W * 0.6), right = Math.min(this.cur.right, W * 0.6)
    const bottom = Math.min(this.cur.bottom, H * 0.6)
    // 左右合计最多占 75%，超了按比例缩
    const lr = left + right
    if (lr > W * 0.75) {
      const s = (W * 0.75) / lr
      left *= s
      right *= s
    }
    const Wf = Math.max(1, W - left - right), Hf = Math.max(1, H - bottom)
    const aspect = Wf / Hf
    const portrait = aspect < 1
    let vfov = 2 * Math.atan(HERO_H / FRAME.heroFill / 2 / FRAME.dist)
    const minH = FRAME.minHfov * DEG
    if (2 * Math.atan(aspect * Math.tan(vfov / 2)) < minH) vfov = 2 * Math.atan(Math.tan(minH / 2) / aspect)
    const cam = this.camera
    cam.fov = vfov / DEG
    cam.aspect = aspect
    const c = this.crop
    if (c) cam.setViewOffset(Wf, Hf, -left + c[0], c[1], c[2], c[3])
    else cam.setViewOffset(Wf, Hf, -left, 0, W, H)

    // ---------- 机位：相机在原点楼顶，主角按 heroX 落位 ----------
    const hx = portrait ? FRAME.heroXPortrait : FRAME.heroX
    const tanH = Math.tan(vfov / 2) * aspect
    const off = Math.atan((hx - 0.5) * 2 * tanH)
    const it = easeOut(this.intro)
    const pos = this.tmp.copy(this.base)
    // 开场：从主角身后更远、更低处推近（相机沿视线后退 2.4 m、低 0.5 m）
    const back = dirAz(SITE.heroAz)
    pos.addScaledVector(back, -(1 - it) * 2.4)
    pos.y -= (1 - it) * 0.5
    // 视差：相机横移 ±0.35 m、升降 ±0.12 m，视线仍盯主角 → 峰林相对主角滑动
    this.side.set(-back.z, 0, back.x)
    pos.addScaledVector(this.side, -this.par.x * 0.35)
    pos.y += this.par.y * 0.12
    // 呼吸漂移
    pos.y += Math.sin(this.time * 0.31) * 0.012
    pos.addScaledVector(this.side, Math.sin(this.time * 0.23 + 1) * 0.015)
    this.aim.copy(this.hero).setY(this.hero.y + FRAME.aim)

    // 主角在画框 heroX 处：视线绕世界 Y 轴向左偏 off（保持地平线水平）
    this.aim.sub(pos).applyAxisAngle(UP, off).add(pos)
    if (this.diveT >= 0) {
      // 俯冲（加载层 ~1.3 s 盖住）：0–0.45 s 主角转身面江、镜头推到他右肩后方；之后加速冲出楼顶、贴江面滑向象鼻山
      const t = this.diveT
      const a = T.MathUtils.smootherstep(t, 0, 0.45)
      const b = T.MathUtils.clamp((t - 0.42) / 1.0, 0, 1)
      const fwd = dirAz(VIEW.az)
      const side = this.shoulder.set(-fwd.z, 0, fwd.x)
      const sx = this.hero.x - fwd.x * 1.9 + side.x * 0.6, sz = this.hero.z - fwd.z * 1.9 + side.z * 0.6
      pos.lerp(this.shoulder.set(sx, this.hero.y + 1.72, sz), a)
      pos.addScaledVector(fwd, b * b * 230 + b * 10)
      // 先平着冲出楼沿（前进 ~6 m）再下坠：早降会从天台板里穿过去，顶上闪一帧黑檐
      pos.y -= T.MathUtils.smoothstep(b, 0.1, 0.85) * 34
      // 俯角：肩后 ~7°，冲出时压到 ~15°，滑翔抬回 ~4°
      const pitch = a * 0.12 + Math.sin(Math.PI * Math.min(1, b * 1.4)) * 0.14 - b * 0.06
      this.aim.lerp(this.shoulder.copy(pos).addScaledVector(fwd, 30).setY(pos.y - 30 * Math.tan(pitch)), a)
      cam.fov = vfov / DEG + a * 6 + b * b * 16
    }
    cam.position.copy(pos)
    cam.up.copy(UP)
    cam.lookAt(this.aim)
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    this.focalPx = Hf / 2 / Math.tan(vfov / 2)
    this.heroNdc.set(((left + hx * Wf) / W) * 2 - 1, 0)
  }
}
