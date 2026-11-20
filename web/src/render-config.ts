export type RenderPresetId = 'fast' | 'balanced' | 'far' | 'custom'
export type RenderRangePreset = RenderPresetId
export type RenderConfigSource = 'url' | 'storage' | 'default'

export interface RenderPreset {
  id: Exclude<RenderPresetId, 'custom'>
  label: string
  radius: number
  summary: string
}

export interface RenderRangeConfig {
  preset: RenderPresetId
  radius: number
  source: RenderConfigSource
}

export interface RenderScope {
  chunkRadius: number
  unloadMargin: number
  landmarkLoadRadius: number
  landmarkUnloadRadius: number
  forestLoadRadius: number
  forestUnloadRadius: number
  fogScale: number
}

export const RENDER_RADIUS_MIN = 192
export const RENDER_RADIUS_MAX = 1600
export const RENDER_RADIUS_STEP = 32
export const RENDER_RADIUS_DEFAULT = 480
export const RENDER_STORAGE_KEY = 'glol.render-range'
export const RENDER_RANGE_STORAGE_KEY = RENDER_STORAGE_KEY

export const RENDER_PRESETS: readonly RenderPreset[] = [
  {id: 'fast', label: '极速', radius: 256, summary: '低耗秒落地'},
  {id: 'balanced', label: '均衡', radius: 480, summary: '街景山水兼顾'},
  {id: 'far', label: '远景', radius: 960, summary: '阔景览全城'},
] as const

const PRESET_ALIASES: Record<string, Exclude<RenderPresetId, 'custom'>> = {
  fast: 'fast',
  speed: 'fast',
  low: 'fast',
  极速: 'fast',
  balanced: 'balanced',
  balance: 'balanced',
  medium: 'balanced',
  default: 'balanced',
  均衡: 'balanced',
  far: 'far',
  high: 'far',
  ultra: 'far',
  远景: 'far',
}

export function clampRenderRadius(value: number): number {
  if (!Number.isFinite(value)) return RENDER_RADIUS_DEFAULT
  return Math.min(RENDER_RADIUS_MAX, Math.max(RENDER_RADIUS_MIN, Math.round(value)))
}

export function snapRenderRadius(value: number): number {
  const clamped = clampRenderRadius(value)
  const snapped = RENDER_RADIUS_MIN + Math.round((clamped - RENDER_RADIUS_MIN) / RENDER_RADIUS_STEP) * RENDER_RADIUS_STEP
  return clampRenderRadius(snapped)
}

export function presetForRadius(radius: number): RenderPresetId {
  const clamped = clampRenderRadius(radius)
  const match = RENDER_PRESETS.find(item => item.radius === clamped)
  return match ? match.id : 'custom'
}

export const inferPreset = presetForRadius

export function formatPresetLabel(preset: RenderPresetId, radius: number): string {
  const found = RENDER_PRESETS.find(item => item.id === preset)
  return found ? found.label : `${radius}m`
}

export function normalizeRenderRange(
  input?: Partial<RenderRangeConfig> | number | string,
  fallbackSource: RenderConfigSource = 'default',
): RenderRangeConfig {
  if (typeof input === 'number') {
    const radius = clampRenderRadius(input)
    return {preset: presetForRadius(radius), radius, source: fallbackSource}
  }
  if (typeof input === 'string') {
    const raw = input.trim()
    const alias = PRESET_ALIASES[raw.toLowerCase()] ?? PRESET_ALIASES[raw]
    if (alias) {
      const preset = RENDER_PRESETS.find(item => item.id === alias)!
      return {preset: preset.id, radius: preset.radius, source: fallbackSource}
    }
    const parsed = Number(raw)
    if (raw !== '' && Number.isFinite(parsed)) {
      const radius = clampRenderRadius(parsed)
      return {preset: presetForRadius(radius), radius, source: fallbackSource}
    }
    return {preset: 'balanced', radius: RENDER_RADIUS_DEFAULT, source: fallbackSource}
  }
  const source = input?.source ?? fallbackSource
  if (input?.preset && input.preset !== 'custom') {
    const preset = RENDER_PRESETS.find(item => item.id === input.preset)
    if (preset && (input.radius === undefined || clampRenderRadius(input.radius) === preset.radius)) {
      return {preset: preset.id, radius: preset.radius, source}
    }
  }
  const radius = clampRenderRadius(input?.radius ?? RENDER_RADIUS_DEFAULT)
  return {preset: presetForRadius(radius), radius, source}
}

export function parseRenderQuery(params: URLSearchParams): {preset: RenderPresetId; radius: number} | null {
  const rawRadius = params.get('radius')
  if (rawRadius !== null && rawRadius.trim() !== '') {
    const parsed = Number(rawRadius)
    if (Number.isFinite(parsed)) {
      const radius = clampRenderRadius(parsed)
      return {preset: presetForRadius(radius), radius}
    }
  }
  const rawRange = params.get('range')
  if (rawRange !== null && rawRange.trim() !== '') {
    const trimmed = rawRange.trim()
    const key = PRESET_ALIASES[trimmed.toLowerCase()] ?? PRESET_ALIASES[trimmed]
    if (key) {
      const preset = RENDER_PRESETS.find(item => item.id === key)!
      return {preset: preset.id, radius: preset.radius}
    }
  }
  return null
}

function readStoredConfig(): RenderRangeConfig | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(RENDER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    const rawRadius =
      typeof parsed === 'number'
        ? parsed
        : parsed && typeof parsed === 'object' && 'radius' in parsed
          ? Number((parsed as {radius: unknown}).radius)
          : NaN
    if (!Number.isFinite(rawRadius)) return null
    const radius = clampRenderRadius(rawRadius)
    return {preset: presetForRadius(radius), radius, source: 'storage'}
  } catch {
    return null
  }
}

export function loadRenderConfig(params: URLSearchParams): RenderRangeConfig {
  const fromQuery = parseRenderQuery(params)
  if (fromQuery) return {...fromQuery, source: 'url'}
  const fromStorage = readStoredConfig()
  if (fromStorage) return fromStorage
  return {preset: 'balanced', radius: RENDER_RADIUS_DEFAULT, source: 'default'}
}

export const resolveInitialRenderRange = loadRenderConfig

export function saveRenderConfig(radius: number): RenderRangeConfig {
  const clamped = clampRenderRadius(radius)
  const preset = presetForRadius(clamped)
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RENDER_STORAGE_KEY, JSON.stringify({preset, radius: clamped}))
    }
  } catch {
    // Ignore storage quota or private browsing errors so live preview keeps working.
  }
  return {preset, radius: clamped, source: 'storage'}
}

export function resetRenderConfig(): RenderRangeConfig {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(RENDER_STORAGE_KEY)
  } catch {
    // Ignore storage errors in restricted environments.
  }
  return {preset: 'balanced', radius: RENDER_RADIUS_DEFAULT, source: 'default'}
}

export function deriveRenderScope(radius: number): RenderScope {
  const r = clampRenderRadius(radius)
  const t = (r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_MAX - RENDER_RADIUS_MIN)
  return {
    chunkRadius: r,
    unloadMargin: Math.round(Math.min(240, Math.max(120, r * 0.36))),
    landmarkLoadRadius: Math.round(
      r <= RENDER_RADIUS_DEFAULT
        ? 540 + (900 - 540) * ((r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
        : 900 + (1650 - 900) * ((r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT)),
    ),
    landmarkUnloadRadius: Math.round(
      (r <= RENDER_RADIUS_DEFAULT
        ? 540 + (900 - 540) * ((r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
        : 900 + (1650 - 900) * ((r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT))) + 160,
    ),
    forestLoadRadius: Math.round(
      (r <= RENDER_RADIUS_DEFAULT
        ? 720 + (1500 - 720) * ((r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
        : 1500 + (1600 - 1500) * ((r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT))) + 184,
    ),
    forestUnloadRadius: Math.round(
      (r <= RENDER_RADIUS_DEFAULT
        ? 720 + (1500 - 720) * ((r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
        : 1500 + (1600 - 1500) * ((r - RENDER_RADIUS_DEFAULT) / (RENDER_RADIUS_MAX - RENDER_RADIUS_DEFAULT))) + 264,
    ),
    fogScale: Number(
      (r <= RENDER_RADIUS_DEFAULT
        ? 0.62 + (1.0 - 0.62) * ((r - RENDER_RADIUS_MIN) / (RENDER_RADIUS_DEFAULT - RENDER_RADIUS_MIN))
        : 1.0 + (1.35 - 1.0) * t).toFixed(3),
    ),
  }
}
