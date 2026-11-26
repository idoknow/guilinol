// IDOK-383 录像验收：真录 2.5 秒，断言 blob>0、时长合理、抽帧非全黑，并用 ffprobe/ffmpeg 当"常规播放器"解一遍。
// Usage: CHROMIUM=/usr/bin/chromium node scripts/verify-recording.mjs
//   REC_OUT=captures/recording — 片子和抽帧落盘目录
// 页面端是 scripts/recording-harness.ts：three.js 渲染器按 main.ts 配置（不开 preserveDrawingBuffer），
// 走真实的 web/src/gear/video.ts + frame-tap.ts。相机（photo.ts）和航拍（drone/index.ts）两个入口都是
// startRecording(host.renderer.domElement, …) + saveRecording/recordingProblem，这里覆盖的就是它们共用的这条路。
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdir, writeFile} from 'node:fs/promises'
import {build} from 'esbuild'
import {chromium} from 'playwright'

const outDir = process.env.REC_OUT ?? 'captures/recording'
await mkdir(outDir, {recursive: true})
const bundle = await build({entryPoints: ['scripts/recording-harness.ts'], bundle: true, format: 'iife', write: false, target: 'es2022', logLevel: 'silent'})
const js = bundle.outputFiles[0].text
const browser = await chromium.launch({executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']})
const page = await browser.newPage({viewport: {width: 800, height: 500}})
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('http://glol.test/**', route => route.request().url().endsWith('.js')
  ? route.fulfill({contentType: 'text/javascript', body: js})
  : route.fulfill({contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><body style="margin:0;background:#000"><script src="/h.js"></script>'}))
await page.goto('http://glol.test/')
await page.waitForFunction(() => !!window.harness, null, {timeout: 60000})

const has = cmd => {
  try {
    execFileSync(cmd, ['-version'], {stdio: 'ignore'})
    return true
  } catch {
    return false
  }
}
const report = {}

// 1) 根因对照：渲染循环外读 WebGL 画布 = 空 buffer（全黑/透明），循环内拷帧 = 有画面
report.legacy = await page.evaluate(() => window.harness.legacyGrab())
report.tap = await page.evaluate(() => window.harness.tapGrab())
assert.ok(report.legacy.variance < 1 && report.legacy.mean < 1, `out-of-loop grab should be blank (root cause), got ${JSON.stringify(report.legacy)}`)
assert.ok(report.tap.variance > 50, `in-loop tap should have picture, got ${JSON.stringify(report.tap)}`)

// 2) 正式录 2.5 秒
async function clip(label, ms, options) {
  const result = await page.evaluate(([ms, options]) => window.harness.record(ms, options), [ms, options])
  assert.ok(!result.unsupported, 'MediaRecorder unsupported in this browser')
  if (result.data) {
    const file = `${outDir}/${label}.${result.container}`
    await writeFile(file, Buffer.from(result.data, 'base64'))
    result.file = file
    delete result.data
  }
  report[label] = result
  return result
}
const main = await clip('clip', 2500)
assert.equal(main.problem, null, `recording failed: ${main.problem}`)
assert.ok(main.bytes > 0, 'blob should not be empty')
assert.ok(main.frames > 0, 'frames should be tapped from the render loop')
const {duration, samples} = main.decoded
assert.ok(Number.isFinite(main.decoded.reported) || main.container === 'mp4', `webm should carry a Duration (got ${main.decoded.reported})`)
assert.ok(duration > 1.2 && duration < 4, `decoded duration ${duration}s should be close to 2.5 s`)
for (const sample of samples) assert.ok(sample.variance > 50 && sample.mean > 20, `frame at ${sample.at.toFixed(2)}s looks black: ${JSON.stringify(sample)}`)

// 3) 画布上的 CSS 滤镜（照相模式滤镜预览）要进片子：灰度滤镜 → 抽帧几乎无彩度
const gray = await clip('clip-grayscale', 1500, {filter: 'grayscale(1)'})
assert.equal(gray.problem, null, `grayscale recording failed: ${gray.problem}`)
for (const sample of gray.decoded.samples) assert.ok(sample.chroma < 8 && sample.variance > 20, `grayscale filter missing in clip: ${JSON.stringify(sample)}`)

// 4) 失败要明说：过短 / 整段没渲染 都不出文件
const short = await clip('too-short', 200)
assert.match(short.problem ?? '', /太短/, 'sub-0.5 s clip should be rejected')
const stalled = await clip('no-frames', 1200, {render: false})
assert.match(stalled.problem ?? '', /没抓到画面/, 'clip without rendered frames should be rejected')

// 5) "常规播放器"：ffprobe 读得出时长和尺寸，ffmpeg 能完整解码无错并抽一帧
if (has('ffprobe') && has('ffmpeg')) {
  for (const label of ['clip', 'clip-grayscale']) {
    const file = report[label].file
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'json', file]).toString())
    const decodeErrors = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], {stdio: ['ignore', 'pipe', 'pipe']}).toString()
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1', '-i', file, '-frames:v', '1', `${outDir}/${label}-frame.png`])
    report[label].ffprobe = {duration: +probe.format.duration, ...probe.streams[0], decodeErrors: decodeErrors.trim()}
    assert.ok(+probe.format.duration > 1, `${label}: ffprobe duration ${probe.format.duration}`)
    assert.equal(decodeErrors.trim(), '', `${label}: ffmpeg decode errors`)
  }
} else {
  report.ffprobe = 'skipped (no ffprobe/ffmpeg)'
}

// 6) WebM 兜底路径（Firefox / 编不出 H.264 的机器）：新页面里让 MP4 全部 isTypeSupported=false，
//    片子要带 Duration（MediaRecorder 原生 WebM 没有，系统播放器显示 0 秒/拖不动）
await page.close()
const webmPage = await browser.newPage({viewport: {width: 800, height: 500}})
webmPage.on('pageerror', error => errors.push(error.message))
await webmPage.addInitScript(() => {
  const original = MediaRecorder.isTypeSupported.bind(MediaRecorder)
  MediaRecorder.isTypeSupported = mime => !/mp4/i.test(mime) && original(mime)
})
await webmPage.route('http://glol.test/**', route => route.request().url().endsWith('.js')
  ? route.fulfill({contentType: 'text/javascript', body: js})
  : route.fulfill({contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><body style="margin:0;background:#000"><script src="/h.js"></script>'}))
await webmPage.goto('http://glol.test/')
await webmPage.waitForFunction(() => !!window.harness, null, {timeout: 60000})
const webm = await webmPage.evaluate(() => window.harness.record(2500))
await writeFile(`${outDir}/clip.webm`, Buffer.from(webm.data, 'base64'))
delete webm.data
webm.file = `${outDir}/clip.webm`
report.webm = webm
assert.equal(webm.container, 'webm')
assert.equal(webm.problem, null, `webm recording failed: ${webm.problem}`)
assert.ok(Number.isFinite(webm.decoded.reported) && Math.abs(webm.decoded.reported - 2.5) < .6, `webm Duration should be ~2.5 s, got ${webm.decoded.reported}`)
for (const sample of webm.decoded.samples) assert.ok(sample.variance > 50 && sample.mean > 20, `webm frame looks black: ${JSON.stringify(sample)}`)
if (has('ffprobe') && has('ffmpeg')) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'json', webm.file]).toString())
  const decodeErrors = execFileSync('ffmpeg', ['-v', 'error', '-i', webm.file, '-f', 'null', '-'], {stdio: ['ignore', 'pipe', 'pipe']}).toString()
  webm.ffprobe = {duration: +probe.format.duration, ...probe.streams[0], decodeErrors: decodeErrors.trim()}
  assert.ok(Math.abs(+probe.format.duration - 2.5) < .6, `webm: ffprobe duration ${probe.format.duration}`)
  assert.equal(decodeErrors.trim(), '', 'webm: ffmpeg decode errors')
}

assert.deepEqual(errors, [], 'page errors')
await browser.close()
console.log(JSON.stringify(report, null, 2))
console.log('verify-recording OK')
