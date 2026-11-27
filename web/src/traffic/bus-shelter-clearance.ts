// IDOK-399 stage 5c — keep shared e-bikes clear of bus shelters.
//
// No three.js, no DOM (only guards around fetch/setTimeout/location for browser loading).
import {
  BUS_STOPS_URL, INDEX_CELL, LOAD_ATTEMPTS, LOAD_RETRY, SHELTER_BACK, SHELTER_FRONT,
  SHELTER_LENGTH, SHELTER_OFFSET, parseBusStops, type BusStop,
} from './bus-stop-layout'

/** Margin around the shelter plan outline (roof without overhang): an e-bike is ~1.8 m long parked at ~0.75 rad. */
export const EBIKE_SHELTER_MARGIN = .9

/** Centre spacing of the three e-bikes in one roadside decor item (street-worker.ts, decor kind 3). */
export const EBIKE_GROUP_SPACING = 1.25

const ROW_YAW_TOLERANCE = 1e-3
const ROW_SPACING_TOLERANCE = .02

/** Oriented rectangle in world x, z: centre, unit t/n axes, and half extents (margin included). */
export type ShelterZone = {
  key: string
  x: number
  z: number
  tx: number
  tz: number
  nx: number
  nz: number
  halfAlong: number
  halfOut: number
}

/** Clearance rectangle around a stop's shelter in world x, z. */
export function shelterZone(stop: BusStop, margin = EBIKE_SHELTER_MARGIN): ShelterZone {
  const along = stop.side * SHELTER_OFFSET, out = (SHELTER_BACK + SHELTER_FRONT) / 2
  return {
    key: stop.key,
    x: stop.x + along * stop.tx + out * stop.nx,
    z: stop.z + along * stop.tz + out * stop.nz,
    tx: stop.tx, tz: stop.tz, nx: stop.nx, nz: stop.nz,
    halfAlong: SHELTER_LENGTH / 2 + margin,
    halfOut: (SHELTER_FRONT - SHELTER_BACK) / 2 + margin,
  }
}

/** Closed-interval containment test in the zone's local t/n frame. */
export function zoneContains(zone: ShelterZone, x: number, z: number): boolean {
  const dx = x - zone.x, dz = z - zone.z
  return Math.abs(dx * zone.tx + dz * zone.tz) <= zone.halfAlong && Math.abs(dx * zone.nx + dz * zone.nz) <= zone.halfOut
}

/** Shelter-only clearance index on a 64 m grid; lookups allocate nothing. */
export class ShelterClearance {
  readonly zones: readonly ShelterZone[]
  private bins = new Map<number, ShelterZone[]>()
  constructor(stops: readonly BusStop[], margin = EBIKE_SHELTER_MARGIN, readonly cell = INDEX_CELL) {
    const zones: ShelterZone[] = []
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i]
      if (!stop.shelter) continue
      const zone = shelterZone(stop, margin)
      zones.push(zone)
      if (zone.halfAlong < 0 || zone.halfOut < 0) continue
      const ex = Math.abs(zone.tx) * zone.halfAlong + Math.abs(zone.nx) * zone.halfOut + 1e-6
      const ez = Math.abs(zone.tz) * zone.halfAlong + Math.abs(zone.nz) * zone.halfOut + 1e-6
      const c0 = Math.floor((zone.x - ex) / cell), c1 = Math.floor((zone.x + ex) / cell)
      const r0 = Math.floor((zone.z - ez) / cell), r1 = Math.floor((zone.z + ez) / cell)
      for (let col = c0; col <= c1; col++) for (let row = r0; row <= r1; row++) {
        const key = this.keyOf(col, row), bin = this.bins.get(key)
        if (bin) bin.push(zone)
        else this.bins.set(key, [zone])
      }
    }
    this.zones = zones
  }
  private keyOf(col: number, row: number) { return (col + 32768) * 65536 + row + 32768 }
  blocks(x: number, z: number): boolean { return this.zoneAt(x, z) !== null }
  /** First zone containing `(x, z)` (same one `blocks` matches), or `null`. */
  zoneAt(x: number, z: number): ShelterZone | null {
    const bin = this.bins.get(this.keyOf(Math.floor(x / this.cell), Math.floor(z / this.cell)))
    if (!bin) return null
    for (let i = 0; i < bin.length; i++) {
      const zone = bin[i]
      if (zoneContains(zone, x, z)) return zone
    }
    return null
  }
}

/**
 * Whether parked bike `index` (16 floats each in a tile's `parked` array, world x/z at [12]/[14]) is cleared:
 * it, or a row mate, stands in a shelter zone. Row mates: the bikes at index±1 and index±2, walking outwards
 * and stopping at the first that is not one — same yaw (|Δm8|,|Δm10| ≤ 1e-3) and centre k·1.25 m away (±0.02 m),
 * k = 1, 2. Never more than two either way, so at most a run of five is looked at. No allocation.
 */
export function clearsParkedBike(clearance: ShelterClearance, parked: ArrayLike<number>, index: number): boolean {
  const count = Math.floor(parked.length / 16)
  if (!Number.isInteger(index) || index < 0 || index >= count) return false
  const base = index * 16
  const x = parked[base + 12], z = parked[base + 14]
  if (clearance.blocks(x, z)) return true
  const m8 = parked[base + 8], m10 = parked[base + 10]
  for (let dir = -1; dir <= 1; dir += 2) {
    for (let k = 1; k <= 2; k++) {
      const j = index + dir * k
      if (j < 0 || j >= count) break
      const off = j * 16
      if (!(Math.abs(parked[off + 8] - m8) <= ROW_YAW_TOLERANCE) || !(Math.abs(parked[off + 10] - m10) <= ROW_YAW_TOLERANCE)) break
      const nx = parked[off + 12], nz = parked[off + 14]
      if (!(Math.abs(Math.hypot(nx - x, nz - z) - k * EBIKE_GROUP_SPACING) <= ROW_SPACING_TOLERANCE)) break
      if (clearance.blocks(nx, nz)) return true
    }
  }
  return false
}

// ——— global registry (used by batch.ts) ———

export type ClearanceState = 'idle' | 'loading' | 'ready' | 'failed'

let clearance: ShelterClearance | null = null
let state: ClearanceState = 'idle'
let attempts = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
let generation = 0
const listeners = new Set<() => void>()

function cancelRetry() {
  if (retryTimer !== null) {
    if (typeof clearTimeout === 'function') clearTimeout(retryTimer)
    retryTimer = null
  }
}

async function loadAttempt(gen: number) {
  if (gen !== generation) return
  attempts++
  let parsed: {stops: BusStop[], excluded: string[]} | null = null
  try {
    // A request that hangs counts as failed after 15 s (matching bus-stops.ts), so the retries still run.
    const init = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? {signal: AbortSignal.timeout(15_000)}
      : undefined
    const response = await fetch(BUS_STOPS_URL, init)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    parsed = parseBusStops(await response.json())
    if (!parsed) throw new Error('invalid bus stops payload')
  } catch (error) {
    if (gen !== generation) return
    if (attempts < LOAD_ATTEMPTS && typeof setTimeout === 'function') {
      retryTimer = setTimeout(() => {
        retryTimer = null
        void loadAttempt(gen)
      }, LOAD_RETRY * 1000)
      return
    }
    state = 'failed'
    console.warn(`[bus-shelter-clearance] failed to load ${BUS_STOPS_URL} after ${attempts} attempts:`, error)
    return
  }
  if (gen !== generation) return
  setBusShelterClearance(parsed)
}

function startLoad() {
  if (state !== 'idle') return
  if (typeof fetch !== 'function' || typeof location === 'undefined') return
  state = 'loading'
  attempts = 0
  void loadAttempt(generation)
}

/** Sets clearance data from a parsed payload, or clears back to `idle` on `null`; notifies all listeners. */
export function setBusShelterClearance(parsed: {stops: BusStop[], excluded: string[]} | null): void {
  cancelRetry()
  generation++
  if (!parsed) {
    clearance = null
    state = 'idle'
    attempts = 0
  } else {
    clearance = new ShelterClearance(parsed.stops)
    state = 'ready'
  }
  for (const listener of [...listeners]) listener()
}

/** Whether an e-bike centred at `(x, z)` falls inside any bus shelter zone; starts browser loading on first call. */
export function busShelterBlocksBike(x: number, z: number): boolean {
  if (clearance) return clearance.blocks(x, z)
  if (state === 'idle') startLoad()
  return false
}

/** Registry form for batch.ts: false until the data is in (starts loading on first call, like busShelterBlocksBike). */
export function busShelterClearsParked(parked: ArrayLike<number>, index: number): boolean {
  if (clearance) return clearsParkedBike(clearance, parked, index)
  if (state === 'idle') startLoad()
  return false
}

/** Registers a listener invoked when clearance data arrives or is set; returns an unsubscribe function. */
export function onBusShelterClearance(callback: () => void): () => void {
  listeners.add(callback)
  return () => { listeners.delete(callback) }
}

export function busShelterClearanceState(): {state: ClearanceState, zones: number, attempts: number} {
  return {state, zones: clearance ? clearance.zones.length : 0, attempts}
}
