import { DRINK_SOUND_CATALOG, type DrinkSoundId } from './catalog.ts'

export interface DrinkSoundScheduleResult {
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

export function createDrinkNoiseBuffer(ctx: BaseAudioContext, seconds = 1.8, seed = 20261124): AudioBuffer {
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

/** 安全主总线：高通去直流 -> 动态压缩 -> tanh 软限幅 <= 0.92 -> 总音量，确保任意组合峰值 <= 1.0 */
export function createDrinkMasterChain(ctx: BaseAudioContext, masterVolume = 0.84): {
  input: GainNode
  master: GainNode
} {
  const input = ctx.createGain()
  input.gain.value = 1

  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 32

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

  input.connect(hp)
  hp.connect(comp)
  comp.connect(limiter)
  limiter.connect(master)
  master.connect(ctx.destination)

  return { input, master }
}

function tone(
  ctx: BaseAudioContext,
  dest: AudioNode,
  opts: {
    type: OscillatorType
    f0: number
    f1?: number
    start: number
    dur: number
    gain: number
    attack?: number
  },
  track: (n: AudioScheduledSourceNode) => void,
): void {
  const osc = ctx.createOscillator()
  osc.type = opts.type
  osc.frequency.setValueAtTime(Math.max(20, opts.f0), opts.start)
  if (typeof opts.f1 === 'number' && opts.f1 > 0) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), opts.start + Math.max(0.015, opts.dur))
  }
  const g = ctx.createGain()
  const atk = Math.min(opts.dur * 0.35, opts.attack ?? 0.004)
  g.gain.setValueAtTime(0.0001, opts.start)
  g.gain.linearRampToValueAtTime(opts.gain, opts.start + Math.max(0.002, atk))
  g.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.dur)
  osc.connect(g)
  g.connect(dest)
  osc.start(opts.start)
  osc.stop(opts.start + opts.dur + 0.02)
  track(osc)
}

function noiseBurst(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noiseBuf: AudioBuffer,
  opts: {
    start: number
    dur: number
    gain: number
    filterType: BiquadFilterType
    f0: number
    f1?: number
    q?: number
    offset?: number
  },
  track: (n: AudioScheduledSourceNode) => void,
): void {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true
  const filter = ctx.createBiquadFilter()
  filter.type = opts.filterType
  filter.frequency.setValueAtTime(Math.max(40, opts.f0), opts.start)
  if (typeof opts.f1 === 'number' && opts.f1 > 0) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.f1), opts.start + Math.max(0.015, opts.dur))
  }
  if (typeof opts.q === 'number') filter.Q.value = opts.q

  const g = ctx.createGain()
  const atk = Math.min(opts.dur * 0.28, 0.014)
  g.gain.setValueAtTime(0.0001, opts.start)
  g.gain.linearRampToValueAtTime(opts.gain, opts.start + Math.max(0.003, atk))
  g.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.dur)

  src.connect(filter)
  filter.connect(g)
  g.connect(dest)
  src.start(opts.start, opts.offset ?? 0)
  src.stop(opts.start + opts.dur + 0.025)
  track(src)
}

export function scheduleDrinkSound(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noiseBuf: AudioBuffer,
  id: DrinkSoundId,
  startTime: number,
  volumeScale = 1,
): DrinkSoundScheduleResult {
  const spec = DRINK_SOUND_CATALOG[id]
  const lv = Math.max(0, Math.min(1.15, spec.defaultVolume * volumeScale))
  const nodes: AudioScheduledSourceNode[] = []
  const track = (n: AudioScheduledSourceNode) => nodes.push(n)
  const stop = () => {
    for (const n of nodes) {
      try {
        n.stop()
      } catch {
        // already stopped
      }
    }
  }

  switch (id) {
    case 'order_chime': {
      tone(ctx, dest, { type: 'sine', f0: 987.77, start: startTime, dur: 0.14, gain: 0.28 * lv }, track)
      tone(ctx, dest, { type: 'sine', f0: 1318.5, start: startTime + 0.09, dur: 0.28, gain: 0.32 * lv }, track)
      tone(ctx, dest, { type: 'triangle', f0: 1975.5, start: startTime + 0.09, dur: 0.18, gain: 0.08 * lv }, track)
      break
    }

    case 'cup_drop': {
      tone(ctx, dest, { type: 'triangle', f0: 210, f1: 112, start: startTime, dur: 0.11, gain: 0.36 * lv }, track)
      tone(ctx, dest, { type: 'sine', f0: 480, f1: 310, start: startTime + 0.015, dur: 0.07, gain: 0.16 * lv }, track)
      noiseBurst(
        ctx,
        dest,
        noiseBuf,
        { start: startTime, dur: 0.08, gain: 0.18 * lv, filterType: 'bandpass', f0: 1450, q: 1.8 },
        track,
      )
      break
    }

    case 'ice_scoop': {
      // 铲冰 + 三声清脆冰块撞击塑料杯壁
      noiseBurst(
        ctx,
        dest,
        noiseBuf,
        { start: startTime, dur: 0.16, gain: 0.2 * lv, filterType: 'bandpass', f0: 2400, f1: 3600, q: 2.2 },
        track,
      )
      const pings: Array<[number, number, number]> = [
        [0.09, 2650, 2240],
        [0.21, 3180, 2720],
        [0.34, 2410, 2050],
      ]
      for (const [dt, f0, f1] of pings) {
        tone(ctx, dest, { type: 'sine', f0, f1, start: startTime + dt, dur: 0.09, gain: 0.24 * lv, attack: 0.002 }, track)
        noiseBurst(
          ctx,
          dest,
          noiseBuf,
          { start: startTime + dt, dur: 0.05, gain: 0.16 * lv, filterType: 'highpass', f0: 3200, offset: dt },
          track,
        )
      }
      break
    }

    case 'tea_pour': {
      noiseBurst(
        ctx,
        dest,
        noiseBuf,
        { start: startTime, dur: 0.82, gain: 0.26 * lv, filterType: 'bandpass', f0: 850, f1: 1850, q: 1.7, offset: 0.2 },
        track,
      )
      noiseBurst(
        ctx,
        dest,
        noiseBuf,
        { start: startTime + 0.04, dur: 0.72, gain: 0.14 * lv, filterType: 'highpass', f0: 2600, f1: 3800, offset: 0.5 },
        track,
      )
      tone(ctx, dest, { type: 'sine', f0: 320, f1: 590, start: startTime + 0.05, dur: 0.68, gain: 0.09 * lv, attack: 0.08 }, track)
      break
    }

    case 'fruit_pour': {
      // 浓稠果泥挂壁倾倒：低频粘稠咕嘟 + 微颗粒软碰撞
      noiseBurst(
        ctx,
        dest,
        noiseBuf,
        { start: startTime, dur: 0.66, gain: 0.24 * lv, filterType: 'bandpass', f0: 420, f1: 760, q: 2.3, offset: 0.15 },
        track,
      )
      for (const [dt, f0, f1] of [
        [0.12, 260, 410],
        [0.29, 310, 480],
        [0.48, 285, 440],
      ] as const) {
        tone(ctx, dest, { type: 'sine', f0, f1, start: startTime + dt, dur: 0.085, gain: 0.22 * lv }, track)
      }
      break
    }

    case 'ice_cream_dispense': {
      // 拉杆下压开关咔嗒 + 柔和制冷泵低频稳态挤出声 + 回弹止阀
      tone(ctx, dest, { type: 'triangle', f0: 340, f1: 180, start: startTime, dur: 0.045, gain: 0.2 * lv }, track)
      tone(ctx, dest, { type: 'sawtooth', f0: 145, f1: 162, start: startTime + 0.05, dur: 0.64, gain: 0.08 * lv, attack: 0.06 }, track)
      noiseBurst(
        ctx,
        dest,
        noiseBuf,
        { start: startTime + 0.05, dur: 0.64, gain: 0.19 * lv, filterType: 'bandpass', f0: 520, f1: 920, q: 1.6, offset: 0.4 },
        track,
      )
      tone(ctx, dest, { type: 'sine', f0: 460, f1: 290, start: startTime + 0.72, dur: 0.06, gain: 0.16 * lv }, track)
      break
    }

    case 'label_apply': {
      // 热敏打印机“滋咔”步进走纸 + 机械吸盘轻拍贴标
      noiseBurst(
        ctx,
        dest,
        noiseBuf,
        { start: startTime, dur: 0.16, gain: 0.2 * lv, filterType: 'bandpass', f0: 2100, f1: 3100, q: 3.1 },
        track,
      )
      tone(ctx, dest, { type: 'triangle', f0: 1120, f1: 880, start: startTime + 0.02, dur: 0.11, gain: 0.12 * lv }, track)
      tone(ctx, dest, { type: 'triangle', f0: 290, f1: 150, start: startTime + 0.26, dur: 0.085, gain: 0.28 * lv, attack: 0.002 }, track)
      noiseBurst(
        ctx,
        dest,
        noiseBuf,
        { start: startTime + 0.26, dur: 0.07, gain: 0.18 * lv, filterType: 'highpass', f0: 1800, offset: 0.3 },
        track,
      )
      break
    }

    case 'shaker_shake': {
      // 四拍有力雪克摇茶节奏：哒-嚓-哒-嚓
      const beats = [0, 0.17, 0.34, 0.52]
      beats.forEach((dt, idx) => {
        const hi = idx % 2 === 0 ? 3100 : 2500
        noiseBurst(
          ctx,
          dest,
          noiseBuf,
          { start: startTime + dt, dur: 0.14, gain: 0.36 * lv, filterType: 'bandpass', f0: hi, f1: hi * 0.75, q: 1.4, offset: dt },
          track,
        )
        tone(ctx, dest, { type: 'triangle', f0: 1450 + idx * 90, f1: 920, start: startTime + dt, dur: 0.06, gain: 0.15 * lv }, track)
      })
      break
    }

    case 'cup_seal': {
      // 机械落合咔哒 -> 热风微嘶 -> 回位弹响
      tone(ctx, dest, { type: 'square', f0: 240, f1: 115, start: startTime, dur: 0.055, gain: 0.18 * lv }, track)
      noiseBurst(
        ctx,
        dest,
        noiseBuf,
        { start: startTime + 0.08, dur: 0.36, gain: 0.24 * lv, filterType: 'bandpass', f0: 3400, f1: 4800, q: 2.0 },
        track,
      )
      tone(ctx, dest, { type: 'sine', f0: 760, f1: 520, start: startTime + 0.45, dur: 0.09, gain: 0.22 * lv }, track)
      break
    }

    case 'call_number': {
      const notes = [783.99, 987.77, 1174.66]
      notes.forEach((freq, i) => {
        const t = startTime + i * 0.11
        tone(ctx, dest, { type: 'sine', f0: freq, start: t, dur: 0.36 - i * 0.04, gain: 0.28 * lv, attack: 0.005 }, track)
        tone(ctx, dest, { type: 'triangle', f0: freq * 2, start: t, dur: 0.18, gain: 0.07 * lv }, track)
      })
      break
    }

    case 'straw_poke': {
      // 紧绷封口膜“啵！”一声清脆张力释放
      tone(ctx, dest, { type: 'sine', f0: 420, f1: 185, start: startTime, dur: 0.09, gain: 0.38 * lv, attack: 0.002 }, track)
      tone(ctx, dest, { type: 'triangle', f0: 1220, f1: 540, start: startTime + 0.012, dur: 0.07, gain: 0.2 * lv }, track)
      noiseBurst(
        ctx,
        dest,
        noiseBuf,
        { start: startTime, dur: 0.06, gain: 0.2 * lv, filterType: 'bandpass', f0: 2900, q: 2.4 },
        track,
      )
      break
    }

    case 'drink_sip': {
      // 吸管吸吮软气流 + 尾段两粒小气泡 + 冰块微响
      noiseBurst(
        ctx,
        dest,
        noiseBuf,
        { start: startTime, dur: 0.42, gain: 0.24 * lv, filterType: 'bandpass', f0: 1550, f1: 2450, q: 2.8, offset: 0.3 },
        track,
      )
      tone(ctx, dest, { type: 'sine', f0: 660, f1: 980, start: startTime + 0.28, dur: 0.075, gain: 0.2 * lv }, track)
      tone(ctx, dest, { type: 'sine', f0: 840, f1: 1240, start: startTime + 0.38, dur: 0.075, gain: 0.2 * lv }, track)
      tone(ctx, dest, { type: 'sine', f0: 2850, f1: 2400, start: startTime + 0.45, dur: 0.06, gain: 0.12 * lv }, track)
      break
    }

    case 'action_reject': {
      tone(ctx, dest, { type: 'triangle', f0: 320, f1: 235, start: startTime, dur: 0.14, gain: 0.26 * lv }, track)
      tone(ctx, dest, { type: 'triangle', f0: 240, f1: 175, start: startTime + 0.09, dur: 0.15, gain: 0.24 * lv }, track)
      break
    }

    case 'staff_clock_in': {
      noiseBurst(
        ctx,
        dest,
        noiseBuf,
        { start: startTime, dur: 0.14, gain: 0.15 * lv, filterType: 'bandpass', f0: 1650, f1: 2400, q: 1.5 },
        track,
      )
      const notes = [659.25, 830.61, 987.77, 1318.51]
      notes.forEach((f, idx) => {
        tone(ctx, dest, { type: 'triangle', f0: f, start: startTime + 0.05 + idx * 0.065, dur: 0.19, gain: 0.2 * lv, attack: 0.004 }, track)
      })
      break
    }

    case 'staff_step_done': {
      tone(ctx, dest, { type: 'sine', f0: 1046.5, start: startTime, dur: 0.12, gain: 0.24 * lv, attack: 0.003 }, track)
      tone(ctx, dest, { type: 'sine', f0: 1567.98, start: startTime + 0.07, dur: 0.22, gain: 0.28 * lv, attack: 0.003 }, track)
      tone(ctx, dest, { type: 'triangle', f0: 2093.0, start: startTime + 0.07, dur: 0.14, gain: 0.07 * lv }, track)
      break
    }
  }

  return { stop, durationSec: spec.durationSec }
}
