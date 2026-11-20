"""Guilin Minzhu Primary School (way/970311799) full campus interior restoration.

Centennial elementary school located in Xiangshan District near Minzhu Road and Wanshou Lane.

Sources verified against November 2026 satellite, OSM (way/970311799),
and Overture building footprints:
- B1 (98dc0dcd-eab5-41b5-96bc-8593cd3a2546): 5F southeast main building (377.2 m²).
- B2 (e52c2561-b679-40c6-a84d-022cab694a44): 4F northwest building (161.9 m²).
- B3 (2a8ab93a-f68f-431e-bd65-04e6a3d9feb9): 3F connecting link annex (40.4 m²).
- Central sports playground with standard basketball court and rubber sprint track.
- Northeast entrance gate facing Wanshou Lane with closed iron gate.
- Flagpole plaza, camphor trees, and perimeter fence.
- Strictly K-12 compliant (0 guardhouse, 0 turnstiles, 0 CCTV, closed exterior gates).
"""
import math
import sys
from pathlib import Path

# Add landmarks and pipeline to path
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from school_kit import SchoolBuilder, export_school_glb

PALETTE = {
    'wall_main':   '#eeede7',  # warm cream white tile
    'wall_sub':    '#4c6a58',  # sage green trim
    'wall_accent': '#1e4d8c',  # cobalt blue trim
    'wall_base':   '#9e4d3c',  # terracotta red dado base
    'win_frame':   '#36454f',  # charcoal window frames
    'win_trim':    '#f3eee4',
    'base_frame':  '#8b8f92',
    'base_trim':   '#5b3e31',
    'pave_grey':   '#c9c4ba',  # granite paver
    'pave_road':   '#9e9a92',  # asphalt road
    'pave_dark':   '#594d47',
    'granite':     '#b2afa6',
    'roof_tile':   '#6e747d',
    'roof_blue':   '#1e4d8c',
    'roof_red':    '#9e483c',
    'track_red':   '#b55042',  # red rubber running track
    'turf_a':      '#498845',  # green soccer pitch
    'turf_b':      '#3d7438',
    'court_a':     '#438e5e',  # emerald green basketball courts
    'court_b':     '#3b6da4',
    'cinnabar':    '#c85845',  # basketball key & red banner
    'yellow':      '#dfb648',
    'cream':       '#f2ece1',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '桂林市民主小学',
    'school_en':   'Guilin Minzhu Primary School',
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

# Campus perimeter (OSM way/970311799 relative to centroid -1247.04, 1179.68)
PERIM = [
    (-14.42, -45.18),
    (-38.65, 26.14),
    (14.21, 45.87),
    (38.54, -27.16),
    (-14.42, -45.18)
]

# Building footprints relative to anchor
RING_B1 = [(-7.59, -42.8), (-10.68, -34.36), (28.74, -19.96), (31.83, -28.39)]
RING_B2 = [(-5.41, 29.22), (-20.21, 18.99), (-25.33, 26.39), (-10.53, 36.61)]
RING_B3 = [(-7.92, 32.01), (2.1, 41.05), (4.11, 38.83), (-5.91, 29.79)]


def build_minzhu_primary(b: SchoolBuilder):
    # 1. Ground Slab (terrain following Delaunay triangulated paver)
    b.ground_slab(PERIM, region='pave_grey', lift=0.03)

    # 2. Main Buildings
    # B1 (98dc0dcd-eab5-41b5-96bc-8593cd3a2546, 5F, 377.2 m²)
    b.footprint_building(
        RING_B1,
        bid='B1_main',
        source_id='98dc0dcd-eab5-41b5-96bc-8593cd3a2546',
        floors=5,
        floor_h=3.4,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B2 (e52c2561-b679-40c6-a84d-022cab694a44, 4F, 161.9 m²)
    b.footprint_building(
        RING_B2,
        bid='B2_nw',
        source_id='e52c2561-b679-40c6-a84d-022cab694a44',
        floors=4,
        floor_h=3.4,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B3 (2a8ab93a-f68f-431e-bd65-04e6a3d9feb9, 3F, 40.4 m²)
    b.footprint_building(
        RING_B3,
        bid='B3_link',
        source_id='2a8ab93a-f68f-431e-bd65-04e6a3d9feb9',
        floors=3,
        floor_h=3.4,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # 3. Central Sports Ground
    yaw_court = -math.atan2(14.40, 39.42)
    b.basketball_court(cx=2.0, cz=0.0, yaw=yaw_court, w=28.0, d=15.0)

    # 45m Straight Sprint Track (3 lanes, red rubber) along western edge
    gy_track = b.ground(-16.0, 5.0)
    old_track_pose = b.pose
    b.pose = (-16.0, 0.0, 5.0, yaw_court + math.pi * 0.5)
    b.box(0.0, gy_track + 0.02, 0.0, 45.0, 0.03, 4.2, 'track_red', cap_region='track_red')
    b.pose = old_track_pose

    # 4. Central Courtyard Flagpole Plaza
    b.flagpole_plaza(cx=-8.0, cz=-15.0, yaw=yaw_court, poles=3)

    # 5. Grand Entrance Gate on Northeast Edge (facing Wanshou Lane)
    gate_cx = 6.0
    gate_cz = 42.8
    gate_yaw = -math.atan2(19.73, 52.86)
    gy_gate = b.ground(gate_cx, gate_cz)

    old_gate_pose = b.pose
    b.pose = (gate_cx, 0.0, gate_cz, gate_yaw)
    pillar_w = 0.8
    pillar_d = 0.8
    pillar_h = 3.8
    span = 7.6
    half_span = span * 0.5

    for sgn in (-1.0, 1.0):
        px = sgn * half_span
        b.box(px, gy_gate - 0.15, 0.0, pillar_w, pillar_h + 0.15, pillar_d, 'granite', cap_region='granite', collide=True)

    gate_w = span - pillar_w
    b.retractable_gate(gate_w, gate_h=2.0, y0=gy_gate, iron_grille=True)
    b.pose = old_gate_pose

    # 6. Mature Camphor Trees & Landscaping
    trees = [
        (-28.0, 18.0), (-32.0, 5.0), (-30.0, -10.0), (-25.0, -25.0),
        (22.0, -2.0), (28.0, 12.0), (24.0, 24.0),
        (-2.0, 24.0), (-12.0, -2.0), (12.0, -12.0),
    ]
    for tx, tz in trees:
        b.tree(tx, tz, species='camphor', scale=1.0, planter=False)

    # 7. Perimeter Enclosure
    b.perimeter_fence(PERIM, gate_edge=1, gate_t0=0.75, gate_t1=0.92)


if __name__ == '__main__':
    export_school_glb('minzhu_primary', PALETTE, SIGNS, build_minzhu_primary)
