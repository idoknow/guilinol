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

Intersection details from 2019–2024 street references: terracotta-red (#b84a42)
and ochre-yellow (#cfa346) non-motorized waiting pavements, zebra crosswalks,
four channelizing flowerbed islands, medallion pedestrian guardrails, 6.4 m
cantilevered traffic signal gantries, municipal blue road signs ('中山中路 /
解放西路 / 解放东路'), and NE traffic police booth ('桂林交警').
"""
import math
import numpy as np

from nikoniko import Builder, export_landmark


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


def _commercial_strip(m: Builder, p0, p1, outward_sign, podium_h, total_h, wall_mat, sign_palette, bays):
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
    # Podium cornice, upper window wall, and top classical cornice
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
        # Full-height stone/white pilaster
        m.box(lx, -1.2, 0.22, 0.62, total_h + 1.2, 0.62, wall_mat, collide=True)
        if i < bays:
            cx = lx + bay_w / 2.0
            # Ground shop window + recessed door + cantilevered rain canopy + shop signboard
            m.box(cx, 0.15, -0.05, bay_w - 0.72, 3.15, 0.22, 'glass')
            m.box(cx, 3.15, 0.65, bay_w - 0.45, 0.18, 1.25, 'alum')
            sc = sign_palette[i % len(sign_palette)]
            m.box(cx, 3.45, 0.28, bay_w - 0.68, 0.92, 0.26, sc)
            for gx in (-0.75, 0.0, 0.75):
                if abs(gx) < bay_w * 0.34:
                    m.box(cx + gx, 3.72, 0.43, 0.34, 0.38, 0.08, 'white_lit')
            # Horizontal spandrel floor bands
            for fl in range(1, floors):
                m.box(cx, podium_h + 0.3 + fl * fl_h, 0.20, bay_w - 0.5, 0.36, 0.32, wall_mat)
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _signal_gantry(m: Builder, x, z, yaw, span=8.4, sign_mode=0):
    """Cantilevered traffic signal mast-arm + blue municipal road sign (00-2019.jpg)."""
    m.pose = (x, 0.0, z, yaw)
    # Mast pole on sidewalk/island
    m.cylinder_y(0, 0.0, 6.8, 0, 0.20, 'alum', sections=8 if m.detail else 5, collide=True)
    m.box(0, 0.0, 0, 0.62, 0.45, 0.62, 'dark', collide=True)
    # Horizontal twin truss arms extending +x across approach lanes
    for arm_y in (5.95, 6.45):
        m.beam([0, arm_y, 0], [span, arm_y, 0], 0.085, 'alum', sections=6)
    if m.detail:
        for sx in np.linspace(1.2, span - 0.6, 5):
            m.beam([sx, 5.95, 0], [sx, 6.45, 0], 0.04, 'alum', sections=4)

    # Municipal royal-blue direction sign panel ('↑ 中山中路 / 解放路')
    m.box(span * 0.42, 5.35, 0.14, 3.1, 1.55, 0.10, 'blue')
    if m.detail:
        # White directional arrows & road name bars on sign face
        m.box(span * 0.42 - 0.95, 5.65, 0.21, 0.16, 0.82, 0.04, 'white_lit')
        m.box(span * 0.42 - 0.95, 6.38, 0.21, 0.42, 0.16, 0.04, 'white_lit')
        m.box(span * 0.42 + 0.25, 6.18, 0.21, 1.55, 0.24, 0.04, 'white_lit')
        m.box(span * 0.42 + 0.25, 5.72, 0.21, 1.35, 0.18, 0.04, 'white')
        if sign_mode % 2 == 0:
            m.box(span * 0.42, 5.45, -0.14, 3.0, 1.45, 0.06, 'alum')

    # Dual vertical traffic signal heads with glowing lenses
    for lx, lens_col in ((span * 0.72, 'red_lit'), (span * 0.92, 'hedge_lit')):
        m.box(lx, 5.45, 0.16, 0.52, 1.35, 0.34, 'dark')
        m.box(lx, 5.45, 0.16, 0.58, 1.42, 0.06, 'white')
        if m.detail:
            m.cylinder_y(lx, 6.38, 0.10, 0.34, 0.14, 'red_lit' if lx < span * 0.8 else 'dark', sections=8)
            m.cylinder_y(lx, 6.02, 0.10, 0.34, 0.14, 'yellow_pave', sections=8)
            m.cylinder_y(lx, 5.64, 0.10, 0.34, 0.14, lens_col, sections=8)

    # Lower pedestrian crossing signal on the main post
    m.box(0.28, 2.35, 0.0, 0.28, 0.68, 0.26, 'dark')
    if m.detail:
        m.box(0.43, 2.46, 0.0, 0.05, 0.22, 0.16, 'hedge_lit')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _guardrail_run(m: Builder, p0, p1):
    """Guilin decorative grey metal median/bike guardrail with circular medallions (00-2019.jpg)."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    segs = max(1, round(length / 2.6))
    yaw = math.atan2(dx, dz)
    mx, mz = (p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0
    m.pose = (mx, 0.0, mz, yaw)
    # Top and bottom rails
    m.box(0, 0.92, 0, 0.07, 0.06, length, 'alum', collide=True)
    m.box(0, 0.22, 0, 0.06, 0.05, length, 'alum')
    for i in range(segs + 1):
        lz = -length / 2.0 + i * (length / segs)
        m.box(0, 0.0, lz, 0.18, 1.02, 0.12, 'dark', collide=(i in (0, segs)))
        if m.detail and i < segs:
            cz = lz + 0.5 * (length / segs)
            # Decorative ring medallion in middle of each bay
            m.box(0, 0.38, cz, 0.05, 0.42, 0.42, 'white')
            m.box(0, 0.46, cz, 0.07, 0.24, 0.24, 'dark')
            for bar in (-0.65, -0.35, 0.35, 0.65):
                if abs(bar) < 0.45 * (length / segs):
                    m.box(0, 0.24, cz + bar, 0.035, 0.68, 0.035, 'alum')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _colored_crosswalk_approach(m: Builder, cx, cz, yaw, road_w=24.0, zebra_len=4.2):
    """Zebra crosswalk + red/yellow non-motorized bike waiting boxes (00-2019.jpg foreground)."""
    m.pose = (cx, 0.0, cz, yaw)
    # White zebra stripes flush at y=0.03..0.055 m (autostep-free walkable overlay)
    n_stripes = int((road_w - 2.0) // 1.15)
    for i in range(n_stripes):
        sx = -road_w / 2.0 + 1.4 + i * 1.15
        m.box(sx, 0.025, 0.0, 0.52, 0.026, zebra_len, 'white')

    # Stop line behind crosswalk (+z in approach local coords)
    m.box(0.0, 0.025, zebra_len / 2.0 + 1.4, road_w - 1.6, 0.024, 0.38, 'white')

    # Terracotta-red non-motorized lane band & ochre-yellow waiting box on right & left flanks
    for side in (-1, 1):
        bx = side * (road_w / 2.0 + 2.4)
        # Yellow waiting box right at crosswalk corner
        m.box(bx, 0.028, -0.4, 4.2, 0.028, 5.2, 'yellow_pave')
        # Red bike lane lead-in strip with white directional arrow
        m.box(bx, 0.028, 6.2, 3.8, 0.028, 8.0, 'red_pave')
        if m.detail:
            m.box(bx, 0.057, 5.8, 0.26, 0.012, 2.2, 'white')
            arrow = [
                (bx, 0.069, 4.1),
                (bx - 0.48, 0.069, 4.9),
                (bx + 0.48, 0.069, 4.9),
            ]
            m.mesh(arrow, [[0, 1, 2]], 'white')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def build_shizijie(m: Builder):
    # ------------------------------------------------------------------
    # 1. Central intersection floral & multi-globe post island at (0, 0)
    # Leaves (-4.25, 0) clear asphalt so walk-quick.mjs spawns cleanly
    # at [-884, -169.63] and hits this landmark island within 3 m east!
    # ------------------------------------------------------------------
    m.cylinder_y(0.0, -0.6, 1.18, 0.0, 1.42, 'stone', sections=8, collide=True)
    m.cylinder_y(0.0, 0.58, 0.24, 0.0, 1.18, 'hedge', sections=8)
    m.cylinder_y(0.0, 0.82, 0.18, 0.0, 0.88, 'red', sections=8)
    m.cluster_lamp(0.0, 0.95, 0.0, height=7.6, globes=7, collide=True)

    # ------------------------------------------------------------------
    # 2. Four corner channelizing refuge islands + sidewalks + guardrails
    # ------------------------------------------------------------------
    islands = [
        # NW refuge island (between Jiefang W & Zhongshan N)
        [(-25.5, -18.5), (-14.5, -34.0), (-29.5, -30.5)],
        # NE refuge island (between Zhongshan N & Jiefang E, with police booth)
        [(23.5, -8.5), (42.5, -4.5), (34.0, -24.5)],
        # SE refuge island (between Jiefang E & Zhongshan S)
        [(8.5, 22.5), (27.5, 16.5), (18.5, 38.0)],
        # SW refuge apron tip (leading toward Weixiaotang corner)
        [(-34.5, -3.5), (-21.0, 16.5), (-37.5, 11.5)],
    ]
    for tri in islands:
        m.prism(tri, -1.2, 1.35, 'pave', collide=True, cap_mat='pave')
        # Inner red-flower & hedge planter inside each refuge island
        cx = sum(p[0] for p in tri) / 3.0
        cz = sum(p[1] for p in tri) / 3.0
        shrunk = [(cx + (p[0] - cx) * 0.58, cz + (p[1] - cz) * 0.58) for p in tri]
        m.prism(shrunk, 0.15, 0.34, 'stone', collide=False, cap_mat='hedge')
        inner_red = [(cx + (p[0] - cx) * 0.36, cz + (p[1] - cz) * 0.36) for p in tri]
        m.prism(inner_red, 0.49, 0.14, 'red', collide=False, cap_mat='red')

    # Decorative median & bike-lane guardrails on all 4 arterial legs
    _guardrail_run(m, (6.5, -21.5), (16.5, -54.0))
    _guardrail_run(m, (-8.5, 22.5), (-19.5, 56.0))
    _guardrail_run(m, (-26.0, -5.5), (-62.0, -12.5))
    _guardrail_run(m, (24.0, 5.5), (62.0, 14.5))

    # Colored red/yellow non-motorized waiting pavements & zebra crosswalks on 4 approaches
    _colored_crosswalk_approach(m, 9.8, -32.0, yaw=math.atan2(-10.0, 32.0) + math.pi, road_w=23.0)
    _colored_crosswalk_approach(m, -11.5, 34.0, yaw=math.atan2(-10.0, 32.0), road_w=23.0)
    _colored_crosswalk_approach(m, -38.0, -7.8, yaw=math.atan2(-38.0, -7.8), road_w=22.0)
    _colored_crosswalk_approach(m, 36.0, 8.2, yaw=math.atan2(36.0, 8.2), road_w=22.0)

    # Four cantilevered traffic signal gantries + blue direction signs
    _signal_gantry(m, 22.0, -26.5, yaw=math.atan2(-10.0, 32.0) + math.pi, span=8.8, sign_mode=0)
    _signal_gantry(m, -24.5, 28.0, yaw=math.atan2(-10.0, 32.0), span=8.8, sign_mode=1)
    _signal_gantry(m, -33.5, -19.5, yaw=math.atan2(-38.0, -7.8), span=8.2, sign_mode=2)
    _signal_gantry(m, 31.5, 19.5, yaw=math.atan2(36.0, 8.2), span=8.2, sign_mode=3)

    # NE Corner '桂林交警' blue-and-white police kiosk (visible in 2024 Zhongshan/Shizijie photos)
    m.pose = (32.5, 0.15, -13.5, -0.55)
    m.box(0, 0.0, 0, 3.4, 2.85, 2.8, 'white', collide=True)
    m.box(0, 0.95, 1.42, 2.6, 1.25, 0.08, 'glass')
    m.box(0, 0.0, 1.41, 2.8, 0.88, 0.08, 'red')
    m.box(0, 2.45, 0, 3.7, 0.52, 3.1, 'blue')
    m.box(0, 2.97, 0, 3.9, 0.16, 3.3, 'alum')
    if m.detail:
        for gx in (-0.85, -0.28, 0.28, 0.85):
            m.box(gx, 2.62, 1.58, 0.28, 0.24, 0.05, 'white_lit')
        m.cylinder_y(-0.9, 3.13, 0.22, 0.6, 0.14, 'red_lit', sections=6)
        m.cylinder_y(0.9, 3.13, 0.22, 0.6, 0.14, 'blue_lit', sections=6)
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # ------------------------------------------------------------------
    # 3. NW Corner Building: Nanfang Mansion (南方大厦, way/691576459)
    # 7 storeys / 25.2 m with curved SE corner rotunda facing Shizijie
    # ------------------------------------------------------------------
    nw_apron = [
        (-87.0, -40.5), (-42.0, -30.5), (-22.0, -41.5), (-8.5, -49.5),
        (5.0, -100.5), (-50.5, -117.5),
    ]
    m.prism(nw_apron, -2.0, 2.08, 'pave', collide=True, cap_mat='pave')
    m.prism(NW_NANFANG, -2.0, 6.8, 'dark', collide=True, cap_mat='alum')
    m.prism(NW_NANFANG, 4.8, 20.4, 'white', collide=True, cap_mat='roof')
    # Curved SE corner glass tower accent facing intersection
    m.cylinder_y(-24.5, 4.8, 22.4, -46.0, 9.6, 'glass', sections=16 if m.detail else 8, collide=True)
    m.cylinder_y(-24.5, 27.2, 2.2, -46.0, 8.8, 'white', sections=16 if m.detail else 8)
    if m.detail:
        # Rooftop signboard '南方大厦' facing SE
        m.pose = (-24.5, 27.5, -46.0, math.atan2(1.0, 1.1))
        m.box(0, 0, 8.95, 6.4, 1.55, 0.22, 'blue')
        for gx in (-2.0, -0.68, 0.68, 2.0):
            m.box(gx, 0.28, 9.10, 0.85, 0.98, 0.10, 'white_lit')
        m.pose = (0.0, 0.0, 0.0, 0.0)
    _commercial_strip(m, (-84.57, -42.86), (-44.98, -33.52), 1, 4.8, 25.2, 'white', ['blue', 'red', 'dark'], 7)
    _commercial_strip(m, (-11.67, -51.43), (1.66, -98.94), 1, 4.8, 25.2, 'white', ['red', 'dark', 'blue'], 8)

    # ------------------------------------------------------------------
    # 4. SE Corner Building: Cultural Mansion (文化大厦, way/266333052)
    # 6 storeys / 22.6 m beige-stone pilaster & blue-green glass bays
    # (matches classic pilastered commercial building on left of 00-2019.jpg)
    # ------------------------------------------------------------------
    se_apron = [
        (4.0, 92.5), (67.5, 108.5), (85.5, 52.5), (48.0, 42.5),
        (32.0, 61.5), (10.5, 62.0),
    ]
    m.prism(se_apron, -2.0, 2.08, 'pave', collide=True, cap_mat='pave')
    m.prism(SE_WENHUA, -2.0, 6.6, 'dark', collide=True, cap_mat='beige')
    m.prism(SE_WENHUA, 4.6, 18.0, 'beige', collide=True, cap_mat='roof')
    # Curved NW corner colonnade & glass bay facing Shizijie
    m.cylinder_y(34.5, 4.6, 19.2, 60.5, 10.2, 'glass', sections=16 if m.detail else 8, collide=True)
    m.cylinder_y(34.5, 23.8, 1.6, 60.5, 10.6, 'beige', sections=16 if m.detail else 8)
    _commercial_strip(m, (13.90, 65.34), (7.28, 90.65), 1, 4.6, 22.6, 'beige', ['red', 'terra', 'dark'], 4)
    _commercial_strip(m, (82.39, 54.74), (50.92, 46.35), 1, 4.6, 22.6, 'beige', ['blue', 'dark', 'red'], 6)
    _commercial_strip(m, (69.26, 102.78), (82.39, 54.74), 1, 4.6, 22.6, 'beige', ['terra', 'red'], 7)

    # ------------------------------------------------------------------
    # 5. NE Corner Block & East Jiefang Wing (way/691576457, way/675759091)
    # Stepped white/grey modern retail facades (00-2019.jpg right side)
    # ------------------------------------------------------------------
    ne_apron = [
        (46.0, -45.5), (53.5, -23.0), (63.5, -7.5), (135.5, 16.5),
        (137.0, -2.5), (94.5, -78.5), (59.5, -87.0),
    ]
    m.prism(ne_apron, -2.0, 2.08, 'pave', collide=True, cap_mat='pave')
    m.prism(NE_CORNER, -2.0, 6.4, 'dark', collide=True, cap_mat='alum')
    m.prism(NE_CORNER, 4.4, 17.0, 'white', collide=True, cap_mat='roof')
    # Stepped corner tower crown with green rooftop sign frame (00-2019.jpg right)
    m.pose = (60.5, 0.0, -24.5, math.atan2(-1.0, 0.85))
    m.box(0, 21.4, 0, 14.0, 3.2, 12.0, 'alum')
    if m.detail:
        m.box(0, 24.6, 5.8, 8.5, 1.5, 0.24, 'hedge')
        for gx in (-2.6, -0.9, 0.9, 2.6):
            m.box(gx, 24.9, 5.96, 0.82, 0.88, 0.08, 'white_lit')
    m.pose = (0.0, 0.0, 0.0, 0.0)
    _commercial_strip(m, (49.35, -43.56), (65.01, -10.57), 1, 4.4, 21.4, 'white', ['hedge', 'blue', 'red'], 6)
    _commercial_strip(m, (61.23, -84.32), (49.35, -43.56), 1, 4.4, 21.4, 'white', ['blue', 'dark'], 7)

    # 4-storey Jiefang East Road arcade annex (way/675759091)
    m.prism(NE_ANNEX, -2.0, 4.5, 'dark', collide=True, cap_mat='beige')
    m.prism(NE_ANNEX, 2.5, 12.3, 'white', collide=True, cap_mat='roof')
    _commercial_strip(m, (76.25, 1.14), (130.47, 13.93), 1, 4.2, 14.8, 'white', ['red', 'blue', 'terra'], 9)

    # Sidewalk camphor street trees & multi-globe lamps around the 3 corners
    if m.detail:
        for tx, tz in ((-54.0, -30.5), (-68.0, -34.0), (50.5, -18.0), (88.0, 6.5), (108.0, 11.2), (24.0, 56.5), (4.5, 74.0)):
            m.street_tree(tx, 0.08, tz, height=8.2, spread=3.3, kind='camphor', lanterns=True, collide=True)
        for lx, lz in ((-38.0, -29.0), (45.0, -32.0), (68.0, 2.5), (14.5, 55.0)):
            m.cluster_lamp(lx, 0.08, lz, height=7.0, globes=5, collide=True)


if __name__ == '__main__':
    export_landmark('shizijie', build_shizijie)
