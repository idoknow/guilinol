/**
 * Procedural WebAudio synthesizer for realistic electric scooter / e-bike & pedal bicycle feedback:
 * - Twin-tone 12V diaphragm electric horn & brass bicycle bell (hold-safe with clean release)
 * - Turn-signal flasher relay solenoid tick/tock synced to visual blink edges
 * - Power-on scooter boot chime, P-gear / kickstand lock clack, D1..S gear chirps & bicycle derailleur click
 * - Cornering critical-lean warning beep + tire-scrub whisper approaching mandatory fall angle
 * - Subtle speed/throttle hub motor whine (e-bike) / freewheel coast clicks (bicycle) & crash/pickup foley
 *
 * Pure WebAudio with zero external audio files and fail-safe autoplay gating.
 */

import {rideSoundMuted,masterVolume,VOLUME_EVENT} from './ride-sound-pref'
import {audioCtor,existingCityAudio,resumeCityAudio} from '../city-audio'

export type RideSoundKind = 'bike' | 'bicycle'
export type HeadlightSoundMode = 'off' | 'low' | 'high'

export interface EbikeAudioCounts {
  powerOn: number
  parkToggle: number
  gearShift: number
  lightSwitch: number
  turnTick: number
  turnTock: number
  hornOn: number
  leanWarn: number
  crashImpact: number
  pickup: number
  shopBuy: number
}

export interface EbikeAudioSnapshot {
  unlocked: boolean
  supported: boolean
  muted: boolean
  hornActive: boolean
  motorHumHz: number
  motorHumGain: number
  scrubGain: number
  leanWarnActive: boolean
  counts: EbikeAudioCounts
}

export interface EbikeAudioEngine {
  readonly unlocked: boolean
  readonly muted: boolean
  prepare: () => Promise<void>
  unlock: () => boolean
  setMuted: (muted: boolean) => void
  setHorn: (active: boolean, kind?: RideSoundKind) => void
  playPowerOn: (kind?: RideSoundKind) => void
  playParkToggle: (parked: boolean) => void
  playGearShift: (gear: number, kind?: RideSoundKind, label?: string) => void
  playLightSwitch: (mode: HeadlightSoundMode) => void
  playTurnRelay: (tickOn: boolean) => void
  playCrashImpact: (speedMs?: number) => void
  playPickupComplete: () => void
  playShopBuySuccess: () => void
  updateContinuous: (params: {
    active: boolean
    rideKind: RideSoundKind
    speed: number
    throttle: number
    braking: boolean
    parked: boolean
    leanRisk: number
    leanWarnThreshold?: number
    dt: number
  }) => void
  stopContinuous: () => void
  probe: () => EbikeAudioSnapshot
  dispose: () => void
}

/**
 * Master level and bus high-pass (IDOK-212: headphone players found the hub-motor hum
 * and low thuds fatiguing). Everything feeds `bus` → compressor → master.
 */
const MASTER_LEVEL = 0.45
const BUS_HIGHPASS_HZ = 120

function createNoiseBuffer(ctx: AudioContext, seconds = 1.2): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  // Slightly warm pink-ish noise instead of harsh digital white hiss
  let b0 = 0, b1 = 0, b2 = 0
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1
    b0 = 0.997 * b0 + white * 0.029
    b1 = 0.985 * b1 + white * 0.032
    b2 = 0.950 * b2 + white * 0.048
    data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + white * 0.16) * 1.4))
  }
  return buf
}

export function createEbikeAudioEngine(): EbikeAudioEngine {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let compressor: DynamicsCompressorNode | null = null
  let bus: BiquadFilterNode | null = null
  let noiseBuf: AudioBuffer | null = null
  let muted = rideSoundMuted()

  // Continuous horn voice (ebike twin-tone electric horn)
  let hornGain: GainNode | null = null
  let hornOscA: OscillatorNode | null = null
  let hornOscB: OscillatorNode | null = null
  let hornActive = false
  let hornKind: RideSoundKind = 'bike'
  let bicycleBellTimer = 0

  // Continuous hub motor hum & tire scrub voice
  let motorOscMain: OscillatorNode | null = null
  let motorOscHarm: OscillatorNode | null = null
  let motorFilter: BiquadFilterNode | null = null
  let motorGain: GainNode | null = null
  let scrubSrc: AudioBufferSourceNode | null = null
  let scrubFilter: BiquadFilterNode | null = null
  let scrubGainNode: GainNode | null = null

  let currentMotorHz = 0
  let currentMotorGain = 0
  let currentScrubGain = 0
  let leanWarnTimer = 0
  let leanWarnActive = false
  let coastClickTimer = 0
  let isDisposed = false

  const counts: EbikeAudioCounts = {
    powerOn: 0,
    parkToggle: 0,
    gearShift: 0,
    lightSwitch: 0,
    turnTick: 0,
    turnTock: 0,
    hornOn: 0,
    leanWarn: 0,
    crashImpact: 0,
    pickup: 0,
    shopBuy: 0,
  }

  function ensureContext(resume=true): AudioContext | null {
    if (isDisposed || muted) return null
    if (!ctx) {
      ctx=existingCityAudio()
      if(!ctx)return null
      try {
        compressor = ctx.createDynamicsCompressor()
        compressor.threshold.value = -16
        compressor.knee.value = 18
        compressor.ratio.value = 6
        compressor.attack.value = 0.004
        compressor.release.value = 0.14

        bus = ctx.createBiquadFilter()
        bus.type = 'highpass'
        bus.frequency.value = BUS_HIGHPASS_HZ
        bus.Q.value = 0.707
        bus.connect(compressor)

        master = ctx.createGain()
        master.gain.value = MASTER_LEVEL*masterVolume()
        compressor.connect(master)
        master.connect(ctx.destination)
        noiseBuf = createNoiseBuffer(ctx, 1.4)
      } catch {
        ctx = null
        return null
      }
    }
    if (resume && ctx.state === 'suspended') {
      try {
        void resumeCityAudio(ctx)
      } catch {
        // Autoplay gated until gesture
      }
    }
    return ctx.state === 'running' ? ctx : null
  }

  function ensureContinuousVoices(ac: AudioContext) {
    if (!bus || !noiseBuf) return
    if (!motorOscMain) {
      motorOscMain = ac.createOscillator()
      motorOscMain.type = 'sine'
      motorOscMain.frequency.value = 80

      motorOscHarm = ac.createOscillator()
      motorOscHarm.type = 'triangle'
      motorOscHarm.frequency.value = 160

      motorFilter = ac.createBiquadFilter()
      motorFilter.type = 'lowpass'
      motorFilter.frequency.value = 420
      motorFilter.Q.value = 1.2

      motorGain = ac.createGain()
      motorGain.gain.value = 0

      const harmGain = ac.createGain()
      harmGain.gain.value = 0.28

      motorOscMain.connect(motorFilter)
      motorOscHarm.connect(harmGain)
      harmGain.connect(motorFilter)
      motorFilter.connect(motorGain)
      motorGain.connect(bus)

      motorOscMain.start()
      motorOscHarm.start()
    }
    if (!scrubSrc) {
      scrubSrc = ac.createBufferSource()
      scrubSrc.buffer = noiseBuf
      scrubSrc.loop = true

      scrubFilter = ac.createBiquadFilter()
      scrubFilter.type = 'bandpass'
      scrubFilter.frequency.value = 950
      scrubFilter.Q.value = 1.6

      scrubGainNode = ac.createGain()
      scrubGainNode.gain.value = 0

      scrubSrc.connect(scrubFilter)
      scrubFilter.connect(scrubGainNode)
      scrubGainNode.connect(bus)
      scrubSrc.start()
    }
  }

  function toneBurst(
    freqStart: number,
    freqEnd: number,
    durationSec: number,
    peakGain: number,
    type: OscillatorType = 'sine',
    delaySec = 0,
    filterHz?: number,
  ) {
    const ac = ensureContext()
    if (!ac || !bus) return
    const t0 = ac.currentTime + delaySec
    const osc = ac.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(Math.max(25, freqStart), t0)
    if (Math.abs(freqEnd - freqStart) > 0.5) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(25, freqEnd), t0 + durationSec)
    }

    const gain = ac.createGain()
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.linearRampToValueAtTime(peakGain, t0 + Math.min(0.008, durationSec * 0.25))
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec)

    if (filterHz) {
      const filter = ac.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = filterHz
      osc.connect(filter)
      filter.connect(gain)
    } else {
      osc.connect(gain)
    }
    gain.connect(bus)
    osc.start(t0)
    osc.stop(t0 + durationSec + 0.02)
  }

  function noiseBurst(centerHz: number, q: number, durationSec: number, peakGain: number, delaySec = 0) {
    const ac = ensureContext()
    if (!ac || !bus || !noiseBuf) return
    const t0 = ac.currentTime + delaySec
    const src = ac.createBufferSource()
    src.buffer = noiseBuf

    const filter = ac.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(centerHz, t0)
    filter.Q.value = q

    const gain = ac.createGain()
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec)

    src.connect(filter)
    filter.connect(gain)
    gain.connect(bus)
    src.start(t0, Math.random() * 0.4, durationSec + 0.02)
  }

  function strikeBicycleBell() {
    toneBurst(1640, 1630, 0.24, 0.14, 'sine', 0)
    toneBurst(3280, 3260, 0.17, 0.06, 'sine', 0)
    toneBurst(1640, 1630, 0.22, 0.11, 'sine', 0.095)
    toneBurst(3280, 3260, 0.15, 0.045, 'sine', 0.095)
    noiseBurst(3800, 3.2, 0.015, 0.05, 0)
  }

  function startElectricHorn() {
    const ac = ensureContext()
    if (!ac || !bus || hornOscA) return
    const t = ac.currentTime
    hornGain = ac.createGain()
    hornGain.gain.setValueAtTime(0.0001, t)
    hornGain.gain.linearRampToValueAtTime(0.12, t + 0.014)

    const band = ac.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 1280
    band.Q.value = 1.65

    const low = ac.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 3100

    // Classic Chinese e-scooter twin-tone disc horn (~425Hz + ~512Hz minor-3rd metallic rasp)
    hornOscA = ac.createOscillator()
    hornOscA.type = 'sawtooth'
    hornOscA.frequency.setValueAtTime(426, t)

    hornOscB = ac.createOscillator()
    hornOscB.type = 'square'
    hornOscB.frequency.setValueAtTime(514, t)

    const bGain = ac.createGain()
    bGain.gain.value = 0.72

    hornOscA.connect(band)
    hornOscB.connect(bGain)
    bGain.connect(band)
    band.connect(low)
    low.connect(hornGain)
    hornGain.connect(bus)

    hornOscA.start(t)
    hornOscB.start(t)
    // Diaphragm transient pop
    noiseBurst(1650, 2.4, 0.025, 0.07)
  }

  function stopElectricHorn() {
    if (!hornGain || !ctx) {
      hornOscA = hornOscB = null
      hornGain = null
      return
    }
    const t = ctx.currentTime
    const g = hornGain
    const oa = hornOscA
    const ob = hornOscB
    hornGain = null
    hornOscA = null
    hornOscB = null
    try {
      g.gain.cancelScheduledValues(t)
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.032)
      oa?.stop(t + 0.045)
      ob?.stop(t + 0.045)
    } catch {
      // ignore closed context
    }
  }

  function unlock() {
    if (isDisposed || muted) return false
    const ac = ensureContext()
    return !!ac
  }

  function setMuted(next: boolean) {
    muted = next
    if (muted) {
      setHorn(false)
      stopContinuous()
    }
    if (master && ctx) {
      master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL*masterVolume(), ctx.currentTime, 0.02)
    }
    // Unmuting from the HUD is a user gesture: open the context now so sound resumes mid-ride.
    if (!muted) unlock()
  }

  function setHorn(active: boolean, kind: RideSoundKind = 'bike') {
    hornKind = kind
    if (active === hornActive) return
    hornActive = active
    if (active) {
      counts.hornOn++
      if (kind === 'bicycle') {
        bicycleBellTimer = 0.42
        strikeBicycleBell()
      } else {
        startElectricHorn()
      }
    } else {
      bicycleBellTimer = 0
      stopElectricHorn()
    }
  }

  function playPowerOn(kind: RideSoundKind = 'bike') {
    counts.powerOn++
    if(muted||isDisposed)return
    if(!ensureContext()){
      if(ctx)void resumeCityAudio(ctx).then(running=>{if(running&&!muted&&!isDisposed)powerOnChime(kind)})
      return
    }
    powerOnChime(kind)
  }

  function powerOnChime(kind:RideSoundKind){
    if (kind === 'bicycle') {
      // Soft metallic frame creak + saddle tap
      noiseBurst(900, 2.0, 0.03, 0.05)
      toneBurst(240, 180, 0.05, 0.04, 'triangle')
      return
    }
    // Scooter smart NFC / key ignition startup chime: C5 - E5 - G5 - C6 + relay click
    noiseBurst(2200, 3.0, 0.012, 0.06)
    toneBurst(523.25, 523.25, 0.075, 0.09, 'sine', 0.01, 2800)
    toneBurst(659.25, 659.25, 0.075, 0.09, 'sine', 0.065, 2800)
    toneBurst(783.99, 783.99, 0.085, 0.095, 'sine', 0.12, 3200)
    toneBurst(1046.5, 1046.5, 0.16, 0.11, 'triangle', 0.175, 3000)
  }

  function playParkToggle(parked: boolean) {
    counts.parkToggle++
    // Heavy steel kickstand spring clack + controller Park chirp
    toneBurst(parked ? 155 : 195, parked ? 68 : 95, 0.07, 0.12, 'triangle', 0, 750)
    noiseBurst(1350, 2.2, 0.028, 0.08, 0.005)
    if (parked) {
      toneBurst(680, 520, 0.08, 0.08, 'sine', 0.025)
    } else {
      toneBurst(587, 587, 0.055, 0.08, 'sine', 0.02)
      toneBurst(880, 880, 0.09, 0.09, 'sine', 0.075)
    }
  }

  function playGearShift(gear: number, kind: RideSoundKind = 'bike') {
    counts.gearShift++
    if (kind === 'bicycle') {
      // Crisp rear derailleur ratchet click
      noiseBurst(2800, 3.8, 0.018, 0.09)
      toneBurst(1180, 760, 0.024, 0.07, 'triangle')
      return
    }
    const pitches = [440, 523.25, 659.25, 783.99, 987.77]
    const freq = pitches[Math.max(0, Math.min(pitches.length - 1, Math.round(gear)))] ?? 659.25
    // Switch tactile pip + gear confirmation chirp
    noiseBurst(2600, 3.2, 0.01, 0.045)
    toneBurst(freq, freq * 1.03, 0.065, 0.095, 'triangle', 0.004, 2900)
  }

  function playLightSwitch(mode: HeadlightSoundMode) {
    counts.lightSwitch++
    // Handlebar rocker detent snap
    noiseBurst(mode === 'high' ? 2500 : 1900, 3.0, 0.014, 0.07)
    toneBurst(mode === 'high' ? 920 : mode === 'low' ? 740 : 480, mode === 'off' ? 320 : 880, 0.032, 0.06, 'triangle')
  }

  function playTurnRelay(tickOn: boolean) {
    if (tickOn) counts.turnTick++
    else counts.turnTock++
    if (tickOn) {
      noiseBurst(2450, 3.6, 0.014, 0.095)
      toneBurst(1160, 520, 0.018, 0.085, 'triangle', 0, 2600)
    } else {
      noiseBurst(1850, 3.2, 0.012, 0.075)
      toneBurst(890, 390, 0.016, 0.065, 'triangle', 0, 2100)
    }
  }

  function playCrashImpact(speedMs = 5) {
    counts.crashImpact++
    const strength = Math.min(1.3, Math.max(0.45, speedMs / 8))
    toneBurst(128, 38, 0.22, 0.15 * strength, 'triangle', 0, 520)
    noiseBurst(760, 1.1, 0.34, 0.18 * strength, 0.01)
    noiseBurst(2100, 1.8, 0.18, 0.11 * strength, 0.04)
  }

  function playPickupComplete() {
    counts.pickup++
    toneBurst(140, 210, 0.065, 0.10, 'triangle')
    noiseBurst(1600, 2.4, 0.025, 0.07, 0.01)
    toneBurst(587.33, 880, 0.09, 0.07, 'sine', 0.04)
  }

  function playShopBuySuccess() {
    counts.shopBuy++
    // Boutique checkout chime: crisp major triad arpeggio + warm register sparkle
    toneBurst(523.25, 523.25, 0.08, 0.10, 'triangle', 0, 2800)
    toneBurst(659.25, 659.25, 0.09, 0.10, 'triangle', 0.065, 3200)
    toneBurst(783.99, 1046.5, 0.16, 0.11, 'sine', 0.13, 4200)
  }

  function updateContinuous(params: {
    active: boolean
    rideKind: RideSoundKind
    speed: number
    throttle: number
    braking: boolean
    parked: boolean
    leanRisk: number
    leanWarnThreshold?: number
    dt: number
  }) {
    const cdt = Math.min(0.12, Math.max(0, params.dt))
    const absSpd = Math.abs(params.speed)
    const thresh = params.leanWarnThreshold ?? 0.74

    // Repeat brass bicycle bell smoothly when H is held
    if (hornActive && hornKind === 'bicycle' && cdt > 0) {
      bicycleBellTimer -= cdt
      if (bicycleBellTimer <= 0) {
        bicycleBellTimer = 0.48
        strikeBicycleBell()
      }
    }

    // Lean critical warning beep (escalating pulse rate near mandatory fall angle)
    const warnActive = params.active && !params.parked && absSpd > 2.2 && params.leanRisk >= thresh
    leanWarnActive = warnActive
    if (warnActive && cdt > 0) {
      const u = Math.max(0, Math.min(1, (params.leanRisk - thresh) / Math.max(0.05, 1 - thresh)))
      const interval = 0.38 - u * 0.23
      leanWarnTimer -= cdt
      if (leanWarnTimer <= 0) {
        leanWarnTimer = interval
        counts.leanWarn++
        const f = 960 + u * 340
        toneBurst(f, f * 1.06, 0.055, 0.052 + u * 0.035, 'sine', 0, 3200)
        if (u > 0.55) toneBurst(f * 1.25, f * 1.3, 0.045, 0.045, 'sine', 0.055, 3400)
      }
    } else {
      leanWarnTimer = 0
    }

    // Continuous hub motor pitch & tire scrub noise telemetry
    const targetMotorHz = params.active && !params.parked && params.rideKind === 'bike' && absSpd > 0.2
      ? 68 + Math.min(220, absSpd * 13.5 + Math.max(0, params.throttle) * 28)
      : 0
    const targetMotorGain = targetMotorHz > 0
      ? Math.min(0.014, 0.004 + Math.min(1, absSpd / 14) * 0.0065 + Math.max(0, params.throttle) * 0.0045)
      : 0

    const scrubLevel = params.active && !params.parked && absSpd > 2.4 && params.leanRisk > 0.68
      ? Math.min(0.06, ((params.leanRisk - 0.68) / 0.32) * 0.05 * Math.min(1.2, absSpd / 8))
      : params.active && params.braking && absSpd > 5.0
        ? Math.min(0.035, ((absSpd - 5) / 10) * 0.028)
        : 0

    currentMotorHz = targetMotorHz
    currentMotorGain = targetMotorGain
    currentScrubGain = scrubLevel

    // Bicycle coasting freewheel hub pawl ticks when gliding without forward pedaling
    if (params.active && params.rideKind === 'bicycle' && absSpd > 2.0 && params.throttle <= 0.05 && cdt > 0) {
      const pawlInterval = Math.max(0.045, 0.22 / Math.max(1, absSpd))
      coastClickTimer -= cdt
      if (coastClickTimer <= 0) {
        coastClickTimer = pawlInterval
        noiseBurst(3400, 4.5, 0.008, 0.016)
      }
    } else {
      coastClickTimer = 0
    }

    if (!ctx || ctx.state !== 'running' || muted) return
    ensureContinuousVoices(ctx)
    const now = ctx.currentTime
    if (motorOscMain && motorOscHarm && motorGain && motorFilter) {
      const hz = Math.max(55, targetMotorHz || 55)
      motorOscMain.frequency.setTargetAtTime(hz, now, 0.04)
      motorOscHarm.frequency.setTargetAtTime(hz * 2.01, now, 0.04)
      motorFilter.frequency.setTargetAtTime(220 + hz * 2.1, now, 0.05)
      motorGain.gain.setTargetAtTime(targetMotorGain, now, 0.05)
    }
    if (scrubGainNode && scrubFilter) {
      scrubFilter.frequency.setTargetAtTime(750 + params.leanRisk * 680, now, 0.04)
      scrubGainNode.gain.setTargetAtTime(scrubLevel, now, 0.04)
    }
  }

  function stopContinuous() {
    setHorn(false)
    leanWarnTimer = 0
    leanWarnActive = false
    coastClickTimer = 0
    currentMotorHz = 0
    currentMotorGain = 0
    currentScrubGain = 0
    if (ctx && ctx.state === 'running') {
      const now = ctx.currentTime
      motorGain?.gain.setTargetAtTime(0, now, 0.03)
      scrubGainNode?.gain.setTargetAtTime(0, now, 0.03)
    }
  }

  function probe(): EbikeAudioSnapshot {
    return {
      unlocked: ctx?.state === 'running',
      supported: !!audioCtor(),
      muted,
      hornActive,
      motorHumHz: +currentMotorHz.toFixed(1),
      motorHumGain: +currentMotorGain.toFixed(4),
      scrubGain: +currentScrubGain.toFixed(4),
      leanWarnActive,
      counts: {...counts},
    }
  }

  const syncVolume=()=>{if(master&&ctx)master.gain.setTargetAtTime(muted?0:MASTER_LEVEL*masterVolume(),ctx.currentTime,.02)}
  window.addEventListener(VOLUME_EVENT,syncVolume)
  function dispose() {
    window.removeEventListener(VOLUME_EVENT,syncVolume)
    isDisposed = true
    stopContinuous()
    try { motorOscMain?.stop(); motorOscHarm?.stop(); scrubSrc?.stop() } catch {}
    master?.disconnect();bus?.disconnect();compressor?.disconnect()
    ctx = null
    compressor = null
    bus = null
    master = null
    motorOscMain = motorOscHarm = null
    motorFilter = scrubFilter = null
    motorGain = scrubGainNode = null
    scrubSrc = null
  }

  return {
    get unlocked() { return ctx?.state === 'running' },
    get muted() { return muted },
    prepare:async()=>{if(!muted&&!isDisposed){ensureContext(false)}},
    unlock,
    setMuted,
    setHorn,
    playPowerOn,
    playParkToggle,
    playGearShift,
    playLightSwitch,
    playTurnRelay,
    playCrashImpact,
    playPickupComplete,
    playShopBuySuccess,
    updateContinuous,
    stopContinuous,
    probe,
    dispose,
  }
}
