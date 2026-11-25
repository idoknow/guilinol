export {
  resolveDrinksStaffAnchors,
  pickPrepStationAnchor,
  isInsideBackstageArea,
  isInsideShopInterior,
  distanceXZ,
  type StaffZonePoint,
  type StaffStationZone,
  type StaffBackstageBounds,
  type DrinksStaffAnchors,
  type ShopWorkZonesInput,
} from './anchors.ts'
export {
  DEFAULT_STAFF_UNIFORM_PALETTE,
  createStaffUniformController,
  type StaffUniformPalette,
  type StaffUniformController,
} from './uniform.ts'
export {
  DrinksStaffSession,
  type StaffShiftPhase,
  type StaffWorkflowEventKind,
  type StaffWorkflowEvent,
  type StaffMistakeCode,
  type StaffFeedbackNotice,
  type StaffStepGesture,
  type StaffActiveTicket,
  type StaffActionPrompt,
  type DrinksStaffStateSnapshot,
  type DrinksStaffSessionOptions,
} from './workflow.ts'
export {
  createDrinksStaffVisualStage,
  syncStaffCharacterGestures,
  resetStaffCharacterPose,
  type DrinksStaffVisualStage,
} from './station-rigs.ts'
export { mountDrinksStaffHud, type DrinksStaffHudOptions, type DrinksStaffHudController } from './staff-hud.ts'

import {
  createDrinksStaffController,
  type CreateDrinksStaffControllerOptions,
  type DrinksStaffController,
} from './controller.ts'

export {
  createDrinksStaffController,
  type DrinksStaffWalkerLike,
  type CreateDrinksStaffControllerOptions,
  type DrinksStaffController,
} from './controller.ts'

/**
 * ============================================================================
 * FROZEN PUBLIC API (for Carbon / drinks runtime integration)
 * ----------------------------------------------------------------------------
 * 以下 4 个员工模式核心对外生命周期接口契约已冻结，后续改动任何参数或返回签名
 * 必须提前通知 Carbon 与组长后再行修改：
 * - `mount(opts: CreateDrinksStaffControllerOptions): DrinksStaffController`
 * - `dispose(controller: DrinksStaffController): void`
 * - `enterStaff(controller: DrinksStaffController, opts?: { force?: boolean }): boolean`
 * - `exitStaff(controller: DrinksStaffController): boolean`
 * （原有 `createDrinksStaffController` 同为等价挂载函数，向后兼容既有接入点）
 * ============================================================================
 */

/** @frozen 挂载员工系统并初始化立牌/工装/后台台面/BGM/HUD */
export function mount(opts: CreateDrinksStaffControllerOptions): DrinksStaffController {
  return createDrinksStaffController(opts)
}

/** @frozen 进入员工在岗状态（穿戴工服、开启店内 BGM 淡入并触发打卡音效） */
export function enterStaff(controller: DrinksStaffController, opts?: { force?: boolean }): boolean {
  return controller.enterStaff(opts)
}

/** @frozen 退出员工状态（脱卸工服、复位手部姿态并平滑淡出停止 BGM） */
export function exitStaff(controller: DrinksStaffController): boolean {
  return controller.exitStaff()
}

/** @frozen 卸载员工系统并清理全部 3D 资源、HUD、音频与角色姿态 */
export function dispose(controller: DrinksStaffController): void {
  controller.dispose()
}
