## 桂林扩区原始数据

投影原点保持 25.280 N、110.300 E。东界定为龙门大桥东岸 110.352 E。Overture places 没有匹配，sg 查到的同名村在灵川（25.479 N、110.393 E）。对齐后，实际分块外包框比可玩 bbox 多出不足一个块；采集框向外取整至 25.21054–25.36798 N、110.24150–110.35341 E。IDOK-2 附件只用来提供原查询模板。

在没有同名 raw 目录的工作区，从项目 Release 获取 sg 验收输入：

```sh
gh release download raw-expanded-20261121 -R idoknow/guilinol -p 'guilinol-expanded-raw.tar.gz*'
shasum -a 256 -c guilinol-expanded-raw.tar.gz.sha256 &&
  tar xzf guilinol-expanded-raw.tar.gz &&
  (cd raw && shasum -a 256 -c SHA256SUMS)
```

归档 SHA-256 为 `6e27094128202833802bd60f6d18df8b10fd48805810347a25442fb77fd1f8e4`。sg 获取此次原料时，Overpass 返回 502/504，最终使用 openstreetmap.fr 的 2026-11-19 广西 PBF，共生成 11394 个 OSM 要素。重新制作这份快照时，指定该版 PBF；同一命令同时提供 `--overpass` 和 `--pbf` 会先尝试 Overpass，失败后使用本地 PBF。转换需要当前 Python 环境安装 osmium。

在本地准备同一版 Overture 区域 buildings 与 places 的 GeoParquet（项目交接版本 2026-10-21.0）、带 spatial 扩展的 DuckDB CLI、覆盖上述范围的项目 Terrarium 镜像及支持历史查询的项目 Overpass 端点。从仓库根目录执行：

```sh
"$MULTICA_CLI_PATH" attachment download 01a1ed3a-7982-7a4c-a208-39d6fbdba4a4
unzip -p guilinol-handoff-data.zip raw/q.txt > handoff-query.txt
uv run --locked python pipeline/prepare_expansion.py \
  --query handoff-query.txt --pbf "$GUANGXI_PBF" --terrarium "$PROJECT_TERRARIUM" \
  --buildings "$BUILDING_PARQUET" --places "$PLACE_PARQUET" --output raw
(cd raw && shasum -a 256 -c SHA256SUMS)
```

`--output` 需要一个尚不存在的目录。脚本固定 OSM 查询时间为 2026-11-21 00:00 UTC，把 OSM 查询分成 3 × 3 片，每片间隔 10 秒，按类型和 ID 去重并排序。脚本从采集框计算 z14 瓦片范围，校验 54 张 DEM 瓦片，按 Overture id 排序写出建筑表，并把采集框内名字含“龙门村”的 places 条目写到 `longmen.tsv`。本次核实结果见上。

全量扩区构建还读取项目已发布的市中心 world（`world-34caca91e6cf`）。首次构建使用 gh 到本仓库下载并核验归档，后续使用 `.world-cache/` 内同一哈希的缓存。旧城最外一圈 70 块用于衔接。该圈内沿使用旧城高度、道路样条，南边在最外 64 m 内、其余三边在 256 m 内平滑过渡到扩区的结果。内侧 252 对 GL04 / trees 按世界坐标复用已发布字节；山体渲染与地标的定位采用同一基线。仓库内地标 GLB 仍直接使用现有文件。

在 `0c89c80` 上重建时，全域底图 `overview.bin` 来自固定区域快照。边缘包 `overview-edge.bin` 以当前可玩 bbox 加 1600 m 筛选路径与标签。实测旧框保留 516 条路径、81 个标签，扩区框保留 1071 条、173 个；全域包均含 2553 条路径。内城 252 对块同时与该版 main 的已发布包 `world-4052da78a7e5` 逐字节一致。

对照旧框岸线可运行 `uv run --locked python pipeline/reference_shore.py <旧框 world 目录> <旧框 OSM JSON>`。采样间距至多 4 m，排除 bbox 最外 16 m，距离按原始水岸至烘焙水格边缘计算。在 `0c89c80` 的旧框 27 个水体中，16,796 个岸线样点有 8,784 个超过 2 m，359 个达到 6.32 m。月牙池最大 7.136 m。这是相同渲染方法在扩区前已有的偏差。逐水体数据在 `docs/verification/idok-114/shore-main.json`。
