"""Guanyi Bridge stone promenades, four neoclassical corner monuments (IMG_1362),
and west Xifeng Rd split median island + gantry direction signage (IMG_1361).
"""
import math
import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont
from xiaoyao_tower import generate
from c_kit import landmark_surface


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


def monument(model, station, lateral):
    # Tall neoclassical Corinthian four-column bridgehead pylon (~8.8 m tall, IMG_1361 & IMG_1362)
    for bottom, width, height in [
        (0.10, 2.55, 0.25),
        (0.35, 2.25, 0.30),
        (0.65, 1.95, 1.55),
        (2.20, 2.15, 0.26),
        (2.46, 1.52, 5.10),
        (7.56, 1.95, 0.32),
        (7.88, 2.28, 0.42),
        (8.30, 2.58, 0.28),
    ]:
        model.box(station, bottom, lateral, width, height, width, 'stone', True)
    for east in (-0.76, 0.76):
        for south in (-0.76, 0.76):
            axis = station + east
            depth = lateral + south
            segments = 32 if model.detail else 12
            angles = np.linspace(0, math.tau, segments, endpoint=False)
            ring = [((0.26 + 0.02 * math.cos(16 * a)) * math.cos(a), (0.26 + 0.02 * math.cos(16 * a)) * math.sin(a)) for a in angles]
            verts = [(axis + x, h, depth + z) for h in (2.46, 7.20) for x, z in ring]
            faces = []
            for idx in range(segments):
                nxt = (idx + 1) % segments
                faces.extend([[idx, nxt, nxt + segments], [idx, nxt + segments, idx + segments]])
            model.mesh(verts, faces, 'stone')
            model.box(axis, 7.20, depth, 0.70, 0.36, 0.70, 'stone')
            if model.detail:
                for hand in (-1, 1):
                    spiral = [
                        (axis + hand * (0.20 + 0.14 * a / 6 * math.cos(a)), 7.32 + 0.14 * a / 6 * math.sin(a), depth + np.sign(south) * 0.35)
                        for a in np.linspace(0, 6.8, 10)
                    ]
                    for start, end in zip(spiral, spiral[1:]):
                        model.beam(start, end, 0.04, 'granite', 5)
    for side in (-1, 1):
        for facing in (0, math.pi / 2):
            model.pose = (station, 0, lateral, facing)
            outline = [(-0.48, 6.3), (0, 6.48), (0.48, 6.3), (0.38, 5.58), (0, 5.20), (-0.38, 5.58)]
            model.mesh([(0, 5.88, side * 0.98)] + [(x, h, side * 0.80) for x, h in outline], [[0, k + 1, 1 + (k + 1) % 6] for k in range(6)], 'granite')
            # Bronze '观漪桥' plaque on pedestal
            model.box(0, 1.05, side * 0.98, 1.12, 0.68, 0.09, 'sign')
            for x in np.arange(-0.96, 0.97, 0.24):
                model.box(x, 7.82, side * 1.05, 0.12, 0.18, 0.14, 'granite')
            model.pose = (0, 0, 0, 0)


def promenade(model, side):
    for station in range(-54, 53, 2):
        for row in range(4):
            model.box(station, -.06, side * (13 + row * 2 + (.2 if row == 3 else 0)), 2, .22, 2.4 if row == 3 else 2, 'pave', True)
        model.box(station, 0.16, side * 20, 2, 1.0, 0.30, 'white', True)
        model.box(station, 1.16, side * 20, 2, 0.18, 0.42, 'stone')
        if station % 4 == 0:
            model.box(station, 0.14, side * 20, 0.65, 1.42, 0.65, 'stone', True)
        elif model.detail:
            for shift in (-1, 0, 1):
                for reach in (-0.48, -0.26, 0, 0.26, 0.48):
                    base = station + shift
                    z = side * 19.82
                    tip = 0.99 - 0.37 * abs(reach)
                    model.mesh(
                        [
                            (base, 0.42, z),
                            (base + reach * 0.55 - 0.075, 0.68, z),
                            (base + reach, tip, z),
                            (base + reach * 0.55 + 0.075, 0.68, z),
                            (base + reach * 0.55, 0.70, z - side * 0.1),
                        ],
                        [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
                        'granite',
                    )
    for station in (-35, 0, 35):
        points = [
            [station, 0, side * 17.4],
            [station, 4.2, side * 17.4],
            [station, 5.0, side * 17.1],
            [station, 5.45, side * 16.3],
            [station, 5.50, side * 15.6],
        ]
        for start, end in zip(points, points[1:]):
            model.beam(start, end, 0.09, 'tile')
        model.box(station, 5.4, side * 15.55, 0.33, 0.14, 0.62, 'lamp')


def sign_letters(model, text, width, height, font_px=22):
    if not model.detail:
        return
    font = _cjk_font(font_px)
    w_px = max(64, round(width * 44))
    h_px = max(24, round(height * 44))
    image = Image.new('1', (w_px, h_px))
    draw = ImageDraw.Draw(image)
    draw.text((w_px // 2, h_px // 2), text, font=font, anchor='mm', fill=1)
    sx, sy = width / w_px, height / h_px
    for row, pixels in enumerate(np.asarray(image)):
        for left, right in np.flatnonzero(np.diff(np.r_[False, pixels, False])).reshape(-1, 2):
            z0, z1 = (left - w_px / 2) * sx, (right - w_px / 2) * sx
            top = height / 2 - row * sy
            model.mesh([(-0.09, top, z0), (-0.09, top, z1), (-0.09, top - sy, z1), (-0.09, top - sy, z0)], [[0, 1, 2], [0, 2, 3]], 'white')


def west_split_island(model):
    # IMG_1361: Camera is at local (-75.0, -16.96) looking NE (30.7 deg -> local +x, +z along split approach!)
    # Split island between Xifeng Rd carriageways w/259011245 & w/259011246 runs from (-72.2, -16.2) to (-53.5, -7.2)
    yaw = math.atan2(9.0, 18.7)  # ~ +25.7 deg in local x-z plane
    cx, cz = -62.8, -11.7
    model.pose = (cx, 0, cz, -yaw)

    # Boat-prow granite kerb median island + soil bed
    island_len = 20.5
    for idx, (sx, hw) in enumerate(((-9.4, 0.9), (-6.0, 1.65), (0.0, 2.05), (6.5, 1.85), (9.6, 1.15))):
        seg_l = 3.6 if idx in (0, 4) else 5.8
        model.box(sx, -.08, 0, seg_l, .40, hw * 2, 'curb', True)
        model.box(sx, 0.32, 0, seg_l - 0.32, 0.42, hw * 2 - 0.36, 'green')

    # Rounded clipped shrubs inside the median island (IMG_1361 foreground!)
    sphere = trimesh.creation.icosphere(subdivisions=1 if model.detail else 0)
    for sx, sr, sh in ((-7.2, 1.15, 0.95), (-3.6, 1.65, 1.35), (1.2, 1.50, 1.20), (5.6, 1.45, 1.15)):
        crown = sphere.vertices * [sr * 1.25, sh, sr] + [sx, 0.82, 0]
        crown[:,1] = np.maximum(crown[:,1],.65)
        model.mesh(crown, sphere.faces, 'leaf')

    # White traffic guardrail along the left carriageway edge (IMG_1361 left!)
    for gx in np.arange(-9.0, 8.5, 2.2):
        model.box(gx, -0.2, -2.55, 0.08, 1.08, 0.08, 'white')
    model.box(-0.2, 0.78, -2.55, 18.0, 0.07, 0.06, 'white')
    model.box(-0.2, 0.32, -2.55, 18.0, 0.06, 0.05, 'white')

    # Front nose blue round regulatory signs ('直行/非机动车' pole at prow of island, IMG_1361 left foreground)
    model.beam([-9.6, -0.2, -0.35], [-9.6, 3.85, -0.35], 0.07, 'granite', 6)
    for sy in (1.95, 2.68):
        model.box(-9.68, sy, -0.35, 0.08, 0.54, 0.54, 'clock')
        model.box(-9.66, sy - 0.03, -0.35, 0.06, 0.60, 0.60, 'white')

    # Overhead aluminum gantry mast + large municipal blue direction board ('解放西路 / 乐群路 / 三多路', IMG_1361!)
    model.beam([-3.2, -0.18, 0.85], [-3.2, 5.55, 0.85], 0.14, 'granite', 8, True)
    model.beam([-3.2, 5.30, 0.85], [-3.2, 5.30, -4.6], 0.09, 'granite', 6)
    # Large blue road direction board centered above right branch approach, facing incoming (-x)
    bx, by, bz = -1.6, 3.65, 2.15
    model.beam([-3.2,5.28,.85],[bx,5.05,bz],.09,'granite')
    model.box(bx + 0.02, by - 0.05, bz, 0.08, 1.66, 3.16, 'white')
    model.box(bx-.022, by, bz, 0.144, 1.56, 3.06, 'clock')
    model.pose = (
        cx + bx * math.cos(-yaw) - bz * math.sin(-yaw),
        by + 1.08,
        cz + bx * math.sin(-yaw) + bz * math.cos(-yaw),
        -yaw,
    )
    sign_letters(model, '↑ 解放西路', 2.6, 0.44, 20)
    model.pose = (
        cx + bx * math.cos(-yaw) - bz * math.sin(-yaw),
        by + 0.48,
        cz + bx * math.sin(-yaw) + bz * math.cos(-yaw),
        -yaw,
    )
    sign_letters(model, '乐群路 ← → 三多路', 2.8, 0.40, 18)

    # Vertical blue '观漪桥' bridge nameplate on right approach kerb (z > island, IMG_1361 center-right!)
    model.pose = (-55.5, 0, -3.8, -yaw)
    model.beam([0, -.08, 0], [0, 3.55, 0], 0.07, 'granite', 6)
    model.box(-0.06, 1.85, 0, 0.08, 1.38, 0.58, 'white')
    model.box(-0.08, 1.90, 0, 0.10, 1.28, 0.50, 'clock')
    model.pose = (0, 0, 0, 0)


def bridge(model):
    # All FOUR bridgehead corners carry the tall neoclassical 4-column stone monuments!
    for side_z in (-1, 1):
        promenade(model, side_z)
        for side_x in (-1, 1):
            monument(model, side_x * 50, side_z * 17.3)
    model.ground_offset = lambda x,z: surface.ground(x,z) - approach_height(x,z)
    west_split_island(model)


surface = landmark_surface('guanyi_bridge')
def approach_height(x,z):
    if x < -55 or x > 53:
        return surface.ground(x,z)-.16
    return np.interp(x,[-55,-30,0,30,53],
                     [surface.ground(-55,z)-.16,6,7.35,8.5,surface.ground(53,z)-.16])

if __name__ == '__main__':
    generate(
        'guanyi_bridge',
        bridge,
        colors=dict(
            stone='#c4b9a8',
            granite='#928d84',
            pave='#a8a59e',
            white='#e6dfd3',
            clock='#1c5596',
            sign='#313b36',
            green='#355832',
            leaf='#2f502b',
        ),
        smooth=('clock',),
        terrain_offset=approach_height,
    )
