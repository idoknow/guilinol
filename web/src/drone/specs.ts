// IDOK-215: the fleet. Figures follow DJI's published spec sheets (S mode, sea level, no wind);
// where a number depends on battery or region we take the optimistic published one and say so in `notes`.
export type DroneId = 'mavic4pro' | 'mini5pro' | 'air3s' | 'inspire3' | 'flycart200'
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
  mavic4pro:{
    id:'mavic4pro', name:'DJI Mavic 4 Pro', short:'Mavic 4 Pro', maker:'DJI',
    tagline:'三摄旗舰，万物皆可入画', weightG:1063, flightMin:51, speed:25, ascent:10, descent:10,
    ceiling:6000, wind:12, rangeKm:41, transmitKm:30,
    gimbal:{tiltMin:-90, tiltMax:70},
    camera:{sensor:'4/3 CMOS 哈苏', mp:100, lens:'24mm 等效', aperture:'f/2.8–f/11', zoom:'1–6× 混合（70mm/168mm 长焦）'},
    video:{res:'6K', fps:60}, rc:'pro', span:1.13, height:.15, props:4,
    color:{shell:'#3b3f45', accent:'#c8b48a', dark:'#23262b', metal:'#8d949c'},
    battery:{label:'TB100', wh:95.2},
    notes:'51 分钟续航、25 m/s、6000 m 升限、O4+ 30 km。',
  },
  mini5pro:{
    id:'mini5pro', name:'DJI Mini 5 Pro', short:'Mini 5 Pro', maker:'DJI',
    tagline:'249 克，一英寸，随手起飞', weightG:249, flightMin:52, speed:19, ascent:10, descent:8,
    ceiling:6000, wind:10.7, rangeKm:32, transmitKm:20,
    gimbal:{tiltMin:-90, tiltMax:55},
    camera:{sensor:'1 英寸 CMOS', mp:50, lens:'24mm 等效', aperture:'f/1.8', zoom:'1–3× 数码'},
    video:{res:'4K', fps:120}, rc:'simple', span:.38, height:.09, props:4,
    color:{shell:'#54585f', accent:'#d8dde3', dark:'#2b2e33', metal:'#9aa2ab'},
    battery:{label:'Mini 5 Pro 智能飞行电池 Plus', wh:38.4},
    notes:'52 分钟（Plus 电池）、19 m/s、6000 m 升限、O4+ 20 km；遥控界面走傻瓜式。',
  },
  air3s:{
    id:'air3s', name:'DJI Air 3S', short:'Air 3S', maker:'DJI',
    tagline:'双摄旅行机，日夜都稳', weightG:724, flightMin:45, speed:21, ascent:10, descent:10,
    ceiling:6000, wind:12, rangeKm:32, transmitKm:20,
    gimbal:{tiltMin:-90, tiltMax:60},
    camera:{sensor:'1 英寸 CMOS', mp:50, lens:'24mm 等效', aperture:'f/1.8', zoom:'1–3×（70mm 中长焦副摄）'},
    video:{res:'4K', fps:60}, rc:'pro', span:.66, height:.11, props:4,
    color:{shell:'#4a4e55', accent:'#b9c0c8', dark:'#26292e', metal:'#8f979f'},
    battery:{label:'Air 3S 智能飞行电池', wh:77},
    notes:'45 分钟、21 m/s、6000 m、O4 20 km。',
  },
  inspire3:{
    id:'inspire3', name:'DJI Inspire 3', short:'Inspire 3', maker:'DJI',
    tagline:'全画幅 8K 电影机，片场常客', weightG:3995, flightMin:28, speed:26, ascent:8, descent:8,
    ceiling:5000, wind:12, rangeKm:15, transmitKm:15,
    gimbal:{tiltMin:-90, tiltMax:30},
    camera:{sensor:'全画幅 CMOS（X9-8K Air）', mp:4500, lens:'DL 18/24/35/50mm', aperture:'可换镜头', zoom:'光学换镜'},
    video:{res:'8K', fps:25}, rc:'pro', span:1.4, height:.25, props:4,
    color:{shell:'#2e3136', accent:'#d1462f', dark:'#1b1d21', metal:'#7d858e'},
    battery:{label:'TB51', wh:428},
    notes:'28 分钟（起落架放下）、26 m/s、5000 m 升限、O3 Pro 15 km。',
  },
  flycart200:{
    id:'flycart200', name:'DJI FlyCart 200', short:'FlyCart 200', maker:'DJI',
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

export const DRONE_IDS:DroneId[] = ['mavic4pro','mini5pro','air3s','inspire3','flycart200']

export function drone(id:DroneId):DroneSpec { return DRONES[id] ?? DRONES.mavic4pro }

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
