"""桂林市培智学校 (`way/1001796193`) full campus restoration.

Sources verified against November 2026 Esri z19 satellite, OSM (`way/1001796193`,
`way/1474979900`, `way/1474979901`, `way/378664883`, `relation/20185382/83`), Overture
buildings, and public exterior photos (`ref_01`, `ref_06`, `ref_12`, `ref_15`, `ref_17`):
- White gridded facade tile upper walls + charcoal dark-grey 1F dado bases + sky-blue
  glass corridor balustrades + white slatted rooftop pergola trellises (`flat_pergola`).
- P1..P5 main 4F academic complex (`57d8dc1d`, `ba3b9eb8`, `f0e84f97`, `2172c983`, `5d62defa`),
  3F west & south annexes (`aa14b27d`, `7dc1db59`, `479273e4`), glazed 3F skybridge (`14a0031a`),
  two square staircase rooftop pavilions, outdoor LED screen, and courtyard wood trellis gazebo.
- Dual sports courts: West brick-red oval track surrounding blue/green basketball court (`way/1474979900`)
  and East royal-blue oval track (`way/378664883`) surrounding emerald-green basketball court (`way/1474979901`).
- East Main Gate at 雉山路7号 (`way/259020548`) with dark grey granite bases, white square piers,
  `桂林市培智学校` signage, closed retractable stainless gate (zero guardhouse/turnstile/CCTV).
"""
import math

from school_kit import SchoolBuilder, export_school_glb, mrr_stats

PALETTE = {
    'wall_main':   '#ecece8',  # crisp white grid ceramic tile (`ref_01`, `ref_12`)
    'wall_sub':    '#87b6d6',  # sky-blue corridor glass balustrade (`ref_01`)
    'wall_accent': '#b8bfc7',  # cool silver-grey structural pilaster & band
    'wall_base':   '#4b4f54',  # charcoal dark-grey 1F brick/stone dado (`ref_06`, `ref_12`)
    'win_frame':   '#7c848c',  # silver-grey window mullions
    'win_trim':    '#f2f2ee',
    'base_frame':  '#aeb4ba',
    'base_trim':   '#666c72',
    'pave_grey':   '#c9c5bb',
    'pave_road':   '#9e9a92',
    'pave_dark':   '#46494c',
    'granite':     '#aba9a2',
    'roof_tile':   '#70767d',
    'roof_blue':   '#5882b0',
    'track_red':   '#b55043',
    'turf_a':      '#4f8c4a',
    'turf_b':      '#41763d',
    'court_a':     '#3f8a5b',  # emerald green court surface (`ref_01`, `ref_17`)
    'court_b':     '#396ea8',  # royal blue outer track & court surround (`ref_01`)
    'cinnabar':    '#c4382e',
    'wood':        '#7e5339',
    'cream':       '#e8e8e4',
    'has_ac':      False,
}

SIGNS = {
    'school_name': '桂林市培智学校',
    'school_en':   'Guilin Peizhi School',
    'gate_bg':     '#eae9e4',
    'gate_fg':     '#8f241f',
    'gate_sub_fg': '#55585c',
    'vert_bg':     '#383b40',
    'vert_fg':     '#ecd188',
    'vert_text':   '桂林市培智学校',
    'motto':       '',
    'led_title':   '桂林市培智学校',
    'emblem':      '培智',
}

# Inset west vertices >= 5.8m from residential alley `way/412456971` and east edge >= 8.2m from 雉山路
FENCE_RING = [
    (-104.8, -57.2),
    (-102.2,  24.0),
    (-100.2,  40.5),
    ( -97.0,  44.0),
    ( -88.0,  46.2),
    (   4.4,  43.3),
    (   7.3,  62.4),
    (  42.6,  62.1),
    (  44.4,  76.0),
    (  62.4,  77.2),
    (  63.0,  69.9),
    (  68.6,  69.1),
    (  70.9,  36.9),
    ( 126.8,  47.8),
    ( 132.0,  38.5),  # 14->15 East flank near 57d8dc1d
    ( 132.0,  27.0),  # edge 15->16: East Main Gate onto 雉山路
    ( 130.0,   6.2),
    (  95.4,   3.5),
    (  94.3, -18.8),
    (  57.8, -20.2),
    (  57.2, -63.5),
]

RING_P1 = [(13.397, 47.217), (13.729, 53.564), (64.552, 50.954), (64.008, 40.383),
           (86.244, 39.233), (86.626, 46.642), (113.099, 45.282), (113.311, 49.517),
           (131.309, 48.588), (130.01, 23.2), (12.481, 29.237), (13.125, 41.931),
           (27.952, 41.168), (27.731, 36.944), (52.09, 35.684), (52.583, 45.204)]  # 57d8dc1d
RING_P2 = [(54.355, -35.205), (54.365, -45.798), (17.262, -45.831), (17.252, -35.238)]  # ba3b9eb8
RING_P3 = [(46.403, -1.945), (94.105, -2.929), (93.894, -13.511), (46.191, -12.526)]    # f0e84f97
RING_P4 = [(-36.852, -34.84), (2.777, -35.647), (2.485, -45.931), (-37.044, -44.792)]   # 2172c983
RING_P5 = [(3.311, 39.543), (3.613, 29.06), (-27.863, 28.165), (-28.165, 38.647)]       # 5d62defa
RING_P6 = [(-78.505, -28.095), (-79.008, -33.37), (-73.734, -33.867), (-73.029, -26.492),
           (-61.423, -27.587), (-62.319, -37.074), (-84.484, -34.984), (-83.79, -27.598)] # aa14b27d
RING_P7 = [(58.603, 58.683), (46.685, 57.356), (45.356, 69.265), (57.274, 70.592)]      # 7dc1db59
RING_P8 = [(-101.355, 10.219), (-101.324, 23.698), (-93.825, 23.687), (-93.856, 10.208)]# 479273e4

RING_BRIDGE = [(47.822, -16.728), (53.127, -16.684), (53.197, -26.216), (47.893, -26.26)]  # 14a0031a
RING_W1 = [(-95.839, -26.127), (-88.541, -35.636), (-93.292, -39.274), (-100.6, -29.765)]  # 030626c6
RING_W2 = [(-87.605, 28.972), (-92.899, 32.477), (-87.051, 41.312), (-81.746, 37.796)]    # 235f9fe1
RING_W3 = [(-96.442, -10.989), (-97.56, 3.938), (-94.57, 4.159), (-93.453, -10.768)]       # 5c3a9ab8

WAY_W_COURT = [(-24.07, -24.67), (-23.6, 5.08), (-8.56, 4.84), (-9.03, -24.9)]
WAY_E_COURT = [(15.95, -24.84), (16.39, 2.93), (31.37, 2.7), (30.95, -25.08)]
WAY_E_TRACK = [(20.1, -32.09), (18.11, -31.17), (16.33, -29.89), (14.83, -28.28), (13.67, -26.43),
               (12.89, -24.38), (12.52, -22.23), (13.18, 5.28), (13.66, 7.41), (14.53, 9.41),
               (15.78, 11.21), (17.36, 12.74), (19.2, 13.93), (21.24, 14.75), (23.4, 15.17),
               (25.6, 15.17), (27.76, 14.75), (29.79, 13.92), (31.48, 12.85), (32.94, 11.49),
               (34.15, 9.9), (35.06, 8.13), (35.64, 6.22), (35.87, 4.24), (35.16, -23.08),
               (34.69, -25.01), (33.88, -26.83), (32.77, -28.49), (31.38, -29.93), (29.76, -31.11),
               (27.96, -31.99), (26.04, -32.53), (24.05, -32.73), (22.04, -32.58)]


def _build_east_gate(b: SchoolBuilder, p0: tuple[float, float], p1: tuple[float, float]):
    """East Main Gate at 雉山路7号 facing East toward way/259020548 (closed retractable gate)."""
    mx, mz = (p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    yaw = math.atan2(-dz, dx)
    gy = b.ground(mx, mz)

    old = b.pose
    b.pose = (mx, 0.0, mz, yaw)

    b.box(0.0, gy - 0.03, 0.25, 11.8, 0.055, 4.5, 'granite', cap_region='pave_grey')
    pier_x = 4.35
    for sgn in (-1.0, 1.0):
        px = sgn * pier_x
        b.box(px, gy - 0.03, 0.0, 1.45, 0.72, 1.25, 'pave_dark', cap_region='granite', collide=True)
        b.box(px, gy + 0.67, 0.0, 1.35, 3.05, 1.15, 'cream', cap_region='white', collide=True)
        b.box(px, gy + 3.70, 0.0, 1.52, 0.24, 1.32, 'wall_base', cap_region='white', bottom=True)

    # Top lintel beam & school name fascia (`桂林市培智学校`) facing East onto 雉山路
    b.box(0.0, gy + 3.15, 0.0, 10.9, 0.78, 1.42, 'wall_base', cap_region='white', collide=True, bottom=True)
    b.box(0.0, gy + 3.90, 0.0, 11.2, 0.16, 1.58, 'white', cap_region='wall_accent', bottom=True)
    if b.lod < 2:
        b.sign(0.0, gy + 3.55, 0.73, 5.4, 0.62, 'sign_gate', double_sided=True)
        b.sign(pier_x, gy + 2.15, 0.59, 0.42, 1.12, 'sign_vert', double_sided=True)
        b.sign(-pier_x, gy + 2.15, 0.59, 0.42, 1.12, 'sign_vert', double_sided=True)

    b.retractable_gate(7.2, gate_h=1.45, y0=gy)
    b.pose = old


def build_peizhi(b: SchoolBuilder):
    # 1. Terrain-following campus surface (`Delaunay` ground_slab)
    b.ground_slab(FENCE_RING, region='pave_grey', lift=0.025, edge_drop=0.04)

    # 2. Perimeter wall + East Main Gate (`edge 15->16` on 雉山路7号)
    b.perimeter_fence(FENCE_RING, gate_edge=15, gate_t0=0.22, gate_t1=0.78,
                      wall_h=2.25, base_reg='wall_base', post_reg='cream')
    _build_east_gate(b, FENCE_RING[15], FENCE_RING[16])

    # 3. Audited main buildings (exact Overture polygons + `ref_01` white/charcoal/pergola architecture)
    b.footprint_building(
        RING_P1, bid='P1', source_id='57d8dc1d-dbd5-48d9-aff2-a6a0c4809c6c',
        floors=4, floor_h=3.45, roof='flat_pergola',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
        corridor_edges={9}, corridor_reg='wall_sub',
    )
    b.footprint_building(
        RING_P2, bid='P2', source_id='ba3b9eb8-bae1-4e17-84bf-a212f7e9ae61',
        floors=4, floor_h=3.45, roof='flat_pergola',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
        corridor_edges={3}, corridor_reg='wall_sub',
    )
    b.footprint_building(
        RING_P3, bid='P3', source_id='f0e84f97-ce3e-410c-971a-cc49732756fb',
        floors=4, floor_h=3.45, roof='flat_pergola',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
        corridor_edges={3}, corridor_reg='wall_sub',
    )
    b.footprint_building(
        RING_P4, bid='P4', source_id='2172c983-fc86-41ba-b6d6-7fb6d9c0e74e',
        floors=4, floor_h=3.45, roof='flat_pergola',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
        corridor_edges={3}, corridor_reg='wall_sub',
    )
    b.footprint_building(
        RING_P5, bid='P5', source_id='5d62defa-b6b0-4066-b521-2dcc1c2304e8',
        floors=4, floor_h=3.45, roof='flat_pergola',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
        corridor_edges={1}, corridor_reg='wall_sub',
    )
    b.footprint_building(
        RING_P6, bid='P6', source_id='aa14b27d-5d1f-49b6-a132-3139d1411959',
        floors=3, floor_h=3.45, roof='flat_rail',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
    )
    b.footprint_building(
        RING_P7, bid='P7', source_id='7dc1db59-20bb-4f33-ae6f-34c82ab44dfd',
        floors=3, floor_h=3.45, roof='flat_rail',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
    )
    b.footprint_building(
        RING_P8, bid='P8', source_id='479273e4-95de-44d6-8846-e7ec654f8e6b',
        floors=3, floor_h=3.45, roof='flat_rail',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
    )

    # 4. Glazed corridor bridge (`ref_01`), West annex blocks, turret stair pavilions, outdoor LED & trellis
    # 4a. Enclosed 3-4F windowed skybridge `14a0031a` between P2 & P3 (`ref_01.jpg` center)
    b.footprint_building(RING_BRIDGE, bid='BRIDGE', source_id='14a0031a-a440-4a06-85d6-110a4d2f4054',
                         floors=3, floor_h=3.45, roof='flat',
                         wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
                         instanced_windows=False)

    # 4b. West annexes (`W1`, `W2`, `W3`)
    b.footprint_building(RING_W1, bid='W1', source_id='030626c6-a632-40ec-b767-feea9d6e6ce7',
                         floors=2, floor_h=3.35, roof='flat', wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame', instanced_windows=False)
    b.footprint_building(RING_W2, bid='W2', source_id='235f9fe1-4043-494c-9035-7c8e78929662',
                         floors=2, floor_h=3.35, roof='flat', wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame', instanced_windows=False)
    g_w3 = b.ground(-95.5, -3.4)
    b.prism(RING_W3, g_w3 - 0.03, 3.6, 'wall_base', cap_region='roof_tile', collide=True, ground_skirt=True)

    # 4c. Two rooftop turret staircase pavilions on P1 + courtyard outdoor LED (`ref_12`) + timber pergola (`ref_15`)
    if b.lod < 2:
        for tx, tz in ((63.8, 28.5), (108.5, 28.5)):
            gy_t = b.ground(tx, tz) + 13.8
            b.box(tx, gy_t - 0.05, tz, 6.2, 2.35, 6.2, 'cream', cap_region='roof_tile', bottom=True)
            b.box(tx, gy_t + 2.30, tz, 6.9, 0.25, 6.9, 'white', bottom=True)
        # Outdoor LED screen + backing frame on P3 west stairwell wall facing courtyard (`ref_12.jpg`)
        gy_led = b.ground(46.29, -7.2)
        old = b.pose
        b.pose = (46.28, 0.0, -7.2, math.radians(-90.0))
        b.box(0.0, gy_led + 3.1, 0.02, 6.6, 3.6, 0.14, 'black_led', bottom=True)
        b.sign(0.0, gy_led + 4.9, 0.11, 6.4, 3.4, 'sign_led', double_sided=True)
        b.pose = old
        # East courtyard wooden trellis arbor (`ref_15.jpg`)
        old = b.pose
        gy_arbor = b.ground(102.0, 9.0)
        b.pose = (102.0, 0.0, 9.0, 0.0)
        for sx in (-6.0, 0.0, 6.0):
            for sz in (-2.0, 2.0):
                b.box(sx, gy_arbor - 0.03, sz, 0.28, 3.05, 0.28, 'wood', collide=True)
        b.box(0.0, gy_arbor + 3.0, -2.0, 14.0, 0.22, 0.28, 'wood', bottom=True)
        b.box(0.0, gy_arbor + 3.0, 2.0, 14.0, 0.22, 0.28, 'wood', bottom=True)
        if b.detail:
            for bx in range(-6, 7, 2):
                b.box(float(bx), gy_arbor + 3.18, 0.0, 0.14, 0.14, 4.8, 'wood', bottom=True)
        b.pose = old

    # 5. Sports Areas (exact OSM + Esri z19 + `ref_01.jpg`)
    # 5a. West Red Oval Apron (`relation/20185382`) + Blue/Green Basketball Court (`way/1474979900`)
    wcx, wcz, ww, wd, wang = mrr_stats(WAY_W_COURT)
    b.running_track(wcx, wcz, length=51.0, width=28.5, yaw=math.radians(wang),
                    track_reg='track_red', infield_mode='none')
    b.basketball_court(wcx, wcz, yaw=math.radians(wang), w=ww, d=wd,
                       surface='court_b', apron=None, key_reg='track_red', lift=0.055)

    # 5b. East Royal-Blue Oval Track (`way/378664883` + `relation/20185383`) + Bright Emerald Court (`way/1474979901`)
    tcx, tcz, tw, td, tang = mrr_stats(WAY_E_TRACK)
    b.running_track(tcx, tcz, length=tw, width=td, yaw=math.radians(tang),
                    track_reg='court_b', infield_mode='none')
    ecx, ecz, ew, ed, eang = mrr_stats(WAY_E_COURT)
    b.basketball_court(ecx, ecz, yaw=math.radians(eang), w=ew, d=ed,
                       surface='court_a', apron=None, key_reg='court_b', lift=0.055)

    # 6. Flagpoles (`ref_01.jpg` right foreground) & Main Driveway Plaza
    b.flagpole_plaza(46.0, 16.0, yaw=math.radians(180.0), poles=3)
    b.path_strip((128.0, 16.0), (50.0, 16.0), width=6.2, region='pave_road')
    b.path_strip((-42.0, 16.0), (8.0, 16.0), width=4.8, region='pave_road')
    b.path_strip((-60.0, 18.0), (-60.0, -24.0), width=4.4, region='pave_road')

    # 7. Campus Greenery & IDOK-71 Instanced Trees
    b.green_bed(94.0, 8.5, 58.0, 5.5, yaw=0.0, trees=5, species='camphor', seed=31)
    north_trees = [
        (-84.0, -48.0, 'banyan', 0.94), (-50.0, -52.0, 'camphor', 0.92),
        (-12.0, -55.0, 'camphor', 0.95), ( 12.0, -55.0, 'osmanthus', 0.88),
        ( 32.0, -55.0, 'camphor', 0.92), ( 48.0, -54.0, 'bischofia', 0.95),
    ]
    for tx, tz, sp, sc in north_trees:
        b.tree(tx, tz, species=sp, scale=sc, yaw=(tx * 0.37) % math.tau)

    west_trees = [
        (-58.0, -20.0, 'camphor', 0.90), (-58.0, -5.0, 'osmanthus', 0.92),
        (-58.0,  12.0, 'camphor', 0.88), (-62.0, 35.0, 'banyan', 0.95),
        (-42.0,  35.0, 'camphor', 0.92), (-46.0, -8.0, 'ginkgo', 0.88),
    ]
    for tx, tz, sp, sc in west_trees:
        b.tree(tx, tz, species=sp, scale=sc, yaw=(tz * 0.51) % math.tau)


if __name__ == '__main__':
    export_school_glb('peizhi_special', PALETTE, SIGNS, build_peizhi, seed=2027)
