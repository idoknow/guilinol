import {DRONE_IDS, type DroneId} from './specs'

// IDOK-529: the hangar remembers what happened to each airframe — how much battery is left and
// whether it came home bent. One localStorage blob keeps the fleet the way the pilot left it, so a
// reload does not silently hand everyone a fresh 100% battery.
export type DamageCause = '撞击' | '淋雨' | '落水'

export interface DamageRecord {
  cause:DamageCause
  /** Where the wreck came down, so 「寻找无人机」 can walk the pilot back to it. */
  x:number
  y:number
  z:number
  since:number
}

export interface CraftState {
  battery:number
  /** Parked aircraft trickle back up; the one in the air does not. */
  charging:boolean
  damage:DamageRecord|null
  /**
   * IDOK-530: 机身完整度 0..100，撞击按力度扣分，进水量满了一并扣到底；
   * 跌破 DAMAGE_INTEGRITY 才算「损坏」，在此之前只是越来越难飞（也会在遥控里显示）。
   */
  integrity:number
}

/** 完整度低于这个值就是「损坏」，得走近维修。 */
export const DAMAGE_INTEGRITY = 20

/** Minutes of wall clock for a flat battery to come back — the hangar is a slow charger. */
const CHARGE_SECONDS = 90
const KEY = 'glol.drone-health'

const states = new Map<DroneId,CraftState>()

function blank():CraftState {
  return {battery:100,charging:true,damage:null,integrity:100}
}

function load() {
  for (const id of DRONE_IDS) states.set(id,blank())
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as Partial<Record<DroneId,Partial<CraftState>>>
    for (const id of DRONE_IDS) {
      const entry = saved[id]
      if (!entry) continue
      const state = states.get(id)!
      if (Number.isFinite(entry.battery)) state.battery = clampBattery(entry.battery as number)
      if (Number.isFinite(entry.integrity)) state.integrity = clampBattery(entry.integrity as number)
      state.charging = entry.charging !== false
      const damage = entry.damage
      if (damage && typeof damage.cause === 'string' && Number.isFinite(damage.x)) {
        state.damage = {
          cause:damage.cause as DamageCause,
          x:damage.x as number,y:damage.y as number,z:damage.z as number,
          since:Number.isFinite(damage.since) ? damage.since as number : Date.now(),
        }
      }
    }
  } catch { /* a corrupt blob is not worth keeping a pilot out of the sky */ }
}
load()

function clampBattery(value:number) {
  return Math.max(0,Math.min(100,value))
}

let dirty = false
let savedAt = 0

function flush() {
  if (!dirty) return
  dirty = false
  savedAt = performance.now()
  const out:Record<string,CraftState> = {}
  for (const [id,state] of states) out[id] = state
  try { localStorage.setItem(KEY,JSON.stringify(out)) } catch { /* private mode keeps it in memory */ }
}

export function stateOf(id:DroneId):CraftState {
  let state = states.get(id)
  if (!state) { state = blank(); states.set(id,state) }
  return state
}

export function batteryOf(id:DroneId):number {
  return stateOf(id).battery
}

export function damageOf(id:DroneId):DamageRecord|null {
  return stateOf(id).damage
}

export function integrityOf(id:DroneId):number {
  return stateOf(id).integrity
}

/**
 * IDOK-530: 撞击/进水扣完整度。伤害不直接等于损坏 —— 只是把机身越弄越脆，
 * 跌破 DAMAGE_INTEGRITY 才由调用方判定为损坏。返回扣完之后的完整度。
 */
export function addWear(id:DroneId, amount:number):number {
  const state = stateOf(id)
  if (amount <= 0) return state.integrity
  state.integrity = clampBattery(state.integrity - amount)
  dirty = true
  return state.integrity
}

export function setIntegrity(id:DroneId, value:number) {
  const state = stateOf(id)
  state.integrity = clampBattery(value)
  dirty = true
}

/** Ground the aircraft: battery drain, damage and parking all go through here. */
export function setBattery(id:DroneId, battery:number, charging:boolean) {
  const state = stateOf(id)
  const next = clampBattery(battery)
  if (Math.abs(state.battery - next) < .05 && state.charging === charging) return
  state.battery = next
  state.charging = charging
  dirty = true
}

export function raiseDamage(id:DroneId, cause:DamageCause, at:{x:number;y:number;z:number}) {
  const state = stateOf(id)
  if (state.damage) return state.damage
  state.damage = {cause,x:at.x,y:at.y,z:at.z,since:Date.now()}
  state.charging = false
  dirty = true
  flush()
  return state.damage
}

export function clearDamage(id:DroneId, battery?:number) {
  const state = stateOf(id)
  state.damage = null
  // IDOK-530: 修好就是修好 —— 扳手走完 30 秒，机身完整度一起补满。
  state.integrity = 100
  if (battery !== undefined) state.battery = clampBattery(battery)
  state.charging = true
  dirty = true
  flush()
}

/** Parked aircraft creep back to 100%; called from the drone rig every frame. */
export function chargeFleet(dt:number) {
  const gain = (100 / CHARGE_SECONDS) * dt
  let changed = false
  for (const id of DRONE_IDS) {
    const state = stateOf(id)
    if (!state.charging || state.damage) continue
    if (state.battery >= 100) continue
    state.battery = clampBattery(state.battery + gain)
    changed = true
    dirty = true
  }
  if (changed && performance.now() - savedAt > 2500) flush()
  return changed
}

export function healthSnapshot():Record<string,CraftState> {
  const out:Record<string,CraftState> = {}
  for (const [id,state] of states) out[id] = {...state}
  return out
}

/** Test hook: hand the whole fleet back with full batteries and no dents. */
export function resetHealth() {
  for (const id of DRONE_IDS) states.set(id,blank())
  dirty = true
  flush()
}
