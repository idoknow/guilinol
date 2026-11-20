"""Guilin Book Market & Libin Road Streetscape (桂林图书市场 / 滨江大厦 / 环球国际酒店 / 漓滨路衔接).

Refined from Rock's walk photos 49-55 and 11-19 volumetric supplement:
1. Guilin Book Market (`桂林图书市场`, Libin Rd No. 4) & 7-storey Binjiang Mansion (`滨江大厦`):
   - Book Market occupies the 2-storey projecting commercial podium (1F shopfront 3.2 m,
     white-and-red billboard top 9.6 m) at the NE bays of the 7-storey Binjiang Mansion (main
     roof cornice 22.8 m, rooftop stairhead 24.8 m), with floors 4F-7F rising directly behind
     the billboard and a stepped 7F rooftop terrace with black iron railing on the right.
   - Left 5 residential/commercial bays feature a 1.65 m deeply recessed 1F eatery arcade
     ('滨江大厦 P 停车场 5元起', '桂林米粉 卤味火锅', '冰镇饮料 特色小吃'), 2F cantilevered
     grey-tile sloped rain eave, 3D projecting concrete balconies & protruding metal security
     grille cages with sloped sheet-metal rain hoods, and 18 3D external AC condenser boxes.
   - Adjacent 6-storey grey-white residential wing (19.4 m) steps down behind the school gate's
     left pylon (9.4 m), creating the 22.8 m -> 19.4 m -> 9.4 m skyline cascade in photos 52-54.
2. Hotel Universal Guilin (`环球国际酒店`, exact OSM `way/675919397`, 8 storeys, 27.85 m):
   - Exact `way/675919397` footprint at y=2.0 m audit slice (IoU=1.000).
   - 1F dark-bronze modern cantilevered canopy on SSE/East corner with bright warm-lit
     '鳥炭 · 六本' izakaya sign, hanging orange lanterns, warm lattice interior, and alley-side
     'P 环球国际酒店' pylon + 2-storey white inner annex (7.2 m) + 6F background block (19.8 m).
   - 2F projecting bevel-fluted glazed ribbon-window podium (7.45 m).
   - 3F-8F true 3D sawtooth angled bay-window prisms (projecting 1.18 m), bold vertical
     warm-gold architectural uplight strips (`_lit`), and 1.35 m cantilevered illuminated 8F cornice.
3. Terrain-Draped Granite Plazas, Bollards & South Ramp (`#50-#55`):
   - Exact chunk-terrain-draped East recessed checkerboard granite plaza (+2-step upper platform,
     wooden noodle table & 4 blue chairs, granite curb, and 19 cylindrical grey granite bollards),
     dark-asphalt Libin Road carriageway, and West granite forecourt (+6 bollards & stone lion).
   - South Ramp (`way/258909978`, #50): continuous stone-brick sidewalk + tactile strip + granite
     curb + bright white painted-metal karst-mountain guardrail + white-limewashed banyan trees.
"""
import math
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from m26_16_kit import SceneBuilder, export_landmark_glb, get_font, libin_street_base_y, libin_terrain_y

# Exact anchor in `public/world/manifest.json`: [-418.540411, 153.3, 90.117810]
ORIGIN_X = -418.5404
ORIGIN_Z = 90.1178
ORIGIN_Y = 153.30
ANCHOR_WORLD = (ORIGIN_X, ORIGIN_Y, ORIGIN_Z)

# Exact OSM `way/675919397` (Hotel Universal Guilin) relative to ORIGIN
HOTEL_PTS = [
    (-10.19, -112.16), (-15.51, -94.33), (14.90, -85.37), (5.36, -53.41),
    (-14.46, -59.25), (-19.73, -41.64), (10.03, -32.87), (19.21, -34.49),
    (24.54, -52.36), (38.14, -97.92),
]

# Exact Overture `c1096f2a-0237-419b-8fce-7ac49da6ad10` (Yunman Hotel block on East side of Libin Rd)
YUNMAN_PTS = [
    (48.13, 17.57), (51.71, 10.99), (22.73, -4.74), (11.98, 14.99),
    (30.43, 25.00), (-21.14, 119.75), (-6.64, 127.62), (52.08, 19.72),
]

# West-side street front normal facing ESE (115.57 deg) across Libin Road
LIBIN_FRONT = (0.9020, 0.4318)


def make_book_market_atlas():
    size = 1024
    im = Image.new('RGB', (size, size), (212, 208, 198))
    dr = ImageDraw.Draw(im)
    rects = {}

    # --- 1. GIANT '桂林图书市场' BILLBOARD (0, 0, 576, 320) — exact photo 52, 53, 54! ---
    bx, by, bw, bh = 0, 0, 576, 320
    rects['book_billboard'] = (bx, by, bw, bh)
    dr.rectangle((bx, by, bx + bw - 1, by + bh - 1), fill=(244, 242, 240), outline=(180, 176, 170), width=4)
    for vx in range(48, bw, 48):
        dr.line((vx, 6, vx, bh - 6), fill=(228, 226, 224), width=1)
    f_sub_top = get_font(28, bold=True, sans=True)
    f_main = get_font(86, bold=True, sans=True)
    f_redbar = get_font(22, bold=True, sans=True)
    f_addr = get_font(19, bold=True, sans=True)
    dr.text((bx + 32, by + 34), '【 滨江文化市场 】', fill=(156, 30, 28), font=f_sub_top, anchor='lm')
    dr.text((bx + bw // 2 + 2, by + 132 + 2), '桂林图书市场', fill=(120, 24, 22), font=f_main, anchor='mm')
    dr.text((bx + bw // 2, by + 132), '桂林图书市场', fill=(198, 28, 26), font=f_main, anchor='mm')
    dr.rectangle((bx + 24, by + 206, bx + bw - 25, by + 258), fill=(192, 30, 28))
    dr.text((bx + bw // 2, by + 232), '经营：图书 杂志 文体 电教 动漫 饰品 数码 乐器培训',
            fill=(250, 246, 236), font=f_redbar, anchor='mm')
    dr.text((bx + 28, by + 288), '地址：漓滨路4号 (本商城-1至2层)', fill=(48, 44, 42), font=f_addr, anchor='lm')
    dr.text((bx + bw - 28, by + 288), '电话：0773-2813333', fill=(48, 44, 42), font=f_addr, anchor='rm')

    # --- 2. WEATHERED 7F OLD APARTMENT WALL & SECURITY CAGE TEXTURES (576, 0, 448, 320) ---
    # 2a. Recessed apartment bay wall (`old_apt_wall`) (576, 0, 256, 320)
    ox, oy, ow, oh = 576, 0, 256, 320
    rects['old_apt_wall'] = (ox, oy, ow, oh)
    dr.rectangle((ox, oy, ox + ow - 1, oy + oh - 1), fill=(148, 134, 122))
    fl_h = oh // 2
    for r in range(2):
        fy = oy + r * fl_h
        dr.rectangle((ox, fy, ox + ow - 1, fy + 10), fill=(108, 98, 90))
        for c in range(2):
            cx0 = ox + c * (ow // 2)
            tone = ((r + c) % 2) * 8 - 4
            dr.rectangle((cx0 + 3, fy + 12, cx0 + ow // 2 - 4, fy + fl_h - 3),
                         fill=(150 + tone, 136 + tone, 124 + tone))
            wx0, wy0 = cx0 + 18, fy + 28
            wx1, wy1 = cx0 + ow // 2 - 18, fy + fl_h - 24
            w_fill = (204, 192, 148) if (r == 1 and c == 0) else (38, 44, 50)
            dr.rectangle((wx0, wy0, wx1, wy1), fill=w_fill, outline=(74, 68, 62), width=3)
            dr.line(((wx0 + wx1) // 2, wy0, (wx0 + wx1) // 2, wy1), fill=(86, 80, 74), width=2)

    # 2b. Protruding 3D security grille cage face (`cage_grille`) (832, 0, 192, 192) — photo 54!
    cx, cy, cw, ch = 832, 0, 192, 192
    rects['cage_grille'] = (cx, cy, cw, ch)
    dr.rectangle((cx, cy, cx + cw - 1, cy + ch - 1), fill=(36, 42, 48))
    # Lower concrete/brick parapet + upper wire security bars + inner window reflection
    dr.rectangle((cx, cy + 124, cx + cw - 1, cy + ch - 1), fill=(142, 124, 110))
    for bx_i in range(cx + 8, cx + cw, 12):
        dr.line((bx_i, cy + 124, bx_i, cy + ch - 2), fill=(96, 82, 72), width=2)
    dr.rectangle((cx + 16, cy + 18, cx + cw - 17, cy + 118), fill=(52, 62, 68))
    for gx in range(cx + 8, cx + cw, 9):
        dr.line((gx, cy + 4, gx, cy + 124), fill=(128, 132, 136), width=2)
    for gy in (cy + 6, cy + 44, cy + 84, cy + 122):
        dr.line((cx + 2, gy, cx + cw - 3, gy), fill=(138, 142, 146), width=3)

    # 2c. External AC condenser box front (`ac_unit`) (832, 192, 192, 128) — photo 54!
    ax, ay, aw, ah = 832, 192, 192, 128
    rects['ac_unit'] = (ax, ay, aw, ah)
    dr.rectangle((ax, ay, ax + aw - 1, ay + ah - 1), fill=(218, 216, 210), outline=(146, 144, 138), width=4)
    dr.ellipse((ax + 16, ay + 16, ax + 112, ay + 112), fill=(54, 58, 62), outline=(120, 122, 120), width=3)
    for r_ring in (18, 32):
        dr.ellipse((ax + 64 - r_ring, ay + 64 - r_ring, ax + 64 + r_ring, ay + 64 + r_ring), outline=(92, 96, 100), width=2)
    for vy in range(ay + 22, ay + 106, 10):
        dr.line((ax + 128, vy, ax + 174, vy), fill=(154, 152, 146), width=2)

    # --- 3. STREETFRONT GLOWING SHOP SIGNS (`_lit`) (0, 320, 1024, 320) ---
    rects['sign_parking'] = (0, 320, 288, 160)
    dr.rectangle((0, 320, 287, 479), fill=(252, 248, 240), outline=(224, 92, 42), width=5)
    dr.text((144, 352), '滨 江 大 厦', fill=(214, 72, 32), font=get_font(34, bold=True, sans=True), anchor='mm')
    dr.rectangle((22, 376, 68, 422), fill=(218, 82, 36))
    dr.text((45, 399), 'P', fill=(255, 252, 245), font=get_font(34, bold=True, sans=True), anchor='mm')
    dr.text((172, 399), '停 车 场', fill=(214, 72, 32), font=get_font(32, bold=True, sans=True), anchor='mm')
    dr.line((16, 430, 272, 430), fill=(214, 72, 32), width=2)
    dr.text((144, 454), '← 5 元 起', fill=(204, 62, 28), font=get_font(30, bold=True, sans=True), anchor='mm')

    rects['sign_mifen'] = (288, 320, 288, 160)
    dr.rectangle((288, 320, 575, 479), fill=(198, 32, 26), outline=(244, 196, 56), width=4)
    dr.text((432, 346), '西 村 稻 香', fill=(252, 232, 128), font=get_font(22, bold=True, sans=True), anchor='mm')
    dr.text((432, 394), '桂林米粉', fill=(255, 238, 76), font=get_font(46, bold=True, sans=False), anchor='mm')
    dr.text((432, 446), '卤味火锅', fill=(255, 238, 76), font=get_font(44, bold=True, sans=False), anchor='mm')

    rects['sign_book_1f'] = (576, 320, 448, 128)
    dr.rectangle((576, 320, 1023, 447), fill=(138, 32, 28), outline=(216, 168, 78), width=4)
    dr.text((688, 384), '名烟名酒', fill=(248, 216, 118), font=get_font(34, bold=True, sans=False), anchor='mm')
    dr.text((908, 384), '进口食品', fill=(248, 216, 118), font=get_font(34, bold=True, sans=False), anchor='mm')
    dr.rectangle((776, 336, 824, 432), fill=(68, 24, 22), outline=(216, 168, 78), width=2)

    rects['sign_yunman'] = (0, 480, 448, 112)
    dr.rectangle((0, 480, 447, 591), fill=(46, 48, 54), outline=(92, 96, 104), width=3)
    dr.ellipse((18, 504, 74, 566), outline=(248, 242, 224), width=4)
    dr.text((46, 535), '云', fill=(252, 246, 228), font=get_font(28, bold=True, sans=True), anchor='mm')
    dr.text((256, 536), '云漫智能轻奢酒店', fill=(252, 250, 244), font=get_font(38, bold=True, sans=True), anchor='mm')

    # '鳥炭 · 六本' bright glowing sign on dark bronze fascia (448, 480, 320, 112) — exact photo 55 right!
    rects['sign_toritan'] = (448, 480, 320, 112)
    dr.rectangle((448, 480, 767, 591), fill=(56, 54, 48), outline=(96, 90, 78), width=3)
    dr.text((608, 526), '鳥炭 · 六本', fill=(255, 248, 214), font=get_font(46, bold=True, sans=False), anchor='mm')
    dr.text((608, 570), '刺身 · 烧鸟 · 居酒屋', fill=(248, 194, 98), font=get_font(19, bold=True, sans=True), anchor='mm')

    rects['sign_snack'] = (768, 448, 176, 144)
    dr.rectangle((768, 448, 943, 591), fill=(58, 166, 198), outline=(238, 246, 250), width=4)
    dr.text((856, 492), '冰镇饮料', fill=(252, 252, 248), font=get_font(30, bold=True, sans=True), anchor='mm')
    dr.text((856, 548), '特色小吃', fill=(255, 236, 98), font=get_font(30, bold=True, sans=True), anchor='mm')

    rects['sign_hotel_p'] = (944, 448, 80, 192)
    dr.rectangle((944, 448, 1023, 639), fill=(44, 36, 46), outline=(140, 128, 144), width=2)
    dr.text((984, 474), 'P', fill=(240, 232, 240), font=get_font(28, bold=True, sans=True), anchor='mm')
    for idx, ch in enumerate('环球国际酒店'):
        dr.text((984, 508 + idx * 21), ch, fill=(228, 220, 228), font=get_font(17, bold=True, sans=False), anchor='mm')

    # --- 4. PAVING, ASPHALT, RAMP BRICK & HOTEL SWATCHES (0..1024, 608..1024) ---
    # 4a. Cellular grass-grid parking pavers (`grass_grid`) in photo 51 foreground (0, 608, 160, 192)
    rects['grass_grid'] = (0, 608, 160, 192)
    dr.rectangle((0, 608, 159, 799), fill=(132, 134, 134))
    for gy in range(614, 796, 18):
        for gx in range(6, 156, 18):
            dr.rectangle((gx, gy, gx + 11, gy + 11), fill=(52, 60, 52))

    # 4b. East-side plaza checkerboard grey/charcoal granite square slabs (`plaza_granite`) (160, 608, 192, 192) — photos 52-54!
    rects['plaza_granite'] = (160, 608, 192, 192)
    dr.rectangle((160, 608, 351, 799), fill=(104, 108, 112))
    for r_i, py in enumerate(range(608, 800, 32)):
        for c_i, px in enumerate(range(160, 352, 32)):
            if (r_i + c_i) % 5 == 0:
                col = (70, 74, 80)  # Dark charcoal granite accent tile (photo 52 foreground!)
            elif (r_i * 3 + c_i) % 3 == 0:
                col = (146, 150, 154)
            else:
                col = (160, 164, 168)
            dr.rectangle((px + 2, py + 2, px + 30, py + 30), fill=col)

    # 4c. West forecourt & ramp brick/granite paving with tactile strip (`ramp_paver`) (352, 608, 192, 192) — photo 50!
    rects['ramp_paver'] = (352, 608, 192, 192)
    dr.rectangle((352, 608, 543, 799), fill=(96, 100, 104))
    for py in range(608, 800, 24):
        for px in range(352, 544, 32):
            is_tactile = (424 <= px < 456)
            col = (126, 124, 116) if is_tactile else (154, 158, 162)
            dr.rectangle((px + 2, py + 2, px + 30, py + 22), fill=col)
            if is_tactile:
                for tx_i in range(px + 6, px + 28, 6):
                    dr.line((tx_i, py + 4, tx_i, py + 20), fill=(92, 90, 84), width=2)

    # 4d. Hotel Universal pale terrazzo stone (`hotel_stone`) (544, 608, 160, 192) — photo 55!
    rects['hotel_stone'] = (544, 608, 160, 192)
    dr.rectangle((544, 608, 703, 799), fill=(214, 212, 206))
    for hy in range(608, 800, 48):
        dr.line((544, hy, 703, hy), fill=(178, 176, 170), width=2)
    for hx in range(544, 704, 40):
        dr.line((hx, 608, hx, 799), fill=(184, 182, 176), width=1)

    # 4e. Mullioned dark-blue hotel bay window glass (`hotel_glass`) (704, 608, 160, 192) — photo 55!
    rects['hotel_glass'] = (704, 608, 160, 192)
    dr.rectangle((704, 608, 863, 799), fill=(42, 54, 66))
    for gx in (704, 756, 808, 858):
        dr.rectangle((gx, 608, gx + 5, 799), fill=(26, 30, 36))
    for gy in (608, 668, 790):
        dr.rectangle((704, gy, 863, gy + 6), fill=(26, 30, 36))

    # 4f. Dark urban asphalt carriageway (`road_asphalt`) (864, 640, 160, 160)
    rects['road_asphalt'] = (864, 640, 160, 160)
    dr.rectangle((864, 640, 1023, 799), fill=(68, 72, 78))
    for ay_i in range(648, 800, 16):
        for ax_i in range(872, 1020, 20):
            dr.rectangle((ax_i, ay_i, ax_i + 3, ay_i + 3), fill=(80, 84, 90))

    # 4g. Clean color swatches (0..1024, 816..992)
    swatches = [
        ('warm_glow',    (  0, 816, 88, 80), (255, 228, 148)),
        ('shop_interior',( 88, 816, 88, 80), (246, 208, 124)),
        ('dark_metal',   (176, 816, 88, 80), ( 50,  52,  56)),
        ('pale_stone',   (264, 816, 88, 80), (206, 204, 198)),
        ('granite',      (352, 816, 88, 80), (146, 150, 154)),
        ('gray_tile',    (440, 816, 88, 80), ( 74,  80,  86)),
        ('hedge',        (528, 816, 88, 80), ( 52,  84,  48)),
        ('foliage',      (616, 816, 88, 80), ( 48,  80,  46)),
        ('bark',         (704, 816, 88, 80), ( 94,  82,  68)),
        ('Yunman_wall',  (792, 816, 88, 80), (194, 192, 188)),
        ('white_wall',   (880, 816, 88, 80), (234, 232, 228)),
        ('stool_blue',   (  0, 904, 88, 80), (134, 148, 186)),
        ('table_wood',   ( 88, 904, 88, 80), (192, 144,  72)),
        ('rail_white',   (176, 904, 88, 80), (248, 251, 255)),
        ('rail_green',   (264, 904, 88, 80), (164, 204, 186)),
        ('red_trim',     (352, 904, 88, 80), (196,  42,  36)),
        ('hood_blue',    (440, 904, 88, 80), ( 82, 102, 122)),
        ('lantern_orange',(528, 904, 88, 80), (252, 178,  72)),
        ('lime_white',   (616, 904, 88, 80), (228, 230, 226)),
        ('slate_wall',   (704, 904, 88, 80), (116, 122, 128)),
    ]
    for key, (x, y, w, h), rgb in swatches:
        rects[key] = (x, y, w, h)
        dr.rectangle((x, y, x + w - 1, y + h - 1), fill=rgb)

    return im, rects


def _build_book_market_and_binjiang(b: SceneBuilder):
    """Guilin Book Market 2-storey podium + 7-storey Binjiang Mansion + 6-storey stepped neighbour
    + full terrain-draped grey granite plazas, curbs, bollards & noodle table (photos 52-54!)."""
    bm_y0 = 0.20  # Street datum ~153.50 m relative to ORIGIN_Y=153.30 m
    bm_origin = (-422.60 - ORIGIN_X, bm_y0, 84.95 - ORIGIN_Z)
    prev = b.set_frame(origin=bm_origin, front_xz=LIBIN_FRONT)

    # --- A. TERRAIN-DRAPED STREET, GRANITE PLAZAS, CURBS & BOLLARDS (flush with IDOK-48 SIDE_ROAD `way/675174045`!) ---
    # 1. West-side raised eatery sidewalk apron (`lift=0.34 m`) + main West granite forecourt (`lift=0.18 m`)
    b.draped_patch(
        ANCHOR_WORLD, -33.0, -5.2, 0.8, 4.8, 'plaza_granite', curb_region='granite',
        lift=0.34, skirt=0.55, step=2.6, curb_edges=('+z',), curb_h=0.02, collide=False, height_fn=libin_street_base_y,
    )
    b.draped_patch(
        ANCHOR_WORLD, -33.0, 8.6, 4.8, 10.4, 'plaza_granite', curb_region='granite',
        lift=0.18, skirt=0.65, step=2.4, curb_edges=('+z',), curb_h=0.05, curb_w=0.22, collide=False, height_fn=libin_street_base_y,
    )
    b.draped_patch(
        ANCHOR_WORLD, -5.2, 8.6, 0.6, 4.8, 'plaza_granite', curb_region='granite',
        lift=0.18, skirt=0.55, step=2.6, collide=False, height_fn=libin_street_base_y,
    )
    # West sidewalk continuing NE past school gate in front of Hotel Universal (`x = +31..+43.5`, >8.5m clear of South Ramp!)
    b.draped_patch(
        ANCHOR_WORLD, 31.0, 43.5, -1.0, 10.4, 'plaza_granite', curb_region='granite',
        lift=0.18, skirt=0.85, step=2.4, curb_edges=('+z', '+x'), curb_h=0.05, curb_w=0.22, collide=False, height_fn=libin_street_base_y,
    )

    # 2. Libin Road dark-asphalt carriageway:
    #    - South section (`x = -34.0 .. +5.65, z = +10.4 .. +21.48`) meets IDOK-48 SIDE_ROAD (`x=5.6, z=15.44..21.44`) flush!
    #    - North-West shoulder (`x = +5.60 .. +44.5, z = +10.4 .. +15.44`) bridges West sidewalk to SIDE_ROAD west edge (`z=15.44`)!
    b.draped_patch(
        ANCHOR_WORLD, -34.0, 5.65, 10.4, 21.48, 'road_asphalt', curb_region='road_asphalt',
        lift=0.01, skirt=0.45, step=1.8, collide=False, height_fn=libin_street_base_y,
    )
    b.draped_patch(
        ANCHOR_WORLD, 5.60, 44.5, 10.4, 15.44, 'road_asphalt', curb_region='road_asphalt',
        lift=0.005, skirt=0.60, step=1.6, collide=False, height_fn=libin_street_base_y,
    )

    # 3. East-side Recessed Checkerboard Granite Plaza (`#52, #53, #54` foreground, `z = +21.48 .. +26.2 m`, outside SIDE_ROAD!)
    # plus 2-step raised inner sidewalk platform (`z = +26.2 .. +31.8 m`, `lift=0.34 m`, left foreground of #52 & #54!)
    b.draped_patch(
        ANCHOR_WORLD, -18.0, 33.2, 21.48, 26.2, 'plaza_granite', curb_region='granite',
        lift=0.16, skirt=0.80, step=1.8, curb_edges=('-z', '+x'), curb_h=0.05, curb_w=0.24, collide=False, height_fn=libin_street_base_y,
    )
    b.draped_patch(
        ANCHOR_WORLD, -18.0, 15.0, 26.2, 31.8, 'plaza_granite', curb_region='granite',
        lift=0.34, skirt=0.65, step=2.4, curb_edges=('-z', '+x'), curb_h=0.02, collide=False, height_fn=libin_street_base_y,
    )
    # Intermediate granite step tread along `z = +25.75..26.20 m` (two-step riser clearly visible next to blue stools in #52 & #54!)
    b.draped_patch(
        ANCHOR_WORLD, -18.0, 15.0, 25.75, 26.20, 'granite', curb_region='granite',
        lift=0.26, skirt=0.35, step=2.4, curb_edges=('-z',), curb_h=0.01, collide=False, height_fn=libin_street_base_y,
    )

    if b.detail:
        # Row of 19 cylindrical grey granite bollards with carved groove & red reflector cap along East plaza curb (`z = 21.92`)!
        for bx in np.linspace(-5.8, 15.6, 19):
            lp = b.xf((float(bx), 0.0, 21.92))
            by0 = libin_street_base_y(ORIGIN_X + lp[0], ORIGIN_Z + lp[2]) + 0.18 - ORIGIN_Y - bm_y0
            b.cylinder_y(float(bx), by0, 0.44, 21.92, 0.165, 'pale_stone', sections=10, collide=True)
            b.cylinder_y(float(bx), by0 + 0.34, 0.03, 21.92, 0.148, 'granite', sections=10)
            b.cylinder_y(float(bx), by0 + 0.44, 0.045, 21.92, 0.167, 'red_trim', sections=10)

        # Second row of 7 granite bollards along West sidewalk edge in front of Binjiang Mansion eateries
        for bx in np.linspace(-15.5, -7.5, 7):
            lp = b.xf((float(bx), 0.0, 10.05))
            by0 = libin_street_base_y(ORIGIN_X + lp[0], ORIGIN_Z + lp[2]) + 0.18 - ORIGIN_Y - bm_y0
            b.cylinder_y(float(bx), by0, 0.44, 10.05, 0.15, 'pale_stone', sections=8, collide=True)
            b.cylinder_y(float(bx), by0 + 0.44, 0.04, 10.05, 0.152, 'red_trim', sections=8)

        # Signature foreground street furniture in #52 & #54: wooden noodle table + 4 moulded blue plastic chairs!
        tx, tz = 3.8, 23.8
        lp = b.xf((tx, 0.0, tz))
        ty = libin_street_base_y(ORIGIN_X + lp[0], ORIGIN_Z + lp[2]) + 0.19 - ORIGIN_Y - bm_y0
        b.box(tx, ty + 0.52, tz, 0.92, 0.05, 0.72, 'table_wood', tile=1.0)
        for lx_o, lz_o in ((-0.38, -0.28), (0.38, -0.28), (-0.38, 0.28), (0.38, 0.28)):
            b.box(tx + lx_o, ty, tz + lz_o, 0.05, 0.52, 0.05, 'dark_metal', tile=0.5)
        for sx_o, sz_o, back_dx, back_dz in (
            (-0.74, 0.04, -0.14, 0.0),
            (0.74, -0.04, 0.14, 0.0),
            (-0.04, -0.64, 0.0, -0.14),
            (0.06, 0.64, 0.0, 0.14),
        ):
            cx_s, cz_s = tx + sx_o, tz + sz_o
            b.box(cx_s, ty, cz_s, 0.36, 0.36, 0.36, 'stool_blue', tile=0.5)
            bw_s = 0.07 if abs(back_dx) > 0 else 0.34
            bd_s = 0.34 if abs(back_dx) > 0 else 0.07
            b.box(cx_s + back_dx, ty + 0.36, cz_s + back_dz, bw_s, 0.30, bd_s, 'stool_blue', tile=0.5)

    # --- B. GUILIN BOOK MARKET 2-STOREY PROJECTING PODIUM (`x in [-5.6, +6.8]`, billboard top = 9.60 m) ---
    b.box(0.60, -1.20, -1.80, 12.40, 10.80, 6.20, 'pale_stone', cap_region='granite', tile=3.0, collide=True)
    # Recessed 1F shopfront ('名烟名酒 · 进口食品') + grey-tile rain hood
    b.box(0.60, 2.95, 1.55, 12.40, 0.34, 1.15, 'gray_tile', tile=1.8)
    b.sign_quad(0.60, 2.35, 1.24, 12.00, 1.12, 'sign_book_1f', normal=(0, 0, 1), lit=True)
    b.box(-2.30, 0.22, 1.02, 4.40, 1.65, 0.14, 'shop_interior', tile=1.5, lit=True)
    b.box(3.60, 0.22, 1.02, 4.20, 1.65, 0.14, 'shop_interior', tile=1.5, lit=True)
    # Giant '【滨江文化市场】桂林图书市场' white-and-red billboard (y = 3.25 .. 9.60 m, w = 12.2 m, h = 6.35 m)!
    b.box(0.60, 3.22, 1.32, 12.35, 6.40, 0.28, 'dark_metal', tile=2.0)
    b.sign_quad(0.60, 6.42, 1.48, 12.20, 6.28, 'book_billboard', normal=(0, 0, 1), lit=False)

    # Book Market front hedge planter & Guardian Stone Lion (photos 52 & 54!)
    lp_bm = b.xf((-0.40, 0.0, 3.40))
    py_bm = libin_street_base_y(ORIGIN_X + lp_bm[0], ORIGIN_Z + lp_bm[2]) + 0.18 - ORIGIN_Y - bm_y0
    b.box(-0.40, py_bm - 0.12, 3.40, 6.20, 0.56, 2.30, 'granite', cap_region='hedge', tile=1.8, collide=True)
    b.box(-0.40, py_bm + 0.44, 3.40, 5.85, 0.50, 1.95, 'hedge', tile=1.5, collide=True)
    b.stone_lion(0.75, py_bm + 0.90, 3.45, scale=1.25, region='pale_stone')

    # --- C. 7-STOREY BINJIANG MANSION (`滨江大厦`, total 7 storeys, main cornice = 22.8 m, stairhead = 24.8 m) ---
    # 1. Left 5 bays (`x in [-32.5, -5.6]`, length 26.9 m):
    #    - 1F deeply recessed commercial arcade (`z_recess = -0.45 m`, 1.65 m behind front piers at `z = +1.20 m`!)
    #    - 2F-7F residential block (`y = 3.85 .. 22.80 m`), with Bay 5 (`x in [-11.0, -5.6]`) 7F recessed as terrace!
    apt_y0 = 0.20
    b.box(-19.05, -0.80, -5.20, 26.90, 4.65, 9.60, 'dark_metal', cap_region='granite', tile=2.8, collide=True)
    # 6 heavy square structural piers creating genuine 1.65 m 1F storefront recess depth!
    for pier_x in np.linspace(-32.2, -5.9, 6):
        b.box(float(pier_x), apt_y0, 0.55, 0.62, 3.70, 1.45, 'granite', tile=1.8, collide=True)
    # Recessed glowing 1F shop interiors (`z = -0.25 m`) & forward hanging illuminated signs (`z = +1.42 m`)
    for sx in (-29.5, -24.2, -18.8, -13.5, -8.4):
        b.box(sx, apt_y0 + 0.15, -0.25, 4.10, 2.55, 0.18, 'shop_interior', tile=2.0, lit=True)
    b.sign_quad(-24.0, apt_y0 + 2.65, 1.48, 4.50, 2.35, 'sign_parking', normal=(0, 0, 1), lit=True)
    b.sign_quad(-19.1, apt_y0 + 2.65, 1.48, 4.40, 2.35, 'sign_mifen', normal=(0, 0, 1), lit=True)
    b.sign_quad(-13.8, apt_y0 + 2.45, 1.38, 3.40, 1.90, 'sign_snack', normal=(0, 0, 1), lit=True)

    # 2F cantilevered sloped grey-tile rain eave across eatery frontage (`z = +1.10 -> +2.55 m`, photo 54!)
    b.face([(-32.4, 3.72, 2.55), (-5.6, 3.72, 2.55), (-5.6, 4.25, 1.05), (-32.4, 4.25, 1.05)],
           (0, 0.92, 0.38), 'gray_tile', tile=1.8)
    b.box(-19.0, 3.60, 1.80, 26.8, 0.14, 1.50, 'dark_metal', bottom=True, tile=2.0)

    # Upper floors 2F..6F core (`y = 3.85 .. 19.65 m`, full 26.9 m width) + 7F (`y = 19.65 .. 22.80 m`, stepped right!)
    b.box(-19.05, 3.85, -4.40, 26.90, 15.80, 11.10, 'granite', cap_region='granite', tile=2.8, collide=True)
    b.box(-21.75, 19.65, -4.40, 21.50, 3.15, 11.10, 'granite', cap_region='granite', tile=2.8, collide=True)
    # Stepped 7F recessed wall on right bay (`x in [-11.0, -5.6]`) + rooftop terrace railing (`#54`!)
    b.box(-8.30, 19.65, -5.50, 5.40, 3.15, 8.90, 'granite', cap_region='granite', tile=2.6, collide=True)
    b.box(-8.30, 19.65, 1.05, 5.30, 1.08, 0.12, 'dark_metal', tile=1.2)
    # Sloped concrete roof cornice + rooftop stairhead penthouse (`top = 24.80 m`)
    b.box(-21.75, 22.80, -4.20, 22.10, 0.32, 11.90, 'pale_stone', cap_region='granite', tile=2.8)
    b.box(-22.50, 23.12, -5.20, 5.60, 1.68, 4.80, 'granite', cap_region='gray_tile', tile=2.4)

    # 2. Right 2 bays of 7-storey Binjiang Mansion rising DIRECTLY BEHIND Book Market billboard (`x in [-5.6, +5.8]`, photo 54!)
    #    Set back at `z_front = -0.85 m` (2.3 m behind billboard face) so Book Market is clearly its 2-storey podium!
    b.box(0.10, 3.85, -5.45, 11.40, 18.95, 9.20, 'pale_stone', cap_region='granite', tile=2.8, collide=True)
    b.box(0.10, 22.80, -5.35, 11.90, 0.34, 9.80, 'pale_stone', cap_region='granite', tile=2.6)
    # 4F-7F window panels & 3D security cages + AC boxes visible above the 9.6 m billboard in #54!
    for fl_idx in range(4):
        wy_c = 11.15 + fl_idx * 3.05
        b.sign_quad(-2.6, wy_c, -0.80, 4.8, 2.85, 'old_apt_wall', normal=(0, 0, 1), lit=False)
        b.sign_quad(2.8, wy_c, -0.80, 4.8, 2.85, 'old_apt_wall', normal=(0, 0, 1), lit=False)
        if b.detail:
            # 3D protruding security grille cage + sloped blue sheet-metal hood + 3D white AC condenser box!
            cg_x = -2.8 if fl_idx % 2 == 0 else 2.6
            b.box(cg_x, wy_c - 1.05, -0.46, 3.20, 2.15, 0.68, 'cage_grille', tile=1.8)
            b.box(cg_x, wy_c + 1.12, -0.38, 3.45, 0.10, 0.88, 'hood_blue', tile=1.5)
            ac_x = cg_x + (2.25 if cg_x < 0 else -2.25)
            b.box(ac_x, wy_c - 0.85, -0.58, 0.88, 0.58, 0.42, 'pale_stone', tile=1.0)
            b.sign_quad(ac_x, wy_c - 0.56, -0.36, 0.84, 0.54, 'ac_unit', normal=(0, 0, 1), lit=False)
    # Rooftop iron railing & pergola frame on top of the right 7F roof (`y = 23.14 .. 24.35 m`, exact photo 54 top!)
    if b.detail:
        b.box(2.40, 23.14, -1.05, 6.40, 1.15, 0.10, 'dark_metal', tile=1.2)
        b.box(5.55, 23.14, -3.20, 0.10, 1.15, 4.30, 'dark_metal', tile=1.2)

    # 3. Rich 3D Volumetric Articulation across the 5 Left Bays (`x in [-32.5, -5.6]`, floors 2F..7F):
    #    Vertical structural piers + recessed window bays + 3D projecting balconies & wire security cages + 14 AC units!
    bay_centers = [-29.8, -24.4, -19.0, -13.6, -8.3]
    for b_idx, bx_c in enumerate(bay_centers):
        # Vertical concrete structural pier between bays (`protruding 0.30 m` from main wall `z = +1.15 m`)
        b.box(bx_c - 2.55, 3.85, 1.25, 0.42, 18.95 if b_idx < 4 else 15.80, 0.36, 'granite', tile=2.0)
        max_fl = 6 if b_idx < 4 else 5  # 6 upper floors (2F..7F) on bays 0..3; 5 upper floors (2F..6F) on stepped bay 4!
        for fl in range(max_fl):
            fy0 = 4.00 + fl * 3.12
            # Horizontal floor slab ledge
            b.box(bx_c, fy0 - 0.14, 1.28, 4.95, 0.18, 0.38, 'granite', tile=2.0)
            # Base recessed bay wall
            b.sign_quad(bx_c, fy0 + 1.46, 1.18, 4.65, 2.88, 'old_apt_wall', normal=(0, 0, 1), lit=False)
            if not b.detail:
                continue
            # Alternate deep 3D projecting enclosed concrete balconies (`0.92 m` projection)
            # and cantilevered 3D metal security grille cages (`0.68 m` projection + sloped rain hood)!
            if (b_idx + fl) % 2 == 0:
                # Full-bay 3D projecting balcony + security grille front + sloped sheet-metal hood
                b.box(bx_c, fy0, 1.62, 4.15, 0.92, 0.92, 'old_apt_wall', cap_region='granite', tile=1.8)
                b.box(bx_c, fy0 + 0.92, 1.60, 4.10, 1.68, 0.88, 'cage_grille', tile=1.9)
                b.box(bx_c, fy0 + 2.60, 1.68, 4.35, 0.12, 1.06, 'hood_blue', tile=1.5)
                if (b_idx == 1 and fl == 1) or (b_idx == 3 and fl == 2):
                    b.box(bx_c, fy0 + 1.05, 2.06, 2.50, 1.30, 0.06, 'warm_glow', lit=True)
            else:
                # Half-bay protruding security cage on left + external 3D AC condenser box on right!
                b.box(bx_c - 0.75, fy0 + 0.35, 1.50, 2.75, 2.05, 0.68, 'cage_grille', tile=1.6)
                b.box(bx_c - 0.75, fy0 + 2.40, 1.58, 2.95, 0.11, 0.84, 'gray_tile', tile=1.4)
                # 3D External AC outdoor condenser unit (`0.88 x 0.58 x 0.42 m`) on wall bracket!
                ac_x = bx_c + 1.45
                b.box(ac_x, fy0 + 0.42, 1.40, 0.88, 0.58, 0.42, 'pale_stone', tile=1.0)
                b.sign_quad(ac_x, fy0 + 0.71, 1.63, 0.84, 0.54, 'ac_unit', normal=(0, 0, 1), lit=False)

    # --- D. STEPPED 6-STOREY GREY-WHITE RESIDENTIAL WING BEHIND LEFT GATE PYLON (`h = 19.4 m`, photos 52-54!) ---
    # Sits right between Binjiang Mansion (7F, 22.8 m) and No. 9 Gate Left Pylon (9.4 m), set back to `z_front = -3.8 m`!
    wing = [(5.90, -12.60), (15.70, -12.60), (15.70, -11.20), (13.20, -11.20),
            (13.20, -8.85), (10.00, -8.85), (10.00, -3.80), (5.90, -3.80)]
    b.prism(wing, 0.0, 19.00, 'white_wall', cap_region='gray_tile', tile=2.8, collide=True)
    # Pitched dark-grey tiled overhanging roof cornice (`top = 19.45 m`)
    cornice = [(5.55, -12.95), (16.05, -12.95), (16.05, -10.85), (13.55, -10.85),
               (13.55, -8.50), (10.35, -8.50), (10.35, -3.45), (5.55, -3.45)]
    b.prism(cornice, 19.00, 0.45, 'gray_tile', tile=2.0)
    if b.detail:
        for fl in range(2, 6):
            wy = fl * 3.05 + 1.20
            b.box(8.80, wy, -3.55, 2.40, 1.65, 0.52, 'cage_grille', tile=1.5)
            b.box(8.80, wy + 1.65, -3.50, 2.60, 0.10, 0.65, 'gray_tile', tile=1.2)
            b.box(6.65, wy + 0.20, -3.60, 0.82, 0.54, 0.38, 'pale_stone', tile=1.0)

    # --- E. GAP RIGHT OF GATE: 2-STOREY WHITE ANNEX (`h = 7.2 m`) + 1F BOOTH + 6F BACKGROUND BLOCK (`#53` & `#55`!) ---
    # Right pylon of No. 9 Gate is around `x = +28.8 m` in `bm_origin` frame (`world -410.8, 60.3`).
    # Immediately to its right (`x in [+31.8, +38.2]`, recessed to `z_front = -3.6 m`): 2F white-walled annex!
    b.box(35.0, 0.20, -6.80, 6.40, 7.00, 6.40, 'white_wall', cap_region='granite', tile=2.4, collide=True)
    b.box(35.0, 7.20, -6.65, 7.00, 0.26, 7.00, 'pale_stone', cap_region='granite', tile=2.2)
    # Recessed 2F balcony + thin white railing + maroon doors (exact #53 right & #55 lower-center!)
    b.box(35.0, 3.70, -3.48, 5.80, 0.18, 0.65, 'white_wall', tile=1.5)
    b.box(35.0, 3.88, -3.22, 5.60, 0.92, 0.08, 'rail_white', tile=1.0)
    for dx_a in (33.6, 36.2):
        b.box(dx_a, 4.10, -3.58, 1.05, 2.15, 0.10, 'red_trim', tile=1.0)
    # 1F dark-grey alley gatehouse booth (`h = 3.25 m`) & black iron fence at alley entrance
    b.box(34.6, 0.20, -0.45, 3.40, 3.05, 2.60, 'dark_metal', cap_region='granite', tile=1.8, collide=True)
    b.box(34.6, 1.15, 0.86, 2.10, 1.40, 0.08, 'hotel_glass', tile=1.5)
    # Deeper 6-storey slate-grey background residential building visible in the alley gap in #55 (`h = 19.8 m`)!
    b.box(36.5, 0.0, -17.5, 10.5, 19.80, 9.50, 'slate_wall', cap_region='gray_tile', tile=3.0, collide=False)

    b.restore_frame(prev)


def _add_sawtooth_bay(b: SceneBuilder, x_center: float, y0: float, width: float, fl_h: float, warm_room: bool):
    """True 3D asymmetric sawtooth angled bay window prism (projecting 1.18 m outward, exact photo 55!).
    Left edge starts at z=+0.22 m, angles out to apex at (x0 + 0.68*w, z=+1.18 m), and returns sharply to z=+0.18 m."""
    x0 = x_center - width * 0.44
    x1 = x_center + width * 0.44
    xa = x0 + (x1 - x0) * 0.68
    z0, za, z1 = 0.22, 1.18, 0.18

    sp_h = 1.06                  # Pale terrazzo stone spandrel height
    gl_h = fl_h - sp_h - 0.28    # Dark 3-pane mullioned window height (~1.96 m)
    y_sp = y0 + sp_h
    y_gl = y_sp + gl_h
    y_top = y0 + fl_h

    # Normals for long angled face (x0,z0)->(xa,za) and short return face (xa,za)->(x1,z1)
    n_long = (-(za - z0), 0.0, xa - x0)
    n_ret = (-(z1 - za), 0.0, x1 - xa)

    # Bottom soffit & top cap of sawtooth projection
    b.face([(x0, y0, 0.0), (x1, y0, 0.0), (x1, y0, z1), (xa, y0, za), (x0, y0, z0)], (0, -1, 0), 'hotel_stone', tile=2.0)
    b.face([(x0, y_top, z0), (xa, y_top, za), (x1, y_top, z1), (x1, y_top, 0.0), (x0, y_top, 0.0)], (0, 1, 0), 'hotel_stone', tile=2.0)

    # Spandrel + top lintel bands (bright cream stone on front face, shaded cool grey on sharp return cheek for 3D zigzag pop!)
    for ya, yb in ((y0, y_sp), (y_gl, y_top)):
        b.face([(x0, ya, z0), (xa, ya, za), (xa, yb, za), (x0, yb, z0)], n_long, 'white_wall', tile=2.2)
        b.face([(xa, ya, za), (x1, ya, z1), (x1, yb, z1), (xa, yb, za)], n_ret, 'slate_wall', tile=2.2)
        b.face([(x0, ya, 0.0), (x0, ya, z0), (x0, yb, z0), (x0, yb, 0.0)], (-1, 0, 0), 'slate_wall', tile=1.5)
        b.face([(x1, ya, z1), (x1, ya, 0.0), (x1, yb, 0.0), (x1, yb, z1)], (1, 0, 0), 'slate_wall', tile=1.5)

    # Mullioned glass band (clamped UV so dark window frames align cleanly on every bay!)
    glass_reg = 'shop_interior' if warm_room else 'hotel_glass'
    b.face(
        [(x0, y_sp, z0), (xa, y_sp, za), (xa, y_gl, za), (x0, y_gl, z0)],
        n_long,
        glass_reg,
        uvs=[(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)],
        lit=warm_room,
    )
    b.face(
        [(xa, y_sp, za), (x1, y_sp, z1), (x1, y_gl, z1), (xa, y_gl, za)],
        n_ret,
        'hotel_glass',
        uvs=[(0.0, 1.0), (0.5, 1.0), (0.5, 0.0), (0.0, 0.0)],
        lit=False,
    )


def _build_universal_hotel(b: SceneBuilder):
    """8-Storey Hotel Universal Guilin (`环球国际酒店`, exact OSM `way/675919397`, total height = 27.85 m, photo 55!)."""
    y0 = 0.15  # Preserves ~153.45 m datum above ORIGIN_Y=153.30 m
    podium_top = 7.45     # Top of 2F projecting ribbon-window podium
    tower_top = 27.25     # Top of 8F sawtooth bay floors (6 tower floors x 3.30 m = 19.80 m)
    cornice_top = 27.85   # Cantilevered 8F illuminated roof cornice

    # 1. Exact OSM `way/675919397` 1F base extrusion (extended down to y=-4.60 m for IDOK-48 graded NE terrain; IoU=0.999 at y=+2.0m!)
    b.prism(HOTEL_PTS, -4.60, y0 + 3.15 - (-4.60), 'dark_metal', cap_region='white_wall', tile=3.2, collide=True,footing=True)
    # Split L-compound above y = 3.15 m to match real-world heights in photos #52, #53 & #55:
    # - SW annex wing behind school gate rises to 2 storeys (`h = 7.20 m` white stucco, leaving open sky above '公為下天'!)
    hotel_west_annex = [(-14.46, -59.25), (-19.73, -41.64), (1.60, -35.35), (5.36, -53.41)]
    b.prism(hotel_west_annex, y0 + 3.15, 4.40, 'white_wall', cap_region='granite', tile=2.6, collide=True)
    # - Main East 8-storey Hotel Universal tower (`h = 27.85 m`) rises east of the alley!
    hotel_east_tower = [
        (-10.19, -112.16), (-15.51, -94.33), (14.90, -85.37), (5.36, -53.41),
        (1.60, -35.35), (10.03, -32.87), (19.21, -34.49), (24.54, -52.36), (38.14, -97.92),
    ]
    b.prism(hotel_east_tower, y0 + 3.15, tower_top - 3.15, 'hotel_stone', cap_region='granite', tile=3.6, collide=True)

    # 2. Street- & alley-facing wings with 2F glazed podium + 3F-8F 3D sawtooth bays + vertical gold uplight strips!
    bay_edges = [
        ((5.36, -53.41), (1.60, -35.35), 4, True),
        ((1.60, -35.35), (10.03, -32.87), 2, True),
        ((10.03, -32.87), (19.21, -34.49), 2, True),
        ((19.21, -34.49), (38.14, -97.92), 13, False),
    ]
    for e_idx, (a, c, n_bays, has_podium_ribbon) in enumerate(bay_edges):
        dx, dz = c[0] - a[0], c[1] - a[1]
        seg = math.hypot(dx, dz)
        p_f = b.set_frame(origin=((a[0] + c[0]) / 2.0, y0, (a[1] + c[1]) / 2.0), front_xz=(-dz, dx))

        # 2a. 2F Projecting Glazed Podium (`y = 3.95 .. 7.45 m`, strictly above y=2.0m!)
        if has_podium_ribbon or e_idx == 2:
            pod_proj = 0.88
            b.box(0.0, 3.95, pod_proj / 2, seg + 0.4, 0.42, pod_proj, 'hotel_stone', tile=2.2)
            b.box(0.0, 4.37, pod_proj / 2 - 0.04, seg + 0.2, 2.38, pod_proj - 0.08, 'hotel_glass', tile=2.4)
            # Fluted bevel pale-stone 2F upper cornice + warm linear LED strip (`#55`!)
            b.box(0.0, 6.75, pod_proj / 2 + 0.04, seg + 0.5, 0.70, pod_proj + 0.08, 'hotel_stone', tile=2.0)
            if b.detail:
                b.box(0.0, 6.70, pod_proj + 0.02, seg * 0.96, 0.10, 0.12, 'warm_glow', lit=True)

        # 2b. Deep 1.35 m cantilevered 8F roof cornice (`y = 27.25 .. 27.85 m`) + warm glowing soffit!
        b.box(0.0, tower_top, 0.68, seg + 1.2, cornice_top - tower_top, 1.36, 'hotel_stone', cap_region='granite', tile=2.8)
        if b.detail:
            b.box(0.0, tower_top - 0.08, 0.58, seg * 0.96, 0.10, 0.85, 'warm_glow', bottom=True, lit=True)

        # 2c. 3F-8F True 3D Sawtooth Angled Bay Windows & Vertical Gold Uplight Strips!
        pitch = seg / n_bays
        for k in range(n_bays):
            bx = -seg / 2.0 + (k + 0.5) * pitch
            if b.detail:
                # Prominent 0.26 m wide 3D vertical warm-gold uplight channel strip (`lit=True`, photo 55!)
                ux_strip = -seg / 2.0 + k * pitch
                b.box(ux_strip, podium_top + 0.05, 0.20, 0.26, tower_top - podium_top - 0.10, 0.5, 'warm_glow', lit=True)
            for fl in range(6):
                fy = podium_top + fl * 3.30
                warm_rm = b.detail and ((e_idx == 1 and fl in (1, 4)) or (e_idx == 0 and k == n_bays - 1 and fl == 3))
                if b.detail:
                    _add_sawtooth_bay(b, bx, fy, pitch, 3.30, warm_rm)
                else:
                    b.box(bx, fy + 0.8, 0.35, pitch * 0.8, 1.8, 0.65, 'hotel_glass', tile=2.0)
        if b.detail:
            b.box(seg / 2.0 - 0.12, podium_top + 0.05, 0.20, 0.26, tower_top - podium_top - 0.10, 0.5, 'warm_glow', lit=True)

        b.restore_frame(p_f)

    # 3. 1F Dark-Bronze Cantilevered Canopy + '鳥炭 · 六本' Glowing Sign + Orange Lanterns (`#55` right!)
    #    Mounted directly on SSE corner edge `(10.03, -32.87) -> (19.21, -34.49)` facing SSE toward `#55` camera,
    #    and wrapping around `(19.21, -34.49)` onto the lower East frontage!
    a_iz, c_iz = (10.03, -32.87), (19.21, -34.49)
    dx_i, dz_i = c_iz[0] - a_iz[0], c_iz[1] - a_iz[1]
    seg_i = math.hypot(dx_i, dz_i)  # 9.32 m
    iz_f = b.set_frame(origin=((a_iz[0] + c_iz[0]) / 2.0, y0, (a_iz[1] + c_iz[1]) / 2.0), front_xz=(-dz_i, dx_i))
    # Deep dark-bronze modern canopy (`y = 2.95 .. 4.02 m`, strictly > y=2.0m!)
    b.box(0.30, 2.95, 1.05, seg_i + 1.40, 1.05, 2.10, 'dark_metal', tile=2.0, collide=False,bottom=True)
    # Bright glowing '鳥炭 · 六本' sign across the front fascia!
    b.sign_quad(0.60, 3.48, 2.13, 7.80, 0.96, 'sign_toritan', normal=(0, 0, 1), lit=True)
    # Warm glowing Japanese wood-lattice storefront & row of 5 hanging orange paper lanterns (`#55`!)
    b.box(0.60, 0.25, 0.22, 7.40, 2.65, 0.18, 'shop_interior', tile=1.8, lit=True)
    if b.detail:
        for lx_i in np.linspace(-2.2, 2.6, 5):
            b.cylinder_y(float(lx_i),2.78,.20,1.55,.045,'dark_metal',sections=6)
            b.cylinder_y(float(lx_i), 2.38, 0.42, 1.55, 0.18, 'lantern_orange', sections=8, lit=True)
    # Dark vertical parking pylon sign 'P 环球国际酒店' on left side by alley mouth (`#55`!)
    lp_hp = b.xf((-4.60, 0.0, 2.55))
    py_hp = libin_street_base_y(ORIGIN_X + lp_hp[0], ORIGIN_Z + lp_hp[2]) + 0.18 - ORIGIN_Y - y0
    b.box(-4.60, b.grade(-4.6,2.55)-.04, 2.55, 0.62, 2.40, 0.24, 'dark_metal', tile=1.0, collide=True)
    b.sign_quad(-4.60, py_hp + 1.13, 2.69, 0.56, 2.05, 'sign_hotel_p', normal=(0, 0, 1), lit=True)
    # Stepped granite entrance stairs beneath Toritan storefront down to graded NE sidewalk
    b.box(0.60, -2.80, 0.68, 8.20, 3.05, 1.15, 'granite', tile=1.8, collide=True)
    b.restore_frame(iz_f)

    # Wrap canopy 8 m onto East corner `(19.21, -34.49) -> (21.8, -43.1)` so corner is 100% solid
    iz_e = b.set_frame(origin=(20.5, y0, -38.8), front_xz=(43.1 - 34.49, 21.8 - 19.21))
    b.box(0.0, 2.95, 0.95, 9.20, 1.05, 1.90, 'dark_metal', tile=2.0)
    b.box(0.0, 0.25, 0.20, 7.60, 2.65, 0.18, 'shop_interior', tile=1.8, lit=True)
    b.box(0.0, -3.60, 0.55, 8.40, 3.85, 0.95, 'granite', tile=1.8, collide=True)
    b.restore_frame(iz_e)


def _build_yunman_and_south_ramp(b: SceneBuilder):
    """Opposite corner `OV c1096f2a` ('云漫智能轻奢酒店' + grass-grid parking forecourt in photo 51)
    plus the SW pedestrian terrace flanking IDOK-48's South Ramp (`way/258909978`, photo 50):
    stone-brick sidewalk, tactile strip, bright white metal mountain-motif guardrail & banyan trees —
    strictly outside `way/258909978` (`z_ramp <= -15.0`) & `way/675174045` (`x_ramp <= +13.5`)!"""
    y0 = -0.05  # Preserves ~153.25 m datum above ORIGIN_Y=153.30 m

    # 1. Exact Overture `c1096f2a` 5-storey commercial/hotel block (base extended to y=-5.20 m for graded NE ramp cut; IoU=1.000 at y=+2.0m!)
    b.prism(YUNMAN_PTS, -5.20, y0 + 3.30 - (-5.20), 'dark_metal', cap_region='Yunman_wall', tile=3.2, collide=True,footing=True)
    b.prism(YUNMAN_PTS, y0 + 3.30, 14.20, 'Yunman_wall', cap_region='granite', tile=3.6, collide=True)
    ym_f = b.set_frame(origin=(17.35, y0, 5.12), front_xz=(-19.73, -10.75))
    b.box(3.5, 4.10, 0.14, 13.8, 3.20, 0.20, 'hotel_glass', tile=2.2)
    b.box(4.8, 4.20, 0.22, 3.60, 2.90, 0.12, 'shop_interior', tile=1.8, lit=True)
    b.box(3.5, 2.85, 0.59, 14.2, 0.92, 1.86, 'dark_metal', tile=2.0)
    b.sign_quad(3.5, 3.32, 1.54, 11.8, 0.88, 'sign_yunman', normal=(0, 0, 1), lit=True)
    b.box(3.5, 0.20, 0.14, 12.6, 2.55, 0.14, 'shop_interior', tile=2.0, lit=True)
    b.restore_frame(ym_f)

    # 2. SW PEDESTRIAN TERRACE ALONGSIDE SOUTH RAMP (`way/258909978`, photo #50 & #51!):
    #    IDOK-48's `jiefang_bridge.glb` models the 4 one-way interchange ramps (`z_ramp >= -14.3`) and `SIDE_ROAD` (`x_ramp >= +15.8`).
    #    Our brick sidewalk, grass-grid forecourt, white mountain guardrail, and banyan trees sit cleanly in `x_ramp in [-19.0, +13.5], z_ramp in [-33.5, -15.0]`!
    ramp_mid = (-362.0 - ORIGIN_X, 0.0, 66.5 - ORIGIN_Z)
    rf = b.set_frame(origin=ramp_mid, front_xz=(0.6310, -0.7758))

    # 2a. Cellular grass-grid parking forecourt directly along Yunman Hotel NE frontage (`z_ramp in [-33.5, -28.0]`, photo 51!)
    b.draped_patch(
        ANCHOR_WORLD, -14.0, 13.2, -33.5, -28.0, 'grass_grid', curb_region='granite',
        lift=0.17, skirt=0.65, step=2.4, curb_edges=('+z', '+x'), curb_h=0.03, collide=False,
    )
    # 2b. Continuous stone-brick & tactile-strip pedestrian terrace (`z_ramp in [-28.0, -15.0]`, strictly outside `258909978` outer wall!)
    b.draped_patch(
        ANCHOR_WORLD, -19.0, 13.5, -28.0, -15.0, 'ramp_paver', curb_region='granite',
        lift=0.10, skirt=0.75, step=1.1, curb_edges=('+z', '+x', '-x'), curb_h=0.05, curb_w=0.22, collide=False,
    )

    # 2c. Continuous Bright-White Painted-Metal Guilin Mountain-Motif Guardrail (`山形白护栏`, photo #50, at `z_ramp = -15.35`!)
    if b.detail:
        rail_xs = np.linspace(-17.6, 12.4, 14)  # 13 bays x 2.31 m = 30.0 m
        z_rail = -15.35
        for k in range(len(rail_xs) - 1):
            xa, xb = float(rail_xs[k]), float(rail_xs[k + 1])
            xm = 0.5 * (xa + xb)
            lpa = b.xf((xa, 0.0, z_rail))
            lpb = b.xf((xb, 0.0, z_rail))
            ya = libin_terrain_y(ORIGIN_X + lpa[0], ORIGIN_Z + lpa[2]) + 0.10 - ORIGIN_Y
            yb = libin_terrain_y(ORIGIN_X + lpb[0], ORIGIN_Z + lpb[2]) + 0.10 - ORIGIN_Y
            ym = 0.5 * (ya + yb)
            bay_len = xb - xa

            b.box(xa, ya, z_rail, 0.09, 1.02, 0.09, 'rail_white', tile=0.5, collide=True)
            for r_off, r_h in ((0.92, 0.075), (0.12, 0.065)):
                b.face([(xa, ya + r_off, z_rail + 0.035), (xb, yb + r_off, z_rail + 0.035),
                        (xb, yb + r_off + r_h, z_rail + 0.035), (xa, ya + r_off + r_h, z_rail + 0.035)],
                       (0, 0, 1), 'rail_white', tile=1.0)
                b.face([(xb, yb + r_off, z_rail - 0.035), (xa, ya + r_off, z_rail - 0.035),
                        (xa, ya + r_off + r_h, z_rail - 0.035), (xb, yb + r_off + r_h, z_rail - 0.035)],
                       (0, 0, -1), 'rail_white', tile=1.0)
                b.face([(xa, ya + r_off + r_h, z_rail + 0.035), (xb, yb + r_off + r_h, z_rail + 0.035),
                        (xb, yb + r_off + r_h, z_rail - 0.035), (xa, ya + r_off + r_h, z_rail - 0.035)],
                       (0, 1, 0), 'rail_white', tile=1.0)
            for px in np.linspace(xa + 0.25, xb - 0.25, 7):
                t_p = (px - xa) / bay_len
                yp = ya * (1.0 - t_p) + yb * t_p
                b.box(float(px), yp + 0.22, z_rail, 0.032, 0.70, 0.032, 'rail_white', tile=0.5)
            for pk_dx, pk_h in ((-0.26, 0.44), (0.24, 0.34)):
                px_c = xm + pk_dx
                b.face([(px_c - 0.32, ym + 0.24, z_rail + 0.025), (px_c + 0.32, ym + 0.24, z_rail + 0.025),
                        (px_c, ym + 0.24 + pk_h, z_rail + 0.025)], (0, 0, 1), 'rail_green', tile=0.5)
                b.face([(px_c + 0.32, ym + 0.24, z_rail - 0.025), (px_c - 0.32, ym + 0.24, z_rail - 0.025),
                        (px_c, ym + 0.24 + pk_h, z_rail - 0.025)], (0, 0, -1), 'rail_green', tile=0.5)
        b.box(float(rail_xs[-1]), yb, z_rail, 0.09, 1.02, 0.09, 'rail_white', tile=0.5, collide=True)

        # Traffic sign pole next to tree pit (photo #50!)
        lps = b.xf((-6.2, 0.0, -16.1))
        ys_p = libin_terrain_y(ORIGIN_X + lps[0], ORIGIN_Z + lps[2]) + 0.10 - ORIGIN_Y
        b.cylinder_y(-6.2, ys_p, 2.85, -16.1, 0.045, 'rail_white', sections=6)
        b.disc_z(-6.2, ys_p + 2.55, -16.1, 0.34, 0.05, 'granite', sections=12)

    # 2d. Row of 4 overarching Guilin Banyan street trees in curbed stone tree pits with white-limewashed lower trunks (#50!)
    for tx_r, th_r, tsp_r in ((-15.2, 11.4, 5.2), (-5.8, 12.0, 5.6), (3.2, 12.0, 5.6), (11.0, 11.4, 5.0)):
        lpt = b.xf((tx_r, 0.0, -16.8))
        yt = libin_terrain_y(ORIGIN_X + lpt[0], ORIGIN_Z + lpt[2]) + 0.16 - ORIGIN_Y
        b.box(tx_r, yt - 0.05, -16.8, 1.35, 0.14, 1.35, 'dark_metal', cap_region='bark', tile=1.0)
        b.tree_cluster(tx_r, yt, -16.8, h=th_r, spread=tsp_r, foliage='foliage', bark='bark', lime_trunk='lime_white')

    b.restore_frame(rf)

    # 3. Traditional warm-lit square street lanterns on East granite plaza outside `SIDE_ROAD` (photos 51, 52, 55!)
    for lwx, lwz in ((-388.8, 68.0), (-394.6, 80.2)):
        ly = b.grade(lwx-ORIGIN_X,lwz-ORIGIN_Z)-.02
        lx, lz = lwx - ORIGIN_X, lwz - ORIGIN_Z
        b.cylinder_y(lx, ly, 4.35, lz, 0.08, 'pale_stone', sections=6)
        b.box(lx, ly + 4.35, lz, 0.54, 0.72, 0.54, 'warm_glow', cap_region='dark_metal', lit=True,bottom=True)
        b.box(lx, ly + 5.07, lz, 0.70, 0.14, 0.70, 'dark_metal', tile=0.8,bottom=True)


def build_guilin_book_market(b: SceneBuilder):
    _build_book_market_and_binjiang(b)
    _build_universal_hotel(b)
    _build_yunman_and_south_ramp(b)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    atlas_img, atlas_rects = make_book_market_atlas()
    export_landmark_glb(
        out_dir / 'guilin_book_market.glb',
        atlas_img,
        atlas_rects,
        build_guilin_book_market,
        mat_prefix='guilin_book_market',
        lit_emissive=(0.88, 0.80, 0.66),
        double_sided=False,
    )
