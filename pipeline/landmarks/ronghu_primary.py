"""Generalized OSM/Overture model for ronghu_primary."""
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
    'school_name': '桂林市榕湖小学',
    'gate_bg':     '#efeae0',
    'gate_fg':     '#1e4d8c',
    'gate_sub_fg': '#56585c',
    'vert_bg':     '#55595e',
    'vert_fg':     '#f0d890',
    'vert_text':   '榕湖小学',
    'motto':       '做最好的自己',
    'led_title':   '桂林市榕湖小学',
    'emblem':      '榕湖',
}

SCHOOL = 'ronghu_primary'
BOUNDARY = 'way/686230935'
FRONTAGE = (-10, -60, -30)
SKIP_EDGES = set()
BUILDINGS = [
    dict(bid='B1', source_id='79568dcd-14fe-46b2-aa79-7caad830f19d', floors=5, floor_h=3.4, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B2', source_id='a51a05fd-8fbb-44da-ac6b-3d53cefe907e', floors=4, floor_h=3.4, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B3', source_id='e1315567-aac9-4f51-83cf-d06deb85a916', floors=4, floor_h=3.4, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B4', source_id='7a33574a-3274-471a-9f9b-8ae8e062f0da', floors=2, floor_h=3.4, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B5', source_id='10066d18-451b-49da-bc2b-c54fd156abfa', floors=3, floor_h=3.6, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B6', source_id='193caf84-2a3c-4949-9cf0-55bed91edc2d', floors=3, floor_h=3.4, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent'),
    dict(bid='B7', source_id='c693ee13-ec1b-4e1c-a409-0ef415f03b50', floors=3, floor_h=3.4, roof='flat_rail', wall_reg='wall_main', base_reg='wall_base', parapet_reg='wall_accent')
]


if __name__ == '__main__':
    export_school_glb(SCHOOL, PALETTE, SIGNS, lambda builder: build(builder, sys.modules[__name__]))
