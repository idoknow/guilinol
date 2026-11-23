# 网上桂林 · 联机服务部署（全服一个大房间）

客户端连的是 **同一个域名下的 `/ws`**（`wss://你的域名/ws`），由 nginx 反代到本机的 8790。
所以只要把下面这套跑起来、nginx 加上 `/ws`，前端不需要改任何配置。

## 一、上传与安装

```bash
mkdir -p /opt/guilin-rt && cd /opt/guilin-rt
# 传上来：server-realtime.mjs、package.json
npm i                 # 只装 ws
node -v               # 需要 18+
```

先手动跑一下确认能起：

```bash
PORT=8790 node server-realtime.mjs
curl http://127.0.0.1:8790/health     # {"ok":true,"online":0}
```

## 二、systemd

```bash
cp guilin-rt.service /etc/systemd/system/
# 改一下里面的 KICK_TOKEN
systemctl daemon-reload && systemctl enable --now guilin-rt
systemctl status guilin-rt --no-pager
journalctl -u guilin-rt -f            # 看日志
```

## 三、nginx

把 `nginx-ws.conf` 里的两段贴进站点的 `server {}`（和 `/api/` 并列），然后：

```bash
nginx -t && systemctl reload nginx
```

验证（把域名换成你自己的）：

```bash
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
     https://guiling.gxufl.top/ws
# 期望：HTTP/1.1 101 Switching Protocols
```

## 四、协议

JSON over WebSocket，路径 `/ws`。

客户端 → 服务端：

| 消息 | 说明 |
| --- | --- |
| `{t:'join', uid, name, avatar, x,y,z, yaw}` | 进服（`avatar` 就是角色页那份外形 JSON） |
| `{t:'pos', x,y,z, yaw, v, bike, bx,bz,byaw, hb,hx,hz,hyaw, cr,gr,dn,pn,hp, sc,sb,sp,br}` | 位置 + 姿态 + 血量 + 抽烟状态，最快 20 Hz（服务端会丢过密的包） |
| `{t:'hit', id, dmg}` | 出拳打中 `id` 这个人（服务端限频 5 次/秒，伤害夹到 1..35） |
| `{t:'revive', id}` | 扶起倒在地上的 `id`（对方必须真的在倒地状态） |
| `{t:'avatar', avatar}` | 中途换装，服务端转发给别人就地换模型 |
| `{t:'who'}` | 拉一次房间名单 |
| `{t:'chat', text}` | 聊天，1.2 秒防刷 |

服务端 → 客户端：`welcome` / `join` / `leave` / `pos` / `hit` / `revive` / `avatar` / `chat` / `online` / `banned`。

### 姿态 / 战斗字段（`pos` 里顺带传，不额外开消息）

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `cr` | 0 / 1 | 蹲着 |
| `gr` | 0 / 1 | 着地（跳在空中是 0） |
| `dn` | 0 / 1 | 倒地 |
| `pn` | 0 / 1 | 正在出拳 |
| `hp` | 0–100 | 血量。出手的一方靠它看到自己打掉了多少，也画在对方头顶那条小血条上 |

`{t:'hit', dmg, by, byId}` 只发给被打的那个人：`dmg` 是伤害，`by` 是出手者昵称（显示用），
`byId` 是出手者的会话 id —— 被打的一方拿它换算「这一下是从哪个方向来的」，屏幕上才会打对那道红弧。

### 抽烟字段（`pos` 里顺带传，不额外开消息）

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `sc` | 0 / 1 / 2 | 0 没抽、1 正在点烟（取烟 + 打火机）、2 点着了在抽 |
| `sb` | 0–1800 | 剩余可燃时间 ×10；一直接着不吸大约 1800 往下掉，每吸一口一次跳 300 |
| `sp` | 0–999 | 吸了几口的累计计数，换值就说明刚吸了一口（对方据此喷大烟 + 抬右手） |
| `br` | 0–3 | 品牌序号，决定对方手里那包烟画成哪一款 |

有了这四个数，别人就能看见你「左手举烟盒、右手拿打火机点烟、抬起手吸一口、烟头冒烟、
烟越抽越短、抽完掉在地上」的全套动作——不需要单独一条动画消息，也不用同步逐帧姿势。

`avatar` 会做白名单校验（`v:1`、`body` 只能是 m/f、发型/穿搭必须在角色系统的枚举里、整包 ≤512 字节），
脏数据不会传到别人的客户端。

## 五、运维

```bash
# 在线人数
curl -s http://127.0.0.1:8790/health

# 封禁某个 uid（网页后台也可以调）
curl -X POST http://127.0.0.1:8790/kick \
     -H 'content-type: application/json' \
     -H 'x-kick-token: 你的KICK_TOKEN' \
     -d '{"uid":"E8A4F4E4","reason":"违规"}'
```

- 8790 **不要**对公网开放，只走 nginx 反代。
- 单房间上限 `MAX_PLAYERS`（默认 200）。人数再往上要改成按区域分房间。
- 位置广播是「谁发谁转发」，200 人满员时上行约 2000 包/秒，普通 2 核机器够用；
  真到瓶颈再按距离裁剪（只转发 300 m 内的玩家）。

## 六、前端开关

前端默认是**单机**，要进联机必须满足：

- 首页点「联机」进入（写 `localStorage['guiling.mp']='1'`）
- 或者手动：`localStorage.setItem('guiling.mp','1')` 后刷新

调试时可以指定地址：`localStorage.setItem('guiling.ws','ws://127.0.0.1:8790/ws')`。

左上角徽标会显示 `在线玩家：N 人`；连不上时会变成 `联机重连中… n/6`，
六次失败后显示 `联机不可用 · 点此重连`，点一下即可手动重试。

## 七、本地自测（不需要 nginx）

```bash
# 终端 1：静态站
cd 本地入口 && node serve.mjs            # http://127.0.0.1:8788

# 终端 2：联机服务
cd 本地入口 && PORT=8790 node server-realtime.mjs

# 浏览器控制台（每个窗口都要执行一次）
localStorage.setItem('guiling.mp','1')
localStorage.setItem('guiling.ws','ws://127.0.0.1:8790/ws')
location.reload()
```

开两个窗口，各自建好角色，应该能在街上互相看到，头顶有名字和血条，走路/跑步/骑车动作都会同步。
再各自按 `1`–`6` 点上一根烟，对面应该能看见你举烟盒、点打火机、抬手吸烟和烟头冒的烟。

**改过 `server-realtime.mjs` 之后一定要重启后端进程**，否则前端会提示「联机服务版本过旧 ·
蹲下/受击不同步」——因为新字段（`cr` `dn` `pn` `hp`、`hit` / `revive` 消息）都在服务端解析和转发。

## 八、怎么看线上跑的是不是最新版

`/health` 里带一个协议版本号 `proto`，改字段就 +1：

```bash
curl -s http://127.0.0.1:8790/health
# 期望：{"ok":true,"online":0,"proto":3}
```

| proto | 含义 |
| --- | --- |
| 1 | 只有位置，最老的版本 |
| 2 | 有 `mv` / `cr` / `gr` / `dn` / `pn`（蹲下、倒地、出拳、在不在动） |
| 3 | 再加 `hp`（血量）和 `hit.byId`（挨打方向）← 当前 |

看到 `proto:2` 说明服务端还没更新；**`/health` 里连 `proto` 都没有，说明跑的是 proto 1 那一版。**

## 九、更新一个已经装好的服务（zip 装的也一样）

联机服务没有任何 npm 依赖变化，**只要换一个文件**：

```bash
# 1) 本地把最新的 server-realtime.mjs 传上去
scp deploy/realtime/server-realtime.mjs 用户@服务器:/opt/guilin-rt/

# 2) 重启
ssh 用户@服务器
sudo systemctl restart guilin-rt
curl -s http://127.0.0.1:8790/health        # 要看到 "proto":3
sudo systemctl status guilin-rt --no-pager
```

`/opt/guilin-rt` 换成你实际的目录（用 `systemctl cat guilin-rt | grep WorkingDirectory` 查）。
不用 `npm i`，不用动 nginx，不用重建 `dist` —— nginx 只做 `/ws` 的反代，跟版本无关。

> 前端和后端要**一起**更新：服务端换了新字段，但线上 `dist` 还是旧的话，
> 旧客户端不会发 `hp` / 不会显示准心提示，看上去仍然「没修好」。
> 前端更新是 `npm run build` 之后替换 `dist/`（或按 `docs/deploy-hk.md` 走 k8s 发版）。
