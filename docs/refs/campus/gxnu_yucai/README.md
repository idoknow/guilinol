# 广西师范大学育才校区楼栋资料

本表可用于按来源 ID 对接建筑轮廓。127 栋中有 49 栋有地图名称，已核实的立面照片为 0 张。层数、颜色、屋顶和立面待补；空值表示缺少依据。

## 楼栋清点口径

使用 [项目原始数据发布包](https://github.com/idoknow/guilinol/releases/tag/raw-expanded-20261121) 中的 OSM 和 Overture 快照。以外环面积质心落在校园 way/643029633 内为入选条件，得到 93 个 OSM building way 和 127 条 Overture 建筑记录。93 对外环顶点集合完全相同，以 OSM way 作为 source，另存 overture_id。其余 34 条使用 Overture UUID。两个来源各自的 ID 均可追溯。

OSM 有 40 个具名 way，均未提供 building:levels。127 条 Overture 的 num_floors 和 roof_shape 均为空。open_spaces 收录地图标出的非建筑公园、运动场和泳池，坐标为轮廓质心。校门尚待照片及位置核实。

## 照片检索日志

| 项目内来源 | 检索与结果 |
| --- | --- |
| docs/refs/rock 及仓库内索引 | 检索“育才”“逸夫楼”“第二文科综合楼”和 gxnu，已有实拍说明未定位到本校区。 |
| idoknow/guilinol 发布列表、提交历史与 GitHub issue | 以“育才”、gxnu、yucai 等检索，未找到可归属到具体楼栋的影像资料。 |
| raw-expanded-20261121 | 提供建筑轮廓、名称和运动场地类型，可用于核对来源 ID，未提供逐楼立面照片。 |

工作区只允许访问 idoknow 项目资源，本次检索未覆盖校方和第三方网站。照片字段留空，待取得可在项目内使用的影像来源后补录。
