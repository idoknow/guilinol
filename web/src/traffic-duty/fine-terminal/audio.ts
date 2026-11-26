import {masterVolume, rideSoundMuted} from '../../walk/ride-sound-pref.ts'

let sharedAudioCtx: AudioContext | null = null

function acquireAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (rideSoundMuted()) return null
  const vol = masterVolume()
  if (vol <= 0) return null
  const win = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  const Ctor = win.AudioContext ?? win.webkitAudioContext
  if (!Ctor) return null
  try {
    sharedAudioCtx ??= new Ctor()
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume().catch(() => {})
    }
    return sharedAudioCtx
  } catch {
    return null
  }
}

function playTone(
  freqHz: number,
  durSec: number,
  type: OscillatorType,
  gainScale = 0.08,
  endFreqHz?: number,
  delaySec = 0,
): boolean {
  const ctx = acquireAudioCtx()
  if (!ctx) return false
  try {
    const vol = masterVolume()
    const peak = Math.min(0.16, gainScale * vol)
    const t0 = ctx.currentTime + delaySec
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec)

    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freqHz, t0)
    if (typeof endFreqHz === 'number') {
      osc.frequency.exponentialRampToValueAtTime(Math.max(80, endFreqHz), t0 + durSec)
    }
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + durSec + 0.015)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
    return true
  } catch {
    return false
  }
}

function playFilteredNoise(
  durSec: number,
  startFreqHz: number,
  endFreqHz: number,
  qFactor: number,
  gainScale: number,
  delaySec = 0,
): boolean {
  const ctx = acquireAudioCtx()
  if (!ctx) return false
  try {
    const vol = masterVolume()
    const peak = Math.min(0.18, gainScale * vol)
    const sampleCount = Math.max(256, Math.floor(ctx.sampleRate * durSec))
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let seed = 0x517cc1b7
    for (let i = 0; i < sampleCount; i++) {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      data[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1
    }

    const t0 = ctx.currentTime + delaySec
    const src = ctx.createBufferSource()
    src.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.setValueAtTime(qFactor, t0)
    filter.frequency.setValueAtTime(startFreqHz, t0)
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, endFreqHz), t0 + durSec)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.014, durSec * 0.25))
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec)

    src.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    src.start(t0)
    src.stop(t0 + durSec + 0.01)
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

/** 从腰间皮套掀开黄铜按扣/拿起打印机的清脆卡扣摩擦声。 */
export function playTerminalTakeOutSound(): boolean {
  const snap = playTone(740, 0.032, 'triangle', 0.06, 1080)
  const leather = playFilteredNoise(0.055, 820, 1680, 2.0, 0.045, 0.015)
  return snap || leather
}

/** 终端机械按键音（核对确认 / 多项违规勾选）。 */
export function playTerminalKeySound(): boolean {
  return playTone(1320, 0.042, 'triangle', 0.06, 980)
}

/** 热敏出纸微步进电机滋滋声 + 走纸摩擦噪声。 */
export function playTerminalPrintPulseSound(stepIndex: number): boolean {
  const pitch = 780 + (stepIndex % 4) * 55
  const pulse = playTone(pitch, 0.036, 'square', 0.026, pitch + 42)
  const feed = playFilteredNoise(0.048, 1450, 2200, 3.4, 0.032)
  return pulse || feed
}

/** 打印完毕提示音。 */
export function playTerminalPrintReadySound(): boolean {
  const a = playTone(1046, 0.08, 'sine', 0.065)
  const b = playTone(1318, 0.11, 'sine', 0.075, undefined, 0.07)
  return a || b
}

/** 沿金属锯齿刀口干脆扯下热敏罚单纸的「嘶啦」扯纸声。 */
export function playTerminalTearPaperSound(): boolean {
  const crispSnap = playTone(1960, 0.024, 'sawtooth', 0.04, 1120)
  const ripMain = playFilteredNoise(0.115, 1900, 4600, 1.8, 0.095, 0.008)
  const ripTail = playFilteredNoise(0.055, 3800, 2400, 2.5, 0.05, 0.085)
  return crispSnap || ripMain || ripTail
}

/** 将扯下的罚单直接塞进对方手心的轻快拍合摩擦声。 */
export function playTerminalStuffInHandSound(): boolean {
  const pat = playTone(320, 0.045, 'sine', 0.07, 180)
  const paper = playFilteredNoise(0.08, 1400, 3100, 1.9, 0.065, 0.01)
  return pat || paper
}

/** 罚单凭条塞单完成确认音。 */
export function playTerminalDeliverSound(): boolean {
  const stuff = playTerminalStuffInHandSound()
  const a = playTone(880, 0.07, 'triangle', 0.058, undefined, 0.025)
  const b = playTone(1174, 0.08, 'triangle', 0.062, undefined, 0.085)
  const c = playTone(1568, 0.13, 'sine', 0.072, undefined, 0.145)
  return stuff || a || b || c
}

/** 取消开单柔和回退音。 */
export function playTerminalCancelSound(): boolean {
  return playTone(560, 0.09, 'sine', 0.05, 390)
}
