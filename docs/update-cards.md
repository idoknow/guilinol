# 玩家更新介绍卡

成功落地后，每次刷新只启动一次异步检查。`users.first_game_entry` 首次由登录玩家的 unseen 请求写入；该请求返回 `[]`。迁移时已有云存档的玩家确定进过游戏，使用其建号时间作为历史下界。未登录不查询数据库、不建记录。只选进场之后发布、仍有效、没有回执的卡，按发布时间和 ID 正序，每页最多 10 张。

## 发版机

需要 Node 22、Python 3 和带 WebP 编码的 Pillow。`UPDATE_CARD_ORIGIN` 设为目标站点的 HTTPS origin，`UPDATE_CARD_TOKEN` 从私有凭据文件载入；不要开启 shell trace 或输出环境变量。

```sh
export UPDATE_CARD_TOKEN="$(cat ~/.credentials/glol-update-card-token)"
node scripts/publish-update-card.mjs --kind modeling --title '广场开放' \
  --summary '车站旁边新增了广场。' --how '从车站出门向左走。' \
  --image square.png --release "$RELEASE_SHA" --dry-run
```

去掉 `--dry-run` 即发布；可重复 `--image`（共 1–3 张）。每张自动转 WebP，宽不超过 1280 px、大小不超过 300 KiB。dry-run 也实际编码，但不联网。`--kind` 为 `gameplay` 或 `modeling`；标题、说明、体验方式分别最多 20、80、60 个 Unicode 码点。默认 slug 为 `kind-release_sha`，同版本同分类发多张卡时用 `--slug` 区分。重复 slug 返回 409，不覆盖原卡。

`node scripts/publish-update-card.mjs --list` 列出卡片；`--deactivate <slug>` 下线。令牌仅用于卡片管理，不能操作玩家回执或其他后台接口。部署需先运行 `deploy/postgres/019-update-cards.sql`，再将卡片 Secret 的 `UPDATE_CARD_TOKEN` 注入 API。无需为存储桶开放匿名读取：截图在已有反馈桶的独立 `update-cards/` 前缀，通过专用同源只读 URL 访问。下线不撤销已分享的图片 URL，请只上传可公开的截图。

## API 和占位层

- `GET /api/updates/unseen` → 卡片数组，含 `id,slug,kind,title,summary,how_to,images,release_sha,published_at,active`。`images` 是同源 URL 数组。
- `POST /api/updates/:id/seen`，JSON `{ "action": "viewed" }` 或 `skipped`。玩家使用原有登录 cookie，写请求需要同源 Origin。重复请求保留首次动作。
- `GET/POST /api/admin/updates` 列表/发布，`POST /api/admin/updates/:slug/deactivate` 下线。支持已验证管理员会话或卡片专用 Bearer。发布字段与卡片一致，但不接受客户端指定的 ID、发布时间或状态，`images` 传 Base64 WebP 数据。
- 弹层 `.update-cards`（样式在 `web/src/ui/update-cards.css`，随懒加载模块一起加载）沿用商店的沥青风格：沥青黑面板，桂花金只用在「下一张 / 知道了」，类型徽标 `新玩法` 用漓江青、`新建模` 用桂花金。卡片自上而下依次是 16:9 大图（多张时可横滑，带圆点）、标题、说明和「怎么体验」框。手机竖屏为底部抽屉，横屏为左图右文。左右方向键或在文字区左右滑动可以翻页；最后一张按钮变成「知道了」，同时隐藏「跳过全部」。卡片数据里的 `kind` 决定配色，模拟卡可以不带，默认按 `gameplay` 处理。每次开关对 `window` 派发 `updates:open` / `updates:close`。前后翻时同一卡只发一次回执；跳过全部会继续处理后续页。写失败保留弹层，按钮可重试。
- `?verify` 落地后用 `window.updateCards.mock([{id:'demo',title:'广场',summary:'新广场开放',how_to:'去车站',images:[]}]); window.updateCards.open()` 预览。模拟卡不写回执。

## 本地验证

`UPDATE_CARDS_TEST_DB` 设为本机测试 PG 的连接串（需有建 schema 权限），执行 `node scripts/verify-update-cards.mjs`。测试在随机 schema 内运行迁移、真实会话查询和回执写入，使用内存对象存储及 Playwright 测试发布脚本到浏览器刷新全过程，结束后删除测试 schema。可用 `CHROMIUM` 指定浏览器。另运行 `npm run check:api`、`npm run build` 以及有开发世界数据时的 `npm run verify:walk:quick`。
