# 本机 `public/world` 重烘焙可行性与耗时评估报告（`world-rebake`）

> - **排查对象**：`/Users/pan-work/guilinol-xp-overnight`（分支 `feat/xp-overnight`，当前 HEAD `d08e4fba`，时间 2026-11-26）
> - **排查目的**：评估在不实际运行 `npm run world` / `pipeline/world.py` 的前提下，本机能否重烘焙 `public/world` 以纳入定江铁路新线段（含第十段）、桂林北站站区道路及街道车流（OL1 / OL2）。
> - **写入边界**：纯只读现场核查；本轮仅输出本报告，**未执行实际生成，未改动任何代码或现存世界目录**。

---

## 总结结论

| 评估维度 | 结论 |
|---|---|
| **能不能跑** | **条件具备，可以跑；但绝不能用裸默认 `PATH` 直接执行**。默认非交互 shell 找不到 `uv` 与 `gh`，必须在命令前显式注入 `PATH="/Users/macbook/.local/bin:$PATH"`。同时首次构建需从 GitHub Releases（`idoknow/guilinol-ops`）拉取 3 个基线归档包（约 `186 MiB`，实测 `gh` 已登录且 3 个 release 均可达）。 |
| **预计耗时** | **首次冷构建预计 55–80+ 分钟（极可能超过 1 小时）**。文档实测基线为 M3 Pro 上 `2992 块`冷构建耗时 **50 分 02 秒**（[docs/perf-audit.md#L149-L151](file:///Users/pan-work/guilinol-xp-overnight/docs/perf-audit.md#L149-L151)）；当前扩展区已增至 **`4080 块`（+36.4%）**，本机为 **Apple M1 Pro（8 核 / 32 GiB）** 且 `.world-cache/` 尚无路网稀疏求解缓存 `spline-*.npy`，必须按冷构建估算。 |
| **严禁触发的命令** | **严禁使用 `npm run qa` 跑重烘焙**：[scripts/qa.mjs#L9-L47](file:///Users/pan-work/guilinol-xp-overnight/scripts/qa.mjs#L9-L47) 给 `world` 单步仅设了 **10 分钟**默认超时，Mac 全流程超 **40 分钟**即返回非零（[README.md#L63](file:///Users/pan-work/guilinol-xp-overnight/README.md#L63)）。 |
| **Worktree 影响面** | 会直接覆盖本目录 `public/world`，并**连带覆盖 `/Users/pan-work/guilinol-merged-preview/public/world`（软链直指本目录）**；其余 6 个 `git worktree`（`guilinol`、`guilinol-drinks`、`guilinol-m6`、`guilinol-mifen`、`guilinol-showcase`、`guilinol-xxg`）及另 3 个同级目录（`guilinol-mifen-pra`、`guilinol-mifen-prb`、`guilinol-sanduo-opt`）均有各自实目录或指向 `guilinol`/`guilinol-showcase`，不会受 `public/world` 改写影响。另 `.venv` 与 `guilinol/.venv` 共用软链。 |
| **额外脱节风险** | 当前 `5176` 预览服务读取的是本目录独立拷贝的 `dist/world/`（`Nov 25 12:39`），且本目录 `public/world`（`Nov 24 11:14`）与 `dist/world` 均早于 2026-11-26 合入的 `pipeline/` 代码；单独运行 `npm run world` 只更新 `public/world`，不会自动更新 `dist/world`。 |

---

## 一、四个核心问题逐项核查（附原始命令输出）

### 问题 1：本机有没有安装 `uv`（`which uv`）？

**核查结论**：
- **默认非交互 `PATH` 下找不到 `uv`（`which uv` 返回 `1`）**，同时同样被脚本依赖的 `gh`（GitHub CLI）也不在默认 `PATH` 中。
- **`uv` 实际已安装在 `/Users/macbook/.local/bin/uv`（版本 `uv 0.13.7`）**，同目录下也已安装 `/Users/macbook/.local/bin/gh`、`gltfpack`、`python3.12`。
- 当前工作树 `.venv` 是指向 `/Users/pan-work/guilinol/.venv` 的软链接，内含 `Python 3.12.16`。`uv.lock` 与 `pyproject.toml` 在主仓与本工作树之间完全一致；带上 `PATH="/Users/macbook/.local/bin:$PATH"` 后实测 `uv sync --locked --dry-run --offline` 显示 **`Would make no changes`**，且 `uv run --locked --offline python` 可直接导入 [pyproject.toml](file:///Users/pan-work/guilinol-xp-overnight/pyproject.toml) 全部依赖（`numpy`、`pillow`、`scipy`、`shapely`、`mapbox-earcut`、`trimesh`）并执行 `--help`。

**原始命令输出**：

```text
=== Q1: UV & PATH & VENV ===
uv not found
which uv -> exit 1
PATH=/Users/macbook/.gemini/antigravity-cli/bin:/Users/macbook/language/tools/node-v22.23.2-darwin-arm64/bin:/Users/macbook/.gemini/antigravity/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
-rwxr-xr-x@ 1 macbook  staff  27864912 Nov  2 18:26 /Users/macbook/.local/bin/uv
uv 0.13.7 (316c827e0 2026-11-03 aarch64-apple-darwin)
lrwxr-xr-x@ 1 macbook  admin   30 Nov 24 10:51 .venv -> /Users/pan-work/guilinol/.venv
drwxr-xr-x@ 8 macbook  admin  256 Nov 18 01:19 /Users/pan-work/guilinol/.venv
Would use project environment at: .venv
Resolved 9 packages in 20ms
Checked 6 packages in 4ms
Would make no changes
Python 3.12.16
usage: world.py [-h] [--bbox BBOX BBOX BBOX BBOX] [--output OUTPUT]
                [--palette PALETTE] [--workers WORKERS]

options:
  -h, --help            show this help message and exit
  --bbox BBOX BBOX BBOX BBOX
                        Explicit rectangular test extent; defaults to the
                        approved play region
  --output OUTPUT
  --palette PALETTE
  --workers WORKERS     Concurrent chunk compression writers
```

```text
=== UV LOCKED --NO-SYNC TEST & PIPELINE IMPORTS ===
UV_LOCKED_OFFLINE_OK
drwxr-xr-x@ 8 macbook  admin  256 Nov 18 01:19 /Users/pan-work/guilinol/.venv
```

```text
=== GH CLI & AUTH & CACHE CHECK ===
gh not found
which gh -> exit 1
-rwxr-xr-x@ 1 macbook  staff  39256176 Aug 25 09:21 /Users/macbook/.local/bin/gh
zsh:5: command not found: gh
```

```text
github.com
  ✓ Logged in to github.com account (keyring, 已脱敏)
  - Active account: true
  - Git operations protocol: ssh
```

```text
world-d60495078652: world-d60495078652 assets=world.tar.gz sizes=8828880
world-2e678ff382e8: world-2e678ff382e8 assets=world.tar.gz sizes=72465545
world-822cf08b60ac: world-822cf08b60ac assets=world.tar.gz sizes=113811159
```

---

### 问题 2：raw 数据（`osm` / `dem` / `overture`）在 `/Users/pan-work/guilinol/raw` 等目录里在不在、多大？

**核查结论**：
本机存在**两套体量完全不同的 raw 数据集**，切勿混淆：

| 目录位置 | 类型 / 来源 | 总大小 | `dem` 瓦片数与大小 | OSM 快照 | Overture 建筑 | 能否用于当前全城（4080 块）重烘焙 |
|---|---|---|---|---|---|---|
| `/Users/pan-work/guilinol/raw` | 实目录（Nov 18） | **`6.4M`** | `16` 个文件，`1.5M` | 仅有 `osm.json`（`2,049,089 B`），**无** `osm-2026-11.json` | `overture_buildings.csv`（`3,125,831 B`） | **不能**：缺外围 DEM 瓦片与 Nov 快照，按 [pipeline/common.py#L51](file:///Users/pan-work/guilinol-xp-overnight/pipeline/common.py#L51) 会报 DEM 覆盖缺失错误 |
| `/Users/pan-work/guilinol-xp-overnight/raw` | **软链** -> `.world-cache/raw`（Nov 23） | **`59M`**（`.world-cache` 共 `78M`，含 `19M` 字体 `fonts/`） | **`190` 个文件，`18M`** | **`osm-2026-11.json`（`22,515,499 B` / `21M`）** | **`overture_buildings.csv`（`20,243,397 B` / `19M`）** | **可以**：`SHA256SUMS` 实测 `OK=195, FAIL=0`，完整满足 [pipeline/common.py#L54-L63](file:///Users/pan-work/guilinol-xp-overnight/pipeline/common.py#L54-L63) |
| `/Users/pan-work/guilinol-sanduo-opt/raw` | 混合目录 | 内置资料 `82M` | `dem`、`osm-2026-11.json`、`overture_buildings.csv` **全部软链指向 `guilinol-xp-overnight/raw/*`** | 同左 | 同左 | 依赖本工作树 `.world-cache/raw` |
| `/Users/pan-work/guilinol-m6/raw` | 实目录（Nov 18） | `33M`（含 `refs` `18M`） | `16` 个文件，`1.5M` | `osm-2026-11.json`（`5,078,452 B`）+ `osm.json`（`4,664,361 B`） | `4,654,468 B` | **不能**：仅旧开发框子集 |
| `/Users/pan-work/guilinol-xxg/raw` | 实目录（Nov 25） | `12M`（仅 `refpack/`） | **无** | **无** | **无** | **不能** |
| 其余工作树（`drinks` / `mifen` / `merged-preview` / `showcase`） | `raw` 目录不存在 | — | — | — | — | — |

**原始命令输出**：

```text
=== Q2: RAW DATA ===
6.4M	/Users/pan-work/guilinol/raw
 78M	.world-cache
 59M	.world-cache/raw
total 10128
drwxr-xr-x@  6 macbook  admin      192 Nov 18 01:18 .
drwxr-xr-x@ 29 macbook  admin      928 Nov 25 02:37 ..
drwxr-xr-x@ 18 macbook  admin      576 Nov 18 01:01 dem
-rw-r--r--@  1 macbook  admin  2049089 Nov 18 01:18 osm.json
-rw-r--r--@  1 macbook  admin  3125831 Nov 18 01:17 overture_buildings.csv
-rw-r--r--@  1 macbook  admin      537 Nov 18 01:01 q.txt
guilinol/raw/dem entries: 16 size: 1.5M
total 83656
drwxr-xr-x@   9 macbook  admin       288 Nov 23 11:14 .
drwxr-xr-x@   4 macbook  admin       128 Nov 24 12:25 ..
-rw-r--r--@   1 macbook  admin     17119 Nov 23 11:14 SHA256SUMS
drwxr-xr-x@ 192 macbook  admin      6144 Nov 23 11:13 dem
-rw-r--r--@   1 macbook  admin        12 Nov 23 11:14 longmen.tsv
-rw-r--r--@   1 macbook  admin  22515499 Nov 23 11:14 osm-2026-11.json
-rw-r--r--@   1 macbook  admin  20243397 Nov 23 11:14 overture_buildings.csv
-rw-r--r--@   1 macbook  admin     37461 Nov 23 11:14 places.tsv
-rw-r--r--@   1 macbook  admin       714 Nov 23 11:14 q.txt
xp-overnight/.world-cache/raw/dem entries: 190 size: 18M
SHA256SUMS summary: OK=195, FAIL=0
```

```text
=== XP-OVERNIGHT RAW SYMLINK & OTHER RAW DIRS ===
lrwxr-xr-x@ 1 macbook  admin  54 Nov 24 12:25 raw -> /Users/pan-work/guilinol-xp-overnight/.world-cache/raw
 19M	.world-cache/fonts
 18M	.world-cache/raw/dem
 21M	.world-cache/raw/osm-2026-11.json
 19M	.world-cache/raw/overture_buildings.csv

1.5M	/Users/pan-work/guilinol-m6/raw/dem
4.8M	/Users/pan-work/guilinol-m6/raw/osm-2026-11.json
4.4M	/Users/pan-work/guilinol-m6/raw/osm.json
4.4M	/Users/pan-work/guilinol-m6/raw/overture_buildings.csv
4.0K	/Users/pan-work/guilinol-m6/raw/q.txt
 18M	/Users/pan-work/guilinol-m6/raw/refs
 61M	/Users/pan-work/guilinol-sanduo-opt/raw/cmab_guilin
  0B	/Users/pan-work/guilinol-sanduo-opt/raw/dem
  0B	/Users/pan-work/guilinol-sanduo-opt/raw/osm-2026-11.json
  0B	/Users/pan-work/guilinol-sanduo-opt/raw/overture_buildings.csv
 21M	/Users/pan-work/guilinol-sanduo-opt/raw/refpack
 12M	/Users/pan-work/guilinol-xxg/raw/refpack
```

---

### 问题 3：文档和 README 里一次 `npm run world`（`uv run --locked python pipeline/world.py`）预计耗时多久？

**核查结论（区分文档记录与本机推断）**：
1. **文档明确写出的历史实测与时限事实**：
   - [docs/perf-audit.md#L149-L151](file:///Users/pan-work/guilinol-xp-overnight/docs/perf-audit.md#L149-L151)：在 `IDOK-114` 扩区（当时默认框 `44 × 68 = 2992 块`）时期，`pipeline/road_grading.py` 使用 4 个工作线程求解 768 m 子域，`npm run world -- --workers 4` 并行写块；此前在复测机（**Apple M3 Pro**）上的**冷构建耗时 `50 分 02 秒`**（文档同时提到此前设定为 `45 分钟` 目标，未达成）。
   - [README.md#L63](file:///Users/pan-work/guilinol-xp-overnight/README.md#L63)：全量 `npm run qa`（含 `world` + `landmarks` + `build` + 各项验证）在 Mac 上**累计超过 `40 分钟` 会返回非零**。
   - [scripts/qa.mjs#L9-L47](file:///Users/pan-work/guilinol-xp-overnight/scripts/qa.mjs#L9-L47)：`npm run qa` 仅给 `verify:walk:full` 配了 32 分钟、给 `photo-match` 配了 10/180 分钟，列表首步 `'world'` 未单独配超时，因此走默认值 **`(timeouts[step] ?? 10) * 60000`（10 分钟硬杀）**。
2. **本机当前实况推断（为什么预计比 50 分 02 秒更长）**：
   - 区块数扩大：实测 `PlayRegion().tiles` 为 **`4080 块`**（比文档记录的 `2992 块` 多出 `1088 块` / **+36.4%**），且新增定江十段铁路、`station_roads`、`rail_earthworks`、`npc_sidewalks`、十字街地下商业街切割等后处理步骤；
   - 本机目前 `.world-cache/` 内只有 `fonts/` 和 `raw/`，**不存在 `spline-*.npy` 路网样条求解缓存**（[pipeline/road_grading.py#L167-L182](file:///Users/pan-work/guilinol-xp-overnight/pipeline/road_grading.py#L167-L182)），也没有 3 个 `world-*.tar.gz` 基线缓存包，属于**完全冷构建**；
   - 本机 CPU/内存为 **Apple M1 Pro（8 核、32 GiB）**（单核/多核与内存带宽低于 M3 Pro）。
   - **综合耗时预估（推断）**：本机首次冷构建预计 **`55–80+ 分钟`**，需按 **`1 小时左右`** 预留时间与电源条件；第二次在相同路网求解条件下触发 `.world-cache/spline-*.npy` 热缓存时耗时才会明显下降。

**原始命令输出**：

```text
=== TIMING GREP IN DOCS & README ===
[...]
README.md:63:`npm run qa` 依次重建世界、地标与生产包，跑飞行、完整步行、骑行、导览、严格体检及全量照片。当前分支尚无 `audit` 时会在报告中标为跳过。各阶段耗时、浏览器首帧、draw calls 和错误摘要见 `captures/qa/report.md`，同目录保留逐项日志。飞行、步行、骑行和导览断言统一使用 SwiftShader。Mac 的同机位截图使用 Metal。浏览器基线取连续 12 帧，照片步骤按全部机位平均。任一步骤失败或 Mac 上累计超过 40 分钟会返回非零。地标和分享图构建会写入 `public/`，建议在专用工作树运行。
[...]
docs/perf-audit.md:149:道路校正每轮将道路系统拆成 768 m 子域，外加 160 m 重叠带；`pipeline/road_grading.py` 已用 4 个工作线程求解子域，在本轮所有子域完成后更新残差。SG 此前 50 分 02 秒的冷构建超出 45 分钟目标。
docs/perf-audit.md:151:构建使用 `npm run world -- --workers 4` 并行压缩和写出块，最多保留 4 个待写块，manifest 仍按行列排序。可传 `--workers 1` 做串行对照。DEM 每次插值 128 行。默认框对齐后为 44 × 68 块，共 2992 块。Terrarium z14 需要 x=13209–13214、y=6997–7005 全部 54 张；IDOK-2 的旧包只有中间 16 张。
docs/landmark-pipeline.md:15:跨平台复验时，两台机器使用同一提交、同一份 OSM、DEM 和 Overture 数据以及 `uv.lock`。在干净检出中运行 `npm run world`，比较 `public/world/manifest.json` 的 `terrainSha256`。摘要依次覆盖全分辨率地形、水位和下层地面三个小端 int16 网格，单位为分米。随后直接运行 `npm run audit:grounding` 即可检验提交中的 GLB。
[...]
```

```text
scripts/qa.mjs:9:const timeouts = { 'verify:walk:full': 32, 'photo-match': mac ? 10 : 180 }
scripts/qa.mjs:47:    (timeouts[step] ?? 10) * 60000,
scripts/qa.mjs:113:  if (status === '失败' || (mac && seconds > 2400)) process.exitCode = 1
```

```text
PlayRegion bbox: [25.18976221702599, 110.03370985986905, 25.37024200189715, 110.42711133585625] tiles: 4080
```

```text
=== Q3: TIMING & HOST SPEC ===
zsh:21: command not found: rg
Apple M1 Pro
8
34359738368
Filesystem      Size    Used   Avail Capacity iused ifree %iused  Mounted on
/dev/disk3s5   926Gi   675Gi   208Gi    77%    6.8M  2.2G    0%   /System/Volumes/Data
```

```text
=== CHECK CACHE IN GUILINOL-M6 OR GUILINOL-SANDUO-OPT ===
/Users/pan-work/guilinol-xp-overnight/.world-cache:
total 0
drwxr-xr-x@  4 macbook  admin   128 Nov 24 12:25 .
drwxr-xr-x@ 32 macbook  admin  1024 Nov 26 00:48 ..
drwxr-xr-x@  4 macbook  admin   128 Nov 24 11:01 fonts
drwxr-xr-x@  9 macbook  admin   288 Nov 23 11:14 raw
```

---

### 问题 4：生成结果是不是写进 `public/world`，会不会影响其他 worktree？

**核查结论**：
1. **默认写入目标就是本工作树的 `public/world/`**：
   - [pipeline/common.py#L15](file:///Users/pan-work/guilinol-xp-overnight/pipeline/common.py#L15) 定义 `OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'world')`，[pipeline/world.py#L673-L678](file:///Users/pan-work/guilinol-xp-overnight/pipeline/world.py#L673-L678) 将 `--output` 默认设为 `OUT`；在本目录 `/Users/pan-work/guilinol-xp-overnight` 内 `public/world` 是一个 `132M`（`8255` 个世界产物项）的**独立实目录**，不是软链。
   - **同时也会写入 `.world-cache/`**：在 `.world-cache/` 生成/读取 `world-{digest[:12]}.tar.gz`（3 个基线包）和 `spline-*.npy`（路网 B 样条稀疏求解缓存）。
2. **对其他 worktree 的影响（精确分两类）**：
   - **直接被覆盖的 worktree（1 个）**：
     **`/Users/pan-work/guilinol-merged-preview/public/world` 软链直接指向 `/Users/pan-work/guilinol-xp-overnight/public/world`**！只要在本目录原地重烘 `public/world`，`guilinol-merged-preview` 下看到的世界切片会同步变化；若构建中途报错或被中断，`guilinol-merged-preview` 也会读到半成品。
   - **不改 `public/world`、但共用 `.venv` 的 worktree（2 个）**：
     `/Users/pan-work/guilinol-xp-overnight/.venv` 与 `/Users/pan-work/guilinol-sanduo-opt/.venv` 均软链到 `/Users/pan-work/guilinol/.venv`；虽然 `uv sync --locked --dry-run --offline` 已确认当前不会做包变更，仍建议运行时加 `--no-sync --offline` 锁定不动共享 `.venv`。
   - **完全隔离不受影响的 worktree 与同级目录（6 个 worktree + 3 个关联目录）**：
     - `guilinol`（实目录 `132M`）
     - `guilinol-m6`（实目录 `8.0M`）
     - `guilinol-showcase`（实目录 `15M`）
     - `guilinol-drinks`、`guilinol-mifen`、`guilinol-xxg`、`guilinol-mifen-pra`、`guilinol-mifen-prb`（五者 `public/world` 均软链到主仓 `/Users/pan-work/guilinol/public/world`，且各自 `dist/world` 也都是独立实目录）
     - `guilinol-sanduo-opt`（`public/world` 软链指向 `guilinol-showcase/public/world`，`dist/world` 为独立实目录）
3. **本目录 `public/world` 与 `dist/world`（`5176` 服务）分离现状**：
   - 实测本机 `127.0.0.1:5176` 与 `127.0.0.1:4190` 有常驻 node 进程监听；本目录 `dist/world` 是 `Nov 25 12:39` 的**独立实目录**（`manifest.json` 大小 `523,387 B`），而 `public/world` 是 `Nov 24 11:14` 的**独立实目录**（`manifest.json` 大小 `524,051 B`），两者都带有 `a11731a5...` 的 `.world.sha256` 标记，**均早于 `2026-11-26` 合入 `feat/xp-overnight` 的最新 `pipeline/` 提交（如 `d08e4fba`、`8147a631` 第十段、`1970c780` 第九段）**。
   - 若重烘目标是让生产构建预览（`dist/`）生效，光跑 `npm run world` 不够，事后还需将新 `world` 同步进 `dist/world`（参考 [scripts/audit.mjs#L40-L56](file:///Users/pan-work/guilinol-xp-overnight/scripts/audit.mjs#L40-L56)）或重新 `npm run build`（注意 [package.json#L38](file:///Users/pan-work/guilinol-xp-overnight/package.json#L38) 的 `postbuild` 会对 `dist/world` 再跑一次 `node scripts/bake-dams.mjs dist/world`）。

**原始命令输出**：

```text
=== Q4: WORKTREES & PUBLIC/DIST WORLD ===
/Users/pan-work/guilinol                 7fde519b [perf/local-opt]
/Users/pan-work/guilinol-drinks          0bc452fb [feat/drinks-shop]
/Users/pan-work/guilinol-m6              92441542 (detached HEAD)
/Users/pan-work/guilinol-merged-preview  15eacbe9 [preview/combined-showcase]
/Users/pan-work/guilinol-mifen           b855b39b [feat/tianyuan-mifen]
/Users/pan-work/guilinol-showcase        89952ebd [showcase/merged]
/Users/pan-work/guilinol-xp-overnight    d08e4fba [feat/xp-overnight]
/Users/pan-work/guilinol-xxg             d700104f [feat/xiaoxianggang-indoor]
--- /Users/pan-work/guilinol ---
  raw -> real dir (4 entries, 6.4M)
  .world-cache -> real dir (0 entries,   0B)
  .venv -> real dir (4 entries, 129M)
  public/world -> real dir (8255 entries, 132M)
  dist/world -> missing
--- /Users/pan-work/guilinol-drinks ---
  raw -> missing
  .world-cache -> missing
  .venv -> missing
  public/world -> symlink -> /Users/pan-work/guilinol/public/world
  dist/world -> real dir (8255 entries, 132M)
--- /Users/pan-work/guilinol-m6 ---
  raw -> real dir (6 entries,  33M)
  .world-cache -> missing
  .venv -> real dir (4 entries, 127M)
  public/world -> real dir (653 entries, 8.0M)
  dist/world -> missing
--- /Users/pan-work/guilinol-merged-preview ---
  raw -> missing
  .world-cache -> missing
  .venv -> missing
  public/world -> symlink -> /Users/pan-work/guilinol-xp-overnight/public/world
  dist/world -> missing
--- /Users/pan-work/guilinol-mifen ---
  raw -> missing
  .world-cache -> missing
  .venv -> missing
  public/world -> symlink -> /Users/pan-work/guilinol/public/world
  dist/world -> real dir (9886 entries, 141M)
--- /Users/pan-work/guilinol-mifen-pra ---
  raw -> missing
  .world-cache -> missing
  .venv -> missing
  public/world -> symlink -> /Users/pan-work/guilinol/public/world
  dist/world -> real dir (8255 entries, 132M)
--- /Users/pan-work/guilinol-mifen-prb ---
  raw -> missing
  .world-cache -> missing
  .venv -> missing
  public/world -> symlink -> /Users/pan-work/guilinol/public/world
  dist/world -> real dir (8255 entries, 132M)
--- /Users/pan-work/guilinol-sanduo-opt ---
  raw -> real dir (5 entries,  82M)
  .venv -> symlink -> /Users/pan-work/guilinol/.venv
  public/world -> symlink -> /Users/pan-work/guilinol-showcase/public/world
  dist/world -> real dir (662 entries,  15M)
--- /Users/pan-work/guilinol-showcase ---
  raw -> missing
  .world-cache -> missing
  .venv -> missing
  public/world -> real dir (662 entries,  15M)
  dist/world -> real dir (8255 entries, 132M)
--- /Users/pan-work/guilinol-xp-overnight ---
  raw -> symlink -> /Users/pan-work/guilinol-xp-overnight/.world-cache/raw
  .world-cache -> real dir (2 entries,  78M)
  .venv -> symlink -> /Users/pan-work/guilinol/.venv
  public/world -> real dir (8255 entries, 132M)
  dist/world -> real dir (8255 entries, 132M)
--- /Users/pan-work/guilinol-xxg ---
  raw -> real dir (1 entries,  12M)
  .world-cache -> missing
  .venv -> missing
  public/world -> symlink -> /Users/pan-work/guilinol/public/world
  dist/world -> real dir (8255 entries, 132M)
-rw-r--r--  1 macbook  admin  516944 Dec 31  1969 /Users/pan-work/guilinol/public/world/manifest.json
-rw-r--r--@ 1 macbook  admin  523387 Nov 25 12:39 dist/world/manifest.json
-rw-r--r--@ 1 macbook  admin  524051 Nov 24 13:09 public/world/manifest.json
```

---

## 二、风险点与操作注意清单

1. **必须带全 `PATH`，否则 `uv` 和 `gh` 先后崩溃**
   - 直接跑 `npm run world` 会第一时间报 `uv: command not found`；即使手写 `.venv/bin/python`，运行到 [pipeline/legacy_core.py#L38](file:///Users/pan-work/guilinol-xp-overnight/pipeline/legacy_core.py#L38) / [pipeline/play_region.py#L34](file:///Users/pan-work/guilinol-xp-overnight/pipeline/play_region.py#L34) 拉取 3 个基线包时依然会因找不到 `gh` 而中止。
   - **注意**：如需顺便跑地标构建（`npm run landmarks`），`gltfpack` 同样位于 `/Users/macbook/.local/bin/gltfpack`，也需要这条 `PATH`。
2. **3 个约 `186 MiB` 的外网基线包与 `.world-cache/` 冷缓存**
   - 第一次运行依赖本机网络从 GitHub 下载 `world-d60495078652`（~8.4 MiB）、`world-2e678ff382e8`（~69.1 MiB）、`world-822cf08b60ac`（~108.5 MiB）。本地 `/Users/macbook/.cache/guilinol-sync/` 中现有的 `world-a11731a5dafd.tar.gz` 与 `world-eacee6651f03.tar.gz` 哈希不同，不可直接替代。
   - 一旦 3 个包与 `spline-*.npy` 写入 `.world-cache/`，后续复建即可大幅提速。
3. **保护 `public/world` 与 `guilinol-merged-preview` 不被半成品破坏**
   - 现有 `public/world/.world.sha256` 为 `a11731a5dafdeb79d00ac0c7879d254b2c8737c5e4fb43593c93e68153140da9`（本地缓存 `/Users/macbook/.cache/guilinol-sync/world-a11731a5dafd.tar.gz` 留有完整备份）。
   - **强烈建议先加 `--output` 输出到临时目录**（如 `.world-cache/rebake-out`），确认 4080 块和 `manifest.json` 完整生成且无报错后，再原子替换进 `public/world/`（不要边跑边重启 `5176` / `4190`）。
4. **切勿直接跑 `npm run qa`**
   - [scripts/qa.mjs#L47](file:///Users/pan-work/guilinol-xp-overnight/scripts/qa.mjs#L47) 的 `10 分钟` 单步超时会直接把运行中的 `pipeline/world.py` 杀掉，无法完成全城烘焙。
5. **`public/world` 更新不等于 `dist/world`（`5176` 预览）已更新**
   - `npm run world` 产出目录在 `public/world`；当前 `dist/world` 是独立目录，需在世界烘焙完成后按需同步或重建 `dist`（注意避免在无授权时干扰 `4190` 与 `5176` 在线进程）。

---

## 三、直接可执行的重烘焙命令

### 方案 A（推荐）：先隔离输出到暂存目录，验完再替换 `public/world`

全程不触碰共享 `.venv`（`--no-sync`）、不提前覆盖 `public/world` 与 `guilinol-merged-preview/public/world`，预计耗时 **55–80+ 分钟**（首次冷构建）：

```sh
cd /Users/pan-work/guilinol-xp-overnight && \
  PATH="/Users/macbook/.local/bin:$PATH" \
  uv run --locked --no-sync python pipeline/world.py \
    --workers 4 \
    --output /Users/pan-work/guilinol-xp-overnight/.world-cache/rebake-out
```

确认产出完整（如 `ls .world-cache/rebake-out/manifest.json` 与 `npm run verify:atlas` 前的目录检查）后，再切换替换 `public/world/`（此时会同步反映到 `guilinol-merged-preview/public/world`）：

```sh
cd /Users/pan-work/guilinol-xp-overnight && \
  rsync -a --delete .world-cache/rebake-out/ public/world/
```

### 方案 B：直接覆盖本工作树 `public/world`（等价补齐 `PATH` 的 `npm run world`）

若确认可直接更新 `public/world`（及软链关联的 `guilinol-merged-preview/public/world`），可直接执行：

```sh
cd /Users/pan-work/guilinol-xp-overnight && \
  PATH="/Users/macbook/.local/bin:$PATH" \
  uv run --locked --no-sync python pipeline/world.py --workers 4
```

> 注：以上两条命令均显式附带 `PATH="/Users/macbook/.local/bin:$PATH"`，确保子进程中的 `uv`、`gh` 以及 `pipeline/world.py` 内部调用的 `node scripts/bake-dams.mjs <output>` 全部可正常解析。
