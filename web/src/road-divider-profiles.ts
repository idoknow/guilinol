import * as THREE from 'three'
import {mergeCollinearChainLegs, sampleChainAt, traceDividerChains, type DividerChain, type DividerSegmentInput} from './median-rails.ts'
import {sampleDividerSpanGrade} from './roadbed-clearance.ts'
import {isShizijieDecorSuppressed} from './shizijie-zone.ts'

export type MedianDividerKind = 'median_metal_rail' | 'median_green_trees'
export type VergeDividerKind = 'hedge_curb' | 'metal_guardrail' | 'tree_planter' | 'soft_delineator' | 'marking_only'
export type RoadDividerKind = MedianDividerKind | VergeDividerKind

// Optional forward-compatible offline decor kind codes (pipeline/streets.py incremental extension):
// Legacy baked kinds remain 1/2 (central rail/banner), 5/6 (right/left verge), 7 (planted median), 8 (stone-pillar fence).
export const DECOR_KIND_MEDIAN_GREEN_TREES = 12
export const DECOR_KIND_VERGE_METAL_RAIL = 13
export const DECOR_KIND_VERGE_TREE_PLANTER = 14
export const DECOR_KIND_VERGE_SOFT_DELINEATOR = 15

export interface DividerCorridor {
  id: string
  name: string
  /** World XZ polyline [[x0, z0], [x1, z1], ...] in metres (origin 25.280°N, 110.300°E). */
  polyline: readonly (readonly [number, number])[]
  /** Half-width of matching corridor around the polyline (metres). */
  halfWidth: number
  median: MedianDividerKind
  verge: VergeDividerKind
  /** Priority for overlapping junction approaches (higher wins). */
  priority?: number
}

/**
 * Guilin arterial & key collector divider zoning table calibrated from `atlas.bin` road polylines
 * and Guilin streetscape reality (absorbs & upgrades IDOK-287 + IDOK-538).
 */
export const GUILIN_DIVIDER_CORRIDORS: readonly DividerCorridor[] = [
  // ---- 中山路主轴（北→中→南）：景观林荫紫薇大道 + 火车站集散金属护栏段 ----
  {
    id: 'zhongshan_middle_north',
    name: '中山中路（凤北路—十字街北）',
    polyline: [[-646, -881], [-715, -855], [-759, -816], [-829, -393], [-876, -159]],
    halfWidth: 34,
    median: 'median_green_trees',
    verge: 'tree_planter',
    priority: 10,
  },
  {
    id: 'zhongshan_middle_south',
    name: '中山中路（十字街南—阳桥—南门桥）',
    polyline: [[-893, -112], [-1018, 248], [-1078, 365], [-1246, 547], [-1594, 891]],
    halfWidth: 34,
    median: 'median_green_trees',
    verge: 'tree_planter',
    priority: 10,
  },
  {
    id: 'zhongshan_north',
    name: '中山北路',
    polyline: [[-638, -874], [-540, -1100], [-634, -1420], [-722, -1868], [-487, -2432]],
    halfWidth: 34,
    median: 'median_green_trees',
    verge: 'tree_planter',
    priority: 9,
  },
  {
    id: 'zhongshan_south_station',
    name: '中山南路（南门桥—桂林站—上海路口）',
    polyline: [[-1594, 891], [-1724, 1000], [-1920, 1450], [-2062, 1775], [-2065, 1980]],
    halfWidth: 36,
    median: 'median_metal_rail',
    verge: 'metal_guardrail',
    priority: 9,
  },
  {
    id: 'zhongshan_south_ext',
    name: '中山南路（上海路以南绿化段）',
    polyline: [[-2065, 1980], [-2078, 2155], [-2088, 2432], [-2089, 3100]],
    halfWidth: 36,
    median: 'median_green_trees',
    verge: 'hedge_curb',
    priority: 8,
  },

  // ---- 解放东西路主轴：解放桥连接商业段用白灰护栏，西段衔接既有中央绿化带 ----
  {
    id: 'jiefang_east',
    name: '解放东路（十字街—解放桥头）',
    polyline: [[-872, -168], [-509, -75], [-299, -5]],
    halfWidth: 32,
    median: 'median_metal_rail',
    verge: 'metal_guardrail',
    priority: 11,
  },
  {
    id: 'jiefang_west_east',
    name: '解放西路东段（十字街—翊武路）',
    polyline: [[-887, -171], [-940, -178], [-1260, -242]],
    halfWidth: 30,
    median: 'median_metal_rail',
    verge: 'metal_guardrail',
    priority: 10,
  },
  {
    id: 'jiefang_west_green',
    name: '解放西路西段（中央绿化带衔接段）',
    polyline: [[-1260, -242], [-1394, -296], [-1468, -338]],
    halfWidth: 32,
    median: 'median_green_trees',
    verge: 'hedge_curb',
    priority: 10,
  },

  // ---- 漓江路 / 上海路 东西向大动脉 ----
  {
    id: 'lijiang_rd',
    name: '漓江路（穿山桥—三里店—甲天下广场）',
    polyline: [[-427, 1905], [150, 1905], [704, 1905], [1207, 1898]],
    halfWidth: 36,
    median: 'median_green_trees',
    verge: 'hedge_curb',
    priority: 9,
  },
  {
    id: 'shanghai_rd_east',
    name: '上海路（漓江桥西—立交段）',
    polyline: [[-1500, 1922], [-1150, 1922], [-722, 1920]],
    halfWidth: 34,
    median: 'median_metal_rail',
    verge: 'metal_guardrail',
    priority: 9,
  },
  {
    id: 'shanghai_rd_west',
    name: '上海路西段',
    polyline: [[-2210, 1926], [-1500, 1922]],
    halfWidth: 34,
    median: 'median_metal_rail',
    verge: 'hedge_curb',
    priority: 8,
  },

  // ---- 河东片区主干：龙隐路林荫、七星路护栏/绿篱分段、穿山路南北分型 ----
  {
    id: 'longyin_rd',
    name: '龙隐路（七星公园林荫道）',
    polyline: [[40, 724], [95, 735], [664, 939], [705, 957]],
    halfWidth: 30,
    median: 'median_green_trees',
    verge: 'tree_planter',
    priority: 10,
  },
  {
    id: 'qixing_rd_nw',
    name: '七星路（穿山桥—三里店）',
    polyline: [[98, 731], [420, 845], [720, 965]],
    halfWidth: 28,
    median: 'median_metal_rail',
    verge: 'metal_guardrail',
    priority: 8,
  },
  {
    id: 'qixing_rd_se',
    name: '七星路（三里店往东南）',
    polyline: [[720, 965], [846, 1142], [1207, 1538]],
    halfWidth: 32,
    median: 'median_metal_rail',
    verge: 'hedge_curb',
    priority: 8,
  },
  {
    id: 'chuanshan_rd_north',
    name: '穿山路北段（自由路—穿山桥）',
    polyline: [[161, 144], [-42, 565], [-72, 707]],
    halfWidth: 28,
    median: 'median_metal_rail',
    verge: 'metal_guardrail',
    priority: 9,
  },
  {
    id: 'chuanshan_rd_south',
    name: '穿山路南段（穿山公园—漓江路）',
    polyline: [[-72, 707], [-336, 1324], [-313, 1711], [-134, 2505]],
    halfWidth: 34,
    median: 'median_green_trees',
    verge: 'hedge_curb',
    priority: 8,
  },

  // ---- 城市环线与河东绿化干道：草丛灌木绿篱 + 路缘石 ----
  {
    id: 'huancheng_north_1',
    name: '环城北一路',
    polyline: [[-1718, -1738], [-1613, -1896], [-1320, -2182], [-1150, -2330]],
    halfWidth: 38,
    median: 'median_green_trees',
    verge: 'hedge_curb',
    priority: 8,
  },
  {
    id: 'huancheng_north_2',
    name: '环城北二路',
    polyline: [[256, -2216], [643, -1741], [1204, -1212]],
    halfWidth: 38,
    median: 'median_green_trees',
    verge: 'hedge_curb',
    priority: 8,
  },
  {
    id: 'huancheng_west_2',
    name: '环城西二路',
    polyline: [[-1825, -1525], [-1980, -1240], [-2102, -980], [-2129, -363], [-2214, -167]],
    halfWidth: 38,
    median: 'median_green_trees',
    verge: 'hedge_curb',
    priority: 8,
  },
  {
    id: 'qixia_rd',
    name: '栖霞路',
    polyline: [[64, -113], [124, -76], [258, -23], [471, -3]],
    halfWidth: 28,
    median: 'median_green_trees',
    verge: 'hedge_curb',
    priority: 8,
  },
  {
    id: 'fangxiang_rd',
    name: '芳香路',
    polyline: [[789, 60], [1174, 143], [1207, 153]],
    halfWidth: 28,
    median: 'median_green_trees',
    verge: 'hedge_curb',
    priority: 8,
  },

  // ---- 桥头集散与老城主干：白灰金属护栏 ----
  {
    id: 'liuhe_rd',
    name: '六合路',
    polyline: [[534, 5], [662, 28], [792, 60], [1005, 36], [1207, -105]],
    halfWidth: 28,
    median: 'median_metal_rail',
    verge: 'metal_guardrail',
    priority: 8,
  },
  {
    id: 'ziyou_dongjiang',
    name: '自由路—东江二路',
    polyline: [[-34, 85], [162, 149], [256, -30]],
    halfWidth: 28,
    median: 'median_metal_rail',
    verge: 'metal_guardrail',
    priority: 9,
  },
  {
    id: 'xifeng_rd',
    name: '西凤路',
    polyline: [[-1549, -403], [-1576, -445], [-1645, -582], [-2105, -683]],
    halfWidth: 28,
    median: 'median_metal_rail',
    verge: 'metal_guardrail',
    priority: 8,
  },
  {
    id: 'lijun_rd',
    name: '丽君路',
    polyline: [[-1540, -166], [-1658, -202], [-2009, -276], [-2118, -285]],
    halfWidth: 28,
    median: 'median_metal_rail',
    verge: 'metal_guardrail',
    priority: 8,
  },
  {
    id: 'yiwu_rd',
    name: '翊武路（桂湖/榕湖林荫段）',
    polyline: [[-1561, 69], [-1513, -162], [-1404, -411]],
    halfWidth: 24,
    median: 'median_metal_rail',
    verge: 'tree_planter',
    priority: 9,
  },

  // ---- 老城窄支路/巷道：软隔离不硬塞护栏卡死通行（半宽紧凑 + 低于主干道优先级，绝不误伤邻近主干道） ----
  {
    id: 'narrow_oldtown_taiping',
    name: '太平路窄支路软隔离段',
    polyline: [[-1130, -230], [-1095, -228]],
    halfWidth: 8,
    median: 'median_metal_rail',
    verge: 'soft_delineator',
    priority: 7,
  },
  {
    id: 'narrow_oldtown_xinyi',
    name: '信义路窄支路衔接段',
    polyline: [[-1735, -655], [-1700, -595]],
    halfWidth: 8,
    median: 'median_metal_rail',
    verge: 'soft_delineator',
    priority: 7,
  },
  {
    id: 'narrow_oldtown_wenhuagong',
    name: '文化宫路窄支路软隔离段',
    polyline: [[-792, -135], [-772, -126]],
    halfWidth: 8,
    median: 'median_metal_rail',
    verge: 'soft_delineator',
    priority: 7,
  },
  {
    id: 'narrow_oldtown_liumashan',
    name: '骝马山南里 / 丽中路窄路软隔离段',
    polyline: [[-1685, -628], [-1560, -455]],
    halfWidth: 8,
    median: 'median_metal_rail',
    verge: 'soft_delineator',
    priority: 7,
  },
]

// Precomputed bounding boxes for fast rejection per corridor.
const CORRIDOR_BOUNDS = GUILIN_DIVIDER_CORRIDORS.map(c => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, z] of c.polyline) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return {
    minX: minX - c.halfWidth,
    maxX: maxX + c.halfWidth,
    minZ: minZ - c.halfWidth,
    maxZ: maxZ + c.halfWidth,
  }
})

// Hand-authored `zhongshan_road.glb` central median centerline (z in [-74, 296]) to prevent double-modeling.
const ZHONGSHAN_LM_CENTER: readonly (readonly [number, number])[] = [
  [-901, -76], [-955, 76], [-1008, 250], [-1032, 300],
]

function distToPolyline(
  x: number,
  z: number,
  poly: readonly (readonly [number, number])[],
): {dist: number; tx: number; tz: number} {
  let bestSq = Infinity
  let bestTx = 1
  let bestTz = 0
  for (let i = 1; i < poly.length; i++) {
    const ax = poly[i - 1][0], az = poly[i - 1][1]
    const bx = poly[i][0], bz = poly[i][1]
    const dx = bx - ax, dz = bz - az
    const lenSq = dx * dx + dz * dz
    if (lenSq < 1e-6) continue
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lenSq))
    const px = ax + dx * t, pz = az + dz * t
    const dSq = (x - px) * (x - px) + (z - pz) * (z - pz)
    if (dSq < bestSq) {
      bestSq = dSq
      const len = Math.sqrt(lenSq)
      bestTx = dx / len
      bestTz = dz / len
    }
  }
  return {dist: Math.sqrt(bestSq), tx: bestTx, tz: bestTz}
}

/**
 * Suppresses redundant procedural central median decor directly overlapping the hand-modeled
 * `zhongshan_road.glb` central green hedge (z in [-74, 296]), while preserving outside approaches
 * and cross-street dividers.
 */
export function isZhongshanLandmarkMedianSuppressed(worldX: number, worldZ: number, rawKind: number): boolean {
  if (rawKind !== 1 && rawKind !== 2 && rawKind !== 7 && rawKind !== DECOR_KIND_MEDIAN_GREEN_TREES) return false
  if (worldX < -1060 || worldX > -885 || worldZ < -74 || worldZ > 296) return false
  const {dist} = distToPolyline(worldX, worldZ, ZHONGSHAN_LM_CENTER)
  return dist <= 6.5
}

/**
 * Matches a world XZ coordinate (and optional decor heading in radians, where tangent = (cos h, sin h))
 * against the Guilin road divider corridor table. Enforces tangent alignment at junctions so
 * cross streets never inherit an orthogonal arterial's divider profile.
 */
export function matchDividerCorridor(
  worldX: number,
  worldZ: number,
  headingRad?: number,
): DividerCorridor | null {
  let best: DividerCorridor | null = null
  let bestScore = Infinity
  const hasHeading = headingRad !== undefined && Number.isFinite(headingRad)
  const ux = hasHeading ? Math.cos(headingRad) : 0
  const uz = hasHeading ? Math.sin(headingRad) : 0

  for (let i = 0; i < GUILIN_DIVIDER_CORRIDORS.length; i++) {
    const b = CORRIDOR_BOUNDS[i]
    if (worldX < b.minX || worldX > b.maxX || worldZ < b.minZ || worldZ > b.maxZ) continue
    const c = GUILIN_DIVIDER_CORRIDORS[i]
    const {dist, tx, tz} = distToPolyline(worldX, worldZ, c.polyline)
    if (dist > c.halfWidth) continue
    if (hasHeading) {
      const align = Math.abs(ux * tx + uz * tz)
      if (align < 0.55) continue
    }
    const prio = c.priority ?? 8
    const score = dist - prio * 1.6
    if (score < bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

export function resolveMedianDividerKind(
  worldX: number,
  worldZ: number,
  rawKind: number,
  headingRad?: number,
): MedianDividerKind {
  if (rawKind === 7 || rawKind === DECOR_KIND_MEDIAN_GREEN_TREES) return 'median_green_trees'
  const corridor = matchDividerCorridor(worldX, worldZ, headingRad)
  return corridor ? corridor.median : 'median_metal_rail'
}

export function resolveVergeDividerKind(
  worldX: number,
  worldZ: number,
  rawKind: number,
  headingRad?: number,
): VergeDividerKind {
  if (rawKind === DECOR_KIND_VERGE_METAL_RAIL) return 'metal_guardrail'
  if (rawKind === DECOR_KIND_VERGE_TREE_PLANTER) return 'tree_planter'
  if (rawKind === DECOR_KIND_VERGE_SOFT_DELINEATOR) return 'soft_delineator'
  const corridor = matchDividerCorridor(worldX, worldZ, headingRad)
  return corridor ? corridor.verge : 'hedge_curb'
}

// ============================================================================
// Three-band Street Divider Instanced Geometry Builder (0 extra draw calls)
// ============================================================================

export type BoxEmitter = (
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  yaw?: number,
  tint?: THREE.Color,
  pitch?: number,
) => void

export interface DividerPalette {
  railing: THREE.Color
  stoneLight: THREE.Color
  stoneMid: THREE.Color
  bannerRed: THREE.Color
  hedge: THREE.Color
  iron: THREE.Color
}

// Calibrated to docs/style.md Phase 2 (gradeDay saturation 1.22, contrast 1.12).
// All dimensions strictly avoid:
// - streets.ts uSlogan magic sizes (w=1.35 && h=0.42; w=0.08 && h=0.55) except intentional banners
// - batch.ts isProceduralShopBox magic sizes (h~0.12 & d~1.1; h~0.53 & d~0.12; h~2.32 & d~0.06; h~0.035 & d~0.03)
const PAL = {
  curbLight: new THREE.Color(0xa9a69d),
  curbMid: new THREE.Color(0x8a8880),
  soil: new THREE.Color(0x4e4437),
  railWhite: new THREE.Color(0xe4e3dd),
  railSilver: new THREE.Color(0xc2c6ca),
  railBase: new THREE.Color(0x3a4044),
  guilinJade: new THREE.Color(0x36796b),
  hedgeDark: new THREE.Color(0x2f532e),
  hedgeMid: new THREE.Color(0x446d3a),
  hedgeLit: new THREE.Color(0x5c8444),
  shrubCrimson: new THREE.Color(0x703943),
  crapeDark: new THREE.Color(0xa93e64),
  crapeLit: new THREE.Color(0xcf5f87),
  planterWood: new THREE.Color(0x6f4433),
  planterTrim: new THREE.Color(0x383c40),
  trunkLime: new THREE.Color(0xdcd9cf),
  trunkBark: new THREE.Color(0x544538),
  warnYellow: new THREE.Color(0xe5b126),
  warnDark: new THREE.Color(0x2c3034),
  softOrange: new THREE.Color(0xd95626),
  softWhite: new THREE.Color(0xf1f0ea),
} as const

function hash2d(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/** Emits a high-visibility yellow/black bollard + tapered end cap at a real street opening (crosswalk / U-turn / junction). */
function emitOpeningEndCap(
  x: number,
  z: number,
  tx: number,
  tz: number,
  yaw: number,
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
  style: 'rail' | 'green' | 'verge',
  inwardSign: number,
) {
  // Tuck end-cap slightly inward (+inwardSign * 0.08 m) so it never protrudes into crosswalk openings.
  const px = x + tx * inwardSign * 0.08
  const pz = z + tz * inwardSign * 0.08
  const y = baseLevel(px, pz) + 0.045
  if (style === 'rail') {
    box(px, y + 0.05, pz, 0.22, 0.16, 0.20, yaw, PAL.railBase)
    box(px, y + 0.42, pz, 0.11, 0.62, 0.11, yaw, PAL.warnYellow)
    box(px, y + 0.56, pz, 0.115, 0.14, 0.115, yaw, PAL.warnDark)
    box(px, y + 0.78, pz, 0.115, 0.12, 0.115, yaw, PAL.warnDark)
    box(px, y + 0.90, pz, 0.13, 0.08, 0.13, yaw, PAL.railWhite)
  } else if (style === 'green') {
    // Granite nose stone + compact reflective warning post
    box(px, y + 0.08, pz, 0.34, 0.22, 0.78, yaw, PAL.curbLight)
    box(px, y + 0.36, pz, 0.09, 0.42, 0.09, yaw, PAL.warnYellow)
    box(px, y + 0.52, pz, 0.095, 0.09, 0.095, yaw, PAL.warnDark)
  } else {
    // Verge granite nose block + sleek reflective delineator
    box(px, y + 0.08, pz, 0.32, 0.22, 1.04, yaw, PAL.curbLight)
    box(px, y + 0.44, pz, 0.095, 0.56, 0.095, yaw, PAL.railWhite)
    box(px, y + 0.66, pz, 0.10, 0.10, 0.10, yaw, PAL.warnYellow)
  }
}

/** Emits a compact low-poly ornamental crape-myrtle / osmanthus median tree with >= 2.2 m clear trunk height. */
function emitOrnamentalTree(
  x: number,
  z: number,
  yaw: number,
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
  seed: number,
  withCrapeBlossom: boolean,
  crownScale = 1.0,
) {
  const y = baseLevel(x, z) + 0.195
  // Lower whitewashed trunk + upper bark trunk (split heights stay clear of batch.ts shop-shutter detector)
  box(x, y + 0.52, z, 0.17, 1.12, 0.17, yaw, PAL.trunkLime)
  box(x, y + 1.62, z, 0.15, 1.16, 0.15, yaw, PAL.trunkBark)
  // Two-tier stylized low-poly canopy starting well above car/e-bike clearance (y >= 2.20 m), vertically separated to avoid z-fighting
  const w1 = (1.32 + (seed % 0.22)) * crownScale
  const h1 = (0.64 + (seed % 0.12)) * crownScale
  const d1 = (1.14 + ((seed * 3) % 0.18)) * crownScale
  const rot1 = yaw + (seed - 0.5) * 0.45
  box(x, y + 2.48, z, w1, h1, d1, rot1, PAL.hedgeDark)
  const h2 = h1 * 0.78
  const topBaseY = y + 2.48 + h1 * 0.46
  box(x, topBaseY + h2 * 0.5, z, w1 * 0.72, h2, d1 * 0.72, rot1 + 0.52, withCrapeBlossom ? PAL.crapeLit : PAL.hedgeLit)
  if (withCrapeBlossom) {
    // Nested upper blossom crown tuft seated cleanly atop the green tier (no coplanar overhang artifacts)
    box(x, topBaseY + h2 + 0.12 * crownScale, z, w1 * 0.44, 0.30 * crownScale, d1 * 0.44, rot1 + 0.25, PAL.crapeDark)
  }
}

function emitMedianMetalRailChain(
  chain: DividerChain,
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
  palette: DividerPalette,
) {
  const mergedLegs = mergeCollinearChainLegs(chain.legs, baseLevel, 12)
  for (const leg of mergedLegs) {
    const g = sampleDividerSpanGrade(leg.start.x, leg.start.z, leg.end.x, leg.end.z, baseLevel, 0.195)
    if (g.flatLength < 0.05) continue
    // Top white beam + lower silver beam (merged across straight spans up to 12 m)
    box(g.midX, g.midY + 0.88, g.midZ, g.slopeLength, 0.085, 0.075, g.yaw, PAL.railWhite, g.pitch)
    box(g.midX, g.midY + 0.26, g.midZ, g.slopeLength, 0.065, 0.075, g.yaw, PAL.railSilver, g.pitch)
    // Preserve exact 1.35 x 0.42 slogan banner geometry for streets.ts uSlogan shader!
    if (leg.banner && g.flatLength >= 1.2) {
      box(g.midX, g.midY + 0.58, g.midZ, Math.min(1.35, g.slopeLength), 0.42, 0.09, g.yaw, palette.bannerRed, g.pitch)
    }
  }
  // Posts + alternating airy vertical pickets along continuous chainage (main post every 2.2 m, picket at midpoint)
  const bayCount = Math.max(1, Math.round(chain.totalLength / 2.2))
  const postStep = chain.totalLength / bayCount
  for (let i = 0; i < bayCount; i++) {
    const midS = (i + 0.5) * postStep
    const pm = sampleChainAt(chain, midS)
    const ym = baseLevel(pm.x, pm.z) + 0.195
    box(pm.x, ym + 0.57, pm.z, 0.036, 0.58, 0.036, pm.yaw, PAL.railSilver)
    if (i > 0) {
      const p = sampleChainAt(chain, i * postStep)
      const y = baseLevel(p.x, p.z) + 0.045
      box(p.x, y + 0.04, p.z, 0.14, 0.15, 0.16, p.yaw, PAL.railBase)
      box(p.x, y + 0.62, p.z, 0.062, 0.94, 0.062, p.yaw, PAL.railWhite)
    }
  }
  // End-cap treatments at real street openings vs plain terminal posts at tile borders
  const first = sampleChainAt(chain, 0)
  const last = sampleChainAt(chain, chain.totalLength)
  if (chain.startOpen) {
    emitOpeningEndCap(first.x, first.z, first.tx, first.tz, first.yaw, baseLevel, box, 'rail', 1)
  } else {
    const y = baseLevel(first.x, first.z) + 0.045
    box(first.x, y + 0.62, first.z, 0.062, 0.94, 0.062, first.yaw, PAL.railWhite)
  }
  if (!chain.closed) {
    if (chain.endOpen) {
      emitOpeningEndCap(last.x, last.z, last.tx, last.tz, last.yaw, baseLevel, box, 'rail', -1)
    } else {
      const y = baseLevel(last.x, last.z) + 0.045
      box(last.x, y + 0.62, last.z, 0.062, 0.94, 0.062, last.yaw, PAL.railWhite)
    }
  }
}

function emitMedianGreenTreesChain(
  chain: DividerChain,
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
  origin?: readonly [number, number],
) {
  const ox = origin?.[0] ?? 0
  const oz = origin?.[1] ?? 0
  // Merge collinear curbs & base evergreen hedge up to 12 m to keep draw instances lean
  const mergedLegs = mergeCollinearChainLegs(chain.legs, baseLevel, 12)
  for (const leg of mergedLegs) {
    const g = sampleDividerSpanGrade(leg.start.x, leg.start.z, leg.end.x, leg.end.z, baseLevel, 0.045)
    if (g.flatLength < 0.08) continue
    // Granite planter curb (0.76 m wide, grounded with skirt embedDepth so graded stretches never float)
    const curbH = 0.24 + g.embedDepth
    box(g.midX, g.midY + 0.24 - curbH * 0.5, g.midZ, g.slopeLength + 0.04, curbH, 0.76, g.yaw, PAL.curbLight, g.pitch)
    // Continuous evergreen base hedge inside the granite curb
    box(g.midX, g.midY + 0.45, g.midZ, g.slopeLength + 0.02, 0.46, 0.58, g.yaw, PAL.hedgeDark, g.pitch)
  }

  // Layered sculpted shrub / Guilin crape-myrtle blossom crowns every ~3.4 m (pulled back from open ends)
  const crownCount = Math.max(1, Math.round(chain.totalLength / 3.4))
  const crownStep = chain.totalLength / crownCount
  for (let i = 0; i < crownCount; i++) {
    const s = (i + 0.5) * crownStep
    if ((chain.startOpen && s < 1.1) || (chain.endOpen && chain.totalLength - s < 1.1)) continue
    const p = sampleChainAt(chain, s)
    const hSeed = hash2d(ox + p.x, oz + p.z)
    const isBlossom = hSeed > 0.44
    const crownTint = isBlossom ? (hSeed > 0.70 ? PAL.crapeLit : PAL.crapeDark) : PAL.hedgeLit
    const crownH = isBlossom ? 0.28 + (hSeed % 0.12) : 0.24 + (hSeed % 0.10)
    const y = baseLevel(p.x, p.z) + 0.045
    box(
      p.x,
      y + 0.68 + crownH * 0.42,
      p.z,
      Math.max(0.7, Math.min(2.4, crownStep * 0.68)),
      crownH,
      isBlossom ? 0.48 : 0.52,
      p.yaw + (hSeed - 0.5) * 0.08,
      crownTint,
    )
  }

  // Ornamental crape-myrtle / osmanthus trees spaced every ~14 m, strictly clear (>= 4.5 m) of open ends
  if (chain.totalLength >= 10.5) {
    const startMargin = chain.startOpen ? 4.8 : 2.5
    const endMargin = chain.endOpen ? 4.8 : 2.5
    const usable = chain.totalLength - startMargin - endMargin
    if (usable >= 1.5) {
      const count = Math.max(1, Math.floor(usable / 14) + 1)
      const step = count > 1 ? usable / (count - 1) : 0
      for (let i = 0; i < count; i++) {
        const s = count === 1 ? startMargin + usable * 0.5 : startMargin + i * step
        const p = sampleChainAt(chain, s)
        const seed = hash2d(ox + p.x, oz + p.z)
        emitOrnamentalTree(p.x, p.z, p.yaw, baseLevel, box, seed, true, 0.92)
      }
    }
  }

  if (chain.startOpen) {
    const first = sampleChainAt(chain, 0)
    emitOpeningEndCap(first.x, first.z, first.tx, first.tz, first.yaw, baseLevel, box, 'green', 1)
  }
  if (!chain.closed && chain.endOpen) {
    const last = sampleChainAt(chain, chain.totalLength)
    emitOpeningEndCap(last.x, last.z, last.tx, last.tz, last.yaw, baseLevel, box, 'green', -1)
  }
}

function emitVergeHedgeCurbChain(
  chain: DividerChain,
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
  palette: DividerPalette,
  origin?: readonly [number, number],
) {
  const ox = origin?.[0] ?? 0
  const oz = origin?.[1] ?? 0
  // Merge long straight curbs & iron rails up to 12 m while keeping organic 4.5 m shrub variety
  const mergedLegs = mergeCollinearChainLegs(chain.legs, baseLevel, 12)
  for (const leg of mergedLegs) {
    const g = sampleDividerSpanGrade(leg.start.x, leg.start.z, leg.end.x, leg.end.z, baseLevel, 0.045)
    if (g.flatLength < 0.15) continue
    const curbH = 0.20 + g.embedDepth
    box(g.midX, g.midY + 0.20 - curbH * 0.5, g.midZ, g.slopeLength + 0.04, curbH, 1.22, g.yaw, PAL.curbMid, g.pitch)
    box(g.midX, g.midY + 0.40, g.midZ, g.slopeLength + 0.02, 0.44, 0.98, g.yaw, PAL.hedgeDark, g.pitch)
    // Low dark-green garden edge fence on motor-lane side (-sideSign * 0.58 m)
    const nx = Math.sin(g.yaw), nz = Math.cos(g.yaw)
    const fenceOff = -leg.sideSign * 0.58
    const fx = g.midX + fenceOff * nx
    const fz = g.midZ + fenceOff * nz
    box(fx, g.midY + 0.36, fz, g.slopeLength + 0.03, 0.05, 0.05, g.yaw, palette.iron, g.pitch)
    box(fx, g.midY + 0.66, fz, g.slopeLength + 0.03, 0.05, 0.05, g.yaw, palette.iron, g.pitch)
  }

  // Sculpted upper shrub variety (alternating green & crimson Loropetalum mounds every ~4.5 m)
  const moundCount = Math.max(1, Math.round(chain.totalLength / 4.5))
  const moundStep = chain.totalLength / moundCount
  for (let i = 0; i < moundCount; i++) {
    const s = (i + 0.5) * moundStep
    if ((chain.startOpen && s < 1.0) || (chain.endOpen && chain.totalLength - s < 1.0)) continue
    const p = sampleChainAt(chain, s)
    const hSeed = hash2d(ox + p.x, oz + p.z)
    const upperTint = hSeed > 0.72 ? PAL.shrubCrimson : hSeed > 0.35 ? PAL.hedgeLit : PAL.hedgeMid
    const y = baseLevel(p.x, p.z) + 0.045
    box(p.x, y + 0.70, p.z, Math.min(3.4, moundStep * 0.78), 0.24 + (hSeed % 0.08), 0.72, p.yaw, upperTint)
  }

  // Fence posts along motor-lane side at 2.6 m chainage
  const postStep = chain.totalLength / Math.max(1, Math.round(chain.totalLength / 2.6))
  for (let s = 0; s <= chain.totalLength + 1e-4; s += postStep) {
    const p = sampleChainAt(chain, Math.min(chain.totalLength, s))
    const fenceOff = -p.sideSign * 0.58
    const fx = p.x + fenceOff * p.nx
    const fz = p.z + fenceOff * p.nz
    const y = baseLevel(fx, fz) + 0.045
    box(fx, y + 0.38, fz, 0.052, 0.66, 0.052, p.yaw, palette.iron)
  }

  if (chain.startOpen) {
    const first = sampleChainAt(chain, 0)
    emitOpeningEndCap(first.x, first.z, first.tx, first.tz, first.yaw, baseLevel, box, 'verge', 1)
  }
  if (!chain.closed && chain.endOpen) {
    const last = sampleChainAt(chain, chain.totalLength)
    emitOpeningEndCap(last.x, last.z, last.tx, last.tz, last.yaw, baseLevel, box, 'verge', -1)
  }
}

function emitVergeMetalGuardrailChain(
  chain: DividerChain,
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
) {
  const mergedLegs = mergeCollinearChainLegs(chain.legs, baseLevel, 12)
  for (const leg of mergedLegs) {
    const g = sampleDividerSpanGrade(leg.start.x, leg.start.z, leg.end.x, leg.end.z, baseLevel, 0.045)
    if (g.flatLength < 0.15) continue
    // Clean granite curb plinth strip (1.02 m wide, grounded) matching physical collider envelope
    const curbH = 0.18 + g.embedDepth
    box(g.midX, g.midY + 0.18 - curbH * 0.5, g.midZ, g.slopeLength + 0.03, curbH, 1.02, g.yaw, PAL.curbLight, g.pitch)

    // Primary Guilin white-grey steel guardrail with Guilin jade accent rail
    box(g.midX, g.midY + 1.02, g.midZ, g.slopeLength + 0.02, 0.075, 0.07, g.yaw, PAL.railWhite, g.pitch)
    box(g.midX, g.midY + 0.36, g.midZ, g.slopeLength + 0.02, 0.06, 0.07, g.yaw, PAL.railSilver, g.pitch)
    box(g.midX, g.midY + 0.88, g.midZ, g.slopeLength + 0.01, 0.045, 0.055, g.yaw, PAL.guilinJade, g.pitch)
  }

  // Heavy cast-iron plinths + main white posts every ~2.4 m, plus midpoint vertical pickets
  const bayCount = Math.max(1, Math.round(chain.totalLength / 2.4))
  const postStep = chain.totalLength / bayCount
  for (let i = 0; i < bayCount; i++) {
    const pm = sampleChainAt(chain, (i + 0.5) * postStep)
    const ym = baseLevel(pm.x, pm.z) + 0.045
    box(pm.x, ym + 0.68, pm.z, 0.036, 0.62, 0.036, pm.yaw, PAL.railWhite)
    if (i > 0) {
      const p = sampleChainAt(chain, i * postStep)
      const y = baseLevel(p.x, p.z) + 0.045
      box(p.x, y + 0.21, p.z, 0.16, 0.14, 0.22, p.yaw, PAL.railBase)
      box(p.x, y + 0.68, p.z, 0.068, 0.90, 0.068, p.yaw, PAL.railWhite)
    }
  }

  const first = sampleChainAt(chain, 0)
  const last = sampleChainAt(chain, chain.totalLength)
  if (chain.startOpen) {
    emitOpeningEndCap(first.x, first.z, first.tx, first.tz, first.yaw, baseLevel, box, 'rail', 1)
  } else {
    const y = baseLevel(first.x, first.z) + 0.045
    box(first.x, y + 0.68, first.z, 0.068, 0.90, 0.068, first.yaw, PAL.railWhite)
  }
  if (!chain.closed) {
    if (chain.endOpen) {
      emitOpeningEndCap(last.x, last.z, last.tx, last.tz, last.yaw, baseLevel, box, 'rail', -1)
    } else {
      const y = baseLevel(last.x, last.z) + 0.045
      box(last.x, y + 0.68, last.z, 0.068, 0.90, 0.068, last.yaw, PAL.railWhite)
    }
  }
}

function emitVergeTreePlanterChain(
  chain: DividerChain,
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
  origin?: readonly [number, number],
) {
  const ox = origin?.[0] ?? 0
  const oz = origin?.[1] ?? 0

  // Compute street-tree pit stations first so linked redwood planters cleanly break around every framed tree pit
  const treeStations: number[] = []
  if (chain.totalLength >= 8.5) {
    const startMargin = chain.startOpen ? 4.2 : 2.2
    const endMargin = chain.endOpen ? 4.2 : 2.2
    const usable = chain.totalLength - startMargin - endMargin
    if (usable >= 1.0) {
      const count = Math.max(1, Math.floor(usable / 12) + 1)
      const step = count > 1 ? usable / (count - 1) : 0
      for (let i = 0; i < count; i++) {
        treeStations.push(count === 1 ? startMargin + usable * 0.5 : startMargin + i * step)
      }
    }
  }

  // Continuous granite verge base strip
  const mergedLegs = mergeCollinearChainLegs(chain.legs, baseLevel, 12)
  for (const leg of mergedLegs) {
    const g = sampleDividerSpanGrade(leg.start.x, leg.start.z, leg.end.x, leg.end.z, baseLevel, 0.045)
    if (g.flatLength < 0.15) continue
    const curbH = 0.20 + g.embedDepth
    box(g.midX, g.midY + 0.20 - curbH * 0.5, g.midZ, g.slopeLength + 0.04, curbH, 1.12, g.yaw, PAL.curbLight, g.pitch)
  }

  // Emit linked redwood flower planters strictly in the bays BETWEEN framed tree pits (never piercing tree trunks/pits)
  const pitHalfClearance = 0.88
  const bays: [number, number][] = []
  let cursor = chain.startOpen ? 0.28 : 0
  const limit = chain.endOpen ? Math.max(cursor, chain.totalLength - 0.28) : chain.totalLength
  for (const ts of treeStations) {
    const bayEnd = Math.max(cursor, ts - pitHalfClearance)
    if (bayEnd - cursor >= 0.75) bays.push([cursor, bayEnd])
    cursor = Math.min(limit, ts + pitHalfClearance)
  }
  if (limit - cursor >= 0.75) bays.push([cursor, limit])

  for (const [bStart, bEnd] of bays) {
    const spanLen = bEnd - bStart
    const subCount = Math.max(1, Math.ceil(spanLen / 4.2))
    const subStep = spanLen / subCount
    for (let k = 0; k < subCount; k++) {
      const s0 = bStart + k * subStep
      const s1 = s0 + subStep
      const p0 = sampleChainAt(chain, s0)
      const p1 = sampleChainAt(chain, s1)
      const g = sampleDividerSpanGrade(p0.x, p0.z, p1.x, p1.z, baseLevel, 0.045)
      if (g.flatLength < 0.35) continue
      const hSeed = hash2d(ox + g.midX, oz + g.midZ)
      const floral = hSeed > 0.42
      box(g.midX, g.midY + 0.42, g.midZ, g.slopeLength, 0.48, 0.74, g.yaw, PAL.planterWood, g.pitch)
      box(g.midX, g.midY + 0.69, g.midZ, g.slopeLength + 0.04, 0.06, 0.80, g.yaw, PAL.planterTrim, g.pitch)
      box(
        g.midX,
        g.midY + 0.81,
        g.midZ,
        Math.max(0.3, g.slopeLength * 0.90),
        0.22,
        0.58,
        g.yaw,
        floral ? (hSeed > 0.70 ? PAL.crapeLit : PAL.crapeDark) : PAL.hedgeLit,
        g.pitch,
      )
    }
  }

  // Framed granite street-tree pits + dark iron tree grates + shaded ornamental trees in their dedicated openings
  for (const s of treeStations) {
    const p = sampleChainAt(chain, s)
    const y = baseLevel(p.x, p.z) + 0.045
    box(p.x, y + 0.14, p.z, 1.48, 0.24, 1.48, p.yaw, PAL.curbMid)
    box(p.x, y + 0.27, p.z, 1.18, 0.055, 1.18, p.yaw, PAL.planterTrim)
    const seed = hash2d(ox + p.x, oz + p.z)
    emitOrnamentalTree(p.x, p.z, p.yaw, baseLevel, box, seed, seed > 0.65, 1.06)
  }

  if (chain.startOpen) {
    const first = sampleChainAt(chain, 0)
    emitOpeningEndCap(first.x, first.z, first.tx, first.tz, first.yaw, baseLevel, box, 'verge', 1)
  }
  if (!chain.closed && chain.endOpen) {
    const last = sampleChainAt(chain, chain.totalLength)
    emitOpeningEndCap(last.x, last.z, last.tx, last.tz, last.yaw, baseLevel, box, 'verge', -1)
  }
}

function emitSoftDelineatorPost(
  x: number,
  z: number,
  yaw: number,
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
) {
  const y = baseLevel(x, z) + 0.045
  // Flexible rubber base + orange-red delineator bollard + white reflective collar
  box(x, y + 0.04, z, 0.18, 0.08, 0.18, yaw, PAL.warnDark)
  box(x, y + 0.38, z, 0.085, 0.66, 0.085, yaw, PAL.softOrange)
  box(x, y + 0.56, z, 0.09, 0.11, 0.09, yaw, PAL.softWhite)
}

function emitSoftDelineatorChain(
  chain: DividerChain,
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
) {
  const startMargin = chain.startOpen ? 0.6 : 0.2
  const endMargin = chain.endOpen ? 0.6 : 0.2
  const usable = chain.totalLength - startMargin - endMargin
  if (usable < 0.4) {
    const mid = sampleChainAt(chain, chain.totalLength * 0.5)
    emitSoftDelineatorPost(mid.x, mid.z, mid.yaw, baseLevel, box)
    return
  }
  const count = Math.max(1, Math.round(usable / 3.5) + 1)
  const step = count > 1 ? usable / (count - 1) : 0
  for (let i = 0; i < count; i++) {
    const s = count === 1 ? startMargin + usable * 0.5 : startMargin + i * step
    const p = sampleChainAt(chain, s)
    emitSoftDelineatorPost(p.x, p.z, p.yaw, baseLevel, box)
  }
}

type Pair = [number, number]
type StreetPath = [number, ...Pair[][]]

function pointInRingM(x: number, z: number, ring: readonly Pair[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[i][0] / 100, az = ring[i][1] / 100
    const bx = ring[j][0] / 100, bz = ring[j][1] / 100
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside
  }
  return inside
}

/**
 * Extracts gentle reflective soft-delineator bollards along narrow collector three-band verges
 * (path kind=4 with strip width 0.14..0.62 m and length >= 8 m, e.g. Binjiang Rd / Minzhu Rd / Jiangan Rd)
 * where no arterial decor 5/6 exists, visually separating motor and non-motor lanes without hard walls.
 */
export function extractCollectorSoftDelineators(
  paths: readonly StreetPath[],
  existingVergePoints: readonly (readonly [number, number])[],
  origin?: readonly [number, number],
): {x: number; z: number; yaw: number}[] {
  const out: {x: number; z: number; yaw: number}[] = []
  const ox = origin?.[0] ?? 0
  const oz = origin?.[1] ?? 0

  for (const path of paths) {
    if (path[0] !== 4) continue
    const ring = path[1]
    if (!ring || ring.length < 3) continue
    // Find longest edge to establish strip principal axis
    let maxLenSq = 0
    let ax0 = 0, az0 = 0, tx = 1, tz = 0
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length]
      const dx = (b[0] - a[0]) / 100, dz = (b[1] - a[1]) / 100
      const l2 = dx * dx + dz * dz
      if (l2 > maxLenSq) {
        maxLenSq = l2
        const l = Math.sqrt(l2)
        ax0 = a[0] / 100
        az0 = a[1] / 100
        tx = dx / l
        tz = dz / l
      }
    }
    if (maxLenSq < 64) continue // length < 8 m
    const nx = -tz, nz = tx
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (const [cx, cz] of ring) {
      const rx = cx / 100 - ax0, rz = cz / 100 - az0
      const u = rx * tx + rz * tz
      const v = rx * nx + rz * nz
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const stripLen = maxU - minU
    const stripWidth = maxV - minV
    // Strictly match narrow collector dividers (~0.22 m wide) and skip wide arterial verges (2.2 m)
    if (stripLen < 8.5 || stripWidth < 0.14 || stripWidth > 0.62) continue

    const midV = (minV + maxV) * 0.5
    const yaw = -Math.atan2(tz, tx)
    const spacing = 4.2
    const margin = 2.0
    const count = Math.max(1, Math.floor((stripLen - margin * 2) / spacing) + 1)
    const step = count > 1 ? (stripLen - margin * 2) / (count - 1) : 0
    const stripPosts: {x: number; z: number; yaw: number}[] = []
    let overlapsArterial = false
    for (let i = 0; i < count; i++) {
      const u = count === 1 ? (minU + maxU) * 0.5 : minU + margin + i * step
      const lx = ax0 + tx * u + nx * midV
      const lz = az0 + tz * u + nz * midV
      if (lx < 0.4 || lx > 255.6 || lz < 0.4 || lz > 255.6) continue
      if (!pointInRingM(lx, lz, ring)) continue
      const wx = ox + lx, wz = oz + lz
      if (origin && isShizijieDecorSuppressed(wx, wz, 5)) continue
      // If any point of this narrow strip overlaps an existing arterial median/verge divider, skip the whole strip
      for (let k = 0; k < existingVergePoints.length; k++) {
        const dx = existingVergePoints[k][0] - lx
        const dz = existingVergePoints[k][1] - lz
        if (dx * dx + dz * dz < 10.24) { overlapsArterial = true; break }
      }
      if (overlapsArterial) break
      stripPosts.push({x: lx, z: lz, yaw})
    }
    if (!overlapsArterial) out.push(...stripPosts)
  }
  return out
}

/**
 * Emits all central median & motor/non-motor verge divider geometry for one 256 m chunk
 * into the shared street furniture InstancedMesh buffer (0 extra draw calls, 120 m rail LOD).
 */
export function emitRoadDividers(
  decor: readonly (readonly number[])[],
  paths: readonly StreetPath[],
  suppressed: (kind: number, x: number, z: number) => boolean,
  baseLevel: (x: number, z: number) => number,
  origin: readonly [number, number] | undefined,
  box: BoxEmitter,
  palette: DividerPalette,
): void {
  const ox = origin?.[0] ?? 0
  const oz = origin?.[1] ?? 0
  const medianSegments: DividerSegmentInput[] = []
  const vergeSegments: DividerSegmentInput[] = []
  const existingVergePoints: [number, number][] = []

  for (const item of decor) {
    const kind = item[0]
    const east = item[1], south = item[2], heading = item[3], span = item[4] ?? 0
    const lx = east / 10, lz = south / 10
    if (suppressed(kind, lx, lz)) continue

    const wx = ox + lx, wz = oz + lz
    const headingRad = heading / 100

    if (kind === 1 || kind === 2 || kind === 7 || kind === DECOR_KIND_MEDIAN_GREEN_TREES) {
      existingVergePoints.push([lx, lz])
      if (origin && isZhongshanLandmarkMedianSuppressed(wx, wz, kind)) continue
      const exact = item[8] !== undefined
      const dx = Math.cos(headingRad) * (span / 20)
      const dz = Math.sin(headingRad) * (span / 20)
      const startX = exact ? item[5] / 100 : lx - dx
      const startZ = exact ? item[6] / 100 : lz - dz
      const endX = exact ? item[7] / 100 : lx + dx
      const endZ = exact ? item[8] / 100 : lz + dz
      const resolved: MedianDividerKind = origin
        ? resolveMedianDividerKind(wx, wz, kind, headingRad)
        : (kind === 7 || kind === DECOR_KIND_MEDIAN_GREEN_TREES ? 'median_green_trees' : 'median_metal_rail')
      medianSegments.push({
        group: resolved,
        rawKind: kind,
        sideSign: 0,
        banner: kind === 2,
        startX,
        startZ,
        endX,
        endZ,
        exact,
      })
    } else if (
      kind === 5 || kind === 6 ||
      kind === DECOR_KIND_VERGE_METAL_RAIL ||
      kind === DECOR_KIND_VERGE_TREE_PLANTER ||
      kind === DECOR_KIND_VERGE_SOFT_DELINEATOR
    ) {
      existingVergePoints.push([lx, lz])
      const resolved: VergeDividerKind = origin
        ? resolveVergeDividerKind(wx, wz, kind, headingRad)
        : (
          kind === DECOR_KIND_VERGE_METAL_RAIL ? 'metal_guardrail' :
          kind === DECOR_KIND_VERGE_TREE_PLANTER ? 'tree_planter' :
          kind === DECOR_KIND_VERGE_SOFT_DELINEATOR ? 'soft_delineator' :
          'hedge_curb'
        )
      if (resolved === 'marking_only') continue
      const sideSign = kind === 6 ? -1 : 1
      const dx = Math.cos(headingRad) * (span / 20)
      const dz = Math.sin(headingRad) * (span / 20)
      vergeSegments.push({
        group: `${resolved}:${sideSign}`,
        rawKind: kind,
        sideSign,
        banner: false,
        startX: lx - dx,
        startZ: lz - dz,
        endX: lx + dx,
        endZ: lz + dz,
        exact: false,
      })
    } else if (kind === 8) {
      // Preserve frontage stone-pillar + iron fence (e.g. Yiwu Rd)
      const angle = -headingRad
      const y = baseLevel(lx, lz) + 0.195
      const length = span / 10
      box(lx - length * 0.5 * Math.cos(angle), y + 0.62, lz + length * 0.5 * Math.sin(angle), 0.32, 1.24, 0.32, angle, palette.stoneMid)
      for (const level of [0.32, 1.05]) box(lx, y + level, lz, length, 0.06, 0.07, angle, palette.iron)
      for (const fraction of [-0.32, -0.12, 0.12, 0.32]) {
        box(lx + fraction * length * Math.cos(angle), y + 0.69, lz - fraction * length * Math.sin(angle), 0.04, 0.78, 0.04, angle, palette.iron)
      }
    }
  }

  for (const chain of traceDividerChains(medianSegments)) {
    if (chain.group === 'median_green_trees') {
      emitMedianGreenTreesChain(chain, baseLevel, box, origin)
    } else {
      emitMedianMetalRailChain(chain, baseLevel, box, palette)
    }
  }

  for (const chain of traceDividerChains(vergeSegments)) {
    const kind = chain.group.split(':')[0] as VergeDividerKind
    if (kind === 'metal_guardrail') {
      emitVergeMetalGuardrailChain(chain, baseLevel, box)
    } else if (kind === 'tree_planter') {
      emitVergeTreePlanterChain(chain, baseLevel, box, origin)
    } else if (kind === 'soft_delineator') {
      emitSoftDelineatorChain(chain, baseLevel, box)
    } else {
      emitVergeHedgeCurbChain(chain, baseLevel, box, palette, origin)
    }
  }

  // Emit gentle soft-delineator bollards on narrow collector three-band verges (no rigid barrier wall)
  if (paths.length) {
    for (const post of extractCollectorSoftDelineators(paths, existingVergePoints, origin)) {
      emitSoftDelineatorPost(post.x, post.z, post.yaw, baseLevel, box)
    }
  }
}
