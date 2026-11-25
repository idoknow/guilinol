import * as THREE from 'three'
import type { Walker } from '../play/host.ts'
import type { ObstacleVolumeSpec } from '../walk/obstacle-volumes.ts'
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
  dispose as disposeDrinksStaff,
  enterStaff,
  exitStaff,
  mount as mountDrinksStaff,
  type DrinksStaffController,
  type DrinksStaffStateSnapshot,
} from './staff/index.ts'
import {
  bindTerrainRefitSync,
  computeDistanceXZ,
  createDrinksHostWorldBridge,
  createDrinksIndoorViewController,
  createDrinksLodController,
  createStaffToHoldBridge,
  DEFAULT_DRINKS_LOD_CONFIG,
  mapSimEventToSound,
  measureSceneGroupsAlignment,
  resolveHeldDrinkPause,
  setDrinksSceneGroupsVisible,
  shouldExposeDrinksDebugProbe,
  syncDrinksSceneGroups,
  type DrinksFourSceneGroups,
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

export {
  measureSceneGroupsAlignment,
  shouldExposeDrinksDebugProbe,
  type DrinksFourSceneGroups,
  type DrinksGroupAlignmentReport,
} from './integration/runtime.ts'

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
    if (existing.size === 0) {
      delete scene.userData[CROWD_THINNING_KEY]
    }
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
  drive?: (dx: number, dz: number, run?: boolean) => void
  tick?: (dtSec: number) => void
  syncObstacleVolume?: (spec: ObstacleVolumeSpec) => void
  removeObstacleVolume?: (id: string) => void
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
  isProd?: boolean
  search?: string | null
  enableDebugProbe?: boolean
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

/**
 * 只读观测与受控验收探针（仅在 DEV 或 `?verify` 下创建；生产环境默认不挂载，且绝不暴露内部可变实例或免扣款作弊入口）。
 */
export interface DrinksDebugProbe {
  readonly site: DrinksSiteCandidate
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
  enterStaff(opts?: { force?: boolean }): boolean
  exitStaff(): boolean
  step(dtSec: number): void
  fastForward(seconds: number): void
  isVisualActive(): boolean
  isDisposed(): boolean
  getProbe(): DrinksDebugProbe | undefined
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

function detectProdRuntime(explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit
  const env = (import.meta as unknown as { env?: { DEV?: boolean; PROD?: boolean } }).env
  return Boolean(env?.PROD) && !env?.DEV
}

/**
 * Mounts the Wangcheng Mixue Phase 2 flagship beverage shop into the host world:
 * - Unifies `shop.group`, `terrain.plinthGroup`, `staff.group`, and `npc.group` under a single parent (`ctx.scene`)
 *   with single-pass `(worldX, groundY, worldZ)` + `worldYaw` transforms and automatic `terrain.refit` synchronization.
 * - Bridges host Rapier plinth floor support + Wangcheng podium doorway carve so players walk smoothly through the
 *   2.8m doorway to indoor prep stations without terrain sink or legacy shell collision.
 * - Wires full end-to-end loop: doorway auto-FP -> recruit standee -> uniform -> 5-step drink prep -> call number ->
 *   cup handoff to player hand -> press-and-hold energy-bar drinking -> exit restores prior view mode.
 * - Guarantees zero node/DOM/listener leaks across repeated `mount`/`dispose` cycles, and never exposes debug probes
 *   by default in production builds.
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

  // 1) shop.group：直接且仅挂载一次于 ctx.scene（保持纯净不混入台基/员工/NPC 网格，确保 shop.getMetrics().meshes <= 30）
  const shopCandidate = site.id === 'zhengyang_208' ? 'poi_zhengyang208' : 'wangcheng_mall'
  const shop = buildDrinksShopMesh({
    candidate: shopCandidate,
    layout: sim.getLayout(),
  })
  shop.group.name = 'wangcheng_drinks_shop'
  mainDetail(shop.group)
  ctx.scene.add(shop.group)

  // 2) terrain.plinthGroup：由 fitDrinksPlot 直接且仅挂载一次于 ctx.scene
  const terrain = fitDrinksPlot({
    site,
    scene: ctx.scene,
    shopGroup: shop.group,
    sampleGroundY: ctx.sampleGroundY,
  })
  mainDetail(terrain.plinthGroup)

  let groundY = terrain.plotY
  let groundSnapped = Boolean(ctx.sampleGroundY)
  const localCamPos = new THREE.Vector3()

  // 3) npc.group：内部保持 shop-local 零旋转原点（worldOrigin=[0,0,0], worldYaw=0），
  //    由 npc.group 自身唯一承担一次 shop-local -> world 位姿变换，与其余三组严格同构
  const npc = createDrinksNpcRenderer({
    scene: ctx.scene,
    sim,
    worldOrigin: [0, 0, 0],
    worldYaw: 0,
    sampleGroundY: (lx: number, lz: number) => {
      const w = shopLocalToWorld(site, lx, lz)
      return terrain.samplePlotSurfaceY(w.x, w.z) - groundY
    },
    maxNpcs: Math.min(20, Math.max(16, (ctx.clerkCount ?? 5) + clampedMaxCustomers + 4)),
    showBadges: ctx.showNpcBadges ?? true,
  })
  npc.group.name = 'wangcheng_drinks_npcs'
  mainDetail(npc.group)

  const audio = createDrinksAudio()
  const holdSession = new DrinkHoldSession()
  const holdVisual: DrinkHoldVisualAdapter = createDrinkHoldVisual(holdSession)

  const hasDom = typeof document !== 'undefined' && ctx.container !== null
  const uiContainer = hasDom ? (ctx.container ?? document.body) : null

  // 4) staff.group：由冻结契约 mountDrinksStaff 直接且仅挂载一次于 ctx.scene（无二次重挂）
  const staff = mountDrinksStaff({
    scene: ctx.scene,
    sim,
    worldOrigin: [site.worldX, groundY, site.worldZ],
    worldYaw: site.worldYaw,
    audio,
    container: uiContainer,
  })
  mainDetail(staff.group)
  if (staff.hud && staff.hud.root.hidden) {
    staff.hud.root.remove()
  }

  const sceneGroups: DrinksFourSceneGroups = {
    shopGroup: shop.group,
    plinthGroup: terrain.plinthGroup,
    staffGroup: staff.group,
    npcGroup: npc.group,
  }
  syncDrinksSceneGroups(site, groundY, sceneGroups)
  setDrinksSceneGroupsVisible(sceneGroups, false)

  function syncLocalCameraVec(): THREE.Vector3 {
    const cl = worldToShopLocal(site, ctx.camera.position.x, ctx.camera.position.z)
    return localCamPos.set(cl.x, ctx.camera.position.y - groundY, cl.z)
  }

  const hostBridge = createDrinksHostWorldBridge({
    scene: ctx.scene,
    site,
    getGroundY: () => groundY,
    getWalker: () => ctx.getWalker?.(),
    excludedRoots: [shop.group, terrain.plinthGroup, staff.group, npc.group],
  })

  bindTerrainRefitSync(terrain, site, sceneGroups, nextPlotY => {
    groundY = nextPlotY
    groundSnapped = true
    npc.step(0, syncLocalCameraVec())
    if (lod.isVisualActive()) {
      hostBridge.sync(true)
    }
  })

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

  const staffToHoldBridge = createStaffToHoldBridge({
    drainStaffEvents: () => staff.session.drainEvents(),
    holdSession,
    onCupHandedOff() {
      firstSipPending = true
      orderPanel?.close()
    },
  })

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

    // 优先响应门口招聘立牌与在岗员工五步工位交互，并立即桥接出杯叫号到手持饮品
    if (staff.handleKeyDown(event.code, event.target)) {
      staffToHoldBridge.flush()
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
      if (!shop.group.visible) {
        setDrinksSceneGroupsVisible(sceneGroups, true)
      }
      hostBridge.sync(true)
      const snapDt = lodState.visualEntered || snappedNow ? 0 : dtSec
      const night = readNight()
      shop.step(snapDt, sim.getSnapshot().timeSec, night)
      npc.step(snapDt, syncLocalCameraVec())
      staff.bindWalker(walker, walker?.figure ?? null)
      if (playerPos && onFoot) {
        // 单次 world -> shop-local 坐标换算
        const localPlayer = worldToShopLocal(site, playerPos.x, playerPos.z)
        staff.setPlayerLocalPos(localPlayer.x, localPlayer.z, (walker?.yaw ?? 0) - site.worldYaw)
      } else {
        staff.setPlayerLocalPos(999, 999, 0)
      }
      staff.step(snapDt)
      staffToHoldBridge.flush()

      if (staff.hud && uiContainer) {
        const shouldMountStaffHud = !staff.hud.root.hidden
        const isAttached = Boolean(
          (staff.hud.root as unknown as { parentNode?: unknown; parent?: unknown }).parentNode ||
            (staff.hud.root as unknown as { parent?: unknown }).parent,
        )
        if (shouldMountStaffHud && !isAttached) uiContainer.append(staff.hud.root)
        else if (!shouldMountStaffHud && isAttached) staff.hud.root.remove()
      }
    } else {
      if (shop.group.visible) {
        setDrinksSceneGroupsVisible(sceneGroups, false)
      }
      hostBridge.sync(false)
      if (staff.hud) staff.hud.root.remove()
    }

    // 在 staff.step 之后执行手持杯同步，确保右手捧杯姿态与手指握姿不被离线骨骼清理覆盖
    holdVisual.bindWalker(walker, walker?.figure ?? null)
    const finishedDrinkNow = holdVisual.step(dtSec)
    if (finishedDrinkNow) {
      firstSipPending = false
      audio.play('cup_drop')
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
    const walker = ctx.getWalker?.()
    // 真实物理步行引擎下：先落在门前解放东路人行道齐平衔接位并挂载台面碰撞板，再沿 2.8m 正门步入室内，避免落入底层 DEM 凹坑
    if (walker && typeof walker.drive === 'function' && typeof walker.tick === 'function') {
      const curPos = ctx.getPlayerPos()
      const curLocal = curPos ? worldToShopLocal(site, curPos.x, curPos.z) : null
      const alreadyOnDeck =
        Boolean(curPos && curLocal) &&
        Math.abs(curLocal!.x) <= 7.0 &&
        curLocal!.z >= -6.4 &&
        curLocal!.z <= 6.5 &&
        curPos!.y >= groundY - 0.35
      if (!alreadyOnDeck) {
        const approach = shopLocalToWorld(site, 0.2, 5.6)
        const landed = await ctx.walkTo(approach.x, approach.z, site.worldYaw, 'drinks-shop-door')
        if (!landed) return false
      }
      trySnapGroundY()
      updateVisualAndUi(0, true)
      hostBridge.sync(true)

      const targetWorld = shopLocalToWorld(site, 0.2, 1.35)
      walker.face(site.worldYaw)
      for (let i = 0; i < 80; i++) {
        const p = ctx.getPlayerPos()
        if (!p) break
        const dx = targetWorld.x - p.x
        const dz = targetWorld.z - p.z
        const dist = Math.hypot(dx, dz)
        if (dist <= 0.18) break
        walker.drive(dx / dist, dz / dist, false)
        walker.tick(1 / 20)
        updateVisualAndUi(1 / 20, false)
      }
      walker.drive(0, 0, false)
      updateVisualAndUi(0, true)
      return indoorView.isInside()
    }

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
    const walker = ctx.getWalker?.()
    const targetWorld = shopLocalToWorld(site, -1.42, 4.95)
    if (walker && typeof walker.drive === 'function' && typeof walker.tick === 'function') {
      const curPos = ctx.getPlayerPos()
      if (!curPos || Math.hypot(curPos.x - site.worldX, curPos.z - site.worldZ) > 14 || curPos.y < groundY - 0.35) {
        const front = shopLocalToWorld(site, -1.2, 5.8)
        const landed = await ctx.walkTo(front.x, front.z, site.worldYaw, 'drinks-recruit-approach')
        if (!landed) return false
      }
      trySnapGroundY()
      updateVisualAndUi(0, true)
      hostBridge.sync(true)
      for (let i = 0; i < 45; i++) {
        const p = ctx.getPlayerPos()
        if (!p) break
        const dx = targetWorld.x - p.x
        const dz = targetWorld.z - p.z
        const dist = Math.hypot(dx, dz)
        if (dist <= 0.16) break
        walker.drive(dx / dist, dz / dist, false)
        walker.tick(1 / 20)
        updateVisualAndUi(1 / 20, false)
      }
      walker.drive(0, 0, false)
      walker.face(site.worldYaw)
      updateVisualAndUi(0, true)
      return true
    }

    const ok = await ctx.walkTo(targetWorld.x, targetWorld.z, site.worldYaw, 'drinks-recruit-sign')
    if (ok) {
      trySnapGroundY()
      updateVisualAndUi(0, true)
    }
    return ok
  }

  async function placeQuickOrder(drinkId = 'ice_lemon_water'): Promise<boolean> {
    if (disposed || !orderPanel) return false
    orderPanel.open(drinkId)
    const res = await orderPanel.submitOrder()
    orderPanel.close()
    return Boolean(res.ok)
  }

  trySnapGroundY()
  updateVisualAndUi(0, true)

  const runtimeSearch =
    ctx.search !== undefined
      ? ctx.search
      : typeof location !== 'undefined' && typeof location?.search === 'string'
        ? location.search
        : ''
  const exposeDebugProbe = shouldExposeDrinksDebugProbe({
    isProd: detectProdRuntime(ctx.isProd),
    search: runtimeSearch,
    explicit: ctx.enableDebugProbe,
  })

  const probe: DrinksDebugProbe | undefined = exposeDebugProbe
    ? Object.freeze<DrinksDebugProbe>({
        site,
        getState: getProbeState,
        teleportToShop,
        walkInside,
        walkToRecruitSign,
        interactRecruit() {
          if (disposed) return false
          const ok = staff.performAction({ forceRecruit: false })
          staffToHoldBridge.flush()
          return ok
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
        startHoldSip(): DrinkHoldStartResult {
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
      })
    : undefined

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
    enterStaff: opts => enterStaff(staff, opts),
    exitStaff: () => exitStaff(staff),
    step,
    fastForward,
    isVisualActive: () => lod.isVisualActive(),
    isDisposed: () => disposed,
    getProbe: () => (disposed ? undefined : probe),
    dispose() {
      if (disposed) return
      disposed = true
      if (typeof window !== 'undefined' && hasDom) {
        window.removeEventListener('keydown', onKeyDown)
      }
      updateSceneCrowdThinning(ctx.scene, null)
      hostBridge.dispose()
      indoorView.dispose()
      disposeDrinksStaff(staff)
      staffToHoldBridge.reset()
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
