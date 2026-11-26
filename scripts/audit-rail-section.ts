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
  const sameWayProfiles = roads.filter(r => r.way === id)
  const nativeLimit = way.tags.highway === 'service' ? .08 : maximumGrade
  const lane = { way: id, structure: 'surface', nodes: new Set(way.nodes) }
  const xy = way.geometry.map((p) => ll2xz(p.lat, p.lon))
  const start = controls[0][0],
    end = controls.at(-1)[0]
  let worst, worstDirection, worstRegression
  let chainage = 0,
    peakGrade = 0,
    raised = 0,
    lowered = 0,
    directionErrors = 0,
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
        const station = chainage + at
        const profile = sameWayProfiles.find(r => r.controls[0][0] - 1e-5 <= station && station <= r.controls.at(-1)[0] + 1e-5)
        const movement = y[1] - y[0]
        const mode = profile?.direction ?? (profile ? 'lower' : direction === 'raise' ? 'raise' : 'lower')
        if ((mode === 'lower' && movement > .001) || (mode === 'raise' && movement < -.001)) {
          directionErrors++
          if (!worstDirection || Math.abs(movement)>Math.abs(worstDirection.movement)) worstDirection={station,movement,x,z}
        }
        raised = Math.max(raised, y[1] - y[0])
        lowered = Math.max(lowered, y[0] - y[1])
        if (previous) {
          const slope = y.map((v, j) => Math.abs(v - previous![j]) / step)
          if (chainage + from >= start - 0.001 && chainage + to <= end + 0.001) {
            if(slope[1]>peakGrade)worst={s:chainage+at,step,previous,y,x,z}
            peakGrade = Math.max(peakGrade, slope[1])
            count++
          }
          // A way can have several disjoint profiles with different grade caps.
          // Each 2 m span uses its own design cap, including on another approach.
          const atStation = chainage + at - step / 2
          const localCaps = sameWayProfiles.filter(r => atStation >= r.controls[0][0]
            && atStation <= r.controls.at(-1)[0]).map(r => r.maximumGrade ?? .05)
          const spanLimit = localCaps.length ? Math.min(...localCaps) : nativeLimit
          if (slope[1] > spanLimit + 1e-6 && slope[1] > slope[0] + 1e-6) {
            regressions++
            if (!worstRegression || slope[1]>worstRegression.grade) worstRegression={atStation,grade:slope[1],previous,y,step}
          }
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
    for (const t of strips) {
      const origin=along.get(t.nodes?.[0]), last=along.get(t.nodes?.[1])
      if (origin===undefined || last===undefined || origin>=end || last<=start) continue
      const lo=Math.max(0,start-origin), hi=Math.min(t.length,end-origin)
      if (hi<=lo) continue
      const point=(at:number) => {
        const i=t.stations.findIndex(([d])=>d>=at-1e-9)
        const [a,y]=t.stations[Math.max(0,i-1)], [b,h]=t.stations[i<0?t.stations.length-1:i]
        const [p,q]=t.portals
        return [p[0]+(q[0]-p[0])*at/t.length,y+(h-y)*(at-a)/(b-a||1),p[2]+(q[2]-p[2])*at/t.length]
      }
      const portals=[point(lo),point(hi)]
      local.push({...t,portals,length:hi-lo,
        nodes:[lo>1e-6?`start-${id}`:t.nodes[0],hi<t.length-1e-6?`end-${id}`:t.nodes[1]],
        joints:[lo>1e-6?null:t.joints?.[0],hi<t.length-1e-6?null:t.joints?.[1]],
        stations:[[0,portals[0][1]],...t.stations.filter(([d])=>d>lo&&d<hi).map(([d,h])=>[d-lo,h]),[hi-lo,portals[1][1]]]})
    }
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
    directionErrors, worstDirection, worstRegression,
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
    (r) => r.samples && !r.directionErrors && r.maximumGrade <= r.limit + 1e-6 && !r.regressions,
  ),
)
assert(reverse.every((r) => r.checked && !r.violations))
for (const way of coveredCrossings) {
  assert(reverse.find(r => r.way === way)?.minimumRailBedClearanceM != null, 'Missing rail bed above bore ' + way)
}
