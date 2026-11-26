/**
 * 桂林十字街地下街（B1）视觉调色板、招牌图集索引、地面梯井罩与 UI 令牌。
 *
 * 严格约束：
 * - 配色与材质规格对照 shizijie-ref-pack 实拍及 fetch_city_ref.py 补空参考提取，严禁直接粘贴第三方版权街景照。
 * - 所有商铺与导视文字均采用基于桂林风物的原创名号或市政路名，零现实商业品牌 LOGO / 商标。
 * - 若挂载 HTML 浮层，仅使用 SHIZIJIE_UI_TOKENS（对应 web/src/ui/theme.css --ui-* 与 docs/design-rules.md）。
 */

import type * as THREE from 'three'
import { SZJ_BUDGET, type SzjShopCategory, type SzjStairId } from '../contract.ts'

export const SHIZIJIE_TEXTURE_BUDGET_BYTES = SZJ_BUDGET.indoorTextureBytesMax
export const SHIZIJIE_ATLAS_MAX_SHEETS = 2 as const

export type AtlasRect = readonly [x0: number, y0: number, x1: number, y1: number]

export interface SwatchSpec {
  readonly hex: string
  readonly rgb: readonly [number, number, number]
  readonly refSource: string
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

function swatch(hex: string, refSource: string, note: string): SwatchSpec {
  return { hex, rgb: hexToRgb(hex), refSource, note }
}

/** 实景校准色板（IDOK-385 降饱和抵消 look.gradeDay saturation=1.22，对标 BV1b8411r7EP B1 实拍） */
export const SHIZIJIE_PALETTE = Object.freeze({
  terrazzoBase: swatch('#78756f', 'BV1b8411r7EP_sheet_1 R3 + 17_xxg', 'B1 环廊耐污抛光盐椒花水磨石深中灰底色（压暗基底衬托细矿粒与光泽反差）'),
  terrazzoGrout: swatch('#54514c', 'BV1b8411r7EP_sheet_1 R3', '水磨石 600mm 极细水泥分格线'),
  corridorTileBase: swatch('#75736e', 'BV1b8411r7EP_sheet_1 R3 + 17_xxg', '翻新主廊与集散厅抛光深芝麻灰花岗岩（紧实 1-2px 盐椒晶粒）'),
  corridorTileVein: swatch('#5b5954', 'wikimedia/Xiufeng_panoramio_4', '花岗岩地砖天然矿物深斑脉理'),
  stairGranite: swatch('#64676d', 'baidu_pano_views/shizijie_center_W + jiefang_east_E', '地面梯井矮墙、下部 1.04m 护墙裙与楼梯侧壁芝麻灰深花岗岩'),
  stairTreadSlip: swatch('#72716d', 'baidu_pano_views/jiefang_east_E + stair spec', '防滑拉槽花岗岩踏步（0.15m×0.30m）'),
  stairNosingYellow: swatch('#d8ad38', 'baidu_pano_views/shizijie_center_4views_sheet', '楼梯前缘降饱和明黄防滑警示条与盲道压边'),
  wallPlaster: swatch('#d6d2c9', 'BV1b8411r7EP_sheet_1 R3 + docs/style.md', '地下商铺区上半墙浅暖白耐擦无机涂装（配合 dadoSpecs 使用）'),
  wallDadoStone: swatch('#4e535b', 'bilibili BV1GuW9zJEQT 07:04', '地下通道下部石材护墙裙与收边基色'),
  columnGranite: swatch('#6a6056', 'bilibili BV1GuW9zJEQT 07:04', '中庭方结构柱深咖暖灰石材包柱'),
  ceilingBoard: swatch('#dce1e7', 'BV1b8411r7EP_sheet_1 R3 + BV1GuW9zJEQT R7', '银白拉丝铝合金条形/扣板吊顶主面板（实心高亮干净顶面）'),
  ceilingGridBaffle: swatch('#b4bcc6', 'BV1b8411r7EP_sheet_1 R3', '铝合金面板极细接缝与防眩灯框压条（去除黑格子污染）'),
  lightStripCool: swatch('#eef4fc', 'BV1b8411r7EP_sheet_1 R3 + bilibili 03:52', '主过街廊道 5000K 冷白嵌入式条形灯盘'),
  lightStripWarm: swatch('#f8e8ca', 'wikimedia/桂林王城商厦_01 (CC0)', '精品格间门楣与橱窗 3400K 暖白灯带'),
  rollerShutterSilver: swatch('#9ca3ac', 'BV1b8411r7EP_sheet_1 R3 + baidu_pano_views/jiefang_west', '镀锌银灰横向波纹卷帘门（含锁盒与压条）'),
  rollerShutterCream: swatch('#beb8ab', 'baidu_pano_views/jiefang_east + underground bays', '暖米灰烤漆预留波纹卷帘门'),
  shutterLeaseAmber: swatch('#d8b14a', 'original XH rental banner', '预留档口招租灯条琥珀黄文字'),
  canopyGlassBlue: swatch('#5e899f', 'baidu_pano_views/shizijie_center_S/W', '十字街四季人字/折线玻璃雨棚微青蓝夹胶玻璃'),
  canopyTrussDark: swatch('#606875', 'baidu_pano_views/shizijie_center_S/W', '雨棚与导视灯箱阳极氧化深银灰金属框架（无 envMap 时保持立体金属灰阶）'),
  canopyHandrailWhite: swatch('#e4e7ea', 'baidu_pano_views/shizijie_center_N/W', '路口人行道浅白喷涂方管防护栏与警示环'),
  handrailSteel: swatch('#c5cbd2', 'BV1b8411r7EP_sheet_1 R3 + baidu_jiefang_east_E', '下沉梯道 304 拉丝不锈钢双层扶手'),
  bollardRedReflect: swatch('#ba3c34', 'underpass mouth safety bollard', '禁入电驴警示立柱反光红环（降饱和校准）'),
  storefrontGlassTint: swatch('#cfe0e8', 'wikimedia/大商集团桂林微笑堂商厦 (CC0)', '地下商铺通透微青钢化橱窗玻璃'),
  portalPineGreen: swatch('#183a30', 'BV1GuW9zJEQT_sheet_1 R7 + Guilin civic plaque', '地下通道主门头松烟深绿底板'),
  portalCanopyNavy: swatch('#213957', 'wikimedia/桂林南方大厦 (CC0) signage contrast', '地上入口罩蓝金导视横幅底板'),
  safetyExitGreen: swatch('#17603e', 'BV1b8411r7EP_sheet_1 R3', '国标应急疏散安全出口指示灯箱（薄银框高亮绿透）'),
})

/** 天花板悬挂多栏导视灯箱防溢光高反差调色板（10m 远距清晰可读校准，避开 R255/W255 泛白糊字） */
export const SHIZIJIE_WAYFINDING_PALETTE = Object.freeze({
  housingBgHex: '#1b2430',
  metalBezelHex: '#687382',
  metalHighlightHex: '#949fae',
  exitBadgeBgHex: '#a42616',
  exitBadgeFgHex: '#eef3f8',
  exitZhHex: '#edf2f7',
  exitEnHex: '#dce8f7',
  arrowHex: '#eef3f8',
  distanceHex: '#f4ce6a',
  turnBackBgHex: '#c67818',
  turnBackFgHex: '#fdf4dc',
})

/** 3D 招牌图集字体栈（仅用于 3D 场景店铺牌匾 Canvas/SVG 绘制，非 HUD UI 字体） */
export const SHIZIJIE_SIGN_FONTS = Object.freeze({
  sans: '"PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","STHeiti","Microsoft YaHei",sans-serif',
  serif: '"Songti SC","Noto Serif SC","STSong","SimSun",serif',
  condensed: '"Helvetica Neue","Arial Narrow","PingFang SC",sans-serif',
})

/** HTML/HUD 浮层令牌映射：严格遵守 docs/design-rules.md 与 web/src/ui/theme.css（山水印体系） */
export const SHIZIJIE_UI_TOKENS = Object.freeze({
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

/** 1024×512 招牌与导视合批总图集 30 个非重叠子区（规范化 Canvas 0..1，y=0 在顶部） */
export const SZJ_SIGN_ATLAS_RECTS = Object.freeze({
  // Row 0 (y: 0..64): 主出入口 & 中庭大型引导横幅
  portalMain: [0.0, 0.0, 0.5, 0.125] as AtlasRect,
  dirAtrium: [0.5, 0.0, 1.0, 0.125] as AtlasRect,
  // Row 1 (y: 64..128): 四角下沉步梯出口导视牌（采用市政路名 + 原创广场名，零商业商标）
  exitNw: [0.0, 0.125, 0.25, 0.25] as AtlasRect,
  exitNe: [0.25, 0.125, 0.5, 0.25] as AtlasRect,
  exitSe: [0.5, 0.125, 0.75, 0.25] as AtlasRect,
  exitSw: [0.75, 0.125, 1.0, 0.25] as AtlasRect,
  // Row 2 (y: 128..192): 餐饮茶饮小铺
  shopNoodle: [0.0, 0.25, 0.25, 0.375] as AtlasRect,
  shopTea: [0.25, 0.25, 0.5, 0.375] as AtlasRect,
  shopDessert: [0.5, 0.25, 0.75, 0.375] as AtlasRect,
  shopMochi: [0.75, 0.25, 1.0, 0.375] as AtlasRect,
  // Row 3 (y: 192..256): 服饰与潮鞋
  shopClothingHk: [0.0, 0.375, 0.25, 0.5] as AtlasRect,
  shopClothingBoutique: [0.25, 0.375, 0.5, 0.5] as AtlasRect,
  shopClothingLinen: [0.5, 0.375, 0.75, 0.5] as AtlasRect,
  shopShoes: [0.75, 0.375, 1.0, 0.5] as AtlasRect,
  // Row 4 (y: 256..320): 鞋履、数码手机与银饰
  shopLeatherShoes: [0.0, 0.5, 0.25, 0.625] as AtlasRect,
  shopPhone: [0.25, 0.5, 0.5, 0.625] as AtlasRect,
  shopPhoneCare: [0.5, 0.5, 0.75, 0.625] as AtlasRect,
  shopSilver: [0.75, 0.5, 1.0, 0.625] as AtlasRect,
  // Row 5 (y: 320..384): 眼镜、美妆、潮玩、便民店
  shopOptics: [0.0, 0.625, 0.25, 0.75] as AtlasRect,
  shopBeauty: [0.25, 0.625, 0.5, 0.75] as AtlasRect,
  shopToy: [0.5, 0.625, 0.75, 0.75] as AtlasRect,
  shopMart: [0.75, 0.625, 1.0, 0.75] as AtlasRect,
  // Row 6 (y: 384..448): 文创礼品、招租门牌、安全出口
  shopVinyl: [0.0, 0.75, 0.25, 0.875] as AtlasRect,
  shopSouvenir: [0.25, 0.75, 0.5, 0.875] as AtlasRect,
  shutterRentBanner: [0.5, 0.75, 0.75, 0.875] as AtlasRect,
  safetyExit: [0.75, 0.75, 1.0, 0.875] as AtlasRect,
  // Row 7 (y: 448..512): 市集档口牌、防滑警示牌与地面入口罩总牌
  stallPromoWarm: [0.0, 0.875, 0.25, 1.0] as AtlasRect,
  stallPromoBlue: [0.25, 0.875, 0.5, 1.0] as AtlasRect,
  stairCaution: [0.5, 0.875, 0.75, 1.0] as AtlasRect,
  canopyHeader: [0.75, 0.875, 1.0, 1.0] as AtlasRect,
})

export type SzjSignAtlasSlot = keyof typeof SZJ_SIGN_ATLAS_RECTS

export interface SzjSignMeta {
  readonly slot: SzjSignAtlasSlot
  readonly zh: string
  readonly en: string
  readonly bgHex: string
  readonly fgHex: string
  readonly rimHex: string
  readonly backlit: boolean
  readonly category?: SzjShopCategory
}

/** 所有 30 个图集招牌文字与色板定义（IDOK-385 降饱和防爆白校准，零真实商业商标，自然字距） */
export const SZJ_SIGN_META: readonly SzjSignMeta[] = Object.freeze([
  { slot: 'portalMain', zh: '十字街地下商业街 · 小香港 B1', en: 'SHIZIJIE UNDERGROUND CONCOURSE · 4 EXITS', bgHex: '#18362e', fgHex: '#f0dfad', rimHex: '#5cb8a0', backlit: true },
  { slot: 'dirAtrium', zh: '中心环岛中庭 · A/B/C/D区', en: 'CENTRAL RING ATRIUM · FOUR-WAY CONCOURSE', bgHex: '#1e252c', fgHex: '#ead79b', rimHex: '#c99c52', backlit: true },
  { slot: 'exitNw', zh: '↑ NW 解放西路', en: 'EXIT NW · JIEFANG W.', bgHex: '#183c31', fgHex: '#ebf4f1', rimHex: '#7ac4b0', backlit: true },
  { slot: 'exitNe', zh: '↑ NE 正阳步行街', en: 'EXIT NE · ZHENGYANG', bgHex: '#183c31', fgHex: '#ebf4f1', rimHex: '#dfc572', backlit: true },
  { slot: 'exitSe', zh: '↑ SE 中山中路', en: 'EXIT SE · ZHONGSHAN', bgHex: '#183c31', fgHex: '#ebf4f1', rimHex: '#dfc572', backlit: true },
  { slot: 'exitSw', zh: '↑ SW 解放西·百梓', en: 'EXIT SW · BAIZI ST.', bgHex: '#183c31', fgHex: '#ebf4f1', rimHex: '#7ac4b0', backlit: true },
  { slot: 'shopNoodle', zh: '漓江老巷米粉', en: 'RICE NOODLES · B1-01', bgHex: '#873d24', fgHex: '#f4e6bf', rimHex: '#df9f5d', backlit: true, category: 'snack' },
  { slot: 'shopTea', zh: '阳朔鲜果茶室', en: 'FRUIT TEA · B1-02', bgHex: '#1d544c', fgHex: '#eaf4f1', rimHex: '#7cc7b3', backlit: true, category: 'drink' },
  { slot: 'shopDessert', zh: '桂花冰室甜品', en: 'DESSERT CAFE · B1-03', bgHex: '#7c2b4a', fgHex: '#f4e8ed', rimHex: '#db9cb6', backlit: true, category: 'drink' },
  { slot: 'shopMochi', zh: '象山手作麻薯', en: 'MOCHI BAKERY · B1-04', bgHex: '#8d5b20', fgHex: '#f5edd4', rimHex: '#dfc174', backlit: true, category: 'snack' },
  { slot: 'shopClothingHk', zh: '港风复古穿搭馆', en: 'VINTAGE WEAR · B1-05', bgHex: '#372b66', fgHex: '#ede6f5', rimHex: '#b494de', backlit: true, category: 'clothing' },
  { slot: 'shopClothingBoutique', zh: '榕城潮流衣社', en: 'FASHION PICK · B1-06', bgHex: '#7f2d52', fgHex: '#f5e8ef', rimHex: '#dc99b8', backlit: true, category: 'clothing' },
  { slot: 'shopClothingLinen', zh: '青岚棉麻女装', en: 'LINEN STUDIO · B1-07', bgHex: '#2f534c', fgHex: '#edf3f1', rimHex: '#8fc2b2', backlit: true, category: 'clothing' },
  { slot: 'shopShoes', zh: '街头运动潮鞋馆', en: 'STREET KICKS · B1-08', bgHex: '#24292e', fgHex: '#e2eedc', rimHex: '#89cf77', backlit: true, category: 'shoes' },
  { slot: 'shopLeatherShoes', zh: '踏青手工皮鞋坊', en: 'FOOTWEAR · B1-09', bgHex: '#523929', fgHex: '#f2e8d6', rimHex: '#cca474', backlit: true, category: 'shoes' },
  { slot: 'shopPhone', zh: '象山数码配件站', en: 'DIGITAL GEAR · B1-10', bgHex: '#234c7d', fgHex: '#e9eff7', rimHex: '#8ab8df', backlit: true, category: 'phone' },
  { slot: 'shopPhoneCare', zh: '漓江快充贴膜社', en: 'PHONE CARE · B1-11', bgHex: '#264157', fgHex: '#e8eff5', rimHex: '#83b6cf', backlit: true, category: 'phone' },
  { slot: 'shopSilver', zh: '手作银饰工坊', en: 'SILVER STUDIO · B1-12', bgHex: '#463228', fgHex: '#f2e6c4', rimHex: '#cfab72', backlit: true, category: 'accessory' },
  { slot: 'shopOptics', zh: '晴岚眼镜工坊', en: 'OPTICAL LAB · B1-13', bgHex: '#225477', fgHex: '#e8f1f7', rimHex: '#8bc3de', backlit: true, category: 'accessory' },
  { slot: 'shopBeauty', zh: '花香美妆集合店', en: 'BEAUTY PICK · B1-14', bgHex: '#83294d', fgHex: '#f5e8ef', rimHex: '#dc9fba', backlit: true, category: 'beauty' },
  { slot: 'shopToy', zh: '正阳潮玩盲盒社', en: 'BLIND BOX · B1-15', bgHex: '#4d2c6f', fgHex: '#efe7f7', rimHex: '#bc96df', backlit: true, category: 'toy' },
  { slot: 'shopMart', zh: '十字街便民驿站', en: '24H MART · B1-16', bgHex: '#265734', fgHex: '#ebf4ed', rimHex: '#8dc797', backlit: true, category: 'other' },
  { slot: 'shopVinyl', zh: '复古黑胶明信片', en: 'VINYL & CARDS · B1-17', bgHex: '#33404a', fgHex: '#edf0f4', rimHex: '#ccb176', backlit: true, category: 'toy' },
  { slot: 'shopSouvenir', zh: '漓畔手作礼坊', en: 'GUILIN GIFTS · B1-18', bgHex: '#7d2f2f', fgHex: '#f4e7c6', rimHex: '#d9b16a', backlit: true, category: 'other' },
  { slot: 'shutterRentBanner', zh: '预留 · XH旺铺招租', en: 'SHOP FOR LEASE · B1', bgHex: '#292e35', fgHex: '#e0c46c', rimHex: '#cca549', backlit: false },
  { slot: 'safetyExit', zh: '安全出口 · EXIT ↑', en: 'EMERGENCY EXIT', bgHex: '#17603e', fgHex: '#f4fbf7', rimHex: '#94d6b0', backlit: true },
  { slot: 'stallPromoWarm', zh: '精选好物 · ¥19/¥29', en: 'VALUE STALL · B1', bgHex: '#9c322c', fgHex: '#f4ead0', rimHex: '#d8b756', backlit: true, category: 'clothing' },
  { slot: 'stallPromoBlue', zh: '港街精品 · B1档口', en: 'ALLEY STALL · B1', bgHex: '#234a7d', fgHex: '#ecf0f7', rimHex: '#8ab4e0', backlit: true, category: 'accessory' },
  { slot: 'stairCaution', zh: '小心台阶 · 注意防滑', en: 'WATCH YOUR STEP', bgHex: '#d8a41e', fgHex: '#0a0d12', rimHex: '#12161c', backlit: true },
  { slot: 'canopyHeader', zh: '地下通道 · 小香港 B1', en: 'UNDERGROUND PASSAGE · TUNNEL ↓', bgHex: '#ad352e', fgHex: '#f5f6f7', rimHex: '#383e46', backlit: true },
])

export const SZJ_CATEGORY_SIGN_SLOTS: Readonly<Record<SzjShopCategory, readonly SzjSignAtlasSlot[]>> = Object.freeze({
  clothing: ['shopClothingHk', 'shopClothingBoutique', 'shopClothingLinen', 'stallPromoWarm'],
  phone: ['shopPhone', 'shopPhoneCare'],
  snack: ['shopNoodle', 'shopMochi'],
  drink: ['shopTea', 'shopDessert'],
  accessory: ['shopSilver', 'shopOptics', 'stallPromoBlue'],
  shoes: ['shopShoes', 'shopLeatherShoes'],
  beauty: ['shopBeauty'],
  toy: ['shopToy', 'shopVinyl'],
  other: ['shopMart', 'shopSouvenir'],
})

const STAIR_EXIT_SLOTS: Readonly<Record<SzjStairId, SzjSignAtlasSlot>> = Object.freeze({
  nw: 'exitNw',
  ne: 'exitNe',
  se: 'exitSe',
  sw: 'exitSw',
})

export function getStairExitSignSlot(stairId: SzjStairId): SzjSignAtlasSlot {
  return STAIR_EXIT_SLOTS[stairId]
}

export function getCategorySignSlot(category: SzjShopCategory, index = 0): SzjSignAtlasSlot {
  const list = SZJ_CATEGORY_SIGN_SLOTS[category] ?? SZJ_CATEGORY_SIGN_SLOTS.other
  const normalized = ((index % list.length) + list.length) % list.length
  return list[normalized]!
}

/** 把 Canvas 规范坐标 [x0, y0, x1, y1] 转换为 Three.js flipped-Y UV 范围 [uMin, vMin, uMax, vMax] */
export function uvBoundsFromAtlasRect(rect: AtlasRect): readonly [number, number, number, number] {
  const [x0, y0, x1, y1] = rect
  return [x0, 1 - y1, x1, 1 - y0] as const
}

/** 将标准单位平面(PlaneGeometry / BoxGeometry 等) UV 原地重映射到指定图集子矩形 */
export function applySignAtlasRect(
  geometry: THREE.BufferGeometry,
  slot: SzjSignAtlasSlot,
  padPx = 3,
): THREE.BufferGeometry {
  const uv = geometry.getAttribute('uv')
  if (!uv) return geometry
  const [x0, y0, x1, y1] = SZJ_SIGN_ATLAS_RECTS[slot]
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
