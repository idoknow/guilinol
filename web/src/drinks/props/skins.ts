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

  ctx.save()
  ctx.scale(2, 2)
  const logicalW = 512
  const logicalH = 192

  ctx.fillStyle = skin.primaryHex
  ctx.fillRect(0, 0, logicalW, logicalH)

  // 顶部与底部奶油白 + 明金醒目几何双边条纹（远离缩微杂点与糊字，保证远近景都利落清晰）
  ctx.fillStyle = skin.creamHex
  ctx.fillRect(0, 0, logicalW, 18)
  ctx.fillRect(0, logicalH - 18, logicalW, 18)

  ctx.fillStyle = skin.goldHex
  ctx.fillRect(0, 18, logicalW, 9)
  ctx.fillRect(0, logicalH - 27, logicalW, 9)

  // 中段斜向动感饰纹
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

  // 在正反两面居中绘制高清大号几何皇冠徽章（无易糊小字）
  for (const cx of [128, 384]) {
    ctx.save()
    ctx.translate(cx, logicalH * 0.5)

    // 圆形/徽章暖白底盘
    ctx.beginPath()
    ctx.arc(0, 0, 44, 0, Math.PI * 2)
    ctx.fillStyle = skin.creamHex
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = skin.goldHex
    ctx.stroke()

    if (skin.emblemKind === 'crown_spark') {
      // 原创三齿小皇冠几何标志
      ctx.fillStyle = skin.primaryHex
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
      ctx.strokeStyle = skin.primaryHex
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.moveTo(-24, 5)
      ctx.quadraticCurveTo(-8, -14, 0, 0)
      ctx.quadraticCurveTo(8, 14, 24, -5)
      ctx.stroke()
    } else {
      ctx.fillStyle = skin.primaryHex
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

  // 黑糖虎纹挂壁流动感条纹
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
  tex.wrapS = THREE.RepeatWrapping
  tex.needsUpdate = true
  return tex
}
