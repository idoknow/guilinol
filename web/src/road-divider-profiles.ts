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

  // ---- 河东片区主干：龙隐路林荫、七星路东南绿篱护栏段、穿山路南北分型 ----
  {
    id: 'longyin_rd',
    name: '龙隐路（穿山桥—七星公园林荫道）',
    polyline: [[40, 724], [95, 735], [664, 939], [705, 957]],
    halfWidth: 30,
    median: 'median_green_trees',
    verge: 'tree_planter',
    priority: 10,
  },
  {
    id: 'qixing_rd_se',
    name: '七星路（三里店往东南段）',
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

/**
 * Emits one outward-facing CCW flat-shaded triangle into the shared street `surface` geometry
 * (`aSurface = 7`: untextured vertex-colored mesh, 0 extra draw calls, 0 road/sidewalk physics impact).
 */
export type SurfaceTriEmitter = (
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  r: number, g: number, b: number,
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
  hedgeLit: new THREE.Color(0x5a8142),
  shrubCrimson: new THREE.Color(0x6d3a44),
  // Natural Guilin crape-myrtle blossom palette (restrained saturation calibrated for gradeDay 1.22)
  crapeDark: new THREE.Color(0x8b445d),
  crapeLit: new THREE.Color(0xaa627a),
  crapeSoft: new THREE.Color(0xc08297),
  planterWood: new THREE.Color(0x6f4433),
  planterTrim: new THREE.Color(0x383c40),
  trunkLime: new THREE.Color(0xdcd9cf),
  trunkBark: new THREE.Color(0x544538),
  warnYellow: new THREE.Color(0xe5b126),
  warnDark: new THREE.Color(0x2c3034),
  softOrange: new THREE.Color(0xd95626),
  softWhite: new THREE.Color(0xf1f0ea),
} as const

type Pair = [number, number]
type StreetPath = [number, ...Pair[][]]

interface RaisedSurfacePoly {
  shell: readonly Pair[]
  holes: readonly (readonly Pair[])[]
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

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
 * Indexes raised street surfaces (kind=1 median islands/sidewalks and kind=4 verges, all at baseLevel+0.195 m)
 * so divider plinths, end-caps, and soft delineator bases always sit cleanly atop the actual rendered surface.
 */
function buildRaisedSurfaceLookup(paths: readonly StreetPath[]): (x: number, z: number) => number {
  const polys: RaisedSurfacePoly[] = []
  for (const p of paths) {
    const k = p[0]
    if (k !== 1 && k !== 4) continue
    const shell = p[1]
    if (!shell || shell.length < 3) continue
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const [cx, cz] of shell) {
      const mx = cx / 100, mz = cz / 100
      if (mx < minX) minX = mx
      if (mx > maxX) maxX = mx
      if (mz < minZ) minZ = mz
      if (mz > maxZ) maxZ = mz
    }
    polys.push({shell, holes: p.slice(2) as Pair[][], minX, maxX, minZ, maxZ})
  }
  if (!polys.length) return () => 0.045
  return (x: number, z: number) => {
    for (let i = 0; i < polys.length; i++) {
      const poly = polys[i]
      if (x < poly.minX || x > poly.maxX || z < poly.minZ || z > poly.maxZ) continue
      if (!pointInRingM(x, z, poly.shell)) continue
      if (poly.holes.some(h => pointInRingM(x, z, h))) continue
      return 0.195
    }
    return 0.045
  }
}

interface ProjectedBed {
  s: number
  lat: number
  x: number
  z: number
}

/**
 * Projects GL04 native street-tree `beds` (`[eastDm, southDm, heading, arterial]`) onto a traced divider chain.
 * Returns deduplicated stations along chainage sorted ascending.
 */
function projectBedsToChain(
  chain: DividerChain,
  beds: readonly (readonly number[])[],
  maxLateralDist: number,
): ProjectedBed[] {
  if (!beds.length || !chain.legs.length) return []
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const leg of chain.legs) {
    minX = Math.min(minX, leg.start.x, leg.end.x)
    maxX = Math.max(maxX, leg.start.x, leg.end.x)
    minZ = Math.min(minZ, leg.start.z, leg.end.z)
    maxZ = Math.max(maxZ, leg.start.z, leg.end.z)
  }
  const pad = maxLateralDist + 1.0
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad

  const raw: ProjectedBed[] = []
  for (const b of beds) {
    const bx = b[0] / 10, bz = b[1] / 10
    if (bx < minX || bx > maxX || bz < minZ || bz > maxZ) continue
    let bestDist = maxLateralDist
    let bestS = -1
    let bestLat = 0
    let acc = 0
    for (const leg of chain.legs) {
      const dx = leg.end.x - leg.start.x, dz = leg.end.z - leg.start.z
      const lenSq = dx * dx + dz * dz
      if (lenSq < 1e-6) { acc += leg.length; continue }
      const t = Math.max(0, Math.min(1, ((bx - leg.start.x) * dx + (bz - leg.start.z) * dz) / lenSq))
      const px = leg.start.x + dx * t, pz = leg.start.z + dz * t
      const dist = Math.hypot(bx - px, bz - pz)
      if (dist <= bestDist) {
        bestDist = dist
        bestS = acc + t * leg.length
        const yaw = -Math.atan2(dz, dx)
        const nx = Math.sin(yaw), nz = Math.cos(yaw)
        bestLat = (bx - px) * nx + (bz - pz) * nz
      }
      acc += leg.length
    }
    if (bestS >= 0) raw.push({s: bestS, lat: bestLat, x: bx, z: bz})
  }
  if (!raw.length) return []
  raw.sort((a, b) => a.s - b.s)
  const deduped: ProjectedBed[] = [raw[0]]
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].s - deduped[deduped.length - 1].s >= 0.85) deduped.push(raw[i])
  }
  return deduped
}

/**
 * Splits `[startMargin, totalLength - endMargin]` into continuous obstacle-free bays around tree stations.
 */
function splitChainClearBays(
  totalLength: number,
  startMargin: number,
  endMargin: number,
  obstacleStations: readonly number[],
  halfClearance: number,
  minBayLen = 0.55,
): [number, number][] {
  const limit = Math.max(startMargin, totalLength - endMargin)
  if (limit - startMargin < minBayLen) return []
  const sorted = [...obstacleStations].sort((a, b) => a - b)
  const bays: [number, number][] = []
  let cursor = startMargin
  for (const s of sorted) {
    const bayEnd = Math.min(limit, s - halfClearance)
    if (bayEnd - cursor >= minBayLen) bays.push([cursor, bayEnd])
    cursor = Math.max(cursor, Math.min(limit, s + halfClearance))
  }
  if (limit - cursor >= minBayLen) bays.push([cursor, limit])
  return bays
}

function hash2d(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Emits a watertight yellow/black reflective bollard + cap at a real street opening (crosswalk / U-turn / junction).
 * All stacked components overlap vertically by >= 0.01 m (zero air gaps) and seat cleanly on `surfaceOff` (+0.195 or +0.045).
 */
export function emitOpeningEndCap(
  x: number,
  z: number,
  tx: number,
  tz: number,
  yaw: number,
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
  style: 'rail' | 'green' | 'verge',
  inwardSign: number,
  surfaceOff = 0.195,
) {
  // Tuck end-cap slightly inward (+inwardSign * 0.08 m) so it never protrudes into crosswalk openings.
  const px = x + tx * inwardSign * 0.08
  const pz = z + tz * inwardSign * 0.08
  const y0 = baseLevel(px, pz) + surfaceOff
  if (style === 'rail') {
    // Cast-iron plinth [y0-0.03 .. y0+0.13] sits cleanly atop surfaceOff (13 cm visible)
    box(px, y0 + 0.05, pz, 0.22, 0.16, 0.20, yaw, PAL.railBase)
    // Continuous yellow post shaft [y0+0.11 .. y0+0.88] embedded 2 cm into plinth (0 gap)
    box(px, y0 + 0.495, pz, 0.11, 0.77, 0.11, yaw, PAL.warnYellow)
    // Two dark warning collar bands wrapping the continuous yellow shaft (no cut gaps)
    box(px, y0 + 0.40, pz, 0.122, 0.13, 0.122, yaw, PAL.warnDark)
    box(px, y0 + 0.68, pz, 0.122, 0.13, 0.122, yaw, PAL.warnDark)
    // Top white cap [y0+0.86 .. y0+0.95] overlaps yellow shaft by 2 cm & aligns flush with top rail (+0.9225)
    box(px, y0 + 0.905, pz, 0.14, 0.09, 0.14, yaw, PAL.railWhite)
  } else if (style === 'green') {
    // Granite nose stone [y0-0.04 .. y0+0.22] + warning post [y0+0.20 .. y0+0.68] + white cap [y0+0.66 .. y0+0.73]
    box(px, y0 + 0.09, pz, 0.34, 0.26, 0.78, yaw, PAL.curbLight)
    box(px, y0 + 0.44, pz, 0.095, 0.48, 0.095, yaw, PAL.warnYellow)
    box(px, y0 + 0.52, pz, 0.106, 0.10, 0.106, yaw, PAL.warnDark)
    box(px, y0 + 0.695, pz, 0.115, 0.07, 0.115, yaw, PAL.railWhite)
  } else {
    // Verge granite nose block [y0-0.04 .. y0+0.16] + sleek reflective delineator [y0+0.14 .. y0+0.74]
    box(px, y0 + 0.06, pz, 0.32, 0.20, 1.04, yaw, PAL.curbLight)
    box(px, y0 + 0.44, pz, 0.095, 0.60, 0.095, yaw, PAL.railWhite)
    box(px, y0 + 0.60, pz, 0.108, 0.12, 0.108, yaw, PAL.warnYellow)
  }
}

// Shared 1-level geodesic icosahedron (42 verts, 80 outward-CCW tris) matching web/src/look/trees.ts
// so procedural boulevard crape-myrtle trees match Guilin Online's native low-poly botanical style (0 extra draw calls).
type Vec3 = [number, number, number]
const ICO_PHI = (1 + Math.sqrt(5)) / 2
const ICO_BASE_VERTS: Vec3[] = [
  [-1, ICO_PHI, 0], [1, ICO_PHI, 0], [-1, -ICO_PHI, 0], [1, -ICO_PHI, 0],
  [0, -1, ICO_PHI], [0, 1, ICO_PHI], [0, -1, -ICO_PHI], [0, 1, -ICO_PHI],
  [ICO_PHI, 0, -1], [ICO_PHI, 0, 1], [-ICO_PHI, 0, -1], [-ICO_PHI, 0, 1],
].map(([vx, vy, vz]) => {
  const ln = Math.hypot(vx, vy, vz)
  return [vx / ln, vy / ln, vz / ln] as Vec3
})
const ICO_BASE_FACES: [number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
]
const ICO_SUB1 = (() => {
  const verts = ICO_BASE_VERTS.slice()
  const cache = new Map<string, number>()
  const mid = (i: number, j: number) => {
    const key = i < j ? `${i}_${j}` : `${j}_${i}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const [ax, ay, az] = verts[i], [bx, by, bz] = verts[j]
    const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5
    const ln = Math.hypot(mx, my, mz)
    const idx = verts.length
    verts.push([mx / ln, my / ln, mz / ln])
    cache.set(key, idx)
    return idx
  }
  const faces: [number, number, number][] = []
  for (const [a, b, c] of ICO_BASE_FACES) {
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
    faces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
  }
  return {verts, faces}
})()

const TREE_SHADE_C0 = new THREE.Color()
const TREE_SHADE_C1 = new THREE.Color()
const TREE_SHADE_C2 = new THREE.Color()
const TREE_SHADE_UNDER = new THREE.Color()
const TREE_SHADE_OUT = new THREE.Color()

function evalPolyBlob(
  ox: number, oy: number, oz: number,
  rx: number, ry: number, rz: number,
  yaw: number, seed: number, jitter: number,
): [Vec3, Vec3, Vec3][] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw)
  const pts: Vec3[] = ICO_SUB1.verts.map(([ux, uy, uz]) => {
    const d1 = Math.sin(seed * 1.73 + ux * 3.17 + uy * 2.63 + uz * 3.53)
    const d2 = Math.cos(seed * 2.91 - ux * 4.31 + uy * 3.79 - uz * 2.87)
    const disp = 1 + jitter * (0.62 * d1 + 0.38 * d2)
    const lx = ux * rx * disp, ly = uy * ry * disp, lz = uz * rz * disp
    return [lx * cy + lz * sy + ox, ly + oy, -lx * sy + lz * cy + oz]
  })
  return ICO_SUB1.faces.map(([a, b, c]) => [pts[a], pts[b], pts[c]])
}

function evalPolyTube(pts: readonly [number, number, number, number][], sides: number): [Vec3, Vec3, Vec3][] {
  const rings: Vec3[][] = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const [cx, cy, cz, r] = pts[i]
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)]
    let tx = p1[0] - p0[0], ty = p1[1] - p0[1], tz = p1[2] - p0[2]
    const tl = Math.hypot(tx, ty, tz) || 1
    tx /= tl; ty /= tl; tz /= tl
    const upX = Math.abs(ty) > 0.92 ? 1 : 0, upY = Math.abs(ty) > 0.92 ? 0 : 1
    let ux = -tz * upY, uy = tz * upX, uz = tx * upY - ty * upX
    const ul = Math.hypot(ux, uy, uz) || 1
    ux /= ul; uy /= ul; uz /= ul
    const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux
    const ring: Vec3[] = []
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2
      const ca = Math.cos(ang), sa = Math.sin(ang)
      ring.push([cx + r * (ca * ux + sa * vx), cy + r * (ca * uy + sa * vy), cz + r * (ca * uz + sa * vz)])
    }
    rings.push(ring)
  }
  const tris: [Vec3, Vec3, Vec3][] = []
  for (let i = 0; i < n - 1; i++) {
    const r0 = rings[i], r1 = rings[i + 1]
    for (let s = 0; s < sides; s++) {
      const sn = (s + 1) % sides
      tris.push([r0[s], r0[sn], r1[sn]], [r0[s], r1[sn], r1[s]])
    }
  }
  return tris
}

function emitShadedWoodTris(
  tris: readonly [Vec3, Vec3, Vec3][],
  darkHex: number, midHex: number, litHex: number,
  emitTri: SurfaceTriEmitter,
) {
  let wMin = Infinity, wMax = -Infinity
  for (const [a, b, c] of tris) {
    const ym = (a[1] + b[1] + c[1]) / 3
    if (ym < wMin) wMin = ym
    if (ym > wMax) wMax = ym
  }
  const wSpan = Math.max(0.2, wMax - wMin)
  TREE_SHADE_C0.setHex(darkHex); TREE_SHADE_C1.setHex(midHex); TREE_SHADE_C2.setHex(litHex)
  for (const [a, b, c] of tris) {
    const ym = (a[1] + b[1] + c[1]) / 3
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2]
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2]
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
    const nl = Math.hypot(nx, ny, nz) || 1
    const sun = Math.max(0, Math.min(1, (-0.45 * (nx / nl) + 0.35 * (ny / nl) + 0.55 * (nz / nl)) * 0.5 + 0.5))
    const t = 0.45 * ((ym - wMin) / wSpan) + 0.55 * sun
    if (t < 0.5) TREE_SHADE_OUT.copy(TREE_SHADE_C0).lerp(TREE_SHADE_C1, t * 2)
    else TREE_SHADE_OUT.copy(TREE_SHADE_C1).lerp(TREE_SHADE_C2, (t - 0.5) * 2)
    emitTri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], TREE_SHADE_OUT.r, TREE_SHADE_OUT.g, TREE_SHADE_OUT.b)
  }
}

function emitShadedCanopyTris(
  tris: readonly [Vec3, Vec3, Vec3][],
  cYmin: number, cSpan: number,
  darkHex: number, midHex: number, litHex: number, underLiftHex: number,
  emitTri: SurfaceTriEmitter,
) {
  TREE_SHADE_C0.setHex(darkHex); TREE_SHADE_C1.setHex(midHex); TREE_SHADE_C2.setHex(litHex)
  TREE_SHADE_UNDER.setHex(underLiftHex)
  for (const [a, b, c] of tris) {
    const ym = (a[1] + b[1] + c[1]) / 3
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2]
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2]
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
    const nl = Math.hypot(nx, ny, nz) || 1
    const nyNorm = ny / nl
    const hT = Math.max(0, Math.min(1, (ym - cYmin) / cSpan))
    const nT = nyNorm * 0.5 + 0.5
    const t = Math.max(0, Math.min(1, 0.65 * hT + 0.35 * nT))
    if (t < 0.5) TREE_SHADE_OUT.copy(TREE_SHADE_C0).lerp(TREE_SHADE_C1, t * 2)
    else TREE_SHADE_OUT.copy(TREE_SHADE_C1).lerp(TREE_SHADE_C2, (t - 0.5) * 2)
    // Street surface material (aSurface=7) lacks trees.ts treeShadeFloor=0.8; lift downward-facing facet albedo
    // so HemisphereLight ground bounce + gradeDay contrast lands at natural deep green (matching native trees, 0 dead-black).
    const underLift = Math.max(0, Math.min(1, (0.20 - nyNorm) / 1.15))
    if (underLift > 0) TREE_SHADE_OUT.lerp(TREE_SHADE_UNDER, underLift * 0.88)
    emitTri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], TREE_SHADE_OUT.r, TREE_SHADE_OUT.g, TREE_SHADE_OUT.b)
  }
}

/**
 * Emits a genuine low-poly geodesic polyhedral Guilin crape-myrtle / osmanthus ornamental tree
 * directly into the shared street `surface` mesh (`aSurface = 7`, 0 extra draw calls, 0 boxy cubes).
 * Uses the exact subdivided-icosahedron blob + tapered forked trunk + vertical/normal baked shading
 * language of `web/src/look/trees.ts` so it blends seamlessly alongside native street trees.
 */
function emitOrnamentalTree(
  x: number,
  z: number,
  yaw: number,
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
  seed: number,
  withCrapeBlossom: boolean,
  crownScale = 1.0,
  surfaceOff = 0.195,
  emitTri?: SurfaceTriEmitter,
) {
  const y0 = baseLevel(x, z) + surfaceOff
  if (!emitTri) {
    // Minimal trunk-only marker for legacy callers without surface triangle callback (never emits boxy cube crowns)
    box(x, y0 + 0.51, z, 0.15, 1.06, 0.15, yaw, PAL.trunkLime)
    box(x, y0 + 1.56, z, 0.12, 1.12, 0.12, yaw + 0.2, PAL.trunkBark)
    return
  }

  const cs = crownScale
  const rot0 = yaw + (seed - 0.5) * 1.4
  const sSeed = 11 + seed * 97

  // Tapered 6-sided lower limewashed trunk [y0-0.06 .. y0+1.04]
  const limeTris = evalPolyTube([
    [x, y0 - 0.06, z, 0.105],
    [x, y0 + 0.48, z, 0.090],
    [x + 0.01, y0 + 1.04, z, 0.080],
  ], 6)
  emitShadedWoodTris(limeTris, 0xb2ae9f, 0xd6d2c6, 0xe8e5db, emitTri)

  // Tapered 6-sided upper smooth crape-myrtle bark [y0+1.00 .. y0+2.12] + 3 splayed ascending boughs
  const barkTris: [Vec3, Vec3, Vec3][] = [
    ...evalPolyTube([
      [x + 0.01, y0 + 1.00, z, 0.078],
      [x + 0.02, y0 + 1.66, z + 0.01, 0.066],
      [x + 0.02, y0 + 2.12, z + 0.01, 0.052],
    ], 6),
  ]
  const boughAngles = [rot0, rot0 + 2.12, rot0 + 4.24]
  for (let i = 0; i < 3; i++) {
    const ang = boughAngles[i]
    const bx = Math.cos(ang), bz = Math.sin(ang)
    const reach = (0.44 + (i % 2) * 0.08) * cs
    const tipY = y0 + (2.56 + (i === 1 ? 0.10 : i === 2 ? -0.04 : 0.04)) * (0.94 + 0.06 * cs)
    barkTris.push(...evalPolyTube([
      [x + 0.02, y0 + 1.94, z + 0.01, 0.046],
      [x + bx * reach * 0.55, y0 + 2.28, z + bz * reach * 0.55, 0.032],
      [x + bx * reach, tipY, z + bz * reach, 0.020],
    ], 4))
  }
  emitShadedWoodTris(barkTris, 0x3b3128, 0x5c4d40, 0x766454, emitTri)

  // Organic 4-lobe geodesic broadleaf green umbrella crown (matches pipeline/tree-specs.json osmanthus hues)
  const greenTris: [Vec3, Vec3, Vec3][] = [
    ...evalPolyBlob(x + 0.02, y0 + 2.74, z + 0.01, 0.78 * cs, 0.52 * cs, 0.74 * cs, rot0 + 0.4, sSeed + 13, 0.14),
  ]
  for (let i = 0; i < 3; i++) {
    const ang = boughAngles[i] + 0.15
    const dist = (0.44 + (i % 2) * 0.07) * cs
    const lx = x + Math.cos(ang) * dist
    const lz = z + Math.sin(ang) * dist
    const ly = y0 + 2.54 + (i === 1 ? 0.10 : i === 2 ? 0.03 : -0.02)
    greenTris.push(...evalPolyBlob(
      lx, ly, lz,
      (0.58 - i * 0.02) * cs,
      0.40 * cs,
      (0.54 + (i % 2) * 0.03) * cs,
      ang + 0.7,
      sSeed + 29 + i * 19,
      0.14,
    ))
  }

  // Natural Guilin crape-myrtle rose-lilac blossom panicle clusters nestled organically atop the green crown
  const blossomTris: [Vec3, Vec3, Vec3][] = []
  if (withCrapeBlossom) {
    const a0 = rot0 + 0.55
    blossomTris.push(
      ...evalPolyBlob(x + Math.cos(a0) * 0.14 * cs, y0 + 3.06, z + Math.sin(a0) * 0.14 * cs, 0.54 * cs, 0.37 * cs, 0.50 * cs, a0 + 0.3, sSeed + 71, 0.15),
      ...evalPolyBlob(x + Math.cos(a0 + 2.05) * 0.46 * cs, y0 + 2.86, z + Math.sin(a0 + 2.05) * 0.46 * cs, 0.44 * cs, 0.31 * cs, 0.42 * cs, a0 + 1.4, sSeed + 89, 0.15),
      ...evalPolyBlob(x + Math.cos(a0 + 4.15) * 0.42 * cs, y0 + 2.90, z + Math.sin(a0 + 4.15) * 0.42 * cs, 0.40 * cs, 0.29 * cs, 0.38 * cs, a0 + 2.6, sSeed + 107, 0.15),
    )
  } else {
    greenTris.push(
      ...evalPolyBlob(x - 0.04, y0 + 3.02, z + 0.03, 0.56 * cs, 0.40 * cs, 0.52 * cs, rot0 + 1.2, sSeed + 71, 0.14),
    )
  }

  let cYmin = Infinity, cYmax = -Infinity
  for (const [a, b, c] of greenTris) {
    cYmin = Math.min(cYmin, a[1], b[1], c[1])
    cYmax = Math.max(cYmax, a[1], b[1], c[1])
  }
  for (const [a, b, c] of blossomTris) {
    cYmin = Math.min(cYmin, a[1], b[1], c[1])
    cYmax = Math.max(cYmax, a[1], b[1], c[1])
  }
  const cSpan = Math.max(0.5, cYmax - cYmin)
  emitShadedCanopyTris(greenTris, cYmin, cSpan, 0x285229, 0x366432, 0x5a8540, 0x569447, emitTri)
  if (blossomTris.length) {
    emitShadedCanopyTris(blossomTris, cYmin, cSpan, 0x86445d, 0xa45874, 0xce8fa5, 0xc87a96, emitTri)
  }
}

/**
 * Samples raised surface offset (+0.195 vs +0.045) for a chain start/end cap or tile-border end post.
 * Combines the raw endpoint, the 0.08 m tucked end-cap center, a 0.5 m inward probe, and the adjacent
 * leg midpoint so 0.1 m quantized endpoints sitting millimetres outside a kind=4/kind=1 polygon never
 * sink 15 cm below the attached rail/curb.
 */
function sampleEndSurfaceOff(
  chain: DividerChain,
  isStart: boolean,
  surfaceAt: (x: number, z: number) => number,
): number {
  const sEnd = isStart ? 0 : chain.totalLength
  const inwardSign = isStart ? 1 : -1
  const pEnd = sampleChainAt(chain, sEnd)
  const px = pEnd.x + pEnd.tx * inwardSign * 0.08
  const pz = pEnd.z + pEnd.tz * inwardSign * 0.08
  const pIn = sampleChainAt(chain, isStart ? Math.min(chain.totalLength, 0.5) : Math.max(0, chain.totalLength - 0.5))
  const adjLeg = isStart ? chain.legs[0] : chain.legs[chain.legs.length - 1]
  const adjMidOff = adjLeg ? surfaceAt((adjLeg.start.x + adjLeg.end.x) * 0.5, (adjLeg.start.z + adjLeg.end.z) * 0.5) : 0.045
  return Math.max(surfaceAt(pEnd.x, pEnd.z), surfaceAt(px, pz), surfaceAt(pIn.x, pIn.z), adjMidOff)
}

/** Emits a grounded cast-iron plinth + white rail post with 2 cm vertical overlap (0 air gap, visible atop +0.195). */
function emitMedianRailPost(
  x: number,
  z: number,
  yaw: number,
  baseLevel: (x: number, z: number) => number,
  surfaceOff: number,
  box: BoxEmitter,
) {
  const y0 = baseLevel(x, z) + surfaceOff
  // Plinth [y0-0.03 .. y0+0.13] sits cleanly visible atop either +0.195 raised median or +0.045 asphalt
  box(x, y0 + 0.05, z, 0.16, 0.16, 0.20, yaw, PAL.railBase)
  // Post [y0+0.11 .. y0+0.94] embedded 2 cm into plinth (0 gap) and capped cleanly at top rail (+0.9225)
  box(x, y0 + 0.525, z, 0.064, 0.83, 0.064, yaw, PAL.railWhite)
}

function emitMedianMetalRailChain(
  chain: DividerChain,
  baseLevel: (x: number, z: number) => number,
  surfaceAt: (x: number, z: number) => number,
  box: BoxEmitter,
  palette: DividerPalette,
) {
  const mergedLegs = mergeCollinearChainLegs(chain.legs, baseLevel, 12)
  const mergedBands: {s0: number; s1: number; off: number}[] = []
  let sAcc = 0
  for (const leg of mergedLegs) {
    const midOff = surfaceAt((leg.start.x + leg.end.x) * 0.5, (leg.start.z + leg.end.z) * 0.5)
    mergedBands.push({s0: sAcc, s1: sAcc + leg.length, off: midOff})
    sAcc += leg.length
    const g = sampleDividerSpanGrade(leg.start.x, leg.start.z, leg.end.x, leg.end.z, baseLevel, midOff)
    if (g.flatLength < 0.05) continue
    // Top white beam [y0+0.8375 .. y0+0.9225] + lower silver beam [y0+0.2475 .. y0+0.3125]
    box(g.midX, g.midY + 0.88, g.midZ, g.slopeLength, 0.085, 0.075, g.yaw, PAL.railWhite, g.pitch)
    box(g.midX, g.midY + 0.28, g.midZ, g.slopeLength, 0.065, 0.075, g.yaw, PAL.railSilver, g.pitch)
    // Preserve exact 1.35 x 0.42 slogan banner geometry for streets.ts uSlogan shader!
    if (leg.banner && g.flatLength >= 1.2) {
      box(g.midX, g.midY + 0.58, g.midZ, Math.min(1.35, g.slopeLength), 0.42, 0.09, g.yaw, palette.bannerRed, g.pitch)
    }
  }
  const mergedOffAt = (s: number) => {
    for (let i = 0; i < mergedBands.length; i++) {
      if (s <= mergedBands[i].s1 + 1e-4) return mergedBands[i].off
    }
    return mergedBands.length ? mergedBands[mergedBands.length - 1].off : 0.045
  }
  // Posts + alternating airy vertical pickets along continuous chainage
  const bayCount = Math.max(1, Math.round(chain.totalLength / 2.2))
  const postStep = chain.totalLength / bayCount
  const sampleInnerSurf = (p: ReturnType<typeof sampleChainAt>, s: number) => Math.max(
    surfaceAt(p.x, p.z),
    surfaceAt(p.x + p.tx * 0.25, p.z + p.tz * 0.25),
    surfaceAt(p.x - p.tx * 0.25, p.z - p.tz * 0.25),
    mergedOffAt(s),
  )
  for (let i = 0; i < bayCount; i++) {
    const midS = (i + 0.5) * postStep
    const pm = sampleChainAt(chain, midS)
    const ym = baseLevel(pm.x, pm.z) + sampleInnerSurf(pm, midS)
    // Picket [ym+0.27 .. ym+0.89] spans cleanly into both lower and upper rails
    box(pm.x, ym + 0.58, pm.z, 0.036, 0.62, 0.036, pm.yaw, PAL.railSilver)
    if (i > 0) {
      const ps = i * postStep
      const p = sampleChainAt(chain, ps)
      emitMedianRailPost(p.x, p.z, p.yaw, baseLevel, sampleInnerSurf(p, ps), box)
    }
  }
  // End-cap treatments at real street openings vs grounded plinth posts at tile borders
  const first = sampleChainAt(chain, 0)
  const last = sampleChainAt(chain, chain.totalLength)
  const startSurfOff = Math.max(sampleEndSurfaceOff(chain, true, surfaceAt), mergedOffAt(0))
  const endSurfOff = Math.max(sampleEndSurfaceOff(chain, false, surfaceAt), mergedOffAt(chain.totalLength))
  if (chain.startOpen) {
    emitOpeningEndCap(first.x, first.z, first.tx, first.tz, first.yaw, baseLevel, box, 'rail', 1, startSurfOff)
  } else {
    emitMedianRailPost(first.x, first.z, first.yaw, baseLevel, startSurfOff, box)
  }
  if (!chain.closed) {
    if (chain.endOpen) {
      emitOpeningEndCap(last.x, last.z, last.tx, last.tz, last.yaw, baseLevel, box, 'rail', -1, endSurfOff)
    } else {
      emitMedianRailPost(last.x, last.z, last.yaw, baseLevel, endSurfOff, box)
    }
  }
}

function emitMedianGreenTreesChain(
  chain: DividerChain,
  beds: readonly (readonly number[])[],
  baseLevel: (x: number, z: number) => number,
  surfaceAt: (x: number, z: number) => number,
  box: BoxEmitter,
  origin?: readonly [number, number],
  emitTri?: SurfaceTriEmitter,
) {
  const ox = origin?.[0] ?? 0
  const oz = origin?.[1] ?? 0

  // Determine ornamental crape-myrtle tree stations first (prefer native beds if present; otherwise space ~14 m clear of open ends)
  const nativeBeds = projectBedsToChain(chain, beds, 0.95)
  const treeStations: {s: number; isNative: boolean}[] = nativeBeds.map(b => ({s: b.s, isNative: true}))
  if (!treeStations.length && chain.totalLength >= 10.5) {
    const startMargin = chain.startOpen ? 4.8 : 2.5
    const endMargin = chain.endOpen ? 4.8 : 2.5
    const usable = chain.totalLength - startMargin - endMargin
    if (usable >= 1.5) {
      const count = Math.max(1, Math.floor(usable / 14) + 1)
      const step = count > 1 ? usable / (count - 1) : 0
      for (let i = 0; i < count; i++) {
        treeStations.push({s: count === 1 ? startMargin + usable * 0.5 : startMargin + i * step, isNative: false})
      }
    }
  }

  // Continuous granite planter kerb enclosure along straight spans up to 12 m
  const mergedLegs = mergeCollinearChainLegs(chain.legs, baseLevel, 12)
  for (const leg of mergedLegs) {
    const midOff = surfaceAt((leg.start.x + leg.end.x) * 0.5, (leg.start.z + leg.end.z) * 0.5)
    const g = sampleDividerSpanGrade(leg.start.x, leg.start.z, leg.end.x, leg.end.z, baseLevel, midOff)
    if (g.flatLength < 0.08) continue
    const curbTop = midOff > 0.12 ? 0.14 : 0.24
    const curbH = curbTop + g.embedDepth
    box(g.midX, g.midY + curbTop - curbH * 0.5, g.midZ, g.slopeLength + 0.04, curbH, 0.76, g.yaw, PAL.curbLight, g.pitch)
  }

  // Emit evergreen base hedge & sculpted blossom crowns STRICTLY in clear bays BETWEEN tree wells (0 trunk-through-hedge)
  const hedgeBays = splitChainClearBays(
    chain.totalLength,
    chain.startOpen ? 0.32 : 0,
    chain.endOpen ? 0.32 : 0,
    treeStations.map(t => t.s),
    0.58,
    0.50,
  )
  for (const [bStart, bEnd] of hedgeBays) {
    const spanLen = bEnd - bStart
    const subCount = Math.max(1, Math.ceil(spanLen / 3.6))
    const subStep = spanLen / subCount
    for (let k = 0; k < subCount; k++) {
      const s0 = bStart + k * subStep
      const s1 = s0 + subStep
      const p0 = sampleChainAt(chain, s0)
      const p1 = sampleChainAt(chain, s1)
      const midOff = surfaceAt((p0.x + p1.x) * 0.5, (p0.z + p1.z) * 0.5)
      const g = sampleDividerSpanGrade(p0.x, p0.z, p1.x, p1.z, baseLevel, midOff)
      if (g.flatLength < 0.30) continue
      const curbTop = midOff > 0.12 ? 0.12 : 0.22
      // Evergreen base hedge seated cleanly inside granite curb
      box(g.midX, g.midY + curbTop + 0.21, g.midZ, g.slopeLength, 0.44, 0.58, g.yaw, PAL.hedgeDark, g.pitch)
      const midS = (s0 + s1) * 0.5
      if ((!chain.startOpen || midS >= 1.1) && (!chain.endOpen || chain.totalLength - midS >= 1.1) && g.flatLength >= 0.75) {
        const hSeed = hash2d(ox + g.midX, oz + g.midZ)
        const isBlossom = hSeed > 0.45
        const crownTint = isBlossom ? (hSeed > 0.72 ? PAL.crapeLit : PAL.crapeDark) : PAL.hedgeLit
        const crownH = isBlossom ? 0.24 + (hSeed % 0.10) : 0.22 + (hSeed % 0.08)
        box(
          g.midX,
          g.midY + curbTop + 0.42 + crownH * 0.44,
          g.midZ,
          Math.max(0.55, g.slopeLength * 0.72),
          crownH,
          isBlossom ? 0.46 : 0.50,
          g.yaw + (hSeed - 0.5) * 0.08,
          crownTint,
          g.pitch,
        )
      }
    }
  }

  // Emit dedicated soil tree wells + geodesic low-poly crape-myrtle trees (native beds get wells only, zero duplicate fake trees)
  for (const t of treeStations) {
    const p = sampleChainAt(chain, t.s)
    const surfOff = surfaceAt(p.x, p.z)
    const curbTop = surfOff > 0.12 ? 0.14 : 0.24
    const yWell = baseLevel(p.x, p.z) + surfOff + curbTop
    // Compact granite collar + mulch bed inside the hedge cutout so the trunk rises cleanly from soil
    box(p.x, yWell - 0.02, p.z, 0.96, 0.09, 0.80, p.yaw, PAL.curbMid)
    box(p.x, yWell + 0.02, p.z, 0.76, 0.05, 0.60, p.yaw, PAL.soil)
    if (!t.isNative) {
      const seed = hash2d(ox + p.x, oz + p.z)
      emitOrnamentalTree(p.x, p.z, p.yaw, baseLevel, box, seed, true, 0.92, surfOff + curbTop, emitTri)
    }
  }

  const firstGreenLeg = mergedLegs[0]
  const lastGreenLeg = mergedLegs[mergedLegs.length - 1]
  const firstGreenOff = firstGreenLeg ? surfaceAt((firstGreenLeg.start.x + firstGreenLeg.end.x) * 0.5, (firstGreenLeg.start.z + firstGreenLeg.end.z) * 0.5) : 0.045
  const lastGreenOff = lastGreenLeg ? surfaceAt((lastGreenLeg.start.x + lastGreenLeg.end.x) * 0.5, (lastGreenLeg.start.z + lastGreenLeg.end.z) * 0.5) : 0.045
  if (chain.startOpen) {
    const first = sampleChainAt(chain, 0)
    emitOpeningEndCap(first.x, first.z, first.tx, first.tz, first.yaw, baseLevel, box, 'green', 1, Math.max(sampleEndSurfaceOff(chain, true, surfaceAt), firstGreenOff))
  }
  if (!chain.closed && chain.endOpen) {
    const last = sampleChainAt(chain, chain.totalLength)
    emitOpeningEndCap(last.x, last.z, last.tx, last.tz, last.yaw, baseLevel, box, 'green', -1, Math.max(sampleEndSurfaceOff(chain, false, surfaceAt), lastGreenOff))
  }
}

function emitVergeHedgeCurbChain(
  chain: DividerChain,
  beds: readonly (readonly number[])[],
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
  palette: DividerPalette,
  origin?: readonly [number, number],
) {
  const ox = origin?.[0] ?? 0
  const oz = origin?.[1] ?? 0
  // Project GL04 native street-tree beds along verge centerline so BOTH hedges AND motor-side iron fences
  // break cleanly around every native trunk (including wide camphor/banyan trunks & buttress flares).
  const nativeBeds = projectBedsToChain(chain, beds, 1.35)
  const treeStations = nativeBeds.map(b => b.s)

  // Cut hedge bays cleanly around every native tree (halfClearance = 1.02 m -> 2.04 m spacious tree-pit opening)
  const hedgeBays = splitChainClearBays(
    chain.totalLength,
    chain.startOpen ? 0.30 : 0,
    chain.endOpen ? 0.30 : 0,
    treeStations,
    1.02,
    0.55,
  )
  for (const [bStart, bEnd] of hedgeBays) {
    const spanLen = bEnd - bStart
    const subCount = Math.max(1, Math.ceil(spanLen / 4.4))
    const subStep = spanLen / subCount
    for (let k = 0; k < subCount; k++) {
      const s0 = bStart + k * subStep
      const s1 = s0 + subStep
      const p0 = sampleChainAt(chain, s0)
      const p1 = sampleChainAt(chain, s1)
      const g = sampleDividerSpanGrade(p0.x, p0.z, p1.x, p1.z, baseLevel, 0.195)
      if (g.flatLength < 0.35) continue
      const hSeed = hash2d(ox + g.midX, oz + g.midZ)
      // Low granite inner kerb lip seated directly on +0.195 verge top (h=0.16 stays well clear of batch.ts 0.12 awning matcher)
      box(g.midX, g.midY + 0.03, g.midZ, g.slopeLength, 0.16, 1.06, g.yaw, PAL.curbMid, g.pitch)
      // Lower evergreen hedge + sculpted upper shrub crown
      box(g.midX, g.midY + 0.30, g.midZ, g.slopeLength, 0.42, 0.90, g.yaw, PAL.hedgeDark, g.pitch)
      const midS = (s0 + s1) * 0.5
      if ((!chain.startOpen || midS >= 1.0) && (!chain.endOpen || chain.totalLength - midS >= 1.0) && g.flatLength >= 0.85) {
        const upperTint = hSeed > 0.72 ? PAL.shrubCrimson : hSeed > 0.35 ? PAL.hedgeLit : PAL.hedgeMid
        box(g.midX, g.midY + 0.58, g.midZ, Math.min(3.4, g.slopeLength * 0.78), 0.22 + (hSeed % 0.07), 0.68, g.yaw, upperTint, g.pitch)
      }
    }
  }

  // Emit crisp 4-sided hollow granite tree-pit curb frames + dark soil bed around every native street tree
  // (1.66 x 1.66 m outer fits inside 2.20 m verge while comfortably framing wide camphor/banyan trunks)
  for (const b of nativeBeds) {
    const p = sampleChainAt(chain, b.s)
    const y0 = baseLevel(p.x, p.z) + 0.195
    // Four granite border curbs [y0-0.04 .. y0+0.14] (h=0.18 avoids batch.ts magic awning height)
    const borderOff = 0.75
    for (const side of [-1, 1]) {
      box(p.x + p.nx * side * borderOff, y0 + 0.05, p.z + p.nz * side * borderOff, 1.66, 0.18, 0.16, p.yaw, PAL.curbLight)
      box(p.x + p.tx * side * borderOff, y0 + 0.05, p.z + p.tz * side * borderOff, 0.16, 0.18, 1.34, p.yaw, PAL.curbLight)
    }
    box(p.x, y0 + 0.03, p.z, 1.34, 0.06, 1.34, p.yaw, PAL.soil)
  }

  // Motor-lane side low garden fence frames strictly each hedge bay (-sideSign * 0.74 m) and terminates cleanly
  // with end posts on both sides of EVERY native tree pit (halfClearance = 1.00 m -> 0% trunk piercing).
  const FENCE_OFFSET = 0.74
  const fenceBays = splitChainClearBays(
    chain.totalLength,
    chain.startOpen ? 0.30 : 0,
    chain.endOpen ? 0.30 : 0,
    treeStations,
    1.00,
    0.55,
  )
  for (const [bStart, bEnd] of fenceBays) {
    const spanLen = bEnd - bStart
    const subCount = Math.max(1, Math.ceil(spanLen / 10))
    const subStep = spanLen / subCount
    for (let k = 0; k < subCount; k++) {
      const p0 = sampleChainAt(chain, bStart + k * subStep)
      const p1 = sampleChainAt(chain, bStart + (k + 1) * subStep)
      const off0 = -p0.sideSign * FENCE_OFFSET, off1 = -p1.sideSign * FENCE_OFFSET
      const g = sampleDividerSpanGrade(
        p0.x + off0 * p0.nx, p0.z + off0 * p0.nz,
        p1.x + off1 * p1.nx, p1.z + off1 * p1.nz,
        baseLevel, 0.195,
      )
      if (g.flatLength < 0.15) continue
      box(g.midX, g.midY + 0.22, g.midZ, g.slopeLength, 0.05, 0.05, g.yaw, palette.iron, g.pitch)
      box(g.midX, g.midY + 0.52, g.midZ, g.slopeLength, 0.05, 0.05, g.yaw, palette.iron, g.pitch)
    }
    const postCount = Math.max(2, Math.round(spanLen / 2.6) + 1)
    for (let i = 0; i < postCount; i++) {
      const s = bStart + (spanLen * i) / (postCount - 1)
      const p = sampleChainAt(chain, s)
      const off = -p.sideSign * FENCE_OFFSET
      const fx = p.x + off * p.nx, fz = p.z + off * p.nz
      const y0 = baseLevel(fx, fz) + 0.195
      box(fx, y0 + 0.27, fz, 0.052, 0.60, 0.052, p.yaw, palette.iron)
    }
  }

  const startHasNativeTree = nativeBeds.some(b => b.s < 1.05)
  const endHasNativeTree = nativeBeds.some(b => chain.totalLength - b.s < 1.05)
  if (chain.startOpen && !startHasNativeTree) {
    const first = sampleChainAt(chain, 0)
    emitOpeningEndCap(first.x, first.z, first.tx, first.tz, first.yaw, baseLevel, box, 'verge', 1, 0.195)
  }
  if (!chain.closed && chain.endOpen && !endHasNativeTree) {
    const last = sampleChainAt(chain, chain.totalLength)
    emitOpeningEndCap(last.x, last.z, last.tx, last.tz, last.yaw, baseLevel, box, 'verge', -1, 0.195)
  }
}

function emitVergeMetalGuardrailChain(
  chain: DividerChain,
  beds: readonly (readonly number[])[],
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
) {
  // Position the Guilin white-grey guardrail on the motor-lane inner edge of the 2.2 m verge (-sideSign * 0.86 m).
  // This gives >= 0.86 m lateral clearance from verge-centerline native trees (clearing even 1.2x banyan trunks)
  // while plinth half-depth 0.10 m stays safely inside the -1.10 m native granite curb (0 curb overflow).
  const RAIL_OFFSET = 0.86
  const nativeBeds = projectBedsToChain(chain, beds, 1.45)
  const railObstacles = nativeBeds
    .filter(b => {
      const p = sampleChainAt(chain, b.s)
      return Math.abs(b.lat - (-p.sideSign * RAIL_OFFSET)) < 0.65
    })
    .map(b => b.s)
  const railBays = splitChainClearBays(chain.totalLength, 0, 0, railObstacles, 0.62, 0.55)

  for (const [bStart, bEnd] of railBays) {
    const spanLen = bEnd - bStart
    const subCount = Math.max(1, Math.ceil(spanLen / 10))
    const subStep = spanLen / subCount
    for (let k = 0; k < subCount; k++) {
      const p0 = sampleChainAt(chain, bStart + k * subStep)
      const p1 = sampleChainAt(chain, bStart + (k + 1) * subStep)
      const off0 = -p0.sideSign * RAIL_OFFSET, off1 = -p1.sideSign * RAIL_OFFSET
      const g = sampleDividerSpanGrade(
        p0.x + off0 * p0.nx, p0.z + off0 * p0.nz,
        p1.x + off1 * p1.nx, p1.z + off1 * p1.nz,
        baseLevel, 0.195,
      )
      if (g.flatLength < 0.15) continue
      // Primary Guilin white-grey steel guardrail + Guilin jade accent strip (seated cleanly on +0.195 verge)
      box(g.midX, g.midY + 0.88, g.midZ, g.slopeLength, 0.075, 0.07, g.yaw, PAL.railWhite, g.pitch)
      box(g.midX, g.midY + 0.28, g.midZ, g.slopeLength, 0.06, 0.07, g.yaw, PAL.railSilver, g.pitch)
      box(g.midX, g.midY + 0.74, g.midZ, g.slopeLength, 0.045, 0.055, g.yaw, PAL.guilinJade, g.pitch)
    }

    // Grounded cast-iron plinths + white main posts (with 2 cm vertical overlap) + midpoint pickets
    const bayCount = Math.max(1, Math.round(spanLen / 2.4))
    const postStep = spanLen / bayCount
    for (let i = 0; i <= bayCount; i++) {
      const s = Math.min(bEnd, bStart + i * postStep)
      const isStartCap = i === 0 && bStart <= 0.05 && chain.startOpen
      const isEndCap = i === bayCount && bEnd >= chain.totalLength - 0.05 && !chain.closed && chain.endOpen
      const p = sampleChainAt(chain, s)
      const off = -p.sideSign * RAIL_OFFSET
      const rx = p.x + off * p.nx, rz = p.z + off * p.nz
      if (isStartCap) {
        emitOpeningEndCap(rx, rz, p.tx, p.tz, p.yaw, baseLevel, box, 'rail', 1, 0.195)
      } else if (isEndCap) {
        emitOpeningEndCap(rx, rz, p.tx, p.tz, p.yaw, baseLevel, box, 'rail', -1, 0.195)
      } else {
        const y0 = baseLevel(rx, rz) + 0.195
        box(rx, y0 + 0.05, rz, 0.16, 0.16, 0.20, p.yaw, PAL.railBase)
        box(rx, y0 + 0.525, rz, 0.068, 0.83, 0.068, p.yaw, PAL.railWhite)
      }
      if (i < bayCount) {
        const pm = sampleChainAt(chain, bStart + (i + 0.5) * postStep)
        const offM = -pm.sideSign * RAIL_OFFSET
        const mx = pm.x + offM * pm.nx, mz = pm.z + offM * pm.nz
        const ym = baseLevel(mx, mz) + 0.195
        box(mx, ym + 0.58, mz, 0.036, 0.62, 0.036, pm.yaw, PAL.railWhite)
      }
    }
  }
}

function emitVergeTreePlanterChain(
  chain: DividerChain,
  beds: readonly (readonly number[])[],
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
  origin?: readonly [number, number],
  emitTri?: SurfaceTriEmitter,
) {
  const ox = origin?.[0] ?? 0
  const oz = origin?.[1] ?? 0

  // Align tree-pit openings to REAL GL04 native street trees (`beds`) first — never spawn duplicate fake trees
  // on any corridor chain that already carries native street trees (keep intersection approaches clean planters).
  const nativeBeds = projectBedsToChain(chain, beds, 1.35)
  const treeStations: {s: number; isNative: boolean}[] = nativeBeds.map(b => ({s: b.s, isNative: true}))

  // Only plant polyhedral ornamental trees on genuinely treeless long chains (>= 18 m, 0 native beds)
  const startMargin = chain.startOpen ? 5.2 : 2.5
  const endMargin = chain.endOpen ? 5.2 : 2.5
  if (!treeStations.length && chain.totalLength >= 18.0) {
    const usable = chain.totalLength - startMargin - endMargin
    if (usable >= 2.0) {
      const count = Math.max(1, Math.floor(usable / 15) + 1)
      const step = count > 1 ? usable / (count - 1) : 0
      for (let i = 0; i < count; i++) {
        treeStations.push({s: count === 1 ? startMargin + usable * 0.5 : startMargin + i * step, isNative: false})
      }
    }
  }

  // Emit linked redwood flower planters strictly in the bays BETWEEN tree pits (halfClearance = 1.04 m -> 0 trunk/pit piercing)
  const bays = splitChainClearBays(
    chain.totalLength,
    chain.startOpen ? 0.30 : 0,
    chain.endOpen ? 0.30 : 0,
    treeStations.map(t => t.s),
    1.04,
    0.70,
  )

  for (const [bStart, bEnd] of bays) {
    const spanLen = bEnd - bStart
    const subCount = Math.max(1, Math.ceil(spanLen / 4.2))
    const subStep = spanLen / subCount
    for (let k = 0; k < subCount; k++) {
      const s0 = bStart + k * subStep
      const s1 = s0 + subStep
      const p0 = sampleChainAt(chain, s0)
      const p1 = sampleChainAt(chain, s1)
      const g = sampleDividerSpanGrade(p0.x, p0.z, p1.x, p1.z, baseLevel, 0.195)
      if (g.flatLength < 0.35) continue
      const hSeed = hash2d(ox + g.midX, oz + g.midZ)
      const floral = hSeed > 0.42
      // Grounded redwood planter wall seated directly on +0.195 verge top + dark steel trim + lush shrub/blossom crown
      box(g.midX, g.midY + 0.22, g.midZ, g.slopeLength, 0.48, 0.74, g.yaw, PAL.planterWood, g.pitch)
      box(g.midX, g.midY + 0.49, g.midZ, g.slopeLength + 0.04, 0.06, 0.80, g.yaw, PAL.planterTrim, g.pitch)
      box(
        g.midX,
        g.midY + 0.61,
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

  // Framed granite street-tree pits + dark iron grates around every tree station; only plant fallback tree when treeless
  for (const t of treeStations) {
    const p = sampleChainAt(chain, t.s)
    const y0 = baseLevel(p.x, p.z) + 0.195
    // Spacious granite tree pit collar [y0-0.04 .. y0+0.12] + iron tree grate [y0+0.10 .. y0+0.145]
    box(p.x, y0 + 0.04, p.z, 1.66, 0.16, 1.66, p.yaw, PAL.curbLight)
    box(p.x, y0 + 0.12, p.z, 1.34, 0.05, 1.34, p.yaw, PAL.planterTrim)
    if (!t.isNative) {
      const seed = hash2d(ox + p.x, oz + p.z)
      emitOrnamentalTree(p.x, p.z, p.yaw, baseLevel, box, seed, seed > 0.65, 0.96, 0.195 + 0.10, emitTri)
    }
  }

  const startHasNativeTree = nativeBeds.some(b => b.s < 1.05)
  const endHasNativeTree = nativeBeds.some(b => chain.totalLength - b.s < 1.05)
  if (chain.startOpen && !startHasNativeTree) {
    const first = sampleChainAt(chain, 0)
    emitOpeningEndCap(first.x, first.z, first.tx, first.tz, first.yaw, baseLevel, box, 'verge', 1, 0.195)
  }
  if (!chain.closed && chain.endOpen && !endHasNativeTree) {
    const last = sampleChainAt(chain, chain.totalLength)
    emitOpeningEndCap(last.x, last.z, last.tx, last.tz, last.yaw, baseLevel, box, 'verge', -1, 0.195)
  }
}

/**
 * Emits a flexible orange/white reflective soft-delineator bollard seated cleanly atop `surfaceOff`
 * (+0.195 m on raised kind=4 collector verges, +0.045 m on flush asphalt).
 * Rubber base rises 8 cm above the surface and the post embeds 2 cm into the base (0 gap).
 */
export function emitSoftDelineatorPost(
  x: number,
  z: number,
  yaw: number,
  baseLevel: (x: number, z: number) => number,
  box: BoxEmitter,
  surfaceOff = 0.195,
) {
  const y0 = baseLevel(x, z) + surfaceOff
  // Black rubber base [y0-0.02 .. y0+0.08] rises 8 cm visibly above surface
  box(x, y0 + 0.03, z, 0.20, 0.10, 0.20, yaw, PAL.warnDark)
  // Orange-red flexible post [y0+0.06 .. y0+0.72] embedded 2 cm into rubber base (0 gap)
  box(x, y0 + 0.39, z, 0.086, 0.66, 0.086, yaw, PAL.softOrange)
  // Dual white reflective collar bands wrapping the post
  box(x, y0 + 0.56, z, 0.094, 0.09, 0.094, yaw, PAL.softWhite)
  box(x, y0 + 0.42, z, 0.094, 0.07, 0.094, yaw, PAL.softWhite)
}

function emitSoftDelineatorChain(
  chain: DividerChain,
  baseLevel: (x: number, z: number) => number,
  surfaceAt: (x: number, z: number) => number,
  box: BoxEmitter,
) {
  const startMargin = chain.startOpen ? 0.6 : 0.2
  const endMargin = chain.endOpen ? 0.6 : 0.2
  const usable = chain.totalLength - startMargin - endMargin
  if (usable < 0.4) {
    const mid = sampleChainAt(chain, chain.totalLength * 0.5)
    emitSoftDelineatorPost(mid.x, mid.z, mid.yaw, baseLevel, box, surfaceAt(mid.x, mid.z))
    return
  }
  const count = Math.max(1, Math.round(usable / 3.5) + 1)
  const step = count > 1 ? usable / (count - 1) : 0
  for (let i = 0; i < count; i++) {
    const s = count === 1 ? startMargin + usable * 0.5 : startMargin + i * step
    const p = sampleChainAt(chain, s)
    emitSoftDelineatorPost(p.x, p.z, p.yaw, baseLevel, box, surfaceAt(p.x, p.z))
  }
}

/**
 * Extracts gentle reflective soft-delineator bollards along narrow collector three-band verges
 * (path kind=4 with strip width 0.14..0.62 m and length >= 8 m, e.g. Binjiang Rd / Minzhu Rd / Jiangan Rd)
 * where no arterial decor exists, visually separating motor and non-motor lanes without hard walls.
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
  beds: readonly (readonly number[])[] = [],
  emitTri?: SurfaceTriEmitter,
): void {
  const ox = origin?.[0] ?? 0
  const oz = origin?.[1] ?? 0
  const surfaceAt = buildRaisedSurfaceLookup(paths)
  const medianSegments: DividerSegmentInput[] = []
  const vergeSegments: DividerSegmentInput[] = []
  const existingArterialPoints: [number, number][] = []

  for (const item of decor) {
    const kind = item[0]
    const east = item[1], south = item[2], heading = item[3], span = item[4] ?? 0
    const lx = east / 10, lz = south / 10
    if (suppressed(kind, lx, lz)) continue

    const wx = ox + lx, wz = oz + lz
    const headingRad = heading / 100

    if (kind === 1 || kind === 2 || kind === 7 || kind === DECOR_KIND_MEDIAN_GREEN_TREES) {
      existingArterialPoints.push([lx, lz])
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
      existingArterialPoints.push([lx, lz])
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
      emitMedianGreenTreesChain(chain, beds, baseLevel, surfaceAt, box, origin, emitTri)
    } else {
      emitMedianMetalRailChain(chain, baseLevel, surfaceAt, box, palette)
    }
  }

  for (const chain of traceDividerChains(vergeSegments)) {
    const kind = chain.group.split(':')[0] as VergeDividerKind
    if (kind === 'metal_guardrail') {
      emitVergeMetalGuardrailChain(chain, beds, baseLevel, box)
    } else if (kind === 'tree_planter') {
      emitVergeTreePlanterChain(chain, beds, baseLevel, box, origin, emitTri)
    } else if (kind === 'soft_delineator') {
      emitSoftDelineatorChain(chain, baseLevel, surfaceAt, box)
    } else {
      emitVergeHedgeCurbChain(chain, beds, baseLevel, box, palette, origin)
    }
  }

  // Emit gentle soft-delineator bollards seated atop +0.195 narrow collector kind=4 verges (no rigid barrier wall)
  if (paths.length) {
    for (const post of extractCollectorSoftDelineators(paths, existingArterialPoints, origin)) {
      emitSoftDelineatorPost(post.x, post.z, post.yaw, baseLevel, box, 0.195)
    }
  }
}
