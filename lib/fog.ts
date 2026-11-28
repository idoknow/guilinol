// 走过才解锁的地图迷雾（IDOK-588 / IDOK-605）——服务端与前端共用这一份网格定义。
//
// 网格盖住整个世界：48000 m 见方、每格 8 m，共 6000×6000 = 36,000,000 格。
// 只记录「走过」的格子（稀疏整数集合），没记录的默认是迷雾。
// 格子号 = iz * FOG_AXIS + ix，最大 35,999,999，放在 32 位整数里安全。
//
// IDOK-605：格子从 32 m 收到 8 m、点亮半径从 60 m 收到 10 m —— 玩家要的是 GPS 那种
// 「走到哪儿、方圆 10 m 亮一块」的手感，32 m 的格子一步亮一大片，看着不像开图。
// 格子变细后同一片面积需要更多格子，所以把上限与单次上报量一起放宽。

export const FOG_CELL = 8
export const FOG_ORIGIN = -24000
export const FOG_SPAN = 48000
export const FOG_AXIS = FOG_SPAN / FOG_CELL
/** 走到哪里就把周围这么远的一圈点亮（米）—— 站在路口能亮出脚下 10 m 的一小圈。 */
export const FOG_REVEAL = 10
/** 单个账号最多记这么多格（8 m 格 × 20 万 ≈ 12.8 km²；走遍全图也够用）。 */
export const FOG_MAX_CELLS = 200000
/** 一次上报最多带多少格，避免请求体过大。 */
export const FOG_POST_LIMIT = 600
/** 网格口径。改了 FOG_CELL / FOG_ORIGIN 就要 +1，服务端会丢掉旧口径的记录。 */
export const FOG_VERSION = 2

export function fogCell(x:number, z:number):number {
  const ix = Math.floor((x - FOG_ORIGIN) / FOG_CELL)
  const iz = Math.floor((z - FOG_ORIGIN) / FOG_CELL)
  if (ix < 0 || iz < 0 || ix >= FOG_AXIS || iz >= FOG_AXIS) return -1
  return iz * FOG_AXIS + ix
}

export function fogCellCenter(key:number):{x:number, z:number} {
  const ix = key % FOG_AXIS, iz = (key - ix) / FOG_AXIS
  return {x: FOG_ORIGIN + (ix + .5) * FOG_CELL, z: FOG_ORIGIN + (iz + .5) * FOG_CELL}
}

export function fogValidKey(key:unknown):key is number {
  return typeof key === 'number' && Number.isInteger(key) && key >= 0 && key < FOG_AXIS * FOG_AXIS
}

/** 把落点周围 FOG_REVEAL 米内的格子收集到 `out`，返回新增格数。按格心判距离，边缘不会漏角。 */
export function fogReveal(x:number, z:number, out:Set<number>):number {
  const before = out.size
  const r = FOG_REVEAL
  const minX = Math.floor((x - r - FOG_ORIGIN) / FOG_CELL), maxX = Math.floor((x + r - FOG_ORIGIN) / FOG_CELL)
  const minZ = Math.floor((z - r - FOG_ORIGIN) / FOG_CELL), maxZ = Math.floor((z + r - FOG_ORIGIN) / FOG_CELL)
  for (let iz = minZ; iz <= maxZ; iz += 1) {
    if (iz < 0 || iz >= FOG_AXIS) continue
    for (let ix = minX; ix <= maxX; ix += 1) {
      if (ix < 0 || ix >= FOG_AXIS) continue
      const cx = FOG_ORIGIN + (ix + .5) * FOG_CELL, cz = FOG_ORIGIN + (iz + .5) * FOG_CELL
      if ((cx - x) ** 2 + (cz - z) ** 2 > r * r) continue
      out.add(iz * FOG_AXIS + ix)
    }
  }
  return out.size - before
}

/** 一格多少平方公里（地图图例里的「已探明 N km²」用它换算）。 */
export const FOG_CELL_KM2 = FOG_CELL * FOG_CELL / 1e6
