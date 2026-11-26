import * as THREE from 'three'
import {mainDetail} from '../look/mirror-layer.ts'
import type {ObstacleBox, ObstacleVolumeSpec} from '../walk/obstacle-volumes.ts'

/**
 * 解放桥全桥机非隔离护栏与中央双向分隔栏（`web/src/traffic-duty/jiefang-railings.ts`）
 *
 * 几何真源对齐：
 *  - `public/world/manifest.json` -> `jiefang_bridge` (`origin = [-168, 145.6, 39.9946]`, `rot_deg = -18.45`)
 *  - `pipeline/landmarks/jiefang_bridge.py` (`z = ±12.0` 机非标线、`z = 0.0` 双黄线、桥面宽 `[-21.5, 21.5]`、机动车道 `[-16.1, 16.1]`)
 *  - `pipeline/landmarks/jiefang_layout.py` (`deck_level(x)` 纵坡曲线)
 *  - `pipeline/landmarks/jiefang_materials.py` (路面顶面 `+0.05m`)
 *  - `web/src/traffic-duty/npc-officer.ts` (`JIEFANG_OFFICER_SPOT` 在桥局部坐标约 `(-97.52, +17.99)`)
 *
 * 合规与性能硬约束：
 *  - 零动态 Three.js 光源
 *  - 全部网格归入 `MAIN_DETAIL_LAYER`（layer 3）
 *  - 使用 `InstancedMesh` 批处理全桥 ~272m 三条护栏，控制绘制调用数
 */

export const JIEFANG_RAILING_VOLUME_ID = 'jiefang_bridge_railings'

export const JIEFANG_BRIDGE_ORIGIN: readonly [number, number, number] = Object.freeze([
  -167.99998711615615,
  145.6,
  39.99461580029688,
])

export const JIEFANG_BRIDGE_ROTATION_DEG = -18.45
export const JIEFANG_BRIDGE_ROTATION_Y = (JIEFANG_BRIDGE_ROTATION_DEG * Math.PI) / 180
export const JIEFANG_ROAD_SURFACE_OFFSET_Y = 0.05

export interface JiefangRailingTrackSpec {
  readonly id: 'north_motor_nonmotor' | 'center_median' | 'south_motor_nonmotor'
  readonly kind: 'motor_nonmotor' | 'center_median'
  readonly label: string
  readonly z: number
  readonly halfWidth: number
  readonly visualHeight: number
  readonly colliderHeight: number
}

export const JIEFANG_RAILING_TRACKS: readonly JiefangRailingTrackSpec[] = Object.freeze([
  Object.freeze({
    id: 'north_motor_nonmotor' as const,
    kind: 'motor_nonmotor' as const,
    label: '北侧机非隔离护栏',
    z: -12.0,
    halfWidth: 0.12,
    visualHeight: 1.02,
    colliderHeight: 1.05,
  }),
  Object.freeze({
    id: 'center_median' as const,
    kind: 'center_median' as const,
    label: '中央双向隔离护栏',
    z: 0.0,
    halfWidth: 0.15,
    visualHeight: 1.06,
    colliderHeight: 1.08,
  }),
  Object.freeze({
    id: 'south_motor_nonmotor' as const,
    kind: 'motor_nonmotor' as const,
    label: '南侧机非隔离护栏',
    z: 12.0,
    halfWidth: 0.12,
    visualHeight: 1.02,
    colliderHeight: 1.05,
  }),
])

export interface JiefangRailingGapSpec {
  readonly id: string
  readonly minX: number
  readonly maxX: number
  readonly reason: string
}

/** 全桥 3 道护栏从西桥头 (`-140.5`) 连续贯通至东桥头 (`+140.5`)，零缺口；行人可跳跃踩上栏杆顶面跨越。 */
export const JIEFANG_RAILING_GAP_RANGES: readonly JiefangRailingGapSpec[] = Object.freeze([])

export interface JiefangRailingSpanSpec {
  readonly id: string
  readonly minX: number
  readonly maxX: number
}

export const JIEFANG_RAILING_MIN_X = -140.5
export const JIEFANG_RAILING_MAX_X = 140.5

export const JIEFANG_RAILING_SPAN_RANGES: readonly JiefangRailingSpanSpec[] = Object.freeze([
  Object.freeze({id: 'full_span', minX: JIEFANG_RAILING_MIN_X, maxX: JIEFANG_RAILING_MAX_X}),
])

export interface JiefangBridgeDeckBounds {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
  readonly roadwayMinZ: number
  readonly roadwayMaxZ: number
  readonly motorSouthMaxZ: number
  readonly motorNorthMinZ: number
}

export const JIEFANG_BRIDGE_DECK_BOUNDS: Readonly<JiefangBridgeDeckBounds> = Object.freeze({
  minX: -140.5,
  maxX: 140.5,
  minZ: -21.5,
  maxZ: 21.5,
  roadwayMinZ: -16.1,
  roadwayMaxZ: 16.1,
  motorNorthMinZ: -12.0,
  motorSouthMaxZ: 12.0,
})

export type JiefangCrossSectionRole = 'sidewalk' | 'curb' | 'nonmotor' | 'railing' | 'motor' | 'median'

export interface JiefangCrossSectionBand {
  readonly id: string
  readonly role: JiefangCrossSectionRole
  readonly side: 'north' | 'south' | 'center'
  readonly direction: 'westbound' | 'eastbound' | 'bidirectional'
  readonly label: string
  /** 桥体局部横向左边界（m，负为北/上游，正为南/下游） */
  readonly minZ: number
  /** 桥体局部横向右边界（m，严格大于 minZ） */
  readonly maxZ: number
  readonly widthM: number
  /** 相对 `jiefangDeckBaseLocalY(lx)` 的铺装/沥青顶面高程偏移（m） */
  readonly surfaceOffsetY: number
}

export interface JiefangNonmotorCrossSectionBand extends JiefangCrossSectionBand {
  readonly role: 'nonmotor'
  readonly centerlineZ: number
  readonly safeMinZ: number
  readonly safeMaxZ: number
}

export interface JiefangMotorCrossSectionBand extends JiefangCrossSectionBand {
  readonly role: 'motor'
  readonly laneCentersZ: readonly [number, number, number]
  readonly laneWidthM: number
}

export interface JiefangCrossSectionSpec {
  readonly bridgeLengthM: number
  readonly bridgeWidthM: number
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
  readonly asphaltRoadway: Readonly<{minZ: number; maxZ: number; widthM: number; surfaceOffsetY: number}>
  readonly curb: Readonly<{centerAbsZ: number; halfWidthM: number; innerEdgeAbsZ: number; outerEdgeAbsZ: number; surfaceOffsetY: number}>
  readonly tactileStrip: Readonly<{centerAbsZ: number; halfWidthM: number; surfaceOffsetY: number}>
  readonly paveSidewalk: Readonly<{innerAbsZ: number; outerAbsZ: number; widthM: number; surfaceOffsetY: number; lampPostAbsZ: number; balustradeAbsZ: number}>
  readonly markings: Readonly<{centerDoubleAbsZ: number; motorInnerDividerAbsZ: number; motorOuterDividerAbsZ: number; motorNonmotorDividerAbsZ: number}>
  readonly northSidewalk: JiefangCrossSectionBand
  readonly northCurb: JiefangCrossSectionBand
  readonly northNonmotor: JiefangNonmotorCrossSectionBand
  readonly northRailing: JiefangCrossSectionBand
  readonly northMotor: JiefangMotorCrossSectionBand
  readonly centerMedian: JiefangCrossSectionBand
  readonly southMotor: JiefangMotorCrossSectionBand
  readonly southRailing: JiefangCrossSectionBand
  readonly southNonmotor: JiefangNonmotorCrossSectionBand
  readonly southCurb: JiefangCrossSectionBand
  readonly southSidewalk: JiefangCrossSectionBand
  /** 从北(-21.5m)到南(+21.5m)严格连续、互不重叠的横断面分区表（单位：m） */
  readonly bands: readonly JiefangCrossSectionBand[]
  /** 实测 `/world/roads/-1_0.json.gz` 偏差记录（北侧 OSM cycleway 西半段偏移入人行道，需按黑色沥青带矫正） */
  readonly measuredRoadTileNotes: Readonly<{
    northOsmCyclewayIds82063To82071SimZRange: readonly [number, number]
    southOsmCyclewayIds82072To82079SimZRange: readonly [number, number]
    motorLaneCentersNorth: readonly [number, number, number]
    motorLaneCentersSouth: readonly [number, number, number]
    motorLaneWidthM: number
  }>
}

const NORTH_SIDEWALK_BAND: JiefangCrossSectionBand = Object.freeze({
  id: 'north_sidewalk',
  role: 'sidewalk',
  side: 'north',
  direction: 'bidirectional',
  label: '北侧江边人行道（浅灰铺砖，含盲道 ±16.93、灯柱 ±18.9、石栏杆 ±21.1）',
  minZ: -21.5,
  maxZ: -16.175,
  widthM: 5.325,
  surfaceOffsetY: 0.18,
})

const NORTH_CURB_BAND: JiefangCrossSectionBand = Object.freeze({
  id: 'north_curb',
  role: 'curb',
  side: 'north',
  direction: 'bidirectional',
  label: '北侧花岗岩侧石（沥青路面/铺砖分界台阶）',
  minZ: -16.175,
  maxZ: -16.01,
  widthM: 0.165,
  surfaceOffsetY: 0.2,
})

const NORTH_NONMOTOR_BAND: JiefangNonmotorCrossSectionBand = Object.freeze({
  id: 'north_nonmotor',
  role: 'nonmotor',
  side: 'north',
  direction: 'westbound',
  label: '北侧黑色沥青非机动车道（向西）',
  minZ: -16.01,
  maxZ: -12.12,
  widthM: 3.89,
  centerlineZ: -14.065,
  safeMinZ: -15.65,
  safeMaxZ: -12.48,
  surfaceOffsetY: 0.05,
})

const NORTH_RAILING_BAND: JiefangCrossSectionBand = Object.freeze({
  id: 'north_motor_nonmotor',
  role: 'railing',
  side: 'north',
  direction: 'bidirectional',
  label: '北侧机非隔离栏（z=-12.0，白色标线）',
  minZ: -12.12,
  maxZ: -11.88,
  widthM: 0.24,
  surfaceOffsetY: 0.05,
})

const NORTH_MOTOR_BAND: JiefangMotorCrossSectionBand = Object.freeze({
  id: 'north_motor',
  role: 'motor',
  side: 'north',
  direction: 'westbound',
  label: '北侧机动车道（向西 3 车道：-9.7 / -6.0 / -2.3）',
  minZ: -11.88,
  maxZ: -0.18,
  widthM: 11.7,
  laneCentersZ: [-9.7, -6.0, -2.3] as const,
  laneWidthM: 3.7,
  surfaceOffsetY: 0.05,
})

const CENTER_MEDIAN_BAND: JiefangCrossSectionBand = Object.freeze({
  id: 'center_median',
  role: 'median',
  side: 'center',
  direction: 'bidirectional',
  label: '中央双向隔离栏与双白线（z=0.0，标线 ±0.18）',
  minZ: -0.18,
  maxZ: 0.18,
  widthM: 0.36,
  surfaceOffsetY: 0.05,
})

const SOUTH_MOTOR_BAND: JiefangMotorCrossSectionBand = Object.freeze({
  id: 'south_motor',
  role: 'motor',
  side: 'south',
  direction: 'eastbound',
  label: '南侧机动车道（向东 3 车道：+2.3 / +6.0 / +9.7）',
  minZ: 0.18,
  maxZ: 11.88,
  widthM: 11.7,
  laneCentersZ: [2.3, 6.0, 9.7] as const,
  laneWidthM: 3.7,
  surfaceOffsetY: 0.05,
})

const SOUTH_RAILING_BAND: JiefangCrossSectionBand = Object.freeze({
  id: 'south_motor_nonmotor',
  role: 'railing',
  side: 'south',
  direction: 'bidirectional',
  label: '南侧机非隔离栏（z=+12.0，白色标线）',
  minZ: 11.88,
  maxZ: 12.12,
  widthM: 0.24,
  surfaceOffsetY: 0.05,
})

const SOUTH_NONMOTOR_BAND: JiefangNonmotorCrossSectionBand = Object.freeze({
  id: 'south_nonmotor',
  role: 'nonmotor',
  side: 'south',
  direction: 'eastbound',
  label: '南侧黑色沥青非机动车道（向东）',
  minZ: 12.12,
  maxZ: 16.01,
  widthM: 3.89,
  centerlineZ: 14.065,
  safeMinZ: 12.48,
  safeMaxZ: 15.65,
  surfaceOffsetY: 0.05,
})

const SOUTH_CURB_BAND: JiefangCrossSectionBand = Object.freeze({
  id: 'south_curb',
  role: 'curb',
  side: 'south',
  direction: 'bidirectional',
  label: '南侧花岗岩侧石（沥青路面/铺砖分界台阶）',
  minZ: 16.01,
  maxZ: 16.175,
  widthM: 0.165,
  surfaceOffsetY: 0.2,
})

const SOUTH_SIDEWALK_BAND: JiefangCrossSectionBand = Object.freeze({
  id: 'south_sidewalk',
  role: 'sidewalk',
  side: 'south',
  direction: 'bidirectional',
  label: '南侧江边人行道（浅灰铺砖，含盲道 ±16.93、灯柱 ±18.9、石栏杆 ±21.1）',
  minZ: 16.175,
  maxZ: 21.5,
  widthM: 5.325,
  surfaceOffsetY: 0.18,
})

/**
 * 解放桥实测真实桥面横断面（单位：m）。
 * 来源：`pipeline/landmarks/jiefang_bridge.py` (`jiefang_bridge.glb`) 与 `/world/roads/-1_0.json.gz`。
 * 供车流系统（两轮车限定黑色非机动车道、机动车限定机动车道）与执勤范围判定共用。
 */
export const JIEFANG_CROSS_SECTION: JiefangCrossSectionSpec = Object.freeze({
  bridgeLengthM: 281,
  bridgeWidthM: 43,
  minX: -140.5,
  maxX: 140.5,
  minZ: -21.5,
  maxZ: 21.5,
  asphaltRoadway: Object.freeze({minZ: -16.1, maxZ: 16.1, widthM: 32.2, surfaceOffsetY: 0.05}),
  curb: Object.freeze({centerAbsZ: 16.16, halfWidthM: 0.15, innerEdgeAbsZ: 16.01, outerEdgeAbsZ: 16.31, surfaceOffsetY: 0.2}),
  tactileStrip: Object.freeze({centerAbsZ: 16.93, halfWidthM: 0.23, surfaceOffsetY: 0.2}),
  paveSidewalk: Object.freeze({innerAbsZ: 16.175, outerAbsZ: 21.5, widthM: 5.325, surfaceOffsetY: 0.18, lampPostAbsZ: 18.9, balustradeAbsZ: 21.1}),
  markings: Object.freeze({centerDoubleAbsZ: 0.18, motorInnerDividerAbsZ: 3.7, motorOuterDividerAbsZ: 7.4, motorNonmotorDividerAbsZ: 12.0}),
  northSidewalk: NORTH_SIDEWALK_BAND,
  northCurb: NORTH_CURB_BAND,
  northNonmotor: NORTH_NONMOTOR_BAND,
  northRailing: NORTH_RAILING_BAND,
  northMotor: NORTH_MOTOR_BAND,
  centerMedian: CENTER_MEDIAN_BAND,
  southMotor: SOUTH_MOTOR_BAND,
  southRailing: SOUTH_RAILING_BAND,
  southNonmotor: SOUTH_NONMOTOR_BAND,
  southCurb: SOUTH_CURB_BAND,
  southSidewalk: SOUTH_SIDEWALK_BAND,
  bands: Object.freeze([
    NORTH_SIDEWALK_BAND,
    NORTH_CURB_BAND,
    NORTH_NONMOTOR_BAND,
    NORTH_RAILING_BAND,
    NORTH_MOTOR_BAND,
    CENTER_MEDIAN_BAND,
    SOUTH_MOTOR_BAND,
    SOUTH_RAILING_BAND,
    SOUTH_NONMOTOR_BAND,
    SOUTH_CURB_BAND,
    SOUTH_SIDEWALK_BAND,
  ]),
  measuredRoadTileNotes: Object.freeze({
    northOsmCyclewayIds82063To82071SimZRange: Object.freeze([-16.97, -15.14] as const),
    southOsmCyclewayIds82072To82079SimZRange: Object.freeze([13.8, 15.64] as const),
    motorLaneCentersNorth: Object.freeze([-9.7, -6.0, -2.3] as const),
    motorLaneCentersSouth: Object.freeze([2.3, 6.0, 9.7] as const),
    motorLaneWidthM: 3.7,
  }),
})

export function classifyJiefangCrossSectionZ(localZ: number): JiefangCrossSectionRole | 'outside' {
  if (!Number.isFinite(localZ) || localZ < JIEFANG_CROSS_SECTION.minZ || localZ > JIEFANG_CROSS_SECTION.maxZ) {
    return 'outside'
  }
  for (const band of JIEFANG_CROSS_SECTION.bands) {
    if (localZ >= band.minZ && localZ <= band.maxZ) return band.role
  }
  return 'outside'
}

export interface JiefangLaneCenterlineSpec {
  readonly id: string
  readonly kind: 'motor' | 'nonmotor'
  readonly direction: 'westbound' | 'eastbound'
  readonly localZ: number
  readonly minX: number
  readonly maxX: number
}

export const JIEFANG_LANE_CENTERLINES: readonly JiefangLaneCenterlineSpec[] = Object.freeze([
  Object.freeze({id: 'nb_nonmotor', kind: 'nonmotor', direction: 'westbound', localZ: NORTH_NONMOTOR_BAND.centerlineZ, minX: -140.5, maxX: 140.5}),
  Object.freeze({id: 'wb_motor_outer', kind: 'motor', direction: 'westbound', localZ: -9.7, minX: -140.5, maxX: 140.5}),
  Object.freeze({id: 'wb_motor_mid', kind: 'motor', direction: 'westbound', localZ: -6.0, minX: -140.5, maxX: 140.5}),
  Object.freeze({id: 'wb_motor_inner', kind: 'motor', direction: 'westbound', localZ: -2.3, minX: -140.5, maxX: 140.5}),
  Object.freeze({id: 'eb_motor_inner', kind: 'motor', direction: 'eastbound', localZ: 2.3, minX: -140.5, maxX: 140.5}),
  Object.freeze({id: 'eb_motor_mid', kind: 'motor', direction: 'eastbound', localZ: 6.0, minX: -140.5, maxX: 140.5}),
  Object.freeze({id: 'eb_motor_outer', kind: 'motor', direction: 'eastbound', localZ: 9.7, minX: -140.5, maxX: 140.5}),
  Object.freeze({id: 'sb_nonmotor', kind: 'nonmotor', direction: 'eastbound', localZ: SOUTH_NONMOTOR_BAND.centerlineZ, minX: -140.5, maxX: 140.5}),
])

/** 与 `pipeline/landmarks/jiefang_layout.py:deck_level` 一致的桥面结构基准局部高度。 */
export function jiefangDeckBaseLocalY(localX: number): number {
  const original = 5.62 - (localX * 1.3) / 281
  if (localX < 16) return original
  const inner = 134.6286
  const head = 151.2322 - 145.6
  const distance = Math.max(0, inner - localX)
  if (localX >= 111) {
    return head + 0.05 * (distance < 2 ? (distance * distance) / 4 : distance - 1)
  }
  const start = 16
  const end = 111
  const length = end - start
  const fraction = Math.max(0, Math.min(1, (localX - start) / length))
  const left = 5.62 - (start * 1.3) / 281
  const right = head + 0.05 * (inner - end - 1)
  return (
    left +
    (right - left) * (3 - 2 * fraction) * fraction * fraction -
    length * fraction * (1 - fraction) * ((1 - fraction) * (1.3 / 281) - fraction * 0.05)
  )
}

/** 解放桥沥青路面顶面在桥体局部坐标系中的 Y 高度（m）。 */
export function jiefangDeckRoadLocalY(localX: number): number {
  return jiefangDeckBaseLocalY(localX) + JIEFANG_ROAD_SURFACE_OFFSET_Y
}

export function jiefangBridgeLocalToWorld(localX: number, localZ: number): [number, number] {
  const c = Math.cos(JIEFANG_BRIDGE_ROTATION_Y)
  const s = Math.sin(JIEFANG_BRIDGE_ROTATION_Y)
  return [
    JIEFANG_BRIDGE_ORIGIN[0] + localX * c + localZ * s,
    JIEFANG_BRIDGE_ORIGIN[2] - localX * s + localZ * c,
  ]
}

export function worldToJiefangBridgeLocal(worldX: number, worldZ: number): [number, number] {
  const dx = worldX - JIEFANG_BRIDGE_ORIGIN[0]
  const dz = worldZ - JIEFANG_BRIDGE_ORIGIN[2]
  const c = Math.cos(JIEFANG_BRIDGE_ROTATION_Y)
  const s = Math.sin(JIEFANG_BRIDGE_ROTATION_Y)
  return [dx * c - dz * s, dx * s + dz * c]
}

export function jiefangDeckWorldY(worldX: number, worldZ: number): number {
  const [localX] = worldToJiefangBridgeLocal(worldX, worldZ)
  return JIEFANG_BRIDGE_ORIGIN[1] + jiefangDeckRoadLocalY(localX)
}

export function isLocalXInJiefangRailingGap(localX: number, margin = 0): boolean {
  for (const gap of JIEFANG_RAILING_GAP_RANGES) {
    if (localX >= gap.minX - margin && localX <= gap.maxX + margin) return true
  }
  return false
}

export interface JiefangDeckZoneOptions {
  readonly marginM?: number
  readonly maxHeightAboveDeckM?: number
  readonly maxDepthBelowDeckM?: number
}

export interface JiefangDutyZoneStatus {
  readonly onBridge: boolean
  readonly canInteract: boolean
  readonly statusText: string
  readonly badgeText: string
  readonly localX: number
  readonly localZ: number
  readonly distanceOutsideM: number
}

/**
 * 圈定「解放桥桥面」执勤互动范围：
 * - 玩家在桥面矩形范围 `[-140.5, 140.5] x [-21.5, 21.5]` 且高度在桥面 `[deckY - 1.1, deckY + 4.5]` 内才算在桥上执勤。
 * - 下到桥底滨江路或离开桥头即判定脱离范围，供上层交互仲裁器禁止互动并提示正在值班状态。
 */
export function evaluateJiefangDutyInteractionZone(
  pos: {readonly x: number; readonly y?: number; readonly z: number} | null | undefined,
  options: JiefangDeckZoneOptions = {},
): JiefangDutyZoneStatus {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) {
    return {
      onBridge: false,
      canInteract: false,
      statusText: '已脱离解放桥值班范围（仅桥面执勤互动）',
      badgeText: '脱离范围',
      localX: NaN,
      localZ: NaN,
      distanceOutsideM: Infinity,
    }
  }
  const margin = options.marginM ?? 0
  const maxAbove = options.maxHeightAboveDeckM ?? 4.5
  const maxBelow = options.maxDepthBelowDeckM ?? 1.1
  const [lx, lz] = worldToJiefangBridgeLocal(pos.x, pos.z)
  const minX = JIEFANG_BRIDGE_DECK_BOUNDS.minX - margin
  const maxX = JIEFANG_BRIDGE_DECK_BOUNDS.maxX + margin
  const minZ = JIEFANG_BRIDGE_DECK_BOUNDS.minZ - margin
  const maxZ = JIEFANG_BRIDGE_DECK_BOUNDS.maxZ + margin

  const ox = lx < minX ? minX - lx : lx > maxX ? lx - maxX : 0
  const oz = lz < minZ ? minZ - lz : lz > maxZ ? lz - maxZ : 0
  let planarOut = Math.hypot(ox, oz)

  let yOk = true
  if (typeof pos.y === 'number' && Number.isFinite(pos.y)) {
    const clampedX = Math.max(JIEFANG_BRIDGE_DECK_BOUNDS.minX, Math.min(JIEFANG_BRIDGE_DECK_BOUNDS.maxX, lx))
    const deckY = JIEFANG_BRIDGE_ORIGIN[1] + jiefangDeckRoadLocalY(clampedX)
    const dyBelow = deckY - maxBelow - pos.y
    const dyAbove = pos.y - (deckY + maxAbove)
    if (dyBelow > 0 || dyAbove > 0) {
      yOk = false
      planarOut = Math.max(planarOut, dyBelow, dyAbove)
    }
  }

  const onBridge = ox === 0 && oz === 0 && yOk
  return {
    onBridge,
    canInteract: onBridge,
    statusText: onBridge
      ? '正在值班 · 解放桥桥面互动区（原地可直连交警/劝导）'
      : '已脱离解放桥值班范围 · 仅桥面允许执勤互动（正在值班中）',
    badgeText: onBridge ? '正在值班 · 桥上可互动' : '正在值班 · 离桥禁互动',
    localX: lx,
    localZ: lz,
    distanceOutsideM: onBridge ? 0 : Number(planarOut.toFixed(2)),
  }
}

export function isOnJiefangBridgeDeck(
  pos: {readonly x: number; readonly y?: number; readonly z: number} | null | undefined,
  options?: JiefangDeckZoneOptions,
): boolean {
  return evaluateJiefangDutyInteractionZone(pos, options).onBridge
}

const COLLIDER_FLAT_CHUNK_LEN_M = 8.0
const COLLIDER_SLOPE_CHUNK_LEN_M = 1.0
const SLOPE_REFINE_START_X = 16.0
const SLOPE_REFINE_END_X = 135.0

function buildColliderSegmentRanges(spanMinX: number, spanMaxX: number): [number, number][] {
  const ranges: [number, number][] = []
  const breakpoints = [spanMinX]
  if (SLOPE_REFINE_START_X > spanMinX && SLOPE_REFINE_START_X < spanMaxX) breakpoints.push(SLOPE_REFINE_START_X)
  if (SLOPE_REFINE_END_X > spanMinX && SLOPE_REFINE_END_X < spanMaxX) breakpoints.push(SLOPE_REFINE_END_X)
  breakpoints.push(spanMaxX)
  for (let s = 0; s < breakpoints.length - 1; s++) {
    const a = breakpoints[s]!
    const b = breakpoints[s + 1]!
    const segLen = b - a
    if (segLen <= 0.05) continue
    const sloped = a >= SLOPE_REFINE_START_X - 1e-4 && b <= SLOPE_REFINE_END_X + 1e-4
    const target = sloped ? COLLIDER_SLOPE_CHUNK_LEN_M : COLLIDER_FLAT_CHUNK_LEN_M
    const chunks = Math.max(1, Math.ceil(segLen / target))
    for (let i = 0; i < chunks; i++) {
      ranges.push([a + (segLen * i) / chunks, a + (segLen * (i + 1)) / chunks])
    }
  }
  return ranges
}

/**
 * 为 `obstacle-volumes.ts` 生成解放桥全桥护栏碰撞体积（无 shell，仅实体箱）。
 * - 沿 `deck_level(x)` 坡度自动加密分段（陡坡段 1m、平缓段 8m），阻挡步行/慢跑直接穿栏与车辆越界，
 *   碰撞体顶面降为 `1.05~1.08m` 且支持玩家起跳踩上栏杆顶面站立通行；桥下 `minY = deck - 0.55m` 不误伤滨江路。
 */
export function buildJiefangRailingObstacleVolume(
  tracks: readonly JiefangRailingTrackSpec[] = JIEFANG_RAILING_TRACKS,
  spans: readonly JiefangRailingSpanSpec[] = JIEFANG_RAILING_SPAN_RANGES,
): ObstacleVolumeSpec {
  const boxes: ObstacleBox[] = []
  for (const track of tracks) {
    for (const span of spans) {
      const segments = buildColliderSegmentRanges(span.minX, span.maxX)
      for (let i = 0; i < segments.length; i++) {
        const [x0, x1] = segments[i]!
        const y0 = jiefangDeckRoadLocalY(x0)
        const y1 = jiefangDeckRoadLocalY(x1)
        const minRoadY = Math.min(y0, y1)
        const midRoadY = (y0 + y1) * 0.5
        boxes.push({
          minX: x0,
          maxX: x1,
          minZ: track.z - track.halfWidth,
          maxZ: track.z + track.halfWidth,
          minY: minRoadY - 0.55,
          maxY: midRoadY + track.colliderHeight,
          standOnTop: true,
          label: `${track.id}:${span.id}:${i}`,
        })
      }
    }
  }
  return {
    id: JIEFANG_RAILING_VOLUME_ID,
    origin: JIEFANG_BRIDGE_ORIGIN,
    rotationY: JIEFANG_BRIDGE_ROTATION_Y,
    boxes,
  }
}

export interface JiefangRailingsVisual {
  readonly group: THREE.Group
  readonly obstacleVolume: ObstacleVolumeSpec
  readonly trackCount: number
  readonly spanCount: number
  readonly gapCount: number
  readonly dynamicLightCount: number
  readonly instanceCounts: Readonly<{
    posts: number
    bases: number
    collars: number
    rails: number
    pickets: number
    boundaryMarkers: number
  }>
  dispose(): void
}

interface BayPlacement {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly z: number
  readonly height: number
  readonly median: boolean
}

interface PostPlacement {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly height: number
  readonly median: boolean
  readonly terminal: boolean
}

const POST_SPACING_TARGET_M = 2.5
const PICKET_SPACING_TARGET_M = 0.28

/**
 * 构建解放桥全桥三维护栏 `THREE.Group`（归属 `MAIN_DETAIL_LAYER = 3`，零动态光源）。
 * 含 2 条机非隔离栏 (`z = ±12.0`)、1 条中央双向隔离栏 (`z = 0.0`) 及两端桥头值班区地面标线。
 */
export function createJiefangRailingsVisual(): JiefangRailingsVisual {
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const ownGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g)
    return g
  }
  const ownMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m)
    return m
  }

  const root = new THREE.Group()
  root.name = 'jiefang-bridge-railings'
  root.position.set(JIEFANG_BRIDGE_ORIGIN[0], JIEFANG_BRIDGE_ORIGIN[1], JIEFANG_BRIDGE_ORIGIN[2])
  root.rotation.y = JIEFANG_BRIDGE_ROTATION_Y

  const posts: PostPlacement[] = []
  const bays: BayPlacement[] = []

  for (const track of JIEFANG_RAILING_TRACKS) {
    const median = track.kind === 'center_median'
    for (const span of JIEFANG_RAILING_SPAN_RANGES) {
      const spanLen = span.maxX - span.minX
      const bayCount = Math.max(1, Math.round(spanLen / POST_SPACING_TARGET_M))
      for (let i = 0; i <= bayCount; i++) {
        const x = span.minX + (spanLen * i) / bayCount
        const y = jiefangDeckRoadLocalY(x)
        const terminal = i === 0 || i === bayCount
        posts.push({x, y, z: track.z, height: track.visualHeight, median, terminal})
        if (i < bayCount) {
          const xNext = span.minX + (spanLen * (i + 1)) / bayCount
          const yNext = jiefangDeckRoadLocalY(xNext)
          bays.push({
            x0: x,
            y0: y,
            x1: xNext,
            y1: yNext,
            z: track.z,
            height: track.visualHeight,
            median,
          })
        }
      }
    }
  }

  // 计算立柱与横杆/立杆实例数
  const railMatrixList: THREE.Matrix4[] = []
  const picketMatrixList: THREE.Matrix4[] = []
  const dummy = new THREE.Object3D()

  for (const bay of bays) {
    const dx = bay.x1 - bay.x0
    const dy = bay.y1 - bay.y0
    const chord = Math.hypot(dx, dy)
    const pitch = Math.atan2(dy, dx)
    const midX = (bay.x0 + bay.x1) * 0.5
    const midY = (bay.y0 + bay.y1) * 0.5
    const topYOffset = bay.height - 0.03
    const botYOffset = 0.17

    // 上下两条水平横梁（顶梁紧贴站立踏面 height）
    for (const [beamIdx, offsetY] of [topYOffset, botYOffset].entries()) {
      dummy.position.set(midX, midY + offsetY, bay.z)
      dummy.rotation.set(0, 0, pitch)
      const capThickY = beamIdx === 0 ? 0.06 : bay.median ? 0.056 : 0.046
      const capThickZ = beamIdx === 0 ? (bay.median ? 0.095 : 0.082) : bay.median ? 0.072 : 0.052
      dummy.scale.set(chord, capThickY, capThickZ)
      dummy.updateMatrix()
      railMatrixList.push(dummy.matrix.clone())
    }

    // 中部垂直栏杆立柱格栅
    const inset = 0.14
    const innerSpan = Math.max(0.2, bay.x1 - bay.x0 - inset * 2)
    const nPickets = Math.max(2, Math.floor(innerSpan / PICKET_SPACING_TARGET_M))
    const picketLen = topYOffset - botYOffset - 0.03
    for (let k = 0; k < nPickets; k++) {
      const u = nPickets === 1 ? 0.5 : k / (nPickets - 1)
      const px = bay.x0 + inset + innerSpan * u
      const t = (px - bay.x0) / Math.max(1e-5, bay.x1 - bay.x0)
      const py = bay.y0 + (bay.y1 - bay.y0) * t + (botYOffset + topYOffset) * 0.5
      dummy.position.set(px, py, bay.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(bay.median ? 0.028 : 0.022, picketLen, bay.median ? 0.032 : 0.024)
      dummy.updateMatrix()
      picketMatrixList.push(dummy.matrix.clone())
    }
  }

  // 材质：低饱和市政暖米白 + 铸铁深炭灰 + 哑光朱砂/琥珀反光警示袖（零发光体、零霓虹）
  const whiteSteelMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0xe9e4d8,
      roughness: 0.42,
      metalness: 0.34,
    }),
  )
  const castIronMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0x262d34,
      roughness: 0.68,
      metalness: 0.48,
    }),
  )
  const warningMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0xb9852b,
      roughness: 0.38,
      metalness: 0.18,
      emissive: 0x241604,
      emissiveIntensity: 0.35,
    }),
  )
  const terminalColor = new THREE.Color(0xa9503c)
  const normalWarningColor = new THREE.Color(0xd29732)

  // 1) 立柱
  const unitBoxGeo = ownGeo(new THREE.BoxGeometry(1, 1, 1))
  const postMesh = new THREE.InstancedMesh(unitBoxGeo, whiteSteelMat, posts.length)
  postMesh.name = 'jiefang-railings-posts'
  postMesh.frustumCulled = false
  postMesh.receiveShadow = true

  // 2) 铸铁底座
  const baseMesh = new THREE.InstancedMesh(unitBoxGeo, castIronMat, posts.length)
  baseMesh.name = 'jiefang-railings-bases'
  baseMesh.frustumCulled = false
  baseMesh.receiveShadow = true

  // 3) 警示环带（缺口端头用朱砂红，常规立柱用琥珀黄）
  const collarMesh = new THREE.InstancedMesh(unitBoxGeo, warningMat, posts.length)
  collarMesh.name = 'jiefang-railings-collars'
  collarMesh.frustumCulled = false

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i]!
    const w = p.median ? 0.082 : 0.064
    const d = p.median ? 0.092 : 0.072
    dummy.position.set(p.x, p.y + p.height * 0.5, p.z)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.set(w, p.height, d)
    dummy.updateMatrix()
    postMesh.setMatrixAt(i, dummy.matrix)

    dummy.position.set(p.x, p.y + 0.042, p.z)
    dummy.scale.set(p.median ? 0.2 : 0.16, 0.084, p.median ? 0.24 : 0.19)
    dummy.updateMatrix()
    baseMesh.setMatrixAt(i, dummy.matrix)

    const collarH = p.terminal ? 0.18 : 0.11
    dummy.position.set(p.x, p.y + p.height - (p.terminal ? 0.16 : 0.22), p.z)
    dummy.scale.set(w + 0.008, collarH, d + 0.008)
    dummy.updateMatrix()
    collarMesh.setMatrixAt(i, dummy.matrix)
    collarMesh.setColorAt(i, p.terminal ? terminalColor : normalWarningColor)
  }
  postMesh.instanceMatrix.needsUpdate = true
  baseMesh.instanceMatrix.needsUpdate = true
  collarMesh.instanceMatrix.needsUpdate = true
  if (collarMesh.instanceColor) collarMesh.instanceColor.needsUpdate = true

  // 4) 横梁
  const railMesh = new THREE.InstancedMesh(unitBoxGeo, whiteSteelMat, railMatrixList.length)
  railMesh.name = 'jiefang-railings-rails'
  railMesh.frustumCulled = false
  railMesh.receiveShadow = true
  for (let i = 0; i < railMatrixList.length; i++) {
    railMesh.setMatrixAt(i, railMatrixList[i]!)
  }
  railMesh.instanceMatrix.needsUpdate = true

  // 5) 格栅竖杆
  const picketMesh = new THREE.InstancedMesh(unitBoxGeo, whiteSteelMat, picketMatrixList.length)
  picketMesh.name = 'jiefang-railings-pickets'
  picketMesh.frustumCulled = false
  for (let i = 0; i < picketMatrixList.length; i++) {
    picketMesh.setMatrixAt(i, picketMatrixList[i]!)
  }
  picketMesh.instanceMatrix.needsUpdate = true

  // 6) 桥头执勤范围路面界线标识（呼应“仅桥上互动”可视化界定）
  const boundaryMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0xd09a38,
      roughness: 0.72,
      metalness: 0.08,
    }),
  )
  const boundaryXList = [JIEFANG_BRIDGE_DECK_BOUNDS.minX + 0.35, JIEFANG_BRIDGE_DECK_BOUNDS.maxX - 0.35]
  const dashesPerEnd = 10
  const boundaryMesh = new THREE.InstancedMesh(unitBoxGeo, boundaryMat, boundaryXList.length * dashesPerEnd)
  boundaryMesh.name = 'jiefang-duty-scope-markers'
  boundaryMesh.frustumCulled = false
  let bIdx = 0
  for (const bx of boundaryXList) {
    const by = jiefangDeckRoadLocalY(bx) + 0.018
    for (let k = 0; k < dashesPerEnd; k++) {
      const bz = -14.4 + k * 3.2
      dummy.position.set(bx, by, bz)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(0.18, 0.012, 1.9)
      dummy.updateMatrix()
      boundaryMesh.setMatrixAt(bIdx++, dummy.matrix)
    }
  }
  boundaryMesh.instanceMatrix.needsUpdate = true

  root.add(postMesh, baseMesh, collarMesh, railMesh, picketMesh, boundaryMesh)
  mainDetail(root)

  const obstacleVolume = buildJiefangRailingObstacleVolume()

  return {
    group: root,
    obstacleVolume,
    trackCount: JIEFANG_RAILING_TRACKS.length,
    spanCount: JIEFANG_RAILING_SPAN_RANGES.length,
    gapCount: JIEFANG_RAILING_GAP_RANGES.length,
    dynamicLightCount: 0,
    instanceCounts: {
      posts: posts.length,
      bases: posts.length,
      collars: posts.length,
      rails: railMatrixList.length,
      pickets: picketMatrixList.length,
      boundaryMarkers: bIdx,
    },
    dispose() {
      root.removeFromParent()
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
    },
  }
}
