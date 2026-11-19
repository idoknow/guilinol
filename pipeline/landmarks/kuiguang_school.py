"""Guilin Kuiguang School (桂林市奎光学校), anchored at OSM way/701820464 centroid (-1302.50, -167.63).
Covers IMG_1295..1298: coral-pink street-front residential/commercial block with through-building
gateway portal ('桂林市奎光学校') on Rongyin Rd, flanking green-fascia & blue-shutter storefronts,
low red-brick notice-wall wing replacing 4-storey procedural block on way/683033677, avenue tree
corridor, and 5-storey white '博学楼' with blue zigzag parapet at exact OSM way/683033673.
Strictly follows K-12 rule: exterior gate & facades only, no guard booth, no turnstiles.
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
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
        '/System/Library/Fonts/STHeiti Medium.ttc',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
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
    w_px = max(96, round(width * 34))
    h_px = max(28, round(height * 34))
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


def camphor_tree(model, x, y0, z, h=11.0, spread=4.4):
    model.beam([x, y0 - 0.5, z], [x, y0 + h * 0.44, z], 0.28, 'wood', 7, True)
    sphere = trimesh.creation.icosphere(subdivisions=1 if model.detail else 0)
    for dx, dy, dz, r in (
        (-1.2, h * 0.64, 0.5, spread * 0.78),
        (1.1, h * 0.68, -0.5, spread * 0.74),
        (0.0, h * 0.84, 0.0, spread * 0.70),
    ):
        model.mesh(sphere.vertices * [r, r * 0.68, r] + [x + dx, y0 + dy, z + dz], sphere.faces, 'leaf')


def school(model):
    # =========================================================================
    # 1. AUDITED STREET-FRONT SOUTH WING (exact OSM way/701820464, y=0..16.5m)
    # =========================================================================
    w7018_ring = [(-1.20, -17.21), (-14.60, 13.82), (-0.46, 19.86), (14.84, -15.57), (6.17, -19.27), (4.27, -14.88)]
    prism(model, w7018_ring, -1.2, 17.4, 'earth', 'granite', True)

    # =========================================================================
    # 2. THROUGH-BUILDING SCHOOL GATE PORTAL & CORAL-PINK FRONTAGE ON RONGYIN RD
    # Follows campus east entrance mouth of way/253811717: (-5.81, 21.44) .. (-14.90, 44.03)
    # Street normal faces ESE (~113.5 deg): in Model.mesh, +lz points ESE when angle = +1.98 rad!
    # Wait: check Model.mesh! x_w = lx*cos(a) - lz*sin(a), z_w = lx*sin(a) + lz*cos(a)!
    # We want +lz to point ESE (+0.917, +0.399): -sin(a) = +0.917 -> sin(a) = -0.917, cos(a) = +0.399 -> a = -1.161 rad (-66.5 deg)!
    # Then +lx points along (+0.399, -0.917) = NNE along Rongyin Rd (viewer's RIGHT when facing gate from street)!
    # Let's double-check! Facing gate (looking WNW, -lz): viewer's RIGHT is +lx (NNE, blue shutters!), viewer's LEFT is -lx (SSW, green shop!)!
    # YES!! 100% exact right-hand rule!
    # =========================================================================
    gate_yaw = math.atan2(-0.917, 0.399)  # -66.5 deg
    gcx, gcz = -9.6, 31.2
    model.pose = (gcx, 0.0, gcz, gate_yaw)

    # Keep a 12 cm gap from w7018_ring at y=6m (lx >= -10.2 begins north of w7018's z=19.86 edge!)
    # Upper coral-pink residential storeys spanning over the portal (lx in [-10.0, +13.5], y = 5.2..16.6, d = 11.6)
    model.box(1.75, 5.25, 0.0, 23.5, 11.35, 11.6, 'earth', True)
    # Left & right ground-floor commercial wings flanking the 7.4 m wide through-portal!
    # Left wing (SSW, -lx): green corrugated shop fascia ('奎光店 2858018', IMG_1295 left!)
    model.box(-6.85, -0.8, 0.0, 6.3, 6.05, 11.6, 'stone', True)
    model.box(-6.85, 3.15, 5.92, 6.3, 1.55, 0.24, 'green')
    model.box(-6.85, 0.35, 5.84, 5.4, 2.65, 0.14, 'glass')
    # Right wing (NNE, +lx): blue roller-shutter shop bays (IMG_1295 right; shallow z>=1.8 keeps (-0.5, 22.33) clear!)
    model.box(8.60, -0.8, 3.6, 9.8, 6.05, 4.5, 'white', True)
    for rx in (6.1, 10.9):
        model.box(rx, 0.15, 5.88, 3.9, 3.35, 0.14, 'clock')

    # Prominent white/grey stone portal frame around the through-building passage (IMG_1295 center!)
    # Clear opening: lx in [-3.7, +3.7], height y = 0.05..4.15, full 11.6 m depth through building!
    for px in (-4.1, 4.1):
        model.box(px, -0.4, 5.85, 0.85, 5.85, 0.75, 'white', True)
        # Vertical bronze/dark plaque on gate piers ('桂林市第一中学榕荫校区' / '桂林市奎光学校')
        model.box(px, 0.95, 6.26, 0.44, 2.85, 0.06, 'sign')
    # Portal signboard header with orange-red '桂林市奎光学校' 3D characters
    model.box(0.0, 4.15, 5.88, 9.05, 1.35, 0.78, 'white', True)
    model.box(0.0, 5.42, 5.95, 9.25, 0.16, 0.92, 'granite')
    text_mesh(model, '桂林市奎光学校', 6.9, 0.85, 'red', 4.82, 6.32, 30)

    # Coffered pale-grey flat ceiling & glazed display walls inside the 11.6 m portal tunnel (IMG_1296!)
    model.box(0.0, 4.02, 0.0, 7.6, 0.22, 11.8, 'white')
    for beam_z in (-4.2, -1.4, 1.4, 4.2):
        model.box(0.0, 3.88, beam_z, 7.6, 0.16, 0.26, 'stone')
    # Dark bluestone slab floor extending through tunnel & out to Rongyin Rd kerb
    model.box(1.5, -0.42, 2.2, 24.5, 0.46, 17.5, 'pave', True)
    # Glazed showcase walls lining left & right tunnel interior + open iron gate leaves (IMG_1296!)
    for sx in (-3.68, 3.68):
        model.box(sx, 0.25, -0.5, 0.14, 3.35, 9.2, 'glass', True)
        if model.detail:
            for gz in np.linspace(-4.6, 3.6, 6):
                model.box(sx, 0.0, gz, 0.18, 3.65, 0.10, 'tile')
    # Two red lanterns hanging under the front portal soffit + yellow/black road barriers (IMG_1295!)
    for lx in (-2.05, 2.05):
        sph = trimesh.creation.icosphere(subdivisions=1 if model.detail else 0)
        model.mesh(sph.vertices * [0.42, 0.30, 0.42] + [lx, 3.62, 4.85], sph.faces, 'red')
        # Small stone guardian lions inside piers
        model.box(lx * 1.62, 0.0, 5.45, 0.45, 1.15, 0.55, 'gold')
    for bx in (-2.5, 2.5):
        model.box(bx, 0.05, 6.85, 2.8, 0.82, 0.16, 'yellow')

    # Upper coral-pink apartment windows + white frames + AC units (IMG_1295 top!)
    for fl in range(3):
        fy = 6.05 + fl * 3.35
        for wx in (-7.2, -2.6, 2.2, 7.2, 11.2):
            model.box(wx, fy, 5.84, 2.85, 1.85, 0.16, 'white')
            model.box(wx, fy + 0.15, 5.92, 2.35, 1.45, 0.08, 'glass')
            if model.detail and wx in (-2.6, 2.2):
                model.box(wx + 1.85, fy + 0.2, 6.05, 0.72, 0.52, 0.38, 'white')

    # Yellow no-stopping crisscross box markings painted on Rongyin Rd asphalt in front of gate (IMG_1295 bottom!)
    for yz in (9.6, 13.2):
        model.box(0.0, -0.02, yz, 14.0, 0.04, 0.18, 'yellow')
    for diag in range(-5, 6, 3):
        for sgn in (-1, 1):
            p = [
                (diag - sgn * 1.8, 0.02, 9.6),
                (diag - sgn * 1.62, 0.02, 9.6),
                (diag + sgn * 1.8, 0.02, 13.2),
                (diag + sgn * 1.62, 0.02, 13.2),
            ]
            model.mesh(p, [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], 'yellow')
    model.pose = (0, 0, 0, 0)

    # =========================================================================
    # 3. CAMPUS AVENUE LOW RED-BRICK NOTICE WALLS & TREE CORRIDOR (IMG_1297, 1298!)
    # Replaces 4-storey yellow procedural block on way/683033677 with true 1-storey red-brick wing!
    # Angle -1.147 rad aligns -lz directly along WNW sightline (-0.912, -0.410) toward Boxue Lou!
    # =========================================================================
    cy = 0.30
    model.pose = (-28.7, cy, 6.73, -1.147)
    model.box(0, -0.35, -26.0, 12.6, 0.38, 62.0, 'pave', True)
    # Right-hand (+lx) low red-brick pitched-eave ceremonial wall wing (IMG_1297 right foreground, clear of 1298!)
    model.box(6.4, -0.3, -10.5, 3.2, 3.45, 15.0, 'brick', True)
    model.box(6.0, 3.05, -10.5, 4.2, 0.24, 15.6, 'earth')
    # Left-hand (-lx) low red-brick propaganda notice room (IMG_1297 left foreground!)
    model.box(-6.6, -0.3, -14.0, 3.0, 3.15, 22.0, 'brick', True)
    model.box(-5.05, 0.9, -14.0, 0.10, 1.35, 12.0, 'red')
    # Trimmed green hedge strip along right side of avenue & court (IMG_1297, 1298 bottom-right!)
    model.box(5.2, 0.0, -34.0, 1.5, 0.85, 38.0, 'green')
    # Festive overhead triangular bunting flags across campus court (IMG_1297, 1298!)
    for fz in (-16.0, -28.0):
        for fx in np.linspace(-5.2, 5.2, 11):
            col = ('red', 'yellow', 'clock', 'green')[int(abs(fx * 3)) % 4]
            pts = [(fx - 0.22, 3.85, fz), (fx + 0.22, 3.85, fz), (fx, 3.45, fz)]
            model.mesh(pts, [[0, 1, 2], [0, 2, 1]], col)
    model.pose = (0, 0, 0, 0)

    # Dense avenue & court-flanking tall camphor trees framing the sightline to Boxue Lou (IMG_1297, 1298!)
    for tx, tz, th, tsp in (
        (-5.5, 36.5, 9.5, 4.2),   # street tree right of gate (IMG_1295!)
        (-13.5, 22.0, 9.2, 3.8),  # street tree left of gate (IMG_1295!)
        (-28.0, -2.5, 11.5, 4.8), # tall right-hand tree row along way/683033677 (IMG_1297, 1298 right!)
        (-42.0, -8.5, 13.5, 5.2),
        (-58.0, -14.5, 14.2, 5.4),
        (-76.0, -20.0, 13.0, 5.0),
        (-95.0, -25.0, 12.5, 4.8),
        (-46.0, 14.0, 11.2, 4.6), # left-hand tree row (IMG_1297, 1298 left!)
        (-68.0, 8.0, 11.8, 4.8),
        (-125.0, -22.0, 11.0, 4.6),
    ):
        camphor_tree(model, tx, cy if tx < -18 else 0.0, tz, h=th, spread=tsp)

    # =========================================================================
    # 4. AUDITED 5-STOREY WHITE '博学楼' AT EXACT OSM way/683033673 (IMG_1297, 1298 focal point!)
    # Exact coords: [(-168.34, -28.89), (-157.16, -53.72), (-146.29, -48.89), (-157.48, -24.06)]
    # =========================================================================
    boxue_ring = [(-168.34, -28.89), (-157.16, -53.72), (-146.29, -48.89), (-157.48, -24.06)]
    prism(model, boxue_ring, cy - 1.2, 18.4, 'white', 'white', True)
    # East front facade of Boxue Lou faces ESE toward IMG_1297 & 1298!
    bx_cx, bx_cz = -157.32, -38.89
    bx_yaw = math.atan2(-24.83, 11.18) + math.pi / 2  # +lz faces ESE toward court!
    # Check: vector along front edge from (-157.48, -24.06) to (-146.29, -48.89) is (+11.19, -24.83) -> angle = -65.7 deg!
    # When angle = -1.147 rad (-65.7 deg), +lx is NNE along front, +lz is ESE (+0.911, +0.411) facing camera 1298!
    model.pose = (bx_cx, cy, bx_cz, -1.147)
    # 5-storey open white corridor balconies + blue-trimmed sawtooth gable roof parapet (IMG_1298!)
    for fl in range(5):
        fy = 0.2 + fl * 3.35
        if fl > 0:
            model.box(0, fy, 6.02, 26.8, 0.98, 0.22, 'white')
            model.box(0, fy + 0.98, 6.06, 26.8, 0.12, 0.26, 'clock')
        for col_x in np.linspace(-11.5, 11.5, 7):
            model.box(col_x, fy, 5.95, 0.42, 3.35, 0.35, 'white')
            model.box(col_x, fy + 1.1, 5.65, 2.8, 1.55, 0.12, 'glass')
    # Sawtooth blue-edged roof parapet peaks + rounded left stairwell bay (IMG_1298!)
    for gable_x in (-8.5, -2.8, 2.8, 8.5):
        gp = [
            (gable_x - 2.8, 17.0, 6.12),
            (gable_x + 2.8, 17.0, 6.12),
            (gable_x, 18.05, 6.12),
        ]
        model.mesh(gp, [[0, 1, 2], [0, 2, 1]], 'white')
        model.beam([gable_x - 2.8, 17.02, 6.16], [gable_x, 18.08, 6.16], 0.09, 'clock', 5)
        model.beam([gable_x, 18.08, 6.16], [gable_x + 2.8, 17.02, 6.16], 0.09, 'clock', 5)
    # Central dark LED display board & ground-floor red festive backdrop banner (IMG_1298!)
    model.box(0.0, 5.8, 6.18, 6.4, 3.1, 0.16, 'sign')
    model.box(0.0, 5.65, 6.14, 6.8, 3.4, 0.10, 'white')
    model.box(0.0, 0.25, 6.12, 6.8, 2.85, 0.12, 'red')
    model.pose = (0, 0, 0, 0)


if __name__ == '__main__':
    generate(
        'kuiguang_school',
        school,
        lettering=dict(text=' ', foreground='#1e4d8c', background='#1e4d8c'),
        smooth=('red', 'clock', 'green', 'yellow'),
        colors=dict(
            earth='#d4998f',
            white='#eeede7',
            stone='#cfd1cd',
            granite='#8b8f92',
            pave='#6e7378',
            brick='#9e4d3c',
            red='#c63d32',
            clock='#1e4d8c',
            green='#4c6a58',
            yellow='#dfb648',
            gold='#c99e67',
            glass='#36454f',
            sign='#232021',
            tile='#30353a',
            wood='#5b3e31',
            leaf='#375931',
        ),
    )
