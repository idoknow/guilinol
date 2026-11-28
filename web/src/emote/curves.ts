import * as T from 'three'

// Bake-time authoring curves. Nothing here runs on the per-frame hot path.

export type Key = readonly [time: number, value: number]
export type VKey = readonly [time: number, x: number, y: number, z: number]

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const ramp = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
export function smooth(t: number, a: number, b: number) {
  const x = ramp(t, a, b)
  return x * x * (3 - 2 * x)
}
/** Fast attack, soft landing: the snap of a gesture that "clicks" into place. */
export const easeOut = (t: number, a: number, b: number, power = 3) => 1 - (1 - ramp(t, a, b)) ** power
/** Raised-cosine pulse peaking at `c`, zero beyond `±w`. */
export function bump(t: number, c: number, w: number) {
  const x = (t - c) / w
  return x <= -1 || x >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x)
}
export const mix = (a: number, b: number, w: number) => a + (b - a) * w

/**
 * Monotone cubic (Fritsch–Carlson) through the keys. Holds stay perfectly flat,
 * extremes never overshoot, so every authored pose is hit exactly.
 */
export function curve(points: readonly Key[]) {
  const n = points.length
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1])
  const d: number[] = [],
    m = new Array<number>(n).fill(0)
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]))
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i],
      b = m[i + 1] / d[i],
      s = a * a + b * b
    if (s > 9) {
      const k = 3 / Math.sqrt(s)
      m[i] = k * a * d[i]
      m[i + 1] = k * b * d[i]
    }
  }
  return (t: number) => {
    if (t <= xs[0]) return ys[0]
    if (t >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (t > xs[i + 1]) i++
    const h = xs[i + 1] - xs[i],
      u = (t - xs[i]) / h,
      u2 = u * u,
      u3 = u2 * u
    return (
      (2 * u3 - 3 * u2 + 1) * ys[i] +
      (u3 - 2 * u2 + u) * h * m[i] +
      (3 * u2 - 2 * u3) * ys[i + 1] +
      (u3 - u2) * h * m[i + 1]
    )
  }
}

/** Per-axis monotone curve. `mirror` flips X so one table serves both arms. */
export function vcurve(points: readonly VKey[]) {
  const x = curve(points.map((p) => [p[0], p[1]] as const)),
    y = curve(points.map((p) => [p[0], p[2]] as const)),
    z = curve(points.map((p) => [p[0], p[3]] as const))
  return (t: number, mirror = 1) => new T.Vector3(mirror * x(t), y(t), z(t))
}
