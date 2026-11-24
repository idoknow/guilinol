## G5 默认街头车流复测

用同一台 Mac、同一有界面 Chrome 和电源模式。基线是 G4 合并提交 `b8d5fc5` 的第一父提交 `c96a792`，不是 IDOK-139 的 G2 基线。双方构建用同一个 `world-8940a9d7a2b0` release，按各自 世界包 SHA-256 校验后解到 `public`，确认有 `world/roads/cells.json`。在各工作树分别 `npm ci && npm run build`。

在候选工作树运行以下命令，`BASE_DIST` 指向基线 dist，`CHROMIUM` 指向同一 Chrome 可执行文件。桌面沿用四个观光飞行机位、一个观光步行机位，另测单人模式解放桥；不要传 `--traffic`。解放桥两侧均为 `solo=1`，保留各自默认车流设置，17:00，相机 `(-265,168,15)` 朝 `(-145,153,45)`；候选侧至少 30 辆车可见后开始等待场景就绪。Mac 默认要求 Metal；Linux 的 SwiftShader 只验证流程。

```sh
npm run perf
for round in 1 2 3 4 5; do
  for side in $(if [ $((round % 2)) = 1 ]; then echo 'base head'; else echo 'head base'; fi); do
    dist=dist; baseline=0
    if [ "$side" = base ]; then dist="$BASE_DIST"; baseline=1; fi
    PERF_DIST="$dist" PERF_BASELINE="$baseline" PERF_FIRST_RUNS=0 PERF_MOBILE=1 PERF_CAMERA=street-jiefang PERF_OUT="captures/mobile-$round-$side.json" npm run perf || exit 1
  done
done
```

桌面 1920×1080、DPR 1；手机模拟 390×844、DPR 3、CPU 4×。Metal 每机位至少采 10 秒。按每轮平均 FPS（1000 / 平均帧时）与 p95 帧时报告，手机取五轮中位数，同时列出各轮值与基线波动。对照 `build.sha`、`viewport.renderer`、相机位置、车流数和 draw calls，勿用 SwiftShader 数字断言桌面达 60 FPS，也不要用仅 p95 持平掩盖平均 FPS 下降。
