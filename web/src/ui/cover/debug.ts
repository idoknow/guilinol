// 仅供 dev 页读取内部计数（不属于对外 API）。
export interface CoverDebug {
  memory(): {geometries: number; textures: number; programs: number}
  /** dispose 前后的 renderer.info.memory 快照 */
  /** 无头截图用：定住时间轴、模拟悬停/点击（NDC） */
  tod?(t: number): void
  hover?(nx: number, ny: number): void
  tap?(nx: number, ny: number): void
  /** 内部时钟与像素换算（排查用） */
  info?(): Record<string, unknown>
  peek?(): Record<string, unknown>
  /** 局部放大（像素裁切，w = 0 取消），查远景细节用 */
  crop?(x: number, y: number, w: number, h: number): void
  disposed?: {before: {geometries: number; textures: number}; after: {geometries: number; textures: number}}
}
export const coverDebug = new WeakMap<object, CoverDebug>()
