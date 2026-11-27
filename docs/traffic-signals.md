# 红绿灯：唯一真源

全城红绿灯只有一份相位算法和一只时钟，都在 `web/src/traffic/signals.ts`。车流、执勤区车流、灯头显示、玩法判定、验证探针都从这里读，任何模块不得再自己写周期取模或自己计时。

## 数据

路网每个 cell（`public/world/roads/<col>_<row>.json.gz`）的 `signals` 数组，一项一个信号节点：

```json
{"node": 626322720, "group": 626322720, "offset": 22,
 "phases": [{"lanes": [9366, 9381], "green": 18, "yellow": 3},
            {"lanes": [610, 9420],  "green": 18, "yellow": 3}]}
```

- 定时控制：相位依次放行，周期 = 各相位 `green + yellow` 之和。
- `lanes` 是驶向该节点、在该相位有路权的车道 id；不在当前相位里的车道一律红灯。
- 车道 id 每次重建路网都会重新编号。代码里不要写死车道 id；要按方向取灯就按相位序号读 `citySignalState(node).phase`。
- `offset` 秒加在时钟上，用来错开相邻路口。
- 同一节点出现在多个 cell 里时方案一致（全量 687 条 / 152 个节点已核对）。

## 接口

| 要做什么 | 用什么 |
|---|---|
| 某车道此刻的灯色 | `citySignalColor(node, lane)` → `'green' \| 'yellow' \| 'red' \| null` |
| 路口当前相位、剩余秒数 | `citySignalState(node, out?)` → `{phase, color, remaining, cycle}` |
| 任意时刻的灯色（预测、回放、测试） | `citySignals.color(node, lane, time)` |
| 已加载的信号节点 | `citySignals.nodeIds()`、`citySignals.spec(node)` |
| 当前信号时间 | `citySignalClock.now` |

`null` 表示该节点没有信号或所在 cell 还没加载。查询不分配对象；`state()` 不传 `out` 时返回共享对象，读完即用，要留着就传自己的 `out`。

车流 sim 内部仍用 `sim.phase(track)` / `sim.green(track)` / `sim.getSignalPhase(lane, node)`，它们只负责选时间，算法在 `SignalPlan`。

## 时钟由谁推

三个系统各有自己的帧节奏，但时钟只有 `citySignalClock` 一只。每个系统拿一个带优先级的 `SignalDriver`，每帧报一次自己的 `dt`；时钟只收当前还在跑的最高优先级那一个：

| 优先级 | 谁 | 何时在推 |
|---|---|---|
| `street` | 街面车流 `traffic/index.ts` | 街面 sim 已加载并启用 |
| `duty` | 执勤区车流 `traffic/duty-traffic.ts` | 街面 sim 没在跑 |
| `visual` | 十字街灯头 `traffic-duty/traffic-signals-overlay.ts` | 没有任何 sim 在跑 |

仲裁只看调用先后，不看系统时间，所以无头快进和单元测试结果确定。高优先级一停，下一帧就由次级接手，时钟不停也不会走快。

每个 sim 保留自己的 `time`（执勤 sim 开场要自己预演 85 秒）。宿主在每帧步进前设 `sim.signalShift = citySignalClock.now - 未步进余量 - sim.time`，于是 `sim.time + sim.signalShift` 就是共享时钟。没人同步的裸 `new Traffic()`（测试、脚本）`signalShift` 为 0，行为和以前一样。

## 新增一个读灯的模块

1. 只 import `traffic/signals.ts`，不要 import `sim.ts`。
2. 用 `citySignalColor` / `citySignalState` 读；需要在没有 sim 时也让灯走，就 `citySignalClock.driver(SIGNAL_DRIVER_RANK.visual)` 并每帧 `advance(dt)`。
3. 只在灯色变化时改材质或实例颜色，不要每帧写。

## 验证

- 单元测试：`npm run verify:signals`（纯 node，约 1 秒）。逐秒对拍旧公式、时钟仲裁、`signalShift`。
- 十字街灯头：`node --test web/src/traffic-duty/traffic-duty.test.mjs`。灯头按相位序号读灯（东西 0、南北 1），测试用路网几何核对这个顺序；路网重建后顺序变了会在这里报错。
- 浏览器探针（`?verify`）：`viewer.trafficProbe.signals`
  - `clock()` 当前信号时间；`count()` / `nodes()` 已加载节点
  - `state(node)` 相位、颜色、剩余秒、各相位车道
  - `color(node, lane)` 真源读数；`sim(node, lane)` 街面 sim 读数（两者应始终相同）

# 全城信号灯头

每个有信号的路口，每个进口立一个灯头：司机右手边路缘上、路口前几米、面朝来车。十字街除外，那里的龙门架在地标模型里，由 `traffic-duty/traffic-signals-overlay.ts` 点亮（`signal-heads.ts` 的 `LANDMARK_SIGNAL_GROUPS`）。

| 文件 | 管什么 |
|---|---|
| `web/src/traffic/signal-approach.ts` | 纯计算，不依赖 three.js：从路网算出进口，再从街面数据找灯杆位置 |
| `web/src/traffic/signal-heads.ts` | 把全部灯头画成两个网格（杆与灯箱一个、灯片一个），全城共 2 个 draw call |
| `web/src/traffic/index.ts` | 换路网 cell 时交进口表，每帧调一次 `update` |

## 摆位规则

- **进口**：驶入信号节点、在该节点相位表里、起点不属于同一路口的机动车道。同一对「起点 > 信号节点」的车道算一个进口，一个进口一个灯头。全量路网 195 个进口 / 51 个路口，每个进口只属于一个相位（单测核对）。
- **灯杆**：从节点沿车道往回 5–41 m 逐段找；每处从最右车道中心向右找路缘（第一处既不是路面也不是护栏、再往外 0.75 m 仍然两者都不是的点），并要求再往回 3 m 处路缘距离相差不超过 1 m，这样灯杆落在转角弧线之外。杆立在路缘外 0.75 m。
- **只沿真实车道找**：进口自己的车道不够长时（全量路网里 12 个进口不到 8 m），接着沿喂给它的那一条路往回走（`SignalApproach.path`）。遇到另一个信号节点、分叉或汇入（对齐的上游不止一条）、转弯超过约 26°、高架，就停。绝不沿直线外推到车道起点之外；折线总长不到 8 m 的进口没有灯头（当前路网里没有，单测断言）。
- **样式**：`tertiary`、`residential`、`service`、`unclassified`、`living_street` 这些小路，以及路缘离最右车道中心不到 2.25 m 的进口，灯头直接装在 3.75 m 立杆上；其余用 7.2 m 杆加悬臂，悬臂伸到最右车道中心上方，最长 6.5 m。
- **没有灯头的进口**：高架和桥上的车道（`gradeSeparated`）不算进口；车道中心不在街面数据的路面上（缺数据），或 18 m 内找不到路缘的，探针里计入 `none`。
- 灯杆对步行和开车的玩家是障碍物（`signal-heads.ts` 自己的 `SolidGrid`，经 `traffic/index.ts` 的 `near` 接入），隐藏时不挡路。街面 NPC 只走车道和步道，不受影响。
- 位置不写进世界数据，运行时算；420 m 以外或街面地块没加载到的进口先挂起（探针里的 `pending`），玩家走近后补上，找到的位置整局记住。
- 找路缘的开销有上限：每 0.1 秒只看一个进口的 2 个距离（一次最多约 300 次街面查询，单测断言），没找完下次接着找；地块没到的进口 1.5 秒后再看，已排除的距离不重扫。

改规则只动 `signal-approach.ts` 顶部的常量。

## 灯色

灯头不推时钟，只读 `citySignals.color(节点, 车道, citySignalClock.now)`。每帧比对，灯色变了才写那一个灯头的颜色缓冲。街面交通关掉时灯头一起隐藏；`?verify` 的 `staticOnly` 模式下灯头照常更新。镜片颜色用 `signals.ts` 的 `SIGNAL_LENS_HEX`，和十字街龙门架同一组。

## 验证

- `npm run verify:signal-heads`：单测，约 1 秒。合成路口上的进口筛选、路缘与转角、朝向、悬臂、地块未加载、隔离带不算路缘；短进口沿上游折线找、分叉/急弯/上游信号/高架处停；分帧续扫与退避；网格里亮灯镜片的实际位置；一整个周期里颜色缓冲与真源逐帧一致；灯色不变时不上传缓冲。
- `npm run verify:signal-heads:city`：无头真浏览器（先 `npm run build`）。5 个机位上核对：只多 2 个 draw call、灯杆不在机动车路面上、十字街没有重复灯头、灯色与真源一致。`-- --shots <目录>` 另存每个灯头的司机视角截图和 `cameras.json`；`-- --shots <目录> --cameras <cameras.json>` 用同一批机位给另一份构建拍对照图（不做断言）。
- 浏览器探针（`?verify`）：`viewer.trafficProbe.signalHeads()` → `{total, pending, none, unplaced, visible, drawCalls, heads: [{key, node, group, lane, x, y, z, yaw, arm, back, kerb, shown, truth}]}`。`shown` 是从颜色缓冲读回来的亮灯，`truth` 是真源此刻的读数；`drawCalls` 是灯头组里渲染器会画的网格数（有灯头时 2，否则 0）；`unplaced` 列出还没立起来的进口和原因（`pending` / `none`）。

# 路边泊位线

路边停着车的地方，路面上画出泊位：每辆停放车一个，同一条路缘上隔一两个车位的两辆车之间补上空泊位。全城一个网格，1 个 draw call。

| 文件 | 管什么 |
|---|---|
| `web/src/traffic/parking-layout.ts` | 纯计算，不依赖 three.js：从停放车数据算泊位，算每个泊位的线条顶点 |
| `web/src/traffic/parking-bays.ts` | 把线条铺到路面上（一个网格），分帧读路面高度 |
| `web/src/traffic/parking-bay-audit.ts` | 只在 `?verify` 下按需加载：量漆面离画出来的路面多高 |
| `web/src/traffic/index.ts` | 停车 cell 变化时交停放车数据，每帧调一次 `update` |

## 规则

- **数据**：只读 `roads/parking/<cell>.json.gz` 里的停放车（`pipeline/traffic_parking.py` 写的），不改世界数据。pipeline 沿路缘每 6–7.5 m 一个车位，约一半留空，数据里只有停了车的那些。
- **泊位**：一辆车一个。同一条路缘（同一 yaw、横向相差不到 0.4 m）上最近的两辆车，间距是 1–3 个车位时连成一串，中间补 0–2 个空泊位；相邻泊位首尾相接，各画各的两条端线，接缝处两条线重合（一个泊位不画时，旁边的照样封口）。间距对不上整数个车位的不连，各画各的，长 6 m。算出来的泊位与数据行的先后顺序无关。
- **互压的不画**：弯道、两条车道叠在一起的地方，数据里的车比一个泊位还近（全量 36110 辆里 35 处）。每对里去掉一个：有车的优先留，同类按 key 排序留前一个，所以结果不随停车 cell 的加载顺序变。全量数据里任意两个泊位不相交（单测断言）。
- **形状**：线宽 0.1 m，颜色用街面标线同一个色（`look.streets.surfaces[2]`）。
  - 车贴着路缘（小路，车中心离路缘约 0.95 m）：三条线——两端端线和靠路中间的边线，路缘那一侧不画，端线离路缘 5 cm 收住。
  - 车停在路面中间（宽路上车中心离路缘约 2.5 m）：封成四边框，两条边线离车中心一样远（1.25 m）。判据是泊位后端、中间、前端三处，从车中心往路缘方向 1.5 m 都还是机动车路面（`BAY_BOX_CLEARANCE`）。
- **不画的泊位**（探针里计入 `none`）：
  - 中心不在机动车路面上的；补出来的空泊位落在机动车禁行区的。判一次，不再看。
  - 补出来的空泊位正好在支路口上的：后端、中间、前端三处里有一处，往路缘方向 4 m（`BAY_MOUTH_REACH`）还是机动车路面，就是路口，不画。真停了车的泊位不受这条影响。
  - 路面高度和数据里差 0.6 m 以上的（上面有桥、下面有坑）：连读 6 次都这样就先不画，之后每 30 秒再读一次，读数正常了照样画上。
- **高度**：读泊位四角的路面高度，线条按四角铺平，再抬高 1.2 cm。只铺玩家 110 m 以内的泊位，每帧最多看 4 个（16 次高度查询），最多扫过 256 个泊位找到期的。
  - 远处地块的路面碰撞体比地形晚到几秒，先读到的可能是地形高度。所以每个泊位隔 1 秒再读，连续 3 次读数一样才算定住；定住以后每 8 秒再读一次，地块重载或晚到的路面也能改正。
  - 街面地块或地面还没加载：1.5 秒后再看。
- **上传**：平时只上传改了的那个泊位的顶点；换停车 cell（所有泊位在缓冲里重排）或一次攒了 64 段以上时整个缓冲上传一次。整缓冲还没传上去之前不加分段，否则 three.js 只传分段，重排过的顶点就留在显卡上的旧位置。
- 街面交通关掉时泊位线一起隐藏。换停车 cell 时已经铺好的泊位保留高度，不重读。

改规则只动 `parking-layout.ts` 和 `parking-bays.ts` 顶部的常量。

## 验证

- `npm run verify:parking-bays`：单测，约 2 秒。泊位怎么连、空泊位、任意朝向、互压剔除、行顺序打乱结果不变；线条顶点在路面上且朝上；三条线与四边框的判定；首帧预算、每帧扫描上限、定住后的读数频率、地形高度被路面高度改正；非路面、桥下、禁行区、支路口；画出来的顶点与上传到显卡的一致（模拟 three.js 的上传）；全量停车数据上每辆车有泊位、任意两个泊位不相交。没有世界数据的检出里最后一项跳过并写明原因。
- `npm run verify:parking-bays:city`：无头真浏览器（先 `npm run build`）。4 个点位（两条宽路、两条居民街）× 桌面/手机两档，核对：线条网格每帧最多画 1 次（在渲染器里数实际绘制次数）、100 m 内泊位全部定住、定住后 16 秒内每个泊位只复查 1–3 次、泊位中心在机动车路面上、端线端头和四边框的路缘侧边线在路面上、每个点位四边框占比在该街道应有的范围内、有画出来的空泊位、不画的不超过 35%、漆面离画出来的路面 2–30 mm。`BAYS_SPOTS=lequn,east` 只跑指定点位。几何常量直接从 `parking-layout.ts` 读，不在脚本里另抄一份。`-- --shots <目录>` 另存总览、泊位近景、俯视截图和 `cameras.json`；`-- --shots <目录> --cameras <cameras.json>` 用同一批机位给另一份构建拍对照图（不做断言）。
- 浏览器探针（`?verify`）：
  - `viewer.trafficProbe.parkingBays()` → `{total, occupied, empty, drawn, boxed, settled, waiting, none, visible, drawCalls, samples, bays: [{key, x, y, z, headingX, headingZ, rear, front, occupied, state, boxed, settled, heights}]}`。`samples` 是开局以来查过的路面高度次数；`heights` 是四角读数（后端路缘侧、后端路侧、前端路侧、前端路缘侧）。
  - `await viewer.trafficProbe.parkingBayGaps({x, z}, 半径)` → `[{key, occupied, gaps, under}]`。从上往下打射线，`gaps` 是漆面减去它下面画出来的最高表面（边线、后端线，四边框再加路缘侧边线），负数就是线被埋了（约 −8 mm 是压在街面地块自带的标线下面，那些标线比路面高 2 cm）。
  - `await viewer.trafficProbe.parkingBayDraws(帧数)` → `{frames, draws, mostPerFrame}`。在渲染器里数这么多帧内线条网格实际画了几次、单帧最多几次。

# 全城性能基线：`npm run perf:city`

固定 5 个机位（十字街、解放桥、中山路口、乐群小学周边、南区主干路口），桌面和手机两档，全程无头（macOS 走 Metal，不弹窗）。

```bash
npm run build
npm run perf:city                                   # 两档全跑，产物在 captures/perf-city/
npm run perf:city -- --profile mobile               # 只跑手机档
npm run perf:city -- --compare 旧的/perf-city.json   # 附前后对比表
npm run perf:city -- --runs 3                       # 每个机位跑 3 轮，表里取中位数
npm run perf:city -- --hot                          # 附「谁最耗主线程 / 谁分配最多」两张表
```

| 环境变量 | 作用 | 默认 |
|---|---|---|
| `PERF_SPOTS` | 逗号分隔的机位 id | 全部 |
| `PERF_MS` / `PERF_SETTLE` | 采样时长 / 采样前静置 | 10000 / 15000 |
| `PERF_OUT` | 输出目录 | `captures/perf-city` |
| `PERF_DIST` | 要测的构建目录 | `dist` |
| `PERF_WORLD` | 路网覆盖目录（`<目录>/world/roads/<cell>.json.gz`），有就替换构建里的同名 cell | 无 |
| `PERF_RUNS` | 同 `--runs` | 1 |
| `PERF_SWIFTSHADER=1` | 没有 GPU 的机器用软件渲染 | 关 |

产物：`perf-city.json`、`perf-city.md`、每档每机位一张截图。指标：FPS、帧耗时均值/P95/最大、主线程 ms/帧、脚本 ms/帧、draw call、三角形、画面内车辆和行人数、分配 MB/s、GC 次数、车流步进 P95。

注意：

- 手机档是桌面机 CPU 4 倍降速的模拟，只用于前后对比，不等于真机。
- 单轮波动约 ±15%（手机档更大）。做前后对比用 `--runs 3` 以上，并且新旧构建交替跑，不要先跑完一边再跑另一边。
- `--hot` 会开 CPU 和堆采样，FPS 偏低，只看热点表，不拿它的 FPS 做前后对比；只跑单轮，不能和 `--runs` 同用。热点占比按主线程忙碌时间算（不含空闲），表头另给整页 `document.querySelector` 每帧次数。每个机位另存一份 `<档>-<机位>.cpuprofile`，可拖进 Chrome DevTools 的 Performance 面板。要看到可读的函数名，用不压缩的构建：`npx vite build web --config web/vite.config.ts --minify false --outDir <目录>`，再 `PERF_DIST=<目录>`。
- 表里「车」「人」为 0 且出现「交通为空」提示，说明路网 cell 的车道没有 `street` 字段（旧世界数据），量到的是空城。用 `PERF_WORLD` 指向带新路网的目录重采。

# 每帧热路径守则

`--hot` 实测出来的三类坑，写新代码时照下面做，`npm run verify:hot-paths` 有对应单测。

| 不要 | 改用 | 原因 |
|---|---|---|
| 每帧 `scene.getObjectByName(名字)` 等一个可能还没加载的对象 | `namedChild(scene, 名字)`（`web/src/scene-named.ts`），每帧调返回的函数 | `getObjectByName` 找不到时会把整个场景走一遍；全城曾因此占掉主线程三分之一 |
| 每帧自己 `document.querySelector` 判断有没有弹层 | `isModalOrOverlayOpen()`（`web/src/walk/input-guard.ts`） | 它只在页面元素或相关属性变过之后才重新扫描，同一帧多处调用只扫一次，结果没有滞后 |
| 连续写多个关节的 `rotation.x/y/z` | 先 `rig.batch(true)`，写完 `rig.batch(false)` | 每写一次都会整身重算骨骼；`batch` 期间只记数值，放开时算一次 |

`namedChild` 只看直接子节点：对象必须是 `scene.add(对象)` 直接挂上去的。挂深了它永远返回空；`vite dev` 下控制台会提示「exists but is not a direct child」。

弹层判定新增选择器时只改 `input-guard.ts` 里的选择器常量，监听的属性会自动跟上。选择器只能用标签、class、id、属性和 `:not(...)`；不能用 `:checked`、`:popover-open`、`:focus-within`、`:has(...)` 这类状态伪类——它们变化时页面不产生变更记录，缓存会一直给旧结果（单测会拦）。只换文字的更新（HUD 读数、计时）和重复写同一个值（每帧 `el.hidden = true`）不会触发重扫。

`rig.batch(true)` 和 `rig.batch(false)` 之间不要写 `continue` / `return` / `throw`，否则这个角色的骨骼会停在上一帧（`rider-pool.ts` 的两处有单测拦）。

# 街景微设施：井盖与隔离桩（IDOK-399 阶段 5）

机动车道上散布井盖和路缘雨水篦子；有信号灯的路口，灯杆两侧的人行道边上立一排矮隔离桩。井盖全城一个网格、隔离桩全城一个实例化网格，各 1 个 draw call。

| 文件 | 管什么 |
|---|---|
| `web/src/traffic/manhole-layout.ts` | 纯计算，不依赖 three.js：从路网算井盖和篦子的位置、种类、转角，写每个盖子的四边形顶点和 uv |
| `web/src/traffic/manhole-covers.ts` | 把盖子铺到路面上（一个网格、一张 1×3 图集）：核对街面、篦子挪到路缘、避开泊位、分帧读路面高度 |
| `web/src/traffic/bollard-layout.ts` | 纯计算，不依赖 three.js：每根灯杆两侧的桩位，以及跨灯杆的去重 |
| `web/src/traffic/bollards.ts` | 跟着信号灯头取桩位，立到地面上（一个 `InstancedMesh`），并给玩家做碰撞体 |
| `web/src/traffic/drawn-ground.ts` | 「画出来的地面」高度：街面瓦片的地面网格 + 街面层（人行道、路面），不打射线、不遍历场景，给隔离桩定桩底 |
| `web/src/traffic/street-furniture-audit.ts` | 只在 `?verify` 下按需加载：往下打射线，量盖子、桩底离画出来的地面多高，盖子下面是不是标线 |
| `web/src/traffic/index.ts` | 换路网 cell 时交路网给井盖；泊位变化时让井盖重查；每帧把灯头交给隔离桩并调两者的 `update` |

## 规则

- **数据**：只读 `roads/<cell>.json.gz` 的路网（节点、车道、信号）和运行时已经摆好的信号灯杆（`signal-heads.ts` 的 `placed`），不改世界数据，不动 pipeline。世界数据里没有地下管网，所以位置是「看着合理」的散布，不是测绘结果；全部来自车道 id 的整数哈希（`manholeHash`，murmur3 收尾函数，只用整数运算），同一份路网在任何机器上、车道按任何顺序给，结果都一样。
- **井盖：哪些车道**：只有机动车道（`kind === 'motor'`），不含高架、桥、隧道（`gradeSeparated`），起止节点都在、长度不小于 6 m。
- **井盖：沿车道**：圆井盖和方井盖平均每 `MANHOLE_SPACING` = 45 m 一个（15% 是方的，其余圆的；圆的绕中心随机转一个角度，只有圆的画出来是转的）；篦子种子平均每 `MANHOLE_GRATE_SPACING` = 30 m 一个，落在车道中心线上。个数按「长度 ÷ 间距 + 哈希」取整，所以比间距还短的车道平均数也对；每个落在自己那一段的中间 70% 里。
- **井盖：横向**：落在一侧轮迹上，离车道中心 `MANHOLE_TRACK_OFFSET` = 1 m（中心留给限速数字和箭头，两边留给车道线）。车道窄时轮迹收到离车道边 0.5 m 以内（`EDGE_KEEP`），不足 0.2 m（`TRACK_MIN`）就放中心。车道没写 `width` 按 3 m 算。
- **井盖：避开标线**（`LINE_KEEP` = 0.75 m）：同一对节点上的其他车道（不论机动车、非机动车）和本车道中心的中点算一条线；双向路（同一对节点上有反向车道）的图边本身也算一条线（中心线）。哈希挑中的那侧轮迹离任何一条线不足 0.75 m，盖子改放车道中心。于是：
  - 标准双向路（两条 `offset` 1.5、方向相反）：靠中心线那侧的盖子回到车道中心，靠路缘那侧的不动；
  - 窄街两个方向共用一条车道（`offset` −1.2 / +1.2，宽 4.1 m）：离图边只有 0.2 m 的那侧轮迹不用，改放车道中心；
  - 单行道（`offset` 0、没有反向车道）：两侧轮迹都能用；
  - 同向多车道：两车道之间的分道线两侧 0.75 m 内没有盖子。
- **井盖：避让**：
  - 路口端 `MANHOLE_JUNCTION_CLEAR` = 10 m 内（沿车道量）不放。路口指有信号的节点，或连着 3 个以上不同邻点的节点；只连 2 个的是同一条路的折点，不避。
  - 任何信号节点直线 `MANHOLE_SIGNAL_CLEAR` = 18 m 内不放（停止线和斑马线在那一带）。
  - 任意两个盖子相距不小于 `MANHOLE_MIN_GAP` = 3 m：先井盖后篦子，同类按 key 排序留前一个，所以结果与输入顺序无关。两个已加载 cell 的并集也按这条再筛一遍（`spacedManholes`）。
- **井盖：key**：`x,z` 取到 0.1 m 再接 `#种类`（0 圆、1 篦子、2 方），同一份路网下稳定；结果按 key 排序。
- **井盖：尺寸与贴图**：`MANHOLE_SIZE` 圆 0.8×0.8 m（含混凝土座圈，盖板 0.7 m）、篦子 0.45×0.75 m（横×顺）、方 0.6×0.6 m。一张 1×3 的灰度图集（每格 256 px），篦子只取格子中间 0.6 宽（`MANHOLE_UV_ACROSS`），不拉伸也没有透明边。材质 Lambert、`alphaTest` 0.5、`polygonOffset`，不投影。
- **井盖：运行时核对**（每个盖子一次）：
  - 中心和四角都要在机动车路面上（`surfaceAt` 含 0、不含 5 护栏），否则作废（探针 `dead`），不再看。
  - 篦子从种子往车道右侧 0.75–4.25 m、每 0.25 m 找路缘（第一处不是路面/护栏、再往外 0.6 m 也不是的点），再二分 3 次逼近路缘线，篦子中心放在路缘线内 0.3 m。只挪一次（之后泊位重查也不再挪）；4.25 m 内找不到路缘（内侧车道、广场）就作废。
  - 落在泊位线上的（`bays.blocks`，留 0.45 m 边距）不画；泊位变化时 `recheck()` 全部重查，已画的也会撤掉。
- **隔离桩：位置**：每根灯杆沿同一条路缘往两边各至多 2 根（`PER_SIDE`），间距 `BOLLARD_SPACING` = 1.5 m，桩中心在路缘线内 `BOLLARD_INSET` = 0.4 m。每根各自重新找路缘，一个方向上遇到下面任一情况，这一侧就到此为止（行不会绕过转角、跨过缺口或伸进绿化带）：
  - 路缘位置和灯杆处相差超过 0.75 m（`KERB_DRIFT`：转角、港湾、出入口），或找不到路缘、车道中心不在路面上；
  - 桩位的 `surfaceAt` 含 0（车行道）、5（护栏）或 4（绿化带）。空数组（街面瓦片没覆盖的地面，大多数路缘外就是这样）可以立；
  - 离节点不到 2 m（`BACK_MIN`，路口喇叭口里），或离进口远端不到 0.5 m（`REACH_MARGIN`）。
  - 离自己的灯杆不到 `BOLLARD_POLE_CLEARANCE` = 1.2 m 的那一根跳过，后面的照立（只在折线进口上会出现）。
- **隔离桩：跨灯杆去重**：所有已算出的桩按 key（`<进口 key>#<带符号序号>`，如 `12>34#-2`）排序，离已留下的桩中心不到 `BOLLARD_CLASH` = `BOLLARD_MIN_GAP` 1.2 m + 2 × 桩半径 0.07 m = 1.34 m 的去掉，离任何一根灯杆不到 1.2 m 的去掉；key 小的留下，结果与进口加载顺序无关。单根灯杆自己的行（1.5 m）不会被这条筛掉。
- **隔离桩：形状**：高 `BOLLARD_HEIGHT` = 0.75 m、半径 `BOLLARD_RADIUS` = 0.07 m，深灰杆身、底部套筒、黄色反光带（与道路黄线同色 `0xe7b62e`）、半球顶，顶点色一个材质。杆身和套筒向下延伸 `BURIED` = 0.3 m。
- **隔离桩：碰撞**：每根一个比桩略宽（半宽 0.09 m）的碰撞体，从桩底和碰撞面里较低的那个起，到较高的那个往上 0.75 m 止（桩底就在碰撞面上时就是 0.75 m 高）：桩沉到画面地面后，站在碰撞面上的玩家碰到的桩照样有 0.75 m 高。经 `traffic/index.ts` 的 `near` 挡步行和开车的玩家；隐藏时不挡。
- 改规则只动 `manhole-layout.ts`、`manhole-covers.ts`、`bollard-layout.ts`、`bollards.ts` 顶部的常量。

## 高度与沉降

- **井盖**：读四角的路面高度（`groundAt(x, z, y, true)`，车辆碰撞面），四个角各按自己的读数铺，再抬高 1.1 cm（比泊位线的 1.2 cm 低一点：漆可以压在盖子上，不能被盖子压住）。四角高度不在一个平面上（对角和之差 > 5 cm：盖子底下有路缘或台阶）不画。
- **隔离桩：碰撞面**：先取 `groundAt(x, z, y, false)`（步行碰撞面）和 `groundAt(x, z, y, true)`（车辆碰撞面）里较低的那个——两者相差不到 0.6 m 时；差得更多（下面是坑、地道）或车辆面没有，就用步行面。步行面没加载时 1.5 秒后再读。离路网高度超过 0.6 m 的照下面的沉降策略退避。
- **隔离桩：桩底 = 画出来的地面**（`drawn-ground.ts`）：桩位处画出来的最高表面，只看两样——
  - 街面瓦片的地面网格（`world.ts` `detail` 里的 `groundMesh`：瓦片 group 的第一个子节点，无名 `Mesh`，256×256 的 `PlaneGeometry`，带贴图的 `MeshStandardMaterial`，group 直接挂在场景下、位置 `(tile.x, 0, tile.z)`）。按规则网格直接插值（与 `walk/physics.ts` 同一算法）；隧道/地下通道挖掉过三角形、或站台坡道改写过三角形（`platform-access.ts`）的瓦片，按索引缓冲建一次「格 → 三角形」表（`lookups`），查表找到该格；该格被挖掉或改写就算没读到。
  - 街面层（`batch.ts` 用 `streetSurfaceMat` 的合并网格：人行道、路面、标线，比地面网格高 0.045–0.195 m，人行道板约高 0.3 m）。**每个区块（`Bucket`）一张，场景里同时有好几张**，走远了还会再加：全部都读，哪张里都找不到这块瓦片时隔 2 秒重扫一次场景。按 `userData.tileSlices()` 找到这块瓦片的三角形，第一次用时分 8 m 一格装桶。
  - 只取离碰撞面 0.6 m 内的表面（`DRAWN_REACH`，与桩接受的高差带 `HEIGHT_BAND` 一致；更高的是桥面边之类别的东西）。读不到（瓦片没到、桶没装完超过 5 秒、该格被挖、桥面/地标模型这类不读的东西）就站碰撞面，和以前一样。
  - 画面读数缓存在每根桩上：碰撞面读数变了（> 4 mm）或距上次读已满 30 秒，才在下一次常规复读时重读；定住的桩每 8 秒复读碰撞面时不重读画面。画面读数改变桩底也让计数从头开始。
- **共同的沉降策略**（同泊位线）：远处地块的碰撞体比地形晚到，第一次读数不可信。每个隔 1 秒再读，连续 3 次读数一致（差 < 4 mm）才算定住（探针 `settled`）；定住后每 8 秒再读一次，地块重载或晚到的碰撞体也能改正，读数一变计数从头开始。读数离路网高度超过 0.6 m（上面有桥、下面有坑）：连读 6 次都这样就退到每 30 秒读一次——没画过的记 `none` 先不画，已经画出的留在原高度不动；读数回到范围内就恢复正常节奏。

## 性能

- 各 1 个 draw call：井盖一个 `Mesh`（缓冲按 2 的幂分配，至少 64 个），隔离桩一个 `InstancedMesh`（上限 1024 根）；都不做视锥剔除、不投影。
- 井盖只铺玩家 90 m 内的，每帧最多看 3 个（12 次高度查询），最多扫过 256 个找到期的；街面瓦片没到的 1.5 秒后再看。
- 隔离桩每帧最多为 1 根灯杆算桩位（几十次街面查询），只算玩家 420 m 内的灯杆；瓦片没到返回 `pending`，整根灯杆 1.5 秒后重算，从不半截交付；算出的桩位整局记住，换 cell 不重算。只立玩家 140 m 内的桩，每帧最多 4 根（8 次高度查询），最多扫过 256 根；另外每帧最多 1 次画面地面读数（`DRAWN_PER_FRAME`），轮不到的桩排队到下一帧。一次读数：地面网格是几次数组读（挖过、改写过的瓦片多一次查表），街面是桶里几十个三角形；某块瓦片第一次读时顺带装 2048 个三角形进桶（`BUCKET_PER_CALL`，且每次最多写 8192 次桶 `BUCKET_WRITES_PER_CALL`，没装完就返回「还不知道」，下一帧接着装），估计桌面约 0.1 ms、手机 4 倍降速下约 0.4 ms（按每个三角形几十 ns 估算，未在真浏览器里测）。场景只看直接子节点，而且只在某点找不到瓦片时、最多每 2 秒看一次。
- 上传：平时只上传改了的那个盖子的顶点；换 cell（全部盖子在缓冲里重排）或一次攒了 64 段以上时整个缓冲上传一次；整缓冲首次上传前不加分段（同泊位线）。隔离桩改了实例矩阵就整段上传（几百根，量很小）。
- 路网 cell 换了，井盖保留刚离开的那一格（共 2 格，`CELLS_KEPT`），已铺好的盖子保留高度不重读。街面交通关掉时两者随信号灯一起隐藏。

## 验证

- `npm run verify:street-furniture`：单测（`scripts/test-manholes.mjs`、`scripts/test-bollards.mjs`）。
  - 井盖：哈希确定、均匀、各 salt 独立；每车道个数与间距、方盖占比、两侧轮迹各半、短车道平均数；车道宽度缺省与轮迹收窄；标准双向路、窄街共用道、单行道、同向多车道、非机动车道的 `LINE_KEEP`；路口 10 m、信号 18 m、折点不避；任意两盖 ≥ 3 m；车道/节点顺序打乱结果不变、key 稳定且有序；`spacedManholes` 跨 cell 去重；四边形尺寸、转角、朝上、uv 在各自图集格内。运行时：首帧 3 个盖子 12 次采样、每帧扫描上限 256、90 m 半径、3 次一致才定住、8 秒复读、高度变了重写；瓦片未到、台阶、桥下、平坡；篦子挪到路缘且只挪一次、找不到路缘作废；泊位挡住不画、重查后补上或撤掉；`drawRange` 与缓冲里的盖子一致；整缓冲首次上传前没有分段、画出来的顶点与上传到显卡的一致（模拟 three.js 的上传）；保留 2 个 cell、隐藏与显示。
  - 隔离桩：每侧至多 2 根、位置与间距、离灯杆 ≥ 1.2 m；`BACK_MIN` 与进口末端；瓦片未到返回 `pending`；不立在 0/5/4 上、空数组可立、行在第一处不可立处结束；路缘漂移 > 0.75 m 结束、小漂移跟随；挤到自己灯杆的跳过；高度跟进口剖面、折线分段结果一致；`separateBollards` 小 key 优先、离灯杆近的去掉、跨网格格子与零点、顺序无关。运行时：每帧 1 根灯杆、4 根桩 8 次采样、`mesh.count` 与实例矩阵一致；碰撞面取两种地面里较低的；几何向下延伸 0.3 m（杆身和套筒）；3 次一致定住、8 秒复读；瓦片未到 / 420 m / 140 m；桩位整局记住、灯杆没了桩也撤；两根灯杆抢同一段路缘；碰撞体与隐藏。画面地面：有读数时桩底取它（低于或略高于碰撞面）、没有 / 差 > 0.6 m 时用碰撞面且不跳动、「还不知道」时先站碰撞面再下沉一次、5 秒还不知道就等 30 秒复查；每帧最多 1 次读数、碰撞面采样仍 ≤ 8；定住后不重读、碰撞面变了或满 30 秒才重读；桥面退避时不读；碰撞体顶不低于碰撞面 + 0.75 m。`drawnGround` 本身：与向下射线逐点一致（32/64 段）、不认名字不对/形状不对的网格、瓦片卸了不再读；挖过洞的地面网格在剩下的地方照读、洞里返回 `null`；街面层盖在地面上读出、每次读数装一批桶、合并缓冲里按本瓦片偏移读、多张街面层都读且后加入的能找到、够不着的表面不算。
- `npm run verify:street-furniture:city`（即 `scripts/verify-street-furniture.mjs`）：无头真浏览器，先 `npm run build`（或设 `PERF_DIST`）。4 个点位（中山路-解放西路口、南区主干路口两处有隔离桩；东岸支路、东南居民街两处只看井盖）× 桌面/手机两档（`--profile desktop|mobile|both`），核对：两者 60 秒内定住、90 m 内有盖子（信号路口有桩）、作废的盖子不超过 60%、key 不重复、盖子间距 ≥ 3 m 且都在机动车路面上、盖面比画出来的路面高 2–30 mm（超出范围或下面没打到东西的采样不超过 10%）、没有埋进路面的盖子、压在标线上的盖子不超过 12%、桩间距 ≥ 1.2 m 且不在车行道/护栏/绿化带上、桩底离画出来的地面在 −6 cm 到 +6 cm 之间（失败信息带下面网格的名字；高于 2 cm 的只报告不判失败）、桩撞进别的东西的不超过 10%、两组网格每帧各最多画 1 次、没有页面错误。`FURNITURE_SPOTS=zhongshan,east` 只跑指定点位；`--shots <目录>`（或 `VERIFY_OUT`）另存截图和机位。
- 浏览器探针（`?verify`）：
  - `viewer.trafficProbe.manholeCovers()` → `{total, drawn, settled, waiting, none, dead, visible, drawCalls, samples, covers: [{key, x, y, z, headingX, headingZ, kind, spin, state, settled, heights}]}`。篦子的 `x, z` 是挪到路缘后的位置；`samples` 是开局以来查过的路面高度次数；`heights` 是已画盖子的四角读数（后左、后右、前右、前左），没画的为 `null`。
  - `viewer.trafficProbe.bollards()` → `{total, drawn, settled, waiting, none, pending, visible, drawCalls, onDrawn, posts: [{key, x, y, z, yaw, state, settled, support}]}`。`pending` 是还没算出桩位的灯杆数；已立的桩 `y` 是实际桩底高度（画面地面或碰撞面），其余是路网高度；`support` 是桩下的碰撞面高度（没立的为 `null`）；`onDrawn` 是桩底取了画面地面（与碰撞面不同）的桩数。
  - `await viewer.trafficProbe.streetFurnitureAudit({x, z}, 半径)`（半径默认 100 m）→ `{covers: [{key, kind, gaps, paint, under}], posts: [{key, gap, under, touching}]}`。`gaps` 是盖子中心和四个近边缘点处盖面减去 1 m 内画出来的最高表面（`null` 是没打到东西），`paint` 是各点下面是不是烘进街面瓦片的标线，`under` 是下面网格的名字；`gap` 是桩底减去它下面画出来的最高表面，`under` 是那个表面所属网格的名字（瓦片地面网格无名，显示为 `Group`/`Mesh`），`touching` 是桩身高度范围内 0.35 m 内碰到的网格名（栏杆、杆子）。
  - `await viewer.trafficProbe.streetFurnitureDraws(帧数)` → `{covers: {frames, draws, mostPerFrame}, posts: {frames, draws, mostPerFrame}}`，在渲染器里数这么多帧内两组网格各实际画了几次。
  - `viewer.trafficProbe.streetFurnitureShown(false / true)` 临时隐藏 / 恢复两组网格的材质，拍对照图用。

## 已知限制

- 路网只载玩家所在的 512 m 格（井盖另外记住刚离开的一格，共 2 格），跨格时前方的盖子和桩会陆续出现。
- 地标路口（`LANDMARK_SIGNAL_GROUPS`，如十字街）的龙门架在地标模型里，没有运行时灯杆，所以也没有隔离桩。
- 桩底跟画出来的地面（瓦片地面网格、街面层），玩家脚下跟的仍是碰撞面：路缘外地面网格比碰撞面粗的地方，桩看着比玩家站的地方低几到二十几厘米（碰撞体顶照旧按碰撞面 + 0.75 m）。画面地面靠认网格的「长相」（无名 group 的第一个子节点、256×256 `PlaneGeometry`、带贴图材质；街面层认材质 `streetSurfaceMat`），`world.ts` / `batch.ts` 改了这些，读数会退回碰撞面（不会画错，只是回到旧的「略高」）。桥面、隧道口边缘网格（`tunnel.fringe`）、地标模型、站台改过的地面网格（`refinePlatformTerrain` 换了顶点）不读，这些地方的桩照旧站碰撞面，可能略高 6–25 cm；杆体下埋 0.3 m，不会露缝。
- 绿化带和护栏后面的路缘不立桩。禁车区入口桩、路名牌不在本阶段；公交站牌见下节。
- 井盖只按路网摆，不知道烘进街面瓦片的标线（斑马线、停止线、箭头）；`LINE_KEEP` 和 18 m 信号避让挡掉了大部分，剩下的由 `verify:street-furniture:city` 统计压线比例。

# 公交站牌与候车亭（IDOK-399 阶段 5b）

代码在 `web/src/traffic/bus-stop-layout.ts`（纯函数：解析、空间索引、选站、几何尺寸、碰撞体、站名排版、图集 LRU）和 `web/src/traffic/bus-stops.ts`（运行时：落地、合并网格、站名画布、探针），由 `traffic/index.ts` 接入。旧的 worker 方块站牌（`street-worker.ts` 里 `stops` 那一行）已删，`stops` 解构保留。

## 数据

- `public/street-furniture/bus-stops.json`，`version: 1`，每行 `[x, z, yaw, shelter, side, name, en]`：站牌杆位置（路缘后 0.6 m）、朝向（`n` = 指向车行道的法向）、有无候车亭、候车亭在杆的哪侧（亭心在杆沿 `t` 的 `side × 2.6 m` 处，`-1` 为 `−t`，其余为 `+t`）、中文名、英文名（可空）。
- 由 `pipeline/bus_stops.py` 从 OSM 快照加 `public/world` 生成；**世界重烘后要重跑**：`uv run --locked python pipeline/bus_stops.py --world public/world --osm <快照> --out public/street-furniture/bus-stops.json`。文件里的 `world` 字段记的是生成时的世界指纹。现有 219 站、183 个有站名、58 个带候车亭。
- 候车亭只在放得下的站立：不压车行道、不进建筑、离路灯和信号灯杆 ≥ 0.4 m、离行道树树心 ≥ 0.6 m（读各块的 `.trees`，亭不压树池）、不压世界块里已有的街边摆设（`decor`：护栏和绿篱两侧各 0.6 m、指路牌杆 0.8 m、警示柱 0.4 m；`beds` 花坛 0.7 m）；一侧放不下换另一侧，两侧都不行只立站牌。共享电动车（`decor` kind 3）不算占位，由运行时让开（见下条）。
- 电动车让亭（IDOK-399 5c）：`web/src/traffic/bus-shelter-clearance.ts` 自己读同一份 json，把每个候车亭的平面轮廓四周外扩 0.9 m 作为禁停区；一排三辆（同一 `decor` 项）里只要有一辆车心落在区内，整排不画（`batch.ts` 渲染选取）、`nearestBike` 不给、`takeBike` 拒绝，不留贴着站杆的孤车。同排靠 `parked` 数组相邻项判定（同朝向、车心相距 1.25 m 的倍数），不靠下标取模，因为个别区块先按坐标删过车。不删 `parked` 数组项，车的 id（区块:下标）不变；结果只取决于 json 与车的坐标，各客户端一致。数据到达前车照常画，到达后刷新一次。电动车没有碰撞体、不上小地图、不联机同步，所以这三处就是全部消费方。
- 十字街地标范围（`SHIZIJIE_DECOR_EXCLUSION_POLY`）内的站运行时不画（地标模型自带街景），探针里计入 `excluded`。

## 规则

- 首次需要时 `fetch('./street-furniture/bus-stops.json')`；失败（含 15 秒没回应）10 秒后重试，连首次共 5 次，最后一次失败只 `warn` 一次；载入前什么都不画。
- 按 64 m 网格建索引；每 0.5 秒（或焦点移动 8 m）选一次：170 m 内最近的至多 24 个站，已画的站 190 m 外才回收（距离相同按 id）。
- 站牌：深灰八棱杆（半径 0.045、高 2.75），旗式双面牌 0.62 × 0.86 × 0.04，底边 1.85 m，沿 `−n` 伸向人行道一侧、两面朝 `±t`。牌面：上 28% 蓝 `#1f5aa6` 白色公交图标 + “公交站”；中部白底深灰站名（每行 7 字，长名缩字或分两行，括号里的另起一小行，再长截断加 “…”），下面浅灰英文名；下 10% 橙 `#e7a12e`；0.02 m 深灰边框。无名站只画图标。
- 候车亭（`shelter = 1`）：长 4.2 m、进深 1.5 m、檐口 2.45 m；立柱后 0.09 / 前 0.06（`#3c4248`）；单坡顶 4°、厚 0.07、前后各挑 0.25，顶面 `#d9dde0` 带深色收边；车道侧 0.22 m 蓝色檐板写白色站名；后墙灯箱板 0.5–1.9 m（`#e9edf0`，深色框，淡三分格）；木色长凳（`#a9794a`，3 条板，长 2.6、座高 0.44、深 0.38）；靠站牌一端敞开，远端有端板。
- 贴图：一张 1024² 画布（`CanvasTexture`，SRGB、各向异性 4、mipmap），32 格站名（牌面格 + 檐板格）走 LRU，显示中的站钉住；共用的牌头、图标、色块另占格子。每帧最多画 1 个名字（最近的先画），纹理最多每 0.5 秒上传一次；牌面在画布上传的那一帧才切到站名格，之前显示图标面（复用的格子不会闪出上一站的名字）。字体 `600 px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`。
- 防 z-fighting：牌面和檐板字面离底面 2 mm，字面材质另加 `polygonOffset`。

## 高度与碰撞

- 杆底：画面地面（`drawnGround`）与碰撞面差 ≤ 0.6 m 时取画面地面，否则取步行碰撞面（与立柱一致；车行面在人行道板下面 0.3 m，不用）；下埋 0.3 m。
- 候车亭：读四只脚（后近、后远、前远、前近），底座取四脚最高；每根立柱各自伸到自己脚下地面再埋 0.3 m，凳腿伸到最低脚下 0.3 m。四脚高差 > 0.45 m（台阶、坡坎）不立亭，只立站牌（`shelterState: 'skipped'`）。
- 沉降与复查同隔离桩：3 次一致定住；未定 1 秒复读、定住 8 秒复读、瓦片未到 1.5 秒后再看；定住后超出 0.6 m 的跳变不采信（杆和每只柱脚都是；杆连续 6 次后改成每 30 秒复读）。每帧最多落 2 个站（补读画面地面引起的重写也算在内）、2 次画面地面读数，等读数的站轮流读。
- 碰撞体（接入 `near()`）：杆、后墙板、远端两根立柱、长凳、端板；车道侧前沿敞开，玩家能走进亭下。

## 性能

- 新增 2 个 draw call（上限 3）：几何一个合并 `Mesh`（`G2 bus stops`，24 个槽位，顶点色 Lambert），字面一个（`G2 bus stop names`，贴图 Lambert）；都不做视锥剔除、不投影。
- 平时每帧只遍历 24 个槽位；选站每 0.5 秒扫 ≤ 49 个索引格；落站帧 ≤ 12 次碰撞面查询 + ≤ 2 次画面地面读数 + ≤ 2 个槽位顶点重写（分段上传，超过 64 段改为整块上传一次）。不做每帧分配（选站每 0.5 秒、复读每 8 秒各有几个小对象）。

## 验证

- `npm run verify:bus-stops`（`scripts/test-bus-stops.mjs`）：解析与坐标系、真数据全部能排版、索引与暴力一致、选站滞回与 24 上限、两侧候车亭几何、碰撞体（前沿敞开）、底座与高差、站名排版、图集 LRU；运行时：载入前不画、重试节奏与次数、每帧预算、四脚最高且立柱各到各的地面、画面地面 vs 碰撞面、台阶不立亭、三角形绕序与牌面朝向、碰撞、170/190 回收、沉降与跳变读数；电动车让亭（5c）：亭区几何与余量、网格索引与暴力一致、真数据 58 亭、注册表载入/重试/失败/复位、同排整组判定（组内只有一辆落区也整排不摆）。`npm run check:batcher` 另核对 `nearestBike` / `takeBike` / 停车网格三处一致和整排清除。
- `npm run verify:bus-stops:city`（`scripts/verify-bus-stops.mjs`，先 `npm run build`）：七星公园 `qixing`（只有站牌）、南门桥南 `nanmenqiao`、三里店广场 `sanlidian`（两亭）、彭家岭 `pengjialing`（两亭）、新建路口 `xinjian`（一亭一牌）、象山公园 `xiangshan`（两亭，5b 时被电动车占位）、花园村 `huayuancun`（两亭，同上）7 个点位 × 桌面/手机，核对 json 已载、170 m 内应画的站全部画出并定住、候车亭外轮廓与四角不在车行道（kind 0/5）上、不在建筑里（读不到建筑轮廓时报告「未查」）、立柱脚离画出来的地面 −0.35…+0.03 m、杆底 ±6 cm、每帧 ≤ 3 次绘制、没有页面错误；亭区数据就绪后，30 m 内停放车在亭区（含 0.9 m 余量）里的整排既不画出、`nearestBike` 选不到、`takeBike` 也取不走；存前后对照图和 3 m 近景。`BUS_STOP_SPOTS=qixing,sanlidian` 只跑指定点位，`--shots <目录>` 存图和 `verify-bus-stops.json`。
- 浏览器探针（`?verify`）：
  - `viewer.trafficProbe.busStops()` → `{load, attempts, total, excluded, shown, drawn, settled, visible, drawCalls, meshes, atlas, focus, stops: [{key, slot, x, z, yaw, side, shelter, shelterState, name, state, y, support, settled, spread, cell, named, corners, outline}]}`。
  - `viewer.trafficProbe.busStopsShown(false / true)` 临时隐藏 / 恢复，拍对照图用。
  - `await viewer.trafficProbe.busStopDraws(帧数)` → `{parts, faces}`，两组网格各实际画了几次。
  - `await viewer.trafficProbe.busStopAudit({x, z}, 半径)`（默认 170 m）→ 每站 `{key, pole: {gap, under}, feet: [{gap, ground, under}]}`。

## 已知限制

- 没有线路信息，牌面只有站名；候车亭没有玻璃，也没有夜间灯箱发光；不投影。
- 只画最近 24 个站；十字街地标范围内不画；json 拿不到（5 次都失败）就没有站牌。
- 站名画布 1024² 整张上传，已节流到每 0.5 秒一次，手机上首次进入密集站区可能有一次小卡顿。
- 数据跟世界指纹走：世界重烘后不重跑 `pipeline/bus_stops.py`，站点可能偏离人行道、候车亭可能撞上新种的行道树。
- 候车亭 58 个（5b 时 26 个）：电动车改由运行时让开后，剩下挡亭的是行道树、花坛、指路牌和护栏。
