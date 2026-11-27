import * as THREE from 'three'
import type { XxgLayout, XxgShop } from '../contract.ts'
import {
  SIGN_ATLAS_RECTS,
  XXG_BLADE_ASPECT,
  XXG_FASCIA_ASPECT,
  XXG_SHOP_SIGNS,
  applyAtlasRectUv,
  createXiaoxianggangMaterials,
  isLitSignStyle,
  type AtlasRect,
  type SignAtlasSlot,
  type XxgShopSign,
  type XxgSignStyle,
} from '../look/index.ts'
import { corridorToAabb, isColumnSkipped, rectToAabb, type Aabb2D } from './collision.ts'
import { buildMergedBoxesGeometry, carveBoxXZ, mergeGeometries, type BoxSpec, type RectXZ } from './scene-boxes.ts'
import {
  classifyXxgShop,
  emitShopFitout,
  getXxgFirstShop,
  resolveAlcoveDepth,
  type FitoutBuckets,
  type ShopFrame,
} from './shop-fitout.ts'
import { XXG_WELL_GLOBES, buildSkyCapGeometry, buildSkylightPyramid } from './skylight-pyramid.ts'
import { buildIndoorWellGeometry, createWellDoors, wellVestibule, xxgIndoorWells, type XxgWellDoors } from './stairwell.ts'

export interface IndoorGreyboxSceneHandle {
  readonly scene: THREE.Scene
  readonly meshCount: number
  readonly triangleCount: number
  readonly textureBytes: number
  readonly geometryCount: number
  readonly materialCount: number
  /** 实际渲染的柱子中心（人群避让用）。 */
  readonly columnCenters: readonly { readonly x: number; readonly z: number }[]
  /** Ceiling holes: the two skylight pyramids, then the four stairwell footprints. */
  readonly skylightOpenings: readonly RectXZ[]
  /** Sliding glass doors of the four stairwells. */
  readonly wellDoors: XxgWellDoors
  isDisposed(): boolean
  dispose(): void
}

function createSafetyExitSignTexture(): { texture: THREE.DataTexture; bytes: number } {
  const w = 128
  const h = 48
  const data = new Uint8Array(w * h * 4)

  const setPx = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return
    const idx = (y * w + x) * 4
    data[idx] = r
    data[idx + 1] = g
    data[idx + 2] = b
    data[idx + 3] = 255
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x >= 3 && x < w - 3 && y >= 3 && y < h - 3
      const inner = x >= 5 && x < w - 5 && y >= 5 && y < h - 5
      if (border && !inner) setPx(x, y, 238, 244, 240)
      else setPx(x, y, 13, 107, 61)
    }
  }

  for (let i = 0; i < 14; i++) {
    for (let t = -1; t <= 2; t++) setPx(18 + i, 28 - i + t, 242, 247, 244)
  }
  for (let x = 18; x <= 29; x++) {
    for (let y = 14; y <= 17; y++) setPx(x, y, 242, 247, 244)
  }
  for (let y = 14; y <= 25; y++) {
    for (let x = 18; x <= 21; x++) setPx(x, y, 242, 247, 244)
  }

  for (let s = 0; s < 4; s++) {
    const sx0 = 92 + s * 5
    const sy = 33 - s * 5
    for (let x = sx0; x <= sx0 + 6; x++) {
      setPx(x, sy, 240, 246, 242)
      setPx(x, sy + 1, 240, 246, 242)
    }
    for (let y = sy - 5; y <= sy; y++) {
      setPx(sx0 + 5, y, 240, 246, 242)
      setPx(sx0 + 6, y, 240, 246, 242)
    }
  }

  const fillRect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) setPx(x, y, 244, 248, 245)
    }
  }
  fillRect(44, 15, 46, 33)
  fillRect(44, 15, 52, 17)
  fillRect(44, 23, 51, 25)
  fillRect(44, 31, 52, 33)
  for (let i = 0; i <= 18; i++) {
    fillRect(56 + Math.floor((i * 7) / 18), 15 + i, 58 + Math.floor((i * 7) / 18), 15 + i)
    fillRect(63 - Math.floor((i * 7) / 18), 15 + i, 65 - Math.floor((i * 7) / 18), 15 + i)
  }
  fillRect(69, 15, 72, 33)
  fillRect(76, 15, 85, 17)
  fillRect(79, 15, 82, 33)

  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.flipY = true
  texture.needsUpdate = true
  return { texture, bytes: data.byteLength }
}

function pointInsideAnyAabb(x: number, z: number, boxes: readonly Aabb2D[], pad = 0.04): boolean {
  for (const b of boxes) {
    if (x >= b.minX + pad && x <= b.maxX - pad && z >= b.minZ + pad && z <= b.maxZ - pad) {
      return true
    }
  }
  return false
}

function emitEdgeWallSegments(
  out: BoxSpec[],
  trimOut: BoxSpec[],
  fixedCoord: number,
  t0: number,
  t1: number,
  axis: 'x' | 'z',
  outwardNormalSign: 1 | -1,
  wallT: number,
  ceilH: number,
  openBoxes: readonly Aabb2D[],
): void {
  const step = 0.4
  const count = Math.max(1, Math.ceil((t1 - t0) / step))
  const segLen = (t1 - t0) / count
  let runStart: number | null = null

  const flushRun = (endT: number) => {
    if (runStart === null || endT - runStart < 0.05) {
      runStart = null
      return
    }
    const midT = (runStart + endT) * 0.5
    const len = endT - runStart
    const wallCenter = fixedCoord + outwardNormalSign * (wallT * 0.5)
    const skirtCenter = fixedCoord - outwardNormalSign * 0.015
    if (axis === 'x') {
      out.push({ cx: midT, cy: ceilH * 0.5, cz: wallCenter, sx: len, sy: ceilH, sz: wallT })
      trimOut.push({ cx: midT, cy: 0.06, cz: skirtCenter, sx: len, sy: 0.12, sz: 0.03 })
    } else {
      out.push({ cx: wallCenter, cy: ceilH * 0.5, cz: midT, sx: wallT, sy: ceilH, sz: len })
      trimOut.push({ cx: skirtCenter, cy: 0.06, cz: midT, sx: 0.03, sy: 0.12, sz: len })
    }
    runStart = null
  }

  for (let i = 0; i < count; i++) {
    const a = t0 + i * segLen
    const b = a + segLen
    const mid = (a + b) * 0.5
    const probeCoord = fixedCoord + outwardNormalSign * 0.22
    const px = axis === 'x' ? mid : probeCoord
    const pz = axis === 'x' ? probeCoord : mid
    const isOpen = pointInsideAnyAabb(px, pz, openBoxes, 0.02)
    if (isOpen) {
      flushRun(a)
    } else if (runStart === null) {
      runStart = a
    }
  }
  flushRun(t1)
}

type Facing = '-x' | '+x' | '-z' | '+z'

const OPPOSITE_FACING: Readonly<Record<Facing, Facing>> = { '-x': '+x', '+x': '-x', '-z': '+z', '+z': '-z' }

/** Turns a +z-facing local shape so it faces `facing`; left-to-right text stays readable from that side. */
function orientToFacing(g: THREE.BufferGeometry, facing: Facing): void {
  if (facing === '-z') g.rotateY(Math.PI)
  else if (facing === '+x') g.rotateY(Math.PI / 2)
  else if (facing === '-x') g.rotateY(-Math.PI / 2)
}

/** Points every UV at one texel of `rect` (raw 0..1 inside the cell): rims and edges take the cell's border colour. */
function fillAtlasUv(g: THREE.BufferGeometry, rect: AtlasRect, rawU: number, rawV: number): void {
  const uv = g.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, rawU, rawV)
  applyAtlasRectUv(g, rect, 2)
}

function placed(g: THREE.BufferGeometry, facing: Facing, x: number, y: number, z: number): THREE.BufferGeometry {
  orientToFacing(g, facing)
  g.translate(x, y, z)
  return g
}

/** Capsule lightbox: a rounded-end slab `depth` deep whose front face (at the anchor) shows the cell. */
function makePillBox(width: number, height: number, depth: number, rect: AtlasRect): THREE.BufferGeometry {
  const r = height * 0.5
  const half = width * 0.5
  const shape = new THREE.Shape()
  shape.moveTo(-half + r, -r)
  shape.lineTo(half - r, -r)
  shape.absarc(half - r, 0, r, -Math.PI / 2, Math.PI / 2, false)
  shape.lineTo(-half + r, r)
  shape.absarc(-half + r, 0, r, Math.PI / 2, Math.PI * 1.5, false)
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 })
  g.translate(0, 0, -depth)
  const pos = g.getAttribute('position')
  const nrm = g.getAttribute('normal')
  const uv = g.getAttribute('uv')
  for (let i = 0; i < pos.count; i++) {
    const cap = Math.abs(nrm.getZ(i)) > 0.5
    uv.setXY(i, cap ? (pos.getX(i) + half) / width : 0.02, cap ? (pos.getY(i) + r) / height : 0.5)
  }
  return applyAtlasRectUv(g, rect, 2)
}

interface SignFrame {
  readonly facingZ: boolean
  /** Frontage centre along the corridor. */
  readonly cu: number
  readonly facade: number
  readonly outwardSign: 1 | -1
  readonly openFace: Facing
  readonly frontSpan: number
  readonly lintelBottomM: number
  readonly ceilH: number
}

interface SignBuckets {
  /** Glowing crafts (sign atlas, emissive). */
  readonly lit: THREE.BufferGeometry[]
  /** Wood and metal plates (sign atlas, ambient only). */
  readonly paint: THREE.BufferGeometry[]
  readonly metal: BoxSpec[]
  readonly wood: BoxSpec[]
}

/** Fascia heights per craft: lightboxes run tallest, LED strips and engraved plates thinnest. */
const BAND_HEIGHT_M: Readonly<Record<XxgSignStyle, number>> = {
  lightbox: 0.4,
  acrylic: 0.4,
  channel: 0.36,
  neon: 0.34,
  led: 0.3,
  wood: 0.38,
  metal: 0.28,
}

/** Price tags hung in the retro alley's shop openings, in turn. */
const DISCOUNT_TAGS: readonly SignAtlasSlot[] = ['discountTag19', 'discountTag29', 'discountTag39', 'discountTag49']

/** Lintel front face, metres proud of the facade line; side pilasters reach `PILASTER_FACE`. */
const LINTEL_FACE = 0.04
const PILASTER_FACE = 0.08
/** Pilaster centre, metres in from each end of the frontage. */
const PILASTER_INSET = 0.09

/**
 * One shop's signage in the frontage frame (u along the corridor, n out of the shop, y up):
 * the fascia by form and craft, plus an optional blade or round sign on the right-hand pilaster.
 */
function emitShopSign(sign: XxgShopSign, fr: SignFrame, out: SignBuckets, discountTag?: AtlasRect): void {
  const { facingZ, cu, facade, outwardSign, openFace, frontSpan, lintelBottomM, ceilH } = fr
  const lintelH = ceilH - lintelBottomM
  const at = (u: number, n: number): [number, number] => (facingZ ? [cu + u, facade + outwardSign * n] : [facade + outwardSign * n, cu + u])
  const box = (bucket: BoxSpec[], u: number, y: number, n: number, su: number, sy: number, sn: number) => {
    const [x, z] = at(u, n)
    bucket.push(facingZ ? { cx: x, cy: y, cz: z, sx: su, sy, sz: sn } : { cx: x, cy: y, cz: z, sx: sn, sy, sz: su })
  }
  const quad = (target: THREE.BufferGeometry[], u: number, y: number, n: number, w: number, h: number, facing: Facing, rect: AtlasRect) => {
    const [x, z] = at(u, n)
    const g = new THREE.PlaneGeometry(w, h)
    applyAtlasRectUv(g, rect, 2)
    target.push(placed(g, facing, x, y, z))
  }
  const bucketFor = (style: XxgSignStyle) => (isLitSignStyle(style) ? out.lit : out.paint)

  const { face, form, rect } = sign
  const target = bucketFor(face.style)
  const maxW = frontSpan - 0.44
  let h = Math.min(BAND_HEIGHT_M[face.style], lintelH * 0.84)
  let w = h * XXG_FASCIA_ASPECT
  if (w > maxW) {
    w = maxW
    h = w / XXG_FASCIA_ASPECT
  }
  const y = lintelBottomM + lintelH * 0.5

  if (form === 'hang') {
    // Double-sided board on two rods, hung over the corridor edge.
    const n = 0.42
    const hy = lintelBottomM + 0.08
    const top = hy + h * 0.5 + 0.02
    box(out.metal, 0, hy, n, w + 0.04, h + 0.04, 0.03)
    quad(target, 0, hy, n + 0.019, w, h, openFace, rect)
    quad(target, 0, hy, n - 0.019, w, h, OPPOSITE_FACING[openFace], rect)
    for (const s of [-1, 1]) box(out.metal, s * w * 0.38, (top + ceilH) * 0.5, n, 0.016, ceilH - top, 0.016)
  } else if (form === 'pill') {
    const depth = 0.08
    const [x, z] = at(0, LINTEL_FACE + depth + 0.002)
    target.push(placed(makePillBox(w, h, depth, rect), openFace, x, y, z))
  } else {
    switch (face.style) {
      case 'lightbox': {
        // The lit box runs pilaster to pilaster in the panel's own ground colour; the name panel sits centred on its face.
        const g = new THREE.BoxGeometry(Math.max(w + 0.05, frontSpan - 0.4), h + 0.06, 0.1)
        fillAtlasUv(g, rect, 0.035, 0.5)
        const [x, z] = at(0, LINTEL_FACE + 0.05)
        target.push(placed(g, openFace, x, y, z))
        quad(target, 0, y, LINTEL_FACE + 0.104, w, h, openFace, rect)
        break
      }
      case 'led':
        box(out.metal, 0, y, LINTEL_FACE + 0.03, w + 0.04, h + 0.04, 0.06)
        quad(target, 0, y, LINTEL_FACE + 0.064, w, h, openFace, rect)
        break
      case 'channel':
      case 'neon':
        // Letters on a dark raceway that runs pilaster to pilaster.
        box(out.metal, 0, y, LINTEL_FACE + 0.015, frontSpan - 0.06, h + 0.12, 0.03)
        quad(target, 0, y, LINTEL_FACE + 0.034, w, h, openFace, rect)
        break
      case 'wood':
        box(out.wood, 0, y, LINTEL_FACE + 0.02, w + 0.08, h + 0.08, 0.04)
        quad(target, 0, y, LINTEL_FACE + 0.044, w, h, openFace, rect)
        break
      case 'acrylic':
        // Panel floats on four standoffs whose caps poke through.
        quad(target, 0, y, LINTEL_FACE + 0.05, w, h, openFace, rect)
        for (const su of [-1, 1]) for (const sv of [-1, 1]) box(out.metal, su * (w * 0.5 - 0.07), y + sv * (h * 0.5 - 0.06), LINTEL_FACE + 0.031, 0.03, 0.03, 0.062)
        break
      case 'metal':
        box(out.metal, 0, y, LINTEL_FACE + 0.006, w + 0.02, h + 0.02, 0.012)
        quad(target, 0, y, LINTEL_FACE + 0.016, w, h, openFace, rect)
        break
    }
  }

  if (discountTag) quad(out.lit, -frontSpan * 0.3, lintelBottomM - 0.3, LINTEL_FACE + 0.1, 0.33, 0.36, openFace, discountTag)

  const extra = sign.extra
  if (!extra) return
  const t = bucketFor(extra.face.style)
  const u = frontSpan * 0.5 - PILASTER_INSET
  const sidePlus: Facing = facingZ ? '+x' : '+z'
  const sideMinus = OPPOSITE_FACING[sidePlus]
  if (extra.kind === 'blade') {
    const bh = 0.9
    const bw = bh * XXG_BLADE_ASPECT
    const by = ceilH - 0.08 - bh * 0.5
    const nC = PILASTER_FACE + 0.1 + bw * 0.5
    box(out.metal, u, by, nC, 0.04, bh + 0.04, bw + 0.04)
    quad(t, u + 0.024, by, nC, bw, bh, sidePlus, extra.rect)
    quad(t, u - 0.024, by, nC, bw, bh, sideMinus, extra.rect)
    for (const s of [-1, 1]) box(out.metal, u, by + s * (bh * 0.5 - 0.1), PILASTER_FACE + 0.05, 0.03, 0.03, 0.1)
  } else {
    const r = 0.22
    const cy = ceilH - 0.14 - r
    const nC = PILASTER_FACE + 0.1 + r
    const [x, z] = at(u, nC)
    const plus = facingZ ? [x + 0.036, z] : [x, z + 0.036]
    const minus = facingZ ? [x - 0.036, z] : [x, z - 0.036]
    t.push(placed(applyAtlasRectUv(new THREE.CircleGeometry(r, 28), extra.rect, 2), sidePlus, plus[0]!, cy, plus[1]!))
    t.push(placed(applyAtlasRectUv(new THREE.CircleGeometry(r, 28), extra.rect, 2), sideMinus, minus[0]!, cy, minus[1]!))
    const rim = new THREE.CylinderGeometry(r, r, 0.072, 28, 1, true)
    fillAtlasUv(rim, extra.rect, 0.03, 0.03)
    if (facingZ) rim.rotateZ(Math.PI / 2)
    else rim.rotateX(Math.PI / 2)
    rim.translate(x, cy, z)
    t.push(rim)
    // Arm from the pilaster over the disc, with a short hanger.
    const armY = cy + r + 0.05
    box(out.metal, u, armY, (PILASTER_FACE + nC) * 0.5 + 0.02, 0.03, 0.03, nC - PILASTER_FACE + 0.04)
    box(out.metal, u, cy + r + 0.02, nC, 0.02, 0.05, 0.02)
  }
}

interface ShopFrontageGeometry {
  openFace: '-x' | '+x' | '-z' | '+z'
  facingZ: boolean
  outwardSign: 1 | -1
  frontSpan: number
  frontDepth: number
  shopFrontCoord: number
  corrEdgeCoord: number
  facadeCoord: number
  gapM: number
  openApron: Aabb2D
}

function resolveShopFrontageGeometry(shop: XxgShop, sb: Aabb2D, front: Aabb2D | undefined): ShopFrontageGeometry {
  const nearX = front ? Math.max(front.minX, Math.min(shop.rect.x, front.maxX)) : shop.rect.x
  const nearZ = front ? Math.max(front.minZ, Math.min(shop.rect.z, front.maxZ)) : shop.rect.z
  const dx = nearX - shop.rect.x
  const dz = nearZ - shop.rect.z
  const openFace: '-x' | '+x' | '-z' | '+z' =
    Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? '-x' : '+x') : dz < 0 ? '-z' : '+z'
  const facingZ = openFace === '-z' || openFace === '+z'
  const outwardSign: 1 | -1 = openFace === '+z' || openFace === '+x' ? 1 : -1
  const frontSpan = facingZ ? shop.rect.w : shop.rect.d
  const frontDepth = facingZ ? shop.rect.d : shop.rect.w
  const shopFrontCoord =
    openFace === '+z' ? sb.maxZ : openFace === '-z' ? sb.minZ : openFace === '+x' ? sb.maxX : sb.minX
  const corrEdgeCoord = front
    ? openFace === '+z'
      ? front.minZ
      : openFace === '-z'
        ? front.maxZ
        : openFace === '+x'
          ? front.minX
          : front.maxX
    : shopFrontCoord
  const gapM = Math.max(0, (corrEdgeCoord - shopFrontCoord) * outwardSign)
  const facadeCoord = front ? corrEdgeCoord - outwardSign * 0.04 : shopFrontCoord
  const jambInset = Math.min(0.08, frontSpan * 0.04)
  const intoShop = shopFrontCoord - outwardSign * 0.4
  const intoCorr = corrEdgeCoord + outwardSign * 0.45
  const openApron: Aabb2D = facingZ
    ? {
        id: `${shop.id}-open`,
        minX: sb.minX + jambInset,
        maxX: sb.maxX - jambInset,
        minZ: Math.min(intoShop, intoCorr),
        maxZ: Math.max(intoShop, intoCorr),
      }
    : {
        id: `${shop.id}-open`,
        minX: Math.min(intoShop, intoCorr),
        maxX: Math.max(intoShop, intoCorr),
        minZ: sb.minZ + jambInset,
        maxZ: sb.maxZ - jambInset,
      }
  return {
    openFace,
    facingZ,
    outwardSign,
    frontSpan,
    frontDepth,
    shopFrontCoord,
    corrEdgeCoord,
    facadeCoord,
    gapM,
    openApron,
  }
}

/** 吊顶方灯：600mm 格内嵌 560mm 灯片，沿走廊每 4 格一排。 */
export const XXG_LAMP_SIZE_M = 0.56
export const XXG_LAMP_PITCH_M = 2.4

function rectContains(r: RectXZ, x: number, z: number, margin = 0): boolean {
  return x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin
}

/**
 * Builds the standalone B1 indoor THREE.Scene from any validated XxgLayout.
 * Static scene stays within XXG_BUDGET.indoorSceneDrawCallsMax (40) draw calls so passers-by get the rest of the 80, <= 150k triangles, zero dependency on world.ts or terrain.
 */
export function createIndoorGreyboxScene(layout: XxgLayout): IndoorGreyboxSceneHandle {
  const scene = new THREE.Scene()
  scene.name = 'xxg-indoor-b1-scene'
  scene.background = new THREE.Color('#d6dde3')
  scene.fog = new THREE.Fog('#d8d3c8', 36, 92)

  const matPack = createXiaoxianggangMaterials()
  matPack.setLightingBoost(0.22)

  const geometries: THREE.BufferGeometry[] = []
  const usedPackMats = new Set<THREE.Material>()
  const extraMaterials: THREE.Material[] = []
  const extraTextures: THREE.Texture[] = []
  const meshes: THREE.Mesh[] = []
  let triangleCount = 0
  let textureBytes = matPack.getTextureBudget().rawBytes

  const uvScaleFrom = (mat: THREE.Material): readonly [number, number] => {
    const p = (mat.userData?.periodM as readonly [number, number] | undefined) ?? [1, 1]
    return [1 / Math.max(0.1, p[0]), 1 / Math.max(0.1, p[1])]
  }

  const addBatchBoxes = (
    name: string,
    specs: readonly BoxSpec[],
    material: THREE.Material,
    isPackMat = true,
  ): THREE.Mesh | null => {
    if (specs.length === 0) return null
    const { geom, triangles } = buildMergedBoxesGeometry(specs, uvScaleFrom(material))
    triangleCount += triangles
    geometries.push(geom)
    if (isPackMat) usedPackMats.add(material)
    else extraMaterials.push(material)
    const mesh = new THREE.Mesh(geom, material)
    mesh.name = name
    mesh.frustumCulled = false
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    scene.add(mesh)
    meshes.push(mesh)
    return mesh
  }

  const addMergedGeos = (
    name: string,
    parts: THREE.BufferGeometry[],
    material: THREE.Material,
    isPackMat: boolean,
  ): THREE.Mesh | null => {
    if (parts.length === 0) return null
    const { geom, triangles } = mergeGeometries(parts)
    triangleCount += triangles
    geometries.push(geom)
    if (isPackMat) usedPackMats.add(material)
    else extraMaterials.push(material)
    const mesh = new THREE.Mesh(geom, material)
    mesh.name = name
    mesh.frustumCulled = false
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    scene.add(mesh)
    meshes.push(mesh)
    return mesh
  }

  const ceilH = layout.ceilingHeight
  const wallT = 0.32
  const lintelBottomM = Math.min(2.38, ceilH - 0.52)

  const corridorBoxes = layout.corridors.map(corridorToAabb)
  const corridorsById = new Map(layout.corridors.map(c => [c.id, corridorToAabb(c)]))
  const wells = xxgIndoorWells()
  const vestibules = wells.map(w => wellVestibule(w, corridorBoxes))

  const namedShops = layout.shops.filter(s => Boolean(s.name && s.name.trim().length > 0))
  const shopGeoms = layout.shops.map(shop => {
    const sb = rectToAabb(shop.id, shop.rect)
    const front = corridorsById.get(shop.frontage)
    return { shop, sb, front, geom: resolveShopFrontageGeometry(shop, sb, front) }
  })

  const wellOpenings: RectXZ[] = []
  const skyCorr = namedShops.length > 4 ? corridorsById.get('corr-skylight-ns') : undefined
  if (skyCorr) {
    const wx = (skyCorr.minX + skyCorr.maxX) * 0.5
    const half = Math.min(2.2, (skyCorr.maxX - skyCorr.minX) * 0.5 - 0.08)
    for (const zc of [-25.5, 25.5]) {
      const wz = Math.min(skyCorr.maxZ - half - 0.4, Math.max(skyCorr.minZ + half + 0.4, zc))
      wellOpenings.push({ minX: wx - half, maxX: wx + half, minZ: wz - half, maxZ: wz + half })
    }
  }
  const ceilingHoles: RectXZ[] = [...wellOpenings, ...wells.map(w => w.footprint)]

  // Stairwell walls and the vestibules replace the corridor walls they cross.
  const openFootprints: Aabb2D[] = [...corridorBoxes]
  wells.forEach((w, i) => {
    openFootprints.push({ id: `well-${w.portalId}`, ...w.footprint })
    const v = vestibules[i]
    if (v) openFootprints.push({ id: `well-${w.portalId}-vestibule`, ...v })
  })
  for (const { geom } of shopGeoms) {
    openFootprints.push(geom.openApron)
  }

  const floorRenovatedSpecs: BoxSpec[] = []
  const floorTerrazzoSpecs: BoxSpec[] = []
  const wallCorridorSpecs: BoxSpec[] = []
  const wallPinkSpecs: BoxSpec[] = []
  const shutterSilverSpecs: BoxSpec[] = []
  const shutterCreamSpecs: BoxSpec[] = []
  const storefrontGlassSpecs: BoxSpec[] = []
  const ceilingSpecs: BoxSpec[] = []
  const lightCoolSpecs: BoxSpec[] = []
  const lightWarmSpecs: BoxSpec[] = []
  const rackMetalSpecs: BoxSpec[] = []
  const garmentWineSpecs: BoxSpec[] = []
  const garmentNavySpecs: BoxSpec[] = []
  const woodCamelSpecs: BoxSpec[] = []
  const stairSpecs: BoxSpec[] = []
  const stairNosingSpecs: BoxSpec[] = []
  const wellLitGeos: THREE.BufferGeometry[] = []
  const skylightGlassSpecs: BoxSpec[] = []
  const goodsSpecs: BoxSpec[] = []
  const globeSpecs: THREE.BufferGeometry[] = []
  const skylightFrameGeos: THREE.BufferGeometry[] = []
  const pyramidGlassGeos: THREE.BufferGeometry[] = []
  const shopSignGeos: THREE.BufferGeometry[] = []
  const shopSignPaintGeos: THREE.BufferGeometry[] = []
  const signBuckets: SignBuckets = { lit: shopSignGeos, paint: shopSignPaintGeos, metal: rackMetalSpecs, wood: woodCamelSpecs }
  const exitSignGeos: THREE.BufferGeometry[] = []

  for (let ci = 0; ci < layout.corridors.length; ci++) {
    const c = layout.corridors[ci]!
    const b = corridorBoxes[ci]!
    // 中庭翻新区铺抛光砖，其余主街与支巷都是水磨石；翻新砖高 4mm 压住重叠处的水磨石，避免 z-fighting。
    const isRenovated = c.id.startsWith('corr-atrium')
    const floorTarget = isRenovated ? floorRenovatedSpecs : floorTerrazzoSpecs
    floorTarget.push({
      cx: (b.minX + b.maxX) * 0.5,
      cy: isRenovated ? -0.056 : -0.06,
      cz: (b.minZ + b.maxZ) * 0.5,
      sx: b.maxX - b.minX + 0.2,
      sy: 0.12,
      sz: b.maxZ - b.minZ + 0.2,
    })

    emitEdgeWallSegments(wallCorridorSpecs, rackMetalSpecs, b.minZ, b.minX, b.maxX, 'x', -1, wallT, ceilH, openFootprints)
    emitEdgeWallSegments(wallCorridorSpecs, rackMetalSpecs, b.maxZ, b.minX, b.maxX, 'x', 1, wallT, ceilH, openFootprints)
    emitEdgeWallSegments(wallCorridorSpecs, rackMetalSpecs, b.minX, b.minZ, b.maxZ, 'z', -1, wallT, ceilH, openFootprints)
    emitEdgeWallSegments(wallCorridorSpecs, rackMetalSpecs, b.maxX, b.minZ, b.maxZ, 'z', 1, wallT, ceilH, openFootprints)

    ceilingSpecs.push({
      cx: (b.minX + b.maxX) * 0.5,
      cy: ceilH + 0.06,
      cz: (b.minZ + b.maxZ) * 0.5,
      sx: b.maxX - b.minX + 0.4,
      sy: 0.12,
      sz: b.maxZ - b.minZ + 0.4,
    })
  }

  // B1 vestibule in front of a stairwell door no corridor reaches: floored, ceiled and walled like a short corridor.
  for (const v of vestibules) {
    if (!v) continue
    const cx = (v.minX + v.maxX) * 0.5
    const cz = (v.minZ + v.maxZ) * 0.5
    floorTerrazzoSpecs.push({ cx, cy: -0.06, cz, sx: v.maxX - v.minX + 0.2, sy: 0.12, sz: v.maxZ - v.minZ + 0.2 })
    ceilingSpecs.push({ cx, cy: ceilH + 0.06, cz, sx: v.maxX - v.minX + 0.4, sy: 0.12, sz: v.maxZ - v.minZ + 0.4 })
    emitEdgeWallSegments(wallCorridorSpecs, rackMetalSpecs, v.minZ, v.minX, v.maxX, 'x', -1, wallT, ceilH, openFootprints)
    emitEdgeWallSegments(wallCorridorSpecs, rackMetalSpecs, v.maxZ, v.minX, v.maxX, 'x', 1, wallT, ceilH, openFootprints)
    emitEdgeWallSegments(wallCorridorSpecs, rackMetalSpecs, v.minX, v.minZ, v.maxZ, 'z', -1, wallT, ceilH, openFootprints)
    emitEdgeWallSegments(wallCorridorSpecs, rackMetalSpecs, v.maxX, v.minZ, v.maxZ, 'z', 1, wallT, ceilH, openFootprints)
  }
  // The stairwell landing and walls are the floor inside each footprint.
  for (const bucket of [floorTerrazzoSpecs, floorRenovatedSpecs]) {
    let carved: BoxSpec[] = bucket
    for (const w of wells) carved = carved.flatMap(b => carveBoxXZ(b, w.footprint))
    bucket.length = 0
    bucket.push(...carved)
  }

  for (const opening of wellOpenings) {
    const pyramid = buildSkylightPyramid({ opening, ceilH, heightM: 3.0, globes: XXG_WELL_GLOBES })
    wallCorridorSpecs.push(...pyramid.curbWalls)
    pyramidGlassGeos.push(pyramid.glass)
    skylightFrameGeos.push(...pyramid.frame)
    globeSpecs.push(...pyramid.globes)
  }

  const colSize = layout.columns.size
  const columnCenters: { x: number; z: number }[] = []
  for (const cx of layout.columns.xs) {
    for (const cz of layout.columns.zs) {
      if (!pointInsideAnyAabb(cx, cz, corridorBoxes, -0.3)) continue
      if (isColumnSkipped(layout, wells, cx, cz)) continue
      if (ceilingHoles.some(h => rectContains(h, cx, cz, colSize * 0.5 + 0.3))) continue
      wallCorridorSpecs.push({ cx, cy: ceilH * 0.5, cz, sx: colSize, sy: ceilH, sz: colSize })
      rackMetalSpecs.push({ cx, cy: 0.08, cz, sx: colSize + 0.05, sy: 0.16, sz: colSize + 0.05 })
      columnCenters.push({ x: cx, z: cz })
    }
  }

  // 嵌入式方灯矩阵：600mm 吊顶格里整格嵌灯，沿走廊每 2.4m（4 格）一排、横向每 1.8m（3 格）一列；
  // 主街先排，支巷与主街交叉处不重复布灯，采光井和柱头周围空出。
  const lampCenters: { x: number; z: number }[] = []
  const snapCell = (v: number) => 0.3 + Math.round((v - 0.3) / 0.6) * 0.6
  const lampOrder = corridorBoxes
    .map((b, i) => ({ b, main: layout.corridors[i]!.kind === 'main' ? 1 : 0 }))
    .sort((p, q) => q.main - p.main)
  for (const { b } of lampOrder) {
    const w = b.maxX - b.minX
    const d = b.maxZ - b.minZ
    const alongX = w >= d
    const len = alongX ? w : d
    const across = alongX ? d : w
    const a0 = alongX ? b.minX : b.minZ
    const c0 = alongX ? b.minZ : b.minX
    const rows = across < 3.6 ? 1 : across < 5.4 ? 2 : across < 7.8 ? 3 : 4
    const count = Math.max(1, Math.floor((len - 1.2) / XXG_LAMP_PITCH_M) + 1)
    const firstAlong = snapCell(a0 + (len - (count - 1) * XXG_LAMP_PITCH_M) * 0.5)
    const firstRow = snapCell(c0 + across * 0.5 - (rows - 1) * 0.9)
    for (let i = 0; i < count; i++) {
      for (let r = 0; r < rows; r++) {
        const av = firstAlong + i * XXG_LAMP_PITCH_M
        const cv = firstRow + r * 1.8
        const x = alongX ? av : cv
        const z = alongX ? cv : av
        if (!rectContains(b, x, z, -0.55)) continue
        if (ceilingHoles.some(h => rectContains(h, x, z, 0.45))) continue
        if (lampCenters.some(p => Math.abs(p.x - x) < 1.5 && Math.abs(p.z - z) < 1.5)) continue
        if (columnCenters.some(p => Math.abs(p.x - x) < colSize * 0.5 + 0.4 && Math.abs(p.z - z) < colSize * 0.5 + 0.4)) continue
        lampCenters.push({ x, z })
        lightCoolSpecs.push({ cx: x, cy: ceilH - 0.004, cz: z, sx: XXG_LAMP_SIZE_M, sy: 0.01, sz: XXG_LAMP_SIZE_M })
      }
    }
  }

  const fitoutBuckets: FitoutBuckets = {
    wall: wallCorridorSpecs,
    glass: storefrontGlassSpecs,
    cream: shutterCreamSpecs,
    wine: garmentWineSpecs,
    navy: garmentNavySpecs,
    camel: woodCamelSpecs,
    metal: rackMetalSpecs,
    warmLight: lightWarmSpecs,
    goods: goodsSpecs,
  }

  for (let si = 0; si < shopGeoms.length; si++) {
    const { shop, sb, front, geom } = shopGeoms[si]!
    const { openFace, facingZ, outwardSign, frontSpan, frontDepth, facadeCoord, corrEdgeCoord, gapM } = geom
    const isEmptyBay = !shop.name || shop.name.trim().length === 0
    const lintelH = ceilH - lintelBottomM
    const ceilMin = facingZ ? Math.min(sb.minZ, corrEdgeCoord - outwardSign * 0.1) : Math.min(sb.minX, corrEdgeCoord - outwardSign * 0.1)
    const ceilMax = facingZ ? Math.max(sb.maxZ, corrEdgeCoord + outwardSign * 0.15) : Math.max(sb.maxX, corrEdgeCoord + outwardSign * 0.15)

    ceilingSpecs.push({
      cx: facingZ ? shop.rect.x : (ceilMin + ceilMax) * 0.5,
      cy: ceilH + 0.06,
      cz: facingZ ? (ceilMin + ceilMax) * 0.5 : shop.rect.z,
      sx: (facingZ ? shop.rect.w : ceilMax - ceilMin) + 0.25,
      sy: 0.12,
      sz: (facingZ ? ceilMax - ceilMin : shop.rect.d) + 0.25,
    })

    if (isEmptyBay) {
      floorTerrazzoSpecs.push({
        cx: shop.rect.x,
        cy: -0.05,
        cz: shop.rect.z,
        sx: shop.rect.w + (!facingZ ? gapM + 0.2 : 0),
        sy: 0.1,
        sz: shop.rect.d + (facingZ ? gapM + 0.2 : 0),
      })
      lightWarmSpecs.push({
        cx: shop.rect.x,
        cy: ceilH - 0.015,
        cz: shop.rect.z,
        sx: Math.min(1.1, shop.rect.w * 0.35),
        sy: 0.025,
        sz: Math.min(1.4, shop.rect.d * 0.35),
      })
      if (openFace !== '-z') {
        wallCorridorSpecs.push({ cx: shop.rect.x, cy: ceilH * 0.5, cz: sb.minZ - wallT * 0.5, sx: shop.rect.w + wallT * 2, sy: ceilH, sz: wallT })
        rackMetalSpecs.push({ cx: shop.rect.x, cy: 0.06, cz: sb.minZ + 0.02, sx: shop.rect.w, sy: 0.12, sz: 0.04 })
      }
      if (openFace !== '+z') {
        wallCorridorSpecs.push({ cx: shop.rect.x, cy: ceilH * 0.5, cz: sb.maxZ + wallT * 0.5, sx: shop.rect.w + wallT * 2, sy: ceilH, sz: wallT })
        rackMetalSpecs.push({ cx: shop.rect.x, cy: 0.06, cz: sb.maxZ - 0.02, sx: shop.rect.w, sy: 0.12, sz: 0.04 })
      }
      if (openFace !== '-x') {
        wallCorridorSpecs.push({ cx: sb.minX - wallT * 0.5, cy: ceilH * 0.5, cz: shop.rect.z, sx: wallT, sy: ceilH, sz: shop.rect.d + wallT * 2 })
        rackMetalSpecs.push({ cx: sb.minX + 0.02, cy: 0.06, cz: shop.rect.z, sx: 0.04, sy: 0.12, sz: shop.rect.d })
      }
      if (openFace !== '+x') {
        wallCorridorSpecs.push({ cx: sb.maxX + wallT * 0.5, cy: ceilH * 0.5, cz: shop.rect.z, sx: wallT, sy: ceilH, sz: shop.rect.d + wallT * 2 })
        rackMetalSpecs.push({ cx: sb.maxX - 0.02, cy: 0.06, cz: shop.rect.z, sx: 0.04, sy: 0.12, sz: shop.rect.d })
      }
      if (!facingZ) {
        const rearX = openFace === '-x' ? sb.maxX - 0.04 : sb.minX + 0.04
        wallCorridorSpecs.push({ cx: facadeCoord, cy: lintelBottomM + lintelH * 0.5, cz: shop.rect.z, sx: wallT, sy: lintelH, sz: shop.rect.d })
        rackMetalSpecs.push(
          { cx: facadeCoord, cy: lintelBottomM * 0.5, cz: sb.minZ + 0.16, sx: wallT + 0.06, sy: lintelBottomM, sz: 0.32 },
          { cx: facadeCoord, cy: lintelBottomM * 0.5, cz: sb.maxZ - 0.16, sx: wallT + 0.06, sy: lintelBottomM, sz: 0.32 },
          { cx: facadeCoord, cy: lintelBottomM - 0.05, cz: shop.rect.z, sx: wallT + 0.08, sy: 0.1, sz: shop.rect.d },
          { cx: rearX, cy: 1.35, cz: shop.rect.z - shop.rect.d * 0.25, sx: 0.07, sy: 2.2, sz: 0.12 },
          { cx: rearX, cy: 1.35, cz: shop.rect.z + shop.rect.d * 0.25, sx: 0.07, sy: 2.2, sz: 0.12 },
          { cx: rearX, cy: 2.42, cz: shop.rect.z, sx: 0.07, sy: 0.1, sz: shop.rect.d * 0.54 },
        )
        lightWarmSpecs.push({ cx: facadeCoord, cy: lintelBottomM - 0.02, cz: shop.rect.z, sx: 0.16, sy: 0.025, sz: shop.rect.d - 0.7 })
      } else {
        const rearZ = openFace === '-z' ? sb.maxZ - 0.04 : sb.minZ + 0.04
        wallCorridorSpecs.push({ cx: shop.rect.x, cy: lintelBottomM + lintelH * 0.5, cz: facadeCoord, sx: shop.rect.w, sy: lintelH, sz: wallT })
        rackMetalSpecs.push(
          { cx: sb.minX + 0.16, cy: lintelBottomM * 0.5, cz: facadeCoord, sx: 0.32, sy: lintelBottomM, sz: wallT + 0.06 },
          { cx: sb.maxX - 0.16, cy: lintelBottomM * 0.5, cz: facadeCoord, sx: 0.32, sy: lintelBottomM, sz: wallT + 0.06 },
          { cx: shop.rect.x, cy: lintelBottomM - 0.05, cz: facadeCoord, sx: shop.rect.w, sy: 0.1, sz: wallT + 0.08 },
          { cx: shop.rect.x - shop.rect.w * 0.25, cy: 1.35, cz: rearZ, sx: 0.12, sy: 2.2, sz: 0.07 },
          { cx: shop.rect.x + shop.rect.w * 0.25, cy: 1.35, cz: rearZ, sx: 0.12, sy: 2.2, sz: 0.07 },
          { cx: shop.rect.x, cy: 2.42, cz: rearZ, sx: shop.rect.w * 0.54, sy: 0.1, sz: 0.07 },
        )
        lightWarmSpecs.push({ cx: shop.rect.x, cy: lintelBottomM - 0.02, cz: facadeCoord, sx: shop.rect.w - 0.7, sy: 0.025, sz: 0.16 })
      }
      continue
    }

    const firstShop = getXxgFirstShop(shop)
    const isPink = shop.lookKey === 'wallBoutiquePink' || shop.lookKey === 'boutiqueB181' || shop.lookKey === 'boutiqueYuyu'
    // 首批三家强制营业（不落卷帘），其余按 lookKey 决定是否卷帘。
    const isShutterSilver = !firstShop && shop.lookKey === 'rollerShutterSilver'
    const isShutterCream = !firstShop && shop.lookKey === 'rollerShutterCream'
    const isShuttered = isShutterSilver || isShutterCream

    const alcoveDepth = resolveAlcoveDepth(gapM, frontDepth, isShuttered, firstShop !== null)
    const sideWallTarget = isPink ? wallPinkSpecs : wallCorridorSpecs
    const backPlaneCoord = facadeCoord - outwardSign * alcoveDepth
    const shopFloorBucket = shop.frontage.startsWith('corr-atrium') ? floorRenovatedSpecs : floorTerrazzoSpecs

    if (facingZ) {
      sideWallTarget.push({
        cx: shop.rect.x,
        cy: ceilH * 0.5,
        cz: backPlaneCoord - outwardSign * 0.14,
        sx: shop.rect.w,
        sy: ceilH,
        sz: 0.28,
      })
      wallCorridorSpecs.push(
        { cx: sb.minX + 0.09, cy: ceilH * 0.5, cz: facadeCoord - outwardSign * alcoveDepth * 0.5, sx: 0.18, sy: ceilH, sz: alcoveDepth + 0.16 },
        { cx: sb.maxX - 0.09, cy: ceilH * 0.5, cz: facadeCoord - outwardSign * alcoveDepth * 0.5, sx: 0.18, sy: ceilH, sz: alcoveDepth + 0.16 },
        { cx: shop.rect.x, cy: lintelBottomM + lintelH * 0.5, cz: facadeCoord - outwardSign * 0.08, sx: shop.rect.w, sy: lintelH, sz: 0.24 },
      )
      shopFloorBucket.push({
        cx: shop.rect.x,
        cy: -0.055,
        cz: facadeCoord - outwardSign * (alcoveDepth * 0.5 - 0.08),
        sx: shop.rect.w,
        sy: 0.11,
        sz: alcoveDepth + 0.28,
      })
    } else {
      sideWallTarget.push({
        cx: backPlaneCoord - outwardSign * 0.14,
        cy: ceilH * 0.5,
        cz: shop.rect.z,
        sx: 0.28,
        sy: ceilH,
        sz: shop.rect.d,
      })
      wallCorridorSpecs.push(
        { cx: facadeCoord - outwardSign * alcoveDepth * 0.5, cy: ceilH * 0.5, cz: sb.minZ + 0.09, sx: alcoveDepth + 0.16, sy: ceilH, sz: 0.18 },
        { cx: facadeCoord - outwardSign * alcoveDepth * 0.5, cy: ceilH * 0.5, cz: sb.maxZ - 0.09, sx: alcoveDepth + 0.16, sy: ceilH, sz: 0.18 },
        { cx: facadeCoord - outwardSign * 0.08, cy: lintelBottomM + lintelH * 0.5, cz: shop.rect.z, sx: 0.24, sy: lintelH, sz: shop.rect.d },
      )
      shopFloorBucket.push({
        cx: facadeCoord - outwardSign * (alcoveDepth * 0.5 - 0.08),
        cy: -0.055,
        cz: shop.rect.z,
        sx: alcoveDepth + 0.28,
        sy: 0.11,
        sz: shop.rect.d,
      })
    }

    if (isShuttered) {
      const shutterBucket = isShutterSilver ? shutterSilverSpecs : shutterCreamSpecs
      if (facingZ) {
        shutterBucket.push({ cx: shop.rect.x, cy: lintelBottomM * 0.5, cz: facadeCoord - outwardSign * 0.05, sx: frontSpan - 0.34, sy: lintelBottomM, sz: 0.06 })
        rackMetalSpecs.push({ cx: shop.rect.x, cy: lintelBottomM - 0.04, cz: facadeCoord - outwardSign * 0.02, sx: frontSpan - 0.18, sy: 0.09, sz: 0.12 })
      } else {
        shutterBucket.push({ cx: facadeCoord - outwardSign * 0.05, cy: lintelBottomM * 0.5, cz: shop.rect.z, sx: 0.06, sy: lintelBottomM, sz: frontSpan - 0.34 })
        rackMetalSpecs.push({ cx: facadeCoord - outwardSign * 0.02, cy: lintelBottomM - 0.04, cz: shop.rect.z, sx: 0.12, sy: 0.09, sz: frontSpan - 0.18 })
      }
    } else {
      const frame: ShopFrame = {
        facingZ,
        cu: facingZ ? shop.rect.x : shop.rect.z,
        facade: facadeCoord,
        outwardSign,
        frontSpan,
        alcoveDepth,
        gapM,
        lintelBottomM,
      }
      emitShopFitout(classifyXxgShop(shop), frame, fitoutBuckets, { hero: firstShop !== null })
    }

    const sign = XXG_SHOP_SIGNS[shop.id]
    if (sign) {
      emitShopSign(
        sign,
        { facingZ, cu: facingZ ? shop.rect.x : shop.rect.z, facade: facadeCoord, outwardSign, openFace, frontSpan, lintelBottomM, ceilH },
        signBuckets,
        shop.frontage === 'corr-north-retro' ? SIGN_ATLAS_RECTS[DISCOUNT_TAGS[si % DISCOUNT_TAGS.length]!] : undefined,
      )
    }
  }

  if (namedShops.length > 4) {
    // Architectural backlit display vitrines & cove lights along the long E1 entrance gallery (-20.2..-15.8)
    for (const pz of [14.5, 9.8]) {
      wallPinkSpecs.push(
        { cx: -20.16, cy: 1.45, cz: pz, sx: 0.06, sy: 1.75, sz: 2.6 },
        { cx: -15.84, cy: 1.45, cz: pz, sx: 0.06, sy: 1.75, sz: 2.6 },
      )
      rackMetalSpecs.push(
        { cx: -20.12, cy: 2.34, cz: pz, sx: 0.08, sy: 0.05, sz: 2.66 },
        { cx: -20.12, cy: 0.56, cz: pz, sx: 0.08, sy: 0.05, sz: 2.66 },
        { cx: -15.88, cy: 2.34, cz: pz, sx: 0.08, sy: 0.05, sz: 2.66 },
        { cx: -15.88, cy: 0.56, cz: pz, sx: 0.08, sy: 0.05, sz: 2.66 },
      )
      lightWarmSpecs.push(
        { cx: -20.1, cy: 2.28, cz: pz, sx: 0.04, sy: 0.04, sz: 2.4 },
        { cx: -15.9, cy: 2.28, cz: pz, sx: 0.04, sy: 0.04, sz: 2.4 },
      )
    }
  }

  // Four stairwells, built like the street-side model: granite flight and walls, bronze nosings,
  // aluminium door frame and handrails, warm strip under the rails, a safety exit sign over the B1 door.
  const wellBuckets = {
    stone: stairSpecs,
    nosing: stairNosingSpecs,
    frame: skylightFrameGeos,
    dark: rackMetalSpecs,
    lit: wellLitGeos,
    exitSigns: exitSignGeos,
  }
  wells.forEach((w, i) => {
    buildIndoorWellGeometry(w, wellBuckets)
    const v = vestibules[i]
    if (!v) return
    const lx = snapCell((v.minX + v.maxX) * 0.5)
    const lz = snapCell((v.minZ + v.maxZ) * 0.5)
    if (!lampCenters.some(p => Math.abs(p.x - lx) < 1.5 && Math.abs(p.z - lz) < 1.5)) {
      lampCenters.push({ x: lx, z: lz })
      lightCoolSpecs.push({ cx: lx, cy: ceilH - 0.004, cz: lz, sx: XXG_LAMP_SIZE_M, sy: 0.01, sz: XXG_LAMP_SIZE_M })
    }
  })

  // 采光井开洞：吊顶板按井口挖空，井口里的吊顶灯片一并去掉。
  let carvedCeiling: BoxSpec[] = ceilingSpecs
  for (const hole of ceilingHoles) carvedCeiling = carvedCeiling.flatMap(b => carveBoxXZ(b, hole))
  ceilingSpecs.length = 0
  ceilingSpecs.push(...carvedCeiling)
  for (const bucket of [lightCoolSpecs, lightWarmSpecs]) {
    const kept = bucket.filter(b => b.cy < ceilH - 0.1 || !ceilingHoles.some(h => rectContains(h, b.cx, b.cz)))
    bucket.length = 0
    bucket.push(...kept)
  }

  addBatchBoxes('xxg_floor_renovated', floorRenovatedSpecs, matPack.floorRenovated)
  addBatchBoxes('xxg_floor_terrazzo', floorTerrazzoSpecs, matPack.floorTerrazzo)
  addBatchBoxes('xxg_wall_corridor', wallCorridorSpecs, matPack.wallCorridor)
  addBatchBoxes('xxg_wall_boutique_pink', wallPinkSpecs, matPack.wallBoutiquePink)
  addBatchBoxes('xxg_shutter_silver', shutterSilverSpecs, matPack.rollerShutterSilver)
  addBatchBoxes('xxg_shutter_cream', shutterCreamSpecs, matPack.rollerShutterCream)
  addBatchBoxes('xxg_storefront_glass', storefrontGlassSpecs, matPack.storefrontGlass)
  addBatchBoxes('xxg_ceiling_grid', ceilingSpecs, matPack.ceilingGrid)
  addBatchBoxes('xxg_light_cool', lightCoolSpecs, matPack.lightStripCool)
  const warmParts = [...wellLitGeos]
  if (lightWarmSpecs.length > 0) warmParts.unshift(buildMergedBoxesGeometry(lightWarmSpecs, uvScaleFrom(matPack.lightStripWarm)).geom)
  addMergedGeos('xxg_light_warm', warmParts, matPack.lightStripWarm, true)
  addBatchBoxes('xxg_rack_metal', rackMetalSpecs, matPack.rackMetal)
  if (garmentWineSpecs.length > 0) {
    addBatchBoxes(
      'xxg_garment_wine',
      garmentWineSpecs,
      new THREE.MeshStandardMaterial({ name: 'xxg_garment_wine', color: '#7d293b', roughness: 0.78, metalness: 0.04 }),
      false,
    )
  }
  if (garmentNavySpecs.length > 0) {
    addBatchBoxes(
      'xxg_garment_navy',
      garmentNavySpecs,
      new THREE.MeshStandardMaterial({ name: 'xxg_garment_navy', color: '#243d63', roughness: 0.8, metalness: 0.05 }),
      false,
    )
  }
  if (woodCamelSpecs.length > 0) {
    addBatchBoxes(
      'xxg_wood_camel',
      woodCamelSpecs,
      new THREE.MeshStandardMaterial({ name: 'xxg_wood_camel', color: '#b87c3e', roughness: 0.72, metalness: 0.04 }),
      false,
    )
  }
  addBatchBoxes('xxg_stair_granite', stairSpecs, matPack.stairGranite)
  addBatchBoxes(
    'xxg_stair_nosing_bronze',
    stairNosingSpecs,
    new THREE.MeshStandardMaterial({ name: 'xxg_stair_nosing_bronze', color: '#52584f', roughness: 0.42, metalness: 0.55 }),
    false,
  )
  // Pyramid glass and any fixed glazing share one draw call; the door leaves are their own two dynamic meshes.
  const skylightGlassParts = [...pyramidGlassGeos]
  if (skylightGlassSpecs.length > 0) {
    skylightGlassParts.push(buildMergedBoxesGeometry(skylightGlassSpecs, uvScaleFrom(matPack.skylightGlass)).geom)
  }
  addMergedGeos('xxg_skylight_glass', skylightGlassParts, matPack.skylightGlass, true)
  addMergedGeos('xxg_globe_lamps', globeSpecs, matPack.globeLamp, true)
  const frameMat = new THREE.MeshStandardMaterial({
    name: 'xxg_skylight_frame',
    color: '#e3e7ea',
    emissive: '#4a4f54',
    roughness: 0.38,
    metalness: 0.42,
  })
  if (!addMergedGeos('xxg_skylight_frame', skylightFrameGeos, frameMat, false)) extraMaterials.push(frameMat)
  const wellDoors = createWellDoors(wells, matPack.skylightGlass, frameMat)
  usedPackMats.add(matPack.skylightGlass)
  scene.add(wellDoors.glass, wellDoors.frame)
  meshes.push(wellDoors.glass, wellDoors.frame)
  geometries.push(wellDoors.glass.geometry, wellDoors.frame.geometry)
  triangleCount += wellDoors.triangles
  if (goodsSpecs.length > 0) {
    addBatchBoxes(
      'xxg_shop_goods',
      goodsSpecs,
      new THREE.MeshStandardMaterial({ name: 'xxg_shop_goods', vertexColors: true, roughness: 0.62, metalness: 0.04 }),
      false,
    )
  }
  if (ceilingHoles.length > 0) {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const h of ceilingHoles) {
      minX = Math.min(minX, h.minX)
      maxX = Math.max(maxX, h.maxX)
      minZ = Math.min(minZ, h.minZ)
      maxZ = Math.max(maxZ, h.maxZ)
    }
    const skyGeo = buildSkyCapGeometry({ minX: minX - 30, maxX: maxX + 30, minZ: minZ - 30, maxZ: maxZ + 30 }, ceilH + 7.5)
    addMergedGeos(
      'xxg_sky_cap',
      [skyGeo],
      new THREE.MeshBasicMaterial({ name: 'xxg_sky_cap', vertexColors: true, fog: false, side: THREE.DoubleSide }),
      false,
    )
  }
  addMergedGeos('xxg_shop_signs', shopSignGeos, matPack.signAtlasMat, true)
  addMergedGeos('xxg_shop_signs_paint', shopSignPaintGeos, matPack.signPaintMat, true)

  if (exitSignGeos.length > 0) {
    const { texture, bytes } = createSafetyExitSignTexture()
    textureBytes += bytes
    extraTextures.push(texture)
    const exitMat = new THREE.MeshBasicMaterial({
      name: 'xxg_exit_sign_face',
      map: texture,
      side: THREE.DoubleSide,
    })
    addMergedGeos('xxg_exit_signs', exitSignGeos, exitMat, false)
  }

  const allPackMats: THREE.Material[] = [
    matPack.floorTerrazzo,
    matPack.floorRenovated,
    matPack.wallCorridor,
    matPack.wallBoutiquePink,
    matPack.ceilingGrid,
    matPack.lightStripCool,
    matPack.lightStripWarm,
    matPack.globeLamp,
    matPack.skylightGlass,
    matPack.storefrontGlass,
    matPack.rollerShutterSilver,
    matPack.rollerShutterCream,
    matPack.stairGranite,
    matPack.signAtlasMat,
    matPack.signPaintMat,
    matPack.rackMetal,
  ]
  for (const m of allPackMats) {
    if (!usedPackMats.has(m)) m.dispose()
  }

  const hemi = new THREE.HemisphereLight('#fff0dc', '#c9b8a2', 0.92)
  hemi.position.set(-48, ceilH, 0)
  const dirA = new THREE.DirectionalLight('#fff2dd', 0.18)
  dirA.position.set(-42, 18.0, -14.0)
  const dirB = new THREE.DirectionalLight('#eef3ff', 0.14)
  dirB.position.set(-42, 18.0, 14.0)
  scene.add(hemi, dirA, dirB)
  scene.updateMatrixWorld(true)

  let disposed = false
  return {
    scene,
    meshCount: meshes.length,
    triangleCount,
    textureBytes,
    geometryCount: geometries.length,
    materialCount: usedPackMats.size + extraMaterials.length,
    columnCenters,
    skylightOpenings: ceilingHoles,
    wellDoors,
    isDisposed: () => disposed,
    dispose() {
      if (disposed) return
      disposed = true
      for (const m of meshes) scene.remove(m)
      scene.remove(hemi, dirA, dirB)
      for (const g of geometries) g.dispose()
      for (const m of extraMaterials) m.dispose()
      for (const tex of extraTextures) tex.dispose()
      matPack.dispose()
      meshes.length = 0
      geometries.length = 0
      extraMaterials.length = 0
      extraTextures.length = 0
      usedPackMats.clear()
      scene.clear()
    },
  }
}
