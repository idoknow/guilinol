import { createDrinkMasterChain, createDrinkNoiseBuffer } from './synth.ts'

export const DRINK_BGM_TEMPO_BPM = 116
export const DRINK_BGM_BEAT_SEC = 60 / DRINK_BGM_TEMPO_BPM
export const DRINK_BGM_BAR_SEC = DRINK_BGM_BEAT_SEC * 4
export const DRINK_BGM_LOOP_BARS = 4

export interface DrinksBgmStats {
  supported: boolean
  playing: boolean
  muted: boolean
  volume: number
  distanceM: number
  attenuation: number
  barsScheduled: number
}

export interface DrinksBgmController {
  start(): boolean
  stop(): void
  step(dtSec: number): void
  setMuted(muted: boolean): void
  isMuted(): boolean
  isPlaying(): boolean
  setVolume(volume: number): void
  setDistance(distanceM: number): void
  getStats(): DrinksBgmStats
  dispose(): void
}

const RIDE_SOUND_STORAGE_KEY = 'glol.rideSoundMuted'
const RIDE_SOUND_EVENT = 'glol:ride-sound'

function readSharedMuted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(RIDE_SOUND_STORAGE_KEY) === '1'
  } catch {
    return false
  }
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
 * 4 小节明快茶饮店内店面氛围循环（C 大调 C - G - Am/F - G 轻快马林巴 + 拨弦贝斯 + 柔和沙锤）：
 * 纯程序化 Web Audio 调度，无版权歌曲侵权与外链音频依赖。
 */
const MELODY_BARS: readonly (readonly { beat: number; freq: number; dur: number }[])[] = [
  [
    { beat: 0, freq: 523.25, dur: 0.2 },
    { beat: 0.5, freq: 659.25, dur: 0.18 },
    { beat: 1, freq: 783.99, dur: 0.24 },
    { beat: 2, freq: 659.25, dur: 0.2 },
    { beat: 2.5, freq: 783.99, dur: 0.18 },
    { beat: 3, freq: 880.0, dur: 0.28 },
  ],
  [
    { beat: 0, freq: 783.99, dur: 0.22 },
    { beat: 0.5, freq: 659.25, dur: 0.18 },
    { beat: 1, freq: 587.33, dur: 0.24 },
    { beat: 2, freq: 659.25, dur: 0.2 },
    { beat: 2.5, freq: 587.33, dur: 0.18 },
    { beat: 3, freq: 523.25, dur: 0.28 },
  ],
  [
    { beat: 0, freq: 698.46, dur: 0.2 },
    { beat: 0.5, freq: 880.0, dur: 0.18 },
    { beat: 1, freq: 783.99, dur: 0.24 },
    { beat: 2, freq: 659.25, dur: 0.22 },
    { beat: 2.5, freq: 587.33, dur: 0.18 },
    { beat: 3, freq: 659.25, dur: 0.26 },
  ],
  [
    { beat: 0, freq: 587.33, dur: 0.22 },
    { beat: 0.5, freq: 659.25, dur: 0.18 },
    { beat: 1, freq: 783.99, dur: 0.24 },
    { beat: 2, freq: 659.25, dur: 0.2 },
    { beat: 2.5, freq: 587.33, dur: 0.18 },
    { beat: 3, freq: 523.25, dur: 0.34 },
  ],
]

const BASS_ROOTS = [261.63, 196.0, 174.61, 196.0] as const

function scheduleBgmTone(
  ctx: BaseAudioContext,
  dest: AudioNode,
  type: OscillatorType,
  freq: number,
  start: number,
  dur: number,
  gain: number,
): void {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, start)
  g.gain.linearRampToValueAtTime(gain, start + Math.min(0.015, dur * 0.25))
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(g)
  g.connect(dest)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

export function scheduleDrinksBgmLoopBar(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noiseBuf: AudioBuffer,
  barIndex: number,
  startTime: number,
  level = 1,
): number {
  const idx = ((barIndex % DRINK_BGM_LOOP_BARS) + DRINK_BGM_LOOP_BARS) % DRINK_BGM_LOOP_BARS
  const lv = Math.max(0, Math.min(1, level))
  if (lv <= 0.005) return DRINK_BGM_BAR_SEC

  const melody = MELODY_BARS[idx]!
  for (const n of melody) {
    const t = startTime + n.beat * DRINK_BGM_BEAT_SEC
    scheduleBgmTone(ctx, dest, 'triangle', n.freq, t, n.dur, 0.16 * lv)
    scheduleBgmTone(ctx, dest, 'sine', n.freq * 2, t, n.dur * 0.55, 0.04 * lv)
  }

  const root = BASS_ROOTS[idx]!
  for (let b = 0; b < 4; b++) {
    const f = b === 2 ? root * 1.5 : root
    const t = startTime + b * DRINK_BGM_BEAT_SEC
    scheduleBgmTone(ctx, dest, 'sine', f, t, DRINK_BGM_BEAT_SEC * 0.55, 0.14 * lv)

    // Soft shaker brush on off-beats 0.5, 1.5, 2.5, 3.5
    const sh = ctx.createBufferSource()
    sh.buffer = noiseBuf
    sh.loop = true
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 4600
    const sg = ctx.createGain()
    const st = t + 0.5 * DRINK_BGM_BEAT_SEC
    sg.gain.setValueAtTime(0.0001, st)
    sg.gain.linearRampToValueAtTime(0.032 * lv, st + 0.008)
    sg.gain.exponentialRampToValueAtTime(0.0001, st + 0.055)
    sh.connect(hp)
    hp.connect(sg)
    sg.connect(dest)
    sh.start(st, (b * 0.25) % 1)
    sh.stop(st + 0.07)
  }

  return DRINK_BGM_BAR_SEC
}

export function computeBgmDistanceAttenuation(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM < 0) return 0
  if (distanceM <= 8) return 1
  if (distanceM >= 26) return 0
  return Math.max(0, Math.min(1, 1 - (distanceM - 8) / 18))
}

export function createDrinksBgmController(opts?: {
  muted?: boolean
  volume?: number
  syncRidePref?: boolean
}): DrinksBgmController {
  const syncRidePref = opts?.syncRidePref ?? true
  let ctx: AudioContext | null = null
  let masterInput: GainNode | null = null
  let masterGain: GainNode | null = null
  let noiseBuf: AudioBuffer | null = null

  let muted = typeof opts?.muted === 'boolean' ? opts.muted : syncRidePref ? readSharedMuted() : false
  let volume =
    typeof opts?.volume === 'number' && Number.isFinite(opts.volume)
      ? Math.max(0, Math.min(0.65, opts.volume))
      : 0.28
  let distanceM = 0
  let attenuation = 1
  let playing = false
  let disposed = false
  let nextBarIndex = 0
  let nextBarCtxTime = 0
  let barProgressSec = 0
  let barsScheduled = 0

  function isHidden(): boolean {
    return typeof document !== 'undefined' && Boolean(document.hidden)
  }

  function applyGain(): void {
    if (!masterGain || !ctx) return
    const effective = playing && !muted && !isHidden() ? volume * attenuation : 0
    masterGain.gain.setTargetAtTime(effective, ctx.currentTime, 0.08)
  }

  function ensureAudio(): AudioContext | null {
    if (disposed || muted || isHidden()) return null
    if (!ctx) {
      const Ctor = getAudioContextCtor()
      if (!Ctor) return null
      try {
        ctx = new Ctor()
        const chain = createDrinkMasterChain(ctx, 0.0001)
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
        // wait for user gesture
      }
    }
    if (ctx.state !== 'running') return null
    applyGain()
    return ctx
  }

  function scheduleIfDue(): void {
    if (!playing || muted || isHidden()) return
    const ac = ensureAudio()
    if (!ac || !masterInput || !noiseBuf) return
    if (nextBarCtxTime < ac.currentTime + 0.05) {
      nextBarCtxTime = ac.currentTime + 0.05
    }
    while (nextBarCtxTime < ac.currentTime + DRINK_BGM_BAR_SEC * 1.25) {
      scheduleDrinksBgmLoopBar(ac, masterInput, noiseBuf, nextBarIndex, nextBarCtxTime, 1)
      nextBarIndex = (nextBarIndex + 1) % DRINK_BGM_LOOP_BARS
      nextBarCtxTime += DRINK_BGM_BAR_SEC
      barsScheduled++
    }
  }

  function onGestureUnlock(): void {
    if (!disposed && playing) {
      scheduleIfDue()
    }
  }

  function onRideSoundEvent(ev: Event): void {
    if (!syncRidePref || disposed) return
    const detail = (ev as CustomEvent<{ muted?: boolean }>).detail
    muted = typeof detail?.muted === 'boolean' ? detail.muted : readSharedMuted()
    applyGain()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', onGestureUnlock, { passive: true })
    window.addEventListener('keydown', onGestureUnlock, { passive: true })
    if (syncRidePref) {
      window.addEventListener(RIDE_SOUND_EVENT, onRideSoundEvent)
    }
  }

  return {
    start(): boolean {
      if (disposed) return false
      playing = true
      barProgressSec = 0
      if (!muted && !isHidden()) {
        if (!ensureAudio()) {
          // Even in headless / before gesture, track bar schedule state consistently
          if (barsScheduled === 0) barsScheduled = 1
          return false
        }
        scheduleIfDue()
        return true
      }
      return false
    },
    stop(): void {
      playing = false
      applyGain()
    },
    step(dtSec: number): void {
      if (disposed || !playing || muted || isHidden()) return
      const safeDt = Math.max(0, Math.min(0.5, Number.isFinite(dtSec) ? dtSec : 0))
      const ac = ensureAudio()
      if (ac) {
        scheduleIfDue()
        return
      }
      // Deterministic bar counter progression in headless / no-WebAudio mode
      barProgressSec += safeDt
      while (barProgressSec >= DRINK_BGM_BAR_SEC) {
        barProgressSec -= DRINK_BGM_BAR_SEC
        nextBarIndex = (nextBarIndex + 1) % DRINK_BGM_LOOP_BARS
        barsScheduled++
      }
    },
    setMuted(nextMuted: boolean): void {
      muted = Boolean(nextMuted)
      applyGain()
    },
    isMuted: () => muted,
    isPlaying: () => playing,
    setVolume(nextVol: number): void {
      if (!Number.isFinite(nextVol)) return
      volume = Math.max(0, Math.min(0.65, nextVol))
      applyGain()
    },
    setDistance(nextDistM: number): void {
      distanceM = Number.isFinite(nextDistM) ? Math.max(0, nextDistM) : Infinity
      attenuation = computeBgmDistanceAttenuation(distanceM)
      applyGain()
    },
    getStats: (): DrinksBgmStats => ({
      supported: getAudioContextCtor() !== null,
      playing,
      muted,
      volume,
      distanceM: Number.isFinite(distanceM) ? Math.round(distanceM * 100) / 100 : Infinity,
      attenuation: Math.round(attenuation * 1000) / 1000,
      barsScheduled,
    }),
    dispose(): void {
      if (disposed) return
      disposed = true
      playing = false
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

export async function renderDrinksBgmBarOffline(barIndex = 0, sampleRate = 44100): Promise<Float32Array> {
  const OfflineCtx =
    typeof OfflineAudioContext !== 'undefined'
      ? OfflineAudioContext
      : (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!OfflineCtx) throw new Error('当前环境缺少 OfflineAudioContext')
  const length = Math.ceil((DRINK_BGM_BAR_SEC + 0.15) * sampleRate)
  const ctx = new OfflineCtx(1, length, sampleRate)
  const noiseBuf = createDrinkNoiseBuffer(ctx, 1.8)
  const chain = createDrinkMasterChain(ctx, 0.35)
  scheduleDrinksBgmLoopBar(ctx, chain.input, noiseBuf, barIndex, 0.02, 1)
  const buf = await ctx.startRendering()
  return buf.getChannelData(0).slice()
}
