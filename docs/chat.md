# 游戏内聊天：接入和运维

**默认以本地词库为主审核，不需要微信凭据。** 新库的 `unmoderated_policy=local_only`：无外审时，本地检查通过即可分发；后台显示 provider「未配置」。可显式切为 `pending`，将无外审的消息全部送人工复核。调用已启用 provider 失败或超时，两种策略都不放行。

## WS / 浏览器

只有通过现有短期签名 ticket 完成 join 的玩家才能操作。`web/src/chat-store.ts` 导出 `chatStore.send(ch,text)` → Promise 回执、`history(ch)` → 发起请求、`subscribe(fn)` → 退订函数；订阅原始服务端事件，连接断开会收到 `chat_reset`，UI 应清空账号相关数据。`mid` 是十进制字符串，时间为 Unix 毫秒。

| 玩家发送 | 响应或推送 |
|---|---|
| `{t:'chat',ch,text,cid}` | `{t:'chat_ack',cid,ok,mid?,code?,msg?}`。`cid` 为本账号唯一、最多 100 个 ASCII 字母数字或 `-_.:` 的客户端键；重试同一键不重新广播。旧包省略频道映射为世界，仍过审核。 |
| `{t:'chat_hist',ch}` | `{t:'chat_hist',ch,msgs}`，旧到新，最多 30 条。 |
| 实时分发 / 人工放行 | `{t:'chat',ch,mid,id,uid,name,text,ts,sys?}`。`id` 是该次联机的玩家 ID；`sys:'notice'` 是管理员公告，不接受客户端指定系统身份。 |
| 删除 / 禁言状态 | `{t:'chat_del',mid}`；`{t:'chat_mute',until,reason}`，`-1` 永久，`0` 解除，有限期限在客户端倒计时后恢复。 |

`ch` 只允许 `near`、`world`。附近以原始发送点 x/z 做水平圆距离判断（含边界），正常分发与复核补发都使用投递时在线接收者的位置。离开不撤回。世界缓存 30 条，附近缓存最多 3000 条；查询时先过滤发送点再取最后 30 条。缓存首次使用从 PG 恢复，删除后失效。全量历史只向管理员开放。

回执 `muted`/`rate`/`too_long` 表示发送前置条件不满足；`blocked` 附“消息包含违规内容，无法发送”；`pending` 已保存但未广播；`error` 表示输入或连接错误。放行/拦截向发送者当前连接再次推送相同 `cid` 的回执。显示聊天以 `chat`/`chat_hist` 为准，不要把点击发送直接加入公开列表。

## 审核与持久化

部署迁移 `deploy/postgres/015-chat.sql`，已加入 `deploy-hk.sh`、readiness 和 selfhost fixture。单副本 rt 通过 `DATABASE_URL` 读写 PG。只在事务提交后广播。短暂写库异常时按顺序重试，`GET /health` 的 `chatBacklog` 包含正在处理和排队的请求。每连接最多 4 条、全进程最多 1024 条在途，再多返回 `rate`。队列是内存队列，不保证在 PG 与 rt 同时故障时保留尚未确认的输入；已持久化消息可以按 `uid,cid` 去重。禁止多副本直接共享这个进程内广播模型。

词库迁移 `016-chat-lexicon.sql` 后运行 `DATABASE_URL=… npm run chat:words:import`；部署脚本自动执行等价 SQL。13 类上游词表固定在 `third_party/sensitive-lexicon/`，来自 MIT 许可的 `konsheng@68a595f`。`category` 为上游文件名（不含扩展名），`source` 区分上游、项目地名和手工词条。重复导入不覆盖手工词或修改过的动作、启用状态；已删除的种子也不会复活。上游含单个字母/数字，可能使普通聊天进入复核；运营可停用具体词条，不必修改原始文件。

校验 Unicode 码点长度、禁言及频率后，rt 用 Aho–Corasick 同时匹配本地词与地名。文本和词条均先做 NFKC、小写、繁转简（MIT `chinese-conv`），再去除空白、标点、符号、emoji、零宽字符。只有完全包含在 `allow` 地名中的命中才豁免，同一句其他片段仍受审。URL、QQ 号、带微信标识的账号进 review；独立违规词的 block 优先级更高。启动构建索引，后台变更后下条消息重建；外部导入最多 25 秒后在下一次匹配前刷新。确认违规计入窗口；pending 仅在人工拦截时计数。

外审接口 `rt/chat-provider.mjs`：`{name,available(openid),check(text,openid)}`。首个实现调用微信 `wxa/msg_sec_check` v2，场景 2；缓存 access token，过期刷新；只认服务端签名 ticket 的 `wx_openid`，不认客户端报的 openid。网页登录目前不签发这个字段。`WX_APPID` 和 `WX_SECRET` 来自可选 k8s Secret `glol-env`，不要写进配置表。mock 用于离线测试，不提供生产环境变量来指定任意审核 URL。

| 情形 | 行为 |
|---|---|
| 无凭据或无可信 openid，`unmoderated_policy=local_only`（新库默认） | 本地无命中可发，`provider=none,label=local_only` |
| 同上，管理员显式选 `pending` | 本地无命中也落库 pending，不广播 |
| 微信已调用但失败、超时、未知判定 | 两种策略都 pending；不回退到仅本地 |
| `pass` / `review` / `risky` | normal / pending / blocked；记录建议、标签与 trace 摘要，不保存 token |

业务设置唯一来源是 `chat_settings.config`：`radius=60` 米，`max_length=100`，`near_ms=1500`、`world_ms=10000`，`window_hours=24`，`threshold=3`，`steps_minutes=[60,1440,10080]`。阈值触达后再犯按窗口内自动禁言次数升级，最后一档封顶。扩展队伍/私聊时要同步添加迁移中的频道约束、接收者成员鉴权、历史分区和筛选规则、频控配置、客户端 `Channel`；不要把新频道作为世界频道兜底。

## 管理 API

前缀 `/api/admin/chat/`，复用后台 session / admin 角色，写请求须带同源 Origin。rt 内部 `/admin/chat` 另验 `RT_ADMIN_TOKEN`，不向浏览器提供 token。成功读取返回 JSON；列表直接返回数组，`limit` 默认 50、上限 200，`offset` 默认 0。所有 POST 都要求 `reason`（1–200 字符）。

| 方法 / 路径 | 参数和结果 |
|---|---|
| GET `messages` / `reviews` | `ch,uid,name,q,status,from,to,limit,offset`，时间为毫秒；reviews 固定 pending。含账号 `account`、原始发送点及审核字段。 |
| GET `context` | `mid,n`；原频道前后各 n 条及中心，附近额外按中心发送点筛选。 |
| POST `delete` / `approve` / `block` | `{mid,reason}`；approve/block 只处理 pending，block 可同时指定 `minutes`。 |
| GET `mutes` | 无 uid 返回当前有效禁言，指定 `uid` 返回包括解除在内的操作历史。 |
| POST `mute` / `unmute` | `{uid,minutes,reason}`；60、720、1440、10080、自定义正整数分钟或 -1；解禁忽略 minutes。 |
| GET / POST `words` | 列表；写入 `{id?,word,category,action:'block'或'review'或'allow',enabled,reason}`；POST `words/delete` 用 `{id,reason}`。 |
| GET / POST `settings` | 读取业务配置及只读 `provider`。修改示例：`{"patch":{"unmoderated_policy":"pending"},"reason":"恢复外审优先"}`；在 admin_audit 记录前后值。 |
| POST `notice` | `{ch?,text,reason,x?,z?}`，默认世界；附近公告必须提供坐标。 |
| GET `audit` | 聊天操作审计，含操作人、时间、目标、原因。 |

验证：`npm run test:chat`，`npm run bench:chat`（本地 PG + 300 个签名 WS 客户端，20 秒，无需外部服务凭据）。
