# 十字街地下系统重叠、接管冲突与单局联调体验路径报告（k28 / k29）

> 文档生成基准：`/Users/pan-work/guilinol-xp-overnight` 当前源码审计（只读核查，未修改任何代码或资产）。  
> 核心结论：**本组 `shizijie.glb` 实景 B1 与隔壁 `szj`（`web/src/shizijie/`）在原点、高程与四个梯井坐标上 100% 重合，正常步行下梯会被 `szj` 提前拦截接管；隔壁中心广场 `xxg`（`web/src/xiaoxianggang/`）距十字街约 403 m、距解放桥约 704 m，零空间重叠；解放桥交警执勤与两套地下在「值班进行中」强互斥，但同一局内下岗/放弃后即可解禁并一键回桥续班。**

---

## 零、四问核心结论速览

| 核心问题 | 结论 | 关键源码证据 |
| :--- | :--- | :--- |
| **Q1. 坐标与入口是否重叠？** | **十字街 `shizijie.glb` B1 vs `szj` 100% 重叠**（同一原点、同 `-4.2 m` 标高、同 4 个梯井，`ensureSzjHoods()` 还会在地面叠加第二套入口罩）；**中心广场 `xxg` 零重叠**（南偏西约 384–403 m）。 | [pipeline/shizijie_underpass.py#L27-L30](file:///Users/pan-work/guilinol-xp-overnight/pipeline/shizijie_underpass.py#L27-L30), [web/src/shizijie/contract.ts#L37-L46](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/contract.ts#L37-L46), [web/src/main.ts#L786-L815](file:///Users/pan-work/guilinol-xp-overnight/web/src/main.ts#L786-L815), [web/src/xiaoxianggang/contract.ts#L38-L47](file:///Users/pan-work/guilinol-xp-overnight/web/src/xiaoxianggang/contract.ts#L38-L47) |
| **Q2. 走进本组 `shizijie.glb` 地下时，`szj` 是否同时触发/拦截？** | **是，正常步行必被 `szj` 在地面梯口抢先拦截。** 玩家步行刚踏入梯口（足底 `y ≈ 151.3 ± 2 m` 且朝内移动），`szj` 即自动冻结主世界人物并切换进 `szj` 独立室内场景，永远走不进 `-4.2 m` 的 `shizijie.glb` B1；**唯一绕过方式**是传第 7 参数 `targetY = 147.1` 直接落入 B1 广场。 | [web/src/shizijie/entry.ts#L120-L122](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/entry.ts#L120-L122), [web/src/main.ts#L815-L839](file:///Users/pan-work/guilinol-xp-overnight/web/src/main.ts#L815-L839), [web/src/shizijie/contract.ts#L249-L269](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/contract.ts#L249-L269), [web/src/shizijie/runtime/controller.ts#L610-L612](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/runtime/controller.ts#L610-L612) |
| **Q3. 解放桥执勤范围与十字街地下是否互斥 / 能否一局共存？** | **值班进行中（`phase === 'active'`）强互斥**，每帧强钳位拉回解放桥桥面；**一局内顺序体验完全共存**，只要向交警交差下岗、时间结束或点击放弃进入 `summary` 态，立即解除钳位与志愿服即可去地下，再靠 `.td-entry` 按钮传回解放桥续班。 | [web/src/traffic-duty/controller.ts#L862-L865](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/controller.ts#L862-L865), [web/src/traffic-duty/controller.ts#L1636-L1646](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/controller.ts#L1636-L1646), [web/src/traffic-duty/types.ts#L131-L164](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/types.ts#L131-L164), [web/src/traffic-duty/ui.ts#L468-L475](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/ui.ts#L468-L475) |
| **Q4. 老板如何在同一局顺畅体验全部内容？** | 已整理 **路线 A（纯 UI 全程不刷新流：`?play=tour` / `solo`）** 与 **路线 B（`?verify` 控制台直达本组真 B1 + 两个地下 + 交警执勤）**；并列出当前 `public/landmarks/shizijie.json` Git 冲突待解阻塞。 | [web/src/play/map.ts#L347](file:///Users/pan-work/guilinol-xp-overnight/web/src/play/map.ts#L347), [web/src/main.ts#L352-L414](file:///Users/pan-work/guilinol-xp-overnight/web/src/main.ts#L352-L414), [web/src/main.ts#L870-L875](file:///Users/pan-work/guilinol-xp-overnight/web/src/main.ts#L870-L875), [web/src/tunnels.ts#L279-L288](file:///Users/pan-work/guilinol-xp-overnight/web/src/tunnels.ts#L279-L288) |

---

## 一、Q1：坐标与入口重叠详表（三套地下/室内系统 vs 交警执勤区）

### 1.1 系统总览与空间分布距离

| 系统 | 源码归属 | 世界参考原点 `(x, y, z)` | 行走/地面标高 | 空间关系与重叠判定 |
| :--- | :--- | :--- | :--- | :--- |
| **本组 `shizijie.glb` B1** | [pipeline/landmarks/shizijie.py#L1585-L1695](file:///Users/pan-work/guilinol-xp-overnight/pipeline/landmarks/shizijie.py#L1585-L1695)<br>[web/src/tunnels.ts#L222-L256](file:///Users/pan-work/guilinol-xp-overnight/web/src/tunnels.ts#L222-L256) | `(-879.750202, 151.3, -169.626045)` | 地面 `151.3 m`<br>B1 地板 `147.1 m`（深 `4.2 m`，吊顶 `-1.05 m` / `ceil_y_bot -1.11 m`） | 世界包络 `x ∈ [-945.54, -820.21]`，`z ∈ [-228.61, -111.35]`，含 16 商铺、16 卷帘门与 4 条下沉梯井 |
| **隔壁 `szj`（十字街室内）** | [web/src/shizijie/entry.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/entry.ts)<br>[web/src/shizijie/contract.ts#L37-L46](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/contract.ts#L37-L46) | `(-879.750202, 151.3, -169.626045)` | 触发面 `151.3 m`<br>室内 `indoorFloorY = 0`（深 `4.2 m`） | **与本组 `shizijie.glb` 原点、高程、4 个梯井 100% 重合**；并在 `160 m` 内自动生成 4 座地面重复雨棚（`ensureSzjHoods`） |
| **隔壁 `xxg`（中心广场小香港）** | [web/src/xiaoxianggang/entry.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/xiaoxianggang/entry.ts)<br>[web/src/xiaoxianggang/contract.ts#L38-L47](file:///Users/pan-work/guilinol-xp-overnight/web/src/xiaoxianggang/contract.ts#L38-L47) | `anchorWorld = (-845, 232)`<br>挂载检测参考 `(-892, 214)` | 地面触发 `surfaceY = 153.868 m` | 距十字街原点 **403.13 m**（距挂载参考点 **383.82 m**），距解放桥中心 **703.70 m**；**完全零重叠** |
| **解放桥交警执勤区** | [web/src/traffic-duty/types.ts#L98-L109](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/types.ts#L98-L109) | 中心 `(-168, 40)`（`radiusM: 240`）<br>岗位 `(-266.26, 151.85, 26.86)`<br>传送 `(-268.5, 151.86, 24.8)` | 桥面 `~151.85–151.86 m` | 距十字街原点 **741.98 m**（交警岗↔十字街 **644.19 m**），距 `xxg` 挂载参考 **653.37 m** |
| **十字街预留交警区 & 信号灯** | [web/src/traffic-duty/types.ts#L112-L119](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/types.ts#L112-L119)<br>[web/src/traffic-duty/npc-officer.ts#L52-L61](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/npc-officer.ts#L52-L61)<br>[web/src/traffic-duty/traffic-signals-overlay.ts#L74-L79](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/traffic-signals-overlay.ts#L74-L79) | 中心 `(-879.75, -169.63)`（`radiusM: 180`）<br>岗亭交警 `(-854.38, 151.45, -170.57)` | 地面 `~151.45 m` | 交警岗在东北安全岛（距原点 **25.39 m**，距最近 `ne` 梯口 **32.71 m**），信号灯门架位于十字路角（如 `ne: (-853.25, -197.13)`），与 4 个梯井均无几何冲突 |

### 1.2 全量入口精确世界坐标对照表

#### A. 十字街 4 个梯井（本组 `shizijie.glb` + `public/landmarks/shizijie.json` + 隔壁 `szj` 共用同套坐标）

> 证据：`HEAD` 版本 [public/landmarks/shizijie.json](file:///Users/pan-work/guilinol-xp-overnight/public/landmarks/shizijie.json)、[web/src/shizijie/contract.ts](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/contract.ts)（与 [pipeline/shizijie_underpass.py](file:///Users/pan-work/guilinol-xp-overnight/pipeline/shizijie_underpass.py) 完全同源）。

| 梯井 ID | 角落标签 | 宽×长 (m) / 偏航 | 地面梯口 `mouthWorld` `(x, y, z)` | `szj` 退出落点 `landing` `(x, z, yaw)` | 深端 `shizijie.json worldDeep` / `szj footWorld` `(x, y, z)` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `shizijie_stair_nw` | 南方大厦 · NW出口 | `3.4 × 9.0` / `72°` | `(-906.530, 151.3, -209.817)` | `(-907.957, -210.280, yaw=1.2566)` | JSON `(-897.970, 147.1, -207.035)` / SZJ `(-896.544, 147.1, -206.572)` |
| `shizijie_stair_ne` | 解放东路 · NE出口 | `3.4 × 9.0` / `-45°` | `(-833.568, 151.3, -195.808)` | `(-832.508, -196.869, yaw=-0.7854)` | JSON `(-839.932, 147.1, -189.444)` / SZJ `(-840.993, 147.1, -188.383)` |
| `shizijie_stair_se` | 文化大厦 · SE出口 | `3.4 × 9.0` / `-158°` | `(-855.564, 151.3, -118.954)` | `(-855.003, -117.563, yaw=-2.7576)` | JSON `(-858.936, 147.1, -127.298)` / SZJ `(-859.498, 147.1, -128.689)` |
| `shizijie_stair_sw` | 微笑堂 · SW出口 | `3.2 × 8.8` / `-131.2°` | `(-922.640, 151.3, -145.228)` | `(-921.511, -144.240, yaw=-2.2899)` | JSON `(-929.261, 147.1, -151.024)` / SZJ `(-930.389, 147.1, -152.012)` |

> ⚠️ **地面雨棚双层重叠隐患**：[pipeline/landmarks/shizijie.py#L1470-L1529](file:///Users/pan-work/guilinol-xp-overnight/pipeline/landmarks/shizijie.py#L1470-L1529) 已为 `nw/ne/se` 烘焙地面梯井雨棚（`sw` 在 `nikoniko.py` 处理）；而 [web/src/main.ts#L786-L815](file:///Users/pan-work/guilinol-xp-overnight/web/src/main.ts#L786-L815) 只要玩家进入原点 `160 m` 内即调用 `ensureSzjHoods()` → `createSurfaceStairwellHoods(pack, { worldSpace: true })`（[web/src/shizijie/look/canopy.ts#L171-L181](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/look/canopy.ts#L171-L181)），按 `sampleMissionGroundY` 在完全相同 4 处生成第二套前端程序化雨棚与护栏，会视觉叠穿（Z-fighting / 双顶棚）。

#### B. 隔壁中心广场 `xxg`（小香港）4 个入口

> 证据：[web/src/xiaoxianggang/contract.ts#L38-L153](file:///Users/pan-work/guilinol-xp-overnight/web/src/xiaoxianggang/contract.ts#L38-L153)、[web/src/xiaoxianggang/entry.ts#L91-L94](file:///Users/pan-work/guilinol-xp-overnight/web/src/xiaoxianggang/entry.ts#L91-L94)。

| 入口 ID | 方位 | 门框世界坐标 `(x, y, z)` | 退出落点 `landing` `(x, z, yaw)` | 触发区半径 / 与最近十字街梯口距离 |
| :--- | :--- | :--- | :--- | :--- |
| `E1` | 东南入口 | `(-874.805, 153.868, 249.245)` | `(-880.247, 247.238, yaw=1.2174)` | `halfWidth=2.1`, `zMin=-1.2`, `thresholdZ=3.0`, `yTolerance=2`；距 `se` 梯口 > 368 m |
| `E2` | 东北入口 | `(-856.467, 153.868, 199.531)` | `(-851.025, 201.538, yaw=-1.9242)` | 同上；距 `shizijie_stair_se` 梯口 **318.49 m**（到 `E2 landing` **320.52 m**） |
| `W1` | 西南入口 | `(-924.911, 153.868, 223.303)` | `(-930.353, 221.296, yaw=1.2174)` | 同上 |
| `W2` | 西北入口 | `(-911.417, 153.868, 186.721)` | `(-916.859, 184.714, yaw=1.2174)` | 同上；距 `shizijie_stair_se` 梯口 **310.74 m**（距挂载点 `(-892, 214)` 33.48 m） |

#### C. 当前工作区关联阻塞提醒（只读核查发现）
- `public/landmarks/shizijie.json` 与 `pipeline/landmarks/shizijie.py#L1545-L1577` 当前工作树含未解决的 Git 冲突标记（`<<<<<<< HEAD`）。
- 影响：[web/src/tunnels.ts#L279-L288](file:///Users/pan-work/guilinol-xp-overnight/web/src/tunnels.ts#L279-L288) 中 `loadShizijieUnderground()` 拉取 `/landmarks/shizijie.json` 时 `res.json()` 会抛出解析异常并被 `.catch(() => null)` 静默吞掉，导致 `registeredLandmarkUnderground = null`，从而让依赖 `shizijie.json` 多边形扩展的 B1 `inBore` 与防掉坑范围退化。需待主程按组决清理冲突。

---

## 二、Q2：走进本组 `shizijie.glb` B1 时，隔壁 `szj` 是否同时触发/拦截？

### 2.1 逐帧拦截链条（正常步行路线必然被拦截）

只要玩家以步行（`walker?.active && walker.vehicle === 'foot'`）走近十字街四座下沉楼梯之一，触发链如下：

1. **无距离门控的全局懒挂载**：  
   [web/src/main.ts#L804-L819](file:///Users/pan-work/guilinol-xp-overnight/web/src/main.ts#L804-L819) 注册了 `mountLazyShizijie`；与 `xxg` 限定在 `(-892, 214)` 半径 `112 m` 内才挂载不同（[web/src/xiaoxianggang/entry.ts#L91-L94](file:///Users/pan-work/guilinol-xp-overnight/web/src/xiaoxianggang/entry.ts#L91-L94)），`szj` 在 [web/src/shizijie/entry.ts#L120-L122](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/entry.ts#L120-L122) 只要 `ctx.getWalker()` 返回非空对象即立即加载。
2. **主循环逐帧写入足底标高与瞬时速度**：  
   [web/src/main.ts#L1013](file:///Users/pan-work/guilinol-xp-overnight/web/src/main.ts#L1013) 在 `!xxg.isIndoor()` 期间每帧执行 `szj.step(stepDt)`；其中足底高度按 `p.y - walkConfig.height * 0.5`（即 `p.y - 0.85`，[web/src/walk/config.ts#L39](file:///Users/pan-work/guilinol-xp-overnight/web/src/walk/config.ts#L39)）算出，速度为相邻两帧水平差 `vel = { x: p.x - szjPrevPos.x, z: p.z - szjPrevPos.z }`（[web/src/main.ts#L816-L818](file:///Users/pan-work/guilinol-xp-overnight/web/src/main.ts#L816-L818)）。
3. **梯口无按键自动抢先拦截**：  
   [web/src/shizijie/runtime/controller.ts#L610-L612](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/runtime/controller.ts#L610-L612) 与 [web/src/shizijie/contract.ts#L249-L269](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/contract.ts#L249-L269) 的 `shouldEnterStair()` 同时检验 4 个条件：
   - 高程：`Math.abs(pos.y - 151.3) <= 2`（即足底处于 `149.3 m ~ 153.3 m`）
   - 横向：`Math.abs(l.x) <= st.width / 2 - 0.2`
   - 纵向：`l.z ∈ [-hl - 0.6, -hl + 0.8]`（恰好落在地面入口刚跨入雨棚门洞的前 `1.4 m` 区间，高度几乎仍是 `151.3 m`！）
   - 方向：`vel.x * st.inward.x + vel.z * st.inward.z > 0`（只要玩家朝下楼梯方向走）  
   **结果**：玩家在物理身体还没顺着本组 `shizijie.glb` 斜坡梯阶下降到 `149.3 m` 以下之前，就已经在地面梯口处触发 `void enter(res.triggeredStair.id)`。
4. **接管后冻结主世界并遮蔽渲染**：  
   `szj.enter()`（[web/src/shizijie/runtime/controller.ts#L464-L525](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/runtime/controller.ts#L464-L525)）调用 `suspendWorld()`：执行 `walker.hold(true)` + `walker.showFigure(false)`（[web/src/main.ts#L826-L829](file:///Users/pan-work/guilinol-xp-overnight/web/src/main.ts#L826-L829)），随后在主渲染 loop 中跳过 `!anyIndoor` 分支，只调用 `szj.render()`（[web/src/main.ts#L925-L927, L967-L1015](file:///Users/pan-work/guilinol-xp-overnight/web/src/main.ts#L925-L927)），将玩家送入隔壁自己搭建的 `indoorFloorY = 0` 独立 Three.js 场景（而非本组烘焙的 `shizijie.glb` `underground` 节点）。
5. **近口 `[E]` 提示兜底拦截**：  
   即使玩家贴口停步不触发速度条件，只要距离梯井中心 $\le \text{promptRadius} = \text{length} \times 0.5 + \text{landingOut} \times 2 = 7.5\text{ m}$ 且 `|y - 151.3| <= 2`（[web/src/shizijie/runtime/state-machine.ts#L78](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/runtime/state-machine.ts#L78)），界面会弹出 `[E] 进入`；按下 `KeyE` 同样直入 `szj`（[web/src/shizijie/runtime/controller.ts#L320-L324](file:///Users/pan-work/guilinol-xp-overnight/web/src/shizijie/runtime/controller.ts#L320-L324)）。

### 2.2 本组 `shizijie.glb` B1 在什么条件下反而可被进入与漫游？

- **绕开 `szj` 触发盒的高程阈值**：`shouldEnterStair` 严格要求 `|footY - 151.3| <= 2`，即当玩家**直接传到 B1 底板 `y = 147.1 m`** 时，`|147.155 - 151.3| = 4.145 > 2`，既不在地面梯口区，`yTolerance = 2` 也不满足，`szj` 完全不介入。
- **技术落位机制**（[web/src/main.ts#L352-L414](file:///Users/pan-work/guilinol-xp-overnight/web/src/main.ts#L352-L414)）：
  - `walkTo(x, z, yaw, reason, name, request, targetY)` 支持第 7 参数 `targetY`。
  - 虽然 `player.enter(x, z, ...)` 先按地面落在十字街广场中心 `(-879.75, 151.3, -169.63)`（距四座梯井 ~44–52 m 且静止速度为 0，不会误触 `szj`），紧接着 `main.ts#L400-L414` 会检测 `desiredY = 147.1`，调用 `player.carSupportAt(x, z, 147.1)`（[web/src/walk/support.ts#L17-L24](file:///Users/pan-work/guilinol-xp-overnight/web/src/walk/support.ts#L17-L24) 在 `refY + 0.55 = 147.65 m` 以下命中 B1 地板）→ `resolveDutyTeleportDeckY`（[web/src/traffic-duty/types.ts#L170-L175](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/types.ts#L170-L175)）→ `walker.clampPosition({ x, y: deckY + 0.055, z })`（[web/src/walk/index.ts#L3201-L3207](file:///Users/pan-work/guilinol-xp-overnight/web/src/walk/index.ts#L3201-L3207)），将角色直降进 `shizijie.glb` B1。
  - 进入后，`walk/index.ts#L2086, L2584` 与 `walk/camera.ts#L100-L118` 会通过 `underpassFloor(...)` 将 `inBore` 置为 `true` 并把第三人称相机顶棚限制在 `activeUg + 3.04 - 0.22 m`（防穿出地面路面）。
  - *(注：以上基于静态源码逐行核验，待 `public/landmarks/shizijie.json` 冲突修复后即可在运行态按此链路落底。)*

---

## 三、Q3：解放桥执勤范围与十字街地下是否互斥？一局内能否共存？

### 3.1 「正在值班中」：强物理钳位互斥

- **执勤区锁定解放桥**：虽然 `DUTY_ZONES` 同时定义了 `JIEFANG_DUTY_ZONE` 与 `SHIZIJIE_DUTY_ZONE`（[web/src/traffic-duty/types.ts#L98-L125](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/types.ts#L98-L125)），但当前开班入口 `enterActiveDutyFromBriefing()` 写死 `shiftZone = JIEFANG_DUTY_ZONE`（[web/src/traffic-duty/controller.ts#L862-L865](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/controller.ts#L862-L865)）。
- **越界逐帧拉回桥面**：`phase === 'active'` 时，[web/src/traffic-duty/controller.ts#L1636-L1646](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/controller.ts#L1636-L1646) 每帧判断 `!isInBridgeDutyBounds(pos)`，一旦玩家试图走下桥、或用代码/传送到 742 m 外的十字街或 704 m 外的小香港，当帧即执行 `clampToBridgeDutyBounds(pos)`（[web/src/traffic-duty/types.ts#L143-L164](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/types.ts#L143-L164)）把角色坐标强拉回解放桥桥面内侧并亮起 `'正在值班 · 请留在解放桥执勤范围内'`。
- **按键/状态无冲突但被地理隔离**：`xxg` 与 `szj` 的 `[E]` 交互虽然也监听 `KeyE`（和执勤「挥旗拦停/放行」同键），但执勤中人物被锁死在解放桥桥面，根本无法抵达十字街/小香港触发区。

### 3.2 「同一局不刷新页面」：完全可以前后顺序共存并往返续班

只要通过以下任一方式结束当前班次（`phase` 从 `'active'` 切到 `'summary'`，无需刷新页面、钱包余额与排行榜战绩全部保留）：

1. **向解放桥交警交差下岗**（推荐，拿走 10% 分成）：在桥头靠近交警按 `[F]`，或点顶部 `.td-bar` 的「下岗交差」 / `.td-panel` 的「下岗交差」，完成交差对话后调 `completeOffDutySettlement()` → `recordAndSummarize(true)`（[web/src/traffic-duty/controller.ts#L964-L1069](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/controller.ts#L964-L1069)）。
2. **等待 10 分钟班次倒计时结束**：自动走 `finishDuty()` → `recordAndSummarize(true)`（[web/src/traffic-duty/controller.ts#L1078-L1082](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/controller.ts#L1078-L1082)）。
3. **中途随时离开**：点 `.td-bar`「放弃」或 `.td-panel`「直接放弃」，调用 `abandonDuty()`（[web/src/traffic-duty/controller.ts#L1071-L1076](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/controller.ts#L1071-L1076)，注意未交差将清零该班未领 10% 分成）。

上述任一路径都会立刻执行：
- `setGear({hasWhistle: false, hasFlag: false})` 与 `syncDutyBodyAndPanels(false)`（[web/src/traffic-duty/controller.ts#L1040-L1043](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/controller.ts#L1040-L1043)）：脱下反光背心、卸下哨子/指挥旗，解除桥面边界钳位。
- **十字街往返解放桥的内置捷径**：[web/src/traffic-duty/controller.ts#L776-L780](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/controller.ts#L776-L780) 中 `inDutyZone` 使用的是 `resolveDutyZone(pos) !== null`（包含了半径 `180 m` 的 `SHIZIJIE_DUTY_ZONE`）。因此，**玩家逛完十字街地下回到十字街地面时**，[web/src/traffic-duty/ui.ts#L468-L475](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/ui.ts#L468-L475) 会自动亮出右上悬浮胶囊 `.td-entry`（「解放桥交警 · 644m」），点开后点击 **「前往解放桥交警 / 回解放桥交警岗」**（[web/src/traffic-duty/ui.ts#L384, L435](file:///Users/pan-work/guilinol-xp-overnight/web/src/traffic-duty/ui.ts#L384)），无论当前处于 `tour` 还是 `solo` 模式，都会触发 `onTeleportToZone('jiefang')` → `walkTo(-268.5, 24.8, -2.34, 'traffic-duty', '解放桥', undefined, 151.86)`（[web/src/main.ts#L741-L744](file:///Users/pan-work/guilinol-xp-overnight/web/src/main.ts#L741-L744)）直接传回解放桥西桥头续下一班。  
*(注：若在南偏的 `xxg` 中心广场，`(-892, 214)` 既超出 `SHIZIJIE_DUTY_ZONE` 180 m、距解放桥交警又约 `653 m > 260 m`，`.td-entry` 会暂时隐藏，往北回到十字街或桥边 260 m 内即重新出现。)*

---

## 四、Q4：老板一局内顺畅体验「交警执勤 + 两个地下」的操作路线

### 前置须知：三种访问模式的关键差异

1. **普通漫游模式（默认 / `?play=tour`）**：打开大地图（按 `M` 或点小地图圆盘，[web/src/play/map.ts#L284, L416](file:///Users/pan-work/guilinol-xp-overnight/web/src/play/map.ts#L284)）与景册时，「前往」按钮完全可用，可任意传送。
2. **单人闯关模式（`?play=solo`）**：出于沉浸限制，大地图弹窗与景册的「前往」按钮被刻意 `hidden disabled`（[web/src/play/map.ts#L347](file:///Users/pan-work/guilinol-xp-overnight/web/src/play/map.ts#L347)、[web/src/play/index.ts#L224](file:///Users/pan-work/guilinol-xp-overnight/web/src/play/index.ts#L224)）；但 **`.td-entry` / `.td-panel` 的「前往解放桥交警」按钮不受 `solo` 禁用**，且大地图标记导航线（漓江青路线引导）仍可用。
3. **核验调试模式（URL 带 `?verify`）**：仅此模式下 [web/src/main.ts#L870, L1054](file:///Users/pan-work/guilinol-xp-overnight/web/src/main.ts#L870) 会执行 `publishViewer()` 向控制台暴露 `window.viewer`（含 `walkTo`、`trafficDuty`、`szj`、`xxg`、`walk`）。

---

### 路线 A：纯 UI 正常游玩流程（一局不刷新，完整体验交警 + 十字街地下 + 中心广场小香港）

1. **阶段一 · 解放桥交警执勤**
   - 若不在解放桥：点右上角 `.td-entry`（「解放桥交警」）打开执勤面板，点 **`前往解放桥交警`**（`[data-td-action="go-bridge"]`），或 `?play=tour` 下按 `M` 搜 **`解放桥`** → **`前往`**。
   - 走到西桥头交警 `(-266.2, 151.85, 26.2)` 旁，按 **`F`** 对话领哨子与指挥旗进入 `active` 执勤。
   - 在桥面按 **`Q`**（吹哨）、**短按 `E`**（挥旗拦停）、**长按 `E`**（放行）、**`F`**（停稳开单）体验劝导罚款。
   - **关键解禁**：体验完成后**不要直接走下桥**，走到交警身旁按 **`F`** 或点击顶部栏 **`下岗交差`**（保留 10% 分成）或 **`放弃`**，确认交差弹窗后脱背心并解除桥面钳位。
2. **阶段二 · 前往十字街体验 `szj` 地下商业街**
   - **`tour` 模式**：按 `M` 打开大地图，搜 **`十字街`** → 点击列表项 → 点气泡 **`前往`**（直传 `(-881, -165)`）；也可找 NE 安全岛的十字街占位交警/4 座动态红绿灯合影。
   - **`solo` 模式**：先骑边上单车/电车向西沿解放东路直行约 640 m（或先按 `M` 搜 **`十字街`** → 点 **`标记导航`** 沿地图青线骑过去）。
   - 步行走向任一四角地面梯口（推荐东南入口 `se: (-855.6, -119.0)` 或西南微笑堂 `sw: (-922.6, -145.2)`，方便下一步往南去中心广场），走入梯口即自动切入 `szj` 室内（停在梯口旁亦可按 **`E`** 进入）。
   - 逛完沿任意出口走上楼梯（或近口按 **`E`**）自动落回地面 `stairLanding`。
3. **阶段三 · 向南步行/骑行进入 `xxg` 中心广场小香港地下街**
   - 注意：景册（[web/src/play/spots.ts#L11-L45](file:///Users/pan-work/guilinol-xp-overnight/web/src/play/spots.ts#L11-L45)）中没有「中心广场/小香港」词条（最近的观景点在北侧 `十字街 (-881, -165)` 或更南的 `日月双塔 (-905, 520)`）。
   - **`tour` 模式快速去法**：按 `M` 把地图视角往十字街正下方拉约 400 m（杉湖北岸 / 中心广场区块 `z ≈ 214`），直接**轻点地图画布中心广场位置**弹出气泡，点 **`前往`** 即可直传；或者从十字街文化大厦 `se` 出口顺中山中路向南走/骑约 **318 m**。
   - **`solo` 模式**：从十字街沿中山中路往南骑行/步行约 **380 m** 至中心广场（`(-892, 214)` 一带即可见 `xxg` 挂载）。
   - 从 `E2 (-856.5, 199.5)` 或 `W2 (-911.4, 186.7)` 等 4 个入口步入或近门按 **`E`**，进入 `xxg` 小香港地下街；游玩后按 **`E`** 或走出口阶梯返回地面。
4. **阶段四 · 返程回解放桥再接一班（可选）**
   - 回到十字街区域（进距十字街 180 m 内），右上 `.td-entry` 自动再亮起，点 **`回解放桥交警岗`**（或 `summary` 态下 **`找交警再接一班`** / **`前往解放桥交警`**）即可一秒回桥续班。

---

### 路线 B：`?verify` 控制台直达链路（含绕开 `szj` 体验本组 `shizijie.glb` 真 B1）

> 启动地址示例：`http://localhost:5173/?verify&play=tour`（**需带上 `?verify`**，`window.viewer` 才挂载；需先清理 `public/landmarks/shizijie.json` 冲突才能让本组 B1 `walkPolygon` 完整生效）。

在浏览器 DevTools Console 按顺序 `await` 执行以下语句即可同局无缝串联：

```js
// 1. 解放桥交警岗：传到桥头，可 F 对话领装开班
await window.viewer.walkTo(-268.5, 24.8, -2.34, 'traffic-duty', '解放桥', undefined, 151.86);

// （若已在 active 值班中，体验完毕想脱离桥面限制，切回 summary / idle 解钳位）
window.viewer.trafficDuty.abandonDuty(); // 或 finishDuty() / completeOffDutySettlement()

// 2. 绕开隔壁 szj 拦截，直落本组 shizijie.glb 真 B1 中庭（第 7 参 targetY = 147.1）
// 原理：直降 147.155 m 后 |147.155 - 151.3| = 4.145 > yTolerance(2)，szj 不触发，可在真实 GLB 地下逛 16 间商铺
await window.viewer.walkTo(-879.75, -169.63, 0, 'ug', '十字街真B1', undefined, 147.1);

// 3. 体验隔壁 szj 独立室内（可直接从上面或地面进入，此处落到 SE 文化大厦外口或调用探针）
await window.viewer.walkTo(-855.00, -117.56, -2.76, 'map', '十字街SE口');
await window.viewer.szj.enter('se'); // 也可走入梯口触发；退出可执行 await window.viewer.szj.exit()

// 4. 体验隔壁中心广场 xxg 小香港地下街（落在西北 W2 落点外，随即进店或调用 enter）
await window.viewer.walkTo(-916.86, 184.71, 1.22, 'map', '中心广场W2口');
// 等一小步走入 W2 门框或直接：
await window.viewer.xxg.enter('W2'); // 退出可执行 await window.viewer.xxg.exit()

// 5. 同局一键回解放桥继续交警执勤
await window.viewer.walkTo(-268.5, 24.8, -2.34, 'traffic-duty', '解放桥', undefined, 151.86);
```

---

## 五、给组长的架构合拢建议（仅供后续整合参考，本文档保持只读现状）

1. **明确十字街 B1 主副权（防地面双棚 + 抢占拦截）**：当前 `shizijie.glb` 实景 B1 与隔壁 `szj` 存在**同一物理坐标双系统抢占**（步行永远被 `szj` 拦截且地面出现两套梯井罩）。若决定保留 `szj` 作为可逛室内，建议给 `ensureSzjHoods()` 增加开关避免与 `shizijie.py` 烘焙雨棚重叠；若决定由本组 `shizijie.glb` B1 承担实景地下通行，则应在 `main.ts` 关闭/条件挂载 `szj` 的地面抢占器，避免玩家永远进不去本组 B1。
2. **大地图快捷检索补充**：`spots.ts` / `map.ts` 当前无「中心广场 / 小香港」关键词与独立入口标，建议后期补一个置景点或检索别名，降低玩家从十字街找路到 `xxg` 的门槛。
3. **优先解决冲突文件**：合并清理 `public/landmarks/shizijie.json` 与 `pipeline/landmarks/shizijie.py` 的 `<<<<<<< HEAD` 冲突，恢复 `loadShizijieUnderground()` 的 `walkPolygon` 解析。

---

## 六、PR 用主线十字街（`/tmp/szj-main` 实测证据）

> 测试时间：2026-11-26 00:16–00:19；方法：只读不改主仓代码，使用 `cp -a` 将当前 worktree 全树复制到 `/tmp/szj-main`（排除 `node_modules` 并软链回主仓 `node_modules`），将 `pipeline/landmarks/shizijie.py`（82,053 B）、`public/landmarks/shizijie.glb`（1,774,164 B）、`public/landmarks/shizijie.json`（105 B）三件套替换为 `git show origin/main` 版本后实测，完测已清理删除 `/tmp/szj-main`。

### 6.1 `/tmp/szj-main` 实测命令与原始输出

1. **TypeScript 类型检查（`npx --no-install tsc -p web --noEmit`）**：
   ```bash
   cd /tmp/szj-main && npx --no-install tsc -p web --noEmit
   # 输出为空，TSC_EXIT=0（0 错误）
   ```

2. **`shizijie`、`stairs` 与 `tunnels` 相关单测**：
   - 使用原生 `--experimental-strip-types` 时，`web/src/locomotion/stairs/stairs.test.mjs`（9/9）与 `web/src/shizijie/*/*.test.mjs`（36/36）合计 **45/45 PASS**；仅 `scripts/test-tunnel-ceiling.mjs` 因 `web/src/station-tunnels.ts` 使用无 `.ts` 后缀 `import './crossing-panels'` 报错（`ERR_MODULE_NOT_FOUND`）。改用仓内标准 `tsx`  loader 后全部通过（**46/46 PASS，退出码 `0`**）：
   ```bash
   cd /tmp/szj-main
   ESBUILD_BINARY_PATH=/tmp/esb/package/bin/esbuild node --import tsx --test \
     web/src/locomotion/stairs/*.test.mjs \
     web/src/shizijie/*/*.test.mjs \
     scripts/test-tunnel-ceiling.mjs
   # 实测输出摘要：
   # tests 46 | pass 46 | fail 0 | duration_ms 2560.9395 | UNIT_EXIT=0
   ```
   - 障碍体体积与护栏碰撞单测同步通过：
   ```bash
   cd /tmp/szj-main
   ESBUILD_BINARY_PATH=/tmp/esb/package/bin/esbuild node --import tsx --test web/src/walk/obstacle-volumes.test.mjs
   # tests 10 | pass 10 | fail 0 | duration_ms 2992.575125
   ```
   - 十字街安全岛与地下连通 Python 校验：
   ```bash
   PYTHONPATH=/tmp/szj-main/pipeline:/tmp/szj-main/pipeline/landmarks /Users/pan-work/guilinol-xp-overnight/.venv/bin/python scripts/check-shizijie-islands.py
   # NW/NE/SE/SW 4 安全岛检查全部通过
   # Underground manifest connectivity OK: 4/4 stairs in 1 component (floorY=147.10m, ceil=3.15m, walkable=3918.3 m²)
   # shizijie.json underground: not yet populated (manifest fallback active)
   ```

3. **`origin/main` 三件套结构、GLB 节点与 `web/src/tunnels.ts` 运行态实测**：
   - **GLB 与 JSON 构成对比**：
     - `origin/main` `public/landmarks/shizijie.json` 仅 105 B：`{"sphere": [21.605609893798828, 14.649999808520079, -4.5, 162.18023234160643], "lods": ["lod0", "lod1"]}`（无 `underground` 元数据）。
     - `origin/main` `public/landmarks/shizijie.glb`（1,774,164 B）节点：`lod0_szj_surfaces`, `lod0_foliage`, `lod1_szj_surfaces`, `lod1_foliage`（保留主线地表樟树绿植），**无任何 `underground*` 节点**；`pipeline/landmarks/shizijie.py` 无 `stair_hole_ring`、`build_surface_stairwell`、`build_shizijie_underground`。
   - **隔壁 `szj` 零耦合核验**：
     - `grep -rnE "tunnels|shizijie\.glb|shizijie\.json|shizijieUnderpass|groundCutouts" web/src/shizijie/ web/src/locomotion/` → **`ZERO_REFS`**。
   - **`web/src/tunnels.ts` 双态行为实测**（在 `/tmp/szj-main` 用 `node --import tsx` 直接调用导出的 `parseShizijieLandmarkUnderground` / `underpassFloor` / `isWalkableUnderground` / `tunnelGeometry`）：
     ```text
     1) parsed origin/main shizijie.json: null
     2) no-manifest underpassFloor(-879.75,-169.63,147.1): undefined
     3) no-manifest isWalkableUnderground: false
     4) no-manifest tunnelGeometry: null
     5) with-manifest underpassFloor(-879.75,-169.63,147.1): 147.1
     6) with-manifest nw stair mid 149.2: 149.2605933072633
     7) with-manifest tunnelGeometry parts: [ 'fringe', 'floor', 'interior', 'portal', 'band', 'ceiling', 'lamp', 'lane' ] registeredLandmarkUnderground: null
     ```
   - **地面几何碰撞交叉（`.venv/bin/python` Shapely 实测）**：
     - `origin/main` `shizijie.py` 的实心铺装 `nw_apron`（未做 `stair_hole_ring` 挖孔）与西北梯井 `shizijie_stair_nw` 重叠 **5.39 m²**（`mouth_in=True, landing_in=True`）；`ne_apron`、`se_apron` 与 `ne/se/sw` 梯井零相交。
     - 主线 `web/src/shizijie-zone.ts` 新增的 `SHIZIJIE_CURB_BARRIER_POLYLINES` 路缘护栏与四处入口 `mouth`/`landing` 最小间距：`nw` **15.04 m**、`ne` **16.51 m**、`se` **17.21 m**、`sw` **3.43 m**（全数留空，未封堵梯口进出）。

### 6.2 「PR 用主线十字街」能不能进出地下的结论

1. **隔壁 `szj`（`web/src/shizijie/` 独立室内地下街）：完全可以正常进出地下，且比双留更干净。**
   - 代码层面零依赖 `shizijie.py / glb / json` 与 `tunnels.ts`，`tsc` 0 错、`46/46` 单测全绿（其中 `runtime.test.mjs` 含 `nw/ne/se/sw` 4 口 headless 进入→地下漫游→返回 `stairLanding` 实跑断言）。
   - `origin/main` 的 `shizijie.glb` 不含本组烘焙梯井雨棚，切回主线三件套后反而**自动消除**前文指出的 `ensureSzjHoods()` 双层雨棚叠穿问题，且保留主线路口樟树与绿植（`lod0_foliage`）；`nw/ne/se/sw` 四口均未被 `IDOK-412` 路缘护栏阻挡，玩家踩在地面/花岗岩广场（`151.3~151.47m`，完全落在 `SZJ_TRIGGER.yTolerance = 2` 内）即可顺畅触发进出（唯一小瑕疵：西北 `nw` 雨棚底边贴在 `nw_apron` `0.17m` 砖面之上，需上线实看是否微浮/微埋）。
   - 同时中心广场 `xxg`（`web/src/xiaoxianggang/`）完全不受影响，照常进出。
2. **本组 `shizijie.glb` 实景 B1 + `web/src/tunnels.ts`：不再可经楼梯走进并看到本组实景 B1。**
   - `public/world/` 在 Git 仓中不追踪（`git ls-files public/world/` 为 0）。按 `origin/main` 纯净世界构建运行时，因 `shizijie.json` 返回 `null` 且 `manifest` 无 `shizijieUnderpass`，`underpassFloor` 恒为 `undefined`、`tunnelGeometry` 返回 `null`，本组实景 B1 从场景中干净退出，全部由 `szj` 接管。
   - 即使部署端误保留了含 `shizijieUnderpass` 的旧 `public/world/manifest.json`，也会出现两个残缺：`origin/main` `shizijie.glb` 中没有 `underground*` 商铺节点；且 `nw_apron` 实心铺装盖死 `nw` 梯口 `5.39 m²`，同时 `szj` 会在地面 4 处梯口继续抢先拦截步行玩家。
3. **给老板拍板对照建议**：
   - 若 PR 目标是**快速干净合入 `main`、零冲突不返工、保留主线十字街地表绿植、用 `szj` + `xxg` 与解放桥交警同局体验** → 选**「PR 用主线十字街（三件套取 `origin/main`）」**最稳，已实测 `tsc` 0 错、`46/46 + 10/10` 单测全通过、`szj` 四口可正常进出、且消除地面双棚重影。
   - 若必须在本 PR 保留**本组 `-4.2 m` `shizijie.glb` 真 B1 实景通路** → 才需取本组三件套，并在 `main.ts` 对 `szj` 梯口拦截与 `ensureSzjHoods()` 补齐开关隔离。

