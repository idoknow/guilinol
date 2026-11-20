# 桂林市区行道树与滨水树种调研及建模规范

用途：支撑 M2.6-26（IDOK-71）桂林行道树与滨水树木的树种考证、低多边形精细模型生成（`pipeline/trees.py`）与全城按路段/水岸布置（`pipeline/vegetation.json`、`pipeline/scatter.py`）。所有外部照片链接**仅作形态与色彩参考，不入库、不做贴图**（遵循 `docs/style.md`）；色值体系以 `docs/reference.md` 深绿阔叶冠色板（近处冠团 `#2f5a2c`–`#4c7a3a`、受光 `#6f9445`、背光 `#1f3a22`）为基准扩展。

---

## 一、调研综述：桂林城市树木格局

1. **基调与市树双核心**：桂林属中亚热带湿润季风气候，市林业和园林局及桂林市园林植物园（黑山植物园）长期遵循“乡土常绿为主、乔灌相宜、突出桂花文化与山水季相”的规划原则。城区道路多度与频度最高的基调大乔木为**香樟**与**小叶榕/黄葛榕**（桂林古称“榕城”），最具辨识度的文化与嗅觉符号为市树/市花**桂花**（1984 年确立，形成中山路、龙隐路、漓江路等“桂花长廊”）。
2. **断面与冠层尺度**（核对 Rock 2026-11-19 实拍 `docs/refs/rock/`）：
   - **主干路（`trunk` / `primary`，如解放西路 `IMG_1380–1386`、解放东路 `01_IMG_1390–05_IMG_1394`）**：机动车道与 3 m 独立沥青非机动车道之间的 2.2 m 绿化分隔带种植高大乔木（**小叶榕、黄葛榕、香樟**，株距 6–8 m，分枝高 2.5–3.5 m），树冠在非机动车道上方合拢成廊；部分商业繁华段（如解放东路十字街至王城商厦北侧 `01_IMG_1390`）在人行道外沿方形抬高树池内增植一列小乔木**桂花**，形成“内高樟榕、外低丹桂”的复层街景。
   - **老城林荫次干路/支路（如翊武路 `IMG_1345–1347`、榕荫路 `IMG_1299–1302`、信义路 `IMG_1359–1360`）**：窄双车道两侧直接于平齐石缘树池（翊武路、榕荫路）或方形抬高花岗岩树池配防撞石墩（信义路）内栽植行道树，株距 6–8 m。榕荫路为气根垂拂的**小叶榕**隧道；翊武路为树干微向路心倾斜、弓形主枝在双车道上方合拢的**秋枫/复羽叶栾树/香樟**混交林荫；信义路为树池内修剪整洁的**桂花**。
   - **历史轴线与彩叶景观路**：靖江王城正阳路主轴大道两侧成排栽植**银杏**（11 月中下旬呈明快黄绿至金黄叶色，见 `walk-shizijie-wangcheng/25_IMG_1414.jpg`）；七星路、西凤路以秋冬季红叶夹道的枫香/杜英色叶带著称；穿山路以高大**黄葛榕**绿色隧道闻名；现代次干道（建干路、环城北路等）广泛配植分层塔冠、四季零星挂红叶的**杜英**及观花小乔木**宫粉羊蹄甲**。
   - **两江四湖滨水带**：**榕湖**以千年古榕（小叶榕/高山榕，支柱根落地成林，见 `IMG_1310–1312`）配**香樟**（`IMG_1334`）与亲水**垂柳**；**杉湖**因岸畔成片**水杉**得名（日月双塔背景尖塔树影，见 `docs/reference.md` R8），水际点缀**垂柳**与**小叶榕**；**漓江滨江路**以近千株高大**香樟**构成“绿色穹顶”，江滨游园与院落点缀**蒲葵/大王椰**（见 `docs/reference.md` R11/R13 及 `IMG_1347`）。

---

## 二、建模树种形态参数总表（10 种可复用树模 + 山石灌丛）

> 槽位顺序兼容既有 GL04 `.trees`（索引 `0–5` 保持不变，新增树种 `6–10` 追加在尾部；索引 `5` 保留为喀斯特山石灌丛以兼容物理碰撞豁免与孤峰撒点）。

| ID | 代号 | 中文名（学名） | 树高 (m) | 冠幅 (m) | 分枝高 (m) | 冠形与枝干结构特征 | 基准叶色 | 受光叶色 | 背光叶色 | 树干色 |
|---:|---|---|---:|---:|---:|---|---|---|---|---|
| 0 | `camphor` | 香樟 (*Cinnamomum camphora*) | 11.0–14.5 | 8.5–11.5 | 2.6–3.4 | 微弯渐细纵裂干，3–4 根粗壮斜展主枝伸入多层广卵圆团簇冠 | `#3b6832` | `#648c40` | `#1b3520` | `#4d4236` |
| 1 | `banyan` | 小叶榕/高山榕 (*Ficus microcarpa*) | 10.5–14.0 | 13.0–19.0 | 2.2–3.0 | 盘根扭结粗干，大角度平展主枝，宽扁穹窿叠冠，具落地支柱根与垂挂气根帘 | `#2d592b` | `#4d7c3a` | `#17301c` | `#463b30` |
| 2 | `osmanthus` | 桂花 (*Osmanthus fragrans*) | 5.2–7.0 | 4.2–5.6 | 1.5–2.1 | 低分枝 V 形多主枝，圆卵形紧实饱满冠团，小革质浓绿叶 | `#2b5429` | `#487538` | `#18311d` | `#686157` |
| 3 | `palm` | 蒲葵/大王椰 (*Livistona* / *Roystonea*) | 9.5–13.0 | 4.6–6.2 | 8.2–11.0 | 通直灰白环纹单干配翠绿冠茎，顶端 9–11 片放射弧垂羽扇叶 | `#527b35` | `#799b4a` | `#2e4e27` | `#857c6d` |
| 4 | `conifer` | 水杉 (*Metasequoia glyptostroboides*) | 13.0–17.0 | 4.4–5.8 | 2.4–3.2 | 红褐通直尖削干（基部纵槽微扩），5 层水平轮生窄圆锥尖塔冠，秋冬带铜赭调 | `#2d5232` | `#58753b` | `#193221` | `#5a3f32` |
| 5 | `shrub` | 山石常绿灌丛（喀斯特地被） | 1.3–2.1 | 2.2–3.2 | 0.0–0.3 | 无明显主干，高低错落的三团常绿阔叶灌丛 | `#375f30` | `#56803c` | `#1a3320` | `#4a3f33` |
| 6 | `virens` | 黄葛榕/大叶榕 (*Ficus virens*) | 11.5–15.0 | 11.0–14.5 | 2.8–3.8 | 基部明显板根隆起、无长垂帘气根，4 根高耸斜展主枝撑开亮翠绿大圆伞冠 | `#3f6e35` | `#6d9644` | `#1f3b22` | `#5c5349` |
| 7 | `bischofia` | 秋枫/重阳木 (*Bischofia javanica*) | 9.5–12.5 | 8.5–11.0 | 2.4–3.2 | 暗褐微倾主干，弓形长主枝向路心舒展合拢，疏朗伞状扁圆复叶层冠（兼顾栾树秋果调） | `#386430` | `#658c3e` | `#1c3620` | `#473d34` |
| 8 | `elaeocarpus` | 杜英 (*Elaeocarpus decipiens*) | 8.5–11.5 | 5.4–7.2 | 2.2–2.8 | 通直灰褐干，轮生斜上主枝，规整宝塔/宽圆锥分层冠，常绿中零星夹绯红老叶团 | `#2f5c2e` | `#537d3a` | `#19331e` | `#52483e` |
| 9 | `ginkgo` | 银杏 (*Ginkgo biloba*) | 9.0–13.0 | 5.5–7.5 | 2.4–3.2 | 浅灰褐直立主干配斜上侧枝，卵圆锥分层冠，11 月深秋呈黄绿至明金黄扇叶季相 | `#9aa838` | `#d4be46` | `#5c6e28` | `#665d52` |
| 10 | `willow` | 垂柳 (*Salix babylonica*) | 7.8–10.5 | 7.0–9.5 | 2.0–2.6 | 微斜暗褐短干，4–5 根柔曲拱起主枝，柔嫩黄绿细长柳丝束多圈垂挂近水面 | `#567d38` | `#82a64d` | `#2d4c24` | `#4f4539` |

> **关联线索树种补充参数（归并说明）**：
> - **宫粉羊蹄甲 (*Bauhinia purpurea*)**：树高 5.5–8.0 m，冠幅 4.5–6.5 m，分枝高 1.8–2.4 m，疏散扁圆伞冠，灰白平滑干 `#756e64`，叶浅绿 `#4d7839`，冬春盛花粉紫 `#c87ca0`；11 月中旬非主花期形态与尺度接近低分枝小乔木，在非花期街景中与 `osmanthus` / `bischofia` 小尺度变体共享空间层级。
> - **玉兰（白玉兰 *Magnolia denudata* / 广玉兰 *M. grandiflora*）**：广玉兰树高 9–12 m、冠幅 6–8 m、分枝高 2.5 m，阔圆锥厚革质深绿冠（`#2c5628` / `#4e7839`），形态与 `elaeocarpus` 常绿塔状冠同属中乔木序列。
> - **枫香 (*Liquidambar formosana*) & 复羽叶栾树 (*Koelreuteria bipinnata*)**：七星路/西凤路枫香秋冬红黄层冠通过 `elaeocarpus` 红叶季相层与 `ginkgo` 暖黄变体共同表现；翊武路复羽叶栾树（`IMG_1345` 中景粉褐灯笼蒴果冠）与同路段秋枫合并于 `bischofia` 弓枝疏冠模型及其暖调种子变体。

---

## 三、逐树种参考照片表（每树种 ≥ 5 张，含整株/树冠/树干/秋冬季相）

### 1. 香樟 (*Cinnamomum camphora*) — `camphor`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 整株（夏季冠形） | 日本佐贺宗眼寺独立大香樟 | [File:Camphor tree of Sogan-ji in Hasuikemachi, Saga.jpg](https://commons.wikimedia.org/wiki/File:Camphor_tree_of_Sogan-ji_in_Hasuikemachi,_Saga.jpg) |
| 2 | 整株（公园开展冠） | 澳大利亚 Golden Valley 树木园（5 月秋末常绿） | [File:Cinnamomum camphora in Golden Valley Tree Park, May 2022 01.jpg](https://commons.wikimedia.org/wiki/File:Cinnamomum_camphora_in_Golden_Valley_Tree_Park,_May_2022_01.jpg) |
| 3 | 树冠与斜展主枝 | 桂林榕湖北路沿湖步道（11 月深秋，主枝附生蕨类） | 项目内实拍 `docs/refs/rock/IMG_1334.jpg` |
| 4 | 树干（纵裂树皮） | 熊本健军神社香樟主干与分枝 | [File:Kengun-jinja (Higashi-ku, Kumamoto) VLux5 hdsr ok02.jpg](https://commons.wikimedia.org/wiki/File:Kengun-jinja_(Higashi-ku,_Kumamoto)_VLux5_hdsr_ok02.jpg) |
| 5 | 树干细部（纵裂纹） | 香樟成熟树皮特写 | [File:Bark of Cinnamomum camphora 2.jpg](https://commons.wikimedia.org/wiki/File:Bark_of_Cinnamomum_camphora_2.jpg) |
| 6 | 秋冬季相（换叶/常绿） | 千叶神崎神社冬季常绿大香樟 | [File:Kōzaki-jinja (Kōzaki, Chiba) 10.jpg](https://commons.wikimedia.org/wiki/File:K%C5%8Dzaki-jinja_(K%C5%8Dzaki,_Chiba)_10.jpg) |

### 2. 小叶榕 / 高山榕 (*Ficus microcarpa* / *Ficus altissima*) — `banyan`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 整株与支柱根成林 | 桂林古南门外榕湖北路千年大古榕（11 月） | 项目内实拍 `docs/refs/rock/IMG_1310.jpg`（同组 `IMG_1311–1312.jpg`） |
| 2 | 行道树整列与树池 | 桂林榕荫路成排行道小叶榕（11 月） | 项目内实拍 `docs/refs/rock/IMG_1301.jpg` |
| 3 | 树干与盘绕气根 | 桂林榕荫路 × 三多路转角大榕树干与垂挂气根 | 项目内实拍 `docs/refs/rock/IMG_1299.jpg` |
| 4 | 宽伞树冠（外景） | 西班牙拉戈梅拉岛成年小叶榕整株伞冠 | [File:Ficus microcarpa - La Gomera 01.jpg](https://commons.wikimedia.org/wiki/File:Ficus_microcarpa_-_La_Gomera_01.jpg) |
| 5 | 树冠与气生根细节 | 拉戈梅拉岛小叶榕分枝与气根束 | [File:Ficus microcarpa - La Gomera 02.jpg](https://commons.wikimedia.org/wiki/File:Ficus_microcarpa_-_La_Gomera_02.jpg) |
| 6 | 秋冬季相（11 月滨水） | 桂林榕湖冬季夜景大榕树常绿浓荫 | [File:Ronghu Lake Guilin November 2017 HDR.jpg](https://commons.wikimedia.org/wiki/File:Ronghu_Lake_Guilin_November_2017_HDR.jpg) |

### 3. 桂花 (*Osmanthus fragrans*，市树) — `osmanthus`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 行道整株与方形树池 | 桂林信义路抬高花岗岩树池内的桂花行道树（11 月） | 项目内实拍 `docs/refs/rock/IMG_1359.jpg` |
| 2 | 成列树冠与低分枝 | 桂林信义路桂花树列与树下V形分枝（11 月） | 项目内实拍 `docs/refs/rock/IMG_1360.jpg` |
| 3 | 主干道外侧双排桂花 | 桂林解放东路北侧人行道外沿方形树池桂花列 | 项目内实拍 `docs/refs/rock/walk-shizijie-wangcheng/01_IMG_1390.jpg` |
| 4 | 整株园林形态 | 中国南方成年桂花树圆卵形树冠 | [File:Osmanthus fragrans in China.jpg](https://commons.wikimedia.org/wiki/File:Osmanthus_fragrans_in_China.jpg) |
| 5 | 枝叶与秋花季相 | 金秋盛花期桂花枝叶簇（对生革质叶与金黄花序） | [File:Osmanthus fragrans in full bloom.jpg](https://commons.wikimedia.org/wiki/File:Osmanthus_fragrans_in_full_bloom.jpg) |
| 6 | 丹桂秋冬花叶特写 | 橙红色丹桂秋冬季花叶形态 | [File:Osmanthus fragrans (orange flowers).jpg](https://commons.wikimedia.org/wiki/File:Osmanthus_fragrans_(orange_flowers).jpg) |

### 4. 蒲葵 / 大王椰 (*Livistona chinensis* / *Roystonea regia*) — `palm`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 桂林街景高干群植 | 桂林翊武路石柱铁栏围墙内高大蒲葵群（11 月） | 项目内实拍 `docs/refs/rock/IMG_1347.jpg` |
| 2 | 桂林滨水道路列植 | 桂林湖滨道路两侧棕榈/大王椰列植俯瞰 | [File:Guilin in 2026 1.jpg](https://commons.wikimedia.org/wiki/File:Guilin_in_2026_1.jpg) |
| 3 | 蒲葵整株与垂叶裂片 | 日本福冈西公园冬季（12 月）蒲葵整株季相 | [File:Livistona Chinensis in Nishi Park Nishi-kōen Chūō-ku Fukuoka City 20221209.jpg](https://commons.wikimedia.org/wiki/File:Livistona_Chinensis_in_Nishi_Park_Nishi-k%C5%8Den_Ch%C5%AB%C5%8D-ku_Fukuoka_City_20221209.jpg) |
| 4 | 蒲葵树干与叶柄细节 | 西班牙马拉加冬季（1 月）蒲葵环纹单干与叶冠 | [File:Livistona chinensis Liwistona chińska 2024-01-20 Malaga 01.jpg](https://commons.wikimedia.org/wiki/File:Livistona_chinensis_Liwistona_chi%C5%84ska_2024-01-20_Malaga_01.jpg) |
| 5 | 大王椰灰白环纹干与冠茎 | 布里斯班植物园大王椰树干微膨与翠绿冠茎 | [File:Cuban royal palm circle (Roystonea regia) City Botanic Gardens Brisbane L1000241.jpg](https://commons.wikimedia.org/wiki/File:Cuban_royal_palm_circle_(Roystonea_regia)_City_Botanic_Gardens_Brisbane_L1000241.jpg) |
| 6 | 大王椰行道列植 | 林贝植物园大王椰夹道天际线 | [File:Royal Palm Trees inside Limbe Botanic Garden.jpg](https://commons.wikimedia.org/wiki/File:Royal_Palm_Trees_inside_Limbe_Botanic_Garden.jpg) |

### 5. 水杉 (*Metasequoia glyptostroboides*) — `conifer`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 桂林杉湖实景背景 | 桂林杉湖日月双塔背后尖塔形水杉/杉木林 | [File:89185-Guilin (49041005217).jpg](https://commons.wikimedia.org/wiki/File:89185-Guilin_(49041005217).jpg) |
| 2 | 夏季整株尖塔树冠 | 德国贝利茨园艺展草坪单株水杉（夏季翠绿） | [File:Beelitz, Landesgartenschau 2022, Urwelt-Mammutbaum auf Wiese, Sommer, 03.jpg](https://commons.wikimedia.org/wiki/File:Beelitz,_Landesgartenschau_2022,_Urwelt-Mammutbaum_auf_Wiese,_Sommer,_03.jpg) |
| 3 | 树冠分层与羽叶 | 爱知县森林公园水杉水平轮生层冠 | [File:Metasequoia glyptostroboides in Forest park of Aichi Prefecture.jpg](https://commons.wikimedia.org/wiki/File:Metasequoia_glyptostroboides_in_Forest_park_of_Aichi_Prefecture.jpg) |
| 4 | 树干（红褐纵槽基部） | 巴黎植物园成年水杉通直红褐纵槽主干 | [File:Metasequoia glyptostroboides Hu & Cheng JdP.jpg](https://commons.wikimedia.org/wiki/File:Metasequoia_glyptostroboides_Hu_%26_Cheng_JdP.jpg) |
| 5 | 深秋锈红季相（12 月） | 高知牧野植物园 12 月水杉锈红金铜色秋叶 | [File:Makino 20211211103134 (51817307667).jpg](https://commons.wikimedia.org/wiki/File:Makino_20211211103134_(51817307667).jpg) |
| 6 | 隆冬落叶枝架（1 月） | 大阪长居植物园 1 月水杉冬季通直主干与细密侧枝 | [File:Metasequoia glyptostroboides at Nagai Botanical Garden, January 2024 - 0001.jpg](https://commons.wikimedia.org/wiki/File:Metasequoia_glyptostroboides_at_Nagai_Botanical_Garden,_January_2024_-_0001.jpg) |

### 6. 黄葛榕 / 大叶榕 (*Ficus virens*) — `virens`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 桂林主干路绿带整株 | 桂林解放西路绿化分隔带板根高分枝大榕树（11 月） | 项目内实拍 `docs/refs/rock/IMG_1381.jpg`（同段 `IMG_1384.jpg`） |
| 2 | 整株宽阔圆伞冠 | 香港成年大叶榕（黄葛树）开阔树冠整株 | [File:DaaiJipJung.jpg](https://commons.wikimedia.org/wiki/File:DaaiJipJung.jpg) |
| 3 | 树冠与斜上主枝结构 | 德里国家动物园黄葛树高耸斜展主枝与叠层冠 | [File:Ficus virens at National Zoological Park Delhi - Visit during WCI 2016 (1).jpg](https://commons.wikimedia.org/wiki/File:Ficus_virens_at_National_Zoological_Park_Delhi_-_Visit_during_WCI_2016_(1).jpg) |
| 4 | 树干与板根基部 | 黄葛树浅灰褐树皮与发达板根（少垂帘气根） | [File:Ficus virens 239303854.jpg](https://commons.wikimedia.org/wiki/File:Ficus_virens_239303854.jpg) |
| 5 | 冠层亮翠绿叶片 | 黄葛树春季换叶后鲜亮黄绿至翠绿冠层 | [File:Ficus virens 398552444.jpg](https://commons.wikimedia.org/wiki/File:Ficus_virens_398552444.jpg) |
| 6 | 秋冬季相（半落叶疏冠） | 冬季换叶期疏朗枝架与残留叶片形态 | [File:Ficus virens at National Zoological Park Delhi - Visit during WCI 2016 (4).jpg](https://commons.wikimedia.org/wiki/File:Ficus_virens_at_National_Zoological_Park_Delhi_-_Visit_during_WCI_2016_(4).jpg) |

### 7. 秋枫 / 重阳木（兼复羽叶栾树街景）(*Bischofia javanica* / *Koelreuteria bipinnata*) — `bischofia`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 桂林老街合拢拱冠与秋果 | 桂林翊武路双车道拱合大树与中景粉褐蒴果冠（11 月） | 项目内实拍 `docs/refs/rock/IMG_1345.jpg` |
| 2 | 桂林树池倾干与复叶冠 | 桂林翊武路石板人行道平齐树池与微倾主干（11 月） | 项目内实拍 `docs/refs/rock/IMG_1346.jpg` |
| 3 | 秋枫整株自然冠形 | 亚热带成年秋枫开展圆伞冠整株 | [File:Bischofia javanica.jpg](https://commons.wikimedia.org/wiki/File:Bischofia_javanica.jpg) |
| 4 | 秋枫树干与分枝皮孔 | 成年秋枫暗灰褐粗糙树干与主枝分叉 | [File:Bischofia-javanica-SF24233-02.jpg](https://commons.wikimedia.org/wiki/File:Bischofia-javanica-SF24233-02.jpg) |
| 5 | 秋枫树冠与三出复叶 | 秋枫冠层团簇与受光叶丛 | [File:Bischofia-javanica-SF24233-04.jpg](https://commons.wikimedia.org/wiki/File:Bischofia-javanica-SF24233-04.jpg) |
| 6 | 秋冬季相（老叶转红/蒴果） | 莫里斯树木园 10 月末复羽叶栾树粉红灯笼果秋景 | [File:Koelreuteria bipinnata--IMG 20161030 083948.jpg](https://commons.wikimedia.org/wiki/File:Koelreuteria_bipinnata--IMG_20161030_083948.jpg) |

### 8. 杜英 (*Elaeocarpus decipiens*) — `elaeocarpus`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 整株圆锥宝塔冠 | 杜英标准宽圆锥分层整株树形 | [File:Elaeocarpus decipiens (Japanese blueberry tree).jpg](https://commons.wikimedia.org/wiki/File:Elaeocarpus_decipiens_(Japanese_blueberry_tree).jpg) |
| 2 | 城市绿地整株与分枝 | 亚速尔群岛蓬塔德尔加达城市绿地成年杜英 | [File:Elaeocarpus decipiens (Ponta Delgada).jpg](https://commons.wikimedia.org/wiki/File:Elaeocarpus_decipiens_(Ponta_Delgada).jpg) |
| 3 | 树冠轮生层次 | Mounts 植物园亚热带生境杜英浓密分层冠 | [File:Elaeocarpus decipiens at Mounts Botanical Garden.jpg](https://commons.wikimedia.org/wiki/File:Elaeocarpus_decipiens_at_Mounts_Botanical_Garden.jpg) |
| 4 | 树干与侧枝着生 | 杜英灰褐色通直树干与斜上轮生主枝 | [File:Elaeocarpus decipiens 01.jpg](https://commons.wikimedia.org/wiki/File:Elaeocarpus_decipiens_01.jpg) |
| 5 | 常绿冠内绯红老叶（秋冬季相） | 杜英深绿叶丛间零星转红老叶（“红叶杜英”特征） | [File:Elaeocarpus decipiens 02.jpg](https://commons.wikimedia.org/wiki/File:Elaeocarpus_decipiens_02.jpg) |
| 6 | 华南公园植株核对 | 香港湿地公园杜英植株与叶片光泽 | [File:杜英 Elaeocarpus decipiens -香港濕地公園 Hong Kong Wetland Park- (9227094747).jpg](https://commons.wikimedia.org/wiki/File:%E6%9D%9C%E8%8B%B1_Elaeocarpus_decipiens_-%E9%A6%99%E6%B8%AF%E6%BF%95%E5%9C%B0%E5%85%AC%E5%9C%92_Hong_Kong_Wetland_Park-_(9227094747).jpg) |

### 9. 银杏 (*Ginkgo biloba*) — `ginkgo`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 桂林王城主轴实拍（11 月） | 桂林靖江王城正阳路主轴两侧黄绿秋叶银杏列 | 项目内实拍 `docs/refs/rock/walk-shizijie-wangcheng/25_IMG_1414.jpg` |
| 2 | 行道成列冠形 | 银杏夹道列植直立圆锥至卵圆树冠 | [File:Ginkgo biloba. filare.jpg](https://commons.wikimedia.org/wiki/File:Ginkgo_biloba._filare.jpg) |
| 3 | 整株金秋盛景 | 成年银杏金黄色秋季整株冠形 | [File:GINKGOBAUM-2.jpg](https://commons.wikimedia.org/wiki/File:GINKGOBAUM-2.jpg) |
| 4 | 春夏翠绿树冠与主干 | 荷兰哈伦植物园 5 月银杏斜上分枝与绿冠 | [File:Hortus Haren 18-05-2019. (actm.) 03.jpg](https://commons.wikimedia.org/wiki/File:Hortus_Haren_18-05-2019._(actm.)_03.jpg) |
| 5 | 树干与斜生主枝细节 | 弗雷德里克街边银杏浅灰褐纵裂干与分枝角 | [File:Ginkgo biloba Frederick MD1.jpg](https://commons.wikimedia.org/wiki/File:Ginkgo_biloba_Frederick_MD1.jpg) |
| 6 | 秋叶扇形细节 | 2024 年秋季金黄扇形叶片与短枝簇生特写 | [File:Ginkgo-Blatt -- 2024 -- 6855.jpg](https://commons.wikimedia.org/wiki/File:Ginkgo-Blatt_--_2024_--_6855.jpg) |

### 10. 垂柳 (*Salix babylonica*) — `willow`
| # | 部位/季相 | 拍摄地点 / 场景 | 参考链接 / 仓库实拍 |
|---:|---|---|---|
| 1 | 滨水驳岸整株垂丝 | 法国佩朗希池塘水岸成年垂柳整株倒影 | [File:Perenchies etang agache saule.jpg](https://commons.wikimedia.org/wiki/File:Perenchies_etang_agache_saule.jpg) |
| 2 | 护城河岸柔垂冠形 | 丹麦罗森堡宫水岸垂柳与石岸搭配 | [File:Outside rosenborg castle.jpg](https://commons.wikimedia.org/wiki/File:Outside_rosenborg_castle.jpg) |
| 3 | 树冠与柳丝束层次 | 成年垂柳拱曲主枝与多束下垂柳丝冠 | [File:SalixBabylonica.jpg](https://commons.wikimedia.org/wiki/File:SalixBabylonica.jpg) |
| 4 | 树干与低分枝形态 | 垂柳微斜粗糙暗褐主干与开展大枝 | [File:Salix babylonica - Trauerweide.jpg](https://commons.wikimedia.org/wiki/File:Salix_babylonica_-_Trauerweide.jpg) |
| 5 | 冬季驳岸浅绿枝条（季相） | 阿姆斯特丹驳岸冬季仍带黄绿柔枝的垂柳 | [File:An old houseboat is lying along the quay with a weeping willow tree and its already green branches in winter; Amsterdam city photo, 2023 - free download street photography by Fons Heijnsbroek.jpg](https://commons.wikimedia.org/wiki/File:An_old_houseboat_is_lying_along_the_quay_with_a_weeping_willow_tree_and_its_already_green_branches_in_winter;_Amsterdam_city_photo,_2023_-_free_download_street_photography_by_Fons_Heijnsbroek.jpg) |

### 附：宫粉羊蹄甲 (*Bauhinia purpurea*) 与玉兰 (*Magnolia*) 对照参考（各 5 张）
- **宫粉羊蹄甲**：[整株冠形](https://commons.wikimedia.org/wiki/File:Bauhinia_purpurea_tree.jpg) · [树冠分枝](https://commons.wikimedia.org/wiki/File:Bauhinia_purpurea_(Kaniar)_in_Hyderabad,_AP_W_IMG_2573.jpg) · [树干与羊蹄叶](https://commons.wikimedia.org/wiki/File:Cascoebuey_(Bauhinia_purpurea)_(15414495688).jpg) · [侧枝结构](https://commons.wikimedia.org/wiki/File:JfBauhinia_purpureaCabiaofv_04.JPG) · [冬春粉紫花期](https://commons.wikimedia.org/wiki/File:Bauhinia_purpurea_2.jpg)
- **白玉兰 / 广玉兰**：[白玉兰树皮与主干](https://commons.wikimedia.org/wiki/Category:Magnolia_denudata) · [广玉兰树皮分类](https://commons.wikimedia.org/wiki/Category:Magnolia_grandiflora_(bark)) · [桂林解放西路多层常绿中乔木核对 `IMG_1365.jpg`] · [桂林翊武路老楼旁庭荫乔木核对 `IMG_1351.jpg`] · [桂林榕湖博物馆/图书馆旁庭院常绿树核对 `IMG_1340.jpg`]

---

## 四、桂林主要道路与水岸树种对照表（含证据来源与 Rock 实拍核对）

| 路段 / 滨水区 | 道路等级 | 主配树种（模型代号与权重） | 断面位置、株距与树池样式 | 证据来源（市政/文献/报道 + Rock 实拍核对） |
|---|---|---|---|---|
| **中山中路** | `trunk` | 香樟 `camphor` (55%) + 桂花 `osmanthus` (35%) + 小叶榕 `banyan` (10%) | 2.2 m 绿化分隔带大树（株距 7 m）+ 人行道外沿桂花点缀 | 新华网《桂林：桂花飘香满城秋》“桂花长廊”核心干道报道；`docs/reference.md` R10 中山路街景 |
| **中山北路 / 中山南路** | `trunk` | 香樟 `camphor` (65%) + 桂花 `osmanthus` (25%) + 黄葛榕 `virens` (10%) | 主干道宽绿带成排大香樟配桂花，株距 7 m | 广西新闻网/桂林生活网主干道香樟春季换叶与桂花景观道报道 |
| **解放东路** | `primary` | 绿带：香樟 `camphor` (50%) + 小叶榕 `banyan` (50%)；人行道外沿：桂花 `osmanthus` | **双排**：绿带大乔木罩住 3 m 非机动车道 + 人行道外侧方形抬高树池种桂花（株距 7 m） | **Rock 实拍核对**：`walk-shizijie-wangcheng/01_IMG_1390.jpg`–`05_IMG_1394.jpg` 清晰拍到外侧抬高石树池桂花与内侧绿带樟/榕双排结构 |
| **解放西路** | `primary` | 小叶榕 `banyan` (45%) + 黄葛榕 `virens` (30%) + 香樟 `camphor` (20%) + 桂花 `osmanthus` (5%) | 2.2 m 宽绿化分隔带（配绿篱+铁艺矮栏），株距 6.5–7.5 m，冠覆非机动车道 | **Rock 实拍核对**：`IMG_1365–1370.jpg`（艺术馆段浓密樟榕冠）、`IMG_1380–1386.jpg`（主干道标准断面，大榕树板根与V形主枝罩满非机动车道） |
| **滨江路 / 临江路** | `secondary` / `tertiary` | 香樟 `camphor` (72%) + 小叶榕 `banyan` (12%) + 蒲葵/大王椰 `palm` (10%) + 垂柳 `willow` (6%) | 两侧人行道树池与临江步道带，株距 6.5 m，江岸游园点缀棕榈与垂柳 | 广西新闻网《桂林滨江路：遮天蔽日的香樟“绿色隧道”》；`docs/reference.md` R11/R13；**Rock 实拍** `walk-dongxi-xiaoyao-jiefang/38_IMG_1472.jpg`、`49_IMG_1483.jpg` |
| **榕湖北路 / 榕湖南路** | `pedestrian` / `tertiary` | 小叶榕 `banyan` (62%) + 香樟 `camphor` (26%) + 桂花 `osmanthus` (8%) + 垂柳 `willow` (4%) | 沿湖石板步道花坛与树池，古南门与图书馆前特大古榕（`scale=125–140`） | 广西新闻网“古南门千年古榕”报道；`docs/reference.md` R4；**Rock 实拍核对**：`IMG_1310–1312.jpg`（大古榕支柱根）、`IMG_1334.jpg`（沿湖大香樟）、`IMG_1339.jpg`（图书馆前古榕） |
| **榕荫路 / 三多路** | `tertiary` / `primary` | 小叶榕 `banyan` (80%) + 香樟 `camphor` (12%) + 桂花 `osmanthus` (8%) | 石板人行道平齐石框树池（离缘 1.1–1.4 m，株距 7 m），路口四角巨型气根榕 | **Rock 实拍核对**：`IMG_1299.jpg`（榕荫路×三多路巨榕与石栏墩）、`IMG_1301–1302.jpg`（成排树池小叶榕，盘根气根明显） |
| **杉湖北路** | `tertiary` / `pedestrian` | 水杉 `conifer` (50%) + 小叶榕 `banyan` (25%) + 垂柳 `willow` (15%) + 桂花 `osmanthus` (10%) | 临湖绿带与步道侧，水杉成簇尖塔背景配岸线垂柳 | 两江四湖景区植物志及杉湖得名考；`docs/reference.md` R5、R8（双塔背后尖塔水杉林） |
| **翊武路** | `secondary` / `primary` | 秋枫/栾树 `bischofia` (58%) + 香樟 `camphor` (30%) + 小叶榕 `banyan` (12%) | 深灰石板人行道平齐树池（`treeInset=1.15 m`，株距 7 m），主干微向路心倾、双车道上方合拢 | 桂林生活网《老街翊武路》宋城墙浓荫报道；**Rock 实拍核对**：`IMG_1345–1347.jpg`（倾干弓枝合拢林荫、11 月中段粉褐栾果冠、院墙内蒲葵） |
| **正阳路（王城内） / 正阳步行街** | `pedestrian` | 王城正阳路：银杏 `ginkgo` (85%) + 小叶榕 `banyan` (15%)；正阳步行街：桂花 `osmanthus` (65%) + 香樟 `camphor` (25%) + 银杏 `ginkgo` (10%) | 王城主轴石板路两侧树穴对称列植；步行街避开中央通行带点缀桂花（南端八桂） | 维基百科/桂林晚报正阳步行街“八株八桂桂花树”及靖江王城古榕名木记载；**Rock 实拍核对**：`walk-shizijie-wangcheng/25_IMG_1414.jpg`（王城主轴两侧黄绿银杏列） |
| **信义路** | `secondary` / `tertiary` | 桂花 `osmanthus` (70%) + 香樟 `camphor` (20%) + 小叶榕 `banyan` (10%) | 次干/支路标准断面：方形抬高花岗岩树池 + 外侧防撞石墩，株距 7 m | **Rock 实拍核对**：`IMG_1359.jpg`、`IMG_1360.jpg`（典型桂林街道断面样板，抬高方形树池内低分枝圆卵冠桂花） |
| **丽君路** | `primary` | 香樟 `camphor` (50%) + 小叶榕 `banyan` (30%) + 桂花 `osmanthus` (12%) + 垂柳 `willow` (8%) | 桃花江红桥两端主干道绿化带与桥头绿地 | 桂林市园林绿化局城区干道名录；**Rock 实拍核对**：`IMG_1350.jpg`、`IMG_1354–1358.jpg`（红桥两岸浓密樟榕与滨水绿树） |
| **穿山路 / 穿山东路 / 自由路** | `primary` / `secondary` | 黄葛榕 `virens` (62%) + 桂花 `osmanthus` (25%) + 香樟 `camphor` (13%) | 宽阔主干道两侧高大黄葛榕树冠交织成“绿色隧道”，下层及分车带配桂花 | 广西新闻网《桂林穿山路：黄葛榕交织的绿色长廊》及七星区桂花大道报道 |
| **龙隐路 / 漓江路** | `primary` / `trunk` | 桂花 `osmanthus` (58%) + 香樟 `camphor` (30%) + 秋枫/栾树 `bischofia` (12%) | 桂林标志性“桂花长廊”迎宾大道，分车带与人行道成列栽植大规格桂花配香樟 | 新华网《桂林：十里桂花长廊迎客来》（点名龙隐路、漓江路为桂花核心大道） |
| **七星路 / 西凤路** | `primary` | 杜英(含红枫季相) `elaeocarpus` (52%) + 香樟 `camphor` (30%) + 桂花 `osmanthus` (18%) | 两侧林荫带，秋冬呈现红绿相间的色叶大道风貌 | 中国日报/广西新闻网《桂林七星路、西凤路枫香红叶似火》及**Rock 实拍** `IMG_1361.jpg`（西凤路观漪桥路口） |
| **翠竹路 / 六合路** | `primary` / `tertiary` | 银杏 `ginkgo` (45%) + 香樟 `camphor` (35%) + 杜英 `elaeocarpus` (20%) | 现代干道绿带，秋季金黄银杏与常绿香樟、杜英交替 | 广西新闻网/中国天气网桂林市区翠竹路与六合路秋季银杏景观报道 |
| **建干路 / 辅星路 / 东江二路** | `secondary` / `primary` | 杜英 `elaeocarpus` (45%) + 秋枫 `bischofia` (35%) + 香樟 `camphor` (20%) | 高校及景区次干道，轮生宝塔冠杜英与开展伞冠秋枫混交 | 桂林市七星区市政道路绿化提质改造公开报道 |
| **上海路 / 环城北一路 / 环城北二路 / 环城西二路** | `trunk` / `primary` | 香樟 `camphor` (55%) + 杜英 `elaeocarpus` (25%) + 黄葛榕 `virens` (20%) | 城市快速/主干环线宽幅绿化隔离带，高大抗尘常绿乔木为主 | 桂林生活网《上海路、环城路行道树提质更新为大规格香樟与杜英》报道 |
| **文明路 / 民主路 / 民族路 / 五美路 / 依仁路** | `secondary` / `tertiary` | 香樟 `camphor` (42%) + 小叶榕 `banyan` (28%) + 桂花 `osmanthus` (20%) + 秋枫 `bischofia` (10%) | 老城商业与生活次干/支路，方形抬高树池，株距 7 m | 桂林老城区行道树样线统计特征（香樟、小叶榕、桂花三者占老城支路 85% 以上） |

### 无单独证据道路的等级默认规则与滨水岸线规则

1. **按道路等级默认配置（无具名规则时）**：
   - **`trunk` / `primary`（主干路，断面 `arterial`）**：种于 `verge`（宽 2.2 m 绿化分隔带）中央，株距 7.0 m，路口退让 12 m；默认树种权重：香樟 `48%`、黄葛榕 `22%`、小叶榕 `18%`、杜英 `12%`（常绿大冠合拢覆盖非机动车道）。
   - **`secondary` / `tertiary`（次干路与主要支路，断面 `collector`）**：种于非机动车道外侧方形抬高花岗岩树池（带外侧石墩，`IMG_1359–1360`），株距 7.0 m；默认树种权重：香樟 `36%`、桂花 `30%`、秋枫 `18%`、杜英 `10%`、小叶榕 `6%`。
   - **`residential`（居住支路，断面 `local`）**：种于人行道外沿树池，株距 7.5 m；默认树种权重：桂花 `38%`、香樟 `32%`、秋枫 `18%`、小叶榕 `12%`。
   - **`pedestrian`（步行街/广场边缘）**：仅在非禁种边线小密度点缀桂花 `60%`、银杏 `20%`、小叶榕 `20%`，绝不侵占步行主通道或地标保护范围。
2. **滨水湖岸与江岸布置规则（`scatter.py` 水岸带）**：
   - **榕湖**：小叶榕 `56%` + 垂柳 `24%` + 香樟 `14%` + 桂花 `6%`（亲水岸线近水处优先垂柳与大榕树）。
   - **杉湖**：水杉 `58%` + 垂柳 `22%` + 小叶榕 `14%` + 桂花 `6%`（突出杉湖水杉尖塔天际线与岸畔垂柳）。
   - **桂湖 / 木龙湖**：垂柳 `38%` + 水杉 `26%` + 小叶榕 `22%` + 银杏 `14%`（还原桂湖垂柳长堤与银杏水岸）。
   - **漓江 / 桃花江**：香樟 `34%` + 蒲葵/大王椰 `24%` + 小叶榕 `18%` + 垂柳 `16%` + 黄葛榕 `8%`。

---

## 五、模型生成、变体与三级 LOD 架构规范

1. **生成器位置与数据流**：
   - `pipeline/trees.py` 为唯一权威模型生成器，按各树种植物学分枝规律（渐细微曲主干、分叉可见的一级/二级主枝、有机切面分层冠团、榕树支柱气根与垂帘气根、棕榈弧垂叶条、水杉水平轮生塔层、垂柳下垂枝帘）生成三维网格与紧凑声明式几何配方 `pipeline/tree-specs.json`，并支持一键导出各树种多变体/多 LOD `.glb` 及渲染对比图集。
   - `web/src/look/trees.ts` 读取同一份配方构建 `THREE.BufferGeometry`，对外保持 `treeGeometry(kind)` 返回 `{near, mid, far, material}`（完全兼容 IDOK-72 约定的 `{near, far, material}` 单几何体 + `position`/`normal`/`color` + 共享 `instanceColor` 材质接口）。
2. **三级 LOD 与雾隐对齐**：
   - **LOD0（近景，0–82 m）**：完整精细低多边形模型（渐细曲干 + 可见分叉主枝 + 4–7 团分层有机冠块 + 榕树气根 / 垂柳丝帘；乔木单株 188–388 三角面、灌丛 38 三角面，剔除一切地下封底面与相交内封口面）。
   - **LOD1（中景，82–340 m）**：简化三维体积模型（5–6 棱简干插入 1–2 个合并轮廓冠体；各树种单株 12–62 三角面，运行时合批为圆伞阔叶与尖塔轮生 2 套共享形态原型，通过非均匀缩放与 `instanceColor` 还原各树种高宽比与叶色层次）。
   - **LOD2（远景，340–1500 m）**：正交交叉剪影面片 + 俯视封顶片（`交叉面片`，烘焙冠底暗部至冠顶受光渐变色；单株仅 **10–14 三角面**，俯瞰与平视均不穿帮，1500 m 外随高度距离雾自然消隐）。
3. **每树种 3 个形态与色彩变体**：
   - 每个树种内置 3 组形态变体参数（冠幅/树高各向异性微调比例、主干微倾角度、常绿/秋色色相与明度偏移），在 `Forest` 实例化矩阵与 `instanceColor` 解码时由每棵树的 `seed` 确定性选取（`seed % 3`）并叠加连续缩放（`0.82–1.28`）、随机方位旋转与 `±9%` 色彩微调，消除重复感且不增加材质数。
4. **渲染合批与零额外 Draw Call 保证**：
   - `web/src/forest.ts` 采用有界 `InstancedMesh` 合批架构：近景 `0–82 m` 按最近距离选取最多 `6` 个树种精细批次（超出树种自动优雅归入 `LOD1` 形态代理），中景 `82–340 m` 共用 `2` 个形态代理批次，远景 `340–1500 m` 共用 `1` 个交叉剪影批次。无论在硬件 GPU（Metal/WebGL2）还是软件光栅（SwiftShader）环境下，全城树木最多仅 **9 次 Draw Call**（严格低于改前基线 12 次），总三角面数同步下降 3%–26%，桌面端与手机端 p95 帧时间均不退化。
