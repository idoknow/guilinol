/**
 * Atomic commerce & anti-farm reward engine (`web/src/game/commerce.ts`).
 *
 * Implements the strict 6-step transaction contract from docs/commerce-shops-spec.md §2.3:
 *  1. Synchronous re-entry lock (`inFlightLocks`) -> `IN_FLIGHT`
 *  2. Idempotency replay detection in `economy.txHistoryRing` -> `IDEMPOTENT_REPLAY` (`charged: 0`)
 *  3. Single Source of Truth catalog pricing (`PRICE_MISMATCH` if caller price is stale)
 *  4. Pre-checks: `ALREADY_OWNED`, `SHARED_UPGRADE_FORBIDDEN`, `UPGRADE_CAP_EXCEEDED`, `ALREADY_FULL`
 *  5. Funds check: `INSUFFICIENT_FUNDS` with exact `deficit` (never negative balance)
 *  6. Clone -> Validate -> Persist to `localStorage['glol.save.v1']` FIRST -> Commit memory & emit events
 */

import {
  EBIKE_SERVICE_CATALOG,
  EBIKE_UPGRADES_BY_ID,
  EBIKE_VISUALS_BY_ID,
  MAX_SAFE_MONEY,
  OUTFIT_ITEMS_BY_ID,
  OUTFIT_PRESETS_BY_ID,
  PERSONAL_EBIKE_MODELS,
  calcFullServiceCost,
  clampPersonalUpgrades,
  createDefaultVisualForModel,
  isPersonalEbikeModelId,
  resolvePersonalEbikeProfile,
  type OutfitSlot,
  type PersistedEbikeUpgrades,
} from './catalog'
import {
  TX_HISTORY_RING_LIMIT,
  cloneSave,
  getActiveSaveSnapshot,
  mirrorOwnedModels,
  persistSaveSync,
  scheduleThrottledSave,
  syncLegacyStamps,
  type LedgerTxRecord,
  type LocalSaveV1,
} from './save'
import {
  _commitPersistedSlice,
  emit,
  getState,
  type OwnedPersonalEbike,
} from './state'
import {EBIKE_UPGRADE_MAX_KMH} from '../walk/tuning'

export type CatalogItemType =
  | 'outfit_item'
  | 'outfit_preset'
  | 'ebike_model'
  | 'ebike_upgrade'
  | 'ebike_visual'
  | 'ebike_service'

export interface PurchaseRequest {
  shopId: string
  itemType: CatalogItemType
  itemId: string
  targetVehicleId?: string
  expectedPrice: number
  idempotencyKey: string
}

export type PurchaseErrorCode =
  | 'IN_FLIGHT'
  | 'IDEMPOTENT_REPLAY'
  | 'INVALID_ITEM'
  | 'PRICE_MISMATCH'
  | 'ALREADY_OWNED'
  | 'ALREADY_FULL'
  | 'INSUFFICIENT_FUNDS'
  | 'VEHICLE_NOT_FOUND'
  | 'SHARED_UPGRADE_FORBIDDEN'
  | 'UPGRADE_CAP_EXCEEDED'
  | 'PERSIST_FAILED'

export interface PurchaseResult {
  ok: boolean
  code: 'OK' | PurchaseErrorCode
  charged: number
  balanceAfter: number
  txId?: string
  createdVehicleId?: string
  deficit?: number
  expectedPrice?: number
}

export interface RewardRequest {
  source: 'mission_delivery' | 'mission_errand' | 'spot_bounty' | 'mission_first_clear'
  refId: string
  amount: number
  firstClearOnly?: boolean
  idempotencyKey: string
}

export interface RewardResult {
  ok: boolean
  code: 'OK' | 'ALREADY_CLAIMED' | 'IDEMPOTENT_REPLAY' | 'INVALID_AMOUNT' | 'PERSIST_FAILED'
  credited: number
  balanceAfter: number
  txId?: string
}

export interface FineRequest {
  amount: number
  reason: string
  idempotencyKey: string
}

export interface FineResult {
  ok: boolean
  code: 'OK' | 'IDEMPOTENT_REPLAY' | 'INVALID_AMOUNT' | 'PERSIST_FAILED'
  charged: number
  balanceAfter: number
  txId?: string
}

const inFlightLocks = new Set<string>()
let txCounter = 0

function nextTxId(nowMs: number): string {
  txCounter = (txCounter + 1) % 100_000
  return `tx_${nowMs}_${String(txCounter).padStart(5, '0')}`
}

function appendTx(save: LocalSaveV1, tx: LedgerTxRecord): void {
  save.economy.txHistoryRing.push(tx)
  if (save.economy.txHistoryRing.length > TX_HISTORY_RING_LIMIT) {
    save.economy.txHistoryRing = save.economy.txHistoryRing.slice(-TX_HISTORY_RING_LIMIT)
  }
}

function findIdempotentTx(save: Readonly<LocalSaveV1>, idempotencyKey: string): LedgerTxRecord | undefined {
  if (!idempotencyKey) return undefined
  return save.economy.txHistoryRing.find(tx => tx.idempotencyKey === idempotencyKey)
}

function isSharedVehicleId(vehicleId?: string): boolean {
  if (!vehicleId) return false
  return vehicleId === 'shared' || vehicleId.startsWith('shared:') || vehicleId.startsWith('test-ride:')
}

/**
 * Helper for tests to simulate concurrent in-flight lock contention cleanly.
 */
export function _withInFlightLockForTest<T>(lockKey: string, fn: () => T): T {
  inFlightLocks.add(lockKey)
  try {
    return fn()
  } finally {
    inFlightLocks.delete(lockKey)
  }
}

/**
 * Resolves the authoritative price for a catalog item (returns null if invalid).
 */
export function quotePurchasePrice(
  itemType: CatalogItemType,
  itemId: string,
  targetVehicleId?: string,
  save: Readonly<LocalSaveV1> = getActiveSaveSnapshot(),
): number | null {
  switch (itemType) {
    case 'outfit_item':
      return OUTFIT_ITEMS_BY_ID[itemId]?.price ?? null
    case 'outfit_preset':
      return OUTFIT_PRESETS_BY_ID[itemId]?.price ?? null
    case 'ebike_model':
      return isPersonalEbikeModelId(itemId) ? PERSONAL_EBIKE_MODELS[itemId].price : null
    case 'ebike_upgrade':
      return EBIKE_UPGRADES_BY_ID[itemId]?.price ?? null
    case 'ebike_visual':
      return EBIKE_VISUALS_BY_ID[itemId]?.price ?? null
    case 'ebike_service': {
      const service = EBIKE_SERVICE_CATALOG[itemId as keyof typeof EBIKE_SERVICE_CATALOG]
      if (!service) return null
      if (service.fixedPrice !== undefined) return service.fixedPrice
      const v = targetVehicleId ? save.garage.vehicles[targetVehicleId] : undefined
      if (!v) return null
      return calcFullServiceCost(v.batteryPct, v.durabilityPct)
    }
    default:
      return null
  }
}

export function executePurchase(req: PurchaseRequest): PurchaseResult {
  const currentBalance = getState().money
  if (!req || !req.idempotencyKey || typeof req.idempotencyKey !== 'string') {
    return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: currentBalance}
  }

  const lockKey = `${req.itemType}:${req.itemId}:${req.targetVehicleId ?? ''}`
  // Step 1: Synchronous re-entry lock
  if (inFlightLocks.has(lockKey)) {
    return {ok: false, code: 'IN_FLIGHT', charged: 0, balanceAfter: currentBalance}
  }
  inFlightLocks.add(lockKey)

  try {
    const baseSave = getActiveSaveSnapshot()
    const nowMs = Date.now()

    // Step 2: Idempotency replay interception
    const replayed = findIdempotentTx(baseSave, req.idempotencyKey)
    if (replayed) {
      return {
        ok: true,
        code: 'IDEMPOTENT_REPLAY',
        charged: 0,
        balanceAfter: baseSave.money,
        txId: replayed.txId,
      }
    }

    // Step 3 & 4: Validate item, ownership, shared-vehicle restriction, caps, and SSOT pricing
    const nextSave = cloneSave(baseSave)
    let realPrice: number | null = null
    let createdVehicleId: string | undefined
    let postCommitEvents: (() => void)[] = []

    if (req.itemType === 'outfit_item') {
      const def = OUTFIT_ITEMS_BY_ID[req.itemId]
      if (!def) return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: baseSave.money}
      if (baseSave.wardrobe.ownedItemIds.includes(def.id)) {
        return {ok: true, code: 'ALREADY_OWNED', charged: 0, balanceAfter: baseSave.money}
      }
      realPrice = def.price
      nextSave.wardrobe.ownedItemIds.push(def.id)
      nextSave.wardrobe.equipped[def.slot] = def.id
      postCommitEvents.push(() => emit({type: 'outfit:equip', equipped: {...nextSave.wardrobe.equipped}}))
    } else if (req.itemType === 'outfit_preset') {
      const preset = OUTFIT_PRESETS_BY_ID[req.itemId]
      if (!preset) return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: baseSave.money}
      const allPiecesOwned = Object.values(preset.items).every(id => baseSave.wardrobe.ownedItemIds.includes(id))
      if (baseSave.wardrobe.ownedPresetIds.includes(preset.id) || allPiecesOwned) {
        return {ok: true, code: 'ALREADY_OWNED', charged: 0, balanceAfter: baseSave.money}
      }
      realPrice = preset.price
      if (!nextSave.wardrobe.ownedPresetIds.includes(preset.id)) {
        nextSave.wardrobe.ownedPresetIds.push(preset.id)
      }
      for (const [slot, itemId] of Object.entries(preset.items) as [OutfitSlot, string][]) {
        if (!nextSave.wardrobe.ownedItemIds.includes(itemId)) {
          nextSave.wardrobe.ownedItemIds.push(itemId)
        }
        nextSave.wardrobe.equipped[slot] = itemId
      }
      postCommitEvents.push(() => emit({type: 'outfit:equip', equipped: {...nextSave.wardrobe.equipped}}))
    } else if (req.itemType === 'ebike_model') {
      if (!isPersonalEbikeModelId(req.itemId)) {
        return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: baseSave.money}
      }
      const existingModel = Object.values(baseSave.garage.vehicles).find(v => v.modelId === req.itemId)
      if (existingModel) {
        return {
          ok: true,
          code: 'ALREADY_OWNED',
          charged: 0,
          balanceAfter: baseSave.money,
          createdVehicleId: existingModel.id,
        }
      }
      const model = PERSONAL_EBIKE_MODELS[req.itemId]
      realPrice = model.price
      const vehicleId = `ebike_${nowMs}_${Math.random().toString(36).slice(2, 6)}`
      const ownedBike: OwnedPersonalEbike = {
        id: vehicleId,
        modelId: model.modelId,
        purchasedAt: nowMs,
        batteryPct: 100,
        durabilityPct: 100,
        odometerKm: 0,
        upgrades: clampPersonalUpgrades(model.modelId, null),
        visual: createDefaultVisualForModel(model.modelId),
      }
      nextSave.garage.vehicles[vehicleId] = ownedBike
      nextSave.garage.activeVehicleId = vehicleId
      nextSave.owned = mirrorOwnedModels(nextSave.garage.vehicles, nextSave.owned)
      createdVehicleId = vehicleId
      postCommitEvents.push(() => emit({type: 'garage:select', vehicleId}))
    } else if (req.itemType === 'ebike_upgrade') {
      if (isSharedVehicleId(req.targetVehicleId)) {
        return {ok: false, code: 'SHARED_UPGRADE_FORBIDDEN', charged: 0, balanceAfter: baseSave.money}
      }
      const upg = EBIKE_UPGRADES_BY_ID[req.itemId]
      if (!upg) return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: baseSave.money}
      if (!req.targetVehicleId || !nextSave.garage.vehicles[req.targetVehicleId]) {
        return {ok: false, code: 'VEHICLE_NOT_FOUND', charged: 0, balanceAfter: baseSave.money}
      }
      const vehicle = nextSave.garage.vehicles[req.targetVehicleId]
      const modelDef = PERSONAL_EBIKE_MODELS[vehicle.modelId]
      const field: keyof PersistedEbikeUpgrades =
        upg.kind === 'motor' ? 'motorLevel' : upg.kind === 'controller' ? 'controllerLevel' : 'batteryLevel'
      if (upg.level > modelDef.maxUpgrades[field]) {
        return {ok: false, code: 'UPGRADE_CAP_EXCEEDED', charged: 0, balanceAfter: baseSave.money}
      }
      if (vehicle.upgrades[field] >= upg.level) {
        return {ok: true, code: 'ALREADY_OWNED', charged: 0, balanceAfter: baseSave.money}
      }
      const candidateUpgrades: PersistedEbikeUpgrades = {...vehicle.upgrades, [field]: upg.level}
      const resolved = resolvePersonalEbikeProfile(vehicle.modelId, candidateUpgrades)
      if (resolved.tierMaxKmh > EBIKE_UPGRADE_MAX_KMH) {
        return {ok: false, code: 'UPGRADE_CAP_EXCEEDED', charged: 0, balanceAfter: baseSave.money}
      }
      realPrice = upg.price
      vehicle.upgrades = candidateUpgrades
      postCommitEvents.push(() =>
        emit({type: 'garage:mod', vehicleId: vehicle.id, upgrades: {...vehicle.upgrades}, visual: {...vehicle.visual}}),
      )
    } else if (req.itemType === 'ebike_visual') {
      if (isSharedVehicleId(req.targetVehicleId)) {
        return {ok: false, code: 'SHARED_UPGRADE_FORBIDDEN', charged: 0, balanceAfter: baseSave.money}
      }
      const vis = EBIKE_VISUALS_BY_ID[req.itemId]
      if (!vis) return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: baseSave.money}
      if (!req.targetVehicleId || !nextSave.garage.vehicles[req.targetVehicleId]) {
        return {ok: false, code: 'VEHICLE_NOT_FOUND', charged: 0, balanceAfter: baseSave.money}
      }
      const vehicle = nextSave.garage.vehicles[req.targetVehicleId]
      const modelDef = PERSONAL_EBIKE_MODELS[vehicle.modelId]
      if (!modelDef.allowedVisuals.includes(vis.slotKey)) {
        return {ok: false, code: 'UPGRADE_CAP_EXCEEDED', charged: 0, balanceAfter: baseSave.money}
      }
      // Check if every key in vis.patch is already active on this vehicle
      const alreadyApplied = Object.entries(vis.patch).every(
        ([k, val]) => (vehicle.visual as unknown as Record<string, unknown>)[k] === val,
      )
      if (alreadyApplied) {
        return {ok: true, code: 'ALREADY_OWNED', charged: 0, balanceAfter: baseSave.money}
      }
      realPrice = vis.price
      vehicle.visual = {...vehicle.visual, ...vis.patch}
      postCommitEvents.push(() =>
        emit({type: 'garage:mod', vehicleId: vehicle.id, upgrades: {...vehicle.upgrades}, visual: {...vehicle.visual}}),
      )
    } else if (req.itemType === 'ebike_service') {
      if (isSharedVehicleId(req.targetVehicleId)) {
        return {ok: false, code: 'SHARED_UPGRADE_FORBIDDEN', charged: 0, balanceAfter: baseSave.money}
      }
      const service = EBIKE_SERVICE_CATALOG[req.itemId as keyof typeof EBIKE_SERVICE_CATALOG]
      if (!service) return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: baseSave.money}
      if (!req.targetVehicleId || !nextSave.garage.vehicles[req.targetVehicleId]) {
        return {ok: false, code: 'VEHICLE_NOT_FOUND', charged: 0, balanceAfter: baseSave.money}
      }
      const vehicle = nextSave.garage.vehicles[req.targetVehicleId]
      if (service.id === 'slow_charge') {
        if (vehicle.batteryPct >= 80) {
          return {ok: true, code: 'ALREADY_FULL', charged: 0, balanceAfter: baseSave.money}
        }
        realPrice = 0
        vehicle.batteryPct = 80
      } else if (service.id === 'fast_charge') {
        if (vehicle.batteryPct >= 100) {
          return {ok: true, code: 'ALREADY_FULL', charged: 0, balanceAfter: baseSave.money}
        }
        realPrice = service.fixedPrice ?? 20
        vehicle.batteryPct = 100
      } else if (service.id === 'full_repair') {
        if (vehicle.durabilityPct >= 100) {
          return {ok: true, code: 'ALREADY_FULL', charged: 0, balanceAfter: baseSave.money}
        }
        realPrice = service.fixedPrice ?? 80
        vehicle.durabilityPct = 100
      } else {
        if (vehicle.batteryPct >= 100 && vehicle.durabilityPct >= 100) {
          return {ok: true, code: 'ALREADY_FULL', charged: 0, balanceAfter: baseSave.money}
        }
        realPrice = calcFullServiceCost(vehicle.batteryPct, vehicle.durabilityPct)
        vehicle.batteryPct = 100
        vehicle.durabilityPct = 100
      }
      const chargedCost = realPrice
      postCommitEvents.push(() =>
        emit({
          type: 'garage:service',
          vehicleId: vehicle.id,
          batteryPct: vehicle.batteryPct,
          durabilityPct: vehicle.durabilityPct,
          cost: chargedCost,
        }),
      )
    } else {
      return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: baseSave.money}
    }

    if (realPrice === null || !Number.isSafeInteger(realPrice) || realPrice < 0) {
      return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: baseSave.money}
    }
    if (!Number.isSafeInteger(req.expectedPrice) || req.expectedPrice !== realPrice) {
      return {
        ok: false,
        code: 'PRICE_MISMATCH',
        charged: 0,
        balanceAfter: baseSave.money,
        expectedPrice: realPrice,
      }
    }

    // Step 5: Funds check (strictly prevents negative balance)
    if (baseSave.money < realPrice) {
      return {
        ok: false,
        code: 'INSUFFICIENT_FUNDS',
        charged: 0,
        balanceAfter: baseSave.money,
        deficit: realPrice - baseSave.money,
      }
    }

    // Step 6: Clone -> Validate -> Persist FIRST -> Commit memory & emit
    const balanceAfter = baseSave.money - realPrice
    const txId = nextTxId(nowMs)
    nextSave.money = balanceAfter
    nextSave.updatedAt = nowMs
    appendTx(nextSave, {
      txId,
      idempotencyKey: req.idempotencyKey,
      kind: req.itemType === 'ebike_service' ? 'service' : 'purchase',
      delta: -realPrice,
      balanceAfter,
      refId: `${req.itemType}:${req.itemId}`,
      at: nowMs,
    })

    if (!persistSaveSync(nextSave)) {
      return {ok: false, code: 'PERSIST_FAILED', charged: 0, balanceAfter: baseSave.money}
    }

    _commitPersistedSlice({
      money: nextSave.money,
      wardrobe: nextSave.wardrobe,
      garage: {
        activeVehicleId: nextSave.garage.activeVehicleId,
        vehicles: nextSave.garage.vehicles,
      },
      bumpWalletSeq: true,
    })

    emit({
      type: 'money:change',
      delta: -realPrice,
      balance: balanceAfter,
      reason: `${req.shopId}:${req.itemType}:${req.itemId}`,
      txId,
    })
    emit({
      type: 'shop:buy',
      shopId: req.shopId,
      itemType: req.itemType,
      itemId: req.itemId,
      price: realPrice,
      txId,
    })
    for (const fire of postCommitEvents) fire()

    return {
      ok: true,
      code: 'OK',
      charged: realPrice,
      balanceAfter,
      txId,
      ...(createdVehicleId ? {createdVehicleId} : {}),
    }
  } finally {
    inFlightLocks.delete(lockKey)
  }
}

/**
 * Atomic anti-farm reward credit (used by missions, errands, and viewpoint first-check-in bounties).
 */
export function creditReward(req: RewardRequest): RewardResult {
  const baseSave = getActiveSaveSnapshot()
  if (
    !req ||
    !req.idempotencyKey ||
    !req.refId ||
    typeof req.amount !== 'number' ||
    !Number.isSafeInteger(req.amount) ||
    req.amount <= 0
  ) {
    return {ok: false, code: 'INVALID_AMOUNT', credited: 0, balanceAfter: baseSave.money}
  }

  const replayed = findIdempotentTx(baseSave, req.idempotencyKey)
  if (replayed) {
    return {
      ok: true,
      code: 'IDEMPOTENT_REPLAY',
      credited: 0,
      balanceAfter: baseSave.money,
      txId: replayed.txId,
    }
  }

  if (req.source === 'spot_bounty' && baseSave.economy.claimedSpotBounties.includes(req.refId)) {
    return {ok: false, code: 'ALREADY_CLAIMED', credited: 0, balanceAfter: baseSave.money}
  }
  if ((req.source === 'mission_first_clear' || req.firstClearOnly) && baseSave.economy.claimedMissionFirstClear.includes(req.refId)) {
    return {ok: false, code: 'ALREADY_CLAIMED', credited: 0, balanceAfter: baseSave.money}
  }

  const nowMs = Date.now()
  const nextSave = cloneSave(baseSave)
  const balanceAfter = Math.min(MAX_SAFE_MONEY, baseSave.money + req.amount)
  const credited = balanceAfter - baseSave.money
  const txId = nextTxId(nowMs)

  nextSave.money = balanceAfter
  nextSave.updatedAt = nowMs

  if (req.source === 'spot_bounty') {
    if (!nextSave.spotsFound.includes(req.refId)) nextSave.spotsFound.push(req.refId)
    if (!nextSave.economy.claimedSpotBounties.includes(req.refId)) {
      nextSave.economy.claimedSpotBounties.push(req.refId)
    }
  } else {
    if (!nextSave.missionsDone.includes(req.refId)) nextSave.missionsDone.push(req.refId)
    if (req.source === 'mission_first_clear' || req.firstClearOnly) {
      if (!nextSave.economy.claimedMissionFirstClear.includes(req.refId)) {
        nextSave.economy.claimedMissionFirstClear.push(req.refId)
      }
    }
    const prevCount = nextSave.economy.completedMissionCounts[req.refId] ?? 0
    nextSave.economy.completedMissionCounts[req.refId] = prevCount + 1
    nextSave.economy.missionHistory[req.refId] = {count: prevCount + 1, lastAt: nowMs}
  }

  appendTx(nextSave, {
    txId,
    idempotencyKey: req.idempotencyKey,
    kind: 'reward',
    delta: credited,
    balanceAfter,
    refId: `${req.source}:${req.refId}`,
    at: nowMs,
  })

  if (!persistSaveSync(nextSave)) {
    return {ok: false, code: 'PERSIST_FAILED', credited: 0, balanceAfter: baseSave.money}
  }

  if (req.source === 'spot_bounty') {
    syncLegacyStamps(nextSave.spotsFound)
  }

  _commitPersistedSlice({
    money: nextSave.money,
    spotsFound: nextSave.spotsFound,
    missionsDone: nextSave.missionsDone,
    bumpWalletSeq: true,
  })

  emit({
    type: 'money:change',
    delta: credited,
    balance: balanceAfter,
    reason: `${req.source}:${req.refId}`,
    txId,
  })

  return {ok: true, code: 'OK', credited, balanceAfter, txId}
}

/**
 * Atomic deduction for fines / shared-bike unlock fees (clamped at 0; never negative).
 */
export function applyFine(req: FineRequest): FineResult {
  const baseSave = getActiveSaveSnapshot()
  if (!req || !req.idempotencyKey || !Number.isSafeInteger(req.amount) || req.amount <= 0) {
    return {ok: false, code: 'INVALID_AMOUNT', charged: 0, balanceAfter: baseSave.money}
  }
  const replayed = findIdempotentTx(baseSave, req.idempotencyKey)
  if (replayed) {
    return {ok: true, code: 'IDEMPOTENT_REPLAY', charged: 0, balanceAfter: baseSave.money, txId: replayed.txId}
  }
  const nowMs = Date.now()
  const nextSave = cloneSave(baseSave)
  const charged = Math.min(baseSave.money, req.amount)
  const balanceAfter = baseSave.money - charged
  const txId = nextTxId(nowMs)
  nextSave.money = balanceAfter
  nextSave.updatedAt = nowMs
  appendTx(nextSave, {
    txId,
    idempotencyKey: req.idempotencyKey,
    kind: 'fine',
    delta: -charged,
    balanceAfter,
    refId: req.reason,
    at: nowMs,
  })
  if (!persistSaveSync(nextSave)) {
    return {ok: false, code: 'PERSIST_FAILED', charged: 0, balanceAfter: baseSave.money}
  }
  _commitPersistedSlice({money: balanceAfter, bumpWalletSeq: true})
  emit({type: 'money:change', delta: -charged, balance: balanceAfter, reason: req.reason, txId})
  emit({type: 'fine', amount: charged, reason: req.reason})
  return {ok: true, code: 'OK', charged, balanceAfter, txId}
}

/** Equips an owned single outfit piece immediately and persists to `glol.save.v1`. */
export function equipOutfitItem(itemId: string): boolean {
  const def = OUTFIT_ITEMS_BY_ID[itemId]
  const baseSave = getActiveSaveSnapshot()
  if (!def || !baseSave.wardrobe.ownedItemIds.includes(def.id)) return false
  if (baseSave.wardrobe.equipped[def.slot] === def.id) return true
  const nextSave = cloneSave(baseSave)
  nextSave.wardrobe.equipped[def.slot] = def.id
  nextSave.updatedAt = Date.now()
  if (!persistSaveSync(nextSave)) return false
  _commitPersistedSlice({wardrobe: nextSave.wardrobe})
  emit({type: 'outfit:equip', equipped: {...nextSave.wardrobe.equipped}})
  return true
}

/** Equips an owned outfit preset immediately and persists to `glol.save.v1`. */
export function equipOutfitPreset(presetId: string): boolean {
  const preset = OUTFIT_PRESETS_BY_ID[presetId]
  const baseSave = getActiveSaveSnapshot()
  if (!preset) return false
  const owned =
    baseSave.wardrobe.ownedPresetIds.includes(preset.id) ||
    Object.values(preset.items).every(id => baseSave.wardrobe.ownedItemIds.includes(id))
  if (!owned) return false
  const nextSave = cloneSave(baseSave)
  nextSave.wardrobe.equipped = {...preset.items}
  nextSave.updatedAt = Date.now()
  if (!persistSaveSync(nextSave)) return false
  _commitPersistedSlice({wardrobe: nextSave.wardrobe})
  emit({type: 'outfit:equip', equipped: {...nextSave.wardrobe.equipped}})
  return true
}

/** Toggles auto-helmet on e-bike ride and persists immediately. */
export function setAutoHelmetOnRide(enabled: boolean): boolean {
  const baseSave = getActiveSaveSnapshot()
  if (baseSave.wardrobe.autoHelmetOnRide === enabled) return true
  const nextSave = cloneSave(baseSave)
  nextSave.wardrobe.autoHelmetOnRide = enabled
  nextSave.updatedAt = Date.now()
  if (!persistSaveSync(nextSave)) return false
  _commitPersistedSlice({wardrobe: nextSave.wardrobe})
  return true
}

/** Selects an owned personal e-bike as active primary ride and persists immediately. */
export function selectActivePersonalVehicle(vehicleId: string): boolean {
  const baseSave = getActiveSaveSnapshot()
  if (!baseSave.garage.vehicles[vehicleId]) return false
  if (baseSave.garage.activeVehicleId === vehicleId) return true
  const nextSave = cloneSave(baseSave)
  nextSave.garage.activeVehicleId = vehicleId
  nextSave.updatedAt = Date.now()
  if (!persistSaveSync(nextSave)) return false
  _commitPersistedSlice({garage: {activeVehicleId: vehicleId, vehicles: nextSave.garage.vehicles}})
  emit({type: 'garage:select', vehicleId})
  return true
}

/**
 * Updates high-frequency personal e-bike telemetry (`batteryPct`, `durabilityPct`, `odometerKm`).
 * Uses 1500ms throttled save during continuous riding, or immediate sync save on dismount / crash / shop entry.
 */
export function updatePersonalVehicleTelemetry(
  vehicleId: string,
  patch: {batteryPct?: number; durabilityPct?: number; deltaOdometerKm?: number},
  immediate = false,
): boolean {
  const baseSave = getActiveSaveSnapshot()
  const existing = baseSave.garage.vehicles[vehicleId]
  if (!existing) return false
  const nextSave = cloneSave(baseSave)
  const target = nextSave.garage.vehicles[vehicleId]
  if (patch.batteryPct !== undefined && Number.isFinite(patch.batteryPct)) {
    target.batteryPct = Math.max(0, Math.min(100, +patch.batteryPct.toFixed(2)))
  }
  if (patch.durabilityPct !== undefined && Number.isFinite(patch.durabilityPct)) {
    // Durability floor = 15% on crash/wear per spec §3.2 (never bricked)
    target.durabilityPct = Math.max(15, Math.min(100, +patch.durabilityPct.toFixed(2)))
  }
  if (patch.deltaOdometerKm !== undefined && Number.isFinite(patch.deltaOdometerKm) && patch.deltaOdometerKm > 0) {
    target.odometerKm = +(target.odometerKm + patch.deltaOdometerKm).toFixed(3)
  }
  nextSave.updatedAt = Date.now()
  if (immediate) {
    if (!persistSaveSync(nextSave)) return false
  } else {
    scheduleThrottledSave(nextSave)
  }
  _commitPersistedSlice({garage: {vehicles: nextSave.garage.vehicles}})
  return true
}

/** Records a discovered viewpoint spot into `glol.save.v1` and dual-writes `glol.stamps`. */
export function recordSpotFound(spotId: string): boolean {
  const baseSave = getActiveSaveSnapshot()
  if (!spotId || baseSave.spotsFound.includes(spotId)) return false
  const nextSave = cloneSave(baseSave)
  nextSave.spotsFound.push(spotId)
  nextSave.updatedAt = Date.now()
  if (!persistSaveSync(nextSave)) return false
  syncLegacyStamps(nextSave.spotsFound)
  _commitPersistedSlice({spotsFound: nextSave.spotsFound})
  return true
}
