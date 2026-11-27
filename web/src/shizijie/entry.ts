import type {
  SzjHostContext,
  SzjIndoorMetrics,
  SzjStairId,
  SzjStairwell,
  SzjState,
} from './contract.ts'
import type {
  CreateSzjIndoorSceneOptions,
  SzjAtmosMetrics,
  SzjCrowdMetrics,
  SzjExtendedIndoorScene,
  SzjHangingSign,
  SzjSignRuntimeMetrics,
} from './runtime/types.ts'

export interface LazyShizijieHandle {
  step(dtSeconds: number): void
  render(): boolean
  isIndoor(): boolean
  enter(stairId: SzjStairId): Promise<boolean>
  exit(): Promise<boolean>
  getProbe(): {
    getState(): {
      state: SzjState
      isIndoor: boolean
      metrics: SzjIndoorMetrics
      signs: SzjSignRuntimeMetrics | null
      player: ReturnType<SzjExtendedIndoorScene['getPlayerSnapshot']> | null
    }
    getMetrics(): SzjIndoorMetrics
    getCrowdMetrics(): SzjCrowdMetrics | null
    getAtmosMetrics(): SzjAtmosMetrics | null
    getSignMetrics(): SzjSignRuntimeMetrics | null
    getHangingSigns(): readonly SzjHangingSign[]
    getStairwells(): readonly SzjStairwell[]
  }
  dispose(): void
}

const ZERO_METRICS: SzjIndoorMetrics = {
  drawCalls: 0,
  triangles: 0,
  textureBytes: 0,
  npcCount: 0,
  lastSwapMs: 0,
  lastBlackFrames: 0,
  lastMaxEyeDy: 0,
  lastLandingError: 0,
}

/**
 * 十字街地下街轻量懒加载入口：
 * 顶层仅导入类型，零坐标字面量、零运行时契约提升，确保 main chunk 增量远小于 2048B；
 * 玩家处于步行态或显式调用 enter() 时异步加载 ./runtime/index.ts 并按 contract.ts 执行预取与触发。
 */
export function mountLazyShizijie(
  ctx: SzjHostContext,
  opts?: CreateSzjIndoorSceneOptions & { eager?: boolean },
): LazyShizijieHandle {
  let instance: SzjExtendedIndoorScene | null = null
  let stairwells: readonly SzjStairwell[] = []
  let loading: Promise<SzjExtendedIndoorScene> | null = null
  let disposed = false

  function ensureMounted(): Promise<SzjExtendedIndoorScene> {
    if (instance) return Promise.resolve(instance)
    loading ??= import('./runtime/index.ts')
      .then(async mod => {
        stairwells = mod.SZJ_STAIRWELLS
        const created = mod.createSzjIndoorScene(opts)
        if (disposed) {
          created.dispose()
          return created
        }
        await created.mount(ctx)
        instance = created
        return created
      })
      .catch(err => {
        loading = null
        throw err
      })
    return loading
  }

  if (opts?.eager) void ensureMounted()

  const isIndoor = () =>
    Boolean(
      !disposed &&
        instance &&
        (instance.state === 'inside' || instance.state === 'exiting'),
    )
  const getMetrics = () => (instance ? instance.getMetrics() : { ...ZERO_METRICS })

  const probe = Object.freeze({
    getState: () => ({
      state: (disposed ? 'disposed' : instance?.state ?? 'unmounted') as SzjState,
      isIndoor: isIndoor(),
      metrics: getMetrics(),
      signs: instance ? instance.getSignMetrics() : null,
      player: instance ? instance.getPlayerSnapshot() : null,
    }),
    getMetrics,
    getCrowdMetrics: () => (instance ? instance.getCrowdMetrics() : null),
    getAtmosMetrics: () => (instance ? instance.getAtmosMetrics() : null),
    getSignMetrics: () => (instance ? instance.getSignMetrics() : null),
    getHangingSigns: () => (instance ? instance.getHangingSigns() : []),
    getStairwells: () => stairwells,
  })

  return {
    step(dtSeconds: number): void {
      if (disposed) return
      if (instance) {
        instance.step(dtSeconds)
        return
      }
      if (ctx.getWalker()) {
        void ensureMounted()
      }
    },
    render: () => (!disposed && instance ? instance.renderFrame() : false),
    isIndoor,
    enter: async (stairId: SzjStairId) => (disposed ? false : (await ensureMounted()).enter(stairId)),
    exit: async () => (disposed || !instance ? false : instance.exit()),
    getProbe: () => probe,
    dispose(): void {
      if (disposed) return
      disposed = true
      instance?.dispose()
      instance = null
    },
  }
}
