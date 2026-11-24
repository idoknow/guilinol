import * as THREE from 'three'
import './mifen-ui.css'
import rawRecipes from './recipes.json'
import type { MifenRecipesData, ShopLevel, StationKey, TianyuanShopBuildResult } from './types'
import { buildTianyuanShopMesh, TIANYUAN_SITE } from './shop-mesh'
import { computeShopBonuses, createMifenStore, formatMoney, formatRecipeTitle, type MifenSaveState } from './state'
import {
  COOKING_STATION_LABELS,
  createCookingController,
  type ActiveCookOrder,
  type CookingStage,
  type CookingStation,
  type CookingStep,
  type CookingVisualState,
} from './cooking'
import { createCustomerManager, type QueuedTicketInfo, type ShopCoordAdapter } from './customers'
import { createUpgradeController } from './upgrade'
import { createMifenEconomy, ECONOMY_UI_SLOTS, type EconomyDashboardSnapshot } from './economy'
import { createEconomyHud, type EconomyPanelKey } from './economy-hud'
import { createMifenAudio, type MifenAudioStats, type MifenSoundId } from './audio'
import {
  createUncleNpc,
  PLAYER_PORTRAIT,
  UNCLE_PORTRAITS,
  UNCLE_SPOT,
} from './story/uncle'
import { STORY_BEATS } from './story/script'
import {
  createStoryDirector,
  type DirectorAudioLike,
  type DirectorNpcLike,
  type StoryDirectorProbe,
} from './story/director'
import { isFirstPerson, setViewMode } from '../walk/view-mode'

const recipesData = rawRecipes as unknown as MifenRecipesData

const RIDE_SOUND_STORAGE_KEY = 'glol.rideSoundMuted'
const RIDE_SOUND_EVENT = 'glol:ride-sound'
const UNCLE_INTERACT_RADIUS = 2.9

export interface StoryStateSnapshot extends StoryDirectorProbe {
  unclePos: [number, number, number]
}

export interface MifenMountContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  clock: { hour: number; set(hour: number): void }
  getPlayerPos: () => THREE.Vector3 | null
  walkTo: (x: number, z: number, yaw: number, reason: string, name?: string) => Promise<boolean>
  showToast: (text: string, ms?: number) => void
  sampleGroundY?: (x: number, z: number) => number
  getNightFactor: () => number
}

export interface StationInteractResult {
  ok: boolean
  station: StationKey
  stage: CookingStage
  requiredStation: CookingStation | null
  reason?: string
  ticketId?: string
  recipeName?: string
  distance?: number
}

export interface MifenDebugProbe {
  readonly cookingVisual: CookingVisualState
  readonly requiredStation: CookingStation | null
  readonly cookingStage: CookingStage
  readonly story: StoryStateSnapshot
  readonly audio: {
    getStats: () => MifenAudioStats
    setMuted: (muted: boolean) => void
    isMuted: () => boolean
    play: (id: MifenSoundId) => boolean
  }
  getState(): {
    save: Readonly<MifenSaveState>
    shopLevel: ShopLevel
    nearShop: boolean
    insideShop: boolean
    canEarn: boolean
    storyUnlocked: boolean
    story: StoryStateSnapshot
    audio: MifenAudioStats
    lastCookReason: string | null
    playerDistance: number
    playerZone: 'outside' | 'front' | 'kitchen'
    nearestStation: StationKey | null
    queueCount: number
    activeCustomers: number
    seatedCount: number
    cookingOpen: boolean
    cookingStep: CookingStep | null
    cookingStage: CookingStage
    requiredStation: CookingStation | null
    cookingVisual: CookingVisualState
    upgradeOpen: boolean
    economyPanel: EconomyPanelKey | null
    economy: EconomyDashboardSnapshot
    seatCount: number
    site: typeof TIANYUAN_SITE
    stationWorldPositions: Record<StationKey, [number, number, number]>
  }
  isStoryUnlocked(): boolean
  getStoryState(): StoryStateSnapshot
  getAudioStats(): MifenAudioStats
  resetStory(): StoryStateSnapshot
  teleportToShop(): Promise<boolean>
  walkInside(zone: 'front' | 'kitchen' | 'outside'): Promise<boolean>
  walkToStation(station: StationKey): Promise<boolean>
  interactStation(key: StationKey): StationInteractResult
  getCookingVisualState(): CookingVisualState
  spawnCustomerNow(): { id: string; recipeId: string; name: string } | null
  startCookingNext(station?: CookingStation): {
    ok: boolean
    ticketId?: string
    recipeName?: string
    stage?: CookingStage
    requiredStation?: CookingStation | null
    reason?: string
  }
  completeActiveOrderPerfect?: () => { ok: boolean; stars?: number; revenue?: number; tip?: number; reason?: string }
  grantFunds?: (n: number) => number
  setShopLevel?: (lvl: ShopLevel) => ShopLevel
  setHour(hour: number): number
  openUpgrade(): void
  closeUpgrade(): void
  openEconomyPanel(key: EconomyPanelKey): void
  closeEconomyPanel(): void
  resetSave(): Readonly<MifenSaveState>
  getBubbleMetrics(): Array<{
    id: string
    phase: string
    visible: boolean
    dist: number
    scaleX: number
    scaleY: number
    opacity: number
  }>
}

export interface MifenController {
  step(dt: number): void
  teleportToShop(): Promise<boolean>
  getProbe(): MifenDebugProbe
  dispose(): void
}

const STATION_ACTION: Record<StationKey, string> = {
  counter: '前台淋卤',
  boil: '煮锅烫粉',
  meat: '肉台切码',
  broth: '前台淋卤',
  toppings: '小料',
  pickup: '取餐口',
  upgrade: '扩店',
}

const STATION_REACH_RADIUS: Record<StationKey, number> = {
  boil: 2.35,
  meat: 2.35,
  counter: 2.7,
  broth: 2.6,
  toppings: 2.5,
  pickup: 2.3,
  upgrade: 2.5,
}

const ALL_STATION_KEYS = Object.keys(STATION_ACTION) as StationKey[]

const MEAT_LABELS: Record<string, string> = {
  guoshao: '锅烧',
  beef: '卤牛肉',
  charsiu: '叉烧',
  egg: '卤蛋',
  youtiao: '油条',
}

const MAX_TICKETS = 5

type RailTicket = Pick<
  QueuedTicketInfo,
  'id' | 'customerName' | 'recipe' | 'patienceRatio' | 'patienceSecLeft' | 'beingCooked'
> & { archetype: ActiveCookOrder['archetype']; price?: number }
const MAX_TOASTS = 3
const TOAST_MS = 2600

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

function isLocalPoint(p: readonly [number, number, number]): boolean {
  return Math.hypot(p[0], p[2]) < 80
}

function isInputFocused(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false
  return !!(target as Element).closest('input,textarea,select,[contenteditable]')
}

function readSharedRideSoundMuted(): boolean {
  try {
    return window.localStorage.getItem(RIDE_SOUND_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function mountTianyuanMifen(ctx: MifenMountContext): MifenController {
  const store = createMifenStore()
  const economy = createMifenEconomy(store, recipesData)
  const audio = createMifenAudio({ muted: readSharedRideSoundMuted() })
  let shop: TianyuanShopBuildResult
  let groundAligned = false
  let elapsedTime = 0
  let hudRefreshTimer = 0
  let nearShop = false
  let nearUncle = false
  let lastPlayerDistance = Infinity
  let nearestStation: StationKey | null = null
  let lastCookReason: string | null = null

  function onRideSoundEvent(ev: Event): void {
    const detail = (ev as CustomEvent<{ muted?: boolean }>).detail
    audio.setMuted(typeof detail?.muted === 'boolean' ? detail.muted : readSharedRideSoundMuted())
  }
  window.addEventListener(RIDE_SOUND_EVENT, onRideSoundEvent)

  function placeShopGroup(built: TianyuanShopBuildResult): void {
    const [sx, sy, sz] = TIANYUAN_SITE.position
    const sampledY = ctx.sampleGroundY?.(sx, sz)
    const validGroundY =
      typeof sampledY === 'number' && Number.isFinite(sampledY) && Math.abs(sampledY - sy) <= 10 ? sampledY : sy
    if (typeof sampledY === 'number' && Number.isFinite(sampledY) && Math.abs(sampledY - sy) <= 10) {
      groundAligned = true
    }

    if (built.group.position.lengthSq() < 1) {
      built.group.position.set(sx, validGroundY, sz)
      built.group.rotation.y = TIANYUAN_SITE.rotationY
    } else if (groundAligned) {
      built.group.position.y = validGroundY
    }
    built.group.updateMatrixWorld(true)
  }

  function makeCoordAdapter(currentShop: TianyuanShopBuildResult): ShopCoordAdapter {
    return {
      toWorldPoint(p, out = new THREE.Vector3()) {
        out.set(p[0], p[1], p[2])
        if (isLocalPoint(p)) {
          currentShop.group.updateMatrixWorld(true)
          currentShop.group.localToWorld(out)
        }
        return out
      },
      toLocalPoint(worldPos, out = new THREE.Vector3()) {
        currentShop.group.updateMatrixWorld(true)
        return currentShop.group.worldToLocal(out.copy(worldPos))
      },
      toWorldYaw(yaw, refPoint) {
        return isLocalPoint(refPoint) ? yaw + currentShop.group.rotation.y : yaw
      },
      localToWorld(x, y, z, out = new THREE.Vector3()) {
        currentShop.group.updateMatrixWorld(true)
        return currentShop.group.localToWorld(out.set(x, y, z))
      },
      sampleWalkY(wx, wz, insideShop) {
        const baseY = currentShop.group.position.y
        if (insideShop) return baseY + 0.04
        const sampled = ctx.sampleGroundY?.(wx, wz)
        if (typeof sampled === 'number' && Number.isFinite(sampled) && Math.abs(sampled - baseY) <= 1.6) {
          return sampled
        }
        return baseY
      },
    }
  }

  shop = buildTianyuanShopMesh(store.getState().shopLevel)
  placeShopGroup(shop)
  ctx.scene.add(shop.group)
  let coords = makeCoordAdapter(shop)

  const uncle = createUncleNpc({ scene: ctx.scene })
  const uncleWorldPos = new THREE.Vector3()
  function placeUncleNpc(): void {
    coords.localToWorld(UNCLE_SPOT[0], UNCLE_SPOT[1], UNCLE_SPOT[2], uncleWorldPos)
    uncleWorldPos.y = coords.sampleWalkY(uncleWorldPos.x, uncleWorldPos.z, false)
    uncle.setPose(uncleWorldPos.x, uncleWorldPos.y, uncleWorldPos.z, shop.group.rotation.y)
  }
  placeUncleNpc()

  // Hidden as a whole in photo mode, on the title screen and under shop overlays (see mifen-ui.css).
  const hudRoot = document.createElement('div')
  hudRoot.className = 'mifen-hud-root'
  document.body.append(hudRoot)

  const tpBtn = document.createElement('button')
  tpBtn.type = 'button'
  tpBtn.className = 'mifen-pill'
  tpBtn.setAttribute('aria-label', '前往田源米粉，快捷键 N')
  tpBtn.innerHTML = '<span>田源米粉</span><kbd>N</kbd>'
  hudRoot.append(tpBtn)

  const statusBarEl = document.createElement('header')
  statusBarEl.className = 'mifen-bar'
  statusBarEl.hidden = true
  statusBarEl.setAttribute('aria-label', '田源米粉经营面板')
  statusBarEl.innerHTML = `
    <span class="mifen-stat" data-mf-stat="funds"><span class="mifen-sr">资金</span><b></b></span>
    <span class="mifen-stat" data-mf-stat="rating"><span class="mifen-sr">口碑</span><b></b></span>
    <span class="mifen-stat" data-mf-stat="phase" hidden><span class="mifen-sr">时段</span><b></b></span>
    <button type="button" class="mifen-btn mifen-btn--primary" data-hud-action="cook-next">做粉</button>
    ${ECONOMY_UI_SLOTS.actions
      .map(s => `<button type="button" class="mifen-btn" data-hud-action="${s.hudAction}" aria-expanded="false">${s.label}</button>`)
      .join('')}
    <button type="button" class="mifen-btn" data-hud-action="open-upgrade" aria-expanded="false">扩店</button>
  `
  hudRoot.append(statusBarEl)
  const fundsEl = statusBarEl.querySelector('[data-mf-stat="funds"] b')!
  const ratingEl = statusBarEl.querySelector('[data-mf-stat="rating"] b')!
  const cookBtn = statusBarEl.querySelector<HTMLButtonElement>('[data-hud-action="cook-next"]')!
  const upgradeBtn = statusBarEl.querySelector<HTMLButtonElement>('[data-hud-action="open-upgrade"]')!

  const ticketRailEl = document.createElement('ol')
  ticketRailEl.className = 'mifen-tickets'
  ticketRailEl.hidden = true
  ticketRailEl.setAttribute('aria-label', '粉票')
  hudRoot.append(ticketRailEl)
  const ticketEls = new Map<string, HTMLLIElement>()
  const moreTicketsEl = document.createElement('li')
  moreTicketsEl.className = 'mifen-tickets-more'

  const promptBtn = document.createElement('button')
  promptBtn.type = 'button'
  promptBtn.className = 'mifen-prompt'
  promptBtn.hidden = true
  promptBtn.innerHTML = '<kbd>E</kbd><span></span>'
  hudRoot.append(promptBtn)
  const promptLabelEl = promptBtn.querySelector('span')!

  const toastLayer = document.createElement('div')
  toastLayer.className = 'mifen-toasts'
  toastLayer.setAttribute('role', 'status')
  toastLayer.setAttribute('aria-live', 'polite')
  hudRoot.append(toastLayer)

  function notify(text: string, meta = '', warn = false): void {
    const toast = document.createElement('div')
    toast.className = warn ? 'mifen-toast is-warn' : 'mifen-toast'
    const body = document.createElement('span')
    body.textContent = text
    toast.append(body)
    if (meta) {
      const metaEl = document.createElement('b')
      metaEl.textContent = meta
      toast.append(metaEl)
    }
    toastLayer.append(toast)
    while (toastLayer.childElementCount > MAX_TOASTS) toastLayer.firstElementChild?.remove()
    window.setTimeout(() => toast.remove(), TOAST_MS)
  }

  function detectPlayerZone(pos: THREE.Vector3 | null): 'outside' | 'front' | 'kitchen' {
    if (!pos) return 'outside'
    const pLocal = coords.toLocalPoint(pos, new THREE.Vector3())
    const wb = shop.walkBounds
    const inBounds =
      Math.abs(wb.minX) < 120
        ? pLocal.x >= wb.minX && pLocal.x <= wb.maxX && pLocal.z >= wb.minZ && pLocal.z <= wb.maxZ
        : pos.x >= wb.minX && pos.x <= wb.maxX && pos.z >= wb.minZ && pos.z <= wb.maxZ
    if (!inBounds) return 'outside'
    const kitLocal = coords.toLocalPoint(
      coords.toWorldPoint(shop.kitchenEntry, new THREE.Vector3()),
      new THREE.Vector3(),
    )
    return pLocal.z <= kitLocal.z + 0.25 ? 'kitchen' : 'front'
  }

  const directorNpc: DirectorNpcLike = {
    group: uncle.group,
    setMarker: mode => uncle.setMarker(mode),
    setTalking: on => uncle.setTalking(on),
    setExpression: id => uncle.setExpression(id),
    headWorld: () => uncle.headWorld(new THREE.Vector3()),
  }

  const directorAudio: DirectorAudioLike = {
    play: id => audio.play(id as MifenSoundId),
    playBlip: speaker => audio.playBlip(speaker),
  }

  const director = createStoryDirector({
    camera: ctx.camera,
    container: hudRoot,
    getPlayerPos: ctx.getPlayerPos,
    npc: directorNpc,
    beats: STORY_BEATS,
    portraits: UNCLE_PORTRAITS,
    playerPortrait: PLAYER_PORTRAIT,
    audio: directorAudio,
    onUnlock() {
      uncle.setMarker('none')
      audio.play('story_unlock')
      renderHud()
      updatePromptUi()
    },
    onBeatDone() {
      renderHud()
      updatePromptUi()
    },
  })
  uncle.setMarker(director.isUnlocked() ? 'none' : 'new')

  function isInsideShop(pos: THREE.Vector3 | null = ctx.getPlayerPos()): boolean {
    return detectPlayerZone(pos) !== 'outside'
  }

  function isStoryUnlocked(): boolean {
    return director.isUnlocked()
  }

  function canEarn(pos: THREE.Vector3 | null = ctx.getPlayerPos()): boolean {
    return isStoryUnlocked() && isInsideShop(pos)
  }

  function getStoryStateSnapshot(): StoryStateSnapshot {
    const raw = director.getProbe()
    return {
      ...raw,
      unclePos: [
        Math.round(uncleWorldPos.x * 100) / 100,
        Math.round(uncleWorldPos.y * 100) / 100,
        Math.round(uncleWorldPos.z * 100) / 100,
      ],
    }
  }

  const getBonuses = () => computeShopBonuses(store.getState(), recipesData.upgrades ?? [])

  const cooking = createCookingController({
    container: hudRoot,
    getBonuses,
    getEconomyContext() {
      const s = store.getState()
      return { hour: ctx.clock.hour, reputation: s.reputation, shopLevel: s.shopLevel, streak: s.streak, inventory: s.inventory }
    },
    onComplete(result) {
      if (economyHud.isDeliveryTicket(result.ticketId)) {
        economyHud.settleDelivery(result.ticketId, result.stars)
      } else {
        customers.serveCustomer(result)
        economy.recordDineInSale({ recipeId: result.recipe.id, stars: result.stars, hour: ctx.clock.hour })
        audio.play('cash_register')
      }
      if (store.getState().totalBowlsServed === 1) {
        director.notify('first_bowl_served')
      }
      renderHud()
      updatePromptUi()
    },
    onCancel() {
      audio.stopAllLoops()
      renderHud()
      updatePromptUi()
    },
    onStageChange() {
      renderHud()
      updatePromptUi()
    },
    onStationAdvance({ completedStation, nextStation }) {
      if (nextStation) {
        notify(`${COOKING_STATION_LABELS[completedStation]}完成`, `前往${COOKING_STATION_LABELS[nextStation]}`)
      }
      renderHud()
      updatePromptUi()
    },
  })

  const customers = createCustomerManager(ctx.scene, recipesData, shop, coords, {
    getShopLevel: () => store.getState().shopLevel,
    getBonuses,
    getHour: () => ctx.clock.hour,
    getReputation: () => store.getState().reputation,
    getActiveCookingTicketId: () => cooking.getActiveOrder()?.ticketId ?? null,
    canEarn: () => canEarn(),
    onCustomerFinished({ praiseLine }) {
      notify(`「${praiseLine}」`)
      renderHud()
    },
    onCustomerImpatient({ line }) {
      store.recordCustomerLeftAngry()
      notify(`「${line}」`, '走了', true)
      renderHud()
    },
  })

  function rebuildShop(nextLevel: ShopLevel): void {
    const oldShop = shop
    oldShop.group.removeFromParent()
    oldShop.dispose()

    shop = buildTianyuanShopMesh(nextLevel)
    placeShopGroup(shop)
    ctx.scene.add(shop.group)
    coords = makeCoordAdapter(shop)
    placeUncleNpc()
    customers.onShopChanged(shop, coords)
    renderHud()
  }

  const upgrade = createUpgradeController(store, recipesData, {
    container: hudRoot,
    onShopLevelUp(nextLevel) {
      rebuildShop(nextLevel)
      if (nextLevel === 2) director.notify('shop_level_2')
      else if (nextLevel === 3) director.notify('shop_level_3')
    },
    onToast(msg) {
      notify(msg)
    },
    onClose() {
      renderHud()
    },
  })

  const economyHud = createEconomyHud({
    container: hudRoot,
    economy,
    store,
    recipesData,
    getHour: () => ctx.clock.hour,
    canEarn: () => canEarn(),
    onSound: id => audio.play(id),
    notify,
    onChange: () => renderHud(),
  })

  function isOverlayOpen(): boolean {
    return cooking.isOpen() || upgrade.isOpen() || economyHud.getOpenPanel() !== null
  }

  function getRailTickets(): RailTicket[] {
    if (!canEarn()) return []
    const cookingId = cooking.getActiveOrder()?.ticketId ?? null
    return [...economyHud.getDeliveryTickets(cookingId), ...customers.getQueuedTickets()]
  }

  function recordCookReason(reason: string | null): void {
    lastCookReason = reason
    if (reason) hudRoot.dataset.lastCookReason = reason
    else delete hudRoot.dataset.lastCookReason
  }

  function getStorefrontTarget(): { x: number; z: number; yaw: number } {
    const siteExtra = TIANYUAN_SITE as unknown as {
      teleportPos?: readonly [number, number, number]
      triggerPos?: readonly [number, number, number]
    }
    const candidate = siteExtra.teleportPos ?? siteExtra.triggerPos
    if (candidate && !isLocalPoint(candidate)) {
      return { x: candidate[0], z: candidate[2], yaw: shop.group.rotation.y }
    }
    const entLocal = coords.toLocalPoint(coords.toWorldPoint(shop.entrance, new THREE.Vector3()), new THREE.Vector3())
    const frontWorld = coords.localToWorld(entLocal.x, 0, entLocal.z + 3.2, new THREE.Vector3())
    return { x: frontWorld.x, z: frontWorld.z, yaw: shop.group.rotation.y }
  }

  let indoorAutoFirstPerson = false
  let lastPlayerZone: 'outside' | 'front' | 'kitchen' = 'outside'

  function syncIndoorCameraMode(zone: 'outside' | 'front' | 'kitchen'): void {
    const inside = zone === 'front' || zone === 'kitchen'
    document.body.dataset.mifenIndoor = inside ? '1' : '0'
    if (inside && lastPlayerZone === 'outside') {
      if (!isFirstPerson()) {
        indoorAutoFirstPerson = true
        setViewMode('first')
      }
    } else if (!inside && lastPlayerZone !== 'outside') {
      if (indoorAutoFirstPerson) {
        indoorAutoFirstPerson = false
        setViewMode('third')
      }
    }
    lastPlayerZone = zone
  }

  async function teleportToShop(): Promise<boolean> {
    if (indoorAutoFirstPerson) {
      indoorAutoFirstPerson = false
      setViewMode('third')
    }
    lastPlayerZone = 'outside'
    const target = getStorefrontTarget()
    const ok = await ctx.walkTo(target.x, target.z, target.yaw, 'tianyuan-mifen', '三多路田源米粉店')
    if (ok) {
      renderHud()
      updatePromptUi()
    }
    return ok
  }

  async function walkInside(zone: 'front' | 'kitchen' | 'outside'): Promise<boolean> {
    if (zone === 'outside') {
      return teleportToShop()
    }
    if (!isFirstPerson()) {
      indoorAutoFirstPerson = true
      setViewMode('first')
    }
    const entLocal = coords.toLocalPoint(coords.toWorldPoint(shop.entrance, new THREE.Vector3()), new THREE.Vector3())
    const toppingsLocal = coords.toLocalPoint(
      coords.toWorldPoint(shop.stations.toppings, new THREE.Vector3()),
      new THREE.Vector3(),
    )
    const kitchenLocal = coords.toLocalPoint(
      coords.toWorldPoint(shop.kitchenEntry, new THREE.Vector3()),
      new THREE.Vector3(),
    )
    const boilLocal = coords.toLocalPoint(
      coords.toWorldPoint(shop.stations.boil, new THREE.Vector3()),
      new THREE.Vector3(),
    )

    if (zone === 'front') {
      const lx = entLocal.x + 0.2
      const lz = entLocal.z - 0.85
      const w = coords.localToWorld(lx, 0, lz, new THREE.Vector3())
      const tW = coords.localToWorld(toppingsLocal.x, 0, toppingsLocal.z - 0.6, new THREE.Vector3())
      const lookYaw = Math.atan2(w.x - tW.x, w.z - tW.z)
      lastPlayerZone = 'front'
      return ctx.walkTo(w.x, w.z, lookYaw, 'mifen-front', '田源米粉 · 前厅')
    }

    const lx = kitchenLocal.x + 0.15
    const lz = kitchenLocal.z - 1.15
    const w = coords.localToWorld(lx, 0, lz, new THREE.Vector3())
    const bW = coords.localToWorld(boilLocal.x, 0, boilLocal.z, new THREE.Vector3())
    const lookYaw = Math.atan2(w.x - bW.x, w.z - bW.z)
    lastPlayerZone = 'kitchen'
    return ctx.walkTo(w.x, w.z, lookYaw, 'mifen-kitchen', '田源米粉 · 后厨')
  }

  async function walkToStation(station: StationKey): Promise<boolean> {
    if (!isFirstPerson()) {
      indoorAutoFirstPerson = true
      setViewMode('first')
    }
    const stLocal = coords.toLocalPoint(coords.toWorldPoint(shop.stations[station], new THREE.Vector3()), new THREE.Vector3())
    let lx = stLocal.x
    let lz = stLocal.z
    let lookX = stLocal.x
    let lookZ = stLocal.z

    if (station === 'boil') {
      lx = stLocal.x - 0.15
      lookX = stLocal.x + 0.9
    } else if (station === 'meat') {
      lx = stLocal.x + 0.15
      lookX = stLocal.x - 0.9
    } else if (station === 'counter' || station === 'broth') {
      lx = stLocal.x - 0.1
      lz = stLocal.z
      lookX = stLocal.x
      lookZ = stLocal.z + 1.0
    } else if (station === 'toppings') {
      lx = stLocal.x + 0.55
      lookX = stLocal.x - 0.75
    } else if (station === 'upgrade') {
      lz = stLocal.z + 0.75
      lookZ = stLocal.z - 0.6
    }

    const w = coords.localToWorld(lx, 0, lz, new THREE.Vector3())
    const targetW = coords.localToWorld(lookX, 0, lookZ, new THREE.Vector3())
    const lookYaw = Math.atan2(w.x - targetW.x, w.z - targetW.z)
    lastPlayerZone = lz <= 0.15 ? 'kitchen' : 'front'
    return ctx.walkTo(w.x, w.z, lookYaw, `mifen-station-${station}`, `田源米粉 · ${STATION_ACTION[station]}`)
  }

  function isStationInReach(key: StationKey): { ok: boolean; distance: number } {
    const pos = ctx.getPlayerPos()
    if (!pos) return { ok: false, distance: Infinity }
    const pt = shop.stations[key]
    if (!pt) return { ok: false, distance: Infinity }
    const w = coords.toWorldPoint(pt, new THREE.Vector3())
    const dist = Math.hypot(pos.x - w.x, pos.z - w.z)
    if (dist > STATION_REACH_RADIUS[key]) return { ok: false, distance: Math.round(dist * 100) / 100 }

    // 隔墙防穿透：按工位与玩家实际局部 Z 判断是否同在后厨或前厅，绝不隔出餐隔墙触发
    const pLocal = coords.toLocalPoint(pos, new THREE.Vector3())
    const stLocal = coords.toLocalPoint(w, new THREE.Vector3())
    const playerInKitchen = pLocal.z <= 0.15
    const stationInKitchen = stLocal.z <= 0.15
    if (playerInKitchen !== stationInKitchen) {
      return { ok: false, distance: Math.round(dist * 100) / 100 }
    }
    return { ok: true, distance: Math.round(dist * 100) / 100 }
  }

  function startCookingTicket(
    ticketId?: string,
    station: CookingStation = 'boil',
  ): {
    ok: boolean
    ticketId?: string
    recipeName?: string
    stage?: CookingStage
    requiredStation?: CookingStation | null
    reason?: string
  } {
    const reach = isStationInReach(station)
    if (!reach.ok) {
      audio.play('action_reject')
      notify(`请走到${COOKING_STATION_LABELS[station]}`)
      recordCookReason('TOO_FAR_FROM_STATION')
      return {
        ok: false,
        stage: cooking.getStage(),
        requiredStation: cooking.getRequiredStation() ?? station,
        reason: 'TOO_FAR_FROM_STATION',
      }
    }
    if (!isStoryUnlocked()) {
      audio.play('action_reject')
      notify('先找门前表叔接班')
      recordCookReason('STORY_LOCKED')
      return {
        ok: false,
        stage: cooking.getStage(),
        requiredStation: null,
        reason: 'STORY_LOCKED',
      }
    }
    if (!isInsideShop()) {
      audio.play('action_reject')
      notify('请先走进店内')
      recordCookReason('OUTSIDE_SHOP')
      return {
        ok: false,
        stage: cooking.getStage(),
        requiredStation: null,
        reason: 'OUTSIDE_SHOP',
      }
    }
    if (cooking.hasActiveOrder()) {
      audio.play('action_reject')
      recordCookReason('ORDER_IN_PROGRESS')
      return {
        ok: false,
        stage: cooking.getStage(),
        requiredStation: cooking.getRequiredStation(),
        reason: 'ORDER_IN_PROGRESS',
      }
    }
    let tickets = getRailTickets()
    if (!tickets.length) {
      const spawned = customers.spawnCustomerNow(true)
      tickets = getRailTickets()
      if (!spawned && !tickets.length) {
        audio.play('action_reject')
        recordCookReason('NO_QUEUED_CUSTOMERS')
        return { ok: false, stage: cooking.getStage(), requiredStation: null, reason: 'NO_QUEUED_CUSTOMERS' }
      }
    }
    const chosen = ticketId ? tickets.find(t => t.id === ticketId) ?? tickets[0] : tickets[0]
    if (!chosen) {
      audio.play('action_reject')
      recordCookReason('TICKET_NOT_FOUND')
      return { ok: false, stage: cooking.getStage(), requiredStation: null, reason: 'TICKET_NOT_FOUND' }
    }

    const startRes = cooking.startOrder(
      {
        ticketId: chosen.id,
        customerName: chosen.customerName,
        archetype: chosen.archetype,
        recipe: chosen.recipe,
      },
      station,
    )
    if (!startRes.ok) {
      audio.play('action_reject')
      recordCookReason(startRes.reason ?? 'START_FAILED')
      return {
        ok: false,
        stage: startRes.stage,
        requiredStation: startRes.requiredStation,
        reason: startRes.reason,
      }
    }

    recordCookReason(null)
    upgrade.close()
    economyHud.close()
    renderHud()
    updatePromptUi()
    return {
      ok: true,
      ticketId: chosen.id,
      recipeName: chosen.recipe.name,
      stage: startRes.stage,
      requiredStation: startRes.requiredStation,
    }
  }

  function notifyRequiredStation(required: CookingStation | null, fallbackLabel?: string): void {
    if (required) {
      notify(`请前往${COOKING_STATION_LABELS[required]}`)
    } else if (fallbackLabel) {
      notify(fallbackLabel)
    }
  }

  function interactStation(key: StationKey): StationInteractResult {
    if (key === 'upgrade') {
      if (!canEarn()) {
        const reason = !isStoryUnlocked() ? 'STORY_LOCKED' : 'OUTSIDE_SHOP'
        audio.play('action_reject')
        notify(!isStoryUnlocked() ? '先找门前表叔接班' : '请先走进店内')
        return {
          ok: false,
          station: key,
          stage: cooking.getStage(),
          requiredStation: cooking.getRequiredStation(),
          reason,
        }
      }
      economyHud.close()
      upgrade.toggle()
      renderHud()
      return {
        ok: true,
        station: key,
        stage: cooking.getStage(),
        requiredStation: cooking.getRequiredStation(),
      }
    }
    if (key === 'toppings') {
      audio.play('condiment_add')
      notify(
        (recipesData.condiments ?? []).map(c => c.name).join('、') ||
          '葱花、招牌腌青椒、酸豆角、萝卜丝、泡椒、油辣椒、酸笋',
      )
      return {
        ok: true,
        station: key,
        stage: cooking.getStage(),
        requiredStation: cooking.getRequiredStation(),
      }
    }
    if (key === 'pickup') {
      audio.play('action_reject')
      const req = cooking.getRequiredStation()
      notifyRequiredStation(req, '请到煮锅台接单')
      return {
        ok: false,
        station: key,
        stage: cooking.getStage(),
        requiredStation: req ?? 'boil',
        reason: 'PICKUP_STATION_NO_NEW_ORDER',
      }
    }

    const mapped: CookingStation = key === 'boil' ? 'boil' : key === 'meat' ? 'meat' : 'counter'
    const reach = isStationInReach(key)
    if (!reach.ok) {
      audio.play('action_reject')
      notify(`请走到${COOKING_STATION_LABELS[mapped]}`)
      recordCookReason('TOO_FAR_FROM_STATION')
      return {
        ok: false,
        station: key,
        stage: cooking.getStage(),
        requiredStation: cooking.getRequiredStation() ?? 'boil',
        reason: 'TOO_FAR_FROM_STATION',
        distance: reach.distance,
      }
    }

    if (!isStoryUnlocked()) {
      audio.play('action_reject')
      notify('先找门前表叔接班')
      recordCookReason('STORY_LOCKED')
      return {
        ok: false,
        station: key,
        stage: cooking.getStage(),
        requiredStation: null,
        reason: 'STORY_LOCKED',
        distance: reach.distance,
      }
    }

    if (!isInsideShop()) {
      audio.play('action_reject')
      notify('请先走进店内')
      recordCookReason('OUTSIDE_SHOP')
      return {
        ok: false,
        station: key,
        stage: cooking.getStage(),
        requiredStation: null,
        reason: 'OUTSIDE_SHOP',
        distance: reach.distance,
      }
    }

    if (key === 'boil') {
      if (!cooking.hasActiveOrder()) {
        const started = startCookingTicket(undefined, 'boil')
        if (!started.ok && started.reason === 'NO_QUEUED_CUSTOMERS') notify('满座')
        return {
          ok: started.ok,
          station: key,
          stage: started.stage ?? cooking.getStage(),
          requiredStation: started.requiredStation ?? cooking.getRequiredStation(),
          reason: started.reason,
          ticketId: started.ticketId,
          recipeName: started.recipeName,
          distance: reach.distance,
        }
      }
      const res = cooking.openAtStation('boil')
      if (!res.ok) {
        audio.play('action_reject')
        notifyRequiredStation(res.requiredStation)
        return {
          ok: false,
          station: key,
          stage: res.stage,
          requiredStation: res.requiredStation,
          reason: res.reason,
          distance: reach.distance,
        }
      }
      upgrade.close()
      economyHud.close()
      renderHud()
      updatePromptUi()
      return {
        ok: true,
        station: key,
        stage: res.stage,
        requiredStation: res.requiredStation,
        distance: reach.distance,
      }
    }

    const res = cooking.openAtStation(mapped)
    if (!res.ok) {
      audio.play('action_reject')
      notifyRequiredStation(res.requiredStation)
      return {
        ok: false,
        station: key,
        stage: res.stage,
        requiredStation: res.requiredStation,
        reason: res.reason,
        distance: reach.distance,
      }
    }
    upgrade.close()
    economyHud.close()
    renderHud()
    updatePromptUi()
    return {
      ok: true,
      station: key,
      stage: res.stage,
      requiredStation: res.requiredStation,
      distance: reach.distance,
    }
  }

  function triggerStationAction(key: StationKey): void {
    interactStation(key)
  }

  function cookNext(): void {
    if (cooking.hasActiveOrder()) {
      const req = cooking.getRequiredStation()
      if (
        nearestStation &&
        ((req === 'boil' && nearestStation === 'boil') ||
          (req === 'meat' && nearestStation === 'meat') ||
          (req === 'counter' && (nearestStation === 'counter' || nearestStation === 'broth')))
      ) {
        interactStation(nearestStation)
        return
      }
      audio.play('action_reject')
      recordCookReason('TOO_FAR_FROM_STATION')
      notifyRequiredStation(req)
      return
    }
    const res = startCookingTicket(undefined, 'boil')
    if (!res.ok && res.reason === 'NO_QUEUED_CUSTOMERS') notify('满座')
  }

  function findNearestStation(pos: THREE.Vector3 | null): StationKey | null {
    if (!pos) return null
    const pLocal = coords.toLocalPoint(pos, new THREE.Vector3())
    const playerInKitchen = pLocal.z <= 0.15
    let bestKey: StationKey | null = null
    let bestDist = Infinity
    const tmp = new THREE.Vector3()
    const stLocalTmp = new THREE.Vector3()
    for (const key of ALL_STATION_KEYS) {
      const pt = shop.stations[key]
      if (!pt) continue
      const w = coords.toWorldPoint(pt, tmp)
      coords.toLocalPoint(w, stLocalTmp)
      if ((stLocalTmp.z <= 0.15) !== playerInKitchen) continue
      const d = Math.hypot(pos.x - w.x, pos.z - w.z)
      if (d <= STATION_REACH_RADIUS[key] && d < bestDist) {
        bestDist = d
        bestKey = key
      }
    }
    return bestKey
  }

  function paintTicket(btn: HTMLButtonElement, t: RailTicket): void {
    const [titleEl, priceEl, metaEl, stateEl, patienceEl] = Array.from(btn.children) as HTMLElement[]
    const title = formatRecipeTitle(t.recipe)
    const price = `¥${formatMoney(t.price ?? t.recipe.price)}`
    const meatList = t.recipe.requiredMeats.map(m => MEAT_LABELS[m] ?? m).join(' · ') || '素粉'
    const meats = economyHud.isDeliveryTicket(t.id) ? `外卖 · ${meatList}` : meatList
    const urgent = !t.beingCooked && t.patienceRatio < 0.25
    setText(titleEl, title)
    setText(priceEl, price)
    setText(metaEl, meats)
    setText(stateEl, t.beingCooked ? '制作中' : urgent ? `${t.patienceSecLeft}s` : '')
    patienceEl.style.setProperty('--p', t.patienceRatio.toFixed(3))
    btn.classList.toggle('is-urgent', urgent)
    if (t.beingCooked) btn.setAttribute('aria-current', 'true')
    else btn.removeAttribute('aria-current')
    btn.dataset.patienceSec = String(t.patienceSecLeft)
    btn.setAttribute(
      'aria-label',
      `${title}，${price}，${meats}，${t.beingCooked ? '制作中' : `剩 ${t.patienceSecLeft} 秒`}`,
    )
  }

  function renderTickets(tickets: RailTicket[]): void {
    const shown = tickets.slice(0, MAX_TICKETS)
    const shownIds = new Set(shown.map(t => t.id))
    for (const [id, li] of ticketEls) {
      if (shownIds.has(id)) continue
      li.remove()
      ticketEls.delete(id)
    }
    shown.forEach((t, i) => {
      let li = ticketEls.get(t.id)
      if (!li) {
        li = document.createElement('li')
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'mifen-ticket'
        btn.dataset.cookTicket = t.id
        btn.innerHTML =
          '<span class="mifen-ticket-title"></span><span class="mifen-ticket-price"></span>' +
          '<span class="mifen-ticket-meta"></span><span class="mifen-ticket-state"></span>' +
          '<span class="mifen-ticket-patience" aria-hidden="true"></span>'
        li.append(btn)
        ticketEls.set(t.id, li)
      }
      if (ticketRailEl.children[i] !== li) ticketRailEl.insertBefore(li, ticketRailEl.children[i] ?? null)
      paintTicket(li.firstElementChild as HTMLButtonElement, t)
    })
    const extra = tickets.length - shown.length
    moreTicketsEl.hidden = extra <= 0
    setText(moreTicketsEl, `还有 ${extra} 张`)
    if (ticketRailEl.lastElementChild !== moreTicketsEl) ticketRailEl.append(moreTicketsEl)
  }

  function syncHudLayoutMetrics(): void {
    const drawerOpen = upgrade.isOpen() || economyHud.getOpenPanel() !== null
    document.body.dataset.mifenCooking = cooking.isOpen() ? '1' : '0'
    document.body.dataset.mifenDrawer = drawerOpen ? '1' : '0'
    document.body.dataset.mifenNear = nearShop || isOverlayOpen() ? '1' : '0'
    document.body.dataset.mifenStoryActive = director.isActive() ? '1' : '0'
    if (!statusBarEl.hidden) {
      const rect = statusBarEl.getBoundingClientRect()
      if (rect.height > 0) {
        hudRoot.style.setProperty('--mf-bar-bottom', `${Math.ceil(rect.bottom)}px`)
      }
    }
  }

  function renderHud(): void {
    const earning = canEarn()
    const storyActive = director.isActive()
    if (!earning) {
      if (upgrade.isOpen()) upgrade.close()
      if (economyHud.getOpenPanel() !== null) economyHud.close()
      if (cooking.isOpen()) cooking.dismissPanel()
    }

    const cookingOpen = cooking.isOpen()
    const upgradeOpen = upgrade.isOpen()
    const showBar = earning && !storyActive
    const tickets = showBar ? getRailTickets() : []
    tpBtn.hidden = nearShop || storyActive || isOverlayOpen()
    statusBarEl.hidden = !showBar
    ticketRailEl.hidden = !showBar || tickets.length === 0
    if (!showBar) {
      renderTickets([])
      syncHudLayoutMetrics()
      return
    }

    const state = store.getState()
    const reqStation = cooking.getRequiredStation()
    setText(fundsEl, `¥${formatMoney(state.funds)}`)
    setText(ratingEl, `★${state.reputation.toFixed(2)}`)
    cookBtn.hidden = cookingOpen
    if (!cookingOpen) {
      if (reqStation === 'meat') setText(cookBtn, '去肉台')
      else if (reqStation === 'counter') setText(cookBtn, '去前台')
      else if (reqStation === 'boil') setText(cookBtn, '回煮锅')
      else setText(cookBtn, '做粉')
    }
    const ready = upgrade.canAffordAny()
    upgradeBtn.toggleAttribute('data-ready', ready)
    upgradeBtn.setAttribute('aria-label', ready ? '扩店，有买得起的项目' : '扩店')
    upgradeBtn.setAttribute('aria-expanded', String(upgradeOpen))
    economyHud.syncBar(statusBarEl)
    renderTickets(tickets)
    syncHudLayoutMetrics()
  }

  function updatePromptUi(): void {
    if (director.isActive() || isOverlayOpen()) {
      promptBtn.hidden = true
      delete promptBtn.dataset.storyInteract
      return
    }
    if (nearUncle && director.canTalk()) {
      promptBtn.hidden = false
      promptBtn.dataset.storyInteract = '1'
      setText(promptLabelEl, '找表叔聊聊')
      return
    }
    delete promptBtn.dataset.storyInteract
    if (!nearShop || !nearestStation) {
      promptBtn.hidden = true
      return
    }
    promptBtn.hidden = false
    if (!isStoryUnlocked() && nearestStation !== 'toppings') {
      setText(promptLabelEl, '先找表叔聊聊')
      return
    }
    const reqStation = cooking.getRequiredStation()
    if (nearestStation === 'boil' && reqStation && reqStation !== 'boil') {
      setText(promptLabelEl, `前往${COOKING_STATION_LABELS[reqStation]}`)
    } else if (nearestStation === 'meat' && reqStation !== 'meat') {
      setText(promptLabelEl, reqStation ? `前往${COOKING_STATION_LABELS[reqStation]}` : '先去煮锅台')
    } else if ((nearestStation === 'counter' || nearestStation === 'broth') && reqStation !== 'counter') {
      setText(promptLabelEl, reqStation ? `前往${COOKING_STATION_LABELS[reqStation]}` : '先去煮锅台')
    } else {
      setText(promptLabelEl, STATION_ACTION[nearestStation])
    }
  }

  tpBtn.addEventListener('click', () => {
    void teleportToShop()
  })

  statusBarEl.addEventListener('click', e => {
    const action = (e.target as Element).closest<HTMLElement>('[data-hud-action]')?.dataset.hudAction
    if (action === 'cook-next') cookNext()
    else if (action === 'open-upgrade') {
      if (!canEarn()) {
        audio.play('action_reject')
        notify(!isStoryUnlocked() ? '先找门前表叔接班' : '请先走进店内')
        return
      }
      economyHud.close()
      upgrade.toggle()
      renderHud()
    } else {
      const slot = ECONOMY_UI_SLOTS.actions.find(s => s.hudAction === action)
      if (slot) {
        if (!canEarn()) {
          audio.play('action_reject')
          notify(!isStoryUnlocked() ? '先找门前表叔接班' : '请先走进店内')
          return
        }
        upgrade.close()
        economyHud.toggle(slot.id)
      }
    }
  })

  ticketRailEl.addEventListener('click', e => {
    const id = (e.target as Element).closest<HTMLElement>('[data-cook-ticket]')?.dataset.cookTicket
    if (!id) return
    const res = startCookingTicket(id, 'boil')
    if (!res.ok && res.reason === 'ORDER_IN_PROGRESS') {
      notifyRequiredStation(res.requiredStation ?? cooking.getRequiredStation())
    }
  })

  promptBtn.addEventListener('click', () => {
    if (nearUncle && director.canTalk() && !director.isActive() && !isOverlayOpen()) {
      director.talk()
      renderHud()
      updatePromptUi()
      return
    }
    if (nearestStation) triggerStationAction(nearestStation)
  })

  function onGlobalKeyDown(e: KeyboardEvent): void {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    if (isInputFocused(e.target)) return
    if (document.body.hasAttribute('data-home')) return
    if (director.isActive()) return

    if (e.code === 'KeyN' && !isOverlayOpen()) {
      e.preventDefault()
      void teleportToShop()
      return
    }

    if (e.code === 'KeyE' && !isOverlayOpen()) {
      if (nearUncle && director.canTalk()) {
        e.preventDefault()
        director.talk()
        renderHud()
        updatePromptUi()
        return
      }
      if (nearShop && nearestStation) {
        e.preventDefault()
        triggerStationAction(nearestStation)
      }
    }
  }

  const onWindowResize = (): void => {
    syncHudLayoutMetrics()
  }
  const barResizeObserver =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          syncHudLayoutMetrics()
        })
      : null
  barResizeObserver?.observe(statusBarEl)
  window.addEventListener('keydown', onGlobalKeyDown)
  window.addEventListener('resize', onWindowResize)
  const unsubscribeStore = store.subscribe(() => renderHud())

  renderHud()
  updatePromptUi()

  const controller: MifenController = {
    step(dt) {
      const safeDt = Math.min(0.1, Math.max(0, dt))
      elapsedTime += safeDt

      if (!groundAligned && ctx.sampleGroundY) {
        const [sx, sy, sz] = TIANYUAN_SITE.position
        const gy = ctx.sampleGroundY(sx, sz)
        if (typeof gy === 'number' && Number.isFinite(gy) && Math.abs(gy - sy) <= 10) {
          groundAligned = true
          shop.group.position.y = gy
          shop.group.updateMatrixWorld(true)
          placeUncleNpc()
        }
      }

      const playerPos = ctx.getPlayerPos()
      const refPos = playerPos ?? ctx.camera.position
      const shopCenter = shop.group.position
      lastPlayerDistance = Math.hypot(refPos.x - shopCenter.x, refPos.z - shopCenter.z)
      const nextNear = lastPlayerDistance < 24
      const uncleDist = playerPos
        ? Math.hypot(playerPos.x - uncleWorldPos.x, playerPos.z - uncleWorldPos.z)
        : Infinity
      const nextNearUncle = uncleDist <= UNCLE_INTERACT_RADIUS

      if (playerPos && nextNear) {
        syncIndoorCameraMode(detectPlayerZone(playerPos))
      } else if (!nextNear && lastPlayerZone !== 'outside') {
        syncIndoorCameraMode('outside')
      }
      const nextStation = nextNear ? findNearestStation(playerPos) : null
      const nearChanged = nextNear !== nearShop
      const uncleChanged = nextNearUncle !== nearUncle
      const stationChanged = nextStation !== nearestStation
      nearShop = nextNear
      nearUncle = nextNearUncle
      nearestStation = nextStation
      syncHudLayoutMetrics()

      cooking.step(safeDt)
      const cookingVisual = cooking.getVisualState()
      audio.setListenerDistance(lastPlayerDistance)
      audio.syncCooking(cookingVisual, safeDt)

      const mappedStage: 'idle' | 'boil' | 'meat' | 'broth' | 'done' =
        cookingVisual.stage === 'boil'
          ? 'boil'
          : cookingVisual.stage === 'carry_to_meat' || cookingVisual.stage === 'meat'
            ? 'meat'
            : cookingVisual.stage === 'carry_to_counter' || cookingVisual.stage === 'counter'
              ? 'broth'
              : cookingVisual.stage === 'serving'
                ? 'done'
                : 'idle'
      const stepProgress =
        cookingVisual.stage === 'boil'
          ? cookingVisual.boil.drainProgress > 0
            ? 0.6 + cookingVisual.boil.drainProgress * 0.4
            : cookingVisual.boil.progress * 0.6
          : cookingVisual.stage === 'meat'
            ? cookingVisual.meat.progress
            : cookingVisual.stage === 'counter'
              ? cookingVisual.counter.brineLevel
              : cookingVisual.stage === 'serving'
                ? 1
                : 0
      const holdingStage: 'none' | 'boiled' | 'meated' | 'brined' =
        cookingVisual.stage === 'carry_to_meat'
          ? 'boiled'
          : cookingVisual.stage === 'carry_to_counter'
            ? 'meated'
            : cookingVisual.stage === 'serving'
              ? 'brined'
              : 'none'

      const night = ctx.getNightFactor()
      shop.updateVisuals(safeDt, {
        night,
        boiling: cooking.isBoiling(),
        queueCount: customers.getQueueCount(),
        time: elapsedTime,
        cooking: cookingVisual,
        cookingStage: mappedStage,
        stepProgress,
        activeMeats: cookingVisual.bowl.meats,
        holdingStage,
      })

      uncle.step(safeDt, elapsedTime, night, playerPos)
      economyHud.step(safeDt, cooking.getActiveOrder()?.ticketId ?? null)
      customers.step(safeDt, nearShop, ctx.camera.position)

      hudRefreshTimer += safeDt
      if (nearChanged || uncleChanged || stationChanged || hudRefreshTimer >= 0.45) {
        hudRefreshTimer = 0
        renderHud()
        updatePromptUi()
      }

      // 剧情导演步进放在 step 末尾，确保对话镜位在 draw() 前生效
      director.step(safeDt)
    },

    teleportToShop,

    getProbe() {
      const probe: MifenDebugProbe = {
        get cookingVisual() {
          return cooking.getVisualState()
        },
        get requiredStation() {
          return cooking.getRequiredStation()
        },
        get cookingStage() {
          return cooking.getStage()
        },
        get story() {
          return getStoryStateSnapshot()
        },
        audio: {
          getStats: () => audio.getStats(),
          setMuted: muted => audio.setMuted(muted),
          isMuted: () => audio.isMuted(),
          play: id => audio.play(id),
        },
        getState() {
          const stationWorldPositions = {} as Record<StationKey, [number, number, number]>
          for (const key of ALL_STATION_KEYS) {
            const w = coords.toWorldPoint(shop.stations[key], new THREE.Vector3())
            stationWorldPositions[key] = [
              Math.round(w.x * 100) / 100,
              Math.round(w.y * 100) / 100,
              Math.round(w.z * 100) / 100,
            ]
          }
          const visual = cooking.getVisualState()
          const playerZone = detectPlayerZone(ctx.getPlayerPos())
          const insideShop = playerZone !== 'outside'
          const story = getStoryStateSnapshot()
          return {
            save: store.getState(),
            shopLevel: store.getState().shopLevel,
            nearShop,
            insideShop,
            canEarn: story.unlocked && insideShop,
            storyUnlocked: story.unlocked,
            story,
            audio: audio.getStats(),
            lastCookReason,
            playerDistance: Math.round(lastPlayerDistance * 100) / 100,
            playerZone,
            nearestStation,
            queueCount: customers.getQueueCount(),
            activeCustomers: customers.getActiveCount(),
            seatedCount: customers.getSeatedCount(),
            cookingOpen: cooking.isOpen(),
            cookingStep: cooking.getCurrentStep(),
            cookingStage: visual.stage,
            requiredStation: visual.requiredStation,
            cookingVisual: visual,
            upgradeOpen: upgrade.isOpen(),
            economyPanel: economyHud.getOpenPanel(),
            economy: economy.getDashboardSnapshot(ctx.clock.hour),
            seatCount: shop.seats.length,
            site: TIANYUAN_SITE,
            stationWorldPositions,
          }
        },
        isStoryUnlocked,
        getStoryState: getStoryStateSnapshot,
        getAudioStats: () => audio.getStats(),
        resetStory() {
          director.reset()
          uncle.setMarker('new')
          customers.clearAll()
          cooking.cancel()
          upgrade.close()
          economyHud.close()
          renderHud()
          updatePromptUi()
          return getStoryStateSnapshot()
        },
        teleportToShop,
        walkInside,
        walkToStation,
        interactStation,
        getCookingVisualState() {
          return cooking.getVisualState()
        },
        spawnCustomerNow() {
          const spawned = customers.spawnCustomerNow(true)
          renderHud()
          return spawned
        },
        startCookingNext(station?: CookingStation) {
          return startCookingTicket(undefined, station ?? 'boil')
        },
        setHour(hour) {
          ctx.clock.set(hour)
          return ctx.clock.hour
        },
        openUpgrade() {
          if (!canEarn()) {
            audio.play('action_reject')
            return
          }
          economyHud.close()
          upgrade.open()
          renderHud()
        },
        closeUpgrade() {
          upgrade.close()
          renderHud()
        },
        openEconomyPanel(key) {
          if (!canEarn()) {
            audio.play('action_reject')
            return
          }
          upgrade.close()
          economyHud.open(key)
          renderHud()
        },
        closeEconomyPanel() {
          economyHud.close()
          renderHud()
        },
        resetSave() {
          const reset = store.reset()
          rebuildShop(reset.shopLevel)
          return reset
        },
        getBubbleMetrics() {
          return customers.getBubbleMetrics(ctx.camera.position)
        },
      }
      if (import.meta.env.DEV) {
        probe.completeActiveOrderPerfect = () => {
          if (!canEarn()) {
            return { ok: false, reason: !isStoryUnlocked() ? 'STORY_LOCKED' : 'OUTSIDE_SHOP' }
          }
          if (!cooking.hasActiveOrder()) {
            const started = startCookingTicket(undefined, 'boil')
            if (!started.ok) return { ok: false, reason: started.reason ?? 'NO_ACTIVE_ORDER' }
          }
          const completed = cooking.completeActivePerfect()
          if (!completed) return { ok: false, reason: 'COMPLETE_FAILED' }
          return {
            ok: true,
            stars: completed.stars,
            revenue: completed.basePrice,
            tip: completed.tip,
          }
        }
        probe.grantFunds = (n: number) => {
          const next = store.grantFunds(n)
          renderHud()
          return next
        }
        probe.setShopLevel = (lvl: ShopLevel) => {
          const applied = store.setShopLevel(lvl)
          rebuildShop(applied)
          return applied
        }
      }
      return probe
    },

    dispose() {
      barResizeObserver?.disconnect()
      window.removeEventListener('keydown', onGlobalKeyDown)
      window.removeEventListener('resize', onWindowResize)
      window.removeEventListener(RIDE_SOUND_EVENT, onRideSoundEvent)
      unsubscribeStore()
      director.dispose()
      uncle.dispose()
      audio.dispose()
      cooking.dispose()
      upgrade.dispose()
      economyHud.dispose()
      economy.events.clear()
      customers.dispose()
      shop.group.removeFromParent()
      shop.dispose()
      hudRoot.remove()
      delete document.body.dataset.mifenCooking
      delete document.body.dataset.mifenDrawer
      delete document.body.dataset.mifenNear
      delete document.body.dataset.mifenIndoor
      delete document.body.dataset.mifenStoryActive
    },
  }

  return controller
}
