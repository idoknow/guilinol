import * as THREE from 'three'
import {
  auditMissionsAgainstQuietZones,
  getMissionById,
  MISSIONS,
  type MissionDef,
} from '../missions'
import {
  computeMissionPayout,
  getActiveDeliverySoupSpillMultiplier,
  hasClaimedMissionFirstClear,
  settleMissionReward,
} from './commerce'
import {findQuietZoneAt} from './quiet-zones'
import {getActiveSaveSnapshot as getSaveSnapshot} from './save'
import {
  emit,
  getState,
  setMissionState,
  type PlayerMode,
} from './state'

export type MissionLifecycleStatus =
  | 'available'
  | 'active'
  | 'step_progress'
  | 'completed'
  | 'failed'
  | 'abandoned'

export interface MissionStepRuntimeFrame {
  dt: number
  x: number
  y?: number
  z: number
  mode: PlayerMode
  speedMs: number
  braking: boolean
  parkLocked: boolean
  crashPhase: string
  twoWheelFlow?: string
  frozen?: boolean
}

export interface StartMissionResult {
  ok: boolean
  reason?: 'NOT_FOUND' | 'ALREADY_ACTIVE' | 'QUIET_ZONE_BLOCKED' | 'MISSION_CONTAINS_QUIET'
  quietZoneName?: string
}

export interface MissionStatusSnapshot {
  status: MissionLifecycleStatus
  missionId: string | null
  stepIndex: number
  stepCount: number
  timerRemaining: number | null
  soup: number
  frozen: boolean
  lastOutcome: {
    missionId: string
    outcome: 'completed' | 'failed' | 'abandoned'
    reason?: string
    payout?: number
    isFirstClear?: boolean
  } | null
}

const BRAKE_COOLDOWN_SEC = 0.85
const HARD_BRAKE_MIN_SPEED_MS = 4.0
const HARD_BRAKE_MIN_DECEL_MS2 = 5.5
const HARD_BRAKE_SOUP_DROP = 0.10
const CRASH_SOUP_DROP = 0.25

function notifyToast(text: string, ms = 2600): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text, ms}}))
  }
}

/**
 * Pure mission runner state machine (DOM/Three-free) so Node unit tests and browser runtime
 * execute the exact same transition, soup-spill, freeze, and cleanup logic.
 */
export class MissionRunnerEngine {
  private status: MissionLifecycleStatus = 'available'
  private mission: MissionDef | null = null
  private stepIndex = 0
  private timerRemaining: number | null = null
  private soup = 1.0
  private attemptNonce = ''
  private settled = false
  private simTime = 0
  private brakeCooldownUntil = 0
  private wasCrashed = false
  private prevMode: PlayerMode = 'foot'
  private prevSpeedMs = 0
  private frozen = false
  private lastOutcome: MissionStatusSnapshot['lastOutcome'] = null

  getSnapshot(): MissionStatusSnapshot {
    return {
      status: this.status,
      missionId: this.mission?.id ?? null,
      stepIndex: this.stepIndex,
      stepCount: this.mission?.steps.length ?? 0,
      timerRemaining: this.timerRemaining,
      soup: this.soup,
      frozen: this.frozen,
      lastOutcome: this.lastOutcome,
    }
  }

  start(missionId: string, playerPos?: {x: number; z: number}): StartMissionResult {
    if (this.mission && (this.status === 'active' || this.status === 'step_progress')) {
      return {ok: false, reason: 'ALREADY_ACTIVE'}
    }
    const def = getMissionById(missionId)
    if (!def) return {ok: false, reason: 'NOT_FOUND'}

    if (auditMissionsAgainstQuietZones([def]).length > 0) {
      return {ok: false, reason: 'MISSION_CONTAINS_QUIET'}
    }
    if (playerPos) {
      const hit = findQuietZoneAt(playerPos.x, playerPos.z)
      if (hit) {
        notifyToast(`安静区内无法接单（${hit.name}），请走出校门后重试`)
        return {ok: false, reason: 'QUIET_ZONE_BLOCKED', quietZoneName: hit.name}
      }
    }

    this.mission = def
    this.status = 'active'
    this.stepIndex = 0
    this.soup = 1.0
    this.settled = false
    this.attemptNonce = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    this.timerRemaining = def.steps[0]?.timer ?? null
    this.brakeCooldownUntil = this.simTime + BRAKE_COOLDOWN_SEC
    this.wasCrashed = false
    this.prevMode = getState().mode
    this.prevSpeedMs = 0
    this.frozen = false
    this.lastOutcome = null

    this.status = 'step_progress'
    this.syncState()
    emit({type: 'mission:start', id: def.id, title: def.title})
    const firstStep = def.steps[0]
    if (firstStep) {
      emit({type: 'mission:step', id: def.id, stepIndex: 0, text: firstStep.text})
    }
    notifyToast(`已接单：${def.title}`)
    return {ok: true}
  }

  abandon(): boolean {
    if (!this.mission) return false
    this.conclude('abandoned', 'user_abandoned')
    notifyToast('已放弃当前任务，可随时重新接单')
    return true
  }

  forceSpillDrop(amount: number, reason = 'spill'): void {
    if (!this.mission || this.mission.line !== 'noodle' || this.settled) return
    this.soup = Math.max(0, Number((this.soup - Math.max(0, amount)).toFixed(4)))
    if (this.soup <= 0 && this.mission.failOn.includes('spill')) {
      this.conclude('failed', reason)
      notifyToast('汤粉洒光了，任务失败！可重新接单')
      return
    }
    this.syncState()
  }

  step(frame: MissionStepRuntimeFrame): void {
    if (!this.mission || this.settled) return
    const dt = Number.isFinite(frame.dt) ? Math.max(0, Math.min(0.12, frame.dt)) : 0
    this.simTime += dt

    const def = this.mission
    const isRace = def.line === 'race'
    const isShopOpen = getState().activeShop !== null
    const isParkedFreeze = !isRace && frame.mode === 'ebike' && frame.parkLocked
    const isFrozen = Boolean(frame.frozen) || isShopOpen || frame.mode === 'fly' || isParkedFreeze
    this.frozen = isFrozen

    // 1. Evaluate soup spill (only for noodle delivery missions)
    if (def.line === 'noodle' && !isFrozen) {
      const twoWheel = frame.mode === 'ebike' || frame.mode === 'bike'
      const crashedNow =
        frame.crashPhase !== 'none' ||
        frame.twoWheelFlow === 'crashed' ||
        frame.twoWheelFlow === 'standing_up' ||
        frame.twoWheelFlow === 'picking_up'

      // Edge-triggered crash penalty: strictly ONE -25% fixed deduction per crash
      if (twoWheel && (frame.crashPhase === 'crashed' || frame.twoWheelFlow === 'crashed') && !this.wasCrashed) {
        this.wasCrashed = true
        this.brakeCooldownUntil = this.simTime + 1.0
        this.prevSpeedMs = 0
        this.soup = Math.max(0, Number((this.soup - CRASH_SOUP_DROP).toFixed(4)))
        emit({type: 'crash', severity: 1, vehicleId: getState().vehicle?.id})
        if (this.soup <= 0 && def.failOn.includes('spill')) {
          this.conclude('failed', 'soup_spilled_crash')
          notifyToast('摔车把汤全洒了，任务失败！')
          return
        }
        notifyToast(`摔车洒汤 -${Math.round(CRASH_SOUP_DROP * 100)}%！`)
      } else if (!crashedNow) {
        this.wasCrashed = false
      }

      // Hard-braking deduction: ONLY on upright riding ebike/bike when crashPhase === 'none'
      const modeStable = this.prevMode === frame.mode
      if (
        twoWheel &&
        modeStable &&
        frame.crashPhase === 'none' &&
        !crashedNow &&
        !frame.parkLocked &&
        dt > 1e-4 &&
        this.simTime >= this.brakeCooldownUntil
      ) {
        const decel = (this.prevSpeedMs - frame.speedMs) / dt
        if (
          this.prevSpeedMs >= HARD_BRAKE_MIN_SPEED_MS &&
          (frame.braking || decel >= HARD_BRAKE_MIN_DECEL_MS2) &&
          decel >= HARD_BRAKE_MIN_DECEL_MS2
        ) {
          this.brakeCooldownUntil = this.simTime + BRAKE_COOLDOWN_SEC
          const mul = getActiveDeliverySoupSpillMultiplier()
          const drop = Number((HARD_BRAKE_SOUP_DROP * mul).toFixed(4))
          this.soup = Math.max(0, Number((this.soup - drop).toFixed(4)))
          if (this.soup <= 0 && def.failOn.includes('spill')) {
            this.conclude('failed', 'soup_spilled_brake')
            notifyToast('急刹洒光了汤，任务失败！')
            return
          }
          notifyToast(`急刹洒汤 -${Math.round(drop * 100)}%`)
        }
      }
      this.prevSpeedMs = twoWheel && !crashedNow ? frame.speedMs : 0
    } else {
      this.prevSpeedMs = 0
    }
    this.prevMode = frame.mode

    // 2. Step timer progression (frozen when shop open / paused / fly / P-locked non-race)
    if (this.timerRemaining !== null && !isFrozen) {
      this.timerRemaining = Math.max(0, this.timerRemaining - dt)
      if (this.timerRemaining <= 0 && def.failOn.includes('timeout')) {
        this.conclude('failed', 'timeout')
        notifyToast(`任务超时：${def.title}，可重新接单`)
        return
      }
    }

    // 3. Step arrival check
    const curStep = def.steps[this.stepIndex]
    if (curStep) {
      const dist = Math.hypot(frame.x - curStep.at[0], frame.z - curStep.at[1])
      if (dist <= curStep.radius) {
        if (this.stepIndex + 1 < def.steps.length) {
          this.stepIndex += 1
          const nextStep = def.steps[this.stepIndex]
          this.timerRemaining = nextStep.timer ?? this.timerRemaining
          emit({type: 'mission:step', id: def.id, stepIndex: this.stepIndex, text: nextStep.text})
          notifyToast(nextStep.text, 2200)
        } else {
          this.conclude('completed')
          return
        }
      }
    }

    this.syncState()
  }

  private conclude(outcome: 'completed' | 'failed' | 'abandoned', reason?: string): void {
    const def = this.mission
    if (!def || this.settled) return
    this.settled = true
    const finalSoup = this.soup
    const nonce = this.attemptNonce

    this.mission = null
    this.status = outcome
    this.stepIndex = 0
    this.timerRemaining = null
    this.soup = 1.0
    this.frozen = false
    this.wasCrashed = false
    this.prevSpeedMs = 0

    // Single-exit cleanup of HUD state
    setMissionState(null)

    if (outcome === 'completed') {
      const rewardRes = settleMissionReward({
        mission: def,
        soupRatio: finalSoup,
        attemptNonce: nonce,
      })
      this.lastOutcome = {
        missionId: def.id,
        outcome: 'completed',
        payout: rewardRes.credited,
        isFirstClear: rewardRes.isFirstClear,
      }
      emit({
        type: 'mission:done',
        id: def.id,
        reward: rewardRes.credited,
        firstClear: rewardRes.isFirstClear,
      })
      const tag = rewardRes.isFirstClear ? '首通赏金' : '日常赏金'
      notifyToast(`任务完成！${tag} +¥${rewardRes.credited}`, 3400)
    } else if (outcome === 'failed') {
      this.lastOutcome = {missionId: def.id, outcome: 'failed', reason}
      emit({type: 'mission:fail', id: def.id, reason: reason ?? 'failed'})
    } else {
      this.lastOutcome = {missionId: def.id, outcome: 'abandoned', reason}
      emit({type: 'mission:abandon', id: def.id})
    }

    // Immediately re-arm runner so player can accept another or re-accept the same mission cleanly
    this.status = 'available'
  }

  private syncState(): void {
    const def = this.mission
    if (!def) {
      setMissionState(null)
      return
    }
    const step = def.steps[this.stepIndex]
    const isFirst = !hasClaimedMissionFirstClear(def.id)
    const rewardPreview = computeMissionPayout(def, this.soup, isFirst)
    setMissionState({
      id: def.id,
      title: def.title,
      step: step?.text ?? '',
      target: step?.at,
      timer: this.timerRemaining !== null ? Math.ceil(this.timerRemaining) : undefined,
      meter: def.line === 'noodle' ? {label: '汤', value: this.soup} : undefined,
      line: step?.npc,
      status: this.status,
      stepIndex: this.stepIndex,
      stepCount: def.steps.length,
      rewardPreview,
      canAbandon: true,
      frozen: this.frozen,
    })
  }
}

export interface MissionBeaconController {
  sync(target: [number, number] | undefined, playerPos: {x: number; z: number}, hidden: boolean, dt: number): void
  isVisible(): boolean
  getTarget(): [number, number] | null
  dispose(): void
}

/**
 * Zero-light 3D waypoint light pillar + pulsing ground ring for active mission steps.
 * Strictly adds 0 Three.js lights (uses MeshBasicMaterial only).
 */
export function createMissionBeacon(
  scene: THREE.Scene,
  sampleGroundY: (x: number, z: number) => number,
): MissionBeaconController {
  const group = new THREE.Group()
  group.name = 'mission-waypoint-beacon'
  group.visible = false

  const ringGeo = new THREE.RingGeometry(2.4, 3.3, 40).rotateX(-Math.PI / 2)
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x20d6c1,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  })
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.position.y = 0.22
  ring.renderOrder = 8

  const pillarGeo = new THREE.CylinderGeometry(0.55, 1.35, 34, 16, 1, true)
  const pillarMat = new THREE.MeshBasicMaterial({
    color: 0x20d6c1,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  })
  const pillar = new THREE.Mesh(pillarGeo, pillarMat)
  pillar.position.y = 17
  pillar.renderOrder = 8

  const capGeo = new THREE.OctahedronGeometry(0.95, 0)
  const capMat = new THREE.MeshBasicMaterial({color: 0xffc53d, fog: false})
  const cap = new THREE.Mesh(capGeo, capMat)
  cap.position.y = 4.6
  cap.renderOrder = 9

  group.add(ring, pillar, cap)
  scene.add(group)

  let pulse = 0
  let cachedTarget: [number, number] | null = null
  let cachedGroundY = NaN

  return {
    sync(target, _playerPos, hidden, dt) {
      if (!target || hidden) {
        group.visible = false
        cachedTarget = null
        cachedGroundY = NaN
        return
      }
      if (!cachedTarget || cachedTarget[0] !== target[0] || cachedTarget[1] !== target[1]) {
        cachedTarget = [target[0], target[1]]
        cachedGroundY = NaN
      }
      if (!Number.isFinite(cachedGroundY)) {
        cachedGroundY = sampleGroundY(target[0], target[1])
      }
      const gy = Number.isFinite(cachedGroundY) ? cachedGroundY : 153
      pulse += Math.min(0.1, Math.max(0, dt))
      group.visible = true
      group.position.set(target[0], gy, target[1])
      const wave = 0.5 + 0.5 * Math.sin(pulse * 3.2)
      ringMat.opacity = 0.48 + 0.32 * wave
      ring.scale.setScalar(0.96 + 0.08 * wave)
      pillarMat.opacity = 0.16 + 0.12 * wave
      cap.position.y = 4.4 + 0.45 * Math.sin(pulse * 2.4)
      cap.rotation.y += Math.min(0.1, Math.max(0, dt)) * 1.6
    },
    isVisible() {
      return group.visible
    },
    getTarget() {
      return cachedTarget ? [cachedTarget[0], cachedTarget[1]] : null
    },
    dispose() {
      group.removeFromParent()
      ringGeo.dispose()
      ringMat.dispose()
      pillarGeo.dispose()
      pillarMat.dispose()
      capGeo.dispose()
      capMat.dispose()
    },
  }
}

export function listMissionsForUi() {
  const snap = getSaveSnapshot()
  return MISSIONS.map(def => {
    const firstClearDone = snap.economy.claimedMissionFirstClear.includes(def.id)
    const history = snap.economy.missionHistory[def.id]
    return {
      def,
      firstClearDone,
      completions: history?.count ?? snap.economy.completedMissionCounts[def.id] ?? 0,
      nextReward: computeMissionPayout(def, 1.0, !firstClearDone),
      firstClearReward: computeMissionPayout(def, 1.0, true),
      repeatReward: computeMissionPayout(def, 1.0, false),
    }
  })
}
