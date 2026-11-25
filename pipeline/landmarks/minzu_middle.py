"""桂林市民族中学 (`way/647468207`, 民主路9号; 现逸仙中学初中部) full campus restoration.

Evidence: .ops-docs/layout/schools/minzu_middle.md (Esri z19 imagery, OSM, Overture, public photos).
- `MZ1` north 5F white-tile teaching block (`1437fe77` = OSM `way/1474978350`), blue window
  frames and a flat entrance canopy facing the track (`ref_17`, `ref_14..16`).
- `MZ2` NE 4F block with pale-blue roof (`89d8a68b`), `MZ3` 3F white-parapet block west of it
  (imagery only footprint, aerial `ref_02`), `MZ4` south 3F blue-roof block (`c18d192c` =
  OSM `way/1474978345`) and `MZ5` 2F annex (`a30748df`).
- ~300 m red oval (`relation/20185367`) with east 120 m straightaway, striped turf pitch
  (`way/221349776`), blue small court in the south bend, four courts east of the track
  (`way/1474978346..49`).
- Closed east gate on the lane to 民主路 (`ref_00`, `ref_03`): twin grey-white piers and a
  stainless retractable gate. No guard post, turnstile or camera; building uses are unlabelled.
"""
import math

from shapely.geometry import Point, Polygon

from school_kit import SchoolBuilder, export_school_glb, mrr_stats

PALETTE = {
    'wall_main':   '#eceae4',  # white facade tile (`ref_17`, `ref_14`)
    'wall_sub':    '#6f9fd0',  # blue window bands
    'wall_accent': '#a9b0b8',  # grey stringcourse
    'wall_base':   '#7d838a',  # grey stone dado
    'win_frame':   '#3f74b4',  # blue window frames (`ref_00`, `ref_17`)
    'win_trim':    '#f4f3ef',
    'base_frame':  '#b9c0c8',
    'base_trim':   '#6c737b',
    'pave_grey':   '#c8c5bd',
    'pave_road':   '#a19e97',
    'pave_dark':   '#585c60',
    'granite':     '#b5b2aa',
    'roof_tile':   '#6c727a',
    'roof_blue':   '#8fb4d6',  # pale blue roofs in the imagery
    'track_red':   '#b4503f',
    'turf_a':      '#4f8e46',
    'turf_b':      '#427a3b',
    'court_a':     '#3f8a62',
    'court_b':     '#3f73b0',
    'cinnabar':    '#c0473a',
    'cream':       '#e2ddd2',
    'white':       '#f3f2ee',
    'dark_stone':  '#5a5f64',
    'steel':       '#a7aeb5',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '桂林市民族中学',
    'school_en':   'Guilin Minzu Middle School',
    'gate_bg':     '#eef0f2',
    'gate_fg':     '#a3251f',
    'gate_sub_fg': '#55585c',
    'vert_bg':     '#c9ccd0',
    'vert_fg':     '#1e1e1e',
    'vert_text':   '桂林市民族中学',
    'motto':       '',
    'led_title':   '桂林市民族中学',
    'emblem':      '民中',
}

# Campus inset 0.8 m; SW/S/SE terrace edges pulled in 2.2-3.2 m clear of the drop, notched around the kept west houses (`86af2cac`, `e149f743`).
FENCE_RING = [
    (-4.15, 92.68), (4.94, 109.52), (8.79, 99.0), (25.99, 52.0), (49.07, -11.08), (48.47, -11.95), (58.65, -37.29),
    (69.91, -33.57), (79.69, -59.96), (40.27, -73.68), (-17.57, -94.56), (-38.23, -39.69),
    (-41.78, -30.27), (-54.43, 3.33), (-48.18, 5.99), (-47.92, 6.75), (-52.8, 18.0),
    (-59.08, 15.68), (-61.45, 21.98), (-56.02, 24.1), (-55.73, 24.85), (-60.27, 36.25),
    (-66.1, 34.32), (-68.51, 43.05),
]
GATE_EDGE = ((69.91, -33.57), (79.69, -59.96))

RING_MZ1 = [(31.52, -56.01), (-22.81, -77.89), (-30.18, -59.82), (-16.4, -54.27),
            (-17.15, -52.43), (9.81, -41.56), (10.72, -43.8), (24.31, -38.33)]     # 1437fe77
RING_MZ2 = [(71.38, -47.47), (75.58, -57.07), (46.73, -69.66), (42.53, -60.05)]    # 89d8a68b
RING_MZ4 = [(24.87, 58.87), (-9.11, 48.31), (-16.73, 72.51), (17.26, 83.06)]       # c18d192c
RING_MZ5 = [(12.24, 96.53), (15.16, 87.22), (-0.69, 82.5), (-3.41, 91.59)]         # a30748df

# Track frame: long axis along (-0.336, 0.942) i.e. yaw 70.4 deg.
AX = (-0.336, 0.942)
NX = (0.942, 0.336)
YAW_T = math.radians(70.4)


def tf(along: float, n: float) -> tuple[float, float]:
    return (along * AX[0] + n * NX[0], along * AX[1] + n * NX[1])


# MZ3: 3F block west of MZ2 (imagery footprint, 11 x 25 m in track frame).
_c3 = (40.5, -37.5)
RING_MZ3 = [(_c3[0] + a * AX[0] + n * NX[0], _c3[1] + a * AX[1] + n * NX[1])
            for a, n in ((-12.5, -5.5), (12.5, -5.5), (12.5, 5.5), (-12.5, 5.5))]

COURTS_W = [[(4.19, 18.31), (18.83, 23.49), (9.34, 49.96), (-5.3, 44.78)],
            [(15.63, -13.91), (30.26, -8.74), (20.78, 17.74), (6.14, 12.56)]]
COURTS_E = [[(19.29, 23.77), (33.93, 28.95), (24.45, 55.43), (9.8, 50.24)],
            [(31.26, -8.49), (45.9, -3.32), (36.41, 23.15), (21.77, 17.98)]]


def _gate(b: SchoolBuilder):
    p0, p1 = GATE_EDGE
    mx, mz = (p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5
    yaw = math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0])
    gy = b.ground(mx, mz)
    old = b.pose
    b.pose = (mx, 0.0, mz, yaw)
    b.box(0.0, gy - 0.03, -1.9, 10.8, 0.055, 3.4, 'granite', cap_region='pave_grey')
    for sgn in (-1.0, 1.0):
        px = sgn * 4.6
        b.box(px, gy - 0.03, 0.0, 1.5, 0.6, 1.5, 'dark_stone', cap_region='granite', collide=True)
        b.box(px, gy + 0.55, 0.0, 1.3, 3.9, 1.3, 'cream', cap_region='white', collide=True)
        b.box(px, gy + 4.4, 0.0, 1.5, 0.3, 1.5, 'wall_base', cap_region='white', bottom=True)
    if b.lod < 2:
        b.sign(4.6, gy + 2.6, 0.66, 0.42, 1.9, 'sign_vert', double_sided=True)
        b.sign(-4.6, gy + 2.9, 0.66, 1.2, 0.6, 'sign_gate', double_sided=True)
    b.retractable_gate(7.9, gate_h=1.6, y0=gy)
    b.pose = old


def build_minzu(b: SchoolBuilder):
    b.ground_slab(FENCE_RING, region='pave_grey', lift=0.025, edge_drop=0.04)
    ring = b._clean_ring_ccw(FENCE_RING)
    ge = next(i for i in range(len(ring))
              if math.dist(ring[i], GATE_EDGE[0]) < 0.6 and math.dist(ring[(i + 1) % len(ring)], GATE_EDGE[1]) < 0.6
              or math.dist(ring[i], GATE_EDGE[1]) < 0.6 and math.dist(ring[(i + 1) % len(ring)], GATE_EDGE[0]) < 0.6)
    # On the SE terrace the MZ4/MZ5 walls are the boundary: no fence through them.
    se = next(i for i in range(len(ring)) if {ring[i], ring[(i + 1) % len(ring)]} == {(8.79, 99.0), (25.99, 52.0)})
    b.perimeter_fence(FENCE_RING, gate_edge=ge, gate_t0=0.35, gate_t1=0.65,
                      wall_h=2.3, base_reg='wall_base', post_reg='white', skip_edges={se})
    p0, p1 = (16.9, 83.4), (15.0, 87.6)  # wall closing the gap between MZ4 and MZ5
    g = min(b.ground(*p0), b.ground(*p1))
    b._sloped_beam(p0, b.ground(*p0) - 0.04, g + 2.3, p1, b.ground(*p1) - 0.04, g + 2.3, 0.32, 'wall_base', 'white')
    if b.collide:
        old = b.pose
        b.pose = ((p0[0] + p1[0]) / 2, 0.0, (p0[1] + p1[1]) / 2, math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]))
        b.add_hit_box(0.0, g - 0.5, 0.0, math.dist(p0, p1) + 0.6, 3.0, 0.5)
        b.pose = old
    _gate(b)

    common = dict(wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
                  parapet_reg='wall_accent', top_parapet_reg='white')
    b.footprint_building(RING_MZ1, bid='MZ1', source_id='1437fe77-8f71-4637-b125-caa93a3aa1c6',
                         floors=5, floor_h=3.4, roof='flat_rail', **common)
    b.footprint_building(RING_MZ2, bid='MZ2', source_id='89d8a68b-7e9e-4c2a-8063-a6753edbfab6',
                         floors=4, floor_h=3.4, roof='flat_blue', **common)
    b.footprint_building(RING_MZ3, bid='MZ3', source_id='imagery:minzu-mz3',
                         floors=3, floor_h=3.4, roof='flat_rail', **common)
    b.footprint_building(RING_MZ4, bid='MZ4', source_id='c18d192c-fedb-44d2-988b-cbce372d7f4c',
                         floors=3, floor_h=3.6, roof='flat_blue', **common)
    b.footprint_building(RING_MZ5, bid='MZ5', source_id='a30748df-9cc7-4867-bc7e-72938671a37a',
                         floors=2, floor_h=3.3, roof='flat', instanced_windows=False,
                         wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame')
    if b.lod < 2:
        # Flat entrance canopy on MZ1's track face (`ref_17`), wall-mounted, clear of the track.
        p0, p1 = (-17.15, -52.43), (9.81, -41.56)
        mx, mz = (p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5
        yaw = math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0])
        gy = max(b.ground(*p0), b.ground(*p1))
        old = b.pose
        b.pose = (mx, 0.0, mz, yaw)
        b.box(0.0, gy + 3.6, 0.9, 12.0, 0.32, 1.8, 'white', cap_region='steel', bottom=True)
        b.pose = old

    # ~300 m oval + east straightaway (`relation/20185367`), turf pitch, south-bend blue court.
    # South apex held 2 m short of the terrace drop below the mapped bend.
    cx, cz = tf(17.1, -20.9)
    b.running_track(cx, cz, length=112.0, width=43.5, yaw=YAW_T, track_reg='track_red', infield_mode='turf')
    sx, sz = tf(19.5, 4.25)
    gy = b.ground(sx, sz) + 0.045
    old = b.pose
    b.pose = (sx, 0.0, sz, YAW_T)
    b.box(0.0, gy, 0.0, 118.0, 0.035, 6.6, 'track_red', cap_region='track_red')
    if b.detail:
        for k in range(1, 4):
            b.box(0.0, gy + 0.035, -3.3 + k * 1.65, 118.0, 0.02, 0.08, 'white')
    b.pose = old
    bx, bz = tf(58.0, -21.0)
    b.basketball_court(bx, bz, yaw=YAW_T, w=17.0, d=11.0, surface='court_b', apron=None,
                       key_reg='court_b', lift=0.07)

    for ring_c, surf in [(r, 'court_a') for r in COURTS_W] + [(r, 'court_b') for r in COURTS_E]:
        ccx, ccz, cw, cd, cang = mrr_stats(ring_c)
        b.basketball_court(ccx, ccz, yaw=math.radians(cang), w=cw - 2.4, d=cd - 2.4,
                           surface=surf, apron='court_a', key_reg='cinnabar')

    # Gate approach, campus spine and monument garden (`ref_09`).
    b.path_strip((72.0, -47.5), (56.0, -53.5), width=6.0, region='pave_road')
    b.green_bed(58.0, -42.0, 7.0, 4.5, yaw=YAW_T, trees=0)
    if b.lod < 2:
        g = b.ground(58.0, -42.0)
        b.box(58.0, g + 0.12, -42.0, 0.7, 2.2, 0.35, 'dark_stone', cap_region='granite')

    trees = [
        (54.0, -26.0, 'osmanthus', 0.9),
        (58.0, -58.0, 'camphor', 0.9), (-28.0, -64.0, 'osmanthus', 0.85), (-36.0, -42.0, 'camphor', 0.95),
        (-58.0, 42.0, 'banyan', 1.0), (-36.0, 80.0, 'camphor', 0.95), (-22.0, 88.0, 'camphor', 0.9),
        (8.0, 105.0, 'osmanthus', 0.85), (26.0, 30.0, 'palm', 0.9), (63.0, -36.0, 'palm', 0.85),
    ]
    # East boundary tree row between the courts and the fence (imagery canopy).
    for i, tz in enumerate((60.0, 70.0, 80.0, 90.0, 100.0)):
        fx = 49.07 + (4.94 - 49.07) * (tz + 11.08) / (109.52 + 11.08)
        trees.append((fx - 1.6, tz, ('camphor', 'banyan', 'camphor')[i % 3], 0.85 + 0.05 * (i % 3)))
    inside = Polygon(FENCE_RING).buffer(-1.5)
    for tx, tz, sp, sc in trees:
        if not inside.contains(Point(tx, tz)):
            continue
        b.tree(tx, tz, species=sp, scale=sc, yaw=(tx * 0.37 + tz * 0.21) % math.tau)


if __name__ == '__main__':
    export_school_glb('minzu_middle', PALETTE, SIGNS, build_minzu, seed=2031)
