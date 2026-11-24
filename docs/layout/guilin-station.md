## 站坪与两座跨线天桥

2024-12-24 的 Esri World Imagery（Vantor WV03，zoom 19）上可辨认出两条横跨站台的屋面。北侧浅色横带是 #297 描图的天桥，中心约在项目 z=1700 m。南侧横带的走向和位置与 OSM `way/819178842` 相符，中心约在 z=1819 m。三处站台梯口沿用与该 way 相接的 steps 819178843、819178844、819178845 的 OSM 节点。底图与带坐标的对照见 IDOK-244 评审线程附件。[Esri World Imagery](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer) · [南侧人行天桥](https://www.openstreetmap.org/way/819178842)

模型采用站房东侧中央入口的铺面标高 155.05 m（项目 x=-2169.595 m，z=1783.113 m）。1 站台与入口齐平。站台高暂取 1.25 m，得到轨面 153.80 m。两桥梁底均为 161.30 m。公路隧道 690911289 在股道下的顶面为 152.60 m，路面为 148.10 m。这些是游戏模型的设计值。可调参数在 `pipeline/railway-style.json` 的 `stationLevels` 字段。
