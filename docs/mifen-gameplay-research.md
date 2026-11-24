# 桂林田源米粉馆 · 餐饮经营玩法与数值平衡调研报告

> 面向：`guilinol-mifen`（`economy/` 数值引擎与店面经营循环设计）  
> 基线锚定：开局资金 `¥38`、初始口碑 `4.2★`、菜品定价 `¥4.5 ~ ¥18.5`（`web/src/mifen/recipes.json`）、设备升级 `¥42 ~ ¥76`、扩店 `shop_lv2 = ¥68` / `shop_lv3 = ¥188`（`web/src/mifen/state.ts`）。  
> 核心目标：借鉴 **Cooking Simulator / Overcooked! / PlateUp! / 开罗《拉面店》(The Ramen Sensei)** 经典机制与真实桂林米粉商业业态，设计 **7 条可落地盈利与节拍玩法闭环**，保证堂食、外卖、外带/批发三大收益通道**全为正期望收益且共享厨房工位与老卤产能，任何单一玩法都无法一家独大**。

---

## 一、参考样本提炼与真实桂林米粉业态对照

### 1. 经典经营与烹饪游戏机制拆解

| 参考作品 | 核心机制亮点 | 可复用至「田源米粉」的规则映射 | 来源链接 |
|---|---|---|---|
| **Overcooked! 2** | 严格按出票顺序出餐维持 Combo，`TipMultiplier` 随连击递增（UI 封顶显示 `4x`），超时或乱序立即断连；脏盘未洗会卡死全线 | 分色粉票（一两黄 / 二两橙 / 三两红）按单顺出，连击小费封顶倍率与防无限刷钱；回收粉碗清洗槽成为高峰隐性瓶颈 | [Overcooked! 2 (Steam)](https://store.steampowered.com/app/728880/Overcooked_2/) / [Overcooked Wiki · Combos](https://overcooked.fandom.com/wiki/Combos) |
| **PlateUp!** | 门外排队客群共用一条耐心条，每多一组等位客，耐心消耗速率**复利加快 `10%`**；早/午/晚 Rush 时段客流潮汐涌入 | 「三多路早市排队耐心惩罚」直接采用复利拥挤系数 `1.1^(Q-1)`，倒逼玩家买 `eq_ticket_printer` 扩队列/加座位，防止只靠慢熬单赚暴利 | [PlateUp! (Steam)](https://store.steampowered.com/app/1599600/PlateUp/) / [PlateUp! Wiki · Customers](https://wiki.plateupgame.com/gameplay/Customers) / [Rush Hour Event](https://wiki.plateupgame.com/Events/SeasonalEvents/RushHour2023) |
| **Cooking Simulator** | 调料与油温/计时物理精度评分；SP 技能优先点移速与操作手速，缩短拿取-切配-出餐台动线耗时 | 烫粉读秒 `boilTargetSec` 与浇卤精度 `brineTarget` 直接决定成碗星级（`miss / good / perfect`）；`eq_twin_boiler` 与 `eq_master_cleaver` 缩短工时而非直接白送钱 | [Cooking Simulator (Steam)](https://store.steampowered.com/app/641320/Cooking_Simulator/) / [Cooking Simulator Wiki](https://cooking-simulator.fandom.com/wiki/Cooking_Simulator) |
| **The Ramen Sensei（开罗拉面店）** | 汤底-酱汁（Tare）契合度协同加成、配料组合影响食客满意度与单碗成本毛利、店铺口碑驱动客流与赛事评价 | 「老卤浓缩度 × 小料自助风味组合」影响顾客好评涨幅与复购溢价；同时引入老卤库存消耗，抑制无上限倾倒老卤刷高价单 | [StrategyWiki · The Ramen Sensei](https://strategywiki.org/wiki/The_Ramen_Sensei) / [Kairosoft Wiki (wiki.gg)](https://kairosoft.wiki.gg) |

### 2. 真实桂林米粉商业业态特征

1. **干捞为核心、早市为王、极致翻台**：桂林本地习惯“先干拌老卤吃粉，再自助盛免费筒骨汤清口”，单碗烫粉 30 秒～1 分钟出餐、堂食停留约 10–15 分钟，早市（06:30–09:30）翻台率可达 5–8 轮。
2. **高毛利但依赖老卤护城河**：普通桂林米粉单碗食材成本占售价约 `25%~30%`（毛利率 `65%~75%`），核心壁垒在于三十余味香辛料与牛猪骨慢熬的老卤；靠加肉小料（脆皮锅烧、卤牛肉、叉烧、卤蛋、油条）与饮品提升客单价。
3. **汤卤分离外卖解法**：直接装碗配送易坨粉、吸干卤水导致差评；现实标准做法是**粉、卤水袋、骨汤杯、脆锅烧分格封装（汤卤分离）+ 拌粉提示卡**，承担一定打包与平台抽成换取午晚全天流水。
4. **外带熟食/瓶装老卤与干湿粉 B 端批发**：老店晨间备多锅卤水与脆皮锅烧，空闲时段会顺带零售盒装熟食/瓶装浓缩老卤，以及向周边小摊供货鲜湿粉/干粉或商用桶装卤水；桂林全产业链年产值已突破百亿元，标准化鲜湿粉与干粉分工明确。

- **行业资料来源**：
  - [ChineseFoodAtlas · 桂林米粉干捞与骨汤吃法考](https://www.chinesefoodatlas.com/zh/foods/guilin-rice-noodles/)
  - [新华网广西 · 桂林米粉百亿产业链与地方/团体标准](http://gx.news.cn/20240629/c7dcfd070b26427081ce9efb7cbaf1a6/c.html)
  - [中国新闻网 · 老卤三十余味香料工艺与鲜湿粉保鲜突破](http://www.chinanews.com.cn/sh/2023/10-29/10102691.shtml)
  - [人民网广西 · 桂林米粉产业园、干湿粉与标准体系建设](http://gx.people.com.cn/n2/2024/1220/c179464-41082637.html)
  - [中国日报广西 · 桂林米粉供应链与产业升级](https://gx.chinadaily.com.cn/a/202407/02/WS66839c29a3107cd55d269832.html)

---

## 二、7 大经营玩法闭环（含收益公式、操作循环与来源）

> **通用符号约定**（与 `recipes.json` / `state.ts` 直接对齐）：  
> - $P_{\text{base}}$：菜单标价（`recipes.json`，一两 `¥4.5`、二两 `¥5.5`、三两 `¥6.0`、锅烧粉 `¥10.5`、牛肉粉 `¥11.5`、双拼 `¥15.0`、全套 `¥18.5`、酸辣煮粉 `¥9.0`）  
> - $C_{\text{raw}}$：原料直接成本率，堂食默认 $0.28$（对应 72% 毛利率；老卤充足时 $0.28$，急补商业浓缩卤水降毛利至成本率 $0.36$）  
> - $M_{\text{shop}}$：店面等级营收系数（`Lv1 = 1.0`, `Lv2 = 1.15`, `Lv3 = 1.35`）  
> - $Q \in \{0.6, 1.0, 1.25\}$：制作星级评价系数（`miss = 0.6`、一星/合格 `good = 1.0`、三星/黄金火候与卤比 `perfect = 1.25`）

---

### 玩法 1：早市嗦粉高峰 · 分色粉票连击翻台（堂食主引擎）

- **借鉴原型**：*Overcooked! 2* 按序上菜 Combo 倍率 + *PlateUp!* 队列拥挤复利掉耐心 + 桂林早市（06:30–09:30）30–60 秒极速出粉。
- **操作循环**：
  1. 早市客潮涌入三多路门前（门外队列人数 $N_q$ 上升），点单生成分色粉票（黄/橙/红）；
  2. 玩家必须**按票面顺序**完成「烫粉 `boil` $\rightarrow$ 切码铺肉 `meat` $\rightarrow$ 浇老卤/骨汤 `broth` $\rightarrow$ 出碗 `plate`」；
  3. 每顺位成功出 1 碗不超时且评级 $\ge \text{good}$ 的粉，连击数 $k$ 加 1，小费率上升；若乱序出碗或让队列耐心归零，连击直接清零并扣口碑；
  4. 顾客吃完留下空碗占用桌面或回收槽，必须在下轮入座前一键收碗清台才能释放座位翻台。
- **收益公式**：
  $$\text{Net}_{\text{dine}}(b) = P_{\text{base}} \cdot M_{\text{shop}} \cdot (1 - C_{\text{raw}}) + \text{Tip}_{\text{dine}}(b)$$
  $$\text{Tip}_{\text{dine}}(b) = P_{\text{base}} \cdot Q_{\text{bonus}} \cdot \min\!\Big(0.45,\; 0.05 \cdot \min(k, 6)\Big) \cdot (1 + B_{\text{brine}})$$
  - **队列耐心惩罚（防无限囤单）**：门外队列等待消耗速率 $v_{\text{patience}} = v_0 \cdot 1.10^{\max(0, N_q - 1)} / M_{\text{printer}}$（`eq_ticket_printer` 使 $M_{\text{printer}} = 1.30$，连击封顶于 $k=6$ 对应小费加倍上限 `+45%`）。
  - **算例**：Lv1 早市连击 $k=4$ 做出完美「招牌卤菜粉（贰两 `¥5.5`）」：毛利 $5.5 \times (1 - 0.28) = ¥3.96$，小费 $5.5 \times 1.25 \times 0.20 = ¥1.38$，单碗净赚 **`¥5.34`**。
- **来源链接**：
  - [Overcooked Wiki · Combos](https://overcooked.fandom.com/wiki/Combos)
  - [PlateUp! Wiki · Customers](https://wiki.plateupgame.com/gameplay/Customers)
  - [ChineseFoodAtlas · 桂林米粉早市与干捞吃法](https://www.chinesefoodatlas.com/zh/foods/guilin-rice-noodles/)

---

### 玩法 2：现炸锅烧与秘制老卤风味调校（口碑溢价循环）

- **借鉴原型**：*Cooking Simulator* 物理精准量化评分 + *The Ramen Sensei* 汤底/酱汁/配料协同加成。
- **操作循环**：
  1. 晨间或客流间隙调整主锅状态：控油温现炸脆皮锅烧保鲜度（锅烧酥脆计时器 `freshness`），并检查老卤桶浓度与盐度；
  2. 烫粉读秒落在 `[boilTargetSec ± tol]` 黄金区间、浇卤落在 `[brineTarget ± brineTol]`；
  3. 端上自助小料台（`recipes.json` 7 种免费小料：葱花、招牌腌青椒、酸豆角、萝卜丝、泡椒、油辣椒、酸笋），匹配顾客原型（`recipes.json` `customerTypes` 偏好）触发风味协同（例如「卤菜粉 + 脆锅烧 + 腌青椒」）；
  4. 口碑 $R \in [1.0, 5.0]$ 实时反馈高客单菜品点单权重，并额外奖励固定小费与口碑增量。
- **收益公式**：
  $$\text{Bonus}_{\text{flavor}} = P_{\text{base}} \cdot \Big(0.08 \cdot \mathbb{I}[\text{fresh}_{\text{guoshao}} > 0.7] + 0.06 \cdot \frac{\text{matchCount}}{|\text{preferred}|}\Big) \cdot \Big(0.85 + 0.05 \cdot R\Big)$$
  $$\Delta R = \big(0.03 \cdot \mathbb{I}[\text{perfect}] - 0.12 \cdot \mathbb{I}[\text{miss/angry}]\big) \cdot \Big(1 + \frac{B_{\text{rep}}}{100}\Big)$$
  - **损耗约束**：脆皮锅烧每放超过 180 秒酥脆度衰减至 `< 0.5`，不仅失去 `+8%` 脆皮加成，还会把 `perfect` 降级为 `good`，逼迫小批量现炸而非一次囤满整日锅烧。
- **来源链接**：
  - [StrategyWiki · The Ramen Sensei](https://strategywiki.org/wiki/The_Ramen_Sensei)
  - [Cooking Simulator Wiki](https://cooking-simulator.fandom.com/wiki/Cooking_Simulator)
  - [中国新闻网 · 老卤三十余味天然香辛料慢熬](http://www.chinanews.com.cn/sh/2023/10-29/10102691.shtml)

---

### 玩法 3：汤卤分离外卖专单（午晚错峰扩流引擎）

- **借鉴原型**：PlateUp! 远程叫单波次节拍 + 真实桂林米粉外卖痛点（防坨粉/防撒漏的干湿/汤卤分离封装）。
- **操作循环**：
  1. 午市与晚间堂食低谷或错峰时段，收银台右侧打印**蓝/粉外卖骑手单**（需在骑手取餐倒计时 $T_{\text{rider}}$ 前出单）；
  2. 玩家选择标准「**汤卤分离封装**」（米粉盒 + 独立密封老卤袋 + 热骨汤杯 + 脆皮锅烧纸袋 + 干拌提示卡），比普通堂食多耗时 `1.8s` 打包工序，耗时换取好评率；若图省事用「混装打包」，省时但到达后粉坨吸卤，触发高概率差评罚款；
  3. 骑手准时取走后按里程结算流水，平台抽成 `18%` 且扣除 `¥1.2` 分格餐盒成本。
- **收益公式**：
  $$\text{Net}_{\text{deliv}}(o) = \Big(P_{\text{base}} \cdot 1.15 - C_{\text{pack}}\Big) \cdot (1 - r_{\text{plat}}) - P_{\text{base}} \cdot C_{\text{raw}} + \text{RiderTip}(o)$$
  - 参数锚定：外卖溢价 `+15%`（堂食 `¥10.5` 锅烧粉外卖标价 `¥12.1`），分格餐盒+提示卡 $C_{\text{pack}} = ¥1.2$，平台佣金 $r_{\text{plat}} = 0.18$，老粉原料成本 $C_{\text{raw}} = 0.28$；准时且选「汤卤分离」时 $\text{RiderTip} = ¥1.0 \sim ¥1.8$（混装发泡扣除 `-¥1.5` 退款罚金且口碑 `-0.08`）。
  - **并发上限约束**：门口电动车外送配额每日上限与午/晚外卖波次挂钩（Lv1 同时挂单 $\le 2$、每日最多 12 单），防止玩家彻底关掉堂食纯挂机接外卖。
  - **算例**：接 1 单「锅烧牛肉双拼粉（堂食 `¥15.0` -> 外卖 `¥17.25`）」：$(17.25 - 1.20) \times 0.82 - 15.0 \times 0.28 + 1.50 = 13.16 - 4.20 + 1.50 =$ **`¥10.46`**（扣除比堂食高的包装费与平台佣金，单价高但净利率低于堂食，靠错峰填谷盈利）。
- **来源链接**：
  - [PlateUp! Wiki · Restaurant Settings](https://wiki.plateupgame.com/gameplay/Restaurant/RestaurantSettings)
  - [PlateUp! Wiki · Rush Hour Event](https://wiki.plateupgame.com/Events/SeasonalEvents/RushHour2023)
  - [新华网广西 · 预包装与方便桂林米粉汤卤分装标准](http://gx.news.cn/20240629/c7dcfd070b26427081ce9efb7cbaf1a6/c.html)

---

### 玩法 4：浓缩老卤罐与脆皮锅烧熟食外带（门口顺手购副业）

- **借鉴原型**：*The Ramen Sensei* 周边纪念品/加购转化机制 + 真实桂林米粉老店柜台卖瓶装浓缩卤水、秤斤脆皮锅烧、卤牛肉熟食切片。
- **操作循环**：
  1. 晨市开始前，玩家可决策将今天熬好的老卤分配至「堂食主卤槽」或「零售分装区（浓缩老卤瓶 / 真空锅烧盒 / 卤牛肉包）」；
  2. 堂食满足率 $\ge \text{good}$ 的熟客结账离开前，按店铺口碑 $R$ 与库存展示触发「顺手买一瓶老卤回家拌粉 / 带半斤锅烧」随机加购弹窗/自动转化；
  3. 该动作不占用烫粉炉工位，仅占用收银打包 0.8 秒并消耗对应熟食/老卤余量。
- **收益公式**：
  $$\text{Net}_{\text{retail}} = \sum_{i \in \text{SKU}} n_i \cdot (P_{\text{sku}, i} - C_{\text{sku}, i}) \cdot \text{Conv}(R)$$
  $$\text{Conv}(R) = \text{clamp}\!\Big(0.08 + 0.06 \cdot (R - 3.5),\; 0.05,\; 0.28\Big)$$
  - SKU 定价（贴合 `guilinol-mifen` 物价尺度）：浓缩老卤随身瓶（可拌 5 碗）定价 `¥14.0`（成本 `¥5.5`、净利 `¥8.5`）；香脆锅烧外带小盒定价 `¥12.0`（成本 `¥6.2`、净利 `¥5.8`）。
  - **防一家独大硬约束**：老卤罐装直接抽走当日老卤桶容量 $L$（每次分装耗掉约 5 碗份老卤浓缩液）；若过度分装零售导致晚市堂食老卤见底，堂食菜品溢价归零甚至被迫高价买商业补卤包。
  - **算例**：口碑 `4.2★` 时转化率 $12.2\%$，早市接待 25 位堂食客顺带卖出 3 份零售熟食，净赚约 **`¥20 ~ ¥24 / 日`**，刚好作为早中衔接的平滑增量。
- **来源链接**：
  - [StrategyWiki · The Ramen Sensei](https://strategywiki.org/wiki/The_Ramen_Sensei)
  - [中国新闻网 · 老卤复合浓缩标准化制品](http://www.chinanews.com.cn/sh/2023/10-29/10102691.shtml)

---

### 玩法 5：鲜湿粉 / 干粉与桶装卤水 B 端微批发（日配供应链博弈）

- **借鉴原型**：*PlateUp!* 每日蓝图选卡与库存规划 + 真实桂林米粉「鲜湿粉日配鲜嫩但保质期短 vs 干粉耐放耐运」的进销存博弈。
- **操作循环**：
  1. 每日闭店补货界面，玩家兼有「向下游社区早餐点 / 大学城小摊批发出货」权限（Lv2 解锁鲜湿粉代供、Lv3 解锁干粉礼盒/商用卤水桶批发）；
  2. 每天早晨接收周边小商户的固定配额订单：玩家自留核心鲜湿粉保堂食口感，把**当日富余鲜湿粉**（隔夜将贬值报废）或**长保质期干粉包**以微利打包批发给门口三轮货车收走；
  3. 批发讲究走量稳现金流，单价毛利明显压低（约 `18%~25%`），但能把本来会烂在冷柜的湿粉转化为正收益，或替资金紧张时快速凑齐扩店款（`¥68` / `¥188`）。
- **收益公式**：
  $$\text{Net}_{\text{wholesale}} = \sum_{k \in \{\text{wet}, \text{dry}, \text{brine}\}} q_k \cdot \big(W_k - U_k\big) - \text{Waste}_{\text{wet}} \cdot U_{\text{wet}}$$
  $$\text{MarginRate}_k = \frac{W_k - U_k}{W_k} \in [0.18,\; 0.25]$$
  - SKU 示例：日配鲜湿粉批发价 `¥2.4 / 斤`（成本 `¥1.9 / 斤`，净赚 `¥0.5 / 斤`）；盒装干桂林米粉批发价 `¥6.5 / 盒`（成本 `¥5.0 / 盒`，净赚 `¥1.5 / 盒`）；商用浓缩卤水桶 `¥48.0 / 桶`（成本 `¥37.0 / 桶`，净赚 `¥11.0 / 桶`）。
  - **库存联动罚则**：若未批发的鲜湿粉滞留至次日损耗报废，按未销数量扣减成本 $U_{\text{wet}}$；若把堂食备粉全卖去批发导致堂食断货，堂食口碑与连击收益双失，利润远逊正常堂食。
- **来源链接**：
  - [人民网广西 · 鲜湿桂林米粉日配与干粉仓储供应链标准](http://gx.people.com.cn/n2/2024/1220/c179464-41082637.html)
  - [中国日报广西 · 桂林米粉原料基地与 B2B 供应链体系](https://gx.chinadaily.com.cn/a/202407/02/WS66839c29a3107cd55d269832.html)

---

### 玩法 6：备料调度、洁碗清洗槽与峰谷波次节拍（厨房动线防卡死循环）

- **借鉴原型**：*Overcooked!* 洗碗池回流死锁 + *Cooking Simulator* 备料架动线聚集 + *PlateUp!* 午晚双峰波次与装备改造。
- **操作循环**：
  1. 将单日切分为「**晨间备料 -> 早市峰(07:00) -> 午间错峰(12:00) -> 下午备货/批发 -> 晚市/夜宵档(19:00) -> 闭店结算**」；
  2. 堂食每服务 $B_{\text{clean}}$ 只碗后（如 Lv1 仅有 6 只公用青花瓷大碗），脏碗堆积在回碗筐；**若不及时清洗，烫粉灶完成后无法 `plate` 装碗**，迫使玩家在午间与早市间隙抽 2 秒清空碗槽，或优先攒钱购买 `eq_twin_boiler`（双口烫粉）解放切菜时间；
  3. 午后低谷期恰好用来**熬新卤 + 收批发车 + 分装外带熟食**，让“堂食闲暇时间”自然转化为副业营收窗口。
- **收益公式（停工惩罚与工位效率系数）**：
  $$\text{Throughput}_{\text{eff}} = \min\!\Big(C_{\text{seat}},\; N_{\text{cleanBowls}}(t),\; \frac{L_{\text{brine}}(t)}{l_{\text{avg}}}\Big)$$
  $$\text{RushIncome} = \sum_{t \in \text{rush}} \text{Served}(t) \cdot \text{Net}_{\text{dine}}(t) \cdot \Big(1 + 0.15 \cdot \mathbb{I}[\text{zeroWaitDrop}]\Big)$$
  - 全场若无顾客气走且未出现脏碗断档（`zeroWaitDrop = true`），早市结束发放 **`+15%` 无阻畅行翻台奖金**；反之每产生 1 秒「脏碗阻塞停摆」，流失期望单量 $\approx 0.18$ 碗。
- **来源链接**：
  - [Overcooked! 2 (Steam)](https://store.steampowered.com/app/728880/Overcooked_2/)
  - [Cooking Simulator (Steam)](https://store.steampowered.com/app/641320/Cooking_Simulator/)
  - [PlateUp! Wiki · Customers](https://wiki.plateupgame.com/gameplay/Customers)

---

### 玩法 7：老店扩建与专精设备 ROI 滚雪球循环（成长收口）

- **借鉴原型**：*PlateUp!* 15 日蓝图柜储钱跃迁 + *The Ramen Sensei* 口碑升级与客单结构跃升。
- **操作循环**：
  1. 游戏以真实 `recipes.json` 升级价格为里程碑阶梯：先买 `eq_twin_boiler` (`¥42`) 或 `eq_master_cleaver` (`¥52`) $\rightarrow$ 存够 `¥68` 升级 `shop_lv2` 双开间旺铺（座位 `6 -> 12`，解锁批发二阶与外卖加单）$\rightarrow$ 购入 `eq_master_brine` (`¥58`) 与 `eq_ticket_printer` (`¥76`) $\rightarrow$ 冲刺 `¥188` 解锁 `shop_lv3` 三多路旗舰大店（座位 `20`、免费筒骨汤台与全业态联动）；
  2. 玩家需要根据当前瓶颈选装备（排队老气走先买分色粉票机 `eq_ticket_printer`；小费低先买秘制老卤 `eq_master_brine`），形成清晰「现金流 $\rightarrow$ 瓶颈消解 $\rightarrow$ 客单与三线联动放大」闭环。
- **收益公式（回本周期与 ROI 校验）**：
  $$\text{PaybackDays}(u) = \frac{\text{Cost}(u)}{\Delta \text{NetDay}(u)}$$
  - 以 `eq_twin_boiler`（`¥42`）为例：烫粉速度 `+35%`（`boilSpeedMultiplier = 1.35`）使早市每小时多出 `~5` 碗堂食（平均净利 `¥5.2/碗`，日增 `~¥26`），约 **1.6 个营业日回本**；`shop_lv2`（`¥68`）使 `revenueMultiplier = 1.15` 且座位翻倍，日增净利 `¥45+`，约 **1.5 个营业日回本**，契合 `recipes.json`「开局 2~3 分钟迎来首次爆单扩店」的设计注释。
- **来源链接**：
  - [PlateUp! (Steam)](https://store.steampowered.com/app/1599600/PlateUp/)
  - [StrategyWiki · The Ramen Sensei](https://strategywiki.org/wiki/The_Ramen_Sensei)

---

## 三、防单一玩法一家独大的数值平衡模型（`economy/` 约束清单）

> 下面对比 **Lv1 初创店 / Lv2 双开间** 在合理游戏 1 日（约现实 3 分钟）下，三条核心营收赛道（**堂食主线 / 汤卤外卖 / 外带与批发副业**）的预期日净收益分布，验证“三线均有正收益、堂食为压舱石、任何副业皆无法取代堂食”。

| 玩法赛道 | 核心稀缺资源 | Lv1 单日合理产出与净利 | Lv2 单日合理产出与净利 | 占总净利目标区间 | 防一家独大核心制衡 |
|---|---|---|---|---|---|
| **① 堂食主线**（玩法1+2+6） | 座位数 `6/12/20`、排队耐心、净碗数、厨师手速 | `16~22 碗`，平均净利 `¥4.8/碗` -> **`¥77 ~ ¥106`** | `28~38 碗`，平均净利 `¥6.1/碗` -> **`¥171 ~ ¥232`** | **52% ~ 62%** | 受队列复利耐心与脏碗池封顶限制，连击倍率 UI 封顶 `+45%` |
| **② 汤卤外卖**（玩法3） | 打包工时 `1.8s`、分格耗材 `¥1.2`、单日接单波次 | `4~6 单`，平均净利 `¥6.5/单` -> **`¥26 ~ ¥39`** | `7~10 单`，平均净利 `¥7.8/单` -> **`¥55 ~ ¥78`** | **20% ~ 26%** | 平台抽成 `18%` + 包装费，单碗净利率低于堂食，且仅在午/晚波次限额触发 |
| **③ 外带零售 + 干湿粉批发**（玩法4+5） | 当日老卤桶余量 $L$、冷柜湿粉库存上限 | `2~4 份`，平均净利 `¥5.5` -> **`¥12 ~ ¥22`** | `4~8 份/批`，叠加批发净利 -> **`¥34 ~ ¥54`** | **14% ~ 20%** | 老卤分装挤占堂食卤量、批发毛利锁定 `18%~25%`；单独做批发无法养活扩店曲线 |
| **合计（单日全链路期望）** | — | **`¥115 ~ ¥167`** | **`¥260 ~ ¥364`** | **100%** | 起步 `¥38` + 第1日末轻松攒够 `eq_twin_boiler (¥42)` + `shop_lv2 (¥68)` |

### 关键校验结论（供 `economy/` 实现参考）
1. **绝对正收益底线**：哪怕最保守的低价「壹两卤菜粉 `¥4.5`」按 $C_{\text{raw}} = 0.28$ 计算仍有 `¥3.24` 堂食正毛利；外带 `18%` 抽成外卖按堂食 `1.15x` 定价仍保留 `¥3.4~¥12.8` 正净利；批发严格限定正差价 `W_k > U_k`（唯一亏损风险是次日**未卖出鲜湿粉报废**与**外卖混装赔付**，作为玩家主动可控的操作失误惩罚）。
2. **共享产能互斥锁**：**老卤锅余量**同时供给「堂食浇卤 + 外卖卤袋 + 零售浓缩瓶 + 批发卤水桶」，且**烫粉锅工位时间**同时分给「堂食翻台 + 汤卤分离打包」。在 `economy/` 状态机里只需维护 `brineStock`（每日晨间定量熬制 + 应急高成本浓缩补卤）与 `riderQuota`（日配额），即可天然杜绝任何单一分支无脑挂机碾压其余玩法。
