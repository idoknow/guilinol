/**
 * 饮品吸管吸吮与封膜程序化 Web Audio 音效（零外部音频资产，同步全局静音设置）。
 * - 首次封膜穿刺：清脆热封膜弹响（straw_poke）
 * - 长按饮用循环：带通气流声 + 间歇细微气泡音 + 见底微咕噜声，松手/切后台瞬时淡出停止
 */

const RIDE_SOUND_STORAGE_KEY = 'glol.rideSoundMuted'
const RIDE_SOUND_EVENT = 'glol:ride-sound'
export const DRINK_LOW_ENERGY_THRESHOLD = 0.18

function readMutedPref(): boolean {
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

function makeNoiseBuffer(ctx: AudioContext, seconds = 1.4): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  let prev = 0
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1
    prev = prev * 0.72 + white * 0.28
    data[i] = prev
  }
  return buf
}

export interface DrinkStrawAudioStats {
  supported: boolean
  muted: boolean
  active: boolean
  pokeCount: number
  drawPulseCount: number
  bubbleCount: number
  lowWarningCount: number
  completeCount: number
}

export interface DrinkStrawAudioController {
  unlock(): boolean
  triggerStrawPoke(): boolean
  setDrinking(active: boolean, fillRatio?: number): void
  triggerLowWarning(): boolean
  triggerComplete(): boolean
  setMuted(muted: boolean): void
  isMuted(): boolean
  getStats(): DrinkStrawAudioStats
  dispose(): void
}

export function createDrinkStrawAudio(opts?: { muted?: boolean; volume?: number }): DrinkStrawAudioController {
  const volume =
    typeof opts?.volume === 'number' && Number.isFinite(opts.volume) ? Math.max(0, Math.min(1, opts.volume)) : 0.75
  let muted = typeof opts?.muted === 'boolean' ? opts.muted : readMutedPref()
  let ctx: AudioContext | null = null
  let noiseBuf: AudioBuffer | null = null
  let masterGain: GainNode | null = null

  let loopNoiseSrc: AudioBufferSourceNode | null = null
  let loopGain: GainNode | null = null
  let loopFilter: BiquadFilterNode | null = null
  let bubbleTimer: ReturnType<typeof setInterval> | null = null

  let active = false
  let currentFill = 1
  let lowWarnedForCup = false
  let disposed = false
  let pokeCount = 0
  let drawPulseCount = 0
  let bubbleCount = 0
  let lowWarningCount = 0
  let completeCount = 0

  function isDocHidden(): boolean {
    return typeof document !== 'undefined' && Boolean(document.hidden)
  }

  function ensureAudio(): AudioContext | null {
    if (disposed || muted || isDocHidden()) return null
    if (!ctx) {
      const Ctor = getAudioContextCtor()
      if (!Ctor) return null
      try {
        ctx = new Ctor()
        masterGain = ctx.createGain()
        masterGain.gain.value = volume
        masterGain.connect(ctx.destination)
        noiseBuf = makeNoiseBuffer(ctx)
      } catch {
        ctx = null
        return null
      }
    }
    if (ctx.state === 'suspended') {
      try {
        void ctx.resume()
      } catch {
        // ignore gesture requirement errors
      }
    }
    return ctx.state === 'running' ? ctx : null
  }

  function scheduleBubble(lowFluid: boolean): void {
    bubbleCount += 1
    const ac = ensureAudio()
    if (!ac || !masterGain) return
    const t = ac.currentTime
    const osc = ac.createOscillator()
    const g = ac.createGain()
    osc.type = 'sine'
    const baseFreq = lowFluid ? 520 + Math.random() * 240 : 720 + Math.random() * 260
    osc.frequency.setValueAtTime(baseFreq, t)
    osc.frequency.exponentialRampToValueAtTime(baseFreq * (lowFluid ? 1.75 : 1.45), t + 0.065)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(lowFluid ? 0.14 : 0.09, t + 0.014)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075)
    osc.connect(g)
    g.connect(masterGain)
    osc.start(t)
    osc.stop(t + 0.08)
  }

  function stopLoop(): void {
    active = false
    if (bubbleTimer !== null) {
      clearInterval(bubbleTimer)
      bubbleTimer = null
    }
    if (loopGain && ctx) {
      const t = ctx.currentTime
      try {
        loopGain.gain.cancelScheduledValues(t)
        loopGain.gain.setTargetAtTime(0.0001, t, 0.015)
      } catch {
        // ignore
      }
    }
    if (loopNoiseSrc) {
      const src = loopNoiseSrc
      loopNoiseSrc = null
      try {
        src.stop(ctx ? ctx.currentTime + 0.045 : 0)
      } catch {
        // ignore
      }
    }
    loopGain = null
    loopFilter = null
  }

  function startLoop(): void {
    if (active || disposed) return
    active = true
    drawPulseCount += 1

    const ac = ensureAudio()
    if (ac && masterGain && noiseBuf) {
      const t = ac.currentTime
      const src = ac.createBufferSource()
      src.buffer = noiseBuf
      src.loop = true

      const filter = ac.createBiquadFilter()
      filter.type = 'bandpass'
      filter.Q.value = currentFill <= DRINK_LOW_ENERGY_THRESHOLD ? 3.6 : 2.5
      filter.frequency.setValueAtTime(currentFill <= DRINK_LOW_ENERGY_THRESHOLD ? 2250 : 1650, t)

      const gain = ac.createGain()
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.linearRampToValueAtTime(currentFill <= DRINK_LOW_ENERGY_THRESHOLD ? 0.16 : 0.11, t + 0.14)

      src.connect(filter)
      filter.connect(gain)
      gain.connect(masterGain)
      src.start(t)

      loopNoiseSrc = src
      loopFilter = filter
      loopGain = gain
    }

    bubbleTimer = setInterval(() => {
      if (!active || disposed || muted || isDocHidden()) return
      const lowFluid = currentFill <= DRINK_LOW_ENERGY_THRESHOLD
      scheduleBubble(lowFluid)
      if (loopFilter && ctx) {
        const freq = lowFluid ? 2250 + Math.random() * 420 : 1550 + Math.random() * 320
        loopFilter.frequency.setTargetAtTime(freq, ctx.currentTime, 0.03)
      }
    }, currentFill <= DRINK_LOW_ENERGY_THRESHOLD ? 115 : 150)
    ;(bubbleTimer as unknown as { unref?: () => void }).unref?.()
  }

  const onRideSound = (ev: Event) => {
    const detail = (ev as CustomEvent<{ muted?: boolean }>).detail
    muted = typeof detail?.muted === 'boolean' ? detail.muted : readMutedPref()
    if (muted) stopLoop()
  }

  const onVisibility = () => {
    if (isDocHidden()) stopLoop()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener(RIDE_SOUND_EVENT, onRideSound)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
  }

  return {
    unlock: () => Boolean(ensureAudio()),

    triggerStrawPoke() {
      if (disposed) return false
      pokeCount += 1
      const ac = ensureAudio()
      if (!ac || !masterGain) return false
      const t = ac.currentTime
      const osc = ac.createOscillator()
      const g = ac.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(440, t)
      osc.frequency.exponentialRampToValueAtTime(175, t + 0.085)
      g.gain.setValueAtTime(0.001, t)
      g.gain.linearRampToValueAtTime(0.22, t + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.095)
      osc.connect(g)
      g.connect(masterGain)
      osc.start(t)
      osc.stop(t + 0.1)
      return true
    },

    triggerLowWarning() {
      if (disposed) return false
      lowWarningCount += 1
      const ac = ensureAudio()
      if (!ac || !masterGain) return false
      const t = ac.currentTime
      const osc = ac.createOscillator()
      const g = ac.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1180, t)
      osc.frequency.exponentialRampToValueAtTime(720, t + 0.085)
      osc.frequency.setValueAtTime(1340, t + 0.105)
      osc.frequency.exponentialRampToValueAtTime(860, t + 0.185)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(0.14, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
      g.gain.linearRampToValueAtTime(0.11, t + 0.11)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19)
      osc.connect(g)
      g.connect(masterGain)
      osc.start(t)
      osc.stop(t + 0.2)
      return true
    },

    setDrinking(nextActive, fillRatio = 1) {
      currentFill = Math.max(0, Math.min(1, Number.isFinite(fillRatio) ? fillRatio : 1))
      if (currentFill > 0.9) {
        lowWarnedForCup = false
      }
      if (nextActive && !disposed && !isDocHidden()) {
        if (!active) startLoop()
        if (currentFill > 0.002 && currentFill <= DRINK_LOW_ENERGY_THRESHOLD && !lowWarnedForCup) {
          lowWarnedForCup = true
          this.triggerLowWarning()
        }
      } else {
        stopLoop()
      }
    },

    triggerComplete() {
      if (disposed) return false
      stopLoop()
      lowWarnedForCup = false
      completeCount += 1
      const ac = ensureAudio()
      if (!ac || !masterGain) return false
      const t = ac.currentTime
      const osc = ac.createOscillator()
      const g = ac.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(980, t)
      osc.frequency.exponentialRampToValueAtTime(520, t + 0.11)
      g.gain.setValueAtTime(0.001, t)
      g.gain.linearRampToValueAtTime(0.14, t + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
      osc.connect(g)
      g.connect(masterGain)
      osc.start(t)
      osc.stop(t + 0.13)
      return true
    },

    setMuted(nextMuted) {
      muted = Boolean(nextMuted)
      if (muted) stopLoop()
    },

    isMuted: () => muted,

    getStats: () => ({
      supported: getAudioContextCtor() !== null,
      muted,
      active,
      pokeCount,
      drawPulseCount,
      bubbleCount,
      lowWarningCount,
      completeCount,
    }),

    dispose() {
      if (disposed) return
      disposed = true
      stopLoop()
      if (typeof window !== 'undefined') {
        window.removeEventListener(RIDE_SOUND_EVENT, onRideSound)
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
      if (ctx) {
        const closing = ctx
        ctx = null
        masterGain = null
        noiseBuf = null
        void closing.close().catch(() => {})
      }
    },
  }
}
