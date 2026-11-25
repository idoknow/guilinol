import * as THREE from 'three'
import type { DrinkCatalogItem } from '../menu/menu.ts'
import { createPropsDrinkSkin, DEFAULT_MASTER_DRINKS_SKIN, type DrinksMasterSkin } from '../menu/skin.ts'
import { DRINK_CATALOG, type DrinkId, type DrinkLidKind, type DrinkSpec } from '../props/catalog.ts'
import { createCaramelSwirlTexture, createCupSleeveTexture } from '../props/skins.ts'

export interface DrinkCupVisual {
  readonly group: THREE.Group
  setDrink(
    item: Pick<
      DrinkCatalogItem,
      'id' | 'category' | 'cupColor' | 'accentColor' | 'hasCreamCrown' | 'hasPearls' | 'hot'
    >,
  ): void
  setFillRatio(ratio: number): void
  setSipTilt(progress: number): void
  dispose(): void
}

const DEFAULT_TOP_R = 0.042
const DEFAULT_BOT_R = 0.030
const DEFAULT_H = 0.152
const LIQUID_BOTTOM_OFFSET = 0.008
const LIQUID_HEADROOM = 0.016

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 在复用单位圆柱顶点的前提下，按上下半径动态重塑精确锥体（零 GPU 几何频繁重建泄漏）。
 */
function applyTaperedCone(
  geo: THREE.BufferGeometry,
  baseArr: Float32Array,
  rTop: number,
  rBot: number,
  height: number,
  yBottom = 0,
): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const h = Math.max(0.0005, height)
  for (let i = 0; i < pos.count; i++) {
    const bx = baseArr[i * 3]!
    const by = baseArr[i * 3 + 1]!
    const bz = baseArr[i * 3 + 2]!
    const t = clamp01(by + 0.5)
    const r = lerp(rBot, rTop, t)
    pos.setXYZ(i, bx * r, yBottom + t * h, bz * r)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
}

/**
 * 程序化生成冷杯外壁轻微水雾微珠纹理，与 3D 凝结水珠协同增强冰饮湿润质感。
 */
function createCondensationRoughnessTex(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#555555'
  ctx.fillRect(0, 0, 256, 256)

  // 微细冷雾带 + 纵向水痕斑点
  for (let i = 0; i < 220; i++) {
    const x = (i * 53.7) % 256
    const y = (i * 97.3) % 256
    const rad = 1.2 + (i % 4) * 0.9
    ctx.fillStyle = i % 5 === 0 ? '#181818' : i % 3 === 0 ? '#323232' : '#7a7a7a'
    ctx.beginPath()
    ctx.arc(x, y, rad, 0, Math.PI * 2)
    ctx.fill()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

interface DropletSlot {
  readonly mesh: THREE.Mesh
  readonly angle: number
  readonly zone: 'upper' | 'lower'
  readonly fracInZone: number
  readonly size: number
}

/**
 * 精细程序化手持饮品 3D 模型（零外部二进制资产、零动态光源）：
 * - 物理级杯体材质：清亮/磨砂半透外杯壳、清漆高光 + 冷饮水雾 + 贴壁 3D 冷凝水珠
 * - 锥度严密贴合的杯套（含热饮立体瓦楞竖肋），杜绝浮空或直筒穿模
 * - 半透明液体分层（果茶/冷萃/奶盖/挂壁流心）随 `setFillRatio(0..1)` 沿杯壁锥度精确下降
 * - `DRINK_CATALOG` 10 款饮品独立轮廓/杯盖/小料/吸管/勺子，一眼区分
 */
export function createDrinkCupModel(
  masterSkin: DrinksMasterSkin = DEFAULT_MASTER_DRINKS_SKIN,
): DrinkCupVisual {
  const propSkin = createPropsDrinkSkin(masterSkin, 'props')
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []

  const ownGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g)
    return g
  }
  const ownMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m)
    return m
  }

  const root = new THREE.Group()
  root.name = 'drinks-held-cup'

  const pivot = new THREE.Group()
  pivot.name = 'drinks-cup-pivot'
  pivot.position.set(0, -0.055, -0.012)
  root.add(pivot)

  let cupH = DEFAULT_H
  let rTop = DEFAULT_TOP_R
  let rBot = DEFAULT_BOT_R
  let liquidMaxH = cupH - LIQUID_BOTTOM_OFFSET - LIQUID_HEADROOM
  let curRatio = 1
  let curIsSundae = false
  let curIsHot = false
  let curDrinkId: string = 'pearl_milk_tea'
  let curLiquidOpacity = 0.88
  let curBaseLiquidOffset = LIQUID_BOTTOM_OFFSET
  let curCoconutFrac = 0.62

  const condMistTex = createCondensationRoughnessTex()
  if (condMistTex) textures.push(condMistTex)

  // 1) 真实锥度外杯壁（Physical Clearcoat） + 卷边杯口 + 实心杯底托
  const cupShellGeo = ownGeo(new THREE.CylinderGeometry(1, 1, 1, 28, 1, true))
  const cupShellBase = Float32Array.from(cupShellGeo.getAttribute('position').array as Float32Array)
  const cupWallMat = ownMat(
    new THREE.MeshPhysicalMaterial({
      color: '#f2f9fd',
      roughness: 0.08,
      metalness: 0.02,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      ior: 1.49,
      specularIntensity: 0.95,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    }),
  )
  const cupShell = new THREE.Mesh(cupShellGeo, cupWallMat)
  cupShell.name = 'drinks-cup-shell'
  cupShell.renderOrder = 3
  pivot.add(cupShell)

  const rimMat = ownMat(
    new THREE.MeshStandardMaterial({ color: '#f3f7fa', roughness: 0.28, metalness: 0.04 }),
  )
  const rimTorus = new THREE.Mesh(ownGeo(new THREE.TorusGeometry(1, 0.056, 8, 28)), rimMat)
  rimTorus.rotation.x = Math.PI / 2
  rimTorus.renderOrder = 4
  pivot.add(rimTorus)

  const baseDiskGeo = ownGeo(new THREE.CylinderGeometry(1, 1, 1, 24))
  const baseDiskBase = Float32Array.from(baseDiskGeo.getAttribute('position').array as Float32Array)
  const baseDiskMat = ownMat(
    new THREE.MeshPhysicalMaterial({
      color: '#e8eef2',
      roughness: 0.22,
      clearcoat: 0.7,
      transparent: true,
      opacity: 0.72,
    }),
  )
  const baseDisk = new THREE.Mesh(baseDiskGeo, baseDiskMat)
  pivot.add(baseDisk)

  // 2) 动态锥度液柱主层 & 二次色带层（严格随 fillRatio 沿杯壁收缩，绝不穿出杯壁）
  const liquidGeo = ownGeo(new THREE.CylinderGeometry(1, 1, 1, 24, 1, false))
  const liquidBase = Float32Array.from(liquidGeo.getAttribute('position').array as Float32Array)
  const liquidMat = ownMat(
    new THREE.MeshPhysicalMaterial({
      color: '#f6df6e',
      roughness: 0.16,
      metalness: 0.01,
      clearcoat: 0.45,
      clearcoatRoughness: 0.12,
      ior: 1.34,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
  )
  const liquidMesh = new THREE.Mesh(liquidGeo, liquidMat)
  liquidMesh.name = 'drinks-liquid-body'
  liquidMesh.renderOrder = 2
  pivot.add(liquidMesh)

  // 副色层：用于冰美式上层深黑意式浓缩 / 芋圆葡萄底果泥 / 珍珠奶茶焦糖底 / 杨枝甘露雪白椰奶圈
  const subBandGeo = ownGeo(new THREE.CylinderGeometry(1, 1, 1, 24, 1, false))
  const subBandBase = Float32Array.from(subBandGeo.getAttribute('position').array as Float32Array)
  const subBandMat = ownMat(
    new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: 0.22,
      clearcoat: 0.35,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  )
  const subBandMesh = new THREE.Mesh(subBandGeo, subBandMat)
  subBandMesh.name = 'drinks-liquid-sublayer'
  subBandMesh.renderOrder = 2
  subBandMesh.visible = false
  pivot.add(subBandMesh)

  // 3) 杯底/杯中透视固态小料（先于半透明液体绘制 renderOrder=1，透杯清晰可见）
  const bottomToppings = new THREE.Group()
  bottomToppings.name = 'drinks-bottom-toppings'
  pivot.add(bottomToppings)

  const pearlPrimaryMat = ownMat(new THREE.MeshPhysicalMaterial({ color: '#1b0c05', roughness: 0.18, clearcoat: 0.85 }))
  const pearlAltMat = ownMat(new THREE.MeshStandardMaterial({ color: '#d7b2eb', roughness: 0.35 }))
  const pearlGeo = ownGeo(new THREE.SphereGeometry(0.0056, 8, 6))
  const pearlOffsets: readonly [number, number, number, boolean][] = [
    [-0.015, 0.01, -0.01, false],
    [0.015, 0.01, -0.009, true],
    [0.001, 0.011, 0.016, false],
    [-0.013, 0.018, 0.012, true],
    [0.013, 0.018, 0.011, false],
    [-0.004, 0.02, -0.014, true],
    [0.006, 0.011, -0.002, false],
    [-0.017, 0.013, 0.001, false],
    [0.017, 0.014, 0.002, true],
    [-0.007, 0.011, -0.016, false],
    [0.005, 0.023, 0.007, true],
    [-0.006, 0.024, -0.003, false],
  ]
  const pearlMeshes: THREE.Mesh[] = []
  for (let i = 0; i < pearlOffsets.length; i++) {
    const [px, py, pz, useAlt] = pearlOffsets[i]!
    const p = new THREE.Mesh(pearlGeo, useAlt ? pearlAltMat : pearlPrimaryMat)
    p.position.set(px, py, pz)
    p.renderOrder = 1
    bottomToppings.add(p)
    pearlMeshes.push(p)
  }

  // 百香果黑籽与椰果粒
  const seedsAndDiceGroup = new THREE.Group()
  const seedMat = ownMat(new THREE.MeshStandardMaterial({ color: '#1f120b', roughness: 0.28 }))
  const diceMat = ownMat(
    new THREE.MeshPhysicalMaterial({ color: '#fff7e0', roughness: 0.24, transparent: true, opacity: 0.9 }),
  )
  const seedGeo = ownGeo(new THREE.SphereGeometry(0.0024, 5, 4))
  const diceGeo = ownGeo(new THREE.BoxGeometry(0.0076, 0.0068, 0.0076))
  for (let i = 0; i < 10; i++) {
    const ang = i * 2.39996
    const rad = 0.011 + (i % 3) * 0.006
    const s = new THREE.Mesh(seedGeo, seedMat)
    s.position.set(Math.cos(ang) * rad, 0.028 + (i % 5) * 0.018, Math.sin(ang) * rad)
    s.renderOrder = 1
    seedsAndDiceGroup.add(s)
  }
  for (let i = 0; i < 6; i++) {
    const ang = i * 1.05 + 0.3
    const rad = 0.01 + (i % 2) * 0.007
    const d = new THREE.Mesh(diceGeo, diceMat)
    d.position.set(Math.cos(ang) * rad, 0.016 + (i % 3) * 0.009, Math.sin(ang) * rad)
    d.rotation.set(i * 0.4, i * 0.7, i * 0.2)
    d.renderOrder = 1
    seedsAndDiceGroup.add(d)
  }
  seedsAndDiceGroup.visible = false
  pivot.add(seedsAndDiceGroup)

  // 透视柠檬切片（悬挂杯内中段 + 表面，共 2 片）
  const makeLemonWheel = (rindHex: string, pulpHex: string): { group: THREE.Group; rindMat: THREE.MeshStandardMaterial; pulpMat: THREE.MeshStandardMaterial } => {
    const g = new THREE.Group()
    const rMat = ownMat(new THREE.MeshStandardMaterial({ color: rindHex, roughness: 0.42 }))
    const pMat = ownMat(new THREE.MeshStandardMaterial({ color: pulpHex, roughness: 0.24 }))
    const rind = new THREE.Mesh(ownGeo(new THREE.TorusGeometry(0.0165, 0.0026, 6, 14)), rMat)
    rind.rotation.x = Math.PI / 2
    const pulp = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.0155, 0.0155, 0.0038, 12)), pMat)
    const pith = new THREE.Mesh(
      ownGeo(new THREE.CylinderGeometry(0.0032, 0.0032, 0.0042, 8)),
      ownMat(new THREE.MeshStandardMaterial({ color: '#fffcf0', roughness: 0.5 })),
    )
    rind.renderOrder = 1
    pulp.renderOrder = 1
    pith.renderOrder = 1
    g.add(rind, pulp, pith)
    return { group: g, rindMat: rMat, pulpMat: pMat }
  }
  const innerLemonWheel = makeLemonWheel('#ebba00', '#fff078')
  innerLemonWheel.group.position.set(0.009, 0.068, -0.007)
  innerLemonWheel.group.rotation.set(-0.78, 0.45, 0.52)
  innerLemonWheel.group.visible = false
  pivot.add(innerLemonWheel.group)

  // 4) 随液面同步下沉的浮顶层（微弧反光液面 + 剔透冰块 + 奶盖 + 柠檬/青柠/芒果红柚丁/茉莉花瓣）
  const floatingSurface = new THREE.Group()
  floatingSurface.name = 'drinks-floating-surface'
  pivot.add(floatingSurface)

  const meniscusMat = ownMat(
    new THREE.MeshPhysicalMaterial({
      color: '#fffef8',
      roughness: 0.1,
      clearcoat: 0.9,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    }),
  )
  const meniscusDisc = new THREE.Mesh(
    ownGeo(new THREE.CylinderGeometry(0.036 * 0.92, 0.036 * 0.92, 0.0022, 24)),
    meniscusMat,
  )
  meniscusDisc.renderOrder = 2
  floatingSurface.add(meniscusDisc)

  const iceCluster = new THREE.Group()
  const iceMat = ownMat(
    new THREE.MeshPhysicalMaterial({
      color: '#eefaff',
      roughness: 0.08,
      metalness: 0.02,
      clearcoat: 0.95,
      ior: 1.31,
      transparent: true,
      opacity: 0.72,
    }),
  )
  const iceGeo = ownGeo(new THREE.BoxGeometry(0.0125, 0.0108, 0.0125))
  const iceCoords: readonly [number, number, number, number][] = [
    [0.013, -0.004, 0.008, 0.28],
    [-0.012, -0.005, -0.009, 0.72],
    [0.004, -0.006, -0.014, 1.15],
    [-0.006, -0.004, 0.013, 1.6],
    [0.001, -0.007, 0.001, 0.9],
  ]
  for (const [ix, iy, iz, rot] of iceCoords) {
    const ice = new THREE.Mesh(iceGeo, iceMat)
    ice.position.set(ix, iy, iz)
    ice.rotation.set(rot * 0.4, rot, rot * 0.3)
    ice.renderOrder = 1
    iceCluster.add(ice)
  }
  floatingSurface.add(iceCluster)

  const cheeseFoamMat = ownMat(new THREE.MeshStandardMaterial({ color: '#fff8ec', roughness: 0.32 }))
  const cheeseFoamCap = new THREE.Mesh(
    ownGeo(new THREE.CylinderGeometry(0.036 * 0.94, 0.036 * 0.92, 0.017, 24)),
    cheeseFoamMat,
  )
  cheeseFoamCap.position.y = -0.007
  cheeseFoamCap.visible = false
  cheeseFoamCap.renderOrder = 2
  floatingSurface.add(cheeseFoamCap)

  const topLemonWheel = makeLemonWheel('#ebba00', '#fff078')
  topLemonWheel.group.position.set(-0.008, -0.012, 0.007)
  topLemonWheel.group.rotation.set(0.86, 0.35, -0.42)
  topLemonWheel.group.visible = false
  floatingSurface.add(topLemonWheel.group)

  // 青柠半月角（满杯百香果专属）
  const limeWedgeGroup = new THREE.Group()
  const limeRindMat = ownMat(new THREE.MeshStandardMaterial({ color: '#4da326', roughness: 0.44 }))
  const limePulpMat = ownMat(new THREE.MeshStandardMaterial({ color: '#dcf279', roughness: 0.26 }))
  const limeOuter = new THREE.Mesh(
    ownGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.005, 10, 1, false, 0, Math.PI)),
    limeRindMat,
  )
  const limeInner = new THREE.Mesh(
    ownGeo(new THREE.CylinderGeometry(0.0115, 0.0115, 0.0054, 10, 1, false, 0, Math.PI)),
    limePulpMat,
  )
  limeWedgeGroup.add(limeOuter, limeInner)
  limeWedgeGroup.position.set(0.009, -0.009, -0.007)
  limeWedgeGroup.rotation.set(0.75, 0.42, 0.5)
  limeWedgeGroup.visible = false
  floatingSurface.add(limeWedgeGroup)

  // 顶部鲜果丁 / 茉莉花瓣点缀（杨枝甘露双色芒果红柚 / 茉莉奶绿白花瓣 / 热饮表层波波）
  const topBitsGroup = new THREE.Group()
  const topBitPrimaryMat = ownMat(new THREE.MeshStandardMaterial({ color: '#ff9d00', roughness: 0.28 }))
  const topBitAccentMat = ownMat(new THREE.MeshStandardMaterial({ color: '#ff4538', roughness: 0.28 }))
  const topBitGeo = ownGeo(new THREE.BoxGeometry(0.0078, 0.006, 0.0078))
  for (let i = 0; i < 8; i++) {
    const a = i * 1.9 + 0.2
    const r = 0.011 + (i % 3) * 0.0055
    const bit = new THREE.Mesh(topBitGeo, i % 2 === 0 ? topBitPrimaryMat : topBitAccentMat)
    bit.position.set(Math.cos(a) * r, -0.001 + (i % 2) * 0.003, Math.sin(a) * r)
    bit.rotation.set(i * 0.4, i * 0.6, i * 0.2)
    bit.renderOrder = 2
    topBitsGroup.add(bit)
  }
  topBitsGroup.visible = false
  floatingSurface.add(topBitsGroup)

  // 5) 严格贴合锥度的杯套 + 热饮 3D 瓦楞竖肋 + 防烫护圈
  const sleeveGeo = ownGeo(new THREE.CylinderGeometry(1, 1, 1, 28, 1, true))
  const sleeveBase = Float32Array.from(sleeveGeo.getAttribute('position').array as Float32Array)
  const sleeveMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: propSkin.primaryHex,
      roughness: 0.72,
      metalness: 0.02,
    }),
  )
  const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat)
  sleeve.name = 'drinks-cup-sleeve'
  sleeve.rotation.y = Math.PI * 0.5
  sleeve.renderOrder = 4
  pivot.add(sleeve)

  // 热饮瓦楞杯物理立体竖纹（仅 corrugated_hot 显示）
  const corrugatedRibs = new THREE.Group()
  corrugatedRibs.name = 'drinks-corrugated-ribs'
  const ribMat = ownMat(new THREE.MeshStandardMaterial({ color: '#8e5e38', roughness: 0.78 }))
  const ribGeo = ownGeo(new THREE.BoxGeometry(0.0016, 1, 0.0012))
  const ribMeshes: THREE.Mesh[] = []
  const RIB_COUNT = 24
  for (let i = 0; i < RIB_COUNT; i++) {
    const m = new THREE.Mesh(ribGeo, ribMat)
    m.renderOrder = 4
    corrugatedRibs.add(m)
    ribMeshes.push(m)
  }
  corrugatedRibs.visible = false
  pivot.add(corrugatedRibs)

  const hotCollar = new THREE.Mesh(
    ownGeo(new THREE.TorusGeometry(1.03, 0.048, 6, 24)),
    ownMat(new THREE.MeshStandardMaterial({ color: '#d8b48c', roughness: 0.58 })),
  )
  hotCollar.rotation.x = Math.PI / 2
  hotCollar.visible = false
  hotCollar.renderOrder = 4
  pivot.add(hotCollar)

  // 6) 冷凝水珠组（28 颗贴壁晶莹水珠 + 2 条滑落水迹珠串，热饮与纸碗自动隐藏）
  const condensationGroup = new THREE.Group()
  condensationGroup.name = 'drinks-condensation'
  const dropletMat = ownMat(
    new THREE.MeshPhysicalMaterial({
      color: '#f2faff',
      roughness: 0.04,
      metalness: 0.04,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      ior: 1.33,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
    }),
  )
  const dropletGeo = ownGeo(new THREE.SphereGeometry(1, 8, 6))
  const dropletSlots: DropletSlot[] = []
  for (let i = 0; i < 28; i++) {
    const isUpper = i < 20
    const mesh = new THREE.Mesh(dropletGeo, dropletMat)
    mesh.renderOrder = 4
    condensationGroup.add(mesh)
    // 含 2 组纵向下滑小水迹 + 错落分布露珠
    const angle =
      i === 18 || i === 19
        ? -0.35 + (i - 18) * 1.4
        : (i * 2.39996 + (isUpper ? 0.15 : 0.9)) % (Math.PI * 2)
    const fracInZone =
      i === 18
        ? 0.22
        : i === 19
          ? 0.44
          : clamp01(((i * 0.37) % 1) * 0.82 + 0.09)
    const size = i >= 17 && i <= 19 ? 0.0024 : 0.00125 + ((i * 7) % 5) * 0.00032
    dropletSlots.push({ mesh, angle, zone: isUpper ? 'upper' : 'lower', fracInZone, size })
  }
  condensationGroup.visible = false
  pivot.add(condensationGroup)

  // 7) 7 类差异化杯盖 + 咖啡/热饮口/翻盖细节 + 奶昔螺旋 + 圣代 3 层冰激凌 + 吸管/红勺
  const sealMat = ownMat(new THREE.MeshStandardMaterial({ color: propSkin.sealFilmHex, roughness: 0.35 }))
  const flatLid = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(1.04, 1.04, 0.007, 24)), sealMat)
  flatLid.renderOrder = 5
  pivot.add(flatLid)

  const flipTabMesh = new THREE.Mesh(
    ownGeo(new THREE.BoxGeometry(0.015, 0.0055, 0.011)),
    ownMat(new THREE.MeshStandardMaterial({ color: '#d9252e', roughness: 0.35 })),
  )
  flipTabMesh.visible = false
  flipTabMesh.renderOrder = 5
  pivot.add(flipTabMesh)

  const sipSpoutMesh = new THREE.Mesh(
    ownGeo(new THREE.BoxGeometry(0.015, 0.0085, 0.012)),
    ownMat(new THREE.MeshStandardMaterial({ color: '#22262b', roughness: 0.44 })),
  )
  sipSpoutMesh.visible = false
  sipSpoutMesh.renderOrder = 5
  pivot.add(sipSpoutMesh)

  const hotStopperGroup = new THREE.Group()
  const stopperMat = ownMat(new THREE.MeshStandardMaterial({ color: '#d9252e', roughness: 0.34 }))
  const stopperStick = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.0024, 0.0024, 0.03, 8)), stopperMat)
  stopperStick.position.y = 0.015
  const stopperKnob = new THREE.Mesh(ownGeo(new THREE.SphereGeometry(0.0046, 8, 6)), stopperMat)
  stopperKnob.position.y = 0.031
  hotStopperGroup.add(stopperStick, stopperKnob)
  hotStopperGroup.visible = false
  hotStopperGroup.renderOrder = 5
  pivot.add(hotStopperGroup)

  const domeLidMat = ownMat(
    new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: 0.08,
      clearcoat: 1.0,
      ior: 1.49,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    }),
  )
  const domeLid = new THREE.Mesh(
    ownGeo(new THREE.SphereGeometry(1.01, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)),
    domeLidMat,
  )
  domeLid.renderOrder = 5
  domeLid.visible = false
  pivot.add(domeLid)

  const creamGroup = new THREE.Group()
  const creamMat = ownMat(
    new THREE.MeshStandardMaterial({ color: masterSkin.mascot.baseCreamColor, roughness: 0.36 }),
  )
  const creamTiers: readonly [number, number, number][] = [
    [0.68, 0.16, 0.22],
    [0.5, 0.145, 0.5],
    [0.31, 0.125, 0.76],
  ]
  for (const [tr, tube, ty] of creamTiers) {
    const torus = new THREE.Mesh(ownGeo(new THREE.TorusGeometry(tr, tube, 10, 20)), creamMat)
    torus.rotation.x = Math.PI / 2
    torus.position.y = ty
    torus.renderOrder = 5
    creamGroup.add(torus)
  }
  const creamPeak = new THREE.Mesh(ownGeo(new THREE.ConeGeometry(0.24, 0.42, 12)), creamMat)
  creamPeak.position.y = 1.04
  creamPeak.renderOrder = 5
  creamGroup.add(creamPeak)

  // 圣代黑糖厚流心圈与肩部珍珠（仅圣代显示）
  const sundaeDrizzleGroup = new THREE.Group()
  const drizzleMat = ownMat(new THREE.MeshPhysicalMaterial({ color: '#451d0d', roughness: 0.18, clearcoat: 0.8 }))
  const drizzleRing = new THREE.Mesh(ownGeo(new THREE.TorusGeometry(0.73, 0.085, 8, 20)), drizzleMat)
  drizzleRing.rotation.x = Math.PI / 2 + 0.12
  drizzleRing.position.y = 0.24
  sundaeDrizzleGroup.add(drizzleRing)
  const creamPearlGeo = ownGeo(new THREE.SphereGeometry(0.105, 8, 6))
  for (let i = 0; i < 6; i++) {
    const ang = i * 1.05
    const cp = new THREE.Mesh(creamPearlGeo, drizzleMat)
    cp.position.set(Math.cos(ang) * 0.7, 0.26 + (i % 2) * 0.22, Math.sin(ang) * 0.7)
    sundaeDrizzleGroup.add(cp)
  }
  sundaeDrizzleGroup.visible = false
  creamGroup.add(sundaeDrizzleGroup)
  creamGroup.visible = false
  pivot.add(creamGroup)

  const strawGroup = new THREE.Group()
  strawGroup.name = 'drinks-straw-group'
  strawGroup.rotation.set(-0.14, 0, -0.07)
  pivot.add(strawGroup)

  const strawMat = ownMat(new THREE.MeshStandardMaterial({ color: propSkin.primaryHex, roughness: 0.36 }))
  const straw = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(1, 1, 1, 12)), strawMat)
  straw.renderOrder = 5
  strawGroup.add(straw)

  const strawRing = new THREE.Mesh(
    ownGeo(new THREE.TorusGeometry(0.0068, 0.0018, 6, 14)),
    ownMat(new THREE.MeshStandardMaterial({ color: propSkin.goldHex, roughness: 0.32 })),
  )
  strawRing.rotation.set(Math.PI / 2, 0, 0)
  strawRing.renderOrder = 5
  strawGroup.add(strawRing)

  const spoonGroup = new THREE.Group()
  const spoonMat = ownMat(new THREE.MeshStandardMaterial({ color: '#d9252e', roughness: 0.32 }))
  const spoonHandle = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.0052, 0.072, 0.0024)), spoonMat)
  spoonHandle.position.set(-0.016, 0.036, 0.008)
  spoonHandle.rotation.z = 0.34
  spoonHandle.rotation.y = 0.24
  spoonHandle.renderOrder = 5
  const spoonScoop = new THREE.Mesh(ownGeo(new THREE.SphereGeometry(0.0068, 8, 5)), spoonMat)
  spoonScoop.scale.set(1, 0.35, 1.35)
  spoonScoop.position.set(-0.006, 0.004, 0.004)
  spoonScoop.renderOrder = 5
  spoonGroup.add(spoonHandle, spoonScoop)
  spoonGroup.visible = false
  pivot.add(spoonGroup)

  let activeSleeveTex: THREE.Texture | null = null
  let activeLiquidTex: THREE.Texture | null = null
  let disposed = false

  function updateLayout(): void {
    const ratio = clamp01(curRatio)
    const visibleFill = ratio <= 0.002 ? 0 : Math.max(0.025, ratio)
    const totalFillH = visibleFill * liquidMaxH
    const surfY = curBaseLiquidOffset + totalFillH
    const liqFracBot = clamp01(curBaseLiquidOffset / cupH)
    const liqFracTop = clamp01(surfY / cupH)
    const rLiqBot = lerp(rBot, rTop, liqFracBot) * 0.915
    const rAtSurface = lerp(rBot, rTop, liqFracTop) * 0.915

    if (curDrinkId === 'iced_americano' && ratio > 0.004) {
      // 冰美式上下分层随吸饮等比同步收缩且严密内贴杯壁，分界位于杯套上方透明视窗内
      const splitY = curBaseLiquidOffset + totalFillH * 0.64
      const rMid = lerp(rLiqBot, rAtSurface, 0.64)
      applyTaperedCone(liquidGeo, liquidBase, rMid, rLiqBot, totalFillH * 0.64, curBaseLiquidOffset)
      applyTaperedCone(subBandGeo, subBandBase, rAtSurface, rMid, totalFillH * 0.36, splitY)
      subBandMesh.visible = true
      liquidMesh.visible = true
    } else {
      applyTaperedCone(liquidGeo, liquidBase, rAtSurface, rLiqBot, Math.max(0.004, totalFillH), curBaseLiquidOffset)
      liquidMesh.visible = ratio > 0.004

      if (curDrinkId === 'taro_grape_tea' && ratio > 0.004) {
        const jamH = Math.min(0.026, totalFillH * 0.45)
        const rJamTop = lerp(rBot, rTop, (curBaseLiquidOffset + jamH) / cupH) * 0.935
        applyTaperedCone(subBandGeo, subBandBase, rJamTop, rBot * 0.92, jamH, curBaseLiquidOffset)
        subBandMesh.visible = true
      } else if (curDrinkId === 'pearl_milk_tea' && ratio > 0.004) {
        const syrupH = 0.019
        const rSyrTop = lerp(rBot, rTop, (LIQUID_BOTTOM_OFFSET + syrupH) / cupH) * 0.93
        applyTaperedCone(subBandGeo, subBandBase, rSyrTop, rBot * 0.91, syrupH, LIQUID_BOTTOM_OFFSET)
        subBandMesh.visible = true
      } else if (curDrinkId === 'mango_pomelo_sago' && ratio > 0.25) {
        const bandCenter = Math.min(surfY - 0.015, curBaseLiquidOffset + liquidMaxH * curCoconutFrac)
        const bandH = 0.026
        const yb = Math.max(curBaseLiquidOffset + 0.012, bandCenter - bandH * 0.5)
        const yt = Math.min(surfY - 0.002, bandCenter + bandH * 0.5)
        if (yt - yb > 0.006) {
          const rBandBot = lerp(rBot, rTop, yb / cupH) * 0.935
          const rBandTop = lerp(rBot, rTop, yt / cupH) * 0.935
          applyTaperedCone(subBandGeo, subBandBase, rBandTop, rBandBot, yt - yb, yb)
          subBandMesh.visible = true
        } else {
          subBandMesh.visible = false
        }
      } else {
        subBandMesh.visible = false
      }
    }

    liquidMesh.position.set(0, 0, 0)
    liquidMesh.scale.set(1, 1, 1)
    subBandMesh.position.set(0, 0, 0)
    subBandMesh.scale.set(1, 1, 1)

    floatingSurface.position.y = surfY
    const surfScale = rAtSurface / 0.036
    floatingSurface.scale.set(surfScale, 1, surfScale)
    floatingSurface.visible = ratio > 0.02 && !curIsSundae && !curIsHot
    meniscusDisc.visible = !curIsSundae && !curIsHot

    if (curIsSundae && creamGroup.visible) {
      const radial = rTop * (0.45 + 0.55 * Math.max(0.15, ratio))
      const vert = rTop * (0.45 + 0.63 * ratio)
      creamGroup.scale.set(radial, vert, radial)
      creamGroup.position.y = cupH + 0.004 - (1 - ratio) * 0.015
    }

    bottomToppings.visible = bottomToppings.userData.enabled === true
  }

  function layoutCondensation(sleeveBotY: number, sleeveTopY: number, showDroplets: boolean): void {
    condensationGroup.visible = showDroplets
    if (!showDroplets) return
    const upperMinY = Math.min(cupH - 0.012, sleeveTopY + 0.006)
    const upperMaxY = cupH - 0.008
    const lowerMinY = 0.01
    const lowerMaxY = Math.max(lowerMinY + 0.004, sleeveBotY - 0.005)
    for (const slot of dropletSlots) {
      const y =
        slot.zone === 'upper'
          ? lerp(upperMinY, upperMaxY, slot.fracInZone)
          : lerp(lowerMinY, lowerMaxY, slot.fracInZone)
      const rSurf = lerp(rBot, rTop, clamp01(y / cupH))
      const rPos = rSurf + slot.size * 0.25
      slot.mesh.position.set(Math.cos(slot.angle) * rPos, y, Math.sin(slot.angle) * rPos)
      slot.mesh.lookAt(Math.cos(slot.angle) * (rPos + 0.1), y, Math.sin(slot.angle) * (rPos + 0.1))
      slot.mesh.scale.set(slot.size, slot.size * 1.28, slot.size * 0.54)
    }
  }

  function applyLidKind(lid: DrinkLidKind, spec: DrinkSpec | undefined): void {
    const isDome = lid === 'flip_cap_clear' || lid === 'hemisphere_dome'
    const isOpen = lid === 'open_swirl'
    const hasCream = isOpen || lid === 'hemisphere_dome'

    flatLid.visible = !isDome && !isOpen
    flatLid.position.y = cupH + 0.003
    flatLid.scale.set(rTop, 1, rTop)
    sealMat.color.set(
      lid === 'heat_seal_clear'
        ? '#f4faf6'
        : lid === 'coffee_sip_lid'
          ? '#1e2228'
          : lid === 'hot_sip_lid'
            ? '#fbf4e8'
            : propSkin.sealFilmHex,
    )
    sealMat.transparent = lid === 'heat_seal_clear'
    sealMat.opacity = lid === 'heat_seal_clear' ? 0.65 : 0.96
    sealMat.needsUpdate = true

    flipTabMesh.visible = lid === 'flip_cap_clear'
    if (flipTabMesh.visible) {
      flipTabMesh.position.set(-rTop * 0.36, cupH + rTop * 0.38, -rTop * 0.38)
      flipTabMesh.rotation.set(0.25, 0.3, 0.22)
    }

    sipSpoutMesh.visible = lid === 'coffee_sip_lid'
    if (sipSpoutMesh.visible) {
      sipSpoutMesh.position.set(0, cupH + 0.011, -rTop * 0.56)
    }

    hotStopperGroup.visible = lid === 'hot_sip_lid'
    if (hotStopperGroup.visible) {
      hotStopperGroup.position.set(0, cupH + 0.006, -rTop * 0.5)
    }

    domeLid.visible = isDome
    domeLid.position.y = cupH + 0.001
    domeLid.scale.set(rTop, rTop * (lid === 'hemisphere_dome' ? 0.95 : 0.62), rTop)

    creamGroup.visible = hasCream
    if (hasCream) {
      const radialScale = rTop * (lid === 'hemisphere_dome' ? 0.82 : 1.0)
      const vertScale = rTop * (lid === 'hemisphere_dome' ? 0.62 : 1.08)
      creamGroup.position.y = cupH + 0.003
      creamGroup.scale.set(radialScale, vertScale, radialScale)
      creamMat.color.set(
        lid === 'hemisphere_dome' ? '#ffeaf0' : masterSkin.mascot.baseCreamColor,
      )
      sundaeDrizzleGroup.visible = isOpen
    }

    const showStraw = !isOpen && (spec ? Boolean(spec.strawHex) : true)
    const strawR = spec?.strawRadiusM ?? 0.0046
    const aboveLid = isDome ? 0.046 : 0.028
    const strawLen = cupH - 0.008 + aboveLid
    strawGroup.visible = showStraw
    strawGroup.position.set(0.009, cupH, -0.007)
    straw.scale.set(strawR, strawLen, strawR)
    straw.position.set(0, aboveLid - strawLen * 0.5, 0)
    strawMat.color.set(spec?.strawHex ?? propSkin.primaryHex)

    const ringLocalY = lid === 'hemisphere_dome' ? rTop * 0.82 : isDome ? rTop * 0.54 : 0.006
    const ringScale = (strawR * 1.42) / 0.0068
    strawRing.visible = showStraw
    strawRing.position.set(0, ringLocalY, 0)
    strawRing.scale.setScalar(ringScale)

    spoonGroup.visible = isOpen
    spoonGroup.position.set(0, cupH, 0)
  }

  return {
    group: root,

    setDrink(item) {
      if (disposed) return
      const spec = item.id in DRINK_CATALOG ? DRINK_CATALOG[item.id as DrinkId] : undefined
      curDrinkId = spec?.id ?? item.id

      cupH = spec?.cupHeightM ?? DEFAULT_H
      rTop = spec?.topRadiusM ?? DEFAULT_TOP_R
      rBot = spec?.bottomRadiusM ?? DEFAULT_BOT_R
      curBaseLiquidOffset = curDrinkId === 'pearl_milk_tea' ? 0.026 : LIQUID_BOTTOM_OFFSET
      liquidMaxH = Math.max(0.055, cupH - curBaseLiquidOffset - LIQUID_HEADROOM)
      curIsSundae = spec ? spec.silhouette === 'sundae_bowl' : item.id === 'sundae_cup'

      const isHot = Boolean(item.hot || spec?.silhouette === 'corrugated_hot')
      curIsHot = isHot
      const isFrosted = spec?.silhouette === 'frosted_slender'
      const isOpaque = spec?.silhouette === 'sundae_bowl' || isHot

      // 1) 重塑真实锥度外杯壁与底托
      applyTaperedCone(cupShellGeo, cupShellBase, rTop, rBot, cupH, 0)
      cupShell.position.set(0, 0, 0)
      cupShell.scale.set(1, 1, 1)

      cupWallMat.color.set(
        isHot ? '#f5ead8' : spec?.silhouette === 'sundae_bowl' ? propSkin.creamHex : isFrosted ? '#f5fbf7' : '#f2f9fd',
      )
      cupWallMat.roughness = isHot ? 0.52 : spec?.silhouette === 'sundae_bowl' ? 0.44 : isFrosted ? 0.34 : 0.08
      cupWallMat.clearcoat = isOpaque ? 0.14 : isFrosted ? 0.38 : 1.0
      cupWallMat.clearcoatRoughness = isFrosted ? 0.3 : 0.05
      cupWallMat.roughnessMap = !isOpaque && !isHot ? condMistTex : null
      cupWallMat.bumpMap = !isOpaque && !isHot ? condMistTex : null
      cupWallMat.bumpScale = !isOpaque && !isHot ? 0.00045 : 0
      cupWallMat.transparent = !isOpaque
      cupWallMat.opacity = isOpaque ? 1 : isFrosted ? 0.44 : 0.24
      cupWallMat.depthWrite = isOpaque
      cupWallMat.side = spec?.lid === 'open_swirl' ? THREE.DoubleSide : THREE.FrontSide
      cupWallMat.needsUpdate = true

      rimTorus.position.y = cupH
      rimTorus.scale.set(rTop * 1.005, rTop * 1.005, 0.044)
      rimMat.color.set(isHot ? '#d8b48c' : isOpaque ? propSkin.creamHex : '#f3f7fa')

      applyTaperedCone(baseDiskGeo, baseDiskBase, rBot * 0.99, rBot * 0.94, 0.006, 0)
      baseDisk.position.set(0, 0, 0)
      baseDisk.scale.set(1, 1, 1)
      baseDiskMat.transparent = !isOpaque
      baseDiskMat.opacity = isOpaque ? 1 : 0.72

      // 2) 半透明液柱与双层区分配色
      if (activeLiquidTex) {
        activeLiquidTex.dispose()
        activeLiquidTex = null
      }
      if (spec && (spec.id === 'shake_milkshake' || spec.id === 'sundae_cup' || spec.id === 'brown_sugar_milk')) {
        activeLiquidTex = createCaramelSwirlTexture(spec.liquidHex, spec.liquidSecondaryHex)
        if (activeLiquidTex) textures.push(activeLiquidTex)
      }
      liquidMat.map = activeLiquidTex
      curLiquidOpacity =
        spec?.id === 'ice_lemon_water'
          ? 0.54
          : spec?.id === 'passion_fruit_cup'
            ? 0.68
            : spec?.id === 'iced_americano'
              ? 0.64
              : spec?.liquidOpacity ?? 0.85

      if (curDrinkId === 'iced_americano') {
        liquidMat.color.set('#b98650')
        liquidMat.opacity = 0.56
        liquidMat.transparent = true
        liquidMat.depthWrite = false
        subBandMat.color.set('#231007')
        subBandMat.opacity = 0.93
        subBandMat.transparent = true
        subBandMat.depthWrite = false
      } else if (curDrinkId === 'taro_grape_tea') {
        liquidMat.color.set(spec?.liquidHex ?? '#9358ad')
        liquidMat.opacity = 0.78
        liquidMat.transparent = true
        liquidMat.depthWrite = false
        subBandMat.color.set('#4d1852')
        subBandMat.opacity = 0.96
        subBandMat.transparent = false
        subBandMat.depthWrite = true
      } else if (curDrinkId === 'pearl_milk_tea') {
        liquidMat.color.set(spec?.liquidHex ?? item.cupColor)
        liquidMat.opacity = 0.88
        liquidMat.transparent = true
        liquidMat.depthWrite = false
        subBandMat.color.set('#4c2410')
        subBandMat.opacity = 0.56
        subBandMat.transparent = true
        subBandMat.depthWrite = false
      } else if (curDrinkId === 'mango_pomelo_sago') {
        liquidMat.color.set('#efa511')
        liquidMat.opacity = 0.78
        liquidMat.transparent = true
        liquidMat.depthWrite = false
        subBandMat.color.set('#fffbf0')
        subBandMat.opacity = 0.98
        subBandMat.transparent = false
        subBandMat.depthWrite = true
      } else {
        liquidMat.color.set(activeLiquidTex ? '#ffffff' : spec?.liquidHex ?? item.cupColor)
        liquidMat.opacity = curLiquidOpacity
        liquidMat.transparent = curLiquidOpacity < 1
        liquidMat.depthWrite = curLiquidOpacity >= 0.97
      }
      liquidMat.needsUpdate = true
      subBandMat.needsUpdate = true

      // 3) 10 款饮品浮顶与杯底/杯中透视小料
      meniscusMat.color.set(spec?.liquidSecondaryHex ?? '#fffef8')
      iceCluster.visible = !isHot && !curIsSundae && curDrinkId !== 'pearl_milk_tea'
      cheeseFoamCap.visible =
        curDrinkId === 'taro_grape_tea' ||
        curDrinkId === 'pearl_milk_tea' ||
        curDrinkId === 'jasmine_milk_green'
      cheeseFoamMat.color.set(curDrinkId === 'jasmine_milk_green' ? '#7ea565' : '#fff8ec')
      cheeseFoamCap.scale.y = curDrinkId === 'taro_grape_tea' ? 1.25 : 0.72

      const hasLemon = curDrinkId === 'ice_lemon_water'
      topLemonWheel.group.visible = hasLemon
      innerLemonWheel.group.visible = hasLemon
      limeWedgeGroup.visible = curDrinkId === 'passion_fruit_cup'
      seedsAndDiceGroup.visible = curDrinkId === 'passion_fruit_cup' || curDrinkId === 'shake_milkshake'

      topBitsGroup.visible =
        curDrinkId === 'mango_pomelo_sago' ||
        curDrinkId === 'jasmine_milk_green' ||
        curDrinkId === 'brown_sugar_milk'
      if (topBitsGroup.visible) {
        if (curDrinkId === 'mango_pomelo_sago') {
          topBitPrimaryMat.color.set('#ff9d00')
          topBitAccentMat.color.set('#ff4538')
        } else if (curDrinkId === 'jasmine_milk_green') {
          topBitPrimaryMat.color.set('#fffef7')
          topBitAccentMat.color.set('#f4f9e8')
        } else {
          topBitPrimaryMat.color.set('#281207')
          topBitAccentMat.color.set('#4c2410')
        }
      }

      bottomToppings.userData.enabled = Boolean(
        item.hasPearls ||
          curDrinkId === 'pearl_milk_tea' ||
          curDrinkId === 'taro_grape_tea' ||
          curDrinkId === 'mango_pomelo_sago' ||
          curDrinkId === 'passion_fruit_cup',
      )
      pearlPrimaryMat.color.set(
        curDrinkId === 'taro_grape_tea'
          ? '#f2a43a'
          : curDrinkId === 'mango_pomelo_sago'
            ? '#fffbf2'
            : curDrinkId === 'passion_fruit_cup'
              ? '#26140a'
              : '#1b0c05',
      )
      pearlAltMat.color.set(
        curDrinkId === 'taro_grape_tea'
          ? '#d7b2eb'
          : curDrinkId === 'mango_pomelo_sago'
            ? '#fffcf8'
            : '#291308',
      )
      for (let i = 0; i < pearlMeshes.length; i++) {
        const m = pearlMeshes[i]!
        const baseOff = pearlOffsets[i]!
        const yBoost = curDrinkId === 'taro_grape_tea' ? 0.015 : 0
        m.position.set(baseOff[0], baseOff[1] + yBoost, baseOff[2])
        const pScale = curDrinkId === 'mango_pomelo_sago' ? 0.72 : 1
        m.scale.set(pScale, pScale, pScale)
      }

      // 4) 锥度严密贴合的杯套 + 热饮 3D 瓦楞竖肋 + 冷凝水珠布局
      const sleeveH = isHot ? cupH * 0.44 : curIsSundae ? cupH * 0.34 : cupH * 0.29
      const sleeveY = isHot ? cupH * 0.48 : curIsSundae ? cupH * 0.38 : cupH * 0.36
      const sleeveBotY = sleeveY - sleeveH * 0.5
      const sleeveTopY = sleeveY + sleeveH * 0.5
      const sleeveRBot = lerp(rBot, rTop, clamp01(sleeveBotY / cupH)) * 1.016
      const sleeveRTop = lerp(rBot, rTop, clamp01(sleeveTopY / cupH)) * 1.016

      applyTaperedCone(sleeveGeo, sleeveBase, sleeveRTop, sleeveRBot, sleeveH, sleeveBotY)
      sleeve.position.set(0, 0, 0)
      sleeve.scale.set(1, 1, 1)

      if (activeSleeveTex) {
        activeSleeveTex.dispose()
        activeSleeveTex = null
      }
      if (spec) {
        activeSleeveTex = createCupSleeveTexture(spec, propSkin)
        if (activeSleeveTex) textures.push(activeSleeveTex)
      }
      sleeveMat.map = activeSleeveTex
      sleeveMat.color.set(activeSleeveTex ? '#ffffff' : item.accentColor)
      sleeveMat.roughness = isHot ? 0.82 : 0.62
      sleeveMat.needsUpdate = true

      corrugatedRibs.visible = isHot
      if (isHot) {
        const midR = (sleeveRBot + sleeveRTop) * 0.5 * 1.003
        const ribSlope = Math.atan2(sleeveRTop - sleeveRBot, sleeveH)
        for (let i = 0; i < ribMeshes.length; i++) {
          const ang = (i / ribMeshes.length) * Math.PI * 2
          const rib = ribMeshes[i]!
          // 正背面徽章窗格让行，防止立体瓦楞条横切压住白色皇冠徽章
          rib.visible = Math.abs(Math.sin(ang)) >= 0.58
          rib.position.set(Math.sin(ang) * midR, sleeveY, Math.cos(ang) * midR)
          rib.scale.set(1, sleeveH * 0.66, 1)
          rib.rotation.set(0, ang, 0)
          rib.rotateX(ribSlope)
        }
      }

      hotCollar.visible = isHot
      if (isHot) {
        const collarFrac = clamp01((sleeveTopY + 0.008) / cupH)
        const collarR = lerp(rBot, rTop, collarFrac)
        hotCollar.position.y = sleeveTopY + 0.008
        hotCollar.scale.set(collarR * 0.985, collarR * 0.985, 0.044)
      }

      layoutCondensation(sleeveBotY, sleeveTopY, !isHot && !curIsSundae)

      const lidKind: DrinkLidKind =
        spec?.lid ?? (item.hasCreamCrown || item.category === 'ice_cream' ? 'hemisphere_dome' : 'heat_seal_red')
      applyLidKind(lidKind, spec)
      updateLayout()
    },

    setFillRatio(ratio) {
      if (disposed) return
      curRatio = clamp01(Number.isFinite(ratio) ? ratio : 1)
      updateLayout()
    },

    setSipTilt(progress) {
      if (disposed) return
      const p = clamp01(Number.isFinite(progress) ? progress : 0)
      pivot.rotation.x = p * 0.42
      pivot.rotation.z = p * 0.08
    },

    dispose() {
      if (disposed) return
      disposed = true
      root.removeFromParent()
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      for (const t of textures) t.dispose()
    },
  }
}
