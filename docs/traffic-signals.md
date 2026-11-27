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
