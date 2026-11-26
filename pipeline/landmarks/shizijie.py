"""Shizijie Crossroads (十字街路口: 中山中路 × 解放东/西路).

Anchor [110.2912601, 25.28153405] (-879.75, -169.63) sits at the arterial
intersection of Middle Zhongshan Rd (OSM way/258911170), West Jiefang Rd
(way/221821072) and East Jiefang Rd (way/258909993), replacing the M2.6-1
placeholder entry.

Corner buildings follow exact OSM footprints (SW corner is Weixiaotang Plaza,
modeled in nikoniko.py):
- NW corner: Nanfang Mansion (南方大厦, way/691576459), 7 storeys / 25.2 m
- SE corner: Cultural Mansion (文化大厦, way/266333052), 6 storeys / 22.6 m
  with classical beige-stone pilasters & curved NW rotunda (00-2019.jpg left)
- NE corner: Commercial block & East Jiefang wing (way/691576457, way/675759091),
  6 storeys / 21.4 m & 4 storeys / 14.8 m stepped white/grey facades (00-2019.jpg right).
  Bays 3 + 4 of NE_ANNEX host the original Guilin flagship e-bike dealership
  「漓行电驴行 · 十字街总店」 (IDOK-127) with expanded granite apron, 3 exhibition
  plinths, dual-gun fast charger, and dedicated self-illuminated night signage
  (`shizijie_shop_signs`, zero dynamic Three.js lights, zero real-world trademarks).
"""
import math
from pathlib import Path
import sys

import mapbox_earcut
import numpy as np
from PIL import Image, ImageDraw
import trimesh

from c_kit import landmark_surface
from nikoniko import Builder, _draw_centered, _font
from shizijie_layout import KIOSK_CENTER, islands, street_masks
from plaza_seam import civic_plaza
from shapely import get_parts
from shapely.affinity import scale
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import linemerge, unary_union


SHOP_SIGN_ATLAS = 1024

# Desaturated 4x4 (256x256, 0.08 MB VRAM) material sheet tuned for look.gradeDay saturation=1.22.
SHIZIJIE_SURF_ATLAS = 256
SHIZIJIE_SWATCHES = {
    'rail_white': '#cdd2d6',
    'rail_silver': '#a8aeb4',
    'rail_green': '#294a35',
    'rail_base': '#32363b',
    'signal_black': '#22262b',
    'granite_curb': '#686c70',
    'granite_light': '#8d9195',
    'soil_mulch': '#4f473e',
    'tree_grate': '#41454a',
    'bark_camphor': '#544e45',
    'bark_lime': '#b6bab5',
    'foliage_hedge': '#5e753b',
    'foliage_mid': '#465f38',
    'foliage_dark': '#334c2d',
    'flower_boug': '#9b506b',
    'flower_red': '#964146',
}
SHIZIJIE_SURF_INDEX = {k: i for i, k in enumerate(SHIZIJIE_SWATCHES)}

# Pixel rects (x, y, w, h) inside shizijie's dedicated 1024x1024 `shizijie_shop_signs` atlas.
# Material name ends with `_signs` so web/src/look/night.ts automatically adds night neon emissive (0 PointLights).
SHOP_SIGN_RECTS = {
    'ebike_main': (0, 0, 1024, 128),
    'ebike_window_l': (0, 128, 512, 224),
    'ebike_window_r': (512, 128, 512, 224),
    'ebike_charger': (0, 352, 256, 256),
    'ne_corner_roof': (256, 352, 512, 112),
    'ebike_plinth_1': (256, 464, 256, 72),
    'ebike_plinth_2': (512, 464, 256, 72),
    'ebike_plinth_3': (768, 464, 256, 72),
    'ebike_banner_side': (768, 352, 256, 112),
    'ebike_door_hdr': (256, 536, 512, 72),
    'ebike_bay_sign': (768, 536, 256, 72),
    'szj_shop_0': (0, 624, 256, 80),
    'szj_shop_1': (256, 624, 256, 80),
    'szj_shop_2': (512, 624, 256, 80),
    'szj_shop_3': (768, 624, 256, 80),
    'szj_shop_4': (0, 704, 256, 80),
    'szj_shop_5': (256, 704, 256, 80),
    'szj_shop_6': (512, 704, 256, 80),
    'szj_shop_7': (768, 704, 256, 80),
    # Municipal cantilevered road guide signs (approach-accurate Guilin geography, 0 mirrored faces)
    'road_n_in': (0, 784, 256, 88),
    'road_s_in': (256, 784, 256, 88),
    'road_w_in': (512, 784, 256, 88),
    'road_e_in': (768, 784, 256, 88),
    # Roadside twin-post sign, T street plates, underpass plaque, rail banner & signal lenses
    'road_side_main': (0, 872, 256, 152),
    'street_zhongshan': (256, 872, 208, 50),
    'street_jiefang_w': (256, 922, 208, 50),
    'street_jiefang_e': (256, 972, 208, 52),
    'sign_underpass': (464, 872, 256, 76),
    'sign_rail_banner': (464, 948, 256, 76),
    'signal_main_l': (720, 872, 64, 152),
    'signal_main_r': (784, 872, 64, 152),
    'signal_bike_pair': (848, 872, 176, 96),
    'signal_bike_cd': (848, 968, 96, 56),
    'speed_50': (944, 968, 56, 56),
}

NW_NANFANG = [
    (-75.56, -72.45), (-84.57, -42.86), (-44.98, -33.52), (-43.42, -41.32),
    (-33.62, -40.53), (-26.17, -44.04), (-19.12, -48.32), (-16.38, -51.43),
    (-11.67, -51.43), (1.66, -98.94), (-48.91, -114.50), (-56.70, -92.35),
    (-29.70, -84.92), (-53.22, -67.00),
]

NE_CORNER = [
    (61.23, -84.32), (49.35, -43.56), (54.32, -33.10), (57.31, -26.79),
    (65.01, -10.57), (76.08, -7.62), (91.74, -76.27),
]

NE_ANNEX = [
    (79.56, -12.70), (76.25, 1.14), (130.47, 13.93), (133.78, 0.08),
]

SE_WENHUA = [
    (7.28, 90.65), (65.49, 105.76), (69.26, 102.78), (82.39, 54.74),
    (50.92, 46.35), (48.92, 52.97), (45.25, 57.50), (40.81, 61.69),
    (37.24, 64.57), (31.69, 66.67), (25.35, 67.65), (20.68, 67.33),
    (13.90, 65.34),
]


def _build_shizijie_shop_signs_sheet() -> Image.Image:
    """Render 1024x1024 original Guilin signage atlas for Shizijie (zero real-world trademarks)."""
    sheet = Image.new('RGB', (SHOP_SIGN_ATLAS, SHOP_SIGN_ATLAS), (24, 32, 40))
    draw = ImageDraw.Draw(sheet)

    # 1. Main dealership fascia: 漓行电驴行 · 十字街总店 (asphalt #182028 + jade #20d6c1 + osmanthus gold #ffc53d)
    x, y, w, h = SHOP_SIGN_RECTS['ebike_main']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(24, 32, 40))
    draw.rectangle((x + 4, y + 4, x + w - 5, y + h - 5), outline=(32, 214, 193), width=5)
    draw.rectangle((x + 12, y + 12, x + w - 13, y + h - 13), outline=(44, 72, 82), width=2)
    # Original "山水电弧" geometric wheel-arc emblem on left
    cx, cy = x + 76, y + 64
    draw.ellipse((cx - 40, cy - 40, cx + 40, cy + 40), outline=(32, 214, 193), width=6)
    draw.ellipse((cx - 24, cy - 24, cx + 24, cy + 24), outline=(255, 197, 61), width=4)
    draw.polygon([(cx - 32, cy + 14), (cx - 10, cy - 16), (cx + 6, cy + 4), (cx + 22, cy - 20), (cx + 34, cy + 14)],
                 outline=(240, 246, 248), fill=(24, 58, 68))
    draw.line((cx - 18, cy + 20, cx + 22, cy + 20), fill=(255, 197, 61), width=4)
    # Main title & subtitle
    _draw_centered(
        draw, (x + 132, y + 10, w - 156, 68),
        '漓 行 电 驴 行  ·  十 字 街 总 店',
        _font(54, bold=True, sans=True), (255, 197, 61), stroke_w=2, stroke_fill=(120, 76, 12),
    )
    _draw_centered(
        draw, (x + 132, y + 80, w - 156, 34),
        '试驾  ·  购车  ·  改装  ·  快充    |    LIJIANG E-MOTO FLAGSHIP',
        _font(22, bold=True, sans=True), (216, 223, 228),
    )

    # 2. Warm illuminated showroom interior window displays (left & right bays)
    for key, badge, headline, sub, accent in (
        ('ebike_window_l', '全系试驾', '漓江小轻骑 · 城心续航摩', '免费 90s 街头试骑 · 满改合规调校', (32, 214, 193)),
        ('ebike_window_r', '旗舰改装', '象山疾风 GT · 原厂直营', '涂装 / 风挡 / 尾箱 / 底盘霓虹 / 快充保养', (255, 197, 61)),
    ):
        rx, ry, rw, rh = SHOP_SIGN_RECTS[key]
        # Warm showroom ceiling glow gradient
        for row in range(rh):
            t = row / float(max(1, rh - 1))
            r = int(42 + 46 * (1.0 - t) * (1.0 - 0.35 * t))
            g = int(50 + 52 * (1.0 - t) * (1.0 - 0.25 * t))
            b = int(56 + 44 * (1.0 - t))
            draw.line((rx, ry + row, rx + rw - 1, ry + row), fill=(r, g, b))
        # Recessed light bars + showroom silhouette bays
        draw.rectangle((rx + 18, ry + 14, rx + rw - 19, ry + 24), fill=(245, 226, 178))
        draw.rectangle((rx + 10, ry + 10, rx + rw - 11, ry + rh - 11), outline=accent, width=3)
        # Subtle vertical glass mullion lines
        for mx in (rx + rw // 3, rx + (2 * rw) // 3):
            draw.line((mx, ry + 10, mx, ry + rh - 11), fill=(26, 34, 42), width=4)
        # Poster header card packed cleanly inside top 34% of window glass (>=2.13m high, 0 scooter occlusion)
        draw.rectangle((rx + 22, ry + 12, rx + 128, ry + 35), fill=accent)
        _draw_centered(draw, (rx + 22, ry + 12, 106, 23), badge, _font(17, bold=True, sans=True), (16, 20, 26))
        _draw_centered(draw, (rx + 18, ry + 36, rw - 36, 32), headline, _font(28, bold=True, sans=True), (248, 246, 240), stroke_w=1, stroke_fill=(18, 24, 30))
        _draw_centered(draw, (rx + 18, ry + 68, rw - 36, 22), sub, _font(16, bold=True, sans=True), (226, 238, 242))

    # 3. Side dual-gun fast charger lightbox
    x, y, w, h = SHOP_SIGN_RECTS['ebike_charger']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(20, 28, 34))
    draw.rectangle((x + 6, y + 6, x + w - 7, y + h - 7), outline=(32, 214, 193), width=5)
    draw.rectangle((x + 20, y + 18, x + w - 21, y + 72), fill=(32, 214, 193))
    _draw_centered(draw, (x + 20, y + 18, w - 40, 54), '漓 行 快 充', _font(32, bold=True, sans=True), (16, 22, 28))
    # Stylized lightning + battery icon
    draw.rectangle((x + 76, y + 92, x + 180, y + 168), outline=(255, 197, 61), width=5)
    draw.rectangle((x + 114, y + 82, x + 142, y + 92), fill=(255, 197, 61))
    draw.polygon([(x + 132, y + 102), (x + 108, y + 134), (x + 128, y + 134), (x + 120, y + 160), (x + 150, y + 124), (x + 128, y + 124)],
                 fill=(32, 214, 193))
    _draw_centered(draw, (x + 12, y + 180, w - 24, 34), '免费慢充 · 快充 ¥20', _font(22, bold=True, sans=True), (255, 197, 61))
    _draw_centered(draw, (x + 12, y + 214, w - 24, 28), '满修保养 · 双枪工位', _font(18, bold=True, sans=True), (210, 224, 230))

    # 4. NE corner rooftop sign replacing real-world bank trademark
    x, y, w, h = SHOP_SIGN_RECTS['ne_corner_roof']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(28, 52, 82))
    draw.rectangle((x + 5, y + 5, x + w - 6, y + h - 6), outline=(232, 204, 120), width=4)
    _draw_centered(draw, (x + 16, y + 10, w - 32, 58), '榕  城  商  厦', _font(48, bold=True), (248, 232, 166), stroke_w=1)
    _draw_centered(draw, (x + 16, y + 72, w - 32, 28), 'RONGCHENG COMMERCIAL PLAZA', _font(20, bold=True, sans=True), (218, 230, 242))

    # 5. Three exhibition plinth front plaques
    for key, line1, line2, accent in (
        ('ebike_plinth_1', '1档 · 漓江小轻骑', '¥1,800 · 通勤耐摔', (110, 158, 181)),
        ('ebike_plinth_2', '2档 · 城心续航摩', '¥3,600 · 稳汤续航', (32, 214, 193)),
        ('ebike_plinth_3', '3档 · 象山疾风GT', '¥6,800 · 70km/h', (255, 197, 61)),
    ):
        rx, ry, rw, rh = SHOP_SIGN_RECTS[key]
        draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=(24, 32, 40))
        draw.rectangle((rx + 2, ry + 2, rx + rw - 3, ry + rh - 3), outline=accent, width=3)
        _draw_centered(draw, (rx + 6, ry + 3, rw - 12, 34), line1, _font(26, bold=True, sans=True), (255, 252, 246))
        _draw_centered(draw, (rx + 6, ry + 37, rw - 12, 28), line2, _font(21, bold=True, sans=True), accent)

    # 6. Entrance portal header & side flag sign
    x, y, w, h = SHOP_SIGN_RECTS['ebike_door_hdr']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(20, 28, 34))
    draw.rectangle((x + 3, y + 3, x + w - 4, y + h - 4), outline=(32, 214, 193), width=3)
    _draw_centered(draw, (x + 10, y + 8, w - 20, h - 16), '按 F 进店 · 看车 / 试驾 / 改装', _font(30, bold=True, sans=True), (255, 197, 61))

    x, y, w, h = SHOP_SIGN_RECTS['ebike_banner_side']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(22, 30, 38))
    draw.rectangle((x + 4, y + 4, x + w - 5, y + h - 5), outline=(255, 197, 61), width=4)
    _draw_centered(draw, (x + 10, y + 10, w - 20, 52), '漓行电驴行', _font(36, bold=True, sans=True), (255, 197, 61))
    _draw_centered(draw, (x + 10, y + 64, w - 20, 36), '免费试驾 · 现车提走', _font(20, bold=True, sans=True), (32, 214, 193))

    x, y, w, h = SHOP_SIGN_RECTS['ebike_bay_sign']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(24, 34, 42))
    draw.rectangle((x + 3, y + 3, x + w - 4, y + h - 4), outline=(32, 214, 193), width=3)
    _draw_centered(draw, (x + 8, y + 10, w - 16, h - 20), '快充维修工位', _font(28, bold=True, sans=True), (32, 214, 193))

    # 7. Eight 100% original Guilin storefront signs for all surrounding Shizijie bays (zero real-world trademarks)
    original_shops = [
        ('szj_shop_0', (34, 40, 48), (242, 216, 146), '漓 畔 金 行', 'LIJIANG JEWELRY'),
        ('szj_shop_1', (32, 78, 60), (240, 246, 240), '榕 城 茗 茶', 'RONGCHENG TEA'),
        ('szj_shop_2', (158, 46, 38), (248, 224, 140), '十字街老粉店', 'GUILIN RICE NOODLES'),
        ('szj_shop_3', (30, 78, 126), (244, 248, 252), '济康本草堂', 'HERBAL PHARMACY'),
        ('szj_shop_4', (36, 44, 56), (228, 238, 246), '象山数码馆', 'XIANGSHAN DIGITAL'),
        ('szj_shop_5', (32, 90, 94), (240, 248, 246), '青岚运动坊', 'QINGLAN SPORTS'),
        ('szj_shop_6', (126, 42, 46), (246, 218, 138), '桂风特产铺', 'GUILIN SPECIALTIES'),
        ('szj_shop_7', (38, 86, 102), (242, 246, 248), '漓 江 书 局', 'LIJIANG BOOKSTORE'),
    ]
    for key, bg, fg, zh, en in original_shops:
        rx, ry, rw, rh = SHOP_SIGN_RECTS[key]
        border = tuple(min(255, c + 36) for c in bg)
        draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=bg)
        draw.rectangle((rx + 4, ry + 4, rx + rw - 5, ry + rh - 5), outline=border, width=3)
        _draw_centered(draw, (rx + 10, ry + 6, rw - 20, int(rh * 0.58)), zh, _font(28, bold=True), fg, stroke_w=1)
        _draw_centered(draw, (rx + 10, ry + int(rh * 0.62), rw - 20, int(rh * 0.30)), en, _font(13, bold=True, sans=True), fg)

    # 8. Approach-accurate cantilevered blue direction signs (desaturated national-standard blue #1e5898)
    blue_muni = (30, 88, 152)
    white_muni = (232, 236, 240)

    def _arrow_up(cx, cy, s=8, col=white_muni):
        draw.line((cx, cy + s, cx, cy - s + 3), fill=col, width=3)
        draw.polygon([(cx, cy - s - 2), (cx - 6, cy - s + 6), (cx + 6, cy - s + 6)], fill=col)

    def _arrow_left(cx, cy, s=9, col=white_muni):
        draw.line((cx + s, cy, cx - s + 3, cy), fill=col, width=3)
        draw.polygon([(cx - s - 2, cy), (cx - s + 6, cy - 5), (cx - s + 6, cy + 5)], fill=col)

    def _arrow_right(cx, cy, s=9, col=white_muni):
        draw.line((cx - s, cy, cx + s - 3, cy), fill=col, width=3)
        draw.polygon([(cx + s + 2, cy), (cx + s - 6, cy - 5), (cx + s - 6, cy + 5)], fill=col)

    for key, ahead_zh, ahead_en, left_zh, right_zh in (
        ('road_n_in', '中山中路 · 桂林站', 'Zhongshan M. Rd.', '解放东路 解放桥', '解放西路'),
        ('road_s_in', '中山中路 · 王  城', 'Zhongshan M. Rd.', '解放西路', '解放东路 解放桥'),
        ('road_w_in', '解放东路 · 解放桥', 'Jiefang E. Rd.', '中山中路 王城', '桂林站 象山'),
        ('road_e_in', '解 放 西 路', 'Jiefang W. Rd.', '中山中路 桂林站', '中山中路 王城'),
    ):
        rx, ry, rw, rh = SHOP_SIGN_RECTS[key]
        draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=blue_muni)
        draw.rectangle((rx + 3, ry + 3, rx + rw - 4, ry + rh - 4), outline=white_muni, width=2)
        draw.line((rx + 4, ry + 45, rx + rw - 5, ry + 45), fill=white_muni, width=2)
        draw.line((rx + rw // 2, ry + 45, rx + rw // 2, ry + rh - 5), fill=white_muni, width=2)
        _arrow_up(rx + 22, ry + 22, s=8)
        _draw_centered(draw, (rx + 36, ry + 5, rw - 44, 24), ahead_zh, _font(19, bold=True, sans=True), white_muni)
        _draw_centered(draw, (rx + 36, ry + 27, rw - 44, 15), ahead_en, _font(11, bold=True, sans=True), (206, 220, 234))
        _arrow_left(rx + 18, ry + 65, s=7)
        _draw_centered(draw, (rx + 28, ry + 49, rw // 2 - 32, 34), left_zh, _font(14, bold=True, sans=True), white_muni)
        _arrow_right(rx + rw - 18, ry + 65, s=7)
        _draw_centered(draw, (rx + rw // 2 + 4, ry + 49, rw // 2 - 32, 34), right_zh, _font(14, bold=True, sans=True), white_muni)

    # 9. Roadside twin-post crossroad direction sign (northbound Guilin landmarks, zero clipping)
    rx, ry, rw, rh = SHOP_SIGN_RECTS['road_side_main']
    draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=blue_muni)
    draw.rectangle((rx + 4, ry + 4, rx + rw - 5, ry + rh - 5), outline=white_muni, width=3)
    cx, cy = rx + rw // 2, ry + 78
    draw.line((cx, cy - 26, cx, cy + 28), fill=white_muni, width=5)
    draw.line((rx + 34, cy, rx + rw - 34, cy), fill=white_muni, width=5)
    _arrow_up(cx, cy - 26, s=8)
    _arrow_left(rx + 26, cy, s=8)
    _arrow_right(rx + rw - 26, cy, s=8)
    _draw_centered(draw, (rx + 16, ry + 8, rw - 32, 30), '中山中路 · 王城 · 独秀峰', _font(19, bold=True, sans=True), white_muni)
    _draw_centered(draw, (rx + 12, cy - 28, 92, 22), '解放西路', _font(15, bold=True, sans=True), white_muni)
    _draw_centered(draw, (rx + rw - 114, cy - 28, 102, 22), '解放东路 解放桥', _font(14, bold=True, sans=True), white_muni)
    draw.line((rx + 8, ry + 114, rx + rw - 9, ry + 114), fill=white_muni, width=2)
    _draw_centered(draw, (rx + 10, ry + 118, rw - 20, 26), '漓江东岸 · 叠彩山 · 七星公园', _font(15, bold=True, sans=True), white_muni)

    # 10. Municipal street-name T-plates (blue upper CJK + clean light-grey lower Pinyin)
    for key, zh, en in (
        ('street_zhongshan', '中 山 中 路', 'ZHONGSHAN ZHONG LU'),
        ('street_jiefang_w', '解 放 西 路', 'JIEFANG XI LU'),
        ('street_jiefang_e', '解 放 东 路', 'JIEFANG DONG LU'),
    ):
        rx, ry, rw, rh = SHOP_SIGN_RECTS[key]
        draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=white_muni)
        draw.rectangle((rx + 2, ry + 2, rx + rw - 3, ry + 31), fill=blue_muni)
        draw.rectangle((rx + 2, ry + 2, rx + rw - 3, ry + rh - 3), outline=blue_muni, width=2)
        _draw_centered(draw, (rx + 6, ry + 4, rw - 12, 25), zh, _font(18, bold=True, sans=True), white_muni)
        _draw_centered(draw, (rx + 6, ry + 33, rw - 12, 13), en, _font(10, bold=True, sans=True), blue_muni)

    # 11. Restrained pedestrian underpass plaque & SW guardrail helmet safety banner
    rx, ry, rw, rh = SHOP_SIGN_RECTS['sign_underpass']
    draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=blue_muni)
    draw.rectangle((rx + 3, ry + 3, rx + rw - 4, ry + rh - 4), outline=white_muni, width=2)
    for st in range(4):
        sx0 = rx + 14 + st * 9
        sy0 = ry + 24 + st * 7
        draw.rectangle((sx0, sy0, sx0 + 12, sy0 + 7), fill=white_muni)
    _draw_centered(draw, (rx + 60, ry + 11, rw - 72, 34), '十字街地下通道', _font(23, bold=True, sans=True), white_muni)
    _draw_centered(draw, (rx + 60, ry + 46, rw - 72, 20), 'PEDESTRIAN UNDERPASS', _font(12, bold=True, sans=True), (206, 220, 234))

    rx, ry, rw, rh = SHOP_SIGN_RECTS['sign_rail_banner']
    navy_muni = (30, 48, 86)
    draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=navy_muni)
    draw.rectangle((rx + 4, ry + 4, rx + rw - 5, ry + rh - 5), outline=white_muni, width=2)
    _draw_centered(draw, (rx + 10, ry + 11, rw - 20, 28), '骑 乘 电 动 自 行 车', _font(19, bold=True, sans=True), white_muni)
    _draw_centered(draw, (rx + 10, ry + 41, rw - 20, 26), '请 佩 戴 安 全 头 盔', _font(19, bold=True, sans=True), (222, 228, 236))

    # 12. Vertical traffic signal lenses + bike signals + countdown + speed 50 circle
    sig_shell = (26, 29, 34)
    lens_off = (38, 42, 48)
    red_sig = (212, 60, 54)
    grn_sig = (52, 188, 114)
    for key, cols in (
        ('signal_main_l', (red_sig, lens_off, lens_off)),
        ('signal_main_r', (lens_off, lens_off, grn_sig)),
    ):
        rx, ry, rw, rh = SHOP_SIGN_RECTS[key]
        draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=sig_shell)
        draw.rectangle((rx + 2, ry + 2, rx + rw - 3, ry + rh - 3), outline=(145, 150, 156), width=2)
        for li, lcol in enumerate(cols):
            lcy = ry + 28 + li * 48
            lcx = rx + rw // 2
            draw.ellipse((lcx - 19, lcy - 19, lcx + 19, lcy + 19), fill=(16, 18, 22), outline=(66, 70, 76), width=2)
            draw.ellipse((lcx - 15, lcy - 15, lcx + 15, lcy + 15), fill=lcol)
            if lcol != lens_off and key == 'signal_main_l' and li == 0:
                _arrow_left(lcx, lcy, s=8, col=(248, 190, 182))
            elif lcol != lens_off and key == 'signal_main_r' and li == 2:
                _arrow_up(lcx, lcy, s=8, col=(198, 246, 218))

    rx, ry, rw, rh = SHOP_SIGN_RECTS['signal_bike_pair']
    draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=sig_shell)
    draw.rectangle((rx + 2, ry + 2, rx + rw - 3, ry + rh - 3), outline=(170, 174, 180), width=2)
    draw.line((rx + rw // 2, ry + 4, rx + rw // 2, ry + rh - 5), fill=(150, 154, 160), width=2)
    for col_i, active_row, col_rgb in ((0, 0, red_sig), (1, 1, grn_sig)):
        bx0 = rx + col_i * (rw // 2) + (rw // 4)
        for row_i in (0, 1):
            by0 = ry + 24 + row_i * 48
            draw.ellipse((bx0 - 18, by0 - 18, bx0 + 18, by0 + 18), fill=(16, 18, 22))
            if row_i == active_row:
                draw.ellipse((bx0 - 15, by0 - 15, bx0 + 15, by0 + 15), fill=col_rgb)
                draw.ellipse((bx0 - 10, by0 + 1, bx0 - 2, by0 + 9), outline=(244, 248, 250), width=2)
                draw.ellipse((bx0 + 2, by0 + 1, bx0 + 10, by0 + 9), outline=(244, 248, 250), width=2)
                draw.line((bx0 - 7, by0 + 5, bx0, by0 - 5, bx0 + 6, by0 + 5), fill=(244, 248, 250), width=2)

    rx, ry, rw, rh = SHOP_SIGN_RECTS['signal_bike_cd']
    draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=sig_shell)
    draw.rectangle((rx + 2, ry + 2, rx + rw - 3, ry + rh - 3), outline=(120, 124, 130), width=2)
    _draw_centered(draw, (rx + 4, ry + 5, 42, rh - 10), '21', _font(26, bold=True, sans=True), red_sig)
    _draw_centered(draw, (rx + 50, ry + 5, 42, rh - 10), '18', _font(26, bold=True, sans=True), grn_sig)

    rx, ry, rw, rh = SHOP_SIGN_RECTS['speed_50']
    draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=sig_shell)
    cx, cy = rx + rw // 2, ry + rh // 2
    draw.ellipse((cx - 22, cy - 22, cx + 22, cy + 22), fill=(232, 236, 240), outline=(196, 56, 52), width=5)
    _draw_centered(draw, (cx - 18, cy - 14, 36, 28), '50', _font(21, bold=True, sans=True), (28, 32, 36))

    return sheet


def _build_shizijie_surfaces_sheet() -> Image.Image:
    """Render 256x256 (4x4 procedural grain) desaturated streetscape texture atlas."""
    rng = np.random.default_rng(20261125)
    arr = np.zeros((SHIZIJIE_SURF_ATLAS, SHIZIJIE_SURF_ATLAS, 3), dtype=np.uint8)
    for idx, (key, hex_col) in enumerate(SHIZIJIE_SWATCHES.items()):
        c = np.array([int(hex_col[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.int16)
        tile = np.broadcast_to(c, (64, 64, 3)).copy()
        if key in ('granite_curb', 'granite_light', 'soil_mulch'):
            tile += rng.integers(-12, 13, (64, 64, 1), dtype=np.int16)
            if key == 'granite_curb':
                tile[::32, :, :] -= 18
                tile[:, ::32, :] -= 16
        elif key == 'tree_grate':
            tile += rng.integers(-6, 7, (64, 64, 1), dtype=np.int16)
            tile[8:56:8, 6:58, :] = np.clip(c - 22, 0, 255)
            tile[6:58, 8:56:16, :] = np.clip(c - 16, 0, 255)
        elif key in ('bark_camphor', 'bark_lime'):
            col_noise = rng.integers(-14, 15, (1, 64, 1), dtype=np.int16)
            fine = rng.integers(-6, 7, (64, 64, 1), dtype=np.int16)
            tile += col_noise + fine
            if key == 'bark_lime':
                tile[:14, :, :] = np.array([84, 78, 69]) + fine[:14]
        elif key.startswith('foliage_'):
            tile += rng.integers(-14, 15, (64, 64, 1), dtype=np.int16)
            spots = rng.random((64, 64)) < 0.14
            tile[spots] = np.clip(c - 18, 0, 255)
        elif key.startswith('flower_'):
            leaf = np.array([62, 86, 52], dtype=np.int16)
            tile = np.broadcast_to(leaf, (64, 64, 3)).copy() + rng.integers(-10, 11, (64, 64, 1), dtype=np.int16)
            petals = rng.random((64, 64)) < 0.36
            tile[petals] = np.clip(c + rng.integers(-10, 11, (int(petals.sum()), 3)), 0, 255)
        else:
            tile += rng.integers(-5, 6, (64, 64, 1), dtype=np.int16)
        r, col = divmod(idx, 4)
        arr[r * 64:(r + 1) * 64, col * 64:(col + 1) * 64] = np.clip(tile, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, mode='RGB')


class ShizijieBuilder(Builder):
    """Extends Group-B Builder with Shizijie's dedicated `shizijie_shop_signs` & `shizijie_surfaces` channels."""

    def __init__(self, detail=True):
        super().__init__(detail=detail)
        self.shop_sign_tris = []
        self.shop_sign_uv = []
        self.szj_surf_tris = []
        self.szj_surf_uv = []
        self.foliage_verts = []
        self.foliage_normals = []
        self.foliage_faces = []
        self.foliage_uv = []
        self._foliage_vcount = 0

    def foliage_mesh(self, vertices, faces, mat, smooth_center=None):
        """Indexed organic canopy/shrub mesh with bent spherical smooth normals (0 crystal facets)."""
        verts = np.asarray(vertices, dtype=float)
        idx = np.asarray(faces, dtype=np.int64)
        if len(idx) == 0:
            return
        if smooth_center is not None:
            rel = verts - np.asarray(smooth_center, dtype=float)
            rel[:, 1] += 0.35 * np.maximum(0.5, np.ptp(rel[:, 1]))
            norms = rel / np.maximum(np.linalg.norm(rel, axis=1, keepdims=True), 1e-6)
        else:
            norms = np.tile([0.0, 1.0, 0.0], (len(verts), 1))
        angle = self.pose[3]
        if angle:
            c, s = math.cos(angle), math.sin(angle)
            nx0, nz0 = norms[:, 0].copy(), norms[:, 2].copy()
            norms[:, 0] = nx0 * c + nz0 * s
            norms[:, 2] = -nx0 * s + nz0 * c
        world_verts = self._transform(verts)
        u_rel = 0.5 + 0.42 * np.sin(verts[:, 0] * 1.45 + verts[:, 1] * 0.95)
        v_rel = 0.5 + 0.42 * np.cos(verts[:, 2] * 1.45 - verts[:, 1] * 1.15)
        cell = SHIZIJIE_SURF_INDEX[mat]
        mapped_uv = np.column_stack((
            (u_rel * 0.88 + 0.06 + (cell % 4)) / 4.0,
            (v_rel * 0.88 + 0.06 + (3 - cell // 4)) / 4.0,
        ))
        self.foliage_verts.append(world_verts)
        self.foliage_normals.append(norms)
        self.foliage_faces.append(idx + self._foliage_vcount)
        self.foliage_uv.append(mapped_uv)
        self._foliage_vcount += len(world_verts)

    def mesh(self, vertices, faces, mat, collide=False, uv_scale=None):
        if mat not in SHIZIJIE_SURF_INDEX:
            return super().mesh(vertices, faces, mat, collide=collide, uv_scale=uv_scale)
        verts = np.asarray(vertices, dtype=float)
        idx = np.asarray(faces, dtype=np.int64)
        if len(idx) == 0:
            return
        local = verts[idx]
        tris = self._transform(local)
        if collide:
            self.solid.append(tris)
        cross = np.cross(local[:, 1] - local[:, 0], local[:, 2] - local[:, 0])
        normal_axis = np.abs(cross).argmax(axis=1)
        axes = np.array([[2, 1], [0, 2], [0, 1]])[normal_axis]
        coords = np.take_along_axis(local, axes[:, None, :], axis=2)
        cmin = coords.min(axis=1, keepdims=True)
        span = np.maximum(coords.max(axis=1, keepdims=True) - cmin, 1e-6)
        norm_uv = (coords - cmin) / span
        cell = SHIZIJIE_SURF_INDEX[mat]
        mapped_uv = (norm_uv * 0.90 + 0.05 + [cell % 4, 3 - cell // 4]) / 4.0
        self.szj_surf_tris.append(tris)
        self.szj_surf_uv.append(mapped_uv)

    def coll_box(self, x, y, z, w, h, d):
        """Emit an invisible solid collision box aligned to the current builder pose."""
        cube = trimesh.creation.box([w, h, d])
        verts = cube.vertices + [x, y + h / 2.0, z]
        self.solid.append(self._transform(verts[cube.faces]))

    def v_bar(self, x, y0, h, z, w, d, mat):
        """Emit a 4-face rectangular vertical bar (8 tris, no top/bottom caps) to keep guardrail draw weight lean."""
        hw, hd, y1 = w * 0.5, d * 0.5, y0 + h
        verts = np.array([
            [x - hw, y0, z + hd], [x + hw, y0, z + hd], [x + hw, y1, z + hd], [x - hw, y1, z + hd],
            [x + hw, y0, z - hd], [x - hw, y0, z - hd], [x - hw, y1, z - hd], [x + hw, y1, z - hd],
        ], dtype=float)
        faces = np.array([
            [0, 1, 2], [0, 2, 3],
            [4, 5, 6], [4, 6, 7],
            [1, 4, 7], [1, 7, 2],
            [5, 0, 3], [5, 3, 6],
        ], dtype=np.int64)
        self.mesh(verts, faces, mat, collide=False)

    def prism_polygon(self, poly, y0, h, mat, collide=False, cap_mat=None):
        """Extrude a Shapely Polygon (preserving any interior exclusion rings) from y0 to y0 + h."""
        if not poly.interiors:
            return self.prism(list(poly.exterior.coords), y0, h, mat, collide=collide, cap_mat=cap_mat)

        def _ring_pts(ring, ccw: bool):
            pts = np.asarray(list(ring.coords), dtype=float)
            if len(pts) > 1 and np.allclose(pts[0], pts[-1]):
                pts = pts[:-1]
            if len(pts) < 3:
                return None
            signed_area = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
            if (signed_area < 0) == ccw:
                pts = pts[::-1]
            return pts

        ext = _ring_pts(poly.exterior, ccw=True)
        if ext is None:
            return
        rings = [ext]
        for interior in poly.interiors:
            hole = _ring_pts(interior, ccw=False)
            if hole is not None:
                rings.append(hole)
        all_pts = np.vstack(rings)
        ring_ends = np.cumsum([len(r) for r in rings], dtype=np.uint32)
        tris_2d = mapbox_earcut.triangulate_float64(all_pts, ring_ends).reshape(-1, 3)
        top_verts = np.column_stack([all_pts[:, 0], np.full(len(all_pts), y0 + h), all_pts[:, 1]])
        self.mesh(top_verts, tris_2d[:, ::-1], cap_mat or mat, collide)
        for ring in rings:
            n = len(ring)
            for i in range(n):
                j = (i + 1) % n
                x0, z0 = ring[i]
                x1, z1 = ring[j]
                quad_v = [
                    (x0, y0, z0),
                    (x1, y0, z1),
                    (x1, y0 + h, z1),
                    (x0, y0 + h, z0),
                ]
                self.mesh(quad_v, [[0, 2, 1], [0, 3, 2]], mat, collide)

    def shop_sign_quad(self, x, y0, z, w, h, sign_key, double_sided=False, back_offset=0.04):
        rx, ry, rw, rh = SHOP_SIGN_RECTS[sign_key]
        u0 = (rx + 1.5) / SHOP_SIGN_ATLAS
        u1 = (rx + rw - 1.5) / SHOP_SIGN_ATLAS
        v_top = 1.0 - (ry + 1.5) / SHOP_SIGN_ATLAS
        v_bot = 1.0 - (ry + rh - 1.5) / SHOP_SIGN_ATLAS
        hw = w / 2.0
        quad = self._transform([
            (x - hw, y0, z),
            (x + hw, y0, z),
            (x + hw, y0 + h, z),
            (x - hw, y0 + h, z),
        ])
        uvs = np.array([(u0, v_bot), (u1, v_bot), (u1, v_top), (u0, v_top)], dtype=float)
        idx = [[0, 1, 2], [0, 2, 3]]
        self.shop_sign_tris.append(quad[idx])
        self.shop_sign_uv.append(uvs[idx])
        if double_sided:
            zb = z - back_offset
            back = self._transform([
                (x + hw, y0, zb),
                (x - hw, y0, zb),
                (x - hw, y0 + h, zb),
                (x + hw, y0 + h, zb),
            ])
            self.shop_sign_tris.append(back[idx])
            self.shop_sign_uv.append(uvs[idx])


def _pave_surface_y(m: Builder, lx: float, lz: float) -> float:
    """Sample exact top height of draped `B_plaza_pave` triangles at landmark-local (lx, lz)."""
    best = None
    for tris, _ in m.tiled.get('pave', ()):
        # tris shape: (N, 3, 3)
        xs = tris[:, :, 0]
        zs = tris[:, :, 2]
        mask = (xs.min(axis=1) <= lx + 1e-4) & (xs.max(axis=1) >= lx - 1e-4) & \
               (zs.min(axis=1) <= lz + 1e-4) & (zs.max(axis=1) >= lz - 1e-4)
        for tri in tris[mask]:
            ax, ay, az = tri[0]
            bx, by, bz = tri[1]
            cx, cy, cz = tri[2]
            det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az)
            if abs(det) < 1e-8:
                continue
            w1 = ((lx - ax) * (cz - az) - (cx - ax) * (lz - az)) / det
            w2 = ((bx - ax) * (lz - az) - (lx - ax) * (bz - az)) / det
            if w1 >= -1e-4 and w2 >= -1e-4 and (w1 + w2) <= 1.0 + 1e-4:
                y = ay + w1 * (by - ay) + w2 * (cy - ay)
                if best is None or y > best:
                    best = float(y)
    if best is not None:
        return best
    return float(m.surface.ground(lx, lz)) + 0.04


def _sample_pave_range(m: Builder, cx: float, cz: float, ux: float, uz: float, nx: float, nz: float, hw: float, hd: float):
    """Return (min_y, max_y) of `B_plaza_pave` across an oriented rectangle."""
    samples = []
    for su in (-hw, 0.0, hw):
        for sd in (-hd, 0.0, hd):
            px = cx + su * ux + sd * nx
            pz = cz + su * uz + sd * nz
            samples.append(_pave_surface_y(m, px, pz))
    return min(samples), max(samples)


def _commercial_strip(m: ShizijieBuilder, p0, p1, outward_sign, podium_h, total_h, wall_mat, shop_seed, bays, skip_bays=()):
    """Detailed street-facing commercial facade along segment p0 -> p1 (100% original Guilin signage)."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    if length < 4.0:
        return
    ux, uz = dx / length, dz / length
    nx, nz = -uz * outward_sign, ux * outward_sign
    yaw = math.atan2(nx, nz)
    mx, mz = (p0[0] + p1[0]) / 2.0 + nx * 0.32, (p0[1] + p1[1]) / 2.0 + nz * 0.32

    m.pose = (mx, 0.0, mz, yaw)
    if not skip_bays:
        m.box(0, podium_h - 0.25, 0.15, length + 0.3, 0.55, 0.75, wall_mat)
    else:
        bay_w_pre = length / bays
        for i in range(bays):
            if i in skip_bays:
                continue
            cx_pre = -length / 2.0 + (i + 0.5) * bay_w_pre
            m.box(cx_pre, podium_h - 0.25, 0.15, bay_w_pre + 0.12, 0.55, 0.75, wall_mat)
    m.box(0, podium_h + 0.3, 0.05, length - 0.5, total_h - podium_h - 1.1, 0.28, 'glass')
    m.box(0, total_h - 0.8, 0.18, length + 0.4, 0.85, 0.85, wall_mat)
    m.box(0, total_h + 0.05, 0.22, length + 0.6, 0.28, 1.05, 'dark')

    if not m.detail:
        m.pose = (0.0, 0.0, 0.0, 0.0)
        return

    bay_w = length / bays
    floors = max(2, round((total_h - podium_h - 0.8) / 3.4))
    fl_h = (total_h - podium_h - 1.1) / floors
    skip_set = set(skip_bays)
    for i in range(bays + 1):
        lx = -length / 2.0 + i * bay_w
        # Skip interior ground-floor pier between two consecutive skipped flagship bays (keep upper shaft >= 4.5 m for 6 m IoU!)
        if (i - 1) in skip_set and i in skip_set:
            m.box(lx, podium_h + 0.25, 0.22, 0.62, total_h - (podium_h + 0.25), 0.62, wall_mat, collide=True)
        else:
            m.box(lx, -1.2, 0.22, 0.62, total_h + 1.2, 0.62, wall_mat, collide=True, footing=True)
        if i < bays:
            cx = lx + bay_w / 2.0
            if i not in skip_set:
                m.box(cx, 0.11, -0.05, bay_w - 0.72, 3.15, 0.22, 'glass')
                m.box(cx, 3.15, 0.65, bay_w - 0.45, 0.18, 1.25, 'alum')
                m.box(cx, 3.33, 0.56, bay_w - 0.68, 1.02, 0.24, 'dark')
                m.shop_sign_quad(cx, 3.38, 0.695, bay_w - 0.74, 0.92, f'szj_shop_{(i + shop_seed) % 8}')
            for fl in range(1, floors):
                m.box(cx, podium_h + 0.3 + fl * fl_h, 0.20, bay_w - 0.5, 0.36, 0.32, wall_mat)
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _build_ebike_flagship(m: ShizijieBuilder):
    """Build 「漓行电驴行 · 十字街总店」 across NE_ANNEX bays 3 + 4 (IDOK-127).

    All storefront fixtures stay <= 4.78 m high (cleanly below the 6 m audit_landmarks slice),
    sit directly on the expanded `ne_apron` granite paving (0 float / 0 sink in audit_grounding),
    and use `shizijie_shop_signs` for night neon self-illumination (0 new dynamic lights).
    """
    p0, p1 = NE_ANNEX[1], NE_ANNEX[2]  # (76.25, 1.14) -> (130.47, 13.93)
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    ux, uz = dx / length, dz / length
    nx, nz = -uz, ux
    yaw = math.atan2(nx, nz)  # -0.2317 rad (facing south-southwest toward Jiefang East Rd)
    bay_w = length / 9.0
    mid_wall_x, mid_wall_z = (p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0

    # Double-bay center between bay 3 and bay 4: s = -0.5 * bay_w -> local (100.348, 6.824)
    s34 = -0.5 * bay_w
    c_wx = mid_wall_x + s34 * ux
    c_wz = mid_wall_z + s34 * uz

    # Base apron height right at storefront threshold (d = +0.5 m)
    y_store = _pave_surface_y(m, c_wx + 0.55 * nx, c_wz + 0.55 * nz)

    # 1. Unified 2-bay dealership portal & fascia (posed at exact wall line d = 0)
    m.pose = (c_wx, 0.0, c_wz, yaw)
    span_w = 2.0 * bay_w - 0.62  # 11.76 m clear span between piers i=3 and i=5

    # Dark anodized base plinth along storefront sill (footed into terrain/paving)
    m.box(0.0, -0.4, 0.16, span_w + 0.30, y_store + 0.52, 0.50, 'dark', collide=True, footing=True)
    # Recessed curtain-glass storefront enclosure
    m.box(0.0, y_store + 0.08, 0.08, span_w, 3.25, 0.24, 'glass')
    # Dark anodized framing around flanking piers i=3 (-6.19) and i=5 (+6.19)
    for sx in (-bay_w, bay_w):
        m.box(sx, -0.4, 0.54, 0.72, 4.95, 0.72, 'dark', collide=True, footing=True)

    # Continuous fascia backing box (y = 3.50..4.74 m, z = 0.20..0.92 m, overlaps piers & upper beam)
    m.box(0.0, 3.50, 0.56, 12.10, 1.24, 0.72, 'dark')
    # Top and bottom slim aluminum fascia trim rails (top <= 4.78 m)
    m.box(0.0, 4.72, 0.60, 12.24, 0.06, 0.80, 'alum')
    m.box(0.0, 3.46, 0.60, 12.24, 0.06, 0.80, 'alum')

    # Main 11.6 m x 1.15 m glowing signboard quad (y = 3.55..4.70 m, d = 0.94 m)
    m.shop_sign_quad(0.0, 3.55, 0.94, 11.60, 1.15, 'ebike_main')

    # Cantilevered architectural entrance canopy (y = 3.24..3.42 m, d = 0.25..1.48 m)
    m.box(0.0, 3.24, 0.86, 12.06, 0.18, 1.24, 'dark')
    m.box(0.0, 3.22, 1.46, 12.06, 0.05, 0.08, 'alum')

    if m.detail:
        # Left & right showroom illuminated display glass panels (poster pushed high above 2.13m scooter height)
        for sx, win_key in ((-3.35, 'ebike_window_l'), (3.35, 'ebike_window_r')):
            m.box(sx, y_store + 0.10, 0.24, 4.52, 2.95, 0.16, 'dark')
            m.shop_sign_quad(sx, y_store + 0.42, 0.34, 4.36, 2.58, win_key)
        # Central entrance portal frame + header light strip
        for sx in (-1.06, 1.06):
            m.box(sx, y_store + 0.05, 0.32, 0.12, 3.15, 0.26, 'alum')
        m.box(0.0, y_store + 2.74, 0.44, 2.24, 0.48, 0.24, 'dark')
        m.shop_sign_quad(0.0, y_store + 2.77, 0.58, 2.06, 0.42, 'ebike_door_hdr')
        # Side projecting perpendicular blade sign on east pier (facing passersby along Jiefang East Rd)
        m.box(bay_w + 0.10, 3.60, 1.10, 0.14, 0.86, 1.10, 'dark')
        # Projecting side banner facing east/west along street (rotate 90 deg around local Y)
        m.pose = (c_wx + (bay_w + 0.18) * ux + 1.15 * nx, 0.0, c_wz + (bay_w + 0.18) * uz + 1.15 * nz, yaw + math.pi / 2.0)
        m.shop_sign_quad(0.0, 3.64, 0.02, 1.04, 0.78, 'ebike_banner_side', double_sided=True, back_offset=0.19)

    m.pose = (0.0, 0.0, 0.0, 0.0)

    # 2. Three raised exhibition plinths on expanded B_plaza_pave (u = -3.0, 0.0, +3.0; d = +1.75 m)
    # Every plinth sits 100% inside B_plaza_pave (which reaches d = +2.5 m across bays 3+4)
    # and is embedded 0.03 m into B_plaza_pave so audit_grounding.py finds zero float/sink.
    plinth_specs = (
        (-3.0, 1.75, 'ebike_plinth_1'),
        (0.0, 1.75, 'ebike_plinth_2'),
        (3.0, 1.75, 'ebike_plinth_3'),
    )
    plinth_w, plinth_d = 1.96, 1.14
    for pu, pd, plaque_key in plinth_specs:
        px = c_wx + pu * ux + pd * nx
        pz = c_wz + pu * uz + pd * nz
        ymin, ymax = _sample_pave_range(m, px, pz, ux, uz, nx, nz, plinth_w * 0.5, plinth_d * 0.5)
        y_bot = ymin - 0.03
        y_top = ymax + 0.14
        h_total = y_top - y_bot
        m.pose = (px, 0.0, pz, yaw)
        # Solid granite exhibition base
        m.box(0.0, y_bot, 0.0, plinth_w, h_total, plinth_d, 'dark', collide=True)
        # Beveled light-alloy display top deck (+0.02 m)
        m.box(0.0, y_top, 0.0, plinth_w - 0.10, 0.02, plinth_d - 0.10, 'alum', collide=True)
        if m.detail:
            # Front illuminated tier plaque facing street
            m.shop_sign_quad(0.0, y_top - 0.13, plinth_d * 0.5 + 0.015, 1.48, 0.13, plaque_key)
        m.pose = (0.0, 0.0, 0.0, 0.0)

    # 3. Side dual-gun fast-charging & repair service station (u = -6.2 m, d = +1.70 m, on B_plaza_pave)
    # Paired with `serviceBay` interaction zone right in front at (u = -6.2 m, d = +3.2 m, r = 2.6 m).
    chg_u, chg_d = -6.2, 1.70
    chg_x = c_wx + chg_u * ux + chg_d * nx
    chg_z = c_wz + chg_u * uz + chg_d * nz
    cy_min, cy_max = _sample_pave_range(m, chg_x, chg_z, ux, uz, nx, nz, 0.78, 0.42)
    cy_bot = cy_min - 0.03
    cy_pad = cy_max + 0.16
    m.pose = (chg_x, 0.0, chg_z, yaw)
    # Concrete/dark-granite service curb pad (0.16 m proud of apron -> cleanly clear of street-seam 0.05 m band)
    m.box(0.0, cy_bot, 0.0, 1.56, cy_pad - cy_bot, 0.84, 'dark', collide=True)
    # Main twin-gun charging cabinet (1.68 m tall above pad -> top <= 2.4 m)
    m.box(0.0, cy_pad, -0.04, 1.06, 1.68, 0.42, 'dark', collide=True)
    m.box(0.0, cy_pad + 1.68, 0.04, 1.36, 0.10, 0.76, 'alum')
    # Glowing front charger lightbox panel (shizijie_shop_signs -> night self-illuminated)
    m.shop_sign_quad(0.0, cy_pad + 0.70, 0.185, 0.92, 0.90, 'ebike_charger')
    if m.detail:
        # Top compact header sign + twin charging gun holsters on cabinet flanks
        m.shop_sign_quad(0.0, cy_pad + 1.80, 0.36, 1.12, 0.28, 'ebike_bay_sign')
        for sx in (-0.58, 0.58):
            m.box(sx, cy_pad + 0.80, 0.02, 0.10, 0.28, 0.14, 'alum')
            m.box(sx, cy_pad + 0.46, 0.04, 0.05, 0.34, 0.05, 'bronze')
        # Compact repair tool bench just west of charger (u = -7.25 m, d = +1.55 m, on B_plaza_pave)
        m.pose = (c_wx - 7.25 * ux + 1.55 * nx, 0.0, c_wz - 7.25 * uz + 1.55 * nz, yaw)
        by_min, by_max = _sample_pave_range(m, c_wx - 7.25 * ux + 1.55 * nx, c_wz - 7.25 * uz + 1.55 * nz, ux, uz, nx, nz, 0.36, 0.26)
        m.box(0.0, by_min - 0.03, 0.0, 0.72, (by_max + 0.86) - (by_min - 0.03), 0.50, 'red', collide=True)
        m.box(0.0, by_max + 0.86, 0.0, 0.78, 0.06, 0.56, 'alum')

    m.pose = (0.0, 0.0, 0.0, 0.0)


def _signal_gantry(
    m: ShizijieBuilder,
    x: float,
    z: float,
    yaw: float,
    arm_sign: int = 1,
    span: float = 9.0,
    sign_key: str = 'road_n_in',
    pole_h: float = 6.85,
    arm_y: float = 5.85,
):
    """Cantilevered galvanized traffic signal mast-arm (vertical visored heads + direction plaque)."""
    m.pose = (x, 0.0, z, yaw)
    m.box(0.0, -0.10, 0.0, 0.56, 0.42, 0.56, 'granite_curb', collide=True)
    m.box(0.0, 0.28, 0.0, 0.42, 0.08, 0.42, 'rail_base')
    m.cylinder_y(0.0, 0.30, 3.50, 0.0, 0.17, 'rail_silver', sections=8 if m.detail else 5, collide=True)
    m.cylinder_y(0.0, 3.74, pole_h - 3.74, 0.0, 0.125, 'rail_silver', sections=8 if m.detail else 5)
    m.box(0.0, pole_h - 0.04, 0.0, 0.28, 0.10, 0.28, 'rail_base')

    arm_end = arm_sign * span
    m.beam([0.0, arm_y, 0.0], [arm_end, arm_y, 0.0], 0.10, 'rail_silver', sections=6 if m.detail else 4)
    m.beam([0.0, pole_h - 0.14, 0.0], [arm_end * 0.44, arm_y + 0.02, 0.0], 0.05, 'rail_silver', sections=5)

    u_sign = arm_end * 0.40
    m.box(u_sign, 5.28, 0.11, 3.85, 1.48, 0.07, 'rail_silver')
    m.shop_sign_quad(u_sign, 5.31, 0.16, 3.75, 1.42, sign_key, double_sided=False)
    if m.detail:
        for sb in (-1.25, 1.25):
            m.beam([u_sign + sb, arm_y, 0.02], [u_sign + sb, 6.70, 0.10], 0.035, 'rail_silver', sections=4)
            m.box(u_sign + sb, arm_y, 0.0, 0.12, 0.24, 0.24, 'rail_base')
        for ry in (5.58, 6.42):
            m.box(u_sign, ry, 0.06, 3.60, 0.055, 0.04, 'rail_base')

    u_l = arm_end * 0.72
    u_r = arm_end * 0.91
    u_spd = arm_end * 0.815
    for lx, face_key in ((u_l, 'signal_main_l'), (u_r, 'signal_main_r')):
        m.box(lx, 5.30, 0.15, 0.46, 1.38, 0.30, 'signal_black')
        m.shop_sign_quad(lx, 5.33, 0.315, 0.42, 1.32, face_key, double_sided=False)
        if m.detail:
            m.beam([lx, arm_y, 0.02], [lx, 6.62, 0.14], 0.035, 'rail_silver', sections=4)
            m.box(lx, arm_y, 0.0, 0.11, 0.24, 0.24, 'rail_base')
            for vy in (6.46, 6.04, 5.62):
                m.box(lx, vy, 0.40, 0.32, 0.035, 0.22, 'signal_black')
                m.box(lx - 0.145, vy - 0.11, 0.38, 0.03, 0.19, 0.16, 'signal_black')
                m.box(lx + 0.145, vy - 0.11, 0.38, 0.03, 0.19, 0.16, 'signal_black')
    m.box(u_spd, arm_y, 0.02, 0.12, 0.24, 0.22, 'rail_base')
    m.box(u_spd, 5.74, 0.11, 0.54, 0.54, 0.08, 'rail_silver')
    m.shop_sign_quad(u_spd, 5.75, 0.16, 0.50, 0.50, 'speed_50', double_sided=False)
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _bike_signal_post(m: ShizijieBuilder, x: float, z: float, yaw: float):
    """Dedicated 3.45m non-motor bicycle traffic signal post with vertical bike lamps + countdown."""
    m.pose = (x, 0.0, z, yaw)
    m.box(0.0, -0.08, 0.0, 0.32, 0.16, 0.32, 'rail_base', collide=True)
    m.cylinder_y(0.0, 0.04, 3.40, 0.0, 0.075, 'rail_silver', sections=8 if m.detail else 5, collide=True)
    m.box(0.0, 2.74, 0.11, 0.72, 0.68, 0.22, 'signal_black')
    m.shop_sign_quad(0.0, 2.76, 0.23, 0.68, 0.64, 'signal_bike_pair', double_sided=False)
    m.box(0.0, 2.34, 0.11, 0.66, 0.38, 0.18, 'signal_black')
    m.shop_sign_quad(0.0, 2.36, 0.21, 0.62, 0.34, 'signal_bike_cd', double_sided=False)
    if m.detail:
        for hx in (-0.17, 0.17):
            for vy in (3.28, 2.98):
                m.box(hx, vy, 0.29, 0.24, 0.03, 0.14, 'signal_black')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _roadside_direction_sign(m: ShizijieBuilder, x: float, z: float, yaw: float, sign_key: str = 'road_side_main'):
    """Twin-post municipal blue direction sign (bottom 2.32m, top 4.26m, rear structural channels)."""
    m.pose = (x, 0.0, z, yaw)
    for sx in (-0.98, 0.98):
        m.box(sx, -0.08, 0.0, 0.28, 0.16, 0.28, 'rail_base', collide=True)
        m.cylinder_y(sx, 0.04, 4.38, 0.0, 0.072, 'rail_silver', sections=8 if m.detail else 5, collide=True)
    m.box(0.0, 2.32, 0.05, 2.86, 1.94, 0.07, 'rail_silver')
    m.shop_sign_quad(0.0, 2.35, 0.095, 2.78, 1.88, sign_key, double_sided=False)
    if m.detail:
        for ry in (2.58, 3.28, 3.98):
            m.box(0.0, ry, -0.02, 2.66, 0.06, 0.04, 'rail_silver')
            for sx in (-0.98, 0.98):
                m.box(sx, ry - 0.02, 0.0, 0.18, 0.10, 0.18, 'rail_base')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _street_name_plate(m: ShizijieBuilder, x: float, z: float, yaw: float, sign_key: str):
    """Municipal T-shaped street-name plate (bottom 2.18m, top 2.58m)."""
    m.pose = (x, 0.0, z, yaw)
    m.box(0.0, -0.08, 0.0, 0.24, 0.14, 0.24, 'rail_base', collide=True)
    m.cylinder_y(0.0, 0.02, 2.60, 0.0, 0.052, 'rail_silver', sections=7 if m.detail else 5, collide=True)
    m.box(0.0, 2.18, 0.0, 1.32, 0.42, 0.04, 'rail_silver')
    m.shop_sign_quad(0.0, 2.20, 0.028, 1.28, 0.38, sign_key, double_sided=True, back_offset=0.056)
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _underpass_guide_sign(m: ShizijieBuilder, x: float, z: float, yaw: float):
    """Restrained blue-and-white pedestrian underpass entry guide plaque (bottom 2.22m)."""
    m.pose = (x, 0.0, z, yaw)
    m.box(0.0, -0.08, 0.0, 0.26, 0.16, 0.26, 'rail_base', collide=True)
    m.cylinder_y(0.0, 0.02, 2.94, 0.0, 0.06, 'rail_silver', sections=7 if m.detail else 5, collide=True)
    m.box(0.0, 2.22, 0.0, 1.62, 0.56, 0.05, 'rail_silver')
    m.shop_sign_quad(0.0, 2.24, 0.032, 1.56, 0.52, 'sign_underpass', double_sided=True, back_offset=0.064)
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _guardrail_run(
    m: ShizijieBuilder,
    p0,
    p1,
    style: str = 'ped_white',
    collide: bool = True,
    coll_w: float = 0.014,
    banner_spans: tuple = (),
    base_y: float = 0.0,
):
    """See-through municipal guardrail segmented along terrain slope with crisp LOD0 detail and light LOD1."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    if length < 1e-3:
        return
    yaw = math.atan2(dx, dz)

    if style == 'ped_white':
        h, mat = 1.08, 'rail_white'
    elif style == 'planter_green':
        h, mat = 0.62, 'rail_green'
    else:
        h, mat = 0.94, 'rail_silver'

    if length < 0.02:
        if m.detail and collide:
            m.pose = ((p0[0] + p1[0]) * 0.5, base_y, (p0[1] + p1[1]) * 0.5, yaw)
            m.coll_box(0.0, -0.08, 0.0, coll_w, h + 0.12, length + 0.04)
            m.pose = (0.0, 0.0, 0.0, 0.0)
        return

    # LOD1: lightweight long-span rail + sparse posts (cuts far-field tris by >8x)
    if not m.detail:
        segs = max(1, round(length / 4.8))
        seg_len = length / segs
        bar_len = max(0.02, seg_len - 0.02)
        for s_idx in range(segs):
            mx = p0[0] + dx * (s_idx + 0.5) / segs
            mz = p0[1] + dz * (s_idx + 0.5) / segs
            m.pose = (mx, base_y, mz, yaw)
            m.box(0.0, 0.08, 0.0, 0.044, 0.048, bar_len, mat)
            m.box(0.0, h - 0.055, 0.0, 0.046, 0.052, bar_len, mat)
            if seg_len >= 0.15:
                m.v_bar(0.0, -0.02, h + 0.04, -seg_len * 0.5, 0.068, 0.068, mat)
                if s_idx == segs - 1:
                    m.v_bar(0.0, -0.02, h + 0.04, seg_len * 0.5, 0.068, 0.068, mat)
        m.pose = (0.0, 0.0, 0.0, 0.0)
        return

    # LOD0: finely segmented see-through posts, plinths, rails & pickets / open Guilin medallions
    segs = max(1, round(length / 2.25))
    seg_len = length / segs
    bar_len = max(0.02, seg_len - 0.02)
    for s_idx in range(segs):
        mx = p0[0] + dx * (s_idx + 0.5) / segs
        mz = p0[1] + dz * (s_idx + 0.5) / segs
        m.pose = (mx, base_y, mz, yaw)

        if collide:
            m.coll_box(0.0, -0.08, 0.0, coll_w, h + 0.12, seg_len + 0.04)

        m.box(0.0, 0.08, 0.0, 0.045, 0.048, bar_len, mat)
        m.box(0.0, h - 0.055, 0.0, 0.048, 0.055, bar_len, mat)

        if seg_len >= 0.15:
            post_zs = (-seg_len * 0.5, seg_len * 0.5) if s_idx == segs - 1 else (-seg_len * 0.5,)
            for lz in post_zs:
                m.box(0.0, -0.06, lz, 0.16, 0.13, 0.22, 'rail_base')
                m.v_bar(0.0, -0.02, h + 0.04, lz, 0.068, 0.068, mat)

        if style == 'ped_white':
            n_pickets = 5 if seg_len >= 1.2 else max(0, min(4, round(seg_len / 0.38) - 1))
            for pi in range(1, n_pickets + 1):
                pz = -seg_len * 0.5 + (pi / (n_pickets + 1)) * seg_len
                m.v_bar(0.0, 0.085, h - 0.135, pz, 0.024, 0.024, mat)
            if s_idx in banner_spans and seg_len >= 1.4:
                m.box(0.0, 0.54, 0.0, 0.04, 0.44, min(1.30, seg_len - 0.3), 'rail_white')
                m.pose = (mx + math.cos(yaw) * 0.028, base_y, mz - math.sin(yaw) * 0.028, yaw + math.pi * 0.5)
                m.shop_sign_quad(0.0, 0.56, 0.005, min(1.24, seg_len - 0.36), 0.40, 'sign_rail_banner', double_sided=True, back_offset=0.066)
                m.pose = (mx, base_y, mz, yaw)
        elif style == 'planter_green':
            n_pickets = 4 if seg_len >= 1.2 else max(0, min(3, round(seg_len / 0.45) - 1))
            for pi in range(1, n_pickets + 1):
                pz = -seg_len * 0.5 + (pi / (n_pickets + 1)) * seg_len
                m.v_bar(0.0, 0.085, h - 0.135, pz, 0.022, 0.022, mat)
        elif seg_len >= 0.70:
            # Open Guilin medallion center diamond/circle frame welded to top rail (floor=-0.06 -> 0 floating risk)
            mid_y = 0.715
            top_y = h - 0.055
            bot_y = 0.54
            m.v_bar(0.0, 0.085, h - 0.135, -seg_len * 0.28, 0.026, 0.026, mat)
            m.v_bar(0.0, 0.085, h - 0.135, seg_len * 0.28, 0.026, 0.026, mat)
            for sgn in (-1.0, 1.0):
                for p_a, p_b in (((0.0, top_y, 0.0), (0.0, mid_y, sgn * 0.16)),
                                 ((0.0, mid_y, sgn * 0.16), (0.0, bot_y, 0.0))):
                    m.beam(p_a, p_b, 0.018, mat, sections=3)
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _guardrail_polyline(m: ShizijieBuilder, pts, safe_zone=None, **kwargs):
    """Emit continuous see-through guardrail segments along a 2D polyline (optionally clipped strictly to safe_zone)."""
    if len(pts) < 2:
        return
    lines = [LineString(pts)]
    if safe_zone is not None:
        clipped = lines[0].intersection(safe_zone)
        lines = [g for g in get_parts(clipped) if g.geom_type in ('LineString', 'LinearRing') and g.length >= 1.1]
    for ls in lines:
        c = list(ls.coords)
        for a, b in zip(c, c[1:]):
            _guardrail_run(m, a, b, **kwargs)


def _planted_street_tree(m: ShizijieBuilder, x: float, z: float, height: float = 8.4, spread: float = 3.4, whitewash: bool = False):
    """Camphor street tree inside a grounded granite tree pit + dark iron grate (branch clearance >= 2.65m)."""
    m.pose = (x, 0.0, z, 0.0)
    m.box(0.0, -0.06, 0.0, 1.46, 0.20, 1.46, 'granite_curb', collide=True)
    m.box(0.0, 0.08, 0.0, 1.18, 0.075, 1.18, 'tree_grate')
    trunk_h = max(2.95, height * 0.38)
    canopy_core_h = trunk_h + height * 0.28
    if whitewash:
        m.cylinder_y(0.0, -0.02, 1.18, 0.0, 0.23, 'bark_lime', sections=8 if m.detail else 5, collide=True)
        m.cylinder_y(0.0, 1.12, canopy_core_h - 1.12, 0.0, 0.19, 'bark_camphor', sections=8 if m.detail else 5)
    else:
        m.cylinder_y(0.0, -0.02, canopy_core_h + 0.04, 0.0, 0.21, 'bark_camphor', sections=8 if m.detail else 5, collide=True)

    lobes = [(0.0, trunk_h + height * 0.25, 0.0, spread * 0.54, height * 0.27, 'foliage_dark')]
    if m.detail:
        for i in range(5):
            ang = i * (math.pi * 0.4) + 0.35 + (x * 0.07)
            lobes.append((
                math.cos(ang) * spread * 0.24,
                trunk_h + height * (0.21 + 0.05 * (i % 2)),
                math.sin(ang) * spread * 0.24,
                spread * 0.37,
                height * 0.21,
                'foliage_mid' if i % 2 == 0 else 'foliage_dark',
            ))
    ico_hi = trimesh.creation.icosphere(subdivisions=3 if m.detail else 1)
    ico_lo = trimesh.creation.icosphere(subdivisions=2 if m.detail else 1)
    for li, (bx, by, bz, br, bh, mat) in enumerate(lobes):
        ico = ico_hi if li == 0 else ico_lo
        v = ico.vertices.copy()
        if m.detail:
            seed = x * 0.13 + z * 0.17 + li * 1.9
            noise = 1.0 + 0.055 * np.sin(v[:, 0] * 2.4 + v[:, 2] * 2.1 + seed) + 0.035 * np.cos(v[:, 1] * 2.8 - v[:, 0] * 1.9)
            v *= noise[:, None]
        v[:, 1] = np.maximum(v[:, 1], -0.92)
        v[:, 0] = v[:, 0] * br + bx
        v[:, 1] = v[:, 1] * bh + by
        v[:, 2] = v[:, 2] * br + bz
        m.foliage_mesh(v, ico.faces, mat, smooth_center=(bx, by - bh * 0.12, bz))
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _shrub_mound(m: ShizijieBuilder, x: float, y_base: float, z: float, rx: float, ry: float, rz: float, mat: str):
    """Organic bumpy foliage/flowering mound seated firmly in planter mulch (0 flat prism boxes)."""
    ico = trimesh.creation.icosphere(subdivisions=2)
    v = ico.vertices.copy()
    seed = x * 0.31 + z * 0.27
    noise = 1.0 + 0.08 * np.sin(v[:, 0] * 2.7 + v[:, 2] * 2.9 + seed) + 0.05 * np.cos(v[:, 1] * 3.1 + v[:, 0] * 2.1)
    v *= noise[:, None]
    v[:, 1] = np.maximum(v[:, 1], -0.22)
    v[:, 0] = v[:, 0] * rx + x
    v[:, 1] = (v[:, 1] + 0.22) * ry + y_base
    v[:, 2] = v[:, 2] * rz + z
    m.foliage_mesh(v, ico.faces, mat, smooth_center=(x, y_base, z))


def _populate_planter_shrubs(m: ShizijieBuilder, curb_poly, y_base: float, flower_mat: str, step: float = 1.15):
    """Scatter dense multi-tier shrubs and blossoms kept strictly inside curb_poly top (0 overhangs)."""
    minx, minz, maxx, maxz = curb_poly.bounds
    nx = max(1, int((maxx - minx) / step) + 1)
    nz = max(1, int((maxz - minz) / step) + 1)
    idx = 0
    for ix in range(nx):
        px0 = minx + (ix + 0.5) * (maxx - minx) / nx
        for iz in range(nz):
            pz0 = minz + (iz + 0.5) * (maxz - minz) / nz
            jx = px0 + math.sin(ix * 1.9 + iz * 2.7) * step * 0.18
            jz = pz0 + math.cos(ix * 2.3 - iz * 1.7) * step * 0.18
            pt = Point(jx, jz)
            if not curb_poly.contains(pt):
                continue
            d_edge = curb_poly.boundary.distance(pt)
            if d_edge < 0.20:
                continue
            max_r = (d_edge - 0.04) / 1.22
            tier = (ix * 3 + iz * 5 + idx) % 4
            if tier == 0:
                r = min(0.52, max_r)
                _shrub_mound(m, jx, y_base, jz, r, min(0.38, 0.18 + r * 0.36), r, flower_mat)
            elif tier == 1:
                r = min(0.58, max_r)
                _shrub_mound(m, jx, y_base, jz, r, min(0.34, 0.16 + r * 0.32), r, 'foliage_mid')
            else:
                r = min(0.62, max_r)
                _shrub_mound(m, jx, y_base, jz, r, min(0.32, 0.16 + r * 0.30), r, 'foliage_dark')
            idx += 1
    if idx == 0:
        rp = curb_poly.representative_point()
        d_rp = curb_poly.boundary.distance(rp)
        if d_rp >= 0.18:
            r = min(0.56, (d_rp - 0.04) / 1.22)
            _shrub_mound(m, rp.x, y_base, rp.y, r, 0.32, r, 'foliage_dark')
            _shrub_mound(m, rp.x, y_base, rp.y, r * 0.72, 0.36, r * 0.72, flower_mat)


def _build_island_landscaping(m: ShizijieBuilder, u_road0, u_sw):
    """Build granite curbed planters, layered organic shrubs/flowers, and clean single perimeter rails on all 4 islands."""
    kiosk_excl = Point(*KIOSK_CENTER).buffer(3.25)
    for corner, island in enumerate(islands()):
        safe_area = island.difference(u_sw.buffer(0.22)).difference(u_road0.buffer(0.12))
        if corner == 1:
            safe_area = safe_area.difference(kiosk_excl)
        for part in [p for p in get_parts(safe_area) if p.area >= 2.0]:
            curb = part.buffer(-0.20, join_style='mitre') if part.area > 12.0 else part.buffer(-0.10)
            curb = max(get_parts(curb), key=lambda g: g.area) if not curb.is_empty else part
            if curb.area < 1.5:
                continue
            curb_poly = curb.simplify(0.22 if m.detail else 0.55, preserve_topology=True)
            if curb_poly.is_empty or curb_poly.geom_type != 'Polygon':
                continue
            m.prism_polygon(curb_poly, -0.06, 0.40, 'granite_curb', collide=True, cap_mat='soil_mulch')
            if not m.detail:
                continue
            flower_mat = 'flower_red' if corner in (0, 2) else 'flower_boug'
            _populate_planter_shrubs(m, curb_poly, 0.30, flower_mat, step=1.18 if curb_poly.area > 16.0 else 0.90)

        safe_isl_rail = island.difference(u_sw.buffer(0.22)).difference(u_road0.buffer(0.12))
        if corner == 1:
            safe_isl_rail = safe_isl_rail.difference(kiosk_excl)
        for p in get_parts(safe_isl_rail):
            if p.area < 2.2:
                continue
            shrunk = p.buffer(-0.10).simplify(0.25 if m.detail else 0.55)
            for sub in get_parts(shrunk):
                if not hasattr(sub, 'exterior') or sub.area < 1.8:
                    continue
                _guardrail_polyline(
                    m,
                    list(sub.exterior.coords),
                    safe_zone=safe_isl_rail,
                    style='median_arch',
                    collide=True,
                    coll_w=0.014,
                )


def _build_median_planter_strip(m: ShizijieBuilder, zone_poly, rail_style: str, rail_pts):
    """Build a procedurally clipped granite-curb + organic shrub/blossom median bed inside a road/sw void."""
    if not zone_poly.is_empty and zone_poly.area >= 2.2:
        best = max(get_parts(zone_poly), key=lambda g: g.area)
        if best.area >= 2.2:
            med_poly = best.simplify(0.25 if m.detail else 0.55, preserve_topology=True)
            if not med_poly.is_empty and med_poly.geom_type == 'Polygon':
                m.prism_polygon(med_poly, -0.06, 0.40, 'granite_curb', collide=True, cap_mat='soil_mulch')
                if m.detail:
                    _populate_planter_shrubs(m, med_poly, 0.30, 'flower_boug', step=0.95)
    _guardrail_polyline(m, rail_pts, safe_zone=zone_poly, style=rail_style, collide=True, coll_w=0.014)


def _deploy_sidewalk_and_median_guardrails(m: ShizijieBuilder, u_road0, u_sw, u_cycle):
    """Enclose outer approach sidewalks + central medians cleanly with zero road0/sw overlap budget violations."""
    core_box = box(-76.0, -72.0, 112.0, 72.0)
    divider_box = box(-62.0, -58.0, 68.0, 54.0)
    corner_r0_box = box(-44.0, -32.0, 44.0, 40.0)
    ebike_open_box = box(88.5, -4.0, 108.0, 26.0)
    culture_alley_box = box(85.5, 36.0, 103.5, 52.0)
    nikoniko_zone = box(-140.0, 10.0, -61.5, 95.0)
    roadside_excl = unary_union([ebike_open_box, culture_alley_box, nikoniko_zone])
    # Strictly inside cycle lane and >=12cm away from sw & >=9cm away from road0 -> 0.00 m2 audit overlap
    safe_cycle = u_cycle.difference(u_sw.buffer(0.12)).difference(u_road0.buffer(0.09))
    safe_curb_outer = core_box.difference(u_sw.buffer(0.02)).difference(u_road0.buffer(0.04))
    street_union = unary_union([u_road0, u_cycle])

    for sw_poly in get_parts(u_sw.intersection(core_box)):
        if sw_poly.area < 36.0:
            continue
        is_divider_island = sw_poly.area < 155.0 and sw_poly.boundary.intersection(u_road0.buffer(0.16)).length > 18.0
        b_cy = sw_poly.boundary.intersection(u_cycle.buffer(0.16)).difference(roadside_excl)
        if is_divider_island:
            b_cy = b_cy.intersection(divider_box)
        b_r0 = (
            sw_poly.boundary.intersection(u_road0.buffer(0.16))
            .difference(u_cycle.buffer(0.16))
            .difference(roadside_excl)
            .intersection(corner_r0_box)
        )

        sw_emitted = []
        for is_cycle_side, geom in ((True, b_cy), (False, b_r0)):
            if not is_cycle_side and is_divider_island:
                continue
            raw_lines = [g for g in get_parts(geom) if g.geom_type in ('LineString', 'LinearRing') and g.length > 0.4]
            if not raw_lines:
                continue
            merged = linemerge(raw_lines)
            for ls in get_parts(merged):
                if ls.length < 3.0:
                    continue
                simp = ls.simplify(0.20 if m.detail else 0.50, preserve_topology=False)
                coords = list(simp.coords)
                shifted = []
                offset_dist = 0.16 if is_cycle_side else 0.0
                for idx, (cx, cz) in enumerate(coords):
                    p_prev = coords[max(0, idx - 1)]
                    p_next = coords[min(len(coords) - 1, idx + 1)]
                    tx, tz = p_next[0] - p_prev[0], p_next[1] - p_prev[1]
                    tlen = math.hypot(tx, tz) or 1.0
                    nx, nz = -tz / tlen, tx / tlen
                    if offset_dist:
                        c_pos = Point(cx + nx * offset_dist, cz + nz * offset_dist)
                        c_neg = Point(cx - nx * offset_dist, cz - nz * offset_dist)
                        if safe_cycle.contains(c_pos):
                            shifted.append((c_pos.x, c_pos.y))
                        elif safe_cycle.contains(c_neg):
                            shifted.append((c_neg.x, c_neg.y))
                        elif not u_sw.contains(c_pos):
                            shifted.append((c_pos.x, c_pos.y))
                        else:
                            shifted.append((c_neg.x, c_neg.y))
                    else:
                        shifted.append((cx, cz))
                is_sw_front = any(-48.0 < px < -32.0 and 16.0 < pz < 44.0 for px, pz in shifted)
                banners = (1, 2) if (is_sw_front and not is_divider_island) else ()
                _guardrail_polyline(
                    m,
                    shifted,
                    safe_zone=safe_cycle if is_cycle_side else None,
                    style='median_arch' if is_divider_island else 'ped_white',
                    collide=True,
                    coll_w=0.014 if is_cycle_side else 0.008,
                    banner_spans=banners,
                )
                line_geom = LineString(shifted)
                clipped_rec = line_geom.intersection(safe_cycle) if is_cycle_side else line_geom
                for rec_part in get_parts(clipped_rec):
                    if rec_part.geom_type in ('LineString', 'LinearRing') and rec_part.length >= 1.1:
                        sw_emitted.append(rec_part)

        # Seal remaining outer-sidewalk verge/transition curb gaps cleanly (0 road0/sw overlap, continuous enclosure)
        if not is_divider_island and sw_poly.area >= 48.0:
            curb_all = sw_poly.boundary.intersection(street_union.buffer(0.45)).difference(roadside_excl)
            curb_gaps = curb_all.difference(unary_union(sw_emitted).buffer(0.18)) if sw_emitted else curb_all
            raw_gaps = [g for g in get_parts(curb_gaps) if g.geom_type in ('LineString', 'LinearRing') and g.length > 0.35]
            if raw_gaps:
                for ls in get_parts(linemerge(raw_gaps)):
                    if ls.length < 0.6:
                        continue
                    coords = list(ls.simplify(0.20 if m.detail else 0.50, preserve_topology=False).coords)
                    shifted = []
                    for idx, (cx, cz) in enumerate(coords):
                        p_prev = coords[max(0, idx - 1)]
                        p_next = coords[min(len(coords) - 1, idx + 1)]
                        tx, tz = p_next[0] - p_prev[0], p_next[1] - p_prev[1]
                        tlen = math.hypot(tx, tz) or 1.0
                        nx, nz = -tz / tlen, tx / tlen
                        chosen = None
                        for off in (0.10, 0.06, 0.03):
                            c_pos = Point(cx + nx * off, cz + nz * off)
                            c_neg = Point(cx - nx * off, cz - nz * off)
                            if safe_curb_outer.contains(c_pos):
                                chosen = (c_pos.x, c_pos.y)
                                break
                            if safe_curb_outer.contains(c_neg):
                                chosen = (c_neg.x, c_neg.y)
                                break
                        if chosen is None:
                            c_pos = Point(cx + nx * 0.04, cz + nz * 0.04)
                            c_neg = Point(cx - nx * 0.04, cz - nz * 0.04)
                            chosen = (c_pos.x, c_pos.y) if not u_sw.contains(c_pos) else (c_neg.x, c_neg.y)
                        shifted.append(chosen)
                    if len(shifted) >= 2:
                        a0, a1 = shifted[0], shifted[1]
                        la = math.hypot(a1[0] - a0[0], a1[1] - a0[1]) or 1.0
                        ext0 = (a0[0] - (a1[0] - a0[0]) / la * 0.16, a0[1] - (a1[1] - a0[1]) / la * 0.16)
                        if safe_curb_outer.contains(Point(ext0)):
                            shifted[0] = ext0
                        b0, b1 = shifted[-2], shifted[-1]
                        lb = math.hypot(b1[0] - b0[0], b1[1] - b0[1]) or 1.0
                        ext1 = (b1[0] + (b1[0] - b0[0]) / lb * 0.16, b1[1] + (b1[1] - b0[1]) / lb * 0.16)
                        if safe_curb_outer.contains(Point(ext1)):
                            shifted[-1] = ext1
                    sealed = LineString(shifted).intersection(safe_curb_outer)
                    for part in get_parts(sealed):
                        if part.geom_type in ('LineString', 'LinearRing') and part.length >= 0.45:
                            _guardrail_polyline(
                                m,
                                list(part.coords),
                                safe_zone=None,
                                style='ped_white',
                                collide=True,
                                coll_w=0.014,
                            )

    forbidden = unary_union([u_road0, u_sw])
    north_med_zone = box(4.0, -56.0, 18.0, -17.0).difference(forbidden.buffer(0.18))
    north_med_zone = north_med_zone.intersection(LineString([(5.2, -17.6), (16.2, -53.5)]).buffer(0.55))
    _build_median_planter_strip(m, north_med_zone, 'median_arch', [(5.2, -18.0), (17.5, -57.5)])

    west_med_zone = box(-68.5, -28.0, -37.0, -21.0).difference(forbidden.buffer(0.22))
    _build_median_planter_strip(m, west_med_zone, 'median_arch', [(-46.5, -24.4), (-66.0, -27.2)])


def build_shizijie(m: ShizijieBuilder):
    m.surface = landmark_surface('shizijie')
    u_road0, u_sw, u_cycle = street_masks()
    # ------------------------------------------------------------------
    # 1. Refuge islands, real see-through guardrails, landscaping, signals & signs
    # (Center of intersection around (0, 0) is completely clear asphalt, ZERO crosswalks.)
    # ------------------------------------------------------------------
    m.follow_grade = True
    _build_island_landscaping(m, u_road0, u_sw)
    _deploy_sidewalk_and_median_guardrails(m, u_road0, u_sw, u_cycle)

    # Four incoming-traffic cantilevered signal gantries (pole grounded cleanly outside road0/sw)
    _signal_gantry(m, 6.5, -22.2, yaw=math.atan2(0.28, -0.96), arm_sign=1, span=8.8, sign_key='road_n_in')
    _signal_gantry(m, 6.95, 42.48, yaw=math.atan2(-0.35, 0.94), arm_sign=-1, span=9.2, sign_key='road_s_in')
    _signal_gantry(m, -48.44, 15.50, yaw=math.atan2(-0.98, -0.22), arm_sign=-1, span=10.6, sign_key='road_w_in')
    _signal_gantry(m, 32.5, -1.0, yaw=math.atan2(0.97, 0.24), arm_sign=-1, span=9.2, sign_key='road_e_in')

    # Four non-motor bicycle traffic signals with dual digital countdowns at colored bike lane corners
    _bike_signal_post(m, -33.06, 19.14, yaw=math.atan2(-0.98, -0.22))
    _bike_signal_post(m, 38.00, -8.00, yaw=math.atan2(0.97, 0.24))
    _bike_signal_post(m, -38.00, -24.50, yaw=math.atan2(0.28, -0.96))
    _bike_signal_post(m, 21.60, 24.80, yaw=math.atan2(-0.35, 0.94))

    # Roadside twin-post direction signs (placed cleanly in safe curb/verge zones)
    _roadside_direction_sign(m, 16.96, 34.73, yaw=math.atan2(-0.35, 0.94), sign_key='road_side_main')
    _roadside_direction_sign(m, -56.35, -25.43, yaw=math.atan2(-0.98, -0.22), sign_key='road_w_in')

    # Municipal street-name T-plates + restrained pedestrian underpass guide plaques
    _street_name_plate(m, -8.44, -41.55, yaw=math.atan2(0.28, -0.96), sign_key='street_zhongshan')
    _street_name_plate(m, -48.0, 18.0, yaw=math.atan2(-0.98, -0.22), sign_key='street_jiefang_w')
    _street_name_plate(m, 48.0, 2.0, yaw=math.atan2(0.97, 0.24), sign_key='street_jiefang_e')
    _underpass_guide_sign(m, -40.50, 27.00, yaw=math.atan2(0.80, -0.60))
    _underpass_guide_sign(m, -49.50, -29.50, yaw=math.atan2(0.20, 0.98))

    # NE Corner '桂林交警' blue-and-white police kiosk (centered inside island[1] at KIOSK_CENTER)
    m.pose = (KIOSK_CENTER[0], 0.0, KIOSK_CENTER[1], -0.55)
    m.box(0, -0.10, 0, 2.86, 0.22, 2.36, 'granite_curb', collide=True)
    m.box(0, 0.08, 0, 2.70, 2.68, 2.20, 'white', collide=True)
    m.box(0, 1.00, 1.12, 2.05, 1.18, 0.08, 'glass')
    m.box(0, 0.10, 1.11, 2.22, 0.84, 0.08, 'blue')
    m.box(0, 2.40, 0, 3.05, 0.44, 2.55, 'blue')
    m.box(0, 2.84, 0, 3.22, 0.14, 2.70, 'alum')
    m.sign_quad(0, 2.41, 1.29, 2.80, 0.42, 'police_sign')
    if m.detail:
        m.cylinder_y(-0.72, 2.98, 0.20, 0.46, 0.12, 'red_lit', sections=6)
        m.cylinder_y(0.72, 2.98, 0.20, 0.46, 0.12, 'blue_lit', sections=6)
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # ------------------------------------------------------------------
    # 2. NW Corner Building: Nanfang Mansion (南方大厦, way/691576459)
    # ------------------------------------------------------------------
    nw_apron = [
        (-87.0, -40.5), (-42.0, -30.5), (-22.0, -41.5), (-8.5, -49.5),
        (5.0, -100.5), (-50.5, -117.5),
    ]
    m.follow_grade = False
    civic_plaza(m, nw_apron)
    m.prism(NW_NANFANG, -2.0, 6.8, 'dark', collide=True, cap_mat='alum', footing=True)
    m.prism(NW_NANFANG, 4.8, 20.4, 'white', collide=True, cap_mat='roof')
    m.cylinder_y(-24.5, 4.8, 22.4, -46.0, 9.6, 'glass', sections=16 if m.detail else 8, collide=True)
    m.cylinder_y(-24.5, 27.2, 2.2, -46.0, 8.8, 'white', sections=16 if m.detail else 8)
    m.pose = (-24.5, 27.5, -46.0, math.atan2(1.0, 1.1))
    m.box(0, 0, 8.46, 6.6, 1.65, 1.34, 'dark')
    m.sign_quad(0, 0.05, 9.10, 6.4, 1.55, 'nanfang_roof')
    m.pose = (0.0, 0.0, 0.0, 0.0)
    _commercial_strip(m, (-84.57, -42.86), (-44.98, -33.52), 1, 4.8, 25.2, 'white', 0, 7)
    _commercial_strip(m, (-11.67, -51.43), (1.66, -98.94), 1, 4.8, 25.2, 'white', 3, 8)

    # ------------------------------------------------------------------
    # 3. SE Corner Building: Cultural Mansion (文化大厦, way/266333052)
    # ------------------------------------------------------------------
    se_apron = [
        (4.0, 92.5), (67.5, 108.5), (85.5, 52.5), (48.0, 42.5),
        (32.0, 61.5), (10.5, 62.0),
    ]
    civic_plaza(m, se_apron)
    m.prism(SE_WENHUA, -2.0, 6.6, 'dark', collide=True, cap_mat='beige', footing=True)
    m.prism(SE_WENHUA, 4.6, 18.0, 'beige', collide=True, cap_mat='roof')
    m.cylinder_y(34.5, 4.6, 19.2, 60.5, 10.2, 'glass', sections=16 if m.detail else 8, collide=True)
    m.cylinder_y(34.5, 23.8, 1.6, 60.5, 10.6, 'beige', sections=16 if m.detail else 8)
    m.pose = (34.5, 25.4, 60.5, math.atan2(-0.85, -1.0))
    m.box(0, 0, 9.8, 6.4, 1.55, 0.24, 'dark')
    m.sign_quad(0, 0.05, 9.95, 6.2, 1.45, 'wenhua_roof')
    m.pose = (0.0, 0.0, 0.0, 0.0)
    _commercial_strip(m, (13.90, 65.34), (7.28, 90.65), 1, 4.6, 22.6, 'beige', 2, 4)
    _commercial_strip(m, (82.39, 54.74), (50.92, 46.35), 1, 4.6, 22.6, 'beige', 5, 6)
    _commercial_strip(m, (69.26, 102.78), (82.39, 54.74), 1, 4.6, 22.6, 'beige', 1, 7)

    # ------------------------------------------------------------------
    # 4. NE Corner Block & East Jiefang Wing (way/691576457, way/675759091)
    # ------------------------------------------------------------------
    # IDOK-127: Expand ne_apron south boundary outward by +6.2 m along NE_ANNEX normal so
    # civic_plaza() completely paves the gap between NE_ANNEX south wall and OSM sidewalk
    # (auto-clipped against streets_mask so zero road/sidewalk overlap occurs).
    ne_apron = [
        (46.0, -45.5), (53.5, -23.0), (63.5, -7.5),
        (74.83, 7.17), (117.00, 17.12), (135.5, 16.5),
        (137.0, -2.5), (94.5, -78.5), (59.5, -87.0),
    ]
    civic_plaza(m, ne_apron, refine_outer=True)
    m.prism(NE_CORNER, -2.0, 6.4, 'dark', collide=True, cap_mat='alum', footing=True)
    m.prism(NE_CORNER, 4.4, 17.0, 'white', collide=True, cap_mat='roof')
    m.pose = (60.5, 0.0, -24.5, math.atan2(-1.0, 0.85))
    m.box(0, 21.4, 0, 14.0, 3.2, 12.0, 'alum')
    m.box(0, 24.6, 5.8, 8.6, 1.65, 0.24, 'dark')
    m.shop_sign_quad(0, 24.65, 5.95, 8.4, 1.55, 'ne_corner_roof')
    m.pose = (0.0, 0.0, 0.0, 0.0)
    _commercial_strip(m, (49.35, -43.56), (65.01, -10.57), 1, 4.4, 21.4, 'white', 4, 6)
    _commercial_strip(m, (61.23, -84.32), (49.35, -43.56), 1, 4.4, 21.4, 'white', 6, 7)

    m.prism(NE_ANNEX, -2.0, 4.5, 'dark', collide=True, cap_mat='beige', footing=True)
    m.prism(NE_ANNEX, 2.5, 12.3, 'white', collide=True, cap_mat='roof')
    _commercial_strip(m, (76.25, 1.14), (130.47, 13.93), 1, 4.2, 14.8, 'white', 1, 9, skip_bays=(3, 4))
    _build_ebike_flagship(m)

    # Sidewalk & island camphor street trees with tree grates + magnolia cluster lamps (follow_grade=True)
    m.follow_grade = True
    for tx, tz, th, tsp, lime in (
        (-91.29, -33.17, 10.5, 4.4, True),
        (-79.21, -30.99, 11.4, 4.5, True),
        (-75.07, -29.78, 11.6, 4.5, True),
        (-66.5, -31.8, 10.2, 4.2, True),
        (-59.5, -32.8, 9.8, 4.0, True),
        (-48.5, -30.8, 8.8, 3.6, False),
        (50.5, -18.0, 8.2, 3.3, False),
        (88.0, 6.5, 8.2, 3.3, True),
        (108.0, 11.2, 8.2, 3.3, True),
        (24.0, 56.5, 8.2, 3.3, False),
        (4.5, 74.0, 8.2, 3.3, False),
        (11.8, 26.2, 7.6, 3.1, False),
        (20.2, -10.5, 7.4, 3.0, False),
    ):
        _planted_street_tree(m, tx, tz, height=th, spread=tsp, whitewash=lime)
    if m.detail:
        for lx, lz in ((-38.0, -29.0), (45.0, -32.0), (68.0, 2.5), (19.5, 53.0)):
            m.cluster_lamp(lx, 0.0, lz, height=7.0, globes=5, collide=True)


def _export_shizijie():
    folder = Path(__file__).resolve().parents[2] / 'public/textures/landmarks/B'
    textures = {key: Image.open(folder / filename) for key, filename in (
        ('surfaces', 'surfaces.png'), ('glass', 'curtain_glass.png'),
        ('pave', 'plaza_pave.png'), ('signs', 'signs.png'))}
    shop_signs_img = _build_shizijie_shop_signs_sheet()
    szj_surf_img = _build_shizijie_surfaces_sheet()

    scene = trimesh.Scene()
    mat_surfaces = trimesh.visual.material.PBRMaterial(
        name='B_surfaces', baseColorTexture=textures['surfaces'],
        roughnessFactor=0.92, metallicFactor=0.04, doubleSided=True,
    )
    mat_signs = trimesh.visual.material.PBRMaterial(
        name='B_signs', baseColorTexture=textures['signs'],
        roughnessFactor=0.22, metallicFactor=0.26, doubleSided=True,
    )
    mat_shop_signs = trimesh.visual.material.PBRMaterial(
        name='shizijie_shop_signs', baseColorTexture=shop_signs_img,
        emissiveFactor=[0.09, 0.09, 0.09], roughnessFactor=0.50, metallicFactor=0.04, doubleSided=True,
    )
    mat_szj_surf = trimesh.visual.material.PBRMaterial(
        name='shizijie_surfaces', baseColorTexture=szj_surf_img,
        roughnessFactor=0.88, metallicFactor=0.10, doubleSided=True,
    )
    mat_lit = trimesh.visual.material.PBRMaterial(
        name='B_surfaces_lit', baseColorTexture=textures['surfaces'],
        emissiveFactor=[0.18, 0.16, 0.12], roughnessFactor=0.65, metallicFactor=0.05, doubleSided=True,
    )
    tiled_mats = {
        'glass': trimesh.visual.material.PBRMaterial(
            name='B_curtain_glass', baseColorTexture=textures['glass'],
            roughnessFactor=0.28, metallicFactor=0.35, doubleSided=True,
        ),
        'pave': trimesh.visual.material.PBRMaterial(
            name='B_plaza_pave', baseColorTexture=textures['pave'],
            roughnessFactor=0.95, metallicFactor=0.0, doubleSided=True,
        ),
    }

    def pack_tris(tri_list):
        verts = np.concatenate(tri_list, axis=0).reshape(-1, 3)
        faces = np.arange(len(verts), dtype=np.int64).reshape(-1, 3)
        return trimesh.Trimesh(vertices=verts, faces=faces, process=False)

    for lod in (0, 1):
        builder = ShizijieBuilder(detail=(lod == 0))
        build_shizijie(builder)
        layer = f'lod{lod}'
        scene.graph.update(frame_to=layer)

        if builder.visible:
            mesh = pack_tris(builder.visible)
            uv = np.concatenate(builder.uv, axis=0).reshape(-1, 2)
            mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat_surfaces)
            scene.add_geometry(mesh, node_name=f'{layer}_joinery', parent_node_name=layer)

        if builder.szj_surf_tris:
            mesh = pack_tris(builder.szj_surf_tris)
            uv = np.concatenate(builder.szj_surf_uv, axis=0).reshape(-1, 2)
            mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat_szj_surf)
            scene.add_geometry(mesh, node_name=f'{layer}_szj_surfaces', parent_node_name=layer)

        if builder.foliage_verts:
            fverts = np.concatenate(builder.foliage_verts, axis=0)
            fnorms = np.concatenate(builder.foliage_normals, axis=0)
            ffaces = np.concatenate(builder.foliage_faces, axis=0)
            fuv = np.concatenate(builder.foliage_uv, axis=0)
            fmesh = trimesh.Trimesh(vertices=fverts, faces=ffaces, vertex_normals=fnorms, process=False)
            fmesh.visual = trimesh.visual.TextureVisuals(uv=fuv, material=mat_szj_surf)
            scene.add_geometry(fmesh, node_name=f'{layer}_foliage', parent_node_name=layer)

        for key, parts in builder.tiled.items():
            if not parts:
                continue
            mesh = pack_tris([t for t, _ in parts])
            uv = np.concatenate([u for _, u in parts], axis=0).reshape(-1, 2)
            mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=tiled_mats[key])
            scene.add_geometry(mesh, node_name=f'{layer}_{key}', parent_node_name=layer)

        if builder.sign_tris:
            mesh = pack_tris(builder.sign_tris)
            uv = np.concatenate(builder.sign_uv, axis=0).reshape(-1, 2)
            mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat_signs)
            scene.add_geometry(mesh, node_name=f'{layer}_signs', parent_node_name=layer)

        if builder.shop_sign_tris:
            mesh = pack_tris(builder.shop_sign_tris)
            uv = np.concatenate(builder.shop_sign_uv, axis=0).reshape(-1, 2)
            mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat_shop_signs)
            scene.add_geometry(mesh, node_name=f'{layer}_shop_signs', parent_node_name=layer)

        if builder.lit_tris:
            mesh = pack_tris(builder.lit_tris)
            uv = np.concatenate(builder.lit_uv, axis=0).reshape(-1, 2)
            mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat_lit)
            scene.add_geometry(mesh, node_name=f'{layer}_lit', parent_node_name=layer)

        if lod == 0 and builder.solid:
            coll = pack_tris(builder.solid)
            scene.add_geometry(coll, node_name='collision_surface')

    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    scene.export(out_dir / 'shizijie.glb', include_normals=True)


if __name__ == '__main__':
    _export_shizijie()
