/**
 * 桂林双执勤区（解放桥 + 十字街）10 分钟交通劝导玩法（辅警 1.0 + 2.0）单入口导出与热点接线说明。
 *
 * 热点文件最小接线（解放桥中心 (-168, 40) 半径 240 m；十字街中心 (-879.75, -169.63) 半径 180 m）：
 *  1. `web/src/main.ts`：
 *     ```ts
 *     import {
 *       createTrafficDuty,
 *       DUTY_ZONES,
 *       mountAllDutyOfficers,
 *       mountShizijieSignalsOverlay,
 *     } from './traffic-duty'
 *     const groundAt = (x: number, z: number, y?: number, car = false) =>
 *       (car ? walker?.carSupportAt(x, z, y) : walker?.supportAt(x, z, y))?.y
 *     const dutyOfficers = mountAllDutyOfficers(scene, groundAt)
 *     const shizijieSignals = mountShizijieSignalsOverlay(scene, {groundAt})
 *     const trafficDuty = createTrafficDuty({
 *       getPlayerPos: () => (walker?.active ? walker.position : null),
 *       isWalking: () => !!walker?.active,
 *       isPaused: () => paused || !!tour?.map?.active,
 *       isUiBlocked: () => isModalOrOverlayOpen() || document.body.dataset.photo === 'on',
 *       projectToScreen: worldPos => {
 *         const v = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z).project(camera)
 *         return {
 *           x: (1 + v.x) * 0.5 * window.innerWidth,
 *           y: (1 - v.y) * 0.5 * window.innerHeight,
 *           visible: v.z >= -1 && v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
 *         }
 *       },
 *       onDutyStateChange: active => walker?.setTrafficVolunteerMode?.(active),
 *       onToast: (text, ms) => showToast(text, ms),
 *       onTeleportToZone: zoneId => {
 *         const z = DUTY_ZONES.find(item => item.id === zoneId) ?? DUTY_ZONES[0]
 *         return walkTo(z.teleport.x, z.teleport.z, z.teleport.yaw, 'traffic-duty', z.name)
 *       },
 *       arbiterWired: true,
 *     })
 *     // 在 animate() 主循环内：
 *     // const dutyDt = Math.min(0.1, elapsed / 1000)
 *     // trafficDuty.step(dutyDt)
 *     // dutyOfficers.update(dutyDt)
 *     // shizijieSignals.update(walker?.active ? walker.position : camera.position, dutyDt)
 *     // 在 window.viewer 调试探针暴露：trafficDuty, dutyOfficers, shizijieSignals
 *     ```
 *  2. `web/src/walk/index.ts` & `web/src/walk/interact-arbiter.ts`（`[F]` 仲裁桥接，禁私绑 `KeyF`）：
 *     - 在 `createInteractArbiter` 中通过 `mergeTrafficDutyDecision` 接入 `whistle_cite`（Priority 4 优先级高于骑车 Priority 5，低于进店/保养/下车/扶车/弹窗）。
 *     - 在 `walk()` 返回句柄暴露 `setTrafficVolunteerMode(active: boolean)`，穿脱 `outfit_traffic_volunteer`（临时覆写 `top_traffic_volunteer`/`bottom_traffic_duty`/`shoes_traffic_duty`/`hat_traffic_cap`/`bag_traffic_flag`，关闭时恢复 `getGameState().wardrobe.equipped`）。
 *  3. `web/src/walk/input-guard.ts`：
 *     - 将 `.td-entry,.td-bar,.td-whistle-btn,.td-panel` 加入 `TOUCH_UI_SELECTOR`。
 */

import {createTrafficDutyController} from './controller.ts'
import type {TrafficDutyController, TrafficDutyHost} from './types.ts'
import {mountTrafficDutyUi} from './ui.ts'

export * from './types.ts'
export * from './leaderboard.ts'
export * from './arbiter.ts'
export * from './whistle.ts'
export * from './npc-officer.ts'
export * from './traffic-signals-overlay.ts'
export * from './story/index.ts'
export * from './jiefang-railings.ts'
export * from './duty-keys.ts'
export * from './jiefang-escape.ts'
export * from './handover/index.ts'
export {
  clampFineYuan,
  createFineTerminalModel,
  createFineTerminalSession,
  deriveSimulatedPlateNo,
  generateSimulatedReceiptNo,
  getActiveFineTerminalSession,
  isFineTerminalBusy,
  mountFineTerminalOverlay,
  openFineTerminal,
  playTerminalCancelSound,
  playTerminalDeliverSound,
  playTerminalKeySound,
  playTerminalPrintPulseSound,
  playTerminalPrintReadySound,
  playTerminalTakeOutSound,
  playTerminalTearPaperSound,
  TERMINAL_OVERLAY_CSS,
  type FineTerminalCancelReason,
  type FineTerminalCancelledResult,
  type FineTerminalIssuedResult,
  type FineTerminalMountHandle,
  type FineTerminalOpenOptions,
  type FineTerminalPhase,
  type FineTerminalPromise,
  type FineTerminalResult as FineTerminalModalResult,
  type FineTerminalSession,
  type FineTerminalSnapshot,
  type FineTerminalVisualModel,
} from './fine-terminal/index.ts'
export {createTrafficDutyController} from './controller.ts'

export function createTrafficDuty(host: TrafficDutyHost): TrafficDutyController {
  return createTrafficDutyController(host, {mountUi: mountTrafficDutyUi})
}
