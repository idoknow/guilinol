## 现象（两件事，一起处理）

### 1. 管理后台数据加载过慢
- 后台总览 / 趋势页经常 12–20 秒才出数据
- 高频出现「加载失败 · 服务暂时不可用」，多刷新几次又好了

### 2. IP 统计拿到的是 CDN 节点 IP，不是用户真实 IP
- 后台 IP 维度统计里出现的全是 CDN 节点地址（`43.248.x`、`118.123.x`、`104.168.x`、`111.223.13.41` 这一批）
- 看不到真实用户 IP（应该是广西/广东等地的运营商地址）

## 已经测出来的数据（上一轮排查）

```
pg 连接池 query_timeout = 15000ms（server/index.mjs）
容器内直接跑生产代码：
  admin/overview  24h  → 20317ms
  admin/timeseries 24h → 3783ms
  admin/funnel    24h  → 198ms
慢查询日志（scope=admin-query）24h：
  admin/timeseries 9 次，中位 7031ms，P90 12098ms，最大 14404ms
  admin/overview   4 次，11950–13491ms
  Query read timeout 16 次
根因：partitions(24h) 返回 null（日汇总表只有整日粒度，滚动 24h 对不齐边界）
     → 退化成扫 perf_event 原始表 166165 行（全表 263593 行 / 279MB）
     而 partitions(7d) 是有数据的（days=3）
```

已经做过的改动（需确认是否已发版）：
- `migrations/0016_perf_hour.sql`：新增 `perf_summary_hour` / `perf_session_hour` / `perf_value_hour`（生产库已建表）
- `server/day-summary.mjs`：`partitions()` 支持 `grain:'hour'`，窗口 ≤3 天走小时表；新增 `summarizeHours()`
- `server/perf-monitor.mjs`：每 10 分钟回溯补最近 48 小时的小时汇总

## IP 这个问题怎么做

链路：浏览器 → CDN（`glol.rcpd.cc`）→ 源站 nginx → `glol-api`

- CDN 已确认会带 `X-Real-IP`（Cloudflare 链路还有 `cf-connecting-ip`），`X-Forwarded-For` 也在
- 后端现在记的是 socket 的 `remote_addr`，所以拿到的是 CDN 节点 IP
- 需要按可信代理链解析真实 IP，建议优先级：`cf-connecting-ip` → `x-real-ip` → `x-forwarded-for` 最左 → `remote_addr`
- 写入统计时最好同时保留两个字段：`client_ip`（真实用户）和 `node_ip`（CDN 节点），排查 CDN 问题时还要用节点 IP
- 参考实现已经有了：`rt/server-realtime.mjs` 里就是按这个优先级读的，`RT_IP_DEBUG=1` 可打印头信息，可以直接照抄

## 验收标准

1. 后台总览 24h：P95 < 1s；命中缓存 < 300ms；不再出现 `Query read timeout`
2. IP 统计里出现真实用户 IP（能定位到省/市/运营商），同时保留 CDN 节点 IP 字段
3. 联机服务、支付回调、后台登录都不受影响

## 涉及文件

- `server/day-summary.mjs`、`server/perf-monitor.mjs`、`server/admin-analytics.mjs`、`server/index.mjs`
- `migrations/0016_perf_hour.sql`（已建表）
- `rt/server-realtime.mjs`（IP 解析的参考实现）
- 缓存层：`cachedPerfQuery`（server/index.mjs 里已有，检查命中率）

有不清楚的直接在这个工单里问我，生产库我这边有权限，需要建表/跑迁移可以配合。
