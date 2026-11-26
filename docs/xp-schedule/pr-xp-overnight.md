# `feat/xp-overnight` PR 收口总览（功能清单 · 验收与结果 · 已知遗留）

- **对比基线**：`origin/main`（`583ef383`） → `HEAD`（`1970c780`，较 `origin/main` 含 10 个合并与特性提交，全量差异 `304` 个文件、`+89,343 / -2,179` 行）
- **构建产物 SHA**：`dist/version.json` 与当前 `HEAD` 一致，同为 `1970c780ebee90c1d1f178e73bcddacb69bbe197`
- **核心关联文档**：
  - 十字街地下重叠与主线对照证据：[underground-overlap.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/underground-overlap.md)
  - 双组全量合入映射表：[ol-full-merge-map.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/ol-full-merge-map.md)
  - 辅警 3.0 实机 E2E 验收单：[duty-3-e2e.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/duty-3-e2e.md)
  - r9 / r10 交警验收单：[r9-acceptance.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/r9-acceptance.md)、[review.md](file:///Users/pan-work/guilinol-xp-overnight/captures/duty-r10-officer-review/review.md)
  - 核心冒烟报告（k23–k25）：[smoke-report.md](file:///Users/pan-work/guilinol-xp-overnight/captures/ol-full-merge/smoke-report.md)

---

## 一、功能清单

### 1. 本组核心新增玩法与 r4 收口项（`feat/xp-overnight`）

1. **辅警 3.0 解放桥定点执勤闭环**（[controller.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/controller.ts)、[ui.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/ui.ts)、[types.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/types.ts)、[duty-keys.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/duty-keys.ts)）：
   - 右上悬浮入口 `.td-entry` 导引「前往解放桥交警」，西桥头与交警按 `F` 领装上岗，脱离 `240 m` 解放桥桥面范围每帧触发边界钳制与横幅提示。
   - **三键执勤仲裁**：`Q` 吹哨（减速/迫停逃逸车）、短按 `E` 挥旗拦停、长按 `E` 放行、`F` 通过统一仲裁器（[interact-arbiter.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/walk/interact-arbiter.ts)）开单或递交，支持触屏 `.td-signal-dock` 与 `F1` / 按键卡自动切「执勤」分组。
2. **解放桥独立车流与全桥三道连续护栏**（[duty-traffic.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic/duty-traffic.ts)、[sim.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic/sim.ts)、[rider-pool.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic/rider-pool.ts)、[jiefang-railings.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/jiefang-railings.ts)）：
   - 两轮车 100% 走两侧黑色非机动车道（人行道 0 辆、站立 60 秒 0 被撞），活跃违规车 `<= 15%` 上限，远端刷新与消失。
   - 南/中/北 3 道连续实体护栏零缺口覆盖全桥，平走阻挡、按 `Space` 可踩顶翻越（含江中主跨不误判落水）。
3. **手持电子罚单终端、腰挂打印机与左右智能递单**（`web/src/traffic-duty/fine-terminal/`、`handover/`、[duty-props.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/gear/duty-props.ts)、[ticket-handover.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/emote/ticket-handover.ts)）：
   - 支持 6 类违章与数罪并罚（基准 ¥50、超载 ¥20、非法改装 ¥100；超载+未戴头盔叠加 ¥70），同车防重开单。
   - 打印吐纸后扯单、打印机回腰胯；距离 `> 1.5 m` 禁递、`<= 1.5 m` 依骑手左右就近手骨挂载 `'duty-receipt-slip'` 纸条。
   - 执勤期钱包不变，回桥头找交警按 `F` 交差下岗，经 `shiftNonce` 防碰撞幂等键将 `10%` 提成打入钱包；点「下岗/放弃」后可无缝离开解放桥。
4. **`r10` 统一画风交警模型与 GTA 式多机位剧情对话**（`web/src/traffic-duty/officer-look/`、[npc-officer.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/npc-officer.ts)、`story/`、[outfits.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/walk/outfits.ts)）：
   - 复用 `#389` 玩家骨架管线（`12,674` 面 / `9` 网格），白顶帽、`#ccee1c` 荧光背心印「桂林交警」、黑色执勤腰带与哑光白手套。
   - 对话框含电影黑边、5 个实时机位与双侧实时表情头像；同步挂载十字街东北安全岛岗亭交警（`SHIZIJIE_OFFICER_SPOT`）与 4 悬臂动态红绿灯（[traffic-signals-overlay.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/traffic-signals-overlay.ts)）。
5. **碰撞倒地 `knockdown` 状态机**（[knockdown.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/walk/knockdown.ts)）：
   - 6 种受击变体、4 种呼吸撑地动作、停顿 `> 2.4s` 自动回退一段、连按 5 次 `Space` 爬起、桥中被撞全程贴地不穿模。
6. **地下商业街系统（含同局体验路线与主线对照）**（[underground-overlap.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/underground-overlap.md)）：
   - 已合入 `szj`（`web/src/shizijie/`）2.5D 十字街室内商业街、`xxg`（`web/src/xiaoxianggang/`）中心广场小香港地下城与 `web/src/locomotion/stairs/` 步梯系统。
   - `HEAD`（`1970c780`）同时保留本组 `pipeline/shizijie_underpass.py` + `public/landmarks/shizijie.{glb,json}` + `web/src/tunnels.ts` `-4.2 m` B1；切换策略与主线对照实测见专题报告。
7. **王城商厦「蜜雪林城」饮品小摊（`r4` 已恢复默认隐藏）**（[site.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/drinks/site.ts#L206-L221)、[site-gate.test.mjs](file:///Users/pan-work/guilinol-xp-overnight/web/src/drinks/site-gate.test.mjs)）：
   - 完整保留点单、制饮叫号、钱包扣款与 `KeyI` 捧杯饮用逻辑；已于 `a85d226a` 收口为仅 URL 显式传 `?drinks` 才挂载，默认裸链不上架。
8. **`r4` 按键作用域隔离、执勤禁拳与执勤禁烟（已合入 `a85d226a`）**：
   - [keymap.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/input/keymap.ts#L42-L92)：以 `isDutyScopeActive()` 隔离执勤 `KeyE` 挥旗（`dutyFlag`）与非执勤长按 `E` 扶人救援（`rescue`）。
   - [combat/controller.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/combat/controller.ts#L25-L85)：导出 `isPunchBlockedByDuty` 并在 `punch()` / `pointerdown` / `pointerup` / `keydown` 全链路拦截执勤态出拳，**保留执勤期间扶人救援**。
   - [smoke/session.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/smoke/session.ts#L3-L60) & [walk/index.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/walk/index.ts#L380-L435)：执勤态弹出 `执勤中禁止吸烟`，`setTrafficVolunteerMode(true)` 上岗即调用 `cancelSmokeForDuty(true)` 收烟并切回 `hand` 槽。

### 2. 已同步合入 `origin/main`（截至 `583ef383`）主线全部更新

- 截至 `1970c780`（依次合并 `a3e7a630`、`613fcb47`、`bcf529f0`、`583ef383`）：
  - 全城 `city-upgrade` R1–R3（512 m 分片、96 店门头/竖招）、分级后处理光影 `?gfx` 与墙体/地标遮挡剔除；
  - 铁路全线（含定江第七段与西二环双洞、第九段桂林北站场及衡柳正线 `platform-access` / `platform-grade`）、桂林站、人民医院 `renmin_hospital` 与两江四湖船闸；
  - `IDOK-412` 十字街外侧人行道秩序与无斑马线护栏、钓鱼 2.0、香烟 2.0（`#389` 手骨）、拳击/共享电驴 `shared-ebike-unlock`、街景路网寻路、设备定位、触控 `IDOK-256`、`roster` 透传修复与 `/errors/*.html`。

---

## 二、验收命令和结果

### 2.1 本轮直接实测通过项（`k30` + `1970c780` `/tmp/szj-main` 复测）

1. **`k30` 祖先关系、无冲突标记与全局 TypeScript 检查（2026-11-26 在 `1970c780` 实跑）**：
   ```bash
   cd /Users/pan-work/guilinol-xp-overnight && \
   git merge-base --is-ancestor origin/main HEAD && \
   ! git grep -nE '^(<<<<<<<|>>>>>>>)' -- web pipeline lib scripts && \
   npx --no-install tsc -p web --noEmit
   ```
   - 实测结果：`ANCESTOR_OK=0`、`GREP_CLEAN=0`、`TSC_EXIT=0`、联合执行 **`K30_EXIT=0`**（另附加检查 `public/` 与 `docs/` 亦零 `<<<<<<<`/`>>>>>>>` 冲突标记；工作树 `git status -s` 仅含未追踪符号链接 `?? .venv` 与 `?? raw`）。
2. **`/tmp/szj-main` 主线十字街三件套替换复测（基于 `HEAD 1970c780` + `origin/main 583ef383`）**：
   - 将 `pipeline/landmarks/shizijie.py`、`public/landmarks/shizijie.glb`、`public/landmarks/shizijie.json` 替换为 `git show origin/main` 版本后实跑（已删 `/tmp/szj-main`，`TMP_CLEAN=1`）：
     ```text
     npx --no-install tsc -p web --noEmit -> TSC_EXIT=0
     ESBUILD_BINARY_PATH=/tmp/esb/package/bin/esbuild node --import tsx --test \
       web/src/locomotion/stairs/*.test.mjs web/src/shizijie/*/*.test.mjs scripts/test-tunnel-ceiling.mjs
     -> tests 46 | pass 46 | fail 0 | duration_ms 2780.588666 | UNIT_EXIT=0
     ```
   - 前置 `10/10` `web/src/walk/obstacle-volumes.test.mjs`、`scripts/check-shizijie-islands.py` 及 `web/src/tunnels.ts` 双态探针结论同 [underground-overlap.md#L195-L259](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/underground-overlap.md#L195-L259)。
3. **本领地双文档链接与节完整性自检**：
   ```bash
   cd /Users/pan-work/guilinol-xp-overnight && test ! -e /tmp/szj-main && ls -lh docs/xp-schedule/underground-overlap.md docs/xp-schedule/pr-xp-overnight.md
   ```

### 2.2 仓库既有验收存档与同波实测记录（附时间戳与范围）

| 验收项目与出处 | 命令 / 范围 | 实测结果 |
| :--- | :--- | :--- |
| **核心冒烟（k23–k25）**<br>[smoke-report.md](file:///Users/pan-work/guilinol-xp-overnight/captures/ol-full-merge/smoke-report.md) | `node captures/ol-full-merge/smoke-core.mjs`（端口 `47843`，`b7290b6b` 产物） | 退出码 **`0`**，`/?mode=walk` 与 `/?verify&mode=walk&szj` 均 `HTTP 200`，`trafficDuty`/`dutyOfficers`/`xxg`/`szj`/`cityUpgrade`（+6 附带探针）全 **`true`**，`pageerrors=[]`，`47840..47849` 监听数 **`0`**，2 张实拍 `PASS` |
| **全量融合真机巡检（2026-11-26T08:44:41Z）**<br>[report.json](file:///Users/pan-work/guilinol-xp-overnight/captures/ol-full-accept/report.json) | `node scripts/verify-ol-full.mjs`（针对 `http://127.0.0.1:5176` `b7290b6b` 产物，Hy2 实跑） | **`passed=11 failed=2 shots=13 ERRS=[]`**（`OL3` 钓鱼碑、`OL4` 新烟盒、`OL5` `/404`、本组交警/对话/¥70/左右递单/B1 与 `XXG_ENTRY`、`SZJ_ENTRY` 全 **`PASS`**；仅 `OL1`/`OL2` 因 `public/world` 缺离线烘培标记 `FAIL`） |
| **r4 单测门禁（团队本波提交记录）** | `combat/duty-gate.test.mjs`、`walk/knockdown.test.mjs`、`drinks/site-gate.test.mjs`、`drinks/integration/integration.test.mjs`、`input/keymap-conflict.test.mjs` | 已于 `a85d226a` 合入；Gemini 实报 `duty-gate + smoke` 13/13 PASS（`k33`），Carbon 实报 `drinks` 门控 2/2 与集成 8/8 PASS（`k35/k36`） |
| **辅警 3.0 r9 18 项 E2E & r10 交警 v3**<br>[duty-3-e2e.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/duty-3-e2e.md#L135-L157)、[review.md](file:///Users/pan-work/guilinol-xp-overnight/captures/duty-r10-officer-review/review.md#L157-L164) | `verify-duty-3.mjs`（2026-11-25 合流包）；`render-review.sh v3`（`613fcb47` 后树） | 单测 76/76（合流 85/85）PASS、`SUMMARY passed=18 failed=0 ERRS=[]`；交警 `12674` 面 `9` 网格背字「桂林交警」+ 黑腰带 `officerErr=null` |
| **隔壁组 `xxg`/`szj` 单测兼容**<br>[xxg-tests.md](file:///Users/pan-work/guilinol-xp-overnight/captures/ol-full-merge/xxg-tests.md) | `test:stairs`（9/9）、`test:shizijie`（45/45）、`xiaoxianggang`（19/19 + 脚本 7/7） | 全部 PASS，TS 0 错 |

---

## 三、已知遗留

1. **十字街方案二选一与实景重影现状（待终判落定）**：
   - 当前 `HEAD`（`1970c780`）保留了本组 `pipeline/landmarks/shizijie.py` + `public/landmarks/shizijie.{glb,json}`，虽然无冲突标记，但仍存在地面双雨棚叠穿与步行下梯被 `szj` 抢占拦截问题（详见 [underground-overlap.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/underground-overlap.md)）。若 PR 采用主线三件套（切回 `origin/main` 版本）则消重影且 `szj` 四口全通，但须同步重新执行构建使 `dist/` 与最终代码保持一致。
2. **`verify-ol-full.mjs` 两项上游世界切片烘培缺口（不影响 `feat/xp-overnight` 源码合并）**：
   - `OL1_DINGJIANG_TUNNEL`（`public/world` & `dist/world` 缺 `#398` 定江新线隧道/轨道切片 `djTunnels=0`）与 `OL2_SHIZIJIE_ORDER`（`roads/-2_-1.json.gz` 缺 `#291` `lane.street` 与 `lane.npcWalks` 致该项全城车流采样为 `0`）在最新 [report.json](file:///Users/pan-work/guilinol-xp-overnight/captures/ol-full-accept/report.json#L78-L119) 中仍为 `FAIL`（`01`/`04` 图亦记有 `[瑕疵]`）。
3. **建 PR 前最终包态与交付校验提醒**：
   - 当前 `dist/version.json` SHA 已对齐 `1970c780`，但需在推进 `push + gh pr create` 前复核 `knockdown.test.mjs`、`npm run test:emote`、在最新 `1970c780`（含 `a85d226a` 执勤禁拳/禁烟/蜜雪默认关与 `583ef383` 第九段）上重跑 `smoke-core.mjs` 及核对 `gh pr view --json state,mergeable`；提交范围严禁夹带未追踪的 `.venv` / `raw`。
4. **非阻断历史微瑕**：
   - [engine.ts#L380](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/fine-terminal/engine.ts#L380) 扯单初帧手侧选型与第 632 行递交瞬间差 ~0.1 m（[r9-acceptance.md#L95-L98](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/r9-acceptance.md#L95-L98)）；[spots.ts#L11-L45](file:///Users/pan-work/guilinol-xp-overnight/web/src/play/spots.ts#L11-L45) 暂无「中心广场 / 小香港」大地图搜索词条。
