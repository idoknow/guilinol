import * as THREE from 'three'
import type { SzjLayout } from '../contract.ts'
import { createCeilingStructure } from './ceiling.ts'
import { createLightingRig } from './lighting.ts'
import { SZJ_ATMOS_BUDGET, SZJ_ATMOS_PRESETS, resolveAtmosSpec } from './spec.ts'
import type {
  SzjAtmosHandle,
  SzjAtmosMetrics,
  SzjAtmosOptions,
  SzjAtmosPresetName,
  SzjAtmosRealitySpec,
} from './types.ts'

/**
 * Unified factory combining B1 ceiling architecture (aluminium baffles/grille, exposed HVAC ducts,
 * cable trays, sprinklers, recessed acoustic plenum) with calibrated lighting rig & depth atmosphere.
 *
 * Designed for drop-in mounting by the B1 scene builder:
 * - `scene.add(atmos.group)`
 * - `atmos.applyAtmosphere(scene)`
 * - `atmos.dispose()` on teardown
 *
 * Strictly stays within k9 budget (`<= 12 drawCalls`, `<= 40,000 tris`, full geometry/material disposal).
 */
export function createSzjAtmos(
  layout: SzjLayout,
  opts: SzjAtmosOptions = {},
): SzjAtmosHandle {
  const ceiling = createCeilingStructure(layout, opts)
  const lighting = createLightingRig(layout, opts)

  const group = new THREE.Group()
  group.name = 'szj-atmos-root'
  group.add(ceiling.group, lighting.group)

  let disposed = false

  return {
    group,
    ceiling,
    lighting,
    lights: lighting.lights,
    applyAtmosphere(scene: THREE.Scene): () => void {
      return lighting.applyAtmosphere(scene)
    },
    applyPreset(presetOrSpec: SzjAtmosPresetName | Partial<SzjAtmosRealitySpec>): void {
      if (disposed) return
      if (typeof presetOrSpec === 'string') {
        lighting.applySpec(resolveAtmosSpec(presetOrSpec))
      } else {
        lighting.applySpec(presetOrSpec)
      }
    },
    step(dtSec: number): void {
      if (disposed) return
      lighting.step(dtSec)
    },
    getMetrics(): SzjAtmosMetrics {
      const cm = ceiling.getMetrics()
      const lm = lighting.getMetrics()
      return {
        drawCalls: cm.drawCalls + lm.drawCalls,
        triangles: cm.triangles + lm.triangles,
        instances: cm.instances + lm.instances,
        lightCount: cm.lightCount + lm.lightCount,
        geometryCount: cm.geometryCount + lm.geometryCount,
        materialCount: cm.materialCount + lm.materialCount,
        minElementY: Math.min(cm.minElementY, lm.minElementY),
        maxElementY: Math.max(cm.maxElementY, lm.maxElementY),
        breakdown: [...cm.breakdown, ...lm.breakdown],
      }
    },
    isDisposed: () => disposed,
    dispose(): void {
      if (disposed) return
      disposed = true
      ceiling.dispose()
      lighting.dispose()
      group.removeFromParent()
      while (group.children.length > 0) {
        group.remove(group.children[0]!)
      }
    },
  }
}

export { createCeilingStructure } from './ceiling.ts'
export { createLightingRig } from './lighting.ts'
export {
  SZJ_ATMOS_BUDGET,
  SZJ_ATMOS_PRESETS,
  countGeometryTriangles,
  extractCorridorSpans,
  isPointInStairShaft,
  resolveAtmosSpec,
} from './spec.ts'
export type {
  CorridorSpan,
  SzjAtmosHandle,
  SzjAtmosLayerMetric,
  SzjAtmosMetrics,
  SzjAtmosOptions,
  SzjAtmosPresetName,
  SzjAtmosRealitySpec,
  SzjCeilingHandle,
  SzjCeilingStyle,
  SzjLightingRigHandle,
} from './types.ts'
