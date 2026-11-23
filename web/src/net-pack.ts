/**
 * 兼容旧服务端：把全部状态打包进 pos 的 bike 字符串。
 *
 * 背景：线上 /opt/guilin-rt 还是旧版，它只转发 x/y/z/yaw/v/bike，
 * cr/gr/dn/pn/wl/hb/sc... 全被丢掉，于是别人只能看到你走路和跳。
 * 旧服务端对 bike 是 clampStr(msg.bike, 32) —— 32 个字符足够塞下所有状态。
 *
 * 打包格式（base36，定长，共 12 字符）：
 *   [0]     标志位 0..63：1 骑车 | 2 蹲 | 4 空中 | 8 倒地 | 16 出拳 | 32 附近有车
 *   [1..2]  part2 = 翘头(0..3) + 抽烟阶段(0..2)*4 + 品牌(0..3)*12   → 0..47
 *   [3]     可燃值/5（0..35）
 *   [4]     吸了几口 %36
 *   [5..6]  叫来的车：相对我位置的 x 偏移（分米，+1296 偏置）
 *   [7..8]  同上 z 偏移
 *   [9..10] 那辆车的朝向（度，0..359）
 *   [11]    保留
 *
 * 服务端只认 bike 非空就是「在骑车」，但我们自己按 [0] 的 bit1 判断，不依赖它。
 */
const BASE = 36

const enc = (value: number, width: number) => {
  let text = Math.max(0, Math.round(value)).toString(BASE)
  while (text.length < width) text = '0' + text
  return text.slice(-width)
}

const dec = (text: string) => parseInt(text, BASE) || 0

export interface PackedState {
  riding: boolean
  crouch: boolean
  air: boolean
  down: boolean
  punch: boolean
  nearBike: boolean
  wheelie: number
  smokePhase: number
  brand: number
  burn: number
  puffs: number
  bikeX: number
  bikeZ: number
  bikeYaw: number
}

export function packState(self: {
  bike?: string
  cr?: number
  gr?: number
  dn?: number
  pn?: number
  hb?: number
  wl?: number
  sc?: number
  sb?: number
  sp?: number
  br?: number
  hx?: number
  hz?: number
  hyaw?: number
  x?: number
  z?: number
}): string {
  const flags =
    (self.bike ? 1 : 0) |
    (self.cr ? 2 : 0) |
    (self.gr === 0 ? 4 : 0) |
    (self.dn ? 8 : 0) |
    (self.pn ? 16 : 0) |
    (self.hb ? 32 : 0)
  const wheelie = Math.min(3, Math.max(0, Math.round((self.wl ?? 0) * 3)))
  const smokePhase = Math.min(2, Math.max(0, Math.round(self.sc ?? 0)))
  const brand = Math.min(3, Math.max(0, Math.round(self.br ?? 0)))
  const part2 = wheelie + smokePhase * 4 + brand * 12
  const burn = Math.min(35, Math.max(0, Math.round((self.sb ?? 0) / 5)))
  const puffs = Math.min(35, Math.max(0, Math.round(self.sp ?? 0) % 36))
  const dx = Math.max(0, Math.min(1295, Math.round(((self.hx ?? 0) - (self.x ?? 0)) * 10) + 648))
  const dz = Math.max(0, Math.min(1295, Math.round(((self.hz ?? 0) - (self.z ?? 0)) * 10) + 648))
  const yaw = Math.max(0, Math.min(1295, Math.round(((self.hyaw ?? 0) * 180) / Math.PI) % 360))
  return (
    'S' +
    enc(flags, 1) +
    enc(part2, 2) +
    enc(burn, 1) +
    enc(puffs, 1) +
    enc(dx, 2) +
    enc(dz, 2) +
    enc(yaw, 2) +
    '0'
  )
}

export function unpackState(raw: string, x: number, z: number): PackedState | null {
  if (typeof raw !== 'string' || raw.length < 11 || raw[0] !== 'S') return null
  const flags = dec(raw.slice(1, 2))
  const part2 = dec(raw.slice(2, 4))
  const burn = dec(raw.slice(4, 5))
  const puffs = dec(raw.slice(5, 6))
  const dx = dec(raw.slice(6, 8)) - 648
  const dz = dec(raw.slice(8, 10)) - 648
  const yaw = (dec(raw.slice(10, 12)) * Math.PI) / 180
  const wheelie = part2 % 4
  const smokePhase = (part2 % 12) / 4 | 0
  const brand = (part2 / 12) | 0
  return {
    riding: (flags & 1) !== 0,
    crouch: (flags & 2) !== 0,
    air: (flags & 4) === 0,
    down: (flags & 8) !== 0,
    punch: (flags & 16) !== 0,
    nearBike: (flags & 32) !== 0,
    wheelie: wheelie / 3,
    smokePhase,
    brand,
    burn: burn * 5,
    puffs,
    bikeX: x + dx / 10,
    bikeZ: z + dz / 10,
    bikeYaw: yaw,
  }
}
