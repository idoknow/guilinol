"""Generalized OSM/Overture model for guilin_middle."""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from school_exteriors import append_exterior, prism
from mapped_school import build
from school_kit import export_school_glb

PALETTE = {
    'wall_main':   '#eeede7',
    'wall_sub':    '#4c6a58',
    'wall_accent': '#1e4d8c',
    'wall_base':   '#9e4d3c',
    'pave_grey':   '#c9c4ba',
    'pave_road':   '#9e9a92',
    'pave_dark':   '#6e747d',
    'granite':     '#83878c',
    'roof_tile':   '#353b40',
    'roof_blue':   '#2a527a',
    'roof_red':    '#a8322c',
    'white':       '#f3eee4',
    'steel':       '#c8ccd0',
    'glass':       '#384752',
    'track_red':   '#b55042',
    'turf_a':      '#498845',
    'turf_b':      '#3d7438',
    'court_a':     '#3e7856',
    'court_b':     '#3b6da4',
    'cinnabar':    '#a8322c',
    'yellow':      '#dfb648',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '桂林中学',
    'gate_bg':     '#efeae0',
    'gate_fg':     '#a8322c',
    'gate_sub_fg': '#36454f',
    'vert_bg':     '#55595e',
    'vert_fg':     '#f0d890',
    'vert_text':   '桂林中学',
    'motto':       '专心致志 严谨治学',
    'led_title':   '桂林中学解西校区',
    'emblem':      '桂中',
}

SCHOOL = 'guilin_middle'
BOUNDARY = 'way/253811718'
FRONTAGE = (15, 25, 0)
SKIP_EDGES = set()
CUSTOM_BUILDINGS = {'way/690980799', 'f97d45ef-6943-4e73-8c4b-672340a7b8a7'}
BUILDINGS = [
    dict(bid='B1', source_id='way/690980799', floors=2, floor_h=3.6, roof='hip_gable', wall_reg='pave_dark', base_reg='pave_dark', parapet_reg='cinnabar'),
    dict(bid='B2', source_id='f97d45ef-6943-4e73-8c4b-672340a7b8a7', floors=6, floor_h=3.5, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B3', source_id='way/682942537', floors=4, floor_h=3.6, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B4', source_id='way/682942536', floors=5, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B5', source_id='way/683033683', floors=5, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B6', source_id='way/682942535', floors=5, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B7', source_id='way/682942534', floors=5, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B8', source_id='2c0786a8-316f-4b14-a011-0bcfe23ec27e', floors=3, floor_h=3.35, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base'),
    dict(bid='B9', source_id='72d24742-818c-4954-8a15-ceff8e95e9c8', floors=4, floor_h=3.35, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base'),
    dict(bid='B10', source_id='a1feace1-6a08-44d0-ba70-99390d1b14a4', floors=2, floor_h=3.3, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base'),
    dict(bid='B11', source_id='ba39af2f-b7b6-4a01-a907-790fc605a125', floors=1, floor_h=3.3, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base')
]


def build_kuiguang_lou(model):
    ang = math.atan2(5.50, 11.46)
    model.pose = (0.0, 0.0, 0.0, ang)

    w, d = 12.6, 11.2
    model.box(0, -0.6, -0.6, w, 7.8, d - 1.2, 'brick', True)
    for sx in (-1, 1):
        gx = sx * (w / 2 - 0.22)
        model.box(gx, 6.8, -0.6, 0.46, 1.35, d - 1.4, 'brick')
        peak_pts = [
            (gx, 7.2, -5.2),
            (gx, 7.2, 4.0),
            (gx, 9.65, -0.6),
        ]
        for off in (-0.22, 0.22):
            v = [(px + off, py, pz) for px, py, pz in peak_pts]
            model.mesh(v, [[0, 1, 2], [0, 2, 1]], 'brick')
        if sx > 0:
            model.box(gx + 0.26, 4.55, -2.6, 0.12, 0.95, 0.95, 'white')
            model.box(gx + 0.30, 4.68, -2.6, 0.10, 0.68, 0.68, 'sign')
            model.box(gx + 0.26, 3.85, 1.4, 0.14, 1.35, 0.92, 'red')

    model.roof(0, 7.25, -0.6, w + 0.8, d + 0.8, 2.45)

    gz = d / 2 - 0.55
    model.box(0, -0.4, gz - 0.5, w, 0.65, 2.2, 'stone', True)
    model.box(0, 3.65, gz - 0.4, w - 0.2, 0.22, 1.9, 'red', True)
    model.box(0, 6.95, gz - 0.4, w - 0.2, 0.22, 1.9, 'red')
    for px in np.linspace(-5.6, 5.6, 5):
        model.beam([px, 0.25, gz + 0.35], [px, 7.15, gz + 0.35], 0.16, 'red', 8, True)
    model.box(0, 3.87, gz + 0.35, w - 0.6, 0.88, 0.10, 'red')
    if model.detail:
        for lx in np.linspace(-5.0, 5.0, 7):
            model.box(lx, 0.22, gz - 0.95, 1.25, 3.13, 0.12, 'red')
            model.box(lx, 4.0, gz - 0.95, 1.25, 2.65, 0.12, 'red')
    model.box(6.8, -0.2, 3.6, 0.65, 1.65, 0.28, 'white')
    model.box(7.8, -0.2, 1.2, 1.45, 1.85, 1.15, 'stone')
    model.pose = (0, 0, 0, 0)


def build_flanking_facades(model):
    model.site_datum = -0.58
    gy = -0.58
    yaw = 0.216

    model.pose = (-7.8, gy, 19.8, yaw)
    model.box(-2.5, -0.6, 1.2, 15.5, 4.5, 9.6, 'white', True)
    model.box(-2.5, 3.65, 6.25, 16.0, 0.42, 0.85, 'white')
    for sx in (-7.5, -2.5, 2.2):
        model.box(sx, 0.2, 6.02, 3.6, 2.9, 0.14, 'tile')
    model.box(-4.8, 3.9, 0.4, 12.2, 19.2, 10.4, 'stone', True)
    rcx, rcz, rr = 1.3, 0.4, 5.2
    segs = 14 if model.detail else 7
    for fl in range(6):
        fy = 3.9 + fl * 3.15
        for sub_y, sub_h, col in ((fy, 1.35, 'stone'), (fy + 1.35, 1.55, 'clock'), (fy + 2.90, 0.25, 'white')):
            for idx in range(segs):
                a0 = -math.pi * 0.15 + math.pi * 0.80 * idx / segs
                a1 = -math.pi * 0.15 + math.pi * 0.80 * (idx + 1) / segs
                x0, z0 = rcx + rr * math.sin(a0), rcz + rr * math.cos(a0)
                x1, z1 = rcx + rr * math.sin(a1), rcz + rr * math.cos(a1)
                quad = [(x0, sub_y, z0), (x1, sub_y, z1), (x1, sub_y + sub_h, z1), (x0, sub_y + sub_h, z0)]
                model.mesh(quad, [[0, 1, 2], [0, 2, 3]], col, sub_y == fy and fl == 0)
        model.box(-5.2, fy + 1.35, 5.64, 11.2, 1.55, 0.12, 'clock')
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

    annex_ring = [(21.8, 28.5), (25.2, 34.8), (28.8, 27.6), (22.2, 23.8)]
    prism(model, annex_ring, gy - 0.8, 8.6, 'white', 'white', True)
    model.pose = (24.6, gy, 29.8, yaw + 0.15)
    eave_r = [(-4.2, 7.35, 3.2), (4.2, 7.35, 3.2), (4.2, 8.05, 2.2), (-4.2, 8.05, 2.2)]
    model.mesh(eave_r, [[0, 1, 2], [0, 2, 3]], 'green')
    model.box(0, 4.35, 2.85, 6.8, 1.85, 0.16, 'tile')
    model.box(0, 0.2, 2.82, 6.2, 3.1, 0.14, 'clock')
    model.pose = (0, 0, 0, 0)

    f97_ring = [(60.44, 13.23), (64.56, 2.91), (68.86, -7.87), (46.42, -16.48), (42.60, -6.48), (36.78, 8.61)]
    prism(model, f97_ring, -1.0, 21.8, 'white', 'granite', True)

    f97_ang = math.atan2(13.23 - 8.61, 60.44 - 36.78)
    model.pose = (48.6, -0.2, 10.9, f97_ang)
    model.box(-9.2, 21.8, -2.0, 5.2, 3.8, 5.4, 'stone')
    model.box(-9.8, 25.4, -2.0, 6.8, 0.42, 6.4, 'granite')
    model.box(-9.2, 3.5, 0.12, 2.4, 21.2, 0.14, 'clock')
    model.beam([-14.6, -0.4, 0.5], [-14.6, 18.2, 0.5], 0.42, 'stone', 10, True)
    for idx in range(8):
        t0, t1 = idx / 8, (idx + 1) / 8
        x0, x1 = -18.2 + 8.5 * t0, -18.2 + 8.5 * t1
        y0_c = 16.8 + 2.4 * math.sin(t0 * math.pi * 0.75)
        y1_c = 16.8 + 2.4 * math.sin(t1 * math.pi * 0.75)
        can_q = [(x0, y0_c, 3.2), (x1, y1_c, 3.2), (x1, y1_c, -4.8), (x0, y0_c, -4.8)]
        model.mesh(can_q, [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]], 'granite')
    for px in (-3.5, 1.0, 5.5, 9.5):
        model.box(px, 20.92, -1.5, 0.38, 3.18, 0.38, 'stone')
    model.box(3.0, 24.0, -1.5, 14.5, 0.35, 6.2, 'granite')
    for fl in range(5):
        fy = 3.2 + fl * 3.4
        model.box(2.5, fy, 0.10, 16.5, 1.65, 0.12, 'glass')
    model.pose = (0, 0, 0, 0)


def append_heritage_hall(folder):
    from xiaoyao_tower import generate

    def hall(model):
        model.fit_to_grade(SCHOOL)
        build_kuiguang_lou(model)
        build_flanking_facades(model)

    generate('exterior', hall, smooth=('red', 'green', 'clock', 'earth'),
             lettering=dict(text=' ', foreground='#3f6788', background='#3f6788'),
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
        ))
    append_exterior(folder, SCHOOL)


if __name__ == '__main__':
    export_school_glb(SCHOOL, PALETTE, SIGNS, lambda builder: build(builder, sys.modules[__name__]))
    append_heritage_hall(Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.'))
