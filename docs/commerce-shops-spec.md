# 桂林商圈玩法闭环 Stage 1 技术契约（经济、存档、通用商店与个人电摩体系）

> **文档状态**：Stage 1 正式定稿契约（按母单 `IDOK-121` 2026-11-21 统一拍板口径锁定，供 Stage 1A/1B/1C 与 Stage 2/3 并行开发）
> **对应 Multica 任务**：总 Epic `IDOK-121` · Stage 1A `IDOK-122` · Stage 1B `IDOK-123` · Stage 1C `IDOK-124` · Stage 2 `IDOK-125 / IDOK-126 / IDOK-127` · Stage 3 `IDOK-128`
> **对齐基线文档**：`docs/plan-2.md`（`IDOK-106 / IDOK-111`）、`docs/style.md`（Phase 2「桂林街头」）、`docs/ebike-v2-contract.md`

---

## 0. 统一锁定口径与红线（`IDOK-121` 拍板）

1. **唯一开发基线**：`origin/main` `2c4513ebbc2e581ca69cdd5d451ae4ea3af3f484`（含 PR `#94` 精细蒙皮 `public/avatar/figure.glb`、两轮车 V2、`input-guard.ts` 与 PR `#90` `shizijie.py`）。
2. **原创店名（全项目唯一真源）**：
   - 微笑堂服装店：**「漓尚服饰 · 微笑堂店」**（`shop_nikoniko_apparel`）
   - 十字街电动车店：**「漓行电驴行 · 十字街总店」**（`shop_shizijie_ebike`）
3. **统一经济与定价曲线**：
   - 新玩家初始资金：**`¥200`**。
   - 6 套原创街头服饰 + 默认免费常服 `outfit_default`：
     - T1 **`¥480`**：`outfit_guilin_hoodie`、`outfit_linen_summer`（拆卖上衣 `¥220` / 下装 `¥160` / 鞋 `¥120` / 帽包 `¥80`）；
     - T2 **`¥960`**：`outfit_rider_vest`、`outfit_lijiang_shell`（拆卖上衣 `¥420` / 下装 `¥300` / 鞋 `¥260` / 头盔 `¥180` / 包 `¥220`）；
     - T3 **`¥1,680`**：`outfit_guochao_pankou`、`outfit_night_moto`（拆卖上衣 `¥780` / 下装 `¥540` / 鞋 `¥480` / 帽包 `¥320`）。
   - 3 档个人电摩：
     - `lijiang_light`「漓江小轻骑」：**`¥1,800`**（`<= 50 km/h`）；
     - `city_range`「城心续航摩」：**`¥3,600`**（`<= 60 km/h`，带外卖箱降洒汤 25%）；
     - `xiangshan_gt`「象山疾风电摩」：**`¥6,800`**（改装硬顶 `<= 70 km/h` = `EBIKE_UPGRADE_MAX_KMH`）。
   - 充修服务：免费慢充至 80%（`¥0`）、快捷快充至 100%（**`¥20`**）、整车满修耐久（**`¥80`**）、一键满电+满修按缺电与缺损折算（最高 `¥100`）。
4. **合规与零动态光源红线**：
   - 零现实商标/车标/店招，共享电车去薄荷青改用原创青瓦灰 `#5e7680` + 象牙白 `#e8e4da` + 陶土 `#b5563d`；
   - 校园 `quiet` 安静区显式包含全部 21 所 `schoolGround: true` 学校 + **`libin_middle`** + **`guilin_middle`** + **`glmu_dongcheng`** + **`wangcheng_teaching` 教学内院**（共 25 处多边形，外扩 `5m` 缓冲，保留正阳门外广场与独秀峰步道）；
   - 商店展示机位、地贴光环与门店招牌严禁新建 Three.js 动态光源，保持桌面 `>= 60 FPS` / 手机 `>= 30 FPS`。

---

## 1. 状态机、存档与云同步迁移（`web/src/game/*` & `migrations/0006_player_saves.sql`）

- **`web/src/game/state.ts`**：100% 兼容 `docs/plan-2.md` 顶层 6 字段（`mode` / `vehicle` / `money` / `wanted` / `mission` / `zone`）与 `getState()` / `onState()` / `emit()` / `updateTravel()`，增量提供 `onEvent()`、`wardrobe`、`garage`、`activeShop`、`spotsFound`、`missionsDone`、`walletSeq`、`prompt`，以及只读探针 `window.viewer.game`。
- **`web/src/game/save.ts`**：沿用 `localStorage['glol.save.v1']`（`schemaVersion: 2`），保留顶层 `{ money, owned, spotsFound, missionsDone, updatedAt }`，增量增加 `wardrobe`、`garage`、`economy`（`claimedSpotBounties`、`claimedMissionFirstClear`、`completedMissionCounts`、`missionHistory`、`txHistoryRing` 最近 64 条）与 `saveMeta`。
  - 首次加载无损迁移 `localStorage['glol.stamps']`（不删旧键、双写同步、不静默塞钱）；
  - 损坏 JSON 备份至 `localStorage['glol.save.v1.corrupt']` 并安全重置；
  - 所有数值消毒钳位，`activeTestRide` 永不落盘；
  - 交易立即同步落盘，电量/里程 `1500ms` 节流 + `pagehide`/`visibilitychange(hidden)` 冲刷，`QuotaExceededError` 裁剪流水至 16 条重试并支持回滚；
  - 提供离线游客与登录云端无损合并函数 `mergeCloudAndLocalSave()` 与 64 KiB 校验。
- **`migrations/0006_player_saves.sql`**：ANSI SQL（`TEXT` / `INTEGER`），同时兼容 Cloudflare D1（SQLite）与 hk01 PostgreSQL（`deploy/postgres/001-schema.sql`），不触碰 `0001_auth.sql` ~ `0005_feedback_chat.sql`。

---

## 2. 通用商店触发、7 级 `[F]` 仲裁、原子扣款与三端 UI

- **`web/src/game/shops.ts`**：统一注册 `shop_nikoniko_apparel` 与 `shop_shizijie_ebike`，全部强制 `quietCheck: true` 与零光源 360° `cameraRig`。
- **`web/src/walk/interact-arbiter.ts`**：废除 `vehicles.ts` 私有 `KeyF` 监听，严格按 7 级短路仲裁：
  `0 模态/输入阻断 > 1 摔车/起身/扶车锁定 > 2 载具中仅下车（店门口骑车仅弱提示先下车） > 3 扶起倒地车 > 4 商店/充修工位（压制 4.2m 上车） > 5 上车（个人车 +0.6m 优先） > 6 船坞/码头`。
- **`web/src/walk/input-guard.ts`**：`MODAL_OVERLAY_SELECTOR` 与 `TOUCH_UI_SELECTOR` 覆盖 `.shop-overlay` / `.wardrobe-overlay` / `.garage-overlay` / `.mission-hud`；进店设置 `data-shop-open="1"` 并调用 `clearTransientInput()` 锁输入，退店回滚未购预览并恢复街面位姿。
- **`web/src/game/commerce.ts`**：6 步原子扣款 `executePurchase()` 与防刷发奖 `creditReward()`（重入锁 `IN_FLIGHT` + 幂等键 `IDEMPOTENT_REPLAY` + 单一真源计价 `PRICE_MISMATCH` + 已拥有 `ALREADY_OWNED` + 余额不足 `INSUFFICIENT_FUNDS` + 先写盘后提交内存态 `PERSIST_FAILED` 零脏状态）。
- **`web/src/ui/shop-overlay.ts` & `shop-overlay.css`**：柏油黑 `rgba(14,17,21,.80)` + 桂花金 `#ffc53d` + 漓江青 `#20d6c1` + 警示红 `#ff3d4f`，在桌面 `1280×720`、手机竖屏 `390×844`、手机横屏 `844×390` 三端满足零矩形重叠与触控热区门禁。
