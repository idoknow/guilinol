// 性能档位：自动判档、档位参数、运行时降级（只降不升，避免抖动）。
export type CoverTier = 'high' | 'mid' | 'low'

export interface Spec {
  dpr: number
  /** 反射 RT 相对画布分辨率 */
  refl: number
  /** 反射每 N 帧更新一次 */
  reflEvery: number
  /** 城市楼块上限 */
  city: number
  /** 树冠上限 */
  trees: number
  /** 孔明灯上限、烟花火星上限、近处光尘数 */
  lanterns: number
  sparks: number
  dust: number
  grain: boolean
  /** 天空丁达尔光束 */
  rays: boolean
}

export const SPECS: Record<CoverTier, Spec> = {
  high: {dpr: 2, refl: 0.5, reflEvery: 1, city: 5200, trees: 2600, lanterns: 48, sparks: 1600, dust: 90, grain: true, rays: true},
  mid: {dpr: 1.5, refl: 0.35, reflEvery: 1, city: 3600, trees: 1800, lanterns: 32, sparks: 1000, dust: 60, grain: true, rays: true},
  low: {dpr: 1, refl: 0.25, reflEvery: 2, city: 2000, trees: 900, lanterns: 16, sparks: 500, dust: 0, grain: false, rays: false},
}

const ORDER: CoverTier[] = ['low', 'mid', 'high']

/** 返回起始档位，以及是否值得实测后升到 high。 */
export function detectTier(): {tier: CoverTier; probe: boolean} {
  const nav = navigator as Navigator & {deviceMemory?: number}
  const coarse = matchMedia('(pointer:coarse)').matches
  if ((nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory ?? 8) <= 3) return {tier: 'low', probe: false}
  // 手机从 mid 起步（dpr 1 在 2–3 倍屏上发糊）；跑不动由运行时降档兜底，只降不升
  return {tier: 'mid', probe: !coarse && devicePixelRatio >= 2}
}

/** 建场用的「最大容量」规格：起始档位，若可能升 high 则按 high 分配。 */
export function capacity(tier: CoverTier, probe: boolean): Spec {
  return probe ? SPECS.high : SPECS[tier]
}

/** GPU 计时（EXT_disjoint_timer_query_webgl2），不可用时返回 null。 */
export class GpuTimer {
  private ext: {TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number} | null
  private pending: WebGLQuery[] = []
  private active: WebGLQuery | null = null
  last = -1
  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  }
  get ok() {
    return !!this.ext
  }
  begin() {
    if (!this.ext || this.active || this.pending.length > 3) return
    this.active = this.gl.createQuery()
    if (this.active) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active)
  }
  end() {
    if (!this.ext || !this.active) return
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    this.pending.push(this.active)
    this.active = null
    const gl = this.gl, q = this.pending[0]
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) this.last = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6
      gl.deleteQuery(q)
      this.pending.shift()
    }
  }
  dispose() {
    for (const q of this.pending) this.gl.deleteQuery(q)
    this.pending = []
  }
}

/**
 * 每 2 s 统计一次。帧时 > 24 ms：先 DPR×0.8（下限为本档 DPR 的 0.6 倍），到底再降档。
 * probe：开局 mid 跑 1.5 s，平均帧时 < 12 ms 才升 high。帧时 = max(CPU, GPU)（有计时扩展）否则用 RAF 间隔。
 */
export class Governor {
  dprScale = 1
  private sum = 0
  private n = 0
  private since = 0
  private warm = 0
  constructor(
    public tier: CoverTier,
    private probe: boolean,
    private apply: (tier: CoverTier, dprScale: number) => void,
  ) {}

  sample(frameMs: number, costMs: number, dt: number) {
    if (frameMs > 250) return // 刚恢复/切后台回来，不算
    this.warm += dt
    if (this.warm < 0.3) return // 跳过 shader 编译抖动
    this.sum += this.probe ? costMs : frameMs
    this.n++
    this.since += dt
    if (this.probe && this.since >= 1.5) {
      const avg = this.sum / this.n
      this.probe = false
      if (avg < 12) {
        this.tier = 'high'
        this.apply(this.tier, this.dprScale)
      }
      return this.reset()
    }
    if (this.since < 2) return
    const avg = this.sum / this.n
    this.reset()
    if (avg <= 24) return
    if (this.dprScale > 0.6 + 1e-3) this.dprScale = Math.max(0.6, this.dprScale * 0.8)
    else {
      const i = ORDER.indexOf(this.tier)
      if (i === 0) return
      const cur = pixelRatio(this.tier, this.dprScale)
      this.tier = ORDER[i - 1]
      // 降档时 DPR 不能反而变高
      this.dprScale = Math.min(1, cur / Math.min(devicePixelRatio || 1, SPECS[this.tier].dpr))
    }
    this.apply(this.tier, this.dprScale)
  }
  private reset() {
    this.sum = this.n = this.since = 0
  }
}

export function pixelRatio(tier: CoverTier, scale: number) {
  return Math.max(0.5, Math.min(devicePixelRatio || 1, SPECS[tier].dpr) * scale)
}
