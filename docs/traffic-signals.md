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

# 全城性能基线：`npm run perf:city`

固定 5 个机位（十字街、解放桥、中山路口、乐群小学周边、南区主干路口），桌面和手机两档，全程无头（macOS 走 Metal，不弹窗）。

```bash
npm run build
npm run perf:city                                   # 两档全跑，产物在 captures/perf-city/
npm run perf:city -- --profile mobile               # 只跑手机档
npm run perf:city -- --compare 旧的/perf-city.json   # 附前后对比表
```

| 环境变量 | 作用 | 默认 |
|---|---|---|
| `PERF_SPOTS` | 逗号分隔的机位 id | 全部 |
| `PERF_MS` / `PERF_SETTLE` | 采样时长 / 采样前静置 | 10000 / 15000 |
| `PERF_OUT` | 输出目录 | `captures/perf-city` |
| `PERF_DIST` | 要测的构建目录 | `dist` |
| `PERF_WORLD` | 路网覆盖目录（`<目录>/world/roads/<cell>.json.gz`），有就替换构建里的同名 cell | 无 |
| `PERF_SWIFTSHADER=1` | 没有 GPU 的机器用软件渲染 | 关 |

产物：`perf-city.json`、`perf-city.md`、每档每机位一张截图。指标：FPS、帧耗时均值/P95/最大、主线程 ms/帧、脚本 ms/帧、draw call、三角形、画面内车辆和行人数、分配 MB/s、GC 次数、车流步进 P95。

注意：

- 手机档是桌面机 CPU 4 倍降速的模拟，只用于前后对比，不等于真机。
- 表里「车」「人」为 0 且出现「交通为空」提示，说明路网 cell 的车道没有 `street` 字段（旧世界数据），量到的是空城。用 `PERF_WORLD` 指向带新路网的目录重采。
