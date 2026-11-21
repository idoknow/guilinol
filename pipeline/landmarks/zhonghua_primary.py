"""Guilin Zhonghua Primary School (way/1531318258) full campus interior restoration.

Centennial elementary school founded in 1905 on Zhonghua Road in the historic core of Guilin.

Sources verified against November 2026 satellite, OSM (way/1531318258,
way/1554170680), and Overture building footprints:
- B1 (2048ed26-fa86-4e34-8959-9b0b2e253237): 5F C-shaped east main building (3080.0 m²).
- B2 (608f802c-5541-4c52-9c03-5f3f8bcc362a): 2F equipment link annex (27.0 m²).
- Standard emerald basketball court (way/1554170680, 432.4 m²).
- Central courtyard athletic activity ground & sprint lanes.
- East entrance gate on Zhonghua Road with closed iron gate.
- Flagpole plaza, mature camphor tree avenue, and perimeter enclosure.
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
    'school_name': '桂林市中华小学',
    'school_en':   'Guilin Zhonghua Primary School',
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

# Campus perimeter (OSM way/1531318258 relative to centroid -309.79, -400.63)
# East edge stepped back 1.5m along Zhonghua Road to eliminate carriageway overlap
PERIM = [
    (-36.0, 48.19), (-13.2, 53.37), (-4.21, 55.41), (-3.13, 43.88),
    (9.02, 32.22), (18.2, 34.63), (21.3, 31.01), (31.5, 32.81),
    (35.5, 9.04), (37.8, -6.87), (28.8, -9.14), (30.9, -28.56),
    (29.6, -45.29), (-19.18, -52.29), (-28.77, -3.85), (-31.47, -4.33),
    (-33.49, 7.04), (-36.0, 48.19)
]

# Building footprints relative to anchor
RING_B1 = [
    (35.5, 9.04), (37.8, -6.87), (28.8, -9.14), (30.9, -28.56),
    (29.6, -45.29), (-19.18, -52.29), (-28.77, -3.85), (-31.47, -4.33),
    (-33.49, 7.04), (-28.3, 7.94), (-26.29, -3.35), (-9.91, -0.47),
    (-10.46, 2.67), (8.47, 6.0), (9.04, 2.86), (24.5, 5.58), (24.21, 7.15)
]

RING_B2 = [
    (35.0, 21.16), (35.2, 12.18), (32.5, 12.1), (32.3, 21.08)
]


def build_zhonghua_primary(b: SchoolBuilder):
    # 1. Ground Slab (terrain following Delaunay triangulated paver)
    b.ground_slab(PERIM, region='pave_grey', lift=0.03)

    # 2. Main Buildings
    # B1 (2048ed26-fa86-4e34-8959-9b0b2e253237, 5F, 3080.0 m²)
    b.footprint_building(
        RING_B1,
        bid='B1_main',
        source_id='2048ed26-fa86-4e34-8959-9b0b2e253237',
        floors=5,
        floor_h=3.4,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B2 (608f802c-5541-4c52-9c03-5f3f8bcc362a, 2F, 27.0 m²)
    b.footprint_building(
        RING_B2,
        bid='B2_link',
        source_id='608f802c-5541-4c52-9c03-5f3f8bcc362a',
        floors=2,
        floor_h=3.4,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # 3. Sports Ground
    # Basketball Court (way/1554170680, centroid (-13.86, 27.24))
    yaw_court = -math.atan2(27.93, -4.76) + math.pi * 0.5
    b.basketball_court(cx=-13.86, cz=27.24, yaw=yaw_court, w=28.0, d=15.0)

    # 45m Sprint Lanes (red rubber) in courtyard
    gy_track = b.ground(6.0, 18.0)
    old_track_pose = b.pose
    b.pose = (6.0, 0.0, 18.0, yaw_court)
    b.box(0.0, gy_track + 0.02, 0.0, 45.0, 0.03, 4.0, 'track_red', cap_region='track_red')
    b.pose = old_track_pose

    # 4. Central Courtyard Flagpole Plaza
    b.flagpole_plaza(cx=-3.0, cz=10.0, yaw=0.0, poles=3)

    # 5. Grand Entrance Gate on Zhonghua Road
    gate_cx = 26.0
    gate_cz = 32.0
    gate_yaw = -math.atan2(1.8, 11.5)
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
        (-25.0, 42.0), (-32.0, 30.0), (-32.0, 18.0),
        (18.0, 22.0), (22.0, 14.0),
        (-2.0, 36.0), (4.0, 28.0),
        (-18.0, 4.0), (-6.0, 4.0),
    ]
    for tx, tz in trees:
        b.tree(tx, tz, species='camphor', scale=1.0, planter=False)

    # 7. Perimeter Enclosure
    b.perimeter_fence(PERIM, gate_edge=7, gate_t0=0.35, gate_t1=0.75)


if __name__ == '__main__':
    export_school_glb('zhonghua_primary', PALETTE, SIGNS, build_zhonghua_primary)
