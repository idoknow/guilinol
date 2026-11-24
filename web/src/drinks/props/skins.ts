import * as THREE from 'three'
import type { DrinkSpec } from './catalog.ts'

/**
 * 饮品杯套/涂装皮肤配置接口
 *
 * 与 3D 几何体解耦：仓库内只提交桂林本土原创默认皮肤；
 * 外部皮肤包可通过 DrinkSkinConfig 注入贴花配色、图案与贴图，不携带真实商业商标。
 */
export interface DrinkSkinConfig {
  readonly id: string
  readonly brandLabel: string
  readonly subLabel: string
  readonly primaryHex: string
  readonly secondaryHex: string
  readonly creamHex: string
  readonly goldHex: string
  readonly cupTintHex: string
  readonly sealFilmHex: string
  readonly emblemKind: 'crown_spark' | 'wave_ribbon' | 'minimal_badge'
  readonly sleeveTextureFactory?: (spec: DrinkSpec, skin: DrinkSkinConfig) => THREE.Texture | null
}

export const DEFAULT_DRINK_SKIN: DrinkSkinConfig = {
  id: 'guilin_frost_original',
  brandLabel: '桂林冰饮',
  subLabel: 'SNOW FROST',
  primaryHex: '#d9252e',
  secondaryHex: '#b31822',
  creamHex: '#fff7ee',
  goldHex: '#f6c33e',
  cupTintHex: '#f8fcff',
  sealFilmHex: '#d9252e',
  emblemKind: 'crown_spark',
}

export function resolveDrinkSkin(override?: Partial<DrinkSkinConfig>): DrinkSkinConfig {
  if (!override) return DEFAULT_DRINK_SKIN
  return {
    ...DEFAULT_DRINK_SKIN,
    ...override,
  }
}

export function createCupSleeveTexture(spec: DrinkSpec, skin: DrinkSkinConfig): THREE.Texture | null {
  if (skin.sleeveTextureFactory) {
    return skin.sleeveTextureFactory(spec, skin)
  }
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 384
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const themeBase =
    spec.sleeveTheme === 'coffee'
      ? '#2b1e18'
      : spec.sleeveTheme === 'hot_kraft'
        ? '#b88456'
        : spec.sleeveTheme === 'jasmine_jade'
          ? '#4b8259'
          : skin.primaryHex
  const themeTrim =
    spec.sleeveTheme === 'coffee'
      ? '#d8a556'
      : spec.sleeveTheme === 'hot_kraft'
        ? '#fff3e2'
        : spec.sleeveTheme === 'jasmine_jade'
          ? '#edf7e4'
          : skin.creamHex

  ctx.save()
  ctx.scale(2, 2)
  const logicalW = 512
  const logicalH = 192

  ctx.fillStyle = themeBase
  ctx.fillRect(0, 0, logicalW, logicalH)

  // 防烫瓦楞竖向明暗条纹（热饮风味专用）
  if (spec.sleeveTheme === 'hot_kraft') {
    for (let x = 0; x < logicalW; x += 16) {
      ctx.fillStyle = x % 32 === 0 ? 'rgba(74, 33, 13, 0.22)' : 'rgba(255, 245, 228, 0.14)'
      ctx.fillRect(x, 0, 8, logicalH)
    }
  }

  // 顶部与底部明晰几何双边条纹（远近景均锐利无糊字）
  ctx.fillStyle = themeTrim
  ctx.fillRect(0, 0, logicalW, 18)
  ctx.fillRect(0, logicalH - 18, logicalW, 18)

  ctx.fillStyle = skin.goldHex
  ctx.fillRect(0, 18, logicalW, 9)
  ctx.fillRect(0, logicalH - 27, logicalW, 9)

  // 中段斜向饰纹
  if (spec.sleeveTheme !== 'hot_kraft') {
    ctx.fillStyle = 'rgba(255, 247, 238, 0.14)'
    for (let x = -40; x < logicalW + 60; x += 48) {
      ctx.beginPath()
      ctx.moveTo(x, 30)
      ctx.lineTo(x + 22, 30)
      ctx.lineTo(x - 10, logicalH - 30)
      ctx.lineTo(x - 32, logicalH - 30)
      ctx.closePath()
      ctx.fill()
    }
  }

  // 正反两面居中大号几何徽章
  for (const cx of [128, 384]) {
    ctx.save()
    ctx.translate(cx, logicalH * 0.5)

    ctx.beginPath()
    ctx.arc(0, 0, 44, 0, Math.PI * 2)
    ctx.fillStyle = skin.creamHex
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = skin.goldHex
    ctx.stroke()

    ctx.fillStyle = themeBase
    if (skin.emblemKind === 'crown_spark') {
      ctx.beginPath()
      ctx.moveTo(-22, 16)
      ctx.lineTo(-24, -12)
      ctx.lineTo(-9, -1)
      ctx.lineTo(0, -21)
      ctx.lineTo(9, -1)
      ctx.lineTo(24, -12)
      ctx.lineTo(22, 16)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = skin.goldHex
      ctx.fillRect(-19, 18, 38, 6)
    } else if (skin.emblemKind === 'wave_ribbon') {
      ctx.strokeStyle = themeBase
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.moveTo(-24, 5)
      ctx.quadraticCurveTo(-8, -14, 0, 0)
      ctx.quadraticCurveTo(8, 14, 24, -5)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(0, 0, 17, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
  }
  ctx.restore()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.wrapS = THREE.RepeatWrapping
  tex.needsUpdate = true
  return tex
}

export function createCaramelSwirlTexture(baseHex: string, streakHex: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 192
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = baseHex
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = streakHex
  for (let i = 0; i < 11; i++) {
    const x = (i + 0.35) * (canvas.width / 11)
    const drop = 56 + ((i * 37) % 88)
    ctx.beginPath()
    ctx.moveTo(x - 10, 0)
    ctx.quadraticCurveTo(x - 4, drop * 0.55, x - 6, drop)
    ctx.quadraticCurveTo(x, drop + 18, x + 7, drop)
    ctx.quadraticCurveTo(x + 6, drop * 0.5, x + 11, 0)
    ctx.closePath()
    ctx.fill()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.wrapS = THREE.RepeatWrapping
  tex.needsUpdate = true
  return tex
}

/** 生成热敏打单贴纸纹理（仅供贴杯标设备与成品标贴使用，零真实商标） */
export function createThermalOrderLabelTexture(code = '#A08', title = '鲜饮现制'): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 144
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#fffaf0'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#d9252e'
  ctx.fillRect(0, 0, canvas.width, 28)

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 18px sans-serif'
  ctx.fillText(code, 14, 21)

  ctx.fillStyle = '#1b1d22'
  ctx.font = 'bold 26px sans-serif'
  ctx.fillText(title, 16, 70)

  // 条形码黑竖线块
  ctx.fillStyle = '#20242a'
  for (let i = 0; i < 18; i++) {
    const w = i % 3 === 0 ? 6 : 3
    ctx.fillRect(16 + i * 12, 92, w, 34)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}
