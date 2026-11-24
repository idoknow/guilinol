import { SOUND_CATALOG, SOUND_IDS, type MifenSoundId } from './catalog.ts'
import { createPinkNoiseBuffer, createSafeMasterChain, scheduleSoundVoice } from './synth.ts'

export interface OfflineAudioRenderReport {
  id: MifenSoundId
  sampleRate: number
  durationSec: number
  sampleCount: number
  peak: number
  rms: number
  nonSilent: boolean
  noClip: boolean
  pcm: Float32Array
}

function getOfflineAudioCtor(): typeof OfflineAudioContext | null {
  const g = globalThis as unknown as {
    OfflineAudioContext?: typeof OfflineAudioContext
    webkitOfflineAudioContext?: typeof OfflineAudioContext
  }
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null
}

/**
 * 使用浏览器的 OfflineAudioContext 对指定音效做离线渲染并返回峰值/RMS 与采样数组。
 */
export async function renderSoundOffline(
  id: MifenSoundId,
  sampleRate = 44100,
): Promise<OfflineAudioRenderReport> {
  const Ctor = getOfflineAudioCtor()
  if (!Ctor) {
    throw new Error('OfflineAudioContext 在当前运行环境中不可用')
  }
  const spec = SOUND_CATALOG[id]
  const sampleCount = Math.max(1, Math.ceil(sampleRate * spec.durationSec))
  const oac = new Ctor(1, sampleCount, sampleRate)
  const noiseBuf = createPinkNoiseBuffer(oac, Math.max(2.4, spec.durationSec + 0.3))
  const { input } = createSafeMasterChain(oac, 0.9)
  scheduleSoundVoice(oac, input, noiseBuf, id, 0, 1)

  const rendered = await oac.startRendering()
  const src = rendered.getChannelData(0)
  const pcm = new Float32Array(src.length)
  pcm.set(src)

  let peak = 0
  let sumSq = 0
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i])
    if (a > peak) peak = a
    sumSq += pcm[i] * pcm[i]
  }
  const rms = Math.sqrt(sumSq / Math.max(1, pcm.length))

  return {
    id,
    sampleRate,
    durationSec: spec.durationSec,
    sampleCount: pcm.length,
    peak: Number(peak.toFixed(6)),
    rms: Number(rms.toFixed(6)),
    nonSilent: peak >= 0.02,
    noClip: peak <= 1.0,
    pcm,
  }
}

export async function renderAllSoundsOffline(sampleRate = 44100): Promise<OfflineAudioRenderReport[]> {
  const list: OfflineAudioRenderReport[] = []
  for (const id of SOUND_IDS) {
    list.push(await renderSoundOffline(id, sampleRate))
  }
  return list
}

/**
 * 将单声道 Float32 [-1, 1] 采样编码为标准 16-bit PCM RIFF/WAV 字节流（可直接用播放器或 afplay 试听）
 */
export function encodeWavMono16(pcm: Float32Array, sampleRate = 44100): Uint8Array {
  const numSamples = pcm.length
  const dataBytes = numSamples * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset + i, s.charCodeAt(i))
    }
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]))
    const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767)
    view.setInt16(44 + i * 2, int16, true)
  }

  return new Uint8Array(buffer)
}
