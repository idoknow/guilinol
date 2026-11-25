// Compare a section's finished carriageways with the world it was built against.
// Run from the repo root: tsx scripts/audit-rail-section.ts BASE WORLD DESIGN.json
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ll2xz } from '../lib/projection'
import { visibleSurfaces } from './dingjiang-visible-surfaces'
import { sampledRailhead } from './railhead'
import { vehicleSurface } from './vehicle-surface'

const [base, candidate, designFile] = process.argv.slice(2)
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'))
const design = read(designFile)
const ways = read('raw/osm-2026-11.json').elements.filter((w) => w.type === 'way')
const roads = [...design.roads, ...(design.additionalRoadGroups ?? []).flat()]
for (const group of Object.values(design.priorRoadProfiles ?? {})) {
  for (const [key, segment] of Object.entries(group)) {
    const way = ways.find(w => w.id === Number(key))
    const origin = way.nodes.indexOf(segment.startNode)
    assert(origin >= 0, 'Prior profile origin missing on ' + key)
    const axis = way.geometry.map(p => ll2xz(p.lat, p.lon))
    let offset = 0
    for (let i = 1; i <= origin; i++) offset += Math.hypot(axis[i].x-axis[i-1].x, axis[i].z-axis[i-1].z)
    roads.push({way: Number(key), controls: segment.controls.map(([s,h]) => [s+offset,h])})
  }
}
const ids = new Set<number>(roads.map((r) => r.way))
const tracks = new Set(Object.keys(design.railTies).map(Number))
const manifest = read(path.join(candidate, 'manifest.json'))
const heights = [base, candidate].map((d) => vehicleSurface(d, read(path.join(d, 'manifest.json'))))
const crossings = read('docs/railway-crossings.json')
const chunks = new Set(manifest.chunks.map(t => t.x + "," + t.z))
const grades = []
const sections = []
const deckChecks = []
const coveredCrossings = new Set<number>()
for (const { way: id, controls, boundaryNodes, maximumGrade = 0.05, direction = 'lower' } of roads) {
  const way = ways.find((w) => w.id === id)
  const lane = { way: id, structure: 'surface', nodes: new Set(way.nodes) }
  const xy = way.geometry.map((p) => ll2xz(p.lat, p.lon))
  const start = controls[0][0],
    end = controls.at(-1)[0]
  let worst
  let chainage = 0,
    peakGrade = 0,
    raised = 0,
    lowered = 0,
    regressions = 0,
    count = 0
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1],
      b = xy[i],
      dx = b.x - a.x,
      dz = b.z - a.z,
      length = Math.hypot(dx, dz)
    if (!length) continue
    // Include both ties and both approaches to each native OSM vertex.
    const breaks = [
      0,
      ...[start - chainage, end - chainage].filter((s) => s > 0 && s < length),
      length,
    ].sort((a, b) => a - b)
    for (let k = 1; k < breaks.length; k++) {
      const from = breaks[k - 1],
        to = breaks[k],
        steps = Math.ceil((to - from) / 2),
        step = (to - from) / steps
      let previous: number[] | undefined
      for (let n = 0; n <= steps; n++) {
        const at = from + step * n,
          x = a.x + (at * dx) / length,
          z = a.z + (at * dz) / length
        if (!chunks.has(Math.floor(x / 256)*256 + "," + Math.floor(z / 256)*256)) {
          assert(chainage+at < start || chainage+at > end, "Missing designed road tile on " + id)
          previous = undefined
          continue
        }
        const y = heights.map((h) => h(x, z, lane))
        raised = Math.max(raised, y[1] - y[0])
        lowered = Math.max(lowered, y[0] - y[1])
        if (previous) {
          const slope = y.map((v, j) => Math.abs(v - previous![j]) / step)
          if (chainage + from >= start - 0.001 && chainage + to <= end + 0.001) {
            if(slope[1]>peakGrade)worst={s:chainage+at,step,previous,y,x,z}
            peakGrade = Math.max(peakGrade, slope[1])
            count++
          }
          if (slope[1] > maximumGrade + 1e-6 && slope[1] > slope[0] + 1e-6) regressions++
        }
        previous = y
      }
    }
    chainage += length
  }
  const strips = manifest.tunnels.filter((t) => t.way === id)
  // A shared way may also carry an approach from a different section.
  const local = []
  if (!boundaryNodes) {
    // Prior corrections use local chainage inside the original OSM profile.
    const along = new Map<number, number>()
    let distance = 0
    for (let i = 0; i < xy.length; i++) {
      if (i) distance += Math.hypot(xy[i].x-xy[i-1].x, xy[i].z-xy[i-1].z)
      along.set(way.nodes[i], distance)
    }
    local.push(...strips.filter(t => along.get(t.nodes?.[0]) < end && along.get(t.nodes?.[1]) > start))
    assert(local.length, "Missing prior road profile on " + id)
  } else {
    const first = strips.find((t) => t.nodes?.[0] === boundaryNodes[0])
    assert(first, 'Missing first graded chord on ' + id)
    let current = first
    while (current) {
      local.push(current)
      if (current.nodes[1] === boundaryNodes[1]) break
      current = strips.find((t) => t.nodes?.[0] === current.nodes[1] && !local.includes(t))
    }
    assert.equal(local.at(-1).nodes[1], boundaryNodes[1])
  }
  sections.push(...local)
  for (const r of crossings.filter((r) => r.road === id && tracks.has(r.rail))) {
    const p = ll2xz(r.lat, r.lon)
    if (
      !local.some((t) => {
        const [[x, , z], [bx, , bz]] = t.portals
        const dx = bx - x,
          dz = bz - z,
          u = ((p.x - x) * dx + (p.z - z) * dz) / (t.length * t.length)
        return u >= 0 && u <= 1 && Math.hypot(x + u * dx - p.x, z + u * dz - p.z) < 0.05
      })
    )
      continue
    if (design.railProfiles) {
      // The cumulative checker measures the way-matched railhead. Also
      // require rendered ballast to be present over every enclosed crossing.
      if (local.some(t => !t.openCut)) coveredCrossings.add(id)
      continue
    }
    const tile = manifest.chunks.find(
      (t) => t.x === Math.floor(p.x / 256) * 256 && t.z === Math.floor(p.z / 256) * 256,
    )
    const railY = sampledRailhead(candidate, manifest, tile, p.x, p.z)
    const roadY = heights[1](p.x, p.z, lane)
    deckChecks.push({
      rail: r.rail,
      road: id,
      lat: r.lat,
      lon: r.lon,
      railY,
      roadY,
      mainY: heights[0](p.x, p.z, lane),
      clearanceM: railY - roadY - 1.2,
    })
  }
  grades.push({
    way: id,
    direction,
    samples: count,
    maximumGrade: peakGrade,worst,
    limit: maximumGrade,
    raisedM: raised,
    loweredM: lowered,
    regressions,
  })
}
const reverse = visibleSurfaces(candidate, ids, ids, sections, !!design.railProfiles)
console.log(JSON.stringify({ grades, deckChecks, reverse }, null, 2))
assert(
  deckChecks.length === (design.expectedRoadRailCrossings ?? 0) &&
    deckChecks.every((r) => r.clearanceM >= 4.5 - 0.001),
)
assert(
  grades.every(
    (r) => r.samples && (r.direction === 'raise' ? r.loweredM : r.raisedM) <= 0.001 && r.maximumGrade <= r.limit + 1e-6 && !r.regressions,
  ),
)
assert(reverse.every((r) => r.checked && !r.violations))
for (const way of coveredCrossings) {
  assert(reverse.find(r => r.way === way)?.minimumRailBedClearanceM != null, 'Missing rail bed above bore ' + way)
}
