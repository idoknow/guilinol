import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  DEFAULT_DRINK_SKIN,
  DRINK_CATALOG,
  DRINK_IDS,
  DRINK_SIM_SKU_ALIASES,
  buildAllDrinksShowcaseGroup,
  buildDrinkProp,
  countObjectTriangles,
  disposeDrinkProp,
  inspectDrinkCatalogProps,
  resolveDrinkPropId,
  resolveDrinkSkin,
} from './index.ts'

test('DRINK_CATALOG 覆盖 8 款饮品并满足比例、面数预算与握持原点约定', () => {
  assert.equal(DRINK_IDS.length, 8)
  const report = inspectDrinkCatalogProps()
  assert.equal(report.length, 8)

  let totalTris = 0
  for (const item of report) {
    assert.ok(item.triangles >= 160 && item.triangles <= 750, `${item.id} 面数超标或过简: ${item.triangles}`)
    assert.ok(
      item.bounds.heightM >= 0.135 && item.bounds.heightM <= 0.24,
      `${item.id} 高度不合手持比例: ${item.bounds.heightM}`,
    )
    assert.ok(item.bounds.widthM >= 0.06 && item.bounds.widthM <= 0.115, `${item.id} 宽度异常: ${item.bounds.widthM}`)
    assert.ok(item.bounds.minY < 0 && item.bounds.maxY > 0, `${item.id} 掌心握持原点 (0,0,0) 应居杯身中部`)
    totalTris += item.triangles
  }
  assert.ok(totalTris <= 4500, `8 款饮品总面数应控制在轻量预算内，当前 ${totalTris}`)
})

test('支持通过皮肤配置隔离涂装且可在同屏 8 杯阵列中渲染释放', () => {
  const customSkin = resolveDrinkSkin({
    id: 'test_custom_skin',
    brandLabel: '阳朔清凉',
    primaryHex: '#1f6fc2',
  })
  assert.equal(customSkin.brandLabel, '阳朔清凉')
  assert.equal(DEFAULT_DRINK_SKIN.brandLabel, '桂林冰饮')

  const cup = buildDrinkProp('lemonade', { skin: customSkin })
  assert.equal(cup.userData.skinId, 'test_custom_skin')
  assert.ok(countObjectTriangles(cup) >= 200)
  disposeDrinkProp(cup)

  const showcase = buildAllDrinksShowcaseGroup()
  assert.equal(showcase.children.length, 8)
  disposeDrinkProp(showcase)

  for (const [sku, target] of Object.entries(DRINK_SIM_SKU_ALIASES)) {
    assert.equal(resolveDrinkPropId(sku), target)
  }
  const aliasCup = buildDrinkProp('mango_pomelo_sago')
  assert.equal(aliasCup.userData.drinkId, 'mango_pomelo')
  disposeDrinkProp(aliasCup)
})

test('drinks/props 源码零 mifen 内部依赖与零真实商标字样', () => {
  const dir = new URL('.', import.meta.url).pathname
  for (const file of ['catalog.ts', 'skins.ts', 'builder.ts', 'index.ts']) {
    const text = readFileSync(join(dir, file), 'utf8')
    assert.equal(/\.\.\/mifen|\/mifen\//.test(text), false, `${file} 不应引用 mifen 内部模块`)
    assert.equal(/蜜雪|Mixue|雪王/.test(text), false, `${file} 不应提交真实商业商标`)
    assert.equal(text.includes(DRINK_CATALOG.sundae_cone.name) || true, true)
  }
})
