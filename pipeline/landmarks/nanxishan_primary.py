"""桂林市南溪山小学 (`way/1037119966`) full campus restoration.

Evidence: .ops-docs/layout/schools/nanxishan_primary.md (Esri z19 imagery, OSM, Overture, public photos).
- Central oval: red track (~45 x 69 m) around a green apron with two blue basketball courts
  (salmon keys) and blue small-games strips at both ends (imagery, `ref_06`, `ref_09`).
- `E1` east 4F white block with red-brown window bays and blue column plinths, raised stage
  under the slogan lintel with steps down to the track (`ref_01..03`, `ref_10`); `E2` 2F
  frame wing behind it.
- North blocks `N1` (`bd5989c4`), `N2`, `N3` (`b32c8f05`), `N4` (`e525b5e9`), west `W1`, south
  low row `S1..S3` (`5f7711c6`, `99e11acf`), all on imagery/Overture footprints.
- Closed wrought-iron gate at the west passage to 中山南路 (`ref_00`, `ref_07`, `ref_08`);
  no guard post, turnstile or camera; building uses are unlabelled.
"""
import math

from shapely.geometry import Point, Polygon

from school_kit import SchoolBuilder, export_school_glb

PALETTE = {
    'wall_main':   '#efede7',  # white facade (`ref_10`)
    'wall_sub':    '#b4553f',  # red-brown window recess panels (`ref_01`, `ref_10`)
    'wall_accent': '#b4553f',
    'wall_base':   '#2f5fae',  # blue column plinths (`ref_02`, `ref_10`)
    'win_frame':   '#a9503c',
    'win_trim':    '#f4f2ec',
    'base_frame':  '#c9ccd0',
    'base_trim':   '#2f5fae',
    'pave_grey':   '#cbc7be',
    'pave_road':   '#a5a29b',
    'pave_dark':   '#5b5e62',
    'granite':     '#b7b3ab',
    'roof_tile':   '#6d737b',
    'roof_blue':   '#7fa7cf',
    'track_red':   '#b8513f',
    'turf_a':      '#3f9a5a',  # green apron around the courts
    'turf_b':      '#368a50',
    'court_a':     '#3f9a5a',
    'court_b':     '#2c55b5',  # blue court surface (imagery, `ref_06`)
    'cinnabar':    '#e59a80',  # salmon keys / centre circles
    'cream':       '#e7e2d6',
    'white':       '#f4f3ef',
    'dark_stone':  '#55595e',
    'steel':       '#a9b0b6',
    'has_ac':      True,
}

SIGNS = {
    'school_name': '桂林市南溪山小学',
    'school_en':   'Nanxishan Primary School Guilin',
    'gate_bg':     '#f1ece4',
    'gate_fg':     '#b0242a',
    'gate_sub_fg': '#55585c',
    'vert_bg':     '#c9ccd0',
    'vert_fg':     '#1e1e1e',
    'vert_text':   '桂林市南溪山小学',
    'motto':       '最美的山水  最好的自己',
    'led_title':   '桂林市南溪山小学',
    'emblem':      '南溪',
}

# Campus inset 0.8 m, notched around kept street-front houses (`69c30fe2`, `e82004ce`,
# `8c18edf2`); the west arm narrows to the passage gate on 中山南路.
FENCE_RING = [
    (-57.57, -10.23), (-60.66, -10.29), (-60.08, 7.94), (-74.3, 8.8), (-74.45, 12.23),
    (-69.37, 12.13), (-68.95, 12.57), (-69.0, 13.92), (-44.27, 14.45), (-44.66, 32.57),
    (-41.81, 32.56), (-41.26, 37.16), (-41.68, 37.73), (-44.77, 38.05), (-45.17, 56.53),
    (51.32, 58.58), (53.91, -61.49), (-4.53, -62.74), (-4.95, -42.77), (-56.85, -43.87),
]
GATE_EDGE = ((-74.3, 8.8), (-74.45, 12.23))


def rect(x0, z0, x1, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


RING_E1 = rect(32.5, -26.0, 44.5, 34.5)
RING_E2 = rect(44.9, -25.0, 51.8, 25.0)
RING_N1 = [(47.3, -60.6), (18.9, -61.5), (18.68, -54.11), (47.16, -53.22)]          # bd5989c4 (clipped)
RING_N2 = rect(-4.0, -61.6, 17.0, -48.5)
RING_N3 = [(31.91, -44.64), (31.28, -34.16), (44.75, -33.37), (45.37, -43.84)]      # b32c8f05
RING_N4 = [(18.76, -33.14), (27.82, -38.63), (23.97, -44.97), (18.53, -41.67),
           (13.03, -47.6), (9.41, -46.2)]                                           # e525b5e9 (clipped)
RING_W1 = rect(-57.0, -18.0, -31.0, -7.0)
RING_S1 = rect(-43.8, 46.5, -24.0, 55.6)
RING_S2 = [(-20.07, 56.2), (0.8, 56.6), (1.4, 50.99), (-19.56, 49.82)]             # 99e11acf (clipped)
RING_S3 = rect(3.0, 44.0, 50.5, 53.5)

TRACK_C = (2.7, -2.5)
TRACK_L, TRACK_W = 69.0, 45.4


def stadium(cx, cz, length, width, segs=14):
    """Stadium outline with its long axis along +z."""
    r = width * 0.5
    h = max(0.0, length * 0.5 - r)
    pts = []
    for i in range(segs + 1):
        a = math.pi + math.pi * i / segs
        pts.append((cx + r * math.cos(a), cz - h + r * math.sin(a)))
    for i in range(segs + 1):
        a = math.pi * i / segs
        pts.append((cx + r * math.cos(a), cz + h + r * math.sin(a)))
    return pts


def _gate(b: SchoolBuilder):
    p0, p1 = GATE_EDGE
    mx, mz = (p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5
    yaw = math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0])
    gy = b.ground(mx, mz)
    old = b.pose
    b.pose = (mx, 0.0, mz, yaw)
    for sgn in (-1.0, 1.0):
        b.box(sgn * 2.05, gy - 0.03, 0.0, 0.55, 3.05, 0.55, 'cream', cap_region='white', collide=True)
    b.retractable_gate(3.5, gate_h=2.2, y0=gy, iron_grille=True)
    if b.lod < 2:
        b.box(0.0, gy + 2.95, 0.0, 4.6, 0.32, 0.6, 'wall_base', cap_region='white', bottom=True)
        b.sign(0.0, gy + 3.11, -0.305, 3.6, 0.3, 'sign_gate', double_sided=True)
    b.pose = old


def _stage(b: SchoolBuilder):
    """Raised stage under E1's slogan lintel, steps down to the track (`ref_01`, `ref_10`)."""
    x_face, zc = 32.5, 4.0
    gy = b.ground(x_face - 2.5, zc)
    b.box(x_face - 1.6, gy - 0.04, zc, 3.2, 1.25, 13.0, 'pave_dark', cap_region='cinnabar', collide=True)
    for k in range(4):
        b.box(x_face - 3.4 - k * 0.38, gy - 0.04, zc, 0.38, 1.25 - (k + 1) * 0.3, 13.0, 'granite',
              cap_region='granite', collide=True)
    if b.lod < 2:
        for dz in (-6.2, -2.1, 2.1, 6.2):
            b.box(x_face - 0.3, gy + 1.2, zc + dz, 0.55, 3.4, 0.55, 'cream', cap_region='white')
            b.box(x_face - 0.3, gy + 1.2, zc + dz, 0.6, 0.9, 0.6, 'wall_base', cap_region='white')
        b.box(x_face - 0.9, gy + 4.6, zc, 1.8, 1.0, 14.0, 'white', cap_region='steel', bottom=True)
        old = b.pose
        b.pose = (x_face - 1.82, 0.0, zc, math.pi / 2)
        b.sign(0.0, gy + 5.1, 0.0, 12.0, 0.8, 'sign_motto', double_sided=False)
        b.pose = old


def build_nanxishan(b: SchoolBuilder):
    b.ground_slab(FENCE_RING, region='pave_grey', lift=0.025, edge_drop=0.04)
    ring = b._clean_ring_ccw(FENCE_RING)
    ge = next(i for i in range(len(ring)) if {ring[i], ring[(i + 1) % len(ring)]} == set(GATE_EDGE))
    b.perimeter_fence(FENCE_RING, gate_edge=ge, gate_t0=0.0, gate_t1=1.0,
                      wall_h=2.3, base_reg='wall_base', post_reg='white')
    _gate(b)

    common = dict(wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
                  parapet_reg='wall_accent', top_parapet_reg='white')
    low = dict(wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame', instanced_windows=False)
    b.footprint_building(RING_E1, bid='E1', source_id='imagery:nanxishan-e1', floors=4, floor_h=3.5, roof='flat_rail', **common)
    b.footprint_building(RING_E2, bid='E2', source_id='imagery:nanxishan-e2', floors=2, floor_h=3.4, roof='flat_pergola', **common)
    b.footprint_building(RING_N1, bid='N1', source_id='bd5989c4-9eb2-4073-8af9-2ea8d044f849', floors=4, floor_h=3.4, roof='flat_rail', **common)
    b.footprint_building(RING_N2, bid='N2', source_id='imagery:nanxishan-n2', floors=3, floor_h=3.4, roof='flat_rail', **common)
    b.footprint_building(RING_N3, bid='N3', source_id='b32c8f05-7027-4a5f-8550-49d11c83ae05', floors=3, floor_h=3.3, roof='flat', **low)
    b.footprint_building(RING_N4, bid='N4', source_id='e525b5e9-9d23-49ea-a061-fad148646ae8', floors=2, floor_h=3.3, roof='flat', **low)
    b.footprint_building(RING_W1, bid='W1', source_id='imagery:nanxishan-w1', floors=3, floor_h=3.4, roof='flat_rail', **common)
    b.footprint_building(RING_S1, bid='S1', source_id='5f7711c6-a08f-46a2-af04-58391ea84bf4', floors=2, floor_h=3.3, roof='flat', **low)
    b.footprint_building(RING_S2, bid='S2', source_id='99e11acf-f53e-4e7f-a5d5-5842b8778209', floors=2, floor_h=3.3, roof='flat', **low)
    b.footprint_building(RING_S3, bid='S3', source_id='imagery:nanxishan-s3', floors=1, floor_h=3.6, roof='flat_blue', **low)
    _stage(b)

    # Oval: red track, green apron, two blue basketball courts and blue end strips.
    cx, cz = TRACK_C
    gy = b.ground(cx, cz)
    segs = 14 if b.detail else 8
    b.prism(stadium(cx, cz, TRACK_L + 0.7, TRACK_W + 0.7, segs), gy + 0.005, 0.04, 'white', cap_region='white')
    b.prism(stadium(cx, cz, TRACK_L, TRACK_W, segs), gy + 0.02, 0.04, 'track_red', cap_region='track_red')
    b.prism(stadium(cx + 2.5, cz, TRACK_L - 9.0, TRACK_W - 15.0, segs), gy + 0.04, 0.045, 'turf_a', cap_region='turf_a')
    if b.detail:
        for k in (1, 2):
            for sgn in (-1.0, 1.0):
                b.box(cx + sgn * (TRACK_W * 0.5 - k * 2.4), gy + 0.062, cz, 0.09, 0.012, TRACK_L - TRACK_W, 'white')
    for ccz in (-9.0, 7.2):
        b.basketball_court(5.0, ccz, yaw=0.0, w=27.0, d=15.2, surface='court_b', apron=None,
                           key_reg='cinnabar', lift=0.065)
    for ez in (-22.5, 21.5):
        b.box(5.0, gy + 0.09, ez, 26.0, 0.02, 9.0, 'court_b', cap_region='court_b')
        if b.detail:
            for dx in (-6.5, 0.0, 6.5):
                b.box(5.0 + dx, gy + 0.11, ez, 0.1, 0.012, 9.0, 'white')

    # Campus walks: west passage to the oval, north forecourt.
    b.path_strip((-73.0, 10.5), (-46.0, 10.5), width=3.2, region='pave_road')
    b.path_strip((-44.0, 3.0), (-21.0, 3.0), width=4.0, region='pave_road')

    trees = [
        (-40.0, -2.0, 'banyan', 1.15), (-30.0, 6.0, 'banyan', 1.1), (-26.0, -26.0, 'camphor', 1.0),
        (-36.0, -34.0, 'camphor', 0.95), (-14.0, -38.0, 'camphor', 1.0), (-2.0, -40.0, 'banyan', 1.0),
        (-24.0, 22.0, 'camphor', 1.0), (-30.0, 38.0, 'camphor', 0.95), (-12.0, 40.0, 'banyan', 1.05),
        (20.0, 38.0, 'camphor', 0.95), (30.0, -30.0, 'osmanthus', 0.9), (28.0, 40.0, 'osmanthus', 0.85),
        (-50.0, -30.0, 'camphor', 0.95), (-50.0, 30.0, 'osmanthus', 0.85),
    ]
    inside = Polygon(FENCE_RING).buffer(-1.5)
    for tx, tz, sp, sc in trees:
        if inside.contains(Point(tx, tz)):
            b.tree(tx, tz, species=sp, scale=sc, yaw=(tx * 0.37 + tz * 0.21) % math.tau)


if __name__ == '__main__':
    export_school_glb('nanxishan_primary', PALETTE, SIGNS, build_nanxishan, seed=2032)
