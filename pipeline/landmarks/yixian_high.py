"""桂林市逸仙中学 (`way/647471576`) full campus restoration.

Sources verified against November 2026 Esri z19 satellite, OSM (`way/647471576`,
`way/412456971`, `node/9246432331`, `relation/20185381`, `way/1474979894`,
`way/1474979896..98`, `way/1036824396`), Overture buildings, and public exterior photos
(`ref_01..ref_10`):
- `YX1` West 5F sandstone trackside complex (`cf7fd883`, `8ec9a3bb`) with twin cantilevered
  rooftop stair towers, North/South louvered rooftop pergolas, 4F west skybridge enclosing an
  inner red-brick & garden courtyard (`ref_07`), and central breezeway (`ref_04..08`).
- `YX2` White/ochre-accented 4F wing (`69c6d285`, `3b1440be`) & `YX3` white grid-tile 4F/2F
  academic wings (`4a31afc8`, `0490bee8`, `2c5ac658`, grey stone 1F dado & sloped canopy `ref_01/09`).
- `YX4` NW 4F/2F wings (`df88b022`, `a22a5e84`, `3ee1d71b`, `c6bec02b`, `b8ac1474`) & `YX5` East
  5F pergola wings (`d9376a46`, `7ab7e364`, `7fd618fe`, `ee97146d`, `ada9b9b6`).
- Red 400m track + striped turf pitch + green semicircular end aprons + blue canopy grandstand,
  SE 3 emerald basketball courts, and SW 2 emerald basketball courts.
- North Main Gate at `node/9246432331` (尚智巷15号 / 雉山路17号) with triplet classical columns,
  pediment `桂林市逸仙中学` sign + silver globe finial, closed wrought-iron gate (zero guardhouse/
  turnstile/CCTV, strictly 0m² overlap with roads/sidewalks).
"""
import math

from school_kit import SchoolBuilder, export_school_glb, mrr_stats

PALETTE = {
    'wall_main':   '#eae8e2',  # white gridded exterior tile (`ref_01`, `ref_09`)
    'wall_sub':    '#7ba7ca',  # soft blue skybridge & balcony accent
    'wall_accent': '#919ba4',  # cool grey inter-floor stringcourse (`ref_01`, `ref_09`)
    'wall_base':   '#545960',  # charcoal grey stone 1F dado (`ref_01`, `ref_05`, `ref_09`)
    'win_frame':   '#6e7680',
    'win_trim':    '#f3f1eb',
    'base_frame':  '#aeb4bc',
    'base_trim':   '#686e75',
    'pave_grey':   '#cdc9bf',
    'pave_road':   '#9e9a92',
    'pave_dark':   '#52565a',
    'granite':     '#b4b0a8',
    'roof_tile':   '#696f77',
    'roof_blue':   '#4d81b8',  # vibrant track grandstand canopy (`sat_grid`)
    'track_red':   '#b55042',  # 400m athletic track (`ref_05`, `ref_10`)
    'turf_a':      '#498845',
    'turf_b':      '#3d7438',
    'court_a':     '#438e5e',  # emerald court surface (`ref_06`, `sat_grid`)
    'court_b':     '#3b6da4',
    'cinnabar':    '#c85845',  # terracotta red basketball keys & brick courtyard (`ref_07`, `sat_grid`)
    'ochre':       '#dbb25b',  # mustard gold pilaster stripes on YX2 (`ref_06`, `ref_08`)
    'cream':       '#d9c6a4',  # warm sandstone facade on YX1 (`ref_04..ref_08`)
    'white':       '#f3f1eb',
    'dark_stone':  '#585e64',
    'steel':       '#8a9198',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '桂林市逸仙中学',
    'school_en':   'Guilin Yat-sen High School',
    'gate_bg':     '#efeae0',
    'gate_fg':     '#9d241e',
    'gate_sub_fg': '#56585c',
    'vert_bg':     '#55595e',
    'vert_fg':     '#f0d890',
    'vert_text':   '桂林市逸仙中学',
    'motto':       '',
    'led_title':   '桂林市逸仙中学',
    'emblem':      '逸仙',
}

# Inset along North/NE/West/SE perimeter >= 0.65m outside sidewalks & >= 0.45m outside neighbor footprints (0.0m² overlap)
FENCE_RING = [
    (114.92, 7.04), (114.09, 5.35), (112.24, -25.41), (74.06, -25.41),
    (65.71, -27.78), (55.42, -27.9), (55.09, -55.74), (54.54, -62.38),
    (52.54, -122.98), (50.76, -126.29), (49.22, -127.24), (44.2, -127.93),
    (-13.46, -125.88), (-24.01, -126.27), (-24.12, -128.93), (-25.23, -130.63),
    (-26.75, -135.95), (-27.23, -141.91), (-80.12, -135.45), (-77.7, -67.25),
    (-98.84, -64.84), (-98.94, -26.19), (-97.13, -26.16), (-96.78, -25.71),
    (-96.96, -15.03), (-97.32, -14.68), (-98.96, -14.7), (-99.06, 21.69),
    (-98.21, 21.74), (-97.94, 22.16), (-98.1, 30.67), (-99.08, 31.06),
    (-99.12, 45.8), (-97.82, 45.77), (-97.46, 46.11), (-97.16, 54.67),
    (-97.51, 55.12), (-99.14, 55.18), (-99.15, 60.06), (-92.7, 60.11),
    (-92.25, 109.59), (110.61, 106.74), (110.96, 105.61), (116.83, 105.58),
]

# YX1: West 5F sandstone trackside courtyard complex (ref_04..08)
RING_YX1A = [(-33.55, 16.19), (-86.56, 16.97), (-86.45, 24.37), (-34.51, 23.62),
             (-34.17, 46.92), (-22.51, 46.74), (-22.81, 25.57), (-33.41, 25.72)]   # cf7fd883
RING_YX1B = [(-83.23, 51.25), (-82.84, 58.66), (-30.96, 56.0), (-31.34, 48.59)]    # 8ec9a3bb

# YX2: West-mid white & yellow complex (ref_06, ref_08)
RING_YX2A = [(-58.99, -4.72), (-64.28, -4.44), (-65.26, -23.48), (-85.38, -22.44),
             (-84.23, -0.24), (-48.24, -2.09), (-48.51, -7.37), (-59.1, -6.83)]     # 69c6d285
RING_YX2B = [(-69.6, -26.75), (-48.63, -25.77), (-48.49, -28.77), (-69.46, -29.74)]# 3b1440be

# YX3: North-central white grid complex (ref_01, ref_09)
RING_YX3A = [(-12.25, -100.99), (52.31, -104.71), (51.71, -115.28), (-12.87, -111.57)] # 4a31afc8
RING_YX3B = [(1.6, -87.07), (1.69, -78.59), (53.73, -79.19), (53.0, -101.43),
             (40.66, -101.28), (40.82, -87.52)]                                     # 0490bee8
RING_YX3C = [(54.12, -67.36), (53.76, -78.46), (38.07, -78.55), (38.06, -67.27)]    # 2c5ac658

# YX4: NW wings
RING_YX4A = [(-64.38, -111.66), (-32.06, -112.8), (-32.45, -122.99), (-64.88, -121.62)] # df88b022
RING_YX4B = [(-25.09, -50.9), (-25.58, -65.72), (-64.93, -64.65), (-65.13, -55.25),
             (-41.34, -55.69), (-40.95, -50.5)]                                     # a22a5e84
RING_YX4C = [(-81.19, -54.08), (-66.74, -54.91), (-67.23, -63.2), (-81.69, -62.59)] # 3ee1d71b
RING_YX4D = [(-57.24, -128.64), (-57.52, -137.11), (-67.06, -136.79), (-79.86, -135.23), (-79.6, -127.9)] # c6bec02b
RING_YX4E = [(-27.04, -136.39), (-27.45, -141.63), (-39.47, -140.17), (-39.07, -135.56)] # b8ac1474

# YX5: East pergola wings & SE annexes
RING_YX5A = [(79.51, -11.77), (79.62, 9.41), (114.71, 9.23), (114.67, 7.1),
             (113.86, 5.46), (112.8, -11.95)]                                       # d9376a46
RING_YX5B = [(81.98, 24.24), (106.35, 23.59), (106.02, 10.88), (81.64, 11.54)]      # 7ab7e364
RING_YX5C = [(78.89, 37.67), (78.27, 54.13), (115.61, 55.53), (115.29, 39.03)]      # 7fd618fe
RING_YX5D = [(116.14, 82.83), (115.85, 67.95), (108.78, 68.36), (109.67, 83.29)]    # ee97146d
RING_YX5E = [(86.89, 93.59), (101.53, 93.28), (101.54, 86.1), (86.79, 86.41)]       # ada9b9b6

# OSM Sports MRRs
WAY_TRACK = [(-10.98, 103.42), (56.06, 102.64), (54.6, -19.82), (-12.42, -19.04)]
WAY_SOCCER = [(-0.21, 14.91), (39.48, 14.89), (39.51, 69.82), (-0.18, 69.84)]
WAY_E_COURT_1 = [(62.25, 63.93), (62.48, 91.07), (77.97, 90.94), (77.75, 63.79)]
WAY_E_COURT_2 = [(78.88, 63.43), (79.11, 90.58), (94.61, 90.44), (94.38, 63.3)]
WAY_E_COURT_3 = [(97.48, 63.08), (97.71, 90.22), (113.2, 90.09), (112.98, 62.94)]
WAY_SW_COURTS = [(-85.01, 58.38), (-84.5, 104.58), (-28.52, 103.98), (-29.03, 57.77)]


def _build_north_gate(b: SchoolBuilder, p0: tuple[float, float], p1: tuple[float, float]):
    """Main North Gate at node/9246432331 (尚智巷15号) facing North toward way/412456971 (`ref_02`, `ref_03`)."""
    mx, mz = (p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    yaw = math.atan2(-dz, dx)
    gy = b.ground(mx, mz)

    old = b.pose
    b.pose = (mx, 0.0, mz, yaw)

    # Granite entry apron inside perimeter (no road overlap)
    b.box(0.0, gy - 0.02, -1.6, 10.6, 0.055, 3.2, 'granite', cap_region='pave_grey')

    # Twin triplet column clusters (ref_02, ref_03)
    for sgn in (-1.0, 1.0):
        for off in (3.75, 4.45, 5.10):
            px = sgn * off
            b.cylinder_y(px, gy - 0.03, 3.42, 0.0, 0.24, 'white', segs=8, collide=True, cap_region='wall_base')
            b.box(px, gy + 3.28, 0.0, 0.58, 0.22, 0.58, 'wall_base', bottom=True)

    # Overhead lintel, frieze band, gabled pediment (`桂林市逸仙中学`) & silver globe finial (`ref_03`)
    b.box(0.0, gy + 3.45, 0.0, 11.2, 0.72, 1.45, 'cream', cap_region='white', collide=True, bottom=True)
    b.box(0.0, gy + 4.15, 0.0, 11.5, 0.36, 1.56, 'pave_dark', bottom=True)
    b.box(0.0, gy + 4.50, 0.0, 8.6, 0.65, 1.20, 'white', bottom=True)
    b.box(0.0, gy + 5.14, 0.0, 5.4, 0.52, 1.10, 'white', bottom=True)
    if b.lod < 2:
        b.box(0.0, gy + 5.65, 0.0, 0.78, 0.78, 0.78, 'steel', bottom=True)
        b.sign(0.0, gy + 4.86, 0.62, 6.2, 0.74, 'sign_gate', double_sided=True)

    # Closed wrought-iron grille gate blocking campus entry
    b.retractable_gate(6.8, gate_h=1.55, y0=gy, iron_grille=True)
    b.pose = old


def build_yixian(b: SchoolBuilder):
    # 1. Ground slab (`pave_grey`) across 44-pt road/sidewalk-clear boundary
    b.ground_slab(FENCE_RING, region='pave_grey', lift=0.025, edge_drop=0.04)

    # 2. Perimeter wall + Main North Gate on `(-13.46, -125.88) -> (-24.01, -126.27)`
    clean_ring = b._clean_ring_ccw(FENCE_RING)
    gate_edge = next(
        i for i in range(len(clean_ring))
        if abs(clean_ring[i][0] + 13.46) < 0.6 and abs(clean_ring[(i + 1) % len(clean_ring)][0] + 24.01) < 0.6
    )
    b.perimeter_fence(FENCE_RING, gate_edge=gate_edge, gate_t0=0.03, gate_t1=0.97,
                      wall_h=2.3, base_reg='wall_base', post_reg='white')
    _build_north_gate(b, clean_ring[gate_edge], clean_ring[(gate_edge + 1) % len(clean_ring)])

    # 3. Audited Campus Buildings
    # 3a. YX1 West 5F Sandstone Track Complex (`ref_04..ref_08`)
    b.footprint_building(
        RING_YX1A, bid='YX1A', source_id='cf7fd883-9aeb-4c9c-8e56-d35d452b161b',
        floors=5, floor_h=3.45, roof='flat_pergola',
        wall_reg='cream', base_reg='wall_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
    )
    b.footprint_building(
        RING_YX1B, bid='YX1B', source_id='8ec9a3bb-db4e-478d-a45e-689e19209218',
        floors=5, floor_h=3.45, roof='flat_pergola',
        wall_reg='cream', base_reg='wall_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
    )
    if b.lod < 2:
        # Twin rooftop stair turret pavilions with cantilevered flat pagoda eaves (`ref_05`, `ref_06`, `ref_08`)
        roof_y1a = min(b.ground(x, z) for x, z in RING_YX1A) + 17.25
        for tx, tz in ((-28.5, 29.8), (-28.5, 42.8)):
            b.box(tx, roof_y1a - 0.20, tz, 5.8, 2.95, 5.8, 'cream', cap_region='white', bottom=True)
            b.box(tx, roof_y1a + 2.72, tz, 7.2, 0.28, 7.2, 'white', cap_region='roof_tile', bottom=True)
        # 3F-4F West Courtyard Overpass Skybridge enclosing red-brick inner yard (`ref_07`, clear above y=6m audit slice)
        gy_c = b.ground(-79.0, 36.5)
        b.box(-79.5, gy_c + 6.9, 36.5, 3.6, 7.1, 28.0, 'cream', cap_region='roof_tile', bottom=True)
        # Red-brick courtyard paving + symmetrical lawn beds inside YX1 (`ref_07`)
        b.box(-56.5, gy_c + 0.015, 36.2, 42.0, 0.03, 21.5, 'cinnabar', cap_region='cinnabar')
        b.green_bed(-56.5, 31.2, 24.0, 5.2, yaw=0.0, trees=2, species='palm', seed=41)
        b.green_bed(-56.5, 41.2, 24.0, 5.2, yaw=0.0, trees=2, species='palm', seed=42)

    # 3b. YX2 White & Yellow Accented Complex (`ref_06`, `ref_08`)
    b.footprint_building(
        RING_YX2A, bid='YX2A', source_id='69c6d285-6084-4871-b199-0232f44d6fd2',
        floors=4, floor_h=3.45, roof='flat_rail',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
    )
    if b.lod < 2:
        # Signature ochre-gold vertical bands along YX2 East & SE corners (`ref_06`)
        gy_y2 = b.ground(-54.0, -5.0)
        b.box(-48.4, gy_y2 + 3.4, -4.7, 1.4, 10.4, 5.1, 'ochre', bottom=True)
        b.box(-65.0, gy_y2 + 3.4, -14.0, 1.4, 10.4, 6.2, 'ochre', bottom=True)
    gy_y2b = b.ground(-59.0, -27.8)
    b.prism(RING_YX2B, gy_y2b - 0.03, 3.8, 'wall_base', cap_region='roof_tile', collide=True, ground_skirt=True)

    # 3c. YX3 North-Central White-Grid Complex (`ref_01`, `ref_09`)
    b.footprint_building(
        RING_YX3A, bid='YX3A', source_id='4a31afc8-5ccf-4d0e-8957-5eb535d0f61f',
        floors=4, floor_h=3.45, roof='flat_rail',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
    )
    b.footprint_building(
        RING_YX3B, bid='YX3B', source_id='0490bee8-f525-4535-8022-bbf1b27dfa27',
        floors=4, floor_h=3.45, roof='flat_rail',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
    )
    b.footprint_building(
        RING_YX3C, bid='YX3C', source_id='2c5ac658-b5d4-44eb-afd1-af79510fdaa7',
        floors=2, floor_h=3.45, roof='hip',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        instanced_windows=False,
    )

    # 3d. YX4 NW Complex
    b.footprint_building(
        RING_YX4A, bid='YX4A', source_id='df88b022-fa72-43f2-988c-cdbf658a212e',
        floors=4, floor_h=3.45, roof='flat_rail',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
    )
    b.footprint_building(
        RING_YX4B, bid='YX4B', source_id='a22a5e84-7426-4489-b90e-655b1e94f08e',
        floors=4, floor_h=3.45, roof='hip',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
    )
    b.footprint_building(
        RING_YX4C, bid='YX4C', source_id='3ee1d71b-27a5-4e0e-9b2c-1122cf46e211',
        floors=2, floor_h=3.35, roof='flat',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        instanced_windows=False,
    )
    b.footprint_building(
        RING_YX4D, bid='YX4D', source_id='c6bec02b-96eb-4c51-9dc7-296919d16ed9',
        floors=2, floor_h=3.35, roof='flat',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        instanced_windows=False,
    )
    b.footprint_building(
        RING_YX4E, bid='YX4E', source_id='b8ac1474-a1d7-449a-9904-e40c7a8d44bc',
        floors=2, floor_h=3.35, roof='flat',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        instanced_windows=False,
    )

    # 3e. YX5 East Pergola Complex & SE Annexes (`sat_grid`)
    b.footprint_building(
        RING_YX5A, bid='YX5A', source_id='d9376a46-b53f-4db5-8db7-250b33b959c7',
        floors=5, floor_h=3.45, roof='flat_pergola',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
    )
    b.footprint_building(
        RING_YX5B, bid='YX5B', source_id='7ab7e364-2cb3-41fe-96e6-82b00c86a7a5',
        floors=4, floor_h=3.45, roof='flat_rail',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
    )
    b.footprint_building(
        RING_YX5C, bid='YX5C', source_id='7fd618fe-4f92-414c-bb40-1543278fa20c',
        floors=5, floor_h=3.45, roof='flat_pergola',
        wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
        parapet_reg='wall_accent', top_parapet_reg='white',
    )
    b.footprint_building(
        RING_YX5D, bid='YX5D', source_id='ee97146d-2240-4d35-a840-004f16d85258',
        floors=2, floor_h=3.35, roof='flat',
        wall_reg='cream', base_reg='wall_base', win_frame_reg='win_frame',
        instanced_windows=False,
    )
    b.footprint_building(
        RING_YX5E, bid='YX5E', source_id='ada9b9b6-a7e3-4bb9-9dc5-2467ffcc64fa',
        floors=1, floor_h=3.4, roof='flat_rail',
        wall_reg='cream', base_reg='wall_base', win_frame_reg='win_frame',
        instanced_windows=False,
    )

    # 4. Sports Facilities (400m Track + Turf Pitch + Grandstand + 5 Basketball Courts)
    tcx, tcz, t_len, t_wid, tang = mrr_stats(WAY_TRACK)
    b.running_track(tcx, tcz, length=t_len, width=t_wid, yaw=math.radians(tang),
                    track_reg='track_red', infield_mode='turf')
    # Green semicircular end-zone concrete courts inside the oval (`ref_06`, `ref_10`, `sat_grid`)
    gy_tr = b.ground(tcx, tcz) + 0.082
    b.box(21.5, gy_tr, 2.0, 29.0, 0.025, 19.5, 'court_a', cap_region='court_a')
    b.box(22.5, gy_tr, 81.5, 28.0, 0.025, 17.5, 'court_a', cap_region='court_a')

    # Blue canopy trackside grandstand (`sat_grid` at x=56.5, z=31.0)
    gy_gs = b.ground(57.2, 31.5)
    old = b.pose
    b.pose = (57.2, 0.0, 31.5, 0.0)
    b.box(0.0, gy_gs - 0.02, 0.0, 4.6, 0.52, 16.8, 'granite', cap_region='pave_grey', collide=True)
    b.box(0.9, gy_gs + 0.45, 0.0, 2.6, 0.65, 16.4, 'pave_dark', cap_region='pave_grey', collide=True, bottom=True)
    for sz in (-6.8, -2.3, 2.3, 6.8):
        b.box(1.7, gy_gs + 0.45, sz, 0.24, 3.6, 0.24, 'steel', collide=True)
    b.box(0.2, gy_gs + 3.95, 0.0, 5.4, 0.22, 18.0, 'roof_blue', cap_region='roof_blue', bottom=True)
    b.pose = old

    # 3 SE Emerald Basketball Courts (`way/1474979896..98`)
    for wc in (WAY_E_COURT_1, WAY_E_COURT_2, WAY_E_COURT_3):
        ccx, ccz, cw, cd, cang = mrr_stats(wc)
        b.basketball_court(ccx, ccz, yaw=math.radians(cang), w=cw, d=cd,
                           surface='court_a', apron='court_a', key_reg='cinnabar')

    # 2 SW Emerald Basketball Courts (`way/1036824396`)
    scx, scz, sw, sd, sang = mrr_stats(WAY_SW_COURTS)
    gy_sw = b.ground(scx, scz) + 0.018
    b.box(scx, gy_sw, scz, max(sw, sd) - 1.5, 0.02, min(sw, sd) - 1.5, 'pave_grey', cap_region='pave_grey')
    for bx in (-70.0, -44.0):
        b.basketball_court(bx, 81.2, yaw=math.radians(90.0), w=28.0, d=15.0,
                           surface='court_a', apron='court_a', key_reg='cinnabar')

    # 5. Campus Paved Axial Spines & Flagpole Plaza (`ref_04`)
    b.path_strip((-18.7, -124.0), (-16.0, 56.0), width=5.6, region='pave_road')
    b.path_strip((-16.0, -40.0), (50.0, -40.0), width=4.8, region='pave_road')
    b.path_strip((56.0, 58.0), (112.0, 58.0), width=4.2, region='pave_road')
    b.flagpole_plaza(-19.0, 32.0, yaw=math.radians(90.0), poles=3)

    # 6. Gardens & IDOK-71 Trees (`sat_grid` tree canopy distribution)
    b.green_bed(11.0, -50.0, 42.0, 40.0, yaw=0.0, trees=12, species='camphor', seed=83)
    garden_trees = [
        (-74.0, -96.0, 'camphor', 1.0), (-58.0, -92.0, 'banyan', 1.05),
        (-42.0, -96.0, 'osmanthus', 0.92), (-32.0, -84.0, 'camphor', 0.95),
        (-66.0, -80.0, 'bischofia', 0.96), (-46.0, -76.0, 'ginkgo', 0.9),
        (-91.0, -40.0, 'camphor', 0.95), (-91.0, 4.0, 'banyan', 1.0),
        (-91.0, 40.0, 'camphor', 0.92), (-25.0, -26.0, 'camphor', 0.98),
        (-5.0, -24.0, 'banyan', 1.02), (18.0, -24.0, 'camphor', 1.0),
        (38.0, -24.0, 'osmanthus', 0.95), (62.0, -20.0, 'camphor', 0.96),
        (46.0, -68.0, 'camphor', 0.92), (18.0, -78.0, 'osmanthus', 0.9),
    ]
    for tx, tz, sp, sc in garden_trees:
        b.tree(tx, tz, species=sp, scale=sc, yaw=(tx * 0.43 + tz * 0.19) % math.tau)


if __name__ == '__main__':
    export_school_glb('yixian_high', PALETTE, SIGNS, build_yixian, seed=2028)
