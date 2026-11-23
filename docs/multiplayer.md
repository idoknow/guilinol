# 联机服务（glol-rt）

全服一个大房间的实时同步服务：JSON over WebSocket，路径 `/ws`。客户端固定连
`wss://<当前域名>/ws`（可用 `localStorage['guiling.ws']` 覆盖），所以只要 Ingress 把
`/ws` 转给 `glol-rt:8790`，前端不需要任何构建期配置。

登录后以 `?mp=1` 或 `localStorage['glol.mp']='1'` 进入步行模式。默认不加载联机客户端。
`walk.net?.status()` 返回 `{state, online}`，`state` 为 connecting / online / offline；
断线退避最多六次，之后可调用 `walk.net.reconnect()`。`?debug` 显示调试人数。

上线前在 `glol-env` 配置同一个随机 `RT_JOIN_SECRET` 给 api 和 rt。登录会话经同源
`POST /api/rt/ticket` 取得 60 秒 HMAC 票据，作为 `join.ticket` 发送；rt 无密钥时拒绝所有 join。
不要把密钥放进前端或版本库；只将 `guiling.ws` 指向受信的 rt 服务。

## 组成

| 文件 | 作用 |
| --- | --- |
| `rt/server-realtime.mjs` | 服务本体：`join` / `pos` / `hit` / `revive` / `avatar` / `who` / `chat` |
| `rt/package.json` | 唯一依赖 `ws@8` |
| `deploy/rt.Dockerfile` | `node:20-alpine`，非 root 运行，自带 HEALTHCHECK |
| `deploy/k8s/resources.yaml` | `Deployment glol-rt`（1 副本、`Recreate`）+ `Service glol-rt:8790` + Ingress `/ws` |
| `.github/workflows/glol-images.yml` | 矩阵里加了 `rt`，和 api/web/probe 一起推 `ghcr.io/idoknow/glol-rt:<sha>` |

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
kubectl -n idoknow exec deploy/glol-rt -- \
  wget -qO- --header='content-type: application/json' \
  --header="x-kick-token: $KICK_TOKEN" \
  --post-data='{"uid":"E8A4F4E4","reason":"违规"}' \
  http://127.0.0.1:8790/kick
```

`KICK_TOKEN` 放在 secret `glol-rt` 里（`optional: true`，没配就禁用 `/kick`，
此时 `/kick` 直接 403 且不碰任何连接）。8790 不对公网开放，只经 Ingress。

- 踢人后 uid 会进内存封禁表，`KICK_BAN_SECONDS`（默认 600 秒）内重连会收到
  `{t:'banned'}` 并被断开；重启清空，多副本也不共享 —— 长期封禁得接账号系统。
- `uid` 先归一化（去空白/非字母数字字符、截 16 位），和 join 用同一套规则；为空或
  body 不是对象时直接 400，不会误踢匿名玩家。
- `/kick` 使用广播中账号派生的 uid。join 时 uid 和昵称只取自已验签票据，忽略客户端自报值。

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
kubectl -n idoknow exec deploy/glol-rt -- wget -qO- http://127.0.0.1:8790/health
# {"ok":true,"online":0,"proto":4,"maxPlayers":200,"banned":0,"connections":0}

# WebSocket 握手（公网，期望 101 Switching Protocols）
curl -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
     https://glol.rcpd.cc/ws
```

## CDN 注意

- `/ws` 必须绕过缓存，且 CDN 节点要开启 WebSocket 透传；CDNFly 站点已开 `websocket`，
  缓存规则里没有匹配 `ws` 的后缀，`/ws` 走动态不缓存。
- 302/456 之类的防护页会直接掐掉 WebSocket 升级请求，改 CDN 防护后要重测 101。
