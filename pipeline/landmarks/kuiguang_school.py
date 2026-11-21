"""Generalized OSM/Overture model for kuiguang_school."""
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
    'win_frame':   '#36454f',
    'win_trim':    '#f3eee4',
    'base_frame':  '#8b8f92',
    'base_trim':   '#5b3e31',
    'pave_grey':   '#c9c4ba',
    'pave_road':   '#9e9a92',
    'pave_dark':   '#594d47',
    'granite':     '#b2afa6',
    'roof_tile':   '#6e747d',
    'roof_blue':   '#1e4d8c',
    'roof_red':    '#9e483c',
    'track_red':   '#b55042',
    'turf_a':      '#498845',
    'turf_b':      '#3d7438',
    'court_a':     '#438e5e',
    'court_b':     '#3b6da4',
    'cinnabar':    '#c85845',
    'yellow':      '#dfb648',
    'cream':       '#d4998f',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '桂林市奎光学校',
    'motto':       '博学明志 笃行致远',
    'led_title':   '桂林市奎光学校',
    'gate_bg':     '#1e4d8c',
    'gate_fg':     '#f8f9fa',
    'gate_sub_fg': '#d0d8e8',
    'vert_bg':     '#2b3a4a',
    'vert_fg':     '#f0d890',
    'vert_text':   '奎光学校',
    'emblem':      '奎光',
}

SCHOOL = 'kuiguang_school'
BOUNDARY = 'way/253811717'
FRONTAGE = (-13, 25, -65)
SKIP_EDGES = {0, 13, 14}
# Boundary trimmed to keep the model off the public street.
STREET_SETBACK = [
    (-115.0, -79.76), (-123.96, -57.52), (-153.23, -69.17), (-174.46, -16.5),
    (-123.86, 3.61), (-128.64, 15.48), (-43.39, 49.36), (-37.61, 35.0),
    (-16.0, 42.5), (-12.1, 31.5), (-8.2, 21.0), (-24.75, 13.92),
    (-10.01, -22.7), (-30.88, -30.99), (-25.54, -44.22), (-115.0, -79.76)
]
CUSTOM_BUILDINGS = {'way/701820464', 'way/683033673'}
BUILDINGS = [
    dict(bid='B1', source_id='way/683033673', floors=5, floor_h=3.55, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B2', source_id='way/683033672', floors=4, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B3', source_id='way/683033678', floors=4, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B4', source_id='way/692355780', floors=4, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B5', source_id='way/683033675', floors=3, floor_h=3.35, roof='flat_rail', wall_reg='white', base_reg='wall_base'),
    dict(bid='B6', source_id='way/701820464', floors=5, floor_h=3.45, roof='flat_rail', wall_reg='cream', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B7', source_id='way/683033677', floors=2, floor_h=3.35, roof='flat_rail', wall_reg='wall_base', base_reg='wall_base')
]


def street_buildings(model):
    model.fit_to_grade(SCHOOL)
    w7018_ring = [(-1.20, -17.21), (-14.60, 13.82), (-0.46, 19.86), (14.84, -15.57), (6.17, -19.27), (4.27, -14.88)]
    prism(model, w7018_ring, -1.2, 17.4, 'earth', 'granite', True)

    cy = 0.30
    model.site_datum = cy
    model.pose = (-28.7, cy, 6.73, -1.147)
    model.box(5.85, -0.3, -0.2, 2.2, 2.85, 5.2, 'brick', True)
    model.box(5.45, 2.55, -0.2, 3.1, 0.22, 5.8, 'earth')
    model.box(-6.35, -0.3, 1.8, 2.3, 2.75, 6.8, 'brick', True)
    model.box(-5.15, 0.85, 1.8, 0.10, 1.25, 5.2, 'red')

    model.pose = (0, 0, 0, 0)
    ring = [(-168.34, -28.89), (-157.16, -53.72), (-146.29, -48.89), (-157.48, -24.06)]
    prism(model, ring, cy - 1.2, 18.4, 'white', 'white', True)
    bx_cx, bx_cz = -157.32, -38.89
    model.pose = (bx_cx, cy, bx_cz, -1.147)
    for fl in range(5):
        fy = 0.2 + fl * 3.35
        if fl > 0:
            model.box(0, fy, 6.02, 26.8, 0.98, 0.22, 'white')
            model.box(0, fy + 0.98, 6.06, 26.8, 0.12, 0.26, 'clock')
        for col_x in np.linspace(-11.5, 11.5, 7):
            model.box(col_x, fy, 5.95, 0.42, 3.35, 0.35, 'white')
            model.box(col_x, fy + 1.1, 5.71, 2.8, 1.55, 0.24, 'glass')
    for gable_x in (-8.5, -2.8, 2.8, 8.5):
        gp = [
            (gable_x - 2.8, 17.0, 6.12),
            (gable_x + 2.8, 17.0, 6.12),
            (gable_x, 18.05, 6.12),
        ]
        model.mesh(gp, [[0, 1, 2], [0, 2, 1]], 'white')
        model.beam([gable_x - 2.8, 17.02, 6.16], [gable_x, 18.08, 6.16], 0.09, 'clock', 5)
        model.beam([gable_x, 18.08, 6.16], [gable_x + 2.8, 17.02, 6.16], 0.09, 'clock', 5)
    model.box(0.0, 5.8, 6.18, 6.4, 3.1, 0.16, 'sign')
    model.box(0.0, 5.65, 6.14, 6.8, 3.4, 0.10, 'white')
    model.box(0.0, 0.25, 6.12, 6.8, 2.85, 0.12, 'red')
    model.pose = (0, 0, 0, 0)

if __name__ == '__main__':
    from xiaoyao_tower import generate
    export_school_glb(SCHOOL, PALETTE, SIGNS, lambda builder: build(builder, sys.modules[__name__]))
    generate(
        'exterior', street_buildings,
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
    append_exterior(Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.'), SCHOOL)
