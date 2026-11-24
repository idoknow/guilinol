import type { MifenController, MifenDebugProbe, MifenMountContext } from './index'

const SHOP_CENTER_X = -1139.2
const SHOP_CENTER_Z = -55.5
const LOAD_RADIUS_M = 140

export interface LazyMifenOptions {
  /** verify 模式下自动异步预加载（仍在独立 chunk，不进 main.js 首包） */
  eagerVerify?: boolean
}

function isInputFocused(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * 田源米粉轻量懒加载入口：不静态导入 Three.js/shop-mesh/materials/audio/story，
 * 保证首包 main.js 零 mifen 代码；玩家靠近三多路 <140m、按 N 键或点胶囊时才动态加载。
 */
export function mountLazyTianyuanMifen(ctx: MifenMountContext, opts: LazyMifenOptions = {}): MifenController {
  let real: MifenController | null = null
  let loading: Promise<MifenController> | null = null
  let disposed = false
  let lastDist = Infinity

  // 轻量占位传送胶囊（挂载真模块后立即销毁，避免未进店区域加载整套 mifen CSS/3D）
  const stubBtn = document.createElement('button')
  stubBtn.type = 'button'
  stubBtn.className = 'mifen-pill mifen-pill--lazy'
  stubBtn.setAttribute('aria-label', '前往田源米粉，快捷键 N')
  stubBtn.innerHTML = '<span>田源米粉</span><kbd style="font:600 11px/1 ui-monospace,monospace;padding:2px 6px;border-radius:999px;background:rgba(244,239,226,.12);color:#e9e3d4">N</kbd>'
  const initHidden = document.body.hasAttribute('data-home') || document.body.hasAttribute('data-photo')
  stubBtn.hidden = initHidden
  Object.assign(stubBtn.style, {
    position: 'fixed',
    left: 'calc(14px + env(safe-area-inset-left))',
    top: 'calc(58px + env(safe-area-inset-top))',
    zIndex: '9',
    height: '34px',
    display: initHidden ? 'none' : 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    padding: '0 7px 0 14px',
    borderRadius: '999px',
    border: 'none',
    boxShadow: 'inset 0 0 0 1px rgba(244,239,226,.14)',
    background: 'rgba(22,36,33,.9)',
    color: '#f4efe2',
    font: '400 13px/1 var(--ui-serif,"Noto Serif SC","Songti SC",serif)',
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  })
  const syncStubPlacement = (): void => {
    const coarsePortrait =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse) and (not (any-pointer: fine)) and (max-width: 520px)').matches
    const shortLandscape =
      typeof window.matchMedia === 'function' && window.matchMedia('(max-height: 480px)').matches
    stubBtn.style.top = shortLandscape
      ? 'calc(50px + env(safe-area-inset-top))'
      : coarsePortrait
        ? 'calc(104px + env(safe-area-inset-top))'
        : 'calc(58px + env(safe-area-inset-top))'
  }
  syncStubPlacement()
  window.addEventListener('resize', syncStubPlacement)
  document.body.append(stubBtn)

  function teardownStub(): void {
    window.removeEventListener('keydown', onLazyKeyDown)
    window.removeEventListener('resize', syncStubPlacement)
    stubBtn.remove()
  }

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
          teardownStub()
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

  stubBtn.addEventListener('click', () => {
    void teleportToShop()
  })

  function onLazyKeyDown(e: KeyboardEvent): void {
    if (real || disposed) return
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    if (isInputFocused(e.target)) return
    if (document.body.hasAttribute('data-home')) return
    if (e.code === 'KeyN') {
      e.preventDefault()
      void teleportToShop()
    }
  }
  window.addEventListener('keydown', onLazyKeyDown)

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
      const inHome = document.body.hasAttribute('data-home') || document.body.hasAttribute('data-photo')
      if (stubBtn.hidden !== inHome) {
        stubBtn.hidden = inHome
        stubBtn.style.display = inHome ? 'none' : 'inline-flex'
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
      teardownStub()
      real?.dispose()
      real = null
    },
  }
}
