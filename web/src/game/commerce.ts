import {
  calcFastChargeCost,
  calcFullServiceCost,
  calcRepairCost,
  clampUpgradesForModel,
  computeOutfitPresetQuote,
  EBIKE_UPGRADE_MAP,
  EBIKE_VISUAL_MAP,
  ECONOMY_CONSTANTS,
  isPersonalEbikeModelId,
  OUTFIT_ITEM_MAP,
  OUTFIT_PRESET_MAP,
  PERSONAL_EBIKE_MODELS,
  sanitizeVisualForModel,
  type PersistedEbikeVisual,
  type PersonalEbikeModelId,
} from './catalog'
import {
  commitStateMutation,
  emit,
  getState,
  TX_HISTORY_MAX,
  type GameState,
  type LedgerTxRecord,
  type OwnedPersonalEbike,
} from './state'

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
  /** UI-displayed quote for stale-UI detection; real price is ALWAYS derived from catalog. */
  expectedPrice?: number
  idempotencyKey: string
}

export type PurchaseCode =
  | 'OK'
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
  | 'VISUAL_NOT_ALLOWED'
  | 'PERSIST_FAILED'

export interface PurchaseResult {
  ok: boolean
  code: PurchaseCode
  charged: number
  balanceAfter: number
  txId?: string
  createdVehicleId?: string
  deficit?: number
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
  code: 'OK' | 'IN_FLIGHT' | 'ALREADY_CLAIMED' | 'IDEMPOTENT_REPLAY' | 'INVALID_AMOUNT' | 'PERSIST_FAILED'
  credited: number
  balanceAfter: number
  txId?: string
}

export interface RentalChargeResult {
  ok: boolean
  code: 'OK' | 'IDEMPOTENT_REPLAY' | 'INSUFFICIENT_FUNDS' | 'PERSIST_FAILED'
  charged: number
  balanceAfter: number
  txId?: string
}

const inFlightLocks = new Set<string>()
let txSeq = 0

function nextTxId(prefix: string): string {
  txSeq += 1
  return `${prefix}_${Date.now()}_${String(txSeq).padStart(4, '0')}`
}

function appendTx(draft: GameState, record: LedgerTxRecord): void {
  draft.economy.txHistoryRing.push(record)
  if (draft.economy.txHistoryRing.length > TX_HISTORY_MAX) {
    draft.economy.txHistoryRing = draft.economy.txHistoryRing.slice(-TX_HISTORY_MAX)
  }
  draft.walletSeq += 1
}

function isVisualAllowedForModel(modelId: PersonalEbikeModelId, requires?: string): boolean {
  if (!requires) return true
  const def = PERSONAL_EBIKE_MODELS[modelId]
  switch (requires) {
    case 'neon': return def.allowedPresets.includes('neon')
    case 'ghostfire': return def.allowedPresets.includes('ghostfire')
    case 'underglow': return def.allowUnderglow
    case 'angelEye': return def.allowAngelEye
    case 'goldShock': return def.allowGoldShock
    case 'aero': return def.allowAeroParts
    default: return true
  }
}

export function executePurchase(req: PurchaseRequest): PurchaseResult {
  const lockKey = `${req.itemType}:${req.itemId}:${req.targetVehicleId ?? ''}`
  if (inFlightLocks.has(lockKey)) {
    return {ok: false, code: 'IN_FLIGHT', charged: 0, balanceAfter: getState().money}
  }
  inFlightLocks.add(lockKey)
  try {
    const snap = getState()
    if (!req.idempotencyKey || typeof req.idempotencyKey !== 'string') {
      return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: snap.money}
    }
    const existingTx = snap.economy.txHistoryRing.find(t => t.idempotencyKey === req.idempotencyKey)
    if (existingTx) {
      return {ok: true, code: 'IDEMPOTENT_REPLAY', charged: 0, balanceAfter: snap.money, txId: existingTx.txId}
    }

    let realPrice = 0
    let createdVehicleId: string | undefined
    let txKind: LedgerTxRecord['kind'] = 'purchase'
    let applyMutation: (draft: GameState, txId: string) => (keyof GameState)[]
    let postEmit: ((draft: Readonly<GameState>) => void) | undefined

    if (req.itemType === 'outfit_item') {
      const item = OUTFIT_ITEM_MAP.get(req.itemId)
      if (!item) return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: snap.money}
      if (snap.wardrobe.ownedItemIds.includes(item.id)) {
        return {ok: true, code: 'ALREADY_OWNED', charged: 0, balanceAfter: snap.money}
      }
      realPrice = item.price
      applyMutation = draft => {
        draft.wardrobe.ownedItemIds.push(item.id)
        draft.wardrobe.equipped[item.slot] = item.id
        return ['money', 'wardrobe', 'economy', 'walletSeq']
      }
      postEmit = s => emit({type: 'outfit:equip', equipped: {...s.wardrobe.equipped}})
    } else if (req.itemType === 'outfit_preset') {
      const preset = OUTFIT_PRESET_MAP.get(req.itemId)
      if (!preset) return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: snap.money}
      const quote = computeOutfitPresetQuote(preset.id, snap.wardrobe.ownedItemIds)
      if (!quote.valid) return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: snap.money}
      if (quote.alreadyOwned) {
        return {ok: true, code: 'ALREADY_OWNED', charged: 0, balanceAfter: snap.money}
      }
      realPrice = quote.price
      applyMutation = draft => {
        for (const id of quote.missingItemIds) {
          if (!draft.wardrobe.ownedItemIds.includes(id)) draft.wardrobe.ownedItemIds.push(id)
        }
        if (!draft.wardrobe.ownedPresetIds.includes(preset.id)) {
          draft.wardrobe.ownedPresetIds.push(preset.id)
        }
        draft.wardrobe.equipped = {...preset.slots}
        return ['money', 'wardrobe', 'economy', 'walletSeq']
      }
      postEmit = s => emit({type: 'outfit:equip', equipped: {...s.wardrobe.equipped}})
    } else if (req.itemType === 'ebike_model') {
      if (!isPersonalEbikeModelId(req.itemId)) {
        return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: snap.money}
      }
      const alreadyHasModel = Object.values(snap.garage.vehicles).some(v => v.modelId === req.itemId)
      if (alreadyHasModel) {
        return {ok: true, code: 'ALREADY_OWNED', charged: 0, balanceAfter: snap.money}
      }
      const def = PERSONAL_EBIKE_MODELS[req.itemId]
      realPrice = def.price
      createdVehicleId = `ebike_${req.itemId}_${Date.now()}`
      const newBike: OwnedPersonalEbike = {
        id: createdVehicleId,
        modelId: req.itemId,
        purchasedAt: Date.now(),
        batteryPct: 100,
        durabilityPct: 100,
        odometerKm: 0,
        upgrades: {motorLevel: 0, controllerLevel: 0, batteryLevel: 0},
        visual: {...def.defaultVisual},
      }
      applyMutation = draft => {
        draft.garage.vehicles[createdVehicleId!] = newBike
        draft.garage.activeVehicleId = createdVehicleId!
        return ['money', 'garage', 'economy', 'walletSeq']
      }
      postEmit = () => emit({type: 'garage:select', vehicleId: createdVehicleId!})
    } else if (req.itemType === 'ebike_upgrade') {
      if (req.targetVehicleId === 'shared' || req.targetVehicleId?.startsWith('shared:')) {
        return {ok: false, code: 'SHARED_UPGRADE_FORBIDDEN', charged: 0, balanceAfter: snap.money}
      }
      const targetId = req.targetVehicleId ?? snap.garage.activeVehicleId
      if (!targetId || !snap.garage.vehicles[targetId]) {
        return {ok: false, code: 'VEHICLE_NOT_FOUND', charged: 0, balanceAfter: snap.money}
      }
      const entry = EBIKE_UPGRADE_MAP.get(req.itemId)
      if (!entry) return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: snap.money}
      const bike = snap.garage.vehicles[targetId]
      const modelCap = PERSONAL_EBIKE_MODELS[bike.modelId].maxUpgrades[entry.part]
      if (entry.level > modelCap) {
        return {ok: false, code: 'UPGRADE_CAP_EXCEEDED', charged: 0, balanceAfter: snap.money}
      }
      if (bike.upgrades[entry.part] >= entry.level) {
        return {ok: true, code: 'ALREADY_OWNED', charged: 0, balanceAfter: snap.money}
      }
      realPrice = entry.price
      applyMutation = draft => {
        const v = draft.garage.vehicles[targetId]
        v.upgrades = clampUpgradesForModel(v.modelId, {...v.upgrades, [entry.part]: entry.level})
        return ['money', 'garage', 'economy', 'walletSeq']
      }
      postEmit = s => {
        const v = s.garage.vehicles[targetId]
        emit({type: 'garage:mod', vehicleId: targetId, upgrades: {...v.upgrades}, visual: {...v.visual}})
      }
    } else if (req.itemType === 'ebike_visual') {
      if (req.targetVehicleId === 'shared' || req.targetVehicleId?.startsWith('shared:')) {
        return {ok: false, code: 'SHARED_UPGRADE_FORBIDDEN', charged: 0, balanceAfter: snap.money}
      }
      const targetId = req.targetVehicleId ?? snap.garage.activeVehicleId
      if (!targetId || !snap.garage.vehicles[targetId]) {
        return {ok: false, code: 'VEHICLE_NOT_FOUND', charged: 0, balanceAfter: snap.money}
      }
      const entry = EBIKE_VISUAL_MAP.get(req.itemId)
      if (!entry) return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: snap.money}
      const bike = snap.garage.vehicles[targetId]
      if (!isVisualAllowedForModel(bike.modelId, entry.requires)) {
        return {ok: false, code: 'VISUAL_NOT_ALLOWED', charged: 0, balanceAfter: snap.money}
      }
      // Check if every patched field already matches the current visual config
      const alreadyApplied = (Object.entries(entry.patch) as [keyof PersistedEbikeVisual, unknown][]).every(
        ([k, v]) => bike.visual[k] === v,
      )
      if (alreadyApplied) {
        return {ok: true, code: 'ALREADY_OWNED', charged: 0, balanceAfter: snap.money}
      }
      realPrice = entry.price
      applyMutation = draft => {
        const v = draft.garage.vehicles[targetId]
        v.visual = sanitizeVisualForModel(v.modelId, {...v.visual, ...entry.patch})
        return ['money', 'garage', 'economy', 'walletSeq']
      }
      postEmit = s => {
        const v = s.garage.vehicles[targetId]
        emit({type: 'garage:mod', vehicleId: targetId, upgrades: {...v.upgrades}, visual: {...v.visual}})
      }
    } else if (req.itemType === 'ebike_service') {
      if (req.targetVehicleId === 'shared' || req.targetVehicleId?.startsWith('shared:')) {
        return {ok: false, code: 'SHARED_UPGRADE_FORBIDDEN', charged: 0, balanceAfter: snap.money}
      }
      const targetId = req.targetVehicleId ?? snap.garage.activeVehicleId
      if (!targetId || !snap.garage.vehicles[targetId]) {
        return {ok: false, code: 'VEHICLE_NOT_FOUND', charged: 0, balanceAfter: snap.money}
      }
      const bike = snap.garage.vehicles[targetId]
      txKind = 'service'
      if (req.itemId === 'slow_charge') {
        if (bike.batteryPct >= 80) return {ok: true, code: 'ALREADY_FULL', charged: 0, balanceAfter: snap.money}
        realPrice = 0
        applyMutation = draft => {
          draft.garage.vehicles[targetId].batteryPct = Math.max(draft.garage.vehicles[targetId].batteryPct, 80)
          return ['garage', 'economy', 'walletSeq']
        }
      } else if (req.itemId === 'fast_charge') {
        realPrice = calcFastChargeCost(bike.batteryPct)
        if (realPrice === 0) return {ok: true, code: 'ALREADY_FULL', charged: 0, balanceAfter: snap.money}
        applyMutation = draft => {
          draft.garage.vehicles[targetId].batteryPct = 100
          return ['money', 'garage', 'economy', 'walletSeq']
        }
      } else if (req.itemId === 'full_repair') {
        realPrice = calcRepairCost(bike.durabilityPct)
        if (realPrice === 0) return {ok: true, code: 'ALREADY_FULL', charged: 0, balanceAfter: snap.money}
        applyMutation = draft => {
          draft.garage.vehicles[targetId].durabilityPct = 100
          return ['money', 'garage', 'economy', 'walletSeq']
        }
      } else if (req.itemId === 'full_service') {
        realPrice = calcFullServiceCost(bike.batteryPct, bike.durabilityPct)
        if (realPrice === 0) return {ok: true, code: 'ALREADY_FULL', charged: 0, balanceAfter: snap.money}
        applyMutation = draft => {
          draft.garage.vehicles[targetId].batteryPct = 100
          draft.garage.vehicles[targetId].durabilityPct = 100
          return ['money', 'garage', 'economy', 'walletSeq']
        }
      } else {
        return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: snap.money}
      }
      postEmit = s => {
        const v = s.garage.vehicles[targetId]
        emit({type: 'garage:service', vehicleId: targetId, batteryPct: v.batteryPct, durabilityPct: v.durabilityPct, cost: realPrice})
      }
    } else {
      return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: snap.money}
    }

    if (!Number.isSafeInteger(realPrice) || realPrice < 0) {
      return {ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: snap.money}
    }
    if (req.expectedPrice !== undefined && req.expectedPrice !== realPrice) {
      return {ok: false, code: 'PRICE_MISMATCH', charged: 0, balanceAfter: snap.money}
    }
    if (snap.money < realPrice) {
      return {ok: false, code: 'INSUFFICIENT_FUNDS', charged: 0, balanceAfter: snap.money, deficit: realPrice - snap.money}
    }

    const txId = nextTxId('buy')
    const committed = commitStateMutation(
      draft => {
        draft.money -= realPrice
        const changed = applyMutation(draft, txId)
        appendTx(draft, {
          txId,
          idempotencyKey: req.idempotencyKey,
          kind: txKind,
          delta: -realPrice,
          balanceAfter: draft.money,
          refId: `${req.itemType}:${req.itemId}`,
          at: Date.now(),
        })
        return changed
      },
      {persist: 'immediate'},
    )
    if (!committed.ok) {
      return {ok: false, code: 'PERSIST_FAILED', charged: 0, balanceAfter: getState().money}
    }
    const nextState = getState()
    if (realPrice > 0) {
      emit({type: 'money:change', delta: -realPrice, balance: nextState.money, reason: `${req.itemType}:${req.itemId}`, txId})
    }
    emit({type: 'shop:buy', shopId: req.shopId, itemType: req.itemType, itemId: req.itemId, price: realPrice, txId})
    postEmit?.(nextState)
    return {ok: true, code: 'OK', charged: realPrice, balanceAfter: nextState.money, txId, createdVehicleId}
  } finally {
    inFlightLocks.delete(lockKey)
  }
}

export function creditReward(req: RewardRequest): RewardResult {
  const lockKey = `reward:${req.source}:${req.refId}`
  if (inFlightLocks.has(lockKey)) {
    return {ok: false, code: 'IN_FLIGHT', credited: 0, balanceAfter: getState().money}
  }
  inFlightLocks.add(lockKey)
  try {
    const snap = getState()
    if (!Number.isSafeInteger(req.amount) || req.amount <= 0 || req.amount > ECONOMY_CONSTANTS.MAX_SINGLE_REWARD) {
      return {ok: false, code: 'INVALID_AMOUNT', credited: 0, balanceAfter: snap.money}
    }
    if (!req.idempotencyKey) {
      return {ok: false, code: 'INVALID_AMOUNT', credited: 0, balanceAfter: snap.money}
    }
    const existing = snap.economy.txHistoryRing.find(t => t.idempotencyKey === req.idempotencyKey)
    if (existing) {
      return {ok: true, code: 'IDEMPOTENT_REPLAY', credited: 0, balanceAfter: snap.money, txId: existing.txId}
    }
    if (req.source === 'spot_bounty' && snap.economy.spotsClaimed.includes(req.refId)) {
      return {ok: false, code: 'ALREADY_CLAIMED', credited: 0, balanceAfter: snap.money}
    }
    if (req.firstClearOnly && snap.economy.firstClearClaimed.includes(req.refId)) {
      return {ok: false, code: 'ALREADY_CLAIMED', credited: 0, balanceAfter: snap.money}
    }
    const txId = nextTxId('rwd')
    const now = Date.now()
    const committed = commitStateMutation(
      draft => {
        draft.money = Math.min(ECONOMY_CONSTANTS.MAX_MONEY, draft.money + req.amount)
        const changed: (keyof GameState)[] = ['money', 'economy', 'walletSeq']
        if (req.source === 'spot_bounty') {
          if (!draft.spotsFound.includes(req.refId)) { draft.spotsFound.push(req.refId); changed.push('spotsFound') }
          if (!draft.economy.spotsClaimed.includes(req.refId)) draft.economy.spotsClaimed.push(req.refId)
        } else {
          if (!draft.missionsDone.includes(req.refId)) { draft.missionsDone.push(req.refId); changed.push('missionsDone') }
          if (req.firstClearOnly && !draft.economy.firstClearClaimed.includes(req.refId)) {
            draft.economy.firstClearClaimed.push(req.refId)
          }
          const prev = draft.economy.missionHistory[req.refId]
          draft.economy.missionHistory[req.refId] = {count: (prev?.count ?? 0) + 1, lastAt: now}
        }
        appendTx(draft, {
          txId,
          idempotencyKey: req.idempotencyKey,
          kind: 'reward',
          delta: req.amount,
          balanceAfter: draft.money,
          refId: `${req.source}:${req.refId}`,
          at: now,
        })
        return changed
      },
      {persist: 'immediate'},
    )
    if (!committed.ok) {
      return {ok: false, code: 'PERSIST_FAILED', credited: 0, balanceAfter: getState().money}
    }
    const next = getState()
    emit({type: 'money:change', delta: req.amount, balance: next.money, reason: `${req.source}:${req.refId}`, txId})
    return {ok: true, code: 'OK', credited: req.amount, balanceAfter: next.money, txId}
  } finally {
    inFlightLocks.delete(lockKey)
  }
}

/**
 * Shared e-bike rental fee (¥3/ride after the 120 s free grace period; IDOK-123/124/128).
 * If balance < ¥3, returns INSUFFICIENT_FUNDS without going negative so foot/bicycle fallback stays usable.
 */
export function chargeSharedBikeRental(idempotencyKey: string): RentalChargeResult {
  const snap = getState()
  const existing = snap.economy.txHistoryRing.find(t => t.idempotencyKey === idempotencyKey)
  if (existing) {
    return {ok: true, code: 'IDEMPOTENT_REPLAY', charged: 0, balanceAfter: snap.money, txId: existing.txId}
  }
  const fee = ECONOMY_CONSTANTS.SHARED_BIKE_FEE
  if (snap.money < fee) {
    return {ok: false, code: 'INSUFFICIENT_FUNDS', charged: 0, balanceAfter: snap.money}
  }
  const txId = nextTxId('rent')
  const committed = commitStateMutation(
    draft => {
      draft.money -= fee
      appendTx(draft, {
        txId,
        idempotencyKey,
        kind: 'rental',
        delta: -fee,
        balanceAfter: draft.money,
        refId: 'shared_ebike_ride',
        at: Date.now(),
      })
      return ['money', 'economy', 'walletSeq']
    },
    {persist: 'immediate'},
  )
  if (!committed.ok) {
    return {ok: false, code: 'PERSIST_FAILED', charged: 0, balanceAfter: getState().money}
  }
  const next = getState()
  emit({type: 'money:change', delta: -fee, balance: next.money, reason: 'shared_ebike_ride', txId})
  return {ok: true, code: 'OK', charged: fee, balanceAfter: next.money, txId}
}
