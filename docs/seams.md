## 地标边界审计

先按 README 准备原始数据并构建 `public/world`。`npm run audit:seams` 默认写入 `captures/seams/`，每个地标和全城各一张 PNG，采样记录在 `seams.json`。坐标是世界 X、Z 米；每条边等分，单段不超过 2 m。存在超限时返回非零。只采集基线可用 `npm run audit:seams -- --ids central_square zhongshan_road --report-only --out captures/seams-before`。

边界包括 flatten、replace（含 OSM / Overture ID）、replacePolygons，以及已登记高差测线的 LOD0 铺装向上三角面并集（`heightBoundaries`）。边界两侧各取 2 cm，世界表面来自 GL04 地形、分块道路多边形、道路高程控制网和铺装层偏移。模型使用加载时的锚点和旋转。`height` 是超过 5 cm 的候选位差；桥面、台阶等分层结构需核查实际相邻层，不能直接解释成悬空。`surfaceOverlap` 表示铺装侵入不同类型的世界路面，`paintOcclusionCandidate` 表示铺装高于采到的标线。

`pipeline/seam-surfaces.json` 以地标 ID 和压缩 GLB 材质名选择完整图元，不能把混合建筑图集整个绑定成路面。角色为 `road`、`sidewalk`、`plaza`、`curb`、`marking`。它们使用街道共享材质，颜色与世界坐标贴图尺度均来自街道配置。`exceptions` 中的 `{ "id": "…", "material": "…" }` 仅保留该地标该材质，不免除几何检查。经批准的特殊铺装依据与收边方式由风格负责人记录在 `docs/style.md`。

`atlas` 以纹理变换后的 UV 框选取三个顶点都在铺装区的三角形；渲染和审计共用选择器。同一地标可给出多个框，按声明顺序选面。坐标使用 glTF 纹理变换后的 UV，框边允许半个 12 位量化单位的误差。没有边界的地标不代表通过。车道线掩盖候选检查不等于跨界标线连续性证明。尚未自动判断所有路缘端点之间的 0.3 m 错位。

`segments` 按地标、物理层合并首尾相接的超限采样区间，同层重合的 flatten / replace 边只计一次。每段报告世界 XZ 折线和长度，`segmentCount`、`lengthM` 为各地标合计。解放桥用桥跨范围、OSM 接线路径和高度区分桥面、上层引道、匝道、下穿道路。桥头继续检查地面衔接；没有找到同层相邻面的样点在 `unpairedLayers` 单列，不能当作通过。`--public PATH` 可用同一套检测器检查另一版压缩模型及世界分块。
榕湖北岸例外带 `kind: retainingWall`，`worldXZ` 是挡墙和阶口沿上层人行道的世界坐标折线。只豁免距线 8 cm 以内、下层模型贴近铺装标高且上层为人行道的 `height`，不影响材质绑定或其他异常。实际高差逐点记入 `designedRises`，不是固定豁免 5 m。
`streetCrossings` 按 `[边界, marking/curb, X, Z, 内0/外1, 对侧距离或null, 候选异常或null]` 输出。两侧取距边界 1 cm 的平行线，直接与 GL04 标线面和人行道路缘相交，不依赖 2 m 采样是否碰巧踩中标线。相邻分块间的裁剪边不作路缘。标线须连在同一漆面；路缘候选错位阈值为 0.3 m。虚线端部、路口停线、近平行交点以及桥面模型内自带的标线都需结合同层几何核对；不能仅凭邻近就认定道路已接通。交点是点事件，不加入超限段长度。只有校牌、无铺装或替换边界的学校检查实际校牌占地。


`streetSurfaceInventory` 按地标、LOD0 材质、UV 框、角色和绑定状态汇总向上面的数量与水平投影面积（平方米）。`bound`、`exception` 分别对应运行时绑定和已批准的材质例外。独立车道、路缘和标线图元即使在桥面上也会检查。其余未声明面按与 GL04 车行道、人行道、盲道和标线的投影距离（含相交，最大 2 m）与接触点高差（最大 0.20 m）查找。`unboundStreetSurface` 是候选三角面总数，任一候选都会使严格审计返回非零。对候选给出的 UV 框是实测范围，`worldXZ` 是组内最大三角面的中心，可用于定位。贴近地面的建筑基座和街道设施也可能被检出，需结合生成脚本核对其用途。

`npm run audit:seams -- --strict` 写出完整报告。`--report-only` 保留相同的采样和报告，适合比较版本。低空道路对比机位在 `scripts/seam-acceptance-cameras.json`，其中 `jiefang_bridge-road-seam` 面向解放桥西引道与解放东路的交接处。

材质排查遍历所有 LOD0，不受 `heightBoundaries` 限制。高差测线继续使用 IDOK-69 已配对的地表边界，换材质本身不会在每条漆线、校园内部或桥面上下层之间建立新的高差测线。
