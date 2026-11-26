"""
Single source of truth for the 96-design compliant Guilin "One-Shop-One-Color"
signboard catalog (12 sun-faded hue families x 8 designs = 96 fascias, 8x12 grid)
and 16 slim vertical pier blade signs (8x2 grid).

Compliance (docs/style.md Phase 2 #5):
  - 100% original Guilin local shop names; zero real registered chain trademarks.
  - All background hex tones are calibrated for engine gradeDay 1.22x saturation
    and receive an additional 20% neutral-gray saturation cap in substrate rendering.
"""
from __future__ import annotations

import re

# (key, hue_family, substrate, bg, fg, accent, title, subtitle, mode, fstyle, glow, pref_h, zones)
# zones subset of: "old_downtown", "station_arterial", "riverside_scenic", "neighborhood_alley", "campus_edge"
FASCIA_SPECS: list[tuple[str, str, str, str, str, str, str, str, str, str, float, float, tuple[str, ...]]] = [
    # --- 1. black (8) ---
    ("guiyun_flower",  "black",   "acp",     "#25282C", "#EAE7DF", "#7B8F7E", "桂韵花艺坊",   "鲜花速递 · 绿植盆景",        "minimal", "serif", 0.58, 0.96, ("old_downtown", "riverside_scenic")),
    ("moyun_tea",      "black",   "acp",     "#22252A", "#ECE9E1", "#B5965C", "墨韵茶社",     "功夫茗茶 · 雅座休憩",        "minimal", "brush", 0.62, 1.02, ("old_downtown", "riverside_scenic")),
    ("qingyu_flower",  "black",   "acp",     "#24272B", "#E8E6E0", "#8E988C", "晴屿花艺馆",   "花艺定制 · 生活美学",        "minimal", "serif", 0.58, 0.92, ("old_downtown", "station_arterial")),
    ("qutao_station",  "black",   "gusset",  "#222428", "#DF9236", "#BA4638", "趣淘文体屋",   "文体 · 办公 · 学生礼品",     "box",     "brush", 0.74, 1.18, ("old_downtown", "campus_edge", "neighborhood_alley")),
    ("mijing_wear",    "black",   "acp",     "#222529", "#E8E8E2", "#90969C", "觅境原创女装", "时尚买手 · 质感穿搭",        "minimal", "sans",  0.60, 0.98, ("old_downtown", "station_arterial")),
    ("nuanmian_mom",   "black",   "gusset",  "#26272C", "#C24A44", "#A44842", "暖棉母婴馆",   "孕妇服饰 · 母婴生活",        "box",     "sans",  0.68, 1.08, ("old_downtown", "neighborhood_alley")),
    ("qinghe_salon",   "black",   "acp",     "#23262A", "#EBEBE6", "#90969E", "青禾剪裁造型", "烫染护发 · 精致剪裁",        "minimal", "sans",  0.62, 1.00, ("old_downtown", "neighborhood_alley", "campus_edge")),
    ("mingcai_tea",    "black",   "acp",     "#222326", "#D6AE52", "#8E7438", "茗采桂花茶行", "桂花乌龙 · 山水茶礼",        "minimal", "brush", 0.66, 1.08, ("old_downtown", "riverside_scenic", "station_arterial")),

    # --- 2. white (8) ---
    ("apo_kitchen",    "white",   "acrylic", "#E5E2DA", "#9E3630", "#2A2C2F", "阿婆家常小馆", "盒饭 · 炒粉 · 桂林小炒",     "banner",  "sans",  0.70, 1.18, ("old_downtown", "neighborhood_alley")),
    ("guikang_pharm",  "white",   "acrylic", "#E9ECE8", "#A43430", "#426E4D", "桂康便民药房", "医保定点 · 中西成药",        "split",   "sans",  0.72, 1.20, ("old_downtown", "station_arterial", "neighborhood_alley")),
    ("laozihao_fen",   "white",   "acp",     "#E5DFD2", "#22201E", "#A63E2E", "老字号卤菜粉", "古法卤水 · 三鲜汤粉",        "seal",    "brush", 0.70, 1.18, ("old_downtown", "station_arterial", "riverside_scenic")),
    ("laojie_luwei",   "white",   "acrylic", "#DFDCD5", "#262422", "#9C3832", "老街熟食卤味", "招牌肺片 · 桂林卤鸭",        "box",     "sans",  0.68, 1.08, ("old_downtown", "neighborhood_alley")),
    ("xunwei_sweet",   "white",   "acrylic", "#EAE6DD", "#A23630", "#A23630", "寻味糖水铺",   "槐花粉 · 马蹄糕 · 冰甜品",   "seal",    "serif", 0.68, 1.06, ("old_downtown", "riverside_scenic", "campus_edge")),
    ("shihua_studio",  "white",   "acp",     "#EAE9E4", "#2E3237", "#7A8086", "拾花美学生活", "鲜花定制 · 干花手作",        "minimal", "serif", 0.56, 0.94, ("old_downtown", "riverside_scenic")),
    ("lijiang_gift",   "white",   "acp",     "#E6E3DB", "#8C322C", "#426856", "漓江特产优选", "桂花糕 · 三花酒 · 伴手礼",   "split",   "serif", 0.70, 1.16, ("station_arterial", "riverside_scenic")),
    ("jieya_laundry",  "white",   "acrylic", "#E4E8EA", "#304C6C", "#5E7B94", "洁雅洗衣护鞋", "专业干洗 · 奢护精洗",        "box",     "sans",  0.68, 1.10, ("station_arterial", "neighborhood_alley")),

    # --- 3. brown (8) ---
    ("laozaotou_fen",  "brown",   "gusset",  "#2F251E", "#E6C254", "#B58A34", "老灶头鲜汤粉", "现煮鲜汤 · 桂林特色粉",      "box",     "brush", 0.78, 1.22, ("old_downtown", "neighborhood_alley", "station_arterial")),
    ("fuman_teahouse", "brown",   "gusset",  "#63302B", "#EDE0BA", "#BA9254", "福满茶艺棋牌", "功夫茶艺 · 休闲雅座",        "box",     "serif", 0.68, 1.12, ("old_downtown", "neighborhood_alley")),
    ("xiangkou_wine",  "brown",   "acrylic", "#6B2E2A", "#EFE2BA", "#36547A", "巷口烟酒副食", "名茶副食 · 饮料百货",        "split",   "sans",  0.72, 1.16, ("old_downtown", "neighborhood_alley", "station_arterial")),
    ("gongcheng_tea",  "brown",   "gusset",  "#4A3224", "#EFE0B8", "#B68C48", "恭城老油茶馆", "现打油茶 · 船上糕 · 艾叶粑", "seal",    "brush", 0.74, 1.20, ("old_downtown", "riverside_scenic", "station_arterial")),
    ("lian_craftbeer", "brown",   "acp",     "#362A22", "#E8DFCE", "#A87C44", "漓岸精酿酒馆", "微醺小酌 · 桂花精酿",        "minimal", "serif", 0.64, 1.00, ("riverside_scenic", "old_downtown")),
    ("lingnan_art",    "brown",   "acp",     "#4B382C", "#EAE2D0", "#9E7E52", "岭南文房字画", "文房四宝 · 装裱字画",        "seal",    "brush", 0.62, 1.06, ("riverside_scenic", "old_downtown")),
    ("pijiu_fish",     "brown",   "gusset",  "#5A2E24", "#F0D88A", "#C48E44", "漓江啤酒鱼馆", "阳朔风味 · 剑骨鱼砂锅",      "led",     "brush", 0.76, 1.24, ("riverside_scenic", "station_arterial")),
    ("laotong_shoes",  "brown",   "acrylic", "#563D2E", "#EFE8D8", "#A8885C", "老铜匠鞋履铺", "手工皮具 · 精工修鞋",        "box",     "sans",  0.66, 1.04, ("neighborhood_alley", "old_downtown")),

    # --- 4. yellow (8) ---
    ("xianguo_mart",   "yellow",  "gusset",  "#C49B44", "#7C2622", "#A84E32", "鲜果乐购超市", "应季鲜果 · 礼盒直供",        "box",     "sans",  0.72, 1.12, ("old_downtown", "neighborhood_alley", "station_arterial")),
    ("jianyu_mens",    "yellow",  "gusset",  "#B4883C", "#22201E", "#695124", "简屿都市男装", "商务休闲 · 质感男装",        "minimal", "sans",  0.66, 1.04, ("old_downtown", "station_arterial")),
    ("zhiqu_kids",     "yellow",  "gusset",  "#C8A448", "#9A2C26", "#7E2620", "稚趣童装坊",   "舒适童装 · 亲子精选",        "box",     "sans",  0.72, 1.16, ("old_downtown", "neighborhood_alley")),
    ("xiaoshudian",    "yellow",  "acrylic", "#C6A24C", "#F8F6F0", "#345C88", "小数点婴童馆", "婴童服饰 · 幼儿用品",        "split",   "sans",  0.70, 1.14, ("old_downtown", "neighborhood_alley")),
    ("guixiang_bake",  "yellow",  "acp",     "#BE964A", "#2C221A", "#86462A", "桂香现烤烘焙", "现烤面包 · 桂花酥饼",        "banner",  "serif", 0.70, 1.10, ("station_arterial", "campus_edge", "old_downtown")),
    ("zaoan_baozi",    "yellow",  "acrylic", "#C69E46", "#8A2B24", "#A44C2E", "早安手工面点", "手工包子 · 现磨豆浆",        "box",     "sans",  0.72, 1.16, ("neighborhood_alley", "station_arterial", "campus_edge")),
    ("jinsui_grain",   "yellow",  "gusset",  "#B89242", "#2E281E", "#5A6B46", "金穗粮油干货", "山货干果 · 生态香米",        "split",   "sans",  0.70, 1.18, ("neighborhood_alley", "station_arterial")),
    ("lvtu_luggage",   "yellow",  "acrylic", "#C29C4A", "#23364C", "#385678", "旅途行李寄存", "车站便民 · 旅游咨询",        "banner",  "sans",  0.72, 1.14, ("station_arterial",)),

    # --- 5. cream (8) ---
    ("danzi_mifen",    "cream",   "acp",     "#DFD2B0", "#26221E", "#98362E", "担子卤菜米粉", "传统卤菜粉 · 锅烧叉烧",      "seal",    "brush", 0.70, 1.08, ("old_downtown", "riverside_scenic", "station_arterial")),
    ("yunshang_wear",  "cream",   "acp",     "#E2DED6", "#303236", "#78675A", "云裳阁女装",   "潮流女装 · 轻熟风尚",        "minimal", "serif", 0.56, 0.96, ("old_downtown", "station_arterial")),
    ("nanshan_cafe",   "cream",   "acp",     "#E5DEC9", "#26282C", "#B58A32", "南山轻食烘焙", "手冲咖啡 · 现烤可颂",        "minimal", "serif", 0.58, 0.96, ("old_downtown", "riverside_scenic", "campus_edge")),
    ("chujian_wear",   "cream",   "acp",     "#E0D9CD", "#2A2C30", "#6B675E", "初见原创服饰", "棉麻穿搭 · 独立设计",        "minimal", "serif", 0.54, 0.94, ("old_downtown", "riverside_scenic")),
    ("chaowei_beef",   "cream",   "acp",     "#E7E1D6", "#242220", "#9A342E", "潮味手打牛丸", "清汤牛腩 · 现切牛肉",        "seal",    "brush", 0.68, 1.14, ("old_downtown", "station_arterial", "neighborhood_alley")),
    ("suxin_culture",  "cream",   "acp",     "#E4DCCB", "#2B3238", "#4D6A62", "素心书画文创", "山水明信片 · 桂林手伴",      "minimal", "serif", 0.60, 0.98, ("riverside_scenic", "campus_edge")),
    ("guihe_inn",      "cream",   "acp",     "#DFD8C8", "#2B2926", "#785E42", "归禾民宿客栈", "江景雅居 · 旅途驿站",        "seal",    "serif", 0.64, 1.08, ("riverside_scenic", "station_arterial")),
    ("qingkong_optic", "cream",   "acrylic", "#E2DFD6", "#2A3644", "#46688A", "晴空眼镜验光", "专业验光 · 潮流镜架",        "split",   "sans",  0.66, 1.04, ("campus_edge", "station_arterial", "old_downtown")),

    # --- 6. crimson (8) ---
    ("laowei_mifen",   "crimson", "gusset",  "#86322E", "#EFE0A8", "#C49C54", "老味石磨米粉", "古法卤水 · 脆皮锅烧",        "box",     "serif", 0.74, 1.16, ("old_downtown", "neighborhood_alley", "station_arterial")),
    ("liuwei_luofen",  "crimson", "gusset",  "#722E34", "#F0D6DA", "#C9949C", "柳味原汤螺粉", "原汤螺蛳粉 · 脆皮猪脚",      "box",     "sans",  0.74, 1.12, ("old_downtown", "campus_edge", "neighborhood_alley")),
    ("rongcheng_flw",  "crimson", "acrylic", "#963632", "#F0E6C4", "#D4B05E", "榕城鲜花礼坊", "开业花篮 · 鲜花绿植",        "box",     "sans",  0.72, 1.14, ("old_downtown", "station_arterial")),
    ("feilong_fix",    "crimson", "acrylic", "#943A34", "#EDD874", "#CF984A", "飞龙精工维修", "修表配锁 · 家电快修",        "box",     "sans",  0.70, 1.14, ("old_downtown", "neighborhood_alley")),
    ("hanmo_print",    "crimson", "acrylic", "#943A34", "#EED66C", "#355276", "翰墨图文快印", "复印打印 · 装订文具",        "split",   "sans",  0.72, 1.16, ("campus_edge", "old_downtown", "station_arterial")),
    ("guibei_chili",   "crimson", "gusset",  "#822E2A", "#F2E2B2", "#C49A4E", "桂北辣椒酱坊", "蒜蓉辣椒酱 · 豆腐乳特产",    "seal",    "brush", 0.74, 1.18, ("riverside_scenic", "station_arterial")),
    ("hongyun_stir",   "crimson", "gusset",  "#8A342E", "#F4E5B8", "#D2A24C", "鸿运川湘小炒", "现炒家常菜 · 干锅砂锅",      "led",     "sans",  0.74, 1.22, ("station_arterial", "neighborhood_alley")),
    ("jufu_wedding",   "crimson", "acrylic", "#8C3036", "#F2DFB4", "#CFA45A", "聚福婚庆喜铺", "喜糖喜酒 · 庆典定制",        "box",     "serif", 0.70, 1.10, ("neighborhood_alley", "old_downtown")),

    # --- 7. orange (8) ---
    ("guibei_fresh",   "orange",  "acrylic", "#B4643A", "#F6EDD4", "#4D6F4B", "桂北粮油生鲜", "粮油副食 · 社区生鲜",        "split",   "sans",  0.74, 1.24, ("old_downtown", "neighborhood_alley", "station_arterial")),
    ("weilai_duck",    "orange",  "acp",     "#B4663B", "#F2EBD8", "#2E2A27", "味来脆皮烤鸭", "片皮烤鸭 · 桂林卤味",        "split",   "sans",  0.72, 1.18, ("old_downtown", "neighborhood_alley")),
    ("laoxiang_wok",   "orange",  "gusset",  "#9F4632", "#F0E2AE", "#D4A452", "老巷炭火炒粉", "炒粉炒面 · 叉烧凉皮",        "box",     "sans",  0.74, 1.16, ("old_downtown", "neighborhood_alley", "campus_edge")),
    ("juzi_tea",       "orange",  "acrylic", "#B87242", "#FAF2E2", "#6A4832", "橘子汽水茶饮", "鲜果茶饮 · 手打柠檬茶",      "minimal", "sans",  0.68, 1.02, ("campus_edge", "old_downtown", "riverside_scenic")),
    ("xingwang_ebike", "orange",  "gusset",  "#A65836", "#F4EAD6", "#304860", "兴旺电动车行", "整车销售 · 换电维修",        "banner",  "sans",  0.72, 1.20, ("neighborhood_alley", "station_arterial")),
    ("nuanyang_pet",   "orange",  "acp",     "#B67448", "#F8F1E4", "#546A56", "暖阳宠物生活", "宠物洗护 · 寄养粮品",        "box",     "sans",  0.66, 1.06, ("neighborhood_alley", "station_arterial")),
    ("guinan_goose",   "orange",  "gusset",  "#A85234", "#F4E4B4", "#CFA452", "桂南烧鹅饭店", "明炉烧鹅 · 广式腊味",        "seal",    "brush", 0.74, 1.18, ("station_arterial", "old_downtown")),
    ("tanxiang_bbq",   "orange",  "gusset",  "#9C4B30", "#F4E2B0", "#2A2422", "炭香夜宵烧烤", "桂林烤串 · 炒田螺",          "led",     "brush", 0.76, 1.22, ("neighborhood_alley", "campus_edge", "station_arterial")),

    # --- 8. green (8) ---
    ("siji_fruit",     "green",   "acrylic", "#4C7048", "#F2EED8", "#9E3C36", "四季鲜果铺",   "精品水果 · 鲜切果盘",        "box",     "sans",  0.70, 1.16, ("old_downtown", "station_arterial", "neighborhood_alley")),
    ("lvcheng_post",   "green",   "acp",     "#2E523F", "#DFBE52", "#B29A44", "绿城便民驿站", "快递收发 · 社区便民",        "box",     "sans",  0.68, 1.12, ("old_downtown", "neighborhood_alley", "station_arterial")),
    ("zelin_hw",       "green",   "acrylic", "#355E47", "#F0F2F0", "#A6C4B0", "泽霖五金交电", "五金工具 · 水电配件",        "box",     "sans",  0.70, 1.14, ("neighborhood_alley", "station_arterial", "old_downtown")),
    ("xiuxin_tailor",  "green",   "gusset",  "#2C483C", "#D8B65C", "#8AA494", "秀新裁缝定制", "服装裁剪 · 精工修改",        "box",     "serif", 0.68, 1.08, ("old_downtown", "neighborhood_alley")),
    ("jimin_pharm",    "green",   "acrylic", "#3A644C", "#F2F0E6", "#B6423A", "济民大药堂",   "中药饮片 · 家庭常备",        "split",   "serif", 0.72, 1.20, ("station_arterial", "neighborhood_alley")),
    ("cuilu_produce",  "green",   "gusset",  "#426646", "#F0E8C8", "#C49C4C", "翠麓农产直供", "阳朔金桔 · 罗汉果特产",      "seal",    "serif", 0.70, 1.14, ("riverside_scenic", "station_arterial")),
    ("senyu_plants",   "green",   "acp",     "#3C5644", "#ECECE4", "#9AB09C", "森屿绿植花房", "多肉盆栽 · 庭院绿植",        "minimal", "serif", 0.60, 0.98, ("riverside_scenic", "neighborhood_alley")),
    ("xianshu_market", "green",   "acrylic", "#486C4A", "#F4F0DE", "#C69A42", "鲜蔬直采坊",   "产地直采 · 每日鲜菜",        "banner",  "sans",  0.72, 1.16, ("neighborhood_alley",)),

    # --- 9. teal (8) ---
    ("laozhou_beef",   "teal",    "gusset",  "#7D9482", "#9A2F2C", "#324738", "老周秘制牛腩", "招牌牛腩粉 · 萝卜牛杂",      "led",     "brush", 0.72, 1.22, ("old_downtown", "neighborhood_alley", "station_arterial")),
    ("letu_hotel",     "teal",    "acp",     "#263D36", "#E8E4DA", "#B69C68", "乐途江景酒店", "商务雅宿 · 旅游接待",        "minimal", "serif", 0.66, 1.08, ("station_arterial", "riverside_scenic")),
    ("guiying_coffee", "teal",    "acp",     "#2D423A", "#EAE5DB", "#B49864", "桂影手冲咖啡", "精品豆焙 · 社区咖啡",        "minimal", "serif", 0.64, 1.02, ("old_downtown", "riverside_scenic", "campus_edge")),
    ("lishui_music",   "teal",    "acp",     "#305254", "#ECECE6", "#A4BEB8", "漓水清音琴行", "民乐吉他 · 艺术培训",        "box",     "serif", 0.64, 1.06, ("campus_edge", "old_downtown")),
    ("qingshan_photo", "teal",    "acp",     "#3C5C58", "#F0ECE0", "#C4A668", "青山旅拍摄影", "桂林旅拍 · 山水纪实",        "minimal", "serif", 0.64, 1.04, ("riverside_scenic", "old_downtown")),
    ("bishui_teahall", "teal",    "gusset",  "#2A4A46", "#EFE4C4", "#B89A5A", "碧水茶茗山房", "六堡陈茶 · 桂林毛尖",        "seal",    "brush", 0.68, 1.14, ("riverside_scenic", "station_arterial")),
    ("kangjie_dental", "teal",    "acrylic", "#4C7476", "#F4F6F6", "#A8C6C8", "康洁口腔诊所", "口腔保健 · 洁牙护理",        "split",   "sans",  0.70, 1.12, ("station_arterial", "neighborhood_alley")),
    ("qingfeng_ac",    "teal",    "acrylic", "#3D6266", "#F0F4F4", "#98B8BC", "清风空调制冷", "家电清洗 · 制冷维修",        "box",     "sans",  0.68, 1.10, ("neighborhood_alley", "station_arterial")),

    # --- 10. blue (8) ---
    ("guixin_consult", "blue",    "gusset",  "#2E4B6E", "#E8CB78", "#B29452", "桂信工程咨询", "造价评估 · 商务咨询",        "seal",    "serif", 0.70, 1.14, ("station_arterial", "old_downtown")),
    ("xinkang_tcm",    "blue",    "acp",     "#303A44", "#EAEFF2", "#46769E", "信康中医养生", "推拿艾灸 · 健康调理",        "box",     "serif", 0.66, 1.10, ("old_downtown", "neighborhood_alley")),
    ("jisu_digital",   "blue",    "acrylic", "#325272", "#F0F4F8", "#88A8C8", "极速数码通讯", "手机维修 · 配件贴膜",        "split",   "sans",  0.72, 1.14, ("station_arterial", "campus_edge", "old_downtown")),
    ("licheng_home",   "blue",    "gusset",  "#365678", "#F4F2E8", "#C8A658", "漓城房产中介", "二手租售 · 社区安家",        "banner",  "sans",  0.72, 1.18, ("station_arterial", "neighborhood_alley")),
    ("jietong_auto",   "blue",    "gusset",  "#2B425E", "#F0E6C8", "#BA663C", "捷通汽车养护", "精细洗车 · 轮胎快修",        "split",   "sans",  0.72, 1.22, ("station_arterial", "neighborhood_alley")),
    ("lanwan_porridg", "blue",    "acp",     "#344C62", "#F2E8D2", "#C4A468", "江湾海鲜粥铺", "生滚砂锅粥 · 广式点心",      "box",     "serif", 0.70, 1.12, ("station_arterial", "riverside_scenic")),
    ("qizhi_books",    "blue",    "acp",     "#3B546E", "#F0EFEA", "#B29660", "启智自习书社", "图书文具 · 教辅画材",        "minimal", "serif", 0.64, 1.06, ("campus_edge", "old_downtown")),
    ("anxin_service",  "blue",    "acrylic", "#3C5C78", "#F2F4F6", "#D2AE58", "安心家政开锁", "专业开锁 · 居家保洁",        "box",     "sans",  0.70, 1.10, ("neighborhood_alley", "station_arterial")),

    # --- 11. magenta (8) ---
    ("yiren_fashion",  "magenta", "gusset",  "#863F5B", "#F2EEF0", "#DFC2CE", "依人风尚女装", "大码女装 · 精品穿搭",        "led",     "sans",  0.72, 1.14, ("old_downtown", "neighborhood_alley")),
    ("aming_bao",      "magenta", "acrylic", "#E4D6D9", "#9C3838", "#BD7C8B", "阿明手工小笼", "手工小笼包 · 营养早餐",      "box",     "sans",  0.68, 1.10, ("old_downtown", "neighborhood_alley", "station_arterial")),
    ("duoduo_kids",    "magenta", "acrylic", "#E2D7D9", "#A23A42", "#BE7680", "朵朵童装屋",   "精品童装 · 亲子穿搭",        "box",     "sans",  0.66, 1.06, ("old_downtown", "neighborhood_alley")),
    ("fendai_nails",   "magenta", "acp",     "#7E445A", "#F4ECF0", "#D4B4C2", "粉黛美甲美睫", "日式美甲 · 精致护理",        "minimal", "serif", 0.64, 0.98, ("old_downtown", "campus_edge", "station_arterial")),
    ("guihua_dessert", "magenta", "acp",     "#8C4A58", "#F4ECE4", "#D8B688", "桂花蜜语甜品", "桂花糕点 · 鲜奶炖品",        "seal",    "serif", 0.68, 1.08, ("riverside_scenic", "old_downtown", "campus_edge")),
    ("jinxiu_silk",    "magenta", "gusset",  "#76384C", "#F0E0C0", "#C8A464", "锦绣桂北织锦", "手织围巾 · 民族绣品",        "seal",    "brush", 0.68, 1.12, ("riverside_scenic", "old_downtown")),
    ("qiaojiaren",     "magenta", "acrylic", "#DFCFD4", "#86364E", "#AC6B7E", "俏佳人家居坊", "棉质家居 · 舒适贴身",        "minimal", "sans",  0.64, 1.02, ("neighborhood_alley", "old_downtown")),
    ("mitao_fruit",    "magenta", "acrylic", "#904E62", "#F8F0F2", "#DFB884", "蜜桃鲜果捞",   "现切水果捞 · 酸奶冰沙",      "banner",  "sans",  0.70, 1.10, ("campus_edge", "station_arterial", "riverside_scenic")),

    # --- 12. purple (8) ---
    ("ziteng_hair",    "purple",  "acrylic", "#DED9E2", "#3E3848", "#7E748E", "紫藤创意美发", "潮流造型 · 私人定制",        "minimal", "sans",  0.62, 1.18, ("old_downtown", "station_arterial", "campus_edge")),
    ("derun_jade",     "purple",  "acp",     "#3C3646", "#EAE4DC", "#B69C6A", "德润翡翠玉坊", "翡翠玉石 · 私人定制",        "seal",    "serif", 0.64, 1.04, ("old_downtown", "riverside_scenic")),
    ("muse_pastry",    "purple",  "acp",     "#4B4258", "#F0EAF2", "#C6B4D4", "暮色法式甜点", "手工千层 · 定制蛋糕",        "minimal", "serif", 0.64, 1.00, ("old_downtown", "riverside_scenic", "station_arterial")),
    ("yayun_qipao",    "purple",  "acp",     "#4E3E54", "#EFE6D6", "#C4A876", "雅韵旗袍定制", "新中式服饰 · 改良旗袍",      "seal",    "brush", 0.66, 1.08, ("riverside_scenic", "old_downtown")),
    ("xunyicao_flw",   "purple",  "acrylic", "#DDD6E4", "#4A3C5A", "#86749A", "薰衣草花艺社", "伴手花束 · 气球布置",        "box",     "serif", 0.64, 1.02, ("campus_edge", "old_downtown")),
    ("youpin_home",    "purple",  "gusset",  "#524662", "#F2EEF6", "#C8B8DC", "优品生活百货", "日用家居 · 创意好物",        "split",   "sans",  0.68, 1.12, ("station_arterial", "neighborhood_alley", "campus_edge")),
    ("zijing_yoga",    "purple",  "acp",     "#E0DAE6", "#423850", "#827496", "紫荆瑜伽舒展", "形体塑形 · 身心舒展",        "minimal", "serif", 0.60, 1.04, ("station_arterial", "neighborhood_alley")),
    ("yueer_spa",      "purple",  "gusset",  "#463A52", "#EFE6CE", "#B89A68", "悦耳采耳养生", "传统采耳 · 舒压休憩",        "box",     "serif", 0.66, 1.10, ("old_downtown", "riverside_scenic", "station_arterial")),
]

assert len(FASCIA_SPECS) == 96, f"Expected 96 fascia specs, got {len(FASCIA_SPECS)}"

# 16 vertical pier blade signs (8x2 grid, strictly 100% original Guilin names)
BLADE_SPECS: list[tuple[str, str, str, str]] = [
    ("#86322E", "#EFE0A8", "#C49C54", "担子米粉"),
    ("#E7E1D6", "#9A342E", "#9A342E", "潮味牛丸"),
    ("#E5E2DA", "#9E3630", "#2A2C2F", "桂林油茶"),
    ("#9F4632", "#F0E2AE", "#D4A452", "老巷炒粉"),
    ("#24262B", "#C24A44", "#A44842", "暖棉母婴"),
    ("#222428", "#DF9236", "#BA4638", "趣淘文体"),
    ("#EAE6DD", "#A23630", "#A23630", "寻味糖水"),
    ("#24272B", "#E8E6E0", "#8E988C", "晴屿花艺"),
    ("#C6A24C", "#2E523F", "#2E523F", "桂花特产"),
    ("#2C483C", "#D8B65C", "#8AA494", "秀新定制"),
    ("#7D9482", "#9A2F2C", "#324738", "老周牛腩"),
    ("#943A34", "#EED66C", "#D4B05E", "图文快印"),
    ("#4C7048", "#F2EED8", "#9E3C36", "四季鲜果"),
    ("#355E47", "#F0F2F0", "#A6C4B0", "桂康药房"),
    ("#2E4B6E", "#E8CB78", "#B29452", "漓江茶社"),
    ("#863F5B", "#F2EEF0", "#DFC2CE", "依人女装"),
]

assert len(BLADE_SPECS) == 16, f"Expected 16 blade specs, got {len(BLADE_SPECS)}"

# Hue family metadata indexed by fascia atlas index (0..95)
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
        # Round-robin across hue families to maximize color diversity along a street
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
    r"如家|汉庭|全季|维也纳|格林豪泰|美宜佳|链家|贝壳)",
    re.IGNORECASE,
)


def check_trademark_compliance() -> list[str]:
    """Return list of compliance violation messages (empty == 100% pass)."""
    violations: list[str] = []
    seen_titles: set[str] = set()
    hue_counts: dict[str, int] = {}
    for idx, spec in enumerate(FASCIA_SPECS):
        key, hue, _sub, _bg, _fg, _acc, title, subtitle, *_ = spec
        hue_counts[hue] = hue_counts.get(hue, 0) + 1
        if title in seen_titles:
            violations.append(f"Duplicate fascia title at #{idx} ({key}): {title}")
        seen_titles.add(title)
        for field_name, val in (("key", key), ("title", title), ("subtitle", subtitle)):
            m = TRADEMARK_DENYLIST.search(val)
            if m:
                violations.append(f"Trademark hit in fascia #{idx} {field_name}='{val}': {m.group(0)}")
    for idx, (_bg, _fg, _b, text) in enumerate(BLADE_SPECS):
        m = TRADEMARK_DENYLIST.search(text)
        if m:
            violations.append(f"Trademark hit in blade #{idx} text='{text}': {m.group(0)}")
    if len(hue_counts) != 12 or any(v != 8 for v in hue_counts.values()):
        violations.append(f"Hue family balance mismatch (expect 12 x 8): {hue_counts}")
    return violations
