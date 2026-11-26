import {masterVolume, rideSoundMuted} from '../walk/ride-sound-pref.ts'

let sharedAudioCtx: AudioContext | null = null

function getAudioContextCtor(): (typeof AudioContext) | null {
  if (typeof window === 'undefined') return null
  const win = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  return win.AudioContext ?? win.webkitAudioContext ?? null
}

/**
 * Plays a short, crisp synthesized traffic pea-whistle burst (~240ms).
 * Respects global rideSoundMuted & masterVolume; safely no-ops in headless/Node.
 */
export function playWhistleSound(): boolean {
  if (rideSoundMuted()) return false
  const vol = masterVolume()
  if (vol <= 0) return false
  const Ctor = getAudioContextCtor()
  if (!Ctor) return false
  try {
    sharedAudioCtx ??= new Ctor()
    const ctx = sharedAudioCtx
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {})
    }
    const now = ctx.currentTime
    const dur = 0.24
    const peak = Math.min(0.22, 0.16 * vol)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(peak, now + 0.016)
    gain.gain.setValueAtTime(peak * 0.9, now + dur - 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(2950, now)
    filter.Q.setValueAtTime(3.2, now)

    const oscA = ctx.createOscillator()
    const oscB = ctx.createOscillator()
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()

    oscA.type = 'sine'
    oscA.frequency.setValueAtTime(2820, now)
    oscB.type = 'triangle'
    oscB.frequency.setValueAtTime(3060, now)

    // Pea-whistle trill at ~36 Hz
    lfo.type = 'sine'
    lfo.frequency.setValueAtTime(36, now)
    lfoGain.gain.setValueAtTime(110, now)
    lfo.connect(lfoGain)
    lfoGain.connect(oscA.frequency)
    lfoGain.connect(oscB.frequency)

    oscA.connect(filter)
    oscB.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)

    oscA.start(now)
    oscB.start(now)
    lfo.start(now)

    const stopAt = now + dur + 0.02
    oscA.stop(stopAt)
    oscB.stop(stopAt)
    lfo.stop(stopAt)

    oscA.onended = () => {
      oscA.disconnect()
      oscB.disconnect()
      lfo.disconnect()
      lfoGain.disconnect()
      filter.disconnect()
      gain.disconnect()
    }
    return true
  } catch {
    return false
  }
}

/**
 * Plays a brisk cloth-snap whoosh when waving the traffic guidance flag (`stop` / `go`).
 * Respects global rideSoundMuted & masterVolume; safely no-ops in headless/Node.
 */
export function playFlagWaveSound(mode: 'stop' | 'go' = 'stop'): boolean {
  if (rideSoundMuted()) return false
  const vol = masterVolume()
  if (vol <= 0) return false
  const Ctor = getAudioContextCtor()
  if (!Ctor) return false
  try {
    sharedAudioCtx ??= new Ctor()
    const ctx = sharedAudioCtx
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {})
    }
    const now = ctx.currentTime
    const dur = mode === 'stop' ? 0.16 : 0.22
    const peak = Math.min(0.16, 0.12 * vol)

    const bufLen = Math.max(1, Math.floor(ctx.sampleRate * dur))
    const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufLen) * Math.PI)
    }

    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(mode === 'stop' ? 920 : 680, now)
    filter.frequency.exponentialRampToValueAtTime(mode === 'stop' ? 420 : 1120, now + dur)
    filter.Q.setValueAtTime(1.8, now)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(peak, now + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)

    src.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    src.start(now)
    src.onended = () => {
      src.disconnect()
      filter.disconnect()
      gain.disconnect()
    }
    return true
  } catch {
    return false
  }
}

/**
 * Plays a brief brake-chirp cue when a whistled two-wheeler pulls over on Jiefang Bridge.
 */
export function playBrakeScreechSound(): boolean {
  if (rideSoundMuted()) return false
  const vol = masterVolume()
  if (vol <= 0) return false
  const Ctor = getAudioContextCtor()
  if (!Ctor) return false
  try {
    sharedAudioCtx ??= new Ctor()
    const ctx = sharedAudioCtx
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {})
    }
    const now = ctx.currentTime
    const dur = 0.2
    const peak = Math.min(0.14, 0.1 * vol)

    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(1480, now)
    osc.frequency.exponentialRampToValueAtTime(640, now + dur)

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(1150, now)
    filter.Q.setValueAtTime(5.0, now)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(peak, now + 0.025)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)

    osc.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + dur + 0.02)
    osc.onended = () => {
      osc.disconnect()
      filter.disconnect()
      gain.disconnect()
    }
    return true
  } catch {
    return false
  }
}

/**
 * Plays a brief dual-tone urban car horn warning (~220ms) when a motor vehicle honks at the officer.
 * Respects global rideSoundMuted & masterVolume; safely no-ops in headless/Node.
 */
export function playCarHornSound(): boolean {
  if (rideSoundMuted()) return false
  const vol = masterVolume()
  if (vol <= 0) return false
  const Ctor = getAudioContextCtor()
  if (!Ctor) return false
  try {
    sharedAudioCtx ??= new Ctor()
    const ctx = sharedAudioCtx
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {})
    }
    const now = ctx.currentTime
    const dur = 0.22
    const peak = Math.min(0.18, 0.13 * vol)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(peak, now + 0.018)
    gain.gain.setValueAtTime(peak * 0.9, now + dur - 0.045)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(1450, now)
    filter.Q.setValueAtTime(1.4, now)

    const oscA = ctx.createOscillator()
    const oscB = ctx.createOscillator()
    oscA.type = 'sawtooth'
    oscA.frequency.setValueAtTime(415, now)
    oscB.type = 'triangle'
    oscB.frequency.setValueAtTime(523, now)

    oscA.connect(filter)
    oscB.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)

    oscA.start(now)
    oscB.start(now)
    const stopAt = now + dur + 0.02
    oscA.stop(stopAt)
    oscB.stop(stopAt)
    oscA.onended = () => {
      oscA.disconnect()
      oscB.disconnect()
      filter.disconnect()
      gain.disconnect()
    }
    return true
  } catch {
    return false
  }
}
