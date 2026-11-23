/**
 * 角色大头照：用 walker 的 figure 系统摆好「站立垂手」姿势再离屏渲染
 *
 * 之前是手拧 upperarm 骨骼，方向不可靠（手臂还是张着）。
 * 现在直接 createFigure + pose(moving:false) —— 这就是游戏里站立时的 idle 姿态，
 * 手臂自然垂下，跟游戏内看到的一模一样。
 */
import * as T from 'three'
import {previewCharacter} from '../walk/character'
import {readAvatar} from '../walk/figure'

function isFlat(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  const {data} = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let first = -1
  let same = 0
  const total = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
    if (first < 0) { first = key; same = 1; continue }
    if (key === first) same++
  }
  if (first < 0) return true
  return same / total > 0.9
}

const KEY = 'guiling.portrait.v5'
const SIZE = {w: 400, h: 500}

let pending: Promise<string | null> | null = null

function cached(avatarKey: string) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (raw && raw.key === avatarKey && typeof raw.data === 'string') return raw.data
  } catch {
    /* 忽略 */
  }
  return null
}

function save(avatarKey: string, data: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({key: avatarKey, data}))
  } catch {
    /* 忽略 */
  }
}

async function shoot(avatarInput?: unknown): Promise<string | null> {
  const avatar = (avatarInput as ReturnType<typeof readAvatar>) ?? readAvatar()
  const avatarKey = JSON.stringify(avatar)
  const hit = cached(avatarKey)
  if (hit) return hit

  // 用 previewCharacter：它内部会 styleCharacter(...).applyEquipped(starterOutfit(...))，
  // 发型、校服、肤色这些都真正装到模型上（createFigure 那套要跟 walker 每帧状态，离屏拿不到）。
  const model = await previewCharacter(avatar)
  const root = model.scene
  root.updateWorldMatrix(true, true)

  // 手机上游戏本身已占一个 WebGL 上下文，第二次创建有时会失败：
  // 先试带抗锯齿的，失败再试最省的模式，最后才放弃。
  let renderer: T.WebGLRenderer
  try {
    renderer = new T.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true})
  } catch {
    renderer = new T.WebGLRenderer({alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power'})
  }
  renderer.setPixelRatio(2)
  renderer.setSize(SIZE.w, SIZE.h, false)
  renderer.setClearAlpha(0)

  const scene = new T.Scene()
  scene.add(new T.AmbientLight(0xffffff, 2.3))
  const key = new T.DirectionalLight(0xffffff, 2.5)
  key.position.set(1.5, 2.6, 2.4)
  scene.add(key)
  const rim = new T.DirectionalLight(0x9ff0c8, 1.1)
  rim.position.set(-1.6, 1.5, -1.8)
  scene.add(rim)

  const holder = new T.Group()
  holder.add(root)
  scene.add(holder)
  root.updateWorldMatrix(true, true)

  // 相机：角色朝 -Z，站 -Z 一侧拍正脸；头高优先取 head 骨骼
  const target = new T.Vector3()
  const headBone = ['head', 'Head', 'mixamorigHead'].map(name => root.getObjectByName(name)).find(Boolean)
  if (headBone) headBone.getWorldPosition(target)
  else {
    const bb = new T.Box3().setFromObject(root)
    const height = Math.max(0.2, bb.max.y - bb.min.y)
    target.set(0, bb.min.y + height * 0.9, 0)
  }

  // 只拍头肩：FOV 小一点、机位近一点，胳膊在画面之外
  // 拉远一点、构图往下压一点，头顶和肩膀都留在画面里（之前贴太近，头顶被切）
  const camera = new T.PerspectiveCamera(28, SIZE.w / SIZE.h, 0.01, 40)
  camera.position.set(target.x + 0.012, target.y + 0.035, target.z - 0.84)
  camera.lookAt(target.x, target.y - 0.045, target.z)
  // 关键：渲染到 RenderTarget 再回读像素。
  // 直接 toDataURL() 在不少手机上会拿到无效缓冲（表现为整张图一片纯色，常见是红）。
  const width = Math.round(SIZE.w * 2)
  const height = Math.round(SIZE.h * 2)
  const renderTarget = new T.WebGLRenderTarget(width, height)
  renderer.setRenderTarget(renderTarget)
  renderer.render(scene, camera)
  const pixels = new Uint8Array(width * height * 4)
  renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels)
  renderer.setRenderTarget(null)
  renderTarget.dispose()

  // 上下翻转（WebGL 原点在左下）
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx2d = out.getContext('2d')!
  const image = ctx2d.createImageData(width, height)
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4
    image.data.set(pixels.subarray(src, src + width * 4), y * width * 4)
  }
  ctx2d.putImageData(image, 0, 0)

  // 纯色检测：如果几乎全是同一个颜色（且不是透明的），说明取图失败 → 当作没有照片
  if (isFlat(out)) {    renderer.dispose()
    try {
      renderer.forceContextLoss()
    } catch {
      /* 忽略 */
    }
    holder.remove(root)
    return null
  }

  const data = out.toDataURL('image/png')
  // 释放：不释放会把上下文配额一直占着，游戏那边可能受影响
  renderer.dispose()
  try {
    renderer.forceContextLoss()
  } catch {
    /* 忽略 */
  }
  holder.remove(root)
  save(avatarKey, data)
  return data
}

/** 按指定外形渲染（扫码页：拿服务器上的 avatar 现画一张） */
export function characterPortraitFor(avatar: unknown): Promise<string | null> {
  return shoot(avatar).catch(() => null)
}

export function characterPortrait(): Promise<string | null> {
  if (!pending) {
    pending = shoot()
      .catch(() => null)
      .finally(() => {
        pending = null
      })
  }
  return pending
}
