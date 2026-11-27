# 设计规则（全组全局）

本文件是讨论小组所有界面工作的总规则。frame（定方案）和 close（收口验收）都按它审；与 `docs/ui.md`（全站「山水印」体系）一起执行，`--ui-*` 令牌仍是颜色和字体的唯一来源。

## 老板原话

> 我要把它做得像 Linear 的官网或者苹果备忘录一样干净：目标简单、架构简单、设计简单、实现简单。砍掉标语、提示文字和次要标签。如果一个页面非得靠这些东西才看得懂，那就去改布局。每个决定都要同时提升用户体验（UX）、开发者体验（DX）和智能体体验（AX），而且不能弄坏任何东西。

## 真机体验与前后端交付规则（老板要求）

- 以后需要老板决定下一步（含发起抉择/拍板）或进入收口时，必须确认对应前后端服务已启动并验证连通，同时在汇报里直接给出真机可访问的体验链接。

## 审查清单

每条都能直接对照代码或截图判断，不合格就退回。

1. **只做一件事。** 每块界面说得出唯一目的；说不出就合并或删掉。
2. **不写标语、提示句、次要标签。** 不出现“立刻……！”“点击这里……”“小贴士”之类句子，不给已经一眼能看懂的数字加名字（`¥38` 不需要“营业额”，`★4.20` 不需要“口碑”）。看不懂时改布局、顺序或分组，不补说明。
3. **同一信息屏上只出现一次。** 店名已在 3D 招牌上，粉票数已在票卡列表里，收入在出餐时已经提示过，就不在别处再写一遍。
4. **一种字体、一套令牌。** 字体只用 `--ui-serif`（经 `--mf-font` 引用）。颜色只用灰阶加一个强调色：灰阶是宣纸色文字的不同透明度叠在青玉玻璃底上，强调色是朱砂 `--ui-seal`。
5. **强调色只给两种东西：** 当前画面唯一的主动作（`.mifen-btn--primary`），以及需要马上处理的紧急状态（例如快等不及的票）。不用于装饰、标题或边框。
6. **不用 emoji、装饰图标、渐变、彩色底块。** 每个面只允许一条发丝线（`inset 0 0 0 1px var(--mf-line)`），不叠加投影和第二层描边。
7. **状态不只靠颜色。** 选中、进行中、紧急都要有文字或 `aria-*` 能读出来。
8. **必须保留的不算多余：** 按钮名称、表单标签、操作结果和错误反馈、无障碍名称、玩法本身需要的信息（例如必配肉码、目标区间）。
9. **三方一起变好。** UX：一眼看懂、少一步操作。DX：样式只写在 `mifen-ui.css`，一个元素一个类名，不在 TS 里拼颜色和内联样式。AX：交互元素用 `button`，有稳定的 `data-*` 钩子和可读名称，状态写进属性。
10. **不弄坏东西。** 现有 `data-cook-ticket`、`data-hud-action`、`data-action`、`data-meat`、`data-buy`、`data-economy` 钩子和 `window.viewer.mifen` 探针保持可用；改完跑 `tsc` 和整合 QA。
11. **按钮一律特制（老板定，长期有效）。** 新做或改动的按钮不套通用胶囊、圆钮、系统图标或一两个字撑的图形，按 `docs/ui.md`「S2 / S3 怎么套」第 9 条落在「匾 · 印 · 签」语言里（匾 = 墨青纸面 + 内衬印框；印 = 唯一主动作的残边朱印；签 = 宣纸签放读的信息和选中态），小像取桂林物件刻线。

机检（应无命中）：

```bash
rg -n '提示|Tip|小贴士|✨|🔥|linear-gradient' web/src/mifen/mifen-ui.css web/src/mifen/index.ts
rg -n '\p{Emoji_Presentation}' web/src/mifen/*.ts
```

## 令牌（`web/src/mifen/mifen-ui.css`）

| 令牌 | 用途 |
|---|---|
| `--mf-font` | 唯一字体，指向 `--ui-serif` |
| `--mf-surface` | 所有浮层的底，指向 `--ui-glass-solid` |
| `--mf-line` | 唯一的发丝线和进度槽 |
| `--mf-fill` / `--mf-fill-2` | 按钮、轨道的底；悬停加深一级 |
| `--mf-text` / `--mf-text-2` / `--mf-text-3` | 主文字 / 次要文字 / 停用文字 |
| `--mf-accent` / `--mf-accent-hi` / `--mf-accent-text` | 朱砂：主按钮底 / 悬停 / 深底上的紧急文字和进度 |
| `--mf-radius` / `--mf-h` | 面板圆角 / 按钮高度（触屏自动加高） |

组件里不写新的色值；需要新颜色先在这里加令牌并说明用途。

## DOM 契约（新玩法入口照此写）

所有米粉界面挂在 `index.ts` 创建的 `.mifen-hud-root` 下。拍照、主界面、商城遮罩打开时整块自动隐藏。

**经营条**（顶部居中，只放数字和动作）：

```html
<header class="mifen-bar" aria-label="田源米粉经营面板">
  <span class="mifen-stat" data-mf-stat="funds"><span class="mifen-sr">资金</span><b>¥38</b></span>
  <span class="mifen-stat" data-mf-stat="rating"><span class="mifen-sr">口碑</span><b>★4.20</b></span>
  <span class="mifen-stat" data-mf-stat="phase" hidden><span class="mifen-sr">时段</span><b>早高峰 +15%</b></span>
  <button type="button" class="mifen-btn mifen-btn--primary" data-hud-action="cook-next">做粉</button>
  <button type="button" class="mifen-btn" data-hud-action="open-delivery" aria-expanded="false">外卖</button>
  <button type="button" class="mifen-btn" data-hud-action="open-retail" aria-expanded="false">外售</button>
  <button type="button" class="mifen-btn" data-hud-action="open-restock" aria-expanded="false">进货</button>
  <button type="button" class="mifen-btn" data-hud-action="open-ledger" aria-expanded="false">账本</button>
  <button type="button" class="mifen-btn" data-hud-action="open-upgrade" aria-expanded="false">扩店</button>
</header>
```

- 新玩法（外卖、早市、卤水外卖、批发等）的入口是经营条里再加一个 `.mifen-btn`，`data-hud-action="<玩法 id>"`，文字是两个字的动词或名词，不加图标和感叹号。
- 新数字用 `.mifen-stat` + `data-mf-stat="<key>"`，读屏名称放进 `.mifen-sr`，屏幕上只显示带单位的值。
- 有东西**需要处理**时给按钮加 `data-ready` 属性（显示一个强调色小点），同时把 `aria-label` 改成能说明原因的句子。白天一直可用的入口（外卖、外售）不挂小点；目前只有扩店（买得起）、进货（缺货）、账本（夜里该打烊）会亮。
- 经营入口按 `economy/events.ts` 的 `ECONOMY_UI_SLOTS` 生成，新增入口改那里，不在 `index.ts` 手写。

**列表**（订单、外卖单等排队的东西，复用粉票样式）：

```html
<ol class="mifen-tickets" aria-label="粉票">
  <li>
    <button type="button" class="mifen-ticket" data-cook-ticket="<id>" aria-label="标题，¥价格，内容，剩 N 秒">
      <span class="mifen-ticket-title">二两 · 桂林酸辣煮粉</span>
      <span class="mifen-ticket-price">¥9</span>
      <span class="mifen-ticket-meta">卤牛肉 · 叉烧</span>
      <span class="mifen-ticket-state">制作中</span>
      <span class="mifen-ticket-patience" style="--p:0.62"></span>
    </button>
  </li>
</ol>
```

- 进行中：按钮加 `aria-current="true"`，`.mifen-ticket-state` 写“制作中”。
- 紧急：按钮加 `.is-urgent`，`.mifen-ticket-state` 写剩余秒数；只有这时才显示倒计时。
- 列表最多显示 5 行，其余用一行 `.mifen-tickets-more`“还有 N 张”。
- 外卖单与堂食共用这一列：`data-cook-ticket` 是 `dlv_` 开头的单号，`.mifen-ticket-meta` 以“外卖”开头，耐心条就是送达时限，排在堂食前面。

**面板**（一个玩法的操作或购买界面）：

```html
<section class="mifen-panel" role="dialog" aria-label="外卖" data-mifen-panel="delivery">
  <header class="mifen-panel-head">
    <h3>外卖</h3>
    <button type="button" class="mifen-btn" data-action="close">关闭</button>
  </header>
  <div class="mifen-panel-body">
    <article class="mifen-row" data-id="<id>">
      <div class="mifen-row-main">
        <strong class="mifen-row-title">名称</strong>
        <span class="mifen-row-meta">效果或内容，一行</span>
      </div>
      <button type="button" class="mifen-btn" data-buy="<id>">¥68</button>
    </article>
  </div>
</section>
```

- 面板的位置用一个专属类名定（例如 `.mifen-upgrade-drawer` 靠右、`.mifen-cook-panel` 靠下），外观全部来自 `.mifen-panel`。
- 一行只放：名称、一行效果、一个按钮；价格写在按钮上，不再单独列一次。已拥有的行加 `.is-owned`。
- 面板内常规内容一屏放完，不出现内部滚动；放不下就分组或分步。
- 外卖、外售、进货、账本四个经营面板由 `economy-hud.ts` 渲染，位置类 `.mifen-drawer`（与扩店同位，同时只开一个）。行内按钮钩子为 `data-economy="accept|sell|restock"` + `data-id`，关闭是 `data-economy="close"`；账本的金额用 `<b class="mifen-row-value">`，打烊这类收尾操作放进 `.mifen-panel-foot`。

**反馈**：操作结果统一走 `index.ts` 里的 `notify(text, meta?, warn?)`，同时最多 3 条、2.6 秒消失；`meta` 放金额或状态词（如 `+¥12.5`、`走了`）。不要再额外弹一次全局 toast。
- 钱只由经济引擎结算，入账金额只在结算事件的反馈里出现一次（`meta` 等于资金变化）；做粉面板只报星级和三步品质，不预估金额。

**近站按键**：`.mifen-prompt` 只写 `[E] + 动词`（做粉、小料、扩店）。

## 文案

- 按钮：两到四个字，动词优先（做粉、扩店、淋卤、出餐、暂放、关闭）。
- 数字带单位符号（`¥`、`★`、`s`），用等宽数字。
- 结果反馈只说结果（完美、偏咸、满座），不写感叹句和表情。
