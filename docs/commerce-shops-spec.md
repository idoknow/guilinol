# 桂林商圈玩法闭环 Stage 1 技术契约（经济、存档、通用商店与个人电摩体系 · v2.0 跨单合流定稿）

> **文档状态**：v2.0 已实现与跨单口径收口定稿（已对齐 `IDOK-121`~`IDOK-128` 全部复核项与 `origin/main` `2c4513e`）
> **对应 Multica 任务**：总 Epic `IDOK-121` · Stage 1A `IDOK-122` · Stage 1B `IDOK-123` · Stage 1C `IDOK-124` · Stage 2 `IDOK-125 / IDOK-126 / IDOK-127` · Stage 3 `IDOK-128`
> **对齐基线文档**：`docs/plan-2.md`（`IDOK-106 / IDOK-111`）、`docs/style.md`（Phase 2「桂林街头」）、`docs/ebike-v2-contract.md`
> **实现分支**：`feat/s1-commerce-ebike-neon`（基于 `origin/main` `2c4513e`，PR #94 M6 全量底座已合入）

---

## 0. 跨单口径收口决议（v1.0 → v2.0 唯一真源）

根据 `IDOK-121`~`IDOK-128` 联合审计意见，以下 5 项跨单差异已全部锁死唯一真源并同步落地到源码：

1. **两家原创实体店名唯一收口**：
   - 微笑堂商厦服装店（`shop_nikoniko_apparel`）：**「漓尚衣坊」**（全称 `漓尚衣坊 · 微笑堂店`）
   - 十字街电动车专卖店（`shop_shizijie_ebike`）：**「榕城电行」**（全称 `榕城电行 · 十字街总店`）
   - 严禁任何现实品牌商标、LOGO 或代表色。
2. **共享电车配色去竞品化**：
   - 剔除薄荷绿 `0x72d5b0`（同步修改 `web/src/walk/vehicle-model.ts` 与 `web/src/look/config.ts`），改用桂林青瓦灰 `0x5e7680` + 象牙白 `0xe8e4da` + 陶土红 `0xb5563d` 原创色板。
3. **统一经济平衡表（单一真源 `web/src/game/catalog.ts`）**：
   - 初始资金：**`¥200`**；
   - 路边共享电车：**`¥3 / 次`**（前 `120s` 免费试骑，余额 `< ¥3` 时步行与免费人力单车兜底，绝不产生负余额）；
   - 6 套原创桂林街头服饰（与 `IDOK-125` 1:1 对齐 ID）：T1 `¥480`（`outfit_guilin_hoodie` / `outfit_linen_summer`）、T2 `¥960`（`outfit_rider_vest` / `outfit_lijiang_shell`）、T3 `¥1,680`（`outfit_guochao_pankou` / `outfit_night_moto`），含「先买单品再买整套」按未购零售占比折算差价规则（全套已拥有返 `ALREADY_OWNED` 且 `charged = 0`）；
   - 个人 3 档电摩：**`lijiang_light` 漓江小轻骑 `¥1,800`**（满改 `<= 50 km/h`）、**`city_range` 城心续航摩 `¥3,600`**（满改 `<= 60 km/h`）、**`xiangshan_gt` 象山疾风电摩 `¥6,800`**（硬顶 `<= 70 km/h`）；
   - 充修服务：公共免费慢充至 80%（`¥0`）、直流快充至 100%（`¥20`）、底盘精修（按损毁比例 `¥10..¥80` 封顶）、一键满电+满修（两者合计，满态返回 `ALREADY_FULL`）。
4. **`localStorage['glol.save.v1']` 账本字段统一**：
   - 统一归入 `economy: { spotsClaimed, firstClearClaimed, missionHistory, txHistoryRing }`（同时在读盘层兼容早期别名 `claimedSpotBounties` / `claimedMissionFirstClear`），`glol.stamps` 首启无损合并并双写兼容。
   - 双库云存档 DDL 分别落盘至 `migrations/0006_player_saves.sql`（D1 SQLite）与 `deploy/postgres/003-player-saves.sql`（hk01 PostgreSQL）。
5. **25 处校园 `quiet` 安静区精确覆盖与两店实算坐标**：
   - `web/src/game/quiet-zones.ts` + `quiet-zones-data.json` 由 `pipeline/landmarks.json` + `pipeline/common.py` 实算生成，完整覆盖 **21 所 `schoolGround: true` + `libin_middle` + `guilin_middle` + `glmu_dongcheng` + `wangcheng_teaching` 内院（共 25 处）** 并外扩 `5m` 校门缓冲。
   - 微笑堂 `shop_nikoniko_apparel` 落于东翼 `bay 5 + bay 6` `apron`（`triggerPos = [-923.97, ground_y, -104.84]`，`stagePos = [-923.40, ground_y, -104.68]`）；十字街 `shop_shizijie_ebike` 落于 `NE_ANNEX` `bay 3 + bay 4`（`triggerPos = [-780.04, ground_y, -160.08]`，`stagePos = [-780.36, ground_y, -158.71]` 距墙 `+4.20 m` 360° 零穿墙，`deliveryBay = (-779.13, -157.40)`，`testRideSpawn = (-782.25, -150.73)`，`serviceBay = (-786.17, -161.12)`）。

---

## 1. Stage 1A 实现清单（`IDOK-122` · 底座、存档、商店框架与 HUD 修复）

| 模块路径 | 职责与核心导出 |
| :--- | :--- |
| `web/src/game/quiet-zones.ts` + `quiet-zones-data.json` | 25 处校园精确多边形 + `5m` 边距离缓冲：`getQuietZoneAt(x, z)`、`isPointInQuietZone(x, z)`、`distanceToNearestQuietZone(x, z)` |
| `web/src/game/catalog.ts` | 全品类单一真源定价表、6 套服饰 + 单品、3 档个人电摩参数与升级上限、`computeOutfitPresetQuote()`、`calcFastChargeCost / calcRepairCost / calcFullServiceCost` |
| `web/src/game/state.ts` | 100% 兼容 `docs/plan-2.md`（`mode/vehicle/money/wanted/mission/zone`、`getState/onState/onEvent/emit`）与 `street-hud.ts`（`mission.meter/line`）；`glol.save.v1` v2 持久化、`glol.stamps` 无损迁移双写、损坏备份 `glol.save.v1.corrupt`、消毒钳位、配额异常回滚 |
| `web/src/game/commerce.ts` | 原子事务 `executePurchase()`（重入锁 + `idempotencyKey` 幂等 + 目录真源计价 + `ALREADY_OWNED / ALREADY_FULL / SHARED_UPGRADE_FORBIDDEN / UPGRADE_CAP_EXCEEDED / INSUFFICIENT_FUNDS` + 先写盘后提交）、发奖 `creditReward()`、共享电车计费 `chargeSharedBikeRental()` |
| `web/src/game/shops.ts` | 声明式 `SHOP_REGISTRY`（`shop_nikoniko_apparel` / `shop_shizijie_ebike`）与 `findNearbyShopOrService()` |
| `web/src/walk/interact-arbiter.ts` | 统一 7 级 `[F]` 交互短路仲裁：`模态阻断 > 摔车/扶车锁 > 载具仅下车 > 扶倒地车 > 商店/充修压制路边共享车 > 上车（个人车 +0.6m 优先） > 船坞码头` |
| `web/src/walk/input-guard.ts` | 扩展 `MODAL_OVERLAY_SELECTOR` / `TOUCH_UI_SELECTOR` 及 `data-shop-open="1"` 全局热键锁闭 |
| `web/src/ui/shop-ui.ts` + `shop-ui.css` | 桂林街头色板（柏油黑 + `#ffc53d` + `#20d6c1`）通用商店、随身衣橱、个人车库与顶部钱包召唤条；桌面 `1280×720` / 竖屏 `390×844` / 横屏 `844×390` 零重叠，0 新增动态光源 |
| `web/src/ui/street-hud.ts` / `street-hud.css` / `render-range.css` | 修复 `Tab` 手机抽屉与商店互斥、`.st-phone-body` 横屏滚动、移动端 `.render-entry` 避开 `.minimap`（`top: 214px`） |
| `migrations/0006_player_saves.sql` & `deploy/postgres/003-player-saves.sql` | Cloudflare D1 与 hk01 PostgreSQL 双引擎兼容云存档建表草案 |

---

## 2. Stage 1C 实现清单（`IDOK-124` · 个人 3 档电摩、召唤、试驾、充修与两项遗留修复）

| 模块路径 | 职责与核心修复 |
| :--- | :--- |
| `web/src/walk/tuning.ts` + `config.ts` | 新增 `resolvePersonalEbikeProfile(modelId, mods, durabilityPct)`，按车型严格钳位（`50/60/70 km/h`），共享车维持 `allowUpgrades = false` 零漂移 |
| `web/src/walk/ride.ts` | 支持个人车型档案与低车况（`<40%`）加速衰减；**修复 P 档 + `E` 升挡确定性恢复**：P 档按 `E`（`shiftGear(+1)`）或静止按 `P/K/0`/刹车解锁统一钳位至 `Math.min(gear, EBIKE_DEFAULT_GEAR)`（`D3/S -> D2` 防窜车）；按 `Q` 维持 P 档不误解；`Digit1-4` 尊重显式选挡 |
| `web/src/walk/vehicle-model.ts` + `look/config.ts` | 共享电车去竞品化涂装（青瓦灰 `0x5e7680` / 象牙白 `0xe8e4da` / 陶土红 `0xb5563d`） |
| `web/src/walk/vehicles.ts` + `walk/index.ts` | 统一单点 `[F]` 仲裁、个人车 `+0.6m` 选车优先权、`summonPersonalBike()`（步行/非安静区/10s 冷却/全城唯一实体/`pavement` 优先/落 P 档+边撑）、`spawnPersonalBikeAtBay()`、`refreshPersonalBikeVisual()`、`startTestRide() / endTestRide()`（90s / 350m / 高速 1.5s 柔和刹停 / 摔车先清状态防锁死 / 永不落盘）、摔车个人耐久衰减（下限 15% 不锁死）、暴露 `window.viewer.game` / `walk.garage` / `walk.shops` |
| `web/src/ui/walk.css` | **修复手机横屏（`max-height: 500px`）下车按钮遮挡人物**：`.vehicle-action` 移至 `bottom: calc(82px + env(safe-area-inset-bottom)); left: calc(50% - 32px); transform: translateX(-50%)`，紧贴双行 `.ride-hud` 上方（`844×390` 实测 `top >= 260px`、`bottom <= 308px < ride-hud.top 314px`），与人物/摇杆/右控键零重叠 |

---

## 3. 下游并行接入接口（Stage 1B / Stage 2 / Stage 3）

- **Stage 1B (`IDOK-123` · Gbot)**：直接调用 `web/src/game/commerce.ts` `creditReward()`、`web/src/game/quiet-zones.ts` `isPointInQuietZone()`、`web/src/game/state.ts` `updateTravelState({ mission })`（原生兼容 `meter` 与 `line`），任务起终点校验 25 处校园零侵入。
- **Stage 2A (`IDOK-125` · Hy2)**：`web/src/walk/outfits.ts` 订阅 `onState` / `onEvent('outfit:equip' | 'shop:preview')` 与 `OUTFIT_ITEM_MAP`（6 套单品 ID 与 `palette` 已全部预置对齐），操作 `public/avatar/figure.glb` 的 `COLOR_0` 语义区与 `avatar-rig.ts` `attachments`。
- **Stage 2B/2C (`IDOK-126 / IDOK-127` · Hy2)**：实景建筑落盘后仅需核对 `web/src/game/shops.ts` 坐标常量（当前已采用 Hy2 + Multica-Neon 实算复核坐标），无需修改商店交互或扣款代码。
- **Stage 3 (`IDOK-128` · Gbot)**：可直接基于 `window.viewer.game`、`window.viewer.walk.garage`、`window.viewer.walk.shops` 与 `scripts/check-commerce-stage1.mjs` 扩展端到端浏览器回归 `scripts/test-guilin-commerce-loop.mjs`。
