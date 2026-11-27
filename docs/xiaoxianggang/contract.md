# 小香港商业城 · 路线 A 骨架契约 v1

本契约冻结 Stage 1 灰盒骨架的坐标系、入口、场景接口、转场时序、性能预算和布局数据格式。代码侧的唯一来源是 `web/src/xiaoxianggang/contract.ts`，本文档与其字段逐一对应。任何改动都必须同时改这两个文件，并把 `XXG_CONTRACT_VERSION` 加一；改动前先通知 Carbon（runtime）、Hy1（layout）和 Hy2（look）。

- 路线：下沉口触发，veil 淡出后切到独立的室内场景（老板已拍板）。不挖城市地形，不改 `world.ts`、`terrain`、`walk/physics.ts` 和 `lib/atlas-ground.mjs`。
- 数据来源：`pipeline/landmarks/central_square.py`（锚点、轴向坐标 `_ax_pt`、`_underground_portal`），以及 Hy2 的调研 `/Users/pan-work/z-test/xiaoxianggang/README.md`（入口地面高 153.868m，`audit_grounding` 6/6 pass）。

## 1. 坐标系（`XXG_FRAME`）

全项目只有这一套室内坐标系，它就是中心广场的轴向坐标系。

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `units` | `'m'` | 单位米 |
| `anchorWorld` | `(-845, 232)` | 原点在广场锚点正下方（landmarks.json `rotation = 0`） |
| `axisE` | `(0.938, 0.346)` | 室内 +X 的世界方向：沿广场主轴朝东南偏东（体育馆方向） |
| `axisS` | `(-0.346, 0.938)` | 室内 +Z 的世界方向：横跨主轴朝南 |
| `surfaceY` | `153.868` | 地面入口处的世界地面高 |
| `indoorFloorY` | `0` | 室内地面高。室内场景单独渲染，与世界高程无关 |

- Y 朝上。E、S 两个轴向量直接沿用 pipeline 的取值，行列式 0.99956，仍是右手系。
- 每个入口在室内的坐标，就是 `central_square.py` 里 `_ax_pt` 的两个参数，所以地下出口正好落在地面入口正下方。
- 换算函数：
  - `indoorToWorld`：和 pipeline 的结果完全一致。
  - `worldToIndoor`：用精确逆矩阵，往返误差小于 1e-9m。
  - `rotateLocal(local, yaw)`：和 pipeline 的 `Builder._xf` 以及 three.js 的 `rotation.y` 是同一个公式。
  - `yawFacing(dir)`：按宿主 `walkTo` 和 `camera.rotation.y` 的约定换算朝向，相机看向 `(-sin yaw, -cos yaw)`。

## 2. 四个下沉入口（`XXG_PORTALS`、`XXG_PORTAL_TRIGGER`）

类型：`XxgPortalId = 'E1' | 'E2' | 'W1' | 'W2'`，按 `XXG_PORTAL_IDS` 的顺序排列；每个入口是一个 `XxgPortal`，字段有 `id`、`label`、`indoor`、`world`、`groundY`、`yaw`、`inward`。平面点统一用 `XxgXZ = {x, z}`。

| id | label | 室内坐标 `indoor` | 世界坐标 `world` | `yaw`（rad） | 下行方向 `inward` | 出来落点 `portalLanding` (x, z, yaw) |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | 东南入口 | (-22, 26.5) | (-874.805, 249.245) | -1.9242 | (0.938, 0.346) | (-880.247, 247.238, 1.2174) |
| E2 | 东北入口 | (-22, -26.5) | (-856.467, 199.531) | 1.2174 | (-0.938, -0.346) | (-851.025, 201.538, -1.9242) |
| W1 | 西南入口 | (-78, 19.5) | (-924.911, 223.303) | -1.9242 | (0.938, 0.346) | (-930.353, 221.296, 1.2174) |
| W2 | 西北入口 | (-78, -19.5) | (-911.417, 186.721) | -1.9242 | (0.938, 0.346) | (-916.859, 184.714, 1.2174) |

- 所有入口的 `groundY` 都是 153.868。世界坐标和 Hy2 的实测值相差不超过 0.008m。
- 入口的局部几何来自 pipeline：开口在局部 +Z 方向（顶级台阶外沿 z≈3.96），玩家朝局部 -Z 往下走，后墙在 z=-4.15。

触发规则：纯函数 `shouldEnterPortal(portal, pos, vel)`，runtime 每帧调用。以下坐标都是入口局部坐标，单位米。

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `halfWidth` | 2.1 | 局部 \|x\| ≤ 2.1 |
| `zMin` / `zMax` | -1.2 / 3.96 | 台阶范围 |
| `thresholdZ` | 3.0 | 局部 z ≤ 3.0，且水平速度和 `inward` 的点积 > 0，就触发进入 |
| `yTolerance` | 2 | 玩家 y 和 `groundY` 相差 ≤ 2m |
| `landingZ` | 5.8 | 出来的落点在局部 (0, 5.8)，即开口外 1.5m，面朝外 |

辅助函数：`getPortal(id)`、`worldToPortalLocal(portal, p)`、`portalLanding(portal)`。

## 3. 转场时序（`XXG_TIMING`）

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `prefetchRadiusM` | 60 | 玩家离任一入口 60m 以内时，就 `import()` 室内模块和素材，转场过程中不发网络请求 |
| `veilFadeInMs` | 280 | `veil(label, { destination })` 立即挂载，透明度过渡 0.28s（`loading.css`） |
| `swapBudgetMs` | 300 | veil 完全淡入后开始换场：挂载或显示室内、放置玩家、渲染出第一帧，整个阶段 ≤ 300ms |
| `veilFadeOutMs` | 420 | `veil.done()` 的淡出时长（`loading.ts`，非 reduced-motion） |
| `totalMaxMs` | 1000 | 从触发到玩家可以操作的总上限 |
| `reenterCooldownMs` | 1500 | 出来后同一入口的再触发冷却，防止在落点来回抖动进出 |

进入流程：触发，然后 `openVeil('小香港商业城')`，再等待 280ms；接着依次 `suspendWorld()`、把玩家放到对应出口、渲染室内首帧，这一段 ≤ 300ms；最后调用 `veil.done()`。

出去流程：走到出口，然后 `openVeil`，再等待 280ms；接着调用 `resumeWorldAt(portalLanding(portal))`；最后调用 `veil.done()`。

veil 是半透明的雾层，所以转场期间它背后的每一帧都必须是完整的世界画面或室内画面，不允许出现纯色空帧。

## 4. 性能预算（`XXG_BUDGET`）

| 字段 | 值 |
| --- | --- |
| `indoorDrawCallsMax` | 80。静态场景 + 主线同款带骨骼路人（每人约 7 次，视锥外的人隐藏、不计入） |
| `indoorSceneDrawCallsMax` | 40。静态场景（灰盒、店铺、楼梯井）自身的上限，余量全部给路人 |
| `indoorTrianglesMax` | 150000 |
| `indoorTextureBytesMax` | 8 MiB（和 Hy2 的 look 验收一致） |
| `swapMsMax` | 300（等于 `swapBudgetMs`） |
| `blackFramesMax` | 0 |
| `mainChunkDeltaBytesMax` | 2048。室内代码全部懒加载，main chunk 只增加入口触发和预取逻辑 |

runtime 必须通过 `getMetrics()` 返回 `XxgIndoorMetrics`，上报 `drawCalls`、`triangles`、`textureBytes`、`lastSwapMs`、`lastBlackFrames`，以便验收脚本直接读取。

## 5. 室内场景接口（`XxgIndoorScene`、`XxgHostContext`）

### 状态机（`XxgState`、`XXG_TRANSITIONS`、`canTransition`）

| 当前状态 | 允许迁移到 |
| --- | --- |
| `unmounted` | `idle`、`disposed` |
| `idle` | `entering`、`disposed` |
| `entering` | `inside`、`idle`（失败回退）、`disposed` |
| `inside` | `exiting`、`disposed` |
| `exiting` | `idle`、`disposed` |
| `disposed` | 无 |

遇到表外的迁移，runtime 要忽略它并返回 `false`，不抛错。

### `XxgIndoorScene`（Carbon 实现）

- `state`、`scene`、`camera`：室内有独立的 `THREE.Scene` 和自己的第一人称相机。
- `mount(ctx)`：从 `unmounted` 进入 `idle`，建场景，加载并校验布局。可以重复调用。
- `enter(portalId)`：`idle` → `entering` → `inside`，按第 3 节的进入时序执行。
- `exit()`：`inside` → `exiting` → `idle`，按第 3 节的出去时序执行。
- `step(dt)`：`idle` 时检测入口触发；`inside` 时推进室内玩家并检测出口。
- `getMetrics()`：见第 4 节。
- `dispose()`：任意状态都可调用，进入 `disposed`。释放几何、材质、纹理、DOM 和监听器，删除 `bodyFlag`。可以重复调用。

### 第一人称

只用室内自带的相机实现，不调用 `walk/view-mode.setViewMode`，所以出来后宿主原来的视角自然保持不变。室内碰撞：地面 y=0，墙、铺位、柱子和楼梯都用 AABB，不读世界高程。

玩家参数 `XXG_PLAYER`：

| 字段 | 值 |
| --- | --- |
| `eyeHeight` | 1.6 |
| `radius` | 0.3 |
| `walkSpeed` | 1.6 |
| `runSpeed` | 3.2 |
| `fovDeg` | 70 |
| `exitTriggerRadius` | 1.5（站在出口落脚点 1.5m 内且朝外走，就触发出去） |

### `XxgHostContext`（整合步在 `main.ts` 里实现，以 SHARE+ 提交）

- `renderer`、`worldCamera`：宿主现有对象。
- `getWalker()`：步行时返回玩家位置和水平速度；骑车、开车、飞行时返回 `null`，不触发入口。
- `openVeil(destination)`：直接调用 `web/src/ui/loading.ts` 的 `veil(label, { destination })`。
- `suspendWorld()`：暂停步行输入、物理和世界渲染，宿主主循环改为调用 `indoor.step` 并渲染 `indoor.scene`。
- `resumeWorldAt(point)`：恢复世界，并把玩家同步放到落点。入口周边的区块一直在内存里，不走网络。
- `bodyFlag = 'xxgActive'`：室内期间 runtime 设置 `document.body.dataset.xxgActive = '1'`，宿主的键盘和触屏处理要让路（这一条需要在 `input-guard.ts` 里提 SHARE+）。

## 6. 布局 JSON 格式（`XxgLayout`、`validateXxgLayout`）

Hy1 产出数据，Carbon 读取，Hy2 按 `lookKey` 贴素材。所有坐标都是室内坐标，单位米。

约束常量 `XXG_LAYOUT_LIMITS`：`ceilingHeightMin` 2.6、`ceilingHeightMax` 6、`corridorWidthMin` 2.4、`shopSideMin` 1.5、`exitMaxOffset` 6、`overlapEpsilon` 0.01。

| 字段 | 类型 | 约束（`XXG_LAYOUT_LIMITS`） |
| --- | --- | --- |
| `version` | `1` | 固定 |
| `units` | `'m'` | 固定 |
| `ceilingHeight` | number | 2.6 – 6 |
| `bounds` | `{minX, maxX, minZ, maxZ}` | 必须满足 min < max；所有铺位、走廊端点和出口都在框内 |
| `corridors[]`（`XxgCorridor`） | `{id, kind: 'main' \| 'alley', from, to, width}` | 直线段；`width` ≥ 2.4；至少有一条 `main` |
| `shops[]`（`XxgShop`） | `{id, no, rect: {x, z, w, d}, frontage, name?, lookKey?}` | 矩形和坐标轴对齐；边长 ≥ 1.5；铺位两两不重叠（容差 0.01）；`frontage` 必须是已有的走廊 id |
| `columns` | `{xs[], zs[], size}` | `xs` 和 `zs` 交叉组成柱网；`size` > 0 |
| `exits[]`（`XxgExit`） | `{portalId, foot, yaw, stair: XxgRect}` | E1、E2、W1、W2 各恰好 1 个；`foot` 离对应入口的室内坐标 ≤ 6m |
| `sources[]` | string[] | 不能为空，逐条写清出处 |

- 所有 id 在走廊和铺位之间也必须唯一。
- `validateXxgLayout(json)` 返回错误列表，空数组表示通过。Hy1 的单测和 Carbon 运行时加载都必须调用它。

## 7. 验收与终审

Stage 1 收口时，由组长根据真实的 git diff、`tsc -p web --noEmit`、runtime 和 layout 单测，以及 DEV 实景录屏做终审。重点核对：
- 4 个入口任选 2 个，真实走进去再走出来。
- `lastSwapMs` ≤ 300，`lastBlackFrames` = 0。
- 室内 draw calls ≤ 80，其中静态场景 ≤ 40。
- 落点和表 2 的偏差 ≤ 0.05m，视角恢复正确。
- 控制台 error 为 0。
