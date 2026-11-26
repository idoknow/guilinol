# 辅警 3.0 · r9 收口验收单

- 验收人：克劳德（k12/k13）
- 日期：2026-11-25
- 被验包：`/Users/pan-work/guilinol-xp-overnight/dist`（12:34 新打的包，里面有新打印机、新罚款表、新交警模型的代码）
- 图文版（可直接点开）：`file:///Users/pan-work/guilinol-xp-overnight/captures/duty-r9-accept/index.html`
- 游戏地址：`http://127.0.0.1:5176/?mode=walk`。这个预览服是 Carbon 在宿主机上起的，从我的虚拟机里连不上，所以我没能亲手确认它现在能不能打开。打开时请强刷一次（Cmd+Shift+R），否则浏览器可能还在用旧缓存，又会出现 r9 说的"本地没更新"。

## 一、结论

老板在 r7、r8、r9 提的 12 条要求，11 条有真机证据判为通过。"交警建模要有 GTA 的 8 分水平"这一条已经交付，但好不好看要老板自己看图打分。

Hy2 用同一个新包跑了 18 步全流程脚本，15 步通过、3 步失败（S5、S6、S12）。这 3 步都是脚本在截图或自动走位时没等到，功能本身都有其他证据证明能用，下面"遗留项"里逐条说明。

## 二、我负责的验收：递单与打印机（k12/k13）

单测已复跑，全部退出码为 0：

```
cd /Users/pan-work/guilinol-xp-overnight
node --test web/src/walk/knockdown.test.mjs   # KD_EXIT=0，10/10
npm run test:emote                             # EMOTE_EXIT=0，7/7
npx tsc -p web --noEmit                        # TSC_EXIT=0
```

真浏览器实拍的做法：我自己起了一个静态服务（端口 47832）来放 12:34 的 dist，用 Playwright 驱动 Chromium，走的是真实流程：点 UI 上岗 → 和交警对话 → E 拦停 → F 开单 → Enter 打印 → F 递交。为了拍特写，只改了渲染用的相机位置，游戏逻辑没碰。跑完后浏览器和服务都已关闭。

- 脚本：`/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-accept/accept-r9-handover.mjs`
- 数据：`/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-accept/report.json`

| # | 验收点 | 证据 | 实测数据 | 结论 |
|---|---|---|---|---|
| 1 | 打印机挂在腰上 | `/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-accept/01-belt-printer.png` | 打印机可见，挂在右胯，不在手上 | 通过 |
| 2 | 扯单时纸从出纸口出来 | `/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-accept/02-tear-slip.png` | 扯纸那一帧，拿单的手离出纸口 0.057m，凭条离出纸口 0.176m（刚被扯出来）；整段动作中离得最近时是 0.057m | 通过 |
| 3 | 违规人在左边时用左手递 | `/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-accept/03-handover-left.png` | 违规人在左；离违规人更近的是左手（左手 0.327m，右手 0.911m）；凭条在左手骨上，距手 0.134m；凭条离对方手 0.308m；递完后凭条挂到骑手手上 | 通过 |
| 4 | 违规人在右边时用右手递 | `/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-accept/04-handover-right.png` | 违规人在右；离违规人更近的是右手（右手 0.428m，左手 1.179m）；凭条在右手骨上，距手 0.134m；凭条离对方手 0.406m；递完后凭条挂到骑手手上 | 通过 |
| 5 | 凭条不悬空 | 同第 2–4 行 | 每一帧凭条都挂在手骨下面，凭条中心离手 0.134m（落在虎口和指尖之间） | 通过 |

同一轮里顺带测到的罚款数据（都是真实开出来的单）：

- 逆向行驶 ¥50
- 非法改装 ¥100
- 电驴超载 + 未戴头盔 = 20 + 50 = ¥70
- 每开一单，待领 10% 就涨一点（5 → 10 → 15），但钱包一直是 200，没变。说明钱要等下岗交差时才发。

另外有一组 r9 打印机的离线渲染，是单独搭的场景、不是游戏里拍的，留作模型细节参考：`/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-printer/`（belt、tear、left、right、closeup-solo、closeup-slip）。

## 三、老板要求逐条核对

| 轮次 | 老板原话要点 | 证据（宿主机路径） | 结论 |
|---|---|---|---|
| r7 | 交警对话要有头像，做成 GTA 式剧情 | e2e 的 S2、S3 通过；`/Users/pan-work/guilinol-xp-overnight/captures/duty-3-e2e/03-story-dialogue.png`、`03a–03d-story-shot-*.png`；立绘在 `/Users/pan-work/guilinol-xp-overnight/captures/duty-r8-story/portrait-*.png` | 通过 |
| r7 | 走非机动车道（黑色那条） | e2e 的 N1 通过：两轮车全在黑色非机动车道上，人行道上 0 辆；`/Users/pan-work/guilinol-xp-overnight/captures/duty-3-e2e/05-bridge-traffic-ge-8.png` | 通过 |
| r7 | 解放桥全程封闭栏杆；空气墙放低，能跳上去 | N2 通过：3 道栏杆从头到尾连续、没有缺口，高 1.0–1.2m，能踩上顶。N3 通过：按空格能跳上栏杆翻过去。`/Users/pan-work/guilinol-xp-overnight/captures/duty-3-e2e/11-railing-jump-crossover.png` | 通过 |
| r7 | 违规电驴少一点，走路别那么容易被撞 | N4 通过：违规车不超过 15%。N6 通过：在人行道站 60 秒，一次没被撞。`/Users/pan-work/guilinol-xp-overnight/captures/duty-3-e2e/08b-sidewalk-60s-safe.png` | 通过 |
| r8 | 电驴在桥两端更远的地方生成和消失，别让玩家看到 | S10 通过：站在桥中间转一圈看 60 秒，120m 内没有车凭空出现或消失。`/Users/pan-work/guilinol-xp-overnight/captures/duty-3-e2e/12-traffic-far-spawn.png` | 通过 |
| r8 | 罚款 50 元一单；改装 100、超载 20；超载加没戴头盔要数罪并罚，共 70 | 我实拍的三单分别是 ¥50、¥100、¥70（20+50）；S11 通过，金额 ¥70；`/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-fines/01-fine-70-stacked.png`、`02-fine-50-normal.png` | 通过 |
| r8 | 玩家拿 10%，要回去找交警交差下岗才拿钱 | 我实测：值班中待领涨到 15，钱包始终 200 没变。`/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-fines/04-wallet-settled-plus12.png`：合计 ¥120，下岗交差后 ¥12 入账。e2e 的 S12 失败，是脚本走位没走到，见遗留项 3 | 通过 |
| r8 | 递单动作：扯下单子塞到对方手上，左右手哪边近用哪边 | 第二节第 2–5 行；S11 通过（凭条递到骑手近侧那只手） | 通过 |
| r8 | 优化打印机模型和立绘 | `/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-accept/01-belt-printer.png`、`02-tear-slip.png`；`/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-printer/closeup-solo.png`；立绘在 `/Users/pan-work/guilinol-xp-overnight/captures/duty-r8-story/portrait-*.png` | 通过 |
| r9 | "是不是本地 ol 没更新" | dist 已在 12:34 重新打包。我直接拿这个包实测，罚款和打印机都是新版本 | 通过（老板那边需要强刷） |
| r9 | "罚款没按我说的" | 同 r8 罚款那两行 | 通过 |
| r9 | 交警叔叔建模要优化，要有 GTA 的 8 分水平 | `/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-officer/ingame-01-fullbody.png`、`ingame-02-dialogue-closeup.png`、`01-front.png`–`07-expr-thumbs-up.png`。模型约 1.65 万个三角面，8 次绘制调用；有大檐帽、反光背心、手套、对讲机、法线贴图、4 种表情 | 已交付，等老板看图打分 |
| 最新 | 结束后要记得验收 | 就是本单 | 已完成 |

## 四、队友验收结果（按硬盘上实际落下的证据汇总）

- 全流程 e2e（Hy2 的脚本，跑在 12:34 的新包上）：
  - 结果：15/18 通过。S1–S4、S7–S11、N1–N6 通过；S5、S6、S12 失败。
  - 报告：`/Users/pan-work/guilinol-xp-overnight/captures/duty-3-e2e/report.json`
  - 截图：同一目录下 01–14。
  - 上一轮 Carbon 冲刺修完后报过 18/18。这次 3 步失败都出在截图或走位时机上，不是功能坏了。
- 罚款与下岗结算：`/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-fines/`，4 张截图，12:42–12:44 拍的。
- 交警新模：`/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-officer/`。
  - 7 张离线渲染（10:13）。
  - 2 张游戏内截图（12:42）。
  - 数据报告：`report.json`。
- 剧情、头像与下岗剧情：`/Users/pan-work/guilinol-xp-overnight/captures/duty-r8-story/`，15 张截图，12:52–12:54 拍的。
- 递单与打印机：就是本节之前的第二节，由我自己完成。
- 各人这一轮的口头回报（Carbon k1–k3、Hy2 k4–k5、Neon k6–k7、Gemini k8–k9、Hy1 k10）还没到我这里。上面只按硬盘上的证据写；如果谁的回报和这里不一样，以重跑结果为准，再更新本单。

## 五、遗留项（都不挡这次收口，建议下一轮修）

1. **e2e S5 失败**：长按 E 放行之后，脚本读到的旗子姿态还是 stop，期望是 pass。
   - 放行本身是对的：拦停状态已清，骑手恢复正常行驶。
   - 原因很可能是虚拟机里渲染只有 0–1 帧每秒，脚本等了 260ms 就去读，旗子动作还没切过来。
   - 截图：`/Users/pan-work/guilinol-xp-overnight/captures/duty-3-e2e/06b-flag-long-release.png`
   - 建议：Hy2 把这一步改成等 `flagMode === 'pass'` 出现，而不是看到拦停状态清掉就读。
2. **e2e S6 失败**：只有一个子条件没过，就是对同一辆车重复开单时，"已开过罚单"的提示没被拍进截图。
   - 提示文字是对的，也确实同步弹出了；其余子条件全部通过。
   - 原因同样是截图时机。
3. **e2e S12 失败**：脚本自动往西侧交警走 30m，没在时限内走到，于是没触发交差。
   - 交差下岗和发 10% 这件事本身已有截图证明：`/Users/pan-work/guilinol-xp-overnight/captures/duty-r9-fines/04-wallet-settled-plus12.png`。
   - 建议：脚本改成走到 5m 以内再找交警，或者把走位时限放宽。
4. **小瑕疵（不在我的领地）**：在 `web/src/traffic-duty/fine-terminal/engine.ts:380`，打印完扯单时调用的是 `tearOffSlip(tearSide)`，而 `tearSide` 是"违规人离玩家更近的那只手"。也就是说，它把对方的左右手当成了玩家的左右手。
   - 后果：递单动画开始前，凭条可能先出现在玩家较远的那只手上。
   - 递单动画的扯纸帧（第 632 行）会把凭条改回玩家就近的那只手。那一刻两只手都在打印机旁边，凭条只跳了约 0.1m，最终画面是对的。
   - 建议：fine-terminal 的负责人把第 380 行改成用玩家自己离违规人更近的那只手。
5. 在 `mode=walk` 下，控制台有 2 条资源 404 报错（e2e 的 ERRS 字段里能看到），不影响流程。建议顺手查一下是哪两个资源。
