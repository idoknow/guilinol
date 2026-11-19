import R from '@dimforge/rapier3d-compat'
import * as T from 'three'
import type {Stream} from '../stream'
import type {Tile} from '../world'
import {bicycleConfig, bikeConfig as bcfg, walkConfig as wcfg} from './config'

export type RideKind = 'bike' | 'bicycle'
type Kind = 'ground'|'overview'|'deck'|'deckThin'|'building'|'peak'|'tree'|'rail'|'sidewalk'|'landmark'
type SurfaceHit = {y:number; slope:number} | null

export interface DismountContext {
  world: R.World
  capsule: R.Collider
  shape: R.Capsule
  kinds: Map<number, Kind>
  stream: Stream
  tileAt: (x:number, z:number)=>Tile|undefined
  surface: (x:number, z:number, kind:Kind, origin?:number, reach?:number)=>SurfaceHit
  wet: (x:number, z:number)=>boolean
  insideHouse: (x:number, z:number)=>boolean
}

export interface BikeMoveContext {
  pos: {x:number; y:number; z:number}
  next: {x:number; z:number}
  move: {x:number; z:number}
  heading: number
  speed: number
  step: number
  pavement: (x:number, z:number)=>boolean
  insideHouse: (x:number, z:number)=>boolean
  blockedAt: (x:number, y:number, z:number)=>boolean
  collisionKind: (dirX:number, dirZ:number)=>'building'|'collision'|''
  stopBike: ()=>void
  dampBike: (step:number)=>number
  capOffRoad: (step:number, limit:number)=>number
}

export type MountCheckResult =
  | {ok: true; x: number; y: number; z: number; bikeY: number; shifted: boolean}
  | {ok: false; reason: 'height'|'blocked'|'narrow'}

const IDENTITY = {x:0, y:0, z:0, w:1}
const OFF_ROAD_CAP = 4.2
const MOUNT_OFFSETS: readonly [number, number][] = [
  [.45, 0], [-.45, 0], [0, .45], [0, -.45],
  [.35, .35], [-.35, .35], [.35, -.35], [-.35, -.35],
  [.85, 0], [-.85, 0], [0, .85], [0, -.85],
  [.6, .6], [-.6, .6], [.6, -.6], [-.6, -.6],
]
const DISMOUNT_OFFSETS: readonly [number, number][] = [
  [-1.05, -.2],
  [1.05, -.2],
  [0, -1.45],
  [-1.15, .6],
  [1.15, .6],
  [0, 1.55],
  [0, 0],
]
const JOINT_NAMES = ['ThighL', 'ThighR', 'ShinL', 'ShinR', 'ArmL', 'ArmR', 'ForearmL', 'ForearmR', 'Torso', 'Head'] as const
type JointName = (typeof JOINT_NAMES)[number]

let wallRay: R.Ray | undefined

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

function turnRate(speed: number, spec = bcfg) {
  const s = T.MathUtils.clamp(Math.abs(speed) / spec.maxSpeed, 0, 1)
  if (s <= .4) return T.MathUtils.lerp(spec.pivotTurn, spec.peakTurn, smoothstep(s / .4))
  return T.MathUtils.lerp(spec.peakTurn, spec.topTurn, smoothstep((s - .4) / .6))
}

/** Shows non-intrusive toast when mounting/dismounting a bike is blocked by walls or narrow obstacles. */
export function notifyDismountBlocked(message = '这里太窄了，挪一挪再下车') {
  window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text: message, ms: 2400}}))
}

function isWallBlocker(kind: Kind | undefined) {
  return kind === 'building' || kind === 'rail' || kind === 'peak' || kind === 'landmark' || kind === 'tree' || kind === 'deck' || kind === 'deckThin'
}

function localSupport(ctx: DismountContext, x: number, z: number, refY: number) {
  const deck = ctx.surface(x, z, 'deck', refY + .35, 1.4)
  const validDeck = deck && deck.y <= refY + .35 ? deck : null
  const support = validDeck ?? ctx.surface(x, z, 'sidewalk') ?? ctx.surface(x, z, 'ground')
  if (!support || support.slope > wcfg.slope || (!validDeck && ctx.wet(x, z))) return null
  const peak = ctx.surface(x, z, 'peak')
  if (peak && peak.y > support.y + .05) return null
  return support
}

function segmentBlocked(ctx: DismountContext, x0: number, z0: number, x1: number, z1: number, baseY: number, trimEnd = 0) {
  const dx = x1 - x0, dz = z1 - z0, dist = Math.hypot(dx, dz)
  const len = dist - trimEnd
  if (len <= .05) return false
  wallRay ??= new R.Ray({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: -1})
  wallRay.dir.x = dx / dist; wallRay.dir.y = 0; wallRay.dir.z = dz / dist
  for (const offset of [.5, 1.25]) {
    wallRay.origin.x = x0; wallRay.origin.y = baseY + offset; wallRay.origin.z = z0
    if (ctx.world.castRay(wallRay, len, true, undefined, undefined, ctx.capsule, undefined, coll => isWallBlocker(ctx.kinds.get(coll.handle)))) {
      return true
    }
  }
  return false
}

function standClear(ctx: DismountContext, x: number, y: number, z: number) {
  return !ctx.world.intersectionWithShape({x, y, z}, IDENTITY, ctx.shape, undefined, undefined, ctx.capsule)
}

/** Probes 7 local spots beside the parked bike with height-diff, horizontal dual-ray LOS, and capsule checks. */
export function probeLocalDismount(ctx: DismountContext, cx: number, cz: number, heading: number, bikeY: number) {
  const fx = -Math.sin(heading), fz = -Math.cos(heading)
  const rx = Math.cos(heading), rz = -Math.sin(heading)
  for (let i = 0; i < DISMOUNT_OFFSETS.length; i++) {
    const [side, fwd] = DISMOUNT_OFFSETS[i]
    const dx = side * rx + fwd * fx, dz = side * rz + fwd * fz
    const x = cx + dx, z = cz + dz
    const tile = ctx.tileAt(x, z)
    if (!tile || !ctx.stream.loaded.has(tile) || ctx.insideHouse(x, z)) continue
    const support = localSupport(ctx, x, z, bikeY)
    if (!support || Math.abs(support.y - bikeY) > .85) continue
    if (segmentBlocked(ctx, cx, cz, x, z, Math.max(bikeY, support.y))) continue
    const y = support.y + wcfg.height / 2 + .055
    if (!standClear(ctx, x, y, z)) continue
    return {x, y, z, rule: i === DISMOUNT_OFFSETS.length - 1 ? 'local-origin' : `local-${i}`}
  }
  return null
}

/** Validates Y elevation gap, wall/rail LOS between player and bike, and capsule clearance before mounting. */
export function probeLocalMount(ctx: DismountContext, px: number, py: number, pz: number, bx: number, by: number, bz: number): MountCheckResult {
  if (Math.abs(by - py) > 1.5) return {ok: false, reason: 'height'}
  if (segmentBlocked(ctx, px, pz, bx, bz, Math.max(py, by))) return {ok: false, reason: 'blocked'}

  const tryPlace = (x: number, z: number, shifted: boolean): MountCheckResult | null => {
    const tile = ctx.tileAt(x, z)
    if (!tile || !ctx.stream.loaded.has(tile) || ctx.insideHouse(x, z)) return null
    const support = localSupport(ctx, x, z, by)
    if (!support || Math.abs(support.y - by) > .55) return null
    if (shifted && (
      segmentBlocked(ctx, px, pz, x, z, Math.max(py, support.y))
      || segmentBlocked(ctx, bx, bz, x, z, Math.max(by, support.y))
    )) return null
    const y = support.y + wcfg.height / 2 + .055
    if (!standClear(ctx, x, y, z)) return null
    return {ok: true, x, y, z, bikeY: support.y, shifted}
  }

  const direct = tryPlace(bx, bz, false)
  if (direct) return direct
  for (const [ox, oz] of MOUNT_OFFSETS) {
    const res = tryPlace(bx + ox, bz + oz, true)
    if (res) return res
  }
  return {ok: false, reason: 'narrow'}
}

/** Manages e-bike and pedal-bicycle acceleration, uphill drag, coasting, steering, and lean/pitch. */
export function createBikeControl() {
  let speed = 0, heading = 0, lean = 0, pitch = 0, steerInput = 0, revHold = 0
  let onPavement = false, kind: RideKind = 'bike'

  function spec() {
    return kind === 'bicycle' ? bicycleConfig : bcfg
  }

  function reset() {
    speed = lean = pitch = steerInput = revHold = 0
    onPavement = false
    kind = 'bike'
  }

  return {
    get kind() { return kind },
    get speed() { return speed },
    get heading() { return heading },
    get lean() { return lean },
    get pitch() { return pitch },
    get steerInput() { return steerInput },
    mount(yaw: number, initialPitch = 0, rideKind: RideKind = 'bike') {
      heading = yaw
      reset()
      kind = rideKind
      pitch = initialPitch
    },
    stop() { speed = 0 },
    reset,
    dampSpeed(step: number) {
      speed *= Math.max(0, 1 - spec().slideDamp * step)
      return speed
    },
    capSpeed(step: number, limit: number) {
      const abs = Math.abs(speed)
      if (abs > limit) speed = Math.sign(speed) * Math.max(limit, abs - 6.5 * step)
      return speed
    },
    steer(forward: number, right: number, dt: number, mounted = true) {
      const s = spec()
      const cdt = Math.min(.12, Math.max(0, dt))
      if (!mounted) {
        revHold = 0
        steerInput = T.MathUtils.damp(steerInput, 0, s.steerDamp, cdt)
        lean = T.MathUtils.damp(lean, 0, s.leanDamp, cdt)
        return speed
      }
      const uFwd = deadzone(T.MathUtils.clamp(forward, -1, 1), s.stickDeadFwd)
      const uTurn = deadzone(T.MathUtils.clamp(right, -1, 1), s.stickDeadTurn)
      steerInput = T.MathUtils.damp(steerInput, uTurn, s.steerDamp, cdt)
      const uphillSin = s.uphillDrag > 0 ? Math.max(0, Math.sin(pitch) - .012) : 0
      const effMax = uphillSin > 0 ? Math.max(2.1, s.maxSpeed * (1 - s.uphillCapScale * uphillSin)) : s.maxSpeed

      if (uFwd > .05) {
        revHold = 0
        if (speed < 0) speed = Math.min(0, speed + s.brake * uFwd * cdt)
        else {
          const ratio = Math.max(0, speed) / s.maxSpeed
          const rawDrive = s.accel * (1 - s.torqueDecay * Math.pow(ratio, s.torquePow)) * uFwd
          const slopeLoss = uphillSin > 0 ? Math.min(rawDrive * .68, s.uphillDrag * uphillSin) : 0
          const nextSpd = speed + (rawDrive - slopeLoss) * cdt
          speed = nextSpd <= effMax
            ? nextSpd
            : Math.max(effMax, speed - (s.rollDrag + s.uphillDrag * uphillSin) * cdt)
        }
      } else if (uFwd < -.05) {
        if (speed > .05) {
          revHold = 0
          speed = Math.max(0, speed + s.brake * uFwd * cdt)
        } else if (speed < -.01) {
          revHold = s.revHold
          speed = T.MathUtils.clamp(speed + s.revAccel * uFwd * cdt, s.reverseMax, 0)
        } else {
          revHold += cdt
          if (revHold >= s.revHold) speed = T.MathUtils.clamp(speed + s.revAccel * uFwd * cdt, s.reverseMax, 0)
          else speed = 0
        }
      } else {
        revHold = 0
        if (speed > 0) speed = Math.max(0, speed - (s.rollDrag + s.aeroDrag * speed + (uphillSin > 0 ? 9.8 * uphillSin : 0)) * cdt)
        else if (speed < 0) speed = Math.min(0, speed + (s.rollDrag * 1.8 - s.aeroDrag * speed) * cdt)
      }

      const omega = turnRate(speed, s)
      const dirSign = speed < -.05 ? -1 : 1
      heading -= steerInput * omega * dirSign * cdt

      const targetLean = speed > .4
        ? T.MathUtils.clamp(-steerInput * (speed / s.maxSpeed) * (omega / s.peakTurn) * s.leanMax, -s.leanMax, s.leanMax)
        : 0
      lean = T.MathUtils.damp(lean, targetLean, s.leanDamp, cdt)
      return speed
    },
    setPitch(frontY: number | undefined, backY: number | undefined, dt: number) {
      const s = spec()
      const target = frontY !== undefined && backY !== undefined && Math.abs(frontY - backY) < .45
        ? T.MathUtils.clamp(Math.atan2(frontY - backY, 1.1), -s.pitchMax, s.pitchMax)
        : 0
      pitch = T.MathUtils.damp(pitch, target, s.pitchDamp, Math.min(.12, Math.max(0, dt)))
    },
    resolveMove(ctx: BikeMoveContext) {
      const fwdX = -Math.sin(ctx.heading), fwdZ = -Math.cos(ctx.heading), sign = ctx.speed >= 0 ? 1 : -1
      const probeX = ctx.next.x + fwdX * sign * .72, probeZ = ctx.next.z + fwdZ * sign * .72
      if (Math.abs(ctx.speed) > 1e-4 && ctx.insideHouse(probeX, probeZ)) {
        ctx.next.x = ctx.pos.x; ctx.next.z = ctx.pos.z; ctx.stopBike()
        return {blocked: true, reason: 'building', speed: 0}
      }
      if (Math.hypot(ctx.move.x, ctx.move.z) < Math.abs(ctx.speed) * ctx.step * .35) {
        const hit = ctx.collisionKind(fwdX * sign, fwdZ * sign)
        if (hit) {
          ctx.next.x = ctx.pos.x; ctx.next.z = ctx.pos.z; ctx.stopBike()
          return {blocked: true, reason: hit, speed: 0}
        }
      }
      if (ctx.pavement(ctx.next.x, ctx.next.z)) {
        onPavement = true
        return {blocked: false, reason: '', speed: ctx.speed}
      }

      // Leaving pavement: glide along shallow road-edge angles; allow steep intentional exits off pavement.
      if (onPavement) {
        const mx = ctx.next.x - ctx.pos.x, mz = ctx.next.z - ctx.pos.z, mLen = Math.hypot(mx, mz)
        const safeAt = (sx: number, sz: number) =>
          ctx.pavement(sx, sz)
          && !ctx.insideHouse(sx + fwdX * sign * .72, sz + fwdZ * sign * .72)
          && !ctx.blockedAt(sx, ctx.pos.y, sz)

        const canX = mLen > 1e-6 && Math.abs(mx) >= mLen * .45 && safeAt(ctx.next.x, ctx.pos.z)
        const canZ = mLen > 1e-6 && Math.abs(mz) >= mLen * .45 && safeAt(ctx.pos.x, ctx.next.z)
        if (canX && (!canZ || Math.abs(mx) >= Math.abs(mz))) {
          ctx.next.z = ctx.pos.z
          return {blocked: false, reason: '', speed: ctx.dampBike(ctx.step * .5)}
        }
        if (canZ) {
          ctx.next.x = ctx.pos.x
          return {blocked: false, reason: '', speed: ctx.dampBike(ctx.step * .5)}
        }

        let inX = 0, inZ = 0
        for (const ox of [-4, 0, 4]) for (const oz of [-4, 0, 4]) {
          if ((ox || oz) && ctx.pavement(ctx.next.x + ox, ctx.next.z + oz)) {
            inX += ox; inZ += oz
          }
        }
        const inLen = Math.hypot(inX, inZ)
        if (inLen > 1e-4 && mLen > 1e-6) {
          const nx = inX / inLen, nz = inZ / inLen
          const outDot = mx * nx + mz * nz
          if (-outDot <= mLen * .82) {
            let tx = outDot < 0 ? mx - outDot * nx : mx
            let tz = outDot < 0 ? mz - outDot * nz : mz
            tx += nx * mLen * .35; tz += nz * mLen * .35
            const sx = ctx.pos.x + tx, sz = ctx.pos.z + tz
            if (safeAt(sx, sz)) {
              ctx.next.x = sx; ctx.next.z = sz
              return {blocked: false, reason: '', speed: ctx.dampBike(ctx.step * .5)}
            }
          }
        }
      }

      onPavement = false
      return {blocked: false, reason: '', speed: ctx.capOffRoad(ctx.step, spec().offRoadCap || OFF_ROAD_CAP)}
    },
  }
}

function solvePedalIK(phase: number): [number, number] {
  const dy = (.33 + .15 * Math.cos(phase)) - .88
  const dz = (.05 - .15 * Math.sin(phase)) - .23
  const d = T.MathUtils.clamp(Math.hypot(dy, dz), .24, .88)
  const alpha = Math.atan2(-dz, -dy)
  const L1 = .45, L2 = .45
  const cosKnee = T.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1)
  const beta = Math.acos(T.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1))
  return [alpha + beta, -(Math.PI - Math.acos(cosKnee))]
}

/** Handles smooth 0.18s mount, dynamic rider joint pose (static footboard on e-bike vs pedaling cycle on bicycle), and 0.15s step-off. */
export function createRiderPose(figure: T.Group) {
  const joints = Object.fromEntries(JOINT_NAMES.map(name => [name, figure.getObjectByName(name)])) as Record<JointName, T.Object3D | undefined>
  const startPos = new T.Vector3(), startRot = new Map<JointName, [number, number, number]>()
  const dismountFrom = new T.Vector3()
  let startYaw = 0, dismountFromYaw = 0, mountElapsed = bcfg.mountDuration, dismountElapsed = bcfg.dismountDuration, camArmOffset = 0
  let footWeight = 1, pedalPhase = 0

  function clearJoints() {
    for (const name of JOINT_NAMES) joints[name]?.rotation.set(0, 0, 0)
  }

  function applySeatedPose(speed: number, steerInput: number, blend: number, dt: number, kind: RideKind) {
    const cdt = Math.min(.12, Math.max(0, dt))
    const idleFoot = smoothstep((.35 - Math.abs(speed)) / .35)
    footWeight = T.MathUtils.damp(footWeight, idleFoot, 10, cdt)
    let targets: Record<JointName, [number, number, number]>
    if (kind === 'bicycle') {
      const spdRatio = Math.max(0, speed) / bicycleConfig.maxSpeed
      const [thighLPedal, shinLPedal] = solvePedalIK(pedalPhase)
      const [thighRPedal, shinRPedal] = solvePedalIK(pedalPhase + Math.PI)
      const cadenceSway = (1 - footWeight) * Math.sin(pedalPhase) * .035 * T.MathUtils.clamp(Math.abs(speed) / 2.5, 0, 1)
      targets = {
        ThighL: [T.MathUtils.lerp(thighLPedal, .52, footWeight), 0, T.MathUtils.lerp(0, -.20, footWeight)],
        ShinL: [T.MathUtils.lerp(shinLPedal, -.50, footWeight), 0, 0],
        ThighR: [thighRPedal, 0, 0],
        ShinR: [shinRPedal, 0, 0],
        ArmL: [.86 + steerInput * .14, -steerInput * .12, 0],
        ArmR: [.86 - steerInput * .14, -steerInput * .12, 0],
        ForearmL: [.32, 0, 0],
        ForearmR: [.32, 0, 0],
        Torso: [-.14 - spdRatio * .08, cadenceSway * .5, cadenceSway],
        Head: [.05, -steerInput * .18, 0],
      }
    } else {
      const spdRatio = Math.max(0, speed) / bcfg.maxSpeed
      targets = {
        ThighL: [T.MathUtils.lerp(1.25, .56, footWeight), 0, T.MathUtils.lerp(0, -.22, footWeight)],
        ShinL: [T.MathUtils.lerp(-1.4, -.55, footWeight), 0, 0],
        ThighR: [1.25, 0, 0],
        ShinR: [-1.4, 0, 0],
        ArmL: [.9 + steerInput * .14, -steerInput * .12, 0],
        ArmR: [.9 - steerInput * .14, -steerInput * .12, 0],
        ForearmL: [.35, 0, 0],
        ForearmR: [.35, 0, 0],
        Torso: [-.09 - spdRatio * .06, 0, 0],
        Head: [0, -steerInput * .18, 0],
      }
    }
    for (const name of JOINT_NAMES) {
      const joint = joints[name]
      if (!joint) continue
      const [tx, ty, tz] = targets[name]
      if (blend < 1) {
        const from = startRot.get(name) ?? [0, 0, 0]
        joint.rotation.set(
          T.MathUtils.lerp(from[0], tx, blend),
          T.MathUtils.lerp(from[1], ty, blend),
          T.MathUtils.lerp(from[2], tz, blend),
        )
      } else {
        joint.rotation.set(tx, ty, tz)
      }
    }
  }

  return {
    get mounted() { return mountElapsed >= bcfg.mountDuration },
    get pedalPhase() { return pedalPhase },
    startMount(footPos: {x:number; y:number; z:number}, yawYaw: number) {
      startPos.set(footPos.x, footPos.y, footPos.z)
      startYaw = yawYaw
      mountElapsed = 0
      dismountElapsed = bcfg.dismountDuration
      footWeight = 1
      pedalPhase = 0
      for (const name of JOINT_NAMES) {
        const r = joints[name]?.rotation
        startRot.set(name, r ? [r.x, r.y, r.z] : [0, 0, 0])
      }
    },
    startDismount(prevVisualPos: T.Vector3, prevVisualYaw: number) {
      dismountFrom.copy(prevVisualPos)
      dismountFromYaw = prevVisualYaw
      dismountElapsed = 0
      mountElapsed = bcfg.mountDuration
      figure.rotation.x = figure.rotation.z = 0
      clearJoints()
    },
    reset() {
      mountElapsed = bcfg.mountDuration
      dismountElapsed = bcfg.dismountDuration
      camArmOffset = 0
      pedalPhase = 0
      figure.rotation.x = figure.rotation.z = 0
      clearJoints()
    },
    advanceMount(dt: number) {
      if (mountElapsed < bcfg.mountDuration) mountElapsed = Math.min(bcfg.mountDuration, mountElapsed + Math.max(0, dt))
    },
    cameraArm(riding: boolean, dt: number, snap: boolean) {
      const target = riding ? 2.6 : 0
      if (snap && dt <= 0) camArmOffset = target
      else camArmOffset = T.MathUtils.damp(camArmOffset, target, riding ? 12 : 10, Math.min(.12, Math.max(0, dt)))
      return camArmOffset
    },
    updateRiding(bikePos: T.Vector3, heading: number, lean: number, pitch: number, speed: number, steerInput: number, dt: number, kind: RideKind = 'bike', bikeMesh?: T.Object3D | null) {
      const cdt = Math.min(.12, Math.max(0, dt))
      if (kind === 'bicycle') {
        pedalPhase = (pedalPhase + (speed / .33) * cdt * .48) % (Math.PI * 2)
        if (pedalPhase < 0) pedalPhase += Math.PI * 2
        const crank = bikeMesh?.getObjectByName('Crank')
        if (crank) crank.rotation.x = -pedalPhase
      }
      const t = smoothstep(mountElapsed / bcfg.mountDuration)
      const seatOffset = kind === 'bicycle' ? .22 : .23
      const seatLift = kind === 'bicycle' ? .035 : 0
      const seatX = bikePos.x + Math.sin(heading) * seatOffset
      const seatZ = bikePos.z + Math.cos(heading) * seatOffset
      const seatY = bikePos.y + seatLift
      if (t < 1) {
        figure.position.set(
          T.MathUtils.lerp(startPos.x, seatX, t),
          T.MathUtils.lerp(startPos.y, seatY, t),
          T.MathUtils.lerp(startPos.z, seatZ, t),
        )
        figure.rotation.set(0, startYaw + shortestAngle(startYaw, heading) * t, 0, 'YXZ')
      } else {
        figure.position.set(seatX, seatY, seatZ)
        figure.rotation.set(pitch * .45, heading, lean * .9, 'YXZ')
      }
      applySeatedPose(speed, steerInput, t, dt, kind)
    },
    applyDismount(currentFootPos: T.Vector3, targetYaw: number, dt: number) {
      if (dismountElapsed >= bcfg.dismountDuration) return
      if (dt > 0) dismountElapsed = Math.min(bcfg.dismountDuration, dismountElapsed + Math.min(.12, dt))
      const t = smoothstep(dismountElapsed / bcfg.dismountDuration)
      figure.position.lerpVectors(dismountFrom, currentFootPos, t)
      figure.position.y += Math.sin(t * Math.PI) * .12
      figure.rotation.y = dismountFromYaw + shortestAngle(dismountFromYaw, targetYaw) * t
    },
    clearJoints,
  }
}
