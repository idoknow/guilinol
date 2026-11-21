"""Guilin Kuiguang School (way/253811717) full campus restoration.

Sources verified against November 2026 Esri z19 satellite, OSM (way/253811717,
way/701820464, way/683033673, way/683033672, way/683033678, way/692355780,
way/683033674..676, way/683033677, way/683033679..682, way/691002264, way/691456683),
and Rock walk photos (IMG_1295..1298):
- B1 (way/683033673): 5F white gridded tile building with cobalt blue
  sawtooth parapet trim, central LED board, and open balcony corridors (Rock IMG_1297/1298).
- B2 (way/683033672): 4F building north of the sports ground.
- B3 (way/683033678): 4F building on the south edge.
- B4 (way/692355780): 4F building on the southwest boundary.
- B5 & B6 (way/683033674, way/683033676): 4F blocks on east edge.
- B7 (way/683033675): 3F auxiliary building.
- B8 (way/701820464): 5F coral-pink street-front building (Rock IMG_1295).
- B9 (way/683033677): 2F street-front building.
- 4 emerald courts (way/683033679..682) + volleyball pitch (way/691456683)
  + running area (way/691002264).
- Longzhu Road through-building gateway portal with closed retractable iron gate,
  twin hedges & mature camphor avenue, flagpole plaza in front of B1.
  Strictly K-12 compliant (0 guardhouse, 0 turnstiles, 0 CCTV, closed gates).
"""
import math
import sys
from pathlib import Path

# Add landmarks and pipeline to path
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from school_kit import SchoolBuilder, export_school_glb, mrr_stats

PALETTE = {
    'wall_main':   '#eeede7',  # white gridded exterior tile (B1, Rock IMG_1297/1298)
    'wall_sub':    '#4c6a58',  # sage green trim
    'wall_accent': '#1e4d8c',  # cobalt blue sawtooth parapet edge & trim (Rock IMG_1298)
    'wall_base':   '#9e4d3c',  # terracotta red brick base (Rock IMG_1297)
    'win_frame':   '#36454f',  # charcoal window frames
    'win_trim':    '#f3eee4',
    'base_frame':  '#8b8f92',
    'base_trim':   '#5b3e31',
    'pave_grey':   '#c9c4ba',  # bluestone paver
    'pave_road':   '#9e9a92',  # asphalt road
    'pave_dark':   '#594d47',
    'granite':     '#b2afa6',
    'roof_tile':   '#6e747d',
    'roof_blue':   '#1e4d8c',
    'roof_red':    '#9e483c',
    'track_red':   '#b55042',  # red rubber running surface
    'turf_a':      '#498845',  # green grass
    'turf_b':      '#3d7438',
    'court_a':     '#438e5e',  # emerald green courts
    'court_b':     '#3b6da4',
    'cinnabar':    '#c85845',  # court key & red banner
    'yellow':      '#dfb648',
    'cream':       '#d4998f',  # coral-pink street-front building (Rock IMG_1295/1296)
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

# Campus perimeter (OSM way/253811717 relative to anchor -1302.50, -167.63)
# Tucked inward at northeast corner (-16.0, 42.5) to clear sidewalk
PERIM = [
    (-115.0, -79.76), (-123.96, -57.52), (-153.23, -69.17), (-174.46, -16.5),
    (-123.86, 3.61), (-128.64, 15.48), (-43.39, 49.36), (-37.61, 35.0),
    (-16.0, 42.5), (-10.11, 32.12), (-5.81, 21.44), (-24.75, 13.92),
    (-10.01, -22.7), (-30.88, -30.99), (-25.54, -44.22), (-115.0, -79.76)
]

# Exact building rings (Note: way/683033674 and way/683033676 belong to adjacent guangxi_arts landmark)
RING_B1 = [(-168.34, -28.89), (-157.16, -53.72), (-146.29, -48.89), (-157.48, -24.06)]
RING_B2 = [(-89.89, 17.0), (-92.91, 25.14), (-125.98, 13.01), (-122.96, 4.87)]
RING_B3 = [(-88.9, -37.47), (-58.88, -26.02), (-61.78, -18.51), (-91.8, -29.96)]
RING_B4 = [(-142.66, -59.56), (-145.43, -51.98), (-109.08, -37.2), (-106.31, -44.76)]
RING_B5 = [(-55.42, -51.82), (-30.01, -43.05), (-32.14, -37.0), (-57.53, -45.77)]

# Frontage building way/701820464: safely trimmed on east edge by 0.8m to prevent sidewalk collision
RING_B6 = [(-1.2, -17.21), (-14.6, 13.82), (-0.46, 19.86), (11.5, -13.2), (6.17, -19.27), (4.27, -14.88)]
RING_B7 = [(-51.51, -34.82), (-12.87, -21.52), (-19.35, -2.98), (-57.99, -16.28)]

# Sports Courts (OSM way/683033679..682)
COURTS = [
    [(-129.95, -35.68), (-140.72, -8.33), (-154.08, -13.52), (-143.31, -40.86)],
    [(-114.83, -29.7), (-125.6, -2.36), (-138.97, -7.56), (-128.19, -34.9)],
    [(-99.91, -24.01), (-110.68, 3.34), (-124.05, -1.85), (-113.28, -29.2)],
    [(-84.9, -18.39), (-95.67, 8.95), (-109.03, 3.76), (-98.27, -23.59)],
]
RING_VOLLEY = [(-83.2, -12.59), (-89.41, 3.24), (-72.4, 9.94), (-65.93, -5.89)]
RING_RUNNING = [
    (-69.22, -18.22), (-60.84, -11.21), (-60.84, -2.88), (-65.61, 11.14),
    (-73.66, 17.18), (-83.67, 16.53), (-90.25, 11.14), (-91.73, 3.15),
    (-85.31, -13.16), (-78.58, -17.89)
]


def build_kuiguang(b: SchoolBuilder):
    # 1. Ground Slab
    b.ground_slab(PERIM, region='pave_grey', lift=0.03)

    # 2. Buildings (B1..B9)
    # B1 (way/683033673, 5F, white tile + blue sawtooth parapet, Rock IMG_1297/1298)
    b.footprint_building(
        RING_B1,
        bid='B1_main',
        source_id='way/683033673',
        floors=5,
        floor_h=3.55,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )
    # B2 (way/683033672, 4F)
    b.footprint_building(
        RING_B2,
        bid='B2_north',
        source_id='way/683033672',
        floors=4,
        floor_h=3.45,
        roof='flat_rail',
        wall_reg='white',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B3 (way/683033678, 4F)
    b.footprint_building(
        RING_B3,
        bid='B3_south',
        source_id='way/683033678',
        floors=4,
        floor_h=3.45,
        roof='flat_rail',
        wall_reg='white',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B4 (way/692355780, 4F)
    b.footprint_building(
        RING_B4,
        bid='B4_sw',
        source_id='way/692355780',
        floors=4,
        floor_h=3.45,
        roof='flat_rail',
        wall_reg='white',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B5 (way/683033675, 3F)
    b.footprint_building(
        RING_B5,
        bid='B5_aux',
        source_id='way/683033675',
        floors=3,
        floor_h=3.35,
        roof='flat_rail',
        wall_reg='white',
        base_reg='wall_base',
    )

    # B6 (way/701820464, 5F, coral-pink facade, Rock IMG_1295)
    b.footprint_building(
        RING_B6,
        bid='B6_front',
        source_id='way/701820464',
        floors=5,
        floor_h=3.45,
        roof='flat_rail',
        wall_reg='cream',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B7 (way/683033677, 2F)
    b.footprint_building(
        RING_B7,
        bid='B7_annex',
        source_id='way/683033677',
        floors=2,
        floor_h=3.35,
        roof='flat_rail',
        wall_reg='wall_base',
        base_reg='wall_base',
    )

    # 3. Sports Courts (4 standard emerald courts)
    for c_ring in COURTS:
        b.ground_slab(c_ring, region='court_a', lift=0.035, edge_drop=0.02)
        ccx, ccz, cw, cd, cang = mrr_stats(c_ring)
        b.basketball_court(ccx, ccz, yaw=math.radians(cang), w=cw, d=cd,
                           surface='court_a', apron='court_a', key_reg='cinnabar')

    # Volleyball court
    b.ground_slab(RING_VOLLEY, region='court_b', lift=0.035, edge_drop=0.02)

    # Running Area (OSM way/691002264, exact non-scaled slab, 0 overlap with courts)
    b.ground_slab(RING_RUNNING, region='track_red', lift=0.035, edge_drop=0.02)

    # 4. Campus Avenue, Hedges and Landscaping (Rock IMG_1295..1298)
    b.path_strip((-7.96, 26.78), (-150.0, -36.5), width=5.6, region='pave_road')
    b.path_strip((-80.0, -5.0), (-80.0, -50.0), width=4.2, region='pave_road')
    b.path_strip((-115.0, -10.0), (-115.0, -60.0), width=4.2, region='pave_road')

    # Flagpole plaza in front of B1
    b.flagpole_plaza(-142.0, -38.0, yaw=math.radians(24.3), poles=3)

    # Flanking trimmed hedges along the central avenue (Rock IMG_1297)
    ca, sa = math.cos(-1.147), math.sin(-1.147)
    for az_loc in (-15.0, -35.0, -55.0, -75.0, -95.0):
        for side_x in (4.2, -4.2):
            wx = -28.7 + side_x * ca - az_loc * sa
            wz = 6.73 + side_x * sa + az_loc * ca
            b.green_bed(wx, wz, w=1.6, d=8.5, yaw=-1.147, trees=0)

    # Mature campus camphor trees (Rock IMG_1295..1298)
    avenue_trees = [
        (-18.0, 18.0, 'camphor', 1.05), (-15.0, 30.0, 'camphor', 1.0),
        (-38.0, 12.0, 'camphor', 1.0), (-42.0, -2.0, 'camphor', 0.95),
        (-60.0, 6.0, 'banyan', 1.1), (-64.0, -8.0, 'camphor', 1.0),
        (-82.0, -1.0, 'osmanthus', 0.9), (-86.0, -15.0, 'camphor', 1.0),
        (-104.0, -8.0, 'camphor', 1.0), (-108.0, -22.0, 'bischofia', 0.95),
        (-128.0, -16.0, 'camphor', 1.02), (-132.0, -30.0, 'camphor', 0.98),
        # North courtyard gardens
        (-105.0, 32.0, 'camphor', 1.0), (-115.0, 24.0, 'banyan', 1.05),
        (-75.0, 36.0, 'osmanthus', 0.92), (-55.0, 38.0, 'camphor', 0.95),
        # South trees
        (-75.0, -42.0, 'camphor', 0.95), (-100.0, -48.0, 'osmanthus', 0.9),
    ]
    for tx, tz, sp, sc in avenue_trees:
        b.tree(tx, tz, species=sp, scale=sc, yaw=(tx * 0.43 + tz * 0.19) % math.tau)

    # 5. Entrance Gate & Boundary Fence (Rock IMG_1295/1296)
    # Closed gate on Longzhu Road through-building portal
    gx, gz = (-10.11 + -5.81) * 0.5, (32.12 + 21.44) * 0.5
    gy = b.ground(gx, gz)
    gate_w = 6.8
    gate_yaw = -1.147
    old_p = b.pose
    b.pose = (gx, 0.0, gz, gate_yaw)
    b.retractable_gate(gate_w, gate_h=2.0, y0=gy, iron_grille=True)
    b.pose = old_p

    # Perimeter fence along boundary (skip edges 0, 13, 14 shared with guangxi_arts buildings)
    b.perimeter_fence(PERIM, gate_edge=9, gate_t0=0.0, gate_t1=1.0, skip_edges={0, 13, 14})


if __name__ == '__main__':
    export_school_glb('kuiguang_school', PALETTE, SIGNS, build_kuiguang)

