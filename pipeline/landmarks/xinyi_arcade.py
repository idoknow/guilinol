"""Xinyi Road east-side arcade & cantilevered shop awnings (IMG_1359, IMG_1360).
Anchored at Overture c82cbe63-0533-4b26-895c-6378ffcca723 centroid (-1735.23, -390.82), rot=0.
"""
import math
import numpy as np
import trimesh
from xiaoyao_tower import generate


# Exact Overture footprints relative to (-1735.23, -390.82)
EAST_BLOCKS = [
    # fac16efc (northmost, z ~ -41)
    ([(19.74, -41.93), (3.47, -44.62), (2.24, -37.23), (18.52, -34.55)], -2.7, 13.0, 'white'),
    # 9e322d06 (z ~ -24, audited)
    ([(19.69, -21.45), (20.63, -27.38), (-1.59, -30.90), (-3.00, -22.02), (25.15, -17.56), (26.32, -24.96), (21.88, -25.67), (21.17, -21.22)], -1.6, 13.5, 'white'),
    # c1ae718c (z ~ -14)
    ([(3.76, -9.93), (5.33, -15.70), (-3.36, -18.06), (-4.93, -12.28)], -0.1, 12.8, 'white'),
    # c82cbe63 (anchor block, z ~ 0, right next to IMG_1359; keep EW edge +3cm > NS edge past 16-bit quantization)
    ([(-4.91, 4.05), (4.08, 4.90), (4.92, -4.06), (-4.07, -4.89)], 0.0, 13.2, 'white'),
    # 81d5faea (z ~ +13)
    ([(-6.93, 9.02), (-7.19, 16.49), (3.30, 16.86), (3.56, 9.37)], -0.2, 12.6, 'white'),
    # 6b2c4606 (south, z ~ +26)
    ([(-7.80, 28.38), (11.52, 31.02), (12.33, 25.09), (-6.98, 22.45)], -0.8, 13.0, 'white'),
]

WEST_BLOCKS = [
    # 26d958b7 (5-6 storey white residential block prominently visible at top-left of IMG_1359!)
    ([(-80.02, -15.01), (-82.04, -4.73), (-33.48, 4.81), (-31.46, -5.48)], -0.2, 17.8, 'white'),
    # 7ac8f2c3 (2-storey street-front shop annex north of 26d958b7)
    ([(-32.65, -13.03), (-38.88, -17.19), (-41.38, -13.46), (-35.15, -9.29)], -0.5, 7.6, 'white'),
    # c9f6fcd3 (5-storey residential block further north along west side)
    ([(-63.05, -36.65), (-65.12, -27.90), (-31.54, -20.02), (-29.47, -28.76)], -1.4, 16.2, 'white'),
]


def prism(model, ring, y0, h, color, collide=True):
    pts = np.asarray(ring, dtype=float)
    area2 = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
    if area2 < 0:
        pts = pts[::-1]
    n = len(pts)
    import mapbox_earcut
    tris = mapbox_earcut.triangulate_float64(pts, np.array([n], dtype=np.uint32)).reshape(-1, 3)
    top = np.column_stack([pts[:, 0], np.full(n, y0 + h), pts[:, 1]])
    model.mesh(top, tris[:, ::-1], 'granite', collide)
    for i in range(n):
        j = (i + 1) % n
        x0, z0 = pts[i]
        x1, z1 = pts[j]
        quad = [(x0, y0, z0), (x1, y0, z1), (x1, y0 + h, z1), (x0, y0 + h, z0)]
        model.mesh(quad, [[0, 2, 1], [0, 3, 2]], color, collide)


def ground_offset(z):
    # Match exact smoothed world_y profile relative to anchor (158.80 m) from z=+30 (south) to z=-48 (north)
    return float(np.interp(z, [-48, -38, -24, -12, 0, 15, 32], [-1.95, -1.70, -1.05, -0.35, 0.0, -0.15, -0.35]))


def planter_tree(model, x, z):
    gy = ground_offset(z)
    # Square granite tree planter kerb (prominent in IMG_1359 & IMG_1360!)
    model.box(x, gy - 0.3, z, 1.85, 0.62, 1.85, 'stone', True)
    model.box(x, gy + 0.32, z, 1.55, 0.06, 1.55, 'tile')
    model.beam([x, gy + 0.2, z], [x, gy + 3.8, z], 0.16, 'wood', 7, True)
    sphere = trimesh.creation.icosphere(subdivisions=1 if model.detail else 0)
    for dx, dy, dz, sx, sy, sz in (
        (-0.8, 4.9, 0.2, 2.5, 1.9, 2.5),
        (0.7, 5.2, -0.4, 2.3, 1.8, 2.3),
        (0.0, 6.1, 0.0, 2.2, 1.7, 2.2),
    ):
        model.mesh(sphere.vertices * [sx, sy, sz] + [x + dx, gy + dy, z + dz], sphere.faces, 'leaf')


def arcade(model):
    # 1. East-side & West-side audited Overture building masses
    for ring, dy, h, col in EAST_BLOCKS + WEST_BLOCKS:
        prism(model, ring, dy - 1.8, h + 1.8, col, True)

    # Windows on street-facing east end of 26d958b7 ((-33.48, 4.81) -> (-31.46, -5.48)) for IMG_1359 top-left!
    west_yaw = -math.atan2(2.02, 10.29)
    model.pose = (-32.47, -0.2, -0.33, west_yaw)
    model.box(0.08, 0.0, 0.0, 0.16, 3.6, 10.1, 'clock')
    model.box(-0.6, 17.6, 0.0, 1.8, 0.35, 10.6, 'granite')
    if model.detail:
        for fl in range(4):
            fy = 4.6 + fl * 3.1
            for fz in (-3.2, 0.0, 3.2):
                model.box(0.05, fy, fz, 0.08, 1.35, 1.15, 'glass')
    model.pose = (0, 0, 0, 0)

    # 2. Continuous cantilevered 2nd-floor balcony soffit & shop awnings along east sidewalk (below y=5.7m)
    # Road direction vector: as z goes from +30 to -46 (north), x shifts east at ~0.198 * (-z)
    yaw = -math.atan2(0.198, 1.0)  # ~ -11.2 deg so local -z points along Xinyi Rd NNE (348.8 deg)!
    for seg_z in np.arange(-44.0, 30.0, 6.0):
        # Wall x tracks east shopfront line: at z=0 wall_x=-4.6, at z=-24 wall_x=+0.15, at z=+24 wall_x=-9.35
        wall_x = -4.55 - 0.198 * seg_z
        gy = ground_offset(seg_z)
        model.pose = (wall_x, gy, seg_z, yaw)

        # Sidewalk paving & yellow tactile strip under arcade
        model.box(-2.9, -0.45, 0, 6.2, 0.52, 6.15, 'pave', True)
        model.box(-2.15, 0.075, 0, 0.36, 0.015, 6.15, 'yellow')

        # Stepped granite shop threshold steps along shopfront (IMG_1359, IMG_1360 right bottom)
        model.box(-0.55, -0.2, 0, 1.1, 0.42, 6.1, 'granite', True)
        model.box(-0.92, -0.2, 0, 0.42, 0.26, 6.1, 'stone', True)

        # Ground-floor blue roller shutters & pharmacy green frames
        is_pharmacy = -6.5 <= seg_z <= 3.5
        frame_col = 'green' if is_pharmacy else 'clock'
        model.box(0.05, 0.35, 0, 0.28, 3.25, 6.05, frame_col, True)
        for sub_z in (-1.45, 1.45):
            model.box(-0.08, 0.42, sub_z, 0.14, 2.75, 2.35, 'sign' if is_pharmacy else 'clock')
            if model.detail:
                for sl in np.arange(0.6, 3.0, 0.28):
                    model.box(-0.16, sl, sub_z, 0.04, 0.04, 2.28, 'granite')

        # Projecting 2nd-floor cantilevered soffit ceiling & white parapet (top y <= gy + 5.65 < 6.0 m!)
        # Overhang reaches 3.35 m out over the sidewalk (-x in local frame)
        model.box(-1.55, 3.85, 0, 3.45, 0.30, 6.12, 'stone')  # metal/stone soffit ceiling (IMG_1360!)
        model.box(-1.55, 4.15, 0, 3.35, 1.50, 6.08, 'white')  # cantilevered 2F fascia/balcony below y=5.65m

        # Sloped dark-green shop rain awnings projecting under the 2nd floor overhang (prominent in IMG_1359 & 1360!)
        if -26.0 <= seg_z <= 6.5:
            pts = [
                (0.0, 3.72, -3.05),
                (0.0, 3.72, 3.05),
                (-3.35, 3.18, 3.05),
                (-3.35, 3.18, -3.05),
            ]
            model.mesh(pts, [[0, 1, 2], [0, 2, 3]], 'green')
            # Diagonal steel support strut under green awning (IMG_1359 top right!)
            if model.detail:
                for sz in (-1.8, 1.8):
                    model.beam([0.0, 2.85, sz], [-2.85, 3.26, sz], 0.035, 'granite', 4)

        # Kerbside stone bollards (IMG_1359, IMG_1360 left of bike lane)
        for bz in (-2.2, 0.8):
            model.beam([-5.65, 0.05, bz], [-5.65, 0.48, bz], 0.14, 'stone', 8)

        model.pose = (0, 0, 0, 0)

    # 3. Row of camphor street trees in raised square stone planters along east kerb
    # Start first tree north of IMG_1359 (-1.98) at tz = -10.5 so foreground left & 5F white block stay open!
    for tz in (-40.5, -33.0, -25.5, -18.0, -10.5, 5.5, 13.5, 21.5):
        tx = -4.55 - 0.198 * tz - 5.15
        planter_tree(model, tx, tz)


if __name__ == '__main__':
    generate(
        'xinyi_arcade',
        arcade,
        lettering=dict(text=' ', foreground='#1f4e8c', background='#1f4e8c'),
        colors=dict(
            white='#e8eae6',
            stone='#b5b4ac',
            granite='#7d8286',
            pave='#8e9296',
            tile='#525450',
            green='#245c36',
            clock='#1f4e8c',
            sign='#1f2c38',
            glass='#536976',
            leaf='#3b5d34',
            yellow='#d7b24a',
        ),
        smooth=('green', 'clock'),
    )
