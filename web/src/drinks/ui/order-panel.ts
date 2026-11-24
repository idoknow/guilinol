import {
  DEFAULT_DRINKS_SKIN,
  DRINKS_MENU,
  DRINK_CATEGORIES,
  defaultDrinkCustomization,
  formatDrinkDuration,
  getDrinkById,
  listDrinksByCategory,
  normalizeDrinkQuantity,
  quoteDrinkTotal,
  type DrinkCatalogItem,
  type DrinkCategory,
  type DrinkCustomization,
  type DrinksShopSkinConfig,
} from '../menu/menu.ts'
import {
  purchaseDrinkWithWallet,
  refundDrinkWithWallet,
  type DrinkWalletBackend,
} from '../hold/payment-core.ts'
import type { DrinkHoldSession } from '../hold/hold-controller.ts'
import type { DrinksSim, OrderSnapshot, PlacePlayerOrderRequest, PlacePlayerOrderResult, CollectPlayerOrderResult } from '../sim/types.ts'

export type DrinksSimLike = Pick<
  DrinksSim,
  'getSnapshot' | 'placePlayerOrder' | 'collectPlayerOrder' | 'getOrder'
>

export interface DrinksOrderPanelOptions {
  sim: DrinksSimLike
  holdSession?: DrinkHoldSession
  wallet?: DrinkWalletBackend
  skin?: DrinksShopSkinConfig
  container?: HTMLElement
  getBalance?: () => number
  onOrderPlaced?: (order: OrderSnapshot, custom: DrinkCustomization) => void
  onOpenChange?: (open: boolean) => void
  onStatus?: (text: string, warn?: boolean) => void
}

export interface DrinksOrderPanelController {
  readonly root: HTMLElement
  isOpen(): boolean
  open(initialDrinkId?: string): void
  close(): void
  selectCategory(category: 'all' | DrinkCategory): void
  selectDrink(drinkId: string): void
  setCustomization(patch: Partial<DrinkCustomization>): void
  setQuantity(qty: number): void
  submitOrder(): Promise<{ ok: boolean; code: string; order?: OrderSnapshot }>
  sync(): void
  dispose(): void
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function createAttemptKey(itemId: string, qty: number, custom: DrinkCustomization, seq: number): string {
  return `drink_ord_${itemId}_${qty}_${custom.ice}_${custom.sugar}_${seq}`
}

/**
 * 王城饮品店菜单与点单面板：
 * - 遵循全组 `docs/design-rules.md`（无标语、无引导句、无渐变、无 emoji，单一朱砂主动作按钮）
 * - 扣款走主游戏钱包 `drinks/hold/payment.ts`，防重复点击、防余额不足、门店拒单自动退款
 */
export function mountDrinksOrderPanel(opts: DrinksOrderPanelOptions): DrinksOrderPanelController {
  const skin = opts.skin ?? DEFAULT_DRINKS_SKIN
  const host = opts.container ?? document.body

  const root = document.createElement('section')
  root.className = 'drinks-panel drinks-order-panel'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', `${skin.displayName}点单`)
  root.hidden = true

  root.innerHTML = `
    <header class="drinks-panel-head">
      <div class="drinks-head-title">
        <h3>${escapeHtml(skin.displayName)}</h3>
        <span class="drinks-balance" data-drinks-balance>¥0</span>
      </div>
      <button type="button" class="drinks-btn" data-drinks-action="close" aria-label="关闭点单">关闭</button>
    </header>
    <div class="drinks-order-body">
      <div class="drinks-menu-col">
        <div class="drinks-tabs" role="tablist" aria-label="饮品分类">
          ${DRINK_CATEGORIES.map(
            c =>
              `<button type="button" class="drinks-tab" role="tab" data-drinks-cat="${c.id}" aria-selected="${c.id === 'all'}">${escapeHtml(c.label)}</button>`,
          ).join('')}
        </div>
        <div class="drinks-menu-list" data-drinks-list></div>
      </div>
      <div class="drinks-detail-col" data-drinks-detail></div>
    </div>
  `
  host.append(root)

  const balanceEl = root.querySelector<HTMLElement>('[data-drinks-balance]')!
  const listEl = root.querySelector<HTMLElement>('[data-drinks-list]')!
  const detailEl = root.querySelector<HTMLElement>('[data-drinks-detail]')!
  const closeBtn = root.querySelector<HTMLButtonElement>('[data-drinks-action="close"]')!
  const tabBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-drinks-cat]'))

  let openState = false
  let activeCategory: 'all' | DrinkCategory = 'all'
  let selectedId = DRINKS_MENU[0]?.id ?? 'ice_lemon_water'
  let custom: DrinkCustomization = defaultDrinkCustomization(getDrinkById(selectedId)!)
  let quantity = 1
  let attemptSeq = 1
  let currentAttemptKey = createAttemptKey(selectedId, quantity, custom, attemptSeq)
  let paying = false
  let statusText = ''
  let statusWarn = false

  let resolvedWallet: DrinkWalletBackend | null = opts.wallet ?? null
  let walletPromise: Promise<DrinkWalletBackend | null> | null = null

  async function ensureWallet(): Promise<DrinkWalletBackend | null> {
    if (resolvedWallet) return resolvedWallet
    if (!walletPromise) {
      walletPromise = import('../hold/payment.ts')
        .then(mod => {
          resolvedWallet = mod.mainGameDrinkWallet as unknown as DrinkWalletBackend
          return resolvedWallet
        })
        .catch(() => null)
    }
    return walletPromise
  }

  function readBalance(): number {
    if (resolvedWallet) return resolvedWallet.getBalance()
    if (opts.getBalance) return opts.getBalance()
    return 0
  }

  function bumpAttemptKey(): void {
    attemptSeq += 1
    currentAttemptKey = createAttemptKey(selectedId, quantity, custom, attemptSeq)
  }

  function setStatus(text: string, warn = false): void {
    statusText = text
    statusWarn = warn
    opts.onStatus?.(text, warn)
  }

  function renderTabs(): void {
    for (const btn of tabBtns) {
      const cat = btn.dataset.drinksCat as 'all' | DrinkCategory
      const active = cat === activeCategory
      btn.setAttribute('aria-selected', String(active))
      btn.classList.toggle('is-active', active)
    }
  }

  function renderMenu(): void {
    const items = listDrinksByCategory(activeCategory)
    listEl.innerHTML = items
      .map(item => {
        const selected = item.id === selectedId
        return `
          <button
            type="button"
            class="drinks-item${selected ? ' is-selected' : ''}"
            data-drink-id="${escapeHtml(item.id)}"
            data-price-status="${escapeHtml(item.priceStatus)}"
            aria-pressed="${selected}"
          >
            <span class="drinks-item-main">
              <i class="drinks-swatch" style="background:${escapeHtml(item.cupColor)}" aria-hidden="true"></i>
              <span class="drinks-item-name">${escapeHtml(item.name)}</span>
              <span class="drinks-item-dur">${escapeHtml(formatDrinkDuration(item.durationSec))}</span>
            </span>
            <span class="drinks-item-price">¥${item.price}</span>
          </button>
        `
      })
      .join('')
  }

  function renderDetail(): void {
    const item = getDrinkById(selectedId) ?? DRINKS_MENU[0]!
    const total = quoteDrinkTotal(item.id, quantity) ?? item.price
    const bal = readBalance()
    const simSnap = opts.sim.getSnapshot()
    const insufficient = bal < total
    const closed = !simSnap.isOpen

    balanceEl.textContent = `¥${bal.toLocaleString('zh-CN')}`

    const payLabel = closed
      ? '已打烊'
      : paying
        ? '下单中'
        : insufficient
          ? `余额不足 ¥${total}`
          : `下单 ¥${total}`

    detailEl.innerHTML = `
      <div class="drinks-detail-head">
        <strong class="drinks-detail-name">${escapeHtml(item.name)}</strong>
        <span class="drinks-detail-meta">${item.volumeMl}ml · ${escapeHtml(formatDrinkDuration(item.durationSec))}</span>
      </div>
      <ol class="drinks-steps" aria-label="制作步骤">
        ${item.steps
          .map(
            s =>
              `<li class="drinks-step"><span>${escapeHtml(s.label)}</span><b>${escapeHtml(formatDrinkDuration(s.durationSec))}</b></li>`,
          )
          .join('')}
      </ol>
      <div class="drinks-options">
        <div class="drinks-opt-group" role="group" aria-label="温度与冰度">
          ${item.iceOptions
            .map(
              ice =>
                `<button type="button" class="drinks-chip${custom.ice === ice ? ' is-on' : ''}" data-drinks-ice="${escapeHtml(ice)}" aria-pressed="${custom.ice === ice}">${escapeHtml(ice)}</button>`,
            )
            .join('')}
        </div>
        <div class="drinks-opt-group" role="group" aria-label="糖度">
          ${item.sugarOptions
            .map(
              sugar =>
                `<button type="button" class="drinks-chip${custom.sugar === sugar ? ' is-on' : ''}" data-drinks-sugar="${escapeHtml(sugar)}" aria-pressed="${custom.sugar === sugar}">${escapeHtml(sugar)}</button>`,
            )
            .join('')}
        </div>
      </div>
      <div class="drinks-status${statusWarn ? ' is-warn' : ''}" data-drinks-status ${statusText ? '' : 'hidden'}>${escapeHtml(statusText)}</div>
      <div class="drinks-order-foot">
        <div class="drinks-qty" role="group" aria-label="杯数">
          <button type="button" class="drinks-btn drinks-qty-btn" data-drinks-qty="-1" aria-label="减少杯数"${quantity <= 1 ? ' disabled' : ''}>-</button>
          <span class="drinks-qty-val" data-drinks-qty-val>${quantity}</span>
          <button type="button" class="drinks-btn drinks-qty-btn" data-drinks-qty="1" aria-label="增加杯数"${quantity >= 6 ? ' disabled' : ''}>+</button>
        </div>
        <button
          type="button"
          class="drinks-btn drinks-btn--primary drinks-pay-btn"
          data-drinks-action="pay"
          data-insufficient="${insufficient ? '1' : '0'}"
          ${closed || paying ? 'disabled' : ''}
        >${escapeHtml(payLabel)}</button>
      </div>
    `
  }

  function sync(): void {
    renderTabs()
    renderMenu()
    renderDetail()
  }

  function open(initialDrinkId?: string): void {
    if (initialDrinkId && getDrinkById(initialDrinkId)) {
      selectDrink(initialDrinkId)
    }
    openState = true
    root.hidden = false
    document.body.dataset.drinksUiOpen = '1'
    sync()
    opts.onOpenChange?.(true)
  }

  function close(): void {
    if (!openState && root.hidden) return
    openState = false
    root.hidden = true
    delete document.body.dataset.drinksUiOpen
    opts.onOpenChange?.(false)
  }

  function selectCategory(category: 'all' | DrinkCategory): void {
    activeCategory = category
    const visible = listDrinksByCategory(category)
    if (visible.length > 0 && !visible.some(i => i.id === selectedId)) {
      selectDrink(visible[0]!.id)
      return
    }
    sync()
  }

  function selectDrink(drinkId: string): void {
    const item = getDrinkById(drinkId)
    if (!item) return
    selectedId = item.id
    custom = defaultDrinkCustomization(item)
    quantity = 1
    statusText = ''
    statusWarn = false
    bumpAttemptKey()
    sync()
  }

  function setCustomization(patch: Partial<DrinkCustomization>): void {
    const item = getDrinkById(selectedId)
    if (!item) return
    if (patch.ice && item.iceOptions.includes(patch.ice)) {
      custom = { ...custom, ice: patch.ice }
    }
    if (patch.sugar && item.sugarOptions.includes(patch.sugar)) {
      custom = { ...custom, sugar: patch.sugar }
    }
    bumpAttemptKey()
    sync()
  }

  function setQuantity(qty: number): void {
    const safe = normalizeDrinkQuantity(qty)
    if (safe === null) return
    quantity = safe
    bumpAttemptKey()
    sync()
  }

  async function submitOrder(): Promise<{ ok: boolean; code: string; order?: OrderSnapshot }> {
    const item = getDrinkById(selectedId)
    if (!item) return { ok: false, code: 'INVALID_ITEM' }
    if (paying) return { ok: false, code: 'IN_FLIGHT' }

    const snap = opts.sim.getSnapshot()
    if (!snap.isOpen) {
      setStatus('门店已打烊', true)
      sync()
      return { ok: false, code: 'SHOP_CLOSED' }
    }

    paying = true
    const idempotencyKey = currentAttemptKey
    try {
      const activeWallet = await ensureWallet()
      if (!activeWallet) {
        setStatus('钱包模块未就绪', true)
        sync()
        return { ok: false, code: 'WALLET_UNAVAILABLE' }
      }
      const payRes = purchaseDrinkWithWallet(
        {
          shopId: skin.shopId,
          menuItemId: item.id,
          quantity,
          expectedUnitPrice: item.price,
          idempotencyKey,
        },
        activeWallet,
      )

      if (!payRes.ok) {
        if (payRes.code === 'INSUFFICIENT_FUNDS') {
          setStatus(`余额不足，还差 ¥${payRes.deficit ?? 0}`, true)
        } else if (payRes.code === 'IN_FLIGHT') {
          setStatus('正在处理当前点单', true)
        } else {
          setStatus(`点单失败（${payRes.code}）`, true)
        }
        sync()
        return { ok: false, code: payRes.code }
      }

      const orderReq: PlacePlayerOrderRequest = {
        menuItemId: item.id,
        quantity,
        orderKey: idempotencyKey,
        customerName: '我',
      }
      const simRes: PlacePlayerOrderResult = opts.sim.placePlayerOrder(orderReq)
      if (!simRes.ok || !simRes.order) {
        // 下单被门店拒绝且本次确实扣了款 -> 立即原子退款
        if (payRes.charged > 0) {
          refundDrinkWithWallet(
            {
              shopId: skin.shopId,
              menuItemId: item.id,
              quantity,
              amount: payRes.charged,
              idempotencyKey,
              reason: simRes.code,
            },
            activeWallet,
          )
        }
        setStatus(simRes.code === 'SHOP_CLOSED' ? '门店已打烊，已退款' : `接单失败（${simRes.code}）`, true)
        sync()
        return { ok: false, code: simRes.code }
      }

      setStatus(`已下单 ${simRes.order.ticketNo} · 制作中`, false)
      const placedOrder = simRes.order
      const placedCustom = { ...custom }
      bumpAttemptKey()
      sync()
      opts.onOrderPlaced?.(placedOrder, placedCustom)
      return { ok: true, code: 'OK', order: placedOrder }
    } finally {
      paying = false
      sync()
    }
  }

  closeBtn.addEventListener('click', () => close())
  for (const btn of tabBtns) {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.drinksCat as 'all' | DrinkCategory
      selectCategory(cat)
    })
  }

  listEl.addEventListener('click', e => {
    const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('[data-drink-id]')
    if (!btn) return
    selectDrink(btn.dataset.drinkId!)
  })

  detailEl.addEventListener('click', e => {
    const target = e.target as Element | null
    if (!target) return
    const iceBtn = target.closest<HTMLButtonElement>('[data-drinks-ice]')
    if (iceBtn) {
      setCustomization({ ice: iceBtn.dataset.drinksIce as DrinkCustomization['ice'] })
      return
    }
    const sugarBtn = target.closest<HTMLButtonElement>('[data-drinks-sugar]')
    if (sugarBtn) {
      setCustomization({ sugar: sugarBtn.dataset.drinksSugar as DrinkCustomization['sugar'] })
      return
    }
    const qtyBtn = target.closest<HTMLButtonElement>('[data-drinks-qty]')
    if (qtyBtn) {
      const delta = Number(qtyBtn.dataset.drinksQty)
      setQuantity(quantity + delta)
      return
    }
    const payBtn = target.closest<HTMLButtonElement>('[data-drinks-action="pay"]')
    if (payBtn) {
      void submitOrder()
    }
  })

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Escape' && openState) {
      event.stopPropagation()
      close()
    }
  }
  window.addEventListener('keydown', onKeyDown)

  if (!resolvedWallet && typeof window !== 'undefined') {
    void ensureWallet().then(w => {
      if (w && openState) sync()
    })
  }
  sync()

  return {
    root,
    isOpen: () => openState,
    open,
    close,
    selectCategory,
    selectDrink,
    setCustomization,
    setQuantity,
    submitOrder,
    sync,
    dispose() {
      close()
      window.removeEventListener('keydown', onKeyDown)
      root.remove()
    },
  }
}
