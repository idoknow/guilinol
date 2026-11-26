import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldMountDrinksShop } from './site.ts'

test('shouldMountDrinksShop returns false by default without ?drinks in both prod and dev', () => {
  assert.equal(shouldMountDrinksShop(), false)
  assert.equal(shouldMountDrinksShop({ isDev: false, search: '' }), false)
  assert.equal(shouldMountDrinksShop({ isDev: true, search: '' }), false)
  assert.equal(shouldMountDrinksShop({ isDev: false, search: '?mode=walk' }), false)
  assert.equal(shouldMountDrinksShop({ isDev: true, search: '?solo=1&mode=walk' }), false)
})

test('shouldMountDrinksShop returns true when ?drinks is present unless explicitly disabled', () => {
  assert.equal(shouldMountDrinksShop({ isDev: false, search: '?drinks' }), true)
  assert.equal(shouldMountDrinksShop({ isDev: true, search: '?drinks' }), true)
  assert.equal(shouldMountDrinksShop({ isDev: false, search: '?mode=walk&drinks' }), true)
  assert.equal(shouldMountDrinksShop({ isDev: false, search: '?drinks=1' }), true)
  assert.equal(shouldMountDrinksShop({ isDev: false, search: '?drinks=true' }), true)
  assert.equal(shouldMountDrinksShop({ isDev: false, search: '?drinks=0' }), false)
  assert.equal(shouldMountDrinksShop({ isDev: false, search: '?drinks=false' }), false)
  assert.equal(shouldMountDrinksShop({ isDev: true, search: '?drinks=off' }), false)
})
