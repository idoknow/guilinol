import './shop-ui.css'
import {
  calcFastChargeCost,
  calcFullServiceCost,
  calcRepairCost,
  computeOutfitPresetQuote,
  EBIKE_UPGRADE_CATALOG,
  EBIKE_VISUAL_CATALOG,
  OUTFIT_ITEMS,
  OUTFIT_PRESETS,
  PERSONAL_EBIKE_LIST,
  PERSONAL_EBIKE_MODELS,
  type OutfitSlot,
  type PersonalEbikeModelId,
} from '../game/catalog'
import {executePurchase} from '../game/commerce'
import {SHOP_MAP, type ShopTriggerDef} from '../game/shops'
import {
  emit,
  equipOutfitSlots,
  getState,
  onState,
  selectActivePersonalVehicle,
  setActiveShopState,
  setAutoHelmetOnRide,
  type OwnedPersonalEbike,
} from '../game/state'
import {resolvePersonalEbikeProfile} from '../walk/tuning'

export interface ShopUiCallbacks {
  onOpenOverlay?: (shop: ShopTriggerDef | null, kind: 'shop' | 'wardrobe' | 'garage') => void
  onCloseOverlay?: (reason: 'user' | 'esc' | 'fly' | 'teleport' | 'testride') => void
  onSummonPersonal?: (vehicleId?: string) => {ok: boolean; code: string; cooldownRemainingMs?: number}
  onStartTestRide?: (shopId: string, modelId: PersonalEbikeModelId) => {ok: boolean; code: string}
  onEndTestRide?: (reason: 'user') => void
  onPersonalBikePurchased?: (shopId: string, vehicleId: string) => void
  onPersonalBikeUpdated?: (vehicleId: string) => void
  onPreviewOutfit?: (slots: Partial<Record<OutfitSlot, string>> | null) => void
  onPreviewEbike?: (modelId: PersonalEbikeModelId | null, vehicleId?: string | null) => void
}

type OverlayMode = null | {kind: 'shop'; shop: ShopTriggerDef; tab: string} | {kind: 'wardrobe'; tab: OutfitSlot | 'presets'} | {kind: 'garage'}

let clickNonce = 0
const nextNonce = () => `${Date.now()}_${++clickNonce}`

const SLOT_LABELS: Record<OutfitSlot, string> = {
  top: '上衣',
  bottom: '下装',
  shoes: '鞋履',
  hat: '头饰',
  bag: '背包',
}

export function createShopUi(callbacks: ShopUiCallbacks = {}) {
  const dock = document.createElement('div')
  dock.className = 'commerce-dock'
  dock.innerHTML =
    '<span class="commerce-wallet">¥200</span>' +
    '<button type="button" data-act="wardrobe">衣橱</button>' +
    '<button type="button" data-act="garage">车库</button>' +
    '<button type="button" class="accent" data-act="summon">召唤电摩</button>' +
    '<span class="cm-testride-pill"><span class="cm-tr-text">试驾 90s</span><button type="button" data-act="end-tr">结束</button></span>'
  document.body.append(dock)

  const overlay = document.createElement('div')
  overlay.className = 'shop-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.innerHTML =
    '<div class="cm-stage-hint">拖动左侧画面 360° 预览 · Esc 返回街道</div>' +
    '<aside class="cm-drawer">' +
      '<header class="cm-head">' +
        '<div class="cm-title-wrap"><h2 class="cm-title"></h2><p class="cm-sub"></p></div>' +
        '<span class="cm-balance">¥200</span>' +
        '<button type="button" class="cm-close" aria-label="关闭">×</button>' +
      '</header>' +
      '<div class="cm-tabs"></div>' +
      '<div class="cm-body"></div>' +
      '<footer class="cm-foot"><span class="cm-foot-msg">点击商品预览，确认后再扣款</span><button type="button" class="cm-btn" style="flex:0 0 auto;min-width:72px" data-act="leave">离开</button></footer>' +
    '</aside>'
  document.body.append(overlay)

  const walletEl = dock.querySelector<HTMLElement>('.commerce-wallet')!
  const trPill = dock.querySelector<HTMLElement>('.cm-testride-pill')!
  const trText = dock.querySelector<HTMLElement>('.cm-tr-text')!
  const titleEl = overlay.querySelector<HTMLElement>('.cm-title')!
  const subEl = overlay.querySelector<HTMLElement>('.cm-sub')!
  const balEl = overlay.querySelector<HTMLElement>('.cm-balance')!
  const tabsEl = overlay.querySelector<HTMLElement>('.cm-tabs')!
  const bodyEl = overlay.querySelector<HTMLElement>('.cm-body')!
  const footMsg = overlay.querySelector<HTMLElement>('.cm-foot-msg')!
  const closeBtn = overlay.querySelector<HTMLButtonElement>('.cm-close')!
  const leaveBtn = overlay.querySelector<HTMLButtonElement>('[data-act="leave"]')!

  let mode: OverlayMode = null
  let selectedGarageId: string | null = null
  let busy = false

  function setStatus(msg: string, tone: 'normal' | 'ok' | 'warn' = 'normal') {
    footMsg.textContent = msg
    footMsg.className = `cm-foot-msg${tone === 'normal' ? '' : ' ' + tone}`
  }

  function toast(text: string, ms = 2400) {
    window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text, ms}}))
  }

  function syncTopBar() {
    const s = getState()
    const moneyText = `¥${s.money.toLocaleString('zh-CN')}`
    walletEl.textContent = moneyText
    balEl.textContent = moneyText
    const tr = s.garage.activeTestRide
    if (tr) {
      const rem = Math.max(0, Math.ceil((tr.expiresAt - Date.now()) / 1000))
      trText.textContent = `试驾 ${PERSONAL_EBIKE_MODELS[tr.modelId].name} · ${rem}s`
      trPill.classList.add('show')
    } else {
      trPill.classList.remove('show')
    }
  }

  function setOverlayClasses(kind: 'shop' | 'wardrobe' | 'garage' | null) {
    overlay.className = kind === 'wardrobe'
      ? 'wardrobe-overlay show'
      : kind === 'garage'
        ? 'garage-overlay show'
        : kind === 'shop'
          ? 'shop-overlay show'
          : 'shop-overlay'
    if (kind) document.body.dataset.shopOpen = '1'
    else delete document.body.dataset.shopOpen
  }

  function openShop(shopId: string, initialTab?: string) {
    const shop = SHOP_MAP.get(shopId)
    if (!shop) return false
    const tab = initialTab ?? (shop.kind === 'clothing' ? 'presets' : 'models')
    mode = {kind: 'shop', shop, tab}
    setActiveShopState({shopId: shop.shopId, kind: shop.kind, openedAt: Date.now()})
    setOverlayClasses('shop')
    emit({type: 'shop:open', shopId: shop.shopId, kind: shop.kind})
    callbacks.onOpenOverlay?.(shop, 'shop')
    setStatus('支持 360° 试穿/看车预览，离开时未购预览自动回滚')
    render()
    return true
  }

  function openWardrobe() {
    mode = {kind: 'wardrobe', tab: 'presets'}
    setActiveShopState({shopId: 'portable_wardrobe', kind: 'clothing', openedAt: Date.now()})
    setOverlayClasses('wardrobe')
    callbacks.onOpenOverlay?.(null, 'wardrobe')
    setStatus('随身衣橱：切换已拥有服饰，刷新后保持')
    render()
  }

  function openGarage() {
    mode = {kind: 'garage'}
    setActiveShopState({shopId: 'portable_garage', kind: 'ebike', openedAt: Date.now()})
    setOverlayClasses('garage')
    callbacks.onOpenOverlay?.(null, 'garage')
    setStatus('个人车库：选择主力电摩并一键路边召唤')
    render()
  }

  function close(reason: 'user' | 'esc' | 'fly' | 'teleport' | 'testride' = 'user') {
    if (!mode) return
    const closedShopId = mode.kind === 'shop' ? mode.shop.shopId : null
    mode = null
    callbacks.onPreviewOutfit?.(null)
    callbacks.onPreviewEbike?.(null, null)
    setActiveShopState(null)
    setOverlayClasses(null)
    if (closedShopId) emit({type: 'shop:close', shopId: closedShopId, reason})
    callbacks.onCloseOverlay?.(reason)
  }

  function getSelectedPersonalBike(): OwnedPersonalEbike | null {
    const s = getState()
    const list = Object.values(s.garage.vehicles)
    if (!list.length) return null
    if (selectedGarageId && s.garage.vehicles[selectedGarageId]) return s.garage.vehicles[selectedGarageId]
    if (s.garage.activeVehicleId && s.garage.vehicles[s.garage.activeVehicleId]) return s.garage.vehicles[s.garage.activeVehicleId]
    return list[0]
  }

  function runBuy(fn: () => void) {
    if (busy) return
    busy = true
    try {
      fn()
    } finally {
      busy = false
      render()
    }
  }

  function renderTabs(items: {id: string; label: string}[], activeId: string, onPick: (id: string) => void) {
    tabsEl.innerHTML = ''
    for (const item of items) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `cm-tab${item.id === activeId ? ' on' : ''}`
      btn.textContent = item.label
      btn.onclick = () => onPick(item.id)
      tabsEl.append(btn)
    }
  }

  function renderClothingShop(shop: ShopTriggerDef, tab: string) {
    const s = getState()
    titleEl.textContent = shop.displayName
    subEl.textContent = '原创桂林街头服饰 · 微笑堂东翼旗舰店'
    renderTabs(
      [
        {id: 'presets', label: '推荐套装'},
        {id: 'top', label: '上衣'},
        {id: 'bottom', label: '下装'},
        {id: 'shoes', label: '鞋履'},
        {id: 'hat', label: '头饰'},
        {id: 'bag', label: '背包'},
      ],
      tab,
      next => {
        if (mode?.kind === 'shop') { mode.tab = next; render() }
      },
    )
    bodyEl.innerHTML = ''
    if (tab === 'presets') {
      for (const preset of OUTFIT_PRESETS) {
        if (preset.tier === 0) continue
        const quote = computeOutfitPresetQuote(preset.id, s.wardrobe.ownedItemIds)
        const card = document.createElement('div')
        card.className = 'cm-card'
        card.innerHTML =
          `<div class="cm-card-top"><span class="cm-card-name">${preset.name}<span class="cm-badge${quote.alreadyOwned ? ' owned' : ''}">${quote.alreadyOwned ? '已拥有' : `T${preset.tier}`}</span></span><span class="cm-price">${quote.alreadyOwned ? '已购' : `¥${quote.price}`}</span></div>` +
          `<p class="cm-desc">${preset.desc}${!quote.alreadyOwned && quote.price < preset.price ? `（已减免已购单品差价，原价 ¥${preset.price}）` : ''}</p>`
        const actions = document.createElement('div')
        actions.className = 'cm-actions'
        const previewBtn = document.createElement('button')
        previewBtn.type = 'button'; previewBtn.className = 'cm-btn'; previewBtn.textContent = '试穿预览'
        previewBtn.onclick = () => {
          callbacks.onPreviewOutfit?.({...preset.slots})
          emit({type: 'shop:preview', shopId: shop.shopId, itemType: 'outfit', itemId: preset.id})
          setStatus(`正在试穿「${preset.name}」`, 'ok')
        }
        const buyBtn = document.createElement('button')
        buyBtn.type = 'button'
        buyBtn.className = quote.alreadyOwned ? 'cm-btn jade' : 'cm-btn primary'
        buyBtn.textContent = quote.alreadyOwned ? '立即穿戴' : `购买并穿戴 ¥${quote.price}`
        buyBtn.onclick = () => runBuy(() => {
          if (quote.alreadyOwned) {
            equipOutfitSlots({...preset.slots})
            setStatus(`已穿戴「${preset.name}」`, 'ok')
            return
          }
          const res = executePurchase({
            shopId: shop.shopId,
            itemType: 'outfit_preset',
            itemId: preset.id,
            expectedPrice: quote.price,
            idempotencyKey: `${shop.shopId}:preset:${preset.id}:${nextNonce()}`,
          })
          if (res.ok && res.code === 'OK') {
            setStatus(`购入并穿戴「${preset.name}」，余额 ¥${res.balanceAfter}`, 'ok')
          } else if (res.code === 'INSUFFICIENT_FUNDS') {
            setStatus(`余额不足，还差 ¥${res.deficit}（可先接外卖/跑腿或观景点首打卡）`, 'warn')
          } else {
            setStatus(`购买未完成：${res.code}`, 'warn')
          }
        })
        actions.append(previewBtn, buyBtn)
        card.append(actions)
        bodyEl.append(card)
      }
      return
    }

    const slot = tab as OutfitSlot
    for (const item of OUTFIT_ITEMS) {
      if (item.slot !== slot || item.tier === 0) continue
      const owned = s.wardrobe.ownedItemIds.includes(item.id)
      const equipped = s.wardrobe.equipped[slot] === item.id
      const card = document.createElement('div')
      card.className = `cm-card${equipped ? ' selected' : ''}`
      card.innerHTML =
        `<div class="cm-card-top"><span class="cm-card-name">${item.name}<span class="cm-badge${owned ? ' owned' : ''}">${equipped ? '穿戴中' : owned ? '已拥有' : `T${item.tier}`}</span></span><span class="cm-price">${owned ? '已购' : `¥${item.price}`}</span></div>` +
        `<p class="cm-desc">${item.desc}</p>`
      const actions = document.createElement('div')
      actions.className = 'cm-actions'
      const previewBtn = document.createElement('button')
      previewBtn.type = 'button'; previewBtn.className = 'cm-btn'; previewBtn.textContent = '试穿'
      previewBtn.onclick = () => {
        callbacks.onPreviewOutfit?.({[slot]: item.id})
        emit({type: 'shop:preview', shopId: shop.shopId, itemType: 'outfit', itemId: item.id})
        setStatus(`正在试穿「${item.name}」`, 'ok')
      }
      const buyBtn = document.createElement('button')
      buyBtn.type = 'button'
      buyBtn.className = owned ? 'cm-btn jade' : 'cm-btn primary'
      buyBtn.disabled = equipped
      buyBtn.textContent = equipped ? '当前穿着' : owned ? '穿上' : `购买 ¥${item.price}`
      buyBtn.onclick = () => runBuy(() => {
        if (owned) {
          equipOutfitSlots({[slot]: item.id})
          setStatus(`已换上「${item.name}」`, 'ok')
          return
        }
        const res = executePurchase({
          shopId: shop.shopId,
          itemType: 'outfit_item',
          itemId: item.id,
          expectedPrice: item.price,
          idempotencyKey: `${shop.shopId}:item:${item.id}:${nextNonce()}`,
        })
        if (res.ok && res.code === 'OK') {
          setStatus(`购入并穿戴「${item.name}」，余额 ¥${res.balanceAfter}`, 'ok')
        } else if (res.code === 'INSUFFICIENT_FUNDS') {
          setStatus(`余额不足，还差 ¥${res.deficit}`, 'warn')
        } else {
          setStatus(`操作返回：${res.code}`, 'warn')
        }
      })
      actions.append(previewBtn, buyBtn)
      card.append(actions)
      bodyEl.append(card)
    }
  }

  function renderEbikeShop(shop: ShopTriggerDef, tab: string) {
    const s = getState()
    titleEl.textContent = shop.displayName
    subEl.textContent = '3 档个人电摩 · 免费限时试驾 · 改装充修'
    renderTabs(
      [
        {id: 'models', label: '选购电摩'},
        {id: 'upgrades', label: '性能改装'},
        {id: 'visual', label: '涂装外观'},
        {id: 'service', label: '充电保养'},
      ],
      tab,
      next => {
        if (mode?.kind === 'shop') { mode.tab = next; render() }
      },
    )
    bodyEl.innerHTML = ''

    if (tab === 'models') {
      for (const model of PERSONAL_EBIKE_LIST) {
        const ownedVehicle = Object.values(s.garage.vehicles).find(v => v.modelId === model.id)
        const card = document.createElement('div')
        card.className = `cm-card${ownedVehicle && s.garage.activeVehicleId === ownedVehicle.id ? ' selected' : ''}`
        card.innerHTML =
          `<div class="cm-card-top"><span class="cm-card-name">${model.name}<span class="cm-badge${ownedVehicle ? ' owned' : ''}">${ownedVehicle ? '已入库' : `${model.tier} 档 · ${model.badge}`}</span></span><span class="cm-price">${ownedVehicle ? '已拥有' : `¥${model.price.toLocaleString('zh-CN')}`}</span></div>` +
          `<p class="cm-desc">${model.desc}</p>` +
          `<div class="cm-stats"><span>原厂极速 ${model.stockGearsKmh[3]} km/h</span><span>满改上限 ${model.hardCapKmh} km/h</span><span>电池 ${Math.round(model.baseCapacityScale * 100)}%</span><span>改装 ${model.maxUpgrades.motorLevel}/${model.maxUpgrades.controllerLevel}/${model.maxUpgrades.batteryLevel} 级</span></div>`
        const actions = document.createElement('div')
        actions.className = 'cm-actions'

        const previewBtn = document.createElement('button')
        previewBtn.type = 'button'; previewBtn.className = 'cm-btn'; previewBtn.textContent = '360° 看车'
        previewBtn.onclick = () => {
          callbacks.onPreviewEbike?.(model.id, ownedVehicle?.id ?? null)
          emit({type: 'shop:preview', shopId: shop.shopId, itemType: 'ebike', itemId: model.id})
          setStatus(`正在展示「${model.name}」`, 'ok')
        }

        const testBtn = document.createElement('button')
        testBtn.type = 'button'; testBtn.className = 'cm-btn jade'; testBtn.textContent = '免费试驾 90s'
        testBtn.onclick = () => {
          close('testride')
          const tr = callbacks.onStartTestRide?.(shop.shopId, model.id)
          if (tr && !tr.ok) toast(`无法发起试驾：${tr.code}`)
        }

        const buyBtn = document.createElement('button')
        buyBtn.type = 'button'
        buyBtn.className = ownedVehicle ? 'cm-btn' : 'cm-btn primary'
        buyBtn.textContent = ownedVehicle
          ? (s.garage.activeVehicleId === ownedVehicle.id ? '当前主力车' : '设为主力车')
          : `购车提车 ¥${model.price.toLocaleString('zh-CN')}`
        buyBtn.disabled = !!(ownedVehicle && s.garage.activeVehicleId === ownedVehicle.id)
        buyBtn.onclick = () => runBuy(() => {
          if (ownedVehicle) {
            selectActivePersonalVehicle(ownedVehicle.id)
            selectedGarageId = ownedVehicle.id
            setStatus(`已将「${model.name}」设为车库主力车`, 'ok')
            return
          }
          const res = executePurchase({
            shopId: shop.shopId,
            itemType: 'ebike_model',
            itemId: model.id,
            expectedPrice: model.price,
            idempotencyKey: `${shop.shopId}:ebike:${model.id}:${nextNonce()}`,
          })
          if (res.ok && res.code === 'OK' && res.createdVehicleId) {
            selectedGarageId = res.createdVehicleId
            callbacks.onPersonalBikePurchased?.(shop.shopId, res.createdVehicleId)
            setStatus(`提车成功！「${model.name}」已停放至门口提车位`, 'ok')
          } else if (res.code === 'INSUFFICIENT_FUNDS') {
            setStatus(`余额不足，还差 ¥${res.deficit}（可先试驾或跑外卖/观景点打卡赚钱）`, 'warn')
          } else {
            setStatus(`购车返回：${res.code}`, 'warn')
          }
        })

        actions.append(previewBtn, testBtn, buyBtn)
        card.append(actions)
        bodyEl.append(card)
      }
      return
    }

    const bike = getSelectedPersonalBike()
    if (!bike) {
      const empty = document.createElement('div')
      empty.className = 'cm-card'
      empty.innerHTML = '<div class="cm-card-name">暂无个人电摩</div><p class="cm-desc">共享电车不可改装与进店保养。请先在「选购电摩」购入个人电摩，或先免费试驾体验。</p>'
      bodyEl.append(empty)
      return
    }

    const modelDef = PERSONAL_EBIKE_MODELS[bike.modelId]
    const profile = resolvePersonalEbikeProfile(bike.modelId, bike.upgrades)
    const banner = document.createElement('div')
    banner.className = 'cm-card selected'
    banner.innerHTML =
      `<div class="cm-card-top"><span class="cm-card-name">当前改装车辆：${modelDef.name}</span><span class="cm-badge owned">极速 ${profile.tierMaxKmh} km/h</span></div>` +
      `<div class="cm-stats"><span>电量 ${Math.round(bike.batteryPct)}%</span><span>车况 ${Math.round(bike.durabilityPct)}%</span><span>电机 Lv.${bike.upgrades.motorLevel}/${modelDef.maxUpgrades.motorLevel}</span><span>电控 Lv.${bike.upgrades.controllerLevel}/${modelDef.maxUpgrades.controllerLevel}</span><span>电池 Lv.${bike.upgrades.batteryLevel}/${modelDef.maxUpgrades.batteryLevel}</span></div>`
    bodyEl.append(banner)

    if (tab === 'upgrades') {
      for (const entry of EBIKE_UPGRADE_CATALOG) {
        const cap = modelDef.maxUpgrades[entry.part]
        const curLvl = bike.upgrades[entry.part]
        const locked = entry.level > cap
        const owned = curLvl >= entry.level
        const card = document.createElement('div')
        card.className = 'cm-card'
        card.innerHTML =
          `<div class="cm-card-top"><span class="cm-card-name">${entry.name}<span class="cm-badge${owned ? ' owned' : ''}">${owned ? '已安装' : locked ? '车型不支持' : '可升级'}</span></span><span class="cm-price">${owned ? '已装' : locked ? '—' : `¥${entry.price}`}</span></div>` +
          `<p class="cm-desc">${entry.desc}</p>`
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = owned || locked ? 'cm-btn' : 'cm-btn primary'
        btn.disabled = owned || locked
        btn.textContent = owned ? '已安装' : locked ? `需更高档位车型（上限 Lv.${cap}）` : `安装改装 ¥${entry.price}`
        btn.onclick = () => runBuy(() => {
          const res = executePurchase({
            shopId: shop.shopId,
            itemType: 'ebike_upgrade',
            itemId: entry.id,
            targetVehicleId: bike.id,
            expectedPrice: entry.price,
            idempotencyKey: `${shop.shopId}:upg:${bike.id}:${entry.id}:${nextNonce()}`,
          })
          if (res.ok && res.code === 'OK') {
            callbacks.onPersonalBikeUpdated?.(bike.id)
            setStatus(`已安装「${entry.name}」，配置已持久化`, 'ok')
          } else if (res.code === 'INSUFFICIENT_FUNDS') {
            setStatus(`余额不足，还差 ¥${res.deficit}`, 'warn')
          } else {
            setStatus(`改装返回：${res.code}`, 'warn')
          }
        })
        card.append(btn)
        bodyEl.append(card)
      }
      return
    }

    if (tab === 'visual') {
      for (const entry of EBIKE_VISUAL_CATALOG) {
        const allowed =
          !entry.requires ||
          (entry.requires === 'neon' && modelDef.allowedPresets.includes('neon')) ||
          (entry.requires === 'ghostfire' && modelDef.allowedPresets.includes('ghostfire')) ||
          (entry.requires === 'underglow' && modelDef.allowUnderglow) ||
          (entry.requires === 'angelEye' && modelDef.allowAngelEye) ||
          (entry.requires === 'goldShock' && modelDef.allowGoldShock) ||
          (entry.requires === 'aero' && modelDef.allowAeroParts)
        const card = document.createElement('div')
        card.className = 'cm-card'
        card.innerHTML =
          `<div class="cm-card-top"><span class="cm-card-name">${entry.name}<span class="cm-badge">${allowed ? '支持' : '车型限定'}</span></span><span class="cm-price">${allowed ? `¥${entry.price}` : '—'}</span></div>` +
          `<p class="cm-desc">${entry.desc}</p>`
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = allowed ? 'cm-btn primary' : 'cm-btn'
        btn.disabled = !allowed
        btn.textContent = allowed ? `涂装/安装 ¥${entry.price}` : '该车型不支持此套件'
        btn.onclick = () => runBuy(() => {
          const res = executePurchase({
            shopId: shop.shopId,
            itemType: 'ebike_visual',
            itemId: entry.id,
            targetVehicleId: bike.id,
            expectedPrice: entry.price,
            idempotencyKey: `${shop.shopId}:vis:${bike.id}:${entry.id}:${nextNonce()}`,
          })
          if (res.ok && res.code === 'OK') {
            callbacks.onPersonalBikeUpdated?.(bike.id)
            setStatus(`外观已更新「${entry.name}」并持久化`, 'ok')
          } else if (res.code === 'ALREADY_OWNED') {
            setStatus('车辆当前已是该涂装/配件，未扣款', 'ok')
          } else if (res.code === 'INSUFFICIENT_FUNDS') {
            setStatus(`余额不足，还差 ¥${res.deficit}`, 'warn')
          } else {
            setStatus(`外观改装返回：${res.code}`, 'warn')
          }
        })
        card.append(btn)
        bodyEl.append(card)
      }
      return
    }

    // Service tab (free slow charge / fast charge ¥20 / full repair <= ¥80 / full service)
    const fastCost = calcFastChargeCost(bike.batteryPct)
    const repairCost = calcRepairCost(bike.durabilityPct)
    const fullCost = calcFullServiceCost(bike.batteryPct, bike.durabilityPct)
    const services = [
      {
        id: 'slow_charge',
        name: '公共慢充（免费充至 80%）',
        desc: '公益便民慢充工位，适合低余额应急回血',
        price: 0,
        disabled: bike.batteryPct >= 80,
      },
      {
        id: 'fast_charge',
        name: '直流快充（立即 100% 满电）',
        desc: '100% 满电出发，免等待',
        price: fastCost,
        disabled: fastCost === 0,
      },
      {
        id: 'full_repair',
        name: '底盘精修（车况恢复 100%）',
        desc: '修复摔车刮擦损耗，恢复满额加速手感',
        price: repairCost,
        disabled: repairCost === 0,
      },
      {
        id: 'full_service',
        name: '一键满电 + 满修保养',
        desc: '电量与车况同步拉满，满状态自动禁止扣费',
        price: fullCost,
        disabled: fullCost === 0,
      },
    ]
    for (const svc of services) {
      const card = document.createElement('div')
      card.className = 'cm-card'
      card.innerHTML =
        `<div class="cm-card-top"><span class="cm-card-name">${svc.name}</span><span class="cm-price">${svc.disabled ? '状态已满' : svc.price === 0 ? '免费' : `¥${svc.price}`}</span></div>` +
        `<p class="cm-desc">${svc.desc}</p>`
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = svc.disabled ? 'cm-btn' : 'cm-btn primary'
      btn.disabled = svc.disabled
      btn.textContent = svc.disabled ? '无需处理' : svc.price === 0 ? '免费慢充' : `立即办理 ¥${svc.price}`
      btn.onclick = () => runBuy(() => {
        const res = executePurchase({
          shopId: shop.shopId,
          itemType: 'ebike_service',
          itemId: svc.id,
          targetVehicleId: bike.id,
          expectedPrice: svc.price,
          idempotencyKey: `${shop.shopId}:svc:${bike.id}:${svc.id}:${nextNonce()}`,
        })
        if (res.ok && res.code === 'OK') {
          callbacks.onPersonalBikeUpdated?.(bike.id)
          setStatus(`已完成「${svc.name}」，花费 ¥${res.charged}`, 'ok')
        } else if (res.code === 'ALREADY_FULL') {
          setStatus('车辆已满电满车况，未扣款', 'ok')
        } else if (res.code === 'INSUFFICIENT_FUNDS') {
          setStatus(`余额不足，还差 ¥${res.deficit}`, 'warn')
        }
      })
      card.append(btn)
      bodyEl.append(card)
    }
  }

  function renderWardrobe(tab: OutfitSlot | 'presets') {
    const s = getState()
    titleEl.textContent = '随身衣橱'
    subEl.textContent = '自由混搭 5 槽位 · 骑电摩可自动叠戴安全头盔'
    renderTabs(
      [
        {id: 'presets', label: '套装'},
        {id: 'top', label: '上衣'},
        {id: 'bottom', label: '下装'},
        {id: 'shoes', label: '鞋履'},
        {id: 'hat', label: '头饰'},
        {id: 'bag', label: '背包'},
      ],
      tab,
      next => {
        if (mode?.kind === 'wardrobe') { mode.tab = next as OutfitSlot | 'presets'; render() }
      },
    )
    bodyEl.innerHTML = ''
    const helmetRow = document.createElement('div')
    helmetRow.className = 'cm-card'
    helmetRow.innerHTML = `<div class="cm-card-top"><span class="cm-card-name">骑电摩自动叠戴通勤头盔</span><button type="button" class="cm-btn ${s.wardrobe.autoHelmetOnRide ? 'jade' : ''}" style="flex:0 0 auto;min-width:74px">${s.wardrobe.autoHelmetOnRide ? '已开启' : '已关闭'}</button></div><p class="cm-desc">上车自动护头，下车自动恢复原头饰，不覆盖衣橱存档。</p>`
    helmetRow.querySelector('button')!.onclick = () => { setAutoHelmetOnRide(!s.wardrobe.autoHelmetOnRide); render() }
    bodyEl.append(helmetRow)

    if (tab === 'presets') {
      for (const preset of OUTFIT_PRESETS) {
        const quote = computeOutfitPresetQuote(preset.id, s.wardrobe.ownedItemIds)
        if (!quote.alreadyOwned) continue
        const card = document.createElement('div')
        card.className = 'cm-card'
        card.innerHTML = `<div class="cm-card-top"><span class="cm-card-name">${preset.name}</span><span class="cm-badge owned">已拥有</span></div><p class="cm-desc">${preset.desc}</p>`
        const btn = document.createElement('button')
        btn.type = 'button'; btn.className = 'cm-btn jade'; btn.textContent = '整套换上'
        btn.onclick = () => { equipOutfitSlots({...preset.slots}); setStatus(`已切换「${preset.name}」`, 'ok'); render() }
        card.append(btn)
        bodyEl.append(card)
      }
      return
    }

    const ownedItems = OUTFIT_ITEMS.filter(i => i.slot === tab && s.wardrobe.ownedItemIds.includes(i.id))
    for (const item of ownedItems) {
      const eq = s.wardrobe.equipped[tab] === item.id
      const card = document.createElement('div')
      card.className = `cm-card${eq ? ' selected' : ''}`
      card.innerHTML = `<div class="cm-card-top"><span class="cm-card-name">${item.name}</span><span class="cm-badge${eq ? ' owned' : ''}">${eq ? '穿戴中' : SLOT_LABELS[tab]}</span></div><p class="cm-desc">${item.desc}</p>`
      const btn = document.createElement('button')
      btn.type = 'button'; btn.className = eq ? 'cm-btn' : 'cm-btn jade'; btn.disabled = eq; btn.textContent = eq ? '当前穿戴' : '换上'
      btn.onclick = () => { equipOutfitSlots({[tab]: item.id}); setStatus(`已换上「${item.name}」`, 'ok'); render() }
      card.append(btn)
      bodyEl.append(card)
    }
  }

  function renderGarage() {
    const s = getState()
    titleEl.textContent = '个人电摩车库'
    subEl.textContent = '非校园安静区步行时可一键路边召唤（10s 冷却）'
    tabsEl.innerHTML = ''
    bodyEl.innerHTML = ''
    const list = Object.values(s.garage.vehicles)
    if (!list.length) {
      const empty = document.createElement('div')
      empty.className = 'cm-card'
      empty.innerHTML = '<div class="cm-card-name">车库空空如也</div><p class="cm-desc">前往十字街东北角「榕城电行」选购你的第一台个人电摩（支持免费 90 秒试驾）。</p>'
      bodyEl.append(empty)
      return
    }
    for (const bike of list) {
      const def = PERSONAL_EBIKE_MODELS[bike.modelId]
      const prof = resolvePersonalEbikeProfile(bike.modelId, bike.upgrades)
      const isActive = s.garage.activeVehicleId === bike.id
      const card = document.createElement('div')
      card.className = `cm-card${isActive ? ' selected' : ''}`
      card.innerHTML =
        `<div class="cm-card-top"><span class="cm-card-name">${def.name}<span class="cm-badge${isActive ? ' owned' : ''}">${isActive ? '主力车' : `${def.tier} 档`}</span></span><span class="cm-price">${prof.tierMaxKmh} km/h</span></div>` +
        `<div class="cm-stats"><span>电量 ${Math.round(bike.batteryPct)}%</span><span>车况 ${Math.round(bike.durabilityPct)}%</span><span>里程 ${bike.odometerKm.toFixed(1)} km</span><span>改装 ${bike.upgrades.motorLevel}/${bike.upgrades.controllerLevel}/${bike.upgrades.batteryLevel}</span></div>`
      const actions = document.createElement('div')
      actions.className = 'cm-actions'
      const selBtn = document.createElement('button')
      selBtn.type = 'button'; selBtn.className = 'cm-btn'; selBtn.disabled = isActive; selBtn.textContent = isActive ? '已设主力' : '设为主力'
      selBtn.onclick = () => { selectActivePersonalVehicle(bike.id); setStatus(`已将「${def.name}」设为常用车`, 'ok'); render() }
      const summonBtn = document.createElement('button')
      summonBtn.type = 'button'; summonBtn.className = 'cm-btn primary'; summonBtn.textContent = '路边召唤'
      summonBtn.onclick = () => {
        selectActivePersonalVehicle(bike.id)
        close('user')
        const res = callbacks.onSummonPersonal?.(bike.id)
        if (res && !res.ok) {
          const msg =
            res.code === 'QUIET_ZONE_BLOCKED' ? '校园安静区内禁止召唤电摩，请走出校门后重试'
              : res.code === 'COOLDOWN' ? `召唤冷却中，请 ${Math.ceil((res.cooldownRemainingMs ?? 1000) / 1000)} 秒后再试`
                : res.code === 'NOT_ON_FOOT' ? '请先下车或落地步行后再召唤个人电摩'
                  : res.code === 'NO_SAFE_SPOT' ? '附近空位不足，请移步街边重试'
                    : `无法召唤：${res.code}`
          toast(msg, 2800)
        }
      }
      actions.append(selBtn, summonBtn)
      card.append(actions)
      bodyEl.append(card)
    }
  }

  function render() {
    syncTopBar()
    if (!mode) return
    if (mode.kind === 'shop') {
      if (mode.shop.kind === 'clothing') renderClothingShop(mode.shop, mode.tab)
      else renderEbikeShop(mode.shop, mode.tab)
    } else if (mode.kind === 'wardrobe') {
      renderWardrobe(mode.tab)
    } else {
      renderGarage()
    }
  }

  dock.addEventListener('click', event => {
    const btn = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-act]')
    if (!btn) return
    const act = btn.dataset.act
    if (act === 'wardrobe') openWardrobe()
    else if (act === 'garage') openGarage()
    else if (act === 'summon') {
      const res = callbacks.onSummonPersonal?.()
      if (res && !res.ok) {
        const msg =
          res.code === 'NO_OWNED_VEHICLE' ? '尚无个人电摩，请前往十字街「榕城电行」购车'
            : res.code === 'QUIET_ZONE_BLOCKED' ? '校园安静区内禁止召唤电摩'
              : res.code === 'COOLDOWN' ? `召唤冷却中，剩余 ${Math.ceil((res.cooldownRemainingMs ?? 1000) / 1000)}s`
                : res.code === 'NOT_ON_FOOT' ? '请先下车再召唤电摩'
                  : '附近无安全停车空位，请移步街边'
        toast(msg, 2600)
      }
    } else if (act === 'end-tr') {
      callbacks.onEndTestRide?.('user')
    }
  })

  closeBtn.onclick = () => close('user')
  leaveBtn.onclick = () => close('user')
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Escape' && mode) {
      event.preventDefault()
      event.stopPropagation()
      close('esc')
    }
  }
  window.addEventListener('keydown', onKeyDown, true)

  const offState = onState(() => {
    syncTopBar()
    if (mode) render()
  })
  const timer = window.setInterval(() => {
    if (getState().garage.activeTestRide) syncTopBar()
  }, 500)
  syncTopBar()

  return {
    openShop,
    openWardrobe,
    openGarage,
    close,
    get isOpen() { return mode !== null },
    get currentMode() { return mode },
    dispose() {
      clearInterval(timer)
      offState()
      window.removeEventListener('keydown', onKeyDown, true)
      dock.remove()
      overlay.remove()
      delete document.body.dataset.shopOpen
    },
  }
}
