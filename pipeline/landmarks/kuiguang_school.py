"""Generalized OSM/Overture model for kuiguang_school."""
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
FRONTAGE = (-10, 25, -65)
SKIP_EDGES = {0, 13, 14}
BUILDINGS = [
    dict(bid='B1', source_id='way/683033673', floors=5, floor_h=3.55, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B2', source_id='way/683033672', floors=4, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B3', source_id='way/683033678', floors=4, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B4', source_id='way/692355780', floors=4, floor_h=3.45, roof='flat_rail', wall_reg='white', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B5', source_id='way/683033675', floors=3, floor_h=3.35, roof='flat_rail', wall_reg='white', base_reg='wall_base'),
    dict(bid='B6', source_id='way/701820464', floors=5, floor_h=3.45, roof='flat_rail', wall_reg='cream', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B7', source_id='way/683033677', floors=2, floor_h=3.35, roof='flat_rail', wall_reg='wall_base', base_reg='wall_base')
]


if __name__ == '__main__':
    export_school_glb(SCHOOL, PALETTE, SIGNS, lambda builder: build(builder, sys.modules[__name__]))
