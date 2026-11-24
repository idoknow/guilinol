import { DRINK_SOUND_CATALOG, type DrinkSoundId, type DrinkSoundSpec } from './catalog.ts'
import { createDrinkMasterChain, createDrinkNoiseBuffer, scheduleDrinkSound } from './synth.ts'

export { DRINK_SOUND_CATALOG, DRINK_SOUND_IDS, type DrinkSoundCategory, type DrinkSoundId, type DrinkSoundSpec } from './catalog.ts'
export {
  renderDrinkSoundOffline,
  renderAllDrinkSoundsOffline,
  encodeWavMono16,
  type OfflineDrinkAudioReport,
} from './offline.ts'

const RIDE_SOUND_STORAGE_KEY = 'glol.rideSoundMuted'
const RIDE_SOUND_EVENT = 'glol:ride-sound'

function readSharedSoundMuted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(RIDE_SOUND_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export type DrinksEquipmentSoundAction =
  | 'ice_cream_dispense'
  | 'tea_shake'
  | 'cup_seal'
  | 'fruit_pour'
  | 'ice_scoop'
  | 'label_apply'

export const EQUIPMENT_ACTION_SOUND_MAP: Readonly<Record<DrinksEquipmentSoundAction, DrinkSoundId>> = {
  ice_cream_dispense: 'ice_cream_dispense',
  tea_shake: 'shaker_shake',
  cup_seal: 'cup_seal',
  fruit_pour: 'fruit_pour',
  ice_scoop: 'ice_scoop',
  label_apply: 'label_apply',
}

export interface DrinksAudioStats {
  supported: boolean
  unlocked: boolean
  muted: boolean
  volume: number
  playedCounts: Record<string, number>
  totalPlayed: number
  lastPlayedId: DrinkSoundId | null
}

export interface DrinksAudioController {
  unlock: () => boolean
  play: (id: DrinkSoundId, opts?: { volume?: number }) => boolean
  playEquipmentAction: (action: DrinksEquipmentSoundAction, opts?: { volume?: number }) => boolean
  syncEquipmentProgress: (
    action: DrinksEquipmentSoundAction,
    progress: number,
    prevProgress?: number,
  ) => boolean
  playOrderConfirm: () => boolean
  playCupReady: () => boolean
  playSip: () => boolean
  setMuted: (muted: boolean) => void
  isMuted: () => boolean
  setVolume: (vol: number) => void
  getCatalog: () => Readonly<Record<DrinkSoundId, DrinkSoundSpec>>
  getStats: () => DrinksAudioStats
  dispose: () => void
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/**
 * 冷饮店 · 程序化 Web Audio 音效控制器
 *
 * 自动同步宿主 `walk/ride-sound-pref` (`glol:ride-sound` / `glol.rideSoundMuted`)，
 * 零外部音频文件依赖，含手势解锁、限幅保护与切后台防误响。
 */
export function createDrinksAudio(opts?: { muted?: boolean; volume?: number; syncRidePref?: boolean }): DrinksAudioController {
  const syncRidePref = opts?.syncRidePref ?? true
  let ctx: AudioContext | null = null
  let masterInput: GainNode | null = null
  let masterGain: GainNode | null = null
  let noiseBuf: AudioBuffer | null = null
  let muted = typeof opts?.muted === 'boolean' ? opts.muted : syncRidePref ? readSharedSoundMuted() : false
  let volume =
    typeof opts?.volume === 'number' && Number.isFinite(opts.volume) ? Math.max(0, Math.min(1, opts.volume)) : 0.84
  let unlocked = false
  let disposed = false

  const playedCounts: Record<string, number> = {}
  let totalPlayed = 0
  let lastPlayedId: DrinkSoundId | null = null
  const lastPlayMsById = new Map<string, number>()

  function isHidden(): boolean {
    return typeof document !== 'undefined' && Boolean(document.hidden)
  }

  function ensureContext(): AudioContext | null {
    if (disposed || muted || isHidden()) return null
    if (!ctx) {
      const Ctor = getAudioContextCtor()
      if (!Ctor) return null
      try {
        ctx = new Ctor()
        const chain = createDrinkMasterChain(ctx, volume)
        masterInput = chain.input
        masterGain = chain.master
        noiseBuf = createDrinkNoiseBuffer(ctx, 1.8)
      } catch {
        ctx = null
        return null
      }
    }
    if (ctx.state === 'suspended') {
      try {
        void ctx.resume()
      } catch {
        // 等待用户手势激活
      }
    }
    unlocked = ctx.state === 'running'
    return unlocked ? ctx : null
  }

  function onGestureUnlock(): void {
    if (!disposed && !isHidden()) ensureContext()
  }

  function onRideSoundEvent(ev: Event): void {
    if (!syncRidePref || disposed) return
    const detail = (ev as CustomEvent<{ muted?: boolean }>).detail
    muted = typeof detail?.muted === 'boolean' ? detail.muted : readSharedSoundMuted()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', onGestureUnlock, { passive: true })
    window.addEventListener('keydown', onGestureUnlock, { passive: true })
    if (syncRidePref) {
      window.addEventListener(RIDE_SOUND_EVENT, onRideSoundEvent)
    }
  }

  function play(id: DrinkSoundId, playOpts?: { volume?: number }): boolean {
    if (disposed || isHidden()) return false
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const prevMs = lastPlayMsById.get(id) ?? -Infinity
    if (nowMs - prevMs < 45) return false
    lastPlayMsById.set(id, nowMs)

    playedCounts[id] = (playedCounts[id] ?? 0) + 1
    totalPlayed += 1
    lastPlayedId = id
    if (muted) return false

    const ac = ensureContext()
    if (!ac || !masterInput || !noiseBuf) return false
    scheduleDrinkSound(ac, masterInput, noiseBuf, id, ac.currentTime, playOpts?.volume ?? 1)
    return true
  }

  return {
    unlock: () => Boolean(ensureContext()),
    play,
    playEquipmentAction: (action: DrinksEquipmentSoundAction, playOpts?: { volume?: number }) =>
      play(EQUIPMENT_ACTION_SOUND_MAP[action], playOpts),
    syncEquipmentProgress(action: DrinksEquipmentSoundAction, progress: number, prevProgress = 0): boolean {
      const p = Number.isFinite(progress) ? progress : 0
      const prev = Number.isFinite(prevProgress) ? prevProgress : 0
      // 外部 0..1 进度刚启动（越过 0.04 门槛）即触发对应设备动作声效
      if (prev < 0.04 && p >= 0.04 && p < 0.99) {
        return play(EQUIPMENT_ACTION_SOUND_MAP[action])
      }
      return false
    },
    playOrderConfirm: () => play('order_chime'),
    playCupReady: () => play('call_number'),
    playSip: () => play('drink_sip'),
    setMuted(nextMuted: boolean) {
      muted = Boolean(nextMuted)
    },
    isMuted: () => muted,
    setVolume(nextVol: number) {
      if (!Number.isFinite(nextVol)) return
      volume = Math.max(0, Math.min(1, nextVol))
      if (masterGain && ctx) {
        masterGain.gain.setValueAtTime(volume, ctx.currentTime)
      }
    },
    getCatalog: () => DRINK_SOUND_CATALOG,
    getStats: (): DrinksAudioStats => ({
      supported: getAudioContextCtor() !== null,
      unlocked,
      muted,
      volume,
      playedCounts: { ...playedCounts },
      totalPlayed,
      lastPlayedId,
    }),
    dispose() {
      if (disposed) return
      disposed = true
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', onGestureUnlock)
        window.removeEventListener('keydown', onGestureUnlock)
        if (syncRidePref) {
          window.removeEventListener(RIDE_SOUND_EVENT, onRideSoundEvent)
        }
      }
      if (ctx) {
        const closing = ctx
        ctx = null
        masterInput = null
        masterGain = null
        noiseBuf = null
        void closing.close().catch(() => {})
      }
    },
  }
}
