import * as THREE from 'three'
import type { DrinkSkinConfig } from '../props/skins.ts'
import { createDefaultDrinksLayout } from '../sim/menu.ts'
import type { DrinkShopLayout } from '../sim/types.ts'
import {
  DRINKS_SHOP_BLUEPRINT,
  DRINKS_SHOP_BLUEPRINT_ENTRIES,
  DRINKS_SHOP_SITE,
  validateDrinksBlueprint,
  type BlueprintDimensionEntry,
} from './blueprint.ts'
import { createDrinksShopMaterials, type DrinksShopMaterialPack } from './materials.ts'

export interface DrinksCollider {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  label: string
}

export interface DrinksShopBuildOptions {
  layout?: Partial<DrinkShopLayout>
  skin?: Partial<DrinkSkinConfig>
  cutaway?: boolean
}

export interface DrinksShopMetrics {
  triangles: number
  meshes: number
  lights: number
  colliderCount: number
  blueprintCount: number
  blueprintValid: boolean
}

export interface DrinksShopBuildResult {
  readonly group: THREE.Group
  readonly layout: DrinkShopLayout
  readonly site: typeof DRINKS_SHOP_SITE
  readonly blueprint: Readonly<Record<string, BlueprintDimensionEntry>>
  readonly blueprintEntries: readonly BlueprintDimensionEntry[]
  readonly colliders: readonly DrinksCollider[]
  readonly materials: DrinksShopMaterialPack
  setCutaway(open: boolean): void
  setNight(night: number): void
  step(dtSec: number, timeSec: number, night: number): void
  getMetrics(): DrinksShopMetrics
  dispose(): void
}

function addBoxMesh(
  parent: THREE.Object3D,
  geos: THREE.BufferGeometry[],
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  rotY = 0,
  rotX = 0,
  rotZ = 0,
): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d)
  geos.push(g)
  const m = new THREE.Mesh(g, mat)
  m.position.set(x, y, z)
  if (rotY !== 0 || rotX !== 0 || rotZ !== 0) {
    m.rotation.set(rotX, rotY, rotZ)
  }
  parent.add(m)
  return m
}

function addCylMesh(
  parent: THREE.Object3D,
  geos: THREE.BufferGeometry[],
  rt: number,
  rb: number,
  h: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  seg = 12,
): THREE.Mesh {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg)
  geos.push(g)
  const m = new THREE.Mesh(g, mat)
  m.position.set(x, y, z)
  parent.add(m)
  return m
}

function addPlaneMesh(
  parent: THREE.Object3D,
  geos: THREE.BufferGeometry[],
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  rotY = 0,
): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w, h)
  geos.push(g)
  const m = new THREE.Mesh(g, mat)
  m.position.set(x, y, z)
  m.rotation.y = rotY
  parent.add(m)
  return m
}

function buildIceCrownMascot(
  parent: THREE.Object3D,
  geos: THREE.BufferGeometry[],
  mats: DrinksShopMaterialPack,
  x: number,
  yBase: number,
  z: number,
  scale = 1,
): THREE.Group {
  const fig = new THREE.Group()
  fig.name = 'drinks.ice_crown_mascot'
  fig.position.set(x, yBase, z)
  fig.scale.setScalar(scale)

  // 圆台基座 + 红白环饰
  addCylMesh(fig, geos, 0.44, 0.48, 0.24, 0, 0.12, 0, mats.podiumTrimCreamMat, 16)
  addCylMesh(fig, geos, 0.45, 0.45, 0.08, 0, 0.26, 0, mats.podiumRedMat, 16)

  // 圆润冰晶身躯
  const bodyG = new THREE.SphereGeometry(0.4, 14, 12)
  geos.push(bodyG)
  const body = new THREE.Mesh(bodyG, mats.iceCrownMat)
  body.scale.set(1, 1.08, 0.92)
  body.position.set(0, 0.68, 0)
  fig.add(body)

  // 红色披风围巾
  addCylMesh(fig, geos, 0.34, 0.41, 0.16, 0, 1.02, 0, mats.podiumRedMat, 16)

  // 头部与几何眼眉特征（原创几何造型）
  const headG = new THREE.SphereGeometry(0.32, 14, 12)
  geos.push(headG)
  const head = new THREE.Mesh(headG, mats.iceCrownMat)
  head.position.set(0, 1.34, 0)
  fig.add(head)

  for (const sx of [-0.11, 0.11]) {
    const eyeG = new THREE.SphereGeometry(0.036, 8, 8)
    geos.push(eyeG)
    const eye = new THREE.Mesh(eyeG, mats.darkEquipmentMat)
    eye.position.set(sx, 1.35, 0.29)
    fig.add(eye)
  }

  // 金色三齿小皇冠（呼应 cups skin emblemKind='crown_spark'）
  addCylMesh(fig, geos, 0.17, 0.14, 0.14, 0, 1.68, 0, mats.goldAccentMat, 8)
  for (const cx of [-0.1, 0, 0.1]) {
    addCylMesh(fig, geos, 0.015, 0.04, 0.12, cx, 1.79, 0, mats.goldAccentMat, 6)
  }

  // 手持大甜筒法杖示意造型
  addCylMesh(fig, geos, 0.025, 0.025, 0.92, 0.44, 0.88, 0.12, mats.goldAccentMat, 8)
  addCylMesh(fig, geos, 0.09, 0.01, 0.22, 0.44, 1.4, 0.12, mats.chairPatioMat, 10)
  const scoopG = new THREE.SphereGeometry(0.11, 10, 8)
  geos.push(scoopG)
  const scoop = new THREE.Mesh(scoopG, mats.iceCrownMat)
  scoop.position.set(0.44, 1.54, 0.12)
  fig.add(scoop)

  parent.add(fig)
  return fig
}

export function buildDrinksShopMesh(options: DrinksShopBuildOptions = {}): DrinksShopBuildResult {
  const layout = createDefaultDrinksLayout(options.layout)
  const mats = createDrinksShopMaterials(options.skin)
  const geos: THREE.BufferGeometry[] = []
  const colliders: DrinksCollider[] = []

  const addCol = (minX: number, maxX: number, minZ: number, maxZ: number, label: string) => {
    colliders.push({ minX, maxX, minZ, maxZ, label })
  }

  const group = new THREE.Group()
  group.name = 'wangcheng.drinks-shop'

  const upperCutawayGroup = new THREE.Group()
  upperCutawayGroup.name = 'wangcheng.drinks-shop.upper-cutaway'
  group.add(upperCutawayGroup)

  const W = layout.width // 11.40 m (x ∈ [-5.70, +5.70])
  const halfW = W * 0.5 // 5.70 m
  const zBack = -4.6
  const zFront = 2.8
  const zDepthIn = zFront - zBack // 7.40 m
  const zCenterIn = (zBack + zFront) * 0.5 // -0.90 m
  const H1 = DRINKS_SHOP_BLUEPRINT.floor1_height.valueM // 3.30 m
  const H2 = DRINKS_SHOP_BLUEPRINT.floor2_height.valueM // 3.10 m
  const HTotal = H1 + H2 // 6.40 m
  const doorHalfW = DRINKS_SHOP_BLUEPRINT.door_width.valueM * 0.5 // 1.10 m
  const doorCx = layout.entrance.x // 0.20 m -> [-0.90, +1.30]
  const doorH = DRINKS_SHOP_BLUEPRINT.door_height.valueM // 2.50 m
  const wallT = 0.22

  // ─── 1. 人行道地坪 + 桂林盲道（IMG_1359）+ 室内地砖 ───
  addBoxMesh(group, geos, 18.0, 0.08, 6.2, 0, -0.04, 5.7, mats.sidewalkMat)
  addBoxMesh(group, geos, 18.0, 0.015, 0.42, 0, 0.008, 5.85, mats.tactilePathMat)
  addBoxMesh(group, geos, W + 0.2, 0.04, zDepthIn + 0.2, 0, 0.0, zCenterIn, mats.floorTileMat)

  // ─── 2. 首层四面围合结构（后墙、东西墙、正门玻璃幕墙与双开玻璃门） ───
  // 后墙 + 木质护墙板
  addBoxMesh(group, geos, W, H1, wallT, 0, H1 * 0.5, zBack, mats.wallCreamMat)
  addBoxMesh(group, geos, W - 0.3, 1.05, 0.04, 0, 0.525, zBack + wallT * 0.5 + 0.02, mats.wainscotWoodMat)
  addCol(-halfW, halfW, zBack - 0.15, zBack + 0.15, 'wall:back')

  // 西墙（左）+ 东墙（右）
  addBoxMesh(group, geos, wallT, H1, zDepthIn, -halfW, H1 * 0.5, zCenterIn, mats.wallCreamMat)
  addBoxMesh(group, geos, wallT, H1, zDepthIn, halfW, H1 * 0.5, zCenterIn, mats.wallCreamMat)
  addBoxMesh(group, geos, 0.04, 1.05, zDepthIn - 0.3, -halfW + wallT * 0.5 + 0.02, 0.525, zCenterIn, mats.wainscotWoodMat)
  addBoxMesh(group, geos, 0.04, 1.05, zDepthIn - 0.3, halfW - wallT * 0.5 - 0.02, 0.525, zCenterIn, mats.wainscotWoodMat)
  addCol(-halfW - 0.15, -halfW + 0.15, zBack, zFront, 'wall:west')
  addCol(halfW - 0.15, halfW + 0.15, zBack, zFront, 'wall:east')

  // 正立面玻璃幕墙（x ∈ [-5.70, -0.90] 与 [+1.30, +4.05]）+ 门东转角红柱（x ∈ [+4.05, +5.70]）
  const pillarW = DRINKS_SHOP_BLUEPRINT.corner_pillar_width.valueM // 1.65 m
  const glassRightMax = halfW - pillarW // +4.05 m
  const doorMinX = doorCx - doorHalfW // -0.90 m
  const doorMaxX = doorCx + doorHalfW // +1.30 m

  const leftGlassW = doorMinX - -halfW // 4.80 m
  const leftGlassCx = (-halfW + doorMinX) * 0.5 // -3.30 m
  addBoxMesh(group, geos, leftGlassW, H1 - 0.1, 0.08, leftGlassCx, H1 * 0.5, zFront, mats.curtainGlassMat)
  addBoxMesh(group, geos, leftGlassW, 0.14, 0.14, leftGlassCx, 0.07, zFront, mats.curtainMullionMat)
  addBoxMesh(group, geos, leftGlassW, 0.14, 0.14, leftGlassCx, H1 - 0.07, zFront, mats.curtainMullionMat)
  addCol(-halfW, doorMinX, zFront - 0.1, zFront + 0.1, 'facade:glass-west')

  const rightGlassW = glassRightMax - doorMaxX // 2.75 m
  const rightGlassCx = (doorMaxX + glassRightMax) * 0.5 // +2.675 m
  addBoxMesh(group, geos, rightGlassW, H1 - 0.1, 0.08, rightGlassCx, H1 * 0.5, zFront, mats.curtainGlassMat)
  addBoxMesh(group, geos, rightGlassW, 0.14, 0.14, rightGlassCx, 0.07, zFront, mats.curtainMullionMat)
  addBoxMesh(group, geos, rightGlassW, 0.14, 0.14, rightGlassCx, H1 - 0.07, zFront, mats.curtainMullionMat)
  addCol(doorMaxX, glassRightMax, zFront - 0.1, zFront + 0.1, 'facade:glass-east')

  // 黑色细框幕墙竖梃（按 blueprint 1.05m 分格）
  const bayW = DRINKS_SHOP_BLUEPRINT.curtain_bay_width.valueM
  for (let x = -halfW + bayW; x < doorMinX - 0.25; x += bayW) {
    addBoxMesh(group, geos, 0.06, H1, 0.12, x, H1 * 0.5, zFront, mats.curtainMullionMat)
  }
  for (let x = doorMaxX + bayW; x < glassRightMax - 0.25; x += bayW) {
    addBoxMesh(group, geos, 0.06, H1, 0.12, x, H1 * 0.5, zFront, mats.curtainMullionMat)
  }

  // 正门双开玻璃门向外敞开于挑檐下（商业消防外开规范，零侵占室内排队候餐区）
  for (const [hx, sign] of [
    [doorMinX + 0.04, 1],
    [doorMaxX - 0.04, -1],
  ] as const) {
    addBoxMesh(group, geos, 0.07, doorH, 0.12, hx, doorH * 0.5, zFront, mats.curtainMullionMat)
    // 向外敞开 0.92m 宽玻璃门扇（置于雨棚阴影之下）
    addBoxMesh(group, geos, 0.03, doorH - 0.08, 0.92, hx + sign * 0.02, doorH * 0.5, zFront + 0.48, mats.doorGlassMat)
    addBoxMesh(group, geos, 0.04, 0.42, 0.03, hx + sign * 0.06, 1.1, zFront + 0.82, mats.stainlessMat)
  }
  addBoxMesh(group, geos, doorHalfW * 2, 0.12, 0.14, doorCx, doorH + 0.06, zFront, mats.curtainMullionMat)
  addBoxMesh(group, geos, doorHalfW * 2, H1 - doorH - 0.12, 0.08, doorCx, (doorH + H1) * 0.5, zFront, mats.curtainGlassMat)
  // 入口浅金属平雨棚（06_IMG_1395 相邻商厦入口浅雨棚语言）
  addBoxMesh(group, geos, doorHalfW * 2 + 0.9, 0.09, 1.05, doorCx, 2.74, zFront + 0.54, mats.curtainMullionMat)

  // ─── 3. 二层红色转角旗舰盒体裙房 + 竖向包柱招牌（06_IMG_1395 实拍 1-2F 结构，可剖切顶层） ───
  // 右侧整高（1-2F = 6.40m）红色转角竖向包柱
  const cornerCx = glassRightMax + pillarW * 0.5 // +4.875 m
  addBoxMesh(group, geos, pillarW, HTotal, 0.46, cornerCx, HTotal * 0.5, zFront + 0.08, mats.podiumRedMat)
  addPlaneMesh(group, geos, pillarW * 0.84, HTotal * 0.86, cornerCx, HTotal * 0.5, zFront + 0.32, mats.verticalPillarMat)
  addPlaneMesh(group, geos, 1.15, HTotal * 0.82, halfW + 0.18, HTotal * 0.5, zFront - 0.28, mats.verticalPillarMat, Math.PI * 0.5)
  addCol(glassRightMax, halfW, zFront - 0.15, zFront + 0.32, 'facade:corner-pillar')

  // 二层主体围护与通高红色包框招牌（upperCutawayGroup：可切开顶盖看俯视内部）
  const fasciaW = W - pillarW // 9.75 m (x ∈ [-5.70, +4.05])
  const fasciaCx = (-halfW + glassRightMax) * 0.5 // -0.825 m
  const fasciaH = DRINKS_SHOP_BLUEPRINT.fascia_height.valueM // 2.55 m
  const fasciaCy = H1 + H2 * 0.5 - 0.12 // 4.73 m

  // 1F 天花板横梁槽与自发光 LED 灯带（始终保留天花灯带边条或随 cutaway 开关）
  addBoxMesh(upperCutawayGroup, geos, W, 0.16, zDepthIn, 0, H1 + 0.08, zCenterIn, mats.roofMat)
  for (const lz of [-2.8, -0.4, 1.6]) {
    addBoxMesh(group, geos, 8.2, 0.04, 0.14, 0, H1 - 0.02, lz, mats.ceilingLampMat)
  }

  // 二层后/侧白墙 + 二层顶板
  addBoxMesh(upperCutawayGroup, geos, W, H2, wallT, 0, H1 + H2 * 0.5, zBack, mats.curtainMullionMat)
  addBoxMesh(upperCutawayGroup, geos, wallT, H2, zDepthIn, -halfW, H1 + H2 * 0.5, zCenterIn, mats.curtainMullionMat)
  addBoxMesh(upperCutawayGroup, geos, wallT, H2, zDepthIn, halfW, H1 + H2 * 0.5, zCenterIn, mats.curtainMullionMat)
  addBoxMesh(upperCutawayGroup, geos, W + 0.24, 0.22, zDepthIn + 0.36, 0, HTotal + 0.11, zCenterIn + 0.08, mats.roofMat)

  // 二层正立面转角红白旗舰门头盒体 + 二层右侧雪花展窗
  const mainSignW = 6.9
  const mainSignCx = -halfW + mainSignW * 0.5 // -2.25 m -> [-5.70, +1.20]
  addBoxMesh(upperCutawayGroup, geos, mainSignW, fasciaH + 0.35, 0.38, mainSignCx, fasciaCy + 0.05, zFront + 0.12, mats.podiumRedMat)
  addPlaneMesh(upperCutawayGroup, geos, mainSignW - 0.35, fasciaH - 0.3, mainSignCx, fasciaCy, zFront + 0.32, mats.fasciaSignMat)
  addBoxMesh(upperCutawayGroup, geos, fasciaW, 0.44, 0.42, fasciaCx, HTotal - 0.22, zFront + 0.12, mats.snowflakeStripMat)

  // 二层右侧玻璃橱窗（+1.20 .. +4.05）内设 2 座暖光吉祥物展示窗
  const win2W = glassRightMax - 1.2 // 2.85 m
  const win2Cx = (1.2 + glassRightMax) * 0.5 // +2.625 m
  addBoxMesh(upperCutawayGroup, geos, win2W, H2 - 0.45, 0.08, win2Cx, H1 + H2 * 0.5 - 0.15, zFront, mats.curtainGlassMat)
  buildIceCrownMascot(upperCutawayGroup, geos, mats, 2.05, H1 + 0.18, zFront - 0.6, 0.55)
  buildIceCrownMascot(upperCutawayGroup, geos, mats, 3.25, H1 + 0.18, zFront - 0.6, 0.55)

  // ─── 4. 前厅点单收银与取餐组合吧台（严格对齐 sim/menu.ts cashiers/pickupSlots） ───
  const frontLen = DRINKS_SHOP_BLUEPRINT.front_counter_length.valueM // 7.80 m
  const frontH = DRINKS_SHOP_BLUEPRINT.front_counter_height.valueM // 0.96 m
  const frontD = DRINKS_SHOP_BLUEPRINT.front_counter_depth.valueM // 0.68 m
  const frontCx = 0.2
  const frontZ = -0.38
  addBoxMesh(group, geos, frontLen, frontH - 0.08, frontD, frontCx, (frontH - 0.08) * 0.5, frontZ, mats.counterBodyMat)
  addBoxMesh(group, geos, frontLen + 0.08, 0.08, frontD + 0.06, frontCx, frontH - 0.04, frontZ, mats.counterTopMat)
  addBoxMesh(group, geos, frontLen, 0.12, 0.03, frontCx, frontH - 0.2, frontZ + frontD * 0.5 + 0.015, mats.podiumRedMat)
  addCol(frontCx - frontLen * 0.5, frontCx + frontLen * 0.5, frontZ - frontD * 0.5, frontZ + frontD * 0.5, 'counter:front')

  // 双收银台触摸屏 POS + 扫码器
  for (const c of layout.cashiers) {
    addBoxMesh(group, geos, 0.36, 0.24, 0.05, c.clerkPos.x, frontH + 0.2, frontZ + 0.02, mats.darkEquipmentMat, 0, -0.25)
    addBoxMesh(group, geos, 0.14, 0.16, 0.16, c.clerkPos.x + 0.28, frontH + 0.08, frontZ + 0.12, mats.podiumRedMat)
  }

  // 右侧取餐台垫、防溅挡板与待取示杯
  addBoxMesh(group, geos, 3.1, 0.025, 0.44, 2.55, frontH + 0.012, frontZ + 0.08, mats.stainlessMat)
  addBoxMesh(group, geos, 3.1, 0.24, 0.02, 2.55, frontH + 0.12, frontZ + 0.28, mats.doorGlassMat)
  for (const slot of layout.pickupSlots) {
    addCylMesh(group, geos, 0.045, 0.032, 0.16, slot.x, frontH + 0.1, frontZ + 0.08, mats.podiumRedMat, 10)
    addCylMesh(group, geos, 0.048, 0.048, 0.02, slot.x, frontH + 0.18, frontZ + 0.08, mats.podiumTrimCreamMat, 10)
  }

  // 悬挂式发光价目灯箱 + 取餐叫号屏（挂吧台上方 y=2.32）
  addBoxMesh(group, geos, 3.3, 0.96, 0.12, -1.4, 2.42, frontZ, mats.darkEquipmentMat)
  addPlaneMesh(group, geos, 3.15, 0.84, -1.4, 2.42, frontZ + 0.07, mats.menuBoardMat)
  addBoxMesh(group, geos, 2.6, 0.72, 0.12, 2.35, 2.42, frontZ, mats.darkEquipmentMat)
  addPlaneMesh(group, geos, 2.46, 0.62, 2.35, 2.42, frontZ + 0.07, mats.callScreenMat)
  for (const sx of [-2.7, -0.1, 1.3, 3.4]) {
    addBoxMesh(group, geos, 0.04, 0.56, 0.04, sx, 3.02, frontZ, mats.curtainMullionMat)
  }

  // 门口内侧电子看板（对齐 layout.menuBoardSlots）
  addBoxMesh(group, geos, 1.4, 1.65, 0.08, -1.2, 1.28, zFront - 0.16, mats.darkEquipmentMat)
  addPlaneMesh(group, geos, 1.28, 0.85, -1.2, 1.56, zFront - 0.21, mats.menuBoardMat, Math.PI)

  // ─── 5. 后场不锈钢制茶/碎冰/冰淇淋备料台（严格对齐 layout.prepStations & storagePos） ───
  const prepLen = DRINKS_SHOP_BLUEPRINT.prep_bar_length.valueM // 8.00 m
  const prepH = DRINKS_SHOP_BLUEPRINT.prep_bar_height.valueM // 0.88 m
  const prepD = DRINKS_SHOP_BLUEPRINT.prep_bar_depth.valueM // 0.78 m
  const prepCx = -0.2
  const prepZ = -3.35
  addBoxMesh(group, geos, prepLen, prepH, prepD, prepCx, prepH * 0.5, prepZ, mats.stainlessMat)
  addBoxMesh(group, geos, prepLen + 0.06, 0.05, prepD + 0.06, prepCx, prepH + 0.025, prepZ, mats.counterTopMat)
  addBoxMesh(group, geos, prepLen, 0.22, 0.04, prepCx, prepH + 0.14, prepZ - prepD * 0.5 + 0.02, mats.stainlessMat)
  addCol(prepCx - prepLen * 0.5, prepCx + prepLen * 0.5, prepZ - prepD * 0.5, prepZ + prepD * 0.5, 'counter:prep')

  for (const st of layout.prepStations) {
    if (st.kind === 'lemon_ice') {
      // 大型商用制冰机（斜坡冰仓门）+ 透明鲜柠檬切片缸 + 红色立式取杯架
      addBoxMesh(group, geos, 0.7, 0.66, 0.52, st.x - 0.14, prepH + 0.38, prepZ, mats.stainlessMat)
      addBoxMesh(group, geos, 0.54, 0.24, 0.08, st.x - 0.14, prepH + 0.45, prepZ + 0.25, mats.darkEquipmentMat, 0, -0.32)
      addCylMesh(group, geos, 0.15, 0.14, 0.34, st.x + 0.44, prepH + 0.22, prepZ + 0.04, mats.goldAccentMat, 10)
      addCylMesh(group, geos, 0.06, 0.055, 0.46, st.x + 0.78, prepH + 0.28, prepZ, mats.podiumRedMat, 10)
      addCylMesh(group, geos, 0.062, 0.062, 0.03, st.x + 0.78, prepH + 0.52, prepZ, mats.podiumTrimCreamMat, 10)
    } else if (st.kind === 'tea_shake') {
      // 双筒保温萃茶桶（含前端出茶龙头与接水盘）+ 果糖定量泵 + 红色封口机门架
      for (const tx of [st.x - 0.24, st.x + 0.08]) {
        addCylMesh(group, geos, 0.14, 0.14, 0.48, tx, prepH + 0.29, prepZ, mats.stainlessMat, 12)
        addCylMesh(group, geos, 0.145, 0.145, 0.05, tx, prepH + 0.54, prepZ, mats.darkEquipmentMat, 12)
        addBoxMesh(group, geos, 0.04, 0.05, 0.1, tx, prepH + 0.18, prepZ + 0.16, mats.darkEquipmentMat)
      }
      addBoxMesh(group, geos, 0.34, 0.46, 0.32, st.x + 0.44, prepH + 0.28, prepZ, mats.podiumRedMat)
      addBoxMesh(group, geos, 0.22, 0.2, 0.28, st.x + 0.44, prepH + 0.22, prepZ + 0.06, mats.darkEquipmentMat)
    } else {
      // 双头立式现打甜筒冰淇淋机（面板 + 三根拉杆 + 双星形出料嘴 + 接水盘）+ 黑糖珍珠保温锅
      addBoxMesh(group, geos, 0.56, 0.82, 0.52, st.x, prepH + 0.46, prepZ, mats.podiumTrimCreamMat)
      addBoxMesh(group, geos, 0.52, 0.22, 0.04, st.x, prepH + 0.72, prepZ + 0.26, mats.podiumRedMat)
      for (const nx of [-0.14, 0, 0.14]) {
        addCylMesh(group, geos, 0.016, 0.012, 0.16, st.x + nx, prepH + 0.52, prepZ + 0.31, mats.stainlessMat, 6)
        addCylMesh(group, geos, 0.028, 0.018, 0.09, st.x + nx, prepH + 0.41, prepZ + 0.3, mats.darkEquipmentMat, 8)
      }
      addBoxMesh(group, geos, 0.44, 0.04, 0.14, st.x, prepH + 0.26, prepZ + 0.28, mats.stainlessMat)
      addCylMesh(group, geos, 0.16, 0.16, 0.24, st.x + 0.52, prepH + 0.17, prepZ, mats.darkEquipmentMat, 12)
      addCylMesh(group, geos, 0.15, 0.15, 0.04, st.x + 0.52, prepH + 0.3, prepZ, mats.stainlessMat, 12)
    }
  }

  // 后场左侧仓储货架与原料箱（storagePos -4.45, -3.35）
  const sx = layout.storagePos.x - 0.55
  const sz = layout.storagePos.z
  addBoxMesh(group, geos, 0.85, 1.75, 0.65, sx, 0.875, sz - 0.25, mats.stainlessMat)
  addBoxMesh(group, geos, 0.68, 0.42, 0.48, sx, 0.3, sz + 0.38, mats.crateMat)
  addBoxMesh(group, geos, 0.64, 0.38, 0.44, sx, 0.72, sz + 0.38, mats.crateMat)
  addCol(sx - 0.45, sx + 0.45, sz - 0.6, sz + 0.65, 'storage:crates')

  // ─── 6. 室内外客席桌椅 + 外摆遮阳伞 + 转角皇冠冰晶打卡立像（严格对齐 layout.seats） ───
  const tableSize = DRINKS_SHOP_BLUEPRINT.dining_table_size.valueM // 0.64 m
  const seatH = DRINKS_SHOP_BLUEPRINT.dining_seat_height.valueM // 0.44 m

  for (const seat of layout.seats) {
    const chairMat = seat.zone === 'patio' ? mats.chairPatioMat : mats.chairIndoorMat
    addBoxMesh(group, geos, 0.42, 0.06, 0.42, seat.x, seatH, seat.z, chairMat, seat.yaw)
    addBoxMesh(group, geos, 0.06, seatH, 0.06, seat.x - 0.15, seatH * 0.5, seat.z - 0.15, mats.curtainMullionMat)
    addBoxMesh(group, geos, 0.06, seatH, 0.06, seat.x + 0.15, seatH * 0.5, seat.z + 0.15, mats.curtainMullionMat)
    // 椅背设在座椅远离桌面一侧
    const bx = seat.x - Math.sin(seat.yaw) * 0.18
    const bz = seat.z - Math.cos(seat.yaw) * 0.18
    addBoxMesh(group, geos, 0.4, 0.38, 0.05, bx, seatH + 0.2, bz, chairMat, seat.yaw)
  }

  // 桌体合用布局：西内侧长桌 (-4.0, 0.95)、东内侧 3 小桌 (4.05, z)、外摆双桌 (-3.3, 4.22) & (+3.2, 4.22)
  const addCafeTable = (tx: number, tz: number, w: number, d: number, parasol = false) => {
    addBoxMesh(group, geos, w, 0.05, d, tx, 0.74, tz, mats.woodTableMat)
    addCylMesh(group, geos, 0.045, 0.045, 0.72, tx, 0.36, tz, mats.curtainMullionMat, 8)
    addCylMesh(group, geos, 0.22, 0.24, 0.03, tx, 0.015, tz, mats.curtainMullionMat, 10)
    addCol(tx - w * 0.5, tx + w * 0.5, tz - d * 0.5, tz + d * 0.5, `table:${tx.toFixed(1)},${tz.toFixed(1)}`)
    if (parasol) {
      addCylMesh(group, geos, 0.025, 0.025, 2.35, tx, 1.9, tz, mats.stainlessMat, 8)
      addCylMesh(group, geos, 0.06, 0.88, 0.3, tx, 2.95, tz, mats.parasolRedMat, 10)
    }
  }
  addCafeTable(-4.0, 0.95, 0.54, 1.36, false)
  addCafeTable(4.02, 0.45, tableSize * 0.85, tableSize * 0.85, false)
  addCafeTable(4.02, 1.45, tableSize * 0.85, tableSize * 0.85, false)
  addCafeTable(4.02, 2.25, tableSize * 0.85, tableSize * 0.85, false)
  addCafeTable(-3.3, 4.25, 1.38, 0.58, true)
  addCafeTable(3.1, 4.25, 1.32, 0.58, true)

  // 西南角门前独立大型立体打卡立像（高 2.05m，移至 (-5.45, 4.25) 远离外摆座与权杖边距，不挡通道）
  const statue = buildIceCrownMascot(group, geos, mats, -5.45, 0, 4.25, 1.06)
  statue.rotation.y = 0.24
  addCol(-5.95, -4.95, 3.75, 4.75, 'decor:mascot-statue')

  let cutawayOpen = Boolean(options.cutaway)
  const setCutaway = (open: boolean) => {
    cutawayOpen = open
    upperCutawayGroup.visible = !cutawayOpen
  }
  setCutaway(cutawayOpen)

  const bpVal = validateDrinksBlueprint(DRINKS_SHOP_BLUEPRINT_ENTRIES)

  return {
    group,
    layout,
    site: DRINKS_SHOP_SITE,
    blueprint: DRINKS_SHOP_BLUEPRINT,
    blueprintEntries: DRINKS_SHOP_BLUEPRINT_ENTRIES,
    colliders,
    materials: mats,
    setCutaway,
    setNight: night => mats.setNight(night),
    step(_dtSec, _timeSec, night) {
      mats.setNight(night)
    },
    getMetrics() {
      let triangles = 0
      let meshes = 0
      let lights = 0
      group.traverse(o => {
        if ((o as THREE.Light).isLight) lights++
        const mesh = o as THREE.Mesh
        if (mesh.isMesh && mesh.geometry) {
          meshes++
          const idx = mesh.geometry.index
          triangles += idx ? idx.count / 3 : mesh.geometry.attributes.position.count / 3
        }
      })
      return {
        triangles: Math.round(triangles),
        meshes,
        lights,
        colliderCount: colliders.length,
        blueprintCount: bpVal.count,
        blueprintValid: bpVal.valid,
      }
    },
    dispose() {
      group.removeFromParent()
      for (const g of geos) g.dispose()
      mats.dispose()
    },
  }
}
