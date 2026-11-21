import {
  clampUpgradesForModel,
  DEFAULT_EQUIPPED_OUTFIT,
  DEFAULT_OWNED_OUTFIT_ITEMS,
  ECONOMY_CONSTANTS,
  isPersonalEbikeModelId,
  OUTFIT_ITEM_MAP,
  OUTFIT_PRESET_MAP,
  PERSONAL_EBIKE_MODELS,
  sanitizeVisualForModel,
  type EquippedOutfit,
  type OutfitSlot,
  type PersistedEbikeUpgrades,
  type PersistedEbikeVisual,
  type PersonalEbikeModelId,
} from './catalog'

export type PlayerMode = 'foot' | 'ebike' | 'bike' | 'car' | 'boat' | 'fly'
export type VehicleOwnership = 'shared' | 'personal' | 'test_ride'

export interface ActiveVehicleState {
  // docs/plan-2.md baseline fields (preserved 100%)
  kind: string
  id: string
  speedKmh: number
  gear?: 'D' | 'R' | 'N'
  damage: number // 0..1
  // Stage 1 incremental fields
  ownership?: VehicleOwnership
  modelId?: PersonalEbikeModelId
  gearLabel?: 'P' | 'D1' | 'D2' | 'D3' | 'S' | 'D' | 'R' | 'N'
  batteryPct?: number
  durabilityPct?: number
  parkLocked?: boolean
}

export interface ActiveMissionState {
  id: string
  title: string
  step: string
  target?: [number, number]
  timer?: number
  meter?: {label: string; value: number}
  line?: {who: string; text: string}
}

export interface OwnedPersonalEbike {
  id: string
  modelId: PersonalEbikeModelId
  nickname?: string
  purchasedAt: number
  batteryPct: number // 0..100
  durabilityPct: number // 15..100
  odometerKm: number
  upgrades: PersistedEbikeUpgrades
  visual: PersistedEbikeVisual
}

export interface ActiveTestRideState {
  shopId: string
  modelId: PersonalEbikeModelId
  instanceId: string
  startedAt: number
  expiresAt: number
  origin: [number, number]
  maxRadiusM: number
  outOfBoundsSince: number | null
}

export interface WardrobeState {
  ownedItemIds: string[]
  ownedPresetIds: string[]
  equipped: EquippedOutfit
  autoHelmetOnRide: boolean
}

export interface GarageState {
  activeVehicleId: string | null
  vehicles: Record<string, OwnedPersonalEbike>
  activeWorldInstanceId: string | null
  summonCooldownUntil: number
  activeTestRide: ActiveTestRideState | null
}

export interface ActiveShopState {
  shopId: string
  kind: 'clothing' | 'ebike'
  openedAt: number
}

export interface LedgerTxRecord {
  txId: string
  idempotencyKey: string
  kind: 'purchase' | 'reward' | 'service' | 'rental' | 'refund' | 'fine'
  delta: number
  balanceAfter: number
  refId: string
  at: number
}

export interface MissionHistoryEntry {
  count: number
  lastAt: number
}

export interface EconomySaveBlock {
  spotsClaimed: string[]
  firstClearClaimed: string[]
  missionHistory: Record<string, MissionHistoryEntry>
  txHistoryRing: LedgerTxRecord[]
}

export interface SaveMetaBlock {
  cloudRevision: number
  lastSyncedAt: number | null
  migratedLegacyStamps: boolean
}

export interface LocalSaveV1 {
  schemaVersion: 2
  money: number
  owned: string[] // v1 compatibility mirror of owned PersonalEbikeModelId[]
  spotsFound: string[]
  missionsDone: string[]
  updatedAt: number
  wardrobe: WardrobeState
  garage: {
    activeVehicleId: string | null
    vehicles: Record<string, OwnedPersonalEbike>
  }
  economy: EconomySaveBlock
  saveMeta: SaveMetaBlock
}

export interface GameState {
  // docs/plan-2.md baseline 6 fields (strictly preserved)
  mode: PlayerMode
  vehicle: ActiveVehicleState | null
  money: number
  wanted: 0 | 1 | 2 | 3 | 4 | 5
  mission: ActiveMissionState | null
  zone: {quiet: boolean; name?: string}
  // Stage 1 incremental fields
  wardrobe: WardrobeState
  garage: GarageState
  activeShop: ActiveShopState | null
  spotsFound: string[]
  missionsDone: string[]
  economy: EconomySaveBlock
  saveMeta: SaveMetaBlock
  walletSeq: number
}

export type GameEvent =
  | {type: 'mission:start'; id: string; title: string}
  | {type: 'mission:done'; id: string; reward: number; firstClear?: boolean}
  | {type: 'fine'; amount: number; reason: string}
  | {type: 'crash'; severity: number; vehicleId?: string}
  | {type: 'money:change'; delta: number; balance: number; reason: string; txId: string}
  | {type: 'shop:open'; shopId: string; kind: 'clothing' | 'ebike'}
  | {type: 'shop:close'; shopId: string; reason: 'user' | 'esc' | 'fly' | 'teleport' | 'testride'}
  | {type: 'shop:preview'; shopId: string; itemType: 'outfit' | 'ebike' | 'ebike_mod'; itemId: string}
  | {type: 'shop:buy'; shopId: string; itemType: string; itemId: string; price: number; txId: string}
  | {type: 'outfit:equip'; equipped: EquippedOutfit}
  | {type: 'garage:select'; vehicleId: string}
  | {type: 'garage:summon'; vehicleId: string; pos: [number, number, number]; yaw: number}
  | {type: 'garage:mod'; vehicleId: string; upgrades: PersistedEbikeUpgrades; visual: PersistedEbikeVisual}
  | {type: 'garage:service'; vehicleId: string; batteryPct: number; durabilityPct: number; cost: number}
  | {type: 'testride:start'; shopId: string; modelId: PersonalEbikeModelId; expiresAt: number}
  | {type: 'testride:end'; modelId: PersonalEbikeModelId; reason: 'timeout' | 'out_of_bounds' | 'user' | 'dismount_far' | 'mode_switch' | 'purchase'}
  | {type: 'save:loaded'; source: 'local' | 'cloud' | 'default'; migratedFrom?: string}
  | {type: 'save:synced'; revision: number; updatedAt: number}

export const SAVE_STORAGE_KEY = 'glol.save.v1'
export const SAVE_CORRUPT_BACKUP_KEY = 'glol.save.v1.corrupt'
export const LEGACY_STAMPS_KEY = 'glol.stamps'
export const TX_HISTORY_MAX = 64

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

let activeStorage: StorageLike | null = defaultStorage()
let dirtyPersistTimer: ReturnType<typeof setTimeout> | null = null
let pendingPersist = false

export function setSaveStorageForTest(storage: StorageLike | null) {
  activeStorage = storage
}

function uniqueStrings(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (typeof item === 'string' && item.length > 0 && item.length <= 128 && !seen.has(item)) {
      seen.add(item)
      out.push(item)
    }
  }
  return out
}

export function createDefaultSave(now = Date.now()): LocalSaveV1 {
  return {
    schemaVersion: 2,
    money: ECONOMY_CONSTANTS.INITIAL_MONEY,
    owned: [],
    spotsFound: [],
    missionsDone: [],
    updatedAt: now,
    wardrobe: {
      ownedItemIds: [...DEFAULT_OWNED_OUTFIT_ITEMS],
      ownedPresetIds: ['outfit_default'],
      equipped: {...DEFAULT_EQUIPPED_OUTFIT},
      autoHelmetOnRide: true,
    },
    garage: {
      activeVehicleId: null,
      vehicles: {},
    },
    economy: {
      spotsClaimed: [],
      firstClearClaimed: [],
      missionHistory: {},
      txHistoryRing: [],
    },
    saveMeta: {
      cloudRevision: 0,
      lastSyncedAt: null,
      migratedLegacyStamps: false,
    },
  }
}

function sanitizeMoney(v: unknown, fallback: number = ECONOMY_CONSTANTS.INITIAL_MONEY): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.max(0, Math.min(ECONOMY_CONSTANTS.MAX_MONEY, Math.trunc(v)))
}

function sanitizePct(v: unknown, fallback = 100, min = 0): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.max(min, Math.min(100, Math.round(v * 10) / 10))
}

function sanitizeVehicleRecord(id: string, raw: unknown): OwnedPersonalEbike | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isPersonalEbikeModelId(r.modelId)) return null
  const modelId = r.modelId
  return {
    id: typeof r.id === 'string' && r.id.length > 0 && !r.id.startsWith('test-ride:') ? r.id : id,
    modelId,
    nickname: typeof r.nickname === 'string' ? r.nickname.slice(0, 32) : undefined,
    purchasedAt: typeof r.purchasedAt === 'number' && Number.isFinite(r.purchasedAt) ? Math.trunc(r.purchasedAt) : Date.now(),
    batteryPct: sanitizePct(r.batteryPct, 100, 0),
    durabilityPct: sanitizePct(r.durabilityPct, 100, 15),
    odometerKm: typeof r.odometerKm === 'number' && Number.isFinite(r.odometerKm) && r.odometerKm >= 0 ? Math.round(r.odometerKm * 100) / 100 : 0,
    upgrades: clampUpgradesForModel(modelId, r.upgrades as Partial<PersistedEbikeUpgrades>),
    visual: sanitizeVisualForModel(modelId, r.visual as Partial<PersistedEbikeVisual>),
  }
}

function sanitizeEquipped(raw: unknown, ownedItemSet: Set<string>): EquippedOutfit {
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const slots: OutfitSlot[] = ['top', 'bottom', 'shoes', 'hat', 'bag']
  const out: EquippedOutfit = {...DEFAULT_EQUIPPED_OUTFIT}
  for (const slot of slots) {
    const candidate = rec[slot]
    if (typeof candidate === 'string' && ownedItemSet.has(candidate)) {
      const def = OUTFIT_ITEM_MAP.get(candidate)
      if (!def || def.slot === slot) out[slot] = candidate
    }
  }
  return out
}

function sanitizeTxHistory(raw: unknown): LedgerTxRecord[] {
  if (!Array.isArray(raw)) return []
  const out: LedgerTxRecord[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.txId !== 'string' || typeof r.idempotencyKey !== 'string') continue
    const kind = r.kind
    if (kind !== 'purchase' && kind !== 'reward' && kind !== 'service' && kind !== 'rental' && kind !== 'refund' && kind !== 'fine') continue
    if (typeof r.delta !== 'number' || !Number.isFinite(r.delta)) continue
    out.push({
      txId: r.txId,
      idempotencyKey: r.idempotencyKey,
      kind,
      delta: Math.trunc(r.delta),
      balanceAfter: sanitizeMoney(r.balanceAfter, 0),
      refId: typeof r.refId === 'string' ? r.refId : '',
      at: typeof r.at === 'number' && Number.isFinite(r.at) ? Math.trunc(r.at) : Date.now(),
    })
  }
  return out.slice(-TX_HISTORY_MAX)
}

export function sanitizeSave(raw: unknown, legacyStamps: readonly string[] = []): {save: LocalSaveV1; migratedFrom?: string} {
  const base = createDefaultSave()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {save: base}
  }
  const r = raw as Record<string, unknown>
  const wasV1 = r.schemaVersion !== 2
  const money = sanitizeMoney(r.money, base.money)
  const spotsFound = uniqueStrings([...uniqueStrings(r.spotsFound), ...legacyStamps])
  const missionsDone = uniqueStrings(r.missionsDone)
  const updatedAt = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? Math.trunc(r.updatedAt) : Date.now()

  // Wardrobe
  const rawWardrobe = (r.wardrobe && typeof r.wardrobe === 'object' ? r.wardrobe : {}) as Record<string, unknown>
  const ownedItemIds = uniqueStrings([...DEFAULT_OWNED_OUTFIT_ITEMS, ...uniqueStrings(rawWardrobe.ownedItemIds)])
  const ownedItemSet = new Set(ownedItemIds)
  const ownedPresetIds = uniqueStrings(['outfit_default', ...uniqueStrings(rawWardrobe.ownedPresetIds)]).filter(
    id => OUTFIT_PRESET_MAP.has(id),
  )
  const wardrobe: WardrobeState = {
    ownedItemIds,
    ownedPresetIds,
    equipped: sanitizeEquipped(rawWardrobe.equipped, ownedItemSet),
    autoHelmetOnRide: typeof rawWardrobe.autoHelmetOnRide === 'boolean' ? rawWardrobe.autoHelmetOnRide : true,
  }

  // Garage (plus v1 `owned[]` materialization)
  const rawGarage = (r.garage && typeof r.garage === 'object' ? r.garage : {}) as Record<string, unknown>
  const vehicles: Record<string, OwnedPersonalEbike> = {}
  if (rawGarage.vehicles && typeof rawGarage.vehicles === 'object') {
    for (const [k, v] of Object.entries(rawGarage.vehicles as Record<string, unknown>)) {
      if (k.startsWith('test-ride:')) continue
      const clean = sanitizeVehicleRecord(k, v)
      if (clean) vehicles[clean.id] = clean
    }
  }
  for (const legacyModel of uniqueStrings(r.owned)) {
    if (!isPersonalEbikeModelId(legacyModel)) continue
    const hasModel = Object.values(vehicles).some(v => v.modelId === legacyModel)
    if (!hasModel) {
      const id = `ebike_legacy_${legacyModel}`
      const def = PERSONAL_EBIKE_MODELS[legacyModel]
      vehicles[id] = {
        id,
        modelId: legacyModel,
        purchasedAt: updatedAt,
        batteryPct: 100,
        durabilityPct: 100,
        odometerKm: 0,
        upgrades: {motorLevel: 0, controllerLevel: 0, batteryLevel: 0},
        visual: {...def.defaultVisual},
      }
    }
  }
  const vehicleIds = Object.keys(vehicles)
  const rawActiveId = typeof rawGarage.activeVehicleId === 'string' ? rawGarage.activeVehicleId : null
  const activeVehicleId = rawActiveId && vehicles[rawActiveId] ? rawActiveId : (vehicleIds[0] ?? null)
  const ownedMirror = uniqueStrings(Object.values(vehicles).map(v => v.modelId))

  // Economy (with backwards-compatible alias mapping for early draft keys)
  const rawEcon = (r.economy && typeof r.economy === 'object' ? r.economy : {}) as Record<string, unknown>
  const spotsClaimed = uniqueStrings([
    ...uniqueStrings(rawEcon.spotsClaimed),
    ...uniqueStrings(rawEcon.claimedSpotBounties),
    ...uniqueStrings(r.spotsClaimed),
  ])
  const firstClearClaimed = uniqueStrings([
    ...uniqueStrings(rawEcon.firstClearClaimed),
    ...uniqueStrings(rawEcon.claimedMissionFirstClear),
    ...uniqueStrings(r.firstClearClaimed),
  ])
  const missionHistory: Record<string, MissionHistoryEntry> = {}
  const rawHist = (rawEcon.missionHistory ?? r.missionHistory) as Record<string, unknown> | undefined
  if (rawHist && typeof rawHist === 'object') {
    for (const [mid, val] of Object.entries(rawHist)) {
      if (!val || typeof val !== 'object') continue
      const hv = val as Record<string, unknown>
      const count = typeof hv.count === 'number' && Number.isFinite(hv.count) ? Math.max(0, Math.trunc(hv.count)) : 0
      const lastAt = typeof hv.lastAt === 'number' && Number.isFinite(hv.lastAt) ? Math.trunc(hv.lastAt) : 0
      if (count > 0) missionHistory[mid] = {count, lastAt}
    }
  }

  const rawMeta = (r.saveMeta && typeof r.saveMeta === 'object' ? r.saveMeta : {}) as Record<string, unknown>
  const save: LocalSaveV1 = {
    schemaVersion: 2,
    money,
    owned: ownedMirror,
    spotsFound,
    missionsDone,
    updatedAt,
    wardrobe,
    garage: {activeVehicleId, vehicles},
    economy: {
      spotsClaimed,
      firstClearClaimed,
      missionHistory,
      txHistoryRing: sanitizeTxHistory(rawEcon.txHistoryRing),
    },
    saveMeta: {
      cloudRevision: typeof rawMeta.cloudRevision === 'number' && Number.isFinite(rawMeta.cloudRevision) ? Math.max(0, Math.trunc(rawMeta.cloudRevision)) : 0,
      lastSyncedAt: typeof rawMeta.lastSyncedAt === 'number' && Number.isFinite(rawMeta.lastSyncedAt) ? Math.trunc(rawMeta.lastSyncedAt) : null,
      migratedLegacyStamps: Boolean(rawMeta.migratedLegacyStamps || legacyStamps.length > 0),
    },
  }
  return {save, migratedFrom: wasV1 ? 'v1' : legacyStamps.length > 0 && !rawMeta.migratedLegacyStamps ? 'glol.stamps' : undefined}
}

function readLegacyStamps(storage: StorageLike | null): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(LEGACY_STAMPS_KEY)
    if (!raw) return []
    return uniqueStrings(JSON.parse(raw))
  } catch {
    return []
  }
}

function toSaveSnapshot(s: GameState): LocalSaveV1 {
  const vehiclesCopy: Record<string, OwnedPersonalEbike> = {}
  for (const [id, v] of Object.entries(s.garage.vehicles)) {
    if (id.startsWith('test-ride:')) continue
    vehiclesCopy[id] = {
      ...v,
      upgrades: {...v.upgrades},
      visual: {...v.visual},
    }
  }
  return {
    schemaVersion: 2,
    money: s.money,
    owned: uniqueStrings(Object.values(vehiclesCopy).map(v => v.modelId)),
    spotsFound: [...s.spotsFound],
    missionsDone: [...s.missionsDone],
    updatedAt: Date.now(),
    wardrobe: {
      ownedItemIds: [...s.wardrobe.ownedItemIds],
      ownedPresetIds: [...s.wardrobe.ownedPresetIds],
      equipped: {...s.wardrobe.equipped},
      autoHelmetOnRide: s.wardrobe.autoHelmetOnRide,
    },
    garage: {
      activeVehicleId: s.garage.activeVehicleId,
      vehicles: vehiclesCopy,
    },
    economy: {
      spotsClaimed: [...s.economy.spotsClaimed],
      firstClearClaimed: [...s.economy.firstClearClaimed],
      missionHistory: Object.fromEntries(Object.entries(s.economy.missionHistory).map(([k, v]) => [k, {...v}])),
      txHistoryRing: s.economy.txHistoryRing.slice(-TX_HISTORY_MAX).map(t => ({...t})),
    },
    saveMeta: {...s.saveMeta},
  }
}

export function writeSaveSnapshotToStorage(snapshot: LocalSaveV1, storage: StorageLike | null = activeStorage): boolean {
  if (!storage) return true
  const attempt = (payload: LocalSaveV1) => {
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(payload))
    // Keep legacy `glol.stamps` dual-written for zero regression with `play/index.ts`
    if (payload.spotsFound.length > 0) {
      const merged = uniqueStrings([...readLegacyStamps(storage), ...payload.spotsFound])
      try {
        storage.setItem(LEGACY_STAMPS_KEY, JSON.stringify(merged))
      } catch {
        // Non-fatal: primary save already succeeded
      }
    }
  }
  try {
    attempt(snapshot)
    return true
  } catch {
    // Retry once after trimming txHistoryRing on QuotaExceededError
    try {
      const trimmed: LocalSaveV1 = {
        ...snapshot,
        economy: {
          ...snapshot.economy,
          txHistoryRing: snapshot.economy.txHistoryRing.slice(-16),
        },
      }
      attempt(trimmed)
      return true
    } catch {
      return false
    }
  }
}

function buildGameStateFromSave(save: LocalSaveV1): GameState {
  return {
    mode: 'foot',
    vehicle: null,
    money: save.money,
    wanted: 0,
    mission: null,
    zone: {quiet: false},
    wardrobe: {
      ownedItemIds: [...save.wardrobe.ownedItemIds],
      ownedPresetIds: [...save.wardrobe.ownedPresetIds],
      equipped: {...save.wardrobe.equipped},
      autoHelmetOnRide: save.wardrobe.autoHelmetOnRide,
    },
    garage: {
      activeVehicleId: save.garage.activeVehicleId,
      vehicles: Object.fromEntries(
        Object.entries(save.garage.vehicles).map(([id, v]) => [id, {...v, upgrades: {...v.upgrades}, visual: {...v.visual}}]),
      ),
      activeWorldInstanceId: null,
      summonCooldownUntil: 0,
      activeTestRide: null,
    },
    activeShop: null,
    spotsFound: [...save.spotsFound],
    missionsDone: [...save.missionsDone],
    economy: {
      spotsClaimed: [...save.economy.spotsClaimed],
      firstClearClaimed: [...save.economy.firstClearClaimed],
      missionHistory: Object.fromEntries(Object.entries(save.economy.missionHistory).map(([k, v]) => [k, {...v}])),
      txHistoryRing: save.economy.txHistoryRing.map(t => ({...t})),
    },
    saveMeta: {...save.saveMeta},
    walletSeq: 0,
  }
}

let state: GameState = buildGameStateFromSave(createDefaultSave())
const stateListeners = new Set<(s: Readonly<GameState>, changed: Set<keyof GameState>) => void>()
const eventListeners = new Set<(e: GameEvent) => void>()

export function getState(): Readonly<GameState> {
  return state
}

export function onState(fn: (s: Readonly<GameState>, changed: Set<keyof GameState>) => void): () => void {
  stateListeners.add(fn)
  return () => { stateListeners.delete(fn) }
}

export function onEvent(fn: (e: GameEvent) => void): () => void {
  eventListeners.add(fn)
  return () => { eventListeners.delete(fn) }
}

export function emit(event: GameEvent): void {
  for (const fn of [...eventListeners]) {
    try {
      fn(event)
    } catch (err) {
      console.error('[game/state] event listener error:', err)
    }
  }
}

function notifyChanged(changed: Iterable<keyof GameState>): void {
  const set = new Set<keyof GameState>(changed)
  if (set.size === 0) return
  for (const fn of [...stateListeners]) {
    try {
      fn(state, set)
    } catch (err) {
      console.error('[game/state] state listener error:', err)
    }
  }
}

export function exportSaveSnapshot(): LocalSaveV1 {
  return toSaveSnapshot(state)
}

export function flushSaveNow(): boolean {
  if (dirtyPersistTimer !== null) {
    clearTimeout(dirtyPersistTimer)
    dirtyPersistTimer = null
  }
  pendingPersist = false
  return writeSaveSnapshotToStorage(toSaveSnapshot(state))
}

function scheduleThrottledPersist(): void {
  pendingPersist = true
  if (dirtyPersistTimer !== null) return
  dirtyPersistTimer = setTimeout(() => {
    dirtyPersistTimer = null
    if (pendingPersist) flushSaveNow()
  }, 1500)
}

/**
 * Controlled state mutation helper used by `commerce.ts`, `walk/*`, and `play/*`.
 * When `persist === 'immediate'`, commits to storage BEFORE swapping in-memory state
 * so failed storage writes never leave dirty wallet/asset state in memory.
 */
export function commitStateMutation(
  mutator: (draft: GameState) => (keyof GameState)[],
  options?: {persist?: 'none' | 'throttled' | 'immediate'},
): {ok: boolean} {
  const draft: GameState = {
    ...state,
    vehicle: state.vehicle ? {...state.vehicle} : null,
    mission: state.mission ? {...state.mission} : null,
    zone: {...state.zone},
    wardrobe: {
      ownedItemIds: [...state.wardrobe.ownedItemIds],
      ownedPresetIds: [...state.wardrobe.ownedPresetIds],
      equipped: {...state.wardrobe.equipped},
      autoHelmetOnRide: state.wardrobe.autoHelmetOnRide,
    },
    garage: {
      ...state.garage,
      vehicles: Object.fromEntries(
        Object.entries(state.garage.vehicles).map(([id, v]) => [id, {...v, upgrades: {...v.upgrades}, visual: {...v.visual}}]),
      ),
      activeTestRide: state.garage.activeTestRide ? {...state.garage.activeTestRide} : null,
    },
    activeShop: state.activeShop ? {...state.activeShop} : null,
    spotsFound: [...state.spotsFound],
    missionsDone: [...state.missionsDone],
    economy: {
      spotsClaimed: [...state.economy.spotsClaimed],
      firstClearClaimed: [...state.economy.firstClearClaimed],
      missionHistory: Object.fromEntries(Object.entries(state.economy.missionHistory).map(([k, v]) => [k, {...v}])),
      txHistoryRing: state.economy.txHistoryRing.map(t => ({...t})),
    },
    saveMeta: {...state.saveMeta},
  }
  const changed = mutator(draft)
  const mode = options?.persist ?? 'none'
  if (mode === 'immediate') {
    const snap = toSaveSnapshot(draft)
    if (!writeSaveSnapshotToStorage(snap)) {
      return {ok: false}
    }
    pendingPersist = false
    if (dirtyPersistTimer !== null) {
      clearTimeout(dirtyPersistTimer)
      dirtyPersistTimer = null
    }
  }
  state = draft
  if (mode === 'throttled') scheduleThrottledPersist()
  notifyChanged(changed)
  return {ok: true}
}

export function loadSaveFromStorage(storage: StorageLike | null = activeStorage): {
  source: 'local' | 'default'
  corrupted: boolean
  migratedFrom?: string
} {
  const legacyStamps = readLegacyStamps(storage)
  if (!storage) {
    state = buildGameStateFromSave(createDefaultSave())
    emit({type: 'save:loaded', source: 'default'})
    return {source: 'default', corrupted: false}
  }
  const rawText = storage.getItem(SAVE_STORAGE_KEY)
  if (!rawText) {
    const fresh = createDefaultSave()
    if (legacyStamps.length > 0) {
      fresh.spotsFound = [...legacyStamps]
      fresh.saveMeta.migratedLegacyStamps = true
      writeSaveSnapshotToStorage(fresh, storage)
    }
    state = buildGameStateFromSave(fresh)
    notifyChanged(['money', 'wardrobe', 'garage', 'spotsFound', 'missionsDone', 'economy', 'saveMeta'])
    emit({type: 'save:loaded', source: legacyStamps.length > 0 ? 'local' : 'default', migratedFrom: legacyStamps.length > 0 ? 'glol.stamps' : undefined})
    return {source: legacyStamps.length > 0 ? 'local' : 'default', corrupted: false, migratedFrom: legacyStamps.length > 0 ? 'glol.stamps' : undefined}
  }
  try {
    const parsed = JSON.parse(rawText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Root save is not a JSON object')
    }
    const {save, migratedFrom} = sanitizeSave(parsed, legacyStamps)
    state = buildGameStateFromSave(save)
    if (migratedFrom) writeSaveSnapshotToStorage(save, storage)
    notifyChanged(['money', 'wardrobe', 'garage', 'spotsFound', 'missionsDone', 'economy', 'saveMeta'])
    emit({type: 'save:loaded', source: 'local', migratedFrom})
    return {source: 'local', corrupted: false, migratedFrom}
  } catch {
    try {
      storage.setItem(SAVE_CORRUPT_BACKUP_KEY, rawText)
    } catch {
      // ignore backup quota errors
    }
    const recovered = createDefaultSave()
    if (legacyStamps.length > 0) {
      recovered.spotsFound = [...legacyStamps]
      recovered.saveMeta.migratedLegacyStamps = true
    }
    state = buildGameStateFromSave(recovered)
    writeSaveSnapshotToStorage(recovered, storage)
    notifyChanged(['money', 'wardrobe', 'garage', 'spotsFound', 'missionsDone', 'economy', 'saveMeta'])
    emit({type: 'save:loaded', source: 'default'})
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text: '检测到本地存档损坏，已备份并重置为安全档案', ms: 3200}}))
    }
    return {source: 'default', corrupted: true}
  }
}

export function resetStateForTest(initialMoney = ECONOMY_CONSTANTS.INITIAL_MONEY): void {
  if (dirtyPersistTimer !== null) {
    clearTimeout(dirtyPersistTimer)
    dirtyPersistTimer = null
  }
  pendingPersist = false
  const fresh = createDefaultSave()
  fresh.money = sanitizeMoney(initialMoney, ECONOMY_CONSTANTS.INITIAL_MONEY)
  state = buildGameStateFromSave(fresh)
}

export function updateTravelState(patch: {
  mode?: PlayerMode
  vehicle?: ActiveVehicleState | null
  zone?: {quiet: boolean; name?: string}
  wanted?: 0 | 1 | 2 | 3 | 4 | 5
  mission?: ActiveMissionState | null
}): void {
  commitStateMutation(draft => {
    const changed: (keyof GameState)[] = []
    if (patch.mode !== undefined && patch.mode !== draft.mode) { draft.mode = patch.mode; changed.push('mode') }
    if (patch.vehicle !== undefined) { draft.vehicle = patch.vehicle; changed.push('vehicle') }
    if (patch.zone !== undefined && (patch.zone.quiet !== draft.zone.quiet || patch.zone.name !== draft.zone.name)) {
      draft.zone = {...patch.zone}; changed.push('zone')
    }
    if (patch.wanted !== undefined && patch.wanted !== draft.wanted) { draft.wanted = patch.wanted; changed.push('wanted') }
    if (patch.mission !== undefined) { draft.mission = patch.mission; changed.push('mission') }
    return changed
  })
}

export function registerSpotFound(spotId: string): boolean {
  if (!spotId || state.spotsFound.includes(spotId)) return false
  commitStateMutation(
    draft => {
      draft.spotsFound.push(spotId)
      return ['spotsFound']
    },
    {persist: 'immediate'},
  )
  return true
}

export function equipOutfitSlots(patch: Partial<EquippedOutfit>): {ok: boolean; equipped: EquippedOutfit} {
  const owned = new Set(state.wardrobe.ownedItemIds)
  for (const [slot, itemId] of Object.entries(patch) as [OutfitSlot, string][]) {
    if (!owned.has(itemId)) return {ok: false, equipped: {...state.wardrobe.equipped}}
    const def = OUTFIT_ITEM_MAP.get(itemId)
    if (def && def.slot !== slot) return {ok: false, equipped: {...state.wardrobe.equipped}}
  }
  const res = commitStateMutation(
    draft => {
      draft.wardrobe.equipped = {...draft.wardrobe.equipped, ...patch}
      return ['wardrobe']
    },
    {persist: 'immediate'},
  )
  if (res.ok) emit({type: 'outfit:equip', equipped: {...state.wardrobe.equipped}})
  return {ok: res.ok, equipped: {...state.wardrobe.equipped}}
}

export function setAutoHelmetOnRide(on: boolean): void {
  commitStateMutation(
    draft => {
      draft.wardrobe.autoHelmetOnRide = on
      return ['wardrobe']
    },
    {persist: 'immediate'},
  )
}

export function selectActivePersonalVehicle(vehicleId: string): boolean {
  if (!state.garage.vehicles[vehicleId]) return false
  const res = commitStateMutation(
    draft => {
      draft.garage.activeVehicleId = vehicleId
      return ['garage']
    },
    {persist: 'immediate'},
  )
  if (res.ok) emit({type: 'garage:select', vehicleId})
  return res.ok
}

export function syncPersonalVehicleTelemetry(
  vehicleId: string,
  patch: {batteryPct?: number; durabilityPct?: number; odometerDeltaKm?: number},
  immediate = false,
): boolean {
  if (!state.garage.vehicles[vehicleId]) return false
  const res = commitStateMutation(
    draft => {
      const target = draft.garage.vehicles[vehicleId]
      if (!target) return []
      if (patch.batteryPct !== undefined) target.batteryPct = sanitizePct(patch.batteryPct, target.batteryPct, 0)
      if (patch.durabilityPct !== undefined) target.durabilityPct = sanitizePct(patch.durabilityPct, target.durabilityPct, 15)
      if (patch.odometerDeltaKm !== undefined && Number.isFinite(patch.odometerDeltaKm) && patch.odometerDeltaKm > 0) {
        target.odometerKm = Math.round((target.odometerKm + patch.odometerDeltaKm) * 100) / 100
      }
      return ['garage']
    },
    {persist: immediate ? 'immediate' : 'throttled'},
  )
  return res.ok
}

export function setActiveShopState(shop: ActiveShopState | null): void {
  commitStateMutation(draft => {
    draft.activeShop = shop ? {...shop} : null
    return ['activeShop']
  })
}

export function setActiveTestRideState(testRide: ActiveTestRideState | null): void {
  commitStateMutation(draft => {
    draft.garage.activeTestRide = testRide ? {...testRide} : null
    return ['garage']
  })
}

export function setActiveWorldPersonalVehicle(vehicleId: string | null, cooldownUntil?: number): void {
  commitStateMutation(draft => {
    draft.garage.activeWorldInstanceId = vehicleId
    if (cooldownUntil !== undefined) draft.garage.summonCooldownUntil = cooldownUntil
    return ['garage']
  })
}

// Browser lifecycle flush hooks (safe in headless/Node test environments)
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  loadSaveFromStorage()
  window.addEventListener('pagehide', () => { if (pendingPersist) flushSaveNow() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pendingPersist) flushSaveNow()
  })
}
