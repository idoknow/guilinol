/**
 * 香烟系统的纯逻辑回归（不碰 three.js / DOM）。
 *
 *   node --test scripts/smoke-test.mjs
 *
 * 只测 web/src/smoke/data.ts —— 它没有任何相对 import，Node 的类型剥离能直接跑。
 * 覆盖的正好是需求里写死的那几条：20 包 / 每包 20 根 / 6 格快捷栏 / 3 分钟烧完 / 一口 30 秒。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assignPack,
  BRANDS,
  BURN_TOTAL,
  burnRatio,
  clearSlot,
  freshInventory,
  HOTBAR_SLOTS,
  INVENTORY_KEY,
  loadInventory,
  PACK_CAPACITY,
  PACK_COUNT,
  packAt,
  PUFF_COST,
  saveInventory,
  sanitizeInventory,
  takeCigarette,
} from '../web/src/smoke/data.ts'

/** 一个只存在内存里的 Storage，测存档用 */
function memoryStorage() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    get length() {
      return map.size
    },
  }
}

test('背包固定 20 包，每包 20 根', () => {
  const inventory = freshInventory()
  assert.equal(inventory.packs.length, PACK_COUNT)
  assert.equal(PACK_COUNT, 20)
  assert.equal(PACK_CAPACITY, 20)
  for (const pack of inventory.packs) assert.equal(pack.cigarettes, PACK_CAPACITY)
  // 4 个品牌各 5 包，20 包正好分完
  const perBrand = new Map()
  for (const pack of inventory.packs) perBrand.set(pack.brand, (perBrand.get(pack.brand) ?? 0) + 1)
  assert.equal(perBrand.size, BRANDS.length)
  for (const count of perBrand.values()) assert.equal(count, PACK_COUNT / BRANDS.length)
})

test('快捷栏 6 格，一开始是空的，对应的就是 1–6', () => {
  const inventory = freshInventory()
  assert.equal(HOTBAR_SLOTS, 6)
  assert.equal(inventory.hotbar.length, 6)
  for (let slot = 0; slot < HOTBAR_SLOTS; slot++) assert.equal(packAt(inventory, slot), undefined)
})

test('把烟拖进快捷栏、换格、拖回去', () => {
  const inventory = freshInventory()
  const [first, second] = inventory.packs
  assert.equal(assignPack(inventory, first.id, 2), true)
  assert.equal(packAt(inventory, 2)?.id, first.id)
  // 同一包再放进同一格：不动
  assert.equal(assignPack(inventory, first.id, 2), false)
  // 放进已经占用的格子：两格互换
  assert.equal(assignPack(inventory, second.id, 0), true)
  assert.equal(assignPack(inventory, first.id, 0), true)
  assert.equal(packAt(inventory, 0)?.id, first.id)
  assert.equal(packAt(inventory, 2)?.id, second.id)
  // 拖回背包
  assert.equal(clearSlot(inventory, 0), true)
  assert.equal(packAt(inventory, 0), undefined)
  assert.equal(clearSlot(inventory, 0), false)
  // 越界不崩
  assert.equal(assignPack(inventory, first.id, -1), false)
  assert.equal(assignPack(inventory, first.id, HOTBAR_SLOTS), false)
})

test('一根烟自然燃烧 3 分钟，吸一口少 30 秒', () => {
  assert.equal(BURN_TOTAL, 3 * 60)
  assert.equal(PUFF_COST, 30)
  // 不吸：正好三分钟烧完
  assert.equal(BURN_TOTAL, 180)
  // 一口不落地吸：6 口抽完
  assert.equal(BURN_TOTAL / PUFF_COST, 6)
  // 进度条
  assert.equal(burnRatio(BURN_TOTAL), 1)
  assert.equal(burnRatio(BURN_TOTAL - PUFF_COST), 5 / 6)
  assert.equal(burnRatio(0), 0)
  assert.equal(burnRatio(-10), 0)
})

test('抽一根就少一根，抽完不能继续', () => {
  const inventory = freshInventory()
  const pack = inventory.packs[0]
  for (let left = PACK_CAPACITY; left > 0; left--) {
    assert.equal(pack.cigarettes, left)
    assert.equal(takeCigarette(pack), true)
  }
  assert.equal(pack.cigarettes, 0)
  assert.equal(takeCigarette(pack), false)
})

test('存档能存能读，脏数据退回全新存档', () => {
  const storage = memoryStorage()
  const inventory = freshInventory()
  inventory.packs[3].cigarettes = 7
  assignPack(inventory, inventory.packs[3].id, 4)
  saveInventory(inventory, storage)

  const loaded = loadInventory(storage)
  assert.equal(loaded.packs[3].cigarettes, 7)
  assert.equal(loaded.hotbar[4], inventory.packs[3].id)

  // 坏 JSON
  storage.setItem(INVENTORY_KEY, '{')
  assert.equal(loadInventory(storage).packs.length, PACK_COUNT)
  // 包数不对
  storage.setItem(INVENTORY_KEY, JSON.stringify({v: 1, packs: [], hotbar: []}))
  assert.equal(loadInventory(storage).packs.length, PACK_COUNT)
  // 品牌不认识
  const broken = freshInventory()
  broken.packs[0].brand = 'zhonghua'
  storage.setItem(INVENTORY_KEY, JSON.stringify(broken))
  assert.equal(loadInventory(storage).packs.length, PACK_COUNT)
  // 同一包被塞进两个格子：只留一个
  const duplicated = freshInventory()
  const id = duplicated.packs[0].id
  duplicated.hotbar = [id, id, null, null, null, null]
  const fixed = sanitizeInventory(JSON.parse(JSON.stringify(duplicated)))
  assert.equal(fixed.hotbar[0], id)
  assert.equal(fixed.hotbar[1], null)
  // 没有 localStorage 也不能炸
  assert.equal(loadInventory(undefined).packs.length, PACK_COUNT)
})
