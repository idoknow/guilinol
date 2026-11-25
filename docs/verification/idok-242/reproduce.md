# IDOK-242 复跑清单

配对 main 为 `852d3ead402d7bf32a6a25e847e22053f9cdd0c7`。在这个提交的独立工作树准备项目的完整原始输入，生成并构建全城底图。

```sh
npm ci
uv sync --locked
npm run world
npm run build
cat dist/version.json
```

将 `MAIN_DIST` 设置为上述构建的 dist 绝对路径。在 PR #277 的干净工作树使用相同的原始输入运行以下命令。建模输入随此版公开仓库提供。

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

定江四条道路按 IDOK-247 的交接边界保留原始底图。用同一个候选审计器运行 `npm run audit:vehicles -- "$MAIN_DIST/world" captures/final/main-wheels`。比较两份 `wheels/audit.json`（基线位于 `main-wheels`）中 `lanes` 的逐 way 结果：对 `1030049241`、`727929887`、`459580311`、`815078158` 分别求 `over` 总和及最大的 `maximum`，两项都须小于或等于基线。原始审计保留超限及缺底板记录，因此应检查 JSON。名单外的超限须为零。

定江两个入口无需为本单生成底板。其接线采用原生车道剖面；同一条 `1030049241` 远端连接的另一个洞口 `9495420412` 仍按该洞口原有接线实跑，纳入名单外检查。

两个定江洞口仍计入洞口全量实跑。可用 `node scripts/drive-tunnel-portals.mjs captures/final/dingjiang.json 6821480678 6821524191` 单独复查。与同版 main 在实际路面出生点的四趟记录逐方向对照，每趟须完成，且最大帧差须小于或等于该方向 main 实测值。

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
