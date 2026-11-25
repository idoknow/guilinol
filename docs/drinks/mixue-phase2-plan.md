# 王城蜜雪冰城二期 · 暂停封存与复盘归档

> **当前状态：项目暂停（项目失败，日后再说）**
> 对应分支：`feat/drinks-shop`（worktree：`/Users/pan-work/guilinol-drinks`，仅封存，**不开 PR、不合并到 `main`**）
> 目标项目：Multica `idoknow` / `Guilin Online · 网上桂林`（`156530de-f51c-40d8-91e9-e7174ac069ad`）

---

## 1. 项目失败与暂停结论

1. **根本原因**：王城商厦地块的底层城市地面数据本身存在严重凹坑。蜜雪业务层被迫在 `web/src/drinks/terrain/plot-sampler.ts` 中硬写王城人行道标高表（`WANGCHENG_SIDEWALK_PROFILE`）并叠加 `5.39m` 填高台基掩盖凹坑；底层地基不修，导致上层坐标系、门店步入、建筑穿模与 HUD 越补越乱。
2. **老板决策（r19 / r20）**：暂停蜜雪项目，Multica 工单全部移回 `backlog` 堆积，等隔壁团队彻底修复底层城市地基（参见关联地面单 `IDOK-276` / `IDOK-279`）后再决定是否重启。
3. **撤销与作废项**：
   - 撤销原定整合步、PR 开启与 squash 合并计划；
   - 原验收项 **`k69`、`k70`、`k71` 标记作废**，不再执行 `npm run build` / `verify:walk:quick` / PR 合并；
   - 已登记的 `SHARE+` 热点变更（`web/src/main.ts`、`web/src/ui/hotbar.css`）随整合步一并撤销，不向 `main` 落盘；
   - 工作区被前序构建脚本 `scripts/og.mjs` 顺手覆盖的 `public/og.jpg`（`Bin 61222 -> 70555 bytes`，非蜜雪业务改动）已按 `git checkout origin/main -- public/og.jpg` 还原。

---

## 2. Multica 归档总账（全部移至 `backlog`）

| 层级 | 单号 | UUID | 原负责人 | 归档状态 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 父单（Epic） | **IDOK-312** | `01a20fb8-ad1b-7a00-b823-0d749f05b9d9` | Neon | `backlog` | 已附失败结论评论（王城地基根因），原 `k69`/`k70`/`k71` 作废 |
| Stage 1 子单 | **IDOK-313** | `01a20fb8-b6c5-705d-9fd9-8ff673d9d0f4` | Hy1 | `backlog` | 地基问题交接详见 `docs/drinks-handoff/ground.md` |
| Stage 2 子单 | **IDOK-314** | `01a20fb8-bfb1-77c5-b5ab-2bb2c3748173` | Hy2 | `backlog` | 王城门头/实拍封存于 `feat/drinks-shop` |
| Stage 3 子单 | **IDOK-315** | `01a20fb8-c8ba-7067-b26f-9c49a9c37807` | Carbon + Neon | `backlog` | 坐标系整合未完成（`k66`–`k68` 未达成），已按 WIP 封存 |
| Stage 4 子单 | **IDOK-316** | `01a20fb8-d25f-78d8-959e-8bd00685f982` | Hy3 | `backlog` | 员工模式与音频封存于 `feat/drinks-shop`（`37f76911`） |
| Stage 5 子单 | **IDOK-317** | `01a20fb8-dcb3-7caf-8cbc-52df58e4cad6` | Hy4 | `backlog` | 3D 饮品杯体与长按能量条封存于 `feat/drinks-shop`（`d6fa2060`） |

---

## 3. 遗留资产与重启前置条件

1. **已封存可复用工具（位于 `scripts/drinks/`）**：
   - `scripts/drinks/verify-mixue-phase2.mjs`：生产预览零作弊 E2E 验收脚本（含真实按 `KeyW` 穿门洞、1F 屋顶误落拦截、HUD 重叠检查与生产零调试探针检查），后续重启或复用到小香港独立室内场景时可直接借鉴。
   - `scripts/drinks/sync-multica-pr.mjs` & `scripts/drinks/drinks-scripts.test.mjs`：Multica 顺序推进与 PR 回填工具及 7 项单元测试。
2. **重启硬前置**：
   - 隔壁团队彻底修复王城片区 GL04 底层地面与解放东路人行道高程数据，移除 `terrain/plot-sampler.ts` 中的硬编码高程表与 5.39m 填高垫层后，方可重新评估启动 `IDOK-312`。
