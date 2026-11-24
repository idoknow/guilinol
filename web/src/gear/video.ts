import type {CameraBody, VideoPreset} from './cameras'
import {MP4_MIMES} from './cameras'
import {download, stamp} from './capture'

// 录像（IDOK-182 / IDOK-211）：canvas.captureStream + MediaRecorder，容器固定 MP4。
// 浏览器真能编 MP4（探针为准）就落 .mp4，否则退回 WebM，并在返回值里说明真实容器。

export interface RecordingResult {
  blob: Blob
  mime: string
  container: 'mp4' | 'webm'
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

// VP8 排在前面：VP9 在部分 headless / 软渲染的 Chromium 上 isTypeSupported 说支持，
// 实际录完整段一个字节都不给（IDOK-215 现场复现），VP8 反而稳。
const WEBM_FALLBACK = ['video/webm;codecs=vp8', 'video/webm', 'video/webm;codecs=vp9']

export function canRecord(canvas: HTMLCanvasElement): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof canvas.captureStream === 'function'
}

/**
 * 探一下这台机器能不能真的编出 MP4。有些 Windows 机器（缺 H.264 编码器 / 精简版系统）
 * `isTypeSupported('video/mp4;codecs=avc1…')` 明明返回 true，MediaRecorder 却一个字节都不吐，
 * 所以真录之前先按"接近真实录像"的尺寸试 500ms，只信"真的拿到了数据"。
 * 注意别用 64×36 这类小画布试：小尺寸下编码器经常什么都不出，会把能出 MP4 的机器误判掉；
 * 反过来 320×180 能出、1280×720 一个字节也不出（软渲染现场复现），尺寸必须贴近真实出片。
 */
let mp4Capable: boolean | null = null
async function probeMp4(): Promise<boolean> {
  if (mp4Capable !== null) return mp4Capable
  const mime = pickMime(MP4_MIMES)
  if (!mime) {
    mp4Capable = false
    return false
  }
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const context = canvas.getContext('2d')!
  const stream = canvas.captureStream(30)
  const chunks: Blob[] = []
  try {
    const recorder = new MediaRecorder(stream, {mimeType: mime, videoBitsPerSecond: 4000000})
    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.start(250)
    const end = performance.now() + 500
    while (performance.now() < end) {
      context.fillStyle = `hsl(${(performance.now() / 12) % 360} 70% 50%)`
      context.fillRect(0, 0, 1280, 720)
      await new Promise(resolve => setTimeout(resolve, 33))
    }
    try {
      recorder.requestData()
    } catch {
      // 已自行停止
    }
    await new Promise(resolve => setTimeout(resolve, 150))
    if (recorder.state !== 'inactive') {
      await new Promise<void>(resolve => {
        recorder.onstop = () => resolve()
        recorder.stop()
      })
    }
    mp4Capable = chunks.length > 0
  } catch {
    mp4Capable = false
  }
  stream.getTracks().forEach(track => track.stop())
  return mp4Capable
}

/**
 * 开始录制。返回 null 表示这台设备/浏览器不支持。
 * 源 canvas 按原比例拷到中间画布：长边不超过档位，也不超过源画布的实际像素（不做无意义的放大），
 * 帧率封顶 60（画面本身按显示器刷新出帧）。探针证明编不出 MP4 时退回 WebM（`container` 说真话）。
 */
export async function startRecording(source: HTMLCanvasElement, body: CameraBody, preset: VideoPreset): Promise<Recording | null> {
  if (!canRecord(source)) return null
  const mp4Mime = (await probeMp4()) ? pickMime(MP4_MIMES) : null
  const mime = mp4Mime ?? pickMime(WEBM_FALLBACK)
  if (!mime) return null
  const actual: 'mp4' | 'webm' = mp4Mime ? 'mp4' : 'webm'

  // 保持源画面比例（手机横屏是 2.16:1，硬拉成 16:9 会变形），长边取 min(档位长边, 源长边)。
  const scale = Math.min(1, Math.max(preset.width, preset.height) / Math.max(source.width, source.height, 1))
  const even = (value: number) => Math.max(2, Math.round(value * scale / 2) * 2)
  const width = even(source.width), height = even(source.height), fps = Math.min(60, preset.fps)
  const stage = document.createElement('canvas')
  stage.width = width
  stage.height = height
  const scratch = stage.getContext('2d')!

  const stream = stage.captureStream(fps)
  const chunks: BlobPart[] = []
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, {mimeType: mime, videoBitsPerSecond: Math.round(preset.bitrate * Math.max(.25, (width * height) / (preset.width * preset.height)))})
  } catch {
    stream.getTracks().forEach(track => track.stop())
    return null
  }
  recorder.ondataavailable = event => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  // 出帧走 setInterval 而不是 requestAnimationFrame：rAF 在后台标签页、软渲染（swiftshader）
  // 或主线程被长任务占住时会停摆，中间画布一帧都拿不到，MediaRecorder 最后吐出 0 字节。
  // 定时器按录制帧率跑，最差情况只是重复同一帧，至少不会空录。
  const draw = () => {
    try {
      scratch.drawImage(source, 0, 0, width, height)
    } catch {
      // 源 canvas 尺寸为 0 的瞬间（切场景/重建）跳过这一帧
    }
  }
  draw()
  const timer = setInterval(draw, 1000 / Math.max(1, fps))

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
    width,
    height,
    fps,
    async stop() {
      const seconds = (performance.now() - started) / 1000
      if (!settled) {
        settled = true
        clearInterval(timer)
        // 有些编码器（headless swiftshader、低码率小画面）收尾时不会自己再触发一次
        // dataavailable，直接 stop 会拿到 0 字节的 blob。先 requestData 把尾包挤出来。
        try {
          if (recorder.state === 'recording') recorder.requestData()
        } catch {
          // 已经自己停了，直接走 stop
        }
        await new Promise(resolve => setTimeout(resolve, 150))
        await new Promise<void>(resolve => {
          if (recorder.state === 'inactive') {
            resolve()
            return
          }
          recorder.onstop = () => resolve()
          recorder.stop()
        })
        stream.getTracks().forEach(track => track.stop())
      }
      const type = recorder.mimeType || mime
      return {
        blob: new Blob(chunks, {type}),
        mime: type,
        container: actual,
        seconds,
        width,
        height,
        fps,
        preset: preset.label,
      }
    },
  }
}

/**
 * 存盘。编码器一帧都没吐（0 字节 blob）时返回 null —— 别把空文件写进用户下载目录，
 * 调用方应该提示"这台机器录不出来"。
 */
export function saveRecording(result: RecordingResult, prefix = 'glol-clip'): string | null {
  if (!result.blob.size) return null
  const name = `${prefix}-${stamp()}.${result.container}`
  download(result.blob, name)
  return name
}
