import * as THREE from 'three'
import { orientedBar, type BoxSpec, type RectXZ } from './scene-boxes.ts'

/**
 * 玻璃金字塔采光井（地面广场上的金字塔从地下仰视）：吊顶开洞 → 井口围墙 → 四面坡玻璃 + 银白龙骨网格 → 球形吊灯。
 * 底面可以是长方形（出口楼梯上方），顶点在底面中心正上方。
 */
export interface SkylightPyramidOptions {
  /** 吊顶开洞（井口内沿），金字塔底面与之重合。 */
  readonly opening: RectXZ
  readonly ceilH: number
  /** 井口围墙高出吊顶底面的高度（米）。 */
  readonly curbM?: number
  /** 金字塔高度（米）。 */
  readonly heightM?: number
  /** 龙骨间距（米），决定每面斜梁数量。 */
  readonly rafterSpacingM?: number
  /** 每面横向檩条条数。 */
  readonly purlins?: number
  /** 球形吊灯布置（归一化底面坐标 fx/fz ∈ [-1,1]，y 相对底圈高度）。 */
  readonly globes?: readonly SkylightGlobe[]
}

export interface SkylightGlobe {
  readonly fx: number
  readonly fz: number
  /** 灯球中心相对底圈（baseY）的高度，负数表示垂到吊顶以下。 */
  readonly dy: number
  readonly radius?: number
}

export interface SkylightPyramidParts {
  readonly opening: RectXZ
  readonly baseY: number
  readonly apexY: number
  /** 井口围墙（墙面材质合批）。 */
  readonly curbWalls: BoxSpec[]
  /** 四面玻璃（三角面，UV 固定落在玻璃贴图的透明格内）。 */
  readonly glass: THREE.BufferGeometry
  /** 龙骨、底圈、吊杆（同一金属材质）。 */
  readonly frame: THREE.BufferGeometry[]
  /** 球形吊灯（发光材质）。 */
  readonly globes: THREE.BufferGeometry[]
}

/** 方形采光井默认灯位：中心一盏垂到吊顶下，四正向、四斜角在玻璃下错层悬挂。 */
export const XXG_WELL_GLOBES: readonly SkylightGlobe[] = Object.freeze([
  { fx: 0, fz: 0, dy: -0.85, radius: 0.2 },
  { fx: 0.5, fz: 0, dy: 0.25 },
  { fx: -0.5, fz: 0, dy: 0.25 },
  { fx: 0, fz: 0.5, dy: 0.25 },
  { fx: 0, fz: -0.5, dy: 0.25 },
  { fx: 0.62, fz: 0.62, dy: -0.15 },
  { fx: -0.62, fz: 0.62, dy: -0.15 },
  { fx: 0.62, fz: -0.62, dy: -0.15 },
  { fx: -0.62, fz: -0.62, dy: -0.15 },
])

/** 玻璃贴图 128px、每 64px 一道竖梃：uv 0.27 落在透明格内。 */
const CLEAR_PANE_UV = 0.27

type V3 = { x: number; y: number; z: number }

const lerp3 = (a: V3, b: V3, t: number): V3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
})

export function buildSkylightPyramid(opts: SkylightPyramidOptions): SkylightPyramidParts {
  const { opening, ceilH } = opts
  const curbM = opts.curbM ?? 0.45
  const heightM = opts.heightM ?? 3.0
  const spacing = opts.rafterSpacingM ?? 0.78
  const purlins = opts.purlins ?? 4
  const cx = (opening.minX + opening.maxX) * 0.5
  const cz = (opening.minZ + opening.maxZ) * 0.5
  const hx = (opening.maxX - opening.minX) * 0.5
  const hz = (opening.maxZ - opening.minZ) * 0.5
  const baseY = ceilH + curbM
  const apexY = baseY + heightM
  const curbT = 0.22
  const curbH = curbM + 0.02
  const curbCy = ceilH - 0.02 + curbH * 0.5

  // 井口围墙：内皮与开洞边对齐，向外加厚，压住吊顶切口。
  const curbWalls: BoxSpec[] = [
    { cx, cy: curbCy, cz: opening.minZ - curbT * 0.5, sx: hx * 2 + curbT * 2, sy: curbH, sz: curbT },
    { cx, cy: curbCy, cz: opening.maxZ + curbT * 0.5, sx: hx * 2 + curbT * 2, sy: curbH, sz: curbT },
    { cx: opening.minX - curbT * 0.5, cy: curbCy, cz, sx: curbT, sy: curbH, sz: hz * 2 },
    { cx: opening.maxX + curbT * 0.5, cy: curbCy, cz, sx: curbT, sy: curbH, sz: hz * 2 },
  ]

  const corners: V3[] = [
    { x: opening.minX, y: baseY, z: opening.minZ },
    { x: opening.maxX, y: baseY, z: opening.minZ },
    { x: opening.maxX, y: baseY, z: opening.maxZ },
    { x: opening.minX, y: baseY, z: opening.maxZ },
  ]
  const apex: V3 = { x: cx, y: apexY, z: cz }

  // 四面玻璃：逆时针（从外看）绕序，法线朝外上方。
  const pos: number[] = []
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!
    const b = corners[(i + 1) % 4]!
    pos.push(b.x, b.y, b.z, a.x, a.y, a.z, apex.x, apex.y, apex.z)
  }
  const glass = new THREE.BufferGeometry()
  glass.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  glass.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(CLEAR_PANE_UV), 2))
  glass.computeVertexNormals()

  const frame: THREE.BufferGeometry[] = []
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!
    const b = corners[(i + 1) % 4]!
    frame.push(orientedBar(a, b, 0.11, 0.1))
    frame.push(orientedBar(a, apex, 0.09))
    const edgeLen = Math.hypot(b.x - a.x, b.z - a.z)
    const rafters = Math.max(2, Math.round(edgeLen / spacing))
    for (let k = 1; k < rafters; k++) {
      frame.push(orientedBar(lerp3(a, b, k / rafters), apex, 0.05))
    }
    for (let p = 1; p <= purlins; p++) {
      const t = p / (purlins + 1)
      frame.push(orientedBar(lerp3(a, apex, t), lerp3(b, apex, t), 0.045))
    }
  }

  const globes: THREE.BufferGeometry[] = []
  for (const g of opts.globes ?? XXG_WELL_GLOBES) {
    const r = g.radius ?? 0.16
    const gx = cx + g.fx * hx
    const gz = cz + g.fz * hz
    const gy = baseY + g.dy
    const surfaceY = baseY + heightM * (1 - Math.max(Math.abs(g.fx), Math.abs(g.fz)))
    if (gy + r >= surfaceY - 0.05) continue
    const ball = new THREE.IcosahedronGeometry(r, 2)
    ball.translate(gx, gy, gz)
    globes.push(ball)
    frame.push(orientedBar({ x: gx, y: gy + r * 0.9, z: gz }, { x: gx, y: surfaceY, z: gz }, 0.018))
  }

  return { opening, baseY, apexY, curbWalls, glass, frame, globes }
}

/**
 * 吊顶之上的天空（只透过采光井可见）：大平面朝下，顶点色画蓝天白云，不受雾影响。
 */
export function buildSkyCapGeometry(bounds: RectXZ, y: number, segments = 40): THREE.BufferGeometry {
  const w = bounds.maxX - bounds.minX
  const d = bounds.maxZ - bounds.minZ
  const g = new THREE.PlaneGeometry(w, d, segments, segments)
  g.rotateX(Math.PI / 2)
  g.translate((bounds.minX + bounds.maxX) * 0.5, y, (bounds.minZ + bounds.maxZ) * 0.5)
  const pos = g.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const sky = new THREE.Color(0x78b2e4)
  const cloud = new THREE.Color(0xf4f7fa)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const n =
      0.55 * Math.sin(x * 0.23 + 1.3) * Math.sin(z * 0.19 + 0.4) +
      0.3 * Math.sin(x * 0.61 + z * 0.37 + 2.1) +
      0.15 * Math.sin(x * 1.13 - z * 0.97)
    const t = Math.min(1, Math.max(0, (n - 0.05) * 1.6))
    c.copy(sky).lerp(cloud, t)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return g
}
