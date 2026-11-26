// Compare the finished Dingjiang section and the three unchanged yard crossings.
// Run from the repo root with tsx scripts/audit-dingjiang.ts MAIN_WORLD CANDIDATE_WORLD.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'
import {sampledRailhead} from './railhead'
import {ll2xz} from '../lib/projection'
import {visibleSurfaces} from './dingjiang-visible-surfaces'
import {vehicleSurface} from './vehicle-surface'

const [base, candidate] = process.argv.slice(2)
if (!candidate) throw Error('Expected baseline and candidate world directories')
const json = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'))
const roads = new Set([983781242, 983781244, 1550293846, 459580311])
const paved = new Set([...roads,1030049241,983781243])
const auditedRoads = new Set([...paved,983781246,983781248,500400552,500571918, 500400553, 500400554, 983781250, 983781252,
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
  const railhead = (x:number,z:number) => sampledRailhead(dir,m,tile(x,z),x,z)
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
    assert(samples[1].clearance >= 4.5 - .001, 'Incorrect underpass height')
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
  // Separate graded intervals may share one OSM way, with native pavement
  // between them. Audit each installed interval and all whole-way regressions.
  function stationAt(px:number,pz:number) {
    let distance=Infinity,best=0
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,len=stations[i]-stations[i-1]
      if(!len)continue
      const u=Math.max(0,Math.min(1,((px-a.x)*dx+(pz-a.z)*dz)/(len*len)))
      const d=Math.hypot(px-a.x-u*dx,pz-a.z-u*dz)
      if(d<distance){distance=d;best=stations[i-1]+u*len}
    }
    return best
  }
  const intervalsOnWay = structure === 'bridge' ? [[0,station]] : worlds[1].tunnels
    .filter(t=>t.way===id).map(t=>t.portals.map(([x,,z])=>stationAt(x,z)).sort((a,b)=>a-b))
  const cap = way.tags.highway === 'service' ? .08 : .05
  let activeIntervals = 0, aboveCap = 0, raisedM = 0, unauthorizedRiseM = 0, loweredM = 0
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
      const atStation = stations[i-1] + step*j
      if (id !== 983781244 || atStation < 1154 || atStation > 1290)
        unauthorizedRiseM = Math.max(unauthorizedRiseM, heights[1]-heights[0])
      raisedM = Math.max(raisedM, heights[1] - heights[0])
      loweredM = Math.min(loweredM, heights[1] - heights[0])
      if (previous) {
        const slope = heights.map((h,k) => Math.abs(h-previous![k])/step)
        const at = stations[i-1]+step*j
        if (intervalsOnWay.some(([lo,hi])=>lo <= at-step+.00001 && at <= hi+.00001)) {
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
  if (roads.has(id) || id === 815078159) assert(unauthorizedRiseM < .001, 'Underpass pavement raised on '+id)
  grades.push({road:id, intervals, activeIntervals, aboveCap, regressions, before, after, raisedM, unauthorizedRiseM, loweredM})
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
// Native main has no Dingjiang profile records. Compare exactly the same
// XY strips using heights from main's own rendered carriageway.
const reference=worlds[1].tunnels.filter(t=>paved.has(t.way)).map(t=>{
  const [[x,,z],[bx,,bz]]=t.portals
  const surface=(at:number)=>worlds[0].surface(x+(bx-x)*at/t.length,z+(bz-z)*at/t.length,
    {way:t.way,structure:'surface',nodes:new Set(t.nodes)})
  return {...t,footprint:undefined,joints:undefined,stations:t.stations.map(([at])=>[at,surface(at)]),
    portals:t.portals.map(([x,,z],i)=>[x,surface(i*t.length),z])}
})
// Sample both sides of each abutment on the actual incident way. A
// per-way maximum alone can miss the step between the last two vertices.
const abutments=[]
for(const [bridge,start,end] of [[983781246,983781245,500400552],[983781248,500571918,983781247]]){
  const span=ways.get(bridge)
  for(const [i,approach] of [start,end].entries()){
    const node=span.nodes[i?span.nodes.length-1:0]
    const arm=ways.get(approach)
    const ray=(way,structure)=>{
      const at=way.nodes.indexOf(node)
      assert(at===0 || at===way.nodes.length-1,'Missing abutment endpoint')
      const a=ll2xz(way.geometry[at].lat,way.geometry[at].lon)
      const p=way.geometry[at+(at===0?1:-1)],b=ll2xz(p.lat,p.lon)
      const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz)
      return (world,d)=>world.surface(a.x+d*dx/length,a.z+d*dz/length,
        {way:way.id,structure,nodes:new Set(way.nodes)})
    }
    const upper=ray(span,'bridge'),landing=ray(arm,'surface')
    const samples=worlds.map(world=>{
      const atNodeM=Math.abs(upper(world,0)-landing(world,0))
      const heights=Array.from({length:21},(_,j)=>j<10?landing(world,20-2*j):upper(world,2*j-20))
      const maxGrade=Math.max(...heights.slice(1).map((y,i)=>Math.abs(y-heights[i])/2))
      return {atNodeM,maxGrade}
    })
    abutments.push({bridge,approach,node,main:samples[0],candidate:samples[1]})
    assert(samples[1].atNodeM<=.01 && samples[1].maxGrade<=.050001,'Abutment step or grade on '+bridge)
  }
}
const mainReverse=visibleSurfaces(base,paved,auditedRoads,reference)
// Subsequent phases can add an enclosed crossing inside these original
// approaches. Resolve its upper road, roof and adjacent portal separately.
const laterBores=worlds[1].tunnels.some(t=>t.gradedLanding)
const closure=new Set(auditedRoads)
if (laterBores) {
  for (const file of fs.readdirSync('pipeline/rail-sections').filter(f => f.endsWith('.json'))) {
    const section=json(path.join('pipeline/rail-sections',file))
    for (const road of [...section.roads,...(section.additionalRoadGroups ?? []).flat()]) {
      if (road.stackedRoad && worlds[1].tunnels.some(t=>t.way===road.way && t.nodes?.[0]===road.boundaryNodes[0]))
        closure.add(road.way)
    }
  }
}
const reverse = visibleSurfaces(candidate, paved, closure, undefined, laterBores)
console.log(JSON.stringify({abutments, mainReverse, reverse, closure: [...auditedRoads].sort((a,b)=>a-b), crossings:results, grades, yardGrades}, null, 2))

assert(reverse.every(r => r.checked > 0 && r.groundViolations === 0), 'Ground-level faces intrude into a surveyed underpass')
assert(reverse.every(r => r.externalBridgeViolations === 0), 'Non-closure S2201 bridge faces above the surveyed shoulder; see upperDecks')
for(const [lower,bridge] of [[459580311,983781246],[459580311,983781248],[983781242,983781250],[983781242,983781252],[983781244,983781250],[983781244,983781252]]){
  const row=reverse.find(r=>r.way===lower)?.roadBridges[bridge]
  assert(row && row.intersections>0 && row.minClearanceM>=row.targetM && row.belowTargetFaces===0 && row.groundHits===0,
    'Road bridge clearance failed on '+bridge+' over '+lower)
}
