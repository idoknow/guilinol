# 王城蜜雪冰城二期 · Multica 排单总表与共享热点整合契约

> 对应分支：`feat/drinks-shop`（worktree：`/Users/pan-work/guilinol-drinks`）
> 目标项目：Multica `idoknow` / `Guilin Online · 网上桂林`（`156530de-f51c-40d8-91e9-e7174ac069ad`）
> 统筹与整合：Neon（独占准备领地：`scripts/drinks/`、`docs/drinks/`；整合步独占共享热点文件）

## 1. Multica 父子单总账（已建档，初始全 `todo`）

| 层级 | 单号 | UUID | 负责人 | 初始状态 | 对应验收项 | 独占写领地 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 父单（Epic） | **IDOK-312** | `01a20fb8-ad1b-7a00-b823-0d749f05b9d9` | Neon（统筹） | `todo` | k48, k49, k50 | `scripts/drinks/`, `docs/drinks/` |
| Stage 1 子单 | **IDOK-313** | `01a20fb8-b6c5-705d-9fd9-8ff673d9d0f4` | Hy1 | `todo` | k51, k52, k53 | `web/src/drinks/site.ts`, `web/src/drinks/terrain/` |
| Stage 2 子单 | **IDOK-314** | `01a20fb8-bfb1-77c5-b5ab-2bb2c3748173` | Hy2 | `todo` | k54, k55, k56 | `web/src/drinks/shop/`, `docs/drinks-refs/shop/` |
| Stage 3 子单 | **IDOK-315** | `01a20fb8-c8ba-7067-b26f-9c49a9c37807` | Neon | `todo` | k48, k49, k50 | 整合步热点：`drinks/index.ts`, `main.ts`, `view-mode.ts`, `crowd.ts` |
| Stage 4 子单 | **IDOK-316** | `01a20fb8-d25f-78d8-959e-8bd00685f982` | Hy3 | `todo` | k57 + k50 联动 | `web/src/drinks/staff/`, `props/`, `audio/`, `docs/drinks-refs/recruit/` |
| Stage 5 子单 | **IDOK-317** | `01a20fb8-dcb3-7caf-8cbc-52df58e4cad6` | Hy4 | `todo` | hold/menu/ui 单测 + k50 联动 | `web/src/drinks/hold/`, `menu/`, `ui/` |

### 逐张推进纪律
1. 所有子单从 `todo` 起步，按 Stage `1 → 2 → 3 → 4 → 5` 顺序逐张验收推进；上一张未通过验收置 `done` 前，不提前将下一张标为完成。
2. 整合步对齐最新 `origin/main` 并合并快通 PR 后，运行 `node scripts/drinks/sync-multica-pr.mjs --pr <PR_URL>` 将 PR 链接统一回填至 `IDOK-312` 及全部 5 张子单。

---

## 2. 模块对接与共享热点整合契约（Integrate 阶段独占落盘）

### 2.1 Hy1 (`terrain/`) → `web/src/drinks/index.ts`
- Hy1 在 `web/src/drinks/terrain/` 对外唯一导出 `fitDrinksPlot()`，并在 `site.ts` 重核 `wangcheng_mall` 坐标、朝向与 `fallbackGroundY`。
- Neon 在整合步将 `fitDrinksPlot()` 接入 `web/src/drinks/index.ts`，把台基/缓坡网格挂到店铺根节点并在 `dispose()` 统一释放；确保四角与门前人行道离地高差 `≤ 0.05m`。

### 2.2 Hy2 (`shop/`) → `staff/` & `web/src/drinks/index.ts`
- Hy2 导出门洞宽度（`≥ 2.4m`）、室内边界盒（用于进店自动第一人称判定）、员工操作区工位坐标（接单 / 加料 / 封口 / 叫号）以及门口招聘立牌锚点，并保持整店 `draw calls ≤ 30`。

### 2.3 Hy3 (`staff/`) → `web/src/drinks/index.ts`
- Hy3 在 `web/src/drinks/staff/` 内自建蜜雪员工服、门口招聘立牌互动（模型在 `props/`）与出杯全流程及音效（在 `audio/`），严禁改 `web/src/walk/outfits.ts`。
- Neon 在整合步将其挂载到 `web/src/drinks/index.ts` 生命周期（`step(dt)` / `dispose()`）与 `window.viewer.drinks` 调试探针（暴露招聘牌接近态、入职态与出杯阶段，供 k50 自动化校验）。

### 2.4 Hy4 (`hold/`, `menu/`, `ui/`) → `web/src/drinks/index.ts`
- Hy4 将离散「喝一口」升级为长按连续喝 + 能量条实时走动（PC 快捷键长按 + 触屏长按），并打磨杯体/液面/小料模型。
- Neon 在整合步将新版长按开始/停止钩子与实时能量条进度接入 `web/src/drinks/index.ts` 与探针 `getState().hold`（保证骑车自动收杯不回归）。

### 2.5 四处共享热点文件改动清单（已通过 `SHARE+` 登记）
1. **`web/src/walk/view-mode.ts`**：新增非破坏性室内自动第一人称接口（`enterAutoFirstPerson(reason)` / `leaveAutoFirstPerson(reason)`），记录进店前原视角并在离店时无感恢复；玩家在店内手动按 `V` 切换时不反复拉回。
2. **`web/src/traffic/crowd.ts`**：新增王城蜜雪周边降密区（距店半径 ~18m 内压缩街面路人配额/屏蔽进店穿越），防止门前与入口拥堵；同时对齐 `origin/main` 的 `IDOK-296` 视锥/射线降频逻辑。
3. **`web/src/main.ts`**：将 `drinks` 挂载切换为轻量化距离门控懒加载（距 `wangcheng_mall` `< 140m` 或显式参数 `?drinks=1` / `?verify` 时动态 `import('./drinks')`），避免拖累全城首包体积，同时接入 `origin/main` 最新 `mainDetail`（`IDOK-293`）防进水镜。
4. **`web/src/drinks/index.ts`**：统一挂载 `fitDrinksPlot()`、Hy2 新店室内边界与自动第一人称触发、Hy3 `staff` 招聘/员工模式、Hy4 连续能量条喝饮，并将默认站点切换为 `wangcheng_mall`、下调店内外 NPC 并发上限防止过密。

---

## 3. 整合收口门禁与快速通道流程
1. `git fetch origin main` 并把 `feat/drinks-shop` 干净对齐最新 `origin/main`（已含 `IDOK-293/294/295/296/297` 与 `#327`）。
2. 全量门禁：
   - `cd /Users/pan-work/guilinol-drinks && npx --no-install tsc -p web --noEmit`
   - `cd /Users/pan-work/guilinol-drinks && npm run build && npm run verify:walk:quick`（原始输出贴 PR，满足 k49）
3. 生产预览实测（k50）：
   - `node scripts/drinks/verify-mixue-phase2.mjs --dist dist --out /tmp/mixue-phase2-verify`
   - 核验 3 项硬指标：走到王城店门口自动进第一人称、看到招聘牌可互动、长按喝时能量条平滑走动，并将截图与 JSON 证据附到 PR。
4. 推 `feat/drinks-shop` 开 PR，门禁全绿后经 `py Neon` 快速通道 squash 合入 `main`，并运行 `scripts/drinks/sync-multica-pr.mjs` 回填 PR 链接。
