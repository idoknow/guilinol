# IDOK-242 复跑清单

配对 main 为 `c3fc3663e74796a9a1a9ac1de5e1bd1cf28d277f`。在这个提交的独立工作树准备项目的完整原始输入，生成并构建全城底图。

```sh
npm ci
uv sync --locked
npm run world
npm run build
cat dist/version.json
```

将 `MAIN_DIST` 设置为上述构建的 dist 绝对路径。在 PR #277 的干净工作树使用相同的原始输入运行以下命令。构建脚本使用项目已有的布局资料目录，环境配置见主项目文档。

```sh
npm ci
uv sync --locked
mkdir -p public/world
cp -R "$MAIN_DIST/world/." public/world/
uv run --locked python pipeline/traffic.py
uv run --locked python pipeline/npc_network.py public/world
npm run build
cat dist/version.json
mkdir -p captures/final
npm run audit:vehicles -- dist/world captures/final/wheels
npm run audit -- --strict --no-shots --out captures/final/strict
npm run audit:grounding
```

严格审计的比较项是 audit.json 的 totalIssues 和各分类。交互测试使用同一 Chrome、同一 GPU，设置 CHROMIUM 指向本机 Chrome 可执行文件。

```sh
export QA_NATIVE_GPU=1
PYTHONPATH=pipeline uv run --locked python scripts/verify-sitang-crossing.py "$MAIN_DIST/world" dist/world captures/final/sitang
GROUNDING_ROUTES_FILE=captures/final/sitang/routes.json node scripts/drive-tunnel-portals.mjs captures/final/sitang.json --wheels
node scripts/capture-sitang-portal.mjs captures/final/shots
node scripts/drive-tunnel-portals.mjs captures/final/portals.json
node scripts/drive-tunnel-portals.mjs captures/final/ground.json --surface
node scripts/drive-tunnel-portals.mjs captures/final/repeat.json --surface 13481414402
GROUNDING_ROUTES_FILE=dist/world/vehicle-narrow-routes.json node scripts/drive-tunnel-portals.mjs captures/final/narrow.json
node_modules/.bin/tsx scripts/drive-grounding-sites.ts
RAILWAY_DIST=dist node scripts/railway-traverse.mjs railway-sites.json captures/final/rail.json
npm run verify:walk:quick
npm run verify:ride
node --experimental-strip-types scripts/verify-traffic.mjs
node scripts/drive.mjs
```

railway-sites.json 为同包中的四个平交节点及其双向路线。性能测试单独运行，关闭行人，两侧使用相同种子。移动端先关车流测王城步行，再开车流测五个视角。桌面端交替测量六次，以三对中位数复核门槛。

```sh
export PERF_PEDESTRIANS=0 PERF_SEED=242 PERF_ROUNDS=3 PERF_HEADLESS=1
PERF_TRAFFIC=0 PERF_VIEW=walk-palace PERF_OUTPUT=captures/final/mobile-0 node scripts/perf-drive.mjs "$MAIN_DIST" dist
PERF_TRAFFIC=1 PERF_OUTPUT=captures/final/mobile-1 node scripts/perf-drive.mjs "$MAIN_DIST" dist
for round in 1 2 3; do
  for side in main candidate; do
    build=dist
    if [ "$side" = main ]; then build=$MAIN_DIST; fi
    PERF_MS=10000 PERF_FIRST_RUNS=1 PERF_DIST="$build" PERF_OUT="captures/final/desktop-$round-$side.json" node scripts/perf.mjs --traffic
  done
done
```
