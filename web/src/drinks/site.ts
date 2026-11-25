import { ll2xz, xz2ll } from '../../../lib/projection.ts'

export type DrinksSiteId = 'zhengyang_208' | 'wangcheng_mall'

export interface DrinksSiteCandidate {
  readonly id: DrinksSiteId
  readonly label: string
  readonly address: string
  readonly lon: number
  readonly lat: number
  /** Building centroid lon/lat when frontage anchor differs from polygon centroid. */
  readonly centroidLon: number
  readonly centroidLat: number
  /** True compass bearing (deg clockwise from North) of the shop's front facade outward normal (+Z in shop-local). */
  readonly bearingDeg: number
  readonly worldX: number
  readonly worldZ: number
  readonly centroidWorldX: number
  readonly centroidWorldZ: number
  readonly worldYaw: number
  readonly fallbackGroundY: number
  readonly osmRef: string
  readonly photoRefs: readonly string[]
  readonly source: string
  readonly confidence: '高' | '中' | '低'
}

export interface WorldPoint2D {
  x: number
  z: number
}

export interface LonLatPoint {
  lon: number
  lat: number
}

/**
 * Convert WGS84 (lon, lat) to project local meters (x = East, z = South)
 * using the repository's canonical `lib/projection.ts` (`ll2xz`).
 */
export function lonLatToWorldXZ(lon: number, lat: number): WorldPoint2D {
  return ll2xz(lat, lon)
}

/**
 * Inverse projection from project world meters (x, z) back to WGS84 (lon, lat).
 */
export function worldXZToLonLat(x: number, z: number): LonLatPoint {
  return xz2ll(x, z)
}

/**
 * Convert true compass bearing (degrees clockwise from true North `-Z`) to Three.js `rotation.y` (radians)
 * so that shop-local `+Z` (front entrance & patio) points along `(sin(bearing), -cos(bearing))`.
 */
export function bearingDegToWorldYaw(bearingDeg: number): number {
  const rad = (bearingDeg * Math.PI) / 180
  return Math.atan2(Math.sin(rad), -Math.cos(rad))
}

function createSiteCandidate(spec: {
  id: DrinksSiteId
  label: string
  address: string
  lon: number
  lat: number
  centroidLon?: number
  centroidLat?: number
  bearingDeg: number
  fallbackGroundY: number
  osmRef: string
  photoRefs: readonly string[]
  source: string
  confidence: '高' | '中' | '低'
}): DrinksSiteCandidate {
  const world = lonLatToWorldXZ(spec.lon, spec.lat)
  const cLon = spec.centroidLon ?? spec.lon
  const cLat = spec.centroidLat ?? spec.lat
  const centroidWorld = lonLatToWorldXZ(cLon, cLat)
  return {
    id: spec.id,
    label: spec.label,
    address: spec.address,
    lon: spec.lon,
    lat: spec.lat,
    centroidLon: cLon,
    centroidLat: cLat,
    bearingDeg: spec.bearingDeg,
    worldX: Math.round(world.x * 1000) / 1000,
    worldZ: Math.round(world.z * 1000) / 1000,
    centroidWorldX: Math.round(centroidWorld.x * 1000) / 1000,
    centroidWorldZ: Math.round(centroidWorld.z * 1000) / 1000,
    worldYaw: bearingDegToWorldYaw(spec.bearingDeg),
    fallbackGroundY: spec.fallbackGroundY,
    osmRef: spec.osmRef,
    photoRefs: spec.photoRefs,
    source: spec.source,
    confidence: spec.confidence,
  }
}

/**
 * Dual-candidate site registry verified against GL04 terrain (`public/world`), RoadCtrl street grade, and OSM footprints:
 * 1) `zhengyang_208`: In-repo POI 正阳路208号 (110.2938048, 25.2806767 -> (-623.60, -74.83), flat GL04 groundY 155.70m)
 * 2) `wangcheng_mall`: 王城商厦 OSM way/264901525 north Liberation East Rd frontage (17.5m east of NW corner v0, +1.15m outward
 *    so shop front +2.8m & full patio +5.2m sit flush on inner plaza south of yellow tactile strip `[39]` (+5.50..+6.05m);
 *    bearing 13.4° matches exact `v0->v1` outward normal; fallbackGroundY 157.35m aligns with RoadCtrl sidewalk datum 157.15+0.195m).
 */
export const DRINKS_SITE_CANDIDATES: Readonly<Record<DrinksSiteId, DrinksSiteCandidate>> = {
  zhengyang_208: createSiteCandidate({
    id: 'zhengyang_208',
    label: '正阳路208号 · 东西巷牌坊口',
    address: '桂林市秀峰区正阳路208号（东西巷牌坊南侧临街）',
    lon: 110.2938048,
    lat: 25.2806767,
    bearingDeg: 13.4,
    fallbackGroundY: 155.7,
    osmRef: 'baidu:89f748120f2470e20bccdde0',
    photoRefs: [
      'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg',
      'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg',
      'docs/refs/rock/walk-shizijie-wangcheng/08_IMG_1397.jpg',
    ],
    source: 'docs/layout/dongxi-layout.md:116 & GL04 (-623.60, -74.83, flat terrainY 155.70m)',
    confidence: '中',
  }),
  wangcheng_mall: createSiteCandidate({
    id: 'wangcheng_mall',
    label: '王城商厦 · 转角裙房',
    address: '桂林市秀峰区解放东路11号王城商厦北侧转角沿街裙房',
    lon: 110.2942555,
    lat: 25.2806134,
    centroidLon: 110.2942305,
    centroidLat: 25.2803115,
    bearingDeg: 13.4,
    fallbackGroundY: 157.35,
    osmRef: 'way/264901525',
    photoRefs: [
      'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg',
      'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg',
      'docs/refs/rock/walk-shizijie-wangcheng/08_IMG_1397.jpg',
      'docs/refs/rock/walk-shizijie-wangcheng/09_IMG_1398.jpg',
    ],
    source: 'OSM way/264901525 v0->v1 北立面外法线 13.4° & GL04 RoadCtrl 解放东路人行道实测标高 157.35m',
    confidence: '高',
  }),
}

export const DEFAULT_DRINKS_SITE_ID: DrinksSiteId = 'wangcheng_mall'

export const SITE: DrinksSiteCandidate = DRINKS_SITE_CANDIDATES[DEFAULT_DRINKS_SITE_ID]

export function resolveDrinksSiteId(searchOrId?: string | null): DrinksSiteId {
  if (!searchOrId) return DEFAULT_DRINKS_SITE_ID
  const trimmed = searchOrId.trim()
  if (trimmed === 'zhengyang_208' || trimmed === 'wangcheng_mall') return trimmed
  const query = trimmed.startsWith('?') ? trimmed.slice(1) : trimmed
  const params = new URLSearchParams(query)
  const raw = params.get('drinksSite') ?? params.get('drinks_site')
  if (raw === 'wangcheng_mall' || raw === '264901525' || raw === 'way/264901525') return 'wangcheng_mall'
  if (raw === 'zhengyang_208' || raw === '208') return 'zhengyang_208'
  return DEFAULT_DRINKS_SITE_ID
}

export function resolveDrinksSite(siteIdOrSearch?: DrinksSiteId | string | null): DrinksSiteCandidate {
  return DRINKS_SITE_CANDIDATES[resolveDrinksSiteId(siteIdOrSearch)]
}

/**
 * Transform shop-local `(lx, lz)` to world `(x, z)` matching Three.js `rotation.y = site.worldYaw`
 * and `drinks/npc/renderer.ts` `toWorld()`.
 */
export function shopLocalToWorld(
  site: Pick<DrinksSiteCandidate, 'worldX' | 'worldZ' | 'worldYaw'>,
  lx: number,
  lz: number,
): WorldPoint2D {
  const c = Math.cos(site.worldYaw)
  const s = Math.sin(site.worldYaw)
  return {
    x: site.worldX + lx * c + lz * s,
    z: site.worldZ - lx * s + lz * c,
  }
}

/**
 * Inverse transform from world `(wx, wz)` into shop-local `(x, z)`.
 */
export function worldToShopLocal(
  site: Pick<DrinksSiteCandidate, 'worldX' | 'worldZ' | 'worldYaw'>,
  wx: number,
  wz: number,
): WorldPoint2D {
  const dx = wx - site.worldX
  const dz = wz - site.worldZ
  const c = Math.cos(site.worldYaw)
  const s = Math.sin(site.worldYaw)
  return {
    x: dx * c - dz * s,
    z: dx * s + dz * c,
  }
}

export interface DrinksMountPolicyInput {
  isDev: boolean
  search?: string | null
}

/**
 * Production default NEVER mounts the drinks shop into the world.
 * Enabled only in Vite DEV (`isDev: true`, unless explicitly disabled with `?drinks=0`)
 * or when explicitly opted in via `?drinks=1` / `?drinks=true`.
 */
export function shouldMountDrinksShop(input: DrinksMountPolicyInput): boolean {
  const rawSearch = input.search ?? ''
  const query = rawSearch.startsWith('?') ? rawSearch.slice(1) : rawSearch
  const params = new URLSearchParams(query)
  const flag = params.get('drinks')
  if (flag !== null) {
    const norm = flag.trim().toLowerCase()
    if (norm === '0' || norm === 'false' || norm === 'off' || norm === 'no') return false
    if (norm === '' || norm === '1' || norm === 'true' || norm === 'on' || norm === 'yes') return true
  }
  return Boolean(input.isDev)
}
