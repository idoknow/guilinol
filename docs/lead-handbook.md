# 网上桂林 项目 lead 交接手册（sg claude → py agy hy-xh，2026-11-20）

> **2026-11-20 14:10Z 更新（以本段为准）**：py agy hy-xh 已退出本项目，**lead 回到 sg claude**（`91e112ba-1989-4256-ad5f-cd92e7de57ed`）。下文所有写“hy-xh / lead”的地方，现在都指 sg claude。
> - 交付了、卡住了或者需要裁定时，@ sg claude。进度汇报不要 @，不 @ 就不会唤醒，也省 Claude 额度。
> - 可以调度的执行者只有 sg codex、mac local codex、mac local agy。**不要派活给 py 开头的 agent。**
> - 校园内部复原（IDOK-80/82/83/84）归 mac local agy，一次只做一单，顺序 84 → 83 → 80 → 82。
> - 并发上限：sg codex 1、mac local codex 2、mac local agy 1。合并、部署、放行 backlog 单都由 sg claude 按队列逐个处理。
> - 不再使用“执行者运行结束就唤醒 lead”的规则，执行者自己跑完门禁、交付时 @ sg claude 即可。


Rock 11-20 定：Claude 额度不够，**方案设计、派单、验收、lead 职责逐步迁移给 py agy hy-xh**。sg claude 逐步退出，过渡期只做两件事：合并、部署这类 sg 机器上才能做的步骤，以及 hy-xh 自己执行的单子的最终验收（避免自己验收自己）。

## 1. 角色
- **Rock（Chin Rock）**：决策人。评论用中文写给他，只汇报结论、截图和线上地址。
- **lead（py agy hy-xh）**：
  - 把 Rock 的要求拆成子 issue，写清范围、不做什么、证据来源、验收命令和数字。
  - 给每个子 issue 建“执行者运行结束”唤醒。
  - 验收：看 PR、跑审计、逐张看对比图。
  - 打回时必须 @ 执行者，不 @ 对方不会开跑。
- **执行者**（agent ID 见 §6）：mac local codex（最强，可多派）、sg codex（引擎、管线、后端）、py antigravity（单栋地标精修；读网上 png 会把会话弄坏，见 §5）。
- **校园内部复原**（IDOK-79/80/82/83）：**只能派给 py agy hy-xh，不派 codex**（两个 codex 都以未成年人安全为由拒做过）。

## 2. Rock 的长期规则（必须遵守）
1. **位置先于造型**：先做“证据底图”（`docs/layout/*.md` + 叠在卫星图上的图），每一项至少两个独立来源（Esri/天地图卫星、OSM、百度/高德 POI 转 WGS84、Rock 实拍 `docs/refs/rock/`、网上公开照片）。百度/高德坐标是 GCJ-02/BD-09，必须转换并用控制点校验。
2. **所有结构贴合 OSM**：楼的轮廓，以及匝道、台阶、广场、路。
3. **立体结构和高低错落**要对；城台、桥这类连续结构必须看**低空斜视图**，确认整体是连续的（IDOK-78 的教训：只看单一机位会漏掉悬空）。
4. **不能悬空、不能下沉**：高度一律采样最终地形（`ground()`），必须过 `audit:grounding`（IDOK-59）。
5. **不能有接缝**：地标和道路、人行道、地形之间用统一材质，没有台阶，标线连续（IDOK-69 的 `audit:seams`）。特殊铺装的白名单写在 `docs/style.md`。
6. **Rock 的实拍是最高证据**：用 `photo-match` 做同机位“实拍 | 改前 | 改后”三联图（IDOK-46）。只有 `photo-locations.json` 里有依据的修正才能改机位。
7. **学校**：校内布局按卫星图复原（Rock 11-20 扩大范围）。安全边界：不做岗亭、闸机、监控，不标注楼的用途，不做室内，校门关闭不能进，搜索落在校外路上。
8. **性能**：重复构件实例化，加 LOD，雾外隐藏，不开实时阴影（IDOK-72）。新增内容不能让手机端 p95 变差。
9. **进程清理**：执行者结束前必须清理本轮启动的进程（`docs/agent-rules.md`）；不能用 `pkill -f`，不能动 multica daemon 和 Rock 的桌面 chromium。
10. 网上找的参考图只看，不入库、不做贴图；Rock 的照片去掉 EXIF 后可以入库。

## 3. 验收清单（每单都要做）
1. 看 PR diff，确认范围没有越界，和其他 issue 没有冲突。
2. 在**同一份原始数据**上：`npm ci && npm run world && npm run landmarks && npm run build`（sg 上 og.mjs 截图步骤可能超时，可以直接 `vite build`）。
3. 审计：
   - `npm run audit -- --strict`：不能比 origin/main 多出新的失败项。
   - `npm run audit:landmarks -- --strict`
   - `npm run audit:grounding`：0 超限。
   - `audit:seams`：IDOK-69 合并后启用。
4. 运行：`verify:walk:quick`、`verify:ride`（桌面和移动端）、`verify:flight`（322/322）。动到性能时跑 `npm run qa`。
5. 逐张看交付的三联图、斜俯视图和叠加图，并且**自己抽查 2–3 项**：对着卫星图或 POI 核对，从低空斜视角自己截图。
6. 通过：squash 合并 → 部署（见 §4）→ 状态改 done → 在 IDOK-2 用中文回复 Rock，附对比图和线上地址。不通过：写清楚哪张图、哪个数字不过，**@ 执行者**。

## 4. 合并与部署（需要 sg 机器上的凭据）
- 部署命令（只能在 sg-ovhcloud-01 上跑，token 在 `~/.credentials/`）：
  `CLOUDFLARE_API_TOKEN=$(cat ~/.credentials/cloudflare-langbot-app-token) CLOUDFLARE_ACCOUNT_ID=1387087a999ab906634a7529b0c0684a npx -y wrangler@4 pages deploy dist --project-name guilinol --branch main`
- 过渡期：lead 验收通过后，在 issue 里写“验收通过，可合并部署”，并 @ sg claude 或 sg codex 执行合并和部署。以后如果 lead 所在机器有 gh 写权限和 CF token，就由 lead 自己做。
- 部署后用 `curl --resolve glol.rcpd.cc:443:104.21.48.80 https://glol.rcpd.cc/version.json` 核对线上版本（本地 DNS 可能有缓存）。

## 5. 各执行者的已知问题
- **py antigravity**：读网上下载的 png 后，会话报 400 INVALID_ARGUMENT，之后每次重试都会立刻失败。处理办法：新开一个 issue（新会话），并在说明里写“图片先转 JPEG、最长边 ≤1600 px、每次最多 3 张”。单次 401 属于偶发，重试即可。
- **sg codex**：偶尔启动时握手超时（`initialize did not respond`），之后不会自动接上，要重新 @。
- **mac local codex**：Mac 上生成的世界曾经和 Linux 不一致（IDOK-67 已修）；最终以 sg 上的复跑结果为准。
- **py codex**：模型不支持，不要派。**py cursor**：大约 18 分钟就会中断，只派短任务。
- 执行者交付后不一定会 @ lead，所以每个子 issue 都要建“执行者运行结束”唤醒：`--event task.completed,task.failed --filter-agent-id <执行者> --mode continuous`。

## 6. ID 速查
- 项目 `156530de-f51c-40d8-91e9-e7174ac069ad`，父 issue IDOK-2，M2.6 父 IDOK-16（`01a1ef40-9bc8-7220-ad37-0e99a53e6eda`），学校父 IDOK-34。
- agent：
  - sg claude `91e112ba-1989-4256-ad5f-cd92e7de57ed`
  - sg codex `aebb81da-be04-42a7-a91b-0a68a2203ee6`
  - mac local codex `cbac9d0f-14a8-4282-9cf4-121297989250`
  - py antigravity `ddab4f6b-0d26-4b23-b0e0-7564d388b2be`
  - py agy hy-xh `578c85c1-86d2-446b-a305-a9d64bfd7f12`
- Mac 执行者需要的原始数据：`multica attachment download 01a1ed3a-7982-7a4c-a208-39d6fbdba4a4`。
- 反馈链路的协调手册：`docs/feedback-coordinator.md`。

## 7. 交接时（11-20 08:4x）的在途工作
| issue | 内容 | 执行 | 状态和下一步 |
|---|---|---|---|
| IDOK-61 | 地标碰撞体和压路清零（PR #55） | sg codex | 在做，交付后验收 |
| IDOK-69 | 全城地形接缝 + 统一地表材质 | sg codex | 在做，交付后验收；特殊铺装白名单由 lead 定稿 |
| IDOK-70 | 桂林剧院整栋重做（PR #63） | py antigravity | 第 2 轮验收进行中 |
| IDOK-71 | 行道树树种和模型 | py antigravity | 验收进行中；树的造型和配色由 lead 定稿 |
| IDOK-75 | 中山路—东西巷 6 张残差（PR #64） | sg codex | 验收进行中；1403/1406 等 Rock 补拍（IDOK-58） |
| IDOK-78 | 古南门城台：一段连续城墙 | mac local codex | 第 2 轮已通过，等变基后合并 |
| IDOK-76 | 重打包六个 GLB | mac local codex | backlog，等 66/68/69/72 都合并后改 todo |
| IDOK-79/80/82/83 | 校园内部复原四组 | py agy hy-xh | 在做；**最终验收由 sg claude 做**（不能自己验收自己） |
| IDOK-46 | 照片同机位对比总跟踪 | mac local codex + lead | 持续更新 |
| IDOK-58 | Rock 补拍清单 | Rock | 等 Rock |
| IDOK-29～33、57 | M6 人物、载具（py 团队，人类成员 py Xie） | py 团队 | PR #33 → #42 → #46 一叠在等合并 |
