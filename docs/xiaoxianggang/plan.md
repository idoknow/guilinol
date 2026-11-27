# 桂林中心广场「小香港地下商业城」A 线开发计划、门禁与复盘对齐

> **路线拍板**：路线 A（下沉入口触发 → `veil()` 淡出 → 切换独立 `indoorScene`，零挖城市地基、不碰 `world.ts` 与 `terrain`）
> **Worktree 与分支**：`/Users/pan-work/guilinol-xxg` · 分支 `feat/xiaoxianggang-indoor`（已同步至最新 `origin/main` `d700104f`）
> **Multica 父单**：[`IDOK-361`](https://multica.ai/idoknow/issues/IDOK-361)（`01a21259-f038-71b0-86b9-195f85ecdd54`）

---

## 1. Multica 父子单与严格串行阻塞链（禁止跨阶段抢跑）

吸取蜜雪王城项目（`IDOK-312`–`IDOK-317` 已封存转 `backlog`）“未完成地基/骨架终审即六路铺量”的教训，小香港 A 线实行 **Stage 0 → Stage 1 → Stage 2** 硬屏障串行门禁：前一阶段未完成真实 diff、单测与实景截图终审置 `done` 前，下游阶段保持 `blocked` 严禁开工。

| 阶段 | Multica Barrier | 单号 | UUID | 当前状态 | 阻塞依赖 | 负责人与范围 |
| :--- | :---: | :--- | :--- | :---: | :--- | :--- |
| 父单（Epic） | — | **IDOK-361** | `01a21259-f038-71b0-86b9-195f85ecdd54` | `in_progress` | 统管 Stage 0→1→2 | Neon（建仓/排单/实景验收与门禁）+ 克劳德（契约与终审） |
| Stage 0 | `stage=1` | **IDOK-362** | `01a2125a-813f-7c81-b28d-c2d7b6ec0f72` | `done` | 无（已结单，放行 Stage 1） | Hy2：中心广场地基体检与 20 张实拍图库（`/Users/pan-work/z-test/xiaoxianggang/README.md` + `refs/`） |
| Stage 1 | `stage=2` | **IDOK-363** | `01a2125a-8cc5-7a66-ab6a-9c6533f7943c` | `in_progress` | `blocked_by: IDOK-362` (`done`)；`blocks: IDOK-364` | 克劳德（`contract.md`/`contract.ts`）+ Carbon（`runtime/`、`index.ts` 灰盒骨架）+ Neon（`scripts/xiaoxianggang/` 验收） |
| Stage 2 | `stage=3` | **IDOK-364** | `01a2125a-9699-7a56-bd7e-b7b4e1551f30` | `blocked` | **`blocked_by: IDOK-363`**（未 `done` 禁开工） | 主街布局、水磨石与嵌入式方灯材质、首批 3 家店（服装/小饰品/小吃）与限流人流 |

---

## 2. `IDOK-324` 与 `IDOK-301` 产物核查与复用结论

> 已回填至父单 `IDOK-361`，评论 ID：**`01a2125a-e7ee-7a61-baca-cdab0b93bae9`**。

### 2.1 产物所在分支与实态
1. **`IDOK-324`**（`[XP3.0-6 / py hy] 十字街「小香港」地下商业街实景考据与 B1 地下模型`，状态 `done`，0 关联 PR）：
   - 产物仅存于本机未推送分支 `feat/xp-overnight`（worktree `/Users/pan-work/guilinol-xp-overnight`），**尚未合入 `origin/main`**（`origin/main` 的 `pipeline/landmarks/shizijie.py` 停留在 `8126179e`，无 `underground` 字段）。
   - 该工作区含最新未提交态 `pipeline/landmarks/shizijie.py`、`public/landmarks/shizijie.glb`（941KB；已提交检查点 `6227c49d` 为 680KB）、`public/landmarks/shizijie.json`（`underground.originWorld = [-879.75, 151.3, -169.63]`、`floorY = -4.2`、`worldFloorY = 147.1`、4 处 `cutoutPolygon`）及 `docs/research/shizijie-underground.md`（16KB）。
2. **`IDOK-301`**（`[Xpy本机占坑 · 排期#4] 开通十字街真实地下通道+取消中心路口斑马线`，状态 `backlog`，0 评论 / 0 PR）：
   - 仅在 `feat/xp-overnight`（`6227c49d`）落地部分 `web/src/tunnels.ts` 地形裁洞代码（`groundCutouts`），其描述引用的 `docs/xp-schedule/runbook-p3-duty2-and-p4-shizijie-underpass.md` 并不存在，**未合入 `origin/main`**。

### 2.2 复用决策
- **不可直接复用（区位与路线双重不匹配）**：`IDOK-324` 与 `IDOK-301` 均位于**十字街路口**（`[-879.75, 151.3, -169.63]`，`way/985734888` 过街环形通道）且走**路线 B 地形多边形裁洞**；本父单 A 线位于约 **400m 南侧的中心广场「小香港商业城」**（`central_square`，`x∈[-925,-856], z∈[186,249], y=153.868m`）且采用**路线 A 独立 `indoorScene`**。因此不跨分支引入 `shizijie.glb`/`shizijie.json` 坐标、`tunnels.ts` 裁洞或斑马线取消代码。
- **Stage 2 局部可借鉴经验（零代码强依赖）**：`feat/xp-overnight` 中 `docs/research/shizijie-underground.md` 的桂林地下商街尺度/业态考据，以及 `shizijie.py` 的防叠片吊顶（`-1.11m`）、16 铺自发光店招合批图集、柱脚去 Z-fighting 与低显存 KTX2 纹理经验（`ktx2VRAM = 3.67MB`）可在 `IDOK-364`（Stage 2）建模阶段参考；**Stage 1（`IDOK-363`）灰盒骨架完全零依赖** `IDOK-324` 与 `IDOK-301`。

---

## 3. 中心广场 4 处下沉入口基准坐标（已与冻结版 `contract.ts` v1 对齐）

所有 4 处地上入口均落在单一健康瓦片 `(-1024, 0)` 内，实测 `terrain_4m = 153.800m`、`B_plaza_pave = 153.868m`、`audit_grounding.py` 6/6 全 pass；入口 ID、世界坐标与出来落点均以冻结版 `web/src/xiaoxianggang/contract.ts`（`XXG_PORTALS`）为唯一真相源：

| 入口 ID | 名称 | 室内坐标 `(x, z)` | 世界坐标 `(x, z)` | 出来落点 `(x, z, yaw)` | 广场标高 `y` |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `E1` | 东南入口 | `(-22, 26.5)` | `(-874.805, 249.245)` | `(-880.247, 247.238, 1.2174)` | `153.868m` |
| `E2` | 东北入口 | `(-22, -26.5)` | `(-856.467, 199.531)` | `(-851.025, 201.538, -1.9242)` | `153.868m` |
| `W1` | 西南入口 | `(-78, 19.5)` | `(-924.911, 223.303)` | `(-930.353, 221.296, 1.2174)` | `153.868m` |
| `W2` | 西北入口 | `(-78, -19.5)` | `(-911.417, 186.721)` | `(-916.859, 184.714, 1.2174)` | `153.868m` |

> `scripts/xiaoxianggang/verify-xxg-indoor.mjs` 直接解析 `contract.ts` 中的 `portal('E1'..'W2', ...)` 声明与 `bodyFlag = 'xxgActive'`，零硬编码漂移。

---

## 4. Stage 1 实景验收标准与工具集

### 4.1 验收工具清单（`scripts/xiaoxianggang/`）
- [`verify-xxg-indoor.mjs`](file:///Users/pan-work/guilinol-xxg/scripts/xiaoxianggang/verify-xxg-indoor.mjs)：Playwright 生产/开发预览端到端实景验收脚本，支持 `--url` / `--dist` / `--portal` / `--cycles` / `--out` / `--cdp` / `--dry-run`，所有截图落 `/tmp/xxg-stage1-verify`，`finally` 严格关闭 `browser` 与自启预览服务，默认端口 `4188`（绝不触碰 `4190`）。
- [`stage-gate.mjs`](file:///Users/pan-work/guilinol-xxg/scripts/xiaoxianggang/stage-gate.mjs)：读取 [`multica-tickets.json`](file:///Users/pan-work/guilinol-xxg/scripts/xiaoxianggang/multica-tickets.json)，强制校验 Stage 0 → Stage 1 → Stage 2 解锁前置条件与 PR 回填动作，未满足前置 `done` 时直接拒绝推进。
- [`xxg-scripts.test.mjs`](file:///Users/pan-work/guilinol-xxg/scripts/xiaoxianggang/xxg-scripts.test.mjs)：`node --test scripts/xiaoxianggang/*.test.mjs` 单元测试套件。

### 4.2 Stage 1 必过硬指标（全部接入 `evaluateXxgChecks`）
1. **地面入口到达与标高健康**：到达指定下沉入口，实测地面标高与 `153.868m` 误差 `<= 0.35m`；
2. **进场转场预算**：触发进入后 `veil` 淡出切入独立 `indoorScene`，切换耗时 `<= 300ms` 且无黑屏卡死；
3. **室内独立体验与性能**：室内自动切为第一人称，室内渲染 `draw calls <= 80`（静态场景 <= 40，其余给路人），向侧墙/尽头步行触发真实碰撞阻挡（不穿墙、不坠落）；
4. **出场回落与视角恢复**：走回出口淡出返回对应地面原入口（水平偏差 `<= 3.0m`、标高误差 `<= 0.35m`）并恢复入场前视角；
5. **重复进出零泄漏 & 零报错**：连续完成 `>= 2` 轮 `enter → exit`，场景节点与 DOM 残留均为 `0`，控制台与页面 `error = 0`，生产构建无作弊接口泄露。
