import * as THREE from 'three'
import {drainPerSecond, speedLimit, type DroneSpec} from './specs'

// IDOK-215: a spec-driven arcade flight model. Every clamp below comes from the aircraft's sheet
// (web/src/drone/specs.ts) so a Mini 5 Pro really does feel tamer than an FPV racer.
export type Phase = 'landed' | 'takeoff' | 'flying' | 'returning' | 'landing'

export interface Sticks { throttle:number; yaw:number; pitch:number; roll:number }

export const CENTER:Sticks = {throttle:0,yaw:0,pitch:0,roll:0}

export interface Flight {
  spec:DroneSpec
  pos:THREE.Vector3
  vel:THREE.Vector3
  home:THREE.Vector3
  yaw:number
  gimbal:number
  battery:number
  phase:Phase
  /** Payload in grams, only meaningful for the FlyCart. */
  load:number
  signal:number
  /** Seconds the link has been below 4%, for the "lost link" auto-return. */
  lostFor:number
  elapsed:number
  /** Metres above the ground under the aircraft; fed in by the rig each frame. */
  agl:number
  maxAgl:number
  landing:number
}

/** DJI caps manual flight at 500 m above the takeoff point; so do we. */
export const MAX_AGL = 500

export function createFlight(spec:DroneSpec, at:THREE.Vector3, yaw = 0):Flight {
  return {
    spec, pos:at.clone(), vel:new THREE.Vector3(), home:at.clone(), yaw,
    gimbal:-12, battery:100, phase:'landed', load:0, signal:1, lostFor:0, elapsed:0, agl:0, maxAgl:0, landing:0,
  }
}

export function liftOff(flight:Flight) {
  if (flight.phase !== 'landed') return
  flight.phase = 'takeoff'
  flight.velocityBoost = 2.2
}

declare module './flight' {}
export interface Flight { velocityBoost?:number }

export function requestHome(flight:Flight) {
  if (flight.phase === 'landed' || flight.phase === 'landing') return
  flight.phase = 'returning'
}

export function landNow(flight:Flight) {
  if (flight.phase === 'landed' || flight.phase === 'landing') return
  flight.phase = 'landing'
}

export function speedNow(flight:Flight) {
  return Math.hypot(flight.vel.x,flight.vel.z)
}

export function batteryMinutes(flight:Flight) {
  const drain = drainPerSecond(flight.spec,flight.load)
  return flight.battery / drain / 60
}

/**
 * Advance the aircraft. `groundAt` returns terrain height under a world x/z; the rig passes the
 * play layer's ground ray so the drone lands on roofs and hills, not at y=0.
 */
export function stepFlight(flight:Flight, dt:number, sticks:Sticks, groundAt:(x:number,z:number)=>number) {
  const spec = flight.spec
  const limit = speedLimit(spec,flight.load)
  const groundY = groundAt(flight.pos.x,flight.pos.z)
  const half = spec.height * .5
  flight.elapsed += dt

  // Battery first: it decides the phase later on.
  const loadFactor = 1 + Math.min(1.4,(flight.load / Math.max(1,spec.payloadG ?? spec.weightG)) * .9)
  const drain = drainPerSecond(spec,flight.load) * loadFactor * (flight.phase === 'landed' ? .06 : 1)
  flight.battery = Math.max(0, flight.battery - drain * dt)

  if (flight.phase === 'landed') {
    flight.pos.y = groundY + half + Math.max(0,spec.height * .3)
    flight.vel.set(0,0,0)
    flight.agl = 0
    flight.yaw -= THREE.MathUtils.degToRad(40) * sticks.yaw * dt
    flight.gimbal = THREE.MathUtils.clamp(flight.gimbal + sticks.pitch * -10 * dt, spec.gimbal.tiltMin, spec.gimbal.tiltMax)
    return flight
  }

  // Takeoff: climb straight up at the published ascent rate before handing over to the sticks.
  if (flight.phase === 'takeoff') {
    flight.vel.set(0,spec.ascent * .55,0)
    flight.pos.addScaledVector(flight.vel,dt)
    flight.agl = flight.pos.y - half - groundY
    if (flight.agl > 1.4) { flight.phase = 'flying'; flight.velocityBoost = undefined }
    else if (flight.agl > .2) flight.velocityBoost = 2
    return flight
  }

  const ctrl = flight.phase === 'returning' ? homeSticks(flight,groundY) : sticks
  const speed = Math.min(limit, Math.hypot(ctrl.pitch,ctrl.roll) * limit)

  // Horizontal: velocity chases the stick vector in the aircraft's own frame.
  const fwd = new THREE.Vector3(-Math.sin(flight.yaw),0,-Math.cos(flight.yaw))
  const right = new THREE.Vector3(Math.cos(flight.yaw),0,-Math.sin(flight.yaw))
  const want = new THREE.Vector3()
  want.addScaledVector(fwd,ctrl.pitch * limit)
  want.addScaledVector(right,ctrl.roll * limit)
  if (flight.phase === 'landing' || flight.phase === 'returning') want.multiplyScalar(flight.phase === 'landing' ? .25 : .8)
  if (speed === 0) want.set(0,0,0)
  const accel = 3.2 + (spec.payloadG ? 0 : 1.6)
  flight.vel.x += (want.x - flight.vel.x) * Math.min(1, accel * dt)
  flight.vel.z += (want.z - flight.vel.z) * Math.min(1, accel * dt)

  // Vertical: left stick. Braking/landing overrides it.
  let climbTarget = ctrl.throttle > 0 ? ctrl.throttle * spec.ascent : ctrl.throttle * spec.descent
  if (flight.phase === 'landing') climbTarget = -Math.min(spec.descent, 1.6)
  flight.vel.y += (climbTarget - flight.vel.y) * Math.min(1, 4 * dt)

  // Stick right (+1) turns clockwise seen from above, i.e. towards decreasing yaw.
  flight.yaw -= THREE.MathUtils.degToRad(90) * ctrl.yaw * dt

  // Wind: published resistance is the point where the aircraft holds position, so drift is gentle.
  const wind = Math.sin(flight.elapsed * .21) * spec.wind * .06
  flight.pos.x += wind * dt
  flight.pos.addScaledVector(flight.vel,dt)

  // Ceiling: 500 m above the takeoff point, and never below the terrain.
  const maxY = flight.home.y + MAX_AGL
  if (flight.pos.y > maxY) { flight.pos.y = maxY; flight.vel.y = Math.min(0,flight.vel.y) }
  const floor = groundY + half
  if (flight.pos.y <= floor) {
    flight.pos.y = floor
    if (flight.phase === 'landing' && Math.abs(flight.vel.y) < 1.4) {
      flight.phase = 'landed'
      flight.vel.set(0,0,0)
    }
    flight.vel.y = Math.max(0,flight.vel.y)
  }
  flight.agl = Math.max(0, flight.pos.y - half - groundY)
  flight.maxAgl = Math.max(flight.maxAgl, flight.agl)

  // Link quality falls off with range; below 4% for three seconds the aircraft brings itself home.
  const range = flight.pos.distanceTo(flight.home)
  const link = Math.max(0, 1 - range / (spec.transmitKm * 1000 * .45))
  flight.signal = Math.max(flight.signal * .985, link)
  flight.lostFor = flight.signal < .04 ? flight.lostFor + dt : 0
  if (flight.lostFor > 3 && flight.phase === 'flying') flight.phase = 'returning'

  // Auto-return on low battery, like DJI's smart return.
  if (flight.phase === 'flying' && flight.battery < 18) flight.phase = 'returning'
  return flight
}

/** Height (metres above the ground under the aircraft) the aircraft cruises home at. */
export const RTH_CRUISE_AGL = 25

function homeSticks(flight:Flight, groundY:number):Sticks {
  const toHome = flight.home.clone().sub(flight.pos)
  const dist = Math.hypot(toHome.x,toHome.z)
  if (dist < 1.2 && flight.agl < 1.5) {
    flight.phase = 'landing'
    return {throttle:-1,yaw:0,pitch:0,roll:0}
  }
  const wantYaw = Math.atan2(-toHome.x,-toHome.z)
  const delta = Math.atan2(Math.sin(wantYaw - flight.yaw),Math.cos(wantYaw - flight.yaw))
  // IDOK-529: the old line kept feeding +0.35 throttle for as long as the aircraft was high, so a
  // return trip climbed until it hit the 500 m ceiling and never came down. Fly a fixed cruise
  // altitude instead, then drop straight onto the pad once it is overhead.
  const ceilingAgl = Math.max(RTH_CRUISE_AGL, flight.home.y - groundY + RTH_CRUISE_AGL)
  let throttle = 0
  if (dist < 8) throttle = flight.agl > 3 ? -.5 : -.35
  else if (flight.agl > ceilingAgl + 3) throttle = -.3
  else if (flight.agl < ceilingAgl - 2) throttle = .32
  return {throttle, yaw:THREE.MathUtils.clamp(-delta * 1.6,-1,1), pitch:dist > 4 ? .6 : .25, roll:0}
}

/** Camera pose for the RC view: lens position + gimbal attitude. */
export function lensPose(flight:Flight, out:{pos:THREE.Vector3, yaw:number, pitch:number}) {
  const spec = flight.spec
  const forward = new THREE.Vector3(-Math.sin(flight.yaw),0,-Math.cos(flight.yaw))
  out.pos.copy(flight.pos).addScaledVector(forward,spec.span * .18).add(new THREE.Vector3(0,-spec.height * .35,0))
  out.yaw = flight.yaw
  out.pitch = THREE.MathUtils.degToRad(flight.gimbal)
  return out
}

export type Telemetry = ReturnType<typeof telemetry>

export function telemetry(flight:Flight) {
  const speed = speedNow(flight)
  return {
    phase:flight.phase,
    agl:+flight.agl.toFixed(1),
    altitude:+flight.pos.y.toFixed(1),
    distance:+Math.hypot(flight.pos.x-flight.home.x,flight.pos.z-flight.home.z).toFixed(1),
    speed:+speed.toFixed(1),
    speedKmh:+(speed * 3.6).toFixed(0),
    vs:+flight.vel.y.toFixed(1),
    gimbal:+flight.gimbal.toFixed(0),
    yaw:+THREE.MathUtils.radToDeg(flight.yaw).toFixed(0),
    battery:+flight.battery.toFixed(1),
    signal:+(flight.signal * 100).toFixed(0),
    minutes:+batteryMinutes(flight).toFixed(1),
    load:flight.load / 1000,
    maxAgl:+flight.maxAgl.toFixed(1),
  }
}
