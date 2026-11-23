// 相机机身表（IDOK-182）：四台机器的传感器、可调范围、开关能力，以及挂到手上的外观参数。
// 所有范围都按真实机型量级写；UI 只显示这台机器支持的项，成像按这里的传感器/ISO 出噪声。

export type BodyId = 'mirrorless' | 'action' | 'pocket' | 'thumb'

export interface CameraBody {
  id: BodyId
  name: string
  short: string
  /** 一句卖点，挂在读数卡第二行 */
  tagline: string
  sensor: string
  baseIso: number
  /** ISO 挡位（跟真机一样是一挡一挡的） */
  iso: number[]
  /** 快门：秒。1/8000 = 0.000125 */
  shutter: number[]
  /** 光圈挡位，没有可换光圈的机器留空 */
  aperture: number[]
  /** 等效焦距 mm，step 是滑杆的步长 */
  focal: {min: number; max: number; step: number; fixed?: boolean}
  /** 数码变焦上限（1 = 不放大） */
  zoomMax: number
  /** 白平衡范围（K） */
  wb: {min: number; max: number; step: number}
  /** 曝光补偿范围（EV） */
  ev: {min: number; max: number; step: number}
  formats: ('jpeg' | 'png')[]
  raw: boolean
  macro: boolean
  wide: boolean
  level: boolean
  grid: boolean
  video: {label: string; width: number; height: number; fps: number; bitrate: number; mime: string[]}
  /** 机身尺寸（米），程序化占位模型用 */
  size: [number, number, number]
  lens: {length: number; radius: number} | null
  color: {body: string; accent: string; metal: string; grip: string}
}

const SHUTTER_FAST = [1 / 8000, 1 / 4000, 1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 125, 1 / 60, 1 / 30, 1 / 15, 1 / 8, 1 / 4]
const SHUTTER_SLOW = [1 / 2, 1, 2, 4, 8, 15, 30]

export const CAMERAS: Record<BodyId, CameraBody> = {
  mirrorless: {
    id: 'mirrorless',
    name: '临江 M1 全画幅微单',
    short: '微单',
    tagline: '全画幅 · 可换镜头 · 专业档位齐',
    sensor: '全画幅 36×24mm',
    baseIso: 100,
    iso: [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200],
    shutter: [...SHUTTER_FAST, ...SHUTTER_SLOW],
    aperture: [1.4, 2, 2.8, 4, 5.6, 8, 11, 16],
    focal: {min: 24, max: 120, step: 1},
    zoomMax: 3,
    wb: {min: 2500, max: 10000, step: 100},
    ev: {min: -3, max: 3, step: 1 / 3},
    formats: ['jpeg', 'png'],
    raw: true,
    macro: false,
    wide: false,
    level: true,
    grid: true,
    video: {label: '4K 30', width: 3840, height: 2160, fps: 30, bitrate: 24000000, mime: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']},
    size: [0.12, 0.085, 0.065],
    lens: {length: 0.07, radius: 0.032},
    color: {body: '#24262a', accent: '#d9d3c4', metal: '#9aa0a6', grip: '#17181b'},
  },
  action: {
    id: 'action',
    name: '浪尖 A9 运动相机',
    short: 'action',
    tagline: '超广角 · 防抖 · 耐造的小方块',
    sensor: '1/2.3 英寸 12mm 超广角',
    baseIso: 100,
    iso: [100, 200, 400, 800, 1600, 3200, 6400],
    shutter: [1 / 4000, 1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 120, 1 / 60, 1 / 30],
    aperture: [],
    focal: {min: 16, max: 16, step: 1, fixed: true},
    zoomMax: 4,
    wb: {min: 2500, max: 8000, step: 100},
    ev: {min: -2, max: 2, step: 1 / 3},
    formats: ['jpeg', 'png'],
    raw: true,
    macro: false,
    wide: true,
    level: true,
    grid: true,
    video: {label: '4K 60', width: 3840, height: 2160, fps: 60, bitrate: 32000000, mime: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']},
    size: [0.065, 0.045, 0.03],
    lens: {length: 0.008, radius: 0.013},
    color: {body: '#2c3138', accent: '#e8e2d2', metal: '#6f7780', grip: '#1a1d21'},
  },
  pocket: {
    id: 'pocket',
    name: '石阶 P3 口袋云台',
    short: 'pocket',
    tagline: '1 英寸底 · 三轴云台 · 单手稳拍',
    sensor: '1 英寸 20mm',
    baseIso: 100,
    iso: [100, 200, 400, 800, 1600, 3200, 6400],
    shutter: [1 / 4000, 1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 120, 1 / 60, 1 / 30, 1 / 8, 1 / 2, 1, 2],
    aperture: [2, 2.8, 4, 5.6, 8, 11],
    focal: {min: 20, max: 40, step: 1},
    zoomMax: 4,
    wb: {min: 2500, max: 8000, step: 100},
    ev: {min: -2, max: 2, step: 1 / 3},
    formats: ['jpeg', 'png'],
    raw: true,
    macro: false,
    wide: false,
    level: true,
    grid: true,
    video: {label: '4K 60', width: 3840, height: 2160, fps: 60, bitrate: 28000000, mime: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']},
    size: [0.035, 0.125, 0.035],
    lens: {length: 0.012, radius: 0.011},
    color: {body: '#2f3339', accent: '#efe8d8', metal: '#adb3ba', grip: '#211f1d'},
  },
  thumb: {
    id: 'thumb',
    name: '萤火 GO 拇指相机',
    short: '拇指',
    tagline: '拇指大 · 磁吸夹 · 贴近拍',
    sensor: '1/2.3 英寸 12mm 鱼眼',
    baseIso: 100,
    iso: [100, 200, 400, 800, 1600, 3200],
    shutter: [1 / 8000, 1 / 4000, 1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 120, 1 / 60, 1 / 30],
    aperture: [],
    focal: {min: 12, max: 12, step: 1, fixed: true},
    zoomMax: 2,
    wb: {min: 2500, max: 7000, step: 100},
    ev: {min: -2, max: 2, step: 1 / 3},
    formats: ['jpeg', 'png'],
    raw: false,
    macro: true,
    wide: true,
    level: false,
    grid: true,
    video: {label: '2.7K 30', width: 2704, height: 1520, fps: 30, bitrate: 16000000, mime: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']},
    size: [0.05, 0.03, 0.016],
    lens: {length: 0.004, radius: 0.006},
    color: {body: '#31363c', accent: '#f0ead9', metal: '#8d949b', grip: '#1c1e21'},
  },
}

export const BODY_IDS: BodyId[] = ['mirrorless', 'action', 'pocket', 'thumb']

export function camera(id: BodyId): CameraBody {
  return CAMERAS[id]
}

/** 白平衡预设：读数是色温，按钮给个好记的名字。 */
export const WB_PRESETS: [string, number][] = [
  ['烛光', 2700],
  ['白炽', 3200],
  ['日光', 5500],
  ['阴天', 6500],
  ['阴影', 7500],
  ['晴天阴影', 9000],
]

/** 快门显示：1/8000 → "1/8000"，2 → "2s" */
export function shutterLabel(seconds: number): string {
  if (seconds >= 1) return `${seconds % 1 ? seconds.toFixed(1) : seconds}s`
  return `1/${Math.round(1 / seconds)}`
}

export function isoLabel(iso: number): string {
  return String(Math.round(iso))
}

export function focalLabel(mm: number): string {
  return `${Math.round(mm)}mm`
}

/** 最近一挡（ISO/光圈/快门都是挡位表，滑杆只负责选最接近的挡） */
export function nearest<T>(list: T[], value: number, pick: (item: T) => number): T {
  let best = list[0]
  let gap = Infinity
  for (const item of list) {
    const d = Math.abs(pick(item) - value)
    if (d < gap) {
      gap = d
      best = item
    }
  }
  return best
}

/** 焦距 → 垂直 FOV（度）。按 24mm 高（全画幅）折算，等效焦距本来就是按这个口径给的。 */
export function focalToFov(mm: number): number {
  const sensorHeight = 24
  return (2 * Math.atan(sensorHeight / 2 / mm) * 180) / Math.PI
}

/** 机身几何尺寸（米）：pocket 是手柄高度，微单含镜头长度 */
export function bodyBox(body: CameraBody): [number, number, number] {
  return body.size
}

/** 测光基准：默认挡位（ISO 基础感光、1/125、第三挡光圈）= 场景正常曝光。 */
export const METER_SHUTTER = 1 / 125
export function meterAperture(body: CameraBody): number | null {
  return body.aperture.length ? body.aperture[Math.min(2, body.aperture.length - 1)] : null
}

/** 这台机器表里最接近 1/125 的那一挡（1/120 之类），默认停在这里 = 0 档。 */
export function meterShutter(body: CameraBody): number {
  return nearest(body.shutter, Math.log2(METER_SHUTTER), value => Math.log2(value))
}

/**
 * 手动曝光相对测光基准差多少档（IDOK-182）：ISO 翻倍 +1，快门慢一倍 +1，光圈大一档（f 值 ÷√2）+1。
 * 跟真机一样三者互相抵消：ISO 加两档、快门快两档 = 亮度不变、噪点变多。
 */
export function meterStops(body: CameraBody, iso: number, shutter: number, aperture: number | null): number {
  const ref = meterAperture(body)
  const av = aperture && ref ? 2 * Math.log2(ref / aperture) : 0
  return Math.log2(iso / body.baseIso) + Math.log2(shutter / meterShutter(body)) + av
}

/** 超广角模式：等效焦距 ×0.7（16mm → 11mm），FOV 真的变宽。 */
export const WIDE_FACTOR = 0.7

/** 传感器面积（mm²）——噪声强度按它归一 */
export function sensorArea(body: CameraBody): number {
  return body.id === 'mirrorless' ? 36 * 24 : body.id === 'pocket' ? 13.2 * 8.8 : 6.17 * 4.55
}
