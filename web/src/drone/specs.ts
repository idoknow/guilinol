// IDOK-215: the fleet. Figures follow the maker's published spec sheets (S mode, sea level, no wind);
// where a number depends on battery or region we take the optimistic published one and say so in `notes`.
// IDOK-530: the fleet is down to two airframes — one FPV racer, one heavy lifter — and the brand is GLI.
export type DroneId = 'fpv' | 'flycart200'
export type RcUi = 'simple' | 'pro'

export interface DroneSpec {
  id:DroneId
  name:string
  short:string
  tagline:string
  maker:string
  weightG:number
  /** Payload capacity (FlyCart only). */
  payloadG?:number
  flightMin:number
  speed:number
  ascent:number
  descent:number
  /** Max takeoff altitude, metres. */
  ceiling:number
  /** Max wind resistance, m/s. */
  wind:number
  rangeKm:number
  transmitKm:number
  gimbal:{tiltMin:number; tiltMax:number}
  camera:{sensor:string; mp:number; lens:string; aperture?:string; zoom?:string}
  video:{res:string; fps:number}
  rc:RcUi
  /** Visual span (prop tip to prop tip) and body height, metres. */
  span:number
  height:number
  props:number
  color:{shell:string; accent:string; dark:string; metal:string}
  battery:{label:string; wh:number}
  notes:string
}

export const DRONES:Record<DroneId,DroneSpec> = {
  fpv:{
    id:'fpv', name:'GLI FPV 穿越机', short:'FPV', maker:'GLI',
    tagline:'140 km/h 穿越机，贴着树梢飞', weightG:795, flightMin:20, speed:39, ascent:12, descent:10,
    ceiling:6000, wind:13, rangeKm:32, transmitKm:20,
    gimbal:{tiltMin:-90, tiltMax:45},
    camera:{sensor:'1/2.3 英寸 CMOS', mp:12, lens:'14mm 等效超广角', aperture:'f/2.8'},
    video:{res:'4K', fps:60}, rc:'pro', span:.55, height:.12, props:4,
    color:{shell:'#2a2f36', accent:'#e0553f', dark:'#15181c', metal:'#7f8792'},
    battery:{label:'FPV 智能飞行电池', wh:44.4},
    notes:'手动模式 39 m/s（140 km/h）、20 分钟、O3 20 km；四片涵道桨，起飞后默认专业遥控。',
  },
  flycart200:{
    id:'flycart200', name:'GLI FlyCart 200', short:'FlyCart 200', maker:'GLI',
    tagline:'重载运力机，200 公斤班组搬运', weightG:98800, payloadG:200000, flightMin:25, speed:25, ascent:5, descent:5,
    ceiling:6000, wind:12, rangeKm:36, transmitKm:40,
    gimbal:{tiltMin:-90, tiltMax:30},
    camera:{sensor:'1/1.3 英寸 CMOS 云台相机', mp:48, lens:'24mm 等效', aperture:'f/1.7', zoom:'1–8× 数码'},
    video:{res:'4K', fps:30}, rc:'pro', span:3.33, height:1.05, props:8,
    color:{shell:'#3a3f3a', accent:'#e08a2e', dark:'#20241f', metal:'#8a9187'},
    battery:{label:'DB2000 ×4', wh:1960},
    notes:'空载 25 m/s / 满载 20 m/s、升降 5 m/s、6000 m、O4 40 km；满载 10 km、空载 36 km。',
  },
}

export const DRONE_IDS:DroneId[] = ['fpv','flycart200']

export function drone(id:DroneId):DroneSpec { return DRONES[id] ?? DRONES.fpv }

/** Battery drain in percent per second at hover, scaled by takeoff mass (published minutes ÷ 100). */
export function drainPerSecond(spec:DroneSpec, loadG = 0) {
  const mass = spec.weightG + Math.max(0, loadG)
  const base = spec.weightG
  const penalty = spec.payloadG ? Math.min(2.6, mass / base) : Math.min(1.35, mass / base)
  const hover = 100 / (spec.flightMin * 60) * penalty
  return hover * 1.18
}

/** Ground speed limit for the current load, m/s. */
export function speedLimit(spec:DroneSpec, loadG = 0) {
  if(!spec.payloadG) return spec.speed
  const ratio = Math.min(1, Math.max(0, loadG) / spec.payloadG)
  return spec.speed - (spec.speed - 20) * ratio
}

export const RC_LABEL:RcUi[] = ['simple','pro']
export function uiFor(id:DroneId):RcUi { return drone(id).rc }
