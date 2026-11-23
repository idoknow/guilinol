# 广西师范大学育才校区建筑参考

127 栋建筑中，9 栋有可归属到楼栋的立面照片，84 栋只有航拍依据，34 栋缺少可用外观证据。按原始 OSM 的 40 栋具名楼计算，7 栋有立面照片；另两栋为原始 OSM 无名的图书馆和仅在 Overture 具名的田家炳教育学院。照片和裁片随 IDOK-167 评论的 ZIP 提交，共 40 个 JPEG。校区内的附属外国语学校记录不含照片。

## 建模时如何使用

- 图书馆可对照校方基建处入口照片、校方斜俯视图和屋顶正射图。第二文科综合楼可对照入口玻璃、挑空门厅和楼前雕像。田家炳楼有不同时期的入口图；纪念馆有三个地面视角。
- 东苑餐厅和体育馆只有正射屋顶图。西苑食堂另有一张服务部室内照。宿舍等仅能从上方识别的建筑不推断总层数或墙色。
- colors 为对应影像中的近似色。航拍屋顶色取自轮廓向内收缩后的像素中位数，受日照、阴影和影像年代影响。floors 为能核实的总层数，floors_min 为只看得到部分楼层或校方文字只能证明的下限。
- date 表示拍摄日期，无法核实则留空。各条 photos 给出原图、所在网页和视角，同一张全景的不同局部共享原图 URL。新国教楼可确认建筑名称，但无法唯一匹配轮廓，单列于 unmatched_landmarks。南门历史图沿用作者标注；未经定位的点位坐标为空。

## 清单口径

使用[项目原始快照](https://github.com/idoknow/guilinol/releases/tag/raw-expanded-20261121)。以外环面积质心落入 way/643029633 为条件，得到 93 个 OSM building way 和 127 条 Overture 记录。93 对外环顶点集合完全相同，保留 OSM way 为 source，另存 overture_id。其余 34 条使用 Overture UUID。OSM 未提供 building:levels，Overture 未提供 num_floors 或 roof_shape。两栋原本无名的轮廓据校图、运动场和邻楼的位置关系补记为图书馆和体育馆。

## 检索日志与来源

以“广西师范大学育才校区 + 楼名 + 外观/照片”检索教学楼、行政楼、院系、后勤和学生宿舍；另查“校门”“校园全景”“体育馆 / 球类馆”“东苑餐厅 / 西苑餐厅”“图书馆广场”“校园文化景观”“VR 全景”。校内实拍优先采用有独立标题或逐图图注的资料。对外国语学校不检索内部照片。

| 来源 | 采用依据或排除原因 |
| --- | --- |
| [校基建处育才图集](https://jjc.gxnu.edu.cn/ycxq/list.psp) | 七个独立条目给出新国教楼、中越纪念雕塑、逸夫楼、数学学院、田家炳楼、职师学院和图书馆的名称及照片。 |
| [校基建处校园地图](https://jjc.gxnu.edu.cn/2255/list.htm) | 2005 年育才平面示意图用于核对图书馆、体育馆、北门后勤楼与相邻场地的位置关系。 |
| [校新闻网校训专题](https://news.gxnu.edu.cn/2022/1011/c1337a248549/page.htm) | 单独图注确认育才校区全景，对照基建处照片，裁出图书馆、广场及可识别院楼。 |
| [桂林学院档案馆](https://www.glc.edu.cn/dag/info/1198/1282.htm) | 育才办学早期照片中三排带窗、斜柱与基建处田家炳楼照片对应。 |
| [中新报道](https://news.gxnu.edu.cn/2022/0509/c1337a237888/page.htm)、[校方专题](https://news.gxnu.edu.cn/2024/1225/c1331a307669/page.psp)、[校方场馆介绍](https://www.gxnu.edu.cn/2022/1111/c2a253997/page.psp) | 三组照片可对照越南学校纪念馆的山墙、柱廊和院内长立面。 |
| [雕像落成报道](https://www.gxnu.edu.cn/2022/1013/c11796a249123/page.psp)、[MBA 教育中心地址](https://mba.gxnu.edu.cn/2011/0620/c9007a6036/page.htm) | 校方明确雕像在第二文科综合楼前；北楼七层可由学院地址验证。 |
| [校友返校指南](https://www.gxnu.edu.cn/_upload/article/files/3b/fc/ff28cc5c4bf0b4191682c6dfc216/27c532b4-0edf-4014-adc4-9edc4d1718b1.pdf#page=7) | 印刷第 5 页并列接待中心及标有“南楼”的入口；结合校图核对北楼，仅保留校内接待楼外观。 |
| [北门实拍](https://commons.wikimedia.org/wiki/File:广西师范大学育才校区北门.jpg)、[南门历史照片](https://commons.wikimedia.org/wiki/File:广西师范大学育才校区南门.jpg) | 北门作者沈澄心，CC0，2024-08-26；南门作者 luchangjiang~鲁昌江，CC BY-SA 3.0，2011-08-07。附件为缩放、重编码版本，北门另有后勤楼裁片。南门照片按[原许可](https://creativecommons.org/licenses/by-sa/3.0/)提供。 |
| [桂林人论坛田径场图集](https://bbs.guilinlife.com/forum.php?mod=viewthread&tid=9961715) | 采用大田径场草坪、弯道和看台的三个视角。 |
| [后勤改造报道](https://news.gxnu.edu.cn/2021/0905/c9188a217442/page.psp)、[后勤年度回顾](https://www.gxnu.edu.cn/2020/0106/c11796a170202/page.htm) | 前者明确标注西苑食堂服务部；后者将多校区食堂和宿舍合并叙述，无法逐图定位。 |
| [后勤行业期刊](https://www.chinacacm.org/data/upload/image/20241101/1730431708915318.pdf#page=43) | 记录东苑餐厅活动，未提供可用的外墙图。网络上同名的河南师大“东苑餐厅”已排除。 |
| [Esri World Imagery](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer) | 与原始轮廓叠合核对屋顶，重点建筑提供局部裁图。影像检索参数见 catalog 的 aerial_imagery；拍摄日期未核实。 |
