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

function piecewiseLerp(r: number, low: number, mid: number, high: number): number {
  return r <= RENDER_RADIUS_DEFAULT
    ? THREE.MathUtils.lerp(low, mid, (r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
    : THREE.MathUtils.lerp(mid, high, (r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT))
}

export function deriveRangeMetrics(config: Pick<RenderRangeConfig, 'preset' | 'radius'> | number): RenderRangeMetrics {
  const normalized = normalizeRenderRange(config)
  const r = normalized.radius
  const t = THREE.MathUtils.clamp((r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_MAX - RENDER_RADIUS_MIN), 0, 1)

  const unloadRadius = r + Math.round(piecewiseLerp(r, 120, 190, 240))
  const spawnRingEdge = 80
  const nearLoadRadius = Math.min(r, 384)
  const nearConcurrency = r <= 320 ? 3 : 4
  const outerConcurrency = r >= 768 ? 3 : 2

  const landmarkLoadRadius = Math.round(piecewiseLerp(r, 380, 580, 1200))
  const landmarkUnloadRadius = landmarkLoadRadius + 140
  const landmarkLod0 = Math.round(piecewiseLerp(r, 150, 260, 560))
  const landmarkLod1 = Math.round(piecewiseLerp(r, 320, 520, 1080))
  const landmarkConcurrency = r >= 768 ? 3 : 2

  // Match forest range closer to loaded terrain on low presets so distant crowns do not float over coarse overview.
  const treeFar = Math.round(piecewiseLerp(r, 360, 1500, 1600))
  const treeLoadRadius = treeFar + Math.round(piecewiseLerp(r, 140, 182, 240))
  const treeUnloadRadius = treeLoadRadius + Math.round(piecewiseLerp(r, 64, 68, 96))
  const treeNearLod = Math.round(piecewiseLerp(r, 140, 240, 420))

  const buildingFarLod = Math.round(piecewiseLerp(r, 160, 280, 640))
  const streetRadius = Math.round(piecewiseLerp(r, 175, 300, 680))
  const peakLodSplit = Math.round(piecewiseLerp(r, 460, 800, 1600))

  // Keep balanced(480) identical to look/config.ts atmospheric horizon while tightening fast(256)
  // haze and horizon cull so unloaded periphery blends naturally without hiding closer peaks.
  const fogLengthScale = Number(piecewiseLerp(r, 0.62, 1.0, 1.35).toFixed(3))
  const fogBlueFrom = Math.round(piecewiseLerp(r, 220, look.fogBlueFrom, 850))
  const fogBlueTo = Math.round(piecewiseLerp(r, 1150, look.fogBlueTo, 4600))
  const fogHorizonFrom = Math.round(piecewiseLerp(r, 1500, look.fogHorizonFrom, 5600))
  const fogHorizonTo = Math.round(piecewiseLerp(r, 3000, look.fogHorizonTo, 8800))
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
