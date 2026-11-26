import {audioCtor, existingCityAudio, resumeCityAudio} from '../../city-audio.ts'
import type { CookingVisualState } from '../cooking.ts'
import { SOUND_CATALOG, SOUND_IDS, type MifenSoundId, type SoundSpec } from './catalog.ts'
import { createPinkNoiseBuffer, createSafeMasterChain, scheduleSoundVoice } from './synth.ts'

export { SOUND_CATALOG, SOUND_IDS, type MifenSoundId, type MifenSoundCategory, type SoundSpec } from './catalog.ts'
export {
  renderSoundOffline,
  renderAllSoundsOffline,
  encodeWavMono16,
  type OfflineAudioRenderReport,
} from './offline.ts'

export type MifenLoopId = 'boil_bubbling' | 'brine_pour'

export const MIFEN_AUDIO_MAX_DISTANCE_M = 12
const MIFEN_AUDIO_NEAR_DISTANCE_M = 1.5

export function computeMifenDistanceGain(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return 1
  if (distanceMeters >= MIFEN_AUDIO_MAX_DISTANCE_M) return 0
  if (distanceMeters <= MIFEN_AUDIO_NEAR_DISTANCE_M) return 1
  const t = (distanceMeters - MIFEN_AUDIO_NEAR_DISTANCE_M) / (MIFEN_AUDIO_MAX_DISTANCE_M - MIFEN_AUDIO_NEAR_DISTANCE_M)
  return Math.max(0, Math.min(1, (1 - t) * (1 - t * 0.35)))
}

export interface MifenAudioStats {
  supported: boolean
  unlocked: boolean
  muted: boolean
  volume: number
  listenerDistance: number
  distanceGain: number
  playedCounts: Record<string, number>
  totalPlayed: number
  lastPlayedId: MifenSoundId | null
  activeLoops: MifenLoopId[]
}

export interface MifenAudioController {
  unlock: () => boolean
  play: (id: MifenSoundId, opts?: { volume?: number }) => boolean
  playBlip: (speaker: 'uncle' | 'player') => boolean
  startLoop: (id: MifenLoopId) => boolean
  stopLoop: (id: MifenLoopId) => void
  stopAllLoops: () => void
  setBoiling: (active: boolean) => void
  setPouringBrine: (active: boolean) => void
  setListenerDistance: (meters: number) => void
  syncCooking: (visual: CookingVisualState | null | undefined, dt?: number) => void
  setMuted: (muted: boolean) => void
  isMuted: () => boolean
  setVolume: (vol: number) => void
  getCatalog: () => Record<MifenSoundId, SoundSpec>
  getStats: () => MifenAudioStats
  dispose: () => void
}


/**
 * 田源米粉 · Web Audio 全链路音效引擎
 *
 * 自动处理浏览器手势解锁、失焦防爆音限幅（<= 0.94）、台词打字机节流及煮锅/淋卤循环声。
 */
export function createMifenAudio(opts?: { muted?: boolean; volume?: number }): MifenAudioController {
  let ctx: AudioContext | null = null
  let masterInput: GainNode | null = null
  let masterGain: GainNode | null = null
  let distanceGainNode: GainNode | null = null
  let noiseBuf: AudioBuffer | null = null
  let muted = Boolean(opts?.muted)
  let volume = typeof opts?.volume === 'number' && Number.isFinite(opts.volume) ? Math.max(0, Math.min(1, opts.volume)) : 0.84
  let listenerDistance = 0
  let distanceGain = 1
  let unlocked = false
  let disposed = false

  interface PrevCookingSnapshot {
    active: boolean
    ticketId: string | null
    stage: CookingVisualState['stage']
    panelOpen: boolean
    boilDone: boolean
    dipPhase: number
    drainProgress: number
    hasNoodles: boolean
    meatDone: boolean
    chopCount: number
    addedMeatsCount: number
    pouring: boolean
    chiliOil: boolean
    servePulse: number
    boilLockNotified: boolean
    noodlesPouredNotified: boolean
    meatPlateNotified: boolean
    servedNotified: boolean
  }
  let prevCooking: PrevCookingSnapshot | null = null

  const playedCounts: Record<string, number> = {}
  let totalPlayed = 0
  let lastPlayedId: MifenSoundId | null = null
  const lastPlayTimeById = new Map<string, number>()

  interface ActiveLoop {
    timerId: number | null
    stopCurrent: (() => void) | null
    loopGain: GainNode
  }
  const activeLoops = new Map<MifenLoopId, ActiveLoop>()

  function recordPlayStat(id: MifenSoundId): void {
    playedCounts[id] = (playedCounts[id] ?? 0) + 1
    totalPlayed += 1
    lastPlayedId = id
  }

  function ensureContext(): AudioContext | null {
    if (disposed || muted) return null
    if (!ctx) {
      ctx = existingCityAudio()
      if (!ctx) return null
      try {
        const chain = createSafeMasterChain(ctx, volume)
        masterInput = chain.input
        masterGain = chain.master
        distanceGainNode = ctx.createGain()
        distanceGainNode.gain.value = distanceGain
        distanceGainNode.connect(masterInput)
        noiseBuf = createPinkNoiseBuffer(ctx, 2.4)
      } catch {
        ctx = null
        return null
      }
    }
    if (ctx.state === 'suspended') {
      try {
        void resumeCityAudio(ctx)
      } catch {
        // 自动播放策略未激活，等待用户交互手势
      }
    }
    unlocked = ctx.state === 'running'
    return unlocked ? ctx : null
  }

  function isTabHidden(): boolean {
    return typeof document !== 'undefined' && Boolean(document.hidden)
  }

  function onGestureUnlock(): void {
    if (disposed || isTabHidden()) return
    ensureContext()
  }

  function onFocusLost(): void {
    stopAllLoops()
  }

  function onVisibilityChange(): void {
    if (isTabHidden()) stopAllLoops()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', onGestureUnlock, { passive: true })
    window.addEventListener('keydown', onGestureUnlock, { passive: true })
    window.addEventListener('blur', onFocusLost)
    window.addEventListener('pagehide', onFocusLost)
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  function unlock(): boolean {
    return Boolean(ensureContext())
  }

  function play(id: MifenSoundId, playOpts?: { volume?: number }): boolean {
    if (disposed || distanceGain <= 0 || isTabHidden()) return false
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const prevMs = lastPlayTimeById.get(id) ?? -Infinity
    const minGapMs = id === 'story_blip_uncle' || id === 'story_blip_player' ? 45 : 65
    if (nowMs - prevMs < minGapMs) return false
    lastPlayTimeById.set(id, nowMs)

    recordPlayStat(id)
    if (muted) return false

    const ac = ensureContext()
    const dest = distanceGainNode ?? masterInput
    if (!ac || !dest || !noiseBuf) return false

    scheduleSoundVoice(ac, dest, noiseBuf, id, ac.currentTime, playOpts?.volume ?? 1)
    return true
  }

  function playBlip(speaker: 'uncle' | 'player'): boolean {
    return play(speaker === 'uncle' ? 'story_blip_uncle' : 'story_blip_player')
  }

  function startLoop(id: MifenLoopId): boolean {
    if (disposed || muted || distanceGain <= 0 || isTabHidden()) return false
    if (activeLoops.has(id)) return true
    const ac = ensureContext()
    const dest = distanceGainNode ?? masterInput
    if (!ac || !dest || !noiseBuf) return false

    const loopGain = ac.createGain()
    loopGain.gain.setValueAtTime(0.0001, ac.currentTime)
    loopGain.gain.linearRampToValueAtTime(1, ac.currentTime + 0.08)
    loopGain.connect(dest)

    const spec = SOUND_CATALOG[id]
    const cycleMs = Math.max(400, Math.round((spec.durationSec - 0.14) * 1000))

    const runCycle = (entry: ActiveLoop) => {
      if (disposed || !activeLoops.has(id) || !ac || !noiseBuf) return
      const res = scheduleSoundVoice(ac, loopGain, noiseBuf, id, ac.currentTime, 1)
      entry.stopCurrent = res.stop
    }

    const entry: ActiveLoop = { timerId: null, stopCurrent: null, loopGain }
    activeLoops.set(id, entry)
    recordPlayStat(id)
    runCycle(entry)
    if (typeof window !== 'undefined') {
      entry.timerId = window.setInterval(() => runCycle(entry), cycleMs)
    }
    return true
  }

  function stopLoop(id: MifenLoopId): void {
    const entry = activeLoops.get(id)
    if (!entry) return
    activeLoops.delete(id)
    if (entry.timerId !== null && typeof window !== 'undefined') {
      window.clearInterval(entry.timerId)
    }
    if (ctx) {
      const now = ctx.currentTime
      entry.loopGain.gain.cancelScheduledValues(now)
      entry.loopGain.gain.setValueAtTime(entry.loopGain.gain.value, now)
      entry.loopGain.gain.linearRampToValueAtTime(0.0001, now + 0.06)
    }
    try {
      entry.stopCurrent?.()
    } catch {
      // ignore
    }
    try {
      entry.loopGain.disconnect()
    } catch {
      // ignore
    }
  }

  function stopAllLoops(): void {
    for (const id of Array.from(activeLoops.keys())) {
      stopLoop(id)
    }
  }

  return {
    unlock,
    play,
    playBlip,
    startLoop,
    stopLoop,
    stopAllLoops,
    setBoiling(active: boolean) {
      if (active) startLoop('boil_bubbling')
      else stopLoop('boil_bubbling')
    },
    setPouringBrine(active: boolean) {
      if (active) startLoop('brine_pour')
      else stopLoop('brine_pour')
    },
    setListenerDistance(meters: number) {
      const nextDist = typeof meters === 'number' && Number.isFinite(meters) && meters >= 0 ? meters : MIFEN_AUDIO_MAX_DISTANCE_M
      listenerDistance = nextDist
      distanceGain = computeMifenDistanceGain(nextDist)
      if (distanceGainNode && ctx) {
        const now = ctx.currentTime
        distanceGainNode.gain.cancelScheduledValues(now)
        distanceGainNode.gain.setValueAtTime(distanceGainNode.gain.value, now)
        distanceGainNode.gain.linearRampToValueAtTime(distanceGain, now + 0.04)
      }
      if (distanceGain <= 0) {
        stopAllLoops()
      }
    },
    syncCooking(visual: CookingVisualState | null | undefined) {
      if (disposed) return
      if (!visual || !visual.active || visual.stage === 'idle') {
        stopAllLoops()
        if (prevCooking?.active) {
          prevCooking = null
        }
        return
      }

      const prev = prevCooking
      const sameTicket = Boolean(prev && prev.ticketId === visual.ticketId)
      const ticketChanged = !sameTicket

      let boilLockNotified = sameTicket ? prev!.boilLockNotified : false
      let noodlesPouredNotified = sameTicket ? prev!.noodlesPouredNotified : false
      let meatPlateNotified = sameTicket ? prev!.meatPlateNotified : false
      let servedNotified = sameTicket ? prev!.servedNotified : false

      if (visual.panelOpen && !isTabHidden() && distanceGain > 0) {
        // 1) 煮锅入锅下粉声
        const enteredBoil = (ticketChanged || prev!.stage !== 'boil') && visual.stage === 'boil' && visual.boil.active && !visual.boil.done
        const dipTriggered = visual.boil.dipPhase > 0.05 && (!sameTicket || prev!.dipPhase <= 0.05)
        if (enteredBoil || dipTriggered) {
          play('boil_dip')
        }

        // 2) 竹笊篱提篱锁锅 / 火候判定
        const drainStarted = visual.boil.drainProgress > 0 && (!sameTicket || prev!.drainProgress <= 0)
        const boilJustDone = visual.boil.done && (!sameTicket || !prev!.boilDone)
        if (!boilLockNotified && (drainStarted || boilJustDone)) {
          boilLockNotified = true
          play(visual.boil.quality === 'miss' ? 'boil_lock_miss' : 'boil_lock_perfect')
        }

        // 3) 沥干倒碗 / 转去肉台
        const noodlesAdded = visual.bowl.hasNoodles && (!sameTicket || !prev!.hasNoodles)
        if (!noodlesPouredNotified && noodlesAdded && visual.stage !== 'boil') {
          noodlesPouredNotified = true
          play('meat_plate')
        }

        // 4) 肉台刀剁码配菜
        const chopsNow = visual.meat.chopCount
        const meatsNow = visual.meat.addedMeats.length
        if (
          visual.stage === 'meat' &&
          ((chopsNow > (sameTicket ? prev!.chopCount : 0)) || (meatsNow > (sameTicket ? prev!.addedMeatsCount : 0)))
        ) {
          play('meat_chop')
        }

        // 5) 肉台码齐装碗，前往前台
        const meatCompleted = (visual.meat.done && (!sameTicket || !prev!.meatDone)) || (sameTicket && prev!.stage === 'meat' && visual.stage === 'carry_to_counter')
        if (!meatPlateNotified && meatCompleted) {
          meatPlateNotified = true
          play('meat_plate')
        }

        // 6) 前台淋卤止注与辣油加料
        const stoppedPour = sameTicket && prev!.pouring && !visual.counter.pouring && visual.stage === 'counter' && visual.counter.brineLevel > 0.01
        if (stoppedPour) {
          play('brine_stop')
        }
        const chiliNow = Boolean(visual.counter.chiliOil || visual.bowl.chiliOil)
        if (chiliNow && (!sameTicket || !prev!.chiliOil)) {
          play('condiment_add')
        }

        // 7) 端碗出餐
        const enteredServing = visual.stage === 'serving' && (!sameTicket || prev!.stage !== 'serving')
        const servePulsed = visual.counter.servePulse > 0.05 && (!sameTicket || prev!.servePulse <= 0.05)
        if (!servedNotified && (enteredServing || servePulsed)) {
          servedNotified = true
          play('serve_complete')
        }
      }

      // 连续循环声严格受面板开关、工位阶段、距离阈值（< 12m）、静音与前后台控制
      const canRunLoop = visual.panelOpen && distanceGain > 0 && !muted && !isTabHidden()
      if (canRunLoop && visual.stage === 'boil' && visual.boil.active && !visual.boil.done) {
        startLoop('boil_bubbling')
      } else {
        stopLoop('boil_bubbling')
      }

      if (canRunLoop && visual.stage === 'counter' && visual.counter.pouring) {
        startLoop('brine_pour')
      } else {
        stopLoop('brine_pour')
      }

      prevCooking = {
        active: visual.active,
        ticketId: visual.ticketId,
        stage: visual.stage,
        panelOpen: visual.panelOpen,
        boilDone: visual.boil.done,
        dipPhase: visual.boil.dipPhase,
        drainProgress: visual.boil.drainProgress,
        hasNoodles: visual.bowl.hasNoodles,
        meatDone: visual.meat.done,
        chopCount: visual.meat.chopCount,
        addedMeatsCount: visual.meat.addedMeats.length,
        pouring: visual.counter.pouring,
        chiliOil: Boolean(visual.counter.chiliOil || visual.bowl.chiliOil),
        servePulse: visual.counter.servePulse,
        boilLockNotified,
        noodlesPouredNotified,
        meatPlateNotified,
        servedNotified,
      }
    },
    setMuted(nextMuted: boolean) {
      muted = Boolean(nextMuted)
      if (muted) stopAllLoops()
    },
    isMuted: () => muted,
    setVolume(nextVol: number) {
      if (!Number.isFinite(nextVol)) return
      volume = Math.max(0, Math.min(1, nextVol))
      if (masterGain && ctx) {
        masterGain.gain.setValueAtTime(volume, ctx.currentTime)
      }
    },
    getCatalog: () => SOUND_CATALOG,
    getStats: (): MifenAudioStats => ({
      supported: audioCtor() !== null,
      unlocked,
      muted,
      volume,
      listenerDistance,
      distanceGain,
      playedCounts: { ...playedCounts },
      totalPlayed,
      lastPlayedId,
      activeLoops: Array.from(activeLoops.keys()),
    }),
    dispose() {
      if (disposed) return
      disposed = true
      stopAllLoops()
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', onGestureUnlock)
        window.removeEventListener('keydown', onGestureUnlock)
        window.removeEventListener('blur', onFocusLost)
        window.removeEventListener('pagehide', onFocusLost)
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
      if (ctx) {
        distanceGainNode?.disconnect()
        masterInput?.disconnect()
        masterGain?.disconnect()
        ctx = null
        distanceGainNode = null
        masterInput = null
        masterGain = null
        noiseBuf = null
      }
    },
  }
}
