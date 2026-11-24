import type { DrinksStaffSession, DrinksStaffStateSnapshot } from './workflow.ts'

export interface DrinksStaffHudOptions {
  session: DrinksStaffSession
  container?: HTMLElement
  hotkeyLabel?: string
  bgmMuted?: () => boolean
  onPrimaryAction?: () => void
  onHoldStep?: (holding: boolean) => void
  onToggleBgm?: () => boolean
  onResign?: () => void
}

export interface DrinksStaffHudController {
  readonly root: HTMLElement
  sync(): void
  dispose(): void
}

/**
 * 员工互动与操作极简 HUD（遵循 Linear / Apple Notes 极简原则）：
 * 仅保留「当前名称/进度 + 单一主动作按钮 (+ 音乐/下班)」，不放标语、长文案或次要噪声标签。
 */
export function mountDrinksStaffHud(opts: DrinksStaffHudOptions): DrinksStaffHudController {
  const host = opts.container ?? document.body
  const keyLabel = opts.hotkeyLabel ?? 'E'

  const root = document.createElement('section')
  root.className = 'drinks-staff-hud'
  root.setAttribute('aria-label', '门店员工操作')
  root.hidden = true

  root.innerHTML = `
    <div class="drinks-staff-row">
      <div class="drinks-staff-meta">
        <span class="drinks-staff-title" data-staff-title>蜜雪招聘</span>
        <span class="drinks-staff-count" data-staff-count hidden></span>
      </div>
      <div class="drinks-staff-actions">
        <button type="button" class="drinks-staff-btn drinks-staff-btn--quiet" data-staff-bgm hidden>音乐</button>
        <button type="button" class="drinks-staff-btn drinks-staff-btn--quiet" data-staff-resign hidden>下班</button>
        <button type="button" class="drinks-staff-btn drinks-staff-btn--primary" data-staff-cta>
          <span data-staff-cta-text>应聘</span>
          <kbd class="drinks-staff-key" aria-hidden="true">${keyLabel}</kbd>
        </button>
      </div>
    </div>
    <div class="drinks-staff-track" data-staff-track hidden>
      <div class="drinks-staff-fill" data-staff-fill></div>
    </div>
  `
  host.append(root)

  const titleEl = root.querySelector<HTMLElement>('[data-staff-title]')!
  const countEl = root.querySelector<HTMLElement>('[data-staff-count]')!
  const bgmBtn = root.querySelector<HTMLButtonElement>('[data-staff-bgm]')!
  const resignBtn = root.querySelector<HTMLButtonElement>('[data-staff-resign]')!
  const ctaBtn = root.querySelector<HTMLButtonElement>('[data-staff-cta]')!
  const ctaTextEl = root.querySelector<HTMLElement>('[data-staff-cta-text]')!
  const trackEl = root.querySelector<HTMLElement>('[data-staff-track]')!
  const fillEl = root.querySelector<HTMLElement>('[data-staff-fill]')!

  let disposed = false

  function render(snap: DrinksStaffStateSnapshot): void {
    if (disposed) return
    const prompt = snap.prompt
    if (!prompt || !prompt.visible) {
      root.hidden = true
      return
    }
    root.hidden = false
    titleEl.textContent = prompt.label
    ctaTextEl.textContent = prompt.ctaLabel

    if (snap.onDuty) {
      countEl.hidden = false
      countEl.textContent = `${snap.cupsServed}杯`
      bgmBtn.hidden = false
      bgmBtn.textContent = opts.bgmMuted?.() ? '静音' : '音乐'
      resignBtn.hidden = false
      const showProgress = snap.phase === 'add_toppings' || snap.phase === 'seal_cup'
      trackEl.hidden = !showProgress
      fillEl.style.width = `${Math.round(snap.stepProgress * 100)}%`
    } else {
      countEl.hidden = true
      bgmBtn.hidden = true
      resignBtn.hidden = true
      trackEl.hidden = true
    }
  }

  let holdingPtr = false
  let holdStartedMs = 0
  let holdStartPhase = opts.session.getSnapshot().phase
  let suppressNextClick = false
  const isHoldPhase = (phase: DrinksStaffStateSnapshot['phase']) =>
    phase === 'add_toppings' || phase === 'seal_cup'

  ctaBtn.addEventListener('pointerdown', () => {
    holdStartPhase = opts.session.getSnapshot().phase
    suppressNextClick = false
    if (!isHoldPhase(holdStartPhase)) {
      holdingPtr = false
      return
    }
    holdingPtr = true
    holdStartedMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
    opts.onHoldStep?.(true)
  })
  const stopHold = () => {
    if (!holdingPtr) return
    holdingPtr = false
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const phaseNow = opts.session.getSnapshot().phase
    if (now - holdStartedMs >= 200 || phaseNow !== holdStartPhase) {
      suppressNextClick = true
    }
    opts.onHoldStep?.(false)
  }
  ctaBtn.addEventListener('pointerup', stopHold)
  ctaBtn.addEventListener('pointercancel', stopHold)
  ctaBtn.addEventListener('click', () => {
    if (suppressNextClick) {
      suppressNextClick = false
      return
    }
    if (opts.onPrimaryAction) opts.onPrimaryAction()
    else opts.session.performPrimaryAction()
    render(opts.session.getSnapshot())
  })
  bgmBtn.addEventListener('click', () => {
    opts.onToggleBgm?.()
    render(opts.session.getSnapshot())
  })
  resignBtn.addEventListener('click', () => {
    if (opts.onResign) opts.onResign()
    else opts.session.resignJob()
    render(opts.session.getSnapshot())
  })

  const unsub = opts.session.subscribe(render)
  render(opts.session.getSnapshot())

  return {
    root,
    sync: () => render(opts.session.getSnapshot()),
    dispose() {
      if (disposed) return
      disposed = true
      unsub()
      root.remove()
    },
  }
}
