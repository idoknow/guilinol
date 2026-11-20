import * as T from 'three'
import type {EbikeModConfig, EbikeModPreset, EbikeVisualRig} from './vehicle-model'

export type EbikeCrashPhase = 'none' | 'crashed' | 'recovering'
export type EbikeCrashReason = '' | 'impact' | 'lowside' | 'loopout'

export interface EbikeGearSpec {
  id: number
  label: string
  hint: string
  targetKmh: number
  wheelieEase: number
}

export const EBIKE_GEARS: readonly EbikeGearSpec[] = [
  {id: 1, label: 'D1', hint: '缓行', targetKmh: 18, wheelieEase: .45},
  {id: 2, label: 'D2', hint: '均衡', targetKmh: 25, wheelieEase: .75},
  {id: 3, label: 'D3', hint: '畅行', targetKmh: 38, wheelieEase: 1.05},
  {id: 4, label: 'S', hint: '鬼火', targetKmh: 52, wheelieEase: 1.35},
]

export interface EbikeRideControlInput {
  gearDelta: number
  gearSelect: number | null
  wheelie: boolean
  tuck: boolean
  recover: boolean
  cycleMod: boolean
}

/**
 * Shared telemetry contract between dynamics (Hy2: ride.ts) and visual/HUD layer (Hy3: ebike-fx.ts / walk.ts).
 * When Hy2 exposes these fields on `rides`, the visual controller consumes them directly; otherwise it falls
 * back to lightweight presentation-side estimation so riders still get live lean, wheelie, gear & crash FX.
 */
export interface ExternalEbikeTelemetry {
  gear?: number
  gearLabel?: string
  wheelie?: number
  lean?: number
  leanLimit?: number
  tucking?: boolean
  braking?: boolean
  crashPhase?: EbikeCrashPhase
  crashReason?: EbikeCrashReason
  crashSide?: -1 | 1
  crashProgress?: number
  recoverProgress?: number
}

export interface EbikeTelemetrySnapshot {
  gear: number
  gearLabel: string
  speed: number
  kmh: number
  lean: number
  leanLimit: number
  wheelie: number
  steerInput: number
  tucking: boolean
  braking: boolean
  crashPhase: EbikeCrashPhase
  crashReason: EbikeCrashReason
  crashSide: -1 | 1
  crashElapsed: number
  recoverProgress: number
  modPreset: EbikeModPreset
}

export const RIDER_JOINT_NAMES = [
  'Hips', 'Torso', 'Head',
  'ArmL', 'ArmR', 'ForearmL', 'ForearmR',
  'ThighL', 'ThighR', 'ShinL', 'ShinR',
] as const

export type RiderJointName = (typeof RIDER_JOINT_NAMES)[number]
export type RiderJoints = Record<RiderJointName, T.Object3D | undefined>

const MOD_ORDER: readonly EbikeModPreset[] = ['stock', 'ghostfire', 'neon']

function smoothstep(t: number): number {
  const c = T.MathUtils.clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}

function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

export interface CrashSlideResult {
  bikeOffset: T.Vector3
  riderOffset: T.Vector3
  bikeRoll: number
  bikeLift: number
  riderGroundBlend: number
}

export interface SafeMoveProbe {
  canPlace: (x: number, z: number) => boolean
  supportY: (x: number, z: number, refY: number) => number
}

export function createEbikeFxController() {
  let gear = 2
  let modPreset: EbikeModPreset = 'stock'
  let customMods: Partial<EbikeModConfig> | null = null
  let wheelie = 0
  let wheelieOverHold = 0
  let leanExtra = 0
  let prevSpeed = 0
  let longAccel = 0
  let crashPhase: EbikeCrashPhase = 'none'
  let crashReason: EbikeCrashReason = ''
  let crashSide: -1 | 1 = 1
  let crashElapsed = 0
  let recoverElapsed = 0
  let crashHeading = 0
  let crashSlideSpeed = 0
  let riderEjectX = 0
  let riderEjectZ = 0
  let bikeSlideX = 0
  let bikeSlideZ = 0
  let lastNotifiedCrash: EbikeCrashPhase = 'none'

  const RECOVER_DURATION = .72
  const LEAN_LIMIT = .56

  function currentGearSpec(): EbikeGearSpec {
    return EBIKE_GEARS[T.MathUtils.clamp(gear - 1, 0, EBIKE_GEARS.length - 1)]
  }

  function resetPoseOnly() {
    wheelie = 0
    wheelieOverHold = 0
    leanExtra = 0
    prevSpeed = 0
    longAccel = 0
    crashPhase = 'none'
    crashReason = ''
    crashElapsed = 0
    recoverElapsed = 0
    crashSlideSpeed = 0
    riderEjectX = riderEjectZ = 0
    bikeSlideX = bikeSlideZ = 0
    lastNotifiedCrash = 'none'
  }

  function triggerCrash(reason: Exclude<EbikeCrashReason, ''>, side: -1 | 1, heading: number, entrySpeed: number) {
    if (crashPhase !== 'none') return
    crashPhase = 'crashed'
    crashReason = reason
    crashSide = side
    crashElapsed = 0
    recoverElapsed = 0
    crashHeading = heading
    crashSlideSpeed = T.MathUtils.clamp(Math.abs(entrySpeed), 3.6, 13)
    bikeSlideX = bikeSlideZ = 0
    // Separate rider cleanly sideways away from bike center on impact so limbs never clip bike chassis.
    const sideX = Math.cos(heading) * side, sideZ = -Math.sin(heading) * side
    riderEjectX = -sideX * .55
    riderEjectZ = -sideZ * .55
    wheelieOverHold = 0
    window.dispatchEvent(new CustomEvent('walk:toast', {
      detail: {
        text: reason === 'lowside'
          ? '压弯过低打滑摔车 · 按空格或点「扶车」起身'
          : reason === 'loopout'
            ? '翘头翻车 · 按空格或点「扶车」起身'
            : '猛烈撞击倒车 · 按空格或点「扶车」起身',
        ms: 2600,
      },
    }))
  }

  function startRecover() {
    if (crashPhase !== 'crashed') return false
    crashPhase = 'recovering'
    recoverElapsed = 0
    return true
  }

  function cycleModPreset(): EbikeModPreset {
    const idx = MOD_ORDER.indexOf(modPreset)
    modPreset = MOD_ORDER[(idx + 1) % MOD_ORDER.length]
    customMods = null
    return modPreset
  }

  function setModPreset(preset: EbikeModPreset, overrides?: Partial<EbikeModConfig>) {
    modPreset = preset
    customMods = overrides ?? null
  }

  function step(
    dt: number,
    base: {
      speed: number
      heading: number
      lean: number
      steerInput: number
      braking: boolean
      obstacle: string
      allowAutoCrash: boolean
    },
    input: EbikeRideControlInput,
    external?: ExternalEbikeTelemetry,
    probe?: SafeMoveProbe,
  ): EbikeTelemetrySnapshot {
    const cdt = Math.min(.1, Math.max(0, dt))

    if (input.cycleMod) cycleModPreset()

    if (external?.gear !== undefined) {
      gear = T.MathUtils.clamp(Math.round(external.gear), 1, EBIKE_GEARS.length)
    } else {
      if (input.gearSelect !== null) gear = T.MathUtils.clamp(input.gearSelect, 1, EBIKE_GEARS.length)
      else if (input.gearDelta !== 0) gear = T.MathUtils.clamp(gear + input.gearDelta, 1, EBIKE_GEARS.length)
    }

    const gearSpec = currentGearSpec()

    if (external?.crashPhase !== undefined) {
      crashPhase = external.crashPhase
      crashReason = external.crashReason ?? ''
      crashSide = external.crashSide ?? (base.lean >= 0 ? 1 : -1)
      if (crashPhase === 'crashed') crashElapsed += cdt
      if (crashPhase === 'recovering') recoverElapsed = (external.recoverProgress ?? 0) * RECOVER_DURATION
      if (crashPhase !== lastNotifiedCrash && crashPhase === 'crashed') {
        lastNotifiedCrash = crashPhase
      }
      if (crashPhase === 'none') {
        lastNotifiedCrash = 'none'
        bikeSlideX = bikeSlideZ = riderEjectX = riderEjectZ = 0
      }
    } else {
      // Local presentation state machine when Hy2 physics telemetry isn't attached yet.
      if (crashPhase === 'none') {
        if (input.wheelie && base.speed > 1.2) {
          const cap = input.wheelie && base.allowAutoCrash ? .84 : .58
          const targetWheelie = T.MathUtils.clamp(.44 * gearSpec.wheelieEase * T.MathUtils.clamp(base.speed / 4.5, .4, 1.15), .22, cap)
          wheelie = T.MathUtils.damp(wheelie, targetWheelie, 7.5, cdt)
          if (base.allowAutoCrash && wheelie > .72) {
            wheelieOverHold += cdt
            if (wheelieOverHold > .55) triggerCrash('loopout', base.lean >= 0 ? 1 : -1, base.heading, base.speed)
          } else {
            wheelieOverHold = Math.max(0, wheelieOverHold - cdt * 2)
          }
        } else {
          wheelieOverHold = 0
          wheelie = T.MathUtils.damp(wheelie, 0, 11, cdt)
        }

        const tuckBoost = input.tuck && Math.abs(base.steerInput) > .15 && base.speed > 2.2
          ? -Math.sign(base.steerInput) * .30 * Math.min(1, base.speed / 5.5)
          : 0
        leanExtra = T.MathUtils.damp(leanExtra, tuckBoost, 8, cdt)

        const totalLean = T.MathUtils.clamp(base.lean + leanExtra, -.68, .68)
        if (base.allowAutoCrash) {
          const speedDrop = cdt > 1e-4 ? (prevSpeed - base.speed) / cdt : 0
          if (base.obstacle && prevSpeed > 5.0 && base.speed < .6 && speedDrop > 20) {
            triggerCrash('impact', base.steerInput >= 0 ? 1 : -1, base.heading, prevSpeed)
          } else if (input.tuck && Math.abs(totalLean) > LEAN_LIMIT && base.speed > 4.6) {
            triggerCrash('lowside', totalLean > 0 ? -1 : 1, base.heading, base.speed)
          }
        }
      } else if (crashPhase === 'crashed') {
        crashElapsed += cdt
        wheelie = T.MathUtils.damp(wheelie, 0, 12, cdt)
        leanExtra = T.MathUtils.damp(leanExtra, 0, 10, cdt)

        if (crashSlideSpeed > .05 && cdt > 0) {
          const fwdX = -Math.sin(crashHeading), fwdZ = -Math.cos(crashHeading)
          const sideX = Math.cos(crashHeading) * crashSide, sideZ = -Math.sin(crashHeading) * crashSide
          const bikeStep = crashSlideSpeed * .35 * cdt
          const riderStep = crashSlideSpeed * .72 * cdt
          const nextBx = bikeSlideX + fwdX * bikeStep + sideX * bikeStep * .42
          const nextBz = bikeSlideZ + fwdZ * bikeStep + sideZ * bikeStep * .42
          if (!probe || probe.canPlace(nextBx, nextBz)) {
            bikeSlideX = nextBx; bikeSlideZ = nextBz
          }
          const nextRx = riderEjectX + fwdX * riderStep - sideX * riderStep * .62
          const nextRz = riderEjectZ + fwdZ * riderStep - sideZ * riderStep * .62
          if (!probe || probe.canPlace(nextRx, nextRz)) {
            riderEjectX = nextRx; riderEjectZ = nextRz
          }
          crashSlideSpeed = Math.max(0, crashSlideSpeed - 6.2 * cdt)
        }

        if (input.recover && crashElapsed > .25) startRecover()
      } else if (crashPhase === 'recovering') {
        recoverElapsed += cdt
        if (recoverElapsed >= RECOVER_DURATION) {
          crashPhase = 'none'
          crashReason = ''
          crashElapsed = 0
          recoverElapsed = 0
          bikeSlideX = bikeSlideZ = riderEjectX = riderEjectZ = 0
        }
      }
    }

    if (cdt > 1e-4) {
      const rawAccel = (base.speed - prevSpeed) / cdt
      longAccel = T.MathUtils.damp(longAccel, T.MathUtils.clamp(rawAccel, -12, 12), 10, cdt)
      prevSpeed = base.speed
    }

    const finalWheelie = external?.wheelie ?? wheelie
    const finalLean = external?.lean ?? T.MathUtils.clamp(base.lean + leanExtra, -.68, .68)

    return {
      gear,
      gearLabel: external?.gearLabel ?? gearSpec.label,
      speed: base.speed,
      kmh: Math.round(Math.abs(base.speed) * 3.6),
      lean: finalLean,
      leanLimit: external?.leanLimit ?? LEAN_LIMIT,
      wheelie: finalWheelie,
      steerInput: base.steerInput,
      tucking: external?.tucking ?? (input.tuck && Math.abs(finalLean) > .08),
      braking: external?.braking ?? base.braking,
      crashPhase,
      crashReason,
      crashSide,
      crashElapsed,
      recoverProgress: crashPhase === 'recovering' ? T.MathUtils.clamp(recoverElapsed / RECOVER_DURATION, 0, 1) : 0,
      modPreset,
    }
  }

  function getCrashVisualOffsets(): CrashSlideResult {
    if (crashPhase === 'none') {
      return {
        bikeOffset: new T.Vector3(),
        riderOffset: new T.Vector3(),
        bikeRoll: 0,
        bikeLift: 0,
        riderGroundBlend: 0,
      }
    }
    if (crashPhase === 'crashed') {
      const fallT = smoothstep(crashElapsed / .28)
      const bounce = crashElapsed > .22 && crashElapsed < .45
        ? Math.sin(((crashElapsed - .22) / .23) * Math.PI) * .08
        : 0
      const targetRoll = -crashSide * 1.38
      return {
        bikeOffset: new T.Vector3(bikeSlideX, 0, bikeSlideZ),
        riderOffset: new T.Vector3(riderEjectX, 0, riderEjectZ),
        bikeRoll: targetRoll * fallT + crashSide * bounce,
        bikeLift: .22 * fallT,
        riderGroundBlend: fallT,
      }
    }
    const r = smoothstep(recoverElapsed / RECOVER_DURATION)
    // First 40% rider gets up and steps to bike; 40%..100% pulls bike upright and mounts.
    const liftT = smoothstep((r - .35) / .55)
    const riderMoveT = smoothstep(r / .55)
    return {
      bikeOffset: new T.Vector3(bikeSlideX * (1 - liftT), 0, bikeSlideZ * (1 - liftT)),
      riderOffset: new T.Vector3(
        T.MathUtils.lerp(riderEjectX, bikeSlideX * (1 - liftT), riderMoveT),
        0,
        T.MathUtils.lerp(riderEjectZ, bikeSlideZ * (1 - liftT), riderMoveT),
      ),
      bikeRoll: -crashSide * 1.38 * (1 - liftT),
      bikeLift: .22 * (1 - liftT),
      riderGroundBlend: 1 - smoothstep(r / .65),
    }
  }

  return {
    get gear() { return gear },
    get modPreset() { return modPreset },
    get customMods() { return customMods },
    get crashPhase() { return crashPhase },
    get crashElapsed() { return crashElapsed },
    get longAccel() { return longAccel },
    reset: resetPoseOnly,
    triggerCrash,
    startRecover,
    cycleModPreset,
    setModPreset,
    step,
    getCrashVisualOffsets,
  }
}

const _seatPos = new T.Vector3()
const _gripL = new T.Vector3()

/**
 * Drives full articulated rider + e-bike rig synchronization:
 * - Seat world position locked to wheelie/lean pivot (never floats or clips saddle)
 * - Wheelie pull-back balance + elbow bend + head forward compensation
 * - Aggressive cornering inside lean + inside knee out + horizon-level head gaze
 * - Crash separation (flung supine/side impact brace) and recovery lift animation
 */
export function applyEbikeVisualAndRider(params: {
  figure: T.Group
  joints: RiderJoints
  rig: EbikeVisualRig
  basePos: T.Vector3
  heading: number
  groundPitch: number
  snapMountBlend: number
  mountStartPos: T.Vector3
  mountStartYaw: number
  mountStartRot: Map<RiderJointName, [number, number, number]>
  fx: ReturnType<typeof createEbikeFxController>
  state: EbikeTelemetrySnapshot
  dt: number
  supportY?: (x: number, z: number, refY: number) => number
}) {
  const {
    figure, joints, rig, basePos, heading, groundPitch,
    snapMountBlend, mountStartPos, mountStartYaw, mountStartRot,
    fx, state, dt, supportY,
  } = params
  const cdt = Math.min(.12, Math.max(0, dt))
  const crash = fx.getCrashVisualOffsets()

  const bikeX = basePos.x + crash.bikeOffset.x
  const bikeZ = basePos.z + crash.bikeOffset.z
  const bikeY = supportY ? supportY(bikeX, bikeZ, basePos.y) : basePos.y

  rig.update({
    pos: _gripL.set(bikeX, bikeY, bikeZ),
    heading,
    groundPitch,
    lean: state.crashPhase === 'none' ? state.lean : 0,
    wheelie: state.crashPhase === 'none' ? state.wheelie : 0,
    steerInput: state.steerInput,
    speed: state.crashPhase === 'none' ? state.speed : 0,
    braking: state.braking,
    crashRoll: crash.bikeRoll,
    crashLift: crash.bikeLift,
    dt: cdt,
  })

  rig.seatAnchor.getWorldPosition(_seatPos)
  const swing = snapMountBlend < 1 ? Math.sin(snapMountBlend * Math.PI) : 0
  const idleFoot = smoothstep((.38 - Math.abs(state.speed)) / .38)

  if (state.crashPhase === 'crashed') {
    const rx = basePos.x + crash.riderOffset.x
    const rz = basePos.z + crash.riderOffset.z
    const ry = supportY ? supportY(rx, rz, basePos.y) : basePos.y
    const b = crash.riderGroundBlend
    figure.position.set(
      T.MathUtils.lerp(_seatPos.x, rx, b),
      T.MathUtils.lerp(_seatPos.y, ry + .25 * b, b),
      T.MathUtils.lerp(_seatPos.z, rz, b),
    )
    const fallPitch = 1.36 * b
    const fallRoll = state.crashSide * .28 * b
    figure.rotation.set(fallPitch, heading + state.crashSide * .42 * b, fallRoll, 'YXZ')
    applyJointBlend(joints, {
      Hips: [0, 0, 0],
      Torso: [.18 * b, state.crashSide * .18 * b, 0],
      Head: [-.42 * b, -state.crashSide * .28 * b, 0],
      ArmL: [1.35 * b, .28 * b, -.42 * b],
      ArmR: [1.35 * b, -.28 * b, .42 * b],
      ForearmL: [1.15 * b, 0, 0],
      ForearmR: [1.15 * b, 0, 0],
      ThighL: [.65 * b, 0, -.18 * b],
      ThighR: [.85 * b, 0, .18 * b],
      ShinL: [-.95 * b, 0, 0],
      ShinR: [-1.15 * b, 0, 0],
    })
    return
  }

  if (state.crashPhase === 'recovering') {
    const r = state.recoverProgress
    const rx = basePos.x + crash.riderOffset.x
    const rz = basePos.z + crash.riderOffset.z
    const ry = supportY ? supportY(rx, rz, basePos.y) : basePos.y
    const mountT = smoothstep((r - .45) / .55)
    const standT = smoothstep(r / .45)
    const standPosY = ry + .04
    const curY = T.MathUtils.lerp(T.MathUtils.lerp(ry + .25, standPosY, standT), _seatPos.y, mountT) + Math.sin(mountT * Math.PI) * .12
    figure.position.set(
      T.MathUtils.lerp(rx, _seatPos.x, mountT),
      curY,
      T.MathUtils.lerp(rz, _seatPos.z, mountT),
    )
    const bodyPitch = T.MathUtils.lerp(1.38, -.32, standT) * (1 - mountT) + (groundPitch * .45) * mountT
    figure.rotation.set(bodyPitch, heading + state.crashSide * .35 * (1 - mountT), -state.crashSide * .2 * (1 - mountT), 'YXZ')
    const pullFactor = Math.sin(Math.min(1, r / .8) * Math.PI)
    applyJointBlend(joints, {
      Hips: [0, 0, 0],
      Torso: [T.MathUtils.lerp(-.28, -.1, mountT) - pullFactor * .22, 0, 0],
      Head: [.18 * (1 - mountT), 0, 0],
      ArmL: [T.MathUtils.lerp(1.05, .9, mountT), 0, 0],
      ArmR: [T.MathUtils.lerp(1.05, .9, mountT), 0, 0],
      ForearmL: [T.MathUtils.lerp(.75, .35, mountT), 0, 0],
      ForearmR: [T.MathUtils.lerp(.75, .35, mountT), 0, 0],
      ThighL: [T.MathUtils.lerp(.35, 1.25, mountT), 0, 0],
      ThighR: [T.MathUtils.lerp(.35, 1.25, mountT), 0, 0],
      ShinL: [T.MathUtils.lerp(-.45, -1.4, mountT), 0, 0],
      ShinR: [T.MathUtils.lerp(-.45, -1.4, mountT), 0, 0],
    })
    return
  }

  // Normal riding / wheelie / aggressive lean
  const wheelieFactor = T.MathUtils.clamp(state.wheelie / .62, 0, 1.25)
  const spdRatio = T.MathUtils.clamp(Math.abs(state.speed) / 14, 0, 1)
  const leanRatio = T.MathUtils.clamp(state.lean / .56, -1.2, 1.2)
  const accelShift = T.MathUtils.clamp(fx.longAccel * .018, -.12, .14)

  if (snapMountBlend < 1) {
    figure.position.set(
      T.MathUtils.lerp(mountStartPos.x, _seatPos.x, snapMountBlend),
      T.MathUtils.lerp(mountStartPos.y, _seatPos.y, snapMountBlend) + swing * .18,
      T.MathUtils.lerp(mountStartPos.z, _seatPos.z, snapMountBlend),
    )
    figure.rotation.set(0, mountStartYaw + shortestAngle(mountStartYaw, heading) * snapMountBlend, -swing * .10, 'YXZ')
  } else {
    figure.position.copy(_seatPos)
    // Bike rises by `state.wheelie`; rider rides on seat and stays upright relative to world via Torso counter-balance.
    figure.rotation.set(groundPitch * .45 + state.wheelie * .78, heading, state.lean * .92, 'YXZ')
  }

  // Inside knee flare on deep cornering lean (right lean < 0 flares right knee +Z; left lean > 0 flares left knee -Z).
  const kneeFlareL = leanRatio > .25 ? -(leanRatio - .25) * .38 * (1 - idleFoot) : 0
  const kneeFlareR = leanRatio < -.25 ? (-leanRatio - .25) * .38 * (1 - idleFoot) : 0

  const targets: Record<RiderJointName, [number, number, number]> = {
    Hips: [0, 0, 0],
    // Lean forward slightly against wheelie rise to hold balance, lean inward into turns, react to accel/braking.
    Torso: [
      -.09 - spdRatio * .08 - accelShift + wheelieFactor * .22 - (state.tucking ? .16 : 0),
      -state.steerInput * .08,
      leanRatio * .24,
    ],
    // Keep head level with horizon when cornering and looking into the turn / over handlebars when wheelieing.
    Head: [
      -.04 - wheelieFactor * .28 + (state.tucking ? .12 : 0),
      -state.steerInput * .24,
      -leanRatio * .52,
    ],
    ArmL: [.92 + state.steerInput * .15 + wheelieFactor * .18, -state.steerInput * .12, -.04],
    ArmR: [.92 - state.steerInput * .15 + wheelieFactor * .18, -state.steerInput * .12, .04],
    ForearmL: [.36 + wheelieFactor * .34, 0, 0],
    ForearmR: [.36 + wheelieFactor * .34, 0, 0],
    ThighL: [T.MathUtils.lerp(1.25 - wheelieFactor * .18, .56, idleFoot), 0, T.MathUtils.lerp(kneeFlareL, -.22, idleFoot)],
    ThighR: [T.MathUtils.lerp(1.25 - wheelieFactor * .18, .56, idleFoot), 0, kneeFlareR],
    ShinL: [T.MathUtils.lerp(-1.4 + wheelieFactor * .14, -.55, idleFoot), 0, 0],
    ShinR: [T.MathUtils.lerp(-1.4 + wheelieFactor * .14, -.55, idleFoot), 0, 0],
  }

  for (const name of RIDER_JOINT_NAMES) {
    const joint = joints[name]
    if (!joint) continue
    const [tx, ty, tz] = targets[name]
    if (snapMountBlend < 1) {
      const from = mountStartRot.get(name) ?? [0, 0, 0]
      joint.rotation.set(
        T.MathUtils.lerp(from[0], tx, snapMountBlend),
        T.MathUtils.lerp(from[1], ty, snapMountBlend),
        T.MathUtils.lerp(from[2], tz, snapMountBlend),
      )
    } else {
      joint.rotation.set(tx, ty, tz)
    }
  }
  if (swing > 1e-4) {
    if (joints.ThighR) {
      joints.ThighR.rotation.x += swing * .35
      joints.ThighR.rotation.z -= swing * .55
    }
    if (joints.ShinR) joints.ShinR.rotation.x -= swing * .30
    if (joints.Torso) joints.Torso.rotation.x -= swing * .14
  }
}

function applyJointBlend(joints: RiderJoints, targets: Record<RiderJointName, [number, number, number]>) {
  for (const name of RIDER_JOINT_NAMES) {
    const joint = joints[name]
    if (!joint) continue
    const [tx, ty, tz] = targets[name]
    joint.rotation.set(tx, ty, tz)
  }
}
