import type {CameraBody} from './cameras'
import {isoLabel, shutterLabel} from './cameras'

// 出片管线（IDOK-182）：曝光 / 白平衡 / ISO 噪点 / 数码变焦裁切 / 格式与 RAW 旁车。
//
// 全部是 2D canvas 上的后处理（场景本身已按焦距/广角调过相机 FOV），
// 好处是同一套参数在预览和成片里是同一段代码，不存在"所见非所得"。

export type ShotFormat = 'jpeg' | 'png' | 'webp'
export type GridMode = 'none' | 'thirds' | 'golden' | 'center' | 'grid'

export interface ShotSettings {
  exposure: number   // EV 补偿，单位档
  /** ISO/快门/光圈相对测光基准的档数（meterStops），成片亮度 = 2^(exposure + meter) */
  meter: number
  iso: number
  baseIso: number
  /** 传感器面积 mm²：小底高感更脏 */
  sensor: number
  shutter: number    // 秒
  aperture: number | null
  wb: number         // 色温 K
  zoom: number       // 数码变焦倍率（1 = 无裁切）
  macro: boolean
  grid: GridMode
  format: ShotFormat
  raw: boolean
  level: boolean
}

export interface ShotMeta {
  place: string
  hour: number
  weather: string
  width: number
  height: number
  bodyId: string
  bodyName: string
  lens: string
  when: string
}

/** 白平衡增益：以 5500K 为中性，暖端加红减蓝。 */
function wbGain(kelvin: number): [number, number, number] {
  const t = Math.max(2000, Math.min(12000, kelvin)) / 5500
  return [Math.pow(t, 0.42), 1, Math.pow(t, -0.5)]
}

/** 噪点强度（0–255 幅度）：基础感光几乎干净，每升一档 ×√2；底越小越脏（全画幅 1×，1/2.3" ≈ 2.8×）。 */
export function noiseAmount(iso: number, baseIso: number, sensorArea: number): number {
  const stops = Math.max(0, Math.log2(Math.max(iso, baseIso) / baseIso))
  const size = Math.sqrt(864 / Math.max(20, sensorArea))
  return Math.min(90, 0.6 * size * Math.pow(2, stops / 2))
}

/** 成片 / 取景的亮度倍率。 */
export function exposureGain(settings: Pick<ShotSettings, 'exposure' | 'meter'>): number {
  return Math.pow(2, Math.max(-8, Math.min(8, settings.exposure + settings.meter)))
}

/** 裁切窗口：数码变焦只在中心取 1/zoom。 */
export function cropRect(width: number, height: number, zoom: number) {
  const z = Math.max(1, Math.min(8, zoom))
  const w = Math.round(width / z)
  const h = Math.round(height / z)
  return {x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h}
}

/**
 * 把源画布处理成成片画布。
 * `filter` 是照片模式的滤镜 CSS 字符串（原片为空），在 drawImage 阶段一次套上。
 */
export function grade(source: CanvasImageSource & {width: number; height: number}, settings: ShotSettings, filter: string): HTMLCanvasElement {
  const {x, y, w, h} = cropRect(source.width, source.height, settings.zoom)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d', {willReadFrequently: true})
  if (!ctx) return out
  ctx.imageSmoothingQuality = 'high'
  if (filter) ctx.filter = filter
  ctx.drawImage(source, x, y, w, h, 0, 0, w, h)
  ctx.filter = 'none'

  const gain = exposureGain(settings)
  const [gr, gg, gb] = wbGain(settings.wb)
  const noise = noiseAmount(settings.iso, settings.baseIso, settings.sensor)
  const image = ctx.getImageData(0, 0, w, h)
  const data = image.data
  // 噪点用确定性序列（同一张照片重复处理结果一致，测试也好断言）。
  let seed = 0x9e3779b9
  const random = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return ((seed >>> 0) / 0xffffffff) * 2 - 1
  }
  const vignette = settings.macro ? 0.16 : 0
  const cx = w / 2
  const cy = h / 2
  const maxR = Math.hypot(cx, cy)
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    let r = data[i] * gain * gr
    let g = data[i + 1] * gain * gg
    let b = data[i + 2] * gain * gb
    if (noise > 0) {
      // 三个通道共用一份亮度噪点 + 各自一点色噪，像真机的高感。
      const lum = random() * noise
      r += lum + random() * noise * 0.35
      g += lum + random() * noise * 0.35
      b += lum + random() * noise * 0.35
    }
    if (vignette > 0) {
      const dx = (p % w) - cx
      const dy = Math.floor(p / w) - cy
      const falloff = 1 - vignette * Math.pow(Math.hypot(dx, dy) / maxR, 2.2)
      r *= falloff
      g *= falloff
      b *= falloff
    }
    data[i] = r > 255 ? 255 : r < 0 ? 0 : r
    data[i + 1] = g > 255 ? 255 : g < 0 ? 0 : g
    data[i + 2] = b > 255 ? 255 : b < 0 ? 0 : b
  }
  ctx.putImageData(image, 0, 0)
  return out
}

/** 取景辅助线（画在成片上；水平仪不画进照片，只在预览里）。 */
export function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, grid: GridMode, color = 'rgba(255,255,255,.42)') {
  if (grid === 'none') return
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, Math.round(Math.min(width, height) / 900))
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  if (grid === 'thirds' || grid === 'grid') {
    for (let i = 1; i < 3; i += 1) {
      line((width * i) / 3, 0, (width * i) / 3, height)
      line(0, (height * i) / 3, width, (height * i) / 3)
    }
  }
  if (grid === 'grid') {
    for (let i = 1; i < 6; i += 1) {
      line((width * i) / 6, 0, (width * i) / 6, height)
      line(0, (height * i) / 6, width, (height * i) / 6)
    }
  }
  if (grid === 'golden') {
    // 黄金分割：38.2% / 61.8% 加对角线
    for (const f of [0.382, 0.618]) {
      line(width * f, 0, width * f, height)
      line(0, height * f, width, height * f)
    }
    line(0, 0, width, height)
    line(width, 0, 0, height)
  }
  if (grid === 'center') {
    line(width / 2, height * 0.36, width / 2, height * 0.64)
    line(width * 0.4, height / 2, width * 0.6, height / 2)
    ctx.beginPath()
    ctx.arc(width / 2, height / 2, Math.min(width, height) * 0.12, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

export function mimeFor(format: ShotFormat): string {
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  return 'image/jpeg'
}

export function extensionFor(format: ShotFormat): string {
  return format === 'jpeg' ? 'jpg' : format
}

export function encode(canvas: HTMLCanvasElement, format: ShotFormat, quality = 0.92): Promise<Blob> {
  const mime = mimeFor(format)
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(Error(`encode failed: ${mime}`))), mime, format === 'png' ? undefined : quality)
  })
}

/** RAW 旁车：参数 + 机位信息，命名同主文件。真·RAW 需要传感器原始数据，网页里只能给"无损 + 全参数"。 */
export function rawSidecar(settings: ShotSettings, body: CameraBody, meta: ShotMeta): Blob {
  const payload = {
    schema: 'glol.raw/1',
    camera: {id: body.id, name: body.name, sensor: body.sensor, lens: meta.lens},
    exposure: {
      ev: settings.exposure,
      meterStops: Math.round(settings.meter * 100) / 100,
      iso: isoLabel(settings.iso),
      shutter: shutterLabel(settings.shutter),
      aperture: settings.aperture ? `f/${settings.aperture}` : null,
      whiteBalance: settings.wb,
      focal: meta.lens,
      zoom: settings.zoom,
      macro: settings.macro,
    },
    frame: {width: meta.width, height: meta.height, format: settings.format},
    scene: {place: meta.place, hour: meta.hour, weather: meta.weather},
    when: meta.when,
    note: '网页端 RAW：无损画布 + 全参数旁车，可在 Lightroom 里按这些数值复现调色。',
  }
  return new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'})
}

export function stamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
