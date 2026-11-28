// 主角：玩家捏好的角色（穿自己的初始穿搭）；没捏过 = 封面主角（老板定的外形 + 封面专属一套），游戏同款模型与描边着色。
// 头颈跟随鼠标；点他：挥手 / 回头看城 轮换；人物光随时间从落日逆光过渡到串灯暖光。
import * as T from 'three'
import type {Avatar} from '../../../../lib/avatar'
import {COVER_HERO_OUTFIT, starterOutfit, type EquippedOutfit} from '../../game/catalog'
import {currentAvatar, disposeCharacterParts, previewCharacter} from '../../walk/character'
import {resetCharacterLight, setCharacterLight} from '../../walk/character-light'
import {FRAME, SITE, SUN, dirAz} from './config'
import {PoseLayer} from './pose'

type Model = Awaited<ReturnType<typeof previewCharacter>>

/** 封面主角：男、暖米肤色、鹅蛋脸、平直眉、默认眼、微分碎盖（深棕黑） */
const COVER_HERO: Avatar = {v: 1, body: 'm', skin: 1, face: 1, brows: 0, eyes: 0, hair: 'm_crop', hairColor: 1, look: 'basic', createdAt: 1}

export function heroAvatar(): {avatar: Avatar; outfit: EquippedOutfit} {
  const own = currentAvatar()
  return own ? {avatar: own, outfit: starterOutfit(own.look)} : {avatar: COVER_HERO, outfit: COVER_HERO_OUTFIT}
}

/** 人物光三个关键时刻：日落逆光 → 蓝调 → 串灯夜色（tod 同 SKY_KEYS） */
const LIGHT_KEYS = [
  {t: 0, rim: 2.4, rimColor: '#ffc070', shade: '#9c8698', lit: '#ffd2a0', contrast: 0.62, sheen: 0.45, level: 0.68},
  {t: 0.4, rim: 2.2, rimColor: '#ff9a58', shade: '#8e7ca0', lit: '#ffc496', contrast: 0.62, sheen: 0.4, level: 0.62},
  {t: 0.68, rim: 1.4, rimColor: '#ff9a72', shade: '#5c66a0', lit: '#ffbc88', contrast: 0.62, sheen: 0.3, level: 0.38},
  {t: 1, rim: 1.6, rimColor: '#ffc27a', shade: '#46538c', lit: '#ffbc80', contrast: 0.64, sheen: 0.22, level: 0.25},
]
const C = Array.from({length: 6}, () => new T.Color())

const MAX_YAW = 1.05, MAX_PITCH = 0.42

export class Hero {
  readonly root = new T.Group()
  /** 拾取代理（不可见胶囊） */
  readonly proxy: T.Mesh
  private model?: Model
  private mixer?: T.AnimationMixer
  private head?: T.Bone
  private neck?: T.Bone
  private spine?: T.Bone
  /** 程序化站姿 / 呼吸 / 小动作（模型自带 idle 几乎不动） */
  private pose?: PoseLayer
  private look = new T.Vector2()
  private target = new T.Vector3()
  private hasTarget = false
  private faceYaw: number
  private turn = 0
  private turnT = -1
  /** 进游戏：转身面向 yaw（< 0 = 不在转身） */
  private departT = -1
  private departTurn = 0
  private act = 0
  private avatarKey = ''
  private disposed = false
  private q = new T.Quaternion()
  private qp = new T.Quaternion()
  private v = new T.Vector3()
  private rim = new T.Vector3()
  private key = new T.Vector3()
  private camPos = new T.Vector3()
  private right = new T.Vector3()

  constructor(at: T.Vector3, private reduced: boolean) {
    this.root.position.copy(at)
    // 模型正面朝 -Z。正对相机，再往画面左侧（开阔的城市那边）偏 FRAME.turn
    const len = Math.hypot(at.x, at.z) || 1
    const turn = (FRAME.turn * Math.PI) / 180
    const fx = (-at.x * Math.cos(turn) + at.z * Math.sin(turn)) / len
    const fz = (-at.z * Math.cos(turn) - at.x * Math.sin(turn)) / len
    this.faceYaw = Math.atan2(-fx, -fz)
    this.root.rotation.y = this.faceYaw
    const geo = new T.CylinderGeometry(0.32, 0.32, 1.75, 8).translate(0, 0.875, 0)
    this.proxy = new T.Mesh(geo, new T.MeshBasicMaterial({visible: false}))
    this.root.add(this.proxy)
  }

  get ready() {
    return !!this.model
  }

  /** 读当前头像（或预设）并换上；返回是否换了模型。 */
  async load() {
    const {avatar, outfit} = heroAvatar()
    const key = JSON.stringify({...avatar, createdAt: 0, outfit})
    if (key === this.avatarKey) return false
    this.avatarKey = key
    const model = await previewCharacter(avatar, outfit)
    if (this.disposed || key !== this.avatarKey) {
      disposeCharacterParts(model.scene)
      return false
    }
    this.release()
    this.model = model
    this.root.add(model.scene)
    this.mixer = new T.AnimationMixer(model.scene)
    this.idle()
    this.head = model.scene.getObjectByName('head') as T.Bone | undefined
    this.neck = model.scene.getObjectByName('neck_01') as T.Bone | undefined
    this.spine = model.scene.getObjectByName('spine_03') as T.Bone | undefined
    this.mixer.update(0)
    this.pose = new PoseLayer(model.scene, this.root, this.reduced)
    return true
  }

  private clip(name: string) {
    return this.model!.animations.find((c) => c.name === name)
  }
  private idle() {
    const idle = this.clip('idle')
    if (!this.mixer || !idle) return
    this.mixer.stopAllAction()
    this.mixer.clipAction(idle).reset().play()
  }

  /** 视线目标（世界坐标）；null = 看镜头附近 */
  lookAt(p: T.Vector3 | null) {
    this.hasTarget = !!p
    if (p) this.target.copy(p)
  }

  /** 点到主角：挥手 / 回头看城 / 挠头 轮换；新动作立刻接上（正在做的那个淡出），回头途中不打断 */
  poke() {
    const pose = this.pose
    if (!pose || this.reduced || this.turnT >= 0 || this.departT >= 0) return
    const n = this.act++ % 3
    if (n === 1) {
      pose.interrupt()
      this.turnT = 0
    } else pose.play(n === 0 ? 'wave' : 'scratch')
  }

  /** 调试：马上做一个小动作 */
  debugAct(name: string) {
    return this.pose?.play(name) ?? false
  }

  /** 调试：定住一个姿势名（STANCE 之上叠 ACTS 里的某个，'' = 只站姿，null = 正常轮换） */
  debugPose(name: string | null) {
    this.pose?.setDebug(name)
  }

  /** 进游戏：0.45 s 转身面朝 dir（水平方向），视线收回 */
  depart(dir: T.Vector3) {
    let d = Math.atan2(-dir.x, -dir.z) - this.faceYaw
    d = Math.atan2(Math.sin(d), Math.cos(d))
    this.departTurn = d
    this.departT = 0
    this.turnT = -1
  }
  /** 取消进游戏：回到正对镜头 */
  arrive() {
    this.departT = -1
    this.turn = 0
  }

  update(dt: number, camera: T.Camera, time: number) {
    this.camPos.copy(camera.position)
    if (!this.model || !this.mixer) return
    // 回头看城：0.9 s 转过去、停 2.4 s、转回来
    if (this.turnT >= 0) {
      this.turnT += dt
      const t = this.turnT
      const k = t < 0.9 ? T.MathUtils.smootherstep(t, 0, 0.9) : t < 3.3 ? 1 : 1 - T.MathUtils.smootherstep(t, 3.3, 4.3)
      this.turn = k * 2.35
      if (t > 4.3) this.turnT = -1
    }
    if (this.departT >= 0) {
      this.departT += dt
      this.turn = T.MathUtils.smootherstep(this.departT, 0, 0.45) * this.departTurn
    }
    this.root.rotation.y = this.faceYaw + this.turn
    // 先把姿态层碰过的骨骼放回静止姿态，再让动画写、姿态层叠、视线最后转头
    this.pose?.reset()
    this.mixer.update(dt)
    this.pose?.update(dt, this.turnT >= 0 || this.departT >= 0)
    if (this.head && this.neck) this.gaze(dt, camera, time, this.head)
    // 手最后落位：视线转完肩膀再够，插兜的手不会被转头带出兜
    this.pose?.reach()
  }

  /** 头颈跟随视线目标：偏航/俯仰分到胸、颈、头 */
  private gaze(dt: number, camera: T.Camera, time: number, head: T.Bone) {
    // 目标方向 → 相对身体朝向的偏航/俯仰（夹角、平滑）；回头时不跟
    this.root.updateMatrixWorld(true)
    const eye = head.getWorldPosition(this.v)
    const tgt = this.hasTarget
      ? this.target
      : camera.position.clone().add(new T.Vector3(Math.sin(time * 0.21) * 0.6, Math.sin(time * 0.37) * 0.2 - 0.1, 0))
    const d = tgt.clone().sub(eye)
    const bodyYaw = this.root.rotation.y
    let yaw = Math.atan2(-d.x, -d.z) - bodyYaw
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw))
    const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z))
    const on = this.turnT >= 0 || this.departT >= 0 ? 0 : 1 - (this.pose?.gazeOff ?? 0)
    const ty = T.MathUtils.clamp(yaw, -MAX_YAW, MAX_YAW) * on, tp = T.MathUtils.clamp(pitch, -MAX_PITCH, MAX_PITCH) * on
    const k = 1 - Math.exp(-dt * (this.reduced ? 30 : 5))
    this.look.x += (ty - this.look.x) * k
    this.look.y += (tp - this.look.y) * k
    // 分到 胸 20% / 颈 35% / 头 45%；绕世界 Y 偏航 + 绕身体右轴俯仰
    const right = this.right.set(Math.cos(bodyYaw + this.look.x), 0, -Math.sin(bodyYaw + this.look.x))
    for (const [bone, w] of [[this.spine, 0.2], [this.neck, 0.35], [this.head, 0.45]] as const) {
      if (!bone?.parent) continue
      this.q.setFromAxisAngle(UP, this.look.x * w).premultiply(this.qp.setFromAxisAngle(right, this.look.y * w))
      bone.parent.getWorldQuaternion(this.qp)
      // L' = P⁻¹ · Q · P · L
      const P = this.qp, Pi = P.clone().invert()
      bone.quaternion.premultiply(P).premultiply(this.q).premultiply(Pi)
      bone.updateMatrixWorld(true)
    }
  }

  /** 人物光：tod 驱动；sunDir 是落日方向（逆光轮廓光从这里来） */
  light(tod: number, sunDir: T.Vector3, flash: number) {
    let i = 0
    while (i < LIGHT_KEYS.length - 2 && tod > LIGHT_KEYS[i + 1].t) i++
    const a = LIGHT_KEYS[i], b = LIGHT_KEYS[i + 1]
    const k = T.MathUtils.smoothstep(tod, a.t, b.t)
    const l = (x: number, y: number) => x + (y - x) * k
    // 轮廓光：白天来自落日，入夜换成身后上方的串灯
    const night = T.MathUtils.smoothstep(tod, 0.55, 0.9)
    this.rim.copy(sunDir).setY(Math.max(sunDir.y, 0.15)).normalize().lerp(dirAz(SITE.heroAz, 0.9), night).normalize()
    // 主光：镜头左前上方（逆光人像靠天光和屋面反光塑形；左侧 = 开阔城市与落日那边）
    const to = this.v.copy(this.camPos).sub(this.root.position).setY(0).normalize()
    this.key.set(to.x * 0.55 - to.z * 0.65, 0.55, to.z * 0.55 + to.x * 0.65)
    setCharacterLight({
      keyFrom: [this.key.x, this.key.y, this.key.z],
      rim: l(a.rim, b.rim) * SUN.heroRim + flash * 0.4,
      rimColor: C[0].set(a.rimColor).lerp(C[1].set(b.rimColor), k),
      rimFrom: [this.rim.x, this.rim.y, this.rim.z],
      shade: C[2].set(a.shade).lerp(C[3].set(b.shade), k),
      lit: C[4].set(a.lit).lerp(C[5].set(b.lit), k),
      contrast: l(a.contrast, b.contrast),
      sheen: l(a.sheen, b.sheen),
      level: l(a.level, b.level) + flash * 0.25,
    })
  }

  private release() {
    if (!this.model) return
    this.mixer?.stopAllAction()
    this.model.scene.removeFromParent()
    disposeCharacterParts(this.model.scene)
    this.model = undefined
    this.mixer = undefined
    this.pose = undefined
  }

  dispose() {
    this.disposed = true
    this.release()
    this.proxy.geometry.dispose()
    ;(this.proxy.material as T.Material).dispose()
    resetCharacterLight()
  }
}

const UP = new T.Vector3(0, 1, 0)
