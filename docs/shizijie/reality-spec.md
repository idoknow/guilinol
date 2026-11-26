# 桂林十字街地下商业街（B1）量化现实规格书（Reality Spec）

> **依据来源**：全部测量值与构造规制均直接提取自 `/Users/pan-work/z-test/shizijie-ref-pack/b1-real/index.json` 所载 **33 张桂林十字街 / 小香港地下通道 B1 内部实拍**（0 张纯地面视图、0 张外地商场，含 **10 张**明确拍及天花板公共导视 / 出口灯箱 / 门梁 LED 矩阵图），并结合同地段实地文字纪要（`travel.sohu.com/a/788304412_137546`, `2024-06-25`）及 [IDOK-385 方法手册](./idok-385-method.md) 口径校核。
> **版权边界**：`b1-real/` 全部网图仅作几何比例、色值、灯箱版式与灯光参考（`Reference-Only`），**严禁裁切用作运行时纹理或提交至 `web/public/`**；所有入仓 3D 资产均由程序化生成或 `CC0` 原创绘制。

---

## 一、地下空间拓扑、尺度分级与「45° 偏转迷宫」成因

1. **地上—地下「双十字 45° 旋转」与 8 口命名体系**
   - 实地特征：地面十字街由中山中路 × 解放东/西路正交构成；地下主环廊与对角通道**相对地面十字偏转约 `45°` 错位**，加上中心环岛/四向交叉口周边共有 **`8` 个编号步梯出入口（`①–⑧号口`）**，行人下楼后极易丧失绝对方位感，形成「下梯 → 转弯至中央枢纽抬头读吊牌 → 对号去向 → 再折返找对应出口梯口」的典型寻路动线。
   - 实景对照 4 组角点 `8` 口（游戏内浓缩为 `NW / NE / SE / SW` 4 座主梯井，对应实际双口配对）：
     | 实拍门牌编号 | 牌面真实地标与路名文案 | 对应游戏梯井 | 实拍引用 |
     | --- | --- | --- | --- |
     | `①②号口` | `微笑堂 / 阳桥 / 艺术馆` | `SW` (`sw`) | [01_hub_exit12_56_led_matrix.png](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/01_hub_exit12_56_led_matrix.png), [05_hub_curved_119_columns.jpg](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/05_hub_curved_119_columns.jpg) |
     | `③④号口` | `文化大厦 / 中心广场 / 中山中路 / 解放桥` | `SE` (`se`) | [03_portal_exit34_archway.jpg](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/03_portal_exit34_archway.jpg), [02_hub_exit78_56_lightbox.jpg](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/02_hub_exit78_56_lightbox.jpg) |
     | `⑤⑥号口` | `大世界 / 解放东路 / 中山北路 / 桂林电影院 / 七星公园` | `NE` (`ne`) | [01_hub_exit12_56_led_matrix.png](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/01_hub_exit12_56_led_matrix.png), [02_hub_exit78_56_lightbox.jpg](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/02_hub_exit78_56_lightbox.jpg), [04_corridor_exit6_dualrod_signs.png](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/04_corridor_exit6_dualrod_signs.png) |
     | `⑦⑧号口` | `南方大厦 / 新华书店 / 解放西路` | `NW` (`nw`) | [02_hub_exit78_56_lightbox.jpg](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/02_hub_exit78_56_lightbox.jpg) |

2. **空间尺度四级分类（通道净宽 × 吊顶净高）**

| 空间等级 | 通道净宽 (m) | 吊顶净高 (m) | 地面主材与特色设施 | 实拍引用 |
| --- | --- | --- | --- | --- |
| **中心枢纽大厅 (`central_hub` / `atrium_hall`)** | `5.0 – 8.5` | `3.00 – 3.50`（局部电玩敞顶 `3.40 – 3.80`） | 八角星/菱形灰白水磨石拼花、成对 `Ø0.8–1.0m` 包广告圆柱、3–4 联不锈钢连排椅、局部 2–4 级变高台阶 | [01](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/01_hub_exit12_56_led_matrix.png), [02](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/02_hub_exit78_56_lightbox.jpg), [13](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/13_xxg_split_steps_bidirectional_exit.jpg), [26](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/26_hall_leasing_stringlights_columns.jpg), [29](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/29_xxg_atrium_glass_partition_plinth.jpg), [30](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/30_xxg_hall_split_2step_transition.jpg) |
| **主过街环廊 (`main_corridor`)** | `3.2 – 5.0` | `2.85 – 3.20` | `600×600mm` 银灰铝扣板满吊 + 双排平板灯、成排双杆导视/品牌吊牌 | [04](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/04_corridor_exit6_dualrod_signs.png), [12](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/12_xxg_stairwell_green_exit_sign.jpg), [17](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/17_xxg_aluminum_ceiling_dualrow_led.jpg), [27](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/27_xxg_corridor_3m_spacing_panels.jpg) |
| **档口/数码维修支廊 (`booth_corridor`)** | `2.5 – 3.8` | `2.80 – 3.05` | `600×600mm` 扣板/矿棉顶 + 连续灯盘、腰高开放玻璃修机柜台、黄黑门槛胶带 | [10](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/10_corridor_phone_repair_sign_frame.jpg), [19](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/19_xxg_menswear_c57_benches.jpg), [20](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/20_corridor_phone_era_facade.png), [23](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/23_corridor_low_led_panel_phones.jpg), [24](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/24_corridor_narrow_glass_boutique.jpg) |
| **老区窄巷 (`secondary_alley`)** | `1.8 – 2.6` | `2.50 – 2.90` | 局部裸露漆面混凝土梁 + 明装双管 T8 日光灯、垂直悬伸店招小灯箱、单排小筒灯/格栅 | [07](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/07_alley_toilets_dualrod_troffer.jpg), [22](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/22_shop_bag_hat_open_beam_batten.png), [25](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/25_corridor_narrow_red_booth_signs.jpg), [31](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/31_legacy_narrow_lane_fluorescent.jpg) |

> **布局契约校核**：当前 `web/src/shizijie/layout/shizijie-b1.layout.json` 设 `ceilingHeight = 3.15 m`（落在核心厅与主廊 `2.85–3.50 m` 中位数区间，兼容 `SZJ_SIGN_SPEC.bottomY = 2.30 m` 留空与 `SZJ_ATMOS_BUDGET.minSignClearanceY = 2.75 m`）；走廊净宽覆盖主环 `5.6 m` 与支廊 `2.8–4.0 m`，与实测高度吻合。

---

## 二、天花板悬挂导视牌系统（`k3 / k4` 核心专项规格）

桂林十字街地下通道天花导视分为**四类层级结构**，严禁单一“纯深绿条牌”一刀切：

### 2.1 四类实景导视规格表

| 导视层级 | 安装位置与间距 | 尺寸与吊挂净高 | 外框与底色/字体规范（降饱和防爆白建议值） | 吊杆/固定件 | 实拍引用 |
| --- | --- | --- | --- | --- | --- |
| **L1 · 枢纽横梁 LED 点阵/复合总牌** | 十字交叉口/八角厅主跨柱横梁；`4–6 m` 跨梁居中 | 宽 `2.60 – 4.20 m`、高 `0.45 – 0.65 m`、厚 `0.10 – 0.14 m`；底边距地 **`2.35 – 2.55 m`** | 黑钢机箱 `#14181e`，主字 **LED 点阵暖红 `#e64532` / 琥珀 `#f09a40`**，或早期背光白字 `#f3f5f8` + **蓝底爬梯图标 `#255ba8`**（含数字圆标 `①②③④⑤⑥⑦⑧号口` + 方向箭头 `← ↑ →` + 主街地标名） | 贴梁刚性支架或双短钢杆 | [01](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/01_hub_exit12_56_led_matrix.png), [02](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/02_hub_exit78_56_lightbox.jpg), [06](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/06_hub_corridor_red_ticker.jpg), [11](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/11_hub_oppo_led_ticker_frame.jpg) |
| **L2 · 门洞跨梁大型分类出口牌** | 下沉步梯进入地下前室的门洞过梁处 | 宽 `2.20 – 3.40 m`、高 `0.50 – 0.68 m`、厚 `0.09 – 0.12 m`；底边距地 **`2.30 – 2.45 m`** | **黑底/深炭灰面 `#15191f`**（带中置地标/房屋图标）配高对比白字 `#f2f5f8` + 蓝框楼梯符号；部分老口沿用**深天蓝 `#1b4d8e` 细白框白字**门梁牌 | 过梁螺栓直挂 / 双角铁框 | [03](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/03_portal_exit34_archway.jpg), [04](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/04_corridor_exit6_dualrod_signs.png), [09](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/09_stairwell_canopy_topdown_frame.jpg) |
| **L3 · 走廊中轴双杆双向灯箱** | 主廊/支廊中轴线上；纵向 **每隔 `6 – 12 m`** 连续悬垂（单 corridor 串联可达 4–6 块） | 宽 `1.20 – 2.20 m`、高 `0.38 – 0.55 m`、厚 `0.06 – 0.10 m`；牌底离地 **`2.25 – 2.40 m`**（精准对齐 `wayfinding` `bottomY = 2.30 m`） | 依功能区分：• **市政/公厕/分支导视**：白色/浅米背光 `#eef2f6` + 深蓝/黑字或 **钴蓝 `#1c5296` 白字**（`Toilets 公共厕所 →` / `洗手间`）；• **商业主导向**：红底 `#a82c26` 白字双面内透 | **双细不锈钢圆杆 / 金属链**（`Ø 16–20 mm`，内缩边宽 `8–12%`，对齐 `rodInset = 0.80`；杆长 `0.35–0.75 m`） | [04](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/04_corridor_exit6_dualrod_signs.png), [06](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/06_hub_corridor_red_ticker.jpg), [07](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/07_alley_toilets_dualrod_troffer.jpg), [10](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/10_corridor_phone_repair_sign_frame.jpg) |
| **L4 · 应急出口与片区编号挂牌** | 梯口近廊与长直廊交汇前 `2 – 4 m` 处 | 应急出口牌：宽 `0.85 – 1.25 m` × 高 `0.30 – 0.40 m` × 厚 `0.04 – 0.06 m`；牌底离地 **`2.25 – 2.40 m`** | 薄铝/黑铁框 `#242930`，国标降饱和**安全绿 `#166840`** 配高亮 `#f2fbf6` 白字 + 奔跑小人/`EXIT` 箭头；小香港橙黄片区立方标 `#d88928`（`中区101号`） | 双细金属杆 / 细链 | [03](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/03_portal_exit34_archway.jpg), [12](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/12_xxg_stairwell_green_exit_sign.jpg), [13](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/13_xxg_split_steps_bidirectional_exit.jpg), [18](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/18_xxg_zone101_rest_benches.jpg) |

### 2.2 字体排版与可读性实测阈值（含 `720p @ FOV 70°` 光学口径修正）
- **正反双面独立内容**：实拍中轴吊牌与走廊短段牌均采用**正面/背面按来向分写内容**，严禁单一贴图直接背投造成文字水平镜像（反字）。
- **人眼实景 vs 游戏相机光学分辨率校准（修正 `d1` 10m 糊字基准）**：
  - 真实人眼（~60 PPD）在 `10 m` 外可辨 `0.09–0.14 m` 字高；但游戏默认视口 `1280×720`、`SZJ_PLAYER.fovDeg = 70°` 下，`D = 10.0 m` 处屏幕纵向投影密度仅 **`51.4 px/m`**（`10.77 m` 处仅 **`47.7 px/m`**）。
  - 因此 `wayfinding/look` 现行 `rowHeight = 0.14 m` 在 `10.77 m` 仅投出约 `7 px/行`（中文字体不足 `5 px` 高），必然糊成色块；要在 `10 m` 实现 **`>= 12–14 px` 清晰可读汉字**且**不穿入吊顶设备层（`d4` 物理红线）**：
    1. **吊顶设备避让硬上线（`d4` 防穿模）**：实核 [ceiling.ts](file:///Users/pan-work/guilinol-xxg/web/src/shizijie/atmos/ceiling.ts) 与 [lighting.ts](file:///Users/pan-work/guilinol-xxg/web/src/shizijie/atmos/lighting.ts)，吊顶格栅底沿低至 `2.940 m`，线形灯具/筒灯/喷淋下沿低至 **`2.922 m`**；故在 `bottomY = 2.30 m` 下，灯箱顶面 `topY` **严禁超过 `2.88 m`**（即单牌总高 `height` 硬上限 **`<= 0.58 m`**，净空需从吊顶板起扣至 `>= 0.27 m`；绝不可按无设备楼板 `3.15 - 0.12` 算作 `0.73 m`）；
    2. **在 `height <= 0.58 m` 内拉高字占（`d1` / `d5` 防糊）**：单行槽高须 **`>= 0.24 – 0.30 m`**（`1–2` 行横排 `1×2` 时每格高达 `0.34 m`，`3–4` 行 `2×2` 时 `0.256 m`），去英文副标与窄竖橙框微字（`46×84` 内缩窄字母在 `10 m` 必糊），并加粗 `70×128` 矢量箭头干至 `>= 12 px` 防止斜箭头（如 `↖`）Mipmap 退化成噪点；梯井 `256×64` `safetyExit` / `stairCaution` 槽同步删去 `12–13 px` 英文副行，改为居中单排粗黑体中文防 `6.96 m` 糊字。
- **视口角标与顶部 HUD 净空避让（对齐 `d3` / `d5` 防遮挡）**：`2.30 m` 挂高在 `2.0–4.0 m` 近距平视下覆盖视口上沿；进入 `body[data-szj-active="1"]` / `body[data-szj-indoor="1"]` 后须隐藏顶部居中胶囊（`.gl-mission-entry` / `.gl-mission-hud`），并按需求收缩或避让左上/右上悬浮角标以防近景第 1 行文字被压挡。
- **红色 LED 跨梁溢光**：核心大厅跨梁 `0.45–0.65 m` 高红色 LED 屏发散强漫射光，会使紧邻 `1.5–2.5 m` 范围内的天花银灰铝扣板与湿润地面呈现淡淡暖红反光晕染（见 [01](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/01_hub_exit12_56_led_matrix.png)、[02](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/02_hub_exit78_56_lightbox.jpg)、[11](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/11_hub_oppo_led_ticker_frame.jpg)）。

---

## 三、天花吊顶、照明色温与灯具间距

| 构件项 | 实测模数 / 间距 | 材质与实拍色值范围（RGB / Hex，供抵消 `saturation=1.22` 后调色） | 实拍引用 |
| --- | --- | --- | --- |
| **主流金属铝扣板/矿棉方板顶** | `600 × 600 mm` 压缝方板；接缝深 `6–10 mm`、缝宽 `2–3 mm`；占实拍全区 **>85%** | **实心封顶无透空黑网**！浅银灰铝合金/烤漆面板 `#d4d9df` – `#e0e3e7`（老区局部带轻微水渍偏暖 `#cbc8be`） | [01](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/01_hub_exit12_56_led_matrix.png), [04](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/04_corridor_exit6_dualrod_signs.png), [05](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/05_hub_curved_119_columns.jpg), [12](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/12_xxg_stairwell_green_exit_sign.jpg), [17](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/17_xxg_aluminum_ceiling_dualrow_led.jpg), [27](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/27_xxg_corridor_3m_spacing_panels.jpg) |
| **老巷裸顶/裸梁段** | 净高跌至 `2.5–2.9 m`；混凝土纵横梁宽 `0.28–0.35 m` | 绿漆混凝土梁 `#2c4b39` 或灰白抹灰 `#cbcac4`，表面明走白色镀锌/PVC 线管（`Ø 20–25 mm`） | [22](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/22_shop_bag_hat_open_beam_batten.png), [25](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/25_corridor_narrow_red_booth_signs.jpg), [31](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/31_legacy_narrow_lane_fluorescent.jpg) |
| **电玩城前厅敞开顶** | 层高 `3.4–3.8 m` | 深炭灰喷涂顶棚 `#25282e` + 交叉悬挂 `2700–3000K` 暖黄串灯 + 多边形白光管 | [26](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/26_hall_leasing_stringlights_columns.jpg) |
| **主廊嵌入式方型平板灯 / 格栅灯盘** | 尺寸 `600×600 mm`（单联）或 `600×1200 mm`（双联三管格栅）；**纵向间距 `2.5 – 3.5 m`**（宽廊 `4–6 m` 用双列对称排布，窄巷单列） | `5000–5600K` 冷白微青漫射面 `#edf3fa`，金属窄边框架 `#adb5bf`；每 2–3 跨穿插 `600×600 mm` 四向白色百叶空调风口（`#dce0e4`） | [04](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/04_corridor_exit6_dualrod_signs.png), [07](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/07_alley_toilets_dualrod_troffer.jpg), [13](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/13_xxg_split_steps_bidirectional_exit.jpg), [17](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/17_xxg_aluminum_ceiling_dualrow_led.jpg), [27](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/27_xxg_corridor_3m_spacing_panels.jpg) |
| **辅助筒灯、喷淋与监控** | 嵌顶筒灯 `Ø 120–150 mm`（约 `1.8–2.4 m` 间插），喷淋 `3.0–3.6 m` 间距，半球监控贴梁角 | 筒灯 `3400–4000K` 暖白 `#f8ebd4`；黑色烟感/喷淋头 `#1f2226`；白色半球摄像机 `#e8eaed` | [04](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/04_corridor_exit6_dualrod_signs.png), [07](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/07_alley_toilets_dualrod_troffer.jpg), [19](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/19_xxg_menswear_c57_benches.jpg), [20](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/20_corridor_phone_era_facade.png), [24](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/24_corridor_narrow_glass_boutique.jpg) |

---

## 四、地砖、柱网、墙体与楼梯井构造量化参数

### 4.1 地面材质、拼花与高频视觉收口
- **十字街核心区 / 主廊地砖**（[01](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/01_hub_exit12_56_led_matrix.png), [02](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/02_hub_exit78_56_lightbox.jpg), [04](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/04_corridor_exit6_dualrod_signs.png), [06](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/06_hub_corridor_red_ticker.jpg), [20](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/20_corridor_phone_era_facade.png)）：
  - 模数 `600×600 mm` 与枢纽 `800×800 mm` 细粒水磨石/磨光花岗岩方砖；基色 `#c6c2ba – #d0ccc4`，接缝水泥灰 `#8e8a82`（线宽 `2–3 mm`）。
  - **中心枢纽八角星/菱形拼花**：深灰石材带 `#4f545c` 围边与中心八角辐射/菱形拼花嵌底，遇桂林潮湿雨季（伞水带入）呈半镜面强高光反射（`roughness = 0.22–0.38`，干燥老化段 `0.42–0.58`）。
- **小香港与支廊深灰水磨石**（[17](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/17_xxg_aluminum_ceiling_dualrow_led.jpg), [18](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/18_xxg_zone101_rest_benches.jpg), [19](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/19_xxg_menswear_c57_benches.jpg), [24](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/24_corridor_narrow_glass_boutique.jpg), [32](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/32_shop_glass_front_terrazzo_tape.jpg)）：
  - `600×600 mm` 深灰芝麻水磨石方砖（`#5e6268 – #75797f`，高反光带 `#2d3138` 暗石区）。
- **门槛警示带与地贴**（[12](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/12_xxg_stairwell_green_exit_sign.jpg), [17](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/17_xxg_aluminum_ceiling_dualrow_led.jpg), [18](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/18_xxg_zone101_rest_benches.jpg), [32](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/32_shop_glass_front_terrazzo_tape.jpg), [33](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/33_column_base_fire_box_tape.jpg)）：
  - 沿商铺门口外 `0.15–0.30 m` 普遍贴**宽 `50–80 mm` 黄黑斜纹警示胶带或实黄界线 `#d4ab38` + 黑色金属门槛压条 `#24272c`**；出口口部与枢纽地板带红底方向箭标或绿色导向箭头地贴（注：模型中须严格避用商标品牌字样，替换为中性方向标/桂林城市风物地贴）。

### 4.2 结构柱网与四段包柱特征
- **十字街核心枢纽圆柱 (`Ø 0.80–1.00 m`)**（[01](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/01_hub_exit12_56_led_matrix.png), [02](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/02_hub_exit78_56_lightbox.jpg), [05](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/05_hub_curved_119_columns.jpg), [06](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/06_hub_corridor_red_ticker.jpg), [11](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/11_hub_oppo_led_ticker_frame.jpg), [28](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/28_xxg_junction_column_led_off.jpg)）：
  - 典型**四段分层包柱立面**（现行 `layout` 仅有 `0.52m` 方柱，视觉锚点强烈建议在枢纽 4 角补入圆形/倒角包柱质感）：
    1. **踢脚防护基座（`0.00 – 0.40 m`）**：深棕亮面烤漆或暗大理石纹踢脚裙边（`#3c2f28`），贴黄底方向小贴纸；
    2. **腰高灯箱宣传区（`0.40 – 1.85 m`）**：白底/浅灰半透发光展示盒，或紧邻共享充电宝机柜（`0.45 × 0.35 × 1.35 m`）；
    3. **上段主识别色环（`1.85 – 2.45 m`）**：降饱和松烟绿/翡翠绿环形包柱灯箱（实景品牌对应原创「桂林通信 / 青山文旅」中性绿白灯环，`#1e6a4a`）；
    4. **柱顶压环冠（`2.45 – 3.10 m`）**：高 `0.50–0.65 m` 深红/深青弧形柱头灯环（`#982c26` / `#1d3c5e`），顶接铝扣板圆收口。
- **小香港区柱脚 / 地台收口**（[29](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/29_xxg_atrium_glass_partition_plinth.jpg), [33](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/33_column_base_fire_box_tape.jpg)）：
  - 柱基围设 `0.38–0.45 m` 高黑大理石纹地台，或米灰粗漆立柱外挂双联**红色铁皮灭火器箱**（`0.42 × 0.18 × 0.65 m`，`#b42e28`）。

### 4.3 步梯井与斜壁利用规制
- **几何与踏步**：净宽 `3.20 – 3.60 m`，中间设 **`1` 排 `Ø 45–50 mm` 拉丝 304 不锈钢中央分流立柱扶手（`H = 0.90–0.95 m`）**，两侧墙壁配双层圆管扶手（上杆 `0.90 m`、下杆 `0.68 m`）（[08](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/08_stairwell_entry_signs_yellowtile.jpg), [09](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/09_stairwell_canopy_topdown_frame.jpg), [12](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/12_xxg_stairwell_green_exit_sign.jpg), [14](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/14_stairwell_wall_20cm_case_rack.png), [15](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/15_stairwell_twoflight_shutter_pipe.jpg), [16](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/16_stairwell_upward_vertical_boxes.jpg)）。
- **踏步材质**：深灰芝麻花岗岩或深褐防滑槽石材（`300 × 150 mm`，精确吻合 `SZJ_STAIR_SPEC`），中轴带防滑盲道纹条，雨天反光明显。
- **梯井墙面真实肌理**（杜绝光秃大白墙）：
  - 满贴 `100×200 mm` 浅米黄格栅瓷砖（[08](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/08_stairwell_entry_signs_yellowtile.jpg)）或 `200×300 mm` 褐灰石材面砖（[09](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/09_stairwell_canopy_topdown_frame.jpg), [15](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/15_stairwell_twoflight_shutter_pipe.jpg)）；
  - **标志性 `20 cm` 进深斜壁货架**：下梯右壁或平缓侧壁利用墙体嵌入 **`~0.20 m` 进深木框 + 白洞洞板陈列架**，挂满手机壳与数据线并竖贴窄条招牌，旁接立式黑铁消防阀门管、灰铁电箱与白盘卷消防水带（[14](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/14_stairwell_wall_20cm_case_rack.png), [15](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/15_stairwell_twoflight_shutter_pipe.jpg)）；
  - 其余侧壁嵌 `1.5 × 1.0 m` 银框公益/安全展板，出口顶部现出地面树影与高光斜坡玻璃网架雨棚天光（[08](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/08_stairwell_entry_signs_yellowtile.jpg), [09](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/09_stairwell_canopy_topdown_frame.jpg), [12](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/12_xxg_stairwell_green_exit_sign.jpg)）。

---

## 五、商铺业态实占比、陈列道具与卷帘门细节

| 维度 | 实测占比 / 尺寸规范 | 实拍细节与配色校准 | 实拍引用 |
| --- | --- | --- | --- |
| **主导业态（约占实店 55–65%）** | **手机维修 / 贴膜配件 / 钟表配电池**开放玻璃柜台；间配服饰/美甲/小吃摊车 | **腰高全透玻璃柜台**：高 `0.95 – 1.05 m`、进深 `0.55 – 0.65 m`、底座绘深蓝/红广告板；台面立 `0.35 m` 高高亮小灯箱 + **直播手机环形补光灯三角架**；台前常放 **红色方形塑料凳 (`0.42m`)** 供顾客坐等修机 | [04](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/04_corridor_exit6_dualrod_signs.png), [07](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/07_alley_toilets_dualrod_troffer.jpg), [10](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/10_corridor_phone_repair_sign_frame.jpg), [20](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/20_corridor_phone_era_facade.png), [21](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/21_shop_watch_phone_counters_shutter.png), [23](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/23_corridor_low_led_panel_phones.jpg) |
| **精品服饰与百货闭店区** | 单间门宽 `2.8 – 3.6 m`；外摆占廊道外缘 `0.35 – 0.55 m` | 通高微青钢化玻璃门脸（带外挂铁艺双杆衣架、半身白色假人模特）；闭店档口拉下**横条波纹镀锌/米灰卷帘门**（门楣上方露 `Ø0.25 m` 卷筒盒，脚部带潮气水渍与黄琥珀招租条） | [15](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/15_stairwell_twoflight_shutter_pipe.jpg), [17](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/17_xxg_aluminum_ceiling_dualrow_led.jpg), [18](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/18_xxg_zone101_rest_benches.jpg), [19](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/19_xxg_menswear_c57_benches.jpg), [21](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/21_shop_watch_phone_counters_shutter.png), [24](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/24_corridor_narrow_glass_boutique.jpg), [32](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/32_shop_glass_front_terrazzo_tape.jpg) |
| **主廊公共休息连排椅** | 仅摆于 `4.8 m+` 宽主厅/小香港中区廊边 | **3–4 联穿孔银色拉丝不锈钢连排长椅**（长 `1.80–2.30 m` × 深 `0.55 m` × 座高 `0.42 m`），椅背微弧打孔，椅下常见商户纸箱 | [13](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/13_xxg_split_steps_bidirectional_exit.jpg), [18](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/18_xxg_zone101_rest_benches.jpg), [19](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/19_xxg_menswear_c57_benches.jpg), [30](file:///Users/pan-work/z-test/shizijie-ref-pack/b1-real/30_xxg_hall_split_2step_transition.jpg) |

---

## 六、现行 3D 代码模块对照与高优落地整改项（给 `Hy2 / Gemini / Carbon / Neon`）

| 下游模块 | 当前代码状态（已核代码） | 真实世界偏差诊断 | 量化整改建议（可直接执行） |
| --- | --- | --- | --- |
| **`look/` (`palette.ts` + `wayfinding-signs.ts` + `textures.ts`)** | `wayfinding-signs.ts` 已扩至 `1024×512`（`400 px/m`, `7.948 MiB` 逼近 `8 MiB` 上限）；`compare-08` `↖` 与 `[NE]/[NW]` 仍糊，且 `textures.ts` `safetyExit`/`stairCaution` 带 `12–13px` 小英文 | 1) 不得再扩贴图尺寸（仅剩 `~54 KB` 余量）；2) 窄 `46×84` 橙框字母与瘦小 `↖` 箭干在 `10m` 退化；3) `256×64` 梯井牌小英文 `6.96m` 处仅 `3–4px` 糊化（`d5`） | 1) **0 显存代价重构字形**：增粗箭头干宽（`>= 12px`），弃用或拓宽 `[NE]/[NW]/[SE]` 微字徽标直接突出大号方向+站名+距离；<br>2) `textures.ts` `safetyExit` / `stairCaution` 删掉 `12–13px` 英文副行，改大号粗体纯中文；<br>3) 全过程严守 `<= 8 MiB` 纯 RGB 无 Alpha |
| **`atmos/` (`spec.ts` + `ceiling.ts` + `lighting.ts`)** | `baffleY` 底沿 `2.940 m`，`linearLampY`/`downlightY`/`sprinklerY` 下沿最低达 **`2.922 m`** | `3–4` 行吊牌若超 `topY = 2.88 m` 即顶进灯带/格栅/风管引发 75/95 穿模（`d4`）；且实景 `85%+` 为闭口铝扣板 | 1) 维持设备底部包络 `>= 2.92 m` 或上收格栅至 `>= 2.98 m` 留足 `0.10 m` 吊杆防穿空腔；<br>2) `600×600mm` 铝扣板主顶 + `2.5–3.5 m` 平板灯间距；<br>3) 严守 `<= 12 drawCalls` 与 `minSignClearanceY >= 2.75 m` |
| **`wayfinding/` (`SZJ_SIGN_SPEC`)** | Round 2 为拉大 `2` 行牌将 `baseHeight=0.30`，连带把 55 块 `3` 行牌（`0.72m -> 3.02m`）和 24 块 `4` 行牌（`0.73m -> 3.03m`）顶进吊顶设备层（`d4`） | `baseHeight + rowHeight × rows` 线性叠加超限；`height <= 0.58 m`（`topY <= 2.88 m`）才是 `bottomY = 2.30 m` 不穿模物理天花板 | 锁定 **`height` 硬上限 `0.56–0.58 m`**（如 `baseHeight=0.30` 仅作用于 `1–2` 行，`3–4` 行改按上限 `0.58 m` 封顶，配 `maxWidth=2.8` 两栏 `2×2` 并排），兼顾 `0` 穿模与 `>= 28px` 投影 |
| **`runtime/` + `verify-shizijie.mjs --compare`** | `.gl-mission-entry` 已彻底隐藏；`compare-01/02/03` 近景角标仍微压边，`compare-05` 小英文待重画 | `compare-01/02/03` 左上（`菜单/未时/视野`）与右侧（`景册/拍照`）角标遮挡极近视口边界吊牌（`d5`） | 1) 在 `szj-ui.css` 按模式策略避让/收敛 `data-szj-active` 下顶角 HUD；<br>2) 修完 `d4/d1/d5` 后重跑 `--compare --out /Users/pan-work/z-test/shizijie-compare/` 验证 `0` 穿模与 `10m` 清晰 |
