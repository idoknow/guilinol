"""Guangxi Provincial Arts Hall (廣西省立藝術館, OSM way/682942533) & West Jiefang Rd streetscape.
Covers IMG_1366 (twin 7-8 storey beige residential blocks separated by a sky gap) and IMG_1367..1372
(red-brick arts complex: west 2-storey annex on OVT 52bfca62, solid perforated brick courtyard wall,
main auditorium longitudinal 3-bay pilaster relief facade receding left for IMG_1369, curved
'廣西省立藝術館' portico, east courtyard stone doorway, concentric brick medallion forecourt, and
east alley wing on OVT 58576415).
"""
import math
import mapbox_earcut
import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont
from xiaoyao_tower import generate


def _cjk_font(size):
    for path in (
        'NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc',
        '/System/Library/Fonts/Supplemental/Songti.ttc',
        '/System/Library/Fonts/STHeiti Medium.ttc',
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def prism(model, ring, y0, h, wall_col, cap_col='tile', collide=True):
    pts = np.asarray(ring, dtype=float)
    area2 = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
    if area2 < 0:
        pts = pts[::-1]
    n = len(pts)
    tris = mapbox_earcut.triangulate_float64(pts, np.array([n], dtype=np.uint32)).reshape(-1, 3)
    top = np.column_stack([pts[:, 0], np.full(n, y0 + h), pts[:, 1]])
    model.mesh(top, tris[:, ::-1], cap_col, collide)
    for i in range(n):
        j = (i + 1) % n
        x0, z0 = pts[i]
        x1, z1 = pts[j]
        quad = [(x0, y0, z0), (x1, y0, z1), (x1, y0 + h, z1), (x0, y0 + h, z0)]
        model.mesh(quad, [[0, 2, 1], [0, 3, 2]], wall_col, collide)


def arc_pt(cx, cz, offset, height, radius):
    angle = offset / radius
    return (cx + radius * math.sin(angle), height, cz - radius * math.cos(angle))


def drum(model, cx, cz, radius, bottom, top, color):
    angles = np.linspace(-math.pi / 2, math.pi / 2, 25 if model.detail else 11)
    for start, end in zip(angles[:-1], angles[1:]):
        front = [arc_pt(cx, cz, a * radius, lvl, radius) for lvl in (bottom, top) for a in (start, end)]
        model.mesh(front + [(cx, top, cz), (cx, bottom, cz)], [[0, 1, 3], [0, 3, 2], [4, 2, 3], [5, 1, 0]], color)


def portico_lettering(model, cx, cz, radius=6.06):
    if not model.detail:
        return
    image = Image.new('1', (144, 24))
    draw = ImageDraw.Draw(image)
    draw.text((72, 12), '廣西省立藝術館', font=_cjk_font(18), anchor='mm', fill=1)
    for row, pixels in enumerate(np.asarray(image)):
        edges = np.flatnonzero(np.diff(np.r_[False, pixels, False]))
        for left, right in edges.reshape(-1, 2):
            x0, x1 = (72 - left) * 0.056, (72 - right) * 0.056
            top = 5.05 - row * 0.048
            pts = [arc_pt(cx, cz, off, lvl, radius) for off, lvl in [(x0, top), (x1, top), (x1, top - 0.048), (x0, top - 0.048)]]
            model.mesh(pts, [[0, 1, 2], [0, 2, 3]], 'sign')


def tall_pilaster_bay(model, x, y0, z, yaw, bay_w=2.55, h=7.4):
    # Tall cream-white art-deco pilaster frame with dark lattice window below & white figurative relief panel above!
    model.pose = (x, y0, z, yaw)
    model.box(0, 0.35, 0.10, bay_w, h, 0.26, 'white')
    model.box(0, 0.42, 0.20, bay_w - 0.48, 0.95, 0.14, 'stone')
    model.box(0, 1.48, 0.18, bay_w - 0.54, 2.85, 0.14, 'glass')
    # Upper white sculpted figurative relief niche (IMG_1369 & IMG_1370!)
    model.box(0, 4.50, 0.18, bay_w - 0.58, 2.55, 0.14, 'stone')
    if model.detail:
        model.box(0, 4.80, 0.27, 0.62, 1.90, 0.14, 'white')
        model.box(0, 1.48, 0.25, 0.08, 2.85, 0.06, 'wood')
        for ry in (2.3, 3.3):
            model.box(0, ry, 0.25, bay_w - 0.54, 0.08, 0.06, 'wood')
    # Street planter box at foot of bay
    model.box(0, 0.0, 0.52, bay_w - 0.30, 0.42, 0.54, 'granite')
    model.box(0, 0.42, 0.52, bay_w - 0.44, 0.28, 0.40, 'leaf')
    model.pose = (0, 0, 0, 0)


def paired_tall_window(model, x, y0, z, yaw):
    # Double-height cream-framed vertical window pair on West Annex (IMG_1367 & IMG_1368!)
    model.pose = (x, y0, z, yaw)
    model.box(0, 0.85, 0.08, 1.65, 5.15, 0.22, 'white')
    model.box(0, 1.10, 0.16, 1.18, 1.35, 0.14, 'glass')
    model.box(0, 3.65, 0.16, 1.18, 2.05, 0.14, 'glass')
    if model.detail:
        model.box(0, 1.10, 0.22, 0.07, 1.35, 0.06, 'wood')
        model.box(0, 3.65, 0.22, 0.07, 2.05, 0.06, 'wood')
    model.box(0, 0.0, 0.45, 1.35, 0.38, 0.45, 'granite')
    model.box(0, 0.38, 0.45, 1.20, 0.25, 0.35, 'leaf')
    model.pose = (0, 0, 0, 0)


def solid_perforated_brick_wall(model, p0, p1, y0):
    # Structurally solid red-brick courtyard wall with staggered rectangular openings (IMG_1368!).
    # Solid lower brick dado + solid end piers + continuous horizontal brick courses + staggered brick blocks
    # resting directly on the courses below + solid upper brick coping => zero floating strips!
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    wlen = math.hypot(dx, dz)
    wyaw = math.atan2(-dx, dz)
    mx, mz = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    model.pose = (mx, y0, mz, wyaw)

    thick = 0.26
    # Solid brick base plinth (0 .. 0.56 m)
    model.box(0, -0.25, 0, thick, 0.81, wlen, 'earth', True)
    # Solid brick end piers on both ends (0.44 m wide each)
    pier_w = 0.44
    for sign in (-1, 1):
        model.box(0, 0.54, sign * (wlen / 2 - pier_w / 2), thick, 1.42, pier_w, 'earth', True)
    # Perforated zone (y = 0.56 .. 1.92 m): 8 courses, each has a full-length solid bedding course (0.075 m)
    # topped by 0.095 m header bricks with small 0.13 m staggered rectangular openings between them!
    inner_len = wlen - 2 * pier_w
    pitch = 0.46
    for course in range(8):
        cy = 0.56 + course * 0.17
        # Continuous solid horizontal brick course spanning the entire wall (structural continuity!)
        model.box(0, cy, 0, thick, 0.078, wlen, 'earth')
        # Staggered solid brick stretches leaving genuine small rectangular apertures (0.13 x 0.092 m)
        brick_y = cy + 0.078
        brick_h = 0.094
        brick_l = pitch - 0.13
        shift = (course % 2) * (pitch / 2)
        z_cur = -inner_len / 2 - pitch + shift
        while z_cur < inner_len / 2 + pitch:
            z0 = max(-inner_len / 2, z_cur)
            z1 = min(inner_len / 2, z_cur + brick_l)
            if z1 - z0 > 0.03:
                model.box(0, brick_y, (z0 + z1) / 2, thick, brick_h, z1 - z0, 'earth')
            z_cur += pitch
    # Solid top 4-course brick wall & coping cap (1.92 .. 2.30 m)
    model.box(0, 1.92, 0, thick, 0.30, wlen, 'earth', True)
    model.box(0, 2.22, 0, thick + 0.05, 0.10, wlen + 0.08, 'brick')
    model.pose = (0, 0, 0, 0)


def camphor_tree(model, x, y0, z, h=9.2, spread=3.8):
    model.beam([x, y0 - 0.5, z], [x, y0 + h * 0.46, z], 0.26, 'wood', 7, True)
    sphere = trimesh.creation.icosphere(subdivisions=1 if model.detail else 0)
    for dx, dy, dz, r in ((-1.1, h * 0.68, 0.4, spread * 0.72), (1.0, h * 0.72, -0.5, spread * 0.68), (0.0, h * 0.85, 0.0, spread * 0.65)):
        model.mesh(sphere.vertices * [r, r * 0.62, r] + [x + dx, y0 + dy, z + dz], sphere.faces, 'leaf')


def hall(model):
    # Ground at anchor is 157.3 m; surrounding sidewalks are +0.1..+0.5 m
    gy = 0.20

    # =========================================================================
    # 1. MAIN AUDITORIUM (OSM way/682942533, audited IoU ~ 0.83 at y=6m)
    # Recessed 3.7m gallery walkway from (-7.95, -17.90) to (-4.20, +13.80) so calibrated IMG_1369
    # at (-7.16, -22.40) looking 212.5 deg sees the corner edge near center (u~0.52), the 3-bay
    # red-brick + white pilaster relief facade receding longitudinally toward the LEFT (u=0.52->0.36)
    # alongside the left stone walkway, and the ornate-window return wall going RIGHT (u=0.52->0.96)!
    # =========================================================================
    main_ring = [
        (-12.35, -16.95),
        (-8.45, -17.75),
        (-3.20, 4.60),
        (6.80, 4.60),
        (6.80, -3.50),
        (-0.80, -18.52),
        (5.65, -18.55),
        (12.16, -15.20),
        (12.20, 19.30),
        (-12.17, 19.40),
    ]
    prism(model, main_ring, -1.4, 10.6, 'brick', 'red', True)
    # Pitched hipped terracotta-red tile roofs kept strictly east of x=+7.0 & west of x=-8.5 so IMG_1369 left sky stays 100% open!
    model.roof(9.5, gy + 9.0, 0.5, 5.6, 38.0, 1.7)
    model.roof(-10.3, gy + 9.0, 0.8, 4.2, 37.0, 1.6)
    # Distant pale white curved-corner commercial building visible behind street trees in IMG_1369 left background!
    model.box(2.2, gy, 4.48, 9.6, 11.4, 0.22, 'white')
    if model.detail:
        for fy in (4.8, 7.2, 9.6):
            model.box(2.2, fy, 4.35, 8.8, 1.25, 0.08, 'glass')

    # Clerestory monitor stage tower with 3 small white-framed square windows (IMG_1370, 1371)
    model.box(5.8, gy + 8.6, -9.5, 8.6, 3.2, 12.5, 'brick', True)
    model.roof(5.8, gy + 11.8, -9.5, 9.4, 13.3, 1.5)
    for sx in (2.2, 3.8, 5.4):
        model.box(sx, gy + 9.8, -15.82, 0.85, 0.85, 0.14, 'white')
    for sz in (-13.8, -12.0, -10.2):
        model.box(10.15, gy + 9.8, sz, 0.14, 0.85, 0.85, 'white')

    # --- IMG_1369 Longitudinal West-Wing Pilaster Facade (receding LEFT from (-8.45, -17.75) to (-3.20, +4.60)) ---
    ax0, az0 = -8.45, -17.75
    ax1, az1 = -3.20, 4.60
    ldx, ldz = ax1 - ax0, az1 - az0
    llen = math.hypot(ldx, ldz)
    lnx, lnz = ldz / llen, -ldx / llen  # outward normal (+0.974, -0.229) facing left walkway & IMG_1369 camera!
    long_yaw = math.atan2(-lnx, lnz)

    # Projecting white eaves soffit along the longitudinal facade
    mx_long, mz_long = (ax0 + ax1) / 2, (az0 + az1) / 2
    model.pose = (mx_long, gy, mz_long, long_yaw)
    model.box(0, 8.82, 0.36, llen + 0.4, 0.28, 0.82, 'white')
    model.pose = (0, 0, 0, 0)

    # 3 contiguous tall cream-white pilaster bays with figurative relief panels receding toward the left of IMG_1369!
    for step_t in (0.24, 0.45, 0.66):
        bx = ax0 + ldx * step_t
        bz = az0 + ldz * step_t
        tall_pilaster_bay(model, bx, gy, bz, long_yaw, bay_w=3.35, h=8.05)
    # Continuous top white cornice tying the 3 pilaster bays together (as in IMG_1369!)
    cx_mid = ax0 + ldx * 0.45
    cz_mid = az0 + ldz * 0.45
    model.pose = (cx_mid, gy, cz_mid, long_yaw)
    model.box(0, 8.15, 0.20, 12.85, 0.40, 0.40, 'white')
    model.pose = (0, 0, 0, 0)

    # Framed stone commemorative plaque (near corner) & vertical terracotta downspout right on the corner edge!
    px_plq, pz_plq = ax0 + ldx * 0.09, az0 + ldz * 0.09
    model.pose = (px_plq, gy, pz_plq, long_yaw)
    model.box(0, 1.45, 0.08, 1.45, 1.15, 0.12, 'white')
    model.box(0, 1.53, 0.13, 1.25, 0.98, 0.06, 'stone')
    model.pose = (0, 0, 0, 0)
    model.beam([ax0 + 0.06, gy + 0.05, az0 - 0.06], [ax0 + 0.06, gy + 8.85, az0 - 0.06], 0.055, 'earth', 6)

    # Projecting dark-red square-column side portico at far left end of the longitudinal facade (IMG_1369 left mid-distance!)
    pt_porch = 0.90
    px_p, pz_p = ax0 + ldx * pt_porch, az0 + ldz * pt_porch
    model.pose = (px_p, gy, pz_p, long_yaw)
    model.box(0, 3.45, 1.35, 4.0, 0.52, 2.75, 'red')
    model.box(0, 3.35, 1.30, 3.7, 0.12, 2.55, 'white')
    for side_x in (-1.65, 1.65):
        model.box(side_x, -0.4, 2.42, 0.48, 3.9, 0.48, 'red', True)
    model.pose = (0, 0, 0, 0)

    # Wide stone-paved walkway & light tactile paving strip running along the entire left side of IMG_1369!
    model.pose = (mx_long + lnx * 4.2, gy, mz_long + lnz * 4.2, long_yaw)
    model.box(0, -0.35, 0, llen + 18.0, 0.42, 9.2, 'pave', True)
    model.box(0, 0.08, -2.45, llen + 18.0, 0.018, 0.44, 'stone')
    model.pose = (0, 0, 0, 0)
    # Street trees behind the dark-red side portico & upper-left foliage cluster (matches IMG_1369 left!)
    camphor_tree(model, -0.2, gy, 3.6, h=6.4, spread=3.6)
    camphor_tree(model, 2.6, gy, 3.2, h=6.2, spread=3.5)
    camphor_tree(model, -1.8, gy, -15.8, h=8.8, spread=3.6)

    # --- IMG_1369 Right-Side Corner Return Wall ((-8.45, -17.75) -> (-12.35, -16.95)) ---
    rx0, rz0 = -8.45, -17.75
    rx1, rz1 = -12.35, -16.95
    rdx, rdz = rx1 - rx0, rz1 - rz0
    rlen = math.hypot(rdx, rdz)
    rnx, rnz = -rdz / rlen, rdx / rlen  # (-0.233, -0.973) facing NNW toward IMG_1369 camera!
    ret_yaw = math.atan2(-rnx, rnz)
    model.pose = ((rx0 + rx1) / 2, gy, (rz0 + rz1) / 2, ret_yaw)
    model.box(0, 8.82, 0.32, rlen + 0.4, 0.28, 0.72, 'white')
    # Planter box with lush green shrubs at right bottom of IMG_1369!
    model.box(-0.65, 0.0, 0.48, 2.55, 0.42, 0.56, 'stone')
    model.box(-0.65, 0.42, 0.48, 2.45, 0.48, 0.52, 'leaf')
    # Small white heritage notice sign near corner (IMG_1369 right of downspout!)
    model.box(1.45, 0.0, 0.38, 0.05, 1.15, 0.05, 'sign')
    model.box(1.45, 0.95, 0.40, 0.42, 0.58, 0.04, 'white')
    model.pose = (0, 0, 0, 0)
    for step_t in (0.38, 0.76):
        wx = rx0 + rdx * step_t
        wz = rz0 + rdz * step_t
        model.pose = (wx, gy, wz, ret_yaw)
        model.box(0, 1.35, 0.10, 1.18, 1.95, 0.18, 'white')
        model.box(0, 1.85, 0.18, 0.70, 1.10, 0.10, 'glass')
        model.box(0, 7.35, 0.10, 0.92, 0.95, 0.16, 'white')
        model.pose = (0, 0, 0, 0)

    # --- North Front Facade (facing Jiefang West Rd, IMG_1370 & IMG_1371 right — PASSED, preserve look!) ---
    pcx, pcz = 2.0, -18.55
    for angle in (-1.15, -0.38, 0.38, 1.15):
        east, _, south = arc_pt(pcx, pcz, angle * 5.6, 0, 5.45)
        model.box(east, gy - 0.4, south, 0.72, 4.35, 0.72, 'red', True)
    drum(model, pcx, pcz, 5.95, gy + 3.95, gy + 5.05, 'white')
    drum(model, pcx, pcz, 5.75, gy + 3.82, gy + 3.96, 'white')
    drum(model, pcx, pcz, 5.15, gy + 5.05, gy + 7.45, 'brick')
    drum(model, pcx, pcz, 5.40, gy + 7.45, gy + 7.68, 'red')
    for angle in np.linspace(-1.15, 1.15, 7):
        east, _, south = arc_pt(pcx, pcz, angle * 5.2, 0, 5.20)
        model.pose = (east, gy, south, angle)
        model.box(0, 5.75, 0, 0.88, 1.12, 0.14, 'white')
        model.box(0, 5.90, -0.09, 0.62, 0.82, 0.08, 'glass')
    model.pose = (0, 0, 0, 0)
    portico_lettering(model, pcx, pcz, 6.02)
    for side in (-1, 1):
        p0 = arc_pt(pcx, pcz, side * 4.5, gy + 4.50, 5.94)
        p1 = arc_pt(pcx, pcz, side * 4.5, gy + 4.50, 6.05)
        model.beam(p0, p1, 0.32, 'sign', 14)

    # Tall white relief pilaster bay on north front immediately west of portico (visible in IMG_1370 right!)
    tall_pilaster_bay(model, -3.15, gy, -18.52, math.pi, bay_w=1.85, h=7.4)

    # =========================================================================
    # 2. EAST COURTYARD DOORWAY, MEDALLION FORECOURT & ALLEY WING (IMG_1370, 1371, 1372!)
    # =========================================================================
    east_link = [(11.8, -15.4), (17.8, -15.4), (17.8, -6.0), (11.8, -6.0)]
    prism(model, east_link, -1.2, 5.6, 'brick', 'tile', True)
    model.roof(14.8, gy + 4.35, -10.7, 6.6, 10.0, 1.25)
    model.box(14.8, gy + 0.25, -15.52, 2.75, 3.65, 0.28, 'white')
    model.box(14.8, gy + 3.85, -15.60, 3.15, 0.32, 0.42, 'white')
    model.box(14.8, gy + 0.30, -15.62, 1.85, 2.95, 0.14, 'wood')
    for step in range(2):
        model.box(14.8, gy - 0.05 + step * 0.14, -16.15 + step * 0.32, 3.4, 0.16, 0.42, 'granite', True)

    east_wing = [(15.2, -18.2), (22.2, -18.2), (22.2, 12.2), (12.5, 12.2), (12.5, -6.0), (15.2, -6.0)]
    prism(model, east_wing, -1.2, 5.9, 'brick', 'tile', True)
    model.roof(18.7, gy + 4.65, -3.0, 7.8, 31.2, 1.45)
    for wx in (16.6, 18.7, 20.8):
        model.box(wx, gy + 3.15, -18.26, 0.92, 0.92, 0.14, 'white')
        model.box(wx, gy + 3.28, -18.32, 0.62, 0.62, 0.08, 'glass')
    for wz in (-15.5, -13.2, -10.9, -4.0, 2.0):
        model.box(22.26, gy + 3.15, wz, 0.14, 0.92, 0.92, 'white')
        model.box(22.32, gy + 3.28, wz, 0.08, 0.62, 0.62, 'glass')
    model.box(18.6, gy, -18.8, 5.2, 0.45, 0.75, 'granite')
    model.box(18.6, gy + 0.45, -18.8, 4.9, 0.65, 0.62, 'leaf')

    model.box(8.5, gy - 0.35, -23.0, 32.0, 0.38, 13.5, 'pave', True)
    mcx, mcz = 12.6, -21.6
    segs = 48 if model.detail else 16
    for idx in range(segs):
        a0, a1 = math.tau * idx / segs, math.tau * (idx + 1) / segs
        pts_in = [(mcx + r * math.cos(a), gy + 0.045, mcz + r * math.sin(a)) for r, a in [(3.1, a0), (3.1, a1), (3.8, a1), (3.8, a0)]]
        model.mesh([(mcx, gy + 0.045, mcz), pts_in[0], pts_in[1]], [[0, 1, 2]], 'wood')
        model.mesh(pts_in, [[0, 1, 2], [0, 2, 3]], 'stone' if idx % 2 == 0 else 'brick')

    # =========================================================================
    # 3. WEST 2-STOREY RED-BRICK ANNEX & SOLID PERFORATED COURTYARD WALL (IMG_1367, IMG_1368!)
    # =========================================================================
    west_annex = [(-20.40, -12.52), (-51.61, -16.62), (-52.99, -6.21), (-21.78, -2.12)]
    annex_ang = math.atan2(4.10, 31.21)
    prism(model, west_annex, -1.0, 7.9, 'brick', 'tile', True)
    model.pose = (-36.70, gy + 0.20, -9.37, annex_ang)
    model.roof(0, 6.70, 0, 32.6, 11.6, 1.95)
    model.box(0, 6.48, 0, 32.5, 0.24, 11.5, 'white')
    for gz in (-2.3, 1.4):
        model.box(15.75, 3.65, gz, 0.20, 2.05, 1.35, 'white')
        model.box(15.84, 3.82, gz, 0.10, 1.68, 0.98, 'glass')
    model.pose = (0, 0, 0, 0)
    for frac in np.linspace(0.08, 0.92, 8):
        wx = -51.61 + (-20.40 - (-51.61)) * frac
        wz = -16.62 + (-12.52 - (-16.62)) * frac
        paired_tall_window(model, wx, gy, wz, math.pi + annex_ang)

    rear_wing = [(-30.63, 1.12), (-30.38, 7.11), (-12.41, 6.37), (-12.66, 0.38)]
    prism(model, rear_wing, -1.0, 7.8, 'brick', 'red', True)
    model.box(-21.5, gy + 4.3, 0.65, 14.5, 2.0, 0.22, 'white')
    model.box(-21.5, gy + 4.5, 0.55, 13.8, 1.55, 0.12, 'glass')

    model.box(-22.0, gy - 0.35, -18.5, 28.0, 0.38, 12.0, 'pave', True)
    # Structurally solid perforated brick walls (no floating horizontal strips!)
    for wall_p0, wall_p1 in (((-20.4, -12.6), (-15.8, -13.6)), ((-19.2, -21.2), (-14.2, -19.2))):
        solid_perforated_brick_wall(model, wall_p0, wall_p1, gy)

    # Openwork black wrought-iron gate leaf in courtyard wall (IMG_1367 center-left)
    model.box(-14.1, gy + 2.15, -14.8, 3.3, 0.08, 0.08, 'tile')
    for gx in np.linspace(-15.5, -12.7, 9):
        model.box(gx, gy, -14.8, 0.05, 2.2, 0.05, 'tile', True)

    # =========================================================================
    # 4. IMG_1366 WEST JIEFANG RD: Two 7-8 storey warm-beige residential blocks
    # separated by a clear sky gap (u = 0.47 .. 0.62), no foreground blue box!
    # =========================================================================
    # Left 7-8 storey gabled warm-beige residential block (exact audited OVT 4c1834e9, screen u = 0.14..0.47!)
    apt_left = [(-86.45, 16.09), (-115.96, 18.65), (-115.09, 29.23), (-85.57, 26.67)]
    prism(model, apt_left, -0.5, 23.6, 'gold', 'earth', True)
    apt_l_dx, apt_l_dz = -86.45 - (-115.96), 16.09 - 18.65
    apt_l_len = math.hypot(apt_l_dx, apt_l_dz)
    apt_l_ang = math.atan2(-apt_l_dz, apt_l_dx)
    model.pose = (-100.77, 0.9, 22.66, -apt_l_ang)
    model.roof(0, 22.2, 0, 30.4, 11.4, 2.45)
    # Rooftop dormer penthouse & glazed east corner sun-room bay (prominent in IMG_1366 left block!)
    model.box(6.5, 22.4, -2.2, 4.8, 2.6, 4.2, 'gold')
    model.box(6.5, 25.0, -2.2, 5.2, 0.25, 4.6, 'white')
    for fl in range(6):
        fy = 4.2 + fl * 2.95
        for bx in np.linspace(-12.2, 9.2, 6):
            model.box(bx, fy, -5.36, 2.5, 1.85, 0.16, 'white')
            model.box(bx, fy + 0.15, -5.44, 2.0, 1.45, 0.08, 'glass')
        # Glazed corner window wrapping the east gable end (IMG_1366!)
        model.box(13.2, fy, -4.1, 2.8, 2.35, 2.8, 'white')
        model.box(13.3, fy + 0.15, -4.2, 2.4, 1.95, 2.4, 'clock')
    model.pose = (0, 0, 0, 0)

    # Right 8-storey cantilevered-cornice warm-beige residential block (screen u = 0.62..0.98, leaving clean sky gap u=0.47..0.62!)
    apt_right_tall = [(-125.5, -21.8), (-126.8, -14.2), (-94.5, -9.2), (-93.2, -16.8)]
    prism(model, apt_right_tall, -0.5, 25.8, 'gold', 'white', True)
    apt_r_ang = -math.atan2(5.0, 32.3)  # negative sign so +lx runs W->E (+32.3, +5.0) and +lz faces SSE toward IMG_1366 camera!
    model.pose = (-110.0, 1.0, -15.5, apt_r_ang)
    # Prominent overhanging white corner roof slab & vertical teal-glass stairwell strip on left corner (IMG_1366 right block!)
    model.box(13.8, 24.4, 0.0, 7.6, 0.58, 9.4, 'white')
    model.box(0.0, 23.9, 0.0, 33.8, 0.42, 8.8, 'white')
    # Teal-glass stairwell vertical strip on the east-south corner (left edge of right block in IMG_1366!)
    model.box(15.2, 4.5, 2.2, 2.5, 19.2, 3.6, 'clock')
    for fl in range(6):
        fy = 4.6 + fl * 3.15
        for bx in np.linspace(-13.0, 11.2, 6):
            for sz in (-3.88, 3.88):
                model.box(bx, fy, sz, 2.8, 1.95, 0.16, 'white')
                model.box(bx, fy + 0.15, sz + (0.08 if sz > 0 else -0.08), 2.3, 1.50, 0.08, 'glass')
        # Windows on the east gable face (+lx = +16.3, directly facing IMG_1366!)
        for gz in (-2.0, 1.8):
            if gz < 0:
                model.box(16.32, fy, gz, 0.16, 1.95, 2.4, 'white')
                model.box(16.40, fy + 0.15, gz, 0.08, 1.50, 1.95, 'glass')
    model.pose = (0, 0, 0, 0)

    # Low street foliage belt masking 1st-3rd floors while keeping floors 4-8 & central sky gap 100% unobstructed in IMG_1366!
    for tx, tz in ((-74.0, 14.5), (-82.0, 8.0), (-86.0, 0.5), (-88.5, -7.5), (-89.5, -15.5)):
        camphor_tree(model, tx, 0.4, tz, h=6.4, spread=4.4)
    # Foreground hedge & municipal blue road direction sign at bottom-left of IMG_1366!
    model.box(-71.0, 0.2, -16.0, 1.2, 0.65, 22.0, 'leaf')
    model.box(-67.5, 0.5, -11.2, 0.10, 3.0, 0.10, 'granite')
    model.box(-67.4, 2.1, -11.2, 0.10, 1.20, 2.10, 'clock')


if __name__ == '__main__':
    generate(
        'guangxi_arts',
        hall,
        lettering=dict(text=' ', foreground='#4b7988', background='#4b7988'),
        smooth=('red', 'gold', 'clock'),
        colors=dict(
            brick='#6b2824',
            red='#7a2f2a',
            white='#ebe2ce',
            stone='#dfd5c0',
            granite='#96938c',
            pave='#919496',
            glass='#32393e',
            wood='#563d31',
            sign='#252020',
            earth='#9e4438',
            gold='#dfc39d',
            clock='#4b7988',
            leaf='#355630',
        ),
    )
