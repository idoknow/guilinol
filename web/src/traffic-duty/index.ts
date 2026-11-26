/**
 * 解放桥 10 分钟交通劝导玩法（IDOK-284）单入口导出与热点接线说明。
 *
 * 供父单 IDOK-282 整合阶段在以下热点文件最小接线（解放桥执勤区中心 (-168, 40)，半径 240 m）：
 *  1. `web/src/main.ts`：
 *     ```ts
 *     import { createTrafficDuty } from './traffic-duty'
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
 *       onDutyStateChange: active => walker?.outfit?.setVolunteerVest?.(active),
 *       onToast: (text, ms) => showToast(text, ms),
 *       onTeleportToBridge: () => walkTo(-268, 16, 1.32, 'traffic-duty', '解放桥'),
 *       arbiterWired: true,
 *     })
 *     // 在 animate() 主循环内：trafficDuty.step(Math.min(0.1, elapsed / 1000))
 *     // 在 window.viewer 调试探针暴露：trafficDuty
 *     ```
 *  2. `web/src/walk/index.ts`（`[F]` 仲裁桥接，禁私绑 `KeyF`）：
 *     - 在 `createInteractArbiter` 回调中引入 `mergeTrafficDutyDecision`：
 *       当 `decision.priority >= 5` 且 `trafficDuty.getInteractCandidate(ctx)` 非空时，
 *       切换提示文案为 `candidate.label`，并在 `trigger()` 命中 `action === 'whistle_cite'` 时调用 `trafficDuty.triggerWhistle()`。
 *  3. `web/src/walk/input-guard.ts`：
 *     - 将 `.td-entry,.td-bar,.td-whistle-btn,.td-panel` 加入 `TOUCH_UI_SELECTOR`（`<dialog class="td-panel">` 已被 `dialog[open]` 自动覆盖）。
 */

import {createTrafficDutyController} from './controller.ts'
import type {TrafficDutyController, TrafficDutyHost} from './types.ts'
import {mountTrafficDutyUi} from './ui.ts'

export * from './types.ts'
export * from './leaderboard.ts'
export * from './arbiter.ts'
export * from './whistle.ts'
export {createTrafficDutyController} from './controller.ts'

export function createTrafficDuty(host: TrafficDutyHost): TrafficDutyController {
  return createTrafficDutyController(host, {mountUi: mountTrafficDutyUi})
}
