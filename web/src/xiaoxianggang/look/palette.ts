/**
 * 小香港地下商业城室内视觉调色板、招牌字体、图集子区与实拍对照索引。
 *
 * 3D 招牌配色与字体均由 docs/xiaoxianggang/refs/ 实拍提取；
 * 若挂载 HTML 浮层或面板，UI 样式必须仅引用 XXG_UI_TOKENS（严格遵守 docs/design-rules.md）。
 */

import * as THREE from 'three'

export const XXG_TEXTURE_BUDGET_BYTES = 8 * 1024 * 1024

export type AtlasRect = readonly [x0: number, y0: number, x1: number, y1: number]

export interface SwatchSpec {
  readonly hex: string
  readonly rgb: readonly [number, number, number]
  readonly refFile: string
  readonly note: string
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const clean = hex.replace('#', '')
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ] as const
}

function swatch(hex: string, refFile: string, note: string): SwatchSpec {
  return { hex, rgb: hexToRgb(hex), refFile, note }
}

/** 实拍提色样本（严格对应 docs/xiaoxianggang/refs/ 内真图） */
export const XXG_PALETTE = Object.freeze({
  terrazzoBase: swatch('#d4cfc5', '12-corridor-terrazzo-yuyu-jiulin.jpg', '老区及窄廊浅暖灰水磨石基底'),
  terrazzoGrout: swatch('#7d7970', '12-corridor-terrazzo-yuyu-jiulin.jpg', '水磨石 600mm 拼接深灰缝线'),
  renovatedTileBase: swatch('#dedbd3', '11-corridor-main-hallway-wide.jpg', '翻新主道抛光浅米灰仿石砖面'),
  renovatedTileVein: swatch('#c4bfb5', '18-shop-interior-boutique-browsing.jpg', '翻新地砖柔和暖灰天然石脉'),
  ceilingBoard: swatch('#d8dde4', '11-corridor-main-hallway-wide.jpg', '哑光灰白 600mm 矿棉方格吊顶'),
  ceilingGridRail: swatch('#8b929c', '13-corridor-everyday-shops-1987.jpg', '吊顶嵌入式深灰 T 型铝龙骨'),
  ceilingLampCool: swatch('#ffffff', '11-corridor-main-hallway-wide.jpg', '嵌入式方灯冷白照明光色 5200K'),
  lightStripWarm: swatch('#fff1d6', '18-shop-interior-boutique-browsing.jpg', '精品店门楣与陈列架暖白灯带 3400K'),
  globeLampWarm: swatch('#fff6e5', '05-skylight-landing-stairs-globes.jpg', '采光顶楼梯口磨砂白球吊灯'),
  skylightGlassTint: swatch('#cbe3ec', '04-skylight-pyramid-interior-stairs.jpg', '玻璃金字塔采光顶微青蓝玻璃'),
  storefrontGlassTint: swatch('#dcebf2', '15-shop-boutique-b181-queenshan.jpg', '女装橱窗通透微青钢化玻璃'),
  wallCorridorPlaster: swatch('#eceae4', '14-atrium-renovated-rest-area.jpg', '地下中庭及通道浅暖白墙柱'),
  wallBoutiquePink: swatch('#e8cccf', '15-shop-boutique-b181-queenshan.jpg', 'B181 精品女装柔粉灰墙框'),
  stairGranite: swatch('#8c8b88', '06-portal-18-market-sign-steps.jpg', '出入口花岗岩防滑石阶与矮墙'),
  rollerShutterSilver: swatch('#9ca5af', '08-portal-10-glass-gallery-entry.jpg', '商业街标准银灰镀锌波纹卷帘门'),
  rollerShutterCream: swatch('#c6bfb2', '19-alley-retro-discount-racks.jpg', '老区暖灰烤漆波纹卷帘门'),
  portal18Navy: swatch('#1b3554', '06-portal-18-market-sign-steps.jpg', '18号出入口深海军蓝金属底牌'),
  portal17Bronze: swatch('#8c7039', '07-portal-17-gold-sign-stairs.jpg', '17号出入口深金属金铜拉丝底板'),
  portal17RedInk: swatch('#c4241e', '07-portal-17-gold-sign-stairs.jpg', '17号/18号门头朱红立体中文主字'),
  boutiqueJiulinDark: swatch('#1e2126', '12-corridor-terrazzo-yuyu-jiulin.jpg', '玖琳 JIULIN A316 深炭黑灯箱底'),
  safetyExitGreen: swatch('#0d6b3d', '11-corridor-main-hallway-wide.jpg', '主通道国标绿底安全出口指示牌'),
  atriumTiaodiaoAmber: swatch('#e29238', '14-atrium-renovated-rest-area.jpg', '翻新中庭我的调调暖橙灯箱底'),
  hkAlleyBlue: swatch('#17488a', '20-alley-vintage-hk-street-sign.jpg', '老区港街宝蓝底复古招牌'),
  discountTagYellow: swatch('#f2cc32', '19-alley-retro-discount-racks.jpg', '淘货巷黄底特价吊牌'),
  discountTagRed: swatch('#cf2621', '19-alley-retro-discount-racks.jpg', '淘货巷红底清仓特价吊牌'),
})

/** 3D 招牌图集字体栈：严格按实拍商业城字体排印（非 UI 界面字） */
export const XXG_SIGN_FONTS = Object.freeze({
  sans: '"PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","STHeiti","Microsoft YaHei",sans-serif',
  serif: '"Songti SC","Noto Serif SC","STSong","SimSun",serif',
  condensed: '"Helvetica Neue","Arial Narrow","PingFang SC",sans-serif',
})

/** UI 浮层令牌映射：严格遵守 docs/design-rules.md 与 web/src/ui/theme.css（山水印体系） */
export const XXG_UI_TOKENS = Object.freeze({
  fontFamily: 'var(--ui-serif)',
  surfaceGlass: 'var(--ui-glass-solid)',
  surfacePaper: 'var(--ui-paper)',
  hairlineBorder: 'var(--ui-glass-line-soft)',
  textPrimary: 'var(--ui-paper)',
  textSecondary: 'var(--ui-paper-dim)',
  inkPrimary: 'var(--ui-ink)',
  inkSoft: 'var(--ui-ink-soft)',
  accentPrimary: 'var(--ui-seal)',
  accentPrimaryHover: 'var(--ui-seal-hi)',
  radiusPanel: 'var(--ui-r-lg)',
  radiusPill: 'var(--ui-r-pill)',
  controlHeight: 'var(--ui-h)',
})

/**
 * 1024×512 招牌与导视合批图集矩形分区（规范化 Canvas 坐标 0..1，y=0 在顶部）。
 * 各子区长宽比尽量对齐现实牌匾比例，贴图阶段配合 applySignAtlasRect 防文字变形。
 */
export const SIGN_ATLAS_RECTS = Object.freeze({
  portal18Navy: [0.0, 0.0, 0.5, 0.34] as AtlasRect,
  portal17Gold: [0.5, 0.0, 1.0, 0.34] as AtlasRect,
  portal10Glass: [0.0, 0.34, 0.34, 0.67] as AtlasRect,
  safetyExit: [0.34, 0.34, 0.52, 0.51] as AtlasRect,
  store1987: [0.34, 0.51, 0.52, 0.67] as AtlasRect,
  boutiqueB181: [0.52, 0.34, 0.78, 0.67] as AtlasRect,
  stallYilianMid12: [0.78, 0.34, 1.0, 0.67] as AtlasRect,
  boutiqueYuyu: [0.0, 0.67, 0.24, 1.0] as AtlasRect,
  boutiqueJiulin: [0.24, 0.67, 0.44, 1.0] as AtlasRect,
  atriumTiaodiao: [0.44, 0.67, 0.62, 1.0] as AtlasRect,
  alleyHkStreet: [0.62, 0.67, 0.86, 1.0] as AtlasRect,
  discountTag19: [0.86, 0.67, 0.93, 0.835] as AtlasRect,
  discountTag29: [0.93, 0.67, 1.0, 0.835] as AtlasRect,
  discountTag39: [0.86, 0.835, 0.93, 1.0] as AtlasRect,
  discountTag49: [0.93, 0.835, 1.0, 1.0] as AtlasRect,
})

export type SignAtlasSlot = keyof typeof SIGN_ATLAS_RECTS

export interface PhotoComparisonPair {
  readonly id: string
  readonly title: string
  readonly compareImage: string
  readonly refImages: readonly string[]
  readonly materials: readonly string[]
  readonly signSlots: readonly SignAtlasSlot[]
  readonly summary: string
}

/** 材质与实拍同角度对照清单（≥3组，当前配置4组，对应 docs/xiaoxianggang/refs/compare-*.jpg） */
export const XXG_PHOTO_COMPARISON_PAIRS: readonly PhotoComparisonPair[] = Object.freeze([
  {
    id: 'corridor-floor-ceiling',
    title: '地下主廊水磨石/翻新地砖、方灯矩阵吊顶与安全出口标识',
    compareImage: 'compare-01-corridor-floor-ceiling.jpg',
    refImages: ['11-corridor-main-hallway-wide.jpg', '12-corridor-terrazzo-yuyu-jiulin.jpg'],
    materials: ['floorTerrazzo', 'floorRenovated', 'ceilingGrid', 'lightStripCool'],
    signSlots: ['safetyExit'],
    summary: '对齐#11翻新主道矩阵方灯+安全出口绿牌，及#12水磨石地砖颗粒与深灰600mm分格缝',
  },
  {
    id: 'storefront-boutique-signage',
    title: '精品女装门头与中区档口招牌（B181 / 依莲中区12号 / 我的调调）',
    compareImage: 'compare-02-storefront-signage-b181-yilian.jpg',
    refImages: ['15-shop-boutique-b181-queenshan.jpg', '16-shop-stall-yilian-mid12.jpg'],
    materials: ['wallBoutiquePink', 'storefrontGlass', 'lightStripWarm', 'signAtlasMat'],
    signSlots: ['boutiqueB181', 'stallYilianMid12', 'boutiqueYuyu', 'atriumTiaodiao'],
    summary: '对齐#15粉灰底黑字QUEEN.SHANSHAN.配B181白方牌，及#16白底依莲yilian中区12号门头',
  },
  {
    id: 'portal-signs-skylight',
    title: '18号/17号下沉门头铭牌、防滑花岗岩石阶与采光顶球灯玻璃',
    compareImage: 'compare-03-portal-sign-17-18.jpg',
    refImages: ['06-portal-18-market-sign-steps.jpg', '07-portal-17-gold-sign-stairs.jpg'],
    materials: ['stairGranite', 'skylightGlass', 'globeLamp', 'signAtlasMat'],
    signSlots: ['portal18Navy', 'portal17Gold', 'portal10Glass'],
    summary: '对齐#06海军蓝底Commercial Market(18号)与#07金铜底朱红字小香港商业城(17号)',
  },
  {
    id: 'vintage-alley-shutter',
    title: '复古港街蓝底招牌、红黄特价价签与波纹金属卷帘门',
    compareImage: 'compare-04-vintage-alley-shutter.jpg',
    refImages: ['20-alley-vintage-hk-street-sign.jpg', '19-alley-retro-discount-racks.jpg'],
    materials: ['rollerShutterSilver', 'rollerShutterCream', 'signAtlasMat'],
    signSlots: ['alleyHkStreet', 'store1987', 'discountTag19', 'discountTag29', 'discountTag39', 'discountTag49'],
    summary: '对齐#20宝蓝底港街FASHION白字与#19高密度19/39/49元标牌，配银灰/米灰波纹卷帘门',
  },
])

/** 把 0..1 矩形转换为 Three.js flipped-Y UV 范围 [uMin, vMin, uMax, vMax] */
export function uvBoundsFromAtlasRect(rect: AtlasRect): readonly [number, number, number, number] {
  const [x0, y0, x1, y1] = rect
  return [x0, 1 - y1, x1, 1 - y0] as const
}

/** 将标准单位平面(PlaneGeometry 等) UV 原地重映射到指定图集子矩形 */
export function applySignAtlasRect(geometry: THREE.BufferGeometry, slot: SignAtlasSlot, padPx = 2): THREE.BufferGeometry {
  const uv = geometry.getAttribute('uv')
  if (!uv) return geometry
  const [x0, y0, x1, y1] = SIGN_ATLAS_RECTS[slot]
  const uPad = padPx / 1024
  const vPad = padPx / 512
  const u0 = x0 + uPad
  const u1 = x1 - uPad
  const v0 = 1 - (y1 - vPad)
  const v1 = 1 - (y0 + vPad)
  for (let i = 0; i < uv.count; i++) {
    const rawU = uv.getX(i)
    const rawV = uv.getY(i)
    uv.setXY(i, u0 + (u1 - u0) * rawU, v0 + (v1 - v0) * rawV)
  }
  uv.needsUpdate = true
  return geometry
}
