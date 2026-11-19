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

测试邮箱账号时，准备好 world 和 Chromium 后运行 `npm run dev:full`。该命令构建主站、迁移本地 D1，并仅在本地 Wrangler 日志显示验证码。`npm run test:api` 使用一次性本地数据库；`npm run verify:auth` 测试已构建的 `dist/` 并在 `captures/auth/` 保存三张截图。

部署前须将 `wrangler.toml` 的占位 D1 ID 替换为 `glol` 实际 ID，应用 `migrations/0001_auth.sql`，绑定私有桶 `glol-feedback`，设置 Pages secret `RESEND_API_KEY`。生产不要设置 `EMAIL_DEV_LOG=1`。阶段 1 不使用桶、也不接受反馈上传。

`npm run world` 同时生成 `manifest.atlas` 指向的 gzip JSON 地图数据。按需调用 `loadAtlas(manifest)` 后可使用 `roadAt(x,z,max=18)` 查询路名、`search(query,limit?)` 搜索地标；坐标为场景 x/z 米。`npm run verify:atlas` 在 Node 中验证生成物与查询结果，无需浏览器。

- 桌面：点击画面进入鼠标视角，Esc 释放；WASD 飞行，Q/E 降升，左 Shift 加速。手机：单指转向、双指一起拖动前后/横移。
- 加载半径默认 480 m，可在网址后加 `?radius=750`，范围 192–1600 m。调试栏的 B 是累计成功读取的 world 文件大小，不含 JS/HTML。
- 默认市中心框，自定义例：`npm run world -- --bbox 25.275 110.29 25.285 110.30 --output public/sample`。南西北东顺序；需自行提供覆盖对齐后区域的数据。不同框建议用新的空目录，避免残留不再被 manifest 引用的旧块。
- 地面颜色见 `pipeline/palette.json`，修改后重新生成；材质、光照、雾见 `web/src/look/config.ts`。
- 生产包飞越测试：构建后运行 `npx playwright install chromium`、`npm run verify:flight`（已有系统 Chromium 可用 `CHROMIUM=/usr/bin/chromium npm run verify:flight`）。脚本自行启动/关闭本地预览服务，输出首屏与帧时间指标、校验全框逐块加载，截图保存至 `captures/`。采用空浏览器上下文、960×540、SwiftShader；首屏时间从导航开始到画过总览后的下一次动画回调，不把 HTML 文案当首屏。

默认南界 25.250，包含 27 座具名峰及从 DEM 检出的无名峰（本框 37 座）。用 `?cam=lijiang`、`palace`、`elephant`、`overview`、`south` 切换启动机位；`foot` 是独秀峰近景。`verify:flight` 保存这六张截图。`uv run --locked python pipeline/check_peaks.py` 从成品检查共享边、高度场、400 m 内底面残留、LOD 与量化属性，输出逐峰高程和面数表。具名峰来源见 `pipeline/peaks.json`，自动峰见生成目录的 `auto-peaks.json`；地形估算并非测绘值。二进制读取约定见 `docs/chunk-format.md`。

## 第三人称步行

步行靠近电动车，按 E（手机点「骑行」）上下车。W 加速、S 刹车、A/D 转向；手机用摇杆。到码头按 E 上船，再按一次预约在下一站下船；拖动视角可以看岸景。解放桥有往象山的竹筏，日月湾等码头有四湖画舫。`manifest.vehicles` 引用的停放点、通行范围、码头与水面航线在步行首帧后才加载。生产包验收：`CHROMIUM=/usr/bin/chromium npm run verify:ride`（也可使用 Playwright 自带的 Chromium，不设 `CHROMIUM`）。

重新生成 GL04 世界后，用 `?mode=walk` 从王城正阳门外出发，或用 `?spawn=palace|elephant|lijiang`。V 在当前地点切换飞行与步行。WASD 移动，Shift 跑、空格跳；拖动转向、滚轮缩放、C 切换跟随距离。手机左摇杆推满即跑，右半屏拖动转向。深水区只允许在桥上通行；不能原地站立时在 64 m 内找落脚点，无解时派发 `walk:spawn-failed`。

生产包验收：`npm run world && npm run build && CHROMIUM=/usr/bin/chromium npm run verify:walk`。默认快速版覆盖撞楼、地标、树、栏杆、陡壁、桥和拒水。`verify:walk:full` 保留原有沿街长路线、逐帧检查、截图及帧记录（`captures/walk/`）。角色模型与材质入口在 `web/src/look/avatar.ts`；速度、跳高与相机参数在 `web/src/walk/config.ts`；授权见 `docs/credits.md`。地标构建和街道数据约定见 `docs/landmark-pipeline.md`。

### 实拍同机位与完整回归

在仓库根目录安装依赖（`npm ci`、`uv sync --locked`、`npx playwright install chromium`），准备 `raw/` 及 11 月 OSM 快照，按 `docs/landmark-pipeline.md` 配置原生 gltfpack。Mac 上需确保 Pillow 能打开 `NotoSansCJK-Regular.ttc`（也可把同名字体放在仓库根目录）。

```sh
npm run qa
# 已完成 world、landmarks、build 后，可单独重拍
npm run photo-match -- IMG_1313.jpg IMG_1401 --yaw-offset=-5 --height=1.7
npm run photo-match -- walk-shizijie-wangcheng
npm run photo-match -- --all
# 负载很高的 Linux 主机（SwiftShader 约 0.5 fps）可放宽每张的加载等待，默认 90000
PHOTO_MATCH_TIMEOUT_MS=300000 npm run photo-match -- IMG_1313
```

在 `captures/photo-match/index.html` 查看本次选择的机位。左图是实拍，右图是游戏，点击「50% 叠加」检查轮廓。相机放在 EXIF 坐标处，复用步行物理的支撑面查询，依次取桥面、人行道、地面，并以水位为下限（默认加 1.5 m），标题显示支撑面、支撑高程和相机高程。已知在桥上拍摄且原点落水的照片，仅在 GPS 精度圈内借最近桥面的高度；横向机位保持实测值，并列出借高距离。俯仰固定为 0°，统一正午晴天。正的朝向修正向右转。两张磁北照片（IMG_1425、1426）按拍摄地点与日期的 WMM2025 磁偏角 −3.08° 换算为真北。水平视场角按等效焦距换算，长边最多 960 px。桥面高差、拍摄者仰俯和 GPS 误差都可能影响叠合。

`npm run qa` 依次重建世界、地标与生产包，跑飞行、完整步行、骑行、导览、严格体检及全量照片。当前分支尚无 `audit` 时会在报告中标为跳过。各阶段耗时、浏览器首帧、draw calls 和错误摘要见 `captures/qa/report.md`，同目录保留逐项日志。飞行、步行、骑行和导览断言统一使用 SwiftShader。Mac 的同机位截图使用 Metal。浏览器基线取连续 12 帧，照片步骤按全部机位平均。任一步骤失败或 Mac 上累计超过 40 分钟会返回非零。地标和分享图构建会写入 `public/`，建议在专用工作树运行。
