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
  teleportToPlaza(): Promise<boolean>
  getProbe(): {
    getState(): {
      state: XxgState
      isIndoor: boolean
      metrics: XxgIndoorMetrics
      player: ReturnType<XxgExtendedIndoorScene['getPlayerSnapshot']> | null
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

  // 城市 HUD 轻量传送胶囊（对齐田源米粉懒加载胶囊样式，按 H 或点击直达中心广场小香港下沉口）
  let pillBtn: HTMLButtonElement | null = null
  const syncPillVisibility = () => {
    if (!pillBtn || typeof document === 'undefined' || !document.body) return
    const ds = document.body.dataset ?? {}
    const shouldHide =
      disposed ||
      isIndoor() ||
      document.body.hasAttribute('data-home') ||
      ds.photo === 'on' ||
      ds.shopOpen === '1' ||
      ds.mifenCooking === '1' ||
      ds.mifenDrawer === '1' ||
      ds.mifenStoryActive === '1'
    pillBtn.hidden = shouldHide
    if (pillBtn.style) {
      pillBtn.style.display = shouldHide ? 'none' : 'inline-flex'
      const mifenEl = document.querySelector<HTMLElement>('.mifen-pill')
      const mifenVisible = Boolean(
        mifenEl &&
          !mifenEl.hidden &&
          mifenEl.style.display !== 'none' &&
          (typeof getComputedStyle !== 'function' || getComputedStyle(mifenEl).display !== 'none'),
      )
      pillBtn.style.left = mifenVisible
        ? 'calc(138px + env(safe-area-inset-left))'
        : 'calc(14px + env(safe-area-inset-left))'
    }
  }

  async function teleportToPlaza(): Promise<boolean> {
    if (disposed || !ctx.teleportToPlaza) return false
    void ensureMounted().catch(() => {})
    const ok = await ctx.teleportToPlaza()
    if (ok) void ensureMounted().catch(() => {})
    syncPillVisibility()
    return ok
  }

  function isEditableOrBlocked(target: EventTarget | null): boolean {
    const el = target as { tagName?: string; isContentEditable?: boolean } | null
    if (el && typeof el.tagName === 'string') {
      const tag = el.tagName.toUpperCase()
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true
    }
    if (typeof document === 'undefined' || !document.body) return true
    const ds = document.body.dataset ?? {}
    if (
      document.body.hasAttribute('data-home') ||
      ds.photo === 'on' ||
      ds.shopOpen === '1' ||
      ds.mifenStoryActive === '1' ||
      isIndoor()
    ) {
      return true
    }
    return typeof document.querySelector === 'function' && Boolean(document.querySelector('dialog[open]'))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (disposed || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.code === 'KeyH' && ctx.teleportToPlaza && !isEditableOrBlocked(e.target)) {
      e.preventDefault()
      void teleportToPlaza()
    }
  }

  if (typeof document !== 'undefined' && document.body && ctx.teleportToPlaza) {
    pillBtn = document.createElement('button')
    pillBtn.type = 'button'
    pillBtn.className = 'xxg-pill xxg-pill--lazy'
    pillBtn.setAttribute('aria-label', '前往小香港商业城，快捷键 H')
    pillBtn.innerHTML =
      '<span>小香港</span><kbd style="font:600 11px/1 ui-monospace,monospace;padding:2px 6px;border-radius:999px;background:rgba(244,239,226,.12);color:#e9e3d4">H</kbd>'
    if (pillBtn.style) {
      Object.assign(pillBtn.style, {
        position: 'fixed',
        left: 'calc(138px + env(safe-area-inset-left))',
        top: 'calc(58px + env(safe-area-inset-top))',
        zIndex: '9',
        height: '34px',
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
    }
    syncPillVisibility()
    pillBtn.addEventListener('click', () => {
      void teleportToPlaza()
    })
    document.body.append(pillBtn)
    if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown)
  }

  const probe = Object.freeze({
    getState: () => ({
      state: (disposed ? 'disposed' : instance?.state ?? 'unmounted') as XxgState,
      isIndoor: isIndoor(),
      metrics: getMetrics(),
      player: instance ? instance.getPlayerSnapshot() : null,
    }),
    getMetrics,
    getPortals: () => portals,
  })

  return {
    step(dtSeconds: number): void {
      if (disposed) return
      syncPillVisibility()
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
    teleportToPlaza,
    getProbe: () => probe,
    dispose(): void {
      if (disposed) return
      disposed = true
      if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown)
      pillBtn?.remove()
      pillBtn = null
      instance?.dispose()
      instance = null
    },
  }
}
