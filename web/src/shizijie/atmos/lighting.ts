import * as THREE from 'three'
import {
  SZJ_FRAME,
  SZJ_STAIRWELLS,
  type SzjLayout,
} from '../contract.ts'
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
  SzjAtmosRealitySpec,
  SzjLightingRigHandle,
} from './types.ts'

/**
 * Factory: B1 multi-layered lighting rig, instanced luminaires & underground atmosphere controller:
 * 1) Recessed cool-neutral linear LED diffusers (`szj-atmos-linear-lamps`)
 * 2) Matte-black extruded troffer/downlight housings (`szj-atmos-lamp-housings`)
 * 3) Recessed warm-accent downlights at junctions, ring nodes & shopfront eaves (`szj-atmos-downlights`)
 * 4) Soft additive warm wall/cove glow washes above shopfronts (`szj-atmos-cove-wash`)
 * 5) Calibrated Three.js light rig (Hemisphere + low-fill Ambient + Key Directional + <= 6 local PointLights)
 * 6) Underground fog & mood helper (`applyAtmosphere(scene)` returning a clean restore callback)
 *
 * Uses <= 4 drawCalls, <= 11k triangles, zero texture allocation, and full `dispose()` cleanup.
 */
export function createLightingRig(
  layout: SzjLayout,
  opts: SzjAtmosOptions = {},
): SzjLightingRigHandle {
  let activeSpec: SzjAtmosRealitySpec = resolveAtmosSpec(opts.preset ?? 'real-guilin', opts.spec)
  const floorY = opts.floorY ?? SZJ_FRAME.indoorFloorY
  const ceilH = layout.ceilingHeight
  const topY = floorY + ceilH
  const includeLights = opts.includeLights ?? true

  // Vertical layering cleanly below baffles & strictly above 2.75m hanging-sign clearance
  const housingY = topY - 0.186
  const linearLampY = topY - 0.212
  const downlightY = topY - 0.218
  const coveWashY = topY - 0.305

  const group = new THREE.Group()
  group.name = 'szj-atmos-lighting'

  const spans = extractCorridorSpans(layout)
  const pad = activeSpec.stairShaftPadM

  const linearRecords: BoxInstanceRecord[] = []
  const housingRecords: BoxInstanceRecord[] = []
  const downlightRecords: BoxInstanceRecord[] = []
  const coveRecords: BoxInstanceRecord[] = []

  const downlightSeen = new Set<string>()
  const dlKey = (x: number, z: number): string => `${Math.round(x / 2.2)}:${Math.round(z / 2.2)}`

  for (let si = 0; si < spans.length; si++) {
    const span = spans[si]!
    const endInset = Math.max(0.85, span.width * 0.45)
    const stripLen = span.len - endInset * 2

    // 1. Continuous linear LED strips + matte-black extruded housings along straight runs
    if (
      stripLen >= 0.9 &&
      !isPointInStairShaft(span.midX, span.midZ, pad) &&
      !overlapsHigherPrioritySpan(span.midX, span.midZ, spans, si, 0.28)
    ) {
      // Wide ring corridors get twin parallel architectural LED lines; narrower corridors get centered line
      const offsets = span.width >= 5.0 ? [-0.92, 0.92] : [0]
      for (const lat of offsets) {
        const cx = span.midX + span.rightX * lat
        const cz = span.midZ + span.rightZ * lat
        if (isPointInStairShaft(cx, cz, pad)) continue
        housingRecords.push({
          cx,
          cy: housingY,
          cz,
          sx: 0.18,
          sy: 0.036,
          sz: stripLen + 0.08,
          yaw: span.yaw,
        })
        linearRecords.push({
          cx,
          cy: linearLampY,
          cz,
          sx: 0.11,
          sy: 0.02,
          sz: stripLen,
          yaw: span.yaw,
          color: span.kind === 'ring' ? '#f5f8ff' : '#e8f3ff',
        })
      }
    }

    // 2. Warm accent recessed downlights at corridor vertices (junctions) and periodic spacing
    const emitDownlight = (px: number, pz: number, tint: string): void => {
      if (isPointInStairShaft(px, pz, pad)) return
      const key = dlKey(px, pz)
      if (downlightSeen.has(key)) return
      downlightSeen.add(key)
      housingRecords.push({
        cx: px,
        cy: housingY - 0.008,
        cz: pz,
        sx: 0.24,
        sy: 0.03,
        sz: 0.24,
        yaw: 0,
      })
      downlightRecords.push({
        cx: px,
        cy: downlightY,
        cz: pz,
        sx: 0.16,
        sy: 0.018,
        sz: 0.16,
        yaw: 0,
        color: tint,
      })
    }

    emitDownlight(span.ax, span.az, '#fff0d4')
    emitDownlight(span.bx, span.bz, '#fff0d4')
    if (span.len >= 5.5) {
      const midCount = Math.min(3, Math.floor(span.len / 4.8))
      for (let mi = 1; mi <= midCount; mi++) {
        const s = (span.len * mi) / (midCount + 1)
        const px = span.ax + span.dx * s
        const pz = span.az + span.dz * s
        emitDownlight(px, pz, '#ffe9c6')
      }
    }
  }

  // 3. Shopfront warm cove washes + entry downlights giving lively commercial depth
  const spanByCorridor = new Map<string, typeof spans>()
  for (const sp of spans) {
    let arr = spanByCorridor.get(sp.corridorId)
    if (!arr) {
      arr = []
      spanByCorridor.set(sp.corridorId, arr)
    }
    arr.push(sp)
  }

  for (const shop of layout.shops) {
    const corrSpans = spanByCorridor.get(shop.frontage)
    let bestX = shop.rect.x
    let bestZ = shop.rect.z
    let bestDistSq = Infinity
    if (corrSpans) {
      for (const sp of corrSpans) {
        const dx = sp.midX - shop.rect.x
        const dz = sp.midZ - shop.rect.z
        const d2 = dx * dx + dz * dz
        if (d2 < bestDistSq) {
          bestDistSq = d2
          bestX = sp.midX
          bestZ = sp.midZ
        }
      }
    }
    const dirX = bestX - shop.rect.x
    const dirZ = bestZ - shop.rect.z
    const dirLen = Math.hypot(dirX, dirZ)
    if (dirLen < 0.05) continue
    const nx = dirX / dirLen
    const nz = dirZ / dirLen
    // Position soft additive warm glow card just in front of shop fascia (zero Z-fighting with wall)
    const offsetDist = Math.abs(nx) >= Math.abs(nz) ? shop.rect.w * 0.5 + 0.14 : shop.rect.d * 0.5 + 0.14
    const gx = shop.rect.x + nx * offsetDist
    const gz = shop.rect.z + nz * offsetDist
    if (isPointInStairShaft(gx, gz, pad)) continue

    const faceWidth = Math.max(1.2, Math.min(3.6, Math.abs(nx) >= Math.abs(nz) ? shop.rect.d * 0.78 : shop.rect.w * 0.78))
    const faceYaw = Math.atan2(nx, nz)
    coveRecords.push({
      cx: gx,
      cy: coveWashY,
      cz: gz,
      sx: faceWidth,
      sy: 0.36,
      sz: 1,
      yaw: faceYaw,
    })

    // Subtle warm downlight right outside the shopfront threshold
    const dlX = gx + nx * 0.42
    const dlZ = gz + nz * 0.42
    if (!isPointInStairShaft(dlX, dlZ, pad)) {
      const key = dlKey(dlX, dlZ)
      if (!downlightSeen.has(key)) {
        downlightSeen.add(key)
        downlightRecords.push({
          cx: dlX,
          cy: downlightY,
          cz: dlZ,
          sx: 0.15,
          sy: 0.018,
          sz: 0.15,
          yaw: 0,
          color: '#ffe4b8',
        })
      }
    }
  }

  // Unit geometries (3 lightweight primitives shared cleanly)
  const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1)
  const downlightGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1)
  const covePlaneGeo = new THREE.PlaneGeometry(1, 1)

  const linearLampMat = new THREE.MeshStandardMaterial({
    name: 'szj_atmos_linear_led',
    color: '#ffffff',
    emissive: new THREE.Color(activeSpec.linearLampColor),
    emissiveIntensity: activeSpec.linearLampIntensity,
    roughness: 0.25,
    metalness: 0.02,
  })
  const housingMat = new THREE.MeshStandardMaterial({
    name: 'szj_atmos_lamp_housing',
    color: activeSpec.lampHousingColor,
    metalness: 0.65,
    roughness: 0.42,
  })
  const downlightMat = new THREE.MeshStandardMaterial({
    name: 'szj_atmos_downlight_led',
    color: '#ffffff',
    emissive: new THREE.Color(activeSpec.downlightColor),
    emissiveIntensity: activeSpec.downlightIntensity,
    roughness: 0.22,
    metalness: 0.04,
  })
  const coveWashMat = new THREE.MeshBasicMaterial({
    name: 'szj_atmos_cove_wash',
    color: activeSpec.coveWashColor,
    transparent: true,
    opacity: activeSpec.coveWashOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  })

  const geometries: THREE.BufferGeometry[] = [unitBoxGeo, downlightGeo, covePlaneGeo]
  const materials: THREE.Material[] = [linearLampMat, housingMat, downlightMat, coveWashMat]
  const breakdown: SzjAtmosLayerMetric[] = []
  let totalDrawCalls = 0
  let totalTriangles = 0
  let totalInstances = 0
  let minElementY = Infinity
  let maxElementY = -Infinity

  const registerLayer = (built: ReturnType<typeof buildInstancedBoxLayer>): void => {
    if (!built) return
    group.add(built.mesh)
    breakdown.push(built.metric)
    totalDrawCalls += built.metric.drawCalls
    totalTriangles += built.metric.triangles
    totalInstances += built.metric.instances
    if (built.minY < minElementY) minElementY = built.minY
    if (built.maxY > maxElementY) maxElementY = built.maxY
  }

  registerLayer(buildInstancedBoxLayer('szj-atmos-linear-lamps', linearRecords, linearLampMat, unitBoxGeo, SZJ_ATMOS_BUDGET.caps.linearLamps))
  registerLayer(buildInstancedBoxLayer('szj-atmos-lamp-housings', housingRecords, housingMat, unitBoxGeo, SZJ_ATMOS_BUDGET.caps.lampHousings))
  registerLayer(buildInstancedBoxLayer('szj-atmos-downlights', downlightRecords, downlightMat, downlightGeo, SZJ_ATMOS_BUDGET.caps.downlights))
  registerLayer(buildInstancedBoxLayer('szj-atmos-cove-wash', coveRecords, coveWashMat, covePlaneGeo, SZJ_ATMOS_BUDGET.caps.coveWash))

  // 4. Calibrated Three.js light rig (0 drawCalls, bounded <= 6 local PointLights)
  const lights: THREE.Light[] = []
  const ringPointLights: THREE.PointLight[] = []
  const stairDaylightLights: THREE.PointLight[] = []
  let hemiLight: THREE.HemisphereLight | null = null
  let ambientLight: THREE.AmbientLight | null = null
  let keyLight: THREE.DirectionalLight | null = null

  if (includeLights) {
    hemiLight = new THREE.HemisphereLight(
      activeSpec.hemiSkyColor,
      activeSpec.hemiGroundColor,
      activeSpec.hemiIntensity,
    )
    hemiLight.name = 'szj-atmos-hemi'

    ambientLight = new THREE.AmbientLight(activeSpec.ambientColor, activeSpec.ambientIntensity)
    ambientLight.name = 'szj-atmos-ambient'

    keyLight = new THREE.DirectionalLight(activeSpec.keyLightColor, activeSpec.keyLightIntensity)
    keyLight.name = 'szj-atmos-key'
    keyLight.position.set(14, topY + 12, 10)

    lights.push(hemiLight, ambientLight, keyLight)

    // Pick 4 well-spaced cardinal anchor points around the ring concourse
    const ringCorr = layout.corridors.find(c => c.kind === 'ring') ?? layout.corridors[0]
    const ringAnchors: Array<{ x: number; z: number }> = []
    if (ringCorr && ringCorr.points.length >= 4) {
      const step = Math.max(1, Math.floor(ringCorr.points.length / 4))
      for (let i = 0; i < 4; i++) {
        const pt = ringCorr.points[(i * step) % ringCorr.points.length]!
        ringAnchors.push({ x: pt.x, z: pt.z })
      }
    } else {
      ringAnchors.push({ x: 0, z: -18 }, { x: 18, z: 0 }, { x: 0, z: 18 }, { x: -18, z: 0 })
    }

    const lightY = topY - 0.55
    for (let i = 0; i < ringAnchors.length && ringPointLights.length < 4; i++) {
      const a = ringAnchors[i]!
      const pl = new THREE.PointLight(
        activeSpec.ringPointColor,
        activeSpec.ringPointIntensity,
        activeSpec.ringPointDistance,
        1.7,
      )
      pl.name = `szj-atmos-ring-point-${i}`
      pl.position.set(a.x, lightY, a.z)
      ringPointLights.push(pl)
      lights.push(pl)
    }

    // 2 opposite-diagonal stairwell threshold daylight fill lights (total PointLights <= 6)
    const stairIndices = [0, 2]
    for (const idx of stairIndices) {
      const st = SZJ_STAIRWELLS[idx]
      if (!st || ringPointLights.length + stairDaylightLights.length >= SZJ_ATMOS_BUDGET.maxPointLights) break
      const pl = new THREE.PointLight(
        activeSpec.stairDaylightColor,
        activeSpec.stairDaylightIntensity,
        activeSpec.stairDaylightDistance,
        1.8,
      )
      pl.name = `szj-atmos-stair-daylight-${st.id}`
      pl.position.set(st.footIndoor.x, lightY, st.footIndoor.z)
      stairDaylightLights.push(pl)
      lights.push(pl)
    }

    for (const l of lights) group.add(l)
  }

  let appliedScene: THREE.Scene | null = null
  let savedFog: THREE.Fog | THREE.FogExp2 | null = null
  let savedBackground: THREE.Color | THREE.Texture | THREE.CubeTexture | null = null
  let phaseSec = 0
  let disposed = false

  function syncVisualState(): void {
    linearLampMat.emissive.set(activeSpec.linearLampColor)
    linearLampMat.emissiveIntensity = activeSpec.linearLampIntensity
    housingMat.color.set(activeSpec.lampHousingColor)
    downlightMat.emissive.set(activeSpec.downlightColor)
    downlightMat.emissiveIntensity = activeSpec.downlightIntensity
    coveWashMat.color.set(activeSpec.coveWashColor)
    coveWashMat.opacity = activeSpec.coveWashOpacity

    if (hemiLight) {
      hemiLight.color.set(activeSpec.hemiSkyColor)
      hemiLight.groundColor.set(activeSpec.hemiGroundColor)
      hemiLight.intensity = activeSpec.hemiIntensity
    }
    if (ambientLight) {
      ambientLight.color.set(activeSpec.ambientColor)
      ambientLight.intensity = activeSpec.ambientIntensity
    }
    if (keyLight) {
      keyLight.color.set(activeSpec.keyLightColor)
      keyLight.intensity = activeSpec.keyLightIntensity
    }
    for (const pl of ringPointLights) {
      pl.color.set(activeSpec.ringPointColor)
      pl.intensity = activeSpec.ringPointIntensity
      pl.distance = activeSpec.ringPointDistance
    }
    for (const pl of stairDaylightLights) {
      pl.color.set(activeSpec.stairDaylightColor)
      pl.intensity = activeSpec.stairDaylightIntensity
      pl.distance = activeSpec.stairDaylightDistance
    }
    if (appliedScene) {
      appliedScene.fog = new THREE.FogExp2(activeSpec.fogColor, activeSpec.fogDensity)
      appliedScene.background = new THREE.Color(activeSpec.backgroundColor)
    }
  }

  function restoreAtmosphere(): void {
    if (!appliedScene) return
    appliedScene.fog = savedFog
    appliedScene.background = savedBackground
    appliedScene = null
    savedFog = null
    savedBackground = null
  }

  return {
    group,
    lights,
    get spec() {
      return activeSpec
    },
    applyAtmosphere(scene: THREE.Scene): () => void {
      if (disposed) return () => {}
      if (appliedScene && appliedScene !== scene) {
        restoreAtmosphere()
      }
      if (!appliedScene) {
        appliedScene = scene
        savedFog = scene.fog
        savedBackground = scene.background
      }
      scene.fog = new THREE.FogExp2(activeSpec.fogColor, activeSpec.fogDensity)
      scene.background = new THREE.Color(activeSpec.backgroundColor)
      return () => {
        if (appliedScene === scene) restoreAtmosphere()
      }
    },
    applySpec(overrides: Partial<SzjAtmosRealitySpec>): void {
      if (disposed) return
      activeSpec = resolveAtmosSpec('real-guilin', { ...activeSpec, ...overrides })
      syncVisualState()
    },
    step(dtSec: number): void {
      if (disposed || !Number.isFinite(dtSec) || dtSec <= 0) return
      phaseSec = (phaseSec + dtSec) % 1000
      // Very subtle 1.5% commercial luminaire breath (0 per-frame allocations)
      const pulse = 1 + Math.sin(phaseSec * 1.4) * 0.015
      downlightMat.emissiveIntensity = activeSpec.downlightIntensity * pulse
    },
    getMetrics(): SzjAtmosMetrics {
      return {
        drawCalls: totalDrawCalls,
        triangles: totalTriangles,
        instances: totalInstances,
        lightCount: lights.length,
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
      restoreAtmosphere()
      group.removeFromParent()
      while (group.children.length > 0) {
        group.remove(group.children[0]!)
      }
      for (const l of lights) l.dispose()
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
    },
  }
}
