## 屋顶面积复核

分母是替换区的全部像素（579,618），不是已登记的建筑。以正阳门控制点的经度分东西。参考层为冻结的 Esri z19 影像分割，不是人工真值：阴影、树冠、浅色屋面和院落边线可能分错。`scripts/dongxi/segment.py` 对 256 像素块做重叠推理，步长 192；HOTOSM dinov3s-buildings ONNX（SHA256 `9a28e28403accc06c70a3104aedb31eca50401ed23c8ba4314b26357c25e9043`）输出三个通道。本次取在已知屋面比巷轴更强的第 0 通道做 sigmoid，以 0.4371 二值化；这是一种通道解释，不代表实地测量。

在含 `tiles/esri_19_X_Y.img`、`roofs.onnx`、`map.osm`、`overture.json` 的本地素材目录运行 `segment.py`、`reconcile.py`。后者结合项目 Overture CSV、瓦片和 OSM，扣除已占屋面、步道、入口广场和门楼视线，生成 46 个低置信度补面。`refine.py` 按同一冻结影像修正既有低置信度屋缘和院落，留出有招牌的墙段。原始影像和权重不入库。

构建后用 `node scripts/photo-match.mjs --dongxi --roof-mask` 把加载的游戏几何投影到参考栅格。街区模型以瓦面及现代楼平顶材质识别，邻接模型使用高于地面 2.7 m 的投影面近似；檐口、平台可能影响边缘。运行 `python scripts/compare-market-mask.py CAPTURE --rgb density-rgb.png` 生成分区差异图。橙色为漏建，青色为多建。全区漏 15,801、多 68,624，合计 14.57%；西 9.60%，东 15.73%。这个结果达到了全区 ≤15% 的口径，东区单独计算没有达到。
