"""Generalized OSM/Overture model for guilin_middle."""
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


if __name__ == '__main__':
    export_school_glb(SCHOOL, PALETTE, SIGNS, lambda builder: build(builder, sys.modules[__name__]))
