import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildPrBackfillActions,
  loadTicketLedger,
  validateSequentialAdvance,
} from './sync-multica-pr.mjs'
import {
  auditViewerForCheatApis,
  evaluatePhase2Checks,
  loadSiteConfig,
  parseVerifyArgs,
  shopLocalToWorld,
  worldToShopLocal,
} from './verify-mixue-phase2.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('multica-tickets ledger 包含父单与 5 张有序分期子单且负责人/验收项齐全', () => {
  const ledger = loadTicketLedger()
  assert.match(ledger.epic.key, /^IDOK-\d+$/)
  assert.ok(ledger.epic.id.length > 10)
  assert.deepEqual(ledger.epic.acceptanceIds, ['k69', 'k70', 'k71'])
  assert.equal(ledger.subIssues.length, 5)
  assert.deepEqual(
    ledger.subIssues.map(s => s.stage),
    [1, 2, 3, 4, 5],
  )
  for (const s of ledger.subIssues) {
    assert.match(s.key, /^IDOK-\d+$/)
    assert.ok(s.owner.length > 0)
    assert.ok(Array.isArray(s.acceptanceIds) && s.acceptanceIds.length > 0)
    assert.ok(Array.isArray(s.territory) && s.territory.length > 0)
  }
})

test('validateSequentialAdvance 严格禁止跳过未完成前置阶段', () => {
  const ledger = loadTicketLedger()
  const okStage1 = validateSequentialAdvance(ledger, 1)
  assert.equal(okStage1.ok, true)
  assert.equal(okStage1.target.key, 'IDOK-313')

  const blockedStage2 = validateSequentialAdvance(ledger, 2)
  assert.equal(blockedStage2.ok, false)
  assert.match(blockedStage2.reason, /PREVIOUS_STAGE_NOT_DONE:IDOK-313/)

  ledger.subIssues[0].status = 'done'
  const okStage2 = validateSequentialAdvance(ledger, 2)
  assert.equal(okStage2.ok, true)
  assert.equal(okStage2.target.key, 'IDOK-314')
})

test('buildPrBackfillActions 覆盖父单及全部 5 张子单并校验 PR URL 与目标状态', () => {
  const ledger = loadTicketLedger()
  assert.throws(() => buildPrBackfillActions(ledger, 'not-a-pr-url'))
  assert.throws(() => buildPrBackfillActions(ledger, 'https://github.com/idoknow/guilinol/pull/999', '', 'invalid_status'))
  const actions = buildPrBackfillActions(ledger, 'https://github.com/idoknow/guilinol/pull/999', '门禁全绿', 'done')
  assert.equal(actions.length, 6)
  assert.equal(actions[0].key, 'IDOK-312')
  assert.equal(actions[0].targetStatus, 'done')
  assert.deepEqual(
    actions.slice(1).map(a => a.key),
    ['IDOK-313', 'IDOK-314', 'IDOK-315', 'IDOK-316', 'IDOK-317'],
  )
})

test('loadSiteConfig 实时读取 site.ts 且局部/世界坐标可精确互转', () => {
  const site = loadSiteConfig('wangcheng_mall')
  assert.equal(site.id, 'wangcheng_mall')
  assert.ok(Number.isFinite(site.worldX) && Math.abs(site.worldX - -578.235) < 50)
  assert.ok(Number.isFinite(site.worldZ) && Math.abs(site.worldZ - -67.831) < 50)
  const w = shopLocalToWorld(site, -1.42, 4.95)
  const back = worldToShopLocal(site, w.x, w.z)
  assert.ok(Math.abs(back.x - -1.42) < 1e-6)
  assert.ok(Math.abs(back.z - 4.95) < 1e-6)
})

test('auditViewerForCheatApis 精确检出生产构建泄露的作弊/调试接口（k68 联动）', () => {
  const clean = auditViewerForCheatApis({ hasDrinksProp: false, drinksKeys: [], viewerKeys: ['camera', 'walk', 'stats'] })
  assert.equal(clean.clean, true)
  assert.deepEqual(clean.leakedKeys, [])

  const dirty = auditViewerForCheatApis({
    hasDrinksProp: true,
    drinksKeys: ['getState', 'fastForward', 'teleportToShop', 'placeQuickOrder'],
    viewerKeys: ['camera', 'drinks'],
  })
  assert.equal(dirty.clean, false)
  assert.deepEqual(dirty.leakedKeys, [
    'viewer.drinks.fastForward',
    'viewer.drinks.teleportToShop',
    'viewer.drinks.placeQuickOrder',
  ])
})

test('evaluatePhase2Checks 覆盖 k70 全部硬指标及屋顶防呆/HUD 重叠/生产零作弊护栏', () => {
  const pass = evaluatePhase2Checks({
    errors: [],
    shopDrawCalls: 24,
    autoFirstPerson: { enteredFirstPerson: true, onRoof: false, restoredOnExit: true },
    recruitSign: { visible: true, interactive: true },
    holdEnergy: { beforeFill: 1, afterFill: 0.72, energyBarMoved: true, stoppedAfterRelease: true },
    hudOverlaps: [],
    prodProbeAudit: { enforce: true, leakedKeys: [] },
  })
  assert.equal(pass.ok, true)
  assert.deepEqual(pass.failures, [])

  const fail = evaluatePhase2Checks({
    errors: ['pageerror: boom'],
    shopDrawCalls: 42,
    autoFirstPerson: { enteredFirstPerson: false, onRoof: true, camDeltaY: 8.4, restoredOnExit: false },
    recruitSign: { visible: false, interactive: false },
    holdEnergy: { beforeFill: 1, afterFill: 1, energyBarMoved: false, stoppedAfterRelease: false },
    hudOverlaps: [{ source: '.drinks-staff-hud', target: '.hotbar' }],
    prodProbeAudit: { enforce: true, leakedKeys: ['viewer.drinks.fastForward'] },
  })
  assert.equal(fail.ok, false)
  assert.equal(fail.failures.length, 12)
  assert.ok(fail.failures.some(f => f.startsWith('CAMERA_ON_ROOF_NOT_INTERIOR')))
  assert.ok(fail.failures.some(f => f.startsWith('HUD_OVERLAP')))
  assert.ok(fail.failures.some(f => f.startsWith('PROD_CHEAT_API_LEAKED')))
})

test('verify-mixue-phase2 与 sync-multica-pr CLI --dry-run 退出码均为 0', () => {
  const parsed = parseVerifyArgs(['--site', 'wangcheng_mall', '--hold-ms', '950', '--allow-dev-probe', '--dry-run'])
  assert.equal(parsed.site, 'wangcheng_mall')
  assert.equal(parsed.holdMs, 950)
  assert.equal(parsed.allowDevProbe, true)
  assert.equal(parsed.dryRun, true)

  const vOut = JSON.parse(
    execFileSync(process.execPath, [join(__dirname, 'verify-mixue-phase2.mjs'), '--dry-run'], { encoding: 'utf8' }),
  )
  assert.equal(vOut.ok, true)
  assert.equal(vOut.dryRun, true)
  assert.equal(vOut.site.id, 'wangcheng_mall')

  const sOut = JSON.parse(
    execFileSync(
      process.execPath,
      [
        join(__dirname, 'sync-multica-pr.mjs'),
        '--pr',
        'https://github.com/idoknow/guilinol/pull/999',
        '--status',
        'done',
        '--dry-run',
      ],
      { encoding: 'utf8' },
    ),
  )
  assert.equal(sOut.ok, true)
  assert.equal(sOut.count, 6)
  assert.equal(sOut.actions[0].targetStatus, 'done')
})
