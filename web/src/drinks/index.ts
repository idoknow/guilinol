import * as THREE from 'three'
import type { Walker } from '../play/host.ts'
import { mainDetail } from '../look/mirror-layer.ts'
import { isGlobalHotkeyBlocked, isModalOrOverlayOpen } from '../walk/input-guard.ts'
import { createDrinksAudio, type DrinksAudioController, type DrinksAudioStats } from './audio/index.ts'
import {
  createDrinkHoldVisual,
  DrinkHoldSession,
  mountDrinkHoldHud,
  type DrinkHoldHudController,
  type DrinkHoldSnapshot,
  type DrinkHoldStartResult,
  type DrinkHoldVisualAdapter,
  type DrinkSipResult,
} from './hold/hold-controller.ts'
import type { DrinkWalletBackend } from './hold/payment-core.ts'
import { DEFAULT_DRINKS_SKIN, DRINKS_MENU, type DrinksShopSkinConfig } from './menu/menu.ts'
import { createDrinksNpcRenderer, type DrinksNpcMetrics, type DrinksNpcRenderer } from './npc/index.ts'
import {
  buildDrinksShopMesh,
  DRINKS_SHOP_DOORWAY,
  DRINKS_SHOP_INTERIOR,
  type DrinksShopBuildResult,
  type DrinksShopMetrics,
} from './shop/index.ts'
import {
  createDrinksSim,
  MAX_CONCURRENT_CUSTOMERS,
  type CollectPlayerOrderResult,
  type DrinksSim,
  type DrinksSimMetrics,
  type OrderSnapshot,
} from './sim/index.ts'
import {
  DEFAULT_DRINKS_SITE_ID,
  DRINKS_SITE_CANDIDATES,
  resolveDrinksSite,
  resolveDrinksSiteId,
  shopLocalToWorld,
  shouldMountDrinksShop,
  SITE,
  worldToShopLocal,
  type DrinksSiteCandidate,
  type DrinksSiteId,
} from './site.ts'
import { fitDrinksPlot, type FitDrinksPlotResult } from './terrain/index.ts'
import {
  createDrinksStaffController,
  type DrinksStaffController,
  type DrinksStaffStateSnapshot,
} from './staff/index.ts'
import {
  computeDistanceXZ,
  createDrinksIndoorViewController,
  createDrinksLodController,
  DEFAULT_DRINKS_LOD_CONFIG,
  mapSimEventToSound,
  resolveHeldDrinkPause,
  type DrinksIndoorViewController,
  type DrinksIndoorViewState,
  type DrinksLodConfig,
  type DrinksViewMode,
  type DrinksViewModeAdapter,
} from './integration/runtime.ts'
import { mountDrinksOrderPanel, type DrinksOrderPanelController } from './ui/order-panel.ts'
import { mountDrinksPickupHud, type DrinksPickupHudController } from './ui/pickup-hud.ts'

export {
  DEFAULT_DRINKS_SITE_ID,
  DRINKS_SITE_CANDIDATES,
  resolveDrinksSite,
  resolveDrinksSiteId,
  shopLocalToWorld,
  shouldMountDrinksShop,
  SITE,
  worldToShopLocal,
  type DrinksSiteCandidate,
  type DrinksSiteId,
} from './site.ts'

if (typeof document !== 'undefined' && typeof window !== 'undefined' && 'CSS' in globalThis) {
  void import('./ui/order-panel.css')
  void import('./hold/drink-action.css')
}

const CROWD_THINNING_KEY = 'crowdThinningZones'
const DRINKS_CROWD_ZONE_ID = 'drinks_shop'

interface CrowdThinningZoneLike {
  readonly x: number
  readonly z: number
  readonly outerRadius: number
  readonly innerRadius: number
  readonly maxInOuter: number
}

function updateSceneCrowdThinning(scene: THREE.Scene, zone: CrowdThinningZoneLike | null): void {
  const existing = scene.userData[CROWD_THINNING_KEY] as Map<string, CrowdThinningZoneLike> | undefined
  if (zone) {
    const map = existing ?? new Map<string, CrowdThinningZoneLike>()
    if (!existing) scene.userData[CROWD_THINNING_KEY] = map
    map.set(DRINKS_CROWD_ZONE_ID, zone)
  } else if (existing) {
    existing.delete(DRINKS_CROWD_ZONE_ID)
  }
}

function createMemoryViewModeAdapter(): DrinksViewModeAdapter {
  let mode: DrinksViewMode = 'third'
  return {
    isFirstPerson: () => mode === 'first',
    setViewMode(next: DrinksViewMode) {
      mode = next
    },
  }
}

export interface DrinksWalkerLike extends Walker {
  readonly vehicle?: 'foot' | 'bike' | 'bicycle' | 'car' | 'boat' | string
  readonly figure?: THREE.Object3D
}

export interface DrinksMountContext {
  scene: THREE.Scene
  camera: THREE.Camera
  getPlayerPos: () => THREE.Vector3 | null
  getWalker?: () => DrinksWalkerLike | null | undefined
  getHour?: () => number
  getNightFactor?: () => number
  sampleGroundY?: (x: number, z: number) => number
  walkTo?: (x: number, z: number, yaw: number, reason: string) => Promise<boolean>
  viewMode?: DrinksViewModeAdapter
  container?: HTMLElement | null
  siteId?: DrinksSiteId
  site?: DrinksSiteCandidate
  skin?: DrinksShopSkinConfig
  wallet?: DrinkWalletBackend
  lod?: DrinksLodConfig
  seed?: number | string
  open24h?: boolean
  clerkCount?: number
  maxCustomers?: number
  showNpcBadges?: boolean
}

export interface DrinksTerrainSummary {
  readonly plotY: number
  readonly fillHeightM: number
  readonly maxCornerGapM: number
  readonly maxSidewalkGapM: number
  readonly maxOuterSeamGapM: number
}

export interface DrinksProbeState {
  site: DrinksSiteCandidate
  disposed: boolean
  visualActive: boolean
  nearInteract: boolean
  insideShop: boolean
  viewMode: DrinksViewMode
  isFirstPerson: boolean
  indoorView: DrinksIndoorViewState
  distanceM: number
  groundY: number
  groundSnapped: boolean
  terrain: DrinksTerrainSummary
  simTimeSec: number
  hour: number
  phase: string
  isOpen: boolean
  metrics: DrinksSimMetrics
  activeOrdersCount: number
  playerOrders: OrderSnapshot[]
  npcMetrics: DrinksNpcMetrics
  shopMetrics: DrinksShopMetrics
  staff: DrinksStaffStateSnapshot
  hold: DrinkHoldSnapshot
  stowedForRide: boolean
  cupAttached: boolean
  orderPanelOpen: boolean
  pickupHudVisible: boolean
  holdHudVisible: boolean
  audioStats: DrinksAudioStats
}

export interface DrinksDebugProbe {
  readonly site: DrinksSiteCandidate
  readonly sim: DrinksSim
  readonly holdSession: DrinkHoldSession
  readonly staff: DrinksStaffController
  readonly terrain: FitDrinksPlotResult
  getState(): DrinksProbeState
  teleportToShop(): Promise<boolean>
  walkInside(): Promise<boolean>
  walkToRecruitSign(): Promise<boolean>
  interactRecruit(): boolean
  openOrder(drinkId?: string): boolean
  closeOrder(): void
  placeQuickOrder(drinkId?: string): Promise<boolean>
  collectReady(): CollectPlayerOrderResult | null
  startHoldSip(): DrinkHoldStartResult
  stopHoldSip(): boolean
  sip(): DrinkSipResult
  discard(): boolean
  fastForward(seconds: number): DrinksProbeState
}

export interface DrinksShopHandle {
  readonly site: DrinksSiteCandidate
  readonly sim: DrinksSim
  readonly shop: DrinksShopBuildResult
  readonly terrain: FitDrinksPlotResult
  readonly npc: DrinksNpcRenderer
  readonly staff: DrinksStaffController
  readonly indoorView: DrinksIndoorViewController
  readonly audio: DrinksAudioController
  readonly holdSession: DrinkHoldSession
  readonly orderPanel: DrinksOrderPanelController | null
  readonly pickupHud: DrinksPickupHudController | null
  readonly holdHud: DrinkHoldHudController | null
  step(dtSec: number): void
  fastForward(seconds: number): void
  isVisualActive(): boolean
  isDisposed(): boolean
  getProbe(): DrinksDebugProbe
  dispose(): void
}

function isPlayerOrderInSim(sim: DrinksSim, orderId: string | undefined): boolean {
  if (!orderId) return false
  return sim.getOrder(orderId)?.source === 'player'
}

function isCupAttachedToWalker(walker: DrinksWalkerLike | null | undefined): boolean {
  const anchor = walker?.handAnchor?.()
  if (!anchor) return false
  return anchor.children.some(child => child.name === 'drinks-held-cup')
}

/**
 * Mounts the Wangcheng Mixue Phase 2 flagship beverage shop into the host world:
 * - Fits plot plinth + apron slope (`fitDrinksPlot`) to eliminate terrain subsidence.
 * - Renders 1:1 Wangcheng storefront + enlarged interior (`buildDrinksShopMesh`, <=30 draw calls) on `MAIN_DETAIL_LAYER`.
 * - Thins nearby street crowd density and caps in-shop customers (<=8) & doorway queue (<=4).
 * - Automatically switches to first-person on stepping inside the doorway and restores prior view outside.
 * - Wires storefront recruit standee + full staff shift workflow/uniform/BGM (`createDrinksStaffController`).
 * - Wires press-and-hold continuous energy-bar drinking (`DrinkHoldSession` + `mountDrinkHoldHud`).
 */
export function mountDrinksShop(ctx: DrinksMountContext): DrinksShopHandle {
  const site = ctx.site ?? resolveDrinksSite(ctx.siteId ?? DEFAULT_DRINKS_SITE_ID)
  const skin = ctx.skin ?? DEFAULT_DRINKS_SKIN
  const lod = createDrinksLodController(ctx.lod ?? DEFAULT_DRINKS_LOD_CONFIG)
  const viewModeAdapter = ctx.viewMode ?? createMemoryViewModeAdapter()

  const readHour = (): number => {
    const h = ctx.getHour?.()
    return typeof h === 'number' && Number.isFinite(h) ? h : 14.5
  }
  const readNight = (): number => {
    const n = ctx.getNightFactor?.()
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
  }

  const clampedMaxCustomers = Math.min(
    MAX_CONCURRENT_CUSTOMERS,
    Math.max(1, ctx.maxCustomers ?? MAX_CONCURRENT_CUSTOMERS),
  )

  const sim = createDrinksSim({
    menu: DRINKS_MENU,
    seed: ctx.seed ?? `drinks-${site.id}`,
    now: 0,
    hourOf: () => readHour(),
    open24h: ctx.open24h ?? false,
    clerkCount: ctx.clerkCount ?? 5,
    maxCustomers: clampedMaxCustomers,
  })

  const shopCandidate = site.id === 'zhengyang_208' ? 'poi_zhengyang208' : 'wangcheng_mall'
  const shop = buildDrinksShopMesh({
    candidate: shopCandidate,
    layout: sim.getLayout(),
  })
  shop.group.name = 'wangcheng_drinks_shop'
  shop.group.position.set(site.worldX, site.fallbackGroundY, site.worldZ)
  shop.group.rotation.y = site.worldYaw
  shop.group.visible = false
  mainDetail(shop.group)
  ctx.scene.add(shop.group)

  const terrain = fitDrinksPlot({
    site,
    shopGroup: shop.group,
    sampleGroundY: ctx.sampleGroundY,
  })
  terrain.plinthGroup.position.set(0, 0, 0)
  terrain.plinthGroup.rotation.set(0, 0, 0)
  mainDetail(terrain.plinthGroup)
  shop.group.add(terrain.plinthGroup)

  let groundY = terrain.plotY
  let groundSnapped = Boolean(ctx.sampleGroundY)

  const npc = createDrinksNpcRenderer({
    scene: ctx.scene,
    sim,
    worldOrigin: [site.worldX, groundY, site.worldZ],
    worldYaw: site.worldYaw,
    sampleGroundY: (wx: number, wz: number) => terrain.samplePlotSurfaceY(wx, wz),
    maxNpcs: Math.min(20, Math.max(16, (ctx.clerkCount ?? 5) + clampedMaxCustomers + 4)),
    showBadges: ctx.showNpcBadges ?? true,
  })
  npc.group.name = 'wangcheng_drinks_npcs'
  npc.group.visible = false
  mainDetail(npc.group)

  const audio = createDrinksAudio()
  const holdSession = new DrinkHoldSession()
  const holdVisual: DrinkHoldVisualAdapter = createDrinkHoldVisual(holdSession)

  const hasDom = typeof document !== 'undefined' && ctx.container !== null
  const uiContainer = hasDom ? (ctx.container ?? document.body) : null

  const staff = createDrinksStaffController({
    scene: ctx.scene,
    sim,
    worldOrigin: [site.worldX, groundY, site.worldZ],
    worldYaw: site.worldYaw,
    audio,
    container: uiContainer,
  })
  // 归入 shop.group 本地坐标系，保持顶层 scene 节点整洁并自动继承显隐与地基标高
  staff.group.removeFromParent()
  staff.group.position.set(0, 0, 0)
  staff.group.rotation.set(0, 0, 0)
  mainDetail(staff.group)
  shop.group.add(staff.group)
  if (staff.hud && staff.hud.root.hidden) {
    staff.hud.root.remove()
  }

  const indoorView = createDrinksIndoorViewController({
    site,
    layout: sim.getLayout(),
    bounds: {
      minX: shop.interiorBounds?.minX ?? DRINKS_SHOP_INTERIOR.minX,
      maxX: shop.interiorBounds?.maxX ?? DRINKS_SHOP_INTERIOR.maxX,
      minZ: shop.interiorBounds?.minZ ?? DRINKS_SHOP_INTERIOR.minZ,
      doorZ: shop.doorway?.z ?? DRINKS_SHOP_DOORWAY.z,
    },
    viewMode: viewModeAdapter,
    ownerId: 'drinks_shop',
  })

  updateSceneCrowdThinning(ctx.scene, {
    x: site.worldX,
    z: site.worldZ,
    outerRadius: 18,
    innerRadius: 8.5,
    maxInOuter: 2,
  })

  function trySnapGroundY(): boolean {
    if (!ctx.sampleGroundY) return false
    const centerY = ctx.sampleGroundY(site.worldX, site.worldZ)
    const front = shopLocalToWorld(site, 0.2, 3.2)
    const frontY = ctx.sampleGroundY(front.x, front.z)
    if (!Number.isFinite(centerY) && !Number.isFinite(frontY)) return false
    const prevY = groundY
    terrain.refit(ctx.sampleGroundY)
    terrain.plinthGroup.position.set(0, 0, 0)
    terrain.plinthGroup.rotation.set(0, 0, 0)
    mainDetail(terrain.plinthGroup)
    groundY = terrain.plotY
    groundSnapped = true
    shop.group.position.set(site.worldX, groundY, site.worldZ)
    return Math.abs(groundY - prevY) > 1e-3
  }

  let orderPanel: DrinksOrderPanelController | null = null
  let pickupHud: DrinksPickupHudController | null = null
  let holdHud: DrinkHoldHudController | null = null

  let firstSipPending = false
  let stowedForRide = false
  let lastDistanceM = Infinity
  let lastNearInteract = false
  let lastPickupVisible: boolean | null = null
  let lastOrderPanelOpenState: boolean | null = null
  let hudSyncAccum = 0
  let disposed = false

  function performSip(): DrinkSipResult {
    const res = holdSession.sip()
    if (res.ok) {
      if (firstSipPending) {
        firstSipPending = false
        audio.play('straw_poke')
      }
      audio.playSip()
    } else {
      audio.play('action_reject')
    }
    return res
  }

  function performDiscard(): boolean {
    const ok = holdSession.discard()
    if (ok) {
      firstSipPending = false
      audio.play('cup_drop')
    }
    return ok
  }

  if (uiContainer) {
    orderPanel = mountDrinksOrderPanel({
      sim,
      holdSession,
      wallet: ctx.wallet,
      skin,
      container: uiContainer,
      onOrderPlaced(order, custom) {
        pickupHud?.rememberCustomization(order.id, custom)
        pickupHud?.sync()
        audio.playOrderConfirm()
      },
      onOpenChange() {
        pickupHud?.sync()
      },
    })

    pickupHud = mountDrinksPickupHud({
      sim,
      holdSession,
      skin,
      container: uiContainer,
      onOpenOrder() {
        orderPanel?.open()
      },
      onCollected() {
        firstSipPending = true
        audio.play('cup_drop')
        orderPanel?.close()
      },
    })
    pickupHud.setVisible(false)

    holdHud = mountDrinkHoldHud({
      container: uiContainer,
      session: holdSession,
      onSipStart: () => {
        if (firstSipPending) {
          firstSipPending = false
          audio.play('straw_poke')
        }
      },
      onDiscard: () => {
        performDiscard()
      },
    })
  }

  function findReadyPlayerOrder(): OrderSnapshot | null {
    const snap = sim.getSnapshot()
    return snap.orders.find(o => o.source === 'player' && o.status === 'ready_for_pickup') ?? null
  }

  function hasActivePlayerOrder(): boolean {
    const snap = sim.getSnapshot()
    return snap.orders.some(
      o =>
        o.source === 'player' &&
        (o.status === 'queued' || o.status === 'preparing' || o.status === 'ready_for_pickup'),
    )
  }

  function collectReady(): CollectPlayerOrderResult | null {
    const ready = findReadyPlayerOrder()
    if (!ready) return null
    if (pickupHud) {
      return pickupHud.collectOrder(ready.id)
    }
    const res = sim.collectPlayerOrder(ready.id)
    if (res.ok && res.order) {
      const cat = DRINKS_MENU.find(m => m.id === res.order!.itemId)
      if (cat) {
        holdSession.pickup(cat, undefined, res.order.id)
        firstSipPending = true
        audio.play('cup_drop')
      }
    }
    return res
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (disposed || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.code !== 'KeyE') return
    if (orderPanel?.isOpen()) return
    if (isGlobalHotkeyBlocked(event.target) || isModalOrOverlayOpen()) return
    const walker = ctx.getWalker?.()
    if (walker && walker.vehicle && walker.vehicle !== 'foot') return

    // 优先响应门口招聘立牌与在岗员工工位交互
    if (staff.handleKeyDown(event.code, event.target)) {
      event.preventDefault()
      return
    }
    if (!lastNearInteract) return

    event.preventDefault()
    const ready = findReadyPlayerOrder()
    if (ready) {
      collectReady()
    } else {
      orderPanel?.open()
    }
  }

  if (typeof window !== 'undefined' && hasDom) {
    window.addEventListener('keydown', onKeyDown)
  }

  function updateVisualAndUi(dtSec: number, hadEvents: boolean): void {
    const playerPos = ctx.getPlayerPos()
    const focusX = playerPos ? playerPos.x : ctx.camera.position.x
    const focusZ = playerPos ? playerPos.z : ctx.camera.position.z
    const distM = computeDistanceXZ(focusX, focusZ, site.worldX, site.worldZ)
    lastDistanceM = distM

    const walker = ctx.getWalker?.() ?? null
    const doc = typeof document !== 'undefined' ? document : null
    const photoOn = doc?.body?.dataset.photo === 'on'
    const shopOpen = doc?.body?.dataset.shopOpen === '1'
    const homeOpen = Boolean(doc?.body?.hasAttribute?.('data-home'))
    const aboardAttr = Boolean(doc?.body?.hasAttribute?.('data-aboard'))
    const drinksUiOpen = Boolean(orderPanel?.isOpen())

    const pauseDecision = resolveHeldDrinkPause({
      walkerActive: walker ? walker.active : Boolean(playerPos),
      vehicle: walker?.vehicle ?? null,
      aboardAttr,
      photoOn,
      shopOpen,
      drinksUiOpen,
    })
    stowedForRide = pauseDecision.stowedForRide
    holdSession.setPaused(pauseDecision.paused)
    holdVisual.bindWalker(walker, walker?.figure ?? null)
    const finishedDrinkNow = holdVisual.step(dtSec)
    if (finishedDrinkNow) {
      firstSipPending = false
      audio.play('cup_drop')
    }

    const onFoot = Boolean(playerPos) && (!walker?.vehicle || walker.vehicle === 'foot')
    indoorView.update(onFoot ? playerPos : null, onFoot && !photoOn && !homeOpen && !shopOpen)

    const canShowHud = Boolean(playerPos) && !photoOn && !shopOpen && !homeOpen && !stowedForRide
    const lodState = lod.update(distM, hasActivePlayerOrder(), canShowHud)
    lastNearInteract = lodState.nearInteract

    if (lodState.shouldCloseOrderPanel && orderPanel?.isOpen()) {
      orderPanel.close()
    }

    if (lodState.visualActive) {
      const snappedNow = !groundSnapped && trySnapGroundY()
      if (!shop.group.visible) shop.group.visible = true
      if (!npc.group.visible) npc.group.visible = true
      const snapDt = lodState.visualEntered || snappedNow ? 0 : dtSec
      const night = readNight()
      shop.step(snapDt, sim.getSnapshot().timeSec, night)
      npc.step(snapDt, ctx.camera.position)
      staff.bindWalker(walker, walker?.figure ?? null)
      if (playerPos && onFoot) {
        staff.setPlayerWorldPos(playerPos.x, playerPos.z, walker?.yaw ?? 0)
      } else {
        staff.setPlayerLocalPos(999, 999, 0)
      }
      staff.step(snapDt)
      if (staff.hud && uiContainer) {
        const shouldMountStaffHud = !staff.hud.root.hidden
        const isAttached = Boolean((staff.hud.root as unknown as { parentNode?: unknown; parent?: unknown }).parentNode || (staff.hud.root as unknown as { parent?: unknown }).parent)
        if (shouldMountStaffHud && !isAttached) uiContainer.append(staff.hud.root)
        else if (!shouldMountStaffHud && isAttached) staff.hud.root.remove()
      }
    } else {
      if (shop.group.visible) shop.group.visible = false
      if (npc.group.visible) npc.group.visible = false
      if (staff.hud) staff.hud.root.remove()
    }

    if (pickupHud) {
      const staffBusy = staff.getSnapshot().onDuty
      const wantPickup = lodState.showPickupHud && !staffBusy
      if (lastPickupVisible !== wantPickup) {
        lastPickupVisible = wantPickup
        pickupHud.setVisible(wantPickup)
      }
      hudSyncAccum += dtSec
      if (wantPickup && (hadEvents || hudSyncAccum >= 0.5)) {
        hudSyncAccum = 0
        pickupHud.sync()
      }
    }
    if (orderPanel?.isOpen()) {
      const openNow = sim.getSnapshot().isOpen
      if (lastOrderPanelOpenState !== openNow) {
        lastOrderPanelOpenState = openNow
        orderPanel.sync()
      }
    } else {
      lastOrderPanelOpenState = null
    }
  }

  function step(dtSec: number): void {
    if (disposed) return
    const safeDt = Math.min(0.25, Math.max(0, Number.isFinite(dtSec) ? dtSec : 0))
    sim.step(safeDt)
    const events = sim.drainEvents()
    for (const ev of events) {
      const mapped = mapSimEventToSound(ev, lastDistanceM, isPlayerOrderInSim(sim, ev.orderId))
      if (mapped) {
        audio.play(mapped.soundId, { volume: mapped.volume })
      }
    }
    updateVisualAndUi(safeDt, events.length > 0)
  }

  function fastForward(seconds: number): void {
    if (disposed) return
    const dur = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
    if (dur > 0) {
      sim.fastForward(dur)
      sim.drainEvents()
    }
    updateVisualAndUi(0, true)
  }

  function getProbeState(): DrinksProbeState {
    const snap = sim.getSnapshot()
    const walker = ctx.getWalker?.() ?? null
    const playerOrders = snap.orders.filter(o => o.source === 'player')
    const activeOrdersCount = snap.orders.filter(
      o => o.status === 'queued' || o.status === 'preparing' || o.status === 'ready_for_pickup',
    ).length
    const fp = viewModeAdapter.isFirstPerson()
    return {
      site,
      disposed,
      visualActive: lod.isVisualActive(),
      nearInteract: lastNearInteract,
      insideShop: indoorView.isInside(),
      viewMode: fp ? 'first' : 'third',
      isFirstPerson: fp,
      indoorView: indoorView.getState(),
      distanceM: Number.isFinite(lastDistanceM) ? Math.round(lastDistanceM * 100) / 100 : Infinity,
      groundY: Math.round(groundY * 1000) / 1000,
      groundSnapped,
      terrain: {
        plotY: Math.round(terrain.plotY * 1000) / 1000,
        fillHeightM: Math.round(terrain.fillHeightM * 1000) / 1000,
        maxCornerGapM: Math.round(terrain.maxCornerGapM * 10000) / 10000,
        maxSidewalkGapM: Math.round(terrain.maxSidewalkGapM * 10000) / 10000,
        maxOuterSeamGapM: Math.round(terrain.maxOuterSeamGapM * 10000) / 10000,
      },
      simTimeSec: Math.round(snap.timeSec * 100) / 100,
      hour: Math.round(snap.hour * 100) / 100,
      phase: snap.phase,
      isOpen: snap.isOpen,
      metrics: snap.metrics,
      activeOrdersCount,
      playerOrders,
      npcMetrics: npc.getMetrics(),
      shopMetrics: shop.getMetrics(),
      staff: staff.getSnapshot(),
      hold: holdSession.getSnapshot(),
      stowedForRide,
      cupAttached: isCupAttachedToWalker(walker),
      orderPanelOpen: Boolean(orderPanel?.isOpen()),
      pickupHudVisible: Boolean(pickupHud && !pickupHud.root.hidden),
      holdHudVisible: Boolean(holdHud && !holdHud.root.hidden),
      audioStats: audio.getStats(),
    }
  }

  async function teleportToShop(): Promise<boolean> {
    if (disposed || !ctx.walkTo) return false
    const front = shopLocalToWorld(site, 0.2, 6.0)
    const faceShopYaw = site.worldYaw
    const ok = await ctx.walkTo(front.x, front.z, faceShopYaw, 'drinks-shop')
    if (ok) {
      trySnapGroundY()
      updateVisualAndUi(0, true)
    }
    return ok
  }

  async function walkInside(): Promise<boolean> {
    if (disposed || !ctx.walkTo) return false
    const inside = shopLocalToWorld(site, 0.0, 1.2)
    const ok = await ctx.walkTo(inside.x, inside.z, site.worldYaw, 'drinks-shop-inside')
    if (ok) {
      trySnapGroundY()
      updateVisualAndUi(0, true)
    }
    return ok
  }

  async function walkToRecruitSign(): Promise<boolean> {
    if (disposed || !ctx.walkTo) return false
    const stand = shopLocalToWorld(site, -1.42, 4.95)
    const ok = await ctx.walkTo(stand.x, stand.z, site.worldYaw, 'drinks-recruit-sign')
    if (ok) {
      trySnapGroundY()
      updateVisualAndUi(0, true)
    }
    return ok
  }

  async function placeQuickOrder(drinkId = 'ice_lemon_water'): Promise<boolean> {
    if (disposed) return false
    if (orderPanel) {
      orderPanel.open(drinkId)
      const res = await orderPanel.submitOrder()
      orderPanel.close()
      if (res.ok) return true
    }
    const item = DRINKS_MENU.find(m => m.id === drinkId) ?? DRINKS_MENU[0]
    if (!item) return false
    const placed = sim.placePlayerOrder({ menuItemId: item.id, orderKey: `quick-${Date.now()}` })
    return Boolean(placed.ok)
  }

  trySnapGroundY()
  updateVisualAndUi(0, true)

  const probe: DrinksDebugProbe = {
    site,
    sim,
    holdSession,
    staff,
    terrain,
    getState: getProbeState,
    teleportToShop,
    walkInside,
    walkToRecruitSign,
    interactRecruit() {
      if (disposed) return false
      return staff.performAction({ forceRecruit: false })
    },
    openOrder(drinkId?: string) {
      if (disposed || !orderPanel) return false
      orderPanel.open(drinkId)
      return true
    },
    closeOrder() {
      orderPanel?.close()
    },
    placeQuickOrder,
    collectReady,
    startHoldSip() {
      if (disposed) return { ok: false, code: 'NO_DRINK', energy: 0 }
      return holdSession.startDrinking()
    },
    stopHoldSip() {
      if (disposed) return false
      return holdSession.stopDrinking()
    },
    sip: performSip,
    discard: performDiscard,
    fastForward(seconds: number) {
      fastForward(seconds)
      return getProbeState()
    },
  }

  return {
    site,
    sim,
    shop,
    terrain,
    npc,
    staff,
    indoorView,
    audio,
    holdSession,
    orderPanel,
    pickupHud,
    holdHud,
    step,
    fastForward,
    isVisualActive: () => lod.isVisualActive(),
    isDisposed: () => disposed,
    getProbe: () => probe,
    dispose() {
      if (disposed) return
      disposed = true
      if (typeof window !== 'undefined' && hasDom) {
        window.removeEventListener('keydown', onKeyDown)
      }
      updateSceneCrowdThinning(ctx.scene, null)
      indoorView.dispose()
      staff.dispose()
      orderPanel?.dispose()
      pickupHud?.dispose()
      holdHud?.dispose()
      holdVisual.dispose()
      holdSession.discard()
      npc.dispose()
      shop.dispose()
      terrain.dispose()
      audio.dispose()
      lod.reset()
      if (typeof document !== 'undefined' && document.body) {
        delete document.body.dataset.drinksUiOpen
        delete document.body.dataset.drinksHold
        delete document.body.dataset.drinksIndoor
      }
    },
  }
}
