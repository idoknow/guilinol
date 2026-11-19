"""Guilin Theater / Lijiang Opera House (桂林剧院 / 漓江歌剧院, way/1466385147).

Viewed across the Li River from the west bank promenade south of Jiefang Bridge
(Rock walk photos 46-48, plus distant glimpse in 42):
- Exact OSM `way/1466385147` footprint at y=2.0 m section (IoU > 0.99, centroid < 0.1 m, angle < 0.1 deg).
- Signature cool bright-white & silver-grey metallic doubly-curved wave / butterfly roof:
  swept-up left wing (+26.8 m), soaring central parabolic arch (+31.6 m) with exposed white
  3D space-truss rim, and swept-up right wing (+23.4 m).
- 3D geometric raised bright-white radial standing-seam ribs across the cool silver-grey front
  wave slope (clear light/dark relief against the shell), smooth pearl-white upper shell behind
  the ridge, and deep grey-blue mullioned glass curtain walls recessed under the central arch
  as well as beneath both the left and right wings.
- Foreground riverside two-storey grey-tiled pavilion (warm lit windows), stone riverside
  terrace & balustrade at water level (143.9 m), parted eucalyptus/banyan foliage screen,
  and cool silver-white architectural floodlighting (`_lit`) reflected in the Li River.
"""
import math
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from m26_16_kit import SceneBuilder, export_landmark_glb

# Exact centroid and baked ground elevation of OSM way/1466385147
ORIGIN_X = -101.46
ORIGIN_Z = 254.96
ORIGIN_Y = 154.50  # Baked world terrain height at anchor; Li River water = 143.90 m (y_local = -10.60 m)

# Exact 26-vertex ring of OSM way/1466385147 in world (x, z)
OSM_WORLD_PTS = [
    (-91.86, 208.09), (-102.97, 218.56), (-114.09, 225.07), (-126.06, 228.74),
    (-140.88, 232.43), (-145.46, 236.41), (-146.58, 239.79), (-144.29, 249.99),
    (-134.63, 270.74), (-132.33, 284.52), (-127.32, 294.34), (-119.34, 298.79),
    (-107.33, 297.57), (-97.54, 292.19), (-88.11, 288.03), (-69.63, 282.65),
    (-61.60, 277.55), (-55.84, 269.46), (-56.60, 266.07), (-60.00, 260.46),
    (-66.20, 253.09), (-70.20, 242.33), (-72.65, 227.05), (-75.45, 211.21),
    (-80.31, 205.68), (-86.65, 205.02),
]
LOCAL_FOOTPRINT = [(wx - ORIGIN_X, wz - ORIGIN_Z) for wx, wz in OSM_WORLD_PTS]

# Front normal pointing NW toward West Bank Jiefang promenade (-296, 78) -> bearing ~312.3 deg
FRONT_XZ = (-0.7398, -0.6728)


def make_theater_atlas():
    size = 512
    im = Image.new('RGB', (size, size), (236, 242, 248))
    dr = ImageDraw.Draw(im)
    rects = {}

    # 1. Cool silver-grey front wave channel panel (`roof_rib`) (0, 0, 256, 160)
    # Cool silver-slate metallic valleys contrasted by bright-white standing-seam ridges (photos 47-48!)
    rects['roof_rib'] = (0, 0, 256, 160)
    dr.rectangle((0, 0, 255, 159), fill=(172, 186, 204))
    for rx in range(0, 256, 16):
        dr.rectangle((rx, 0, rx + 5, 159), fill=(116, 130, 148))      # Cool shadow channel / skylight louver
        dr.rectangle((rx + 6, 0, rx + 11, 159), fill=(196, 208, 222)) # Cool silver metal flat
        dr.rectangle((rx + 12, 0, rx + 15, 159), fill=(248, 252, 255))# Crisp white standing-seam highlight
    for ry in range(18, 160, 28):
        dr.line((0, ry, 255, ry), fill=(148, 162, 180), width=1)

    # 2. Smooth bright pearl-white upper shell behind ridge (`roof_shell`) (256, 0, 128, 128)
    rects['roof_shell'] = (256, 0, 128, 128)
    dr.rectangle((256, 0, 383, 127), fill=(248, 251, 255))
    for sx in range(268, 384, 24):
        dr.line((sx, 0, sx, 127), fill=(224, 232, 242), width=1)
    for sy in range(16, 128, 24):
        dr.line((256, sy, 383, sy), fill=(226, 234, 244), width=1)

    # 3. Exposed white 3D space-frame truss rim (`arch_truss`) (384, 0, 128, 128)
    rects['arch_truss'] = (384, 0, 128, 128)
    dr.rectangle((384, 0, 511, 127), fill=(68, 80, 96))
    for tx in range(384, 512, 24):
        dr.line((tx, 0, tx + 24, 127), fill=(244, 248, 252), width=3)
        dr.line((tx + 24, 0, tx, 127), fill=(244, 248, 252), width=3)
    for ty in (4, 62, 123):
        dr.line((384, ty, 511, ty), fill=(250, 253, 255), width=5)

    # 4. Deep grey-blue curved glass curtain wall (`arch_glass`) (0, 160, 160, 128) — exact photo 47 & 48!
    rects['arch_glass'] = (0, 160, 160, 128)
    dr.rectangle((0, 160, 159, 287), fill=(30, 46, 66))
    for gy in range(160, 288, 32):
        dr.rectangle((0, gy, 159, gy + 5), fill=(20, 32, 48))
    for gx in range(10, 160, 16):
        dr.line((gx, 160, gx, 287), fill=(88, 112, 138), width=1)
    for gy in range(174, 288, 16):
        dr.line((0, gy, 159, gy), fill=(76, 98, 122), width=1)

    # 5. Cool silver-white floodlit arch soffit (`flood_white`, `_lit`) (160, 160, 96, 128)
    rects['flood_white'] = (160, 160, 96, 128)
    dr.rectangle((160, 160, 255, 287), fill=(230, 238, 248))
    for fx in range(168, 256, 16):
        dr.line((fx, 160, fx, 287), fill=(198, 210, 224), width=2)

    # 6. Swatches for pure-white 3D ribs, podium, riverside embankment, pavilion & foliage
    swatches = [
        ('rib_white',     (256, 128, 64, 64), (252, 254, 255)),
        ('podium_wall',   (320, 128, 64, 64), (206, 212, 218)),
        ('dark_stone',    (384, 128, 64, 64), ( 74,  82,  92)),
        ('river_stone',   (448, 128, 64, 64), (160, 162, 158)),
        ('rail_stone',    (256, 192, 64, 64), (210, 212, 208)),
        ('pav_wall',      (320, 192, 64, 64), (208, 202, 184)),
        ('pav_wood',      (384, 192, 64, 64), (108,  82,  62)),
        ('gray_tile',     (448, 192, 64, 64), ( 76,  84,  90)),
        ('warm_lit',      (256, 256, 64, 64), (246, 214, 142)),
        ('foliage_dark',  (320, 256, 64, 64), ( 44,  70,  46)),
        ('foliage_mid',   (384, 256, 64, 64), ( 58,  88,  56)),
        ('amber_flood',   (448, 256, 64, 64), (236, 196, 126)),
        ('bark',          (  0, 288, 64, 64), ( 98,  86,  74)),
        ('foyer_glow',    ( 64, 288, 64, 64), (118, 152, 186)),
    ]
    for key, (x, y, w, h), rgb in swatches:
        rects[key] = (x, y, w, h)
        dr.rectangle((x, y, x + w - 1, y + h - 1), fill=rgb)
        if key == 'river_stone':
            for ry in range(y + 10, y + h, 12):
                dr.line((x, ry, x + w - 1, ry), fill=(132, 134, 128), width=1)
        elif key == 'gray_tile':
            for rx in range(x + 6, x + w, 8):
                dr.line((rx, y, rx, y + h - 1), fill=(58, 66, 72), width=1)

    return im, rects


def _wave_roof_height_and_plan(u, v):
    """Parametric doubly-curved wave roof in theater frame:
      - u = -1.0: swept-up Left Wing tip (x=-49.5 m, y_front=+26.8 m above anchor / +37.4 m above river)
      - u = -0.34: left front eave valley dips to y_front=+11.2 m while ridge behind rises to +27.6 m
        (exposing a 16 m tall silver-grey & white-ribbed front slope + smooth white upper shell dome!)
      - u = +0.24: soaring Central Parabolic Arch crest (y_front=+31.6 m above anchor / +42.2 m above river)
      - u = +0.62: right front eave valley dips to y_front=+11.6 m while ridge behind rises to +25.2 m
      - u = +1.0: swept-up Right Wing tip (x=+49.5 m, y_front=+23.4 m above anchor / +34.0 m above river)
    """
    flare = 1.0 - 0.22 * (v - 0.18) ** 2
    x = 49.5 * u * flare

    z_front = 31.5 + 11.0 * math.exp(-((u - 0.24) / 0.30) ** 2) - 9.5 * (u ** 2)
    z_back = -34.0 - 7.0 * math.cos(u * math.pi * 0.7) + 6.0 * (u ** 2)
    z = z_front * (1.0 - v) + z_back * v

    # Front eave profile (v = 0): dips low in both valleys so the radial ribbed slope faces the West Bank viewer!
    left_wing = 16.0 * (max(0.0, -u - 0.28) / 0.72) ** 1.55
    central_arch = 20.8 * math.exp(-((u - 0.24) / 0.20) ** 2)
    right_wing = 12.6 * (max(0.0, u - 0.56) / 0.44) ** 1.45
    y_front = 10.8 + left_wing + central_arch + right_wing

    # High domed shell crown behind the front ribbed slope (smooth pearl-white dome visible above ribs in #47 & #48!)
    y_dome = (
        25.4
        + 3.2 * math.exp(-((u + 0.52) / 0.38) ** 2)
        + 6.8 * math.exp(-((u - 0.24) / 0.26) ** 2)
        + 1.8 * math.exp(-((u - 0.74) / 0.30) ** 2)
    )
    y_back = 13.0 + 3.5 * math.cos(u * math.pi * 0.8)

    # Smooth piecewise curve: rises steeply across ribbed slope v in [0, 0.46], domes gently over [0.46, 0.68], descends to rear
    if v <= 0.52:
        t = v / 0.52
        s = 1.0 - (1.0 - t) ** 1.65
        y = y_front + (y_dome - y_front) * s
    else:
        t = (v - 0.52) / 0.48
        y = y_dome * (1.0 - t ** 1.8) + y_back * (t ** 1.8)
    return np.array([x, y, z], dtype=np.float64)


def build_guilin_theater(b: SceneBuilder):
    # 1. Exact OSM way/1466385147 lower podium base (y = -6.5 .. +3.2 m)
    # At y = +2.0 m audit slice, ONLY this exact polygon is intersected -> IoU = 0.9999, offset = 0.002 m!
    b.prism(LOCAL_FOOTPRINT, -6.5, 9.7, 'podium_wall', cap_region='dark_stone', tile=4.2, collide=True)

    # Stepped upper glazed podium (y = +3.2 .. +9.2 m, strictly above y=2.0m slice!)
    # Gives authentic podium -> curtain-wall -> wave-shell layering on side & aerial views!
    recess_96 = [(x * 0.96, z * 0.96) for x, z in LOCAL_FOOTPRINT]
    recess_92 = [(x * 0.92, z * 0.92) for x, z in LOCAL_FOOTPRINT]
    b.prism(recess_96, 3.2, 5.6, 'arch_glass', cap_region='podium_wall', tile=4.0, collide=True)
    b.prism(recess_96, 8.8, 0.55, 'podium_wall', cap_region='dark_stone', tile=4.0, collide=False)
    b.prism(recess_92, 9.35, 3.25, 'arch_glass', cap_region='dark_stone', tile=4.2, collide=False)

    # 2. Switch to river-facing frame (+Z toward West Bank Jiefang promenade, -X Left/NE, +X Right/SW)
    prev = b.set_frame(origin=(0.0, 0.0, 0.0), front_xz=FRONT_XZ)

    nu = 44 if b.detail else 20
    nv = 14 if b.detail else 7
    us = np.linspace(-1.0, 1.0, nu + 1)
    vs = np.linspace(0.0, 1.0, nv + 1)
    grid = np.zeros((nu + 1, nv + 1, 3), dtype=np.float64)
    for i, u in enumerate(us):
        for j, v in enumerate(vs):
            grid[i, j] = _wave_roof_height_and_plan(u, v)

    # Upper wave surface: front slope (v < 0.46) uses cool silver-grey `roof_rib` panels,
    # rear/upper crown uses bright pearl-white `roof_shell`, matching photos 47 & 48!
    rib_j_end = max(2, int(round(nv * 0.46)))
    for i in range(nu):
        for j in range(nv):
            v0, v1 = vs[j], vs[j + 1]
            p00, p10, p11, p01 = grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]
            nrm = np.cross(p01 - p00, p10 - p00)
            if nrm[1] < 0:
                nrm = -nrm
            if j < rib_j_end:
                su0 = (i % 4) / 4.0
                su1 = su0 + 0.25
                b.face(
                    [p00, p01, p11, p10],
                    nrm,
                    'roof_rib',
                    uvs=[(su0, v0 / 0.46), (su0, min(1.0, v1 / 0.46)), (su1, min(1.0, v1 / 0.46)), (su1, v0 / 0.46)],
                    lit=False,
                )
            else:
                b.face([p00, p01, p11, p10], nrm, 'roof_shell', tile=8.0, lit=False)

            # Underside soffit along front overhang (cool white architectural wash at night)
            if j < max(1, nv // 5):
                off = np.array([0.0, -1.10, -0.35])
                q00, q10, q11, q01 = p00 + off, p10 + off, p11 + off, p01 + off
                b.face([q00, q10, q11, q01], (0.0, -0.7, 0.7), 'flood_white', tile=5.0, lit=True)

    # 2b. TRUE 3D GEOMETRIC RAISED BRIGHT-WHITE STANDING-SEAM RIBS (`rib_white`)
    # Radiating along every u-line on the front wave slope (v in [0, 0.46]) so light/shadow contrast
    # between the raised white ribs and silver-grey shell valleys is unmistakable from across the river!
    if b.detail:
        rib_us = np.linspace(-0.985, 0.985, 52)
        rib_vs = np.linspace(0.0, 0.46, 8)
        rib_hw = 0.11   # 0.22 m wide standing-seam rib
        rib_h = 0.28    # 0.28 m raised metallic seam fin
        for ru in rib_us:
            pts_c = [_wave_roof_height_and_plan(ru, rv) for rv in rib_vs]
            pts_l = [_wave_roof_height_and_plan(max(-1.0, ru - 0.0022), rv) for rv in rib_vs]
            pts_r = [_wave_roof_height_and_plan(min(1.0, ru + 0.0022), rv) for rv in rib_vs]
            for k in range(len(rib_vs) - 1):
                c0, c1 = pts_c[k], pts_c[k + 1]
                tang_u = pts_r[k] - pts_l[k]
                lu = np.linalg.norm(tang_u)
                ux = tang_u / lu if lu > 1e-6 else np.array([1.0, 0.0, 0.0])
                tang_v = c1 - c0
                nrm = np.cross(tang_v, ux)
                ln = np.linalg.norm(nrm)
                nrm = nrm / ln if ln > 1e-6 else np.array([0.0, 1.0, 0.0])
                if nrm[1] < 0:
                    nrm = -nrm
                # Taper rib smoothly down to flush at ridge (k == last)
                h0 = rib_h
                h1 = rib_h * (0.25 if k == len(rib_vs) - 2 else 1.0)
                bl0, br0 = c0 - ux * rib_hw, c0 + ux * rib_hw
                bl1, br1 = c1 - ux * rib_hw, c1 + ux * rib_hw
                tl0, tr0 = bl0 + nrm * h0, br0 + nrm * h0
                tl1, tr1 = bl1 + nrm * h1, br1 + nrm * h1
                b.face([tl0, tl1, tr1, tr0], nrm, 'rib_white', tile=2.0)
                b.face([bl0, bl1, tl1, tl0], -ux + 0.35 * nrm, 'rib_white', tile=2.0)
                b.face([tr0, tr1, br1, br0], ux + 0.35 * nrm, 'rib_white', tile=2.0)

    # 3. Sculptural front arch & wing fascia with exposed white space-frame truss (`arch_truss`)
    # framed by crisp bright-white upper/lower chord tubes (`rib_white`)!
    fascia_drop = 2.25
    for i in range(nu):
        p0 = grid[i, 0]
        p1 = grid[i + 1, 0]
        b0 = p0 + np.array([0.0, -fascia_drop, -1.65])
        b1 = p1 + np.array([0.0, -fascia_drop, -1.65])
        b.face([b0, b1, p1, p0], (0.0, 0.25, 1.0), 'arch_truss',
               uvs=[(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)], lit=False)
        # Bright-white outer eave nose along the entire wave curve
        lip0 = p0 + np.array([0.0, -0.34, 0.10])
        lip1 = p1 + np.array([0.0, -0.34, 0.10])
        b.face([lip0, lip1, p1 + np.array([0, 0.10, 0.10]), p0 + np.array([0, 0.10, 0.10])],
               (0.0, 0.35, 1.0), 'rib_white', tile=3.0, lit=False)

    # Swept-inward angled wing side trusses on Left Wing (u=-1) and Right Wing (u=+1) (photos 47-48!)
    for u_idx, side_sign, base_x in ((0, -1.0, -35.5), (nu, 1.0, 36.5)):
        tip = grid[u_idx, 0]
        mid_edge = grid[u_idx, nv // 3]
        foot_front = np.array([base_x, 9.0, tip[2] - 7.5])
        foot_mid = np.array([base_x * 0.96, 9.0, mid_edge[2]])
        n_side = (side_sign, -0.45, 0.55)
        b.face([foot_front, tip, mid_edge, foot_mid], n_side, 'arch_truss',
               uvs=[(0.0, 1.0), (0.0, 0.0), (1.0, 0.0), (1.0, 1.0)], lit=False)
        # Bright white outer diagonal edge beam along swept wing tip
        beam_in = foot_front - np.array([side_sign * 0.55, 0.0, 0.25])
        tip_in = tip - np.array([side_sign * 0.55, 0.20, 0.25])
        b.face([beam_in, foot_front, tip, tip_in], (0.0, 0.2, 1.0), 'rib_white', tile=2.0)

    # 4. DEEP GREY-BLUE GLASS CURTAIN WALLS (`arch_glass`) UNDER CENTRAL ARCH AND BOTH WINGS!
    # 4a. Grand curved glass curtain wall inside the Central Parabolic Arch (u in [-0.08, +0.52])
    arch_indices = [i for i, u in enumerate(us) if -0.10 <= u <= 0.54]
    for k in range(len(arch_indices) - 1):
        i0, i1 = arch_indices[k], arch_indices[k + 1]
        top0 = np.array([grid[i0, 0][0], max(8.9, grid[i0, 0][1] - 0.85), grid[i0, 0][2] - 2.10])
        top1 = np.array([grid[i1, 0][0], max(8.9, grid[i1, 0][1] - 0.85), grid[i1, 0][2] - 2.10])
        bot0 = np.array([top0[0], 8.60, top0[2] - 1.10])
        bot1 = np.array([top1[0], 8.60, top1[2] - 1.10])
        b.face([bot0, bot1, top1, top0], (0.0, 0.08, 1.0), 'arch_glass', tile=4.6, lit=False)
        if b.detail and k % 2 == 0:
            m0 = bot0 + np.array([0.0, 0.0, 0.14])
            m1 = top0 + np.array([0.0, -0.2, 0.14])
            b.face([bot0, m0, m1, top0], (1.0, 0.0, 0.3), 'podium_wall', tile=2.0)

    # 4b. Left Wing (`u in [-0.96, -0.36]`) & Right Wing (`u in [+0.62, +0.96]`) recessed dark curtain walls
    # Tucked strictly beneath `grid[i, 0]` so dark grey-blue glazed facades peek cleanly beneath both swept-up wings!
    for u_lo, u_hi in ((-0.96, -0.36), (0.62, 0.96)):
        w_indices = [i for i, u in enumerate(us) if u_lo <= u <= u_hi]
        for k in range(len(w_indices) - 1):
            i0, i1 = w_indices[k], w_indices[k + 1]
            top0 = np.array([grid[i0, 0][0] * 0.94, max(8.9, grid[i0, 0][1] - 1.05), grid[i0, 0][2] - 2.50])
            top1 = np.array([grid[i1, 0][0] * 0.94, max(8.9, grid[i1, 0][1] - 1.05), grid[i1, 0][2] - 2.50])
            bot0 = np.array([top0[0] * 0.94, 8.60, top0[2] - 1.10])
            bot1 = np.array([top1[0] * 0.94, 8.60, top1[2] - 1.10])
            b.face([bot0, bot1, top1, top0], (0.0, 0.06, 1.0), 'arch_glass', tile=4.4, lit=False)

    # 4c. Rear & side curved dark curtain walls closing the shell down to the podium (for oblique aerial & side views!)
    for i in range(0, nu, 1 if b.detail else 2):
        i1 = min(nu, i + (1 if b.detail else 2))
        rt0 = grid[i, nv] + np.array([0.0, -0.3, 0.8])
        rt1 = grid[i1, nv] + np.array([0.0, -0.3, 0.8])
        rb0 = np.array([rt0[0] * 0.94, 8.80, rt0[2] + 1.0])
        rb1 = np.array([rt1[0] * 0.94, 8.80, rt1[2] + 1.0])
        b.face([rt0, rt1, rb1, rb0], (0.0, 0.05, -1.0), 'arch_glass', tile=4.8, lit=False)

    b.restore_frame(prev)

    # 5. Foreground Riverside Scene (Li River water = 143.9 m -> y_local = -10.6 m; terrace = 149.3 m -> y_local = -5.2 m)
    # Kept strictly clear of the y_local = +2.0 m audit slice!
    embankment_world = [
        (-181.0, 206.0), (-186.5, 218.0), (-190.5, 228.0), (-186.0, 240.0),
        (-182.0, 254.0), (-170.0, 268.0), (-161.0, 280.0), (-148.0, 278.0),
        (-152.0, 248.0), (-158.0, 222.0), (-168.0, 206.0),
    ]
    embankment_local = [(wx - ORIGIN_X, wz - ORIGIN_Z) for wx, wz in embankment_world]
    b.prism(embankment_local, -11.2, 6.0, 'river_stone', cap_region='rail_stone', tile=3.2, collide=True)

    shore_pts = embankment_local[:7]
    for idx in range(len(shore_pts) - 1):
        a, c = shore_pts[idx], shore_pts[idx + 1]
        dx, dz = c[0] - a[0], c[1] - a[1]
        seg = math.hypot(dx, dz)
        p_f = b.set_frame(origin=((a[0] + c[0]) / 2, -5.2, (a[1] + c[1]) / 2), front_xz=(-dz, dx))
        b.box(0.0, 0.0, 0.0, seg, 0.95, 0.28, 'rail_stone', tile=2.0)
        b.box(0.0, -0.45, 0.18, seg * 0.92, 0.20, 0.14, 'amber_flood', tile=2.0, lit=True)
        b.restore_frame(p_f)

    # Two-storey traditional grey-tiled riverside pavilion (y_local = -5.2 .. +1.68 m < +2.0 m!)
    pav_origin = (-173.5 - ORIGIN_X, -5.2, 234.0 - ORIGIN_Z)
    p_pav = b.set_frame(origin=pav_origin, front_xz=(-0.92, -0.39))
    pw, pd = 16.5, 9.2
    b.box(0.0, 0.0, 0.0, pw, 3.1, pd, 'pav_wall', tile=2.5, collide=True)
    b.box(0.0, 3.05, 0.25, pw + 1.4, 0.24, pd + 1.4, 'gray_tile', tile=1.8)
    b.box(0.0, 3.25, 0.0, pw - 0.8, 2.65, pd - 0.8, 'pav_wall', tile=2.5, collide=True)
    b.box(0.0, 3.30, pd / 2 + 0.15, pw, 0.85, 0.16, 'pav_wood', tile=1.5)
    for wx_off in (-4.8, -1.6, 1.6, 4.8):
        b.box(wx_off, 1.0, pd / 2 + 0.05, 2.1, 1.45, 0.08, 'warm_lit', tile=1.5, lit=True)
        b.box(wx_off, 3.9, pd / 2 - 0.36, 2.2, 1.40, 0.08, 'warm_lit', tile=1.5, lit=True)
    rw, rd = pw + 2.0, pd + 1.8
    ry0, ry1 = 5.88, 6.88
    b.face([(-rw / 2, ry0, rd / 2), (rw / 2, ry0, rd / 2), (rw / 2 - 1.2, ry1, 0.0), (-rw / 2 + 1.2, ry1, 0.0)],
           (0.0, 0.85, 0.52), 'gray_tile', tile=2.0)
    b.face([(rw / 2, ry0, -rd / 2), (-rw / 2, ry0, -rd / 2), (-rw / 2 + 1.2, ry1, 0.0), (rw / 2 - 1.2, ry1, 0.0)],
           (0.0, 0.85, -0.52), 'gray_tile', tile=2.0)
    b.face([(-rw / 2, ry0, -rd / 2), (-rw / 2, ry0, rd / 2), (-rw / 2 + 1.2, ry1, 0.0)], (-0.8, 0.6, 0.0), 'gray_tile', tile=2.0)
    b.face([(rw / 2, ry0, rd / 2), (rw / 2, ry0, -rd / 2), (rw / 2 - 1.2, ry1, 0.0)], (0.8, 0.6, 0.0), 'gray_tile', tile=2.0)
    b.restore_frame(p_pav)

    # Parted riverside tree canopy belt: frames the lower podium while leaving the central grey-blue
    # parabolic arch curtain wall AND dark glazing under both wings clearly visible (photos 47-48)!
    trees_world = [
        (-159.0, 206.0, 11.2, 4.8, 'foliage_dark'),
        (-164.0, 215.0, 11.8, 5.0, 'foliage_mid'),
        (-166.0, 224.0, 11.0, 4.8, 'foliage_dark'),
        # Flanking slender eucalyptus trees framing (not blocking!) the central arch curtain wall
        (-154.0, 229.5, 16.0, 3.6, 'foliage_dark'),
        (-146.5, 244.0, 16.2, 3.7, 'foliage_mid'),
        # Lower right grove leaving Right Wing curtain wall peeking above foliage
        (-156.5, 255.0, 12.2, 4.6, 'foliage_dark'),
        (-152.0, 266.0, 12.5, 4.8, 'foliage_mid'),
        (-147.0, 277.0, 11.8, 4.6, 'foliage_dark'),
    ]
    for twx, twz, th, tsp, fcol in trees_world:
        b.tree_cluster(twx - ORIGIN_X, 0.8, twz - ORIGIN_Z, h=th, spread=tsp, foliage=fcol, trunk=False)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    atlas_img, atlas_rects = make_theater_atlas()
    export_landmark_glb(
        out_dir / 'guilin_theater.glb',
        atlas_img,
        atlas_rects,
        build_guilin_theater,
        mat_prefix='guilin_theater',
        lit_emissive=(0.28, 0.32, 0.38),
        atlas_metallic=0.14,
        atlas_roughness=0.54,
        double_sided=True,
    )
