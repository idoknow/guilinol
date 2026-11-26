# 十字街地下街 B1 · 路线 A 契约 v1（冻结）

代码：`web/src/shizijie/contract.ts`（只有类型、常量和纯函数，three 只导入类型）。
本文与代码字段一一对应。任何改动都要先改本文、递增 `SZJ_CONTRACT_VERSION`，并由组长发布。

几何来源（只读，不改）：`/Users/pan-work/guilinol-xp-overnight/pipeline/shizijie_underpass.py`。

路线 A 不挖地：
- 地面只放入口罩，由 Hy2 的 look 负责，mesh 名沿用 `pipelineId`。
- 楼梯和地下街全部做在独立室内场景里。
- 地下楼梯与地面楼梯井占同一块地，两者上下对齐。

## 1. 坐标系

| 导出 | 说明 |
|---|---|
| `SZJ_CONTRACT_VERSION` | `1` |
| `SzjXZ` | `{ x, z }`，单位米 |
| `SZJ_FRAME.units` | `'m'` |
| `SZJ_FRAME.originWorld` | `(-879.7502021582604, -169.62604470000713)`，即 pipeline 的 `SHIZIJIE_ORIGIN` |
| `SZJ_FRAME.surfaceY` | `151.3`，即 `SHIZIJIE_SURFACE_Y`，地面楼梯口的世界高 |
| `SZJ_FRAME.indoorFloorY` | `0`，B1 地面 |
| `SZJ_FRAME.depth` | `4.2`，即 `UNDERPASS_DEPTH`，室内楼梯顶面 y |
| `indoorToWorld(p)` | `p + origin`，纯平移 |
| `worldToIndoor(p)` | `p − origin`，往返误差 < 1e-9 m |
| `rotateLocal(local, yaw)` | `(x·c + z·s, −x·s + z·c)`，与 pipeline 的 `stair_local_to_frame` 和 three.js `rotation.y` 一致 |
| `yawFacing(dir)` | `atan2(−dir.x, −dir.z)`，相机看向 `(−sin yaw, −cos yaw)`，与 walkTo 的约定一致 |

室内坐标就是十字街局部坐标，也就是 pipeline 的 `shizijie` 字段。它和世界坐标只差一个平移，不旋转、不缩放。

## 2. 楼梯口

| 导出 | 说明 |
|---|---|
| `SzjStairId` | `'nw' \| 'ne' \| 'se' \| 'sw'` |
| `SZJ_STAIR_IDS` | 上述 4 个 id，按固定顺序排列 |
| `SzjStairwellSource` | pipeline `STAIRWELLS` 的原样字段：`id`、`pipelineId`、`label`、`local`、`yawDeg`、`width`、`length` |
| `SZJ_STAIRWELL_SOURCES` | 见下表，校验脚本会与 pipeline 逐位对拍 |
| `SZJ_STAIR_SPEC.riser` | `0.15` |
| `SZJ_STAIR_SPEC.tread` | `0.30` |
| `SZJ_STAIR_SPEC.count` | `28`（28 × 0.15 = 4.2） |
| `SZJ_STAIR_SPEC.footRun` | `1.5`，楼梯底往室内再走出去的落脚距离 |
| `SZJ_STAIR_SPEC.landingTopMin` | `0.3`，顶部平台的最小长度 |
| `SzjStairProfile` | `riser`、`tread`、`count`、`width`、`landingTop`、`landingFoot`。这是 `locomotion/stairs` 的输入，Gemini 的类型须与它结构兼容 |
| `SzjStairwell` | 派生的楼梯口，字段见下文 |
| `SZJ_STAIRWELLS` | 由 4 个 source 派生而来 |
| `getStairwell(id)` | 按 id 取楼梯口，未知 id 抛错 |
| `indoorToStairLocal(st, p)` | 室内坐标 → 楼梯局部 `(lx, lz)` |
| `stairLocalToIndoor(st, l)` | 楼梯局部 → 室内坐标 |
| `worldToStairLocal(st, p)` | 世界坐标 → 楼梯局部 |
| `stairTreadY(st, lz)` | 台阶状的踏面高度，碰撞和放脚以它为准 |
| `stairNosingY(st, lz)` | 台阶前缘连线，即斜坡线高度 |

`SzjStairwell` 的字段：
- 来源字段：`id`、`pipelineId`、`label`、`yawDeg`、`width`、`length`。
- 位置与朝向：
  - `indoor`：楼梯中心，室内坐标。
  - `world`：楼梯中心，世界坐标。
  - `yaw`：弧度，等于 `yawDeg·π/180`。
  - `inward`：下行方向，即局部 +Z 方向的单位向量。
- 尺寸：`profile`。
- 特征点（均为室内坐标）：
  - `mouthIndoor`：地面开口，局部 `(0, −L/2)`。
  - `topIndoor`：顶部平台中心，局部 `(0, −L/2 + landingTop/2)`，`y = depth`。
  - `bottomIndoor`：楼梯底，局部 `(0, +L/2)`，`y = 0`。
  - `footIndoor`：落脚点，局部 `(0, +L/2 + footRun)`，`y = 0`。
- `groundY`：等于 `surfaceY`。

楼梯局部坐标的方向：
- −Z 是街面开口，玩家朝 +Z 往下走。
- 顶部平台长 `landingTop = length − 28·0.3`。
- 第 i 级台阶（从 0 起）的踏面高 `y = 4.2 − (i+1)·0.15`。

### 来源与派生值

派生值保留 3 位小数，由 `node --experimental-strip-types` 实测输出。

| id | pipelineId | label | local | yawDeg | W×L | world 中心 | inward | landingTop | top（室内） | foot（室内） | 地面落点（世界）/ yaw | 脚本下楼 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nw | shizijie_stair_nw | 南方大厦 · NW出口 | (-22.5, -38.8) | 72.0 | 3.4×9.0 | (-902.250, -208.426) | (0.951, 0.309) | 0.6 | (-26.494, -40.098) | (-16.794, -36.946) | (-907.957, -210.280) / 1.257 | 5667 ms |
| ne | shizijie_stair_ne | 解放东路 · NE出口 | (43.0, -23.0) | -45.0 | 3.4×9.0 | (-836.750, -192.626) | (-0.707, 0.707) | 0.6 | (45.970, -25.970) | (38.757, -18.757) | (-832.508, -196.869) / -0.785 | 5667 ms |
| se | shizijie_stair_se | 文化大厦 · SE出口 | (22.5, 46.5) | -158.0 | 3.4×9.0 | (-857.250, -123.126) | (-0.375, -0.927) | 0.6 | (24.073, 50.394) | (20.252, 40.937) | (-855.003, -117.563) / -2.758 | 5667 ms |
| sw | shizijie_stair_sw | 微笑堂 · SW出口 | (-46.2, 21.5) | -131.2 | 3.2×8.8 | (-925.950, -148.126) | (-0.752, -0.659) | 0.4 | (-43.040, 24.266) | (-50.639, 17.614) | (-921.511, -144.240) / -2.290 | 5611 ms |

已知风险（只读核对 pipeline 时发现）：
- pipeline 里 sw 楼梯口的 `targetNodeHint` 是 (-42.17, 21.60)，位于楼梯中心的 +X 方向，而 sw 的下行方向朝 (-0.752, -0.659)，两者几乎相反。ne 的 hint 也偏离下行方向约 90°。
- 契约按 pipeline 的 yawDeg 原样冻结。Hy1 布局里的走廊须自己接到 `footIndoor`，不要用 hint。

## 3. 触发区

`SZJ_TRIGGER` 的字段：

| 字段 | 值 | 说明 |
|---|---|---|
| `sideInset` | `0.2` | 进入区左右各内缩的宽度 |
| `zFromMouth` | `−0.6` | 进入区起点（相对开口，负值表示在开口外） |
| `thresholdFromMouth` | `0.8` | 越过这条线即进入 |
| `yTolerance` | `2` | 与 `groundY` 的竖直容差 |
| `exitYTolerance` | `0.3` | 室内离开时脚底须 ≥ `depth − 0.3` |
| `landingOut` | `1.5` | 出来后落在开口外 1.5 m 处 |

触发相关的函数：
- `shouldEnterStair(st, pos, vel)`：pos 为世界坐标（脚底）。条件是 `|lx| ≤ W/2 − 0.2`、`lz ∈ [−L/2 − 0.6, −L/2 + 0.8]`、`|y − groundY| ≤ 2`，并且速度与 `inward` 的点积 > 0。
- `shouldExitStair(st, pos, vel)`：pos 为室内坐标。条件是 `y ≥ 4.2 − 0.3`、`|lx| ≤ W/2`、`lz ≤ −L/2 + landingTop`，并且速度与 `inward` 的点积 < 0。
- `stairLanding(st)`：出来时的世界落点（局部 `(0, −L/2 − 1.5)`），朝向背对 `inward`，即面朝外。
- `stairEntryPose(st)`：进来时的室内放置点 `topIndoor`，`y = depth`，朝向沿 `inward`。

## 4. 时序与预算

进入流程：
1. 玩家越线。
2. runtime 锁定输入。
3. `openVeil`。
4. 等 `veilFadeInMs`。
5. `suspendWorld`。
6. 室内相机放到 `stairEntryPose`，强制第一人称，俯角 `entryPitchDeg`。
7. 渲染首帧。
8. 调用 `veil.done()`，同时开始脚本下楼：从 `topIndoor` 到 `footIndoor`，水平匀速，视线高度由 `locomotion/stairs` 平滑。
9. 交还控制。

离开流程：
1. 玩家自己走上楼梯，由 `locomotion/stairs` 平滑。
2. 命中 `shouldExitStair`。
3. `openVeil`。
4. 等 `veilFadeInMs`。
5. `resumeWorldAt(stairLanding)`。
6. 调用 `veil.done()`。宿主的视角保持进来前的样子。

`SZJ_TIMING` 的字段：

| 字段 | 值 | 说明 |
|---|---|---|
| `prefetchRadiusM` | `60` | 离任一楼梯口不超过 60 m 时预取室内模块和素材 |
| `veilFadeInMs` | `280` | |
| `swapBudgetMs` | `300` | |
| `veilFadeOutMs` | `420` | |
| `totalSwapMaxMs` | `1000` | 从触发到室内首帧可见的上限 |
| `descentSpeed` | `1.8` | 脚本下楼的水平速度，单位 m/s |
| `descentMaxMs` | `7000` | 超时就直接放到 `footIndoor` 并交还控制 |
| `reenterCooldownMs` | `1500` | |

`descentMs(st)` 返回 `topIndoor` 到 `footIndoor` 的水平距离除以 `descentSpeed`，单位毫秒。

`SZJ_BUDGET` 的字段：

| 字段 | 值 |
|---|---|
| `indoorDrawCallsMax` | `60` |
| `indoorTrianglesMax` | `200000` |
| `indoorTextureBytesMax` | `8 MiB` |
| `swapMsMax` | `300` |
| `blackFramesMax` | `0` |
| `npcMax` | `48`（npcSpots 加上 walkers.count 的总和） |
| `npcDrawCallsMax` | `6` |
| `crowdStepMsMax` | `1.5` |
| `eyeDyPerFrameMax` | `0.08`（60fps 下） |
| `landingErrorMax` | `0.5` |
| `mainChunkDeltaBytesMax` | `2048` |

## 5. 室内场景接口

`SzjState` 有 7 个状态：`'unmounted' | 'idle' | 'entering' | 'descending' | 'inside' | 'exiting' | 'disposed'`。

`SZJ_TRANSITIONS` 规定允许的迁移：

| 从 | 可以迁到 |
|---|---|
| unmounted | idle、disposed |
| idle | entering、disposed |
| entering | descending、idle（失败回退）、disposed |
| descending | inside、disposed |
| inside | exiting、disposed |
| exiting | idle、inside（失败回退）、disposed |
| disposed | 无 |

`canTransition(from, to)` 查这张表。表外的迁移一律返回 false，不抛错。

`SzjHostContext` 由宿主提供，与小香港同构：
- `renderer`、`worldCamera`。
- `getWalker()`：步行时返回脚底位置和水平速度，非步行时返回 null。
- `openVeil(destination)`、`suspendWorld()`、`resumeWorldAt(point)`。
- `bodyFlag: 'szjActive'`：室内期间 runtime 设置 `document.body.dataset.szjActive = '1'`。

`SzjIndoorMetrics` 的字段：
- 渲染：`drawCalls`、`triangles`、`textureBytes`。
- 人数：`npcCount`。
- 转场：`lastSwapMs`、`lastBlackFrames`。
- 楼梯与落点：
  - `lastMaxEyeDy`：最近一次上下楼时视线高度的最大单帧变化。
  - `lastLandingError`：最近一次出来时与 `stairLanding` 的距离。

`SzjIndoorScene` 的成员：
- 状态与对象：`state`、`scene`、`camera`。
- 生命周期：
  - `mount(ctx)`。
  - `enter(stairId)`：idle → entering → descending → inside。
  - `exit()`：inside → exiting → idle。
  - `dispose()`。
- 每帧调用：`step(dt)`。
- 指标：`getMetrics()`。

室内场景的约束：
- 使用独立的 THREE.Scene 和自带的第一人称相机。
- 碰撞：地面 y = 0，楼梯按 `stairTreadY`，墙和铺位用 AABB。
- 不碰 world、terrain、walk/physics，也不调用 `setViewMode`。

`SZJ_PLAYER` 的字段：

| 字段 | 值 |
|---|---|
| `eyeHeight` | `1.6` |
| `radius` | `0.3` |
| `walkSpeed` | `1.6` |
| `runSpeed` | `3.2` |
| `stairUpSpeedScale` | `0.75` |
| `stairDownSpeedScale` | `0.85` |
| `fovDeg` | `70` |
| `entryPitchDeg` | `−18` |

## 6. 布局 schema

分工：Hy1 产出布局数据，Carbon 读取，Hy2 按 `lookKey` 贴素材，Neon 按 `npcSpots` 和 `walkers` 放人。

| 导出 | 字段 |
|---|---|
| `SzjRect` | `x`、`z`（中心）、`w`、`d`，与坐标轴对齐 |
| `SzjCorridor` | `id`、`kind`（`'ring' \| 'main' \| 'alley'`）、`points`（≥2 个点）、`width` |
| `SzjShopCategory` | `'clothing' \| 'phone' \| 'snack' \| 'drink' \| 'accessory' \| 'shoes' \| 'beauty' \| 'toy' \| 'other'` |
| `SzjNpcRole` | `'keeper' \| 'customer'` |
| `SzjNpcPose` | `'idle' \| 'browse' \| 'tidy' \| 'phone' \| 'chat'` |
| `SzjNpcSpot` | `role`、`pose`、`x`、`z`、`yaw` |
| `SzjShop` | `id`、`kind`（`'shop' \| 'stall'`）、`no`、`rect`、`frontage`、`category`、`name`（改写过的店名，不用真实品牌）、`lookKey?`、`npcSpots`（1~3 个） |
| `SzjWalker` | `id`、`points`（≥2 个点）、`loop`、`count` |
| `SzjExit` | `stairId`、`center`、`yaw`、`foot`，须与契约里的楼梯口一致 |
| `SzjLayout` | `version: 1`、`units: 'm'`、`ceilingHeight`、`bounds`、`corridors`、`shops`、`walkers`、`columns`、`exits`、`sources` |

`SZJ_LAYOUT_LIMITS` 的字段：

| 字段 | 值 |
|---|---|
| `ceilingHeightMin` | `2.6` |
| `ceilingHeightMax` | `6` |
| `corridorWidthMin` | `2.4` |
| `shopSideMin` | `1.2` |
| `shopCountMin` | `24` |
| `shopCountMax` | `36` |
| `npcSpotsPerShopMin` | `1` |
| `npcSpotsPerShopMax` | `3` |
| `stairMatchEps` | `0.01` |
| `yawMatchEps` | `1e-4` |
| `stairClearance` | `0.3` |
| `overlapEpsilon` | `0.01` |

布局相关的函数：
- `rectHitsStair(r, st, margin)`：判断轴对齐的铺位矩形与旋转后的楼梯占地（外扩 margin）是否相交，用分离轴法。
- `layoutNpcCount(layout)`：返回 npcSpots 数加上 walkers.count 的总和。
- `validateSzjLayout(input)`：返回错误列表，空数组表示通过。它检查以下各项：
  - version、units、ceilingHeight 和 bounds。
  - 所有 id 不重复。
  - 走廊：宽度和点数合规，点都在界内，至少有一条 ring 或 main 走廊。
  - 铺位：数量在 24~36 之间，尺寸合规，不出界，不压楼梯（净距 0.3 m），`frontage` 存在，`name` 不为空，每铺 1~3 个 npcSpot 且不出界，铺位之间不重叠。
  - 行人路线：点数合规、点在界内、`count` 合法。
  - NPC 总数不超过 48。
  - 4 个楼梯口各恰好 1 个，`center` 和 `foot` 误差 ≤ 0.01 m，`yaw` 误差 ≤ 1e-4，`foot` 在界内。
  - `columns.size` 大于 0，`sources` 不为空。
