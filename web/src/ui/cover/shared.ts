// 跨模块共用：色彩换算、随时间变化的共享 uniform、天空/大气/地形 GLSL、资源追踪。
import * as T from 'three'
import {AIR, DEG, SKY_KEYS, VIEW, dirAz} from './config'
import {GLSL_NOISE} from './noise'
import type {Spec} from './quality'

/** 反射 pass 可见的图层（主相机看 0 层）。 */
export const REFLECT = 1

/**
 * 逆 ACES 拟合：返回一个 HDR 线性值，使它经 ACESFilmic 后显示约等于 hex。
 * 通道上限 0.86：再往上逆函数陡增（0.95 → 3.9×），暖色的红通道会压过绿蓝，一叠加就偏洋红。
 */
export function disp(hex: string, gain = 1, out = new T.Color()) {
  const c = new T.Color(hex)
  const inv = (y: number) => {
    y = Math.min(y, 0.86)
    const a = 0.0245786, b = 0.000090537, c2 = 0.983729, d = 0.432951, e = 0.238081
    const A = 1 - c2 * y, B = a - d * y, C = -(b + e * y)
    return Math.max(0, (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A)) * 0.6
  }
  return out.setRGB(inv(c.r), inv(c.g), inv(c.b)).multiplyScalar(gain)
}

const keyed = SKY_KEYS.map((k) => ({
  ...k,
  c: Object.fromEntries(
    (['zen', 'mid', 'hor', 'sun', 'glow', 'haze', 'cloudLit', 'cloudDark'] as const).map((n) => [n, disp(k[n])]),
  ) as Record<'zen' | 'mid' | 'hor' | 'sun' | 'glow' | 'haze' | 'cloudLit' | 'cloudDark', T.Color>,
}))

export function makeUniforms() {
  return {
    uTime: {value: 0},
    uZen: {value: new T.Color()},
    uMid: {value: new T.Color()},
    uHor: {value: new T.Color()},
    uSunCol: {value: new T.Color()},
    uGlow: {value: new T.Color()},
    uHaze: {value: new T.Color()},
    uCloudLit: {value: new T.Color()},
    uCloudDark: {value: new T.Color()},
    uSunDir: {value: new T.Vector3(0, 1, 0)},
    /** 地形受光：天光上/下半球、直射光（已乘强度） */
    uAmbUp: {value: new T.Color()},
    uAmbDn: {value: new T.Color()},
    uSunLight: {value: new T.Color()},
    /** 城市灯光 0..1、星空 0..1 */
    uNight: {value: 0},
    uStars: {value: 0},
    uAir: {value: new T.Vector3(AIR.density, AIR.falloff, AIR.haze)},
    /** 地面高度（水面 0） */
    uGround: {value: 10},
    /** 开场亮度 0→1 */
    uIntro: {value: 0},
    uPx: {value: 1000},
    uDpr: {value: 1},
  }
}
export type U = ReturnType<typeof makeUniforms>

const tmp = new T.Color()
/** 把时间轴 tod（0..1）写进共享 uniform；返回本时刻的标量参数。 */
export function applyTime(u: U, tod: number) {
  let i = 0
  while (i < keyed.length - 2 && tod > keyed[i + 1].t) i++
  const a = keyed[i], b = keyed[i + 1]
  const k = T.MathUtils.smoothstep(tod, a.t, b.t)
  const mix = (n: keyof typeof a.c, out: T.Color) => out.copy(a.c[n]).lerp(b.c[n], k)
  mix('zen', u.uZen.value)
  mix('mid', u.uMid.value)
  mix('hor', u.uHor.value)
  mix('sun', u.uSunCol.value)
  mix('glow', u.uGlow.value)
  mix('haze', u.uHaze.value)
  mix('cloudLit', u.uCloudLit.value)
  mix('cloudDark', u.uCloudDark.value)
  const lerp = (n: 'sunEl' | 'light' | 'amb' | 'night' | 'stars') => a[n] + (b[n] - a[n]) * k
  const el = lerp('sunEl'), light = lerp('light'), amb = lerp('amb')
  dirAz(VIEW.sunAz, el * DEG, u.uSunDir.value)
  u.uSunLight.value.copy(u.uSunCol.value).multiplyScalar(1.6 * light)
  // 天光：上半球取天顶与中段天色，下半球取地面反照（暖灰）
  // 阴影靠天光：取天顶蓝为主（冷影暖光），下半球的屋面/街道反光暖而弱
  u.uAmbUp.value.copy(u.uZen.value).lerp(u.uMid.value, 0.35).multiplyScalar(1.45 * amb)
  u.uAmbDn.value.copy(tmp.copy(u.uHor.value).lerp(u.uHaze.value, 0.6)).multiplyScalar(0.35 * amb)
  u.uNight.value = lerp('night')
  u.uStars.value = lerp('stars')
  return {sunEl: el, light, amb, night: u.uNight.value}
}

export interface Ctx {
  u: U
  spec: Spec
  reduced: boolean
  /** 地面高度、主角所在楼顶高度（水面 = 0） */
  ground: number
  roof: number
  /** 共用 RGBA 噪声贴图（tileable） */
  noise: T.Texture
  track<O extends {dispose(): void}>(o: O): O
}

export const GLSL_SKY = /* glsl */ `
uniform vec3 uZen, uMid, uHor, uSunCol, uGlow, uHaze, uSunDir;
vec3 skyColor(vec3 d){
  float h = max(d.y, 0.);
  vec2 dh = normalize(d.xz + 1e-5), sh = normalize(uSunDir.xz + 1e-5);
  float azs = dot(dh, sh), az = max(azs, 0.), s = max(dot(d, uSunDir), 0.);
  // 背对太阳的地平线更冷更暗（暮光带），镜面反射里才有冷暖对比
  vec3 hor = mix(mix(uMid, uHaze, .45), uHor, smoothstep(-.7, .6, azs));
  vec3 c = mix(hor, uMid, smoothstep(0., .17, h));
  c = mix(c, uZen, smoothstep(.1, .75, h));
  float band = exp(-h * 9.);
  // 日晕用混合不用叠加：暖光叠在蓝天上会调出洋红
  c = mix(c, uGlow, clamp(band * (pow(az, 5.) * .3 + pow(az, 36.) * .55) + pow(s, 14.) * .4, 0., 1.));
  c += uSunCol * pow(s, 380.) * 2.2;
  return mix(c, uHaze, smoothstep(0., -.06, d.y));
}
// 雾色：该方向贴地平线的天色，混一点霾色（远峰「融进」身后那片天）
vec3 fogColor(vec3 d){ return mix(skyColor(normalize(vec3(d.x, max(d.y, 0.) * .4 + .012, d.z))), uHaze, .3); }
`

/** 大气透视：距离雾 + 贴地霾（谷底更浓，峰顶露出来）。 */
export const GLSL_AIR = /* glsl */ `
uniform vec3 uAir; uniform float uGround;
vec3 applyAir(vec3 c, vec3 w, vec3 D, float dist){
  // 近处 150 m 内不起雾（近景保持通透、饱和），之后按距离指数累积
  float de = max(dist - 150., 0.);
  float fd = 1. - exp(-de * uAir.x);
  float fh = uAir.z * exp(-max(w.y - uGround, 0.) * uAir.y) * (1. - exp(-de * uAir.x * 2.5));
  return mix(c, fogColor(D), clamp(fd + fh * (1. - fd), 0., 1.));
}
`

/** 地形/建筑受光：半球天光 + 包裹漫射直射光 + 逆光轮廓（silhouette 朝太阳的一侧发金边）。 */
export const GLSL_LIGHT = /* glsl */ `
uniform vec3 uAmbUp, uAmbDn, uSunLight;
vec3 shade(vec3 alb, vec3 N, vec3 V){
  vec3 amb = mix(uAmbDn, uAmbUp, N.y * .5 + .5);
  float sd = max((dot(N, uSunDir) + .12) / 1.12, 0.);
  vec3 c = alb * (amb + uSunLight * sd);
  float edge = pow(1. - abs(dot(N, V)), 3.), back = pow(max(dot(-V, uSunDir), 0.), 4.);
  return c + uGlow * edge * back * .35;
}
`

export const GLSL_OUT = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`

export const HEAD = GLSL_NOISE + GLSL_SKY + GLSL_AIR + GLSL_LIGHT

export function shader(
  ctx: Ctx,
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, T.IUniform>,
  extra: Partial<T.ShaderMaterialParameters> = {},
) {
  const m = new T.ShaderMaterial({uniforms: {...ctx.u, ...uniforms}, vertexShader, fragmentShader, ...extra})
  // 游戏的 look/atmosphere.ts 改了 Material.prototype.onBeforeCompile，编译时把游戏的 uTime / uNight 等塞进每个材质；
  // 首页一旦载入游戏模块，封面材质的时钟和夜灯就会被换成游戏那份（停在 0）。封面自带时间轴，这里挡掉。
  m.onBeforeCompile = keepCoverUniforms
  return ctx.track(m)
}
function keepCoverUniforms() {}
