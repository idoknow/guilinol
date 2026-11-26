import * as THREE from 'three'

export interface BuildingOverride {
  h: number
  f: number
  u: number
  s: number
  r: number
  c: number
}

export interface StreetSignDef {
  x: number
  y: number
  z: number
  yaw: number
  zh: string
  en: string
  cross?: string
}

export interface CityUpgradeShardMeta {
  ring: string
  buildings: number
  fascias: number
}

export interface CityUpgradeIndex {
  version: number
  shardSize: number
  fasciaGrid: [number, number]
  bladeGrid?: [number, number]
  rings: Record<string, string[]>
  shards: Record<string, CityUpgradeShardMeta>
}

export interface CityUpgradeShard {
  overrides?: Record<string, BuildingOverride>
  // [x1, z1, x2, z2, y, nx, nz, kind]
  eaves?: [number, number, number, number, number, number, number, number][]
  // [x, y, z, yaw]
  acUnits?: [number, number, number, number][]
  // [x, y, z, yaw, w, h, d, atlasIdx]
  fascias?: [number, number, number, number, number, number, number, number][]
  // [x, y, z, yaw, bladeIdx]
  blades?: [number, number, number, number, number][]
  streetSigns?: StreetSignDef[]
  // [x1, z1, x2, z2, y1, y2, kind]
  walls?: [number, number, number, number, number, number, number][]
}

const LAYER_SIZE = 512
const LAYER_COUNT = 12
const BASE_URL = './city-upgrade'

function readUrlOverride(): boolean | null {
  if (typeof location === 'undefined') return null
  const raw = new URLSearchParams(location.search).get('cityUpgrade')
  if (raw === '0' || raw === 'false') return false
  if (raw === '1' || raw === 'true') return true
  return null
}

const urlOverride = readUrlOverride()
let enabled = urlOverride !== null ? urlOverride : true
let indexData: CityUpgradeIndex | null = null
let indexPromise: Promise<CityUpgradeIndex | null> | null = null
let texPromise: Promise<boolean> | null = null

const indexShardKeys = new Set<string>()
const loadedShards = new Map<string, CityUpgradeShard>()
const shardPromises = new Map<string, Promise<CityUpgradeShard | null>>()
const shardFailed = new Set<string>()
const overridesByTile = new Map<string, Map<number, BuildingOverride>>()
const shardToTiles = new Map<string, Set<string>>()
const upgradedTiles = new Set<string>()

const toggleListeners = new Set<(on: boolean) => void>()
const shardListeners = new Set<(key: string, shard: CityUpgradeShard | null) => void>()

function createDummyArrayTexture(): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1)
  tex.format = THREE.RGBAFormat
  tex.type = THREE.UnsignedByteType
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

const dummyArrayTex = createDummyArrayTexture()

export const cityUpgradeUniforms = {
  uCityUpgradeEnabled: { value: enabled ? 1.0 : 0.0 },
  uFacadeReady: { value: false },
  uFacadeAlbedo: { value: dummyArrayTex as THREE.DataArrayTexture },
  uFacadeNormH: { value: dummyArrayTex as THREE.DataArrayTexture },
  uFacadeProps: { value: dummyArrayTex as THREE.DataArrayTexture },
}

export function isCityUpgradeEnabled(): boolean {
  return enabled
}

export function setCityUpgradeEnabled(next: boolean): boolean {
  if (enabled === next) return false
  enabled = next
  cityUpgradeUniforms.uCityUpgradeEnabled.value = next ? 1.0 : 0.0
  for (const fn of toggleListeners) fn(next)
  return true
}

export function syncCityUpgradeQuality(quality: 'low' | 'mid' | 'high'): boolean {
  const target = urlOverride !== null ? urlOverride : quality !== 'low'
  return setCityUpgradeEnabled(target)
}

export function onCityUpgradeToggle(fn: (on: boolean) => void): () => void {
  toggleListeners.add(fn)
  return () => toggleListeners.delete(fn)
}

export function onCityUpgradeShard(fn: (key: string, shard: CityUpgradeShard | null) => void): () => void {
  shardListeners.add(fn)
  return () => shardListeners.delete(fn)
}

export function getCityUpgradeIndex(): CityUpgradeIndex | null {
  return indexData
}

export function getShardSize(): number {
  return indexData?.shardSize ?? 512
}

export function shardKeyForCoord(x: number, z: number): string {
  const s = getShardSize()
  return `${Math.floor(x / s)},${Math.floor(z / s)}`
}

export function shardKeyForTile(tileX: number, tileZ: number): string {
  return shardKeyForCoord(tileX + 128, tileZ + 128)
}

export function hasShardKey(key: string): boolean {
  return indexShardKeys.has(key)
}

export function hasShardForTile(tileX: number, tileZ: number): boolean {
  return indexShardKeys.has(shardKeyForTile(tileX, tileZ))
}

export function getLoadedShard(key: string): CityUpgradeShard | undefined {
  return loadedShards.get(key)
}

export function getLoadedShardKeys(): string[] {
  return Array.from(loadedShards.keys())
}

export function getBuildingOverride(tileX: number, tileZ: number, partIndex: number): BuildingOverride | undefined {
  if (!enabled) return undefined
  return overridesByTile.get(`${tileX},${tileZ}`)?.get(partIndex)
}

export function isCoordInUpgradedTile(wx: number, wz: number): boolean {
  if (!enabled || !upgradedTiles.size) return false
  const tx = Math.floor(wx / 256) * 256
  const tz = Math.floor(wz / 256) * 256
  return upgradedTiles.has(`${tx},${tz}`)
}

export function getCityUpgradeStats() {
  return {
    enabled,
    indexReady: indexData !== null,
    texturesReady: cityUpgradeUniforms.uFacadeReady.value,
    indexedShards: indexShardKeys.size,
    loadedShards: loadedShards.size,
    upgradedTiles: upgradedTiles.size,
    fasciaGrid: indexData?.fasciaGrid ?? [8, 6],
  }
}

function normalizeShardKey(raw: string): string {
  return raw.includes('_') && !raw.includes(',') ? raw.replace('_', ',') : raw
}

function shardFilename(key: string): string {
  return `${key.replace(',', '_')}.json`
}

function indexShardOverrides(key: string, shard: CityUpgradeShard): void {
  const tiles = new Set<string>()
  const ovs = shard.overrides
  if (ovs) {
    for (const [fullKey, ov] of Object.entries(ovs)) {
      const sep = fullKey.indexOf(':')
      if (sep <= 0) continue
      const tileKey = fullKey.slice(0, sep)
      const partIdx = Number(fullKey.slice(sep + 1))
      if (!Number.isInteger(partIdx)) continue
      let map = overridesByTile.get(tileKey)
      if (!map) {
        map = new Map<number, BuildingOverride>()
        overridesByTile.set(tileKey, map)
      }
      map.set(partIdx, ov)
      tiles.add(tileKey)
      upgradedTiles.add(tileKey)
    }
  }
  shardToTiles.set(key, tiles)
}

function removeShardOverrides(key: string): void {
  const tiles = shardToTiles.get(key)
  if (tiles) {
    for (const tileKey of tiles) {
      overridesByTile.delete(tileKey)
      upgradedTiles.delete(tileKey)
    }
    shardToTiles.delete(key)
  }
}

export function preloadCityUpgradeIndex(): Promise<CityUpgradeIndex | null> {
  if (indexPromise) return indexPromise
  if (typeof fetch !== 'function') return Promise.resolve(null)
  indexPromise = fetch(`${BASE_URL}/index.json`)
    .then(async res => {
      if (!res.ok) return null
      const data = (await res.json()) as CityUpgradeIndex
      indexData = data
      indexShardKeys.clear()
      if (data?.shards) {
        for (const k of Object.keys(data.shards)) indexShardKeys.add(normalizeShardKey(k))
      }
      return data
    })
    .catch(err => {
      console.warn('City upgrade index unavailable', err)
      return null
    })
  return indexPromise
}

export async function ensureShardByKey(key: string): Promise<CityUpgradeShard | null> {
  if (!enabled) return null
  if (!indexData) await preloadCityUpgradeIndex()
  if (!indexShardKeys.has(key)) return null
  const existing = loadedShards.get(key)
  if (existing) return existing
  if (shardFailed.has(key)) return null
  let pending = shardPromises.get(key)
  if (!pending) {
    pending = fetch(`${BASE_URL}/shards/${shardFilename(key)}`)
      .then(async res => {
        if (!res.ok) throw Error(`HTTP ${res.status}`)
        const shard = (await res.json()) as CityUpgradeShard
        loadedShards.set(key, shard)
        indexShardOverrides(key, shard)
        for (const fn of shardListeners) fn(key, shard)
        return shard
      })
      .catch(err => {
        shardFailed.add(key)
        console.warn(`City upgrade shard ${key} unavailable`, err)
        return null
      })
      .finally(() => {
        shardPromises.delete(key)
      })
    shardPromises.set(key, pending)
  }
  return pending
}

export async function ensureShardForTile(tileX: number, tileZ: number): Promise<CityUpgradeShard | null> {
  if (!enabled) return null
  if (!indexData) await preloadCityUpgradeIndex()
  const key = shardKeyForTile(tileX, tileZ)
  if (!indexShardKeys.has(key)) return null
  return ensureShardByKey(key)
}

export function releaseUnusedShards(keepKeys: Set<string>): string[] {
  const released: string[] = []
  for (const key of loadedShards.keys()) {
    if (keepKeys.has(key)) continue
    loadedShards.delete(key)
    removeShardOverrides(key)
    released.push(key)
    for (const fn of shardListeners) fn(key, null)
  }
  return released
}

async function loadStripAsArrayTexture(
  url: string,
  anisotropy: number,
): Promise<THREE.DataArrayTexture | null> {
  const res = await fetch(url)
  if (!res.ok) throw Error(`${url}: HTTP ${res.status}`)
  const blob = await res.blob()
  if (!enabled) return null
  const bitmap = await createImageBitmap(blob)
  if (!enabled) {
    bitmap.close()
    return null
  }
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  if (!enabled) {
    bitmap.close()
    return null
  }
  const w = LAYER_SIZE
  const h = LAYER_SIZE * LAYER_COUNT
  let rgba: Uint8Array<ArrayBuffer>
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0, w, h)
    const img = ctx.getImageData(0, 0, w, h)
    rgba = new Uint8Array(new ArrayBuffer(img.data.byteLength))
    rgba.set(img.data)
  } else {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0, w, h)
    const img = ctx.getImageData(0, 0, w, h)
    rgba = new Uint8Array(new ArrayBuffer(img.data.byteLength))
    rgba.set(img.data)
  }
  bitmap.close()
  const tex = new THREE.DataArrayTexture(rgba, LAYER_SIZE, LAYER_SIZE, LAYER_COUNT)
  tex.format = THREE.RGBAFormat
  tex.type = THREE.UnsignedByteType
  tex.colorSpace = THREE.NoColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = anisotropy
  tex.needsUpdate = true
  return tex
}

export function loadCityUpgradeTextures(renderer: THREE.WebGLRenderer): Promise<boolean> {
  if (!enabled) return Promise.resolve(false)
  if (texPromise) return texPromise
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  texPromise = (async () => {
    const albedo = await loadStripAsArrayTexture(`${BASE_URL}/facade-albedo.webp`, aniso)
    if (!albedo || !enabled) { albedo?.dispose(); texPromise = null; return false }
    const normh = await loadStripAsArrayTexture(`${BASE_URL}/facade-normh.png`, aniso)
    if (!normh || !enabled) { albedo.dispose(); normh?.dispose(); texPromise = null; return false }
    const props = await loadStripAsArrayTexture(`${BASE_URL}/facade-props.png`, aniso)
    if (!props || !enabled) { albedo.dispose(); normh.dispose(); props?.dispose(); texPromise = null; return false }
    cityUpgradeUniforms.uFacadeAlbedo.value = albedo
    cityUpgradeUniforms.uFacadeNormH.value = normh
    cityUpgradeUniforms.uFacadeProps.value = props
    cityUpgradeUniforms.uFacadeReady.value = true
    return true
  })().catch(err => {
    texPromise = null
    console.warn('City upgrade PBR facade library unavailable', err)
    return false
  })
  return texPromise
}
