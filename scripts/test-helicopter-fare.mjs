import assert from 'node:assert/strict'
import test from 'node:test'

test('local commerce cannot debit or consume an authoritative ticket', async () => {
  const values = new Map()
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  const save = await import('../web/src/game/save.ts')
  const {executePurchase, quotePurchasePrice} = await import('../web/src/game/commerce.ts')
  save.resetSaveForTesting(90)
  const buy = (key, expectedPrice) => executePurchase({shopId:'helipad', itemType:'helicopter_tour', itemId:'ticket', expectedPrice, idempotencyKey:key})
  assert.equal(quotePurchasePrice('helicopter_tour', 'ticket'), 0)
  assert.equal(buy('first', 0).code, 'INVALID_ITEM')
  save.reloadSaveFromStorage()
  assert.equal(buy('first', 0).charged, 0)
  assert.equal(save.getActiveSaveSnapshot().economy.helicopterTours, 0)
  assert.equal(save.getActiveSaveSnapshot().money, 90)
})
