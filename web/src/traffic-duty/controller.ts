import {getLatestTraffic, stopActor as stopTrafficActor, type Actor, type Position, type Traffic} from '../traffic/sim.ts'
import {resolveTrafficDutyCandidate, type WalkLockState} from './arbiter.ts'
import {createLocalLeaderboardProvider, type TrafficDutyLeaderboardProvider} from './leaderboard.ts'
import {
  computeFineYuan,
  DEFAULT_FINE_YUAN,
  DEFAULT_STOP_DURATION_SEC,
  DEFAULT_WHISTLE_RANGE_M,
  formatDutyReportTitle,
  JIEFANG_DUTY_ZONE,
  TRAFFIC_DUTY_DURATION_SEC,
  VIOLATION_BUBBLE_LINES,
  VIOLATION_LABELS,
  type ActiveViolation,
  type DutyBubbleSnapshot,
  type DutyFineTable,
  type DutyPhase,
  type LeaderboardSummary,
  type TrafficDutyController,
  type TrafficDutyHost,
  type TrafficDutyInteractCandidate,
  type TrafficDutySnapshot,
  type ViolationBreakdown,
  type WhistleCiteResult,
} from './types.ts'
import type {TrafficDutyUiHandle, TrafficDutyUiOptions} from './ui.ts'
import {playWhistleSound} from './whistle.ts'

const BUBBLE_DURATION_SEC = 2.6

interface ActiveBubble {
  id: string
  actor: Actor
  title: string
  line: string
  fineYuan: number
  remainingSec: number
}

function emptyBreakdown(): ViolationBreakdown {
  return {no_helmet: 0, bike_double: 0, ebike_overload: 0}
}

function isInJiefangZone(pos: Position | null): boolean {
  if (!pos) return false
  const dx = pos.x - JIEFANG_DUTY_ZONE.center.x
  const dz = pos.z - JIEFANG_DUTY_ZONE.center.z
  return dx * dx + dz * dz <= JIEFANG_DUTY_ZONE.radiusM ** 2
}

export function createTrafficDutyController(
  host: TrafficDutyHost,
  options?: {
    leaderboard?: TrafficDutyLeaderboardProvider
    mountDom?: boolean
    mountUi?: (opts: TrafficDutyUiOptions) => TrafficDutyUiHandle
  },
): TrafficDutyController {
  const durationSec = Math.max(10, Math.round(host.durationSec ?? TRAFFIC_DUTY_DURATION_SEC))
  const whistleRangeM = Math.max(3.5, Math.min(4.5, host.whistleRangeM ?? DEFAULT_WHISTLE_RANGE_M))
  const stopDurationSec = Math.max(1.5, host.stopDurationSec ?? DEFAULT_STOP_DURATION_SEC)
  const fineTable: DutyFineTable = {
    no_helmet: Math.max(1, Math.round(host.fineTable?.no_helmet ?? DEFAULT_FINE_YUAN.no_helmet)),
    bike_double: Math.max(1, Math.round(host.fineTable?.bike_double ?? DEFAULT_FINE_YUAN.bike_double)),
    ebike_overload: Math.max(1, Math.round(host.fineTable?.ebike_overload ?? DEFAULT_FINE_YUAN.ebike_overload)),
  }
  const leaderboard = options?.leaderboard ?? createLocalLeaderboardProvider()
  let cachedLeaderboard = leaderboard.load()

  let phase: DutyPhase = 'idle'
  let remainingSec = durationSec
  let elapsedSec = 0
  let totalFineYuan = 0
  let citedCount = 0
  let whistleCount = 0
  let breakdown: ViolationBreakdown = emptyBreakdown()
  let reportTitle: string | null = null
  let lastRecordRank: number | null = null
  let isNewRecord = false
  let lastTrafficApplied: Traffic | undefined
  let bubbleSeq = 0
  const bubbles: ActiveBubble[] = []
  let ui: TrafficDutyUiHandle | undefined

  function activeTraffic(): Traffic | undefined {
    return host.getTraffic?.() ?? getLatestTraffic()
  }

  function currentActors(): readonly Actor[] {
    if (host.getActors) return host.getActors()
    return activeTraffic()?.actors ?? []
  }

  function syncTrafficDutyMode(on: boolean): void {
    const sim = activeTraffic()
    if (!sim) return
    lastTrafficApplied = sim
    sim.setDutyConfig({
      active: on,
      center: JIEFANG_DUTY_ZONE.center,
      radius: JIEFANG_DUTY_ZONE.radiusM,
      weights: host.violationWeights,
      twoWheelShare: host.twoWheelShare ?? 0.56,
    })
  }

  function clearBubbles(): void {
    bubbles.length = 0
  }

  function buildBubbleSnapshots(): DutyBubbleSnapshot[] {
    return bubbles.map(item => {
      const worldY = item.actor.y + 2.05
      const proj = host.projectToScreen?.({x: item.actor.x, y: worldY, z: item.actor.z})
      return {
        id: item.id,
        actor: item.actor,
        title: item.title,
        line: item.line,
        fineYuan: item.fineYuan,
        x: item.actor.x,
        y: worldY,
        z: item.actor.z,
        remainingSec: item.remainingSec,
        screenX: proj?.x ?? 0,
        screenY: proj?.y ?? 0,
        visible: Boolean(proj?.visible),
      }
    })
  }

  function getInteractCandidate(walkLocks?: WalkLockState): TrafficDutyInteractCandidate | null {
    if (phase !== 'active') return null
    if (!host.isWalking() || host.isUiBlocked?.()) return null
    return resolveTrafficDutyCandidate(
      true,
      walkLocks,
      currentActors(),
      host.getPlayerPos(),
      whistleRangeM,
      fineTable,
    )
  }

  function getSnapshot(): TrafficDutySnapshot {
    const pos = host.getPlayerPos()
    const inDutyZone = isInJiefangZone(pos)
    const candidate = phase === 'active' ? getInteractCandidate() : null
    return {
      phase,
      durationSec,
      remainingSec,
      elapsedSec,
      totalFineYuan,
      citedCount,
      breakdown: {...breakdown},
      inDutyZone,
      nearestDistanceM: candidate ? candidate.distance : null,
      nearestViolation: candidate ? candidate.violation : null,
      nearestFineYuan: candidate ? candidate.fineYuan : null,
      whistleCount,
      reportTitle,
      lastRecordRank,
      isNewRecord,
      bubbles: buildBubbleSnapshots(),
    }
  }

  function syncUi(): void {
    ui?.render(getSnapshot(), cachedLeaderboard, getInteractCandidate())
  }

  function resetCounters(): void {
    remainingSec = durationSec
    elapsedSec = 0
    totalFineYuan = 0
    citedCount = 0
    whistleCount = 0
    breakdown = emptyBreakdown()
    reportTitle = null
    lastRecordRank = null
    isNewRecord = false
    clearBubbles()
  }

  function startDuty(): TrafficDutySnapshot {
    resetCounters()
    phase = 'active'
    ui?.closePanel()
    syncTrafficDutyMode(true)
    host.onDutyStateChange?.(true)
    host.onToast?.('解放桥交通劝导已开始，靠近违规两轮车即可吹哨劝导', 2600)
    syncUi()
    return getSnapshot()
  }

  function recordAndSummarize(completed: boolean): TrafficDutySnapshot {
    phase = 'summary'
    syncTrafficDutyMode(false)
    host.onDutyStateChange?.(false)
    reportTitle = formatDutyReportTitle(totalFineYuan)
    if (citedCount === 0 && totalFineYuan === 0) {
      lastRecordRank = null
      isNewRecord = false
    } else {
      const saved = leaderboard.record({
        playerName: host.getPlayerName?.() || '桂林市民',
        totalFineYuan,
        citedCount,
        breakdown: {...breakdown},
        durationSec: Math.max(1, Math.round(elapsedSec || (completed ? durationSec : 1))),
        completed,
        achievedAt: Date.now(),
      })
      cachedLeaderboard = saved.summary
      lastRecordRank = saved.rank
      isNewRecord = saved.isNewRecord
    }
    ui?.openPanel('duty')
    syncUi()
    return getSnapshot()
  }

  function abandonDuty(): TrafficDutySnapshot {
    if (phase !== 'active') return getSnapshot()
    return recordAndSummarize(false)
  }

  function finishDuty(): TrafficDutySnapshot {
    if (phase !== 'active') return getSnapshot()
    remainingSec = 0
    return recordAndSummarize(true)
  }

  function resetToIdle(): TrafficDutySnapshot {
    phase = 'idle'
    syncTrafficDutyMode(false)
    host.onDutyStateChange?.(false)
    resetCounters()
    syncUi()
    return getSnapshot()
  }

  function triggerWhistle(): WhistleCiteResult {
    if (phase !== 'active') return {ok: false, reason: 'inactive'}
    const pos = host.getPlayerPos()
    const actors = currentActors()
    const candidate = getInteractCandidate()
    if (!candidate) {
      // Distinguish out-of-range vs already-cited vs none
      if (pos) {
        let nearestAnyDist = Infinity
        let nearestCited = false
        for (const a of actors) {
          if (a.kind !== 'scooter' || a.leaving || a.scale < 0.5) continue
          if (Math.abs(a.y - pos.y) > 2.5) continue
          const d = Math.hypot(a.x - pos.x, a.z - pos.z)
          if (d <= whistleRangeM && a.cited) {
            nearestCited = true
            break
          }
          if (a.violation && a.violation !== 'none' && !a.cited) {
            nearestAnyDist = Math.min(nearestAnyDist, d)
          }
        }
        if (nearestCited) return {ok: false, reason: 'already_cited'}
        if (Number.isFinite(nearestAnyDist) && nearestAnyDist > whistleRangeM) {
          return {ok: false, reason: 'out_of_range', distance: nearestAnyDist}
        }
      }
      return {ok: false, reason: 'no_target'}
    }

    const {actor, violation, fineYuan, distance} = candidate
    // IDOK-153: only stop and cite NPC violators; player wallet/wanted never penalized.
    actor.cited = true
    const sim = activeTraffic()
    if (host.stopActor) host.stopActor(actor, stopDurationSec)
    else stopTrafficActor(actor, stopDurationSec, sim)

    whistleCount++
    citedCount++
    totalFineYuan += fineYuan
    breakdown[violation] += 1

    playWhistleSound()

    const lines = VIOLATION_BUBBLE_LINES[violation]
    const line = lines[(citedCount - 1) % lines.length]
    const title = `模拟罚单 ¥${fineYuan} · ${VIOLATION_LABELS[violation]}`
    for (let i = bubbles.length - 1; i >= 0; i--) {
      if (bubbles[i].actor === actor) bubbles.splice(i, 1)
    }
    bubbles.push({
      id: `tdb_${++bubbleSeq}`,
      actor,
      title,
      line,
      fineYuan,
      remainingSec: BUBBLE_DURATION_SEC,
    })

    const result: WhistleCiteResult = {
      ok: true,
      actor,
      violation,
      fineYuan,
      totalFineYuan,
      citedCount,
      distance,
    }
    host.onWhistle?.(result)
    syncUi()
    return result
  }

  function step(dt: number): TrafficDutySnapshot {
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(0.25, dt) : 0
    const sim = activeTraffic()
    if (phase === 'active' && sim && sim !== lastTrafficApplied) {
      syncTrafficDutyMode(true)
    }

    for (let i = bubbles.length - 1; i >= 0; i--) {
      bubbles[i].remainingSec -= safeDt
      if (bubbles[i].remainingSec <= 0 || bubbles[i].actor.leaving) {
        bubbles.splice(i, 1)
      }
    }

    if (phase === 'active' && !host.isPaused?.() && !host.isUiBlocked?.() && !ui?.isPanelOpen()) {
      elapsedSec += safeDt
      remainingSec = Math.max(0, remainingSec - safeDt)
      if (remainingSec <= 0) {
        return finishDuty()
      }
    }

    syncUi()
    return getSnapshot()
  }

  if (options?.mountUi && (options.mountDom === true || (options.mountDom !== false && typeof document !== 'undefined'))) {
    ui = options.mountUi({
      container: host.mountContainer ?? (typeof document !== 'undefined' ? document.body : (undefined as unknown as HTMLElement)),
      arbiterWired: Boolean(host.arbiterWired),
      alwaysShowEntry: Boolean(host.alwaysShowEntry),
      onStart: () => startDuty(),
      onAbandon: () => abandonDuty(),
      onFinish: () => finishDuty(),
      onWhistle: () => triggerWhistle(),
      onGoBridge: host.onTeleportToBridge ? () => void host.onTeleportToBridge?.() : undefined,
      getFineTable: () => fineTable,
    })
    syncUi()
  }

  return {
    startDuty,
    abandonDuty,
    finishDuty,
    resetToIdle,
    step,
    triggerWhistle,
    getInteractCandidate,
    getSnapshot,
    getLeaderboard: () => (cachedLeaderboard = leaderboard.load()),
    openPanel(tab = 'duty') {
      cachedLeaderboard = leaderboard.load()
      ui?.openPanel(tab)
      syncUi()
    },
    closePanel() {
      ui?.closePanel()
      syncUi()
    },
    isPanelOpen: () => Boolean(ui?.isPanelOpen()),
    dispose() {
      if (phase === 'active') {
        syncTrafficDutyMode(false)
        host.onDutyStateChange?.(false)
        phase = 'idle'
      }
      clearBubbles()
      ui?.dispose()
      ui = undefined
    },
  }
}
