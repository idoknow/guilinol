/**
 * Unified Phase-2 game state machine (`web/src/game/state.ts`).
 *
 * 100% backward-compatible with docs/plan-2.md baseline 6 fields (`mode`, `vehicle`, `money`, `wanted`, `mission`, `zone`)
 * and core exports (`getState`, `onState`, `emit`), plus `updateTravel`, `onEvent`, and Stage 1 incremental state
 * (`wardrobe`, `garage`, `activeShop`, `spotsFound`, `missionsDone`, `walletSeq`, `prompt`).
 *
 * Dependency rule: web/src/game/* NEVER imports Three.js or DOM scene objects.
 */

import {
  DEFAULT_EQUIPPED_OUTFIT,
  DEFAULT_OWNED_OUTFIT_ITEMS,
  DEFAULT_OWNED_OUTFIT_PRESETS,
  DEFAULT_START_MONEY,
  MAX_SAFE_MONEY,
  type EquippedOutfit,
  type OutfitSlot,
  type PersonalEbikeModelId,
  type PersistedEbikeUpgrades,
  type PersistedEbikeVisual,
} from './catalog'

export type {
  OutfitSlot,
  EquippedOutfit,
  PersonalEbikeModelId,
  PersistedEbikeUpgrades,
  PersistedEbikeVisual,
}

export type PlayerMode = 'foot' | 'ebike' | 'bike' | 'car' | 'boat' | 'fly'

export type VehicleOwnership = 'shared' | 'personal' | 'test_ride'

export interface ActiveVehicleState {
  // ---- docs/plan-2.md baseline fields ----
  kind: string
  id: string
  speedKmh: number
  gear?: 'D' | 'R' | 'N'
  damage: number // 0..1, synced with personal e-bike durabilityPct: clamp(1 - durabilityPct / 100, 0, 1)
  // ---- Stage 1 incremental optional fields ----
  ownership?: VehicleOwnership
  modelId?: PersonalEbikeModelId
  gearLabel?: 'P' | 'D1' | 'D2' | 'D3' | 'S' | 'D' | 'R' | 'N'
  batteryPct?: number // 0..100
  durabilityPct?: number // 0..100
  parkLocked?: boolean
}

export interface ActiveMissionState {
  id: string
  title: string
  step: string
  target?: [number, number]
  timer?: number
  // Compatible with web/src/ui/street-hud.ts HudState.mission
  meter?: {label: string; value: number}
  line?: {who: string; text: string}
}

export interface OwnedPersonalEbike {
  id: string
  modelId: PersonalEbikeModelId
  nickname?: string
  purchasedAt: number
  batteryPct: number // 0..100
  durabilityPct: number // 0..100
  odometerKm: number
  upgrades: PersistedEbikeUpgrades
  visual: PersistedEbikeVisual
}

export interface ActiveTestRideState {
  shopId: string
  modelId: PersonalEbikeModelId
  instanceId: string // prefixed with "test-ride:", NEVER persisted
  startedAt: number
  expiresAt: number
  origin: [number, number]
  maxRadiusM: number
  outOfBoundsSince: number | null
}

export interface WardrobeState {
  ownedItemIds: string[]
  ownedPresetIds: string[]
  equipped: EquippedOutfit
  autoHelmetOnRide: boolean
}

export interface GarageState {
  activeVehicleId: string | null
  vehicles: Record<string, OwnedPersonalEbike>
  activeWorldInstanceId: string | null
  summonCooldownUntil: number
  activeTestRide: ActiveTestRideState | null
}

export interface ActiveShopState {
  shopId: string
  kind: 'clothing' | 'ebike'
  openedAt: number
}

export interface InteractionPromptState {
  key: string
  text: string
  kind: 'shop' | 'service' | 'vehicle' | 'pickup' | 'boat' | 'dismount' | 'hint'
}

export interface GameState {
  // ---- docs/plan-2.md baseline 6 fields ----
  mode: PlayerMode
  vehicle: ActiveVehicleState | null
  money: number // safe non-negative integer yuan (0..99_999_999)
  wanted: 0 | 1 | 2 | 3 | 4 | 5
  mission: ActiveMissionState | null
  zone: {quiet: boolean; name?: string}

  // ---- Stage 1 incremental state ----
  wardrobe: WardrobeState
  garage: GarageState
  activeShop: ActiveShopState | null
  spotsFound: string[]
  missionsDone: string[]
  walletSeq: number
  prompt?: InteractionPromptState | null
}

export type GameEvent =
  // ---- docs/plan-2.md baseline events ----
  | {type: 'mission:start'; id: string; title: string}
  | {type: 'mission:done'; id: string; reward: number; firstClear?: boolean}
  | {type: 'fine'; amount: number; reason: string}
  | {type: 'crash'; severity: number; vehicleId?: string}
  // ---- Stage 1 incremental events ----
  | {type: 'money:change'; delta: number; balance: number; reason: string; txId: string}
  | {type: 'shop:open'; shopId: string; kind: 'clothing' | 'ebike'}
  | {type: 'shop:close'; shopId: string; reason: 'user' | 'esc' | 'fly' | 'teleport' | 'testride'}
  | {type: 'shop:preview'; shopId: string; itemType: 'outfit' | 'outfit_preset' | 'ebike' | 'ebike_mod'; itemId: string}
  | {type: 'shop:buy'; shopId: string; itemType: string; itemId: string; price: number; txId: string}
  | {type: 'outfit:equip'; equipped: EquippedOutfit}
  | {type: 'garage:select'; vehicleId: string}
  | {type: 'garage:summon'; vehicleId: string; pos: [number, number, number]; yaw: number}
  | {type: 'garage:mod'; vehicleId: string; upgrades: PersistedEbikeUpgrades; visual: PersistedEbikeVisual}
  | {type: 'garage:service'; vehicleId: string; batteryPct: number; durabilityPct: number; cost: number}
  | {type: 'testride:start'; shopId: string; modelId: PersonalEbikeModelId; expiresAt: number}
  | {type: 'testride:end'; modelId: PersonalEbikeModelId; reason: 'timeout' | 'out_of_bounds' | 'user' | 'dismount_far' | 'mode_switch' | 'purchase'}
  | {type: 'save:loaded'; source: 'local' | 'cloud' | 'default'; migratedFrom?: string}
  | {type: 'save:synced'; revision: number; updatedAt: number}

type StateListener = (state: Readonly<GameState>, changed: Set<keyof GameState>) => void
type EventListener = (event: GameEvent) => void

export function createDefaultWardrobeState(): WardrobeState {
  return {
    ownedItemIds: [...DEFAULT_OWNED_OUTFIT_ITEMS],
    ownedPresetIds: [...DEFAULT_OWNED_OUTFIT_PRESETS],
    equipped: {...DEFAULT_EQUIPPED_OUTFIT},
    autoHelmetOnRide: true,
  }
}

export function createDefaultGarageState(): GarageState {
  return {
    activeVehicleId: null,
    vehicles: {},
    activeWorldInstanceId: null,
    summonCooldownUntil: 0,
    activeTestRide: null,
  }
}

export function createDefaultGameState(): GameState {
  return {
    mode: 'fly',
    vehicle: null,
    money: DEFAULT_START_MONEY,
    wanted: 0,
    mission: null,
    zone: {quiet: false},
    wardrobe: createDefaultWardrobeState(),
    garage: createDefaultGarageState(),
    activeShop: null,
    spotsFound: [],
    missionsDone: [],
    walletSeq: 0,
    prompt: null,
  }
}

const stateListeners = new Set<StateListener>()
const eventListeners = new Set<EventListener>()
let state: GameState = createDefaultGameState()

function notifyState(changed: Set<keyof GameState>): void {
  if (!changed.size) return
  for (const listener of [...stateListeners]) {
    listener(state, changed)
  }
}

export function getState(): Readonly<GameState> {
  return state
}

export function onState(fn: StateListener): () => void {
  stateListeners.add(fn)
  fn(state, new Set(Object.keys(state) as (keyof GameState)[]))
  return () => {
    stateListeners.delete(fn)
  }
}

export function onEvent(fn: EventListener): () => void {
  eventListeners.add(fn)
  return () => {
    eventListeners.delete(fn)
  }
}

export function emit(event: GameEvent): void {
  for (const listener of [...eventListeners]) {
    listener(event)
  }
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('game:event', {detail: event}))
  }
}

function sameVehicle(a: ActiveVehicleState | null, b: ActiveVehicleState | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    a.speedKmh === b.speedKmh &&
    a.gear === b.gear &&
    a.damage === b.damage &&
    a.ownership === b.ownership &&
    a.modelId === b.modelId &&
    a.gearLabel === b.gearLabel &&
    a.batteryPct === b.batteryPct &&
    a.durabilityPct === b.durabilityPct &&
    a.parkLocked === b.parkLocked
  )
}

function samePrompt(a: InteractionPromptState | null | undefined, b: InteractionPromptState | null | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.key === b.key && a.text === b.text && a.kind === b.kind
}

/**
 * Compatible with PR #92 `updateTravel(mode, vehicle, zoneName?)`, extended with optional explicit quiet flag.
 */
export function updateTravel(
  mode: PlayerMode,
  vehicle: ActiveVehicleState | null,
  zoneNameOrQuiet?: string | {quiet: boolean; name?: string},
): void {
  const changed = new Set<keyof GameState>()
  const nextZone =
    typeof zoneNameOrQuiet === 'object' && zoneNameOrQuiet !== null
      ? {quiet: !!zoneNameOrQuiet.quiet, ...(zoneNameOrQuiet.name ? {name: zoneNameOrQuiet.name} : {})}
      : zoneNameOrQuiet !== undefined
        ? {quiet: !!zoneNameOrQuiet, ...(zoneNameOrQuiet ? {name: zoneNameOrQuiet} : {})}
        : state.zone

  if (state.mode !== mode) changed.add('mode')
  if (!sameVehicle(state.vehicle, vehicle)) changed.add('vehicle')
  if (state.zone.quiet !== nextZone.quiet || state.zone.name !== nextZone.name) changed.add('zone')
  if (!changed.size) return

  state = {...state, mode, vehicle: vehicle ? {...vehicle} : null, zone: nextZone}
  notifyState(changed)
}

export function setZone(quiet: boolean, name?: string): void {
  const next = name ? {quiet, name} : {quiet}
  if (state.zone.quiet === next.quiet && state.zone.name === next.name) return
  state = {...state, zone: next}
  notifyState(new Set<keyof GameState>(['zone']))
}

export function setMission(mission: ActiveMissionState | null): void {
  state = {...state, mission: mission ? {...mission} : null}
  notifyState(new Set<keyof GameState>(['mission']))
}

export function setWanted(wanted: 0 | 1 | 2 | 3 | 4 | 5): void {
  if (state.wanted === wanted) return
  state = {...state, wanted}
  notifyState(new Set<keyof GameState>(['wanted']))
}

export function setActiveShop(shop: ActiveShopState | null): void {
  const same =
    state.activeShop?.shopId === shop?.shopId &&
    state.activeShop?.kind === shop?.kind &&
    state.activeShop?.openedAt === shop?.openedAt
  if (same) return
  state = {...state, activeShop: shop ? {...shop} : null}
  notifyState(new Set<keyof GameState>(['activeShop']))
}

export function setPrompt(prompt: InteractionPromptState | null): void {
  if (samePrompt(state.prompt, prompt)) return
  state = {...state, prompt: prompt ? {...prompt} : null}
  notifyState(new Set<keyof GameState>(['prompt']))
}

export function setActiveWorldInstanceId(instanceId: string | null): void {
  if (state.garage.activeWorldInstanceId === instanceId) return
  state = {...state, garage: {...state.garage, activeWorldInstanceId: instanceId}}
  notifyState(new Set<keyof GameState>(['garage']))
}

export function setSummonCooldownUntil(untilMs: number): void {
  const safe = Number.isFinite(untilMs) ? Math.max(0, Math.trunc(untilMs)) : 0
  if (state.garage.summonCooldownUntil === safe) return
  state = {...state, garage: {...state.garage, summonCooldownUntil: safe}}
  notifyState(new Set<keyof GameState>(['garage']))
}

export function setActiveTestRide(testRide: ActiveTestRideState | null): void {
  state = {...state, garage: {...state.garage, activeTestRide: testRide ? {...testRide} : null}}
  notifyState(new Set<keyof GameState>(['garage']))
}

/**
 * Internal state patcher strictly for `save.ts` and `commerce.ts` atomic commits.
 * Business modules MUST NOT bypass commerce transactions to mutate `money`.
 */
export function _commitPersistedSlice(patch: {
  money?: number
  wardrobe?: WardrobeState
  garage?: Partial<Pick<GarageState, 'activeVehicleId' | 'vehicles'>>
  spotsFound?: string[]
  missionsDone?: string[]
  bumpWalletSeq?: boolean
}): void {
  const changed = new Set<keyof GameState>()
  let nextMoney = state.money
  if (patch.money !== undefined) {
    const safeMoney = Math.max(0, Math.min(MAX_SAFE_MONEY, Math.trunc(Number.isFinite(patch.money) ? patch.money : 0)))
    if (safeMoney !== state.money) {
      nextMoney = safeMoney
      changed.add('money')
    }
  }
  const nextWardrobe = patch.wardrobe
    ? {
        ownedItemIds: [...patch.wardrobe.ownedItemIds],
        ownedPresetIds: [...patch.wardrobe.ownedPresetIds],
        equipped: {...patch.wardrobe.equipped},
        autoHelmetOnRide: !!patch.wardrobe.autoHelmetOnRide,
      }
    : state.wardrobe
  if (patch.wardrobe) changed.add('wardrobe')

  let nextGarage = state.garage
  if (patch.garage) {
    const vehiclesCopy: Record<string, OwnedPersonalEbike> = {}
    const src = patch.garage.vehicles ?? state.garage.vehicles
    for (const [id, v] of Object.entries(src)) {
      vehiclesCopy[id] = {...v, upgrades: {...v.upgrades}, visual: {...v.visual}}
    }
    nextGarage = {
      ...state.garage,
      activeVehicleId: patch.garage.activeVehicleId !== undefined ? patch.garage.activeVehicleId : state.garage.activeVehicleId,
      vehicles: vehiclesCopy,
    }
    changed.add('garage')
  }

  const nextSpots = patch.spotsFound ? [...patch.spotsFound] : state.spotsFound
  if (patch.spotsFound) changed.add('spotsFound')

  const nextMissions = patch.missionsDone ? [...patch.missionsDone] : state.missionsDone
  if (patch.missionsDone) changed.add('missionsDone')

  const nextWalletSeq = patch.bumpWalletSeq ? state.walletSeq + 1 : state.walletSeq
  if (nextWalletSeq !== state.walletSeq) changed.add('walletSeq')

  if (!changed.size) return
  state = {
    ...state,
    money: nextMoney,
    wardrobe: nextWardrobe,
    garage: nextGarage,
    spotsFound: nextSpots,
    missionsDone: nextMissions,
    walletSeq: nextWalletSeq,
  }
  notifyState(changed)
}

/** Resets runtime memory state (used by unit tests and clean re-hydration). */
export function _resetGameStateForTest(initial?: Partial<GameState>): void {
  state = {...createDefaultGameState(), ...(initial ?? {})}
}
