// 象鼻山：程序化雕塑（SDF → Surface Nets）。游戏里的象鼻山是 1.2k 面互相穿插的台阶盒子，远看像城堡，
// 体素化平滑也救不回象鼻和水月洞。这里按游戏模型的占地与高度重新塑形：
// 尾背 → 身躯 → 圆额头 → 象鼻扎进江里，鼻与身之间是水月洞（拱洞轴朝镜头，能透出后面的江面），山顶一座普贤塔。
// 只在载入时跑一次（2 m 网格，~15 万次求值，几十 ms）。

/** 落位：游戏模型占地中心；侧影朝原点（镜头），象鼻在画面右边 */
export function hillFrame(parts: {pos: Float32Array}[]) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const p of parts)
    for (let i = 0; i < p.pos.length; i += 3) {
      x0 = Math.min(x0, p.pos[i])
      x1 = Math.max(x1, p.pos[i])
      z0 = Math.min(z0, p.pos[i + 2])
      z1 = Math.max(z1, p.pos[i + 2])
    }
  const x = (x0 + x1) / 2, z = (z0 + z1) / 2, d = Math.hypot(x, z)
  return {x, z, right: [-z / d, x / d] as [number, number]}
}

/** 水月洞下和象鼻四周改成江面（游戏水面掩码里这块是岸）：u > 28 m 的一侧整片入水 */
export function stampHillWater(w: {x0: number; z0: number; step: number; w: number; h: number; field: Float32Array}, f: ReturnType<typeof hillFrame>) {
  const [rx, rz] = f.right, vx = -rz, vz = rx
  const ss = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  for (let j = 0; j < w.h; j++)
    for (let i = 0; i < w.w; i++) {
      const dx = w.x0 + (i + 0.5) * w.step - f.x, dz = w.z0 + (j + 0.5) * w.step - f.z
      if (dx * dx + dz * dz > 160 * 160) continue
      const u = dx * rx + dz * rz, v = dx * vx + dz * vz
      const k = ss(22, 38, u) * (1 - ss(44, 60, Math.abs(v)))
      const id = j * w.w + i
      w.field[id] = Math.max(w.field[id], k)
    }
}

/**
 * @param c 山体中心（场景坐标，水面 y = 0）
 * @param right 侧影里「向右」的水平单位向量（象鼻朝这边）；拱洞轴 = 视线方向
 * @param scale 设计尺寸（身长 ~150 m）→ 游戏占地的缩放
 */
export function elephantHill(c: {x: number; z: number}, right: [number, number], scale: number) {
  const s = scale, cell = 2
  // 局部：u 沿身长（+u = 象鼻端），v 沿拱洞轴，y 向上
  const U0 = -84 * s, U1 = 76 * s, Y0 = -6, Y1 = 74 * s, V0 = -42 * s, V1 = 42 * s
  const nu = Math.ceil((U1 - U0) / cell) + 1, ny = Math.ceil((Y1 - Y0) / cell) + 1, nv = Math.ceil((V1 - V0) / cell) + 1
  const N = nu * ny * nv
  const at = (i: number, j: number, k: number) => (k * ny + j) * nu + i
  const ev = (i: number, j: number, k: number) => sdf((U0 + i * cell) / s, (Y0 + j * cell) / s, (V0 + k * cell) / s) * s
  // 两级采样：先隔一格粗采（4 m），离表面 > 7 m 的细格直接沿用粗值（只用到符号），近表面才细采
  const cu = (nu >> 1) + 1, cy = (ny >> 1) + 1, cv = (nv >> 1) + 1
  const coarse = new Float32Array(cu * cy * cv)
  for (let k = 0; k < cv; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cu; i++) coarse[(k * cy + j) * cu + i] = ev(i * 2, j * 2, k * 2)
  const f = new Float32Array(N)
  for (let k = 0; k < nv; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nu; i++) {
        const g = coarse[(Math.min(cv - 1, (k + 1) >> 1) * cy + Math.min(cy - 1, (j + 1) >> 1)) * cu + Math.min(cu - 1, (i + 1) >> 1)]
        f[at(i, j, k)] = Math.abs(g) > 7 ? g : ev(i, j, k)
      }

  // ---------- Surface Nets：每个跨零面的格子一个顶点（边交点平均），每条跨越的格边一个四边形 ----------
  const vidx = new Int32Array(N).fill(-1)
  const pos: number[] = []
  const [rx, rz] = right
  // v 轴 = 视线方向（造型前后对称，正负无所谓）；(right, up, v) 保持右手系，绕序不用翻
  const vx = -rz, vz = rx
  for (let k = 0; k < nv - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nu - 1; i++) {
        // 八角同号 = 不跨表面（绝大多数格子），直接跳过
        const s0 = f[at(i, j, k)] < 0
        if (
          s0 === f[at(i + 1, j, k)] < 0 && s0 === f[at(i, j + 1, k)] < 0 && s0 === f[at(i + 1, j + 1, k)] < 0 &&
          s0 === f[at(i, j, k + 1)] < 0 && s0 === f[at(i + 1, j, k + 1)] < 0 && s0 === f[at(i, j + 1, k + 1)] < 0 &&
          s0 === f[at(i + 1, j + 1, k + 1)] < 0
        )
          continue
        let su = 0, sy = 0, sv = 0, n = 0
        for (const [a, b] of CUBE_EDGES) {
          const da = f[at(i + a[0], j + a[1], k + a[2])], db = f[at(i + b[0], j + b[1], k + b[2])]
          if (da < 0 === db < 0) continue
          const t = da / (da - db)
          su += a[0] + (b[0] - a[0]) * t
          sy += a[1] + (b[1] - a[1]) * t
          sv += a[2] + (b[2] - a[2]) * t
          n++
        }
        if (!n) continue
        vidx[at(i, j, k)] = pos.length / 3
        const u = U0 + (i + su / n) * cell, y = Y0 + (j + sy / n) * cell, v = V0 + (k + sv / n) * cell
        pos.push(c.x + rx * u + vx * v, y, c.z + rz * u + vz * v)
      }
  const index: number[] = []
  const quad = (a: number, b: number, cc: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || cc < 0 || d < 0) return
    if (flip) index.push(a, cc, b, a, d, cc)
    else index.push(a, b, cc, a, cc, d)
  }
  for (let k = 1; k < nv - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nu - 1; i++) {
        const in0 = f[at(i, j, k)] < 0
        if (in0 !== f[at(i + 1, j, k)] < 0) quad(vidx[at(i, j - 1, k - 1)], vidx[at(i, j, k - 1)], vidx[at(i, j, k)], vidx[at(i, j - 1, k)], !in0)
        if (in0 !== f[at(i, j + 1, k)] < 0) quad(vidx[at(i - 1, j, k - 1)], vidx[at(i - 1, j, k)], vidx[at(i, j, k)], vidx[at(i, j, k - 1)], !in0)
        if (in0 !== f[at(i, j, k + 1)] < 0) quad(vidx[at(i - 1, j - 1, k)], vidx[at(i, j - 1, k)], vidx[at(i, j, k)], vidx[at(i - 1, j, k)], !in0)
      }
  return {pos: Float32Array.from(pos), index: Uint32Array.from(index)}
}

// ---------- 造型（设计单位：米，身长 ~150，额头高 ~60；标量参数，载入时要跑几万次） ----------
function sdf(u: number, y: number, v: number) {
  let d = ell(u, y, v, -36, 4, 0, 46, 28, 30)
  d = smin(d, ell(u, y, v, -4, 14, 0, 50, 40, 33), 16)
  d = smin(d, ell(u, y, v, 30, 30, 0, 30, 29, 27), 14)
  // 额头 → 象鼻：粗柱弯下来扎进水里
  d = smin(d, cap(u, y, v, 44, 40, 0, 58, 22, 0, 11), 8)
  d = smin(d, cap(u, y, v, 58, 22, 0, 56, -8, 2, 9), 6)
  // 水月洞：鼻与身之间的拱洞，轴朝镜头
  d = smax(d, -ell(u, y, v, 39, 2, 0, 11, 15, 60), 4)
  // 普贤塔（喇嘛塔：塔座 + 瓶身 + 塔刹）
  d = smin(d, cap(u, y, v, 16, 50, 0, 16, 56, 0, 4.2), 2)
  d = Math.min(d, ell(u, y, v, 16, 59.5, 0, 4.6, 4.2, 4.6))
  d = Math.min(d, cap(u, y, v, 16, 62, 0, 16, 69, 0, 2.1))
  // 喀斯特：竖向溶沟 + 大块起伏
  return d + (vnoise(u * 0.11 + v * 0.07, y * 0.018) - 0.5) * 3.2 + (vnoise(u * 0.035 + 5.3, v * 0.035 + y * 0.03) - 0.5) * 5
}

/** 椭球近似距离（Inigo Quilez） */
function ell(px: number, py: number, pz: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) {
  const x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz
  const k0 = Math.sqrt(x * x + y * y + z * z), k1 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2)
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz)
}
function cap(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number) {
  const pax = px - ax, pay = py - ay, paz = pz - az, bax = bx - ax, bay = by - ay, baz = bz - az
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)))
  const x = pax - bax * h, y = pay - bay * h, z = paz - baz * h
  return Math.sqrt(x * x + y * y + z * z) - r
}
function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - (h * h * k) / 4
}
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k)

function hash(x: number, y: number) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return h - Math.floor(h)
}
function vnoise(x: number, y: number) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]
const CUBE_EDGES: [number[], number[]][] = []
for (let a = 0; a < 8; a++)
  for (let b = a + 1; b < 8; b++)
    if (CORNERS[a].reduce((s, x, i) => s + Math.abs(x - CORNERS[b][i]), 0) === 1) CUBE_EDGES.push([CORNERS[a], CORNERS[b]])
