import * as THREE from 'three'
import type { XxgLayout } from '../contract.ts'
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

function buildMergedBoxesGeometry(specs: readonly BoxSpec[]): { geom: THREE.BufferGeometry; triangles: number } {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let vertexOffset = 0

  for (const b of specs) {
    if (b.sx <= 0 || b.sy <= 0 || b.sz <= 0) continue
    const box = new THREE.BoxGeometry(b.sx, b.sy, b.sz)
    box.translate(b.cx, b.cy, b.cz)
    const pos = box.getAttribute('position')
    const norm = box.getAttribute('normal')
    const uv = box.getAttribute('uv')
    const idx = box.getIndex()

    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
      normals.push(norm.getX(i), norm.getY(i), norm.getZ(i))
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0)
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

/**
 * Generates perimeter wall segments along a box edge [t0, t1], omitting intervals that open into adjacent walkable spaces.
 */
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

/**
 * Builds the standalone Stage 1 greybox THREE.Scene from any validated XxgLayout.
 * Strictly <= 40 draw calls (~10 draw calls), <= 150k triangles, zero dependency on world.ts or terrain.
 */
export function createIndoorGreyboxScene(layout: XxgLayout): IndoorGreyboxSceneHandle {
  const scene = new THREE.Scene()
  scene.name = 'xxg-indoor-greybox-scene'
  scene.background = new THREE.Color('#c8d2d8')
  scene.fog = new THREE.Fog('#cfc9be', 28, 72)

  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []
  const meshes: THREE.Mesh[] = []
  let triangleCount = 0
  let textureBytes = 0

  const addBatchMesh = (name: string, specs: readonly BoxSpec[], material: THREE.Material): THREE.Mesh | null => {
    if (specs.length === 0) {
      material.dispose()
      return null
    }
    const { geom, triangles } = buildMergedBoxesGeometry(specs)
    triangleCount += triangles
    geometries.push(geom)
    materials.push(material)
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
  const lintelBottomM = Math.min(2.45, ceilH - 0.55)

  const corridorBoxes = layout.corridors.map(corridorToAabb)
  const corridorsById = new Map(layout.corridors.map(c => [c.id, corridorToAabb(c)]))
  const stairBoxes = layout.exits.map(e => rectToAabb(`stair-${e.portalId}`, e.stair))

  // All open interior footprints (corridors + exit stair shafts + walk-in empty shop bays)
  const openFootprints: Aabb2D[] = [...corridorBoxes, ...stairBoxes]
  for (const shop of layout.shops) {
    if (!shop.name || shop.name.trim().length === 0) {
      openFootprints.push(rectToAabb(shop.id, shop.rect))
    }
  }

  // 1. Corridor floors
  const corridorFloorSpecs: BoxSpec[] = corridorBoxes.map(b => ({
    cx: (b.minX + b.maxX) * 0.5,
    cy: -0.06,
    cz: (b.minZ + b.maxZ) * 0.5,
    sx: b.maxX - b.minX + 0.2,
    sy: 0.12,
    sz: b.maxZ - b.minZ + 0.2,
  }))
  addBatchMesh(
    'xxg_corridor_floor',
    corridorFloorSpecs,
    new THREE.MeshStandardMaterial({
      name: 'xxg_greybox_terrazzo_floor',
      color: '#d2cdc2',
      roughness: 0.78,
      metalness: 0.03,
      emissive: '#e8e2d5',
      emissiveIntensity: 0.08,
    }),
  )

  // 2. Shop bay floors (distinct warm limestone contrast)
  const shopFloorSpecs: BoxSpec[] = layout.shops.map(s => ({
    cx: s.rect.x,
    cy: -0.05,
    cz: s.rect.z,
    sx: s.rect.w,
    sy: 0.10,
    sz: s.rect.d,
  }))
  addBatchMesh(
    'xxg_shop_floors',
    shopFloorSpecs,
    new THREE.MeshStandardMaterial({
      name: 'xxg_greybox_bay_floor',
      color: '#bfb5a4',
      roughness: 0.82,
      metalness: 0.02,
      emissive: '#dfd6c5',
      emissiveIntensity: 0.07,
    }),
  )

  // 3. Corridor perimeter walls, structural columns, and stairwell side shafts
  const corridorWallSpecs: BoxSpec[] = []
  const shopWallSpecs: BoxSpec[] = []
  const frameSpecs: BoxSpec[] = []
  const ceilingSpecs: BoxSpec[] = []
  const lampSpecs: BoxSpec[] = []

  for (const b of corridorBoxes) {
    emitEdgeWallSegments(corridorWallSpecs, frameSpecs, b.minZ, b.minX, b.maxX, 'x', -1, wallT, ceilH, openFootprints)
    emitEdgeWallSegments(corridorWallSpecs, frameSpecs, b.maxZ, b.minX, b.maxX, 'x', 1, wallT, ceilH, openFootprints)
    emitEdgeWallSegments(corridorWallSpecs, frameSpecs, b.minX, b.minZ, b.maxZ, 'z', -1, wallT, ceilH, openFootprints)
    emitEdgeWallSegments(corridorWallSpecs, frameSpecs, b.maxX, b.minZ, b.maxZ, 'z', 1, wallT, ceilH, openFootprints)

    const w = b.maxX - b.minX
    const d = b.maxZ - b.minZ
    ceilingSpecs.push({
      cx: (b.minX + b.maxX) * 0.5,
      cy: ceilH + 0.06,
      cz: (b.minZ + b.maxZ) * 0.5,
      sx: w + 0.5,
      sy: 0.12,
      sz: d + 0.5,
    })

    // Recessed square LED ceiling grid & floor 3m joint inlays along each corridor
    if (w >= d) {
      const midZ = (b.minZ + b.maxZ) * 0.5
      const rowOffset = Math.min(1.2, d * 0.24)
      for (let lx = b.minX + 2.0; lx <= b.maxX - 1.6; lx += 3.2) {
        lampSpecs.push(
          { cx: lx, cy: ceilH - 0.015, cz: midZ - rowOffset, sx: 0.58, sy: 0.025, sz: 0.58 },
          { cx: lx, cy: ceilH - 0.015, cz: midZ + rowOffset, sx: 0.58, sy: 0.025, sz: 0.58 },
        )
        frameSpecs.push(
          { cx: lx, cy: 0.002, cz: midZ, sx: 0.028, sy: 0.004, sz: d - 0.5 },
          { cx: lx - 1.6, cy: ceilH - 0.008, cz: midZ, sx: 0.04, sy: 0.016, sz: d - 0.1 },
        )
      }
      for (const rz of [midZ - rowOffset * 1.45, midZ, midZ + rowOffset * 1.45]) {
        frameSpecs.push({ cx: (b.minX + b.maxX) * 0.5, cy: ceilH - 0.008, cz: rz, sx: w - 0.4, sy: 0.016, sz: 0.04 })
      }
    } else {
      const midX = (b.minX + b.maxX) * 0.5
      const colOffset = Math.min(1.15, w * 0.24)
      for (let lz = b.minZ + 2.0; lz <= b.maxZ - 1.6; lz += 3.2) {
        lampSpecs.push(
          { cx: midX - colOffset, cy: ceilH - 0.015, cz: lz, sx: 0.58, sy: 0.025, sz: 0.58 },
          { cx: midX + colOffset, cy: ceilH - 0.015, cz: lz, sx: 0.58, sy: 0.025, sz: 0.58 },
        )
        frameSpecs.push(
          { cx: midX, cy: 0.002, cz: lz, sx: w - 0.5, sy: 0.004, sz: 0.028 },
          { cx: midX, cy: ceilH - 0.008, cz: lz - 1.6, sx: w - 0.1, sy: 0.016, sz: 0.04 },
        )
      }
      for (const rx of [midX - colOffset * 1.45, midX, midX + colOffset * 1.45]) {
        frameSpecs.push({ cx: rx, cy: ceilH - 0.008, cz: (b.minZ + b.maxZ) * 0.5, sx: 0.04, sy: 0.016, sz: d - 0.4 })
      }
    }
  }

  // Structural column grid
  const colSize = layout.columns.size
  for (const cx of layout.columns.xs) {
    for (const cz of layout.columns.zs) {
      if (!pointInsideAnyAabb(cx, cz, corridorBoxes, -0.3)) continue
      const nearExit = layout.exits.some(e => Math.hypot(e.foot.x - cx, e.foot.z - cz) < 1.5)
      if (nearExit) continue
      corridorWallSpecs.push({ cx, cy: ceilH * 0.5, cz, sx: colSize, sy: ceilH, sz: colSize })
      frameSpecs.push({ cx, cy: 0.07, cz, sx: colSize + 0.04, sy: 0.14, sz: colSize + 0.04 })
    }
  }

  // 4. Shop bays (open walk-in empty bays with crisp portal frames + alcove pilasters, or solid named shop blocks)
  for (const shop of layout.shops) {
    const sb = rectToAabb(shop.id, shop.rect)
    const front = corridorsById.get(shop.frontage)
    const isEmptyBay = !shop.name || shop.name.trim().length === 0

    ceilingSpecs.push({
      cx: shop.rect.x,
      cy: ceilH + 0.06,
      cz: shop.rect.z,
      sx: shop.rect.w + 0.3,
      sy: 0.12,
      sz: shop.rect.d + 0.3,
    })
    lampSpecs.push({
      cx: shop.rect.x,
      cy: ceilH - 0.015,
      cz: shop.rect.z,
      sx: Math.min(1.1, shop.rect.w * 0.35),
      sy: 0.025,
      sz: Math.min(1.4, shop.rect.d * 0.35),
    })

    if (!isEmptyBay) {
      shopWallSpecs.push({
        cx: shop.rect.x,
        cy: ceilH * 0.5,
        cz: shop.rect.z,
        sx: shop.rect.w,
        sy: ceilH,
        sz: shop.rect.d,
      })
      continue
    }

    // Determine which of the 4 sides faces the frontage corridor
    const nearX = front ? Math.max(front.minX, Math.min(shop.rect.x, front.maxX)) : shop.rect.x
    const nearZ = front ? Math.max(front.minZ, Math.min(shop.rect.z, front.maxZ)) : shop.rect.z
    const dx = nearX - shop.rect.x
    const dz = nearZ - shop.rect.z
    const openFace: '-x' | '+x' | '-z' | '+z' =
      Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? '-x' : '+x') : dz < 0 ? '-z' : '+z'

    const lintelH = ceilH - lintelBottomM
    // Emit 3 solid enclosure walls + 1 open storefront portal frame + rear architectural alcove frame
    if (openFace !== '-z') {
      shopWallSpecs.push({ cx: shop.rect.x, cy: ceilH * 0.5, cz: sb.minZ - wallT * 0.5, sx: shop.rect.w + wallT * 2, sy: ceilH, sz: wallT })
      frameSpecs.push({ cx: shop.rect.x, cy: 0.06, cz: sb.minZ + 0.02, sx: shop.rect.w, sy: 0.12, sz: 0.04 })
    }
    if (openFace !== '+z') {
      shopWallSpecs.push({ cx: shop.rect.x, cy: ceilH * 0.5, cz: sb.maxZ + wallT * 0.5, sx: shop.rect.w + wallT * 2, sy: ceilH, sz: wallT })
      frameSpecs.push({ cx: shop.rect.x, cy: 0.06, cz: sb.maxZ - 0.02, sx: shop.rect.w, sy: 0.12, sz: 0.04 })
    }
    if (openFace !== '-x') {
      shopWallSpecs.push({ cx: sb.minX - wallT * 0.5, cy: ceilH * 0.5, cz: shop.rect.z, sx: wallT, sy: ceilH, sz: shop.rect.d + wallT * 2 })
      frameSpecs.push({ cx: sb.minX + 0.02, cy: 0.06, cz: shop.rect.z, sx: 0.04, sy: 0.12, sz: shop.rect.d })
    }
    if (openFace !== '+x') {
      shopWallSpecs.push({ cx: sb.maxX + wallT * 0.5, cy: ceilH * 0.5, cz: shop.rect.z, sx: wallT, sy: ceilH, sz: shop.rect.d + wallT * 2 })
      frameSpecs.push({ cx: sb.maxX - 0.02, cy: 0.06, cz: shop.rect.z, sx: 0.04, sy: 0.12, sz: shop.rect.d })
    }

    if (openFace === '-x' || openFace === '+x') {
      const fx = openFace === '-x' ? sb.minX : sb.maxX
      const rearX = openFace === '-x' ? sb.maxX - 0.04 : sb.minX + 0.04
      corridorWallSpecs.push({ cx: fx, cy: lintelBottomM + lintelH * 0.5, cz: shop.rect.z, sx: wallT, sy: lintelH, sz: shop.rect.d })
      frameSpecs.push(
        { cx: fx, cy: lintelBottomM * 0.5, cz: sb.minZ + 0.16, sx: wallT + 0.06, sy: lintelBottomM, sz: 0.32 },
        { cx: fx, cy: lintelBottomM * 0.5, cz: sb.maxZ - 0.16, sx: wallT + 0.06, sy: lintelBottomM, sz: 0.32 },
        { cx: fx, cy: lintelBottomM - 0.05, cz: shop.rect.z, sx: wallT + 0.08, sy: 0.10, sz: shop.rect.d },
        { cx: fx, cy: 0.004, cz: shop.rect.z, sx: wallT, sy: 0.008, sz: shop.rect.d },
        // Rear wall architectural alcove molding inside empty shop bay
        { cx: rearX, cy: 1.35, cz: shop.rect.z - shop.rect.d * 0.25, sx: 0.07, sy: 2.2, sz: 0.12 },
        { cx: rearX, cy: 1.35, cz: shop.rect.z + shop.rect.d * 0.25, sx: 0.07, sy: 2.2, sz: 0.12 },
        { cx: rearX, cy: 2.42, cz: shop.rect.z, sx: 0.07, sy: 0.10, sz: shop.rect.d * 0.54 },
      )
      lampSpecs.push({ cx: fx, cy: lintelBottomM - 0.02, cz: shop.rect.z, sx: 0.16, sy: 0.025, sz: shop.rect.d - 0.7 })
    } else {
      const fz = openFace === '-z' ? sb.minZ : sb.maxZ
      const rearZ = openFace === '-z' ? sb.maxZ - 0.04 : sb.minZ + 0.04
      corridorWallSpecs.push({ cx: shop.rect.x, cy: lintelBottomM + lintelH * 0.5, cz: fz, sx: shop.rect.w, sy: lintelH, sz: wallT })
      frameSpecs.push(
        { cx: sb.minX + 0.16, cy: lintelBottomM * 0.5, cz: fz, sx: 0.32, sy: lintelBottomM, sz: wallT + 0.06 },
        { cx: sb.maxX - 0.16, cy: lintelBottomM * 0.5, cz: fz, sx: 0.32, sy: lintelBottomM, sz: wallT + 0.06 },
        { cx: shop.rect.x, cy: lintelBottomM - 0.05, cz: fz, sx: shop.rect.w, sy: 0.10, sz: wallT + 0.08 },
        { cx: shop.rect.x, cy: 0.004, cz: fz, sx: shop.rect.w, sy: 0.008, sz: wallT },
        { cx: shop.rect.x - shop.rect.w * 0.25, cy: 1.35, cz: rearZ, sx: 0.12, sy: 2.2, sz: 0.07 },
        { cx: shop.rect.x + shop.rect.w * 0.25, cy: 1.35, cz: rearZ, sx: 0.12, sy: 2.2, sz: 0.07 },
        { cx: shop.rect.x, cy: 2.42, cz: rearZ, sx: shop.rect.w * 0.54, sy: 0.10, sz: 0.07 },
      )
      lampSpecs.push({ cx: shop.rect.x, cy: lintelBottomM - 0.02, cz: fz, sx: shop.rect.w - 0.7, sy: 0.025, sz: 0.16 })
    }
  }

  // 5. Exit stairwells (ascending granite steps + grounded handrail stanchions + skylight mullions + EXIT signs)
  const stairSpecs: BoxSpec[] = []
  const skylightSpecs: BoxSpec[] = []
  const exitSignPlanes: THREE.BufferGeometry[] = []

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
      // Side stairwell walls & overhead portal lintel
      corridorWallSpecs.push(
        { cx: sb.minX - wallT * 0.5, cy: (ceilH + 0.8) * 0.5, cz: st.z, sx: wallT, sy: ceilH + 0.8, sz: st.d + 0.4 },
        { cx: sb.maxX + wallT * 0.5, cy: (ceilH + 0.8) * 0.5, cz: st.z, sx: wallT, sy: ceilH + 0.8, sz: st.d + 0.4 },
        { cx: st.x, cy: ceilH - 0.22, cz: startZ - sign * 0.12, sx: st.w + wallT * 2, sy: 0.44, sz: wallT },
      )
      // Grounded center handrail stanchions & rail
      for (const frac of [0.18, 0.52, 0.86]) {
        stairSpecs.push({
          cx: st.x,
          cy: frac * 1.6 + 0.42,
          cz: startZ + sign * st.d * frac,
          sx: 0.045,
          sy: 0.84,
          sz: 0.045,
        })
      }
      stairSpecs.push(
        { cx: st.x, cy: 1.05, cz: startZ + sign * st.d * 0.35, sx: 0.05, sy: 0.06, sz: st.d * 0.36 },
        { cx: st.x, cy: 1.62, cz: startZ + sign * st.d * 0.69, sx: 0.05, sy: 0.06, sz: st.d * 0.36 },
      )
      // Muted daylight glass skylight & mullions at top of stairs
      const backZ = startZ + sign * (st.d + 0.08)
      skylightSpecs.push({ cx: st.x, cy: 2.65, cz: backZ, sx: st.w, sy: 1.75, sz: 0.08 })
      for (const mx of [-st.w * 0.28, 0, st.w * 0.28]) {
        frameSpecs.push({ cx: st.x + mx, cy: 2.65, cz: backZ - sign * 0.05, sx: 0.05, sy: 1.75, sz: 0.06 })
      }
      frameSpecs.push(
        { cx: st.x, cy: 2.35, cz: backZ - sign * 0.05, sx: st.w, sy: 0.05, sz: 0.06 },
        { cx: st.x, cy: 3.05, cz: backZ - sign * 0.05, sx: st.w, sy: 0.05, sz: 0.06 },
      )
      // Suspended safety EXIT sign facing corridor
      const signZ = startZ - sign * 0.28
      frameSpecs.push(
        { cx: st.x - 0.32, cy: ceilH - 0.24, cz: signZ, sx: 0.025, sy: 0.48, sz: 0.025 },
        { cx: st.x + 0.32, cy: ceilH - 0.24, cz: signZ, sx: 0.025, sy: 0.48, sz: 0.025 },
        { cx: st.x, cy: ceilH - 0.52, cz: signZ + sign * 0.02, sx: 0.94, sy: 0.32, sz: 0.04 },
      )
      const pg = new THREE.PlaneGeometry(0.88, 0.28)
      if (sign > 0) pg.rotateY(Math.PI)
      pg.translate(st.x, ceilH - 0.52, signZ - sign * 0.008)
      exitSignPlanes.push(pg)
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
      corridorWallSpecs.push(
        { cx: st.x, cy: (ceilH + 0.8) * 0.5, cz: sb.minZ - wallT * 0.5, sx: st.w + 0.4, sy: ceilH + 0.8, sz: wallT },
        { cx: st.x, cy: (ceilH + 0.8) * 0.5, cz: sb.maxZ + wallT * 0.5, sx: st.w + 0.4, sy: ceilH + 0.8, sz: wallT },
      )
      const backX = startX + sign * (st.w + 0.08)
      skylightSpecs.push({ cx: backX, cy: 2.65, cz: st.z, sx: 0.08, sy: 1.75, sz: st.d })
      const signX = startX - sign * 0.28
      frameSpecs.push(
        { cx: signX, cy: ceilH - 0.24, cz: st.z - 0.32, sx: 0.025, sy: 0.48, sz: 0.025 },
        { cx: signX, cy: ceilH - 0.24, cz: st.z + 0.32, sx: 0.025, sy: 0.48, sz: 0.025 },
        { cx: signX + sign * 0.02, cy: ceilH - 0.52, cz: st.z, sx: 0.04, sy: 0.32, sz: 0.94 },
      )
      const pg = new THREE.PlaneGeometry(0.88, 0.28)
      pg.rotateY(sign > 0 ? -Math.PI / 2 : Math.PI / 2)
      pg.translate(signX - sign * 0.008, ceilH - 0.52, st.z)
      exitSignPlanes.push(pg)
    }
  }

  addBatchMesh(
    'xxg_corridor_walls',
    corridorWallSpecs,
    new THREE.MeshStandardMaterial({
      name: 'xxg_greybox_corridor_wall',
      color: '#e8e4dc',
      roughness: 0.88,
      metalness: 0.02,
      emissive: '#ece8df',
      emissiveIntensity: 0.07,
    }),
  )

  addBatchMesh(
    'xxg_shop_walls',
    shopWallSpecs,
    new THREE.MeshStandardMaterial({
      name: 'xxg_greybox_bay_wall',
      color: '#ddd7ca',
      roughness: 0.9,
      metalness: 0.02,
      emissive: '#e6dfd0',
      emissiveIntensity: 0.06,
    }),
  )

  addBatchMesh(
    'xxg_storefront_frames',
    frameSpecs,
    new THREE.MeshStandardMaterial({
      name: 'xxg_greybox_frame_trim',
      color: '#596066',
      roughness: 0.55,
      metalness: 0.24,
      emissive: '#353a3e',
      emissiveIntensity: 0.06,
    }),
  )

  addBatchMesh(
    'xxg_exit_stairs',
    stairSpecs,
    new THREE.MeshStandardMaterial({
      name: 'xxg_greybox_stair_granite',
      color: '#8d8b85',
      roughness: 0.8,
      metalness: 0.05,
      emissive: '#a8a49c',
      emissiveIntensity: 0.06,
    }),
  )

  addBatchMesh(
    'xxg_ceiling_board',
    ceilingSpecs,
    new THREE.MeshStandardMaterial({
      name: 'xxg_greybox_ceiling_board',
      color: '#e3e7ec',
      roughness: 0.88,
      metalness: 0.02,
      emissive: '#dde2e8',
      emissiveIntensity: 0.14,
    }),
  )

  addBatchMesh(
    'xxg_ceiling_lights',
    lampSpecs,
    new THREE.MeshBasicMaterial({
      name: 'xxg_greybox_led_panel',
      color: '#eef3f9',
    }),
  )

  addBatchMesh(
    'xxg_stair_skylight_backdrop',
    skylightSpecs,
    new THREE.MeshBasicMaterial({
      name: 'xxg_greybox_daylight_glass',
      color: '#b6cad6',
    }),
  )

  // Merge all 4 exit sign faces into 1 single draw call
  if (exitSignPlanes.length > 0) {
    const posArr: number[] = []
    const normArr: number[] = []
    const uvArr: number[] = []
    const idxArr: number[] = []
    let vOff = 0
    for (const pg of exitSignPlanes) {
      const p = pg.getAttribute('position')
      const n = pg.getAttribute('normal')
      const u = pg.getAttribute('uv')
      const ix = pg.getIndex()!
      for (let i = 0; i < p.count; i++) {
        posArr.push(p.getX(i), p.getY(i), p.getZ(i))
        normArr.push(n.getX(i), n.getY(i), n.getZ(i))
        uvArr.push(u.getX(i), u.getY(i))
      }
      for (let i = 0; i < ix.count; i++) idxArr.push(vOff + ix.getX(i))
      vOff += p.count
      pg.dispose()
    }
    const mergedSigns = new THREE.BufferGeometry()
    mergedSigns.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3))
    mergedSigns.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3))
    mergedSigns.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2))
    mergedSigns.setIndex(idxArr)
    mergedSigns.computeBoundingSphere()
    triangleCount += Math.floor(idxArr.length / 3)

    const { texture, bytes } = createSafetyExitSignTexture()
    textureBytes += bytes
    textures.push(texture)
    geometries.push(mergedSigns)
    const signMat = new THREE.MeshBasicMaterial({
      name: 'xxg_greybox_exit_sign_face',
      map: texture,
      side: THREE.DoubleSide,
    })
    materials.push(signMat)
    const signMesh = new THREE.Mesh(mergedSigns, signMat)
    signMesh.name = 'xxg_exit_signs'
    signMesh.frustumCulled = false
    signMesh.matrixAutoUpdate = false
    signMesh.updateMatrix()
    scene.add(signMesh)
    meshes.push(signMesh)
  }

  const hemi = new THREE.HemisphereLight('#f2f5fa', '#c5beb0', 1.15)
  hemi.position.set(-50, ceilH, 0)
  const dirA = new THREE.DirectionalLight('#fff8ec', 0.55)
  dirA.position.set(-35, 8.0, -10.0)
  const dirB = new THREE.DirectionalLight('#eef3fa', 0.34)
  dirB.position.set(-65, 6.0, 14.0)
  scene.add(hemi, dirA, dirB)
  scene.updateMatrixWorld(true)

  let disposed = false
  return {
    scene,
    meshCount: meshes.length,
    triangleCount,
    textureBytes,
    geometryCount: geometries.length,
    materialCount: materials.length,
    isDisposed: () => disposed,
    dispose() {
      if (disposed) return
      disposed = true
      for (const m of meshes) scene.remove(m)
      scene.remove(hemi, dirA, dirB)
      for (const g of geometries) g.dispose()
      for (const mat of materials) mat.dispose()
      for (const tex of textures) tex.dispose()
      meshes.length = 0
      geometries.length = 0
      materials.length = 0
      textures.length = 0
      scene.clear()
    },
  }
}
