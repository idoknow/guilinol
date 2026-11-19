import * as THREE from 'three'
import vesselBounds from '../../../pipeline/vessel-bounds.json'
import type {Stream} from '../stream'
import {walkConfig as cfg} from './config'
import type {createPhysics} from './physics'
import {vehicleModel} from './vehicle-model'

type Physics = Awaited<ReturnType<typeof createPhysics>>
type Position = [number, number, number]
type Route = {kind: string; start: string; end: string; path: Position[]}
type BoundsRect = {width: number; length: number; roof: number; head: number}

export type FreeBoatKind = 'rowboat' | 'freeRaft'
export type BoatBlockReason = '' | 'bridge' | 'lock' | 'shallow' | 'obstacle' | 'offshore'

export interface BoatSpec extends BoundsRect {
  kind: FreeBoatKind
  modelKind: string
  requiredClearance: number
  vMaxFwd: number
  vMaxRev: number
  aFwd: number
  aRev: number
  kLong: number
  kLat: number
  turnAccel: number
  turnMax: number
  kYaw: number
  seatOffset: number
}

export interface BoatProbe {
  kind: FreeBoatKind
  x: number
  y: number
  waterY: number
  z: number
  heading: number
  speed: number
  vLong: number
  vLat: number
  vx: number
  vz: number
  blocked: boolean
  reason: BoatBlockReason
  blockReason: BoatBlockReason
  clearance: number
  toast: string
}

export interface MooringSlot {
  name: string
  kind: FreeBoatKind
  spec: BoatSpec
  dockPos: Position
  autoStarts: [number, number][]
  resolved: boolean
  resolveKey: string
  resolveRuns: number
  bank: Position | null
  mooring: Position | null
  heading: number
  parkedPos: Position | null
  parkedHeading: number
  mesh: THREE.Mesh
  pier: THREE.Mesh
}

interface BoatEnv {
  group: THREE.Group
  docks: Record<string, Position>
  routes: Route[]
  sim: Physics
  stream: Stream
}

const RAW_BOUNDS = vesselBounds as {boat: BoundsRect; raft: BoundsRect; rowboat?: BoundsRect}

const SPECS: Record<FreeBoatKind, BoatSpec> = {
  rowboat: {
    kind: 'rowboat',
    modelKind: 'rowboat',
    width: RAW_BOUNDS.rowboat?.width ?? 1.35,
    length: RAW_BOUNDS.rowboat?.length ?? 3.4,
    roof: RAW_BOUNDS.rowboat?.roof ?? 0.52,
    head: RAW_BOUNDS.rowboat?.head ?? 1.28,
    requiredClearance: 0.30,
    vMaxFwd: 3.6,
    vMaxRev: 1.7,
    aFwd: 3.0,
    aRev: 3.5,
    kLong: 0.90,
    kLat: 3.8,
    turnAccel: 5.0,
    turnMax: 1.25,
    kYaw: 5.4,
    seatOffset: -0.49,
  },
  freeRaft: {
    kind: 'freeRaft',
    modelKind: 'raft',
    width: RAW_BOUNDS.raft.width,
    length: RAW_BOUNDS.raft.length,
    roof: RAW_BOUNDS.raft.roof,
    head: RAW_BOUNDS.raft.head,
    requiredClearance: 0.30,
    vMaxFwd: 3.4,
    vMaxRev: 1.5,
    aFwd: 2.6,
    aRev: 3.2,
    kLong: 0.85,
    kLat: 3.4,
    turnAccel: 4.2,
    turnMax: 1.05,
    kYaw: 5.0,
    seatOffset: -0.44,
  },
}

const RIVER_DOCKS = new Set(['解放桥码头', '象山渔人码头', '文昌桥码头', '龙船坪码头'])

// Pre-validated shore/water pairs outside auto-dock < 9 m radius with >= 7.5 m separation from auto routes.
const PRIOR_MOORINGS: Record<string, {bank: [number, number]; mooring: [number, number]}> = {
  '榕湖': {bank: [-1340, 326], mooring: [-1340, 320.5]},
  '杉湖': {bank: [-842, 542], mooring: [-844, 550]},
  '日月湾码头': {bank: [-918, 514], mooring: [-918, 521.5]},
  '知音台码头': {bank: [-826, 636], mooring: [-832.9, 633.1]},
  '桂湖': {bank: [-1572, -358], mooring: [-1566.7, -352.7]},
  '木龙湖': {bank: [-344, -1570], mooring: [-344, -1574]},
  '解放桥码头': {bank: [-164, 162], mooring: [-170.9, 159.1]},
  '象山渔人码头': {bank: [-606, 612], mooring: [-596.5, 612]},
  '文昌桥码头': {bank: [-1230, 1038], mooring: [-1230, 1030.5]},
  '龙船坪码头': {bank: [-1340, 2906], mooring: [-1334, 2906]},
}

// Downstream tangents for Li River (main stem) & Taohua River confluence; Four Lakes stay static (0 m/s).
const LIJIANG_LINE: readonly [number, number][] = [
  [130, -1326], [130, -950], [46, -580], [-179, 69], [-405, 441], [-637, 954], [-731, 1363], [-645, 1809],
]
const TAOHUA_LINE: readonly [number, number][] = [
  [-2150, 264], [-1971, 601], [-1828, 882], [-1614, 1075], [-1145, 1033], [-856, 1041], [-637, 954],
]
const CALM_LAKE_BOXES: readonly [number, number, number, number][] = [
  [-1120, -640, 320, 800],   // Shanhu
  [-1760, -1080, -50, 520],  // Ronghu
  [-1820, -1240, -1420, -50], // Guihu
  [-1260, -10, -1820, -1350], // Mulonghu
]

const HEADING_STEPS = Array.from({length: 8}, (_, i) => (i * Math.PI) / 4)
const SECTOR_OFFSETS = [Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, 0, (3 * Math.PI) / 4, (-3 * Math.PI) / 4, Math.PI]
const RING_ANGLES = Array.from({length: 16}, (_, i) => (i * Math.PI) / 8)
const DISMOUNT_RADII = [1.8, 2.8, 4.0, 5.5, 7.2]
const JOINT_RESET_NAMES = ['ThighL', 'ThighR', 'ShinL', 'ShinR', 'ArmL', 'ArmR', 'ForearmL', 'ForearmR', 'Torso', 'Head'] as const

function deadzone(value: number, threshold = 0.10) {
  const abs = Math.abs(value)
  if (abs <= threshold) return 0
  return (Math.sign(value) * (abs - threshold)) / (1 - threshold)
}

function smoothstep01(t: number) {
  const c = THREE.MathUtils.clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}

function closestPolylineTangent(px: number, pz: number, line: readonly [number, number][]) {
  let minDistSq = Infinity, bestTx = 0, bestTz = 0
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1]
    const dx = bx - ax, dz = bz - az, lenSq = dx * dx + dz * dz
    if (lenSq < 1e-6) continue
    const t = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1)
    const qx = ax + dx * t, qz = az + dz * t
    const dSq = (px - qx) ** 2 + (pz - qz) ** 2
    if (dSq < minDistSq) {
      minDistSq = dSq
      const len = Math.sqrt(lenSq)
      bestTx = dx / len; bestTz = dz / len
    }
  }
  return {dist: Math.sqrt(minDistSq), tx: bestTx, tz: bestTz}
}

function waterFlow(x: number, z: number, out: {vx: number; vz: number}) {
  for (const [minX, maxX, minZ, maxZ] of CALM_LAKE_BOXES) {
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
      out.vx = 0; out.vz = 0; return
    }
  }
  const li = closestPolylineTangent(x, z, LIJIANG_LINE)
  if (li.dist <= 160) {
    const scale = li.dist <= 135 ? 1 : 1 - smoothstep01((li.dist - 135) / 25)
    out.vx = li.tx * 0.42 * scale
    out.vz = li.tz * 0.42 * scale
    return
  }
  const tao = closestPolylineTangent(x, z, TAOHUA_LINE)
  if (tao.dist <= 60) {
    const scale = tao.dist <= 45 ? 1 : 1 - smoothstep01((tao.dist - 45) / 15)
    out.vx = tao.tx * 0.25 * scale
    out.vz = tao.tz * 0.25 * scale
    return
  }
  out.vx = 0; out.vz = 0
}

/** Creates runtime manager for all 10 Guilin free-boating docks, water physics, and clearance gates. */
export function createFreeBoats(env: BoatEnv) {
  const {group, docks, routes, sim, stream} = env
  const pierShape = new THREE.BoxGeometry(1, 1, 1)
  const pierMaterial = new THREE.MeshStandardMaterial({color: 0x7e6248})

  const slots: MooringSlot[] = Object.entries(docks).map(([name, dockPos]) => {
    const kind: FreeBoatKind = RIVER_DOCKS.has(name) ? 'freeRaft' : 'rowboat'
    const spec = SPECS[kind]
    const mesh = vehicleModel(spec.modelKind)
    mesh.visible = false
    group.add(mesh)
    const pier = new THREE.Mesh(pierShape, pierMaterial)
    pier.visible = false
    group.add(pier)
    const autoStarts: [number, number][] = routes
      .filter(r => r.start === name)
      .map(r => [r.path[0][0], r.path[0][2]])
    return {
      name,
      kind,
      spec,
      dockPos,
      autoStarts,
      resolved: false,
      resolveKey: '',
      resolveRuns: 0,
      bank: null,
      mooring: null,
      heading: 0,
      parkedPos: null,
      parkedHeading: 0,
      mesh,
      pier,
    }
  })

  let activeSlot: MooringSlot | null = null
  let boatX = 0, boatZ = 0, waterY = 0, heading = 0
  let vx = 0, vz = 0, vLong = 0, vLat = 0, angVel = 0
  let waveTime = 0, strokePhase = 0, bobY = 0, roll = 0, pitch = 0
  let grazingAxis: '' | 'x' | 'z' = ''
  let lastBlocked = false
  let lastBlockReason: BoatBlockReason = ''
  let lastClearance = Infinity
  let lastToastAt = -Infinity
  let lastToastReason: BoatBlockReason = ''
  let lastToastText = ''
  const flowTmp = {vx: 0, vz: 0}
  const boxMeasure = new THREE.Box3()
  const figMeasure = new THREE.Box3()

  function waterSample(px: number, pz: number): {waterY: number; lockJump: boolean} | null {
    const tile = sim.tileAt(px, pz)
    const data = tile && stream.loaded.get(tile)
    if (!tile || !data) return null
    const gx = (px - tile.x) / 4, gz = (pz - tile.z) / 4
    const col = THREE.MathUtils.clamp(Math.floor(gx), 0, 63)
    const row = THREE.MathUtils.clamp(Math.floor(gz), 0, 63)
    const fx = THREE.MathUtils.clamp(gx - col, 0, 1)
    const fz = THREE.MathUtils.clamp(gz - row, 0, 1)
    const i00 = row * 65 + col, i10 = i00 + 1, i01 = i00 + 65, i11 = i01 + 1
    const {water, terrain} = data
    if (
      water[i00] === -32768 || water[i00] - terrain[i00] <= 5 ||
      water[i10] === -32768 || water[i10] - terrain[i10] <= 5 ||
      water[i01] === -32768 || water[i01] - terrain[i01] <= 5 ||
      water[i11] === -32768 || water[i11] - terrain[i11] <= 5
    ) return null
    const w00 = water[i00] / 10, w10 = water[i10] / 10
    const w01 = water[i01] / 10, w11 = water[i11] / 10
    const wMin = Math.min(w00, w10, w01, w11), wMax = Math.max(w00, w10, w01, w11)
    const w0 = w00 + (w10 - w00) * fx
    const w1 = w01 + (w11 - w01) * fx
    return {waterY: w0 + (w1 - w0) * fz, lockJump: wMax - wMin > 1.2}
  }

  function waterAt(px: number, pz: number): number | null {
    return waterSample(px, pz)?.waterY ?? null
  }

  function measureClearancePoints(spec: BoatSpec, x: number, z: number, h: number, baseWaterY: number, includeAhead: boolean) {
    const fwdX = -Math.sin(h), fwdZ = -Math.cos(h)
    const rightX = Math.cos(h), rightZ = -Math.sin(h)
    const hwMesh = spec.width * 0.5, hlMesh = spec.length * 0.5
    const vesselHeight = Math.max(spec.roof, spec.head)
    let minClearance = Infinity, minAvailable = Infinity

    const samplePoint = (across: number, along: number) => {
      const wx = x + rightX * across + fwdX * along
      const wz = z + rightZ * across + fwdZ * along
      const ptWater = waterAt(wx, wz)
      const localWater = ptWater !== null && Math.abs(ptWater - baseWaterY) <= 1.2 ? Math.max(baseWaterY, ptWater) : baseWaterY
      const bottom = sim.waterCeiling(wx, wz, localWater)
      if (!Number.isFinite(bottom)) return
      const avail = bottom - localWater
      const clear = avail - vesselHeight
      if (clear < minClearance) {
        minClearance = clear
        minAvailable = avail
      }
    }

    // Full 3x3 points inside actual boat footprint (aligned with dynamic clearance() and never clipped by ahead when reversing).
    samplePoint(-hwMesh, hlMesh)
    samplePoint(0, hlMesh)
    samplePoint(hwMesh, hlMesh)
    samplePoint(-hwMesh, 0)
    samplePoint(0, 0)
    samplePoint(hwMesh, 0)
    samplePoint(-hwMesh, -hlMesh)
    samplePoint(0, -hlMesh)
    samplePoint(hwMesh, -hlMesh)
    const footprintClearance = minClearance
    if (minClearance < spec.requiredClearance) {
      return {ok: false, minClearance, footprintClearance, minAvailable}
    }

    if (includeAhead) {
      const ahead = hlMesh + 0.70
      samplePoint(-hwMesh, ahead)
      samplePoint(0, ahead)
      samplePoint(hwMesh, ahead)
      if (minClearance < spec.requiredClearance) {
        return {ok: false, minClearance, footprintClearance, minAvailable}
      }
    }
    return {ok: true, minClearance, footprintClearance, minAvailable}
  }

  function evaluateHull(spec: BoatSpec, x: number, z: number, h: number, refWaterY: number | null, includeAhead: boolean): {
    ok: boolean
    reason: BoatBlockReason
    waterY: number
    clearance: number
    footprintClearance: number
    available: number
  } {
    const hw = spec.width * 0.5 + 0.25, hl = spec.length * 0.5 + 0.25
    const fwdX = -Math.sin(h), fwdZ = -Math.cos(h)
    const rightX = Math.cos(h), rightZ = -Math.sin(h)

    const hullPts: readonly [number, number][] = [
      [0, 0], [0, hl], [-hw, hl], [hw, hl], [-hw, -hl], [hw, -hl],
    ]
    let centerY = 0
    for (let i = 0; i < hullPts.length; i++) {
      const [across, along] = hullPts[i]
      const wx = x + rightX * across + fwdX * along
      const wz = z + rightZ * across + fwdZ * along
      const sample = waterSample(wx, wz)
      if (!sample) {
        return {ok: false, reason: 'shallow', waterY: refWaterY ?? 0, clearance: Infinity, footprintClearance: Infinity, available: Infinity}
      }
      const ptY = sample.waterY
      if (i === 0) centerY = ptY
      const cmpBase = refWaterY ?? centerY
      if (sample.lockJump || Math.abs(ptY - cmpBase) > 1.2 || Math.abs(ptY - centerY) > 1.2) {
        return {ok: false, reason: 'lock', waterY: cmpBase, clearance: Infinity, footprintClearance: Infinity, available: Infinity}
      }
    }

    // Guard against down-step waterY damping lag: hull & rider sit at max(centerY, refWaterY) until damped down.
    const effectiveWaterY = refWaterY === null ? centerY : Math.max(centerY, refWaterY)
    const clearCheck = measureClearancePoints(spec, x, z, h, effectiveWaterY, includeAhead)
    if (!clearCheck.ok) {
      return {ok: false, reason: 'bridge', waterY: centerY, clearance: clearCheck.minClearance, footprintClearance: clearCheck.footprintClearance, available: clearCheck.minAvailable}
    }

    const topHeight = Math.max(spec.roof, spec.head)
    const boxH = topHeight - 0.22
    const boxCenterY = effectiveWaterY + 0.22 + boxH * 0.5
    if (sim.waterOverlap(x, boxCenterY, z, h, hw - 0.15, boxH * 0.5, hl - 0.15)) {
      return {ok: false, reason: 'obstacle', waterY: centerY, clearance: clearCheck.minClearance, footprintClearance: clearCheck.footprintClearance, available: clearCheck.minAvailable}
    }

    return {ok: true, reason: '', waterY: centerY, clearance: clearCheck.minClearance, footprintClearance: clearCheck.footprintClearance, available: clearCheck.minAvailable}
  }

  function clearState() {
    bobY = roll = pitch = 0
    grazingAxis = ''
    lastBlocked = false
    lastBlockReason = ''
    lastToastAt = -Infinity
    lastToastReason = ''
    lastToastText = ''
  }

  function emitToast(reason: BoatBlockReason, text: string, ms = 4500) {
    if (reason !== 'offshore' && reason === lastToastReason && waveTime - lastToastAt < 2.5) return
    lastToastAt = waveTime
    lastToastReason = reason
    lastToastText = text
    window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text, ms}}))
  }

  function notifyBlock(spec: BoatSpec, reason: BoatBlockReason, available: number) {
    if (reason === 'bridge') {
      const reqHeight = Math.max(spec.roof, spec.head) + spec.requiredClearance
      emitToast('bridge', `前方桥洞净高仅 ${Math.max(0, available).toFixed(1)} m，无法通过（需 ${reqHeight.toFixed(1)} m）`)
    } else if (reason === 'lock') {
      emitToast('lock', '前方水闸水位落差较大，此处无法直接划过')
    }
  }

  function isDrySupport(x: number, z: number, refWaterY?: number) {
    const tile = sim.tileAt(x, z)
    if (!tile || !stream.loaded.has(tile) || sim.insideHouse(x, z)) return null
    const origin = refWaterY !== undefined ? refWaterY + 2.5 : 4000
    const reach = refWaterY !== undefined ? 4.5 : 6000
    const deck = sim.surface(x, z, 'deck', origin, reach)
    const support = deck ?? sim.surface(x, z, 'sidewalk') ?? sim.surface(x, z, 'ground')
    if (!support || support.slope > cfg.slope) return null
    if (!deck && sim.wet(x, z)) return null
    if (deck && refWaterY !== undefined && deck.y <= refWaterY + 0.15) return null
    if (refWaterY !== undefined && support.y < refWaterY - 0.1) return null
    const peak = sim.surface(x, z, 'peak')
    if (peak && peak.y > support.y + 0.05) return null
    const y = support.y + cfg.height / 2 + 0.055
    if (!sim.freeCapsule(x, y, z)) return null
    return {x, y, z, supportY: support.y}
  }

  function validateMooringPair(slot: MooringSlot, bx: number, bz: number, mx: number, mz: number): boolean {
    const [dx,, dz] = slot.dockPos
    const dockDist = Math.hypot(bx - dx, bz - dz)
    if (dockDist < 9.6 || dockDist > 22.0) return false
    const pierDist = Math.hypot(mx - bx, mz - bz)
    if (pierDist < 3.2 || pierDist > 10.5) return false
    for (const [ax, az] of slot.autoStarts) {
      if (Math.hypot(mx - ax, mz - az) < 7.5) return false
    }
    const dry = isDrySupport(bx, bz)
    if (!dry) return false

    const baseWater = waterAt(mx, mz)
    if (baseWater === null) return false
    if (sim.pathBlocked(bx, bz, mx, mz, Math.max(dry.supportY, baseWater) + 0.65)) return false

    const outward = Math.atan2(-(mx - bx), -(mz - bz))
    let bestHeading: number | null = null, bestScore = -Infinity
    for (const offset of HEADING_STEPS) {
      const h = outward + offset
      const here = evaluateHull(slot.spec, mx, mz, h, null, true)
      if (!here.ok) continue
      const rotOk =
        evaluateHull(slot.spec, mx, mz, h + 0.35, here.waterY, false).ok &&
        evaluateHull(slot.spec, mx, mz, h - 0.35, here.waterY, false).ok
      const probeDist = 2.5
      const aheadOk = evaluateHull(slot.spec, mx - Math.sin(h) * probeDist, mz - Math.cos(h) * probeDist, h, here.waterY, true).ok
      const align = Math.cos(offset)
      const score = (rotOk ? 20 : 0) + (aheadOk ? 10 : 0) + align
      if (score > bestScore) {
        bestScore = score
        bestHeading = h
      }
    }
    if (bestHeading === null) return false

    slot.bank = [bx, dry.supportY, bz]
    slot.mooring = [mx, baseWater, mz]
    slot.heading = bestHeading
    slot.parkedPos = [mx, baseWater, mz]
    slot.parkedHeading = bestHeading
    applyPier(slot)
    slot.mesh.position.set(mx, baseWater, mz)
    slot.mesh.rotation.set(0, bestHeading, 0, 'YXZ')
    slot.resolved = true
    return true
  }

  function applyPier(slot: MooringSlot) {
    if (!slot.bank || !slot.mooring) return
    const [bx,, bz] = slot.bank
    const [mx, wy, mz] = slot.mooring
    const dx = mx - bx, dz = mz - bz, len = Math.hypot(dx, dz)
    slot.pier.scale.set(1.2, 0.22, Math.max(1.2, len - 1.1))
    slot.pier.rotation.y = Math.atan2(dx, dz)
    slot.pier.position.set(bx + dx * 0.42, wy + 0.24, bz + dz * 0.42)
  }

  function resolveSlot(slot: MooringSlot) {
    const [dx,, dz] = slot.dockPos
    const nearTiles = new Set<string>()
    // Bank (<=22 m) + pier (<=10.5 m) + hull/ahead probe (~4.5 m) reaches ~37 m; guard ±40 m neighborhood.
    for (const ox of [-40, 0, 40]) {
      for (const oz of [-40, 0, 40]) {
        const t = sim.tileAt(dx + ox, dz + oz)
        if (t) {
          if (!stream.loaded.has(t)) return
          nearTiles.add(`${t.x},${t.z}`)
        }
      }
    }
    const key = [...nearTiles].sort().join(';')
    if (slot.resolveKey === key) return
    slot.resolveKey = key
    slot.resolveRuns++

    const prior = PRIOR_MOORINGS[slot.name]
    if (prior) {
      if (validateMooringPair(slot, prior.bank[0], prior.bank[1], prior.mooring[0], prior.mooring[1])) return
      if (isDrySupport(prior.bank[0], prior.bank[1])) {
        for (const rad of [4, 5.5, 7.5, 9.5]) {
          for (const ang of RING_ANGLES) {
            if (validateMooringPair(slot, prior.bank[0], prior.bank[1], prior.bank[0] + Math.cos(ang) * rad, prior.bank[1] + Math.sin(ang) * rad)) return
          }
        }
      }
    }

    // Deterministic spiral search fallback around dock in [10..20 m] ring.
    const bankCandidates: [number, number, number][] = []
    for (let ox = -20; ox <= 20; ox += 2) {
      for (let oz = -20; oz <= 20; oz += 2) {
        const d = Math.hypot(ox, oz)
        if (d >= 10 && d <= 20) bankCandidates.push([dx + ox, dz + oz, d])
      }
    }
    bankCandidates.sort((a, b) => a[2] - b[2])
    for (const [bx, bz] of bankCandidates) {
      if (!isDrySupport(bx, bz)) continue
      for (const rad of [4, 5.5, 7.5, 9.5]) {
        for (const ang of RING_ANGLES) {
          const mx = bx + Math.cos(ang) * rad, mz = bz + Math.sin(ang) * rad
          if (validateMooringPair(slot, bx, bz, mx, mz)) return
        }
      }
    }
  }

  function nearby(x: number, z: number, y?: number) {
    let bestSlot: MooringSlot | null = null, bestDist = Infinity, bestAtBank = false
    for (const slot of slots) {
      const [dx,, dz] = slot.dockPos
      const dockDist = Math.hypot(dx - x, dz - z)
      if (!slot.resolved && dockDist < 200) resolveSlot(slot)

      const drivingThis = activeSlot === slot
      if (!slot.resolved || !slot.bank || !slot.parkedPos) {
        slot.mesh.visible = drivingThis
        slot.pier.visible = false
        continue
      }
      const distMesh = Math.hypot(slot.mesh.position.x - x, slot.mesh.position.z - z)
      const distPier = Math.hypot(slot.bank[0] - x, slot.bank[2] - z)
      slot.mesh.visible = drivingThis || distMesh < 200
      slot.pier.visible = distPier < 200

      if (!activeSlot) {
        const dBank = Math.hypot(slot.bank[0] - x, slot.bank[2] - z)
        const dBoat = Math.hypot(slot.parkedPos[0] - x, slot.parkedPos[2] - z)
        const bankOk = dBank <= 5.5 && (y === undefined || (
          Math.abs(slot.bank[1] - y) <= 2.4 &&
          !sim.pathBlocked(x, z, slot.bank[0], slot.bank[2], Math.max(y, slot.bank[1]) + 0.85)
        ))
        const boatOk = dBoat <= 6.5 && (y === undefined || (
          Math.abs(slot.parkedPos[1] - y) <= 2.4 &&
          !sim.pathBlocked(x, z, slot.parkedPos[0], slot.parkedPos[2], Math.max(y, slot.parkedPos[1]) + 0.85)
        ))
        const triggerDist = bankOk ? dBank : boatOk ? dBoat : Infinity
        if (triggerDist < bestDist) {
          bestDist = triggerDist
          bestSlot = slot
          bestAtBank = bankOk
        }
      }
    }
    return {slot: bestSlot, distance: bestDist, atBank: bestAtBank}
  }

  function mount(slot: MooringSlot, atBank = false) {
    activeSlot = slot
    const moored = slot.mooring
    const pos = atBank && moored ? moored : (slot.parkedPos ?? moored ?? slot.mesh.position.toArray() as Position)
    boatX = pos[0]
    waterY = pos[1]
    boatZ = pos[2]
    heading = atBank && moored ? slot.heading : (slot.parkedPos ? slot.parkedHeading : slot.heading)
    slot.parkedPos = [boatX, waterY, boatZ]
    slot.parkedHeading = heading
    vx = vz = vLong = vLat = angVel = 0
    waveTime = strokePhase = 0
    clearState()
    slot.mesh.visible = true
    slot.mesh.position.set(boatX, waterY, boatZ)
    slot.mesh.rotation.set(0, heading, 0, 'YXZ')
    const res = evaluateHull(slot.spec, boatX, boatZ, heading, waterY, false)
    lastClearance = res.clearance
  }

  function steer(forward: number, right: number, dt: number) {
    const slot = activeSlot
    if (!slot) return
    const spec = slot.spec
    const inFwd = deadzone(THREE.MathUtils.clamp(forward, -1, 1), 0.10)
    const inRight = deadzone(THREE.MathUtils.clamp(right, -1, 1), 0.10)
    const clamped = Math.min(0.12, Math.max(0, dt))
    const steps = Math.max(1, Math.ceil(clamped / (1 / 60)))
    const sub = clamped / steps

    const startX = boatX, startZ = boatZ, startH = heading, startWaterY = waterY
    let anyBlocked = false
    let stepReason: BoatBlockReason = ''
    let stepAvailable = Infinity
    let targetWaterY = waterY
    let cachedFootprintClearance: number | null = null

    for (let s = 0; s < steps; s++) {
      waveTime += sub
      waterFlow(boatX, boatZ, flowTmp)
      const fwdX = -Math.sin(heading), fwdZ = -Math.cos(heading)
      const rightX = Math.cos(heading), rightZ = -Math.sin(heading)

      const relVx = vx - flowTmp.vx, relVz = vz - flowTmp.vz
      let longVel = relVx * fwdX + relVz * fwdZ
      let latVel = relVx * rightX + relVz * rightZ

      if (Math.abs(inFwd) > 0.05) {
        const accel = inFwd > 0 ? spec.aFwd : spec.aRev
        longVel = THREE.MathUtils.clamp(longVel + accel * inFwd * sub, -spec.vMaxRev, spec.vMaxFwd)
      }
      longVel *= Math.exp(-spec.kLong * sub)
      latVel *= Math.exp(-(grazingAxis !== '' ? spec.kLong : spec.kLat) * sub)
      if (Math.abs(inFwd) <= 0.05 && Math.abs(longVel) < 0.03 && flowTmp.vx === 0 && flowTmp.vz === 0) {
        longVel = 0
      }

      vx = fwdX * longVel + rightX * latVel + flowTmp.vx
      vz = fwdZ * longVel + rightZ * latVel + flowTmp.vz

      const turnScale = 0.7 + 0.3 * Math.min(1, Math.abs(longVel) / 1.5)
      const counterSteer = inRight * angVel > 0.01
      const yawDamp = Math.abs(inRight) <= 0.05 ? Math.max(spec.kYaw, 15.0) : counterSteer ? spec.kYaw * 2.5 : 3.0
      const yawBoost = counterSteer ? 1.8 : 1.0
      angVel = (angVel - inRight * spec.turnAccel * yawBoost * turnScale * sub) * Math.exp(-yawDamp * sub)
      if (Math.abs(inRight) <= 0.05 && Math.abs(angVel) < 0.005) angVel = 0
      angVel = THREE.MathUtils.clamp(angVel, -spec.turnMax, spec.turnMax)

      if (Math.abs(angVel * sub) > 1e-6) {
        const nextHeading = heading + angVel * sub
        const turnCheck = evaluateHull(spec, boatX, boatZ, nextHeading, waterY, false)
        if (turnCheck.ok) {
          heading = nextHeading
          targetWaterY = turnCheck.waterY
          cachedFootprintClearance = turnCheck.footprintClearance
        } else {
          let nudged = false
          const nudgeOffsets = [
            [-fwdX * 0.08, -fwdZ * 0.08],
            [-rightX * 0.08, -rightZ * 0.08],
            [rightX * 0.08, rightZ * 0.08],
            [fwdX * 0.08, fwdZ * 0.08],
            [-fwdX * 0.16, -fwdZ * 0.16],
          ] as const
          for (const [nx, nz] of nudgeOffsets) {
            const tryTurn = evaluateHull(spec, boatX + nx, boatZ + nz, nextHeading, waterY, false)
            if (tryTurn.ok) {
              boatX += nx; boatZ += nz; heading = nextHeading; targetWaterY = tryTurn.waterY; cachedFootprintClearance = tryTurn.footprintClearance; nudged = true
              break
            }
          }
          if (!nudged) {
            angVel = 0
            anyBlocked = true
            if (!stepReason) {
              stepReason = turnCheck.reason
              stepAvailable = turnCheck.available
            }
          }
        }
      }

      const postFwdX = -Math.sin(heading), postFwdZ = -Math.cos(heading)
      const wantVx = vx, wantVz = vz, wantSpeed = Math.hypot(wantVx, wantVz)
      const dx = wantVx * sub, dz = wantVz * sub, stepLen = Math.hypot(dx, dz)
      let blockedX = false, blockedZ = false, cornerSlid = false
      let blockedKindX: BoatBlockReason = '', blockedKindZ: BoatBlockReason = ''
      let cornerGlideHeading = heading

      if (stepLen > 1e-7) {
        const useAheadBoth = dx * postFwdX + dz * postFwdZ > 1e-6 && inFwd >= -0.05
        const evalBoth = evaluateHull(spec, boatX + dx, boatZ + dz, heading, waterY, useAheadBoth)
        if (evalBoth.ok) {
          boatX += dx
          boatZ += dz
          targetWaterY = evalBoth.waterY
          cachedFootprintClearance = evalBoth.footprintClearance
        } else {
          if (Math.abs(dx) > 1e-7) {
            const useAheadX = dx * postFwdX > 1e-6 && inFwd >= -0.05
            const evalX = evaluateHull(spec, boatX + dx, boatZ, heading, waterY, useAheadX)
            if (evalX.ok) {
              boatX += dx
              targetWaterY = evalX.waterY
              cachedFootprintClearance = evalX.footprintClearance
            } else {
              vx = 0
              blockedX = true
              blockedKindX = evalX.reason
              anyBlocked = true
              if (!stepReason || evalX.reason === 'bridge' || evalX.reason === 'lock') {
                stepReason = evalX.reason
                stepAvailable = evalX.available
              }
            }
          } else {
            blockedX = true
            blockedKindX = evalBoth.reason
          }

          if (Math.abs(dz) > 1e-7) {
            const useAheadZ = dz * postFwdZ > 1e-6 && inFwd >= -0.05
            const evalZ = evaluateHull(spec, boatX, boatZ + dz, heading, waterY, useAheadZ)
            if (evalZ.ok) {
              boatZ += dz
              targetWaterY = evalZ.waterY
              cachedFootprintClearance = evalZ.footprintClearance
            } else {
              vz = 0
              blockedZ = true
              blockedKindZ = evalZ.reason
              anyBlocked = true
              if (!stepReason || evalZ.reason === 'bridge' || evalZ.reason === 'lock') {
                stepReason = evalZ.reason
                stepAvailable = evalZ.available
              }
            }
          } else {
            blockedZ = true
            blockedKindZ = evalBoth.reason
          }

          const hardBlock =
            blockedKindX === 'bridge' || blockedKindX === 'lock' ||
            blockedKindZ === 'bridge' || blockedKindZ === 'lock'
          if (blockedX && blockedZ && !hardBlock && wantSpeed > 0.05) {
            const ux = dx / stepLen, uz = dz / stepLen
            const baseAngles = [Math.PI * 0.25, -Math.PI * 0.25, Math.PI * 0.38, -Math.PI * 0.38, Math.PI * 0.5, -Math.PI * 0.5]
            baseAngles.sort((a, b) => {
              const ax = ux * Math.cos(a) - uz * Math.sin(a), az = ux * Math.sin(a) + uz * Math.cos(a)
              const bx = ux * Math.cos(b) - uz * Math.sin(b), bz = ux * Math.sin(b) + uz * Math.cos(b)
              return (bx * postFwdX + bz * postFwdZ) - (ax * postFwdX + az * postFwdZ)
            })
            for (const angOff of baseAngles) {
              const c = Math.cos(angOff), sOff = Math.sin(angOff)
              const rx = ux * c - uz * sOff, rz = ux * sOff + uz * c
              const scale = Math.max(0.32, Math.cos(Math.min(Math.PI * 0.40, Math.abs(angOff))))
              const cx = rx * stepLen * scale, cz = rz * stepLen * scale
              const evalCorner = evaluateHull(spec, boatX + cx, boatZ + cz, heading, waterY, false)
              if (evalCorner.ok) {
                boatX += cx
                boatZ += cz
                targetWaterY = evalCorner.waterY
                cachedFootprintClearance = evalCorner.footprintClearance
                vx = cx / sub
                vz = cz / sub
                cornerSlid = true
                cornerGlideHeading = Math.atan2(-rx, -rz)
                break
              }
            }
          }
        }
      }

      const hardBlocked =
        blockedKindX === 'bridge' || blockedKindX === 'lock' ||
        blockedKindZ === 'bridge' || blockedKindZ === 'lock'
      grazingAxis = cornerSlid ? 'x' : (blockedX && !blockedZ ? 'x' : blockedZ && !blockedX ? 'z' : '')
      const grazeKind = blockedX ? blockedKindX : blockedKindZ
      if (
        !hardBlocked &&
        (blockedX !== blockedZ || cornerSlid) &&
        (grazeKind === 'shallow' || grazeKind === 'obstacle') &&
        (inFwd > 0.05 || wantSpeed > 0.06)
      ) {
        const glideHeading = cornerSlid
          ? cornerGlideHeading
          : blockedZ
            ? ((Math.abs(wantVx) > 0.03 ? wantVx : postFwdX) >= 0 ? -Math.PI / 2 : Math.PI / 2)
            : ((Math.abs(wantVz) > 0.03 ? wantVz : postFwdZ) >= 0 ? Math.PI : 0)
        const err = Math.atan2(Math.sin(glideHeading - heading), Math.cos(glideHeading - heading))
        const steerIntent = -inRight * Math.sign(err || 1)
        if (Math.abs(err) > 0.04 && steerIntent >= -0.60) {
          if (angVel * err < 0) angVel *= 0.35
          const deflected = heading + Math.sign(err) * Math.min(Math.abs(err), 3.2 * sub)
          const offX = blockedX && Math.abs(dx) > 1e-7 ? -Math.sign(dx) * 0.08 : 0
          const offZ = blockedZ && Math.abs(dz) > 1e-7 ? -Math.sign(dz) * 0.08 : 0
          const defEval = evaluateHull(spec, boatX, boatZ, deflected, waterY, false)
          if (defEval.ok) {
            heading = deflected
            cachedFootprintClearance = defEval.footprintClearance
          } else if (offX !== 0 || offZ !== 0) {
            const offEval = evaluateHull(spec, boatX + offX, boatZ + offZ, deflected, waterY, false)
            if (offEval.ok) {
              boatX += offX
              boatZ += offZ
              heading = deflected
              cachedFootprintClearance = offEval.footprintClearance
            }
          }
        }
      }

      waterY = THREE.MathUtils.damp(waterY, targetWaterY, 10, sub)
    }

    waterFlow(boatX, boatZ, flowTmp)
    const finalFwdX = -Math.sin(heading), finalFwdZ = -Math.cos(heading)
    const finalRightX = Math.cos(heading), finalRightZ = -Math.sin(heading)
    vLong = (vx - flowTmp.vx) * finalFwdX + (vz - flowTmp.vz) * finalFwdZ
    vLat = (vx - flowTmp.vx) * finalRightX + (vz - flowTmp.vz) * finalRightZ

    const unmoved = boatX === startX && boatZ === startZ && heading === startH && Math.abs(waterY - startWaterY) < 1e-4
    if (!unmoved) {
      if (cachedFootprintClearance !== null && Math.abs(waterY - targetWaterY) < 0.02) {
        lastClearance = cachedFootprintClearance
      } else {
        lastClearance = measureClearancePoints(spec, boatX, boatZ, heading, waterY, false).footprintClearance
      }
    }
    lastBlocked = anyBlocked
    lastBlockReason = stepReason
    if (anyBlocked && (stepReason === 'bridge' || stepReason === 'lock')) {
      notifyBlock(spec, stepReason, stepAvailable)
    }

    // Subtle render-only wave motion; compensate tilt edge rise so maxY never overshoots bounds.
    roll = THREE.MathUtils.damp(roll, THREE.MathUtils.clamp(inRight * 0.016 + 0.006 * Math.sin(waveTime * 1.7), -0.02, 0.02), 6, clamped)
    pitch = THREE.MathUtils.damp(pitch, THREE.MathUtils.clamp(-inFwd * 0.012, -0.015, 0.015), 6, clamped)
    const tiltRise = Math.abs(Math.sin(roll)) * (spec.width * 0.5) + Math.abs(Math.sin(pitch)) * (spec.length * 0.5)
    bobY = -tiltRise - 0.008 * (1 - Math.sin(waveTime * 2.1))
    slot.mesh.position.set(boatX, waterY + bobY, boatZ)
    slot.mesh.rotation.set(pitch, heading, roll, 'YXZ')
  }

  function pose(figure: THREE.Group, forward: number, right: number, dt: number) {
    const slot = activeSlot
    if (!slot) return
    const inFwd = deadzone(THREE.MathUtils.clamp(forward, -1, 1), 0.10)
    const inRight = deadzone(THREE.MathUtils.clamp(right, -1, 1), 0.10)
    const effort = Math.min(1, Math.hypot(inFwd, inRight))

    if (slot.kind === 'rowboat') {
      if (effort > 0.05) strokePhase += Math.min(0.12, dt) * 4.4
      const leftDrive = THREE.MathUtils.clamp(inFwd + inRight * 0.8, -1, 1)
      const rightDrive = THREE.MathUtils.clamp(inFwd - inRight * 0.8, -1, 1)
      const swing = Math.sin(strokePhase), bend = Math.cos(strokePhase)
      for (const side of ['L', 'R'] as const) {
        const drive = side === 'L' ? leftDrive : rightDrive
        const thigh = figure.getObjectByName('Thigh' + side)
        const shin = figure.getObjectByName('Shin' + side)
        const arm = figure.getObjectByName('Arm' + side)
        const forearm = figure.getObjectByName('Forearm' + side)
        if (thigh) thigh.rotation.x = 1.45
        if (shin) shin.rotation.x = -0.35
        if (arm) arm.rotation.x = 0.72 + swing * 0.38 * drive
        if (forearm) forearm.rotation.x = 0.35 + bend * 0.22 * Math.abs(drive)
      }
      const torso = figure.getObjectByName('Torso')
      if (torso) torso.rotation.x = 0.06 + Math.max(0, swing) * 0.08 * effort
    } else {
      for (const side of ['L', 'R'] as const) {
        const thigh = figure.getObjectByName('Thigh' + side)
        const shin = figure.getObjectByName('Shin' + side)
        const arm = figure.getObjectByName('Arm' + side)
        const forearm = figure.getObjectByName('Forearm' + side)
        if (thigh) thigh.rotation.x = 1.25
        if (shin) shin.rotation.x = -1.40
        if (arm) arm.rotation.x = 0.90
        if (forearm) forearm.rotation.x = 0.35
      }
      const torso = figure.getObjectByName('Torso')
      if (torso) torso.rotation.x = 0
    }
  }

  function clearPoseJoints(figure: THREE.Group) {
    for (const name of JOINT_RESET_NAMES) {
      const joint = figure.getObjectByName(name)
      if (joint) joint.rotation.set(0, 0, 0)
    }
  }

  function clearance(figure: THREE.Group, skinned?: THREE.SkinnedMesh) {
    const slot = activeSlot
    if (!slot) return null
    figure.updateMatrixWorld(true)
    skinned?.skeleton.update()
    slot.mesh.updateMatrixWorld(true)
    const roof = boxMeasure.setFromObject(slot.mesh, true).max.y
    const head = figMeasure.setFromObject(figure, true).max.y

    const hw = slot.spec.width * 0.5, hl = slot.spec.length * 0.5
    const fwdX = -Math.sin(heading), fwdZ = -Math.cos(heading)
    const rightX = Math.cos(heading), rightZ = -Math.sin(heading)
    let underside = Infinity
    for (const along of [-hl, 0, hl]) {
      for (const across of [-hw, 0, hw]) {
        const wx = boatX + rightX * across + fwdX * along
        const wz = boatZ + rightZ * across + fwdZ * along
        const localWater = waterAt(wx, wz) ?? waterY
        const bottom = sim.waterCeiling(wx, wz, Math.max(waterY, localWater))
        if (bottom < underside) underside = bottom
      }
    }
    return {
      kind: slot.kind,
      head,
      roof,
      underside,
      clearance: underside - Math.max(head, roof),
    }
  }

  function dismount(
    allDocks: Record<string, Position>,
    commitLand?: (spot: {x: number; y: number; z: number; rule: string; heading: number}) => boolean,
  ) {
    const slot = activeSlot
    if (!slot) return null
    // Arrest fast boat motion immediately and sync nearby colliders before probing local banks.
    vx = vz = vLong = vLat = angVel = 0
    sim.sync(boatX, boatZ)

    const candidates: [number, number][] = []
    for (const other of slots) {
      if (!other.bank) continue
      const d = Math.hypot(other.bank[0] - boatX, other.bank[2] - boatZ)
      if (d >= 0.4 && d <= 10.0) candidates.push([other.bank[0], other.bank[2]])
    }
    for (const dock of Object.values(allDocks)) {
      const d = Math.hypot(dock[0] - boatX, dock[2] - boatZ)
      if (d >= 0.4 && d <= 10.0) candidates.push([dock[0], dock[2]])
    }
    for (const radius of DISMOUNT_RADII) {
      for (const offset of SECTOR_OFFSETS) {
        const ang = heading + offset
        candidates.push([boatX - Math.sin(ang) * radius, boatZ - Math.cos(ang) * radius])
      }
      for (const ang of RING_ANGLES) {
        candidates.push([boatX + Math.cos(ang) * radius, boatZ + Math.sin(ang) * radius])
      }
    }

    for (const [cx, cz] of candidates) {
      const dry = isDrySupport(cx, cz, waterY)
      if (!dry) continue
      if (sim.pathBlocked(boatX, boatZ, cx, cz, Math.max(waterY, dry.supportY) + 0.8)) continue

      const outHeading = Math.atan2(-(cx - boatX), -(cz - boatZ))
      const target = {
        x: dry.x,
        y: dry.y,
        z: dry.z,
        rule: 'boat-shore',
        heading: Number.isFinite(outHeading) ? outHeading : heading,
      }
      activeSlot = null
      if (commitLand && !commitLand(target)) {
        activeSlot = slot
        continue
      }

      // Confirmed valid shore placement: now park boat either back at nearby mooring (<12 m) or in place.
      const m = slot.mooring
      if (m && Math.hypot(boatX - m[0], boatZ - m[2]) < 12.0) {
        slot.parkedPos = [m[0], m[1], m[2]]
        slot.parkedHeading = slot.heading
      } else {
        slot.parkedPos = [boatX, waterY, boatZ]
        slot.parkedHeading = heading
      }
      slot.mesh.position.set(slot.parkedPos[0], slot.parkedPos[1], slot.parkedPos[2])
      slot.mesh.rotation.set(0, slot.parkedHeading, 0, 'YXZ')
      clearState()
      return target
    }

    lastBlocked = true
    lastBlockReason = 'offshore'
    emitToast('offshore', '离岸太远，请将船划近岸边或码头后再下船')
    return null
  }

  function reset() {
    if (activeSlot) {
      const resetPos = activeSlot.mooring
      if (resetPos) {
        activeSlot.parkedPos = [resetPos[0], resetPos[1], resetPos[2]]
        activeSlot.parkedHeading = activeSlot.heading
        activeSlot.mesh.position.set(resetPos[0], resetPos[1], resetPos[2])
        activeSlot.mesh.rotation.set(0, activeSlot.heading, 0, 'YXZ')
      }
    }
    activeSlot = null
    vx = vz = vLong = vLat = angVel = waveTime = strokePhase = 0
    lastClearance = Infinity
    clearState()
  }

  function probe(): BoatProbe | null {
    if (!activeSlot) return null
    return {
      kind: activeSlot.kind,
      x: boatX,
      y: waterY,
      waterY,
      z: boatZ,
      heading,
      speed: Math.hypot(vx, vz),
      vLong,
      vLat,
      vx,
      vz,
      blocked: lastBlocked,
      reason: lastBlockReason,
      blockReason: lastBlockReason,
      clearance: lastClearance,
      toast: lastToastText,
    }
  }

  return {
    get active() { return activeSlot },
    get boat() { return activeSlot?.mesh ?? null },
    get boatKind() { return activeSlot?.kind ?? null },
    get heading() { return heading },
    get speed() { return Math.hypot(vx, vz) },
    get seatOffset() { return activeSlot?.spec.seatOffset ?? -0.44 },
    nearby,
    mount,
    steer,
    pose,
    clearPoseJoints,
    clearance,
    dismount,
    probe,
    stop() { vx = vz = vLong = vLat = angVel = 0 },
    reset,
    moorings() {
      return slots.map(s => ({
        name: s.name,
        kind: s.kind,
        resolved: s.resolved,
        resolveRuns: s.resolveRuns,
        dock: s.dockPos,
        bank: s.bank,
        mooring: s.mooring,
        heading: s.heading,
      }))
    },
  }
}
