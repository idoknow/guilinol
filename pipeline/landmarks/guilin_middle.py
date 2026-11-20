"""Guilin Middle School (guilin_middle, OSM way/253811718) campus interior restoration.

Anchored at 1893 Kuiguang Lou (way/690980799, local (0, 0)), ground datum 158.4 m.
Covers:
- Historic 1893 Kuiguang Lou (way/690980799): 2F grey-brick hall with stepped horse-head fire
  gables, pitched tile roof, and vermilion wooden gallery on SSW front (Rock IMG_1378).
- Street-facing grand gate on Jiefang West Rd (Rock IMG_1373): granite columns, green glazed
  tile eave, closed iron gate (strictly 0 guardhouse, 0 turnstiles, 0 CCTV per K-12 boundary).
- B1..B11 building blocks with non-functional orientation naming.
- Western athletic field: 250m running track with turf soccer pitch (way/221349775)
  and 4 standard basketball courts (way/682942538, way/682942541, way/682942543, way/1350892045).
- Campus avenues, camphor tree corridors, courtyard flagpole plaza, and perimeter enclosure.
"""
import math
import sys
from pathlib import Path
import numpy as np

# Add landmarks and pipeline to path
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from school_kit import SchoolBuilder, export_school_glb, mrr_stats

PALETTE = {
    'wall_main':   '#eeede7',  # white exterior ceramic tiles
    'wall_sub':    '#4c6a58',  # sage green trim
    'wall_accent': '#1e4d8c',  # slate/cobalt blue trim
    'wall_base':   '#9e4d3c',  # terracotta red brick base
    'pave_grey':   '#c9c4ba',  # granite pavers
    'pave_road':   '#9e9a92',  # asphalt campus road
    'pave_dark':   '#6e747d',  # Kuiguang Lou grey brick & dark paving
    'granite':     '#83878c',  # granite gate piers & curbs
    'roof_tile':   '#353b40',  # dark grey tile
    'roof_blue':   '#2a527a',  # vaulted roof accent
    'roof_red':    '#a8322c',
    'white':       '#f3eee4',  # white walls
    'steel':       '#c8ccd0',  # metal gates & poles
    'glass':       '#384752',  # ribbon & curtain glazing
    'track_red':   '#b55042',  # red rubber running track
    'turf_a':      '#498845',  # green soccer pitch
    'turf_b':      '#3d7438',
    'court_a':     '#3e7856',  # emerald green basketball court
    'court_b':     '#3b6da4',  # slate blue court apron
    'cinnabar':    '#a8322c',  # cinnabar red gallery
    'yellow':      '#dfb648',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '桂林市桂林中学',
    'school_en':   'Guilin Middle School',
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

# Campus perimeter (OSM way/253811718 relative to anchor (-1243.77, -284.35))
PERIM = [
    (-67.78, -137.97), (-80.66, -144.09), (-131.46, -48.57), (-99.11, -31.51),
    (-7.52, 17.8), (71.6, 33.96), (91.9, -13.95), (78.41, -20.11),
    (99.59, -70.3), (72.24, -81.83), (100.11, -149.28), (75.86, -159.64),
    (53.72, -121.14), (39.29, -119.44), (-8.9, -142.77), (-17.26, -125.23),
    (-64.07, -145.45), (-67.78, -137.97)
]

# Exact Building Rings (all 100% inside PERIM)
RING_B1 = [(-3.52, -7.78), (-8.23, 2.39), (-2.65, 5.07), (3.23, 7.89), (8.36, -2.49)]
RING_B2 = [(60.44, 13.23), (64.56, 2.91), (68.86, -7.87), (46.42, -16.48), (42.60, -6.48), (36.78, 8.61)]
RING_B3 = [(-52.71, -13.7), (-25.7, -66.32), (2.16, -52.2), (-24.86, 0.42)]
RING_B4 = [
    (38.83, -83.37), (34.83, -74.41), (-2.04, -90.65), (-2.45, -89.71),
    (-5.34, -90.98), (-2.14, -98.16), (1.04, -96.76), (2.26, -99.48),
    (24.22, -89.8), (25.22, -92.04), (31.03, -89.48), (30.03, -87.25)
]
RING_B5 = [(2.4, -131.79), (36.93, -116.83), (33.23, -108.4), (30.42, -109.62), (27.66, -103.35), (-4.05, -117.09)]
RING_B6 = [(84.61, -43.79), (80.29, -33.99), (46.04, -48.88), (50.36, -58.68)]
RING_B7 = [(91.76, -72.76), (87.22, -62.01), (58.61, -73.96), (63.16, -84.7)]
RING_B8 = [(75.69, 18.94), (43.34, 12.48), (41.87, 19.82), (74.22, 26.28)]
RING_B9 = [(61.87, 10.16), (70.13, 13.73), (74.9, 2.74), (66.64, -0.83)]
RING_B10 = [(65.1, -107.02), (60.72, -97.48), (70.27, -93.12), (74.65, -102.64)]
RING_B11 = [(81.23, 1.44), (85.5, 1.72), (85.5, -10.23), (82.01, -10.53)]

# 4 Standard Basketball Courts (OSM way/682942538, way/682942541, way/682942543, way/1350892045)
BASKETBALL_COURTS = [
    (-84.32, -115.24, 61.90),
    (-100.66, -87.15, 61.91),
    (-115.71, -58.79, 61.90),
    (-16.34, -88.09, 61.91),
]


def build_guilin_middle(b: SchoolBuilder):
    # 1. Campus Ground Surface
    b.ground_slab(PERIM, region='pave_grey', lift=0.03)

    # 2. Main Entrance Gate & North Roadway on Jiefang West Rd (Rock IMG_1373)
    gy_gate = b.ground(12.8, 25.4)
    old = b.pose
    b.pose = (12.8, 0.0, 25.4, 0.0)
    # Granite portal columns & eave
    b.box(-4.6, gy_gate, 0.0, 1.1, 4.8, 1.1, 'granite', collide=True)
    b.box(4.6, gy_gate, 0.0, 1.1, 4.8, 1.1, 'granite', collide=True)
    b.box(0.0, gy_gate + 4.3, 0.0, 10.3, 0.6, 1.4, 'roof_tile', collide=True)
    # Closed iron gate
    b.retractable_gate(8.0, gate_h=2.2, y0=gy_gate, iron_grille=True)
    b.pose = old

    # Campus avenues
    b.path_strip((12.8, 25.4), (12.8, -35.0), width=7.2, region='pave_road')
    b.path_strip((12.8, -35.0), (-61.6, -78.6), width=5.6, region='pave_road')
    b.path_strip((12.8, -35.0), (60.0, -45.0), width=5.0, region='pave_road')

    # 3. B1: Historic Kuiguang Lou (way/690980799, Rock IMG_1378)
    b.footprint_building(
        RING_B1,
        bid='B1_south',
        source_id='way/690980799',
        floors=2,
        floor_h=3.6,
        roof='hip_gable',
        wall_reg='pave_dark',
        base_reg='pave_dark',
        parapet_reg='cinnabar',
    )

    # 4. B2: East Main Building (f97d45ef, 6F)
    b.footprint_building(
        RING_B2,
        bid='B2_east',
        source_id='f97d45ef-6943-4e73-8c4b-672340a7b8a7',
        floors=6,
        floor_h=3.5,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # 5. B3: West Hall (way/682942537 / OVT 57b01ab4, 4F)
    b.footprint_building(
        RING_B3,
        bid='B3_west',
        source_id='way/682942537',
        floors=4,
        floor_h=3.6,
        roof='flat_rail',
        wall_reg='white',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )
    # Arched vault structure atop B3
    rcx, rcz, rw, rd, rang = mrr_stats(RING_B3)
    gy_base = b.ground(rcx, rcz)
    b.pose = (rcx, gy_base, rcz, math.radians(rang))
    b.box(0.0, 14.4, 0.0, rw * 0.92, 2.8, rd * 0.92, 'roof_blue')
    b.pose = (0.0, 0.0, 0.0, 0.0)

    # 6. B4: Central-East Building (way/682942536, 5F)
    b.footprint_building(
        RING_B4,
        bid='B4_mid_east',
        source_id='way/682942536',
        floors=5,
        floor_h=3.45,
        roof='flat_rail',
        wall_reg='white',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # 7. B5: Central-North Building (way/683033683, 5F)
    b.footprint_building(
        RING_B5,
        bid='B5_mid_north',
        source_id='way/683033683',
        floors=5,
        floor_h=3.45,
        roof='flat_rail',
        wall_reg='white',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # 8. B6: East 1st Building (way/682942535, 5F)
    b.footprint_building(
        RING_B6,
        bid='B6_east1',
        source_id='way/682942535',
        floors=5,
        floor_h=3.45,
        roof='flat_rail',
        wall_reg='white',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # 9. B7: East 2nd Building (way/682942534, 5F)
    b.footprint_building(
        RING_B7,
        bid='B7_east2',
        source_id='way/682942534',
        floors=5,
        floor_h=3.45,
        roof='flat_rail',
        wall_reg='white',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # 10. B8: Southeast Annex (2c0786a8, 3F)
    b.footprint_building(
        RING_B8,
        bid='B8_annex_se',
        source_id='2c0786a8-316f-4b14-a011-0bcfe23ec27e',
        floors=3,
        floor_h=3.35,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
    )

    # 11. B9: Northeast Annex (72d24742, 4F)
    b.footprint_building(
        RING_B9,
        bid='B9_annex_ne',
        source_id='72d24742-818c-4954-8a15-ceff8e95e9c8',
        floors=4,
        floor_h=3.35,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
    )

    # 12. B10: Annex (a1feace1, 2F)
    b.footprint_building(
        RING_B10,
        bid='B10_annex',
        source_id='a1feace1-6a08-44d0-ba70-99390d1b14a4',
        floors=2,
        floor_h=3.3,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
    )

    # 13. B11: East Gate Pavilion (ba39af2f, 1F)
    b.footprint_building(
        RING_B11,
        bid='B11_gate_pavilion',
        source_id='ba39af2f-b7b6-4a01-a907-790fc605a125',
        floors=1,
        floor_h=3.3,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
    )

    # 14. Western Sports Field: 250m Running Track with Soccer Pitch (way/221349775)
    b.running_track(
        cx=-61.57,
        cz=-78.61,
        length=68.0,
        width=42.0,
        yaw=math.radians(-26.85),
        track_reg='track_red',
        infield_mode='soccer',
    )

    # 15. 4 Standard Basketball Courts (OSM way/682942538, 541, 543, 1350892045)
    for cx, cz, yaw_deg in BASKETBALL_COURTS:
        b.basketball_court(cx=cx, cz=cz, yaw=math.radians(yaw_deg), w=28.33, d=14.40)

    # 16. Central Courtyard Flagpole Plaza (Rock IMG_1378)
    b.flagpole_plaza(cx=15.0, cz=-55.0, yaw=0.0, poles=3)

    # 17. Camphor Tree Avenues & Courtyard Landscaping (Rock IMG_1378)
    for tx, tz in [
        (11.4, 7.8), (12.2, -2.0), (13.0, -12.0), (13.8, -22.0),
        (22.2, 11.0), (23.2, 0.5), (24.2, -10.5), (25.2, -21.5),
        (-1.2, 23.8), (27.5, 25.5),
    ]:
        b.tree(tx, tz, species='camphor', scale=1.1, planter=True)

    courtyard_trees = [
        (-4.0, -4.0), (-12.0, -18.0), (4.0, -40.0), (28.0, -40.0),
        (48.0, -32.0), (52.0, -68.0), (50.0, -90.0),
        (-35.0, -85.0), (-68.0, -32.0), (-88.0, -42.0),
        (-65.0, -140.0), (10.0, -145.0), (32.0, -140.0)
    ]
    for tx, tz in courtyard_trees:
        b.tree(tx, tz, species='camphor', scale=0.95, planter=False)

    # 18. Perimeter Enclosure
    b.perimeter_fence(PERIM, gate_edge=4, gate_t0=0.35, gate_t1=0.65)


if __name__ == '__main__':
    export_school_glb('guilin_middle', PALETTE, SIGNS, build_guilin_middle)
