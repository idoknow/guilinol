/**
 * 十字街地下街（B1）模块公开入口。
 *
 * 宿主 main.ts 在整合步导入 ./entry.ts 的 mountLazyShizijie 以满足 mainChunkDeltaBytesMax <= 2048B；
 * 本模块完整重导出 contract.ts 与懒加载句柄供测试与工具使用。
 */
export * from './contract.ts'
export { mountLazyShizijie, type LazyShizijieHandle } from './entry.ts'
export type {
  CreateSzjIndoorSceneOptions,
  SzjAtmosMetrics,
  SzjCrowdMetrics,
  SzjExtendedIndoorScene,
  SzjHangingSign,
  SzjPlayerSnapshot,
  SzjSignRuntimeMetrics,
  SzjWayfinding,
} from './runtime/types.ts'

export function loadShizijieRuntime() {
  return import('./runtime/index.ts')
}
