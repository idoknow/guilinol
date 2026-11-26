import { DRINK_SOUND_CATALOG, DRINK_SOUND_IDS, type DrinkSoundId } from './catalog.ts'
import { createDrinkMasterChain, createDrinkNoiseBuffer, scheduleDrinkSound } from './synth.ts'

export interface OfflineDrinkAudioReport {
  id: DrinkSoundId
  sampleRate: number
  durationSec: number
  sampleCount: number
  peak: number
  rms: number
  nonSilent: boolean
  noClip: boolean
  pcm: Float32Array
}

export async function renderDrinkSoundOffline(
  id: DrinkSoundId,
  sampleRate = 44100,
): Promise<OfflineDrinkAudioReport> {
  const spec = DRINK_SOUND_CATALOG[id]
  const totalSec = spec.durationSec + 0.08
  const length = Math.ceil(totalSec * sampleRate)
  const OfflineCtx =
    typeof OfflineAudioContext !== 'undefined'
      ? OfflineAudioContext
      : (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!OfflineCtx) {
    throw new Error('当前环境缺少 OfflineAudioContext')
  }

  const ctx = new OfflineCtx(1, length, sampleRate)
  const noiseBuf = createDrinkNoiseBuffer(ctx, Math.max(1.8, totalSec + 0.4))
  const chain = createDrinkMasterChain(ctx, 0.88)
  scheduleDrinkSound(ctx, chain.input, noiseBuf, id, 0.02, 1)

  const buffer = await ctx.startRendering()
  const pcm = buffer.getChannelData(0).slice()
  let peak = 0
  let sumSq = 0
  for (let i = 0; i < pcm.length; i++) {
    const abs = Math.abs(pcm[i])
    if (abs > peak) peak = abs
    sumSq += pcm[i] * pcm[i]
  }
  const rms = Math.sqrt(sumSq / Math.max(1, pcm.length))
  return {
    id,
    sampleRate,
    durationSec: Number((pcm.length / sampleRate).toFixed(3)),
    sampleCount: pcm.length,
    peak: Number(peak.toFixed(4)),
    rms: Number(rms.toFixed(4)),
    nonSilent: peak >= 0.015 && rms >= 0.002,
    noClip: peak <= 1.0,
    pcm,
  }
}

export async function renderAllDrinkSoundsOffline(sampleRate = 44100): Promise<OfflineDrinkAudioReport[]> {
  const out: OfflineDrinkAudioReport[] = []
  for (const id of DRINK_SOUND_IDS) {
    out.push(await renderDrinkSoundOffline(id, sampleRate))
  }
  return out
}

export function encodeWavMono16(pcm: Float32Array, sampleRate = 44100): Uint8Array {
  const byteLen = pcm.length * 2
  const buf = new ArrayBuffer(44 + byteLen)
  const view = new DataView(buf)
  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + byteLen, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  writeAscii(36, 'data')
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(40, byteLen, true)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    view.setInt16(44 + i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true)
  }
  return new Uint8Array(buf)
}
