## 桂林理工大学（屏风校区）· glut_pingfeng（IDOK-165）

范围：OSM 校园 `way/380351945` 内全部建筑（OSM 113 栋 + 与 OSM 不重叠的 Overture 39 栋，扣除附属小学 `way/473969804`、七星幼儿园 `way/474309073` 内的建筑），共 147 个 footprint，全部按原始轮廓挤出，`landmarks.json` 的 `replace` 逐个列出。球场、跑道、道路、树木沿用底图。不建岗亭、闸机、监控。

照片来源：学校官网「校园景观 → 屏风校区」（https://www.glut.edu.cn/info/1147/21275.htm ），11 张。

| 照片 | 原图 | 对应建筑 | 建模要点 |
|---|---|---|---|
| 屏风东校门 | https://www.glut.edu.cn/__local/A/C9/E7/D2DA6099142FDF88B3324BACA03_9C6651F0_2A85E.jpg | 建干路校门 `node/2642095456` | 白色飘带门：左侧高位卷头、向右压低落地；右侧红色花岗岩“桂林理工大学”校名墙（科技园前） |
| 图书馆（一） | https://www.glut.edu.cn/__local/F/C3/5C/E4A4BE3848CF9EAAE9C82AE50EF_9B19F511_1A62C.jpg | 图书馆 `way/473969780` | OSM 轮廓西侧弧形凸出即入口圆筒：拟合圆心建玻璃圆筒、竖向米色面砖墙嵌“图书馆”竖匾、外圈钢柱 + 顶部白色环形雨棚与辐条；两翼白色面砖横向带窗 5 层 |
| 图书馆（二） | https://www.glut.edu.cn/__local/2/C3/EB/0FD5C6AB5419E64CA8B499F4B46_F92B8BF9_167E9.jpg | （室内阅览室） | 不建室内 |
| 国家大学科技园 | https://www.glut.edu.cn/__local/F/2E/61/BCD4BC36BB661C6FDE249FB33E3_334075B8_264EE.jpg | 大学科技园（教2楼）`way/473969787` | 7 层白色面砖独立窗；西端白色钢桁架塔高出屋面 6 m，蓝色竖排“大学科技园” |
| 教二楼 | https://www.glut.edu.cn/__local/5/A2/3B/9F61AB8EF5F9BCB697D1E371BFC_CD7166FE_18279.jpg | 推定 `way/473969788`（科技园东侧无名楼） | 9 层白色深遮阳格构 + 首层入口雨棚红底金字“土木与建筑工程学院”。楼号对应为推定 |
| 教四楼 | https://www.glut.edu.cn/__local/A/30/83/28A1762D2ED4468FDA4D65A15F5_1EA22640_2355B.jpg | 土木与建筑工程学院（教4楼）`way/473969782`、教5楼 `way/473969783` 同风格 | 米黄色壁柱立面、5 层、白色窗台线，入口雨棚校名 |
| 教六楼 | https://www.glut.edu.cn/__local/8/C0/F1/AA62C3DE719CC5766A6CD13571F_E63A1A84_24EB0.jpg | 结构实验大厅 `way/473969786` | 4 层白墙灰色窗间墙独立窗 |
| 教七楼 | https://www.glut.edu.cn/__local/C/28/B9/EAF870CF05012B9B129C0F98381_B4D4FFC2_4F8C9.jpg | 商学院（教1楼）`way/473969784` | 8 层白色带窗；南端蓝玻璃入口塔 + 雨棚“商学院” |
| 教职工活动中心 | https://www.glut.edu.cn/__local/F/0F/1D/D6230030DFCFB86B5CD507FF0A9_E3FD3B40_15D88.jpg | `way/473969797` | 白色板墙 3 层，东南角蓝玻璃弧形圆筒（白色首层、两道白色环带），立面红字“教职工活动中心” |
| 科创中心 | https://www.glut.edu.cn/__local/7/25/14/9350FD7CBFD9812522A39186E4B_F8E034B5_172BE.jpg | 推定公共教学楼（教9楼）`way/473969781`、继续教育学院（教10楼）同类 | 白色横向带窗 6 层 |
| 体育馆 | https://www.glut.edu.cn/__local/1/14/C7/B791BF0C1E1791B8B34A8FA0B8D_F68125CD_14CC6.jpg | `way/473969796` | 15 m 高玻璃幕墙 + 粉麻石壁柱和檐口带，四坡钢屋面大挑檐 3.2 m，“体育馆”名牌 |

其余建筑：`apartments` 按学生公寓 6 层米色独立窗；东侧 `house`（教工住宅）5 层白墙赭红檐口；无照片的 `yes` 4 层白墙。OSM 有 `building:levels` 时以 OSM 层数为准。

生成：`uv run python pipeline/landmarks/glut_pingfeng.py <out>`（需要 raw/ 与 public/world），打包走 `pipeline/pack_landmarks.py glut_pingfeng`。通用立面语法在 `pipeline/landmarks/uni_kit.py`，后续桂电、师大育才、桂航等校区复用。
