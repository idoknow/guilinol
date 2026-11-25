// Compare the finished Dingjiang section and the three unchanged yard crossings.
// Run from the repo root with tsx scripts/audit-dingjiang.ts MAIN_WORLD CANDIDATE_WORLD.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'
import {ll2xz} from '../lib/projection'
import {visibleSurfaces} from './dingjiang-visible-surfaces'
import {vehicleSurface} from './vehicle-surface'

const [base, candidate] = process.argv.slice(2)
if (!candidate) throw Error('Expected baseline and candidate world directories')
const json = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'))
const roads = new Set([983781242, 983781244, 1550293846, 459580311])
const auditedRoads = new Set([...roads, 500400553, 500400554, 983781250, 983781252,
  205756891, 500400555, 983781249, 983781251, 983781245, 983781247,
  459580310, 815078158, 815078159])
const yard = new Set([6635078452, 6635078453, 6635078454])
const crossings = json('docs/railway-crossings.json')
const ways = new Map<number, any>(json('raw/osm-2026-11.json').elements
  .filter(w => w.type === 'way' && auditedRoads.has(w.id)).map(w => [w.id, w]))
const worlds = [base, candidate].map(dir => {
  const m = json(path.join(dir, 'manifest.json'))
  const tiles = new Map<string, any>(m.chunks.map(t => [t.x + ',' + t.z, t]))
  const tile = (x: number, z: number) => tiles.get(Math.floor(x / 256) * 256 + ',' + Math.floor(z / 256) * 256)
  const surface = vehicleSurface(dir, m)
  function railhead(x: number, z: number) {
    const t = tile(x, z), buf = gunzipSync(fs.readFileSync(path.join(dir, t.file)))
    const offset = 24 + 4 * (m.chunkSize / m.grid + 1) ** 2 + 9 * buf.readUInt32LE(4) + 4 * buf.readUInt32LE(8)
    const rails = JSON.parse(buf.toString('utf8', offset, offset + buf.readUInt32LE(12)))[4]
    let nearest = Infinity, height = NaN
    for (const [ax, az, ay, bx, bz, by] of rails) {
      const dx = bx - ax, dz = bz - az, px = (x - t.x) * 100 - ax, pz = (z - t.z) * 100 - az
      const u = Math.max(0, Math.min(1, (px * dx + pz * dz) / (dx * dx + dz * dz)))
      const distance = Math.hypot(px - u * dx, pz - u * dz)
      if (distance < nearest) {
        nearest = distance
        height = (ay + u * (by - ay)) / 100
      }
    }
    assert(nearest < 2, 'Missing encoded rail at ' + [x, z])
    return height
  }
  return {tile, surface, railhead, dir, tunnels: m.tunnels}
})

const seen = new Set<number>()
const results = []
const crossingByRoad = new Map<number, {x:number, z:number}>()
for (const r of crossings) {
  const regression = yard.has(r.sharedNode)
  if (!roads.has(r.road) || (r.type !== 'rail_over' && !regression)) continue
  if (regression && seen.has(r.sharedNode)) continue
  if (regression) seen.add(r.sharedNode)
  const {x, z} = ll2xz(r.lat, r.lon)
  if (r.rail === 375923389) crossingByRoad.set(r.road, {x, z})
  const lane = {way: r.road, structure: 'surface', nodes: new Set(ways.get(r.road).nodes)}
  const samples = worlds.map(w => {
    const road = w.surface(x, z, lane), rail = w.railhead(x, z)
    return {road, rail, clearance: regression ? rail - road : rail - road - 1.2}
  })
  if (regression) {
    const buffers = worlds.map(w => gunzipSync(fs.readFileSync(path.join(w.dir, w.tile(x, z).file))))
    assert(buffers[0].equals(buffers[1]), 'Yard crossing tile changed')
    assert.deepEqual(samples[0], samples[1])
  } else if (r.rail === 375923389) {
    assert(Math.abs(samples[1].clearance - 4.5) < .001, 'Incorrect underpass height')
  } else assert(samples[1].clearance >= 4.499, 'Adjacent underpass lost headroom')
  results.push({rail: r.rail, road: r.road, node: r.sharedNode, move: samples[1].road - samples[0].road, samples})
}
assert.equal(results.filter(r => r.rail === 375923389).length, 4)
assert.equal(seen.size, 3)
const grades = []
const yardGrades = []
for (const [id, way] of ways) {
  const structure = way.tags.bridge === 'yes' ? 'bridge' : way.tags.tunnel === 'yes' ? 'tunnel' : 'surface'
  const lane = {way: id, nodes: new Set(way.nodes), structure}
  const points = way.geometry.map(p => ll2xz(p.lat, p.lon))
  const crossing = crossingByRoad.get(id) ?? points[0]
  const included = new Set(worlds[1].tunnels.filter(t => t.way === id).flatMap(t => t.nodes))
  let station = 0, crossingAt = 0, nearest = Infinity
  const stations = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz)
    const at = Math.max(0, Math.min(len, ((crossing.x-a.x)*dx + (crossing.z-a.z)*dz)/len))
    const distance = Math.hypot(a.x + at*dx/len - crossing.x, a.z + at*dz/len - crossing.z)
    if (distance < nearest) { nearest = distance; crossingAt = station + at }
    station += len
    stations.push(station)
  }
  const active = stations.filter((_,i) => included.has(way.nodes[i]))
  const lo = structure === 'bridge' ? 0 : Math.min(...active)
  const hi = structure === 'bridge' ? station : Math.max(...active)
  const cap = way.tags.highway === 'service' ? .08 : .05
  let activeIntervals = 0, aboveCap = 0, raisedM = 0, loweredM = 0
  let before = 0, after = 0, intervals = 0, regressions = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], len = stations[i]-stations[i-1]
    if (!len) continue
    const count = Math.ceil(len/2), step = len/count
    let previous: number[] | undefined
    for (let j = 0; j <= count; j++) {
      const x = a.x + (b.x-a.x)*j/count, z = a.z + (b.z-a.z)*j/count
      if (!worlds[0].tile(x,z)) { previous = undefined; continue }
      const heights = worlds.map(w => w.surface(x,z,lane))
      raisedM = Math.max(raisedM, heights[1] - heights[0])
      loweredM = Math.min(loweredM, heights[1] - heights[0])
      if (previous) {
        const slope = heights.map((h,k) => Math.abs(h-previous![k])/step)
        const at = stations[i-1]+step*j
        if (lo <= at - step + .00001 && at <= hi + .00001) {
          activeIntervals++
          if (slope[1] > cap + .000001) aboveCap++
          if (at <= crossingAt) before = Math.max(before,slope[1])
          else after = Math.max(after,slope[1])
        }
        if (slope[1] > cap+1e-6 && slope[1] > slope[0]+1e-6) regressions++
        intervals++
      }
      previous = heights
    }
  }
  if (roads.has(id) || id === 815078159) assert(raisedM < .001, 'Underpass pavement raised on '+id)
  grades.push({road:id, intervals, activeIntervals, aboveCap, regressions, before, after, raisedM, loweredM})
  assert(activeIntervals > 0, 'No intervals in the solved extent on ' + id)
  assert.equal(aboveCap, 0, 'Road grade limit exceeded inside the closure on ' + id)
  assert.equal(regressions,0,'Road grade regressions on '+id)
  for (const node of yard) {
    const i = way.nodes.indexOf(node)
    if (i < 1) continue
    const center = points[i]
    const ends = [i-1,i+1].map(j => {
      const dx=points[j].x-center.x, dz=points[j].z-center.z, len=Math.hypot(dx,dz)
      return {x:center.x+dx/len,z:center.z+dz/len}
    })
    const slopes = worlds.map(w => {
      const h=ends.map(p=>w.surface(p.x,p.z,lane))
      return (h[1]-h[0])/2
    })
    assert.equal(slopes[0],slopes[1])
    yardGrades.push({node, signedGrade:slopes[1]})
  }
}
const reverse = visibleSurfaces(candidate, roads, auditedRoads)
console.log(JSON.stringify({reverse, closure: [...auditedRoads].sort((a,b)=>a-b), crossings:results, grades, yardGrades}, null, 2))

assert(reverse.every(r => r.checked > 0 && r.groundViolations === 0), 'Ground-level faces intrude into a surveyed underpass')
assert(reverse.every(r => r.externalBridgeViolations === 0), 'Non-closure S2201 bridge faces above the surveyed shoulder; see upperDecks')
