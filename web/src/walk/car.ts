import R from '@dimforge/rapier3d-compat'
import * as T from 'three'
import {clearAvatarPose, getAvatarJoints} from './avatar-rig'
import {
  CAR_DRIVE_MODE_ORDER,
  carConfig as ccfg,
  carDriveModes,
  walkConfig as wcfg,
  type CarDriveMode,
} from './config'
import type {DismountContext, MountCheckResult} from './ride'

type Kind = 'ground'|'overview'|'road'|'deck'|'deckThin'|'building'|'peak'|'tree'|'rail'|'sidewalk'|'landmark'

export interface CarStepControl {
  handbrake?: boolean
}

export interface CarDynamicTelemetry {
  mode: CarDriveMode
  modeIndex: number
  modeLabel: string
  maxKmh: number
  gear: number
  gearLabel: string
  rpm: number
  rpmRatio: number
  speed: number
  kmh: number
  vLong: number
  vLat: number
  velX: number
  velZ: number
  yawRate: number
  slipAngle: number
  driftIntensity: number
  handbrake: boolean
  braking: boolean
  reversing: boolean
  shifting: boolean
  dynRoll: number
  dynPitch: number
  impactStrength: number
  damage: number
  gtaPhysics: boolean
}

export interface CarMoveContext {
  pos: {x:number; y:number; z:number}
  next: {x:number; z:number}
  move: {x:number; z:number}
  heading: number
  speed: number
  step: number
  motorPavement: (x:number, z:number)=>boolean
  insideHouse: (x:number, z:number, y?:number)=>boolean
  carBlockedAt: (x:number, footY:number, z:number, heading:number, dirSign:-1|0|1)=>boolean
  collisionKind: (dirX:number, dirZ:number)=>'building'|'collision'|''
  stopCar: ()=>void
  dampCar: (step:number)=>number
}

const IDENTITY = {x:0, y:0, z:0, w:1}
const CAR_DISMOUNT_OFFSETS: readonly [number, number][] = [
  [-1.42, .15],
  [1.42, .15],
  [-1.42, -.78],
  [1.42, -.78],
  [0, -2.75],
  [0, 2.75],
]

// Four understated Guilin street sedan finishes: pearl ivory, Lijiang slate blue, karst silver, osmanthus burgundy.
const CAR_PAINTS = [0xf0ede6, 0x365b77, 0x8c949c, 0x8f3330] as const

let carWallRay: R.Ray | undefined

function smoothstep(t: number) {
  const c = T.MathUtils.clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}

function deadzone(value: number, threshold: number) {
  const abs = Math.abs(value)
  if (abs <= threshold) return 0
  return Math.sign(value) * (abs - threshold) / (1 - threshold)
}

function shortestAngle(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

function isWallBlocker(kind: Kind | undefined) {
  return kind === 'building' || kind === 'rail' || kind === 'peak' || kind === 'landmark' || kind === 'tree' || kind === 'deck' || kind === 'deckThin'
}

function segmentBlocked(ctx: DismountContext, x0: number, z0: number, x1: number, z1: number, baseY: number) {
  const dx = x1 - x0, dz = z1 - z0, dist = Math.hypot(dx, dz)
  if (dist <= .05) return false
  carWallRay ??= new R.Ray({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: -1})
  carWallRay.dir.x = dx / dist; carWallRay.dir.y = 0; carWallRay.dir.z = dz / dist
  for (const offset of [.5, 1.25]) {
    carWallRay.origin.x = x0; carWallRay.origin.y = baseY + offset; carWallRay.origin.z = z0
    if (ctx.world.castRay(carWallRay, dist, true, undefined, undefined, ctx.capsule, undefined, coll => isWallBlocker(ctx.kinds.get(coll.handle)))) {
      return true
    }
  }
  return false
}

function localSupport(ctx: DismountContext, x: number, z: number, refY: number) {
  const bore=ctx.tunnelSupport?.(x,z,refY)
  if(bore)return bore
  const deck = ctx.surface(x, z, 'deck', refY + .55, 1.8)
  const validDeck = deck && deck.y <= refY + .55 ? deck : null
  const lm = ctx.surface(x, z, 'landmark', refY + .55, 1.8)
  const validLm = lm && lm.y <= refY + .55 && lm.slope <= wcfg.slope ? lm : null
  const bridgeHit = validDeck && validLm ? (validLm.y > validDeck.y ? validLm : validDeck) : (validDeck ?? validLm)
  const support = bridgeHit ?? ctx.surface(x, z, 'road', refY + .85, 1.7) ?? ctx.surface(x, z, 'sidewalk', refY + .85, 1.7) ?? ctx.surface(x, z, 'ground', refY + .85, 1.7)
  if (!support || support.slope > wcfg.slope || (!bridgeHit && ctx.wet(x, z))) return null
  const peak = ctx.surface(x, z, 'peak')
  if (peak && peak.y > support.y + .05) return null
  return support
}

/** Probes door-side and bumper-end spots around a parked sedan (1.82m wide x 4.48m long) for safe step-out. */
export function probeCarDismount(ctx: DismountContext, cx: number, cz: number, heading: number, carY: number) {
  const fx = -Math.sin(heading), fz = -Math.cos(heading)
  const rx = Math.cos(heading), rz = -Math.sin(heading)
  for (let i = 0; i < CAR_DISMOUNT_OFFSETS.length; i++) {
    const [side, fwd] = CAR_DISMOUNT_OFFSETS[i]
    const x = cx + side * rx + fwd * fx, z = cz + side * rz + fwd * fz
    const tile = ctx.tileAt(x, z)
    if (!tile || !ctx.stream.loaded.has(tile) || ctx.insideHouse(x, z, carY+.8)) continue
    const support = localSupport(ctx, x, z, carY)
    if (!support || Math.abs(support.y - carY) > .85) continue
    if (segmentBlocked(ctx, cx, cz, x, z, Math.max(carY, support.y))) continue
    const y = support.y + wcfg.height / 2 + .055
    if (ctx.world.intersectionWithShape({x, y, z}, IDENTITY, ctx.shape, undefined, undefined, ctx.capsule)) continue
    return {x, y, z, rule: `car-local-${i}`}
  }
  return null
}

/** Validates elevation gap and wall LOS between player and parked car before opening the door. */
export function probeCarMount(ctx: DismountContext, px: number, py: number, pz: number, cx: number, cy: number, cz: number): MountCheckResult {
  if (Math.abs(cy - py) > 1.5) return {ok: false, reason: 'height'}
  if (segmentBlocked(ctx, px, pz, cx, cz, Math.max(py, cy))) return {ok: false, reason: 'blocked'}
  const tile = ctx.tileAt(cx, cz)
  if (!tile || !ctx.stream.loaded.has(tile) || ctx.insideHouse(cx, cz, cy+.8)) return {ok: false, reason: 'narrow'}
  const support = localSupport(ctx, cx, cz, cy)
  if (!support || Math.abs(support.y - cy) > .65) return {ok: false, reason: 'height'}
  return {ok: true, x: cx, y: support.y + wcfg.height / 2 + .055, z: cz, bikeY: support.y, shifted: false}
}

/** GTA-grade 2D planar car controller: 5-speed auto transmission, 3 drive modes (40/75/108 km/h), handbrake powerslide drift, dynamic weight transfer, and momentum rebound. */
export function createCarControl() {
  let vx = 0, vz = 0, vLong = 0, vLat = 0, yawRate = 0
  let heading = 0, roll = 0, pitch = 0, dynPitch = 0, steerInput = 0, revHold = 0
  let onMotor = false, offRoadHold = 0, lastToastAt = -1e9
  let mode: CarDriveMode = 'street', gtaPhysics = true
  let gear = 1, rpm = 900, shiftTimer = 0
  let handbrake = false, braking = false, slipAngle = 0, driftIntensity = 0
  let impactStrength = 0, damage = 0, reboundTimer = 0, lastImpactPulse = 0

  function modeSpec() {
    return carDriveModes[mode]
  }

  function maxSpeedMs() {
    return modeSpec().maxKmh / 3.6
  }

  function reverseCapMs() {
    return gtaPhysics ? ccfg.reverseMax : -12 / 3.6
  }

  function updateGearAndRpm(cdt: number, throttle: number) {
    const absKmh = Math.abs(vLong) * 3.6
    if (vLong < -.12) {
      gear = -1
      rpm = T.MathUtils.damp(rpm, 1100 + Math.min(1, absKmh / 16) * 3400, 10, cdt)
      shiftTimer = Math.max(0, shiftTimer - cdt)
      return
    }
    if (absKmh < .35 && throttle <= .05) {
      gear = 0
      rpm = T.MathUtils.damp(rpm, 850, 9, cdt)
      shiftTimer = Math.max(0, shiftTimer - cdt)
      return
    }
    const thresholds = ccfg.gearUpshiftKmh
    let targetGear = 1
    for (let i = 0; i < thresholds.length; i++) {
      const hyster = gear > i + 1 ? -3.0 : 0
      if (absKmh >= thresholds[i] + hyster) targetGear = i + 2
    }
    const modeMaxGear = mode === 'cruise' ? 3 : mode === 'street' ? 4 : 5
    targetGear = Math.min(modeMaxGear, Math.max(1, targetGear))
    if (gear > 0 && targetGear > gear) shiftTimer = .095
    gear = targetGear
    shiftTimer = Math.max(0, shiftTimer - cdt)

    const low = gear <= 1 ? 0 : thresholds[gear - 2] * .72
    const high = gear >= thresholds.length + 1 ? modeSpec().maxKmh : Math.min(modeSpec().maxKmh, thresholds[gear - 1] * 1.08)
    const span = Math.max(6, high - low)
    const frac = T.MathUtils.clamp((absKmh - low) / span, 0, 1)
    const targetRpm = 1150 + frac * 5250 + (handbrake && throttle > .1 ? 850 : 0) - (shiftTimer > 0 ? 700 : 0)
    rpm = T.MathUtils.damp(rpm, T.MathUtils.clamp(targetRpm, 850, 6800), 12, cdt)
  }

  function syncWorldVel() {
    const fx = -Math.sin(heading), fz = -Math.cos(heading)
    const rx = Math.cos(heading), rz = -Math.sin(heading)
    vx = fx * vLong + rx * vLat
    vz = fz * vLong + rz * vLat
  }

  function reset() {
    vx = vz = vLong = vLat = yawRate = 0
    roll = pitch = dynPitch = steerInput = revHold = offRoadHold = 0
    onMotor = handbrake = braking = false
    gear = 1; rpm = 900; shiftTimer = 0
    slipAngle = driftIntensity = impactStrength = reboundTimer = lastImpactPulse = 0
  }

  function gearLabel() {
    if (gear < 0) return 'R'
    if (gear === 0) return 'N'
    return `D${gear}`
  }

  function setMode(next: CarDriveMode) {
    mode = carDriveModes[next] ? next : 'street'
    return mode
  }

  function setModeByIndex(index: number) {
    const clamped = Math.max(0, Math.min(CAR_DRIVE_MODE_ORDER.length - 1, Math.round(index) - 1))
    mode = CAR_DRIVE_MODE_ORDER[clamped]
    return mode
  }

  function shiftMode(delta: number) {
    const idx = CAR_DRIVE_MODE_ORDER.indexOf(mode)
    const nextIdx = Math.max(0, Math.min(CAR_DRIVE_MODE_ORDER.length - 1, idx + Math.sign(delta)))
    mode = CAR_DRIVE_MODE_ORDER[nextIdx]
    return mode
  }

  function telemetry(): CarDynamicTelemetry {
    const spec = modeSpec()
    return {
      mode,
      modeIndex: CAR_DRIVE_MODE_ORDER.indexOf(mode) + 1,
      modeLabel: spec.label,
      maxKmh: spec.maxKmh,
      gear,
      gearLabel: gearLabel(),
      rpm: Math.round(rpm),
      rpmRatio: T.MathUtils.clamp((rpm - 850) / (6800 - 850), 0, 1),
      speed: vLong,
      kmh: Math.round(Math.hypot(vx, vz) * 3.6),
      vLong,
      vLat,
      velX: vx,
      velZ: vz,
      yawRate,
      slipAngle,
      driftIntensity,
      handbrake,
      braking,
      reversing: vLong < -.05,
      shifting: shiftTimer > 0,
      dynRoll: roll,
      dynPitch,
      impactStrength,
      damage,
      gtaPhysics,
    }
  }

  return {
    get speed() { return vLong },
    get velX() { return vx },
    get velZ() { return vz },
    get vLat() { return vLat },
    get yawRate() { return yawRate },
    get heading() { return heading },
    get roll() { return roll },
    get pitch() { return pitch },
    get dynPitch() { return dynPitch },
    get steerInput() { return steerInput },
    get handbrake() { return handbrake },
    get braking() { return braking },
    get driftIntensity() { return driftIntensity },
    get slipAngle() { return slipAngle },
    get impactStrength() { return impactStrength },
    get mode() { return mode },
    get gear() { return gear },
    get rpm() { return rpm },
    setMode,
    setModeByIndex,
    shiftMode,
    setGtaPhysics(on: boolean) {
      gtaPhysics = on
      if (!on) mode = 'cruise'
    },
    consumeImpactPulse() {
      const p = lastImpactPulse
      lastImpactPulse = 0
      return p
    },
    telemetry,
    mount(yaw: number, initialPitch = 0, options?: {mode?: CarDriveMode; gtaPhysics?: boolean}) {
      heading = yaw
      if (options?.gtaPhysics !== undefined) gtaPhysics = options.gtaPhysics
      if (options?.mode !== undefined) mode = options.mode
      reset()
      pitch = initialPitch
      damage = 0
    },
    stop() {
      vx = vz = vLong = vLat = yawRate = 0
      driftIntensity = slipAngle = 0
    },
    reset,
    dampSpeed(step: number) {
      const k = Math.max(0, 1 - ccfg.slideDamp * step)
      vLong *= k
      vLat *= Math.max(0, 1 - ccfg.slideDamp * 1.4 * step)
      syncWorldVel()
      return vLong
    },
    steer(forward: number, right: number, dt: number, mounted = true, control?: CarStepControl) {
      const cdt = Math.min(.12, Math.max(0, dt))
      impactStrength = Math.max(0, impactStrength - 2.6 * cdt)
      reboundTimer = Math.max(0, reboundTimer - cdt)
      if (!mounted) {
        revHold = 0
        handbrake = false
        braking = false
        steerInput = T.MathUtils.damp(steerInput, 0, ccfg.steerDamp, cdt)
        roll = T.MathUtils.damp(roll, 0, ccfg.rollDamp, cdt)
        dynPitch = T.MathUtils.damp(dynPitch, 0, 10, cdt)
        updateGearAndRpm(cdt, 0)
        return 0
      }

      const uFwd = deadzone(T.MathUtils.clamp(forward, -1, 1), ccfg.stickDeadFwd)
      const uTurn = deadzone(T.MathUtils.clamp(right, -1, 1), ccfg.stickDeadTurn)
      steerInput = T.MathUtils.damp(steerInput, uTurn, ccfg.steerDamp, cdt)
      handbrake = !!control?.handbrake

      const fx = -Math.sin(heading), fz = -Math.cos(heading)
      const rx = Math.cos(heading), rz = -Math.sin(heading)
      vLong = vx * fx + vz * fz
      vLat = vx * rx + vz * rz

      const prevVLong = vLong
      const spec = modeSpec()
      const capMs = maxSpeedMs()
      const revCap = reverseCapMs()
      const uphillSin = Math.max(0, Math.sin(pitch) - .015)
      const downhillSin = Math.max(0, -Math.sin(pitch) - .015)

      braking = false
      if (reboundTimer > 0) {
        vLong *= Math.max(0, 1 - 5.2 * cdt)
        vLat *= Math.max(0, 1 - 6.5 * cdt)
      } else if (uFwd > .05) {
        revHold = 0
        if (vLong < -.05) {
          braking = true
          vLong = Math.min(0, vLong + ccfg.brake * uFwd * cdt)
        } else {
          const ratio = T.MathUtils.clamp(Math.max(0, vLong) / capMs, 0, 1.15)
          const gearMul = gtaPhysics ? (ccfg.gearTorque[Math.max(0, Math.min(4, gear - 1))] ?? 1) : 1
          const shiftDip = gtaPhysics && shiftTimer > 0 ? .45 : 1
          const modeAccel = gtaPhysics ? ccfg.accel * spec.accelScale : 5.2
          const drive = modeAccel * gearMul * shiftDip * (1 - ccfg.torqueDecay * Math.pow(Math.min(1, ratio), ccfg.torquePow)) * uFwd
          const gravLoss = uphillSin > 0 ? Math.min(drive * .45, 5.5 * uphillSin) : -Math.min(2.2, 4.0 * downhillSin)
          const hbDrag = handbrake ? ccfg.handbrakeDrag * .65 : 0
          const nextSpd = vLong + (drive - gravLoss - hbDrag) * cdt
          vLong = nextSpd <= capMs ? Math.max(0, nextSpd) : T.MathUtils.damp(vLong, capMs, 3.5, cdt)
        }
      } else if (uFwd < -.05) {
        if (vLong > .05) {
          revHold = 0
          braking = true
          vLong = Math.max(0, vLong + ccfg.brake * uFwd * cdt)
        } else if (vLong < -.01) {
          revHold = ccfg.revHold
          vLong = T.MathUtils.clamp(vLong + ccfg.revAccel * uFwd * cdt, revCap, 0)
        } else {
          revHold += cdt
          if (revHold >= ccfg.revHold) {
            vLong = T.MathUtils.clamp(vLong + ccfg.revAccel * uFwd * cdt, revCap, 0)
          } else {
            vLong = 0
          }
        }
      } else {
        revHold = 0
        const drag = (ccfg.rollDrag + ccfg.aeroDrag * vLong * vLong + (handbrake ? ccfg.handbrakeDrag : 0))
        if (vLong > 0) vLong = Math.max(0, vLong - (drag + (uphillSin > 0 ? 4.5 * uphillSin : 0)) * cdt)
        else if (vLong < 0) vLong = Math.min(0, vLong + (drag * 1.6) * cdt)
      }
      if (handbrake && Math.abs(vLong) > .25) {
        braking = true
        if (uFwd <= .05) {
          const sign = Math.sign(vLong)
          vLong = sign * Math.max(0, Math.abs(vLong) - ccfg.handbrakeDrag * .55 * cdt)
        }
      }

      const planarSpd = Math.hypot(vLong, vLat)
      if (planarSpd <= .015) {
        vLong = 0; vLat = 0; yawRate = 0; slipAngle = 0; driftIntensity = 0
      } else {
        const spdRatio = Math.min(1, Math.abs(vLong) / Math.max(11.11, capMs))
        const steerScale = gtaPhysics ? ccfg.speedSteer : 2.2
        const effSteer = ccfg.maxSteerAngle / (1 + steerScale * spdRatio * spdRatio)
        const ackermannOmega = (vLong / ccfg.wheelbase) * Math.tan(steerInput * effSteer)

        if (!gtaPhysics || (Math.abs(vLong) < 4.5 && !handbrake)) {
          // Crisp low-speed Ackermann steering: exact turning radius [4.6, 6.2]m & reverse sign.
          yawRate = ackermannOmega
          heading -= yawRate * cdt
          vLat = T.MathUtils.damp(vLat, 0, 14, cdt)
        } else {
          // GTA planar yaw + rear tire slip & handbrake powerslide dynamics.
          const speedGate = T.MathUtils.clamp((Math.abs(vLong) - 3.5) / 9.5, 0, 1)
          const hbOversteer = handbrake && vLong > 2.2
            ? steerInput * ccfg.driftYawBoost * spec.driftSlipGain * Math.min(1, vLong / 10.5)
            : 0
          const counterRestore = !handbrake && Math.abs(vLat) > .45
            ? T.MathUtils.clamp((vLat / Math.max(4, Math.abs(vLong))) * ccfg.driftCounterAssist, -1.2, 1.2)
            : 0
          const targetYaw = ackermannOmega * (handbrake ? 1.26 : 1.0) + hbOversteer - counterRestore
          yawRate = T.MathUtils.damp(yawRate, targetYaw, handbrake ? 7.2 : ccfg.yawDamp, cdt)
          heading -= yawRate * cdt

          // Re-project inertial planar velocity onto rotated car basis, then apply lateral tire grip.
          const nfx = -Math.sin(heading), nfz = -Math.cos(heading)
          const nrx = Math.cos(heading), nrz = -Math.sin(heading)
          // Preserve longitudinal delta while carrying inertia laterally through the turn.
          const carryX = fx * vLong + rx * vLat
          const carryZ = fz * vLong + rz * vLat
          const projLong = carryX * nfx + carryZ * nfz
          let projLat = carryX * nrx + carryZ * nrz

          // High-speed aggressive steering or handbrake induces controlled tail slip.
          const slipInject = (handbrake ? 2.85 : .68 * speedGate) * spec.driftSlipGain * Math.max(0, vLong) * yawRate * cdt
          projLat += slipInject

          const grip = handbrake
            ? ccfg.handbrakeRearGrip
            : Math.max(5.0, ccfg.rearGrip - speedGate * 3.2 * (Math.abs(steerInput) > .65 ? 1.15 : .6))
          const latDamp = Math.exp(-grip * cdt)
          vLat = T.MathUtils.clamp(projLat * latDamp, -Math.max(4.5, Math.abs(vLong) * .68), Math.max(4.5, Math.abs(vLong) * .68))
          vLong = T.MathUtils.clamp(projLong, revCap, capMs)
        }
        slipAngle = Math.atan2(vLat, Math.max(1.5, Math.abs(vLong)))
        const rawDrift = gtaPhysics
          ? T.MathUtils.clamp(((Math.abs(slipAngle) - .10) / .38) * T.MathUtils.clamp((planarSpd - 3.0) / 5.0, 0, 1) + (handbrake && planarSpd > 3.2 && Math.abs(steerInput) > .2 ? .32 : 0), 0, 1)
          : 0
        driftIntensity = T.MathUtils.damp(driftIntensity, rawDrift, 9, cdt)
      }

      syncWorldVel()
      updateGearAndRpm(cdt, uFwd)

      // Weight transfer: outward centrifugal roll + brake nose-dive / launch squat pitch.
      const latAccel = vLong * yawRate + vLat * 1.4
      const maxRoll = gtaPhysics ? ccfg.bodyRollMax : .035
      const targetRoll = T.MathUtils.clamp((latAccel / 9.0) * maxRoll, -maxRoll, maxRoll)
      roll = T.MathUtils.damp(roll, targetRoll, ccfg.rollDamp, cdt)

      const longAccel = cdt > 1e-4 ? T.MathUtils.clamp((vLong - prevVLong) / cdt, -16, 16) : 0
      const targetDynPitch = gtaPhysics
        ? T.MathUtils.clamp(longAccel * .0054 - (handbrake && vLong > 2 ? .018 : 0), -ccfg.dynPitchMax, ccfg.dynPitchMax * .82)
        : 0
      dynPitch = T.MathUtils.damp(dynPitch, targetDynPitch, 10.5, cdt)
      return vLong
    },
    setPitch(frontY: number | undefined, backY: number | undefined, dt: number) {
      const target = frontY !== undefined && backY !== undefined && Math.abs(frontY - backY) < 1.1
        ? T.MathUtils.clamp(Math.atan2(frontY - backY, ccfg.wheelbase), -ccfg.pitchMax, ccfg.pitchMax)
        : 0
      pitch = T.MathUtils.damp(pitch, target, ccfg.pitchDamp, Math.min(.12, Math.max(0, dt)))
    },
    resolveMove(ctx: CarMoveContext) {
      const fwdX = -Math.sin(ctx.heading), fwdZ = -Math.cos(ctx.heading)
      const rightX = Math.cos(ctx.heading), rightZ = -Math.sin(ctx.heading)
      const sign: -1 | 1 = ctx.speed >= 0 ? 1 : -1
      const footY = ctx.pos.y - wcfg.height / 2

      const leadHouseHit = (cx: number, cz: number) => {
        const bumperZ = sign * 2.16
        return (
          ctx.insideHouse(cx + fwdX * bumperZ, cz + fwdZ * bumperZ)
          || ctx.insideHouse(cx + fwdX * bumperZ + rightX * .85, cz + fwdZ * bumperZ + rightZ * .85)
          || ctx.insideHouse(cx + fwdX * bumperZ - rightX * .85, cz + fwdZ * bumperZ - rightZ * .85)
        )
      }

      const handleImpact = (reason: 'building' | 'collision') => {
        const hitSpd = Math.hypot(vx, vz) || Math.abs(ctx.speed)
        ctx.next.x = ctx.pos.x; ctx.next.z = ctx.pos.z
        if (hitSpd > 1.8) {
          const pulse = T.MathUtils.clamp(hitSpd / 11.5, .2, 2.2)
          impactStrength = Math.max(impactStrength, pulse)
          lastImpactPulse = Math.max(lastImpactPulse, pulse)
          if (gtaPhysics && hitSpd > 3.5) {
            damage = Math.min(1, damage + Math.min(.22, (hitSpd - 3.5) * .018))
          }
        }
        if (gtaPhysics && hitSpd >= ccfg.reboundMinSpeed && reboundTimer <= 0) {
          // Real momentum rebound instead of instant brick-wall freeze.
          const bounce = Math.min(3.4, hitSpd * ccfg.reboundRestitution)
          vLong = -sign * bounce
          vLat *= -.35
          yawRate += (Math.abs(vLat) > .3 ? Math.sign(vLat) : (steerInput >= 0 ? 1 : -1)) * Math.min(1.4, hitSpd * .08)
          reboundTimer = ccfg.reboundDuration
          syncWorldVel()
          return {blocked: true, reason, speed: vLong}
        }
        ctx.stopCar()
        return {blocked: true, reason, speed: 0}
      }

      if (Math.abs(ctx.speed) > 1e-4 && leadHouseHit(ctx.next.x, ctx.next.z)) {
        return handleImpact('building')
      }

      if (Math.abs(ctx.speed) > 1e-4 && ctx.carBlockedAt(ctx.next.x, footY, ctx.next.z, ctx.heading, sign)) {
        const hit = ctx.collisionKind(fwdX * sign, fwdZ * sign) || (leadHouseHit(ctx.next.x + fwdX * sign * .3, ctx.next.z + fwdZ * sign * .3) ? 'building' : 'collision')
        return handleImpact(hit)
      }

      if (Math.hypot(ctx.move.x, ctx.move.z) < Math.abs(ctx.speed) * ctx.step * .35) {
        const hit = ctx.collisionKind(fwdX * sign, fwdZ * sign)
        if (hit) return handleImpact(hit)
      }

      const motorScore = (cx: number, cz: number) => {
        let score = ctx.motorPavement(cx, cz) ? 2 : 0
        const axle = sign * 1.28
        if (ctx.motorPavement(cx + fwdX * axle - rightX * .74, cz + fwdZ * axle - rightZ * .74)) score++
        if (ctx.motorPavement(cx + fwdX * axle + rightX * .74, cz + fwdZ * axle + rightZ * .74)) score++
        return score
      }

      const nextScore = motorScore(ctx.next.x, ctx.next.z)
      if (nextScore === 4) {
        onMotor = true
        offRoadHold = 0
        return {blocked: false, reason: '', speed: ctx.speed}
      }

      const curScore = motorScore(ctx.pos.x, ctx.pos.z)
      // Always let a boundary-straddling car steer/reverse back onto the carriageway.
      if (!onMotor && nextScore > curScore) {
        if (nextScore === 4) onMotor = true
        return {blocked: false, reason: '', speed: ctx.speed}
      }

      const mx = ctx.next.x - ctx.pos.x, mz = ctx.next.z - ctx.pos.z, mLen = Math.hypot(mx, mz)
      const safeMotorAt = (sx: number, sz: number) =>
        motorScore(sx, sz) >= Math.max(3, curScore)
        && !leadHouseHit(sx, sz)
        && !ctx.carBlockedAt(sx, footY, sz, ctx.heading, sign)

      // Tangential curb glide on shallow angles (<= ~62 deg).
      const canX = mLen > 1e-6 && Math.abs(mx) >= mLen * .42 && safeMotorAt(ctx.next.x, ctx.pos.z)
      const canZ = mLen > 1e-6 && Math.abs(mz) >= mLen * .42 && safeMotorAt(ctx.pos.x, ctx.next.z)
      if (canX && (!canZ || Math.abs(mx) >= Math.abs(mz))) {
        ctx.next.z = ctx.pos.z
        offRoadHold = 0
        return {blocked: false, reason: '', speed: ctx.dampCar(ctx.step * .6)}
      }
      if (canZ) {
        ctx.next.x = ctx.pos.x
        offRoadHold = 0
        return {blocked: false, reason: '', speed: ctx.dampCar(ctx.step * .6)}
      }

      let inX = 0, inZ = 0
      for (const ox of [-2, 0, 2]) for (const oz of [-2, 0, 2]) {
        if ((ox || oz) && ctx.motorPavement(ctx.next.x + ox, ctx.next.z + oz)) {
          inX += ox; inZ += oz
        }
      }
      const inLen = Math.hypot(inX, inZ)
      if (inLen > 1e-4 && mLen > 1e-6) {
        const nx = inX / inLen, nz = inZ / inLen
        const outDot = mx * nx + mz * nz
        if (outDot > 0 && !leadHouseHit(ctx.next.x, ctx.next.z) && !ctx.carBlockedAt(ctx.next.x, footY, ctx.next.z, ctx.heading, sign)) {
          return {blocked: false, reason: '', speed: ctx.speed}
        }
        if (-outDot <= mLen * .88) {
          let tx = outDot < 0 ? mx - outDot * nx : mx
          let tz = outDot < 0 ? mz - outDot * nz : mz
          tx += nx * mLen * .35; tz += nz * mLen * .35
          const sx = ctx.pos.x + tx, sz = ctx.pos.z + tz
          if (safeMotorAt(sx, sz)) {
            ctx.next.x = sx; ctx.next.z = sz
            offRoadHold = 0
            return {blocked: false, reason: '', speed: ctx.dampCar(ctx.step * .6)}
          }
        }
      }

      if (ccfg.strictMotorway) {
        ctx.next.x = ctx.pos.x; ctx.next.z = ctx.pos.z; ctx.stopCar()
        offRoadHold += ctx.step
        const now = typeof performance !== 'undefined' ? performance.now() : 0
        if (offRoadHold >= .3 && now - lastToastAt > 3600 && typeof window !== 'undefined') {
          lastToastAt = now
          window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text: '前方为步行区或非机动车道，机动车禁行', ms: 2200}}))
        }
        return {blocked: true, reason: 'off-road', speed: 0}
      }

      onMotor = false
      return {blocked: false, reason: '', speed: ctx.dampCar(ctx.step)}
    },
  }
}

/** Smooth 0.28s door-entry duck-in transition, hidden in-cabin seated state, 0.20s step-out stand-up, and +4.2m camera arm. */
export function createDriverPose(figure: T.Group) {
  const startPos = new T.Vector3(), dismountFrom = new T.Vector3()
  const joints = getAvatarJoints(figure)
  const clearJoints = () => {
    clearAvatarPose(figure)
  }
  const applyDuck = (weight: number) => {
    if (joints.Torso) joints.Torso.rotation.set(-0.34 * weight, 0, 0)
    if (joints.Head) joints.Head.rotation.set(0.18 * weight, 0, 0)
    if (joints.ThighL) joints.ThighL.rotation.set(0.62 * weight, 0, 0)
    if (joints.ThighR) joints.ThighR.rotation.set(0.55 * weight, 0, 0)
    if (joints.ShinL) joints.ShinL.rotation.set(-0.72 * weight, 0, 0)
    if (joints.ShinR) joints.ShinR.rotation.set(-0.65 * weight, 0, 0)
    if (joints.ArmL) joints.ArmL.rotation.set(0.42 * weight, 0, 0)
    if (joints.ArmR) joints.ArmR.rotation.set(0.42 * weight, 0, 0)
  }
  let startYaw = 0, dismountFromYaw = 0
  let mountElapsed = ccfg.mountDuration, dismountElapsed = ccfg.dismountDuration, camArmOffset = 0

  return {
    get mounted() { return mountElapsed >= ccfg.mountDuration },
    startMount(footPos: {x:number; y:number; z:number}, yaw: number) {
      startPos.set(footPos.x, footPos.y, footPos.z)
      startYaw = yaw
      mountElapsed = 0
      dismountElapsed = ccfg.dismountDuration
    },
    startDismount(carPos: T.Vector3, carHeading: number, active: boolean) {
      const rx = Math.cos(carHeading), rz = -Math.sin(carHeading)
      const fx = -Math.sin(carHeading), fz = -Math.cos(carHeading)
      dismountFrom.set(carPos.x - rx * .85 + fx * .15, carPos.y, carPos.z - rz * .85 + fz * .15)
      dismountFromYaw = carHeading
      dismountElapsed = 0
      mountElapsed = ccfg.mountDuration
      figure.visible = active
      figure.rotation.x = figure.rotation.z = 0
      applyDuck(0.85)
    },
    reset(active = false) {
      mountElapsed = ccfg.mountDuration
      dismountElapsed = ccfg.dismountDuration
      camArmOffset = 0
      figure.visible = active
      figure.rotation.x = figure.rotation.z = 0
      clearJoints()
    },
    advanceMount(dt: number) {
      if (mountElapsed < ccfg.mountDuration) mountElapsed = Math.min(ccfg.mountDuration, mountElapsed + Math.max(0, dt))
    },
    cameraArm(driving: boolean, dt: number, snap: boolean) {
      const target = driving ? ccfg.cameraArmOffset : 0
      if (snap && dt <= 0) camArmOffset = target
      else camArmOffset = T.MathUtils.damp(camArmOffset, target, driving ? 10 : 9, Math.min(.12, Math.max(0, dt)))
      return camArmOffset
    },
    updateDriving(carPos: T.Vector3, heading: number, active: boolean) {
      const rawT = T.MathUtils.clamp(mountElapsed / ccfg.mountDuration, 0, 1)
      const t = smoothstep(rawT)
      const rx = Math.cos(heading), rz = -Math.sin(heading)
      const fx = -Math.sin(heading), fz = -Math.cos(heading)
      const doorOuterX = carPos.x - rx * .92 + fx * .12
      const doorOuterZ = carPos.z - rz * .92 + fz * .12
      const cabinX = carPos.x - rx * .36 + fx * .10
      const cabinZ = carPos.z - rz * .36 + fz * .10
      if (rawT < 1) {
        figure.visible = active
        if (rawT < .52) {
          const p = smoothstep(rawT / .52)
          figure.position.set(
            T.MathUtils.lerp(startPos.x, doorOuterX, p),
            T.MathUtils.lerp(startPos.y, carPos.y, p) + Math.sin(p * Math.PI) * .06,
            T.MathUtils.lerp(startPos.z, doorOuterZ, p),
          )
          applyDuck(p * .28)
        } else {
          const p = smoothstep((rawT - .52) / .48)
          figure.position.set(
            T.MathUtils.lerp(doorOuterX, cabinX, p),
            carPos.y - p * .14,
            T.MathUtils.lerp(doorOuterZ, cabinZ, p),
          )
          applyDuck(.28 + p * .72)
        }
        figure.rotation.set(0, startYaw + shortestAngle(startYaw, heading) * t, 0, 'YXZ')
      } else {
        clearJoints()
        figure.visible = false
        figure.position.copy(carPos)
        figure.rotation.set(0, heading, 0, 'YXZ')
      }
    },
    applyDismount(currentFootPos: T.Vector3, targetYaw: number, dt: number): boolean {
      if (dismountElapsed >= ccfg.dismountDuration) return false
      if (dt > 0) dismountElapsed = Math.min(ccfg.dismountDuration, dismountElapsed + Math.min(.12, dt))
      const t = smoothstep(dismountElapsed / ccfg.dismountDuration)
      figure.position.lerpVectors(dismountFrom, currentFootPos, t)
      figure.position.y += Math.sin(t * Math.PI) * .08 - (1 - t) * .10
      figure.rotation.y = dismountFromYaw + shortestAngle(dismountFromYaw, targetYaw) * t
      if (t >= 1) {
        clearJoints()
        return true
      } else applyDuck((1 - t) * .85)
      return false
    },
  }
}
