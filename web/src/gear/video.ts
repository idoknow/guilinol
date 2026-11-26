import type {CameraBody, VideoPreset} from './cameras'
import {MP4_MIMES} from './cameras'
import {download, stamp} from './capture'
import {addFrameTap} from './frame-tap'
import {withWebmDuration} from './webm-duration'

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
  /** 真正从渲染循环拷进来的帧数；0 说明整段都没渲染（后台标签页 / 渲染停摆），片子只能是黑的。 */
  frames: number
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
let mp4Mime: string | null | undefined
async function probeOne(mime: string): Promise<boolean> {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const context = canvas.getContext('2d')!
  const stream = canvas.captureStream(30)
  const chunks: Blob[] = []
  let ok = false
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
    ok = chunks.length > 0
  } catch {
    ok = false
  }
  stream.getTracks().forEach(track => track.stop())
  return ok
}

/** 按顺序试每个 MP4 候选，第一个真吐数据的就是本机的 MP4 mime；都不行返回 null（走 WebM）。结果缓存。 */
async function probeMp4(): Promise<string | null> {
  if (mp4Mime !== undefined) return mp4Mime
  mp4Mime = null
  if (typeof MediaRecorder === 'undefined') return null
  for (const mime of MP4_MIMES) {
    if (!MediaRecorder.isTypeSupported(mime)) continue
    if (await probeOne(mime)) {
      mp4Mime = mime
      break
    }
  }
  return mp4Mime
}

/**
 * 开始录制。返回 null 表示这台设备/浏览器不支持。
 * 源 canvas 按原比例拷到中间画布：长边不超过档位，也不超过源画布的实际像素（不做无意义的放大），
 * 帧率封顶 60（画面本身按显示器刷新出帧）。探针证明编不出 MP4 时退回 WebM（`container` 说真话）。
 */
export async function startRecording(source: HTMLCanvasElement, body: CameraBody, preset: VideoPreset): Promise<Recording | null> {
  if (!canRecord(source)) return null
  const mp4 = await probeMp4()
  const mime = mp4 ?? pickMime(WEBM_FALLBACK)
  if (!mime) return null
  const actual: 'mp4' | 'webm' = mp4 ? 'mp4' : 'webm'

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

  // 抓帧（IDOK-383 全黑的根因）：主渲染器没开 preserveDrawingBuffer，WebGL 画布 present 之后
  // drawing buffer 就被清掉，原来在 setInterval 里 drawImage 抓到的全是空 buffer → 整段黑。
  // 现在由渲染循环在 renderer.render 刚结束、同一个任务里回调（frame-tap.ts），这时 buffer 一定有画面。
  // 照相模式的滤镜是画布上的 CSS filter，屏幕上看得到，录像也要带上：同一串 filter 交给 2D context。
  // 高刷屏（120/144 Hz）上渲染比录制帧率快，多拷的帧 captureStream 也会丢掉：按录制帧率节流（留 2 ms 抖动余量）。
  const frameMs = 1000 / Math.max(1, fps)
  let frames = 0, lastTap = 0
  const untap = addFrameTap(canvas => {
    if (canvas !== source || !canvas.width || !canvas.height) return
    if (frames && performance.now() - lastTap < frameMs - 2) return
    const filter = source.style.filter || 'none'
    if (scratch.filter !== filter) scratch.filter = filter
    scratch.drawImage(source, 0, 0, width, height)
    frames++
    lastTap = performance.now()
  })

  // 保底：rAF 停摆（后台标签页、软渲染长帧、主线程被占）时 captureStream 收不到新帧，
  // 编码器可能一段都不吐（IDOK-215 的 0 字节）。这时把中间画布自己再画一遍（重复上一帧），
  // 绝不在循环外读 WebGL 画布。自绘前关掉 filter，不然滤镜会叠一层又一层。
  const timer = setInterval(() => {
    if (!frames || performance.now() - lastTap < frameMs * 1.5) return
    scratch.filter = 'none'
    scratch.drawImage(stage, 0, 0)
  }, frameMs)

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
        untap()
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
      const raw = new Blob(chunks, {type})
      return {
        blob: actual === 'webm' && frames ? await withWebmDuration(raw, seconds * 1000) : raw,
        mime: type,
        container: actual,
        seconds,
        width,
        height,
        fps,
        preset: preset.label,
        frames,
      }
    },
  }
}

/** 短于这个时长的片子当失败处理：多半是刚点开就停，或者编码器只吐了个文件头。 */
export const MIN_CLIP_SECONDS = 0.5

/**
 * 这段录像能不能用。返回给用户看的失败原因，能用返回 null。
 * 空 blob、过短、整段没抓到一帧（片子只会是黑的）都算失败 —— 别把坏文件写进用户下载目录。
 */
export function recordingProblem(result: RecordingResult): string | null {
  if (!result.frames) return '录像没抓到画面（页面在后台或画面停住了），回到游戏画面再录'
  if (!result.blob.size) return '这台机器录不出画面（浏览器编码器没有输出），换个浏览器再试'
  if (result.seconds < MIN_CLIP_SECONDS) return '录像太短，没有保存（至少录 1 秒）'
  return null
}

/** 存盘。`recordingProblem` 不为空时返回 null，不落盘。 */
export function saveRecording(result: RecordingResult, prefix = 'glol-clip'): string | null {
  if (recordingProblem(result)) return null
  const name = `${prefix}-${stamp()}.${result.container}`
  download(result.blob, name)
  return name
}
