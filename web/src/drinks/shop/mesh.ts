import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { DrinkSkinConfig } from '../props/skins.ts'
import { createDefaultDrinksLayout } from '../sim/menu.ts'
import type { DrinkShopLayout } from '../sim/types.ts'
import {
  DRINKS_SHOP_DOORWAY,
  DRINKS_SHOP_INTERIOR,
  DRINKS_STAFF_OPERATION_ZONE,
  DRINKS_STAFF_WORKSTATIONS,
  getDrinksBlueprint,
  validateDrinksBlueprint,
  type BlueprintDimensionEntry,
  type DrinksCandidateId,
  type DrinksDoorwayBounds,
  type DrinksInteriorBounds,
  type DrinksShopCandidateSite,
  type DrinksWorkstationZone,
} from './blueprint.ts'
import {
  EXTERIOR_ATLAS_RECTS,
  INTERIOR_ATLAS_RECTS,
  MALL_ATLAS_RECTS,
  createDrinksShopMaterials,
  type AtlasRect,
  type DrinksShopMaterialPack,
} from './materials.ts'

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
  doorwayWidthM: number
  interiorAreaSqm: number
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
  readonly doorway: DrinksDoorwayBounds
  readonly interiorBounds: DrinksInteriorBounds
  readonly workstations: readonly DrinksWorkstationZone[]
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
 * 按材质合批静态几何体：将同一材质的多个零件合并为单一 Draw Call。
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
    rotY = 0,
    rotZ = 0,
  ): void {
    this.add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, rotY, rotX, rotZ)
  }

  addAtlasPlane(
    w: number,
    h: number,
    rect: AtlasRect,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    rotY = 0,
    rotX = 0,
  ): void {
    const geo = new THREE.PlaneGeometry(w, h)
    const uv = geo.attributes.uv
    const [px0, py0, px1, py1] = rect
    const u0 = px0
    const u1 = px1
    const v0 = 1 - py1
    const v1 = 1 - py0
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i)
      const v = uv.getY(i)
      uv.setXY(i, u0 + u * (u1 - u0), v0 + v * (v1 - v0))
    }
    uv.needsUpdate = true
    this.add(geo, mat, x, y, z, rotY, rotX, 0)
  }

  addAtlasBox(
    w: number,
    h: number,
    d: number,
    rect: AtlasRect,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    rotY = 0,
  ): void {
    const geo = new THREE.BoxGeometry(w, h, d)
    const uv = geo.attributes.uv
    const [px0, py0, px1, py1] = rect
    const u0 = px0
    const u1 = px1
    const v0 = 1 - py1
    const v1 = 1 - py0
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i)
      const v = uv.getY(i)
      uv.setXY(i, u0 + u * (u1 - u0), v0 + v * (v1 - v0))
    }
    uv.needsUpdate = true
    this.add(geo, mat, x, y, z, rotY, 0, 0)
  }

  flush(parent: THREE.Object3D, mergedGeos: THREE.BufferGeometry[]): void {
    for (const [mat, list] of this.buckets) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false)
      if (list.length > 1) {
        for (const g of list) g.dispose()
      }
      if (merged) {
        mergedGeos.push(merged)
        parent.add(new THREE.Mesh(merged, mat))
      }
    }
    this.buckets.clear()
  }
}

/**
 * 1:1 蜜雪「雪王」3D 雕塑（弯月深色微笑+局部小红舌点缀，绝不做粗厚香肠红嘴）：
 * - mode='standing'：门前阶梯圆台站姿全身雪王 + 金色华夫软雪权杖；
 * - mode='relief'：王城·商厦 2–5F 红框墙面外凸半身浮雕。
 */
function addSnowKingSculpture(
  batch: MaterialBatchCollector,
  mats: DrinksShopMaterialPack,
  x: number,
  yBase: number,
  z: number,
  scale: number,
  rotY: number,
  mode: 'standing' | 'relief',
): void {
  const cos = Math.cos(rotY)
  const sin = Math.sin(rotY)
  const pt = (lx: number, ly: number, lz: number): [number, number, number] => [
    x + (lx * cos + lz * sin) * scale,
    yBase + ly * scale,
    z + (-lx * sin + lz * cos) * scale,
  ]
  const darkMat = mode === 'relief' ? mats.curtainMullionMat : mats.darkEquipmentMat

  if (mode === 'standing') {
    const [b1x, b1y, b1z] = pt(0, 0.1, 0)
    batch.addCyl(0.52 * scale, 0.56 * scale, 0.2 * scale, b1x, b1y, b1z, mats.podiumRedMat, 14)
    const [b2x, b2y, b2z] = pt(0, 0.25, 0)
    batch.addCyl(0.45 * scale, 0.47 * scale, 0.1 * scale, b2x, b2y, b2z, mats.podiumTrimCreamMat, 14)
    for (const fx of [-0.15, 0.15]) {
      const [px, py, pz] = pt(fx, 0.38, 0.08)
      batch.add(new THREE.SphereGeometry(0.11, 8, 6), mats.iceCrownMat, px, py, pz, rotY, 0, 0, scale, 0.75 * scale, 1.25 * scale)
    }
  } else {
    // 王城 2–5F 外立面半身坐姿雪王：红披风贴墙向下展开，胖圆肚皮无缝坐于雨棚顶缘（无悬空圆盘！）
    const [sbx, sby, sbz] = pt(0, 0.16, 0.06)
    batch.addCyl(0.46 * scale, 0.5 * scale, 0.22 * scale, sbx, sby, sbz, mats.podiumRedMat, 12)
  }

  // 圆润雪白躯干 + 红色披风后摆（ref-14/04）
  {
    const [bx, by, bz] = pt(0, mode === 'standing' ? 0.74 : 0.64, mode === 'relief' ? 0.08 : 0)
    batch.add(
      new THREE.SphereGeometry(0.42, 14, 10),
      mats.iceCrownMat,
      bx,
      by,
      bz,
      rotY,
      0,
      0,
      scale,
      1.04 * scale,
      mode === 'relief' ? 0.66 * scale : 0.94 * scale,
    )
    const [cpX, cpY, cpZ] = pt(0, mode === 'standing' ? 0.76 : 0.66, mode === 'relief' ? -0.1 : -0.15)
    batch.add(
      new THREE.CylinderGeometry(0.24, 0.54, 0.68, 12, 1, false, Math.PI * 0.4, Math.PI * 1.2),
      mats.podiumRedMat,
      cpX,
      cpY,
      cpZ,
      rotY,
      0.08,
      0,
      scale,
      scale,
      scale,
    )
    if (mode === 'relief') {
      // 王城半身雪王实拍两侧舒展宽阔的大红披风双翼（外包深暗背托影边 + 浅金饰边，在同色红墙上清晰立体跃出！）
      for (const side of [-1, 1] as const) {
        const [bx, by, bz] = pt(side * 0.48, 0.56, -0.02)
        batch.addBox(0.42 * scale, 0.82 * scale, 0.05 * scale, bx, by, bz, mats.curtainMullionMat, rotY + side * 0.14, 0, -side * 0.26)
        const [wx, wy, wz] = pt(side * 0.47, 0.56, 0.03)
        batch.addBox(0.4 * scale, 0.78 * scale, 0.11 * scale, wx, wy, wz, mats.podiumRedMat, rotY + side * 0.14, 0, -side * 0.26)
        const [gx, gy, gz] = pt(side * 0.36, 0.56, 0.09)
        batch.addBox(0.055 * scale, 0.72 * scale, 0.04 * scale, gx, gy, gz, mats.goldAccentMat, rotY + side * 0.14, 0, -side * 0.26)
      }
    }
    const [clX, clY, clZ] = pt(0, mode === 'standing' ? 1.07 : 0.96, 0.05)
    batch.addCyl(0.32 * scale, 0.42 * scale, 0.13 * scale, clX, clY, clZ, mats.podiumRedMat, 14)
  }

  // 圆头 + 灵动黑眼 + 橙鼻 + 细深色弯月微笑线（绝非香肠红唇）+ 三齿白冠
  {
    const hyOff = mode === 'standing' ? 1.38 : 1.28
    const hzOff = mode === 'relief' ? 0.1 : 0
    const [hx, hy, hz] = pt(0, hyOff, hzOff)
    batch.add(
      new THREE.SphereGeometry(0.35, 14, 10),
      mats.iceCrownMat,
      hx,
      hy,
      hz,
      rotY,
      0,
      0,
      scale * 1.06,
      scale * 0.98,
      mode === 'relief' ? scale * 0.74 : scale * 0.98,
    )

    const faceZ = hzOff + (mode === 'relief' ? 0.25 : 0.32)
    for (const ex of [-0.115, 0.115]) {
      const [px, py, pz] = pt(ex, hyOff + 0.03, faceZ)
      batch.add(new THREE.SphereGeometry(0.034, 8, 6), darkMat, px, py, pz, 0, 0, 0, scale, scale * 1.15, scale * 0.7)
    }
    // 橙色胡萝卜尖鼻
    const [nx, ny, nz] = pt(0.015, hyOff - 0.035, faceZ + 0.05)
    batch.addCyl(0.006 * scale, 0.036 * scale, 0.14 * scale, nx, ny, nz, mats.chairPatioMat, 8, Math.PI * 0.5, rotY + 0.12)

    // 平滑连续弯月深色微笑弧线（Torus 半弧，绝不碎成黑点）+ 精致小红舌尖点缀
    const [mx, my, mz] = pt(0, hyOff - 0.085, faceZ - 0.01)
    batch.add(
      new THREE.TorusGeometry(0.088, 0.015, 6, 12, Math.PI * 0.72),
      darkMat,
      mx,
      my,
      mz,
      rotY,
      0,
      Math.PI * 1.14,
      scale,
      scale,
      scale * 0.7,
    )
    const [tngX, tngY, tngZ] = pt(0.025, hyOff - 0.165, faceZ - 0.008)
    batch.add(new THREE.SphereGeometry(0.022, 6, 5), mats.podiumRedMat, tngX, tngY, tngZ, 0, 0, 0, scale, scale * 0.85, scale * 0.6)

    // 三齿白皇冠 + 细底圈
    const [crx, cry, crz] = pt(0, hyOff + 0.34, hzOff)
    batch.addCyl(0.19 * scale, 0.16 * scale, 0.12 * scale, crx, cry, crz, mats.iceCrownMat, 10)
    const [grx, gry, grz] = pt(0, hyOff + 0.28, hzOff)
    batch.addCyl(
      0.165 * scale,
      0.165 * scale,
      0.035 * scale,
      grx,
      gry,
      grz,
      mode === 'relief' ? mats.podiumTrimCreamMat : mats.goldAccentMat,
      10,
    )
    for (const [cx, cyTip, rScale] of [
      [-0.12, 0.45, 0.85],
      [0, 0.5, 1.05],
      [0.12, 0.45, 0.85],
    ] as const) {
      const [tx, ty, tz] = pt(cx, hyOff + cyTip, hzOff)
      batch.addCyl(0.016 * scale, 0.046 * rScale * scale, 0.15 * rScale * scale, tx, ty, tz, mats.iceCrownMat, 6)
    }
  }

  // 双臂：站立雪王保留华夫冰淇淋权杖；王城外立面半身雪王严格还原双手张开无甜筒（ref-22/25）
  {
    const armY = mode === 'standing' ? 0.84 : 0.72
    const [lax, lay, laz] = pt(-0.44, armY + 0.06, 0.08)
    batch.add(new THREE.SphereGeometry(0.11, 8, 6), mats.iceCrownMat, lax, lay, laz, rotY, 0, 0, scale * 1.18, scale * 0.88, scale * 0.88)
    const [rax, ray, raz] = pt(0.44, armY + 0.04, 0.12)
    batch.add(new THREE.SphereGeometry(0.11, 8, 6), mats.iceCrownMat, rax, ray, raz, rotY, 0, 0, scale * 1.18, scale * 0.9, scale * 0.9)

    if (mode === 'standing') {
      const sx = 0.48
      const sz = 0.18
      const [stx, sty, stz] = pt(sx, armY + 0.06, sz)
      batch.addCyl(0.024 * scale, 0.024 * scale, 0.94 * scale, stx, sty, stz, mats.podiumTrimCreamMat, 8)
      const [cnx, cny, cnz] = pt(sx, armY + 0.58, sz)
      batch.addCyl(0.105 * scale, 0.012 * scale, 0.24 * scale, cnx, cny, cnz, mats.chairPatioMat, 8)
      const [s1x, s1y, s1z] = pt(sx, armY + 0.73, sz)
      batch.add(new THREE.SphereGeometry(0.11, 10, 8), mats.iceCrownMat, s1x, s1y, s1z, 0, 0, 0, scale, scale * 0.8, scale)
      const [s2x, s2y, s2z] = pt(sx, armY + 0.84, sz)
      batch.add(new THREE.SphereGeometry(0.075, 8, 6), mats.iceCrownMat, s2x, s2y, s2z, 0, 0, 0, scale, scale * 0.9, scale)
    }
  }
}

export function buildDrinksShopMesh(options: DrinksShopBuildOptions = {}): DrinksShopBuildResult {
  const candidate: DrinksCandidateId = options.candidate ?? 'wangcheng_mall'
  const bpProfile = getDrinksBlueprint(candidate)
  const bp = bpProfile.map
  const layout = createDefaultDrinksLayout(options.layout)
  const subLabel = candidate === 'poi_zhengyang208' ? '桂林正阳路店' : '桂林王城旗舰店'
  const mats = createDrinksShopMaterials({ subLabel, ...options.skin })
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

  const W = DRINKS_SHOP_INTERIOR.widthM // 13.20 m
  const halfW = W * 0.5 // 6.60 m
  const zBack = DRINKS_SHOP_INTERIOR.minZ // -6.40 m
  const zFront = DRINKS_SHOP_INTERIOR.maxZ // +2.80 m
  const zDepthIn = DRINKS_SHOP_INTERIOR.depthM // 9.20 m
  const zCenterIn = (zBack + zFront) * 0.5 // -1.80 m
  const H1 = candidate === 'wangcheng_mall' ? bp.floor1_height.valueM : DRINKS_SHOP_INTERIOR.heightM
  const wallT = 0.22

  const doorHalfW = DRINKS_SHOP_DOORWAY.widthM * 0.5 // 1.40 m
  const doorCx = DRINKS_SHOP_DOORWAY.centerX // 0.20 m
  const doorH = candidate === 'wangcheng_mall' ? 2.9 : DRINKS_SHOP_DOORWAY.heightM // 2.90m / 2.75m
  const doorMinX = doorCx - doorHalfW // -1.20 m
  const doorMaxX = doorCx + doorHalfW // +1.60 m

  // ─── 1. 街头石材大板 + 黑黄路缘 + 室内 600×600 防滑地砖 + 红门槛 ───
  baseBatch.addBox(22.0, 0.08, 6.4, 0.4, -0.04, 6.0, mats.sidewalkMat)
  baseBatch.addBox(22.0, 0.14, 0.22, 0.4, 0.02, 9.1, mats.curbStripeMat)
  baseBatch.addBox(W + 0.2, 0.04, zDepthIn + 0.2, 0, 0.0, zCenterIn, mats.floorTileMat)
  baseBatch.addBox(DRINKS_SHOP_DOORWAY.widthM, 0.02, 0.72, doorCx, 0.015, zFront + 0.24, mats.podiumRedMat)

  // ─── 2. 首层四面围合（亮白瓷砖墙 + 红腰线 + 加宽 2.80m 常开双开玻璃正门）───
  baseBatch.addBox(W, H1, wallT, 0, H1 * 0.5, zBack, mats.wallCreamMat)
  baseBatch.addBox(W - 0.3, 0.08, 0.04, 0, 1.15, zBack + wallT * 0.5 + 0.02, mats.podiumRedMat)
  addCol(-halfW, halfW, zBack - 0.15, zBack + 0.15, 'wall:back')

  baseBatch.addBox(wallT, H1, zDepthIn, -halfW, H1 * 0.5, zCenterIn, mats.wallCreamMat)
  baseBatch.addBox(wallT, H1, zDepthIn, halfW, H1 * 0.5, zCenterIn, mats.wallCreamMat)
  baseBatch.addBox(0.04, 0.08, zDepthIn - 0.3, -halfW + wallT * 0.5 + 0.02, 1.15, zCenterIn, mats.podiumRedMat)
  baseBatch.addBox(0.04, 0.08, zDepthIn - 0.3, halfW - wallT * 0.5 - 0.02, 1.15, zCenterIn, mats.podiumRedMat)
  addCol(-halfW - 0.15, -halfW + 0.15, zBack, zFront, 'wall:west')
  addCol(halfW - 0.15, halfW + 0.15, zBack, zFront, 'wall:east')

  const pillarW = candidate === 'wangcheng_mall' ? bp.corner_pillar_width.valueM : 0.56
  const glassRightMax = halfW - (candidate === 'wangcheng_mall' ? pillarW : 0.42)
  const frontGlassTop = candidate === 'wangcheng_mall' ? 3.55 : H1
  const leftGlassW = doorMinX - -halfW
  const leftGlassCx = (-halfW + doorMinX) * 0.5
  baseBatch.addBox(leftGlassW, frontGlassTop - 0.1, 0.06, leftGlassCx, frontGlassTop * 0.5, zFront, mats.curtainGlassMat)
  baseBatch.addBox(leftGlassW, 0.14, 0.14, leftGlassCx, 0.07, zFront, mats.curtainMullionMat)
  baseBatch.addBox(leftGlassW, 0.14, 0.14, leftGlassCx, frontGlassTop - 0.07, zFront, mats.curtainMullionMat)
  addCol(-halfW, doorMinX, zFront - 0.1, zFront + 0.1, 'facade:glass-west')

  const rightGlassW = glassRightMax - doorMaxX
  const rightGlassCx = (doorMaxX + glassRightMax) * 0.5
  baseBatch.addBox(rightGlassW, frontGlassTop - 0.1, 0.06, rightGlassCx, frontGlassTop * 0.5, zFront, mats.curtainGlassMat)
  baseBatch.addBox(rightGlassW, 0.14, 0.14, rightGlassCx, 0.07, zFront, mats.curtainMullionMat)
  baseBatch.addBox(rightGlassW, 0.14, 0.14, rightGlassCx, frontGlassTop - 0.07, zFront, mats.curtainMullionMat)
  addCol(doorMaxX, glassRightMax, zFront - 0.1, zFront + 0.1, 'facade:glass-east')

  const bayW = bp.curtain_bay_width.valueM
  for (let x = -halfW + bayW; x < doorMinX - 0.25; x += bayW) {
    baseBatch.addBox(0.06, frontGlassTop, 0.12, x, frontGlassTop * 0.5, zFront, mats.curtainMullionMat)
  }
  for (let x = doorMaxX + bayW; x < glassRightMax - 0.25; x += bayW) {
    baseBatch.addBox(0.06, frontGlassTop, 0.12, x, frontGlassTop * 0.5, zFront, mats.curtainMullionMat)
  }

  // 2.80m 宽全透玻璃对开正门（95° 外开，竖向 LED 门框灯带 + 干净透明门扇）
  for (const [hx, sign] of [
    [doorMinX - 0.04, -1],
    [doorMaxX + 0.04, 1],
  ] as const) {
    baseBatch.addBox(0.08, doorH, 0.14, hx, doorH * 0.5, zFront, mats.curtainMullionMat)
    baseBatch.addBox(0.03, doorH - 0.1, 0.04, hx - sign * 0.03, doorH * 0.5, zFront + 0.05, mats.ceilingLampMat)
    const leafCenterZ = zFront + 0.62
    const leafX = hx + sign * 0.02
    baseBatch.addBox(0.03, doorH - 0.08, 1.18, leafX, doorH * 0.5, leafCenterZ, mats.curtainGlassMat)
    baseBatch.addBox(0.05, 0.05, 1.2, leafX, 0.06, leafCenterZ, mats.curtainMullionMat)
    baseBatch.addBox(0.05, 0.05, 1.2, leafX, doorH - 0.06, leafCenterZ, mats.curtainMullionMat)
    baseBatch.addBox(0.04, 0.54, 0.03, leafX - sign * 0.05, 1.15, zFront + 1.02, mats.stainlessMat)
  }
  // 门洞上方透明玻璃亮窗
  baseBatch.addBox(doorHalfW * 2, frontGlassTop - doorH - 0.1, 0.06, doorCx, (doorH + frontGlassTop) * 0.5, zFront, mats.curtainGlassMat)
  baseBatch.addBox(doorHalfW * 2, 0.1, 0.14, doorCx, doorH + 0.04, zFront, mats.curtainMullionMat)

  // 1F 天花顶板（cutaway）+ 4 条亮白嵌顶 LED 灯带（前后两区均布，避让吧台跌级吊顶区零共面重叠）
  upperBatch.addBox(W, 0.18, zDepthIn, 0, H1 + 0.09, zCenterIn, mats.roofMat)
  for (const lz of [-5.1, -2.9, 0.9, 2.05]) {
    baseBatch.addBox(9.8, 0.04, 0.16, 0, H1 - 0.02, lz, mats.ceilingLampMat)
  }

  // ─── 3. 候选点位外立面建造 ───
  if (candidate === 'wangcheng_mall') {
    const HRedTop = 14.5 // 1–5F 红色蜜雪盒顶缘（留出 6F–8F 三层高幕墙比例！）
    const upperWallH = 10.2 // 6F–8F 三层（3 × 3.40m）-> 总高 24.70 m
    const totalMallH = HRedTop + upperWallH // 24.70 m

    // 1F 全幅深挑正红发光雨棚（y ∈ [3.55, 4.23]，挑深 1.32m；前立面「蜜雪冰城 桂林王城旗舰店」，底面嵌 8 盏暖白筒灯）
    const canopyW = W - 0.2
    const canopyCx = 0.0
    const canopyD = bp.awning_projection.valueM // 1.32 m
    const canopyH = 0.68
    const canopyY = frontGlassTop + canopyH * 0.5 // 3.89 m
    baseBatch.addBox(canopyW, canopyH, canopyD, canopyCx, canopyY, zFront + canopyD * 0.5 - 0.04, mats.podiumRedMat)
    baseBatch.addBox(canopyW + 0.08, 0.08, canopyD + 0.08, canopyCx, frontGlassTop + canopyH + 0.02, zFront + canopyD * 0.5 - 0.04, mats.podiumTrimCreamMat)
    baseBatch.addAtlasPlane(4.9, 1.05, EXTERIOR_ATLAS_RECTS.entranceHeader, doorCx, canopyY, zFront + canopyD - 0.03, mats.exteriorSignAtlasMat)
    // 雨棚底面 8 盏暖白嵌入式大筒灯 + 门楣内侧洗墙光带（仰视清晰发亮照亮 1F 幕墙与街道，0 新增 draw call）
    for (let i = 0; i < 8; i++) {
      const lx = -halfW + 1.05 + i * 1.58
      const lz = zFront + canopyD * 0.56
      baseBatch.addCyl(0.24, 0.24, 0.025, lx, frontGlassTop - 0.015, lz, mats.curtainMullionMat, 12)
      baseBatch.addCyl(0.19, 0.19, 0.045, lx, frontGlassTop - 0.032, lz, mats.ceilingLampMat, 12)
    }
    baseBatch.addBox(canopyW - 0.6, 0.045, 0.16, canopyCx, frontGlassTop - 0.03, zFront + canopyD - 0.18, mats.ceilingLampMat)

    // 右侧外凸两跨竖排「蜜雪冰城」红柱（1F 保持透明玻璃转角延续，2–5F 红柱含正侧面发光竖字，y ∈ [3.55..14.50]）
    const cornerCx = glassRightMax + pillarW * 0.5 // +5.675 m
    baseBatch.addBox(pillarW, 0.18, 0.42, cornerCx, 0.09, zFront + 0.05, mats.curtainMullionMat)
    baseBatch.addBox(pillarW, frontGlassTop - 0.18, 0.06, cornerCx, 0.18 + (frontGlassTop - 0.18) * 0.5, zFront, mats.curtainGlassMat)
    upperBatch.addBox(pillarW, HRedTop - H1 + 0.35, 0.66, cornerCx, H1 - 0.35 + (HRedTop - H1 + 0.35) * 0.5, zFront + 0.24, mats.podiumRedMat)
    upperBatch.addBox(pillarW + 0.08, 0.16, 0.72, cornerCx, HRedTop + 0.08, zFront + 0.24, mats.podiumTrimCreamMat)
    upperBatch.addAtlasPlane(1.66, 5.2, EXTERIOR_ATLAS_RECTS.verticalPillar, cornerCx, 9.6, zFront + 0.585, mats.exteriorSignAtlasMat)
    upperBatch.addAtlasPlane(1.4, 4.4, EXTERIOR_ATLAS_RECTS.verticalPillar, halfW + 0.2, 9.6, zFront - 0.06, mats.exteriorSignAtlasMat, Math.PI * 0.5)
    addCol(glassRightMax, halfW, zFront - 0.15, zFront + 0.36, 'facade:corner-pillar')

    // 2–5F 主红看板体量（x ∈ [-6.60, +4.75], y ∈ [4.25, 14.50]）
    const fasciaW = W - pillarW // 11.35 m
    const fasciaCx = (-halfW + glassRightMax) * 0.5 // -0.925 m
    const redBoxH = HRedTop - H1 // 10.25 m
    const redMidY = H1 + redBoxH * 0.5 // 9.375 m

    upperBatch.addBox(W, redBoxH, wallT, 0, redMidY, zBack, mats.curtainMullionMat)
    upperBatch.addBox(wallT, redBoxH, zDepthIn, -halfW, redMidY, zCenterIn, mats.curtainMullionMat)
    upperBatch.addBox(wallT, redBoxH, zDepthIn, halfW, redMidY, zCenterIn, mats.curtainMullionMat)
    upperBatch.addBox(fasciaW, redBoxH, 0.34, fasciaCx, redMidY, zFront + 0.1, mats.podiumRedMat)
    upperBatch.addBox(fasciaW + 0.1, 0.22, 0.44, fasciaCx, HRedTop + 0.08, zFront + 0.12, mats.podiumTrimCreamMat)
    upperBatch.addBox(fasciaW + 0.1, 0.18, 0.44, fasciaCx, H1 + 0.06, zFront + 0.12, mats.podiumTrimCreamMat)

    // 实拍白色建筑铝板分缝线条（ref-22 / ref-25）+ 左中大号高亮「蜜雪冰城 + 雪王圆徽标」+ 雪花贴花
    for (const sy of [6.8, 9.35, 11.9]) {
      upperBatch.addBox(fasciaW - 0.2, 0.03, 0.02, fasciaCx, sy, zFront + 0.28, mats.podiumTrimCreamMat)
    }
    for (const sx of [-4.4, -2.05, 0.3, 2.6]) {
      upperBatch.addBox(0.03, redBoxH - 0.4, 0.02, sx, redMidY, zFront + 0.28, mats.podiumTrimCreamMat)
    }
    upperBatch.addAtlasPlane(6.1, 1.38, EXTERIOR_ATLAS_RECTS.mainFascia, -3.25, 9.45, zFront + 0.3, mats.exteriorSignAtlasMat)
    // 墙面白色六瓣小雪花浮雕点缀（0 新增 draw call）
    for (const [fx, fy, fr] of [
      [-5.6, 12.9, 0.42],
      [-1.0, 13.1, 0.36],
      [-5.3, 5.6, 0.34],
      [4.05, 12.6, 0.38],
    ] as const) {
      for (const ang of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
        upperBatch.addBox(fr * 2, 0.055, 0.03, fx, fy, zFront + 0.295, mats.iceCrownMat, 0, 0, ang)
      }
    }
    for (let i = 0; i < 5; i++) {
      const lx = -5.4 + i * 2.45
      upperBatch.addBox(0.06, 0.08, 0.55, lx, HRedTop + 0.16, zFront + 0.44, mats.curtainMullionMat)
      upperBatch.addBox(0.18, 0.1, 0.16, lx, HRedTop + 0.1, zFront + 0.7, mats.curtainMullionMat)
    }

    // 巨型 3D 半身雪王（无甜筒、胖圆肚皮直接坐于雨棚上方红墙下缘 y=4.22m）
    addSnowKingSculpture(upperBatch, mats, 2.05, 4.22, zFront + 0.44, 4.35, -0.06, 'relief')

    const hostMidY = HRedTop + upperWallH * 0.5 // 19.60 m
    upperBatch.addAtlasBox(W + 3.6, upperWallH, zDepthIn + 0.2, MALL_ATLAS_RECTS.curtainPlain, -1.6, hostMidY, zCenterIn, mats.mallFacadeMat)
    upperBatch.addBox(W + 3.7, 0.36, zDepthIn + 0.36, -1.6, totalMallH + 0.18, zCenterIn, mats.curtainMullionMat)
    upperBatch.addAtlasBox(3.6, HRedTop, zDepthIn, MALL_ATLAS_RECTS.curtainPlain, -halfW - 1.8, HRedTop * 0.5, zCenterIn, mats.mallFacadeMat)

    // 东侧 8 格平滑弧形转角玻璃幕墙
    const curveR = 5.0
    const curveCx = halfW
    const curveCz = zFront - curveR // -2.20 m
    const curveSegs = 8
    const curveSpan = Math.PI * 0.46
    upperBatch.add(
      new THREE.CylinderGeometry(curveR - 0.32, curveR - 0.32, totalMallH, 14, 1, false, 0, curveSpan + 0.06),
      mats.roofMat,
      curveCx,
      totalMallH * 0.5,
      curveCz,
    )
    for (let seg = 0; seg < curveSegs; seg++) {
      const t0 = (seg / curveSegs) * curveSpan
      const t1 = ((seg + 1) / curveSegs) * curveSpan
      const tm = (t0 + t1) * 0.5
      const chordW = 2 * curveR * Math.sin((t1 - t0) * 0.5) + 0.08
      const ax = curveCx + Math.sin(tm) * curveR
      const az = curveCz + Math.cos(tm) * curveR
      upperBatch.addAtlasBox(chordW, totalMallH - 0.45, 0.2, MALL_ATLAS_RECTS.curtainPlain, ax, 0.45 + (totalMallH - 0.45) * 0.5, az, mats.mallFacadeMat, tm)
      baseBatch.addBox(chordW, 0.45, 0.28, ax, 0.225, az, mats.sidewalkMat, tm)
      upperBatch.addBox(0.06, totalMallH, 0.16, ax + Math.cos(tm) * chordW * 0.5, totalMallH * 0.5, az - Math.sin(tm) * chordW * 0.5, mats.curtainMullionMat, tm)
      upperBatch.addBox(chordW, 0.34, 0.3, ax, totalMallH + 0.17, az, mats.curtainMullionMat, tm)
      if (seg >= 1 && seg <= 6) {
        upperBatch.addBox(chordW, 0.1, 0.66, ax + Math.sin(tm) * 0.32, 3.55, az + Math.cos(tm) * 0.32, mats.curtainMullionMat, tm)
      }
    }
    const signCenterA = curveSpan * 0.5
    const sxA = curveCx + Math.sin(signCenterA) * (curveR + 0.22)
    const szA = curveCz + Math.cos(signCenterA) * (curveR + 0.22)
    upperBatch.addAtlasPlane(3.8, totalMallH - 0.6, MALL_ATLAS_RECTS.curvedCornerFloors, sxA, 0.45 + (totalMallH - 0.45) * 0.5, szA, mats.mallFacadeMat, signCenterA)

    // 2F 弧角真实 3D 凹陷式雪王展示橱窗（外框黑铝楣 + 暖白底座 + 2 尊 3D 迷你雪王实体 + 外覆真透光幕墙玻璃！）
    const sinC = Math.sin(signCenterA)
    const cosC = Math.cos(signCenterA)
    const txDir = cosC
    const tzDir = -sinC
    const winCx = curveCx + sinC * (curveR + 0.34)
    const winCz = curveCz + cosC * (curveR + 0.34)
    upperBatch.addBox(3.55, 0.14, 0.38, winCx, 4.35, winCz, mats.curtainMullionMat, signCenterA)
    upperBatch.addBox(3.55, 0.14, 0.38, winCx, 6.75, winCz, mats.curtainMullionMat, signCenterA)
    upperBatch.addBox(3.15, 0.16, 0.26, winCx, 4.5, winCz, mats.podiumTrimCreamMat, signCenterA)
    for (const offX of [-0.62, 0.62]) {
      const mx = winCx + txDir * offX
      const mz = winCz + tzDir * offX
      upperBatch.add(new THREE.SphereGeometry(0.32, 10, 8), mats.iceCrownMat, mx, 4.92, mz)
      upperBatch.add(new THREE.SphereGeometry(0.24, 10, 8), mats.iceCrownMat, mx, 5.4, mz)
      upperBatch.addCyl(0.16, 0.22, 0.14, mx, 5.14, mz, mats.podiumRedMat, 8)
    }
    upperBatch.addBox(3.35, 2.25, 0.04, curveCx + sinC * (curveR + 0.52), 5.55, curveCz + cosC * (curveR + 0.52), mats.curtainGlassMat, signCenterA)

    // 东侧突翼（「王城超市 / M 麦当劳」垫深灰底框独立成块，防止贴墙溢白糊字）
    const riserX = halfW + curveR + 0.65
    upperBatch.addAtlasBox(2.4, totalMallH, 3.6, MALL_ATLAS_RECTS.curtainPlain, riserX, totalMallH * 0.5, curveCz - 0.4, mats.mallFacadeMat)
    upperBatch.addBox(2.26, 3.2, 0.14, riserX, 3.8, curveCz + 1.44, mats.curtainMullionMat)
    upperBatch.addAtlasPlane(2.1, 3.05, MALL_ATLAS_RECTS.supermarketRiser, riserX, 3.8, curveCz + 1.525, mats.mallFacadeMat)

    // 屋顶宽幅横排发光大字牌「GD · 王城·商厦」（对齐实拍 #030）
    upperBatch.addBox(6.8, 0.26, 0.28, halfW + 0.6, totalMallH + 0.45, zFront - 0.45, mats.curtainMullionMat, 0.34)
    upperBatch.addBox(6.2, 2.0, 0.28, halfW + 0.6, totalMallH + 1.48, zFront - 0.45, mats.podiumRedMat, 0.34)
    upperBatch.addAtlasPlane(5.9, 1.9, MALL_ATLAS_RECTS.rooftopKingBanner, halfW + 0.65, totalMallH + 1.48, zFront - 0.29, mats.mallFacadeMat, 0.34)
  } else {
    // 候选点位 A (`poi_zhengyang208`)：红白遮阳雨棚高抬至 y=3.38m，彻底高过 2.75m 门洞与 2.98m 遮阳伞！
    const HParapet = bp.parapet_height.valueM // 5.15 m
    const fasciaH = bp.fascia_height.valueM // 1.50 m
    const parapetH = HParapet - H1 // 1.55 m
    baseBatch.addBox(0.42, H1, 0.38, glassRightMax + 0.21, H1 * 0.5, zFront + 0.04, mats.podiumRedMat)
    baseBatch.addBox(0.42, H1, 0.38, -halfW + 0.21, H1 * 0.5, zFront + 0.04, mats.podiumRedMat)
    baseBatch.addAtlasPlane(0.76, 0.56, EXTERIOR_ATLAS_RECTS.columnIconsAndRetro, -halfW + 0.21, 1.85, zFront + 0.25, mats.exteriorSignAtlasMat)
    addCol(glassRightMax, halfW, zFront - 0.15, zFront + 0.25, 'facade:east-stone-pier')

    upperBatch.addBox(W - 0.8, 0.08, 0.68, 0, 3.38, zFront + 0.34, mats.awningStripeMat, 0, 0.16, 0)
    upperBatch.addBox(W - 0.7, 0.08, 0.12, 0, 3.45, zFront + 0.04, mats.curtainMullionMat)

    // 东侧双面竖向「蜜雪冰城」红刀旗（比例匹配 1:3.12）
    baseBatch.addBox(0.68, 2.1, 0.16, halfW + 0.4, 3.25, zFront + 0.06, mats.podiumRedMat)
    baseBatch.addAtlasPlane(0.6, 1.88, EXTERIOR_ATLAS_RECTS.verticalPillar, halfW + 0.4, 3.25, zFront + 0.15, mats.exteriorSignAtlasMat)
    baseBatch.addAtlasPlane(0.6, 1.88, EXTERIOR_ATLAS_RECTS.verticalPillar, halfW + 0.4, 3.25, zFront - 0.03, mats.exteriorSignAtlasMat, Math.PI)

    upperBatch.addBox(W, parapetH, wallT, 0, H1 + parapetH * 0.5, zBack, mats.roofMat)
    upperBatch.addBox(wallT, parapetH, zDepthIn, -halfW, H1 + parapetH * 0.5, zCenterIn, mats.roofMat)
    upperBatch.addBox(wallT, parapetH, zDepthIn, halfW, H1 + parapetH * 0.5, zCenterIn, mats.roofMat)
    upperBatch.addBox(W + 0.22, 0.16, zDepthIn + 0.28, 0, HParapet + 0.06, zCenterIn + 0.04, mats.roofMat)

    // 主门头大灯箱（12.0m x 1.50m / 贴图 6.8m x 1.54m = 4.4:1 与 1.72:0.39 高度对齐零拉伸）
    upperBatch.addBox(W - 0.1, fasciaH, 0.34, 0, H1 + parapetH * 0.5 + 0.04, zFront + 0.08, mats.podiumRedMat)
    upperBatch.addAtlasPlane(6.8, 1.48, EXTERIOR_ATLAS_RECTS.mainFascia, 0, H1 + parapetH * 0.5 + 0.04, zFront + 0.26, mats.exteriorSignAtlasMat)
    upperBatch.addBox(W + 0.16, 0.14, 0.38, 0, HParapet + 0.04, zFront + 0.1, mats.podiumTrimCreamMat)
  }

  // ─── 4. 前厅点单收银与取餐组合吧台 + 上方白色光滑跌级吊顶与「点餐」发光横带 + 高亮菜单大屏 ───
  const frontLen = bp.front_counter_length.valueM // 8.20 m
  const frontH = bp.front_counter_height.valueM // 0.96 m
  const frontD = bp.front_counter_depth.valueM // 0.64 m
  const frontCx = 0.4 // x ∈ [-3.70, +4.50]
  const frontZ = -0.46 // z ∈ [-0.78, -0.14]
  if (candidate === 'wangcheng_mall') {
    // 桂林王城 1F 吧台实拍造型（ref-33）：干净浅灰米白实面板 + 底部正红踢脚线 + 台面下红收边压条 + 居中精致小徽章
    baseBatch.addBox(frontLen, frontH - 0.08, frontD, frontCx, (frontH - 0.08) * 0.5, frontZ, mats.podiumTrimCreamMat)
    baseBatch.addBox(frontLen + 0.08, 0.08, frontD + 0.08, frontCx, frontH - 0.04, frontZ, mats.counterTopMat)
    baseBatch.addBox(frontLen - 0.04, 0.14, 0.03, frontCx, 0.07, frontZ + frontD * 0.5 + 0.01, mats.podiumRedMat)
    baseBatch.addBox(frontLen + 0.02, 0.045, 0.03, frontCx, frontH - 0.105, frontZ + frontD * 0.5 + 0.012, mats.podiumRedMat)
    baseBatch.addAtlasPlane(0.52, 0.52, INTERIOR_ATLAS_RECTS.counterCenterMedallion, frontCx, 0.48, frontZ + frontD * 0.5 + 0.022, mats.interiorSignAtlasMat)
    // 西侧端头红柱队列导流标识（避让所有收银与通行路线）
    baseBatch.addCyl(0.035, 0.035, 0.86, -3.76, 0.43, 0.24, mats.podiumRedMat, 8)
    baseBatch.addCyl(0.11, 0.13, 0.04, -3.76, 0.02, 0.24, mats.stainlessMat, 8)
  } else {
    baseBatch.addBox(frontLen, frontH - 0.08, frontD, frontCx, (frontH - 0.08) * 0.5, frontZ, mats.podiumTrimCreamMat)
    baseBatch.addBox(frontLen + 0.08, 0.08, frontD + 0.08, frontCx, frontH - 0.04, frontZ, mats.counterTopMat)
    for (const ry of [0.04, 0.36, 0.66, 0.86]) {
      baseBatch.addBox(frontLen - 0.06, ry === 0.04 ? 0.06 : 0.03, 0.03, frontCx, ry, frontZ + frontD * 0.5 + 0.01, mats.podiumRedMat)
    }
    baseBatch.addAtlasPlane(0.64, 0.64, INTERIOR_ATLAS_RECTS.counterCenterMedallion, frontCx, 0.5, frontZ + frontD * 0.5 + 0.022, mats.interiorSignAtlasMat)
    baseBatch.addAtlasPlane(2.5, 0.56, INTERIOR_ATLAS_RECTS.counterOrderPlate, frontCx - 2.35, 0.5, frontZ + frontD * 0.5 + 0.022, mats.interiorSignAtlasMat)
    baseBatch.addAtlasPlane(2.5, 0.56, INTERIOR_ATLAS_RECTS.counterCollectPlate, frontCx + 2.35, 0.5, frontZ + frontD * 0.5 + 0.022, mats.interiorSignAtlasMat)
  }
  addCol(frontCx - frontLen * 0.5, frontCx + frontLen * 0.5, frontZ - frontD * 0.5, frontZ + frontD * 0.5, 'counter:front')

  for (const c of layout.cashiers) {
    baseBatch.addBox(0.38, 0.25, 0.05, c.clerkPos.x, frontH + 0.2, frontZ + 0.02, mats.darkEquipmentMat, 0, -0.25)
    baseBatch.addBox(0.15, 0.16, 0.15, c.clerkPos.x + 0.34, frontH + 0.08, frontZ + 0.12, mats.podiumRedMat)
    baseBatch.addBox(0.16, 0.24, 0.06, c.clerkPos.x - 0.36, frontH + 0.12, frontZ + 0.14, mats.podiumTrimCreamMat, 0, -0.18)
  }

  baseBatch.addBox(3.25, 0.03, 0.42, 2.7, frontH + 0.015, frontZ + 0.04, mats.stainlessMat)
  baseBatch.addBox(3.25, 0.22, 0.02, 2.7, frontH + 0.11, frontZ + 0.25, mats.curtainGlassMat)
  baseBatch.addBox(0.24, 0.22, 0.24, 4.18, frontH + 0.11, frontZ + 0.05, mats.podiumRedMat)
  for (const slot of layout.pickupSlots) {
    baseBatch.addCyl(0.05, 0.036, 0.19, slot.x, frontH + 0.12, frontZ + 0.04, mats.podiumRedMat, 8)
    baseBatch.addCyl(0.054, 0.054, 0.03, slot.x, frontH + 0.22, frontZ + 0.04, mats.podiumTrimCreamMat, 8)
  }

  if (candidate === 'wangcheng_mall') {
    // 桂林王城 1F 上方光滑白色跌级吊顶围挡 + 正红「点餐 / 取餐」导视横带 + 紧贴嵌入的菜单热销屏与叫号屏（避开顶灯零 z-fighting）
    const soffitW = frontLen + 0.4
    baseBatch.addBox(soffitW, 0.66, 0.88, frontCx, H1 - 0.39, frontZ - 0.08, mats.podiumTrimCreamMat)
    baseBatch.addBox(soffitW - 0.1, 0.42, 0.06, frontCx, H1 - 0.42, frontZ + 0.39, mats.podiumRedMat)
    baseBatch.addAtlasPlane(2.15, 0.42, INTERIOR_ATLAS_RECTS.counterOrderPlate, -1.55, H1 - 0.42, frontZ + 0.43, mats.interiorSignAtlasMat)
    baseBatch.addAtlasPlane(2.15, 0.42, INTERIOR_ATLAS_RECTS.counterCollectPlate, 2.55, H1 - 0.42, frontZ + 0.43, mats.interiorSignAtlasMat)

    // 跌级下方嵌入式高亮度电子菜单大屏 + 取餐叫号屏（无黑吊杆！画面洁白锐利高亮）
    baseBatch.addBox(5.1, 1.0, 0.14, -1.25, 2.98, frontZ - 0.04, mats.podiumTrimCreamMat)
    baseBatch.addAtlasPlane(2.44, 0.92, INTERIOR_ATLAS_RECTS.menuPanelLeft, -2.5, 2.98, frontZ + 0.04, mats.interiorSignAtlasMat)
    baseBatch.addAtlasPlane(2.44, 0.92, INTERIOR_ATLAS_RECTS.menuPanelRight, 0.0, 2.98, frontZ + 0.04, mats.interiorSignAtlasMat)

    baseBatch.addBox(2.96, 0.88, 0.14, 2.88, 2.98, frontZ - 0.04, mats.podiumTrimCreamMat)
    baseBatch.addAtlasPlane(2.8, 0.8, INTERIOR_ATLAS_RECTS.callScreen, 2.88, 2.98, frontZ + 0.04, mats.interiorSignAtlasMat)
  } else {
    // 正阳店标准吊挂四联灯箱 + 胶囊导视牌
    baseBatch.addBox(5.1, 0.98, 0.16, -1.25, 2.86, frontZ - 0.04, mats.darkEquipmentMat)
    baseBatch.addAtlasPlane(2.42, 0.9, INTERIOR_ATLAS_RECTS.menuPanelLeft, -2.5, 2.86, frontZ + 0.05, mats.interiorSignAtlasMat)
    baseBatch.addAtlasPlane(2.42, 0.9, INTERIOR_ATLAS_RECTS.menuPanelRight, 0.0, 2.86, frontZ + 0.05, mats.interiorSignAtlasMat)

    baseBatch.addBox(2.96, 0.86, 0.16, 2.88, 2.86, frontZ - 0.04, mats.darkEquipmentMat)
    baseBatch.addAtlasPlane(2.8, 0.78, INTERIOR_ATLAS_RECTS.callScreen, 2.88, 2.86, frontZ + 0.05, mats.interiorSignAtlasMat)

    baseBatch.addBox(1.48, 0.42, 0.06, -1.45, 2.16, frontZ + 0.12, mats.darkEquipmentMat)
    baseBatch.addAtlasPlane(1.42, 0.36, INTERIOR_ATLAS_RECTS.hangingOrder, -1.45, 2.16, frontZ + 0.16, mats.interiorSignAtlasMat)
    baseBatch.addBox(1.48, 0.42, 0.06, 2.88, 2.16, frontZ + 0.12, mats.darkEquipmentMat)
    baseBatch.addAtlasPlane(1.42, 0.36, INTERIOR_ATLAS_RECTS.hangingCollect, 2.88, 2.16, frontZ + 0.16, mats.interiorSignAtlasMat)
    for (const sx of [-3.3, -1.2, 0.95, 2.0, 3.8]) {
      baseBatch.addBox(0.04, 0.36, 0.04, sx, 3.42, frontZ - 0.02, mats.curtainMullionMat)
    }

    // 入口左侧 A 字点单热销立牌（正阳店沿街摆牌）
    baseBatch.addBox(0.84, 0.88, 0.1, -2.05, 0.44, zFront + 0.34, mats.podiumRedMat, 0.12)
    baseBatch.addAtlasPlane(0.78, 0.56, EXTERIOR_ATLAS_RECTS.aFramePoster, -2.04, 0.52, zFront + 0.4, mats.exteriorSignAtlasMat, 0.12)
    addCol(-2.48, -1.62, zFront + 0.12, zFront + 0.56, 'decor:menu-aframe')
  }

  // ─── 5. 放大员工操作区：中央三区水吧岛台 + 后场 1.8m 双向走廊 + 后墙洗消冷柜货架 ───
  const prepLen = bp.prep_bar_length.valueM // 8.20 m
  const prepH = bp.prep_bar_height.valueM // 0.88 m
  const prepD = bp.prep_bar_depth.valueM // 0.80 m
  const prepCx = 0.3
  const prepZ = DRINKS_STAFF_OPERATION_ZONE.prepIslandZ // -3.22 m
  baseBatch.addBox(prepLen, prepH, prepD, prepCx, prepH * 0.5, prepZ, mats.stainlessMat)
  baseBatch.addBox(prepLen + 0.06, 0.05, prepD + 0.06, prepCx, prepH + 0.025, prepZ, mats.counterTopMat)
  baseBatch.addBox(prepLen, 0.18, 0.04, prepCx, prepH + 0.11, prepZ - prepD * 0.5 + 0.02, mats.stainlessMat)
  addCol(prepCx - prepLen * 0.5, prepCx + prepLen * 0.5, prepZ - prepD * 0.5, prepZ + prepD * 0.5, 'counter:prep-island')

  for (const st of layout.prepStations) {
    if (st.kind === 'lemon_ice') {
      baseBatch.addBox(0.76, 0.72, 0.54, st.x - 0.14, prepH + 0.41, prepZ, mats.stainlessMat)
      baseBatch.addBox(0.58, 0.24, 0.08, st.x - 0.14, prepH + 0.48, prepZ + 0.26, mats.darkEquipmentMat, 0, -0.32)
      baseBatch.addCyl(0.16, 0.14, 0.34, st.x + 0.46, prepH + 0.22, prepZ + 0.06, mats.goldAccentMat, 8)
      baseBatch.addCyl(0.06, 0.055, 0.48, st.x + 0.82, prepH + 0.29, prepZ, mats.podiumRedMat, 8)
    } else if (st.kind === 'tea_shake') {
      for (const tx of [st.x - 0.34, st.x + 0.04]) {
        baseBatch.addCyl(0.145, 0.145, 0.48, tx, prepH + 0.29, prepZ - 0.04, mats.stainlessMat, 10)
        baseBatch.addCyl(0.15, 0.15, 0.06, tx, prepH + 0.54, prepZ - 0.04, mats.podiumRedMat, 10)
        baseBatch.addCyl(0.152, 0.152, 0.04, tx, prepH + 0.58, prepZ - 0.04, mats.darkEquipmentMat, 10)
        baseBatch.addBox(0.04, 0.05, 0.1, tx, prepH + 0.18, prepZ + 0.14, mats.darkEquipmentMat)
      }
      baseBatch.addBox(0.36, 0.48, 0.34, st.x + 0.48, prepH + 0.29, prepZ, mats.podiumRedMat)
      baseBatch.addBox(0.24, 0.22, 0.28, st.x + 0.48, prepH + 0.22, prepZ + 0.06, mats.darkEquipmentMat)
      for (const bx of [st.x - 0.58, st.x + 0.26]) {
        baseBatch.addCyl(0.04, 0.04, 0.24, bx, prepH + 0.17, prepZ + 0.2, mats.goldAccentMat, 6)
      }
    } else {
      baseBatch.addBox(0.62, 0.88, 0.56, st.x, prepH + 0.49, prepZ, mats.stainlessMat)
      baseBatch.addBox(0.56, 0.26, 0.04, st.x, prepH + 0.76, prepZ + 0.28, mats.podiumRedMat)
      for (const nx of [-0.15, 0, 0.15]) {
        baseBatch.addCyl(0.016, 0.012, 0.18, st.x + nx, prepH + 0.54, prepZ + 0.33, mats.stainlessMat, 6)
        baseBatch.addCyl(0.03, 0.018, 0.1, st.x + nx, prepH + 0.43, prepZ + 0.32, mats.darkEquipmentMat, 6)
      }
      baseBatch.addBox(0.48, 0.04, 0.14, st.x, prepH + 0.28, prepZ + 0.3, mats.stainlessMat)
      baseBatch.addCyl(0.17, 0.17, 0.26, st.x + 0.56, prepH + 0.18, prepZ, mats.darkEquipmentMat, 10)
      baseBatch.addCyl(0.16, 0.16, 0.04, st.x + 0.56, prepH + 0.32, prepZ, mats.stainlessMat, 10)
    }
  }

  // 后场扩展区（z ∈ [-6.28, -5.54]）：双槽洗消台 + 开水器 + 双门立式大冷柜 + 大号清晰分区灯箱
  const rearZ = DRINKS_STAFF_OPERATION_ZONE.rearCounterZ // -5.90 m
  baseBatch.addBox(6.4, 0.86, 0.72, -0.4, 0.43, rearZ, mats.stainlessMat)
  baseBatch.addBox(6.44, 0.05, 0.76, -0.4, 0.885, rearZ, mats.counterTopMat)
  baseBatch.addBox(1.1, 0.04, 0.48, -2.2, 0.915, rearZ, mats.darkEquipmentMat)
  baseBatch.addCyl(0.022, 0.022, 0.38, -2.2, 1.1, rearZ - 0.24, mats.stainlessMat, 8)
  baseBatch.addBox(0.56, 0.74, 0.3, -0.3, 1.56, zBack + 0.26, mats.podiumTrimCreamMat)
  baseBatch.addBox(0.52, 0.2, 0.32, -0.3, 1.85, zBack + 0.27, mats.darkEquipmentMat)
  baseBatch.addBox(0.86, 0.08, 0.52, 1.4, 0.94, rearZ, mats.darkEquipmentMat)
  baseBatch.addCyl(0.18, 0.18, 0.26, 1.4, 1.1, rearZ, mats.stainlessMat, 10)
  baseBatch.addBox(4.4, 0.05, 0.36, 0.4, 2.02, zBack + 0.3, mats.stainlessMat)
  addCol(-3.65, 2.85, rearZ - 0.4, rearZ + 0.4, 'back-kitchen:wash-and-cook')

  // 右侧双门立式不锈钢大冷柜（x ∈ [+3.30, +5.30]）
  baseBatch.addBox(1.96, 2.08, 0.82, 4.3, 1.04, rearZ, mats.stainlessMat)
  baseBatch.addBox(0.04, 1.68, 0.04, 4.3, 1.12, rearZ + 0.42, mats.darkEquipmentMat)
  for (const hx of [4.16, 4.44]) {
    baseBatch.addBox(0.04, 0.44, 0.05, hx, 1.16, rearZ + 0.43, mats.darkEquipmentMat)
  }
  addCol(3.28, 5.32, rearZ - 0.44, rearZ + 0.44, 'back-kitchen:double-freezer')

  // 后墙三区高清大灯箱牌（2.8m × 0.72m = 3.89:1，完美匹配贴图比且字体放大一倍！）
  for (const [zx, rect] of [
    [-3.1, INTERIOR_ATLAS_RECTS.zoneFruit],
    [0.0, INTERIOR_ATLAS_RECTS.zoneTea],
    [3.1, INTERIOR_ATLAS_RECTS.zoneCream],
  ] as const) {
    baseBatch.addBox(2.9, 0.78, 0.08, zx, 2.86, zBack + 0.16, mats.darkEquipmentMat)
    baseBatch.addAtlasPlane(2.78, 0.7, rect, zx, 2.86, zBack + 0.21, mats.interiorSignAtlasMat)
  }

  // 室内西侧浅框规范公示与东侧「始于1997」装饰框（避开左侧落地玻璃透视，改为轻盈白框防遮挡感）
  baseBatch.addBox(0.04, 0.6, 3.16, -halfW + 0.15, 2.15, 0.25, mats.podiumTrimCreamMat)
  baseBatch.addAtlasPlane(3.08, 0.54, INTERIOR_ATLAS_RECTS.wallSloganAndLicense, -halfW + 0.19, 2.15, 0.25, mats.interiorSignAtlasMat, Math.PI * 0.5)
  baseBatch.addBox(0.06, 0.74, 1.02, halfW - 0.16, 2.05, -2.1, mats.podiumRedMat)
  baseBatch.addAtlasPlane(0.94, 0.64, EXTERIOR_ATLAS_RECTS.columnIconsAndRetro, halfW - 0.2, 2.05, -2.1, mats.exteriorSignAtlasMat, -Math.PI * 0.5)

  // 西后场开放式 4 层不锈钢线框仓储货架 + 分格原料箱（通透分层货架，绝非实心灰盒！x ∈ [-6.32, -5.28], z ∈ [-6.10, -4.10]）
  const rackX = -5.82
  const rackZ = -5.12
  for (const px of [rackX - 0.42, rackX + 0.42]) {
    for (const pz of [rackZ - 0.85, rackZ + 0.85]) {
      baseBatch.addBox(0.05, 1.92, 0.05, px, 0.96, pz, mats.curtainMullionMat)
    }
  }
  for (const sy of [0.22, 0.72, 1.24, 1.76]) {
    baseBatch.addBox(0.9, 0.04, 1.78, rackX, sy, rackZ, mats.stainlessMat)
  }
  baseBatch.addBox(0.66, 0.36, 0.62, rackX, 0.42, rackZ - 0.42, mats.crateMat)
  baseBatch.addBox(0.66, 0.36, 0.62, rackX, 0.42, rackZ + 0.38, mats.podiumRedMat)
  baseBatch.addBox(0.64, 0.34, 0.58, rackX, 0.91, rackZ - 0.36, mats.podiumTrimCreamMat)
  baseBatch.addBox(0.64, 0.34, 0.58, rackX, 0.91, rackZ + 0.4, mats.crateMat)
  baseBatch.addBox(0.64, 0.36, 0.64, rackX, 1.44, rackZ, mats.podiumRedMat)
  addCol(-6.35, -5.28, -6.1, -4.05, 'storage:west-rack')

  // ─── 6. 室内蜜雪红卡座 + 暖木客席桌椅 + 外摆伞桌 + 门前站立 3D 雪王雕像 ───
  const seatH = bp.dining_seat_height.valueM // 0.44 m

  baseBatch.addBox(0.56, 0.44, 1.9, -6.14, 0.22, 0.98, mats.podiumRedMat)
  baseBatch.addBox(0.14, 0.86, 1.9, -6.36, 0.43, 0.98, mats.podiumRedMat)
  addCol(-6.45, -5.82, 0.02, 1.94, 'seating:west-booth')

  for (const seat of layout.seats) {
    // 王城旗舰门前实拍无高伞外摆胶椅压挤门面，仅保留室内客座与紧凑外区长凳块（不遮挡视线）
    if (candidate === 'wangcheng_mall' && seat.zone === 'patio') continue
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
    baseBatch.addCyl(0.038, 0.026, 0.14, tx + w * 0.16, 0.83, tz, mats.podiumRedMat, 8)
    baseBatch.addCyl(0.038, 0.026, 0.14, tx - w * 0.16, 0.83, tz + d * 0.08, mats.podiumTrimCreamMat, 8)
    addCol(tx - w * 0.5, tx + w * 0.5, tz - d * 0.5, tz + d * 0.5, `table:${tx.toFixed(1)},${tz.toFixed(1)}`)
    if (parasol) {
      baseBatch.addCyl(0.026, 0.026, 2.38, tx, 1.9, tz, mats.stainlessMat, 8)
      upperBatch.addCyl(0.08, 0.92, 0.32, tx, 2.98, tz, mats.parasolRedMat, 10)
    }
  }
  addCafeTable(-4.05, 0.95, 0.54, 1.32, false)
  addCafeTable(4.22, 0.45, 0.42, 0.42, false)
  addCafeTable(4.22, 1.45, 0.42, 0.42, false)
  addCafeTable(4.22, 2.35, 0.42, 0.42, false)

  if (candidate === 'wangcheng_mall') {
    // 王城店开敞铺装广场，不设遮阳红伞桌；室内东南落地窗旁设红波浪底座立式雪王（面向厅内与来客）+ 明亮醒目的红白弧形旋转楼梯（ref-32/34）
    addSnowKingSculpture(baseBatch, mats, 5.66, 0.0, 1.84, 0.92, -2.05, 'standing')
    addCol(5.12, 6.26, 1.24, 2.4, 'decor:indoor-snow-king-podium')

    // 东侧通往 2F 舒展宽踏步红白弧形旋转楼梯（x ∈ [5.18, 6.42], z ∈ [-2.02, +0.76]，9 级白踏步 + 连续红色弧栏立柱扶手，全视野清晰且零碰撞）
    const stCx = 6.38
    const stCz = -0.62
    baseBatch.addCyl(0.22, 0.24, H1 - 0.08, stCx - 0.2, (H1 - 0.08) * 0.5, stCz, mats.podiumRedMat, 10)
    const stairR = 0.88
    for (let s = 0; s < 9; s++) {
      const ang = Math.PI * 0.68 + s * 0.3
      const sy = 0.22 + s * 0.34
      const sx = stCx + Math.cos(ang) * stairR
      const sz = stCz + Math.sin(ang) * stairR
      // 宽厚奶油白旋转踏步 + 正红斜切侧板与弧栏杆立柱
      baseBatch.addBox(0.76, 0.1, 0.34, sx, sy, sz, mats.podiumTrimCreamMat, -ang)
      baseBatch.addBox(0.78, 0.04, 0.04, sx, sy - 0.04, sz + 0.14, mats.podiumRedMat, -ang)
      const postX = stCx + Math.cos(ang) * (stairR + 0.32)
      const postZ = stCz + Math.sin(ang) * (stairR + 0.32)
      baseBatch.addCyl(0.032, 0.032, 0.72, postX, sy + 0.38, postZ, mats.podiumRedMat, 6)
      baseBatch.addBox(0.06, 0.06, 0.42, postX, sy + 0.75, postZ, mats.podiumRedMat, -ang + 0.15)
    }
    addCol(5.15, 6.45, -2.05, 0.85, 'decor:spiral-stair-2f')

    // 西南落地窗旁双面立式发光巨字热销灯箱竖屏（主面正朝街道与 2.80m 入口）
    const lbX = -5.78
    const lbZ = 2.18
    const lbRot = -0.26
    baseBatch.addBox(0.96, 1.84, 0.14, lbX, 0.92, lbZ, mats.podiumRedMat, lbRot)
    const nx = Math.sin(lbRot) * 0.085
    const nz = Math.cos(lbRot) * 0.085
    baseBatch.addAtlasPlane(0.86, 0.58, EXTERIOR_ATLAS_RECTS.aFramePoster, lbX + nx, 1.4, lbZ + nz, mats.exteriorSignAtlasMat, lbRot)
    baseBatch.addAtlasPlane(0.86, 0.58, EXTERIOR_ATLAS_RECTS.columnIconsAndRetro, lbX + nx, 0.7, lbZ + nz, mats.exteriorSignAtlasMat, lbRot)
    baseBatch.addAtlasPlane(0.86, 0.58, EXTERIOR_ATLAS_RECTS.aFramePoster, lbX - nx, 1.4, lbZ - nz, mats.exteriorSignAtlasMat, lbRot + Math.PI)
    addCol(-6.28, -5.28, 1.82, 2.54, 'decor:indoor-vertical-lightbox')
  } else {
    // 街铺正阳店保留门口外摆红伞桌与门前站立迎宾雪王
    addCafeTable(-3.3, 4.3, 1.36, 0.56, true)
    addCafeTable(3.1, 4.3, 1.3, 0.56, true)
    addSnowKingSculpture(baseBatch, mats, -5.35, 0, 3.34, 1.02, 0.24, 'standing')
    addCol(-5.95, -4.75, 2.8, 3.9, 'decor:snow-king-statue')
  }

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
    doorway: DRINKS_SHOP_DOORWAY,
    interiorBounds: DRINKS_SHOP_INTERIOR,
    workstations: DRINKS_STAFF_WORKSTATIONS,
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
        doorwayWidthM: DRINKS_SHOP_DOORWAY.widthM,
        interiorAreaSqm: DRINKS_SHOP_INTERIOR.areaSqm,
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

export { DRINKS_STAFF_OPERATION_ZONE }
