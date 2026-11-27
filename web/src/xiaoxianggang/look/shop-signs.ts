/**
 * 小香港 53 家店的招牌目录：每家店显示自己的店名，按走廊气质分配牌面工艺与形制。
 * - 工艺决定画法与是否自发光：灯箱、亚克力、发光字、霓虹、LED 点阵会亮；木牌、金属铭牌不亮。
 * - 形制决定几何：门头条（band）、胶囊灯箱（pill）、吊牌（hang）。
 * - 约三分之一的店另有侧挂竖牌（blade）或圆灯箱（round），垂直于店面伸进走廊，双面可读。
 * 图集格子在本文件按目录顺序分配，绘制（sign-atlas.ts）和摆放（runtime/indoor-scene.ts）共用同一份数据。
 */

import {
  SIGN_ATLAS_RECTS,
  XXG_BLADE_CELLS,
  XXG_FASCIA_CELLS,
  XXG_FASCIA_RESERVED,
  XXG_PALETTE,
  XXG_ROUND_CELLS,
  bladeCellRect,
  fasciaCellRect,
  roundCellRect,
  type AtlasRect,
  type SignAtlasSlot,
} from './palette.ts'

type Rgb = readonly [number, number, number]

export type XxgSignStyle = 'lightbox' | 'acrylic' | 'channel' | 'neon' | 'led' | 'wood' | 'metal'
export type XxgSignForm = 'band' | 'pill' | 'hang'
export type XxgSignFont = 'sans' | 'serif' | 'condensed' | 'script'

export interface XxgSignFace {
  readonly style: XxgSignStyle
  readonly bg: Rgb
  readonly ink: Rgb
  /** 边框、霓虹外框或饰条颜色。 */
  readonly accent: Rgb
  readonly font: XxgSignFont
}

export interface XxgSignExtra {
  readonly kind: 'blade' | 'round'
  /** 竖牌逐字竖排；圆灯箱放 1–2 个字。 */
  readonly text: string
  readonly face: XxgSignFace
  readonly rect: AtlasRect
}

export interface XxgShopSign {
  readonly shopId: string
  readonly cn: string
  readonly sub?: string
  /** 门头左侧色块里的短字（如 24H），或右下角编号。 */
  readonly badge?: string
  readonly badgeStyle?: 'block' | 'corner'
  readonly face: XxgSignFace
  readonly form: XxgSignForm
  readonly rect: AtlasRect
  readonly extra?: XxgSignExtra
}

/** 非店铺的命名格（入口牌、安全出口、特价吊牌）。 */
export interface XxgSignPlaque {
  readonly slot: SignAtlasSlot
  readonly cn: string
  readonly sub?: string
  readonly badge?: string
  readonly face: XxgSignFace
}

/** 会发光的工艺；木牌和金属铭牌只靠环境光。 */
export function isLitSignStyle(style: XxgSignStyle): boolean {
  return style !== 'wood' && style !== 'metal'
}

const f = (style: XxgSignStyle, bg: Rgb, ink: Rgb, accent: Rgb, font: XxgSignFont = 'sans'): XxgSignFace => ({ style, bg, ink, accent, font })

const WHITE: Rgb = [252, 251, 247]
const CREAM: Rgb = [250, 240, 214]
const GOLD: Rgb = [232, 196, 122]
const BLACK: Rgb = [24, 22, 22]
const NIGHT: Rgb = [16, 16, 20]
const WOOD: Rgb = [128, 84, 50]
const WOOD_DARK: Rgb = [70, 44, 26]
const BRASS: Rgb = [184, 154, 98]

interface Entry {
  readonly shopId: string
  readonly slot?: SignAtlasSlot
  readonly cn: string
  readonly sub?: string
  readonly badge?: string
  readonly badgeStyle?: 'block' | 'corner'
  readonly face: XxgSignFace
  readonly form?: XxgSignForm
  readonly extra?: { readonly kind: 'blade' | 'round'; readonly text: string; readonly face?: XxgSignFace }
}

const ENTRIES: readonly Entry[] = [
  // 主街（翻新区）：亚克力、发光字、胶囊灯箱为主。
  {
    shopId: 'shop-hengdeli',
    cn: '亨得利眼镜',
    sub: 'HENGDELI OPTICAL 旗舰店',
    face: f('channel', [26, 40, 70], GOLD, [70, 92, 130], 'serif'),
    extra: { kind: 'round', text: '亨' },
  },
  {
    shopId: 'shop-mingshi',
    cn: '铭仕鞋业',
    sub: 'MINGSHI SHOES M-101',
    face: f('acrylic', [176, 34, 40], WHITE, [244, 214, 180]),
    extra: { kind: 'blade', text: '铭仕鞋业' },
  },
  {
    shopId: 'shop-belle-bags',
    cn: '丝语皮具',
    sub: '皮具 · 包袋 M-103',
    face: f('metal', BRASS, [44, 32, 20], [120, 96, 60], 'serif'),
  },
  {
    shopId: 'shop-hk-street-men',
    cn: '港潮男装',
    sub: 'HK STREET MEN',
    face: f('neon', NIGHT, [96, 228, 246], [246, 92, 168], 'condensed'),
    form: 'hang',
  },
  {
    shopId: 'shop-chuanshenme',
    cn: '穿什么',
    sub: '买手女装 SELECT',
    face: f('lightbox', WHITE, BLACK, [196, 190, 182], 'serif'),
    form: 'pill',
  },
  {
    shopId: 'shop-zuding',
    cn: '足鼎鞋业',
    sub: 'ZUDING 男女鞋 M-102',
    face: f('acrylic', [28, 102, 72], WHITE, [214, 236, 220]),
    extra: { kind: 'round', text: '鞋' },
  },
  {
    shopId: 'shop-yafeng-shoes',
    cn: '雅风女鞋',
    sub: 'YAFENG LADIES SHOES',
    face: f('lightbox', [244, 218, 218], [118, 30, 48], [214, 160, 168], 'serif'),
  },
  {
    shopId: 'shop-retro-digital',
    cn: '胶片数码',
    sub: '配饰 · 冲印 · 维修',
    face: f('led', [10, 10, 12], [255, 170, 40], [70, 52, 24]),
  },
  {
    shopId: 'shop-tiaodiao',
    slot: 'atriumTiaodiao',
    cn: '我的调调',
    sub: '概念中庭馆 M-108',
    face: f('lightbox', XXG_PALETTE.atriumTiaodiaoAmber.rgb, [44, 22, 8], [252, 232, 198]),
    extra: { kind: 'blade', text: '调调' },
  },
  {
    shopId: 'shop-sweet',
    slot: 'firstApparelSweet',
    cn: 'Sweet 甜心轻奢',
    sub: 'M-109',
    face: f('lightbox', [244, 216, 220], [46, 24, 32], [252, 246, 246], 'serif'),
    form: 'pill',
  },
  {
    shopId: 'shop-silver-craft',
    slot: 'firstAccessorySilver',
    cn: '正阳手作银饰',
    sub: 'SILVER CRAFT M-111',
    face: f('channel', [30, 32, 38], [236, 238, 244], [150, 156, 168], 'serif'),
    extra: { kind: 'round', text: '银' },
  },
  {
    shopId: 'shop-guilin-gifts',
    cn: '漓江风物',
    sub: '桂林手信 · 特产 M-113',
    face: f('wood', WOOD, CREAM, WOOD_DARK, 'serif'),
    extra: { kind: 'blade', text: '手信特产' },
  },
  {
    shopId: 'shop-tea-bar',
    cn: '桂香鲜茶',
    sub: '鲜果茶 · 奶茶 M-110',
    face: f('lightbox', [214, 238, 222], [22, 92, 56], [150, 200, 170]),
    form: 'pill',
    extra: { kind: 'round', text: '茶' },
  },
  {
    shopId: 'shop-24h-mart',
    cn: '地下便民小铺',
    sub: '日用 · 饮料 · 零食',
    badge: '24H',
    badgeStyle: 'block',
    face: f('acrylic', [30, 78, 156], WHITE, [250, 206, 60]),
  },
  {
    shopId: 'shop-snack-oden',
    slot: 'firstSnackGuilin',
    cn: '桂林风味小吃',
    sub: '关东煮 糖水 M-114',
    face: f('acrylic', [172, 40, 32], [255, 246, 220], [250, 226, 176]),
    extra: { kind: 'blade', text: '风味小吃' },
  },
  // 西口
  {
    shopId: 'shop-west-nw',
    cn: '精选服饰',
    sub: 'A区西口 A-101',
    face: f('lightbox', [246, 238, 222], [60, 40, 28], [196, 176, 150]),
  },
  {
    shopId: 'shop-west-sw',
    cn: '潮包专柜',
    sub: 'B区西口 B-175',
    face: f('neon', NIGHT, [255, 120, 186], [120, 210, 255], 'condensed'),
    extra: { kind: 'blade', text: '潮包' },
  },
  // 北区水磨石老街：木牌、金属牌、老式灯箱。
  {
    shopId: 'shop-a312',
    cn: '港岛潮袜',
    sub: '格子屋 A-312',
    face: f('lightbox', [242, 214, 76], BLACK, [40, 36, 30]),
  },
  {
    shopId: 'shop-a314',
    cn: '依诺',
    sub: '韩版配饰 A-314',
    face: f('lightbox', [228, 220, 240], [86, 50, 126], [190, 176, 214], 'serif'),
    form: 'pill',
    extra: { kind: 'round', text: '饰' },
  },
  {
    shopId: 'shop-yuyu',
    slot: 'boutiqueYuyu',
    cn: '优优家',
    sub: 'YuYu A-315',
    face: f('lightbox', [250, 248, 244], [26, 22, 18], [188, 174, 154]),
  },
  {
    shopId: 'shop-a316-jiulin',
    slot: 'boutiqueJiulin',
    cn: '玖琳',
    sub: 'JIULIN A-316',
    face: f('channel', XXG_PALETTE.boutiqueJiulinDark.rgb, [252, 250, 246], [198, 192, 182], 'serif'),
  },
  {
    shopId: 'shop-a318',
    cn: '花漾轻甜',
    sub: '女装 A-318',
    face: f('neon', NIGHT, [255, 150, 196], [255, 214, 120], 'script'),
  },
  {
    shopId: 'shop-a320',
    cn: '初遇手作',
    sub: '美饰 A-320',
    face: f('wood', [150, 106, 66], [48, 28, 16], WOOD_DARK, 'serif'),
  },
  {
    shopId: 'shop-a322',
    cn: '丝路',
    sub: '小香风馆 A-322',
    face: f('metal', [40, 40, 44], GOLD, [92, 92, 98], 'serif'),
    extra: { kind: 'blade', text: '小香风馆' },
  },
  {
    shopId: 'shop-a326',
    cn: '手信杂货',
    sub: '采光井旁 A-326',
    face: f('wood', [112, 74, 44], CREAM, WOOD_DARK),
    form: 'hang',
  },
  {
    shopId: 'shop-a301-mart',
    cn: '十元百货',
    sub: '老铺 A-301',
    face: f('acrylic', [196, 36, 32], [255, 226, 70], [255, 226, 70]),
  },
  {
    shopId: 'shop-a303-snack',
    cn: '桂味酸嘢',
    sub: '零嘴档 A-303',
    face: f('acrylic', [214, 104, 30], WHITE, [255, 226, 170]),
    extra: { kind: 'round', text: '酸' },
  },
  {
    shopId: 'shop-a305',
    cn: '千禧牛仔',
    sub: '水洗牛仔铺 A-305',
    face: f('lightbox', [64, 96, 150], WHITE, [236, 200, 120], 'condensed'),
    extra: { kind: 'blade', text: '牛仔' },
  },
  {
    shopId: 'shop-a307',
    cn: '针织集合',
    sub: 'KNIT A-307',
    face: f('lightbox', [236, 227, 210], [96, 62, 40], [190, 170, 146], 'serif'),
  },
  // 北区复古巷：LED、红黄亚克力、霓虹。
  {
    shopId: 'shop-hk-street',
    slot: 'alleyHkStreet',
    cn: '小香港·港街',
    sub: 'FASHION 韩国女装',
    face: f('acrylic', XXG_PALETTE.hkAlleyBlue.rgb, [252, 254, 255], [232, 240, 252]),
  },
  {
    shopId: 'shop-discount-19',
    cn: '19元特价',
    sub: '淘货架 A-903',
    face: f('led', [10, 8, 8], [255, 64, 48], [70, 24, 20]),
  },
  {
    shopId: 'shop-milky-way',
    cn: 'Milky way',
    sub: 'A-905',
    face: f('neon', NIGHT, [150, 200, 255], [200, 150, 255], 'script'),
  },
  {
    shopId: 'shop-discount-29',
    cn: '29元卫衣',
    sub: '韩范 A-908',
    face: f('acrylic', [244, 206, 40], [176, 28, 28], [176, 28, 28]),
  },
  {
    shopId: 'shop-discount-39',
    cn: '39元断码',
    sub: '捡漏档 A-910',
    face: f('led', [10, 10, 8], [255, 190, 50], [70, 56, 20]),
  },
  {
    shopId: 'shop-discount-49',
    cn: '49元鞋包',
    sub: '帆布鞋包区 A-912',
    face: f('lightbox', WHITE, [196, 30, 36], [196, 30, 36]),
  },
  {
    shopId: 'shop-zone2-mid20',
    cn: '连廊精品',
    sub: '二区中20号',
    face: f('metal', [196, 198, 200], [40, 44, 50], [120, 124, 130]),
  },
  {
    shopId: 'shop-cb2-03',
    cn: '港式甜品',
    sub: '双皮奶 · 糖水 CB3号',
    face: f('lightbox', [252, 242, 226], [178, 40, 40], [226, 190, 160], 'serif'),
    form: 'pill',
    extra: { kind: 'round', text: '甜' },
  },
  // 东北扶梯口
  {
    shopId: 'shop-welcome-nails',
    cn: '美甲美睫',
    sub: '三区扶梯 CB3-4',
    face: f('neon', NIGHT, [255, 236, 244], [255, 110, 170], 'script'),
    extra: { kind: 'blade', text: '美甲美睫' },
  },
  {
    shopId: 'shop-yilian-suits',
    cn: '依恋职业装',
    sub: 'OFFICE WEAR CB3-2',
    face: f('channel', [44, 44, 48], WHITE, [110, 110, 116], 'serif'),
  },
  // 南区中段档口：小灯箱、吊牌。
  {
    shopId: 'shop-yilian-mid12',
    slot: 'stallYilianMid12',
    cn: '依莲 yilian',
    sub: '中区12号',
    face: f('lightbox', [246, 244, 238], [26, 20, 18], [194, 182, 168]),
    form: 'hang',
  },
  {
    shopId: 'shop-hk-gallery-d',
    cn: '香港街',
    sub: 'D区穿搭档 中区10号',
    face: f('acrylic', [30, 110, 120], WHITE, [200, 236, 236]),
  },
  {
    shopId: 'shop-cb2-mid',
    cn: '日韩发饰',
    sub: 'CB2号',
    face: f('lightbox', [248, 222, 230], [150, 40, 80], [220, 170, 190]),
    form: 'pill',
  },
  {
    shopId: 'shop-cb5-mid',
    cn: '毛绒文创',
    sub: 'CB5号',
    face: f('wood', [168, 124, 80], [56, 34, 20], WOOD_DARK),
  },
  {
    shopId: 'shop-cb6-mid',
    cn: '伴手贴纸',
    sub: 'CB6号',
    face: f('lightbox', [220, 240, 236], [30, 96, 90], [160, 206, 198]),
  },
  // 南区精品街：发光字、霓虹、胶囊灯箱。
  {
    shopId: 'shop-1987',
    slot: 'store1987',
    cn: '1987',
    sub: 'BOUTIQUE 女装',
    face: f('channel', [24, 26, 32], [250, 246, 236], [212, 206, 196], 'serif'),
    extra: { kind: 'blade', text: '1987' },
  },
  {
    shopId: 'shop-b177',
    cn: '简素',
    sub: '设计工作室 B-177',
    face: f('metal', [214, 214, 210], [30, 30, 30], [150, 150, 146], 'serif'),
  },
  {
    shopId: 'shop-b181',
    slot: 'boutiqueB181',
    cn: 'QUEEN.SHANSHAN.',
    sub: 'KOREAN BOUTIQUE',
    badge: 'B181',
    badgeStyle: 'corner',
    face: f('lightbox', XXG_PALETTE.wallBoutiquePink.rgb, [28, 22, 24], [248, 242, 244], 'serif'),
  },
  {
    shopId: 'shop-zhencai',
    cn: 'zhencai',
    sub: '花艺女装 B-183',
    face: f('neon', NIGHT, [255, 196, 150], [150, 236, 196], 'script'),
  },
  {
    shopId: 'shop-b182-fitting',
    cn: '星光精选',
    sub: '试衣大店 B-182',
    face: f('acrylic', [60, 42, 106], [255, 232, 160], [255, 232, 160]),
    extra: { kind: 'round', text: '星' },
  },
  {
    shopId: 'shop-b184-studio',
    cn: '韩范潮搭',
    sub: '集合店 B-184',
    face: f('lightbox', WHITE, BLACK, [30, 30, 30], 'condensed'),
    form: 'pill',
  },
  {
    shopId: 'shop-b186-knit',
    cn: '浅灰羊绒',
    sub: 'CASHMERE B-186',
    face: f('lightbox', [216, 216, 212], [64, 64, 66], [170, 170, 168], 'serif'),
  },
  {
    shopId: 'shop-b188-silver',
    cn: '南庭',
    sub: '服饰 · 银饰 B-188',
    face: f('channel', [28, 58, 50], GOLD, [80, 110, 96], 'serif'),
    extra: { kind: 'blade', text: '南庭银饰' },
  },
  // 东侧
  {
    shopId: 'shop-east-gallery',
    cn: '十号文创亭',
    sub: '体育馆侧 E-101',
    face: f('wood', WOOD, CREAM, WOOD_DARK, 'serif'),
  },
]

function buildCatalog(): Readonly<Record<string, XxgShopSign>> {
  const out: Record<string, XxgShopSign> = {}
  let fascia = XXG_FASCIA_RESERVED
  let blade = 0
  let round = 0
  for (const e of ENTRIES) {
    if (out[e.shopId]) throw new Error(`duplicate shop sign ${e.shopId}`)
    let rect: AtlasRect
    if (e.slot) rect = SIGN_ATLAS_RECTS[e.slot]
    else {
      if (fascia >= XXG_FASCIA_CELLS) throw new Error('sign atlas: out of fascia cells')
      rect = fasciaCellRect(fascia++)
    }
    let extra: XxgSignExtra | undefined
    if (e.extra) {
      const isBlade = e.extra.kind === 'blade'
      if (isBlade ? blade >= XXG_BLADE_CELLS : round >= XXG_ROUND_CELLS) throw new Error(`sign atlas: out of ${e.extra.kind} cells`)
      extra = {
        kind: e.extra.kind,
        text: e.extra.text,
        face: e.extra.face ?? e.face,
        rect: isBlade ? bladeCellRect(blade++) : roundCellRect(round++),
      }
    }
    out[e.shopId] = {
      shopId: e.shopId,
      cn: e.cn,
      ...(e.sub ? { sub: e.sub } : {}),
      ...(e.badge ? { badge: e.badge, badgeStyle: e.badgeStyle ?? 'block' } : {}),
      face: e.face,
      form: e.form ?? 'band',
      rect,
      ...(extra ? { extra } : {}),
    }
  }
  return Object.freeze(out)
}

/** 店铺 id → 招牌。目录外的店（新增空铺）没有招牌。 */
export const XXG_SHOP_SIGNS = buildCatalog()

/** 入口牌、安全出口和特价吊牌（店铺目录之外的命名格）。 */
export const XXG_SIGN_PLAQUES: readonly XxgSignPlaque[] = Object.freeze([
  {
    slot: 'portal18Navy',
    cn: '小香港商业城',
    sub: 'Xiao Xiang Gang Commercial Market',
    badge: '18号',
    face: f('channel', XXG_PALETTE.portal18Navy.rgb, [232, 92, 74], [224, 212, 182]),
  },
  {
    slot: 'portal17Gold',
    cn: '小香港商业城',
    sub: 'Xiao Xiang Gang Commercial Market',
    badge: '17号',
    face: f('channel', XXG_PALETTE.portal17Bronze.rgb, [236, 98, 76], [244, 234, 206]),
  },
  {
    slot: 'portal10Glass',
    cn: '小香港商业城',
    sub: '10号出入口',
    face: f('lightbox', [236, 240, 244], [28, 38, 52], [94, 108, 124]),
  },
  {
    slot: 'safetyExit',
    cn: '安全出口',
    sub: 'EXIT',
    face: f('acrylic', XXG_PALETTE.safetyExitGreen.rgb, [252, 255, 252], [238, 252, 244]),
  },
  { slot: 'discountTag19', cn: '¥19', sub: '特价', face: f('lightbox', XXG_PALETTE.discountTagYellow.rgb, [18, 16, 14], [24, 20, 16]) },
  { slot: 'discountTag29', cn: '¥29', sub: '清仓', face: f('acrylic', XXG_PALETTE.discountTagRed.rgb, [255, 252, 246], [250, 244, 236]) },
  { slot: 'discountTag39', cn: '¥39', sub: '任选', face: f('lightbox', XXG_PALETTE.discountTagYellow.rgb, [18, 16, 14], [24, 20, 16]) },
  { slot: 'discountTag49', cn: '¥49', sub: '最新款', face: f('acrylic', XXG_PALETTE.discountTagRed.rgb, [255, 252, 246], [250, 244, 236]) },
])
