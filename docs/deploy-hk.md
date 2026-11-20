## 切流前（不改 DNS）

目标只限香港节点 `cn-hk-fxy-01`、`idoknow/glol-*`。保留原 Pages/D1/R2 作为回滚源。部署前后分别在 hk01 执行 `kubectl top node cn-hk-fxy-01`。所有容器内存 limits：nginx 64 Mi、API 384 Mi、PG 384 Mi、MinIO 512 Mi，共 1344 Mi。使用 Recreate 避免滚动期间重复占用。两个 4 Gi local-path PVC 不应删除，不是跨节点备份。

1. 准备与发布版本匹配的 `public/world/`，确保清单引用的文件齐全。sg 保持工作树干净，安装 Docker、Node 22、kubectl，SSH 到 hk01 无需 sudo。`test:api`、`test:bridge`、`verify:auth`、`verify:feedback`、`verify:admin` 使用临时 Docker PG 和 MinIO，不复用线上数据库。浏览器验证需要先构建 `dist`。
2. 在 `idoknow` 安全预置 `glol-registry`（仅能拉取 glol 私有包）和 `glol-env`。后者含 `POSTGRES_PASSWORD`（随机十六进制）、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`（glol 专用 MinIO）、原有 `RESEND_API_KEY` 和 `BRIDGE_TOKEN`。不复制共享 Docker 登录文件、不通过 issue 或 Git 传值。Ingress 须覆盖客户端自报的 `X-Real-IP`，并传递受信任的客户端地址，以保持原 IP 限流行为。
3. `npm run deploy:hk`；等待三个 Deployment 就绪、`Certificate/glol-tls` Ready。部署脚本只处理源站，不切流。不要在运行中的生产站执行快照替换。
4. 为 D1 注入获准导出 glol 的 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`，在可接受的时间窗口运行 `CONFIRM_REPLACE_HK_GLOL=yes bash deploy/import-hk.sh`。Wrangler 提示导出期间可能短暂无法查询。仅在被忽略的私有临时目录生成导出，退出即清理。目标快照事务替换 11 张应用表（含无主键的用量表），保留外键，禁用会产生重复副作用的用户触发器，逐表对数，并复位序列。CF 内部表不导入。
5. 向 `idoknow/glol-minio` 建立只绑定回环地址的 kubectl port-forward（从 sg 使用 SSH 转发到 hk01 回环地址）。设置本地 `S3_ENDPOINT`、目标 MinIO `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`、源 `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`（仅 `glol-feedback` list/get）和 `CLOUDFLARE_ACCOUNT_ID`。执行 `node deploy/sync-objects.mjs`，保留对象数和总字节数。不按 key 逐一打印；增量仅覆盖新增/变更，若目标有额外对象会中止而非静默删除。验收测试写入的目标照片须与同步分开，演练后清理自建测试数据再同步。
6. 使用 `curl --resolve glol.rcpd.cc:443:38.39.30.208 https://glol.rcpd.cc/`，不使用 `-k`。相同 Host 核验 `/world/manifest.json`、至少一个清单分块、`/api/me` 未登录 401、静态缓存头。浏览器定向同一 IP 验证注册、邮箱验证码、登录、私有图片上传与回读、反馈提交及管理员界面。不要用生产用户凭据做冒烟测试。分别检查三个 Deployment 的 Pod 内存和节点使用量，只记录数字。

## 切流与回滚（sg claude）

1. 停止源站写入，暂停反馈桥写入；同时限制目标端写入直至同步与验证结束。记录切换时间和旧的代理 CNAME。
2. 再次导出/导入一致的 D1 快照并增量同步 R2。逐表行数、对象计数、总字节数均一致才继续。保留短暂只读期间的快照恢复能力，不把文件留在仓库。
3. 将 `glol.rcpd.cc` 从 `CNAME guilinol.pages.dev` 改为 `A 38.39.30.208`，保留橙云。重复检查公开地址、源站版本、会话、反馈与管理；通过后恢复写入、恢复桥并观察错误率。
4. 需要回滚时先停写，把 DNS 改回原 CNAME 并保持橙云。若 hk01 已接受新写入，先保全 PG/MinIO，再由 Rock 决定如何对账回补；DNS 回切不会恢复这部分数据。确认 Pages 正常后恢复桥。未经 Rock 确认，不删除任一侧资源。
