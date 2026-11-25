import type { DrinkSoundId } from '../audio/catalog.ts'
import type { DrinksSimEvent } from '../sim/types.ts'

export interface DrinksLodConfig {
  readonly nearEnterRadiusM: number
  readonly nearExitRadiusM: number
  readonly interactRadiusM: number
  readonly orderAlertRadiusM: number
  readonly orderPanelCloseRadiusM: number
}

export const DEFAULT_DRINKS_LOD_CONFIG: DrinksLodConfig = {
  nearEnterRadiusM: 85,
  nearExitRadiusM: 105,
  interactRadiusM: 16,
  orderAlertRadiusM: 45,
  orderPanelCloseRadiusM: 28,
}

export interface DrinksLodState {
  readonly distanceM: number
  readonly visualActive: boolean
  readonly visualEntered: boolean
  readonly visualExited: boolean
  readonly nearInteract: boolean
  readonly showPickupHud: boolean
  readonly shouldCloseOrderPanel: boolean
}

export function computeDistanceXZ(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz)
}

export interface DrinksLodController {
  update(distanceM: number, hasActivePlayerOrder: boolean, canShowHud: boolean): DrinksLodState
  isVisualActive(): boolean
  reset(): void
}

/**
 * Hysteresis LOD state machine:
 * - Far (> nearExitRadiusM): 3D shop mesh & NPC renderer hidden and skipped; sim keeps advancing.
 * - Near (<= nearEnterRadiusM): 3D shop mesh & NPC renderer shown and immediately synced to live sim state.
 */
export function createDrinksLodController(config: DrinksLodConfig = DEFAULT_DRINKS_LOD_CONFIG): DrinksLodController {
  let visualActive = false

  return {
    update(distanceM: number, hasActivePlayerOrder: boolean, canShowHud: boolean): DrinksLodState {
      const safeDist = Number.isFinite(distanceM) && distanceM >= 0 ? distanceM : Infinity
      const prevVisual = visualActive
      if (!visualActive && safeDist <= config.nearEnterRadiusM) {
        visualActive = true
      } else if (visualActive && safeDist > config.nearExitRadiusM) {
        visualActive = false
      }
      const nearInteract = canShowHud && safeDist <= config.interactRadiusM
      const showPickupHud =
        canShowHud && (nearInteract || (hasActivePlayerOrder && safeDist <= config.orderAlertRadiusM))
      const shouldCloseOrderPanel = safeDist > config.orderPanelCloseRadiusM

      return {
        distanceM: safeDist,
        visualActive,
        visualEntered: !prevVisual && visualActive,
        visualExited: prevVisual && !visualActive,
        nearInteract,
        showPickupHud,
        shouldCloseOrderPanel,
      }
    },

    isVisualActive: () => visualActive,

    reset() {
      visualActive = false
    },
  }
}

export interface HeldDrinkPauseContext {
  walkerActive: boolean
  vehicle?: string | null
  aboardAttr?: boolean
  photoOn?: boolean
  shopOpen?: boolean
  drinksUiOpen?: boolean
}

export interface HeldDrinkPauseDecision {
  readonly paused: boolean
  readonly stowedForRide: boolean
}

/**
 * Riding a bike/bicycle/car/boat automatically stows the held drink cup (`stowedForRide: true`, `paused: true`);
 * opening photo mode, vehicle shop, or order drawer also pauses hand-hold until back on foot.
 */
export function resolveHeldDrinkPause(ctx: HeldDrinkPauseContext): HeldDrinkPauseDecision {
  const onVehicle =
    Boolean(ctx.aboardAttr) || (typeof ctx.vehicle === 'string' && ctx.vehicle !== 'foot' && ctx.vehicle !== '')
  const paused =
    !ctx.walkerActive || onVehicle || Boolean(ctx.photoOn) || Boolean(ctx.shopOpen) || Boolean(ctx.drinksUiOpen)
  return {
    paused,
    stowedForRide: onVehicle,
  }
}

export interface MappedSimSound {
  readonly soundId: DrinkSoundId
  readonly volume: number
}

/**
 * Maps simulation events to distance-attenuated ambient/player drink shop audio cues.
 */
export function mapSimEventToSound(
  ev: DrinksSimEvent,
  distanceM: number,
  isPlayerOrder: boolean,
): MappedSimSound | null {
  if (!Number.isFinite(distanceM)) return null
  if (ev.type === 'order_called') {
    if (isPlayerOrder && distanceM <= 48) {
      return { soundId: 'call_number', volume: 0.95 }
    }
    if (distanceM <= 18) {
      return { soundId: 'call_number', volume: Math.max(0.18, 0.52 * (1 - distanceM / 20)) }
    }
    return null
  }
  if (distanceM > 18) return null
  const atten = Math.max(0.15, 1 - distanceM / 20)
  if (ev.type === 'order_created' && !isPlayerOrder) {
    return { soundId: 'order_chime', volume: 0.34 * atten }
  }
  if (ev.type === 'order_preparing') {
    const detail = ev.detail ?? ''
    if (detail.includes('cream')) return { soundId: 'ice_cream_dispense', volume: 0.42 * atten }
    if (detail.includes('tea')) return { soundId: 'shaker_shake', volume: 0.42 * atten }
    return { soundId: 'ice_scoop', volume: 0.42 * atten }
  }
  return null
}

export interface DebugProbePolicyInput {
  readonly isProd: boolean
  readonly search?: string | null
  readonly explicit?: boolean
}

/**
 * 生产环境默认严禁挂载任何调试/验证探针接口（返回 `false`）。
 * 仅在非生产构建（DEV / 单测）或显式带 `?verify` 自动化门禁参数（或显式 `explicit: true`）时启用只读受控探针。
 */
export function shouldExposeDrinksDebugProbe(input: DebugProbePolicyInput): boolean {
  if (typeof input.explicit === 'boolean') return input.explicit
  if (!input.isProd) return true
  const rawSearch = input.search ?? ''
  const query = rawSearch.startsWith('?') ? rawSearch.slice(1) : rawSearch
  const params = new URLSearchParams(query)
  return params.has('verify')
}

export {
  createDrinksIndoorViewController,
  isLocalPointInsideDrinksShop,
  resolveDrinksInteriorBounds,
  type DrinksIndoorViewController,
  type DrinksIndoorViewOptions,
  type DrinksIndoorViewState,
  type DrinksInteriorBounds,
  type DrinksViewMode,
  type DrinksViewModeAdapter,
} from './indoor-view.ts'

export {
  bindTerrainRefitSync,
  measureSceneGroupsAlignment,
  setDrinksSceneGroupsVisible,
  syncDrinksSceneGroups,
  type DrinksFourSceneGroups,
  type DrinksGroupAlignmentReport,
} from './scene-groups.ts'

export {
  createStaffToHoldBridge,
  type StaffToHoldBridge,
  type StaffToHoldBridgeOptions,
} from './workflow-bridge.ts'

export {
  buildDrinksShopObstacleVolume,
  createDrinksHostWorldBridge,
  DRINKS_OBSTACLE_VOLUME_ID,
  type HostWorldBridge,
  type HostWorldBridgeOptions,
  type ObstacleAwareWalker,
} from './host-world-bridge.ts'
