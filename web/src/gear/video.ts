import type {CameraBody} from './cameras'
import {download, stamp} from './capture'

// 录像（IDOK-182）：canvas.captureStream + MediaRecorder。
// 机型决定分辨率档位和帧率，mime 按机型列表里第一个浏览器支持的来。

export interface Recording {
  stop(): Promise<{blob: Blob; mime: string; seconds: number; width: number; height: number}>
  readonly seconds: number
  readonly started: number
}

function pickMime(list: string[]): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const mime of list) if (MediaRecorder.isTypeSupported(mime)) return mime
  return null
}

export function canRecord(canvas: HTMLCanvasElement): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof canvas.captureStream === 'function'
}

/** 开始录制。返回 null 表示这台设备/浏览器不支持。 */
export function startRecording(canvas: HTMLCanvasElement, body: CameraBody): Recording | null {
  if (!canRecord(canvas)) return null
  const mime = pickMime(body.video.mime)
  const stream = canvas.captureStream(body.video.fps)
  const chunks: BlobPart[] = []
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, mime ? {mimeType: mime, videoBitsPerSecond: body.video.bitrate} : {videoBitsPerSecond: body.video.bitrate})
  } catch {
    stream.getTracks().forEach(track => track.stop())
    return null
  }
  recorder.ondataavailable = event => {
    if (event.data.size > 0) chunks.push(event.data)
  }
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
    async stop() {
      const seconds = (performance.now() - started) / 1000
      if (!settled) {
        settled = true
        await new Promise<void>(resolve => {
          recorder.onstop = () => resolve()
          recorder.stop()
        })
        stream.getTracks().forEach(track => track.stop())
      }
      const type = recorder.mimeType || mime || 'video/webm'
      return {blob: new Blob(chunks, {type}), mime: type, seconds, width: canvas.width, height: canvas.height}
    },
  }
}

export function saveRecording(result: {blob: Blob; mime: string; seconds: number}, prefix = 'glol-clip'): string {
  const ext = result.mime.includes('mp4') ? 'mp4' : result.mime.includes('webm') ? 'webm' : 'bin'
  const name = `${prefix}-${stamp()}.${ext}`
  download(result.blob, name)
  return name
}
