import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { DRINK_SOUND_CATALOG, createDrinksAudio } from '../audio/index.ts'
import { DRINKS_MENU } from '../menu/menu.ts'
import {
  DEFAULT_DRINK_SKIN,
  DRINK_CATALOG,
  DRINK_IDS,
  EQUIPMENT_ACTION_CATALOG,
  EQUIPMENT_ACTION_IDS,
  buildAllDrinksShowcaseGroup,
  buildDrinkProp,
  countObjectTriangles,
  createDrinksEquipmentRig,
  disposeDrinkProp,
  inspectDrinkCatalogProps,
  resolveDrinkSkin,
  resolveEquipmentActionForStep,
  resolveEquipmentSequenceForStation,
  syncDrinksEquipmentAudio,
  syncEquipmentFromSimOrder,
} from './index.ts'

test('props 严格以 menu/menu.ts 的 10 个饮品 id 为唯一标准且无多余 id', () => {
  const menuIds = DRINKS_MENU.map(item => item.id).sort()
  const propIds = [...DRINK_IDS].sort()
  assert.deepEqual(propIds, menuIds)
  assert.deepEqual(Object.keys(DRINK_CATALOG).sort(), menuIds)

  const deprecatedIds = [
    'brown_sugar_boba',
    'four_seasons_milk',
    'grape_cheesefoam',
    'mango_pomelo',
    'passion_fruit',
    'peach_oolong',
    'sundae_cone',
    'lemonade',
  ]
  for (const oldId of deprecatedIds) {
    assert.equal(oldId in DRINK_CATALOG, false, `props 中不应保留废弃 id: ${oldId}`)
  }

  for (const item of DRINKS_MENU) {
    const spec = DRINK_CATALOG[item.id]
    assert.ok(spec, `缺少菜单饮品 ${item.id}`)
    assert.equal(spec.name, item.name)
    assert.equal(spec.stationKind, item.stationKind)
    assert.equal(spec.cupMl, item.volumeMl)
  }
})

test('全菜单 10 款饮品满足比例、轻量面数预算且造型特征各不相同', () => {
  const report = inspectDrinkCatalogProps()
  assert.equal(report.length, DRINKS_MENU.length)

  // 检查每款外观指纹唯一（禁止两款同模只换色）
  const fingerprints = new Set()
  let totalTris = 0
  for (const item of report) {
    assert.ok(item.triangles >= 140 && item.triangles <= 800, `${item.id} 面数超标或过简: ${item.triangles}`)
    assert.ok(
      item.bounds.heightM >= 0.135 && item.bounds.heightM <= 0.24,
      `${item.id} 高度不合手持比例: ${item.bounds.heightM}`,
    )
    assert.ok(item.bounds.widthM >= 0.06 && item.bounds.widthM <= 0.115, `${item.id} 宽度异常: ${item.bounds.widthM}`)
    assert.ok(item.bounds.minY < 0 && item.bounds.maxY > 0, `${item.id} 掌心握持原点 (0,0,0) 应居杯身中部`)
    const spec = DRINK_CATALOG[item.id]
    const fp = `${item.silhouette}|${item.lid}|${item.cupMl}|${item.meshes}|${spec.sleeveTheme}|${Boolean(spec.strawHex)}`
    assert.equal(fingerprints.has(fp), false, `检测到疑似同模换色: ${item.id} (${fp})`)
    fingerprints.add(fp)
    totalTris += item.triangles
  }
  assert.ok(totalTris <= 6500, `全菜单 10 款总面数过高: ${totalTris}`)
})

test('6 种设备动作支持外部 0..1 进度驱动（起/中/收状态明显不同）且覆盖全菜单步骤与音效', () => {
  assert.deepEqual([...EQUIPMENT_ACTION_IDS], [
    'ice_cream_dispense',
    'tea_shake',
    'cup_seal',
    'fruit_pour',
    'ice_scoop',
    'label_apply',
  ])

  const audio = createDrinksAudio({ syncRidePref: false })
  for (const actionId of EQUIPMENT_ACTION_IDS) {
    const spec = EQUIPMENT_ACTION_CATALOG[actionId]
    assert.ok(spec.soundId in DRINK_SOUND_CATALOG, `缺少音效 ${spec.soundId}`)

    const rig = createDrinksEquipmentRig(actionId)
    const tris = rig.getTriangles()
    assert.ok(tris >= 100 && tris <= 950, `${actionId} 面数异常: ${tris}`)

    rig.setProgress(0.06)
    const startSnap = rig.getPhaseSnapshot()
    rig.setProgress(0.5)
    const midSnap = rig.getPhaseSnapshot()
    rig.setProgress(0.96)
    const endSnap = rig.getPhaseSnapshot()

    assert.equal(startSnap.phase, 'start')
    assert.equal(midSnap.phase, 'mid')
    assert.equal(endSnap.phase, 'end')
    assert.ok(
      Math.abs(midSnap.primaryMetric - startSnap.primaryMetric) > 1e-3 ||
        Math.abs(midSnap.secondaryMetric - startSnap.secondaryMetric) > 1e-3,
      `${actionId} 起->中 动作状态无变化`,
    )
    assert.ok(
      Math.abs(endSnap.primaryMetric - midSnap.primaryMetric) > 1e-3 ||
        Math.abs(endSnap.secondaryMetric - midSnap.secondaryMetric) > 1e-3,
      `${actionId} 中->收 动作状态无变化`,
    )

    const beforeCount = audio.getStats().playedCounts[spec.soundId] ?? 0
    syncDrinksEquipmentAudio(audio, actionId, 0.08, 0)
    const afterCount = audio.getStats().playedCounts[spec.soundId] ?? 0
    assert.equal(afterCount, beforeCount + 1, `${actionId} 应记录对应音效 ${spec.soundId}`)
    rig.dispose()
  }

  for (const item of DRINKS_MENU) {
    for (const step of item.steps) {
      const act = resolveEquipmentActionForStep(step.id, step.stationKind)
      assert.ok(EQUIPMENT_ACTION_IDS.includes(act))
    }
    const seq = resolveEquipmentSequenceForStation(item.stationKind)
    assert.ok(seq.length >= 3)
  }

  const simMid = syncEquipmentFromSimOrder({ status: 'preparing', progress: 0.45, stationKind: 'cream_top' })
  assert.ok(EQUIPMENT_ACTION_IDS.includes(simMid.action))
  assert.ok(simMid.stepProgress >= 0 && simMid.stepProgress <= 1)
  audio.dispose()
})

test('支持通过皮肤配置隔离涂装并正确装配/释放全菜单同框组', () => {
  const customSkin = resolveDrinkSkin({
    id: 'test_custom_skin',
    brandLabel: '阳朔清凉',
    primaryHex: '#1f6fc2',
  })
  assert.equal(customSkin.brandLabel, '阳朔清凉')
  assert.equal(DEFAULT_DRINK_SKIN.brandLabel, '桂林冰饮')

  const cup = buildDrinkProp('ice_lemon_water', { skin: customSkin })
  assert.equal(cup.userData.skinId, 'test_custom_skin')
  assert.ok(countObjectTriangles(cup) >= 200)
  disposeDrinkProp(cup)

  const showcase = buildAllDrinksShowcaseGroup()
  assert.equal(showcase.children.length, DRINKS_MENU.length)
  disposeDrinkProp(showcase)
})

test('drinks/props 源码零 mifen 内部依赖与零真实商标字样', () => {
  const dir = new URL('.', import.meta.url).pathname
  for (const file of ['catalog.ts', 'skins.ts', 'builder.ts', 'equipment.ts', 'index.ts']) {
    const text = readFileSync(join(dir, file), 'utf8')
    assert.equal(/\.\.\/mifen|\/mifen\//.test(text), false, `${file} 不应引用 mifen 内部模块`)
    assert.equal(/蜜雪冰城|Mixue|雪王/.test(text), false, `${file} 不应提交真实商业商标`)
  }
})
