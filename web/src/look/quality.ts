// 画质档位与动态分辨率。
//
// 背景：这台机器有独显时能跑到 200+ fps，但浏览器一旦回落到软件渲染（SwiftShader / llvmpipe /
// 驱动被屏蔽），像素填充会慢两个数量级，同场景只有 1–3 fps。所以这里做两件事：
//   1. 用 GPU 字符串自动识别档次，软件渲染直接进「省电」：低分辨率、关水面反射、缩小加载半径。
//   2. 运行期按真实帧时间动态缩放渲染分辨率（动态分辨率），保证帧率优先。
// 玩家的手选档位存在 localStorage，覆盖自动识别结果。

export type Tier = 'low' | 'mid' | 'high'
export type Setting = 'auto' | Tier

export interface Profile {
  /** 渲染分辨率上线的像素预算（设备像素）。0.6 MP ≈ 1000×600，对软件渲染也勉强能跑。 */
  pixelBudget: number
  /** 水面平面反射（整场景再画一遍）。软件渲染下必须关。 */
  mirror: boolean
  /** 流式加载半径（米）。 */
  radius: number
  /** 树的可见距离系数。 */
  trees: number
  /** 动态分辨率的缩放区间。 */
  minScale: number
  maxScale: number
}

export const PROFILES: Record<Tier, Profile> = {
  low: {pixelBudget: 0.33e6, mirror: false, radius: 224, trees: 0.45, minScale: 0.5, maxScale: 0.85},
  mid: {pixelBudget: 1.9e6, mirror: true, radius: 448, trees: 0.8, minScale: 0.6, maxScale: 1},
  high: {pixelBudget: 3.9e6, mirror: true, radius: 640, trees: 1, minScale: 0.7, maxScale: 1},
}

const KEY = 'glol.quality.v1'

function readRaw(): Setting {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'low' || value === 'mid' || value === 'high' ? value : 'auto'
  } catch {
    return 'auto'
  }
}

export function readSetting(): Setting {
  return readRaw()
}

export function writeSetting(setting: Setting) {
  try {
    if (setting === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, setting)
  } catch {}
}

let cachedSoftware: boolean | undefined
let cachedRendererName = ''

/** 读一次 WebGL 的 UNMASKED_RENDERER，判断是不是软件光栅（SwiftShader / llvmpipe / Basic Render）。 */
export function rendererName() {
  if (cachedRendererName) return cachedRendererName
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!gl) {
      cachedRendererName = 'no-webgl'
      return cachedRendererName
    }
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    cachedRendererName = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    const lose = gl.getExtension('WEBGL_lose_context')
    lose?.loseContext()
  } catch {
    cachedRendererName = 'unknown'
  }
  return cachedRendererName
}

export function isSoftwareRenderer() {
  cachedSoftware ??= /swiftshader|llvmpipe|softwarerasterizer|software|basic render|mesa offscreen/i.test(rendererName())
  return cachedSoftware
}

/** 自动档：软件渲染 → low；独显/桌面卡 → high；其余（核显、手机）→ mid。 */
export function autoTier(): Tier {
  if (isSoftwareRenderer()) return 'low'
  const name = rendererName().toLowerCase()
  const gpu = /rtx|radeon rx|arc a|apple m\d|geforce (gtx|rtx)|quadro|radeon pro/i.test(name)
  const cores = navigator.hardwareConcurrency ?? 4
  const memory = (navigator as unknown as {deviceMemory?: number}).deviceMemory ?? 8
  if (gpu && cores >= 8 && memory >= 8) return 'high'
  if (/intel|uhd|iris|mali|adreno|powervr|apple gpu/i.test(name) || cores <= 6) return 'mid'
  return 'mid'
}

export function activeTier(setting: Setting = readSetting()): Tier {
  return setting === 'auto' ? autoTier() : setting
}

export function profileFor(tier: Tier): Profile {
  return PROFILES[tier]
}

export const TIER_LABEL: Record<Tier, string> = {low: '省电', mid: '均衡', high: '精细'}
export const SETTING_LABEL: Record<Setting, string> = {auto: '自动', low: '省电', mid: '均衡', high: '精细'}

/** 按像素预算算出 devicePixelRatio 上限，再乘动态缩放系数。 */
export function pixelRatioFor(profile: Profile, cssW: number, cssH: number, deviceRatio: number, dynamic = 1) {
  const budget = Math.max(0.08e6, profile.pixelBudget)
  const budgetScale = Math.sqrt(budget / Math.max(1, cssW * cssH))
  const cap = Math.min(deviceRatio, 2)
  return Math.min(cap, Math.max(0.5, budgetScale)) * dynamic
}

/**
 * 动态分辨率：滑动窗口里的中位帧时间超过预算就降档，富余就慢慢升回来。
 * 只动渲染分辨率，不动 CSS 尺寸，所以画面不会抖，UI 也保持清晰。
 */
export class DynamicResolution {
  private samples: number[] = []
  private cooldown = 0
  private scale = 1
  constructor(
    private readonly range: {min: number; max: number},
    private readonly apply: (scale: number) => void,
    private readonly target = 15,
    private readonly floor = 21,
  ) {}

  get current() {
    return this.scale
  }

  /** 每帧调用，返回 true 时表示缩放变了（调用方不必额外做事，apply 已处理）。 */
  update(dtMs: number) {
    if (!(dtMs > 0) || dtMs > 1000) return false // 后台切回/长暂停不算样本
    this.samples.push(dtMs)
    if (this.samples.length < 24) return false
    const sorted = [...this.samples].sort((a, b) => a - b)
    const median = sorted[sorted.length >> 1]
    this.samples.length = 0
    if (this.cooldown > 0) {
      this.cooldown--
      return false
    }
    let next = this.scale
    if (median > this.floor) next = Math.max(this.range.min, this.scale - 0.08)
    else if (median < this.target && this.scale < this.range.max) next = Math.min(this.range.max, this.scale + 0.04)
    if (Math.abs(next - this.scale) < 0.005) return false
    const lowering = next < this.scale
    this.scale = next
    this.cooldown = lowering ? 2 : 6
    this.apply(next)
    return true
  }
}
