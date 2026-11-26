# 桂林十字街—正阳片区地下商业街「小香港」调研与建模参数档案

> 本文档服务于 `guilinol-xp-overnight` 项目 `shizijie` 地标地下一层（B1）建模与 [shizijie_underpass.py](../../pipeline/shizijie_underpass.py)、[shizijie.py](../../pipeline/landmarks/shizijie.py)、[shizijie.json](../../public/landmarks/shizijie.json) 联动开发。文中全部商铺品牌及店名均采用基于桂林山水意象的**原创虚构名号**，不含任何现实商业注册商标。

---

## 一、历史渊源与片区空间关系

- **片区定位**：桂林市中心「十字街」是中山中路、解放东路与解放西路交汇的城市商业原点，东接正阳步行街北段，西南紧邻微笑堂片区与中心广场（OSM `relation/way 985734873..985734888`）。
- **「小香港」成因与业态**：1999 年底，配合中心广场改造及中山中路旧城商业迁建，市政修建了人防兼商业用途的大型负一层地下商业街与过街通道系统[1][2]。因开业早期内部划分 A、B、C、D 及中区等高密度格子铺网格，服饰、鞋包、银饰、美妆与小吃小铺比肩林立、灯箱璀璨，颇似上世纪末港风密集商业街景，当地市民遂习称该地下商业系统为**「小香港」**[1][3][4]。
- **南北双段联动结构**：
  - **北段（十字街路口地下环廊，即本专项 `shizijie` 主体）**：承接中山中路 × 解放东/西路行人地下安全过街并兼营格子铺商亭，呈「环形主厅 + 内部交汇小广场 + 四角斜向疏散枝」形制。
  - **南段（中心广场地下商城，`central_square.py` 对位）**：沿中山中路地下向南连接至中心广场下沉步梯及两座标志性钢架玻璃金字塔采光顶[2][3]。

---

## 二、出入口数量、朝向及地面切口坐标对齐

由于十字街地下商业与人防过街网建成年代较早且经历多轮连通改造，现场并未采用现代地铁站的统一数字编号（如「1 号口」等），市民日常主要按**地面道路方位与街角地标大厦**辨识出口[5]。经由真实 OSM 路网（`ways 985734873..985734888`）与地上地标测绘，本路口共设 **4 座街角下沉式主步梯出入口**：

| 序号 | 编号 ID | 象限/方位 | 对应街角与服务方向 | 地面切口中心（`shizijie` 局部 X, Z） | 入口朝向 (`yawDeg`) | 步梯净宽 × 水平投长 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `shizijie_stair_nw` | 西北角 (NW) | 南方大厦前广场 · 通往解放西路北侧与中山北向 | `(-22.50, -38.80)` | `+72.0°`（面向 WNW / 广场西口） | `3.4 m × 9.0 m` |
| 2 | `shizijie_stair_ne` | 东北角 (NE) | 解放东路路口 · 通往正阳步行街北口与东巷方向 | `(+43.00, -23.00)` | `-45.0°`（面向 NE / 解放东路） | `3.4 m × 9.0 m` |
| 3 | `shizijie_stair_se` | 东南角 (SE) | 文化大厦前 · 通往正阳步行街南段与中心广场北缘 | `(+22.50, +46.50)` | `-158.0°`（面向 SSE / 中山中路） | `3.4 m × 9.0 m` |
| 4 | `shizijie_stair_sw` | 西南角 (SW) | 广场西南街角 · 通往解放西路南侧及依仁路方向 | `(-46.20, +21.50)` | `-131.2°`（面向 WSW / 街角前庭） | `3.2 m × 8.8 m` |

- **地面切口咬合规范**：
  - 上述 4 处开口的矩形轮廓（外扩 `0.05 m` 接缝余量）已由 `shizijie_underpass.py` 生成至 `manifest.groundCutouts`，并在 `shizijie.py`（NW / NE / SE 广场垫层）、`nikoniko.py`（SW 广场垫层）及路网地块 `101_38.glc` 同步完成地面孔洞裁剪与防误入护柱设置（口部 `-Z` 设 3 根间隔约 `0.95 m` 不锈钢红顶防车石柱，仅容步行穿行、拦截电动车冲入楼梯）。

---

## 三、通道走向、净高与空间尺度

1. **平面通道系统**：
   - **中央环形商业大厅（OSM `way/985734888`）**：外廓尺度约 `43.6 m × 44.9 m`（局部 `x ∈ [-23.23, +20.40]`，`z ∈ [-20.19, +24.74]`），主环廊通行半宽 `2.8 m`（不含两侧店面进深），中庭设 4 根八角形水磨石结构柱与中央回字岛区。
   - **内部交叉轴线（OSM `ways 985734877..985734886`）**：呈近似南北向 + 东西偏转十字轴线贯穿环厅内部，并与 4 座步梯底部集散厅（`connectors`）直接贯通，形成无死角的环状寻逛闭环[4][5]。
   - **通道宽度**：主过街联廊设计基准宽 `4.4–4.6 m`（`halfWidth = 2.3 m`，楼梯衔接段 `2.2 m`）；两侧布置格子铺货柜与门楣后，实测舒适双股客流净宽保持在 `3.0–3.8 m` 之间，还原早年「小香港」紧凑热闹但不断流的穿行体验[3][6]。
2. **垂向层高与净空**：
   - **建筑层位**：负一层单层（B1）[7]。
   - **底板标高**：相对于十字街地面基准 `SHIZIJIE_SURFACE_Y = 151.30 m`，B1 完整地坪设于 `floorY = -4.20 m`（对应城市世界高程 `147.10 m`）[8]。
   - **净层高**：早期人防商业体原始结构净高多在 `3.2–3.8 m` 区间，扣除顶面风管、消防管线与吊顶龙骨及灯箱压低后，室内有效净空偏紧凑，取 **`3.15–3.25 m`**[6][7]：
     - 主廊道吊顶基准高度：`y = -1.05 m`（室内净高 `3.15 m`）；
     - 吊顶铝合金格栅与悬吊导视灯箱底缘：不低于 `y = -1.70 m`（距离地坪净空 `>= 2.50 m`，防人物/相机视角磕碰）。

---

## 四、店铺隔间排布与原创虚构店名

根据老桂林地下街区「小面积格子铺紧密咬合 + 卷帘门备用格间插花分布」特征[3][6]，模型沿环形大厅外周与十字通道节点布置了 **32 个商业铺位模块（每单元标准面宽 `2.8 m × 门高 2.8 m × 隔间进深 2.6 m`）**，辅以中央环岛微亭及墙面导视灯箱：

1. **16 间亮灯营业格子铺**（全部采用原创杜撰店名，含橱窗陈列台、门框壁柱与门头发光招牌）：
   - `SH-01` **小香港 · 漓江米粉**（暖橙 `#e65100`）：地方粉面快食窗口
   - `SH-02` **桂林三宝手信坊**（绛红 `#b71c1c`）：地方伴手礼盒展示架
   - `SH-03` **阳朔鲜果茶饮**（翠青 `#00695c`）：现调鲜果与冰茶档口
   - `SH-04` **正阳潮玩盲盒社**（绛紫 `#6a1b9a`）：潮玩展示柜与胶囊机
   - `SH-05` **潮流数码配件站**（海蓝 `#1565c0`）：手机壳膜与音频线材格
   - `SH-06` **港式冰室甜品屋**（莓粉 `#ad1457`）：丝袜茶饮与鸡蛋仔窗台
   - `SH-07` **复古黑胶与明信片**（青灰 `#37474f`）：黑胶碟片与桂林手绘明信片
   - `SH-08` **手作银饰工坊**（褐金 `#4e342e`）：手工锻打银饰与玉石摆件
   - `SH-09` **二次元谷子集市**（靛蓝 `#283593`）：徽章立牌打卡格子架
   - `SH-10` **精品美妆集合店**（茜粉 `#c2185b`）：香氛与彩妆试色柜
   - `SH-11` **街头运动潮鞋馆**（炭黑 `#212121`）：鞋墙灯箱陈列隔间
   - `SH-12` **象山文创纪念馆**（青蓝 `#00838f`）：地方风物文创与印章本
   - `SH-13` **手工鲜奶麻薯铺**（姜黄 `#f57f17`）：现烤糕点与糯米果脯档
   - `SH-14` **眼镜快配工坊**（晴蓝 `#0277bd`）：复古板材镜架陈列栏
   - `SH-15` **港风复古穿搭馆**（深紫 `#4a148c`）：街头男装女装衣架区
   - `SH-16` **24H地下便利店**（苍绿 `#2e7d32`）：日用饮料与便携伞具角店
2. **16 间预留波纹卷帘铺位**（`XH-01` ~ `XH-16`）：镀锌横纹灰银卷帘门配黄色门牌招租灯条，还原商业调整期真实留白感[8][9]。

---

## 五、灯箱与招牌风格规范

1. **视觉体系**：
   - **门头横幅发光灯箱**：紧贴铺位门楣上方（`y = -1.80 m .. -1.20 m`），采用高反差港风双语底板与描边衬线/黑体大字，夜晚及地下暗场经 `shizijie_shop_signs` 自发光通道渲染，不增设任何动态 `PointLight`。
   - **伸出式双面侧招灯箱**：沿主过街通道与环廊隔间柱侧垂直挑出 `0.48 m`（宽 `0.86 m × 高 0.56 m`，下缘高于地面 `2.30 m`），形成老「小香港」层叠错落的视觉纵深[4][9]。
   - **悬吊导视出口灯箱**：于 4 个步梯入厅口及中庭十字交汇点悬吊宽幅双面引导牌（「`出口 ↑ 中山中路`」「`出口 ↑ 解放东路 / 正阳步行街`」「`出口 ↑ 解放西路`」「`十字街地下商业街 · 小香港 B1`」），采用深松烟绿配琥珀金字框，兼具地下寻路功能与时代质感。
2. **显存与合规红线**：
   - 所有新增地下格子铺、挑出灯箱与导视贴图全部复用现有 `1024 × 1024` `shizijie_shop_signs` 图集底部未占用区块（`y = 784..1024`）及集团共享 `B_surfaces` / `B_surfaces_lit` 材质，不新增高分辨率位图，确保 `shizijie.glb` 总 KTX2 GPU 显存严格维持在 `4.0 MB` 预算红线以内。

---

## 六、参考来源（Sources）

1. 中国天气网（桂林中心广场建筑规模、1999年建成背景及地下商业配套玻璃金字塔出入口记述）：https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEfqjrdpuyLRhCFfzREaXHZh_LSyqrH3UdUm7126K4SoI4ieLGKQkTFkTNz8F4k_BT6rA2FMEgkqvAehL5cKxnDDb8uz170K6CwiDwBN81V-fTs2oyiSa70QVVJ4bz1M9zSLIwOxSBb
2. 桂林国旅都市游指南（中心广场与「小香港」A/B/C/中区分区及早期百货服饰市井特征）：https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEGNVfC3l8UGqorAWlDz-AtWwnuvQGAHji0M3qawGoGqpIWBH9gTcHoRhb0vYR9CB4D_evzleGIlTW2CsgQexkZFxzNQntlF8tCOMMarVrbr402qWXhWO0ajartvudTAhYVGh48cPNeflU2BYIu71wd
3. 桂林市中心十字街及正阳街地下商业历史与形态记述（格子铺尺度、通道宽度、层高特征及灯箱风貌）：https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFuP5EKaYtaulFykBl7Qt0O8Aa_hm6V5yV4e4mbiDHMbr6igCksh2mA8m7kuPZlJWqnIUQ3Plt310RpHuVjVbrAHGXKwsl7-0O5V_WWTEW33UvOvMoIY_HByXTH7lZLLODKd2Su4izakw_Z3gKMmJCC7lfCVwQXMooGLDHuYkqmiVTdsC0LCE_tnH1XY4U2
4. 十字街地下人行通道出入口无统一数字编号、以地面商厦及道路方位引路说明：https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFRTBcec2muiWkFtFuw-l3zUJHoSh4pWEV3OSbHrGCYoD_01s1CnqSRkq3fqSejEewXkoPBuY2dozF-6zKZ7Z1TwzdHJg7EZ-B7LSbOlcTPkWpP-ehtdF9STjB94xV1dk9h_oCIdGu2gW8U7I_j-Rh2DudiLZdkq_7HO0e26hqA5wYt9VUMQVNSLcnK1Bg=
5. 网易新闻地方商业档案（中心广场负一层地下铺面体量与空间结构特征）：https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFn33R61xFA8sSJQfCk3UGBYaO3l2fwIH4-karenbUUP_88VnT1bHE76U8J32yCpHJGyYopLZroBJrOWVGtqRLw80_yKFD4w5Lj-AxJ_xJ3nWcXyTiEDMYwfRhAtVOTFFH2MCjCoN_89E8k
6. 搜狐城市观察（十字街地下商业街与通道灯箱、铺面招租及存量更新背景）：https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQH9tLl1NAgEiLEgSrmfN7bjLVmcPs301s_3Zsi2lXkRbwaKcUi79-3K7TgiP4Mokx5gNPtvs62-cEPH2tlXnd-VS9-f4GGDyog1VFoklVc5ylVckMvGE55OH3SFfBQch9M=
7. 桂林生活网（十字街核心商圈与八桂、微笑堂、正阳路区位关系）：https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGHEgXTkfNkACpkCzDTRr5578mI5N3BX4ZEYV0Lmwi5Ny-3egT740yZNL5w08CVRFucUL0m5PEkEcHkLabcm73ugfyXtYJ9QTRsgn0Jw7nX8DNzYpCs5ghDaTPq3wqHkBF91h9jLhC81HvCtRuA-yTFO80R
8. 维基百科（正阳步行街地理边界与片区走向）：https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFQRwC4oXuzZ72YAYC20up3ZhGBCPxL-2XnjMucggsg7LkEqmCj8LjKs_Mb8VZJbh0MWixpJitTzAHwFQeTpJAURJdMo_SkKWmIEcZjegVTmy8vyf_txonNTxl2jpg7y-0hCosoZ-hJkFTWE56TOXRHUQNwHAMyFriGyLWG8y78B5KR
9. 本项目实测路网与地形几何数据：`raw/osm-2026-11.json`（`ways 985734873..985734888`）、`pipeline/shizijie_underpass.py`、`pipeline/landmarks/shizijie.py`。

---

## 七、Playwright 实机视觉验收与问题闭环归档

> 验收环境：`http://127.0.0.1:5176/?verify&mode=walk`（脚本 `/tmp/inspect-shizijie-underground.mjs`，CDP `9222` 优先、无残留进程、`ERRS = []`），地下内景使用第一人称视角（绕过 `web/src/walk/camera.ts:103-106` 第三人称地表射线夹升问题）实测已重打包的 `public/landmarks/shizijie.{glb,json}`（`ktx2VRAM = 3.67 MB <= 4.00 MB`、`non_ktx2 = 0`、`audit_landmarks.py --strict` 通过）。

### 1. 四入口与主通道 / 商铺实拍截图清单（共 12 张，0 破面 · 0 真实商业商标）

| 编号 | 机位/视角 | 实测坐标与高程 (`camY`) | 结论 | 截图路径 |
| :--- | :--- | :--- | :--- | :--- |
| `01` | 西北 (NW) 地面入口与南方大厦悬挑底面 | 地面 `foot=151.48m` (`camY=153.13m`) | `PASS` | `/tmp/shizijie-ug-qa/01-entrance-nw.png` |
| `02` | 东北 (NE) 地面入口及门楣 | 地面 `foot=151.59m` (`camY=153.25m`) | `PASS` | `/tmp/shizijie-ug-qa/02-entrance-ne.png` |
| `03` | 东南 (SE) 地面入口（已避让樟树遮挡） | 地面 `foot=151.59m` (`camY=153.25m`) | `PASS` | `/tmp/shizijie-ug-qa/03-entrance-se.png` |
| `04` | 西南 (SW) 地面入口（跨界 `nikoniko.py:1381`） | 地面 `foot=151.68m` (`camY=153.34m`) | `跨界登记` | `/tmp/shizijie-ug-qa/04-entrance-sw.png` |
| `05` | B1 西北 (NW) 楼梯出口正面与独立灯箱 | 地下 `foot=147.18m` (`camY=148.79m`) | `PASS` | `/tmp/shizijie-ug-qa/05-ug-nw-portal-lightbox.png` |
| `06` | B1 北侧环形商业通道与 `B1-01`/`XH` 卷帘 | 地下 `foot=147.18m` (`camY=148.79m`) | `PASS` | `/tmp/shizijie-ug-qa/06-ug-ring-north-shops.png` |
| `07` | B1 中庭核心区全景（八角包柱与交叉吊顶灯架） | 地下 `foot=147.18m` (`camY=148.79m`) | `PASS` | `/tmp/shizijie-ug-qa/07-ug-atrium-core.png` |
| `07b` | B1 南侧商铺特写（`B1-09`/`B1-10`/`XH` 卷帘） | 地下 `foot=147.18m` (`camY=148.79m`) | `PASS` | `/tmp/shizijie-ug-qa/07b-ug-south-shops-closeup.png` |
| `08` | B1 东侧走廊主商铺（`B1-05 潮流数码配件站`） | 地下 `foot=147.18m` (`camY=148.79m`) | `PASS` | `/tmp/shizijie-ug-qa/08-ug-corridor-east.png` |
| `08b` | B1 东北 (NE) 楼梯出口与封檐门洞灯箱 | 地下 `foot=147.18m` (`camY=148.79m`) | `PASS` | `/tmp/shizijie-ug-qa/08b-ug-corridor-ne.png` |
| `09` | B1 东南 (SE) 楼梯出口正面与独立灯箱 | 地下 `foot=147.18m` (`camY=148.79m`) | `PASS` | `/tmp/shizijie-ug-qa/09-ug-stair-se-portal.png` |
| `10` | B1 西南 (SW) 走廊正面与 SW 出口灯箱 | 地下 `foot=147.18m` (`camY=148.78m`) | `PASS` | `/tmp/shizijie-ug-qa/10-ug-stair-sw-portal.png` |

### 2. 本轮模型闭环修复与跨领地 `SHARE+` 转交项

- **`shizijie.py` 已修并实机通过（本组独占领地）**：
  1. 沿 `walkPolygon` + 32 格间外扩包络补全闭合围墙与 `-1.11m` 连续天花吊顶（带 4 个梯井洞口与 `soffit_quad` +Y 法线防 `hidden_faces.py` 误删），100% 消除 B1 绿地/天空露空与梯洞边缘杂散碎面；
  2. 为 4 座梯井增加内衬侧壁、梯底实体封堵与 `1.44m` 深色封檐罩，消除 `08b` NE 白色三角凸片及 `10` SW 右上黑缺角；
  3. 给中庭 4 根八角柱包裹 `r=0.72m` 石材底座（彻底覆盖 `tunnels.ts:614-615` Z-fighting），全廊道横栅接入连续纵梁并增设昼夜可见自发光材料 `ug_interior` / `ug_lamp_cove` / `shizijie_shop_signs`（复用现有图集，0 额外显存）；
  4. 扩充底部贴图排布，使 `B1-01..B1-16` 共 16 间原创虚构商铺与 `NW`/`NE`/`SE`/`SW` 四角独立出口灯箱、`预留 · XH 招租` 卷帘全部独立不重复且清晰无裁字，零现实商业注册商标（仅见合规城市地标「南方大厦」「文化大厦」「微笑堂商厦」）；
  5. 东南口路侧樟树由 `(24.0, 56.5)` 移至 `(14.0, 59.5)`，解除 SE 雨棚门楣遮挡；南方大厦西北圆形悬挑底面补充灰白涂装底板。
- **非本组领地 `SHARE+` 转交整合步**：
  1. `web/src/walk/camera.ts`（第 103–106 行）：第三人称相机用 `sidewalk`/`road` 夹高，玩家在 B1（`foot ≈ 147.1m`）时被强拉回地表 `151.75m`，应按 `underpassFloor` 判地下穿行豁免地表夹升；
  2. `pipeline/landmarks/nikoniko.py`（第 1381 行）：SW 雨棚需补 `header_sign_key='ug_portal_main'` 与 `01/02/03` 一致；
  3. `web/src/tunnels.ts`（第 565、614–615 行）：补齐 `wallOpenAt` 对环形广场边界及 `正阳潮玩盲盒社` 处短墙清理、`band` 偏移 `0.015m` 去 Z-fighting，及 `corridors/connectors` 对 `stair_holes` 裁剪；
  4. `dist/` 构建同步：待整合时执行 `npm run build` 将新版 `public/landmarks/shizijie.{glb,json}` 同步到预览目录。
