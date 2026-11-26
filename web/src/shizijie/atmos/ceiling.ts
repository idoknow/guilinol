import * as THREE from 'three'
import { SZJ_FRAME, type SzjLayout } from '../contract.ts'
import {
  SZJ_ATMOS_BUDGET,
  buildInstancedBoxLayer,
  extractCorridorSpans,
  isPointInStairShaft,
  overlapsHigherPrioritySpan,
  resolveAtmosSpec,
  type BoxInstanceRecord,
} from './spec.ts'
import type {
  SzjAtmosLayerMetric,
  SzjAtmosMetrics,
  SzjAtmosOptions,
  SzjCeilingHandle,
} from './types.ts'

/**
 * Factory: instanced architectural B1 ceiling structure matched to real 十字街 underpass specs:
 * 1) Aluminium U-baffles or open-cell grille (`szj-atmos-baffles`)
 * 2) Exposed galvanized steel rectangular HVAC ducts + seam flanges (`szj-atmos-ducts`)
 * 3) Exposed powder-coated dark steel cable trays + ceiling hangers (`szj-atmos-cable-trays`)
 * 4) Fire sprinkler heads & escutcheon trims (`szj-atmos-sprinklers`)
 * 5) Recessed dark charcoal acoustic plenum backing & shadow-reveal trim (`szj-atmos-plenum-trim`)
 *
 * Strictly stays above `2.85m` (preserving full clearance for 2.3m ceiling-hung wayfinding signs),
 * excludes all 4 stairwell shafts, deduplicates corridor intersections, and uses <= 5 drawCalls.
 */
export function createCeilingStructure(
  layout: SzjLayout,
  opts: SzjAtmosOptions = {},
): SzjCeilingHandle {
  const spec = resolveAtmosSpec(opts.preset ?? 'real-guilin', opts.spec)
  const floorY = opts.floorY ?? SZJ_FRAME.indoorFloorY
  const ceilH = layout.ceilingHeight
  const topY = floorY + ceilH

  // Vertical architectural layering (strictly separated to prevent Z-fighting & stay >= 2.85m):
  const plenumY = topY - 0.016
  const ductY = topY - 0.082
  const trayY = topY - 0.068
  const baffleY = topY - 0.165
  const sprinklerY = topY - 0.228

  const group = new THREE.Group()
  group.name = 'szj-atmos-ceiling'

  const spans = extractCorridorSpans(layout)

  const baffleRecords: BoxInstanceRecord[] = []
  const ductRecords: BoxInstanceRecord[] = []
  const trayRecords: BoxInstanceRecord[] = []
  const sprinklerRecords: BoxInstanceRecord[] = []
  const plenumRecords: BoxInstanceRecord[] = []

  // Spatial grid deduplication for sprinklers & junction elements (cell size 1.4m)
  const sprinklerSeen = new Set<string>()
  const baffleSeen = new Set<string>()
  const cellKey = (x: number, z: number, cell: number): string =>
    `${Math.round(x / cell)}:${Math.round(z / cell)}`

  // Adaptive baffle spacing so even very large layouts remain well inside instance cap
  const totalCorridorLen = spans.reduce((sum, s) => sum + s.len, 0)
  const rawEstimatedBaffles = totalCorridorLen / spec.baffleSpacingM
  const targetBaffleBudget =
    spec.ceilingStyle === 'grille'
      ? Math.floor(SZJ_ATMOS_BUDGET.caps.baffles * 0.72)
      : SZJ_ATMOS_BUDGET.caps.baffles
  const effectiveBafflePitch =
    rawEstimatedBaffles > targetBaffleBudget
      ? totalCorridorLen / Math.max(1, targetBaffleBudget - 40)
      : spec.baffleSpacingM

  for (let si = 0; si < spans.length; si++) {
    const span = spans[si]!
    const pad = spec.stairShaftPadM

    // 1. Recessed matte charcoal acoustic plenum backing + shadow-reveal cornice strips
    const plenumMidBlocked =
      isPointInStairShaft(span.midX, span.midZ, pad) ||
      overlapsHigherPrioritySpan(span.midX, span.midZ, spans, si, 0.25)
    if (!plenumMidBlocked && span.len >= 0.8) {
      const inset = Math.min(0.4, span.len * 0.12)
      const pLen = Math.max(0.4, span.len - inset * 2)
      plenumRecords.push({
        cx: span.midX,
        cy: plenumY,
        cz: span.midZ,
        sx: Math.max(0.8, span.width - 0.24),
        sy: 0.028,
        sz: pLen,
        yaw: span.yaw,
      })
    }

    // 2. Exposed galvanized HVAC ducts + transverse seam flanges along corridor spine
    const ductInset = Math.min(0.65, span.len * 0.18)
    const ductSpanLen = span.len - ductInset * 2
    if (
      ductSpanLen >= 1.1 &&
      !isPointInStairShaft(span.midX, span.midZ, pad) &&
      !overlapsHigherPrioritySpan(span.midX, span.midZ, spans, si, 0.3)
    ) {
      const ductOffsetLat = span.width >= 4.4 ? -0.45 : -0.25
      const dCx = span.midX + span.rightX * ductOffsetLat
      const dCz = span.midZ + span.rightZ * ductOffsetLat
      if (!isPointInStairShaft(dCx, dCz, pad)) {
        const ductW = span.kind === 'ring' ? 0.5 : 0.38
        ductRecords.push({
          cx: dCx,
          cy: ductY,
          cz: dCz,
          sx: ductW,
          sy: 0.105,
          sz: ductSpanLen,
          yaw: span.yaw,
        })
        // Transverse galvanized duct flanges every ~3.2m for mechanical surface realism
        const flangeCount = Math.min(5, Math.floor(ductSpanLen / 3.2))
        for (let fi = 1; fi <= flangeCount; fi++) {
          const s = ductInset + (ductSpanLen * fi) / (flangeCount + 1)
          const fx = span.ax + span.dx * s + span.rightX * ductOffsetLat
          const fz = span.az + span.dz * s + span.rightZ * ductOffsetLat
          if (isPointInStairShaft(fx, fz, pad)) continue
          ductRecords.push({
            cx: fx,
            cy: ductY,
            cz: fz,
            sx: ductW + 0.055,
            sy: 0.125,
            sz: 0.04,
            yaw: span.yaw,
          })
        }
      }

      // 3. Exposed dark steel cable tray parallel to HVAC duct + vertical threaded hangers
      const trayOffsetLat = span.width >= 4.4 ? 0.65 : 0.42
      const tCx = span.midX + span.rightX * trayOffsetLat
      const tCz = span.midZ + span.rightZ * trayOffsetLat
      if (!isPointInStairShaft(tCx, tCz, pad)) {
        trayRecords.push({
          cx: tCx,
          cy: trayY,
          cz: tCz,
          sx: 0.26,
          sy: 0.044,
          sz: ductSpanLen,
          yaw: span.yaw,
        })
        // Periodic suspension crossbars/hangers anchoring the cable tray to the ceiling slab
        const hangerCount = Math.min(4, Math.max(1, Math.floor(ductSpanLen / 4.0)))
        for (let hi = 1; hi <= hangerCount; hi++) {
          const s = ductInset + (ductSpanLen * hi) / (hangerCount + 1)
          const hx = span.ax + span.dx * s + span.rightX * trayOffsetLat
          const hz = span.az + span.dz * s + span.rightZ * trayOffsetLat
          if (isPointInStairShaft(hx, hz, pad)) continue
          trayRecords.push({
            cx: hx,
            cy: topY - 0.036,
            cz: hz,
            sx: 0.31,
            sy: 0.052,
            sz: 0.035,
            yaw: span.yaw,
          })
        }
      }
    }

    // 4. Transverse aluminium U-baffles (or open-cell grille ribs)
    const baffleW = Math.max(0.8, span.width - 0.56)
    const baffleColor = span.kind === 'ring' ? spec.baffleRingColor : spec.baffleColor
    const startS = Math.min(0.45, span.len * 0.15)
    const endS = span.len - startS
    for (let s = startS; s <= endS + 1e-4; s += effectiveBafflePitch) {
      const px = span.ax + span.dx * s
      const pz = span.az + span.dz * s
      if (isPointInStairShaft(px, pz, pad)) continue
      if (overlapsHigherPrioritySpan(px, pz, spans, si, 0.22)) continue
      const bk = cellKey(px, pz, effectiveBafflePitch * 0.85)
      if (baffleSeen.has(bk)) continue
      baffleSeen.add(bk)
      baffleRecords.push({
        cx: px,
        cy: baffleY,
        cz: pz,
        sx: baffleW,
        sy: spec.baffleDepthM,
        sz: spec.baffleThicknessM,
        yaw: span.yaw,
        color: baffleColor,
      })
    }

    // Longitudinal open-cell grille ribs when `ceilingStyle === 'grille'`
    if (
      spec.ceilingStyle === 'grille' &&
      ductSpanLen >= 1.0 &&
      !isPointInStairShaft(span.midX, span.midZ, pad) &&
      !overlapsHigherPrioritySpan(span.midX, span.midZ, spans, si, 0.26)
    ) {
      const ribs = spec.grilleLongitudinalRibs
      for (let ri = 0; ri < ribs; ri++) {
        const frac = ribs === 1 ? 0 : (ri / (ribs - 1) - 0.5) * 2
        const lat = frac * (baffleW * 0.38)
        const rx = span.midX + span.rightX * lat
        const rz = span.midZ + span.rightZ * lat
        if (isPointInStairShaft(rx, rz, pad)) continue
        baffleRecords.push({
          cx: rx,
          cy: baffleY,
          cz: rz,
          sx: spec.baffleThicknessM * 0.85,
          sy: spec.baffleDepthM * 0.92,
          sz: ductSpanLen,
          yaw: span.yaw,
          color: baffleColor,
        })
      }
    }

    // 5. Fire sprinkler heads spaced cleanly along corridor bay centerlines every ~3.8m
    const spPitch = 3.8
    const spMargin = Math.min(1.1, span.len * 0.25)
    for (let s = spMargin; s <= span.len - spMargin + 1e-4; s += spPitch) {
      const sxPos = span.ax + span.dx * s
      const szPos = span.az + span.dz * s
      if (isPointInStairShaft(sxPos, szPos, pad)) continue
      const sk = cellKey(sxPos, szPos, 1.8)
      if (sprinklerSeen.has(sk)) continue
      sprinklerSeen.add(sk)
      sprinklerRecords.push({
        cx: sxPos,
        cy: sprinklerY,
        cz: szPos,
        sx: 0.055,
        sy: 0.054,
        sz: 0.055,
        yaw: 0,
      })
    }
  }

  // Shared unit geometries (1 BoxGeometry shared across 4 box layers + 1 low-poly CylinderGeometry for sprinklers)
  const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1)
  const sprinklerGeo = new THREE.CylinderGeometry(0.45, 0.72, 1, 6, 1)

  const baffleMat = new THREE.MeshStandardMaterial({
    name: 'szj_atmos_baffle_alu',
    color: '#ffffff',
    metalness: 0.62,
    roughness: 0.36,
  })
  const ductMat = new THREE.MeshStandardMaterial({
    name: 'szj_atmos_hvac_duct',
    color: spec.ductColor,
    metalness: 0.72,
    roughness: 0.34,
  })
  const trayMat = new THREE.MeshStandardMaterial({
    name: 'szj_atmos_cable_tray',
    color: spec.cableTrayColor,
    metalness: 0.56,
    roughness: 0.46,
  })
  const sprinklerMat = new THREE.MeshStandardMaterial({
    name: 'szj_atmos_sprinkler',
    color: spec.sprinklerColor,
    metalness: 0.78,
    roughness: 0.28,
  })
  const plenumMat = new THREE.MeshStandardMaterial({
    name: 'szj_atmos_plenum_matte',
    color: spec.plenumColor,
    metalness: 0.1,
    roughness: 0.88,
  })

  const geometries: THREE.BufferGeometry[] = [unitBoxGeo, sprinklerGeo]
  const materials: THREE.Material[] = [baffleMat, ductMat, trayMat, sprinklerMat, plenumMat]
  const breakdown: SzjAtmosLayerMetric[] = []
  let totalDrawCalls = 0
  let totalTriangles = 0
  let totalInstances = 0
  let minElementY = Infinity
  let maxElementY = -Infinity

  const registerLayer = (
    built: ReturnType<typeof buildInstancedBoxLayer>,
  ): void => {
    if (!built) return
    group.add(built.mesh)
    breakdown.push(built.metric)
    totalDrawCalls += built.metric.drawCalls
    totalTriangles += built.metric.triangles
    totalInstances += built.metric.instances
    if (built.minY < minElementY) minElementY = built.minY
    if (built.maxY > maxElementY) maxElementY = built.maxY
  }

  registerLayer(buildInstancedBoxLayer('szj-atmos-baffles', baffleRecords, baffleMat, unitBoxGeo, SZJ_ATMOS_BUDGET.caps.baffles))
  registerLayer(buildInstancedBoxLayer('szj-atmos-ducts', ductRecords, ductMat, unitBoxGeo, SZJ_ATMOS_BUDGET.caps.ducts))
  registerLayer(buildInstancedBoxLayer('szj-atmos-cable-trays', trayRecords, trayMat, unitBoxGeo, SZJ_ATMOS_BUDGET.caps.cableTrays))
  registerLayer(buildInstancedBoxLayer('szj-atmos-sprinklers', sprinklerRecords, sprinklerMat, sprinklerGeo, SZJ_ATMOS_BUDGET.caps.sprinklers))
  registerLayer(buildInstancedBoxLayer('szj-atmos-plenum-trim', plenumRecords, plenumMat, unitBoxGeo, SZJ_ATMOS_BUDGET.caps.plenumTrim))

  let disposed = false

  return {
    group,
    spec,
    getMetrics(): SzjAtmosMetrics {
      return {
        drawCalls: totalDrawCalls,
        triangles: totalTriangles,
        instances: totalInstances,
        lightCount: 0,
        geometryCount: geometries.length,
        materialCount: materials.length,
        minElementY: Number.isFinite(minElementY) ? minElementY : topY,
        maxElementY: Number.isFinite(maxElementY) ? maxElementY : topY,
        breakdown,
      }
    },
    isDisposed: () => disposed,
    dispose(): void {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      while (group.children.length > 0) {
        group.remove(group.children[0]!)
      }
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
    },
  }
}
