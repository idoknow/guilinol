import * as T from 'three'
import type {Stream} from '../stream'
import {fetchAsset} from '../world'
import {createFreeBoats, type MooringSlot} from './boat'
import type {createPhysics} from './physics'
import {createCarControl, type CarDynamicTelemetry, type CarStepControl} from './car'
import type {CarDriveMode, EbikeHeadlightMode, EbikeTurnSignal} from './config'
import {env as skyEnv} from '../look/time'
import {
  resolveEbikeKind,
  type EbikeTier,
  type EbikeUpgradeMods,
  type EbikeVehicleType,
  type PersonalEbikeTierId,
  type ResolvedEbikeProfile,
} from './tuning'
import {
  createBikeControl,
  type EbikeDynamicTelemetry,
  type EbikeStepControl,
  type RideKind,
} from './ride'
import {vehicleModel} from './vehicle-model'
import {isGlobalHotkeyBlocked, isModalOrOverlayOpen} from './input-guard'
import {KICKSTAND_REST_ROLL_RAD} from './ebike-state-coupling'
import {resolveInteractDecision, type InteractDecision} from './interact-arbiter'
import {findNearbyShopOrService, SHOP_MAP, type NearbyShopHit, type ShopTriggerDef} from '../game/shops'
import {ECONOMY_CONSTANTS, PERSONAL_EBIKE_MODELS, type PersistedEbikeVisual, type PersonalEbikeModelId} from '../game/catalog'
import {isPointInQuietZone} from '../game/quiet-zones'
import {
  emit,
  getState,
  setActiveTestRideState,
  setActiveWorldPersonalVehicle,
  syncPersonalVehicleTelemetry,
  type VehicleOwnership,
} from '../game/state'
import {chargeSharedBikeRental} from '../game/commerce'

type Position = [number, number, number]
type Route = {kind: string; start: string; end: string; path: Position[]}
type BoardPos = {x: number; y: number; z: number; bikeY: number}

export type BikeInstanceState = {
  vehicleType: EbikeVehicleType
  ownership: VehicleOwnership
  instanceId?: string
  modelId?: PersonalEbikeModelId
  batteryPct: number
  durabilityPct: number
  mods: EbikeUpgradeMods | null
  visualMods?: PersistedEbikeVisual
  parkLocked?: boolean
  kickstandDown?: boolean
}

export interface SummonPersonalBikeResult {
  ok: boolean
  code: 'OK' | 'NO_OWNED_VEHICLE' | 'NOT_ON_FOOT' | 'QUIET_ZONE_BLOCKED' | 'COOLDOWN' | 'NO_SAFE_SPOT' | 'CRASH_BUSY' | 'IN_TEST_RIDE'
  vehicleId?: string
  pos?: [number, number, number]
  yaw?: number
  cooldownRemainingMs?: number
}

export interface StartTestRideResult {
  ok: boolean
  code: 'OK' | 'INVALID_MODEL' | 'INVALID_SHOP' | 'QUIET_ZONE_BLOCKED' | 'ALREADY_IN_TEST_RIDE'
  instanceId?: string
  expiresAt?: number
}

const bikeCoordKey = (x: number, z: number) => `${Math.round(x * 10)},${Math.round(z * 10)}`
type Physics = Awaited<ReturnType<typeof createPhysics>>
export type FreeDismountTarget = {x: number; y: number; z: number; rule: string; heading: number}
export interface VehiclesEnv {
  sim: Physics
  stream: Stream
  landFree: (spot: FreeDismountTarget) => boolean
  onShopInteract?: (shop: ShopTriggerDef, kind: 'shop' | 'service') => void
  isFootAnimBusy?: () => boolean
  supportYAt?: (x: number, z: number, refY: number) => number
}
interface Data {
  bikes: [number, number, number, number, number][]
  sharedBikes?: [number, number, number, number, number][]
  bicycles?: [number, number, number, number, number][]
  cars?: [number, number, number, number, number][]
  docks: Record<string, Position>
  routes: Route[]
  grid: number[]
  mask: string
  motorGrid?: number[]
  motorMask?: string
}

export async function vehicles(
  scene: T.Scene,
  file: string,
  land: (x: number, z: number, bikeHeading?: number, bikeY?: number, kind?: 'car') => boolean,
  board?: (bx: number, by: number, bz: number, kind?: 'car') => BoardPos | null,
  env?: VehiclesEnv,
) {
  const buffer = await fetchAsset(file)
  const data: Data = JSON.parse(
    await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text(),
  )
  const mask = atob(data.mask)
  const [left, top, width, height, step] = data.grid
  const group = new T.Group()
  scene.add(group)
  const mMask = data.motorMask ? atob(data.motorMask) : mask
  const [mLeft, mTop, mWidth, mHeight, mStep] = data.motorGrid ?? data.grid
  const cells = new Map<string, T.Group>()
  const visibleCells = new Set<T.Group>()
  const cellSize = 128
  const bikeStates = new WeakMap<T.Object3D, BikeInstanceState>()
  const bikeCoordStates = new Map<string, BikeInstanceState>()
  const makeVehicleMesh = vehicleModel as (kind: string, paint?: number, options?: {shared?: boolean}) => T.Mesh

  let activePersonalMesh: T.Mesh | null = null
  let activeTestRideMesh: T.Mesh | null = null
  let sharedRideElapsedSec = 0
  let sharedRideBilled = false
  let sharedRideSessionId = 0

  function store(mesh: T.Mesh) {
    const key = `${Math.floor(mesh.position.x / cellSize)},${Math.floor(mesh.position.z / cellSize)}`
    let cell = cells.get(key)
    if (!cell) {
      cell = new T.Group()
      cells.set(key, cell)
    }
    cell.add(mesh)
  }

  function detachMeshFromCells(mesh: T.Mesh | null) {
    if (!mesh) return
    const oldKey = mesh.userData.coordKey as string | undefined
    if (oldKey) bikeCoordStates.delete(oldKey)
    mesh.parent?.remove(mesh)
  }

  function addBike(x: number, y: number, z: number, angle: number, paint: number, explicitType?: EbikeVehicleType) {
    const vehicleType = resolveEbikeKind(paint, explicitType)
    const isShared = vehicleType === 'shared'
    const mesh = makeVehicleMesh('bike', paint, isShared ? {shared: true} : undefined)
    mesh.position.set(x, y, z)
    mesh.rotation.y = angle
    mesh.userData.paint = paint
    mesh.userData.shared = isShared
    mesh.userData.vehicleType = vehicleType
    mesh.userData.ebikeTier = vehicleType
    mesh.userData.ownership = 'shared' as VehicleOwnership
    mesh.userData.battery = 100
    mesh.userData.durability = 100
    const coordKey = bikeCoordKey(x, z)
    mesh.userData.coordKey = coordKey
    const state: BikeInstanceState = {
      vehicleType,
      ownership: 'shared',
      batteryPct: 100,
      durabilityPct: 100,
      mods: null,
    }
    bikeStates.set(mesh, state)
    bikeCoordStates.set(coordKey, state)
    store(mesh)
  }

  for (const [x, y, z, angle, paint] of data.bikes) addBike(x, y, z, angle, paint)
  for (const [x, y, z, angle, paint] of data.sharedBikes ?? []) addBike(x, y, z, angle, paint, 'shared')
  for (const [x, y, z, angle, paint] of data.bicycles ?? []) {
    const mesh = vehicleModel('bicycle', paint)
    mesh.position.set(x, y, z)
    mesh.rotation.y = angle
    store(mesh)
  }
  for (const [x, y, z, angle, paint] of data.cars ?? []) {
    const mesh = vehicleModel('car', paint)
    mesh.position.set(x, y, z)
    mesh.rotation.y = angle
    store(mesh)
  }

  const vessels = data.routes.map(route => {
    const pink = route.kind === 'boat' && [route.start, route.end].includes('桂湖')
    const mesh = vehicleModel(route.kind, pink ? 1 : 0)
    mesh.position.fromArray(route.path[0])
    group.add(mesh)
    return mesh
  })
  const piers = new Map<string, T.Mesh>()
  const pierShape = new T.BoxGeometry(1, 1, 1)
  const pierMaterial = new T.MeshStandardMaterial({color: 0x816a50})
  for (const leg of data.routes) {
    if (piers.has(leg.start)) continue
    const [x, , z] = data.docks[leg.start]
    const [waterX, waterY, waterZ] = leg.path[0]
    const dx = waterX - x
    const dz = waterZ - z
    const length = Math.hypot(dx, dz)
    const mesh = new T.Mesh(pierShape, pierMaterial)
    mesh.scale.set(1.4, 0.25, Math.max(1, length - 1.4))
    mesh.rotation.y = Math.atan2(dx, dz)
    mesh.position.set(x + dx * 0.45, waterY + 0.24, z + dz * 0.45)
    group.add(mesh)
    piers.set(leg.start, mesh)
  }
  const departures = new Set<string>()
  const moored = data.routes.map(leg => {
    const first = !departures.has(leg.start)
    departures.add(leg.start)
    return first
  })
  const freeBoats = env ? createFreeBoats({group, docks: data.docks, routes: data.routes, sim: env.sim, stream: env.stream}) : null

  const ringMat = new T.MeshBasicMaterial({color: 0xd86b4a, transparent: true, opacity: 0.45, depthWrite: false, side: T.DoubleSide, fog: false})
  const interactRing = new T.Mesh(new T.RingGeometry(0.86, 1.08, 32).rotateX(-Math.PI / 2), ringMat)
  interactRing.renderOrder = 4
  interactRing.visible = false
  group.add(interactRing)

  const button = document.createElement('button')
  button.className = 'vehicle-action'
  button.setAttribute('aria-keyshortcuts', 'F')
  button.hidden = true
  document.body.append(button)

  const bikeCtrl = createBikeControl()
  const carCtrl = createCarControl()
  let bike: T.Mesh | null = null
  let lastBike: T.Mesh | null = null
  let car: T.Mesh | null = null
  let lastCar: T.Mesh | null = null
  let route = -1
  let nearBike: T.Mesh | null = null
  let nearBikeDist = Infinity
  let nearShop: NearbyShopHit | null = null
  let nearRoute = -1
  let nearRouteDist = Infinity
  let segment = 1
  let disembark = false
  let active = false
  let heading = 0
  let lastDecision: InteractDecision = {action: 'none', label: '', suppressVehicleHintRing: false}
  let nearFree: {slot: MooringSlot | null; distance: number; atBank: boolean} = {slot: null, distance: Infinity, atBank: false}

  function currentDecision(): InteractDecision {
    const crashedRide = document.body.dataset.rideCrash === '1'
    const crashBusy = !!env?.isFootAnimBusy?.()
    const nearModelId = nearBike?.userData.modelId as PersonalEbikeModelId | undefined
    return resolveInteractDecision({
      active,
      modalOrShopOpen: isModalOrOverlayOpen(),
      crashBusy,
      crashedRide,
      aboard: {
        car: !!car,
        bike: !!bike,
        freeBoat: !!freeBoats?.active,
        route: route >= 0,
        disembarkQueued: disembark,
      },
      nearbyShop: nearShop,
      nearbyVehicle: nearBike
        ? {
            kind: nearBike.name === 'car' ? 'car' : nearBike.name === 'bicycle' ? 'bicycle' : 'bike',
            downed: !!nearBike.userData.downed,
            distance: nearBikeDist,
            ownership: (nearBike.userData.ownership as VehicleOwnership | undefined) ?? 'shared',
            vehicleType:
              nearBike.name === 'bike'
                ? ((nearBike.userData.vehicleType as EbikeVehicleType | undefined) ??
                  resolveEbikeKind((nearBike.userData.paint as number | undefined) ?? 0))
                : undefined,
            modelName: nearModelId ? PERSONAL_EBIKE_MODELS[nearModelId]?.name : undefined,
          }
        : null,
      nearbyFreeBoat: nearFree.slot ? {name: nearFree.slot.name, kind: nearFree.slot.kind, distance: nearFree.distance} : null,
      nearbyRoute: nearRoute >= 0 ? {start: data.routes[nearRoute].start, distance: nearRouteDist} : null,
    })
  }

  function syncHud() {
    lastDecision = currentDecision()
    document.body.toggleAttribute('data-aboard', !!car || !!bike || route >= 0 || !!freeBoats?.active)
    if (bike && bikeCtrl.kind === 'bike') {
      document.body.dataset.ebikeTier = bikeCtrl.vehicleType
      document.body.dataset.rideType = bikeCtrl.vehicleType
      document.body.dataset.vehicleOwnership = (bike.userData.ownership as string | undefined) ?? 'shared'
    } else {
      delete document.body.dataset.ebikeTier
      delete document.body.dataset.vehicleOwnership
      if (bike?.name !== 'bicycle') delete document.body.dataset.rideType
    }

    if (lastDecision.ebikeTierAttr) button.dataset.ebikeTier = lastDecision.ebikeTierAttr
    else delete button.dataset.ebikeTier

    if (lastDecision.action === 'open_shop' || lastDecision.action === 'open_service') {
      button.dataset.interact = 'shop'
    } else {
      delete button.dataset.interact
    }

    button.hidden = !lastDecision.label
    if (button.textContent !== lastDecision.label) button.textContent = lastDecision.label
  }

  function saveBikeInstanceState(mesh: T.Mesh, parkOverride?: {parkLocked: boolean; kickstandDown: boolean}) {
    if (mesh.name !== 'bike') return
    const prev = bikeStates.get(mesh)
    const ownership: VehicleOwnership = (mesh.userData.ownership as VehicleOwnership | undefined) ?? prev?.ownership ?? 'shared'
    const instanceId = (mesh.userData.instanceId as string | undefined) ?? prev?.instanceId
    const modelId = (mesh.userData.modelId as PersonalEbikeModelId | undefined) ?? prev?.modelId
    const parkLocked = parkOverride?.parkLocked ?? prev?.parkLocked ?? true
    const kickstandDown = parkOverride?.kickstandDown ?? prev?.kickstandDown ?? true
    const durabilityPct = (mesh.userData.durability as number | undefined) ?? prev?.durabilityPct ?? 100
    const state: BikeInstanceState = {
      vehicleType: bikeCtrl.vehicleType,
      ownership,
      instanceId,
      modelId,
      batteryPct: bikeCtrl.batteryPct,
      durabilityPct,
      mods: bikeCtrl.vehicleType === 'normal' ? (bikeCtrl.mods ?? prev?.mods ?? null) : null,
      visualMods: prev?.visualMods,
      parkLocked,
      kickstandDown,
    }
    bikeStates.set(mesh, state)
    mesh.userData.vehicleType = state.vehicleType
    mesh.userData.ebikeTier = state.vehicleType
    mesh.userData.shared = state.vehicleType === 'shared'
    mesh.userData.ownership = ownership
    mesh.userData.battery = state.batteryPct
    mesh.userData.durability = durabilityPct
    mesh.userData.parkLocked = parkLocked
    mesh.userData.kickstandDown = kickstandDown
    const oldKey = mesh.userData.coordKey as string | undefined
    const newKey = bikeCoordKey(mesh.position.x, mesh.position.z)
    if (oldKey && oldKey !== newKey) bikeCoordStates.delete(oldKey)
    mesh.userData.coordKey = newKey
    bikeCoordStates.set(newKey, state)

    if (ownership === 'personal' && instanceId) {
      syncPersonalVehicleTelemetry(instanceId, {batteryPct: state.batteryPct, durabilityPct}, true)
    }
  }

  function attachMeshToCell(mesh: T.Mesh) {
    store(mesh)
    if (active && mesh.parent && !visibleCells.has(mesh.parent as T.Group)) {
      visibleCells.add(mesh.parent as T.Group)
      group.add(mesh.parent)
    }
  }

  function buildPersonalOrTestMesh(
    ownership: 'personal' | 'test_ride',
    instanceId: string,
    modelId: PersonalEbikeModelId,
    x: number,
    y: number,
    z: number,
    yaw: number,
    batteryPct: number,
    durabilityPct: number,
    upgrades: EbikeUpgradeMods,
    visual: PersistedEbikeVisual,
  ): T.Mesh {
    const paintIdx = modelId === 'lijiang_light' ? 0 : modelId === 'city_range' ? 2 : 3
    const mesh = makeVehicleMesh('bike', paintIdx, undefined)
    mesh.position.set(x, y, z)
    mesh.rotation.set(0, yaw, KICKSTAND_REST_ROLL_RAD, 'YXZ')
    mesh.userData.paint = paintIdx
    mesh.userData.shared = false
    mesh.userData.vehicleType = 'normal' as EbikeVehicleType
    mesh.userData.ebikeTier = 'normal' as EbikeTier
    mesh.userData.ownership = ownership
    mesh.userData.instanceId = instanceId
    mesh.userData.modelId = modelId
    mesh.userData.battery = batteryPct
    mesh.userData.durability = durabilityPct
    mesh.userData.modPreset = visual.preset
    mesh.userData.visualMods = {...visual}
    mesh.userData.parkLocked = true
    mesh.userData.kickstandDown = true
    const coordKey = bikeCoordKey(x, z)
    mesh.userData.coordKey = coordKey
    const state: BikeInstanceState = {
      vehicleType: 'normal',
      ownership,
      instanceId,
      modelId,
      batteryPct,
      durabilityPct,
      mods: {...upgrades},
      visualMods: {...visual},
      parkLocked: true,
      kickstandDown: true,
    }
    bikeStates.set(mesh, state)
    bikeCoordStates.set(coordKey, state)
    return mesh
  }

  function despawnPersonalMesh() {
    if (!activePersonalMesh) return
    const id = activePersonalMesh.userData.instanceId as string | undefined
    const saved = bikeStates.get(activePersonalMesh)
    if (id && saved) {
      syncPersonalVehicleTelemetry(id, {batteryPct: saved.batteryPct, durabilityPct: saved.durabilityPct}, true)
    }
    if (bike === activePersonalMesh) bike = null
    if (lastBike === activePersonalMesh) lastBike = null
    if (nearBike === activePersonalMesh) nearBike = null
    detachMeshFromCells(activePersonalMesh)
    activePersonalMesh = null
  }

  function despawnTestRideMesh() {
    if (!activeTestRideMesh) return
    if (bike === activeTestRideMesh) {
      bike = null
      bikeCtrl.reset()
    }
    if (lastBike === activeTestRideMesh) lastBike = null
    if (nearBike === activeTestRideMesh) nearBike = null
    detachMeshFromCells(activeTestRideMesh)
    activeTestRideMesh = null
  }

  function reset() {
    if (route >= 0) vessels[route].position.fromArray(data.routes[route].path[0])
    freeBoats?.reset()
    if (car) {
      car.rotation.set(carCtrl.pitch, carCtrl.heading, 0, 'YXZ')
      attachMeshToCell(car)
    }
    if (bike) {
      const isEbike = bikeCtrl.kind === 'bike'
      saveBikeInstanceState(bike, {parkLocked: isEbike, kickstandDown: true})
      bike.rotation.set(bikeCtrl.pitch, bikeCtrl.heading, isEbike ? KICKSTAND_REST_ROLL_RAD : 0, 'YXZ')
      attachMeshToCell(bike)
    }
    car = null
    bike = null
    route = -1
    nearFree = {slot: null, distance: Infinity, atBank: false}
    disembark = false
    segment = 1
    sharedRideElapsedSec = 0
    sharedRideBilled = false
    delete document.body.dataset.ebikeTier
    delete document.body.dataset.rideType
    delete document.body.dataset.vehicleOwnership
    bikeCtrl.reset()
    carCtrl.reset()
  }

  function dismountDownedBike(x: number, y: number, z: number, yaw: number, roll: number, lift: number) {
    if (!bike) return false
    const mesh = bike
    mesh.position.set(x, y + lift, z)
    mesh.rotation.set(0, yaw, roll, 'YXZ')
    mesh.visible = true
    mesh.userData.downed = true
    saveBikeInstanceState(mesh, {parkLocked: false, kickstandDown: false})
    attachMeshToCell(mesh)
    bike = null
    delete document.body.dataset.ebikeTier
    delete document.body.dataset.rideType
    delete document.body.dataset.vehicleOwnership
    bikeCtrl.reset()
    syncHud()
    return true
  }

  function relocateParkedBike(
    mesh: T.Mesh,
    x: number,
    y: number,
    z: number,
    yaw: number,
    roll = 0,
    parkState?: {parkLocked: boolean; kickstandDown: boolean},
  ) {
    mesh.position.set(x, y, z)
    mesh.rotation.set(0, yaw, roll, 'YXZ')
    mesh.userData.downed = false
    if (mesh.name === 'bike') {
      const prev = bikeStates.get(mesh)
      const nextState: BikeInstanceState = {
        vehicleType: prev?.vehicleType ?? resolveEbikeKind((mesh.userData.paint as number | undefined) ?? 0, mesh.userData.vehicleType ?? mesh.userData.ebikeTier),
        ownership: prev?.ownership ?? ((mesh.userData.ownership as VehicleOwnership | undefined) ?? 'shared'),
        instanceId: prev?.instanceId ?? (mesh.userData.instanceId as string | undefined),
        modelId: prev?.modelId ?? (mesh.userData.modelId as PersonalEbikeModelId | undefined),
        batteryPct: prev?.batteryPct ?? (mesh.userData.battery as number | undefined) ?? 100,
        durabilityPct: prev?.durabilityPct ?? (mesh.userData.durability as number | undefined) ?? 100,
        mods: prev?.mods ?? null,
        visualMods: prev?.visualMods,
        parkLocked: parkState?.parkLocked ?? prev?.parkLocked ?? true,
        kickstandDown: parkState?.kickstandDown ?? prev?.kickstandDown ?? true,
      }
      bikeStates.set(mesh, nextState)
      mesh.userData.parkLocked = nextState.parkLocked
      mesh.userData.kickstandDown = nextState.kickstandDown
      const oldKey = mesh.userData.coordKey as string | undefined
      const newKey = bikeCoordKey(x, z)
      if (oldKey && oldKey !== newKey) bikeCoordStates.delete(oldKey)
      mesh.userData.coordKey = newKey
      bikeCoordStates.set(newKey, nextState)
    } else if (parkState) {
      mesh.userData.parkLocked = parkState.parkLocked
      mesh.userData.kickstandDown = parkState.kickstandDown
    }
    attachMeshToCell(mesh)
    syncHud()
  }

  function mountBikeMesh(targetMesh: T.Mesh, forceBoard = false): boolean {
    const prevKey = (targetMesh.userData.coordKey as string | undefined) ?? bikeCoordKey(targetMesh.position.x, targetMesh.position.z)
    const safePos = !forceBoard && board
      ? board(targetMesh.position.x, targetMesh.position.y, targetMesh.position.z)
      : {x: targetMesh.position.x, y: targetMesh.position.y, z: targetMesh.position.z, bikeY: targetMesh.position.y}
    if (!safePos) return false
    targetMesh.position.set(safePos.x, safePos.bikeY, safePos.z)
    const rideKind: RideKind = targetMesh.name === 'bicycle' ? 'bicycle' : 'bike'
    const saved = bikeStates.get(targetMesh) ?? bikeCoordStates.get(prevKey)
    const ownership: VehicleOwnership = (targetMesh.userData.ownership as VehicleOwnership | undefined) ?? saved?.ownership ?? 'shared'
    const instanceId = (targetMesh.userData.instanceId as string | undefined) ?? saved?.instanceId
    const liveOwned = ownership === 'personal' && instanceId ? getState().garage.vehicles[instanceId] : undefined
    const vehicleType: EbikeVehicleType =
      ownership === 'personal' || ownership === 'test_ride'
        ? 'normal'
        : (saved?.vehicleType ?? resolveEbikeKind((targetMesh.userData.paint as number | undefined) ?? 0, targetMesh.userData.vehicleType ?? targetMesh.userData.ebikeTier))
    const modelId = liveOwned?.modelId ?? saved?.modelId ?? (targetMesh.userData.modelId as PersonalEbikeModelId | undefined)
    const savedBat = liveOwned?.batteryPct ?? saved?.batteryPct ?? (targetMesh.userData.battery as number | undefined) ?? 100
    const savedDur = liveOwned?.durabilityPct ?? saved?.durabilityPct ?? (targetMesh.userData.durability as number | undefined) ?? 100
    const mods = vehicleType === 'shared' ? null : (liveOwned?.upgrades ?? saved?.mods ?? null)
    if (liveOwned) {
      targetMesh.userData.visualMods = {...liveOwned.visual}
      targetMesh.userData.modPreset = liveOwned.visual.preset
      targetMesh.userData.durability = savedDur
    }

    bike = lastBike = targetMesh
    group.add(bike)
    bikeCtrl.mount(bike.rotation.y, bike.rotation.x, rideKind, {
      vehicleType,
      modelId: modelId ?? null,
      durabilityPct: savedDur,
      batteryPct: savedBat,
      mods,
      envHour: skyEnv.hour,
    })
    sharedRideElapsedSec = 0
    sharedRideBilled = false
    sharedRideSessionId += 1
    saveBikeInstanceState(bike, {parkLocked: bikeCtrl.parkLocked, kickstandDown: bikeCtrl.kickstandDown})
    syncHud()
    return true
  }

  function interact() {
    if (!active) return
    const decision = currentDecision()
    if (decision.hintToast && (decision.action === 'none' || decision.action === 'dismount_bike' || decision.action === 'dismount_car')) {
      window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text: decision.hintToast, ms: 2200}}))
    }
    switch (decision.action) {
      case 'none':
        return
      case 'dismount_car':
        if (car && land(car.position.x, car.position.z, carCtrl.heading, car.position.y, 'car')) reset()
        return
      case 'dismount_bike':
        if (bike && land(bike.position.x, bike.position.z, bikeCtrl.heading, bike.position.y)) reset()
        return
      case 'dismount_free_boat': {
        const spot = freeBoats?.dismount(data.docks, s => !!env?.landFree(s))
        if (spot) {
          nearFree = {slot: null, distance: Infinity, atBank: false}
          syncHud()
        }
        return
      }
      case 'disembark_route':
        disembark = true
        syncHud()
        return
      case 'open_shop':
        if (decision.shop) env?.onShopInteract?.(decision.shop, 'shop')
        return
      case 'open_service':
        if (decision.shop) env?.onShopInteract?.(decision.shop, 'service')
        return
      case 'mount_car':
        if (nearBike?.name === 'car') {
          const safePos = board
            ? board(nearBike.position.x, nearBike.position.y, nearBike.position.z, 'car')
            : {x: nearBike.position.x, y: nearBike.position.y, z: nearBike.position.z, bikeY: nearBike.position.y}
          if (!safePos) return
          nearBike.position.set(safePos.x, safePos.bikeY, safePos.z)
          car = lastCar = nearBike
          group.add(car)
          carCtrl.mount(car.rotation.y, car.rotation.x)
          syncHud()
        }
        return
      case 'pickup_downed':
      case 'mount_bike':
        if (nearBike) mountBikeMesh(nearBike)
        return
      case 'mount_free_boat':
        if (nearFree.slot) {
          freeBoats!.mount(nearFree.slot, nearFree.atBank)
          syncHud()
        }
        return
      case 'board_route':
        if (nearRoute >= 0) {
          route = nearRoute
          segment = 1
          disembark = false
          syncHud()
        }
        return
    }
  }

  button.onclick = interact
  const onKeyF = (event: KeyboardEvent) => {
    if (event.code === 'KeyF' && !event.repeat && !isGlobalHotkeyBlocked(event.target)) {
      interact()
    }
  }
  window.addEventListener('keydown', onKeyF)

  function nearby(x: number, z: number, footY?: number) {
    nearBike = null
    nearBikeDist = Infinity
    nearRoute = -1
    nearRouteDist = Infinity
    let bestScore = 4.6
    let bestHint: {x: number; y: number; z: number; dist: number; reach: number; radius: number; gold?: boolean} | null = null

    const nextCells = new Set<T.Group>()
    for (let col = Math.floor((x - 110) / cellSize); col <= Math.floor((x + 110) / cellSize); col++) {
      for (let row = Math.floor((z - 110) / cellSize); row <= Math.floor((z + 110) / cellSize); row++) {
        const cell = cells.get(`${col},${row}`)
        if (!cell) continue
        nextCells.add(cell)
        if (!visibleCells.has(cell)) {
          visibleCells.add(cell)
          group.add(cell)
        }
        for (const child of cell.children) {
          const mesh = child as T.Mesh
          const distance = Math.hypot(mesh.position.x - x, mesh.position.z - z)
          const isCar = mesh.name === 'car'
          const reach = mesh.userData.downed ? 4.4 : isCar ? 4.6 : 4.2
          mesh.visible = distance < 110
          const vertOk = footY === undefined || Math.abs(mesh.position.y - footY) <= 1.5
          // Personal bike receives +0.6 m priority bias over roadside shared bikes at similar distance
          const isPersonal = mesh.userData.ownership === 'personal'
          const score = mesh.userData.downed ? distance - 1.2 : isPersonal ? distance - 0.6 : distance
          if (distance < reach && score < bestScore && vertOk) {
            nearBike = mesh
            nearBikeDist = distance
            bestScore = score
          }
          const hintCap = isCar ? 28 : 24
          if (distance < hintCap && vertOk && (!bestHint || distance < bestHint.dist)) {
            bestHint = {x: mesh.position.x, y: mesh.position.y, z: mesh.position.z, dist: distance, reach, radius: isCar ? 2.35 : 1.15}
          }
        }
      }
    }
    for (const cell of visibleCells) {
      if (!nextCells.has(cell)) {
        group.remove(cell)
        visibleCells.delete(cell)
      }
    }

    nearShop = findNearbyShopOrService(x, z, footY)
    if (nearShop && !nearShop.quietBlocked) {
      const shopPt = nearShop.kind === 'service' && nearShop.shop.serviceBay
        ? [nearShop.shop.serviceBay.x, env?.supportYAt?.(nearShop.shop.serviceBay.x, nearShop.shop.serviceBay.z, footY ?? nearShop.shop.serviceBay.y) ?? nearShop.shop.serviceBay.y, nearShop.shop.serviceBay.z]
        : [nearShop.shop.triggerPos[0], env?.supportYAt?.(nearShop.shop.triggerPos[0], nearShop.shop.triggerPos[2], footY ?? nearShop.shop.triggerPos[1]) ?? nearShop.shop.triggerPos[1], nearShop.shop.triggerPos[2]]
      const reach = nearShop.kind === 'service' ? (nearShop.shop.serviceBay?.radius ?? 2.6) : nearShop.shop.triggerRadius
      if (nearShop.inReach || !bestHint || nearShop.distance < bestHint.dist) {
        bestHint = {x: shopPt[0], y: shopPt[1], z: shopPt[2], dist: nearShop.distance, reach, radius: 1.55, gold: true}
      }
    }

    let nearestDock = 9
    data.routes.forEach((leg, index) => {
      const [dx, , dz] = data.docks[leg.start]
      const distance = Math.hypot(dx - x, dz - z)
      vessels[index].visible = route === index || (moored[index] && distance < 200)
      piers.get(leg.start)!.visible = distance < 200
      if (distance < nearestDock) {
        nearRoute = index
        nearestDock = distance
      }
    })
    nearRouteDist = nearRoute >= 0 ? nearestDock : Infinity
    nearFree = freeBoats ? freeBoats.nearby(x, z, footY) : {slot: null, distance: Infinity, atBank: false}
    if (freeBoats) {
      for (const m of freeBoats.moorings()) {
        if (!m.bank) continue
        const dist = Math.hypot(m.bank[0] - x, m.bank[2] - z)
        if (dist < 28 && (!bestHint || dist < bestHint.dist)) {
          bestHint = {x: m.bank[0], y: m.bank[1], z: m.bank[2], dist, reach: 5.5, radius: 1.45}
        }
      }
    }

    const onFoot = active && !car && !bike && route < 0 && !freeBoats?.active && !isModalOrOverlayOpen()
    if (onFoot && bestHint) {
      const inReach = bestHint.dist < bestHint.reach
      const wave = 0.5 + 0.5 * Math.sin(performance.now() * 0.005)
      interactRing.visible = true
      ringMat.color.setHex(bestHint.gold ? 0xffc53d : 0xd86b4a)
      interactRing.position.set(bestHint.x, bestHint.y + 0.08, bestHint.z)
      interactRing.scale.setScalar(bestHint.radius * (inReach ? 1 + 0.05 * wave : 1.06 + 0.08 * wave))
      ringMat.opacity = inReach ? 0.72 + 0.18 * wave : 0.3 + 0.16 * wave
    } else {
      interactRing.visible = false
    }
    syncHud()
  }

  function pavement(x: number, z: number) {
    const col = Math.round((x - left) / step)
    const row = Math.round((z - top) / step)
    const index = row * width + col
    return col >= 0 && row >= 0 && col < width && row < height && !!(mask.charCodeAt(index >> 3) & (128 >> (index & 7)))
  }

  function motorPavement(x: number, z: number) {
    const col = Math.round((x - mLeft) / mStep)
    const row = Math.round((z - mTop) / mStep)
    const index = row * mWidth + col
    return col >= 0 && row >= 0 && col < mWidth && row < mHeight && !!(mMask.charCodeAt(index >> 3) & (128 >> (index & 7)))
  }

  function summonPersonalBike(playerPos: {x: number; y: number; z: number}, playerYaw: number, vehicleId?: string): SummonPersonalBikeResult {
    const gs = getState()
    if (!active || car || bike || route >= 0 || freeBoats?.active) {
      return {ok: false, code: 'NOT_ON_FOOT'}
    }
    if (env?.isFootAnimBusy?.()) {
      return {ok: false, code: 'CRASH_BUSY'}
    }
    if (gs.garage.activeTestRide) {
      return {ok: false, code: 'IN_TEST_RIDE'}
    }
    if (isPointInQuietZone(playerPos.x, playerPos.z)) {
      return {ok: false, code: 'QUIET_ZONE_BLOCKED'}
    }
    const targetId = vehicleId ?? gs.garage.activeVehicleId ?? Object.keys(gs.garage.vehicles)[0]
    if (!targetId || !gs.garage.vehicles[targetId]) {
      return {ok: false, code: 'NO_OWNED_VEHICLE'}
    }
    const now = Date.now()
    if (now < gs.garage.summonCooldownUntil) {
      return {ok: false, code: 'COOLDOWN', cooldownRemainingMs: gs.garage.summonCooldownUntil - now}
    }

    const ownedBike = gs.garage.vehicles[targetId]
    const footY = playerPos.y
    const fwdX = -Math.sin(playerYaw)
    const fwdZ = -Math.cos(playerYaw)
    const rightX = Math.cos(playerYaw)
    const rightZ = -Math.sin(playerYaw)

    const tryCandidate = (cx: number, cz: number, requirePavement: boolean): {x: number; y: number; z: number} | null => {
      if (isPointInQuietZone(cx, cz)) return null
      if (requirePavement && !pavement(cx, cz)) return null
      if (env?.sim) {
        env.sim.sync(cx, cz)
        if (env.sim.insideHouse(cx, cz) || env.sim.wet(cx, cz)) return null
        const spawn = env.sim.findWalkableSpawn(cx, cz, true)
        if (!spawn) return null
        const gy = env.supportYAt?.(spawn.x, spawn.z, footY) ?? (spawn.y - 0.85)
        if (Math.abs(gy - footY) > 1.2) return null
        if (!env.sim.freeCapsule(spawn.x, gy + 0.9, spawn.z)) return null
        return {x: spawn.x, y: gy, z: spawn.z}
      }
      return {x: cx, y: footY, z: cz}
    }

    let spot: {x: number; y: number; z: number} | null = null
    // Round 1: front-arc 3.0..7.5 m preferring pavement
    const anglesDeg = [25, -25, 45, -45, 65, -65, 10, -10]
    const radii = [3.2, 4.6, 6.0, 7.4]
    outer1: for (const r of radii) {
      for (const deg of anglesDeg) {
        const rad = (deg * Math.PI) / 180
        const ca = Math.cos(rad), sa = Math.sin(rad)
        const dirX = fwdX * ca + rightX * sa
        const dirZ = fwdZ * ca + rightZ * sa
        const hit = tryCandidate(playerPos.x + dirX * r, playerPos.z + dirZ * r, true)
        if (hit) { spot = hit; break outer1 }
      }
    }
    // Round 2: full 360° walkable fallback 3..10 m
    if (!spot) {
      outer2: for (const r of [3.2, 5.0, 7.2, 9.6]) {
        for (let k = 0; k < 12; k++) {
          const ang = playerYaw + (k * Math.PI) / 6
          const hit = tryCandidate(playerPos.x - Math.sin(ang) * r, playerPos.z - Math.cos(ang) * r, false)
          if (hit) { spot = hit; break outer2 }
        }
      }
    }
    if (!spot) return {ok: false, code: 'NO_SAFE_SPOT'}

    despawnPersonalMesh()
    const bikeYaw = playerYaw + Math.PI * 0.5
    const mesh = buildPersonalOrTestMesh(
      'personal',
      ownedBike.id,
      ownedBike.modelId,
      spot.x,
      spot.y,
      spot.z,
      bikeYaw,
      ownedBike.batteryPct,
      ownedBike.durabilityPct,
      ownedBike.upgrades,
      ownedBike.visual,
    )
    activePersonalMesh = mesh
    attachMeshToCell(mesh)
    setActiveWorldPersonalVehicle(ownedBike.id, now + ECONOMY_CONSTANTS.SUMMON_COOLDOWN_MS)
    emit({type: 'garage:summon', vehicleId: ownedBike.id, pos: [spot.x, spot.y, spot.z], yaw: bikeYaw})
    nearby(playerPos.x, playerPos.z, footY)
    return {ok: true, code: 'OK', vehicleId: ownedBike.id, pos: [spot.x, spot.y, spot.z], yaw: bikeYaw}
  }

  function spawnPersonalBikeAtBay(shopId: string, vehicleId: string): boolean {
    const shop = SHOP_MAP.get(shopId)
    const ownedBike = getState().garage.vehicles[vehicleId]
    if (!shop?.deliveryBay || !ownedBike) return false
    const bay = shop.deliveryBay
    const y = env?.supportYAt?.(bay.x, bay.z, bay.y) ?? bay.y
    despawnPersonalMesh()
    const mesh = buildPersonalOrTestMesh(
      'personal',
      ownedBike.id,
      ownedBike.modelId,
      bay.x,
      y,
      bay.z,
      bay.yaw,
      ownedBike.batteryPct,
      ownedBike.durabilityPct,
      ownedBike.upgrades,
      ownedBike.visual,
    )
    activePersonalMesh = mesh
    attachMeshToCell(mesh)
    setActiveWorldPersonalVehicle(ownedBike.id)
    return true
  }

  function refreshPersonalBikeVisual(vehicleId: string): boolean {
    const ownedBike = getState().garage.vehicles[vehicleId]
    if (!ownedBike) return false
    if (activePersonalMesh && activePersonalMesh.userData.instanceId === vehicleId) {
      const saved = bikeStates.get(activePersonalMesh)
      if (saved) {
        saved.batteryPct = ownedBike.batteryPct
        saved.durabilityPct = ownedBike.durabilityPct
        saved.mods = {...ownedBike.upgrades}
        saved.visualMods = {...ownedBike.visual}
      }
      activePersonalMesh.userData.battery = ownedBike.batteryPct
      activePersonalMesh.userData.durability = ownedBike.durabilityPct
      activePersonalMesh.userData.modPreset = ownedBike.visual.preset
      activePersonalMesh.userData.visualMods = {...ownedBike.visual}
    }
    if (bike && bike.userData.instanceId === vehicleId) {
      bikeCtrl.setPersonalModel(ownedBike.modelId as PersonalEbikeTierId, ownedBike.durabilityPct)
      bikeCtrl.setUpgrades(ownedBike.upgrades)
      bikeCtrl.setBattery(ownedBike.batteryPct)
    }
    return true
  }

  function startTestRide(shopId: string, modelId: PersonalEbikeModelId): StartTestRideResult {
    const shop = SHOP_MAP.get(shopId)
    if (!shop?.testRideSpawn) return {ok: false, code: 'INVALID_SHOP'}
    const def = PERSONAL_EBIKE_MODELS[modelId]
    if (!def) return {ok: false, code: 'INVALID_MODEL'}
    if (getState().garage.activeTestRide) return {ok: false, code: 'ALREADY_IN_TEST_RIDE'}
    const sp = shop.testRideSpawn
    if (isPointInQuietZone(sp.x, sp.z)) return {ok: false, code: 'QUIET_ZONE_BLOCKED'}
    const y = env?.supportYAt?.(sp.x, sp.z, sp.y) ?? sp.y
    const instanceId = `test-ride:${modelId}`
    despawnTestRideMesh()
    const mesh = buildPersonalOrTestMesh(
      'test_ride',
      instanceId,
      modelId,
      sp.x,
      y,
      sp.z,
      sp.yaw,
      100,
      100,
      {motorLevel: 0, controllerLevel: 0, batteryLevel: 0},
      def.defaultVisual,
    )
    activeTestRideMesh = mesh
    const startedAt = Date.now()
    const expiresAt = startedAt + ECONOMY_CONSTANTS.TEST_RIDE_DURATION_MS
    setActiveTestRideState({
      shopId,
      modelId,
      instanceId,
      startedAt,
      expiresAt,
      origin: [sp.x, sp.z],
      maxRadiusM: ECONOMY_CONSTANTS.TEST_RIDE_MAX_RADIUS_M,
      outOfBoundsSince: null,
    })
    mountBikeMesh(mesh, true)
    emit({type: 'testride:start', shopId, modelId, expiresAt})
    return {ok: true, code: 'OK', instanceId, expiresAt}
  }

  function endTestRide(
    reason: 'timeout' | 'out_of_bounds' | 'user' | 'dismount_far' | 'mode_switch' | 'purchase',
  ): boolean {
    const tr = getState().garage.activeTestRide
    if (!tr && !activeTestRideMesh) return false
    const modelId = tr?.modelId ?? ((activeTestRideMesh?.userData.modelId as PersonalEbikeModelId | undefined) ?? 'lijiang_light')
    if (bike && bike === activeTestRideMesh) {
      land(bike.position.x, bike.position.z, bikeCtrl.heading, bike.position.y)
    }
    despawnTestRideMesh()
    setActiveTestRideState(null)
    delete document.body.dataset.ebikeTier
    delete document.body.dataset.rideType
    delete document.body.dataset.vehicleOwnership
    syncHud()
    emit({type: 'testride:end', modelId, reason})
    return true
  }

  function advance(dt: number) {
    const leg = data.routes[route]
    const mesh = vessels[route]
    let distance = 2 * dt
    while (segment < leg.path.length) {
      const [x, y, z] = leg.path[segment]
      const dx = x - mesh.position.x
      const dz = z - mesh.position.z
      const gap = Math.hypot(dx, dz)
      heading = Math.atan2(-dx, -dz)
      mesh.rotation.y = heading
      if (distance < gap) {
        mesh.position.lerp(new T.Vector3(x, y, z), distance / gap)
        return
      }
      mesh.position.set(x, y, z)
      distance -= gap
      segment++
    }
    const [x, , z] = data.docks[leg.end]
    const departures2 = data.routes.filter(other => other.start === leg.end && other.kind === leg.kind)
    const next = data.routes.indexOf(departures2.find(other => other.end !== leg.start) ?? departures2[0])
    if (disembark || next < 0) {
      if (land(x, z)) reset()
      return
    }
    if (next >= 0) {
      mesh.position.fromArray(leg.path[0])
      route = next
      segment = 1
    }
  }

  return {
    nearby,
    advance,
    interact,
    get lastInteractDecision() { return lastDecision },
    get car() { return car },
    get bike() { return bike },
    get rideKind(): RideKind | null { return bike ? bikeCtrl.kind : null },
    get vehicleType(): EbikeVehicleType | null { return bike && bikeCtrl.kind === 'bike' ? bikeCtrl.vehicleType : null },
    get isShared() { return bike && bikeCtrl.kind === 'bike' ? bikeCtrl.isShared : false },
    get bikeOwnership(): VehicleOwnership | null { return bike ? ((bike.userData.ownership as VehicleOwnership | undefined) ?? 'shared') : null },
    get bikeInstanceId(): string | null { return bike ? ((bike.userData.instanceId as string | undefined) ?? null) : null },
    get bikeModelId(): PersonalEbikeModelId | null { return bike ? ((bike.userData.modelId as PersonalEbikeModelId | undefined) ?? null) : null },
    get ebikeTier(): EbikeTier | null { return bike && bikeCtrl.kind === 'bike' ? bikeCtrl.tier : null },
    get ebikeGear() { return bike ? bikeCtrl.gear : 2 },
    get ebikeBattery() { return bike && bikeCtrl.kind === 'bike' ? bikeCtrl.batteryPct : 100 },
    get ebikeTelemetry(): EbikeDynamicTelemetry | null { return bike ? bikeCtrl.telemetry() : null },
    get carTelemetry(): CarDynamicTelemetry | null { return car ? carCtrl.telemetry() : null },
    get carVelX() { return carCtrl.velX },
    get carVelZ() { return carCtrl.velZ },
    get carRoll() { return carCtrl.roll },
    get carDynPitch() { return carCtrl.dynPitch },
    get carDrift() { return carCtrl.driftIntensity },
    get carHandbrake() { return carCtrl.handbrake },
    get boat() { return freeBoats?.boat ?? (route >= 0 ? vessels[route] : null) },
    get freeBoat() { return freeBoats?.boat ?? null },
    get freeKind() { return freeBoats?.boatKind ?? null },
    get boatSeatOffset() { return freeBoats?.active ? freeBoats.seatOffset : (route >= 0 && vessels[route].name === 'raft' ? -0.44 : -0.18) },
    get heading() { return car ? carCtrl.heading : bike ? bikeCtrl.heading : freeBoats?.active ? freeBoats.heading : heading },
    get speed() { return car ? carCtrl.speed : bike ? bikeCtrl.speed : freeBoats?.active ? freeBoats.speed : 0 },
    get lean() { return bikeCtrl.lean },
    get pitch() { return car ? carCtrl.pitch : bikeCtrl.pitch },
    get steerInput() { return car ? carCtrl.steerInput : bikeCtrl.steerInput },
    get bikePitch() { return lastBike?.rotation.x ?? 0 },
    get bikeY() { return lastBike?.position.y ?? 0 },
    get carPitch() { return lastCar?.rotation.x ?? 0 },
    get carY() { return lastCar?.position.y ?? 0 },
    show(on: boolean) {
      if (!on && getState().garage.activeTestRide) endTestRide('mode_switch')
      reset()
      interactRing.visible = false
      document.body.removeAttribute('data-aboard')
      delete document.body.dataset.ebikeTier
      delete document.body.dataset.rideType
      delete document.body.dataset.vehicleOwnership
      delete button.dataset.ebikeTier
      delete button.dataset.interact
      active = group.visible = on
      button.hidden = true
      if (!on) {
        button.textContent = ''
        lastBike = null
        lastCar = null
      }
    },
    stop() { carCtrl.stop(); bikeCtrl.stop(); freeBoats?.stop() },
    dampSpeed(stepDt: number) { return bikeCtrl.dampSpeed(stepDt) },
    dampCarSpeed(stepDt: number) { return carCtrl.dampSpeed(stepDt) },
    capSpeed(stepDt: number, limit: number) { return bikeCtrl.capSpeed(stepDt, limit) },
    setPitch(frontY: number | undefined, backY: number | undefined, dt: number) { bikeCtrl.setPitch(frontY, backY, dt) },
    setCarPitch(frontY: number | undefined, backY: number | undefined, dt: number) { carCtrl.setPitch(frontY, backY, dt) },
    setCarMode(mode: CarDriveMode) { return carCtrl.setMode(mode) },
    setCarModeByIndex(idx: number) { return carCtrl.setModeByIndex(idx) },
    shiftCarMode(delta: number) { return carCtrl.shiftMode(delta) },
    setCarGtaPhysics(on: boolean) { carCtrl.setGtaPhysics(on) },
    consumeCarImpact() { return carCtrl.consumeImpactPulse() },
    setEbikeGear(gear: number) { return bike ? bikeCtrl.setGear(gear) : 2 },
    shiftEbikeGear(delta: number) { return bike ? bikeCtrl.shiftGear(delta) : 2 },
    resetEbikeGearOnRecover() { return bike ? bikeCtrl.resetGearToCompliant() : 2 },
    setAutoCrash(on: boolean | undefined) { bikeCtrl.setAutoCrash(on) },
    setEbikePark(on: boolean, silent = false) { return bike ? bikeCtrl.setPark(on, silent) : false },
    toggleEbikePark(silent = false) { return bike ? bikeCtrl.togglePark(silent) : false },
    setEbikeKickstand(on: boolean, silent = false) { return bike ? bikeCtrl.setKickstand(on, silent) : false },
    toggleEbikeKickstand(silent = false) { return bike ? bikeCtrl.toggleKickstand(silent) : false },
    setEbikeHeadlight(mode: EbikeHeadlightMode, manual = true) { return bike ? bikeCtrl.setHeadlight(mode, manual) : 'off' },
    cycleEbikeHeadlight() { return bike ? bikeCtrl.cycleHeadlight() : 'off' },
    setEbikeEnvironmentHour(hour: number) { if (bike) bikeCtrl.setEnvironmentHour(hour) },
    setEbikeTurnSignal(dir: EbikeTurnSignal) { return bike ? bikeCtrl.setTurnSignal(dir) : 'off' },
    toggleEbikeTurnSignal(dir: Exclude<EbikeTurnSignal, 'off'>) { return bike ? bikeCtrl.toggleTurnSignal(dir) : 'off' },
    setEbikeHazard(on: boolean) { return bike ? bikeCtrl.setHazard(on) : false },
    toggleEbikeHazard() { return bike ? bikeCtrl.toggleHazard() : false },
    setEbikeHorn(pressed: boolean) { return bike ? bikeCtrl.setHorn(pressed) : false },
    pulseEbikeHorn() { return bike ? bikeCtrl.pulseHorn() : 0 },
    setEbikeCruise(on: boolean, silent = false) { return bike ? bikeCtrl.setCruise(on, silent) : false },
    toggleEbikeCruise(silent = false) { return bike ? bikeCtrl.toggleCruise(silent) : false },
    dismountDownedBike,
    relocateParkedBike,
    summonPersonalBike,
    spawnPersonalBikeAtBay,
    refreshPersonalBikeVisual,
    startTestRide,
    endTestRide,
    applyPersonalCrashDamage(severity: number) {
      if (!bike || bike.userData.ownership !== 'personal') return
      const id = bike.userData.instanceId as string | undefined
      if (!id) return
      const cur = (bike.userData.durability as number | undefined) ?? getState().garage.vehicles[id]?.durabilityPct ?? 100
      const loss = Math.max(6, Math.min(18, Math.round(6 + severity * 10)))
      const nextDur = Math.max(15, cur - loss)
      bike.userData.durability = nextDur
      const modelId = bike.userData.modelId as PersonalEbikeTierId | undefined
      if (modelId) bikeCtrl.setPersonalModel(modelId, nextDur)
      syncPersonalVehicleTelemetry(id, {durabilityPct: nextDur}, true)
    },
    setEbikeVehicleType(nextType: EbikeVehicleType) {
      if (!bike || bikeCtrl.kind !== 'bike') return null
      const profile = bikeCtrl.setVehicleType(nextType)
      saveBikeInstanceState(bike)
      syncHud()
      return profile
    },
    setEbikeUpgrades(mods: EbikeUpgradeMods | null): ResolvedEbikeProfile | null {
      if (!bike || bikeCtrl.kind !== 'bike') return null
      const next = bikeCtrl.setUpgrades(mods)
      saveBikeInstanceState(bike)
      return next
    },
    setEbikeBattery(pct: number) {
      if (!bike || bikeCtrl.kind !== 'bike') return 100
      const next = bikeCtrl.setBattery(pct)
      saveBikeInstanceState(bike)
      return next
    },
    rechargeEbike(pct = 100) {
      if (!bike || bikeCtrl.kind !== 'bike') return 100
      const next = bikeCtrl.setBattery(pct)
      saveBikeInstanceState(bike)
      return next
    },
    resolveMove(ctx: Parameters<typeof bikeCtrl.resolveMove>[0]) { return bikeCtrl.resolveMove(ctx) },
    resolveCarMove(ctx: Parameters<typeof carCtrl.resolveMove>[0]) { return carCtrl.resolveMove(ctx) },
    steer(forward: number, right: number, dt: number, mounted = true, control?: EbikeStepControl) {
      const spd = bikeCtrl.steer(forward, right, dt, mounted, control)
      if (bike && bikeCtrl.kind === 'bike') {
        bike.userData.battery = bikeCtrl.batteryPct
        const ownership = (bike.userData.ownership as VehicleOwnership | undefined) ?? 'shared'
        if (ownership === 'personal') {
          const id = bike.userData.instanceId as string | undefined
          if (id) {
            const distKm = (Math.abs(spd) * dt) / 1000
            syncPersonalVehicleTelemetry(id, {batteryPct: bikeCtrl.batteryPct, odometerDeltaKm: distKm}, false)
          }
        } else if (ownership === 'shared' && bikeCtrl.vehicleType === 'shared' && Math.abs(spd) > 0.4) {
          sharedRideElapsedSec += dt
          if (!sharedRideBilled && sharedRideElapsedSec >= ECONOMY_CONSTANTS.SHARED_BIKE_FREE_GRACE_SEC) {
            sharedRideBilled = true
            const res = chargeSharedBikeRental(`shared_ride_${sharedRideSessionId}`)
            if (res.ok && res.charged > 0) {
              window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text: `共享电车已扣费 ¥${res.charged}（前 120 秒免费）`, ms: 2400}}))
            } else if (res.code === 'INSUFFICIENT_FUNDS') {
              window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text: '余额不足 ¥3，可改骑免费人力单车或步行接近单赚钱', ms: 2600}}))
            }
          }
        }
      }
      return spd
    },
    steerCar(forward: number, right: number, dt: number, mounted = true, control?: CarStepControl) { return carCtrl.steer(forward, right, dt, mounted, control) },
    steerBoat(forward: number, right: number, dt: number) { freeBoats?.steer(forward, right, dt) },
    poseBoat(figure: T.Group, forward: number, right: number, dt: number) { freeBoats?.pose(figure, forward, right, dt) },
    clearBoatPose(figure: T.Group) { freeBoats?.clearPoseJoints(figure) },
    boatClearance(figure: T.Group, skinned?: T.SkinnedMesh) { return freeBoats?.clearance(figure, skinned) ?? null },
    boatProbe() { return freeBoats?.probe() ?? null },
    freeMoorings() { return freeBoats?.moorings() ?? [] },
    parked(kind?: RideKind | 'car'): Position[] {
      const out: Position[] = []
      for (const cell of cells.values()) {
        for (const child of cell.children) {
          if (!kind || child.name === kind) out.push([child.position.x, child.position.y, child.position.z])
        }
      }
      return out
    },
    parkedBikes() {
      const out: {x: number; y: number; z: number; paint: number; vehicleType: EbikeVehicleType; tier: EbikeTier; batteryPct: number; ownership: VehicleOwnership}[] = []
      for (const cell of cells.values()) {
        for (const child of cell.children) {
          if (child.name !== 'bike') continue
          const paint = (child.userData.paint as number | undefined) ?? 0
          const saved = bikeStates.get(child) ?? bikeCoordStates.get(bikeCoordKey(child.position.x, child.position.z))
          const vehicleType = saved?.vehicleType ?? resolveEbikeKind(paint, child.userData.vehicleType ?? child.userData.ebikeTier)
          out.push({
            x: child.position.x,
            y: child.position.y,
            z: child.position.z,
            paint,
            vehicleType,
            tier: vehicleType,
            batteryPct: saved?.batteryPct ?? 100,
            ownership: saved?.ownership ?? 'shared',
          })
        }
      }
      return out
    },
    park(pos: T.Vector3) {
      if (car) {
        car.position.copy(pos)
        car.rotation.set(carCtrl.pitch, carCtrl.heading, carCtrl.roll, 'YXZ')
      }
      if (bike) {
        bike.position.copy(pos)
        bike.rotation.set(bikeCtrl.pitch, bikeCtrl.heading, bikeCtrl.lean, 'YXZ')
      }
    },
    pavement,
    motorPavement,
    dispose() {
      window.removeEventListener('keydown', onKeyF)
      button.remove()
    },
  }
}
