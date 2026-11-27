import type { MifenController, MifenDebugProbe, MifenMountContext } from './index'

const SHOP_CENTER_X = -1139.2
const SHOP_CENTER_Z = -55.5
const LOAD_RADIUS_M = 140

export interface LazyMifenOptions {
  /** verify 模式下自动异步预加载（仍在独立 chunk，不进 main.js 首包） */
  eagerVerify?: boolean
}

/**
 * 田源米粉轻量懒加载入口：不静态导入 Three.js/shop-mesh/materials/audio/story，
 * 保证首包 main.js 零 mifen 代码；玩家靠近三多路 <140m 时才动态加载。
 * 没有玩家侧传送入口（IDOK-468）：只能走、骑车或叫车过去。teleportToShop 只留给 verify/QA 探针。
 */
export function mountLazyTianyuanMifen(ctx: MifenMountContext, opts: LazyMifenOptions = {}): MifenController {
  let real: MifenController | null = null
  let loading: Promise<MifenController> | null = null
  let disposed = false
  let lastDist = Infinity

  function ensureLoaded(): Promise<MifenController> {
    if (real) return Promise.resolve(real)
    if (!loading) {
      loading = import('./index')
        .then(mod => {
          if (disposed) {
            return {
              step() {},
              teleportToShop: async () => false,
              getProbe: () => null as unknown as MifenDebugProbe,
              dispose() {},
            }
          }
          real = mod.mountTianyuanMifen(ctx)
          return real
        })
        .catch(err => {
          loading = null
          throw err
        })
    }
    return loading
  }

  async function teleportToShop(): Promise<boolean> {
    const ctrl = await ensureLoaded()
    return ctrl.teleportToShop()
  }

  if (opts.eagerVerify) void ensureLoaded()

  // 未进入 140m 加载圈前对外暴露轻量代理探针，兼容 verify/QA 直接调用 teleportToShop / walkInside
  const lazyProbe = {
    loaded: false,
    ensureLoaded: () => ensureLoaded().then(c => c.getProbe()),
    teleportToShop,
    walkInside: async (zone: 'front' | 'kitchen' | 'outside') => (await ensureLoaded()).getProbe().walkInside(zone),
    walkToStation: async (station: Parameters<MifenDebugProbe['walkToStation']>[0]) =>
      (await ensureLoaded()).getProbe().walkToStation(station),
    isStoryUnlocked: () => false,
    getState: () => ({
      loaded: false,
      nearShop: false,
      insideShop: false,
      canEarn: false,
      storyUnlocked: false,
      playerDistance: Number.isFinite(lastDist) ? Math.round(lastDist * 100) / 100 : Infinity,
      playerZone: 'outside' as const,
      queueCount: 0,
      activeCustomers: 0,
      seatedCount: 0,
      cookingOpen: false,
      cookingStage: 'idle' as const,
    }),
  } as unknown as MifenDebugProbe

  return {
    step(dt: number) {
      if (disposed) return
      if (real) {
        real.step(dt)
        return
      }
      if (!loading) {
        const ref = ctx.getPlayerPos() ?? ctx.camera.position
        const dx = ref.x - SHOP_CENTER_X
        const dz = ref.z - SHOP_CENTER_Z
        const distSq = dx * dx + dz * dz
        lastDist = Math.sqrt(distSq)
        if (distSq < LOAD_RADIUS_M * LOAD_RADIUS_M) {
          void ensureLoaded()
        }
      }
    },
    teleportToShop,
    getProbe() {
      return real ? real.getProbe() : lazyProbe
    },
    dispose() {
      disposed = true
      real?.dispose()
      real = null
    },
  }
}
