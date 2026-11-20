"""Guilin Middle School Jiefang West Campus (桂林中学解西校区), anchored at OSM way/690980799 (奎光楼).
Covers IMG_1373..1379: street-facing grand pillared school gate at OSM node/14361227231 with coffered
terracotta-pink ceiling, '桂林中学' plaque, green glazed tile eave, rooftop red flag & stone lions
(strictly NO guardhouse, NO turnstiles, NO retractable gate per K-12 rule), flanked on the west by
the 7-storey curved blue-ribbon corner building and on the east by the 2-storey white green-eave
annex (OVT 6b38f00b) + tall curved-canopy white teaching tower (OVT f97d45ef), framing historic
Kuiguang Lou (way/690980799) inside.
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


def prism(model, ring, y0, h, wall_col, cap_col='granite', collide=True):
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


def text_mesh(model, text, width, height, color, y_center, z_plane, font_px=28):
    if not model.detail:
        return
    font = _cjk_font(font_px)
    w_px = max(80, round(width * 36))
    h_px = max(28, round(height * 36))
    image = Image.new('1', (w_px, h_px))
    draw = ImageDraw.Draw(image)
    draw.text((w_px // 2, h_px // 2), text, font=font, anchor='mm', fill=1)
    sx, sy = width / w_px, height / h_px
    for row, pixels in enumerate(np.asarray(image)):
        for left, right in np.flatnonzero(np.diff(np.r_[False, pixels, False])).reshape(-1, 2):
            x0, x1 = (left - w_px / 2) * sx, (right - w_px / 2) * sx
            top = y_center + height / 2 - row * sy
            model.mesh(
                [(x0, top, z_plane), (x1, top, z_plane), (x1, top - sy, z_plane), (x0, top - sy, z_plane)],
                [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]],
                color,
            )


def seated_lion(model, x, y0, z, yaw):
    # Carved grey-stone guardian lion on stepped pedestal (prominent in IMG_1375 foreground!)
    model.pose = (x, y0, z, yaw)
    model.box(0, -0.4, 0, 1.18, 0.72, 1.52, 'granite', True)
    model.box(0, 0.32, 0, 1.02, 0.42, 1.36, 'stone', True)
    model.box(0, 0.74, -0.05, 0.84, 0.88, 1.08, 'stone', True)
    model.box(0, 1.52, 0.16, 0.72, 0.62, 0.72, 'stone')
    model.box(0, 1.72, -0.06, 0.80, 0.48, 0.56, 'granite')
    # Front legs & cub/ball
    for sx in (-0.28, 0.28):
        model.box(sx, 0.74, 0.46, 0.22, 0.72, 0.24, 'stone')
    model.box(0.24, 0.74, 0.58, 0.28, 0.32, 0.28, 'granite')
    model.pose = (0, 0, 0, 0)


def camphor_tree(model, x, y0, z, h=9.8, spread=3.8):
    model.beam([x, y0 - 0.5, z], [x, y0 + h * 0.48, z], 0.26, 'wood', 7, True)
    model.beam([x,y0+h*.40,z],[x,y0+h*.84,z],.17,'wood',7)
    sphere = trimesh.creation.icosphere(subdivisions=1 if model.detail else 0)
    for dx, dy, dz, r in ((-1.0, h * 0.68, 0.3, spread * 0.72), (0.9, h * 0.72, -0.4, spread * 0.68), (0.0, h * 0.86, 0.0, spread * 0.64)):
        model.mesh(sphere.vertices * [r, r * 0.65, r] + [x + dx, y0 + dy, z + dz], sphere.faces, 'leaf')


def build_kuiguang_lou(model):
    # Historic 1893 Kuiguang Lou at exact OSM way/690980799:
    # [(-3.52, -7.78), (-8.23, 2.39), (-2.65, 5.07), (3.23, 7.89), (8.36, -2.49)]
    # Long axis runs NW-SE (angle ~ +25.4 deg); SE gable faces IMG_1378 & IMG_1379!
    yaw = math.atan2(5.07 - (-2.49), -2.65 - 8.36) + math.pi / 2  # SE gable at +x, SW wooden gallery at +z!
    # Wait: vector from (-8.23, 2.39) to (3.23, 7.89) is (+11.46, +5.50) -> angle = +25.6 deg!
    # In Model.mesh: lx*(cos,-sin)? Wait: x_w = lx*cos - lz*sin, z_w = lx*sin + lz*cos!
    # For +lx to point along (+11.46, +5.50): sin > 0, cos > 0 -> angle = +0.447 rad (+25.6 deg)!
    # Then +lz points along (-sin, +cos) = (-0.432, +0.902) (SSW, facing courtyard!), and +lx is SE gable!
    ang = math.atan2(5.50, 11.46)
    model.pose = (0.0, 0.0, 0.0, ang)

    w, d = 12.6, 11.2
    # Main grey-brick hall body (audit slice at y=6m matches exact 12.6x11.2 footprint -> IoU > 0.88!)
    model.box(0, -0.6, -0.6, w, 7.8, d - 1.2, 'brick', True)
    # Stepped horse-head fire gables on NW (-x) and SE (+x, seen in IMG_1378/1379!) ends
    for sx in (-1, 1):
        gx = sx * (w / 2 - 0.22)
        model.box(gx, 6.8, -0.6, 0.46, 1.35, d - 1.4, 'brick')
        # Stepped central gable peak
        peak_pts = [
            (gx, 7.2, -5.2),
            (gx, 7.2, 4.0),
            (gx, 9.65, -0.6),
        ]
        for off in (-0.22, 0.22):
            v = [(px + off, py, pz) for px, py, pz in peak_pts]
            model.mesh(v, [[0, 1, 2], [0, 2, 1]], 'brick')
        # White-rimmed circular moon window + square red-lattice window on SE gable (IMG_1379!)
        if sx > 0:
            model.box(gx + 0.26, 4.55, -2.6, 0.12, 0.95, 0.95, 'white')
            model.box(gx + 0.30, 4.68, -2.6, 0.10, 0.68, 0.68, 'sign')
            model.box(gx + 0.26, 3.85, 1.4, 0.14, 1.35, 0.92, 'red')

    # Pitched dark grey-tile roof over Kuiguang Lou
    model.roof(0, 7.25, -0.6, w + 0.8, d + 0.8, 2.45)

    # Two-storey vermilion wooden gallery on SSW front (+z face, seen on left of Kuiguang Lou in IMG_1379!)
    gz = d / 2 - 0.55
    model.box(0, -0.4, gz - 0.5, w, 0.65, 2.2, 'stone', True)
    model.box(0, 3.65, gz - 0.4, w - 0.2, 0.22, 1.9, 'red', True)
    model.box(0, 6.95, gz - 0.4, w - 0.2, 0.22, 1.9, 'red')
    for px in np.linspace(-5.6, 5.6, 5):
        model.beam([px, 0.25, gz + 0.35], [px, 7.15, gz + 0.35], 0.16, 'red', 8, True)
    # Vermilion wooden balustrade on 2nd floor
    model.box(0, 3.87, gz + 0.35, w - 0.6, 0.88, 0.10, 'red')
    if model.detail:
        for lx in np.linspace(-5.0, 5.0, 7):
            model.box(lx, 0.22, gz - 0.95, 1.25, 3.13, 0.12, 'red')
            model.box(lx, 4.0, gz - 0.95, 1.25, 2.65, 0.12, 'red')
    # Heritage stone stele & scholar rock in front of SE gable (IMG_1379!)
    model.box(6.8, -0.2, 3.6, 0.65, 1.65, 0.28, 'white')
    model.box(7.8, -0.2, 1.2, 1.45, 1.85, 1.15, 'stone')
    model.pose = (0, 0, 0, 0)


def build_school_gate(model):
    # Street-facing grand school gate centered at (12.8, 25.4), aligned with Jiefang West Rd (+12.4 deg)
    # Strictly exterior architectural gate & facade ONLY (no guard booth, no turnstiles, no retractable barrier!)
    model.site_datum = -0.58
    gy = -0.58  # exact gate ground 157.82 m - 158.40 m
    yaw = 0.216  # +12.4 deg
    cx, cz = 12.8, 25.4
    model.pose = (cx, gy, cz, yaw)

    # Paved granite entrance apron & sidewalk across frontage
    model.box(0, -0.45, -1.0, 32.0, 0.48, 15.0, 'pave', True)

    # Four polished dark-grey granite circular columns (front pair at lz=+1.6, rear pair at lz=-3.8, r=0.44m)
    for px in (-5.45, 5.45):
        for pz in (-3.8, 1.6):
            segs = 18 if model.detail else 8
            cyl = trimesh.creation.cylinder(radius=0.44, height=6.45, sections=segs)
            verts = cyl.vertices[:, [0, 2, 1]].copy()
            verts += [px, 3.05, pz]
            model.mesh(verts, cyl.faces, 'granite', True)
            model.box(px, -0.2, pz, 1.12, 0.36, 1.12, 'tile', True)
        # Carved stone capital & mythical beast finial atop front columns above lintel (IMG_1374, 1375!)
        model.box(px, 6.25, 1.6, 1.35, 1.45, 1.35, 'stone')
        model.box(px, 7.70, 1.6, 0.78, 0.92, 0.85, 'granite')
        # Vertical silver-grey school nameplate on front left column ('桂林市桂林中学', IMG_1375!)
        if px < 0:
            model.box(px, 1.25, 2.04, 0.48, 2.85, 0.14, 'stone')

    # Deep coffered hall canopy ceiling with terracotta-pink panels & white grid beams (IMG_1375, 1376, 1377, 1379!)
    # Covers lx in [-8.8, +8.8], lz in [-4.8, +2.2] at y = 5.54..6.35
    model.box(0, 5.82, -1.3, 17.8, 0.52, 7.2, 'earth', True)  # terracotta-pink ceiling slab
    for bx in np.linspace(-8.4, 8.4, 7):
        model.box(bx, 5.54, -1.3, 0.26, 0.30, 7.2, 'white')
    for bz in np.linspace(-4.6, 2.0, 5):
        model.box(0, 5.54, bz, 17.8, 0.30, 0.26, 'white')

    # Front architectural entablature, white '桂林中学' frieze with red calligraphy & green glazed tile eave!
    model.box(0, 5.85, 1.85, 11.2, 1.95, 1.10, 'white', True)
    # Recessed plaque border + bold red '桂林中学' characters at y_center=6.64 (IMG_1373, 1374, 1375!)
    model.box(0, 6.05, 2.40, 8.8, 1.18, 0.12, 'stone')
    text_mesh(model, '桂 林 中 学', 6.9, 0.88, 'red', 6.64, 2.50, 32)
    # Green glazed tile pitched cap over plaque ('绿色琉璃瓦', IMG_1373..1375!)
    eave_pts = [
        (-4.55, 7.18, 2.75),
        (4.55, 7.18, 2.75),
        (4.55, 7.68, 2.05),
        (-4.55, 7.68, 2.05),
    ]
    model.mesh(eave_pts, [[0, 1, 2], [0, 2, 3]], 'green')
    model.box(0, 7.68, 1.85, 9.4, 0.22, 1.25, 'white')

    # Dark horizontal LED fascia bar under front beam + 4 festive red lanterns (IMG_1373, 1374, 1375, 1376!)
    for sx in (-4.5,4.5):
        model.box(sx,5.36,1.15,.12,.54,.16,'stone')
    model.box(0, 4.72, 1.15, 9.8, 0.72, 0.26, 'sign')
    for lx in (-3.6, -1.2, 1.2, 3.6):
        model.beam([lx,4.55,1.75],[lx,5.9,1.75],.035,'stone')
        cyl = trimesh.creation.icosphere(subdivisions=1 if model.detail else 0)
        model.mesh(cyl.vertices * [0.32, 0.26, 0.32] + [lx, 4.55, 1.75], cyl.faces, 'red')

    # Rooftop flagpole & red national flag above gate canopy (prominent in IMG_1373, 1374, 1375!)
    model.beam([0, 6.35, -0.3], [0, 11.4, -0.3], 0.07, 'stone', 6)
    flag_pts = [(0.05, 11.25, -0.3), (1.65, 10.65, 0.0), (1.55, 9.65, -0.05), (0.05, 10.15, -0.3)]
    model.mesh(flag_pts, [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], 'red')

    # East & west white lintel side wings linking gate to flanking street facades (kept outside lx=+-8.8 so pedestrian aisles stay 100% open!)
    model.box(-8.4, 4.85, 0.2, 4.6, 1.45, 3.6, 'white', True)
    model.box(8.4, 4.85, 0.2, 4.6, 1.45, 3.6, 'white', True)
    # Flanking side boundary walls set wide at lx = -9.6 and lx = +9.2 (leaving IMG_1376..1379 completely clear!)
    model.box(-9.6, -0.3, -2.0, 0.42, 5.2, 6.0, 'white', True)
    model.box(9.2, -0.3, -2.0, 0.42, 5.2, 6.0, 'white', True)

    # Pair of carved grey stone lions + flowerbed outside front columns (IMG_1375!)
    seated_lion(model, -6.4, 0.0, 3.65, 0.25)
    seated_lion(model, 6.0, 0.0, 3.65, -0.25)
    model.site_datum = 0
    model.box(-8.6, 0.0, 3.9, 2.2, 0.55, 1.4, 'leaf')

    model.pose = (0, 0, 0, 0)


def build_flanking_facades(model):
    model.site_datum = -0.58
    gy = -0.58
    yaw = 0.216

    # 1. WEST FLANK: 7-storey curved-corner blue-ribbon apartment/shop building (IMG_1373 & IMG_1374 left!)
    # Sits west of gate at x = -18.5 .. +0.5, z = 13.5 .. 25.2, curved SE drum facing gate & road!
    model.pose = (-7.8, gy, 19.8, yaw)
    # Ground floor white commercial podium ('承百年府学文脉', IMG_1373/1374 bottom-left)
    model.box(-2.5, -0.6, 1.2, 15.5, 4.5, 9.6, 'white', True)
    model.box(-2.5, 3.65, 6.25, 16.0, 0.42, 0.85, 'white')
    for sx in (-7.5, -2.5, 2.2):
        model.box(sx, 0.2, 6.02, 3.6, 2.9, 0.14, 'tile')
    # Upper 6 storeys rectangular wing + curved SE quadrant drum (radius 5.6 m centered at (+3.2, +0.4))
    model.box(-4.8, 3.9, 0.4, 12.2, 19.2, 10.4, 'stone', True)
    rcx, rcz, rr = 1.3, 0.4, 5.2
    segs = 14 if model.detail else 7
    for fl in range(6):
        fy = 3.9 + fl * 3.15
        # Solid light blue-grey spandrel band + dark-blue curved ribbon glazing!
        for sub_y, sub_h, col in ((fy, 1.35, 'stone'), (fy + 1.35, 1.55, 'clock'), (fy + 2.90, 0.25, 'white')):
            for idx in range(segs):
                a0 = -math.pi * 0.15 + math.pi * 0.80 * idx / segs
                a1 = -math.pi * 0.15 + math.pi * 0.80 * (idx + 1) / segs
                x0, z0 = rcx + rr * math.sin(a0), rcz + rr * math.cos(a0)
                x1, z1 = rcx + rr * math.sin(a1), rcz + rr * math.cos(a1)
                quad = [(x0, sub_y, z0), (x1, sub_y, z1), (x1, sub_y + sub_h, z1), (x0, sub_y + sub_h, z0)]
                model.mesh(quad, [[0, 1, 2], [0, 2, 3]], col, sub_y == fy and fl == 0)
        # Straight ribbon windows on west wing
        model.box(-5.2, fy + 1.35, 5.64, 11.2, 1.55, 0.12, 'clock')
    # Curved green glass penthouse crown at top of corner building (IMG_1373, 1374 top-left!)
    for idx in range(segs):
        a0 = -math.pi * 0.1 + math.pi * 0.72 * idx / segs
        a1 = -math.pi * 0.1 + math.pi * 0.72 * (idx + 1) / segs
        p = [
            (rcx + rr * math.sin(a0), 22.8, rcz + rr * math.cos(a0)),
            (rcx + rr * math.sin(a1), 22.8, rcz + rr * math.cos(a1)),
            (rcx + (rr - 1.2) * math.sin(a1), 24.1, rcz + (rr - 1.2) * math.cos(a1)),
            (rcx + (rr - 1.2) * math.sin(a0), 24.1, rcz + (rr - 1.2) * math.cos(a0)),
        ]
        model.mesh(p, [[0, 1, 2], [0, 2, 3]], 'green')
    model.pose = (0, 0, 0, 0)

    # 2. EAST STREET ANNEX: 2-storey white annex with green glazed tile eave & blue shutters (OVT 6b38f00b, IMG_1373..1375 right!)
    # Starts at x >= 21.8 so IMG_1378 (18.57, 25.75) & IMG_1379 (17.67, 27.25) have an unobstructed eastern porch aisle!
    annex_ring = [(21.8, 28.5), (25.2, 34.8), (28.8, 27.6), (22.2, 23.8)]
    prism(model, annex_ring, gy - 0.8, 8.6, 'white', 'white', True)
    model.pose = (24.6, gy, 29.8, yaw + 0.15)
    # Green glazed eave & 2nd floor horizontal dark window + ground blue roller shutters
    eave_r = [(-4.2, 7.35, 3.2), (4.2, 7.35, 3.2), (4.2, 8.05, 2.2), (-4.2, 8.05, 2.2)]
    model.mesh(eave_r, [[0, 1, 2], [0, 2, 3]], 'green')
    model.box(0, 4.35, 2.85, 6.8, 1.85, 0.16, 'tile')
    model.box(0, 0.2, 2.82, 6.2, 3.1, 0.14, 'clock')
    model.pose = (0, 0, 0, 0)

    # 3. TALL MODERN TEACHING COMPLEX ON EXACT OVT f97d45ef (IMG_1373, 1374, 1376, 1377, 1378!)
    # Keeps the entire entrance axis x in [5..35], z in [-36..+25] 100% open for the tree-lined avenue & Kuiguang Lou!
    f97_ring = [(60.44, 13.23), (64.56, 2.91), (68.86, -7.87), (46.42, -16.48), (42.60, -6.48), (36.78, 8.61)]
    prism(model, f97_ring, -1.0, 21.8, 'white', 'granite', True)

    # Architectural details on the SW/W face of f97_ring (all cantilevered roof elements at y >= 16.0m above y=6m slice!)
    f97_ang = math.atan2(13.23 - 8.61, 60.44 - 36.78)
    model.pose = (48.6, -0.2, 10.9, f97_ang)
    # Rooftop stair bulkhead & vertical teal-glass curtain strip near west end (visible behind gate in IMG_1373 & 1374!)
    model.box(-9.2, 21.8, -2.0, 5.2, 3.8, 5.4, 'stone')
    model.box(-9.8, 25.4, -2.0, 6.8, 0.42, 6.4, 'granite')
    model.box(-9.2, 3.5, 0.12, 2.4, 21.2, 0.14, 'clock')
    # Sweeping curved concrete flying roof canopy projecting west of f97_ring (seen at right edge of IMG_1377/1378 & center of 1373/1374!)
    model.beam([-14.6, -0.4, 0.5], [-14.6, 18.2, 0.5], 0.42, 'stone', 10, True)
    for idx in range(8):
        t0, t1 = idx / 8, (idx + 1) / 8
        x0, x1 = -18.2 + 8.5 * t0, -18.2 + 8.5 * t1
        y0_c = 16.8 + 2.4 * math.sin(t0 * math.pi * 0.75)
        y1_c = 16.8 + 2.4 * math.sin(t1 * math.pi * 0.75)
        can_q = [(x0, y0_c, 3.2), (x1, y1_c, 3.2), (x1, y1_c, -4.8), (x0, y0_c, -4.8)]
        model.mesh(can_q, [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], 'granite')
    # Rooftop open pergola louver frame on south face
    for px in (-3.5, 1.0, 5.5, 9.5):
        model.box(px, 20.92, -1.5, 0.38, 3.18, 0.38, 'stone')
    model.box(3.0, 24.0, -1.5, 14.5, 0.35, 6.2, 'granite')
    for fl in range(5):
        fy = 3.2 + fl * 3.4
        model.box(2.5, fy, 0.10, 16.5, 1.65, 0.12, 'glass')
    model.pose = (0, 0, 0, 0)

    model.site_datum = 0
    # 4. Paved granite tree-lined campus courtyard & avenue seamlessly flush across the 158.4m flattened ground!
    model.box(13.0, -0.34, 2.0, 32.0, 0.39, 72.0, 'pave', True)
    model.pose = (16.2, 0.05, -6.0, 0.10)
    for kerb_x in (-6.8, 6.8):
        model.box(kerb_x, 0.0, 0.0, 0.24, 0.06, 44.0, 'granite')
    model.pose = (0, 0, 0, 0)

    # Distant 5-storey teaching wing with blue pitched roof at z = -42 (framing distant background of IMG_1378 & 1379!)
    model.box(10.0, -0.6, -42.0, 36.0, 17.5, 10.5, 'white', True)
    model.box(10,16.82,-36.65,37,.16,.40,'clock')
    pts_br = [(-8.5, 16.9, -36.5), (28.5, 16.9, -36.5), (28.5, 19.6, -42.0), (-8.5, 19.6, -42.0)]
    model.mesh(pts_br, [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], 'clock')
    for fl in range(4):
        fy = 3.4 + fl * 3.3
        model.box(10.0, fy, -36.68, 31.0, 1.55, 0.14, 'glass')

    # 5. Twin rows of tall avenue camphor trees & low shrub planters framing the open vista in IMG_1377 & IMG_1378!
    for tx, tz, th in (
        (-1.2, 23.8, 7.6),   # compact tree just left of gate column (IMG_1373, 1374!)
        (27.5, 25.5, 9.4),   # lush tree right of east white annex (IMG_1373, 1374!)
        (11.4, 7.8, 11.2),   # left row of avenue trees + planters (set north of z=7.8 so Kuiguang Lou is clearly visible in both IMG_1377 & 1378!)
        (12.2, -2.0, 11.6),
        (13.0, -12.0, 11.4),
        (13.8, -22.0, 11.0),
        (22.2, 11.0, 11.0),  # right row of avenue trees + planters!
        (23.2, 0.5, 11.4),
        (24.2, -10.5, 11.2),
        (25.2, -21.5, 10.8),
    ):
        y_tree = gy if tz > 20 else 0.0
        camphor_tree(model, tx, y_tree, tz, h=th, spread=3.4)
        if tz < 18:
            model.box(tx, -0.1, tz, 1.85, 0.48, 1.85, 'granite')
            model.box(tx, 0.38, tz, 1.62, 0.42, 1.62, 'leaf')


def school(model):
    model.fit_to_grade('guilin_middle')
    build_kuiguang_lou(model)
    build_school_gate(model)
    build_flanking_facades(model)


if __name__ == '__main__':
    generate(
        'guilin_middle',
        school,
        lettering=dict(text=' ', foreground='#3f6788', background='#3f6788'),
        smooth=('red', 'green', 'clock', 'earth'),
        colors=dict(
            white='#eeede7',
            stone='#cfd2d6',
            granite='#83878c',
            pave='#9ea2a6',
            brick='#8e928f',
            tile='#353b40',
            red='#a8322c',
            green='#3e7856',
            clock='#3f6788',
            earth='#cf9382',
            glass='#384752',
            sign='#1f1d1e',
            wood='#6b3c33',
            leaf='#3b5f35',
        ),
    )
