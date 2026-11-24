import type {CameraBody, VideoContainer, VideoPreset} from './cameras'
import {videoMimeCandidates} from './cameras'
import {download, stamp} from './capture'

// 录像（IDOK-182 / IDOK-188）：canvas.captureStream + MediaRecorder。
// 档位（分辨率/帧率/码率）由机身 + UI 选，容器 MP4 / MOV 由 UI 选：
// - 浏览器能录 mp4（Chrome 系）时，MP4 直接落 .mp4；MOV 走同一份码流，把 ftyp 品牌改写成 `qt  `，
//   仍是 ISO BMFF，QuickTime / 剪映 / Premiere 都按 MOV 打开。
// - 浏览器只支持 webm（Firefox 等）时退回 webm，并在返回值里说明真实容器。

export interface RecordingResult {
  blob: Blob
  mime: string
  container: VideoContainer | 'webm'
  seconds: number
  width: number
  height: number
  fps: number
  preset: string
}

export interface Recording {
  stop(): Promise<RecordingResult>
  readonly seconds: number
  readonly started: number
  readonly width: number
  readonly height: number
  readonly fps: number
}

function pickMime(list: string[]): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const mime of list) if (MediaRecorder.isTypeSupported(mime)) return mime
  return null
}

const WEBM_FALLBACK = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

/** 这台浏览器支持哪些容器：mp4 能力决定 mov 是否可行。 */
export function recordingSupport(): {mp4: boolean; mov: boolean; webm: boolean} {
  const mp4 = !!pickMime(videoMimeCandidates('mp4'))
  const webm = !!pickMime(WEBM_FALLBACK)
  return {mp4, mov: mp4, webm}
}

export function canRecord(canvas: HTMLCanvasElement): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof canvas.captureStream === 'function'
}

/** 把 MP4 的 ftyp 品牌改成 QuickTime（`qt  `），容器仍是 ISO BMFF。 */
async function brandAsMov(blob: Blob): Promise<Blob> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  // 前 8 字节：size(4) + 'ftyp'(4)
  if (bytes.length > 16 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp') {
    bytes.set([0x71, 0x74, 0x20, 0x20], 8) // 'qt  '
    bytes.set([0x00, 0x00, 0x02, 0x00], 12) // minor version
  }
  return new Blob([bytes], {type: 'video/quicktime'})
}

/**
 * 探一下这台机器能不能真的编出 MP4。有些 Windows 机器（缺 H.264 编码器 / 精简版系统）
 * `isTypeSupported('video/mp4;codecs=avc1…')` 明明返回 true，MediaRecorder 却一个字节都不吐，
 * 所以真录之前先用一块 64×36 的小画布试 400ms，只信"真的拿到了数据"。
 */
let mp4Capable: boolean | null = null
async function probeMp4(): Promise<boolean> {
  if (mp4Capable !== null) return mp4Capable
  const mime = pickMime(videoMimeCandidates('mp4'))
  if (!mime) {
    mp4Capable = false
    return false
  }
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 36
  const context = canvas.getContext('2d')!
  context.fillStyle = '#123'
  context.fillRect(0, 0, 64, 36)
  const stream = canvas.captureStream(30)
  const chunks: Blob[] = []
  try {
    const recorder = new MediaRecorder(stream, {mimeType: mime, videoBitsPerSecond: 200000})
    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.start(150)
    for (let index = 0; index < 8; index++) {
      context.fillStyle = index % 2 ? '#fff' : '#111'
      context.fillRect(0, 0, 64, 36)
      await new Promise(resolve => setTimeout(resolve, 55))
    }
    await new Promise<void>(resolve => {
      recorder.onstop = () => resolve()
      recorder.stop()
    })
    mp4Capable = chunks.length > 0
  } catch {
    mp4Capable = false
  }
  stream.getTracks().forEach(track => track.stop())
  return mp4Capable
}

/**
 * 开始录制。返回 null 表示这台设备/浏览器不支持。
 * 录制时把源 canvas 按档位缩放到中间画布，保证输出就是所选分辨率（4K/1080 都能出）。
 * 想要 MP4/MOV 但探针证明编不出 MP4 时，直接退回 WebM（`container` 会说真话）。
 */
export async function startRecording(source: HTMLCanvasElement, body: CameraBody, preset: VideoPreset, container: VideoContainer): Promise<Recording | null> {
  if (!canRecord(source)) return null
  const wantsMp4 = await probeMp4()
  const mp4Mime = wantsMp4 ? pickMime(videoMimeCandidates(container)) : null
  const mime = mp4Mime ?? pickMime(WEBM_FALLBACK)
  if (!mime) return null
  const actual: VideoContainer | 'webm' = mp4Mime ? container : 'webm'

  const stage = document.createElement('canvas')
  stage.width = preset.width
  stage.height = preset.height
  const scratch = stage.getContext('2d')!

  const stream = stage.captureStream(preset.fps)
  const chunks: BlobPart[] = []
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, {mimeType: mime, videoBitsPerSecond: preset.bitrate})
  } catch {
    stream.getTracks().forEach(track => track.stop())
    return null
  }
  recorder.ondataavailable = event => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  let pumping = true
  const pump = () => {
    if (!pumping) return
    try {
      scratch.drawImage(source, 0, 0, preset.width, preset.height)
    } catch {
      // 源 canvas 尺寸为 0 的瞬间（切场景/重建）跳过这一帧
    }
    requestAnimationFrame(pump)
  }
  requestAnimationFrame(pump)

  const started = performance.now()
  recorder.start(500)
  let settled = false
  return {
    get seconds() {
      return (performance.now() - started) / 1000
    },
    get started() {
      return started
    },
    width: preset.width,
    height: preset.height,
    fps: preset.fps,
    async stop() {
      const seconds = (performance.now() - started) / 1000
      if (!settled) {
        settled = true
        pumping = false
        await new Promise<void>(resolve => {
          recorder.onstop = () => resolve()
          recorder.stop()
        })
        stream.getTracks().forEach(track => track.stop())
      }
      const type = recorder.mimeType || mime
      const raw = new Blob(chunks, {type})
      const blob = actual === 'mov' ? await brandAsMov(raw) : raw
      return {
        blob,
        mime: actual === 'mov' ? 'video/quicktime' : type,
        container: actual,
        seconds,
        width: preset.width,
        height: preset.height,
        fps: preset.fps,
        preset: preset.label,
      }
    },
  }
}

export function recordingExtension(container: RecordingResult['container']): string {
  if (container === 'mov') return 'mov'
  if (container === 'mp4') return 'mp4'
  return 'webm'
}

export function saveRecording(result: RecordingResult, prefix = 'glol-clip'): string {
  const name = `${prefix}-${stamp()}.${recordingExtension(result.container)}`
  download(result.blob, name)
  return name
}

export {bodyVideoLabel}
function bodyVideoLabel(body: CameraBody): string {
  return body.video.presets[0]?.label ?? '—'
}
