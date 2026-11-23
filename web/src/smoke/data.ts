/**
 * 香烟系统的数据层：品牌、背包、快捷栏、燃烧常数。
 *
 * 全部是纯数据 + 纯函数，不碰 three.js / DOM，方便直接在 Node 里跑单测。
 * 规矩沿用 web/src/game/catalog.ts：品牌一律原创，不出现任何真实商标。
 *
 * 背包规则（需求原话）：
 *   · 每个人固定有 20 包香烟；
 *   · 每包 20 根；
 *   · 快捷栏 6 格，对应 1–6（手游直接点格子）。
 */

export type BrandId = 'nanxi' | 'lijiang' | 'guihua' | 'xiangshan'

export interface BrandDef {
  readonly id: BrandId
  /** 品牌名（两个汉字，烟盒上竖排） */
  readonly name: string
  /** 烟盒下方的拉丁字 */
  readonly en: string
  /** 烟盒尾部小标语 */
  readonly tagline: string
  /** 烟盒主色 */
  readonly pack: string
  /** 烟盒盖子/描边色 */
  readonly lid: string
  /** 烟盒上的字色 */
  readonly ink: string
  /** 过滤嘴颜色 */
  readonly tip: string
  /** 火星颜色（点着的一端） */
  readonly ember: number
  /** 烟盒背面那行小字 */
  readonly note: string
}

/** 4 个原创品牌 × 5 包 = 20 包。名字都是桂林本地意象，不撞任何真实商标。 */
export const BRANDS: readonly BrandDef[] = [
  {
    id: 'nanxi',
    name: '南溪',
    en: 'NAN XI',
    tagline: '南溪山下',
    pack: '#1f4f76',
    lid: '#2f6b96',
    ink: '#f2e7cf',
    tip: '#c9a06a',
    ember: 0xff7a2a,
    note: '南溪烟草 · 桂林',
  },
  {
    id: 'lijiang',
    name: '漓江',
    en: 'LI JIANG',
    tagline: '一江碧水',
    pack: '#1d6b5b',
    lid: '#2b8874',
    ink: '#f6efe0',
    tip: '#cbb07a',
    ember: 0xff8a3a,
    note: '漓江烟草 · 象山',
  },
  {
    id: 'guihua',
    name: '桂花',
    en: 'GUI HUA',
    tagline: '满城桂香',
    pack: '#b8891f',
    lid: '#d3a338',
    ink: '#fff7e2',
    tip: '#d0b183',
    ember: 0xffb347,
    note: '桂香烟草 · 榕城',
  },
  {
    id: 'xiangshan',
    name: '象山',
    en: 'XIANG SHAN',
    tagline: '山如象鼻',
    pack: '#39414d',
    lid: '#59616f',
    ink: '#e8eef2',
    tip: '#bfa27c',
    ember: 0xff7f3a,
    note: '象山烟草 · 漓岸',
  },
] as const

const BRAND_INDEX = new Map<string, BrandDef>()
for (const brand of BRANDS) BRAND_INDEX.set(brand.id, brand)

export function brandOf(id: string): BrandDef {
  return BRAND_INDEX.get(id) ?? BRANDS[0]
}

export function isBrandId(value: unknown): value is BrandId {
  return typeof value === 'string' && BRAND_INDEX.has(value)
}

/** 每包 20 根 */
export const PACK_CAPACITY = 20
/** 每个人固定 20 包 */
export const PACK_COUNT = 20
/** 快捷栏 6 格 */
export const HOTBAR_SLOTS = 6
/**
 * 一整根烟的可燃时间（秒）。没有人吸的时候按 1 秒 1 秒往下烧，
 * 所以「不被吸时大约持续缓慢燃烧 3 分钟」就是这条常数。
 */
export const BURN_TOTAL = 180
/** 每吸一口扣掉的秒数 */
export const PUFF_COST = 15
/** 两口之间至少间隔多少秒（吸一口算 15 秒） */
export const PUFF_GAP = 15
/** 三口以上就要提醒「再抽就没了」的阈值 */
export const BURN_LOW = 45

export interface Pack {
  /** 稳定 id（'p0'…'p19'），快捷栏用它引用，存档升级也不会串味 */
  id: string
  brand: BrandId
  /** 这包还剩几根，0..PACK_CAPACITY */
  cigarettes: number
}

export interface Inventory {
  v: 1
  packs: Pack[]
  /** 长度 HOTBAR_SLOTS，存 pack.id 或 null */
  hotbar: (string | null)[]
}

export const INVENTORY_KEY = 'glol.smoke.v1'

/** 全新存档：20 包，4 个品牌各 5 包，每包 20 根，快捷栏空着 */
export function freshInventory(): Inventory {
  const packs: Pack[] = []
  for (let i = 0; i < PACK_COUNT; i++) {
    packs.push({id: 'p' + i, brand: BRANDS[i % BRANDS.length].id, cigarettes: PACK_CAPACITY})
  }
  return {v: 1, packs, hotbar: new Array<string | null>(HOTBAR_SLOTS).fill(null)}
}

/**
 * 存档校验：任何一处不合法就退回全新存档。
 * 宁可让玩家重新摆快捷栏，也不要让坏数据把界面画崩。
 */
export function sanitizeInventory(raw: unknown): Inventory | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Partial<Inventory>
  if (value.v !== 1 || !Array.isArray(value.packs)) return undefined
  const seen = new Set<string>()
  const packs: Pack[] = []
  for (const item of value.packs) {
    if (!item || typeof item !== 'object') return undefined
    const pack = item as Partial<Pack>
    const id = pack.id
    const brand = pack.brand
    if (typeof id !== 'string' || !id || seen.has(id)) return undefined
    if (!isBrandId(brand)) return undefined
    const left = Number(pack.cigarettes)
    if (!Number.isFinite(left)) return undefined
    seen.add(id)
    packs.push({
      id,
      brand,
      cigarettes: Math.max(0, Math.min(PACK_CAPACITY, Math.round(left))),
    })
  }
  if (packs.length !== PACK_COUNT) return undefined
  const hotbar = new Array<string | null>(HOTBAR_SLOTS).fill(null)
  if (Array.isArray(value.hotbar)) {
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const id = value.hotbar[i]
      hotbar[i] = typeof id === 'string' && seen.has(id) ? id : null
    }
  }
  // 同一包不能在两个格子里：后出现的清空
  const placed = new Set<string>()
  for (let i = 0; i < hotbar.length; i++) {
    const id = hotbar[i]
    if (!id) continue
    if (placed.has(id)) hotbar[i] = null
    else placed.add(id)
  }
  return {v: 1, packs, hotbar}
}

export function loadInventory(storage: Storage | undefined = safeStorage()): Inventory {
  if (!storage) return freshInventory()
  try {
    const text = storage.getItem(INVENTORY_KEY)
    if (!text) return freshInventory()
    const parsed = sanitizeInventory(JSON.parse(text))
    return parsed ?? freshInventory()
  } catch {
    return freshInventory()
  }
}

export function saveInventory(inventory: Inventory, storage: Storage | undefined = safeStorage()) {
  if (!storage) return
  try {
    storage.setItem(INVENTORY_KEY, JSON.stringify(inventory))
  } catch {
    /* 隐私模式 / 配额满：玩得下去就行，不弹错 */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function findPack(inventory: Inventory, id: string | null): Pack | undefined {
  if (!id) return undefined
  return inventory.packs.find(pack => pack.id === id)
}

/** 快捷栏第 slot 格里那包烟 */
export function packAt(inventory: Inventory, slot: number): Pack | undefined {
  return findPack(inventory, inventory.hotbar[slot] ?? null)
}

/** 这包烟现在还在不在某个快捷栏格里（用于「正在抽的还是不是手上这包」） */
export function slotOfPack(inventory: Inventory, packId: string | null): number {
  if (!packId) return -1
  return inventory.hotbar.indexOf(packId)
}

/**
 * 把一包烟放进快捷栏。
 * · 已经在这格里 → 什么都不做；
 * · 这包在别的格里 → 和那一格交换；
 * · 目标格已有别的包 → 两个格子的内容互换。
 */
export function assignPack(inventory: Inventory, packId: string, slot: number): boolean {
  if (slot < 0 || slot >= HOTBAR_SLOTS) return false
  if (!findPack(inventory, packId)) return false
  const from = inventory.hotbar.indexOf(packId)
  const current = inventory.hotbar[slot] ?? null
  if (from === slot) return false
  inventory.hotbar[slot] = packId
  if (from >= 0) inventory.hotbar[from] = current
  return true
}

export function clearSlot(inventory: Inventory, slot: number): boolean {
  if (slot < 0 || slot >= HOTBAR_SLOTS) return false
  if (!inventory.hotbar[slot]) return false
  inventory.hotbar[slot] = null
  return true
}

/** 抽掉一根；抽没了返回 false */
export function takeCigarette(pack: Pack): boolean {
  if (pack.cigarettes <= 0) return false
  pack.cigarettes--
  return true
}

/** 0..1，烟还剩多长（UI 上那条进度） */
export function burnRatio(seconds: number): number {
  return Math.max(0, Math.min(1, seconds / BURN_TOTAL))
}
