import {
  cloneSave,
  getActiveSaveSnapshot,
  persistSaveSync,
  type LocalSaveV1,
} from '../../game/save.ts'
import { _commitPersistedSlice, emit, getState } from '../../game/state.ts'
import {
  purchaseDrinkWithWallet,
  refundDrinkWithWallet,
  type DrinkPurchaseRequest,
  type DrinkPurchaseResult,
  type DrinkRefundRequest,
  type DrinkRefundResult,
  type DrinkSaveLike,
  type DrinkWalletBackend,
} from './payment-core.ts'

export * from './payment-core.ts'

export const mainGameDrinkWallet: DrinkWalletBackend<LocalSaveV1> = {
  getBalance: () => getState().money,
  getSnapshot: () => getActiveSaveSnapshot(),
  cloneSnapshot: save => cloneSave(save),
  persist: nextSave => persistSaveSync(nextSave),
  commitMoney: money => _commitPersistedSlice({ money, bumpWalletSeq: true }),
  emitMoneyChange: (delta, balance, reason, txId) =>
    emit({ type: 'money:change', delta, balance, reason, txId }),
  emitShopBuy: (shopId, itemId, price, txId) =>
    emit({ type: 'shop:buy', shopId, itemType: 'drink_item', itemId, price, txId }),
}

export function purchaseDrink<TSave extends DrinkSaveLike = LocalSaveV1>(
  req: DrinkPurchaseRequest,
  wallet?: DrinkWalletBackend<TSave>,
  nowMs = Date.now(),
): DrinkPurchaseResult {
  const target = (wallet ?? mainGameDrinkWallet) as DrinkWalletBackend<DrinkSaveLike>
  return purchaseDrinkWithWallet(req, target, nowMs)
}

export function refundDrinkPurchase<TSave extends DrinkSaveLike = LocalSaveV1>(
  req: DrinkRefundRequest,
  wallet?: DrinkWalletBackend<TSave>,
  nowMs = Date.now(),
): DrinkRefundResult {
  const target = (wallet ?? mainGameDrinkWallet) as DrinkWalletBackend<DrinkSaveLike>
  return refundDrinkWithWallet(req, target, nowMs)
}
