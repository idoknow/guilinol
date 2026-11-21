"""Guilin Zhongshan Middle School Libin Campus / Guilin No. 9 Middle School
(桂林市中山中学漓滨校区, way/675588260 + gate at node/9214622462).

Full campus interior restoration:
- Uses SchoolBuilder from school_kit.py for unified LOD0/1/2, instancing, and terrain grounding.
- Authentic street-front gate position on the west side of Libin Road (`way/675174045`),
  facing ESE directly onto Libin Road with pylons, medallion, and closed iron grille.
- B1: 5F U-shaped main building (OSM way/683033662).
- B2: 4F south building (OSM way/683033663).
- 4 basketball courts (OSM way/683033664..667) with standard hoops and court lines.
- South 150m-200m running track with green soccer turf infield (OSM way/221996841).
- Central paved courtyard, camphor trees, and flagpole plaza.
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
    'wall_main':   '#eceae4',  # warm grey/white tile
    'wall_sub':    '#224c4e',  # deep teal trim
    'wall_accent': '#522a26',  # maroon accent
    'wall_base':   '#963c32',  # terracotta base dado
    'win_frame':   '#36454f',  # charcoal window frames
    'win_trim':    '#f3eee4',
    'base_frame':  '#8b8f92',
    'base_trim':   '#5b3e31',
    'pave_grey':   '#c8c4ba',  # granite paver
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
    'court_b':     '#3b6da4',  # blue basketball courts
    'cinnabar':    '#c85845',
    'yellow':      '#dfb648',
    'cream':       '#f2ece1',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '桂林市中山中学',
    'school_en':   'Guilin Zhongshan Middle School',
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

# Campus perimeter (OSM way/675588260 exact relative to origin -541.6056, 80.7419)
PERIM = [
    (-67.33, 69.71), (36.51, 87.43), (56.59, -17.84), (67.03, -72.53),
    (-37.25, -85.04), (-51.38, -12.52), (-67.33, 69.71)
]

# Exact building rings relative to origin
# B1 (way/683033662, 5F, north U-shape main building)
RING_B1 = [
    (49.91, -65.57), (48.38, -53.33), (-23.82, -62.21), (-26.50, -40.60),
    (-21.13, -39.95), (-23.55, -20.47), (-28.93, -21.13), (-32.42, 6.92),
    (-45.18, 5.35), (-35.20, -74.74), (36.20, -65.96), (37.21, -74.14),
    (46.46, -73.00), (45.61, -66.09)
]

# B2 (way/683033663, 4F, south building)
RING_B2 = [
    (39.82, -18.84), (38.62, -10.27), (12.80, -13.82), (12.01, -8.06),
    (-2.18, -10.02), (-1.39, -15.78), (-20.48, -18.41), (-19.30, -26.97)
]

# 4 basketball courts (OSM way/683033664..667)
COURTS = [
    [(-9.35, -3.24), (-15.05, 24.75), (-30.54, 21.63), (-24.84, -6.35)],  # way/683033664
    [(0.25, 27.81), (5.95, -0.17), (-9.35, -3.24), (-15.05, 24.75)],     # way/683033665
    [(5.95, -0.17), (22.12, 3.08), (16.43, 31.06), (0.25, 27.81)],      # way/683033667
    [(22.12, 3.08), (16.43, 31.06), (31.69, 34.12), (37.38, 6.15)],     # way/683033666
]

# South 150m-200m running track with infield (OSM way/221996841)
TRACK_OUTER = [
    (-30.33, 25.24), (-40.78, 25.62), (-50.17, 30.19), (-56.87, 38.15),
    (-59.74, 48.14), (-58.27, 58.42), (-52.73, 67.22), (-44.05, 73.01),
    (6.29, 82.77), (16.74, 82.40), (26.13, 77.83), (32.83, 69.87),
    (35.70, 59.89), (34.23, 49.60), (28.68, 40.80), (20.01, 35.01)
]
TRACK_INNER = [
    (18.03, 41.21), (24.81, 46.56), (28.32, 54.43), (27.74, 63.03),
    (23.21, 70.37), (15.76, 74.77), (7.11, 75.23), (-43.49, 65.87),
    (-50.27, 60.52), (-53.78, 52.64), (-53.20, 44.05), (-48.67, 36.72),
    (-41.22, 32.31), (-32.56, 31.84)
]


def mrr_stats(ring):
    xs = [p[0] for p in ring]
    zs = [p[1] for p in ring]
    cx = sum(xs) / len(xs)
    cz = sum(zs) / len(zs)
    dx = xs[1] - xs[0]
    dz = zs[1] - zs[0]
    d1 = math.hypot(dx, dz)
    dx2 = xs[2] - xs[1]
    dz2 = zs[2] - zs[1]
    d2 = math.hypot(dx2, dz2)
    ang = math.degrees(math.atan2(dz, dx))
    return cx, cz, max(d1, d2), min(d1, d2), ang


def build_libin_middle(b: SchoolBuilder):
    # 1. Ground Slab
    b.ground_slab(PERIM, region='pave_grey', lift=0.03)

    # 2. Buildings (B1..B2)
    # B1 (way/683033662, 5F, north U-shape main building, 17.25m)
    b.footprint_building(
        RING_B1,
        bid='B1_main',
        source_id='way/683033662',
        floors=5,
        floor_h=3.45,
        roof='flat_rail',
        wall_reg='wall_main',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # B2 (way/683033663, 4F, south building, 13.8m)
    b.footprint_building(
        RING_B2,
        bid='B2_south',
        source_id='way/683033663',
        floors=4,
        floor_h=3.45,
        roof='flat_rail',
        wall_reg='white',
        base_reg='wall_base',
        parapet_reg='wall_accent',
    )

    # 3. Sports Courts (4 standard courts per OSM way/683033664..667)
    for idx, c_ring in enumerate(COURTS):
        surf = 'court_a' if idx % 2 == 0 else 'court_b'
        b.ground_slab(c_ring, region=surf, lift=0.035, edge_drop=0.02)
        ccx, ccz, cw, cd, cang = mrr_stats(c_ring)
        b.basketball_court(ccx, ccz, yaw=math.radians(cang), w=cw, d=cd,
                           surface=surf, apron=surf, key_reg='cinnabar')

    # 4. South Running Track & Soccer Infield (OSM way/221996841)
    b.ground_slab(TRACK_OUTER, region='track_red', lift=0.035, edge_drop=0.02)
    b.ground_slab(TRACK_INNER, region='turf_a', lift=0.04, edge_drop=0.02)

    # 5. Connecting Paths, Avenues and Trees
    # Main path from campus to Libin road
    b.path_strip((-10.0, -20.0), (120.0, -12.0), width=6.0, region='pave_road')
    b.path_strip((-10.0, 5.0), (-10.0, -60.0), width=4.5, region='pave_road')
    b.path_strip((15.0, 5.0), (15.0, -60.0), width=4.0, region='pave_road')

    # Flagpole plaza in front of B1
    b.flagpole_plaza(8.0, -38.0, yaw=math.radians(15.0), poles=3)

    # Mature campus trees
    trees = [
        (-2.0, -32.0, 'camphor', 1.05), (18.0, -32.0, 'camphor', 1.0),
        (-2.0, -48.0, 'osmanthus', 0.95), (18.0, -48.0, 'banyan', 1.1),
        (35.0, -38.0, 'camphor', 1.0), (-25.0, -32.0, 'osmanthus', 0.9),
        (28.0, 32.0, 'camphor', 1.0), (42.0, 15.0, 'bischofia', 0.95),
        (-35.0, 18.0, 'osmanthus', 0.9), (-45.0, 45.0, 'camphor', 1.0),
        (55.0, -12.0, 'camphor', 1.05), (85.0, -12.0, 'camphor', 1.0),
    ]
    for tx, tz, sp, sc in trees:
        b.tree(tx, tz, species=sp, scale=sc, yaw=(tx * 0.37 + tz * 0.23) % math.tau)

    # 6. Street Gate on Libin Road (facing ESE onto Libin Road, exact OSM node/9214622462)
    # Monument pylons and canopy
    gx, gz = 127.01, -12.49
    gy = b.ground(gx, gz)
    gate_yaw = 1.12432  # Tangent to Libin Road way/675174045
    old_p = b.pose
    b.pose = (gx, 0.0, gz, gate_yaw)

    # Left and right stone pylons
    b.box(-4.5, gy, 0.0, 2.2, 8.5, 2.4, 'granite', cap_region='dark_stone')
    b.box(4.5, gy, 0.0, 2.4, 10.5, 2.6, 'granite', cap_region='dark_stone')
    # Monument vertical channel on right pylon
    b.box(4.5, gy + 1.0, 1.32, 0.4, 9.0, 0.1, 'wall_sub')
    # Wide cantilevered lintel canopy (w=14.3m, d=3.8m, height spans local y=5m audit elevation)
    b.box(0.0, gy + 4.35, 0.2, 14.3, 1.1, 3.8, 'granite', cap_region='dark_stone')
    # Vertical sign plaque on right pylon (Rock Walk 51-55: granite pylon with vertical school name)
    b.sign(4.5, gy + 3.5, 1.32, 0.45, 2.4, 'sign_vert', double_sided=True)
    # Closed iron grille gate
    b.retractable_gate(7.5, gate_h=2.2, y0=gy, iron_grille=True)
    b.pose = old_p

    # Perimeter fence along boundary (skip edges 0, 2 & 3 along rear/side steep retaining edges)
    b.perimeter_fence(PERIM, gate_edge=1, gate_t0=0.4, gate_t1=0.6, skip_edges={0, 2, 3})


if __name__ == '__main__':
    export_school_glb('libin_middle', PALETTE, SIGNS, build_libin_middle)
