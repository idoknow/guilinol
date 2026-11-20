"""Lize Bridge, local x along the crossing, eastbound. Dimensions in metres.
IMG_1354: keep both east-portal suspension tower columns unobstructed; low palm & hedge at left kerb.
"""
import math
import numpy as np
from xiaoyao_tower import generate


def cable_height(station):
    distance = abs(station)
    if distance > 40:
        return 18 - (distance - 40) * 16.5 / 21
    return 3.2 + 14.8 * (math.cosh(distance / 47) - 1) / (math.cosh(40 / 47) - 1)


def towers(model, lateral):
    for station in (-40, 40):
        for bottom, width, height in [(-4, 2.1, 6), (2, 1.5, 15), (17, 1.8, 0.4), (17.4, 1.5, 0.9)]:
            model.box(station, bottom, lateral, width, height, width, 'red', True)
        vertices = [(station + dx, 18.3, lateral + dz) for dx, dz in [(-0.95, -0.95), (0.95, -0.95), (0.95, 0.95), (-0.95, 0.95)]]
        vertices.append((station, 19.8, lateral))
        model.mesh(vertices, [[0, 4, 1], [1, 4, 2], [2, 4, 3], [3, 4, 0]], 'red')
        model.box(station + 0.765, 2, lateral, 0.035, 15, 0.16, 'lamp')
    samples = np.unique(np.r_[np.linspace(-61, 61, 63 if model.detail else 17), -40, 40])
    for start, end in zip(samples, samples[1:]):
        model.beam([start, cable_height(start), lateral], [end, cable_height(end), lateral], 0.072, 'red')
        model.beam([start, cable_height(start) + 0.068, lateral], [end, cable_height(end) + 0.068, lateral], 0.022, 'lamp')
    for station in range(-56, 57, 4 if model.detail else 8):
        if abs(station) != 40:
            model.beam([station, 0.2, lateral], [station, cable_height(station), lateral], 0.055, 'red')
            model.box(station, 0.16, lateral, 0.38, 0.30, 0.38, 'red')
            model.box(station, cable_height(station) - 0.12, lateral, 0.28, 0.22, 0.22, 'red')


def promenade(model, side):
    for direction, outer_height in [(-1, 150.1), (1, 154.7)]:
        inner = direction * 61.5
        outer = direction * 74.5
        height = outer_height - 146.6 - (8.55 + min(0.05 * outer, 2 - 0.045 * (outer - 40)))
        corners = [(station, y, side * 9.6 + offset) for station, y in [(inner, 0.15), (outer, height)] for offset in (-1.9, 1.9)]
        faces = [[0, 2, 3], [0, 3, 1]] if direction < 0 else [[0, 3, 2], [0, 1, 3]]
        model.mesh(corners, faces, 'pave', True)
    for start, end in [(-61.5, 40), (40, 61.5)]:
        center, length = (start + end) / 2, end - start
        model.box(center, -0.48, side * 9.6, length, 0.63, 3.8, 'pave', True)
        for rib in range(5):
            model.box(center, 0.165, side * (10.63 + 0.064 * rib), length, 0.025, 0.035, 'granite')
        model.box(center, 0.12, side * 7.8, length, 0.22, 0.3, 'yellow', True)
        model.box(center, 0.71, side * 7.8, length, 0.16, 0.18, 'yellow', True)
    for station in range(-60, 61, 3 if model.detail else 6):
        model.box(station, 0.2, side * 7.8, 0.14, 0.56, 0.15, 'yellow')
    for station in range(-60, 61, 3):
        model.box(station, 0.15, side * 11.35, 2.75, 1.03, 0.26, 'green', True)
        model.box(station, 1.18, side * 11.35, 2.86, 0.13, 0.39, 'green')
        model.box(station + 1.42, 0.15, side * 11.35, 0.25, 1.25, 0.42, 'green', True)
    for station in range(-58, 60, 6):
        for angle in np.linspace(0, math.pi, 13)[:-1]:
            points = [(station, 0.161, side * 7.94)] + [
                (station + 2.92 * math.cos(theta), 0.161, side * (7.94 + 3.16 * math.sin(theta)))
                for theta in (angle, angle + math.pi / 12)
            ]
            model.mesh(points, [[0, 1, 2]], 'earth')


def bridge(model):
    for station in (-40, 40):
        for height in (12.8, 16.8):
            model.box(station, height, 0, 1.1, 0.85, 16.5, 'red')
    for side in (-1, 1):
        towers(model, side * 8.25)
        promenade(model, side)
        model.box(side * 60, 0.15, side * 8.55, 0.18, 4.8, 0.18, 'granite')
        model.box(side * 60, 4.35, side * 8.55, 0.44, 0.98, 0.34, 'tile')
        model.box(side * 60.0 + 0.23, 4.98, side * 8.55, 0.04, 0.21, 0.21, 'red')

    # IMG_1354 foreground left: low manicured shrub bed + compact palm inside left FOV edge
    model.box(69.5, -1.6, 12.6, 8.5, 1.25, 2.2, 'leaf')
    palm_base = np.array([69.2, -0.5, 12.8])
    model.beam(palm_base.tolist(), (palm_base + [0, 2.6, 0]).tolist(), 0.22, 'wood', 7)
    if model.detail:
        top = palm_base + [0, 2.6, 0]
        for ang in np.linspace(0, 2 * math.pi, 9, endpoint=False):
            rad = np.array([math.cos(ang), 0, math.sin(ang)])
            crs = np.array([-rad[2], 0, rad[0]]) * 0.42
            mid = top + rad * 1.25 + [0, 0.72, 0]
            model.mesh([top, mid + crs, mid + rad * 1.05 - [0, 0.55, 0], mid - crs], [[0, 1, 2], [0, 2, 3]], 'leaf')
    # Traffic camera mast-arm on left kerb aligned to ~36% frame width in IMG_1354
    model.beam([71.0, -1.5, 9.4], [71.0, 3.65, 9.4], 0.09, 'granite', 8)
    model.beam([71.0, 3.35, 9.4], [71.0, 3.35, 5.2], 0.06, 'granite', 6)


if __name__ == '__main__':
    generate(
        'lize_bridge',
        bridge,
        smooth=('red',),
        colors=dict(red='#d4733a', green='#bc5140', yellow='#d79547', earth='#a76358', granite='#828484', leaf='#3b5b35'),
        lift=lambda east: 8.55 + np.minimum(0.05 * east, 2 - 0.045 * (east - 40)),
    )
