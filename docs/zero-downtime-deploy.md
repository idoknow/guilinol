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

### 2. 就绪 = 真能干活

- `/api/ready`（新增，`server/index.mjs`）：进程启动后第一次 `select 1` 打通 Postgres 才 200，之前 503；**打通过一次后锁存为 200**（DB 之后抖动不再摘端点——就绪是整 pod 级别，摘了会把 nginx 静态站一起 503）；收到 SIGTERM 后 503
- 探针请求（UA `kube-probe/`）不计入 perf_server 路由统计
- `readinessProbe` 打 `/api/ready`（3s 一次，失败 2 次判定未就绪）
- `livenessProbe` 仍打轻量的 `/api/health`（20s 一次）
- `startupProbe` 打 `/api/health`（2s 一次 ×30）——tsx 冷启动慢时不会被 liveness 误杀

### 3. 优雅退出

两个容器都有 `preStop`，先 `sleep 5` 让 Ingress 摘掉本 pod 的端点；nginx 随后 `nginx -s quit` 优雅退出并等在途请求（nginx 对 SIGTERM 是 fast shutdown，不能直接吃）。API 进程收到 SIGTERM 后：

1. `server.close()` 停止接受新连接、等在途请求完成
2. `pool.end()` 关闭连接池
3. 退出；另有 20 秒兜底强制退出，避免卡住的连接拖死滚动更新

### 4. PodDisruptionBudget

`minAvailable: 1` —— 节点 drain/升级时不会把唯一副本一次性带走（会阻塞 drain，需要显式 `--force` 或先扩容）。

### 5. 迁移前置（`deploy/deploy-hk.sh`）

```
已有库 → 先 migrate() → 再 apply（换镜像）→ 等 rollout → 首次装库才在 apply 后补迁移
```

老 pod 跑「上一版代码 + 新表结构」是安全的，前提是**迁移只做加法**（见下）。

## 迁移规则（硬约束）

同一版发布内只允许：

- `CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`
- `ALTER TABLE ... ADD COLUMN`（带默认值或可空）
- 放宽约束（`DROP CONSTRAINT` + 更宽的 `ADD CONSTRAINT`，参考文献 `006-social-register.sql`）
- 回填数据用幂等 `UPDATE`

**不允许**在同一版里「删列 / 改列类型 / 收紧约束后立刻依赖新结构」。这类破坏性变更拆成两版：这一版让代码同时兼容新旧结构，下一版再删。

## 发版流程

```bash
# 1) 起验证器（另开一个终端，发版全程盯着）
DURATION=600 ./deploy/verify-rolling-update.sh

# 2) 发版
./deploy/deploy-hk.sh
```

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

## 仍然会断的组件（本次未覆盖）

- `glol-postgres`、`glol-minio` 仍是单副本 + 有状态卷，重启/升级会短暂不可用（DB 断期间 API 返回 500，静态站照常；`pool.on('error')` 保证空闲连接被断时 API 进程不崩，DB 回来自动重连）
- 单节点 `cn-hk-fxy-01`：节点维护期间没有第二台机器承接，PDB 只能保证「不被悄悄带走」，不能保证「不停机迁移」
- 要让整站真正抗单节点故障，需要第二台 worker + 副本数 2 + Postgres 主从/MinIO 纠删码，属于另一期工程
