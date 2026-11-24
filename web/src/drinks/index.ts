import * as THREE from 'three'
import type { Walker } from '../play/host.ts'
import type { ObstacleVolumeSpec } from '../walk/obstacle-volumes.ts'
import { createDrinksAudio, type DrinksAudioController, type DrinksAudioStats } from './audio/index.ts'
import {
  createDrinkHoldVisual,
  DrinkHoldSession,
  mountDrinkHoldHud,
  type DrinkHoldHudController,
  type DrinkHoldSnapshot,
  type DrinkHoldVisualAdapter,
  type DrinkSipResult,
} from './hold/hold-controller.ts'
import type { DrinkWalletBackend } from './hold/payment-core.ts'
import { DEFAULT_DRINKS_SKIN, DRINKS_MENU, type DrinksShopSkinConfig } from './menu/menu.ts'
import { DEFAULT_MASTER_DRINKS_SKIN } from './menu/skin.ts'
import { createDrinksNpcRenderer, type DrinksNpcMetrics, type DrinksNpcRenderer } from './npc/index.ts'
import { buildDrinksShopMesh, type DrinksShopBuildResult, type DrinksShopMetrics } from './shop/index.ts'
import {
  createDrinksSim,
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
import {
  computeDistanceXZ,
  createDrinksLodController,
  DEFAULT_DRINKS_LOD_CONFIG,
  mapSimEventToSound,
  resolveHeldDrinkPause,
  type DrinksLodConfig,
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

export const DRINKS_VOLUME_ID = 'wangcheng_drinks_shop'

export function notifyCancelSmoke(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    const ev = typeof Event === 'function' ? new Event('smoke:cancel') : ({ type: 'smoke:cancel' } as Event)
    window.dispatchEvent(ev)
  }
}

export interface DrinksInteractCandidate {
  readonly shopId: 'wangcheng_drinks_shop'
  readonly brandName: string
  readonly distanceM: number
  readonly hasReadyOrder: boolean
  readonly readyOrderId: string | null
}

export interface DrinksWalkerLike extends Walker {
  readonly vehicle?: 'foot' | 'bike' | 'bicycle' | 'car' | 'boat' | string
  readonly figure?: THREE.Object3D
  readonly syncObstacleVolume?: (spec: ObstacleVolumeSpec) => void
  readonly removeObstacleVolume?: (id: string) => void
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

export interface DrinksProbeState {
  site: DrinksSiteCandidate
  disposed: boolean
  visualActive: boolean
  nearInteract: boolean
  distanceM: number
  groundY: number
  groundSnapped: boolean
  simTimeSec: number
  hour: number
  phase: string
  isOpen: boolean
  metrics: DrinksSimMetrics
  activeOrdersCount: number
  playerOrders: OrderSnapshot[]
  npcMetrics: DrinksNpcMetrics
  shopMetrics: DrinksShopMetrics
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
  getState(): DrinksProbeState
  teleportToShop(): Promise<boolean>
  openOrder(drinkId?: string): boolean
  closeOrder(): void
  getInteractCandidate(): DrinksInteractCandidate | null
  interact(): boolean
  stowHeldDrink(): boolean
  getObstacleVolumeSpec(): ObstacleVolumeSpec
  collectReady(): CollectPlayerOrderResult | null
  sip(): DrinkSipResult
  discard(): boolean
  fastForward(seconds: number): DrinksProbeState
}

export interface DrinksShopHandle {
  readonly site: DrinksSiteCandidate
  readonly sim: DrinksSim
  readonly shop: DrinksShopBuildResult
  readonly npc: DrinksNpcRenderer
  readonly audio: DrinksAudioController
  readonly holdSession: DrinkHoldSession
  readonly orderPanel: DrinksOrderPanelController | null
  readonly pickupHud: DrinksPickupHudController | null
  readonly holdHud: DrinkHoldHudController | null
  step(dtSec: number): void
  fastForward(seconds: number): void
  isVisualActive(): boolean
  isDisposed(): boolean
  getInteractCandidate(): DrinksInteractCandidate | null
  interact(): boolean
  stowHeldDrink(): boolean
  getObstacleVolumeSpec(): ObstacleVolumeSpec
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
 * Mounts the Wangcheng flagship beverage shop into the host world:
 * - Always steps pure simulation (`sim`) so unattended shop operations continue regardless of player proximity.
 * - Shows & steps 3D architecture (`shop`) + instanced NPCs (`npc`) only when the player is near,
 *   and re-synchronizes visuals cleanly when returning from afar.
 * - Wires ordering UI, pickup call screen, atomic main-wallet payment, 3D hand-held drinking,
 *   riding auto-stow, and procedural Web Audio SFX.
 * - `dispose()` completely frees scene nodes, GPU resources, DOM nodes, listeners, and audio context.
 */
export function mountDrinksShop(ctx: DrinksMountContext): DrinksShopHandle {
  const site = ctx.site ?? resolveDrinksSite(ctx.siteId ?? DEFAULT_DRINKS_SITE_ID)
  const skin = ctx.skin ?? DEFAULT_DRINKS_SKIN
  const lod = createDrinksLodController(ctx.lod ?? DEFAULT_DRINKS_LOD_CONFIG)

  const readHour = (): number => {
    const h = ctx.getHour?.()
    return typeof h === 'number' && Number.isFinite(h) ? h : 14.5
  }
  const readNight = (): number => {
    const n = ctx.getNightFactor?.()
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
  }

  let groundY = site.fallbackGroundY
  let groundSnapped = false
  function trySnapGroundY(): boolean {
    if (!ctx.sampleGroundY) return false
    const centerY = ctx.sampleGroundY(site.worldX, site.worldZ)
    const front = shopLocalToWorld(site, 0.2, 3.2)
    const frontY = ctx.sampleGroundY(front.x, front.z)
    const candidates = [centerY, frontY].filter(v => Number.isFinite(v))
    if (!candidates.length) return false
    const nextY = Math.max(...candidates)
    if (Math.abs(nextY - groundY) > 1e-3 || !groundSnapped) {
      groundY = nextY
      groundSnapped = true
      shop.group.position.set(site.worldX, groundY, site.worldZ)
      shop.group.updateMatrixWorld(true)
      return true
    }
    return false
  }

  const sim = createDrinksSim({
    menu: DRINKS_MENU,
    seed: ctx.seed ?? `drinks-${site.id}`,
    now: 0,
    hourOf: () => readHour(),
    open24h: ctx.open24h ?? false,
    clerkCount: ctx.clerkCount ?? 5,
    maxCustomers: ctx.maxCustomers ?? 26,
  })

  const candidateId = site.id === 'zhengyang_208' ? 'poi_zhengyang208' : 'wangcheng_mall'
  const shop = buildDrinksShopMesh({
    candidate: candidateId,
    layout: sim.getLayout(),
    skin: {
      brandLabel: skin.displayName,
      subLabel: DEFAULT_MASTER_DRINKS_SKIN.signboard.subLabel,
    },
  })
  shop.group.name = DRINKS_VOLUME_ID
  shop.group.userData.colliders = shop.colliders
  shop.group.userData.site = site
  shop.group.position.set(site.worldX, groundY, site.worldZ)
  shop.group.rotation.y = site.worldYaw
  shop.group.updateMatrixWorld(true)
  shop.group.visible = false
  ctx.scene.add(shop.group)

  const npc = createDrinksNpcRenderer({
    scene: ctx.scene,
    sim,
    worldOrigin: [site.worldX, groundY, site.worldZ],
    worldYaw: site.worldYaw,
    sampleGroundY: () => groundY,
    maxNpcs: Math.max(40, (ctx.clerkCount ?? 5) + (ctx.maxCustomers ?? 26) + 8),
    showBadges: ctx.showNpcBadges ?? true,
  })
  npc.group.name = 'wangcheng_drinks_npcs'
  npc.group.visible = false

  const audio = createDrinksAudio()
  const holdSession = new DrinkHoldSession()
  const holdVisual: DrinkHoldVisualAdapter = createDrinkHoldVisual(holdSession)

  const hasDom = typeof document !== 'undefined' && ctx.container !== null
  const uiContainer = hasDom ? (ctx.container ?? document.body) : null

  let orderPanel: DrinksOrderPanelController | null = null
  let pickupHud: DrinksPickupHudController | null = null
  let holdHud: DrinkHoldHudController | null = null

  let firstSipPending = false
  let stowedForRide = false
  let lastDistanceM = Infinity
  let lastNearInteract = false
  let lastSyncedObstacleKey = ''
  let lastPickupVisible: boolean | null = null
  let lastOrderPanelOpenState: boolean | null = null
  let hudSyncAccum = 0
  let disposed = false

  function getObstacleVolumeSpec(): ObstacleVolumeSpec {
    return {
      id: DRINKS_VOLUME_ID,
      origin: [site.worldX, groundY, site.worldZ],
      rotationY: site.worldYaw,
      boxes: shop.colliders.map(c => ({
        minX: c.minX,
        maxX: c.maxX,
        minZ: c.minZ,
        maxZ: c.maxZ,
        minY: 0,
        maxY: 4.5,
        label: c.label,
      })),
    }
  }

  function performSip(): DrinkSipResult {
    const res = holdSession.sip()
    if (res.ok) {
      notifyCancelSmoke()
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
        notifyCancelSmoke()
        audio.play('cup_drop')
        orderPanel?.close()
      },
    })
    pickupHud.setVisible(false)

    holdHud = mountDrinkHoldHud({
      container: uiContainer,
      session: holdSession,
      onSip: () => {
        performSip()
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
        notifyCancelSmoke()
        audio.play('cup_drop')
      }
    }
    return res
  }

  function getInteractCandidate(): DrinksInteractCandidate | null {
    if (disposed || !lastNearInteract) return null
    if (orderPanel?.isOpen()) return null
    const walker = ctx.getWalker?.()
    if (walker && walker.vehicle && walker.vehicle !== 'foot') return null
    const ready = findReadyPlayerOrder()
    return {
      shopId: DRINKS_VOLUME_ID,
      brandName: skin.shortName || skin.displayName,
      distanceM: lastDistanceM,
      hasReadyOrder: Boolean(ready),
      readyOrderId: ready?.id ?? null,
    }
  }

  function interact(): boolean {
    const cand = getInteractCandidate()
    if (!cand) return false
    if (cand.hasReadyOrder) {
      return Boolean(collectReady()?.ok)
    }
    if (!orderPanel) return false
    orderPanel.open()
    return true
  }

  const onSmokeConflict = () => {
    if (disposed) return
    if (holdSession.getSnapshot().active) {
      performDiscard()
    }
  }

  if (typeof window !== 'undefined' && hasDom) {
    window.addEventListener('smoke:slot', onSmokeConflict)
    window.addEventListener('drinks:stow', onSmokeConflict)
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
      if (walker?.syncObstacleVolume) {
        const obsKey = `${groundY.toFixed(3)}|${site.worldX.toFixed(3)}|${site.worldZ.toFixed(3)}|${site.worldYaw.toFixed(5)}`
        if (obsKey !== lastSyncedObstacleKey) {
          lastSyncedObstacleKey = obsKey
          walker.syncObstacleVolume(getObstacleVolumeSpec())
        }
      }
      const snapDt = lodState.visualEntered || snappedNow ? 0 : dtSec
      const night = readNight()
      shop.step(snapDt, sim.getSnapshot().timeSec, night)
      npc.step(snapDt, ctx.camera.position)
    } else {
      if (shop.group.visible) shop.group.visible = false
      if (npc.group.visible) npc.group.visible = false
    }

    if (pickupHud) {
      if (lastPickupVisible !== lodState.showPickupHud) {
        lastPickupVisible = lodState.showPickupHud
        pickupHud.setVisible(lodState.showPickupHud)
      }
      hudSyncAccum += dtSec
      if (lodState.showPickupHud && (hadEvents || hudSyncAccum >= 0.5)) {
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
    return {
      site,
      disposed,
      visualActive: lod.isVisualActive(),
      nearInteract: lastNearInteract,
      distanceM: Number.isFinite(lastDistanceM) ? Math.round(lastDistanceM * 100) / 100 : Infinity,
      groundY: Math.round(groundY * 1000) / 1000,
      groundSnapped,
      simTimeSec: Math.round(snap.timeSec * 100) / 100,
      hour: Math.round(snap.hour * 100) / 100,
      phase: snap.phase,
      isOpen: snap.isOpen,
      metrics: snap.metrics,
      activeOrdersCount,
      playerOrders,
      npcMetrics: npc.getMetrics(),
      shopMetrics: shop.getMetrics(),
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
    // Stand in front of the entrance (+Z patio apron) facing the storefront (-Z in local)
    const front = shopLocalToWorld(site, 0.2, 6.2)
    const faceShopYaw = site.worldYaw
    const ok = await ctx.walkTo(front.x, front.z, faceShopYaw, 'drinks-shop')
    if (ok) {
      trySnapGroundY()
      updateVisualAndUi(0, true)
    }
    return ok
  }

  // Initial proximity evaluation so near spawns render on frame 0 and far spawns stay hidden.
  trySnapGroundY()
  updateVisualAndUi(0, true)

  const probe: DrinksDebugProbe = {
    site,
    sim,
    holdSession,
    getState: getProbeState,
    teleportToShop,
    openOrder(drinkId?: string) {
      if (disposed || !orderPanel) return false
      orderPanel.open(drinkId)
      return true
    },
    closeOrder() {
      orderPanel?.close()
    },
    getInteractCandidate,
    interact,
    stowHeldDrink: performDiscard,
    getObstacleVolumeSpec,
    collectReady,
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
    npc,
    audio,
    holdSession,
    orderPanel,
    pickupHud,
    holdHud,
    step,
    fastForward,
    isVisualActive: () => lod.isVisualActive(),
    isDisposed: () => disposed,
    getInteractCandidate,
    interact,
    stowHeldDrink: performDiscard,
    getObstacleVolumeSpec,
    getProbe: () => probe,
    dispose() {
      if (disposed) return
      disposed = true
      if (typeof window !== 'undefined' && hasDom) {
        window.removeEventListener('smoke:slot', onSmokeConflict)
        window.removeEventListener('drinks:stow', onSmokeConflict)
      }
      if (lastSyncedObstacleKey) {
        lastSyncedObstacleKey = ''
        ctx.getWalker?.()?.removeObstacleVolume?.(DRINKS_VOLUME_ID)
      }
      orderPanel?.dispose()
      pickupHud?.dispose()
      holdHud?.dispose()
      holdVisual.dispose()
      holdSession.discard()
      npc.dispose()
      shop.dispose()
      audio.dispose()
      lod.reset()
      if (typeof document !== 'undefined' && document.body) {
        delete document.body.dataset.drinksUiOpen
        delete document.body.dataset.drinksHold
      }
    },
  }
}
