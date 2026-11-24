import {
  DEFAULT_DRINKS_SKIN,
  DRINKS_MENU,
  DRINK_CATEGORIES,
  defaultDrinkCustomization,
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
import type { DrinkHoldSession, DrinkHoldStorageLike } from '../hold/hold-controller.ts'
import type {
  CollectPlayerOrderResult,
  DrinksSim,
  OrderSnapshot,
  PlacePlayerOrderRequest,
  PlacePlayerOrderResult,
} from '../sim/types.ts'
import {
  resolveDrinksUiStorage,
  savePendingDrinkOrder,
  removePendingDrinkOrder,
} from './pickup-hud.ts'

export type DrinksSimLike = Pick<
  DrinksSim,
  'getSnapshot' | 'placePlayerOrder' | 'collectPlayerOrder' | 'getOrder'
>

export interface DrinksOrderPanelOptions {
  sim: DrinksSimLike
  holdSession?: DrinkHoldSession
  wallet?: DrinkWalletBackend
  storage?: DrinkHoldStorageLike | null
  skin?: DrinksShopSkinConfig
  container?: HTMLElement
  getBalance?: () => number
  onOrderPlaced?: (order: OrderSnapshot, custom: DrinkCustomization) => void
  onCollected?: (order: OrderSnapshot, item: DrinkCatalogItem) => void
  onOpenChange?: (open: boolean) => void
  onStatus?: (text: string, warn?: boolean) => void
}

export interface DrinksOrderPanelController {
  readonly root: HTMLElement
  isOpen(): boolean
  getViewMode(): 'order' | 'ticket'
  open(initialDrinkId?: string): void
  close(): void
  selectCategory(category: 'all' | DrinkCategory): void
  selectDrink(drinkId: string): void
  setCustomization(patch: Partial<DrinkCustomization>): void
  setQuantity(qty: number): void
  submitOrder(): Promise<{ ok: boolean; code: string; order?: OrderSnapshot }>
  collectActiveOrder(): CollectPlayerOrderResult
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
 * 王城饮品店点单与取餐全流程抽屉：
 * - 严格按 `docs/design-rules.md` 设计：零标语、零引导句、零次要标签、一屏至多一个朱砂主动作
 * - 完整覆盖：选品 -> 冰糖规格 -> 杯数 -> 主钱包原子扣款 -> 取餐号与进度等待 -> 当场或叫号台取杯
 */
export function mountDrinksOrderPanel(opts: DrinksOrderPanelOptions): DrinksOrderPanelController {
  const skin = opts.skin ?? DEFAULT_DRINKS_SKIN
  const host = opts.container ?? document.body
  const storage = resolveDrinksUiStorage(opts.storage)

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
    <div class="drinks-order-body" data-drinks-order-view>
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
    <div class="drinks-ticket-view" data-drinks-ticket-view hidden></div>
  `
  host.append(root)

  const balanceEl = root.querySelector<HTMLElement>('[data-drinks-balance]')!
  const orderBodyEl = root.querySelector<HTMLElement>('[data-drinks-order-view]')!
  const ticketViewEl = root.querySelector<HTMLElement>('[data-drinks-ticket-view]')!
  const listEl = root.querySelector<HTMLElement>('[data-drinks-list]')!
  const detailEl = root.querySelector<HTMLElement>('[data-drinks-detail]')!
  const closeBtn = root.querySelector<HTMLButtonElement>('[data-drinks-action="close"]')!
  const tabBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-drinks-cat]'))

  let openState = false
  let viewMode: 'order' | 'ticket' = 'order'
  let activeOrderId: string | null = null
  let activeCategory: 'all' | DrinkCategory = 'all'
  let selectedId = DRINKS_MENU[0]?.id ?? 'ice_lemon_water'
  let custom: DrinkCustomization = defaultDrinkCustomization(getDrinkById(selectedId)!)
  let quantity = 1
  let attemptSeq = 1
  let currentAttemptKey = createAttemptKey(selectedId, quantity, custom, attemptSeq)
  let paying = false
  let statusText = ''
  let statusWarn = false
  const orderCustoms = new Map<string, DrinkCustomization>()

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

  function findActivePlayerOrder(): OrderSnapshot | null {
    if (activeOrderId) {
      const byId = opts.sim.getOrder(activeOrderId)
      if (byId && (byId.status === 'queued' || byId.status === 'preparing' || byId.status === 'ready_for_pickup')) {
        return byId
      }
    }
    const snap = opts.sim.getSnapshot()
    return (
      snap.orders.find(
        o =>
          o.source === 'player' &&
          (o.status === 'queued' || o.status === 'preparing' || o.status === 'ready_for_pickup'),
      ) ?? null
    )
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
        <span class="drinks-detail-meta">${item.volumeMl}ml</span>
      </div>
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

  function renderTicketView(ord: OrderSnapshot): void {
    const pct = Math.round(Math.max(0, Math.min(1, ord.progress)) * 100)
    const ready = ord.status === 'ready_for_pickup'
    const c = orderCustoms.get(ord.id) ?? orderCustoms.get(ord.orderKey) ?? custom
    const stateLabel = ready ? '请取杯' : ord.status === 'preparing' ? `制作 ${pct}%` : '排队'
    const bal = readBalance()
    balanceEl.textContent = `¥${bal.toLocaleString('zh-CN')}`

    ticketViewEl.innerHTML = `
      <div class="drinks-ticket-card" data-ticket-order-id="${escapeHtml(ord.id)}">
        <div class="drinks-ticket-top">
          <strong class="drinks-ticket-code">${escapeHtml(ord.ticketNo)}</strong>
          <span class="drinks-ticket-phase${ready ? ' is-ready' : ''}">${escapeHtml(stateLabel)}</span>
        </div>
        <div class="drinks-ticket-item">
          <span>${escapeHtml(ord.itemName)}${ord.quantity > 1 ? ` ×${ord.quantity}` : ''}</span>
          <b>¥${ord.totalPrice}</b>
        </div>
        <div class="drinks-ticket-spec">${escapeHtml(c.ice)} · ${escapeHtml(c.sugar)}</div>
        <div class="drinks-ticket-bar" aria-hidden="true"><i style="transform:scaleX(${ready ? 1 : Math.max(0.06, Math.min(1, ord.progress))})"></i></div>
      </div>
      <div class="drinks-ticket-actions">
        <button type="button" class="drinks-btn" data-drinks-action="new-order">再点</button>
        ${
          ready
            ? `<button type="button" class="drinks-btn drinks-btn--primary drinks-pay-btn" data-drinks-collect="${escapeHtml(ord.id)}">取杯</button>`
            : `<button type="button" class="drinks-btn drinks-pay-btn" data-drinks-action="close">候餐</button>`
        }
      </div>
    `
  }

  function sync(): void {
    if (viewMode === 'ticket') {
      const ord = findActivePlayerOrder()
      if (ord) {
        activeOrderId = ord.id
        orderBodyEl.hidden = true
        ticketViewEl.hidden = false
        renderTicketView(ord)
        return
      }
      viewMode = 'order'
      activeOrderId = null
    }
    orderBodyEl.hidden = false
    ticketViewEl.hidden = true
    renderTabs()
    renderMenu()
    renderDetail()
  }

  function open(initialDrinkId?: string): void {
    if (initialDrinkId && getDrinkById(initialDrinkId)) {
      selectDrink(initialDrinkId)
    } else {
      const activeOrd = findActivePlayerOrder()
      if (activeOrd) {
        activeOrderId = activeOrd.id
        viewMode = 'ticket'
      } else {
        viewMode = 'order'
      }
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
    viewMode = 'order'
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
    viewMode = 'order'
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

  function collectActiveOrder(orderIdOrKey?: string): CollectPlayerOrderResult {
    const targetId = orderIdOrKey ?? activeOrderId ?? findActivePlayerOrder()?.id ?? ''
    if (!targetId) {
      return { ok: false, code: 'ORDER_NOT_FOUND' }
    }
    const res = opts.sim.collectPlayerOrder(targetId)
    if (res.ok && res.order) {
      const catItem = getDrinkById(res.order.itemId)
      if (catItem) {
        const c = orderCustoms.get(res.order.id) ?? orderCustoms.get(res.order.orderKey) ?? custom
        opts.holdSession?.pickup(catItem, c, res.order.id)
        opts.onCollected?.(res.order, catItem)
      }
      removePendingDrinkOrder(storage, res.order.id)
      removePendingDrinkOrder(storage, res.order.orderKey)
      activeOrderId = null
      viewMode = 'order'
      close()
    } else {
      sync()
    }
    return res
  }

  async function submitOrder(): Promise<{ ok: boolean; code: string; order?: OrderSnapshot }> {
    const item = getDrinkById(selectedId)
    if (!item) return { ok: false, code: 'INVALID_ITEM' }
    if (paying) return { ok: false, code: 'IN_FLIGHT' }

    const snap = opts.sim.getSnapshot()
    if (!snap.isOpen) {
      setStatus('已打烊', true)
      sync()
      return { ok: false, code: 'SHOP_CLOSED' }
    }

    paying = true
    const idempotencyKey = currentAttemptKey
    try {
      const activeWallet = await ensureWallet()
      if (!activeWallet) {
        setStatus('钱包未就绪', true)
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
          setStatus(`余额不足，差 ¥${payRes.deficit ?? 0}`, true)
        } else if (payRes.code === 'IN_FLIGHT') {
          setStatus('处理中', true)
        } else {
          setStatus(`失败（${payRes.code}）`, true)
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
        setStatus(simRes.code === 'SHOP_CLOSED' ? '已打烊，已退款' : `接单失败（${simRes.code}）`, true)
        sync()
        return { ok: false, code: simRes.code }
      }

      const placedOrder = simRes.order
      const placedCustom = { ...custom }
      orderCustoms.set(placedOrder.id, placedCustom)
      orderCustoms.set(placedOrder.orderKey, placedCustom)
      savePendingDrinkOrder(storage, {
        orderId: placedOrder.id,
        orderKey: placedOrder.orderKey,
        ticketNo: placedOrder.ticketNo,
        itemId: placedOrder.itemId,
        itemName: placedOrder.itemName,
        quantity: placedOrder.quantity,
        customization: placedCustom,
        placedAtMs: Date.now(),
      })

      activeOrderId = placedOrder.id
      viewMode = 'ticket'
      setStatus(`${placedOrder.ticketNo} 制作中`, false)
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

  ticketViewEl.addEventListener('click', e => {
    const target = e.target as Element | null
    if (!target) return
    if (target.closest('[data-drinks-action="new-order"]')) {
      viewMode = 'order'
      statusText = ''
      statusWarn = false
      sync()
      return
    }
    if (target.closest('[data-drinks-action="close"]')) {
      close()
      return
    }
    const colBtn = target.closest<HTMLButtonElement>('[data-drinks-collect]')
    if (colBtn) {
      collectActiveOrder(colBtn.dataset.drinksCollect)
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
    getViewMode: () => viewMode,
    open,
    close,
    selectCategory,
    selectDrink,
    setCustomization,
    setQuantity,
    submitOrder,
    collectActiveOrder,
    sync,
    dispose() {
      close()
      window.removeEventListener('keydown', onKeyDown)
      root.remove()
    },
  }
}
