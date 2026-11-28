// 走过才解锁的地图迷雾（IDOK-588）——服务端与前端共用这一份网格定义。
//
// 网格盖住整个世界：48000 m 见方、每格 32 m，共 1500×1500 = 2,250,000 格。
// 只记录「走过」的格子（稀疏整数集合），没记录的默认是迷雾。
// 格子号 = iz * FOG_AXIS + ix，放在 32 位整数里安全（最大 2,249,999）。

export const FOG_CELL = 32
export const FOG_ORIGIN = -24000
export const FOG_SPAN = 48000
export const FOG_AXIS = FOG_SPAN / FOG_CELL
/** 走到哪里就把周围这么远的一圈点亮（米）——约 4 格半径，走廊看起来是连续的。 */
export const FOG_REVEAL = 60
/** 单个账号最多记这么多格（走遍全图也到不了 6 万格，超了只保留最早的部分）。 */
export const FOG_MAX_CELLS = 60000
/** 一次上报最多带多少格，避免请求体过大。 */
export const FOG_POST_LIMIT = 600

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

/** 把落点周围 FOG_REVEAL 米内的格子收集到 `out`，返回新增格数。 */
export function fogReveal(x:number, z:number, out:Set<number>):number {
  const before = out.size
  const r = FOG_REVEAL
  for (let dz = -r; dz <= r; dz += FOG_CELL) for (let dx = -r; dx <= r; dx += FOG_CELL) {
    if (dx * dx + dz * dz > r * r) continue
    const key = fogCell(x + dx, z + dz)
    if (key >= 0) out.add(key)
  }
  return out.size - before
}
