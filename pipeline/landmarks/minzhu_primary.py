"""Generalized OSM/Overture model for minzhu_primary."""
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
    'school_name': '桂林市民主小学',
    'gate_bg':     '#efeae0',
    'gate_fg':     '#1e4d8c',
    'gate_sub_fg': '#56585c',
    'vert_bg':     '#55595e',
    'vert_fg':     '#f0d890',
    'vert_text':   '民主小学',
    'motto':       '崇德 尚学 健美 创新',
    'led_title':   '桂林市民主小学',
    'emblem':      '民主',
}

SCHOOL = 'minzhu_primary'
BOUNDARY = 'way/970311799'
FRONTAGE = (5, 40, -20)
SKIP_EDGES = set()
BUILDINGS = [
    dict(bid='B1', source_id='98dc0dcd-eab5-41b5-96bc-8593cd3a2546', floors=5, floor_h=3.4, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B2', source_id='e52c2561-b679-40c6-a84d-022cab694a44', floors=4, floor_h=3.4, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B3', source_id='2a8ab93a-f68f-431e-bd65-04e6a3d9feb9', floors=3, floor_h=3.4, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent')
]


if __name__ == '__main__':
    export_school_glb(SCHOOL, PALETTE, SIGNS, lambda builder: build(builder, sys.modules[__name__]))
