# 第二期计划：桂林街头（2026-11-21 Rock 确认，IDOK-106）

第一期（`docs/plan.md`）做的是“风景观光向”的山水城市。Rock 11-21 的评价是“太偏游览，像原神桂林版”，第二期改成 **GTA 这一类的开放城市沙盒**，城市是主角，山水是天际线和地标背景。玩法是这个类型，但名字、界面、字体、音乐、剧情全部原创，不照搬任何现成游戏。

## 已定（Rock 11-21）

1. **暴力尺度 A**：没有武器，不能伤人。车撞到行人，行人会躲开或者摔倒后爬起来，不流血，没有死亡。追捕只有交警追车。
2. **观光降为副玩法**：现有 `spots` 观景点改成地图上可收集的“拍照点”，景册保留，主界面不再以游览为主模式。
3. **保留低多边形建模**，改光照、调色和街面细节（见 `docs/style.md` 第二期一节）。
4. **校园全部保留**，校园复原（IDOK-80/82/84）照常进行。学校范围是“安静区”：任务点、出租目的地、追捕路线都不进去，车辆不能开进校门。
5. 第一期的世界、地标、地形、昼夜天气、反馈系统、账号全部保留。

## 核心循环

步行上街 → 骑电驴或开车 → 接活（外卖、出租、夜赛）→ 拿钱 → 换车、换装 → 闯红灯、逆行、撞车会被交警追 → 甩掉或被拦下罚款。

## 桂林特色放进玩法

| 特色 | 玩法 |
|---|---|
| 满街电驴 | 新手第一台车；路上车流里电驴占三到四成；钻巷子比汽车快 |
| 桂林米粉 | 第一条任务线“米粉外卖”：从粉店取单，限时送达，急刹和撞击会洒汤扣钱 |
| 夜城 | 正阳步行街、东西巷、中心广场一带霓虹招牌，两江四湖夜灯，雨后路面反光 |
| 景点 | 出租/网约车目的地：象鼻山、日月双塔、两江四湖码头、七星公园 |
| 滨江路和桥 | 环城夜赛：滨江路 → 解放桥 → 榕杉湖一圈 |
| 漓江 | 已有划船上加快艇（G5 之后再定） |

## 里程碑

| # | 内容 | 执行 | 验收 |
|---|---|---|---|
| G0 | 方向定稿：改 plan/style，出白天街头、夜晚霓虹湿路、HUD 三张样张 | sg claude | Rock 确认样张 |
| G1 | 开车：接手 PR #70（py 团队 M6：人物、电驴、单车、汽车、划船、F 键）并补完汽车 | sg codex（引擎）+ sg claude（镜头、车外观、HUD） | 王城开车到象鼻山；手机 p95 不比 main 差 |
| G2 | 城市活起来：OSM 车道路网、红绿灯、车流和电驴流、行人 | sg codex + sg claude（街面细节、霓虹） | 解放桥高峰车流；桌面 60 帧、手机 30 帧 |
| G3 | 任务和钱：任务框架、存档、米粉外卖、出租、夜赛 | sg codex（框架）+ sg claude（任务 UI、手机菜单） | 三条线都能完整跑一遍 |
| G4 | 追捕：违章判定、交警追车、甩掉 / 被拦下 | sg codex + sg claude（追捕 HUD、警灯） | 1 级到满级都能触发，也能甩掉 |
| G5 | 主界面改版（街头为主模式）、原创电台、性能收尾，上线 | 分着做 | 上线 glol.rcpd.cc |

G0 和 G1 并行。G2 起每个里程碑都是“codex 先交接口和占位实现，合并后 sg claude 在新分支上做外观”，两边不同时改同一块代码。

## 运行时接口（G1 起逐步落地，codex 实现，UI 只读这些）

### 游戏状态 `web/src/game/state.ts`

```ts
export interface GameState {
  mode: 'foot'|'ebike'|'bike'|'car'|'boat'|'fly'
  vehicle: {kind:string; id:string; speedKmh:number; gear?:'D'|'R'|'N'; damage:number /* 0..1 */} | null
  money: number                 // 元，整数
  wanted: 0|1|2|3|4|5           // G4 之前恒为 0
  mission: {id:string; title:string; step:string; target?:[number,number]; timer?:number} | null
  zone: {quiet:boolean; name?:string}   // quiet = 学校等安静区
}
export function getState(): Readonly<GameState>
export function onState(fn:(s:Readonly<GameState>, changed:Set<keyof GameState>)=>void): ()=>void
export function emit(event:GameEvent): void   // 'mission:start' | 'mission:done' | 'fine' | 'crash' | ...
```

- HUD、手机菜单、小地图只通过 `onState` 读状态，不直接引用引擎对象。
- codex 交付时附一个占位 HUD（`web/src/ui/hud-dev.ts`，纯文字），正式 HUD 由 sg claude 做。

### 车辆参数 `web/src/drive/vehicles.json`

每种车一项：`{kind, maxKmh, accel, brake, reverseKmh, steerRad, wheelbase, mass, lanes:'motor'|'nonmotor'|'any', seats}`。手感只改这里。

### 路网 `public/world/roads/graph.json.gz`（G2）

由 `pipeline/` 从 OSM 生成：`nodes[{id,x,z,y}]`、`lanes[{id,from,to,width,kind:'motor'|'nonmotor'|'bus',speedKmh,oneway}]`、`signals[{node,phases:[{lanes:[...],green:s,yellow:s}]}]`、`quiet[{name,polygon}]`。坐标沿用世界坐标（米）。

### 任务数据 `web/src/missions/*.json`（G3）

`{id, line:'noodle'|'taxi'|'race', title, giver:[x,z], steps:[{kind:'goto'|'pickup'|'deliver'|'checkpoint', at:[x,z], radius, timer?, text}], reward, failOn:['timeout','spill','wanted']}`。任务点不能落在 `quiet` 区域内（验收脚本检查）。

### 存档

`localStorage['glol.save.v1']`：`{money, owned:[kind], spotsFound:[id], missionsDone:[id], updatedAt}`。登录用户的云同步留到 G5。

## 不做

- 武器、打斗、伤害行人、血迹、死亡。
- 照搬任何现成游戏的名字、角色、界面、字体、电台音乐、地图样式。
- 真实品牌的车标、店招、共享单车配色。
- 在学校范围里放任务、出租目的地、追捕路线、可进入的车道。

## 性能底线（沿用第一期）

中端安卓手机稳定 30 帧，桌面 60 帧，首屏 2 秒内能动。每个里程碑交付都附 `npm run perf` 和 main 的对比，手机 p95 不能变差。
