## 六合路校区资料底表

采用 [项目原始数据快照](https://github.com/idoknow/guilinol/releases/tag/raw-expanded-20261121) 的 OSM 校界 `way/606220177`，按建筑外环面积质心落在校界内筛选。OSM 快照提供建筑 way、名称和已标注层数。Overture 表提供 UUID、轮廓和已有属性。

共收录 12 个 OSM way 和 18 个 Overture UUID。其中 12 个 UUID 与 OSM 轮廓顶点集合一致，列入相应记录的 `overture_ids`，共 18 条记录。几何有差异的记录保留各自来源，尚待核对是否同楼。

## 照片与定位

检索词包括“桂电 西区 校门”“六合路123号 继续教育学院 教学楼”“六合路校区 大学科技园”。[六合路实地报道](https://www.sohu.com/a/349637736_100144123) 在桂电西校区段落连续刊登校门和临街科技园楼照片，采用配图 24、25。[学校科技园简介](https://www.guet.edu.cn/kjy/_t55/1763/list.htm) 确认园区位于六合路123号。[学校考试通知](https://www.guet.edu.cn/cjy2/2025/1218/c1436a147589/page.htm) 提到一号教学楼，但无法据此定位到轮廓。[高德校区条目](https://www.amap.com/place/B0FFFX20AL) 仅作地址交叉核对。

## 校门内外的两栋楼

校门内侧的米色四层长楼对应 `way/655605221`。从校门内拍到其东侧窗列和檐口，百度“继续教育学院（六合路店）”地点在该轮廓内。学院公告确认在此校区办学。考试通知能确认一号教学楼存在及至少有三层，但没有楼号与轮廓对照图，目录暂称“继续教育学院所在楼”。[继续教育学院办公地址](https://www.guet.edu.cn/cjy2/2022/0914/c1424a21009/page.htm) · [考试通知](https://www.guet.edu.cn/cjy2/2025/1218/c1436a147589/page.htm)

沿六合路有两栋并排的四层商铺楼。从道路对面朝北看，带“国家级大学科技园”屋顶招牌的是右侧东栋 `way/678367948`。招牌、屋顶框架、两栋间隙均与报道照片及街景相符。其质心在校界南侧，单列于 `outside_boundary_landmarks`，校内清单仍为 18 栋。卫星影像只用于对照轮廓。[Esri World Imagery 对照图](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=110.3195%2C25.2815%2C110.3218%2C25.2832&bboxSR=4326&imageSR=4326&size=850%2C700&format=jpg&f=image)
