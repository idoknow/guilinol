#!/usr/bin/env node
/**
 * 蜜雪二期 Multica 逐张推进、状态同步与 PR 链接回填工具（对应 k71）：
 * - --advance <stage>：校验前序 stage 已 done 后，把目标 stage 置 in_progress（严禁跳 stage）
 * - --complete <stage> --note <text>：将指定 stage 置 done 并记录验收说明
 * - --pr <prUrl> [--status <in_review|done>] [--note <text>]：
 *     将 PR 链接回填到父单 IDOK-312 与 5 张子单（可选同步推进各单状态），并写回 multica-tickets.json
 * - --dry-run：仅打印计划操作，不改 Multica 或磁盘
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const TICKETS_FILE = join(__dirname, 'multica-tickets.json')
const ALLOWED_PR_STATUSES = new Set(['', 'in_review', 'done'])

export function loadTicketLedger(filePath = TICKETS_FILE) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

export function validateSequentialAdvance(ledger, targetStage) {
  const sub = ledger.subIssues.find(s => s.stage === targetStage)
  if (!sub) return { ok: false, reason: `UNKNOWN_STAGE:${targetStage}` }
  for (const prev of ledger.subIssues) {
    if (prev.stage < targetStage && prev.status !== 'done') {
      return { ok: false, reason: `PREVIOUS_STAGE_NOT_DONE:${prev.key}(stage=${prev.stage},status=${prev.status})` }
    }
  }
  return { ok: true, target: sub }
}

export function buildPrBackfillActions(ledger, prUrl, note = '', targetStatus = '') {
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
      comment: `【蜜雪二期总 PR 回填】${prUrl}（覆盖子单 ${ledger.subIssues.map(s => s.key).join(' / ')}）${suffix}`,
    },
  ]
  for (const s of ledger.subIssues) {
    actions.push({
      key: s.key,
      targetStatus: targetStatus || null,
      comment: `【蜜雪二期 PR 回填】Stage ${s.stage}（${s.owner}）已随总 PR 合流：${prUrl}${suffix}`,
    })
  }
  return actions
}

function runMultica(args) {
  const env = {
    ...process.env,
    PATH: `/opt/homebrew/bin:${process.env.HOME || ''}/.local/bin:/usr/local/bin:${process.env.PATH || ''}`,
  }
  return execFileSync('multica', ['--profile', 'idoknow', ...args], { env, encoding: 'utf8' })
}

export function parseSyncArgs(argv) {
  const flags = { pr: '', status: '', advance: 0, complete: 0, note: '', dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--pr') flags.pr = String(argv[++i] || '')
    else if (a === '--status') flags.status = String(argv[++i] || '')
    else if (a === '--advance') flags.advance = Number(argv[++i]) || 0
    else if (a === '--complete') flags.complete = Number(argv[++i]) || 0
    else if (a === '--note') flags.note = String(argv[++i] || '')
    else if (a === '--dry-run') flags.dryRun = true
  }
  return flags
}

function main() {
  const flags = parseSyncArgs(process.argv.slice(2))
  const ledger = loadTicketLedger()

  if (flags.advance) {
    const check = validateSequentialAdvance(ledger, flags.advance)
    if (!check.ok) {
      console.error(JSON.stringify(check))
      process.exit(1)
    }
    if (!flags.dryRun) {
      runMultica(['issue', 'status', check.target.key, 'in_progress', '--no-start'])
      check.target.status = 'in_progress'
      writeFileSync(TICKETS_FILE, JSON.stringify(ledger, null, 2) + '\n')
    }
    console.log(JSON.stringify({ ok: true, dryRun: flags.dryRun, action: 'advance', key: check.target.key, stage: flags.advance }))
    return
  }

  if (flags.complete) {
    const target = ledger.subIssues.find(s => s.stage === flags.complete)
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
    const actions = buildPrBackfillActions(ledger, flags.pr, flags.note, flags.status)
    if (!flags.dryRun) {
      for (const act of actions) {
        runMultica(['issue', 'comment', 'add', act.key, '--content', act.comment])
        if (act.targetStatus) {
          runMultica(['issue', 'status', act.key, act.targetStatus, '--no-start'])
        }
      }
      ledger.epic.prUrl = flags.pr
      if (flags.status) ledger.epic.status = flags.status
      for (const s of ledger.subIssues) {
        s.prUrl = flags.pr
        if (flags.status) s.status = flags.status
      }
      writeFileSync(TICKETS_FILE, JSON.stringify(ledger, null, 2) + '\n')
    }
    console.log(JSON.stringify({ ok: true, dryRun: flags.dryRun, action: 'pr-backfill', count: actions.length, actions }, null, 2))
    return
  }

  console.log('Usage: sync-multica-pr.mjs [--advance <1-5>] [--complete <1-5> --note <msg>] [--pr <url> --status <in_review|done>] [--dry-run]')
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntry) main()
