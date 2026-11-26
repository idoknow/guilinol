/**
 * City-wide ground & bridge geometric defect audit (IDOK-431).
 *
 * Scans GL04 chunks in `public/world/` (default: full city; pass `--core` for downtown core)
 * and measures before vs after runtime geometric repair (`web/src/ground-repair.ts`):
 *  1. Crosswalk-cut rectangular U-notches in sidewalks (kind=1) and split cycle/verge/sidewalk strips.
 *  2. Parallel water-crossing bridge deck chasms and hanging/unlanded wet/cliff bridge abutments.
 *  3. Adjacent 256m tile-boundary discontinuities in carriageways, sidewalks, cycleways, and bridge decks.
 *
 * Exits non-zero if South Ring / Wenchang Bridge (100_42 / 100_43) or core high-severity post-repair
 * defects fail the strict gate.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import {
  repairBridgeDeck,
  repairStreetPaths,
  setBridgeRepairKeepouts,
} from '../web/src/ground-repair.ts'

const args = process.argv.slice(2)
const coreOnly = args.includes('--core')
const reportFlagIdx = args.indexOf('--report')
const reportPath = reportFlagIdx >= 0 ? args[reportFlagIdx + 1] : null
const worldDir = process.env.WORLD_DIR ?? 'public/world'

const manifest = JSON.parse(readFileSync(`${worldDir}/manifest.json`, 'utf8'))
setBridgeRepairKeepouts(manifest.landmarks)

const LANDMARK_BRIDGE_IDS = new Set(['jiefang_bridge', 'guanyi_bridge', 'lize_bridge', 'huaqiao'])
const keepouts = (manifest.landmarks ?? [])
  .filter(lm => LANDMARK_BRIDGE_IDS.has(lm.id))
  .map(lm => [lm.position[0] + (lm.sphere?.[0] ?? 0), lm.position[2] + (lm.sphere?.[2] ?? 0), lm.sphere?.[3] ?? 80])

function inKeepout(wx, wz) {
  return keepouts.some(([kx, kz, kr]) => (wx - kx) ** 2 + (wz - kz) ** 2 <= kr * kr)
}

function vKey20(x, y, z) {
  return `${Math.round(x * 20)},${Math.round(y * 20)},${Math.round(z * 20)}`
}

function pointBorderMask(x, z) {
  let mask = 0
  if (x <= 0.06) mask |= 1
  if (x >= 255.94) mask |= 2
  if (z <= 0.06) mask |= 4
  if (z >= 255.94) mask |= 8
  return mask
}

function onTileBorderM(ax, az, bx, bz) {
  return (
    (ax <= 0.06 && bx <= 0.06) ||
    (ax >= 255.94 && bx >= 255.94) ||
    (az <= 0.06 && bz <= 0.06) ||
    (az >= 255.94 && bz >= 255.94)
  )
}

/** Count remaining parallel bridge water chasms & hanging wet/cliff abutments on a deck buffer. */
function measureDeckDefects(deck, tileX, tileZ, water, groundAt) {
  const tris = Math.floor(deck.length / 9)
  if (!tris) return { parallelChasms: 0, hangingAbutments: 0 }

  const parent = new Int32Array(tris)
  for (let i = 0; i < tris; i++) parent[i] = i
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a] } return a }
  const vmap = new Map()
  for (let i = 0; i < tris; i++) {
    for (let k = 0; k < 3; k++) {
      const o = i * 9 + k * 3
      const key = vKey20(deck[o], deck[o + 1], deck[o + 2])
      const prev = vmap.get(key)
      if (prev !== undefined) { const ra = find(i), rb = find(prev); if (ra !== rb) parent[rb] = ra }
      else vmap.set(key, i)
    }
  }
  const compMap = new Map()
  for (let i = 0; i < tris; i++) {
    const r = find(i)
    let list = compMap.get(r)
    if (!list) { list = []; compMap.set(r, list) }
    list.push(i)
  }

  const isWet = (lx, lz) => {
    const c = Math.min(64, Math.max(0, Math.round(lx / 4)))
    const r = Math.min(64, Math.max(0, Math.round(lz / 4)))
    return water[r * 65 + c] !== -32768
  }
  const isWetNear = (lx, lz, rad = 1) => {
    const c0 = Math.min(64, Math.max(0, Math.round(lx / 4)))
    const r0 = Math.min(64, Math.max(0, Math.round(lz / 4)))
    for (let dr = -rad; dr <= rad; dr++) {
      const r = r0 + dr; if (r < 0 || r > 64) continue
      for (let dc = -rad; dc <= rad; dc++) {
        const c = c0 + dc; if (c < 0 || c > 64) continue
        if (water[r * 65 + c] !== -32768) return true
      }
    }
    return false
  }

  const compEdges = []
  const compAxis = []
  for (const list of compMap.values()) {
    const emap = new Map()
    let meanX = 0, meanZ = 0, vc = 0
    for (const ti of list) {
      for (let k = 0; k < 3; k++) {
        const a = ti * 9 + k * 3, b = ti * 9 + ((k + 1) % 3) * 3, c = ti * 9 + ((k + 2) % 3) * 3
        meanX += deck[a]; meanZ += deck[a + 2]; vc++
        const ka = vKey20(deck[a], deck[a + 1], deck[a + 2]), kb = vKey20(deck[b], deck[b + 1], deck[b + 2])
        const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
        const seen = emap.get(id)
        if (seen) seen.cnt++; else emap.set(id, { a, b, c, cnt: 1 })
      }
    }
    meanX /= Math.max(1, vc); meanZ /= Math.max(1, vc)
    let sxx = 0, sxz = 0, szz = 0
    for (const ti of list) for (let k = 0; k < 3; k++) {
      const dx = deck[ti * 9 + k * 3] - meanX, dz = deck[ti * 9 + k * 3 + 2] - meanZ
      sxx += dx * dx; sxz += dx * dz; szz += dz * dz
    }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz)
    let axisX = Math.cos(ang), axisZ = Math.sin(ang)

    const open = []
    let bx = 0, bz = 0
    for (const e of emap.values()) {
      if (e.cnt !== 1) continue
      const ax = deck[e.a], ay = deck[e.a + 1], az = deck[e.a + 2]
      const bx0 = deck[e.b], by = deck[e.b + 1], bz0 = deck[e.b + 2]
      const cx = deck[e.c], cz = deck[e.c + 2]
      if (onTileBorderM(ax, az, bx0, bz0)) continue
      const ex = bx0 - ax, ez = bz0 - az, len = Math.hypot(ex, ez)
      if (len < 0.25) continue
      const tx = ex / len, tz = ez / len
      let nx = -tz, nz = tx
      const mx = (ax + bx0) * 0.5, mz = (az + bz0) * 0.5
      if ((cx - mx) * nx + (cz - mz) * nz > 0) { nx = -nx; nz = -nz }
      const touchesBorder = pointBorderMask(ax, az) !== 0 || pointBorderMask(bx0, bz0) !== 0
      if (touchesBorder) {
        const sign = (bx === 0 && bz === 0) || (tx * bx + tz * bz >= 0) ? 1 : -1
        bx += sign * tx * len; bz += sign * tz * len
      }
      open.push({ ax, ay, az, bx: bx0, by, bz: bz0, mx, my: (ay + by) * 0.5, mz, nx, nz, tx, tz, len, touchesBorder })
    }
    const bLen = Math.hypot(bx, bz)
    if (bLen > 0.5) { axisX = bx / bLen; axisZ = bz / bLen }
    compEdges.push(open)
    compAxis.push([axisX, axisZ])
  }

  let parallelChasms = 0
  for (let i = 0; i < compEdges.length; i++) {
    for (let j = i + 1; j < compEdges.length; j++) {
      let matched = 0, wetHits = 0
      for (const ea of compEdges[i]) {
        if (inKeepout(tileX + ea.mx, tileZ + ea.mz)) continue
        for (const eb of compEdges[j]) {
          if (inKeepout(tileX + eb.mx, tileZ + eb.mz)) continue
          if (ea.nx * eb.nx + ea.nz * eb.nz > -0.88) continue
          if (Math.abs(ea.my - eb.my) > 1.2) continue
          const dx = eb.mx - ea.mx, dz = eb.mz - ea.mz
          const sep = dx * ea.nx + dz * ea.nz
          if (sep < 0.15 || sep > 14.5) continue
          const along = Math.abs(dx * (-ea.nz) + dz * ea.nx)
          if (along > (ea.len + eb.len) * 0.65 + 2.5) continue
          const qx = (ea.mx + eb.mx) * 0.5, qz = (ea.mz + eb.mz) * 0.5
          if (isWet(qx, qz) || isWetNear(qx, qz, 1)) { matched++; wetHits++; break }
        }
      }
      if (matched >= 2 && wetHits > 0) parallelChasms++
    }
  }

  let hangingAbutments = 0
  const vKeyXZ = (x, z) => `${Math.round(x * 20)},${Math.round(z * 20)}`
  for (let i = 0; i < compEdges.length; i++) {
    const open = compEdges[i]
    const vertEdges = new Map()
    for (const e of open) {
      for (const [x, z] of [[e.ax, e.az], [e.bx, e.bz]]) {
        const k = vKeyXZ(x, z)
        let arr = vertEdges.get(k); if (!arr) { arr = []; vertEdges.set(k, arr) }
        arr.push(e)
      }
    }
    for (const e of open) {
      if (e.touchesBorder || e.len < 0.5 || e.len > 26 || inKeepout(tileX + e.mx, tileZ + e.mz)) continue
      const dropM = e.my - groundAt(e.mx, e.mz)
      if (!isWet(e.mx, e.mz) && dropM <= 0.45) continue
      if (!isWetNear(e.mx, e.mz, 2)) continue
      // Verify local abutment-cap topology (at least one flank turns backward into the bridge deck)
      const ka = vKeyXZ(e.ax, e.az), kb = vKeyXZ(e.bx, e.bz)
      let backFlanks = 0
      for (const [vk, px, pz] of [[ka, e.ax, e.az], [kb, e.bx, e.bz]]) {
        const inc = (vertEdges.get(vk) ?? []).filter(oe => oe !== e)
        if (inc.some(oe => {
          const ox = vKeyXZ(oe.ax, oe.az) === vk ? oe.bx : oe.ax
          const oz = vKeyXZ(oe.ax, oe.az) === vk ? oe.bz : oe.az
          const fl = Math.hypot(ox - px, oz - pz)
          return fl > 0.2 && ((ox - px) * (-e.nx) + (oz - pz) * (-e.nz)) / fl > 0.55
        })) backFlanks++
      }
      if (backFlanks < 2) continue
      // Only count as fixable hanging abutment if dry bank lies ahead within 16m inside the tile
      let hasDryAhead = false
      for (let d = 1; d <= 16; d += 1) {
        const qx = e.mx + e.nx * d, qz = e.mz + e.nz * d
        if (qx < 0.3 || qx > 255.7 || qz < 0.3 || qz > 255.7) break
        if (!isWet(qx, qz) && e.my - groundAt(qx, qz) <= 0.28) { hasDryAhead = true; break }
      }
      if (hasDryAhead) hangingAbutments++
    }
  }
  return { parallelChasms, hangingAbutments }
}

const chunks = coreOnly
  ? manifest.chunks.filter(t => Math.abs(t.x) <= 3072 && Math.abs(t.z) <= 3584)
  : manifest.chunks
const loadedSet = new Set(chunks.map(t => `${t.x},${t.z}`))

const stats = {
  scope: coreOnly ? 'core' : 'city',
  tilesScanned: chunks.length,
  before: { crosswalkNotches: 0, crosswalkStripGaps: 0, parallelBridgeChasms: 0, hangingBridgeAbutments: 0 },
  after: { crosswalkNotches: 0, crosswalkStripGaps: 0, parallelBridgeChasms: 0, hangingBridgeAbutments: 0 },
  repaired: { notches: 0, strips: 0, flushAprons: 0, stitchedBridgeTris: 0, landedBridgeTris: 0 },
  tileBoundaryMismatches: { road: 0, sidewalk: 0, cycle: 0, deck: 0 },
  nanhuanTiles: {},
  remainingCoreBridgeDefects: [],
  remainingStreetDefects: [],
}

// Track 256m tile boundary edges after repair to audit inter-tile continuity
const boundaryEdges = new Map()
const deckBorderEdges = new Map()

function recordStreetBorder(tx, tz, kind, shell) {
  for (let i = 0; i < shell.length; i++) {
    const [ax, az] = shell[i], [bx, bz] = shell[(i + 1) % shell.length]
    if (ax === bx && (ax === 0 || ax === 25600) && Math.abs(az - bz) >= 50) {
      const wx = tx + ax / 100, lo = Math.min(az, bz) / 100 + tz, hi = Math.max(az, bz) / 100 + tz
      const side = ax === 0 ? 'W' : 'E'
      const k = `V:${wx}:${tz}`
      let arr = boundaryEdges.get(k); if (!arr) { arr = []; boundaryEdges.set(k, arr) }
      arr.push({ side, kind, lo, hi })
    } else if (az === bz && (az === 0 || az === 25600) && Math.abs(ax - bx) >= 50) {
      const wz = tz + az / 100, lo = Math.min(ax, bx) / 100 + tx, hi = Math.max(ax, bx) / 100 + tx
      const side = az === 0 ? 'N' : 'S'
      const k = `H:${wz}:${tx}`
      let arr = boundaryEdges.get(k); if (!arr) { arr = []; boundaryEdges.set(k, arr) }
      arr.push({ side, kind, lo, hi })
    }
  }
}

function recordDeckBorder(tx, tz, deck) {
  for (let i = 0; i < deck.length; i += 9) {
    for (let c = 0; c < 3; c++) {
      const a = i + c * 3, b = i + ((c + 1) % 3) * 3
      const ax = deck[a], az = deck[a + 2], bx = deck[b], bz = deck[b + 2]
      if (ax <= 0.06 && bx <= 0.06 && Math.abs(az - bz) >= 0.3) {
        const k = `V:${tx}:${tz}`; let arr = deckBorderEdges.get(k); if (!arr) { arr = []; deckBorderEdges.set(k, arr) }
        arr.push({ side: 'W', lo: Math.min(az, bz) + tz, hi: Math.max(az, bz) + tz })
      } else if (ax >= 255.94 && bx >= 255.94 && Math.abs(az - bz) >= 0.3) {
        const k = `V:${tx + 256}:${tz}`; let arr = deckBorderEdges.get(k); if (!arr) { arr = []; deckBorderEdges.set(k, arr) }
        arr.push({ side: 'E', lo: Math.min(az, bz) + tz, hi: Math.max(az, bz) + tz })
      } else if (az <= 0.06 && bz <= 0.06 && Math.abs(ax - bx) >= 0.3) {
        const k = `H:${tz}:${tx}`; let arr = deckBorderEdges.get(k); if (!arr) { arr = []; deckBorderEdges.set(k, arr) }
        arr.push({ side: 'N', lo: Math.min(ax, bx) + tx, hi: Math.max(ax, bx) + tx })
      } else if (az >= 255.94 && bz >= 255.94 && Math.abs(ax - bx) >= 0.3) {
        const k = `H:${tz + 256}:${tx}`; let arr = deckBorderEdges.get(k); if (!arr) { arr = []; deckBorderEdges.set(k, arr) }
        arr.push({ side: 'S', lo: Math.min(ax, bx) + tx, hi: Math.max(ax, bx) + tx })
      }
    }
  }
}

const tStart = Date.now()
for (const tile of chunks) {
  const raw = gunzipSync(readFileSync(`${worldDir}/${tile.file}`))
  const v = raw.readUInt32LE(4), idx = raw.readUInt32LE(8), colSz = raw.readUInt32LE(12), imgSz = raw.readUInt32LE(16), tris = raw.readUInt32LE(20)
  const terrain = new Int16Array(raw.buffer, raw.byteOffset + 24, 4225)
  const water = new Int16Array(raw.buffer, raw.byteOffset + 24 + 8450, 4225)
  const off = 24 + 16900 + v * 9 + idx * 4
  const payload = JSON.parse(raw.subarray(off, off + colSz).toString('utf8'))
  const paths = payload[1][0]

  // Street repair audit: pass 1 measures original defects & repairs; pass 2 verifies idempotence (0 remaining)
  const sr1 = repairStreetPaths(paths)
  const sr2 = repairStreetPaths([...sr1.paths, ...sr1.flushPaths])
  stats.before.crosswalkNotches += sr1.repairedNotches
  stats.before.crosswalkStripGaps += sr1.repairedStripGaps
  stats.repaired.notches += sr1.repairedNotches
  stats.repaired.strips += sr1.repairedStripGaps
  stats.repaired.flushAprons += sr1.flushPaths.length
  stats.after.crosswalkNotches += sr2.repairedNotches
  stats.after.crosswalkStripGaps += sr2.repairedStripGaps
  if (sr2.repairedNotches > 0 || sr2.repairedStripGaps > 0) {
    stats.remainingStreetDefects.push({ file: tile.file, x: tile.x, z: tile.z, notches: sr2.repairedNotches, strips: sr2.repairedStripGaps })
  }

  for (const p of sr1.paths) {
    if ((p[0] === 0 || p[0] === 1 || p[0] === 5) && p[1]?.length >= 3) {
      recordStreetBorder(tile.x, tile.z, p[0], p[1])
    }
  }

  // Bridge deck repair audit
  let beforeDeck = { parallelChasms: 0, hangingAbutments: 0 }
  let afterDeck = { parallelChasms: 0, hangingAbutments: 0 }
  let br = { stitchedTriangles: 0, landedTriangles: 0 }
  if (tris > 0) {
    const end = off + colSz + imgSz, tail = end + tris * 18, extra = raw.byteLength - tail
    const uSlice = extra ? Uint8Array.prototype.slice.call(raw, tail, tail + 8450) : null
    const underlay = uSlice ? new Int16Array(uSlice.buffer, uSlice.byteOffset, 4225) : terrain
    const dSlice = Uint8Array.prototype.slice.call(raw, end, tail)
    const deck = Float32Array.from(new Int16Array(dSlice.buffer, dSlice.byteOffset, tris * 9), n => n / 100)
    const thin = new Set(payload[2] ?? [])
    const groundAt = (lx, lz) => {
      const c = Math.min(63, Math.max(0, Math.floor(lx / 4)))
      const r = Math.min(63, Math.max(0, Math.floor(lz / 4)))
      const u = lx / 4 - c, v2 = lz / 4 - r, at = r * 65 + c
      const a = underlay[at] / 10, b = underlay[at + 1] / 10, cc = underlay[at + 65] / 10, d = underlay[at + 66] / 10
      return u + v2 <= 1 ? a + (b - a) * u + (cc - a) * v2 : d + (cc - d) * (1 - u) + (b - d) * (1 - v2)
    }

    beforeDeck = measureDeckDefects(deck, tile.x, tile.z, water, groundAt)
    br = repairBridgeDeck(deck, thin, tile.x, tile.z, water, groundAt, sr1.paths, payload[1][5])
    afterDeck = measureDeckDefects(br.deck, tile.x, tile.z, water, groundAt)
    recordDeckBorder(tile.x, tile.z, br.deck)

    stats.before.parallelBridgeChasms += beforeDeck.parallelChasms
    stats.before.hangingBridgeAbutments += beforeDeck.hangingAbutments
    stats.after.parallelBridgeChasms += afterDeck.parallelChasms
    stats.after.hangingBridgeAbutments += afterDeck.hangingAbutments
    stats.repaired.stitchedBridgeTris += br.stitchedTriangles
    stats.repaired.landedBridgeTris += br.landedTriangles

    const isCore = Math.abs(tile.x) <= 2560 && Math.abs(tile.z) <= 2560
    if (isCore && (afterDeck.parallelChasms > 0 || afterDeck.hangingAbutments > 0)) {
      stats.remainingCoreBridgeDefects.push({ file: tile.file, x: tile.x, z: tile.z, ...afterDeck })
    }
  }

  if (tile.file === '100_42.glc' || tile.file === '100_43.glc' || tile.file === '98_42.glc') {
    stats.nanhuanTiles[tile.file] = {
      beforeStreet: { notches: sr1.repairedNotches, strips: sr1.repairedStripGaps },
      afterStreet: { notches: sr2.repairedNotches, strips: sr2.repairedStripGaps },
      beforeDeck,
      afterDeck,
      addedBridgeTris: { stitched: br.stitchedTriangles, landed: br.landedTriangles },
    }
  }
}

// Audit 256m tile-boundary continuity ONLY across interior borders where BOTH neighbor tiles are in scope
for (const [k, segs] of boundaryEdges) {
  const [dir, coordStr, baseStr] = k.split(':')
  const coord = Number(coordStr), base = Number(baseStr)
  const tA = dir === 'V' ? `${coord - 256},${base}` : `${base},${coord - 256}`
  const tB = dir === 'V' ? `${coord},${base}` : `${base},${coord}`
  if (!loadedSet.has(tA) || !loadedSet.has(tB)) continue
  for (const [kind, field] of [[0, 'road'], [1, 'sidewalk'], [5, 'cycle']]) {
    const s1 = segs.filter(s => s.kind === kind && (s.side === 'E' || s.side === 'S'))
    const s2 = segs.filter(s => s.kind === kind && (s.side === 'W' || s.side === 'N'))
    for (const [aList, bList] of [[s1, s2], [s2, s1]]) {
      for (const a of aList) {
        if (a.hi - a.lo < 1.2) continue
        if (!bList.some(b => Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 0.35)) {
          stats.tileBoundaryMismatches[field]++
        }
      }
    }
  }
}

for (const [k, segs] of deckBorderEdges) {
  const [dir, coordStr, baseStr] = k.split(':')
  const coord = Number(coordStr), base = Number(baseStr)
  const tA = dir === 'V' ? `${coord - 256},${base}` : `${base},${coord - 256}`
  const tB = dir === 'V' ? `${coord},${base}` : `${base},${coord}`
  if (!loadedSet.has(tA) || !loadedSet.has(tB)) continue
  const s1 = segs.filter(s => s.side === 'E' || s.side === 'S')
  const s2 = segs.filter(s => s.side === 'W' || s.side === 'N')
  for (const [aList, bList] of [[s1, s2], [s2, s1]]) {
    for (const a of aList) {
      if (a.hi - a.lo < 1.0) continue
      if (!bList.some(b => Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 0.25)) {
        stats.tileBoundaryMismatches.deck++
      }
    }
  }
}

stats.elapsedMs = Date.now() - tStart
if (reportPath) writeFileSync(reportPath, JSON.stringify(stats, null, 2) + '\n')

console.log(JSON.stringify(stats, null, 2))

// Strict acceptance gate on Nanhuan Rd / Wenchang Bridge & downtown core
const nh42 = stats.nanhuanTiles['100_42.glc']
const nh43 = stats.nanhuanTiles['100_43.glc']
const failures = []
if (nh42) {
  if (nh42.afterStreet.notches > 0 || nh42.afterStreet.strips > 0) failures.push('100_42 still has crosswalk notches/strips')
  if (nh42.afterDeck.parallelChasms > 0 || nh42.afterDeck.hangingAbutments > 0) failures.push('100_42 still has bridge chasm/hanging abutment')
}
if (nh43) {
  if (nh43.afterDeck.parallelChasms > 0 || nh43.afterDeck.hangingAbutments > 0) failures.push('100_43 still has bridge chasm/hanging abutment')
}
if (stats.after.crosswalkNotches > 0 || stats.after.crosswalkStripGaps > 0) {
  failures.push(`Remaining post-repair crosswalk defects: notches=${stats.after.crosswalkNotches}, strips=${stats.after.crosswalkStripGaps}`)
}
if (stats.remainingCoreBridgeDefects.length > 0) {
  failures.push(`Remaining core bridge defects: ${stats.remainingCoreBridgeDefects.length}`)
}
if (stats.tileBoundaryMismatches.deck > 0) {
  failures.push(`Bridge deck 256m tile-boundary mismatches: ${stats.tileBoundaryMismatches.deck}`)
}

if (failures.length) {
  console.error('AUDIT FAILED:', failures)
  process.exit(1)
}
console.log('AUDIT PASSED: South Ring / Wenchang Bridge & core ground defects = 0.')
