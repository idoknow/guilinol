## 登录存档同步

登录后，客户端将 `glol.save.v1` 同步到现有 `player_saves` 表，不需要生产迁移。游客继续只写本地。每次登录先读取云端；游戏写档后合并发请求，恢复联网、窗口重新获得焦点以及前台每 30 秒也会检查。相同设备切换账号时缓存按用户 ID 隔离，以便保留尚未上传的改动。

同一存档按客户端毫秒时间戳 `updatedAt` 整份取新，不把两份余额或奖励相加；平局取服务器已有的版本。`GET /api/me/save` 返回 `save`（可以是 `null`）和 `revision`。PUT 以 `If-Match: "<revision>"` 提交，版本冲突重新读取；两种请求都要求有效会话和匹配的 `X-Save-Owner`。限制 64 KiB；早于云端的写入不更新数据库。头像仍由 `/api/me/avatar` 管理，两条写入路径共用同一个版本号。

本地验证：`npm run verify:cloud-save` 需要 Docker、本机已有 `postgres:16-alpine` 镜像及 Playwright Chromium。脚本只启动绑定回环地址的临时 PostgreSQL，使用项目迁移、生产数据库适配器和实际会话处理器，结束后移除容器，不访问 hk01。
