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
  /** 太阳方位（艺术处理：落在漓江河道正上方，江面拉出一条碎金带；挂在主角左后方逆光勾轮廓，再沉进峰林）。 */
  sunAz: 125 * DEG,
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
export const SKY_KEYS = [
  {t: 0, zen: '#3a5d9c', mid: '#8eaad2', hor: '#f7d29a', sun: '#fff1d6', glow: '#ffc77e', haze: '#cbbba3', cloudLit: '#ffe2b0', cloudDark: '#7b84aa', sunEl: 4.2, light: 1.15, amb: 0.62, night: 0, stars: 0},
  {t: 0.38, zen: '#2a4378', mid: '#6d85b6', hor: '#f6a45f', sun: '#ffc27a', glow: '#ff9146', haze: '#b8927f', cloudLit: '#ffad70', cloudDark: '#5a5c8c', sunEl: 0.2, light: 0.7, amb: 0.55, night: 0.12, stars: 0},
  {t: 0.66, zen: '#14224a', mid: '#2c3c70', hor: '#c47766', sun: '#ff7f4f', glow: '#a8503f', haze: '#56557a', cloudLit: '#d98472', cloudDark: '#2c3058', sunEl: -3.4, light: 0.12, amb: 0.5, night: 0.78, stars: 0.25},
  {t: 1, zen: '#040919', mid: '#0b1634', hor: '#2b2f4c', sun: '#3a2232', glow: '#17152b', haze: '#1a2140', cloudLit: '#2a2b48', cloudDark: '#0c1230', sunEl: -11, light: 0, amb: 0.3, night: 1, stars: 1},
] as const

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

/** 开场时间：金光起，慢慢走到蓝调停住（之后交给用户拖）。 */
export const TOD = {start: 0.2, rest: 0.6, seconds: 34, reducedStart: 0.6}

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
export const AIR = {density: 1 / 6800, falloff: 1 / 70, haze: 0.4}
