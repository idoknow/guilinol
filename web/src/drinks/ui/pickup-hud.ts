import {
  DEFAULT_DRINKS_SKIN,
  getDrinkById,
  type DrinkCatalogItem,
  type DrinkCustomization,
  type DrinksShopSkinConfig,
} from '../menu/menu.ts'
import type { DrinkHoldSession, DrinkHoldStorageLike } from '../hold/hold-controller.ts'
import type { CollectPlayerOrderResult, DrinksSim, OrderSnapshot } from '../sim/types.ts'

export const DRINK_PENDING_ORDERS_STORAGE_KEY = 'glol.drinks.pending.v1'

export interface PersistedPendingDrinkOrder {
  orderId: string
  orderKey: string
  ticketNo: string
  itemId: string
  itemName: string
  quantity: number
  customization: DrinkCustomization
  placedAtMs: number
}

export function resolveDrinksUiStorage(opt: DrinkHoldStorageLike | null | undefined): DrinkHoldStorageLike | null {
  if (opt === null) return null
  if (opt !== undefined) return opt
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage
    }
  } catch {
    // 隐私模式禁用 storage 时静默退回纯内存
  }
  return null
}

export function loadPendingDrinkOrders(storage: DrinkHoldStorageLike | null): PersistedPendingDrinkOrder[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(DRINK_PENDING_ORDERS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is PersistedPendingDrinkOrder =>
        Boolean(x) &&
        typeof x.orderKey === 'string' &&
        typeof x.itemId === 'string' &&
        Number.isSafeInteger(x.quantity) &&
        x.quantity >= 1,
    )
  } catch {
    return []
  }
}

export function savePendingDrinkOrder(
  storage: DrinkHoldStorageLike | null,
  record: PersistedPendingDrinkOrder,
): void {
  if (!storage) return
  try {
    const list = loadPendingDrinkOrders(storage).filter(x => x.orderKey !== record.orderKey)
    list.push(record)
    storage.setItem(DRINK_PENDING_ORDERS_STORAGE_KEY, JSON.stringify(list.slice(-8)))
  } catch {
    // ignore storage quota errors
  }
}

export function removePendingDrinkOrder(storage: DrinkHoldStorageLike | null, orderIdOrKey: string): void {
  if (!storage || !orderIdOrKey) return
  try {
    const next = loadPendingDrinkOrders(storage).filter(
      x => x.orderId !== orderIdOrKey && x.orderKey !== orderIdOrKey,
    )
    if (next.length === 0) storage.removeItem(DRINK_PENDING_ORDERS_STORAGE_KEY)
    else storage.setItem(DRINK_PENDING_ORDERS_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

export type DrinksPickupSimLike = Pick<DrinksSim, 'getSnapshot' | 'collectPlayerOrder' | 'getOrder'> &
  Partial<Pick<DrinksSim, 'placePlayerOrder'>>

export interface DrinksPickupHudOptions {
  sim: DrinksPickupSimLike
  holdSession?: DrinkHoldSession
  storage?: DrinkHoldStorageLike | null
  skin?: DrinksShopSkinConfig
  container?: HTMLElement
  onOpenOrder?: () => void
  onCollected?: (order: OrderSnapshot, item: DrinkCatalogItem) => void
}

export interface DrinksPickupHudController {
  readonly root: HTMLElement
  setVisible(visible: boolean): void
  rememberCustomization(orderIdOrKey: string, custom: DrinkCustomization): void
  restorePendingOrders(): number
  collectOrder(orderIdOrKey: string): CollectPlayerOrderResult
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

/**
 * 王城饮品店叫号与取餐界面：
 * - 实时呈现门店自主制作/叫号队列（玩家不下单也有活跃 NPC 出餐节奏）
 * - 支持页面刷新恢复未取走的已付款取餐单（`glol.drinks.pending.v1`）
 * - 严格保持一屏至多一个朱砂主动作按钮
 */
export function mountDrinksPickupHud(opts: DrinksPickupHudOptions): DrinksPickupHudController {
  const skin = opts.skin ?? DEFAULT_DRINKS_SKIN
  const host = opts.container ?? document.body
  const storage = resolveDrinksUiStorage(opts.storage)

  const root = document.createElement('aside')
  root.className = 'drinks-panel drinks-pickup-hud'
  root.setAttribute('aria-label', `${skin.shortName}叫号台`)
  root.hidden = false
  host.append(root)

  const playerCustomMap = new Map<string, DrinkCustomization>()
  let visibleFlag = true
  let lastRenderKey = ''

  function restorePendingOrders(): number {
    const records = loadPendingDrinkOrders(storage)
    let restoredCount = 0
    for (const rec of records) {
      playerCustomMap.set(rec.orderKey, rec.customization)
      playerCustomMap.set(rec.orderId, rec.customization)
      const existing = opts.sim.getOrder(rec.orderKey) ?? opts.sim.getOrder(rec.orderId)
      if (existing) {
        if (
          existing.status === 'queued' ||
          existing.status === 'preparing' ||
          existing.status === 'ready_for_pickup'
        ) {
          restoredCount += 1
        } else {
          removePendingDrinkOrder(storage, rec.orderKey)
        }
        continue
      }
      if (opts.sim.placePlayerOrder) {
        const res = opts.sim.placePlayerOrder({
          menuItemId: rec.itemId,
          quantity: rec.quantity,
          orderKey: rec.orderKey,
          customerName: '我',
        })
        if (res.ok && res.order) {
          playerCustomMap.set(res.order.id, rec.customization)
          savePendingDrinkOrder(storage, { ...rec, orderId: res.order.id, ticketNo: res.order.ticketNo })
          restoredCount += 1
        }
      }
    }
    return restoredCount
  }

  function collectOrder(orderIdOrKey: string): CollectPlayerOrderResult {
    const res = opts.sim.collectPlayerOrder(orderIdOrKey)
    if (res.ok && res.order) {
      const catItem = getDrinkById(res.order.itemId)
      if (catItem) {
        const custom = playerCustomMap.get(res.order.id) ?? playerCustomMap.get(res.order.orderKey)
        opts.holdSession?.pickup(catItem, custom, res.order.id)
        opts.onCollected?.(res.order, catItem)
      }
      playerCustomMap.delete(res.order.id)
      playerCustomMap.delete(res.order.orderKey)
      removePendingDrinkOrder(storage, res.order.id)
      removePendingDrinkOrder(storage, res.order.orderKey)
    }
    lastRenderKey = ''
    render()
    return res
  }

  function render(): void {
    if (!visibleFlag) {
      root.hidden = true
      return
    }
    const snap = opts.sim.getSnapshot()
    const activeOrders = snap.orders.filter(
      o => o.status === 'queued' || o.status === 'preparing' || o.status === 'ready_for_pickup',
    )
    const myOrders = activeOrders.filter(o => o.source === 'player')
    const myIds = new Set(myOrders.map(o => o.id))
    const totalMaking = activeOrders.filter(o => o.status === 'queued' || o.status === 'preparing').length
    const totalReady = activeOrders.filter(o => o.status === 'ready_for_pickup').length
    const makingList = activeOrders
      .filter(o => !myIds.has(o.id) && (o.status === 'queued' || o.status === 'preparing'))
      .slice(0, 3)
    const readyList = activeOrders
      .filter(o => !myIds.has(o.id) && o.status === 'ready_for_pickup')
      .slice(0, 3)
    const holdSnap = opts.holdSession?.getSnapshot()
    const holdingDrinkNow = Boolean(holdSnap?.active && !holdSnap.paused)

    const renderKey = JSON.stringify({
      open: snap.isOpen,
      holding: holdingDrinkNow,
      totalMaking,
      totalReady,
      my: myOrders.map(o => [o.id, o.status, Math.round(o.progress * 20)]),
      making: makingList.map(o => [o.ticketNo, o.status]),
      ready: readyList.map(o => o.ticketNo),
    })
    if (renderKey === lastRenderKey) return
    lastRenderKey = renderKey
    root.hidden = false

    let primaryUsed = holdingDrinkNow
    const myHtml = myOrders.length
      ? `<div class="drinks-my-orders" aria-label="我的取餐单">
          ${myOrders
            .map(ord => {
              const ready = ord.status === 'ready_for_pickup'
              const pct = Math.round(Math.max(0, Math.min(1, ord.progress)) * 100)
              const usePrimary = ready && !primaryUsed
              if (usePrimary) primaryUsed = true
              return `
                <div class="drinks-ticket-row${ready ? ' is-ready' : ''}" data-order-id="${escapeHtml(ord.id)}">
                  <div class="drinks-ticket-info">
                    <span class="drinks-ticket-no">${escapeHtml(ord.ticketNo)}</span>
                    <span class="drinks-ticket-name">${escapeHtml(ord.itemName)}${ord.quantity > 1 ? ` ×${ord.quantity}` : ''}</span>
                  </div>
                  ${
                    ready
                      ? `<button type="button" class="drinks-btn${usePrimary ? ' drinks-btn--primary' : ''} drinks-collect-btn" data-drinks-collect="${escapeHtml(ord.id)}">取杯</button>`
                      : `<span class="drinks-ticket-state">${ord.status === 'preparing' ? `制作 ${pct}%` : '排队'}</span>`
                  }
                </div>
              `
            })
            .join('')}
        </div>`
      : ''

    root.innerHTML = `
      <header class="drinks-pickup-head">
        <div class="drinks-pickup-title">
          <strong>叫号</strong>
          <span class="drinks-pickup-count">${snap.isOpen ? `${totalMaking} 制 · ${totalReady} 取` : '打烊'}</span>
        </div>
        <button type="button" class="drinks-btn drinks-open-btn" data-drinks-action="open-order">点单</button>
      </header>
      ${myHtml}
      <div class="drinks-call-grid">
        <div class="drinks-call-col">
          <span class="drinks-call-label">制作中</span>
          <ul class="drinks-call-list">
            ${
              makingList.length
                ? makingList
                    .map(o => `<li><b>${escapeHtml(o.ticketNo)}</b><span>${escapeHtml(o.itemName)}</span></li>`)
                    .join('')
                : '<li class="is-empty">—</li>'
            }
          </ul>
        </div>
        <div class="drinks-call-col">
          <span class="drinks-call-label">请取餐</span>
          <ul class="drinks-call-list">
            ${
              readyList.length
                ? readyList
                    .map(o => `<li class="is-ready"><b>${escapeHtml(o.ticketNo)}</b><span>${escapeHtml(o.itemName)}</span></li>`)
                    .join('')
                : '<li class="is-empty">—</li>'
            }
          </ul>
        </div>
      </div>
    `
  }

  root.addEventListener('click', e => {
    const target = e.target as Element | null
    if (!target) return
    const openBtn = target.closest<HTMLButtonElement>('[data-drinks-action="open-order"]')
    if (openBtn) {
      opts.onOpenOrder?.()
      return
    }
    const collectBtn = target.closest<HTMLButtonElement>('[data-drinks-collect]')
    if (collectBtn) {
      collectOrder(collectBtn.dataset.drinksCollect!)
    }
  })

  restorePendingOrders()
  render()

  return {
    root,
    setVisible(visible) {
      visibleFlag = Boolean(visible)
      lastRenderKey = ''
      render()
    },
    rememberCustomization(orderIdOrKey, custom) {
      playerCustomMap.set(orderIdOrKey, custom)
    },
    restorePendingOrders,
    collectOrder,
    sync: render,
    dispose() {
      root.remove()
    },
  }
}
