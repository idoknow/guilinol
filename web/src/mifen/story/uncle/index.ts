import * as THREE from 'three'
import {
  getUnclePortraitUrl,
  PLAYER_PORTRAIT,
  UNCLE_EXPRESSION_IDS,
  UNCLE_PORTRAITS,
  type UncleExpressionId,
} from './portraits'

export {
  getUnclePortraitUrl,
  PLAYER_PORTRAIT,
  UNCLE_EXPRESSION_IDS,
  UNCLE_PORTRAITS,
  type UncleExpressionId,
}

/**
 * 表叔门店局部站位 `[x, y, z]`（正门西侧窗前外沿，距正门 GLASS_Z=7.10 外扩 0.52m）：
 * - 距正门洞 [0.30..1.90, 7.10]：西侧净偏 Δx=0.48m、门中心距 1.38m、entrance(1.10,7.35) 距 1.31m（不挡门）
 * - 距室外最近排队点 #6(1.15, 7.70)：1.33m；#7(1.15, 8.60)：1.65m（Lv1/Lv2 全在室内，Lv3 不压排队点）
 * - 距 Lv3 外摆 Table2(-1.0, 8.4, 0.7x0.6) 最近角点 0.67m，距东圆凳(-0.5, 8.4) 0.84m，距其余桌凳 >=2.16m（Lv1/Lv2 无外摆座）
 */
export const UNCLE_SPOT: readonly [number, number, number] = [-0.18, 0, 7.62]

export type UncleMarkerMode = 'new' | 'none'

export interface UncleNpcOptions {
  /** 可选场景容器；传入时自动挂载 group，dispose 时自动移除 */
  scene?: THREE.Object3D | null
}

export interface UncleNpcController {
  readonly group: THREE.Group
  setPose(x: number, y: number, z: number, yaw: number): void
  setMarker(mode: UncleMarkerMode): void
  setTalking(on: boolean): void
  setExpression(id: UncleExpressionId): void
  headWorld(out?: THREE.Vector3): THREE.Vector3
  step(
    dt: number,
    time: number,
    night: number,
    playerPos?: THREE.Vector3 | {x: number; y?: number; z: number} | null,
  ): void
  dispose(): void
}

function makeFabricTexture(
  baseHex: string,
  accentHex: string,
  pattern: 'denim' | 'apron' | 'towel' | 'bandage' | 'watch',
  size = 128,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = baseHex
    ctx.fillRect(0, 0, size, size)

    if (pattern === 'denim') {
      ctx.strokeStyle = accentHex
      ctx.lineWidth = 1
      for (let i = -size; i < size * 2; i += 6) {
        ctx.globalAlpha = 0.22
        ctx.beginPath()
        ctx.moveTo(i, 0)
        ctx.lineTo(i + size, size)
        ctx.stroke()
      }
      ctx.globalAlpha = 0.16
      ctx.fillStyle = '#8aa4c4'
      ctx.fillRect(16, 20, size - 32, 18)
      ctx.fillRect(10, 82, size - 20, 20)
    } else if (pattern === 'apron') {
      ctx.strokeStyle = accentHex
      ctx.globalAlpha = 0.3
      ctx.lineWidth = 2
      for (let y = 8; y < size; y += 16) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(size, y)
        ctx.stroke()
      }
      ctx.globalAlpha = 0.5
      ctx.strokeRect(18, 52, size - 36, size - 68)
    } else if (pattern === 'towel') {
      ctx.fillStyle = accentHex
      ctx.globalAlpha = 0.88
      ctx.fillRect(0, size * 0.16, size, size * 0.08)
      ctx.fillRect(0, size * 0.76, size, size * 0.08)
      ctx.globalAlpha = 0.14
      ctx.fillStyle = '#c8bfb0'
      for (let y = 0; y < size; y += 4) {
        ctx.fillRect(0, y, size, 1)
      }
    } else if (pattern === 'bandage') {
      ctx.strokeStyle = accentHex
      ctx.lineWidth = 4
      ctx.globalAlpha = 0.55
      for (let y = -size; y < size * 2; y += 14) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(size, y + size * 0.45)
        ctx.stroke()
      }
      ctx.fillStyle = '#cf5a4c'
      ctx.globalAlpha = 0.75
      ctx.fillRect(size * 0.42, size * 0.44, size * 0.16, size * 0.12)
    } else if (pattern === 'watch') {
      const cx = size / 2
      const cy = size / 2
      ctx.fillStyle = '#f5f1e4'
      ctx.beginPath()
      ctx.arc(cx, cy, size * 0.42, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#3c3024'
      ctx.lineWidth = 4
      ctx.stroke()
      ctx.fillStyle = '#241c14'
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2
        ctx.beginPath()
        ctx.arc(cx + Math.sin(a) * size * 0.32, cy - Math.cos(a) * size * 0.32, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.strokeStyle = '#1b1610'
      ctx.lineWidth = 3.5
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + size * 0.16, cy - size * 0.14)
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx - size * 0.06, cy - size * 0.28)
      ctx.stroke()
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function clampAngle(rad: number): number {
  let a = rad
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

export function createUncleNpc(opts: UncleNpcOptions = {}): UncleNpcController {
  const geos: THREE.BufferGeometry[] = []
  const mats: THREE.Material[] = []
  const texs: THREE.Texture[] = []

  const ownGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g)
    return g
  }
  const ownTex = <T extends THREE.Texture>(t: T): T => {
    texs.push(t)
    return t
  }
  const ownMat = <T extends THREE.Material>(m: T): T => {
    mats.push(m)
    return m
  }

  // 程序化质感贴图
  const jacketTex = ownTex(makeFabricTexture('#293d58', '#1b293c', 'denim'))
  const apronTex = ownTex(makeFabricTexture('#e8dec3', '#c8b896', 'apron'))
  const towelTex = ownTex(makeFabricTexture('#f6f1e6', '#3d6ea3', 'towel'))
  const bandageTex = ownTex(makeFabricTexture('#f7f4ec', '#d7cfc0', 'bandage'))
  const watchDialTex = ownTex(makeFabricTexture('#f5f1e4', '#3c3024', 'watch'))

  // 材质集（含夜间柔和补光自发光，绝不新建 THREE.*Light）
  const litMats: Array<{mat: THREE.MeshStandardMaterial; base: number; nightBoost: number}> = []
  const std = (params: THREE.MeshStandardMaterialParameters, baseEmissive = 0, nightBoost = 0.16) => {
    const m = ownMat(
      new THREE.MeshStandardMaterial({
        metalness: 0.02,
        roughness: 0.82,
        emissive: params.color ?? 0xffe4c4,
        emissiveIntensity: baseEmissive,
        ...params,
      }),
    )
    if (m.map && !m.emissiveMap) m.emissiveMap = m.map
    litMats.push({mat: m, base: baseEmissive, nightBoost})
    return m
  }

  const skinMat = std({color: 0xe3b187, roughness: 0.74, emissive: 0xffe0c4}, 0, 0.18)
  const hairMat = std({color: 0x25272d, roughness: 0.88, emissive: 0x3b3f4a}, 0, 0.12)
  const templeGreyMat = std({color: 0x9197a3, roughness: 0.86, emissive: 0xc8ced8}, 0, 0.16)
  const teeMat = std({color: 0xd9d2c4, roughness: 0.86, emissive: 0xfff5e4}, 0, 0.16)
  const jacketMat = std({map: jacketTex, color: 0xffffff, roughness: 0.86, emissive: 0x7694bc}, 0, 0.2)
  const jacketTrimMat = std({color: 0x3e5676, roughness: 0.82, emissive: 0x7b96b8}, 0, 0.2)
  const apronMat = std({map: apronTex, color: 0xffffff, roughness: 0.84, emissive: 0xfff2dc, side: THREE.DoubleSide}, 0, 0.22)
  const pantsMat = std({color: 0x353c38, roughness: 0.9, emissive: 0x5c6660}, 0, 0.14)
  const shoeMat = std({color: 0x241e1a, roughness: 0.9, emissive: 0x453b34}, 0, 0.1)
  const towelMat = std({map: towelTex, color: 0xffffff, roughness: 0.9, emissive: 0xfff8ed, side: THREE.DoubleSide}, 0, 0.24)
  const bandageMat = std({map: bandageTex, color: 0xffffff, roughness: 0.78, emissive: 0xfff7ea}, 0.04, 0.28)
  const watchBandMat = std({color: 0x4a2f1d, roughness: 0.65, metalness: 0.08, emissive: 0x70492e}, 0, 0.15)
  const watchMetalMat = std({color: 0xbac0c8, roughness: 0.34, metalness: 0.28, emissive: 0xdfe4ec}, 0.04, 0.22)
  const watchDialMat = std({map: watchDialTex, color: 0xffffff, roughness: 0.4, emissive: 0xffffff}, 0.05, 0.28)
  const scleraMat = std({color: 0xfbf8f2, roughness: 0.35, emissive: 0xffffff}, 0.05, 0.24)
  const pupilMat = std({color: 0x1b1613, roughness: 0.3, emissive: 0x2a201a}, 0, 0.06)
  const mouthMat = std({color: 0x7a3830, roughness: 0.6, emissive: 0x9c4c40}, 0, 0.15)
  const ticketMat = std({color: 0xf4cf6b, roughness: 0.8, emissive: 0xffdf85}, 0, 0.2)

  // 黄色感叹号标识（保留 depthTest:true 以严格被实墙遮挡，fog:false 保 25m+ 远距明度）
  const markerYellowMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0xffe433,
      emissive: 0xffcc00,
      emissiveIntensity: 0.95,
      roughness: 0.35,
      metalness: 0.02,
      fog: false,
      depthTest: true,
      depthWrite: true,
    }),
  )
  const markerOutlineMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0x1b1204,
      emissive: 0x140d02,
      emissiveIntensity: 0.15,
      roughness: 0.9,
      metalness: 0,
      fog: false,
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: true,
    }),
  )

  const group = new THREE.Group()
  group.name = 'tianyuan.uncle-npc'

  // 相机探测微粒，让 step(dt, time, night) 不传第 4 参时也能自动感知玩家视角方向
  const probeGeo = ownGeo(new THREE.BufferGeometry())
  probeGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3))
  const probeMat = ownMat(
    new THREE.MeshStandardMaterial({colorWrite: false, depthWrite: false, depthTest: false, transparent: true, opacity: 0}),
  )
  const probeMesh = new THREE.Mesh(probeGeo, probeMat)
  probeMesh.frustumCulled = false
  probeMesh.name = 'tianyuan.uncle-probe'
  const camWorld = new THREE.Vector3()
  let camSeen = false
  probeMesh.onBeforeRender = (_r, _s, cam) => {
    camWorld.setFromMatrixPosition(cam.matrixWorld)
    camSeen = true
  }
  group.add(probeMesh)

  // 身体根节点（呼吸律动）
  const bodyPivot = new THREE.Group()
  group.add(bodyPivot)

  // ─── 下肢：稳重工装裤 + 卷裤脚 + 胶鞋 ───
  const buildLeg = (sideX: number) => {
    const leg = new THREE.Group()
    leg.position.set(sideX, 0.78, 0)
    const upper = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.088, 0.078, 0.38, 8)), pantsMat)
    upper.position.y = -0.19
    const lower = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.076, 0.068, 0.3, 8)), pantsMat)
    lower.position.y = -0.52
    const cuff = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.074, 0.074, 0.045, 8)), shoeMat)
    cuff.position.y = -0.66
    const shoe = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.145, 0.085, 0.24)), shoeMat)
    shoe.position.set(0, -0.735, 0.035)
    leg.add(upper, lower, cuff, shoe)
    bodyPivot.add(leg)
    return leg
  }
  buildLeg(-0.125)
  buildLeg(0.125)

  // ─── 上身躯干：洗旧藏青工装外套（敞开翻领+口袋+纽扣）+ 内搭浅灰棉衫 + 米色围裙 ───
  const torsoPivot = new THREE.Group()
  torsoPivot.position.set(0, 0.78, 0)
  bodyPivot.add(torsoPivot)

  // 内搭圆领棉T
  const teeBody = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.205, 0.19, 0.56, 10).scale(1.12, 1, 0.72)), teeMat)
  teeBody.position.y = 0.29
  torsoPivot.add(teeBody)

  // 藏青工装外套后片 + 左右前片（留出中门衬托内搭）+ 翻领 + 胸袋
  const jacketBack = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.46, 0.58, 0.16)), jacketMat)
  jacketBack.position.set(0, 0.3, -0.068)
  torsoPivot.add(jacketBack)

  const jacketPanelG = ownGeo(new THREE.BoxGeometry(0.155, 0.58, 0.135))
  const jacketPocketG = ownGeo(new THREE.BoxGeometry(0.105, 0.115, 0.018))
  const pocketFlapG = ownGeo(new THREE.BoxGeometry(0.108, 0.03, 0.022))
  for (const sx of [-1, 1] as const) {
    const panel = new THREE.Mesh(jacketPanelG, jacketMat)
    panel.position.set(sx * 0.155, 0.3, 0.068)
    const lapel = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.065, 0.22, 0.024)), jacketTrimMat)
    lapel.position.set(sx * 0.09, 0.49, 0.138)
    lapel.rotation.z = sx * -0.18
    const pkt = new THREE.Mesh(jacketPocketG, jacketMat)
    pkt.position.set(sx * 0.155, 0.36, 0.138)
    const flap = new THREE.Mesh(pocketFlapG, jacketTrimMat)
    flap.position.set(sx * 0.155, 0.422, 0.14)
    torsoPivot.add(panel, lapel, pkt, flap)
  }
  const jacketCollar = new THREE.Mesh(ownGeo(new THREE.TorusGeometry(0.125, 0.032, 6, 10, Math.PI * 1.45)), jacketTrimMat)
  jacketCollar.position.set(0, 0.575, -0.01)
  jacketCollar.rotation.set(Math.PI / 2, 0, Math.PI * 0.78)
  torsoPivot.add(jacketCollar)

  // 米色围裙（护胸 + 挂脖带 + 大摆围兜 + 大口袋露单据 + 后腰系带）
  const apronBib = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.25, 0.24, 0.02)), apronMat)
  apronBib.position.set(0, 0.38, 0.152)
  const apronSkirt = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.24, 0.265, 0.54, 10, 1, false, -Math.PI * 0.48, Math.PI * 0.96).scale(1.06, 1, 0.72)), apronMat)
  apronSkirt.position.set(0, 0.03, 0.03)
  const apronPocket = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.18, 0.14, 0.02)), apronMat)
  apronPocket.position.set(0, 0.07, 0.185)
  const pocketTicket = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.06, 0.075, 0.008)), ticketMat)
  pocketTicket.position.set(0.04, 0.13, 0.188)
  pocketTicket.rotation.z = -0.15
  const neckStrap = new THREE.Mesh(ownGeo(new THREE.TorusGeometry(0.135, 0.011, 5, 12, Math.PI * 1.25)), apronMat)
  neckStrap.position.set(0, 0.56, 0.02)
  neckStrap.rotation.set(Math.PI / 2 + 0.35, 0, Math.PI * 0.88)
  const waistBelt = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.244, 0.244, 0.036, 12).scale(1.04, 1, 0.74)), apronMat)
  waistBelt.position.set(0, 0.27, 0.005)
  const tieL = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.032, 0.2, 0.012)), apronMat)
  tieL.position.set(-0.045, 0.17, -0.175)
  tieL.rotation.set(0.12, 0, 0.24)
  const tieR = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.032, 0.22, 0.012)), apronMat)
  tieR.position.set(0.045, 0.16, -0.175)
  tieR.rotation.set(0.12, 0, -0.22)
  torsoPivot.add(apronBib, apronSkirt, apronPocket, pocketTicket, neckStrap, waistBelt, tieL, tieR)

  // 搭肩毛巾（主角解剖学左侧 +X 肩部，前搭胸前、顶过肩、后垂肩背，带蓝边条纹）
  const towelGroup = new THREE.Group()
  towelGroup.position.set(0.185, 0.56, 0.0)
  const towelTop = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.135, 0.036, 0.24)), towelMat)
  towelTop.position.set(0, 0.045, 0)
  towelTop.rotation.z = -0.1
  const towelFront = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.128, 0.29, 0.028)), towelMat)
  towelFront.position.set(0.006, -0.095, 0.132)
  towelFront.rotation.x = -0.14
  const towelBack = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.128, 0.23, 0.028)), towelMat)
  towelBack.position.set(0.006, -0.065, -0.128)
  towelBack.rotation.x = 0.14
  towelGroup.add(towelTop, towelFront, towelBack)
  torsoPivot.add(towelGroup)

  // ─── 手臂：左臂(+X，卷袖+老式手表，可大幅度说话手势)；右臂(-X，卷袖+右手腕白色医用绷带，护腕内收) ───
  const buildArm = (isLeft: boolean) => {
    const sign = isLeft ? 1 : -1
    const shoulder = new THREE.Group()
    shoulder.position.set(sign * 0.295, 0.54, 0)
    const upperSleeve = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.064, 0.056, 0.25, 8)), jacketMat)
    upperSleeve.position.y = -0.11
    const cuffRing = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.062, 0.062, 0.04, 8)), jacketTrimMat)
    cuffRing.position.y = -0.22
    shoulder.add(upperSleeve, cuffRing)

    const elbow = new THREE.Group()
    elbow.position.set(0, -0.24, 0)
    const forearm = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.048, 0.041, 0.23, 8)), skinMat)
    forearm.position.y = -0.11
    const hand = new THREE.Mesh(ownGeo(new THREE.SphereGeometry(0.045, 7, 6).scale(0.85, 1.15, 0.95)), skinMat)
    hand.position.set(0, -0.245, 0.01)
    elbow.add(forearm, hand)

    if (isLeft) {
      // 左手腕老式手表（深棕皮表带 + 金属表壳 + 清楚白面黑针表盘）
      const strap = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.046, 0.046, 0.032, 10)), watchBandMat)
      strap.position.y = -0.175
      const bezel = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 12).rotateX(Math.PI / 2)), watchMetalMat)
      bezel.position.set(0, -0.175, 0.044)
      const dial = new THREE.Mesh(ownGeo(new THREE.CircleGeometry(0.021, 12)), watchDialMat)
      dial.position.set(0, -0.175, 0.051)
      elbow.add(strap, bezel, dial)
    } else {
      // 右手腕白色医用加厚绷带（包裹前臂下段至腕根 + 交叉胶布结）
      const wrapMain = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.056, 0.051, 0.13, 10)), bandageMat)
      wrapMain.position.y = -0.155
      const wrapRingTop = new THREE.Mesh(ownGeo(new THREE.TorusGeometry(0.052, 0.008, 5, 10).rotateX(Math.PI / 2)), bandageMat)
      wrapRingTop.position.y = -0.105
      const wrapRingBot = new THREE.Mesh(ownGeo(new THREE.TorusGeometry(0.049, 0.008, 5, 10).rotateX(Math.PI / 2)), bandageMat)
      wrapRingBot.position.y = -0.205
      elbow.add(wrapMain, wrapRingTop, wrapRingBot)
    }

    shoulder.add(elbow)
    torsoPivot.add(shoulder)
    return {shoulder, elbow}
  }
  const leftArmRig = buildArm(true)
  const rightArmRig = buildArm(false)

  // ─── 头部与五表情（中年微方颌 + 灰鬓寸头背梳 + 眉/眼/胡茬/口型可随表情与说话改变） ───
  const neck = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.068, 0.076, 0.11, 8)), skinMat)
  neck.position.set(0, 0.62, 0)
  torsoPivot.add(neck)

  const headPivot = new THREE.Group()
  headPivot.position.set(0, 0.78, 0.01)
  torsoPivot.add(headPivot)

  const skull = new THREE.Mesh(ownGeo(new THREE.SphereGeometry(0.165, 14, 12).scale(0.94, 1.06, 0.98)), skinMat)
  const jaw = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.21, 0.12, 0.18)), skinMat)
  jaw.position.set(0, -0.072, 0.022)
  const earG = ownGeo(new THREE.SphereGeometry(0.034, 6, 5).scale(0.45, 1, 0.7))
  const earL = new THREE.Mesh(earG, skinMat)
  earL.position.set(0.156, -0.01, -0.01)
  const earR = new THREE.Mesh(earG, skinMat)
  earR.position.set(-0.156, -0.01, -0.01)
  const nose = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.032, 0.056, 0.048)), skinMat)
  nose.position.set(0, -0.018, 0.164)
  nose.rotation.x = -0.18
  headPivot.add(skull, jaw, earL, earR, nose)

  // 花白鬓角中年大背头短发（弧面贴合颅顶，避免硬块帽檐感）
  const hairCrown = new THREE.Mesh(
    ownGeo(new THREE.SphereGeometry(0.172, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.95, 1.0, 1.0)),
    hairMat,
  )
  hairCrown.position.set(0, 0.018, -0.01)
  hairCrown.rotation.x = -0.18
  const hairTopSweep = new THREE.Mesh(
    ownGeo(new THREE.SphereGeometry(0.138, 10, 7).scale(0.86, 0.36, 1.04)),
    hairMat,
  )
  hairTopSweep.position.set(0, 0.132, -0.008)
  hairTopSweep.rotation.x = -0.2
  const hairBack = new THREE.Mesh(ownGeo(new THREE.SphereGeometry(0.13, 8, 6).scale(0.94, 0.58, 0.45)), hairMat)
  hairBack.position.set(0, -0.02, -0.125)
  const sideburnG = ownGeo(new THREE.BoxGeometry(0.03, 0.092, 0.09))
  const sbL = new THREE.Mesh(sideburnG, templeGreyMat)
  sbL.position.set(0.144, 0.014, -0.012)
  const sbR = new THREE.Mesh(sideburnG, templeGreyMat)
  sbR.position.set(-0.144, 0.014, -0.012)
  headPivot.add(hairCrown, hairTopSweep, hairBack, sbL, sbR)

  // 八字微灰胡茬 + 眉毛 + 眼睛 + 嘴巴
  const stacheG = ownGeo(new THREE.BoxGeometry(0.05, 0.018, 0.024))
  const stacheL = new THREE.Mesh(stacheG, templeGreyMat)
  stacheL.position.set(0.028, -0.058, 0.158)
  stacheL.rotation.z = -0.24
  const stacheR = new THREE.Mesh(stacheG, templeGreyMat)
  stacheR.position.set(-0.028, -0.058, 0.158)
  stacheR.rotation.z = 0.24
  headPivot.add(stacheL, stacheR)

  const eyeWhiteG = ownGeo(new THREE.SphereGeometry(0.022, 8, 6).scale(1.1, 0.72, 0.4))
  const pupilG = ownGeo(new THREE.SphereGeometry(0.011, 6, 5).scale(1, 1, 0.5))
  const browG = ownGeo(new THREE.BoxGeometry(0.058, 0.016, 0.022))

  const eyeL = new THREE.Group()
  eyeL.position.set(0.055, 0.024, 0.152)
  const eyeLw = new THREE.Mesh(eyeWhiteG, scleraMat)
  const eyeLp = new THREE.Mesh(pupilG, pupilMat)
  eyeLp.position.z = 0.008
  eyeL.add(eyeLw, eyeLp)

  const eyeR = new THREE.Group()
  eyeR.position.set(-0.055, 0.024, 0.152)
  const eyeRw = new THREE.Mesh(eyeWhiteG, scleraMat)
  const eyeRp = new THREE.Mesh(pupilG, pupilMat)
  eyeRp.position.z = 0.008
  eyeR.add(eyeRw, eyeRp)

  const browL = new THREE.Mesh(browG, hairMat)
  browL.position.set(0.055, 0.058, 0.156)
  const browR = new THREE.Mesh(browG, hairMat)
  browR.position.set(-0.055, 0.058, 0.156)

  const mouth = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.068, 0.016, 0.02)), mouthMat)
  mouth.position.set(0, -0.09, 0.15)
  headPivot.add(eyeL, eyeR, browL, browR, mouth)

  // ─── 头顶黄色感叹号标识（加粗高对比立体造型 + 远距缩放补偿，25m+ 醒目、严格 depthTest 不穿墙） ───
  const markerPivot = new THREE.Group()
  markerPivot.name = 'tianyuan.uncle-marker'
  markerPivot.position.set(0, 2.28, 0)

  const markBarGeo = ownGeo(new THREE.CylinderGeometry(0.092, 0.058, 0.4, 8))
  const markDotGeo = ownGeo(new THREE.SphereGeometry(0.072, 10, 8))
  const markBar = new THREE.Mesh(markBarGeo, markerYellowMat)
  markBar.position.y = 0.16
  const markBarOutline = new THREE.Mesh(markBarGeo, markerOutlineMat)
  markBarOutline.position.y = 0.16
  markBarOutline.scale.setScalar(1.2)

  const markDot = new THREE.Mesh(markDotGeo, markerYellowMat)
  markDot.position.y = -0.16
  const markDotOutline = new THREE.Mesh(markDotGeo, markerOutlineMat)
  markDotOutline.position.y = -0.16
  markDotOutline.scale.setScalar(1.22)

  markerPivot.add(markBar, markBarOutline, markDot, markDotOutline)
  group.add(markerPivot)

  if (opts.scene) opts.scene.add(group)

  // 运行时状态
  let markerMode: UncleMarkerMode = 'new'
  let talking = false
  let talkBlend = 0
  let curExpr: UncleExpressionId = 'neutral'
  let curHeadYaw = 0
  let curHeadPitch = 0
  let disposed = false
  const tmpWorldPos = new THREE.Vector3()
  const tmpHeadWorld = new THREE.Vector3()

  const applyExpressionPose = (id: UncleExpressionId, talkMouth: number) => {
    let browTiltL = 0
    let browTiltR = 0
    let browY = 0.058
    let eyeScaleY = 1
    let mouthScaleX = 1
    let mouthScaleY = 1
    let mouthRotZ = 0

    if (id === 'smile') {
      browY = 0.065
      browTiltL = 0.08
      browTiltR = -0.08
      eyeScaleY = 0.72
      mouthScaleX = 1.18
      mouthScaleY = 1.2
    } else if (id === 'worry') {
      browY = 0.062
      browTiltL = -0.26
      browTiltR = 0.26
      eyeScaleY = 0.92
      mouthScaleX = 0.92
      mouthScaleY = 0.9
      mouthRotZ = 0.06
    } else if (id === 'proud') {
      browY = 0.066
      browTiltL = 0.14
      browTiltR = -0.04
      eyeScaleY = 0.84
      mouthScaleX = 1.12
      mouthRotZ = -0.08
    } else if (id === 'laugh') {
      browY = 0.072
      browTiltL = 0.16
      browTiltR = -0.16
      eyeScaleY = 0.42
      mouthScaleX = 1.32
      mouthScaleY = 2.0
    }

    browL.position.y = browY
    browR.position.y = browY
    browL.rotation.z = browTiltL
    browR.rotation.z = browTiltR
    eyeL.scale.y = eyeScaleY
    eyeR.scale.y = eyeScaleY
    mouth.scale.set(mouthScaleX, mouthScaleY + talkMouth * 1.4, 1)
    mouth.rotation.z = mouthRotZ
  }

  applyExpressionPose('neutral', 0)

  return {
    group,

    setPose(x: number, y: number, z: number, yaw: number) {
      if (disposed) return
      group.position.set(x, y, z)
      group.rotation.y = yaw
      group.updateMatrixWorld(true)
    },

    setMarker(mode: UncleMarkerMode) {
      if (disposed) return
      markerMode = mode
      markerPivot.visible = mode === 'new'
    },

    setTalking(on: boolean) {
      if (disposed) return
      talking = Boolean(on)
    },

    setExpression(id: UncleExpressionId) {
      if (disposed) return
      curExpr = UNCLE_EXPRESSION_IDS.includes(id) ? id : 'neutral'
      applyExpressionPose(curExpr, 0)
    },

    headWorld(out = new THREE.Vector3()) {
      group.updateMatrixWorld(true)
      return headPivot.getWorldPosition(out)
    },

    step(dt: number, time: number, night: number, playerPos?: THREE.Vector3 | {x: number; y?: number; z: number} | null) {
      if (disposed) return
      const safeDt = Math.min(0.1, Math.max(0, dt))
      const t = Number.isFinite(time) ? time : 0
      const n = THREE.MathUtils.clamp(Number.isFinite(night) ? night : 0, 0, 1)

      for (const item of litMats) {
        item.mat.emissiveIntensity = item.base + n * item.nightBoost
      }

      // 1) 待机呼吸律动
      const breath = Math.sin(t * 2.15)
      bodyPivot.position.y = breath * 0.006
      torsoPivot.rotation.x = breath * 0.018
      towelGroup.rotation.z = breath * 0.025

      // 2) 转头看玩家（优先读 playerPos，缺省自动用相机探针坐标）
      let targetYaw = 0
      let targetPitch = 0
      let hasLookTarget = false
      if (playerPos) {
        tmpWorldPos.set(playerPos.x, playerPos.y ?? group.position.y + 1.56, playerPos.z)
        hasLookTarget = true
      } else if (camSeen) {
        tmpWorldPos.copy(camWorld)
        hasLookTarget = true
      }
      if (hasLookTarget) {
        headPivot.getWorldPosition(tmpHeadWorld)
        const dx = tmpWorldPos.x - tmpHeadWorld.x
        const dz = tmpWorldPos.z - tmpHeadWorld.z
        const distSq = dx * dx + dz * dz
        if (distSq > 0.09 && distSq < 256) {
          const desiredWorldYaw = Math.atan2(dx, dz)
          const relYaw = clampAngle(desiredWorldYaw - group.rotation.y)
          if (Math.abs(relYaw) < 2.2) {
            targetYaw = THREE.MathUtils.clamp(relYaw, -0.85, 0.85)
            const dist = Math.sqrt(distSq)
            targetPitch = THREE.MathUtils.clamp(-(tmpWorldPos.y - tmpHeadWorld.y) / dist, -0.25, 0.25)
          }
        }
      }
      const headDamp = 1 - Math.exp(-7 * safeDt)
      curHeadYaw = THREE.MathUtils.lerp(curHeadYaw, targetYaw, headDamp)
      curHeadPitch = THREE.MathUtils.lerp(curHeadPitch, targetPitch, headDamp)

      // 3) 说话手势 + 护腕右臂微动作
      const talkGoal = talking ? 1 : 0
      talkBlend = THREE.MathUtils.lerp(talkBlend, talkGoal, 1 - Math.exp(-9 * safeDt))
      const gestureWave = Math.sin(t * 5.2)
      const gestureWave2 = Math.cos(t * 3.5)

      // 左臂：待机自然微摆；说话时热情抬臂比划（展示老式手表）
      leftArmRig.shoulder.rotation.set(
        -0.06 * Math.sin(t * 1.4) + (-0.68 + gestureWave * 0.22) * talkBlend,
        (0.18 + gestureWave2 * 0.14) * talkBlend,
        0.08 + 0.14 * talkBlend,
      )
      leftArmRig.elbow.rotation.set(-0.22 - (0.65 + gestureWave2 * 0.24) * talkBlend, 0, 0)

      // 右臂（烫伤缠绷带）：始终轻收在腹前护腕，说话时仅小幅随动强调腕伤剧情
      rightArmRig.shoulder.rotation.set(
        -0.34 - 0.12 * talkBlend + Math.sin(t * 2.1) * 0.025,
        -0.18 - 0.12 * talkBlend,
        -0.12,
      )
      rightArmRig.elbow.rotation.set(-0.82 - 0.18 * talkBlend + gestureWave * 0.05 * talkBlend, 0.22, 0)

      const talkNod = Math.sin(t * 4.6) * 0.045 * talkBlend
      headPivot.rotation.set(curHeadPitch + talkNod + breath * 0.015, curHeadYaw, 0)

      const mouthTalkAmp = talkBlend > 0.05 ? Math.max(0, Math.sin(t * 11.5)) * talkBlend : 0
      applyExpressionPose(curExpr, mouthTalkAmp)

      // 4) 头顶黄色感叹号缓慢浮动、远距屏幕可读补偿与夜间自发光
      if (markerMode === 'new') {
        markerPivot.visible = true
        let distScale = 1
        if (hasLookTarget) {
          markerPivot.getWorldPosition(tmpHeadWorld)
          const camDist = tmpWorldPos.distanceTo(tmpHeadWorld)
          distScale = THREE.MathUtils.clamp(0.95 + Math.max(0, camDist - 6) * 0.048, 0.95, 2.35)
        }
        markerPivot.scale.setScalar(distScale)
        markerPivot.position.y = 2.28 + (distScale - 1) * 0.32 + Math.sin(t * 2.4) * 0.075
        markerPivot.rotation.y = Math.sin(t * 1.3) * 0.16
        markerYellowMat.emissiveIntensity = 0.95 + n * 0.65
      } else {
        markerPivot.visible = false
      }
    },

    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      for (const g of geos) g.dispose()
      for (const m of mats) m.dispose()
      for (const t of texs) t.dispose()
    },
  }
}
