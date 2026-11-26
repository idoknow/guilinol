# 桂林十字街地下商业街（B1）架构布局与参考考据说明

> 本文档对应 [shizijie-b1.layout.json](../../web/src/shizijie/layout/shizijie-b1.layout.json)、[layout/index.ts](../../web/src/shizijie/layout/index.ts) 与平面总图 [shizijie-b1-floorplan.png](../../web/src/shizijie/layout/shizijie-b1-floorplan.png)，严格遵循冻结契约 [contract.ts](../../web/src/shizijie/contract.ts)（`SZJ_CONTRACT_VERSION = 1`）与视觉图集 [look/palette.ts](../../web/src/shizijie/look/palette.ts)。

---

## 一、坐标系、净空与外部参考依据

1. **唯一室内坐标系（`SZJ_FRAME`）**
   - 原点：`originWorld = (-879.7502021582604, -169.62604470000713)`（十字街中山中路 × 解放东/西路交叉口中心正下方）。
   - 轴向：`+X` 朝东，`+Z` 朝南，`Y` 朝上，与世界坐标纯平移对齐（无旋转、无缩放），往返换算误差 `< 1e-9 m`。
   - 垂向标高：地面楼梯口高程 `surfaceY = 151.3 m`，B1 室内地面 `indoorFloorY = 0 m`，总落差 `depth = 4.2 m`。
   - 边界与层高：`bounds = { minX: -68, maxX: 60, minZ: -61, maxZ: 60 }`；室内有效净高 `ceilingHeight = 3.15 m`（符合 `SZJ_LAYOUT_LIMITS` `[2.6, 6.0]`，对齐 `IDOK-324` 早期人防商业体减去风管与格栅灯箱后的实测净高）。

2. **多源数据与实景参考对照**
   - **OSM 真实地下通道网（15 条 `tunnel=yes, layer=-1` 路径）**：源自 `guilinol-xp-overnight/raw/osm-2026-11.json`（与 `pipeline/shizijie_underpass.py` 同源；注：`/Users/pan-work/z-test/shizijie-ref-pack/osm_overpass.json` 当时联网超时未写入路网，故严格以本地完整 `osm-2026-11.json` 为几何依据）。
     - 中央核心闭环 `way/985734888`：22 边闭合椭圆环廊，周长 `141.82 m`，宽 `5.6 m`（跨度 `x ∈ [-23.23, 20.40]`，`z ∈ [-20.20, 24.74]`）。
     - 内部交叉主轴与四角联络廊：`ways/985734873..985734886`（贯穿环厅的西北—东南主轴、西南—东北斜轴与中庭交叉方形中心枢纽）。
   - **实景参考包校准**：对照 `/Users/pan-work/z-test/shizijie-ref-pack/`（`baidu_pano_views` 十字街中心/解放东/解放西、`wikimedia` 南方大厦/微笑堂/王城商厦、`bilibili` `BV1GuW9zJEQT`）、补盲全景 `/Users/pan-work/guilinol-xxg/raw/refpack/shizijie-underpass-gaps/run-edf7pq6w`（`nw_nanfang`、`ne_zhengyang`、`se_wenhua`）及本轮 **地下通道内部专项包** `/Users/pan-work/z-test/shizijie-ref-pack/b1-real/index.json`（`33` 张 B1 内部实拍，含 `10` 张天花板导视吊牌/LED）与 [reality-spec.md](./reality-spec.md)，还原深灰金属网架斜坡透明玻璃雨棚、`600×600mm` 实心银灰铝扣板顶、双吊杆 `2.25–2.40m` 挂高灯箱、八角拼花水磨石及梯井 `20cm` 手机壳挂架；实测地面十字与地下十字呈 `~45°` 旋转错位，实景 `①–⑧号口` 对应归并至 `NW(⑦⑧)/NE(⑤⑥)/SE(③④)/SW(①②)` 4 座主梯井。
   - **合规声明**：全案 28 家铺位与 4 座出口牌匾均采用原创桂林风物名号，1:1 对齐 `web/src/shizijie/look/palette.ts` 的 `SZJ_SIGN_ATLAS_RECTS`，**零现实商业注册商标**。

---

## 二、四座下沉步梯出入口与走廊拓扑衔接

4 座出口 1:1 匹配契约 `SZJ_STAIRWELLS`（`center` / `foot` 误差 `<= 0.01 m`，`yaw` 误差 `<= 1e-4 rad`），室内踏步均采用 `SZJ_STAIR_SPEC`（`28` 级 × 踢面 `0.15 m` × 踏面 `0.30 m` = `4.2 m` 落差，底部再外延 `footRun = 1.5 m`）。

| `stairId` | 对应街角与入口罩特征 | `center` (室内 XZ) | `yaw` (deg / rad) | 井道宽×投长 / `landingTop` | `footIndoor` (室内 XZ) | 地下门厅主廊接驳方式（避让陷阱说明） |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `nw` | 南方大厦 · NW出口（解放西北侧网格玻璃棚） | `(-22.5, -38.8)` | `72.0°` (`1.2566`) | `3.4 × 9.0 m` / `0.6 m` | `(-16.794, -36.946)` | `corr-stair-nw` & `corr-stair-nw-east` (`4.2 m`) 从梯底沿朝向向前延伸，在 `(-14.6, -36.23)` 汇入 `985734879` 与 `985734877` |
| `ne` | 解放东路 · NE出口（正阳北口斜坡玻璃棚） | `(43.0, -23.0)` | `-45.0°` (`-0.7854`) | `3.4 × 9.0 m` / `0.6 m` | `(38.757, -18.757)` | 舍弃偏离 90° 的旧版 `hint`，由 `corr-stair-ne` / `corr-stair-ne-north` (`4.0–4.2 m`) 绕开楼梯侧壁，从 `(36.2, -16.2)` 分别接入 `985734886` 与 `985734880` |
| `se` | 文化大厦 · SE出口（中山中路西/东侧门框） | `(22.5, 46.5)` | `-158.0°` (`-2.7576`) | `3.4 × 9.0 m` / `0.6 m` | `(20.252, 40.937)` | `corr-stair-se` (`4.2 m`) 直出仅 `0.81 m` 即无缝并入 `985734877` 与 `985734876` 交汇口 |
| `sw` | 微笑堂 · SW出口（人字玻璃棚+红标灯箱） | `(-46.2, 21.5)` | `-131.2°` (`-2.2899`) | `3.2 × 8.8 m` / `0.4 m` | `(-50.639, 17.614)` | 修复旧版 `targetNodeHint` 反向及 `way/985734878` 穿刺梯井问题：`corr-stair-sw` (`4.0 m`) 沿下行方向朝西南前伸至 `(-53.2, 15.37)` 再北转接 `985734875`，同时 `corr-gallery-sw` 与 `corr-hub-sw-n` 绕避梯井外侧连通中心 |

全网共 **20 条走廊折线**（1 条 `ring` + 14 条 `main` + 5 条 `alley`），经 BFS 拓扑遍历确认 **100% 单连通**，且没有任何一条走廊横穿任何楼梯井的中上段坡道空间。

---

## 三、28 间地下商业铺位、区位分布与 `lookKey` 映射

共设 **28 间商铺/档口**（严格落在 `[24, 36]` 区间：`20` 间 `shop` + `8` 间 `stall`），覆盖 `contract.ts` 全部 **9 类业态**（`clothing`, `phone`, `snack`, `drink`, `accessory`, `shoes`, `beauty`, `toy`, `other`），分为三大空间组团：

- **外环 A–D 段（`B1-001` ~ `B1-016`，16 间）**：环绕 `corr-ring-985734888` 外缘布置，背实墙面环廊，避免堵塞四角主放射通道路口。
- **内环四象限岛区 E 段（`B1-017` ~ `B1-024`，8 间）**：嵌入中庭十字交叉道分割出的 4 块内岛（西北、东北、东南、西南岛屿），还原老桂林十字街「中间设岛柜、环廊绕行」的密集市井格局。
- **四季步梯口便民微亭（`B1-025` ~ `B1-028`，4 间）**：紧邻 NW/NE/SE/SW 梯厅前室外侧（与梯井保留 `>= 0.45 m` 净距），玩家下楼即可见明厨茶饮/快充便民摊档与 NPC 店主。

| 编号 | ID | 形态 | 业态 `category` | 原创店名 `name` | 图集键 `lookKey` | 朝向主廊 `frontage` | 矩形 `(x, z, w×d)` | NPC 站位 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `B1-001` | `szj-shop-01` | `shop` | `snack` | 漓江老巷米粉 | `shopNoodle` | `corr-ring-985734888` | `(-1, -24.3, 3.4×2.5)` | `keeper` + `customer` |
| `B1-002` | `szj-shop-02` | `shop` | `drink` | 阳朔鲜果茶室 | `shopTea` | `corr-ring-985734888` | `(4.2, -24.4, 3.2×2.5)` | `keeper` + `customer` |
| `B1-003` | `szj-shop-03` | `shop` | `snack` | 象山手作麻薯 | `shopMochi` | `corr-ring-985734888` | `(9.6, -23.0, 3.0×2.4)` | `keeper` |
| `B1-004` | `szj-shop-04` | `shop` | `clothing` | 港风复古穿搭馆 | `shopClothingHk` | `corr-ring-985734888` | `(-15.6, -21.1, 3.2×2.4)` | `keeper` + `customer` |
| `B1-005` | `szj-shop-05` | `shop` | `phone` | 象山数码配件站 | `shopPhone` | `corr-ring-985734888` | `(24.6, 3.6, 2.6×3.2)` | `keeper` + `customer` |
| `B1-006` | `szj-shop-06` | `shop` | `drink` | 桂花冰室甜品 | `shopDessert` | `corr-ring-985734888` | `(24.5, 9.0, 2.6×3.0)` | `keeper` |
| `B1-007` | `szj-shop-07` | `shop` | `phone` | 漓江快充贴膜社 | `shopPhoneCare` | `corr-ring-985734888` | `(22.5, 14.3, 2.5×3.0)` | `keeper` |
| `B1-008` | `szj-shop-08` | `shop` | `clothing` | 榕城潮流衣社 | `shopClothingBoutique` | `corr-ring-985734888` | `(24.6, -1.9, 2.6×3.0)` | `keeper` + `customer` |
| `B1-009` | `szj-shop-09` | `shop` | `accessory` | 手作银饰工坊 | `shopSilver` | `corr-ring-985734888` | `(-1.0, 28.9, 3.2×2.5)` | `keeper` + `customer` |
| `B1-010` | `szj-shop-10` | `shop` | `beauty` | 花香美妆集合店 | `shopBeauty` | `corr-ring-985734888` | `(-6.4, 28.9, 3.2×2.5)` | `keeper` |
| `B1-011` | `szj-shop-11` | `shop` | `shoes` | 街头运动潮鞋馆 | `shopShoes` | `corr-ring-985734888` | `(4.4, 28.5, 3.2×2.5)` | `keeper` + `customer` |
| `B1-012` | `szj-shop-12` | `shop` | `toy` | 正阳潮玩盲盒社 | `shopToy` | `corr-ring-985734888` | `(-15.2, 26.5, 3.0×2.4)` | `keeper` |
| `B1-013` | `szj-shop-13` | `shop` | `other` | 十字街便民驿站 | `shopMart` | `corr-ring-985734888` | `(-27.3, 3.2, 2.5×3.2)` | `keeper` + `customer` |
| `B1-014` | `szj-shop-14` | `shop` | `accessory` | 晴岚眼镜工坊 | `shopOptics` | `corr-ring-985734888` | `(-27.4, -2.4, 2.5×3.0)` | `keeper` |
| `B1-015` | `szj-shop-15` | `shop` | `clothing` | 青岚棉麻女装 | `shopClothingLinen` | `corr-ring-985734888` | `(-25.4, -8.7, 2.5×3.0)` | `keeper` |
| `B1-016` | `szj-shop-16` | `shop` | `toy` | 复古黑胶明信片 | `shopVinyl` | `corr-ring-985734888` | `(-27.2, 8.6, 2.6×3.0)` | `keeper` |
| `B1-017` | `szj-shop-17` | `stall` | `clothing` | 精选好物女装摊 | `stallPromoWarm` | `corr-ring-985734888` | `(-11.3, -12.3, 2.6×2.2)` | `keeper` |
| `B1-018` | `szj-shop-18` | `stall` | `accessory` | 港街精品银饰档 | `stallPromoBlue` | `corr-hub-nw` | `(-9.9, -9.2, 2.4×2.4)` | `keeper` |
| `B1-019` | `szj-shop-19` | `shop` | `shoes` | 踏青手工皮鞋坊 | `shopLeatherShoes` | `corr-ring-985734888` | `(3.7, -15.5, 2.8×2.4)` | `keeper` |
| `B1-020` | `szj-shop-20` | `shop` | `other` | 漓畔手作礼坊 | `shopSouvenir` | `corr-ring-985734888` | `(8.9, -12.3, 2.8×2.4)` | `keeper` |
| `B1-021` | `szj-shop-21` | `stall` | `drink` | 双虹糖水冷饮铺 | `shopTea` | `corr-ring-985734888` | `(15.5, 6.9, 2.6×2.2)` | `keeper` + `customer` |
| `B1-022` | `szj-shop-22` | `stall` | `beauty` | 桂语香氛试妆台 | `shopBeauty` | `corr-hub-ne-s` | `(13.4, 2.8, 2.4×2.4)` | `keeper` |
| `B1-023` | `szj-shop-23` | `shop` | `clothing` | 靖江潮搭小铺 | `shopClothingBoutique` | `corr-ring-985734888` | `(-3.4, 20.6, 2.8×2.2)` | `keeper` |
| `B1-024` | `szj-shop-24` | `stall` | `toy` | 叠彩盲盒扭蛋亭 | `shopToy` | `corr-hub-se` | `(2.0, 18.1, 2.4×2.4)` | `keeper` |
| `B1-025` | `szj-shop-25` | `stall` | `drink` | 北口鲜榨柠檬亭 | `shopTea` | `corr-stair-nw` | `(-16.5, -40.7, 2.6×2.2)` | `keeper` + `customer` |
| `B1-026` | `szj-shop-26` | `stall` | `phone` | 正阳口快充便民亭 | `shopPhoneCare` | `corr-hub-ne-s` | `(35.8, -9.5, 2.6×2.2)` | `keeper` |
| `B1-027` | `szj-shop-27` | `stall` | `snack` | 南口油茶麻薯亭 | `shopMochi` | `corr-gallery-se` | `(29.1, 39.8, 2.6×2.2)` | `keeper` |
| `B1-028` | `szj-shop-28` | `stall` | `other` | 西口桂花手信亭 | `shopMart` | `corr-stair-sw` | `(-56.5, 13.5, 2.6×2.2)` | `keeper` |

---

## 四、结构柱网与非交互人气 NPC 配额（严格 `<= 48`）

1. **结构柱网 `columns`**
   - 轴线：`xs = [-27, -19, 17, 24]`，`zs = [-27, -20, 1, 24]`，`size = 0.52 m`（共 `4 × 4 = 16` 根方柱包覆，对应环廊及四象限结构隔墙区）。
   - 全部 16 个交叉点均经过自动避让验证：离任何走廊净边界 `>= 0.25 m`，与全部 28 间铺位、4 座楼梯井及 48 名 NPC 零重叠/零阻塞。

2. **非交互人气配置（合计 `48` 名 = `SZJ_BUDGET.npcMax` 上限内满配）**
   - **店铺值守 + 逛店顾客（`npcSpots = 38`）**：
     - `28` 名 `keeper`（每铺 1 名，站于店门口内缘 `0.42 m` 处，面朝走廊待客/整理货架）；
     - `10` 名 `customer`（分布于米粉、鲜果茶、潮服、数码、银饰、潮鞋、便民店及北口饮品亭外廊边 `0.52 m` 处，面朝橱窗驻足挑货/闲聊）。
   - **双向通道客流（`walkers = 10`，3 条路径）**：
     - `walker-ring-loop`：`count = 6`，沿 `way/985734888` 22 节点闭环（`loop: true`）双向巡游；
     - `walker-nw-se`：`count = 2`，沿 NW 步梯口经中庭直穿 SE 步梯口（`loop: false` 往返过街客流）；
     - `walker-sw-ne`：`count = 2`，沿 SW 步梯口经西侧绕行廊及中庭穿行至 NE 步梯口（`loop: false` 往返过街客流）。
   - 总计 `38 + 10 = 48 <= 48`，既满足静态点位校验，也契合 `crowd/` 实例化人流配额。
