import type { MifenRecipesData, MifenUpgradeDef, ShopLevel } from './types.ts'
import {
  formatMoney,
  getMaxCustomersForLevel,
  getShopLevelName,
  type MifenStore,
} from './state.ts'

export interface UpgradeCallbacks {
  container: HTMLElement
  onShopLevelUp: (nextLevel: ShopLevel) => void
  onToast: (message: string) => void
  onClose?: () => void
}

export interface UpgradeController {
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  canAffordAny(): boolean
  refresh(): void
  dispose(): void
}

export interface UpgradeRecommendation {
  upgradeId: string
  name: string
  cost: number
  paybackDays: number
  affordable: boolean
}

export function estimateUpgradePaybackDays(def: MifenUpgradeDef): number {
  if (def.cost <= 0) return 0
  const e = def.effect ?? {}
  let dailyGain = 0
  if (def.kind === 'shop_level') {
    dailyGain = def.targetLevel === 3 ? 95 : 48
  } else {
    if (e.boilSpeedMultiplier && e.boilSpeedMultiplier > 1) dailyGain += 26
    if (e.priceMultiplier && e.priceMultiplier > 1) dailyGain += 32
    if (e.tipBonus) dailyGain += 14
    if (e.sliceSpeedMultiplier && e.sliceSpeedMultiplier > 1) dailyGain += 22
    if (e.patienceMultiplier && e.patienceMultiplier > 1) dailyGain += 24
    if (e.inventoryCapBonus) dailyGain += 18
    if (e.spoilageReduction) dailyGain += 12
    if (e.deliveryQuotaBonus) dailyGain += 28
    if (e.packCostDiscount) dailyGain += 8
  }
  return Math.round((def.cost / Math.max(10, dailyGain)) * 10) / 10
}

export function getUpgradeProgressionCurve(
  state: { funds: number; shopLevel: ShopLevel; ownedEquipment: readonly string[] },
  upgrades: readonly MifenUpgradeDef[],
): UpgradeRecommendation[] {
  const owned = new Set(state.ownedEquipment)
  const list: UpgradeRecommendation[] = []
  for (const def of upgrades) {
    if (def.kind === 'shop_level') {
      const target = def.targetLevel ?? 1
      if (target <= state.shopLevel || target > state.shopLevel + 1) continue
      list.push({
        upgradeId: def.id,
        name: def.name,
        cost: def.cost,
        paybackDays: estimateUpgradePaybackDays(def),
        affordable: state.funds + 0.001 >= def.cost,
      })
    } else if (!owned.has(def.id)) {
      list.push({
        upgradeId: def.id,
        name: def.name,
        cost: def.cost,
        paybackDays: estimateUpgradePaybackDays(def),
        affordable: state.funds + 0.001 >= def.cost,
      })
    }
  }
  return list.sort((a, b) => a.paybackDays - b.paybackDays || a.cost - b.cost)
}

function formatEffects(effect: Record<string, number>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(effect ?? {})) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue
    if (k === 'boilSpeedMultiplier') parts.push(`烫粉 ×${v}`)
    else if (k === 'boilWindowBonus' || /boil/i.test(k)) parts.push(`火候区 +${Math.round(v * 100)}%`)
    else if (k === 'brineToleranceBonus' || /brine|lucai/i.test(k)) parts.push(`老卤容错 +${Math.round(v * 100)}%`)
    else if (k === 'sliceSpeedMultiplier') parts.push(`切码 ×${v}`)
    else if (k === 'qualityBonus') parts.push(`品相 +${Math.round(v * 100)}%`)
    else if (k === 'tipBonus') parts.push(`小费 +${Math.round(v * 100)}%`)
    else if (k === 'priceMultiplier' || k === 'revenueMultiplier') {
      if (v > 1) parts.push(`营收 +${Math.round((v - 1) * 100)}%`)
    } else if (k === 'patienceMultiplier') {
      if (v > 1) parts.push(`耐心 +${Math.round((v - 1) * 100)}%`)
    } else if (k === 'spawnRateMultiplier') {
      if (v > 1) parts.push(`客流 +${Math.round((v - 1) * 100)}%`)
    } else if (k === 'maxQueueBonus') parts.push(`排队 +${v}`)
    else if (k === 'seatingCapacity') parts.push(`${v} 座`)
    else if (k === 'inventoryCapBonus') parts.push(`库存上限 +${v}`)
    else if (k === 'spoilageReduction') parts.push(`损耗 -${Math.round(v * 100)}%`)
    else if (k === 'deliveryQuotaBonus') parts.push(`外卖单 +${v}/日`)
    else if (k === 'packCostDiscount') parts.push(`打包费 -¥${v.toFixed(2)}`)
    else if (/price/i.test(k)) parts.push(`单价 +¥${v}`)
    else if (/patience/i.test(k)) parts.push(`耐心 +${v}s`)
  }
  return parts.join(' · ')
}

export function createUpgradeController(
  store: MifenStore,
  recipesData: MifenRecipesData,
  callbacks: UpgradeCallbacks,
): UpgradeController {
  const drawer = document.createElement('section')
  drawer.className = 'mifen-panel mifen-upgrade-drawer'
  drawer.hidden = true
  drawer.setAttribute('role', 'dialog')
  drawer.setAttribute('aria-label', '扩店')
  drawer.dataset.mifenPanel = 'upgrade'
  callbacks.container.append(drawer)

  const upgrades = recipesData.upgrades ?? []

  function purchaseUpgrade(def: MifenUpgradeDef): void {
    const state = store.getState()
    if (def.kind === 'shop_level') {
      const target = def.targetLevel ?? ((state.shopLevel + 1) as ShopLevel)
      if (state.shopLevel >= target) return
      if (target > state.shopLevel + 1) {
        callbacks.onToast('需先完成上一级扩店')
        return
      }
      if (!store.spendFunds(def.cost)) {
        callbacks.onToast(`差 ¥${formatMoney(def.cost - state.funds)}`)
        return
      }
      store.setShopLevel(target)
      callbacks.onShopLevelUp(target)
      callbacks.onToast(`已扩至${getShopLevelName(target)}`)
      render()
      return
    }

    if (store.hasEquipment(def.id)) return
    if (!store.spendFunds(def.cost)) {
      callbacks.onToast(`差 ¥${formatMoney(def.cost - state.funds)}`)
      return
    }
    store.addEquipment(def.id)
    callbacks.onToast(`已购入${def.name}`)
    render()
  }

  function render(): void {
    if (drawer.hidden) return
    const prevBody = drawer.querySelector<HTMLElement>('.mifen-panel-body')
    const prevScrollTop = prevBody ? prevBody.scrollTop : 0
    const state = store.getState()
    const shopUpgrades = upgrades.filter(u => u.kind === 'shop_level' && (u.targetLevel ?? 1) > 1)
    const equipUpgrades = upgrades.filter(u => u.kind === 'equipment')
    const recommendedId = getUpgradeProgressionCurve(state, upgrades).find(r => r.affordable)?.upgradeId

    const shopRows = shopUpgrades
      .map(def => {
        const target = def.targetLevel ?? 2
        const unlocked = state.shopLevel >= target
        const lockedByPrev = target > state.shopLevel + 1
        const affordable = state.funds + 0.001 >= def.cost
        const meta = formatEffects(def.effect) || `${getMaxCustomersForLevel(target)} 位食客`
        const btnLabel = unlocked ? '已开业' : lockedByPrev ? '待前置' : `¥${formatMoney(def.cost)}`
        return `
          <article class="mifen-row ${unlocked ? 'is-owned' : ''}" data-id="${def.id}">
            <div class="mifen-row-main">
              <strong class="mifen-row-title">${def.name}</strong>
              <span class="mifen-row-meta">${meta}</span>
            </div>
            <button type="button" class="mifen-btn ${def.id === recommendedId ? 'mifen-btn--primary' : ''}"
              data-buy="${def.id}"
              aria-label="${def.name} ${btnLabel}"
              ${unlocked || lockedByPrev || !affordable ? 'disabled' : ''}>
              ${btnLabel}
            </button>
          </article>
        `
      })
      .join('')

    const equipRows = equipUpgrades
      .map(def => {
        const owned = store.hasEquipment(def.id)
        const affordable = state.funds + 0.001 >= def.cost
        const meta = formatEffects(def.effect)
        const btnLabel = owned ? '已有' : `¥${formatMoney(def.cost)}`
        return `
          <article class="mifen-row ${owned ? 'is-owned' : ''}" data-id="${def.id}">
            <div class="mifen-row-main">
              <strong class="mifen-row-title">${def.name}</strong>
              <span class="mifen-row-meta">${meta}</span>
            </div>
            <button type="button" class="mifen-btn ${def.id === recommendedId ? 'mifen-btn--primary' : ''}"
              data-buy="${def.id}"
              aria-label="${def.name} ${btnLabel}"
              ${owned || !affordable ? 'disabled' : ''}>
              ${btnLabel}
            </button>
          </article>
        `
      })
      .join('')

    drawer.innerHTML = `
      <header class="mifen-panel-head">
        <h3>扩店</h3>
        <button type="button" class="mifen-btn" data-action="close-upgrade" aria-label="关闭扩店">关闭</button>
      </header>
      <div class="mifen-panel-body">
        ${shopRows}
        ${equipRows}
      </div>
    `

    const nextBody = drawer.querySelector<HTMLElement>('.mifen-panel-body')
    if (nextBody && prevScrollTop > 0) nextBody.scrollTop = prevScrollTop

    drawer.querySelector('[data-action="close-upgrade"]')?.addEventListener('click', () => close())
    for (const btn of Array.from(drawer.querySelectorAll<HTMLButtonElement>('[data-buy]'))) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.buy
        const found = upgrades.find(u => u.id === id)
        if (found) purchaseUpgrade(found)
      })
    }
  }

  function open(): void {
    drawer.hidden = false
    render()
    requestAnimationFrame(() => {
      if (!drawer.hidden) drawer.classList.add('is-open')
    })
  }

  function close(): void {
    const wasOpen = !drawer.hidden
    drawer.classList.remove('is-open')
    drawer.hidden = true
    if (wasOpen) callbacks.onClose?.()
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!drawer.hidden && e.code === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  window.addEventListener('keydown', onKeyDown)
  const unsubscribe = store.subscribe(() => {
    if (!drawer.hidden) render()
  })

  return {
    open,
    close,
    toggle() {
      if (drawer.hidden) open()
      else close()
    },
    isOpen() {
      return !drawer.hidden
    },
    canAffordAny() {
      const state = store.getState()
      for (const def of upgrades) {
        if (def.kind === 'shop_level') {
          const target = def.targetLevel ?? 2
          if (target === state.shopLevel + 1 && state.funds + 0.001 >= def.cost) return true
        } else if (!store.hasEquipment(def.id) && state.funds + 0.001 >= def.cost) {
          return true
        }
      }
      return false
    },
    refresh() {
      if (!drawer.hidden) render()
    },
    dispose() {
      unsubscribe()
      window.removeEventListener('keydown', onKeyDown)
      drawer.remove()
    },
  }
}
