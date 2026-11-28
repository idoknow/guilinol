import {brandOf,rules} from '../smoke/data'
/**
 * Universal Shop / Wardrobe / Service UI Skeleton (`web/src/ui/shop-overlay.ts`).
 *
 * Strictly aligned with:
 *  - docs/style.md Phase 2 桂林街头 (asphalt black, osmanthus gold, Lijiang jade, alert red, tabular-nums)
 *  - docs/commerce-shops-spec.md §2.3 & §2.4 (atomic purchase, in-flight button disable, already-owned -> equip/select,
 *    preview rollback on close, 360° drag orbit + zoom forwarding, 1280x720 / 390x844 / 844x390 zero-overlap).
 */

import './shop-overlay.css'
import {
  DEFAULT_EQUIPPED_OUTFIT,
  EBIKE_SERVICE_CATALOG,
  EBIKE_UPGRADE_CATALOG,
  EBIKE_VISUAL_CATALOG,
  OUTFIT_ITEMS,
  OUTFIT_PRESETS,
  PERSONAL_EBIKE_LIST,
  PERSONAL_EBIKE_MODELS,
  calcFullServiceCost,
  type EquippedOutfit,
  type OutfitSlot,
  type PersistedEbikeVisual,
  type PersonalEbikeModelId,
} from '../game/catalog'
import {
  equipOutfitItem,
  equipOutfitPreset,
  executePurchase,
  quotePurchasePrice,
  selectActivePersonalVehicle,
  setAutoHelmetOnRide,
  type CatalogItemType,
} from '../game/commerce'
import {getShop, type ShopTriggerDef} from '../game/shops'
import {emit, getState, onState, setActiveShop, type GameState} from '../game/state'

export type ShopOverlayMode = 'smoke' | 'shop' | 'service' | 'wardrobe' | 'garage'
export type ShopCloseReason = 'user' | 'esc' | 'fly' | 'teleport' | 'testride'

export interface ShopOverlayHooks {
  onBeforeOpen?: (shop: ShopTriggerDef | null, mode: ShopOverlayMode) => void
  onAfterClose?: (shopId: string, reason: ShopCloseReason) => void
  onOrbitDrag?: (dx: number, dy: number) => void
  onOrbitZoom?: (delta: number) => void
  onPreviewOutfit?: (equipped: EquippedOutfit) => void
  onPreviewRollback?: (equipped: EquippedOutfit) => void
  onPreviewEbike?: (preview: {modelId: PersonalEbikeModelId; visual: PersistedEbikeVisual}) => void
  onStartTestRide?: (shopId: string, modelId: PersonalEbikeModelId) => void
  onSummonVehicle?: (vehicleId?: string) => void
}

interface RenderCard {
  key: string
  itemType: CatalogItemType
  itemId: string
  name: string
  desc: string
  price: number
  owned: boolean
  active: boolean
  swatchHex?: string
  specs?: {label: string; valueText: string; ratio: number}[]
  testRideModelId?: PersonalEbikeModelId
  targetVehicleId?: string
  disabledReason?: string
}

export interface ShopOverlayHandle {
  root: HTMLElement
  openShop: (shopId: string, initialTab?: string) => boolean
  openServiceBay: (shopId: string) => boolean
  openSmoke: (message?:string) => boolean
  openWardrobe: () => boolean
  openGarage: () => boolean
  close: (reason?: ShopCloseReason) => void
  isOpen: () => boolean
  dispose: () => void
}

const SLOT_LABELS: Record<OutfitSlot, string> = {
  top: '上衣',
  bottom: '下装',
  shoes: '鞋履',
  hat: '头饰',
  bag: '背饰',
}

function fmtMoney(n: number): string {
  return `¥${Math.max(0, Math.trunc(n)).toLocaleString('zh-CN')}`
}

export function mountShopOverlay(hooks: ShopOverlayHooks = {}): ShopOverlayHandle {
  const root = document.createElement('section')
  root.className = 'shop-overlay'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-label', '商圈店铺')
  root.innerHTML = `
    <div class="shop-stage" aria-label="360度展示台">
      <div class="shop-stage-top">
        <span class="shop-orbit-pill">↔ 拖动 360° 预览 · 滚轮/双指缩放</span>
      </div>
      <div class="shop-preview-banner" hidden></div>
    </div>
    <aside class="shop-drawer">
      <div class="shop-head">
        <div class="shop-title-wrap">
          <span class="shop-badge"></span>
          <h2 class="shop-title"></h2>
        </div>
        <div class="shop-wallet">
          <small>桂林币余额</small>
          <span class="shop-wallet-val">¥0</span>
        </div>
      </div>
      <div class="shop-tabs" role="tablist"></div>
      <div class="shop-wardrobe-opts" hidden>
        <button type="button" class="shop-edit-character">修改外形</button><span class="shop-wardrobe-summary"></span>
        <button type="button" class="shop-helmet-toggle" aria-pressed="true">骑行自动头盔：开</button>
      </div>
      <div class="shop-status-msg" hidden></div>
      <div class="shop-list" role="listbox"></div>
      <div class="shop-footer">
        <button type="button" class="shop-btn shop-btn--secondary shop-act-secondary" hidden></button>
        <button type="button" class="shop-btn shop-btn--primary shop-act-primary"></button>
        <button type="button" class="shop-btn shop-btn--close shop-act-close">离开</button>
      </div>
    </aside>
  `
  document.body.append(root)

  const stageEl = root.querySelector<HTMLElement>('.shop-stage')!
  const previewBannerEl = root.querySelector<HTMLElement>('.shop-preview-banner')!
  const badgeEl = root.querySelector<HTMLElement>('.shop-badge')!
  const titleEl = root.querySelector<HTMLElement>('.shop-title')!
  const walletValEl = root.querySelector<HTMLElement>('.shop-wallet-val')!
  const tabsEl = root.querySelector<HTMLElement>('.shop-tabs')!
  root.querySelector<HTMLButtonElement>('.shop-edit-character')!.onclick=async()=>{close();await (await import('./account')).editCharacter()}
  const wardrobeOptsEl = root.querySelector<HTMLElement>('.shop-wardrobe-opts')!
  const wardrobeSummaryEl = root.querySelector<HTMLElement>('.shop-wardrobe-summary')!
  const helmetToggleBtn = root.querySelector<HTMLButtonElement>('.shop-helmet-toggle')!
  const statusMsgEl = root.querySelector<HTMLElement>('.shop-status-msg')!
  const listEl = root.querySelector<HTMLElement>('.shop-list')!
  const secondaryBtn = root.querySelector<HTMLButtonElement>('.shop-act-secondary')!
  const primaryBtn = root.querySelector<HTMLButtonElement>('.shop-act-primary')!
  const closeBtn = root.querySelector<HTMLButtonElement>('.shop-act-close')!

  let open = false
  let mode: ShopOverlayMode = 'shop'
  let currentShop: ShopTriggerDef | null = null
  let activeTab = 'presets'
  let selectedKey: string | null = null
  let previewSnapshot: EquippedOutfit | null = null
  let previewingLabel = ''
  const packStage = document.createElement('div')
  packStage.className = 'pack-stage'
  const packPreview = document.createElement('div')
  packPreview.className = 'pack-preview'
  for (let i=0;i<6;i++) packPreview.append(document.createElement('span'))
  packStage.append(packPreview)
  stageEl.append(packStage)
  let packYaw = -18, packPitch = -10
  const orientPack = () => {packPreview.style.transform = `rotateX(${packPitch}deg) rotateY(${packYaw}deg)`}
  orientPack()
  let clickSessionNonce = Date.now()
  let busyPurchasing = false
  let statusMessage = ''
  let statusTone: 'ok' | 'warn' = 'ok'

  function setStatus(msg: string, tone: 'ok' | 'warn' = 'ok'): void {
    statusMessage = msg
    statusTone = tone
    statusMsgEl.textContent = msg
    statusMsgEl.dataset.tone = tone
    statusMsgEl.hidden = !msg
  }

  function tabsForMode(): {id: string; label: string}[] {
    if (mode === 'smoke') return [{id:'packs',label:'香烟'}]
    if (mode === 'wardrobe') {
      return [
        {id: 'presets', label: '已购套装'},
        {id: 'top', label: '上衣'},
        {id: 'bottom', label: '下装'},
        {id: 'shoes', label: '鞋履'},
        {id: 'hat', label: '头饰'},
        {id: 'bag', label: '背饰'},
      ]
    }
    if (mode === 'garage') {
      return [
        {id: 'models', label: '我的车库'},
        {id: 'service', label: '车况状态'},
      ]
    }
    if (mode === 'service') {
      return [{id: 'service', label: '充电 / 保养'}]
    }
    if (currentShop?.kind === 'clothing') {
      return [
        {id: 'presets', label: '整套穿搭'},
        {id: 'top', label: '上衣'},
        {id: 'bottom', label: '下装'},
        {id: 'shoes', label: '鞋履'},
        {id: 'hat', label: '头饰'},
        {id: 'bag', label: '背饰'},
      ]
    }
    return [
      {id: 'models', label: '整车选购'},
      {id: 'upgrades', label: '动力改装'},
      {id: 'visuals', label: '外观涂装'},
      {id: 'service', label: '充修保养'},
    ]
  }

  function buildCards(s: Readonly<GameState>): RenderCard[] {
    if (mode === 'smoke') return rules.brands.map(({id,price}) => {
      const b = brandOf(id)
      return {key:id,itemId:id,itemType:'cigarette_pack',name:b.name,desc:b.series+' · 每包 20 支',price,owned:false,active:false,swatchHex:b.pack}
    })
    const ownedItems = new Set(s.wardrobe.ownedItemIds)
    const ownedPresets = new Set(s.wardrobe.ownedPresetIds)
    const ownedVehicles = Object.values(s.garage.vehicles)
    const activeVeh = s.garage.activeVehicleId ? s.garage.vehicles[s.garage.activeVehicleId] : ownedVehicles[0]

    if (mode === 'wardrobe' || currentShop?.kind === 'clothing') {
      if (activeTab === 'presets') {
        const source =
          mode === 'wardrobe'
            ? OUTFIT_PRESETS.filter(
                p => ownedPresets.has(p.id) || Object.values(p.items).every(id => ownedItems.has(id)),
              )
            : OUTFIT_PRESETS
        return source.map(preset => {
          const allOwned = ownedPresets.has(preset.id) || Object.values(preset.items).every(id => ownedItems.has(id))
          const isActive = (Object.entries(preset.items) as [OutfitSlot, string][]).every(
            ([slot, id]) => s.wardrobe.equipped[slot] === id,
          )
          const topItem = OUTFIT_ITEMS.find(i => i.id === preset.items.top)
          return {
            key: `outfit_preset:${preset.id}`,
            itemType: 'outfit_preset',
            itemId: preset.id,
            name: preset.name,
            desc: `${preset.tag} · ${preset.summary}`,
            price: preset.price,
            owned: allOwned,
            active: isActive,
            swatchHex: topItem?.colorHex,
          }
        })
      }
      const slot = activeTab as OutfitSlot
      const items = OUTFIT_ITEMS.filter(item => item.slot === slot && (mode !== 'wardrobe' || ownedItems.has(item.id)))
      return items.map(item => ({
        key: `outfit_item:${item.id}`,
        itemType: 'outfit_item',
        itemId: item.id,
        name: item.name,
        desc: `${SLOT_LABELS[item.slot]} · ${item.description}`,
        price: item.price,
        owned: ownedItems.has(item.id),
        active: s.wardrobe.equipped[item.slot] === item.id,
        swatchHex: item.colorHex,
      }))
    }

    if (activeTab === 'models') {
      const models = mode === 'garage'
        ? PERSONAL_EBIKE_LIST.filter(m => ownedVehicles.some(v => v.modelId === m.modelId))
        : PERSONAL_EBIKE_LIST
      return models.map(m => {
        const ownedInstance = ownedVehicles.find(v => v.modelId === m.modelId)
        const isPrimary = !!ownedInstance && s.garage.activeVehicleId === ownedInstance.id
        const hex = `#${(m.defaultVisual.paintColor ?? 0x3b6f78).toString(16).padStart(6, '0')}`
        return {
          key: `ebike_model:${m.modelId}`,
          itemType: 'ebike_model',
          itemId: m.modelId,
          name: m.name,
          desc: `${m.tierLabel} · ${m.summary}`,
          price: m.price,
          owned: !!ownedInstance,
          active: isPrimary,
          swatchHex: hex,
          testRideModelId: mode === 'shop' ? m.modelId : undefined,
          targetVehicleId: ownedInstance?.id,
          specs: [
            {label: '极速 (S/满改)', valueText: `${m.stockGearKmh[3]}/${m.hardCapKmh} km/h`, ratio: m.hardCapKmh / 70},
            {label: '起步扭矩', valueText: `${Math.round(m.accelScale * 100)}%`, ratio: Math.min(1, m.accelScale / 1.3)},
            {
              label: '压弯极限',
              valueText: m.modelId === 'xiangshan_gt' ? '高阶运动倾角' : m.modelId === 'city_range' ? '稳态巡航倾角' : '轻巧通勤倾角',
              ratio: m.modelId === 'xiangshan_gt' ? 0.96 : m.modelId === 'city_range' ? 0.78 : 0.64,
            },
            {label: '电池续航', valueText: `${m.capacityScale.toFixed(2)}× · 耗电${Math.round(m.drainMul * 100)}%`, ratio: Math.min(1, m.capacityScale / 1.75)},
            {
              label: '夜灯光束',
              valueText: (m.defaultVisual.headlightTier ?? 0) >= 1 ? '双透镜远近光' : '省电暖白灯',
              ratio: m.modelId === 'xiangshan_gt' ? 1 : (m.defaultVisual.headlightTier ?? 0) >= 1 ? 0.76 : 0.45,
            },
            {
              label: '可改槽位',
              valueText: `${m.allowedVisuals.length}外观 · Lv${m.maxUpgrades.motorLevel}/${m.maxUpgrades.controllerLevel}/${m.maxUpgrades.batteryLevel}`,
              ratio: Math.min(1, m.allowedVisuals.length / 10),
            },
          ],
        }
      })
    }

    if (activeTab === 'upgrades') {
      return EBIKE_UPGRADE_CATALOG.map(upg => {
        const modelDef = activeVeh ? PERSONAL_EBIKE_MODELS[activeVeh.modelId] : null
        const field = upg.kind === 'motor' ? 'motorLevel' : upg.kind === 'controller' ? 'controllerLevel' : 'batteryLevel'
        const curLv = activeVeh ? activeVeh.upgrades[field] : 0
        const maxLv = modelDef ? modelDef.maxUpgrades[field] : 0
        const disabledReason = !activeVeh
          ? '请先购入个人电摩'
          : upg.level > maxLv
            ? `当前车型上限 Lv${maxLv}`
            : undefined
        return {
          key: `ebike_upgrade:${upg.id}`,
          itemType: 'ebike_upgrade',
          itemId: upg.id,
          name: upg.name,
          desc: disabledReason ? `${disabledReason} · ${upg.summary}` : upg.summary,
          price: upg.price,
          owned: !!activeVeh && curLv >= upg.level,
          active: !!activeVeh && curLv === upg.level,
          targetVehicleId: activeVeh?.id,
          disabledReason,
        }
      })
    }

    if (activeTab === 'visuals') {
      return EBIKE_VISUAL_CATALOG.map(vis => {
        const modelDef = activeVeh ? PERSONAL_EBIKE_MODELS[activeVeh.modelId] : null
        const allowed = !!modelDef && modelDef.allowedVisuals.includes(vis.slotKey)
        const applied =
          !!activeVeh &&
          Object.entries(vis.patch).every(
            ([k, val]) => (activeVeh.visual as unknown as Record<string, unknown>)[k] === val,
          )
        const disabledReason = !activeVeh ? '请先购入个人电摩' : !allowed ? '当前车型不支持该外观槽位' : undefined
        const colorNum = vis.patch.paintColor ?? vis.patch.underglowColor ?? vis.patch.angelEyeColor
        const swatchHex = colorNum !== undefined ? `#${colorNum.toString(16).padStart(6, '0')}` : undefined
        return {
          key: `ebike_visual:${vis.id}`,
          itemType: 'ebike_visual',
          itemId: vis.id,
          name: vis.name,
          desc: disabledReason ? `${disabledReason} · ${vis.summary}` : vis.summary,
          price: vis.price,
          owned: applied,
          active: applied,
          swatchHex,
          targetVehicleId: activeVeh?.id,
          disabledReason,
        }
      })
    }

    // service tab
    return Object.values(EBIKE_SERVICE_CATALOG).map(svc => {
      const price = activeVeh
        ? (svc.fixedPrice ?? calcFullServiceCost(activeVeh.batteryPct, activeVeh.durabilityPct))
        : (svc.fixedPrice ?? 0)
      const isFull =
        !activeVeh
          ? false
          : svc.id === 'slow_charge'
            ? activeVeh.batteryPct >= 80
            : svc.id === 'fast_charge'
              ? activeVeh.batteryPct >= 100
              : svc.id === 'full_repair'
                ? activeVeh.durabilityPct >= 100
                : activeVeh.batteryPct >= 100 && activeVeh.durabilityPct >= 100
      return {
        key: `ebike_service:${svc.id}`,
        itemType: 'ebike_service',
        itemId: svc.id,
        name: svc.name,
        desc: activeVeh
          ? `当前电量 ${Math.round(activeVeh.batteryPct)}% · 耐久 ${Math.round(activeVeh.durabilityPct)}% · ${svc.summary}`
          : `需先购入个人电摩 · ${svc.summary}`,
        price,
        owned: isFull,
        active: isFull,
        targetVehicleId: activeVeh?.id,
        disabledReason: !activeVeh ? '尚无个人电摩可充修' : isFull ? '当前状态已满无需处理' : undefined,
      }
    })
  }

  function applyPreview(card: RenderCard): void {
    const s = getState()
    const shopId = currentShop?.shopId ?? mode
    if (card.itemType === 'outfit_preset') {
      const preset = OUTFIT_PRESETS.find(p => p.id === card.itemId)
      if (!preset) return
      hooks.onPreviewOutfit?.({...preset.items})
      previewingLabel = card.owned ? '' : `试穿预览：${card.name}（离开自动还原）`
      emit({type: 'shop:preview', shopId, itemType: 'outfit_preset', itemId: card.itemId})
    } else if (card.itemType === 'outfit_item') {
      const item = OUTFIT_ITEMS.find(i => i.id === card.itemId)
      if (!item) return
      const next: EquippedOutfit = {...s.wardrobe.equipped, [item.slot]: item.id}
      hooks.onPreviewOutfit?.(next)
      previewingLabel = card.owned ? '' : `试穿预览：${card.name}（离开自动还原）`
      emit({type: 'shop:preview', shopId, itemType: 'outfit', itemId: card.itemId})
    } else if (card.itemType === 'ebike_model') {
      const modelId = card.itemId as PersonalEbikeModelId
      const owned = card.targetVehicleId ? s.garage.vehicles[card.targetVehicleId] : undefined
      const visual: PersistedEbikeVisual = owned ? {...owned.visual} : {...PERSONAL_EBIKE_MODELS[modelId].defaultVisual}
      hooks.onPreviewEbike?.({modelId, visual})
      previewingLabel = card.owned ? '' : `展台预览：${card.name}`
      emit({type: 'shop:preview', shopId, itemType: 'ebike', itemId: card.itemId})
    } else if (card.itemType === 'ebike_visual' || card.itemType === 'ebike_upgrade') {
      const ownedVehicles = Object.values(s.garage.vehicles)
      const activeVeh = (card.targetVehicleId ? s.garage.vehicles[card.targetVehicleId] : undefined)
        ?? (s.garage.activeVehicleId ? s.garage.vehicles[s.garage.activeVehicleId] : ownedVehicles[0])
      const baseModelId: PersonalEbikeModelId = activeVeh?.modelId ?? 'xiangshan_gt'
      const baseVisual: PersistedEbikeVisual = activeVeh
        ? {...activeVeh.visual}
        : {...PERSONAL_EBIKE_MODELS[baseModelId].defaultVisual}
      if (card.itemType === 'ebike_visual') {
        const visDef = EBIKE_VISUAL_CATALOG.find(v => v.id === card.itemId)
        if (visDef) Object.assign(baseVisual, visDef.patch)
      }
      hooks.onPreviewEbike?.({modelId: baseModelId, visual: baseVisual})
      previewingLabel = `方案预览：${card.name}`
      emit({type: 'shop:preview', shopId, itemType: 'ebike_mod', itemId: card.itemId})
    } else if (card.itemType === 'ebike_service') {
      const ownedVehicles = Object.values(s.garage.vehicles)
      const activeVeh = (card.targetVehicleId ? s.garage.vehicles[card.targetVehicleId] : undefined)
        ?? (s.garage.activeVehicleId ? s.garage.vehicles[s.garage.activeVehicleId] : ownedVehicles[0])
      if (activeVeh) hooks.onPreviewEbike?.({modelId: activeVeh.modelId, visual: {...activeVeh.visual}})
      previewingLabel = ''
    } else {
      previewingLabel = ''
    }
    previewBannerEl.textContent = previewingLabel
    previewBannerEl.hidden = !previewingLabel
  }

  function render(): void {
    if (!open) return
    const s = getState()
    badgeEl.textContent =
      mode === 'wardrobe'
        ? '随身衣橱'
        : mode === 'garage'
          ? '个人车库'
          : mode === 'service'
            ? '充修工位'
            : currentShop?.mapMarker.badge ?? '商圈'
    titleEl.textContent =
      mode === 'wardrobe'
        ? '随身衣橱'
        : mode === 'garage'
          ? '个人电动车库'
          : currentShop?.displayName ?? '桂林商圈'
    if (mode === 'smoke') {badgeEl.textContent = '桂林商圈'; titleEl.textContent = '香烟铺'}
    walletValEl.textContent = fmtMoney(s.money)

    const tabs = tabsForMode()
    if (!tabs.some(t => t.id === activeTab)) activeTab = tabs[0].id
    const isWardrobe = mode === 'wardrobe'
    wardrobeOptsEl.hidden = !isWardrobe
    if (isWardrobe) {
      const ownedCount = s.wardrobe.ownedItemIds.length
      wardrobeSummaryEl.textContent = `已解锁 ${ownedCount} 件`
      const helmetOn = s.wardrobe.autoHelmetOnRide
      helmetToggleBtn.textContent = `骑行自动头盔：${helmetOn ? '开' : '关'}`
      helmetToggleBtn.setAttribute('aria-pressed', String(helmetOn))
      helmetToggleBtn.classList.toggle('on', helmetOn)
      helmetToggleBtn.onclick = () => {
        const next = !getState().wardrobe.autoHelmetOnRide
        setAutoHelmetOnRide(next)
        setStatus(
          next ? '已开启骑电驴自动佩戴安全头盔（下车恢复原造型）' : '已关闭骑电驴自动头盔联动',
          'ok',
        )
        render()
      }
    } else {
      helmetToggleBtn.onclick = null
    }
    tabsEl.innerHTML = ''
    for (const tab of tabs) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `shop-tab${tab.id === activeTab ? ' on' : ''}`
      btn.dataset.tab = tab.id
      btn.setAttribute('role', 'tab')
      btn.setAttribute('aria-selected', String(tab.id === activeTab))
      btn.textContent = tab.label
      btn.onclick = () => {
        activeTab = tab.id
        selectedKey = null
        setStatus('')
        render()
      }
      tabsEl.append(btn)
    }

    const cards = buildCards(s)
    if (!selectedKey || !cards.some(c => c.key === selectedKey)) {
      selectedKey = cards[0]?.key ?? null
    }

    listEl.innerHTML = ''
    if (!cards.length) {
      const empty = document.createElement('p')
      empty.className = 'shop-card-desc'
      empty.textContent = mode === 'garage' ? '车库暂空，前往十字街「漓行电驴行」选购个人电摩。' : '当前分类暂无可选项。'
      listEl.append(empty)
    }
    for (const card of cards) {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = `shop-card${card.key === selectedKey ? ' selected' : ''}`
      el.dataset.itemKey = card.key
      el.setAttribute('role', 'option')
      el.setAttribute('aria-selected', String(card.key === selectedKey))
      const priceClass = card.owned ? ' owned' : s.money < card.price ? ' insufficient' : ''
      const priceText = card.owned ? (card.active ? '已启用' : '已拥有') : card.price === 0 ? '免费' : fmtMoney(card.price)
      const swatchHtml = card.swatchHex ? `<span class="shop-swatch" style="background:${card.swatchHex}"></span>` : ''
      const specsHtml = card.specs
        ? `<div class="shop-specs">${card.specs
            .map(
              sp =>
                `<div class="shop-spec"><span>${sp.label} · ${sp.valueText}</span><span class="shop-spec-bar"><i style="width:${Math.round(Math.max(0.05, Math.min(1, sp.ratio)) * 100)}%"></i></span></div>`,
            )
            .join('')}</div>`
        : ''
      el.innerHTML = `
        <div class="shop-card-top">
          <div class="shop-card-name-row">${swatchHtml}<span class="shop-card-name">${card.name}</span></div>
          <span class="shop-card-price${priceClass}">${priceText}</span>
        </div>
        <p class="shop-card-desc">${card.desc}</p>
        ${specsHtml}
      `
      if(card.itemType==='cigarette_pack'){
        const thumb=el.querySelector<HTMLElement>('.shop-swatch')!
        const b=brandOf(card.itemId)
        thumb.classList.add('pack-thumb')
        thumb.style.background='linear-gradient('+b.lid+' 22%, '+b.pack+' 22%)'
        thumb.textContent=b.faceTexture?'':b.name
        if(b.faceTexture){thumb.style.backgroundImage=`url("${b.faceTexture}")`;thumb.style.backgroundSize='100% 100%'}
      }
      el.onclick = () => {
        selectedKey = card.key
        setStatus('')
        applyPreview(card)
        render()
      }
      listEl.append(el)
    }

    const activeCard = cards.find(c => c.key === selectedKey) ?? null
    if (mode === 'smoke' && activeCard) {
      const b = brandOf(activeCard.itemId)
      packPreview.style.setProperty('--pack', b.pack)
      packPreview.style.setProperty('--lid', b.lid)
      // 正反两面印同一张包装（真烟盒也是两面同图），侧面和顶底用包装主色。
      for(const face of Array.from(packPreview.children).slice(0,2) as HTMLElement[]){
        face.textContent=b.faceTexture?'':b.name
        face.style.backgroundImage=b.faceTexture?`url("${b.faceTexture}")`:''
        face.style.backgroundSize='100% 100%'
      }
    }
    const isDefaultOutfit = (Object.keys(DEFAULT_EQUIPPED_OUTFIT) as OutfitSlot[]).every(
      slot => s.wardrobe.equipped[slot] === DEFAULT_EQUIPPED_OUTFIT[slot],
    )
    if (!activeCard) {
      if (mode === 'wardrobe') {
        secondaryBtn.hidden = false
        secondaryBtn.textContent = '恢复默认'
        secondaryBtn.disabled = busyPurchasing || isDefaultOutfit
        secondaryBtn.onclick = () => {
          if (equipOutfitPreset('outfit_default')) {
            const committed = {...getState().wardrobe.equipped}
            previewSnapshot = committed
            previewingLabel = ''
            previewBannerEl.hidden = true
            hooks.onPreviewRollback?.(committed)
            setStatus('已恢复桂林默认初始穿搭', 'ok')
            render()
          }
        }
      } else {
        secondaryBtn.hidden = true
        secondaryBtn.onclick = null
      }
      primaryBtn.disabled = true
      primaryBtn.className = 'shop-btn shop-btn--primary shop-act-primary'
      primaryBtn.textContent = '暂无可操作项'
      return
    }

    // Secondary action: reset to default in wardrobe, summon owned personal e-bike, or free test ride in e-bike shop
    if (mode === 'wardrobe') {
      secondaryBtn.hidden = false
      secondaryBtn.textContent = '恢复默认'
      secondaryBtn.disabled = busyPurchasing || isDefaultOutfit
      secondaryBtn.onclick = () => {
        if (equipOutfitPreset('outfit_default')) {
          const committed = {...getState().wardrobe.equipped}
          previewSnapshot = committed
          previewingLabel = ''
          previewBannerEl.hidden = true
          hooks.onPreviewRollback?.(committed)
          setStatus('已恢复桂林默认初始穿搭', 'ok')
          render()
        }
      }
    } else if (activeCard.itemType === 'ebike_model' && activeCard.owned && activeCard.targetVehicleId && hooks.onSummonVehicle) {
      secondaryBtn.hidden = false
      secondaryBtn.textContent = '召唤提车'
      secondaryBtn.disabled = busyPurchasing
      secondaryBtn.onclick = () => {
        const targetId = activeCard.targetVehicleId!
        selectActivePersonalVehicle(targetId)
        close('user')
        hooks.onSummonVehicle?.(targetId)
      }
    } else if (activeCard.testRideModelId && currentShop && hooks.onStartTestRide) {
      secondaryBtn.hidden = false
      secondaryBtn.textContent = '免费试驾'
      secondaryBtn.disabled = busyPurchasing
      secondaryBtn.onclick = () => {
        const shopId = currentShop!.shopId
        const modelId = activeCard.testRideModelId!
        close('testride')
        hooks.onStartTestRide?.(shopId, modelId)
      }
    } else {
      secondaryBtn.hidden = true
      secondaryBtn.onclick = null
    }

    // Primary action: already owned -> equip/select; insufficient -> warning; affordable -> atomic buy
    primaryBtn.disabled = busyPurchasing || !!activeCard.disabledReason
    if (activeCard.disabledReason) {
      primaryBtn.className = 'shop-btn shop-btn--warn shop-act-primary'
      primaryBtn.textContent = activeCard.disabledReason
      primaryBtn.onclick = null
    } else if (activeCard.owned) {
      primaryBtn.className = 'shop-btn shop-btn--equip shop-act-primary'
      if (activeCard.itemType === 'outfit_preset' || activeCard.itemType === 'outfit_item') {
        primaryBtn.textContent = activeCard.active ? '正在穿戴' : '立即穿戴'
        primaryBtn.disabled = activeCard.active
        primaryBtn.onclick = () => {
          const ok =
            activeCard.itemType === 'outfit_preset'
              ? equipOutfitPreset(activeCard.itemId)
              : equipOutfitItem(activeCard.itemId)
          if (ok) {
            const committed = {...getState().wardrobe.equipped}
            previewSnapshot = committed
            previewingLabel = ''
            previewBannerEl.hidden = true
            hooks.onPreviewRollback?.(committed)
            setStatus(`已切换穿搭：${activeCard.name}`, 'ok')
            render()
          }
        }
      } else if (activeCard.itemType === 'ebike_model' && activeCard.targetVehicleId) {
        primaryBtn.textContent = activeCard.active ? '当前主力车' : '设为常用车'
        primaryBtn.disabled = activeCard.active
        primaryBtn.onclick = () => {
          if (selectActivePersonalVehicle(activeCard.targetVehicleId!)) {
            setStatus(`已设为主力座驾：${activeCard.name}`, 'ok')
            render()
          }
        }
      } else {
        primaryBtn.textContent = '已装备'
        primaryBtn.disabled = true
        primaryBtn.onclick = null
      }
    } else if (s.money < activeCard.price) {
      const deficit = activeCard.price - s.money
      primaryBtn.className = 'shop-btn shop-btn--warn shop-act-primary'
      primaryBtn.disabled = false
      primaryBtn.textContent = `余额不足 · 差 ${fmtMoney(deficit)}`
      primaryBtn.onclick = () => {
        setStatus(`还差 ${fmtMoney(deficit)}，去接桂林米粉外卖或打卡观景点赚桂林币吧！`, 'warn')
      }
    } else {
      primaryBtn.className = 'shop-btn shop-btn--primary shop-act-primary'
      primaryBtn.textContent =
        activeCard.price === 0 ? `免费确认 · ${activeCard.name}` : `购买 · ${fmtMoney(activeCard.price)}`
      primaryBtn.onclick = () => {
        if (busyPurchasing) return
        busyPurchasing = true
        primaryBtn.disabled = true
        try {
          const shopId = currentShop?.shopId ?? mode
          const quoted = quotePurchasePrice(activeCard.itemType, activeCard.itemId, activeCard.targetVehicleId)
          const res = executePurchase({
            shopId,
            itemType: activeCard.itemType,
            itemId: activeCard.itemId,
            targetVehicleId: activeCard.targetVehicleId,
            expectedPrice: quoted ?? activeCard.price,
            idempotencyKey: `${shopId}:${activeCard.itemType}:${activeCard.itemId}:${++clickSessionNonce}`,
          })
          if (res.ok && res.code === 'OK') {
            const committed = {...getState().wardrobe.equipped}
            previewSnapshot = committed
            previewingLabel = ''
            previewBannerEl.hidden = true
            hooks.onPreviewRollback?.(committed)
            setStatus(`成交！已扣除 ${fmtMoney(res.charged)}，当前余额 ${fmtMoney(res.balanceAfter)}`, 'ok')
          } else if (res.code === 'ALREADY_OWNED') {
            setStatus('您已拥有该项，已为您切换为可用状态。', 'ok')
          } else if (res.code === 'INSUFFICIENT_FUNDS') {
            setStatus(`余额不足，还差 ${fmtMoney(res.deficit ?? 0)}。`, 'warn')
          } else if (res.code === 'ALREADY_FULL') {
            setStatus(mode==='smoke'?'已持有 3 包香烟。':'电量与耐久已满，无需重复养护。', 'ok')
          } else {
            setStatus(`操作未完成（${res.code}）`, 'warn')
          }
        } finally {
          busyPurchasing = false
          render()
        }
      }
    }
  }

  function openInternal(nextMode: ShopOverlayMode, shop: ShopTriggerDef | null, initialTab?: string): boolean {
    if (open) close('user')
    mode = nextMode
    packStage.hidden = mode !== 'smoke'
    currentShop = shop
    activeTab = initialTab ?? (nextMode === 'service' ? 'service' : shop?.kind === 'ebike' || nextMode === 'garage' ? 'models' : 'presets')
    selectedKey = null
    previewSnapshot = {...getState().wardrobe.equipped}
    previewingLabel = ''
    previewBannerEl.hidden = true
    setStatus('')
    open = true

    root.classList.toggle('wardrobe-overlay', nextMode === 'wardrobe')
    root.classList.toggle('garage-overlay', nextMode === 'garage')
    root.classList.add('show')
    document.body.dataset.shopOpen = '1'
    hooks.onBeforeOpen?.(shop, nextMode)

    if (shop) {
      setActiveShop({shopId: shop.shopId, kind: shop.kind, openedAt: Date.now()})
      emit({type: 'shop:open', shopId: shop.shopId, kind: shop.kind})
    }
    render()
    if (shop?.kind === 'ebike' || nextMode === 'garage' || nextMode === 'service') {
      const s = getState()
      const owned = s.garage.activeVehicleId ? s.garage.vehicles[s.garage.activeVehicleId] : Object.values(s.garage.vehicles)[0]
      const initModelId: PersonalEbikeModelId = owned?.modelId ?? 'lijiang_light'
      const initVisual: PersistedEbikeVisual = owned ? {...owned.visual} : {...PERSONAL_EBIKE_MODELS[initModelId].defaultVisual}
      hooks.onPreviewEbike?.({modelId: initModelId, visual: initVisual})
    }
    return true
  }

  function close(reason: ShopCloseReason = 'user'): void {
    if (!open) return
    const closedShopId = currentShop?.shopId ?? mode
    open = false
    root.classList.remove('show', 'wardrobe-overlay', 'garage-overlay')
    delete document.body.dataset.shopOpen

    // Strict rollback of any unpurchased preview back to real persisted equipped state
    const realEquipped = {...getState().wardrobe.equipped}
    if (previewSnapshot) {
      hooks.onPreviewRollback?.(realEquipped)
      previewSnapshot = null
    }
    previewingLabel = ''
    previewBannerEl.hidden = true
    setStatus('')

    if (currentShop) {
      setActiveShop(null)
      emit({type: 'shop:close', shopId: closedShopId, reason})
    }
    currentShop = null
    hooks.onAfterClose?.(closedShopId, reason)
  }

  closeBtn.onclick = () => close('user')

  // 360° orbit drag & wheel/pinch zoom on the 3D preview stage
  const stagePointers = new Map<number, {x: number; y: number}>()
  let stagePinch = 0
  const pinchDist = () => {
    const [a, b] = [...stagePointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
  stageEl.addEventListener('pointerdown', event => {
    if (!open) return
    event.stopPropagation()
    try { stageEl.setPointerCapture(event.pointerId) } catch {}
    stagePointers.set(event.pointerId, {x: event.clientX, y: event.clientY})
    if (stagePointers.size === 2) stagePinch = pinchDist()
  })
  stageEl.addEventListener('pointermove', event => {
    if (!open) return
    const prev = stagePointers.get(event.pointerId)
    if (!prev) return
    const dx = event.clientX - prev.x
    const dy = event.clientY - prev.y
    prev.x = event.clientX
    prev.y = event.clientY
    if (stagePointers.size === 1) {
      if (mode === 'smoke') {packYaw += dx*.8; packPitch=Math.max(-80,Math.min(80,packPitch-dy*.5));orientPack()}
      else hooks.onOrbitDrag?.(dx, dy)
    } else if (stagePointers.size === 2) {
      const next = pinchDist()
      if (stagePinch > 0 && next > 0) hooks.onOrbitZoom?.((stagePinch - next) * 1.4)
      stagePinch = next
    }
  })
  const releaseStage = (event: PointerEvent) => {
    stagePointers.delete(event.pointerId)
    stagePinch = stagePointers.size === 2 ? pinchDist() : 0
  }
  stageEl.addEventListener('pointerup', releaseStage)
  stageEl.addEventListener('pointercancel', releaseStage)
  stageEl.addEventListener('lostpointercapture', releaseStage)
  stageEl.addEventListener(
    'wheel',
    event => {
      if (!open) return
      event.preventDefault()
      event.stopPropagation()
      hooks.onOrbitZoom?.(event.deltaY)
    },
    {passive: false},
  )

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) return
    if (event.code === 'Escape' && !event.repeat) {
      event.preventDefault()
      event.stopPropagation()
      close('esc')
    }
  }
  window.addEventListener('keydown', onKeyDown, {capture: true})

  const offState = onState((_, changed) => {
    if (!open) return
    if (changed.has('money') || changed.has('wardrobe') || changed.has('garage') || changed.has('walletSeq')) {
      render()
    }
  })

  return {
    root,
    openShop(shopId: string, initialTab?: string) {
      const shop = getShop(shopId)
      if (!shop) return false
      return openInternal('shop', shop, initialTab)
    },
    openServiceBay(shopId: string) {
      const shop = getShop(shopId)
      if (!shop) return false
      return openInternal('service', shop, 'service')
    },
    openSmoke(message) {
      const opened=openInternal('smoke',null,'packs')
      if(message)setStatus(message,'warn')
      return opened
    },
    openWardrobe() {
      return openInternal('wardrobe', null, 'presets')
    },
    openGarage() {
      return openInternal('garage', null, 'models')
    },
    close,
    isOpen: () => open,
    dispose() {
      close('user')
      offState()
      window.removeEventListener('keydown', onKeyDown, {capture: true})
      root.remove()
    },
  }
}
