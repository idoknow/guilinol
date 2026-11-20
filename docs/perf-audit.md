# 城区渲染体检

基线为 b119f88。以 WebGL 实际提交统计主相机和水面倒影两遍。飞行一行汇总 verify:flight 的六个预设机位，其余五处各用一个固定机位。

| 项目 | 基线与证据 | 差距 |
|---|---|---|
| 复用与合批 | batch.ts 的四个 StaticLayerBatch 跨块合并楼体、水、桥、街面，另有两个 InstancedMesh 画街具与停放车辆。每块另有一次地形提交。buildings.ts 的屋顶设备已经并入墙体。 | landmarks.ts 只给王城市场的命名商铺节点做实例化。 |
| 远景 | forest.ts 以 600 m 切换每个树种的 near/far，1500 m 裁树。landmarks.ts 在 350/650 m 换档。look/atmosphere.ts 用高度雾和 4200–7500 m 的地平线过渡。 | 程序楼仍提交远处屋顶小构件；树种数硬编码为 6。森林/街区的流式半径与大气可见距离用途不同。 |
| 隐藏面 | g3_kit.py 与 m26_16_kit.py 的 box 默认不建底，c_kit.py 的 box 建六面。pack_landmarks.py 压缩前未统一检查。 | 需要保护碰撞网格、架空的桥底、多级模型和共享网格。 |
| 烘焙 | main.ts 只创建方向光和半球光，没有开启 shadowMap。look/trees.ts 的 paint 按树冠高度把阴部写入顶点色。 | 程序墙顶点未记录接地、内角的局部遮蔽。 |
