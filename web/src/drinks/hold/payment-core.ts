import { DEFAULT_DRINKS_SKIN, DRINKS_MENU_BY_ID, normalizeDrinkQuantity } from '../menu/menu.ts'

export const DRINK_TX_RING_LIMIT = 64

export interface DrinkLedgerTxRecord {
  txId: string
  idempotencyKey: string
  kind: 'purchase' | 'reward' | 'service' | 'refund' | 'fine'
  delta: number
  balanceAfter: number
  refId: string
  at: number
}

export interface DrinkSaveLike {
  money: number
  updatedAt: number
  economy: {
    txHistoryRing: DrinkLedgerTxRecord[]
  }
}

export interface DrinkPurchaseRequest {
  shopId?: string
  menuItemId: string
  quantity?: number
  expectedUnitPrice: number
  idempotencyKey: string
}

export type DrinkPurchaseCode =
  | 'OK'
  | 'IN_FLIGHT'
  | 'IDEMPOTENT_REPLAY'
  | 'INVALID_ITEM'
  | 'INVALID_QUANTITY'
  | 'PRICE_MISMATCH'
  | 'INSUFFICIENT_FUNDS'
  | 'PERSIST_FAILED'

export interface DrinkPurchaseResult {
  ok: boolean
  code: DrinkPurchaseCode
  charged: number
  balanceAfter: number
  txId?: string
  deficit?: number
  expectedUnitPrice?: number
  expectedTotal?: number
}

export interface DrinkRefundRequest {
  shopId?: string
  menuItemId: string
  quantity: number
  amount: number
  idempotencyKey: string
  reason: string
}

export interface DrinkRefundResult {
  ok: boolean
  code:
    | 'OK'
    | 'IN_FLIGHT'
    | 'IDEMPOTENT_REPLAY'
    | 'INVALID_AMOUNT'
    | 'PURCHASE_NOT_FOUND'
    | 'AMOUNT_EXCEEDS_CHARGE'
    | 'PERSIST_FAILED'
  refunded: number
  balanceAfter: number
  txId?: string
}

export interface DrinkWalletBackend<TSave extends DrinkSaveLike = DrinkSaveLike> {
  getBalance(): number
  getSnapshot(): TSave
  cloneSnapshot(save: TSave): TSave
  persist(nextSave: TSave): boolean
  commitMoney(money: number): void
  emitMoneyChange(delta: number, balance: number, reason: string, txId: string): void
  emitShopBuy(shopId: string, itemId: string, price: number, txId: string): void
}

const inFlightLocks = new Set<string>()
let txSeq = 0

function nextDrinkTxId(nowMs: number): string {
  txSeq = (txSeq + 1) % 100_000
  return `drink_tx_${nowMs}_${String(txSeq).padStart(5, '0')}`
}

function appendTx(save: DrinkSaveLike, tx: DrinkLedgerTxRecord): void {
  save.economy.txHistoryRing.push(tx)
  if (save.economy.txHistoryRing.length > DRINK_TX_RING_LIMIT) {
    save.economy.txHistoryRing = save.economy.txHistoryRing.slice(-DRINK_TX_RING_LIMIT)
  }
}

function findIdempotentTx(save: Readonly<DrinkSaveLike>, idempotencyKey: string): DrinkLedgerTxRecord | undefined {
  if (!idempotencyKey) return undefined
  return save.economy.txHistoryRing.find(tx => tx.idempotencyKey === idempotencyKey)
}

export function _withDrinkInFlightLockForTest<T>(lockKey: string, fn: () => T): T {
  inFlightLocks.add(lockKey)
  try {
    return fn()
  } finally {
    inFlightLocks.delete(lockKey)
  }
}

export function createDrinkLockKey(shopId: string, menuItemId: string, idempotencyKey: string): string {
  return `drink:${shopId}:${menuItemId}:${idempotencyKey}`
}

/**
 * 饮品主游戏钱包原子扣款核心（严格对齐 `docs/commerce-shops-spec.md` §2.3 6 步契约）：
 * 1. 同步重入锁 -> `IN_FLIGHT`
 * 2. 幂等流水重放拦截 -> `IDEMPOTENT_REPLAY`
 * 3. 单一真源目录核价 -> `PRICE_MISMATCH`
 * 4. 余额不足硬拒绝（绝不产生负余额、绝不改米粉营业款） -> `INSUFFICIENT_FUNDS` + `deficit`
 * 5. 先写盘后提交内存态 -> `PERSIST_FAILED` 零脏状态
 * 6. 派发 `money:change` / `shop:buy`
 */
export function purchaseDrinkWithWallet<TSave extends DrinkSaveLike>(
  req: DrinkPurchaseRequest,
  wallet: DrinkWalletBackend<TSave>,
  nowMs = Date.now(),
): DrinkPurchaseResult {
  const fallbackBalance = wallet.getBalance()
  const shopId = req?.shopId || DEFAULT_DRINKS_SKIN.shopId
  if (!req || typeof req.idempotencyKey !== 'string' || !req.idempotencyKey.trim()) {
    return { ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: fallbackBalance }
  }

  const item = DRINKS_MENU_BY_ID[req.menuItemId]
  if (!item) {
    return { ok: false, code: 'INVALID_ITEM', charged: 0, balanceAfter: fallbackBalance }
  }

  const qty = normalizeDrinkQuantity(req.quantity ?? 1)
  if (qty === null) {
    return { ok: false, code: 'INVALID_QUANTITY', charged: 0, balanceAfter: fallbackBalance }
  }

  const lockKey = createDrinkLockKey(shopId, item.id, req.idempotencyKey)
  if (inFlightLocks.has(lockKey)) {
    return { ok: false, code: 'IN_FLIGHT', charged: 0, balanceAfter: fallbackBalance }
  }
  inFlightLocks.add(lockKey)

  try {
    const baseSave = wallet.getSnapshot()
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

    if (!Number.isSafeInteger(req.expectedUnitPrice) || req.expectedUnitPrice !== item.price) {
      return {
        ok: false,
        code: 'PRICE_MISMATCH',
        charged: 0,
        balanceAfter: baseSave.money,
        expectedUnitPrice: item.price,
        expectedTotal: item.price * qty,
      }
    }

    const totalCost = item.price * qty
    if (baseSave.money < totalCost) {
      return {
        ok: false,
        code: 'INSUFFICIENT_FUNDS',
        charged: 0,
        balanceAfter: baseSave.money,
        deficit: totalCost - baseSave.money,
      }
    }

    const balanceAfter = baseSave.money - totalCost
    const txId = nextDrinkTxId(nowMs)
    const nextSave = wallet.cloneSnapshot(baseSave)
    nextSave.money = balanceAfter
    nextSave.updatedAt = nowMs
    appendTx(nextSave, {
      txId,
      idempotencyKey: req.idempotencyKey,
      kind: 'purchase',
      delta: -totalCost,
      balanceAfter,
      refId: `drink:${item.id}x${qty}`,
      at: nowMs,
    })

    if (!wallet.persist(nextSave)) {
      return { ok: false, code: 'PERSIST_FAILED', charged: 0, balanceAfter: baseSave.money }
    }

    wallet.commitMoney(balanceAfter)
    wallet.emitMoneyChange(-totalCost, balanceAfter, `${shopId}:drink:${item.id}x${qty}`, txId)
    wallet.emitShopBuy(shopId, `${item.id}x${qty}`, totalCost, txId)

    return {
      ok: true,
      code: 'OK',
      charged: totalCost,
      balanceAfter,
      txId,
    }
  } finally {
    inFlightLocks.delete(lockKey)
  }
}

export function refundDrinkWithWallet<TSave extends DrinkSaveLike>(
  req: DrinkRefundRequest,
  wallet: DrinkWalletBackend<TSave>,
  nowMs = Date.now(),
): DrinkRefundResult {
  const shopId = req.shopId || DEFAULT_DRINKS_SKIN.shopId
  const baseSave = wallet.getSnapshot()
  if (!req.idempotencyKey || !Number.isSafeInteger(req.amount) || req.amount <= 0) {
    return { ok: false, code: 'INVALID_AMOUNT', refunded: 0, balanceAfter: baseSave.money }
  }

  const refundKey = `refund:${req.idempotencyKey}`
  const lockKey = createDrinkLockKey(shopId, req.menuItemId, refundKey)
  if (inFlightLocks.has(lockKey)) {
    return { ok: false, code: 'IN_FLIGHT', refunded: 0, balanceAfter: baseSave.money }
  }
  inFlightLocks.add(lockKey)

  try {
    const snap = wallet.getSnapshot()
    const replayed = findIdempotentTx(snap, refundKey)
    if (replayed) {
      return {
        ok: true,
        code: 'IDEMPOTENT_REPLAY',
        refunded: 0,
        balanceAfter: snap.money,
        txId: replayed.txId,
      }
    }

    // 单次退款硬校验：必须对应一笔有效扣款流水，且退款总额不得超过原扣款额
    const originalPurchase = snap.economy.txHistoryRing.find(
      tx => tx.kind === 'purchase' && tx.idempotencyKey === req.idempotencyKey,
    )
    if (!originalPurchase) {
      return { ok: false, code: 'PURCHASE_NOT_FOUND', refunded: 0, balanceAfter: snap.money }
    }
    const chargedAmount = Math.abs(originalPurchase.delta)
    if (req.amount > chargedAmount) {
      return { ok: false, code: 'AMOUNT_EXCEEDS_CHARGE', refunded: 0, balanceAfter: snap.money }
    }

    const nextSave = wallet.cloneSnapshot(snap)
    const balanceAfter = snap.money + req.amount
    const txId = nextDrinkTxId(nowMs)
    nextSave.money = balanceAfter
    nextSave.updatedAt = nowMs
    appendTx(nextSave, {
      txId,
      idempotencyKey: refundKey,
      kind: 'refund',
      delta: req.amount,
      balanceAfter,
      refId: `drink:${req.menuItemId}x${req.quantity}`,
      at: nowMs,
    })

    if (!wallet.persist(nextSave)) {
      return { ok: false, code: 'PERSIST_FAILED', refunded: 0, balanceAfter: snap.money }
    }

    wallet.commitMoney(balanceAfter)
    wallet.emitMoneyChange(req.amount, balanceAfter, `${shopId}:refund:${req.reason}`, txId)

    return {
      ok: true,
      code: 'OK',
      refunded: req.amount,
      balanceAfter,
      txId,
    }
  } finally {
    inFlightLocks.delete(lockKey)
  }
}
