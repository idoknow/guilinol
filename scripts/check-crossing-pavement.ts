// tsx scripts/check-crossing-pavement.ts WORLD pipeline/rail-sections/06-dingjiang.json
import fs from 'node:fs'
import {tileFaces} from './dingjiang-visible-surfaces'
import {floorLevel, type Tunnel} from '../web/src/station-tunnels'

const [world, designPath] = process.argv.slice(2)
const manifest = JSON.parse(fs.readFileSync(world + '/manifest.json', 'utf8'))
const ways: number[] = JSON.parse(fs.readFileSync(designPath, 'utf8')).panelRoads
const crossings = (manifest.tunnels as Tunnel[]).filter(t => ways.includes(t.way))
const cell = (n: number) => Math.floor(n / 2)

type Face = {
  x: number, y: number, z: number,
  ux: number, uy: number, uz: number,
  vx: number, vy: number, vz: number,
  det: number,
}
const bins = new Map<string, Face[]>()
for (const tile of manifest.chunks) {
  const nearby = crossings.some(t => t.portals.some(([x,,z]) =>
    x >= tile.x-16 && x <= tile.x+272 && z >= tile.z-16 && z <= tile.z+272))
  if (!nearby) continue
  tileFaces(world, tile, manifest.tunnels, (vertices, role) => {
    if (!['tunnel-lining', 'paving-0', 'rail-bed'].includes(role)) return
    const [[x,y,z], b, c] = vertices
    const [ux,uy,uz] = [b[0]-x, b[1]-y, b[2]-z]
    const [vx,vy,vz] = [c[0]-x, c[1]-y, c[2]-z]
    const det = ux*vz - uz*vx
    if (Math.abs(det) < 1e-9) return
    const face = {x,y,z,ux,uy,uz,vx,vy,vz,det}
    for (let i=cell(Math.min(x,b[0],c[0])); i<=cell(Math.max(x,b[0],c[0])); i++) {
      for (let j=cell(Math.min(z,b[2],c[2])); j<=cell(Math.max(z,b[2],c[2])); j++) {
        const key = i + ',' + j
        if (!bins.has(key)) bins.set(key, [])
        bins.get(key)!.push(face)
      }
    }
  }, true)
}

function visibleHeight(x: number, z: number) {
  let top = -Infinity
  for (const f of bins.get(cell(x) + ',' + cell(z)) ?? []) {
    const dx = x - f.x, dz = z - f.z
    const u = (dx*f.vz - dz*f.vx) / f.det
    const v = (f.ux*dz - f.uz*dx) / f.det
    if (u >= -1e-7 && v >= -1e-7 && u+v <= 1.0000001)
      top = Math.max(top, f.y + f.uy*u + f.vy*v)
  }
  return top
}

const reports: Record<number, object> = {}
for (const way of ways) {
  let checked=0, low=0, high=0, min=Infinity, max=-Infinity
  const examples: number[][] = []
  for (const section of crossings.filter(t => t.way === way)) {
    const [[ax,,az],[bx,,bz]] = section.portals
    const dx = (bx-ax)/section.length, dz = (bz-az)/section.length
    for (let s=.025; s<section.length; s+=.125) {
      for (let side=.025-section.halfWidth; side<section.halfWidth; side+=.125) {
        const x = ax+dx*s-dz*side, z = az+dz*s+dx*side
        const floor = floorLevel(section, x, z)
        if (floor === undefined) continue
        const delta = visibleHeight(x, z) - floor
        checked++
        min = Math.min(min, delta)
        max = Math.max(max, delta)
        if (delta < -.05) low++
        if (delta > .05) high++
        if (Math.abs(delta) > .05 && examples.length < 5) examples.push([x,z,delta])
      }
    }
  }
  if (!checked || low || high) process.exitCode=1
  reports[way] = {checked,low,high,min,max,examples}
}
console.log(JSON.stringify(reports, null, 2))
