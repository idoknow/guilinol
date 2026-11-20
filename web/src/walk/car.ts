import R from '@dimforge/rapier3d-compat'
import * as T from 'three'
import {carConfig as ccfg, walkConfig as wcfg} from './config'
import type {DismountContext, MountCheckResult} from './ride'

type Kind = 'ground'|'overview'|'road'|'deck'|'deckThin'|'building'|'peak'|'tree'|'rail'|'sidewalk'|'landmark'

export interface CarMoveContext {
  pos: {x:number; y:number; z:number}
  next: {x:number; z:number}
  move: {x:number; z:number}
  heading: number
  speed: number
  step: number
  motorPavement: (x:number, z:number)=>boolean
  insideHouse: (x:number, z:number)=>boolean
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
  const deck = ctx.surface(x, z, 'deck', refY + .55, 1.8)
  const validDeck = deck && deck.y <= refY + .55 ? deck : null
  const lm = ctx.surface(x, z, 'landmark', refY + .55, 1.8)
  const validLm = lm && lm.y <= refY + .55 && lm.slope <= wcfg.slope ? lm : null
  const bridgeHit = validDeck && validLm ? (validLm.y > validDeck.y ? validLm : validDeck) : (validDeck ?? validLm)
  const support = bridgeHit ?? ctx.surface(x, z, 'road') ?? ctx.surface(x, z, 'sidewalk') ?? ctx.surface(x, z, 'ground')
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
    if (!tile || !ctx.stream.loaded.has(tile) || ctx.insideHouse(x, z)) continue
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
  if (!tile || !ctx.stream.loaded.has(tile) || ctx.insideHouse(cx, cz)) return {ok: false, reason: 'narrow'}
  const support = localSupport(ctx, cx, cz, cy)
  if (!support || Math.abs(support.y - cy) > .65) return {ok: false, reason: 'height'}
  return {ok: true, x: cx, y: support.y + wcfg.height / 2 + .055, z: cz, bikeY: support.y, shifted: false}
}

/** Kinematic bicycle-model car controller (40 km/h max, no zero-speed pivot spin, -12 km/h delayed reverse, motorway confinement). */
export function createCarControl() {
  let speed = 0, heading = 0, roll = 0, pitch = 0, steerInput = 0, revHold = 0
  let onMotor = false, offRoadHold = 0, lastToastAt = -1e9

  function reset() {
    speed = roll = pitch = steerInput = revHold = offRoadHold = 0
    onMotor = false
  }

  return {
    get speed() { return speed },
    get heading() { return heading },
    get roll() { return roll },
    get pitch() { return pitch },
    get steerInput() { return steerInput },
    mount(yaw: number, initialPitch = 0) {
      heading = yaw
      reset()
      pitch = initialPitch
    },
    stop() { speed = 0 },
    reset,
    dampSpeed(step: number) {
      speed *= Math.max(0, 1 - ccfg.slideDamp * step)
      return speed
    },
    steer(forward: number, right: number, dt: number, mounted = true) {
      const cdt = Math.min(.12, Math.max(0, dt))
      if (!mounted) {
        revHold = 0
        steerInput = T.MathUtils.damp(steerInput, 0, ccfg.steerDamp, cdt)
        roll = T.MathUtils.damp(roll, 0, ccfg.rollDamp, cdt)
        return 0
      }
      const uFwd = deadzone(T.MathUtils.clamp(forward, -1, 1), ccfg.stickDeadFwd)
      const uTurn = deadzone(T.MathUtils.clamp(right, -1, 1), ccfg.stickDeadTurn)
      steerInput = T.MathUtils.damp(steerInput, uTurn, ccfg.steerDamp, cdt)

      const uphillSin = Math.max(0, Math.sin(pitch) - .015)
      if (uFwd > .05) {
        revHold = 0
        if (speed < 0) {
          speed = Math.min(0, speed + ccfg.brake * uFwd * cdt)
        } else {
          const ratio = Math.max(0, speed) / ccfg.maxSpeed
          const drive = ccfg.accel * (1 - ccfg.torqueDecay * Math.pow(ratio, ccfg.torquePow)) * uFwd
          const gravLoss = uphillSin > 0 ? Math.min(drive * .45, 5.5 * uphillSin) : 0
          speed = Math.min(ccfg.maxSpeed, speed + (drive - gravLoss) * cdt)
        }
      } else if (uFwd < -.05) {
        if (speed > .05) {
          revHold = 0
          speed = Math.max(0, speed + ccfg.brake * uFwd * cdt)
        } else if (speed < -.01) {
          revHold = ccfg.revHold
          speed = T.MathUtils.clamp(speed + ccfg.revAccel * uFwd * cdt, ccfg.reverseMax, 0)
        } else {
          revHold += cdt
          if (revHold >= ccfg.revHold) {
            speed = T.MathUtils.clamp(speed + ccfg.revAccel * uFwd * cdt, ccfg.reverseMax, 0)
          } else {
            speed = 0
          }
        }
      } else {
        revHold = 0
        if (speed > 0) speed = Math.max(0, speed - (ccfg.rollDrag + ccfg.aeroDrag * speed + (uphillSin > 0 ? 4.5 * uphillSin : 0)) * cdt)
        else if (speed < 0) speed = Math.min(0, speed + (ccfg.rollDrag * 1.8 - ccfg.aeroDrag * speed) * cdt)
      }

      // Kinematic bicycle steering: zero pivot turn at standstill, R_min = wheelbase / tan(maxSteerAngle) ~ 4.85m.
      let omega = 0
      if (Math.abs(speed) > .015) {
        const spdRatio = Math.min(1, Math.abs(speed) / ccfg.maxSpeed)
        const effSteer = ccfg.maxSteerAngle / (1 + ccfg.speedSteer * spdRatio * spdRatio)
        omega = (speed / ccfg.wheelbase) * Math.tan(steerInput * effSteer)
        heading -= omega * cdt
      }

      // Subtle outward centrifugal body roll (opposite to 2-wheel lean).
      const latAccel = speed * omega
      const targetRoll = T.MathUtils.clamp((latAccel / 8.5) * ccfg.bodyRollMax, -ccfg.bodyRollMax, ccfg.bodyRollMax)
      roll = T.MathUtils.damp(roll, targetRoll, ccfg.rollDamp, cdt)
      return speed
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

      if (Math.abs(ctx.speed) > 1e-4 && leadHouseHit(ctx.next.x, ctx.next.z)) {
        ctx.next.x = ctx.pos.x; ctx.next.z = ctx.pos.z; ctx.stopCar()
        return {blocked: true, reason: 'building', speed: 0}
      }

      if (Math.abs(ctx.speed) > 1e-4 && ctx.carBlockedAt(ctx.next.x, footY, ctx.next.z, ctx.heading, sign)) {
        const hit = ctx.collisionKind(fwdX * sign, fwdZ * sign) || (leadHouseHit(ctx.next.x + fwdX * sign * .3, ctx.next.z + fwdZ * sign * .3) ? 'building' : 'collision')
        ctx.next.x = ctx.pos.x; ctx.next.z = ctx.pos.z; ctx.stopCar()
        return {blocked: true, reason: hit, speed: 0}
      }

      if (Math.hypot(ctx.move.x, ctx.move.z) < Math.abs(ctx.speed) * ctx.step * .35) {
        const hit = ctx.collisionKind(fwdX * sign, fwdZ * sign)
        if (hit) {
          ctx.next.x = ctx.pos.x; ctx.next.z = ctx.pos.z; ctx.stopCar()
          return {blocked: true, reason: hit, speed: 0}
        }
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

/** Smooth 0.24s door-entry transition, hidden in-cabin seated state, 0.20s step-out, and +4.2m camera arm. */
export function createDriverPose(figure: T.Group) {
  const startPos = new T.Vector3(), dismountFrom = new T.Vector3()
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
    },
    reset(active = false) {
      mountElapsed = ccfg.mountDuration
      dismountElapsed = ccfg.dismountDuration
      camArmOffset = 0
      figure.visible = active
      figure.rotation.x = figure.rotation.z = 0
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
      const t = smoothstep(mountElapsed / ccfg.mountDuration)
      const rx = Math.cos(heading), rz = -Math.sin(heading)
      const fx = -Math.sin(heading), fz = -Math.cos(heading)
      const doorX = carPos.x - rx * .55 + fx * .12
      const doorZ = carPos.z - rz * .55 + fz * .12
      if (t < 1) {
        figure.visible = active
        figure.position.set(
          T.MathUtils.lerp(startPos.x, doorX, t),
          T.MathUtils.lerp(startPos.y, carPos.y, t),
          T.MathUtils.lerp(startPos.z, doorZ, t),
        )
        figure.rotation.set(0, startYaw + shortestAngle(startYaw, heading) * t, 0, 'YXZ')
      } else {
        figure.visible = false
        figure.position.copy(carPos)
        figure.rotation.set(0, heading, 0, 'YXZ')
      }
    },
    applyDismount(currentFootPos: T.Vector3, targetYaw: number, dt: number) {
      if (dismountElapsed >= ccfg.dismountDuration) return
      if (dt > 0) dismountElapsed = Math.min(ccfg.dismountDuration, dismountElapsed + Math.min(.12, dt))
      const t = smoothstep(dismountElapsed / ccfg.dismountDuration)
      figure.position.lerpVectors(dismountFrom, currentFootPos, t)
      figure.position.y += Math.sin(t * Math.PI) * .08
      figure.rotation.y = dismountFromYaw + shortestAngle(dismountFromYaw, targetYaw) * t
    },
  }
}
