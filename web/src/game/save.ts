import {readPacks, type Pack} from '../smoke/data'
/**
 * Backward-compatible persistence layer for `localStorage['glol.save.v1']` (schemaVersion: 2).
 *
 * Guarantees (docs/commerce-shops-spec.md §1.2-1.3 & IDOK-122):
 *  - Preserves docs/plan-2.md v1 top-level keys `{ money, owned, spotsFound, missionsDone, updatedAt }`.
 *  - Non-destructive migration of legacy `localStorage['glol.stamps']` (never deletes old key; dual-writes on spot unlock;
 *    never silently injects cash for legacy stamps — rewards are gated once per spot via `economy.claimedSpotBounties`).
 *  - Corrupt JSON backup to `localStorage['glol.save.v1.corrupt']` + safe default reset + toast notification.
 *  - Strict field sanitization & clamping (money, battery/durability, model upgrade caps <= 70 km/h, valid equipped fallback;
 *    `activeTestRide` is NEVER serialized).
 *  - Immediate sync persist for transactions; 1500ms throttled persist + pagehide/visibilitychange flush for telemetry;
 *    QuotaExceededError trims `txHistoryRing` to 16 and retries once before propagating failure for rollback.
 *  - Deterministic offline-guest <-> cloud save merger (`mergeCloudAndLocalSave`) + 64 KiB payload guard.
 */

import {AVATAR_KEY, sanitizeAvatar, type Avatar} from '../../../lib/avatar'
import {
  DEFAULT_EQUIPPED_OUTFIT,
  DEFAULT_OWNED_OUTFIT_ITEMS,
  DEFAULT_OWNED_OUTFIT_PRESETS,
  DEFAULT_START_MONEY,
  MAX_SAFE_MONEY,
  OUTFIT_ITEMS_BY_ID,
  OUTFIT_PRESETS_BY_ID,
  clampPersonalUpgrades,
  createDefaultVisualForModel,
  isPersonalEbikeModelId,
  type EquippedOutfit,
  type OutfitSlot,
  type PersonalEbikeModelId,
  type PersistedEbikeVisual,
} from './catalog'
import {
  _commitPersistedSlice,
  emit,
  type OwnedPersonalEbike,
  type WardrobeState,
} from './state'

export const SAVE_STORAGE_KEY = 'glol.save.v1'
export const SAVE_CORRUPT_BACKUP_KEY = 'glol.save.v1.corrupt'
export const LEGACY_STAMPS_KEY = 'glol.stamps'
export const SAVE_SCHEMA_VERSION = 2
export const TX_HISTORY_RING_LIMIT = 64
export const TX_HISTORY_QUOTA_FALLBACK_LIMIT = 16
export const TELEMETRY_SAVE_THROTTLE_MS = 1500
export const MAX_CLOUD_PAYLOAD_BYTES = 65_536

const VALID_SPOT_IDS = new Set([
  'elephant',
  'pagodas',
  'bridge',
  'xiaoyao',
  'fubo',
  'diecai',
  'duxiu',
  'southgate',
  'lanes',
  'crossing',
])

export interface LedgerTxRecord {
  txId: string
  idempotencyKey: string
  kind: 'purchase' | 'reward' | 'service' | 'refund' | 'fine'
  delta: number
  balanceAfter: number
  refId: string
  at: number
}

export interface MissionHistoryEntry {
  count: number
  lastAt: number
}

export interface SaveEconomyBlock {
  claimedSpotBounties: string[]
  claimedMissionFirstClear: string[]
  completedMissionCounts: Record<string, number>
  missionHistory: Record<string, MissionHistoryEntry>
  txHistoryRing: LedgerTxRecord[]
}

export interface SaveMetaBlock {
  cloudRevision: number
  lastSyncedAt: number | null
  migratedLegacyStamps: boolean
}

import {emptyFishing, readFishing, type FishingSave} from '../fishing/save-block'

export interface LocalSaveV1 {
  fishing: FishingSave
  [AVATAR_KEY]?: Avatar
  schemaVersion: 2
  money: number
  owned: string[]
  spotsFound: string[]
  missionsDone: string[]
  updatedAt: number
  packs: Pack[]
  wardrobe: WardrobeState
  garage: {
    activeVehicleId: string | null
    vehicles: Record<string, OwnedPersonalEbike>
  }
  economy: SaveEconomyBlock
  saveMeta: SaveMetaBlock
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export interface LoadSaveResult {
  save: LocalSaveV1
  source: 'local' | 'default'
  migratedFrom?: string
  corruptBackedUp: boolean
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {}
  return null
}

function uniqueStrings(list: unknown, filter?: (s: string) => boolean): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (typeof item !== 'string' || !item) continue
    if (filter && !filter(item)) continue
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

function clampMoney(raw: unknown, fallback = DEFAULT_START_MONEY): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.max(0, Math.min(MAX_SAFE_MONEY, Math.trunc(raw)))
}

function clampPct(raw: unknown, fallback = 100): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.max(0, Math.min(100, +raw.toFixed(2)))
}

function clampNonNegativeFloat(raw: unknown, fallback = 0): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return fallback
  return +raw.toFixed(3)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function sanitizeVisual(modelId: PersonalEbikeModelId, raw: unknown): PersistedEbikeVisual {
  const base = createDefaultVisualForModel(modelId)
  if (!isPlainObject(raw)) return base
  const preset = raw.preset === 'ghostfire' || raw.preset === 'neon' || raw.preset === 'stock' ? raw.preset : base.preset
  const paintColor =
    typeof raw.paintColor === 'number' && Number.isFinite(raw.paintColor)
      ? (Math.trunc(raw.paintColor) & 0xffffff)
      : base.paintColor
  const underglowColor =
    typeof raw.underglowColor === 'number' && Number.isFinite(raw.underglowColor)
      ? (Math.trunc(raw.underglowColor) & 0xffffff)
      : base.underglowColor
  const angelEyeColor =
    typeof raw.angelEyeColor === 'number' && Number.isFinite(raw.angelEyeColor)
      ? (Math.trunc(raw.angelEyeColor) & 0xffffff)
      : base.angelEyeColor
  const windshield =
    raw.windshield === 'none' || raw.windshield === 'clear' || raw.windshield === 'tinted'
      ? raw.windshield
      : base.windshield
  const topbox =
    raw.topbox === 'none' || raw.topbox === 'commuter' || raw.topbox === 'delivery'
      ? raw.topbox
      : base.topbox
  const headlightTier =
    raw.headlightTier === 0 || raw.headlightTier === 1 || raw.headlightTier === 2
      ? raw.headlightTier
      : base.headlightTier
  return {
    preset,
    ...(paintColor !== undefined ? {paintColor} : {}),
    underglow: typeof raw.underglow === 'boolean' ? raw.underglow : base.underglow,
    underglowColor,
    angelEye: typeof raw.angelEye === 'boolean' ? raw.angelEye : base.angelEye,
    angelEyeColor,
    goldShock: typeof raw.goldShock === 'boolean' ? raw.goldShock : base.goldShock,
    tailWing: typeof raw.tailWing === 'boolean' ? raw.tailWing : base.tailWing,
    exhaust: typeof raw.exhaust === 'boolean' ? raw.exhaust : base.exhaust,
    windshield,
    topbox,
    headlightTier,
  }
}

function sanitizePersonalVehicle(idKey: string, raw: unknown, nowMs: number): OwnedPersonalEbike | null {
  if (!isPlainObject(raw)) return null
  if (!isPersonalEbikeModelId(raw.modelId)) return null
  const id = typeof raw.id === 'string' && raw.id.length > 0 && !raw.id.startsWith('test-ride:') ? raw.id : idKey
  if (!id || id.startsWith('test-ride:')) return null
  const modelId = raw.modelId
  const purchasedAt =
    typeof raw.purchasedAt === 'number' && Number.isFinite(raw.purchasedAt) && raw.purchasedAt > 0
      ? Math.trunc(raw.purchasedAt)
      : nowMs
  return {
    id,
    modelId,
    ...(typeof raw.nickname === 'string' && raw.nickname.trim() ? {nickname: raw.nickname.trim().slice(0, 24)} : {}),
    purchasedAt,
    batteryPct: clampPct(raw.batteryPct, 100),
    durabilityPct: clampPct(raw.durabilityPct, 100),
    odometerKm: clampNonNegativeFloat(raw.odometerKm, 0),
    upgrades: clampPersonalUpgrades(modelId, isPlainObject(raw.upgrades) ? raw.upgrades : undefined),
    visual: sanitizeVisual(modelId, raw.visual),
  }
}

function sanitizeWardrobe(raw: unknown): WardrobeState {
  const ownedItemSet = new Set<string>(DEFAULT_OWNED_OUTFIT_ITEMS)
  const ownedPresetSet = new Set<string>(DEFAULT_OWNED_OUTFIT_PRESETS)

  if (isPlainObject(raw)) {
    for (const id of uniqueStrings(raw.ownedItemIds)) {
      if (/^[a-z][a-z0-9_]{0,79}$/.test(id)) ownedItemSet.add(id)
    }
    for (const pid of uniqueStrings(raw.ownedPresetIds)) {
      const preset = OUTFIT_PRESETS_BY_ID[pid]
      if (!preset) {
        if (/^[a-z][a-z0-9_]{0,79}$/.test(pid)) ownedPresetSet.add(pid)
        continue
      }
      ownedPresetSet.add(pid)
      for (const itemId of Object.values(preset.items)) {
        if (OUTFIT_ITEMS_BY_ID[itemId]) ownedItemSet.add(itemId)
      }
    }
  }

  const slots: OutfitSlot[] = ['top', 'bottom', 'shoes', 'hat', 'bag']
  const equipped: EquippedOutfit = {...DEFAULT_EQUIPPED_OUTFIT}
  const rawEq = isPlainObject(raw) && isPlainObject(raw.equipped) ? raw.equipped : null
  if (rawEq) {
    for (const slot of slots) {
      const candidate = rawEq[slot]
      if (typeof candidate === 'string' && ownedItemSet.has(candidate) && OUTFIT_ITEMS_BY_ID[candidate]?.slot === slot) {
        equipped[slot] = candidate
      }
    }
  }

  return {
    ownedItemIds: [...ownedItemSet],
    ownedPresetIds: [...ownedPresetSet],
    equipped,
    autoHelmetOnRide: isPlainObject(raw) && typeof raw.autoHelmetOnRide === 'boolean' ? raw.autoHelmetOnRide : true,
  }
}

function sanitizeTxRing(raw: unknown, limit = TX_HISTORY_RING_LIMIT): LedgerTxRecord[] {
  if (!Array.isArray(raw)) return []
  const out: LedgerTxRecord[] = []
  const seenKeys = new Set<string>()
  const validKinds = new Set<LedgerTxRecord['kind']>(['purchase', 'reward', 'service', 'refund', 'fine'])
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue
    if (typeof entry.txId !== 'string' || !entry.txId) continue
    if (typeof entry.idempotencyKey !== 'string' || !entry.idempotencyKey) continue
    if (seenKeys.has(entry.idempotencyKey)) continue
    const kind = validKinds.has(entry.kind as LedgerTxRecord['kind']) ? (entry.kind as LedgerTxRecord['kind']) : null
    if (!kind) continue
    if (typeof entry.delta !== 'number' || !Number.isFinite(entry.delta)) continue
    seenKeys.add(entry.idempotencyKey)
    out.push({
      txId: entry.txId,
      idempotencyKey: entry.idempotencyKey,
      kind,
      delta: Math.trunc(entry.delta),
      balanceAfter: clampMoney(entry.balanceAfter, 0),
      refId: typeof entry.refId === 'string' ? entry.refId : '',
      at: typeof entry.at === 'number' && Number.isFinite(entry.at) ? Math.trunc(entry.at) : 0,
    })
  }
  return out.length > limit ? out.slice(out.length - limit) : out
}

export function createDefaultSave(nowMs = Date.now()): LocalSaveV1 {
  return {
    fishing: emptyFishing(),
    schemaVersion: SAVE_SCHEMA_VERSION,
    packs: [],
    money: DEFAULT_START_MONEY,
    owned: [],
    spotsFound: [],
    missionsDone: [],
    updatedAt: nowMs,
    wardrobe: sanitizeWardrobe(null),
    garage: {
      activeVehicleId: null,
      vehicles: {},
    },
    economy: {
      claimedSpotBounties: [],
      claimedMissionFirstClear: [],
      completedMissionCounts: {},
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

export function cloneSave(save: LocalSaveV1): LocalSaveV1 {
  const vehicles: Record<string, OwnedPersonalEbike> = {}
  for (const [id, v] of Object.entries(save.garage.vehicles)) {
    vehicles[id] = {...v, upgrades: {...v.upgrades}, visual: {...v.visual}}
  }
  const missionHistory: Record<string, MissionHistoryEntry> = {}
  for (const [id, h] of Object.entries(save.economy.missionHistory)) {
    missionHistory[id] = {count: h.count, lastAt: h.lastAt}
  }
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    fishing: structuredClone(save.fishing ?? emptyFishing()),
    [AVATAR_KEY]: sanitizeAvatar(save[AVATAR_KEY]),
    packs: readPacks(save.packs),
    money: save.money,
    owned: [...save.owned],
    spotsFound: [...save.spotsFound],
    missionsDone: [...save.missionsDone],
    updatedAt: save.updatedAt,
    wardrobe: {
      ownedItemIds: [...save.wardrobe.ownedItemIds],
      ownedPresetIds: [...save.wardrobe.ownedPresetIds],
      equipped: {...save.wardrobe.equipped},
      autoHelmetOnRide: save.wardrobe.autoHelmetOnRide,
    },
    garage: {
      activeVehicleId: save.garage.activeVehicleId,
      vehicles,
    },
    economy: {
      claimedSpotBounties: [...save.economy.claimedSpotBounties],
      claimedMissionFirstClear: [...save.economy.claimedMissionFirstClear],
      completedMissionCounts: {...save.economy.completedMissionCounts},
      missionHistory,
      txHistoryRing: save.economy.txHistoryRing.map(tx => ({...tx})),
    },
    saveMeta: {...save.saveMeta},
  }
}

export function mirrorOwnedModels(vehicles: Record<string, OwnedPersonalEbike>, existingOwned?: string[]): string[] {
  const out = new Set<string>()
  for (const v of Object.values(vehicles)) out.add(v.modelId)
  // Keep any non-ebike v1 owned vehicle kinds (e.g. future G1/G3 cars) for forward compatibility.
  for (const k of existingOwned ?? []) {
    if (typeof k === 'string' && k && !isPersonalEbikeModelId(k)) out.add(k)
  }
  return [...out]
}

/**
 * Sanitizes and upgrades an arbitrary parsed object (v1 or v2) into a guaranteed-valid `LocalSaveV1` (schemaVersion: 2).
 */
export function sanitizeSave(raw: unknown, nowMs = Date.now()): {save: LocalSaveV1; migratedFrom?: string} {
  if (!isPlainObject(raw)) return {save: createDefaultSave(nowMs)}

  const rawSchema = raw.schemaVersion
  const migratedFrom = rawSchema === undefined || rawSchema === 1 ? 'v1' : undefined
  const money = clampMoney(raw.money, DEFAULT_START_MONEY)
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0
      ? Math.trunc(raw.updatedAt)
      : nowMs
  const spotsFound = uniqueStrings(raw.spotsFound)
  const missionsDone = uniqueStrings(raw.missionsDone)
  const rawOwned = uniqueStrings(raw.owned)
  const wardrobe = sanitizeWardrobe(raw.wardrobe)

  const vehicles: Record<string, OwnedPersonalEbike> = {}
  const rawGarage = isPlainObject(raw.garage) ? raw.garage : null
  if (rawGarage && isPlainObject(rawGarage.vehicles)) {
    for (const [key, entry] of Object.entries(rawGarage.vehicles)) {
      const cleaned = sanitizePersonalVehicle(key, entry, updatedAt)
      if (cleaned) vehicles[cleaned.id] = cleaned
    }
  }

  // v1 -> v2 materialization: ensure any personal e-bike modelId listed in `owned` exists in `garage.vehicles`.
  const presentModels = new Set(Object.values(vehicles).map(v => v.modelId))
  let synthIdx = 0
  for (const kind of rawOwned) {
    if (isPersonalEbikeModelId(kind) && !presentModels.has(kind)) {
      const id = `ebike_migrated_${kind}_${++synthIdx}`
      vehicles[id] = {
        id,
        modelId: kind,
        purchasedAt: updatedAt,
        batteryPct: 100,
        durabilityPct: 100,
        odometerKm: 0,
        upgrades: clampPersonalUpgrades(kind, null),
        visual: createDefaultVisualForModel(kind),
      }
      presentModels.add(kind)
    }
  }

  let activeVehicleId: string | null =
    rawGarage && typeof rawGarage.activeVehicleId === 'string' && vehicles[rawGarage.activeVehicleId]
      ? rawGarage.activeVehicleId
      : null
  if (!activeVehicleId) {
    const firstId = Object.keys(vehicles)[0]
    activeVehicleId = firstId ?? null
  }

  const rawEco = isPlainObject(raw.economy) ? raw.economy : null
  // Support both canonical Stage 1A names and IDOK-123/128 alias names on read.
  const claimedSpotBounties = uniqueStrings([
    ...(Array.isArray(rawEco?.claimedSpotBounties) ? rawEco!.claimedSpotBounties : []),
    ...(Array.isArray(rawEco?.spotsClaimed) ? rawEco!.spotsClaimed : []),
    ...(Array.isArray(raw.spotsClaimed) ? raw.spotsClaimed : []),
  ])
  const claimedMissionFirstClear = uniqueStrings([
    ...(Array.isArray(rawEco?.claimedMissionFirstClear) ? rawEco!.claimedMissionFirstClear : []),
    ...(Array.isArray(rawEco?.firstClearClaimed) ? rawEco!.firstClearClaimed : []),
    ...(Array.isArray(raw.firstClearClaimed) ? raw.firstClearClaimed : []),
  ])

  const completedMissionCounts: Record<string, number> = {}
  const missionHistory: Record<string, MissionHistoryEntry> = {}
  if (rawEco && isPlainObject(rawEco.completedMissionCounts)) {
    for (const [mid, count] of Object.entries(rawEco.completedMissionCounts)) {
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
        completedMissionCounts[mid] = Math.trunc(count)
      }
    }
  }
  const rawHist = (rawEco && isPlainObject(rawEco.missionHistory) ? rawEco.missionHistory : null) ??
    (isPlainObject(raw.missionHistory) ? raw.missionHistory : null)
  if (rawHist) {
    for (const [mid, entry] of Object.entries(rawHist)) {
      if (!isPlainObject(entry)) continue
      const count = typeof entry.count === 'number' && Number.isFinite(entry.count) && entry.count > 0 ? Math.trunc(entry.count) : 0
      const lastAt = typeof entry.lastAt === 'number' && Number.isFinite(entry.lastAt) && entry.lastAt > 0 ? Math.trunc(entry.lastAt) : 0
      if (count > 0) {
        missionHistory[mid] = {count, lastAt}
        completedMissionCounts[mid] = Math.max(completedMissionCounts[mid] ?? 0, count)
      }
    }
  }
  for (const [mid, count] of Object.entries(completedMissionCounts)) {
    if (!missionHistory[mid]) missionHistory[mid] = {count, lastAt: updatedAt}
  }

  const rawMeta = isPlainObject(raw.saveMeta) ? raw.saveMeta : null
  const cloudRevision =
    rawMeta && typeof rawMeta.cloudRevision === 'number' && Number.isFinite(rawMeta.cloudRevision) && rawMeta.cloudRevision >= 0
      ? Math.trunc(rawMeta.cloudRevision)
      : 0
  const lastSyncedAt =
    rawMeta && typeof rawMeta.lastSyncedAt === 'number' && Number.isFinite(rawMeta.lastSyncedAt) && rawMeta.lastSyncedAt > 0
      ? Math.trunc(rawMeta.lastSyncedAt)
      : null
  const migratedLegacyStamps = rawMeta && typeof rawMeta.migratedLegacyStamps === 'boolean' ? rawMeta.migratedLegacyStamps : false

  const save: LocalSaveV1 = {
    fishing: readFishing(raw.fishing),
    schemaVersion: SAVE_SCHEMA_VERSION,
    money,
    owned: mirrorOwnedModels(vehicles, rawOwned),
    spotsFound,
    missionsDone,
    updatedAt,
    [AVATAR_KEY]: sanitizeAvatar(raw[AVATAR_KEY]),
    packs: readPacks(raw.packs),
    wardrobe,
    garage: {activeVehicleId, vehicles},
    economy: {
      claimedSpotBounties,
      claimedMissionFirstClear,
      completedMissionCounts,
      missionHistory,
      txHistoryRing: sanitizeTxRing(rawEco?.txHistoryRing),
    },
    saveMeta: {
      cloudRevision,
      lastSyncedAt,
      migratedLegacyStamps,
    },
  }

  return {save, ...(migratedFrom ? {migratedFrom} : {})}
}

function readLegacyStamps(storage: StorageLike | null): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(LEGACY_STAMPS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return uniqueStrings(parsed, id => VALID_SPOT_IDS.has(id))
  } catch {
    return []
  }
}

export function syncLegacyStamps(spotsFound: readonly string[], storageOverride?: StorageLike | null): void {
  const storage = resolveStorage(storageOverride)
  if (!storage) return
  try {
    const existing = readLegacyStamps(storage)
    const merged = uniqueStrings([...existing, ...spotsFound], id => VALID_SPOT_IDS.has(id))
    storage.setItem(LEGACY_STAMPS_KEY, JSON.stringify(merged))
  } catch {}
}

function dispatchSaveToast(text: string): void {
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text, ms: 3400}}))
  }
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as {name?: string; code?: number}
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014
}

// Module-level active save snapshot + throttled persistence handle
let activeSave: LocalSaveV1 = createDefaultSave()
let activeStorage: StorageLike | null = null
let throttleTimer: ReturnType<typeof setTimeout> | null = null
let dirtyTelemetry = false
let lifecycleBound = false

export function getActiveSaveSnapshot(): Readonly<LocalSaveV1> {
  return activeSave
}

export function setSaveStorageForTest(storage: StorageLike | null): void {
  activeStorage = storage
  if (throttleTimer !== null) {
    clearTimeout(throttleTimer)
    throttleTimer = null
  }
  dirtyTelemetry = false
}

function resolveStorage(override?: StorageLike | null): StorageLike | null {
  return override !== undefined ? override : (activeStorage ?? getDefaultStorage())
}

/**
 * Persists a candidate save snapshot synchronously to `localStorage['glol.save.v1']`.
 * On QuotaExceededError: trims `txHistoryRing` to 16 and retries once; if still failing, returns false without mutating memory.
 */
export function persistSaveSync(candidate: LocalSaveV1, storageOverride?: StorageLike | null): boolean {
  const storage = resolveStorage(storageOverride)
  const toWrite = cloneSave(candidate)
  toWrite.owned = mirrorOwnedModels(toWrite.garage.vehicles, toWrite.owned)
  if (!storage) {
    activeSave = toWrite
    return true
  }
  try {
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(toWrite))
    activeSave = toWrite
    if(typeof window!=='undefined')window.dispatchEvent(new Event('glol:save-written'))
    return true
  } catch (err) {
    if (isQuotaError(err)) {
      const trimmed = cloneSave(toWrite)
      if (trimmed.economy.txHistoryRing.length > TX_HISTORY_QUOTA_FALLBACK_LIMIT) {
        trimmed.economy.txHistoryRing = trimmed.economy.txHistoryRing.slice(-TX_HISTORY_QUOTA_FALLBACK_LIMIT)
      }
      try {
        storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(trimmed))
        activeSave = trimmed
        if(typeof window!=='undefined')window.dispatchEvent(new Event('glol:save-written'))
        return true
      } catch {
        dispatchSaveToast('浏览器本地存储空间不足，保存失败，请清理缓存后重试')
        return false
      }
    }
    dispatchSaveToast('本地存档写入失败，已撤销本次变更')
    return false
  }
}

export function flushThrottledSave(storageOverride?: StorageLike | null): boolean {
  if (throttleTimer !== null) {
    clearTimeout(throttleTimer)
    throttleTimer = null
  }
  if (!dirtyTelemetry) return true
  dirtyTelemetry = false
  activeSave.updatedAt = Date.now()
  return persistSaveSync(activeSave, storageOverride)
}

/**
 * Throttled persistence (1500ms) for high-frequency non-monetary changes (batteryPct, odometerKm).
 */
export function scheduleThrottledSave(next: LocalSaveV1, storageOverride?: StorageLike | null): void {
  activeSave = cloneSave(next)
  dirtyTelemetry = true
  if (throttleTimer !== null) return
  throttleTimer = setTimeout(() => {
    throttleTimer = null
    if (!dirtyTelemetry) return
    dirtyTelemetry = false
    persistSaveSync(activeSave, storageOverride)
  }, TELEMETRY_SAVE_THROTTLE_MS)
}

function bindLifecycleFlush(): void {
  if (lifecycleBound || typeof window === 'undefined') return
  lifecycleBound = true
  window.addEventListener('pagehide', () => {
    flushThrottledSave()
  })
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushThrottledSave()
    })
  }
}

/**
 * Hydrates `GameState` from `localStorage['glol.save.v1']`, migrating legacy `glol.stamps` and v1 schemas safely.
 */
export function loadLocalSave(storageOverride?: StorageLike | null, nowMs = Date.now(), persist = true): LoadSaveResult {
  bindLifecycleFlush()
  const storage = resolveStorage(storageOverride)
  let rawText: string | null = null
  try {
    rawText = storage?.getItem(SAVE_STORAGE_KEY) ?? null
  } catch {
    rawText = null
  }

  let save: LocalSaveV1
  let source: 'local' | 'default' = 'default'
  let migratedFrom: string | undefined
  let corruptBackedUp = false

  if (rawText !== null && rawText !== '') {
    let parsed: unknown = null
    let parseOk = false
    try {
      parsed = JSON.parse(rawText)
      parseOk = isPlainObject(parsed)
    } catch {
      parseOk = false
    }
    if (!parseOk) {
      try {
        if (persist) storage?.setItem(SAVE_CORRUPT_BACKUP_KEY, rawText)
        corruptBackedUp = true
      } catch {}
      save = createDefaultSave(nowMs)
      source = 'default'
      dispatchSaveToast('检测到本地存档损坏，已为您重置安全档案')
    } else {
      const upgraded = sanitizeSave(parsed, nowMs)
      save = upgraded.save
      migratedFrom = upgraded.migratedFrom
      source = 'local'
    }
  } else {
    save = createDefaultSave(nowMs)
    source = 'default'
  }

  // Non-destructive legacy `glol.stamps` migration (do NOT delete `glol.stamps`, do NOT auto-credit money).
  if (!save.saveMeta.migratedLegacyStamps) {
    const legacyStamps = readLegacyStamps(storage)
    if (legacyStamps.length > 0) {
      save.spotsFound = uniqueStrings([...save.spotsFound, ...legacyStamps])
      migratedFrom = migratedFrom ? `${migratedFrom}+stamps` : 'glol.stamps'
    }
    save.saveMeta.migratedLegacyStamps = true
  }

  activeSave = cloneSave(save)
  if (persist && (corruptBackedUp || migratedFrom || source === 'default')) {
    persistSaveSync(activeSave, storage)
  }

  _commitPersistedSlice({
    money: activeSave.money,
    wardrobe: activeSave.wardrobe,
    garage: {
      activeVehicleId: activeSave.garage.activeVehicleId,
      vehicles: activeSave.garage.vehicles,
    },
    spotsFound: activeSave.spotsFound,
    missionsDone: activeSave.missionsDone,
  })

  emit({
    type: 'save:loaded',
    source,
    ...(migratedFrom ? {migratedFrom} : {}),
  })

  return {
    save: cloneSave(activeSave),
    source,
    ...(migratedFrom ? {migratedFrom} : {}),
    corruptBackedUp,
  }
}

export function reloadSaveFromStorage(storageOverride?: StorageLike | null): LocalSaveV1 {
  return loadLocalSave(storageOverride).save
}

export function resetSaveForTesting(money = DEFAULT_START_MONEY, storageOverride?: StorageLike | null): LocalSaveV1 {
  const safeMoney = Math.max(0, Math.min(MAX_SAFE_MONEY, Math.trunc(Number.isFinite(money) ? money : DEFAULT_START_MONEY)))
  const fresh = createDefaultSave()
  fresh.money = safeMoney
  fresh.saveMeta.migratedLegacyStamps = true
  persistSaveSync(fresh, storageOverride)
  _commitPersistedSlice({
    money: activeSave.money,
    wardrobe: activeSave.wardrobe,
    garage: {activeVehicleId: activeSave.garage.activeVehicleId, vehicles: activeSave.garage.vehicles},
    spotsFound: activeSave.spotsFound,
    missionsDone: activeSave.missionsDone,
    bumpWalletSeq: true,
  })
  return cloneSave(activeSave)
}

/**
 * Validates payload size (<= 64 KiB) and integer money constraints for `PUT /api/save`.
 */
export function validateCloudPayload(payload: unknown): {ok: true; save: LocalSaveV1; bytes: number} | {ok: false; reason: string} {
  if (!isPlainObject(payload)) return {ok: false, reason: 'INVALID_OBJECT'}
  if (typeof payload.money !== 'number' || !Number.isSafeInteger(payload.money) || payload.money < 0 || payload.money > MAX_SAFE_MONEY) {
    return {ok: false, reason: 'INVALID_MONEY'}
  }
  const {save} = sanitizeSave(payload)
  const serialized = JSON.stringify(save)
  if (serialized.length > MAX_CLOUD_PAYLOAD_BYTES) {
    return {ok: false, reason: 'PAYLOAD_TOO_LARGE'}
  }
  return {ok: true, save, bytes: serialized.length}
}

/**
 * Deterministic lossless merge for offline guest <-> signed-in cloud saves (docs/commerce-shops-spec.md §1.3).
 */
export function mergeCloudAndLocalSave(localRaw: LocalSaveV1, cloudRaw: LocalSaveV1, nowMs = Date.now()): LocalSaveV1 {
  const local = sanitizeSave(localRaw, nowMs).save
  const cloud = sanitizeSave(cloudRaw, nowMs).save

  const spotsFound = uniqueStrings([...cloud.spotsFound, ...local.spotsFound])
  const missionsDone = uniqueStrings([...cloud.missionsDone, ...local.missionsDone])
  const ownedItemIds = uniqueStrings([...cloud.wardrobe.ownedItemIds, ...local.wardrobe.ownedItemIds])
  const ownedPresetIds = uniqueStrings([...cloud.wardrobe.ownedPresetIds, ...local.wardrobe.ownedPresetIds])
  const claimedSpotBounties = uniqueStrings([...cloud.economy.claimedSpotBounties, ...local.economy.claimedSpotBounties])
  const claimedMissionFirstClear = uniqueStrings([...cloud.economy.claimedMissionFirstClear, ...local.economy.claimedMissionFirstClear])

  const completedMissionCounts: Record<string, number> = {...cloud.economy.completedMissionCounts}
  const missionHistory: Record<string, MissionHistoryEntry> = {}
  for (const [id, entry] of Object.entries(cloud.economy.missionHistory)) {
    missionHistory[id] = {...entry}
  }
  for (const [id, count] of Object.entries(local.economy.completedMissionCounts)) {
    completedMissionCounts[id] = Math.max(completedMissionCounts[id] ?? 0, count)
  }
  for (const [id, entry] of Object.entries(local.economy.missionHistory)) {
    const prev = missionHistory[id]
    missionHistory[id] = {
      count: Math.max(prev?.count ?? 0, entry.count),
      lastAt: Math.max(prev?.lastAt ?? 0, entry.lastAt),
    }
    completedMissionCounts[id] = Math.max(completedMissionCounts[id] ?? 0, missionHistory[id].count)
  }

  // Merge personal vehicles by modelId/id: retain all distinct models; for same model keep higher upgrades / odometer.
  const byModel = new Map<PersonalEbikeModelId, OwnedPersonalEbike>()
  const scoreVehicle = (v: OwnedPersonalEbike) =>
    (v.upgrades.motorLevel + v.upgrades.controllerLevel + v.upgrades.batteryLevel) * 1_000_000 +
    Math.round(v.odometerKm * 100)
  for (const v of [...Object.values(cloud.garage.vehicles), ...Object.values(local.garage.vehicles)]) {
    const existing = byModel.get(v.modelId)
    if (!existing || scoreVehicle(v) > scoreVehicle(existing)) {
      byModel.set(v.modelId, {...v, upgrades: {...v.upgrades}, visual: {...v.visual}})
    }
  }
  const vehicles: Record<string, OwnedPersonalEbike> = {}
  for (const v of byModel.values()) vehicles[v.id] = v

  const newer = local.updatedAt >= cloud.updatedAt ? local : cloud
  const older = newer === local ? cloud : local
  const activeVehicleId =
    (newer.garage.activeVehicleId && vehicles[newer.garage.activeVehicleId] ? newer.garage.activeVehicleId : null) ??
    (older.garage.activeVehicleId && vehicles[older.garage.activeVehicleId] ? older.garage.activeVehicleId : null) ??
    Object.keys(vehicles)[0] ??
    null

  // Merge tx rings deduplicated by idempotencyKey and sorted chronologically.
  const txMap = new Map<string, LedgerTxRecord>()
  for (const tx of [...cloud.economy.txHistoryRing, ...local.economy.txHistoryRing]) {
    if (!txMap.has(tx.idempotencyKey)) txMap.set(tx.idempotencyKey, {...tx})
  }
  const txHistoryRing = [...txMap.values()]
    .sort((a, b) => a.at - b.at)
    .slice(-TX_HISTORY_RING_LIMIT)

  // Money conflict resolution: take newer side's balance + credit any distinct unsynced reward txs from older side.
  const newerTxIds = new Set(newer.economy.txHistoryRing.map(tx => tx.txId))
  let unsyncedRewardDelta = 0
  for (const tx of older.economy.txHistoryRing) {
    if (tx.kind === 'reward' && tx.delta > 0 && !tx.refId.startsWith('fishing:') && !newerTxIds.has(tx.txId)) {
      unsyncedRewardDelta += tx.delta
    }
  }
  const mergedMoney = clampMoney(newer.money + Math.min(unsyncedRewardDelta, 20_000), newer.money)

  const merged: LocalSaveV1 = {
    fishing: readFishing(newer.fishing),
    schemaVersion: SAVE_SCHEMA_VERSION,
    [AVATAR_KEY]: newer[AVATAR_KEY] ?? older[AVATAR_KEY],
    packs: readPacks(newer.packs),
    money: mergedMoney,
    owned: mirrorOwnedModels(vehicles, [...cloud.owned, ...local.owned]),
    spotsFound,
    missionsDone,
    updatedAt: Math.max(nowMs, local.updatedAt, cloud.updatedAt),
    wardrobe: {
      ownedItemIds,
      ownedPresetIds,
      equipped: {...newer.wardrobe.equipped},
      autoHelmetOnRide: newer.wardrobe.autoHelmetOnRide,
    },
    garage: {activeVehicleId, vehicles},
    economy: {
      claimedSpotBounties,
      claimedMissionFirstClear,
      completedMissionCounts,
      missionHistory,
      txHistoryRing,
    },
    saveMeta: {
      cloudRevision: Math.max(cloud.saveMeta.cloudRevision, local.saveMeta.cloudRevision),
      lastSyncedAt: nowMs,
      migratedLegacyStamps: true,
    },
  }
  return sanitizeSave(merged, nowMs).save
}

export function openPack(brand: string): boolean {
  const next = cloneSave(getActiveSaveSnapshot())
  const pack = next.packs[0]
  if (!pack || pack.brand !== brand) return false
  pack.opened = true
  next.updatedAt = Date.now()
  return persistSaveSync(next)
}

export function takeFromPack(brand: string): boolean {
  const next = cloneSave(getActiveSaveSnapshot())
  const pack = next.packs[0]
  if (!pack || pack.brand !== brand) return false
  if (--pack.remaining === 0) next.packs.shift()
  next.updatedAt = Date.now()
  return persistSaveSync(next)
}
