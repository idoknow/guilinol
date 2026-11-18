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

- 桌面：点击画面进入鼠标视角，Esc 释放；WASD 飞行，Q/E 降升，左 Shift 加速。手机：单指转向、双指一起拖动前后/横移。
- 加载半径默认 480 m，可在网址后加 `?radius=750`，范围 192–1600 m。调试栏的 B 是累计成功读取的 world 文件大小，不含 JS/HTML。
- 默认市中心框，自定义例：`npm run world -- --bbox 25.275 110.29 25.285 110.30 --output public/sample`。南西北东顺序；需自行提供覆盖对齐后区域的数据。不同框建议用新的空目录，避免残留不再被 manifest 引用的旧块。
- 地面颜色见 `pipeline/palette.json`，修改后重新生成；材质、光照、雾见 `web/src/look/config.ts`。
- 生产包飞越测试：构建后运行 `npx playwright install chromium`、`npm run verify:flight`（已有系统 Chromium 可用 `CHROMIUM=/usr/bin/chromium npm run verify:flight`）。脚本自行启动/关闭本地预览服务，输出首屏与帧时间指标、校验全框逐块加载，截图保存至 `captures/`。采用空浏览器上下文、960×540、SwiftShader；首屏时间从导航开始到画过总览后的下一次动画回调，不把 HTML 文案当首屏。

M1a 默认南界 25.250，包含塔山、穿山和其余 25 座峰。用 `?cam=lijiang`、`palace`、`elephant`、`overview`、`south` 切换启动机位；`foot` 是独秀峰近景。`verify:flight` 保存这六张截图。`uv run --locked python pipeline/check_peaks.py` 从成品检查共享边、高度场、LOD 与属性，输出逐峰高程和面数表。来源见 `pipeline/peaks.json`，地形估算并非测绘值。水面用独立高程层显示，暂无独立水材质、碰撞响应或桥面模型。二进制读取约定见 `docs/chunk-format.md`。
