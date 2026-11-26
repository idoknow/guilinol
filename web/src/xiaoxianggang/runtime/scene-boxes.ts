import * as THREE from 'three'

/** 轴对齐盒（中心 + 尺寸，米）。带 color 的盒子进「货品」顶点色批次，一次 draw call 画完所有小物件。 */
export interface BoxSpec {
  readonly cx: number
  readonly cy: number
  readonly cz: number
  readonly sx: number
  readonly sy: number
  readonly sz: number
  /** sRGB 十六进制，仅顶点色批次使用。 */
  readonly color?: number
}

const scratchColor = new THREE.Color()

/**
 * 把一批盒子合成一个 BufferGeometry。UV 按世界坐标投影（同一材质的平铺贴图在相邻盒子间无缝），
 * 任一盒子带 color 时整批输出 color 属性（缺省白色）。
 */
export function buildMergedBoxesGeometry(
  specs: readonly BoxSpec[],
  uvScale: readonly [number, number] = [1, 1],
): { geom: THREE.BufferGeometry; triangles: number } {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const withColor = specs.some(s => s.color !== undefined)
  let vertexOffset = 0
  const [su, sv] = uvScale

  for (const b of specs) {
    if (b.sx <= 0 || b.sy <= 0 || b.sz <= 0) continue
    const box = new THREE.BoxGeometry(b.sx, b.sy, b.sz)
    box.translate(b.cx, b.cy, b.cz)
    const pos = box.getAttribute('position')
    const norm = box.getAttribute('normal')
    const idx = box.getIndex()
    if (withColor) scratchColor.setHex(b.color ?? 0xffffff)

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
      if (withColor) colors.push(scratchColor.r, scratchColor.g, scratchColor.b)
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
  if (withColor) merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  merged.setIndex(indices)
  merged.computeBoundingSphere()
  return { geom: merged, triangles: Math.floor(indices.length / 3) }
}

/** 合并任意几何（位置/法线/UV，任一输入带顶点色时一并合并、缺省白色），合并后释放输入。 */
export function mergeGeometries(parts: readonly THREE.BufferGeometry[]): {
  geom: THREE.BufferGeometry
  triangles: number
} {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const withColor = parts.some(p => p.getAttribute('color') !== undefined)
  let vertexOffset = 0

  for (const part of parts) {
    const pos = part.getAttribute('position')
    const norm = part.getAttribute('normal')
    const uv = part.getAttribute('uv')
    const col = part.getAttribute('color')
    const idx = part.getIndex()
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
      normals.push(norm ? norm.getX(i) : 0, norm ? norm.getY(i) : 1, norm ? norm.getZ(i) : 0)
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0)
      if (withColor) colors.push(col ? col.getX(i) : 1, col ? col.getY(i) : 1, col ? col.getZ(i) : 1)
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
  if (withColor) merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  merged.setIndex(indices)
  merged.computeBoundingSphere()
  return { geom: merged, triangles: Math.floor(indices.length / 3) }
}

const Z_AXIS = new THREE.Vector3(0, 0, 1)

/** 两点之间的方截面细杆（金属框、斜梁、吊杆），返回已摆好位置的几何。 */
export function orientedBar(
  a: THREE.Vector3Like,
  b: THREE.Vector3Like,
  thickness: number,
  depth = thickness,
): THREE.BufferGeometry {
  const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z)
  const len = dir.length()
  const g = new THREE.BoxGeometry(thickness, depth, Math.max(1e-3, len))
  if (len > 1e-6) g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z_AXIS, dir.normalize()))
  g.translate((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5)
  return g
}

export interface RectXZ {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

/** 从水平盒里挖掉一个 XZ 矩形洞（采光井开口），返回剩下的 0–4 个盒子。 */
export function carveBoxXZ(box: BoxSpec, hole: RectXZ): BoxSpec[] {
  const minX = box.cx - box.sx * 0.5
  const maxX = box.cx + box.sx * 0.5
  const minZ = box.cz - box.sz * 0.5
  const maxZ = box.cz + box.sz * 0.5
  if (hole.maxX <= minX || hole.minX >= maxX || hole.maxZ <= minZ || hole.minZ >= maxZ) return [box]
  const out: BoxSpec[] = []
  const push = (x0: number, x1: number, z0: number, z1: number) => {
    if (x1 - x0 < 1e-3 || z1 - z0 < 1e-3) return
    out.push({ ...box, cx: (x0 + x1) * 0.5, cz: (z0 + z1) * 0.5, sx: x1 - x0, sz: z1 - z0 })
  }
  const hx0 = Math.max(minX, hole.minX)
  const hx1 = Math.min(maxX, hole.maxX)
  push(minX, maxX, minZ, Math.max(minZ, hole.minZ))
  push(minX, maxX, Math.min(maxZ, hole.maxZ), maxZ)
  const z0 = Math.max(minZ, hole.minZ)
  const z1 = Math.min(maxZ, hole.maxZ)
  push(minX, hx0, z0, z1)
  push(hx1, maxX, z0, z1)
  return out
}
