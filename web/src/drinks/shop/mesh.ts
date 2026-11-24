import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { DrinkSkinConfig } from '../props/skins.ts'
import { createDefaultDrinksLayout } from '../sim/menu.ts'
import type { DrinkShopLayout } from '../sim/types.ts'
import {
  getDrinksBlueprint,
  validateDrinksBlueprint,
  type BlueprintDimensionEntry,
  type DrinksCandidateId,
  type DrinksShopCandidateSite,
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
  candidate?: DrinksCandidateId
  layout?: Partial<DrinkShopLayout>
  skin?: Partial<DrinkSkinConfig>
  cutaway?: boolean
}

export interface DrinksShopMetrics {
  candidate: DrinksCandidateId
  triangles: number
  meshes: number
  lights: number
  colliderCount: number
  blueprintCount: number
  blueprintValid: boolean
}

export interface DrinksShopBuildResult {
  readonly candidate: DrinksCandidateId
  readonly group: THREE.Group
  readonly layout: DrinkShopLayout
  readonly site: DrinksShopCandidateSite
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

const _m4 = new THREE.Matrix4()
const _euler = new THREE.Euler()
const _quat = new THREE.Quaternion()
const _pos = new THREE.Vector3()
const _scale = new THREE.Vector3()

/**
 * 按材质合批静态几何体：保持相同外观与材质独立夜景亮度提升，同时将每组同材质降为单次绘制调用。
 */
class MaterialBatchCollector {
  private readonly buckets = new Map<THREE.Material, THREE.BufferGeometry[]>()

  add(
    rawGeo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rotY = 0,
    rotX = 0,
    rotZ = 0,
    sx = 1,
    sy = 1,
    sz = 1,
  ): void {
    _euler.set(rotX, rotY, rotZ)
    _quat.setFromEuler(_euler)
    _pos.set(x, y, z)
    _scale.set(sx, sy, sz)
    _m4.compose(_pos, _quat, _scale)
    rawGeo.applyMatrix4(_m4)
    const list = this.buckets.get(mat)
    if (list) list.push(rawGeo)
    else this.buckets.set(mat, [rawGeo])
  }

  addBox(
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
  ): void {
    this.add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rotY, rotX, rotZ)
  }

  addCyl(
    rt: number,
    rb: number,
    h: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    seg = 10,
    rotX = 0,
  ): void {
    this.add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, 0, rotX, 0)
  }

  addPlane(w: number, h: number, x: number, y: number, z: number, mat: THREE.Material, rotY = 0, rotX = 0): void {
    this.add(new THREE.PlaneGeometry(w, h), mat, x, y, z, rotY, rotX, 0)
  }

  flush(parent: THREE.Object3D, mergedGeos: THREE.BufferGeometry[]): void {
    for (const [mat, list] of this.buckets) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false)
      if (list.length > 1) {
        for (const g of list) g.dispose()
      }
      if (merged) {
        mergedGeos.push(merged)
        const mesh = new THREE.Mesh(merged, mat)
        parent.add(mesh)
      }
    }
    this.buckets.clear()
  }
}

function addIceCrownMascot(
  batch: MaterialBatchCollector,
  mats: DrinksShopMaterialPack,
  x: number,
  yBase: number,
  z: number,
  scale = 1,
  rotY = 0,
): void {
  const cos = Math.cos(rotY)
  const sin = Math.sin(rotY)
  const pt = (lx: number, ly: number, lz: number): [number, number, number] => [
    x + (lx * cos + lz * sin) * scale,
    yBase + ly * scale,
    z + (-lx * sin + lz * cos) * scale,
  ]

  // 圆台基座 + 红白环饰
  {
    const [px, py, pz] = pt(0, 0.12, 0)
    batch.addCyl(0.44 * scale, 0.48 * scale, 0.24 * scale, px, py, pz, mats.podiumTrimCreamMat, 14)
    const [rx, ry, rz] = pt(0, 0.26, 0)
    batch.addCyl(0.45 * scale, 0.45 * scale, 0.08 * scale, rx, ry, rz, mats.podiumRedMat, 14)
  }

  // 圆润冰晶身躯 + 红围巾
  {
    const [bx, by, bz] = pt(0, 0.68, 0)
    batch.add(new THREE.SphereGeometry(0.4, 12, 10), mats.iceCrownMat, bx, by, bz, rotY, 0, 0, scale, 1.08 * scale, 0.92 * scale)
    const [sx, sy, sz] = pt(0, 1.02, 0)
    batch.addCyl(0.34 * scale, 0.41 * scale, 0.16 * scale, sx, sy, sz, mats.podiumRedMat, 14)
  }

  // 头部与几何眼眉 + 金色三齿小皇冠
  {
    const [hx, hy, hz] = pt(0, 1.34, 0)
    batch.add(new THREE.SphereGeometry(0.32, 12, 10), mats.iceCrownMat, hx, hy, hz, rotY, 0, 0, scale, scale, scale)
    for (const ex of [-0.11, 0.11]) {
      const [px, py, pz] = pt(ex, 1.35, 0.29)
      batch.add(new THREE.SphereGeometry(0.036, 8, 6), mats.darkEquipmentMat, px, py, pz, 0, 0, 0, scale, scale, scale)
    }
    const [crx, cry, crz] = pt(0, 1.68, 0)
    batch.addCyl(0.17 * scale, 0.14 * scale, 0.14 * scale, crx, cry, crz, mats.goldAccentMat, 8)
    for (const cx of [-0.1, 0, 0.1]) {
      const [px, py, pz] = pt(cx, 1.79, 0)
      batch.addCyl(0.015 * scale, 0.04 * scale, 0.12 * scale, px, py, pz, mats.goldAccentMat, 6)
    }
  }

  // 手持甜筒法杖（原创造型）
  {
    const [stx, sty, stz] = pt(0.44, 0.88, 0.12)
    batch.addCyl(0.025 * scale, 0.025 * scale, 0.92 * scale, stx, sty, stz, mats.goldAccentMat, 8)
    const [cnx, cny, cnz] = pt(0.44, 1.4, 0.12)
    batch.addCyl(0.09 * scale, 0.01 * scale, 0.22 * scale, cnx, cny, cnz, mats.chairPatioMat, 8)
    const [scx, scy, scz] = pt(0.44, 1.54, 0.12)
    batch.add(new THREE.SphereGeometry(0.11, 10, 8), mats.iceCrownMat, scx, scy, scz, 0, 0, 0, scale, scale, scale)
  }
}

export function buildDrinksShopMesh(options: DrinksShopBuildOptions = {}): DrinksShopBuildResult {
  const candidate: DrinksCandidateId = options.candidate ?? 'wangcheng_mall'
  const bpProfile = getDrinksBlueprint(candidate)
  const bp = bpProfile.map
  const layout = createDefaultDrinksLayout(options.layout)
  const mats = createDrinksShopMaterials(
    options.skin ??
      (candidate === 'poi_zhengyang208' ? { brandLabel: '正阳冰茶铺' } : { brandLabel: '王城冰茶铺' }),
  )
  const mergedGeos: THREE.BufferGeometry[] = []
  const colliders: DrinksCollider[] = []

  const baseBatch = new MaterialBatchCollector()
  const upperBatch = new MaterialBatchCollector()

  const addCol = (minX: number, maxX: number, minZ: number, maxZ: number, label: string) => {
    colliders.push({ minX, maxX, minZ, maxZ, label })
  }

  const group = new THREE.Group()
  group.name = `drinks.shop.${candidate}`

  const upperCutawayGroup = new THREE.Group()
  upperCutawayGroup.name = `drinks.shop.${candidate}.upper-cutaway`
  group.add(upperCutawayGroup)

  const W = layout.width // 11.40 m (x ∈ [-5.70, +5.70])
  const halfW = W * 0.5 // 5.70 m
  const zBack = -4.6
  const zFront = 2.8
  const zDepthIn = zFront - zBack // 7.40 m
  const zCenterIn = (zBack + zFront) * 0.5 // -0.90 m
  const H1 = bp.floor1_height.valueM
  const wallT = 0.22
  const doorHalfW = bp.door_width.valueM * 0.5 // 1.10 m
  const doorCx = layout.entrance.x // 0.20 m -> [-0.90, +1.30]
  const doorH = bp.door_height.valueM // 2.50 m
  const doorMinX = doorCx - doorHalfW // -0.90 m
  const doorMaxX = doorCx + doorHalfW // +1.30 m

  // ─── 1. 实拍石板人行道地坪 + 黑黄路缘石（08_IMG_1397，无强加未证实黄盲道）+ 室内地砖 ───
  baseBatch.addBox(20.0, 0.08, 6.2, 0.8, -0.04, 5.7, mats.sidewalkMat)
  baseBatch.addBox(20.0, 0.14, 0.22, 0.8, 0.02, 8.7, mats.curbStripeMat)
  baseBatch.addBox(W + 0.2, 0.04, zDepthIn + 0.2, 0, 0.0, zCenterIn, mats.floorTileMat)

  // ─── 2. 首层四面围合结构（共用的后墙、东西墙、全透落地玻璃窗与外开双开正门） ───
  baseBatch.addBox(W, H1, wallT, 0, H1 * 0.5, zBack, mats.wallCreamMat)
  baseBatch.addBox(W - 0.3, 1.05, 0.04, 0, 0.525, zBack + wallT * 0.5 + 0.02, mats.wainscotWoodMat)
  addCol(-halfW, halfW, zBack - 0.15, zBack + 0.15, 'wall:back')

  baseBatch.addBox(wallT, H1, zDepthIn, -halfW, H1 * 0.5, zCenterIn, mats.wallCreamMat)
  baseBatch.addBox(wallT, H1, zDepthIn, halfW, H1 * 0.5, zCenterIn, mats.wallCreamMat)
  baseBatch.addBox(0.04, 1.05, zDepthIn - 0.3, -halfW + wallT * 0.5 + 0.02, 0.525, zCenterIn, mats.wainscotWoodMat)
  baseBatch.addBox(0.04, 1.05, zDepthIn - 0.3, halfW - wallT * 0.5 - 0.02, 0.525, zCenterIn, mats.wainscotWoodMat)
  addCol(-halfW - 0.15, -halfW + 0.15, zBack, zFront, 'wall:west')
  addCol(halfW - 0.15, halfW + 0.15, zBack, zFront, 'wall:east')

  const pillarW = candidate === 'wangcheng_mall' ? bp.corner_pillar_width.valueM : 0.44
  const glassRightMax = halfW - (candidate === 'wangcheng_mall' ? pillarW : 0.32)
  const leftGlassW = doorMinX - -halfW
  const leftGlassCx = (-halfW + doorMinX) * 0.5
  baseBatch.addBox(leftGlassW, H1 - 0.1, 0.06, leftGlassCx, H1 * 0.5, zFront, mats.curtainGlassMat)
  baseBatch.addBox(leftGlassW, 0.14, 0.14, leftGlassCx, 0.07, zFront, mats.curtainMullionMat)
  baseBatch.addBox(leftGlassW, 0.14, 0.14, leftGlassCx, H1 - 0.07, zFront, mats.curtainMullionMat)
  addCol(-halfW, doorMinX, zFront - 0.1, zFront + 0.1, 'facade:glass-west')

  const rightGlassW = glassRightMax - doorMaxX
  const rightGlassCx = (doorMaxX + glassRightMax) * 0.5
  baseBatch.addBox(rightGlassW, H1 - 0.1, 0.06, rightGlassCx, H1 * 0.5, zFront, mats.curtainGlassMat)
  baseBatch.addBox(rightGlassW, 0.14, 0.14, rightGlassCx, 0.07, zFront, mats.curtainMullionMat)
  baseBatch.addBox(rightGlassW, 0.14, 0.14, rightGlassCx, H1 - 0.07, zFront, mats.curtainMullionMat)
  addCol(doorMaxX, glassRightMax, zFront - 0.1, zFront + 0.1, 'facade:glass-east')

  const bayW = bp.curtain_bay_width.valueM
  for (let x = -halfW + bayW; x < doorMinX - 0.25; x += bayW) {
    baseBatch.addBox(0.06, H1, 0.12, x, H1 * 0.5, zFront, mats.curtainMullionMat)
  }
  for (let x = doorMaxX + bayW; x < glassRightMax - 0.25; x += bayW) {
    baseBatch.addBox(0.06, H1, 0.12, x, H1 * 0.5, zFront, mats.curtainMullionMat)
  }

  // 外开玻璃双门与亮框
  for (const [hx, sign] of [
    [doorMinX + 0.04, 1],
    [doorMaxX - 0.04, -1],
  ] as const) {
    baseBatch.addBox(0.07, doorH, 0.12, hx, doorH * 0.5, zFront, mats.curtainMullionMat)
    baseBatch.addBox(0.03, doorH - 0.08, 0.9, hx + sign * 0.02, doorH * 0.5, zFront + 0.48, mats.doorGlassMat)
    baseBatch.addBox(0.04, 0.42, 0.03, hx + sign * 0.06, 1.1, zFront + 0.82, mats.stainlessMat)
  }
  baseBatch.addBox(doorHalfW * 2, 0.12, 0.14, doorCx, doorH + 0.06, zFront, mats.curtainMullionMat)
  baseBatch.addBox(doorHalfW * 2, H1 - doorH - 0.12, 0.06, doorCx, (doorH + H1) * 0.5, zFront, mats.curtainGlassMat)

  // 1F 天花板顶板 + 亮白灯带
  upperBatch.addBox(W, 0.16, zDepthIn, 0, H1 + 0.08, zCenterIn, mats.roofMat)
  for (const lz of [-2.8, -0.4, 1.6]) {
    baseBatch.addBox(8.6, 0.04, 0.14, 0, H1 - 0.02, lz, mats.ceilingLampMat)
  }

  // ─── 3. 按候选点位差异构建外立面体块与上部构造 ───
  if (candidate === 'wangcheng_mall') {
    const H2 = bp.floor2_height.valueM // 3.10 m
    const H3 = bp.floor3_height.valueM // 3.10 m
    const HPodium = H1 + H2 + H3 // 9.50 m (1–3F 通高红框裙房，贴合 04/06/08)
    const hostH = 5.4 // 4F–6F 上部幕墙示廓 -> 屋檐总高 14.90m

    // 入口金属平雨棚（置于 upperBatch 以便 cutaway 俯视客席完全无遮挡）
    upperBatch.addBox(doorHalfW * 2 + 0.9, 0.08, 1.05, doorCx, 2.78, zFront + 0.54, mats.curtainMullionMat)

    // 1–3F 东侧转角通高红色竖向包柱：底部踢脚留驻底座，外包红柱护壳归入 upperBatch，以便 cutaway 剖视时彻底露出东内侧 3 席客座
    const cornerCx = glassRightMax + pillarW * 0.5 // +4.875 m
    baseBatch.addBox(pillarW, 0.24, 0.44, cornerCx, 0.12, zFront + 0.06, mats.podiumRedMat)
    baseBatch.addBox(pillarW, H1 - 0.24, 0.06, cornerCx, 0.24 + (H1 - 0.24) * 0.5, zFront, mats.curtainGlassMat)
    upperBatch.addBox(pillarW, HPodium - 0.24, 0.46, cornerCx, 0.24 + (HPodium - 0.24) * 0.5, zFront + 0.08, mats.podiumRedMat)
    upperBatch.addBox(pillarW * 0.82, 0.14, 0.48, cornerCx, H1 - 0.12, zFront + 0.08, mats.podiumTrimCreamMat)
    upperBatch.addPlane(pillarW * 0.84, 3.85, cornerCx, 7.22, zFront + 0.32, mats.verticalPillarMat)
    upperBatch.addPlane(1.06, 1.06, cornerCx, 4.18, zFront + 0.325, mats.pillarBadgeMat)
    upperBatch.addPlane(1.12, 3.85, halfW + 0.18, 7.22, zFront - 0.28, mats.verticalPillarMat, Math.PI * 0.5)
    upperBatch.addPlane(0.98, 0.98, halfW + 0.18, 4.18, zFront - 0.28, mats.pillarBadgeMat, Math.PI * 0.5)
    addCol(glassRightMax, halfW, zFront - 0.15, zFront + 0.32, 'facade:corner-pillar')

    // 2F–3F 主展面红色大盒体包框 + 白顶装饰带 + 巨幅招牌（upperCutaway）
    const fasciaW = W - pillarW // 9.75 m
    const fasciaCx = (-halfW + glassRightMax) * 0.5 // -0.825 m
    const upperPodiumH = H2 + H3 // 6.20 m
    const upperMidY = H1 + upperPodiumH * 0.5

    upperBatch.addBox(W, upperPodiumH, wallT, 0, upperMidY, zBack, mats.curtainMullionMat)
    upperBatch.addBox(wallT, upperPodiumH, zDepthIn, -halfW, upperMidY, zCenterIn, mats.curtainMullionMat)
    upperBatch.addBox(wallT, upperPodiumH, zDepthIn, halfW, upperMidY, zCenterIn, mats.curtainMullionMat)
    upperBatch.addBox(W + 0.24, 0.2, zDepthIn + 0.36, 0, HPodium + 0.1, zCenterIn + 0.08, mats.roofMat)

    const fasciaH = bp.fascia_height.valueM // 4.80 m
    const mainSignW = 7.1
    const mainSignCx = -halfW + mainSignW * 0.5
    upperBatch.addBox(mainSignW, fasciaH + 0.4, 0.38, mainSignCx, H1 + 3.05, zFront + 0.12, mats.podiumRedMat)
    upperBatch.addPlane(mainSignW - 0.42, fasciaH * 0.52, mainSignCx, H1 + 3.65, zFront + 0.32, mats.fasciaSignMat)
    upperBatch.addBox(fasciaW, 0.52, 0.42, fasciaCx, HPodium - 0.26, zFront + 0.12, mats.snowflakeStripMat)
    upperBatch.addBox(W, 0.18, 0.46, 0, HPodium + 0.02, zFront + 0.12, mats.podiumTrimCreamMat)

    // 2F–3F 右侧全高橱窗围合亮箱（背板 + 左右侧折边亮壁，从任何侧视角看零暗角黑边）
    const win2Left = mainSignCx + mainSignW * 0.5
    const win2W = glassRightMax - win2Left
    const win2Cx = (win2Left + glassRightMax) * 0.5
    upperBatch.addBox(win2W + 0.3, H2 + H3, 0.18, win2Cx, H1 + (H2 + H3) * 0.5, zFront - 1.15, mats.wallCreamMat)
    upperBatch.addBox(0.16, H2 + H3, 1.25, win2Left + 0.06, H1 + (H2 + H3) * 0.5, zFront - 0.55, mats.wallCreamMat)
    upperBatch.addBox(0.16, H2 + H3, 1.25, glassRightMax - 0.06, H1 + (H2 + H3) * 0.5, zFront - 0.55, mats.wallCreamMat)
    upperBatch.addBox(win2W + 0.3, 0.3, 0.18, win2Cx, H1 + H2 + 1.5, zFront + 0.02, mats.podiumRedMat)
    upperBatch.addBox(win2W + 0.2, H3 - 0.25, 0.22, win2Cx, H1 + H2 + H3 * 0.5, zFront + 0.08, mats.podiumRedMat)
    upperBatch.addBox(win2W, 0.2, 0.9, win2Cx, H1 + 0.1, zFront - 0.4, mats.podiumTrimCreamMat)
    upperBatch.addBox(win2W, H2 - 0.3, 0.06, win2Cx, H1 + H2 * 0.5, zFront, mats.curtainGlassMat)
    upperBatch.addBox(win2W, 0.24, 0.36, win2Cx, H1 + H2 + 0.12, zFront + 0.1, mats.podiumRedMat)
    addIceCrownMascot(upperBatch, mats, 2.75, H1 + 0.2, zFront + 0.16, 1.32, -0.15)
    addIceCrownMascot(upperBatch, mats, 1.98, H1 + 0.2, zFront - 0.56, 0.52)

    // 4F–6F 商厦主体（含西侧 3 格相邻商铺延伸，还原 06_IMG_1395 宽幅街区尺度，z <= 2.8 不侵占道路）
    const hostCy = HPodium + hostH * 0.5
    upperBatch.addBox(W + 3.6, hostH, zDepthIn + 0.2, -1.6, hostCy, zCenterIn, mats.upperCurtainMat)
    upperBatch.addBox(W + 3.7, 0.32, zDepthIn + 0.35, -1.6, HPodium + hostH + 0.16, zCenterIn, mats.curtainMullionMat)
    // 西侧相邻 1–3F 商铺背景体块（x ∈ [-9.1, -5.7]，与主店无缝相接）
    upperBatch.addBox(3.4, HPodium, zDepthIn, -halfW - 1.7, HPodium * 0.5, zCenterIn, mats.upperCurtainMat)
    upperBatch.addBox(3.4, 0.35, 0.2, -halfW - 1.7, H1, zFront - 0.04, mats.curtainMullionMat)

    // 东侧 8 格落地无缝弧角幕墙转角翼（y=0..14.90 全高落地，贴合 04/06/08 弧形转角且 z <= 2.8 避开人行道）
    const curveR = 4.6
    const curveCx = halfW
    const curveCz = zFront - curveR // -1.80 m
    const curveSegs = 8
    const curveSpan = Math.PI * 0.44
    const totalMallH = HPodium + hostH
    // 弧翼内芯亮背体块（消除透明间隙与浮空感）
    upperBatch.addBox(curveR - 0.3, totalMallH, 3.6, halfW + (curveR - 0.3) * 0.5 - 0.2, totalMallH * 0.5, zFront - 2.35, mats.wallCreamMat)
    for (let seg = 0; seg < curveSegs; seg++) {
      const t0 = (seg / curveSegs) * curveSpan
      const t1 = ((seg + 1) / curveSegs) * curveSpan
      const tm = (t0 + t1) * 0.5
      const chordW = 2 * curveR * Math.sin((t1 - t0) * 0.5) + 0.06
      const ax = curveCx + Math.sin(tm) * curveR
      const az = curveCz + Math.cos(tm) * curveR
      // 1F 石材踢脚底座 + 全高玻璃弧面 + 竖梃 + 檐顶女儿墙压顶
      upperBatch.addBox(chordW, 0.45, 0.26, ax, 0.225, az, mats.sidewalkMat, tm)
      upperBatch.addBox(chordW, totalMallH - 0.45, 0.22, ax, 0.45 + (totalMallH - 0.45) * 0.5, az, mats.upperCurtainMat, tm)
      upperBatch.addBox(0.08, totalMallH, 0.26, ax + Math.cos(tm) * chordW * 0.5, totalMallH * 0.5, az - Math.sin(tm) * chordW * 0.5, mats.curtainMullionMat, tm)
      upperBatch.addBox(chordW, 0.32, 0.3, ax, totalMallH + 0.16, az, mats.curtainMullionMat, tm)
    }
  } else {
    // 候选点位 A (`poi_zhengyang208`)：正阳路单层平铺沿街大开间 + 横向条招 + 红白条纹遮阳篷 + 侧挑刀旗
    const HParapet = bp.parapet_height.valueM // 4.60 m
    const fasciaH = bp.fascia_height.valueM // 1.32 m

    baseBatch.addBox(0.32, H1, 0.38, glassRightMax + 0.16, H1 * 0.5, zFront + 0.04, mats.wallCreamMat)
    baseBatch.addBox(0.32, H1, 0.38, -halfW + 0.16, H1 * 0.5, zFront + 0.04, mats.wallCreamMat)
    addCol(glassRightMax, halfW, zFront - 0.15, zFront + 0.25, 'facade:east-stone-pier')

    // 红白条纹倾斜遮阳篷（置于 upperBatch，cutaway 打开时收起以露出室内座位）
    upperBatch.addBox(W - 0.6, 0.09, 0.96, 0, 2.86, zFront + 0.46, mats.awningStripeMat, 0, 0.18, 0)
    upperBatch.addBox(W - 0.5, 0.07, 0.12, 0, 2.94, zFront + 0.04, mats.curtainMullionMat)

    // 东侧悬挑双面竖向灯箱刀旗（0.55m x 2.05m）
    baseBatch.addBox(0.56, 2.05, 0.16, halfW + 0.34, 3.1, zFront + 0.06, mats.podiumRedMat)
    baseBatch.addPlane(0.46, 1.85, halfW + 0.34, 3.1, zFront + 0.15, mats.verticalPillarMat)
    baseBatch.addPlane(0.46, 1.85, halfW + 0.34, 3.1, zFront - 0.03, mats.verticalPillarMat, Math.PI)

    // 1F 女儿墙石材围框 + 水平单层通长红色门头灯箱
    const parapetH = HParapet - H1 // 1.25 m
    upperBatch.addBox(W, parapetH, wallT, 0, H1 + parapetH * 0.5, zBack, mats.wallCreamMat)
    upperBatch.addBox(wallT, parapetH, zDepthIn, -halfW, H1 + parapetH * 0.5, zCenterIn, mats.wallCreamMat)
    upperBatch.addBox(wallT, parapetH, zDepthIn, halfW, H1 + parapetH * 0.5, zCenterIn, mats.wallCreamMat)
    upperBatch.addBox(W + 0.22, 0.16, zDepthIn + 0.28, 0, HParapet + 0.06, zCenterIn + 0.04, mats.roofMat)

    upperBatch.addBox(W - 0.1, fasciaH, 0.3, 0, H1 + parapetH * 0.5 + 0.05, zFront + 0.08, mats.podiumRedMat)
    upperBatch.addPlane(9.9, fasciaH - 0.18, 0, H1 + parapetH * 0.5 + 0.05, zFront + 0.24, mats.fasciaSignMat)
    upperBatch.addBox(W + 0.16, 0.14, 0.36, 0, HParapet + 0.04, zFront + 0.1, mats.podiumTrimCreamMat)
  }

  // ─── 4. 前厅点单收银与取餐组合吧台（严格对齐 sim/menu.ts cashiers/pickupSlots） ───
  const frontLen = bp.front_counter_length.valueM // 7.80 m
  const frontH = bp.front_counter_height.valueM // 0.96 m
  const frontD = 0.62 // 内缩留足顾客手部净空（z ∈ [-0.75, -0.13] vs 顾客 z=0.14）
  const frontCx = 0.4
  const frontZ = -0.44
  baseBatch.addBox(frontLen, frontH - 0.08, frontD, frontCx, (frontH - 0.08) * 0.5, frontZ, mats.counterBodyMat)
  baseBatch.addBox(frontLen + 0.08, 0.08, frontD + 0.06, frontCx, frontH - 0.04, frontZ, mats.counterTopMat)
  // 前台高位置分区看板（提升至胸腰高度 y=0.66，避免脚边被完全遮挡）
  baseBatch.addPlane(6.8, 0.42, frontCx, 0.66, frontZ + frontD * 0.5 + 0.015, mats.counterOrderSignMat)
  baseBatch.addBox(frontLen, 0.06, 0.03, frontCx, frontH - 0.1, frontZ + frontD * 0.5 + 0.012, mats.podiumRedMat)
  addCol(frontCx - frontLen * 0.5, frontCx + frontLen * 0.5, frontZ - frontD * 0.5, frontZ + frontD * 0.5, 'counter:front')

  // 双收银台触摸屏 POS + 小票机 + 扫码牌
  for (const c of layout.cashiers) {
    baseBatch.addBox(0.36, 0.24, 0.05, c.clerkPos.x, frontH + 0.2, frontZ + 0.02, mats.darkEquipmentMat, 0, -0.25)
    baseBatch.addBox(0.14, 0.16, 0.16, c.clerkPos.x + 0.3, frontH + 0.08, frontZ + 0.12, mats.podiumRedMat)
  }

  // 右侧取餐台垫、防溅玻璃挡板与 4 杯高亮待取饮品（对齐 pickupSlots 1.40..3.90）
  baseBatch.addBox(3.15, 0.03, 0.4, 2.65, frontH + 0.015, frontZ + 0.04, mats.stainlessMat)
  baseBatch.addBox(3.15, 0.2, 0.02, 2.65, frontH + 0.1, frontZ + 0.23, mats.doorGlassMat)
  for (const slot of layout.pickupSlots) {
    baseBatch.addCyl(0.05, 0.036, 0.19, slot.x, frontH + 0.12, frontZ + 0.03, mats.podiumRedMat, 8)
    baseBatch.addCyl(0.053, 0.053, 0.03, slot.x, frontH + 0.22, frontZ + 0.03, mats.podiumTrimCreamMat, 8)
  }

  // 悬挂式发光价目灯箱 + 取餐叫号屏（抬高至 y=2.74，位于 NPC 对话气泡上方防压字）
  baseBatch.addBox(3.35, 0.88, 0.12, -1.4, 2.74, frontZ, mats.darkEquipmentMat)
  baseBatch.addPlane(3.2, 0.78, -1.4, 2.74, frontZ + 0.07, mats.menuBoardMat)
  baseBatch.addBox(2.65, 0.68, 0.12, 2.4, 2.74, frontZ, mats.darkEquipmentMat)
  baseBatch.addPlane(2.5, 0.58, 2.4, 2.74, frontZ + 0.07, mats.callScreenMat)
  for (const sx of [-2.7, -0.1, 1.35, 3.45]) {
    baseBatch.addBox(0.04, 0.22, 0.04, sx, 3.22, frontZ, mats.curtainMullionMat)
  }

  // 门口迎宾立牌看板（避开 menuBoardSlots (-1.1,2.02) 与门口 [-0.9,+1.3]）
  baseBatch.addBox(1.22, 1.62, 0.08, -1.78, 1.26, zFront - 0.22, mats.darkEquipmentMat)
  baseBatch.addPlane(1.1, 0.82, -1.78, 1.54, zFront - 0.27, mats.menuBoardMat, Math.PI)

  // ─── 5. 后场开放式三区操作台（鲜果碎冰、摇茶封口、冰淇淋奶浆三区明晰分区） ───
  const prepLen = bp.prep_bar_length.valueM // 8.00 m
  const prepH = bp.prep_bar_height.valueM // 0.88 m
  const prepD = bp.prep_bar_depth.valueM // 0.78 m
  const prepCx = -0.2
  const prepZ = -3.35
  baseBatch.addBox(prepLen, prepH, prepD, prepCx, prepH * 0.5, prepZ, mats.stainlessMat)
  baseBatch.addBox(prepLen + 0.06, 0.05, prepD + 0.06, prepCx, prepH + 0.025, prepZ, mats.counterTopMat)
  baseBatch.addBox(prepLen, 0.22, 0.04, prepCx, prepH + 0.14, prepZ - prepD * 0.5 + 0.02, mats.stainlessMat)
  addCol(prepCx - prepLen * 0.5, prepCx + prepLen * 0.5, prepZ - prepD * 0.5, prepZ + prepD * 0.5, 'counter:prep')

  // 后墙三块醒目制作分区吊牌
  for (const [zx, zMat] of [
    [-3.0, mats.prepZoneFruitMat],
    [-0.4, mats.prepZoneTeaMat],
    [2.35, mats.prepZoneCreamMat],
  ] as const) {
    baseBatch.addBox(2.1, 0.52, 0.08, zx, 2.48, zBack + 0.16, mats.darkEquipmentMat)
    baseBatch.addPlane(1.98, 0.44, zx, 2.48, zBack + 0.21, zMat)
  }

  for (const st of layout.prepStations) {
    if (st.kind === 'lemon_ice') {
      // 鲜果碎冰区：制冰机斜坡仓 + 透明柠檬百香果缸 + 红色高筒杯架
      baseBatch.addBox(0.7, 0.66, 0.52, st.x - 0.14, prepH + 0.38, prepZ, mats.stainlessMat)
      baseBatch.addBox(0.54, 0.24, 0.08, st.x - 0.14, prepH + 0.45, prepZ + 0.25, mats.darkEquipmentMat, 0, -0.32)
      baseBatch.addCyl(0.15, 0.14, 0.34, st.x + 0.44, prepH + 0.22, prepZ + 0.04, mats.goldAccentMat, 8)
      baseBatch.addCyl(0.06, 0.055, 0.46, st.x + 0.78, prepH + 0.28, prepZ, mats.podiumRedMat, 8)
      baseBatch.addCyl(0.062, 0.062, 0.03, st.x + 0.78, prepH + 0.52, prepZ, mats.podiumTrimCreamMat, 8)
    } else if (st.kind === 'tea_shake') {
      // 萃茶摇茶 · 封口区：双筒保温茶桶（龙头+接水盘）+ 果糖瓶架 + 自动封口机门架
      for (const tx of [st.x - 0.26, st.x + 0.06]) {
        baseBatch.addCyl(0.14, 0.14, 0.48, tx, prepH + 0.29, prepZ, mats.stainlessMat, 10)
        baseBatch.addCyl(0.145, 0.145, 0.05, tx, prepH + 0.54, prepZ, mats.darkEquipmentMat, 10)
        baseBatch.addBox(0.04, 0.05, 0.1, tx, prepH + 0.18, prepZ + 0.16, mats.darkEquipmentMat)
      }
      baseBatch.addBox(0.34, 0.46, 0.32, st.x + 0.46, prepH + 0.28, prepZ, mats.podiumRedMat)
      baseBatch.addBox(0.22, 0.2, 0.28, st.x + 0.46, prepH + 0.22, prepZ + 0.06, mats.darkEquipmentMat)
      // 果糖定量泵小瓶阵列
      for (const bx of [st.x - 0.46, st.x + 0.25]) {
        baseBatch.addCyl(0.042, 0.042, 0.24, bx, prepH + 0.17, prepZ + 0.18, mats.goldAccentMat, 6)
      }
    } else {
      // 冰淇淋 · 奶浆区：三拉杆双出嘴甜筒机 + 黑糖珍珠保温锅 + 脆筒架
      baseBatch.addBox(0.56, 0.82, 0.52, st.x, prepH + 0.46, prepZ, mats.podiumTrimCreamMat)
      baseBatch.addBox(0.52, 0.22, 0.04, st.x, prepH + 0.72, prepZ + 0.26, mats.podiumRedMat)
      for (const nx of [-0.14, 0, 0.14]) {
        baseBatch.addCyl(0.016, 0.012, 0.16, st.x + nx, prepH + 0.52, prepZ + 0.31, mats.stainlessMat, 6)
        baseBatch.addCyl(0.028, 0.018, 0.09, st.x + nx, prepH + 0.41, prepZ + 0.3, mats.darkEquipmentMat, 6)
      }
      baseBatch.addBox(0.44, 0.04, 0.14, st.x, prepH + 0.26, prepZ + 0.28, mats.stainlessMat)
      baseBatch.addCyl(0.16, 0.16, 0.24, st.x + 0.52, prepH + 0.17, prepZ, mats.darkEquipmentMat, 10)
      baseBatch.addCyl(0.15, 0.15, 0.04, st.x + 0.52, prepH + 0.3, prepZ, mats.stainlessMat, 10)
    }
  }

  // 后场左侧仓储货架与原料箱（避开 storagePos -4.4, -3.15）
  const sx = layout.storagePos.x - 0.55
  const sz = layout.storagePos.z
  baseBatch.addBox(0.82, 1.75, 0.64, sx, 0.875, sz - 0.25, mats.stainlessMat)
  baseBatch.addBox(0.66, 0.42, 0.46, sx, 0.3, sz + 0.36, mats.crateMat)
  baseBatch.addBox(0.62, 0.38, 0.42, sx, 0.72, sz + 0.36, mats.crateMat)
  addCol(sx - 0.44, sx + 0.44, sz - 0.58, sz + 0.62, 'storage:crates')

  // ─── 6. 室内外客席桌椅 + 外摆遮阳伞 + 西南转角迎宾皇冠精灵立像 ───
  const seatH = bp.dining_seat_height.valueM // 0.44 m

  for (const seat of layout.seats) {
    const chairMat = seat.zone === 'patio' ? mats.chairPatioMat : mats.chairIndoorMat
    baseBatch.addBox(0.42, 0.06, 0.42, seat.x, seatH, seat.z, chairMat, seat.yaw)
    baseBatch.addBox(0.06, seatH, 0.06, seat.x - 0.15, seatH * 0.5, seat.z - 0.15, mats.curtainMullionMat)
    baseBatch.addBox(0.06, seatH, 0.06, seat.x + 0.15, seatH * 0.5, seat.z + 0.15, mats.curtainMullionMat)
    const bx = seat.x - Math.sin(seat.yaw) * 0.18
    const bz = seat.z - Math.cos(seat.yaw) * 0.18
    baseBatch.addBox(0.4, 0.38, 0.05, bx, seatH + 0.2, bz, chairMat, seat.yaw)
  }

  const addCafeTable = (tx: number, tz: number, w: number, d: number, parasol = false) => {
    baseBatch.addBox(w, 0.05, d, tx, 0.74, tz, mats.woodTableMat)
    baseBatch.addCyl(0.045, 0.045, 0.72, tx, 0.36, tz, mats.curtainMullionMat, 8)
    baseBatch.addCyl(0.2, 0.22, 0.03, tx, 0.015, tz, mats.curtainMullionMat, 8)
    // 桌面双杯茶饮装饰道具
    baseBatch.addCyl(0.036, 0.026, 0.13, tx + w * 0.16, 0.83, tz, mats.podiumRedMat, 8)
    baseBatch.addCyl(0.036, 0.026, 0.13, tx - w * 0.16, 0.83, tz + d * 0.08, mats.podiumTrimCreamMat, 8)
    addCol(tx - w * 0.5, tx + w * 0.5, tz - d * 0.5, tz + d * 0.5, `table:${tx.toFixed(1)},${tz.toFixed(1)}`)
    if (parasol) {
      baseBatch.addCyl(0.025, 0.025, 2.35, tx, 1.9, tz, mats.stainlessMat, 8)
      // 伞盖归入 upperBatch：cutaway 打开查看座位俯视时折起伞盖防止遮挡前窗视线
      upperBatch.addCyl(0.06, 0.88, 0.3, tx, 2.95, tz, mats.parasolRedMat, 10)
    }
  }
  // 西内侧三人卡桌 (-4.05, 0.95)
  addCafeTable(-4.05, 0.95, 0.54, 1.32, false)
  // 东内侧 3 席紧凑饮品小桌（x=4.22 严密贴合 seat_in_4..6(4.75) 并远避 waitingSpots）
  addCafeTable(4.22, 0.45, 0.42, 0.42, false)
  addCafeTable(4.22, 1.45, 0.42, 0.42, false)
  addCafeTable(4.22, 2.35, 0.42, 0.42, false)
  // 门前东西外摆遮阳伞桌（避开 entrance x=0.20 及 seat_out z=3.68）
  addCafeTable(-3.3, 4.28, 1.36, 0.56, true)
  addCafeTable(3.1, 4.28, 1.3, 0.56, true)

  // 西南窗前紧贴门面迎宾立体「皇冠冰晶精灵」打卡雕塑（退至 z=3.02 避让 approachLeft->door 主行人动线）
  addIceCrownMascot(baseBatch, mats, -5.25, 0, 3.02, 0.92, 0.28)
  addCol(-5.7, -4.8, 2.6, 3.45, 'decor:mascot-statue')

  baseBatch.flush(group, mergedGeos)
  upperBatch.flush(upperCutawayGroup, mergedGeos)

  let cutawayOpen = Boolean(options.cutaway)
  const setCutaway = (open: boolean) => {
    cutawayOpen = open
    upperCutawayGroup.visible = !cutawayOpen
  }
  setCutaway(cutawayOpen)

  const bpVal = validateDrinksBlueprint(bpProfile.entries)

  return {
    candidate,
    group,
    layout,
    site: bpProfile.site,
    blueprint: bp,
    blueprintEntries: bpProfile.entries,
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
        candidate,
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
      for (const g of mergedGeos) g.dispose()
      mats.dispose()
    },
  }
}
