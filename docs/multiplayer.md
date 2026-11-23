# 联机服务（glol-rt）

全服一个大房间的实时同步服务：JSON over WebSocket，路径 `/ws`。客户端固定连
`wss://<当前域名>/ws`（可用 `localStorage['guiling.ws']` 覆盖），所以只要 Ingress 把
`/ws` 转给 `glol-rt:8790`，前端不需要任何构建期配置。

> **现状**：`/ws` 已在线上跑通（101 握手 + welcome/online/chat 实测通过），但**本仓库的
> `web/` 里还没有联机客户端**——`guiling.mp`、联机重连这些逻辑只存在于天空下起雨本地构建
> 的 dist（`20261123-1525`）里。按本仓库现有 `web` 源码构建部署，用户点不进联机模式。
> 要真正开起来，得先把他那份 `web`（以及 dist 里用到的 `/api/citizen/avatar`、
> `/api/citizen/photo`、`/api/sponsors`）推上来，由 CI 一起出 `glol-web`/`glol-api` 镜像；
> 服务端这边不用再改。

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
- `uid` 未做鉴权，只用于展示和定位：换一个 uid 仍可重新进来。这里挡的是「同名顶号」
  和「被踢后立刻换回来」，不是身份认证。

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
# {"ok":true,"online":0,"proto":3,"maxPlayers":200,"banned":0,"connections":0}

# WebSocket 握手（公网，期望 101 Switching Protocols）
curl -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
     https://glol.rcpd.cc/ws
```

## CDN 注意

- `/ws` 必须绕过缓存，且 CDN 节点要开启 WebSocket 透传；CDNFly 站点已开 `websocket`，
  缓存规则里没有匹配 `ws` 的后缀，`/ws` 走动态不缓存。
- 302/456 之类的防护页会直接掐掉 WebSocket 升级请求，改 CDN 防护后要重测 101。
