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

import numpy as np
from PIL import Image, ImageDraw
import trimesh

from c_kit import landmark_surface
from nikoniko import Builder, _draw_centered, _font
from shizijie_layout import KIOSK_CENTER, islands
from plaza_seam import civic_plaza
from shapely.affinity import scale
from shapely.geometry import box


SHOP_SIGN_ATLAS = 1024

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
        # Poster header card
        draw.rectangle((rx + 28, ry + 38, rx + 142, ry + 72), fill=accent)
        _draw_centered(draw, (rx + 28, ry + 38, 114, 34), badge, _font(22, bold=True, sans=True), (16, 20, 26))
        _draw_centered(draw, (rx + 28, ry + 84, rw - 56, 56), headline, _font(36, bold=True, sans=True), (248, 246, 240), stroke_w=1, stroke_fill=(18, 24, 30))
        _draw_centered(draw, (rx + 28, ry + 146, rw - 56, 40), sub, _font(20, bold=True, sans=True), (218, 232, 236))

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
        draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=(20, 26, 32))
        draw.rectangle((rx + 3, ry + 3, rx + rw - 4, ry + rh - 4), outline=accent, width=3)
        _draw_centered(draw, (rx + 8, ry + 6, rw - 16, 32), line1, _font(24, bold=True, sans=True), (248, 246, 240))
        _draw_centered(draw, (rx + 8, ry + 38, rw - 16, 26), line2, _font(19, bold=True, sans=True), accent)

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

    return sheet


class ShizijieBuilder(Builder):
    """Extends Group-B Builder with Shizijie's dedicated `shizijie_shop_signs` night-lit signage channel."""

    def __init__(self, detail=True):
        super().__init__(detail=detail)
        self.shop_sign_tris = []
        self.shop_sign_uv = []

    def shop_sign_quad(self, x, y0, z, w, h, sign_key, double_sided=False):
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
            back = self._transform([
                (x + hw, y0, z - 0.04),
                (x - hw, y0, z - 0.04),
                (x - hw, y0 + h, z - 0.04),
                (x + hw, y0 + h, z - 0.04),
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
                m.box(cx, 3.45, 0.28, bay_w - 0.68, 0.92, 0.26, 'dark')
                m.shop_sign_quad(cx, 3.48, 0.43, bay_w - 0.74, 0.86, f'szj_shop_{(i + shop_seed) % 8}')
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
        # Left & right showroom illuminated display glass panels
        for sx, win_key in ((-3.35, 'ebike_window_l'), (3.35, 'ebike_window_r')):
            m.box(sx, y_store + 0.10, 0.24, 4.52, 2.95, 0.16, 'dark')
            m.shop_sign_quad(sx, y_store + 0.30, 0.34, 4.36, 2.55, win_key)
        # Central entrance portal frame + header light strip
        for sx in (-1.06, 1.06):
            m.box(sx, y_store + 0.05, 0.32, 0.12, 3.15, 0.26, 'alum')
        m.box(0.0, y_store + 2.58, 0.34, 2.24, 0.56, 0.24, 'dark')
        m.shop_sign_quad(0.0, y_store + 2.64, 0.48, 2.06, 0.42, 'ebike_door_hdr')
        # Side projecting perpendicular blade sign on east pier (facing passersby along Jiefang East Rd)
        m.box(bay_w + 0.10, 3.60, 1.10, 0.14, 0.86, 1.10, 'dark')
        # Projecting side banner facing east/west along street (rotate 90 deg around local Y)
        m.pose = (c_wx + (bay_w + 0.18) * ux + 1.15 * nx, 0.0, c_wz + (bay_w + 0.18) * uz + 1.15 * nz, yaw + math.pi / 2.0)
        m.shop_sign_quad(0.0, 3.64, 0.02, 1.04, 0.78, 'ebike_banner_side', double_sided=True)

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


def _signal_gantry(m: Builder, x, z, yaw, span=8.4, sign_mode=0):
    """Cantilevered traffic signal mast-arm + blue municipal road sign."""
    m.pose = (x, 0.0, z, yaw)
    m.cylinder_y(0, 0.0, 6.8, 0, 0.20, 'alum', sections=8 if m.detail else 5, collide=True)
    m.box(0, 0.0, 0, 0.62, 0.45, 0.62, 'dark', collide=True)
    for arm_y in (5.95, 6.45):
        m.beam([0, arm_y, 0], [span, arm_y, 0], 0.085, 'alum', sections=6)
    if m.detail:
        for sx in np.linspace(1.2, span - 0.6, 5):
            m.beam([sx, 5.95, 0], [sx, 6.45, 0], 0.04, 'alum', sections=4)

    # Municipal royal-blue direction sign panel with real CJK/Latin lettering
    sign_key = 'road_szj_ns' if sign_mode < 2 else 'road_szj_ew'
    m.box(span * 0.42, 5.25, 0.12, 3.16, 1.78, 0.08, 'alum')
    m.sign_quad(span * 0.42, 5.28, 0.18, 3.08, 1.72, sign_key, double_sided=True)

    # Dual vertical traffic signal heads with glowing lenses
    for lx, lens_col in ((span * 0.74, 'red_lit'), (span * 0.92, 'hedge_lit')):
        m.box(lx, 5.45, 0.16, 0.52, 1.35, 0.34, 'dark')
        m.box(lx, 5.45, 0.16, 0.58, 1.42, 0.06, 'white')
        if m.detail:
            m.cylinder_y(lx, 6.38, 0.10, 0.34, 0.14, 'red_lit' if lx < span * 0.82 else 'dark', sections=8)
            m.cylinder_y(lx, 6.02, 0.10, 0.34, 0.14, 'yellow_pave', sections=8)
            m.cylinder_y(lx, 5.64, 0.10, 0.34, 0.14, lens_col, sections=8)

    # Lower pedestrian crossing signal on the main post
    m.box(0.28, 2.35, 0.0, 0.28, 0.68, 0.26, 'dark')
    if m.detail:
        m.box(0.43, 2.46, 0.0, 0.05, 0.22, 0.16, 'hedge_lit')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _roadside_direction_sign(m: Builder, x, z, yaw, sign_key='road_szj_ns'):
    """Twin-post municipal blue direction sign on approach sidewalk (bing_10.jpg)."""
    m.pose = (x, 0.0, z, yaw)
    for sx in (-1.15, 1.15):
        m.cylinder_y(sx, 0.0, 4.9, 0.0, 0.08, 'alum', sections=6, collide=True)
    m.box(0.0, 2.75, 0.04, 3.1, 2.25, 0.08, 'alum')
    m.sign_quad(0.0, 2.78, 0.10, 3.02, 2.18, sign_key, double_sided=True)
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _guardrail_run(m: Builder, p0, p1):
    """Guilin decorative grey metal median/bike guardrail with circular medallions."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    segs = max(1, round(length / 2.6))
    yaw = math.atan2(dx, dz)
    mx, mz = (p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0
    m.pose = (mx, 0.0, mz, yaw)
    # Continuous solid collision barrier + top/bottom rails
    m.box(0, 0.05, 0, 0.12, 0.93, length, 'alum', collide=True)
    if m.detail:
        m.box(0, 0.92, 0, 0.09, 0.07, length, 'alum')
        m.box(0, .05, 0, .15, .22, length, 'alum')
        for i in range(segs + 1):
            lz = -length / 2.0 + i * (length / segs)
            m.box(0, 0.0, lz, 0.18, 1.02, 0.12, 'dark')
            if i < segs:
                cz = lz + 0.5 * (length / segs)
                m.box(.063, .38, cz, .04, .42, .42, 'white')
                m.box(.087, .46, cz, .025, .24, .24, 'dark')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def build_shizijie(m: ShizijieBuilder):
    m.surface = landmark_surface('shizijie')
    # ------------------------------------------------------------------
    # 1. Four corner channelizing refuge islands + sidewalks + guardrails
    # (Center of intersection around (0, 0) is completely clear asphalt.)
    # ------------------------------------------------------------------
    m.follow_grade = True
    for corner, island in enumerate(islands()):
        for ratio, base, height, wall, cap, solid in (
            (1, -.04, .19, 'pave', 'pave', True),
            (.58, .15, .52, 'beige', 'hedge', True),
            (.36, .67, .14, 'red', 'red', False),
        ):
            shape = island.intersection(scale(island, ratio, ratio, origin='centroid'))
            if corner == 1 and ratio < 1:
                shape = shape.intersection(box(*island.bounds[:2], 24.5, island.bounds[3]))
            for part in getattr(shape, 'geoms', [shape]):
                m.prism(list(part.exterior.coords), base, height, wall, collide=solid, cap_mat=cap)

    # Decorative median & bike-lane guardrails on all 4 arterial legs
    _guardrail_run(m, (6.4, -21.53), (15.76, -51.94))
    _guardrail_run(m, (7.8, 31.1), (14.0, 27.3))
    _guardrail_run(m, (-32.0, 19.9), (-29.8, 23.8))
    _guardrail_run(m, (24.3, -12.0), (28.9, -5.1))

    # Four cantilevered traffic signal gantries + blue direction signs
    _signal_gantry(m, 26.5, -27.5, yaw=math.atan2(-10.0, 32.0) + math.pi, span=8.8, sign_mode=0)
    _signal_gantry(m, -29.5, 24, yaw=math.atan2(-10.0, 32.0), span=8.8, sign_mode=1)
    _signal_gantry(m, -32.5, -23.5, yaw=math.atan2(-38.0, -7.8), span=8.2, sign_mode=2)
    _signal_gantry(m, 33.5, 28, yaw=math.atan2(36.0, 8.2), span=8.2, sign_mode=3)

    # Roadside large municipal blue direction sign on south approach east sidewalk (bing_10.jpg right)
    _roadside_direction_sign(m, 4.7, 46.5, yaw=math.atan2(-17.3, 46.5), sign_key='road_szj_ns')

    # NE Corner '桂林交警' blue-and-white police kiosk
    m.pose = (KIOSK_CENTER[0], 0.15, KIOSK_CENTER[1], -0.55)
    m.box(0, 0.0, 0, 3.4, 2.85, 2.8, 'white', collide=True)
    m.box(0, 0.95, 1.42, 2.6, 1.25, 0.08, 'glass')
    m.box(0, 0.0, 1.41, 2.8, 0.88, 0.08, 'red')
    m.box(0, 2.45, 0, 3.7, 0.52, 3.1, 'blue')
    m.box(0, 2.97, 0, 3.9, 0.16, 3.3, 'alum')
    m.sign_quad(0, 2.46, 1.58, 3.45, 0.50, 'police_sign')
    if m.detail:
        m.cylinder_y(-0.9, 3.13, 0.22, 0.6, 0.14, 'red_lit', sections=6)
        m.cylinder_y(0.9, 3.13, 0.22, 0.6, 0.14, 'blue_lit', sections=6)
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

    # Sidewalk camphor street trees & multi-globe lamps around the 3 corners + south median shrubs
    # North sidewalk along Nanfang Mansion frames IMG_1385 (-77.65, -34.27) & IMG_1386 (-63.05, -36.17)!
    for tx, tz, th, tsp in (
        (-91.29, -33.17, 10.5, 4.4),
        (-79.21, -30.99, 12.2, 4.5),  # left trunk framing IMG_1385 (~26% frame width)!
        (-75.07, -29.78, 12.4, 4.6),  # right trunk framing IMG_1385 (~62% frame width)!
        (-66.5, -31.8, 10.8, 4.4),  # canopy framing IMG_1386!
        (-59.5, -32.8, 10.4, 4.2),
        (-48.5, -30.8, 8.8, 3.6),
        (50.5, -18.0, 8.2, 3.3),
        (88.0, 6.5, 8.2, 3.3),
        (108.0, 11.2, 8.2, 3.3),
        (24.0, 56.5, 8.2, 3.3),
        (4.5, 74.0, 8.2, 3.3),
    ):
        m.street_tree(tx, 0.08, tz, height=th, spread=tsp, kind='camphor', lanterns=(tx > -55), collide=True)
    if m.detail:
        for lx, lz in ((-38.0, -29.0), (45.0, -32.0), (68.0, 2.5), (14.5, 55.0)):
            m.cluster_lamp(lx, 0.08, lz, height=7.0, globes=5, collide=True)
        # Flowering crape-myrtle median strip on south approach (bing_10.jpg foreground)
        for t in np.linspace(0.08, 0.92, 6):
            sx = 11.8 + 4.0 * t
            sz = 26.5 - 1.5 * t
            m.cylinder_y(sx, 0.10, 0.72, sz, 0.85, 'hedge', sections=7)
            m.cylinder_y(sx, 0.82, 0.55, sz, 0.72, 'red', sections=7)


def _export_shizijie():
    folder = Path(__file__).resolve().parents[2] / 'public/textures/landmarks/B'
    textures = {key: Image.open(folder / filename) for key, filename in (
        ('surfaces', 'surfaces.png'), ('glass', 'curtain_glass.png'),
        ('pave', 'plaza_pave.png'), ('signs', 'signs.png'))}
    shop_signs_img = _build_shizijie_shop_signs_sheet()

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
        roughnessFactor=0.22, metallicFactor=0.18, doubleSided=True,
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
    scene.export(out_dir / 'shizijie.glb')


if __name__ == '__main__':
    _export_shizijie()
