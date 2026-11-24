import type {
  DailyAccumulators,
  DailyLedgerRecord,
  IngredientKey,
  InventoryStock,
  MifenUpgradeDef,
  ShopLevel,
} from './types.ts'

export const MIFEN_STORAGE_KEY = 'glol.mifen.v1'

export const BASE_RECIPE_IDS: readonly string[] = [
  'lucai_1',
  'lucai_2',
  'lucai_3',
  'guoshao_bowl',
  'beef_soup',
  'double_combo',
  'grand_feast',
  'sour_spicy',
]

export function createDefaultInventory(): InventoryStock {
  return {
    noodle: 28,
    brine: 36,
    guoshao: 20,
    meat: 20,
    condiment: 28,
  }
}

export function createEmptyDailyAccumulators(): DailyAccumulators {
  return {
    dineInGross: 0,
    dineInNet: 0,
    dineInBowls: 0,
    deliveryGross: 0,
    deliveryNet: 0,
    deliveriesCompleted: 0,
    deliveriesFailed: 0,
    retailGross: 0,
    retailNet: 0,
    retailUnitsSold: 0,
    restockSpend: 0,
    emergencyBrineCost: 0,
    rushServed: 0,
    rushAngryDrops: 0,
  }
}

export interface MifenSaveState {
  version: 1
  funds: number
  reputation: number
  totalBowlsServed: number
  totalRevenue: number
  perfectBowls: number
  streak: number
  shopLevel: ShopLevel
  ownedEquipment: string[]
  dailyServed: number
  lastSavedAt: number
  day: number
  inventory: InventoryStock
  unlockedRecipes: string[]
  unlockedAchievements: string[]
  totalDeliveries: number
  totalRetailSold: number
  dailyNetPeak: number
  threeStreamsDays: number
  today: DailyAccumulators
  dailyHistory: DailyLedgerRecord[]
}

export interface ShopEquipmentBonuses {
  boilZoneBonus: number
  boilSpeedScale: number
  sliceSpeedMultiplier?: number
  brineZoneBonus: number
  priceBonusFlat: number
  priceMultiplier: number
  qualityBonus: number
  tipBonusRatio: number
  patienceBonusSec: number
  patienceMultiplier: number
  spawnRateMultiplier: number
  maxQueueBonus: number
  reputationGainBonus: number
  inventoryCapBonus: number
  spoilageReduction: number
  deliveryQuotaBonus: number
  packCostDiscount: number
}

export interface BowlServeSummary {
  revenue: number
  tip: number
  stars: 1 | 2 | 3
}

export interface MifenStoreOptions {
  memoryOnly?: boolean
  initialState?: Partial<MifenSaveState>
}

export interface MifenStore {
  getState(): Readonly<MifenSaveState>
  subscribe(listener: (state: Readonly<MifenSaveState>) => void): () => void
  addFunds(delta: number): number
  grantFunds(amount: number): number
  spendFunds(cost: number): boolean
  recordBowlServed(summary: BowlServeSummary, bonuses?: ShopEquipmentBonuses): { reputationDelta: number }
  recordCustomerLeftAngry(): void
  setShopLevel(level: ShopLevel): ShopLevel
  addEquipment(id: string): boolean
  hasEquipment(id: string): boolean
  unlockRecipe(id: string): boolean
  unlockAchievement(id: string): boolean
  updateState(mutator: (draft: MifenSaveState) => void): Readonly<MifenSaveState>
  reset(): Readonly<MifenSaveState>
}

export function roundMoney(n: number): number {
  return Math.round(n * 10) / 10
}

export function formatMoney(n: number): string {
  const r = roundMoney(n)
  return Number.isInteger(r) ? r.toLocaleString('zh-CN') : r.toFixed(1)
}

const EMBEDDED_PORTION_RE = /[一二两叁三壹贰][两兩]/

export function formatRecipeTitle(recipe: { name: string; portion?: string }): string {
  const name = (recipe.name || '').trim()
  const portion = (recipe.portion || '').trim()
  if (!portion || EMBEDDED_PORTION_RE.test(name)) return name
  return `${portion} · ${name}`
}

export function getMaxCustomersForLevel(level: ShopLevel): number {
  if (level >= 3) return 11
  if (level === 2) return 7
  return 4
}

export function getShopLevelName(level: ShopLevel): string {
  if (level >= 3) return '三多路旗舰大店'
  if (level === 2) return '双开间旺铺'
  return '初创老铺'
}

export function createDefaultMifenState(): MifenSaveState {
  return {
    version: 1,
    funds: 38,
    reputation: 4.2,
    totalBowlsServed: 0,
    totalRevenue: 0,
    perfectBowls: 0,
    streak: 0,
    shopLevel: 1,
    ownedEquipment: [],
    dailyServed: 0,
    lastSavedAt: Date.now(),
    day: 1,
    inventory: createDefaultInventory(),
    unlockedRecipes: [...BASE_RECIPE_IDS],
    unlockedAchievements: [],
    totalDeliveries: 0,
    totalRetailSold: 0,
    dailyNetPeak: 0,
    threeStreamsDays: 0,
    today: createEmptyDailyAccumulators(),
    dailyHistory: [],
  }
}

function clampShopLevel(raw: unknown): ShopLevel {
  if (raw === 3 || raw === '3') return 3
  if (raw === 2 || raw === '2') return 2
  return 1
}

function clampNum(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

function sanitizeInventory(raw: unknown): InventoryStock {
  const base = createDefaultInventory()
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Partial<Record<IngredientKey, unknown>>
  return {
    noodle: roundMoney(clampNum(obj.noodle, base.noodle, 0, 9999)),
    brine: roundMoney(clampNum(obj.brine, base.brine, 0, 9999)),
    guoshao: roundMoney(clampNum(obj.guoshao, base.guoshao, 0, 9999)),
    meat: roundMoney(clampNum(obj.meat, base.meat, 0, 9999)),
    condiment: roundMoney(clampNum(obj.condiment, base.condiment, 0, 9999)),
  }
}

function sanitizeToday(raw: unknown): DailyAccumulators {
  const base = createEmptyDailyAccumulators()
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Partial<DailyAccumulators>
  return {
    dineInGross: roundMoney(clampNum(obj.dineInGross, 0, 0, 99_999_999)),
    dineInNet: roundMoney(clampNum(obj.dineInNet, 0, -99_999_999, 99_999_999)),
    dineInBowls: Math.floor(clampNum(obj.dineInBowls, 0, 0, 99_999)),
    deliveryGross: roundMoney(clampNum(obj.deliveryGross, 0, 0, 99_999_999)),
    deliveryNet: roundMoney(clampNum(obj.deliveryNet, 0, -99_999_999, 99_999_999)),
    deliveriesCompleted: Math.floor(clampNum(obj.deliveriesCompleted, 0, 0, 99_999)),
    deliveriesFailed: Math.floor(clampNum(obj.deliveriesFailed, 0, 0, 99_999)),
    retailGross: roundMoney(clampNum(obj.retailGross, 0, 0, 99_999_999)),
    retailNet: roundMoney(clampNum(obj.retailNet, 0, -99_999_999, 99_999_999)),
    retailUnitsSold: Math.floor(clampNum(obj.retailUnitsSold, 0, 0, 99_999)),
    restockSpend: roundMoney(clampNum(obj.restockSpend, 0, 0, 99_999_999)),
    emergencyBrineCost: roundMoney(clampNum(obj.emergencyBrineCost, 0, 0, 99_999_999)),
    rushServed: Math.floor(clampNum(obj.rushServed, 0, 0, 99_999)),
    rushAngryDrops: Math.floor(clampNum(obj.rushAngryDrops, 0, 0, 99_999)),
  }
}

function sanitizeStringList(raw: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback]
  const clean = raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
  return Array.from(new Set([...fallback, ...clean]))
}

function sanitizeState(raw: unknown): MifenSaveState {
  const base = createDefaultMifenState()
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Partial<MifenSaveState>
  const owned = Array.isArray(obj.ownedEquipment)
    ? Array.from(new Set(obj.ownedEquipment.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)))
    : []
  const history = Array.isArray(obj.dailyHistory) ? obj.dailyHistory.slice(-14) : []
  return {
    version: 1,
    funds: roundMoney(clampNum(obj.funds, base.funds, 0, 9_999_999)),
    reputation: Math.round(clampNum(obj.reputation, base.reputation, 1.0, 5.0) * 100) / 100,
    totalBowlsServed: Math.floor(clampNum(obj.totalBowlsServed, 0, 0, 9_999_999)),
    totalRevenue: roundMoney(clampNum(obj.totalRevenue, 0, 0, 99_999_999)),
    perfectBowls: Math.floor(clampNum(obj.perfectBowls, 0, 0, 9_999_999)),
    streak: Math.floor(clampNum(obj.streak, 0, 0, 99_999)),
    shopLevel: clampShopLevel(obj.shopLevel),
    ownedEquipment: owned,
    dailyServed: Math.floor(clampNum(obj.dailyServed, 0, 0, 99_999)),
    lastSavedAt: typeof obj.lastSavedAt === 'number' && Number.isFinite(obj.lastSavedAt) ? obj.lastSavedAt : Date.now(),
    day: Math.floor(clampNum(obj.day, 1, 1, 99_999)),
    inventory: sanitizeInventory(obj.inventory),
    unlockedRecipes: sanitizeStringList(obj.unlockedRecipes, BASE_RECIPE_IDS),
    unlockedAchievements: sanitizeStringList(obj.unlockedAchievements, []),
    totalDeliveries: Math.floor(clampNum(obj.totalDeliveries, 0, 0, 9_999_999)),
    totalRetailSold: Math.floor(clampNum(obj.totalRetailSold, 0, 0, 9_999_999)),
    dailyNetPeak: roundMoney(clampNum(obj.dailyNetPeak, 0, 0, 99_999_999)),
    threeStreamsDays: Math.floor(clampNum(obj.threeStreamsDays, 0, 0, 99_999)),
    today: sanitizeToday(obj.today),
    dailyHistory: history,
  }
}

function cloneState(s: MifenSaveState): MifenSaveState {
  return {
    ...s,
    ownedEquipment: [...s.ownedEquipment],
    inventory: { ...s.inventory },
    unlockedRecipes: [...s.unlockedRecipes],
    unlockedAchievements: [...s.unlockedAchievements],
    today: { ...s.today },
    dailyHistory: s.dailyHistory.map(r => ({
      ...r,
      grossByStream: { ...r.grossByStream },
      netByStream: { ...r.netByStream },
      streamShares: { ...r.streamShares },
    })),
  }
}

function loadPersistedState(): MifenSaveState {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return createDefaultMifenState()
    const raw = window.localStorage.getItem(MIFEN_STORAGE_KEY)
    if (!raw) return createDefaultMifenState()
    return sanitizeState(JSON.parse(raw))
  } catch {
    return createDefaultMifenState()
  }
}

function persistState(state: MifenSaveState): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(MIFEN_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore quota or private mode errors
  }
}

function pickEffectNumber(effect: Record<string, number>, keys: string[]): number {
  for (const key of keys) {
    const val = effect[key]
    if (typeof val === 'number' && Number.isFinite(val)) return val
  }
  return 0
}

export function computeShopBonuses(
  state: Readonly<MifenSaveState>,
  upgrades: readonly MifenUpgradeDef[],
): ShopEquipmentBonuses {
  const bonuses: ShopEquipmentBonuses = {
    boilZoneBonus: state.shopLevel === 3 ? 0.05 : state.shopLevel === 2 ? 0.025 : 0,
    boilSpeedScale: 1,
    sliceSpeedMultiplier: state.shopLevel === 3 ? 1.25 : state.shopLevel === 2 ? 1.1 : 1.0,
    brineZoneBonus: state.shopLevel === 3 ? 0.04 : state.shopLevel === 2 ? 0.02 : 0,
    priceBonusFlat: 0,
    priceMultiplier: state.shopLevel === 3 ? 1.35 : state.shopLevel === 2 ? 1.15 : 1.0,
    qualityBonus: 0,
    tipBonusRatio: state.shopLevel === 3 ? 0.14 : state.shopLevel === 2 ? 0.06 : 0,
    patienceBonusSec: state.shopLevel === 3 ? 10 : state.shopLevel === 2 ? 5 : 0,
    patienceMultiplier: 1.0,
    spawnRateMultiplier: state.shopLevel === 3 ? 1.65 : state.shopLevel === 2 ? 1.3 : 1.0,
    maxQueueBonus: 0,
    reputationGainBonus: 0,
    inventoryCapBonus: state.shopLevel === 3 ? 40 : state.shopLevel === 2 ? 20 : 0,
    spoilageReduction: 0,
    deliveryQuotaBonus: 0,
    packCostDiscount: 0,
  }

  const ownedSet = new Set(state.ownedEquipment)
  for (const def of upgrades) {
    if (def.kind !== 'equipment' || !ownedSet.has(def.id)) continue
    const e = def.effect ?? {}
    bonuses.boilZoneBonus += pickEffectNumber(e, ['boilZoneBonus', 'boilWindowBonus', 'boilWindow', 'boilTolerance']) * 0.45
    bonuses.brineZoneBonus += pickEffectNumber(e, ['brineToleranceBonus', 'brineZoneBonus', 'brineWindowBonus', 'lucaiBonus'])
    bonuses.priceBonusFlat += pickEffectNumber(e, ['priceBonus', 'priceFlat', 'bowlPriceBonus', 'extraPrice'])
    bonuses.tipBonusRatio += pickEffectNumber(e, ['tipBonus', 'tipBonusRatio', 'tipBoost'])
    bonuses.qualityBonus += pickEffectNumber(e, ['qualityBonus'])
    bonuses.patienceBonusSec += pickEffectNumber(e, ['patienceSec', 'patienceBonus', 'patienceBonusSec'])
    bonuses.maxQueueBonus += Math.floor(pickEffectNumber(e, ['maxQueueBonus']))
    bonuses.reputationGainBonus += pickEffectNumber(e, ['reputationBonus', 'repBonus', 'reputationGain'])
    bonuses.inventoryCapBonus += Math.floor(pickEffectNumber(e, ['inventoryCapBonus']))
    bonuses.spoilageReduction += pickEffectNumber(e, ['spoilageReduction'])
    bonuses.deliveryQuotaBonus += Math.floor(pickEffectNumber(e, ['deliveryQuotaBonus']))
    bonuses.packCostDiscount += pickEffectNumber(e, ['packCostDiscount'])

    const priceMult = pickEffectNumber(e, ['priceMultiplier', 'revenueMultiplier'])
    if (priceMult > 1) bonuses.priceMultiplier *= priceMult

    const patMult = pickEffectNumber(e, ['patienceMultiplier'])
    if (patMult > 1) bonuses.patienceMultiplier *= patMult

    const boilSpeed = pickEffectNumber(e, ['boilSpeedMultiplier', 'boilSpeedScale', 'cookSpeed'])
    if (boilSpeed > 1) {
      bonuses.boilSpeedScale *= Math.max(0.76, 1 / Math.sqrt(boilSpeed))
    } else if (boilSpeed > 0 && boilSpeed < 1) {
      bonuses.boilSpeedScale *= boilSpeed
    }

    const sliceSpeed = pickEffectNumber(e, ['sliceSpeedMultiplier'])
    if (sliceSpeed > 1) {
      bonuses.sliceSpeedMultiplier = (bonuses.sliceSpeedMultiplier ?? 1) * sliceSpeed
    }

    const spawnBoost = pickEffectNumber(e, ['spawnRateMultiplier', 'spawnRate', 'trafficBoost'])
    if (spawnBoost > 1) bonuses.spawnRateMultiplier *= spawnBoost
    else if (spawnBoost > 0) bonuses.spawnRateMultiplier += spawnBoost
  }

  bonuses.boilZoneBonus = Math.min(0.24, bonuses.boilZoneBonus)
  bonuses.brineZoneBonus = Math.min(0.22, bonuses.brineZoneBonus)
  bonuses.boilSpeedScale = Math.max(0.68, Math.min(1.12, bonuses.boilSpeedScale))
  bonuses.sliceSpeedMultiplier = Math.max(1.0, Math.min(2.2, bonuses.sliceSpeedMultiplier ?? 1.0))
  bonuses.spawnRateMultiplier = Math.max(0.8, Math.min(2.6, bonuses.spawnRateMultiplier))
  bonuses.spoilageReduction = Math.max(0, Math.min(0.8, bonuses.spoilageReduction))
  bonuses.packCostDiscount = Math.max(0, Math.min(0.6, bonuses.packCostDiscount))
  return bonuses
}

export function createMifenStore(options?: MifenStoreOptions): MifenStore {
  const memoryOnly = Boolean(options?.memoryOnly)
  let state = options?.initialState
    ? sanitizeState({ ...createDefaultMifenState(), ...options.initialState })
    : memoryOnly
      ? createDefaultMifenState()
      : loadPersistedState()
  const listeners = new Set<(next: Readonly<MifenSaveState>) => void>()

  const notify = (): void => {
    state.lastSavedAt = Date.now()
    if (!memoryOnly) persistState(state)
    const snap = cloneState(state)
    for (const fn of listeners) {
      try {
        fn(snap)
      } catch {
        // Keep listeners isolated
      }
    }
  }

  return {
    getState() {
      return cloneState(state)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    addFunds(delta) {
      if (!Number.isFinite(delta)) return state.funds
      state.funds = Math.max(0, roundMoney(state.funds + delta))
      if (delta > 0) state.totalRevenue = roundMoney(state.totalRevenue + delta)
      notify()
      return state.funds
    },
    grantFunds(amount) {
      if (!Number.isFinite(amount)) return state.funds
      state.funds = Math.max(0, roundMoney(state.funds + amount))
      notify()
      return state.funds
    },
    spendFunds(cost) {
      const normalized = Math.max(0, roundMoney(cost))
      if (state.funds + 0.001 < normalized) return false
      state.funds = Math.max(0, roundMoney(state.funds - normalized))
      notify()
      return true
    },
    recordBowlServed(summary, bonuses) {
      const earned = Math.max(0, roundMoney(summary.revenue + summary.tip))
      state.funds = roundMoney(state.funds + earned)
      state.totalRevenue = roundMoney(state.totalRevenue + earned)
      state.totalBowlsServed += 1
      state.dailyServed += 1
      state.today.dineInBowls += 1
      state.today.dineInGross = roundMoney(state.today.dineInGross + earned)
      state.today.dineInNet = roundMoney(state.today.dineInNet + earned)
      if (summary.stars === 3) {
        state.perfectBowls += 1
        state.streak += 1
      } else {
        state.streak = 0
      }

      const baseRepDelta = summary.stars === 3 ? 0.08 : summary.stars === 2 ? 0.03 : -0.04
      const repBoost = summary.stars >= 2 ? (bonuses?.reputationGainBonus ?? 0) * 0.005 : 0
      const prevRep = state.reputation
      state.reputation = Math.round(Math.min(5.0, Math.max(1.0, state.reputation + baseRepDelta + repBoost)) * 100) / 100
      notify()
      return { reputationDelta: Math.round((state.reputation - prevRep) * 100) / 100 }
    },
    recordCustomerLeftAngry() {
      state.streak = 0
      state.today.rushAngryDrops += 1
      state.reputation = Math.round(Math.max(1.0, state.reputation - 0.12) * 100) / 100
      notify()
    },
    setShopLevel(level) {
      state.shopLevel = clampShopLevel(level)
      notify()
      return state.shopLevel
    },
    addEquipment(id) {
      if (!id || state.ownedEquipment.includes(id)) return false
      state.ownedEquipment = [...state.ownedEquipment, id]
      notify()
      return true
    },
    hasEquipment(id) {
      return state.ownedEquipment.includes(id)
    },
    unlockRecipe(id) {
      if (!id || state.unlockedRecipes.includes(id)) return false
      state.unlockedRecipes = [...state.unlockedRecipes, id]
      notify()
      return true
    },
    unlockAchievement(id) {
      if (!id || state.unlockedAchievements.includes(id)) return false
      state.unlockedAchievements = [...state.unlockedAchievements, id]
      notify()
      return true
    },
    updateState(mutator) {
      const draft = cloneState(state)
      mutator(draft)
      state = sanitizeState(draft)
      notify()
      return cloneState(state)
    },
    reset() {
      state = createDefaultMifenState()
      notify()
      return this.getState()
    },
  }
}
