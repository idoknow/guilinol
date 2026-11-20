# 桂林市区行道树与滨水树种调研及建模规范

用途：支撑 M2.6-26（IDOK-71）桂林行道树与滨水树木的树种考证、低多边形精细模型生成（`pipeline/trees.py`）与全城按路段/水岸布置（`pipeline/vegetation.json`、`pipeline/scatter.py`）。所有外部照片链接**仅作形态与色彩参考，不入库、不做贴图**（遵循 `docs/style.md`）；色值体系以 `docs/reference.md` 深绿阔叶冠色板（近处冠团 `#2c582a`–`#48803b`、受光 `#6f9b42`、背光 `#17311c`）为基准扩展。

---

## 一、调研综述：桂林城市树木格局

1. **基调与市树双核心**：桂林属中亚热带湿润季风气候，市林业和园林局长期遵循“乡土常绿为主、乔灌相宜、突出桂花文化与山水季相”原则。城区道路多度与频度最高的基调大乔木为**香樟**与**小叶榕/黄葛榕**（桂林古称“榕城”），最具辨识度的文化符号为市树/市花**桂花**（1984 年确立，形成中山路、龙隐路、漓江路等“桂花长廊”）。
2. **断面与冠层尺度**（核对 Rock 2026-11-19 实拍 `docs/refs/rock/`）：
   - **主干路（`trunk` / `primary`，如解放西路 `IMG_1380–1386`、解放东路 `01_IMG_1390–05_IMG_1394`）**：机动车道与 3 m 独立沥青非机动车道之间的 2.2 m 绿化分隔带种植高大乔木（**小叶榕、黄葛榕、香樟**，株距 6.5–7.5 m），树冠在非机动车道上方合拢成廊；部分商业段（解放东路十字街至王城商厦北侧 `01_IMG_1390`、中山中路）在人行道外沿方形抬高树池内增植一列小乔木**桂花**，形成“内高樟榕、外低丹桂”复层街景。
   - **老城林荫次干路/支路（如翊武路 `IMG_1345–1347`、榕荫路 `IMG_1299–1302`、信义路 `IMG_1359–1360`）**：窄双车道两侧于平齐石缘树池（翊武路、榕荫路）或方形抬高花岗岩树池配防撞石墩（信义路）内栽植行道树，株距 6–8 m。榕荫路为气根垂拂的**小叶榕**隧道；翊武路为树高 12–16 m、主干向路心倾 8–15°、树冠在双车道上方合拢遮蔽天空 ≥60% 的**秋枫/复羽叶栾树/香樟**混交林荫；信义路为树池内 1.1–1.5 m 低分枝、冠高占树高约 78% 的圆卵冠**桂花**。
   - **历史轴线与色叶景观路**：靖江王城正阳路主轴两侧成排栽植**银杏**（11 月呈黄绿至金黄叶色，见 `walk-shizijie-wangcheng/25_IMG_1414.jpg`）；穿山路以高大**黄葛榕**绿色隧道闻名；七星路、西凤路以基调**香樟**配植秋冬暖色叶乔木（枫香/秋枫）；现代干道（环城北一路等）配植直立卵柱形团簇冠、零星挂红叶的阔叶树**杜英**。
   - **两江四湖滨水带**：**榕湖**以千年古榕（小叶榕/高山榕，多股融合粗干 1.2–2.0 m、支柱根粗如副干，见 `IMG_1310`、`IMG_1339`）与沿湖步道成排大**香樟**（`IMG_1334`）及亲水**垂柳**为主；**杉湖**以岸畔**水杉**尖塔冠得名（见 `docs/reference.md` R8），水际配**垂柳**与**小叶榕**；**漓江滨江路**以成排大**香樟**构成林荫隧道，江滨与庭院点缀**蒲葵/大王椰**（见 `IMG_1347`）。

---

## 二、建模树种形态参数总表（10 种可复用精细树模 + 山石灌丛）

> **造型共性铁律**：
> 1. 阔叶冠均由 **5–9 个互相重叠的不规则椭球团**（1 级细分 icosphere = 80 三角面/团，确定性顶点抖动 `14%–16%`，竖向压扁 `0.62–0.78`）构成起伏连续外轮廓，**严禁水平平底切面与叠盘板块边**；按整冠高度与法线烘焙明暗，冠底比冠顶暗一档。
> 2. 所有一级主枝梢 100% 伸入冠团内部（零枝梢悬空外露）；大乔木基部直径 **≥ 树高 × 0.05**（12 m 香樟基径 0.72 m，老榕多股融合基径 1.66 m），收分自然。
> 3. 槽位顺序兼容 `.trees` 12 字节记录（`0–5` 保持原位，新增 `6–10` 追加尾部；`5` 保留为喀斯特灌丛豁免碰撞）。

| ID | 代号 | 中文名（学名） | 基准树高 (m) | 基准冠幅 (m) | 基部干径 (m) | 起冠/分枝特征与定稿结构 | 基准叶色 | 受光叶色 | 背光叶色 | 树干色 |
|---:|---|---|---:|---:|---:|---|---|---|---|---|
| 0 | `camphor` | 香樟 (*Cinnamomum camphora*) | 12.0 | 11.1 | 0.72 | 2.6–2.9 m 起冠，宽圆穹冠（冠宽 11.1 m ≥ 冠高 9.1 m）；主干微倾 4–7°，4 根粗主枝斜展 38–48° 伸入 8 团不规则椭球冠 | `#35642f` | `#729b42` | `#19331d` | `#4a3f34` |
| 1 | `banyan` | 小叶榕 (*Ficus microcarpa*) | 12.2 | 14.8 | 1.66 | 多股根干合并粗基（1.66 m），低宽穹冠（冠宽 14.8 m = 1.51 × 冠高 9.8 m）；3 根副干级粗落地支柱根 + 4 束长短不一气根帘 | `#2c582a` | `#527f3b` | `#152d1a` | `#473c31` |
| 2 | `osmanthus` | 桂花 (*Osmanthus fragrans*) | 6.5 | 5.0 | 0.38 | 1.1–1.5 m 低分枝多主干，8 团圆卵形紧实冠下垂至 1.45 m（冠高占树高 **78%**，对齐 `IMG_1359`） | `#2a5428` | `#4e7a39` | `#162e1b` | `#665f55` |
| 3 | `palm` | 蒲葵/大王椰 (*Livistona* / *Roystonea*) | 11.1 | 6.6 | 0.64 | 灰白平滑微膨单干（`#9e988c`）与翠绿冠茎（`#4b8736`）分界清晰；双层圆润扇叶冠，叶尖明显弧垂 | `#4e7b34` | `#7ba04b` | `#294823` | `#9e988c` |
| 4 | `conifer` | 水杉 (*Metasequoia glyptostroboides*) | 15.7 | 4.4 | 0.80 | 窄圆锥冠（宽高比 `1:3.55`，落在 `1:4–1:3`）；10 层水平至微上翘羽状细轮生枝（无云杉下垂裙摆）；含 11 月锈黄变体 | `#2e5831` | `#5f833e` | `#18321f` | `#5b3e30` |
| 5 | `shrub` | 山石常绿灌丛（喀斯特地被） | 1.5 | 3.5 | — | 无主干，3 团高低错落的不规则阔叶灌丛 | `#355e2e` | `#5a843d` | `#19321e` | — |
| 6 | `virens` | 黄葛榕 (*Ficus virens*) | 13.9 | 13.3 | 0.96 | 4.5–5.0 m 高分枝配板根浅灰干，4 根粗大陡斜 V 形上举主枝托起宽阔高冠；叶色显著亮翠于香樟 | `#48803b` | `#80b44b` | `#234725` | `#685f54` |
| 7 | `bischofia` | 秋枫/栾树 (*Bischofia* / *Koelreuteria*) | 12.5 | 12.4 | 0.70 | 向路心倾干弓枝，7 团绿冠（无棕帽）+ 冠表侧上方零散嵌套粉褐栾树蒴果团（占冠面 **15.2%**，在 `10–25%` 内） | `#37642f` | `#689040` | `#1b351f` | `#463c33` |
| 8 | `elaeocarpus` | 杜英 (*Elaeocarpus decipiens*) | 11.5 | 5.7 | 0.60 | 常绿阔叶乔木：直立卵柱形团簇冠，高宽比 **2.02 : 1**；冠表零星点缀绯红老叶小团（占 **5.9% ≤ 8%**） | `#2d5b2c` | `#55803b` | `#17311c` | `#52483e` |
| 9 | `ginkgo` | 银杏 (*Ginkgo biloba*) | 12.3 | 7.0 | 0.64 | 浅灰褐直干配斜上分枝，8 团不规则椭球构成卵圆锥冠，11 月黄绿至明金黄季相 | `#a4af38` | `#dec547` | `#637226` | `#665d52` |
| 10 | `willow` | 垂柳 (*Salix babylonica*) | 9.0 | 7.4 | 0.56 | 无水平伞盘：5 团拱起小圆上冠 + 28 条细长柳丝条带呈喷泉弧线垂至离地/离水 **1.2–1.9 m**；嫩黄绿叶色 | `#638e3c` | `#94ba54` | `#355626` | `#4e4438` |

---

## 三、逐树种参考照片表（每树种 ≥ 5 张，含整株主体照/树冠/树干/秋冬季相）

### 1. 香樟 (*Cinnamomum camphora*) — `camphor`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 整株主体照（对比卡左图） | 澳大利亚 Golden Valley 树木园独立宽圆穹冠大香樟 | [File:Cinnamomum camphora in Golden Valley Tree Park, May 2022 01.jpg](https://commons.wikimedia.org/wiki/File:Cinnamomum_camphora_in_Golden_Valley_Tree_Park,_May_2022_01.jpg) |
| 2 | 整株（夏季开展穹冠） | 日本佐贺宗眼寺独立大香樟 | [File:Camphor tree of Sogan-ji in Hasuikemachi, Saga.jpg](https://commons.wikimedia.org/wiki/File:Camphor_tree_of_Sogan-ji_in_Hasuikemachi,_Saga.jpg) |
| 3 | 桂林沿湖步道成排大香樟 | 桂林榕湖北路溪流步道两侧大香樟林荫（11 月） | 项目内实拍 `docs/refs/rock/IMG_1334.jpg` |
| 4 | 树干与斜展主枝 | 熊本健军神社香樟粗干与斜展主枝 | [File:Kengun-jinja (Higashi-ku, Kumamoto) VLux5 hdsr ok02.jpg](https://commons.wikimedia.org/wiki/File:Kengun-jinja_(Higashi-ku,_Kumamoto)_VLux5_hdsr_ok02.jpg) |
| 5 | 树干细部（纵裂纹） | 香樟成熟树皮纵裂特写 | [File:Bark of Cinnamomum camphora 2.jpg](https://commons.wikimedia.org/wiki/File:Bark_of_Cinnamomum_camphora_2.jpg) |
| 6 | 秋冬季相（常绿） | 千叶神崎神社冬季常绿大香樟 | [File:Kōzaki-jinja (Kōzaki, Chiba) 10.jpg](https://commons.wikimedia.org/wiki/File:K%C5%8Dzaki-jinja_(K%C5%8Dzaki,_Chiba)_10.jpg) |

### 2. 小叶榕 / 高山榕 (*Ficus microcarpa* / *Ficus altissima*) — `banyan`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 整株与支柱根成林（对比卡左图） | 桂林古南门外榕湖北路千年古榕粗干与落地副干支柱根 | 项目内实拍 `docs/refs/rock/IMG_1310.jpg` |
| 2 | 图书馆前多股合干古榕 | 桂林榕湖北路广西省立图书馆门前大古榕（11 月） | 项目内实拍 `docs/refs/rock/IMG_1339.jpg` |
| 3 | 行道树整列与气根 | 桂林榕荫路成排行道小叶榕与榕荫路×三多路巨榕 | 项目内实拍 `docs/refs/rock/IMG_1299.jpg`、`IMG_1301.jpg` |
| 4 | 宽扁穹冠整株（外景） | 拉戈梅拉岛成年小叶榕宽冠整株（冠宽 ≈ 1.5×冠高） | [File:Ficus microcarpa - La Gomera 01.jpg](https://commons.wikimedia.org/wiki/File:Ficus_microcarpa_-_La_Gomera_01.jpg) |
| 5 | 成束气生根帘细节 | 小叶榕主枝下垂挂成束长短不一气根帘 | [File:Ficus microcarpa - La Gomera 02.jpg](https://commons.wikimedia.org/wiki/File:Ficus_microcarpa_-_La_Gomera_02.jpg) |
| 6 | 秋冬季相（11 月滨水） | 桂林榕湖 11 月大榕树常绿浓荫 | [File:Ronghu Lake Guilin November 2017 HDR.jpg](https://commons.wikimedia.org/wiki/File:Ronghu_Lake_Guilin_November_2017_HDR.jpg) |

### 3. 桂花 (*Osmanthus fragrans*，市树) — `osmanthus`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 桂林行道整株（对比卡左图） | 桂林信义路方形花岗岩树池内低分枝圆卵冠桂花（11 月） | 项目内实拍 `docs/refs/rock/IMG_1359.jpg` |
| 2 | 成列树冠与低分枝 | 桂林信义路桂花树列与 1.2 m 多主干分枝 | 项目内实拍 `docs/refs/rock/IMG_1360.jpg` |
| 3 | 主干道外侧双排桂花 | 桂林解放东路北侧人行道外沿方形树池桂花列 | 项目内实拍 `docs/refs/rock/walk-shizijie-wangcheng/01_IMG_1390.jpg` |
| 4 | 整株园林形态 | 中国南方成年桂花树紧实圆卵树冠 | [File:Osmanthus fragrans in China.jpg](https://commons.wikimedia.org/wiki/File:Osmanthus_fragrans_in_China.jpg) |
| 5 | 枝叶与秋花季相 | 金秋盛花期桂花对生革质叶与花簇 | [File:Osmanthus fragrans in full bloom.jpg](https://commons.wikimedia.org/wiki/File:Osmanthus_fragrans_in_full_bloom.jpg) |
| 6 | 丹桂秋冬花叶特写 | 橙红色丹桂秋冬季花叶形态 | [File:Osmanthus fragrans (orange flowers).jpg](https://commons.wikimedia.org/wiki/File:Osmanthus_fragrans_(orange_flowers).jpg) |

### 4. 蒲葵 / 大王椰 (*Livistona chinensis* / *Roystonea regia*) — `palm`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 桂林街景整株群（对比卡左图） | 桂林翊武路石柱铁栏围墙内高大蒲葵圆扇冠与垂尖（11 月） | 项目内实拍 `docs/refs/rock/IMG_1347.jpg` |
| 2 | 桂林滨水道路列植 | 桂林湖滨道路两侧大王椰/棕榈列植 | [File:Guilin in 2026 1.jpg](https://commons.wikimedia.org/wiki/File:Guilin_in_2026_1.jpg) |
| 3 | 蒲葵整株与垂叶裂片 | 福冈西公园冬季蒲葵圆润叶冠与下垂叶尖 | [File:Livistona Chinensis in Nishi Park Nishi-kōen Chūō-ku Fukuoka City 20221209.jpg](https://commons.wikimedia.org/wiki/File:Livistona_Chinensis_in_Nishi_Park_Nishi-k%C5%8Den_Ch%C5%AB%C5%8D-ku_Fukuoka_City_20221209.jpg) |
| 4 | 蒲葵树干与叶柄细节 | 马拉加冬季蒲葵单干与放射叶柄 | [File:Livistona chinensis Liwistona chińska 2024-01-20 Malaga 01.jpg](https://commons.wikimedia.org/wiki/File:Livistona_chinensis_Liwistona_chi%C5%84ska_2024-01-20_Malaga_01.jpg) |
| 5 | 大王椰灰白光干与翠绿冠茎 | 布里斯班植物园大王椰灰白环纹干与绿色冠茎对比 | [File:Cuban royal palm circle (Roystonea regia) City Botanic Gardens Brisbane L1000241.jpg](https://commons.wikimedia.org/wiki/File:Cuban_royal_palm_circle_(Roystonea_regia)_City_Botanic_Gardens_Brisbane_L1000241.jpg) |

### 5. 水杉 (*Metasequoia glyptostroboides*) — `conifer`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 单株整株标准照（对比卡左图） | 德国贝利茨草坪独立水杉整株窄圆锥羽状层冠 | [File:Beelitz, Landesgartenschau 2022, Urwelt-Mammutbaum auf Wiese, Sommer, 03.jpg](https://commons.wikimedia.org/wiki/File:Beelitz,_Landesgartenschau_2022,_Urwelt-Mammutbaum_auf_Wiese,_Sommer,_03.jpg) |
| 2 | 桂林杉湖水岸实景 | 桂林杉湖日月双塔背后尖塔形水杉林 | [File:89185-Guilin (49041005217).jpg](https://commons.wikimedia.org/wiki/File:89185-Guilin_(49041005217).jpg) |
| 3 | 树冠水平至微翘侧枝 | 爱知县森林公园水杉水平轮生羽叶层 | [File:Metasequoia glyptostroboides in Forest park of Aichi Prefecture.jpg](https://commons.wikimedia.org/wiki/File:Metasequoia_glyptostroboides_in_Forest_park_of_Aichi_Prefecture.jpg) |
| 4 | 树干（红褐纵槽扩基） | 巴黎植物园水杉通直红褐纵槽主干 | [File:Metasequoia glyptostroboides Hu & Cheng JdP.jpg](https://commons.wikimedia.org/wiki/File:Metasequoia_glyptostroboides_Hu_%26_Cheng_JdP.jpg) |
| 5 | 深秋锈红黄季相 | 高知牧野植物园秋冬水杉锈黄铜红季相 | [File:Makino 20211211103134 (51817307667).jpg](https://commons.wikimedia.org/wiki/File:Makino_20211211103134_(51817307667).jpg) |

### 6. 黄葛榕 / 大叶榕 (*Ficus virens*) — `virens`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 桂林主干道整株（对比卡左图） | 桂林解放西路分车绿带高分枝陡 V 形主枝黄葛榕（11 月） | 项目内实拍 `docs/refs/rock/IMG_1381.jpg` |
| 2 | 整株宽顶大冠 | 香港成年大叶榕（黄葛树）开阔高顶冠 | [File:DaaiJipJung.jpg](https://commons.wikimedia.org/wiki/File:DaaiJipJung.jpg) |
| 3 | 高分枝 V 形主枝结构 | 德里国家动物园黄葛树高耸斜上主枝架 | [File:Ficus virens at National Zoological Park Delhi - Visit during WCI 2016 (1).jpg](https://commons.wikimedia.org/wiki/File:Ficus_virens_at_National_Zoological_Park_Delhi_-_Visit_during_WCI_2016_(1).jpg) |
| 4 | 树干与板根基部 | 黄葛树浅灰褐树皮与板根基部 | [File:Ficus virens 239303854.jpg](https://commons.wikimedia.org/wiki/File:Ficus_virens_239303854.jpg) |
| 5 | 亮翠绿冠层叶片 | 黄葛树鲜亮翠绿冠层色泽 | [File:Ficus virens 398552444.jpg](https://commons.wikimedia.org/wiki/File:Ficus_virens_398552444.jpg) |

### 7. 秋枫 / 复羽叶栾树 (*Bischofia javanica* / *Koelreuteria bipinnata*) — `bischofia`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 桂林老街拱冠与蒴果（对比卡左图） | 桂林翊武路倾干合拢林荫及冠表零散粉褐栾树蒴果团 | 项目内实拍 `docs/refs/rock/IMG_1345.jpg` |
| 2 | 桂林树池倾干与复叶冠 | 桂林翊武路平齐树池与向路心倾伸主干 | 项目内实拍 `docs/refs/rock/IMG_1346.jpg` |
| 3 | 秋枫整株自然冠形 | 亚热带成年秋枫不规则团簇圆冠 | [File:Bischofia javanica.jpg](https://commons.wikimedia.org/wiki/File:Bischofia_javanica.jpg) |
| 4 | 秋枫树干与分枝 | 成年秋枫暗灰褐粗糙树干与主枝分叉 | [File:Bischofia-javanica-SF24233-02.jpg](https://commons.wikimedia.org/wiki/File:Bischofia-javanica-SF24233-02.jpg) |
| 5 | 复羽叶栾树粉褐蒴果团 | 莫里斯树木园秋末栾树冠表粉褐蒴果簇 | [File:Koelreuteria bipinnata--IMG 20161030 083948.jpg](https://commons.wikimedia.org/wiki/File:Koelreuteria_bipinnata--IMG_20161030_083948.jpg) |

### 8. 杜英 (*Elaeocarpus decipiens*) — `elaeocarpus`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 成年乔木整株照（对比卡左图） | Mounts 植物园独立成年杜英直立卵柱形阔叶团簇冠 | [File:Elaeocarpus decipiens at Mounts Botanical Garden.jpg](https://commons.wikimedia.org/wiki/File:Elaeocarpus_decipiens_at_Mounts_Botanical_Garden.jpg) |
| 2 | 城市绿地整株与分枝 | 蓬塔德尔加达城市绿地成年杜英高挑阔叶冠 | [File:Elaeocarpus decipiens (Ponta Delgada).jpg](https://commons.wikimedia.org/wiki/File:Elaeocarpus_decipiens_(Ponta_Delgada).jpg) |
| 3 | 树干与斜上侧枝 | 杜英灰褐色通直树干与斜上主枝 | [File:Elaeocarpus decipiens 01.jpg](https://commons.wikimedia.org/wiki/File:Elaeocarpus_decipiens_01.jpg) |
| 4 | 常绿冠内零星绯红老叶 | 杜英深绿阔叶丛间零星转红老叶（占比 ≤8%） | [File:Elaeocarpus decipiens 02.jpg](https://commons.wikimedia.org/wiki/File:Elaeocarpus_decipiens_02.jpg) |
| 5 | 华南公园植株核对 | 香港湿地公园成年杜英植株 | [File:杜英 Elaeocarpus decipiens -香港濕地公園 Hong Kong Wetland Park- (9227094747).jpg](https://commons.wikimedia.org/wiki/File:%E6%9D%9C%E8%8B%B1_Elaeocarpus_decipiens_-%E9%A6%99%E6%B8%AF%E6%BF%95%E5%9C%B0%E5%85%AC%E5%9C%92_Hong_Kong_Wetland_Park-_(9227094747).jpg) |

### 9. 银杏 (*Ginkgo biloba*) — `ginkgo`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 桂林王城主轴实拍（对比卡左图） | 桂林靖江王城正阳路主轴两侧黄绿金黄银杏列（11 月） | 项目内实拍 `docs/refs/rock/walk-shizijie-wangcheng/25_IMG_1414.jpg` |
| 2 | 行道成列卵圆锥冠 | 银杏夹道列植直立卵圆锥树冠 | [File:Ginkgo biloba. filare.jpg](https://commons.wikimedia.org/wiki/File:Ginkgo_biloba._filare.jpg) |
| 3 | 整株金秋盛景 | 成年银杏金黄色秋季整株冠形 | [File:GINKGOBAUM-2.jpg](https://commons.wikimedia.org/wiki/File:GINKGOBAUM-2.jpg) |
| 4 | 树干与斜上主枝 | 弗雷德里克街边银杏浅灰褐纵裂干与斜上分枝 | [File:Ginkgo biloba Frederick MD1.jpg](https://commons.wikimedia.org/wiki/File:Ginkgo_biloba_Frederick_MD1.jpg) |
| 5 | 秋叶扇形细节 | 秋季金黄扇形叶片与短枝簇生 | [File:Ginkgo-Blatt -- 2024 -- 6855.jpg](https://commons.wikimedia.org/wiki/File:Ginkgo-Blatt_--_2024_--_6855.jpg) |

### 10. 垂柳 (*Salix babylonica*) — `willow`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 湖岸整株喷泉垂丝（对比卡左图） | 日本福冈大濠公园湖岸夏季嫩黄绿喷泉冠整株垂柳 | [File:Ōhori Park The Salix babylonica Ōhorikōen Chūō-ku Fukuoka 20230605.jpg](https://commons.wikimedia.org/wiki/File:%C5%8Chori_Park_The_Salix_babylonica_%C5%8Chorik%C5%8Den_Ch%C5%AB%C5%8D-ku_Fukuoka_20230605.jpg) |
| 2 | 滨水驳岸整株倒影 | 佩朗希池塘水岸成年垂柳柔垂丝帘 | [File:Perenchies etang agache saule.jpg](https://commons.wikimedia.org/wiki/File:Perenchies_etang_agache_saule.jpg) |
| 3 | 护城河岸柔垂冠形 | 罗森堡宫水岸垂柳与石岸搭配 | [File:Outside rosenborg castle.jpg](https://commons.wikimedia.org/wiki/File:Outside_rosenborg_castle.jpg) |
| 4 | 小圆上冠与柳丝条带层次 | 成年垂柳拱起上冠与垂落近地面 1–2 m 柳丝束 | [File:SalixBabylonica.jpg](https://commons.wikimedia.org/wiki/File:SalixBabylonica.jpg) |
| 5 | 树干与斜倾低分枝 | 垂柳微斜暗褐主干与开展拱枝 | [File:Salix babylonica - Trauerweide.jpg](https://commons.wikimedia.org/wiki/File:Salix_babylonica_-_Trauerweide.jpg) |

---

## 四、桂林主要道路与水岸树种对照表（逐路附可打开核验 URL；无独立来源者标明“推断”）

| 路段 / 滨水区 | 道路等级 | 主配树种（模型代号与权重） | 断面位置、株距与树池样式 | 核验来源（可打开 URL + Rock 实拍；无独立 URL 标“推断”） |
|---|---|---|---|---|
| **中山中路** | `trunk` | 香樟 `camphor` (55%) + 桂花 `osmanthus` (35%) + 小叶榕 `banyan` (10%) | 2.2 m 绿化分隔带大树（株距 7 m）+ 人行道外沿方形树池桂花双排 | [新华网《桂林：桂花飘香满城秋》](http://gx.news.cn/20231025/9b3d1214cc1848f993b649b850d30946/c.html)；[广西新闻网（中山中路八桂大厦节点）](https://v.gxnews.com.cn/a/21710709) |
| **中山北路 / 中山南路** | `trunk` | 香樟 `camphor` (65%) + 桂花 `osmanthus` (25%) + 黄葛榕 `virens` (10%) | 主干道宽绿带成排大香樟配桂花，株距 7 m | [中新网广西《广西桂林落叶缤纷美如画》（点名中山南路香樟）](http://guangxi.china.com.cn/2022-03/21/content_41911262.html)；[桂林日报桂花专版 PDF](https://epaper.guilinlife.com/glrbpc/glrb/20241026/05.pdf) |
| **解放东路** | `primary` | 绿带：香樟 `45%` + 小叶榕 `35%` + 黄葛榕 `20%`；人行道外侧：桂花 `osmanthus` | **双排**：绿带大乔木罩住 3 m 非机动车道 + 人行道外沿抬高石树池桂花 | [中新网广西（点名解放东路黄葛榕/榕属）](http://guangxi.china.com.cn/2022-03/21/content_41911262.html)；**Rock 实拍** `walk-shizijie-wangcheng/01_IMG_1390.jpg`–`05_IMG_1394.jpg` |
| **解放西路** | `primary` | 小叶榕 `banyan` (45%) + 黄葛榕 `virens` (30%) + 香樟 `camphor` (20%) + 桂花 `osmanthus` (5%) | 2.2 m 绿化分隔带（绿篱+矮栏），株距 7 m，浓密大冠覆满非机动车道 | [中新网广西（点名解放西路黄葛榕）](http://guangxi.china.com.cn/2022-03/21/content_41911262.html)；**Rock 实拍** `IMG_1365–1370.jpg`、`IMG_1380–1386.jpg` |
| **滨江路 / 临江路** | `secondary` / `tertiary` | 香樟 `camphor` (72%) + 小叶榕 `banyan` (12%) + 蒲葵 `palm` (10%) + 垂柳 `willow` (6%) | 两侧人行道树池与临江步道带成排大香樟林荫隧道，江岸点缀棕榈与垂柳 | [广西新闻网《这些浪漫阴凉的“隧道”》（滨江路香樟）](https://v.gxnews.com.cn/a/21566674)；[桂林日报/搜狐（滨江路更换香樟）](https://www.sohu.com/a/1102596780_122057933)；**Rock 实拍** `38_IMG_1472.jpg` |
| **榕湖北路 / 榕湖南路** | `pedestrian` / `tertiary` | 榕湖北路：香樟 `camphor` (64%) + 小叶榕 `banyan` (24%) + 桂花 `8%` + 垂柳 `4%` | 沿湖溪流步道南北两侧成排大香樟，古南门与图书馆前配多股融合粗干古榕 | [广西新闻网《桂林缘何称“榕城”？》（古南门与图书馆古榕）](https://v.gxnews.com.cn/sp/21594958)；[维基百科：榕湖](https://zh.wikipedia.org/zh-tw/%E6%A6%95%E6%B9%96)；**Rock 实拍** `IMG_1310.jpg`、`IMG_1334.jpg`、`IMG_1339.jpg` |
| **榕荫路 / 三多路** | `tertiary` / `primary` | 小叶榕 `banyan` (80%) + 香樟 `camphor` (12%) + 桂花 `osmanthus` (8%) | 石板人行道平齐石框树池（株距 7 m），榕荫路重植小叶榕延续榕荫隧道，路口四角巨榕 | [广西新闻网《桂林缘何称“榕城”？》（明确记载榕荫路补种小叶榕）](https://v.gxnews.com.cn/sp/21594958)；**Rock 实拍** `IMG_1299.jpg`、`IMG_1301–1302.jpg` |
| **杉湖北路** | `tertiary` / `pedestrian` | 水杉 `conifer` (50%) + 小叶榕 `banyan` (25%) + 垂柳 `willow` (15%) + 桂花 `osmanthus` (10%) | 临湖绿带与步道侧，窄圆锥水杉林配岸线喷泉垂柳 | [维基百科：杉湖](https://zh.wikipedia.org/zh-tw/%E6%9D%89%E6%B9%96)；[凤凰网/中新网（两江四湖水杉赏叶季）](https://news.ifeng.com/c/8ojMsE2BK6U) |
| **翊武路** | `secondary` / `primary` | 秋枫/栾树 `bischofia` (60%) + 香樟 `camphor` (30%) + 小叶榕 `banyan` (10%) | 平齐树池，树高 13.5–15.6 m、主干向路心倾 11–14°，双车道上方合拢遮天 ≥60% | **Rock 实拍直接定标** `IMG_1345–1347.jpg`（倾干拱合林荫、粉褐栾树蒴果冠、院内蒲葵）；辅证 [广西新闻网（翊武路周边西山/丽君林荫网）](https://v.gxnews.com.cn/a/21566674) |
| **正阳路（王城内） / 正阳步行街** | `pedestrian` | 王城正阳路：银杏 `ginkgo` (85%) + 小叶榕 `15%`；正阳步行街：桂花 `osmanthus` (75%) + 香樟 `25%` | 王城主轴两侧对称列植银杏；正阳步行街点缀桂花（含南端八株“八桂”） | [凤凰网/中新网《桂林进入浪漫赏叶季》（靖江王城银杏）](https://news.ifeng.com/c/8ojMsE2BK6U)；[维基百科：正阳步行街](https://zh.wikipedia.org/zh-cn/%E6%AD%A3%E9%98%B3%E6%AD%A5%E8%A1%8C%E8%A1%97)；**Rock 实拍** `25_IMG_1414.jpg` |
| **信义路** | `secondary` / `tertiary` | 桂花 `osmanthus` (70%) + 香樟 `camphor` (20%) + 小叶榕 `banyan` (10%) | 方形抬高花岗岩树池 + 外侧防撞石墩，株距 7 m，1.2 m 低分枝圆卵桂花冠 | **Rock 实拍直接定标** `IMG_1359.jpg`、`IMG_1360.jpg`（信义路骑楼外抬高树池桂花列）；辅证 [广西新闻网（毗邻西山-丽君林荫片区）](https://v.gxnews.com.cn/a/21566674) |
| **西山路 / 丽君路** | `primary` | 香樟 `camphor` (60–65%) + 小叶榕 `banyan` (20–24%) + 桂花 `10–15%` + 垂柳 `0–6%` | 两侧高大香樟枝叶“握手”成荫，桃花江丽泽桥头配滨水绿树 | [广西新闻网《这些浪漫阴凉的“隧道”》（点名西山路、丽君路香樟握手成荫）](https://v.gxnews.com.cn/a/21566674)；**Rock 实拍** `IMG_1350.jpg`、`IMG_1354.jpg` |
| **穿山路 / 穿山东路 / 毅峰路 / 南环路** | `primary` / `secondary` | 黄葛榕 `virens` (45–62%) + 香樟 `camphor` (15–30%) + 桂花 `osmanthus` (10–25%) | 主干道两侧高分枝黄葛榕交织成亮翠绿林荫隧道 | [广西新闻网《这些浪漫阴凉的“隧道”》（穿山路黄葛榕）](https://v.gxnews.com.cn/a/21566674)；[中新网广西（点名穿山路、穿山东路、毅峰路、南环路黄葛榕）](http://guangxi.china.com.cn/2022-03/21/content_41911262.html) |
| **龙隐路 / 漓江路** | `primary` / `trunk` | 桂花 `osmanthus` (55–58%) + 香樟 `camphor` (30–35%) + 秋枫/栾树 `bischofia` (10–12%) | 桂林“桂花长廊”代表干道，分车带与人行道成列大规格桂花配基调香樟 | [新华网《桂林：桂花飘香满城秋》](http://gx.news.cn/20231025/9b3d1214cc1848f993b649b850d30946/c.html)；[中新网广西（点名漓江路香樟）](http://guangxi.china.com.cn/2022-03/21/content_41911262.html) |
| **七星路 / 西凤路** | `primary` | 香樟 `camphor` (38–52%) + 秋色阔叶（枫香/秋枫暖调 `bischofia` 30–38%）+ 桂花 `14–18%` | 七星路以常绿大香樟为基调并配植枫香等秋冬暖色叶乔木；西凤路为枫香色叶大道（**注**：此前误配杜英已纠正，改用香樟 + 暖秋色阔叶冠 `bischofia` 表现） | [中新网广西（明确点名七星路香樟）](http://guangxi.china.com.cn/2022-03/21/content_41911262.html)；[广西新闻网（点名西凤路枫香林荫道）](https://v.gxnews.com.cn/a/21566674)；[中国日报网（七星路冬日红枫）](https://cn.chinadaily.com.cn/a/202012/31/WS5fed65fea3101e7ce97387e4.html) |
| **凤北路 / 乐群路 / 环城北一路** | `primary` / `secondary` | 香樟 `camphor` (40–62%) + 黄葛榕/秋枫/杜英混交 | 凤北路、环城北一路以高大香樟为主；乐群路为落叶阔叶林荫道 | [广西新闻网（点名凤北路香樟、乐群路阔叶林荫）](https://v.gxnews.com.cn/a/21566674)；[中新网广西（点名环城北一路、凤北路香樟）](http://guangxi.china.com.cn/2022-03/21/content_41911262.html) |
| **环城北二路 / 环城西二路 / 上海路 / 翠竹路** | `trunk` / `primary` | 按 `arterial` 主干路默认：香樟 `48%` + 黄葛榕 `20%` + 小叶榕 `18%` + 杜英 `10%` + 桂花 `4%` | 2.2 m 绿化分隔带，株距 7.0 m，路口退让 12 m | **推断（按等级默认）** — 未检索到可直连核实的单路公开名录 URL，不在 `roadSpecies` 硬编码，统一走 `classWeights.arterial` |
| **建干路 / 辅星路 / 东江路 / 芦笛路 / 六合路** | `secondary` / `tertiary` | 按 `collector` 次干路默认：香樟 `36%` + 桂花 `26%` + 秋枫 `16%` + 小叶榕 `12%` + 杜英 `10%` | 非机动车道外侧方形抬高花岗岩树池，株距 7.0 m | **推断（按等级默认）** — 未检索到可直连核实的单路公开名录 URL，统一走 `classWeights.collector` |
| **文明路 / 民主路 / 民族路 / 五美路 / 依仁路** | `secondary` / `tertiary` / `residential` | 按 `collector` / `local` 默认：香樟 `34–36%` + 桂花 `26–34%` + 秋枫 `16–18%` + 小叶榕 `12–14%` | 老城商业与生活支路树池，株距 7.0 m | **推断（按等级默认）** — 未检索到单路公开 URL，统一走 `classWeights.collector` / `local` |

### 滨水岸线与城市绿地补充规则
- **榕湖（`ronghu`）**：小叶榕 `48%` + 香樟 `24%` + 垂柳 `20%` + 桂花 `6%` + 蒲葵 `2%`。
- **杉湖（`shan`）**：水杉 `52%` + 垂柳 `22%` + 小叶榕 `14%` + 香樟 `6%` + 桂花 `6%`。
- **桂湖 / 木龙湖（`guihu`）**：垂柳 `34%` + 水杉 `24%` + 小叶榕 `20%` + 银杏 `10%` + 香樟 `8%` + 桂花 `4%`。
- **漓江 / 桃花江（`river`）**：香樟 `32%` + 蒲葵/大王椰 `22%` + 小叶榕 `18%` + 垂柳 `10%` + 桂花 `8%` + 黄葛榕 `8%` + 水杉 `2%`。
- **一般城市绿地与校园（`mixed` / `school`）**：以常绿香樟、桂花、小叶榕、黄葛榕、秋枫、杜英为主，**银杏权重设为 `0%`**，避免在无证据绿地或街口远景出现突兀杂黄树。

---

## 五、模型生成、变体与三级 LOD 架构规范

1. **权威生成器**：`pipeline/trees.py` 统一生成 11 个槽位的 `LOD0 / LOD1 / LOD2` 几何配方 `pipeline/tree-specs.json`，并提供 `emit_landmark_tree()` 供 `yiwu_street.py`、`xinyi_arcade.py` 复用同一套不规则椭球冠与粗干模型。`web/src/look/trees.ts` 1:1 解码生成 `THREE.BufferGeometry`，保持 `treeGeometry(kind)` 返回 `{near, mid, far, material}`（完全兼容 IDOK-72）。
2. **三级 LOD 与无跳变过渡**：
   - **LOD0（近景，`0–140 m`）**：完整不规则椭球团簇冠 + 粗收分主干 + 伸入冠内的分叉主枝 + 小叶榕支柱副干与成束气根帘 / 水杉上翘羽轮 / 垂柳喷泉丝带（乔木单株 `412–1320` 三角面，覆盖城市街景近中景全视距，杜绝街口对面出现低模平顶冠）。
   - **LOD1（中景，`140–340 m`）**：低多边形三维不规则椭球簇 + 简干（单株 `70–222` 三角面），按“宽穹阔叶 / 直立卵柱阔叶 / 窄锥水杉 / 高干棕榈”4 套三维有机原型缩放并乘以各树种真实叶色。
   - **LOD2（远景，`340–1500 m`）**：极简三维低面椭球剪影簇（单株 `48–68` 三角面，废弃旧菱形纺锤插片），与 `LOD1` 保持相同三维高宽比、冠高位置与冠底/冠顶明暗梯度，远景剪影可清晰分辨宽伞榕樟、卵柱阔叶、高干棕榈与窄锥水杉，**在 `340 m` 切换处零视觉跳变**，至 `1500 m` 随雾消隐。
3. **合批上限**：`web/src/forest.ts` 最多使用 `4` 个近景树种批次 + `4` 个 `LOD1` 形态批次 + `4` 个 `LOD2` 形态批次（峰值 `≤ 12` 次 Draw Call），且 `InstancedMesh.raycast` 置空不干扰漫游地标拾取。
