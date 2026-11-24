# 联机服务（glol-rt）

全服一个大房间的实时同步服务：JSON over WebSocket，路径 `/ws`。客户端固定连
`wss://<当前域名>/ws`（可用 `localStorage['guiling.ws']` 覆盖），所以只要 Ingress 把
`/ws` 转给 `glol-rt:8790`，前端不需要任何构建期配置。

登录后以 `?mp=1` 或 `localStorage['glol.mp']='1'` 进入步行模式。默认不加载联机客户端。
`walk.net?.status()` 返回 `{state, online}`，`state` 为 connecting / online / offline /
replaced；断线**无限重试**，指数退避封顶 16s 加抖动，只有被封禁（4003 banned）才停；
被别的设备顶掉（4001 replaced）时不自动重连，状态栏给「已在其他设备联机 · 重连」。
`?debug` 显示调试人数。

## 视野裁剪（AOI）

作者：HelloFHZ（fhzit）

- 100m 网格 `Map<cellKey, Set<id>>`，只在跨格时重算，不做每帧重建。
- 同格 + 邻格（3×3）20Hz 直发；外圈但水平距离 ≤150m 降到 5Hz；超过 150m 才移出视野（滞回，防边界闪烁）。
- 进入视野补一帧完整状态（`join`），离开发 `leave`；传送是瞬间跨格，`pos` 里先重算可见集合再转发。
- `online` 人数与 `chat` 仍是全服；`join` / `avatar` / `emote` 只发视野内；`hit` / `revive` 保持服务端距离裁决。
- 全服名册走单独的低频通道：每 5s 一条 `{t:'roster', players:[[id,name,x,z,joinedAt]]}`，
  地图 / 名册面板用它，3D 场景仍然只来自 AOI。
- 实测（单进程、单核=100%）：300 人城区分布约 1 核、单客户端 16 KB/s；
  密集（±250m）会踩满事件循环，`loopP99` 应在 50ms 以下，超过即视为容量到顶。
- 压测：`npm run bench:rt -- --bots 300 --seconds 20`（离线自起，不碰线上）；
  行为用例：`npm run test:rt-aoi`。

上线前在 `glol-env` 配置同一个随机 `RT_JOIN_SECRET` 给 api 和 rt。登录会话经同源
`POST /api/rt/ticket` 取得 60 秒 HMAC 票据，作为 `join.ticket` 发送；rt 无密钥时拒绝所有 join。
不要把密钥放进前端或版本库；只将 `guiling.ws` 指向受信的 rt 服务。

## 组成

| 文件 | 作用 |
| --- | --- |
| `rt/server-realtime.mjs` | 服务本体：`join` / `pos` / `hit` / `revive` / `avatar` / `who` / `chat` |
| `rt/package.json` | 唯一依赖 `ws@8` |

## 为什么固定 1 副本

房间状态（在线玩家、血量、抽烟状态）在进程内存里。两个副本 = 两个互不相通的房间，
玩家会「看不见对方」。因此：

- `replicas: 1`
- `strategy: Recreate`：宁可发版时断 1–2 秒，也不要新旧两个房间同时在线
- 不做 HPA

要扩容得先改成「按区域分房间 + 房间路由」，那是协议层改动，不是加副本能解决的。

## 容量

`MAX_PLAYERS` 默认 200。位置广播是「谁发谁转发」，200 人满员上行约 2000 包/秒，
实测 50m CPU 份额够用；瓶颈在带宽（出向 = 人数 × 包量），不在 CPU。

## 封禁

```bash
kubectl -n idoknow exec deployment/glol-rt -- \
  wget -qO- --header='content-type: application/json' \
  --header="x-kick-token: $KICK_TOKEN" \
  --post-data='{"uid":100000,"reason":"违规"}' \
  http://127.0.0.1:8790/kick
```

`KICK_TOKEN` 放在 secret `glol-rt` 里（`optional: true`，没配就禁用 `/kick`，
此时 `/kick` 直接 403 且不碰任何连接）。8790 不对公网开放，只经 Ingress。

- 踢人后 uid 会进内存封禁表，`KICK_BAN_SECONDS`（默认 600 秒）内重连会收到
  `{t:'banned'}` 并被断开；重启清空，多副本也不共享 —— 长期封禁得接账号系统。
- `/kick` 接受数字编号或其十进制字符串，范围从 100000 到 JS 最大安全整数。格式不合法直接返回 400。
- `GET /api/me`、登录票据和 rt 广播使用同一个数字 `users.uid`。join 只取已验签票据中的编号和昵称。

## 玩家编号迁移（PostgreSQL）

发版前可先用只读账号逐行核对预期编号（无需新列，不写表、不取序列值）：

```sql
SELECT id, created_at, 99999 + row_number() OVER (ORDER BY created_at, id COLLATE "C") AS proposed_uid
FROM users ORDER BY proposed_uid;
```

实际单独执行：`psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f deploy/postgres/011-player-uid.sql`。
该脚本在同一事务内加列、补号、约束和接续序列；会锁 `users`，请避开高峰。成功后重复执行不会重编。
已存在账号的初始编号连续；未来 PG 序列在冲突/回滚时可能跳号，不回收已用号码。

## 防刷与容量

| 项 | 行为 |
| --- | --- |
| 连接总数 | `MAX_PLAYERS`（默认 200）按**所有 WebSocket 连接**算，含还没 join 的 socket |
| 每 IP 连接 | 最多 8 条（反代后按 `x-forwarded-for` 第一个地址，非法值退回 socket 地址） |
| 慢客户端 | 广播前看 `bufferedAmount`，超 1 MB 跳过该条；连续跳过 60 次 `close(1013)` |
| hit / revive | 服务端用双方最近一次 `pos` 算水平距离：hit > 3.5 m、revive > 3 m 丢弃 |
| 消息解析 | 非对象 JSON（`null` / 数组 / 标量）忽略；单条消息异常只记日志 |

## 验证

```bash
# 健康检查（经 Ingress 不通，只能在集群内或 8080 之外直接打服务）
kubectl -n idoknow exec deployment/glol-rt -- wget -qO- http://127.0.0.1:8790/health
# {"ok":true,"online":0,"proto":4,"maxPlayers":200,"banned":0,"connections":0}

# WebSocket 握手（公网，期望 101 Switching Protocols）
curl -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
     https://glol.rcpd.cc/ws
```

## CDN 注意

### 后台联机接口（PROTO 4）

- `GET /admin/state` 只在 RT Service，精确匹配路径，`/ws` 不转发到它。`X-Admin-Token` 必须匹配 `glol-env.RT_ADMIN_TOKEN`；缺失或不匹配返回空 403。API 通过 `RT_INTERNAL_URL` 拉取（默认 `http://glol-rt.idoknow.svc.cluster.local:8790`；glol-web 用 `dnsPolicy: None` 没有 search 域，短名解析不到）。不要让浏览器直连或分发这两个 secret；踢人仍使用独立的 `glol-rt.KICK_TOKEN`。
- `GET /api/admin/mp` 走现有 admin session，成功返回 `{rt:'up',server,players,bans,events,chat}`；RT 失联或未配置时 HTTP 200 `{rt:'down',error}`，不是在线人数 0。账号原始 IP 不返回，地区来自 `perf_network`，`region` 为 `{country,region,city,isp}` 或 null。`account` 为 `{id,createdAt,signupMethod,banned}` 或 null，`id` 用于已有用户详情页，`createdAt` 为 epoch 秒。`landmark` 为 `/world/manifest.json` 中平面距离最近的地标名，目录不可用时 null。
- `server`：`startedAt,uptimeSec,proto,maxPlayers,online,connections,peak,peakAt,rssMb,heapMb,loopP50Ms,loopP99Ms,traffic,skips,slowCloses,rejects`。峰值和拒绝、慢连接计数从启动起算；事件循环分位单位 ms。`traffic.in/out` 各为最近 60 个秒桶内按类型汇总的 `{packets,bytes}`，字节为 JSON payload，不含帧头；出包逐接收方计数。
- `players`：`id,uid,name,x,y,z,yaw,mode,v,hp,dn,sc,em,joinedAt,lastPosAt,posHz,inBytes,outBytes,bufferedAmount,skips,rttMs,avgRttMs,chats,ua`，另加上述地区、账号、地标。`bike` 非空或 `hb` 非零视作 `bike`，否则 `walk`；现有客户端没区分车/船时不猜测。`em=0` 无表情，`posHz` 为过去 10 秒接受的位置包数除以 10；RT 每 10 秒 ping，RTT 是最近一次和本连接平均值（首次 pong 前 null）。游戏公开的玩家对象只增加 `jt` 入场时间。
- `bans` 为 `{uid,reason,until}`；最近 300 个 `events` 为 `{ts,type,id?,uid,name,joinedAt?,durationSec,reason?,closeCode?}`，最近 100 条 `chat` 为 `{ts,uid,name,text}`，均旧到新。除账号注册时间外，实时接口时间戳均为 epoch ms。
- `POST /api/admin/mp/kick` 需要同源 `Origin`，参数 `{uid,reason,minutes?}`，1–10080 分钟；省略走现有 RT 默认 TTL。成功 `{ok:true,kicked}` 并写 `mp.kick` 审计，仅影响联机，不封账号。
- `GET /api/admin/mp/history?range=24h|7d|30d`：`{range,grain,series:[{ts,online,peak,peakAt}],daily:[{day,dau,sessions,avgDurationSec,medianDurationSec,peak,peakAt}],peak,peakAt}`。时间用 ISO，日界为上海时间；DAU 按会话与日期重叠去重，会话数与时长按开始日（时长只算已结束）。24h 用分钟点，其他用小时均值并保留真实采样峰值时刻，缺样留空不补零。
- `GET /api/admin/mp/sessions?uid=&limit=` 两个查询参数均可省略，默认最近 50 条，最多 200。返回 `{sessions:[{uid,name,joinedAt,leftAt,durationSec,reason,closeCode,region}]}`；在线 `leftAt=null`。每 60 秒按 RT 启动时间和连接 ID 幂等同步；进程重启或缓冲覆盖导致退出事件丢失时用最后观测时刻和 `lost observation`。两次采样间若完整短会话被 300 条缓冲覆盖，无法恢复。分钟留 7 天，小时和已结束会话留 90 天，采样、汇总和清理在同一事务内。

- `/ws` 必须绕过缓存，且 CDN 节点要开启 WebSocket 透传；CDNFly 站点已开 `websocket`，
  缓存规则里没有匹配 `ws` 的后缀，`/ws` 走动态不缓存。
- 302/456 之类的防护页会直接掐掉 WebSocket 升级请求，改 CDN 防护后要重测 101。
