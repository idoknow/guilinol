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
  6 storeys / 21.4 m & 4 storeys / 14.8 m stepped white/grey facades (00-2019.jpg right)

Intersection details from 2019–2025 street references: open asphalt center,
terracotta-red (#b84a42) bike crossing bands and ochre-yellow (#cfa346)
non-motorized waiting boxes, zebra crosswalks, four channelizing flowerbed
refuge islands, medallion pedestrian guardrails, 6.4 m cantilevered traffic
signal gantries, municipal blue road signs ('中山中路 / 解放西路 / 解放东路'),
and NE traffic police booth ('桂林交警').
"""
import math
import numpy as np

from c_kit import landmark_surface
from nikoniko import Builder, export_landmark
from shizijie_layout import KIOSK_CENTER, islands
from plaza_seam import civic_plaza
from shapely.affinity import scale
from shapely.geometry import box


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


def _commercial_strip(m: Builder, p0, p1, outward_sign, podium_h, total_h, wall_mat, shop_seed, bays):
    """Detailed street-facing commercial facade along segment p0 -> p1."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    if length < 4.0:
        return
    ux, uz = dx / length, dz / length
    nx, nz = -uz * outward_sign, ux * outward_sign
    yaw = math.atan2(nx, nz)
    mx, mz = (p0[0] + p1[0]) / 2.0 + nx * 0.32, (p0[1] + p1[1]) / 2.0 + nz * 0.32

    m.pose = (mx, 0.0, mz, yaw)
    m.box(0, podium_h - 0.25, 0.15, length + 0.3, 0.55, 0.75, wall_mat)
    m.box(0, podium_h + 0.3, 0.05, length - 0.5, total_h - podium_h - 1.1, 0.28, 'glass')
    m.box(0, total_h - 0.8, 0.18, length + 0.4, 0.85, 0.85, wall_mat)
    m.box(0, total_h + 0.05, 0.22, length + 0.6, 0.28, 1.05, 'dark')

    if not m.detail:
        m.pose = (0.0, 0.0, 0.0, 0.0)
        return

    bay_w = length / bays
    floors = max(2, round((total_h - podium_h - 0.8) / 3.4))
    fl_h = (total_h - podium_h - 1.1) / floors
    for i in range(bays + 1):
        lx = -length / 2.0 + i * bay_w
        m.box(lx, -1.2, 0.22, 0.62, total_h + 1.2, 0.62, wall_mat, collide=True, footing=True)
        if i < bays:
            cx = lx + bay_w / 2.0
            m.box(cx, 0.11, -0.05, bay_w - 0.72, 3.15, 0.22, 'glass')
            m.box(cx, 3.15, 0.65, bay_w - 0.45, 0.18, 1.25, 'alum')
            m.box(cx, 3.45, 0.28, bay_w - 0.68, 0.92, 0.26, 'dark')
            m.sign_quad(cx, 3.48, 0.43, bay_w - 0.74, 0.86, f'shop_{(i + shop_seed) % 8}')
            for fl in range(1, floors):
                m.box(cx, podium_h + 0.3 + fl * fl_h, 0.20, bay_w - 0.5, 0.36, 0.32, wall_mat)
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


def build_shizijie(m: Builder):
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
    ne_apron = [
        (46.0, -45.5), (53.5, -23.0), (63.5, -7.5), (135.5, 16.5),
        (137.0, -2.5), (94.5, -78.5), (59.5, -87.0),
    ]
    civic_plaza(m, ne_apron)
    m.prism(NE_CORNER, -2.0, 6.4, 'dark', collide=True, cap_mat='alum', footing=True)
    m.prism(NE_CORNER, 4.4, 17.0, 'white', collide=True, cap_mat='roof')
    m.pose = (60.5, 0.0, -24.5, math.atan2(-1.0, 0.85))
    m.box(0, 21.4, 0, 14.0, 3.2, 12.0, 'alum')
    m.box(0, 24.6, 5.8, 8.6, 1.65, 0.24, 'dark')
    m.sign_quad(0, 24.65, 5.95, 8.4, 1.55, 'ccb_sign')
    m.pose = (0.0, 0.0, 0.0, 0.0)
    _commercial_strip(m, (49.35, -43.56), (65.01, -10.57), 1, 4.4, 21.4, 'white', 4, 6)
    _commercial_strip(m, (61.23, -84.32), (49.35, -43.56), 1, 4.4, 21.4, 'white', 6, 7)

    m.prism(NE_ANNEX, -2.0, 4.5, 'dark', collide=True, cap_mat='beige', footing=True)
    m.prism(NE_ANNEX, 2.5, 12.3, 'white', collide=True, cap_mat='roof')
    _commercial_strip(m, (76.25, 1.14), (130.47, 13.93), 1, 4.2, 14.8, 'white', 1, 9)

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


if __name__ == '__main__':
    export_landmark('shizijie', build_shizijie, reuse_atlas=True)
