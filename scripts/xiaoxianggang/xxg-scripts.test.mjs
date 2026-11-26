import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildMulticaPrSync,
  loadXxgLedger,
  validateStageUnlock,
} from './stage-gate.mjs'
import {
  auditXxgProdProbe,
  buildPreviewArgs,
  DEFAULT_FRAME,
  evaluateXxgChecks,
  indoorToWorld,
  loadPortalCatalog,
  measureSeam,
  normalizePortalId,
  parseVerifyArgs,
  SURFACE_PLAZA_Y,
} from './verify-xxg-indoor.mjs'
import { XXG_FIRST_SHOP_SHOTS, XXG_REF_SHOTS, parseShootArgs } from './shoot-xxg-refs.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('multica-tickets 账本包含父单 IDOK-361、Stage 0/1/2 阻塞链与 IDOK-324/301 复用评论 ID', () => {
  const ledger = loadXxgLedger()
  assert.equal(ledger.route, 'A')
  assert.equal(ledger.branch, 'feat/xiaoxianggang-indoor')
  assert.equal(ledger.epic.key, 'IDOK-361')
  assert.equal(ledger.reuseAuditCommentId, '01a2125a-e7ee-7a61-baca-cdab0b93bae9')
  assert.deepEqual(
    ledger.stages.map(s => [s.stage, s.multicaBarrier, s.key, s.status]),
    [
      [0, 1, 'IDOK-362', 'done'],
      [1, 2, 'IDOK-363', 'in_progress'],
      [2, 3, 'IDOK-364', 'blocked'],
    ],
  )
  assert.deepEqual(ledger.stages[1].blockedBy, ['IDOK-362'])
  assert.deepEqual(ledger.stages[2].blockedBy, ['IDOK-363'])
})

test('validateStageUnlock 严格阻断 Stage 2 抢跑，仅在 Stage 1 done 后放行', () => {
  const ledger = loadXxgLedger()
  const s1 = validateStageUnlock(ledger, 1)
  assert.equal(s1.ok, true)
  assert.equal(s1.target.key, 'IDOK-363')

  const s2Blocked = validateStageUnlock(ledger, 2)
  assert.equal(s2Blocked.ok, false)
  assert.match(s2Blocked.reason, /BLOCKED_BY_UPSTREAM:IDOK-363/)

  ledger.stages[1].status = 'done'
  const s2Open = validateStageUnlock(ledger, 2)
  assert.equal(s2Open.ok, true)
  assert.equal(s2Open.target.key, 'IDOK-364')

  const bad = validateStageUnlock(ledger, 9)
  assert.equal(bad.ok, false)
  assert.equal(bad.reason, 'UNKNOWN_STAGE:9')
})

test('buildMulticaPrSync 校验 PR URL 并覆盖父单及 Stage 0/1/2 共 4 张工单', () => {
  const ledger = loadXxgLedger()
  assert.throws(() => buildMulticaPrSync(ledger, 'http://bad-url'))
  assert.throws(() => buildMulticaPrSync(ledger, 'https://github.com/idoknow/guilinol/pull/400', '', 'bogus'))
  const actions = buildMulticaPrSync(ledger, 'https://github.com/idoknow/guilinol/pull/400', 'Stage 1 验收通过', 'done')
  assert.equal(actions.length, 4)
  assert.deepEqual(
    actions.map(a => a.key),
    ['IDOK-361', 'IDOK-362', 'IDOK-363', 'IDOK-364'],
  )
})

test('buildPreviewArgs 强制携带 web --config web/vite.config.ts 且严禁使用 4190 端口', () => {
  const args = buildPreviewArgs('/Users/pan-work/guilinol-xxg/dist', 4195)
  assert.deepEqual(args.slice(0, 6), ['--no-install', 'vite', 'preview', 'web', '--config', 'web/vite.config.ts'])
  assert.ok(args.includes('--outDir'))
  assert.ok(args.includes('/Users/pan-work/guilinol-xxg/dist'))
  assert.ok(args.includes('4195'))
  assert.throws(() => buildPreviewArgs('/tmp/dist', 4190))
  assert.throws(() => buildPreviewArgs('/tmp/dist', 0))
})

test('loadPortalCatalog 直接解析冻结版 contract.ts 的 portal(E1..W2) 调用且坐标与 contract.md 逐项一致', () => {
  const cat = loadPortalCatalog()
  assert.equal(cat.source, 'contract.ts')
  assert.deepEqual(cat.portals.map(p => p.id), ['E1', 'E2', 'W1', 'W2'])

  const expected = {
    E1: { wx: -874.805, wz: 249.245, lx: -880.247, lz: 247.238 },
    E2: { wx: -856.467, wz: 199.531, lx: -851.025, lz: 201.538 },
    W1: { wx: -924.911, wz: 223.303, lx: -930.353, lz: 221.296 },
    W2: { wx: -911.417, wz: 186.721, lx: -916.859, lz: 184.714 },
  }
  for (const p of cat.portals) {
    const exp = expected[p.id]
    assert.ok(Math.abs(p.worldY - SURFACE_PLAZA_Y) < 0.001)
    assert.ok(Math.abs(p.worldX - exp.wx) <= 0.002, `${p.id} worldX ${p.worldX} vs ${exp.wx}`)
    assert.ok(Math.abs(p.worldZ - exp.wz) <= 0.002, `${p.id} worldZ ${p.worldZ} vs ${exp.wz}`)
    assert.ok(Math.abs(p.landing.x - exp.lx) <= 0.002, `${p.id} landing.x ${p.landing.x} vs ${exp.lx}`)
    assert.ok(Math.abs(p.landing.z - exp.lz) <= 0.002, `${p.id} landing.z ${p.landing.z} vs ${exp.lz}`)
  }

  const fakeRoot = join(tmpdir(), `xxg-contract-test-${Date.now()}`)
  mkdirSync(join(fakeRoot, 'web/src/xiaoxianggang'), { recursive: true })
  try {
    const fallback = loadPortalCatalog(fakeRoot)
    assert.equal(fallback.source, 'stage0-default')
    assert.deepEqual(fallback.portals.map(p => p.id), ['E1', 'E2', 'W1', 'W2'])

    writeFileSync(
      join(fakeRoot, 'web/src/xiaoxianggang/contract.ts'),
      `export const PORTALS = [
        { id: 'E1', label: '东一', worldX: -874.8, worldY: 153.868, worldZ: 249.25, approachYaw: 0 },
        { id: 'E2', label: '东二', worldX: -856.47, worldY: 153.868, worldZ: 199.53, approachYaw: 0 },
        { id: 'W1', label: '西一', worldX: -924.91, worldY: 153.868, worldZ: 223.3, approachYaw: 3.14 },
        { id: 'W2', label: '西二', worldX: -911.42, worldY: 153.868, worldZ: 186.72, approachYaw: 3.14 },
      ]\n`,
    )
    const parsed = loadPortalCatalog(fakeRoot)
    assert.equal(parsed.source, 'contract.ts')
    assert.deepEqual(parsed.portals.map(p => p.id), ['E1', 'E2', 'W1', 'W2'])
  } finally {
    rmSync(fakeRoot, { recursive: true, force: true })
  }
})

test('auditXxgProdProbe 与 evaluateXxgChecks 精确检出 Stage 1 全部性能/转场/碰撞/泄漏违规', () => {
  const cleanProbe = auditXxgProdProbe({ hasXxgProp: false, xxgKeys: [] })
  assert.equal(cleanProbe.clean, true)

  const dirtyProbe = auditXxgProdProbe({ hasXxgProp: true, xxgKeys: ['forceEnter', 'teleportIndoor'] })
  assert.equal(dirtyProbe.clean, false)
  assert.deepEqual(dirtyProbe.leakedKeys, ['viewer.xxg.forceEnter', 'viewer.xxg.teleportIndoor'])

  const pass = evaluateXxgChecks({
    errors: [],
    surface: { y: 153.868, expectedY: 153.868 },
    enter: { enteredIndoor: true, transitionMs: 240, blackFrameDetected: false },
    indoor: { autoFirstPerson: true, drawCalls: 28, collisionHeld: true },
    exit: { returnedToSurface: true, returnDistM: 0.45, viewRestored: true },
    repeatCycles: { completed: 2, residualNodes: 0, residualDom: 0 },
    prodProbeAudit: { enforce: true, leakedKeys: [] },
  })
  assert.equal(pass.ok, true)
  assert.deepEqual(pass.failures, [])

  const fail = evaluateXxgChecks({
    errors: ['pageerror: crash'],
    surface: { y: 149.2, expectedY: 153.868 },
    enter: { enteredIndoor: false, transitionMs: 520, blackFrameDetected: true },
    indoor: { autoFirstPerson: false, drawCalls: 62, collisionHeld: false },
    exit: { returnedToSurface: false, returnDistM: 9.5, viewRestored: false },
    repeatCycles: { completed: 1, residualNodes: 3, residualDom: 2 },
    prodProbeAudit: { enforce: true, leakedKeys: ['viewer.xxg.forceEnter'] },
  })
  assert.equal(fail.ok, false)
  assert.equal(fail.failures.length, 15)
  assert.ok(fail.failures.some(f => f.startsWith('TRANSITION_TOO_SLOW')))
  assert.ok(fail.failures.some(f => f.startsWith('INDOOR_DRAW_CALLS_EXCEEDED')))
  assert.ok(fail.failures.some(f => f.startsWith('SCENE_NODE_LEAK')))
})

test('measureSeam 与 evaluateXxgChecks：换场那一帧挪动不超过相邻步长才算无缝，瞬移到街面判跳变', () => {
  const b1 = DEFAULT_FRAME.surfaceY - DEFAULT_FRAME.stairDepth
  // Indoor player walking +x (indoor yaw -PI/2 looks along +x) on the landing, then the world walker continues.
  const indoorFrames = [0, 1, 2, 3].map(i => ({ indoor: true, p: { x: -18.6 + 0.08 * i, y: 0, z: 26.5, eyeY: 1.62, yaw: -Math.PI / 2 } }))
  const worldAt = (ix, jump = 0) => {
    const w = indoorToWorld({ x: ix + jump, z: 26.5 })
    const dir = { x: DEFAULT_FRAME.axisE.x, z: DEFAULT_FRAME.axisE.z }
    return { indoor: false, w: { x: w.x, y: b1 + 0.9, z: w.z }, foot: b1, cam: { x: w.x + dir.x * 0.08, y: b1 + 1.62, z: w.z + dir.z * 0.08, fx: dir.x, fz: dir.z } }
  }
  const smooth = [...indoorFrames, ...[4, 5, 6].map(i => worldAt(-18.6 + 0.08 * i))]
  const ok = measureSeam(smooth, false)
  assert.equal(ok.frame, 4)
  assert.ok(Math.abs(ok.stepM - 0.08) < 1e-3, `step ${ok.stepM}`)
  assert.ok(ok.footM < 0.1 && ok.footDy < 1e-3 && ok.eyeM < 0.09 && ok.yawRad < 0.01, JSON.stringify(ok))

  const jumped = [...indoorFrames, ...[4, 5, 6].map(i => worldAt(-18.6 + 0.08 * i, 9))]
  const bad = measureSeam(jumped, false)
  const base = {
    errors: [],
    enter: { enteredIndoor: true, seam: ok },
    indoor: { autoFirstPerson: true },
    exit: { returnedToSurface: true, seam: bad },
    repeatCycles: { completed: 2 },
  }
  assert.deepEqual(evaluateXxgChecks({ ...base, exit: { returnedToSurface: true, seam: ok } }).failures, [])
  const verdict = evaluateXxgChecks(base)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.failures.some(f => f.startsWith('EXIT_SEAM_JUMP(foot')), verdict.failures.join(','))
  assert.ok(evaluateXxgChecks({ ...base, exit: { returnedToSurface: true, seam: null } }).failures.includes('EXIT_SEAM_NOT_RECORDED'))
  assert.equal(measureSeam(indoorFrames, false), null)
})

test('verify-xxg-indoor 与 stage-gate CLI --dry-run 命中 contract.ts(E1..W2) 且预览参数齐全', () => {
  assert.equal(normalizePortalId('XXG_portal_W1'), 'W1')
  const args = parseVerifyArgs(['--portal', 'XXG_portal_W1', '--cycles', '3', '--dry-run'])
  assert.equal(args.portal, 'W1')
  assert.equal(args.cycles, 3)
  assert.equal(args.dryRun, true)

  const vOut = JSON.parse(
    execFileSync(process.execPath, [join(__dirname, 'verify-xxg-indoor.mjs'), '--dry-run'], { encoding: 'utf8' }),
  )
  assert.equal(vOut.ok, true)
  assert.equal(vOut.dryRun, true)
  assert.equal(vOut.portalSource, 'contract.ts')
  assert.deepEqual(vOut.portalIds, ['E1', 'E2', 'W1', 'W2'])
  assert.equal(vOut.portal.id, 'E1')
  assert.equal(vOut.portalCount, 4)
  assert.ok(vOut.previewArgsSample.includes('web'))
  assert.ok(vOut.previewArgsSample.includes('web/vite.config.ts'))

  const s1Out = JSON.parse(
    execFileSync(process.execPath, [join(__dirname, 'stage-gate.mjs'), '--check-unlock', '1'], { encoding: 'utf8' }),
  )
  assert.equal(s1Out.ok, true)

  let blockedCode = 0
  try {
    execFileSync(process.execPath, [join(__dirname, 'stage-gate.mjs'), '--check-unlock', '2'], { encoding: 'utf8' })
  } catch (err) {
    blockedCode = err.status
  }
  assert.equal(blockedCode, 2)
})

test('shoot-xxg-refs 机位覆盖 refs/ 里全部室内实拍（04–20），首批三店各有一张，参数解析带默认值', () => {
  const refsDir = join(__dirname, '../../docs/xiaoxianggang/refs')
  const indoorRefs = readdirSync(refsDir).filter(f => /^(0[4-9]|1\d|20)-.+\.jpg$/.test(f)).sort()
  assert.equal(indoorRefs.length, 17)
  assert.deepEqual(XXG_REF_SHOTS.map(s => s.ref).sort(), indoorRefs)
  for (const s of XXG_REF_SHOTS) {
    assert.ok(existsSync(join(refsDir, s.ref)))
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.yaw))
  }
  const ids = new Set(XXG_FIRST_SHOP_SHOTS.map(s => s.id))
  for (const id of ['shop-apparel', 'shop-accessory', 'shop-snack']) assert.ok(ids.has(id), id)
  assert.deepEqual(parseShootArgs([]), { out: '/tmp/xxg-ref-shots', only: null, width: 540, warmup: 40 })
  const o = parseShootArgs(['--only', '04, 05', '--width', '100', '--warmup', '0'])
  assert.deepEqual(o.only, ['04', '05'])
  assert.equal(o.width, 180)
  assert.equal(o.warmup, 0)
})
