import * as THREE from 'three'

export type AnyRenderer = THREE.WebGLRenderer

/**
 * 渲染器工厂：默认走 WebGL，`?renderer=webgpu` 时尝试 WebGPU，失败自动回退。
 *
 * 为什么用 cast：我们的 walk / physics / batch 都是按 WebGLRenderer 的类型写的，
 * 而 WebGPURenderer 与它共享的是同一套高层接口（setSize / setPixelRatio / render / dispose），
 * 运行时子集一致，类型上做一次桥接，避免把类型改动扩散到十几个模块。
 */
export async function createRenderer(canvas: HTMLCanvasElement, prefer: 'webgl' | 'webgpu'): Promise<AnyRenderer> {
  const webgl = () =>
    new THREE.WebGLRenderer({canvas, antialias: false, powerPreference: 'high-performance'})
  if (prefer !== 'webgpu') return webgl()
  try {
    const mod = (await import('three/webgpu')) as unknown as {
      WebGPURenderer: new (options?: Record<string, unknown>) => AnyRenderer & {init: () => Promise<unknown>}
    }
    const renderer = new mod.WebGPURenderer({canvas, antialias: false, powerPreference: 'high-performance'})
    await renderer.init()
    // warm-up：WebGPU 后端要跑一次 render 才建立 canvas 的 swapchain render target，
    // 否则后续先到 clear() 的帧会报 createView is undefined
    const warm = new (await import('three')).Scene()
    const warmCamera = new (await import('three')).PerspectiveCamera()
    renderer.setSize(64, 64, false)
    renderer.render(warm, warmCamera)
    console.info('[renderer] WebGPU 已启用')
    return renderer
  } catch (error) {
    console.warn('[renderer] WebGPU 初始化失败，回退 WebGL：', error)
    return webgl()
  }
}

/** 从 URL 读取渲染后端偏好。 */
export function preferredRenderer(params: URLSearchParams): 'webgl' | 'webgpu' {
  return params.get('renderer') === 'webgpu' ? 'webgpu' : 'webgl'
}
