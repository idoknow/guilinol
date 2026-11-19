"""Guilin Zhongshan Middle School Libin Campus / Guilin No. 9 Middle School
(桂林市中山中学漓滨校区 / 桂林九中, way/675588260 + gate at node/9214622462).

Refined from Rock's walk photos 51-55:
- Correct street-front gate position on the west side of Libin Road (`way/675174045`),
  facing ESE (115.57 deg) directly onto Libin Road.
- Authentic gate architecture:
  * Left square stone pylon (9.4 m) with dark-maroon circular medallion.
  * Taller right monument pylon (11.8 m) with full-height deep-teal vertical channel,
    large teal circular disc, bronze-gold vertical calligraphy '桂林市中山中学' + Zhuang
    romanization, white vertical party plaque, and row of stainless flagpoles.
  * Wide cantilevered lintel canopy (4.25-5.83 m) with glowing red LED banner (`_lit`),
    recessed warm downlights (`_lit`), maroon support columns, and closed iron grille gate
    (no sentry booth, turnstiles, or CCTV per IDOK-35 K-12 rule).
  * Central concave-swept parapet crown (9.55 m, ear walls 9.98 m) with vertical fluted relief
    and right-to-left bronze calligraphy '公為下天' (signed '孫文').
  * Terrain-draped grey granite forecourt paving, granite curb, and front trimmed hedge planter
    with sculpted stone guardian lion.
- Exact OSM campus buildings (`way/683033662`, `way/683033663`) and athletics/basketball
  courts (`relation/9475535`, `way/683033665-667`) at 0.00 m offset / 0.00 deg delta.
"""
import math
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from m26_16_kit import SceneBuilder, export_landmark_glb, get_font, libin_street_base_y, libin_terrain_y

# Anchor: centroid of OSM way/675588260, flattened to 154.50 m
ORIGIN_X = -541.6056
ORIGIN_Z = 80.7419
ORIGIN_Y = 154.50

# Exact OSM campus footprints relative to ORIGIN
BLDG_NORTH = [
    (49.91, -65.57), (48.38, -53.33), (-23.82, -62.21), (-26.50, -40.60),
    (-21.13, -39.95), (-23.55, -20.47), (-28.93, -21.13), (-32.42, 6.92),
    (-45.18, 5.35), (-35.20, -74.74), (36.20, -65.96), (37.21, -74.14),
    (46.46, -73.00), (45.61, -66.09),
]
BLDG_MID = [
    (39.82, -18.84), (38.62, -10.27), (12.80, -13.82), (12.01, -8.06),
    (-2.18, -10.02), (-1.39, -15.78), (-20.48, -18.41), (-19.30, -26.97),
]
COURTS = [
    [(0.25, 27.81), (5.95, -0.17), (-9.35, -3.24), (-15.05, 24.75)],
    [(22.12, 3.08), (16.43, 31.06), (31.69, 34.12), (37.38, 6.15)],
    [(5.95, -0.17), (22.12, 3.08), (16.43, 31.06), (0.25, 27.81)],
]
TRACK_OUTER = [
    (-30.33, 25.24), (-40.78, 25.62), (-50.17, 30.19), (-56.87, 38.15),
    (-59.74, 48.14), (-58.27, 58.42), (-52.73, 67.22), (-44.05, 73.01),
    (6.29, 82.77), (16.74, 82.40), (26.13, 77.83), (32.83, 69.87),
    (35.70, 59.89), (34.23, 49.60), (28.68, 40.80), (20.01, 35.01),
]
TRACK_INNER = [
    (18.03, 41.21), (24.81, 46.56), (28.32, 54.43), (27.74, 63.03),
    (23.21, 70.37), (15.76, 74.77), (7.11, 75.23), (-43.49, 65.87),
    (-50.27, 60.52), (-53.78, 52.64), (-53.20, 44.05), (-48.67, 36.72),
    (-41.22, 32.31), (-32.56, 31.84),
]

GATE_WORLD_X = -414.60
GATE_WORLD_Z = 68.25
GATE_GROUND_ABS = 153.62
GATE_LOCAL_ORIGIN = (GATE_WORLD_X - ORIGIN_X, GATE_GROUND_ABS - ORIGIN_Y, GATE_WORLD_Z - ORIGIN_Z)
GATE_FRONT_XZ = (0.9020, 0.4318)


def make_libin_atlas():
    size = 512
    im = Image.new('RGB', (size, size), (226, 212, 192))
    dr = ImageDraw.Draw(im)
    rects = {}

    # 1. Warm beige dry-hung stone cladding with crisp ashlar joint grid (0, 0, 128, 128)
    rects['gate_stone'] = (0, 0, 128, 128)
    dr.rectangle((0, 0, 127, 127), fill=(226, 208, 184))
    for gy in range(0, 128, 32):
        for gx in range(0, 128, 32):
            delta = ((gx // 32 + gy // 32) % 3 - 1) * 5
            dr.rectangle((gx + 1, gy + 1, gx + 30, gy + 30), fill=(226 + delta, 208 + delta, 184 + delta))
        dr.line((0, gy, 127, gy), fill=(168, 150, 130), width=2)
    for gx in range(0, 128, 32):
        dr.line((gx, 0, gx, 127), fill=(172, 154, 134), width=2)

    # 2. Fluted vertical relief stone for arch parapet & lintel fascia (128, 0, 128, 128)
    rects['gate_fluted'] = (128, 0, 128, 128)
    dr.rectangle((128, 0, 255, 127), fill=(222, 202, 178))
    for fx in range(130, 256, 6):
        dr.line((fx, 0, fx, 127), fill=(184, 162, 140), width=2)
        dr.line((fx + 2, 0, fx + 2, 127), fill=(236, 218, 196), width=1)
    for fy in (2, 125):
        dr.line((128, fy, 255, fy), fill=(158, 138, 118), width=3)

    # 3. Clean swatches in (256..512, 0..240)
    swatches = [
        ('teal_accent',   (256,   0, 64, 48), ( 34,  76,  78)),
        ('maroon_disc',   (320,   0, 64, 48), ( 78,  34,  30)),
        ('maroon_col',    (384,   0, 64, 48), ( 92,  38,  34)),
        ('pale_stone',    (448,   0, 64, 48), (206, 204, 198)),
        ('granite',       (256,  48, 64, 48), (146, 148, 150)),
        ('dark_stone',    (320,  48, 64, 48), ( 72,  76,  82)),
        ('pave_dark',     (384,  48, 64, 48), ( 98, 102, 106)),
        ('pave_light',    (448,  48, 64, 48), (172, 174, 172)),
        ('hedge',         (256,  96, 64, 48), ( 52,  84,  48)),
        ('foliage',       (320,  96, 64, 48), ( 62,  98,  56)),
        ('bark',          (384,  96, 64, 48), (104,  88,  72)),
        ('steel',         (448,  96, 64, 48), (202, 208, 214)),
        ('campus_white',  (256, 144, 64, 48), (234, 230, 222)),
        ('campus_brick',  (320, 144, 64, 48), (178,  64,  54)),
        ('track_red',     (384, 144, 64, 48), (178,  80,  68)),
        ('turf_green',    (448, 144, 64, 48), ( 92, 134,  80)),
        ('court_blue',    (256, 192, 64, 48), ( 74, 118, 152)),
        ('court_green',   (320, 192, 64, 48), ( 76, 128, 100)),
        ('warm_lamp',     (384, 192, 64, 48), (252, 238, 206)),
        ('glass_lit',     (448, 192, 64, 48), (196, 172, 122)),
    ]
    for key, (x, y, w, h), rgb in swatches:
        rects[key] = (x, y, w, h)
        dr.rectangle((x, y, x + w - 1, y + h - 1), fill=rgb)

    # Crisp grey granite grid paving (`plaza_tile`) (0, 128, 128, 112) — matching photo 52-54!
    rects['plaza_tile'] = (0, 128, 128, 112)
    dr.rectangle((0, 128, 127, 239), fill=(138, 142, 146))
    for py in range(128, 240, 28):
        for px in range(0, 128, 32):
            dark = ((px // 32 + (py - 128) // 28) % 4 == 0)
            col = (92, 96, 102) if dark else (154, 158, 162)
            dr.rectangle((px + 2, py + 2, px + 30, py + 26), fill=col)

    # Iron grille texture (128, 128, 128, 112) for closed school gate
    rects['iron_grille'] = (128, 128, 128, 112)
    dr.rectangle((128, 128, 255, 239), fill=(36, 38, 42))
    for ix in range(132, 256, 10):
        dr.rectangle((ix, 132, ix + 3, 236), fill=(116, 120, 126))
    for iy in (136, 154, 224):
        dr.rectangle((128, iy, 255, iy + 4), fill=(124, 128, 134))

    # 4. '公為下天' bronze-gold relief plaque on fluted stone (0, 240, 352, 128) — exact photo 53!
    rx, ry, rw, rh = 0, 240, 352, 128
    rects['tianxia_plaque'] = (rx, ry, rw, rh)
    dr.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=(224, 204, 180))
    for fx in range(rx + 4, rx + rw, 6):
        dr.line((fx, ry, fx, ry + rh - 1), fill=(196, 174, 152), width=2)
    dr.rectangle((rx + 4, ry + 4, rx + rw - 5, ry + rh - 5), outline=(156, 134, 112), width=3)
    f_big = get_font(62, bold=True, sans=False)
    f_sig = get_font(22, bold=True, sans=False)
    dr.text((rx + 32, ry + 44), '孫', fill=(86, 52, 20), font=f_sig, anchor='mm')
    dr.text((rx + 32, ry + 78), '文', fill=(86, 52, 20), font=f_sig, anchor='mm')
    chars = ['公', '為', '下', '天']
    for idx, ch in enumerate(chars):
        cx = rx + 88 + idx * 72
        cy = ry + rh // 2 + 2
        dr.text((cx + 2, cy + 2), ch, fill=(52, 32, 12), font=f_big, anchor='mm')
        dr.text((cx, cy), ch, fill=(116, 72, 26), font=f_big, anchor='mm')

    # 5. Red glowing LED banner (0, 368, 384, 64) (`_lit`) — exact photo 52 & 53!
    lx, ly, lw, lh = 0, 368, 384, 64
    rects['led_banner'] = (lx, ly, lw, lh)
    dr.rectangle((lx, ly, lx + lw - 1, ly + lh - 1), fill=(48, 18, 18))
    dr.rectangle((lx + 6, ly + 8, lx + lw - 7, ly + lh - 9), fill=(182, 26, 24), outline=(92, 44, 40), width=2)
    f_led = get_font(18, bold=True, sans=True)
    banner_txt = '桂林市普通高中2027届高三年级高考备考主题教研活动（语文学科会场）'
    dr.text((lx + lw // 2, ly + lh // 2), banner_txt, fill=(255, 232, 168), font=f_led, anchor='mm')

    # 6. Inner warm yellow shopfront sign inside gate arch left side (0, 432, 256, 80) (`_lit`)
    sx, sy, sw, sh = 0, 432, 256, 80
    rects['inner_shop'] = (sx, sy, sw, sh)
    dr.rectangle((sx, sy, sx + sw - 1, sy + sh - 1), fill=(236, 188, 72))
    dr.rectangle((sx + 6, sy + 40, sx + sw - 7, sy + sh - 6), fill=(184, 152, 96))
    f_sh = get_font(20, bold=True, sans=True)
    dr.text((sx + sw // 2, sy + 22), '文具 · 教辅专卖店', fill=(142, 34, 26), font=f_sh, anchor='mm')

    # 7. Vertical right-tower bronze calligraphy '桂林市中山中学' + Zhuang romanization (384, 240, 80, 272)
    vx, vy, vw, vh = 384, 240, 80, 272
    rects['tower_title'] = (vx, vy, vw, vh)
    dr.rectangle((vx, vy, vx + vw - 1, vy + vh - 1), fill=(212, 192, 168))
    for gy in range(vy, vy + vh, 34):
        dr.line((vx, gy, vx + vw - 1, gy), fill=(160, 142, 122), width=2)
    dr.rectangle((vx, vy, vx + 14, vy + vh - 1), fill=(34, 76, 78))
    f_rom = get_font(11, bold=True, sans=True)
    for r_idx, ch in enumerate('GVEILINZCZ'):
        dr.text((vx + 24, vy + 18 + r_idx * 24), ch, fill=(74, 66, 56), font=f_rom, anchor='mm')
    f_vt = get_font(28, bold=True, sans=False)
    for idx, ch in enumerate('桂林市中山中学'):
        cy = vy + 22 + idx * 36
        dr.text((vx + 55, cy + 1), ch, fill=(58, 42, 24), font=f_vt, anchor='mm')
        dr.text((vx + 54, cy), ch, fill=(104, 78, 42), font=f_vt, anchor='mm')

    # 8. Vertical white party plaque '中共桂林市中山中学委员会' (464, 240, 48, 272)
    px, py, pw, ph = 464, 240, 48, 272
    rects['party_plaque'] = (px, py, pw, ph)
    dr.rectangle((px, py, px + pw - 1, py + ph - 1), fill=(244, 242, 238), outline=(150, 146, 140), width=2)
    f_pp = get_font(16, bold=True, sans=True)
    for idx, ch in enumerate('中共桂林市中山中学委员会'):
        col = (186, 36, 32) if idx < 2 else (42, 42, 44)
        dr.text((px + pw // 2, py + 16 + idx * 21), ch, fill=col, font=f_pp, anchor='mm')

    return im, rects


def _build_campus_interior(b: SceneBuilder):
    """Exact OSM buildings & courts inside way/675588260 (0.00m offset, 0.00 deg delta)."""
    campus_ring = [
        (-67.33, 69.71), (36.51, 87.43), (56.59, -17.83),
        (67.03, -72.52), (-37.25, -85.04), (-51.37, -12.52),
    ]
    b.prism(campus_ring, -0.60, 0.62, 'granite', cap_region='pave_light', tile=4.5, collide=False, paving=True)

    for bldg_pts, floors, wall_col in ((BLDG_NORTH, 5, 'campus_white'), (BLDG_MID, 4, 'campus_white')):
        h_tot = floors * 3.45
        b.prism(bldg_pts, -0.50, 0.90, 'dark_stone', cap_region='dark_stone', tile=2.5, collide=False,footing=True)
        b.prism(bldg_pts, 0.40, h_tot - 0.40, wall_col, cap_region='granite', tile=3.0, collide=True)
        b.prism(bldg_pts, h_tot, 0.45, 'campus_brick', cap_region='granite', tile=2.5, collide=False)
        pts = np.asarray(bldg_pts, dtype=np.float64)
        area2 = np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
        if area2 < 0:
            pts = pts[::-1]
        for i in range(len(pts)):
            j = (i + 1) % len(pts)
            a, c = pts[i], pts[j]
            dx, dz = c[0] - a[0], c[1] - a[1]
            seg = math.hypot(dx, dz)
            if seg < 6.0:
                continue
            ux, uz = dx / seg, dz / seg
            nx, nz = dz / seg, -dx / seg
            p0 = (a[0] + ux * 1.2 + nx * 0.06, a[1] + uz * 1.2 + nz * 0.06)
            p1 = (c[0] - ux * 1.2 + nx * 0.06, c[1] - uz * 1.2 + nz * 0.06)
            for fl in range(floors):
                wy0 = fl * 3.45 + 1.15
                wy1 = wy0 + 1.40
                b.face([(p0[0], wy0, p0[1]), (p1[0], wy0, p1[1]), (p1[0], wy1, p1[1]), (p0[0], wy1, p0[1])],
                       (nx, 0.0, nz), 'glass_lit', tile=2.4, lit=True)

    b.prism(TRACK_OUTER, 0.01, 0.05, 'track_red', cap_region='track_red', tile=4.0, collide=False)
    b.prism(TRACK_INNER, 0.04, 0.05, 'turf_green', cap_region='turf_green', tile=4.0, collide=False)
    for idx, c_pts in enumerate(COURTS):
        col = 'court_green' if idx % 2 == 0 else 'court_blue'
        b.prism(c_pts, 0.02, 0.05, col, cap_region=col, tile=4.0, collide=False)


def _build_street_gate(b: SceneBuilder):
    """Monumental Libin Road gatehouse of Guilin Zhongshan Middle School (No. 9 Middle School)
    reconstructed 1:1 from Rock's walk photos 51-55."""
    prev = b.set_frame(origin=GATE_LOCAL_ORIGIN, front_xz=GATE_FRONT_XZ)
    anchor_world = (ORIGIN_X, ORIGIN_Y, ORIGIN_Z)

    # Terrain-following grey granite forecourt paving (`lift=0.18 m`, seamlessly graded to IDOK-48 Libin Rd!)
    b.draped_patch(
        anchor_world,
        -11.2,
        12.4,
        -2.2,
        10.2,
        'plaza_tile',
        curb_region='granite',
        lift=0.18,
        skirt=0.85,
        step=2.2,
        curb_edges=('+z',),
        curb_h=0.05,
        curb_w=0.24,
        collide=False,
        height_fn=libin_street_base_y,
    )
    # Inner driveway behind closed grille
    b.draped_patch(
        anchor_world,
        -10.0,
        10.0,
        -11.0,
        -2.2,
        'pave_dark',
        curb_region='dark_stone',
        lift=0.18,
        skirt=0.35,
        step=3.0,
        collide=False,
    )

    # --- 1. LEFT SQUARE STONE PYLON (x = -8.85 m, w = 3.5 m, d = 3.4 m, h = 9.4 m) ---
    lx = -8.85
    b.box(lx, -1.0, 0.0, 3.65, 1.45, 3.55, 'gate_stone', tile=2.4, collide=True)
    b.box(lx, 0.45, 0.0, 3.45, 8.65, 3.35, 'gate_stone', tile=2.4, collide=True)
    b.box(lx, 9.10, 0.0, 3.20, 0.35, 3.10, 'gate_stone', tile=2.0)
    b.box(lx, 0.45, 1.66, 0.20, 8.65, 0.08, 'maroon_disc', tile=1.0)
    b.disc_z(lx, 6.55, 1.70, 0.62, 0.14, 'maroon_disc', sections=16 if b.detail else 8)

    # --- 2. TALLER RIGHT MONUMENT PYLON (x = +8.85 m, w = 3.5 m, d = 3.4 m, h = 11.8 m) ---
    rx = 8.85
    b.box(rx, -1.0, 0.0, 3.65, 1.45, 3.55, 'gate_stone', tile=2.4, collide=True)
    b.box(rx, 0.45, 0.0, 3.45, 11.05, 3.35, 'gate_stone', tile=2.4, collide=True)
    b.box(rx, 11.50, 0.0, 3.20, 0.35, 3.10, 'gate_stone', tile=2.0)
    b.box(rx - 0.18, 0.45, 1.68, 0.32, 11.05, 0.08, 'teal_accent', tile=1.2)
    b.disc_z(rx - 0.18, 7.75, 1.72, 0.72, 0.16, 'teal_accent', sections=18 if b.detail else 8)
    b.sign_quad(rx + 0.22, 3.75, 1.71, 1.65, 5.45, 'tower_title', normal=(0, 0, 1), lit=False)
    b.sign_quad(rx - 1.32, 2.05, 1.71, 0.42, 2.35, 'party_plaque', normal=(0, 0, 1), lit=False)

    # Row of 4 stainless steel flagpoles + low red-framed notice wall to the right of right tower (photo 55!)
    for f_idx in range(4):
        fx = rx + 2.15 + f_idx * 0.42
        fz = 0.60 - f_idx * 0.45
        b.cylinder_y(fx, -0.35, 9.33 + (0.6 if f_idx == 1 else 0.0), fz, 0.055, 'steel', sections=6)
    b.box(rx + 2.65, -0.45, -1.60, 0.35, 2.48, 4.20, 'campus_brick', cap_region='pale_stone', tile=1.8, collide=True)

    # --- 3. WIDE CANTILEVERED LINTEL CANOPY & RED LED BANNER (x in [-7.15, +7.15], y = 4.25..5.83 m) ---
    b.box(0.0, 4.25, 0.20, 14.50, 0.24, 4.30, 'gate_stone', bottom=True, tile=2.4, collide=True)
    b.box(0.0, 4.49, 0.20, 14.30, 1.08, 3.95, 'gate_fluted', tile=2.2, collide=True)
    b.box(0.0, 5.57, 0.22, 14.65, 0.26, 4.35, 'gate_stone', tile=2.4)
    b.box(0.0, 4.66, 2.18, 12.80, 0.74, 0.12, 'dark_stone', tile=1.5)
    b.sign_quad(0.0, 5.03, 2.26, 12.50, 0.64, 'led_banner', normal=(0, 0, 1), lit=True)

    for dl_x in (-5.4, -3.2, -1.1, 1.1, 3.2, 5.4):
        b.box(dl_x, 4.22, 0.85, 0.46, 0.05, 0.46, 'warm_lamp', bottom=True, lit=True)

    for col_x in (-3.65, 2.85):
        b.cylinder_y(col_x, -0.45, 4.71, 0.55, 0.24, 'maroon_col', sections=10 if b.detail else 6, collide=True)

    # --- 4. CENTRAL CONCAVE-SWEPT '公為下天' PARAPET CROWN (y = 5.83 .. 9.55 / 9.98 m, photo 52 & 53!) ---
    z_back, z_front = -0.65, 1.55
    steps = 7 if b.detail else 3
    wing_profile = []
    for k in range(steps + 1):
        ang = (math.pi / 2.0) * (k / steps)
        wx = 3.42 + 3.03 * (1.0 - math.sin(ang))
        wy = 5.83 + 1.82 * (1.0 - math.cos(ang))
        wing_profile.append((wx, wy))
    wing_profile.append((3.42, 9.55))

    for k in range(len(wing_profile) - 1):
        x0, y0 = wing_profile[k]
        x1, y1 = wing_profile[k + 1]
        b.face([(-x0, y0, z_front), (x0, y0, z_front), (x1, y1, z_front), (-x1, y1, z_front)],
               (0, 0, 1), 'gate_fluted', tile=2.2)
        b.face([(x0, y0, z_back), (-x0, y0, z_back), (-x1, y1, z_back), (x1, y1, z_back)],
               (0, 0, -1), 'gate_stone', tile=2.4)
        b.face([(-x0, y0, z_back), (-x0, y0, z_front), (-x1, y1, z_front), (-x1, y1, z_back)],
               (-(y1 - y0), x0 - x1, 0), 'gate_stone', tile=2.0)
        b.face([(x0, y0, z_front), (x0, y0, z_back), (x1, y1, z_back), (x1, y1, z_front)],
               (y1 - y0, x0 - x1, 0), 'gate_stone', tile=2.0)
    b.face([(-3.42, 9.55, z_front), (3.42, 9.55, z_front), (3.42, 9.55, z_back), (-3.42, 9.55, z_back)],
           (0, 1, 0), 'gate_stone', tile=2.2)

    for side in (-1.0, 1.0):
        b.box(side * 3.58, 7.35, 0.45, 0.36, 2.63, 2.32, 'gate_stone', tile=2.0)

    b.sign_quad(0.0, 8.25, z_front + 0.03, 6.45, 2.30, 'tianxia_plaque', normal=(0, 0, 1), lit=False)

    # --- 5. CLOSED IRON GRILLE GATE & INNER DEPTH (no booth/turnstiles/CCTV per IDOK-35!) ---
    b.box(0.0, 0.22, -0.65, 14.10, 2.15, 0.14, 'iron_grille', tile=2.2, collide=True)
    b.box(-6.20, 0.18, -5.20, 3.60, 3.80, 6.20, 'gate_stone', tile=2.4, collide=True)
    b.sign_quad(-4.36, 2.15, -4.60, 4.20, 1.65, 'inner_shop', normal=(1, 0, 0), lit=True)
    b.tree_cluster(-4.5, b.grade(-4.5,-10.5), -10.5, h=11.0, spread=4.5, foliage='foliage', bark='bark')
    b.tree_cluster(4.2, b.grade(4.2,-11.5), -11.5, h=10.5, spread=4.2, foliage='foliage', bark='bark')

    # --- 6. FRONT HEDGE PLANTER & GUARDIAN STONE LION (photos 52, 53, 55!) ---
    px, pz = 3.45, 3.15
    lp = b.xf((px, 0.0, pz))
    py0 = libin_street_base_y(ORIGIN_X + lp[0], ORIGIN_Z + lp[2]) + 0.18 - GATE_GROUND_ABS
    b.box(px, py0 - 0.15, pz, 6.10, 0.58, 2.50, 'dark_stone', cap_region='hedge', tile=1.8, collide=True)
    b.box(px, py0 + 0.43, pz, 5.75, 0.52, 2.15, 'hedge', tile=1.5, collide=True)
    b.stone_lion(px - 0.55, py0 + 0.90, pz + 0.10, scale=1.28, region='pale_stone')

    b.restore_frame(prev)


def build_libin_middle(b: SceneBuilder):
    _build_campus_interior(b)
    _build_street_gate(b)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    atlas_img, atlas_rects = make_libin_atlas()
    export_landmark_glb(
        out_dir / 'libin_middle.glb',
        atlas_img,
        atlas_rects,
        build_libin_middle,
        mat_prefix='libin_middle',
        lit_emissive=(0.88, 0.72, 0.55),
        double_sided=False,
    )
