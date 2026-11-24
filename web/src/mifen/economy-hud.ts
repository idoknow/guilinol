import type { ActiveCookOrder } from './cooking'
import type { DeliveryOrder, IngredientKey, MifenRecipe, MifenRecipesData } from './types'
import { computeShopBonuses, formatMoney, formatRecipeTitle, type MifenStore } from './state'
import {
  ECONOMY_UI_SLOTS,
  getRetailUnitPrice,
  quoteDeliveryOrder,
  resolveDeliveryZones,
  resolveEconomyConfig,
  resolveInventoryItems,
  resolveRetailSkus,
  type EconomyUiActionSlot,
  type MifenEconomyEngine,
} from './economy'

import type { MifenSoundId } from './audio/catalog'

export type EconomyPanelKey = EconomyUiActionSlot['id']

/** 与堂食粉票同形，直接进粉票栏和做粉流程 */
export interface DeliveryRailTicket {
  id: string
  customerName: string
  archetype: ActiveCookOrder['archetype']
  recipe: MifenRecipe
  /** 接单时的外卖报价，替代菜单价显示在粉票上 */
  price: number
  patienceRatio: number
  patienceSecLeft: number
  beingCooked: boolean
}

export interface EconomyHudOptions {
  container: HTMLElement
  economy: MifenEconomyEngine
  store: MifenStore
  recipesData: MifenRecipesData
  getHour: () => number
  canEarn?: () => boolean
  onSound?: (id: MifenSoundId) => void
  notify: (text: string, meta?: string, warn?: boolean) => void
  /** 面板开合或外卖票变化后，由外层重绘经营条与粉票 */
  onChange: () => void
}

export interface EconomyHud {
  getOpenPanel(): EconomyPanelKey | null
  open(key: EconomyPanelKey): void
  close(): void
  toggle(key: EconomyPanelKey): void
  syncBar(bar: HTMLElement): void
  getDeliveryTickets(cookingTicketId: string | null): DeliveryRailTicket[]
  isDeliveryTicket(ticketId: string): boolean
  settleDelivery(ticketId: string, stars: 1 | 2 | 3): void
  step(dt: number, cookingTicketId: string | null): void
  dispose(): void
}

interface ActiveDelivery {
  order: DeliveryOrder
  recipe: MifenRecipe
  elapsedSec: number
}

const DELIVERY_ID_PREFIX = 'dlv_'
const OFFER_COUNT = 3

const DELIVERY_ARCHETYPE: ActiveCookOrder['archetype'] = {
  id: 'delivery',
  name: '外卖',
  shirtColors: [],
  patienceSec: 60,
  tipMultiplier: 1,
  favoriteRecipes: [],
  preferredCondiments: [],
  praiseLines: [],
  impatientLines: [],
  bidMultiplier: 1,
}

const SLOT_BY_ID = new Map(ECONOMY_UI_SLOTS.actions.map(s => [s.id, s]))

function signedMoney(n: number): string {
  const abs = formatMoney(Math.abs(n))
  if (abs === '0') return '¥0'
  return `${n < 0 ? '−' : '+'}¥${abs}`
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function createEconomyHud(opts: EconomyHudOptions): EconomyHud {
  const { economy, store, recipesData, notify } = opts
  const config = resolveEconomyConfig(recipesData.economyConfig)
  const zones = resolveDeliveryZones(recipesData.deliveryZones)
  const skus = resolveRetailSkus(recipesData.retailSkus)
  const items = resolveInventoryItems(recipesData.inventoryItems)
  const itemName = new Map(items.map(i => [i.id, i.name]))

  const deliveries = new Map<string, ActiveDelivery>()
  const soldOutSkus = new Set<string>()
  let offerSeq = 0
  let openKey: EconomyPanelKey | null = null
  let lastLowKey = ''

  const panel = document.createElement('section')
  panel.className = 'mifen-panel mifen-drawer'
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  opts.container.append(panel)

  function bonuses() {
    return computeShopBonuses(store.getState(), recipesData.upgrades ?? [])
  }

  function deliveryOffers(): Array<{ zoneId: string; zoneName: string; deadlineSec: number; recipe: MifenRecipe; quote: number }> {
    const recipes = economy.getAvailableRecipes()
    if (!recipes.length || !zones.length) return []
    const seed = store.getState().day * 5 + offerSeq
    const b = bonuses()
    return Array.from({ length: Math.min(OFFER_COUNT, zones.length) }, (_, i) => {
      const zone = zones[(seed + i * 2) % zones.length]
      const recipe = recipes[(seed * 3 + i) % recipes.length]
      const quote = quoteDeliveryOrder({ id: 'offer', recipe, zone, bonuses: b, config }).quotedTotal
      return { zoneId: zone.id, zoneName: zone.name, deadlineSec: zone.deadlineSec, recipe, quote }
    })
  }

  function rowHtml(title: string, meta: string, trailing: string, extraClass = ''): string {
    return `
      <article class="mifen-row${extraClass ? ` ${extraClass}` : ''}">
        <div class="mifen-row-main">
          <strong class="mifen-row-title">${title}</strong>
          ${meta ? `<span class="mifen-row-meta">${meta}</span>` : ''}
        </div>
        ${trailing}
      </article>`
  }

  function actionButton(action: string, id: string, label: string, ariaLabel: string, enabled: boolean): string {
    return `<button type="button" class="mifen-btn" data-economy="${action}" data-id="${escapeAttr(id)}"
      aria-label="${escapeAttr(ariaLabel)}" ${enabled ? '' : 'disabled'}>${label}</button>`
  }

  function renderDelivery(): { title: string; headMeta: string; body: string } {
    const snap = economy.getDashboardSnapshot(opts.getHour())
    const used = snap.deliveryQuotaUsed + snap.activeDeliveries.length
    const canAccept = used < snap.deliveryQuotaMax && snap.phase !== 'closed'
    const body = deliveryOffers()
      .map(o => {
        const title = formatRecipeTitle(o.recipe)
        const price = `¥${formatMoney(o.quote)}`
        return rowHtml(
          title,
          `${o.zoneName} · ${o.deadlineSec} 秒`,
          actionButton('accept', `${o.zoneId}|${o.recipe.id}`, price, `接单，${title}，送${o.zoneName}，${price}`, canAccept),
        )
      })
      .join('')
    const headMeta = snap.phase === 'closed' ? '打烊' : `${used}/${snap.deliveryQuotaMax}`
    return { title: '外卖', headMeta, body }
  }

  function renderRetail(): { title: string; headMeta: string; body: string } {
    const state = store.getState()
    const b = bonuses()
    const body = skus
      .filter(sku => sku.minShopLevel <= state.shopLevel)
      .map(sku => {
        const uses = Object.entries(sku.consumes) as Array<[IngredientKey, number]>
        const enough = uses.every(([k, v]) => (state.inventory[k] ?? 0) >= v)
        const soldOut = soldOutSkus.has(sku.id)
        const price = `¥${formatMoney(getRetailUnitPrice(sku, b))}`
        const label = soldOut ? '售罄' : price
        return rowHtml(
          sku.name,
          uses.map(([k, v]) => `${itemName.get(k) ?? k} ${v}`).join(' · '),
          actionButton('sell', sku.id, label, `卖出${sku.name}，${label}`, enough && !soldOut),
        )
      })
      .join('')
    return { title: '外售', headMeta: '', body }
  }

  function renderRestock(): { title: string; headMeta: string; body: string } {
    const state = store.getState()
    const low = new Set(economy.getDashboardSnapshot(opts.getHour()).lowStock)
    const body = items
      .map(item => {
        const q = economy.getRestockQuote(item.id, 1)
        const stock = Math.floor(state.inventory[item.id] ?? 0)
        const isLow = low.has(item.id)
        const full = q.actualUnits <= 0
        const label = full ? '已满' : `+${q.actualUnits} · ¥${formatMoney(q.totalCost)}`
        return rowHtml(
          item.name,
          `${stock}/${q.cap} ${item.unit}${isLow ? ' · 偏低' : ''}`,
          actionButton(
            'restock',
            item.id,
            label,
            full ? `${item.name}已满` : `进${item.name} ${q.actualUnits} ${item.unit}，¥${formatMoney(q.totalCost)}`,
            !full && state.funds + 0.001 >= q.totalCost,
          ),
          isLow ? 'is-low' : '',
        )
      })
      .join('')
    return { title: '进货', headMeta: '', body }
  }

  function renderLedger(): { title: string; headMeta: string; body: string } {
    const { day, today } = store.getState()
    const labels = ECONOMY_UI_SLOTS.streamLabels
    const value = (n: number) => `<b class="mifen-row-value">${signedMoney(n)}</b>`
    const body =
      rowHtml(labels.dine_in, `${today.dineInBowls} 碗`, value(today.dineInNet)) +
      rowHtml(labels.delivery, `${today.deliveriesCompleted} 单`, value(today.deliveryNet)) +
      rowHtml(labels.retail, `${today.retailUnitsSold} 件`, value(today.retailNet)) +
      rowHtml('进货', '', value(-today.restockSpend)) +
      `<div class="mifen-panel-foot">
        <button type="button" class="mifen-btn mifen-btn--primary" data-economy="close-day" data-id="day"
          aria-label="打烊，结算第 ${day} 日">打烊</button>
      </div>`
    return { title: `第 ${day} 日`, headMeta: '', body }
  }

  function render(): void {
    if (!openKey) return
    const focused = panel.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null
    const focusKey = focused?.dataset.economy ? `${focused.dataset.economy}|${focused.dataset.id ?? ''}` : ''

    const view =
      openKey === 'delivery'
        ? renderDelivery()
        : openKey === 'retail'
          ? renderRetail()
          : openKey === 'restock'
            ? renderRestock()
            : renderLedger()
    const label = SLOT_BY_ID.get(openKey)?.label ?? view.title
    panel.dataset.mifenPanel = SLOT_BY_ID.get(openKey)?.panelKey ?? openKey
    panel.setAttribute('aria-label', label)
    panel.innerHTML = `
      <header class="mifen-panel-head">
        <h3>${view.title}${view.headMeta ? ` <small>${view.headMeta}</small>` : ''}</h3>
        <button type="button" class="mifen-btn" data-economy="close" aria-label="关闭${label}">关闭</button>
      </header>
      <div class="mifen-panel-body">${view.body}</div>`

    if (focusKey) {
      const [action, id] = focusKey.split('|')
      const again = Array.from(panel.querySelectorAll<HTMLButtonElement>(`[data-economy="${action}"]`)).find(
        b => (b.dataset.id ?? '') === id && !b.disabled,
      )
      ;(again ?? panel.querySelector<HTMLButtonElement>('[data-economy="close"]'))?.focus()
    }
  }

  function canOperate(): boolean {
    return opts.canEarn ? Boolean(opts.canEarn()) : true
  }

  function open(key: EconomyPanelKey): void {
    if (!canOperate()) {
      opts.onSound?.('action_reject')
      return
    }
    openKey = key
    panel.hidden = false
    render()
    opts.onChange()
  }

  function close(): void {
    if (!openKey) return
    openKey = null
    panel.hidden = true
    panel.innerHTML = ''
    opts.onChange()
  }

  function acceptDelivery(zoneId: string, recipeId: string): void {
    if (!canOperate()) {
      opts.onSound?.('action_reject')
      return
    }
    const order = economy.acceptDeliveryOrder({ recipeId, zoneId })
    const recipe = recipesData.recipes.find(r => r.id === recipeId)
    if (!order || !recipe) {
      notify('外卖已满', '', true)
      opts.onSound?.('action_reject')
      return
    }
    deliveries.set(order.id, { order, recipe, elapsedSec: 0 })
    offerSeq += 1
    render()
    opts.onChange()
  }

  function settleDelivery(ticketId: string, stars: 1 | 2 | 3): void {
    const d = deliveries.get(ticketId)
    if (!d) return
    deliveries.delete(ticketId)
    economy.completeDeliveryOrder({ orderId: ticketId, elapsedSec: Math.round(d.elapsedSec), stars })
    opts.onChange()
  }

  function closeDay(): void {
    if (!canOperate()) {
      opts.onSound?.('action_reject')
      return
    }
    for (const id of Array.from(deliveries.keys())) settleDelivery(id, 1)
    economy.closeDay()
  }

  panel.addEventListener('click', e => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('[data-economy]')
    if (!btn || btn.disabled) return
    const id = btn.dataset.id ?? ''
    if (btn.dataset.economy !== 'close' && !canOperate()) {
      opts.onSound?.('action_reject')
      close()
      return
    }
    switch (btn.dataset.economy) {
      case 'close':
        close()
        break
      case 'accept': {
        const [zoneId, recipeId] = id.split('|')
        acceptDelivery(zoneId, recipeId)
        break
      }
      case 'sell': {
        const res = economy.sellRetailSku(id, 1)
        if (res && !res.ok) {
          if (res.reason === 'DAILY_CAP_REACHED') soldOutSkus.add(id)
          notify(res.reason === 'DAILY_CAP_REACHED' ? '今日售罄' : '库存不足', '', true)
          opts.onSound?.('action_reject')
          render()
        }
        break
      }
      case 'restock': {
        const res = economy.restock(id as IngredientKey, 1)
        if (!res.ok) {
          notify(res.reason === 'AT_CAPACITY' ? '已满' : '钱不够', '', true)
          opts.onSound?.('action_reject')
        }
        break
      }
      case 'close-day':
        closeDay()
        break
    }
  })

  function onKeyDown(e: KeyboardEvent): void {
    if (openKey && e.code === 'Escape') {
      e.preventDefault()
      close()
    }
  }
  window.addEventListener('keydown', onKeyDown)

  const recipeTitle = (id: string) => {
    const r = recipesData.recipes.find(x => x.id === id)
    return r ? formatRecipeTitle(r) : id
  }

  const unsubscribers = [
    store.subscribe(() => render()),
    economy.events.on('dine_in:settled', p => {
      opts.onSound?.('cash_register')
      notify(`出餐 ${'★'.repeat(p.stars)}`, signedMoney(p.net))
    }),
    economy.events.on('delivery:completed', p => {
      opts.onSound?.('cash_register')
      notify(`送达 ${p.order.zoneName}`, signedMoney(p.net))
    }),
    economy.events.on('delivery:failed', p => notify(`超时 ${p.order.zoneName}`, p.penalty > 0 ? signedMoney(-p.penalty) : '', true)),
    economy.events.on('retail:sold', p => {
      opts.onSound?.('cash_register')
      notify(p.skuName, signedMoney(p.net))
    }),
    economy.events.on('inventory:restocked', p => {
      lastLowKey = [...economy.getDashboardSnapshot(opts.getHour()).lowStock].sort().join(',')
      notify(itemName.get(p.item) ?? p.item, signedMoney(-p.cost))
    }),
    economy.events.on('inventory:low', p => {
      const key = [...p.items].sort().join(',')
      if (key === lastLowKey) return
      const fresh = p.items.filter(k => !lastLowKey.split(',').includes(k))
      lastLowKey = key
      if (fresh.length) notify(`${fresh.map(k => itemName.get(k) ?? k).join('、')}偏低`, '', true)
    }),
    economy.events.on('day:settled', ({ ledger }) => {
      soldOutSkus.clear()
      offerSeq = 0
      notify(`第 ${ledger.day} 日打烊`, signedMoney(ledger.totalNetProfit), ledger.totalNetProfit < 0)
    }),
    economy.events.on('achievement:unlocked', p => {
      opts.onSound?.('cash_register')
      notify(p.achievement.name, signedMoney(p.rewardFunds))
    }),
    economy.events.on('recipe:unlocked', p => notify(`新粉 ${recipeTitle(p.recipeId)}`)),
    economy.events.on('rush:phase_changed', () => render()),
  ]

  return {
    getOpenPanel: () => openKey,
    open,
    close,
    toggle(key) {
      if (openKey === key) close()
      else open(key)
    },

    syncBar(bar) {
      const hour = opts.getHour()
      economy.syncHour(hour)
      const snap = economy.getDashboardSnapshot(hour)
      for (const rt of snap.uiSlots) {
        const btn = bar.querySelector<HTMLButtonElement>(`[data-hud-action="${rt.slot.hudAction}"]`)
        if (!btn) continue
        // 只标需要处理的入口：缺货、夜里该打烊；外卖与外售白天常开，不常亮
        const attention =
          rt.slot.id === 'restock' ? rt.ready : rt.slot.id === 'ledger' ? rt.ready && snap.phase === 'closed' : false
        btn.toggleAttribute('data-ready', attention)
        btn.setAttribute('aria-label', attention ? rt.ariaLabel : rt.slot.idleAriaLabel)
        btn.setAttribute('aria-expanded', String(openKey === rt.slot.id))
      }
      const phaseEl = bar.querySelector<HTMLElement>('[data-mf-stat="phase"]')
      if (phaseEl) {
        phaseEl.hidden = !snap.isMorningRush
        const b = phaseEl.querySelector('b')
        const text = `早高峰 +${Math.round(snap.rushPremiumRate * 100)}%`
        if (b && b.textContent !== text) b.textContent = text
      }
    },

    getDeliveryTickets(cookingTicketId) {
      if (!canOperate()) return []
      return Array.from(deliveries.entries())
        .map(([id, d]) => {
          const left = Math.max(0, d.order.deadlineSec - d.elapsedSec)
          return {
            id,
            customerName: d.order.zoneName,
            archetype: DELIVERY_ARCHETYPE,
            recipe: d.recipe,
            price: d.order.quotedTotal,
            patienceRatio: d.order.deadlineSec > 0 ? left / d.order.deadlineSec : 0,
            patienceSecLeft: Math.ceil(left),
            beingCooked: id === cookingTicketId,
          }
        })
        .sort((a, b) => a.patienceSecLeft - b.patienceSecLeft)
    },

    isDeliveryTicket: ticketId => ticketId.startsWith(DELIVERY_ID_PREFIX),

    settleDelivery,

    step(dt, cookingTicketId) {
      if (!canOperate()) {
        if (openKey) close()
        return
      }
      for (const [id, d] of deliveries) {
        d.elapsedSec += dt
        if (d.elapsedSec > d.order.deadlineSec && id !== cookingTicketId) settleDelivery(id, 1)
      }
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown)
      for (const off of unsubscribers) off()
      panel.remove()
    },
  }
}
