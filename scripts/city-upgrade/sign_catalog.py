"""
Single source of truth for the 96-design compliant Guilin "One-Shop-One-Color"
signboard catalog (12 sun-faded hue families x 8 designs = 96 fascias, 6x16 grid @ 4:1)
and 16 slim vertical pier blade signs (8x2 grid).

Compliance (docs/style.md Phase 2 #5 & IDOK-471 / IDOK-472):
  - 100% original Guilin local shop names; zero real registered chain trademarks.
  - Preserves exact 96-slot hue_family & pref_h mapping (aidx 0..95) so all existing
    public/city-upgrade/shards/*.json remain 100% compatible without re-baking.
  - Every fascia & blade binds to one of >=20 multi-primitive industry vector icons
    in sign_icons.py (zero blank plaques, zero single-char circle stamps).
  - Every background/foreground color pair is calibrated for 20% neutral-gray
    saturation cap AND strictly passes WCAG 2.1 contrast >= 4.5:1 (title & subtitle).
"""
from __future__ import annotations

import re

from sign_icons import ICON_REGISTRY

# 6 asymmetric commercial layouts on 4:1 wide fascia canvas (1280x320 -> 640x160):
#   - left_hero     : Left vector emblem + bold left-aligned title/sub + top-right meta tag
#   - split_tag     : Left vector emblem + center title/sub + right contrasting utility column
#   - heritage_seal : Heritage double-border + left medallion + vertical divider + right chop stamp
#   - led_ticker    : Upper emblem/title/sub + bottom dot-matrix high-contrast LED ticker bar
#   - luxury_frame  : Double hairline boutique frame + left crest + English kicker + spacious title
#   - duotone_banner: Left contrasting color block with emblem + right title + bottom accent ribbon
VALID_MODES = (
    "left_hero",
    "split_tag",
    "heritage_seal",
    "led_ticker",
    "luxury_frame",
    "duotone_banner",
)

# Tuple fields (indices 0..12 kept 100% compatible with build_city_upgrade.py & audit_city_upgrade.py):
#  0: key         1: hue_family  2: substrate   3: bg       4: fg        5: accent
#  6: title       7: subtitle    8: mode        9: fstyle  10: glow     11: pref_h
# 12: zones      13: icon_type  14: badge_tag
FasciaSpec = tuple[
    str, str, str, str, str, str, str, str, str, str, float, float, tuple[str, ...], str, str
]

FASCIA_SPECS: list[FasciaSpec] = [
    # --- 1. black (8) ---
    ("guiyun_flower",  "black",   "acp",     "#222529", "#F4F1E8", "#A8C6AC", "榕岸花集",       "鲜花定制 · 绿植盆景",        "luxury_frame",   "serif", 0.62, 0.96, ("old_downtown", "riverside_scenic"),                     "flower",      "FLOWER STUDIO"),
    ("moyun_tea",      "black",   "acp",     "#1F2227", "#F4EFE2", "#C9A660", "墨韵茶社",       "功夫茗茶 · 临江雅座",        "heritage_seal",  "brush", 0.64, 1.02, ("old_downtown", "riverside_scenic"),                     "tea",         "山水清茗"),
    ("qingyu_flower",  "black",   "acp",     "#212428", "#F2EFE8", "#A4B89E", "杉湖花礼",       "手捧花束 · 气球布置",        "left_hero",      "serif", 0.60, 0.92, ("old_downtown", "station_arterial"),                     "flower",      "0773 · FLOWER"),
    ("qutao_station",  "black",   "gusset",  "#1F2126", "#F2B652", "#D4644E", "叠彩文具屋",     "办公耗材 · 学生画材",        "duotone_banner", "sans",  0.74, 1.18, ("old_downtown", "campus_edge", "neighborhood_alley"),    "books",       "文体百货"),
    ("mijing_wear",    "black",   "acp",     "#202328", "#F4F3EE", "#C2C9D0", "觅境买手女装",   "独立设计 · 质感穿搭",        "luxury_frame",   "sans",  0.62, 0.98, ("old_downtown", "station_arterial"),                     "fashion",     "ATELIER WEAR"),
    ("nuanmian_mom",   "black",   "gusset",  "#232429", "#F5E8E2", "#DF7E76", "暖棉母婴生活",   "婴童棉品 · 贴身好物",        "split_tag",      "sans",  0.68, 1.08, ("old_downtown", "neighborhood_alley"),                   "fashion",     "母婴严选\n安心棉品"),
    ("qinghe_salon",   "black",   "acp",     "#202327", "#F5F4EE", "#B8BFC8", "青禾剪裁造型",   "精剪烫染 · 头皮养护",        "luxury_frame",   "sans",  0.64, 1.00, ("old_downtown", "neighborhood_alley", "campus_edge"),    "salon",       "HAIR STUDIO"),
    ("mingcai_tea",    "black",   "acp",     "#1F2024", "#EED078", "#C8A652", "茗采桂花茶行",   "桂花乌龙 · 礼盒直供",        "heritage_seal",  "brush", 0.68, 1.08, ("old_downtown", "riverside_scenic", "station_arterial"), "tea",         "桂林茶礼"),

    # --- 2. white (8) ---
    ("apo_kitchen",    "white",   "acrylic", "#EBE8DF", "#84221D", "#26282C", "阿婆家常小馆",   "现炒下饭 · 桂林小炒",        "duotone_banner", "sans",  0.70, 1.18, ("old_downtown", "neighborhood_alley"),                   "food",        "现炒现卖"),
    ("guikang_pharm",  "white",   "acrylic", "#ECF0EC", "#7E201C", "#2B5B3B", "桂康便民大药房", "中西成药 · 处方调配",        "split_tag",      "sans",  0.72, 1.20, ("old_downtown", "station_arterial", "neighborhood_alley"), "pharmacy",    "医保定点\n24H 便民"),
    ("laozihao_fen",   "white",   "acp",     "#EAE3D5", "#1E1C1A", "#8A281E", "陈记老卤菜粉",   "古法卤水 · 三鲜锅烧",        "heritage_seal",  "brush", 0.70, 1.18, ("old_downtown", "station_arterial", "riverside_scenic"), "noodle",      "桂林老味"),
    ("laojie_luwei",   "white",   "acrylic", "#E6E2DA", "#201E1C", "#822620", "西城熟食卤味",   "招牌肺片 · 桂林卤鸭",        "left_hero",      "sans",  0.68, 1.08, ("old_downtown", "neighborhood_alley"),                   "food",        "每日现卤"),
    ("xunwei_sweet",   "white",   "acrylic", "#EFEBE2", "#82221E", "#6E2A26", "寻味糖水铺",     "槐花粉 · 马蹄糕 · 冰甜品",   "heritage_seal",  "serif", 0.68, 1.06, ("old_downtown", "riverside_scenic", "campus_edge"),      "dessert",     "手工甜品"),
    ("shihua_studio",  "white",   "acp",     "#EFECE6", "#22262B", "#4C5860", "拾花手作花艺",   "鲜花绿植 · 干花花束",        "luxury_frame",   "serif", 0.58, 0.94, ("old_downtown", "riverside_scenic"),                     "flower",      "BOTANICAL LAB"),
    ("lijiang_gift",   "white",   "acp",     "#EAE6DD", "#7A221E", "#2A5442", "漓江伴手礼行",   "桂花糕 · 三花酒 · 特产",     "split_tag",      "serif", 0.70, 1.16, ("station_arterial", "riverside_scenic"),                 "specialty",   "桂林特产\n顺丰包邮"),
    ("jieya_laundry",  "white",   "acrylic", "#E8EEF0", "#1E3A5A", "#2E547A", "洁雅洗衣护鞋",   "羽绒精洗 · 奢品修护",        "left_hero",      "sans",  0.68, 1.10, ("station_arterial", "neighborhood_alley"),               "laundry",     "24H 取送"),

    # --- 3. brown (8) ---
    ("laozaotou_fen",  "brown",   "gusset",  "#2B211A", "#F2D26C", "#D6A648", "瓦窑老灶汤粉",   "筒骨鲜汤 · 卤菜叉烧粉",      "led_ticker",     "brush", 0.76, 1.22, ("old_downtown", "neighborhood_alley", "station_arterial"), "noodle",      "老店新灶"),
    ("fuman_teahouse", "brown",   "gusset",  "#4A221E", "#F6EBD0", "#DFB86E", "福满茶艺棋牌",   "清茶雅座 · 邻里聚会",        "left_hero",      "serif", 0.68, 1.12, ("old_downtown", "neighborhood_alley"),                   "tea",         "24H 雅间"),
    ("xiangkou_wine",  "brown",   "acrylic", "#4E211D", "#F7ECCA", "#2B4A6E", "巷口名酒副食",   "名茶礼盒 · 烟酒饮料",        "split_tag",      "sans",  0.72, 1.16, ("old_downtown", "neighborhood_alley", "station_arterial"), "specialty",   "正品保真\n平价直供"),
    ("gongcheng_tea",  "brown",   "gusset",  "#3B271C", "#F6E8C2", "#D8AC5C", "恭城阿婆油茶",   "现打姜茶 · 船上糕 · 艾粑",   "heritage_seal",  "brush", 0.74, 1.20, ("old_downtown", "riverside_scenic", "station_arterial"), "tea",         "非遗风味"),
    ("lian_craftbeer", "brown",   "acp",     "#2E221B", "#F2E9D8", "#DCB26C", "漓岸精酿酒馆",   "桂花小麦 · 晚间小酌",        "luxury_frame",   "serif", 0.64, 1.00, ("riverside_scenic", "old_downtown"),                     "food",        "CRAFT BEER BAR"),
    ("lingnan_art",    "brown",   "acp",     "#3C2C22", "#F4ECDC", "#CCA86C", "岭南字画装裱",   "文房四宝 · 书画装裱",        "heritage_seal",  "brush", 0.64, 1.06, ("riverside_scenic", "old_downtown"),                     "books",       "墨香斋记"),
    ("pijiu_fish",     "brown",   "gusset",  "#48231B", "#F8E092", "#E2B058", "漓江剑骨啤酒鱼", "阳朔风味 · 砂锅田螺酿",      "led_ticker",     "brush", 0.76, 1.24, ("riverside_scenic", "station_arterial"),                 "food",        "招牌现杀"),
    ("laotong_shoes",  "brown",   "acrylic", "#442E22", "#F5EEE0", "#DFBF8A", "老铜匠修鞋铺",   "手工皮具 · 贴底翻新",        "left_hero",      "sans",  0.66, 1.04, ("neighborhood_alley", "old_downtown"),                   "hardware",    "三十年手艺"),

    # --- 4. yellow (8) ---
    ("xianguo_mart",   "yellow",  "gusset",  "#D4AE54", "#241914", "#6E1E18", "漓北鲜果仓",     "应季直采 · 果篮礼盒",        "duotone_banner", "sans",  0.72, 1.12, ("old_downtown", "neighborhood_alley", "station_arterial"), "fruit",       "产地直供"),
    ("jianyu_mens",    "yellow",  "gusset",  "#CCA44C", "#1D1B18", "#483614", "正阳男装服饰",   "商务休闲 · 针织衬衣",        "luxury_frame",   "sans",  0.66, 1.04, ("old_downtown", "station_arterial"),                     "fashion",     "MENSWEAR 0773"),
    ("zhiqu_kids",     "yellow",  "gusset",  "#D8B458", "#641814", "#3E2216", "小象童装店",     "纯棉童装 · 亲子穿搭",        "left_hero",      "sans",  0.72, 1.16, ("old_downtown", "neighborhood_alley"),                   "fashion",     "全棉优选"),
    ("xiaoshudian",    "yellow",  "acrylic", "#D5B056", "#1C2A3C", "#25486E", "小数点婴童馆",   "新生棉品 · 启蒙玩具",        "split_tag",      "sans",  0.70, 1.14, ("old_downtown", "neighborhood_alley"),                   "fashion",     "母婴好物\n会员优惠"),
    ("guixiang_bake",  "yellow",  "acp",     "#D2AA52", "#261B12", "#6A2E1A", "桂香现烤面包",   "手工可颂 · 桂花酥饼",        "duotone_banner", "serif", 0.70, 1.10, ("station_arterial", "campus_edge", "old_downtown"),      "bakery",      "BAKERY · 现烤"),
    ("zaoan_baozi",    "yellow",  "acrylic", "#D6B054", "#4E120E", "#5A1812", "林记手工面点",   "鲜肉大包 · 现磨豆浆",        "led_ticker",     "sans",  0.72, 1.16, ("neighborhood_alley", "station_arterial", "campus_edge"),"bakery",      "06:00 营业"),
    ("jinsui_grain",   "yellow",  "gusset",  "#CEAA52", "#221D14", "#2E4A2C", "金穗粮油干货",   "山货干果 · 生态香米",        "split_tag",      "sans",  0.70, 1.18, ("neighborhood_alley", "station_arterial"),               "specialty",   "平价粮油\n送货上门"),
    ("lvtu_luggage",   "yellow",  "acrylic", "#D2AE56", "#1A2C40", "#264666", "站前行李寄存",   "自助存包 · 桂林攻略",        "duotone_banner", "sans",  0.72, 1.14, ("station_arterial",),                                    "hotel_home",  "24H 寄存"),

    # --- 5. cream (8) ---
    ("danzi_mifen",    "cream",   "acp",     "#E6DABE", "#201C18", "#7E241C", "象山担子米粉",   "古法卤菜粉 · 脆皮锅烧",      "heritage_seal",  "brush", 0.70, 1.08, ("old_downtown", "riverside_scenic", "station_arterial"), "noodle",      "百年手艺"),
    ("yunshang_wear",  "cream",   "acp",     "#E9E4DC", "#222428", "#5E4638", "云裳阁女装",     "轻熟穿搭 · 四季上新",        "luxury_frame",   "serif", 0.58, 0.96, ("old_downtown", "station_arterial"),                     "fashion",     "YUNSHANG BOUTIQUE"),
    ("nanshan_cafe",   "cream",   "acp",     "#ECE5D2", "#202226", "#744E18", "南山巷口咖啡",   "单品手冲 · 现烤可颂",        "luxury_frame",   "serif", 0.60, 0.96, ("old_downtown", "riverside_scenic", "campus_edge"),      "coffee",      "COFFEE & BAKERY"),
    ("chujian_wear",   "cream",   "acp",     "#E7E0D4", "#222428", "#4A463E", "初见棉麻衣社",   "天然棉麻 · 舒适版型",        "left_hero",      "serif", 0.56, 0.94, ("old_downtown", "riverside_scenic"),                     "fashion",     "NATURAL LINEN"),
    ("chaowei_beef",   "cream",   "acp",     "#EDE7DC", "#1E1C1A", "#80241E", "潮味手打牛丸",   "清汤牛腩 · 现切吊龙",        "heritage_seal",  "brush", 0.68, 1.14, ("old_downtown", "station_arterial", "neighborhood_alley"),"food",        "现捶牛丸"),
    ("suxin_culture",  "cream",   "acp",     "#EAE2D2", "#20282E", "#2C4E46", "素心山水文创",   "桂林明信片 · 印章手账",      "luxury_frame",   "serif", 0.60, 0.98, ("riverside_scenic", "campus_edge"),                      "books",       "GUILIN CULTURE"),
    ("guihe_inn",      "cream",   "acp",     "#E5DEC9", "#22201C", "#5E4226", "归禾江景民宿",   "推窗见山 · 旅途小院",        "heritage_seal",  "serif", 0.64, 1.08, ("riverside_scenic", "station_arterial"),                 "hotel_home",  "江畔雅宿"),
    ("qingkong_optic", "cream",   "acrylic", "#E8E5DC", "#1E2B3A", "#2A4C6E", "晴空眼镜验光",   "精准验光 · 轻钛镜架",        "split_tag",      "sans",  0.66, 1.04, ("campus_edge", "station_arterial", "old_downtown"),      "glasses",     "专业验光\n立等可取"),

    # --- 6. crimson (8) ---
    ("laowei_mifen",   "crimson", "gusset",  "#6E2420", "#F7E8B2", "#E2BA64", "七星石磨米粉",   "老坛酸笋 · 脆皮锅烧",        "heritage_seal",  "brush", 0.74, 1.16, ("old_downtown", "neighborhood_alley", "station_arterial"), "noodle",      "石磨现榨"),
    ("liuwei_luofen",  "crimson", "gusset",  "#642228", "#F8E4E8", "#EAB8C0", "柳味原汤螺粉",   "原汤螺蛳粉 · 虎皮猪脚",      "led_ticker",     "sans",  0.74, 1.12, ("old_downtown", "campus_edge", "neighborhood_alley"),    "noodle",      "现熬螺汤"),
    ("rongcheng_flw",  "crimson", "acrylic", "#782622", "#F7EED0", "#E8C66E", "正阳喜庆花艺",   "开业花篮 · 同城急送",        "duotone_banner", "sans",  0.72, 1.14, ("old_downtown", "station_arterial"),                     "flower",      "同城速递"),
    ("feilong_fix",    "crimson", "acrylic", "#742822", "#F6E282", "#E6B458", "老梁精工修锁",   "修表配钥 · 芯片钥匙",        "left_hero",      "sans",  0.70, 1.14, ("old_downtown", "neighborhood_alley"),                   "hardware",    "0773 · 急开锁"),
    ("hanmo_print",    "crimson", "acrylic", "#762822", "#F6E07C", "#254062", "翰墨图文快印",   "标书装订 · 彩打晒图",        "split_tag",      "sans",  0.72, 1.16, ("campus_edge", "old_downtown", "station_arterial"),      "books",       "24H 快印\n图纸装订"),
    ("guibei_chili",   "crimson", "gusset",  "#6A221E", "#F8E8B8", "#DFB662", "桂北手工辣酱",   "蒜蓉剁椒 · 桂花豆腐乳",      "heritage_seal",  "brush", 0.74, 1.18, ("riverside_scenic", "station_arterial"),                 "specialty",   "老坛酿造"),
    ("hongyun_stir",   "crimson", "gusset",  "#722620", "#F8EBBE", "#E6BA60", "鸿运川湘小炒",   "猛火现炒 · 干锅砂锅",        "led_ticker",     "sans",  0.74, 1.22, ("station_arterial", "neighborhood_alley"),               "food",        "夜宵营业"),
    ("jufu_wedding",   "crimson", "acrylic", "#722228", "#F7E5BA", "#E2BC6C", "聚福喜糖礼铺",   "喜糖喜酒 · 婚庆伴礼",        "left_hero",      "serif", 0.70, 1.10, ("neighborhood_alley", "old_downtown"),                   "specialty",   "良辰喜铺"),

    # --- 7. orange (8) ---
    ("guibei_fresh",   "orange",  "acrylic", "#8E4222", "#FAF2DC", "#2A5032", "三里店生鲜铺",   "社区菜篮 · 粮油蛋奶",        "split_tag",      "sans",  0.74, 1.24, ("old_downtown", "neighborhood_alley", "station_arterial"), "fruit",       "每日平价\n社区生鲜"),
    ("weilai_duck",    "orange",  "acp",     "#8C4224", "#F8F1DE", "#242220", "文记脆皮烤鸭",   "片皮烤鸭 · 秘制卤味",        "split_tag",      "sans",  0.72, 1.18, ("old_downtown", "neighborhood_alley"),                   "food",        "现烤出炉\n半只可售"),
    ("laoxiang_wok",   "orange",  "gusset",  "#863622", "#F7E8B4", "#E6BC68", "老巷炭火炒粉",   "桂林炒粉 · 叉烧拌面",        "led_ticker",     "sans",  0.74, 1.16, ("old_downtown", "neighborhood_alley", "campus_edge"),    "noodle",      "炭火现炒"),
    ("juzi_tea",       "orange",  "acrylic", "#904624", "#FCF5E6", "#F2CE84", "橘子手打柠檬茶", "现捣香水柠 · 鲜果茶饮",      "duotone_banner", "sans",  0.68, 1.02, ("campus_edge", "old_downtown", "riverside_scenic"),      "dessert",     "FRESH TEA"),
    ("xingwang_ebike", "orange",  "gusset",  "#883E20", "#FAF0DC", "#223C58", "兴旺电动车行",   "整车以旧换新 · 补胎换电",    "duotone_banner", "sans",  0.72, 1.20, ("neighborhood_alley", "station_arterial"),               "hardware",    "专修换电"),
    ("nuanyang_pet",   "orange",  "acp",     "#8E4826", "#FAF4E6", "#2B4A38", "暖阳宠物洗护",   "洗澡美容 · 寄养粮品",        "left_hero",      "sans",  0.66, 1.06, ("neighborhood_alley", "station_arterial"),               "laundry",     "PET CARE"),
    ("guinan_goose",   "orange",  "gusset",  "#843820", "#F8E8B8", "#E4BA66", "桂南明炉烧鹅",   "明炉烧鹅 · 广式叉烧",        "heritage_seal",  "brush", 0.74, 1.18, ("station_arterial", "old_downtown"),                     "food",        "明炉现斩"),
    ("tanxiang_bbq",   "orange",  "gusset",  "#7C341E", "#F8E8B4", "#24201E", "炭香夜宵烧烤",   "炭火烤串 · 紫苏炒田螺",      "led_ticker",     "brush", 0.76, 1.22, ("neighborhood_alley", "campus_edge", "station_arterial"),"food",        "18:00-03:00"),

    # --- 8. green (8) ---
    ("siji_fruit",     "green",   "acrylic", "#2E5238", "#F7F3DF", "#DFBA62", "四季鲜果直供",   "精品鲜果 · 现切果盘",        "duotone_banner", "sans",  0.70, 1.16, ("old_downtown", "station_arterial", "neighborhood_alley"), "fruit",       "每日直达"),
    ("lvcheng_post",   "green",   "acp",     "#244432", "#F2D264", "#E2C872", "绿城社区驿站",   "快递收发 · 邻里便民",        "left_hero",      "sans",  0.68, 1.12, ("old_downtown", "neighborhood_alley", "station_arterial"), "hotel_home",  "早8晚10"),
    ("zelin_hw",       "green",   "acrylic", "#284B37", "#F4F6F2", "#BCE0C8", "泽霖五金水电",   "五金工具 · 灯具开关",        "left_hero",      "sans",  0.70, 1.14, ("neighborhood_alley", "station_arterial", "old_downtown"), "hardware",    "水电建材"),
    ("xiuxin_tailor",  "green",   "gusset",  "#233E32", "#ECD072", "#B4D4BE", "秀新精工改衣",   "量体裁衣 · 换拉链裤脚",      "heritage_seal",  "serif", 0.68, 1.08, ("old_downtown", "neighborhood_alley"),                   "fashion",     "精工细作"),
    ("jimin_pharm",    "green",   "acrylic", "#284D3A", "#F6F4EA", "#842620", "叠彩济民药堂",   "中药饮片 · 家庭常备药",      "split_tag",      "serif", 0.72, 1.20, ("station_arterial", "neighborhood_alley"),               "pharmacy",    "执业药师\n医保刷卡"),
    ("cuilu_produce",  "green",   "gusset",  "#2D4E35", "#F6EED0", "#E2BC64", "阳朔金桔农产",   "脆蜜金桔 · 永福罗汉果",      "heritage_seal",  "serif", 0.70, 1.14, ("riverside_scenic", "station_arterial"),                 "fruit",       "桂林原产"),
    ("senyu_plants",   "green",   "acp",     "#2A4535", "#F2F2EA", "#B4D0B8", "森屿绿植花房",   "多肉盆栽 · 庭院造景",        "luxury_frame",   "serif", 0.62, 0.98, ("riverside_scenic", "neighborhood_alley"),               "flower",      "GREENHOUSE"),
    ("xianshu_market", "green",   "acrylic", "#315338", "#F7F3E2", "#E6BC58", "东江平价菜市",   "农户直供 · 鲜蔬活鱼",        "duotone_banner", "sans",  0.72, 1.16, ("neighborhood_alley",),                                  "fruit",       "早市新鲜"),

    # --- 9. teal (8) ---
    ("laozhou_beef",   "teal",    "gusset",  "#264A42", "#F7EBC4", "#DFB864", "老周秘制牛腩粉", "浓汤牛腩 · 萝卜牛杂",        "led_ticker",     "brush", 0.72, 1.22, ("old_downtown", "neighborhood_alley", "station_arterial"), "noodle",      "30年老汤"),
    ("letu_hotel",     "teal",    "acp",     "#203832", "#F2EEE4", "#D4B880", "乐途江景酒店",   "观景客房 · 免费泊车",        "luxury_frame",   "serif", 0.66, 1.08, ("station_arterial", "riverside_scenic"),                 "hotel_home",  "RIVERSIDE HOTEL"),
    ("guiying_coffee", "teal",    "acp",     "#223B34", "#F4EFE6", "#E8D09E", "桂影手冲 CAFE",  "自有烘焙 · 社区精品咖啡",    "luxury_frame",   "serif", 0.64, 1.02, ("old_downtown", "riverside_scenic", "campus_edge"),      "coffee",      "SPECIALTY ROAST"),
    ("lishui_music",   "teal",    "acp",     "#244448", "#F4F4EE", "#B6D4CE", "漓水清音琴行",   "古筝吉他 · 调律培训",        "left_hero",      "serif", 0.64, 1.06, ("campus_edge", "old_downtown"),                          "books",       "MUSIC STUDIO"),
    ("qingshan_photo", "teal",    "acp",     "#284744", "#F6F2E6", "#DEC07C", "青山山水旅拍",   "漓江跟拍 · 汉服妆造",        "luxury_frame",   "serif", 0.64, 1.04, ("riverside_scenic", "old_downtown"),                     "digital",     "PHOTO STUDIO"),
    ("bishui_teahall", "teal",    "gusset",  "#22403C", "#F6EBC8", "#D8BA74", "碧水六堡茶庄",   "陈年六堡 · 桂林毛尖",        "heritage_seal",  "brush", 0.68, 1.14, ("riverside_scenic", "station_arterial"),                 "tea",         "梧州六堡"),
    ("kangjie_dental", "teal",    "acrylic", "#2B4F54", "#F6F9F9", "#1E3A40", "康洁口腔诊所",   "显微补牙 · 舒适洁牙",        "split_tag",      "sans",  0.70, 1.12, ("station_arterial", "neighborhood_alley"),               "pharmacy",    "医保定点\n预约看诊"),
    ("qingfeng_ac",    "teal",    "acrylic", "#274B50", "#F4F8F8", "#C8E4E8", "清风制冷维修",   "空调移机 · 深度拆洗",        "left_hero",      "sans",  0.68, 1.10, ("neighborhood_alley", "station_arterial"),               "hardware",    "上门快修"),

    # --- 10. blue (8) ---
    ("guixin_consult", "blue",    "gusset",  "#243E5C", "#F4DA84", "#D8BC6C", "桂信工程咨询",   "造价评估 · 招标代理",        "heritage_seal",  "serif", 0.70, 1.14, ("station_arterial", "old_downtown"),                     "hotel_home",  "甲级资质"),
    ("xinkang_tcm",    "blue",    "acp",     "#26323E", "#F2F6FA", "#96C2E4", "信康中医推拿",   "艾灸拔罐 · 颈肩调理",        "left_hero",      "serif", 0.66, 1.10, ("old_downtown", "neighborhood_alley"),                   "tcm",         "古法理疗"),
    ("jisu_digital",   "blue",    "acrylic", "#244262", "#F4F8FC", "#1C324A", "极速手机快修",   "换屏换电 · 配件贴膜",        "split_tag",      "sans",  0.72, 1.14, ("station_arterial", "campus_edge", "old_downtown"),      "digital",     "立等可取\n原厂配件"),
    ("licheng_home",   "blue",    "gusset",  "#274566", "#F7F5EA", "#E4C068", "漓城房产中介",   "二手租售 · 过户代办",        "duotone_banner", "sans",  0.72, 1.18, ("station_arterial", "neighborhood_alley"),               "hotel_home",  "本地房源"),
    ("jietong_auto",   "blue",    "gusset",  "#213852", "#F6ECD0", "#7E341C", "捷通汽车养护",   "精洗打蜡 · 轮胎快保",        "split_tag",      "sans",  0.72, 1.22, ("station_arterial", "neighborhood_alley"),               "hardware",    "专业保养\n免费检测"),
    ("lanwan_porridg", "blue",    "acp",     "#263E54", "#F6EED8", "#DFC07C", "江湾砂锅粥铺",   "生滚海鲜粥 · 广式蒸点",      "led_ticker",     "serif", 0.70, 1.12, ("station_arterial", "riverside_scenic"),                 "food",        "熬粥夜宵"),
    ("qizhi_books",    "blue",    "acp",     "#2A415A", "#F4F3EE", "#D4B87E", "启智自习书社",   "教辅图书 · 安静自习",        "luxury_frame",   "serif", 0.64, 1.06, ("campus_edge", "old_downtown"),                          "books",       "STUDY & BOOKS"),
    ("anxin_service",  "blue",    "acrylic", "#284460", "#F4F7FA", "#E4C268", "安心家政开锁",   "深度保洁 · 备案换锁",        "duotone_banner", "sans",  0.70, 1.10, ("neighborhood_alley", "station_arterial"),               "hardware",    "24H 上门"),

    # --- 11. magenta (8) ---
    ("yiren_fashion",  "magenta", "gusset",  "#6A2B45", "#F8F3F5", "#EDC8D6", "依人风尚女装",   "轻奢女装 · 显瘦版型",        "led_ticker",     "sans",  0.72, 1.14, ("old_downtown", "neighborhood_alley"),                   "fashion",     "当季新款"),
    ("aming_bao",      "magenta", "acrylic", "#ECDCE0", "#6E1C20", "#822A32", "阿明手工小笼",   "现包小笼 · 桂林油条豆浆",    "duotone_banner", "sans",  0.68, 1.10, ("old_downtown", "neighborhood_alley", "station_arterial"), "bakery",      "早点堂食"),
    ("duoduo_kids",    "magenta", "acrylic", "#EADCE0", "#701C26", "#7E2E3A", "朵朵童装屋",     "精品童装 · 校服配饰",        "left_hero",      "sans",  0.66, 1.06, ("old_downtown", "neighborhood_alley"),                   "fashion",     "KIDS WEAR"),
    ("fendai_nails",   "magenta", "acp",     "#642C44", "#F9F2F5", "#E8C6D4", "粉黛美甲美睫",   "日式建构 · 轻奢美睫",        "luxury_frame",   "serif", 0.64, 0.98, ("old_downtown", "campus_edge", "station_arterial"),      "salon",       "NAIL & LASH"),
    ("guihua_dessert", "magenta", "acp",     "#6E3040", "#FAF2EA", "#ECD09E", "桂花蜜语甜品",   "桂花凉粉 · 双皮奶炖品",      "heritage_seal",  "serif", 0.68, 1.08, ("riverside_scenic", "old_downtown", "campus_edge"),      "dessert",     "现炖甜品"),
    ("jinxiu_silk",    "magenta", "gusset",  "#62263C", "#F6E8C8", "#DFBE7A", "锦绣桂北壮锦",   "手织围巾 · 民族绣品",        "heritage_seal",  "brush", 0.68, 1.12, ("riverside_scenic", "old_downtown"),                     "fashion",     "桂北织锦"),
    ("qiaojiaren",     "magenta", "acrylic", "#E8D8DE", "#641C34", "#762C44", "李姐家居棉品",   "纯棉睡衣 · 床上四件套",      "left_hero",      "sans",  0.64, 1.02, ("neighborhood_alley", "old_downtown"),                   "fashion",     "舒适居家"),
    ("mitao_fruit",    "magenta", "acrylic", "#703248", "#FCF4F6", "#F0CC92", "蜜桃鲜果捞",     "现切水果捞 · 酸奶冰沙",      "duotone_banner", "sans",  0.70, 1.10, ("campus_edge", "station_arterial", "riverside_scenic"),  "dessert",     "FRESH BOWL"),

    # --- 12. purple (8) ---
    ("ziteng_hair",    "purple",  "acrylic", "#E6E0EC", "#2B2236", "#54426A", "西城型格美发",   "潮流剪裁 · 质感染烫",        "luxury_frame",   "sans",  0.64, 1.18, ("old_downtown", "station_arterial", "campus_edge"),      "salon",       "SALON STUDIO"),
    ("derun_jade",     "purple",  "acp",     "#312A3C", "#F4EFE6", "#D8BC84", "德润翡翠玉雕",   "天然翡翠 · 私人定制",        "heritage_seal",  "serif", 0.66, 1.04, ("old_downtown", "riverside_scenic"),                     "jewelry_opt", "翡翠世家"),
    ("muse_pastry",    "purple",  "acp",     "#3D344A", "#F6F0F8", "#DFCEF0", "暮色法式甜点",   "手工千层 · 生日蛋糕",        "luxury_frame",   "serif", 0.64, 1.00, ("old_downtown", "riverside_scenic", "station_arterial"), "bakery",      "PATISSERIE"),
    ("yayun_qipao",    "purple",  "acp",     "#403048", "#F6EEE0", "#DEC08A", "雅韵旗袍定制",   "新中式礼服 · 手工盘扣",      "heritage_seal",  "brush", 0.66, 1.08, ("riverside_scenic", "old_downtown"),                     "fashion",     "苏绣旗袍"),
    ("xunyicao_flw",   "purple",  "acrylic", "#E4DCEB", "#342446", "#583E74", "紫藤鲜花工作室", "婚礼花艺 · 同城配送",        "left_hero",      "serif", 0.64, 1.02, ("campus_edge", "old_downtown"),                          "flower",      "FLORIST · 0773"),
    ("youpin_home",    "purple",  "gusset",  "#423652", "#F6F2FA", "#2B2238", "秀峰百货超市",   "日用百货 · 社区便利",        "split_tag",      "sans",  0.68, 1.12, ("station_arterial", "neighborhood_alley", "campus_edge"),"hotel_home",  "日用百货\n会员特惠"),
    ("zijing_yoga",    "purple",  "acp",     "#E7E1EE", "#2E243C", "#4C3B64", "紫荆普拉提馆",   "核心塑形 · 产后修复",        "luxury_frame",   "serif", 0.62, 1.04, ("station_arterial", "neighborhood_alley"),               "flower",      "PILATES STUDIO"),
    ("yueer_spa",      "purple",  "gusset",  "#3A2E46", "#F6EED6", "#D8BA80", "悦耳古法采耳",   "非遗采耳 · 舒压助眠",        "led_ticker",     "serif", 0.66, 1.10, ("old_downtown", "riverside_scenic", "station_arterial"), "tcm",         "预约静享"),
]

assert len(FASCIA_SPECS) == 96, f"Expected 96 fascia specs, got {len(FASCIA_SPECS)}"

# 16 vertical pier blade signs (8x2 grid, strictly 100% original Guilin names, each with dedicated industry icon!)
# (bg, fg, border, text, icon_type)
BLADE_SPECS: list[tuple[str, str, str, str, str]] = [
    ("#6E2420", "#F7E8B2", "#E2BA64", "担子米粉", "noodle"),
    ("#EDE7DC", "#7E221C", "#7E221C", "潮味牛丸", "food"),
    ("#EAE6DD", "#7C221D", "#2A2C2F", "恭城油茶", "tea"),
    ("#843620", "#F8E8B4", "#E6BC68", "老巷炒粉", "noodle"),
    ("#222428", "#F4ECE4", "#DF8A7E", "暖棉母婴", "fashion"),
    ("#1F2126", "#F2B854", "#D88A44", "叠彩文具", "books"),
    ("#EFEBE2", "#7E201C", "#7E201C", "寻味糖水", "dessert"),
    ("#222529", "#F2EFE8", "#9EB8A2", "榕岸花集", "flower"),
    ("#D2AA4E", "#142B1E", "#142B1E", "桂花特产", "specialty"),
    ("#233E32", "#ECD072", "#B4D4BE", "秀新改衣", "fashion"),
    ("#264A42", "#F7EBC4", "#DFB864", "老周牛腩", "noodle"),
    ("#742822", "#F6E07C", "#E4BA66", "图文快印", "books"),
    ("#2E5238", "#F7F3DF", "#DFBA62", "四季鲜果", "fruit"),
    ("#284D3A", "#F6F4EA", "#B8DCC4", "桂康药房", "pharmacy"),
    ("#243E5C", "#F4DA84", "#D8BC6C", "漓江茶社", "tea"),
    ("#6A2B45", "#F8F3F5", "#EDC8D6", "依人女装", "fashion"),
]

assert len(BLADE_SPECS) == 16, f"Expected 16 blade specs, got {len(BLADE_SPECS)}"

# Hue family metadata indexed by fascia atlas index (0..95) — preserved 100% for shard compatibility!
FASCIA_META: list[tuple[str, float]] = [(spec[1], spec[11]) for spec in FASCIA_SPECS]


# Build interleaved zone pools so consecutive indices naturally rotate across all 12 hue families
def _build_zone_pools() -> dict[str, list[int]]:
    zones = ("old_downtown", "station_arterial", "riverside_scenic", "neighborhood_alley", "campus_edge")
    pools: dict[str, list[int]] = {}
    for z in zones:
        by_hue: dict[str, list[int]] = {}
        for idx, spec in enumerate(FASCIA_SPECS):
            if z in spec[12]:
                by_hue.setdefault(spec[1], []).append(idx)
        hues = sorted(by_hue.keys())
        interleaved: list[int] = []
        depth = max((len(v) for v in by_hue.values()), default=0)
        for d in range(depth):
            for h in hues:
                if d < len(by_hue[h]):
                    interleaved.append(by_hue[h][d])
        pools[z] = interleaved
    return pools


ZONE_POOLS: dict[str, list[int]] = _build_zone_pools()

BLADE_POOLS: dict[str, list[int]] = {
    "old_downtown":       [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 15],
    "station_arterial":   [0, 2, 5, 8, 10, 11, 12, 13, 14, 15],
    "riverside_scenic":   [0, 2, 6, 7, 8, 14],
    "neighborhood_alley": [0, 1, 3, 4, 5, 9, 10, 12, 13, 15],
    "campus_edge":        [3, 5, 6, 7, 11, 12, 14],
}

# Real-world chain/trademark denylist for automated compliance verification (docs/style.md #5)
TRADEMARK_DENYLIST = re.compile(
    r"(淘宝|天猫|美团|饿了么|蜜雪|瑞幸|星巴克|肯德基|麦当劳|一心堂|力源|中国邮政|CHINA\s*POST|"
    r"老百姓|益丰|光头佬|万达|屈臣氏|名创优品|海底捞|喜茶|霸王茶姬|绝味|周黑鸭|国泰|皇冠|仁和|晨光|"
    r"全家|罗森|7-?11|沃尔玛|家乐福|华润|华为|小米|苹果|OPPO|VIVO|耐克|阿迪|优衣库|海澜之家|"
    r"如家|汉庭|全季|维也纳|格林豪泰|美宜佳|链家|贝壳|崇善|椿记|阿甘|日头火|明桂|同仁堂|老东江)",
    re.IGNORECASE,
)


def check_trademark_compliance() -> list[str]:
    """Return list of compliance violation messages (empty == 100% pass)."""
    violations: list[str] = []
    seen_titles: set[str] = set()
    hue_counts: dict[str, int] = {}
    for idx, spec in enumerate(FASCIA_SPECS):
        key, hue, _sub, _bg, _fg, _acc, title, subtitle, mode, _fs, _gl, _ph, _zn, icon_type, tag = spec
        hue_counts[hue] = hue_counts.get(hue, 0) + 1
        if title in seen_titles:
            violations.append(f"Duplicate fascia title at #{idx} ({key}): {title}")
        seen_titles.add(title)
        if mode not in VALID_MODES:
            violations.append(f"Invalid fascia mode at #{idx} ({key}): {mode}")
        if icon_type not in ICON_REGISTRY:
            violations.append(f"Invalid fascia icon_type at #{idx} ({key}): {icon_type}")
        for field_name, val in (("key", key), ("title", title), ("subtitle", subtitle), ("tag", tag)):
            m = TRADEMARK_DENYLIST.search(val)
            if m:
                violations.append(f"Trademark hit in fascia #{idx} {field_name}='{val}': {m.group(0)}")
    for idx, blade in enumerate(BLADE_SPECS):
        _bg, _fg, _b, text, icon_type = blade
        if icon_type not in ICON_REGISTRY:
            violations.append(f"Invalid blade icon_type at #{idx}: {icon_type}")
        m = TRADEMARK_DENYLIST.search(text)
        if m:
            violations.append(f"Trademark hit in blade #{idx} text='{text}': {m.group(0)}")
    if len(hue_counts) != 12 or any(v != 8 for v in hue_counts.values()):
        violations.append(f"Hue family balance mismatch (expect 12 x 8): {hue_counts}")
    return violations
