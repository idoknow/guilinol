import { DEFAULT_DRINKS_SKIN, getDrinkById, type DrinkCatalogItem, type DrinkCustomization, type DrinksShopSkinConfig } from '../menu/menu.ts'
import type { DrinkHoldSession } from '../hold/hold-controller.ts'
import type { CollectPlayerOrderResult, DrinksSim, OrderSnapshot } from '../sim/types.ts'

export interface DrinksPickupHudOptions {
  sim: Pick<DrinksSim, 'getSnapshot' | 'collectPlayerOrder' | 'getOrder'>
  holdSession?: DrinkHoldSession
  skin?: DrinksShopSkinConfig
  container?: HTMLElement
  onOpenOrder?: () => void
  onCollected?: (order: OrderSnapshot, item: DrinkCatalogItem) => void
}

export interface DrinksPickupHudController {
  readonly root: HTMLElement
  setVisible(visible: boolean): void
  rememberCustomization(orderIdOrKey: string, custom: DrinkCustomization): void
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
 * - 玩家自己的取餐单叫号就绪后呈现单一朱砂「取杯」按钮，点击后杯子交到右手 `DrinkHoldSession`
 */
export function mountDrinksPickupHud(opts: DrinksPickupHudOptions): DrinksPickupHudController {
  const skin = opts.skin ?? DEFAULT_DRINKS_SKIN
  const host = opts.container ?? document.body

  const root = document.createElement('aside')
  root.className = 'drinks-panel drinks-pickup-hud'
  root.setAttribute('aria-label', `${skin.shortName}叫号台`)
  root.hidden = false
  host.append(root)

  const playerCustomMap = new Map<string, DrinkCustomization>()
  let visibleFlag = true
  let lastRenderKey = ''

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
    const makingList = activeOrders.filter(o => o.status === 'queued' || o.status === 'preparing').slice(0, 3)
    const readyList = activeOrders.filter(o => o.status === 'ready_for_pickup').slice(0, 3)

    const renderKey = JSON.stringify({
      open: snap.isOpen,
      my: myOrders.map(o => [o.id, o.status, Math.round(o.progress * 20)]),
      making: makingList.map(o => [o.ticketNo, o.status]),
      ready: readyList.map(o => o.ticketNo),
    })
    if (renderKey === lastRenderKey) return
    lastRenderKey = renderKey
    root.hidden = false

    const myHtml = myOrders.length
      ? `<div class="drinks-my-orders" aria-label="我的取餐单">
          ${myOrders
            .map(ord => {
              const ready = ord.status === 'ready_for_pickup'
              const pct = Math.round(Math.max(0, Math.min(1, ord.progress)) * 100)
              return `
                <div class="drinks-ticket-row${ready ? ' is-ready' : ''}" data-order-id="${escapeHtml(ord.id)}">
                  <div class="drinks-ticket-info">
                    <span class="drinks-ticket-no">${escapeHtml(ord.ticketNo)}</span>
                    <span class="drinks-ticket-name">${escapeHtml(ord.itemName)}${ord.quantity > 1 ? ` ×${ord.quantity}` : ''}</span>
                  </div>
                  ${
                    ready
                      ? `<button type="button" class="drinks-btn drinks-btn--primary drinks-collect-btn" data-drinks-collect="${escapeHtml(ord.id)}">取杯</button>`
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
          <strong>叫号屏</strong>
          <span class="drinks-pickup-count">${snap.isOpen ? `制作 ${makingList.length} · 待取 ${readyList.length}` : '已打烊'}</span>
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
    collectOrder,
    sync: render,
    dispose() {
      root.remove()
    },
  }
}
