/**
 * 小香港商业城公开入口。
 *
 * main.ts 直接导入 ./entry.ts 以确保 XXG_BUDGET.mainChunkDeltaBytesMax <= 2048B；
 * 本模块重导出完整 contract.ts 供测试、工具与外部模块引用。
 */
export * from './contract.ts'
export { mountLazyXiaoxianggang, type LazyXiaoxianggangHandle } from './entry.ts'
export type { CreateXxgIndoorSceneOptions, XxgExtendedIndoorScene, XxgPlayerSnapshot } from './runtime/types.ts'

export function loadXiaoxianggangRuntime() {
  return import('./runtime/index.ts')
}
