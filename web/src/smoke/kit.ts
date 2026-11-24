/**
 * 把烟盒 / 打火机 / 香烟摆到「手」和「嘴」上。
 *
 * 这一层不关心动作是谁驱动的：本地玩家由 figure.pose 的 smoke 叠加层把手抬到位，
 * 远端玩家用同一套叠加层（由网络包驱动），第一人称则把手和道具固定在相机前方。
 * 它只负责「给定几个锚点 + 一份 SmokeView，把道具摆好」。
 *
 * 坐标系约定（三层都一样）：-Z 朝前、+Y 朝上、+X 是角色的右手边。
 *   · 世界道具挂在 figure.root 下 → 局部空间就是角色空间；
 *   · 第一人称道具挂在跟着相机走的组下 → 局部空间就是相机空间。
 */

import * as THREE from 'three'
import {brandOf, type BrandDef, type BrandId} from './data'
import type {SmokeView} from './session'
import {
  createCigarette,
  createLighter,
  createPack,
  createStub,
  Parts,
  type CigaretteModel,
  type LighterModel,
  type PackModel,
} from './models'

/** 三个锚点都在道具的父空间里 */
export interface KitAnchors {
  handL: THREE.Vector3
  handR: THREE.Vector3
  forward: THREE.Vector3
  mouth: THREE.Vector3
}

/** 手持道具相对手腕的偏移（父空间，米） */
const PACK_OFFSET = new THREE.Vector3(0, -0.004, -0.026)
const LIGHTER_OFFSET = new THREE.Vector3(0, -0.012, -0.016)
/** 正常夹在手里：烟头朝上前方 */
const SMOKE_DIR = new THREE.Vector3(0, 0.82, -0.57).normalize()
const Z_AXIS = new THREE.Vector3(0, 0, 1)

export class SmokeKit {
  /** 挂到人物根节点（或第一人称相机组）上的容器 */
  readonly root = new THREE.Group()

  private scene: THREE.Scene
  private brandId: BrandId
  private packParts = new Parts()
  private lighterParts = new Parts()
  private cigParts = new Parts()
  private packModel: PackModel
  private lighterModel: LighterModel
  private cigModel: CigaretteModel
  private stubs: {group: THREE.Group; parts: Parts; born: number; origin:THREE.Vector3; floor:number; heading:number}[] = []
  private scratch = new THREE.Vector3()
  private dir = new THREE.Vector3()
  private openFilter = new THREE.Vector3()
  private hasOpenFilter = false
  private quat = new THREE.Quaternion()
  /** 非 null 时整组道具固定渲染在这个层（第一人称道具避开水面镜像） */
  private layer: number | null
  /** 手臂抬起程度的低通值，用来做显隐过渡 */
  private hold = 0
  /** 左手举烟盒权重的低通值 */
  private carry = 0
  /** 上一帧烟身剩余比例（熄灭后手臂放下那几帧继续沿用） */
  private lastLength = 1

  constructor(scene: THREE.Scene, brand: BrandId, layer: number | null = null) {
    this.scene = scene
    this.brandId = brand
    this.layer = layer
    this.root.name = 'smoke-kit'
    const definition = brandOf(brand)
    this.packModel = createPack(definition, this.packParts)
    this.lighterModel = createLighter(this.lighterParts)
    this.cigModel = createCigarette(definition, this.cigParts)
    this.root.add(this.packModel.group, this.lighterModel.group, this.cigModel.group)
    this.hideAll()
    this.applyLayer()
  }

  private applyLayer() {
    if (this.layer === null) return
    const layer = this.layer
    this.root.traverse(node => node.layers.set(layer))
  }

  get pack(){return this.packModel.group}
  get lighter(){return this.lighterModel.group}
  get cigarette(){return this.cigModel.group}
  get brand(): BrandDef {
    return brandOf(this.brandId)
  }

  /**
   * 换品牌：烟盒的包装贴图和香烟的过滤嘴都绑死了品牌，直接重建这两个模型。
   * 打火机和品牌无关，留着。
   */
  setBrand(brand: BrandId) {
    if (brand === this.brandId) return
    this.brandId = brand
    this.root.remove(this.packModel.group, this.cigModel.group)
    this.packParts.dispose()
    this.cigParts.dispose()
    this.packParts = new Parts()
    this.cigParts = new Parts()
    const definition = brandOf(brand)
    this.packModel = createPack(definition, this.packParts)
    this.cigModel = createCigarette(definition, this.cigParts)
    this.root.add(this.packModel.group, this.cigModel.group)
    this.lastLength = 1
    this.hideAll()
    this.applyLayer()
  }

  private hideAll() {
    this.packModel.group.visible = false
    this.lighterModel.group.visible = false
    this.cigModel.group.visible = false
  }

  /**
   * 按当前视图摆好道具。
   * @param view 状态机给的视图
   * @param anchors 手/嘴在父空间的位置
   */
  apply(view: SmokeView, anchors: KitAnchors) {
    // 显隐靠两条低通：hold 管右手（夹烟），carry 管左手（举烟盒）。
    // 烟灭了以后两条都会缓动回 0，道具跟着手一起放下去再消失，不会在半空中啪一下不见。
    // 自己做低通是因为远端玩家上报的是 0/1 的硬状态。
    this.hold += (view.hold - this.hold) * 0.18
    this.carry += (view.carry - this.carry) * 0.18
    const right = this.hold > 0.02
    const left = this.carry > 0.02
    this.packModel.group.visible = left
    this.lighterModel.group.visible = right && view.light > 0.05
    this.cigModel.group.visible = right && (view.cig > 0.01 || view.ember > 0.01)
    if (!right && !left) {
      this.lighterModel.setFlame(0)
      return
    }

    // —— 烟盒：左手（点着之后就收回兜里，不再挡在胸前） ——
    if (left) {
      this.packModel.group.position.copy(anchors.handL).add(PACK_OFFSET)
      // 取烟时掀盖 + 露一截烟头
      const open=view.phase==='tear'?view.progress:['open','take'].includes(view.phase)?1:0
      this.packModel.group.rotation.set(.25,.12,-.10)
      this.packModel.group.position.z+=.035
      this.packModel.group.position.y-=(1-this.carry)*.18
      this.packModel.lid.rotation.x = -open * 1.85
      this.packModel.seal.visible=open<1
      this.packModel.seal.scale.y=1-open
      this.packModel.seal.position.y=-open*.044
      const peeled=this.packModel.peeled
      peeled.visible=view.phase==='tear' && open>0
      peeled.position.set(.018+.026*open,.044-.088*open,.013)
      peeled.scale.x=.052*open
      this.packModel.peek.visible = view.phase==='open' || view.phase==='tear' && open>.7
      const topFilter=this.packModel.filters[Math.max(0,view.remaining-1)]
      this.packModel.peek.position.x=topFilter.position.x
      this.packModel.peek.position.z=topFilter.position.z
      this.packModel.filters.forEach((filter,index)=>{filter.visible=index<view.remaining})
      this.packModel.peek.position.y = 0.0405 + open * 0.016
      if(view.phase==='open'){
        this.pinchPoint(view,this.openFilter)
        this.hasOpenFilter=true
      }else if(view.phase!=='take')this.hasOpenFilter=false
    }

    if (!right) {
      this.lighterModel.setFlame(0)
      return
    }

    // —— 打火机：右手（只在点烟那一段出现） ——
    if (this.lighterModel.group.visible) {
      this.lighterModel.group.position.copy(anchors.handL).add(LIGHTER_OFFSET)
      this.lighterModel.group.rotation.set(.72,0,-.66,'XYZ')
      this.lighterModel.setFlame(view.flame)
    } else {
      this.lighterModel.setFlame(0)
    }

    // —— 香烟：点着时夹在右手，点烟/吸的时候送到嘴边 ——
    const atMouth = view.phase==='take'?view.progress:1
    const start=view.phase==='take' && this.hasOpenFilter?this.openFilter:anchors.handR
    this.scratch.copy(start).lerp(anchors.mouth,atMouth)
    if(view.phase==='take')this.scratch.y+=.035*Math.sin(atMouth*Math.PI)
    // 夹烟：方向跟着手走，位置从手腕挪到指缝（不然烟是从拳头正中穿出来的）
    this.dir.copy(SMOKE_DIR)
    this.dir.lerp(anchors.forward, atMouth).normalize()
    // 注意：烟的原点就在「过滤嘴中心」（filter 在 z=-0.020..0.005，烟纸从 z=0.005 往 +Z 长），
    // 所以位置一定要留在指缝上。之前为了让烟纸露出来额外加了 4 cm 前移，
    // 等于把过滤嘴推出指缝、让手指夹到烟纸上——这就是「捏的是烟草那截」的原因，已经删掉。
    this.cigModel.group.position.copy(this.scratch).addScaledVector(this.dir,.015*atMouth)
    this.quat.setFromUnitVectors(Z_AXIS, this.dir)
    this.cigModel.group.quaternion.copy(this.quat)
    // 点着之后每吸一口短一截；点烟阶段是整根新的。
    // 熄灭/抽完的那几帧手臂还在缓动放下，这时候要保持「已经烧短了」的样子，
    // 否则最后一帧会突然变回一整根烟。
    const length = view.phase === 'smoking' ? view.length : view.phase === 'idle' ? this.lastLength : 1
    this.lastLength = length
    this.cigModel.setLength(length)
    // 吸一口的时候火星会亮一下
    this.cigModel.setEmber(view.ember * (1 + view.puff * 0.9))
  }

  pinchPoint(view:SmokeView,out:THREE.Vector3){
    if(view.phase==='open'){
      out.copy(this.packModel.peek.position)
      out.y+=.022
    }else{
      const tear=view.phase==='tear'?view.progress:0
      out.set(.018+.052*tear,.044-.088*tear,.013)
    }
    return out.applyQuaternion(this.pack.quaternion).add(this.pack.position)
  }

  /** 火星在世界空间的位置（烟雾从这里冒） */
  tipWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.cigModel.tipWorld(out)
  }

  /** 打火机火焰尖端的世界坐标 */
  flameWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.lighterModel.tipWorld(out)
  }

  /** 在脚下扔一根烟蒂（世界坐标） */
  dropStub(position: THREE.Vector3, length=0) {
    const parts = new Parts()
    const discarded=length>0?createCigarette(this.brand,parts):null
    discarded?.setLength(length)
    const stub=discarded?.group??createStub(this.brand,parts)
    this.cigModel.group.getWorldPosition(stub.position)
    this.cigModel.group.getWorldQuaternion(stub.quaternion)
    const launch=this.dir.set(0,0,1).applyQuaternion(stub.quaternion)
    const heading=Math.atan2(-launch.x,-launch.z)
    this.scene.add(stub)
    this.stubs.push({group: stub, parts, born: performance.now(), origin:stub.position.clone(),floor:position.y+.0075,heading})
    // 只保留最近 12 根，别让全城铺满烟屁股
    while (this.stubs.length > 12) {
      const oldest = this.stubs.shift()!
      this.scene.remove(oldest.group)
      oldest.parts.dispose()
    }
  }

  /** 每帧收尾：两分钟后旧烟蒂自己消失 */
  tick(now: number) {
    for(const stub of this.stubs){
      const t=Math.min((now-stub.born)/1000,Math.sqrt(Math.max(0,stub.origin.y-stub.floor)/4.9))
      stub.group.position.set(stub.origin.x-Math.sin(stub.heading)*t*.7,Math.max(stub.floor,stub.origin.y-4.9*t*t),stub.origin.z-Math.cos(stub.heading)*t*.7)
      stub.group.rotation.x=stub.group.position.y>stub.floor?t*7:0
    }
    while (this.stubs.length && now - this.stubs[0].born > 4500) {
      const oldest = this.stubs.shift()!
      this.scene.remove(oldest.group)
      oldest.parts.dispose()
    }
  }

  dispose() {
    for (const stub of this.stubs) {
      this.scene.remove(stub.group)
      stub.parts.dispose()
    }
    this.stubs.length = 0
    this.root.removeFromParent()
    this.packParts.dispose()
    this.lighterParts.dispose()
    this.cigParts.dispose()
  }
}

export {SMOKE_ANCHORS, VIEW_ANCHORS} from './anchors'
