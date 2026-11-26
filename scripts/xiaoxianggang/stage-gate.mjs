#!/usr/bin/env node
/**
 * 小香港 A 线 Multica 阶段阻塞门禁与 PR 回填工具：
 * - 强制执行 Stage 0 (IDOK-362) -> Stage 1 (IDOK-363) -> Stage 2 (IDOK-364) 阻塞链；
 * - 任何前置 stage 未 done 时拒绝解锁/推进下游 stage，防止重复蜜雪无序抢跑教训。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const TICKETS_FILE = join(__dirname, 'multica-tickets.json')
const ALLOWED_PR_STATUSES = new Set(['', 'in_review', 'done'])

export function loadXxgLedger(filePath = TICKETS_FILE) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

/**
 * 校验目标 stage（0/1/2）是否允许解锁开工。
 */
export function validateStageUnlock(ledger, targetStage) {
  const stageObj = ledger?.stages?.find(s => s.stage === targetStage)
  if (!stageObj) {
    return { ok: false, reason: `UNKNOWN_STAGE:${targetStage}`, blockers: [] }
  }
  const byKey = new Map(ledger.stages.map(s => [s.key, s]))
  const blockers = []
  for (const prev of ledger.stages) {
    if (prev.stage < targetStage && prev.status !== 'done') {
      blockers.push(`${prev.key}(stage=${prev.stage},status=${prev.status})`)
    }
  }
  for (const depKey of stageObj.blockedBy ?? []) {
    const dep = byKey.get(depKey)
    if (!dep || dep.status !== 'done') {
      const desc = dep ? `${dep.key}(stage=${dep.stage},status=${dep.status})` : `${depKey}(missing)`
      if (!blockers.includes(desc)) blockers.push(desc)
    }
  }
  if (blockers.length > 0) {
    return {
      ok: false,
      reason: `BLOCKED_BY_UPSTREAM:${blockers.join(',')}`,
      blockers,
      target: stageObj,
    }
  }
  return { ok: true, blockers: [], target: stageObj }
}

export function buildMulticaPrSync(ledger, prUrl, note = '', targetStatus = '') {
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(String(prUrl || ''))) {
    throw new Error(`Invalid GitHub PR URL: ${prUrl}`)
  }
  if (!ALLOWED_PR_STATUSES.has(targetStatus)) {
    throw new Error(`Unsupported targetStatus: ${targetStatus}`)
  }
  const suffix = note ? `\n${note}` : ''
  const actions = [
    {
      key: ledger.epic.key,
      targetStatus: targetStatus || null,
      comment: `【小香港A线 PR 回填】${prUrl}（覆盖子单 ${ledger.stages.map(s => s.key).join(' / ')}）${suffix}`,
    },
  ]
  for (const s of ledger.stages) {
    actions.push({
      key: s.key,
      targetStatus: targetStatus || null,
      comment: `【小香港A线 Stage ${s.stage} PR 回填】${prUrl}${suffix}`,
    })
  }
  return actions
}

export function parseGateArgs(argv) {
  const flags = { checkUnlock: null, advance: null, complete: null, pr: '', status: '', note: '', dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check-unlock') flags.checkUnlock = Number(argv[++i])
    else if (a === '--advance') flags.advance = Number(argv[++i])
    else if (a === '--complete') flags.complete = Number(argv[++i])
    else if (a === '--pr') flags.pr = String(argv[++i] || '')
    else if (a === '--status') flags.status = String(argv[++i] || '')
    else if (a === '--note') flags.note = String(argv[++i] || '')
    else if (a === '--dry-run') flags.dryRun = true
  }
  return flags
}

function runMultica(args) {
  const env = {
    ...process.env,
    PATH: `/opt/homebrew/bin:${process.env.HOME || ''}/.local/bin:/usr/local/bin:${process.env.PATH || ''}`,
  }
  return execFileSync('multica', ['--profile', 'idoknow', ...args], { env, encoding: 'utf8' })
}

function main() {
  const flags = parseGateArgs(process.argv.slice(2))
  const ledger = loadXxgLedger()

  if (Number.isInteger(flags.checkUnlock)) {
    const res = validateStageUnlock(ledger, flags.checkUnlock)
    console.log(JSON.stringify(res, null, 2))
    if (!res.ok) process.exit(2)
    return
  }

  if (Number.isInteger(flags.advance)) {
    const res = validateStageUnlock(ledger, flags.advance)
    if (!res.ok) {
      console.error(JSON.stringify(res, null, 2))
      process.exit(1)
    }
    if (!flags.dryRun) {
      runMultica(['issue', 'status', res.target.key, 'in_progress', '--no-start'])
      res.target.status = 'in_progress'
      writeFileSync(TICKETS_FILE, JSON.stringify(ledger, null, 2) + '\n')
    }
    console.log(JSON.stringify({ ok: true, dryRun: flags.dryRun, action: 'advance', key: res.target.key, stage: flags.advance }))
    return
  }

  if (Number.isInteger(flags.complete)) {
    const target = ledger.stages.find(s => s.stage === flags.complete)
    if (!target) throw new Error(`Unknown stage: ${flags.complete}`)
    if (!flags.dryRun) {
      if (flags.note) runMultica(['issue', 'comment', 'add', target.key, '--content', flags.note])
      runMultica(['issue', 'status', target.key, 'done', '--no-start'])
      target.status = 'done'
      writeFileSync(TICKETS_FILE, JSON.stringify(ledger, null, 2) + '\n')
    }
    console.log(JSON.stringify({ ok: true, dryRun: flags.dryRun, action: 'complete', key: target.key, stage: flags.complete }))
    return
  }

  if (flags.pr) {
    const actions = buildMulticaPrSync(ledger, flags.pr, flags.note, flags.status)
    if (!flags.dryRun) {
      for (const act of actions) {
        runMultica(['issue', 'comment', 'add', act.key, '--content', act.comment])
        if (act.targetStatus) runMultica(['issue', 'status', act.key, act.targetStatus, '--no-start'])
      }
      ledger.epic.prUrl = flags.pr
      if (flags.status) ledger.epic.status = flags.status
      for (const s of ledger.stages) {
        s.prUrl = flags.pr
        if (flags.status) s.status = flags.status
      }
      writeFileSync(TICKETS_FILE, JSON.stringify(ledger, null, 2) + '\n')
    }
    console.log(JSON.stringify({ ok: true, dryRun: flags.dryRun, action: 'pr-sync', count: actions.length, actions }, null, 2))
    return
  }

  console.log('Usage: stage-gate.mjs [--check-unlock <0-2>] [--advance <0-2>] [--complete <0-2> --note <msg>] [--pr <url> --status <in_review|done>] [--dry-run]')
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntry) main()
