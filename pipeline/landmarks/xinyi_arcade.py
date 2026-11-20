"""Xinyi Road east-side arcade & cantilevered shop awnings (IMG_1359, IMG_1360).
Anchored at Overture c82cbe63-0533-4b26-895c-6378ffcca723 centroid (-1735.23, -390.82), rot=0.
"""
import math
from pathlib import Path
import sys
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trees import emit_landmark_tree
from xiaoyao_tower import generate


# Exact Overture footprints relative to (-1735.23, -390.82)
EAST_BLOCKS = [
    # f3f287f6 (far north z ~ -68)
    ([(9.28, -74.29), (9.54, -61.59), (20.14, -61.80), (19.88, -74.52)], -3.1, 13.5, 'white'),
    # 5facbc48 (north z ~ -52)
    ([(9.40, -56.37), (8.60, -48.93), (23.50, -47.31), (24.31, -54.76)], -2.9, 13.5, 'white'),
    # fac16efc (z ~ -41)
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
    # Match exact smoothed world_y profile relative to anchor (158.80 m) so sidewalk/tactile/planters sit cleanly above terrain
    return float(np.interp(z, [-75, -55, -40, -25, -18, -10, 0, 15, 32], [-1.35, -0.95, -0.62, -0.34, -0.22, -0.10, 0.0, -0.12, -0.30]))


def east_wall_x(z):
    # Strictly track the true west shopfront line of EAST_BLOCKS from z=+28 (south) to z=-74 (north)
    return float(
        np.interp(
            z,
            [-74.0, -60.0, -50.0, -44.0, -37.0, -31.0, -22.0, -18.0, -12.0, 0.0, 13.0, 28.0],
            [9.35, 9.40, 8.60, 3.47, 2.24, -1.59, -3.00, -3.36, -4.65, -4.55, -7.05, -7.80],
        )
    )


def planter_tree(model, x, z):
    gy = ground_offset(z)
    model.site_datum = gy
    h_lift = 0.14 if z <= -9.0 else 0.0
    # Square granite tree planter kerb (prominent in IMG_1359 & IMG_1360!)
    model.box(x, gy - 0.3, z, 1.85, 0.64 + h_lift, 1.85, 'stone', True)
    model.box(x, gy + 0.34 + h_lift, z, 1.55, 0.06, 1.55, 'tile')
    # Sweet Osmanthus (桂花, city tree) in raised granite planter matching IMG_1359 & IMG_1360
    emit_landmark_tree(
        model,
        'osmanthus',
        x,
        gy + 0.32 + h_lift,
        z,
        scale=1.02,
        y_scale=1.04,
        yaw=z * 0.55,
        variant_idx=int(abs(z)) % 3,
        wood_mat='wood',
        leaf_mat='leaf',
        collide_trunk=True,
    )


def arcade(model):
    model.fit_to_grade('xinyi_arcade')
    # 1. East-side & West-side audited Overture building masses
    for ring, dy, h, col in EAST_BLOCKS + WEST_BLOCKS:
        model.site_datum = dy
        prism(model, ring, dy - 1.8, h + 1.8, col, True)

    # Windows on street-facing east end of 26d958b7 ((-33.48, 4.81) -> (-31.46, -5.48)) for IMG_1359 top-left!
    model.site_datum = -0.2
    west_yaw = -math.atan2(2.02, 10.29)
    model.pose = (-32.47, -0.2, -0.33, west_yaw)
    model.box(0.08, 0.0, 0.0, 0.16, 3.6, 10.1, 'clock')
    model.box(-0.6, 17.6, 0.0, 1.8, 0.35, 10.6, 'granite')
    if model.detail:
        for fl in range(4):
            fy = 4.6 + fl * 3.1
            for fz in (-3.2, 0.0, 3.2):
                # Rear pins meet the oblique Overture wall behind the glass.
                wall_x = fz*math.tan(2*west_yaw)
                model.beam([wall_x,fy+.6,fz],[.05,fy+.6,fz],.055,'granite')
                model.box(.05, fy, fz, .08, 1.35, 1.15, 'glass')
    model.pose = (0, 0, 0, 0)

    # 2. Continuous cantilevered 2nd-floor soffit ceiling & shop awnings along east sidewalk (below y=5.7m)
    south_yaw = -math.atan2(0.198, 1.0)
    for seg_z in np.arange(-72.0, 30.0, 6.0):
        if seg_z > -9.0:
            # Preserve exact R1 geometry for IMG_1359 (passed review!)
            wall_x = -4.55 - 0.198 * seg_z
            yaw = south_yaw
            seg_len = 6.15
        else:
            wall_x = east_wall_x(seg_z)
            dx_seg = east_wall_x(seg_z - 3.0) - east_wall_x(seg_z + 3.0)
            yaw = -math.atan2(dx_seg, 6.0)
            seg_len = math.hypot(dx_seg, 6.0) + 0.45

        gy = ground_offset(seg_z)
        model.site_datum = gy
        model.pose = (wall_x, gy, seg_z, yaw)

        # Sidewalk paving & yellow tactile strip under arcade
        pave_top = 0.38 if seg_z <= -9.0 else 0.07
        model.box(-3.1, -0.45, 0, 6.8, 0.45 + pave_top, seg_len, 'pave', True)
        model.box(-2.05, pave_top + 0.008, 0, 0.40, 0.018, seg_len, 'yellow')

        # Stepped reddish-granite shop threshold steps along shopfront (IMG_1359, IMG_1360 right bottom)
        model.box(-0.55, -0.2, 0, 1.1, 0.56 if seg_z <= -9.0 else 0.42, seg_len - 0.05, 'earth' if seg_z <= -9.0 else 'granite', True)
        model.box(-0.98, -0.2, 0, 0.46, 0.40 if seg_z <= -9.0 else 0.26, seg_len - 0.05, 'stone', True)

        # Ground-floor blue roller shutters & pharmacy green frames
        is_pharmacy = -6.5 <= seg_z <= 3.5
        frame_col = 'green' if is_pharmacy else 'clock'
        model.box(0.05, 0.0, 0, 0.28, 3.60, seg_len - 0.1, frame_col, True)
        for sub_z in (-1.45, 1.45):
            model.box(-0.06, 0.07, sub_z, 0.18, 3.10, 2.35, 'sign' if is_pharmacy else 'clock')
            if model.detail:
                for sl in np.arange(0.6, 3.0, 0.28):
                    model.box(-0.15, sl, sub_z, 0.08, 0.04, 2.28, 'granite')

        if seg_z > -9.0:
            # IMG_1359 segment (unchanged)
            model.box(-1.55, 3.85, 0, 3.45, 0.30, seg_len, 'stone')
            model.box(-1.55, 4.15, 0, 3.35, 1.50, seg_len - 0.05, 'white')
            if seg_z <= 6.5:
                pts = [
                    (0.0, 3.72, -3.05),
                    (0.0, 3.72, 3.05),
                    (-3.35, 3.18, 3.05),
                    (-3.35, 3.18, -3.05),
                ]
                model.mesh(pts, [[0, 1, 2], [0, 2, 3]], 'green')
                if model.detail:
                    for sz in (-1.8, 1.8):
                        model.beam([0.0, 2.85, sz], [-2.85, 3.26, sz], 0.035, 'granite', 4)
        else:
            # IMG_1360 continuous cantilevered arcade soffit covering the east sidewalk (u = 0.36..1.00 overhead!)
            # Reaches 3.60 m out from shopfront wall (lx = +0.15 .. -3.60), leaving left sky & tree canopy visible as in photo!
            model.box(-1.72, 3.72, 0, 3.75, 0.26, seg_len + 0.2, 'stone')
            model.box(-1.15, 3.98, 0, 2.55, 1.35, seg_len + 0.1, 'white')
            if model.detail:
                for jz in (-1.5, 1.5):
                    model.box(-1.72, 3.705, jz, 3.68, 0.02, 0.05, 'granite')
                    model.box(-1.65, 3.70, jz + 0.75, 0.16, 0.02, 0.16, 'white')
            # Dark-green vertical slatted front fascia along outer edge & foreground overhead green awning!
            model.box(-3.56, 3.66, 0, 0.10, 0.42, seg_len + 0.2, 'green')
            if -22.0 <= seg_z <= -16.0:
                model.box(-1.72, 3.62, 1.85, 3.72, 0.10, 2.40, 'green')

        # Kerbside stone bollards (IMG_1359, IMG_1360 left of bike lane)
        for bz in (-2.2, 0.8):
            model.beam([-5.35, 0.05, bz], [-5.35, 0.62 if seg_z <= -9.0 else 0.48, bz], 0.14, 'stone', 8)

        model.pose = (0, 0, 0, 0)

    # 3. Row of camphor street trees in raised square stone planters along east kerb
    # Start north of IMG_1359 (-1.98) at tz = -10.5 so IMG_1359 foreground stays untouched!
    for tz in (-63.0, -55.5, -48.0, -40.5, -33.0, -25.5, -18.0, -10.5, 5.5, 13.5, 21.5):
        tx = east_wall_x(tz) - 5.20 if tz <= -9.0 else (-4.55 - 0.198 * tz - 5.15)
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
            earth='#9c5b52',
            green='#245c36',
            clock='#1f4e8c',
            sign='#1f2c38',
            glass='#536976',
            leaf='#3b5d34',
            yellow='#d7b24a',
        ),
        smooth=('green', 'clock'),
    )
