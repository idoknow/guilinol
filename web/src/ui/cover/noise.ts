// 程序化噪声：JS 端（几何位移、纹理烘焙）+ GLSL 端共用 chunk。
import * as T from 'three'

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash3(x: number, y: number, z: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const fade = (t: number) => t * t * (3 - 2 * t)

/** 3D value noise，[0,1]。 */
export function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  const c = (i: number, j: number, k: number) => hash3(xi + i, yi + j, zi + k)
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  )
}

export function fbm3(x: number, y: number, z: number, oct = 4) {
  let s = 0, a = 0.5, n = 0
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x, y, z)
    n += a
    x = x * 2.03 + 17.1
    y = y * 2.03 + 3.7
    z = z * 2.03 + 9.2
    a *= 0.5
  }
  return s / n
}

/** 周期为 p 的 2D value noise（格点取模），用于无缝平铺纹理。 */
function tile2(x: number, y: number, p: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const u = fade(x - xi), v = fade(y - yi)
  const m = (i: number) => ((i % p) + p) % p
  const c = (i: number, j: number) => hash3(m(xi + i), m(yi + j), seed)
  const a = c(0, 0) + (c(1, 0) - c(0, 0)) * u
  const b = c(0, 1) + (c(1, 1) - c(0, 1)) * u
  return a + (b - a) * v
}

function tileFbm(x: number, y: number, p: number, seed: number, oct: number) {
  let s = 0, a = 0.5, n = 0
  for (let i = 0; i < oct; i++) {
    s += a * tile2(x, y, p, seed + i * 31)
    n += a
    x *= 2
    y *= 2
    p *= 2
    a *= 0.5
  }
  return s / n
}

function dataTex(data: Uint8Array, size: number) {
  const t = new T.DataTexture(data, size, size, T.RGBAFormat)
  t.wrapS = t.wrapT = T.RepeatWrapping
  t.magFilter = T.LinearFilter
  t.minFilter = T.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

/** RGBA 四路不同频率的可平铺 fbm（雾、闪烁、月面）。 */
export function noiseTexture(size: number) {
  const d = new Uint8Array(size * size * 4)
  const s = 4 / size
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      d[i] = tileFbm(x * s, y * s, 4, 1, 4) * 255
      d[i + 1] = tileFbm(x * s * 2, y * s * 2, 8, 7, 3) * 255
      d[i + 2] = tileFbm(x * s * 4, y * s * 4, 16, 13, 2) * 255
      d[i + 3] = tile2(x * s * 8, y * s * 8, 32, 19) * 255
    }
  return dataTex(d, size)
}

/** 水面法线：整数波矢的正弦叠加（天然可平铺）+ 细噪声，存 xy 斜率。 */
export function waterNormalTexture(size: number) {
  const h = new Float32Array(size * size)
  const r = rng(7)
  const waves: [number, number, number, number][] = []
  for (let k = 0; k < 14; k++) {
    const f = 1 + Math.floor(r() * (k < 6 ? 4 : 10))
    const a = r() * Math.PI * 2
    waves.push([Math.round(Math.cos(a) * f), Math.round(Math.sin(a) * f) || 1, r() * 6.28, 1 / (f + 0.6)])
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2, v = (y / size) * Math.PI * 2
      let s = 0
      for (const [kx, ky, ph, a] of waves) s += Math.sin(kx * u + ky * v + ph) * a
      h[y * size + x] = s * 0.35 + tileFbm((x / size) * 8, (y / size) * 8, 8, 3, 3) * 0.5
    }
  const d = new Uint8Array(size * size * 4)
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * size * 0.03
      const dy = (at(x, y + 1) - at(x, y - 1)) * size * 0.03
      const l = Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      d[i] = (dx / l) * 127 + 128
      d[i + 1] = (dy / l) * 127 + 128
      d[i + 2] = (1 / l) * 255
      d[i + 3] = 255
    }
  return dataTex(d, size)
}

export const GLSL_NOISE = /* glsl */ `
float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
`
