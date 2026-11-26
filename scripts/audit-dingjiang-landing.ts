// tsx scripts/audit-dingjiang-landing.ts MAIN WORLD [vertices.csv]
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ll2xz } from '../lib/projection'
import { tileFaces } from './dingjiang-visible-surfaces'
import { vehicleSurface } from './vehicle-surface'

const [base, world, csv] = process.argv.slice(2)
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'))
const source = read('pipeline/rail-sections/06-dingjiang.json'),
  id = 983781244
const road = read('raw/osm-2026-11.json').elements.find(
  (w) => w.id === id && w.type === 'way',
)
const points = road.geometry.map((p) => ll2xz(p.lat, p.lon)),
  stations = [0]
for (let i = 1; i < points.length; i++)
  stations.push(
    stations[i - 1] +
      Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z),
  )
const controls = [
  ...source.roads,
  ...source.additionalRoadGroups.flat(),
].filter((r) => r.way === id)
const prior = source.priorRoadProfiles['01'][id],
  origin = stations[road.nodes.indexOf(prior.startNode)]
const spans = controls.map((r) => [r.controls[0][0], r.controls.at(-1)[0]])
spans.push([origin + prior.controls[0][0], origin + prior.controls.at(-1)[0]])
const segments = points.flatMap((a, i) => {
  if (i + 1 === points.length) return []
  const b = points[i + 1],
    dx = b.x - a.x,
    dz = b.z - a.z,
    length = stations[i + 1] - stations[i]
  return [{ a, b, dx, dz, length, station: stations[i] }]
})
const manifest = read(path.join(world, 'manifest.json')),
  surface = vehicleSurface(base, read(path.join(base, 'manifest.json')))
const lane = { way: id, structure: 'surface', nodes: new Set(road.nodes) }
const unique = new Set<string>(),
  lines = ['station_m,x,z,main_vehicle_surface_m,finished_floor_m,delta_m']
let ordinary = 0,
  raised = 0,
  ordinaryMax = -Infinity,
  raisedMax = -Infinity
for (const tile of manifest.chunks) {
  const local = segments.filter(
    ({ a, b }) =>
      Math.max(a.x, b.x) + 5 >= tile.x &&
      Math.min(a.x, b.x) - 5 <= tile.x + 256 &&
      Math.max(a.z, b.z) + 5 >= tile.z &&
      Math.min(a.z, b.z) - 5 <= tile.z + 256,
  )
  if (
    !local.some((seg) =>
      spans.some(
        ([lo, hi]) => seg.station <= hi && seg.station + seg.length >= lo,
      ),
    )
  )
    continue
  tileFaces(
    world,
    tile,
    manifest.tunnels,
    (face, role, owner) => {
      if (role !== 'graded-floor' || owner !== id) return
      for (const [x, y, z] of face) {
        const key = [x, y, z].map((v) => v.toFixed(6)).join(',')
        if (unique.has(key)) continue
        unique.add(key)
        let distance = Infinity,
          station = 0
        for (const { a, dx, dz, length, station: start } of local) {
          const u = Math.min(
            1,
            Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / length ** 2),
          )
          const d = Math.hypot(x - a.x - u * dx, z - a.z - u * dz)
          if (d < distance) {
            station = start + u * length
            distance = d
          }
        }
        if (
          distance > 5 ||
          !spans.some(
            ([lo, hi]) => station >= lo - 0.001 && station <= hi + 0.001,
          )
        )
          continue
        const before = surface(x, z, lane),
          delta = y - before
        if (station >= 1154 && station <= 1290) {
          raised++
          raisedMax = Math.max(raisedMax, delta)
        } else {
          ordinary++
          ordinaryMax = Math.max(ordinaryMax, delta)
        }
        if (csv)
          lines.push(
            [station, x, z, before, y, delta]
              .map((v) => v.toFixed(6))
              .join(','),
          )
      }
    },
    false,
    true,
  )
}
if (csv) fs.writeFileSync(csv, lines.join('\n') + '\n')
console.log(
  JSON.stringify(
    {
      ordinaryVertices: ordinary,
      ordinaryMaximumM: ordinaryMax,
      raisedVertices: raised,
      raisedMaximumM: raisedMax,
    },
    null,
    2,
  ),
)
assert(
  raised && ordinary && ordinaryMax <= 0.00001 && raisedMax <= 3.23001,
  'Service road exceeds the approved signed movement',
)
