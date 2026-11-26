# 双组主线全量合入与「本地完全体」功能验收地图（`ol-full-merge-map`）

> - **生成时间**：2026-11-26（对应仓库基线与工作区现场实测）
> - **分叉基线（merge-base）**：`a3e7a630`
> - **对端主线（`origin/main`）**：`613fcb47`（较基线新增 **79 个非合并提交** / **90 个总提交**，时间覆盖 2026-11-24 ~ 2026-11-26）
> - **本组特性分支（`feat/xp-overnight` HEAD）**：`ebeb5912`（较基线差异 **164 个文件，+60,732 / -477 行**）
> - **工作区合并现场核实**：当前工作区已执行 `git merge --no-commit 613fcb47`（`MERGE_HEAD = 613fcb47`）；两边共同修改的重叠文件共 **26 个**，其中 **11 个触发真实 `UU` 合并冲突**、**15 个存在跨分支语义/资产耦合重叠**。
> - **本文件定位**：只读测绘与合入验收总图（不修改任何业务代码）；帮助合并执行者及验收人一眼验证「`origin/main` + `feat/xp-overnight` 本地完全体」全部功能，并精准拆解直合并撞车点。

---

## 一、`origin/main` 主线新增功能全览（`a3e7a630..origin/main` 全 79 个非合并提交归并）

> 共归并为 **25 项独立可验证功能**，覆盖 `a3e7a630..origin/main` 全量非合并提交。本地预览默认深链推荐示例：`http://127.0.0.1:5176/?mode=walk` 或 `http://127.0.0.1:5176/?verify&mode=walk`（注意：`?verify` / `localhost` 带深链参数可跳过官网首页与账号登录校验，直接进城；`deeplink.ts` 支持键值：`verify`、`spawn`、`view`、`mode`、`cam`、`feedback`、`play`、`slot`、`solo`）。

| 序号 | 模块与来源（提交/工单） | 入口（源码 / 路由 / UI） | 在本地完全体里怎么看到（URL 参数或按键） | 预期画面 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 首页推荐联机化与免登深链（`IDOK-392` / `080ef6c8`） | `web/src/ui/home.ts`<br>`web/src/entry.ts`<br>`web/src/deeplink.ts` | 无参数访问首页 `http://127.0.0.1:5176/`；或带深链参数 `?mode=walk`、`?mp=1`、`?solo`、`?slot=NE` 跳过首页直接进场（仅 `127.0.0.1` / `localhost` 深链可免登）。 | 无参数首页主卡置顶展示「**联机模式（推荐）**」，「单人模式」退居下位按钮，左下/角落保留抖音二维码卡与版本脚注；加 `?mode=walk` 直接绕过首页与登录弹窗进入 3D 桂林。 |
| 2 | 全城 512m 分片城市升级引擎与 96 店招牌/幕墙 R1–R3（`IDOK-408` / `IDOK-409`：`71b63405`, `8a93d5f5`） | `web/src/city-upgrade/state.ts`<br>`web/src/city-upgrade/props.ts`<br>`web/src/batch.ts`<br>`public/city-upgrade/` | **默认开启**；可在 URL 传 `?cityUpgrade=0` / `?cityUpgrade=1` 对照开关效果。进城漫步老城区及拓展至 325 区块范围查看沿街建筑。 | 老街建筑外立面出现高精度 P2 门头招牌图集（`shop-fascias.webp` + 夜亮自发光 `shop-fascias-emit.webp`）、竖招（`shop-blades.webp`）、空调外机与路名牌，同时 `batch.ts` 自动隐藏旧程序化遮阳棚与灰卷帘避免重影；切 `?cityUpgrade=0` 则退回基础程序化街铺。 |
| 3 | 分级后处理光影管线（AO / Bloom / 太阳阴影 / 丁达尔光柱）与运行时调档（`IDOK-331` / `IDOK-291`：`47ba2a89`, `ed82d6e4`, `229a3ad1`） | `web/src/look/gfx-state.ts`<br>`web/src/look/post.ts`<br>`web/src/ui/render-range.ts` | URL 传 `?gfx=low` / `?gfx=mid` / `?gfx=high`（加 `?verify` 锁定防自动降档）；或点击左上角「**视野**」按钮在面板底部切换「光影画质」低 / 中 / 高档（含 `localStorage['glol.gfx']` 持久化）。 | `high` 档启用 `N8AO` 环境光遮蔽、柔和太阳阴影与泛光；`godrays` 默认关闭至遮挡稳定；连续帧耗时 `> 25 ms` 累计超 `3 s` 时会自动降档并弹出底部 Toast 提示「画面有点卡，光影已降到中/低档」。 |
| 4 | 深度墙体遮挡剔除与密闭地标簇剔除（`IDOK-348` / `IDOK-330`：`fc59c0bd`, `a72c090c`, `7ca84216`, `c3fc3663`） | `web/src/wall-occlusion.ts`<br>`web/src/landmark-culling.ts`<br>`web/src/batch.ts` | 在高楼街巷步行贴墙绕行，结合 `F3`（或 `?verify`）打开右上/左下性能读数观察 draw calls 与 NPC 头顶气泡可见性。 | 墙体背面隐藏体块被视锥外大墙遮挡剔除、同类不透明店铺合批，draw calls 显著下降；同时保持前景 NPC 与实时人物深度遮挡准确、气泡不被错误穿透或误隐。 |
| 5 | CC0 沥青路面与石灰墙面法线/粗糙度细节贴图（`IDOK-291`：`3d96858d`） | `web/src/look/config.ts`<br>`web/src/look/tiles.ts`<br>`public/textures/{road,wall}.ktx2` | 在 `?gfx=mid` 或 `?gfx=high` 下低视角步行靠近沥青机动车道及老城墙面（配合 `?time=15` 或 `?time=18.5` 斜阳视角更明显）。 | 沥青路面呈现颗粒粗糙度与微小凹凸质感，建筑白墙呈现灰泥颗粒法线细节，告别纯平低模塑料反光。 |
| 6 | 桂林站站区按卫星图重构与外观精修（`IDOK-244`：`fcc97237`, `0944ecc3`） | `pipeline/landmarks/guilin_station.py`<br>`web/src/station-*.ts`<br>`public/landmarks/guilin_station.glb` | 按地图导航或传送前往桂林火车站站前广场与站房区域（亦可通过 `?cam=` / `?spawn=` 结合飞行模式靠近城区西南）。 | 桂林站大跨度站房立面提亮、醒目红色「桂林站」站牌字样、浅色屋檐与哑光站台砖面，配套重做的站区道路、人行天桥及绿化景观无缝接地。 |
| 7 | 定江铁路七段全线、西二环双洞联解与地形清除（`IDOK-329`~`#398`：`90de8ccc`..`d7d60e36`, `70d3d914`） | `web/src/railways.ts`<br>`web/src/station-tunnels.ts`<br>`pipeline/rail-sections/02..07` | 切换飞行模式飞往桂北—定江—西二环沿线（参考验证坐标：西二环双洞 `(-300, 182, -7470)`、八里七路 `(-30, 157, -8647)`、定江南跨线桥 `(-36.54, 157.5, -8358.2)`、桂西桂北联络线隧道 `(-798.76, 157.3, -8876.41)`），或走下穿道路地面通行。 | 双线定江铁路高架桥、跨线道路桥与西二环双洞隧道完整贯通，前五段侵入道床的地形已削平，下穿铁路的多条城市道路路面顺滑、车流与步行无穿模或断崖。 |
| 8 | 两江四湖船闸/堰坝通行、榕湖桥底净空与街道叠加修复（`IDOK-328`：`c70d65f7`） | `pipeline/dam_passages.py`<br>`pipeline/landmarks/ronghu.py`<br>`public/landmarks/ronghu.glb` | 地图前往「榕湖划船坞」(`dock-ronghu`)，按 `F` 上小船/竹筏穿越榕湖桥底与堰坝水域。 | 划船贴水面穿行榕湖石桥桥洞时不顶头刮底，湖面堰坝/滚水坝留有合规水面通道可连续通行。 |
| 9 | 十字街地面交通秩序重构：无斑马线、纯外侧人行道与护栏折返（`IDOK-412`：`c21a147c`, `ec49fc97`） | `web/src/shizijie-zone.ts`<br>`web/src/road-barriers.ts`<br>`pipeline/{streets,traffic}.py` | 在步行态前往十字街地表中心（`(-879.75, -169.63)`），观察四个方向斑马线、路口栏杆及路人轨迹。 | 十字街地面不再绘制斑马线（对应地下过街逻辑），外圈人行道沿路缘形成连续防横穿物理护栏，NPC 路人全部被钳制在外侧人行道并可于端头顺畅折返，清理了冗余旧装饰与旧信号灯杆。 |
| 10 | 全城人行步道与杉湖步路烘焙，含翠竹路下穿防卡修复（`ca24f8be`, `17ae14ef`, `af595e1f`） | `pipeline/world.py`<br>`pipeline/npc_sidewalks.py`<br>`web/src/world.ts` | 步行逛杉湖岸边步道、城市支路人行道及翠竹路下穿隧道口，测试在车流旁行走及上下车。 | 杉湖滨水与全市次级步行小道直接融入可走人行道面；翠竹路下穿隧道不再卡住大卡车，且玩家下车不再被卡进路基或障碍体。 |
| 11 | NPC  Crowd 零 T-Pose 与跨路名连续车流追踪（`IDOK-376/377/378`：`7a73ee21`, `6f3751db`, `3d2bb0ff`, `9cc0e78e`） | `web/src/traffic/crowd.ts`<br>`web/src/traffic/crowd-anim.ts`<br>`web/src/traffic/sim.ts` | 任意繁华街区站定观察新刷出的路人与跨路口行驶的汽车/电动车（可加 `?traffic=1` 强制车流密集）。 | 远端新刷出路人首帧即执行 `mixer.update(0)`（站立/行走权重平滑过渡，彻底告别短暂 T-Pose 稻草人）；人行道 NPC 顺着断裂碎步道路段连续前进不再原地徘徊；车辆跨越路名变化路口时不突兀消失或卡停。 |
| 12 | 钓鱼 2.0 主流程：10 处水域、按 `4` 装备、边走边钓与单键蓄力角力（`IDOK-336`/`337`：`1153a37b`..`5f86bd0f`, `7c5a2ab5`） | `web/src/fishing/session.ts`<br>`web/src/ui/hotbar.ts`<br>`web/src/walk/index.ts` | **默认开启**（`?fishing=0` 可关闭）。步行靠近漓江/杉湖/榕湖/桃花江/小东江等 **10 处钓区 40m 内**（例：象鼻山段 `(-656, 1124)`），水面出现飘浮「钓」标且底部物品栏弹出第 4 格「鱼竿」→ 按 **`4`（`Digit4`）** 装备 → 按住 **`Space` / 画布左键 / 触屏按钮** 蓄力 1.2s 抛竿 → **0.7s 内按提竿** → 角力阶段按住收线/松开放线；**`Alt`** 键切换鼠标锁定。 | 装备后手持碳纤维软木柄鱼竿与纺车轮，支持边走边调整站位（路亚不收线也会有鱼游近咬钩）；抛出见水花波纹，进入角力顶栏出现拉力条与方向提示、纺车轮曲柄高速旋转，拉至 `1.5m` 内上岸入包。 |
| 13 | 精细鱼模型、渔利抽屉与 3D 图鉴检视器（`IDOK-336`：`db8ad537`, `e1b80b47`） | `web/src/fishing/fish-model.ts`<br>`web/src/fishing/inspect.ts`<br>`web/src/fishing/fishing.css` | 持竿态点击左下/顶部「菜单 / 渔利」打开 `fishing-ui` 抽屉，查看、卖出或点击任意已钓获/图鉴鱼种弹出 3D 检视窗。 | 高模鱼身带鳞片凹凸法线、清漆高光、`eye rim` 眼神高光及多鳍条骨架，可在 3D 检视弹框中旋转端详，抽屉支持按水域筛选、批量卖鱼（每日上限 800 元同点折价）或换饵选台钓/路亚。 |
| 14 | 岸边现代电子钓鱼排行石碑与实名捕捞榜单（`IDOK-336`：`09f0984d`, `2bd6a4df`, `7c5a2ab5`） | `web/src/fishing/steles.ts`<br>`web/src/fishing/report.ts` | 前往 10 处标准岸钓点附近岸上步行查看；联网鉴权后上鱼会自动上报并在 5 分钟刷新间隔内更新排行。 | 岸边矗立带金属双柱、青灰石座、顶部灯条的自发光 LED 大屏电子看板（「本钓点排行」&「全服榜」，含前 10 上鱼榜与前 3 传说鱼榜，昼夜皆可辨识），带物理碰撞防穿模。 |
| 15 | 香烟 2.0：6 款新翻盖烟盒贴图、手部指握姿态与防手指错乱（`IDOK-407/288/366`：`2377a52c`, `5243433d`, `7da42fff`） | `web/src/smoke/*`<br>`web/public/smoke/packs/*.svg`<br>`pipeline/avatar_hands.py` | **默认开启**（`?smoke=0` 可关闭）。步行按 **`3`（`Digit3`）** 或点底部「香烟 / 香烟铺」买取「一点虹 / 二伍甲 / 老八块 / 乐涂 / 红玫 / 丹桂」翻盖烟盒；反复按 **`F`**（或点按钮）依次完成「撕开 → 拿取 → 点燃 → 吸一口」；再按 `3` 收起/丢弃。 | 人物双手呈现重新雕塑后的五指微曲自然抓握姿势：左手举起高清印刷翻盖烟盒并掀开盒盖，右手捏烟/打火机抬至嘴边，火苗亮起并冒出烟雾，全程切模式或结束抽烟时不再卡在 T-Pose 或手指 bind-pose 扭曲。 |
| 16 | 街景路网寻路导航（`IDOK-350`：`472bda7a`） | `web/src/play/nav.ts`<br>`web/src/map/route.ts`<br>`web/src/map/route-worker.ts` | 游戏内按 **`M`** 或点击右上「地图」→ 在大地图选中任意目标位置触发「**导航**」前往（取代旧纯直线指引）。 | Web Worker 按真实街道路网计算折线路径，地面/屏幕出现沿着街道转弯的实时导航路线与转向/距离提示，到达终点自动结束导航。 |
| 17 | 实时设备地理定位传送与步行跟随（`IDOK-417`：`ec3d690a`） | `web/src/geolocation.ts`<br>`web/src/ui/settings.ts` | 按 **`N`** 或点右上齿轮打开「设置」弹窗 → 在定位栏点击「**定位到我**」或「**跟随定位**」（需 HTTPS 或 localhost 安全上下文与浏览器位置权限，且设备实际位置在桂林地图范围内）。 | 取得高精度定位并校验合法速度后，人物直接空降并吸附至真实经纬度对应的桂林街道地面；开启「跟随定位」后人物会随现实走动朝向同步迈步行走，离图或切换模式自动礼貌提示停止。 |
| 18 | 玩家更新公告卡片弹窗（`IDOK-353`：`6355deb2`, `5df2dd96`） | `web/src/ui/update-cards.ts`<br>`web/src/ui/update-cards.css`<br>`server/update-cards.mjs` | 首次正式入城落地后自动检查 `/api/updates/unseen` 弹出；或在开发者控制台调用 `window.updateCards?.open()` / `mock([...])` 触发预览（`?verify` 测试或已读后不重复打扰）。 | 采用与街头 HUD 统一的深色沥青圆角卡片呈现「新玩法 / 新建模」图文翻页卡，支持「下一张 / 跳过 / 知道了」并回传阅读回执。 |
| 19 | 手机端触控 UI 收口：自定义布局与滑动调视距（`IDOK-256`：`5a7e2176`, `649a2edd`） | `web/src/ui/walk.ts`<br>`web/src/ui/thumb-layout.ts`<br>`web/src/ui/settings.ts` | 手机触屏访问，或 PC 浏览器切设备仿真（或带 `?phone`）查看；进入「设置 → 手机按键」可切换预设、按钮大小与左/右手模式。 | 去掉桌面冗余的独立「跑」键，左下摇杆推到底自动切换奔跑；右下「远近」改为可上下拖拽顺滑缩放的轨道滑钮（轻点切近/远）；竖屏下底部物品栏、读数条与右侧 Dock 网格彻底解冲不重叠。 |
| 20 | 街头 HUD 演示模式与多点位开局深链（`entry.ts`, `deeplink.ts`, `presets.ts`, `play/spots.ts`） | `web/src/entry.ts`<br>`web/src/presets.ts`<br>`web/src/play/spots.ts` | URL 携带 `?hud=street`（可再配 `?hudDemo=`）、`?cam=` / `?spawn=`（可选 `balijie`, `zengpiyan`, `guilinta`, `eastBoundary`, `lijiang`, `palace`, `elephant`, `overview`, `south`, `foot`）、`?slot=N/NE/E/SE/S/SW/W/NW`、`?time=18.5&weather=rain`、`?feedback=<id>`。 | 指定开场景别跳过随机外环抽帧与主界面直接落地预设点位；`?hud=street` 激活街头 HUD 面板并切换街景地图调色板；`?slot=` 展示外环眺望桂林山水的特定构图。 |
| 21 | 录像黑屏修复与 Shader 预热/流式网格分帧焊接（`IDOK-383`/`310`/`327`：`dcf97713`, `04036c4f`, `26f0150e`, `96752974`） | `web/src/gear/video.ts`<br>`web/src/gear/frame-tap.ts`<br>`web/src/stream.ts`<br>`web/src/shader-warmup.ts` | 点击/切出物品栏第 2 格相机（按 **`2`**）进入取景器点击录制视频并导出保存（`.webm`）；同时在高速飞行穿越城块时观察帧率平滑度。 | 录制的 `.webm` 视频画面正常、无全黑或时长元数据损坏问题；区块流式载入时的网格焊接与 Rapier 碰撞体注册按帧切片执行，Optional shader warm-up 失败也不会阻断入城落地。 |
| 22 | 米粉小店外观与室内装饰材质修复（`IDOK-305`：`80560cfb`） | `web/src/mifen/materials.ts`<br>`web/src/mifen/shop-mesh.ts` | 步行或传送进入城中米粉店附近走近室内及店招（亦可用 `?mifen` 加速就绪）。 | 恢复合批优化中被吞掉的天花板、吊灯、雪松木格栅、花岗岩台面与地砖纹理效果，昼夜灯光温暖质感完整呈现。 |
| 23 | 管理后台性能分布、运维双分栏与多人在线观测（`IDOK-384`：`7f0e63d8`, `28dbd342`, `802433cb`） | `web/admin/index.html`<br>`web/src/admin.ts`<br>`server/admin-analytics.mjs` | 打开 `/admin.html`（若本地/鉴权配齐后端服务）：左侧切换 `?view=overview` / `live` / `perf` / `breakdown` / `rt` / `mp` / `gfx` / `smoke` / `npc` / `errors`。 | 后台清晰拆分为「业务与玩法（`biz`）」与「运维与监控（`ops`）」两大侧栏域，支持 `24h` 慢查询加速缓存窗口、`X-Client-IP` CDN 来源解析、多人房间地标活动图及线上实时修改全服 `gfx` / `smoke` / `npc` 参数。 |
| 24 | 自包含静态错误页 403/404/500/502/504（`IDOK-420`：`613fcb47`） | `web/errors/{403,404,500,502,504}.html`<br>`scripts/build-error-pages.mjs`<br>`web/vite.config.ts` | 构建产物下访问 `/errors/403.html`、`/errors/404.html`、`/errors/500.html`、`/errors/502.html`、`/errors/504.html`（含 Vite dev/build `error-pages` 插件原样输出 `dist/errors/`）。 | 脱离外部静态资源依赖的单文件青松米纸风错误页，居中印章提示码与赤红返回/刷新主按钮，离线或 CDN 回源故障时亦可完整展示。 |
| 25 | 会话入场检验、触控全屏、MXANA 埋点与版权脚注（`IDOK-373/374/381`：`d55c2aa9`, `529a92e2`, `e2383e19`, `0ca07711`） | `web/src/entry.ts`<br>`web/index.html`<br>`web/src/ui/orientation.ts`<br>`web/src/ui/home.ts` | 常规进入主界面查看页底脚注与浏览器 Network；触屏点击模式卡体验全屏切换；普通访问触发登录态校验（第一方 QQ/微信 OAuth 已于 `#375`/`0ca07711` 整批回滚至邮箱/既有账号流）。 | 首页底部呈现 `Beta` 注明及开源致谢；触屏进入时尝试全屏锁定，主页面/市民卡/背包加载 `MXANA` 统计脚本（后台 `/admin.html` 不统计）。 |

<details>
<summary>附：79 个非合并提交（a3e7a630..origin/main）完整哈希去重映射表（点击展开核对）</summary>

- **城市升级与图形性能 (14)**：`71b63405`, `8a93d5f5`, `47ba2a89`, `229a3ad1`, `3d96858d`, `ed82d6e4`, `fc59c0bd`, `c3fc3663`, `dcf97713`, `04036c4f`, `7ca84216`, `a72c090c`, `26f0150e`, `96752974`
- **街道秩序、人行道与水陆桥梁 (13)**：`c21a147c`, `ec49fc97`, `7a73ee21`, `6f3751db`, `3d2bb0ff`, `ca24f8be`, `17ae14ef`, `af595e1f`, `472bda7a`, `9cc0e78e`, `7784d165`, `c70d65f7`, `7e20c80d`
- **定江铁路七段与桂林站重构 (10)**：`90de8ccc`, `4b6e395f`, `e63db348`, `067617a0`, `86f53419`, `cd315841`, `70d3d914`, `d7d60e36`, `fcc97237`, `0944ecc3`
- **钓鱼全系统 (13)**：`1153a37b`, `307a60bd`, `aa74c5f7`, `db8ad537`, `d68a0c39`, `1bea94b6`, `9fe0c4d7`, `d700104f`, `5f86bd0f`, `e1b80b47`, `09f0984d`, `2bd6a4df`, `7c5a2ab5`
- **香烟与手部模型 (3)**：`2377a52c`, `5243433d`, `7da42fff`
- **首页、HUD、定位、后台、鉴权与基建 (26)**：`613fcb47`, `ec3d690a`, `080ef6c8`, `7f0e63d8`, `5a7e2176`, `649a2edd`, `6355deb2`, `5df2dd96`, `0ca07711`, `8370cedb`, `6cf434bc`, `bdd35b1e`, `9e118002`, `529a92e2`, `56aedd1d`, `802433cb`, `28dbd342`, `98824aca`, `d55c2aa9`, `e2383e19`, `6039cbf4`, `255b33d4`, `440af6ea`, `4eef8307`, `c2e93313`, `80560cfb`
- 合计：**14 + 13 + 10 + 13 + 3 + 26 = 79 个非合并提交**（加 11 个 Merge 提交 = 90）。

</details>

---

## 二、`feat/xp-overnight` 本组全部功能全览

> 说明：本组所有主要新玩法（**辅警 3.0 解放桥执勤、罚款终端、腰挂打印机与左右塞单、`r10` 交警、解放桥护栏、十字街「小香港」B1 地下通道、王城「蜜雪林城」饮品小摊、撞倒爬起 `knockdown`**）均在 `http://127.0.0.1:5176/?mode=walk` **裸链直开**（加 `?verify` 额外挂载 `window.viewer` 调试句柄）。

| 序号 | 本组功能模块 | 入口（源码 / 模块 / UI） | 在本地完全体里怎么看到（URL 参数或按键） | 预期画面 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 辅警 3.0 · 解放桥定点执勤入口与一键前往 | `web/src/traffic-duty/ui.ts`<br>`web/src/traffic-duty/controller.ts`<br>`web/src/traffic-duty/types.ts` | 访问 `http://127.0.0.1:5176/?mode=walk` 落地步行态 → 右上方显示药丸按钮 `.td-entry`（「解放桥交警 · XXm」）；点击展开 `.td-panel` 点击「**前往解放桥交警**」（传送西桥头 `(-268.5, 151.86, 24.8)`）→ 走近交警（`spot (-266.26, 151.85, 26.86)`）按 **`F`**。 | 未上岗时仅展示导引按钮与「执勤 / 榜单」弹窗，不自动强行开启执勤；传送到位后桥头立着交警并头顶悬浮「解放桥交警 · [F] 领任务」信标；上岗后顶部切换 10 分钟执勤状态条、实时罚款总额与待领 10% 分成。 |
| 2 | 执勤三键闭环：`Q` 吹哨 / `E` 短按拦停长按放行 / `F` 执勤交互 + 键位提示同步 | `web/src/traffic-duty/duty-keys.ts`<br>`web/src/input/keymap.ts`<br>`web/src/ui/guide.ts`<br>`web/src/walk/interact-arbiter.ts` | 领装上岗进入执勤态后：按 **`Q`** 吹哨（`12m` 内违规车减速、逃逸车概率停下，口哨常驻嘴边）；**短按 `E`** 举左手摆停 + 右手举旗拦停前方 `8m` 内违规车；**长按 `E`（`>= 0.6s`）** 向外挥旗放行；靠近已拦停车辆 **`<= 4.0m`** 按 **`F`** 开单；左下「按键」卡与 **`F1`** 指南自动切换「执勤」分组；触屏直接点底部 4 颗 `.td-signal-dock` 按钮。 | 吹哨嘴边哨子亮出 `blowPulse`；短按 `E` 挥旗、违规电驴打起右转向灯平稳减速并停至最外侧非机动车靠边带（`|lz| >= 15.2`）；长按 `E` 旗子转向放行、电驴熄灯驶离；全过程按 `Q/E` 不触发车载加减档，与骑行/进店通过 `interact-arbiter` 确定性隔离。 |
| 3 | 解放桥独立 240m 执勤车流（黑道非机动行驶、15% 违规上限、人行道零撞、远端刷消） | `web/src/traffic/duty-traffic.ts`<br>`web/src/traffic/sim.ts`<br>`web/src/traffic/rider-pool.ts`<br>`web/src/traffic/crowd.ts` | 领装上岗站定解放桥即可观察（**完全独立于全局 `traffic` 开关或 `tour/solo` 模式**）；在人行道站立 60 秒或在桥中环顾四周（`S10`/`N1`/`N4`/`N6` 验收场景）。 | 桥面（中心 `(-168, 40)` 半径 `240m`）独立维持高密度双向汽车（中间机动车道）与两轮车：两轮车 **100% 走两侧黑色沥青非机动车道**（人行道 0 辆），同时活跃未罚违规车严格压在 `<= 2` 辆且占活跃车流 `<= 15%`，新刷出与消失发生在镜头外或 `>= 90–120m` 远处，人行道站立安全零碰撞。 |
| 4 | 解放桥全桥 3 道连续实体护栏（可空格翻越、不阻河面碰撞） | `web/src/traffic-duty/jiefang-railings.ts`<br>`web/src/main.ts`<br>`web/src/walk/obstacle-volumes.ts` | 站在解放桥桥面任意段查看北侧（`z=-12.0`）、中央双黄线（`z=0.0`）与南侧（`z=+12.0`）护栏；直接横穿会受阻，对准护栏按 **`Space`** 起跳翻越。 | 全桥 ~281m（`[-140.5, +140.5]`）共 3 道铁艺隔离护栏零缺口连续拼接（`InstancedMesh` 6 子网格零动态光源），步行平走稳稳挡住防止误闯快车道，按空格可踏上 `1.02–1.08m` 栏杆顶并跨至对侧车道（含江中主跨，不触发误判落水）。 |
| 5 | 手持执勤终端：6 类违章、数罪并罚（¥70 等）、防重开单与下岗 10% 结清入账 | `web/src/traffic-duty/fine-terminal/*`<br>`web/src/traffic-duty/controller.ts`<br>`web/src/game/commerce.ts` | 拦停违规车后按 **`F`** 唤出 `.td-fine-terminal` 终端（支持勾选多条违规如「电驴超载 ¥20 + 未戴头盔 ¥50 = **¥70**」，默认基准：**未戴头盔/单车双载/逆行/闯红灯各 ¥50、超载 ¥20、非法改装 ¥100**）→ **`Enter`**（或点按钮）确认开票吐纸；对已处罚车辆再按 **`F`** 验证拦截；执勤结束/途中走回西桥头交警身旁按 **`F`** 交差下岗结算（直接菜单点「直接放弃」不发提成）。 | 核对明细后进入打印吐纸阶段，顶部与终端实时更新，但**执勤期间钱包余额纹丝不动**，仅累计到「待领 10%」；重复开同一辆车立即弹出唯一 Toast「已开过罚单」并拒开；回交警岗交差对话完瞬间，按 `shiftNonce` 防碰撞幂等键将 `Math.round(totalFineYuan * 0.1)` 一次性打入钱包并持久化到 `glol.save.v1`。 |
| 6 | 腰挂热敏打印机、扯纸动作、就近左/右手智能递单与骑手收单 | `web/src/gear/duty-props.ts`<br>`web/src/emote/ticket-handover.ts`<br>`web/src/traffic-duty/handover/*` | 执勤中观察角色右胯：开单按 `Enter` 热敏吐纸 (`printProgress 0→1`) → 点击「扯下」/自动进入 `deliver` 阶段，打印机归回腰挂；先停在 `> 1.5m` 外看按钮置灰提示，再贴近至 **`<= 1.5m`**（同侧车道左或右站位对照）按 **`F`**（或点按钮）递交。 | 未打印时打印机带皮套扣在右腰胯；打印结束扯纸时纸条从锯齿切纸器口抽出并捏在靠近违规人的左/右手指间；超过 `1.5m` 禁递；进 `1.5m` 后触发精准就近伸手动作把带二维码凭条 `'duty-receipt-slip'` 真实挂进违规骑手对应近侧手骨，骑手举单致意后收车驶离。 |
| 7 | `r10` 统一画风交警、同源志愿警穿搭与 GTA 式多机位剧情双人对话 | `web/src/traffic-duty/officer-look/*`<br>`web/src/traffic-duty/story/*`<br>`web/src/walk/outfits.ts`<br>`docs/research/officer-r10/` | 与解放桥西桥头交警按 **`F`** 触发开班 / 续班 / 下岗结算对话；或放大镜查看自己上岗装与桥头交警服饰、面容神态变化与双侧实时头像立绘。 | 交警直接由主线 `#389` 人形骨架管线生成（与玩家完全同一赛璐珞轮廓画风），佩戴大檐帽、`#ccee1c` 荧光黄反光背心（背面银灰反光条清晰印「桂林交警」不被竖条压字）、`#1b2028` 黑腰带与五指分明白手套；对话开启电影上下黑边、5 个实时机位切换（`wide / officer / player / bridge / two`）及两侧绑定了真实角色快照与表情（`serious/smile/remind/thumbs_up/curious`）的动态立绘头像。 |
| 8 | 十字街「小香港」B1 地下商业街（4 角步梯、`16+16` 格子铺与导视） + 4 悬臂动态红绿灯覆盖 | `pipeline/shizijie_underpass.py`<br>`pipeline/landmarks/shizijie.py`<br>`web/src/tunnels.ts`<br>`web/src/walk/camera.ts`<br>`web/src/traffic-duty/traffic-signals-overlay.ts` | 传送或步行前往十字街（`(-879.75, 151.3, -169.63)`）：从 **NW `(-22.5, -38.8)`、NE `(+43.0, -23.0)`、SE `(+22.5, +46.5)`、SW `(-46.2, +21.5)`** 任意街角红顶防车护柱步梯步行下楼至 B1 层（`footY ≈ 147.1m`，地面切割无穿模）；抬头看路口 4 座悬臂信号灯（实时同步 `sim` 相位）。 | 下楼进入净高 `3.15m` 的环形「小香港」地下街：中庭 4 根包柱、**16 间亮灯营业原创品牌铺（SH-01 漓江米粉 ~ SH-16 24H 便利店）+ 16 间波纹卷帘招租位**、挑出式双面霓虹侧招与松烟绿悬吊出口牌完整照明且不穿地面草皮；第三人称与第一人称相机均豁免地表夹升；地上 4 路口红绿黄三色灯盘与仿真相位一致跳变。 |
| 9 | 王城商厦转角「蜜雪林城」饮品小摊（现点制作、叫号、钱包扣款与 `KeyI` 捧杯饮用） | `web/src/drinks/*`<br>`pipeline/landmarks/wangcheng_mall.py`<br>`web/src/play/index.ts`<br>`web/src/walk/interact-arbiter.ts` | **裸链默认挂载**（`?drinks=0` 可关，`?drinksSite=zhengyang_208` 可切候选点位）。步行到王城商厦西北转角（`(-595.46, -70.78)`）：靠近摊位按 **`F`** 点单购买（实扣钱包）→ 制作叫号后按 **`F`** 取杯 → 徒步右手捧杯，按 **`I`（`KeyI`）**（或点下方饮品悬浮条）畅饮减口数/收起杯子。 | 转角出现带遮阳棚、制冰吧台、排队与坐席 NPC 的实景饮品摊，摊前自动清除了原占道停放单车；取杯后角色真手捧起带吸管/杯套的 3D 饮品杯，按 `I` 抬手啜饮，上车/开拍/进执勤UI 时自动合规暂存或礼让快捷键。 |
| 10 | 碰撞倒地 `knockdown` 3 段恢复状态机 × 无人机模式协同 | `web/src/walk/knockdown.ts`<br>`web/src/walk/index.ts`<br>`web/src/play/index.ts`<br>`web/src/drone/` | **撞倒测试**：在执勤机动车道或违规快速碰撞时触发被撞飞/摔车（或 `?verify` 调用 `viewer.knockdown` / 桥中压弯低摔），按提示 **连按 5 次 `Space` 空格** 经历「趴撑 → 跪撑 → 单膝」爬起（故意停顿 **`> 2.4s`** 会摇晃回退上一段）；**无人机**：点击右侧功能栏无人机按钮放置起飞，使用 **`WASD` + 方向键 + `Space` / `R` / `P` / `V` / `Esc`**。 | 倒地包含 6 种受击变体与 4 种呼吸微动（喘气/捂腰/张望/撑起），倒地期间跟随相机俯视角上抬 `+0.42 rad` 越过桥栏俯瞰角色，底端显示环形五步槽与超时回退警报；开启无人机遥测图传时，自动抑制地面执勤热键与 `play` 拍照/景册冲突并正常回收地表高程。 |

---

## 三、双组直合并撞车风险清单与逐项解冲指南（独立专节）

> 基于工作区现场 `git merge --no-commit 613fcb47` 实测：**两分支共有 26 个文件存在交集修改**，其中 **`11` 个已报 Git `UU` 文本合并冲突**，其余 **`15` 个虽未报 `UU`（或属二进制无法自动合并），但直接影响双组核心功能能否并存。**

### 3.1 七大跨模块系统级撞车风险与解冲规则

#### 风险 1：`IDOK-412` 十字街地表整治 × 本组十字街「小香港」B1 地下通道（空间 & 几何双线硬碰硬）
- **涉及文件**：`web/src/tunnels.ts`（**UU**）、`web/src/walk/camera.ts`（**UU**）、`web/src/walk/support.ts`（**UU**）、`web/src/walk/index.ts`（**UU**）、`web/src/stream.ts`（**UU**）、`web/src/world.ts`（**UU**）、`web/src/shizijie-zone.ts`、`web/src/road-barriers.ts`、`pipeline/streets.py`、`pipeline/traffic.py`、`pipeline/world.py`、`pipeline/landmarks/shizijie.py`。
- **具体撞车点**：
  1. **`SHIZIJIE_CURB_BARRIER_POLYLINES` 是否封堵 B1 四角楼梯口？**：`origin/main` 为消除地表横穿在十字街路缘加装了整圈物理 `roadBarriers`。合并后务必实机或脚本核查 NW `(-22.5, -38.8)`、NE `(+43.0, -23.0)`、SE `(+22.5, +46.5)`、SW `(-46.2, +21.5)` 四座步梯地面入口朝向与路缘石缺口，确保不被新栏杆围死导致下不去地下室。
  2. **去斑马线逻辑重复与路面切割冲突（`pipeline/streets.py`, `pipeline/world.py`）**：主线新增 `SHIZIJIE_NO_CROSSWALK_ZONE` 跳过斑马线并在 `world.py` 新增 `station_footbridge` / `apply_dams`；本组在 `streets.py` 加了 `in_shizijie_clear_zone` 并在 `world.py` 调用 `apply_shizijie_underpass(..., bake_roads=False)`。解冲时 `pipeline/world.py` 两者顺序必须保留（`apply_shizijie_underpass` 不可丢），地表去斑马线多边形建议统一收敛为同一套 `shizijie_underpass` / `shizijie-zone` 真源。
  3. **地下行人节点被地表 `NO_PED` 误清（`pipeline/traffic.py`, `web/src/traffic/crowd.ts`）**：`origin/main` 在 `pipeline/traffic.py` 增加 `SHIZIJIE_NO_PED_CORE` 约束并清理地表人行轨迹，且在 `crowd.ts` 用 `clampOutsideShizijieNoPedZone` 硬把人物外推；而本组在 `pipeline/traffic.py` 为 B1 地下走廊烘焙了 `9_900_000_000_000+` 专用人行节点。**合并禁区**：`NO_PED` 多边形夹逼逻辑绝不可误伤地下或 B1 `underpass` 楼梯内的行人，且 `tunnels.ts` 必须同时兼容主线 `station-tunnels.ts`（定江下穿隧道 `tunnel.nodes` 分支）与本组 `GroundCutout` / `ShizijieUnderpass`。
  4. **相机地下高度与天桥踏面碰撞（`walk/camera.ts`, `walk/support.ts`, `walk/index.ts`）**：`walk/camera.ts` 冲突块需保留本组 `resolveCamBounds`（地下通道免被地面 `sidewalk/road` 夹升到 151.75m）同时整合主线 `ceilingAt()`；`walk/support.ts` 与 `walk/index.ts`（第 2563 行 `inBore` 判 `tunnelFloor || underpassFloor`）必须把两边隧道逻辑“或”起来合并，否则任一边要么进不去桂林站/定江下穿、要么掉进十字街地下报错。

#### 风险 2：`IDOK-376/377/378/412` 车流与Crowd重构 × 辅警 3.0 执勤车流（4 个车流核心文件全部 `UU` 冲突）
- **涉及文件**：`web/src/traffic/sim.ts`（**9 块 `UU`**）、`web/src/traffic/index.ts`（**3 块 `UU`**）、`web/src/traffic/crowd.ts`（**1 块 `UU`**）、`web/src/traffic/models.ts`（**1 块 `UU`**）、`pipeline/traffic.py`。
- **具体撞车点**：
  1. `sim.ts` 主线改了跨街名连续追踪（`adjacent()`、`synthNodeId`）、人行碎路段续接及 `shizijie-zone` 外侧折返；本组在同文件新增 `dutyOnly`、2 辆违规配额/冷却、`violation`/`violations`、`fleeing`/`pulling_over`/`halted` 状态及 `constrainActorPosition`。解冲准则：**保留全部 `dutyConfig` / `DutyBehaviorState` / `wrongWay` 结构字段与逻辑，同时把主线的 `adjacent()` 跨街名寻路和折返段接上**，且顺带确保先前发现的 `hiddenLifecycle` 下 `wrongWay` 对头死锁防御继续生效。
  2. `traffic/index.ts` 主线引入 `alignWheels`（轮姿对齐），本组引入 `getActiveDutyTraffic / getDutyTrafficExclusionZone` 和 `riderPool`（裸车+可分离双侧带骨骼骑手渲染，支撑左手/右手塞入凭条）。**合并必须两全其美**：保留 `riderPool` + `exclusionZone`，并在汽车渲染路径合入 `alignWheels`。
  3. `traffic/crowd.ts` 主线加了 `blendPasserbyWeights`、`warm` 和首帧 `mixer.update(0)` 消 T-Pose；本组加了学生双肩包圆角建模（`BACKPACK_PALETTES`, `mergeGeometries`）与十字街步梯/护栏联动支持。两个改动正交，可无缝叠加合入。

#### 风险 3：`IDOK-408/409` 全城 325 分片 & 96 店升级 × 王城「蜜雪林城」饮品摊（空间遮挡冲突）
- **涉及文件**：`web/src/world.ts`（**UU**）、`web/src/stream.ts`（**UU**）、`web/src/batch.ts`、`web/src/main.ts`（**UU**）、`pipeline/landmarks/wangcheng_mall.py`、`public/city-upgrade/shards/*.json`。
- **具体撞车点**：
  1. `origin/main` 的 `IDOK-409` 已在全城生成 `public/city-upgrade/shards/`（含王城商厦所在的 `-2_-1.json` 周边区块），动态叠加新版门头 `fascias`、竖招 `blades` 和墙面 `walls`。
  2. 而本组在 `wangcheng_mall.py` 为 `_DRINKS_CORNERS_WORLD` (`(-590.90, -65.05)`..`(-599.89, -77.10)`) 精细裁剪/贴合了实体「蜜雪林城」转角摊位（且在 `batch.ts` 加了 `isWangchengDrinksExcludedParkedBike` 清除摊前停放单车）。
  3. **高危表现**：合并后如果不排查对应 shard，可能出现主线生成的浮空/贴墙店招（`fascias`/`blades`）穿插进蜜雪林城门头，或 `batch.ts` 误合丢掉 `isWangchengDrinksExcludedParkedBike` 导致饮品摊门前重新堆满共享电驴。**解冲验证要求**：合完后必看 `wangcheng_mall` 转角现场，确保饮品店不被 `city-upgrade` 店招叠穿且保留 `main.ts` 里的 `publishViewer` 对 `cityUpgrade`、`drinks`、`trafficDuty` 全字段并存暴露。

#### 风险 4：#389 手部骨骼及烟盒动作重编 × `r10` 交警手套 / 左右递单手骨 / 倒地撑地（二进制资产碰撞风险）
- **涉及文件**：`pipeline/avatar_hands.py`、`public/avatar/creator-rig.bin`、`public/avatar/figure.glb`、`public/avatar/figure_f.glb`、`public/avatar/figure_m.glb`、`web/src/walk/index.ts`（**UU**）。
- **具体撞车点**：
  1. 实测 `git diff --shortstat a3e7a630` 发现两边在 `pipeline/avatar_hands.py` 的改动行数恰好完全一致（均 `+27 / -8`），说明极大概率两边先后樱桃摘/对齐了 `#389` 手指重构，但 **4 个 `public/avatar/*` 二进制文件同时存在于双方差异里**。
  2. 若 `merge` 阶段任选一侧二进制覆写另一侧，需复检两个关键表现：① 主线 6 款烟盒的防 T-Pose 与手部抓握是否正常；② 本组 `r10` 交警 `officer-look` 几何白手套、左右就近手骨 `hand_l`/`hand_r` 挂 `duty-receipt-slip` 偏移量（`0.134m`）及 `knockdown` 撑地关节是否穿指。
  3. 同步关注 `web/src/walk/index.ts` 第 1575 行与第 2143 行冲突：主线添加了 `stopLocomotionActions()` 与抽烟/动作 LIFO 逆序叠加注释（`holdLayer.apply() -> smoking.tick() -> emote.tick()`），本组添加了 `knockdown.reset()`、`ticketHandover.reset()` 与受击打断逻辑——务必按「主线清理函数 + 本组 `knockdown/ticketHandover/dutyFlagHold` 重置」合并，不能把任一方的姿态栈冲掉。

#### 风险 5：共享按键、交互仲裁优先级与移动端触控护栏碰撞
- **涉及文件**：`web/src/walk/index.ts`（**UU**）、`web/src/walk/interact-arbiter.ts`、`web/src/ui/walk.ts`、`web/src/walk/input-guard.ts`、`web/src/ui/guide.ts`、`web/src/entry.ts`、`web/src/play/index.ts`。
- **具体按键/交互碰撞表**：
  1. **`KeyF` 多方争抢**：`origin/main` 在 `walk/index.ts:398` 直接监听 `hits(event.code, 'interact')`（默认 `KeyF`）驱动 `smokeAction()`；本组 `interact-arbiter.ts` 为 `[F]` 建立了 7 级确定性仲裁（含 `whistle_cite`、`handover_ticket`、`talk_officer`、`open_shop` 含饮品店、`mount_vehicle`）。**合并规则**：当手持违章单或近距离有拦停违规车/在交警对话弹窗/在饮品点单弹窗打开时，绝不允许同时误触点烟；保留 `input-guard.ts` 把 `.drinks-order-panel`、`.td-story-dialog`、`.td-fine-terminal`、`.knockdown-hud` 等全部留在 `MODAL_OVERLAY_SELECTOR` 和 `TOUCH_UI_SELECTOR` 中，并保留 `entry.ts` 对这些 UI 的 `Escape` 阻断判断。
  2. **`KeyQ` / `KeyE`**：仅保留本组在 `ui/walk.ts` 新增的 `shouldSuppressRideGearKey` 守卫（徒步执勤时按 `Q/E` 吹哨挥旗，禁止触发车载挡位变更）以及 `IDOK-256` 主线新增的「去掉跑键 + 上下拖拽远近滑轨 + `mountThumbLayout()`」。
  3. **`KeyI` 与 `KeyX`**：饮品啜饮已特意避开主线 `KeyY` / `KeyH` 而使用 `KeyI`；钓鱼不再绑定 `KeyX`（用 `Digit4` + `Space` + 鼠标左键 + `Alt`），不会误触 `crouch(KeyX)`，但 **钓鱼 `Space`、`无人机 Space`、`步行跳跃 Space`、`倒地连按 5 次 Space`** 共享 `Space`，合并 `walk/index.ts` 与 `play/index.ts` 时需保持状态优先级互锁（`drone.active` > `knockdown.isDown` > `fishing` > `jump`）。
  4. **移动触控 `isTouchInControlZone`**：`origin/main` 新增动态传入可见按钮 `controls` 矩形区域解决 `thumb-layout` 拖拽偏移；本组 `.td-signal-dock`、`.drinks-hold-hud`、`.knockdown-hud` 在移动端的点击容器需全部纳入 `TOUCH_UI_SELECTOR` 防划动穿透旋转相机。

#### 风险 6：入口鉴权策略、首页改版与开场引导弹窗（影响「本地完全体」直达体验）
- **涉及文件**：`web/src/entry.ts`、`web/src/ui/home.ts`、`web/src/ui/update-cards.ts`、`web/src/main.ts`（**UU**）。
- **具体撞车点**：
  1. `origin/main` 强化了联机主推、登录检查与 `update-cards` 落地后异步弹框；本组则强调裸 URL `http://127.0.0.1:5176/?mode=walk` 即可直接玩到辅警 3.0 + 蜜雪林城 + 小香港地下商业街，且需确保 `.coach` 与 `update-cards` 在测试及本地快速预览时不会挡住 `.td-entry`、`.td-story-dialog` 或 `KeyF` 操作。
  2. 若部署在非 `127.0.0.1` 局域网 IP 测本地完全体，需注意 `entry.ts:29` 仅放行 `['127.0.0.1', 'localhost']` 的深链免登逻辑（如用局域网 IP 访问需在登录状态或本地调试开关下运行）。

#### 风险 7：公有构建产物、静态资产与 `public/` 重编同步（防「本地代码合完但画面没更新」）
- **涉及项**：`dist/`、`public/landmarks/shizijie.{glb,json}`、`public/landmarks/wangcheng_mall.glb`、`public/landmarks/nikoniko.glb`、`public/og.jpg`、两分支各自 新增 E2E 脚本与单元测试集。
- **解冲规则**：所有 `pipeline/*.py` 与 `web/src/` 合入解决后，必须在本地完全体上完整执行 **Typecheck (`npx tsc -p web --noEmit`) + 单元测试（本组 `traffic-duty/drinks/knockdown` + 主线 `fishing/smoke/gfx/city-upgrade`）+ 重新 `npm run build` 并按需确认 `public/landmarks/*.glb`、`public/avatar/*` 与 `dist/` 一致性**，避免出现「源码已合并但预览端口还在跑旧构建资产」的假性失效。

---

### 3.2 全部 `26` 个共同修改文件逐项处理台账

| # | 文件路径 | 当前 Merge 态 | `origin/main` 改动要点 | `feat/xp-overnight` 改动要点 | 合入处理建议 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `web/src/main.ts` | **`UU` (4 块)** | `gfxState`/`post`、`cityUpgrade`、`update-cards`、`solo` 模式切换、`render-range` | `drinks` 挂载、`trafficDuty`/`dutyTraffic`/`jiefangRailings`/`dutyOfficers`/`shizijieSignals`/`knockdown`/`fineTerminal`、`viewer` 探针、`walkTo(..., targetY)` | **人工双留融合**：`walkTo` 保留 `targetY` & 桥面高程适配；挂载区保留全部本组 + 主线系统；`publishViewer` 合并暴露 `cityUpgrade` 与本组全部句柄；主循环同步推进两边 `step`/`tick`。 |
| 2 | `web/src/stream.ts` | **`UU` (标记)** | `buildingGeometry`、`city-upgrade` shard 异步确保与释放、`surfaceAt(x,z)`、`tileRevision` | `registerTunnels(..., groundCutouts, shizijieUnderpass)`、`loadShizijieUnderground()`、`detail` 透传参数 | **双留融合**：保留 `city-upgrade` shard 生命周期与 `surfaceAt` 探针，同时把 `groundCutouts` 与 `shizijieUnderpass` 传参链及地下城加载挂回。 |
| 3 | `web/src/traffic/crowd.ts` | **`UU` (1 块)** | `clampOutsideShizijieNoPedZone`、`blendPasserbyWeights`、`syncPasserbyActions`、首帧 `mixer.update(0)`、shader `warm` | `BACKPACK_PALETTES` + `createRoundedBackpack` 圆角学生书包、`mergeGeometries` | **双留融合**：两套改动正交，保留书包生成函数并合入主线无 T-Pose 与人行道钳位；核查十字街楼梯口附近别误推下楼NPC。 |
| 4 | `web/src/traffic/index.ts` | **`UU` (3 块)** | `alignWheels` 汽车轮姿接地对齐 | `getActiveDutyTraffic` / `getDutyTrafficExclusionZone`、`riderPool` 裸车+双侧骨骼骑手分离、骑乘隐藏裸骑士替换 | **双留融合**：在常规车渲染链路加入 `alignWheels`，完整保留 `riderPool` 与桥区排除逻辑（防止全城普通车与独立执勤车双叠）。 |
| 5 | `web/src/traffic/models.ts` | **`UU` (1 块)** | 车模细节或材质同步微调 | 拆出无骑手两轮裸车 `bare` 变体与双轮规格支持，配合 `riderPool` 手骨塞单 | **主留本组并核 `alignWheels` 锚点**：确保保留 `bare` 无骑士两轮变体导出，不破坏主线车型轮轴位置。 |
| 6 | `web/src/traffic/sim.ts` | **`UU` (9 块)** | `adjacent()` 跨街名寻路、`synthNodeId`、防碎人行道徘徊、`shizijie` 禁行区与端头折返 | `dutyOnly`、2 车违章上限、20s 冷却、6 违章+并罚、`fleeing`/`pulling_over`/`halted`、`wrongWay`、`constrainActorPosition` | **最高优先级人工精细解冲**：逐块保留本组 `Actor`/`dutyConfig`/`stepDutySpawns`/`pulled_over` 状态机与 `wrongWay` 防死锁逻辑，同时合入主线 `adjacent`/`shizijie` 路口连接修补。 |
| 7 | `web/src/tunnels.ts` | **`UU` (标记)** | 引入 `station-tunnels.ts`，为 `tunnel.nodes` 铁路下穿提供 `floorLevel`/`nearbyTunnels`/`tunnelGeometry` | `GroundCutout`、`ShizijieUnderpass`（B1 环廊、通道、格子铺/卷帘/灯箱渲染）、`underpassFloor` | **双留融合**：`tunnelFloor`/`tunnelGeometry` 优先派发 `tunnel.nodes` 给 `station-tunnels`，同时完整保留本组 B1 `ShizijieUnderpass` 渲染、墙洞裁剪与地表切割逻辑。 |
| 8 | `web/src/walk/camera.ts` | **`UU` (2 块)** | `ceilingAt(...)` 屋顶夹高限制 | `resolveCamBounds`（针对 `underpassFloor` 地下通道与高差做豁免，避免拉回 151.75m 地表） | **双留融合**：在 `resolveCamBounds` 内部保留 `ceilingAt` 与 `underpassFloor` 双判断，兼顾地下商业街与常规室内/隧道顶板防穿顶。 |
| 9 | `web/src/walk/index.ts` | **`UU` (5 块)** | 钓鱼 (`fishing:slot`, `steles`, `fishingMarks`)、香烟 (`smokeHint` + `F` 键)、`stopLocomotionActions()`、`IDOK-256` 触控接入 | `knockdown` 状态机、三键执勤动作 (`whistle`/`flag`/`ticket`)、`ticketHandover`、饮品交互桥、`interact-arbiter` 接线、`inBore` 含 `underpassFloor` | **按 5 冲突块精细合并**：(1) 穿衣/复位保留两方装备与动作停用；(2) `walkInput` 保持外部锁相机 + 主线 `zoomLevel`；(3) `tick()` 按 `holdLayer -> knockdown/ticketHandover -> smoking -> emote` 顺排防姿态互盖；(4) `KeyF` 抽烟受 `interact-arbiter`/执勤弹窗门禁避让；(5) `inBore` 保持两方 `||`。 |
| 10 | `web/src/walk/support.ts` | **`UU` (1 块)** | 高台/铁路/天桥地表支持面采样微调 | `elevated` 比较取 `validDeck` 与 `validLm`（解放桥面/高架 `landmark`）较高者再兜底地面 | **双留融合**：检查主线 `support.ts` 3 行增补是否与天桥/站区相关，在保留 `validDeck / validLm` 优先逻辑基础上兼容。 |
| 11 | `web/src/world.ts` | **`UU` (标记)** | `city-upgrade` shard 确保检查、`StationPavingStyle`、`roadbeds`、`SurfacePoly` 多边形裁剪 | `Tile` 扩展 `groundCutouts?` / `shizijieUnderpass?` 并透传进 `tunnelGeometry` | **双留融合**：合并 `Tile` 接口全部可选字段，保留 `city-upgrade` shard 勾子与 `shizijieUnderpass` 传入 `detail()`。 |
| 12 | `web/src/batch.ts` | 非UU (自动合) | `isCityUpgradeExcludedShopBox`（升级地砖下隐去旧棚架/卷帘）、引入隧道衬砌材质 | `isWangchengDrinksExcludedParkedBike`（隐去王城饮品店前停放共享单车） | **复核两者并存**：确保 `batch.ts` 同时调用两种隐身过滤器，既去掉旧铺棚又不挡饮品店。 |
| 13 | `web/src/entry.ts` | 非UU (自动合) | `fullscreenOnEntry()`、`contextmenu`/`dragstart` 防手机长按弹菜单 | `Escape` 关闭前排除 `.drinks-order-panel` 与 `.mifen-*` 弹窗防止冲突 | **复核两者并存**：确认本组新增的 `.td-story-dialog` / `.td-fine-terminal` 也正常响应自有 `Esc` / 不误触主菜单。 |
| 14 | `web/src/play/index.ts` | 非UU (自动合) | `navigation` 路网导航接入 `mapView` 与每帧 `nav.tick(dt)` | `drinksShopObj`、`pointInsideDrinksShop` 与店内标牌遮挡、与 `drone.active` 互斥显隐 | **复核两者并存**：确认 `drone.active`、`nav.visible` 与 `drinks` 遮挡检测全在位无覆盖。 |
| 15 | `web/src/ui/guide.ts` | 非UU (自动合) | 手机「远近」拖拽提示词条更新，移除手机「跑」键描述 | 新增 `Ctx = 'duty'` 场景行及 `F1` 指南「辅警执勤」词条与分组 | **复核两者并存**：指南文案保留 `IDOK-256` 手机新版词条 + `duty` 上岗专属行。 |
| 16 | `web/src/ui/walk.ts` | 非UU (自动合) | `IDOK-256` 删「跑」键、改「远近」拖拽 rail、`mountThumbLayout()`、传入 `zoomLevel` | `shouldSuppressRideGearKey` 阻止徒步执勤期 `Q`/`E` 触发车辆换挡 | **高危复核**：`walkInput` 签名新增第 6 参数 `zoomLevel` 时核查所有调用方同步，并严保 `Q`/`E` 挡位门禁。 |
| 17 | `web/src/walk/input-guard.ts` | 非UU (自动合) | `isTouchInControlZone` 支持动态传入可见触控 `controls` 矩形框 & 新边距 | 把 `.td-*`、`.drinks-*`、`.knockdown-hud` 加进模态阻断与触控白名单选择器 | **高危复核**：确保全套新增弹窗与左下执勤按钮均在 `TOUCH_UI_SELECTOR` / `MODAL_OVERLAY_SELECTOR` 内且适配动态护栏。 |
| 18 | `pipeline/avatar_hands.py` | 非UU (双方同改) | `#389` 手型重建与均匀四边手指截面 | 同源 `#389` 同步改造 | **核验脚本**：确认合并后无重复函数或参数漂移（diff 行数 `+27/-8` 完全吻合）。 |
| 19 | `public/avatar/creator-rig.bin` | 非UU (**二进制**) | `#389` 手部骨架数据 | 同源 + `r10` 校验兼容版 | **实机复验**：合并后必须分别实测「香烟抓握」与「`r10` 交警/递单手骨」，发现偏差即重跑同一份 `avatar_hands.py` 导出。 |
| 20 | `public/avatar/figure.glb` | 非UU (**二进制**) | `#389` 主体白模 | 同源 + 略增面/属性包 | **实机复验**：同上，重点查手指粗细、白手套着色与递单手骨挂点距离。 |
| 21 | `public/avatar/figure_f.glb` | 非UU (**二进制**) | `#389` 女性体形 | 同源（二进制同大小微差异） | **实机复验**：换装女生模型测试站姿、吹哨、挥旗、倒地爬起与递单。 |
| 22 | `public/avatar/figure_m.glb` | 非UU (**二进制**) | `#389` 男性体形 | 同源（二进制同大小微差异） | **实机复验**：对照 `officer-r10` 交警体形（`r10` 已终审定版，需防退化）。 |
| 23 | `pipeline/landmarks/wangcheng_mall.py` | 非UU (自动合) | `load_osm('wangcheng_mall')` 本地参考包切换 | 为转角 `_DRINKS_CORNERS_WORLD` 裁剪/预留饮品小摊轮廓基座 | **双留并重跑**：既用 `load_osm('wangcheng_mall')` 保离线可用，又保留饮品摊位轮廓退让，按需重导出 `wangcheng_mall.glb`。 |
| 24 | `pipeline/streets.py` | 非UU (自动合) | `SHIZIJIE_NO_CROSSWALK_ZONE` 去斑马线、Shapely `make_valid` | `in_shizijie_clear_zone` 抑制十字街斑马线绘制 | **双留统一**：清理冗余两套开关判断，合并为一个干净多边形免除重复维护。 |
| 25 | `pipeline/traffic.py` | 非UU (自动合) | `SHIZIJIE_NO_PED_CORE` 约束地表行人、路网清理与引道 | `SHIZIJIE_UNDERPASS_WAYS`、`STAIRWELLS`、生成 B1 `9_900_000_000_000+` 行人网络 | **高危复核**：若需重跑 `pipeline`，必须确认 `SHIZIJIE_NO_PED_CORE` 不剪裁掉地下楼梯口接入节点。 |
| 26 | `pipeline/world.py` | 非UU (自动合) | `station_footbridge.building_cutouts`、`dam_passages.apply_dams`、构建加速优化 | 结尾挂载 `apply_shizijie_underpass(output, roads, bake_roads=False)` | **双留核验**：保留主线桂林站/船闸切割与 `apply_shizijie_underpass` 调用顺序，重烘城市切片时两不遗漏。 |

*(注：除以上 26 个代码/资产交集外，本组 `public/landmarks/{shizijie,nikoniko,wangcheng_mall}.glb` 与主线 `public/landmarks/{guilin_station,ronghu}.glb` 地标互不重叠，可在合入后直接共存于 `public/landmarks/`；但合并完成前务必重执行 `npm run build` 刷新 `dist/` 并执行全量单测与真实浏览器巡检。)*
