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
  evaluatePhase2Checks,
  parseVerifyArgs,
} from './verify-mixue-phase2.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('multica-tickets ledger 包含父单与 5 张有序分期子单且负责人/验收项齐全', () => {
  const ledger = loadTicketLedger()
  assert.match(ledger.epic.key, /^IDOK-\d+$/)
  assert.ok(ledger.epic.id.length > 10)
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

test('buildPrBackfillActions 覆盖父单及全部 5 张子单并校验 PR URL 格式', () => {
  const ledger = loadTicketLedger()
  assert.throws(() => buildPrBackfillActions(ledger, 'not-a-pr-url'))
  const actions = buildPrBackfillActions(ledger, 'https://github.com/idoknow/guilinol/pull/999', '门禁全绿')
  assert.equal(actions.length, 6)
  assert.equal(actions[0].key, 'IDOK-312')
  assert.deepEqual(
    actions.slice(1).map(a => a.key),
    ['IDOK-313', 'IDOK-314', 'IDOK-315', 'IDOK-316', 'IDOK-317'],
  )
})

test('evaluatePhase2Checks 精确识别 k50 全部硬指标（自动第一人称/招聘牌/能量条/draw calls）', () => {
  const pass = evaluatePhase2Checks({
    errors: [],
    shopDrawCalls: 24,
    autoFirstPerson: { enteredFirstPerson: true },
    recruitSign: { visible: true, interactive: true },
    holdEnergy: { beforeFill: 1, afterFill: 0.72, energyBarMoved: true, stoppedAfterRelease: true },
  })
  assert.equal(pass.ok, true)
  assert.deepEqual(pass.failures, [])

  const fail = evaluatePhase2Checks({
    errors: ['pageerror: boom'],
    shopDrawCalls: 42,
    autoFirstPerson: { enteredFirstPerson: false },
    recruitSign: { visible: false, interactive: false },
    holdEnergy: { beforeFill: 1, afterFill: 1, energyBarMoved: false, stoppedAfterRelease: false },
  })
  assert.equal(fail.ok, false)
  assert.equal(fail.failures.length, 8)
})

test('verify-mixue-phase2 与 sync-multica-pr CLI --dry-run 退出码均为 0', () => {
  const parsed = parseVerifyArgs(['--site', 'wangcheng_mall', '--hold-ms', '900', '--dry-run'])
  assert.equal(parsed.site, 'wangcheng_mall')
  assert.equal(parsed.holdMs, 900)
  assert.equal(parsed.dryRun, true)

  const vOut = JSON.parse(
    execFileSync(process.execPath, [join(__dirname, 'verify-mixue-phase2.mjs'), '--dry-run'], { encoding: 'utf8' }),
  )
  assert.equal(vOut.ok, true)
  assert.equal(vOut.dryRun, true)

  const sOut = JSON.parse(
    execFileSync(
      process.execPath,
      [join(__dirname, 'sync-multica-pr.mjs'), '--pr', 'https://github.com/idoknow/guilinol/pull/999', '--dry-run'],
      { encoding: 'utf8' },
    ),
  )
  assert.equal(sOut.ok, true)
  assert.equal(sOut.count, 6)
})
