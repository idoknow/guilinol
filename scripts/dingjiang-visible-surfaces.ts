// Compare each polygon to the piecewise-linear grade over their actual overlap.
// Checking only mesh vertices misses triangles that cross the entire carriageway.
import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import * as THREE from 'three'
import { ll2xz } from '../lib/projection'
import streetRules from '../pipeline/streets.json'
import { bridgeGeometry } from '../web/src/look/bridge'
import { streetGeometry } from '../web/src/street-worker'
import { joinPortalRoads, tunnelGeometry, floorLevel, type Tunnel } from '../web/src/tunnels'

type Vertex = [number, number, number]
type Cut = (v: Vertex) => number
function clip(poly: Vertex[], side: Cut) {
  const result: Vertex[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      u = side(a),
      v = side(b)
    if (u >= 0) result.push(a)
    if (u >= 0 !== v >= 0) result.push(a.map((c, k) => c + ((b[k] - c) * u) / (u - v)) as Vertex)
  }
  return result
}

function tileFaces(world: string, tile: any, tunnels: Tunnel[], visit: (p: Vertex[], role: string) => void) {
  const raw = gunzipSync(fs.readFileSync(path.join(world, tile.file)))
  const [v, i, n, image, deck] = [4, 8, 12, 16, 20].map((k) => raw.readUInt32LE(k))
  const off = 16924 + 9 * v + 4 * i,
    tail = off + n + image + 18 * deck
  const [, paths, thin = [], asphalt = [], , , railCuts = []] = JSON.parse(raw.toString('utf8', off, off + n))
  const base = raw.length === tail ? 24 : tail
  const wet = (r: number, c: number) => raw.readInt16LE(8474 + 2 * (65 * r + c)) !== -32768
  const step = Array.from({ length: 4225 }, (_, i) => wet(Math.floor(i / 65), i % 65)).some(Boolean) ? 4 : 8
  const count = 256 / step,
    stride = count + 1
  const g = new THREE.PlaneGeometry(256, 256, count, count)
  g.rotateX(-Math.PI / 2).translate(128, 0, 128)
  const positions = g.getAttribute('position')
  const read = (r: number, c: number) => raw.readInt16LE(base + 2 * (65 * r + c)) / 10
  const dryEdges = [0, 64].flatMap((e) => [
    Array.from({ length: 65 }, (_, i) => wet(i, e)).every((x) => !x),
    Array.from({ length: 65 }, (_, i) => wet(e, i)).every((x) => !x),
  ])
  for (let r = 0; r <= count; r++)
    for (let c = 0; c <= count; c++) {
      const x = (c * step) / 4,
        z = (r * step) / 4
      let y = read(z, x)
      if ((x === 0 && dryEdges[0]) || (x === 64 && dryEdges[2]))
        y = THREE.MathUtils.lerp(read(z & ~7, x), read(Math.min(64, (z & ~7) + 8), x), (z % 8) / 8)
      else if ((z === 0 && dryEdges[1]) || (z === 64 && dryEdges[3]))
        y = THREE.MathUtils.lerp(read(z, x & ~7), read(z, Math.min(64, (x & ~7) + 8)), (x % 8) / 8)
      positions.setY(r * stride + c, y)
    }
  const street = streetGeometry(paths, (x, z) => {
    const col = THREE.MathUtils.clamp(Math.floor(x / step), 0, count - 1),
      row = THREE.MathUtils.clamp(Math.floor(z / step), 0, count - 1)
    const u = x / step - col,
      v = z / step - row,
      k = row * stride + col
    const a = positions.getY(k),
      b = positions.getY(k + 1),
      c = positions.getY(k + stride),
      d = positions.getY(k + stride + 1)
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v)
  })
  joinPortalRoads(tile, tunnels, [street.positions])
  for (let t = 0; t < street.positions.length; t += 9) {
    visit(
      [0, 3, 6].map((off) => [
        tile.x + street.positions[t + off],
        street.positions[t + off + 1],
        tile.z + street.positions[t + off + 2],
      ]),
      'paving-' + street.kinds[t / 3],
    )
  }
  for (const [k, y] of railCuts) positions.setY(k, y / 100)
  const tunnel = tunnelGeometry(tile, g, tunnels)
  function mesh(geometry: THREE.BufferGeometry, role: string) {
    const p = geometry.getAttribute('position'),
      ix = geometry.index
    for (let j = 0; j < (ix?.count ?? p.count); j += 3)
      visit(
        [0, 1, 2].map((offset) => {
          const k = ix ? ix.getX(j + offset) : j + offset
          return [tile.x + p.getX(k), p.getY(k), tile.z + p.getZ(k)]
        }),
        role,
      )
  }
  mesh(g, 'terrain')
  if (tunnel && 'lining' in tunnel) {
    mesh(tunnel.lining.geometry, 'tunnel-lining')
    mesh(tunnel.lights.geometry, 'tunnel-lights')
  } else if (tunnel) {
    for (const [kind, item] of Object.entries(tunnel)) if (item) mesh(item.geometry, kind)
  }
  if (deck) {
    const data = Float32Array.from(
      { length: deck * 9 },
      (_, k) => raw.readInt16LE(off + n + image + 2 * k) / 100,
    )
    mesh(bridgeGeometry(data, new Set<number>(thin), asphalt), 'deck')
  }
}

export function visibleSurfaces(world: string, ids: Set<number>, closure: Set<number>) {
  const manifest = JSON.parse(fs.readFileSync(path.join(world, 'manifest.json'), 'utf8'))
  const strips = (manifest.tunnels as Tunnel[])
    .filter((t) => ids.has(t.way))
    .map((t) => {
      const [[x, , z], [bx, , bz]] = t.portals,
        dx = (bx - x) / t.length,
        dz = (bz - z) / t.length,
        w = t.halfWidth + 2
      return {
        t,
        x,
        z,
        dx,
        dz,
        w,
        left: Math.min(x, bx) - w,
        right: Math.max(x, bx) + w,
        top: Math.min(z, bz) - w,
        bottom: Math.max(z, bz) + w,
      }
    })
  // Only named OSM bridge alignments can account for an upper deck. An
  // unassigned deck is subject to the same 5 cm test as ground-level paving.
  const bridges = JSON.parse(fs.readFileSync('raw/osm-2026-11.json', 'utf8'))
    .elements.filter((w: any) => w.type === 'way' && w.tags?.bridge === 'yes' && w.tags?.ref === 'S2201')
    .map((w: any) => ({ way: w.id, points: w.geometry.map((p: any) => ll2xz(p.lat, p.lon)) }))
  function deckOwner(points: Vertex[]): number | undefined {
    const covers = (p: Vertex, a: { x: number; z: number }, b: { x: number; z: number }) => {
      const dx = b.x - a.x,
        dz = b.z - a.z,
        length = Math.hypot(dx, dz),
        x = p[0] - a.x,
        z = p[2] - a.z
      const at = (x * dx + z * dz) / length
      return at >= -2.52 && at <= length + 2.52 && Math.abs(x * dz - z * dx) / length <= 5.02
    }
    return bridges.find((bridge: any) =>
      points.every((p) =>
        bridge.points.some((a: any, i: number, pts: any[]) => i + 1 < pts.length && covers(p, a, pts[i + 1])),
      ),
    )?.way
  }
  const reports = new Map(
    [...ids].map((id) => [
      id,
      {
        way: id,
        checked: 0,
        violations: 0,
        externalBridgeViolations: 0,
        upperDecks: {} as Record<number, { faces: number; minSeparationM: number; maxSeparationM: number }>,
        maxGroundExcessM: 0,
        worst: null as any,
        byRole: {} as Record<string, number>,
      },
    ]),
  )
  for (const tile of manifest.chunks) {
    const local = strips.filter(
      (s) => s.left <= tile.x + 256 && s.right >= tile.x && s.top <= tile.z + 256 && s.bottom >= tile.z,
    )
    if (!local.length) continue
    tileFaces(world, tile, manifest.tunnels, (points, role) => {
      const bridgeWay = role === 'deck' ? deckOwner(points) : undefined
      for (const s of local) {
        if (
          points.every((p) => p[0] < s.left) ||
          points.every((p) => p[0] > s.right) ||
          points.every((p) => p[2] < s.top) ||
          points.every((p) => p[2] > s.bottom)
        )
          continue
        const project = ([x, y, z]: Vertex): Vertex => [
          (x - s.x) * s.dx + (z - s.z) * s.dz,
          y,
          (z - s.z) * s.dx - (x - s.x) * s.dz,
        ]
        let poly = points.map(project)
        poly = clip(
          clip(poly, (p) => s.w - p[2]),
          (p) => s.w + p[2],
        )
        if (!poly.length) continue
        const lo = Math.min(...poly.map((v) => v[0])),
          hi = Math.max(...poly.map((v) => v[0]))
        const report = reports.get(s.t.way)!
        let lowest = Infinity,
          worst = -Infinity,
          where: Vertex | undefined
        for (let k = 1; k < s.t.stations.length; k++) {
          const [a, y] = s.t.stations[k - 1],
            [b, h] = s.t.stations[k]
          if (hi < a || lo > b) continue
          for (const v of clip(
            clip(poly, (p) => p[0] - a),
            (p) => b - p[0],
          )) {
            let grade = y + ((h - y) * (v[0] - a)) / (b - a)
            const x = s.x + v[0] * s.dx - v[2] * s.dz,
              z = s.z + v[0] * s.dz + v[2] * s.dx
            for (const other of local) {
              if (!s.t.nodes?.some((n) => other.t.nodes?.includes(n))) continue
              const surface = floorLevel(other.t, x, z)
              if (surface !== undefined) grade = Math.max(grade, surface)
              const at = (x - other.x) * other.dx + (z - other.z) * other.dz
              const lateral = Math.abs((z - other.z) * other.dx - (x - other.x) * other.dz)
              if (at >= 0 && at <= other.t.length && lateral <= other.w) {
                const i = other.t.stations.findIndex(([d]) => d >= at)
                const [lo, y] = other.t.stations[Math.max(0, i - 1)],
                  [hi, h] = other.t.stations[i]
                grade = Math.max(grade, y + ((h - y) * (at - lo)) / (hi - lo || 1))
              }
            }
            let reveal = 0
            if (role === 'paving-1' || role === 'paving-6') {
              for (const other of local) {
                // Changfeng's constructed 1.10 m median and collector-section
                // verge and sidewalk carry their own 15 cm curb reveal.
                if (other.t.way !== 459580311) continue
                const along = (x - other.x) * other.dx + (z - other.z) * other.dz
                const side = Math.abs((z - other.z) * other.dx - (x - other.x) * other.dz)
                const { verge, cycle, curb, walk } = streetRules.sections.collector
                const edge = side - other.t.halfWidth
                if (
                  along >= -1 &&
                  along <= other.t.length + 1 &&
                  (side <= 0.57 ||
                    (edge >= -0.04 && edge <= verge + 0.04) ||
                    (edge >= verge + cycle - 0.04 && edge <= verge + cycle + curb + walk + 0.04))
                )
                  reveal = 0.15
              }
            }
            const extra = v[1] - grade - reveal
            lowest = Math.min(lowest, extra)
            if (extra > worst) {
              worst = extra
              where = [s.x + v[0] * s.dx - v[2] * s.dz, v[1], s.z + v[0] * s.dz + v[2] * s.dx]
            }
          }
        }
        if (!where) continue
        if (bridgeWay !== undefined) {
          const upper = (report.upperDecks[bridgeWay] ??= {
            faces: 0,
            minSeparationM: Infinity,
            maxSeparationM: -Infinity,
          })
          upper.faces++
          upper.minSeparationM = Math.min(upper.minSeparationM, lowest)
          upper.maxSeparationM = Math.max(upper.maxSeparationM, worst)
          if (!closure.has(bridgeWay) && worst > 0.05001) report.externalBridgeViolations++
          continue
        }
        report.checked++
        if (worst > 0.05001) {
          report.violations++
          report.byRole[role] = (report.byRole[role] ?? 0) + 1
        }
        if (worst > report.maxGroundExcessM) {
          report.maxGroundExcessM = worst
          report.worst = { role, where }
        }
      }
    })
  }
  return [...reports.values()].map(({ violations, externalBridgeViolations, ...fields }) => ({
    ...fields,
    groundViolations: violations,
    externalBridgeViolations,
    violations: violations + externalBridgeViolations,
  }))
}
