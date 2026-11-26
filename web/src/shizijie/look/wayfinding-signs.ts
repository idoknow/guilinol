/**
 * 桂林十字街地下街 B1 天花板悬挂导视牌：数据驱动 1:1 像素密度图集与灯箱几何工厂。
 *
 * 对标真实地下通道（BV1b8411r7EP 第 3 行第 3 帧 & idok-385-method.md）：
 * - 唯一文字数据源：`../wayfinding/index.ts`（SzjWayfinding：4 个出口名称 + 8 方向箭头 + 动态最短路距离 + 掉头标）。
 * - 1:1 像素密度：1024×512 高清导视图集（箭头行高 104px ↔ 基准 0.26m，400 px/m 正方像素），
 *   独立横宽深红英文代码徽章（120×76 [NW]/[NE]/[SE]/[SW]）+ 加粗全幅几何箭头（84×104 无斜向缩小退化）
 *   + 防泛白 700 黑体中文（248×96）+ 宽距开腔金字数字（73×72），双列窄牌自动切二层堆叠卡片，
 *   确保 2.3m 挂高 10m 距离中文、英文出口标、箭头与距离全部清晰可读。
 */

import * as THREE from 'three'
import type { SzjStairId } from '../contract.ts'
import {
  SZJ_ARROW_DEG,
  SZJ_EXIT_NAMES,
  SZJ_SIGN_SPEC,
  type SzjArrow,
  type SzjHangingSign,
  type SzjSignFace,
  type SzjWayfinding,
} from '../wayfinding/index.ts'
import { SHIZIJIE_SIGN_FONTS, SHIZIJIE_WAYFINDING_PALETTE, type AtlasRect } from './palette.ts'
import type { TextureUploadCache } from './textures.ts'

export const WAYFINDING_ATLAS_WIDTH = 1024 as const
export const WAYFINDING_ATLAS_HEIGHT = 512 as const
export const WAYFINDING_ROW_PX = 104 as const
/** 基准物理行高（0.26m）：配合 104px 箭头与 96px 出口大字，400 px/m 严守 1:1 像素 */
export const WAYFINDING_NOMINAL_ROW_M = 0.26 as const
/** 104 px / 0.26 m = 400 px/m，保证长宽严格 1:1 等比例正方 Texel */
export const WAYFINDING_TEXELS_PER_METER = WAYFINDING_ROW_PX / WAYFINDING_NOMINAL_ROW_M

const ARROWS_ORDER: readonly SzjArrow[] = [
  'straight',
  'slight-right',
  'right',
  'sharp-right',
  'slight-left',
  'left',
  'sharp-left',
  'back',
]

export interface WayfindingExitLabelSpec {
  readonly stairId: SzjStairId
  readonly code: string
  readonly name: string
  readonly en: string
}

export interface SzjWayfindingAtlasLayout {
  readonly width: number
  readonly height: number
  readonly texelsPerMeter: number
  readonly panelRect: AtlasRect
  readonly bezelRect: AtlasRect
  readonly turnBackRect: AtlasRect
  readonly exits: Readonly<Record<SzjStairId, AtlasRect>>
  readonly exitBadges: Readonly<Record<SzjStairId, AtlasRect>>
  readonly arrows: Readonly<Record<SzjArrow, AtlasRect>>
  readonly distances: ReadonlyMap<number, AtlasRect>
  readonly distanceKeysSorted: readonly number[]
  readonly exitSpecs: Readonly<Record<SzjStairId, WayfindingExitLabelSpec>>
}

export interface SzjWayfindingAtlasResult {
  readonly map: THREE.Texture
  readonly layout: SzjWayfindingAtlasLayout
}

export interface SzjWayfindingSignsBatch {
  readonly group: THREE.Group
  readonly faceMesh: THREE.Mesh
  readonly boxMesh: THREE.InstancedMesh
  readonly rodMesh: THREE.InstancedMesh
  readonly drawCalls: number
  readonly triangles: number
  readonly signCount: number
  dispose(): void
}

function toRect(px0: number, py0: number, px1: number, py1: number): AtlasRect {
  return [
    px0 / WAYFINDING_ATLAS_WIDTH,
    py0 / WAYFINDING_ATLAS_HEIGHT,
    px1 / WAYFINDING_ATLAS_WIDTH,
    py1 / WAYFINDING_ATLAS_HEIGHT,
  ] as const
}

function extractExitSpecs(wf: SzjWayfinding): Record<SzjStairId, WayfindingExitLabelSpec> {
  const out: Record<SzjStairId, WayfindingExitLabelSpec> = {
    nw: { stairId: 'nw', ...SZJ_EXIT_NAMES.nw },
    ne: { stairId: 'ne', ...SZJ_EXIT_NAMES.ne },
    se: { stairId: 'se', ...SZJ_EXIT_NAMES.se },
    sw: { stairId: 'sw', ...SZJ_EXIT_NAMES.sw },
  }
  for (const sign of wf.signs) {
    for (const face of sign.faces) {
      for (const row of face.rows) {
        out[row.stairId] = {
          stairId: row.stairId,
          code: row.code,
          name: row.name,
          en: row.en,
        }
      }
    }
  }
  return out
}

const MAX_DISTANCE_SLOTS = 44
const EXIT_SLOT_W = 248
const EXIT_SLOT_H = 96
const BADGE_SLOT_W = 120
const BADGE_SLOT_H = 76
const ARROW_SLOT_W = 84
const ARROW_SLOT_H = 104
const DIST_SLOT_W = 85
const DIST_SLOT_H = 54
const TURNBACK_SLOT_W = 152

function extractDistances(wf: SzjWayfinding): number[] {
  const set = new Set<number>()
  for (const sign of wf.signs) {
    for (const face of sign.faces) {
      for (const row of face.rows) {
        set.add(row.shownM)
      }
    }
  }
  for (let d = SZJ_SIGN_SPEC.distanceRoundM; set.size < MAX_DISTANCE_SLOTS && d <= 225; d += SZJ_SIGN_SPEC.distanceRoundM) {
    set.add(d)
  }
  return [...set].sort((a, b) => a - b).slice(0, MAX_DISTANCE_SLOTS)
}

/** 根据 wayfinding 生成严格 1:1 槽位布局（1024×512：独立中文牌、宽幅横红章、厚重方框箭头与零压窄宽距数字）。 */
export function computeWayfindingAtlasLayout(wf: SzjWayfinding): SzjWayfindingAtlasLayout {
  const exitSpecs = extractExitSpecs(wf)
  const distanceKeysSorted = extractDistances(wf)

  // Band 0 (y = 0..96): nw(248) + ne(248) + badge_nw(120) + badge_ne(120) + turnBack(152) + panel(68) + bezel(68) = 1024
  // Band 1 (y = 96..192): se(248) + sw(248) + badge_se(120) + badge_sw(120) + dark reserve(288) = 1024
  const exits: Record<SzjStairId, AtlasRect> = {
    nw: toRect(0, 0, EXIT_SLOT_W, EXIT_SLOT_H),
    ne: toRect(EXIT_SLOT_W, 0, EXIT_SLOT_W * 2, EXIT_SLOT_H),
    se: toRect(0, EXIT_SLOT_H, EXIT_SLOT_W, EXIT_SLOT_H * 2),
    sw: toRect(EXIT_SLOT_W, EXIT_SLOT_H, EXIT_SLOT_W * 2, EXIT_SLOT_H * 2),
  }

  const exitBadges: Record<SzjStairId, AtlasRect> = {
    nw: toRect(496, 0, 496 + BADGE_SLOT_W, BADGE_SLOT_H),
    ne: toRect(616, 0, 616 + BADGE_SLOT_W, BADGE_SLOT_H),
    se: toRect(496, EXIT_SLOT_H, 496 + BADGE_SLOT_W, EXIT_SLOT_H + BADGE_SLOT_H),
    sw: toRect(616, EXIT_SLOT_H, 616 + BADGE_SLOT_W, EXIT_SLOT_H + BADGE_SLOT_H),
  }

  const turnBackRect = toRect(736, 0, 736 + TURNBACK_SLOT_W, EXIT_SLOT_H)
  const panelRect = toRect(888, 0, 956, EXIT_SLOT_H)
  const bezelRect = toRect(956, 0, 1024, EXIT_SLOT_H)

  // Band 2 (y = 192..296): 8 arrows × (84×104 px) = 672px + dark reserve
  const arrows = {} as Record<SzjArrow, AtlasRect>
  for (let i = 0; i < ARROWS_ORDER.length; i++) {
    const x0 = i * ARROW_SLOT_W
    arrows[ARROWS_ORDER[i]!] = toRect(x0, 192, x0 + ARROW_SLOT_W, 192 + ARROW_SLOT_H)
  }

  // Band 3 (y = 296..512): 4 sub-rows × 12 cols × (85×54 px) = 48 capacity (44 slots, un-squished digits)
  const distances = new Map<number, AtlasRect>()
  let cursor = 0
  for (let r = 0; r < 4 && cursor < distanceKeysSorted.length; r++) {
    const y0 = 296 + r * DIST_SLOT_H
    const y1 = y0 + DIST_SLOT_H
    for (let col = 0; col < 12 && cursor < distanceKeysSorted.length; col++, cursor++) {
      const x0 = col * DIST_SLOT_W
      distances.set(distanceKeysSorted[cursor]!, toRect(x0, y0, x0 + DIST_SLOT_W, y1))
    }
  }

  return {
    width: WAYFINDING_ATLAS_WIDTH,
    height: WAYFINDING_ATLAS_HEIGHT,
    texelsPerMeter: WAYFINDING_TEXELS_PER_METER,
    panelRect,
    bezelRect,
    turnBackRect,
    exits,
    exitBadges,
    arrows,
    distances,
    distanceKeysSorted,
    exitSpecs,
  }
}

function drawVectorArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, arrow: SzjArrow, color: string): void {
  const rad = (SZJ_ARROW_DEG[arrow] * Math.PI) / 180
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(rad)
  // 84×104 方槽全尺度厚重矢量箭头（24px 粗杆，绝不缩小斜向箭头），杜绝 10m 处 ↖ 退化噪点
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, -35)
  ctx.lineTo(30, -2)
  ctx.lineTo(12, -2)
  ctx.lineTo(12, 35)
  ctx.lineTo(-12, 35)
  ctx.lineTo(-12, -2)
  ctx.lineTo(-30, -2)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawRoundedPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

function drawWayfindingAtlasCanvas(layout: SzjWayfindingAtlasLayout): HTMLCanvasElement {
  const { width: w, height: h } = layout
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const wp = SHIZIJIE_WAYFINDING_PALETTE

  ctx.fillStyle = wp.housingBgHex
  ctx.fillRect(0, 0, w, h)

  const pxRect = (r: AtlasRect) => ({
    x: Math.round(r[0] * w),
    y: Math.round(r[1] * h),
    rw: Math.round((r[2] - r[0]) * w),
    rh: Math.round((r[3] - r[1]) * h),
  })

  // 1. Brushed anodized aluminum bezel strip & solid dark charcoal housing panel tile
  const bezel = pxRect(layout.bezelRect)
  const grad = ctx.createLinearGradient(0, bezel.y, 0, bezel.y + bezel.rh)
  grad.addColorStop(0, wp.metalHighlightHex)
  grad.addColorStop(0.5, wp.metalBezelHex)
  grad.addColorStop(1, '#3b424d')
  ctx.fillStyle = grad
  ctx.fillRect(bezel.x, bezel.y, bezel.rw, bezel.rh)
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  for (let y = bezel.y + 4; y < bezel.y + bezel.rh; y += 6) {
    ctx.fillRect(bezel.x, y, bezel.rw, 1)
  }

  const panel = pxRect(layout.panelRect)
  ctx.fillStyle = wp.housingBgHex
  ctx.fillRect(panel.x, panel.y, panel.rw, panel.rh)
  ctx.strokeStyle = '#273140'
  ctx.lineWidth = 1
  ctx.strokeRect(panel.x + 1.5, panel.y + 1.5, panel.rw - 3, panel.rh - 3)

  // 2. Turn-back tag (掉头, 152×96 px)
  const backBox = pxRect(layout.turnBackRect)
  ctx.fillStyle = wp.housingBgHex
  ctx.fillRect(backBox.x, backBox.y, backBox.rw, backBox.rh)
  drawRoundedPill(ctx, backBox.x + 10, backBox.y + 14, backBox.rw - 20, backBox.rh - 28, 10, wp.turnBackBgHex)
  ctx.fillStyle = wp.turnBackFgHex
  ctx.font = `700 42px ${SHIZIJIE_SIGN_FONTS.sans}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('掉头', backBox.x + backBox.rw / 2, backBox.y + backBox.rh / 2 + 2, backBox.rw - 28)

  // 3a. 4 Pure Chinese Landmark Slots (248×96: open-counter 700 bold, no blobbing on 厦/解)
  for (const id of ['nw', 'ne', 'se', 'sw'] as const) {
    const spec = layout.exitSpecs[id]
    const b = pxRect(layout.exits[id])
    ctx.fillStyle = wp.housingBgHex
    ctx.fillRect(b.x, b.y, b.rw, b.rh)

    ctx.save()
    ctx.fillStyle = wp.exitZhHex
    ctx.font = `700 72px ${SHIZIJIE_SIGN_FONTS.sans}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const availW = b.rw - 20
    const naturalW = Math.max(1, ctx.measureText(spec.name).width)
    const sx = Math.min(1, availW / naturalW)
    ctx.translate(b.x + b.rw / 2, b.y + b.rh / 2 + 2)
    ctx.scale(sx, 1)
    ctx.fillText(spec.name, 0, 0)
    ctx.restore()

    // 3b. Wide Horizontal Crimson Exit Code Badges (120×76: rounded stroke border, zero corner double-line)
    const cb = pxRect(layout.exitBadges[id])
    ctx.fillStyle = wp.housingBgHex
    ctx.fillRect(cb.x, cb.y, cb.rw, cb.rh)
    drawRoundedPill(ctx, cb.x + 4, cb.y + 4, cb.rw - 8, cb.rh - 8, 9, wp.exitBadgeBgHex)
    ctx.strokeStyle = '#6f180c'
    ctx.lineWidth = 2
    ctx.stroke()

    const letters = [...spec.code]
    ctx.fillStyle = wp.exitBadgeFgHex
    ctx.font = `800 48px "Helvetica Neue",${SHIZIJIE_SIGN_FONTS.sans}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const widths = letters.map(ch => ctx.measureText(ch).width + 5)
    const codeSpan = widths.reduce((a, v) => a + v, 0) - 5
    const codeFit = Math.min(1, (cb.rw - 22) / Math.max(1, codeSpan))
    ctx.save()
    ctx.translate(cb.x + cb.rw / 2, cb.y + cb.rh / 2 + 2)
    ctx.scale(codeFit, 1)
    let cx = -codeSpan / 2
    for (let k = 0; k < letters.length; k++) {
      const wCh = ctx.measureText(letters[k]!).width
      ctx.fillText(letters[k]!, cx + wCh / 2, 0)
      cx += wCh + 5
    }
    ctx.restore()
  }

  // 4. 8 Full-Size Bold Geometric Arrows (84×104 px each)
  for (const arrow of ARROWS_ORDER) {
    const b = pxRect(layout.arrows[arrow])
    ctx.fillStyle = wp.housingBgHex
    ctx.fillRect(b.x, b.y, b.rw, b.rh)
    drawVectorArrow(ctx, b.x + b.rw / 2, b.y + b.rh / 2, arrow, wp.arrowHex)
  }

  // 5. Wide Un-Squished Distances (85×54 px: natural width fitScale=1.0 on 5..95m, open 0 cavity)
  for (const distM of layout.distanceKeysSorted) {
    const r = layout.distances.get(distM)
    if (!r) continue
    const b = pxRect(r)
    ctx.fillStyle = wp.housingBgHex
    ctx.fillRect(b.x, b.y, b.rw, b.rh)
    ctx.fillStyle = wp.distanceHex
    const label = `${distM}m`
    const isLong = label.length >= 4
    const pxSize = isLong ? 32 : 36
    ctx.font = `700 ${pxSize}px "Helvetica Neue",${SHIZIJIE_SIGN_FONTS.sans}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const kerning = isLong ? 1.5 : 2.5
    const chars = [...label]
    const adv = chars.map(ch => ctx.measureText(ch).width + (ch === 'm' ? 0 : kerning))
    const totalW = adv.reduce((a, v) => a + v, 0)
    const fitScale = Math.min(1, (b.rw - 10) / Math.max(1, totalW))
    ctx.save()
    ctx.translate(b.x + b.rw / 2, b.y + b.rh / 2 + 1)
    ctx.scale(fitScale, 1)
    let cx = -totalW / 2
    for (let k = 0; k < chars.length; k++) {
      ctx.fillText(chars[k]!, cx + adv[k]! / 2, 0)
      cx += adv[k]!
    }
    ctx.restore()
  }

  return canvas
}

function drawWayfindingAtlasNodeData(layout: SzjWayfindingAtlasLayout): THREE.DataTexture {
  const { width: w, height: h } = layout
  const data = new Uint8Array(w * h * 4)
  // Base backlit slate-charcoal #1b2430 = [27, 36, 48]
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 27
    data[i + 1] = 36
    data[i + 2] = 48
    data[i + 3] = 255
  }

  const paintRect = (r: AtlasRect, rgb: readonly [number, number, number], inset = 2) => {
    const x0 = Math.max(0, Math.round(r[0] * w) + inset)
    const x1 = Math.min(w, Math.round(r[2] * w) - inset)
    const y0 = Math.max(0, Math.round(r[1] * h) + inset)
    const y1 = Math.min(h, Math.round(r[3] * h) - inset)
    for (let y = y0; y < y1; y++) {
      const fy = h - 1 - y
      for (let x = x0; x < x1; x++) {
        const p = (fy * w + x) * 4
        data[p] = rgb[0]
        data[p + 1] = rgb[1]
        data[p + 2] = rgb[2]
        data[p + 3] = 255
      }
    }
  }

  paintRect(layout.bezelRect, [104, 115, 130], 0)
  for (const id of ['nw', 'ne', 'se', 'sw'] as const) {
    paintRect(layout.exits[id], [237, 242, 247], 8)
    paintRect(layout.exitBadges[id], [164, 38, 22], 4)
  }
  for (const a of ARROWS_ORDER) {
    paintRect(layout.arrows[a], [238, 243, 248], 12)
  }
  for (const d of layout.distanceKeysSorted) {
    const r = layout.distances.get(d)
    if (r) paintRect(r, [244, 206, 106], 9)
  }
  paintRect(layout.turnBackRect, [198, 120, 24], 10)

  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.flipY = true
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = 8
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

/** 创建数据驱动天花板导视图集（1:1 像素密度，零重复 GPU 上传缓存）。 */
export function buildWayfindingSignAtlas(
  wf: SzjWayfinding,
  cache: TextureUploadCache,
): SzjWayfindingAtlasResult {
  const layout = computeWayfindingAtlasLayout(wf)
  const keyHash = `${layout.distanceKeysSorted.join(',')}|${Object.values(layout.exitSpecs)
    .map(e => `${e.code}:${e.name}`)
    .join(';')}`

  const map = cache.acquire({
    key: `szj:atlas-wayfinding:albedo:${keyHash}`,
    width: WAYFINDING_ATLAS_WIDTH,
    height: WAYFINDING_ATLAS_HEIGHT,
    kind: 'albedo',
    isAtlas: true,
    build() {
      if (typeof document !== 'undefined') {
        const tex = new THREE.CanvasTexture(drawWayfindingAtlasCanvas(layout))
        tex.colorSpace = THREE.SRGBColorSpace
        tex.generateMipmaps = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.anisotropy = 8
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
        tex.needsUpdate = true
        return tex
      }
      return drawWayfindingAtlasNodeData(layout)
    },
  })

  return { map, layout }
}

function pushTexturedQuad(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  cx: number,
  cy: number,
  z: number,
  w: number,
  h: number,
  rect: AtlasRect,
  padPx = 1.5,
): void {
  const uPad = padPx / WAYFINDING_ATLAS_WIDTH
  const vPad = padPx / WAYFINDING_ATLAS_HEIGHT
  const u0 = rect[0] + uPad
  const u1 = rect[2] - uPad
  const v0 = 1 - (rect[3] - vPad)
  const v1 = 1 - (rect[1] + vPad)

  const x0 = cx - w * 0.5
  const x1 = cx + w * 0.5
  const y0 = cy - h * 0.5
  const y1 = cy + h * 0.5
  const base = positions.length / 3

  positions.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z)
  normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1)
  uvs.push(u0, v0, u1, v0, u1, v1, u0, v1)
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

function findNearestDistanceRect(layout: SzjWayfindingAtlasLayout, shownM: number): AtlasRect {
  const exact = layout.distances.get(shownM)
  if (exact) return exact
  let bestKey = layout.distanceKeysSorted[0] ?? 5
  let bestDiff = Infinity
  for (const k of layout.distanceKeysSorted) {
    const diff = Math.abs(k - shownM)
    if (diff < bestDiff) {
      bestDiff = diff
      bestKey = k
    }
  }
  return layout.distances.get(bestKey) ?? layout.panelRect
}

/**
 * 为单块吊牌单面构造合并几何体（默认法线朝 +Z，设 rotation.y = face.yaw 即正对行进方向）。
 * 1 行满宽大字居中；2–4 行自适应 2 列并排/网格大字排布，严格保持 1:1 正方 Texel。
 */
export function buildWayfindingFaceGeometry(
  face: SzjSignFace,
  signWidth: number,
  signHeight: number,
  layout: SzjWayfindingAtlasLayout,
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  // 底板背衬 (z = 0) + 四边拉丝铝合金立体边框条 (z = 0.001 防 z-fighting)
  pushTexturedQuad(positions, normals, uvs, indices, 0, 0, 0, signWidth, signHeight, layout.panelRect, 2.5)
  const trimT = 0.018
  // Top & Bottom aluminum frame strips
  pushTexturedQuad(
    positions,
    normals,
    uvs,
    indices,
    0,
    signHeight * 0.5 - trimT * 0.5,
    0.001,
    signWidth,
    trimT,
    layout.bezelRect,
    2.0,
  )
  pushTexturedQuad(
    positions,
    normals,
    uvs,
    indices,
    0,
    -signHeight * 0.5 + trimT * 0.5,
    0.001,
    signWidth,
    trimT,
    layout.bezelRect,
    2.0,
  )
  // Left & Right aluminum vertical frame strips
  const innerH = Math.max(0.1, signHeight - trimT * 2)
  pushTexturedQuad(
    positions,
    normals,
    uvs,
    indices,
    -signWidth * 0.5 + trimT * 0.5,
    0,
    0.001,
    trimT,
    innerH,
    layout.bezelRect,
    2.0,
  )
  pushTexturedQuad(
    positions,
    normals,
    uvs,
    indices,
    signWidth * 0.5 - trimT * 0.5,
    0,
    0.001,
    trimT,
    innerH,
    layout.bezelRect,
    2.0,
  )

  const rows = face.rows.slice(0, SZJ_SIGN_SPEC.maxRows)
  const count = rows.length
  if (count > 0) {
    const padPx = 2.0
    const distPadPx = 1.5
    const arrowRatio = (ARROW_SLOT_W - padPx * 2) / (ARROW_SLOT_H - padPx * 2)
    const badgeRatio = (BADGE_SLOT_W - padPx * 2) / (BADGE_SLOT_H - padPx * 2)
    const exitRatio = (EXIT_SLOT_W - padPx * 2) / (EXIT_SLOT_H - padPx * 2)
    const backRatio = (TURNBACK_SLOT_W - padPx * 2) / (EXIT_SLOT_H - padPx * 2)
    const distRatio = (DIST_SLOT_W - distPadPx * 2) / (DIST_SLOT_H - distPadPx * 2)

    const usableW = Math.max(0.8, signWidth - trimT * 2 - 0.016)
    const usableH = Math.max(0.14, innerH - 0.012)

    const cols = count >= 2 ? 2 : 1
    const gridRows = Math.ceil(count / cols)
    const colGap = cols > 1 ? 0.044 : 0
    const rowGap = gridRows > 1 ? 0.02 : 0
    const cellW = (usableW - (cols - 1) * colGap) / cols
    const cellH = (usableH - (gridRows - 1) * rowGap) / gridRows

    // Divider bars: for 3-item (2 top + 1 centered bottom) never drop a dead vertical line across blank space
    if (cols === 2) {
      const sepH = count === 3 ? cellH : Math.min(innerH * 0.9, usableH)
      const sepCy = count === 3 ? usableH * 0.5 - cellH * 0.5 : 0
      pushTexturedQuad(positions, normals, uvs, indices, 0, sepCy, 0.0014, 0.006, sepH, layout.bezelRect, 2.0)
      if (count === 3) {
        pushTexturedQuad(
          positions,
          normals,
          uvs,
          indices,
          0,
          usableH * 0.5 - cellH - rowGap * 0.5,
          0.0014,
          usableW * 0.92,
          0.004,
          layout.bezelRect,
          2.0,
        )
      }
    }

    const topCellY = (gridRows * cellH + (gridRows - 1) * rowGap) * 0.5 - cellH * 0.5
    const badgeInlineScale = 0.8
    const inlineAspect = (hasBack: boolean) =>
      arrowRatio +
      badgeRatio * badgeInlineScale +
      exitRatio +
      distRatio +
      (hasBack ? backRatio : 0) +
      (hasBack ? 0.16 : 0.12)

    for (let i = 0; i < count; i++) {
      const row = rows[i]!
      const gridR = Math.floor(i / cols)
      const gridC = i % cols
      const isCenteredThird = count === 3 && cols === 2 && i === 2
      const effCellW = isCenteredThird ? usableW : cellW
      const cy = topCellY - gridR * (cellH + rowGap)
      const colCenterX =
        cols === 1 || isCenteredThird ? 0 : (gridC === 0 ? -1 : 1) * (cellW * 0.5 + colGap * 0.5)
      const hasBack = row.arrow === 'back'

      // 窄深两栏或窄通道2x2卡片（如 2.8m×0.58m 双出口 szj-sign-038 或 2.0m 窄廊3-4行牌）：箭头独立占左全高，右侧上下叠「中文地标 / [NE] 50m」
      // 让 ↖ 箭头翻倍加粗，同时横宽 [NE] 徽章获 3 倍宽裕度，彻底消灭 10m 白斑与噪点
      const useTwoTier = !isCenteredThird && effCellW / cellH < 4.0

      if (useTwoTier) {
        const cardH = Math.min(0.52, cellH * 0.96)
        const maxArrowW = cardH * arrowRatio
        const innerGap = Math.max(0.02, cardH * 0.05)
        const rightAvailW = Math.max(0.45, effCellW - maxArrowW - innerGap)
        const arrowW = maxArrowW

        const cardLeft = colCenterX - (arrowW + innerGap + rightAvailW) * 0.5
        const arrowCx = cardLeft + arrowW * 0.5
        const rightLeft = cardLeft + arrowW + innerGap
        const rightCenterX = rightLeft + rightAvailW * 0.5

        // 1) 左全高厚重方向箭头
        pushTexturedQuad(
          positions,
          normals,
          uvs,
          indices,
          arrowCx,
          cy,
          0.002,
          arrowW,
          cardH,
          layout.arrows[row.arrow],
          padPx,
        )

        // 2) 右上纯中文地标，右下横宽红章 + 零压窄距离（把下排升至 44% 槽高确保 50m/70m 在 10.7m 下有足额像素高度）
        const tierGap = cardH * 0.04
        const cnH = Math.min(cardH * 0.52, rightAvailW / exitRatio)
        const cnW = cnH * exitRatio
        const metaH = Math.min(cardH - cnH - tierGap, cardH * 0.44)
        const totalStackH = cnH + tierGap + metaH
        const cnCy = cy + totalStackH * 0.5 - cnH * 0.5
        const metaCy = cy - totalStackH * 0.5 + metaH * 0.5

        pushTexturedQuad(
          positions,
          normals,
          uvs,
          indices,
          rightCenterX,
          cnCy,
          0.002,
          cnW,
          cnH,
          layout.exits[row.stairId],
          padPx,
        )

        // 3) 右下横宽红章 [NW/NE] + 宽距距离数字 (+ 可选掉头)
        const metaBadgeW = metaH * badgeRatio
        const metaDistW = metaH * distRatio
        const metaBackW = hasBack ? metaH * backRatio : 0
        const metaGap = Math.max(0.02, metaH * 0.14)
        const rawMetaW = metaBadgeW + metaGap + metaDistW + (hasBack ? metaGap + metaBackW : 0)
        const metaScale = rawMetaW > rightAvailW ? rightAvailW / rawMetaW : 1
        const effMetaH = metaH * metaScale
        const bW = metaBadgeW * metaScale
        const dW = metaDistW * metaScale
        const tW = metaBackW * metaScale
        const mGap = metaGap * metaScale
        let mx = rightCenterX - (rawMetaW * metaScale) * 0.5

        pushTexturedQuad(
          positions,
          normals,
          uvs,
          indices,
          mx + bW * 0.5,
          metaCy,
          0.002,
          bW,
          effMetaH,
          layout.exitBadges[row.stairId],
          padPx,
        )
        mx += bW + mGap

        pushTexturedQuad(
          positions,
          normals,
          uvs,
          indices,
          mx + dW * 0.5,
          metaCy,
          0.002,
          dW,
          effMetaH,
          findNearestDistanceRect(layout, row.shownM),
          distPadPx,
        )
        mx += dW

        if (hasBack) {
          mx += mGap
          pushTexturedQuad(
            positions,
            normals,
            uvs,
            indices,
            mx + tW * 0.5,
            metaCy,
            0.002,
            tW,
            effMetaH,
            layout.turnBackRect,
            padPx,
          )
        }
      } else {
        // 标准横排（1行满宽牌如 compare-06 或 2x2 宽浅格如 compare-02）
        const colMaxAsp = (() => {
          if (cols === 1 || isCenteredThird) return inlineAspect(hasBack)
          let maxA = inlineAspect(false)
          for (let rIdx = 0; rIdx < gridRows; rIdx++) {
            const item = rows[rIdx * cols + gridC]
            if (item) maxA = Math.max(maxA, inlineAspect(item.arrow === 'back'))
          }
          return maxA
        })()
        const rowH = Math.min(0.46, cellH * 0.94, effCellW / colMaxAsp)
        const arrowW = arrowRatio * rowH
        const badgeH = rowH * badgeInlineScale
        const badgeW = badgeRatio * badgeH
        const exitW = exitRatio * rowH
        const distW = distRatio * rowH
        const backW = backRatio * rowH
        const slotGap = 0.03 * rowH
        const alignedW = colMaxAsp * rowH
        let cursorX = colCenterX - alignedW * 0.5

        pushTexturedQuad(
          positions,
          normals,
          uvs,
          indices,
          cursorX + arrowW * 0.5,
          cy,
          0.002,
          arrowW,
          rowH,
          layout.arrows[row.arrow],
          padPx,
        )
        cursorX += arrowW + slotGap

        pushTexturedQuad(
          positions,
          normals,
          uvs,
          indices,
          cursorX + badgeW * 0.5,
          cy,
          0.002,
          badgeW,
          badgeH,
          layout.exitBadges[row.stairId],
          padPx,
        )
        cursorX += badgeW + slotGap

        pushTexturedQuad(
          positions,
          normals,
          uvs,
          indices,
          cursorX + exitW * 0.5,
          cy,
          0.002,
          exitW,
          rowH,
          layout.exits[row.stairId],
          padPx,
        )
        cursorX += exitW + slotGap

        pushTexturedQuad(
          positions,
          normals,
          uvs,
          indices,
          cursorX + distW * 0.5,
          cy,
          0.002,
          distW,
          rowH,
          findNearestDistanceRect(layout, row.shownM),
          distPadPx,
        )
        cursorX += distW

        if (hasBack) {
          cursorX += slotGap
          pushTexturedQuad(
            positions,
            normals,
            uvs,
            indices,
            cursorX + backW * 0.5,
            cy,
            0.002,
            backW,
            rowH,
            layout.turnBackRect,
            padPx,
          )
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeBoundingSphere()
  return geo
}

function mergeGeos(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let vOff = 0
  for (const part of parts) {
    const p = part.getAttribute('position')
    const n = part.getAttribute('normal')
    const u = part.getAttribute('uv')
    const idx = part.getIndex()
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i))
      normals.push(n.getX(i), n.getY(i), n.getZ(i))
      uvs.push(u.getX(i), u.getY(i))
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(vOff + idx.getX(i))
    }
    vOff += p.count
    part.dispose()
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  merged.setIndex(indices)
  merged.computeBoundingSphere()
  return merged
}

/**
 * 仅 3 drawCalls 构建全部天花板悬挂式寻路灯箱：
 * - `boxMesh`: 铝合金/深灰金属外壳箱体 (InstancedMesh)
 * - `rodMesh`: 成对金属悬吊圆杆直达吊顶 rodTopY (InstancedMesh)
 * - `faceMesh`: 178 个朝向行进方向的高清晰正反自发光灯箱面 (合并 Mesh)
 */
export function createWayfindingSignsGroup(
  wf: SzjWayfinding,
  wayfindingMat: THREE.MeshStandardMaterial,
  housingMat: THREE.Material,
  rodMat: THREE.Material,
  layout: SzjWayfindingAtlasLayout,
  opts: { readonly floorY?: number } = {},
): SzjWayfindingSignsBatch {
  const floorY = opts.floorY ?? 0
  const signs: readonly SzjHangingSign[] = wf.signs
  const group = new THREE.Group()
  group.name = 'szj-wayfinding-signs'

  const boxGeo = new THREE.BoxGeometry(1, 1, 1)
  const rodGeo = new THREE.CylinderGeometry(0.016, 0.016, 1, 8)
  const boxMesh = new THREE.InstancedMesh(boxGeo, housingMat, Math.max(1, signs.length))
  boxMesh.name = 'szj-wayfinding-boxes'
  boxMesh.count = signs.length

  const rodMesh = new THREE.InstancedMesh(rodGeo, rodMat, Math.max(1, signs.length * 2))
  rodMesh.name = 'szj-wayfinding-rods'
  rodMesh.count = signs.length * 2

  const dummy = new THREE.Object3D()
  const faceParts: THREE.BufferGeometry[] = []

  for (let i = 0; i < signs.length; i++) {
    const s = signs[i]!
    const cy = floorY + s.bottomY + s.height * 0.5
    const yaw = s.faces[0].yaw

    // 1. 金属灯箱外框（顶部冗余压窄至 +0.02m 减小对天花吊顶侵入）
    dummy.position.set(s.x, cy, s.z)
    dummy.rotation.set(0, yaw, 0)
    dummy.scale.set(s.width + 0.03, s.height + 0.02, s.depth)
    dummy.updateMatrix()
    boxMesh.setMatrixAt(i, dummy.matrix)

    // 2. 双侧细金属吊杆（从灯箱顶连至天花板）
    const signTopY = floorY + s.bottomY + s.height
    const rodLen = Math.max(0.08, floorY + s.rodTopY - signTopY + 0.04)
    const rodMidY = signTopY + rodLen * 0.5 - 0.02
    const rightX = Math.cos(yaw)
    const rightZ = -Math.sin(yaw)
    for (let r = 0; r < 2; r++) {
      const side = r === 0 ? -1 : 1
      dummy.position.set(s.x + rightX * s.rodX * side, rodMidY, s.z + rightZ * s.rodX * side)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, rodLen, 1)
      dummy.updateMatrix()
      rodMesh.setMatrixAt(i * 2 + r, dummy.matrix)
    }

    // 3. 正反两面 1:1 导视发光灯箱面板（法向向外偏移 depth*0.5 + 0.005m，零 Z-fighting）
    const off = s.depth * 0.5 + 0.005
    for (const face of s.faces) {
      const fg = buildWayfindingFaceGeometry(face, s.width, s.height, layout)
      fg.rotateY(face.yaw)
      fg.translate(s.x + Math.sin(face.yaw) * off, cy, s.z + Math.cos(face.yaw) * off)
      faceParts.push(fg)
    }
  }

  boxMesh.instanceMatrix.needsUpdate = true
  rodMesh.instanceMatrix.needsUpdate = true
  const facesGeo = mergeGeos(faceParts)
  const faceMesh = new THREE.Mesh(facesGeo, wayfindingMat)
  faceMesh.name = 'szj-wayfinding-faces'
  group.add(boxMesh, rodMesh, faceMesh)

  const triangles =
    boxMesh.count * 12 +
    rodMesh.count * 16 +
    Math.floor((facesGeo.getIndex()?.count ?? 0) / 3)

  let disposed = false
  return {
    group,
    faceMesh,
    boxMesh,
    rodMesh,
    drawCalls: signs.length > 0 ? 3 : 0,
    triangles,
    signCount: signs.length,
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      boxGeo.dispose()
      rodGeo.dispose()
      facesGeo.dispose()
    },
  }
}
