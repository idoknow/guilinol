import * as THREE from 'three'
import type { XxgLayout, XxgShop } from '../contract.ts'
import {
  SIGN_ATLAS_RECTS,
  applySignAtlasRect,
  createXiaoxianggangMaterials,
  resolveShopLook,
  type SignAtlasSlot,
} from '../look/index.ts'
import { corridorToAabb, rectToAabb, type Aabb2D } from './collision.ts'

interface BoxSpec {
  readonly cx: number
  readonly cy: number
  readonly cz: number
  readonly sx: number
  readonly sy: number
  readonly sz: number
}

export interface IndoorGreyboxSceneHandle {
  readonly scene: THREE.Scene
  readonly meshCount: number
  readonly triangleCount: number
  readonly textureBytes: number
  readonly geometryCount: number
  readonly materialCount: number
  isDisposed(): boolean
  dispose(): void
}

function buildMergedBoxesGeometry(
  specs: readonly BoxSpec[],
  uvScale: readonly [number, number] = [1, 1],
): { geom: THREE.BufferGeometry; triangles: number } {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let vertexOffset = 0
  const [su, sv] = uvScale

  for (const b of specs) {
    if (b.sx <= 0 || b.sy <= 0 || b.sz <= 0) continue
    const box = new THREE.BoxGeometry(b.sx, b.sy, b.sz)
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
      positions.push(px, py, pz)
      normals.push(nx, ny, norm.getZ(i))
      if (Math.abs(ny) > 0.5) {
        uvs.push(px * su, pz * sv)
      } else if (Math.abs(nx) > 0.5) {
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

function mergeGeometries(parts: readonly THREE.BufferGeometry[]): {
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

function makeSignQuad(
  cx: number,
  cy: number,
  cz: number,
  width: number,
  height: number,
  facing: '-x' | '+x' | '-z' | '+z',
  slot: SignAtlasSlot,
): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height)
  applySignAtlasRect(g, slot, 2)
  if (facing === '-z') g.rotateY(Math.PI)
  else if (facing === '+x') g.rotateY(Math.PI / 2)
  else if (facing === '-x') g.rotateY(-Math.PI / 2)
  g.translate(cx, cy, cz)
  return g
}

const ZONE_SIGN_FALLBACK: Readonly<Record<string, readonly SignAtlasSlot[]>> = {
  'corr-main-ew': ['atriumTiaodiao', 'boutiqueB181', 'boutiqueJiulin', 'portal10Glass', 'store1987'],
  'corr-atrium-hub': ['atriumTiaodiao', 'boutiqueB181'],
  'corr-atrium-ns': ['atriumTiaodiao', 'boutiqueYuyu', 'stallYilianMid12'],
  'corr-skylight-ns': ['portal17Gold', 'portal18Navy', 'boutiqueB181'],
  'corr-north-terrazzo': ['boutiqueYuyu', 'boutiqueJiulin', 'boutiqueB181'],
  'corr-north-retro': ['alleyHkStreet', 'store1987', 'discountTag19', 'discountTag29', 'discountTag39', 'discountTag49'],
  'corr-south-mid': ['stallYilianMid12', 'boutiqueYuyu', 'atriumTiaodiao'],
  'corr-south-boutique': ['boutiqueB181', 'store1987', 'boutiqueJiulin'],
}

const DISCOUNT_TAGS: readonly SignAtlasSlot[] = ['discountTag19', 'discountTag29', 'discountTag39', 'discountTag49']

function pickStoreSignSlot(
  resolved: ReturnType<typeof resolveShopLook>,
  frontage: string,
  shopIndex: number,
): SignAtlasSlot {
  if (resolved.kind === 'sign-atlas' && resolved.slot in SIGN_ATLAS_RECTS) {
    return resolved.slot
  }
  const pool = ZONE_SIGN_FALLBACK[frontage] ?? ['boutiqueB181', 'alleyHkStreet', 'store1987', 'stallYilianMid12']
  return pool[shopIndex % pool.length]!
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

/**
 * Builds the standalone B1 indoor THREE.Scene from any validated XxgLayout.
 * Strictly <= 40 draw calls (~16 batched PBR meshes), <= 150k triangles, zero dependency on world.ts or terrain.
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
  const corridorKindsById = new Map(layout.corridors.map(c => [c.id, c.kind]))
  const stairBoxes = layout.exits.map(e => rectToAabb(`stair-${e.portalId}`, e.stair))

  const namedShops = layout.shops.filter(s => Boolean(s.name && s.name.trim().length > 0))
  const shopGeoms = layout.shops.map(shop => {
    const sb = rectToAabb(shop.id, shop.rect)
    const front = corridorsById.get(shop.frontage)
    return { shop, sb, front, geom: resolveShopFrontageGeometry(shop, sb, front) }
  })

  const openFootprints: Aabb2D[] = [...corridorBoxes, ...stairBoxes]
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
  const skylightGlassSpecs: BoxSpec[] = []
  const globeSpecs: THREE.BufferGeometry[] = []
  const shopSignGeos: THREE.BufferGeometry[] = []
  const exitSignGeos: THREE.BufferGeometry[] = []

  const skylightZones = namedShops.length > 4
    ? [
        { cx: -36.0, cz: -25.5, r: 3.1 },
        { cx: -36.0, cz: 25.5, r: 3.1 },
      ]
    : []

  for (let ci = 0; ci < layout.corridors.length; ci++) {
    const c = layout.corridors[ci]!
    const b = corridorBoxes[ci]!
    const isRenovated = c.kind === 'main'
    const floorTarget = isRenovated ? floorRenovatedSpecs : floorTerrazzoSpecs
    floorTarget.push({
      cx: (b.minX + b.maxX) * 0.5,
      cy: -0.06,
      cz: (b.minZ + b.maxZ) * 0.5,
      sx: b.maxX - b.minX + 0.2,
      sy: 0.12,
      sz: b.maxZ - b.minZ + 0.2,
    })

    emitEdgeWallSegments(wallCorridorSpecs, rackMetalSpecs, b.minZ, b.minX, b.maxX, 'x', -1, wallT, ceilH, openFootprints)
    emitEdgeWallSegments(wallCorridorSpecs, rackMetalSpecs, b.maxZ, b.minX, b.maxX, 'x', 1, wallT, ceilH, openFootprints)
    emitEdgeWallSegments(wallCorridorSpecs, rackMetalSpecs, b.minX, b.minZ, b.maxZ, 'z', -1, wallT, ceilH, openFootprints)
    emitEdgeWallSegments(wallCorridorSpecs, rackMetalSpecs, b.maxX, b.minZ, b.maxZ, 'z', 1, wallT, ceilH, openFootprints)

    const w = b.maxX - b.minX
    const d = b.maxZ - b.minZ
    const skipFullCeiling = c.id === 'corr-skylight-ns' && skylightZones.length > 0
    if (skipFullCeiling) {
      ceilingSpecs.push({
        cx: (b.minX + b.maxX) * 0.5,
        cy: ceilH + 0.06,
        cz: 0,
        sx: w + 0.4,
        sy: 0.12,
        sz: 42.0,
      })
    } else {
      ceilingSpecs.push({
        cx: (b.minX + b.maxX) * 0.5,
        cy: ceilH + 0.06,
        cz: (b.minZ + b.maxZ) * 0.5,
        sx: w + 0.4,
        sy: 0.12,
        sz: d + 0.4,
      })
    }

    const lampBucket = isRenovated ? lightCoolSpecs : lightWarmSpecs
    if (w >= d) {
      const midZ = (b.minZ + b.maxZ) * 0.5
      const rowOff = Math.min(1.35, d * 0.26)
      for (let lx = b.minX + 2.4; lx <= b.maxX - 2.0; lx += 5.4) {
        lampBucket.push(
          { cx: lx, cy: ceilH - 0.015, cz: midZ - rowOff, sx: 0.58, sy: 0.025, sz: 0.58 },
          { cx: lx, cy: ceilH - 0.015, cz: midZ + rowOff, sx: 0.58, sy: 0.025, sz: 0.58 },
        )
      }
      if (isRenovated) {
        lightWarmSpecs.push({
          cx: (b.minX + b.maxX) * 0.5,
          cy: ceilH - 0.014,
          cz: midZ,
          sx: Math.max(1, w - 3.0),
          sy: 0.02,
          sz: 0.08,
        })
      }
    } else {
      const midX = (b.minX + b.maxX) * 0.5
      const colOff = Math.min(1.2, w * 0.25)
      for (let lz = b.minZ + 2.4; lz <= b.maxZ - 2.0; lz += 5.4) {
        if (skipFullCeiling && skylightZones.some(z => Math.abs(lz - z.cz) < 3.6)) continue
        lampBucket.push(
          { cx: midX - colOff, cy: ceilH - 0.015, cz: lz, sx: 0.58, sy: 0.025, sz: 0.58 },
          { cx: midX + colOff, cy: ceilH - 0.015, cz: lz, sx: 0.58, sy: 0.025, sz: 0.58 },
        )
      }
    }
  }

  for (const sky of skylightZones) {
    const wellHalf = 2.6
    const wellTop = ceilH + 1.9
    wallCorridorSpecs.push(
      { cx: sky.cx, cy: (ceilH + wellTop) * 0.5, cz: sky.cz - wellHalf, sx: wellHalf * 2, sy: wellTop - ceilH, sz: 0.22 },
      { cx: sky.cx, cy: (ceilH + wellTop) * 0.5, cz: sky.cz + wellHalf, sx: wellHalf * 2, sy: wellTop - ceilH, sz: 0.22 },
      { cx: sky.cx - wellHalf, cy: (ceilH + wellTop) * 0.5, cz: sky.cz, sx: 0.22, sy: wellTop - ceilH, sz: wellHalf * 2 },
      { cx: sky.cx + wellHalf, cy: (ceilH + wellTop) * 0.5, cz: sky.cz, sx: 0.22, sy: wellTop - ceilH, sz: wellHalf * 2 },
    )
    skylightGlassSpecs.push({ cx: sky.cx, cy: wellTop, cz: sky.cz, sx: wellHalf * 2, sy: 0.06, sz: wellHalf * 2 })
    for (const gx of [-1.0, 1.0]) {
      for (const gz of [-1.0, 1.0]) {
        const dropY = ceilH - 0.15
        rackMetalSpecs.push({ cx: sky.cx + gx, cy: (wellTop + dropY) * 0.5, cz: sky.cz + gz, sx: 0.03, sy: wellTop - dropY, sz: 0.03 })
        const g = new THREE.IcosahedronGeometry(0.16, 1)
        g.translate(sky.cx + gx, dropY, sky.cz + gz)
        globeSpecs.push(g)
      }
    }
  }

  const colSize = layout.columns.size
  for (const cx of layout.columns.xs) {
    for (const cz of layout.columns.zs) {
      if (!pointInsideAnyAabb(cx, cz, corridorBoxes, -0.3)) continue
      const nearExit = layout.exits.some(e => Math.hypot(e.foot.x - cx, e.foot.z - cz) < 1.6)
      if (nearExit) continue
      wallCorridorSpecs.push({ cx, cy: ceilH * 0.5, cz, sx: colSize, sy: ceilH, sz: colSize })
      rackMetalSpecs.push({ cx, cy: 0.08, cz, sx: colSize + 0.05, sy: 0.16, sz: colSize + 0.05 })
    }
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

    const resolved = resolveShopLook(matPack, shop.lookKey)
    const isPink = shop.lookKey === 'wallBoutiquePink' || shop.lookKey === 'boutiqueB181' || shop.lookKey === 'boutiqueYuyu'
    const isShutterSilver = shop.lookKey === 'rollerShutterSilver'
    const isShutterCream = shop.lookKey === 'rollerShutterCream'
    const isShuttered = isShutterSilver || isShutterCream

    const alcoveDepth = gapM + (isShuttered ? 0.22 : Math.min(0.65, frontDepth * 0.32))
    const sideWallTarget = isPink ? wallPinkSpecs : wallCorridorSpecs
    const backPlaneCoord = facadeCoord - outwardSign * alcoveDepth
    const shopFloorBucket = corridorKindsById.get(shop.frontage) === 'main' ? floorRenovatedSpecs : floorTerrazzoSpecs

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
      const glassPaneCoord = facadeCoord - outwardSign * 0.06
      const windowRecessCoord = facadeCoord - outwardSign * Math.min(alcoveDepth * 0.48, gapM + 0.22)
      const rackCoord = facadeCoord - outwardSign * Math.min(alcoveDepth * 0.56, gapM + 0.16)
      const shelfCoord = backPlaneCoord + outwardSign * 0.16
      const trimCoord = facadeCoord - outwardSign * 0.02
      const winCenterOff = -frontSpan * 0.26
      const doorCenterOff = frontSpan * 0.11
      const winSpan = Math.max(0.56, frontSpan * 0.4)
      const rackLen = Math.max(0.84, frontSpan * 0.4)
      const shelfLen = Math.max(1.1, frontSpan - 0.56)

      if (facingZ) {
        const winX = shop.rect.x + winCenterOff
        const doorX = shop.rect.x + doorCenterOff
        lightWarmSpecs.push(
          { cx: shop.rect.x, cy: lintelBottomM - 0.03, cz: facadeCoord - outwardSign * 0.26, sx: Math.max(0.8, frontSpan - 0.48), sy: 0.04, sz: 0.18 },
          { cx: shop.rect.x, cy: lintelBottomM - 0.18, cz: backPlaneCoord + outwardSign * 0.08, sx: Math.max(0.8, frontSpan - 0.56), sy: 0.045, sz: 0.07 },
          { cx: shop.rect.x, cy: 1.56, cz: shelfCoord, sx: shelfLen - 0.08, sy: 0.025, sz: 0.04 },
        )
        wallCorridorSpecs.push({ cx: winX, cy: 0.2, cz: trimCoord - outwardSign * 0.04, sx: winSpan, sy: 0.4, sz: 0.12 })
        storefrontGlassSpecs.push({
          cx: winX,
          cy: (0.4 + lintelBottomM - 0.06) * 0.5,
          cz: glassPaneCoord,
          sx: winSpan - 0.06,
          sy: lintelBottomM - 0.48,
          sz: 0.03,
        })
        shutterCreamSpecs.push(
          { cx: winX, cy: 0.51, cz: windowRecessCoord, sx: Math.min(0.72, winSpan * 0.62), sy: 0.06, sz: 0.44 },
          { cx: winX, cy: 1.24, cz: windowRecessCoord, sx: 0.13, sy: 0.16, sz: 0.13 },
          { cx: doorX - rackLen * 0.22, cy: 1.07, cz: rackCoord, sx: rackLen * 0.15, sy: 0.78, sz: 0.26 },
        )
        garmentWineSpecs.push(
          { cx: winX, cy: 0.72, cz: windowRecessCoord, sx: 0.34, sy: 0.34, sz: 0.26 },
          { cx: doorX - rackLen * 0.36, cy: 1.05, cz: rackCoord, sx: rackLen * 0.16, sy: 0.84, sz: 0.28 },
          { cx: doorX + rackLen * 0.24, cy: 1.07, cz: rackCoord, sx: rackLen * 0.15, sy: 0.78, sz: 0.28 },
          { cx: shop.rect.x - shelfLen * 0.26, cy: 1.72, cz: shelfCoord, sx: shelfLen * 0.22, sy: 0.2, sz: 0.22 },
          { cx: shop.rect.x + shelfLen * 0.22, cy: 1.22, cz: shelfCoord, sx: shelfLen * 0.22, sy: 0.2, sz: 0.22 },
        )
        garmentNavySpecs.push(
          { cx: winX, cy: 1.02, cz: windowRecessCoord, sx: 0.24, sy: 0.28, sz: 0.18 },
          { cx: doorX - rackLen * 0.06, cy: 1.06, cz: rackCoord, sx: rackLen * 0.16, sy: 0.82, sz: 0.28 },
          { cx: doorX + rackLen * 0.37, cy: 1.09, cz: rackCoord, sx: rackLen * 0.14, sy: 0.74, sz: 0.26 },
          { cx: shop.rect.x + shelfLen * 0.22, cy: 1.72, cz: shelfCoord, sx: shelfLen * 0.22, sy: 0.2, sz: 0.22 },
          { cx: shop.rect.x - shelfLen * 0.2, cy: 1.22, cz: shelfCoord, sx: shelfLen * 0.22, sy: 0.18, sz: 0.22 },
        )
        woodCamelSpecs.push(
          { cx: doorX + rackLen * 0.09, cy: 1.05, cz: rackCoord, sx: rackLen * 0.16, sy: 0.84, sz: 0.28 },
          { cx: shop.rect.x, cy: 0.24, cz: shelfCoord, sx: shelfLen, sy: 0.48, sz: 0.28 },
          { cx: shop.rect.x - shelfLen * 0.42, cy: 1.02, cz: shelfCoord, sx: 0.09, sy: 2.04, sz: 0.28 },
          { cx: shop.rect.x + shelfLen * 0.42, cy: 1.02, cz: shelfCoord, sx: 0.09, sy: 2.04, sz: 0.28 },
          { cx: shop.rect.x, cy: 1.1, cz: shelfCoord, sx: shelfLen, sy: 0.05, sz: 0.26 },
          { cx: shop.rect.x, cy: 1.6, cz: shelfCoord, sx: shelfLen, sy: 0.05, sz: 0.26 },
          { cx: shop.rect.x, cy: 1.22, cz: shelfCoord, sx: shelfLen * 0.16, sy: 0.18, sz: 0.22 },
        )
        rackMetalSpecs.push(
          { cx: sb.minX + 0.21, cy: lintelBottomM * 0.5, cz: trimCoord, sx: 0.07, sy: lintelBottomM, sz: 0.09 },
          { cx: sb.maxX - 0.21, cy: lintelBottomM * 0.5, cz: trimCoord, sx: 0.07, sy: lintelBottomM, sz: 0.09 },
          { cx: winX + winSpan * 0.5, cy: lintelBottomM * 0.5, cz: trimCoord, sx: 0.06, sy: lintelBottomM, sz: 0.08 },
          { cx: winX, cy: 0.41, cz: trimCoord, sx: winSpan, sy: 0.05, sz: 0.1 },
          { cx: shop.rect.x, cy: lintelBottomM - 0.03, cz: trimCoord, sx: frontSpan - 0.26, sy: 0.07, sz: 0.11 },
          { cx: winX - 0.24, cy: 0.24, cz: windowRecessCoord, sx: 0.04, sy: 0.48, sz: 0.34 },
          { cx: winX + 0.24, cy: 0.24, cz: windowRecessCoord, sx: 0.04, sy: 0.48, sz: 0.34 },
          { cx: winX + 0.22, cy: 0.65, cz: windowRecessCoord, sx: 0.14, sy: 0.22, sz: 0.1 },
          { cx: doorX - rackLen * 0.48, cy: 0.74, cz: rackCoord, sx: 0.045, sy: 1.48, sz: 0.045 },
          { cx: doorX + rackLen * 0.48, cy: 0.74, cz: rackCoord, sx: 0.045, sy: 1.48, sz: 0.045 },
          { cx: doorX, cy: 0.06, cz: rackCoord, sx: rackLen, sy: 0.045, sz: 0.24 },
          { cx: doorX, cy: 1.47, cz: rackCoord, sx: rackLen, sy: 0.045, sz: 0.045 },
          { cx: shop.rect.x, cy: 1.72, cz: shelfCoord, sx: shelfLen * 0.16, sy: 0.22, sz: 0.22 },
        )
      } else {
        const winZ = shop.rect.z + winCenterOff
        const doorZ = shop.rect.z + doorCenterOff
        lightWarmSpecs.push(
          { cx: facadeCoord - outwardSign * 0.26, cy: lintelBottomM - 0.03, cz: shop.rect.z, sx: 0.18, sy: 0.04, sz: Math.max(0.8, frontSpan - 0.48) },
          { cx: backPlaneCoord + outwardSign * 0.08, cy: lintelBottomM - 0.18, cz: shop.rect.z, sx: 0.07, sy: 0.045, sz: Math.max(0.8, frontSpan - 0.56) },
          { cx: shelfCoord, cy: 1.56, cz: shop.rect.z, sx: 0.04, sy: 0.025, sz: shelfLen - 0.08 },
        )
        wallCorridorSpecs.push({ cx: trimCoord - outwardSign * 0.04, cy: 0.2, cz: winZ, sx: 0.12, sy: 0.4, sz: winSpan })
        storefrontGlassSpecs.push({
          cx: glassPaneCoord,
          cy: (0.4 + lintelBottomM - 0.06) * 0.5,
          cz: winZ,
          sx: 0.03,
          sy: lintelBottomM - 0.48,
          sz: winSpan - 0.06,
        })
        shutterCreamSpecs.push(
          { cx: windowRecessCoord, cy: 0.51, cz: winZ, sx: 0.44, sy: 0.06, sz: Math.min(0.72, winSpan * 0.62) },
          { cx: windowRecessCoord, cy: 1.24, cz: winZ, sx: 0.13, sy: 0.16, sz: 0.13 },
          { cx: rackCoord, cy: 1.07, cz: doorZ - rackLen * 0.22, sx: 0.26, sy: 0.78, sz: rackLen * 0.15 },
        )
        garmentWineSpecs.push(
          { cx: windowRecessCoord, cy: 0.72, cz: winZ, sx: 0.26, sy: 0.34, sz: 0.34 },
          { cx: rackCoord, cy: 1.05, cz: doorZ - rackLen * 0.36, sx: 0.28, sy: 0.84, sz: rackLen * 0.16 },
          { cx: rackCoord, cy: 1.07, cz: doorZ + rackLen * 0.24, sx: 0.28, sy: 0.78, sz: rackLen * 0.15 },
          { cx: shelfCoord, cy: 1.72, cz: shop.rect.z - shelfLen * 0.26, sx: 0.22, sy: 0.2, sz: shelfLen * 0.22 },
          { cx: shelfCoord, cy: 1.22, cz: shop.rect.z + shelfLen * 0.22, sx: 0.22, sy: 0.2, sz: shelfLen * 0.22 },
        )
        garmentNavySpecs.push(
          { cx: windowRecessCoord, cy: 1.02, cz: winZ, sx: 0.18, sy: 0.28, sz: 0.24 },
          { cx: rackCoord, cy: 1.06, cz: doorZ - rackLen * 0.06, sx: 0.28, sy: 0.82, sz: rackLen * 0.16 },
          { cx: rackCoord, cy: 1.09, cz: doorZ + rackLen * 0.37, sx: 0.26, sy: 0.74, sz: rackLen * 0.14 },
          { cx: shelfCoord, cy: 1.72, cz: shop.rect.z + shelfLen * 0.22, sx: 0.22, sy: 0.2, sz: shelfLen * 0.22 },
          { cx: shelfCoord, cy: 1.22, cz: shop.rect.z - shelfLen * 0.2, sx: 0.22, sy: 0.18, sz: shelfLen * 0.22 },
        )
        woodCamelSpecs.push(
          { cx: rackCoord, cy: 1.05, cz: doorZ + rackLen * 0.09, sx: 0.28, sy: 0.84, sz: rackLen * 0.16 },
          { cx: shelfCoord, cy: 0.24, cz: shop.rect.z, sx: 0.28, sy: 0.48, sz: shelfLen },
          { cx: shelfCoord, cy: 1.02, cz: shop.rect.z - shelfLen * 0.42, sx: 0.28, sy: 2.04, sz: 0.09 },
          { cx: shelfCoord, cy: 1.02, cz: shop.rect.z + shelfLen * 0.42, sx: 0.28, sy: 2.04, sz: 0.09 },
          { cx: shelfCoord, cy: 1.1, cz: shop.rect.z, sx: 0.26, sy: 0.05, sz: shelfLen },
          { cx: shelfCoord, cy: 1.6, cz: shop.rect.z, sx: 0.26, sy: 0.05, sz: shelfLen },
          { cx: shelfCoord, cy: 1.22, cz: shop.rect.z, sx: 0.22, sy: 0.18, sz: shelfLen * 0.16 },
        )
        rackMetalSpecs.push(
          { cx: trimCoord, cy: lintelBottomM * 0.5, cz: sb.minZ + 0.21, sx: 0.09, sy: lintelBottomM, sz: 0.07 },
          { cx: trimCoord, cy: lintelBottomM * 0.5, cz: sb.maxZ - 0.21, sx: 0.09, sy: lintelBottomM, sz: 0.07 },
          { cx: trimCoord, cy: lintelBottomM * 0.5, cz: winZ + winSpan * 0.5, sx: 0.08, sy: lintelBottomM, sz: 0.06 },
          { cx: trimCoord, cy: 0.41, cz: winZ, sx: 0.1, sy: 0.05, sz: winSpan },
          { cx: trimCoord, cy: lintelBottomM - 0.03, cz: shop.rect.z, sx: 0.11, sy: 0.07, sz: frontSpan - 0.26 },
          { cx: windowRecessCoord, cy: 0.24, cz: winZ - 0.24, sx: 0.34, sy: 0.48, sz: 0.04 },
          { cx: windowRecessCoord, cy: 0.24, cz: winZ + 0.24, sx: 0.34, sy: 0.48, sz: 0.04 },
          { cx: windowRecessCoord, cy: 0.65, cz: winZ + 0.22, sx: 0.1, sy: 0.22, sz: 0.14 },
          { cx: rackCoord, cy: 0.74, cz: doorZ - rackLen * 0.48, sx: 0.045, sy: 1.48, sz: 0.045 },
          { cx: rackCoord, cy: 0.74, cz: doorZ + rackLen * 0.48, sx: 0.045, sy: 1.48, sz: 0.045 },
          { cx: rackCoord, cy: 0.06, cz: doorZ, sx: 0.24, sy: 0.045, sz: rackLen },
          { cx: rackCoord, cy: 1.47, cz: doorZ, sx: 0.045, sy: 0.045, sz: rackLen },
          { cx: shelfCoord, cy: 1.72, cz: shop.rect.z, sx: 0.22, sy: 0.22, sz: shelfLen * 0.16 },
        )
      }
    }

    const signW = Math.min(2.55, Math.max(1.25, frontSpan * 0.78))
    const signH = Math.min(0.46, lintelH * 0.84)
    const signY = lintelBottomM + signH * 0.54
    const signSlot = pickStoreSignSlot(resolved, shop.frontage, si)
    const faceOffset = 0.04

    if (facingZ) {
      const signZ = facadeCoord + outwardSign * 0.02
      rackMetalSpecs.push({ cx: shop.rect.x, cy: signY, cz: signZ, sx: frontSpan - 0.06, sy: signH + 0.08, sz: 0.05 })
      shopSignGeos.push(makeSignQuad(shop.rect.x, signY, signZ + outwardSign * faceOffset, signW, signH, openFace, signSlot))
      if (shop.frontage === 'corr-north-retro') {
        const tagSlot = DISCOUNT_TAGS[si % DISCOUNT_TAGS.length]!
        shopSignGeos.push(makeSignQuad(shop.rect.x + frontSpan * 0.32, lintelBottomM - 0.32, signZ + outwardSign * 0.14, 0.34, 0.38, openFace, tagSlot))
      }
    } else {
      const signX = facadeCoord + outwardSign * 0.02
      rackMetalSpecs.push({ cx: signX, cy: signY, cz: shop.rect.z, sx: 0.05, sy: signH + 0.08, sz: frontSpan - 0.06 })
      shopSignGeos.push(makeSignQuad(signX + outwardSign * faceOffset, signY, shop.rect.z, signW, signH, openFace, signSlot))
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
    lightCoolSpecs.push({ cx: -18.0, cy: ceilH - 0.014, cz: 12.5, sx: 0.14, sy: 0.022, sz: 25.0 })
  }

  for (const ex of layout.exits) {
    const st = ex.stair
    const sb = rectToAabb(`stair-${ex.portalId}`, st)
    const dirX = st.x - ex.foot.x
    const dirZ = st.z - ex.foot.z
    const alongZ = Math.abs(dirZ) >= Math.abs(dirX)
    const sign = alongZ ? (dirZ >= 0 ? 1 : -1) : dirX >= 0 ? 1 : -1
    const stepCount = 9

    ceilingSpecs.push({ cx: st.x, cy: ceilH + 0.85, cz: st.z, sx: st.w + 0.8, sy: 0.16, sz: st.d + 0.8 })

    if (alongZ) {
      const startZ = sign > 0 ? sb.minZ : sb.maxZ
      const stepDepth = st.d / stepCount
      for (let i = 0; i < stepCount; i++) {
        stairSpecs.push({
          cx: st.x,
          cy: (i + 0.5) * 0.18,
          cz: startZ + sign * (i + 0.5) * stepDepth,
          sx: st.w,
          sy: 0.18,
          sz: stepDepth + 0.02,
        })
      }
      wallCorridorSpecs.push(
        { cx: sb.minX - wallT * 0.5, cy: (ceilH + 0.8) * 0.5, cz: st.z, sx: wallT, sy: ceilH + 0.8, sz: st.d + 0.4 },
        { cx: sb.maxX + wallT * 0.5, cy: (ceilH + 0.8) * 0.5, cz: st.z, sx: wallT, sy: ceilH + 0.8, sz: st.d + 0.4 },
        { cx: st.x, cy: ceilH - 0.22, cz: startZ - sign * 0.12, sx: st.w + wallT * 2, sy: 0.44, sz: wallT },
      )
      for (const frac of [0.18, 0.52, 0.86]) {
        rackMetalSpecs.push({ cx: st.x, cy: frac * 1.6 + 0.42, cz: startZ + sign * st.d * frac, sx: 0.045, sy: 0.84, sz: 0.045 })
      }
      rackMetalSpecs.push(
        { cx: st.x, cy: 1.05, cz: startZ + sign * st.d * 0.35, sx: 0.05, sy: 0.06, sz: st.d * 0.36 },
        { cx: st.x, cy: 1.62, cz: startZ + sign * st.d * 0.69, sx: 0.05, sy: 0.06, sz: st.d * 0.36 },
      )
      const backZ = startZ + sign * (st.d + 0.08)
      skylightGlassSpecs.push({ cx: st.x, cy: 2.65, cz: backZ, sx: st.w, sy: 1.75, sz: 0.08 })
      for (const mx of [-st.w * 0.28, 0, st.w * 0.28]) {
        rackMetalSpecs.push({ cx: st.x + mx, cy: 2.65, cz: backZ - sign * 0.05, sx: 0.05, sy: 1.75, sz: 0.06 })
      }
      const signZ = startZ - sign * 0.28
      rackMetalSpecs.push(
        { cx: st.x - 0.32, cy: ceilH - 0.24, cz: signZ, sx: 0.025, sy: 0.48, sz: 0.025 },
        { cx: st.x + 0.32, cy: ceilH - 0.24, cz: signZ, sx: 0.025, sy: 0.48, sz: 0.025 },
        { cx: st.x, cy: ceilH - 0.52, cz: signZ + sign * 0.02, sx: 0.94, sy: 0.32, sz: 0.04 },
      )
      const pg = new THREE.PlaneGeometry(0.88, 0.28)
      if (sign > 0) pg.rotateY(Math.PI)
      pg.translate(st.x, ceilH - 0.52, signZ - sign * 0.008)
      exitSignGeos.push(pg)
    } else {
      const startX = sign > 0 ? sb.minX : sb.maxX
      const stepDepth = st.w / stepCount
      for (let i = 0; i < stepCount; i++) {
        stairSpecs.push({
          cx: startX + sign * (i + 0.5) * stepDepth,
          cy: (i + 0.5) * 0.18,
          cz: st.z,
          sx: stepDepth + 0.02,
          sy: 0.18,
          sz: st.d,
        })
      }
      wallCorridorSpecs.push(
        { cx: st.x, cy: (ceilH + 0.8) * 0.5, cz: sb.minZ - wallT * 0.5, sx: st.w + 0.4, sy: ceilH + 0.8, sz: wallT },
        { cx: st.x, cy: (ceilH + 0.8) * 0.5, cz: sb.maxZ + wallT * 0.5, sx: st.w + 0.4, sy: ceilH + 0.8, sz: wallT },
      )
      const backX = startX + sign * (st.w + 0.08)
      skylightGlassSpecs.push({ cx: backX, cy: 2.65, cz: st.z, sx: 0.08, sy: 1.75, sz: st.d })
      const signX = startX - sign * 0.28
      rackMetalSpecs.push(
        { cx: signX, cy: ceilH - 0.24, cz: st.z - 0.32, sx: 0.025, sy: 0.48, sz: 0.025 },
        { cx: signX, cy: ceilH - 0.24, cz: st.z + 0.32, sx: 0.025, sy: 0.48, sz: 0.025 },
        { cx: signX + sign * 0.02, cy: ceilH - 0.52, cz: st.z, sx: 0.04, sy: 0.32, sz: 0.94 },
      )
      const pg = new THREE.PlaneGeometry(0.88, 0.28)
      pg.rotateY(sign > 0 ? -Math.PI / 2 : Math.PI / 2)
      pg.translate(signX - sign * 0.008, ceilH - 0.52, st.z)
      exitSignGeos.push(pg)
    }
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
  addBatchBoxes('xxg_light_warm', lightWarmSpecs, matPack.lightStripWarm)
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
  addBatchBoxes('xxg_skylight_glass', skylightGlassSpecs, matPack.skylightGlass)
  addMergedGeos('xxg_globe_lamps', globeSpecs, matPack.globeLamp, true)
  addMergedGeos('xxg_shop_signs', shopSignGeos, matPack.signAtlasMat, true)

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
