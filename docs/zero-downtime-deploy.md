# 不停机发布（glol.rcpd.cc）

目标：`kubectl apply` 换镜像期间，`/api/health`、`/version.json` 与页面请求**不出现 5xx**，在途请求不中断。

## 之前为什么会断

| 问题 | 后果 |
|---|---|
| `strategy: Recreate` + `replicas: 1` | 老 pod 先被杀，新 pod 才启动 → 几十秒全站无端点，Ingress 返回 `503 no available server` |
| 就绪探针是 `tcpSocket` | 进程一 listen 就算 Ready，DB 还没连上也会被放进端点列表 |
| 没有 `preStop`、没处理 SIGTERM | pod 被删时在途 API 请求直接断连 |
| 没有 PDB | 节点 drain/升级可以一次性带走唯一副本 |
| 迁移在 `apply` **之后**跑 | 新代码可能先于表结构上线 |

## 现在的做法

### 1. 滚动更新（`deploy/k8s/resources.yaml`）

```yaml
replicas: 1
minReadySeconds: 10
strategy:
  type: RollingUpdate
  rollingUpdate: {maxUnavailable: 0, maxSurge: 1}
terminationGracePeriodSeconds: 45
```

`maxUnavailable: 0` 是关键：**新 pod 通过就绪探针之前，老 pod 不会被摘掉**。常驻仍是 1 副本，只在发版瞬间多起一个 pod（`maxSurge: 1`），不额外占资源。

### 2. 就绪 = 进程起来 + 表结构就绪（不是"DB 此刻活着"）

- `/api/ready`（`server/index.mjs` + `server/readiness.mjs`）**只读缓存**，后台按 5s TTL 刷新，最多一个在途探测：
  - 探针不打库 → kubelet 3s 一次 + 公网可访问的端点，不会把 5 连接的池子抢光
  - 查**整批迁移表**（`REQUIRED_TABLES` 23 张，含 `users`/`sessions`/`social_*`/`perf_*`/`feedback*`）
    是否都存在 → 只建了 `users` 不会就绪，002~006 没跑完也挡住
  - 查询超时（2s）只是"不再等结果"，底层查询仍挂在单在途槽里，不会因为超时反复叠加查询
  - **一旦就绪保持就绪** → DB 抖动不会把还能出静态页面的 pod 从端点里摘掉
  - 查询带 2s 超时，卡住的探测不会堆积
- `readinessProbe` 打 `/api/ready`（3s 一次，失败 2 次判定未就绪）
- `livenessProbe` 仍打轻量的 `/api/health`（20s 一次）
- `startupProbe` 打 `/api/health`（2s 一次 ×30）——tsx 冷启动慢时不会被 liveness 误杀

### 3. 优雅退出

两个容器都有 `preStop: sleep 5`（先让 Ingress 摘掉本 pod 的端点），API 进程收到 SIGTERM 后：

1. `server.close()` 停止接受新连接、等在途请求完成
2. `pool.end()` 关闭连接池
3. 退出；另有 20 秒兜底强制退出，避免卡住的连接拖死滚动更新

### 4. PodDisruptionBudget

`minAvailable: 1` —— 节点 drain/升级时不会把唯一副本一次性带走。

**注意 1**：`kubectl drain --force` **不绕过** PDB（`--force` 只管"没有控制器管理的 pod"）。
**注意 2**：`glol-web` 用 `nodeSelector: kubernetes.io/hostname: cn-hk-fxy-01` 钉在这台节点上，
所以"先 scale 到 2 再 drain"在这套部署里**行不通**——两个副本都会落在同一台机器上，
evict 一个之后 PDB 仍然挡着第二个。

现状下能做的只有三种：

| 做法 | 影响 |
|---|---|
| 先给 `glol-web` 加一台可选节点（去掉 nodeSelector/加第二台 worker），再 scale 2 → drain | 真正不停机，但要先有第二台机器 |
| `kubectl -n idoknow scale deploy/glol-web --replicas=0` → 维护完再拉起 | 明确停机，几分钟 |
| `kubectl drain <node> --disable-eviction --ignore-daemonsets` | 直接删 pod，绕过 PDB——**会停机**，只在紧急维护时用 |

维护窗口要提前公告，别指望 PDB 能变出第二台机器。

### 5. 迁移前置（`deploy/deploy-hk.sh`）

```
已有库： migrate() → apply（换镜像）→ 等 postgres/minio → 等 web rollout → 校验镜像 tag
新装库： apply → 等 postgres/minio → migrate() → 等 web rollout → 校验镜像 tag
```

老 pod 跑「上一版代码 + 新表结构」是安全的，前提是**迁移只做加法**（见下）。

新装库时为什么不会出现"新 pod 已经对外 500"：`/api/ready` 要求 `public.users` 存在，表没建好新 pod 就一直不就绪，Ingress 不会把流量导进去；`migrate()` 跑完之后的下一次探测才放行。

## 迁移规则（硬约束）

同一版发布内只允许：

- `CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`
- `ALTER TABLE ... ADD COLUMN`（带默认值或可空）
- 放宽约束（`DROP CONSTRAINT` + 更宽的 `ADD CONSTRAINT`，参考文献 `006-social-register.sql`）
- 回填数据用幂等 `UPDATE`

**不允许**在同一版里「删列 / 改列类型 / 收紧约束后立刻依赖新结构」。这类破坏性变更拆成两版：这一版让代码同时兼容新旧结构，下一版再删。

## 发版流程

```bash
# 1) 起验证器（另开一个终端，发版全程盯着，版本必须落到本次要发的 sha）
DURATION=600 EXPECT_SHA=$(git rev-parse --short HEAD) ./deploy/verify-rolling-update.sh

# 2) 发版（内部有 flock，两个终端同时发版会被拦掉；结束时核对镜像 tag）
./deploy/deploy-hk.sh
```

验证器检查 **4 个路径**（任一失败都算失败）：`/api/health`、`/version.json`、`/`（静态首页）、`/api/auth/social/config`。只做可用性压测（不要求版本变化）时加 `ALLOW_NO_CHANGE=1`。

验证器输出示例：

```
总请求: 2860  失败: 0  最长连续失败: 0  当前版本: c187a13
版本切换: 12:31:07 7b6115c → c187a13
结论：发版期间零失败，站点始终可用
```

## 回滚

```bash
kubectl -n idoknow rollout undo deploy/glol-web       # 回到上一版镜像
kubectl -n idoknow rollout status deploy/glol-web
```

迁移是加法的，回滚代码不需要回滚表结构。

### 6. nginx 优雅退出

`deploy/web.Dockerfile` 加了 `STOPSIGNAL SIGQUIT`：nginx 收到 SIGTERM 是 fast shutdown（直接断开在途连接），SIGQUIT 才会等在途请求处理完。配合 `preStop: sleep 5` 与 45s grace，请求不会被生生掐断。

### 7. 并发发版互斥

`deploy-hk.sh` 用 `mkdir`（原子，macOS 也有）在 `${TMPDIR:-/tmp}/glol-deploy-hk.lock.d` 上做互斥，残留超过 30 分钟的锁会自动清理。

这只是**同一台机器**的锁。跨机器并发由两层兜底：apply 前若发现 Deployment 正在滚动到别的 tag（`Progressing=ReplicaSetUpdated`）就直接退出；rollout 结束后再校验 `glol-api` 镜像 tag 是否等于本次 `HEAD`，不一致也失败。

## 仍然会断的组件（本次未覆盖）

- `glol-postgres`、`glol-minio` 仍是单副本 + 有状态卷，重启/升级会短暂不可用（DB 断 → `/api/ready` 503 → 但 web pod 不重启）
- 单节点 `cn-hk-fxy-01`：节点维护期间没有第二台机器承接，PDB 只能保证「不被悄悄带走」，不能保证「不停机迁移」
- 要让整站真正抗单节点故障，需要第二台 worker + 副本数 2 + Postgres 主从/MinIO 纠删码，属于另一期工程
