# 地标和街道生成约定

`pipeline/landmarks.json` 管运行时资源，`pipeline/landmark-refs.json` 只管照片参考。`anchor` 使用 `[经度,纬度]` 或 `node/123`、`way/123`、`relation/123`；模型本地坐标 x 向东、y 向上、z 向南，单位米，原点落在地面。`rotation` 单位度，绕 y 轴。`replace` 接受 Overture UUID / OSM 要素键数组，或 `{"polygon":[[经度,纬度],…]}`。`replacePolygons` 是额外的经纬度环，用来清掉模型实际占住、但对应 OSM 面比模型大的房子。线状的桥写进 `replace` 后不再生成程序化桥面。`flatten` 为 `{"polygon":[…],"elevation":绝对高程米}`。

每个生成脚本 `pipeline/landmarks/<id>.py` 接收一个临时输出目录，把未压缩 `<id>.glb`（内嵌图片）和源 PNG 写进去。安装**原生** meshoptimizer gltfpack v1.0（含 BasisU；不是 npm 的 wasm 版），放入 PATH 或设置 `GLTFPACK` 后运行 `npm run landmarks`。生成的 GLB 和同名 JSON 包围球/LOD 元数据一起提交。命名 `lod0` / `lod1` / `lod2` 的节点分别在近、中、远距离显示；没有相应层级时隐藏。`collision: mesh` 读取 `collision*` 子树，`box` 用世界包围盒，`none` 无碰撞。

`uv run python pipeline/refresh_osm.py` 从原始交接查询扩充街道节点，可传 `--endpoint`。仅在结果完整且为 2026-11 快照时替换 `raw/osm-2026-11.json`；没有新文件时可用交接底图构建。`npm run world` 写出逐路段 `street-report.json`，标明 `width`、`lanes`、`frontage` 和估算来源。GL04 街道段追加可选的第 4 项：信号灯杆位置，单位同灯位。

`web/src/look/tiles.ts` 控制近景贴图开关、距离与各类平铺米数；白色 KTX2 为乘色占位。`npm run verify:walk` 默认快速版，固定步长运行真实角色控制器。长路线、逐帧检查和原有截图改用 `npm run verify:walk:full`。`CHROMIUM=/usr/bin/chromium node scripts/street-views.mjs` 重拍街景。
