"""Generalized OSM/Overture model for zhonghua_primary."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
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
    'cream':       '#f2ece1',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '桂林市中华小学',
    'gate_bg':     '#efeae0',
    'gate_fg':     '#1e4d8c',
    'gate_sub_fg': '#56585c',
    'vert_bg':     '#55595e',
    'vert_fg':     '#f0d890',
    'vert_text':   '中华小学',
    'motto':       '明天的我是中华的骄傲',
    'led_title':   '桂林市中华小学',
    'emblem':      '中华',
}

SCHOOL = 'zhonghua_primary'
BOUNDARY = 'way/1531318258'
FRONTAGE = (25, 30, -10)
SKIP_EDGES = set()
# Boundary trimmed to keep the model off the public street.
STREET_SETBACK = [
    (-29.0, 48.19), (-13.2, 53.37), (-4.21, 55.41), (-3.13, 43.88),
    (9.02, 32.22), (18.2, 34.63), (21.3, 31.01), (31.5, 32.81),
    (35.5, 9.04), (37.8, -6.87), (28.8, -9.14), (30.9, -28.56),
    (29.6, -45.29), (-19.18, -52.29), (-28.77, -3.85), (-29.0, -4.33),
    (-29.0, 7.04), (-29.0, 48.19)
]
BUILDINGS = [
    dict(bid='B1', source_id='2048ed26-fa86-4e34-8959-9b0b2e253237', floors=5, floor_h=3.4, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B2', source_id='way/1531318257', floors=2, floor_h=3.4, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B3', source_id='way/1531318256', floors=2, floor_h=3.4, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
]


if __name__ == '__main__':
    export_school_glb(SCHOOL, PALETTE, SIGNS, lambda builder: build(builder, sys.modules[__name__]))
