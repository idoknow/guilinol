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
