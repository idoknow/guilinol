import * as T from 'three'
import {pickups} from '../traffic/contact'
import type {Stream} from '../stream'
import type {ParkedBike} from '../batch'
import {onJiefangJunction} from '../game/car-free'
import {CAR_SCALE} from '../drive/scale'
import {ParkedBatches, parkedParts} from './parked-batches'
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
import {KICKSTAND_REST_ROLL_RAD} from './ebike-state-coupling'
import type {BoatCandidateSnapshot, VehicleCandidateSnapshot} from './interact-arbiter'
import {soloServices} from '../game/play-mode'
import {PERSONAL_EBIKE_MODELS} from '../game/catalog'
import {getShop} from '../game/shops'
import {isPointInQuietZone} from '../game/quiet-zones'
import {emit, getState, setActiveTestRide, setActiveWorldInstanceId, setSummonCooldownUntil,
  type PersistedEbikeVisual, type PersonalEbikeModelId, type VehicleOwnership} from '../game/state'
import {requestSharedEbikeReturn, requestSharedEbikeUnlock} from './shared-ebike-unlock'

const SUMMON_COOLDOWN_MS = 10_000
const TEST_RIDE_DURATION_MS = 90_000
const TEST_RIDE_MAX_RADIUS_M = 350

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

const ROADSIDE_BATTERY_KEY = 'glol.ebike.batteries.v1'
const MAX_PERSISTED_BATTERIES = 50
const bikeCoordKey = (x: number, z: number) => `${Math.round(x * 10)},${Math.round(z * 10)}`
const isVerifySilentMode = () =>
  typeof location !== 'undefined' && (() => {
    const p = new URLSearchParams(location.search)
    return p.has('verify') && p.get('stunt') !== '1'
  })()

function computeWorldVehiclesVersion(buffer: ArrayBuffer, bikesCount: number) {
  const bytes = new Uint8Array(buffer)
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return `v1:${bytes.length}:${bikesCount}:${(h >>> 0).toString(16)}`
}
type Physics = Awaited<ReturnType<typeof createPhysics>>
export type FreeDismountTarget = {x: number; y: number; z: number; rule: string; heading: number}
export interface VehiclesEnv {
  sim: Physics
  stream: Stream
  landFree: (spot: FreeDismountTarget) => boolean
  actionButton?: HTMLButtonElement
  externalArbiter?: boolean
  isFootAnimBusy?: () => boolean
  supportYAt?: (x: number, z: number, refY: number) => number
}
export interface VehicleInteractSnapshot {
  aboardKind: 'car' | 'bike' | 'bicycle' | 'free_boat' | 'tour_boat' | null
  tourDisembarkQueued: boolean
  nearDownedVehicle: VehicleCandidateSnapshot | null
  nearVehicle: VehicleCandidateSnapshot | null
  nearBoat: BoatCandidateSnapshot | null
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
  maskEncoding?: 'gzip'
  motorMask?: string
}

async function roadBits(encoded: string, encoding?: 'gzip') {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  if (!encoding) return bytes
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
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
  const worldVersion = computeWorldVehiclesVersion(buffer, data.bikes.length)
  const persistedBatteries = new Map<string, number>()
  function loadPersistedBatteries() {
    persistedBatteries.clear()
    if (isVerifySilentMode() || typeof localStorage === 'undefined') return
    try {
      const raw = localStorage.getItem(ROADSIDE_BATTERY_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as {worldVersion?: string; entries?: Array<{k?: string; b?: number}>}
      if (parsed.worldVersion !== worldVersion || !Array.isArray(parsed.entries)) {
        localStorage.removeItem(ROADSIDE_BATTERY_KEY)
        return
      }
      for (const item of parsed.entries.slice(-MAX_PERSISTED_BATTERIES)) {
        if (item && typeof item.k === 'string' && typeof item.b === 'number' && Number.isFinite(item.b)) {
          const b = T.MathUtils.clamp(Math.round(item.b * 10) / 10, 0, 100)
          if (b < 99.95) persistedBatteries.set(item.k, b)
        }
      }
    } catch {}
  }
  let lastBatteryFlushAt = 0
  function flushPersistedBatteries() {
    if (isVerifySilentMode() || typeof localStorage === 'undefined') return
    lastBatteryFlushAt = performance.now()
    try {
      const entries = Array.from(persistedBatteries.entries())
        .slice(-MAX_PERSISTED_BATTERIES)
        .map(([k, b]) => ({k, b: Math.round(b * 10) / 10}))
      localStorage.setItem(ROADSIDE_BATTERY_KEY, JSON.stringify({worldVersion, entries}))
    } catch {}
  }
  function persistRoadsideBattery(spawnKey: string | undefined, pct: number, immediate = true) {
    if (!spawnKey || isVerifySilentMode()) return
    const b = T.MathUtils.clamp(Math.round(pct * 10) / 10, 0, 100)
    const prev = persistedBatteries.get(spawnKey)
    if (!immediate && ((b < 99.95 && prev === b) || (b >= 99.95 && prev === undefined))) return
    persistedBatteries.delete(spawnKey)
    if (b < 99.95) {
      persistedBatteries.set(spawnKey, b)
      while (persistedBatteries.size > MAX_PERSISTED_BATTERIES) {
        const oldest = persistedBatteries.keys().next().value
        if (oldest === undefined) break
        persistedBatteries.delete(oldest)
      }
    }
    if (immediate || performance.now() - lastBatteryFlushAt >= 800) {
      flushPersistedBatteries()
    }
  }
  loadPersistedBatteries()

  const mask = await roadBits(data.mask, data.maskEncoding)
  const [left, top, width, height, step] = data.grid
  const group = new T.Group()
  scene.add(group)
  const mMask = data.motorMask ? await roadBits(data.motorMask, data.maskEncoding) : mask
  const [mLeft, mTop, mWidth, mHeight, mStep] = data.motorGrid ?? data.grid
  type Spawn = {kind: 'bike' | 'bicycle' | 'car'; row: Data['bikes'][number]; shared: boolean; spawnKey?: string; pickup?: () => void}
  type ParkingCell = {pending: Spawn[]; group?: T.Group}
  const cells = new Map<string, ParkingCell>()
  const visibleCells = new Set<T.Group>()
  const cellSize = 128
  const bikeStates = new WeakMap<T.Object3D, BikeInstanceState>()
  const bikeCoordStates = new Map<string, BikeInstanceState>()
  const makeVehicleMesh = vehicleModel as (
    kind: string,
    paint?: number,
    options?: {shared?: boolean; visual?: Partial<PersistedEbikeVisual>},
  ) => T.Mesh

  let activePersonalMesh: T.Mesh | null = null
  let activeTestRideMesh: T.Mesh | null = null
  let sharedRideSessionId = 0
  const sharedUnlockBootNonce = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  type UnlockedSharedSession = {
    sessionKey: string
    bikeId: string
    mesh: T.Object3D | null
    decorId?: string
  }
  let activeUnlockedShared: UnlockedSharedSession | null = null

  const isSoloActive = () => Boolean(soloServices())
  function resolveEffectiveRoadsideType(
    paint: number,
    ownership: VehicleOwnership,
    savedType?: EbikeVehicleType,
    explicitType?: unknown,
  ): EbikeVehicleType {
    if (ownership === 'personal' || ownership === 'test_ride') return 'normal'
    if (isSoloActive()) return 'shared'
    return savedType ?? resolveEbikeKind(paint, explicitType as EbikeVehicleType | 'normal' | 'shared' | undefined)
  }
  function isTargetSharedUnlocked(target: T.Object3D | null): boolean {
    if (!target || !activeUnlockedShared) return false
    return (
      activeUnlockedShared.mesh === target ||
      (typeof target.userData.sharedUnlockSession === 'string' &&
        target.userData.sharedUnlockSession === activeUnlockedShared.sessionKey)
    )
  }
  function clearUnlockedSharedSession(): void {
    if (!activeUnlockedShared) return
    const prev = activeUnlockedShared
    activeUnlockedShared = null
    if (prev.mesh?.userData) delete prev.mesh.userData.sharedUnlockSession
    requestSharedEbikeReturn({
      bikeId: prev.bikeId,
      sessionKey: prev.sessionKey,
      soloEnabled: isSoloActive(),
    })
  }

  const parkedCells = new WeakMap<T.Group, ParkedBatches>()
  const pickupHandles=new WeakMap<T.Object3D,()=>void>()
  const models = new Map<string, ReturnType<typeof parkedParts>>()

  function marker(kind: string, paint: number, shared = false) {
    const key = `${kind}:${paint}:${shared}`
    if (!models.has(key)) models.set(key, parkedParts(makeVehicleMesh(kind, paint, {shared})))
    const record = new T.Object3D()
    record.name = kind
    record.userData = {parkedModel: key, paint, shared}
    return record
  }

  function takeRecord(record: T.Object3D) {
    pickupHandles.get(record)?.()
    if (record instanceof T.Mesh) return record
    const mesh = makeVehicleMesh(record.name, record.userData.paint, {shared: record.userData.shared})
    mesh.position.copy(record.position)
    mesh.quaternion.copy(record.quaternion)
    Object.assign(mesh.userData, record.userData)
    const saved = bikeStates.get(record)
    if (saved) bikeStates.set(mesh, saved)
    const cell = record.parent as T.Group
    cell.remove(record)
    refreshBatch(cell)
    return mesh
  }

  function refreshBatch(cell: T.Group) {
    const visible = new Map<string, T.Object3D[]>()
    for (const record of cell.children) {
      const key = record.userData.farModel || record.userData.parkedModel
      if (!record.visible || !key || record instanceof T.Mesh) continue
      const records = visible.get(key)
      if (records) records.push(record)
      else visible.set(key, [record])
    }
    parkedCells.get(cell)!.sync(visible, models)
  }

  function parkingCell(x: number, z: number) {
    const key = `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`
    let cell = cells.get(key)
    if (!cell) {
      cell = {pending: []}
      cells.set(key, cell)
    }
    return cell
  }

  function store(mesh: T.Object3D, pickup?: () => void) {
    if (mesh.name === 'car') {
      pickupHandles.set(mesh, pickup ?? pickups.add({...mesh.position, yaw: mesh.rotation.y, halfWidth: .9 * CAR_SCALE, halfLength: 2.12 * CAR_SCALE, height: 1.5}))
    }
    const cell = parkingCell(mesh.position.x, mesh.position.z)
    if (!cell.group) {
      cell.group = new T.Group()
      parkedCells.set(cell.group, new ParkedBatches())
    }
    mesh.updateMatrix()
    cell.group.add(mesh)
  }

  function detachMeshFromCells(mesh: T.Mesh | null) {
    if (!mesh) return
    const oldKey = mesh.userData.coordKey as string | undefined
    if (oldKey) bikeCoordStates.delete(oldKey)
    const curKey = bikeCoordKey(mesh.position.x, mesh.position.z)
    if (curKey !== oldKey && bikeCoordStates.get(curKey) === bikeStates.get(mesh)) {
      bikeCoordStates.delete(curKey)
    }
    bikeStates.delete(mesh)
    mesh.parent?.remove(mesh)
  }

  function addBike(x: number, y: number, z: number, angle: number, paint: number, explicitType?: EbikeVehicleType, spawnCoordKey = bikeCoordKey(x,z)) {
    const vehicleType = resolveEffectiveRoadsideType(paint, 'shared', undefined, explicitType)
    const isShared = vehicleType === 'shared'
    const mesh = marker('bike', paint, isShared)
    mesh.position.set(x, y, z)
    mesh.rotation.y = angle
    const restoredBattery = persistedBatteries.get(spawnCoordKey) ?? 100
    mesh.userData.paint = paint
    mesh.userData.shared = isShared
    mesh.userData.vehicleType = vehicleType
    mesh.userData.ebikeTier = vehicleType
    mesh.userData.ownership = 'shared' as VehicleOwnership
    mesh.userData.battery = restoredBattery
    mesh.userData.durability = 100
    mesh.userData.coordKey = spawnCoordKey
    mesh.userData.spawnCoordKey = spawnCoordKey
    const state: BikeInstanceState = {
      vehicleType,
      ownership: 'shared',
      batteryPct: restoredBattery,
      durabilityPct: 100,
      mods: null,
    }
    bikeStates.set(mesh, state)
    bikeCoordStates.set(spawnCoordKey, state)
    store(mesh)
  }

  const occupiedBays = new Set([...data.bikes,...(data.sharedBikes??[])].map(([x,,z])=>bikeCoordKey(x,z)))
  function queueSpawns(kind: Spawn['kind'], rows: Data['bikes'], shared = false) {
    for (const original of rows) {
      const row = [...original] as Spawn['row']
      const spawnKey = bikeCoordKey(row[0],row[2])
      if (kind === 'bike' && (!pavement(row[0],row[2]) || motorPavement(row[0],row[2]))) {
        let best = Infinity
        for (let dc=-9; dc<=9; dc++) for (let dr=-9; dr<=9; dr++) {
          const x = original[0] + dc*step, z = original[2] + dr*step
          const d = dc*dc + dr*dr
          if (d < best && pavement(x,z) && !motorPavement(x,z) && !occupiedBays.has(bikeCoordKey(x,z))) { row[0]=x; row[2]=z; best=d }
        }
      }
      const [x, y, z, yaw] = row
      if (kind==='bike') occupiedBays.add(bikeCoordKey(x,z))
      // Traffic queries these solids even when the player cannot see the parked cars.
      const pickup = kind === 'car' ? pickups.add({x, y, z, yaw, halfWidth: .9 * CAR_SCALE, halfLength: 2.12 * CAR_SCALE, height: 1.5}) : undefined
      parkingCell(x, z).pending.push({kind, row, shared, pickup, spawnKey})
    }
  }

  function loadParkingCell(cell: ParkingCell) {
    if (cell.pending.length === 0) return cell.group!
    for (const {kind, row, shared, pickup, spawnKey} of cell.pending) {
      const [x, y, z, angle, paint] = row
      if (kind === 'bike') {
        addBike(x, y, z, angle, paint, shared ? 'shared' : undefined, spawnKey)
      } else {
        const mesh = marker(kind, paint)
        mesh.position.set(x, y, z)
        mesh.rotation.y = angle
        store(mesh, pickup)
      }
    }
    cell.pending.length = 0
    cell.group!.userData.batchReady = false
    return cell.group!
  }

  queueSpawns('bike', data.bikes)
  queueSpawns('bike', data.sharedBikes ?? [], true)
  queueSpawns('bicycle', data.bicycles ?? [])
  queueSpawns('car', data.cars ?? [])

  const {routes, docks} = data
  const vessels = routes.map(route => {
    const pink = route.kind === 'boat' && [route.start, route.end].includes('桂湖')
    const mesh = vehicleModel(route.kind, pink ? 1 : 0)
    mesh.position.fromArray(route.path[0])
    group.add(mesh)
    return mesh
  })
  const piers = new Map<string, T.Mesh>()
  const pierShape = new T.BoxGeometry(1, 1, 1)
  const pierMaterial = new T.MeshStandardMaterial({color: 0x816a50})
  for (const leg of routes) {
    if (piers.has(leg.start)) continue
    const [x, , z] = docks[leg.start]
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
  const moored = routes.map(leg => {
    const first = !departures.has(leg.start)
    departures.add(leg.start)
    return first
  })
  const freeBoats = env ? createFreeBoats({group, docks, routes, sim: env.sim, stream: env.stream}) : null

  const ringMat = new T.MeshBasicMaterial({color: 0xd86b4a, transparent: true, opacity: 0.45, depthWrite: false, side: T.DoubleSide, fog: false})
  const interactRing = new T.Mesh(new T.RingGeometry(0.86, 1.08, 32).rotateX(-Math.PI / 2), ringMat)
  interactRing.renderOrder = 4
  interactRing.visible = false
  group.add(interactRing)

  const button =
    env?.actionButton ??
    document.querySelector<HTMLButtonElement>('.vehicle-action') ??
    (() => {
      const b = document.createElement('button')
      b.className = 'vehicle-action'
      b.setAttribute('aria-keyshortcuts', 'F')
      b.hidden = true
      document.body.append(b)
      return b
    })()
  let externalArbiter = !!env?.externalArbiter

  const bikeCtrl = createBikeControl()
  const carCtrl = createCarControl()
  let bike: T.Mesh | null = null
  let lastBike: T.Mesh | null = null
  let car: T.Mesh | null = null
  let lastCar: T.Mesh | null = null
  let route = -1
  let nearBike: T.Object3D | null = null
  let nearBikeDist = Infinity
  let nearDecor: ParkedBike | null = null
  let decorDistance = Infinity
  let nearDownedBike: T.Object3D | null = null
  let nearDownedDist = Infinity
  let nearRoute = -1
  let nearRouteDist = Infinity
  let segment = 1
  let disembark = false
  let active = false
  let heading = 0
  let nearFree: {slot: MooringSlot | null; distance: number; atBank: boolean} = {slot: null, distance: Infinity, atBank: false}

  function syncHud() {
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
    if (externalArbiter) return
    const preferFree = !!nearFree.slot && (nearRoute < 0 || nearFree.distance + 1 < nearRouteDist)
    const freePrompt = nearFree.slot ? (nearFree.slot.kind === 'freeRaft' ? '划竹筏 · ' : '划小船 · ') + nearFree.slot.name : ''
    const activeTarget = nearDownedBike ?? nearBike
    const targetOwnership: VehicleOwnership | undefined = activeTarget
      ? ((activeTarget.userData.ownership as VehicleOwnership | undefined) ?? (activeTarget.name === 'bike' ? 'shared' : undefined))
      : nearDecor
        ? 'shared'
        : undefined
    const targetUnlocked = activeTarget ? isTargetSharedUnlocked(activeTarget) : false
    const ridePrompt = activeTarget
      ? activeTarget.name === 'car'
        ? '开车'
        : activeTarget.userData.downed
          ? activeTarget.name === 'bicycle'
            ? '扶起单车'
            : '扶起电动车'
          : activeTarget.name === 'bicycle'
            ? '骑单车'
            : activeTarget.userData.ownership === 'personal'
              ? '骑我的电摩'
              : isSoloActive() && targetOwnership !== 'test_ride'
                ? targetUnlocked
                  ? '继续骑共享电车'
                  : '解锁共享电动车（¥2）'
                : '骑电动车'
      : nearDecor
        ? isSoloActive()
          ? '解锁共享电动车（¥2）'
          : '骑电动车'
        : ''
    const crashedRide = document.body.dataset.rideCrash === '1'
    const label = car
      ? '下车'
      : bike
        ? crashedRide
          ? ''
          : '下车'
        : freeBoats?.active
          ? '靠岸下船'
          : route >= 0
            ? disembark
              ? '下一站下船'
              : '下站下船'
            : ridePrompt || (preferFree ? freePrompt : nearRoute >= 0 ? '上船 · ' + routes[nearRoute].start : '')
    if (activeTarget?.name === 'bike') {
      const targetOwn = (activeTarget.userData.ownership as VehicleOwnership | undefined) ?? 'shared'
      button.dataset.ebikeTier = resolveEffectiveRoadsideType(
        (activeTarget.userData.paint as number | undefined) ?? 0,
        targetOwn,
        activeTarget.userData.vehicleType as EbikeVehicleType | undefined,
        activeTarget.userData.ebikeTier,
      )
    } else if (nearDecor) {
      button.dataset.ebikeTier = 'shared'
    } else {
      delete button.dataset.ebikeTier
    }
    button.hidden = !label
    if (button.textContent !== label) button.textContent = label
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
    const spawnCoordKey = (mesh.userData.spawnCoordKey as string | undefined) ?? oldKey ?? newKey
    mesh.userData.spawnCoordKey = spawnCoordKey
    bikeCoordStates.set(newKey, state)

    if (ownership === 'personal' && instanceId) {
      soloServices()?.commerce.updatePersonalVehicleTelemetry(instanceId, {batteryPct: state.batteryPct, durabilityPct}, true)
    } else if (ownership === 'shared') {
      persistRoadsideBattery(spawnCoordKey, state.batteryPct, true)
    }
  }

  function attachMeshToCell(mesh: T.Mesh) {
    let record: T.Object3D = mesh
    if (mesh.userData.parkedModel && !mesh.userData.downed) {
      record = marker(mesh.name, mesh.userData.paint, mesh.userData.shared)
      record.position.copy(mesh.position)
      record.quaternion.copy(mesh.quaternion)
      Object.assign(record.userData, mesh.userData)
      const saved = bikeStates.get(mesh)
      if (saved) bikeStates.set(record, saved)
      mesh.removeFromParent()
    }
    if (activeUnlockedShared && record.userData.sharedUnlockSession === activeUnlockedShared.sessionKey) {
      activeUnlockedShared.mesh = record
    }
    store(record)
    const cell = record.parent as T.Group
    if (active && !visibleCells.has(cell)) {
      visibleCells.add(cell)
      group.add(cell, parkedCells.get(cell)!.view)
    }
    refreshBatch(cell)
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
    const mesh = makeVehicleMesh('bike', paintIdx, {visual})
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
      soloServices()?.commerce.updatePersonalVehicleTelemetry(id, {batteryPct: saved.batteryPct, durabilityPct: saved.durabilityPct}, true)
    }
    if (bike === activePersonalMesh) bike = null
    if (lastBike === activePersonalMesh) lastBike = null
    if (nearBike === activePersonalMesh) nearBike = null
    if (nearDownedBike === activePersonalMesh) nearDownedBike = null
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
    if (nearDownedBike === activeTestRideMesh) nearDownedBike = null
    detachMeshFromCells(activeTestRideMesh)
    activeTestRideMesh = null
  }

  function reset() {
    if (route >= 0) vessels[route].position.fromArray(routes[route].path[0])
    freeBoats?.reset()
    if (car) {
      car.rotation.set(carCtrl.pitch, carCtrl.heading, 0, 'YXZ')
      attachMeshToCell(car)
    }
    if (bike) {
      delete bike.userData.sharedUnlockSession
      const isEbike = bikeCtrl.kind === 'bike'
      saveBikeInstanceState(bike, {parkLocked: isEbike, kickstandDown: true})
      bike.rotation.set(bikeCtrl.pitch, bikeCtrl.heading, isEbike ? KICKSTAND_REST_ROLL_RAD : 0, 'YXZ')
      if (bike.userData.decorId) bike.userData.parkedModel = 'bike:1:true'
      attachMeshToCell(bike)
    }
    car = null
    bike = null
    route = -1
    nearFree = {slot: null, distance: Infinity, atBank: false}
    disembark = false
    segment = 1
    clearUnlockedSharedSession()
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
      const prevOwnership = prev?.ownership ?? ((mesh.userData.ownership as VehicleOwnership | undefined) ?? 'shared')
      const nextState: BikeInstanceState = {
        vehicleType: resolveEffectiveRoadsideType((mesh.userData.paint as number | undefined) ?? 0, prevOwnership, prev?.vehicleType, mesh.userData.vehicleType ?? mesh.userData.ebikeTier),
        ownership: prevOwnership,
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

  function mountBikeMesh(target: T.Object3D, forceBoard = false): boolean {
    const prevKey = (target.userData.coordKey as string | undefined) ?? bikeCoordKey(target.position.x, target.position.z)
    const safePos =
      !forceBoard && board
        ? board(target.position.x, target.position.y, target.position.z)
        : {x: target.position.x, y: target.position.y, z: target.position.z, bikeY: target.position.y}
    if (!safePos) return false
    const preSaved = bikeStates.get(target) ?? bikeCoordStates.get(prevKey)
    const preOwnership: VehicleOwnership = (target.userData.ownership as VehicleOwnership | undefined) ?? preSaved?.ownership ?? 'shared'
    const preRideKind: RideKind = target.name === 'bicycle' ? 'bicycle' : 'bike'

    let unlockDecision: ReturnType<typeof requestSharedEbikeUnlock> | null = null
    let nextSessionSeq = sharedRideSessionId
    let unlockSessionKey = ''
    let unlockBikeId = ''
    let wasAlreadyUnlocked = false
    if (preRideKind === 'bike' && preOwnership === 'shared') {
      wasAlreadyUnlocked = isTargetSharedUnlocked(target)
      unlockBikeId = (target.userData.spawnCoordKey as string | undefined) ?? prevKey
      if (wasAlreadyUnlocked && activeUnlockedShared) {
        unlockSessionKey = activeUnlockedShared.sessionKey
      } else {
        nextSessionSeq = sharedRideSessionId + 1
        unlockSessionKey = `shared_unlock_${sharedUnlockBootNonce}_${nextSessionSeq}_${unlockBikeId}`
      }
      unlockDecision = requestSharedEbikeUnlock(
        {
          bikeId: unlockBikeId,
          sessionKey: unlockSessionKey,
          soloEnabled: isSoloActive(),
          alreadyUnlocked: wasAlreadyUnlocked,
        },
        soloServices()?.commerce.unlockSharedEbike,
      )
      if (!unlockDecision.ok) {
        if (unlockDecision.message) {
          window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text: unlockDecision.message, ms: 2600}}))
        }
        return false
      }
    } else {
      clearUnlockedSharedSession()
    }

    const targetMesh = takeRecord(target)
    targetMesh.position.set(safePos.x, safePos.bikeY, safePos.z)
    const rideKind: RideKind = targetMesh.name === 'bicycle' ? 'bicycle' : 'bike'
    const saved = bikeStates.get(targetMesh) ?? bikeCoordStates.get(prevKey)
    const ownership: VehicleOwnership = (targetMesh.userData.ownership as VehicleOwnership | undefined) ?? saved?.ownership ?? 'shared'
    const instanceId = (targetMesh.userData.instanceId as string | undefined) ?? saved?.instanceId
    const liveOwned = ownership === 'personal' && instanceId ? getState().garage.vehicles[instanceId] : undefined
    const vehicleType = resolveEffectiveRoadsideType(
      (targetMesh.userData.paint as number | undefined) ?? 0,
      ownership,
      saved?.vehicleType,
      targetMesh.userData.vehicleType ?? targetMesh.userData.ebikeTier,
    )
    const modelId = liveOwned?.modelId ?? saved?.modelId ?? (targetMesh.userData.modelId as PersonalEbikeModelId | undefined)
    const spawnCoordKey = (targetMesh.userData.spawnCoordKey as string | undefined) ?? prevKey
    targetMesh.userData.spawnCoordKey = spawnCoordKey
    const savedBat = liveOwned?.batteryPct ?? saved?.batteryPct ?? (targetMesh.userData.battery as number | undefined) ?? (ownership === 'shared' ? persistedBatteries.get(spawnCoordKey) : undefined) ?? 100
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
    if (rideKind === 'bike' && ownership === 'shared') {
      if (!wasAlreadyUnlocked) {
        clearUnlockedSharedSession()
        sharedRideSessionId = nextSessionSeq
      }
      bike.userData.sharedUnlockSession = unlockSessionKey
      activeUnlockedShared = {
        sessionKey: unlockSessionKey,
        bikeId: unlockBikeId,
        mesh: bike,
        decorId: bike.userData.decorId as string | undefined,
      }
      if (unlockDecision?.charged && unlockDecision.charged > 0 && unlockDecision.message) {
        window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text: unlockDecision.message, ms: 2400}}))
      }
    }
    saveBikeInstanceState(bike, {parkLocked: bikeCtrl.parkLocked, kickstandDown: bikeCtrl.kickstandDown})
    syncHud()
    return true
  }

  function interact() {
    if (!active) return
    if (car) {
      if (land(car.position.x, car.position.z, carCtrl.heading, car.position.y, 'car')) reset()
    } else if (bike) {
      if (land(bike.position.x, bike.position.z, bikeCtrl.heading, bike.position.y)) reset()
    } else if (freeBoats?.active) {
      const spot = freeBoats.dismount(docks, s => !!env?.landFree(s))
      if (spot) {
        nearFree = {slot: null, distance: Infinity, atBank: false}
        syncHud()
      }
    } else if (route >= 0) {
      disembark = true
    } else if (nearDownedBike) {
      const target = nearDownedBike
      const safePos = board
        ? board(target.position.x, target.position.y, target.position.z)
        : {x: target.position.x, y: target.position.y, z: target.position.z, bikeY: target.position.y}
      if (!safePos) return
    } else if (nearDecor && env) {
      const candidate = nearDecor
      if (!env.stream.batches.takeBike(candidate.id)) return
      const mesh = makeVehicleMesh('bike', 1, {shared: true})
      mesh.position.set(candidate.x, candidate.y, candidate.z)
      mesh.rotation.y = candidate.yaw
      mesh.userData.decorId = candidate.id
      mesh.userData.paint = 1
      mesh.userData.shared = true
      mesh.userData.vehicleType = 'shared'
      mesh.userData.ebikeTier = 'shared'
      mesh.userData.ownership = 'shared' as VehicleOwnership
      const spawnKey = bikeCoordKey(candidate.x, candidate.z)
      mesh.userData.coordKey = spawnKey
      mesh.userData.spawnCoordKey = spawnKey
      const restored = persistedBatteries.get(spawnKey)
      if (restored !== undefined) mesh.userData.battery = restored
      if (!mountBikeMesh(mesh)) {
        env.stream.batches.returnBike(candidate.id)
      } else {
        nearDecor = null
      }
    } else if (nearBike?.name === 'car') {
      const safePos = board
        ? board(nearBike.position.x, nearBike.position.y, nearBike.position.z, 'car')
        : {x: nearBike.position.x, y: nearBike.position.y, z: nearBike.position.z, bikeY: nearBike.position.y}
      if (!safePos) return
      clearUnlockedSharedSession()
      car = lastCar = takeRecord(nearBike)
      car.position.set(safePos.x, safePos.bikeY, safePos.z)
      group.add(car)
      // A parked marker is restored from a quaternion. Extract yaw before
      // pitch so entering the car preserves headings past a quarter turn.
      car.rotation.reorder('YXZ')
      carCtrl.mount(car.rotation.y, car.rotation.x)
      syncHud()
    } else if (nearBike) {
      mountBikeMesh(nearBike)
    } else if (nearFree.slot && (nearRoute < 0 || nearFree.distance + 1 < nearRouteDist)) {
      clearUnlockedSharedSession()
      freeBoats!.mount(nearFree.slot, nearFree.atBank)
      syncHud()
    } else if (nearRoute >= 0) {
      clearUnlockedSharedSession()
      route = nearRoute
      segment = 1
      disembark = false
    }
  }
  if (!externalArbiter) button.onclick = interact

  function getInteractSnapshot(): VehicleInteractSnapshot {
    const aboardKind = car
      ? 'car'
      : bike
        ? bikeCtrl.kind === 'bicycle'
          ? 'bicycle'
          : 'bike'
        : freeBoats?.active
          ? 'free_boat'
          : route >= 0
            ? 'tour_boat'
            : null
    const toVehicleSnap = (mesh: T.Object3D | null, distance: number): VehicleCandidateSnapshot | null => {
      if (!mesh) return null
      const kind: VehicleCandidateSnapshot['kind'] = mesh.name === 'car' ? 'car' : mesh.name === 'bicycle' ? 'bicycle' : 'bike'
      const ownership =
        kind === 'bike'
          ? ((mesh.userData.ownership as VehicleCandidateSnapshot['ownership'] | undefined) ?? 'shared')
          : (mesh.userData.ownership as VehicleCandidateSnapshot['ownership'] | undefined)
      const tier =
        kind === 'bike'
          ? resolveEffectiveRoadsideType(
              (mesh.userData.paint as number | undefined) ?? 0,
              ownership ?? 'shared',
              mesh.userData.vehicleType as EbikeVehicleType | undefined,
              mesh.userData.ebikeTier,
            )
          : undefined
      const alreadyUnlocked = kind === 'bike' && ownership === 'shared' ? isTargetSharedUnlocked(mesh) : undefined
      return {
        kind,
        downed: !!mesh.userData.downed,
        distance,
        ...(tier ? {ebikeTier: tier} : {}),
        ...(ownership ? {ownership} : {}),
        ...(alreadyUnlocked !== undefined ? {alreadyUnlocked} : {}),
      }
    }
    const preferFree = !!nearFree.slot && (nearRoute < 0 || nearFree.distance + 1 < nearRouteDist)
    const nearBoat: BoatCandidateSnapshot | null =
      preferFree && nearFree.slot
        ? {kind: 'free_boat', label: (nearFree.slot.kind === 'freeRaft' ? '划竹筏 · ' : '划小船 · ') + nearFree.slot.name, distance: nearFree.distance}
        : nearRoute >= 0
          ? {kind: 'tour_boat', label: '上船 · ' + routes[nearRoute].start, distance: nearRouteDist}
          : null
    return {
      aboardKind,
      tourDisembarkQueued: disembark,
      nearDownedVehicle: toVehicleSnap(nearDownedBike, nearDownedDist),
      nearVehicle: nearDecor
        ? {kind: 'bike', downed: false, distance: decorDistance, ownership: 'shared', ebikeTier: 'shared', alreadyUnlocked: false}
        : toVehicleSnap(nearBike, nearBikeDist),
      nearBoat,
    }
  }

  function nearby(x: number, z: number, footY?: number) {
    if (!bike && activeUnlockedShared?.mesh) {
      const distToUnlocked = Math.hypot(activeUnlockedShared.mesh.position.x - x, activeUnlockedShared.mesh.position.z - z)
      if (!Number.isFinite(distToUnlocked) || distToUnlocked > 14) {
        clearUnlockedSharedSession()
      }
    }
    const now = performance.now()
    nearBike = null
    nearBikeDist = Infinity
    nearDownedBike = null
    nearDownedDist = Infinity
    nearRoute = -1
    nearRouteDist = Infinity
    let bestScore = 4.6
    let bestHint: {x: number; y: number; z: number; dist: number; reach: number; radius: number} | null = null
    const nextCells = new Set<T.Group>()
    for (let col = Math.floor((x - 110) / cellSize); col <= Math.floor((x + 110) / cellSize); col++) {
      for (let row = Math.floor((z - 110) / cellSize); row <= Math.floor((z + 110) / cellSize); row++) {
        const parking = cells.get(`${col},${row}`)
        if (!parking) continue
        const cell = loadParkingCell(parking)
        nextCells.add(cell)
        if (!visibleCells.has(cell)) {
          visibleCells.add(cell)
          group.add(cell, parkedCells.get(cell)!.view)
        }
        let visibilityChanged = false
        for (const child of cell.children) {
          const mesh = child
          const distance = Math.hypot(mesh.position.x - x, mesh.position.z - z)
          const isCar = mesh.name === 'car'
          const downed = !!mesh.userData.downed
          const reach = downed ? 4.4 : isCar ? 4.6 : 4.2
          const visible = distance < 110
          if (visible && mesh.name === 'bike' && mesh.userData.parkedModel) {
            const farModel = distance >= 40 ? 'bike:far' : ''
            if (farModel && !models.has(farModel)) models.set(farModel,parkedParts(vehicleModel('bike',0,{distant:true,shared:true})))
            if (farModel !== mesh.userData.farModel) { mesh.userData.farModel=farModel; visibilityChanged=true }
            if (distance < 18 && !downed && env?.supportYAt && now >= (mesh.userData.nextGroundProbe ?? 0)) {
              mesh.userData.nextGroundProbe = now + 1000
              const ground = env.supportYAt(mesh.position.x,mesh.position.z,mesh.position.y)
              if (Number.isFinite(ground) && Math.abs(mesh.position.y-ground)>.015) {
                mesh.position.y=ground; mesh.updateMatrix()
                parkedCells.get(cell)!.invalidate(mesh.userData.parkedModel); visibilityChanged=true
              }
            }
          }
          if (visible !== mesh.visible && mesh.userData.parkedModel) visibilityChanged = true
          mesh.visible = visible
          const vertOk = footY === undefined || Math.abs(mesh.position.y - footY) <= 1.5
          if (downed && distance < reach && distance < nearDownedDist && vertOk) {
            nearDownedBike = mesh
            nearDownedDist = distance
          } else if (!downed && distance < reach && vertOk) {
            // Personal owned e-bikes receive a 0.6 m priority bias when parked beside shared bikes (spec §2.2).
            const score = mesh.userData.ownership === 'personal' ? Math.max(0, distance - 0.6) : distance
            if (score < bestScore) {
              nearBike = mesh
              nearBikeDist = distance
              bestScore = score
            }
          }
          const hintCap = isCar ? 28 : 24
          if (distance < hintCap && vertOk && (!bestHint || distance < bestHint.dist)) {
            bestHint = {x: mesh.position.x, y: mesh.position.y, z: mesh.position.z, dist: distance, reach, radius: isCar ? 2.35 : 1.15}
          }
        }
        if (visibilityChanged || !cell.userData.batchReady) {
          refreshBatch(cell)
          cell.userData.batchReady = true
        }
      }
    }
    for (const cell of visibleCells) {
      if (!nextCells.has(cell)) {
        group.remove(cell, parkedCells.get(cell)!.view)
        visibleCells.delete(cell)
      }
    }
    nearDecor = active && !car && !bike && route < 0 && !freeBoats?.active ? env?.stream.batches.nearestBike(x,z,footY,Math.min(bestScore,4.2)) ?? null : null
    if (nearDecor) decorDistance = Math.hypot(nearDecor.x-x,nearDecor.z-z)
    let nearestDock = 9
    routes.forEach((leg, index) => {
      const [dx, , dz] = docks[leg.start]
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
    const onFoot = active && !car && !bike && route < 0 && !freeBoats?.active
    if (onFoot && bestHint) {
      const inReach = bestHint.dist < bestHint.reach
      const wave = 0.5 + 0.5 * Math.sin(performance.now() * 0.005)
      interactRing.visible = true
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
    return col >= 0 && row >= 0 && col < width && row < height && !!(mask[index >> 3] & (128 >> (index & 7)))
  }

  function motorPavement(x: number, z: number) {
    const col = Math.round((x - mLeft) / mStep)
    const row = Math.round((z - mTop) / mStep)
    const index = row * mWidth + col
    return col >= 0 && row >= 0 && col < mWidth && row < mHeight && !!(mMask[index >> 3] & (128 >> (index & 7)))
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
    const spot = summonSpot(playerPos,playerYaw)
    if (!spot) return {ok:false,code:'NO_SAFE_SPOT'}
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
    setActiveWorldInstanceId(ownedBike.id)
    setSummonCooldownUntil(now + SUMMON_COOLDOWN_MS)
    emit({type: 'garage:summon', vehicleId: ownedBike.id, pos: [spot.x, spot.y, spot.z], yaw: bikeYaw})
    nearby(playerPos.x, playerPos.z, playerPos.y)
    return {ok: true, code: 'OK', vehicleId: ownedBike.id, pos: [spot.x, spot.y, spot.z], yaw: bikeYaw}
  }

  function summonSpot(playerPos: {x:number;y:number;z:number}, playerYaw:number) {
    const footY = playerPos.y
    const fwdX = -Math.sin(playerYaw)
    const fwdZ = -Math.cos(playerYaw)
    const rightX = Math.cos(playerYaw)
    const rightZ = -Math.sin(playerYaw)

    const tryCandidate = (cx: number, cz: number, requirePavement: boolean): {x: number; y: number; z: number} | null => {
      if (isPointInQuietZone(cx, cz)) return null
      if (requirePavement && !pavement(cx, cz)) return null
      if (env?.sim) {
        env.sim.sync(cx, cz, true)
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
    // Round 1: front-arc 3.2..7.4 m preferring pavement
    const anglesDeg = [25, -25, 45, -45, 65, -65, 10, -10]
    const radii = [3.2, 4.6, 6.0, 7.4]
    outer1: for (const r of radii) {
      for (const deg of anglesDeg) {
        const rad = (deg * Math.PI) / 180
        const ca = Math.cos(rad)
        const sa = Math.sin(rad)
        const dirX = fwdX * ca + rightX * sa
        const dirZ = fwdZ * ca + rightZ * sa
        const hit = tryCandidate(playerPos.x + dirX * r, playerPos.z + dirZ * r, true)
        if (hit) {
          spot = hit
          break outer1
        }
      }
    }
    // Round 2: full 360° walkable fallback 3.2..9.6 m
    if (!spot) {
      outer2: for (const r of [3.2, 5.0, 7.2, 9.6]) {
        for (let k = 0; k < 12; k++) {
          const ang = playerYaw + (k * Math.PI) / 6
          const hit = tryCandidate(playerPos.x - Math.sin(ang) * r, playerPos.z - Math.cos(ang) * r, false)
          if (hit) {
            spot = hit
            break outer2
          }
        }
      }
    }
    return spot
  }

  function hailBike(playerPos: {x:number;y:number;z:number}, playerYaw:number) {
    if (!active || car || bike || route >= 0 || freeBoats?.active || env?.isFootAnimBusy?.() || isPointInQuietZone(playerPos.x,playerPos.z)) return false
    const spot = summonSpot(playerPos,playerYaw)
    if (!spot) return false
    let closest: T.Object3D | undefined, best = Infinity
    for (const cell of visibleCells) for (const record of cell.children) {
      if (record.name !== 'bike' || (!isSoloActive() && !record.userData.shared) || !record.userData.parkedModel || record.userData.downed || record.userData.ownership !== 'shared') continue
      const distance = Math.hypot(record.position.x-playerPos.x,record.position.z-playerPos.z)
      if (distance<best) { best=distance; closest=record }
    }
    if (!closest) return false
    const unit=takeRecord(closest)
    const nextType = resolveEffectiveRoadsideType((unit.userData.paint as number | undefined) ?? 0, 'shared', undefined, unit.userData.vehicleType)
    unit.userData.vehicleType = nextType
    unit.userData.ebikeTier = nextType
    unit.userData.shared = nextType === 'shared'
    relocateParkedBike(unit,spot.x,spot.y,spot.z,playerYaw)
    nearby(playerPos.x,playerPos.z,playerPos.y)
    return true
  }

  function spawnPersonalBikeAtBay(shopId: string, vehicleId: string): boolean {
    if (!soloServices()) return false
    const shop = getShop(shopId)
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
    setActiveWorldInstanceId(ownedBike.id)
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
      const paintIdx = ownedBike.modelId === 'lijiang_light' ? 0 : ownedBike.modelId === 'city_range' ? 2 : 3
      const nextGeom = makeVehicleMesh('bike', paintIdx, {visual: ownedBike.visual}).geometry
      if (activePersonalMesh.geometry !== nextGeom) activePersonalMesh.geometry = nextGeom
    }
    if (bike && bike.userData.instanceId === vehicleId) {
      bikeCtrl.setPersonalModel(ownedBike.modelId as PersonalEbikeTierId, ownedBike.durabilityPct)
      bikeCtrl.setUpgrades(ownedBike.upgrades)
      bikeCtrl.setBattery(ownedBike.batteryPct)
    }
    return true
  }

  function startTestRide(shopId: string, modelId: PersonalEbikeModelId): StartTestRideResult {
    if (!soloServices()) return {ok:false, code:'INVALID_SHOP'}
    const shop = getShop(shopId)
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
    const expiresAt = startedAt + TEST_RIDE_DURATION_MS
    setActiveTestRide({
      shopId,
      modelId,
      instanceId,
      startedAt,
      expiresAt,
      origin: [sp.x, sp.z],
      maxRadiusM: TEST_RIDE_MAX_RADIUS_M,
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
    setActiveTestRide(null)
    delete document.body.dataset.ebikeTier
    delete document.body.dataset.rideType
    delete document.body.dataset.vehicleOwnership
    syncHud()
    emit({type: 'testride:end', modelId, reason})
    return true
  }

  function applyPersonalCrashDamage(severity: number) {
    if (!bike || bike.userData.ownership !== 'personal') return
    const id = bike.userData.instanceId as string | undefined
    if (!id) return
    const cur = (bike.userData.durability as number | undefined) ?? getState().garage.vehicles[id]?.durabilityPct ?? 100
    const loss = Math.max(6, Math.min(18, Math.round(6 + severity * 10)))
    const nextDur = Math.max(15, cur - loss)
    bike.userData.durability = nextDur
    const saved = bikeStates.get(bike)
    if (saved) saved.durabilityPct = nextDur
    const modelId = bike.userData.modelId as PersonalEbikeTierId | undefined
    if (modelId) bikeCtrl.setPersonalModel(modelId, nextDur)
    soloServices()?.commerce.updatePersonalVehicleTelemetry(id, {durabilityPct: nextDur}, true)
  }

  function advance(dt: number) {
    const leg = routes[route]
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
    const [x, , z] = docks[leg.end]
    const departures2 = routes.filter(other => other.start === leg.end && other.kind === leg.kind)
    const next = routes.indexOf(departures2.find(other => other.end !== leg.start) ?? departures2[0])
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
    dismount() {
      reset()
      syncHud()
    },
    getInteractSnapshot,
    actionButton: button,
    setExternalArbiter(on: boolean) {
      externalArbiter = on
      if (!on) button.onclick = interact
    },
    get car() { return car },
    get bike() { return bike },
    get rideKind(): RideKind | null { return bike ? bikeCtrl.kind : null },
    get vehicleType(): EbikeVehicleType | null { return bike && bikeCtrl.kind === 'bike' ? bikeCtrl.vehicleType : null },
    get isShared() { return bike && bikeCtrl.kind === 'bike' ? bikeCtrl.isShared : false },
    get bikeOwnership(): VehicleOwnership | null { return bike ? ((bike.userData.ownership as VehicleOwnership | undefined) ?? 'shared') : null },
    get bikeInstanceId(): string | null { return bike ? ((bike.userData.instanceId as string | undefined) ?? null) : null },
    get bikeModelId(): PersonalEbikeModelId | null { return bike ? ((bike.userData.modelId as PersonalEbikeModelId | undefined) ?? null) : null },
    get bikeDurabilityPct(): number { return bike ? ((bike.userData.durability as number | undefined) ?? 100) : 100 },
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
    hailBike,
    spawnPersonalBikeAtBay,
    refreshPersonalBikeVisual,
    startTestRide,
    endTestRide,
    applyPersonalCrashDamage,
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
    tryBikeImpactCrash(preSpeedMs: number) { return bike ? bikeCtrl.tryImpactCrash(preSpeedMs) : false },
    resolveCarMove(ctx: Parameters<typeof carCtrl.resolveMove>[0]) { return carCtrl.resolveMove(ctx) },
    steer(forward: number, right: number, dt: number, mounted = true, control?: EbikeStepControl) {
      const spd = bikeCtrl.steer(forward, right, dt, mounted, control)
      if (bike && bikeCtrl.kind === 'bike') {
        bike.userData.battery = bikeCtrl.batteryPct
        const ownership = (bike.userData.ownership as VehicleOwnership | undefined) ?? 'shared'
        if (ownership === 'personal') {
          const id = bike.userData.instanceId as string | undefined
          if (id) {
            const deltaOdometerKm = (Math.abs(spd) * dt) / 1000
            soloServices()?.commerce.updatePersonalVehicleTelemetry(id, {batteryPct: bikeCtrl.batteryPct, deltaOdometerKm}, false)
          }
        } else if (ownership === 'shared') {
          const spawnKey = (bike.userData.spawnCoordKey as string | undefined) ?? (bike.userData.coordKey as string | undefined)
          persistRoadsideBattery(spawnKey, bikeCtrl.batteryPct, bikeCtrl.batteryPct <= 0)
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
        for (const spawn of cell.pending) {
          if (!kind || spawn.kind === kind) out.push([spawn.row[0], spawn.row[1], spawn.row[2]])
        }
        for (const child of cell.group?.children ?? []) {
          if (!kind || child.name === kind) out.push([child.position.x, child.position.y, child.position.z])
        }
      }
      return out
    },
    parkedBikes() {
      const out: {x: number; y: number; z: number; paint: number; vehicleType: EbikeVehicleType; tier: EbikeTier; batteryPct: number; ownership: VehicleOwnership}[] = []
      for (const cell of cells.values()) {
        for (const {kind, row, shared, spawnKey} of cell.pending) {
          if (kind !== 'bike') continue
          const [x, y, z, , paint] = row
          const vehicleType = resolveEffectiveRoadsideType(paint, 'shared', undefined, shared ? 'shared' : undefined)
          out.push({x, y, z, paint, vehicleType, tier: vehicleType, ownership: 'shared',
            batteryPct: persistedBatteries.get(spawnKey ?? bikeCoordKey(x, z)) ?? 100})
        }
        for (const child of cell.group?.children ?? []) {
          if (child.name !== 'bike') continue
          const paint = (child.userData.paint as number | undefined) ?? 0
          const saved = bikeStates.get(child) ?? bikeCoordStates.get(bikeCoordKey(child.position.x, child.position.z))
          const ownership = saved?.ownership ?? ((child.userData.ownership as VehicleOwnership | undefined) ?? 'shared')
          const vehicleType = resolveEffectiveRoadsideType(paint, ownership, saved?.vehicleType, child.userData.vehicleType ?? child.userData.ebikeTier)
          out.push({
            x: child.position.x,
            y: child.position.y,
            z: child.position.z,
            paint,
            vehicleType,
            tier: vehicleType,
            batteryPct: saved?.batteryPct ?? 100,
            ownership,
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
    motorPavement:(x:number,z:number)=>motorPavement(x,z)||onJiefangJunction(x,z),
  }
}
