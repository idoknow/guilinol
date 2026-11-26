// Run from the project root: tsx scripts/audit-track-surfaces.ts WORLD
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import style from '../pipeline/railway-style.json'
import { tileFaces } from './dingjiang-visible-surfaces'

type Vertex = [number, number, number]
type Strip = [number, number, number, number, number, number, number, number]
const world = process.argv[2]
const manifest = JSON.parse(
  fs.readFileSync(path.join(world, 'manifest.json'), 'utf8'),
)
const sections: Record<string, Strip[]> = JSON.parse(
  execFileSync(
    process.env.PYTHON ?? '.venv/bin/python',
    ['pipeline/section_track_strips.py', world],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  ),
)
const width = style.ballastHalfWidth + 2
function clip(vertices: Vertex[], axis: number, sign: number, edge: number) {
  const result: Vertex[] = []
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i],
      b = vertices[(i + 1) % vertices.length]
    const u = sign * (a[axis] - edge),
      v = sign * (b[axis] - edge)
    if (u >= 0) result.push(a)
    if (u < 0 !== v < 0)
      result.push(a.map((x, k) => x + ((b[k] - x) * u) / (u - v)) as Vertex)
  }
  return result
}
function cells(lo: number, hi: number, size: number) {
  const result: number[] = []
  for (let i = Math.floor(lo / size); i <= Math.floor(hi / size); i++)
    result.push(i)
  return result
}
function bounds(x: number[], z: number[], padding: number, size: number) {
  return cells(
    Math.min(...x) - padding,
    Math.max(...x) + padding,
    size,
  ).flatMap((i) =>
    cells(Math.min(...z) - padding, Math.max(...z) + padding, size).map(
      (j) => i + ',' + j,
    ),
  )
}
const all = Object.entries(sections).flatMap(([section, rows]) =>
  rows.map((row) => ({ section, row })),
)
const bins = new Map<string, number[]>(),
  tiles = new Set<string>()
for (const [
  i,
  {
    row: [, x, z, , bx, bz],
  },
] of all.entries()) {
  for (const key of bounds([x, bx], [z, bz], width, 16)) {
    if (!bins.has(key)) bins.set(key, [])
    bins.get(key)!.push(i)
  }
  for (const key of bounds([x, bx], [z, bz], width, 256)) tiles.add(key)
}
type Peak = {
  excessM: number
  way: number
  x: number
  z: number
  railM: number
  faceM: number
}
// Optional intermediate for the A/B/C/D audit. Keep the clipped polygon so
// category boundaries can be tested even when they bisect a triangle.
const facesPath = process.argv[3]
const output = facesPath ? fs.openSync(facesPath, 'w') : undefined
let batch = ''
const reports = Object.fromEntries(
  Object.entries(sections).map(([name, rows]) => [
    name,
    {
      chords: rows.length,
      intersections: 0,
      above: new Set<number>(),
      roles: {} as Record<string, { hits: number; worst: Peak }>,
    },
  ]),
)
for (const tile of manifest.chunks) {
  if (!tiles.has(tile.x / 256 + ',' + tile.z / 256)) continue
  tileFaces(
    world,
    tile,
    manifest.tunnels,
    (face, role, owner) => {
      // A collapsed portal wall has no rendered area.
      const [a, b, c] = face
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        uz = b[2] - a[2]
      const vx = c[0] - a[0],
        vy = c[1] - a[1],
        vz = c[2] - a[2]
      if (
        Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) <
        1e-10
      )
        return
      const ids = new Set(
        bounds(
          face.map((p) => p[0]),
          face.map((p) => p[2]),
          0,
          16,
        ).flatMap((k) => bins.get(k) ?? []),
      )
      for (const i of ids) {
        const {
            section,
            row: [way, x, z, h, bx, bz, bh],
          } = all[i],
          report = reports[section]
        const length = Math.hypot(bx - x, bz - z),
          dx = (bx - x) / length,
          dz = (bz - z) / length
        let polygon = face.map(
          ([px, py, pz]) =>
            [
              (px - x) * dx + (pz - z) * dz,
              py,
              (pz - z) * dx - (px - x) * dz,
            ] as Vertex,
        )
        polygon = clip(
          clip(clip(clip(polygon, 0, 1, 0), 0, -1, length), 2, 1, -width),
          2,
          -1,
          width,
        )
        if (!polygon.length) continue
        report.intersections++
        let peak: Peak | undefined
        for (const [s, y, u] of polygon) {
          const railM = h + ((bh - h) * s) / length,
            excessM = y - railM
          if (excessM > 0.05 && (!peak || excessM > peak.excessM))
            peak = {
              excessM,
              way,
              x: x + dx * s - dz * u,
              z: z + dz * s + dx * u,
              railM,
              faceM: y,
            }
        }
        if (
          output !== undefined &&
          (peak ||
            ['paving-0', 'graded-floor', 'visible-carriageway', 'retaining-wall'].includes(role))
        ) {
          const vertices = polygon.map(([s, y, u]) => [
            x + s * dx - u * dz,
            z + s * dz + u * dx,
            y,
            y - (h + ((bh - h) * s) / length),
          ])
          const normalY = uz * vx - ux * vz
          const gradient =
            Math.abs(normalY) > 1e-9
              ? [-(uy * vz - uz * vy) / normalY, -(ux * vy - uy * vx) / normalY]
              : null
          batch +=
            JSON.stringify([
              section,
              i,
              all[i].row,
              role,
              owner ?? null,
              vertices,
              gradient,
            ]) + '\n'
          if (batch.length > 524288) {
            fs.writeSync(output, batch)
            batch = ''
          }
        }
        if (!peak) continue
        report.above.add(i)
        const entry = (report.roles[role] ??= { hits: 0, worst: peak })
        entry.hits++
        if (entry.worst.excessM < peak.excessM) entry.worst = peak
      }
    },
    false,
    output !== undefined,
  )
}
if (output !== undefined) {
  fs.writeSync(output, batch)
  fs.closeSync(output)
}
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(reports).map(([name, r]) => [
        name,
        { ...r, above: r.above.size },
      ]),
    ),
    null,
    2,
  ),
)
process.exitCode = Object.values(reports).some(
  (r) => (output === undefined && r.above.size > 0) || !r.intersections,
)
  ? 1
  : 0
