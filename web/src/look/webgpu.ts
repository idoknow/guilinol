/**
 * WebGPU 能力探测。
 *
 * 说明：three r187 的 WebGPU 渲染器在 `three/webgpu` 子路径里（同一个 npm 包，不需要额外安装），
 * 但它的渲染接口与 `THREE.WebGLRenderer` 差异较大（`init()` 异步、`info` / `shadowMap` 结构不同），
 * 我们现在的 walk / physics / batch 都按 WebGLRenderer 的类型写的。
 * 所以这里先只做「能不能用」的探测，把结果暴露到 `viewer.gpu`，方便决定是否值得迁移。
 */
export interface GPUProbe {
  /** 浏览器是否暴露 navigator.gpu */
  webgpu: boolean
  /** 是否成功拿到了 adapter（拿到才算真的可用） */
  adapter: boolean
  /** 适配器描述，例如 "ANGLE (NVIDIA, RTX 4060, D3D11)" */
  device?: string
  vendor?: string
  architecture?: string
  /** 当前实际在用的渲染后端 */
  backend: 'webgl' | 'webgpu' | 'unknown'
  /** 探测失败原因 */
  error?: string
}

let cached: GPUProbe | null = null

export async function probeWebGPU(backend: GPUProbe['backend'] = 'webgl'): Promise<GPUProbe> {
  if (cached) return {...cached, backend}
  const base: GPUProbe = {webgpu: false, adapter: false, backend}
  try {
    const nav = navigator as Navigator & {gpu?: {requestAdapter: (options?: Record<string, unknown>) => Promise<GPUAdapterLike | null>}}
    base.webgpu = !!nav.gpu
    if (!nav.gpu) {
      base.error = 'navigator.gpu 不存在（浏览器或安全上下文不支持）'
      cached = base
      return base
    }
    const adapter = await nav.gpu.requestAdapter({powerPreference: 'high-performance'})
    if (!adapter) {
      base.error = 'requestAdapter() 返回 null（可能是驱动/黑名单/虚拟显卡）'
      cached = base
      return base
    }
    const info = adapter.info ?? (adapter as {requestAdapterInfo?: () => Promise<AdapterInfoLike>}).requestAdapterInfo
    if (info) {
      const resolved: AdapterInfoLike =
        typeof (info as {then?: unknown}).then === 'function'
          ? await (info as () => Promise<AdapterInfoLike>)()
          : (info as AdapterInfoLike)
      base.device = [resolved.vendor, resolved.architecture, resolved.device].filter(Boolean).join(' / ') || undefined
      base.vendor = resolved.vendor
      base.architecture = resolved.architecture
    }
    base.adapter = true
  } catch (error) {
    base.error = error instanceof Error ? error.message : String(error)
  }
  cached = base
  return base
}

interface GPUAdapterLike {
  info?: AdapterInfoLike | (() => Promise<AdapterInfoLike>)
  requestAdapterInfo?: () => Promise<AdapterInfoLike>
}

interface AdapterInfoLike {
  vendor?: string
  architecture?: string
  device?: string
}
