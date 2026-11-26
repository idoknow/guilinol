import * as THREE from 'three'
import {
  createSzjAtmos,
  type SzjAtmosHandle,
  type SzjAtmosPresetName,
  type SzjAtmosRealitySpec,
} from '../atmos/index.ts'
import {
  SZJ_BUDGET,
  SZJ_FRAME,
  SZJ_STAIRWELLS,
  indoorToStairLocal,
  layoutNpcCount,
  stairLocalToIndoor,
  type SzjCorridor,
  type SzjLayout,
  type SzjShop,
  type SzjStairwell,
} from '../contract.ts'
import {
  createShizijieCrowd,
  type SzjCrowdHandle,
} from '../crowd/index.ts'
import {
  SHIZIJIE_PALETTE,
  SHIZIJIE_SIGN_FONTS,
  SZJ_SIGN_ATLAS_RECTS,
  WAYFINDING_ATLAS_HEIGHT,
  WAYFINDING_ATLAS_WIDTH,
  applySignAtlasRect,
  createShizijieMaterials,
  createWayfindingSignsGroup,
  resolveShopLook,
  type AtlasRect,
  type ShizijieMaterialPack,
  type SzjSignAtlasSlot,
  type SzjWayfindingAtlasLayout,
  type SzjWayfindingSignsBatch,
} from '../look/index.ts'
import {
  SZJ_ARROW_DEG,
  SZJ_SIGN_SPEC,
  buildSzjWayfinding,
  type SzjArrow,
  type SzjHangingSign,
  type SzjSignFace,
  type SzjWayfinding,
} from '../wayfinding/index.ts'
import {
  closestPointOnCorridor,
  closestPointOnSegment,
  locateStairwellAt,
  rectToAabb,
  type Aabb2D,
} from './collision.ts'

interface OrientedBoxSpec {
  readonly cx: number
  readonly cy: number
  readonly cz: number
  readonly sx: number
  readonly sy: number
  readonly sz: number
  readonly yaw?: number
  readonly pitch?: number
}

export interface SzjIndoorSceneHandle {
  readonly scene: THREE.Scene
  readonly matPack: ShizijieMaterialPack
  readonly atmos: SzjAtmosHandle
  readonly wayfinding: SzjWayfinding
  readonly wayfindingBatch: SzjWayfindingSignsBatch
  readonly crowd: SzjCrowdHandle
  readonly meshCount: number
  readonly triangleCount: number
  readonly textureBytes: number
  readonly npcCount: number
  readonly wallWayfindingPlaqueCount: number
  readonly safetyExitPlaqueCount: number
  getHangingSigns(): readonly SzjHangingSign[]
  isDisposed(): boolean
  dispose(): void
}

function buildMergedOrientedBoxes(
  specs: readonly OrientedBoxSpec[],
  uvScale: readonly [number, number] = [1, 1],
): { geom: THREE.BufferGeometry; triangles: number } {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let vertexOffset = 0
  const [su, sv] = uvScale
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  const mat4 = new THREE.Matrix4()

  for (const b of specs) {
    if (b.sx <= 0 || b.sy <= 0 || b.sz <= 0) continue
    const box = new THREE.BoxGeometry(b.sx, b.sy, b.sz)
    if (b.yaw || b.pitch) {
      euler.set(b.pitch ?? 0, b.yaw ?? 0, 0, 'YXZ')
      mat4.makeRotationFromEuler(euler)
      box.applyMatrix4(mat4)
    }
    box.translate(b.cx, b.cy, b.cz)

    const pos = box.getAttribute('position')
    const norm = box.getAttribute('normal')
    const idx = box.getIndex()

    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i)
      const py = pos.getY(i)
      const pz = pos.getZ(i)
      const nx = norm.getX(i)
      const ny = norm.getY(i)
      const nz = norm.getZ(i)
      positions.push(px, py, pz)
      normals.push(nx, ny, nz)
      if (Math.abs(ny) > 0.5) {
        uvs.push(px * su, pz * sv)
      } else if (Math.abs(nx) > Math.abs(nz)) {
        uvs.push(pz * su, py * sv)
      } else {
        uvs.push(px * su, py * sv)
      }
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(vertexOffset + idx.getX(i))
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(vertexOffset + i)
    }
    vertexOffset += pos.count
    box.dispose()
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  merged.setIndex(indices)
  merged.computeBoundingSphere()
  return { geom: merged, triangles: Math.floor(indices.length / 3) }
}

function mergeBufferGeometries(parts: readonly THREE.BufferGeometry[]): {
  geom: THREE.BufferGeometry
  triangles: number
} {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let vertexOffset = 0

  for (const part of parts) {
    const pos = part.getAttribute('position')
    const norm = part.getAttribute('normal')
    const uv = part.getAttribute('uv')
    const idx = part.getIndex()
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
      normals.push(norm ? norm.getX(i) : 0, norm ? norm.getY(i) : 1, norm ? norm.getZ(i) : 0)
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0)
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(vertexOffset + idx.getX(i))
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(vertexOffset + i)
    }
    vertexOffset += pos.count
    part.dispose()
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  merged.setIndex(indices)
  merged.computeBoundingSphere()
  return { geom: merged, triangles: Math.floor(indices.length / 3) }
}

function makeSignPlane(
  cx: number,
  cy: number,
  cz: number,
  width: number,
  height: number,
  yawRad: number,
  slot: SzjSignAtlasSlot,
): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height)
  applySignAtlasRect(g, slot, 2)
  g.rotateY(yawRad)
  g.translate(cx, cy, cz)
  return g
}

function makeDoubleSidedSignPlanes(
  cx: number,
  cy: number,
  cz: number,
  width: number,
  height: number,
  yawRad: number,
  thickness: number,
  slot: SzjSignAtlasSlot,
): THREE.BufferGeometry[] {
  const sinY = Math.sin(yawRad)
  const cosY = Math.cos(yawRad)
  const halfT = thickness * 0.5 + 0.016
  return [
    makeSignPlane(cx + sinY * halfT, cy, cz + cosY * halfT, width, height, yawRad, slot),
    makeSignPlane(cx - sinY * halfT, cy, cz - cosY * halfT, width, height, yawRad + Math.PI, slot),
  ]
}

function fillRoundedRect(
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

function strokeCodeGlyph(ctx: CanvasRenderingContext2D, ch: string, cx: number, cy: number): void {
  ctx.beginPath()
  if (ch === 'N') {
    ctx.moveTo(cx - 13, cy + 19)
    ctx.lineTo(cx - 13, cy - 19)
    ctx.lineTo(cx + 13, cy + 19)
    ctx.lineTo(cx + 13, cy - 19)
  } else if (ch === 'W') {
    ctx.moveTo(cx - 19, cy - 19)
    ctx.lineTo(cx - 10, cy + 19)
    ctx.lineTo(cx, cy - 13)
    ctx.lineTo(cx + 10, cy + 19)
    ctx.lineTo(cx + 19, cy - 19)
  } else if (ch === 'E') {
    ctx.moveTo(cx + 12, cy - 19)
    ctx.lineTo(cx - 12, cy - 19)
    ctx.lineTo(cx - 12, cy + 19)
    ctx.lineTo(cx + 12, cy + 19)
    ctx.moveTo(cx - 12, cy)
    ctx.lineTo(cx + 9, cy)
  } else if (ch === 'S') {
    ctx.moveTo(cx + 12, cy - 13)
    ctx.bezierCurveTo(cx + 10, cy - 22, cx - 13, cy - 22, cx - 13, cy - 9)
    ctx.bezierCurveTo(cx - 13, cy + 1, cx + 13, cy - 1, cx + 13, cy + 10)
    ctx.bezierCurveTo(cx + 13, cy + 22, cx - 11, cy + 22, cx - 13, cy + 12)
  }
  ctx.stroke()
}

/**
 * 在浏览器 CanvasTexture 上以 1:1 像素密度重绘高锐度抗远距缩采样字形：
 * - [NW]/[NE]/[SE]/[SW] 采用宽开口几何矢量字形 + 深底描边，根治 10m 处 W 斜笔糊成红底白斑；
 * - 4 个出口中文站名逐字等距绘制（scaleX=1.0 零横向挤压 + 深色描边防粘连）；
 * - 梯井安全出口/小心台阶去除 3-4px 糊化小英文副行，改为居中单行大字。
 */
function enhanceRuntimeSignAtlases(matPack: ShizijieMaterialPack): void {
  if (typeof HTMLCanvasElement === 'undefined') return

  const wfTex = matPack.wayfindingMat.map
  if (wfTex && wfTex.image instanceof HTMLCanvasElement) {
    const canvas = wfTex.image
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const layout = matPack.wayfindingAtlas
      const w = canvas.width
      const h = canvas.height
      const bgHex = '#141c26'
      const pxRect = (r: AtlasRect) => ({
        x: Math.round(r[0] * w),
        y: Math.round(r[1] * h),
        rw: Math.round((r[2] - r[0]) * w),
        rh: Math.round((r[3] - r[1]) * h),
      })

      const panel = pxRect(layout.panelRect)
      ctx.fillStyle = bgHex
      ctx.fillRect(panel.x, panel.y, panel.rw, panel.rh)

      for (const id of ['nw', 'ne', 'se', 'sw'] as const) {
        const spec = layout.exitSpecs[id]
        const b = pxRect(layout.exits[id])
        ctx.fillStyle = bgHex
        ctx.fillRect(b.x, b.y, b.rw, b.rh)

        const chars = [...spec.name]
        const isShort = chars.length <= 3
        const fontPx = isShort ? 62 : 57
        const cellStep = isShort ? 74 : 59
        const spanW = chars.length * cellStep
        const startX = b.x + (b.rw - spanW) * 0.5 + cellStep * 0.5
        const midY = b.y + b.rh * 0.5 + 2
        ctx.save()
        ctx.font = `600 ${fontPx}px ${SHIZIJIE_SIGN_FONTS.sans}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 5
        ctx.strokeStyle = '#070b10'
        ctx.fillStyle = '#f5f9fd'
        for (let k = 0; k < chars.length; k++) {
          const chX = startX + k * cellStep
          ctx.strokeText(chars[k]!, chX, midY)
          ctx.fillText(chars[k]!, chX, midY)
        }
        ctx.restore()

        const cb = pxRect(layout.exitBadges[id])
        ctx.fillStyle = bgHex
        ctx.fillRect(cb.x, cb.y, cb.rw, cb.rh)
        fillRoundedRect(ctx, cb.x + 8, cb.y + 6, cb.rw - 16, cb.rh - 12, 10, '#911b0e')

        const codeChars = [...spec.code.toUpperCase()]
        const cMidX = cb.x + cb.rw * 0.5
        const cMidY = cb.y + cb.rh * 0.5
        const leftOff = codeChars[1] === 'W' ? -24 : -21
        const rightOff = codeChars[1] === 'W' ? 20 : 21
        ctx.save()
        ctx.lineCap = 'butt'
        ctx.lineJoin = 'round'
        for (const pass of [
          { width: 10.5, color: '#2b0502' },
          { width: 6.2, color: '#f7fafd' },
        ] as const) {
          ctx.lineWidth = pass.width
          ctx.strokeStyle = pass.color
          if (codeChars[0]) strokeCodeGlyph(ctx, codeChars[0], cMidX + leftOff, cMidY)
          if (codeChars[1]) strokeCodeGlyph(ctx, codeChars[1], cMidX + rightOff, cMidY)
        }
        ctx.restore()
      }

      const arrowOrder: readonly SzjArrow[] = [
        'straight',
        'slight-right',
        'right',
        'sharp-right',
        'slight-left',
        'left',
        'sharp-left',
        'back',
      ]
      for (const arrow of arrowOrder) {
        const b = pxRect(layout.arrows[arrow])
        ctx.fillStyle = bgHex
        ctx.fillRect(b.x, b.y, b.rw, b.rh)
        const rad = (SZJ_ARROW_DEG[arrow] * Math.PI) / 180
        ctx.save()
        ctx.translate(b.x + b.rw * 0.5, b.y + b.rh * 0.5)
        ctx.rotate(rad)
        ctx.beginPath()
        ctx.moveTo(0, -37)
        ctx.lineTo(31, -2)
        ctx.lineTo(12, -2)
        ctx.lineTo(12, 36)
        ctx.lineTo(-12, 36)
        ctx.lineTo(-12, -2)
        ctx.lineTo(-31, -2)
        ctx.closePath()
        ctx.lineJoin = 'round'
        ctx.lineWidth = 4.5
        ctx.strokeStyle = '#070b10'
        ctx.stroke()
        ctx.fillStyle = '#f7fafd'
        ctx.fill()
        ctx.restore()
      }

      for (const distM of layout.distanceKeysSorted) {
        const r = layout.distances.get(distM)
        if (!r) continue
        const b = pxRect(r)
        ctx.fillStyle = bgHex
        ctx.fillRect(b.x, b.y, b.rw, b.rh)
        const label = `${distM}m`
        const isLong = label.length >= 4
        const pxSize = isLong ? 32 : 36
        ctx.save()
        ctx.font = `700 ${pxSize}px "Helvetica Neue",${SHIZIJIE_SIGN_FONTS.sans}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 3.6
        ctx.strokeStyle = '#070b10'
        ctx.fillStyle = '#f7d36b'
        const kerning = isLong ? 1.5 : 2.5
        const chars = [...label]
        const adv = chars.map(ch => ctx.measureText(ch).width + (ch === 'm' ? 0 : kerning))
        const totalW = adv.reduce((acc, v) => acc + v, 0)
        const fitScale = Math.min(1, (b.rw - 10) / Math.max(1, totalW))
        ctx.translate(b.x + b.rw * 0.5, b.y + b.rh * 0.5 + 1)
        ctx.scale(fitScale, 1)
        let cx = -totalW * 0.5
        for (let k = 0; k < chars.length; k++) {
          const chX = cx + adv[k]! * 0.5
          ctx.strokeText(chars[k]!, chX, 0)
          ctx.fillText(chars[k]!, chX, 0)
          cx += adv[k]!
        }
        ctx.restore()
      }

      wfTex.anisotropy = 16
      wfTex.needsUpdate = true
    }
  }

  // 压低漫反射分量避免顶灯近距照射把红章冲白，依靠纯正自发光呈现均匀灯箱透光
  matPack.wayfindingMat.color.set('#384352')
  matPack.wayfindingMat.emissiveIntensity = 0.84

  const signTex = matPack.signAtlasMat.map
  if (signTex && signTex.image instanceof HTMLCanvasElement) {
    const canvas = signTex.image
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const w = canvas.width
      const h = canvas.height
      const rectPx = (r: AtlasRect) => ({
        x: Math.round(r[0] * w),
        y: Math.round(r[1] * h),
        rw: Math.round((r[2] - r[0]) * w),
        rh: Math.round((r[3] - r[1]) * h),
      })

      // 重绘梯井绿底安全出口牌：去掉 6.96m 处糊成 3-4px 细线的英文副行，改用单行居中大字
      const se = rectPx(SZJ_SIGN_ATLAS_RECTS.safetyExit)
      ctx.fillStyle = '#17603e'
      ctx.fillRect(se.x, se.y, se.rw, se.rh)
      ctx.strokeStyle = '#94d6b0'
      ctx.lineWidth = 2
      ctx.strokeRect(se.x + 5, se.y + 5, se.rw - 10, se.rh - 10)
      const ix = se.x + 18
      const iy = se.y + 14
      ctx.fillStyle = '#f4fbf7'
      ctx.fillRect(ix, iy, 20, 36)
      ctx.fillStyle = '#17603e'
      ctx.beginPath()
      ctx.arc(ix + 11, iy + 8, 3.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#17603e'
      ctx.lineWidth = 2.8
      ctx.beginPath()
      ctx.moveTo(ix + 10, iy + 12)
      ctx.lineTo(ix + 9, iy + 23)
      ctx.lineTo(ix + 4, iy + 32)
      ctx.moveTo(ix + 9, iy + 23)
      ctx.lineTo(ix + 15, iy + 30)
      ctx.moveTo(ix + 5, iy + 16)
      ctx.lineTo(ix + 15, iy + 16)
      ctx.stroke()
      ctx.save()
      ctx.font = `800 30px ${SHIZIJIE_SIGN_FONTS.sans}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#f4fbf7'
      ctx.fillText('安全出口 ↑', se.x + se.rw * 0.5 + 14, se.y + se.rh * 0.5 + 1, se.rw - 56)
      ctx.restore()

      // 重绘梯井黄底防滑警示牌：去掉 3-4px 糊化小英文，改单行高反差粗黑大字
      const sc = rectPx(SZJ_SIGN_ATLAS_RECTS.stairCaution)
      ctx.fillStyle = '#dca822'
      ctx.fillRect(sc.x, sc.y, sc.rw, sc.rh)
      ctx.strokeStyle = '#12161c'
      ctx.lineWidth = 3
      ctx.strokeRect(sc.x + 5, sc.y + 5, sc.rw - 10, sc.rh - 10)
      ctx.save()
      ctx.font = `800 32px ${SHIZIJIE_SIGN_FONTS.sans}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#0a0d12'
      const cautionChars = [...'小心台阶']
      const cautionStep = 50
      const cautionStart = sc.x + (sc.rw - cautionChars.length * cautionStep) * 0.5 + cautionStep * 0.5
      for (let k = 0; k < cautionChars.length; k++) {
        ctx.fillText(cautionChars[k]!, cautionStart + k * cautionStep, sc.y + sc.rh * 0.5 + 1)
      }
      ctx.restore()

      signTex.anisotropy = 16
      signTex.needsUpdate = true
    }
  }
}

function pushWayfindingQuad(
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

function lookupDistanceRect(layout: SzjWayfindingAtlasLayout, shownM: number): AtlasRect {
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

function slotAspect(rect: AtlasRect, padPx: number): number {
  const pw = Math.max(1, (rect[2] - rect[0]) * WAYFINDING_ATLAS_WIDTH - padPx * 2)
  const ph = Math.max(1, (rect[3] - rect[1]) * WAYFINDING_ATLAS_HEIGHT - padPx * 2)
  return pw / ph
}

function buildRuntimeSingleFaceGeometry(
  face: SzjSignFace,
  signWidth: number,
  signHeight: number,
  layout: SzjWayfindingAtlasLayout,
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  pushWayfindingQuad(positions, normals, uvs, indices, 0, 0, 0, signWidth, signHeight, layout.panelRect, 2.5)
  const trimT = 0.018
  pushWayfindingQuad(
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
  pushWayfindingQuad(
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
  const innerH = Math.max(0.1, signHeight - trimT * 2)
  pushWayfindingQuad(
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
  pushWayfindingQuad(
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
    const sampleArrow = layout.arrows.straight
    const sampleBadge = layout.exitBadges.nw
    const sampleExit = layout.exits.nw
    const sampleDist = lookupDistanceRect(layout, 50)
    const arrowRatio = slotAspect(sampleArrow, padPx)
    const badgeRatio = slotAspect(sampleBadge, padPx)
    const exitRatio = slotAspect(sampleExit, padPx)
    const backRatio = slotAspect(layout.turnBackRect, padPx)
    const distRatio = slotAspect(sampleDist, distPadPx)

    const usableW = Math.max(0.8, signWidth - trimT * 2 - 0.02)
    const usableH = Math.max(0.14, innerH - 0.012)

    const cols = count >= 2 ? 2 : 1
    const gridRows = Math.ceil(count / cols)
    const colGap = cols > 1 ? 0.052 : 0
    const rowGap = gridRows > 1 ? 0.024 : 0
    const cellW = (usableW - (cols - 1) * colGap) / cols
    const cellH = (usableH - (gridRows - 1) * rowGap) / gridRows

    if (cols === 2) {
      const sepH = count === 3 ? cellH : Math.min(innerH * 0.88, usableH)
      const sepCy = count === 3 ? usableH * 0.5 - cellH * 0.5 : 0
      pushWayfindingQuad(positions, normals, uvs, indices, 0, sepCy, 0.0014, 0.007, sepH, layout.bezelRect, 2.0)
      if (count === 3) {
        pushWayfindingQuad(
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
    const badgeInlineScale = 0.82
    const distInlineScale = 0.66
    const gapUnit = 0.052
    const inlineAspect = (hasBack: boolean) =>
      arrowRatio +
      gapUnit +
      badgeRatio * badgeInlineScale +
      gapUnit +
      exitRatio +
      gapUnit +
      distRatio * distInlineScale +
      (hasBack ? gapUnit + backRatio * 0.85 : 0)

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

      // 宽牌双出口（如 4.24m 主环吊牌 szj-sign-038）及单出口牌一律采用全高单行并排（1:1 正方像素），杜绝上下两行挤压粘连
      const preferInline =
        count === 1 || isCenteredThird || (count === 2 && signWidth >= 2.75) || effCellW / cellH >= 3.6

      if (preferInline) {
        const colMaxAsp = (() => {
          if (cols === 1 || isCenteredThird) return inlineAspect(hasBack)
          let maxA = inlineAspect(false)
          for (let rIdx = 0; rIdx < gridRows; rIdx++) {
            const item = rows[rIdx * cols + gridC]
            if (item) maxA = Math.max(maxA, inlineAspect(item.arrow === 'back'))
          }
          return maxA
        })()
        const rowH = Math.min(0.49, cellH * 0.96, (effCellW * 0.98) / colMaxAsp)
        const arrowW = arrowRatio * rowH
        const badgeH = rowH * badgeInlineScale
        const badgeW = badgeRatio * badgeH
        const exitH = rowH
        const exitW = exitRatio * exitH
        const distH = rowH * distInlineScale
        const distW = distRatio * distH
        const backH = rowH * 0.85
        const backW = backRatio * backH
        const slotGap = gapUnit * rowH
        const actualW =
          arrowW + slotGap + badgeW + slotGap + exitW + slotGap + distW + (hasBack ? slotGap + backW : 0)
        let cursorX = colCenterX - actualW * 0.5

        pushWayfindingQuad(
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

        pushWayfindingQuad(
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

        pushWayfindingQuad(
          positions,
          normals,
          uvs,
          indices,
          cursorX + exitW * 0.5,
          cy,
          0.002,
          exitW,
          exitH,
          layout.exits[row.stairId],
          padPx,
        )
        cursorX += exitW + slotGap

        pushWayfindingQuad(
          positions,
          normals,
          uvs,
          indices,
          cursorX + distW * 0.5,
          cy,
          0.002,
          distW,
          distH,
          lookupDistanceRect(layout, row.shownM),
          distPadPx,
        )
        cursorX += distW

        if (hasBack) {
          cursorX += slotGap
          pushWayfindingQuad(
            positions,
            normals,
            uvs,
            indices,
            cursorX + backW * 0.5,
            cy,
            0.002,
            backW,
            backH,
            layout.turnBackRect,
            padPx,
          )
        }
      } else {
        const cardH = Math.min(0.5, cellH * 0.94)
        const arrowW = cardH * arrowRatio
        const innerGap = Math.max(0.024, cardH * 0.06)
        const rightAvailW = Math.max(0.42, effCellW - arrowW - innerGap)
        const cardLeft = colCenterX - (arrowW + innerGap + rightAvailW) * 0.5
        const arrowCx = cardLeft + arrowW * 0.5
        const rightCenterX = cardLeft + arrowW + innerGap + rightAvailW * 0.5

        pushWayfindingQuad(
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

        const tierGap = cardH * 0.09
        const cnH = Math.min(cardH * 0.48, rightAvailW / exitRatio)
        const cnW = cnH * exitRatio
        const metaH = Math.min(cardH - cnH - tierGap, cardH * 0.42)
        const totalStackH = cnH + tierGap + metaH
        const cnCy = cy + totalStackH * 0.5 - cnH * 0.5
        const metaCy = cy - totalStackH * 0.5 + metaH * 0.5

        pushWayfindingQuad(
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

        const metaBadgeW = metaH * badgeRatio
        const metaDistW = metaH * distRatio
        const metaBackW = hasBack ? metaH * backRatio : 0
        const metaGap = Math.max(0.024, metaH * 0.16)
        const rawMetaW = metaBadgeW + metaGap + metaDistW + (hasBack ? metaGap + metaBackW : 0)
        const metaScale = rawMetaW > rightAvailW ? rightAvailW / rawMetaW : 1
        const effMetaH = metaH * metaScale
        const bW = metaBadgeW * metaScale
        const dW = metaDistW * metaScale
        const tW = metaBackW * metaScale
        const mGap = metaGap * metaScale
        let mx = rightCenterX - rawMetaW * metaScale * 0.5

        pushWayfindingQuad(
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

        pushWayfindingQuad(
          positions,
          normals,
          uvs,
          indices,
          mx + dW * 0.5,
          metaCy,
          0.002,
          dW,
          effMetaH,
          lookupDistanceRect(layout, row.shownM),
          distPadPx,
        )
        mx += dW

        if (hasBack) {
          mx += mGap
          pushWayfindingQuad(
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
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  return geo
}

function buildRuntimeWayfindingFacesMerged(
  wf: SzjWayfinding,
  layout: SzjWayfindingAtlasLayout,
  floorY: number,
): { geom: THREE.BufferGeometry; triangles: number } {
  const parts: THREE.BufferGeometry[] = []
  for (const s of wf.signs) {
    const cy = floorY + s.bottomY + s.height * 0.5
    const off = s.depth * 0.5 + 0.005
    for (const face of s.faces) {
      const fg = buildRuntimeSingleFaceGeometry(face, s.width, s.height, layout)
      fg.rotateY(face.yaw)
      fg.translate(s.x + Math.sin(face.yaw) * off, cy, s.z + Math.cos(face.yaw) * off)
      parts.push(fg)
    }
  }
  return mergeBufferGeometries(parts)
}

interface CorridorSegmentInfo {
  readonly corrId: string
  readonly kind: SzjCorridor['kind']
  readonly ax: number
  readonly az: number
  readonly bx: number
  readonly bz: number
  readonly len: number
  readonly width: number
  readonly yaw: number
  readonly dirX: number
  readonly dirZ: number
  readonly rightX: number
  readonly rightZ: number
}

function pointInsideAnyAabb(px: number, pz: number, boxes: readonly Aabb2D[]): boolean {
  for (const b of boxes) {
    if (px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ) return true
  }
  return false
}

export interface CreateSzjIndoorSceneMeshOptions {
  readonly maxNpcs?: number
  readonly seed?: string | number
  readonly wayfinding?: SzjWayfinding
  readonly atmosPreset?: SzjAtmosPresetName
  readonly atmosSpec?: Partial<SzjAtmosRealitySpec>
}

/**
 * 构建十字街地下商业城（B1）独立三维场景：
 * - 天花板悬挂导视牌唯一数据源来自 `wayfinding`（`createWayfindingSignsGroup` 3 drawCalls：灯箱框 + 双吊杆 + 1:1 自发光牌面），
 *   彻底清零旧走廊墙牌（仅保留绿底安全出口疏散牌）；
 * - 吊顶格栅/风管/桥架/喷淋与冷暖照明氛围由 `createSzjAtmos` 统一驱动；
 * - 地面水磨石反射光泽与降饱和真实 PBR 材质由 `createShizijieMaterials` 提供。
 */
export function createSzjIndoorSceneContent(
  layout: SzjLayout,
  opts: CreateSzjIndoorSceneMeshOptions = {},
): SzjIndoorSceneHandle {
  const scene = new THREE.Scene()
  scene.name = 'szj-indoor-b1-scene'

  const floorY = SZJ_FRAME.indoorFloorY
  const ceilH = layout.ceilingHeight
  const wayfinding = opts.wayfinding ?? buildSzjWayfinding(layout)

  const atmos = createSzjAtmos(layout, {
    preset: opts.atmosPreset ?? 'real-guilin',
    spec: {
      ambientIntensity: 0.72,
      hemiIntensity: 0.94,
      keyLightIntensity: 0.74,
      plenumColor: '#3d4552',
      baffleColor: '#c6cdd6',
      baffleRingColor: '#d2cbc0',
      stairDaylightIntensity: 2.35,
      ...opts.atmosSpec,
    },
    floorY,
  })
  const restoreAtmosphere = atmos.applyAtmosphere(scene)
  scene.add(atmos.group)

  const matPack = createShizijieMaterials({ wayfinding })
  matPack.setLightingBoost(0.32)
  enhanceRuntimeSignAtlases(matPack)

  // `look/materials.ts` 内的 bindFloorUndergroundSheen 与 bindSignNonLitMask 已统一串联宿主
  // `THREE.Material.prototype.onBeforeCompile` 并改用顶点 varying，此处不再重复覆写。
  matPack.signAtlasMat.polygonOffset = true
  matPack.signAtlasMat.polygonOffsetFactor = -1
  matPack.signAtlasMat.polygonOffsetUnits = -2
  matPack.wayfindingMat.polygonOffset = true
  matPack.wayfindingMat.polygonOffsetFactor = -1
  matPack.wayfindingMat.polygonOffsetUnits = -2
  matPack.floorTerrazzo.polygonOffset = true
  matPack.floorTerrazzo.polygonOffsetFactor = -1
  matPack.floorTerrazzo.polygonOffsetUnits = -2
  matPack.canopyGlassBlue.side = THREE.DoubleSide

  const geometries: THREE.BufferGeometry[] = []
  const extraMaterials: THREE.Material[] = []
  const meshes: THREE.Mesh[] = []
  let triangleCount = 0

  const nosingMat = new THREE.MeshStandardMaterial({
    name: 'szj_stair_nosing_yellow',
    color: SHIZIJIE_PALETTE.stairNosingYellow.hex,
    emissive: SHIZIJIE_PALETTE.stairNosingYellow.hex,
    emissiveIntensity: 0.34,
    roughness: 0.44,
    metalness: 0.08,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  })
  const merchWarmMat = new THREE.MeshStandardMaterial({
    name: 'szj_merch_warm',
    color: '#9e2f3c',
    roughness: 0.72,
    metalness: 0.05,
  })
  const merchCoolMat = new THREE.MeshStandardMaterial({
    name: 'szj_merch_cool',
    color: '#2b476e',
    roughness: 0.7,
    metalness: 0.06,
  })
  const woodShelfMat = new THREE.MeshStandardMaterial({
    name: 'szj_wood_shelf',
    color: '#c7a072',
    roughness: 0.62,
    metalness: 0.06,
  })
  extraMaterials.push(nosingMat, merchWarmMat, merchCoolMat, woodShelfMat)

  const uvScaleOf = (mat: THREE.Material): readonly [number, number] => {
    const p = (mat.userData?.periodM as readonly [number, number] | undefined) ?? [1, 1]
    return [1 / Math.max(0.1, p[0]), 1 / Math.max(0.1, p[1])]
  }

  const addBatch = (
    name: string,
    specs: readonly OrientedBoxSpec[],
    material: THREE.Material,
  ): THREE.Mesh | null => {
    if (specs.length === 0) return null
    const { geom, triangles } = buildMergedOrientedBoxes(specs, uvScaleOf(material))
    triangleCount += triangles
    geometries.push(geom)
    const mesh = new THREE.Mesh(geom, material)
    mesh.name = name
    mesh.frustumCulled = false
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    scene.add(mesh)
    meshes.push(mesh)
    return mesh
  }

  const addMerged = (
    name: string,
    parts: THREE.BufferGeometry[],
    material: THREE.Material,
  ): THREE.Mesh | null => {
    if (parts.length === 0) return null
    const { geom, triangles } = mergeBufferGeometries(parts)
    triangleCount += triangles
    geometries.push(geom)
    const mesh = new THREE.Mesh(geom, material)
    mesh.name = name
    mesh.frustumCulled = false
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    scene.add(mesh)
    meshes.push(mesh)
    return mesh
  }

  const floorTerrazzoSpecs: OrientedBoxSpec[] = []
  const floorTileSpecs: OrientedBoxSpec[] = []
  const ceilingSpecs: OrientedBoxSpec[] = []
  const wallSpecs: OrientedBoxSpec[] = []
  const dadoSpecs: OrientedBoxSpec[] = []
  const columnSpecs: OrientedBoxSpec[] = []
  const lightWarmSpecs: OrientedBoxSpec[] = []
  const stairTreadSpecs: OrientedBoxSpec[] = []
  const stairNosingSpecs: OrientedBoxSpec[] = []
  const handrailSpecs: OrientedBoxSpec[] = []
  const canopyTrussSpecs: OrientedBoxSpec[] = []
  const canopyGlassSpecs: OrientedBoxSpec[] = []
  const guardrailWhiteSpecs: OrientedBoxSpec[] = []
  const bollardRedSpecs: OrientedBoxSpec[] = []
  const rackMetalSpecs: OrientedBoxSpec[] = []
  const shutterCreamSpecs: OrientedBoxSpec[] = []
  const shutterSilverSpecs: OrientedBoxSpec[] = []
  const glassSpecs: OrientedBoxSpec[] = []
  const woodSpecs: OrientedBoxSpec[] = []
  const merchWarmSpecs: OrientedBoxSpec[] = []
  const merchCoolSpecs: OrientedBoxSpec[] = []
  const shopSignGeos: THREE.BufferGeometry[] = []
  const safetyExitGeos: THREE.BufferGeometry[] = []
  let wallSafetyExitCount = 0

  // 1. Precompute corridor segments & shop doorway open aprons
  const corridorById = new Map<string, SzjCorridor>()
  const segs: CorridorSegmentInfo[] = []

  for (const corr of layout.corridors) {
    corridorById.set(corr.id, corr)
    for (let i = 0; i + 1 < corr.points.length; i++) {
      const a = corr.points[i]!
      const b = corr.points[i + 1]!
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len = Math.hypot(dx, dz)
      if (len < 0.05) continue
      const yaw = Math.atan2(dx, dz)
      const dirX = dx / len
      const dirZ = dz / len
      segs.push({
        corrId: corr.id,
        kind: corr.kind,
        ax: a.x,
        az: a.z,
        bx: b.x,
        bz: b.z,
        len,
        width: corr.width,
        yaw,
        dirX,
        dirZ,
        rightX: dirZ,
        rightZ: -dirX,
      })
    }
  }

  interface ResolvedShopPlacement {
    readonly shop: SzjShop
    readonly box: Aabb2D
    readonly facingZ: boolean
    readonly outwardSign: 1 | -1
    readonly facadeCoord: number
    readonly frontSpan: number
    readonly depthSpan: number
    readonly openApron: Aabb2D
  }

  const shopPlacements: ResolvedShopPlacement[] = []
  const shopAprons: Aabb2D[] = []

  for (const shop of layout.shops) {
    const sb = rectToAabb(shop.id, shop.rect)
    const frontCorr = corridorById.get(shop.frontage)
    const near = frontCorr ? closestPointOnCorridor(shop.rect.x, shop.rect.z, frontCorr) : { x: shop.rect.x, z: shop.rect.z }
    const dx = near.x - shop.rect.x
    const dz = near.z - shop.rect.z
    const facingZ = Math.abs(dz) >= Math.abs(dx)
    const outwardSign: 1 | -1 = facingZ ? (dz >= 0 ? 1 : -1) : dx >= 0 ? 1 : -1
    const frontSpan = facingZ ? shop.rect.w : shop.rect.d
    const depthSpan = facingZ ? shop.rect.d : shop.rect.w
    const facadeCoord = facingZ
      ? outwardSign > 0
        ? sb.maxZ
        : sb.minZ
      : outwardSign > 0
        ? sb.maxX
        : sb.minX

    const apronPad = 0.85
    const openApron: Aabb2D = facingZ
      ? {
          id: `${shop.id}-apron`,
          minX: sb.minX + 0.08,
          maxX: sb.maxX - 0.08,
          minZ: Math.min(shop.rect.z, near.z) - apronPad,
          maxZ: Math.max(shop.rect.z, near.z) + apronPad,
        }
      : {
          id: `${shop.id}-apron`,
          minX: Math.min(shop.rect.x, near.x) - apronPad,
          maxX: Math.max(shop.rect.x, near.x) + apronPad,
          minZ: sb.minZ + 0.08,
          maxZ: sb.maxZ - 0.08,
        }

    shopAprons.push(openApron, sb)
    shopPlacements.push({
      shop,
      box: sb,
      facingZ,
      outwardSign,
      facadeCoord,
      frontSpan,
      depthSpan,
      openApron,
    })
  }

  // 2. Full B1 sub-floor & stairwell-cutout ceiling plenum + sealed corridor walls & wayfinding signage
  const mallMinX = layout.bounds.minX - 6
  const mallMaxX = layout.bounds.maxX + 6
  const mallMinZ = layout.bounds.minZ - 6
  const mallMaxZ = layout.bounds.maxZ + 6
  const wallTopH = ceilH + 0.1
  const dadoH = 1.04
  const upperWallH = Math.max(0.2, wallTopH - dadoH)
  const upperWallCy = floorY + dadoH + upperWallH * 0.5

  const pushSplitWall = (cx: number, cz: number, sx: number, sz: number, yaw = 0): void => {
    dadoSpecs.push({
      cx,
      cy: floorY + dadoH * 0.5,
      cz,
      sx,
      sy: dadoH,
      sz,
      yaw,
    })
    wallSpecs.push({
      cx,
      cy: upperWallCy,
      cz,
      sx,
      sy: upperWallH,
      sz,
      yaw,
    })
  }

  // Single continuous flat B1 sub-floor slab with top surface flush at y = floorY
  floorTileSpecs.push({
    cx: (mallMinX + mallMaxX) * 0.5,
    cy: floorY - 0.06,
    cz: (mallMinZ + mallMaxZ) * 0.5,
    sx: mallMaxX - mallMinX,
    sy: 0.12,
    sz: mallMaxZ - mallMinZ,
  })

  const stairShaftBoxes = SZJ_STAIRWELLS.map(st => {
    const hw = st.width * 0.5 + 0.3
    const hl = st.length * 0.5 + 0.55
    const cosY = Math.abs(Math.cos(st.yaw))
    const sinY = Math.abs(Math.sin(st.yaw))
    const spanX = hw * cosY + hl * sinY
    const spanZ = hw * sinY + hl * cosY
    return {
      st,
      minX: st.indoor.x - spanX,
      maxX: st.indoor.x + spanX,
      minZ: st.indoor.z - spanZ,
      maxZ: st.indoor.z + spanZ,
    }
  })

  const isInsideAnyStairShaft = (px: number, pz: number, margin = 0): boolean => {
    for (const st of SZJ_STAIRWELLS) {
      const local = indoorToStairLocal(st, { x: px, z: pz })
      const hw = st.width * 0.5
      const hl = st.length * 0.5
      if (
        Math.abs(local.x) <= hw + 0.04 + margin &&
        local.z >= -hl - 0.45 - margin &&
        local.z <= hl + 0.05 + margin
      ) {
        return true
      }
    }
    return false
  }

  const emitCeilingPlenumQuad = (x0: number, x1: number, z0: number, z1: number, depth: number): void => {
    const cx = (x0 + x1) * 0.5
    const cz = (z0 + z1) * 0.5
    const sx = x1 - x0
    const sz = z1 - z0
    if (sx <= 0.05 || sz <= 0.05) return

    let overlapsShaftBox = false
    for (const sb of stairShaftBoxes) {
      if (x1 >= sb.minX && x0 <= sb.maxX && z1 >= sb.minZ && z0 <= sb.maxZ) {
        overlapsShaftBox = true
        break
      }
    }
    if (!overlapsShaftBox) {
      ceilingSpecs.push({
        cx,
        cy: floorY + ceilH + 0.088,
        cz,
        sx: sx + 0.04,
        sy: 0.1,
        sz: sz + 0.04,
      })
      return
    }

    const hitC = isInsideAnyStairShaft(cx, cz, 0.22)
    const hit00 = isInsideAnyStairShaft(x0, z0, 0.22)
    const hit10 = isInsideAnyStairShaft(x1, z0, 0.22)
    const hit01 = isInsideAnyStairShaft(x0, z1, 0.22)
    const hit11 = isInsideAnyStairShaft(x1, z1, 0.22)
    if (hitC && hit00 && hit10 && hit01 && hit11) return

    if (depth < 8 && Math.max(sx, sz) > 0.45) {
      const mx = cx
      const mz = cz
      emitCeilingPlenumQuad(x0, mx, z0, mz, depth + 1)
      emitCeilingPlenumQuad(mx, x1, z0, mz, depth + 1)
      emitCeilingPlenumQuad(x0, mx, mz, z1, depth + 1)
      emitCeilingPlenumQuad(mx, x1, mz, z1, depth + 1)
      return
    }

    if (!hitC) {
      ceilingSpecs.push({
        cx,
        cy: floorY + ceilH + 0.088,
        cz,
        sx: sx + 0.08,
        sy: 0.1,
        sz: sz + 0.08,
      })
    }
  }
  emitCeilingPlenumQuad(mallMinX, mallMaxX, mallMinZ, mallMaxZ, 0)

  const pointInsideCorridorWalkway = (
    px: number,
    pz: number,
    shrink = 0.04,
    skipSegIdx = -1,
  ): boolean => {
    for (let j = 0; j < segs.length; j++) {
      if (j === skipSegIdx) continue
      const other = segs[j]!
      const hit = closestPointOnSegment(px, pz, other.ax, other.az, other.bx, other.bz)
      const allow = Math.max(0.05, other.width * 0.5 - shrink)
      if (hit.distSq < allow * allow) return true
    }
    return false
  }

  const isPointOpenEverywhere = (px: number, pz: number, stairPad = 0.35): boolean => {
    if (pointInsideCorridorWalkway(px, pz, 0.04)) return true
    if (locateStairwellAt(px, pz, stairPad)) return true
    if (pointInsideAnyAabb(px, pz, shopAprons)) return true
    return false
  }

  const isCapOpenAt = (px: number, pz: number, selfSegIdx: number): boolean => {
    if (pointInsideCorridorWalkway(px, pz, -0.18, selfSegIdx)) return true
    if (locateStairwellAt(px, pz, 0.35)) return true
    if (pointInsideAnyAabb(px, pz, shopAprons)) return true
    return false
  }

  const wallT = 0.18
  const vertexMaxWidth = new Map<string, { x: number; z: number; width: number }>()
  const registerVertex = (vx: number, vz: number, w: number) => {
    const key = `${Math.round(vx * 5)}:${Math.round(vz * 5)}`
    const prev = vertexMaxWidth.get(key)
    if (!prev || w > prev.width) {
      vertexMaxWidth.set(key, { x: vx, z: vz, width: w })
    }
  }

  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si]!
    const midX = (seg.ax + seg.bx) * 0.5
    const midZ = (seg.az + seg.bz) * 0.5

    registerVertex(seg.ax, seg.az, seg.width)
    registerVertex(seg.bx, seg.bz, seg.width)

    // Flush 1mm terrazzo inlay on ring concourse (polygonOffset eliminates Z-fighting with zero visible step seam)
    if (seg.kind === 'ring') {
      floorTerrazzoSpecs.push({
        cx: midX,
        cy: floorY - 0.059,
        cz: midZ,
        sx: seg.width + 0.12,
        sy: 0.12,
        sz: seg.len + seg.width * 0.42,
        yaw: seg.yaw,
      })
    }

    const stepM = 0.42
    const steps = Math.max(1, Math.ceil(seg.len / stepM))
    const ds = seg.len / steps

    for (const side of [-1, 1] as const) {
      let runStart: number | null = null
      const flushWall = (endS: number) => {
        if (runStart === null || endS - runStart < 0.08) {
          runStart = null
          return
        }
        const sMid = (runStart + endS) * 0.5
        const runLen = endS - runStart
        const off = side * (seg.width * 0.5 + wallT * 0.5)
        const wx = seg.ax + seg.dirX * sMid + seg.rightX * off
        const wz = seg.az + seg.dirZ * sMid + seg.rightZ * off
        pushSplitWall(wx, wz, wallT, runLen + 0.04, seg.yaw)
        runStart = null
      }

      for (let k = 0; k < steps; k++) {
        const s0 = k * ds
        const s1 = s0 + ds
        const sm = (s0 + s1) * 0.5
        const probeOff = side * (seg.width * 0.5 + 0.22)
        const px = seg.ax + seg.dirX * sm + seg.rightX * probeOff
        const pz = seg.az + seg.dirZ * sm + seg.rightZ * probeOff
        if (isPointOpenEverywhere(px, pz, 0.35)) {
          flushWall(s0)
        } else if (runStart === null) {
          runStart = s0
        }
      }
      flushWall(seg.len)
    }

    // Dead-end bulkhead cap walls whenever a segment end is enclosed
    for (const sCap of [-wallT * 0.5, seg.len + wallT * 0.5] as const) {
      const capHalfW = seg.width * 0.5 + wallT * 0.6
      const latSteps = Math.max(4, Math.ceil((capHalfW * 2) / 0.42))
      const dLat = (capHalfW * 2) / latSteps
      let capRunStart: number | null = null
      const flushCap = (endLat: number) => {
        if (capRunStart === null || endLat - capRunStart < 0.08) {
          capRunStart = null
          return
        }
        const latMid = (capRunStart + endLat) * 0.5
        const runW = endLat - capRunStart
        const wx = seg.ax + seg.dirX * sCap + seg.rightX * latMid
        const wz = seg.az + seg.dirZ * sCap + seg.rightZ * latMid
        pushSplitWall(wx, wz, runW + 0.04, wallT, seg.yaw)
        capRunStart = null
      }
      for (let lk = 0; lk < latSteps; lk++) {
        const l0 = -capHalfW + lk * dLat
        const lm = l0 + dLat * 0.5
        const px = seg.ax + seg.dirX * sCap + seg.rightX * lm
        const pz = seg.az + seg.dirZ * sCap + seg.rightZ * lm
        if (isCapOpenAt(px, pz, si)) {
          flushCap(l0)
        } else if (capRunStart === null) {
          capRunStart = l0
        }
      }
      flushCap(capHalfW)
    }
  }

  // Deduplicated outer corner seal facets (1 non-overlapping split ring per unique corridor vertex)
  const arcCount = 12
  const arcStep = (Math.PI * 2) / arcCount
  for (const vtx of vertexMaxWidth.values()) {
    if (locateStairwellAt(vtx.x, vtx.z, 0.55)) continue
    const arcRadius = vtx.width * 0.5 + wallT * 0.5
    const chordW = 2 * arcRadius * Math.sin(arcStep * 0.5) + 0.04
    for (let ai = 0; ai < arcCount; ai++) {
      const theta = (ai + 0.5) * arcStep
      const nx = Math.sin(theta)
      const nz = Math.cos(theta)
      const px = vtx.x + nx * (arcRadius + 0.08)
      const pz = vtx.z + nz * (arcRadius + 0.08)
      if (isPointOpenEverywhere(px, pz, 0.75)) continue
      const wx = vtx.x + nx * arcRadius
      const wz = vtx.z + nz * arcRadius
      pushSplitWall(wx, wz, chordW, wallT, theta)
    }
  }

  // 3. Structural atrium columns
  if (layout.columns.size > 0) {
    const cSize = layout.columns.size
    for (const cx of layout.columns.xs) {
      for (const cz of layout.columns.zs) {
        if (locateStairwellAt(cx, cz, 0.8)) continue
        columnSpecs.push({
          cx,
          cy: floorY + ceilH * 0.5,
          cz,
          sx: cSize,
          sy: ceilH,
          sz: cSize,
        })
        dadoSpecs.push({
          cx,
          cy: floorY + 0.14,
          cz,
          sx: cSize + 0.14,
          sy: 0.28,
          sz: cSize + 0.14,
        })
      }
    }
  }

  // 4. Four rotated 28-step stairwells (nw, ne, se, sw) with granite walls, handrails, canopy & exit lightboxes
  const buildStairwellGeometry = (st: SzjStairwell) => {
    const hw = st.width * 0.5
    const hl = st.length * 0.5
    const topLanding = st.profile.landingTop
    const footLanding = st.profile.landingFoot
    const riser = st.profile.riser
    const tread = st.profile.tread
    const count = st.profile.count
    const topY = SZJ_FRAME.depth

    const toWorld = (lx: number, lz: number) => stairLocalToIndoor(st, { x: lx, z: lz })

    // Top landing slab & open street-level sidewalk plaza apron outside -Z mouth
    const streetApron = toWorld(0, -hl + topLanding * 0.5 - 3.1)
    floorTileSpecs.push({
      cx: streetApron.x,
      cy: topY - 0.06,
      cz: streetApron.z,
      sx: st.width + 6.4,
      sy: 0.12,
      sz: topLanding + 6.8,
      yaw: st.yaw,
    })

    // Rotated stairwell ceiling perimeter collars sealing shaft opening to ceiling plenum without Z-fighting
    for (const side of [-1, 1] as const) {
      const collarPos = toWorld(side * (hw + 0.96), 0)
      ceilingSpecs.push({
        cx: collarPos.x,
        cy: floorY + ceilH + 0.068,
        cz: collarPos.z,
        sx: 1.88,
        sy: 0.11,
        sz: st.length + 1.6,
        yaw: st.yaw,
      })
    }
    const footCollar = toWorld(0, hl + 0.95)
    ceilingSpecs.push({
      cx: footCollar.x,
      cy: floorY + ceilH + 0.068,
      cz: footCollar.z,
      sx: st.width + 3.6,
      sy: 0.11,
      sz: 1.75,
      yaw: st.yaw,
    })

    // 28 physical granite steps + front-lip L-profile safety yellow nosings (+Z front edge so all 28 steps stay crisp from bottom & top)
    const topEdgeLz = -hl + topLanding
    const topLipNose = toWorld(0, topEdgeLz - 0.02)
    const topLipBack = toWorld(0, topEdgeLz - 0.07)
    canopyTrussSpecs.push({
      cx: topLipBack.x,
      cy: topY + 0.004,
      cz: topLipBack.z,
      sx: st.width - 0.04,
      sy: 0.012,
      sz: 0.044,
      yaw: st.yaw,
    })
    stairNosingSpecs.push({
      cx: topLipNose.x,
      cy: topY - 0.011,
      cz: topLipNose.z,
      sx: st.width - 0.06,
      sy: 0.038,
      sz: 0.056,
      yaw: st.yaw,
    })

    for (let i = 0; i < count; i++) {
      const stepTopY = topY - (i + 1) * riser
      const lzFront = -hl + topLanding + (i + 1) * tread
      const lzCenter = lzFront - tread * 0.5
      const pStep = toWorld(0, lzCenter - 0.006)
      const stepH = riser + 0.08
      stairTreadSpecs.push({
        cx: pStep.x,
        cy: stepTopY - stepH * 0.5,
        cz: pStep.z,
        sx: st.width,
        sy: stepH,
        sz: tread + 0.012,
        yaw: st.yaw,
      })

      const pBack = toWorld(0, lzFront - 0.07)
      canopyTrussSpecs.push({
        cx: pBack.x,
        cy: stepTopY + 0.004,
        cz: pBack.z,
        sx: st.width - 0.04,
        sy: 0.012,
        sz: 0.044,
        yaw: st.yaw,
      })

      const pNose = toWorld(0, lzFront - 0.02)
      stairNosingSpecs.push({
        cx: pNose.x,
        cy: stepTopY - 0.011,
        cz: pNose.z,
        sx: st.width - 0.06,
        sy: 0.038,
        sz: 0.056,
        yaw: st.yaw,
      })
    }

    // Below-grade granite retaining walls + low 0.22m street curb & B1 inner throat spandrel
    const wallThick = 0.24
    const curbH = 0.22
    const retainTopY = topY + curbH
    const totalStairLen = st.length + footLanding + 0.6
    const midWallLz = (-hl - 0.4 + hl + footLanding + 0.2) * 0.5
    const wallTopY = topY + 2.75
    const spandrelLen = footLanding + 2.4
    const spandrelMidLz = hl + footLanding + 0.2 - spandrelLen * 0.5
    for (const side of [-1, 1] as const) {
      const pw = toWorld(side * (hw + wallThick * 0.5), midWallLz)
      dadoSpecs.push({
        cx: pw.x,
        cy: retainTopY * 0.5,
        cz: pw.z,
        sx: wallThick,
        sy: retainTopY,
        sz: totalStairLen,
        yaw: st.yaw,
      })
      const spPos = toWorld(side * (hw + wallThick * 0.5), spandrelMidLz)
      dadoSpecs.push({
        cx: spPos.x,
        cy: retainTopY + (wallTopY - retainTopY) * 0.5,
        cz: spPos.z,
        sx: wallThick,
        sy: wallTopY - retainTopY,
        sz: spandrelLen,
        yaw: st.yaw,
      })
    }

    // Prominent above-grade white protective balustrades + street-mouth return wing rails
    const railH = 0.88
    const sideRailLen = st.length * 0.82
    const sideRailMidLz = -hl - 0.18 + sideRailLen * 0.5
    for (const side of [-1, 1] as const) {
      const rx = side * (hw + 0.04)
      const railCenter = toWorld(rx, sideRailMidLz)
      guardrailWhiteSpecs.push(
        {
          cx: railCenter.x,
          cy: retainTopY + railH - 0.035,
          cz: railCenter.z,
          sx: 0.09,
          sy: 0.07,
          sz: sideRailLen,
          yaw: st.yaw,
        },
        {
          cx: railCenter.x,
          cy: retainTopY + railH * 0.56,
          cz: railCenter.z,
          sx: 0.06,
          sy: 0.05,
          sz: sideRailLen,
          yaw: st.yaw,
        },
        {
          cx: railCenter.x,
          cy: retainTopY + railH * 0.24,
          cz: railCenter.z,
          sx: 0.05,
          sy: 0.04,
          sz: sideRailLen,
          yaw: st.yaw,
        },
      )
      for (let pi = 0; pi < 8; pi++) {
        const zp = -hl - 0.16 + (pi / 7) * (sideRailLen - 0.08)
        const postPos = toWorld(rx, zp)
        guardrailWhiteSpecs.push({
          cx: postPos.x,
          cy: retainTopY + railH * 0.5,
          cz: postPos.z,
          sx: 0.075,
          sy: railH,
          sz: 0.075,
          yaw: st.yaw,
        })
      }

      // Street-mouth return wing white balustrade visibly framing left & right corners of top landing
      const wingW = 0.72
      const wingCenterLx = side * (hw - 0.24 + wingW * 0.5)
      const wingCenter = toWorld(wingCenterLx, -hl - 0.18)
      const innerPost = toWorld(side * (hw - 0.24), -hl - 0.18)
      guardrailWhiteSpecs.push(
        {
          cx: wingCenter.x,
          cy: retainTopY + railH - 0.035,
          cz: wingCenter.z,
          sx: wingW,
          sy: 0.07,
          sz: 0.09,
          yaw: st.yaw,
        },
        {
          cx: wingCenter.x,
          cy: retainTopY + railH * 0.56,
          cz: wingCenter.z,
          sx: wingW,
          sy: 0.05,
          sz: 0.06,
          yaw: st.yaw,
        },
        {
          cx: innerPost.x,
          cy: retainTopY + railH * 0.5,
          cz: innerPost.z,
          sx: 0.075,
          sy: railH,
          sz: 0.075,
          yaw: st.yaw,
        },
      )
    }

    // Steel canopy columns, transverse purlins & longitudinal rafters supporting sloped blue-glass canopy roof
    const canopyFrontLz = -hl - 0.55
    const canopyBackLz = hl * 0.62
    const canopyLen = canopyBackLz - canopyFrontLz
    const canopyMidLz = (canopyFrontLz + canopyBackLz) * 0.5
    const frontRoofY = topY + 2.24
    const backRoofY = topY + 1.66
    const roofSpanY = frontRoofY - backRoofY
    const canopySlope = Math.atan2(roofSpanY, canopyLen)
    const canopyDiagLen = Math.hypot(canopyLen, roofSpanY)
    const canopyMidY = (frontRoofY + backRoofY) * 0.5

    for (const frac of [0, 0.25, 0.5, 0.75, 1] as const) {
      const zc = canopyFrontLz + frac * canopyLen
      const colTopY = frontRoofY - frac * roofSpanY
      const colH = colTopY - retainTopY
      for (const side of [-1, 1] as const) {
        const cPos = toWorld(side * (hw + wallThick * 0.5), zc)
        canopyTrussSpecs.push({
          cx: cPos.x,
          cy: retainTopY + colH * 0.5,
          cz: cPos.z,
          sx: 0.11,
          sy: colH,
          sz: 0.11,
          yaw: st.yaw,
        })
      }
      const purlinPos = toWorld(0, zc)
      canopyTrussSpecs.push({
        cx: purlinPos.x,
        cy: colTopY - 0.045,
        cz: purlinPos.z,
        sx: st.width + wallThick * 2 + 0.32,
        sy: 0.09,
        sz: 0.11,
        yaw: st.yaw,
      })
    }

    for (const rafterLx of [-hw * 0.66, 0, hw * 0.66] as const) {
      const rPos = toWorld(rafterLx, canopyMidLz)
      canopyTrussSpecs.push({
        cx: rPos.x,
        cy: canopyMidY - 0.04,
        cz: rPos.z,
        sx: 0.08,
        sy: 0.08,
        sz: canopyDiagLen,
        yaw: st.yaw,
        pitch: canopySlope,
      })
    }

    // Sloped stainless steel double handrails + 7 vertical stanchion posts & wall-mount brackets per side
    const flightLen = count * tread
    const flightDiag = Math.hypot(flightLen, topY - floorY)
    const flightPitch = Math.atan2(topY - floorY, flightLen)
    const midFlightLz = -hl + topLanding + flightLen * 0.5
    const midFlightY = (topY + floorY) * 0.5
    const postStepIndices = [0, 4, 9, 14, 18, 23, 27] as const
    for (const side of [-1, 1] as const) {
      const railLx = side * (hw - 0.08)
      const pr = toWorld(railLx, midFlightLz)
      handrailSpecs.push(
        {
          cx: pr.x,
          cy: midFlightY + 0.92,
          cz: pr.z,
          sx: 0.05,
          sy: 0.05,
          sz: flightDiag,
          yaw: st.yaw,
          pitch: flightPitch,
        },
        {
          cx: pr.x,
          cy: midFlightY + 0.54,
          cz: pr.z,
          sx: 0.035,
          sy: 0.035,
          sz: flightDiag,
          yaw: st.yaw,
          pitch: flightPitch,
        },
      )
      for (const siStep of postStepIndices) {
        const sTopY = topY - (siStep + 1) * riser
        const sLz = -hl + topLanding + (siStep + 0.5) * tread
        const postWorld = toWorld(railLx, sLz)
        const postH = 0.92 + riser * 0.5
        const bracketWorld = toWorld(side * (hw - 0.04), sLz)
        handrailSpecs.push(
          {
            cx: postWorld.x,
            cy: sTopY + postH * 0.5,
            cz: postWorld.z,
            sx: 0.042,
            sy: postH,
            sz: 0.042,
            yaw: st.yaw,
          },
          {
            cx: bracketWorld.x,
            cy: sTopY + 0.9,
            cz: bracketWorld.z,
            sx: 0.1,
            sy: 0.04,
            sz: 0.045,
            yaw: st.yaw,
          },
          {
            cx: bracketWorld.x,
            cy: sTopY + 0.52,
            cz: bracketWorld.z,
            sx: 0.1,
            sy: 0.035,
            sz: 0.04,
            yaw: st.yaw,
          },
        )
      }
    }

    // Open sloped blue-glass surface canopy roof + street fascia + 3 red-and-white striped safety bollards
    const canopyCenter = toWorld(0, canopyMidLz)
    canopyGlassSpecs.push({
      cx: canopyCenter.x,
      cy: canopyMidY + 0.02,
      cz: canopyCenter.z,
      sx: st.width + wallThick * 2 + 0.36,
      sy: 0.05,
      sz: canopyDiagLen + 0.2,
      yaw: st.yaw,
      pitch: canopySlope,
    })

    const mouthBeamPos = toWorld(0, canopyFrontLz)
    canopyTrussSpecs.push({
      cx: mouthBeamPos.x,
      cy: frontRoofY - 0.14,
      cz: mouthBeamPos.z,
      sx: st.width + wallThick * 2 + 0.34,
      sy: 0.24,
      sz: 0.13,
      yaw: st.yaw,
    })
    for (const bx of [-0.88, 0, 0.88] as const) {
      const bPos = toWorld(bx, -hl - 0.42)
      handrailSpecs.push({
        cx: bPos.x,
        cy: topY + 0.46,
        cz: bPos.z,
        sx: 0.14,
        sy: 0.92,
        sz: 0.14,
        yaw: st.yaw,
      })
      bollardRedSpecs.push(
        {
          cx: bPos.x,
          cy: topY + 0.32,
          cz: bPos.z,
          sx: 0.156,
          sy: 0.18,
          sz: 0.156,
          yaw: st.yaw,
        },
        {
          cx: bPos.x,
          cy: topY + 0.72,
          cz: bPos.z,
          sx: 0.156,
          sy: 0.18,
          sz: 0.156,
          yaw: st.yaw,
        },
      )
      guardrailWhiteSpecs.push(
        {
          cx: bPos.x,
          cy: topY + 0.52,
          cz: bPos.z,
          sx: 0.152,
          sy: 0.15,
          sz: 0.152,
          yaw: st.yaw,
        },
        {
          cx: bPos.x,
          cy: topY + 0.87,
          cz: bPos.z,
          sx: 0.152,
          sy: 0.1,
          sz: 0.152,
          yaw: st.yaw,
        },
      )
    }

    // Overhead structural soffit header at B1 stairwell throat (wayfinding signs inside B1 come 100% from wayfinding.signs)
    const portalPos = toWorld(0, hl + 0.15)
    const soffitH = Math.max(0.45, wallTopY - ceilH)
    canopyTrussSpecs.push({
      cx: portalPos.x,
      cy: ceilH + soffitH * 0.5 - 0.04,
      cz: portalPos.z,
      sx: st.width + wallThick * 2,
      sy: soffitH + 0.12,
      sz: 0.24,
      yaw: st.yaw,
    })

    // Wing wall seals bridging narrower stairwell granite walls to wider entry corridor walls
    for (const side of [-1, 1] as const) {
      const wingPos = toWorld(side * (hw + wallThick + 0.52), hl + 0.08)
      pushSplitWall(wingPos.x, wingPos.z, 1.06, 0.22, st.yaw)
    }

    // Mid-flight stairwell safety/caution bar (green safetyExit + yellow stairCaution) with steel cross-beam & 4 rods
    const midLz = -0.35
    const midSignPos = toWorld(0, midLz)
    const midSignY = 4.44
    const midCrossBeamY = 5.18
    const midRoofFrac = Math.max(0, Math.min(1, (midLz - canopyFrontLz) / canopyLen))
    const midRoofY = frontRoofY - midRoofFrac * roofSpanY
    const midRodBottomY = midSignY + 0.2
    const midRodH = Math.max(0.25, midRoofY - midRodBottomY)
    canopyTrussSpecs.push(
      {
        cx: midSignPos.x,
        cy: midSignY,
        cz: midSignPos.z,
        sx: st.width - 0.14,
        sy: 0.4,
        sz: 0.08,
        yaw: st.yaw,
      },
      {
        cx: midSignPos.x,
        cy: midCrossBeamY,
        cz: midSignPos.z,
        sx: st.width + wallThick * 2,
        sy: 0.095,
        sz: 0.11,
        yaw: st.yaw,
      },
    )
    for (const rodLx of [-1.1, -0.34, 0.38, 1.1] as const) {
      const mRod = toWorld(rodLx, midLz)
      canopyTrussSpecs.push({
        cx: mRod.x,
        cy: midRodBottomY + midRodH * 0.5,
        cz: mRod.z,
        sx: 0.065,
        sy: midRodH,
        sz: 0.065,
        yaw: st.yaw,
      })
    }
    const midLeft = toWorld(-0.96, midLz)
    const midCenter = toWorld(0.04, midLz)
    const midRight = toWorld(0.96, midLz)
    safetyExitGeos.push(
      ...makeDoubleSidedSignPlanes(midLeft.x, midSignY, midLeft.z, 1.08, 0.38, st.yaw, 0.08, 'safetyExit'),
      ...makeDoubleSidedSignPlanes(midCenter.x, midSignY, midCenter.z, 0.78, 0.38, st.yaw, 0.08, 'stairCaution'),
      ...makeDoubleSidedSignPlanes(midRight.x, midSignY, midRight.z, 0.9, 0.38, st.yaw, 0.08, 'safetyExit'),
    )

    // Wall-mounted backlit green safetyExit plaques along lower stair granite walls (+0.039m normal offset)
    for (const side of [-1, 1] as const) {
      const wallSignPos = toWorld(side * (hw - 0.03), hl - 1.1)
      const wallYaw = st.yaw + (side > 0 ? -Math.PI * 0.5 : Math.PI * 0.5)
      const wNormX = Math.sin(wallYaw)
      const wNormZ = Math.cos(wallYaw)
      const wFrontOff = 0.039
      canopyTrussSpecs.push({
        cx: wallSignPos.x,
        cy: floorY + 1.85,
        cz: wallSignPos.z,
        sx: 0.92,
        sy: 0.34,
        sz: 0.05,
        yaw: wallYaw,
      })
      safetyExitGeos.push(
        makeSignPlane(
          wallSignPos.x + wNormX * wFrontOff,
          floorY + 1.85,
          wallSignPos.z + wNormZ * wFrontOff,
          0.86,
          0.3,
          wallYaw,
          'safetyExit',
        ),
      )
      wallSafetyExitCount += 1
    }
  }

  for (const st of SZJ_STAIRWELLS) {
    buildStairwellGeometry(st)
  }

  // 5. 24~36 Shops & Stalls with illuminated signboards, display windows, grounded H-base garment racks & warm shelves
  const lintelBottomY = Math.min(2.38, ceilH - 0.52)
  const lintelH = ceilH - lintelBottomY

  for (let i = 0; i < shopPlacements.length; i++) {
    const sp = shopPlacements[i]!
    const { shop, box: sb, facingZ, outwardSign, facadeCoord, frontSpan, depthSpan } = sp

    floorTerrazzoSpecs.push({
      cx: shop.rect.x,
      cy: floorY - 0.059,
      cz: shop.rect.z,
      sx: shop.rect.w + 0.12,
      sy: 0.12,
      sz: shop.rect.d + 0.12,
    })
    ceilingSpecs.push({
      cx: shop.rect.x,
      cy: floorY + ceilH + 0.05,
      cz: shop.rect.z,
      sx: shop.rect.w + 0.16,
      sy: 0.1,
      sz: shop.rect.d + 0.16,
    })

    const wThick = 0.12
    const shopLintelH = wallTopH - lintelBottomY
    if (facingZ) {
      const backZ = outwardSign > 0 ? sb.minZ - wThick * 0.5 : sb.maxZ + wThick * 0.5
      pushSplitWall(shop.rect.x, backZ, shop.rect.w + wThick * 2, wThick)
      pushSplitWall(sb.minX - wThick * 0.5, shop.rect.z, wThick, shop.rect.d)
      pushSplitWall(sb.maxX + wThick * 0.5, shop.rect.z, wThick, shop.rect.d)
      wallSpecs.push({
        cx: shop.rect.x,
        cy: lintelBottomY + shopLintelH * 0.5,
        cz: facadeCoord,
        sx: shop.rect.w,
        sy: shopLintelH,
        sz: 0.14,
      })
      for (const jx of [sb.minX - wThick * 0.5, sb.maxX + wThick * 0.5] as const) {
        for (let stepD = 0.16; stepD <= 2.8; stepD += 0.28) {
          const jz = facadeCoord + outwardSign * stepD
          if (pointInsideCorridorWalkway(jx, jz, 0.12) || locateStairwellAt(jx, jz, 0.25)) break
          pushSplitWall(jx, jz, wThick, 0.3)
        }
      }
    } else {
      const backX = outwardSign > 0 ? sb.minX - wThick * 0.5 : sb.maxX + wThick * 0.5
      pushSplitWall(backX, shop.rect.z, wThick, shop.rect.d + wThick * 2)
      pushSplitWall(shop.rect.x, sb.minZ - wThick * 0.5, shop.rect.w, wThick)
      pushSplitWall(shop.rect.x, sb.maxZ + wThick * 0.5, shop.rect.w, wThick)
      wallSpecs.push({
        cx: facadeCoord,
        cy: lintelBottomY + shopLintelH * 0.5,
        cz: shop.rect.z,
        sx: 0.14,
        sy: shopLintelH,
        sz: shop.rect.d,
      })
      for (const jz of [sb.minZ - wThick * 0.5, sb.maxZ + wThick * 0.5] as const) {
        for (let stepD = 0.16; stepD <= 2.8; stepD += 0.28) {
          const jx = facadeCoord + outwardSign * stepD
          if (pointInsideCorridorWalkway(jx, jz, 0.12) || locateStairwellAt(jx, jz, 0.25)) break
          pushSplitWall(jx, jz, 0.3, wThick)
        }
      }
    }

    // Interior warm ceiling light, back wood shelf, low counter & twin open-threshold grounded H-base garment racks
    const backCoord = facingZ
      ? (outwardSign > 0 ? sb.minZ : sb.maxZ) + outwardSign * 0.22
      : (outwardSign > 0 ? sb.minX : sb.maxX) + outwardSign * 0.22
    const deepMidCoord = facadeCoord - outwardSign * Math.min(0.92, depthSpan * 0.46)
    const rackFrontCoord = facadeCoord - outwardSign * 0.1
    const shelfLen = Math.max(0.9, frontSpan - 0.45)
    const winSpan = Math.max(0.28, frontSpan * 0.15)
    const rackSpan = Math.max(0.58, frontSpan * 0.28)
    const rackTopY = 1.38

    if (facingZ) {
      lightWarmSpecs.push({
        cx: shop.rect.x,
        cy: lintelBottomY - 0.04,
        cz: facadeCoord - outwardSign * 0.28,
        sx: Math.max(0.8, frontSpan - 0.4),
        sy: 0.04,
        sz: 0.16,
      })
      woodSpecs.push(
        { cx: shop.rect.x, cy: 0.42, cz: backCoord, sx: shelfLen, sy: 0.84, sz: 0.28 },
        { cx: shop.rect.x, cy: 1.45, cz: backCoord, sx: shelfLen, sy: 0.05, sz: 0.26 },
      )
      for (const wingSign of [-1, 1] as const) {
        const rackCx = shop.rect.x + wingSign * frontSpan * 0.26
        rackMetalSpecs.push(
          { cx: rackCx, cy: rackTopY, cz: rackFrontCoord, sx: rackSpan, sy: 0.042, sz: 0.042 },
          { cx: rackCx - rackSpan * 0.47, cy: rackTopY * 0.5, cz: rackFrontCoord, sx: 0.046, sy: rackTopY, sz: 0.046 },
          { cx: rackCx + rackSpan * 0.47, cy: rackTopY * 0.5, cz: rackFrontCoord, sx: 0.046, sy: rackTopY, sz: 0.046 },
          { cx: rackCx, cy: 0.045, cz: rackFrontCoord, sx: rackSpan, sy: 0.038, sz: 0.052 },
          { cx: rackCx - rackSpan * 0.47, cy: 0.022, cz: rackFrontCoord, sx: 0.07, sy: 0.044, sz: 0.36 },
          { cx: rackCx + rackSpan * 0.47, cy: 0.022, cz: rackFrontCoord, sx: 0.07, sy: 0.044, sz: 0.36 },
        )
        merchWarmSpecs.push({
          cx: rackCx - rackSpan * 0.18,
          cy: 1.02,
          cz: rackFrontCoord,
          sx: rackSpan * 0.34,
          sy: 0.56,
          sz: 0.22,
        })
        merchCoolSpecs.push({
          cx: rackCx + rackSpan * 0.18,
          cy: 1.02,
          cz: rackFrontCoord,
          sx: rackSpan * 0.34,
          sy: 0.54,
          sz: 0.22,
        })
      }
      glassSpecs.push({
        cx: shop.rect.x - frontSpan * 0.41,
        cy: 1.22,
        cz: facadeCoord - outwardSign * 0.03,
        sx: winSpan,
        sy: 1.6,
        sz: 0.03,
      })
      const counterSpecs = i % 3 === 0 ? shutterSilverSpecs : shutterCreamSpecs
      counterSpecs.push({
        cx: shop.rect.x,
        cy: 0.34,
        cz: deepMidCoord,
        sx: frontSpan * 0.44,
        sy: 0.68,
        sz: 0.32,
      })
    } else {
      lightWarmSpecs.push({
        cx: facadeCoord - outwardSign * 0.28,
        cy: lintelBottomY - 0.04,
        cz: shop.rect.z,
        sx: 0.16,
        sy: 0.04,
        sz: Math.max(0.8, frontSpan - 0.4),
      })
      woodSpecs.push(
        { cx: backCoord, cy: 0.42, cz: shop.rect.z, sx: 0.28, sy: 0.84, sz: shelfLen },
        { cx: backCoord, cy: 1.45, cz: shop.rect.z, sx: 0.26, sy: 0.05, sz: shelfLen },
      )
      for (const wingSign of [-1, 1] as const) {
        const rackCz = shop.rect.z + wingSign * frontSpan * 0.26
        rackMetalSpecs.push(
          { cx: rackFrontCoord, cy: rackTopY, cz: rackCz, sx: 0.042, sy: 0.042, sz: rackSpan },
          { cx: rackFrontCoord, cy: rackTopY * 0.5, cz: rackCz - rackSpan * 0.47, sx: 0.046, sy: rackTopY, sz: 0.046 },
          { cx: rackFrontCoord, cy: rackTopY * 0.5, cz: rackCz + rackSpan * 0.47, sx: 0.046, sy: rackTopY, sz: 0.046 },
          { cx: rackFrontCoord, cy: 0.045, cz: rackCz, sx: 0.052, sy: 0.038, sz: rackSpan },
          { cx: rackFrontCoord, cy: 0.022, cz: rackCz - rackSpan * 0.47, sx: 0.36, sy: 0.044, sz: 0.07 },
          { cx: rackFrontCoord, cy: 0.022, cz: rackCz + rackSpan * 0.47, sx: 0.36, sy: 0.044, sz: 0.07 },
        )
        merchWarmSpecs.push({
          cx: rackFrontCoord,
          cy: 1.02,
          cz: rackCz - rackSpan * 0.18,
          sx: 0.22,
          sy: 0.56,
          sz: rackSpan * 0.34,
        })
        merchCoolSpecs.push({
          cx: rackFrontCoord,
          cy: 1.02,
          cz: rackCz + rackSpan * 0.18,
          sx: 0.22,
          sy: 0.54,
          sz: rackSpan * 0.34,
        })
      }
      glassSpecs.push({
        cx: facadeCoord - outwardSign * 0.03,
        cy: 1.22,
        cz: shop.rect.z - frontSpan * 0.41,
        sx: 0.03,
        sy: 1.6,
        sz: winSpan,
      })
      const counterSpecs = i % 3 === 0 ? shutterSilverSpecs : shutterCreamSpecs
      counterSpecs.push({
        cx: deepMidCoord,
        cy: 0.34,
        cz: shop.rect.z,
        sx: 0.32,
        sy: 0.68,
        sz: frontSpan * 0.44,
      })
    }

    // Storefront overhead illuminated signboard + projecting side blade lightbox on every 2nd shop
    const resolved = resolveShopLook(matPack, shop.lookKey, shop.category, i)
    const slot: SzjSignAtlasSlot = resolved.kind === 'sign-atlas' ? resolved.slot : 'shopClothingHk'
    const signW = Math.min(2.4, Math.max(1.1, frontSpan * 0.82))
    const signH = Math.min(0.46, Math.max(0.32, lintelH * 0.78))
    const signY = lintelBottomY + signH * 0.55

    if (facingZ) {
      const signZ = facadeCoord + outwardSign * 0.082
      const signYaw = outwardSign > 0 ? 0 : Math.PI
      canopyTrussSpecs.push({
        cx: shop.rect.x,
        cy: signY,
        cz: facadeCoord + outwardSign * 0.03,
        sx: signW + 0.08,
        sy: signH + 0.06,
        sz: 0.06,
      })
      shopSignGeos.push(makeSignPlane(shop.rect.x, signY, signZ, signW, signH, signYaw, slot))

      if (i % 2 === 0) {
        const bladeZ = facadeCoord + outwardSign * 0.34
        const bladeX = sb.minX + 0.12
        const bladeY = Math.max(2.32, lintelBottomY - 0.1)
        canopyTrussSpecs.push({ cx: bladeX, cy: bladeY, cz: bladeZ, sx: 0.05, sy: 0.44, sz: 0.56 })
        shopSignGeos.push(...makeDoubleSidedSignPlanes(bladeX, bladeY, bladeZ, 0.52, 0.4, Math.PI * 0.5, 0.05, slot))
      }
    } else {
      const signX = facadeCoord + outwardSign * 0.082
      const signYaw = outwardSign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5
      canopyTrussSpecs.push({
        cx: facadeCoord + outwardSign * 0.03,
        cy: signY,
        cz: shop.rect.z,
        sx: 0.06,
        sy: signH + 0.06,
        sz: signW + 0.08,
      })
      shopSignGeos.push(makeSignPlane(signX, signY, shop.rect.z, signW, signH, signYaw, slot))

      if (i % 2 === 0) {
        const bladeX = facadeCoord + outwardSign * 0.34
        const bladeZ = sb.minZ + 0.12
        const bladeY = Math.max(2.32, lintelBottomY - 0.1)
        canopyTrussSpecs.push({ cx: bladeX, cy: bladeY, cz: bladeZ, sx: 0.56, sy: 0.44, sz: 0.05 })
        shopSignGeos.push(...makeDoubleSidedSignPlanes(bladeX, bladeY, bladeZ, 0.52, 0.4, 0, 0.05, slot))
      }
    }
  }

  addBatch('szj-floor-terrazzo', floorTerrazzoSpecs, matPack.floorTerrazzo)
  addBatch('szj-floor-tile', floorTileSpecs, matPack.floorCorridorTile)
  addBatch('szj-ceiling-grid', ceilingSpecs, matPack.ceilingGrid)
  addBatch('szj-walls', wallSpecs, matPack.wallCorridor)
  addBatch('szj-dado-granite', dadoSpecs, matPack.stairGranite)
  addBatch('szj-columns', columnSpecs, matPack.columnStone)
  addBatch('szj-lights-warm', lightWarmSpecs, matPack.lightStripWarm)
  addBatch('szj-stair-treads', stairTreadSpecs, matPack.stairTread)
  addBatch('szj-stair-nosings', stairNosingSpecs, nosingMat)
  addBatch('szj-handrails', handrailSpecs, matPack.handrailSteel)
  addBatch('szj-canopy-truss', canopyTrussSpecs, matPack.canopyTrussDark)
  addBatch('szj-canopy-glass', canopyGlassSpecs, matPack.canopyGlassBlue)
  addBatch('szj-guardrail-white', guardrailWhiteSpecs, matPack.canopyHandrailWhite)
  addBatch('szj-bollard-red', bollardRedSpecs, matPack.bollardRedReflect)
  addBatch('szj-rack-metal', rackMetalSpecs, matPack.rackMetal)
  addBatch('szj-shutter-cream', shutterCreamSpecs, matPack.rollerShutterCream)
  addBatch('szj-shutter-silver', shutterSilverSpecs, matPack.rollerShutterSilver)
  addBatch('szj-storefront-glass', glassSpecs, matPack.storefrontGlass)
  addBatch('szj-wood-shelves', woodSpecs, woodShelfMat)
  addBatch('szj-merch-warm', merchWarmSpecs, merchWarmMat)
  addBatch('szj-merch-cool', merchCoolSpecs, merchCoolMat)
  const shopSignMesh = addMerged('szj-shop-fascia-signs', shopSignGeos, matPack.signAtlasMat)
  if (shopSignMesh) {
    shopSignMesh.userData = { szjRole: 'shop-fascia-signs' }
  }
  const safetyExitMesh = addMerged('szj-safety-exit-plaques', safetyExitGeos, matPack.signAtlasMat)
  if (safetyExitMesh) {
    safetyExitMesh.userData = { szjRole: 'safety-exit-plaques', wallCount: wallSafetyExitCount }
  }

  // 6. Ceiling-hung backlit wayfinding lightboxes + suspension rods (100% driven by wayfinding.signs, 3 drawCalls)
  const wayfindingBatch = createWayfindingSignsGroup(
    wayfinding,
    matPack.wayfindingMat,
    matPack.canopyTrussDark,
    matPack.handrailSteel,
    matPack.wayfindingAtlas,
    { floorY },
  )
  const runtimeFaces = buildRuntimeWayfindingFacesMerged(wayfinding, matPack.wayfindingAtlas, floorY)
  geometries.push(runtimeFaces.geom)
  wayfindingBatch.faceMesh.geometry = runtimeFaces.geom
  const wayfindingTriangles =
    wayfindingBatch.boxMesh.count * 12 + wayfindingBatch.rodMesh.count * 16 + runtimeFaces.triangles
  wayfindingBatch.boxMesh.frustumCulled = false
  wayfindingBatch.rodMesh.frustumCulled = false
  wayfindingBatch.faceMesh.frustumCulled = false
  wayfindingBatch.group.userData = {
    szjRole: 'ceiling-wayfinding-signs',
    signCount: wayfinding.signs.length,
    signs: wayfinding.signs,
  }
  wayfindingBatch.boxMesh.userData = {
    szjRole: 'hanging-sign-boxes',
    signCount: wayfinding.signs.length,
  }
  wayfindingBatch.rodMesh.userData = {
    szjRole: 'hanging-sign-rods',
    rodCount: wayfinding.signs.length * 2,
  }
  const totalWayfindingFaces = wayfinding.signs.reduce((sum, s) => sum + s.faces.length, 0)
  wayfindingBatch.faceMesh.userData = {
    szjRole: 'hanging-sign-faces',
    signCount: wayfinding.signs.length,
    faceCount: totalWayfindingFaces,
  }
  scene.add(wayfindingBatch.group)

  // 7. Populate instanced non-interactive crowd (shopkeepers + browsing customers + strolling pedestrians)
  const plannedCount = Math.max(1, Math.min(SZJ_BUDGET.npcMax, opts.maxNpcs ?? layoutNpcCount(layout)))

  const crowd = createShizijieCrowd({
    layout,
    maxNpcs: plannedCount,
    floorY,
    seed: opts.seed,
  })
  scene.add(crowd.group)

  const crowdMetrics = crowd.getMetrics()
  const atmosMetrics = atmos.getMetrics()
  const totalMeshCount =
    meshes.length + wayfindingBatch.drawCalls + atmosMetrics.drawCalls + crowdMetrics.drawCalls
  const totalTriangles =
    triangleCount + wayfindingTriangles + atmosMetrics.triangles + crowdMetrics.triangles
  const textureBytes = matPack.getTextureBudget().rawBytes

  let disposed = false

  return {
    scene,
    matPack,
    atmos,
    wayfinding,
    wayfindingBatch,
    crowd,
    meshCount: totalMeshCount,
    triangleCount: totalTriangles,
    textureBytes,
    npcCount: crowdMetrics.activeCount,
    wallWayfindingPlaqueCount: 0,
    safetyExitPlaqueCount: wallSafetyExitCount,
    getHangingSigns: () => wayfinding.signs,
    isDisposed: () => disposed,
    dispose(): void {
      if (disposed) return
      disposed = true
      wayfindingBatch.dispose()
      restoreAtmosphere()
      atmos.dispose()
      crowd.dispose()
      scene.remove(wayfindingBatch.group, atmos.group, crowd.group)
      for (const m of meshes) scene.remove(m)
      meshes.length = 0
      for (const g of geometries) g.dispose()
      geometries.length = 0
      for (const em of extraMaterials) em.dispose()
      extraMaterials.length = 0
      matPack.dispose()
    },
  }
}
