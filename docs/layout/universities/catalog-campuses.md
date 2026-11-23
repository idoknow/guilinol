## 资料驱动的高校校区（IDOK-165）

`pipeline/landmarks/uni_campus.py` 读取 `docs/refs/campus/<campus_id>/catalog.json`，每条记录在原始 OSM / Overture footprint 上调用 `uni_kit.building`。层数优先用 catalog，其次用 OSM `building:levels`，都没有时按面积估。立面语法和颜色按照片描述取：阳台/外廊 → `balcony`，粉色分格 → `panel`，横向窗带/分层线 → `ribbon`，竖向线条 → `pilaster`，浅绿竖带 → 绿色壁柱，砖红 → 红色窗间带，其余 → `punched`。各校区模块只补主楼和校门。`landmarks.json` 的 `replace` 按 catalog 逐个列出，并设 `auditPerBuilding`。

| 校区 | 模块 | 楼栋 | 主楼 / 校门（照片依据：catalog 对应记录） |
|---|---|---|---|
| 桂电金鸡岭 `way/606121236` | `guet_jinjiling` | 72 | 东区图书馆：南面深色玻璃竖带、入口台阶、屋顶“图书馆 LIBRARY”；第七至十教学楼：灰白墙夹粉色面砖（`panel`），第十教学楼端墙竖排“勤正楼”；300/400 号宿舍：连续阳台；金鸡路校门在 `node/2642045084`、`node/5934103940`，做两组青色门架和米色花岗岩校名石，不做岗亭和道闸；图书馆南侧圆形水池取 OSM 环形步道 `way/727843927` 的圆心（catalog 给的经纬度偏了约 100 m）。 |
| 桂电六合路 `way/606220177` | `guet_liuhe` | 18 | 只有 1 栋有地面照片。其余按金鸡岭教学楼配色（灰白加粉色分格），层数用 catalog 的值。 |
| 师大育才 `way/643029633` | `gxnu_yucai` | 127 | 图书馆：上部粉色面砖、两层白色裙楼带窗、北面竖匾“图书馆”；越南九二学校旧址：两层黄墙、深灰四坡顶、首层白色廊柱；职师院：白框加砖红窗间带；后勤基建处：淡黄墙、白色竖框；北门在 `node/6310986841`，做浅褐色“广西师范大学 育才校区”题名墙。附属外国语学校（K-12）只做 OSM 级白色体块。 |
