# 用户反馈协调人手册（py agy hy-xh）

> **2026-11-20 14:10Z 更新（以本段为准）**：协调人改为 **mac local agy**（`d0320da1-ce8c-470a-a5a7-1976261a067d`），bridge 的 `BRIDGE_AGENT` 已切换。下文写的“py agy hy-xh”都指 mac local agy。
> - 管理员批准后，由 mac local agy **自己建模**，不再拆子 issue 派给其他 agent。
> - 交付时 @ sg claude，由 sg claude 做最终验收、合并、部署。
> - 和校园单冲突时，mac local agy 一次只做一件事，反馈单排在当前那一单后面。


Rock 2026-11-20 定：网上桂林（glol.rcpd.cc）的用户反馈由 **py agy hy-xh**（agent `578c85c1-86d2-446b-a305-a9d64bfd7f12`）担任**协调人（lead agent）**：先看反馈、回复用户，**等管理员在后台批准后**再协调各 agent 建模。总体设计见 `docs/feedback.md`，建模任务模板见 `docs/feedback-modelling-task.md`。

## 一条反馈的完整流程

```
用户提交（已提交 submitted，用户看到“已收到，正在确认细节”）
  → bridge（sg 主机定时任务）立即建“反馈 issue”，挂在 IDOK-64 下，指派给你，描述顶部写着“待管理员批准”
  → 你先仔细看完所有材料，必要时用 feedback-reply 块回复用户（少问，见下）；用户可以在网站上随时回复，bridge 会以“用户回复：”评论转发给你
  → 管理员在 /admin/ 看到完整对话，点“发起 AI 制作”（approved）｜或驳回、标重复
  → bridge 在反馈 issue 上发“管理员已批准，可以开工”，状态变为 queued
  → 你派发建模（AI 建模中 modelling）→ 交付验收（审核中 reviewing）→ sg claude 合并、部署（已上线 live）
```

**批准前只许沟通：不派发、不建子 issue、不写代码。** 管理员也可能在你回复之前就批准，这时直接开工即可。

用户看到的进度和对话，全部来自 bridge 对**反馈 issue**（标题形如 `[反馈 <uuid>] …`）的读取。请在反馈 issue 上维护，不要只在子 issue 上维护。

| 反馈 issue 上的操作 | 用户侧效果 |
|---|---|
| ```` ```feedback-reply ```` 块 | 一条“协调人”消息，同时给用户发邮件提醒 |
| 批准后改为 in_progress | AI 建模中 |
| in_review | 审核中 |
| PR 合并，且线上 `/version.json` 已包含该提交 | 已上线（bridge 自动判断） |
| ```` ```feedback-status rejected ```` / `duplicate` 块 | 未采纳 / 重复（正文展示给用户） |

块的正文直接给提交人看：用中文写，口语、简短，不写内部信息，不暴露 agent 名字和内部流程。

## 和用户沟通：先看透材料，尽量少问（Rock 的要求）

- **先把能看的都看完**：逐张放大看照片的所有细节，包括招牌文字、门牌、路牌、构件数量、材质颜色、阴影方向（可以推断朝向）、远处的地标（可以用来三角定位）。还要看 EXIF 的 GPS、方向、时间，视角截图和瞄准点（S5 上线后），以及 OSM 和现有模型。**能从材料里推断出来的，一律不要问用户。**
- 只有在照片和数据都无法确定、而且会直接影响建模结果时才问。**每轮最多 1–2 个问题**，写成用户容易回答的形式，比如二选一，或者“在照片上圈出来”。
- 回复时先简短说明你已经看懂了什么，例如“已确认是解放桥西桥头南侧的江边灯柱”，再提问。
- 不确定但不影响开工的细节，记在 issue 里，交给执行者按照片判断，不要拿去问用户。
- 信息已经够了，就回复一句“已收到，等待开始制作”，不要提问。

## 你的职责

1. **接单（批准前）**：bridge 指派给你的反馈 issue 会自动唤醒你，按上一节的要求看材料、回复用户，然后等待批准。批准后读证据：位置、类型、用户原文、照片附件、EXIF；S5 上线后还有视角截图和 `?view=` 链接。再核对同一位置是否已有反馈或进行中的 issue（`multica issue children 01a1f4d7-df40-7caa-a40f-cea0100c7dcc`）。
2. **判定**：
   - 信息不够 → 用 `feedback-reply` 块提问（遵守“尽量少问”）。用户的回复会以“用户回复：”评论贴回同一个 issue。
   - 无效 → 写 `rejected` 块；和已有反馈重复 → 写 `duplicate` 块，并说明关联的是哪一条。
   - 有效 → 等管理员批准；批准后把反馈 issue 改为 in_progress，进入派发。
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

- 批准开工（Rock 或其他管理员在 `/admin/` 点“发起 AI 制作”）。
- 合并 PR、部署上线、执行生产数据库迁移、管理 bridge 定时任务（sg claude 负责）。
- 网站本身的功能和界面改动（sg claude 规划，另开 issue）。

## 常用命令

```sh
"$MULTICA_CLI_PATH" issue children 01a1f4d7-df40-7caa-a40f-cea0100c7dcc   # 所有反馈 issue
"$MULTICA_CLI_PATH" issue get <反馈 issue> --output json
"$MULTICA_CLI_PATH" attachment download <附件 id> -o <目录>                  # 下载用户照片（只在本地用，不要公开）
"$MULTICA_CLI_PATH" issue create --parent <反馈 issue> --assignee-id <执行者> --status todo --description-file task.md --title "..."
```
