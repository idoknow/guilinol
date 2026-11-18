# Guilin Online · 网上桂林

真实地理布局的桂林第三人称 3D 城市漫游，目标地址 https://glol.rcpd.cc 。

- 方案：three.js + 离线数据预处理 + 256 m 分块流式加载，桌面和手机都能玩。
- 交接文档：`docs/handoff-roc14.md`（调研、数据摸底、初版计划）。
- 原始数据（OSM / Overture / Terrarium DEM）不入库，放 `raw/`，获取方法见交接文档第 8 节。

数据署名：© OpenStreetMap contributors (ODbL)；Overture Maps Foundation / Zenodo 8174931 建筑数据 (CC BY 4.0)；Mapzen Terrarium 高程瓦片。

## 本地生成与查看（M1a）

需要 Node.js 22.12+、npm、uv、Python 3.11–3.13（uv 可安装），浏览器需要 WebGL2。先从 IDOK-2 附件下载 `guilinol-handoff-data.zip`。在新克隆的仓库根目录运行：

```sh
unzip /path/to/guilinol-handoff-data.zip 'raw/*'
npm ci
npm run world
npm run build
npm run preview
```

打开终端显示的本地地址。`public/world/` 是可重建产物；静态站点为 `dist/`（含 world），不提交原始数据或构建产物。开发模式用 `npm run dev`。

`npm run world` 同时生成 `manifest.atlas` 指向的 gzip JSON 地图数据。按需调用 `loadAtlas(manifest)` 后可使用 `roadAt(x,z,max=18)` 查询路名、`search(query,limit?)` 搜索地标；坐标为场景 x/z 米。`npm run verify:atlas` 在 Node 中验证生成物与查询结果，无需浏览器。

- 桌面：点击画面进入鼠标视角，Esc 释放；WASD 飞行，Q/E 降升，左 Shift 加速。手机：单指转向、双指一起拖动前后/横移。
- 加载半径默认 480 m，可在网址后加 `?radius=750`，范围 192–1600 m。调试栏的 B 是累计成功读取的 world 文件大小，不含 JS/HTML。
- 默认市中心框，自定义例：`npm run world -- --bbox 25.275 110.29 25.285 110.30 --output public/sample`。南西北东顺序；需自行提供覆盖对齐后区域的数据。不同框建议用新的空目录，避免残留不再被 manifest 引用的旧块。
- 地面颜色见 `pipeline/palette.json`，修改后重新生成；材质、光照、雾见 `web/src/look/config.ts`。
- 生产包飞越测试：构建后运行 `npx playwright install chromium`、`npm run verify:flight`（已有系统 Chromium 可用 `CHROMIUM=/usr/bin/chromium npm run verify:flight`）。脚本自行启动/关闭本地预览服务，输出首屏与帧时间指标、校验全框逐块加载，截图保存至 `captures/`。采用空浏览器上下文、960×540、SwiftShader；首屏时间从导航开始到画过总览后的下一次动画回调，不把 HTML 文案当首屏。

默认南界 25.250，包含 27 座具名峰及从 DEM 检出的无名峰（本框 37 座）。用 `?cam=lijiang`、`palace`、`elephant`、`overview`、`south` 切换启动机位；`foot` 是独秀峰近景。`verify:flight` 保存这六张截图。`uv run --locked python pipeline/check_peaks.py` 从成品检查共享边、高度场、400 m 内底面残留、LOD 与量化属性，输出逐峰高程和面数表。具名峰来源见 `pipeline/peaks.json`，自动峰见生成目录的 `auto-peaks.json`；地形估算并非测绘值。二进制读取约定见 `docs/chunk-format.md`。

## 第三人称步行

重新生成 GL04 世界后，用 `?mode=walk` 从王城正阳门外出发，或用 `?spawn=palace|elephant|lijiang`。V 在当前地点切换飞行与步行。WASD 移动，Shift 跑、空格跳；拖动转向、滚轮缩放、C 切换跟随距离。手机左摇杆推满即跑，右半屏拖动转向。深水区只允许在桥上通行；不能原地站立时在 64 m 内找落脚点，无解时派发 `walk:spawn-failed`。

生产包验收：`npm run world && npm run build && CHROMIUM=/usr/bin/chromium npm run verify:walk`。脚本沿街实走约 3 分钟，逐帧验证胶囊与地形、建筑、山体的关系，另测撞楼、陡壁、解放桥、拒水岸线和象鼻山预设出生。`captures/walk/` 中有四张截图及帧记录（步编号、x、z、脚底余量、是否在楼/山内、救援次数、帧时间毫秒）。角色模型与材质入口在 `web/src/look/avatar.ts`；速度、跳高与相机参数在 `web/src/walk/config.ts`；授权见 `docs/credits.md`。
