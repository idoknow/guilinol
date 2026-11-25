# 建模前实景参考包

在仓库根目录运行（项目的 `uv` 锁定环境，脚本只用标准库、Pillow、numpy）。Linux 拼中文标题需安装 Noto Sans CJK；macOS 则使用系统中文字体。

```sh
npm run refpack -- --preset shizijie --check-bearing way/253743030
npm run refpack -- --name station-plaza --query 桂林火车站 --lat 25.263971 --lon 110.279076
npm run refpack -- --query 桂林火车站 --anchors 'center:0,0;west:-100,0'
```

`raw/refpack/<name>/index.json` 指向本次运行的本地图像（路径相对仓库根）。重复运行会保留旧图，但只发布本次清单。无数据或断网不代表命令失败：查看 `channels` 内各项的 `status`、`reason` 以及每个点位的结果。

- **百度**：有 WGS84 坐标时，POI 仅供参考；以指定坐标经 GCJ02、BD09、百度墨卡托转换后查询最近机位。只有纯查询模式才使用首个 POI。点位偏移是投影平面米数（东、北为正）。预设在 `pipeline/refpack-presets.json`。校准以机位元数据 `NorthDir` 为零度偏移，按真北顺时针生成四向图；机位的实际 WGS84 位置来自 `sdata`，不是输入点。`--check-bearing node/编号` 或 `way/编号` 用机位指向节点或道路/建筑包围盒中心，生成额外视图供人工辨认，并非自动验真。
- **OSM / Overture**：先筛选 `raw/osm*.json`（Overpass elements，含节点坐标或 way 的 center、bounds、geometry）及 `raw/overture_buildings.csv`（制表符分隔，含 `wkt`）。Overture 统计至少一个顶点在半径内的建筑；OSM 按要素中心筛选。所需 OSM 数据缺失才查 Overpass 镜像，首选 maps.mail.ru。`--radius` 单位为米。
- **Commons**：附近照片加关键词，最多五张，清单保留许可、来源和可用 GPS。请求间隔至少 1.5 秒。不是所有照片都能复用。
- **B站**：搜索视频或用 `--bvid` 指定，读取 videoshot 故事板并拼关键帧。`--amap-key` 仅为预留入口，不发请求；不抓取 720 云。

**版权红线：街景、B站帧、720 云仅供本地读比例、材质、颜色和布局，禁止裁切做贴图，禁止提交入库或发布。只有核实为 CC0 的素材可以按需复用，并在 credits 中登记。**
