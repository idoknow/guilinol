# 市民卡接入

- `GET /api/citizen/:uid` 无需登录。返回 `{uid, nickname, gender, registeredAt, photoUrl}`；`gender` 是角色的 `m` / `f`，未创建时为 `null`，`registeredAt` 为 Unix 秒。未上传时 `photoUrl` 为 `null`，未找到已验证账号时返回 404。
- `POST /api/citizen/photo` 需要同源、有效登录会话，直接发送原始 `image/webp`（静态角色图，最多 65,536 字节），不带目标账号参数。返回 `{photoUrl}`。每账号每分钟最多 6 次，第 7 次返回 429。
- `GET /api/citizen/:uid/photo` 返回 WebP 本体；应使用卡片返回的 `photoUrl` 而不是自行拼接对象存储地址。
- `/backpack.html` 是独立背包占位；`web/src/citizen/items.ts` 提供只读物品列表和市民卡查看链接。`/id.html?uid=100000` 是公开扫码页，二维码只编码同源的绝对查看 URL。两个页面都不依赖世界加载。
- 发布 API **前**先应用 D1 `migrations/0015_citizen_photo.sql` 或自托管 PG `deploy/postgres/012-citizen-photo.sql`；沿用已有对象存储绑定，头像对象使用独立的 `citizen/` 前缀。无需补传已有用户头像。
