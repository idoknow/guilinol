# `feat/xp-overnight` PR 收口总览（功能清单 · 验收与结果 · 已知遗留）

- **对比基线**：`origin/main`（`613fcb47`） → 合入后 `HEAD`（`b7290b6b` + 工作区收口中变更）
- **核心关联文档**：
  - 十字街地下重叠与主线对照证据：[underground-overlap.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/underground-overlap.md)
  - 双组全量合入映射表：[ol-full-merge-map.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/ol-full-merge-map.md)
  - 辅警 3.0 实机 E2E 验收单：[duty-3-e2e.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/duty-3-e2e.md)
  - r9 / r10 交警验收单：[r9-acceptance.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/r9-acceptance.md)、[review.md](file:///Users/pan-work/guilinol-xp-overnight/captures/duty-r10-officer-review/review.md)

---

## 一、功能清单

### 1. 本组核心新增玩法（`feat/xp-overnight`）

1. **辅警 3.0 解放桥定点执勤闭环**（[controller.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/controller.ts)、[ui.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/ui.ts)、[types.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/types.ts)、[duty-keys.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/duty-keys.ts)）：
   - 右上悬浮入口 `.td-entry` 导引「前往解放桥交警」，西桥头与交警按 `F` 领装上岗，脱离 `240 m` 解放桥桥面范围每帧触发边界钳制与横幅提示。
   - **三键执勤仲裁**：`Q` 吹哨（减速/迫停逃逸车）、短按 `E` 挥旗拦停、长按 `E` 放行、`F` 通过统一仲裁器（[interact-arbiter.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/walk/interact-arbiter.ts)）开单或递交，支持触屏 `.td-signal-dock` 与 `F1` / 按键卡自动切「执勤」分组。
2. **解放桥独立车流与全桥三道连续护栏**（[duty-traffic.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic/duty-traffic.ts)、[sim.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic/sim.ts)、[rider-pool.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic/rider-pool.ts)、[jiefang-railings.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/jiefang-railings.ts)）：
   - 两轮车 100% 走两侧黑色非机动车道（人行道 0 辆、站立 60 秒 0 被撞），活跃违规车 `<= 15%` 上限，远端刷新与消失。
   - 南/中/北 3 道连续实体护栏零缺口覆盖全桥，平走阻挡、按 `Space` 可踩顶翻越（含江中主跨不误判落水）。
3. **手持电子罚单终端、腰挂打印机与左右智能递单**（`web/src/traffic-duty/fine-terminal/`、`handover/`、[duty-props.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/gear/duty-props.ts)、[ticket-handover.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/emote/ticket-handover.ts)）：
   - 支持 6 类违章与数罪并罚（基准 ¥50、超载 ¥20、非法改装 ¥100；超载+未戴头盔叠加 ¥70），同车防重开单。
   - 打印吐纸后扯单、打印机回腰胯；距离 `> 1.5 m` 禁递、`<= 1.5 m` 依骑手左右就近手骨挂载 `'duty-receipt-slip'` 纸条。
   - 执勤期钱包不变，回桥头找交警按 `F` 交差下岗，经 `shiftNonce` 防碰撞幂等键将 `10%` 提成打入钱包；点「下岗/放弃」后可无缝切换回自由漫游。
4. **`r10` 统一画风交警模型与 GTA 式多机位剧情对话**（`web/src/traffic-duty/officer-look/`、[npc-officer.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/npc-officer.ts)、`story/`、[outfits.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/walk/outfits.ts)）：
   - 复用 `#389` 玩家骨架管线（约 `12.67k` 面 / `9` 网格），白顶帽、`#ccee1c` 荧光背心印「桂林交警」、黑色执勤腰带与哑光白手套。
   - 对话框含电影黑边、5 个实时机位与双侧实时表情头像；同步挂载十字街东北安全岛岗亭交警（`SHIZIJIE_OFFICER_SPOT`）与 4 悬臂动态红绿灯（[traffic-signals-overlay.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/traffic-signals-overlay.ts)）。
5. **碰撞倒地 `knockdown` 状态机**（[knockdown.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/walk/knockdown.ts)）：
   - 6 种受击变体、4 种呼吸撑地动作、停顿 `> 2.4s` 自动回退一段、连按 5 次 `Space` 爬起、桥中被撞全程贴地不穿模。
6. **地下商业街系统**（待根据 PR 十字街拍板最终定型）：
   - 并入的隔壁组 `szj`（`web/src/shizijie/`）独立 2.5D 十字街室内商业街与 `xxg`（`web/src/xiaoxianggang/`）中心广场小香港地下城，及 `web/src/locomotion/stairs/` 步梯系统。
   - 本组 `pipeline/shizijie_underpass.py` + `web/src/tunnels.ts` 的 `-4.2 m` `shizijie.glb` B1 地下通道（与 `szj` 同址，见 [underground-overlap.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/underground-overlap.md)）。
7. **王城商厦「蜜雪林城」饮品小摊（r4 默认关闭待命）**（[site.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/drinks/site.ts#L206-L221)）：
   - 完整保留点单、制饮叫号、钱包扣款与 `KeyI` 捧杯饮用逻辑；按老板 `r4` 要求，通过 `shouldMountDrinksShop()` 默认关闭（仅 URL 显式传 `?drinks` 才挂载）。
8. **r4 按键作用域与执勤禁行为门禁**：
   - [keymap.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/input/keymap.ts)：按执勤激活态隔离 `KeyE` 挥旗（`dutyFlag`）与长按 `E` 扶人救援（`rescue`），避免跨作用域抢键；保留非执勤期原有手感。
   - 执勤期禁用拳击（`combat` 执勤门禁，保留扶人）与禁用香烟（上岗即收烟并禁止切换香烟槽），相关修改随同波团队成员落盘整合。

### 2. 同步合入 `origin/main`（`a3e7a630..613fcb47`）主线能力

- 全城 `city-upgrade` R1–R3（512 m 分片、96 店门头/竖招/空调外机）；分级后处理光影（`?gfx=low|mid|high`）与墙体/地标遮挡剔除；定江七段铁路与西二环双洞隧道；桂林站与两江四湖船闸/堰坝重制；`IDOK-412` 十字街外侧人行道秩序与无斑马线护栏；钓鱼 2.0（10 水域 + 电子排行碑）；香烟 2.0（6 款翻盖烟盒 + `#389` 手部重构）；街景路网寻路 `nav`、设备定位、触控 `IDOK-256`、`update-cards`、自包含静态错误页 `/errors/*.html`。

---

## 二、验收命令和结果

> 原则：以下明确区分**本人在 `/tmp/szj-main` 与本领地最新实测**，以及**仓库已落盘的阶段验收记录**；同波并发成员仍在修改的门禁单测及全包 `npm run build` / `smoke-core.mjs` 待合并收口步最终复跑。

### 2.1 本轮 `/tmp/szj-main`（十字街三件套切回 `origin/main`）实测结果

> 执行时已清除 `node_modules` 副本、软链本仓 `node_modules`，用 `git show origin/main` 覆盖 `pipeline/landmarks/shizijie.py`、`public/landmarks/shizijie.glb`、`public/landmarks/shizijie.json`，测试完成后已删除 `/tmp/szj-main`。

| 检验项 | 实际执行命令（在 `/tmp/szj-main`） | 实测结果与退出码 |
| :--- | :--- | :--- |
| TypeScript 全局检查 | `npx --no-install tsc -p web --noEmit` | **0 错误，`TSC_EXIT=0`** |
| `shizijie` + `stairs` + `tunnels` 单测 | `ESBUILD_BINARY_PATH=/tmp/esb/package/bin/esbuild node --import tsx --test web/src/locomotion/stairs/*.test.mjs web/src/shizijie/*/*.test.mjs scripts/test-tunnel-ceiling.mjs` | **46/46 PASS（`fail 0`, `2560.94ms`, `UNIT_EXIT=0`）** |
| 注：原生 strip-types 对照 | 同上改为 `node --experimental-strip-types --test ...` | `45/46 PASS`；仅 `scripts/test-tunnel-ceiling.mjs` 因无扩展名 `import './crossing-panels'` 报 `ERR_MODULE_NOT_FOUND` |
| 障碍体与桥栏单测 | `ESBUILD_BINARY_PATH=/tmp/esb/package/bin/esbuild node --import tsx --test web/src/walk/obstacle-volumes.test.mjs` | **10/10 PASS（`fail 0`, `2992.58ms`）** |
| 十字街安全岛与连通检查 | `PYTHONPATH=/tmp/szj-main/pipeline:/tmp/szj-main/pipeline/landmarks /Users/pan-work/guilinol-xp-overnight/.venv/bin/python scripts/check-shizijie-islands.py` | 4 安全岛间距全过；输出 `Underground manifest connectivity OK: 4/4 stairs in 1 component` 及 `shizijie.json underground: not yet populated (manifest fallback active)` |
| `tunnels.ts` 与地标兼容探针 | `node --import tsx` 实调 `parseShizijieLandmarkUnderground` / `underpassFloor` / `tunnelGeometry` | 纯主线（无 `manifest.shizijieUnderpass`）：`parse=null`、`underpassFloor=undefined`、`tunnelGeometry=null`；`szj` 代码 `ZERO_REFS` 无耦合，可正常进出 |

### 2.2 仓库既有验收存档汇总（来自已落盘报告，供合包对齐核查）

| 验收批次与报告来源 | 覆盖命令 / 脚本 | 归档实测结果 | 备注与适用条件 |
| :--- | :--- | :--- | :--- |
| **r9/r10 辅警与递单**（[duty-3-e2e.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/duty-3-e2e.md#L121-L157)、[r9-acceptance.md](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/r9-acceptance.md#L17-L24)） | `npx tsc -p web --noEmit`、`npm run check:api`、模块单测、`npm run test:emote`、`node scripts/duty-r9-fine-check.mjs`、`node scripts/verify-duty-3.mjs` | 单测 76/76（合流轮 85/85）PASS、`knockdown` 10/10、`emote` 7/7、真机 **`SUMMARY passed=18 failed=0`, `ERRS=[]`** | 基于 2026-11-25 合流包实跑（先于最新 `origin/main` `b7290b6b` 合并与 `r4` 收口修改） |
| **r10 交警外观对照 v3**（[review.md](file:///Users/pan-work/guilinol-xp-overnight/captures/duty-r10-officer-review/review.md#L157-L164)） | `captures/duty-r10-officer-review/render-review.sh` | 交警 `12674` 面 `9` 网格、`creator-face`/`hair`/`body-outline` 完整、背印「桂林交警」+ 黑腰带通过、`officerErr=null` | 已在合入 `origin/main 613fcb47` 后树上复审通过 |
| **隔壁组 `xxg`/`szj` 单测预检**（[xxg-tests.md](file:///Users/pan-work/guilinol-xp-overnight/captures/ol-full-merge/xxg-tests.md)） | `node --test web/src/locomotion/stairs/*.test.mjs web/src/shizijie/*/*.test.mjs`、`web/src/xiaoxianggang/*/*.test.mjs`、`scripts/xiaoxianggang/xxg-scripts.test.mjs` | `stairs` 9/9、`szj` 36/36、`xxg` 19/19、`xxg-scripts` 7/7 全部 PASS，TS 报错 `0` | Carbon 并入无损合入后在本仓实跑通过 |
| **首轮全量整合真机 `verify-ol-full.mjs`**（[report.json](file:///Users/pan-work/guilinol-xp-overnight/captures/ol-full-accept/report.json)） | `node scripts/verify-ol-full.mjs`（2026-11-26T07:55Z） | **`passed=8 failed=5, ERRS=[]`**（本组交警/对话/¥70/左右递单/B1 与 `xxg` `PASS`；`OL1~OL4` 与 `SZJ_ENTRY` `descending` 未及等待 `inside` 呈 `FAIL`） | 属于首轮合入态抓拍记录；仍需按当前最终代码重打 `dist/` 后补全闭环冒烟与复测 |

### 2.3 本领地文档校验实跑

```bash
cd /Users/pan-work/guilinol-xp-overnight
test ! -e /tmp/szj-main && ls -lh docs/xp-schedule/underground-overlap.md docs/xp-schedule/pr-xp-overnight.md
```

---

## 三、已知遗留

1. **十字街三件套 `UU` 合并冲突未决（最高优阻塞，待老板拍板后统一落盘）**：
   - 当前工作区 `pipeline/landmarks/shizijie.py`、`public/landmarks/shizijie.glb`、`public/landmarks/shizijie.json` 仍处于 `UU` 冲突态（其中 `shizijie.json` 含 `<<<<<<< HEAD` 冲突标记导致 `loadShizijieUnderground()` 静默失效）。
   - 若选 **PR 用主线十字街**（`git checkout --theirs` 或 `origin/main` 三件套）：完全消除地面双雨棚叠穿且 `szj` 4 口正常进出，但本组 `-4.2 m` `shizijie.glb` B1 不再走梯进入；若选 **保留本组 B1**：需取 `--ours` 并对 `szj` 地面抢占与 `ensureSzjHoods()` 加互斥开关。
2. **并发收口改造与 `dist/` 重编尚未统一收口**：
   - 工作区同波队友刚写入/正在收口：`web/src/input/keymap.ts`（`MM` 状态 + 新增 `keymap-conflict.test.mjs`）、`web/src/drinks/site.ts` 与 `site-gate.test.mjs`（`?drinks` 门禁回退）、以及待落盘验证的 `r4` 执勤禁出拳/禁烟改动、`smoke-report.md`、`dist/` 与 `dist/version.json` SHA 对齐。
   - **合并前整合位必做**：解决全部 `UU`/暂存冲突后，完整复跑 `tsc`、`check:api`、`duty-gate`/`knockdown`/`emote`/`drinks` 局部回归，在独立构建目录执行 `npm run build` 并同步回 `dist/`（保留 `dist/world` 与 `og.jpg`），随后重跑 [smoke-core.mjs](file:///Users/pan-work/guilinol-xp-overnight/captures/ol-full-merge/smoke-core.mjs) 确认 5 大探针全 `true` 且 `4784x` 无残留端口。
3. **非阻断历史待修与体验细节**：
   - **递单初帧手侧微瑕**：`web/src/traffic-duty/fine-terminal/engine.ts:380` 扯单阶段按违规人方位选侧，直到第 632 行递单才修正为玩家就近手，约有 0.1 m 瞬时换手跳变（见 [r9-acceptance.md#L95-L98](file:///Users/pan-work/guilinol-xp-overnight/docs/xp-schedule/r9-acceptance.md#L95-L98)）。
   - **大地图中心广场 `xxg` 缺少直达检索名**：[spots.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/play/spots.ts#L11-L45) 仅录有「十字街」「日月双塔」，未录「中心广场 / 小香港」，`tour` 模式需手动拖动点击地图，`solo` 模式需从十字街南行 ~380 m 前往。
   - **既知未完真机验证项**：[captures/ol-full-accept/report.json](file:///Users/pan-work/guilinol-xp-overnight/captures/ol-full-accept/report.json) 首轮中 `OL1~OL4`（定江隧道/十字街秩序/钓鱼碑/新烟盒）与 `SZJ_ENTRY` 脚本态待最新构建后补验。
   - **提包清理纪律**：推分支建 PR 前核对工作区不含未预期测试截图或临时文件，且不得误把 `.venv` / `raw` 符号链接打入提交。
