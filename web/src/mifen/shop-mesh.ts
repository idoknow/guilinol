import * as THREE from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {
  acquireTianyuanMaterials,
  createBowlMaterialSet,
  createConcreteMaterial,
  createCondimentMaterial,
  createCurtainMaterial,
  createIngredientMaterial,
  createStainlessMaterial,
  createTileMaterial,
  createWoodMaterial,
  disposeMifenMaterial,
  releaseTianyuanMaterials,
  type TianyuanMaterialPack,
} from './materials'
import type {CookingBowlLocation, CookingVisualState} from './cooking'
import type {
  AabbCollider,
  MifenBowlOptions,
  ShopCutawayMode,
  ShopLevel,
  ShopSeat,
  ShopZoneRect,
  StationKey,
  TianyuanShopBuildResult,
  TianyuanShopVisualsCtx,
  TianyuanSiteConfig,
  ToppingKey,
} from './types'

/**
 * 田源米粉三多路店 · 整店实景模型。
 *
 * 落位取 docs/tianyuan-mifen-site.json 的 spaciousFootprint：中心 [-1139.2, 156.1, -55.5]，7.0m × 14.5m，
 * facingYaw 2.83616（-Z 前向约定）。局部坐标正门朝 +Z（三多路人行道），+X 朝东侧邻楼（净距约 1m），
 * -X 是西侧小巷与行道树，-Z 是后厨。室内地坪 y = 0.04。
 *
 * 分区（局部 z）：门前外摆 7.25..9.25 / 前厅 0.15..7.1 / 出餐隔墙 0..0.15 / 后厨 -7.01..0。
 * 外形对照实拍：西北角弧形转角玻璃门面、杉木竖条弧形门楣 + 黄色立体字、灰筒瓦披檐、
 * 楼上弧形铁花阳台与第二道瓦檐、奶白老居民楼。扩店只加座位和设备，不改外轮廓。
 */

const SITE_CENTER: [number, number, number] = [-1139.2, 156.1, -55.5]
const SITE_FACING_YAW_NEG_Z = 2.83616
const SITE_ROTATION_Y = SITE_FACING_YAW_NEG_Z - Math.PI
const SIN_R = Math.sin(SITE_ROTATION_Y)
const COS_R = Math.cos(SITE_ROTATION_Y)

function siteLocalToWorld(x: number, y: number, z: number): [number, number, number] {
  const r = (v: number) => Math.round(v * 1000) / 1000
  return [r(SITE_CENTER[0] + x * COS_R + z * SIN_R), r(SITE_CENTER[1] + y), r(SITE_CENTER[2] - x * SIN_R + z * COS_R)]
}

export const TIANYUAN_SITE: TianyuanSiteConfig = {
  shopId: 'shop_sanduo_tianyuan_mifen',
  displayName: '田源米粉（三多路店）',
  realAddress: '广西壮族自治区桂林市秀峰区三多路28号',
  position: SITE_CENTER,
  triggerPos: siteLocalToWorld(1.1, 0, 8.4),
  rotationY: SITE_ROTATION_Y,
  facingYawNegZ: SITE_FACING_YAW_NEG_Z,
  forwardWorld: [SIN_R, 0, COS_R],
  teleportPos: siteLocalToWorld(1.1, 0, 8.9),
  teleportLookAt: siteLocalToWorld(1.1, 1.6, 5.5),
}

// ───────────────────────────── 尺寸（米，局部坐标） ─────────────────────────────

const HX = 3.5
const HZ = 7.25
const IN_X = 3.26
const BACK_IN_Z = -7.01
const GLASS_Z = 7.1
const FLOOR_Y = 0.04
const CEIL_Y = 3.2
const ARC_CX = -1.4
const ARC_CZ = 5.0
const ARC_R = 2.1
const PART_Z0 = 0
const PART_Z1 = 0.15
const FASCIA_O = 0.9
const FASCIA_Y0 = 3.05
const FASCIA_Y1 = 4.2
const WRAP_Z = 3.0
const F2_Y = 4.62
const STOREY = 2.9
const F3_Y = F2_Y + STOREY
const ROOF_Y = F3_Y + STOREY
const DOOR_X0 = 0.3
const DOOR_X1 = 1.9
const KDOOR_X0 = -1.6
const KDOOR_X1 = -0.4
const KDOOR_TOP = 2.2
const PASS_X0 = 0.5
const PASS_X1 = 2.9
const PASS_Y0 = 1.05
const PASS_Y1 = 2.0
const COUNTER_Z0 = 1.25
const COUNTER_Z1 = 1.85
const COUNTER_Y = 1.05
const APRON_Z1 = 9.25
const RANGE_X = 2.86
const RANGE_TOP = 0.82
const POT_R = 0.26

type V2 = [number, number]
type V3 = [number, number, number]
type Pack = TianyuanMaterialPack
type AddCollider = (minX: number, maxX: number, minZ: number, maxZ: number, label: string) => void

export type MifenCookVisualStage = 'idle' | 'boil' | 'meat' | 'broth' | 'done'

export interface TianyuanVisualsAnimationExt {
  /** 真实做粉状态快照（由 index.ts 传入 cooking.getVisualState()） */
  cooking?: CookingVisualState
  /** 调试预览阶段（仅在未传或显式覆盖时使用；优先级 animPreview > ctx.cooking > 原逻辑） */
  cookingStage?: MifenCookVisualStage
  /** 当前步骤连续进度 0..1 */
  stepProgress?: number
  /** 当前工单已切/待铺肉码 */
  activeMeats?: readonly string[]
  /** 持碗阶段 */
  holdingStage?: 'none' | 'boiled' | 'meated' | 'brined'
}

/** 依赖 materials.ts 导出的工厂函数派生的精装材质集（不新建原始材质） */
interface DecorMats {
  cedarLit: THREE.MeshStandardMaterial
  graniteLit: THREE.MeshStandardMaterial
  wainscotTile: THREE.MeshStandardMaterial
  groutSeam: THREE.MeshStandardMaterial
  chromeTrim: THREE.MeshStandardMaterial
  brassGold: THREE.MeshStandardMaterial
  warmLed: THREE.MeshStandardMaterial
  awningCanopy: THREE.MeshStandardMaterial
  pvcCurtain: THREE.MeshStandardMaterial
  linenValance: THREE.MeshStandardMaterial
  ceramicJar: THREE.MeshStandardMaterial
  nightSpill: THREE.MeshStandardMaterial
  porkFat: THREE.MeshStandardMaterial
  meatLean: THREE.MeshStandardMaterial
  eggWhite: THREE.MeshStandardMaterial
  eggYolk: THREE.MeshStandardMaterial
  peanutSkin: THREE.MeshStandardMaterial
  garlicMat: THREE.MeshStandardMaterial
  sourSoupMat: THREE.MeshStandardMaterial
  chiliOilSurface: THREE.MeshStandardMaterial
  waterDrop: THREE.MeshStandardMaterial
  dispose(): void
}

function createDecorMats(M: Pack): DecorMats {
  const created: THREE.MeshStandardMaterial[] = []
  const bm = M.batchMasters
  const tag = (
    name: string,
    colorHex: number,
    target: THREE.MeshStandardMaterial | undefined,
    extra: THREE.MeshStandardMaterialParameters = {},
  ) => {
    const m = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.72,
      metalness: 0.04,
      emissive: colorHex,
      emissiveIntensity: 0.14,
      ...extra,
    })
    m.name = name
    if (target) {
      m.userData.batchTarget = target
      m.userData.batchColor = colorHex
    }
    created.push(m)
    return m
  }
  const cedarLit = tag('tianyuan_facade_cedar_warm', 0xffffff, M.facadeWood, {emissive: 0xffb764, emissiveIntensity: 0})
  cedarLit.userData.tiled = true
  cedarLit.userData.keepOwnTarget = M.facadeWood
  const graniteLit = tag('tianyuan_granite_warm', 0xc8baa4, bm?.vcStone ?? M.granite, {emissive: 0xffc682, emissiveIntensity: 0})
  graniteLit.userData.tiled = true
  graniteLit.userData.surfTex = 'granite'
  graniteLit.userData.glow = [0, 0.16]
  const wainscotTile = tag('tianyuan_wainscot_tile', 0xdccdb3, M.wallTileHall, {emissive: 0xffe4be, emissiveIntensity: 0})
  wainscotTile.userData.tiled = true
  const groutSeam = tag('tianyuan_floor_grout', 0x9b9284, M.floorHall, {roughness: 0.92, emissive: 0xffe4bc, emissiveIntensity: 0})
  groutSeam.userData.tiled = true
  const chromeTrim = tag('tianyuan_chrome_trim', 0xebeef2, bm?.vcMetal ?? M.aluminium, {metalness: 0.28, roughness: 0.24})
  const brassGold = tag('tianyuan_brass_gold_signs', 0xe7c14e, bm?.vcMetal ?? M.aluminium, {metalness: 0.28, roughness: 0.3, emissive: 0xffcd48, emissiveIntensity: 0.15})
  const warmLed = tag('tianyuan_warm_led_signs', 0xfff7e2, bm?.vcEmissive ?? M.ceilingLamp, {emissive: 0xffcc70, emissiveIntensity: 0.72, roughness: 0.28})
  warmLed.userData.glow = [0.72, 1.6]
  brassGold.userData.glow = [0.15, 1.0]
  const awningCanopy = tag('tianyuan_awning_canopy', 0x3b444d, bm?.vcExterior ?? M.doorCurtain, {roughness: 0.78, side: THREE.DoubleSide})
  const pvcCurtain = tag('tianyuan_pvc_curtain', 0xe3f2ef, bm?.vcGlass ?? M.thermalCurtain, {transparent: true, opacity: 0.46, side: THREE.DoubleSide})
  const linenValance = tag('tianyuan_linen_valance', 0xb2362a, bm?.vcPlastic ?? M.doorCurtain, {roughness: 0.85, side: THREE.DoubleSide})
  const ceramicJar = tag('tianyuan_ceramic_jar', 0x7e371f, bm?.vcPlastic ?? M.whitePlastic, {roughness: 0.42})
  const nightSpill = tag('tianyuan_night_spill_signs', 0xffdf9e, undefined, {
    transparent: true,
    opacity: 0,
    depthWrite: false,
    roughness: 1,
    emissive: 0xffc46b,
    emissiveIntensity: 1.0,
  })
  const porkFat = tag('tianyuan_pork_fat', 0xf4e3c6, bm?.vcFood ?? M.noodle, {roughness: 0.45})
  const meatLean = tag('tianyuan_meat_lean', 0x7f3622, bm?.vcFood ?? M.beef, {roughness: 0.52})
  const eggWhite = tag('tianyuan_egg_white', 0xfbf4e4, bm?.vcFood ?? M.noodle, {roughness: 0.28})
  const eggYolk = tag('tianyuan_egg_yolk', 0xf0a522, bm?.vcFood ?? M.braisedEgg, {roughness: 0.42})
  const peanutSkin = tag('tianyuan_peanut_skin', 0xc97336, bm?.vcFood ?? M.youtiao, {roughness: 0.55})
  const garlicMat = tag('tianyuan_garlic_clove', 0xfcf6e3, bm?.vcFood ?? M.noodle, {roughness: 0.34})
  const sourSoupMat = tag('tianyuan_sour_soup', 0xd6502c, bm?.vcFood ?? M.brine, {roughness: 0.22})
  const chiliOilSurface = tag('tianyuan_chili_oil_surface', 0xc83022, bm?.vcFood ?? M.brine, {roughness: 0.18})
  const waterDrop = tag('tianyuan_water_drop', 0xdcf2f7, undefined, {transparent: true, opacity: 0.72, roughness: 0.12, emissive: 0xffffff, emissiveIntensity: 0.2})
  return {
    cedarLit,
    graniteLit,
    wainscotTile,
    groutSeam,
    chromeTrim,
    brassGold,
    warmLed,
    awningCanopy,
    pvcCurtain,
    linenValance,
    ceramicJar,
    nightSpill,
    porkFat,
    meatLean,
    eggWhite,
    eggYolk,
    peanutSkin,
    garlicMat,
    sourSoupMat,
    chiliOilSurface,
    waterDrop,
    dispose() {
      for (const m of created) disposeMifenMaterial(m)
    },
  }
}

// ───────────────────────────── 几何工具 ─────────────────────────────

/** 手工拼面：顶点、法线、以米为单位的 UV */
class Mesher {
  readonly pos: number[] = []
  readonly nor: number[] = []
  readonly uv: number[] = []

  private vert(p: V3, n: V3, t: V2) {
    this.pos.push(p[0], p[1], p[2])
    this.nor.push(n[0], n[1], n[2])
    this.uv.push(t[0], t[1])
  }

  /** 四边形 a-b-c-d，按法线自动决定正面朝向 */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3 | [V3, V3, V3, V3], t: [V2, V2, V2, V2]) {
    const ns = (typeof n[0] === 'number' ? [n, n, n, n] : n) as [V3, V3, V3, V3]
    const e1x = b[0] - a[0]
    const e1y = b[1] - a[1]
    const e1z = b[2] - a[2]
    const e2x = c[0] - a[0]
    const e2y = c[1] - a[1]
    const e2z = c[2] - a[2]
    const fx = e1y * e2z - e1z * e2y
    const fy = e1z * e2x - e1x * e2z
    const fz = e1x * e2y - e1y * e2x
    const sx = ns[0][0] + ns[1][0] + ns[2][0] + ns[3][0]
    const sy = ns[0][1] + ns[1][1] + ns[2][1] + ns[3][1]
    const sz = ns[0][2] + ns[1][2] + ns[2][2] + ns[3][2]
    if (fx * sx + fy * sy + fz * sz >= 0) {
      this.vert(a, ns[0], t[0]), this.vert(b, ns[1], t[1]), this.vert(c, ns[2], t[2])
      this.vert(a, ns[0], t[0]), this.vert(c, ns[2], t[2]), this.vert(d, ns[3], t[3])
    } else {
      this.vert(a, ns[0], t[0]), this.vert(c, ns[2], t[2]), this.vert(b, ns[1], t[1])
      this.vert(a, ns[0], t[0]), this.vert(d, ns[3], t[3]), this.vert(c, ns[2], t[2])
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    return g
  }
}

const isTiled = (mat: THREE.Material) => mat.userData.tiled === true
const KEEP_ATTRS = new Set(['position', 'normal', 'uv', 'color', 'aSurf'])
const BATCH_TMP_COLOR = new THREE.Color()

function scaleUv(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
}

/** 盒子：平铺材质按每个面的真实尺寸给 UV */
function boxGeo(w: number, h: number, d: number, tiled: boolean): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  if (tiled) {
    const uv = g.getAttribute('uv') as THREE.BufferAttribute
    const sizes: V2[] = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ]
    for (let i = 0; i < uv.count; i++) {
      const [su, sv] = sizes[Math.floor(i / 4)]
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
    }
  }
  return g
}

/** 按主材质 + 顶点色/图集 UV 重映射合并静态几何，整店压缩至 <= 25 draw calls */
class Batch {
  private readonly buckets = new Map<THREE.Material, THREE.BufferGeometry[]>()
  private readonly m4 = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly p = new THREE.Vector3()
  private readonly one = new THREE.Vector3(1, 1, 1)
  private readonly overrideTarget: THREE.Material | null
  private readonly atlasTarget: THREE.Material | null

  constructor(overrideTarget: THREE.Material | null = null, atlasTarget: THREE.Material | null = null) {
    this.overrideTarget = overrideTarget
    this.atlasTarget = atlasTarget
  }

  add(mat: THREE.Material, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0): void {
    let g = geo
    if (g.index) {
      const flat = g.toNonIndexed()
      g.dispose()
      g = flat
    }
    for (const name of Object.keys(g.attributes)) if (!KEEP_ATTRS.has(name)) g.deleteAttribute(name)
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    const vCount = g.getAttribute('position').count
    let uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined
    if (!uv) {
      uv = new THREE.Float32BufferAttribute(new Float32Array(vCount * 2), 2)
      g.setAttribute('uv', uv)
    }

    const atlasRect = mat.userData.atlasRect as [number, number, number, number] | undefined
    if (atlasRect) {
      const [u0, v0, u1, v1] = atlasRect
      const du = u1 - u0
      const dv = v1 - v0
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, u0 + THREE.MathUtils.clamp(uv.getX(i), 0, 1) * du, v0 + THREE.MathUtils.clamp(uv.getY(i), 0, 1) * dv)
      }
    }

    const ownTarget: THREE.Material = (mat.userData.batchTarget as THREE.Material | undefined) ?? mat
    let target: THREE.Material = ownTarget
    if (atlasRect && this.atlasTarget) {
      target = this.atlasTarget
    } else if (
      this.overrideTarget &&
      target !== mat &&
      !atlasRect &&
      !(target as THREE.MeshStandardMaterial).transparent &&
      target !== (mat.userData.keepOwnTarget as THREE.Material | undefined)
    ) {
      target = this.overrideTarget
    }

    if ((target as THREE.MeshStandardMaterial).vertexColors) {
      const rawTint = mat.userData.batchColor as number | undefined
      if (rawTint !== undefined) BATCH_TMP_COLOR.setHex(rawTint)
      else if ((mat as THREE.MeshStandardMaterial).color) BATCH_TMP_COLOR.copy((mat as THREE.MeshStandardMaterial).color)
      else BATCH_TMP_COLOR.setRGB(1, 1, 1)
      const cols = new Float32Array(vCount * 3)
      for (let i = 0; i < vCount; i++) {
        cols[i * 3] = BATCH_TMP_COLOR.r
        cols[i * 3 + 1] = BATCH_TMP_COLOR.g
        cols[i * 3 + 2] = BATCH_TMP_COLOR.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    } else if (g.getAttribute('color')) {
      g.deleteAttribute('color')
    }

    // IDOK-305：surface master 按顶点记录贴图层与自发光（见 materials.ts bindSurfaceMaster）
    const surfLayers = target.userData.surfLayers as Record<string, number> | undefined
    if (surfLayers) {
      const key = (mat.userData.surfTex ?? ownTarget.userData.surfTex) as string | undefined
      const layer = key === 'none' ? 3 : key && surfLayers[key] ? surfLayers[key] : 0
      const glow = (mat.userData.glow ?? ownTarget.userData.glow ?? target.userData.glow ?? [0, 0]) as [number, number]
      const surf = new Float32Array(vCount * 3)
      for (let i = 0; i < vCount; i++) {
        surf[i * 3] = layer
        surf[i * 3 + 1] = glow[0]
        surf[i * 3 + 2] = glow[1]
      }
      g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 3))
    }

    g.clearGroups()
    if (x || y || z || ry || rx || rz) {
      this.e.set(rx, ry, rz, 'YXZ')
      this.m4.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e), this.one)
      g.applyMatrix4(this.m4)
    }
    let list = this.buckets.get(target)
    if (!list) this.buckets.set(target, (list = []))
    list.push(g)
  }

  /** 底面在 y0 的盒子 */
  box(mat: THREE.Material, x: number, y0: number, z: number, w: number, h: number, d: number, ry = 0, rx = 0, rz = 0): void {
    this.add(mat, boxGeo(w, h, d, isTiled(mat)), x, y0 + h / 2, z, ry, rx, rz)
  }

  /** 按最小/最大角点放盒子 */
  aabb(mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.box(mat, (x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0)
  }

  cyl(mat: THREE.Material, x: number, y0: number, z: number, rTop: number, rBot: number, h: number, seg = 16, open = false, ry = 0, rx = 0, rz = 0): void {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open)
    if (isTiled(mat)) scaleUv(g, Math.PI * (rTop + rBot), h)
    this.add(mat, g, x, y0 + h / 2, z, ry, rx, rz)
  }

  sphere(mat: THREE.Material, x: number, y: number, z: number, r: number, sx = 1, sy = 1, sz = 1, seg = 10): void {
    const g = new THREE.SphereGeometry(r, seg, Math.max(5, Math.round(seg * 0.7)))
    g.scale(sx, sy, sz)
    this.add(mat, g, x, y, z)
  }

  torus(mat: THREE.Material, x: number, y: number, z: number, r: number, tube: number, seg = 24): void {
    this.add(mat, new THREE.TorusGeometry(r, tube, 6, seg), x, y, z, 0, Math.PI / 2)
  }

  /** 竖直贴面牌：PlaneGeometry 默认朝 +Z，ry 转到目标朝向（+X: π/2，-X: -π/2，-Z: π） */
  sign(mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, ry = 0, u0 = 0, u1 = 1): void {
    const g = new THREE.PlaneGeometry(w, h)
    if (u0 !== 0 || u1 !== 1) {
      const uv = g.getAttribute('uv') as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * (u1 - u0))
    }
    this.add(mat, g, x, y, z, ry)
  }

  mesh(mat: THREE.Material, build: (m: Mesher) => void): void {
    const m = new Mesher()
    build(m)
    if (m.pos.length) this.add(mat, m.geometry())
  }

  /** 水平多边形（点为局部 [x, z]）；up=false 时朝下（天花板） */
  shape(mat: THREE.Material, pts: V2[], y: number, up = true): void {
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, up ? -z : z)))
    const g = new THREE.ShapeGeometry(shape)
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2)
    this.add(mat, g, 0, y, 0)
  }

  flush(parent: THREE.Object3D, prefix: string): void {
    for (const [mat, list] of this.buckets) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false)
      if (list.length > 1) for (const g of list) g.dispose()
      if (!merged) {
        console.warn(`[tianyuan] merge failed: ${prefix}:${mat.name}`)
        continue
      }
      merged.computeBoundingSphere()
      const mesh = new THREE.Mesh(merged, mat)
      mesh.name = `${prefix}:${mat.name}`
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      parent.add(mesh)
    }
    this.buckets.clear()
  }
}

interface PathPt {
  x: number
  z: number
  nx: number
  nz: number
  s: number
}

/**
 * 门面外轮廓：从东端 (xStart, GLASS_Z+o) 沿正面向西，绕弧形转角，再沿西墙向后到 zEnd。
 * o 为相对玻璃线的外扩量，法线朝外。
 */
function outlinePath(o: number, zEnd: number, xStart = HX, arcSeg = 16): PathPt[] {
  const r = ARC_R + o
  const pts: PathPt[] = []
  if (xStart > ARC_CX + 1e-3) pts.push({x: xStart, z: GLASS_Z + o, nx: 0, nz: 1, s: 0})
  for (let i = 0; i <= arcSeg; i++) {
    const phi = (i / arcSeg) * (Math.PI / 2)
    pts.push({x: ARC_CX - r * Math.sin(phi), z: ARC_CZ + r * Math.cos(phi), nx: -Math.sin(phi), nz: Math.cos(phi), s: 0})
  }
  if (zEnd < ARC_CZ - 1e-3) pts.push({x: ARC_CX - r, z: zEnd, nx: -1, nz: 0, s: 0})
  for (let i = 1; i < pts.length; i++) pts[i].s = pts[i - 1].s + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
  return pts
}

function pointAt(pts: PathPt[], s: number): PathPt {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (s <= b.s || i === pts.length - 2) {
      const t = b.s > a.s ? THREE.MathUtils.clamp((s - a.s) / (b.s - a.s), 0, 1) : 0
      const nx = a.nx + (b.nx - a.nx) * t
      const nz = a.nz + (b.nz - a.nz) * t
      const nl = Math.hypot(nx, nz) || 1
      return {x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: nx / nl, nz: nz / nl, s}
    }
  }
  return pts[0]
}

interface StripOpts {
  uScale?: number
  unitV?: boolean
  vOrigin?: number
  inward?: boolean
}

/** 沿路径竖起的立面带 */
function strip(m: Mesher, pts: PathPt[], y0: number, y1: number, o: StripOpts = {}) {
  const us = o.uScale ?? 1
  const sign = o.inward ? -1 : 1
  const vA = o.unitV ? 0 : y0 - (o.vOrigin ?? 0)
  const vB = o.unitV ? 1 : y1 - (o.vOrigin ?? 0)
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i]
    const q = pts[i + 1]
    if (Math.hypot(q.x - p.x, q.z - p.z) < 1e-5) continue
    const np: V3 = [p.nx * sign, 0, p.nz * sign]
    const nq: V3 = [q.nx * sign, 0, q.nz * sign]
    m.quad([p.x, y0, p.z], [q.x, y0, q.z], [q.x, y1, q.z], [p.x, y1, p.z], [np, nq, nq, np], [
      [p.s * us, vA],
      [q.s * us, vA],
      [q.s * us, vB],
      [p.s * us, vB],
    ])
  }
}

/** 两条等点数路径之间的带面（雨棚底、瓦檐、阳台地面） */
function band(m: Mesher, a: PathPt[], ya: number, b: PathPt[], yb: number, up: boolean) {
  for (let i = 0; i < a.length - 1; i++) {
    const A: V3 = [a[i].x, ya, a[i].z]
    const B: V3 = [a[i + 1].x, ya, a[i + 1].z]
    const C: V3 = [b[i + 1].x, yb, b[i + 1].z]
    const D: V3 = [b[i].x, yb, b[i].z]
    if (Math.hypot(B[0] - A[0], B[2] - A[2]) < 1e-5) continue
    const ux = B[0] - A[0]
    const uy = B[1] - A[1]
    const uz = B[2] - A[2]
    const vx = D[0] - A[0]
    const vy = D[1] - A[1]
    const vz = D[2] - A[2]
    let n: V3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
    const l = Math.hypot(n[0], n[1], n[2]) || 1
    n = [n[0] / l, n[1] / l, n[2] / l]
    if (n[1] > 0 !== up) n = [-n[0], -n[1], -n[2]]
    const w = Math.hypot(vx, vy, vz)
    m.quad(A, B, C, D, n, [
      [a[i].s, 0],
      [a[i + 1].s, 0],
      [a[i + 1].s, w],
      [a[i].s, w],
    ])
  }
}

/** 竖直墙面，UV 用绝对坐标让相邻墙砖缝对齐 */
function wall(m: Mesher, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, nx: number, nz: number, vOrigin = 0) {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0)
  const u0 = alongX ? x0 : z0
  const u1 = alongX ? x1 : z1
  m.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], [nx, 0, nz], [
    [u0, y0 - vOrigin],
    [u1, y0 - vOrigin],
    [u1, y1 - vOrigin],
    [u0, y1 - vOrigin],
  ])
}

function flat(m: Mesher, x0: number, z0: number, x1: number, z1: number, y: number, up = true) {
  m.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, up ? 1 : -1, 0], [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ])
}

/** 前厅地面 / 吊顶轮廓（含弧形转角） */
function hallOutline(): V2[] {
  const pts: V2[] = [
    [-IN_X, PART_Z1],
    [IN_X, PART_Z1],
    [IN_X, GLASS_Z],
  ]
  for (const p of outlinePath(0, ARC_CZ, ARC_CX + 0.01)) pts.push([p.x, p.z])
  pts.push([-IN_X, ARC_CZ])
  return pts
}

// ───────────────────────────── 建筑外壳（剖切时隐藏） ─────────────────────────────

function buildShell(E: Batch, M: Pack, D: DecorMats) {
  // 一层外墙：花岗岩勒脚 + 奶白面砖；向下多做 0.6m 盖住地形起伏
  E.mesh(D.graniteLit, m => {
    wall(m, -HX, -HZ, -HX, ARC_CZ, -0.6, 0.9, -1, 0)
    wall(m, HX, -HZ, HX, HZ, -0.6, 0.9, 1, 0)
    wall(m, -HX, -HZ, HX, -HZ, -0.6, 0.9, 0, -1)
  })
  E.mesh(M.residentialWall, m => {
    wall(m, -HX, -HZ, -HX, ARC_CZ, 0.9, F2_Y, -1, 0)
    wall(m, HX, -HZ, HX, HZ, 0.9, F2_Y, 1, 0)
    wall(m, -HX, -HZ, HX, -HZ, 0.9, F2_Y, 0, -1)
  })

  // 杉木竖条弧形门楣（夜间随檐底暖光微亮，不再黑块）+ 顶部木压线条
  const fascia = outlinePath(FASCIA_O, WRAP_Z)
  const glassLine = outlinePath(0, WRAP_Z)
  E.mesh(D.cedarLit, m => {
    strip(m, fascia, FASCIA_Y0, FASCIA_Y1)
    wall(m, HX, GLASS_Z, HX, GLASS_Z + FASCIA_O, FASCIA_Y0, FASCIA_Y1, 1, 0)
    wall(m, -HX - FASCIA_O, WRAP_Z, -HX, WRAP_Z, FASCIA_Y0, FASCIA_Y1, 0, -1)
  })
  E.mesh(M.darkWood, m => {
    strip(m, outlinePath(FASCIA_O + 0.02, WRAP_Z), FASCIA_Y0 - 0.02, FASCIA_Y0 + 0.04)
    strip(m, outlinePath(FASCIA_O + 0.02, WRAP_Z), FASCIA_Y1 - 0.04, FASCIA_Y1 + 0.01)
  })
  E.mesh(M.soffitWood, m => band(m, glassLine, FASCIA_Y0, fascia, FASCIA_Y0, false))
  const soffitMid = outlinePath(FASCIA_O / 2, WRAP_Z)
  const soffitLen = soffitMid[soffitMid.length - 1].s
  for (let s = 0.55; s < soffitLen - 0.25; s += 1.05) {
    const p = pointAt(soffitMid, s)
    E.cyl(D.chromeTrim, p.x, FASCIA_Y0 - 0.016, p.z, 0.088, 0.088, 0.014, 10)
    E.cyl(D.warmLed, p.x, FASCIA_Y0 - 0.02, p.z, 0.064, 0.064, 0.012, 10)
  }

  // 门头立体字「田源米粉」：居中隐形立柱支撑离墙 5cm 呈现真实 3D 悬空厚感，贴合实拍 #01/#02 木条底板，不加遮挡木纹的大灰方块
  const charCenterY = (FASCIA_Y0 + FASCIA_Y1) / 2 + 0.02
  for (let i = 0; i < 4; i++) {
    const p = pointAt(fascia, 6.15 - i * 1.05)
    const ry = Math.atan2(p.nx, p.nz)
    E.box(M.blackMetal, p.x + p.nx * 0.022, charCenterY - 0.045, p.z + p.nz * 0.022, 0.06, 0.09, 0.044, ry)
    E.sign(M.fasciaLetters, p.x + p.nx * 0.055, charCenterY, p.z + p.nz * 0.055, 0.82, 0.82, ry, i / 4, (i + 1) / 4)
  }
  // 右侧「老字号」小深红棕金字木匾（#01 实拍右侧小匾，bottom=centerY-h/2）
  const herCenterY = FASCIA_Y0 + 0.32
  E.box(M.darkWood, 2.75, herCenterY - 0.16, GLASS_Z + FASCIA_O + 0.026, 0.64, 0.32, 0.042)
  E.sign(M.mustEatPlaque, 2.75, herCenterY, GLASS_Z + FASCIA_O + 0.052, 0.56, 0.25)

  // 一道瓦檐 + 抬起筒瓦脊棱（实拍 #01 深蓝灰琉璃瓦檐）
  const eaveOut = outlinePath(1.08, WRAP_Z)
  const eaveIn = outlinePath(0.55, WRAP_Z)
  E.mesh(M.roofTile, m => {
    band(m, eaveOut, FASCIA_Y1, eaveIn, F2_Y, true)
    strip(m, eaveOut, FASCIA_Y1 - 0.08, FASCIA_Y1)
    const eLen = eaveOut[eaveOut.length - 1].s
    for (let s = 0.25; s < eLen; s += 0.55) {
      const po = pointAt(eaveOut, s)
      const pi = pointAt(eaveIn, Math.min(eaveIn[eaveIn.length - 1].s, s * (eaveIn[eaveIn.length - 1].s / eLen)))
      m.quad([po.x - po.nx * 0.03, FASCIA_Y1, po.z - po.nz * 0.03], [po.x + po.nx * 0.03, FASCIA_Y1 + 0.045, po.z + po.nz * 0.03], [pi.x + pi.nx * 0.02, F2_Y + 0.04, pi.z + pi.nz * 0.02], [pi.x - pi.nx * 0.02, F2_Y, pi.z - pi.nz * 0.02], [0, 1, 0], [[0, 0], [0.1, 0], [0.1, 0.6], [0, 0.6]])
    }
  })
  E.mesh(M.slabEdge, m => {
    band(m, fascia, FASCIA_Y1 - 0.08, eaveOut, FASCIA_Y1 - 0.08, false)
    // 封实一道瓦檐东西两端山墙楔形面，避免街面侧仰视透空
    wall(m, HX, GLASS_Z, HX, GLASS_Z + 0.55, FASCIA_Y1, F2_Y, 1, 0)
    m.quad(
      [HX, FASCIA_Y1 - 0.08, GLASS_Z + 0.55],
      [HX, FASCIA_Y1 - 0.08, GLASS_Z + 1.08],
      [HX, FASCIA_Y1, GLASS_Z + 1.08],
      [HX, F2_Y, GLASS_Z + 0.55],
      [1, 0, 0],
      [[0, 0], [0.53, 0], [0.53, 0.08], [0, 0.5]],
    )
    wall(m, -HX - 0.55, WRAP_Z, -HX, WRAP_Z, FASCIA_Y1, F2_Y, 0, -1)
    m.quad(
      [-HX - 0.55, FASCIA_Y1 - 0.08, WRAP_Z],
      [-HX - 1.08, FASCIA_Y1 - 0.08, WRAP_Z],
      [-HX - 1.08, FASCIA_Y1, WRAP_Z],
      [-HX - 0.55, F2_Y, WRAP_Z],
      [0, 0, -1],
      [[0, 0], [0.53, 0], [0.53, 0.08], [0, 0.5]],
    )
  })

  // 正门上方利落铝框深青灰雨棚（镂空龙骨框架 + 纹理篷布，仰视见肋条与质感布面，无死黑遮挡）
  const awX = (DOOR_X0 + 3.25) / 2
  const awW = 3.25 - DOOR_X0
  E.box(M.stainlessDark, awX, 2.72, GLASS_Z + 0.86, awW, 0.036, 0.04)
  E.box(M.stainlessDark, awX, 2.82, GLASS_Z + 0.03, awW, 0.036, 0.04)
  for (const x of [DOOR_X0 + 0.04, 1.25, 2.25, 3.21]) {
    E.box(D.chromeTrim, x, 2.77, GLASS_Z + 0.44, 0.032, 0.028, 0.86, 0, 0.12)
  }
  E.box(D.awningCanopy, awX, 2.785, GLASS_Z + 0.44, awW - 0.04, 0.018, 0.84, 0, 0.12)
  for (const x of [DOOR_X0 + 0.12, 1.75, 3.12]) {
    E.box(M.stainlessDark, x, 2.86, GLASS_Z + 0.34, 0.028, 0.028, 0.72, 0, -0.32)
  }

  // 二楼：弧形阳台（铁花防盗网 + 白色楼板边 + 绿色雨棚隔板实拍 #01）
  const upper = outlinePath(0, -HZ)
  const balcEdge = outlinePath(0.62, WRAP_Z)
  const balcIn = outlinePath(0, WRAP_Z)
  const cornice = outlinePath(0.04, -HZ)
  E.mesh(M.residentialWindows, m => {
    strip(m, upper, F2_Y, F3_Y, {vOrigin: F2_Y})
    strip(m, upper, F3_Y, ROOF_Y, {vOrigin: F3_Y})
    wall(m, HX, -HZ, HX, GLASS_Z, F2_Y, F3_Y, 1, 0, F2_Y)
    wall(m, HX, -HZ, HX, GLASS_Z, F3_Y, ROOF_Y, 1, 0, F3_Y)
    wall(m, -HX, -HZ, HX, -HZ, F2_Y, F3_Y, 0, -1, F2_Y)
    wall(m, -HX, -HZ, HX, -HZ, F3_Y, ROOF_Y, 0, -1, F3_Y)
  })
  E.mesh(M.balconyGrille, m => strip(m, outlinePath(0.6, WRAP_Z), F2_Y + 0.16, F3_Y - 0.06, {vOrigin: F2_Y + 0.16}))
  E.mesh(M.crateGreen, m => strip(m, outlinePath(0.58, WRAP_Z, -0.5, 8), F2_Y + 0.18, F2_Y + 0.92, {inward: true}))
  E.mesh(M.slabEdge, m => {
    strip(m, balcEdge, F2_Y, F2_Y + 0.16)
    band(m, balcIn, F2_Y + 0.16, balcEdge, F2_Y + 0.16, true)
    // 补齐二楼阳台板底面封口（d5：防止街面仰视转角镂空透底）
    band(m, balcIn, F2_Y, balcEdge, F2_Y, false)
    wall(m, HX, GLASS_Z, HX, GLASS_Z + 0.62, F2_Y, F3_Y, 1, 0)
    wall(m, -HX - 0.62, WRAP_Z, -HX, WRAP_Z, F2_Y, F3_Y, 0, -1)
    strip(m, cornice, F3_Y + 0.36, F3_Y + 0.5)
    band(m, upper, F3_Y + 0.36, cornice, F3_Y + 0.36, false)
    wall(m, HX + 0.04, -HZ, HX + 0.04, GLASS_Z, F3_Y + 0.36, F3_Y + 0.5, 1, 0)
  })

  // 二道瓦檐：阳台顶（底板贴齐檐口下缘 F3_Y - 0.13 并封实两端山墙）
  const eave2Out = outlinePath(0.84, WRAP_Z)
  const eave2In = outlinePath(0.18, WRAP_Z)
  E.mesh(M.roofTile, m => {
    band(m, eave2Out, F3_Y - 0.06, eave2In, F3_Y + 0.36, true)
    strip(m, eave2Out, F3_Y - 0.13, F3_Y - 0.06)
  })
  E.mesh(M.slabEdge, m => {
    band(m, balcIn, F3_Y - 0.13, eave2Out, F3_Y - 0.13, false)
    wall(m, HX, GLASS_Z, HX, GLASS_Z + 0.18, F3_Y, F3_Y + 0.36, 1, 0)
    m.quad(
      [HX, F3_Y - 0.13, GLASS_Z + 0.18],
      [HX, F3_Y - 0.13, GLASS_Z + 0.84],
      [HX, F3_Y - 0.06, GLASS_Z + 0.84],
      [HX, F3_Y + 0.36, GLASS_Z + 0.18],
      [1, 0, 0],
      [[0, 0], [0.66, 0], [0.66, 0.07], [0, 0.49]],
    )
    wall(m, -HX - 0.18, WRAP_Z, -HX, WRAP_Z, F3_Y, F3_Y + 0.36, 0, -1)
    m.quad(
      [-HX - 0.18, F3_Y - 0.13, WRAP_Z],
      [-HX - 0.84, F3_Y - 0.13, WRAP_Z],
      [-HX - 0.84, F3_Y - 0.06, WRAP_Z],
      [-HX - 0.18, F3_Y + 0.36, WRAP_Z],
      [0, 0, -1],
      [[0, 0], [0.66, 0], [0.66, 0.07], [0, 0.49]],
    )
  })

  // 女儿墙 + 屋面
  E.mesh(M.slabEdge, m => {
    strip(m, outlinePath(0.02, -HZ), ROOF_Y, ROOF_Y + 0.42)
    wall(m, HX + 0.02, -HZ, HX + 0.02, GLASS_Z, ROOF_Y, ROOF_Y + 0.42, 1, 0)
    wall(m, -HX, -HZ - 0.02, HX, -HZ - 0.02, ROOF_Y, ROOF_Y + 0.42, 0, -1)
  })
  const roof: V2[] = [
    [HX, -HZ],
    [HX, GLASS_Z],
  ]
  for (const p of upper.slice(1)) roof.push([p.x, p.z])
  E.shape(M.roofDeck, roof, ROOF_Y + 0.04)

  // 空调外机：阳台角、三楼正面、西墙（带网罩圆扇口）
  E.box(M.acUnit, 2.55, F2_Y + 1.95, GLASS_Z + 0.42, 0.78, 0.52, 0.28)
  E.cyl(M.blackMetal, 2.4, F2_Y + 2.21, GLASS_Z + 0.57, 0.18, 0.18, 0.02, 10, false, 0, Math.PI / 2)
  E.box(M.acUnit, 0.9, F3_Y + 0.75, GLASS_Z + 0.2, 0.8, 0.55, 0.3)
  E.box(M.acUnit, -HX - 0.17, F3_Y + 0.75, -1.4, 0.3, 0.55, 0.8)
  E.box(M.acUnit, -HX - 0.17, 2.4, -3.2, 0.3, 0.52, 0.78)
  E.box(M.blackMetal, 0.9, F3_Y + 0.75, GLASS_Z + 0.36, 0.5, 0.36, 0.02)
}

// ───────────────────────────── 门面玻璃（常显） ─────────────────────────────

function buildStorefront(S: Batch, M: Pack, D: DecorMats, col: AddCollider) {
  const right: PathPt[] = [
    {x: 3.35, z: GLASS_Z, nx: 0, nz: 1, s: 0},
    {x: DOOR_X1, z: GLASS_Z, nx: 0, nz: 1, s: 3.35 - DOOR_X1},
  ]
  const left = outlinePath(0, ARC_CZ, DOOR_X0)
  S.mesh(M.storefrontGlass, m => {
    strip(m, right, FLOOR_Y + 0.06, 3.0, {uScale: 1 / 1.5, unitV: true})
    strip(m, left, FLOOR_Y + 0.06, 3.0, {uScale: 1 / 1.5, unitV: true})
  })
  const full = outlinePath(0, ARC_CZ, 3.35)
  S.mesh(D.chromeTrim, m => {
    strip(m, full, 3.0, 3.06)
    strip(m, full, 3.0, 3.06, {inward: true})
    strip(m, right, FLOOR_Y, FLOOR_Y + 0.06)
    strip(m, left, FLOOR_Y, FLOOR_Y + 0.06)
  })
  S.mesh(M.woodCladding, m => strip(m, outlinePath(-0.01, ARC_CZ, IN_X), 3.0, CEIL_Y, {inward: true}))

  // 门窗亮黄连续防撞腰线带与竖梃 + 花岗岩门柱（实拍 #02/#05）
  S.box(D.brassGold, (DOOR_X1 + 3.35) / 2, 1.12, GLASS_Z + 0.015, 3.35 - DOOR_X1, 0.075, 0.012)
  S.box(D.brassGold, (-1.4 + DOOR_X0) / 2, 1.12, GLASS_Z + 0.015, DOOR_X0 - (-1.4), 0.075, 0.012)
  S.box(D.chromeTrim, 2.62, FLOOR_Y, GLASS_Z, 0.055, 2.96, 0.085)
  S.box(D.chromeTrim, -0.55, FLOOR_Y, GLASS_Z, 0.055, 2.96, 0.085)
  for (const phi of [Math.PI / 6, Math.PI / 3]) {
    S.box(D.chromeTrim, ARC_CX - ARC_R * Math.sin(phi), FLOOR_Y, ARC_CZ + ARC_R * Math.cos(phi), 0.055, 2.96, 0.085, -phi)
  }
  for (const x of [DOOR_X0, DOOR_X1]) S.box(D.chromeTrim, x, FLOOR_Y, GLASS_Z, 0.075, 2.96, 0.11)
  S.box(D.graniteLit, 3.38, 0, GLASS_Z, 0.24, FASCIA_Y0, 0.34)
  S.box(D.graniteLit, ARC_CX, 0, GLASS_Z - 0.02, 0.36, FASCIA_Y0, 0.36)
  S.box(D.graniteLit, -HX + 0.14, 0, ARC_CZ, 0.32, FASCIA_Y0, 0.36)

  // 门框两侧实拍铁艺暖光玻璃壁灯（实拍 #02/XHS01）
  for (const x of [0.12, 2.08]) {
    S.box(M.blackMetal, x, 2.24, GLASS_Z + 0.08, 0.04, 0.04, 0.16)
    S.box(M.blackMetal, x, 2.34, GLASS_Z + 0.16, 0.15, 0.04, 0.15)
    S.cyl(D.warmLed, x, 2.12, GLASS_Z + 0.16, 0.065, 0.055, 0.22, 8)
    S.box(M.blackMetal, x, 2.1, GLASS_Z + 0.16, 0.12, 0.03, 0.12)
  }

  // 门口上方两台白色室内风幕机（实拍 #05）
  for (const x of [DOOR_X0 + 0.4, DOOR_X1 - 0.4]) {
    S.box(M.acUnit, x, 2.5, GLASS_Z - 0.14, 0.72, 0.2, 0.2)
    S.box(M.blackMetal, x, 2.49, GLASS_Z - 0.14, 0.64, 0.02, 0.1)
  }

  // 双开玻璃门向内敞开
  for (const [hx, dir] of [
    [DOOR_X0 + 0.05, 1],
    [DOOR_X1 - 0.05, -1],
  ] as const) {
    S.box(M.glassClear, hx, FLOOR_Y + 0.05, GLASS_Z - 0.42, 0.02, 2.3, 0.76)
    S.box(D.chromeTrim, hx, FLOOR_Y + 0.02, GLASS_Z - 0.42, 0.045, 0.06, 0.8)
    S.box(D.chromeTrim, hx, FLOOR_Y + 2.33, GLASS_Z - 0.42, 0.045, 0.06, 0.8)
    S.box(D.chromeTrim, hx, FLOOR_Y + 0.02, GLASS_Z - 0.8, 0.045, 2.37, 0.045)
    S.box(M.stainlessDark, hx + dir * 0.03, FLOOR_Y + 0.9, GLASS_Z - 0.7, 0.022, 0.38, 0.025)
  }
  S.box(D.chromeTrim, (DOOR_X0 + DOOR_X1) / 2, 2.4, GLASS_Z, DOOR_X1 - DOOR_X0, 0.065, 0.11)
  S.box(M.glassClear, (DOOR_X0 + DOOR_X1) / 2, 2.46, GLASS_Z, DOOR_X1 - DOOR_X0, 0.54, 0.02)

  // 临街黄底价目灯箱 + 外侧双面侧招小灯箱（实拍门店右侧发光灯箱）
  S.box(M.blackMetal, 2.28, 0.98, GLASS_Z - 0.17, 0.7, 1.04, 0.08)
  S.box(D.warmLed, 2.28, 1.02, GLASS_Z - 0.15, 0.66, 0.96, 0.02)
  S.sign(M.priceLightbox, 2.28, 1.5, GLASS_Z - 0.125, 0.62, 0.78)
  S.sign(M.priceBoard, 2.28, 1.5, GLASS_Z - 0.215, 0.62, 0.78, Math.PI)
  S.box(M.blackMetal, 2.05, FLOOR_Y, GLASS_Z - 0.17, 0.035, 0.96, 0.035)
  S.box(M.blackMetal, 2.51, FLOOR_Y, GLASS_Z - 0.17, 0.035, 0.96, 0.035)

  // 东柱外悬双面竖招灯箱（「三多路 · 卤菜粉」夜市显眼侧招）
  S.box(M.blackMetal, 3.5, 2.45, GLASS_Z + 0.22, 0.28, 0.04, 0.04)
  S.box(M.blackMetal, 3.5, 1.85, GLASS_Z + 0.22, 0.28, 0.04, 0.04)
  S.box(D.warmLed, 3.74, 1.72, GLASS_Z + 0.22, 0.12, 0.92, 0.44)
  S.box(M.blackMetal, 3.74, 1.7, GLASS_Z + 0.22, 0.14, 0.04, 0.46)
  S.box(M.blackMetal, 3.74, 2.62, GLASS_Z + 0.22, 0.14, 0.04, 0.46)
  S.sign(M.priceLightbox, 3.805, 2.18, GLASS_Z + 0.22, 0.4, 0.84, Math.PI / 2)
  S.sign(M.priceLightbox, 3.675, 2.18, GLASS_Z + 0.22, 0.4, 0.84, -Math.PI / 2)

  S.sign(M.streetPlate, 3.38, 2.35, GLASS_Z + 0.175, 0.24, 0.12)
  S.sign(M.stepWarning, 2.98, 0.3, GLASS_Z + 0.015, 0.62, 0.078)

  col(-1.4, DOOR_X0 - 0.05, GLASS_Z - 0.08, GLASS_Z + 0.22, 'glass:front-west')
  col(DOOR_X1 + 0.05, HX, GLASS_Z - 0.08, GLASS_Z + 0.22, 'glass:front-east')
  const seg = 8
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * (Math.PI / 2)
    const a1 = ((i + 1) / seg) * (Math.PI / 2)
    const xs = [ARC_CX - ARC_R * Math.sin(a0), ARC_CX - ARC_R * Math.sin(a1)]
    const zs = [ARC_CZ + ARC_R * Math.cos(a0), ARC_CZ + ARC_R * Math.cos(a1)]
    col(Math.min(...xs) - 0.1, Math.max(...xs) + 0.1, Math.min(...zs) - 0.1, Math.max(...zs) + 0.1, `glass:corner-${i}`)
  }
}

// ───────────────────────────── 天花板与吊顶灯带（剖切时隐藏） ─────────────────────────────

function buildCeiling(C: Batch, M: Pack, D: DecorMats) {
  C.shape(M.ceiling, hallOutline(), CEIL_Y, false)
  C.mesh(M.ceiling, m => flat(m, -IN_X, BACK_IN_Z, IN_X, PART_Z1, CEIL_Y, false))

  // 前厅铝扣板格栅分缝条（消除水泥整板感，对照实拍 #05/#06/#17）
  for (let x = -2.4; x <= 2.4; x += 1.2) {
    C.box(D.chromeTrim, x, CEIL_Y - 0.012, 3.6, 0.03, 0.012, 6.4)
  }
  for (const z of [1.2, 2.8, 4.4, 6.0]) {
    C.box(D.chromeTrim, 0, CEIL_Y - 0.012, z, 6.1, 0.012, 0.03)
  }

  // 前厅四条嵌入式暖白 LED 吊顶长灯带 + 明档/西墙洗墙灯槽
  for (const [x, z, w, d] of [
    [-1.4, 2.4, 0.16, 1.35],
    [-1.4, 5.2, 0.16, 1.35],
    [1.3, 2.4, 0.16, 1.35],
    [1.3, 5.2, 0.16, 1.35],
  ] as const) {
    C.box(D.chromeTrim, x, CEIL_Y - 0.04, z, w + 0.05, 0.04, d + 0.05)
    C.box(D.warmLed, x, CEIL_Y - 0.055, z, w, 0.02, d)
  }
  // 前厅四周柔和暖光灯带（西墙小料上方 + 明档隔墙上方）
  C.box(D.warmLed, -IN_X + 0.12, CEIL_Y - 0.06, 3.4, 0.06, 0.03, 4.8)
  C.box(D.warmLed, IN_X - 0.12, CEIL_Y - 0.06, 3.6, 0.06, 0.03, 5.4)
  C.box(D.warmLed, 0.2, CEIL_Y - 0.06, PART_Z1 + 0.18, 5.8, 0.03, 0.06)

  // 前厅中央嵌入式四面出风吸顶空调（对照实拍 #06）
  C.box(M.acUnit, 0, CEIL_Y - 0.06, 3.85, 0.86, 0.06, 0.86)
  C.box(M.blackMetal, 0, CEIL_Y - 0.068, 3.85, 0.66, 0.02, 0.66)
  C.box(M.acUnit, 0, CEIL_Y - 0.075, 3.85, 0.44, 0.016, 0.44)

  // 圆形筒灯（减少分段保轻量化）
  for (const x of [-1.6, 1.2]) for (const z of [1.0, 3.6, 6.2]) {
    C.cyl(D.chromeTrim, x, CEIL_Y - 0.028, z, 0.16, 0.16, 0.025, 10)
    C.cyl(D.warmLed, x, CEIL_Y - 0.036, z, 0.12, 0.12, 0.014, 10)
  }

  // 后厨 LED 平板灯带 + 排烟风管
  for (const [x, z] of [
    [-1.45, -1.9],
    [-1.45, -4.6],
    [1.25, -1.9],
    [1.25, -4.6],
    [0, -6.3],
  ] as const) {
    C.box(D.chromeTrim, x, CEIL_Y - 0.055, z, 0.18, 0.05, 1.26)
    C.box(D.warmLed, x, CEIL_Y - 0.072, z, 0.12, 0.022, 1.2)
  }
  C.box(M.stainless, 2.95, 2.58, -2.35, 0.36, CEIL_Y - 2.58, 0.48)
}

// ───────────────────────────── 前厅 ─────────────────────────────

interface TableSpec {
  x: number
  z: number
  w: number
  d: number
  seats: {x: number; z: number}[]
}

function stool(B: Batch, mat: THREE.Material, x: number, z: number, y0: number) {
  B.cyl(mat, x, y0 + 0.41, z, 0.16, 0.15, 0.045, 10)
  for (const [dx, dz] of [
    [0.09, 0.09],
    [-0.09, 0.09],
    [0.09, -0.09],
    [-0.09, -0.09],
  ]) {
    B.box(mat, x + dx, y0, z + dz, 0.03, 0.41, 0.03)
  }
  B.box(mat, x, y0 + 0.16, z + 0.09, 0.18, 0.025, 0.02)
  B.box(mat, x, y0 + 0.16, z - 0.09, 0.18, 0.025, 0.02)
}

/** 桌台（加木质围边裙、筷筒+筷子、抽纸盒、双调料罐） */
function table(B: Batch, M: Pack, D: DecorMats, t: TableSpec, top: THREE.Material, y0 = FLOOR_Y) {
  B.box(top, t.x, y0 + 0.71, t.z, t.w, 0.04, t.d)
  B.box(M.darkWood, t.x, y0 + 0.675, t.z, t.w - 0.04, 0.035, t.d - 0.04)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.box(M.blackMetal, t.x + sx * (t.w / 2 - 0.06), y0, t.z + sz * (t.d / 2 - 0.06), 0.04, 0.68, 0.04)
  }
  const ty = y0 + 0.75
  const rx = t.x + t.w / 2 - 0.14
  // 筷筒 + 露头竹筷
  B.cyl(M.darkWood, rx, ty, t.z - 0.06, 0.036, 0.034, 0.135, 8)
  for (let k = -1; k <= 1; k++) {
    B.cyl(M.tableWood, rx + k * 0.011, ty + 0.11, t.z - 0.06 + k * 0.008, 0.004, 0.004, 0.095, 4, false, 0, k * 0.14, -k * 0.1)
  }
  // 纸巾盒（带抽口白纸尖）
  B.box(M.whitePlastic, rx - 0.14, ty, t.z + 0.08, 0.13, 0.075, 0.095)
  B.box(M.blackMetal, rx - 0.14, ty + 0.075, t.z + 0.08, 0.07, 0.004, 0.016)
  B.box(M.whitePlastic, rx - 0.14, ty + 0.076, t.z + 0.08, 0.045, 0.025, 0.008, 0.1, 0.25)
  // 调料罐×2：辣椒油红盖罐 + 酱醋瓶
  B.cyl(D.ceramicJar, rx - 0.02, ty, t.z + 0.12, 0.038, 0.036, 0.085, 8)
  B.cyl(M.stoolRed, rx - 0.02, ty + 0.085, t.z + 0.12, 0.04, 0.04, 0.02, 8)
  B.cyl(M.brine, rx - 0.25, ty, t.z - 0.09, 0.026, 0.028, 0.14, 8)
  B.cyl(M.whitePlastic, rx - 0.25, ty + 0.14, t.z - 0.09, 0.014, 0.02, 0.025, 8)
}

function seatYaw(sx: number, sz: number, tx: number, tz: number) {
  return Math.atan2(tx - sx, tz - sz)
}

function wallFan(B: Batch, M: Pack, D: DecorMats, x: number, y: number, z: number, nx: number) {
  const ry = nx > 0 ? Math.PI / 2 : -Math.PI / 2
  const cx = x + nx * 0.24
  const cy = y + 0.04
  const tilt = 0.18
  // 墙面固定底座 + 悬臂支架（离墙 24cm 净空，确保网罩永不切入墙体产生半月穿模）
  B.box(M.blackMetal, x + nx * 0.025, y - 0.04, z, 0.05, 0.14, 0.09)
  B.box(M.blackMetal, x + nx * 0.11, y + 0.025, z, 0.16, 0.032, 0.032)
  // 同轴电机 + 封闭圆环网罩 + 双十字叶片 + 银色中毂
  B.cyl(M.blackMetal, cx - nx * 0.03, cy - 0.042, z, 0.048, 0.048, 0.084, 10, false, ry, Math.PI / 2 + tilt)
  B.add(M.blackMetal, new THREE.TorusGeometry(0.165, 0.011, 6, 16), cx + nx * 0.045, cy, z, ry, tilt)
  B.add(D.chromeTrim, new THREE.TorusGeometry(0.095, 0.006, 5, 14), cx + nx * 0.048, cy, z, ry, tilt)
  B.add(M.stainlessDark, boxGeo(0.28, 0.034, 0.008, false), cx + nx * 0.046, cy, z, ry, tilt, 0.6)
  B.add(M.stainlessDark, boxGeo(0.28, 0.034, 0.008, false), cx + nx * 0.046, cy, z, ry, tilt, -0.6)
  B.cyl(D.chromeTrim, cx + nx * 0.05, cy - 0.012, z, 0.036, 0.036, 0.024, 10, false, ry, Math.PI / 2 + tilt)
}

/** 具象米粉束：多股交叉盘绕的圆弧 TubeGeometry 米粉条（取代光球半球面团） */
function addNoodleCoil(
  B: Batch,
  mat: THREE.Material,
  cx: number,
  cy: number,
  cz: number,
  rOuter: number,
  rTube: number,
  strands: number,
  segs: number,
  heightAmp = 0.024,
  seedInit = 19,
): void {
  let s = seedInit
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < strands; i++) {
    const a0 = (i / strands) * Math.PI * 2 + rnd() * 0.5
    const rBand = rOuter * (0.38 + 0.54 * ((i % 3) / 2) + rnd() * 0.14)
    const span = Math.PI * (0.95 + rnd() * 0.75)
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 4; k++) {
      const u = k / 4
      const ang = a0 + u * span
      const r = THREE.MathUtils.clamp(rBand + Math.sin(u * Math.PI * 2 + i) * rOuter * 0.24, rOuter * 0.14, rOuter * 0.96)
      const dome = Math.cos((r / rOuter) * (Math.PI * 0.44)) * heightAmp
      const wave = Math.sin(u * Math.PI * 2 + i * 1.1) * rTube * 0.55
      pts.push(new THREE.Vector3(cx + Math.cos(ang) * r, cy + dome + wave, cz + Math.sin(ang) * r))
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    B.add(mat, new THREE.TubeGeometry(curve, segs, rTube, 4, false))
  }
}

/** 分盆造粒：按 condiments[0..6] 真实物理形态填充葱花圈/腌青椒/酸豆角/萝卜丝/泡椒/红油辣碎/酸笋 */
function fillCondimentBowl(
  B: Batch,
  M: Pack,
  D: DecorMats,
  condIdx: number,
  mat: THREE.Material,
  x: number,
  yRim: number,
  z: number,
  scale = 1,
): void {
  let s = 31 + condIdx * 97
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const rSpread = 0.088 * scale
  const yBase = yRim - 0.008 * scale
  // 垫底比盆口低 8mm，绝不与敞口金属盆壁/盆底共面 z-fighting
  B.cyl(mat, x, yBase - 0.012 * scale, z, 0.104 * scale, 0.096 * scale, 0.012 * scale, 8)
  if (condIdx === 0) {
    const ringGeo = new THREE.TorusGeometry(0.012 * scale, 0.0042 * scale, 3, 6)
    for (let k = 0; k < 12; k++) {
      const a = rnd() * Math.PI * 2
      const d = Math.sqrt(rnd()) * rSpread
      const y = yRim + (1 - d / (rSpread + 0.01)) * 0.02 * scale + rnd() * 0.006 * scale
      B.add(mat, ringGeo.clone(), x + Math.cos(a) * d, y, z + Math.sin(a) * d, rnd() * 3, Math.PI / 2 + (rnd() - 0.5) * 1.1, rnd() * 0.6)
    }
    ringGeo.dispose()
  } else if (condIdx === 1) {
    // 招牌腌青椒：高出盆沿的整根尖青椒段 + 青椒圈 + 浅黄椒籽，轮廓清晰分明
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + rnd() * 0.35
      const d = (0.18 + rnd() * 0.56) * rSpread
      const px = x + Math.cos(a) * d
      const pz = z + Math.sin(a) * d
      B.cyl(mat, px, yRim + 0.008 * scale, pz, 0.0042 * scale, 0.013 * scale, 0.058 * scale, 5, false, a + 0.5, 1.18 + (rnd() - 0.5) * 0.25)
    }
    const ringGeo = new THREE.TorusGeometry(0.0105 * scale, 0.0038 * scale, 3, 6)
    for (let k = 0; k < 5; k++) {
      const a = rnd() * Math.PI * 2
      const d = rnd() * rSpread * 0.65
      B.add(mat, ringGeo.clone(), x + Math.cos(a) * d, yRim + 0.022 * scale, z + Math.sin(a) * d, rnd() * 3, Math.PI / 2 + 0.3)
    }
    ringGeo.dispose()
    for (let k = 0; k < 6; k++) {
      const a = rnd() * Math.PI * 2
      const d = rnd() * rSpread * 0.7
      B.sphere(D.eggWhite, x + Math.cos(a) * d, yRim + 0.02 * scale, z + Math.sin(a) * d, 0.003 * scale, 1.2, 0.6, 1, 4)
    }
  } else if (condIdx === 2) {
    // 酸豆角：密集酸黄绿切碎短段叠加堆高 + 红碎椒点缀，区别于翠绿生葱花
    for (let k = 0; k < 20; k++) {
      const a = rnd() * Math.PI * 2
      const d = Math.sqrt(rnd()) * rSpread * 0.9
      const y = yRim + 0.004 * scale + (1 - d / (rSpread + 0.01)) * 0.02 * scale
      B.cyl(mat, x + Math.cos(a) * d, y, z + Math.sin(a) * d, 0.0045 * scale, 0.0045 * scale, 0.016 * scale, 5, false, rnd() * 3, Math.PI / 2 + (rnd() - 0.5) * 0.7)
    }
    const redMat = M.condiments[4] ?? M.charsiu
    for (let k = 0; k < 6; k++) {
      B.box(redMat, x + (rnd() - 0.5) * rSpread * 1.1, yRim + 0.02 * scale, z + (rnd() - 0.5) * rSpread * 1.1, 0.007 * scale, 0.005 * scale, 0.007 * scale, rnd() * 3)
    }
  } else if (condIdx === 3) {
    for (let k = 0; k < 14; k++) {
      const a = rnd() * Math.PI * 2
      const d = Math.sqrt(rnd()) * rSpread * 0.85
      const y = yRim + (1 - d / (rSpread + 0.01)) * 0.02 * scale
      B.box(mat, x + Math.cos(a) * d, y, z + Math.sin(a) * d, 0.0055 * scale, 0.005 * scale, 0.056 * scale, rnd() * Math.PI, (rnd() - 0.5) * 0.35)
    }
  } else if (condIdx === 4) {
    const greenStem = M.condiments[0] ?? mat
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rnd() * 0.3
      const d = (0.18 + rnd() * 0.62) * rSpread
      const px = x + Math.cos(a) * d
      const pz = z + Math.sin(a) * d
      B.cyl(mat, px, yRim + 0.002 * scale, pz, 0.0035 * scale, 0.013 * scale, 0.052 * scale, 4, false, a, 0.95 + (rnd() - 0.5) * 0.3)
      B.box(greenStem, px, yRim + 0.018 * scale, pz, 0.0045 * scale, 0.01 * scale, 0.0045 * scale, a)
    }
  } else if (condIdx === 5) {
    // 亮油反射红油辣椒液面 + 粗辣椒碎 + 金黄烤白芝麻浮层
    B.cyl(D.chiliOilSurface, x, yRim - 0.005 * scale, z, 0.106 * scale, 0.102 * scale, 0.008 * scale, 12)
    const brightChili = M.condiments[4] ?? mat
    for (let k = 0; k < 14; k++) {
      const a = rnd() * Math.PI * 2
      const d = Math.sqrt(rnd()) * rSpread * 0.92
      B.box(brightChili, x + Math.cos(a) * d, yRim + 0.003 * scale, z + Math.sin(a) * d, 0.012 * scale, 0.004 * scale, 0.009 * scale, rnd() * 3)
    }
    for (let k = 0; k < 10; k++) {
      const a = rnd() * Math.PI * 2
      const d = Math.sqrt(rnd()) * rSpread * 0.85
      B.sphere(D.eggYolk, x + Math.cos(a) * d, yRim + 0.005 * scale, z + Math.sin(a) * d, 0.0038 * scale, 1.2, 0.55, 0.8, 4)
    }
  } else {
    for (let k = 0; k < 12; k++) {
      const a = rnd() * Math.PI * 2
      const d = Math.sqrt(rnd()) * rSpread * 0.85
      const y = yRim + (1 - d / (rSpread + 0.01)) * 0.02 * scale
      B.box(mat, x + Math.cos(a) * d, y, z + Math.sin(a) * d, 0.018 * scale, 0.004 * scale, 0.06 * scale, rnd() * Math.PI, (rnd() - 0.5) * 0.35)
    }
  }
}

/** 酥脆炸花生米盆（严格留出盆底防共面，花生饱满高出盆沿） */
function buildPeanutPile(B: Batch, D: DecorMats, x: number, yRim: number, z: number, scale = 1): void {
  let s = 711
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  B.cyl(D.meatLean, x, yRim - 0.018 * scale, z, 0.09 * scale, 0.08 * scale, 0.01 * scale, 8)
  for (let k = 0; k < 12; k++) {
    const a = rnd() * Math.PI * 2
    const d = Math.sqrt(rnd()) * 0.07 * scale
    const y = yRim - 0.002 * scale + (1 - d / (0.08 * scale)) * 0.018 * scale
    B.sphere(D.peanutSkin, x + Math.cos(a) * d, y, z + Math.sin(a) * d, 0.0115 * scale, 1, 0.72, 1.45, 4)
  }
}

/** 敞口不锈钢盆外壳（open=true 环形盆壁+卷边+内缩凹底，彻底根除 z-fighting） */
function openStainlessBowl(B: Batch, M: Pack, x: number, y0: number, z: number, rTop: number, rBot: number, h: number): void {
  B.cyl(M.stainless, x, y0, z, rTop, rBot, h, 10, true)
  B.cyl(M.stainlessDark, x, y0 + 0.004, z, rBot * 0.92, rBot * 0.9, 0.005, 8)
  B.torus(M.stainless, x, y0 + h, z, rTop, 0.0045, 10)
}

function buildHall(I: Batch, M: Pack, D: DecorMats, lv: ShopLevel, col: AddCollider): ShopSeat[] {
  const seats: ShopSeat[] = []

  I.shape(M.floorHall, hallOutline(), FLOOR_Y)
  I.mesh(D.graniteLit, m => flat(m, KDOOR_X0, PART_Z0, KDOOR_X1, PART_Z1, FLOOR_Y + 0.002))
  // 地砖分缝 + 入口/后厨铜门槛压条
  for (const x of [-1.8, 0, 1.8]) {
    I.box(D.groutSeam, x, FLOOR_Y + 0.001, 3.6, 0.022, 0.002, 6.7)
  }
  for (const z of [1.9, 3.6, 5.3]) {
    I.box(D.groutSeam, 0.2, FLOOR_Y + 0.001, z, 5.9, 0.002, 0.022)
  }
  I.box(D.brassGold, (DOOR_X0 + DOOR_X1) / 2, FLOOR_Y + 0.001, GLASS_Z, DOOR_X1 - DOOR_X0, 0.004, 0.08)
  I.box(D.brassGold, (KDOOR_X0 + KDOOR_X1) / 2, FLOOR_Y + 0.001, PART_Z1, KDOOR_X1 - KDOOR_X0, 0.004, 0.08)

  // 两侧墙裙瓷砖（0.04..1.32m 深暖墙裙砖 + 实木腰线 + 米白墙砖 + 顶部杉木条，告别桑拿房感）
  I.mesh(D.wainscotTile, m => {
    wall(m, -IN_X, PART_Z1, -IN_X, ARC_CZ, FLOOR_Y, 1.32, 1, 0)
    wall(m, IN_X, PART_Z1, IN_X, GLASS_Z, FLOOR_Y, 1.32, -1, 0)
  })
  I.mesh(M.darkWood, m => {
    wall(m, -IN_X + 0.02, PART_Z1, -IN_X + 0.02, ARC_CZ, 1.32, 1.38, 1, 0)
    wall(m, IN_X - 0.02, PART_Z1, IN_X - 0.02, GLASS_Z, 1.32, 1.38, -1, 0)
  })
  I.mesh(M.wallTileHall, m => {
    wall(m, -IN_X, PART_Z1, -IN_X, ARC_CZ, 1.38, 2.55, 1, 0)
    wall(m, IN_X, PART_Z1, IN_X, GLASS_Z, 1.38, 2.55, -1, 0)
  })
  I.mesh(M.woodCladding, m => {
    wall(m, -IN_X, PART_Z1, -IN_X, ARC_CZ, 2.55, CEIL_Y, 1, 0)
    wall(m, IN_X, PART_Z1, IN_X, GLASS_Z, 2.55, CEIL_Y, -1, 0)
  })
  I.mesh(D.graniteLit, m => {
    wall(m, -IN_X + 0.014, PART_Z1, -IN_X + 0.014, ARC_CZ, FLOOR_Y, FLOOR_Y + 0.1, 1, 0)
    wall(m, IN_X - 0.014, PART_Z1, IN_X - 0.014, GLASS_Z, FLOOR_Y, FLOOR_Y + 0.1, -1, 0)
  })

  // 出餐隔墙前厅面：下半墙裙瓷砖 + 上半杉木饰面，开后厨门洞与出餐窗（实拍 #06）
  I.mesh(D.wainscotTile, m => {
    const z = PART_Z1
    wall(m, -IN_X, z, KDOOR_X0, z, FLOOR_Y, 1.15, 0, 1)
    wall(m, KDOOR_X1, z, PASS_X0, z, FLOOR_Y, 1.15, 0, 1)
    wall(m, PASS_X0, z, PASS_X1, z, FLOOR_Y, PASS_Y0, 0, 1)
    wall(m, PASS_X1, z, IN_X, z, FLOOR_Y, 1.15, 0, 1)
  })
  I.mesh(M.woodCladding, m => {
    const z = PART_Z1
    wall(m, -IN_X, z, KDOOR_X0, z, 1.15, CEIL_Y, 0, 1)
    wall(m, KDOOR_X0, z, KDOOR_X1, z, KDOOR_TOP, CEIL_Y, 0, 1)
    wall(m, KDOOR_X1, z, PASS_X0, z, 1.15, CEIL_Y, 0, 1)
    wall(m, PASS_X0, z, PASS_X1, z, PASS_Y1, CEIL_Y, 0, 1)
    wall(m, PASS_X1, z, IN_X, z, 1.15, CEIL_Y, 0, 1)
  })
  I.box(M.darkWood, KDOOR_X0 + 0.03, FLOOR_Y, (PART_Z0 + PART_Z1) / 2, 0.06, KDOOR_TOP, 0.19)
  I.box(M.darkWood, KDOOR_X1 - 0.03, FLOOR_Y, (PART_Z0 + PART_Z1) / 2, 0.06, KDOOR_TOP, 0.19)
  I.box(M.darkWood, (KDOOR_X0 + KDOOR_X1) / 2, KDOOR_TOP, (PART_Z0 + PART_Z1) / 2, KDOOR_X1 - KDOOR_X0, 0.06, 0.19)
  // 后厨门洞门帘：用平置方杆避免 cyl 倾斜中心上移，下挂红布短门楣帘 + 5 条半透明 PVC 防油烟条形帘（无碰撞）
  I.box(M.stainlessDark, (KDOOR_X0 + KDOOR_X1) / 2, KDOOR_TOP - 0.05, PART_Z1 + 0.02, KDOOR_X1 - KDOOR_X0 - 0.06, 0.024, 0.024)
  I.box(D.linenValance, (KDOOR_X0 + KDOOR_X1) / 2, KDOOR_TOP - 0.34, PART_Z1 + 0.025, KDOOR_X1 - KDOOR_X0 - 0.08, 0.3, 0.015)
  for (let i = 0; i < 5; i++) {
    const sx = KDOOR_X0 + 0.16 + i * 0.22
    I.box(D.pvcCurtain, sx, FLOOR_Y + 0.22, PART_Z1 + 0.01, 0.21, 1.72, 0.008, 0, (i % 2 ? 0.018 : -0.018))
  }

  I.aabb(M.stainless, PASS_X0, PASS_Y0, -0.25, PASS_X1, PASS_Y0 + 0.03, PART_Z1 + 0.05)
  I.box(M.stainless, PASS_X0 + 0.02, PASS_Y0, (PART_Z0 + PART_Z1) / 2, 0.04, PASS_Y1 - PASS_Y0, 0.17)
  I.box(M.stainless, PASS_X1 - 0.02, PASS_Y0, (PART_Z0 + PART_Z1) / 2, 0.04, PASS_Y1 - PASS_Y0, 0.17)
  I.box(M.stainless, (PASS_X0 + PASS_X1) / 2, PASS_Y1 - 0.04, (PART_Z0 + PART_Z1) / 2, PASS_X1 - PASS_X0, 0.04, 0.17)
  I.sign(M.kitchenDoorSign, (KDOOR_X0 + KDOOR_X1) / 2, 2.48, PART_Z1 + 0.014, 0.88, 0.26)

  // 明档柜台：杉木竖条装饰围裙 + 白石英台面 + 斜坡玻璃展柜（实拍 #06）
  I.aabb(M.woodCladding, 0, FLOOR_Y, COUNTER_Z0 + 0.04, IN_X, COUNTER_Y, COUNTER_Z1)
  for (let x = 0.22; x < IN_X - 0.15; x += 0.36) {
    I.box(M.darkWood, x, FLOOR_Y + 0.06, COUNTER_Z1 + 0.008, 0.025, COUNTER_Y - 0.1, 0.012)
  }
  I.aabb(M.quartzTop, -0.04, COUNTER_Y, COUNTER_Z0 - 0.03, IN_X, COUNTER_Y + 0.05, COUNTER_Z1 + 0.05)
  I.aabb(M.stainless, 0.04, 0.72, PART_Z1 + 0.02, IN_X, 0.75, COUNTER_Z0 + 0.04)
  // 明档不锈钢立柱 + 斜坡玻璃防飞沫展示柜 + 「注意玻璃 防止碰头」
  for (const x of [0.12, 2.12]) for (const z of [COUNTER_Z0 + 0.08, COUNTER_Z1 - 0.04]) I.box(M.stainless, x, COUNTER_Y + 0.05, z, 0.03, 1.1, 0.03)
  I.box(M.glassClear, 1.12, COUNTER_Y + 0.08, COUNTER_Z1 - 0.08, 1.96, 0.52, 0.015, 0, -0.22)
  I.aabb(M.glassClear, 0.12, 1.62, COUNTER_Z0 + 0.06, 2.12, 1.635, COUNTER_Z1 - 0.02)
  I.aabb(M.glassClear, 0.12, 2.13, COUNTER_Z0 + 0.06, 2.12, 2.145, COUNTER_Z1 - 0.02)
  I.aabb(M.stainless, 0.12, 2.145, COUNTER_Z0 + 0.06, 2.12, 2.16, COUNTER_Z1 - 0.02)
  I.sign(M.glassWarning, 1.12, 2.08, COUNTER_Z1 - 0.005, 1.7, 0.1)
  // 台面：敞口小料盆（消除 z-fighting）+ 脆花生碗 + 前台保温老卤盎
  const potIndices = [1, 2, 0, 5]
  potIndices.forEach((ci, i) => {
    const mat = M.condiments[ci]
    if (!mat) return
    const x = 0.28 + i * 0.31
    openStainlessBowl(I, M, x, COUNTER_Y + 0.05, 1.54, 0.125, 0.1, 0.055)
    fillCondimentBowl(I, M, D, ci, mat, x, COUNTER_Y + 0.105, 1.54, 0.85)
  })
  openStainlessBowl(I, M, 1.42, COUNTER_Y + 0.05, 1.54, 0.105, 0.085, 0.055)
  buildPeanutPile(I, D, 1.42, COUNTER_Y + 0.105, 1.54, 0.82)
  // 前台老卤保温盎（x=2.00, z=1.48，配套长勺淋卤动画就在此处）
  I.cyl(M.stainlessDark, 2.0, COUNTER_Y + 0.05, 1.48, 0.15, 0.14, 0.16, 14)
  I.torus(D.chromeTrim, 2.0, COUNTER_Y + 0.21, 1.48, 0.15, 0.009, 14)
  I.cyl(M.brine, 2.0, COUNTER_Y + 0.195, 1.48, 0.14, 0.14, 0.008, 12)
  I.cyl(D.ceramicJar, 0.32, 1.635, 1.42, 0.032, 0.032, 0.14, 8)
  I.cyl(M.stoolRed, 0.44, 1.635, 1.42, 0.032, 0.032, 0.12, 8)
  I.cyl(M.cookingOil, 0.56, 1.635, 1.42, 0.028, 0.028, 0.16, 8)
  for (let i = 0; i < 3; i++) I.cyl(M.whitePlastic, 0.78 + i * 0.44, 1.635, 1.5, 0.095, 0.068, 0.11, 10)
  I.box(M.plantLeaf, 1.9, 1.635, 1.5, 0.3, 0.11, 0.2)
  // 收银台：收银机、扫码牌、三色粉票、夹板、保温茶水壶
  I.box(M.blackMetal, 2.9, COUNTER_Y + 0.05, 1.5, 0.36, 0.1, 0.3)
  I.box(M.blackMetal, 2.9, COUNTER_Y + 0.15, 1.42, 0.3, 0.2, 0.03, 0, -0.35)
  I.box(M.whitePlastic, 2.45, COUNTER_Y + 0.05, 1.72, 0.12, 0.18, 0.02)
  ;[M.ticketPink, M.ticketBlue, M.ticketWhite].forEach((mat, i) => I.box(mat, 2.32 + i * 0.13, COUNTER_Y + 0.05, 1.5, 0.1, 0.025 + i * 0.006, 0.15))
  I.box(M.clipboard, 2.62, COUNTER_Y + 0.05, 1.62, 0.16, 0.012, 0.23, 0.2)
  I.sign(M.cashierSign, 2.75, 2.62, COUNTER_Z0 + 0.3, 0.6, 0.22)
  I.sign(M.cashierSign, 2.75, 2.62, COUNTER_Z0 + 0.29, 0.6, 0.22, Math.PI)
  for (const x of [2.5, 3.0]) I.cyl(M.blackMetal, x, 2.73, COUNTER_Z0 + 0.3, 0.004, 0.004, CEIL_Y - 2.73, 4)
  col(0, IN_X, COUNTER_Z0, COUNTER_Z1, 'counter:front')

  // 隔墙上方：电视菜单屏（带金属框与暖灯槽）+ 东墙价目表
  I.box(M.blackMetal, 1.65, 2.18, PART_Z1 + 0.03, 1.6, 0.96, 0.055)
  I.sign(M.menuScreen, 1.65, 2.66, PART_Z1 + 0.062, 1.48, 0.84)
  I.box(M.blackMetal, IN_X - 0.02, 1.54, 0.72, 0.02, 0.84, 0.68)
  I.sign(M.priceBoard, IN_X - 0.032, 1.96, 0.72, 0.62, 0.78, -Math.PI / 2)

  // 西墙：深棕金字「田源米粉」匾（加回纹金角饰）+ 公示栏 + 必吃榜 + 奖牌 + 配电柜与Wi-Fi盒（实拍 #05/#17）
  I.box(M.darkWood, -IN_X + 0.025, 2.28, 3.9, 0.045, 0.68, 2.12)
  I.box(D.brassGold, -IN_X + 0.04, 2.92, 3.9, 0.02, 0.03, 2.1)
  I.box(D.brassGold, -IN_X + 0.04, 2.29, 3.9, 0.02, 0.03, 2.1)
  I.sign(M.interiorPlaque, -IN_X + 0.052, 2.62, 3.9, 2.0, 0.59, Math.PI / 2)
  I.sign(M.supervisionBoard, -IN_X + 0.018, 1.84, 3.3, 0.7, 0.49, Math.PI / 2)
  I.sign(M.mustEatPlaque, -IN_X + 0.018, 1.84, 3.95, 0.3, 0.38, Math.PI / 2)
  I.sign(M.certificate, -IN_X + 0.018, 1.86, 4.42, 0.36, 0.28, Math.PI / 2)
  // 木盒 + 四天线路由器（实拍 #05）+ 配电柜贴大红纸价目小牌
  I.box(M.darkWood, -IN_X + 0.04, 1.72, 4.84, 0.06, 0.2, 0.28)
  I.box(M.whitePlastic, -IN_X + 0.06, 1.92, 4.84, 0.06, 0.035, 0.22)
  for (const dz of [-0.08, -0.03, 0.03, 0.08]) I.cyl(M.whitePlastic, -IN_X + 0.06, 1.955, 4.84 + dz, 0.004, 0.005, 0.12, 4)
  I.box(D.chromeTrim, -IN_X + 0.04, 1.48, 5.45, 0.07, 0.56, 0.42)
  I.box(M.stoolRed, -IN_X + 0.08, 1.54, 5.45, 0.008, 0.42, 0.32)

  // 东墙：四联墙面灯箱菜单板（加金属外框与顶部暖灯条）+ 挂钟 + 空调 + 双壁挂电扇
  I.box(M.blackMetal, IN_X - 0.02, 2.34, 3.5, 0.03, 0.66, 2.48)
  I.box(D.warmLed, IN_X - 0.03, 3.0, 3.5, 0.04, 0.035, 2.46)
  I.sign(M.menuPosters, IN_X - 0.038, 2.66, 3.5, 2.4, 0.6, -Math.PI / 2)
  I.add(M.wallClock, new THREE.CircleGeometry(0.16, 18), IN_X - 0.02, 2.62, 6.45, -Math.PI / 2)
  I.box(M.whitePlastic, IN_X - 0.11, 2.52, 5.45, 0.22, 0.3, 0.92)
  I.box(M.blackMetal, IN_X - 0.225, 2.56, 5.45, 0.01, 0.03, 0.8)
  wallFan(I, M, D, -IN_X + 0.02, 2.38, 2.15, 1)
  wallFan(I, M, D, IN_X - 0.02, 2.36, 4.6, -1)

  // 饮料冷柜（实拍 #05：黑色铝框收边 + 顶部细灯箱条 + 清晰瓶罐陈列门）
  I.aabb(M.fridgeBody, 2.62, FLOOR_Y, 5.95, IN_X - 0.02, 2.0, 6.85)
  I.box(M.blackMetal, 2.63, FLOOR_Y, 5.945, 0.03, 2.0, 0.025)
  I.box(M.blackMetal, 2.63, FLOOR_Y, 6.855, 0.03, 2.0, 0.025)
  I.box(D.warmLed, 2.63, 1.84, 6.4, 0.025, 0.12, 0.84)
  I.sign(M.fridgeFront, 2.615, 0.96, 6.4, 0.88, 1.84, -Math.PI / 2)
  col(2.6, IN_X, 5.93, 6.87, 'fridge:drinks')

  // 小料自助台：杉木条柜 + 石英台面 + 7 盆分项具象配菜 + 炸花生米碗 + 盆签（实拍 #08/#13）
  I.aabb(M.woodCladding, -IN_X, FLOOR_Y, 0.55, -2.66, 0.86, 2.75)
  for (let z = 0.72; z < 2.65; z += 0.34) {
    I.box(M.darkWood, -2.655, FLOOR_Y + 0.06, z, 0.012, 0.76, 0.025)
  }
  I.aabb(M.quartzTop, -IN_X, 0.86, 0.52, -2.62, 0.9, 2.78)
  I.aabb(M.stainless, -IN_X, 0.9, 0.52, -IN_X + 0.04, 1.32, 2.78)
  const cond = M.condiments
  cond.forEach((mat, i) => {
    const z = 0.76 + i * (1.84 / Math.max(1, cond.length - 1))
    openStainlessBowl(I, M, -2.94, 0.9, z, 0.125, 0.11, 0.125)
    fillCondimentBowl(I, M, D, i, mat, -2.94, 1.025, z, 1)
    I.cyl(M.stainlessDark, -2.84, 1.03, z + 0.055, 0.007, 0.007, 0.19, 5, false, 0, 0.45)
    I.box(M.whitePlastic, -3.19, 1.26, z, 0.012, 0.075, 0.14, 0, 0, -0.2)
    I.box(mat, -3.18, 1.275, z, 0.008, 0.036, 0.1, 0, 0, -0.2)
  })
  // 台面北端与南端补配：汤碗叠 + 脆炸花生米专盆 + 收腰红盖小醋壶（挪至靠墙内侧，绝不阻挡前景花生碗视线）
  I.cyl(M.whitePlastic, -2.74, 0.9, 0.62, 0.085, 0.065, 0.16, 10)
  openStainlessBowl(I, M, -2.75, 0.9, 2.66, 0.105, 0.09, 0.1)
  buildPeanutPile(I, D, -2.75, 1.0, 2.66, 0.88)
  I.cyl(D.ceramicJar, -3.1, 0.9, 2.58, 0.028, 0.032, 0.09, 8)
  I.cyl(D.ceramicJar, -3.1, 0.99, 2.58, 0.013, 0.028, 0.032, 8)
  I.cyl(M.stoolRed, -3.1, 1.022, 2.58, 0.015, 0.015, 0.022, 8)
  I.sign(M.toppingsSign, -IN_X + 0.018, 1.62, 1.65, 0.86, 0.25, Math.PI / 2)
  col(-IN_X, -2.62, 0.52, 2.78, 'toppings:bar')

  // 西墙边蓝筐与绿托盘（实拍 #17）
  I.box(M.crateBlue, -2.98, FLOOR_Y, 4.86, 0.42, 0.28, 0.3)
  I.box(M.crateBlue, -2.98, FLOOR_Y + 0.28, 4.86, 0.42, 0.28, 0.3)
  I.box(M.crateGreen, -2.98, FLOOR_Y + 0.56, 4.86, 0.4, 0.06, 0.3)

  // 座位：Lv1 6 / Lv2 12 / Lv3 室内 14（每桌标配筷筒、纸巾盒、调料罐）
  const tables: TableSpec[] = [
    {x: -0.6, z: 3.4, w: 1.2, d: 0.6, seats: [{x: -0.9, z: 2.85}, {x: -0.3, z: 2.85}, {x: -0.9, z: 3.95}, {x: -0.3, z: 3.95}]},
  ]
  if (lv >= 2) tables.push({x: -0.6, z: 5.45, w: 1.2, d: 0.6, seats: [{x: -0.9, z: 4.9}, {x: -0.3, z: 4.9}, {x: -0.9, z: 6.0}, {x: -0.3, z: 6.0}]})
  for (const t of tables) {
    table(I, M, D, t, M.tableWood)
    col(t.x - t.w / 2, t.x + t.w / 2, t.z - t.d / 2, t.z + t.d / 2, `table:${t.x},${t.z}`)
    for (const s of t.seats) {
      stool(I, M.stoolWood, s.x, s.z, FLOOR_Y)
      seats.push({id: `in-${seats.length + 1}`, pos: [s.x, FLOOR_Y, s.z], yaw: seatYaw(s.x, s.z, s.x, t.z), zone: 'indoor'})
    }
  }
  // 西墙靠墙桌（2 座 + 筷筒纸巾罐）
  I.aabb(M.tableWood, -IN_X, FLOOR_Y + 0.71, 3.2, -2.66, FLOOR_Y + 0.75, 4.6)
  I.box(M.blackMetal, -2.72, FLOOR_Y, 3.3, 0.04, 0.71, 0.04)
  I.box(M.blackMetal, -2.72, FLOOR_Y, 4.5, 0.04, 0.71, 0.04)
  I.cyl(M.darkWood, -3.05, FLOOR_Y + 0.75, 3.9, 0.034, 0.032, 0.13, 8)
  I.box(M.whitePlastic, -2.95, FLOOR_Y + 0.75, 4.15, 0.12, 0.075, 0.095)
  I.cyl(D.ceramicJar, -3.05, FLOOR_Y + 0.75, 3.7, 0.036, 0.034, 0.08, 8)
  I.cyl(M.stoolRed, -3.05, FLOOR_Y + 0.83, 3.7, 0.038, 0.038, 0.02, 8)
  col(-IN_X, -2.66, 3.2, 4.6, 'table:west-wall')
  for (const z of [3.55, 4.25]) {
    stool(I, M.stoolWood, -2.3, z, FLOOR_Y)
    seats.push({id: `in-${seats.length + 1}`, pos: [-2.3, FLOOR_Y, z], yaw: -Math.PI / 2, zone: 'indoor'})
  }
  // 东墙吧台（Lv2 2 座 / Lv3 4 座 + 筷筒纸巾罐）
  if (lv >= 2) {
    const z1 = lv >= 3 ? 5.5 : 3.9
    I.aabb(M.quartzTop, IN_X - 0.4, FLOOR_Y + 0.71, 2.3, IN_X, FLOOR_Y + 0.75, z1)
    for (let z = 2.5; z < z1; z += 0.8) I.box(M.blackMetal, IN_X - 0.2, FLOOR_Y + 0.5, z, 0.36, 0.03, 0.03)
    I.cyl(M.darkWood, IN_X - 0.14, FLOOR_Y + 0.75, 3.1, 0.034, 0.032, 0.13, 8)
    I.box(M.whitePlastic, IN_X - 0.16, FLOOR_Y + 0.75, 3.3, 0.1, 0.075, 0.12)
    I.cyl(D.ceramicJar, IN_X - 0.14, FLOOR_Y + 0.75, 2.9, 0.036, 0.034, 0.08, 8)
    col(IN_X - 0.4, IN_X, 2.3, z1, 'bar:east-wall')
    const zs = lv >= 3 ? [2.7, 3.5, 4.3, 5.1] : [2.7, 3.5]
    for (const z of zs) {
      stool(I, M.stoolWood, 2.5, z, FLOOR_Y)
      seats.push({id: `in-${seats.length + 1}`, pos: [2.5, FLOOR_Y, z], yaw: Math.PI / 2, zone: 'indoor'})
    }
  }
  return seats
}

// ───────────────────────────── 后厨（锅灶细节 + 挂勺 + 蒸汽位 + 货架杂物 + 地砖分缝） ─────────────────────────────

interface KitchenDynamics {
  pots: {x: number; z: number}[]
  brine: {x: number; z: number}
  broth: {x: number; z: number} | null
}

function hangingLadle(B: Batch, steel: THREE.Material, wood: THREE.Material, x: number, yTop: number, z: number, ry: number) {
  B.cyl(wood, x, yTop - 0.16, z, 0.011, 0.011, 0.16, 6)
  B.cyl(steel, x, yTop - 0.36, z, 0.006, 0.006, 0.21, 6)
  B.cyl(steel, x + Math.sin(ry) * 0.012, yTop - 0.41, z + Math.cos(ry) * 0.012, 0.048, 0.038, 0.032, 8, false, ry, Math.PI / 2)
}

function clayJar(B: Batch, jar: THREE.Material, lid: THREE.Material, x: number, y0: number, z: number) {
  B.cyl(jar, x, y0, z, 0.15, 0.12, 0.28, 10)
  B.cyl(jar, x, y0 + 0.28, z, 0.11, 0.15, 0.06, 10)
  B.cyl(lid, x, y0 + 0.34, z, 0.12, 0.12, 0.035, 10)
  B.sphere(lid, x, y0 + 0.385, z, 0.025, 1, 1, 1, 6)
}

function buildKitchen(I: Batch, M: Pack, D: DecorMats, lv: ShopLevel, col: AddCollider): KitchenDynamics {
  I.mesh(M.floorKitchen, m => flat(m, -IN_X, BACK_IN_Z, IN_X, PART_Z0, FLOOR_Y))
  // 后厨地砖分缝与灶台前不锈钢排水地沟格栅
  for (const x of [-1.6, 0, 1.6]) I.box(D.groutSeam, x, FLOOR_Y + 0.001, -3.5, 0.022, 0.002, 6.8)
  for (const z of [-1.8, -3.6, -5.4]) I.box(D.groutSeam, 0, FLOOR_Y + 0.001, z, 6.3, 0.002, 0.022)
  I.box(M.stainlessDark, 2.22, FLOOR_Y + 0.002, -3.3, 0.22, 0.006, 4.1)
  for (let z = -5.2; z <= -1.4; z += 0.28) {
    I.box(M.blackMetal, 2.22, FLOOR_Y + 0.007, z, 0.2, 0.004, 0.022)
  }

  I.mesh(M.wallTileKitchen, m => {
    wall(m, -IN_X, BACK_IN_Z, -IN_X, PART_Z0, FLOOR_Y, CEIL_Y, 1, 0)
    wall(m, IN_X, BACK_IN_Z, IN_X, PART_Z0, FLOOR_Y, CEIL_Y, -1, 0)
    wall(m, -IN_X, BACK_IN_Z, IN_X, BACK_IN_Z, FLOOR_Y, CEIL_Y, 0, 1)
    const z = PART_Z0
    wall(m, -IN_X, z, KDOOR_X0, z, FLOOR_Y, CEIL_Y, 0, -1)
    wall(m, KDOOR_X0, z, KDOOR_X1, z, KDOOR_TOP, CEIL_Y, 0, -1)
    wall(m, KDOOR_X1, z, PASS_X0, z, FLOOR_Y, CEIL_Y, 0, -1)
    wall(m, PASS_X0, z, PASS_X1, z, FLOOR_Y, PASS_Y0, 0, -1)
    wall(m, PASS_X0, z, PASS_X1, z, PASS_Y1, CEIL_Y, 0, -1)
    wall(m, PASS_X1, z, IN_X, z, FLOOR_Y, CEIL_Y, 0, -1)
  })

  // 出餐台（出餐窗后 + 小抹布折巾）
  I.aabb(M.stainless, PASS_X0, FLOOR_Y, -0.7, PASS_X1, 0.9, -0.02)
  I.aabb(M.stainless, PASS_X0, 0.3, -0.68, PASS_X1, 0.32, -0.04)
  for (const [x, n] of [
    [0.8, 6],
    [1.05, 4],
    [2.6, 5],
  ] as const) {
    for (let k = 0; k < n; k++) I.cyl(M.whitePlastic, x, 0.9 + k * 0.035, -0.36, 0.1, 0.07, 0.035, 10, true)
  }
  I.box(D.linenValance, 2.2, 0.905, -0.35, 0.24, 0.015, 0.18)
  col(PASS_X0, PASS_X1, -0.7, 0, 'kitchen:pickup-table')

  // 壁挂不锈钢挂杆 + 挂勺/漏勺/汤勺（严禁用 cyl 倾斜导致 y 上漂；方杆精准贴墙！）
  I.box(D.chromeTrim, 0.05, 1.76, PART_Z0 - 0.035, 0.92, 0.022, 0.022)
  hangingLadle(I, M.stainless, M.darkWood, -0.25, 1.76, PART_Z0 - 0.055, Math.PI)
  hangingLadle(I, M.stainless, M.darkWood, -0.02, 1.76, PART_Z0 - 0.055, Math.PI)
  hangingLadle(I, M.stainlessDark, M.darkWood, 0.22, 1.76, PART_Z0 - 0.055, Math.PI)
  I.box(D.chromeTrim, IN_X - 0.04, 1.74, -4.45, 0.022, 0.022, 1.35)
  hangingLadle(I, M.stainless, M.darkWood, IN_X - 0.065, 1.74, -4.1, -Math.PI / 2)
  hangingLadle(I, M.stainlessDark, M.darkWood, IN_X - 0.065, 1.74, -4.45, -Math.PI / 2)
  hangingLadle(I, M.stainless, M.darkWood, IN_X - 0.065, 1.74, -4.8, -Math.PI / 2)
  I.box(D.chromeTrim, -IN_X + 0.04, 1.82, -2.8, 0.022, 0.022, 1.35)
  hangingLadle(I, M.stainless, M.darkWood, -IN_X + 0.065, 1.82, -2.3, Math.PI / 2)
  hangingLadle(I, M.stainlessDark, M.darkWood, -IN_X + 0.065, 1.82, -3.25, Math.PI / 2)

  // 烫粉灶：不锈钢灶台 + 铸铁锅架 + 燃气管旋钮 + 双耳大锅 + 半盖锅盖 + 油烟机油网与罩下暖LED灯带
  const pots = (lv === 1 ? [-1.85, -2.85] : [-1.7, -2.35, -3.0]).map(z => ({x: RANGE_X, z}))
  I.aabb(M.stainless, 2.45, FLOOR_Y, -3.5, IN_X, 0.78, -1.2)
  I.aabb(M.blackMetal, 2.45, 0.78, -3.5, IN_X, RANGE_TOP, -1.2)
  // 前裙贴面燃气管（方管贴灶台前缘，不悬浮）与火力旋钮
  I.box(D.brassGold, 2.435, 0.56, -2.35, 0.026, 0.026, 2.1)
  for (const p of pots) {
    I.cyl(M.aluminium, p.x, RANGE_TOP + 0.02, p.z, POT_R, POT_R * 0.96, 0.28, 16)
    I.cyl(M.aluminium, p.x, RANGE_TOP + 0.3, p.z, POT_R, POT_R, 0.06, 16, true)
    I.torus(M.aluminium, p.x, RANGE_TOP + 0.36, p.z, POT_R, 0.012, 16)
    // 铸铁十字炉架 + 双耳锅柄 + 贴前裙火力旋钮
    I.box(M.blackMetal, p.x, RANGE_TOP, p.z, POT_R * 2.15, 0.025, 0.03)
    I.box(M.blackMetal, p.x, RANGE_TOP, p.z, 0.03, 0.025, POT_R * 2.15)
    I.box(M.stainlessDark, p.x, RANGE_TOP + 0.24, p.z - POT_R - 0.025, 0.09, 0.025, 0.04)
    I.box(M.stainlessDark, p.x, RANGE_TOP + 0.24, p.z + POT_R + 0.025, 0.09, 0.025, 0.04)
    I.box(M.stoolRed, 2.42, 0.555, p.z, 0.03, 0.04, 0.04)
  }
  // 后段排汤锅斜放半盖锅盖（保留蒸气出口）
  const lastPot = pots[pots.length - 1]
  I.cyl(D.chromeTrim, lastPot.x + 0.08, RANGE_TOP + 0.365, lastPot.z, POT_R * 0.85, POT_R * 0.85, 0.016, 12, false, 0, 0, -0.22)
  I.box(M.blackMetal, lastPot.x + 0.08, RANGE_TOP + 0.385, lastPot.z, 0.08, 0.02, 0.03, 0, 0, -0.22)

  // 排烟罩 + 斜置滤油网 + 罩底暖白LED灯带
  I.aabb(M.stainless, 2.2, 2.05, -3.65, IN_X, 2.6, -1.05)
  I.aabb(M.stainlessDark, 2.24, 2.04, -3.6, IN_X - 0.02, 2.05, -1.1)
  I.box(D.chromeTrim, 2.75, 2.08, -2.35, 0.45, 0.02, 2.2, 0, 0, 0.45)
  I.box(D.warmLed, 2.28, 2.03, -2.35, 0.06, 0.02, 2.25)
  col(2.45, IN_X, -3.5, -1.2, 'kitchen:boil-range')

  // 卤水灶：老卤大锅（加双耳+半掩锅盖+长勺）+ Lv2 起加骨头汤锅
  const brine = {x: 2.88, z: lv === 1 ? -4.5 : -4.85}
  const broth = lv >= 2 ? {x: 2.88, z: -4.15} : null
  I.aabb(M.stainless, 2.5, FLOOR_Y, -5.2, IN_X, 0.45, -3.8)
  I.cyl(M.stainlessDark, brine.x, 0.45, brine.z, 0.34, 0.31, 0.45, 16)
  I.cyl(M.stainlessDark, brine.x, 0.9, brine.z, 0.34, 0.34, 0.06, 16, true)
  I.torus(M.stainlessDark, brine.x, 0.96, brine.z, 0.34, 0.014, 16)
  I.cyl(M.brine, brine.x, 0.86, brine.z, 0.33, 0.33, 0.01, 14)
  I.cyl(M.darkWood, brine.x - 0.2, 0.9, brine.z + 0.1, 0.012, 0.012, 0.5, 6, false, 0, 0, 0.6)
  I.box(M.stainless, brine.x, 0.82, brine.z - 0.36, 0.12, 0.03, 0.04)
  I.box(M.stainless, brine.x, 0.82, brine.z + 0.36, 0.12, 0.03, 0.04)
  if (broth) {
    I.cyl(M.aluminium, broth.x, 0.45, broth.z, 0.28, 0.26, 0.42, 16)
    I.cyl(M.aluminium, broth.x, 0.87, broth.z, 0.28, 0.28, 0.06, 16, true)
    I.torus(M.aluminium, broth.x, 0.93, broth.z, 0.28, 0.012, 16)
    I.cyl(M.boneBroth, broth.x, 0.84, broth.z, 0.27, 0.27, 0.01, 14)
    I.box(M.stainless, broth.x, 0.78, broth.z - 0.3, 0.1, 0.025, 0.035)
    I.box(M.stainless, broth.x, 0.78, broth.z + 0.3, 0.1, 0.025, 0.035)
  }
  col(2.5, IN_X, -5.2, -3.8, 'kitchen:brine-stove')

  // 切码台：不锈钢台 + 圆砧板 + 分粒白蒜碗 + 五大具象肉码（酥皮三层锅烧/卤牛肉片/叉烧/切半溏心卤蛋/双股油条）
  I.aabb(M.stainless, -IN_X, FLOOR_Y, -4.28, -2.46, 0.86, -1.35)
  I.aabb(M.stainless, -IN_X, 0.3, -4.22, -2.5, 0.32, -1.4)
  I.add(M.choppingBlock, new THREE.CylinderGeometry(0.25, 0.25, 0.12, 16), -2.86, 0.92, -2.8)
  // 砧板旁不锈钢蒜米碗 + 洁白奶黄剥皮蒜瓣
  openStainlessBowl(I, M, -2.6, 0.86, -3.08, 0.095, 0.075, 0.055)
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2
    const r = (k % 3) * 0.02 + 0.01
    I.sphere(D.garlicMat, -2.6 + Math.cos(a) * r, 0.905 + (k < 4 ? 0.014 : 0.004), -3.08 + Math.sin(a) * r, 0.0135, 0.72, 0.86, 1.38, 5)
  }
  I.box(D.linenValance, -2.47, 0.72, -1.55, 0.025, 0.22, 0.18)

  const tray = (z: number, fill: (cx: number, cz: number) => void) => {
    I.box(M.stainless, -2.86, 0.86, z, 0.42, 0.032, 0.28)
    fill(-2.86, z)
  }
  // 托盘1：脆皮锅烧（底层瘦肉+中层白花肥肉+顶层金黄起泡麻皮+5片斜码三层厚切）
  tray(-1.62, (cx, cz) => {
    I.box(D.meatLean, cx - 0.05, 0.892, cz, 0.24, 0.022, 0.16)
    I.box(D.porkFat, cx - 0.05, 0.914, cz, 0.24, 0.014, 0.16)
    I.add(M.guoshao, boxGeo(0.24, 0.014, 0.16, true), cx - 0.05, 0.935, cz)
    for (let k = 0; k < 6; k++) I.sphere(D.eggYolk, cx - 0.13 + (k % 3) * 0.07, 0.942, cz - 0.04 + Math.floor(k / 3) * 0.07, 0.008, 1.2, 0.6, 1.2, 5)
    for (let k = 0; k < 5; k++) {
      const sx = cx + 0.11 + k * 0.012
      const sz = cz - 0.08 + k * 0.038
      I.box(D.meatLean, sx, 0.892, sz, 0.055, 0.016, 0.032, 0.18)
      I.box(D.porkFat, sx, 0.908, sz, 0.055, 0.01, 0.032, 0.18)
      I.box(M.guoshao, sx, 0.918, sz, 0.055, 0.008, 0.032, 0.18)
    }
  })
  // 托盘2：卤牛肉（深酱红牛腱肉墩 + 扇形叠码8片薄牛肉片）
  tray(-2.04, (cx, cz) => {
    I.sphere(M.beef, cx - 0.09, 0.918, cz, 0.07, 1.25, 0.55, 0.9, 8)
    for (let k = 0; k < 8; k++) {
      I.box(M.beef, cx + 0.03 + (k % 4) * 0.032, 0.895 + Math.floor(k / 4) * 0.01, cz - 0.045 + Math.floor(k / 4) * 0.085, 0.072, 0.009, 0.048, k * 0.25)
    }
  })
  // 托盘3：蜜汁叉烧（深红焦糖长条叉烧 + 露白边斜切厚片）
  tray(-3.32, (cx, cz) => {
    I.box(M.charsiu, cx - 0.07, 0.895, cz, 0.2, 0.046, 0.08, 0.15)
    I.box(D.porkFat, cx - 0.07, 0.906, cz + 0.041, 0.19, 0.012, 0.006, 0.15)
    for (let k = 0; k < 5; k++) {
      I.box(M.charsiu, cx + 0.11, 0.895, cz - 0.085 + k * 0.042, 0.064, 0.016, 0.032, 0.2)
    }
  })
  // 托盘4：虎皮卤蛋（4枚整蛋 + 2枚切半卤蛋露蛋白截面与金黄蛋黄芯）
  tray(-3.72, (cx, cz) => {
    for (let k = 0; k < 4; k++) {
      I.sphere(M.braisedEgg, cx - 0.11 + (k % 2) * 0.085, 0.918, cz - 0.05 + Math.floor(k / 2) * 0.095, 0.028, 1, 1.25, 1, 6)
    }
    for (let h = 0; h < 2; h++) {
      const hz = cz - 0.05 + h * 0.1
      I.sphere(M.braisedEgg, cx + 0.09, 0.9, hz, 0.028, 1, 0.65, 1.25, 6)
      I.cyl(D.porkFat, cx + 0.09, 0.906, hz, 0.024, 0.024, 0.008, 8)
      I.cyl(D.eggYolk, cx + 0.09, 0.915, hz, 0.012, 0.012, 0.004, 8)
    }
  })
  // 托盘5：现炸金黄双股大油条（Batch.cyl 以 y0+h/2 为中心，卧倒 rz=PI/2 需减 h/2 才能贴托盘顶面 0.892）
  tray(-4.1, (cx, cz) => {
    for (let k = 0; k < 3; k++) {
      const oz = cz - 0.072 + k * 0.072
      I.cyl(M.youtiao, cx, 0.786, oz - 0.011, 0.014, 0.014, 0.24, 6, false, 0, 0, Math.PI / 2)
      I.cyl(M.youtiao, cx, 0.789, oz + 0.011, 0.014, 0.014, 0.24, 6, false, 0, 0, Math.PI / 2)
    }
  })
  I.aabb(M.stainless, -IN_X, 1.5, -4.15, -2.96, 1.52, -1.5)
  for (let k = 0; k < 6; k++) I.cyl(k % 2 ? M.brine : M.cookingOil, -3.1, 1.52, -3.9 + k * 0.42, 0.035, 0.035, 0.24, 8)
  col(-IN_X, -2.46, -4.28, -1.35, 'kitchen:meat-table')

  // 中央备料岛：成束盘绕雪白圆米粉（取代扁块）、碗摞、袋装备粉、不锈钢料缸
  I.aabb(M.stainless, -0.5, FLOOR_Y, -5.3, 0.5, 0.88, -2.7)
  I.aabb(M.stainless, -0.46, 0.3, -5.26, 0.46, 0.32, -2.74)
  for (const z of [-3.05, -3.6]) {
    // 敞口四壁绿筐：底板+衬纸+四周筐壁，露出盒内盘绕圆米粉束
    I.box(M.crateGreen, 0, 0.88, z, 0.56, 0.018, 0.42)
    I.box(M.whitePlastic, 0, 0.898, z, 0.51, 0.006, 0.37)
    I.box(M.crateGreen, 0, 0.898, z - 0.198, 0.56, 0.072, 0.024)
    I.box(M.crateGreen, 0, 0.898, z + 0.198, 0.56, 0.072, 0.024)
    I.box(M.crateGreen, -0.268, 0.898, z, 0.024, 0.072, 0.38)
    I.box(M.crateGreen, 0.268, 0.898, z, 0.024, 0.072, 0.38)
    for (const bx of [-0.15, 0, 0.15]) {
      addNoodleCoil(I, M.noodle, bx, 0.916, z, 0.082, 0.0052, 5, 6, 0.024, Math.round((bx + 2) * 37))
    }
  }
  for (const [x, n] of [
    [-0.25, 7],
    [0.0, 5],
    [0.25, 6],
  ] as const) {
    for (let k = 0; k < n; k++) I.cyl(M.whitePlastic, x, 0.88 + k * 0.032, -4.28, 0.095, 0.068, 0.032, 10, false)
  }
  I.box(M.whitePlastic, -0.15, 0.88, -4.85, 0.36, 0.18, 0.5, 0.1)
  I.box(M.whitePlastic, 0.22, 0.88, -4.9, 0.32, 0.16, 0.44, -0.15)
  col(-0.5, 0.5, -5.3, -2.7, 'kitchen:prep-island')

  // 立式冷柜
  I.aabb(M.stainless, -IN_X, FLOOR_Y, -5.6, -2.56, 2.0, -4.4)
  I.aabb(M.blackMetal, -2.565, 0.12, -5.005, -2.555, 1.95, -4.995)
  for (const z of [-5.08, -4.92]) I.cyl(M.stainlessDark, -2.54, 0.9, z, 0.012, 0.012, 0.42, 6)
  col(-IN_X, -2.56, -5.6, -4.4, 'kitchen:fridge')

  // 洗碗池（双槽 + 弯管水龙头 + 洗洁精瓶 + 清洁百洁布）
  I.aabb(M.stainless, -IN_X, FLOOR_Y, -6.95, -2.6, 0.86, -5.8)
  I.aabb(M.stainlessDark, -3.15, 0.85, -6.8, -2.7, 0.865, -6.38)
  I.aabb(M.stainlessDark, -3.15, 0.85, -6.3, -2.7, 0.865, -5.9)
  I.cyl(M.stainless, -3.18, 0.86, -6.34, 0.02, 0.02, 0.34, 8)
  I.box(M.stainless, -3.05, 1.16, -6.34, 0.26, 0.03, 0.03)
  I.cyl(M.crateGreen, -3.18, 0.865, -5.85, 0.032, 0.032, 0.15, 8)
  I.box(M.stoolRed, -2.68, 0.865, -6.34, 0.08, 0.03, 0.05)
  col(-IN_X, -2.6, -6.95, -5.8, 'kitchen:sink')

  // 后墙货架：四层重型架 + 米粉袋 + 油醋桶 + 老坛酸笋陶瓷大坛×2 + 周转筐 + 叠盆杂物
  I.aabb(M.stainless, 1.0, 0.02, -7.0, 1.03, 2.05, -6.55)
  I.aabb(M.stainless, IN_X - 0.03, 0.02, -7.0, IN_X, 2.05, -6.55)
  for (const y of [0.3, 0.8, 1.3, 1.8]) {
    I.aabb(M.stainless, 1.0, y, -7.0, IN_X, y + 0.02, -6.55)
    I.box(D.chromeTrim, 2.13, y + 0.08, -6.55, 2.24, 0.015, 0.015)
  }
  for (let k = 0; k < 4; k++) I.box(M.whitePlastic, 1.35 + k * 0.5, 0.32, -6.78, 0.42, 0.26, 0.36)
  I.box(M.crateBlue, 1.4, 0.82, -6.78, 0.48, 0.28, 0.36)
  clayJar(I, D.ceramicJar, M.stoolRed, 2.1, 0.82, -6.78)
  clayJar(I, D.ceramicJar, M.darkWood, 2.52, 0.82, -6.78)
  I.box(M.crateGreen, 2.95, 0.82, -6.78, 0.42, 0.28, 0.36)
  for (let k = 0; k < 6; k++) I.cyl(k % 3 === 0 ? M.stoolRed : M.brine, 1.3 + k * 0.32, 1.32, -6.78, 0.05, 0.05, 0.22, 8)
  for (let k = 0; k < 8; k++) I.cyl(M.whitePlastic, 1.5 + (k % 4) * 0.45, 1.82 + Math.floor(k / 4) * 0.04, -6.78, 0.1, 0.07, 0.04, 10, true)
  col(1.0, IN_X, -7.01, -6.55, 'kitchen:back-shelf')

  // 账房：扩店图纸 + 账本（扩店工位）
  I.aabb(M.darkWood, -1.5, FLOOR_Y, -7.0, -0.3, 0.76, -6.5)
  I.box(M.clipboard, -1.05, 0.76, -6.72, 0.34, 0.03, 0.24, 0.12)
  I.box(M.blackMetal, -0.62, 0.76, -6.74, 0.14, 0.02, 0.2)
  I.box(M.darkWood, -0.9, 1.28, BACK_IN_Z + 0.015, 1.08, 0.78, 0.02)
  I.sign(M.blueprint, -0.9, 1.67, BACK_IN_Z + 0.03, 1.0, 0.7)
  stool(I, M.stoolWood, -0.9, -6.15, FLOOR_Y)
  col(-1.5, -0.3, -7.01, -6.5, 'kitchen:ledger-desk')

  // 角落杂物：蓝筐、拖把桶 + 竖拖把杆 + 垃圾桶
  I.box(M.crateBlue, 0.6, FLOOR_Y, -6.75, 0.45, 0.3, 0.35)
  I.box(M.crateBlue, 0.6, FLOOR_Y + 0.3, -6.75, 0.45, 0.3, 0.35)
  I.cyl(M.crateGreen, -1.9, FLOOR_Y, -6.7, 0.18, 0.15, 0.3, 10)
  I.cyl(M.tableWood, -1.95, FLOOR_Y + 0.12, -6.72, 0.014, 0.014, 1.25, 6, false, 0, 0.12, 0.08)
  I.cyl(M.blackMetal, -2.32, FLOOR_Y, -6.7, 0.18, 0.15, 0.46, 10)

  return {pots, brine, broth}
}

// ───────────────────────────── 门前人行道（电驴 + 汤桶 + 夜市地面溢光） ─────────────────────────────

function scooter(W: Batch, M: Pack, x: number, z: number, ry: number) {
  const c = Math.cos(ry)
  const s = Math.sin(ry)
  const at = (lx: number, lz: number): V2 => [x + lx * c + lz * s, z - lx * s + lz * c]
  for (const [wx, wz] of [at(0, 0.62), at(0, -0.55)]) {
    W.cyl(M.rubber, wx, 0.21, wz, 0.21, 0.21, 0.08, 12, false, ry, 0, Math.PI / 2)
  }
  W.box(M.rubber, x, 0.18, z, 0.26, 0.1, 0.9, ry)
  const [rx, rz] = at(0, -0.35)
  W.box(M.scooterShell, rx, 0.3, rz, 0.32, 0.36, 0.62, ry)
  W.box(M.rubber, rx, 0.66, rz, 0.26, 0.08, 0.52, ry)
  const [cx, cz] = at(0, 0.5)
  W.box(M.scooterShell, cx, 0.25, cz, 0.24, 0.62, 0.14, ry, -0.25)
  W.cyl(M.blackMetal, cx, 0.85, cz, 0.018, 0.018, 0.62, 6, false, ry, 0, Math.PI / 2)
  const [px, pz] = at(0, -0.72)
  W.box(M.scooterPlate, px, 0.36, pz, 0.18, 0.1, 0.01, ry)
}

function buildSidewalk(W: Batch, M: Pack, D: DecorMats, lv: ShopLevel, col: AddCollider): ShopSeat[] {
  const seats: ShopSeat[] = []
  const Y = 0.03
  W.mesh(M.pavement, m => {
    flat(m, -HX - 1.2, HZ, HX, APRON_Z1, Y)
    flat(m, -HX - 1.2, -HZ, -HX, HZ, Y)
  })
  const corner: V2[] = [
    [ARC_CX, HZ],
    [-HX, HZ],
  ]
  for (const p of outlinePath(0, ARC_CZ, ARC_CX + 0.01).reverse()) corner.push([p.x, p.z])
  W.shape(M.pavement, corner, Y)
  W.mesh(D.graniteLit, m => flat(m, ARC_CX, GLASS_Z, HX, HZ, FLOOR_Y))
  W.aabb(D.graniteLit, -HX - 1.2, -0.12, APRON_Z1 - 0.06, HX, Y + 0.02, APRON_Z1 + 0.08)
  // 夜间门口台阶暖光溢散层（仅夜间渐显，模拟店灯洒出街道，对照实拍 #17）
  W.mesh(D.nightSpill, m => flat(m, -1.6, GLASS_Z + 0.05, 3.2, APRON_Z1 - 0.1, Y + 0.014))

  // 西侧小巷停放的桂林绿牌电驴（贴靠西巷北段墙边错落停放，不遮挡正门弧角玻璃与外摆桌椅）
  const bikes: [number, number, number][] = [
    [-4.38, 0.35, 0.2],
    [-4.45, 1.85, -0.18],
  ]
  if (lv >= 2) bikes.push([-4.42, 3.3, 0.25])
  if (lv >= 3) bikes.push([-4.46, -1.2, -0.16])
  for (const [x, z, ry] of bikes) {
    scooter(W, M, x, z, ry)
    col(x - 0.3, x + 0.3, z - 0.85, z + 0.85, 'sidewalk:scooter')
  }

  // 门口右侧蓝筐垫高不锈钢保温骨头汤桶（贴近门东柱外檐，不挡玻璃内景与外摆桌）
  W.box(M.crateBlue, 3.05, Y, 7.45, 0.42, 0.26, 0.36)
  W.cyl(M.stainless, 3.05, Y + 0.26, 7.45, 0.21, 0.19, 0.44, 14)
  W.cyl(M.boneBroth, 3.05, Y + 0.68, 7.45, 0.195, 0.195, 0.01, 14)
  W.box(M.stainlessDark, 3.16, Y + 0.68, 7.45, 0.02, 0.34, 0.02, 0, 0, -0.42)
  col(2.8, 3.3, 7.22, 7.68, 'sidewalk:soup-bucket')

  // Lv3：门前外摆 3 桌 6 座
  if (lv >= 3) {
    const tables: TableSpec[] = [
      {x: -2.7, z: 8.4, w: 0.7, d: 0.6, seats: [{x: -3.2, z: 8.4}, {x: -2.2, z: 8.4}]},
      {x: -1.0, z: 8.4, w: 0.7, d: 0.6, seats: [{x: -1.5, z: 8.4}, {x: -0.5, z: 8.4}]},
      {x: 2.9, z: 8.5, w: 0.7, d: 0.6, seats: [{x: 2.4, z: 8.5}, {x: 3.4, z: 8.5}]},
    ]
    for (const t of tables) {
      table(W, M, D, t, M.whitePlastic, Y)
      col(t.x - t.w / 2, t.x + t.w / 2, t.z - t.d / 2, t.z + t.d / 2, 'sidewalk:table')
      for (const s of t.seats) {
        stool(W, M.stoolRed, s.x, s.z, Y)
        seats.push({id: `out-${seats.length + 1}`, pos: [s.x, Y, s.z], yaw: seatYaw(s.x, s.z, t.x, t.z), zone: 'sidewalk'})
      }
    }
  }
  return seats
}

// ───────────────────────────── 动态：蒸汽、火苗、漏勺、风扇、灯笼 ─────────────────────────────

interface SteamEmitter {
  x: number
  y: number
  z: number
  strength: number
  kind: 'boil' | 'brine'
}

const STEAM_PER_EMITTER = 26

function createSteam(M: Pack, emitters: SteamEmitter[]) {
  const n = emitters.length * STEAM_PER_EMITTER
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(n * 3)
  const color = new Float32Array(n * 4)
  const seeds = new Float32Array(n)
  for (let i = 0; i < n; i++) seeds[i] = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1)
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('color', new THREE.BufferAttribute(color, 4).setUsage(THREE.DynamicDrawUsage))
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(1.5, 1.6, -3), 4)
  const points = new THREE.Points(geo, M.steam)
  points.name = 'tianyuan.steam'

  function update(time: number, boiling: boolean, night: number, steamIntensity?: number) {
    const shade = 1 - night * 0.45
    const boilLevel = typeof steamIntensity === 'number' && Number.isFinite(steamIntensity)
      ? THREE.MathUtils.clamp(steamIntensity, 0.15, 1.35)
      : boiling ? 1 : 0.35
    emitters.forEach((e, ei) => {
      const active = e.kind === 'boil' ? boilLevel : 0.55
      const speed = e.kind === 'boil' ? 0.26 + boilLevel * 0.3 : 0.28
      const rise = e.kind === 'boil' ? 0.75 + boilLevel * 0.55 : 0.8
      for (let k = 0; k < STEAM_PER_EMITTER; k++) {
        const i = ei * STEAM_PER_EMITTER + k
        const sd = seeds[i]
        const life = (sd + time * speed * (0.7 + sd * 0.6)) % 1
        const spread = 0.05 + life * 0.22
        pos[i * 3] = e.x + Math.sin(sd * 40 + time * 0.9) * spread
        pos[i * 3 + 1] = e.y + life * rise
        pos[i * 3 + 2] = e.z + Math.cos(sd * 23 + time * 0.7) * spread
        color[i * 4] = shade
        color[i * 4 + 1] = shade
        color[i * 4 + 2] = shade
        color[i * 4 + 3] = Math.sin(Math.PI * life) * e.strength * active
      }
    })
    geo.getAttribute('position').needsUpdate = true
    geo.getAttribute('color').needsUpdate = true
  }
  return {points, update}
}

// ───────────────────────────── 主入口 ─────────────────────────────

function named<T extends THREE.Object3D>(obj: T, name: string): T {
  obj.name = name
  return obj
}

export function buildTianyuanShopMesh(level: ShopLevel = 1): TianyuanShopBuildResult {
  const lv: ShopLevel = level === 3 ? 3 : level === 2 ? 2 : 1
  const M = acquireTianyuanMaterials()
  const D = createDecorMats(M)
  const group = named(new THREE.Group(), 'tianyuan_mifen_shop')
  const exterior = named(new THREE.Group(), 'tianyuan.exterior')
  const ceilingGroup = named(new THREE.Group(), 'tianyuan.ceiling')
  const interior = named(new THREE.Group(), 'tianyuan.interior')
  const storefront = named(new THREE.Group(), 'tianyuan.storefront')
  const sidewalk = named(new THREE.Group(), 'tianyuan.sidewalk')
  const dynamic = named(new THREE.Group(), 'tianyuan.dynamic')
  group.add(exterior, ceilingGroup, interior, storefront, sidewalk, dynamic)

  const colliders: AabbCollider[] = []
  const col: AddCollider = (minX, maxX, minZ, maxZ, label) => colliders.push({minX, maxX, minZ, maxZ, label})
  col(-HX - 0.2, -IN_X, -HZ, ARC_CZ + 0.15, 'wall:west')
  col(IN_X, HX + 0.2, -HZ, GLASS_Z + 0.2, 'wall:east')
  col(-HX, HX, -HZ - 0.2, BACK_IN_Z, 'wall:back')
  col(-IN_X, KDOOR_X0, PART_Z0, PART_Z1, 'wall:pass-west')
  col(KDOOR_X1, IN_X, PART_Z0, PART_Z1, 'wall:pass-east')

  // 外立面与吊顶统一进 EC（剖切时同步隐藏）；门面独立进 SF（35~165m 中距和剖切态均常显，仅 4 draws）；前厅/后厨/外摆进 IW（<=35m 显示）
  const EC = new Batch(M.batchMasters?.vcExterior ?? null)
  const SF = new Batch(M.batchMasters?.vcExterior ?? null, M.batchMasters?.signAtlasLit ?? null)
  const IW = new Batch()
  buildShell(EC, M, D)
  buildCeiling(EC, M, D)
  buildStorefront(SF, M, D, col)
  const seats = [...buildHall(IW, M, D, lv, col), ...buildSidewalk(IW, M, D, lv, col)]
  const kitchen = buildKitchen(IW, M, D, lv, col)
  EC.flush(exterior, 'tianyuan.exterior')
  SF.flush(storefront, 'tianyuan.storefront')
  IW.flush(interior, 'tianyuan.interior')
  for (const grp of [storefront, interior]) {
    grp.traverse(o => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh && (mesh.material as THREE.Material).transparent) mesh.renderOrder = 2
    })
  }

  // 动态件与三工位精细动画模型
  const ownGeos: THREE.BufferGeometry[] = []
  const own = <G extends THREE.BufferGeometry>(g: G): G => {
    ownGeos.push(g)
    return g
  }
  const batchToGroup = (b: Batch, targetName: string) => {
    const g = named(new THREE.Group(), targetName)
    b.flush(g, targetName)
    g.traverse(o => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh && mesh.geometry) ownGeos.push(mesh.geometry)
    })
    return g
  }
  const dynVc = M.batchMasters?.vcPlastic ?? M.whitePlastic
  const buildMiniBowl = (targetName: string) => {
    const bb = new Batch(dynVc)
    const prof: V2[] = [[0, 0.002], [0.04, 0.002], [0.05, 0.014], [0.095, 0.075], [0.098, 0.078], [0.088, 0.074], [0.044, 0.018], [0, 0.016]]
    bb.add(M.whitePlastic, new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 14))
    bb.torus(D.chromeTrim, 0, 0.077, 0, 0.096, 0.003, 14)
    return batchToGroup(bb, targetName)
  }
  const buildNoodleBundle = (targetName: string, r = 0.06, tube = 0.0045, strands = 5) => {
    const bb = new Batch(M.batchMasters?.vcFood ?? M.noodle)
    addNoodleCoil(bb, M.noodle, 0, 0, 0, r, tube, strands, 7, 0.018, 43)
    return batchToGroup(bb, targetName)
  }

  const waterGeo = own(new THREE.CircleGeometry(POT_R - 0.012, 16).rotateX(-Math.PI / 2))
  const flameGeo = own(new THREE.TorusGeometry(POT_R + 0.02, 0.016, 6, 18).rotateX(Math.PI / 2))
  const potFx = kitchen.pots.map((p, i) => {
    const water = new THREE.Mesh(waterGeo, M.boilingWater)
    water.position.set(p.x, RANGE_TOP + 0.31, p.z)
    const flame = new THREE.Mesh(flameGeo, M.gasFlame)
    flame.position.set(p.x, RANGE_TOP + 0.005, p.z)
    const sb = new Batch(dynVc)
    sb.add(M.stainlessDark, new THREE.CylinderGeometry(0.085, 0.07, 0.1, 10, 1, true))
    sb.add(M.stainlessDark, new THREE.CylinderGeometry(0.0085, 0.0085, 0.216, 6).rotateZ(0.32).translate(-0.116, 0.148, 0))
    sb.add(M.darkWood, new THREE.CylinderGeometry(0.012, 0.011, 0.25, 6).rotateZ(1.326).translate(-0.27, 0.28, 0))
    const basket = batchToGroup(sb, `tianyuan.strainer-${i + 1}`)
    const potNoodles = buildNoodleBundle(`tianyuan.strainer-noodles-${i + 1}`, 0.064, 0.005, 6)
    potNoodles.position.set(0, 0.018, 0)
    basket.add(potNoodles)
    basket.position.set(p.x - 0.06, RANGE_TOP + 0.31, p.z)
    dynamic.add(water, flame, basket)
    return {pot: p, water, flame, basket, potNoodles, phase: i * 1.7}
  })

  // 1) 煮锅台等待出锅的沥水碗 + 6 颗下落水珠
  const dropGeo = own(new THREE.SphereGeometry(0.011, 5, 4).scale(0.85, 1.5, 0.85))
  const boilDrops = Array.from({length: 6}, () => {
    const d = new THREE.Mesh(dropGeo, D.waterDrop)
    d.visible = false
    dynamic.add(d)
    return d
  })
  const boilWaitBowl = buildMiniBowl('tianyuan.boil-wait-bowl')
  boilWaitBowl.position.set(2.6, RANGE_TOP + 0.02, -1.3)
  const boilBowlNoodles = buildNoodleBundle('tianyuan.boil-bowl-noodles', 0.064, 0.0046, 8)
  boilBowlNoodles.position.set(0, 0.036, 0)
  boilBowlNoodles.visible = false
  boilWaitBowl.add(boilBowlNoodles)
  dynamic.add(boilWaitBowl)

  // 共享具象肉码组构建器：每类肉码合批为 1 个顶点色 mesh（29 draws -> 5 draws）
  const foodVc = M.batchMasters?.vcFood ?? M.guoshao
  const buildBowlMeatClusters = (targetName: string): {root: THREE.Group; pieces: THREE.Group[]} => {
    const root = named(new THREE.Group(), targetName)
    const pieces: THREE.Group[] = []
    const buildCluster = (key: ToppingKey, fill: (b: Batch) => void) => {
      const b = new Batch(foodVc)
      fill(b)
      const g = batchToGroup(b, `${targetName}.${key}`)
      g.userData.meatKey = key
      g.visible = false
      root.add(g)
      pieces.push(g)
    }

    buildCluster('guoshao', b => {
      for (let k = 0; k < 3; k++) {
        const px = -0.046 + k * 0.01
        const py = 0.062 + k * 0.0025
        const pz = -0.028 + k * 0.013
        const ry = 0.42 + k * 0.18
        b.add(D.meatLean, new THREE.BoxGeometry(0.044, 0.008, 0.026), px, py, pz, ry, 0.22, -0.1)
        b.add(D.porkFat, new THREE.BoxGeometry(0.044, 0.005, 0.026).translate(0, 0.0065, 0), px, py, pz, ry, 0.22, -0.1)
        b.add(M.guoshao, new THREE.BoxGeometry(0.044, 0.005, 0.026).translate(0, 0.0115, 0), px, py, pz, ry, 0.22, -0.1)
      }
    })
    buildCluster('beef', b => {
      for (let k = 0; k < 4; k++) {
        b.add(
          M.beef,
          new THREE.CylinderGeometry(0.023, 0.023, 0.005, 8).scale(1.24, 1, 0.84),
          0.032 + (k % 2) * 0.018,
          0.067 + k * 0.0025,
          0.02 + k * 0.009,
          0.25 + k * 0.35,
          0.22,
          0.08,
        )
      }
    })
    buildCluster('charsiu', b => {
      for (let k = 0; k < 3; k++) {
        const px = 0.038 + k * 0.007
        const py = 0.063 + k * 0.0025
        const pz = -0.034 + k * 0.012
        const ry = -0.3 + k * 0.22
        b.add(M.charsiu, new THREE.BoxGeometry(0.042, 0.009, 0.022), px, py, pz, ry, 0.24, 0.06)
        b.add(D.porkFat, new THREE.BoxGeometry(0.04, 0.004, 0.005).translate(0, 0.002, 0.01), px, py, pz, ry, 0.24, 0.06)
      }
    })
    buildCluster('egg', b => {
      for (let h = 0; h < 2; h++) {
        const px = -0.044 + h * 0.024
        const py = 0.067
        const pz = 0.032 - h * 0.013
        const ry = h * 0.55
        b.add(M.braisedEgg, new THREE.SphereGeometry(0.019, 8, 6, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55).scale(1, 0.78, 1.28), px, py, pz, ry, -0.22, 0.12)
        b.add(D.eggWhite, new THREE.CylinderGeometry(0.017, 0.017, 0.0035, 10).scale(1, 1, 1.24).translate(0, 0.002, 0), px, py, pz, ry, -0.22, 0.12)
        b.add(D.eggYolk, new THREE.SphereGeometry(0.01, 8, 5).scale(1, 0.58, 1).translate(0, 0.005, 0), px, py, pz, ry, -0.22, 0.12)
      }
    })
    buildCluster('youtiao', b => {
      for (let p = 0; p < 2; p++) {
        const px = -0.008 + p * 0.018
        const py = 0.076 + p * 0.007
        const pz = -0.056 + p * 0.008
        const ry = 0.12 - p * 0.18
        b.add(M.youtiao, new THREE.CylinderGeometry(0.0072, 0.0072, 0.056, 6).rotateZ(Math.PI / 2).translate(0, 0, -0.007), px, py, pz, ry, 0.32, -0.14)
        b.add(M.youtiao, new THREE.CylinderGeometry(0.0072, 0.0072, 0.056, 6).rotateZ(Math.PI / 2).translate(0, 0, 0.007), px, py, pz, ry, 0.32, -0.14)
        b.add(M.youtiao, new THREE.BoxGeometry(0.01, 0.01, 0.022), px, py, pz, ry, 0.32, -0.14)
      }
    })

    return {root, pieces}
  }

  // 2) 肉台动画：菜刀 / 砧板肉块 / 飞肉片 / 待装盘粉碗（全部合批）
  const cleaverB = new Batch(dynVc)
  cleaverB.add(M.stainless, new THREE.BoxGeometry(0.18, 0.082, 0.004).translate(-0.14, 0.038, 0))
  cleaverB.add(M.darkWood, new THREE.CylinderGeometry(0.015, 0.014, 0.11, 8).rotateZ(Math.PI / 2).translate(0.01, 0.068, 0))
  const cleaverPivot = batchToGroup(cleaverB, 'tianyuan.cleaver-pivot')
  cleaverPivot.position.set(-2.72, 0.992, -2.66)

  const cutSlab = named(new THREE.Group(), 'tianyuan.cut-slab')
  cutSlab.position.set(-2.88, 0.986, -2.8)
  const makeSlab = (key: string, fill: (b: Batch) => void) => {
    const b = new Batch(foodVc)
    fill(b)
    return batchToGroup(b, `tianyuan.slab-${key}`)
  }
  const cutSlabByMeat: Record<ToppingKey, THREE.Group> = {
    guoshao: makeSlab('guoshao', b => {
      b.add(D.meatLean, new THREE.BoxGeometry(0.15, 0.02, 0.095))
      b.add(D.porkFat, new THREE.BoxGeometry(0.15, 0.012, 0.095).translate(0, 0.016, 0))
      b.add(M.guoshao, new THREE.BoxGeometry(0.15, 0.012, 0.095).translate(0, 0.028, 0))
    }),
    beef: makeSlab('beef', b => {
      b.add(M.beef, new THREE.SphereGeometry(0.072, 10, 6).scale(1.25, 0.48, 0.88).translate(0, 0.022, 0))
    }),
    charsiu: makeSlab('charsiu', b => {
      b.add(M.charsiu, new THREE.BoxGeometry(0.17, 0.04, 0.072).translate(0, 0.018, 0))
      b.add(D.porkFat, new THREE.BoxGeometry(0.16, 0.01, 0.008).translate(0, 0.022, 0.036))
    }),
    egg: makeSlab('egg', b => {
      b.add(M.braisedEgg, new THREE.SphereGeometry(0.028, 8, 6).scale(1, 1.2, 1).translate(-0.04, 0.028, 0))
      b.add(M.braisedEgg, new THREE.SphereGeometry(0.028, 8, 6, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55).scale(1, 0.75, 1.25).translate(0.035, 0.012, 0))
      b.add(D.eggYolk, new THREE.SphereGeometry(0.013, 8, 5).scale(1, 0.6, 1).translate(0.035, 0.017, 0))
    }),
    youtiao: makeSlab('youtiao', b => {
      b.add(M.youtiao, new THREE.CylinderGeometry(0.013, 0.013, 0.19, 6).rotateZ(Math.PI / 2), 0, 0.014, -0.012)
      b.add(M.youtiao, new THREE.CylinderGeometry(0.013, 0.013, 0.19, 6).rotateZ(Math.PI / 2), 0, 0.014, 0.012)
    }),
  }
  for (const k of ['guoshao', 'beef', 'charsiu', 'egg', 'youtiao'] as const) {
    cutSlabByMeat[k].visible = k === 'guoshao'
    cutSlab.add(cutSlabByMeat[k])
  }

  const flyingMeat = named(new THREE.Group(), 'tianyuan.flying-meat')
  const flySliceGeo = own(new THREE.BoxGeometry(0.064, 0.02, 0.044))
  const flyByMeat: Record<ToppingKey, THREE.Mesh> = {
    guoshao: new THREE.Mesh(flySliceGeo, M.guoshao),
    beef: new THREE.Mesh(own(new THREE.CylinderGeometry(0.028, 0.028, 0.009, 8).scale(1.25, 1, 0.9)), M.beef),
    charsiu: new THREE.Mesh(flySliceGeo, M.charsiu),
    egg: new THREE.Mesh(own(new THREE.SphereGeometry(0.022, 7, 5).scale(1, 0.72, 1.2)), D.eggYolk),
    youtiao: new THREE.Mesh(own(new THREE.CylinderGeometry(0.012, 0.012, 0.064, 6).rotateZ(Math.PI / 2)), M.youtiao),
  }
  for (const k of ['guoshao', 'beef', 'charsiu', 'egg', 'youtiao'] as const) {
    flyByMeat[k].visible = k === 'guoshao'
    flyingMeat.add(flyByMeat[k])
  }
  flyingMeat.visible = false

  const meatWaitBowl = buildMiniBowl('tianyuan.meat-wait-bowl')
  meatWaitBowl.position.set(-2.68, 0.86, -2.38)
  const meatBowlNoodles = buildNoodleBundle('tianyuan.meat-bowl-noodles', 0.064, 0.0046, 8)
  meatBowlNoodles.position.set(0, 0.036, 0)
  meatBowlNoodles.visible = false
  const meatBowlClusters = buildBowlMeatClusters('tianyuan.meat-bowl-slices')
  const meatBowlSlices = meatBowlClusters.root
  const meatPieces = meatBowlClusters.pieces
  meatBowlSlices.visible = false
  meatWaitBowl.add(meatBowlNoodles, meatBowlSlices)
  dynamic.add(cleaverPivot, cutSlab, flyingMeat, meatWaitBowl)

  // 3) 前台明档动画：老卤长勺合批 + 淋卤液柱 + 出餐成品碗（配菜/红油各合批为 1 mesh）
  const ladleB = new Batch(dynVc)
  ladleB.add(M.stainless, new THREE.CylinderGeometry(0.036, 0.026, 0.032, 10, 1, false).translate(0, -0.016, 0))
  ladleB.add(M.stainlessDark, new THREE.CylinderGeometry(0.0065, 0.0065, 0.24, 6).rotateZ(-0.24).translate(0.035, 0.11, 0))
  ladleB.add(M.darkWood, new THREE.CylinderGeometry(0.0095, 0.0095, 0.1, 6).rotateZ(-0.24).translate(0.072, 0.26, 0))
  const ladlePivot = batchToGroup(ladleB, 'tianyuan.brine-ladle-pivot')
  const ladleLiquid = new THREE.Mesh(own(new THREE.CircleGeometry(0.033, 10).rotateX(-Math.PI / 2).translate(0, -0.002, 0)), M.brine)
  ladleLiquid.visible = false
  ladlePivot.add(ladleLiquid)
  ladlePivot.position.set(2.0, COUNTER_Y + 0.22, 1.48)

  const streamCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-0.016, -0.055, 0),
    new THREE.Vector3(-0.028, -0.125, 0),
    new THREE.Vector3(-0.036, -0.19, 0),
  ])
  const brineStream = new THREE.Mesh(own(new THREE.TubeGeometry(streamCurve, 10, 0.007, 6, false)), M.brine)
  brineStream.position.set(1.697, COUNTER_Y + 0.302, 1.5)
  brineStream.visible = false

  const counterServeBowl = buildMiniBowl('tianyuan.counter-serve-bowl')
  counterServeBowl.position.set(1.66, COUNTER_Y + 0.05, 1.5)
  counterServeBowl.visible = false
  const counterBowlNoodles = buildNoodleBundle('tianyuan.counter-bowl-noodles', 0.064, 0.0048, 9)
  counterBowlNoodles.position.set(0, 0.038, 0)
  const counterBrinePool = new THREE.Mesh(own(new THREE.CircleGeometry(0.08, 18).rotateX(-Math.PI / 2)), M.brine)
  counterBrinePool.position.set(0, 0.052, 0)
  const counterMeatClusters = buildBowlMeatClusters('tianyuan.counter-bowl-slices')
  const counterMeatSlices = counterMeatClusters.root
  const counterMeatPieces = counterMeatClusters.pieces

  const garnB = new Batch(foodVc)
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    garnB.add(M.condiments[0] ?? D.peanutSkin, new THREE.TorusGeometry(0.0075, 0.0026, 3, 6), Math.cos(a) * 0.024, 0.075, Math.sin(a) * 0.024, a, Math.PI / 2 + 0.25)
  }
  for (const [nx, nz] of [[-0.01, 0.016], [0.014, 0.008], [-0.016, -0.012], [0.008, -0.02], [0.0, 0.0]] as const) {
    garnB.add(D.peanutSkin, new THREE.SphereGeometry(0.0078, 5, 4).scale(1, 0.78, 1.42), nx, 0.077, nz, nx * 18)
  }
  const counterGarnish = batchToGroup(garnB, 'tianyuan.counter-garnish')

  const chiliB = new Batch(foodVc)
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.35
    const r = 0.012 + (k % 3) * 0.014
    const g = k % 2 ? new THREE.SphereGeometry(0.009, 6, 4).scale(1.3, 0.35, 1.05) : new THREE.BoxGeometry(0.011, 0.0035, 0.008)
    chiliB.add(D.chiliOilSurface, g, Math.cos(a) * r, 0.076, Math.sin(a) * r, a)
  }
  const counterChiliLayer = batchToGroup(chiliB, 'tianyuan.counter-chili-oil')
  counterChiliLayer.visible = false

  counterServeBowl.add(counterBowlNoodles, counterBrinePool, counterMeatSlices, counterGarnish, counterChiliLayer)
  dynamic.add(ladlePivot, brineStream, counterServeBowl)

  const emitters: SteamEmitter[] = kitchen.pots.map(p => ({x: p.x, y: RANGE_TOP + 0.38, z: p.z, strength: 0.85, kind: 'boil' as const}))
  emitters.push({x: kitchen.brine.x, y: 0.98, z: kitchen.brine.z, strength: 0.5, kind: 'brine'})
  if (kitchen.broth) emitters.push({x: kitchen.broth.x, y: 0.95, z: kitchen.broth.z, strength: 0.6, kind: 'brine'})
  const steam = createSteam(M, emitters)
  dynamic.add(steam.points)
  ownGeos.push(steam.points.geometry)

  let fan: THREE.Group | null = null
  if (lv >= 2) {
    const fb = new Batch(dynVc)
    fb.add(M.blackMetal, new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6).translate(0, -0.2, 0))
    fb.add(M.whitePlastic, new THREE.CylinderGeometry(0.09, 0.07, 0.08, 10).translate(0, -0.44, 0))
    for (let k = 0; k < 3; k++) {
      fb.add(M.whitePlastic, new THREE.BoxGeometry(0.62, 0.012, 0.12).translate(0.38, -0.44, 0), 0, 0, 0, (k / 3) * Math.PI * 2)
    }
    fan = batchToGroup(fb, 'tianyuan.ceiling-fan')
    fan.position.set(0.4, CEIL_Y, 4.4)
    exterior.add(fan)
  }

  const lanterns: THREE.Group[] = []
  if (lv >= 3) {
    for (const x of [-0.3, 2.45]) {
      const lb = new Batch(dynVc)
      lb.add(M.lanternRed, new THREE.SphereGeometry(0.17, 10, 8).scale(1, 0.86, 1), 0, -0.47, 0)
      lb.add(M.darkWood, new THREE.CylinderGeometry(0.08, 0.08, 0.04, 10), 0, -0.31, 0)
      lb.add(M.darkWood, new THREE.CylinderGeometry(0.08, 0.08, 0.04, 10), 0, -0.62, 0)
      lb.add(M.lanternRed, new THREE.CylinderGeometry(0.012, 0.03, 0.16, 6), 0, -0.72, 0)
      lb.add(M.blackMetal, new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4), 0, -0.15, 0)
      const l = batchToGroup(lb, 'tianyuan.lantern')
      l.position.set(x, FASCIA_Y0, GLASS_Z + 0.5)
      dynamic.add(l)
      lanterns.push(l)
    }
  }

  // 室外远近只依赖传入 cameraPos（零额外 probe Mesh draw call）
  const camLocal = new THREE.Vector3()
  let cutMode: ShopCutawayMode = 'auto'
  let cut = false
  const inFootprint = (p: THREE.Vector3) =>
    Math.abs(p.x) < HX && p.z > -HZ && p.z < GLASS_Z + 0.05 && !(p.x < ARC_CX && p.z > ARC_CZ && Math.hypot(p.x - ARC_CX, p.z - ARC_CZ) > ARC_R)

  function evalCutaway(indoor: boolean, camWorldPos?: THREE.Vector3): boolean {
    if (cutMode !== 'auto') return cutMode
    if (!camWorldPos) return false
    group.worldToLocal(camLocal.copy(camWorldPos))
    const overhead = inFootprint(camLocal) && camLocal.y >= CEIL_Y - 0.05 && camLocal.y < ROOF_Y + 0.8
    const inRoom = Math.abs(camLocal.x) < IN_X && camLocal.z > BACK_IN_Z && camLocal.z < GLASS_Z && camLocal.y < CEIL_Y - 0.05 && inFootprint(camLocal)
    return overhead || (indoor && !inRoom)
  }

  function applyCut(next: boolean) {
    if (next === cut) return
    cut = next
    exterior.visible = !cut
    ceilingGroup.visible = !cut
    group.userData.cutaway = cut
  }

  const zones: Record<'sidewalk' | 'hall' | 'pass' | 'kitchen', ShopZoneRect> = {
    sidewalk: {minX: -HX, maxX: HX, minZ: HZ, maxZ: APRON_Z1},
    hall: {minX: -IN_X, maxX: IN_X, minZ: PART_Z1, maxZ: GLASS_Z},
    pass: {minX: -IN_X, maxX: IN_X, minZ: PART_Z0, maxZ: PART_Z1},
    kitchen: {minX: -IN_X, maxX: IN_X, minZ: BACK_IN_Z, maxZ: PART_Z0},
  }

  const stations: Record<StationKey, [number, number, number]> = {
    counter: [1.95, FLOOR_Y, 0.72],
    pickup: [1.7, FLOOR_Y, -1.2],
    boil: [1.75, FLOOR_Y, -2.35],
    broth: [1.95, FLOOR_Y, 0.72],
    meat: [-1.75, FLOOR_Y, -2.8],
    toppings: [-2.05, FLOOR_Y, 1.65],
    upgrade: [-0.9, FLOOR_Y, -6.05],
  }
  const queueAll: [number, number, number][] = [
    [2.05, FLOOR_Y, 2.4],
    [1.2, FLOOR_Y, 3.2],
    [1.2, FLOOR_Y, 4.1],
    [1.2, FLOOR_Y, 5.0],
    [1.2, FLOOR_Y, 5.9],
    [1.15, FLOOR_Y, 6.75],
    [1.15, 0.03, 7.7],
    [1.15, 0.03, 8.6],
  ]
  const queuePoints = queueAll.slice(0, lv === 1 ? 3 : lv === 2 ? 5 : 8)

  let animPreview: TianyuanVisualsAnimationExt | null = null
  const setAnimPreview = (next: TianyuanVisualsAnimationExt | null) => {
    animPreview = next
  }
  ;(globalThis as Record<string, unknown>).__mifenShopAnimPreview = setAnimPreview
  group.userData = {
    kind: 'tianyuan-mifen-shop',
    level: lv,
    footprint: {width: HX * 2, depth: HZ * 2, center: SITE_CENTER},
    zones,
    stations,
    seatCount: seats.length,
    cutaway: false,
    setAnimPreview,
  }

  let elapsed = 0
  let disposed = false

  return {
    level: lv,
    group,
    colliders,
    walkBounds: {minX: -IN_X, maxX: IN_X, minZ: BACK_IN_Z, maxZ: GLASS_Z},
    stations,
    seats,
    entrance: [(DOOR_X0 + DOOR_X1) / 2, FLOOR_Y, GLASS_Z + 0.25],
    kitchenEntry: [(KDOOR_X0 + KDOOR_X1) / 2, FLOOR_Y, PART_Z0 - 0.12],
    queuePoints,
    zones,

    updateVisuals(dt: number, ctx: TianyuanShopVisualsCtx & TianyuanVisualsAnimationExt) {
      if (disposed) return
      elapsed += dt
      const time = Number.isFinite(ctx.time) ? ctx.time : elapsed
      const night = THREE.MathUtils.clamp(ctx.night, 0, 1)

      // 优先级严格遵循：animPreview > ctx.cooking > 原逻辑
      const preview = animPreview
      const realCooking = preview ? undefined : ctx.cooking
      const activeCooking: CookingVisualState | undefined = preview?.cooking ?? realCooking

      const legacyStage: MifenCookVisualStage = preview?.cookingStage ?? ctx.cookingStage ?? (ctx.boiling ? 'boil' : 'idle')
      const rawProg = preview?.stepProgress ?? ctx.stepProgress
      const legacyProg = typeof rawProg === 'number' && Number.isFinite(rawProg) ? THREE.MathUtils.clamp(rawProg, 0, 1) : (time * 0.45) % 1
      const fallbackMeats = preview?.activeMeats ?? ctx.activeMeats ?? []

      const isBoilDriving = activeCooking
        ? activeCooking.boil.active || (activeCooking.stage === 'boil' && !activeCooking.boil.done)
        : legacyStage === 'boil'
      const isBrothDriving = activeCooking
        ? activeCooking.counter.active || activeCooking.counter.pouring || activeCooking.stage === 'counter'
        : legacyStage === 'broth'
      const steamIntensity = activeCooking ? activeCooking.boil.steamIntensity : ctx.boiling || isBoilDriving ? 1 : 0.35

      M.updateNight(night, ctx.boiling || isBoilDriving, time)
      D.cedarLit.emissiveIntensity = night * 0.34
      D.graniteLit.emissiveIntensity = night * 0.16
      D.wainscotTile.emissiveIntensity = 0.24 + night * 0.16
      D.groutSeam.emissiveIntensity = 0.1 + night * 0.1
      D.chromeTrim.emissiveIntensity = 0.14 + night * 0.16
      D.brassGold.emissiveIntensity = 0.15 + night * 0.85
      D.warmLed.emissiveIntensity = 0.65 + night * 1.45
      D.awningCanopy.emissiveIntensity = night * 0.08
      D.pvcCurtain.emissiveIntensity = 0.14 + night * 0.14
      D.linenValance.emissiveIntensity = 0.12 + night * 0.12
      D.ceramicJar.emissiveIntensity = 0.1 + night * 0.12
      D.porkFat.emissiveIntensity = 0.16 + night * 0.12
      D.meatLean.emissiveIntensity = 0.14 + night * 0.1
      D.eggWhite.emissiveIntensity = 0.16 + night * 0.12
      D.eggYolk.emissiveIntensity = 0.16 + night * 0.12
      D.peanutSkin.emissiveIntensity = 0.14 + night * 0.1
      D.garlicMat.emissiveIntensity = 0.14 + night * 0.1
      D.sourSoupMat.emissiveIntensity = 0.15 + night * 0.1
      D.chiliOilSurface.emissiveIntensity = 0.18 + night * 0.12
      D.nightSpill.opacity = night * 0.2

      steam.update(time, ctx.boiling || isBoilDriving || isBrothDriving, night, steamIntensity)

      const setBowlMeatsVisible = (pieces: readonly THREE.Object3D[], meats: readonly string[]) => {
        const allow = new Set(meats)
        for (const pm of pieces) pm.visible = allow.has(pm.userData.meatKey as string)
      }
      const setVariantMapVisible = <T extends THREE.Object3D>(variants: Record<ToppingKey, T>, activeKey: ToppingKey) => {
        for (const k of ['guoshao', 'beef', 'charsiu', 'egg', 'youtiao'] as const) {
          variants[k].visible = k === activeKey
        }
      }

      const applyStrainerPourPose = (p: (typeof potFx)[number], sub: number) => {
        // 先在高空横移跨过锅沿与右侧锅耳(-1.395)直抵接粉白碗(2.6,-1.27)正上方，再倾斜倾倒，绝不穿模锅沿
        const moveT = THREE.MathUtils.smoothstep(sub, 0, 0.34)
        const tiltT = THREE.MathUtils.smoothstep(sub, 0.28, 0.95)
        p.basket.position.set(
          THREE.MathUtils.lerp(p.pot.x - 0.08, 2.58, moveT),
          RANGE_TOP + 0.44 + Math.sin(moveT * Math.PI) * 0.06 - tiltT * 0.09,
          THREE.MathUtils.lerp(p.pot.z + 0.04, -1.27, moveT),
        )
        p.basket.rotation.set(0.2 * (1 - tiltT), 0, -0.18 - tiltT * 1.05)
        p.potNoodles.scale.setScalar(1.08)
        p.potNoodles.visible = sub < 0.65
      }

      if (activeCooking) {
        // ─── 真实做粉状态（或通过 __mifenShopAnimPreview.cooking 注入真实 CookingVisualState）驱动三工位 ───
        const cBoil = activeCooking.boil
        const cMeat = activeCooking.meat
        const cCounter = activeCooking.counter
        const cBowl = activeCooking.bowl

        // 1) 煮锅台：dipPhase / noodleRelax / drainProgress / steamIntensity 驱动下锅涮粉、松散、提起沥水、倾倒接粉碗
        potFx.forEach((p, idx) => {
          const heroInBoil = idx === 0 && (cBoil.active || activeCooking.stage === 'boil')
          const flameOn = heroInBoil || ctx.boiling || cBoil.steamIntensity >= 0.45
          const amp = heroInBoil || ctx.boiling ? 1 : 0.25
          p.water.position.y = RANGE_TOP + 0.31 + Math.sin(time * 9 + p.phase) * 0.004 * amp
          p.flame.scale.setScalar(1 + Math.sin(time * 17 + p.phase) * 0.04 * amp)
          p.flame.visible = flameOn || Math.sin(time * 0.5 + p.phase) > -0.2

          if (heroInBoil) {
            const dip = cBoil.dipPhase
            const drain = THREE.MathUtils.clamp(cBoil.drainProgress, 0, 1)
            const relax = THREE.MathUtils.clamp(cBoil.noodleRelax, 0, 1)
            if (drain <= 0.01) {
              // 下锅涮煮与松散舒展：贴近液面滚水可见粉束与篓沿，鹅颈柄高过锅沿不穿模
              p.basket.position.set(
                p.pot.x - 0.03 + Math.cos(dip * 0.5) * 0.015,
                RANGE_TOP + 0.305 + Math.sin(dip) * 0.022,
                p.pot.z + Math.sin(dip * 0.5) * 0.015,
              )
              p.basket.rotation.set(0, Math.sin(dip * 0.5) * 0.22, 0)
              const s = 0.74 + relax * 0.36
              p.potNoodles.scale.set(s, 0.78 + relax * 0.32, s)
              p.potNoodles.visible = true
            } else if (drain < 0.72) {
              // 锁火提起沥水：负rz抬起外手柄并倾角露粉（绝不反插锅内），水珠密集落下
              const sub = drain / 0.72
              p.basket.position.set(p.pot.x - 0.08, RANGE_TOP + 0.44 + Math.sin(sub * Math.PI) * 0.14, p.pot.z + 0.04)
              p.basket.rotation.set(0.24 + Math.sin(sub * Math.PI * 6) * 0.08, 0, -0.18 + Math.sin(sub * Math.PI * 4) * 0.05)
              p.potNoodles.scale.setScalar(1.06 + relax * 0.08)
              p.potNoodles.visible = true
            } else {
              // 沥尽转向接粉白碗倾倒出粉
              applyStrainerPourPose(p, (drain - 0.72) / 0.28)
            }
          } else {
            p.basket.position.set(p.pot.x - 0.06, RANGE_TOP + 0.31 + (ctx.boiling ? Math.abs(Math.sin(time * 3.2 + p.phase)) * 0.04 : 0), p.pot.z)
            p.basket.rotation.set(0, ctx.boiling ? Math.sin(time * 1.6 + p.phase) * 0.22 : 0, 0)
            p.potNoodles.scale.setScalar(1)
            p.potNoodles.visible = true
          }
        })
        const drainingNow = (cBoil.active || activeCooking.stage === 'boil') && cBoil.drainProgress > 0.02 && cBoil.drainProgress < 0.78
        boilDrops.forEach((d, idx) => {
          d.visible = drainingNow
          if (drainingNow) {
            const cycle = (cBoil.drainProgress * 10 + idx * 0.18) % 1
            d.position.set(
              potFx[0].basket.position.x + ((idx % 3) - 1) * 0.032,
              potFx[0].basket.position.y - 0.055 - cycle * 0.17,
              potFx[0].basket.position.z + (Math.floor(idx / 3) - 0.5) * 0.035,
            )
          }
        })
        const loc: CookingBowlLocation = cBowl.location
        boilBowlNoodles.visible = cBowl.visible && loc === 'boil' && (cBoil.done || cBoil.drainProgress >= 0.76)

        // 2) 肉台：lastChopped / chopPulse / chopCount / addedMeats 驱动砧板肉材切换、切肉节奏、飞肉片与肉台白碗配菜
        const meatBoardKey: ToppingKey = cMeat.lastChopped ?? cMeat.requiredMeats[0] ?? 'guoshao'
        setVariantMapVisible(cutSlabByMeat, meatBoardKey)
        setVariantMapVisible(flyByMeat, cMeat.lastChopped ?? meatBoardKey)
        if (cMeat.active || activeCooking.stage === 'meat') {
          const pulse = THREE.MathUtils.clamp(cMeat.chopPulse, 0, 1)
          if (pulse > 0.02) {
            const chopZ = -2.84 + (cMeat.chopCount % 4) * 0.028
            // 前半段瞬劈落刀，后半段微抬随动，飞肉沿抛物线飞向粉碗
            const bladeY = pulse >= 0.5 ? 1.036 + (pulse - 0.5) * 0.08 : 1.036 + (0.5 - pulse) * 0.14
            const bladeRz = pulse >= 0.5 ? 0.06 - (pulse - 0.5) * 0.3 : 0.06 - (0.5 - pulse) * 0.72
            cleaverPivot.position.set(-2.72, bladeY, chopZ)
            cleaverPivot.rotation.set(0, 0.14, bladeRz)
            const inFlight = pulse < 0.96
            flyingMeat.visible = inFlight
            if (inFlight) {
              const u = THREE.MathUtils.clamp(1 - (pulse - 0.02) / 0.94, 0, 1)
              flyingMeat.position.set(
                THREE.MathUtils.lerp(-2.84, -2.68, u),
                1.05 + Math.sin(u * Math.PI) * 0.16,
                THREE.MathUtils.lerp(chopZ, -2.38, u),
              )
              flyingMeat.rotation.y = u * 1.4
            }
          } else if (cMeat.addedMeats.length === 0) {
            // 起帧：高举蓄势待切
            cleaverPivot.position.set(-2.72, 1.135, -2.84)
            cleaverPivot.rotation.set(0, 0.14, -0.44)
            flyingMeat.visible = false
          } else {
            // 收帧：平放砧板前侧空白木面（-PI/2 保证水平侧躺绝不插进砧板）
            cleaverPivot.position.set(-2.74, 1.004, -2.56)
            cleaverPivot.rotation.set(-Math.PI / 2, 0, 0.45)
            flyingMeat.visible = false
          }
        } else {
          cleaverPivot.position.set(-2.74, 1.004, -2.56)
          cleaverPivot.rotation.set(-Math.PI / 2, 0, 0.45)
          flyingMeat.visible = false
        }
        meatWaitBowl.visible = true
        meatBowlNoodles.visible = cBowl.visible && loc === 'meat' && cBowl.hasNoodles
        meatBowlSlices.visible = cBowl.visible && loc === 'meat' && cBowl.meats.length > 0
        setBowlMeatsVisible(meatPieces, cBowl.visible && loc === 'meat' ? cBowl.meats : [])

        // 3) 前台明档：pouring / pourStream / ladleTilt / brineLevel / chiliOil / servePulse / bowl.meats 驱动浇卤与出餐碗
        const atCounter = loc === 'counter' || loc === 'serve' || cCounter.active || activeCooking.stage === 'counter' || activeCooking.stage === 'serving'
        const streamMat = cBowl.brothStyle === 'soup' ? M.boneBroth : cBowl.brothStyle === 'sour_spicy' ? D.sourSoupMat : M.brine
        brineStream.material = streamMat
        counterBrinePool.material = streamMat
        ladleLiquid.material = streamMat
        if (atCounter) {
          const tilt = THREE.MathUtils.clamp(cCounter.ladleTilt, 0, 1)
          const stream = THREE.MathUtils.clamp(cCounter.pourStream, 0, 1)
          const travel = THREE.MathUtils.smoothstep(tilt, 0.04, 0.58)
          const pourRot = THREE.MathUtils.smoothstep(tilt, 0.42, 1.0)
          const scoopDip = cCounter.pouring && tilt < 0.3 ? Math.sin((tilt / 0.3) * Math.PI) * 0.06 : 0
          ladlePivot.position.set(
            THREE.MathUtils.lerp(2.0, 1.72, travel),
            COUNTER_Y + 0.22 - scoopDip + Math.sin(travel * Math.PI * 0.5) * 0.11,
            THREE.MathUtils.lerp(1.48, 1.5, travel),
          )
          ladlePivot.rotation.set(0, 0, THREE.MathUtils.lerp(-0.28, 0.88, pourRot))
          ladleLiquid.visible = tilt > 0.1 && (stream > 0.04 || cCounter.pouring || !cCounter.done)
          brineStream.visible = stream > 0.04
          if (brineStream.visible) {
            brineStream.scale.set(0.6 + stream * 0.42, 0.86 + Math.sin(time * 22) * 0.1, 0.6 + stream * 0.42)
          }
        } else {
          ladlePivot.position.set(2.0, COUNTER_Y + 0.22, 1.48)
          ladlePivot.rotation.set(0, 0, -0.35)
          ladleLiquid.visible = false
          brineStream.visible = false
        }

        const showCounterBowl = cBowl.visible && (loc === 'counter' || loc === 'serve')
        counterServeBowl.visible = showCounterBowl
        if (showCounterBowl) {
          const brineLv = THREE.MathUtils.clamp(cBowl.brineLevel, 0, 1)
          const styleHeadroom = cBowl.brothStyle === 'lucai_dry' ? 0.012 : 0.02
          const sp = THREE.MathUtils.clamp(cCounter.servePulse, 0, 1)
          counterServeBowl.position.set(1.66, COUNTER_Y + 0.05 + Math.sin(sp * Math.PI) * 0.026, 1.5 + sp * 0.07)
          counterServeBowl.scale.setScalar(1 + Math.sin(sp * Math.PI) * 0.045)
          counterBowlNoodles.visible = cBowl.hasNoodles
          counterBrinePool.visible = brineLv > 0.02
          counterBrinePool.position.y = 0.048 + brineLv * styleHeadroom
          counterBrinePool.scale.setScalar(0.35 + brineLv * 0.68)
          counterMeatSlices.visible = cBowl.meats.length > 0
          setBowlMeatsVisible(counterMeatPieces, cBowl.meats)
          const pouredEnough = cCounter.done || activeCooking.stage === 'serving' || brineLv >= 0.42
          counterGarnish.visible = pouredEnough
          counterChiliLayer.visible = pouredEnough && (cBowl.chiliOil || cCounter.chiliOil)
        } else {
          setBowlMeatsVisible(counterMeatPieces, [])
        }
      } else {
        // ─── 原预览钩子/待机兜底分支（无 hardcoded 强行显示锅烧） ───
        potFx.forEach((p, idx) => {
          const activeHero = idx === 0 && legacyStage === 'boil'
          const isBoil = activeHero || ctx.boiling
          const amp = isBoil ? 1 : 0.25
          p.water.position.y = RANGE_TOP + 0.31 + Math.sin(time * 9 + p.phase) * 0.004 * amp
          p.flame.scale.setScalar(1 + Math.sin(time * 17 + p.phase) * 0.04 * amp)
          p.flame.visible = isBoil || Math.sin(time * 0.5 + p.phase) > -0.2
          if (activeHero) {
            if (legacyProg < 0.6) {
              const sub = legacyProg / 0.6
              p.basket.position.set(p.pot.x - 0.03, RANGE_TOP + 0.305 + Math.sin(sub * Math.PI * 6) * 0.022, p.pot.z)
              p.basket.rotation.set(0, Math.sin(sub * Math.PI * 4) * 0.2, 0)
              const swell = 0.85 + sub * 0.26
              p.potNoodles.scale.set(swell, 0.88 + sub * 0.24, swell)
              p.potNoodles.visible = true
              boilBowlNoodles.visible = false
            } else if (legacyProg < 0.86) {
              const sub = (legacyProg - 0.6) / 0.26
              const liftY = RANGE_TOP + 0.44 + Math.sin(sub * Math.PI) * 0.14
              p.basket.position.set(p.pot.x - 0.08, liftY, p.pot.z + 0.04)
              p.basket.rotation.set(0.24 + Math.sin(sub * Math.PI * 6) * 0.08, 0, -0.18 + Math.sin(sub * Math.PI * 4) * 0.05)
              p.potNoodles.scale.setScalar(1.08)
              p.potNoodles.visible = true
              boilBowlNoodles.visible = false
            } else {
              const sub = (legacyProg - 0.86) / 0.14
              applyStrainerPourPose(p, sub)
              boilBowlNoodles.visible = sub >= 0.45
            }
          } else {
            p.basket.position.set(p.pot.x - 0.06, RANGE_TOP + 0.31 + (ctx.boiling ? Math.abs(Math.sin(time * 3.2 + p.phase)) * 0.04 : 0), p.pot.z)
            p.basket.rotation.set(0, ctx.boiling ? Math.sin(time * 1.6 + p.phase) * 0.25 : 0, 0)
            p.potNoodles.scale.setScalar(1)
            p.potNoodles.visible = true
          }
        })
        boilDrops.forEach((d, idx) => {
          const draining = legacyStage === 'boil' && legacyProg >= 0.6 && legacyProg < 0.88
          d.visible = draining
          if (draining) {
            const cycle = (legacyProg * 14 + idx * 0.18) % 1
            d.position.set(
              potFx[0].basket.position.x + ((idx % 3) - 1) * 0.032,
              potFx[0].basket.position.y - 0.055 - cycle * 0.17,
              potFx[0].basket.position.z + (Math.floor(idx / 3) - 0.5) * 0.035,
            )
          }
        })
        if (legacyStage !== 'boil') boilBowlNoodles.visible = legacyStage === 'meat' || legacyStage === 'broth'

        setVariantMapVisible(cutSlabByMeat, 'guoshao')
        setVariantMapVisible(flyByMeat, 'guoshao')
        if (legacyStage === 'meat') {
          if (legacyProg < 0.72) {
            const chopCycle = (legacyProg / 0.72) * 5
            const chopFrac = chopCycle - Math.floor(chopCycle)
            const strike = Math.abs(Math.sin(chopFrac * Math.PI))
            cleaverPivot.position.set(-2.72, 1.036 + strike * 0.095, -2.86 + (chopCycle / 5) * 0.14)
            cleaverPivot.rotation.set(0, 0.15, -strike * 0.54)
            flyingMeat.visible = false
          } else {
            const sub = (legacyProg - 0.72) / 0.28
            cleaverPivot.position.set(-2.72, 1.045 - sub * 0.015, -2.74)
            cleaverPivot.rotation.set(0, 0.15, -0.08)
            flyingMeat.visible = sub < 0.82
            flyingMeat.position.set(THREE.MathUtils.lerp(-2.86, -2.68, sub), 1.02 + Math.sin(sub * Math.PI) * 0.14, THREE.MathUtils.lerp(-2.78, -2.38, sub))
          }
          meatBowlNoodles.visible = true
          meatBowlSlices.visible = legacyProg >= 0.35
        } else {
          cleaverPivot.position.set(-2.74, 1.004, -2.56)
          cleaverPivot.rotation.set(-Math.PI / 2, 0, 0.45)
          flyingMeat.visible = false
          meatBowlNoodles.visible = legacyStage === 'broth' || legacyStage === 'done'
          meatBowlSlices.visible = legacyStage === 'broth' || legacyStage === 'done'
        }
        setBowlMeatsVisible(meatPieces, fallbackMeats)

        brineStream.material = M.brine
        counterBrinePool.material = M.brine
        ladleLiquid.material = M.brine
        if (legacyStage === 'broth' || legacyStage === 'done') {
          const bProg = legacyStage === 'done' ? 0.95 : legacyProg
          if (bProg < 0.28) {
            const s = bProg / 0.28
            ladlePivot.position.set(2.0, COUNTER_Y + 0.22 - Math.sin(s * Math.PI) * 0.08, 1.48)
            ladlePivot.rotation.set(0, 0, -0.25)
            ladleLiquid.visible = s > 0.55
            brineStream.visible = false
          } else if (bProg < 0.46) {
            const s = (bProg - 0.28) / 0.18
            ladlePivot.position.set(THREE.MathUtils.lerp(2.0, 1.72, s), COUNTER_Y + 0.22 + Math.sin(s * Math.PI) * 0.14, THREE.MathUtils.lerp(1.48, 1.5, s))
            ladlePivot.rotation.set(0, 0, THREE.MathUtils.lerp(-0.25, 0.05, s))
            ladleLiquid.visible = true
            brineStream.visible = false
          } else if (bProg < 0.82) {
            const s = (bProg - 0.46) / 0.36
            ladlePivot.position.set(1.72, COUNTER_Y + 0.33, 1.5)
            ladlePivot.rotation.set(0, 0, Math.sin(Math.min(1, s * 1.4) * Math.PI * 0.5) * 0.88)
            ladleLiquid.visible = s < 0.75
            brineStream.visible = true
            brineStream.scale.set(1, 0.85 + Math.sin(time * 18) * 0.12, 1)
          } else {
            const s = (bProg - 0.82) / 0.18
            ladlePivot.position.set(THREE.MathUtils.lerp(1.72, 2.0, s), COUNTER_Y + 0.22 + (1 - s) * 0.08, THREE.MathUtils.lerp(1.5, 1.48, s))
            ladlePivot.rotation.set(0, 0, THREE.MathUtils.lerp(0.5, -0.25, s))
            ladleLiquid.visible = false
            brineStream.visible = false
          }
          const pourFill = THREE.MathUtils.clamp((bProg - 0.46) / 0.36, 0, 1)
          counterServeBowl.visible = true
          counterServeBowl.position.set(1.66, COUNTER_Y + 0.05, 1.5)
          counterServeBowl.scale.setScalar(1)
          counterBowlNoodles.visible = true
          counterBrinePool.visible = pourFill > 0.02
          counterBrinePool.position.y = 0.048 + pourFill * 0.012
          counterBrinePool.scale.setScalar(0.35 + pourFill * 0.65)
          counterMeatSlices.visible = fallbackMeats.length > 0
          counterGarnish.visible = bProg >= 0.75
          counterChiliLayer.visible = legacyStage === 'done'
        } else {
          ladlePivot.position.set(2.0, COUNTER_Y + 0.22, 1.48)
          ladlePivot.rotation.set(0, 0, -0.35)
          ladleLiquid.visible = false
          brineStream.visible = false
          counterServeBowl.visible = false
          counterChiliLayer.visible = false
        }
        setBowlMeatsVisible(counterMeatPieces, fallbackMeats)
      }

      if (fan) fan.rotation.y += dt * 4.2
      lanterns.forEach((l, i) => (l.rotation.z = Math.sin(time * 1.3 + i) * 0.05))
      const indoor = ctx.indoor ?? (typeof document !== 'undefined' && document.body?.dataset.mifenIndoor === '1')
      applyCut(evalCutaway(indoor, ctx.cameraPos))
      // 后厨动态厨具（煮锅水/火/笊篱/菜刀/砧板肉/淋卤勺）仅进店或距店 <10m 或正在做粉时渲染，街面外省 ~12 draws
      const kitchenActive = indoor || Boolean(ctx.boiling) || Boolean(activeCooking && activeCooking.stage !== 'idle')
      const showKitchenDyn = kitchenActive || (ctx.cameraPos ? ctx.cameraPos.distanceTo(group.position) < 10 : true)
      for (const p of potFx) {
        p.water.visible = showKitchenDyn
        p.flame.visible = showKitchenDyn && p.flame.visible
        p.basket.visible = showKitchenDyn
      }
      boilWaitBowl.visible = showKitchenDyn
      cleaverPivot.visible = showKitchenDyn
      cutSlab.visible = showKitchenDyn
      meatWaitBowl.visible = showKitchenDyn
      ladlePivot.visible = showKitchenDyn
    },

    setCutaway(mode: ShopCutawayMode) {
      cutMode = mode
      if (mode !== 'auto') applyCut(mode)
    },

    isCutaway: () => cut,

    setDetailVisible(visible: boolean) {
      dynamic.visible = visible
      interior.visible = visible
      if (fan) fan.visible = visible
    },

    updateNight(night: number, time = 0) {
      if (disposed) return
      const n = THREE.MathUtils.clamp(night, 0, 1)
      M.updateNight(n, false, time)
      D.nightSpill.opacity = n * 0.2
    },

    dispose() {
      if (disposed) return
      disposed = true
      const gbl = globalThis as Record<string, unknown>
      if (gbl.__mifenShopAnimPreview === setAnimPreview) delete gbl.__mifenShopAnimPreview
      const owned = new Set(ownGeos)
      group.traverse(o => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh && mesh.geometry && !owned.has(mesh.geometry)) mesh.geometry.dispose()
      })
      for (const g of ownGeos) g.dispose()
      D.dispose()
      group.clear()
      releaseTianyuanMaterials()
    },
  }
}

// ───────────────────────────── 成品碗 ─────────────────────────────

/**
 * 成品桂林米粉：白瓷蓝边碗、圆粉堆、卤水 / 汤底和码料。直径约 0.2m，原点在碗底。
 * 每只碗自带几何与材质，调用方可整体 dispose。
 */
export function createMifenBowlMesh(opts: MifenBowlOptions = {}): THREE.Group {
  const m = createBowlMaterialSet()
  const b = new Batch()
  let seed = 7
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }

  const profile: V2[] = [
    [0, 0.002],
    [0.042, 0.002],
    [0.048, 0.008],
    [0.052, 0.014],
    [0.08, 0.046],
    [0.096, 0.071],
    [0.1, 0.078],
    [0.096, 0.08],
    [0.09, 0.074],
    [0.072, 0.05],
    [0.046, 0.019],
    [0, 0.017],
  ]
  b.add(m.ceramic, new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 28))
  b.torus(m.rim, 0, 0.0785, 0, 0.098, 0.0035, 32)

  const style = opts.brothStyle ?? 'lucai_dry'
  const liquid = style === 'soup' ? m.soup : style === 'sour_spicy' ? m.sourSoup : m.brine
  const liquidY = style === 'lucai_dry' ? 0.032 : 0.06
  const liquidR = style === 'lucai_dry' ? 0.058 : 0.086
  b.add(liquid, new THREE.CircleGeometry(liquidR, 24), 0, liquidY, 0, 0, -Math.PI / 2)

  const bed = new THREE.SphereGeometry(0.068, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2)
  bed.scale(1, 0.24, 1)
  b.add(m.noodle, bed, 0, 0.028, 0)
  // 14 条独立盘绕丝滑圆米粉（清晰看得出成束盘绕米粉条形，取代单一光面圆丘）
  addNoodleCoil(b, m.noodle, 0, 0.044, 0, 0.068, 0.0046, 12, 9, 0.022, 19)

  const slices = (mat: THREE.Material, n: number, cx: number, cz: number, w: number, d: number, h: number) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 0.9 - 0.45
      b.box(mat, cx + Math.sin(a) * 0.02 + k * 0.004, 0.062 + k * 0.004, cz + k * 0.012, w, h, d, a + 0.4, 0.25)
    }
  }
  // 严格按 opts.has* 围绕五点位不重叠排布，素粉/单肉/多肉 1:1 对齐
  if (opts.hasCharsiu) slices(m.charsiu, 3, 0.036, -0.034, 0.042, 0.024, 0.008)
  if (opts.hasGuoshao) {
    slices(m.guoshao, 3, -0.042, -0.024, 0.046, 0.028, 0.009)
    slices(m.noodle, 2, -0.042, -0.024, 0.042, 0.024, 0.005)
  }
  if (opts.hasBeef) {
    for (let k = 0; k < 4; k++) {
      b.cyl(m.beef, 0.03 + (k % 2) * 0.018, 0.067 + k * 0.0025, 0.02 + k * 0.009, 0.023, 0.023, 0.005, 8, false, k * 0.35, 0.22)
    }
  }
  if (opts.hasEgg) {
    b.sphere(m.egg, -0.042, 0.067, 0.03, 0.021, 1, 0.72, 1.25, 12)
    b.cyl(m.noodle, -0.042, 0.079, 0.03, 0.018, 0.018, 0.004, 10)
    b.add(m.yolk, new THREE.CircleGeometry(0.0105, 12), -0.042, 0.0838, 0.03, 0, -Math.PI / 2)
  }
  if (opts.hasYoutiao) {
    for (let k = 0; k < 2; k++) {
      const oy = 0.075 + k * 0.008
      b.cyl(m.youtiao, -0.006 + k * 0.016, oy, -0.056 + k * 0.008, 0.0075, 0.0075, 0.054, 7, false, 0.32, 0, Math.PI / 2 - 0.14)
      b.cyl(m.youtiao, -0.006 + k * 0.016, oy, -0.044 + k * 0.008, 0.0075, 0.0075, 0.054, 7, false, 0.32, 0, Math.PI / 2 - 0.14)
    }
  }
  for (let k = 0; k < 7; k++) b.sphere(m.peanut, (rnd() - 0.5) * 0.085, 0.074, (rnd() - 0.5) * 0.085, 0.0072, 1, 0.78, 1.38, 6)
  if (opts.hasToppings) {
    const scRing = new THREE.TorusGeometry(0.0065, 0.0022, 3, 6)
    for (let k = 0; k < 8; k++) b.add(m.scallion, scRing.clone(), (rnd() - 0.5) * 0.095, 0.072, (rnd() - 0.5) * 0.095, rnd() * 3, Math.PI / 2 + (rnd() - 0.5) * 0.6)
    scRing.dispose()
    for (let k = 0; k < 6; k++) b.box(m.chili, (rnd() - 0.5) * 0.09, 0.071, (rnd() - 0.5) * 0.09, 0.01, 0.004, 0.006, rnd() * 3)
    for (let k = 0; k < 6; k++) b.cyl(m.sourBean, (rnd() - 0.5) * 0.09, 0.071, (rnd() - 0.5) * 0.09, 0.0032, 0.0032, 0.016, 5, false, rnd() * 3, Math.PI / 2)
  }

  const g = named(new THREE.Group(), 'tianyuan_bowl')
  b.flush(g, 'tianyuan_bowl')
  g.userData.kind = 'mifen-bowl'
  return g
}
