import assert from 'node:assert/strict'
import {readFileSync, rmSync} from 'node:fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {pathToFileURL} from 'node:url'
import {gunzipSync} from 'node:zlib'
import {build} from 'esbuild'

// IDOK-541：解放桥剧情执勤——正面拦车几何 / 逃逸节流 / 「走咯！」气泡文案 / 双向罚款池纯函数 + 实车端到端集成
const bundleDir = await mkdtemp(join(tmpdir(), 'glol-jiefang-escape-test-'))
const bundleFile = join(bundleDir, 'sut.mjs')
process.once('exit', () => {
  try {
    rmSync(bundleDir, {recursive: true, force: true})
  } catch {
    // ignore
  }
})

await build({
  stdin: {
    contents: `
      export * from './web/src/traffic-duty/jiefang-escape.ts'
      export {
        classifyJiefangCrossSectionZone,
        createDutyTraffic,
        estimateJiefangDutyFinePool,
        sampleJiefangViolatorFines,
        JIEFANG_APPROACH_MIN_DIST_M,
        JIEFANG_STORY_OVERRIDE_DESKTOP,
        JIEFANG_STORY_OVERRIDE_MOBILE,
      } from './web/src/traffic/duty-traffic.ts'
      export {
        isOnJiefangBridgeDeck,
        jiefangBridgeLocalToWorld,
        jiefangDeckWorldY,
      } from './web/src/traffic-duty/jiefang-railings.ts'
      export {createTrafficDutyController} from './web/src/traffic-duty/controller.ts'
      export {mountTrafficDutyUi} from './web/src/traffic-duty/ui.ts'
      export {
        ACTIVE_VIOLATIONS,
        ALL_ACTIVE_VIOLATIONS,
        DEFAULT_FINE_YUAN,
        JIEFANG_DUTY_ZONE,
        resolveDutyFineTable,
      } from './web/src/traffic-duty/types.ts'
      export {resolveFineTable} from './web/src/traffic-duty/fine-terminal/engine.ts'
      export {getActorViolations} from './web/src/traffic/sim.ts'
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: bundleFile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  loader: {'.css': 'empty', '.svg': 'empty'},
  logLevel: 'silent',
})

after(async () => {
  await rm(bundleDir, {recursive: true, force: true})
})

if (typeof globalThis.addEventListener !== 'function') globalThis.addEventListener = () => {}
if (typeof globalThis.matchMedia !== 'function') globalThis.matchMedia = () => ({matches: false})

const {
  ACTIVE_VIOLATIONS,
  ALL_ACTIVE_VIOLATIONS,
  DEFAULT_FINE_YUAN,
  ESCAPE_BUBBLE_MAX_DESKTOP,
  ESCAPE_BUBBLE_MAX_MOBILE,
  ESCAPE_SHOUT,
  JIEFANG_APPROACH_MIN_DIST_M,
  JIEFANG_DUTY_ZONE,
  JIEFANG_STORY_OVERRIDE_DESKTOP,
  JIEFANG_STORY_OVERRIDE_MOBILE,
  acknowledgeJiefangStoryMode,
  applyEscapeImpulse,
  checkEscapeThrottle,
  classifyInterceptAspect,
  classifyJiefangCrossSectionZone,
  computeEscapeDodge,
  createDutyTraffic,
  createTrafficDutyController,
  escapeFleeProbability,
  estimateJiefangDutyFinePool,
  formatEscapeVow,
  getActorViolations,
  isJiefangStoryModeActive,
  isOnJiefangBridgeDeck,
  jiefangBridgeLocalToWorld,
  jiefangDeckWorldY,
  markEscapeCause,
  mountTrafficDutyUi,
  peekEscapeMark,
  requestJiefangStoryMode,
  resetJiefangEscapeStateForTests,
  resolveDutyFineTable,
  resolveEscapeBubbleCap,
  resolveFineTable,
  sampleJiefangViolatorFines,
  setEscapeClock,
  subscribeDutyEscape,
  tryEmitDutyEscape,
} = await import(pathToFileURL(bundleFile).href)

const jiefangCellGraph = JSON.parse(gunzipSync(readFileSync('public/world/roads/-1_0.json.gz')).toString('utf8'))

function makeSeededRng(seedStart = 54101) {
  let seed = seedStart >>> 0
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
}

function makeActor(overrides = {}) {
  return {
    id: overrides.id ?? 'a1',
    x: 0,
    y: 151.85,
    z: 0,
    yaw: Math.PI / 2,
    speed: 5,
    dodge: 0,
    kind: 'scooter',
    track: {dx: 1, dz: 0, gradeSeparated: 'jiefang'},
    violations: ['no_helmet'],
    ...overrides,
  }
}

test('IDOK-541 fine pool: north + south theoretical pool exceeds ¥5000 (desktop 2min / mobile 3min)', () => {
  const desktop = estimateJiefangDutyFinePool({durationSec: 120, profile: 'desktop'})
  const mobile = estimateJiefangDutyFinePool({durationSec: 180, profile: 'mobile'})
  assert.ok(desktop.northYuan + desktop.southYuan > 5000, `desktop 2min pool ${desktop.totalYuan}`)
  assert.ok(mobile.northYuan + mobile.southYuan > 5000, `mobile 3min pool ${mobile.totalYuan}`)
  assert.equal(desktop.totalYuan, desktop.northYuan + desktop.southYuan)
  assert.ok(desktop.northYuan > 0 && desktop.southYuan > 0, 'both directions must contribute')
})

test('IDOK-541 fine pool: 10min desktop each side > ¥10k; deterministic for the same seed', () => {
  const a = estimateJiefangDutyFinePool({durationSec: 600, profile: 'desktop', seed: 541})
  const b = estimateJiefangDutyFinePool({durationSec: 600, profile: 'desktop', seed: 541})
  assert.ok(a.northYuan > 10000, `north ${a.northYuan}`)
  assert.ok(a.southYuan > 10000, `south ${a.southYuan}`)
  assert.ok(a.totalYuan > 20000, `total ${a.totalYuan}`)
  assert.deepEqual(a, b)
  const m = estimateJiefangDutyFinePool({durationSec: 600, profile: 'mobile'})
  assert.ok(m.totalYuan > 15000, `mobile 10min ${m.totalYuan}`)
  assert.ok(m.totalYuan < a.totalYuan, 'mobile preset is lighter than desktop')
})

test('IDOK-541 fine pool: mean fine per violator and multi-violation stack rate in target band', () => {
  const s = sampleJiefangViolatorFines({profile: 'desktop', samples: 20000, seed: 541})
  assert.ok(s.meanFinePerViolatorYuan >= 104 && s.meanFinePerViolatorYuan <= 125, `mean ${s.meanFinePerViolatorYuan}`)
  assert.ok(s.violatorShare > 0.75, `violator share ${s.violatorShare}`)
  assert.ok(s.multiViolationShare > 0.5, `multi share ${s.multiViolationShare}`)
  assert.ok(JIEFANG_STORY_OVERRIDE_DESKTOP.multiViolationStackRate >= 0.78)
  assert.ok(JIEFANG_STORY_OVERRIDE_DESKTOP.multiViolationStackRate <= 0.82)
  assert.equal(JIEFANG_STORY_OVERRIDE_MOBILE.multiViolationStackRate, JIEFANG_STORY_OVERRIDE_DESKTOP.multiViolationStackRate)
})

test('IDOK-541 fine table: sidewalk_riding follows wrong_way; ACTIVE_VIOLATIONS stays 6 items', () => {
  assert.equal(DEFAULT_FINE_YUAN.sidewalk_riding, DEFAULT_FINE_YUAN.wrong_way)
  assert.equal(DEFAULT_FINE_YUAN.sidewalk_riding, 50)
  assert.equal(resolveDutyFineTable({wrong_way: 80}).sidewalk_riding, 80)
  assert.equal(resolveDutyFineTable({wrong_way: 80, sidewalk_riding: 30}).sidewalk_riding, 30)
  assert.deepEqual(resolveFineTable({wrong_way: 80}), resolveDutyFineTable({wrong_way: 80}))
  assert.equal(ACTIVE_VIOLATIONS.length, 6)
  assert.equal(ALL_ACTIVE_VIOLATIONS.length, 7)
  assert.equal(ALL_ACTIVE_VIOLATIONS.includes('sidewalk_riding'), true)
})

test('IDOK-541 intercept geometry: front / side / rear, wrongWay flips heading', () => {
  const actor = makeActor()
  assert.equal(classifyInterceptAspect(actor, {x: 5, z: 0}), 'front')
  assert.equal(classifyInterceptAspect(actor, {x: 5, z: 2}), 'front')
  assert.equal(classifyInterceptAspect(actor, {x: 0.2, z: 3}), 'side')
  assert.equal(classifyInterceptAspect(actor, {x: -5, z: 0}), 'rear')
  const wrong = makeActor({wrongWay: true})
  assert.equal(classifyInterceptAspect(wrong, {x: -5, z: 0}), 'front')
  assert.equal(classifyInterceptAspect(wrong, {x: 5, z: 0}), 'rear')
  assert.equal(escapeFleeProbability('front'), 0)
  assert.equal(escapeFleeProbability('side'), 0.8)
  assert.equal(escapeFleeProbability('rear'), 0.85)
})

test('IDOK-541 escape dodge: computed in track frame so wrongWay riders also veer away from officer', () => {
  const officer = {x: 0, z: 2}
  const normal = makeActor()
  const wrong = makeActor({wrongWay: true})
  const dn = computeEscapeDodge(normal, officer)
  const dw = computeEscapeDodge(wrong, officer)
  assert.equal(dn, dw, 'lane normal is independent of wrongWay')
  assert.ok(dn < 0, 'officer on +n side → dodge toward −n')
  assert.ok(computeEscapeDodge(normal, officer, -0.5) >= -0.6 - 1e-9, 'Jiefang clamp ±0.6m')
  const street = makeActor({track: {dx: 1, dz: 0, gradeSeparated: 'street'}})
  assert.ok(Math.abs(computeEscapeDodge(street, officer, -0.8) + 0.85) < 1e-9, 'non-Jiefang clamp ±0.85m')

  const fleeing = makeActor({dutyState: 'pulling_over', haltedByDuty: true, stoppedUntil: 9})
  applyEscapeImpulse(fleeing, {simTime: 10, officer})
  assert.equal(fleeing.dutyState, 'fleeing')
  assert.equal(fleeing.haltedByDuty, false)
  assert.equal(fleeing.stoppedUntil, undefined)
  assert.ok(fleeing.fleeUntil > 10)
  assert.ok(fleeing.dodge < 0)
})

test('IDOK-541 escape bus: 6s per-actor cooldown, 0.3s global throttle, listener receives vow', () => {
  resetJiefangEscapeStateForTests()
  let now = 100
  setEscapeClock(() => now)
  const events = []
  const off = subscribeDutyEscape(ev => events.push(ev))
  try {
    const a1 = makeActor({id: 'a1', violations: ['no_helmet', 'sidewalk_riding']})
    const a2 = makeActor({id: 'a2', violations: ['wrong_way']})
    assert.equal(tryEmitDutyEscape({actor: a1, cause: 'flag', aspect: 'side'}).verdict, 'ok')
    now = 100.1
    assert.equal(tryEmitDutyEscape({actor: a2, cause: 'whistle', aspect: 'rear'}).verdict, 'global_throttle')
    now = 100.4
    assert.equal(tryEmitDutyEscape({actor: a2, cause: 'whistle', aspect: 'rear'}).verdict, 'ok')
    now = 102
    assert.equal(checkEscapeThrottle(a1, now), 'actor_cooldown')
    now = 106.2
    assert.equal(checkEscapeThrottle(a1, now), 'ok')
    assert.equal(events.length, 2)
    assert.equal(events[0].shout, ESCAPE_SHOUT)
    assert.equal(events[0].vow, '下次一定戴头盔，也不走人行道！')
    assert.equal(events[1].vow, '下次一定不逆行！')

    markEscapeCause(a1, 'intercept', 'rear')
    assert.deepEqual(peekEscapeMark(a1), {cause: 'intercept', aspect: 'rear'})
    now = 110
    assert.equal(peekEscapeMark(a1), null, 'mark expires after retry window')
  } finally {
    off()
    setEscapeClock(null)
    resetJiefangEscapeStateForTests()
  }
})

test('IDOK-541 escape vow copy and bubble caps', () => {
  assert.equal(formatEscapeVow(['no_helmet']), '下次一定戴头盔！')
  assert.equal(formatEscapeVow(['sidewalk_riding']), '下次一定不走人行道！')
  assert.equal(formatEscapeVow(['no_helmet', 'sidewalk_riding']), '下次一定戴头盔，也不走人行道！')
  assert.match(formatEscapeVow(['no_helmet', 'wrong_way', 'illegal_mod']), /……都改！$/)
  assert.equal(formatEscapeVow([]), '下次一定好好骑！')
  for (const s of [formatEscapeVow(['ebike_overload', 'bike_double', 'red_light_run']), ESCAPE_SHOUT]) {
    assert.equal(/\p{Extended_Pictographic}/u.test(s), false, 'no emoji in bubble copy')
  }
  assert.equal(resolveEscapeBubbleCap(false), ESCAPE_BUBBLE_MAX_DESKTOP)
  assert.equal(resolveEscapeBubbleCap(true), ESCAPE_BUBBLE_MAX_MOBILE)
  assert.equal(ESCAPE_BUBBLE_MAX_DESKTOP, 3)
  assert.equal(ESCAPE_BUBBLE_MAX_MOBILE, 2)
})

test('IDOK-541 story-mode handshake: enforcement requires request + duty-traffic acknowledgement', () => {
  resetJiefangEscapeStateForTests()
  try {
    assert.equal(isJiefangStoryModeActive(), false)
    requestJiefangStoryMode(true)
    assert.equal(isJiefangStoryModeActive(), false, 'mock bridges never acknowledge → stays off')
    acknowledgeJiefangStoryMode(true)
    assert.equal(isJiefangStoryModeActive(), true)
    requestJiefangStoryMode(false)
    assert.equal(isJiefangStoryModeActive(), false)
    acknowledgeJiefangStoryMode(true)
    assert.equal(isJiefangStoryModeActive(), false, 'ack without request is ignored')
  } finally {
    resetJiefangEscapeStateForTests()
  }
})

test('IDOK-541 LIVE-1: real Jiefang Bridge story-duty 600s sim achieves >¥5000 bidirectional fine pool, sidewalk_riding on deck, and k62 hidden lifecycle', async () => {
  resetJiefangEscapeStateForTests()
  let simClock = 10
  setEscapeClock(() => simClock)

  const dutyTraffic = createDutyTraffic({
    graph: jiefangCellGraph,
    random: makeSeededRng(54101),
  })
  const [ox, oz] = jiefangBridgeLocalToWorld(-97.5, 18.0)
  const officerPos = {x: ox, y: jiefangDeckWorldY(ox, oz), z: oz}

  const controller = createTrafficDutyController(
    {
      getPlayerPos: () => officerPos,
      getPlayerYaw: () => 0,
      isWalking: () => true,
      trafficBridge: {
        start: () => dutyTraffic.start(),
        stop: () => dutyTraffic.stop(),
        getTraffic: () => dutyTraffic.getTraffic(),
        getActors: () => dutyTraffic.getActors(),
        notifyViolatorCited: a => dutyTraffic.notifyViolatorCited(a),
        commandHalt: (orig, opts) => dutyTraffic.commandHalt(orig, opts),
        onViolatorPulledOver: (a, sec) => dutyTraffic.onViolatorPulledOver(a, sec),
        onTicketReceived: (a, rec) => dutyTraffic.onTicketReceived(a, rec),
        getActorHandBone: (a, side) => dutyTraffic.getActorHandBone(a, side),
        releaseViolator: a => dutyTraffic.releaseViolator(a),
      },
      fineTerminal: {
        openFineTerminal: req => ({issued: true, fineYuan: req.fineYuan, violations: req.violations, ticketId: 'TKT-LIVE'}),
      },
    },
    {mountDom: false},
  )

  try {
    // Complete Jiefang briefing -> enters active duty & requests story mode BEFORE pre-roll
    assert.equal(controller.startOfficerBriefing('briefing_intro'), true)
    assert.equal(controller.advanceStory(), true)
    assert.equal(controller.advanceStory(), true)
    assert.equal(controller.chooseStoryOption('ready_now'), true)
    assert.equal(controller.advanceStory(), true)
    await dutyTraffic.start()

    assert.equal(controller.getSnapshot().phase, 'active')
    assert.equal(isJiefangStoryModeActive(), true, 'real Jiefang bridge duty must handshake story mode active')
    assert.equal(dutyTraffic.getStats().jiefangStoryMode, true)

    // Verify immediate bridge-deck continuity right after pre-roll (zero empty wave desert on deck)
    const initialOnDeck = dutyTraffic.getActors().filter(a => a.kind === 'scooter' && !a.leaving && !a.pendingRecycle && isOnJiefangBridgeDeck(a))
    assert.ok(initialOnDeck.length >= 8, `expected >= 8 scooters already on bridge deck at duty start, got ${initialOnDeck.length}`)

    let sawSidewalkOnDeck = 0
    let poolAt180s = 0
    for (let tick = 1; tick <= 6000; tick++) {
      // 6000 * 0.1s = 600s full shift (dutyTraffic steps in 0.05s substeps)
      simClock += 0.1
      dutyTraffic.step(0.1, officerPos, {officerActive: true})
      if (tick === 1800) {
        poolAt180s = dutyTraffic.getStats().finePool.totalYuan
      }
      if (tick % 40 === 0) {
        for (const a of dutyTraffic.getActors()) {
          if (a.kind !== 'scooter' || a.leaving || a.pendingRecycle) continue
          const viols = getActorViolations(a)
          if (viols.includes('sidewalk_riding') && isOnJiefangBridgeDeck(a)) {
            sawSidewalkOnDeck++
            assert.equal(
              classifyJiefangCrossSectionZone(a),
              'sidewalk',
              'sidewalk_riding violator on deck must travel inside sidewalk band without clipping',
            )
          }
        }
      }
    }

    const stats = dutyTraffic.getStats()
    const life = dutyTraffic.getLifecycleStats()
    assert.ok(poolAt180s > 5000, `expected >¥5000 bidirectional fine pool by 3min, got ¥${poolAt180s}`)
    assert.ok(stats.finePool.northYuan > 5000, `expected north side 10min fine pool >¥5000, got ¥${stats.finePool.northYuan}`)
    assert.ok(stats.finePool.southYuan > 5000, `expected south side 10min fine pool >¥5000, got ¥${stats.finePool.southYuan}`)
    assert.ok(stats.finePool.totalYuan > 12000, `expected 10min total bidirectional fine pool >¥12000, got ¥${stats.finePool.totalYuan}`)
    assert.ok(sawSidewalkOnDeck >= 10, `expected sidewalk_riding violators on bridge deck, saw ${sawSidewalkOnDeck}`)
    assert.ok(
      life.minSpawnBridgeEndDistM === null || life.minSpawnBridgeEndDistM >= JIEFANG_APPROACH_MIN_DIST_M - 0.5,
      `k62 hidden spawn distance violated: ${life.minSpawnBridgeEndDistM}`,
    )
    assert.equal(life.frustumViolations120m, 0, 'k62 zero frustum pop-in/out violations')
  } finally {
    controller.dispose()
    dutyTraffic.dispose()
    setEscapeClock(null)
    resetJiefangEscapeStateForTests()
  }
})

test('IDOK-541 LIVE-2: non-frontal E/Q/F triggers escape + dynamic bubble, rear spam cannot halt fleeing rider, frontal E/F halts 100%, sidewalk_riding bills ¥50 / ¥100 stacked', async () => {
  resetJiefangEscapeStateForTests()
  let nowSec = 50
  setEscapeClock(() => nowSec)

  const [bx, bz] = jiefangBridgeLocalToWorld(0, 14.0)
  const by = jiefangDeckWorldY(bx, bz)
  let playerPos = {x: bx - 3.0, y: by, z: bz} // behind actor heading +X
  let playerForward = {x: 1, z: 0}

  const swRider = makeActor({
    id: 'sw_escape_1',
    x: bx,
    y: by,
    z: bz,
    speed: 6.2,
    scale: 1,
    leaving: false,
    cited: false,
    dutyState: 'normal',
    haltedByDuty: false,
    violation: 'sidewalk_riding',
    violations: ['no_helmet', 'sidewalk_riding'],
    track: {dx: 1, dz: 0, gradeSeparated: 'jiefang'},
  })
  const wrongWayRider = makeActor({
    id: 'ww_escape_2',
    x: bx + 20,
    y: by,
    z: bz,
    speed: 6.2,
    scale: 1,
    leaving: false,
    cited: false,
    dutyState: 'normal',
    haltedByDuty: false,
    wrongWay: true,
    violation: 'wrong_way',
    violations: ['wrong_way'],
    track: {dx: 1, dz: 0, gradeSeparated: 'jiefang'},
  })
  const actors = [swRider, wrongWayRider]
  let rngVal = 0.1 // < 0.80 / 0.85 -> triggers escape on non-frontal

  const controller = createTrafficDutyController(
    {
      getPlayerPos: () => playerPos,
      getPlayerForward: () => playerForward,
      isWalking: () => true,
      getActors: () => actors,
      projectToScreen: () => ({x: 420, y: 260, visible: true}),
      enforceFrontalIntercept: true,
      random: () => rngVal,
      fineTerminal: {
        openFineTerminal: req => ({
          issued: true,
          fineYuan: req.fineYuan,
          violations: req.violations,
          ticketId: `GL-${req.actor.id}`,
        }),
      },
    },
    {mountDom: false},
  )

  try {
    // Enter active duty via briefing
    controller.startOfficerBriefing('briefing_intro')
    controller.advanceStory()
    controller.advanceStory()
    controller.chooseStoryOption('ready_now')
    controller.advanceStory()
    assert.equal(controller.getSnapshot().phase, 'active')

    // 1) Rear E flag -> escapes + emits escape bubble with "走咯！" & dynamic "下次一定戴头盔，也不走人行道！"
    const rearFlag = controller.pressDutyFlagShort()
    assert.equal(rearFlag.ok, false)
    assert.equal(rearFlag.reason, 'escaped')
    assert.equal(rearFlag.aspect, 'rear')
    assert.equal(swRider.dutyState, 'fleeing')

    const snapAfterEscape = controller.getSnapshot()
    const escBubble = snapAfterEscape.bubbles.find(b => b.kind === 'escape' && b.actor === swRider)
    assert.ok(escBubble, 'escape bubble must appear in controller snapshot')
    assert.equal(escBubble.shout, '走咯！')
    assert.equal(escBubble.vow, '下次一定戴头盔，也不走人行道！')
    assert.deepEqual(escBubble.violations, ['no_helmet', 'sidewalk_riding'])

    // 2) Spamming rear E or rear F on ALREADY-FLEEING rider MUST keep failing even when rng=0.99!
    rngVal = 0.99
    const spamFlag = controller.pressDutyFlagShort()
    assert.equal(spamFlag.ok, false)
    assert.equal(spamFlag.reason, 'escaped')
    assert.equal(swRider.dutyState, 'fleeing')

    const spamF = await controller.interceptViolator()
    assert.equal(spamF.ok, false)
    assert.equal(spamF.reason, 'escaped')
    assert.equal(swRider.dutyState, 'fleeing')

    // 3) Step into FRONT intercept sector (+3.0m ahead of swRider heading +X) facing actor -> E halts 100% AND clears escape bubble!
    playerPos = {x: bx + 3.0, y: by, z: bz}
    playerForward = {x: -1, z: 0}
    const frontFlag = controller.pressDutyFlagShort()
    assert.equal(frontFlag.ok, true)
    assert.equal(frontFlag.aspect, 'front')
    assert.equal(swRider.haltedByDuty, true)
    assert.equal(swRider.speed, 0)
    assert.equal(
      controller.getSnapshot().bubbles.filter(b => b.kind === 'escape').length,
      0,
      'frontal halt must immediately clear residual escape bubbles',
    )

    // 3b) Already-halted rider must NOT be scared away by side/rear Q whistle or E flag!
    rngVal = 0.01
    playerPos = {x: bx - 2.0, y: by, z: bz}
    playerForward = {x: 1, z: 0}
    const rearWhistleOnHalted = controller.pressDutyWhistle()
    assert.equal(rearWhistleOnHalted.escapedActors?.length ?? 0, 0, 'halted violator must not flee on rear Q whistle')
    assert.equal(swRider.haltedByDuty, true)
    const rearFlagOnHalted = controller.pressDutyFlagShort()
    assert.equal(rearFlagOnHalted.ok, true, 'halted violator must stay halted on rear E flag')
    assert.equal(swRider.haltedByDuty, true)

    // 4) Already-halted rider CAN be cited from BEHIND via F; stacked no_helmet(50)+sidewalk_riding(50) = ¥100!
    const citeRes = await controller.interceptViolator()
    assert.equal(citeRes.ok, true)
    assert.equal(citeRes.fineYuan, 100)
    assert.deepEqual(citeRes.violations, ['no_helmet', 'sidewalk_riding'])
    assert.equal(controller.getSnapshot().breakdown.sidewalk_riding, 1)
    assert.equal(controller.getSnapshot().breakdown.no_helmet, 1)

    // 5) Wrong-way rider (track +X, wrongWay=true -> heading -X): player at x+3 is REAR -> Q whistle escapes!
    nowSec += 1.0
    rngVal = 0.1
    playerPos = {x: bx + 23.0, y: by, z: bz}
    playerForward = {x: -1, z: 0}
    const qRear = controller.pressDutyWhistle()
    assert.equal(qRear.ok, true)
    assert.equal(qRear.escapedActors?.length, 1)
    assert.equal(wrongWayRider.dutyState, 'fleeing')
    const wwBubble = controller.getSnapshot().bubbles.find(b => b.kind === 'escape' && b.actor === wrongWayRider)
    assert.ok(wwBubble, 'wrong_way escape bubble must appear')
    assert.equal(wwBubble.shout, '走咯！')
    assert.equal(wwBubble.vow, '下次一定不逆行！')

    // 6) Step in front of wrongWayRider (heading -X, so front is x-3) -> F intercepts and bills ¥50 (same as sidewalk_riding)!
    playerPos = {x: bx + 17.0, y: by, z: bz}
    playerForward = {x: 1, z: 0}
    const citeWw = await controller.interceptViolator()
    assert.equal(citeWw.ok, true)
    assert.equal(citeWw.fineYuan, 50)
  } finally {
    controller.dispose()
    setEscapeClock(null)
    resetJiefangEscapeStateForTests()
  }
})

// ─── 12. 89° 侧面穿透防护 + 普通道路默认限幅 + 测试复位清订阅 ─────────────────

test('IDOK-541 ESC-10: closes 89deg side-hugging front loophole, normal road 0.85m dodge limit, and clears listeners on reset', () => {
  resetJiefangEscapeStateForTests()
  const rider = {x: 0, z: 0, yaw: 0, track: {dx: 1, dz: 0}, wrongWay: false, dodge: 0}
  assert.equal(classifyInterceptAspect(rider, {x: 0.01, z: 0.95}), 'side')
  assert.equal(classifyInterceptAspect(rider, {x: 0.5, z: 0.8}), 'front')
  assert.equal(classifyInterceptAspect(rider, {x: Number.NaN, z: 0}), 'side')
  const roadDodge = computeEscapeDodge(rider, {x: 0, z: -2}, 0.5)
  assert.ok(roadDodge > 0.6 && roadDodge <= 0.85, `normal road dodge should reach >0.6..0.85, got ${roadDodge}`)
  let fired = 0
  subscribeDutyEscape(() => {
    fired++
  })
  resetJiefangEscapeStateForTests()
  setEscapeClock(() => 100)
  tryEmitDutyEscape({
    actor: {kind: 'scooter', x: 0, y: 0, z: 0, violation: 'no_helmet', violations: ['no_helmet']},
    cause: 'flag',
    aspect: 'rear',
  })
  assert.equal(fired, 0, 'resetJiefangEscapeStateForTests must clear stray listeners')
  setEscapeClock(null)
})

// ─── 13. 手机端（30 两轮）实车解放桥仿真：双向 >¥5,000 罚款池 + 逆行零瞬移 + onViolatorEscape 统一送达 ──

test('IDOK-541 LIVE-3: mobile Jiefang story traffic exceeds ¥5,000 bidirectional pool with zero wrongWay dodge jitter and unified escape listener', async () => {
  resetJiefangEscapeStateForTests()
  let nowSec = 1000
  setEscapeClock(() => nowSec)
  const loadGraph = async () => {
    const raw = readFileSync(new URL('../../../public/world/roads/-1_0.json.gz', import.meta.url))
    return JSON.parse(gunzipSync(raw).toString('utf8'))
  }
  const [ox, oz] = jiefangBridgeLocalToWorld(-20, 14.0)
  const officerPos = {x: ox, y: jiefangDeckWorldY(ox, oz), z: oz}
  const dutyTraffic = createDutyTraffic({
    bridgeDeckOnly: true,
    actorLimit: 42,
    desiredCars: 10,
    desiredScooters: 30,
    loadGraph,
  })
  const receivedEvents = []
  const unsub = dutyTraffic.onViolatorEscape(ev => receivedEvents.push(ev))
  try {
    requestJiefangStoryMode(true)
    await dutyTraffic.start()
    assert.equal(dutyTraffic.getStats().jiefangStoryMode, true)

    let maxWrongWayDeltaDodge = 0
    const prevDodges = new Map()
    for (let sec = 1; sec <= 240; sec++) {
      nowSec += 1
      for (let k = 0; k < 20; k++) {
        for (const a of dutyTraffic.getActors()) {
          if (a.kind === 'scooter' && a.wrongWay && (a.dutyState === 'fleeing' || a.dutyState === 'evading')) {
            prevDodges.set(a, a.dodge)
          }
        }
        dutyTraffic.step(0.05, officerPos, {officerActive: true})
        for (const [a, prev] of prevDodges) {
          if (a.wrongWay && (a.dutyState === 'fleeing' || a.dutyState === 'evading')) {
            const d = Math.abs(a.dodge - prev)
            if (d > maxWrongWayDeltaDodge) maxWrongWayDeltaDodge = d
          }
        }
        prevDodges.clear()
      }
    }

    const stats = dutyTraffic.getStats()
    assert.ok(
      stats.finePool.totalYuan > 5000,
      `mobile 240s bidirectional fine pool must exceed ¥5,000, got ¥${stats.finePool.totalYuan}`,
    )
    assert.ok(
      stats.finePool.northYuan > 2500 && stats.finePool.southYuan > 2500,
      `mobile pool must be balanced N/S, got N=¥${stats.finePool.northYuan} S=¥${stats.finePool.southYuan}`,
    )
    assert.ok(
      maxWrongWayDeltaDodge <= 0.3,
      `wrongWay fleeing scooter must dodge smoothly without >0.30m teleport jump, saw max Δdodge=${maxWrongWayDeltaDodge.toFixed(3)}m`,
    )

    const sampleActor = dutyTraffic.getActors().find(a => a.kind === 'scooter' && !a.leaving && !a.cited && a.violation !== 'none')
    assert.ok(sampleActor)
    nowSec += 10
    const beforeCount = receivedEvents.length
    tryEmitDutyEscape({actor: sampleActor, cause: 'flag', aspect: 'rear'})
    assert.equal(receivedEvents.length, beforeCount + 1, 'dutyTraffic.onViolatorEscape must receive bus escape events')

    sampleActor.dutyState = 'halted'
    sampleActor.haltedByDuty = true
    sampleActor.speed = 0
    const haltRes = dutyTraffic.commandHalt(
      {x: sampleActor.x - 2, y: sampleActor.y, z: sampleActor.z},
      {kind: 'whistle', rangeM: 12, random: () => 0.01},
    )
    assert.equal(haltRes.fled.includes(sampleActor), false, 'halted violator must not flee on commandHalt')
    assert.equal(sampleActor.haltedByDuty, true)
  } finally {
    unsub()
    requestJiefangStoryMode(false)
    dutyTraffic.dispose()
    setEscapeClock(null)
    resetJiefangEscapeStateForTests()
  }
})
