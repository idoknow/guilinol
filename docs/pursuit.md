## G4 接口

车流和追捕均须 `?traffic=1` 显式开启；无参数的单人模式也不加载。开启后，单人模式使用 G2 的分块路网、活动车辆和红绿灯时钟，出租或夜赛不豁免违章。游览模式只显示普通车流，不判违章、不扣钱。

- HUD 订阅 `onState` 的 `wanted` 字段（0–5）。`onEvent` 提供 `traffic:violation`（`reason`、`points`）、`pursuit:end`（`lost` / `switch` / `clear` / `fine` / `tour`）；现有 `fine` 事件的 `amount` 是实际扣款。警车占位实例位于 `scene.getObjectByName('G4 patrol')` 的前 `count` 项。
- 在 G2 人行道或逆行加 1，闯红灯加 2，撞车按速度加 2 或 3。同类有冷却；30 秒无新违章降一级，之后每 15 秒再降一级。等级不上存档。
- 警车仅走可通行机动车道的中心线，整条路段连同车身余量先检查校园缓冲区。脱离所有警车近距/前方视野 8 秒或换乘另一辆车解除追捕。低速被追上并停车 2 秒后按每级 35 元调用 `applyFine`，余额最低为 0。

`npm run verify:pursuit` 在 Chromium 中用可重复的路网、坐标和时间步运行判定、追车和真实本地钱包；不通过手工写入 wanted 来产生案件。`npm run perf -- --traffic` 是开启 G2 的标准五视角性能脚本。
