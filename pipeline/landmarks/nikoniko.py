"""Guilin Weixiaotang Plaza (桂林微笑堂商厦), OSM way/253743030 (~109 x 99 m).

Position, footprint and orientation follow OSM way/253743030 anchored at its
polygon centroid (-974.91, -121.59). Heights are estimated from 1.7 m
pedestrians and 4.2 m double-decker buses in 2019 Wikimedia Commons (CC0) and
2024–2025 aerial/street views: 6-storey retail wings 23.6 m (ground 4.8 m + five
3.76 m upper floors), flanking silver-grey aluminum stair pylons 27.0 m,
stepped corner glass cylinder 30.2 m, and white rooftop crown sign drum 35.0 m.

Shared Group-B procedural textures (public/textures/landmarks/B/) sample hues
from reference photos while keeping low-saturation harmony with docs/style.md:
- curtain_glass.png: #3c657a..#6791a5 blue-teal curtain glass, #283f4d spandrel
- plaza_pave.png: #b4b2aa / #9ea1a4 staggered granite & bluestone slabs
- signs.png: 1024x1024 CJK/Latin signage atlas rendered via system CJK fonts +
  dark glossy SMD LED screen panel (#0d131b..#172331 with sky-sheen highlight)
- surfaces.png: 1024x1024 4x4 procedural swatch sheet (aluminum #c7ccd0,
  warm white #eae5db, beige stone #d5cab7, dark granite #44494e, Shizijie red
  #b84a42 & yellow #cfa346 pavements, redwood #694435, cinnabar #b53b32,
  municipal sign blue #2d5f9a, dark panel #161d24, camphor foliage #395f34 /
  #5b803d, standing-seam roof #5c6468, terracotta #a96e5b, karst stone #9e9686,
  streetlamp bronze #52584f).
"""
from pathlib import Path
import math
import sys

import mapbox_earcut
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import trimesh


SIGN_ATLAS = 1024

SWATCHES = dict(
    alum='#c7ccd0',
    white='#eae5db',
    beige='#d5cab7',
    dark='#44494e',
    red_pave='#b84a42',
    yellow_pave='#cfa346',
    wood='#694435',
    red='#b53b32',
    blue='#2d5f9a',
    screen='#141b23',
    leaf='#395f34',
    hedge='#5b803d',
    roof='#5c6468',
    terra='#a96e5b',
    karst='#9e9686',
    bronze='#52584f',
)

# Pixel rects (x, y, w, h) measured from top-left of 1024x1024 signs.png.
SIGN_RECTS = {
    'niko_crown': (0, 0, 1024, 160),
    'niko_arch': (0, 160, 640, 80),
    'gym_title': (640, 160, 384, 80),
    'gym_slogan': (0, 240, 640, 64),
    'xiaoxianggang': (640, 240, 384, 64),
    'road_szj_ns': (0, 304, 256, 192),
    'road_szj_ew': (256, 304, 256, 192),
    'road_yangqiao': (512, 304, 256, 192),
    'police_sign': (768, 304, 256, 96),
    'bus_shelter_hdr': (768, 400, 256, 96),
    'bus_shizijie': (0, 496, 224, 192),
    'bus_yangqiao': (224, 496, 224, 192),
    'stele_guilin': (448, 496, 128, 192),
    'jinma_vert': (576, 496, 128, 192),
    'led_screen': (704, 496, 320, 192),
    'bagui_roof': (0, 688, 384, 96),
    'hexie_sign': (384, 688, 384, 96),
    'nanfang_roof': (768, 688, 256, 96),
    'wenhua_roof': (0, 784, 256, 80),
    'ccb_sign': (256, 784, 384, 80),
    'fire_fascia': (640, 784, 384, 80),
    'shop_0': (0, 864, 256, 80),
    'shop_1': (256, 864, 256, 80),
    'shop_2': (512, 864, 256, 80),
    'shop_3': (768, 864, 256, 80),
    'shop_4': (0, 944, 256, 80),
    'shop_5': (256, 944, 256, 80),
    'shop_6': (512, 944, 256, 80),
    'shop_7': (768, 944, 256, 80),
}


def _font(size, bold=False, sans=False):
    """CJK face for landmark signage (adapted from c_kit._font). Hard error if missing."""
    noto = '/usr/share/fonts/opentype/noto'
    candidates = []
    if sans:
        candidates.extend((
            (f'{noto}/NotoSansCJK-Bold.ttc', 2),
            ('/System/Library/Fonts/STHeiti Medium.ttc', 0),
            ('/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
        ))
    if bold:
        candidates.append(('/System/Library/Fonts/Supplemental/Songti.ttc', 0))
    candidates.extend((
        (f'{noto}/NotoSerifCJK-Bold.ttc', 2),
        (f'{noto}/NotoSansCJK-Bold.ttc', 2),
        (f'{noto}/NotoSerifCJK-Regular.ttc', 2),
        ('/System/Library/Fonts/Supplemental/Songti.ttc', 0 if bold else 1),
        ('/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
        ('/System/Library/Fonts/STHeiti Medium.ttc', 0),
    ))
    for path, index in candidates:
        if not Path(path).exists():
            continue
        try:
            return ImageFont.truetype(path, size, index=index)
        except OSError:
            try:
                return ImageFont.truetype(path, size, index=0)
            except OSError:
                continue
    raise SystemExit(
        'nikoniko: no CJK font for landmark signs. '
        'Need NotoSerifCJK-Bold.ttc / NotoSansCJK-Bold.ttc (or Songti); refusing ImageFont.load_default().'
    )


def _rgb(hex_color):
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))


def _clamp_img(arr):
    return Image.fromarray(np.uint8(np.clip(arr, 0, 255)))


def _draw_centered(draw, box_xywh, text, font, fill, stroke_w=0, stroke_fill=None):
    bx, by, bw, bh = box_xywh
    tb = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_w)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    tx = bx + (bw - tw) / 2.0 - tb[0]
    ty = by + (bh - th) / 2.0 - tb[1]
    draw.text(
        (tx, ty),
        text,
        font=font,
        fill=fill,
        stroke_width=stroke_w,
        stroke_fill=stroke_fill or fill,
    )


def build_signs_sheet():
    """Render 1024x1024 procedural CJK/English signage + dark reflective LED atlas."""
    rng = np.random.default_rng(20261905)
    sheet = Image.new('RGB', (SIGN_ATLAS, SIGN_ATLAS), (32, 36, 42))
    draw = ImageDraw.Draw(sheet)

    # 1. Weixiaotang rooftop curved crown banner ('桂林微笑堂商厦 / GUILIN WEIXIAOTANG PLAZA')
    x, y, w, h = SIGN_RECTS['niko_crown']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(242, 239, 232))
    for vx in range(x, x + w, 64):
        draw.line((vx, y, vx, y + h - 1), fill=(214, 212, 206), width=2)
    draw.rectangle((x, y, x + w - 1, y + 8), fill=(184, 190, 196))
    draw.rectangle((x, y + h - 9, x + w - 1, y + h - 1), fill=(176, 182, 188))
    # Dashang Group green double-loop infinity emblem on left
    draw.ellipse((x + 36, y + 26, x + 98, y + 92), outline=(44, 122, 66), width=13)
    draw.ellipse((x + 84, y + 26, x + 146, y + 92), outline=(44, 122, 66), width=13)
    _draw_centered(draw, (x + 28, y + 98, 126, 44), '大商集团', _font(24, bold=True, sans=True), (36, 42, 48))
    _draw_centered(
        draw, (x + 164, y + 12, 836, 92), '桂 林 微 笑 堂 商 厦',
        _font(76, bold=True), (28, 34, 42), stroke_w=2, stroke_fill=(28, 34, 42),
    )
    _draw_centered(
        draw, (x + 164, y + 104, 836, 42), 'GUILIN WEIXIAOTANG PLAZA',
        _font(31, bold=True, sans=True), (36, 44, 52), stroke_w=1,
    )

    # 2. Weixiaotang ground entrance arch fascia
    x, y, w, h = SIGN_RECTS['niko_arch']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(224, 228, 232))
    draw.rectangle((x + 3, y + 3, x + w - 4, y + h - 4), outline=(146, 154, 162), width=2)
    draw.ellipse((x + 22, y + 16, x + 52, y + 48), outline=(44, 122, 66), width=6)
    draw.ellipse((x + 44, y + 16, x + 74, y + 48), outline=(44, 122, 66), width=6)
    _draw_centered(draw, (x + 82, y + 6, 540, 42), '桂林微笑堂商厦', _font(36, bold=True), (28, 34, 42), stroke_w=1)
    _draw_centered(draw, (x + 82, y + 48, 540, 24), 'GUILIN WEIXIAOTANG PLAZA', _font(18, bold=True, sans=True), (44, 52, 60))

    # 3. Guilin Gymnasium rooftop '体育馆' & red slogan frieze
    x, y, w, h = SIGN_RECTS['gym_title']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(64, 72, 80))
    draw.rectangle((x + 2, y + 2, x + w - 3, y + h - 3), outline=(156, 164, 172), width=2)
    _draw_centered(
        draw, (x + 10, y + 6, w - 20, h - 12), '体  育  馆',
        _font(54, bold=True), (236, 194, 74), stroke_w=2, stroke_fill=(120, 88, 22),
    )

    x, y, w, h = SIGN_RECTS['gym_slogan']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(204, 210, 216))
    draw.line((x, y + h - 3, x + w - 1, y + h - 3), fill=(142, 150, 158), width=3)
    _draw_centered(
        draw, (x + 12, y + 6, w - 24, h - 12), '呵护未成年人   少年强则国强',
        _font(34, bold=True, sans=True), (178, 44, 38), stroke_w=1,
    )

    # 4. Xiao Xiang Gang Underground Mall portal fascia
    x, y, w, h = SIGN_RECTS['xiaoxianggang']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(32, 84, 146))
    draw.rectangle((x + 4, y + 4, x + w - 5, y + h - 5), outline=(238, 242, 246), width=2)
    _draw_centered(draw, (x + 12, y + 6, w - 24, 36), '小香港商业城', _font(32, bold=True, sans=True), (246, 248, 250), stroke_w=1)
    _draw_centered(draw, (x + 12, y + 42, w - 24, 16), 'XIAO XIANG GANG COMMERCIAL MALL', _font(13, bold=True, sans=True), (216, 228, 242))

    # 5. Municipal royal-blue road direction signs (Guilin standard layout)
    def paint_road_sign(rect_key, top_road, top_en, left_road, right_road, compass='北'):
        rx, ry, rw, rh = SIGN_RECTS[rect_key]
        draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=(28, 86, 154))
        draw.rectangle((rx + 6, ry + 6, rx + rw - 7, ry + rh - 7), outline=(242, 245, 248), width=4)
        # White compass badge top-left
        draw.rectangle((rx + 14, ry + 14, rx + 42, ry + 46), fill=(242, 245, 248))
        _draw_centered(draw, (rx + 14, ry + 14, 28, 24), compass, _font(18, bold=True, sans=True), (28, 86, 154))
        # Up arrow + straight road name
        cx = rx + rw // 2
        draw.polygon([(cx, ry + 16), (cx - 14, ry + 36), (cx + 14, ry + 36)], fill=(246, 248, 250))
        draw.rectangle((cx - 5, ry + 34, cx + 5, ry + 152), fill=(246, 248, 250))
        # Horizontal cross-road bar with left/right arrows
        hy = ry + 108
        draw.rectangle((rx + 28, hy - 4, rx + rw - 28, hy + 4), fill=(246, 248, 250))
        draw.polygon([(rx + 18, hy), (rx + 34, hy - 11), (rx + 34, hy + 11)], fill=(246, 248, 250))
        draw.polygon([(rx + rw - 18, hy), (rx + rw - 34, hy - 11), (rx + rw - 34, hy + 11)], fill=(246, 248, 250))
        # Road name labels
        draw.rectangle((cx - 68, ry + 42, cx + 68, ry + 88), fill=(28, 86, 154))
        _draw_centered(draw, (cx - 76, ry + 40, 152, 30), top_road, _font(26, bold=True, sans=True), (248, 250, 252), stroke_w=1)
        _draw_centered(draw, (cx - 84, ry + 70, 168, 18), top_en, _font(14, bold=True, sans=True), (222, 234, 246))
        _draw_centered(draw, (rx + 12, hy + 12, 106, 30), left_road, _font(22, bold=True, sans=True), (248, 250, 252))
        _draw_centered(draw, (rx + rw - 118, hy + 12, 106, 30), right_road, _font(22, bold=True, sans=True), (248, 250, 252))
        draw.line((rx + 10, ry + rh - 28, rx + rw - 10, ry + rh - 28), fill=(224, 234, 244), width=2)

    paint_road_sign('road_szj_ns', '中山中路', 'Zhongshan M. Rd.', '解放西路', '解放东路', '北')
    paint_road_sign('road_szj_ew', '解放东路', 'Jiefang E. Rd.', '中山北路', '中山中路', '东')
    paint_road_sign('road_yangqiao', '中山中路', 'Zhongshan M. Rd.', '西城路', '中心广场', '北')

    # 6. Police kiosk fascia & bus shelter header
    x, y, w, h = SIGN_RECTS['police_sign']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(26, 78, 146))
    draw.rectangle((x, y + h - 14, x + w - 1, y + h - 1), fill=(238, 242, 246))
    _draw_centered(draw, (x + 12, y + 8, w - 24, 48), '桂 林 交 警', _font(36, bold=True, sans=True), (248, 250, 252), stroke_w=1)
    _draw_centered(draw, (x + 12, y + 54, w - 24, 22), 'GUILIN TRAFFIC POLICE', _font(15, bold=True, sans=True), (214, 228, 244))

    x, y, w, h = SIGN_RECTS['bus_shelter_hdr']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(36, 92, 152))
    draw.rectangle((x + 4, y + 4, x + w - 5, y + h - 5), outline=(236, 240, 244), width=2)
    _draw_centered(draw, (x + 10, y + 10, w - 20, 44), '桂林公交 · 文明出行', _font(24, bold=True, sans=True), (246, 248, 250))
    _draw_centered(draw, (x + 10, y + 54, w - 20, 28), '10路 · 11路 · 99路 · 100路', _font(18, bold=True, sans=True), (238, 206, 96))

    # 7. Bus stop totems ('十字街' & '阳桥')
    def paint_bus_totem(rect_key, station_zh, station_en, routes_a, routes_b):
        rx, ry, rw, rh = SIGN_RECTS[rect_key]
        draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=(238, 240, 242))
        draw.rectangle((rx, ry, rx + rw - 1, ry + 78), fill=(26, 84, 148))
        draw.rectangle((rx, ry + 78, rx + rw - 1, ry + 94), fill=(182, 46, 40))
        _draw_centered(draw, (rx + 8, ry + 6, rw - 16, 46), station_zh, _font(38, bold=True, sans=True), (248, 250, 252), stroke_w=1)
        _draw_centered(draw, (rx + 8, ry + 52, rw - 16, 22), station_en, _font(15, bold=True, sans=True), (218, 232, 246))
        _draw_centered(draw, (rx + 10, ry + 102, rw - 20, 36), routes_a, _font(24, bold=True, sans=True), (26, 58, 102))
        draw.line((rx + 16, ry + 144, rx + rw - 16, ry + 144), fill=(186, 192, 198), width=2)
        _draw_centered(draw, (rx + 10, ry + 148, rw - 20, 34), routes_b, _font(22, bold=True, sans=True), (42, 48, 56))
        draw.rectangle((rx + 3, ry + 3, rx + rw - 4, ry + rh - 4), outline=(58, 66, 74), width=3)

    paint_bus_totem('bus_shizijie', '十字街', 'SHIZIJIE BUS STOP', '10路  11路  91路', '99路  100路')
    paint_bus_totem('bus_yangqiao', '阳  桥', 'YANGQIAO BUS STOP', '10路  11路  K99', '100路  观光1号')

    # 8. Vertical karst boulder stele ('桂林山水甲天下')
    x, y, w, h = SIGN_RECTS['stele_guilin']
    stele_patch = np.full((h, w, 3), (156, 148, 134), dtype=float)
    stele_patch += rng.normal(0, 6.0, (h, w, 1))
    sheet.paste(_clamp_img(stele_patch), (x, y))
    draw = ImageDraw.Draw(sheet)
    stele_font = _font(23, bold=True)
    for idx, ch in enumerate('桂林山水甲天下'):
        _draw_centered(
            draw, (x + 18, y + 10 + idx * 24, w - 36, 24), ch,
            stele_font, (168, 34, 28), stroke_w=1, stroke_fill=(118, 22, 18),
        )

    # 9. Vertical '金马大厦' shaft sign (04-2024.jpg)
    x, y, w, h = SIGN_RECTS['jinma_vert']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(48, 52, 58))
    draw.rectangle((x + 5, y + 5, x + w - 6, y + h - 6), outline=(108, 114, 120), width=2)
    jm_font = _font(36, bold=True)
    for idx, ch in enumerate('金马大厦'):
        _draw_centered(
            draw, (x + 12, y + 12 + idx * 42, w - 24, 40), ch,
            jm_font, (232, 188, 68), stroke_w=1, stroke_fill=(132, 96, 24),
        )

    # 10. Dark glossy outdoor SMD LED billboard screen (Review Item 6)
    x, y, w, h = SIGN_RECTS['led_screen']
    yy, xx = np.mgrid[0:h, 0:w]
    # Diagonal sky-sheen across deep obsidian-navy black-matrix LED modules
    diag = (xx / float(w) * 0.65 + (1.0 - yy / float(h)) * 0.35)
    sheen = np.exp(-((diag - 0.54) / 0.19) ** 2)
    horizon = np.clip(1.0 - yy / float(h), 0.0, 1.0)
    led = np.zeros((h, w, 3), dtype=float)
    led[..., 0] = 13.0 + 9.0 * horizon + 22.0 * sheen
    led[..., 1] = 18.0 + 14.0 * horizon + 30.0 * sheen
    led[..., 2] = 26.0 + 20.0 * horizon + 38.0 * sheen
    # Subtle LED module cabinet grid & fine horizontal scanline matrix
    led[(yy % 24) == 0] *= 0.68
    led[(xx % 32) == 0] *= 0.72
    led[(yy % 3) == 0] *= 0.90
    sheet.paste(_clamp_img(led), (x, y))
    draw = ImageDraw.Draw(sheet)
    draw.rectangle((x, y, x + w - 1, y + h - 1), outline=(22, 26, 32), width=10)
    draw.rectangle((x + 10, y + 10, x + w - 11, y + h - 11), outline=(58, 70, 84), width=2)

    # 11. Rooftop & landmark building plaques
    def paint_banner(rect_key, bg, fg, border, main_text, sub_text=None, main_sz=48):
        rx, ry, rw, rh = SIGN_RECTS[rect_key]
        draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=bg)
        draw.rectangle((rx + 4, ry + 4, rx + rw - 5, ry + rh - 5), outline=border, width=3)
        if sub_text:
            _draw_centered(draw, (rx + 10, ry + 6, rw - 20, int(rh * 0.58)), main_text, _font(main_sz, bold=True), fg, stroke_w=1)
            _draw_centered(draw, (rx + 10, ry + int(rh * 0.62), rw - 20, int(rh * 0.30)), sub_text, _font(max(13, main_sz // 3), bold=True, sans=True), fg)
        else:
            _draw_centered(draw, (rx + 10, ry + 6, rw - 20, rh - 12), main_text, _font(main_sz, bold=True), fg, stroke_w=1)

    paint_banner('bagui_roof', (154, 38, 34), (246, 224, 152), (218, 184, 96), '八 桂 大 厦', 'BAGUI MANSION', 46)
    paint_banner('hexie_sign', (38, 108, 174), (246, 214, 88), (226, 236, 246), '和谐心理咨询中心', 'PSYCHOLOGICAL CENTER', 34)
    paint_banner('nanfang_roof', (34, 78, 134), (244, 246, 248), (196, 212, 228), '南 方 大 厦', None, 42)
    paint_banner('wenhua_roof', (134, 48, 42), (244, 232, 188), (204, 178, 122), '文 化 大 厦', None, 38)

    # CCB sign ('中国建设银行 China Construction Bank')
    x, y, w, h = SIGN_RECTS['ccb_sign']
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(240, 242, 244))
    draw.rectangle((x, y + h - 10, x + w - 1, y + h - 1), fill=(24, 82, 156))
    draw.ellipse((x + 18, y + 14, x + 64, y + 60), fill=(24, 82, 156))
    draw.rectangle((x + 33, y + 29, x + 49, y + 45), fill=(240, 242, 244))
    _draw_centered(draw, (x + 74, y + 6, w - 86, 40), '中国建设银行', _font(34, bold=True, sans=True), (28, 34, 42), stroke_w=1)
    _draw_centered(draw, (x + 74, y + 46, w - 86, 20), 'China Construction Bank', _font(16, bold=True, sans=True), (48, 56, 66))

    # Fire rescue station fascia ('中国消防救援 / CHINA FIRE AND RESCUE')
    x, y, w, h = SIGN_RECTS['fire_fascia']
    draw.rectangle((x, y, x + w - 1, y + 52), fill=(184, 42, 36))
    draw.rectangle((x, y + 52, x + w - 1, y + h - 1), fill=(28, 76, 144))
    _draw_centered(draw, (x + 10, y + 4, w - 20, 44), '中 国 消 防 救 援', _font(34, bold=True, sans=True), (246, 222, 92), stroke_w=1)
    _draw_centered(draw, (x + 10, y + 54, w - 20, 22), 'CHINA FIRE AND RESCUE', _font(16, bold=True, sans=True), (242, 246, 250))

    # 12. Eight authentic Guilin storefront fascia signs
    shops = [
        ('shop_0', (36, 40, 46), (242, 224, 172), '周 大 福', 'CHOW TAI FOOK'),
        ('shop_1', (34, 88, 62), (244, 246, 244), '桂 林 银 行', 'GUILIN BANK'),
        ('shop_2', (164, 44, 38), (248, 226, 142), '桂林米粉 · 老字号', 'TRADITIONAL NOODLES'),
        ('shop_3', (32, 82, 138), (246, 248, 250), '大参林药房', 'DASHENLIN PHARMACY'),
        ('shop_4', (152, 84, 48), (248, 240, 222), '三品王牛肉粉', 'SANPINWANG'),
        ('shop_5', (30, 34, 40), (236, 240, 244), '华为授权体验店', 'HUAWEI STORE'),
        ('shop_6', (128, 38, 44), (244, 218, 136), '金顺昌 · 桂林三宝', 'GUILIN SPECIALTIES'),
        ('shop_7', (38, 92, 106), (242, 246, 246), '漓 江 书 院', 'LIJIANG BOOKSTORE'),
    ]
    for key, bg, fg, zh, en in shops:
        paint_banner(key, bg, fg, tuple(min(255, c + 36) for c in bg), zh, en, 28)

    return sheet


def build_surfaces_sheet():
    rng = np.random.default_rng(20261901)
    sheet = Image.new('RGB', (1024, 1024))
    for idx, (key, hex_col) in enumerate(SWATCHES.items()):
        base = _rgb(hex_col)
        panel = Image.new('RGB', (256, 256), base)
        draw = ImageDraw.Draw(panel)
        if key == 'alum':
            for y in range(0, 256, 32):
                draw.line((0, y, 255, y), fill=(168, 174, 180), width=2)
            for x in range(0, 256, 64):
                draw.line((x, 0, x, 255), fill=(172, 178, 184), width=2)
                for y in range(16, 256, 32):
                    draw.rectangle((x + 4, y - 10, x + 60, y + 10), outline=(210, 215, 220), width=1)
        elif key in ('white', 'beige', 'terra'):
            step = 16 if key == 'white' else 24
            joint = tuple(max(0, c - 18) for c in base)
            for y in range(0, 256, step):
                draw.line((0, y, 255, y), fill=joint, width=1)
                for x in range((y // step % 2) * 24, 256, 48):
                    shade = int(rng.integers(-6, 7))
                    col = tuple(np.clip(c + shade, 0, 255) for c in base)
                    draw.rectangle((x + 1, y + 1, x + 46, y + step - 1), fill=col)
        elif key == 'dark':
            for y in range(0, 256, 32):
                draw.line((0, y, 255, y), fill=(52, 56, 60), width=2)
                for x in range(0, 256, 64):
                    shade = int(rng.integers(-8, 9))
                    col = tuple(np.clip(c + shade, 0, 255) for c in base)
                    draw.rectangle((x + 2, y + 2, x + 62, y + 30), fill=col)
        elif key in ('red_pave', 'yellow_pave'):
            for _ in range(380):
                px, py = int(rng.integers(0, 254)), int(rng.integers(0, 254))
                shade = int(rng.integers(-14, 15))
                draw.rectangle((px, py, px + 2, py + 2), fill=tuple(np.clip(c + shade, 0, 255) for c in base))
            if key == 'yellow_pave':
                for y in range(12, 256, 24):
                    for x in range(12, 256, 24):
                        draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(224, 182, 84))
        elif key == 'wood':
            for x in range(0, 256, 16):
                shade = int(rng.integers(-10, 10))
                col = tuple(np.clip(c + shade, 0, 255) for c in base)
                draw.rectangle((x, 0, x + 14, 255), fill=col)
                draw.line((x + 15, 0, x + 15, 255), fill=(72, 44, 34), width=2)
        elif key == 'blue':
            draw.rectangle((10, 10, 245, 245), outline=(238, 242, 246), width=5)
            draw.line((10, 172, 245, 172), fill=(238, 242, 246), width=3)
        elif key == 'screen':
            for y in range(16, 240, 4):
                draw.line((16, y, 240, y), fill=(15, 20, 27), width=1)
            draw.rectangle((8, 8, 247, 247), outline=(28, 32, 38), width=8)
        elif key in ('leaf', 'hedge'):
            for _ in range(260):
                cx, cy = int(rng.integers(0, 256)), int(rng.integers(0, 256))
                rad = int(rng.integers(6, 18))
                shade = int(rng.integers(-18, 20))
                col = tuple(np.clip(c + shade, 0, 255) for c in base)
                draw.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=col)
        elif key == 'roof':
            for x in range(0, 256, 12):
                draw.line((x, 0, x, 255), fill=(72, 79, 83), width=2)
                draw.line((x + 2, 0, x + 2, 255), fill=(108, 116, 120), width=1)
        elif key == 'karst':
            for x in range(0, 256, 6):
                streak = int(rng.integers(-28, 12))
                col = tuple(np.clip(c + streak, 0, 255) for c in base)
                draw.line((x, 0, x + int(rng.integers(-4, 5)), 255), fill=col, width=4)
        arr = np.asarray(panel, dtype=float) + rng.normal(0, 2.5, (256, 256, 1))
        sheet.paste(_clamp_img(arr), ((idx % 4) * 256, (idx // 4) * 256))
    return sheet


def build_curtain_glass():
    rng = np.random.default_rng(20261902)
    arr = np.zeros((512, 512, 3), dtype=float)
    y_grid, x_grid = np.mgrid[0:512, 0:512]
    t = (y_grid % 128) / 128.0
    sheen = 0.5 + 0.5 * np.sin((x_grid * 0.7 + y_grid * 0.45) * 2 * math.pi / 256.0)
    arr[..., 0] = 58 + 28 * (1 - t) + 14 * sheen
    arr[..., 1] = 98 + 32 * (1 - t) + 16 * sheen
    arr[..., 2] = 118 + 34 * (1 - t) + 16 * sheen
    spandrel = (y_grid % 128) < 22
    arr[spandrel] = [40, 63, 77]
    arr += rng.normal(0, 1.8, (512, 512, 1))
    img = _clamp_img(arr)
    draw = ImageDraw.Draw(img)
    for x in range(0, 512, 64):
        draw.line((x, 0, x, 511), fill=(176, 184, 190), width=3)
        draw.line((x + 2, 0, x + 2, 511), fill=(118, 128, 136), width=1)
    for y in range(0, 512, 128):
        draw.rectangle((0, y, 511, y + 4), fill=(186, 192, 198))
        draw.line((0, y + 22, 511, y + 22), fill=(154, 164, 170), width=2)
    return img


def build_plaza_pave():
    rng = np.random.default_rng(20261903)
    img = Image.new('RGB', (512, 512), (168, 168, 162))
    draw = ImageDraw.Draw(img)
    h = 32
    w = 64
    for row in range(512 // h):
        y0 = row * h
        offset = (row % 2) * (w // 2)
        for col in range(-1, 512 // w + 1):
            x0 = col * w + offset
            tone = 178 if (row + col) % 3 else 160
            jitter = int(rng.integers(-8, 9))
            rgb = (tone + jitter + 2, tone + jitter + 1, tone + jitter - 2)
            draw.rectangle((x0 + 2, y0 + 2, x0 + w - 1, y0 + h - 1), fill=rgb)
            draw.line((x0, y0, x0 + w, y0), fill=(132, 134, 132), width=2)
            draw.line((x0, y0, x0, y0 + h), fill=(132, 134, 132), width=2)
    arr = np.asarray(img, dtype=float) + rng.normal(0, 3.2, (512, 512, 1))
    return _clamp_img(arr)


def ensure_b_textures():
    tex_dir = Path(__file__).resolve().parents[2] / 'public/textures/landmarks/B'
    tex_dir.mkdir(parents=True, exist_ok=True)
    textures = {
        'surfaces': build_surfaces_sheet(),
        'glass': build_curtain_glass(),
        'pave': build_plaza_pave(),
        'signs': build_signs_sheet(),
    }
    filenames = {
        'surfaces': 'surfaces.png',
        'glass': 'curtain_glass.png',
        'pave': 'plaza_pave.png',
        'signs': 'signs.png',
    }
    for key, img in textures.items():
        img.save(tex_dir / filenames[key], optimize=True)
    return textures


class Builder:
    """Low-draw-call geometry accumulator (<= 5 meshes per LOD)."""

    TILED_SCALES = {
        'glass': (5.2, 15.0),
        'pave': (4.8, 4.8),
    }

    def __init__(self, detail=True):
        self.detail = detail
        self.visible = []
        self.uv = []
        self.tiled = {k: [] for k in self.TILED_SCALES}
        self.sign_tris = []
        self.sign_uv = []
        self.lit_tris = []
        self.lit_uv = []
        self.solid = []
        self.pose = (0.0, 0.0, 0.0, 0.0)

    def _transform(self, verts):
        out = np.asarray(verts, dtype=float).copy()
        dx, dy, dz, angle = self.pose
        if angle:
            c, s = math.cos(angle), math.sin(angle)
            x, z = out[..., 0].copy(), out[..., 2].copy()
            out[..., 0] = x * c + z * s + dx
            out[..., 2] = -x * s + z * c + dz
        else:
            out[..., 0] += dx
            out[..., 2] += dz
        out[..., 1] += dy
        return out

    def sign_quad(self, x, y0, z, w, h, sign_key, double_sided=False):
        """Place a UV-mapped CJK/Latin sign or dark glossy LED quad facing local +Z."""
        rx, ry, rw, rh = SIGN_RECTS[sign_key]
        u0 = (rx + 1.5) / SIGN_ATLAS
        u1 = (rx + rw - 1.5) / SIGN_ATLAS
        # glTF samples V from bottom of image: top of rect has larger V, bottom has smaller V.
        v_top = 1.0 - (ry + 1.5) / SIGN_ATLAS
        v_bot = 1.0 - (ry + rh - 1.5) / SIGN_ATLAS

        hw = w / 2.0
        quad = self._transform([
            (x - hw, y0, z),
            (x + hw, y0, z),
            (x + hw, y0 + h, z),
            (x - hw, y0 + h, z),
        ])
        uvs = np.array([
            (u0, v_bot),
            (u1, v_bot),
            (u1, v_top),
            (u0, v_top),
        ], dtype=float)
        idx = [[0, 1, 2], [0, 2, 3]]
        self.sign_tris.append(quad[idx])
        self.sign_uv.append(uvs[idx])

        if double_sided:
            # Viewed from -Z (looking +Z): viewer's left is +X, viewer's right is -X.
            back = self._transform([
                (x + hw, y0, z - 0.04),
                (x - hw, y0, z - 0.04),
                (x - hw, y0 + h, z - 0.04),
                (x + hw, y0 + h, z - 0.04),
            ])
            self.sign_tris.append(back[idx])
            self.sign_uv.append(uvs[idx])

    def sign_arc(self, cx, cz, radius, y0, h, center_yaw, span_rad, sign_key, segs=16):
        """Place a curved cylindrical banner facing outward around (cx, cz)."""
        rx, ry, rw, rh = SIGN_RECTS[sign_key]
        u_left = (rx + 2.0) / SIGN_ATLAS
        u_right = (rx + rw - 2.0) / SIGN_ATLAS
        v_top = 1.0 - (ry + 2.0) / SIGN_ATLAS
        v_bot = 1.0 - (ry + rh - 2.0) / SIGN_ATLAS

        for i in range(segs):
            t0 = i / float(segs)
            t1 = (i + 1) / float(segs)
            a0 = center_yaw - span_rad / 2.0 + span_rad * t0
            a1 = center_yaw - span_rad / 2.0 + span_rad * t1
            x0, z0 = cx + math.sin(a0) * radius, cz + math.cos(a0) * radius
            x1, z1 = cx + math.sin(a1) * radius, cz + math.cos(a1) * radius
            quad = self._transform([
                (x0, y0, z0),
                (x1, y0, z1),
                (x1, y0 + h, z1),
                (x0, y0 + h, z0),
            ])
            uu0 = u_left + (u_right - u_left) * t0
            uu1 = u_left + (u_right - u_left) * t1
            uvs = np.array([
                (uu0, v_bot),
                (uu1, v_bot),
                (uu1, v_top),
                (uu0, v_top),
            ], dtype=float)
            idx = [[0, 1, 2], [0, 2, 3]]
            self.sign_tris.append(quad[idx])
            self.sign_uv.append(uvs[idx])

    def mesh(self, vertices, faces, mat, collide=False, uv_scale=None):
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

        if mat == 'stone':
            mat = 'beige'

        if mat in self.tiled:
            scale = uv_scale or self.TILED_SCALES[mat]
            self.tiled[mat].append((tris, coords / scale))
            return

        is_lit = False
        swatch_key = mat
        if mat.endswith('_lit'):
            is_lit = True
            swatch_key = mat[:-4]
            if swatch_key not in SWATCHES:
                swatch_key = 'white'

        cmin = coords.min(axis=1, keepdims=True)
        span = np.maximum(coords.max(axis=1, keepdims=True) - cmin, 1e-6)
        norm_uv = (coords - cmin) / span
        cell = list(SWATCHES).index(swatch_key)
        mapped_uv = (norm_uv * 0.90 + 0.05 + [cell % 4, 3 - cell // 4]) / 4.0

        if is_lit:
            self.lit_tris.append(tris)
            self.lit_uv.append(mapped_uv)
        else:
            self.visible.append(tris)
            self.uv.append(mapped_uv)

    def box(self, x, y, z, w, h, d, mat, collide=False, uv_scale=None):
        cube = trimesh.creation.box([w, h, d])
        self.mesh(cube.vertices + [x, y + h / 2.0, z], cube.faces, mat, collide, uv_scale)

    def beam(self, start, end, r, mat, sections=8, collide=False):
        seg = np.asarray([start, end], dtype=float)
        if np.linalg.norm(seg[1] - seg[0]) < 1e-4:
            return
        cyl = trimesh.creation.cylinder(radius=r, sections=sections, segment=seg)
        self.mesh(cyl.vertices, cyl.faces, mat, collide)

    def cylinder_y(self, x, y0, h, z, r, mat, sections=16, collide=False, uv_scale=None):
        cyl = trimesh.creation.cylinder(radius=r, height=h, sections=sections)
        verts = cyl.vertices[:, [0, 2, 1]].copy()
        verts[:, 2] *= -1
        verts += [x, y0 + h / 2.0, z]
        self.mesh(verts, cyl.faces, mat, collide, uv_scale)

    def prism(self, poly_xz, y0, h, mat, collide=False, cap_mat=None, uv_scale=None, wall_mask=None):
        """Extrude a 2D polygon [(x, z), ...] vertically from y0 to y0 + h."""
        pts = np.asarray(poly_xz, dtype=float)
        if np.allclose(pts[0], pts[-1]):
            pts = pts[:-1]
        n = len(pts)
        if n < 3:
            return
        signed_area = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
        if signed_area < 0:
            pts = pts[::-1]
            if wall_mask is not None:
                wall_mask = list(reversed(wall_mask))
        tris_2d = mapbox_earcut.triangulate_float64(pts, np.array([n], dtype=np.uint32)).reshape(-1, 3)
        top_verts = np.column_stack([pts[:, 0], np.full(n, y0 + h), pts[:, 1]])
        self.mesh(top_verts, tris_2d[:, ::-1], cap_mat or mat, collide, uv_scale)
        for i in range(n):
            if wall_mask is not None and not wall_mask[i]:
                continue
            j = (i + 1) % n
            x0, z0 = pts[i]
            x1, z1 = pts[j]
            quad_v = [
                (x0, y0, z0),
                (x1, y0, z1),
                (x1, y0 + h, z1),
                (x0, y0 + h, z0),
            ]
            self.mesh(quad_v, [[0, 2, 1], [0, 3, 2]], mat, collide, uv_scale)

    def poly_wall_strip(self, chain_xz, y0, h, thickness, mat, collide=False, cap_mat=None, uv_scale=None):
        """Extrude a polyline strip of given thickness from y0 to y0 + h."""
        pts = np.asarray(chain_xz, dtype=float)
        for i in range(len(pts) - 1):
            p0, p1 = pts[i], pts[i + 1]
            dx, dz = p1 - p0
            ln = math.hypot(dx, dz)
            if ln < 1e-3:
                continue
            nx, nz = -dz / ln * (thickness / 2.0), dx / ln * (thickness / 2.0)
            quad = [
                (p0[0] - nx, p0[1] - nz),
                (p1[0] - nx, p1[1] - nz),
                (p1[0] + nx, p1[1] + nz),
                (p0[0] + nx, p0[1] + nz),
            ]
            self.prism(quad, y0, h, mat, collide=collide, cap_mat=cap_mat, uv_scale=uv_scale)

    def cluster_lamp(self, x, y0, z, height=7.2, globes=5, collide=False):
        """Guilin municipal multi-globe decorative streetlamp (玉兰/五头球灯)."""
        self.box(x, y0, z, 0.52, 0.55, 0.52, 'dark', collide=collide)
        self.beam([x, y0 + 0.55, z], [x, y0 + height - 0.5, z], 0.11, 'bronze', sections=6, collide=collide)
        if not self.detail:
            self.box(x, y0 + height - 0.5, z, 0.9, 0.65, 0.9, 'white_lit')
            return
        self.cylinder_y(x, y0 + height - 0.15, 0.46, z, 0.24, 'white_lit', sections=8)
        arms = max(2, globes - 1)
        for i in range(arms):
            ang = i * (2 * math.pi / arms) + 0.4
            gx = x + math.cos(ang) * 0.68
            gz = z + math.sin(ang) * 0.68
            gy = y0 + height - 0.65
            self.beam([x, y0 + height - 1.15, z], [gx, gy, gz], 0.045, 'bronze', sections=5)
            self.cylinder_y(gx, gy, 0.38, gz, 0.20, 'white_lit', sections=8)
        self.box(x + 0.28, y0 + height * 0.46, z, 0.36, 0.95, 0.05, 'red')
        self.box(x - 0.28, y0 + height * 0.46, z, 0.36, 0.95, 0.05, 'red')

    def street_tree(self, x, y0, z, height=8.5, spread=3.4, kind='camphor', lanterns=False, collide=False):
        """Low-poly camphor / banyan or date-palm street tree."""
        if kind == 'palm':
            self.beam([x, y0, z], [x, y0 + height * 0.78, z], 0.24, 'wood', sections=7, collide=collide)
            fronds = 9 if self.detail else 4
            top = y0 + height * 0.78
            for i in range(fronds):
                ang = i * (2 * math.pi / fronds)
                dx, dz = math.cos(ang), math.sin(ang)
                px, pz = -dz * 0.45, dx * 0.45
                verts = [
                    (x, top + 0.15, z),
                    (x + dx * spread * 0.52 + px, top + 0.85, z + dz * spread * 0.52 + pz),
                    (x + dx * spread, top - 0.65, z + dz * spread),
                    (x + dx * spread * 0.52 - px, top + 0.85, z + dz * spread * 0.52 - pz),
                ]
                self.mesh(verts, [[0, 1, 2], [0, 2, 3]], 'hedge' if i % 2 == 0 else 'leaf')
            return

        trunk_h = height * 0.44
        self.beam([x, y0, z], [x, y0 + trunk_h, z], 0.26, 'wood', sections=6, collide=collide)
        if not self.detail:
            self.cylinder_y(x, y0 + trunk_h - 0.4, height * 0.55, z, spread * 0.85, 'leaf', sections=7)
            return
        blobs = [
            (0.0, trunk_h + height * 0.24, 0.0, spread * 0.82, height * 0.36, 'leaf'),
            (-spread * 0.38, trunk_h + height * 0.14, spread * 0.25, spread * 0.62, height * 0.28, 'hedge'),
            (spread * 0.36, trunk_h + height * 0.16, -spread * 0.28, spread * 0.60, height * 0.28, 'leaf'),
            (0.08 * spread, trunk_h + height * 0.38, 0.1 * spread, spread * 0.54, height * 0.24, 'hedge'),
        ]
        for bx, by, bz, br, bh, mat in blobs:
            ico = trimesh.creation.icosphere(subdivisions=1, radius=1.0)
            v = ico.vertices.copy()
            v[:, 0] = v[:, 0] * br + x + bx
            v[:, 1] = v[:, 1] * bh + y0 + by
            v[:, 2] = v[:, 2] * br + z + bz
            self.mesh(v, ico.faces, mat)
        if lanterns:
            for ang in (0.6, 2.5, 4.4):
                lx = x + math.cos(ang) * spread * 0.52
                lz = z + math.sin(ang) * spread * 0.52
                ly = y0 + trunk_h + 0.15
                self.cylinder_y(lx, ly, 0.34, lz, 0.16, 'red_lit', sections=6)


def export_landmark(name, build_fn):
    textures = ensure_b_textures()
    scene = trimesh.Scene()

    mat_surfaces = trimesh.visual.material.PBRMaterial(
        name='B_surfaces',
        baseColorTexture=textures['surfaces'],
        roughnessFactor=0.92,
        metallicFactor=0.04,
        doubleSided=True,
    )
    mat_signs = trimesh.visual.material.PBRMaterial(
        name='B_signs',
        baseColorTexture=textures['signs'],
        roughnessFactor=0.22,
        metallicFactor=0.26,
        doubleSided=True,
    )
    mat_lit = trimesh.visual.material.PBRMaterial(
        name='B_surfaces_lit',
        baseColorTexture=textures['surfaces'],
        emissiveFactor=[0.18, 0.16, 0.12],
        roughnessFactor=0.65,
        metallicFactor=0.05,
        doubleSided=True,
    )
    tiled_mats = {
        'glass': trimesh.visual.material.PBRMaterial(
            name='B_curtain_glass',
            baseColorTexture=textures['glass'],
            roughnessFactor=0.28,
            metallicFactor=0.35,
            doubleSided=True,
        ),
        'pave': trimesh.visual.material.PBRMaterial(
            name='B_plaza_pave',
            baseColorTexture=textures['pave'],
            roughnessFactor=0.95,
            metallicFactor=0.0,
            doubleSided=True,
        ),
    }

    def pack_tris(tri_list):
        verts = np.concatenate(tri_list, axis=0).reshape(-1, 3)
        faces = np.arange(len(verts), dtype=np.int64).reshape(-1, 3)
        return trimesh.Trimesh(vertices=verts, faces=faces, process=False)

    for lod in (0, 1):
        builder = Builder(detail=(lod == 0))
        build_fn(builder)
        layer = f'lod{lod}'
        scene.graph.update(frame_to=layer)

        if builder.visible:
            mesh = pack_tris(builder.visible)
            uv = np.concatenate(builder.uv, axis=0).reshape(-1, 2)
            mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat_surfaces)
            scene.add_geometry(mesh, node_name=f'{layer}_joinery', parent_node_name=layer)

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
    scene.export(out_dir / f'{name}.glb')


# Exact OSM way/253743030 polygon vertices relative to centroid (-974.905, -121.586)
FOOTPRINT = [
    (-44.00, -43.57),
    (-55.60, 8.50),
    (-55.18, 13.84),
    (-53.08, 19.08),
    (-48.54, 20.86),
    (-0.96, 32.50),
    (13.38, 46.01),
    (38.80, 52.82),
    (53.67, -2.19),
    (50.70, -14.83),
    (47.55, -17.59),
    (46.11, -18.85),
    (43.08, -21.51),
    (41.52, -22.87),
    (27.48, -26.63),
    (29.09, -33.31),
    (-17.98, -41.96),
    (-40.41, -46.09),
]


def _facade_run(m: Builder, p0, p1, ground_h=4.8, upper_h=18.2, bays=8, brand_seed=0):
    """Build detailed ground-floor luxury storefronts + upper blue glass curtain wall."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    ux, uz = dx / length, dz / length
    nx, nz = -uz, ux
    if p0[0] + p1[0] > 40 and nx < 0:
        nx, nz = -nx, -nz
    if p0[1] + p1[1] < -50 and nz > 0:
        nx, nz = -nx, -nz

    bay_w = length / bays
    midx = (p0[0] + p1[0]) / 2.0 + nx * 0.45
    midz = (p0[1] + p1[1]) / 2.0 + nz * 0.45
    facade_yaw = math.atan2(nx, nz)
    m.pose = (midx, 0.0, midz, facade_yaw)
    m.box(0, ground_h - 0.35, 0, length + 0.4, 0.85, 0.95, 'alum')
    m.box(0, ground_h + upper_h, 0, length + 0.5, 1.35, 1.05, 'alum')
    m.box(0, ground_h + upper_h + 1.35, 0, length + 0.7, 0.28, 1.25, 'dark')

    # Upper blue-teal curtain glass plane slightly proud of core
    m.box(0, ground_h + 0.5, 0.22, length - 0.4, upper_h - 0.5, 0.36, 'glass')

    if not m.detail:
        m.pose = (0.0, 0.0, 0.0, 0.0)
        return

    for i in range(bays + 1):
        lx = -length / 2.0 + i * bay_w
        m.box(lx, -1.5, 0.25, 0.72, ground_h + 1.5, 0.85, 'dark', collide=True)
        m.box(lx, ground_h + 0.5, 0.44, 0.24, upper_h - 0.5, 0.22, 'alum')
        if i < bays:
            cx = lx + bay_w / 2.0
            m.box(cx, 0.15, -0.05, bay_w - 0.82, 3.35, 0.24, 'glass')
            m.box(cx, 3.52, 0.30, bay_w - 0.76, 0.92, 0.26, 'dark')
            m.sign_quad(cx, 3.55, 0.45, bay_w - 0.82, 0.86, f'shop_{(i + brand_seed) % 8}')
            for fl in range(1, 5):
                m.box(cx, ground_h + fl * (upper_h / 5.0), 0.42, bay_w - 0.24, 0.18, 0.16, 'alum')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _buttress_pylon(m: Builder, cx, cz, yaw):
    """Flanking chamfered silver-grey aluminum stair/elevator pylon (27.0 m)."""
    m.pose = (cx, 0.0, cz, yaw)
    m.box(0, -2.0, 0, 10.6, 28.6, 9.2, 'alum', collide=True)
    m.box(0, 26.6, 0, 9.2, 0.85, 8.0, 'alum')
    if m.detail:
        m.box(0, 2.2, 4.48, 3.8, 22.8, 0.35, 'glass')
        m.box(-2.05, 1.8, 4.55, 0.34, 23.4, 0.38, 'alum')
        m.box(2.05, 1.8, 4.55, 0.34, 23.4, 0.38, 'alum')
        for fl in range(7):
            fy = 2.4 + fl * 3.22
            m.box(0, fy, 4.62, 4.1, 0.26, 0.26, 'white')
        for sx in (-4.2, -3.0, 3.0, 4.2):
            m.box(sx, 0.5, 4.58, 0.16, 25.8, 0.14, 'white')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def build_nikoniko(m: Builder):
    # 1. Granite sidewalk & corner forecourt plaza (flush at ground y=0, skirt to -2.0 m)
    apron = [
        (-46.5, -49.5),
        (-58.5, 9.5),
        (-56.0, 21.5),
        (-1.5, 35.5),
        (14.0, 49.0),
        (42.5, 56.5),
        (59.8, -1.5),
        (57.2, -18.5),
        (48.5, -29.5),
        (33.5, -38.0),
        (-18.0, -47.0),
    ]
    m.prism(apron, -2.0, 2.08, 'pave', collide=True, cap_mat='pave')

    # 2. Main 6-storey retail body extruded from exact OSM footprint
    n_edges = len(FOOTPRINT)
    ground_mask = [i not in (9, 10, 11, 12) for i in range(n_edges)]
    m.prism(FOOTPRINT, -2.0, 6.8, 'dark', collide=True, cap_mat='alum', wall_mask=ground_mask)
    m.prism(FOOTPRINT, 4.8, 18.2, 'alum', collide=True, cap_mat='roof')

    m.pose = (-8.0, 0.0, -4.0, 0.22)
    m.box(0, 23.0, 0, 34.0, 3.2, 24.0, 'alum')
    m.box(0, 26.2, 0, 22.0, 1.4, 14.0, 'roof')
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # 3. East Wing (along Zhongshan Middle Rd) & North Wing (along Jiefang West Rd) curtain walls
    _facade_run(m, (38.80, 52.82), (53.67, -2.19), ground_h=4.8, upper_h=18.2, bays=9, brand_seed=1)
    _facade_run(m, (53.67, -2.19), (50.70, -14.83), ground_h=4.8, upper_h=18.2, bays=2, brand_seed=0)
    _facade_run(m, (27.48, -26.63), (-40.41, -46.09), ground_h=4.8, upper_h=18.2, bays=11, brand_seed=3)
    _facade_run(m, (-44.00, -43.57), (-55.60, 8.50), ground_h=4.8, upper_h=18.2, bays=7, brand_seed=2)
    _facade_run(m, (13.38, 46.01), (38.80, 52.82), ground_h=4.8, upper_h=18.2, bays=4, brand_seed=0)

    # Cantilevered semi-cylindrical glass bay on upper-west end of North Wing (00-2019.jpg right)
    m.cylinder_y(-33.5, 13.8, 7.6, -45.6, 2.6, 'glass', sections=12 if m.detail else 6)
    m.cylinder_y(-33.5, 13.4, 0.4, -45.6, 2.75, 'alum', sections=12 if m.detail else 6)
    m.cylinder_y(-33.5, 21.4, 0.45, -45.6, 2.75, 'alum', sections=12 if m.detail else 6)

    # 4. NE Corner Rotunda Glass Tower + Flanking Aluminum Buttress Pylons + Rooftop Sign Drum
    corner_cx, corner_cz = 40.5, -15.5
    corner_yaw = math.atan2(1.0, -0.88)

    _buttress_pylon(m, 49.2, -9.2, corner_yaw - 0.34)
    _buttress_pylon(m, 33.0, -25.0, corner_yaw + 0.34)

    # Walkable recessed corner entrance lobby floor + rear glass doors
    m.pose = (corner_cx + 4.2, 0.0, corner_cz - 3.8, corner_yaw)
    for step in range(2):
        m.box(0, step * 0.11, 8.2 - step * 1.1, 13.5, 0.12, 1.2, 'pave', collide=True)
    m.box(0, 0.2, 2.2, 12.6, 5.8, 0.5, 'glass', collide=True)
    for side in (-1, 1):
        m.cylinder_y(side * 5.2, 0.0, 6.8, 7.2, 0.68, 'alum', sections=12 if m.detail else 6, collide=True)
        if m.detail:
            m.box(side * 5.2, 1.8, 7.92, 0.88, 4.3, 0.08, 'red')
            m.box(side * 5.2, 1.72, 7.94, 0.94, 0.12, 0.10, 'yellow_pave')
            m.box(side * 5.2, 6.08, 7.94, 0.94, 0.12, 0.10, 'yellow_pave')

    # Semi-circular fan-ribbed glass arch canopy over main corner entrance (00-2019.jpg)
    arch_r = 4.65
    arch_y0 = 3.65
    arch_segs = 12 if m.detail else 6
    for idx in range(arch_segs):
        a0 = math.pi * idx / arch_segs
        a1 = math.pi * (idx + 1) / arch_segs
        x0, y0 = arch_r * math.cos(a0), arch_y0 + arch_r * math.sin(a0) * 0.78
        x1, y1 = arch_r * math.cos(a1), arch_y0 + arch_r * math.sin(a1) * 0.78
        quad = [(x0, y0, 6.6), (x1, y1, 6.6), (x1, y1, 9.2), (x0, y0, 9.2)]
        m.mesh(quad, [[0, 1, 2], [0, 2, 3]], 'alum')
        fan = [(0.0, arch_y0, 9.05), (x0, y0, 9.05), (x1, y1, 9.05)]
        m.mesh(fan, [[0, 1, 2]], 'glass')
        if m.detail:
            m.beam([0.0, arch_y0, 9.12], [x0, y0, 9.12], 0.045, 'white', sections=4)
    # Entrance canopy header ('桂林微笑堂商厦 / GUILIN WEIXIAOTANG PLAZA')
    m.box(0, arch_y0 - 0.88, 8.92, 9.4, 0.96, 0.48, 'alum')
    m.sign_quad(0, arch_y0 - 0.84, 9.19, 8.4, 0.88, 'niko_arch')
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # Main corner curved blue-teal glass drum (y=6.6..26.0 m) + stepped upper cylinder (y=26.0..30.2 m)
    m.cylinder_y(corner_cx, 6.6, 19.4, corner_cz, 14.8, 'glass', sections=24 if m.detail else 10, collide=True)
    m.cylinder_y(corner_cx, 25.8, 0.55, corner_cz, 15.1, 'alum', sections=24 if m.detail else 10)
    m.cylinder_y(corner_cx, 26.3, 3.9, corner_cz, 12.8, 'glass', sections=20 if m.detail else 10)
    m.cylinder_y(corner_cx, 30.1, 0.45, corner_cz, 13.0, 'alum', sections=20 if m.detail else 10)

    # Giant dark glossy SMD LED billboard screen on floors 2..4 (00-2019.jpg)
    m.pose = (corner_cx, 0.0, corner_cz, corner_yaw)
    m.box(0, 9.4, 14.55, 13.8, 8.8, 0.65, 'dark')
    m.sign_quad(0, 9.82, 14.92, 13.0, 7.96, 'led_screen')

    # White cylindrical rooftop crown signboard drum (y=30.5..35.0 m) with real CJK & English lettering
    m.pose = (0.0, 0.0, 0.0, 0.0)
    m.cylinder_y(corner_cx, 30.5, 4.45, corner_cz, 11.2, 'white', sections=24 if m.detail else 10)
    m.cylinder_y(corner_cx, 34.85, 0.22, corner_cz, 11.35, 'alum', sections=24 if m.detail else 10)
    m.sign_arc(
        corner_cx, corner_cz, 11.30, 30.95, 3.55, corner_yaw,
        span_rad=1.54, sign_key='niko_crown', segs=18 if m.detail else 8,
    )
    if m.detail:
        # Three steel-and-blue-glass underground pedestrian passage canopies on NE forecourt
        for ux, uz, uyaw in ((52.5, -20.5, corner_yaw - 0.55), (46.8, -26.8, corner_yaw), (37.2, -33.2, corner_yaw + 0.55)):
            m.pose = (ux, 0.0, uz, uyaw)
            m.box(-1.65, 0.0, 0.0, 0.32, 1.05, 5.2, 'dark', collide=True)
            m.box(1.65, 0.0, 0.0, 0.32, 1.05, 5.2, 'dark', collide=True)
            m.box(0.0, 0.0, -2.45, 3.62, 1.05, 0.32, 'dark', collide=True)
            roof_v = [
                (-1.85, 2.55, 2.65), (1.85, 2.55, 2.65),
                (1.85, 1.25, -2.65), (-1.85, 1.25, -2.65),
            ]
            m.mesh(roof_v, [[0, 1, 2], [0, 2, 3]], 'glass')
            m.beam([-1.7, 1.05, 2.4], [-1.7, 2.5, 2.4], 0.07, 'alum', sections=5)
            m.beam([1.7, 1.05, 2.4], [1.7, 2.5, 2.4], 0.07, 'alum', sections=5)
        m.pose = (0.0, 0.0, 0.0, 0.0)

        for lx, lz in ((56.8, 12.0), (52.0, 34.0), (14.0, -39.5), (-14.0, -44.5)):
            m.cluster_lamp(lx, 0.08, lz, height=6.8, globes=5, collide=True)


if __name__ == '__main__':
    export_landmark('nikoniko', build_nikoniko)
