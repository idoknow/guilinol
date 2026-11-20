# 用户反馈 → AI 建模 + 邮箱账号（IDOK-52）

Rock 2026-11-19 需求：用户提交反馈（带位置、多视角照片），收到后由 AI 直接精细建模，用户能跟踪进度；顺带做账号体系，先只开放邮箱注册。

## 总体架构

沿用 kenshi 地图反馈的做法（Pages Functions + D1 + R2），不引入新服务器：

```
浏览器（glol.rcpd.cc）
  └─ /api/*  Cloudflare Pages Functions（仓库根目录 functions/）
        ├─ D1  `glol`            账号、会话、反馈、时间线
        ├─ R2  `glol-feedback`   反馈照片（私有）
        └─ Resend               验证码邮件
sg 主机 systemd timer：feedback-bridge（每 5 分钟）
  ├─ 拉 status=submitted 的反馈 → 下载照片 → multica issue create（带附件）→ 指派建模 agent
  └─ 读对应 Multica issue 状态/结构化评论 → 回写反馈状态和公开时间线
建模 agent（默认 mac local codex）按 docs/landmark-pipeline.md 建模 → PR → sg claude 验收 → 合并部署 → bridge 标记“已上线”
```

本地开发：`npx wrangler pages dev` 自带 D1/R2 本地模拟，不需要 Cloudflare 凭据。部署、建库、密钥由 sg claude 负责。

## 账号（阶段 1）

- 邮箱 + 密码注册，6 位邮箱验证码（10 分钟有效，同邮箱 60 s 内只发一次，每 IP 每小时 ≤10 封）。验证前账号不能提交反馈。
- 登录、退出、忘记密码（验证码重置）、改昵称。
- 密码：PBKDF2-SHA256，100 000 次（Workers 上限），16 字节盐；常量时间比较。
- 会话：随机 32 字节 token，D1 只存 SHA-256；Cookie `glol_session`，`HttpOnly; Secure; SameSite=Lax; Path=/`，30 天滑动过期。
- 写操作校验 `Origin` 必须是本站（防 CSRF）。
- 登录/验证码接口限流（D1 计数表即可），连续 5 次密码错误锁 15 分钟。
- 邮件发件人：`网上桂林 <noreply@mail.idoknow.top>`（Resend 已验证域名，密钥是 Pages secret `RESEND_API_KEY`）。本地开发 `EMAIL_DEV_LOG=1` 时只把验证码打印到日志。

### 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/register | `{email,password,nickname}` → 发验证码 |
| POST | /api/auth/verify | `{email,code,password}` → 校验最近一次注册的密码，激活并登录 |
| POST | /api/auth/login | `{email,password}` |
| POST | /api/auth/logout | |
| POST | /api/auth/resend | `{email,purpose}` |
| POST | /api/auth/reset | `{email,code,password}` |
| GET | /api/me | `{id,email,nickname,verified}` 或 401 |
| PATCH | /api/me | `{nickname}` |

错误统一 `{error:{code,message}}`，message 用中文。

## 反馈（阶段 2）

### 用户提交什么

- **位置（必填）**：默认取当前视角/角色所在点；可在小地图（`web/src/map/atlas.ts`）上点选微调。存 WGS84 `lat,lon`（用 `pipeline/common.py` 同一套投影的 TS 版换算）+ 可选朝向 `heading`（度）+ 可选关联 `landmark_id`。必须在当前 bbox 内。
- **类型**：缺失建筑 / 位置或朝向不对 / 外观不像 / 道路水系 / 其他。
- **标题**（≤40 字）+ **描述**（≤2000 字）。
- **照片**：1–20 张，单张 ≤12 MB，jpg/png/webp/heic；界面鼓励“正面、两侧、背面、远景、细节”多个视角，每张可选填“拍摄视角”标签。客户端先压到长边 ≤3072 px、去掉 EXIF，**但先读出 EXIF 的 GPS/方向/拍摄时间单独上传**（建模定位要用，存为字段，不随图片公开）。
- 每个已验证用户 24 小时内最多 5 条反馈（防刷，控制建模成本）。

### 状态

| 状态 | 用户看到 | 谁改 |
|---|---|---|
| submitted | 已提交，等待处理 | 用户提交 |
| queued | 已进入建模队列 | bridge 建好 Multica issue |
| modelling | AI 建模中 | bridge（issue in_progress） |
| reviewing | 建模完成，审核中 | bridge（issue in_review） |
| live | 已上线 | bridge（PR 合并且部署） |
| need_info | 需要补充信息 | 建模 agent 结构化评论 |
| rejected | 未采纳（附原因） | 建模 agent / 管理员 |
| duplicate | 与已有反馈重复（附链接） | 建模 agent / 管理员 |

每次状态变化写一条时间线（`feedback_events`：时间、状态、给用户看的中文说明、可选截图 URL）。`need_info` 时用户可以补充文字和照片，状态回到 submitted。

### 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/feedback | 建草稿 → 返回 id |
| PUT | /api/feedback/:id/photos/:n | 上传或替换单张（流式写 R2，每次写独立对象），带 EXIF 元数据头 |
| DELETE | /api/feedback/:id/photos/:n | 在 draft / need_info 时移除单张（含未完成的上传） |
| DELETE | /api/feedback/:id | 删除本人的草稿及照片 |
| POST | /api/feedback/:id/submit | 校验后 submitted |
| GET | /api/feedback?mine=1 | 我的反馈列表 |
| GET | /api/feedback/:id | 详情 + 时间线（仅本人或 bridge） |
| GET | /api/feedback/:id/photos/:n | 照片（仅本人或 bridge） |
| POST | /api/feedback/:id/supplement | need_info 时补充 |
| GET | /api/bridge/pending | bridge 用，`Authorization: Bearer $BRIDGE_TOKEN` |
| POST | /api/bridge/feedback/:id/status | bridge 回写状态 + 时间线 |

### D1 表（草案）

每人最多保留 3 条草稿。滚动 24 小时上传限额为 300 MiB，在开始写 R2 前按本次字节数计入；替换、删除、上传中断均不退回额度。达到上限返回 429，不改变该照片原有状态。

普通会话跨用户访问返回 404。创建草稿的 JSON 字段为 `kind,title,body,lat,lon`，可选 `heading,landmark_id`。照片编号 1–20，PUT 发送原始图片，`X-Photo-Meta` 为 URI 编码的 JSON（`view_label,exif_lat,exif_lon,exif_dir,exif_time`）。详情包含 `photos` 和 `events` 数组。列表、pending 均直接返回数组；pending 也包含已关联且未终结的记录供轮询。补充用 `{body}`，可先上传新编号的照片。

bridge 请求均用 Bearer token。回写字段 `status,message,multica_issue,pr_url,screenshot_url`；附加信息可省略，但需补充、未采纳、重复必须填写说明。submitted 必须先进 queued，此后主线允许向前跳级，reviewing 可打回 modelling；三个工作中状态都能转 need_info/rejected/duplicate。用户补充使 need_info 回到 submitted，bridge 可将 need_info 关闭为 rejected/duplicate。非终态重复写入返回 200，不新增事件；live/rejected/duplicate 后任何回写返回 409。

`users`、`email_codes`、`sessions`、`rate_limits`、`feedback`（id ulid, user_id, kind, title, body, lat, lon, heading, landmark_id, status, multica_issue, pr_url, created_at, updated_at）、`feedback_photos`（feedback_id, n, r2_key, bytes, mime, view_label, exif_lat, exif_lon, exif_dir, exif_time）、`feedback_events`。迁移放 `migrations/`，`wrangler d1 migrations apply`。

## AI 建模链路（阶段 3）

- `scripts/feedback-bridge.mjs`（Node，无依赖或仅用仓库已有依赖），在 sg 主机由 systemd user timer 每 5 分钟跑一次，配置在 `~/.config/glol-feedback-bridge/env`（BRIDGE_TOKEN、MULTICA_CLI_PATH、建模 agent、父 issue、开关 `BRIDGE_ENABLED`）。
- 新反馈 → 下载照片到临时目录 → `multica issue create`：项目 Guilin Online，父 issue = “用户反馈建模”汇总 issue，指派默认建模 agent（mac local codex），状态 todo，附全部照片，描述用 `docs/feedback-modelling-task.md` 模板填充（位置、OSM 附近要素、EXIF 位置、用户原文、验收要求）。
- 建模 agent 的第一步是**判定**：信息不足 → 评论里写 ```feedback-status need_info``` 块和给用户的话；无效/重复 → `rejected`/`duplicate`。有效 → 按现有地标管线建模（证据先行、`npm run audit:landmarks --strict`、照片对比图、斜视总览图）。
- bridge 读 issue 状态和这些结构化块回写反馈；建模 agent 交付时在评论里附一张对比截图，bridge 把它挂到时间线（复制到 R2 公共前缀）。
- sg claude 照常验收 PR、合并、部署；部署后 bridge 发现 PR 已合并且线上版本含该提交 → `live`。
- 失败保护：同一反馈 Multica 侧失败 2 次 → 停止自动重派，状态保持 modelling 并通知 sg claude。`BRIDGE_ENABLED=0` 一键停。

## 前端

- HUD 右上角加“登录/头像”入口和“反馈”按钮，风格对齐现有“关于”面板（`web/src/ui/about.ts`）和 `docs/style.md`。
- 反馈面板：位置（小地图 + 当前点）、类型、标题、描述、照片网格（拖拽/多选，显示每张上传进度，可标视角）。
- “我的反馈”：列表 + 详情时间线（状态胶囊、时间、说明、上线后“飞过去看看”按钮跳到该位置）。
- 移动端可用（照片直接调相机/相册）。

## 不做（这一期）

- 第三方登录、手机号；公开反馈广场/点赞；管理后台（用 D1 控制台 + bridge 代替）；建模结果的自动合并（仍由 sg claude 验收）。
## 游戏视角（0004）

新草稿的 `view` 使用 `lib/feedback-contract.ts` 中的 `FeedbackView`。朝向、俯仰、FOV 都是角度；世界坐标为实际相机位置（米），不记录步行角色位置。`target` 是中心射线命中点，无命中为 `null`。

提交前须同时上传用户照片、`PUT /api/feedback/:id/view-shot`（JPEG，≤2 MiB）。补充资料可不改视角；若重新取景，同时用 `X-Feedback-View` 传新的 JSON，上传量与照片合计。详情返回 `view` 和 `has_view_shot`；同路径 GET 需与原照片相同的权限。旧记录无视角时仍可查看。深链接 `/?view=<base64url(JSON)>` 复现镜头而不恢复角色，不包含私有照片或用户信息。
