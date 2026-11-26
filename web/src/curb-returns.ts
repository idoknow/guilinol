// Surveyed native curb strips at the ends of a graded road. Clip render and
// collision faces to the same footprint; carry the original reveal with the grade.
type Point = number[]
type NativeFace = [number, Point, Point, Point]
export interface CurbReturn {
  origin: number[]
  axis: number[]
  along: number[]
  lateral: number[]
  lanes: number[][][]
  faces: NativeFace[]
  displacement: number[][]
}
type Triangle = { kind: number; points: Point[] }

function split(poly: Point[], distance: (p: Point) => number): [Point[], Point[]] {
  const inside: Point[] = [],
    outside: Point[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = distance(a),
      db = distance(b)
    ;(da >= 0 ? inside : outside).push(a)
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db),
        p = a.map((v, k) => v + t * (b[k] - v))
      inside.push(p)
      outside.push(p)
    }
  }
  return [inside, outside]
}

function sample(faces: Triangle[], x: number, z: number, kind: number, y: number) {
  let best: number | undefined
  for (const face of faces) {
    if (face.kind !== kind) continue
    const [a, b, c] = face.points,
      ax = b[0] - a[0],
      az = b[2] - a[2],
      bx = c[0] - a[0],
      bz = c[2] - a[2],
      det = ax * bz - az * bx
    if (Math.abs(det) < 1e-9) continue
    const u = ((x - a[0]) * bz - (z - a[2]) * bx) / det,
      v = (ax * (z - a[2]) - az * (x - a[0])) / det
    if (Math.min(u, v, 1 - u - v) < -1e-6) continue
    const h = a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1])
    if (best === undefined || Math.abs(h - y) < Math.abs(best - y)) best = h
  }
  return best ?? y
}

export function fitCurbReturns(
  patches: CurbReturn[],
  xyz: number[],
  rgb: number[],
  kinds: number[],
  uv: number[],
  road: number[],
  sidewalk: number[],
  color: (kind: number) => number[],
) {
  for (const patch of patches) {
    const {
      origin: [x, y, z],
      axis: [dx, dz],
      along: [start, end],
      lateral: [lo, hi],
    } = patch
    const along = (p: Point) => (p[0] - x) * dx + (p[2] - z) * dz
    const across = (p: Point) => (p[2] - z) * dx - (p[0] - x) * dz
    const planes = [
      (p: Point) => along(p) - start,
      (p: Point) => end - along(p),
      (p: Point) => across(p) - lo,
      (p: Point) => hi - across(p),
    ]
    // A neighboring chord may bend through the outside strip. Preserve the
    // existing driving surface throughout the union of carriageway footprints.
    const lanePlanes = patch.lanes.map((ring) =>
      ring.map(([ax, az], i) => {
        const [bx, bz] = ring[(i + 1) % ring.length]
        return (p: Point) => (bx - ax) * (p[2] - az) - (bz - az) * (p[0] - ax)
      }),
    )
    function outsideLanes(points: Point[], saved?: Point[][]) {
      let pieces = [points]
      for (const lane of lanePlanes) {
        const next: Point[][] = []
        for (const piece of pieces) {
          if (lane.some((plane) => piece.every((p) => plane(p) < 0))) {
            next.push(piece)
            continue
          }
          let interior = piece
          for (const plane of lane) {
            const [inside, outside] = split(interior, plane)
            if (outside.length >= 3) next.push(outside)
            interior = inside
            if (interior.length < 3) break
          }
          if (interior.length >= 3) saved?.push(interior)
        }
        pieces = next
      }
      return pieces
    }
    const original: Triangle[] = []
    function cut(points: Point[]) {
      if (
        points.every((p) => p[1] > y + 1.4) ||
        points.every((p) => p[1] < y - 1.4) ||
        planes.some((f) => points.every((p) => f(p) < 0))
      )
        return
      let inner = points
      const remnants: Point[][] = []
      for (const plane of planes) {
        const [a, b] = split(inner, plane)
        if (a.length < 3) return
        if (b.length >= 3) remnants.push(b)
        inner = a
      }
      outsideLanes(inner, remnants)
      return remnants
    }
    const positions: number[] = [],
      colors: number[] = [],
      channels: number[] = [],
      alongValues: number[] = []
    function write(points: Point[], kind: number) {
      for (let j = 1; j + 1 < points.length; j++)
        for (const p of [points[0], points[j], points[j + 1]]) {
          positions.push(p[0], p[1], p[2])
          colors.push(p[3], p[4], p[5])
          channels.push(kind)
          alongValues.push(p[6])
        }
    }
    for (let i = 0; i < kinds.length; i += 3) {
      const kind = kinds[i]
      const points = [i, i + 1, i + 2].map((j) => [
        xyz[3 * j],
        xyz[3 * j + 1],
        xyz[3 * j + 2],
        rgb[3 * j],
        rgb[3 * j + 1],
        rgb[3 * j + 2],
        uv[j],
      ])
      const outside = [0, 1, 2, 3, 6].includes(kind) ? cut(points) : undefined
      if (!outside) {
        write(points, kind)
        continue
      }
      original.push({ points, kind })
      for (const poly of outside) write(poly, kind)
    }
    for (const buffer of [road, sidewalk]) {
      const kept: number[] = []
      for (let i = 0; i < buffer.length; i += 9) {
        const face = [0, 3, 6].map((j) => buffer.slice(i + j, i + j + 3))
        for (const poly of cut(face) ?? [face])
          for (let j = 1; j + 1 < poly.length; j++)
            for (const p of [poly[0], poly[j], poly[j + 1]]) kept.push(...p)
      }
      buffer.length = 0
      for (const v of kept) buffer.push(v)
    }
    for (const [kind, ...tri] of patch.faces) {
      const pts = tri.map(([s, h, n]) => {
        const px = x + s * dx - n * dz,
          pz = z + s * dz + n * dx
        const shifts = patch.displacement
        const i = shifts.findIndex(([at]) => at >= s)
        const [a, da] = shifts[Math.max(0, i - 1)],
          [b, db] = shifts[i < 0 ? shifts.length - 1 : i]
        const native = h + da + (db - da) * Math.min(1, Math.max(0, (s - a) / (b - a || 1)))
        const outer = Math.max(Math.abs(lo), Math.abs(hi))
        const weight = Math.min(
          1,
          Math.max(0, Math.min((s - start) / 2, (end - s) / 8, (outer - Math.abs(n)) / 1.5)),
        )
        const other = weight < 1 ? sample(original, px, pz, kind, native) : native
        return [px, other + weight * (native - other), pz, ...color(kind), 0]
      })
      for (const poly of outsideLanes(pts)) {
        write(poly, kind)
        if (kind === 0 || kind === 1 || kind === 6) {
          for (let j = 1; j + 1 < poly.length; j++) {
            const face = [poly[0], poly[j], poly[j + 1]],
              [a, b, c] = face
            if (Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) > 1e-8)
              for (const p of face) (kind === 0 ? road : sidewalk).push(p[0], p[1], p[2])
          }
        }
      }
    }
    for (const [dst, src] of [
      [xyz, positions],
      [rgb, colors],
      [kinds, channels],
      [uv, alongValues],
    ]) {
      dst.length = 0
      for (const v of src) dst.push(v)
    }
  }
}
