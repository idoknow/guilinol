# 桂林电子科技大学（花江校区）：建筑清单

项目 Release `raw-expanded-20261123`（归档及 `raw/SHA256SUMS` 均已核验）。OSM 广西快照：2026-11-23；Overture：2026-10-21.0。

- `osm-2026-11.json`：按 `way/606118480` 定位校界，提取建筑 way 的名称和已标注层数。
- `overture_buildings.csv`：按建筑面内部代表点是否落入上述边界（含边）筛选；OSM 建筑使用相同口径。与 OSM 建筑的最大交并面积比 ≥ 0.8 时合并，UUID 保留于 `source_aliases`。

OSM 135 条，Overture 169 条，合并 135 条，清单 169 栋。

仓库资料检索词：`花江校区`。本表仅列建筑 way 及 Overture 面，不把 OSM relation 再作为一栋建筑累加。层数仅填写有来源的数据；未获照片核实的立面、颜色及屋顶均留空。项目原始包不含实景照片。
