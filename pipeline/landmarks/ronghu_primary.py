"""Guilin Ronghu Primary School (way/686230935) full campus interior restoration.

Centennial elementary school founded in 1905 on the north bank of Ronghu Lake.

Sources verified against November 2026 satellite, OSM (way/686230935,
way/701820455, way/701820456, way/701820457), and Overture building footprints:
- B1 (79568dcd-14fe-46b2-aa79-7caad830f19d): 5F north building (745 m²).
- B2 (a51a05fd-8fbb-44da-ac6b-3d53cefe907e): 4F north-central building (215.7 m²).
- B3 (e1315567-aac9-4f51-83cf-d06deb85a916): 4F east building (270.2 m²).
- B4 (7a33574a-3274-471a-9f9b-8ae8e062f0da): 2F connecting link building (89.7 m²).
- B5 (10066d18-451b-49da-bc2b-c54fd156abfa): 3F central building (146 m²).
- B6 (193caf84-2a3c-4949-9cf0-55bed91edc2d): 3F south street-front building (405.6 m²).
- B7 (c693ee13-ec1b-4e1c-a409-0ef415f03b50): 3F southeast building (161 m²).
- 3 emerald basketball courts (way/701820455, way/701820456, way/701820457).
- Flagpole plaza, camphor tree avenues, and perimeter enclosure.
- South grand entrance gate on Ronghu North Road with closed iron gate.
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
    'school_name': '桂林市榕湖小学',
    'school_en':   'Guilin Ronghu Primary School',
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

# Campus perimeter (OSM way/686230935 relative to anchor -1204.99, 162.71)
PERIM = [
    (-62.87, 28.69), (-4.97, 61.63), (9.22, 69.7), (31.51, 31.52),
    (57.6, -14.84), (64.13, -30.76), (-19.68, -65.74), (-39.43, -32.65),
    (-31.67, -22.7), (-62.87, 28.69)
]

# Building footprints relative to anchor
RING_B1 = [(8.28, 66.2), (18.31, 50.72), (-15.56, 28.84), (-25.59, 44.42)]
RING_B2 = [(-25.82, 26.93), (-19.46, 16.78), (-34.71, 7.24), (-41.08, 17.4)]
RING_B3 = [(-44.13, 36.2), (-37.31, 25.62), (-55.35, 14.07), (-62.17, 24.76)]
RING_B4 = [(-23.61, -5.8), (-10.26, 1.03), (-7.53, -4.3), (-20.88, -11.13)]
RING_B5 = [(-26.16, -26.13), (-21.23, -33.82), (-34.76, -42.53), (-39.58, -34.86)]
RING_B6 = [(24.27, -46.33), (27.79, -58.2), (-3.78, -67.61), (-7.39, -55.96)]
RING_B7 = [(35.96, 36.28), (45.19, 17.05), (38.38, 13.8), (29.15, 33.03)]

# Basketball courts (centroid x, centroid z, yaw)
COURTS = [
    (34.75, -20.76, -0.484),  # way/701820455
    (26.23, -5.55,  -0.484),  # way/701820456
    (18.17, 9.46,   -0.484),  # way/701820457
]


def build_ronghu_primary(b: SchoolBuilder):
    # 1. Ground Slab (terrain following Delaunay triangulated paver)
    b.ground_slab(PERIM, region='pave_grey', lift=0.03)

    # 2. Main Buildings
    # B1 (79568dcd-14fe-46b2-aa79-7caad830f19d, 5F, 745 m²)
    b.footprint_building(
        RING_B1,
        bid='B1_north',
        source_id='79568dcd-14fe-46b2-aa79-7caad830f19d',
        floors=5,
        floor_h=3.4,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B2 (a51a05fd-8fbb-44da-ac6b-3d53cefe907e, 4F, 215.7 m²)
    b.footprint_building(
        RING_B2,
        bid='B2_mid_north',
        source_id='a51a05fd-8fbb-44da-ac6b-3d53cefe907e',
        floors=4,
        floor_h=3.4,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B3 (e1315567-aac9-4f51-83cf-d06deb85a916, 4F, 270.2 m²)
    b.footprint_building(
        RING_B3,
        bid='B3_east',
        source_id='e1315567-aac9-4f51-83cf-d06deb85a916',
        floors=4,
        floor_h=3.4,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B4 (7a33574a-3274-471a-9f9b-8ae8e062f0da, 2F, 89.7 m²)
    b.footprint_building(
        RING_B4,
        bid='B4_link',
        source_id='7a33574a-3274-471a-9f9b-8ae8e062f0da',
        floors=2,
        floor_h=3.4,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B5 (10066d18-451b-49da-bc2b-c54fd156abfa, 3F, 146 m²)
    b.footprint_building(
        RING_B5,
        bid='B5_mid',
        source_id='10066d18-451b-49da-bc2b-c54fd156abfa',
        floors=3,
        floor_h=3.6,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B6 (193caf84-2a3c-4949-9cf0-55bed91edc2d, 3F, 405.6 m²)
    b.footprint_building(
        RING_B6,
        bid='B6_south',
        source_id='193caf84-2a3c-4949-9cf0-55bed91edc2d',
        floors=3,
        floor_h=3.4,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B7 (c693ee13-ec1b-4e1c-a409-0ef415f03b50, 3F, 161 m²)
    b.footprint_building(
        RING_B7,
        bid='B7_se',
        source_id='c693ee13-ec1b-4e1c-a409-0ef415f03b50',
        floors=3,
        floor_h=3.4,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # 3. Sports Ground
    # 3 Emerald Basketball Courts
    for cx, cz, yaw in COURTS:
        b.basketball_court(cx=cx, cz=cz, yaw=yaw, w=28.0, d=15.0)

    # 4. Central Courtyard Flagpole Plaza
    b.flagpole_plaza(cx=-12.0, cz=24.0, yaw=-0.484, poles=3)

    # 5. Grand South Entrance Gate on Ronghu North Road
    gate_cx = -12.0
    gate_cz = -61.5
    gate_yaw = -0.484
    gy = b.ground(gate_cx, gate_cz)

    old_gate_pose = b.pose
    b.pose = (gate_cx, 0.0, gate_cz, gate_yaw)
    pillar_w = 0.9
    pillar_d = 0.9
    pillar_h = 3.6
    span = 8.6
    half_span = span * 0.5

    for sgn in (-1.0, 1.0):
        px = sgn * half_span
        b.box(px, gy - 0.4, 0.0, pillar_w, pillar_h + 0.4, pillar_d, 'granite', cap_region='granite', collide=True)

    # Closed retractable iron entrance gate
    gate_w = span - pillar_w
    b.retractable_gate(gate_w, gate_h=2.0, y0=gy, iron_grille=True)
    b.pose = old_gate_pose

    # 6. Camphor Trees & Landscaping
    trees = [
        (-18.0, -52.0), (-18.0, -42.0), (-18.0, -32.0),
        (-6.0, -52.0), (-6.0, -42.0), (-6.0, -32.0),
        (-38.0, 0.0), (-35.0, -15.0), (-45.0, 5.0),
        (2.0, 38.0), (-12.0, 48.0), (12.0, 38.0),
        (48.0, 5.0), (52.0, -10.0), (38.0, -35.0),
    ]
    for tx, tz in trees:
        b.tree(tx, tz, species='camphor', scale=1.0, planter=False)

    # 7. Perimeter Enclosure
    b.perimeter_fence(PERIM, gate_edge=5, gate_t0=0.82, gate_t1=0.96)


if __name__ == '__main__':
    export_school_glb('ronghu_primary', PALETTE, SIGNS, build_ronghu_primary)
