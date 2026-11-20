## 切流前（不改 DNS）

目标只限香港节点 `cn-hk-fxy-01`、`idoknow/glol-*`。保留原 Pages/D1/R2 作为回滚源。部署前后分别在 hk01 执行 `kubectl top node cn-hk-fxy-01`。容器内存 limits：nginx 64 Mi、API 384 Mi、PG 384 Mi、MinIO 512 Mi，常驻共 1344 Mi；反馈桥运行时再加 192 Mi，总上限 1536 Mi。使用 Recreate 和 CronJob Forbid 避免滚动或定时任务重叠。local-path PVC 不是跨节点备份。

1. 准备与发布版本匹配的 `public/world/`，确保清单引用的文件齐全。sg 保持工作树干净，安装 Docker、Node 22、kubectl，SSH 到 hk01 无需 sudo。`test:api`、`test:bridge`、`verify:auth`、`verify:feedback`、`verify:admin` 使用临时 Docker PG 和 MinIO，不复用线上数据库。浏览器验证需要先构建 `dist`。
2. 在 `idoknow` 安全预置 `glol-env`。后者含 `POSTGRES_PASSWORD`（随机十六进制）、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`（glol 专用 MinIO）、原有 `RESEND_API_KEY` 和 `BRIDGE_TOKEN`。不复制共享 Docker 登录文件、不通过 issue 或 Git 传值。Ingress 须覆盖客户端自报的 `X-Real-IP`，并传递受信任的客户端地址，以保持原 IP 限流行为。 镜像按 SHA 匿名拉取。
3. Actions 在 PR 分支 push 或手动触发时构建并推送 web 和 api 的 commit SHA；构建时从当前线上站读取按 `deploy/world.sha256` 固定的公开 world 资源。确认两包 Public 后运行 `npm run deploy:hk`；脚本只等待镜像并应用源站，不推镜像、不切流。桥保持暂停，启用前须另行备齐同 SHA 桥镜像和专用 Secret。
4. sg claude 在停写窗口重新导出，传入只读快照目录。`CONFIRM_REPLACE_HK_GLOL=yes bash deploy/import-hk.sh /absolute/export` 将 `d1-glol.sql` 流式事务替换到指定 glol 库，逐表校验；不申请 Cloudflare 令牌，不复制导出文件。
5. 从 sg 通过仅绑定回环的 SSH 隧道连接 hk01 的 glol-minio，设置 `S3_ENDPOINT` 和 glol 专用 AWS 凭据。运行 `node deploy/sync-objects.mjs /absolute/export`；从 `r2/manifest.json` 和 `r2/objects` 校验 SHA-256，增量写入后回读校验，遇到多余对象停止。`--check-only` 只查源文件。
6. 使用 `curl --resolve glol.rcpd.cc:443:38.39.30.208 https://glol.rcpd.cc/`，不使用 `-k`。相同 Host 核验 `/world/manifest.json`、至少一个清单分块、`/api/me` 未登录 401、静态缓存头。浏览器定向同一 IP 验证注册、邮箱验证码、登录、私有图片上传与回读、反馈提交及管理员界面。不要用生产用户凭据做冒烟测试。分别检查三个 Deployment 的 Pod 内存和节点使用量，只记录数字。

## 切流与回滚（sg claude）

切流时先 `systemctl --user disable --now glol-feedback-bridge.timer`，等待 `glol-feedback-bridge.service` 正常退出。将旧 `BRIDGE_STATE` 的持久日志（`*.json`，含已派单关联和去重标记，不含 lock、run-* 和原照片）通过私有通道复制到 `idoknow/glol-feedback-bridge` PVC 的根目录（容器内 `/state`），校验文件数与摘要。旧状态目录保留不删。目标验收完成后由 sg claude 执行 `kubectl -n idoknow patch cronjob glol-feedback-bridge --type=merge -p '{"spec":{"suspend":false}}'`。同时把部署清单中的暂停状态改为正式值，否则下次部署会再次暂停。观察首个 Job 正常退出，确认只存在一个派单方。回滚时顺序反过来：暂停集群 CronJob、等待在途 Job 结束、回同步最新日志，再恢复 sg timer；不要两端同时运行。

1. 停止源站写入，暂停反馈桥写入；同时限制目标端写入直至同步与验证结束。记录切换时间和旧的代理 CNAME。
2. 再次导出/导入一致的 D1 快照并增量同步 R2。逐表行数、对象计数、总字节数均一致才继续。保留短暂只读期间的快照恢复能力，不把文件留在仓库。
3. 将 `glol.rcpd.cc` 从 `CNAME guilinol.pages.dev` 改为 `A 38.39.30.208`，保留橙云。重复检查公开地址、源站版本、会话、反馈与管理；通过后恢复写入、恢复桥并观察错误率。
4. 需要回滚时先停写，把 DNS 改回原 CNAME 并保持橙云。若 hk01 已接受新写入，先保全 PG/MinIO，再由 Rock 决定如何对账回补；DNS 回切不会恢复这部分数据。确认 Pages 正常后恢复桥。未经 Rock 确认，不删除任一侧资源。

## 新增验收项

- [ ] `kubectl kustomize deploy/k8s` 中所有对象都是 `idoknow/glol-*`，无宿主机服务依赖；切流后确认旧 timer 未启用。
- [ ] 核对 `glol-feedback-bridge` 的 schedule、Forbid、suspend 和持久化 `/state`。首次部署只验配置，不创建测试 Job，不派真实单。镜像随构建打包匹配的 Multica CLI、`gh`、`flock` 和建模模板。凭据不进入构建上下文。
- [ ] 使用 `idoknow/glol-feedback-bridge` Secret。保留 sg 专用环境的 `BRIDGE_ENABLED`、`BRIDGE_TOKEN`、`BRIDGE_PROJECT`、`BRIDGE_PARENT`、`BRIDGE_ORIGIN`、`MULTICA_WORKSPACE_ID`；`BRIDGE_AGENT` 固定为 `d0320da1-ce8c-470a-a5a7-1976261a067d`。`GH_TOKEN` 仅授予 `idoknow/guilinol` 的 PR/提交只读权限。使用桥专用 Multica 机器身份，按 `cli-<原文件名>` 将其独立登录配置放入同一 Secret（例如 `cli-config.json`）；启动时在私有临时 HOME 重建配置。不要复制个人多工作区配置、sg 宿主机 token 或任务级 `MULTICA_*`。CLI 路径、PATH、状态路径由镜像指定，入口用 `env -i` 重建环境。
- [ ] `glol-web` 的 API 容器从 `glol-env/RESEND_API_KEY` 读取 Resend key；验证邮件仍由 `网上桂林 <noreply@mail.idoknow.top>` 发出。不要记录验证码、key 或收件地址。
- [ ] backup-cron 对接：`glol-postgres` 容器名固定，`POSTGRES_DB=glol`、`POSTGRES_USER=postgres`。备份方可按 namespace 和完整容器名定位后在容器内执行 `pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"`，备份文件置于容器外，验收时用 `pg_restore --list` 并在隔离库做恢复。MinIO 的 PVC `idoknow/glol-minio` 根目录直接挂载到 `/data`（无 subPath，包含 `.minio.sys`）。卷快照应停写或保持一致性，不推测宿主机动态 PV 路径。外部 backup-cron workflow 和首次实际恢复由 sg claude 接入验收。
