import type { XxgShop } from '../contract.ts'
import type { SignAtlasSlot } from '../look/index.ts'
import type { BoxSpec } from './scene-boxes.ts'

/** 铺面装修类别：服装（挂杆+层架）、小饰品（玻璃柜台+洞洞板）、小吃（不锈钢档口+灯箱菜单）。 */
export type XxgShopCategory = 'apparel' | 'accessory' | 'snack'

export interface XxgFirstShop {
  readonly category: XxgShopCategory
  readonly sign: SignAtlasSlot
}

/**
 * IDOK-364 首批三家店：主廊东段相邻三铺，各占一个类别，强制开门营业、门头用专属招牌、铺面加深。
 * 键是 layout.shops[].id。
 */
export const XXG_FIRST_SHOPS: Readonly<Record<string, XxgFirstShop>> = Object.freeze({
  'shop-sweet': { category: 'apparel', sign: 'firstApparelSweet' },
  'shop-silver-craft': { category: 'accessory', sign: 'firstAccessorySilver' },
  'shop-snack-oden': { category: 'snack', sign: 'firstSnackGuilin' },
})

const SNACK_NAME = /小吃|零嘴|甜品|糖水|茶饮|饮品|奶茶|轻食|关东煮|米粉/
const APPAREL_NAME = /女装|男装|服饰|服装|试衣|针织|牛仔|卫衣|职业装|穿搭/
const ACCESSORY_NAME = /饰|银|袜|眼镜|手信|贴纸|文创|数码|皮具|包袋|潮包|美甲|百货|便民|杂货|毛绒/

export function getXxgFirstShop(shop: Pick<XxgShop, 'id'>): XxgFirstShop | null {
  return Object.prototype.hasOwnProperty.call(XXG_FIRST_SHOPS, shop.id) ? XXG_FIRST_SHOPS[shop.id]! : null
}

/** 按首批清单或招牌名归类；「服饰与银饰集合」这类混合店按服装处理。 */
export function classifyXxgShop(shop: Pick<XxgShop, 'id' | 'name'>): XxgShopCategory {
  const first = getXxgFirstShop(shop)
  if (first) return first.category
  const name = shop.name ?? ''
  if (SNACK_NAME.test(name)) return 'snack'
  if (APPAREL_NAME.test(name)) return 'apparel'
  if (ACCESSORY_NAME.test(name)) return 'accessory'
  return 'apparel'
}

/**
 * 铺面局部坐标：u 沿门面（相对铺位中心），v 从门面线往铺内的进深，y 离地高度。
 * facingZ 时 u→x、v→-outwardSign·z；否则 u→z、v→-outwardSign·x。
 */
export interface ShopFrame {
  readonly facingZ: boolean
  /** 铺位中心在门面方向上的世界坐标。 */
  readonly cu: number
  /** 门面线的世界坐标（进深轴）。 */
  readonly facade: number
  readonly outwardSign: 1 | -1
  readonly frontSpan: number
  readonly alcoveDepth: number
  readonly gapM: number
  readonly lintelBottomM: number
}

export function frameBox(
  f: ShopFrame,
  u: number,
  y: number,
  v: number,
  su: number,
  sy: number,
  sv: number,
  color?: number,
): BoxSpec {
  const along = f.cu + u
  const depth = f.facade - f.outwardSign * v
  const base = f.facingZ
    ? { cx: along, cy: y, cz: depth, sx: su, sy, sz: sv }
    : { cx: depth, cy: y, cz: along, sx: sv, sy, sz: su }
  return color === undefined ? base : { ...base, color }
}

/** 装修用到的材质批次（全部是既有合批 mesh，goods 为顶点色小物件批次）。 */
export interface FitoutBuckets {
  readonly wall: BoxSpec[]
  readonly glass: BoxSpec[]
  readonly cream: BoxSpec[]
  readonly wine: BoxSpec[]
  readonly navy: BoxSpec[]
  readonly camel: BoxSpec[]
  readonly metal: BoxSpec[]
  readonly warmLight: BoxSpec[]
  readonly goods: BoxSpec[]
}

export interface FitoutOptions {
  /** 首批店：多一层细节（模特、中岛、加深铺面里的陈列）。 */
  readonly hero: boolean
}

const PASTEL_GARMENTS = [0xe9c3ca, 0xf3efe6, 0xa9c2d8, 0xdcc9aa, 0x7f9a86, 0xc7b3d4, 0x2f3238, 0xe3d6c4] as const
const SILVER = 0xd6d9de
const GOLD = 0xc9a56a
const VELVET = 0x2b2630
const STAINLESS = 0xbfc4c8
const SKIN_MANNEQUIN = 0xece5da

/** 门面通用件：两侧门框、门楣压条、门楣暖光槽。 */
function emitFacadeTrim(f: ShopFrame, b: FitoutBuckets): void {
  const half = f.frontSpan * 0.5
  const lb = f.lintelBottomM
  b.metal.push(
    frameBox(f, -half + 0.21, lb * 0.5, 0.02, 0.07, lb, 0.09),
    frameBox(f, half - 0.21, lb * 0.5, 0.02, 0.07, lb, 0.09),
    frameBox(f, 0, lb - 0.03, 0.02, f.frontSpan - 0.26, 0.07, 0.11),
  )
  b.warmLight.push(frameBox(f, 0, lb - 0.03, 0.26, Math.max(0.8, f.frontSpan - 0.48), 0.04, 0.18))
}

/** 橱窗：矮墙裙 + 玻璃 + 竖梃，返回橱窗中心 u 与宽度。 */
function emitShowWindow(f: ShopFrame, b: FitoutBuckets, winU: number, winSpan: number): void {
  const lb = f.lintelBottomM
  b.wall.push(frameBox(f, winU, 0.2, 0.06, winSpan, 0.4, 0.12))
  b.glass.push(frameBox(f, winU, (0.4 + lb - 0.06) * 0.5, 0.06, winSpan - 0.06, lb - 0.48, 0.03))
  b.metal.push(
    frameBox(f, winU + winSpan * 0.5, lb * 0.5, 0.02, 0.06, lb, 0.08),
    frameBox(f, winU, 0.41, 0.02, winSpan, 0.05, 0.1),
  )
}

/** 立体模特：底座、立杆、躯干、裙摆、头。 */
function emitMannequin(f: ShopFrame, b: FitoutBuckets, u: number, v: number, dress: number): void {
  b.metal.push(frameBox(f, u, 0.015, v, 0.3, 0.03, 0.3), frameBox(f, u, 0.32, v, 0.03, 0.6, 0.03))
  b.goods.push(
    frameBox(f, u, 0.84, v, 0.34, 0.5, 0.2, dress),
    frameBox(f, u, 1.27, v, 0.3, 0.38, 0.17, SKIN_MANNEQUIN),
    frameBox(f, u, 1.5, v, 0.07, 0.08, 0.07, SKIN_MANNEQUIN),
    frameBox(f, u, 1.63, v, 0.17, 0.2, 0.18, SKIN_MANNEQUIN),
  )
}

/** 挂杆上一排衣服（顶点色），按 seed 轮换颜色。 */
function emitHangingRow(f: ShopFrame, b: FitoutBuckets, u0: number, u1: number, v: number, seed: number): void {
  const count = Math.max(3, Math.floor((u1 - u0) / 0.11))
  const step = (u1 - u0) / count
  for (let i = 0; i < count; i++) {
    const color = PASTEL_GARMENTS[(i * 3 + seed) % PASTEL_GARMENTS.length]!
    const len = 0.72 + ((i * 7 + seed) % 4) * 0.06
    b.goods.push(frameBox(f, u0 + step * (i + 0.5), 1.44 - len * 0.5, v, step * 0.82, len, 0.34, color))
  }
}

export function emitApparelFitout(f: ShopFrame, b: FitoutBuckets, opts: FitoutOptions): void {
  const lb = f.lintelBottomM
  const winU = -f.frontSpan * 0.26
  const doorU = f.frontSpan * 0.11
  const winSpan = Math.max(0.56, f.frontSpan * 0.4)
  const rackLen = Math.max(0.84, f.frontSpan * 0.4)
  const shelfLen = Math.max(1.1, f.frontSpan - 0.56)
  const winV = Math.min(f.alcoveDepth * 0.48, f.gapM + 0.22)
  const rackV = Math.min(f.alcoveDepth * 0.56, f.gapM + 0.16)
  const shelfV = f.alcoveDepth - 0.16

  emitFacadeTrim(f, b)
  emitShowWindow(f, b, winU, winSpan)
  b.warmLight.push(
    frameBox(f, 0, lb - 0.18, f.alcoveDepth - 0.08, Math.max(0.8, f.frontSpan - 0.56), 0.045, 0.07),
    frameBox(f, 0, 1.56, shelfV, shelfLen - 0.08, 0.025, 0.04),
  )
  b.cream.push(
    frameBox(f, winU, 0.51, winV, Math.min(0.72, winSpan * 0.62), 0.06, 0.44),
    frameBox(f, winU, 1.24, winV, 0.13, 0.16, 0.13),
    frameBox(f, doorU - rackLen * 0.22, 1.07, rackV, rackLen * 0.15, 0.78, 0.26),
  )
  b.wine.push(
    frameBox(f, winU, 0.72, winV, 0.34, 0.34, 0.26),
    frameBox(f, doorU - rackLen * 0.36, 1.05, rackV, rackLen * 0.16, 0.84, 0.28),
    frameBox(f, doorU + rackLen * 0.24, 1.07, rackV, rackLen * 0.15, 0.78, 0.28),
    frameBox(f, -shelfLen * 0.26, 1.72, shelfV, shelfLen * 0.22, 0.2, 0.22),
    frameBox(f, shelfLen * 0.22, 1.22, shelfV, shelfLen * 0.22, 0.2, 0.22),
  )
  b.navy.push(
    frameBox(f, winU, 1.02, winV, 0.24, 0.28, 0.18),
    frameBox(f, doorU - rackLen * 0.06, 1.06, rackV, rackLen * 0.16, 0.82, 0.28),
    frameBox(f, doorU + rackLen * 0.37, 1.09, rackV, rackLen * 0.14, 0.74, 0.26),
    frameBox(f, shelfLen * 0.22, 1.72, shelfV, shelfLen * 0.22, 0.2, 0.22),
    frameBox(f, -shelfLen * 0.2, 1.22, shelfV, shelfLen * 0.22, 0.18, 0.22),
  )
  b.camel.push(
    frameBox(f, doorU + rackLen * 0.09, 1.05, rackV, rackLen * 0.16, 0.84, 0.28),
    frameBox(f, 0, 0.24, shelfV, shelfLen, 0.48, 0.28),
    frameBox(f, -shelfLen * 0.42, 1.02, shelfV, 0.09, 2.04, 0.28),
    frameBox(f, shelfLen * 0.42, 1.02, shelfV, 0.09, 2.04, 0.28),
    frameBox(f, 0, 1.1, shelfV, shelfLen, 0.05, 0.26),
    frameBox(f, 0, 1.6, shelfV, shelfLen, 0.05, 0.26),
    frameBox(f, 0, 1.22, shelfV, shelfLen * 0.16, 0.18, 0.22),
  )
  b.metal.push(
    frameBox(f, winU - 0.24, 0.24, winV, 0.04, 0.48, 0.34),
    frameBox(f, winU + 0.24, 0.24, winV, 0.04, 0.48, 0.34),
    frameBox(f, winU + 0.22, 0.65, winV, 0.14, 0.22, 0.1),
    frameBox(f, doorU - rackLen * 0.48, 0.74, rackV, 0.045, 1.48, 0.045),
    frameBox(f, doorU + rackLen * 0.48, 0.74, rackV, 0.045, 1.48, 0.045),
    frameBox(f, doorU, 0.06, rackV, rackLen, 0.045, 0.24),
    frameBox(f, doorU, 1.47, rackV, rackLen, 0.045, 0.045),
    frameBox(f, 0, 1.72, shelfV, shelfLen * 0.16, 0.22, 0.22),
  )

  if (!opts.hero) return
  // 首批服装店：橱窗两尊模特 + 铺内中岛挂杆（两侧挂满）+ 试衣镜
  emitMannequin(f, b, winU - winSpan * 0.2, winV + 0.18, 0xe9c3ca)
  emitMannequin(f, b, winU + winSpan * 0.22, winV + 0.26, 0xf3efe6)
  const islandV = (rackV + shelfV) * 0.5 + 0.1
  const islandHalf = Math.min(0.9, f.frontSpan * 0.24)
  b.metal.push(
    frameBox(f, doorU - islandHalf, 0.74, islandV, 0.04, 1.48, 0.04),
    frameBox(f, doorU + islandHalf, 0.74, islandV, 0.04, 1.48, 0.04),
    frameBox(f, doorU, 1.47, islandV, islandHalf * 2, 0.04, 0.04),
    frameBox(f, doorU, 0.03, islandV, islandHalf * 2 + 0.1, 0.06, 0.5),
  )
  emitHangingRow(f, b, doorU - islandHalf + 0.06, doorU + islandHalf - 0.06, islandV, 1)
  b.goods.push(frameBox(f, -f.frontSpan * 0.5 + 0.34, 1.05, shelfV - 0.32, 0.5, 1.7, 0.03, 0xcfd6dc))
  b.camel.push(frameBox(f, -f.frontSpan * 0.5 + 0.34, 1.05, shelfV - 0.3, 0.58, 1.8, 0.025))
}

export function emitAccessoryFitout(f: ShopFrame, b: FitoutBuckets, opts: FitoutOptions): void {
  const half = f.frontSpan * 0.5
  const winU = -f.frontSpan * 0.26
  const winSpan = Math.max(0.56, f.frontSpan * 0.4)
  const backV = f.alcoveDepth - 0.04
  emitFacadeTrim(f, b)
  emitShowWindow(f, b, winU, winSpan)

  // 洞洞板背墙 + 上下两条暖光
  const boardW = f.frontSpan - 0.5
  b.goods.push(frameBox(f, 0, 1.38, backV, boardW, 1.36, 0.03, 0xebe5da))
  b.warmLight.push(
    frameBox(f, 0, 2.1, backV - 0.06, boardW - 0.1, 0.03, 0.05),
    frameBox(f, 0, 0.68, backV - 0.06, boardW - 0.1, 0.025, 0.04),
  )
  const cols = Math.max(6, Math.floor(boardW / 0.2))
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < cols; c++) {
      const u = -boardW * 0.5 + (c + 0.5) * (boardW / cols)
      const tone = (r * 5 + c * 3) % 7
      const color = tone < 4 ? SILVER : tone < 6 ? GOLD : 0xd9a7b0
      const tall = r % 2 === 0
      b.goods.push(frameBox(f, u, 1.9 - r * 0.32, backV - 0.03, 0.035, tall ? 0.16 : 0.07, 0.02, color))
      b.metal.push(frameBox(f, u, 1.99 - r * 0.32, backV - 0.04, 0.012, 0.012, 0.06))
    }
  }

  // 玻璃顶展示柜台（白色柜体 + 深色绒布托盘 + 一格格银饰）
  const counterLen = Math.min(f.frontSpan * 0.62, 2.4)
  const counterU = f.frontSpan * 0.08
  const counterV = Math.max(f.gapM + 0.55, f.alcoveDepth * 0.58)
  const depth = 0.46
  b.wall.push(frameBox(f, counterU, 0.43, counterV, counterLen, 0.86, depth))
  b.goods.push(frameBox(f, counterU, 0.875, counterV, counterLen - 0.08, 0.03, depth - 0.08, VELVET))
  b.glass.push(frameBox(f, counterU, 0.99, counterV, counterLen - 0.02, 0.2, depth - 0.02))
  b.metal.push(
    frameBox(f, counterU, 1.095, counterV, counterLen, 0.015, depth),
    frameBox(f, counterU, 0.04, counterV, counterLen + 0.02, 0.08, depth + 0.02),
  )
  b.warmLight.push(frameBox(f, counterU, 1.075, counterV - depth * 0.3, counterLen - 0.12, 0.012, 0.03))
  const pieces = Math.max(6, Math.floor(counterLen / 0.16))
  for (let i = 0; i < pieces; i++) {
    const u = counterU - counterLen * 0.5 + (i + 0.5) * (counterLen / pieces)
    for (const dv of [-0.09, 0.09]) {
      const color = (i + (dv > 0 ? 1 : 0)) % 3 === 0 ? GOLD : SILVER
      b.goods.push(frameBox(f, u, 0.905, counterV + dv, 0.07, 0.025, 0.05, color))
    }
  }

  // 侧边玻璃立柜（三层玻璃隔板）
  const towerU = half - 0.48
  const towerV = f.alcoveDepth - 0.36
  b.metal.push(frameBox(f, towerU, 0.06, towerV, 0.46, 0.12, 0.4), frameBox(f, towerU, 1.96, towerV, 0.46, 0.06, 0.4))
  b.glass.push(frameBox(f, towerU, 1.04, towerV, 0.44, 1.8, 0.38))
  for (const y of [0.55, 1.0, 1.45]) {
    b.metal.push(frameBox(f, towerU, y, towerV, 0.42, 0.012, 0.36))
    b.goods.push(
      frameBox(f, towerU - 0.1, y + 0.04, towerV, 0.07, 0.07, 0.07, SILVER),
      frameBox(f, towerU + 0.1, y + 0.05, towerV, 0.08, 0.09, 0.06, y > 1 ? GOLD : 0x9fb6c9),
    )
  }

  if (!opts.hero) return
  // 首批饰品店：橱窗里两座首饰胸像 + 镜子
  for (const [du, color] of [[-0.18, SILVER], [0.2, GOLD]] as const) {
    const v = Math.min(f.alcoveDepth * 0.48, f.gapM + 0.22)
    b.goods.push(
      frameBox(f, winU + du, 0.62, v, 0.16, 0.36, 0.1, VELVET),
      frameBox(f, winU + du, 0.86, v, 0.05, 0.12, 0.05, VELVET),
      frameBox(f, winU + du, 0.7, v - 0.055, 0.1, 0.012, 0.012, color),
    )
  }
  b.goods.push(frameBox(f, -half + 0.32, 1.2, f.alcoveDepth - 0.3, 0.42, 0.9, 0.02, 0xcfd6dc))
}

export function emitSnackFitout(f: ShopFrame, b: FitoutBuckets, opts: FitoutOptions): void {
  const half = f.frontSpan * 0.5
  const lb = f.lintelBottomM
  const backV = f.alcoveDepth - 0.04
  emitFacadeTrim(f, b)

  // 不锈钢档口柜台：正面米白波纹板，台面不锈钢，顾客侧玻璃挡板
  const counterLen = f.frontSpan - 0.7
  const counterV = Math.max(f.gapM + 0.42, Math.min(f.alcoveDepth * 0.42, f.gapM + 0.9))
  const depth = 0.58
  b.cream.push(frameBox(f, 0, 0.45, counterV - depth * 0.5 + 0.02, counterLen, 0.9, 0.04))
  b.goods.push(
    frameBox(f, 0, 0.45, counterV, counterLen - 0.04, 0.88, depth - 0.06, 0x8f9499),
    frameBox(f, 0, 0.92, counterV, counterLen + 0.04, 0.04, depth + 0.04, STAINLESS),
  )
  b.glass.push(frameBox(f, 0, 1.13, counterV - depth * 0.5 + 0.04, counterLen - 0.2, 0.34, 0.02))
  b.metal.push(
    frameBox(f, 0, 1.31, counterV - depth * 0.5 + 0.04, counterLen - 0.18, 0.02, 0.03),
    frameBox(f, -counterLen * 0.5 + 0.12, 1.13, counterV - depth * 0.5 + 0.04, 0.02, 0.36, 0.03),
    frameBox(f, counterLen * 0.5 - 0.12, 1.13, counterV - depth * 0.5 + 0.04, 0.02, 0.36, 0.03),
  )

  // 关东煮格子锅：深色锅体 + 汤面 + 一格格串
  const potLen = Math.min(1.1, counterLen * 0.42)
  const potU = -counterLen * 0.5 + potLen * 0.5 + 0.12
  b.goods.push(
    frameBox(f, potU, 1.0, counterV, potLen, 0.12, depth - 0.18, 0x3a3532),
    frameBox(f, potU, 1.062, counterV, potLen - 0.06, 0.008, depth - 0.24, 0x9b6a2c),
  )
  const SKEWER_TOPS = [0xf1e8d4, 0xd9a65a, 0xb23a2e, 0x3f5a2e, 0xe6c27a, 0xc98a5a] as const
  const cells = Math.max(4, Math.floor(potLen / 0.17))
  for (let i = 0; i < cells; i++) {
    const u = potU - potLen * 0.5 + (i + 0.5) * (potLen / cells)
    b.metal.push(frameBox(f, u + potLen / cells / 2, 1.066, counterV, 0.008, 0.012, depth - 0.24))
    for (const [j, dv] of [-0.08, 0.07].entries()) {
      b.goods.push(
        frameBox(f, u, 1.085, counterV + dv, 0.07, 0.04, 0.07, SKEWER_TOPS[(i * 2 + j) % SKEWER_TOPS.length]!),
        frameBox(f, u + 0.01, 1.15, counterV + dv, 0.008, 0.16, 0.008, 0xd8bb8c),
      )
    }
  }

  // 糖水保温桶 ×2（带盖）+ 纸杯塔
  for (const [k, du] of [0.16, 0.48].entries()) {
    const u = potU + potLen * 0.5 + du
    b.goods.push(
      frameBox(f, u, 1.1, counterV + 0.04, 0.26, 0.32, 0.26, STAINLESS),
      frameBox(f, u, 1.28, counterV + 0.04, 0.28, 0.04, 0.28, k === 0 ? 0xc0392b : 0x2e6d8e),
    )
  }
  b.goods.push(frameBox(f, counterLen * 0.5 - 0.2, 1.06, counterV + 0.1, 0.1, 0.24, 0.1, 0xf4efe4))

  // 灯箱菜单（暖光底板 + 深色分栏 + 三格菜品色块）
  const menuW = f.frontSpan - 0.6
  const menuY = Math.min(lb - 0.34, 2.02)
  b.warmLight.push(frameBox(f, 0, menuY, backV - 0.02, menuW, 0.52, 0.04))
  b.metal.push(
    frameBox(f, 0, menuY + 0.28, backV - 0.03, menuW + 0.06, 0.04, 0.05),
    frameBox(f, 0, menuY - 0.28, backV - 0.03, menuW + 0.06, 0.04, 0.05),
  )
  const MENU_DISHES = [0xb4632c, 0xe0be6a, 0x8c3a2b] as const
  for (let i = 0; i < 3; i++) {
    const u = -menuW * 0.5 + (i + 0.5) * (menuW / 3)
    b.goods.push(frameBox(f, u, menuY + 0.06, backV - 0.05, menuW / 3 - 0.24, 0.26, 0.01, MENU_DISHES[i]!))
    b.metal.push(frameBox(f, u, menuY - 0.16, backV - 0.05, menuW / 3 - 0.3, 0.035, 0.01))
  }

  // 背后操作台 + 饮料冰柜
  b.goods.push(frameBox(f, -half * 0.25, 0.45, backV - 0.32, f.frontSpan * 0.5, 0.9, 0.56, 0x9aa0a5))
  b.goods.push(frameBox(f, -half * 0.25, 0.92, backV - 0.32, f.frontSpan * 0.5 + 0.02, 0.04, 0.58, STAINLESS))
  const fridgeU = half - 0.5
  b.goods.push(frameBox(f, fridgeU, 0.95, backV - 0.34, 0.62, 1.9, 0.56, 0xeef0f2))
  b.glass.push(frameBox(f, fridgeU, 1.05, backV - 0.63, 0.5, 1.4, 0.02))
  for (const y of [0.55, 0.95, 1.35]) {
    for (let c = 0; c < 4; c++) {
      const color = [0xc0392b, 0xf2c14e, 0x3d8b5a, 0xe8e2d6][(c + Math.round(y * 10)) % 4]!
      b.goods.push(frameBox(f, fridgeU - 0.18 + c * 0.12, y + 0.09, backV - 0.5, 0.07, 0.18, 0.07, color))
    }
  }
  b.warmLight.push(frameBox(f, fridgeU, 1.83, backV - 0.62, 0.5, 0.02, 0.03))

  if (!opts.hero) return
  // 首批小吃档：档口外两只红塑料凳靠墙放（不挡走廊）
  for (const du of [-half + 0.32, -half + 0.72]) {
    b.goods.push(
      frameBox(f, du, 0.43, f.gapM + 0.12, 0.3, 0.04, 0.3, 0xc0392b),
      frameBox(f, du, 0.21, f.gapM + 0.12, 0.26, 0.42, 0.26, 0xa8322a),
    )
  }
}

export function emitShopFitout(category: XxgShopCategory, f: ShopFrame, b: FitoutBuckets, opts: FitoutOptions): void {
  if (category === 'snack') emitSnackFitout(f, b, opts)
  else if (category === 'accessory') emitAccessoryFitout(f, b, opts)
  else emitApparelFitout(f, b, opts)
}

/** 首批店铺铺面加深（米）：浅凹门面看不出店内，首批三家做成可看进去的进深。 */
export function resolveAlcoveDepth(gapM: number, frontDepth: number, isShuttered: boolean, hero: boolean): number {
  if (isShuttered) return gapM + 0.22
  if (hero) return gapM + Math.min(1.7, frontDepth * 0.46)
  return gapM + Math.min(0.65, frontDepth * 0.32)
}
