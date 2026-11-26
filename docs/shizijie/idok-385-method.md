# IDOK-385 实景参考采集与真景对比方法手册（十字街 B1 复用版）

本文基于 Multica `--profile idoknow` 拉取的 **IDOK-385**（及其子单 `IDOK-408`、`IDOK-409`、前置工具单 `IDOK-308`、十字街地面参照单 `IDOK-410`）与已验收本地参考仓 `/Users/pan-work/guilinol-sanduo-opt`（`feat/sanduo-pilot @ 5489b953`）整理，供 **Hy1（实景采集与 `reality-spec.md`）**、**Hy2（高质感灯箱牌面与材质图集）**、**Gemini / Carbon（氛围与运行时）** 及 **Neon（`--compare` 实景对比验收）** 直接复用。

---

## 1. Multica 工单溯源

- **查询命令**（注意 Multica 工作区在 `idoknow` profile 下）：
  ```bash
  /Users/macbook/.local/bin/multica --profile idoknow issue get IDOK-385 --output json
  /Users/macbook/.local/bin/multica --profile idoknow issue children IDOK-385 --output json
  /Users/macbook/.local/bin/multica --profile idoknow issue get IDOK-308 --output json
  ```
- **参考父单与子单**：
  - `IDOK-385`（`01a213d7-bcb1-7235-a5ee-8946d4ece48d`）：`[py / Neon+neon] 城市建设细节优化与全开放地图铺开（v1+ 样板过关，从中区向外正式开工）`
  - `IDOK-408`（`01a21425-163b-75ba-8b85-a1e535239954`）：城建 v1+ 引擎底座与 512m 分片接入 + 中区核心老城 R1
  - `IDOK-409`（`01a21425-5076-759d-9c40-66d29c6b5878`）：全城离线管线 + 64–96 款一店一色招牌库 + R2/R3 扩散生成
  - `IDOK-308`：多渠道自动化实景参考包（百度真北全景 + B 站 `videoshot` + Wikimedia + 本地 Overture）
  - 本地已验收参考 worktree：`/Users/pan-work/guilinol-sanduo-opt`（分支 `feat/sanduo-pilot`，提交 `5489b953`）

---

## 2. 本轮新建十字街 B1 真实化 Multica Epic 与 Stage 链

全部创建于项目 `Guilin Online · 网上桂林`（`156530de-f51c-40d8-91e9-e7174ac069ad`，profile `idoknow`，状态 `backlog`）：

| 层级 | Key | UUID | Stage | 阻塞关系（`blocked_by`） | 核心交付 |
| --- | --- | --- | --- | --- | --- |
| **Epic** | `IDOK-413` | `01a2146d-0910-7a6a-b47d-cad265a5403d` | — | — | 十字街 B1 真实化总控（Route A + 天花板悬挂导视牌 + 实景对比法） |
| **Stage 0** | `IDOK-414` | `01a2146d-9145-7747-ad6a-47f19677203e` | `stage 1` | `[]` | `b1-real/` ≥20 张地下通道实景照（含 ≥5 张天花板吊牌）+ `docs/shizijie/reality-spec.md` + `layout` 单测 |
| **Stage 1** | `IDOK-415` | `01a2146d-991f-7050-a37e-1f9a13ff7942` | `stage 2` | `IDOK-414`（`manual`） | `web/src/shizijie/wayfinding/` 天花板悬挂导视牌最短路寻路 + `web/src/shizijie/look/` 1:1 灯箱牌面图集与降饱和真实材质（全进程 ≤8MiB） |
| **Stage 2** | `IDOK-416` | `01a2146d-a0fd-7055-8b6b-275c75d68478` | `stage 3` | `IDOK-415`（`manual`）、`IDOK-414`（`stage`） | `web/src/shizijie/atmos/` 氛围（≤12 drawCalls / ≤40k tris）+ `runtime` 接入 + `verify-shizijie.mjs --compare` ≥7 张真景-渲染对比接触表与 `signVisible`/`signReadable` 验收 |

复核命令：
```bash
/Users/macbook/.local/bin/multica --profile idoknow issue children IDOK-413 --output json
/Users/macbook/.local/bin/multica --profile idoknow issue get IDOK-415 --output json
/Users/macbook/.local/bin/multica --profile idoknow issue get IDOK-416 --output json
```

---

## 3. IDOK-385 多渠道实景采集步骤与脚本

### 3.1 采集工具与预设文件
- 仓库标准入口：`npm run refpack -- ...`（对应 `package.json` 中的 `uv run --locked python pipeline/fetch_city_ref.py`）
- 仓库脚本与预设：
  - `/Users/pan-work/guilinol-xxg/pipeline/fetch_city_ref.py`
  - `/Users/pan-work/guilinol-xxg/pipeline/refpack-presets.json`
  - `/Users/pan-work/guilinol-xxg/docs/refpack.md`
- 独立副本（无需仓库根 `raw/` 护栏时可参考其算法）：`/Users/pan-work/z-test/shizijie-ref-pack/fetch_city_ref.py`

### 3.2 四大核心渠道与适用边界
1. **百度地图 POI + 百度全景（`z=4`, `4096×2048` 等距柱状投影）**
   - 坐标链：`WGS84` → `GCJ-02`（`wgs84_to_gcj02`）→ `BD-09` → 百度墨卡托平面米（`wgs_to_mc`）→ 查询 `mapsv0.bdimg.com/?qt=qsdata`（搜索半径 300m）→ `qt=sdata` 取真实机位坐标与 `NorthDir` → 并发拉取 `qt=pdata` 32 块 `512×512` 瓦片（`8×4`）拼合全景。
   - **真北校准反投影公式**（`equirect_to_rectilinear`，`fov=90°`、`pitch=6°`、`960×640`）：
     ```python
     x_pixel = (((NorthDir + true_azimuth_deg) % 360.0) / 360.0) * equirect_width
     ```
     自动生成 `N (0°) / E (90°) / S (180°) / W (270°)` 四向透视图、2×2 带标题合图 `*_4views_sheet.jpg`，以及 `--check-bearing way/<ID>` 指向校验图 `*_bearing.jpg`。
   - **边界提醒（十字街地下 B1 关键）**：百度街景车仅覆盖地面机动车道，适合核对 4 处梯井雨棚、围栏与周边地标；**地下通道内部必须叠加 B 站步行街/地下街视频帧与公开实拍图文补齐**。
2. **B 站街拍 `videoshot` 故事板自动抽帧（街景车盲区主力）**
   - 免下载整段视频，直接请求 B 站 `videoshot` 接口获取雪碧图（`*_sheet_*.jpg`），按亮度过滤纯黑帧并等距提取关键帧拼成 `*_keyframes_sheet.jpg`。
   - 最适合抓取**十字街地下人行通道内部实景、天花板悬挂式背光指示牌、格栅吊顶、地砖反光、铺面卷帘门与柱面装饰**。
3. **Wikimedia Commons（免登录 + 完整许可/GPS 元数据）**
   - `geosearch`（半径 `1200m`）+ 关键词检索，请求限速 `>= 1.5s`，输出 `1920px` 图与 `license` / `gps` / `url`。
4. **本地 Overture + OSM 缓存优先**
   - 优先筛选本地 `raw/overture_buildings.csv` 与 `raw/osm*.json`，缺失时再回退 Overpass 镜像（首选 `https://maps.mail.ru/osm/tools/overpass/api/interpreter`）。
- **已验证避坑项（来自 `IDOK-308`）**：
  - 不批抓 720 云（API 401 且前端带广告/付费遮挡）；
  - 不裸连高德网页接口（触发滑块风控，无个人 Key 时跳过）。

### 3.3 标准采集命令（可直接复现）
```bash
# 1) 十字街默认预设（地面四向全景 + 指向校验 + B站 BV1GuW9zJEQT 抽帧 + Wikimedia）
cd /Users/pan-work/guilinol-xxg
npm run refpack -- --preset shizijie --check-bearing way/253743030

# 2) IDOK-385 三多路多锚点街景实测样式（百度墨卡托 dx,dy 米级偏移）
npm run refpack -- \
  --name sanduo-pilot \
  --query 三多路 \
  --lat 25.28045 --lon 110.2882 \
  --anchors 'weixiaotang_nw:-20,90;weixiaotang_back:-110,80;sanduo_west:-240,70;sanduo_mid:-80,0;sanduo_rongyin:10,-20' \
  --check-bearing way/253743030

# 3) 十字街地下 B1 专项视频抽帧（指定地下通道实拍 BVID）
npm run refpack -- \
  --name shizijie-b1-video \
  --query 桂林十字街地下通道 \
  --lat 25.28144732 --lon 110.29083564 \
  --bvid <实拍BVID>

# 4) 十字街 B1 真景 vs 渲染对比接触表与吊牌可读性验收（Neon 交付）
node scripts/verify-shizijie.mjs --compare --out /Users/pan-work/z-test/shizijie-compare
```

---

## 4. 输出路径与产物格式规范

| 路径 | 归属/用途 | 目录结构与格式 |
| --- | --- | --- |
| `/Users/pan-work/guilinol-sanduo-opt/raw/refpack/sanduo-pilot/run-sku25t5h/` | IDOK-385 已验收样板参考包（只读） | `index.json`（含 `query`/`anchor_wgs84`/`channels.{baidu_poi,overture,osm,baidu,bearing,wikimedia,bilibili}`）、`*_N/E/S/W.jpg`、`*_4views_sheet.jpg`、`*_bearing.jpg`、`wikimedia/*`、`bilibili/*` |
| `/Users/pan-work/guilinol-sanduo-opt/raw/refpack/sanduo-kuiguang-ref/run-223d591w/` | IDOK-385 补拍街景参考包（只读） | 同上 |
| `/Users/pan-work/z-test/shizijie-ref-pack/` | 十字街既有地面参考包（只读） | `index.json`、`README.md`、`baidu_pano_views/`（中心/解放东/解放西四向全景）、`bilibili/BV1GuW9zJEQT_*`、`wikimedia/` |
| `/Users/pan-work/z-test/shizijie-ref-pack/b1-real/` | **本轮 Stage 0（Hy1）地下通道内部实景包** | `>=20` 张地下通道内部实拍图（含 `>=5` 张天花板悬挂指示牌）+ `index.json`（每条含 `file`、`url`/`source_url`、`capture_date`、`license`、`tags`/`shows_ceiling_sign`、`viewpoint`） |
| `/Users/pan-work/guilinol-xxg/docs/shizijie/reality-spec.md` | **本轮 Stage 0（Hy1）量化现实规格书** | 天花板吊牌挂高/尺寸/底色/字号、吊顶格栅、地砖/墙砖色值、灯具色温间距、商铺立面规格，逐项附 `b1-real/` 图片引用 |
| `/Users/pan-work/z-test/shizijie-compare/` | **本轮 Stage 2（Neon）真景 vs 渲染对比输出** | `>=7` 张左右并排对比接触表（`compare-01-*.png` 等，左侧标注实景图来源、右侧实时 WebGL 渲染 + 机位/吊牌可读性指标）+ `report.json`（含 `compareSheets`、`signVisible`、`signReadable`、4 口动线与 48 NPC 预算） |

---

## 5. IDOK-385 落地视觉与工程铁律（Hy2 / Gemini / Carbon 必守）

1. **降饱和校准（抵消 `look.gradeDay` `saturation: 1.22`）**：禁止荧光绿、电光蓝或高饱和塑料纯色块；金属边框、卷帘门、吊顶、导视基板均需混入中性灰控制饱和度上限，暗面保留自然漫反射补光避免死黑。
2. **灯箱与材质真实质感**：
   - 天花板悬挂导视牌采用**深灰/拉丝金属边框 + 顶部双吊杆 + 正面均匀内透自发光灯箱面**（中英文出口名称 + 方向箭头），按 `1:1` 像素密度由 `wayfinding` 数据生成，保证 `2.3m` 挂高下 `10m` 外清晰可读、不白爆不糊字；
   - 地面/墙面/商铺门头借鉴 IDOK-385 的微旧化、拼接缝与顶部挑檐接触阴影，杜绝“贴纸感”。
3. **纹理与 UV 规范**：涉及 PBR 数据贴图保持纯不透明 RGB（无 Alpha 预乘污染），确认正面朝向与 UV 手性避免反字/镜像；全进程十字街 GPU 纹理总额严格 `<= 8 MiB`。
4. **实景-渲染并排盲审闭环**：效仿 IDOK-385 附件 `01_sanduo_north_compare.jpg`–`04_sanduo_aerial_compare.jpg`，每个核心地下机位均需输出「左实景 / 右渲染」对比接触表，人工/视觉 QA 逐张盲审修净后再收口。
5. **版权红线（`docs/style.md` & `docs/refpack.md`）**：百度全景、B 站视频帧、720 云与非 `CC0` 网图**仅存放于本地忽略目录（`raw/refpack/` 或 `/Users/pan-work/z-test/`）供读比例、配色、字号与构造参考，严禁裁切作游戏贴图或提交入仓库**；所有正式入仓贴图 100% 程序化原创或经核验的 `CC0` 素材并登记在 manifest 中。
