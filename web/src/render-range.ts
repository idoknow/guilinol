import * as THREE from 'three'
import {look} from './look/config'
import {
  RENDER_RADIUS_DEFAULT,
  RENDER_RADIUS_MAX,
  RENDER_RADIUS_MIN,
  normalizeRenderRange,
  resetRenderConfig,
  saveRenderConfig,
  type RenderConfigSource,
  type RenderRangeConfig,
  type RenderRangePreset,
} from './render-config'

export * from './render-config'

export interface RenderRangeMetrics {
  preset: RenderRangePreset
  radius: number
  unloadRadius: number
  spawnRingEdge: number
  nearLoadRadius: number
  nearConcurrency: number
  outerConcurrency: number
  landmarkLoadRadius: number
  landmarkUnloadRadius: number
  landmarkLod0: number
  landmarkLod1: number
  landmarkConcurrency: number
  treeFar: number
  treeLoadRadius: number
  treeUnloadRadius: number
  treeNearLod: number
  buildingFarLod: number
  streetRadius: number
  peakLodSplit: number
  cullHorizon: number
  fogBlueFrom: number
  fogBlueTo: number
  fogHorizonFrom: number
  fogHorizonTo: number
  fogLengthScale: number
}

export function deriveRangeMetrics(config: Pick<RenderRangeConfig, 'preset' | 'radius'> | number): RenderRangeMetrics {
  const normalized = normalizeRenderRange(config)
  const r = normalized.radius
  const t = THREE.MathUtils.clamp((r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_MAX - RENDER_RADIUS_MIN), 0, 1)

  const unloadRadius = r + Math.round(THREE.MathUtils.clamp(r * 0.36, 120, 240))
  const spawnRingEdge = 80
  const nearLoadRadius = Math.min(r, 384)
  const nearConcurrency = r <= 320 ? 3 : 4
  const outerConcurrency = r >= 768 ? 3 : 2

  const landmarkLoadRadius = Math.round(
    r <= RENDER_RADIUS_DEFAULT
      ? THREE.MathUtils.lerp(540, 900, (r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
      : THREE.MathUtils.lerp(900, 1650, (r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT)),
  )
  const landmarkUnloadRadius = landmarkLoadRadius + 160
  const landmarkLod0 = Math.round(
    r <= RENDER_RADIUS_DEFAULT
      ? THREE.MathUtils.lerp(180, 350, (r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
      : THREE.MathUtils.lerp(350, 720, (r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT)),
  )
  const landmarkLod1 = Math.round(
    r <= RENDER_RADIUS_DEFAULT
      ? THREE.MathUtils.lerp(360, 650, (r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
      : THREE.MathUtils.lerp(650, 1280, (r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT)),
  )
  const landmarkConcurrency = r >= 768 ? 3 : 2

  // Match forest range closer to loaded terrain on low presets so distant crowns do not float over coarse overview.
  const treeFar = Math.round(
    r <= RENDER_RADIUS_DEFAULT
      ? THREE.MathUtils.lerp(360, 1500, (r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
      : THREE.MathUtils.lerp(1500, 1600, (r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT)),
  )
  const treeLoadRadius = treeFar + 184
  const treeUnloadRadius = treeLoadRadius + 80
  const treeNearLod = Math.round(THREE.MathUtils.clamp(r * 0.45 + 24, 140, 420))

  const buildingFarLod = Math.round(THREE.MathUtils.clamp(r * 0.54 + 20, 160, 640))
  const streetRadius = Math.round(THREE.MathUtils.clamp(r * 0.58 + 22, 175, 680))
  const peakLodSplit = Math.round(THREE.MathUtils.clamp(r * 1.35 + 150, 460, 1600))

  // Keep balanced(480) identical to look/config.ts atmospheric horizon while tightening fast(256)
  // haze and horizon cull so unloaded periphery blends naturally without hiding closer peaks.
  const fogLengthScale =
    r <= RENDER_RADIUS_DEFAULT
      ? Number(THREE.MathUtils.lerp(0.62, 1.0, (r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN)).toFixed(3))
      : Number(THREE.MathUtils.lerp(1.0, 1.35, (r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT)).toFixed(3))
  const fogBlueFrom = Math.round(
    r <= RENDER_RADIUS_DEFAULT
      ? THREE.MathUtils.lerp(220, look.fogBlueFrom, (r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
      : THREE.MathUtils.lerp(look.fogBlueFrom, 850, (r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT)),
  )
  const fogBlueTo = Math.round(
    r <= RENDER_RADIUS_DEFAULT
      ? THREE.MathUtils.lerp(1150, look.fogBlueTo, (r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
      : THREE.MathUtils.lerp(look.fogBlueTo, 4600, (r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT)),
  )
  const fogHorizonFrom = Math.round(
    r <= RENDER_RADIUS_DEFAULT
      ? THREE.MathUtils.lerp(1500, look.fogHorizonFrom, (r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
      : THREE.MathUtils.lerp(look.fogHorizonFrom, 5600, (r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT)),
  )
  const fogHorizonTo = Math.round(
    r <= RENDER_RADIUS_DEFAULT
      ? THREE.MathUtils.lerp(3000, look.fogHorizonTo, (r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
      : THREE.MathUtils.lerp(look.fogHorizonTo, 8800, (r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT)),
  )
  const cullHorizon = Math.max(fogHorizonTo, landmarkLoadRadius + 240, treeLoadRadius + 240, Math.round(2200 + t * 6600))

  return {
    preset: normalized.preset,
    radius: r,
    unloadRadius,
    spawnRingEdge,
    nearLoadRadius,
    nearConcurrency,
    outerConcurrency,
    landmarkLoadRadius,
    landmarkUnloadRadius,
    landmarkLod0,
    landmarkLod1,
    landmarkConcurrency,
    treeFar,
    treeLoadRadius,
    treeUnloadRadius,
    treeNearLod,
    buildingFarLod,
    streetRadius,
    peakLodSplit,
    cullHorizon,
    fogBlueFrom,
    fogBlueTo,
    fogHorizonFrom,
    fogHorizonTo,
    fogLengthScale,
  }
}

export type RenderRangeListener = (config: RenderRangeConfig, metrics: RenderRangeMetrics) => void

export class RenderRangeStore {
  private config: RenderRangeConfig
  private metrics: RenderRangeMetrics
  private listeners = new Set<RenderRangeListener>()

  constructor(initial?: Partial<RenderRangeConfig> | number | string) {
    this.config = normalizeRenderRange(initial)
    this.metrics = deriveRangeMetrics(this.config)
  }

  getConfig(): RenderRangeConfig {
    return {...this.config}
  }

  getMetrics(): RenderRangeMetrics {
    return this.metrics
  }

  set(
    next: Partial<RenderRangeConfig> | number | string,
    options?: {persist?: boolean; source?: RenderConfigSource},
  ): RenderRangeMetrics {
    const normalized = normalizeRenderRange(
      next,
      options?.persist ? 'storage' : (options?.source ?? this.config.source),
    )
    const persisted = options?.persist ? saveRenderConfig(normalized.radius) : normalized
    const changed =
      persisted.radius !== this.config.radius ||
      persisted.preset !== this.config.preset ||
      persisted.source !== this.config.source
    this.config = persisted
    if (changed) {
      this.metrics = deriveRangeMetrics(persisted)
      for (const listener of this.listeners) listener(this.getConfig(), this.metrics)
    }
    return this.metrics
  }

  reset(): RenderRangeConfig {
    const next = resetRenderConfig()
    const changed =
      next.radius !== this.config.radius ||
      next.preset !== this.config.preset ||
      next.source !== this.config.source
    this.config = next
    this.metrics = deriveRangeMetrics(next)
    if (changed) {
      for (const listener of this.listeners) listener(this.getConfig(), this.metrics)
    }
    return this.getConfig()
  }

  subscribe(listener: RenderRangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
