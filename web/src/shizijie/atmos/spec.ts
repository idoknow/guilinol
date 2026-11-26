import * as THREE from 'three'
import {
  SZJ_STAIRWELLS,
  indoorToStairLocal,
  type SzjLayout,
} from '../contract.ts'
import type {
  CorridorSpan,
  SzjAtmosLayerMetric,
  SzjAtmosPresetName,
  SzjAtmosRealitySpec,
} from './types.ts'

/** Hard performance & clearance guardrails for the atmos module (k9 + k7 hanging-sign clearance). */
export const SZJ_ATMOS_BUDGET = {
  maxDrawCalls: 12,
  maxTriangles: 40_000,
  maxPointLights: 6,
  /** Minimum clearance above floor for ceiling/luminaire geometry so 2.3m hanging signs never collide. */
  minSignClearanceY: 2.75,
  /** Per-layer instance caps guaranteeing worst-case triangles strictly <= 40,000. */
  caps: {
    baffles: 860,
    ducts: 200,
    cableTrays: 240,
    sprinklers: 180,
    plenumTrim: 180,
    linearLamps: 150,
    lampHousings: 220,
    downlights: 170,
    coveWash: 130,
  },
} as const

/**
 * Calibrated presets grounded in real Guilin 十字街 B1 underpass architecture:
 * - Anodized dark-grey/silver aluminium U-baffles & exposed galvanized MEP ducts beneath matte charcoal plenum
 * - Crisp 5000K concourse linear diffusers contrasted against warm 3400K recessed downlights & shopfront cove wash
 * - Subtle depth fog that preserves 10m hanging-sign readability while giving 40m+ corridor atmosphere
 */
export const SZJ_ATMOS_PRESETS: Record<SzjAtmosPresetName, SzjAtmosRealitySpec> = {
  'real-guilin': {
    ceilingStyle: 'baffle',
    baffleSpacingM: 0.46,
    baffleDepthM: 0.09,
    baffleThicknessM: 0.032,
    grilleLongitudinalRibs: 3,
    baffleColor: '#b7bec7',
    baffleRingColor: '#c9c2b6',
    plenumColor: '#242a33',
    ductColor: '#98a2ad',
    cableTrayColor: '#3f4752',
    sprinklerColor: '#c8b48a',
    linearLampColor: '#eef6ff',
    linearLampIntensity: 1.38,
    downlightColor: '#ffeccf',
    downlightIntensity: 1.48,
    lampHousingColor: '#2b3038',
    coveWashColor: '#ffd9aa',
    coveWashOpacity: 0.13,
    hemiSkyColor: '#dce8f6',
    hemiGroundColor: '#665d53',
    hemiIntensity: 0.72,
    ambientColor: '#f5efe6',
    ambientIntensity: 0.36,
    keyLightColor: '#fff4e3',
    keyLightIntensity: 0.64,
    ringPointColor: '#ffe4bc',
    ringPointIntensity: 2.35,
    ringPointDistance: 22,
    stairDaylightColor: '#cbe4ff',
    stairDaylightIntensity: 1.8,
    stairDaylightDistance: 16,
    fogColor: '#c6d1dc',
    fogDensity: 0.0105,
    backgroundColor: '#d4e5f7',
    stairShaftPadM: 0.55,
  },
  'day-rush': {
    ceilingStyle: 'baffle',
    baffleSpacingM: 0.46,
    baffleDepthM: 0.09,
    baffleThicknessM: 0.032,
    grilleLongitudinalRibs: 3,
    baffleColor: '#c2c9d2',
    baffleRingColor: '#d2cbc0',
    plenumColor: '#2a313b',
    ductColor: '#a2acb7',
    cableTrayColor: '#454e5a',
    sprinklerColor: '#ccb890',
    linearLampColor: '#f3f9ff',
    linearLampIntensity: 1.48,
    downlightColor: '#fff1d8',
    downlightIntensity: 1.4,
    lampHousingColor: '#2e343d',
    coveWashColor: '#ffe0b8',
    coveWashOpacity: 0.11,
    hemiSkyColor: '#e5f0fc',
    hemiGroundColor: '#756b60',
    hemiIntensity: 0.84,
    ambientColor: '#f8f3ec',
    ambientIntensity: 0.42,
    keyLightColor: '#fff7eb',
    keyLightIntensity: 0.72,
    ringPointColor: '#ffebc9',
    ringPointIntensity: 2.1,
    ringPointDistance: 22,
    stairDaylightColor: '#d8ecff',
    stairDaylightIntensity: 2.4,
    stairDaylightDistance: 18,
    fogColor: '#cfdbe6',
    fogDensity: 0.009,
    backgroundColor: '#dcebfb',
    stairShaftPadM: 0.55,
  },
  'evening-warm': {
    ceilingStyle: 'baffle',
    baffleSpacingM: 0.46,
    baffleDepthM: 0.09,
    baffleThicknessM: 0.032,
    grilleLongitudinalRibs: 3,
    baffleColor: '#aeb5bf',
    baffleRingColor: '#c7b8a3',
    plenumColor: '#1d222a',
    ductColor: '#8b95a0',
    cableTrayColor: '#363d47',
    sprinklerColor: '#c2ab7e',
    linearLampColor: '#e6f0ff',
    linearLampIntensity: 1.24,
    downlightColor: '#ffe0b0',
    downlightIntensity: 1.62,
    lampHousingColor: '#232830',
    coveWashColor: '#ffc985',
    coveWashOpacity: 0.17,
    hemiSkyColor: '#cad8ea',
    hemiGroundColor: '#594e43',
    hemiIntensity: 0.6,
    ambientColor: '#f0e4d4',
    ambientIntensity: 0.3,
    keyLightColor: '#ffe6c4',
    keyLightIntensity: 0.54,
    ringPointColor: '#ffd49c',
    ringPointIntensity: 2.8,
    ringPointDistance: 24,
    stairDaylightColor: '#9fbce0',
    stairDaylightIntensity: 1.15,
    stairDaylightDistance: 14,
    fogColor: '#b7c0cb',
    fogDensity: 0.0125,
    backgroundColor: '#2c3d54',
    stairShaftPadM: 0.55,
  },
}

export function resolveAtmosSpec(
  preset: SzjAtmosPresetName = 'real-guilin',
  overrides?: Partial<SzjAtmosRealitySpec>,
): SzjAtmosRealitySpec {
  const base = SZJ_ATMOS_PRESETS[preset] ?? SZJ_ATMOS_PRESETS['real-guilin']
  if (!overrides) return { ...base }
  return {
    ...base,
    ...overrides,
    baffleSpacingM: Math.max(0.24, overrides.baffleSpacingM ?? base.baffleSpacingM),
    baffleDepthM: Math.max(0.03, Math.min(0.18, overrides.baffleDepthM ?? base.baffleDepthM)),
    baffleThicknessM: Math.max(0.015, Math.min(0.08, overrides.baffleThicknessM ?? base.baffleThicknessM)),
    grilleLongitudinalRibs: Math.max(1, Math.min(6, Math.round(overrides.grilleLongitudinalRibs ?? base.grilleLongitudinalRibs))),
    coveWashOpacity: Math.max(0, Math.min(0.35, overrides.coveWashOpacity ?? base.coveWashOpacity)),
    fogDensity: Math.max(0, Math.min(0.04, overrides.fogDensity ?? base.fogDensity)),
    stairShaftPadM: Math.max(0.2, overrides.stairShaftPadM ?? base.stairShaftPadM),
  }
}

/** Extracts linear corridor spans from `SzjLayout.corridors`. */
export function extractCorridorSpans(layout: SzjLayout): CorridorSpan[] {
  const spans: CorridorSpan[] = []
  for (const corr of layout.corridors) {
    for (let i = 0; i + 1 < corr.points.length; i++) {
      const a = corr.points[i]!
      const b = corr.points[i + 1]!
      const vx = b.x - a.x
      const vz = b.z - a.z
      const len = Math.hypot(vx, vz)
      if (len < 0.25) continue
      const dx = vx / len
      const dz = vz / len
      spans.push({
        corridorId: corr.id,
        kind: corr.kind,
        width: corr.width,
        ax: a.x,
        az: a.z,
        bx: b.x,
        bz: b.z,
        midX: (a.x + b.x) * 0.5,
        midZ: (a.z + b.z) * 0.5,
        dx,
        dz,
        rightX: dz,
        rightZ: -dx,
        len,
        yaw: Math.atan2(dx, dz),
      })
    }
  }
  return spans
}

/** Returns true if indoor XZ `(px, pz)` falls inside any of the 4 open stairwell shafts (with safety pad). */
export function isPointInStairShaft(px: number, pz: number, pad = 0.55): boolean {
  for (const st of SZJ_STAIRWELLS) {
    const local = indoorToStairLocal(st, { x: px, z: pz })
    if (
      Math.abs(local.x) <= st.width * 0.5 + pad &&
      Math.abs(local.z) <= st.length * 0.5 + pad
    ) {
      return true
    }
  }
  return false
}

/** Distance squared from point `(px, pz)` to segment `(ax, az)-(bx, bz)`. */
export function distSqToSpan(px: number, pz: number, span: CorridorSpan): number {
  const vx = span.bx - span.ax
  const vz = span.bz - span.az
  const denom = vx * vx + vz * vz
  const t = denom > 1e-8 ? Math.max(0, Math.min(1, ((px - span.ax) * vx + (pz - span.az) * vz) / denom)) : 0
  const cx = span.ax + vx * t
  const cz = span.az + vz * t
  const dx = px - cx
  const dz = pz - cz
  return dx * dx + dz * dz
}

/** True if `(px, pz)` overlaps an earlier/higher-priority corridor span (prevents crossing Z-fighting). */
export function overlapsHigherPrioritySpan(
  px: number,
  pz: number,
  spans: readonly CorridorSpan[],
  currentIdx: number,
  margin = 0.18,
): boolean {
  const cur = spans[currentIdx]!
  const curRank = cur.kind === 'ring' ? 2 : cur.kind === 'main' ? 1 : 0
  for (let j = 0; j < spans.length; j++) {
    if (j === currentIdx) continue
    const other = spans[j]!
    const otherRank = other.kind === 'ring' ? 2 : other.kind === 'main' ? 1 : 0
    // Yield to strictly higher-priority corridor, or earlier index within same corridor kind.
    if (otherRank < curRank) continue
    if (otherRank === curRank && j > currentIdx) continue
    const halfW = Math.max(0.1, other.width * 0.5 - margin)
    if (distSqToSpan(px, pz, other) < halfW * halfW) {
      return true
    }
  }
  return false
}

export interface BoxInstanceRecord {
  readonly cx: number
  readonly cy: number
  readonly cz: number
  readonly sx: number
  readonly sy: number
  readonly sz: number
  readonly yaw: number
  readonly pitch?: number
  readonly color?: string
}

export function countGeometryTriangles(geometry: THREE.BufferGeometry): number {
  if (geometry.index) {
    return Math.floor(geometry.index.count / 3)
  }
  const pos = geometry.getAttribute('position')
  return pos ? Math.floor(pos.count / 3) : 0
}

const _dummy = new THREE.Object3D()
const _color = new THREE.Color()

/**
 * Packs an array of oriented box transforms into a single `THREE.InstancedMesh` (1 drawCall).
 * Returns `null` when `records.length === 0`.
 */
export function buildInstancedBoxLayer(
  name: string,
  records: readonly BoxInstanceRecord[],
  material: THREE.Material,
  geometry: THREE.BufferGeometry,
  maxInstances: number,
): {
  mesh: THREE.InstancedMesh
  metric: SzjAtmosLayerMetric
  minY: number
  maxY: number
} | null {
  const count = Math.min(records.length, maxInstances)
  if (count <= 0) return null

  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.name = name
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false

  let minY = Infinity
  let maxY = -Infinity
  let hasPerInstanceColor = false
  for (let i = 0; i < count; i++) {
    if (records[i]!.color) {
      hasPerInstanceColor = true
      break
    }
  }

  for (let i = 0; i < count; i++) {
    const r = records[i]!
    _dummy.position.set(r.cx, r.cy, r.cz)
    _dummy.rotation.set(r.pitch ?? 0, r.yaw, 0, 'YXZ')
    _dummy.scale.set(r.sx, r.sy, r.sz)
    _dummy.updateMatrix()
    mesh.setMatrixAt(i, _dummy.matrix)
    if (hasPerInstanceColor) {
      _color.set(r.color ?? '#ffffff')
      mesh.setColorAt(i, _color)
    }
    const halfY = r.sy * 0.5
    if (r.cy - halfY < minY) minY = r.cy - halfY
    if (r.cy + halfY > maxY) maxY = r.cy + halfY
  }

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

  const trisPerInstance = countGeometryTriangles(geometry)
  return {
    mesh,
    metric: {
      name,
      drawCalls: 1,
      triangles: trisPerInstance * count,
      instances: count,
    },
    minY,
    maxY,
  }
}
