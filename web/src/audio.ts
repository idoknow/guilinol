/**
 * 程序化音效（WebAudio 合成，不依赖任何音频资源文件）
 *
 * 设计：
 *  - 全部用振荡器 + 噪声 + 包络现场合成，包体不会变大，也不怕资源 404；
 *  - AudioContext 必须在用户手势之后才能出声，这里在第一次 pointerdown/keydown 时解锁；
 *  - 静音开关存 localStorage（guiling.mute），HUD 上的小喇叭可以点。
 */

type Ctx = AudioContext

let ctx: Ctx | undefined
let master: GainNode | undefined
let muted = false
try {
  muted = localStorage.getItem('guiling.mute') === '1'
} catch {
  muted = false
}

const listeners = new Set<(muted: boolean) => void>()

function ensure(): Ctx | undefined {
  if (typeof window === 'undefined') return undefined
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext
    if (!Ctor) return undefined
    try {
      ctx = new Ctor()
    } catch {
      return undefined
    }
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 0.5
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** 第一次交互时解锁音频（浏览器策略） */
export function unlockAudio() {
  ensure()
}
if (typeof window !== 'undefined') {
  const unlock = () => unlockAudio()
  window.addEventListener('pointerdown', unlock, {once: true, passive: true})
  window.addEventListener('keydown', unlock, {once: true})
}

export function isMuted() {
  return muted
}

export function setMuted(next: boolean) {
  muted = next
  try {
    localStorage.setItem('guiling.mute', next ? '1' : '0')
  } catch {
    /* 忽略 */
  }
  if (master && ctx) master.gain.setTargetAtTime(next ? 0 : 0.5, ctx.currentTime, 0.02)
  for (const listener of listeners) listener(muted)
}

export function toggleMute() {
  setMuted(!muted)
  return muted
}

export function onMuteChange(listener: (muted: boolean) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

interface ToneOptions {
  freq: number
  to?: number
  dur?: number
  type?: OscillatorType
  gain?: number
  attack?: number
  delay?: number
}

function tone({freq, to, dur = 0.08, type = 'sine', gain = 0.2, attack = 0.004, delay = 0}: ToneOptions) {
  const audio = ensure()
  if (!audio || !master || muted) return
  const start = audio.currentTime + delay
  const osc = audio.createOscillator()
  const env = audio.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (to && to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + dur)
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + attack)
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(env)
  env.connect(master)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

interface NoiseOptions {
  dur?: number
  gain?: number
  freq?: number
  q?: number
  type?: BiquadFilterType
  delay?: number
}

function noise({dur = 0.12, gain = 0.2, freq = 1200, q = 0.7, type = 'bandpass', delay = 0}: NoiseOptions) {
  const audio = ensure()
  if (!audio || !master || muted) return
  const start = audio.currentTime + delay
  const frames = Math.ceil(audio.sampleRate * dur)
  const buffer = audio.createBuffer(1, frames, audio.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1
  const source = audio.createBufferSource()
  source.buffer = buffer
  const filter = audio.createBiquadFilter()
  filter.type = type
  filter.frequency.value = freq
  filter.Q.value = q
  const env = audio.createGain()
  env.gain.setValueAtTime(gain, start)
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  source.connect(filter)
  filter.connect(env)
  env.connect(master)
  source.start(start)
  source.stop(start + dur + 0.02)
}

export const sfx = {
  /** 脚步：跑起来更重更快 */
  step(running = false) {
    noise({dur: running ? 0.09 : 0.07, gain: running ? 0.16 : 0.09, freq: running ? 900 : 700, q: 1.2, type: 'lowpass'})
    tone({freq: running ? 120 : 100, to: 60, dur: 0.07, type: 'sine', gain: running ? 0.12 : 0.06})
  },
  jump() {
    tone({freq: 320, to: 620, dur: 0.14, type: 'triangle', gain: 0.14})
  },
  land() {
    noise({dur: 0.1, gain: 0.16, freq: 380, q: 0.9, type: 'lowpass'})
    tone({freq: 120, to: 60, dur: 0.12, type: 'sine', gain: 0.14})
  },
  /** 出拳：空挥 */
  punch() {
    noise({dur: 0.09, gain: 0.12, freq: 1600, q: 1.4})
    tone({freq: 220, to: 120, dur: 0.08, type: 'sawtooth', gain: 0.06})
  },
  /** 打中 */
  hit() {
    noise({dur: 0.12, gain: 0.24, freq: 520, q: 0.6, type: 'lowpass'})
    tone({freq: 180, to: 70, dur: 0.16, type: 'square', gain: 0.14})
  },
  /** 摔车 */
  crash() {
    noise({dur: 0.36, gain: 0.3, freq: 700, q: 0.4, type: 'lowpass'})
    noise({dur: 0.22, gain: 0.18, freq: 2400, q: 1.6, delay: 0.03})
    tone({freq: 210, to: 55, dur: 0.4, type: 'sawtooth', gain: 0.18})
    tone({freq: 90, to: 40, dur: 0.5, type: 'sine', gain: 0.16, delay: 0.02})
  },
  /** 青桂电车车铃（扫码成功后响一下） */
  bell() {
    tone({freq: 1180, dur: 0.16, type: 'sine', gain: 0.13})
    tone({freq: 1560, dur: 0.18, type: 'sine', gain: 0.09, delay: 0.02})
    tone({freq: 1180, dur: 0.2, type: 'sine', gain: 0.11, delay: 0.18})
  },
  mount() {
    tone({freq: 240, to: 180, dur: 0.12, type: 'triangle', gain: 0.1})
    noise({dur: 0.1, gain: 0.1, freq: 900, q: 1.1})
  },
  /** 被打了 */
  hurt() {
    tone({freq: 420, to: 150, dur: 0.2, type: 'square', gain: 0.12})
    noise({dur: 0.14, gain: 0.14, freq: 800, q: 0.8, type: 'lowpass'})
  },
  /** 倒地 */
  down() {
    tone({freq: 300, to: 80, dur: 0.6, type: 'sine', gain: 0.16})
    noise({dur: 0.3, gain: 0.14, freq: 300, q: 0.5, type: 'lowpass', delay: 0.05})
  },
  /** 被扶起 / 重生 */
  revive() {
    tone({freq: 520, to: 780, dur: 0.16, type: 'triangle', gain: 0.12})
    tone({freq: 780, to: 1040, dur: 0.18, type: 'triangle', gain: 0.1, delay: 0.12})
  },
  /** 进入桂林 */
  enter() {
    tone({freq: 392, dur: 0.22, type: 'sine', gain: 0.1})
    tone({freq: 523, dur: 0.24, type: 'sine', gain: 0.09, delay: 0.1})
    tone({freq: 659, dur: 0.3, type: 'sine', gain: 0.08, delay: 0.2})
  },
  /** 界面点击 */
  ui() {
    tone({freq: 660, dur: 0.05, type: 'sine', gain: 0.06})
  },
  /** 体力耗尽 */
  tired() {
    tone({freq: 240, to: 160, dur: 0.2, type: 'sawtooth', gain: 0.07})
  },
  /** 翘头起 / 落 */
  wheelie(up: boolean) {
    noise({dur: up ? 0.18 : 0.1, gain: 0.1, freq: up ? 1400 : 700, q: 1.2})
  },
}

export type Sfx = typeof sfx
