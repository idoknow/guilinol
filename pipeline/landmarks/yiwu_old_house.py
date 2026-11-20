"""Yiwu Road three-storey grey-brick mansion, OSM way/702352880 (26.0 x 14.8 m).
Local -z faces Yiwu Rd (east); -x is the south gable (IMG_1351), +x is the north gable (IMG_1353).
"""
import math
import numpy as np
from xiaoyao_tower import generate


def arched_window(model, x, y, z, width, opening, is_ground=False):
    # Warm red-brick jambs & segmental arch header + dark louvered timber shutters
    model.box(x, y, z - 0.06, width, opening, 0.12, 'wood')
    for side in (-1, 1):
        model.box(x + side * (width / 2 + 0.09), y, z - 0.13, 0.20, opening + 0.15, 0.24, 'earth')
    model.box(x, y - 0.14, z - 0.16, width + 0.46, 0.14, 0.30, 'granite')
    # Segmental red-brick arch lintel
    rise = 0.36 if not is_ground else 0.42
    segs = 7 if model.detail else 3
    half_w = width / 2 + 0.18
    for idx in range(segs):
        t0, t1 = idx / segs, (idx + 1) / segs
        x0, x1 = -half_w + 2 * half_w * t0, -half_w + 2 * half_w * t1
        y0 = y + opening + rise * (1 - (2 * t0 - 1) ** 2)
        y1 = y + opening + rise * (1 - (2 * t1 - 1) ** 2)
        pts = [
            (x + x0, y0 - 0.18, z - 0.20),
            (x + x1, y1 - 0.18, z - 0.20),
            (x + x1, y1 + 0.16, z - 0.20),
            (x + x0, y0 + 0.16, z - 0.20),
        ]
        model.mesh(pts, [[0, 1, 2], [0, 2, 3]], 'earth')
    if model.detail:
        model.box(x, y, z - 0.13, 0.08, opening, 0.08, 'wood')
        for slat in np.arange(0.22, opening - 0.1, 0.28):
            model.box(x, y + slat, z - 0.12, width - 0.08, 0.05, 0.06, 'sign')


def iron_gate(model, x_center, z_face):
    # Curved black wrought-iron double courtyard gate flanking north/south corners (IMG_1351, IMG_1353)
    model.pose = (x_center, 0, z_face, 0)
    for rail_y in (0.08, 0.78, 1.72):
        model.box(0, rail_y, 0, 3.5, 0.08, 0.08, 'tile')
    model.box(-0.88, 0.08, 0, 1.68, 0.68, 0.05, 'tile')
    model.box(0.88, 0.08, 0, 1.68, 0.68, 0.05, 'tile')
    for gx in np.arange(-1.65, 1.66, 0.22 if model.detail else 0.55):
        h = 1.95 + 0.42 * math.cos(gx * 0.85)
        model.box(gx, 0.78, 0, 0.045, h - 0.78, 0.05, 'tile')
    # Outer brick gate pier (kept below y=2m audit slice and tucked inside sidewalk kerb)
    outer = -1.92 if x_center < 0 else 1.92
    model.box(outer, -0.3, 0, 0.50, 2.15, 0.50, 'brick', True)
    model.box(outer, 1.85, 0, 0.62, 0.12, 0.62, 'granite')
    model.pose = (0, 0, 0, 0)


def pilaster(model, x, z, w, d):
    model.box(x, -0.3, z, w, 12.15, d, 'brick', True)
    for cap_y in (3.95, 7.85):
        model.box(x, cap_y, z, w + 0.34, 0.22, d + 0.34, 'tile')
        model.box(x, cap_y + 0.22, z, w + 0.18, 0.14, d + 0.18, 'granite')
    # Golden baroque acanthus capital ornament near top cornice
    model.box(x, 10.75, z, w + 0.22, 0.58, d + 0.22, 'gold')


def house(model):
    # Exact OSM way/702352880 footprint: 26.0 x 14.76 m centered at (0, 0)
    w, d, total_h = 26.0, 14.76, 11.85
    hz = d / 2.0  # 7.38
    hx = w / 2.0  # 13.0

    # Main grey-brick mass + warm red-brick plinth
    model.box(0, -0.5, 0, w, total_h + 0.5, d, 'brick', True)
    model.box(0, -0.4, 0, w + 0.14, 0.92, d + 0.14, 'earth')

    # Horizontal moulded stone stringcourses & bold roof cornice
    for band_y in (4.05, 7.95):
        model.box(0, band_y, 0, w + 0.24, 0.20, d + 0.24, 'tile')
    for idx in range(3):
        model.box(0, 11.55 + idx * 0.18, 0, w + 0.28 + idx * 0.28, 0.18, d + 0.28 + idx * 0.28, 'tile')

    # Corner & bay pilasters with stepped dark-stone capitals and gold reliefs
    for sx in (-1, 1):
        for sz in (-1, 1):
            pilaster(model, sx * (hx - 0.25), sz * (hz - 0.25), 0.82, 0.82)
    for bx in (-7.8, -2.6, 2.6, 7.8):
        pilaster(model, bx, -(hz - 0.15), 0.62, 0.56)
    for sx in (-1, 1):
        pilaster(model, sx * (hx - 0.15), 0.0, 0.56, 0.62)

    # Street-facing east facade (local -z = -7.38): 5 bays of paired arched windows + central ornate portal
    for level in range(3):
        base = 0.88 + level * 3.82
        opening = 2.55 if level == 0 else 2.25
        for bay_idx, cx in enumerate((-10.2, -5.1, 0.0, 5.1, 10.2)):
            if level == 0 and bay_idx == 2:
                # Central carved gold/stone arched entrance doorway + drum stones (抱鼓石)
                model.box(0, 0.2, -(hz + 0.06), 2.15, 3.05, 0.18, 'wood')
                for s in (-1, 1):
                    model.box(s * 1.18, 0.0, -(hz + 0.16), 0.34, 3.25, 0.34, 'gold')
                    # Carved stone drum plinths flanking doorway (IMG_1351, IMG_1352)
                    model.box(s * 1.45, 0.0, -(hz + 0.62), 0.56, 0.45, 0.88, 'granite', True)
                    model.beam([s * 1.45 - 0.22, 0.78, -(hz + 0.62)], [s * 1.45 + 0.22, 0.78, -(hz + 0.62)], 0.36, 'stone', 10)
                model.box(0, 3.12, -(hz + 0.18), 2.72, 0.42, 0.36, 'gold')
                continue
            for pair in (-0.88, 0.88):
                arched_window(model, cx + pair, base, -hz, 1.18, opening, level == 0)

    # South gable (-x = -13.0, IMG_1351) & North gable (+x = +13.0, IMG_1353): paired arched windows!
    for side in (-1, 1):
        model.pose = (side * hx, 0, 0, side * math.pi / 2)
        for level in range(3):
            base = 0.88 + level * 3.82
            opening = 2.55 if level == 0 else 2.25
            for cz in (-3.65, 3.65):
                for pair in (-0.85, 0.85):
                    arched_window(model, cz + pair, base, 0.0, 1.12, opening, level == 0)
        model.pose = (0, 0, 0, 0)

    # Narrow street planter kerb & neat green shrubs along front facade (IMG_1351, IMG_1352)
    for seg_x, seg_w in ((-6.8, 10.2), (6.8, 10.2)):
        model.box(seg_x, -0.15, -(hz + 0.55), seg_w, 0.34, 0.95, 'granite')
        model.box(seg_x, 0.19, -(hz + 0.52), seg_w - 0.25, 0.08, 0.78, 'earth')
    for sx, sh in ((-11.2, 1.85), (-5.5, 1.15), (5.5, 1.15), (10.5, 1.25)):
        model.box(sx, 0.25, -(hz + 0.55), 0.95, sh, 0.85, 'leaf')

    # Wrought-iron double gates recessed inside sidewalk kerb at south (-x) and north (+x) corners
    iron_gate(model, -(hx + 1.85), -(hz - 1.25))
    iron_gate(model, +(hx + 1.85), -(hz - 1.25))


if __name__ == '__main__':
    generate(
        'yiwu_old_house',
        house,
        colors=dict(
            brick='#62676a',
            tile='#2f3336',
            earth='#a65642',
            wood='#48342b',
            sign='#28211d',
            granite='#9b9c98',
            stone='#b8b7b0',
            gold='#cfa754',
            leaf='#3f5e38',
        ),
    )
