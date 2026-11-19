"""桂林市培智学校 / 特殊教育学校 (OSM way/1001796193), 象山区雉山路 7 号.

Round 2 updates (strictly aligned with Rock 08:15 positioning & sg claude review):
- All 13 campus buildings extruded directly on exact Overture footprints (offset 0.00 m, angle diff 0.0 deg):
  57d8dc1d (康复综合楼), f0e84f97 (启智楼), ba3b9eb8 (勇敢楼), 2172c983 (博爱楼), 5d62defa (晨曦楼),
  aa14b27d (馨逸楼), plus 7 auxiliary campus blocks.
- Facades & roofs follow refs [00], [03]: dark warm-grey ground-floor base with windows, crisp white
  ceramic tile upper walls with dense multi-pane classroom windows, open white rooftop pergola/louver
  frames ('楼顶构架') on all main wings, and large black-bezel white LED screen ('桂林市培智学校') on 启智楼.
- Entrance plaza features the dark-grey brick motto wall inscribed in gold '给特殊的孩子以特别的关爱'
  with blue propaganda noticeboard & speed-limit sign (ref [20]).
- Sports tracks & basketball courts follow exact OSM relation/20185382, relation/20185383, way/1474979900,
  way/1474979901 in sky-blue synthetic track + grey-green inner court with blue hoops (ref [00]).
"""
import math

from g2b_kit import SchoolBuilder, export_school_glb

RING = [
    (-108.00, -58.53),
    (-104.20, 24.12),
    (-103.04, 41.22),
    (-99.53, 44.71),
    (-89.90, 47.03),
    (4.38, 43.26),
    (7.30, 62.39),
    (42.62, 62.10),
    (44.36, 76.02),
    (62.46, 77.47),
    (63.04, 69.93),
    (68.59, 69.07),
    (70.92, 36.88),
    (127.85, 48.76),
    (134.56, 38.90),
    (134.27, 27.01),
    (130.18, 5.85),
    (95.44, 3.53),
    (94.28, -18.80),
    (57.79, -20.24),
    (57.20, -64.03),
]

# Exact Overture footprints inside way/1001796193 (relative to campus centroid (-1622.03, 1678.17))
OV_KANGFU = [
    (13.40, 47.22), (13.73, 53.56), (64.55, 50.95), (64.01, 40.38),
    (86.24, 39.23), (86.63, 46.64), (113.10, 45.28), (113.31, 49.52),
    (131.31, 48.59), (130.01, 23.20), (12.48, 29.24), (13.12, 41.93),
    (27.95, 41.17), (27.73, 36.94), (52.09, 35.68), (52.58, 45.20),
]  # 57d8dc1d
OV_QIZHI   = [(46.40, -1.94), (94.11, -2.93), (93.89, -13.51), (46.19, -12.53)]    # f0e84f97
OV_YONGGAN = [(54.35, -35.21), (54.36, -45.80), (17.26, -45.83), (17.25, -35.24)]  # ba3b9eb8
OV_BOAI    = [(-36.85, -34.84), (2.78, -35.65), (2.49, -45.93), (-37.04, -44.79)]  # 2172c983
OV_CHENXI  = [(3.31, 39.54), (3.61, 29.06), (-27.86, 28.16), (-28.17, 38.65)]      # 5d62defa
OV_XINYI   = [
    (-78.51, -28.10), (-79.01, -33.37), (-73.73, -33.87), (-73.03, -26.49),
    (-61.42, -27.59), (-62.32, -37.07), (-84.48, -34.98), (-83.79, -27.60),
]  # aa14b27d

OV_AUX = [
    ('南院辅楼', 'overture/7dc1db59', [(58.60, 58.68), (46.68, 57.36), (45.36, 69.27), (57.27, 70.59)], 3),
    ('中庭连廊楼', 'overture/da78f845', [(57.92, 12.75), (49.34, 0.64), (46.75, 2.48), (55.32, 14.59)], 2),
    ('勇敢楼南翼连廊', 'overture/14a0031a', [(47.82, -16.73), (53.13, -16.68), (53.20, -26.22), (47.89, -26.26)], 4),
    ('西南实训室', 'overture/235f9fe1', [(-87.60, 28.97), (-92.90, 32.48), (-87.05, 41.31), (-81.75, 37.80)], 2),
    ('西侧康复用房', 'overture/479273e4', [(-101.35, 10.22), (-101.32, 23.70), (-93.83, 23.69), (-93.86, 10.21)], 3),
    ('西侧长廊', 'overture/5c3a9ab8', [(-96.44, -10.99), (-97.56, 3.94), (-94.57, 4.16), (-93.45, -10.77)], 2),
    ('西北教辅房', 'overture/030626c6', [(-95.84, -26.13), (-88.54, -35.64), (-93.29, -39.27), (-100.60, -29.76)], 2),
]

PALETTE = {
    'wall_main':   '#eef0f2',  # crisp white ceramic tile upper walls (refs [00], [03])
    'wall_accent': '#686b6e',  # cool slate-grey masonry piers & trim (ref [20])
    'wall_sub':    '#90b8d4',  # pale sky-blue balcony trim on 博爱楼 (ref [00])
    'wall_base':   '#5f6062',  # dark warm-grey ground-floor base (refs [00], [03])
    'win_frame':   '#cfd4d9',
    'win_trim':    '#f5f6f8',
    'base_frame':  '#cfd4d8',
    'base_trim':   '#7a7d80',
    'roof_tile':   '#5c6268',
    'pave_grey':   '#c7c5be',
    'pave_dark':   '#585c60',
    'track_red':   '#296ea6',  # cobalt/sky-blue synthetic running track (ref [00]!)
    'turf_a':      '#568b4e',
    'turf_b':      '#46783f',
    'foliage':     '#396534',
    'glass':       '#384f60',
    'court_a':     '#526659',  # grey-green basketball court surface inside blue track (ref [00]!)
    'court_b':     '#2668a0',  # blue basketball hoop post & apron (ref [00]!)
    'yellow':      '#2c80c4',  # blue propaganda noticeboard backing (ref [20])
}

SIGNS = {
    'school_name': '桂林市培智学校',
    'school_en': 'GUILIN PEIZHI SPECIAL SCHOOL',
    'gate_bg': '#f2f3f5',
    'gate_fg': '#284a72',
    'gate_sub_fg': '#4c627a',
    'gate_border': '#78828c',
    'emblem': '培智',
    'motto': '给特殊的孩子以特别的关爱',
    'motto_bg': '#64686c',     # grey brick background matching ref [20]!
    'motto_fg': '#dfb54b',     # raised 3D gold characters matching ref [20]!
    'motto_border': False,
    'led_style': 'white_screen',
    'led_title': '桂林市培智学校',
    'led_sub': '防空疏散暨防灾避险演练',
    'buildings': ['启智楼', '勇敢楼', '博爱楼', '康复楼'],
}


def _peizhi_gate(b: SchoolBuilder, cx: float, cz: float, yaw: float):
    """East street gate on 雉山路 7 号: grey stone piers, white cap, school nameplate & closed retractable gate."""
    old = b.pose
    b.pose = (cx, 0.0, cz, yaw)
    y0 = 0.04
    clear_w = 8.8
    for sx in (-clear_w * 0.5 - 0.8, clear_w * 0.5 + 0.8):
        b.box(sx, y0, 0.0, 1.45, 3.85, 1.45, 'wall_base', cap_region='white', collide=True)
        b.box(sx, y0 + 3.85, 0.0, 1.68, 0.24, 1.68, 'white')
    # Flanking grey-brick nameplate wing wall
    b.box(clear_w * 0.5 + 4.2, y0, 0.05, 5.8, 2.95, 0.85, 'wall_accent', cap_region='white', collide=True)
    b.sign(clear_w * 0.5 + 4.2, y0 + 1.75, 0.52, 4.9, 0.96, 'sign_gate')
    b.retractable_gate(clear_w, gate_h=1.42, y0=y0)
    b.box(0.0, -0.45, 1.8, clear_w + 8.5, 0.50, 4.4, 'pave_dark', cap_region='pave_grey')
    b.pose = old


def _motto_notice_wall(b: SchoolBuilder, cx: float, cz: float, yaw: float):
    """Exact recreation of ref [20]: dark grey brick wall with raised gold characters
    '给特殊的孩子以特别的关爱', blue-backed glass noticeboard with 4 white columns,
    speed-limit '5' disc signs, and blue directional totem on the right.
    """
    old = b.pose
    b.pose = (cx, 0.0, cz, yaw)
    y0 = 0.05
    w = 12.6
    # Dark grey brick wall + top metal coping
    b.box(0.0, y0, 0.0, w, 3.65, 0.52, 'wall_base', cap_region='pave_dark', collide=True)
    b.box(0.0, y0 + 3.65, 0.02, w + 0.25, 0.14, 0.68, 'pave_dark')

    # Upper gold motto inscription ('给特殊的孩子以特别的关爱')
    b.sign(-0.4, y0 + 3.05, 0.29, 10.6, 0.88, 'sign_motto')

    # Blue propaganda noticeboard with dark metal frame & 4 white poster columns (ref [20]!)
    nb_w, nb_h = 8.6, 1.55
    nb_x, nb_y = -1.2, y0 + 1.68
    b.box(nb_x, nb_y - nb_h * 0.5, 0.26, nb_w + 0.24, nb_h + 0.20, 0.14, 'pave_dark')
    b.box(nb_x, nb_y - nb_h * 0.5 + 0.08, 0.30, nb_w, nb_h, 0.12, 'yellow')
    for ci in range(4):
        px = nb_x - 3.15 + ci * 2.10
        b.box(px, nb_y - 0.62, 0.35, 1.75, 1.24, 0.06, 'white')

    # Right side circular '5 km/h' & no-horn traffic discs (ref [20]!)
    for disc_y in (y0 + 2.55, y0 + 1.65):
        b.box(4.45, disc_y - 0.38, 0.30, 0.76, 0.76, 0.08, 'cinnabar')
        b.box(4.45, disc_y - 0.28, 0.34, 0.56, 0.56, 0.08, 'white')

    # Blue '馨逸楼' directional totem on far right (seen on right edge of ref [20]!)
    b.box(6.95, y0, 0.45, 0.95, 2.65, 0.38, 'yellow', cap_region='white', collide=True)
    b.pose = old


def _stair_tower_pergola(b: SchoolBuilder, cx: float, cz: float, top_y: float):
    """Corner elevator/stair tower rising above 5F roof with white louvered pergola cap (ref [00]!)."""
    old = b.pose
    b.pose = (cx, 0.0, cz, 0.0)
    b.box(0.0, 0.05, 0.0, 5.8, 3.5, 5.8, 'win_base')
    b.box(0.0, 3.55, 0.0, 5.6, top_y + 3.2 - 3.55, 5.6, 'win_wall', cap_region='white', collide=True)
    cap_y = top_y + 3.2
    for sx in (-2.4, 2.4):
        for sz in (-2.4, 2.4):
            b.box(sx, cap_y, sz, 0.36, 1.45, 0.36, 'white')
    b.box(0.0, cap_y + 1.45, 0.0, 6.6, 0.26, 6.6, 'white')
    b.pose = old


def build_peizhi(b: SchoolBuilder):
    # 1. Full campus granite paving across way/1001796193
    b.prism(RING, -1.6, 1.65, 'pave_dark', cap_region='pave_grey', collide=False)

    # 2. Perimeter fence with ONE east gate on 雉山路 (edge 14: (134.56,38.90)->(134.27,27.01), len=11.9m)
    b.perimeter_fence(RING, gate_edge=14, gate_t0=0.06, gate_t1=0.94, wall_h=2.25)

    p14, p15 = RING[14], RING[15]
    gx, gz = (p14[0] + p15[0]) * 0.5, (p14[1] + p15[1]) * 0.5
    gate_yaw = math.pi * 0.5  # facing east (+X) onto 雉山路
    _peizhi_gate(b, gx, gz, gate_yaw)

    # Prominent grey-brick gold-character motto wall + blue noticeboard inside entrance plaza (ref [20]!)
    _motto_notice_wall(b, 114.5, 9.2, yaw=0.0)

    # 3. Exact Overture Building Footprints (offset 0.00 m, angle diff 0.0 deg!)
    # Main 5-storey wings with dark-grey 1F base, white ceramic tile upper walls, windows & rooftop pergolas!
    b.footprint_building(OV_KANGFU, name='康复综合楼', source_id='overture/57d8dc1d',
                         floors=5, floor_h=3.45, roof='flat_pergola',
                         base_floors=1, use_base_tex=True, parapet_reg='white', top_parapet_reg='white')
    b.footprint_building(OV_QIZHI, name='启智楼', source_id='overture/f0e84f97',
                         floors=5, floor_h=3.45, roof='flat_pergola',
                         base_floors=1, use_base_tex=True, parapet_reg='white', top_parapet_reg='white')
    b.footprint_building(OV_YONGGAN, name='勇敢楼', source_id='overture/ba3b9eb8',
                         floors=5, floor_h=3.45, roof='flat_pergola',
                         base_floors=1, use_base_tex=True, parapet_reg='white', top_parapet_reg='white')
    b.footprint_building(OV_BOAI, name='博爱楼', source_id='overture/2172c983',
                         floors=5, floor_h=3.45, roof='flat_pergola',
                         base_floors=1, use_base_tex=True, parapet_reg='wall_sub', top_parapet_reg='white')

    # Corner stair towers with white pergola caps + red athletic banner (exact match to ref [00]!)
    _stair_tower_pergola(b, 18.2, -36.2, top_y=5 * 3.45)
    _stair_tower_pergola(b, 0.5, -36.2, top_y=5 * 3.45)
    old = b.pose
    b.pose = (8.8, 0.0, -34.8, 0.0)
    b.box(0.0, 0.85, 0.15, 7.6, 2.35, 0.18, 'cinnabar')  # red sports banner at base of tower (ref [00])
    b.pose = old

    # Large black-bezel white-glowing LED display on 启智楼 ('桂林市培智学校', exact match to ref [03]!)
    b.pose = (68.0, 0.0, -1.85, 0.0)  # South entrance plaza face of 启智楼
    b.box(0.0, 4.10, 0.25, 8.8, 4.75, 0.42, 'black_led')
    b.sign(0.0, 6.48, 0.50, 8.3, 4.30, 'sign_led')
    b.pose = (56.5, 0.0, -13.60, math.pi)  # North court-facing side of 启智楼
    b.box(0.0, 4.10, 0.25, 8.8, 4.75, 0.42, 'black_led')
    b.sign(0.0, 6.48, 0.50, 8.3, 4.30, 'sign_led')
    b.pose = old

    # West 4-storey & auxiliary campus blocks on exact Overture footprints
    b.footprint_building(OV_CHENXI, name='晨曦楼', source_id='overture/5d62defa',
                         floors=4, floor_h=3.45, roof='flat_pergola',
                         base_floors=1, use_base_tex=True, parapet_reg='white', top_parapet_reg='white')
    b.footprint_building(OV_XINYI, name='馨逸楼', source_id='overture/aa14b27d',
                         floors=4, floor_h=3.40, roof='flat',
                         base_floors=1, use_base_tex=True, parapet_reg='white', top_parapet_reg='white')
    for aname, asrc, aring, afl in OV_AUX:
        b.footprint_building(aring, name=aname, source_id=asrc,
                             floors=afl, floor_h=3.35, roof='flat',
                             base_floors=1, use_base_tex=True, parapet_reg='white', top_parapet_reg='white')

    # 4. Exact OSM Sports Tracks & Basketball Courts (ref [00]: sky-blue track + grey-green courts + blue hoops!)
    # East track relation/20185383 (23.71, -8.56, 58.28x35.69, 90.95 deg) + pitch way/1474979901 (23.67, -11.07)
    b.running_track(23.71, -8.56, length=56.0, width=34.5, yaw=math.radians(90.95),
                    y0=0.07, track_reg='track_red', infield_mode='court_only')
    b.basketball_court(23.67, -11.07, yaw=math.radians(90.89), w=27.78, d=15.00,
                       surface='court_a', apron='court_b', key_reg='court_a', y0=0.15)

    # West track relation/20185382 (-16.76, -8.45, 57.34x41.09, 91.10 deg) + pitch way/1474979900 (-16.31, -9.91)
    b.running_track(-16.76, -8.45, length=56.0, width=38.5, yaw=math.radians(91.10),
                    y0=0.07, track_reg='track_red', infield_mode='court_only')
    b.basketball_court(-16.31, -9.91, yaw=math.radians(90.91), w=29.76, d=15.04,
                       surface='court_a', apron='court_b', key_reg='court_a', y0=0.15)

    # Flagpole & camphor trees in front of 博爱楼 (right side of ref [00]!)
    b.flagpole_plaza(4.5, -28.0, yaw=0.0, y0=0.06, with_motto_wall=False)
    for tx in (-26.0, -16.0, -6.0):
        b.tree(tx, -31.0, scale=1.05, seed=200 + int(abs(tx)))
    b.green_strip(-56.0, -4.0, w=4.0, d=36.0, yaw=0.0, trees=4, seed=211)
    b.green_strip(82.0, 14.5, w=24.0, d=3.2, yaw=0.0, trees=3, seed=229)


if __name__ == '__main__':
    export_school_glb('peizhi_special', PALETTE, SIGNS, build_peizhi, seed=202602)
