/**
 * 招牌合批图集绘制：一张 1024×768 贴图同时作底色和自发光图。
 * 浏览器里用 Canvas2D 按工艺逐格绘制（灯箱、亚克力、发光字、霓虹、LED 点阵、木牌、金属铭牌）；
 * Node 无 DOM 时生成同尺寸色块缓冲，只用来核显存预算。
 */

import * as THREE from 'three'
import { XXG_SIGN_ATLAS_H, XXG_SIGN_ATLAS_W, XXG_SIGN_FONTS, SIGN_ATLAS_RECTS, type AtlasRect } from './palette.ts'
import { XXG_SHOP_SIGNS, XXG_SIGN_PLAQUES, type XxgSignFace } from './shop-signs.ts'
import { configureDataTexture, fillPixelRect, type TextureUploadCache } from './textures.ts'

type Rgb = readonly [number, number, number]

interface PanelItem {
  readonly kind: 'panel'
  readonly rect: AtlasRect
  readonly face: XxgSignFace
  readonly cn: string
  readonly sub?: string
  readonly badge?: string
  readonly badgeStyle?: 'block' | 'corner'
  readonly pill: boolean
}

interface GlyphItem {
  readonly kind: 'blade' | 'round'
  readonly rect: AtlasRect
  readonly face: XxgSignFace
  readonly text: string
}

type SignItem = PanelItem | GlyphItem

function signItems(): SignItem[] {
  const items: SignItem[] = []
  for (const p of XXG_SIGN_PLAQUES) {
    items.push({ kind: 'panel', rect: SIGN_ATLAS_RECTS[p.slot], face: p.face, cn: p.cn, sub: p.sub, badge: p.badge, badgeStyle: 'block', pill: false })
  }
  for (const s of Object.values(XXG_SHOP_SIGNS)) {
    items.push({ kind: 'panel', rect: s.rect, face: s.face, cn: s.cn, sub: s.sub, badge: s.badge, badgeStyle: s.badgeStyle, pill: s.form === 'pill' })
    if (s.extra) items.push({ kind: s.extra.kind, rect: s.extra.rect, face: s.extra.face, text: s.extra.text })
  }
  return items
}

const rgba = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
]
const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

function fontFor(face: XxgSignFace, px: number): string {
  if (face.font === 'script') return `italic 700 ${px}px ${XXG_SIGN_FONTS.serif}`
  return `700 ${px}px ${XXG_SIGN_FONTS[face.font]}`
}

/** Largest font size ≤ maxPx at which `text` fits `maxW`. */
function fitPx(ctx: CanvasRenderingContext2D, face: XxgSignFace, text: string, maxW: number, maxPx: number): number {
  ctx.font = fontFor(face, maxPx)
  const w = ctx.measureText(text).width
  return w <= maxW ? maxPx : Math.max(6, Math.floor((maxPx * maxW) / w))
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function drawBackground(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, face: XxgSignFace, pill: boolean, seed: number): void {
  const { style, bg, accent } = face
  ctx.fillStyle = rgba(bg)
  ctx.fillRect(x, y, w, h)
  const inset = (d: number) => (pill ? roundRectPath(ctx, x + d, y + d, w - d * 2, h - d * 2, h / 2 - d) : roundRectPath(ctx, x + d, y + d, w - d * 2, h - d * 2, 0))
  let s = seed >>> 0
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
  switch (style) {
    case 'lightbox':
      ctx.strokeStyle = rgba(accent)
      ctx.lineWidth = 2
      inset(3)
      ctx.stroke()
      break
    case 'acrylic':
      ctx.fillStyle = rgba(accent, 0.9)
      if (pill) {
        ctx.lineWidth = 1.5
        ctx.strokeStyle = rgba(accent, 0.9)
        inset(3.5)
        ctx.stroke()
      } else {
        ctx.fillRect(x + 6, y + 3, w - 12, 1.5)
        ctx.fillRect(x + 6, y + h - 4.5, w - 12, 1.5)
      }
      break
    case 'channel':
      ctx.strokeStyle = rgba(accent, 0.7)
      ctx.lineWidth = 1
      inset(3)
      ctx.stroke()
      break
    case 'neon':
      ctx.save()
      ctx.shadowColor = rgba(accent)
      ctx.shadowBlur = 6
      ctx.strokeStyle = rgba(mix(accent, WHITE, 0.25))
      ctx.lineWidth = 1.6
      if (pill) inset(4)
      else roundRectPath(ctx, x + 4, y + 4, w - 8, h - 8, 6)
      ctx.stroke()
      ctx.restore()
      break
    case 'led':
      ctx.strokeStyle = rgba(accent)
      ctx.lineWidth = 2
      inset(1.5)
      ctx.stroke()
      break
    case 'wood': {
      const dark = mix(bg, BLACK, 0.45)
      const light = mix(bg, WHITE, 0.18)
      for (let i = 0; i < Math.max(8, h * 1.4); i++) {
        const gy = y + rnd() * h
        ctx.fillStyle = rgba(rnd() < 0.6 ? dark : light, 0.18 + rnd() * 0.22)
        const gx = x + rnd() * w * 0.4
        ctx.fillRect(gx, gy, w * (0.4 + rnd() * 0.6), 0.6 + rnd() * 0.8)
      }
      ctx.strokeStyle = rgba(accent)
      ctx.lineWidth = 3
      inset(1.5)
      ctx.stroke()
      break
    }
    case 'metal': {
      for (let yy = 0; yy < h; yy++) {
        const t = rnd()
        ctx.fillStyle = rgba(t < 0.5 ? WHITE : BLACK, 0.04 + Math.abs(t - 0.5) * 0.12)
        ctx.fillRect(x, y + yy, w, 1)
      }
      ctx.strokeStyle = rgba(accent)
      ctx.lineWidth = 1
      inset(1)
      ctx.stroke()
      if (!pill && w > 36 && h > 36) {
        ctx.fillStyle = rgba(mix(accent, BLACK, 0.3))
        for (const [sx, sy] of [[6, 6], [w - 6, 6], [6, h - 6], [w - 6, h - 6]] as const) {
          ctx.beginPath()
          ctx.arc(x + sx, y + sy, 2, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      break
    }
  }
}

/** Draws `text` centred on (cx, cy) in the face's lettering technique. */
function drawLetters(ctx: CanvasRenderingContext2D, face: XxgSignFace, text: string, cx: number, cy: number, px: number, maxW: number): void {
  const { style, ink, bg } = face
  ctx.font = fontFor(face, px)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  switch (style) {
    case 'channel':
      // Letter returns read as a darker offset under the lit face.
      ctx.fillStyle = rgba(mix(ink, BLACK, 0.55))
      ctx.fillText(text, cx + 0.8, cy + 0.9, maxW)
      ctx.save()
      ctx.shadowColor = rgba(ink, 0.8)
      ctx.shadowBlur = 5
      ctx.fillStyle = rgba(ink)
      ctx.fillText(text, cx, cy, maxW)
      ctx.restore()
      break
    case 'neon':
      ctx.save()
      ctx.shadowColor = rgba(ink)
      ctx.shadowBlur = 10
      ctx.fillStyle = rgba(ink)
      ctx.fillText(text, cx, cy, maxW)
      ctx.fillText(text, cx, cy, maxW)
      ctx.restore()
      ctx.strokeStyle = rgba(mix(ink, WHITE, 0.7))
      ctx.lineWidth = Math.max(0.5, px * 0.035)
      ctx.strokeText(text, cx, cy, maxW)
      break
    case 'wood':
      ctx.fillStyle = rgba(mix(bg, BLACK, 0.6), 0.6)
      ctx.fillText(text, cx + 0.8, cy + 0.8, maxW)
      ctx.fillStyle = rgba(ink)
      ctx.fillText(text, cx, cy, maxW)
      break
    case 'metal':
      ctx.fillStyle = rgba(WHITE, 0.35)
      ctx.fillText(text, cx + 0.7, cy + 0.7, maxW)
      ctx.fillStyle = rgba(ink)
      ctx.fillText(text, cx, cy, maxW)
      break
    default:
      ctx.fillStyle = rgba(ink)
      ctx.fillText(text, cx, cy, maxW)
  }
}

/** LED: mask the lit glyphs into a dot matrix by drawing the background colour as a fine grid over them. */
function ledMask(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bg: Rgb): void {
  ctx.fillStyle = rgba(bg)
  for (let gx = x + 3; gx < x + w - 3; gx += 2.4) ctx.fillRect(gx, y + 3, 0.9, h - 6)
  for (let gy = y + 3; gy < y + h - 3; gy += 2.4) ctx.fillRect(x + 3, gy, w - 6, 0.9)
}

function drawPanel(ctx: CanvasRenderingContext2D, item: PanelItem, x: number, y: number, w: number, h: number, seed: number): void {
  const { face } = item
  drawBackground(ctx, x, y, w, h, face, item.pill, seed)
  let left = x + (item.pill ? h * 0.45 : Math.max(5, h * 0.14))
  let right = x + w - (item.pill ? h * 0.45 : Math.max(5, h * 0.14))
  if (item.badge && item.badgeStyle === 'corner') {
    ctx.font = `700 ${Math.round(h * 0.2)}px ${XXG_SIGN_FONTS.sans}`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = rgba(face.ink)
    ctx.fillText(item.badge, x + w - 6, y + h - 4)
  } else if (item.badge) {
    const bs = h - 10
    const bw = Math.min(w * 0.3, bs * 1.25)
    ctx.fillStyle = rgba(face.accent)
    ctx.fillRect(left, y + 5, bw, bs)
    const bpx = fitPx(ctx, face, item.badge, bw - 4, Math.round(bs * 0.6))
    ctx.font = `800 ${bpx}px ${XXG_SIGN_FONTS.sans}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = rgba(face.bg)
    ctx.fillText(item.badge, left + bw / 2, y + h / 2)
    left += bw + 5
  }
  const cx = (left + right) / 2
  const maxW = right - left
  if (item.sub) {
    const mainPx = fitPx(ctx, face, item.cn, maxW, Math.round(h * 0.5))
    drawLetters(ctx, face, item.cn, cx, y + h * 0.4, mainPx, maxW)
    const subFace: XxgSignFace = { ...face, font: face.font === 'script' ? 'serif' : 'sans' }
    const subPx = fitPx(ctx, subFace, item.sub, maxW * 0.92, Math.max(7, Math.round(h * 0.19)))
    drawLetters(ctx, { ...subFace, style: face.style === 'neon' || face.style === 'channel' ? 'lightbox' : face.style }, item.sub, cx, y + h * 0.79, subPx, maxW)
  } else {
    drawLetters(ctx, face, item.cn, cx, y + h * 0.53, fitPx(ctx, face, item.cn, maxW, Math.round(h * 0.6)), maxW)
  }
  if (face.style === 'led') ledMask(ctx, x, y, w, h, face.bg)
}

function drawBlade(ctx: CanvasRenderingContext2D, item: GlyphItem, x: number, y: number, w: number, h: number, seed: number): void {
  const { face } = item
  drawBackground(ctx, x, y, w, h, face, false, seed)
  const chars = [...item.text]
  const step = (h - 14) / chars.length
  const px = Math.floor(Math.min(w - 12, step * 0.86))
  chars.forEach((ch, i) => drawLetters(ctx, face, ch, x + w / 2, y + 7 + step * (i + 0.5), px, w - 8))
  if (face.style === 'led') ledMask(ctx, x, y, w, h, face.bg)
}

function drawRound(ctx: CanvasRenderingContext2D, item: GlyphItem, x: number, y: number, w: number, h: number): void {
  const { face } = item
  const cx = x + w / 2
  const cy = y + h / 2
  const r = Math.min(w, h) / 2
  ctx.fillStyle = rgba(face.style === 'neon' || face.style === 'channel' ? face.bg : face.accent)
  ctx.fillRect(x, y, w, h)
  ctx.beginPath()
  ctx.arc(cx, cy, r - 5, 0, Math.PI * 2)
  ctx.fillStyle = rgba(face.bg)
  ctx.fill()
  ctx.strokeStyle = rgba(face.style === 'neon' || face.style === 'channel' ? face.accent : mix(face.accent, BLACK, 0.15))
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, r - 9, 0, Math.PI * 2)
  ctx.stroke()
  const chars = [...item.text]
  const px = Math.round((r - 12) * (chars.length > 1 ? 0.95 : 1.45))
  drawLetters(ctx, face, item.text, cx, cy + px * 0.04, px, (r - 12) * 1.8)
}

function drawSignAtlasCanvas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = XXG_SIGN_ATLAS_W
  canvas.height = XXG_SIGN_ATLAS_H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#1b1d22'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  signItems().forEach((item, i) => {
    const x = item.rect[0] * XXG_SIGN_ATLAS_W
    const y = item.rect[1] * XXG_SIGN_ATLAS_H
    const w = (item.rect[2] - item.rect[0]) * XXG_SIGN_ATLAS_W
    const h = (item.rect[3] - item.rect[1]) * XXG_SIGN_ATLAS_H
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    if (item.kind === 'panel') drawPanel(ctx, item, x, y, w, h, 0x51a7 + i * 977)
    else if (item.kind === 'blade') drawBlade(ctx, item, x, y, w, h, 0x7a11 + i * 613)
    else drawRound(ctx, item, x, y, w, h)
    ctx.restore()
  })
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

function drawSignAtlasNodeData(): THREE.DataTexture {
  const W = XXG_SIGN_ATLAS_W
  const H = XXG_SIGN_ATLAS_H
  const data = new Uint8Array(W * H * 4)
  fillPixelRect(data, W, H, 0, 0, W, H, [27, 29, 34, 255])
  for (const item of signItems()) {
    const x = item.rect[0] * W
    const y = item.rect[1] * H
    const w = (item.rect[2] - item.rect[0]) * W
    const h = (item.rect[3] - item.rect[1]) * H
    const { bg, ink } = item.face
    fillPixelRect(data, W, H, x, y, w, h, [bg[0], bg[1], bg[2], 255])
    fillPixelRect(data, W, H, x + w * 0.18, y + h * 0.34, w * 0.64, Math.max(3, h * 0.2), [ink[0], ink[1], ink[2], 255])
  }
  return configureDataTexture(data, W, H, 'albedo', false)
}

/** One atlas texture, used as both `map` and `emissiveMap` of the lit sign material and as `map` of the painted one. */
export function buildSignAtlasMap(cache: TextureUploadCache): THREE.Texture {
  let hasCanvas2D = false
  try {
    hasCanvas2D = typeof document !== 'undefined' && Boolean(document.createElement('canvas')?.getContext?.('2d'))
  } catch {
    hasCanvas2D = false
  }
  return cache.acquire({
    key: 'xxg:sign-atlas',
    width: XXG_SIGN_ATLAS_W,
    height: XXG_SIGN_ATLAS_H,
    kind: 'albedo',
    build: () => (hasCanvas2D ? drawSignAtlasCanvas() : drawSignAtlasNodeData()),
  })
}
