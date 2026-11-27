# UI 体系「山水印」

网上桂林所有界面（主界面、游戏内 HUD、对话框、卡片、地图、反馈）共用一套设计语言：桂林山水 + 木刻书页 / 印章。唯一的来源是 `web/src/ui/theme.css`：颜色、圆角、阴影、间距、动效、字体都在那里定义成 `--ui-*` 变量，组件文件只引用变量，不再写新的色值、圆角和字号。

S1（2026-11）重做了「游戏外」界面（主界面、账号、加载、关于、指南、设置、竖屏提示、更新卡/更新条、封禁提示），并把令牌改成下面这一版；S2（游戏内 HUD / 快捷栏 / 地图 / 抽屉 / 提示）和 S3（各玩法面板）照这里套。

## 定位

这是一款**游戏**，面向所有人，而不是技术演示。文案用口语、不出现技术词（FPS、调用数、坐标等只在 `?debug` / `?verify` 下显示）。

## 三种材质

| 材质 | 用在哪 | 主要变量 |
|---|---|---|
| 墨青纸（深色） | 对话框、浮层、HUD 控件。实色，**常驻元素不用 `backdrop-filter`** | `--ui-surface` `--ui-surface-2` `--ui-surface-float` `--ui-text` `--ui-text-2` `--ui-text-3` `--ui-line` `--ui-line-strong` `--ui-fill` |
| 宣纸（浅色） | 需要阅读的东西：景点卡、景册、地图、加载页、选中态、钥匙帽、输入框 | `--ui-paper` `--ui-paper-2` `--ui-paper-hi` `--ui-ink` `--ui-ink-soft` `--ui-ink-3` `--ui-paper-line` `--ui-paper-fill` |
| 朱砂 | 当前画面上**唯一**最重要的动作（联机、提交、下一张、申诉），紧急 / 失败状态，以及印章本身 | `--ui-seal` `--ui-seal-hi` |

规则：

- 灰阶 + 一个强调色。朱砂不做装饰，同一屏只有一个朱砂主按钮；选中态用宣纸（`--ui-paper` 底 + `--ui-ink` 字），不用朱砂。
- 不用黄色徽标、薄荷渐变、装饰性渐变（主界面背景压暗的 `.home-shade` 除外）。
- 一个面只有一道线：要么 `border`，要么内衬印框，要么分隔细线，不叠加。
- 状态色 `--ui-ok` / `--ui-warn` / `--ui-error` 只用在小点、短句上，不铺底。

## 形状

| 用途 | 变量 | 值 |
|---|---|---|
| 标签、印章、小点子 | `--ui-r-xs` | 2px |
| 控件（按钮、输入框、分段、条） | `--ui-r-ctl` = `--ui-r-sm` | 4px |
| 小卡片 | `--ui-r-md` | 6px |
| 对话框 / 面板 | `--ui-r-lg` | 8px |
| 宣纸卡 | `--ui-r-paper` | 6px |
| 圆点、头像点 | `--ui-r-pill` | 999px（**只给圆点**，控件不再用） |

- 控件是矩形，高度 `--ui-h`（38px，触屏 42px）/ 大按钮 `--ui-h-lg`（48px）。触屏可点区域不小于 42px。
- **内衬印框**：对话框不画外边框、不加阴影，而是往里缩 `--ui-frame`（5px）画一道 1px 实色线 `--ui-frame-line`。
  做法是**一条** outline，闭合、不拼接，圆角随 `border-radius` 同心内收：
  `border:var(--ui-frame-pad) solid transparent;outline:1px solid var(--ui-frame-line);outline-offset:calc(-1px - var(--ui-frame))`。
  `--ui-frame-pad`（14px = 印框 5 + 线 1 + 一档间距 8）是面板四周的透明边框，底色铺满它；滚动内容只在边框以内裁切，
  所以**内容和滚动条永远在印框线以内**，滚到底也不压线，印框也不跟着滚。`.ui-panel` / `.about-panel` 已自带，组件里的内边距只写「印框以内还要多少」。
  游戏外的对话框（关于 / 设置 / 玩法指南 / 二维码）页眉固定、只有正文滚（theme.css 末尾那组 `:is(...)`）；新对话框想要同样效果，把正文类名加进去即可。
  不要再用 `header::before` 之类分段补线。
- 右上角关闭是方形 ×（`.about-close`，文字保留给读屏和测试）。

## 字

- 全站一种衬线字 `--ui-serif`；数字 / ¥ 用 `--ui-num`（衬线 + 系统无衬线兜底，`font-variant-numeric:tabular-nums`，类 `.ui-num`）。不加载网络字体。
- 字号阶梯只用 7 级：

| 变量 | 值 | 用途 |
|---|---|---|
| `--ui-fs-xs` | 12px | 注脚、标签、计数 |
| `--ui-fs-sm` | 14px | 正文、按钮 |
| `--ui-fs-md` | 16px | 强调正文、大按钮 |
| `--ui-fs-lg` | 20px | 对话框标题、模式名 |
| `--ui-fs-xl` | 28px | 页标题 |
| `--ui-fs-2xl` | 44px | 手机上的封面书名、少数大数字 |
| `--ui-fs-3xl` | 60px | 电脑封面书名「网上桂林」（只此一处，字距 `--ui-track-display`）；Logo 只是书名上方一枚小宣纸签 |

- 字距：正文 `--ui-track-body`（.04em）、按钮 `--ui-track`（.1em）、标题 `--ui-track-title`（.2em）、大标题 `--ui-track-display`（.32em）。行高 `--ui-lh-tight`（1.25）/ `--ui-lh`（1.65）。

## 间距

`--ui-s-1` … `--ui-s-7` = 4 / 8 / 12 / 16 / 24 / 32 / 48px。对话框外沿先让出 `--ui-frame-pad`（14px），组件内再留 8px 左右（文字离面板外沿约 22px）、标题区 `4px 2px 8px 8px`；行与行之间用细线，不用卡片框。

## 阴影

`--ui-shadow-1`（贴面一点点）、`--ui-shadow-2`（浮起的卡，如引导卡）。对话框靠印框和遮罩区分层次，默认不加阴影。

## 动效

- 只做一次性的入场：上浮 ≤ `--ui-rise`（8px）、≤320ms（`--ui-slow`）、`--ui-ease`，多项依次错开 40ms 左右（`.ui-rise` + `--ui-delay`，或 `animation:ui-rise …`）。
- 按下缩放 `scale(var(--ui-press))`（.97）。
- 除加载转圈（`.ui-spin`）外不做循环动画（呼吸、漂浮、脉冲都去掉）。
- `prefers-reduced-motion`：全局把动画缩到一次、几乎无时长；转圈保留慢速 2.4s。

## 组件

`theme.css` 提供：

- 按钮：`.ui-btn`（墨青）、`.ui-btn--seal`（朱砂主动作）、`.ui-btn--paper`（宣纸）、`.ui-btn--line`（线框次要，**新**）、`.ui-btn--ghost`（无框文字）、`.ui-btn--lg`、`.ui-btn--block`；`.ui-icon-btn`（方形图标钮）；`.ui-link`（文字链接，**新**）。
- 面板：`.ui-panel` / `.about-panel`（墨青对话框，自带印框）；`.ui-sheet`（宣纸卡面，**新**，景点卡等用）。
- 表单：`.ui-field` + `.ui-input`（`:focus-visible` 和 `aria-invalid="true"` 有样式）。
- 标签与印：`.ui-tag`；`.ui-seal`（白文：朱底白字）、`.ui-seal--line`（朱文：朱字朱框，**新**）、`.ui-seal--ink`（墨线，次要，**新**）。
- 数字：`.ui-num`（**新**）。动效：`.ui-rise`、`.ui-spin`（**新**），关键帧 `ui-rise` / `ui-spin`。

## 令牌改了什么（S1）

- 圆角整体变小：`--ui-r-sm` 8→4、`--ui-r-md` 12→6、`--ui-r-lg` 18→8；新增 `--ui-r-xs` `--ui-r-ctl` `--ui-frame` `--ui-frame-line`。**全站**引用这些变量的地方（HUD、后台、钓鱼、直升机、各玩法面板）一起变方，这是有意的。
- `--ui-glass-solid` 改为实色 `--ui-surface`；`--ui-glass-line` / `--ui-glass-line-soft` 改为 `--ui-line-strong` / `--ui-line` 的别名。旧的 `--ui-glass*` 名字都保留，新代码请直接用 `--ui-surface*` / `--ui-line*`。
- 新增：`--ui-surface` `--ui-surface-2` `--ui-surface-float` `--ui-ink-950` `--ui-text*` `--ui-line*` `--ui-fill*` `--ui-scrim`、`--ui-paper-hi`（从后台块挪到全局）`--ui-ink-3` `--ui-paper-line*` `--ui-paper-fill`、字号 / 字距 / 行高 / 间距 / 阴影 / `--ui-rise` `--ui-press`、`--ui-sans` `--ui-num`。
- `--ui-h` / `--ui-h-lg`、颜色 `--ui-seal*` `--ui-paper*` `--ui-ink*`、区域与后台 `:root` 块不变。

## 页面结构

- **主界面** `web/src/ui/home.ts`：直接打开网站时先到这里。背景是游戏内实景截图轮播（`public/home/*.webp`，用 `node scripts/home-shots.mjs` 从构建产物重新生成）。左栏：宣纸小卡 Logo + 大标题是主角；下面是「目录式」模式行——肖形印 + 名称 + 一句不超过 14 字的说明 + 右侧动作。目录上沿是一笔桂林山水线（`web/src/ui/home-skyline.svg`：象鼻山、普贤塔、水月洞、漓江、峰林），它的底边就是第一行的上发丝线；三枚模式印是桂林肖形印，不刻字（模式名就在旁边）：联机 = 日月双塔（`home-seal-mp.svg`）、游览 = 象鼻山水月洞（`home-seal-tour.svg`）、单人 = 漓江竹筏渔翁（`home-seal-solo.svg`），画面用 `::before` + `currentColor` 上色，所以朱印 / 墨印 / 悬停 / 续游当前行的配色规则不用动；外框用 `home-seal.svg` 做石刻残边，各歪一点。这些 SVG 只当遮罩（注释里不能出现 `--`，否则整张失效），生成脚本不入库，改形状直接改 SVG，颜色仍走 `--ui-*` 令牌，改形状只改 SVG。「联机」是唯一朱砂按钮，旁边小字显示在线人数；「游览」「单机」是线框按钮；「回到上次」是游览行下面的一行文字链接（继续游戏时主动作挪到当前模式那一行）。底部链接一行安静文字；抖音二维码桌面在右下角、手机收成左上小按钮。右上是账号。手机（竖屏 ≤760px、横屏高 ≤520px）默认收起：只留印章 + 模式名 + 动作，联机行保留说明；游览 / 单人说明、底部链接、署名收进目录下方的「更多」，钱包、印章进度、在线人数、续游始终显示。唯一状态是 `.home-more` 的 `aria-expanded`，CSS 用 `:has()` 读它，不另加 class。改结构后跑 `node scripts/verify-home-mp.mjs`。
- **游戏内**：左上“菜单 + 账号”（属于“你”），右上 dock（地图、模式、景册、拍照、反馈，属于“游戏”）。菜单或 Esc 回主界面，3D 场景暂停。
- **带参数的链接直接进游戏**：`?verify` `?spawn` `?view` `?mode` `?cam` `?feedback` `?play`（分享、反馈视角、测试脚本都靠它）。

## S2 / S3 怎么套

1. 先换令牌，不改结构：控件上的 `--ui-r-pill` 换成 `--ui-r-ctl`；写死的 `rgba(169,80,60,…)` 换成 `--ui-seal` / `color-mix(in srgb,var(--ui-seal) N%,transparent)`，`rgba(244,239,226,…)` 换成 `--ui-text*` / `--ui-line*` / `--ui-fill*`；字号收进 6 级阶梯。
2. 浮在 3D 画面上的常驻控件用 `--ui-surface-float` 实色，不用 `backdrop-filter`（只给临时遮罩 `.about-mask` / `::backdrop` 用）。
3. 每屏数一下朱砂：只留一个主动作；选中态、开关、当前项一律宣纸。
4. 对话框 / 抽屉直接用 `.about-panel` 或 `.ui-panel` 拿印框；景点卡、景册页、地图图例用 `.ui-sheet`（宣纸）。
5. 循环动画（呼吸、脉冲、闪烁）改成一次性入场或静态状态；保留加载转圈。
6. 改样式不改钩子：`class` / `id` / `data-*` / `aria-*` 是 TS 和 `scripts/*.mjs` 在用的，删之前 `rg` 一遍。
7. 桌面 1440×900、1280×720，手机横屏 844×390、873×403，竖屏 390×844 都看一遍，触屏可点区域 ≥ 42px。

## 登录注册流程

登录是可选的，只用于提交反馈和接收回复提醒；每个账号页面底部都有“不登录也能玩 · 继续游玩”。

1. 登录 / 注册 两个标签页切换。
2. 注册：填写（邮箱、密码、昵称）→ 邮箱六位验证码 → 完成（自动登录）。进度条显示三步。
3. 忘记密码：输入邮箱 → 收验证码 → 设新密码 → 回到登录。
4. 重新发送验证码有 60 秒冷却。
5. 我的账号：头像字、昵称、邮箱、反馈邮件提醒开关、退出登录。

## Logo 与「关于」页（IDOK-148）

- Logo 是成员设计的像素画，原图 `docs/brand/logo-source.jpg`。`python3 scripts/brand-logo.py` 生成全部派生图：`public/brand/logo.webp`（关于页、进城加载卡）、`emblem.webp`（主界面标题上的宣纸小卡、关于页 Logo 设计者卡）、`favicon-32.png` / `brand/favicon-64.png`、`apple-touch-icon.png`、`brand/icon-*.png`（manifest）。
- Logo 底是白的：放在浅色/宣纸底上时给 `<img>` 加 `mix-blend-mode:multiply`，白底就透出底色；不要直接放在深色面上。
- 「关于」页的贡献者名单在 `web/src/ui/contributors.ts`，按人列，每项贡献只写几个字（写代码 / 设计 / 实拍 / 反馈），不贴仓库 contributors。头像是该账号在游戏里的角色外形（`avatar` 字段，取自线上存档 `glol.avatar.v1`；没建角色的用默认外形），改完跑 `CHROMIUM=/usr/bin/chromium node scripts/contributor-portraits.mjs` 重新渲染 `public/contributors/*.webp`。玩家反馈处理完后，把反馈者的游戏昵称和反馈内容加进去（页面上写了「被采纳的反馈会署上你的昵称」）。只写昵称与公开主页。
