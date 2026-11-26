import rawStage1Layout from './stage1-layout.json' with { type: 'json' }
import type { XxgCrowdMetrics } from './crowd.ts'
import {
  XXG_BUDGET,
  XXG_CONTRACT_VERSION,
  XXG_FRAME,
  XXG_LAYOUT_LIMITS,
  XXG_PLAYER,
  XXG_PORTALS,
  XXG_PORTAL_IDS,
  XXG_PORTAL_TRIGGER,
  XXG_TIMING,
  XXG_TRANSITIONS,
  canTransition,
  getPortal,
  indoorToWorld,
  portalLanding,
  rotateLocal,
  validateXxgLayout,
  worldToIndoor,
  worldToPortalLocal,
  yawFacing,
  type XxgCorridor,
  type XxgExit,
  type XxgHostContext,
  type XxgIndoorMetrics,
  type XxgIndoorScene,
  type XxgLayout,
  type XxgPortal,
  type XxgPortalId,
  type XxgRect,
  type XxgShop,
  type XxgState,
  type XxgXZ,
} from '../contract.ts'

export {
  XXG_BUDGET,
  XXG_CONTRACT_VERSION,
  XXG_FRAME,
  XXG_LAYOUT_LIMITS,
  XXG_PLAYER,
  XXG_PORTALS,
  XXG_PORTAL_IDS,
  XXG_PORTAL_TRIGGER,
  XXG_TIMING,
  XXG_TRANSITIONS,
  canTransition,
  getPortal,
  indoorToWorld,
  portalLanding,
  rotateLocal,
  validateXxgLayout,
  worldToIndoor,
  worldToPortalLocal,
  yawFacing,
  type XxgCorridor,
  type XxgExit,
  type XxgHostContext,
  type XxgIndoorMetrics,
  type XxgIndoorScene,
  type XxgLayout,
  type XxgPortal,
  type XxgPortalId,
  type XxgRect,
  type XxgShop,
  type XxgState,
  type XxgXZ,
}

export function normalizeAngleRad(angle: number): number {
  let a = angle
  while (a <= -Math.PI) a += Math.PI * 2
  while (a > Math.PI) a -= Math.PI * 2
  return a
}

export function assertValidXxgLayout(raw: unknown): XxgLayout {
  const errs = validateXxgLayout(raw)
  if (errs.length > 0) {
    throw new Error(`Invalid XxgLayout: ${errs.join('; ')}`)
  }
  return raw as XxgLayout
}

export const STAGE1_GREYBOX_LAYOUT: XxgLayout = assertValidXxgLayout(rawStage1Layout)

export interface CreateXxgIndoorSceneOptions {
  readonly layout?: XxgLayout
  /** Override veilFadeInMs in unit tests; defaults to XXG_TIMING.veilFadeInMs (280ms). */
  readonly veilFadeInMs?: number
  readonly now?: () => number
  /** 室内限流人群上限；0 关闭人群，缺省 XXG_CROWD_MAX（18）。 */
  readonly crowdMaxAgents?: number
  /** 人群随机种子（测试与对照截图固定画面用）。 */
  readonly crowdSeed?: number
}

export interface XxgPlayerSnapshot {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly eyeY: number
  readonly yaw: number
  readonly pitch: number
  /** Indoor camera FOV: the street FOV on a well landing, XXG_PLAYER.fovDeg in the mall. */
  readonly fovDeg: number
  readonly ceilingClearanceM: number
  readonly activePortalId: XxgPortalId | null
  readonly activeShopId: string | null
  readonly collisionContacts: number
  /** Eased opening (0 shut, 1 open) of each well's B1 glass door, in XXG_PORTAL_IDS order. */
  readonly doorsOpen: readonly number[]
}

export interface XxgExtendedIndoorScene extends XxgIndoorScene {
  /** Renders indoor.scene with indoor.camera via host renderer when state is inside or exiting. */
  renderFrame(): boolean
  getPlayerSnapshot(): XxgPlayerSnapshot
  getLayout(): XxgLayout
  /** 人群上限、在场人数、生成/消失计数与开销；人群关闭时为 null。 */
  getCrowdMetrics(): XxgCrowdMetrics | null
}
