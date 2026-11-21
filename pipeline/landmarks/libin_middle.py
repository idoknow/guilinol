"""Generalized OSM/Overture model for libin_middle."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mapped_school import build
from school_kit import export_school_glb

PALETTE = {
    'wall_main':   '#eceae4',
    'wall_sub':    '#224c4e',
    'wall_accent': '#522a26',
    'wall_base':   '#963c32',
    'win_frame':   '#36454f',
    'win_trim':    '#f3eee4',
    'base_frame':  '#8b8f92',
    'base_trim':   '#5b3e31',
    'pave_grey':   '#c8c4ba',
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
    'school_name': '桂林市中山中学',
    'gate_bg':     '#efeae0',
    'gate_fg':     '#224c4e',
    'gate_sub_fg': '#56585c',
    'vert_bg':     '#55595e',
    'vert_fg':     '#f0d890',
    'vert_text':   '中山中学',
    'motto':       '天下為公',
    'led_title':   '桂林市中山中学漓滨校区',
    'emblem':      '中山',
}

SCHOOL = 'libin_middle'
BOUNDARY = 'way/675588260'
FRONTAGE = (125, -10, 65)
LINTEL_HEIGHT = 5.5
SKIP_EDGES = {0, 2, 3}
BUILDINGS = [
    dict(bid='B1', source_id='way/683033662', floors=5, floor_h=3.45, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B2', source_id='way/683033663', floors=4, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent')
]


if __name__ == '__main__':
    export_school_glb(SCHOOL, PALETTE, SIGNS, lambda builder: build(builder, sys.modules[__name__]))
