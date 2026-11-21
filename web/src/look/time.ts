import * as THREE from 'three'
import {look} from './config'

// M3 光是情绪: one keyframed "mood" per hour of the day, blended with a weather layer.
// Every visual that changes with time reads from `env` (CPU side) or `atmo` (shared shader uniforms).
type Key = {
  sun:[number,number,number]; sunColor:number; sunPower:number
  hemiSky:number; hemiGround:number; hemiPower:number
  zenith:number; horizon:number; glow:number
  hazeNear:number; hazeFar:number; fogLength:number; fogBoost:number; fogFalloff:number
  night:number; exposure:number; clouds:number; cloudLit:number; cloudShade:number; water:number
}
const day:Key = {
  sun:[...look.sunDirection], sunColor:look.sunColor, sunPower:look.sunPower,
  hemiSky:look.hemiSky, hemiGround:look.hemiGround, hemiPower:look.hemiPower,
  zenith:look.skyZenith, horizon:look.skyHorizon, glow:look.skyGlow,
  hazeNear:look.hazeNear, hazeFar:look.hazeFar, fogLength:look.fogLength, fogBoost:look.heightFogBoost, fogFalloff:look.heightFogFalloff,
  night:0, exposure:look.exposure, clouds:.36, cloudLit:0xfbf8f0, cloudShade:0xb7c6cc, water:look.waterBody,
}
const k = (patch:Partial<Key>):Key=>({...day,...patch})
// hour → mood. 晨雾偏冷青、正午通透、黄昏暖金、夜晚深蓝加暖色灯 (docs/style.md 原则 5).
const keys:[number,Key][] = [
  [0, k({sun:[.35,.62,-.45],sunColor:0x9fb0d0,sunPower:.45,hemiSky:0x4c5270,hemiGround:0x4a3a2c,hemiPower:1.25,
    zenith:0x0b1222,horizon:0x3a3150,glow:0x4a3f60,hazeNear:0x2a2a40,hazeFar:0x231f38,fogLength:3600,fogBoost:1.4,
    night:1,exposure:1.45,clouds:.3,cloudLit:0x6a5a78,cloudShade:0x1c1a2c,water:0x101c28})],
  [4.6, k({sun:[.35,.62,-.45],sunColor:0x9fb0d0,sunPower:.45,hemiSky:0x4c5270,hemiGround:0x4a3a2c,hemiPower:1.25,
    zenith:0x0b1222,horizon:0x3a3150,glow:0x4a3f60,hazeNear:0x2a2a40,hazeFar:0x231f38,fogLength:3600,fogBoost:1.4,
    night:1,exposure:1.45,clouds:.3,cloudLit:0x6a5a78,cloudShade:0x1c1a2c,water:0x101c28})],
  [5.6, k({sun:[.95,.04,.1],sunColor:0xb7a6c8,sunPower:.35,hemiSky:0x6c7f97,hemiGround:0x2c3132,hemiPower:.9,
    zenith:0x34506e,horizon:0x9aa6b4,glow:0xd7a99a,hazeNear:0x8593a2,hazeFar:0x5f7186,fogLength:1300,fogBoost:3.2,fogFalloff:45,
    night:.75,exposure:1.15,clouds:.34,cloudLit:0xd2a9a2,cloudShade:0x56637a,water:0x2c4048})],
  // 晨雾: low cold-cyan sun, valleys filled with milk, peaks rising out of it.
  [6.6, k({sun:[.93,.2,.3],sunColor:0xffd8b4,sunPower:1.15,hemiSky:0xc6dbe0,hemiGround:0x76847a,hemiPower:1.4,
    zenith:0x86aabd,horizon:0xe2ebe9,glow:0xf7dcc2,hazeNear:0xdde8e6,hazeFar:0xb1c8cd,fogLength:1000,fogBoost:3.6,fogFalloff:40,
    night:0,exposure:1.02,clouds:.3,cloudLit:0xfff1e4,cloudShade:0xb4c2cc,water:0x5f8e8d})],
  [8.6, k({sun:[.75,.45,.45],sunColor:0xfff0dc,sunPower:1.8,fogLength:1900,fogBoost:2.4,fogFalloff:48,hazeNear:0xdbe5e2})],
  [11.5, k({sun:[-.2,.86,.45],sunPower:2.25,fogLength:2900,fogBoost:1.1,zenith:0x6f9fbd,clouds:.38})],
  [13.5, day],
  [16.3, k({sun:[-.8,.4,.42],sunColor:0xffe4bf,sunPower:2.05,glow:0xf7e0bc,hazeNear:0xdcdcd0,clouds:.34})],
  // 黄昏暖金: sun on the western ridgeline, gold haze, peaks layer into lilac-grey.
  [18.1, k({sun:[-.94,.12,.3],sunColor:0xffb066,sunPower:1.9,hemiSky:0xc9b7b0,hemiGround:0x6c604e,hemiPower:1.25,
    zenith:0x6c87a8,horizon:0xf1c99c,glow:0xf7a35c,hazeNear:0xe9cfae,hazeFar:0xa7a3b2,fogLength:2300,fogBoost:1.8,
    night:.18,exposure:1.04,clouds:.42,cloudLit:0xffc283,cloudShade:0x8d8798,water:0x55706c})],
  [19.1, k({sun:[-.95,-.02,.25],sunColor:0xd88a7c,sunPower:.5,hemiSky:0x5c6a8c,hemiGround:0x2b2a2e,hemiPower:.85,
    zenith:0x22365a,horizon:0xb98f86,glow:0xd8826a,hazeNear:0x6c6a7c,hazeFar:0x45506a,fogLength:2600,fogBoost:1.6,
    night:.85,exposure:1.18,clouds:.36,cloudLit:0xc98a7e,cloudShade:0x3a3f58,water:0x223139})],
  [20.4, k({sun:[.35,.62,-.45],sunColor:0x9fb0d0,sunPower:.45,hemiSky:0x4c5270,hemiGround:0x4a3a2c,hemiPower:1.25,
    zenith:0x0b1222,horizon:0x3a3150,glow:0x4a3f60,hazeNear:0x2a2a40,hazeFar:0x231f38,fogLength:3600,fogBoost:1.4,
    night:1,exposure:1.45,clouds:.3,cloudLit:0x6a5a78,cloudShade:0x1c1a2c,water:0x101c28})],
]
keys.push([24,keys[0][1]])

export type Weather = 'clear'|'mist'|'rain'
// Weather is a multiplier on the hour's mood: mist thickens and greys the air, rain also dims light and adds streaks.
const weatherFx = {
  clear:{fog:1,boost:0,grey:0,dim:1,clouds:0,rain:0},
  mist:{fog:.42,boost:2.2,grey:.45,dim:.72,clouds:.15,rain:0},
  rain:{fog:.5,boost:1.2,grey:.62,dim:.5,clouds:.55,rain:1},
}

const color = ()=>new THREE.Color()
// Shared uniforms: patched into every fogged material (atmosphere.ts) plus sky / water / rain.
export const atmo = {
  uHazeNear:{value:color()}, uHazeFar:{value:color()}, uHorizon:{value:color()},
  uFog:{value:new THREE.Vector4()}, uNight:{value:0}, uTime:{value:0}, uRain:{value:0},
  uSun:{value:new THREE.Vector3()}, uSunColor:{value:color()}, uGrade:{value:new THREE.Vector2(1,1)},
}
export const env = {
  hour:13.5, weather:'clear' as Weather, sunDir:new THREE.Vector3(), sunColor:color(), sunPower:0,
  hemiSky:color(), hemiGround:color(), hemiPower:0, zenith:color(), horizon:color(), glow:color(),
  hazeNear:color(), hazeFar:color(), night:0, exposure:1, clouds:0, cloudLit:color(), cloudShade:color(), water:color(),
  sunUp:0, rain:0, mix:{...weatherFx.clear},
}

const a = color(), b = color(), grey = color()
const lerpN = (x:number,y:number,t:number)=>x+(y-x)*t
function blendColor(target:THREE.Color, from:number, to:number, t:number) {
  a.setHex(from); b.setHex(to); target.copy(a).lerp(b,t)
}
// Colours stored as-authored sRGB hex; three converts them to linear in Color.setHex.
export function evaluate(hour:number, weather:Weather, blend=1) {
  hour = ((hour%24)+24)%24
  let i = 0; while(keys[i+1][0]<=hour) i++
  const [h0,k0] = keys[i], [h1,k1] = keys[i+1]
  const t = THREE.MathUtils.smoothstep(hour,h0,h1)
  const lerp = (x:number,y:number)=>x+(y-x)*t
  env.hour = hour
  env.sunDir.set(...k0.sun).lerp(new THREE.Vector3(...k1.sun),t).normalize()
  blendColor(env.sunColor,k0.sunColor,k1.sunColor,t); env.sunPower = lerp(k0.sunPower,k1.sunPower)
  blendColor(env.hemiSky,k0.hemiSky,k1.hemiSky,t); blendColor(env.hemiGround,k0.hemiGround,k1.hemiGround,t)
  env.hemiPower = lerp(k0.hemiPower,k1.hemiPower)
  blendColor(env.zenith,k0.zenith,k1.zenith,t); blendColor(env.horizon,k0.horizon,k1.horizon,t); blendColor(env.glow,k0.glow,k1.glow,t)
  blendColor(env.hazeNear,k0.hazeNear,k1.hazeNear,t); blendColor(env.hazeFar,k0.hazeFar,k1.hazeFar,t)
  blendColor(env.cloudLit,k0.cloudLit,k1.cloudLit,t); blendColor(env.cloudShade,k0.cloudShade,k1.cloudShade,t)
  blendColor(env.water,k0.water,k1.water,t)
  env.night = lerp(k0.night,k1.night); env.exposure = lerp(k0.exposure,k1.exposure); env.clouds = lerp(k0.clouds,k1.clouds)
  let fogLength = lerp(k0.fogLength,k1.fogLength), fogBoost = lerp(k0.fogBoost,k1.fogBoost)
  const fogFalloff = lerp(k0.fogFalloff,k1.fogFalloff)
  // Weather: ease the previous weather mix toward the target so switching never pops.
  const target = weatherFx[weather]
  for(const key of Object.keys(env.mix) as (keyof typeof env.mix)[]) env.mix[key] += (target[key]-env.mix[key])*blend
  env.weather = weather
  const m = env.mix
  fogLength *= m.fog; fogBoost += m.boost
  const dark = env.night
  // Overcast grey follows the hour's brightness: pale pearl by day, slate at night.
  grey.copy(env.horizon).lerp(env.zenith,.5); const level = (grey.r+grey.g+grey.b)/3
  grey.setRGB(level*1.02,level*1.05,level*1.07)
  for(const c of [env.zenith,env.horizon,env.glow,env.hazeNear,env.hazeFar,env.cloudLit]) c.lerp(grey,m.grey)
  env.cloudShade.lerp(grey.clone().multiplyScalar(.82),m.grey)
  env.sunPower *= m.dim; env.hemiPower *= .75+.25*m.dim
  env.water.lerp(grey.clone().multiplyScalar(.7),m.grey*.5)
  env.clouds = Math.min(1,env.clouds+m.clouds); env.rain = m.rain
  env.sunUp = THREE.MathUtils.smoothstep(env.sunDir.y,-.04,.12)*(1-dark)
  // Fog is mixed after tone mapping + sRGB encode, so its colours go up already in display space.
  atmo.uHazeNear.value.copy(env.hazeNear).convertLinearToSRGB(); atmo.uHazeFar.value.copy(env.hazeFar).convertLinearToSRGB()
  atmo.uHorizon.value.copy(env.horizon).convertLinearToSRGB()
  atmo.uFog.value.set(fogLength,fogBoost,look.heightFogBase,fogFalloff)
  atmo.uNight.value = dark; atmo.uRain.value = m.rain
  // Phase 2 street grade: punchier by day, a touch more saturated at night; rain flattens contrast a little.
  atmo.uGrade.value.set(lerpN(look.gradeDay[0],look.gradeNight[0],dark),lerpN(look.gradeDay[1],look.gradeNight[1],dark)*(1-.04*m.rain))
  atmo.uSun.value.copy(env.sunDir); atmo.uSunColor.value.copy(env.sunColor).multiplyScalar(env.sunPower*env.sunUp)
}

const names = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥']
export function label(hour:number) {
  const h = Math.floor(hour), m = Math.floor((hour-h)*60)
  return `${names[Math.floor(((hour+1)%24)/2)]}时 · ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
}
