import type {
  XxgHostContext,
  XxgIndoorMetrics,
  XxgPortal,
  XxgPortalId,
  XxgState,
} from './contract.ts'
import type { CreateXxgIndoorSceneOptions, XxgExtendedIndoorScene } from './runtime/types.ts'

export interface LazyXiaoxianggangHandle {
  step(dtSeconds: number): void
  render(): boolean
  isIndoor(): boolean
  enter(portalId: XxgPortalId): Promise<boolean>
  exit(): Promise<boolean>
  getProbe(): {
    getState(): {
      state: XxgState
      isIndoor: boolean
      metrics: XxgIndoorMetrics
      player: ReturnType<XxgExtendedIndoorScene['getPlayerSnapshot']> | null
      /** 人群与路人画面：在场人数、外观槽位、这一帧画出的人数与开销；未挂载或人群关闭时为 null。 */
      crowd: ReturnType<XxgExtendedIndoorScene['getCrowdMetrics']>
    }
    getMetrics(): XxgIndoorMetrics
    getPortals(): readonly XxgPortal[]
  }
  dispose(): void
}

const ZERO_METRICS: XxgIndoorMetrics = {
  drawCalls: 0,
  triangles: 0,
  textureBytes: 0,
  lastSwapMs: 0,
  lastBlackFrames: 0,
}

export function mountLazyXiaoxianggang(
  ctx: XxgHostContext,
  opts?: CreateXxgIndoorSceneOptions & { eager?: boolean },
): LazyXiaoxianggangHandle {
  let instance: XxgExtendedIndoorScene | null = null
  let portals: readonly XxgPortal[] = []
  let loading: Promise<XxgExtendedIndoorScene> | null = null
  let disposed = false

  function ensureMounted(): Promise<XxgExtendedIndoorScene> {
    if (instance) return Promise.resolve(instance)
    loading ??= import('./runtime/index.ts')
      .then(async mod => {
        portals = mod.XXG_PORTALS
        const created = mod.createXxgIndoorScene(opts)
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
    Boolean(!disposed && instance && (instance.state === 'inside' || instance.state === 'exiting'))
  const getMetrics = () => (instance ? instance.getMetrics() : { ...ZERO_METRICS })

  const probe = Object.freeze({
    getState: () => ({
      state: (disposed ? 'disposed' : instance?.state ?? 'unmounted') as XxgState,
      isIndoor: isIndoor(),
      metrics: getMetrics(),
      player: instance ? instance.getPlayerSnapshot() : null,
      crowd: instance ? instance.getCrowdMetrics() : null,
    }),
    getMetrics,
    getPortals: () => portals,
  })

  return {
    step(dtSeconds: number): void {
      if (disposed) return
      if (instance) {
        instance.step(dtSeconds)
        return
      }
      const w = ctx.getWalker()
      if (w && Math.hypot(w.position.x + 892, w.position.z - 214) <= 112) {
        void ensureMounted()
      }
    },
    render: () => (!disposed && instance ? instance.renderFrame() : false),
    isIndoor,
    enter: async (portalId: XxgPortalId) => (disposed ? false : (await ensureMounted()).enter(portalId)),
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
