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
