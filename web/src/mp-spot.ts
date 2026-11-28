// IDOK-566: 联机模式记住玩家上次站的位置，下次进入联机直接落回那里，而不是每次都从中心广场出生。
// 记的是步行者脚下的 x/z 和朝向（walker.yaw，即 walkTo/enter 的 heading），不是第三人称相机；
// 落地失败（那里被占/不可站）时 main.ts 依次退回广场、出生门。
export const MP_SPOT_KEY = 'glol.mpSpot'
const MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days
const LIMIT = 50000 // metres; anything beyond is corrupt

export type MpSpot = {x: number; z: number; yaw: number}
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const finite = (value: unknown, limit = LIMIT): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit

export function readMpSpot(store: Store = localStorage, now = Date.now(), key=MP_SPOT_KEY): MpSpot | null {
  let raw: string | null = null
  try { raw = store.getItem(key) } catch { return null }
  if (!raw) return null
  try {
    const r = JSON.parse(raw) as {x?: unknown; z?: unknown; yaw?: unknown; t?: unknown} | null
    if (!r || typeof r !== 'object') return null
    if (!finite(r.x) || !finite(r.z) || !finite(r.yaw, 1000) || !finite(r.t, Number.MAX_SAFE_INTEGER)) return null
    if (now - r.t > MAX_AGE) return null
    return {x: r.x, z: r.z, yaw: r.yaw}
  } catch { return null }
}

export function saveMpSpot(spot: MpSpot, store: Store = localStorage, now = Date.now(), key=MP_SPOT_KEY): void {
  if (!finite(spot.x) || !finite(spot.z) || !finite(spot.yaw, 1000)) return
  try { store.setItem(key, JSON.stringify({x: Math.round(spot.x * 10) / 10, z: Math.round(spot.z * 10) / 10, yaw: Math.round(spot.yaw * 1000) / 1000, t: now})) } catch { /* private mode */ }
}

export function clearMpSpot(store: Store = localStorage): void {
  try { store.removeItem(MP_SPOT_KEY) } catch { /* private mode */ }
}
