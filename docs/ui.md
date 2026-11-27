# UI 体系「山水印」

网上桂林所有界面（主界面、游戏内 HUD、对话框、卡片、地图、反馈）共用一套设计语言。唯一的来源是 `web/src/ui/theme.css`：颜色、圆角、阴影、动效、字体都在那里定义成 `--ui-*` 变量，组件文件只引用变量，不再写新的色值。

## 定位

这是一款**游戏**，面向所有人，而不是技术演示。文案用口语、不出现技术词（FPS、调用数、坐标等只在 `?debug` / `?verify` 下显示）。

## 三种材质

| 材质 | 用在哪 | 主要变量 |
|---|---|---|
| 青玉玻璃 | 浮在画面上的控件：HUD 按钮、时辰天气条、深色对话框（关于、账号、反馈、玩法） | `--ui-glass` `--ui-glass-strong` `--ui-glass-solid` `--ui-glass-line` |
| 宣纸 | 需要阅读的东西：景点卡、景册、地图、主界面那张纸、输入框 | `--ui-paper` `--ui-paper-2` `--ui-ink` `--ui-ink-soft` `--ui-ink-line` |
| 朱砂印 | 当前画面上**唯一**最重要的动作（开始游览、提交、盖印、下车），以及印章本身 | `--ui-seal` `--ui-seal-hi` |

朱砂不做装饰；同一屏只出现一个朱砂主按钮。朱砂按钮平涂，不加彩色投影或高光。

## 形状与字

- 控件一律药丸形（`--ui-r-pill`），高度 `--ui-h`（38 px，触屏 42 px）。
- 深色对话框 18 px 圆角（`--ui-r-lg`），右上角统一是圆形 ×（`.about-close`，文字保留给读屏和测试）。
- 宣纸卡片 6 px 圆角（`--ui-r-paper`），像一张纸。
- 全站只用一种衬线字（`--ui-serif`），标题加大字距（.16–.3em）。

## 组件

`theme.css` 提供：`.ui-btn`（玻璃）、`.ui-btn--seal`（主动作）、`.ui-btn--paper`、`.ui-btn--ink`（宣纸上的墨线次按钮）、`.ui-btn--ghost`、`.ui-btn--lg`、`.ui-icon-btn`、`.ui-panel`/`.about-panel`（深色对话框）、`.ui-field`（宣纸输入框）、`.ui-tag`、`.ui-seal`（印章字块）。

## 页面结构

- **主界面** `web/src/ui/home.ts`：直接打开网站时先到这里。背景是游戏内实景截图轮播（`public/home/*.webp`，用 `node scripts/home-shots.mjs` 从构建产物重新生成），右下角写当前景名。实景上压一张宣纸（IDOK-468）：Logo、标题、三个入口（联机＝唯一朱砂按钮，游览＝墨线按钮，单人＝文字按钮）、链接和署名都在纸上；不加徽章、图标块、卖点列表。右上两枚青玉胶囊：抖音官方号、登录/注册。手机竖屏纸片贴底，横屏靠左；手机默认只露标题和三个入口，说明、链接、署名收在「更多」里（`.home.more`）。验收：`npm run verify:home`。
- **游戏内**：左上“菜单 + 账号”（属于“你”），右上 dock（地图、模式、景册、拍照、反馈，属于“游戏”）。菜单或 Esc 回主界面，3D 场景暂停。
- **带参数的链接直接进游戏**：`?verify` `?spawn` `?view` `?mode` `?cam` `?feedback` `?play`（分享、反馈视角、测试脚本都靠它）。

## 登录注册流程

登录是可选的，只用于提交反馈和接收回复提醒；每个账号页面底部都有“不登录也能玩 · 继续游玩”。

1. 登录 / 注册 两个标签页切换。
2. 注册：填写（邮箱、密码、昵称）→ 邮箱六位验证码 → 完成（自动登录）。进度条显示三步。
3. 忘记密码：输入邮箱 → 收验证码 → 设新密码 → 回到登录。
4. 重新发送验证码有 60 秒冷却。
5. 我的账号：头像字、昵称、邮箱、反馈邮件提醒开关、退出登录。

## Logo 与「关于」页（IDOK-148）

- Logo 是成员设计的像素画，原图 `docs/brand/logo-source.jpg`。`python3 scripts/brand-logo.py` 生成全部派生图：`public/brand/logo.webp`（关于页、进城加载卡）、`emblem.webp`（主界面标题左上的宣纸小卡、关于页 Logo 设计者卡）、`favicon-32.png` / `brand/favicon-64.png`、`apple-touch-icon.png`、`brand/icon-*.png`（manifest）。
- Logo 底是白的：放在浅色/宣纸底上时给 `<img>` 加 `mix-blend-mode:multiply`，白底就透出底色；不要直接放在深色玻璃上。
- 「关于」页的贡献者名单在 `web/src/ui/contributors.ts`，按人列，每项贡献只写几个字（写代码 / 设计 / 实拍 / 反馈），不贴仓库 contributors。头像是该账号在游戏里的角色外形（`avatar` 字段，取自线上存档 `glol.avatar.v1`；没建角色的用默认外形），改完跑 `CHROMIUM=/usr/bin/chromium node scripts/contributor-portraits.mjs` 重新渲染 `public/contributors/*.webp`。玩家反馈处理完后，把反馈者的游戏昵称和反馈内容加进去（页面上写了「被采纳的反馈会署上你的昵称」）。只写昵称与公开主页。
