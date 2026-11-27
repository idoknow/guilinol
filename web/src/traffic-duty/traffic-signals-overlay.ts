import * as THREE from 'three'
import {mainDetail} from '../look/mirror-layer'
import {getActiveDutyTraffic} from '../traffic/duty-traffic.ts'
import {getLatestTraffic, type Traffic} from '../traffic/sim.ts'
import {SIGNAL_DRIVER_RANK, SIGNAL_LENS_HEX, SignalPlan, citySignalClock, citySignals, type SignalColor, type SignalState} from '../traffic/signals.ts'

/**
 * Pure-frontend dynamic traffic-signal lens overlay for Shizijie's 4 cantilevered gantries
 * (`web/src/traffic-duty/traffic-signals-overlay.ts`).
 *
 * Design invariants:
 *  - Zero landmark rebaking (`public/landmarks/shizijie.glb` untouched)
 *  - Zero dynamic `PointLight` / `SpotLight` (uses unlit `MeshBasicMaterial` LED discs only)
 *  - Opaque dark housing shroud (`#16191d`) cleanly masks the static baked lenses on both faces
 *  - Driven directly by live `sim.getSignalPhase()` on signal group `626322720`; before a traffic cell
 *    streams in it reads the same programme from `traffic/signals.ts` on the one `citySignalClock`
 *  - Updates `.color.setHex()` only on actual phase transitions + distance-culled to `<= 220 m`
 */

export type {SignalColor}
export type SignalAxis = 'ew' | 'ns'

export const SHIZIJIE_ORIGIN = Object.freeze({
  x: -879.7502,
  y: 151.3,
  z: -169.626,
})

export const SHIZIJIE_SIGNAL_NODE_ID = 626322720
export const SHIZIJIE_SIGNAL_OFFSET_SEC = 22
export const SHIZIJIE_SIGNAL_GREEN_SEC = 18
export const SHIZIJIE_SIGNAL_YELLOW_SEC = 3
export const SHIZIJIE_SIGNAL_CYCLE_SEC = (SHIZIJIE_SIGNAL_GREEN_SEC + SHIZIJIE_SIGNAL_YELLOW_SEC) * 2
/**
 * Phase order of the Shizijie programme in the world data: 解放路 (east–west) first, 中山路 (north–south) second.
 * Lights are resolved by phase, never by lane id — lane ids are renumbered whenever the road network is rebuilt.
 */
export const SHIZIJIE_AXIS_PHASE = Object.freeze({ew: 0, ns: 1} as const)

export interface ShizijieGantrySpec {
  readonly id: string
  readonly corner: 'NE' | 'SW' | 'NW' | 'SE'
  readonly lx: number
  readonly lz: number
  readonly wx: number
  readonly wz: number
  readonly yaw: number
  readonly span: number
  readonly axis: SignalAxis
  readonly signalNodeId: number
}

function makeGantry(
  id: string,
  corner: ShizijieGantrySpec['corner'],
  lx: number,
  lz: number,
  yaw: number,
  span: number,
  axis: SignalAxis,
): ShizijieGantrySpec {
  return Object.freeze({
    id,
    corner,
    lx,
    lz,
    wx: +(SHIZIJIE_ORIGIN.x + lx).toFixed(4),
    wz: +(SHIZIJIE_ORIGIN.z + lz).toFixed(4),
    yaw,
    span,
    axis,
    signalNodeId: SHIZIJIE_SIGNAL_NODE_ID,
  })
}

export const SHIZIJIE_GANTRIES: readonly ShizijieGantrySpec[] = Object.freeze([
  makeGantry('szj_gantry_ne', 'NE', 26.5, -27.5, Math.atan2(-10.0, 32.0) + Math.PI, 8.8, 'ns'),
  makeGantry('szj_gantry_sw', 'SW', -29.5, 24.0, Math.atan2(-10.0, 32.0), 8.8, 'ns'),
  makeGantry('szj_gantry_nw', 'NW', -32.5, -23.5, Math.atan2(-38.0, -7.8), 8.2, 'ew'),
  makeGantry('szj_gantry_se', 'SE', 33.5, 28.0, Math.atan2(36.0, 8.2), 8.2, 'ew'),
])

const HEAD_RATIOS = [0.74, 0.92] as const
const HOUSING_CENTER_Y = 6.125
const LENS_Y = {
  red: 6.43,
  yellow: 6.07,
  green: 5.69,
} as const

const LENS_HEX = SIGNAL_LENS_HEX

/** Programme used until a road cell carrying the Shizijie signal has loaded; mirrors `graph.json.gz`. */
const SHIZIJIE_FALLBACK_PLAN = new SignalPlan([{
  node: SHIZIJIE_SIGNAL_NODE_ID,
  group: SHIZIJIE_SIGNAL_NODE_ID,
  offset: SHIZIJIE_SIGNAL_OFFSET_SEC,
  phases: [
    {lanes: [], green: SHIZIJIE_SIGNAL_GREEN_SEC, yellow: SHIZIJIE_SIGNAL_YELLOW_SEC},
    {lanes: [], green: SHIZIJIE_SIGNAL_GREEN_SEC, yellow: SHIZIJIE_SIGNAL_YELLOW_SEC},
  ],
}])

export interface ShizijiePhaseSnapshot {
  ew: SignalColor
  ns: SignalColor
  source: 'sim' | 'fallback'
}

const phaseScratch: SignalState = {phase: 0, color: 'green', remaining: 0, cycle: 0}

function axisColors(state: SignalState | null, source: ShizijiePhaseSnapshot['source']): ShizijiePhaseSnapshot {
  return {
    ew: state?.phase === SHIZIJIE_AXIS_PHASE.ew ? state.color : 'red',
    ns: state?.phase === SHIZIJIE_AXIS_PHASE.ns ? state.color : 'red',
    source,
  }
}

/**
 * Resolves live EW/NS signal colors for Shizijie (`node=626322720`).
 * Reads the sim's programme when Shizijie's traffic cell is active, otherwise the city plan
 * (or, before any road cell has loaded, the same fixed-time cycle: `offset=22s, 18g+3y / 18g+3y`).
 */
export function resolveShizijieSignalPhase(sim?: Traffic, fallbackTimeSec = 0): ShizijiePhaseSnapshot {
  if (sim?.hasSignal(SHIZIJIE_SIGNAL_NODE_ID)) {
    return axisColors(sim.getSignalState(SHIZIJIE_SIGNAL_NODE_ID, undefined, phaseScratch), 'sim')
  }
  const plan = citySignals.has(SHIZIJIE_SIGNAL_NODE_ID) ? citySignals : SHIZIJIE_FALLBACK_PLAN
  return axisColors(plan.state(SHIZIJIE_SIGNAL_NODE_ID, fallbackTimeSec, phaseScratch), 'fallback')
}

export interface ShizijieSignalsOverlayOptions {
  getTraffic?: () => Traffic | undefined
  groundAt?: (x: number, z: number, reference?: number, car?: boolean) => number | undefined
  maxDistanceM?: number
}

export interface ShizijieSignalsOverlayHandle {
  readonly group: THREE.Group
  readonly gantryGroups: readonly THREE.Group[]
  update(cameraPos: {x: number; z: number}, dt?: number): {ew: SignalColor; ns: SignalColor; visible: boolean}
  getPhaseSnapshot(): ShizijiePhaseSnapshot
  setEnabled(enabled: boolean): void
  isIndependentClockActive(): boolean
  dispose(): void
}

export function mountShizijieSignalsOverlay(
  scene: THREE.Scene,
  opts?: ShizijieSignalsOverlayOptions,
): ShizijieSignalsOverlayHandle {
  const maxDistSq = Math.max(40, opts?.maxDistanceM ?? 220) ** 2

  const group = new THREE.Group()
  group.name = 'shizijie_signals_overlay'

  // Shared geometries & materials: 7 MeshBasicMaterial total, 0 PointLights.
  const frontShroudGeom = new THREE.BoxGeometry(0.56, 1.4, 0.19)
  const rearMaskGeom = new THREE.BoxGeometry(0.56, 1.4, 0.03)
  const lensGeom = new THREE.CircleGeometry(0.145, 14)

  const maskMat = new THREE.MeshBasicMaterial({color: 0x16191d})
  const axisMats: Record<SignalAxis, Record<SignalColor, THREE.MeshBasicMaterial>> = {
    ew: {
      red: new THREE.MeshBasicMaterial({color: LENS_HEX.red.off}),
      yellow: new THREE.MeshBasicMaterial({color: LENS_HEX.yellow.off}),
      green: new THREE.MeshBasicMaterial({color: LENS_HEX.green.off}),
    },
    ns: {
      red: new THREE.MeshBasicMaterial({color: LENS_HEX.red.off}),
      yellow: new THREE.MeshBasicMaterial({color: LENS_HEX.yellow.off}),
      green: new THREE.MeshBasicMaterial({color: LENS_HEX.green.off}),
    },
  }

  const gantryGroups: THREE.Group[] = []
  for (const spec of SHIZIJIE_GANTRIES) {
    const gRoot = new THREE.Group()
    gRoot.name = spec.id
    const initY = opts?.groundAt?.(spec.wx, spec.wz, SHIZIJIE_ORIGIN.y, false) ?? SHIZIJIE_ORIGIN.y
    gRoot.position.set(spec.wx, initY, spec.wz)
    gRoot.rotation.set(0, spec.yaw, 0)

    const mats = axisMats[spec.axis]
    for (const ratio of HEAD_RATIOS) {
      const lx = spec.span * ratio

      // Front housing shroud covers static baked cylinder_y lenses (z <= 0.48) with zero bleed-through
      const frontShroud = new THREE.Mesh(frontShroudGeom, maskMat)
      frontShroud.position.set(lx, HOUSING_CENTER_Y, 0.415)
      gRoot.add(frontShroud)

      // Rear opaque backing mask covers rear face of housing (z = -0.01)
      const rearMask = new THREE.Mesh(rearMaskGeom, maskMat)
      rearMask.position.set(lx, HOUSING_CENTER_Y, -0.025)
      gRoot.add(rearMask)

      for (const color of ['red', 'yellow', 'green'] as const) {
        const y = LENS_Y[color]
        const frontDisc = new THREE.Mesh(lensGeom, mats[color])
        frontDisc.position.set(lx, y, 0.522)
        gRoot.add(frontDisc)

        const rearDisc = new THREE.Mesh(lensGeom, mats[color])
        rearDisc.position.set(lx, y, -0.048)
        rearDisc.rotation.y = Math.PI
        gRoot.add(rearDisc)
      }
    }

    group.add(gRoot)
    gantryGroups.push(gRoot)
  }

  scene.add(group)
  mainDetail(group)

  let lastEw: SignalColor | null = null
  let lastNs: SignalColor | null = null
  let lastSnapshot: ShizijiePhaseSnapshot = {ew: 'red', ns: 'red', source: 'fallback'}
  const signalDriver = citySignalClock.driver(SIGNAL_DRIVER_RANK.visual)
  let groundTimer = 0
  let enabled = true
  let disposed = false

  function resolveSim(): Traffic | undefined {
    return opts?.getTraffic?.() ?? getActiveDutyTraffic() ?? getLatestTraffic()
  }

  function applyAxisColor(axis: SignalAxis, activeColor: SignalColor): void {
    const mats = axisMats[axis]
    mats.red.color.setHex(activeColor === 'red' ? LENS_HEX.red.lit : LENS_HEX.red.off)
    mats.yellow.color.setHex(activeColor === 'yellow' ? LENS_HEX.yellow.lit : LENS_HEX.yellow.off)
    mats.green.color.setHex(activeColor === 'green' ? LENS_HEX.green.lit : LENS_HEX.green.off)
  }

  function syncColors(snap: ShizijiePhaseSnapshot): void {
    lastSnapshot = snap
    if (snap.ew !== lastEw) {
      lastEw = snap.ew
      applyAxisColor('ew', snap.ew)
    }
    if (snap.ns !== lastNs) {
      lastNs = snap.ns
      applyAxisColor('ns', snap.ns)
    }
  }

  syncColors(resolveShizijieSignalPhase(resolveSim(), citySignalClock.now))

  return {
    group,
    gantryGroups,
    update(cameraPos: {x: number; z: number}, dt = 0) {
      if (disposed || !enabled) {
        if (group.visible) group.visible = false
        return {ew: lastSnapshot.ew, ns: lastSnapshot.ns, visible: false}
      }
      const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(0.25, dt) : 0
      // Keeps the city clock running while no sim is stepping; yields as soon as one does.
      signalDriver.advance(safeDt)

      const dx = cameraPos.x - SHIZIJIE_ORIGIN.x
      const dz = cameraPos.z - SHIZIJIE_ORIGIN.z
      const visible = dx * dx + dz * dz <= maxDistSq
      if (group.visible !== visible) group.visible = visible

      const sim = resolveSim()
      const snap = resolveShizijieSignalPhase(sim, citySignalClock.now)
      if (visible) {
        syncColors(snap)
        groundTimer -= safeDt
        if (opts?.groundAt && groundTimer <= 0) {
          groundTimer = 1.0
          for (let i = 0; i < SHIZIJIE_GANTRIES.length; i++) {
            const spec = SHIZIJIE_GANTRIES[i]
            const gy = opts.groundAt(spec.wx, spec.wz, SHIZIJIE_ORIGIN.y, false)
            if (gy !== undefined && Number.isFinite(gy)) gantryGroups[i].position.y = gy
          }
        }
      } else {
        lastSnapshot = snap
      }
      return {ew: snap.ew, ns: snap.ns, visible}
    },
    getPhaseSnapshot() {
      return {...lastSnapshot}
    },
    setEnabled(next: boolean) {
      enabled = Boolean(next)
      if (!enabled) group.visible = false
    },
    isIndependentClockActive() {
      return lastSnapshot.source === 'fallback'
    },
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      frontShroudGeom.dispose()
      rearMaskGeom.dispose()
      lensGeom.dispose()
      maskMat.dispose()
      for (const axis of ['ew', 'ns'] as const) {
        axisMats[axis].red.dispose()
        axisMats[axis].yellow.dispose()
        axisMats[axis].green.dispose()
      }
    },
  }
}
