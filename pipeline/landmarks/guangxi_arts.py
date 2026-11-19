"""Guangxi Provincial Arts Hall (廣西省立藝術館, OSM way/682942533) & West Jiefang Rd streetscape.
Covers IMG_1366 (twin ochre-brown residential blocks with sky gap) and IMG_1367..1372 (red-brick
arts complex: west 2-storey annex on OVT 52bfca62, openwork brick courtyard wall, main auditorium
long pilaster relief facade for IMG_1369, curved '廣西省立藝術館' portico, east courtyard stone
doorway, concentric brick medallion forecourt, and east alley wing on OVT 58576415).
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
    # Tall white art-deco pilaster frame with dark lattice window below & white figurative relief panel above!
    model.pose = (x, y0, z, yaw)
    model.box(0, 0.35, 0.08, bay_w, h, 0.22, 'white')
    model.box(0, 0.85, 0.16, bay_w - 0.56, 3.35, 0.14, 'glass')
    # Upper white sculpted relief niche (IMG_1369 & IMG_1370!)
    model.box(0, 4.45, 0.16, bay_w - 0.62, 2.55, 0.14, 'stone')
    if model.detail:
        model.box(0, 4.75, 0.24, 0.58, 1.85, 0.12, 'white')
        model.box(0, 0.85, 0.23, 0.08, 3.35, 0.06, 'wood')
        for ry in (1.9, 3.0):
            model.box(0, ry, 0.23, bay_w - 0.56, 0.08, 0.06, 'wood')
    # Street planter box at foot of bay
    model.box(0, 0.0, 0.48, bay_w - 0.35, 0.42, 0.52, 'granite')
    model.box(0, 0.42, 0.48, bay_w - 0.48, 0.28, 0.40, 'leaf')
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


def camphor_tree(model, x, y0, z, h=9.2, spread=3.8):
    model.beam([x, y0 - 0.5, z], [x, y0 + h * 0.46, z], 0.26, 'wood', 7, True)
    sphere = trimesh.creation.icosphere(subdivisions=1 if model.detail else 0)
    for dx, dy, dz, r in ((-1.1, h * 0.68, 0.4, spread * 0.72), (1.0, h * 0.72, -0.5, spread * 0.68), (0.0, h * 0.85, 0.0, spread * 0.65)):
        model.mesh(sphere.vertices * [r, r * 0.62, r] + [x + dx, y0 + dy, z + dz], sphere.faces, 'leaf')


def hall(model):
    # Ground at anchor is 157.3 m; surrounding sidewalks are +0.1..+0.5 m
    gy = 0.20

    # =========================================================================
    # 1. MAIN AUDITORIUM (OSM way/682942533: x in [-12.2, +12.2], z in [-18.5, +19.3])
    # Note: NW corner steps from (-7.9, -18.5) obliquely along west alley so IMG_1369 at
    # (-7.16, -22.40) looking 212.5 deg sees an unobstructed longitudinal pilaster facade!
    # =========================================================================
    main_ring = [
        (-7.95, -18.45),
        (5.65, -18.55),
        (12.16, -15.20),
        (12.20, 19.30),
        (-12.15, 19.40),
        (-12.18, -13.60),
    ]
    prism(model, main_ring, -1.4, 10.6, 'brick', 'red', True)
    # Pitched hipped terracotta-red tile roof over main auditorium
    model.roof(0.0, gy + 9.0, 0.5, 24.8, 38.2, 2.8)
    # Clerestory monitor stage tower with 3 small white-framed square windows (IMG_1370, 1371)
    model.box(1.2, gy + 8.6, -9.5, 13.6, 3.2, 12.5, 'brick', True)
    model.roof(1.2, gy + 11.8, -9.5, 14.4, 13.3, 1.6)
    for sx in (-3.2, -1.6, 0.0):
        model.box(sx, gy + 9.8, -15.82, 0.85, 0.85, 0.14, 'white')
    for sz in (-13.8, -12.0, -10.2):
        model.box(8.05, gy + 9.8, sz, 0.14, 0.85, 0.85, 'white')

    # West longitudinal facade seen directly in IMG_1369:
    # Corner edge at (-7.95, -18.45): right return (-7.95, -18.45)->(-12.18, -13.60) has small ornate white frames;
    # left longitudinal wall runs south along x = -7.95 .. -11.5 with 3 tall white figurative relief pilaster bays
    # and a red-brick side porch projecting at the far south end!
    west_wall = [
        (-7.95, -18.45),
        (-7.20, -18.45),
        (-7.20, 16.50),
        (-8.15, 16.50),
    ]
    prism(model, west_wall, -1.2, 10.2, 'brick', 'white', True)
    # White projecting eaves soffit along longitudinal west facade (IMG_1369 top!)
    model.box(-8.05, gy + 8.85, -1.0, 1.35, 0.30, 35.6, 'white')
    for bz in (-12.8, -7.2, -1.6):
        tall_pilaster_bay(model, -8.12, gy, bz, -math.pi / 2, bay_w=3.2, h=7.5)
    # Framed commemorative stone plaque & terracotta downspout near corner (IMG_1369 foreground!)
    model.box(-8.18, gy + 1.85, -16.4, 0.12, 1.15, 1.45, 'white')
    model.beam([-8.05, gy, -18.35], [-8.05, gy + 8.8, -18.35], 0.06, 'earth', 6)
    # Right-side corner return wall small ornate cream-framed windows (IMG_1369 right half!)
    ret_yaw = math.atan2(-4.23, 4.85) - math.pi / 2
    for step_t in (0.36, 0.74):
        rx = -7.95 + (-12.18 - (-7.95)) * step_t
        rz = -18.45 + (-13.60 - (-18.45)) * step_t
        model.pose = (rx, gy, rz, ret_yaw)
        model.box(0, 1.35, 0.10, 1.15, 1.85, 0.18, 'white')
        model.box(0, 1.85, 0.18, 0.68, 1.05, 0.10, 'glass')
        model.box(0, 6.45, 0.10, 1.05, 1.25, 0.16, 'white')
        model.pose = (0, 0, 0, 0)
    # Far-end projecting dark-red square-column side portico along west passage (IMG_1369 far left!)
    model.box(-9.45, gy + 3.45, 8.5, 2.9, 0.48, 4.8, 'red')
    for pz in (6.4, 10.6):
        model.box(-10.65, gy - 0.5, pz, 0.52, 4.0, 0.52, 'red', True)
    # Paved stone walkway & tactile strip along west passage (IMG_1369 left foreground!)
    model.box(-5.6, gy - 0.35, -3.0, 5.2, 0.38, 38.0, 'pave', True)
    model.box(-5.2, gy + 0.04, -3.0, 0.36, 0.015, 38.0, 'stone')

    # North front facade (facing Jiefang West Rd, IMG_1370 & IMG_1371 right):
    # Semi-circular '廣西省立藝術館' portico shifted slightly east (cx = +1.8, cz = -18.55) so 3 tall relief bays
    # stand to its west (right in IMG_1370) and the recessed courtyard entrance stands to its east (left in IMG_1370/1371)!
    pcx, pcz = 1.8, -18.55
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

    # Three tall white figurative relief bays on north front right of portico (IMG_1370 right!)
    for bx in (-6.4, -4.4, -2.4):
        tall_pilaster_bay(model, bx, gy, -18.52, math.pi, bay_w=1.85, h=7.4)

    # =========================================================================
    # 2. EAST COURTYARD DOORWAY, MEDALLION FORECOURT & ALLEY WING (IMG_1370, 1371, 1372!)
    # Replaces OVT 58576415: local x in [12.2, 22.8], z in [-16.5, +12.5]
    # =========================================================================
    # Recessed single-storey entrance link with cream classical doorway frame & double timber doors
    east_link = [(11.8, -15.4), (17.8, -15.4), (17.8, -6.0), (11.8, -6.0)]
    prism(model, east_link, -1.2, 5.6, 'brick', 'tile', True)
    model.roof(14.8, gy + 4.35, -10.7, 6.6, 10.0, 1.25)
    # Classical cream stone door surround + dark panelled double doors facing forecourt (-z, IMG_1371 center!)
    model.box(14.8, gy + 0.25, -15.52, 2.75, 3.65, 0.28, 'white')
    model.box(14.8, gy + 3.85, -15.60, 3.15, 0.32, 0.42, 'white')
    model.box(14.8, gy + 0.30, -15.62, 1.85, 2.95, 0.14, 'wood')
    for step in range(2):
        model.box(14.8, gy - 0.05 + step * 0.14, -16.15 + step * 0.32, 3.4, 0.16, 0.42, 'granite', True)

    # Projecting east alley red-brick wing extending alongside Rongyin Rd (IMG_1371 left, IMG_1372 right!)
    east_wing = [(15.2, -18.2), (22.2, -18.2), (22.2, 12.2), (12.5, 12.2), (12.5, -6.0), (15.2, -6.0)]
    prism(model, east_wing, -1.2, 5.9, 'brick', 'tile', True)
    model.roof(18.7, gy + 4.65, -3.0, 7.8, 31.2, 1.45)
    # Row of high square cream-framed windows on north & east alley walls (IMG_1371, IMG_1372!)
    for wx in (16.6, 18.7, 20.8):
        model.box(wx, gy + 3.15, -18.26, 0.92, 0.92, 0.14, 'white')
        model.box(wx, gy + 3.28, -18.32, 0.62, 0.62, 0.08, 'glass')
    for wz in (-15.5, -13.2, -10.9, -4.0, 2.0):
        model.box(22.26, gy + 3.15, wz, 0.14, 0.92, 0.92, 'white')
        model.box(22.32, gy + 3.28, wz, 0.08, 0.62, 0.62, 'glass')
    # Shrub planters framing courtyard entrance
    model.box(18.6, gy, -18.8, 5.2, 0.45, 0.75, 'granite')
    model.box(18.6, gy + 0.45, -18.8, 4.9, 0.65, 0.62, 'leaf')

    # Paved stone forecourt + concentric dark-grey/warm-brick medallion right in front of east doorway (IMG_1371, 1372!)
    model.box(8.5, gy - 0.35, -23.0, 32.0, 0.38, 13.5, 'pave', True)
    mcx, mcz = 12.6, -21.6
    segs = 48 if model.detail else 16
    for idx in range(segs):
        a0, a1 = math.tau * idx / segs, math.tau * (idx + 1) / segs
        pts_in = [(mcx + r * math.cos(a), gy + 0.045, mcz + r * math.sin(a)) for r, a in [(3.1, a0), (3.1, a1), (3.8, a1), (3.8, a0)]]
        model.mesh([(mcx, gy + 0.045, mcz), pts_in[0], pts_in[1]], [[0, 1, 2]], 'wood')
        model.mesh(pts_in, [[0, 1, 2], [0, 2, 3]], 'stone' if idx % 2 == 0 else 'brick')

    # =========================================================================
    # 3. WEST 2-STOREY RED-BRICK ANNEX & OPENWORK COURTYARD WALL (IMG_1367, IMG_1368!)
    # Replaces OVT 52bfca62 & e42af5e2 right along the sidewalk (local x in [-53, -15])
    # =========================================================================
    west_annex = [(-20.40, -12.52), (-51.61, -16.62), (-52.99, -6.21), (-21.78, -2.12)]
    annex_ang = math.atan2(4.10, 31.21)  # +0.1306 rad: +lx runs W->E along sidewalk, -lz faces sidewalk!
    prism(model, west_annex, -1.0, 7.9, 'brick', 'tile', True)
    # Pitched dark-grey tile roof + white projecting eaves soffit along sidewalk & east gable (IMG_1367, IMG_1368!)
    model.pose = (-36.70, gy + 0.20, -9.37, annex_ang)
    model.roof(0, 6.70, 0, 32.6, 11.6, 1.95)
    model.box(0, 6.48, 0, 32.5, 0.24, 11.5, 'white')
    # East gable 2nd-floor cream-framed lattice windows facing courtyard (IMG_1368 center!)
    for gz in (-2.3, 1.4):
        model.box(15.75, 3.65, gz, 0.20, 2.05, 1.35, 'white')
        model.box(15.84, 3.82, gz, 0.10, 1.68, 0.98, 'glass')
    model.pose = (0, 0, 0, 0)
    # 8 paired tall cream-framed vertical windows + street planters along exact north sidewalk wall (-51.61,-16.62)->(-20.40,-12.52)!
    for frac in np.linspace(0.08, 0.92, 8):
        wx = -51.61 + (-20.40 - (-51.61)) * frac
        wz = -16.62 + (-12.52 - (-16.62)) * frac
        paired_tall_window(model, wx, gy, wz, math.pi + annex_ang)

    # Rear red-brick gallery wing closing courtyard back (OVT e42af5e2, IMG_1368 center-left!)
    rear_wing = [(-30.63, 1.12), (-30.38, 7.11), (-12.41, 6.37), (-12.66, 0.38)]
    prism(model, rear_wing, -1.0, 7.8, 'brick', 'red', True)
    model.box(-21.5, gy + 4.3, 0.65, 14.5, 2.0, 0.22, 'white')
    model.box(-21.5, gy + 4.5, 0.55, 13.8, 1.55, 0.12, 'glass')

    # Openwork perforated red-brick courtyard wall & black iron gate along sidewalk (IMG_1367 & IMG_1368 foreground!)
    model.box(-22.0, gy - 0.35, -18.5, 28.0, 0.38, 12.0, 'pave', True)
    # Street-side openwork brick wall segment + black iron gate closing gap (-20.4,-12.5) -> (-12.0,-14.2)
    for wall_p0, wall_p1 in (((-20.4, -12.6), (-15.8, -13.6)), ((-18.8, -21.2), (-14.2, -19.2))):
        dx, dz = wall_p1[0] - wall_p0[0], wall_p1[1] - wall_p0[1]
        wlen = math.hypot(dx, dz)
        wyaw = math.atan2(-dx, dz)
        mx, mz = (wall_p0[0] + wall_p1[0]) / 2, (wall_p0[1] + wall_p1[1]) / 2
        model.pose = (mx, gy, mz, wyaw)
        model.box(0, -0.2, 0, 0.28, 0.52, wlen, 'earth', True)
        model.box(0, 2.25, 0, 0.34, 0.14, wlen + 0.1, 'earth')
        cols = max(5, round(wlen / 0.38))
        for row in range(6):
            ry = 0.32 + row * 0.32
            for col in range(cols):
                cz_off = -wlen / 2 + 0.20 + col * (wlen / cols) + (row % 2) * 0.15
                if abs(cz_off) < wlen / 2 - 0.1:
                    model.box(0, ry, cz_off, 0.26, 0.22, 0.26, 'earth', row == 0)
        model.pose = (0, 0, 0, 0)
    # Openwork black wrought-iron gate leaf in courtyard wall (IMG_1367 center-left)
    model.box(-14.0, gy + 2.15, -13.9, 3.4, 0.08, 0.08, 'tile')
    for gx in np.linspace(-15.5, -12.5, 9):
        model.box(gx, gy, -13.9, 0.05, 2.2, 0.05, 'tile', True)

    # =========================================================================
    # 4. IMG_1366 WEST JIEFANG RD: Twin 6-storey ochre-brown residential blocks
    # separated by a clear sky gap along IMG_1366 (-49.78, -30.35) -> (-0.828, +0.561)!
    # =========================================================================
    # Left 6-storey gabled ochre-brown apartment block (exact audited OVT 17601980!)
    apt_left = [(-123.83, 8.25), (-80.41, 10.46), (-79.79, -1.51), (-123.21, -3.72)]
    prism(model, apt_left, -0.5, 19.6, 'gold', 'earth', True)
    apt_l_ang = math.atan2(2.21, 43.42)
    model.pose = (-101.8, 0.9, 3.37, apt_l_ang)
    model.roof(0, 18.2, 0, 44.2, 12.8, 2.2)
    for fl in range(5):
        fy = 3.2 + fl * 2.95
        for bx in np.linspace(-18.5, 18.5, 9):
            model.box(bx, fy, -6.08, 2.6, 1.85, 0.14, 'white')
            model.box(bx, fy + 0.15, -6.15, 2.1, 1.45, 0.08, 'glass')
        model.box(21.75, fy, -2.5, 0.16, 2.1, 4.2, 'glass')
    model.pose = (0, 0, 0, 0)

    # Right 6-storey cantilevered cornice ochre-brown apartment block (set northwest at x=-122..-91, z=-24..-14
    # so a clean sky gap separates left & right blocks in IMG_1366!)
    apt_right_tall = [(-121.5, -24.5), (-122.6, -16.8), (-91.5, -12.0), (-90.4, -19.7)]
    prism(model, apt_right_tall, -0.5, 21.0, 'gold', 'white', True)
    apt_r_ang = math.atan2(4.8, 31.1)
    model.pose = (-106.5, 1.0, -18.2, apt_r_ang)
    model.box(12.2, 19.8, 0, 6.8, 0.45, 8.8, 'white')
    model.box(0, 19.3, 0, 32.0, 0.35, 8.2, 'white')
    model.box(15.6, 3.0, 1.8, 0.24, 16.2, 2.6, 'clock')
    for fl in range(5):
        fy = 3.4 + fl * 3.05
        for bx in np.linspace(-12.5, 11.5, 6):
            model.box(bx, fy, 3.95, 2.8, 1.85, 0.14, 'white')
            model.box(bx, fy + 0.15, 4.02, 2.3, 1.45, 0.08, 'glass')
    model.pose = (0, 0, 0, 0)

    # Low canopy street trees (h=6.8m so upper 4 storeys & sky gap of twin blocks tower clearly above foliage in IMG_1366!)
    for tx, tz in ((-63.5, -18.5), (-72.0, -13.5), (-80.5, -8.5), (-68.0, -6.5), (-77.5, -1.5)):
        camphor_tree(model, tx, 0.5, tz, h=6.8, spread=3.8)
    # Municipal blue road sign at bottom-left & bus shelter ad box at bottom-right of IMG_1366!
    model.box(-67.5, 0.5, -11.2, 0.12, 3.1, 0.12, 'granite')
    model.box(-67.4, 2.2, -11.2, 0.12, 1.25, 2.15, 'clock')
    model.box(-59.5, 0.4, -26.2, 1.2, 2.25, 3.2, 'tile')
    model.box(-58.88, 0.6, -26.2, 0.08, 1.65, 2.7, 'clock')


if __name__ == '__main__':
    generate(
        'guangxi_arts',
        hall,
        lettering=dict(text=' ', foreground='#3c6b8e', background='#3c6b8e'),
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
            gold='#c99372',
            clock='#3c6b8e',
            leaf='#355630',
        ),
    )
