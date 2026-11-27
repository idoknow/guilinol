// 「漓江暮色 · 天台」审美参数集中在这里：调色、构图、时间轴只改本文件。
// 场景坐标：x 东、z 南、y 上，单位米；原点 = 烘焙机位（七星区漓江东岸临江楼顶），y = 0 是漓江水面。
import * as T from 'three'

export const DEG = Math.PI / 180

/** 方位角（0 = 东，逆时针为正，90° = 北）+ 仰角 → 单位方向。与 scripts/bake-cover-view.mjs 同约定。 */
export const dirAz = (az: number, el = 0, out = new T.Vector3()) =>
  out.set(Math.cos(az) * Math.cos(el), Math.sin(el), -Math.sin(az) * Math.cos(el))

export const VIEW = {
  /** 画面中心方位（城市、绿化、江堤布点的扇区中心）：象鼻山 117°、日月双塔 113°、漓江向北流去。 */
  az: 120 * DEG,
  /** 太阳方位（落在象鼻山与双塔上方偏右，三种屏幕都落进菜单右侧的空画框；江面拉出碎金带）。 */
  sunAz: 118 * DEG,
}

/** 构图（以「剩余区域」为画框，菜单占掉的部分画面照样延伸过去）。 */
export const FRAME = {
  /** 相机到人的水平距离、相机离屋面高度、看向人物身上的高度。 */
  dist: 5.4,
  eye: 1.55,
  aim: 1.32,
  /** 人物在画框里的横向位置（0 左 1 右）、人物身高占画框高的比例。 */
  heroX: 0.7,
  heroXPortrait: 0.64,
  heroFill: 0.5,
  /** 竖屏画框太窄时的最小水平视角（度）。 */
  minHfov: 26,
  /** 人物朝向：正对镜头再往城市方向偏的角度（度，正 = 转向画面左侧）。 */
  turn: 28,
  near: 0.4,
  far: 32000,
}

/**
 * 时间轴：tod 0 = 日落前金光，0.38 = 太阳入峰，0.66 = 蓝调，1 = 入夜。显示色 hex（逆 ACES 后上屏接近此色）。
 * sunEl：太阳仰角（度）；light：直射光强；amb：天光强；night：城市灯光 0..1；stars：星空 0..1。
 */
export interface SkyKey {
  t: number
  zen: string
  mid: string
  hor: string
  sun: string
  glow: string
  haze: string
  cloudLit: string
  cloudDark: string
  sunEl: number
  light: number
  amb: number
  night: number
  stars: number
}
export const SKY_KEYS: readonly SkyKey[] = [
  {t: 0, zen: '#34578f', mid: '#a3b7cc', hor: '#ffd08c', sun: '#fff4dc', glow: '#ffbe6e', haze: '#d9b994', cloudLit: '#ffe0a8', cloudDark: '#7e84a2', sunEl: 5, light: 1.2, amb: 0.6, night: 0, stars: 0},
  {t: 0.38, zen: '#2b4474', mid: '#8ea2bb', hor: '#ffae5e', sun: '#ffd38c', glow: '#ff9e48', haze: '#c9a27c', cloudLit: '#ffb874', cloudDark: '#5d6188', sunEl: 0.2, light: 0.78, amb: 0.55, night: 0.12, stars: 0},
  {t: 0.66, zen: '#14224a', mid: '#2c3c70', hor: '#c47766', sun: '#ff7f4f', glow: '#a8503f', haze: '#56557a', cloudLit: '#d98472', cloudDark: '#2c3058', sunEl: -3.4, light: 0.12, amb: 0.5, night: 0.78, stars: 0.25},
  {t: 1, zen: '#040919', mid: '#0b1634', hor: '#2b2f4c', sun: '#3a2232', glow: '#17152b', haze: '#1a2140', cloudLit: '#2a2b48', cloudDark: '#0c1230', sunEl: -11, light: 0, amb: 0.3, night: 1, stars: 1},
]

/**
 * 站位与城市网格。相机在原点（楼顶），主角在 heroAz 方位 FRAME.dist 米处；楼顶西北角在主角身后。
 * 城市街网相对正东逆时针转 grid 弧度（桂林老城近似南北向），街区边长 block、街宽 street。
 */
export const SITE = {
  heroAz: 104 * DEG,
  /** 主角离楼顶西沿、北沿的距离（米）：栏杆在 0.13 m 处，人体半宽 ~0.35，西边留出一臂不穿模 */
  heroInset: [0.88, 1.49] as const,
  /** 楼顶平面尺寸（沿街网 u / v，米） */
  roofSize: [30, 26] as const,
  grid: 7 * DEG,
  block: 112,
  street: 16,
  cityNear: 50,
  cityFar: 4200,
}

/** 地形竖向夸张倍数（相对地面）：峰林、远山剪影带。 */
export const RELIEF = {peaks: 2.3, ribbons: 1.5}

/** 开场时间：开场金光，太阳缓缓沉到贴峰线停住（之后交给用户拖）。 */
export const TOD = {start: 0, rest: 0.15, seconds: 30, reducedStart: 0.15}

export const PALETTE = {
  veg: '#2f4234',
  rock: '#6a6c62',
  ground: '#4a4a42',
  water: '#0e1d28',
  roof: '#8d877d',
  rail: '#2b2d30',
  bulb: '#ffd59a',
  window: '#ffcf8f',
  windowCool: '#e2ebff',
  street: '#ffb867',
  lantern: '#ff9a3c',
  sunTower: '#ffcd5e',
  moonTower: '#d8e4ff',
  flood: '#ffc98a',
}

/** 大气：距离雾密度（1/m）、高度雾衰减（1/m）、贴地霾强度。 */
export const AIR = {density: 1 / 7000, falloff: 1 / 70, haze: 0.35}

/** 太阳光效（熔金：暖金逆光，停在太阳贴峰线）。 */
export const SUN = {
  /** 天空：地平暖带高、太阳附近暖带加高、雾里混霾比例、橙蓝过渡抬黄 */
  sky: {band: 0.17, sunBand: 0.22, fogHaze: 0.3, lift: 0.06},
  sun: {
    /** 日轮角半径（弧度） */
    disc: 0.016,
    /** 日轮紧光环（HDR，白金） */
    aureole: 1,
    /** 前向散射晕（Henyey-Greenstein）强度、g */
    mie: 0.8,
    mieG: 0.88,
    /** 大日晕倍数 */
    glow: 0.5,
    /** 天空丁达尔光束 */
    rays: 0.25,
    /** 雾的向阳散射（峰林层次） */
    fogSun: 0.2,
  },
  /** 地形/建筑逆光金边倍数 */
  rim: 1.8,
  /** 远山剪影脊线金边倍数 */
  ridge: 1.5,
  /** 逆光剪影：朝太阳看时地物去饱和、偏冷暖剪影（0 = 无） */
  sil: 0.85,
  /** 水面碎金：强度、方位宽度倍数 */
  glitter: {k: 1.8, width: 1.4},
  /** 眩光：大柔晕、紧光晕、横向拉丝倍数 */
  flare: {veil: 0.2, core: 1.3, streak: 1.2},
  /** 主角轮廓光倍数 */
  heroRim: 1.25,
} as const
