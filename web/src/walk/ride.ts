import R from '@dimforge/rapier3d-compat'
import * as T from 'three'
import type {Stream} from '../stream'
import type {Tile} from '../world'
import {bikeConfig as bcfg, walkConfig as wcfg} from './config'

type Kind = 'ground'|'overview'|'deck'|'building'|'peak'|'tree'|'rail'|'sidewalk'|'landmark'
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
  collisionKind: ()=>'building'|'collision'|''
  stopBike: ()=>void
  dampBike: (step:number)=>number
}

const IDENTITY = {x:0, y:0, z:0, w:1}
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

let toastTimer = 0
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

function turnRate(speed: number) {
  const s = T.MathUtils.clamp(Math.abs(speed) / bcfg.maxSpeed, 0, 1)
  if (s <= .4) return T.MathUtils.lerp(bcfg.pivotTurn, bcfg.peakTurn, smoothstep(s / .4))
  return T.MathUtils.lerp(bcfg.peakTurn, bcfg.topTurn, smoothstep((s - .4) / .6))
}

/** Shows non-intrusive toast when all local 7-point bike dismount spots are obstructed. */
export function notifyDismountBlocked() {
  const toast = document.querySelector<HTMLElement>('.toast')
  if (!toast) return
  toast.textContent = '这里太窄了，挪一挪再下车'
  toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2400)
}

/** Probes 7 local spots beside the parked bike with support, ray LOS, and capsule checks (never 64m teleport). */
export function probeLocalDismount(ctx: DismountContext, cx: number, cz: number, heading: number, bikeY: number) {
  const fx = -Math.sin(heading), fz = -Math.cos(heading)
  const rx = Math.cos(heading), rz = -Math.sin(heading)
  for (let i = 0; i < DISMOUNT_OFFSETS.length; i++) {
    const [side, fwd] = DISMOUNT_OFFSETS[i]
    const dx = side * rx + fwd * fx, dz = side * rz + fwd * fz
    const x = cx + dx, z = cz + dz
    const tile = ctx.tileAt(x, z)
    if (!tile || !ctx.stream.loaded.has(tile) || ctx.insideHouse(x, z)) continue
    const deck = ctx.surface(x, z, 'deck', bikeY + .75, 3.5)
    const support = deck ?? ctx.surface(x, z, 'sidewalk') ?? ctx.surface(x, z, 'ground')
    if (!support || support.slope > wcfg.slope || (!deck && ctx.wet(x, z))) continue
    const peak = ctx.surface(x, z, 'peak')
    if (peak && peak.y > support.y + .05) continue
    const ty = support.y - bikeY, len = Math.hypot(dx, ty, dz)
    if (len >= .05) {
      wallRay ??= new R.Ray({x:0, y:0, z:0}, {x:0, y:0, z:-1})
      wallRay.origin.x = cx; wallRay.origin.y = bikeY + .9; wallRay.origin.z = cz
      wallRay.dir.x = dx / len; wallRay.dir.y = ty / len; wallRay.dir.z = dz / len
      const blocker = ctx.world.castRay(wallRay, len, true, undefined, undefined, ctx.capsule, undefined, coll => {
        const kind = ctx.kinds.get(coll.handle)
        return kind === 'building' || kind === 'rail' || kind === 'peak' || kind === 'landmark'
      })
      if (blocker) continue
    }
    const y = support.y + wcfg.height / 2 + .055
    if (ctx.world.intersectionWithShape({x, y, z}, IDENTITY, ctx.shape, undefined, undefined, ctx.capsule)) continue
    return {x, y, z, rule: i === DISMOUNT_OFFSETS.length - 1 ? 'local-origin' : `local-${i}`}
  }
  return null
}

/** Manages e-bike acceleration, coasting drag, 0.22s reverse delay, speed-tuned steering, and lean/pitch. */
export function createBikeControl() {
  let speed = 0, heading = 0, lean = 0, pitch = 0, steerInput = 0, revHold = 0, offRoadSteps = 0
  let onPavement = false
  let offRoadOrigin: {x:number; z:number} | null = null

  function reset() {
    speed = lean = pitch = steerInput = revHold = offRoadSteps = 0
    onPavement = false
    offRoadOrigin = null
  }

  return {
    get speed() { return speed },
    get heading() { return heading },
    get lean() { return lean },
    get pitch() { return pitch },
    get steerInput() { return steerInput },
    mount(yaw: number) { heading = yaw; reset() },
    stop() { speed = 0 },
    reset,
    dampSpeed(step: number) {
      speed *= Math.max(0, 1 - bcfg.slideDamp * step)
      return speed
    },
    steer(forward: number, right: number, dt: number, mounted = true) {
      const cdt = Math.min(.12, Math.max(0, dt))
      if (!mounted) {
        revHold = 0
        steerInput = T.MathUtils.damp(steerInput, 0, bcfg.steerDamp, cdt)
        lean = T.MathUtils.damp(lean, 0, bcfg.leanDamp, cdt)
        return speed
      }
      const uFwd = deadzone(T.MathUtils.clamp(forward, -1, 1), bcfg.stickDeadFwd)
      const uTurn = deadzone(T.MathUtils.clamp(right, -1, 1), bcfg.stickDeadTurn)
      steerInput = T.MathUtils.damp(steerInput, uTurn, bcfg.steerDamp, cdt)

      if (uFwd > .05) {
        revHold = 0
        if (speed < 0) speed = Math.min(0, speed + bcfg.brake * uFwd * cdt)
        else {
          const ratio = Math.max(0, speed) / bcfg.maxSpeed
          const drive = bcfg.accel * (1 - bcfg.torqueDecay * Math.pow(ratio, bcfg.torquePow)) * uFwd
          speed = Math.min(bcfg.maxSpeed, speed + drive * cdt)
        }
      } else if (uFwd < -.05) {
        if (speed > .05) {
          revHold = 0
          speed = Math.max(0, speed + bcfg.brake * uFwd * cdt)
        } else if (speed < -.01) {
          revHold = bcfg.revHold
          speed = T.MathUtils.clamp(speed + bcfg.revAccel * uFwd * cdt, bcfg.reverseMax, 0)
        } else {
          revHold += cdt
          if (revHold >= bcfg.revHold) speed = T.MathUtils.clamp(speed + bcfg.revAccel * uFwd * cdt, bcfg.reverseMax, 0)
          else speed = 0
        }
      } else {
        revHold = 0
        if (speed > 0) speed = Math.max(0, speed - (bcfg.rollDrag + bcfg.aeroDrag * speed) * cdt)
        else if (speed < 0) speed = Math.min(0, speed + (bcfg.rollDrag * 1.8 - bcfg.aeroDrag * speed) * cdt)
      }

      const omega = turnRate(speed)
      const dirSign = speed < -.05 ? -1 : 1
      heading -= steerInput * omega * dirSign * cdt

      const targetLean = speed > .4
        ? T.MathUtils.clamp(-steerInput * (speed / bcfg.maxSpeed) * (omega / bcfg.peakTurn) * bcfg.leanMax, -bcfg.leanMax, bcfg.leanMax)
        : 0
      lean = T.MathUtils.damp(lean, targetLean, bcfg.leanDamp, cdt)
      return speed
    },
    setPitch(frontY: number | undefined, backY: number | undefined, dt: number) {
      const target = frontY !== undefined && backY !== undefined && Math.abs(frontY - backY) < .8
        ? T.MathUtils.clamp(Math.atan2(frontY - backY, 1.1), -bcfg.pitchMax, bcfg.pitchMax)
        : 0
      pitch = T.MathUtils.damp(pitch, target, bcfg.pitchDamp, Math.min(.12, Math.max(0, dt)))
    },
    resolveMove(ctx: BikeMoveContext) {
      const fwdX = -Math.sin(ctx.heading), fwdZ = -Math.cos(ctx.heading), sign = ctx.speed >= 0 ? 1 : -1
      const probeX = ctx.next.x + fwdX * sign * .72, probeZ = ctx.next.z + fwdZ * sign * .72
      if (ctx.insideHouse(probeX, probeZ)) {
        offRoadSteps = 0; ctx.next.x = ctx.pos.x; ctx.next.z = ctx.pos.z; ctx.stopBike()
        return {blocked: true, reason: 'building', speed: 0}
      }
      if (Math.hypot(ctx.move.x, ctx.move.z) < Math.abs(ctx.speed) * ctx.step * .35) {
        const hit = ctx.collisionKind()
        if (hit) {
          offRoadSteps = 0; ctx.next.x = ctx.pos.x; ctx.next.z = ctx.pos.z; ctx.stopBike()
          return {blocked: true, reason: hit, speed: 0}
        }
      }
      if (ctx.pavement(ctx.next.x, ctx.next.z)) {
        onPavement = true; offRoadOrigin = null; offRoadSteps = 0
        return {blocked: false, reason: '', speed: ctx.speed}
      }
      if (!onPavement && !ctx.pavement(ctx.pos.x, ctx.pos.z)) {
        offRoadOrigin ??= {x: ctx.pos.x, z: ctx.pos.z}
        const nextDist = Math.hypot(ctx.next.x - offRoadOrigin.x, ctx.next.z - offRoadOrigin.z)
        const curDist = Math.hypot(ctx.pos.x - offRoadOrigin.x, ctx.pos.z - offRoadOrigin.z)
        if (nextDist <= 6.5 || nextDist < curDist) {
          offRoadSteps = 0
          return {blocked: false, reason: '', speed: ctx.speed}
        }
      }
      const canX = ctx.next.x !== ctx.pos.x && ctx.pavement(ctx.next.x, ctx.pos.z)
        && !ctx.insideHouse(ctx.next.x + fwdX * sign * .72, ctx.pos.z + fwdZ * sign * .72)
      const canZ = ctx.next.z !== ctx.pos.z && ctx.pavement(ctx.pos.x, ctx.next.z)
        && !ctx.insideHouse(ctx.pos.x + fwdX * sign * .72, ctx.next.z + fwdZ * sign * .72)
      if (canX && (!canZ || Math.abs(ctx.next.x - ctx.pos.x) >= Math.abs(ctx.next.z - ctx.pos.z))) {
        ctx.next.z = ctx.pos.z; offRoadSteps = 0
        return {blocked: false, reason: '', speed: ctx.dampBike(ctx.step)}
      }
      if (canZ) {
        ctx.next.x = ctx.pos.x; offRoadSteps = 0
        return {blocked: false, reason: '', speed: ctx.dampBike(ctx.step)}
      }
      ctx.next.x = ctx.pos.x; ctx.next.z = ctx.pos.z
      if (++offRoadSteps >= 2) {
        ctx.stopBike()
        return {blocked: true, reason: 'off-road', speed: 0}
      }
      return {blocked: false, reason: '', speed: ctx.speed}
    },
  }
}

/** Handles smooth 0.18s mount, dynamic rider joint pose (lean/steer/kickstand foot), and 0.15s step-off. */
export function createRiderPose(figure: T.Group) {
  const joints = Object.fromEntries(JOINT_NAMES.map(name => [name, figure.getObjectByName(name)])) as Record<JointName, T.Object3D | undefined>
  const startPos = new T.Vector3(), startRot = new Map<JointName, [number, number, number]>()
  const stepOff = new T.Vector3()
  let startYaw = 0, mountElapsed = bcfg.mountDuration, dismountElapsed = bcfg.dismountDuration, camArmOffset = 0
  let footWeight = 1

  function clearJoints() {
    for (const name of JOINT_NAMES) joints[name]?.rotation.set(0, 0, 0)
  }

  function applySeatedPose(speed: number, steerInput: number, blend: number, dt: number) {
    const idleFoot = smoothstep((.35 - Math.abs(speed)) / .35)
    footWeight = T.MathUtils.damp(footWeight, idleFoot, 10, Math.min(.12, Math.max(0, dt)))
    const spdRatio = Math.max(0, speed) / bcfg.maxSpeed
    const targets: Record<JointName, [number, number, number]> = {
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
    startMount(footPos: {x:number; y:number; z:number}, yawYaw: number) {
      startPos.set(footPos.x, footPos.y, footPos.z)
      startYaw = yawYaw
      mountElapsed = 0
      dismountElapsed = bcfg.dismountDuration
      stepOff.set(0, 0, 0)
      footWeight = 1
      for (const name of JOINT_NAMES) {
        const r = joints[name]?.rotation
        startRot.set(name, r ? [r.x, r.y, r.z] : [0, 0, 0])
      }
    },
    startDismount(prevVisualPos: T.Vector3, landPos: {x:number; y:number; z:number}, landHeight: number) {
      stepOff.set(prevVisualPos.x - landPos.x, prevVisualPos.y - (landPos.y - landHeight / 2), prevVisualPos.z - landPos.z)
      dismountElapsed = 0
      mountElapsed = bcfg.mountDuration
      figure.rotation.x = figure.rotation.z = 0
      clearJoints()
    },
    reset() {
      mountElapsed = bcfg.mountDuration
      dismountElapsed = bcfg.dismountDuration
      stepOff.set(0, 0, 0)
      camArmOffset = 0
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
    updateRiding(bikePos: T.Vector3, heading: number, lean: number, pitch: number, speed: number, steerInput: number, dt: number) {
      const t = smoothstep(mountElapsed / bcfg.mountDuration)
      const seatX = bikePos.x + Math.sin(heading) * .23
      const seatZ = bikePos.z + Math.cos(heading) * .23
      if (t < 1) {
        figure.position.set(
          T.MathUtils.lerp(startPos.x, seatX, t),
          T.MathUtils.lerp(startPos.y, bikePos.y, t),
          T.MathUtils.lerp(startPos.z, seatZ, t),
        )
        figure.rotation.set(0, startYaw + shortestAngle(startYaw, heading) * t, 0, 'YXZ')
      } else {
        figure.position.set(seatX, bikePos.y, seatZ)
        figure.rotation.set(pitch * .45, heading, lean * .9, 'YXZ')
      }
      applySeatedPose(speed, steerInput, t, dt)
    },
    applyDismountOffset(dt: number) {
      if (dismountElapsed >= bcfg.dismountDuration) return
      dismountElapsed = Math.min(bcfg.dismountDuration, dismountElapsed + Math.max(0, dt))
      const remain = 1 - smoothstep(dismountElapsed / bcfg.dismountDuration)
      figure.position.addScaledVector(stepOff, remain)
    },
    clearJoints,
  }
}
