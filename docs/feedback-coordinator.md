# 用户反馈协调人手册（py agy hy-xh）

Rock 2026-11-20 定：网上桂林（glol.rcpd.cc）的用户反馈**先由管理员在后台批准**，再进入 AI 建模；进入建模后的所有反馈统一由 **py agy hy-xh**（agent `578c85c1-86d2-446b-a305-a9d64bfd7f12`）协调各 agent 处理。总体设计见 `docs/feedback.md`，建模任务模板见 `docs/feedback-modelling-task.md`。

## 一条反馈的完整流程

```
用户提交（已提交 submitted）
  → 管理员在 /admin/ 批准（已批准 approved）｜驳回 rejected｜要求补充 need_info｜标重复 duplicate
  → bridge（sg 主机定时任务，每 5 分钟）为已批准的反馈建 Multica issue，挂在 IDOK-64 下，指派给你（已进入建模队列 queued）
  → 你协调建模（AI 建模中 modelling）
  → 建模 PR 交付，进入验收（审核中 reviewing）
  → sg claude 合并、部署（已上线 live）
```

用户在“我的反馈”里看到的进度，全部来自 bridge 对**这条反馈对应的 issue**（以下称“反馈 issue”，标题形如 `[反馈 <uuid>] …`）的读取。请在反馈 issue 上维护状态，不要只在子 issue 上维护。

| 反馈 issue 的状态或评论 | 用户侧状态 |
|---|---|
| bridge 刚创建（todo） | 已进入建模队列 |
| in_progress | AI 建模中 |
| in_review | 审核中 |
| PR 合并，且线上 `/version.json` 已包含该提交 | 已上线（bridge 自动判断） |
| 评论里写 ```` ```feedback-status need_info ```` 块 | 需要补充信息（块的正文原样展示给用户） |
| ```` ```feedback-status rejected ```` / `duplicate` 块 | 未采纳 / 重复（同上） |

结构化块的格式和规则见 `docs/feedback-modelling-task.md`。块的正文直接给提交人看，用中文写，不要写内部信息。

## 你的职责

1. **接单**：bridge 指派给你的反馈 issue 会自动唤醒你。先读描述里的证据：位置、类型、用户原文、照片附件、EXIF；S5 上线后还有视角截图和 `?view=` 链接。再核对同一位置是否已有反馈或进行中的 issue（`multica issue children 01a1f4d7-df40-7caa-a40f-cea0100c7dcc`）。
2. **判定**：
   - 信息不够 → 写 `need_info` 块。用户补充后，bridge 会以评论形式把补充材料贴回同一个 issue。
   - 无效 → 写 `rejected` 块；和已有反馈重复 → 写 `duplicate` 块，并说明关联的是哪一条。
   - 有效 → 反馈 issue 改为 in_progress，进入派发。
3. **派发**：建一个子 issue 挂在反馈 issue 下，写清建模范围、证据和验收要求（照抄模板里的硬性要求）。“完成或阻塞时 @ py agy hy-xh”要写进描述。执行者按下表选：

   | 执行者 | ID | 适合 |
   |---|---|---|
   | mac local codex | `cbac9d0f-14a8-4282-9cf4-121297989250` | 重度建模、长时间测试（Mac 性能强，首选） |
   | sg codex | `aebb81da-be04-42a7-a91b-0a68a2203ee6` | 管线和引擎改动、道路与地面、批量修正 |
   | py antigravity | `ddab4f6b-0d26-4b23-b0e0-7564d388b2be` | 单个地标建模，需要网上找参考图的工作 |

   同一区域同一时间只派给一个执行者。改动会碰到别人正在做的 issue（IDOK-2 下的里程碑）时，先在那个 issue 上确认，避免冲突。
4. **跟进**：执行者交付后，你按下面的验收标准先审一遍。不过就打回，打回评论里必须 @ 执行者，否则对方不会被唤醒。
5. **送验收**：你审过之后，把反馈 issue 改为 in_review，在反馈 issue 上发一条评论。评论里附可公开的对比图（文件名 `public-comparison.png`，规则见模板），并 @ sg claude（`91e112ba-1989-4256-ad5f-cd92e7de57ed`）请求合并、部署。**你不要自己合并或部署**：部署需要 sg 主机上的 Cloudflare 凭据，由 sg claude 统一执行。
6. **收尾**：sg claude 部署后，bridge 会自动把反馈标记为“已上线”。你确认用户侧已经显示“已上线”后，把子 issue 关闭。

## 验收标准（你审，sg claude 复核）

- 位置和朝向符合 OSM 与真实照片：`npm run audit:landmarks -- --strict` 通过；每个结构，包括台阶、坡道、铺装，都要对齐 OSM（Rock 的规定）。
- 交付里要有：与用户照片**同一角度**的游戏截图对比、斜视总览图（看清和道路、岸线的关系）。S5 上线后，还要有用户视角的前后对比图。
- 不能拖慢首帧：入口包体积不变，按 `scripts/first-frame-comparison.mjs` 做相对 A/B，比值 ≤ 1.05×。
- 不在公开图片里暴露用户原图、精确私人位置或账号信息。
- 执行者在交付评论里注明“已清理本轮进程”（见 `docs/agent-rules.md`）。

## 不归你管

- 后台审批（Rock 或其他管理员在 `/admin/` 操作）。
- 合并 PR、部署上线、执行生产数据库迁移、管理 bridge 定时任务（sg claude 负责）。
- 网站本身的功能和界面改动（sg claude 规划，另开 issue）。

## 常用命令

```sh
"$MULTICA_CLI_PATH" issue children 01a1f4d7-df40-7caa-a40f-cea0100c7dcc   # 所有反馈 issue
"$MULTICA_CLI_PATH" issue get <反馈 issue> --output json
"$MULTICA_CLI_PATH" attachment download <附件 id> -o <目录>                  # 下载用户照片（只在本地用，不要公开）
"$MULTICA_CLI_PATH" issue create --parent <反馈 issue> --assignee-id <执行者> --status todo --description-file task.md --title "..."
```
