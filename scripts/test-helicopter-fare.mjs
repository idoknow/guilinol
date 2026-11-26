import assert from 'node:assert/strict'
import test from 'node:test'

test('tour ticket persists first use and never charges twice for one reservation', async () => {
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
  assert.equal(buy('first', 0).code, 'OK')
  save.reloadSaveFromStorage()
  assert.equal(buy('first', 0).code, 'IDEMPOTENT_REPLAY')
  assert.equal(quotePurchasePrice('helicopter_tour', 'ticket'), 88)
  assert.equal(buy('second', 88).charged, 88)
  assert.equal(buy('second', 88).charged, 0)
  assert.equal(buy('third', 88).code, 'INSUFFICIENT_FUNDS')
  assert.equal(save.getActiveSaveSnapshot().economy.helicopterTours, 2)
  assert.equal(save.getActiveSaveSnapshot().money, 2)
})
