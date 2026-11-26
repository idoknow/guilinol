# 桂林辅警 3.0 r5/r6（解放桥值班 + 十字街地下）15 项真机 E2E 与单测验收报告

- 执行时间：2026-11-25（UTC `2026-11-25T14:08:43Z`）
- 执行人：Hy2（协同全组 r5/r6 收口验收与视觉巡检）
- 关联工单：`IDOK-360`（协同前置 `IDOK-345` 及 `IDOK-355~359`）
- 工作分支：`feat/xp-overnight`（`/Users/pan-work/guilinol-xp-overnight`）
- 测试目标：http://127.0.0.1:5176/?mode=walk （正式入口）及 http://127.0.0.1:5176/?verify&mode=walk （含 `window.viewer` 定量探针）
- 验证脚本：`scripts/verify-duty-3.mjs`
- 原始 JSON 报告：`captures/duty-3-e2e/report.json`
- 构建产出核验：`npx --no-install tsc -p web --noEmit` 0 错、`npm run check:api` 通过、`npm run build` 退出码 `0`（355 modules；`dist/index.html` 与 `http://127.0.0.1:5176/` 首包 MD5 同为 `3e548a9fc1f603c9f70b93b421f7178a`，`HTTP 200`）
- Console / PageError 汇总：`ERRS = []`（0 条控制台错误，0 条未捕获异常）
- 进程清理核验：本轮 `verify-duty-3.mjs` 无头 Chromium 已在 `finally` 正常退出（无本任务 Playwright 残留进程），既有 `5176` 服务持续在线

---

## 一、本轮（revise）脚本收口改动（严格限于写权白名单）

> 注：本轮 Hy2 写权严格限定于 `scripts/verify-duty-3.mjs`、`docs/xp-schedule/duty-3-e2e.md` 与 `docs/xp-schedule/multica-board-ledger.md`；`web/src/` 内发现的跨位视觉/时序问题均已保留现状并记录于第四节转报。

1. **S5 举手拦停峰值帧锁定与 `flag_stop` 时序消歧**：`scripts/verify-duty-3.mjs`
   - 根因：SwiftShader 下 `page.screenshot()` 前置等待与原 `420ms` 延迟叠加上游未钳制 `dt`（`main.ts:757-758` → `walk/index.ts:2820`），使 2.4s 的 `duty_flag_stop` 动画在抓拍瞬间回落到 `idle`；且 `long KeyE` 释放后仅等 `200ms` 便点击 `.td-signal-dock [data-td-signal="flag_stop"]`，与 `1.35s~1.5s` 的 `'pass'` 保持窗碰撞。
   - 改法：在 `KeyQ` 结束后等待 `emote.id === 0`，预热 2 帧 `rAF`，在非机动车道内（`|lz| ∈ [12.45, 15.85]`）短按 `KeyE` 后同步步进 `walk.tick(0.25)` 并立即抓拍 `06-whistle-flag-gestures.png`；点击 `flag_stop` 按钮前等待 `emote.id === 0 && flagMode === 'idle'` 并轮询确认 `flagMode === 'stop'`。
2. **S6 同侧车道递交机位与防重 Toast 采样**：`scripts/verify-duty-3.mjs`
   - 将近身递交与防重站位锁定为同侧黑色非机动车道内（`alongDistM=1.05`, `lateralOffsetM=0.22` → `1.07m <= 1.5m`），避免跨过 `z=±12` 机非铁护栏或外侧人行道护栏遮挡 `07b-fine-terminal-cited.png`；防重阶段直接调用 `pressTicket()` 并以 `30ms` 轮询 `.toast.show`（`opacity >= 0.45`）确保 `07e-duplicate-rejected.png` 清晰可见。
3. **S7 / S8 / N3 / S9 构图、抗二次撞击与真实 B1 走廊路径点对齐**：`scripts/verify-duty-3.mjs`
   - **S7**：前置清场 `1200ms` 并面向桥西端（Camera 停于开阔桥面东侧），避免镜头背靠西桥头碰撞体穿模进入角色模型及旧泡泡残留（`08-bounds-warning.png`）。
   - **S8 / N5**：`midSpot` 设为 `lx=-35, lz=16.5`（桥中路缘，同高程 `151.432m` 且避开非机动车道车流二次撞击），提升 SwiftShader 状态等待超时至 `45000ms` 并在 `stage3` 后加入空格兜底循环防止截图耗时回退卡死。
   - **N3**：西岸起跳点从 `-125` 移至 `-117` 避开路灯杆遮挡（`11-railing-jump-crossover.png`）。
   - **S9**：替换原推测拐点为 `public/landmarks/shizijie.json` `way 985734877` 实测走廊中心点 `[-12.7, -38.854]`，进入开阔 B1 中厅中段（`[2.38, -2.794]` 望向 `[4.72, 2.816]`）抓取 `10-shizijie-underground.png`，实现 `10/10` 路径点全闭环往返。

---

## 二、宿主机模块单测与静态门禁实跑结果

- 模块单测：**64/64 PASS**（`fail 0`，实际执行于已通过的 `web/src/` 最新构建态）
  - 命令：`node --test web/src/traffic/*.test.mjs web/src/traffic-duty/traffic-duty.test.mjs web/src/traffic-duty/jiefang-railings.test.mjs web/src/traffic-duty/story/story.test.mjs web/src/traffic-duty/handover/handover.test.mjs web/src/traffic-duty/fine-terminal/fine-terminal.test.mjs web/src/walk/knockdown.test.mjs`
- 静态与契约门禁：`npx --no-install tsc -p web --noEmit`（0 错）、`npm run check:api`（PASS）、`npm run build`（355 modules，exit `0`）、`node --check scripts/verify-duty-3.mjs`（PASS）。

---

## 三、15 项真机端到端逐步验收结果（`scripts/verify-duty-3.mjs`）

执行结果：**`SUMMARY passed=15 failed=0`，退出码 `0`，`ERRS=[]`（15/15 全部通过）**（采样自 `captures/duty-3-e2e/report.json`，时间戳 `2026-11-25T14:08:43.442Z`）。

| 步骤 | 测试场景 | 结论 | 核心实测数据 | 截图路径 |
| :--- | :--- | :--- | :--- | :--- |
| **S1** | 打开 `127.0.0.1:5176/?mode=walk` 进入步行态并展示辅警入口 | **PASS** | `mode='walk'`，`.td-entry` 显示 `解放桥交警 · 401m`，自动关闭 `.coach`（`coachDismissed=true`, `coachStillOpen=false`），`hasViewerLeak=false` | `captures/duty-3-e2e/01-boot-walk.png` |
| **S2** | 实机点击「前往解放桥交警」按钮传送、见交警信标并按 `F` 打开对话（含黑边与双侧头像） | **PASS** | 经 UI `.td-entry` → `[data-td-action="go-bridge"]` 传送；`.td-officer-marker` 可见（`解放桥交警 · [F] 领任务`），按 `KeyF` 打开 `.td-story-dialog`（`shot='wide'`, `letterboxOpen=true`, 双侧头像就绪） | `captures/duty-3-e2e/02-jiefang-officer-beacon.png`、`02b-jiefang-dialogue-opened.png` |
| **S3** | 桥面交警按 `F` 对话、多机位切换与双侧实时头像、领取口哨指挥旗并原地开启值班 | **PASS** | 落地 `footY=151.882m`（与交警高差 `0.037m <= 0.5m`），`inBridgeBounds=true`、`officerDist=3.04m`；覆盖 `wide/player/officer/bridge/two` 5 机位，`playerImgValidAll=true`、`officerUrlCount=4`、`restoreFovDelta=0`、`playerDrift=0`；领装后 `attachedToSkeleton=true`、`hasWhistle=true`、`hasFlag=true` | `captures/duty-3-e2e/03-story-dialogue.png`、`03a~03d`、`04-duty-active-with-gear.png` |
| **S4** | 30 秒内解放桥桥面独立车流 `>= 8`、双侧/中央护栏挂接且桥下违规车为 `0` | **PASS** | `total=22`（`cars=10`, `scooters=12`, `violators=2`），`onDeckTotal=22`、`offDeckActors=0`、**`offDeckViolators=0`**，`railingsMounted=true`（6 子网格） | `captures/duty-3-e2e/05-bridge-traffic-ge-8.png` |
| **N1** | **[r5]** 两轮车全部在黑色非机动车道上且人行道为 `0`（对齐 `JIEFANG_CROSS_SECTION`） | **PASS** | 5 轮采样 60 车次两轮车：`roleCounts.nonmotor=60`、`sidewalk=0`、`motor=0`、`offenders=[]`，严格落在北 `[-16.01, -12.12]` / 南 `[12.12, 16.01]` 非机动车道 | `captures/duty-3-e2e/05-bridge-traffic-ge-8.png` |
| **N2** | **[r5]** 解放桥 3 道栏杆从桥头到桥尾连续无缺口（`spanCount=1, gapCount=0`, 可踩顶 `1.0~1.2m`） | **PASS** | `trackCount=3`（`z=-12 / 0 / +12`）、`spanCount=1`、`gapCount=0`、每道 140 段覆盖 `[-140.5, +140.5]`、`interiorGaps=0`、`nonStandOnTop=0`、`relH=1.05~1.083m` | `captures/duty-3-e2e/05-bridge-traffic-ge-8.png` |
| **N4** | **[r5]** 解放桥桥面车流中违规车比例 `<= 15%` | **PASS** | 5 轮采样 `minTotal=22`、`violators=2`、`maxRatio=0.0909`（`9.09% <= 15%`） | `captures/duty-3-e2e/05-bridge-traffic-ge-8.png` |
| **S5** | 真实键盘 `Q` 吹哨、短按 `E` 挥旗靠边拦停、长按 `E` 放行与执勤键提示同步 | **PASS** | `keysCardCtx='执勤'`、`dockButtons=4`；`KeyQ` 后 `whistleMode='mouth'`、`blowPulse=1`、`normalHalted=0`；短按 `KeyE` 时 `emoteIdAtPeakShot=5`、`flagModeAfterKeyUp='stop'`、`targetBlinkerAtPeakShot='right'`、`targetState='pulled_over'`（`speed=0`）；长按 `KeyE` 后 `flagMode='pass'`、`lastHaltedCleared=true`；按钮 `flag_stop` 实点回切 `dockStopFlagMode='stop'` | `captures/duty-3-e2e/06-whistle-flag-gestures.png`、`06b-flag-long-release.png` |
| **S6** | 真实 `F` 键拿机打印→撕单挂腰→超 `1.5m` 禁递→`1.5m` 内递交手握凭条→同车防重开单 | **PASS** | 拦停 `no_helmet` 目标（`candDist=2.23m`），`KeyF` 开端 `printerMode='in_hand'`、`flagEnabledWhileOpen=false`；撕单挂腰（`printerMode='holstered'`, `handSlipVisible=true`），`2.63m` 禁递（`deliverDisabled=true`）；`1.07m` 内递交后 `citedCount: 0 -> 1`、`totalFineYuan: 0 -> 5`、`targetHoldingReceipt=true`、`handSlipMeshMounted=true`、`offDeckViolators=0`；同车再试 `pressTicketReason='already_cited'`、`toastVisibleInShot=true` | `captures/duty-3-e2e/07a-fine-terminal-open.png`、`07b-fine-terminal-printing.png`、`07c-handover-too-far.png`、`07b-fine-terminal-cited.png`、`07e-duplicate-rejected.png` |
| **S7** | 脱离解放桥执勤范围提示「正在值班」并禁止越界执勤 | **PASS** | 越界移至 `(-342, -18)` 后钳回 `(-300.29, 152.45, -3.65)`（`inBridgeBoundsAfterClamp=true`），显示 `.td-bounds-banner`（「`正在值班 · 请留在解放桥执勤范围内`」），`bannerDockOverlap.hasOverlap=false` | `captures/duty-3-e2e/08-bounds-warning.png` |
| **N6** | **[r6]** 解放桥人行道站立 60 秒正常车流通行零被撞 | **PASS** | `sidewalk` 站立 30 轮采样 60 秒，`anyHit=false`、`minTraffic=22`、`endResetsDelta=0` | `captures/duty-3-e2e/08b-sidewalk-60s-safe.png` |
| **S8** | 倒地 `>=5` 受击动作、地面喘气缓气、3 段爬起（`>2.4s` 超时回退）与 5 次空格起身 | **PASS** | 6 种受击变体（`distinctCount=6`）、`breathStates` 覆盖 `look_around/pant/prop_up/clutch_side`、`stage1(seg=1) -> stage2(seg=2) -> afterRevert(seg=1, fb=1) -> stage3(seg=3, mash=4) -> 5/5 起身(isDown=false)`，`hudOverlap.hasOverlap=false` | `captures/duty-3-e2e/09a0`、`09a`、`09b1~09b4`、`09b-knockdown-recovered.png` |
| **N5** | **[r5]** 解放桥桥中被撞倒→喘气→3 段爬起全程贴合桥面不掉桥底（`footY` 偏差 `±0.3m` 内） | **PASS** | `midSpot=(-206.42, 44.57)`（`expectedDeckY=151.432m`）82 采样点全周期 `minDelta=0.068m`、`maxDelta=0.134m`、`endDelta=0.13m`、`resetsDelta=0`、`droppedUnderBridge=false` | `captures/duty-3-e2e/09a-knockdown-mashing.png` |
| **N3** | **[r5]** 玩家不可平穿栏杆，按空格可跳上栏杆顶并翻越到另一侧桥面（含西岸与涉水江中主跨） | **PASS** | 西岸 `lx=-117`：平走挡于 `12.435`（`blockedWithoutJump=true`），起跳 `maxAboveDeck=1.142m`、`stoodOnTop=true`、`blockedWaterFrames=0`、越至 `8.432`；江中主跨 `lx=-65`：起跳 `maxAboveDeck=1.122m`、`blockedWaterFrames=0`、越至 `9.318` | `captures/duty-3-e2e/11-railing-jump-crossover.png` |
| **S9** | 十字街「小香港」地下入口 `地面 → 地下(实景 B1 抓拍) → 地面` 通行核查 | **PASS** | `abandonDuty()` + `closePanel()` 后 `noPanelOrBackdrop=true`；沿 `way 985734877` `[-12.7, -38.854]` 进入 B1 开阔中厅 `minFootY=147.12m`、`undergroundShotFootY=147.13m`、往返 `arrivedWaypoints=10/10`、`endFootY=151.5m`、`endResets=0` | `captures/duty-3-e2e/10-shizijie-underground.png` |

---

## 四、视觉巡检结果与跨位转报发现

### 1. 本轮视觉审核通过截图（`research` 子代理逐图纯文字复检）
- **`06-whistle-flag-gestures.png`（PASS）**：交警正面朝向镜头无护栏遮挡，左臂高举过肩齐帽呈白手套拦停手势，右臂上举高持红旗斜指上方；顶栏与底部「`F 拦截开单 · 未戴头盔 ¥5`」及电动车清晰可见。
- **`06b-flag-long-release.png`（PASS）**：交警右臂平举向外挥动红旗，放行挥旗姿态清晰，车道无护栏遮挡。
- **`07b-fine-terminal-cited.png`（PASS）**：同侧非机动车道视角无前景护栏遮挡，顶栏计分更新（`¥5 1起`），「电子罚单」气泡完整清晰。
- **`07e-duplicate-rejected.png`（PASS）**：顶栏下方「`已开过罚单`」Toast 单条居中无叠字，计分未重复累计。
- **`08-bounds-warning.png`（PASS）**：第三人称桥面构图居中，无穿模与残余气泡；「`正在值班，请留在解放桥执勤范围内`」单条清晰无重影。
- **`09b-knockdown-recovered.png` / `08b-sidewalk-60s-safe.png` / `09a0` / `09a` / `09b1` / `09b3`（PASS）**：人行道安全站位、倒地 4 态缓气、回退回落及最终起身站立完整无穿模。
- **`10-shizijie-underground.png`（PASS）**：中山中路 B1 地下通道视野开阔，顶灯、立柱、两侧店铺与站立角色完整清晰，顶栏与右侧景册卡片排版正常。
- **`11-railing-jump-crossover.png`（PASS）**：交警手持红旗凌空翻越机动车道铁护栏，无路灯杆遮挡。

### 2. 非 Hy2 写权范围内的代码级问题（需转报对应位置修缮）
1. **`d44` 第三人称开单 3D 打印机/纸条挂载对象错误**：`web/src/traffic-duty/fine-terminal/ui.ts#L148-L160` 与 `model.ts#L334-L374` 在非第一人称（`isFirstPerson() === false`）时仍将特写模型挂到 `firstPersonCamera`，导致 `07a`/`07b-fine-terminal-printing`/`07c` 中打印机或凭单悬浮在半空。
2. **`mixer.update(dt)` / `emote.tick(dt)` 未做单帧 `dt` 上限钳制**：`web/src/main.ts#L757-L758` 与 `web/src/walk/index.ts#L2820,2836` 直接传入原始帧间隔 `dt`（未像 `dutyFlagHoldTimer` 那样按 `Math.min(0.12, dt)` 钳制），低帧率偶发单帧 `>2.4s` 会瞬间跳过 `duty_flag_stop` 动画而仅靠保持计时器残留 `flagMode='stop'`。
3. **越界警示叠发 Toast 并发风险**：`web/src/traffic-duty/controller.ts#L429-L434` 在 `.td-bounds-banner` 展示期间仍调用 `host.onToast?.(outOfBoundsWarning, 2200)`，并发窗口下可能出现双条重影重叠。
4. **倒地三段 HUD 缺当前高亮区分**：`web/src/walk/knockdown.ts#L1414` 所有已达段共用 `.kd-on`，`09b2`/`09b4` 下难以一眼分辨当前激活段位。
5. **剧情双人机位护栏穿脚**：`web/src/traffic-duty/story/camera-shots.ts#L219-L235` `shot === 'two'` 时近景护栏横过角色小腿（`03c-story-shot-two.png`）。

---

## 五、XP 3.0 r8（k69/k70）18 项扩展与全量收口实测记录

- **执行角色与写权边界**：Hy2 仅修改 `scripts/verify-duty-3.mjs`、`docs/xp-schedule/duty-3-e2e.md`、`docs/xp-schedule/multica-board-ledger.md`；不碰 `web/src/`、不改热点文件、不覆盖既有多端 `dist/` 与 `5176` / `4190` 端口。
- **单测与类型基线**（2026-11-25 实测）：`npx --no-install tsc -p web --noEmit` 退出码 `0`；`node --test web/src/traffic/*.test.mjs web/src/traffic-duty/traffic-duty.test.mjs web/src/traffic-duty/story/story.test.mjs web/src/traffic-duty/fine-terminal/fine-terminal.test.mjs web/src/traffic-duty/handover/handover.test.mjs` **61/61 PASS**（`fail 0`）；`node --check scripts/verify-duty-3.mjs` **OK**。
- **真机脚本扩展内容（`scripts/verify-duty-3.mjs`）**：
  1. **S6 兼容与慢帧防竞态**：手握凭条校验同时检查 `getActorHandBone(t, 'right')` 与 `getActorHandBone(t, 'left')` 的 `'duty-receipt-slip'` 挂载并记录 `handSlipSide`；防重 Toast 改在 2 帧 `rAF` 后触发并在 `1500ms` 窗口内等待 `.toast.show`（`opacity >= 0.45`）避免慢帧过期；`S4`/`S6` 越桥排查通过 `__isOnJiefangApproachCorridor` 兼容 r8 东西引道车流。
  2. **S5 落地沉降兜底**：`__placeAlongBridgeFacingTarget` 在 `clampPosition` 后补 `6 * walk.tick(1/60)` 使 `grounded=true` 稳定后再出旗，防止 `walk/index.ts:2835` `!grounded` 误停 `emote.id=5`。
  3. **S10（桥中 360° 巡视 60 秒零视锥突发）**：经 UI `.td-entry` → `[data-td-action="go-bridge"]` → `KeyF` 对话重新上岗并用真实 `ShiftLeft+KeyW` 走至桥中 `local(0, 17.8)`，匀速转体一周 `60_000ms` 逐帧投影检测镜头 `<=120m` 视锥内零突发生成/消失，存图 `captures/duty-3-e2e/12-traffic-far-spawn.png`。
  4. **S11（`ebike_overload + no_helmet` 叠加 ¥70 与近侧手递交）**：从桥面实车中筛选同时含 `ebike_overload` 与 `no_helmet` 的违规电动车（最多步进 `640s` 仿真时间），真键 `KeyE` 拦停、`KeyF` 开单校验终端快照与 DOM 显示 `¥70`，`Enter` 打印撕单后用 `KeyW` 微步转向骑手、单侧 `<=1.5m` 实测左右手骨距离（`expectedNearSide`），`KeyF` 递交核验 `'duty-receipt-slip'` 仅挂载更近侧手骨、钱包在开单期不变，切侧向 3/4 视角存图 `captures/duty-3-e2e/13-multi-violation-handover.png`。
  5. **S12（满 2 单下班三机位结算与 10% 进账核验）**：真键完成 2 单后沿桥面实走回西桥头交警身旁确认 `cand.action === 'talk_officer'`，按 `KeyF` 触发下班对话，核对至少 `3` 机位切换、台词含开单数/罚款合计/`10%` 分成、钱包内存（`viewer.game.getState().money`）与持久化（`glol.save.v1`）增量严格等于 `Math.round(totalFineYuan * 0.1)` 且 `pendingEarningsYuan` 归零，存图 `captures/duty-3-e2e/14-offduty-settlement.png`。

### 最新全量真机验收实跑结果（`task-3660` · `2026-11-25T18:04:17.217Z`）

- 运行环境：隔离构建 `/tmp/glol-r8-dist` + `node scripts/bake-dams.mjs /tmp/glol-r8-dist/world` + `PREVIEW_DIST_DIR=/tmp/glol-r8-dist node scripts/xp-overnight-preview.ts --port 5294`（退场 `trap` 已清理目录与进程；本轮未剩 Playwright/Chromium 进程）。
- 总览：**`SUMMARY passed=16 failed=2`**，**`ERRS=[]`**，退出码 `1`。
  - **PASS（16/18）**：`S1`–`S9`、`N1`–`N6` 与新增 **`S10`**（`elapsedMs=60467`, `frames=97`, `maxActiveActors=40`, `totalSpawnsObserved=4`, `farDespawnsObserved=4`, `popInCount=0`, `popOutCount=0`）全数通过；修复后 `S5`（`emoteIdAtPeakShot=5`, `flagModeAfterKeyUp='stop'`, `dockStopFlagMode='stop'`）与 `S6`（`toastTriggeredSync=true`, `toastVisibleInShot=true`）稳定通过。
  - **FAIL 1 — `S11`（上游 `web/src/traffic/sim.ts` 逆行逃逸死锁阻塞）**：在 `S10` 桥中站立后，`actor_82627`（`wrongWay=true`, `lx=1.2, lz=14.1`）因持续处于距玩家 `15m` 内被 `sim.ts#L1351` 反复触发 `fleeing` 并偏移至 `lz=14.1` 与来车对头顶死（`speed=0`），后方队列排堵（`actor_84056` `bike_double`, `lx=-29.6, lz=14.1`, `speed=0`）；且 `web/src/traffic/sim.ts#L1204-L1219` 在 `hiddenLifecycle === true`（`if (hl)`）分支只清空 `waitingFor` 而不清除/回收死锁车，致 `maxConcurrentViolators = 2` 配额连续 `640s` 耗尽，无法刷出 `['ebike_overload', 'no_helmet']`。
    - *无死锁前置对照 run（`task-3616`，`17:51:54Z`）*：`S11` 曾实机 **`PASS`**（`simSec=176` 命中 `actor_65915` `['ebike_overload', 'no_helmet']`，终端显示 `数罪并罚 · ¥20+¥50=¥70`，`distLeft=0.765m < distRight=0.977m`，递交后 `slipLeft=true, slipRight=false, actualHandSide='left'`，开单期 `walletMoneyAfterS11=181` 未提前入账）。
  - **FAIL 2 — `S12`（上游 `web/src/traffic-duty/controller.ts` 跨刷新幂等键碰撞吞分红）**：本轮 `preSettle` 为 `citedCount=2, totalFineYuan=100, pendingEarningsYuan=10, expectedShare=10, stateMoney=193`；实走回西桥头交警按 `F` 后 3 机位（`officer/two/player`）及台词数字均完整，结算后 `pendingEarningsYuan=0, settled=true`，但实发 **`earningsYuan=0, rewardYuan=0, deltaWallet=0, deltaSaved=0`**（钱包维持 `193`）。根因：`web/src/traffic-duty/controller.ts#L225,839,929` `shiftUid = ++globalShiftUid` 在每次页面刷新后从 `1` 重新计数，拼出 `traffic_duty_settle:1:100:2:10` 与 `/api/me/save` 存档 `txHistoryRing` 历史同额记录在 `web/src/game/commerce.ts#L501` 命中 `IDEMPOTENT_REPLAY` 返回 `credited: 0`。
    - *未命中同额历史键的前置对照 run（`task-3616`，`totalFineYuan=120`）*：`S12` 曾实机 **`PASS`**（`deltaWallet=12`, `deltaSaved=12`, `stateMoney: 181 -> 193`, `shotsSeen=["officer","two","player"]`, `dialogueMentionsAll=true`）。

### r8 新增视觉巡检与转报 `SHARE+` 清单

1. **视觉巡检记录（`research` 子代理只读查看截图）**：
   - `12-traffic-far-spawn.png`（`PASS`）：人行道站姿贴地、远处机动车道车流生成与护栏无穿模；发现左下角 FPS 状态条（`1 FPS | ...`）背景与底层白色 debug 计数文字（`... 193 calls`）轻微叠字、人行道内侧白色长标线末端有 3 道分叉锯齿。
   - `07e-duplicate-rejected.png`（`PASS`）：中上部「`已开过罚单`」黑底 Toast 清晰居中无遮挡。
   - `14-offduty-settlement.png`（对白/头像/数字完整）：上下黑边、双侧头像及对白核对栏全部清晰；`shot === 'two'` 前景白桥护栏横穿人物腰部且两人间红杆视觉截断（需剧情机位微调）。
   - `13-multi-violation-handover.png`：前序 `task-3616` 抓拍中因 `walk.face()` 只转相机不转人物朝向致主角背对电驴遮挡递单，已在终版脚本加入 `KeyW` 微步转身与侧向 3/4 视角（因最新轮 `task-3660` 触发上游 `sim.ts` 死锁，新版无遮挡构图待 `sim.ts` 修复后一并复验 18/18 全绿）。
2. **转报团队/整合位必修项（`SHARE+`）**：
   - `web/src/traffic/sim.ts#L1204-L1219, L1351, L1372-L1376`：修复 `hiddenLifecycle`（`if (hl)`）下 `wrongWay` 逃逸偏移至 `lz=14.1` 与对向来车顶死且永不回收死锁车辆的问题，防止耗尽 `maxConcurrentViolators = 2` 配额。
   - `web/src/traffic-duty/controller.ts#L225, L839, L929`：将 `shiftUid` / `idempotencyKey` 改为含会话唯一时间戳/随机 nonce（如 `${Date.now()}-${++globalShiftUid}`），杜绝页面刷新后同金额班次命中 `IDEMPOTENT_REPLAY` 导致 10% 分红归零。
   - `web/src/main.ts#L604-L629` & `web/src/traffic-duty/controller.ts#L1350-L1364`：补传 `violations: req.violations`、`getActorHandBone: (actor, side) => ...`（勿硬编码 `'right'`）、`onTicketReceived` 透传 `handSide` 及接入 `playTicketHandover`。

---

## 六、r9 全量合流修复与 18/18 实机收口记录（Carbon · `2026-11-25T19:44:51.207Z`）

- **修复与合流项**：
  1. `web/src/traffic-duty/controller.ts`：每班生成唯一 `shiftNonce` 拼入 `idempotencyKey`（`traffic_duty_settle:${shiftUid}:${shiftNonce}:${totalFineYuan}:${citedCount}:${payout}`），彻底解决页面重载后同金额班次命中 `IDEMPOTENT_REPLAY` 吞分红问题；`commitIssuedCitation` 尊重 `citationRecord.handedSide` 双侧挂载。
  2. `web/src/traffic/sim.ts`：逆行（`reverse === true`）逃逸电驴保持 `WRONG_WAY_LATERAL_OFFSET` 不偏移至对向正中、`fleeUntil` 到期复位 `dutyState = 'normal'` 恢复横向衰减，并为对头死锁车引入 `ghostPassUntil` 动态解卡窗口（零视锥突发跳变）。
  3. `web/src/walk/index.ts`、`web/src/main.ts`、`web/src/traffic-duty/fine-terminal/engine.ts`：合流接入 `createTicketHandover` / `bindTicketHandover`、`playTicketHandover`、`getDutyPrinterSlotWorldPosition`、`tearOffSlip(side)`、`violations: req.violations` 及双侧 `getActorHandBone(actor, side)`。
  4. 构建与热刷新：独立目录构建 + `bake-dams.mjs` 后同步至 `dist/`（`assets/main-GSSNZlx2.js`），不中断 `http://127.0.0.1:5176/?mode=walk` 在线预览服务。
- **全量验证结果**：
  - 单测与门禁：模块单测 **85/85 PASS**、`npx tsc -p web --noEmit` **0 错**、`npm run check:api` **0 错**。
  - 罚款与下岗专项实机 `node scripts/duty-r9-fine-check.mjs`：**`ALL_R9_FINE_CHECKS_PASSED`**（`¥70` 数罪并罚 + `¥50` 常规 = `¥120`，交差下岗钱包与存档实增 `+¥12`，`183 -> 195`）。
  - 18 项全量 E2E `node scripts/verify-duty-3.mjs`（针对在线 `http://127.0.0.1:5176`）：**`SUMMARY passed=18 failed=0`**，**`ERRS=[]`**，退出码 `0`（含 `S10` `popInCount=0, popOutCount=0`；`S11` `simSec=80` 命中 `['ebike_overload','no_helmet']` `¥70` 近侧左手递交 `slipLeft=true, slipRight=false`；`S12` 连续同额 `¥120` 班次跨会话正常入账 `deltaWallet=12, deltaSaved=12, 207 -> 219`）。

---

## 七、r9 复核与终轮收口实测记录（Hy2 · `2026-11-25T21:54:52Z`）

- **写权与环境边界**：Hy2 仅修改 `scripts/verify-duty-3.mjs`、`docs/xp-schedule/duty-3-e2e.md`、`docs/xp-schedule/multica-board-ledger.md`；未碰 `web/src/`、`dist/` 与 `5176`/`4190` 端口。
- **本轮 `scripts/verify-duty-3.mjs` 加固要点**：
  1. `attachErrorListeners` 新增 `[HTTP_ERR]` 监听，捕获 `status >= 400` 响应并记入 `ERRS`。
  2. `S5` 长按 `KeyE` 放行阶段实时步进 `trafficDuty.step(0.1)+walk.tick(0.1)`；`06`、`06b` 机位调整至非机动车道无灯杆侧（避开 `lz=±18.9` 路灯杆）。
  3. `S6` 防重 Toast 在截屏后排空 300ms GPU 队列，若慢帧致 `2.2s` 计时器提前过期则自动再实按一次 `pressTicket()`。
  4. `S11` 延至 `780ms` 近峰值递交瞬间，相机从近侧手方位侧前方取景，解除交警躯干/车筐遮挡并避开 `z=±12` 护栏（`13-multi-violation-handover.png`）。
  5. `walkAlongBridgePointWithKeys` 新增连续 2 步位移 `<0.12m` 时实按 `Space` 跨越栏杆/路缘；`S12` 改为实走至南侧人行道后贴近西桥头交警至 `(-267.3, 25.8)`（`stopDistM=0.65`、`officerDistActual <= 2.0m`），保证双人结算同框完整。
- **全量验证结果（针对在线 `http://127.0.0.1:5176/?mode=walk`，`HTTP 200`，`dist/index.html` 与线上首包 MD5 同为 `279e6879fc15e0582b3f7680140addb4`）**：
  - 宿主机单测与静态门禁：`npx --no-install tsc -p web --noEmit` 0 错、`npm run check:api` 通过、`node --test web/src/traffic/*.test.mjs web/src/traffic-duty/traffic-duty.test.mjs web/src/traffic-duty/jiefang-railings.test.mjs web/src/traffic-duty/story/story.test.mjs web/src/traffic-duty/handover/handover.test.mjs web/src/traffic-duty/fine-terminal/fine-terminal.test.mjs web/src/walk/knockdown.test.mjs` **76/76 PASS**（`fail 0`）、`node --check scripts/verify-duty-3.mjs` `OK`。
  - 18 项 E2E 全量实跑（`captures/duty-3-e2e/report.json` 时间 `2026-11-25 13:54:52` / UTC `2026-11-25T21:54:52.679Z`，严格晚于 `dist/index.html` `12:39:55`）：**`SUMMARY passed=18 failed=0`**、**`ERRS=[]`**、退出码 `0`。
    - `S10`：`elapsedMs=60435`、`frames=105`、`popInCount=0`、`popOutCount=0`、`totalSpawnsObserved=4`、`farDespawnsObserved=4`。
    - `S11`：`simSec=268` 命中 `actor_73810` `['ebike_overload', 'no_helmet']`，DOM 与快照均核验 `¥70`，`distLeft=0.765m < distRight=0.977m`，递交后 `slipLeft=true, slipRight=false, actualHandSide='left'`，开单期钱包保持 `269`。
    - `S12`：实走到西桥头 `officerDistanceM=1.89m`（`walkPos=(-267.63, 25.55)`），`citedCount=2`、`totalFineYuan=140`，`shotsSeen=["officer","two","player"]`、`dialogueMentionsAll=true`，结算后 `deltaWallet=14`、`deltaSaved=14`（`269 -> 283`）、`pendingEarningsYuan=0`。
- **终轮视觉审计（`research` 子代理 `e5621827` 逐图只读复核）**：
  - `06-whistle-flag-gestures.png` / `06b-flag-long-release.png`：无灯杆遮挡，左臂抬至嘴前作吹哨、右臂高举/平挥红旗，电驴橙色转向灯亮起/熄灭、脚轮贴地、HUD 无重叠。
  - `07e-duplicate-rejected.png`：中上部「`已开过罚单`」Toast 居中清晰，无残留开单面板或报错。
  - `13-multi-violation-handover.png`：`PASS`。交警（左）与超载 3 人无盔电驴（右）两侧分明无遮挡，交警手套与骑手手/车把交接正中可见斜放白色纸片罚单；顶栏 `¥70 / 待领10% ¥7` 与气泡清晰，前景无护栏/灯杆横切。
  - `14-offduty-settlement.png`：`PASS`。上下电影黑边、双侧 3D 头像、绿框清点 `2 笔 · 合计 140 元 · 10% 分得 14 元` 准确完整，交警与志愿者双人完整入画无边缘裁切、无栏杆穿模（仅背景栏杆接缝露出一条黑色斜条带）。
- **构建时间戳与进程核查（客观如实标注）**：
  - 本仓库 `web/src/traffic-duty/story/portraits.ts` 与 `web/src/traffic-duty/npc-officer.ts` mtime 为 `2026-11-25 13:00:02`（晚于现行 `dist/index.html` 的 `2026-11-25 12:39:55`，即 `dist >= newest_src` 为 `False`）；虽静态扫描两文件全部 58 个长字符串标识均已存在于 `dist/assets/*.js`，但按发布纪律仍需构建位/整合位确认是否执行一次最新全量 `dist/` 重编。
  - 无本脚本 Chromium / `verify-duty-3.mjs` 残留进程。
