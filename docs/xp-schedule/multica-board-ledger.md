# XP 组 Multica 看板排班台账（`--profile idoknow`）

- **项目**：`Guilin Online · 网上桂林`（Project UUID: `156530de-f51c-40d8-91e9-e7174ac069ad`）
- **Workspace**：`a953425b-d09c-4a24-9107-6c6032572188`
- **工作分支**：`feat/xp-overnight`（`/Users/pan-work/guilinol-xp-overnight`）
- **台账最新实核时间**：2026-11-25（UTC `2026-11-25T12:03Z` 经 `multica --profile idoknow issue get --output json` 实核 `IDOK-355~360` 与 8 条受保护单；E2E 终版 15/15 收口校验于 UTC `2026-11-25T14:08Z` 完成）
- **执行 Agent 名录**：
  - `py Neon`：`fcd54600-4312-4cfb-9a8e-5219c2ea9327`
  - `py hy`：`f0076b31-35c8-48a2-b9bb-0e201a9de411`
  - `py hyy`：`2a93bfd5-da46-495b-ae26-ff9d55fae3f3`

---

## 一、XP 3.0 辅警与十字街地下工程首轮 7 条排班任务（全部 `done`）

| 序号 | Issue Key | Issue UUID | 指派执行成员 | 状态 | 优先级 | 标题与验收/根因归档 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **IDOK-319** | `01a20fd7-1078-79ed-99e5-030265cd4b59` | `py hy` (`f0076b31-35c8-48a2-b9bb-0e201a9de411`) | `done` | `high` | `[XP3.0-1 / py hy] 辅警前线剧情入口与解放桥值班交警原地领装互动` — 已修复 S2 根因（`DUTY_ZONES` 缺桥面高度且 `walk/physics.ts:637-641` 漏判 `151.86m` 桥面），`verify-duty-3.mjs` S1/S2/S3 `PASS` |
| 2 | **IDOK-320** | `01a20fd7-1906-78ba-b059-a81f7b869b1a` | `py Neon` (`fcd54600-4312-4cfb-9a8e-5219c2ea9327`) | `done` | `high` | `[XP3.0-2 / py Neon] 解放桥独立执勤车流：主城解耦、辅警减速、违规逃逸与吹哨挥旗喝止` — 已修复 S6 车流 `startPromise` 幂等与 `isOnJiefangBridgeDeck` 高度过滤，单测 + S4/S6 E2E `offDeckViolators=0` `PASS` |
| 3 | **IDOK-321** | `01a20fd7-2175-73c5-84c6-92c651dc3d50` | `py hyy` (`2a93bfd5-da46-495b-ae26-ff9d55fae3f3`) | `done` | `high` | `[XP3.0-3 / py hyy] 解放桥全桥机非/中央护栏物理碰撞与桥面值班围栏禁互动提示` — S4 护栏 6 子网格 + S7 出界钳制提示实机 `PASS` |
| 4 | **IDOK-322** | `01a20fd7-29a2-7a9d-b286-89c374d8ec6e` | `py hyy` (`2a93bfd5-da46-495b-ae26-ff9d55fae3f3`) | `done` | `high` | `[XP3.0-4 / py hyy] 撞车倒地多阶段状态机、连按5次空格起身与吹哨/挥旗道具手势` — `knockdown` + `emote` + S5/S8 E2E `PASS` |
| 5 | **IDOK-323** | `01a20fd7-3213-78bc-948f-6936176631ab` | `py hy` (`f0076b31-35c8-48a2-b9bb-0e201a9de411`) | `done` | `high` | `[XP3.0-5 / py hy] 第一人称手持电子罚款机（录入→打印→递交三阶段演出与结算）` — 拆分为 `startTrafficBridge`+`applyTrafficDutyConfig`，S6 真按 `KeyF` 开单 `PASS` |
| 6 | **IDOK-324** | `01a20fd7-3a7c-7f19-8b93-de32eac7e739` | `py hy` (`f0076b31-35c8-48a2-b9bb-0e201a9de411`) | `done` | `high` | `[XP3.0-6 / py hy] 十字街「小香港」地下商业街实景考据与 B1 地下模型（shizijie.py/glb/json）` — 补全 B1 闭合围墙/吊顶/楼梯封堵/去 Z-fighting/16 铺独立店招与 4 口独立灯箱，`ktx2VRAM=3.67MB` |
| 7 | **IDOK-325** | `01a20fd7-4323-756f-b28e-3ab7153577f7` | `py Neon` (`fcd54600-4312-4cfb-9a8e-5219c2ea9327`) | `done` | `high` | `[XP3.0-7 / py Neon] 十字街地下 B1 可走化接入（tunnels.ts）、穿行实测与全链路整合验收` — S9 地面↔地下 6/6 贴地无重置 + 首轮 9/9 `PASS` |

---

## 二、XP 3.0 r5 第二轮收口优化 7 条排班任务（沿用看板实态，未改远端状态）

| 序号 | Issue Key | Issue UUID | 指派执行成员 | Multica 实时状态 | 本机 `feat/xp-overnight` 验收状态 | 标题与验收/核因归档 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **IDOK-339** | `01a21180-6d25-736c-90e0-54e7758cb21d` | `py hy` (`f0076b31-35c8-48a2-b9bb-0e201a9de411`) | `blocked`（待远端推送 `xp3/duty` 基线） | N2/N3 实机已全通 | `[XP3.0-r5-1 / py hy] 解放桥真实横断面测量与全程无缺口可跳翻越护栏` — `JIEFANG_CROSS_SECTION` 导出、3 道栏杆零缺口（`spanCount=1, gapCount=0`）、西岸与江中主跨均已跳顶翻越 `PASS`（`k33`/`k34`） |
| 2 | **IDOK-340** | `01a21180-7650-728f-8af3-d3eb580061a5` | `py Neon` (`fcd54600-4312-4cfb-9a8e-5219c2ea9327`) | `in_review` | N1/N4 + 压测已全通 | `[XP3.0-r5-2 / py Neon] 解放桥两轮车归位黑色非机动车道、低违规率与温和碰撞` — 两轮 60/60 仅走黑色非机动车道（人行道=0）、违规 9.09% `<= 15%`（`<= 2` 辆）、人行/非机动道 0 被撞、鸣笛刹车 `<= 25km/h`（`k35`/`k36`/`k37`） |
| 3 | **IDOK-341** | `01a21180-7f49-7df0-ad5a-8dcb8b53e723` | `py hy` (`f0076b31-35c8-48a2-b9bb-0e201a9de411`) | `blocked`（待远端推送 `xp3/duty` 基线） | N5 + S6/k40 实机已全通 | `[XP3.0-r5-3 / py hy] 桥面被撞倒贴桥不穿模、罚款单价压降与值班节奏收敛` — 桥中被撞倒全周期 `footY` 偏差 `±0.3m` 内、单价 5~20 元与防刷节奏通过（`k38`/`k39`/`k40`） |
| 4 | **IDOK-342** | `01a21180-87f6-78f5-a08e-3252594c3952` | `py hy` (`f0076b31-35c8-48a2-b9bb-0e201a9de411`) | `blocked`（待远端推送 `xp3/duty` 基线） | 本机 S2/S3 对话实机 `PASS` | `[XP3.0-r5-4 / py hy] GTA式交警剧情分镜对话、黑边正反打与双方角色头像渲染` — 远端 `idoknow/guilinol` 尚未推送 `feat/xp-overnight` 致 Multica 远端隔离运行 `blocked` |
| 5 | **IDOK-343** | `01a21180-9109-70a2-a6d3-0c412e07ccca` | `py hyy` (`2a93bfd5-da46-495b-ae26-ff9d55fae3f3`) | `blocked`（待远端推送 `xp3/duty` 基线） | S6 实机打印递交 `PASS` | `[XP3.0-r5-5 / py hyy] 第一人称手持电子罚单终端动画输入与热敏出票递交演化` — 远端无基线分支致 `blocked`；本机已完成 `fine-terminal` 单测与 S6 真机打印递交（已修 `controller.ts:798` 防吞票） |
| 6 | **IDOK-344** | `01a21180-9a1b-772b-83be-791470d8d91e` | `py hyy` (`2a93bfd5-da46-495b-ae26-ff9d55fae3f3`) | `blocked`（待远端推送 `xp3/duty` 基线） | S8/N5 实机倒地起身 `PASS` | `[XP3.0-r5-6 / py hyy] 撞倒受击多方向姿态、地面喘气撑地与连按爬起大优化` — 远端无基线分支致 `blocked`；本机 S8（3 段爬起与 2.4s 回退→5/5 起身）与 N5 桥中贴地均 `PASS` |
| 7 | **IDOK-345** | `01a21180-a3eb-7e4c-803f-15c89e294a44` | `py Neon` (`fcd54600-4312-4cfb-9a8e-5219c2ea9327`) | `in_review` | **14/14 → 15/15 E2E `PASS`** | `[XP3.0-r5-7 / py Neon] 辅警3.0 r5 14项真机E2E收口、S9清屏重截与看板台账对齐` — 已在本机继续扩展收敛为 r5/r6 15 项全绿（见 `IDOK-360`） |

> 注：`IDOK-339`/`341`/`342`/`343`/`344` 在 Multica 看板上呈 `blocked`，系因本轮建单时处于 `todo` 触发了 `py hy`/`py hyy` 在远端干净工作区自动接单，而 `github.com/idoknow/guilinol` 尚未推送 `feat/xp-overnight` / `xp3/duty` 基线分支；本单未擅自篡改上述工单状态，待 py Xie 确认后统一经分支推送/PR 回流或看板收口。

---

## 三、XP 3.0 r5/r6 演进补全波次 6 条排班单（`2026-11-25T12:03:19Z` 实核仍稳态于 `backlog`）

按协同防冲突第 1 条，本波 6 张排班单于 `2026-11-25T10:56Z` 以 `status=backlog`、`priority=high` 创建于 Multica 并全数挂接对应执行 Agent；UTC `2026-11-25T12:03:19Z` 经 `multica --profile idoknow issue get` 逐条复核确认全部保持 `backlog` / `high` 未动：

| 序号 | Issue Key | Issue UUID | 指派执行成员 | Multica 实时状态 | 本机 `feat/xp-overnight` 验收状态 | 标题与验收范畴 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **IDOK-355** | `01a21259-4e0a-7822-a8a5-eafae7ccc0fb` | `py hyy` (`2a93bfd5-da46-495b-ae26-ff9d55fae3f3`) | `backlog` (`high`) | 本机 S8/N5 实机 `PASS` | `[XP3.0-r5-8 / py hyy] 倒地>=5种受击动作、4种地面缓状态与3段爬起(2.4s回退)不掉桥底`（6 变体、4 喘息态、2.4s 回退、N5 `minDelta=0.068m` / `maxDelta=0.134m`） |
| 2 | **IDOK-356** | `01a21259-5839-70c6-a628-1b800dbb697a` | `py hy` (`f0076b31-35c8-48a2-b9bb-0e201a9de411`) | `backlog` (`high`) | 本机 S2/S3 实机 `PASS`（转报 `03c` 护栏遮腿） | `[XP3.0-r5-9 / py hy] GTA式交警剧情多机位镜头切换、黑边与双侧实时渲染角色头像`（5 机位切换、4 头像、FOV 还原 `delta=0`；`camera-shots.ts#L219-L235` 转报待修） |
| 3 | **IDOK-357** | `01a21259-6134-7247-9589-e1bf203a178d` | `py hy` (`f0076b31-35c8-48a2-b9bb-0e201a9de411`) | `backlog` (`high`) | 本机 S5 实机 `PASS`（转报 `dt` 钳制） | `[XP3.0-r6-1 / py hy] 执勤三键(Q吹哨/E长短按挥旗/F开单递交)接入keymap、按键栏与触屏Dock`（真键 `KeyQ/KeyE/KeyF` + Dock 按钮同步通过；`main.ts:757` / `walk/index.ts:2820` 转报待修） |
| 4 | **IDOK-358** | `01a21259-6a60-70b9-99d8-4b6cd1c0988f` | `py hyy` (`2a93bfd5-da46-495b-ae26-ff9d55fae3f3`) | `backlog` (`high`) | 本机 S6 实机 `PASS`（转报 `d44`） | `[XP3.0-r6-2 / py hyy] 第一人称腰挂/手持打印机吐纸撕单、1.5m近身递交与手握凭条防重开单`（1.5m 门禁与防重 Toast 通过；`fine-terminal/ui.ts#L148-L160` 3D 模型挂载转报待修） |
| 5 | **IDOK-359** | `01a21259-73dc-79d8-a7ea-a667678037f9` | `py Neon` (`fcd54600-4312-4cfb-9a8e-5219c2ea9327`) | `backlog` (`high`) | 本机 N6/S6 实机 `PASS` | `[XP3.0-r6-3 / py Neon] 执勤三键与递交闭环宿主接线、人行道60s零被撞与车流手握凭条挂载`（人行道 60s 零被撞、`handSlipMeshMounted=true`） |
| 6 | **IDOK-360** | `01a21259-7db6-7db7-8bff-bc363b114d47` | `py Neon` (`fcd54600-4312-4cfb-9a8e-5219c2ea9327`) | `backlog` (`high`) | **15/15 E2E `PASS`（`ERRS=[]`）** | `[XP3.0-r6-4 / py Neon] 辅警3.0 r5/r6 全流程真键真机E2E收口与Multica台账对齐`（UTC `2026-11-25T14:08:43Z` `verify-duty-3.mjs` `15/15 PASS`、`ERRS=[]`、64/64 单测 + `tsc`/`check:api`/`build` 全绿、`DIST_MD5 = LIVE_MD5 = 3e548a9fc1f603c9f70b93b421f7178a`、终版核心截图视觉复检全通） |

---

## 四、既有受保护 Issue 状态核验（零修改承诺）

UTC `2026-11-25T12:03:19Z` 经 `multica --profile idoknow issue get --output json` 逐条复核确认，以下 8 条受保护 Issue 状态、指派及更新时间完全保持原样、零改动：

| Issue Key | 建单前状态 | `2026-11-25T12:03Z` 实核状态 | 指派对象 | 原最新更新时间 (`updated_at`) | 核验结论 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **IDOK-290** | `blocked` | `blocked` | `py hyy` (`2a93bfd5-da46-495b-ae26-ff9d55fae3f3`) | `2026-11-24T17:38:45Z` | 无变动 |
| **IDOK-58** | `todo` | `todo` | `None` | `2026-11-20T12:58:56Z` | 无变动 |
| **IDOK-282** | `todo` | `todo` | `py Neon` (`fcd54600-4312-4cfb-9a8e-5219c2ea9327`) | `2026-11-24T16:45:21Z` | 无变动 |
| **IDOK-283** | `in_review` | `in_review` | `py hy` (`f0076b31-35c8-48a2-b9bb-0e201a9de411`) | `2026-11-24T18:53:09Z` | 无变动 |
| **IDOK-284** | `in_review` | `in_review` | `py hyy` (`2a93bfd5-da46-495b-ae26-ff9d55fae3f3`) | `2026-11-24T17:34:20Z` | 无变动 |
| **IDOK-285** | `backlog` | `backlog` | `None` | `2026-11-24T16:25:08Z` | 无变动 |
| **IDOK-286** | `done` | `done` | `py Neon` (`fcd54600-4312-4cfb-9a8e-5219c2ea9327`) | `2026-11-24T18:34:34Z` | 无变动 |
| **IDOK-287** | `backlog` | `backlog` | `py Neon` (`fcd54600-4312-4cfb-9a8e-5219c2ea9327`) | `2026-11-24T17:06:14Z` | 无变动 |

---

## 五、协同防冲突原则

1. 后续 XP 3.0 排班单如需本机先跑、暂不触发远端隔离工作区自动派单，须先建于 `backlog`；需远端 `py hy`/`py hyy` 接单前先将基线分支推至 `github.com/idoknow/guilinol`。
2. 热点文件（`web/src/main.ts`、`web/src/walk/index.ts`、`web/src/world.ts`、`web/src/stream.ts`）统一由整合位收口，子线不并发直改。
3. 解放桥桥面范围单源真值固定在 `web/src/traffic-duty/jiefang-railings.ts`（`JIEFANG_BRIDGE_DECK_BOUNDS` / `JIEFANG_CROSS_SECTION` / `isOnJiefangBridgeDeck`），`web/src/traffic/` 不再重复导出桥面边界常量或判定函数。

---

## 六、XP 3.0 r8（k69/k70）看板巡检快照

- 核对命令：`/Users/macbook/.local/bin/multica --profile idoknow issue list --limit 25 --output json`（2026-11-25T18:04Z 实核最新榜单含 `IDOK-391/336/328/384/242/379/329/371/377/372/349/376` 等），当前 Multica 看板仍未新建 `XP3.0-r8` 专用排班工单；受保护 8 单（`IDOK-290`/`58`/`282~287`）未做任何改动。
- r8 宿主机与真机收口核验：单测 61/61 + `tsc` 0 错 + `node --check scripts/verify-duty-3.mjs` `OK`；全量 `S1–S12 + N1–N6` 真机脚本在 `task-3660` 实跑得 `16/18 PASS`（`ERRS=[]`，`S1–S10 + N1–N6` 全绿），余下 `S11`/`S12` 分别检出上游 `sim.ts` 逆行死锁与 `controller.ts` `shiftUid` 跨刷新幂等碰撞两大阻断项，已书面提交 `SHARE+` 转交团队/整合位修补后复验 `18/18` 全绿。

---

## 七、XP 3.0 r9（k4/k5）终轮看板复核与收口归档

- 核对命令（`2026-11-25 13:31 PST`）：`/Users/macbook/.local/bin/multica --profile idoknow issue list --limit 20`（看板共 414 条，前排最新含 `IDOK-329/328/411/409/408/385/371/400/407/391/378/381` 等）；Multica 看板**仍未新建 `XP3.0-r8` / `XP3.0-r9` 专用工单**。
- 8 条受保护 Issue 逐条实核（`multica --profile idoknow issue get <KEY> --output json`）：`IDOK-290`（`blocked` · `2026-11-24T17:38:45Z`）、`IDOK-58`（`todo` · `2026-11-20T12:58:56Z`）、`IDOK-282`（`todo` · `2026-11-24T16:45:21Z`）、`IDOK-283`（`in_review` · `2026-11-24T18:53:09Z`）、`IDOK-284`（`in_review` · `2026-11-24T17:34:20Z`）、`IDOK-285`（`backlog` · `2026-11-24T16:25:08Z`）、`IDOK-286`（`done` · `2026-11-24T18:34:34Z`）、`IDOK-287`（`backlog` · `2026-11-24T17:06:14Z`）均**零改动**。
- 本机 r9 终轮验证记录：`tsc` 0 错、`check:api` 通过、单测 **76/76 PASS**；真机 18 项端到端 `verify-duty-3.mjs`（针对 `http://127.0.0.1:5176/?mode=walk`，`report.json` 时间戳 `2026-11-25T21:54:52.679Z`）实跑得 **`SUMMARY passed=18 failed=0`**、**`ERRS=[]`**，`06/06b/07e/13/14` 视觉复检通过；仅需向整合位/组长同步 `web/src/traffic-duty/npc-officer.ts` 与 `story/portraits.ts` 磁盘修改时间 `13:00:02` 晚于现行 `dist/index.html`（`12:39:55`）。
