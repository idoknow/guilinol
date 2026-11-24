import { SOUND_CATALOG, type MifenSoundId } from './catalog.ts'

export interface SoundScheduleResult {
  stop: () => void
  durationSec: number
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 构造确定性粉红噪声音频缓冲（同时支持实时 AudioContext 与离线 OfflineAudioContext）
 */
export function createPinkNoiseBuffer(ctx: BaseAudioContext, seconds = 2.4, seed = 20261124): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  const rnd = mulberry32(seed)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  for (let i = 0; i < len; i++) {
    const white = rnd() * 2 - 1
    b0 = 0.997 * b0 + white * 0.029
    b1 = 0.985 * b1 + white * 0.032
    b2 = 0.95 * b2 + white * 0.048
    const sample = (b0 + b1 + b2 + white * 0.16) * 1.35
    data[i] = Math.max(-0.98, Math.min(0.98, sample))
  }
  return buf
}

/**
 * 构建带软限幅保护的主总线（高通去直流 -> 动态压缩 -> tanh 软拐点 <= 0.94 -> 总音量）
 * 确保无论单声或叠加触发都不会超出 1.0 爆音。
 */
export function createSafeMasterChain(ctx: BaseAudioContext, masterVolume = 0.86): {
  input: GainNode
  master: GainNode
} {
  const input = ctx.createGain()
  input.gain.value = 1

  const dcBlocker = ctx.createBiquadFilter()
  dcBlocker.type = 'highpass'
  dcBlocker.frequency.value = 28

  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.knee.value = 14
  comp.ratio.value = 6
  comp.attack.value = 0.002
  comp.release.value = 0.12

  const curveLen = 1025
  const curve = new Float32Array(curveLen)
  const ceiling = 0.92
  for (let i = 0; i < curveLen; i++) {
    const x = (i / (curveLen - 1)) * 2 - 1
    curve[i] = ceiling * Math.tanh((x * 1.15) / ceiling)
  }
  const limiter = ctx.createWaveShaper()
  limiter.curve = curve
  limiter.oversample = '2x'

  const master = ctx.createGain()
  master.gain.value = Math.max(0, Math.min(1, masterVolume))

  input.connect(dcBlocker)
  dcBlocker.connect(comp)
  comp.connect(limiter)
  limiter.connect(master)
  master.connect(ctx.destination)

  return { input, master }
}

function playTone(
  ctx: BaseAudioContext,
  dest: AudioNode,
  opts: {
    type: OscillatorType
    freq0: number
    freq1?: number
    start: number
    dur: number
    gain: number
    attack?: number
    filter?: { type: BiquadFilterType; freq: number; q?: number }
  },
  track: (node: AudioScheduledSourceNode) => void,
): void {
  const osc = ctx.createOscillator()
  osc.type = opts.type
  osc.frequency.setValueAtTime(opts.freq0, opts.start)
  if (typeof opts.freq1 === 'number' && opts.freq1 > 0) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(12, opts.freq1), opts.start + Math.max(0.015, opts.dur))
  }

  const g = ctx.createGain()
  const atk = Math.min(opts.dur * 0.35, opts.attack ?? 0.004)
  g.gain.setValueAtTime(0.0001, opts.start)
  g.gain.linearRampToValueAtTime(opts.gain, opts.start + atk)
  g.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.dur)

  if (opts.filter) {
    const f = ctx.createBiquadFilter()
    f.type = opts.filter.type
    f.frequency.setValueAtTime(opts.filter.freq, opts.start)
    if (opts.filter.q !== undefined) f.Q.setValueAtTime(opts.filter.q, opts.start)
    osc.connect(f)
    f.connect(g)
  } else {
    osc.connect(g)
  }

  g.connect(dest)
  osc.start(opts.start)
  osc.stop(opts.start + opts.dur + 0.02)
  track(osc)
}

function playNoiseBurst(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noiseBuf: AudioBuffer,
  opts: {
    start: number
    dur: number
    gain: number
    filterType: BiquadFilterType
    freq0: number
    freq1?: number
    q?: number
    attack?: number
    offset?: number
  },
  track: (node: AudioScheduledSourceNode) => void,
): void {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true

  const f = ctx.createBiquadFilter()
  f.type = opts.filterType
  f.frequency.setValueAtTime(opts.freq0, opts.start)
  if (typeof opts.freq1 === 'number' && opts.freq1 > 0) {
    f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freq1), opts.start + opts.dur)
  }
  if (opts.q !== undefined) f.Q.setValueAtTime(opts.q, opts.start)

  const g = ctx.createGain()
  const atk = Math.min(opts.dur * 0.4, opts.attack ?? 0.005)
  g.gain.setValueAtTime(0.0001, opts.start)
  g.gain.linearRampToValueAtTime(opts.gain, opts.start + atk)
  g.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.dur)

  src.connect(f)
  f.connect(g)
  g.connect(dest)
  const off = opts.offset ?? 0
  src.start(opts.start, off % Math.max(0.2, noiseBuf.duration - 0.05))
  src.stop(opts.start + opts.dur + 0.02)
  track(src)
}

/**
 * 调度任意一条田源米粉音效的纯 WebAudio 发声图（兼容 AudioContext 与 OfflineAudioContext）
 */
export function scheduleSoundVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noiseBuf: AudioBuffer,
  id: MifenSoundId,
  start = ctx.currentTime,
  volumeScale = 1,
): SoundScheduleResult {
  const spec = SOUND_CATALOG[id]
  const dur = spec.durationSec
  const nodes: AudioScheduledSourceNode[] = []
  const track = (n: AudioScheduledSourceNode) => nodes.push(n)

  const out = ctx.createGain()
  const vol = Math.max(0, Math.min(1, spec.defaultVolume * volumeScale))
  out.gain.setValueAtTime(vol, start)
  out.connect(dest)

  const rnd = mulberry32(id.split('').reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 17))

  switch (id) {
    case 'boil_bubbling': {
      // 燃气灶低沉底火 + 持续沸水表面滚泡
      playNoiseBurst(
        ctx,
        out,
        noiseBuf,
        { start, dur: dur - 0.02, gain: 0.42, filterType: 'lowpass', freq0: 290, q: 0.8, attack: 0.08, offset: 0.1 },
        track,
      )
      playNoiseBurst(
        ctx,
        out,
        noiseBuf,
        { start, dur: dur - 0.02, gain: 0.24, filterType: 'bandpass', freq0: 980, q: 1.4, attack: 0.08, offset: 0.5 },
        track,
      )
      const count = 20
      for (let i = 0; i < count; i++) {
        const bt = start + 0.05 + (i / count) * (dur - 0.18) + (rnd() - 0.5) * 0.04
        const f0 = 320 + rnd() * 440
        playTone(
          ctx,
          out,
          { type: 'sine', freq0: f0, freq1: f0 * (1.45 + rnd() * 0.45), start: Math.max(start, bt), dur: 0.06 + rnd() * 0.05, gain: 0.18 + rnd() * 0.12 },
          track,
        )
      }
      break
    }

    case 'boil_dip': {
      playNoiseBurst(
        ctx,
        out,
        noiseBuf,
        { start, dur: 0.28, gain: 0.92, filterType: 'bandpass', freq0: 950, freq1: 360, q: 1.1, attack: 0.006 },
        track,
      )
      playTone(
        ctx,
        out,
        { type: 'sine', freq0: 175, freq1: 82, start, dur: 0.17, gain: 0.72, attack: 0.004 },
        track,
      )
      playNoiseBurst(
        ctx,
        out,
        noiseBuf,
        { start: start + 0.04, dur: 0.2, gain: 0.56, filterType: 'highpass', freq0: 1950, q: 0.85, offset: 0.3 },
        track,
      )
      break
    }

    case 'boil_lock_perfect': {
      // 沥水滴落 + 清亮双泛音起锅完成声
      for (let i = 0; i < 3; i++) {
        const dt = start + i * 0.06
        const bf = 1080 + i * 280
        playTone(ctx, out, { type: 'sine', freq0: bf, freq1: bf * 1.32, start: dt, dur: 0.055, gain: 0.24 }, track)
      }
      playTone(ctx, out, { type: 'triangle', freq0: 783.99, start: start + 0.11, dur: 0.18, gain: 0.44 }, track)
      playTone(ctx, out, { type: 'sine', freq0: 1046.5, start: start + 0.18, dur: 0.28, gain: 0.48 }, track)
      break
    }

    case 'boil_lock_miss': {
      playTone(ctx, out, { type: 'triangle', freq0: 245, freq1: 145, start, dur: 0.24, gain: 0.66 }, track)
      playNoiseBurst(
        ctx,
        out,
        noiseBuf,
        { start: start + 0.02, dur: 0.22, gain: 0.54, filterType: 'bandpass', freq0: 620, q: 1.2, offset: 0.4 },
        track,
      )
      break
    }

    case 'meat_chop': {
      // 实木重砧板闷响 + 快刀断肉瞬态
      playTone(ctx, out, { type: 'sine', freq0: 175, freq1: 54, start, dur: 0.13, gain: 0.92, attack: 0.002 }, track)
      playTone(
        ctx,
        out,
        { type: 'triangle', freq0: 320, freq1: 185, start, dur: 0.09, gain: 0.62, filter: { type: 'bandpass', freq: 340, q: 2.2 } },
        track,
      )
      playNoiseBurst(
        ctx,
        out,
        noiseBuf,
        { start, dur: 0.08, gain: 0.88, filterType: 'bandpass', freq0: 2800, freq1: 1350, q: 1.1, attack: 0.002, offset: 0.2 },
        track,
      )
      break
    }

    case 'meat_plate': {
      // 瓷碗轻磕托盘 + 双音装碗确认
      playTone(ctx, out, { type: 'sine', freq0: 1860, start, dur: 0.09, gain: 0.24 }, track)
      playNoiseBurst(
        ctx,
        out,
        noiseBuf,
        { start: start + 0.02, dur: 0.15, gain: 0.36, filterType: 'highpass', freq0: 2300, offset: 0.45 },
        track,
      )
      playTone(ctx, out, { type: 'sine', freq0: 587.33, start: start + 0.06, dur: 0.16, gain: 0.36 }, track)
      playTone(ctx, out, { type: 'sine', freq0: 880, start: start + 0.14, dur: 0.24, gain: 0.4 }, track)
      break
    }

    case 'brine_pour': {
      // 温暖黏稠老卤倾注液流声 + 液面抬高扫频 + 咕嘟泡音
      playNoiseBurst(
        ctx,
        out,
        noiseBuf,
        { start, dur: dur - 0.03, gain: 0.85, filterType: 'bandpass', freq0: 420, freq1: 780, q: 1.3, attack: 0.04, offset: 0.2 },
        track,
      )
      playNoiseBurst(
        ctx,
        out,
        noiseBuf,
        { start, dur: dur - 0.03, gain: 0.48, filterType: 'bandpass', freq0: 1350, freq1: 2100, q: 1.4, attack: 0.05, offset: 0.7 },
        track,
      )
      for (let i = 0; i < 8; i++) {
        const bt = start + 0.08 + i * 0.13 + rnd() * 0.03
        const f0 = 260 + i * 24 + rnd() * 60
        playTone(ctx, out, { type: 'sine', freq0: f0, freq1: f0 * 1.55, start: bt, dur: 0.075, gain: 0.24 }, track)
      }
      break
    }

    case 'brine_stop': {
      // 长勺回桶磕沿金属泛音 + 两滴尾落
      playTone(ctx, out, { type: 'sine', freq0: 1460, start, dur: 0.18, gain: 0.56, attack: 0.002 }, track)
      playTone(ctx, out, { type: 'sine', freq0: 2920, start, dur: 0.12, gain: 0.28, attack: 0.002 }, track)
      playTone(ctx, out, { type: 'sine', freq0: 960, freq1: 1280, start: start + 0.08, dur: 0.055, gain: 0.3 }, track)
      playTone(ctx, out, { type: 'sine', freq0: 1140, freq1: 1480, start: start + 0.17, dur: 0.055, gain: 0.24 }, track)
      break
    }

    case 'condiment_add': {
      playTone(ctx, out, { type: 'sine', freq0: 3120, start, dur: 0.11, gain: 0.44, attack: 0.002 }, track)
      playNoiseBurst(
        ctx,
        out,
        noiseBuf,
        { start: start + 0.02, dur: 0.16, gain: 0.72, filterType: 'highpass', freq0: 2900, attack: 0.008, offset: 0.6 },
        track,
      )
      break
    }

    case 'serve_complete': {
      // 端碗上柜台轻响 + 暖亮四音符出餐和弦 (G4-B4-D5-G5)
      playTone(ctx, out, { type: 'sine', freq0: 138, freq1: 74, start, dur: 0.11, gain: 0.44 }, track)
      const notes = [392.0, 493.88, 587.33, 783.99]
      notes.forEach((hz, idx) => {
        const t = start + 0.04 + idx * 0.07
        playTone(ctx, out, { type: 'triangle', freq0: hz, start: t, dur: 0.32 - idx * 0.02, gain: 0.34 }, track)
        playTone(ctx, out, { type: 'sine', freq0: hz * 2, start: t, dur: 0.18, gain: 0.12 }, track)
      })
      break
    }

    case 'cash_register': {
      playNoiseBurst(
        ctx,
        out,
        noiseBuf,
        { start, dur: 0.035, gain: 0.4, filterType: 'bandpass', freq0: 1850, q: 1.8, attack: 0.002 },
        track,
      )
      const coins = [1046.5, 1318.51, 1567.98]
      coins.forEach((hz, idx) => {
        playTone(ctx, out, { type: 'sine', freq0: hz, start: start + 0.03 + idx * 0.085, dur: 0.26, gain: 0.38 }, track)
      })
      break
    }

    case 'story_open': {
      // GTA-桂林开场定场和弦 (D3 + A3 + F#4/D5 余韵)
      playTone(ctx, out, { type: 'triangle', freq0: 146.83, start, dur: 0.46, gain: 0.42, attack: 0.012 }, track)
      playTone(ctx, out, { type: 'sine', freq0: 220.0, start: start + 0.03, dur: 0.42, gain: 0.34, attack: 0.012 }, track)
      playTone(ctx, out, { type: 'sine', freq0: 587.33, start: start + 0.08, dur: 0.36, gain: 0.22, attack: 0.015 }, track)
      break
    }

    case 'story_blip_uncle': {
      // 中年表叔：沉稳厚实喉共振
      playTone(
        ctx,
        out,
        {
          type: 'triangle',
          freq0: 176,
          freq1: 158,
          start,
          dur: 0.085,
          gain: 0.78,
          attack: 0.006,
          filter: { type: 'bandpass', freq: 510, q: 1.4 },
        },
        track,
      )
      playTone(ctx, out, { type: 'sine', freq0: 168, start, dur: 0.075, gain: 0.56, attack: 0.006 }, track)
      break
    }

    case 'story_blip_player': {
      // 青年主角：清朗上扬短促提示音
      playTone(
        ctx,
        out,
        {
          type: 'triangle',
          freq0: 295,
          freq1: 325,
          start,
          dur: 0.075,
          gain: 0.72,
          attack: 0.005,
          filter: { type: 'bandpass', freq: 890, q: 1.3 },
        },
        track,
      )
      playTone(ctx, out, { type: 'sine', freq0: 300, start, dur: 0.068, gain: 0.54, attack: 0.005 }, track)
      break
    }

    case 'story_choice': {
      playNoiseBurst(
        ctx,
        out,
        noiseBuf,
        { start, dur: 0.025, gain: 0.56, filterType: 'bandpass', freq0: 2100, q: 1.3, attack: 0.002 },
        track,
      )
      playTone(ctx, out, { type: 'sine', freq0: 740, freq1: 1120, start: start + 0.005, dur: 0.14, gain: 0.64, attack: 0.003 }, track)
      break
    }

    case 'story_unlock': {
      // 钥匙串金属微叮 + 解锁升调四连音
      ;[2650, 3420, 4180].forEach((hz, i) => {
        playTone(ctx, out, { type: 'sine', freq0: hz, start: start + i * 0.045, dur: 0.12, gain: 0.18, attack: 0.002 }, track)
      })
      ;[392.0, 493.88, 587.33, 783.99].forEach((hz, i) => {
        const t = start + 0.12 + i * 0.095
        playTone(ctx, out, { type: 'triangle', freq0: hz, start: t, dur: 0.44, gain: 0.36, attack: 0.008 }, track)
        playTone(ctx, out, { type: 'sine', freq0: hz * 1.5, start: t, dur: 0.26, gain: 0.14, attack: 0.008 }, track)
      })
      break
    }

    case 'action_reject': {
      playTone(ctx, out, { type: 'triangle', freq0: 215, freq1: 170, start, dur: 0.085, gain: 0.48, attack: 0.004 }, track)
      playTone(ctx, out, { type: 'triangle', freq0: 165, freq1: 122, start: start + 0.09, dur: 0.12, gain: 0.44, attack: 0.004 }, track)
      break
    }
  }

  return {
    durationSec: dur,
    stop() {
      for (const n of nodes) {
        try {
          n.stop()
        } catch {
          // already stopped
        }
      }
    },
  }
}
