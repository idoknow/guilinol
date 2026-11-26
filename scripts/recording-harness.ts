// verify-recording.mjs 的页面端：three.js 渲染器按 main.ts 的配置建（不开 preserveDrawingBuffer），
// 渲染循环里 render 后调 tapFrame —— 和游戏里 drawMain() 一样，然后用真正的 startRecording/stop/recordingProblem 出片。
import * as THREE from 'three'
import {recordingProblem, startRecording} from '../web/src/gear/video'
import {addFrameTap, tapFrame} from '../web/src/gear/frame-tap'

const renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: 'high-performance'})
renderer.setPixelRatio(1)
renderer.setSize(640, 360, false)
document.body.append(renderer.domElement)
const scene = new THREE.Scene()
scene.background = new THREE.Color('#7fb8c9')
const camera = new THREE.PerspectiveCamera(55, 640 / 360, .1, 100)
camera.position.set(0, 1.5, 6)
camera.lookAt(0, 0, 0)
scene.add(new THREE.HemisphereLight('#ffffff', '#335533', 2.5))
const cubes: THREE.Mesh[] = []
for (let i = 0; i < 5; i++) {
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({color: new THREE.Color().setHSL(i / 5, .8, .5)}))
  cube.position.x = (i - 2) * 1.6
  scene.add(cube)
  cubes.push(cube)
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({color: '#2f6b3a'}))
ground.rotation.x = -Math.PI / 2
ground.position.y = -1
scene.add(ground)

let looping = false
function loop(on: boolean) {
  looping = on
  renderer.setAnimationLoop(on ? now => {
    cubes.forEach((cube, i) => cube.rotation.set(now / 700 + i, now / 900, 0))
    renderer.render(scene, camera)
    tapFrame(renderer.domElement)
  } : null)
}
loop(true)

function stats(source: CanvasImageSource) {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 90
  const g = canvas.getContext('2d', {willReadFrequently: true})!
  g.drawImage(source, 0, 0, 160, 90)
  const data = g.getImageData(0, 0, 160, 90).data
  let sum = 0, sq = 0, chroma = 0
  const n = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    const y = .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2]
    sum += y
    sq += y * y
    chroma += Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])
  }
  const mean = sum / n
  return {mean, variance: sq / n - mean * mean, chroma: chroma / n}
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const event = (target: EventTarget, name: string, ms = 15000) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(Error(`${name} timeout`)), ms)
  target.addEventListener(name, () => {
    clearTimeout(timer)
    resolve()
  }, {once: true})
})

async function decode(blob: Blob) {
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = URL.createObjectURL(blob)
  await event(video, 'loadeddata')
  const reported = video.duration
  let duration = reported
  if (!Number.isFinite(duration)) {
    video.currentTime = 1e9
    await event(video, 'seeked')
    duration = video.duration
  }
  const samples = []
  for (const at of [.2, .5, .8]) {
    video.currentTime = duration * at
    await event(video, 'seeked')
    await wait(50)
    samples.push({at: video.currentTime, ...stats(video)})
  }
  URL.revokeObjectURL(video.src)
  return {reported, duration, size: [video.videoWidth, video.videoHeight], samples}
}

async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

Object.assign(window, {
  harness: {
    /** 旧做法（IDOK-383 之前）：渲染循环外 drawImage WebGL 画布。用来证明根因。 */
    async legacyGrab() {
      await wait(300)
      return stats(renderer.domElement)
    },
    /** 渲染循环内拷帧（新做法）的同一时刻对照。 */
    async tapGrab() {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 360
      const g = canvas.getContext('2d')!
      await new Promise<void>(resolve => {
        const untap = addFrameTap(() => {
          g.drawImage(renderer.domElement, 0, 0)
          untap()
          resolve()
        })
      })
      return stats(canvas)
    },
    async record(ms: number, options: {filter?: string; render?: boolean} = {}) {
      loop(options.render !== false)
      renderer.domElement.style.filter = options.filter ?? ''
      const recording = await startRecording(renderer.domElement, {} as never, {label: 'verify', width: 1280, height: 720, fps: 30, bitrate: 8000000})
      if (!recording) return {unsupported: true}
      await wait(ms)
      const result = await recording.stop()
      renderer.domElement.style.filter = ''
      loop(true)
      const problem = recordingProblem(result)
      const info = {container: result.container, mime: result.mime, seconds: result.seconds, frames: result.frames, bytes: result.blob.size, width: result.width, height: result.height, problem}
      if (problem) return info
      return {...info, decoded: await decode(result.blob), data: await base64(result.blob)}
    },
    get looping() {
      return looping
    },
  },
})
